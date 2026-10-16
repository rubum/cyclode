import re
import json
import hashlib
import logging
from pathlib import Path
from typing import Optional, Dict, Any, List
from urllib.parse import urlparse, urljoin, quote, unquote
from html.parser import HTMLParser
import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse, HTMLResponse
from sqlalchemy import select, and_, or_
from app.db.session import async_session_factory
from app.db.models import DocPageCacheModel


logger = logging.getLogger("cyclode.reader")
router = APIRouter(prefix="/api/reader", tags=["Reader"])

RESERVED_GITHUB_PATHS = {
    "login", "signup", "settings", "pricing", "features", "explore",
    "topics", "trending", "collections", "events", "about", "security", "contact"
}


class StandardDocParser(HTMLParser):
    """
    Standard-library based HTML parser that strips navigation, search, and footers,
    extracting clean Markdown headings, lists, code blocks, links, and paragraphs.
    Used as an immediate fallback when BeautifulSoup is not available.
    """
    def __init__(self, base_url: str = ""):
        super().__init__()
        self.base_url = base_url
        self.output = []
        self.skip_stack = []
        self.current_href = None
        self.current_link_text = []
        self.in_pre = False
        self.current_pre_text = []
        self.in_heading = None
        self.current_heading_text = []
        self.ignored_tags = {"script", "style", "nav", "header", "footer", "aside", "noscript", "svg", "form", "iframe", "button"}

    def handle_starttag(self, tag, attrs):
        attr_dict = dict(attrs)
        tag_lower = tag.lower()

        cls = attr_dict.get("class", "").lower()
        elem_id = attr_dict.get("id", "").lower()
        if (tag_lower in self.ignored_tags or 
            any(w in cls for w in ["sidebar", "navbar", "search", "table-of-contents", "pagination", "breadcrumbs", "menu", "cookie", "banner"]) or
            any(w in elem_id for w in ["sidebar", "navbar", "search", "menu"])):
            self.skip_stack.append(tag_lower)
            return

        if self.skip_stack:
            return

        if tag_lower in ["h1", "h2", "h3", "h4", "h5", "h6"]:
            self.in_heading = int(tag_lower[1])
            self.current_heading_text = []
        elif tag_lower == "p":
            self.output.append("\n\n")
        elif tag_lower in ["ul", "ol"]:
            self.output.append("\n")
        elif tag_lower == "li":
            self.output.append("\n- ")
        elif tag_lower == "pre":
            self.in_pre = True
            self.current_pre_text = []
        elif tag_lower == "blockquote":
            self.output.append("\n> ")
        elif tag_lower == "hr":
            self.output.append("\n\n---\n\n")
        elif tag_lower == "a":
            href = attr_dict.get("href", "")
            if href and not href.startswith("#"):
                if self.base_url and not href.startswith(("http://", "https://", "data:", "mailto:")):
                    href = urljoin(self.base_url, href)
                self.current_href = href
                self.current_link_text = []
        elif tag_lower == "img":
            src = attr_dict.get("src", "")
            alt = attr_dict.get("alt", "image")
            if src:
                if self.base_url and not src.startswith(("http://", "https://", "data:")):
                    src = urljoin(self.base_url, src)
                self.output.append(f"![{alt}]({src}) ")

    def handle_endtag(self, tag):
        tag_lower = tag.lower()
        if self.skip_stack:
            if self.skip_stack[-1] == tag_lower:
                self.skip_stack.pop()
            return

        if tag_lower in ["h1", "h2", "h3", "h4", "h5", "h6"] and self.in_heading:
            hashes = "#" * self.in_heading
            heading = "".join(self.current_heading_text).strip()
            self.output.append(f"\n\n{hashes} {heading}\n\n")
            self.in_heading = None
        elif tag_lower == "p":
            self.output.append("\n\n")
        elif tag_lower == "pre" and self.in_pre:
            code = "".join(self.current_pre_text).strip()
            self.output.append(f"\n\n```\n{code}\n```\n\n")
            self.in_pre = False
        elif tag_lower == "a" and self.current_href:
            link_text = "".join(self.current_link_text).strip() or self.current_href
            self.output.append(f"[{link_text}]({self.current_href}) ")
            self.current_href = None

    def handle_data(self, data):
        if self.skip_stack:
            return
        if self.in_heading:
            self.current_heading_text.append(data)
        elif self.in_pre:
            self.current_pre_text.append(data)
        elif self.current_href:
            self.current_link_text.append(data)
        else:
            cleaned = re.sub(r"[ \t]+", " ", data)
            self.output.append(cleaned)


def _clean_html_to_markdown(html_text: str, base_url: str = "", _soup: Any = None) -> str:
    """
    Extracts readable article/main text and converts HTML into clean Markdown.
    Uses BeautifulSoup when installed, with StandardDocParser fallback.
    """
    try:
        from bs4 import BeautifulSoup, NavigableString, Tag, Comment
        soup = _soup if _soup is not None else BeautifulSoup(html_text, "html.parser")

        # Decompose non-content containers
        for tag in soup(["script", "style", "nav", "header", "footer", "aside", "noscript", "svg", "form", "iframe", "button"]):
            tag.decompose()

        # Decompose sidebar, navbar, search, and pagination elements
        for tag in soup.find_all(class_=re.compile(r"sidebar|navbar|search|toc|table-of-contents|pagination|menu|breadcrumbs|cookie|banner", re.I)):
            tag.decompose()
        for tag in soup.find_all(id=re.compile(r"sidebar|navbar|search|toc|pagination|menu", re.I)):
            tag.decompose()

        # Find primary content container
        content_root = (
            soup.find("article")
            or soup.find("main")
            or soup.find(attrs={"role": "main"})
            or soup.find(id=re.compile(r"^(?:content|main-content|article-body|doc-content|markdown)$", re.I))
            or soup.find(class_=re.compile(r"(?:markdown|theme-doc-markdown|docItemContainer|entry-content)", re.I))
            or soup.body
            or soup
        )

        lines = []

        def traverse(node):
            if isinstance(node, Comment):
                return
            if isinstance(node, NavigableString):
                text = str(node).strip()
                if text:
                    lines.append(text + " ")
                return

            tag_name = node.name.lower() if node.name else ""

            if tag_name in ["h1", "h2", "h3", "h4", "h5", "h6"]:
                level = int(tag_name[1])
                hashes = "#" * level
                lines.append(f"\n\n{hashes} {node.get_text(strip=True)}\n\n")
            elif tag_name == "p":
                lines.append("\n\n")
                for child in node.children:
                    traverse(child)
                lines.append("\n\n")
            elif tag_name in ["ul", "ol"]:
                lines.append("\n")
                is_ol = tag_name == "ol"
                start_attr = node.get("start")
                start_val = int(start_attr) if start_attr and str(start_attr).isdigit() else 1
                for idx, li in enumerate(node.find_all("li", recursive=False)):
                    prefix = f"{start_val + idx}. " if is_ol else "- "
                    lines.append(f"\n{prefix}")
                    for child in li.children:
                        traverse(child)
                lines.append("\n\n")
            elif tag_name == "pre":
                code = node.find("code")
                lang = ""
                if code and code.get("class"):
                    for c in code.get("class", []):
                        if c.startswith("language-"):
                            lang = c.replace("language-", "")
                code_text = node.get_text()
                lines.append(f"\n\n```{lang}\n{code_text.strip()}\n```\n\n")
            elif tag_name == "blockquote":
                lines.append(f"\n> {node.get_text(strip=True)}\n\n")
            elif tag_name in ["strong", "b"]:
                lines.append(f"**{node.get_text(strip=True)}** ")
            elif tag_name in ["em", "i"]:
                lines.append(f"*{node.get_text(strip=True)}* ")
            elif tag_name == "code" and node.parent.name != "pre":
                lines.append(f"`{node.get_text(strip=True)}` ")
            elif tag_name == "a":
                href = node.get("href", "")
                text = node.get_text(strip=True) or href
                if href and not href.startswith("#"):
                    if base_url and not href.startswith(("http://", "https://", "data:", "mailto:")):
                        href = urljoin(base_url, href)
                    lines.append(f"[{text}]({href}) ")
                else:
                    lines.append(f"{text} ")
            elif tag_name == "img":
                src = node.get("src", "")
                alt = node.get("alt", "") or "image"
                if src:
                    if base_url and not src.startswith(("http://", "https://", "data:")):
                        src = urljoin(base_url, src)
                    lines.append(f"![{alt}]({src}) ")
            elif tag_name == "picture":
                src = ""
                dark_source = node.find("source", media=re.compile(r"dark", re.I))
                if dark_source and dark_source.get("srcset"):
                    src = dark_source.get("srcset")
                elif node.find("source") and node.find("source").get("srcset"):
                    src = node.find("source").get("srcset")
                elif node.find("img") and node.find("img").get("src"):
                    src = node.find("img").get("src")
                if src:
                    if base_url and not src.startswith(("http://", "https://", "data:")):
                        src = urljoin(base_url, src)
                    alt = node.find("img").get("alt", "") if node.find("img") else "Logo"
                    lines.append(f"![{alt}]({src}) ")
            elif tag_name == "hr":
                lines.append("\n\n---\n\n")
            else:
                for child in node.children:
                    traverse(child)

        traverse(content_root)
        md = "".join(lines)
        md = re.sub(r"[ \t]+", " ", md)
        md = re.sub(r"\n{3,}", "\n\n", md).strip()
        if len(md) > 40000:
            md = md[:39900] + "\n\n*(Content truncated for preview length)*"
        if md:
            return md
    except Exception as e:
        logger.debug(f"BeautifulSoup parsing notice: {e}")

    # Fallback to standard library HTML parser
    try:
        parser = StandardDocParser(base_url=base_url)
        parser.feed(html_text)
        res = "".join(parser.output)
        res = re.sub(r"[ \t]+", " ", res)
        res = re.sub(r"\n{3,}", "\n\n", res).strip()
        if len(res) > 40000:
            res = res[:39900] + "\n\n*(Content truncated for preview length)*"
        if res:
            return res
    except Exception as e:
        logger.debug(f"StandardDocParser fallback notice: {e}")

    # Safe text fallback with preserved paragraphs
    clean = re.sub(r"<script[\s\S]*?</script>", "", html_text, flags=re.I)
    clean = re.sub(r"<style[\s\S]*?</style>", "", clean, flags=re.I)
    clean = re.sub(r"<(?:p|div|br|h[1-6]|li)[^>]*>", "\n", clean, flags=re.I)
    clean = re.sub(r"<[^>]+>", " ", clean)
    clean = re.sub(r"[ \t]+", " ", clean)
    clean = re.sub(r"\n{3,}", "\n\n", clean).strip()
    return clean[:20000] if clean else "Failed to parse page content."


def _extract_site_navigation(html_text: str, base_url: str = "", _soup: Any = None) -> list:
    """
    Extracts structured navigation tree (guides, chapters, pages) from
    documentation sidebars (e.g. Docusaurus, Astro Starlight, VitePress, MkDocs, GitBook).
    """
    if not html_text and _soup is None:
        return []

    try:
        from bs4 import BeautifulSoup
        soup = _soup if _soup is not None else BeautifulSoup(html_text, "html.parser")

        # Locate documentation sidebar container, excluding right-hand TOCs
        sidebar = None
        for cand in soup.find_all(["nav", "aside", "div"], class_=re.compile(r"sidebar|theme-doc-sidebar|menu|docs-nav", re.I)):
            classes = cand.get("class", [])
            cls_str = " ".join(classes) if isinstance(classes, list) else str(classes)
            if any(w in cls_str.lower() for w in ["right-sidebar", "toc", "table-of-contents"]):
                continue
            if cand.find_all("a", href=True):
                sidebar = cand
                break

        if not sidebar:
            sidebar = (
                soup.find("nav", attrs={"aria-label": re.compile(r"docs|sidebar|menu|navigation|main", re.I)})
                or soup.find(id=re.compile(r"sidebar|doc-sidebar|docs-sidebar|menu", re.I))
                or soup.find("aside", class_=re.compile(r"sidebar", re.I))
            )

        if not sidebar:
            return []

        def get_li_title_and_href(li, nested_list):
            collapsible = li.find(class_=re.compile(r"collapsible|header", re.I))
            search_scope = collapsible if collapsible else li

            a = search_scope.find("a")
            if a and (not nested_list or a not in nested_list.find_all("a")):
                return a.get_text(strip=True), a.get("href", "").strip()

            span_or_btn = search_scope.find(["button", "span", "div"], class_=re.compile(r"category|label|title|link|sublist", re.I))
            if span_or_btn and (not nested_list or span_or_btn not in nested_list.find_all(span_or_btn.name)):
                return span_or_btn.get_text(strip=True), ""

            return "", ""

        def parse_items(container, depth=0):
            if depth > 4 or not container:
                return []
            items = []
            lis = container.find_all("li", recursive=False)
            if not lis and depth == 0:
                top_ul = container.find(["ul", "ol"])
                if top_ul:
                    lis = top_ul.find_all("li", recursive=False)

            for li in lis:
                # Handle Astro Starlight / HTML5 <details><summary> categories
                details = li.find("details")
                if details and details.find("summary"):
                    summary = details.find("summary")
                    title = summary.get_text(strip=True)
                    nested_list = details.find(["ul", "ol"])
                    children = parse_items(nested_list, depth + 1) if nested_list else []
                    if title and (children or details.find("a")):
                        items.append({"title": title, "children": children})
                    continue

                nested_list = li.find(["ul", "ol"])
                title, href = get_li_title_and_href(li, nested_list)

                if not title:
                    continue

                if any(w in title.lower() for w in ["skip to", "search", "ctrl k", "edit this page", "github", "discord", "twitter", "linkedin", "stars"]):
                    continue

                full_url = urljoin(base_url, href) if href and not href.startswith("#") else ""

                children = parse_items(nested_list, depth + 1) if nested_list else []

                node = {"title": title}
                if full_url:
                    node["url"] = full_url
                if children:
                    node["children"] = children

                if full_url or children:
                    items.append(node)

            return items

        return parse_items(sidebar)[:80]
    except Exception as e:
        logger.debug(f"Navigation extraction notice: {e}")
        return []


def _parse_html_doc_sync(raw_text: str, base_url: str = "") -> tuple:
    """
    Single-pass HTML parser that constructs BeautifulSoup once to extract both
    the site navigation tree and the cleaned article Markdown.
    Designed to run via asyncio.to_thread so large HTML pages do not block the event loop.
    """
    soup = None
    try:
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(raw_text, "html.parser")
    except Exception:
        pass
    nav_tree = _extract_site_navigation(raw_text, base_url=base_url, _soup=soup)
    md_body = _clean_html_to_markdown(raw_text, base_url=base_url, _soup=soup)
    return nav_tree, md_body


def _clean_github_markdown(markdown_text: str, owner: str, repo: str, default_branch: str = "main") -> str:
    """
    Cleans and normalizes raw GitHub markdown:
    1. Preserves fenced code blocks from modification.
    2. Rebases relative image and link URLs to GitHub's raw and blob base URLs.
    3. Resolves <picture> tags (selecting dark theme asset if available) to markdown images.
    4. Converts HTML <img> tags to markdown images.
    5. Converts HTML <a> tags to markdown links.
    6. Converts HTML headings <h1-h6> to markdown headings.
    7. Strips HTML layout wrapper tags (<p align="center">, <div align="center">, <center>, <span>, etc.).
    8. Strips HTML comments (<!-- ... -->).
    9. Normalizes excess whitespace and newlines.
    """
    if not markdown_text:
        return ""

    raw_base = f"https://raw.githubusercontent.com/{owner}/{repo}/{default_branch}/"
    web_base = f"https://github.com/{owner}/{repo}/blob/{default_branch}/"

    def _resolve_gh_url(u: str, is_image: bool = False) -> str:
        u = u.strip()
        if not u or u.startswith(("http://", "https://", "data:", "#", "mailto:", "//")):
            return u
        clean = re.sub(r"^\.?\/+", "", u)
        return f"{raw_base}{clean}" if is_image else f"{web_base}{clean}"

    def _clean_segment(text: str) -> str:
        # Strip HTML comments
        text = re.sub(r"<!--[\s\S]*?-->", "", text)

        # Resolve <picture> tags
        def _replace_picture(m):
            body = m.group(1)
            dark_m = re.search(
                r"<source[^>]+(?:media=['\"][^'\"]*dark[^'\"]*['\"][^>]+srcset=['\"]([^'\"]+)['\"]|srcset=['\"]([^'\"]+)['\"][^>]+media=['\"][^'\"]*dark[^'\"]*['\"])",
                body,
                re.I
            )
            if dark_m:
                src = dark_m.group(1) or dark_m.group(2)
            else:
                src_m = re.search(r"<(?:source|img)[^>]+(?:srcset|src)=['\"]([^'\"]+)['\"]", body, re.I)
                src = src_m.group(1) if src_m else ""
            if src:
                alt_m = re.search(r"alt=['\"]([^'\"]*)['\"]", body, re.I)
                alt = alt_m.group(1) if alt_m else "Logo"
                return f"![{alt}]({_resolve_gh_url(src, is_image=True)})"
            return ""

        text = re.sub(r"<picture[^>]*>([\s\S]*?)<\/picture>", _replace_picture, text, flags=re.I)

        # Convert HTML <img> tags
        def _replace_img(m):
            tag = m.group(0)
            src_m = re.search(r"src=['\"]([^'\"]+)['\"]", tag, re.I)
            if not src_m:
                return ""
            src = _resolve_gh_url(src_m.group(1), is_image=True)
            alt_m = re.search(r"alt=['\"]([^'\"]*)['\"]", tag, re.I)
            alt = alt_m.group(1) if alt_m else "image"
            return f"![{alt}]({src})"

        text = re.sub(r"<img[^>]+>", _replace_img, text, flags=re.I)

        # Convert HTML <a> tags
        def _replace_a(m):
            href = m.group(1).strip()
            inner = m.group(2).strip()
            resolved_href = _resolve_gh_url(href, is_image=False)
            return f"[{inner}]({resolved_href})"

        text = re.sub(r"<a\s+[^>]*href=['\"]([^'\"]+)['\"][^>]*>([\s\S]*?)<\/a>", _replace_a, text, flags=re.I)

        # Strip HTML comments
        text = re.sub(r"<!--[\s\S]*?-->", "", text)

        # Replace non-breaking spaces and common encoded entities
        text = text.replace("&nbsp;", " ")

        # Convert HTML headings <h1-h6>
        for h in range(6, 0, -1):
            def _repl_h(m, lvl=h):
                hashes = "#" * lvl
                c = m.group(1).strip()
                return f"\n\n{hashes} {c}\n\n"
            text = re.sub(rf"<h{h}[^>]*>([\s\S]*?)<\/h{h}>", _repl_h, text, flags=re.I)

        # Line breaks and dividers
        text = re.sub(r"<br\s*\/?>", "\n", text, flags=re.I)
        text = re.sub(r"<hr\s*\/?>", "\n\n---\n\n", text, flags=re.I)

        # Strip layout container tags but preserve semantic elements like details and summary
        text = re.sub(r"<\/?(?:p|div|center|span|picture|source)[^>]*>", " ", text, flags=re.I)

        # Rebase relative URLs in existing markdown links and images
        def _replace_md_link(m):
            prefix = m.group(1)  # '![' or '['
            label = m.group(2)
            url = m.group(3).strip()
            resolved = _resolve_gh_url(url, is_image=prefix.startswith("!"))
            return f"{prefix}{label}]({resolved})"

        text = re.sub(r"(!?\[)([^\]]*)\]\(([^)]+)\)", _replace_md_link, text)
        return text

    # Split by fenced code blocks to preserve them intact
    parts = re.split(r"(```[\s\S]*?```)", markdown_text)
    cleaned_parts = []
    for part in parts:
        if part.startswith("```") and part.endswith("```"):
            cleaned_parts.append(part)
        else:
            cleaned = _clean_segment(part)
            # Normalize whitespace outside of code blocks
            norm_lines = "\n".join(line.strip() for line in cleaned.splitlines())
            cleaned_parts.append(norm_lines)

    result = "\n".join(cleaned_parts)
    result = re.sub(r"\n{3,}", "\n\n", result).strip()
    return result


async def _get_github_auth_token(owner: str, repo: str) -> Optional[str]:
    full_name = f"{owner}/{repo}"
    token = None
    try:
        from app.config import settings
        token = getattr(settings, "GITHUB_TOKEN", None)
        from app.integrations.github_client import github_client
        if not token and github_client.token:
            token = github_client.token
        from app.integrations.manager import integration_manager
        vault_token = await integration_manager.get_github_token_for_repo(f"https://github.com/{full_name}")
        if vault_token:
            token = vault_token
        if not token:
            import shutil
            import subprocess
            if shutil.which("gh"):
                try:
                    gh_res = subprocess.run(["gh", "auth", "token"], capture_output=True, text=True, timeout=2)
                    if gh_res.returncode == 0 and gh_res.stdout.strip():
                        token = gh_res.stdout.strip()
                except Exception:
                    pass
    except Exception as e:
        logger.debug(f"GitHub token lookup notice for {owner}/{repo}: {e}")
    return token


async def _fetch_github_repo_info(owner: str, repo: str) -> Dict[str, Any]:
    """
    Fetches GitHub repository information and README markdown with Vault token support.
    """
    import asyncio
    token = await _get_github_auth_token(owner, repo)

    headers = {
        "User-Agent": "Cyclode-Workstation/1.0",
        "Accept": "application/vnd.github.v3+json"
    }
    if token:
        headers["Authorization"] = f"token {token}"

    repo_url = f"https://api.github.com/repos/{owner}/{repo}"
    readme_api_url = f"https://api.github.com/repos/{owner}/{repo}/readme"
    readme_headers = dict(headers)
    readme_headers["Accept"] = "application/vnd.github.raw+json"

    async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
        repo_data: Dict[str, Any] = {}
        readme_md: Optional[str] = None

        r_meta, r_readme = await asyncio.gather(
            client.get(repo_url, headers=headers),
            client.get(readme_api_url, headers=readme_headers),
            return_exceptions=True
        )

        if not isinstance(r_meta, Exception) and r_meta.status_code == 200:
            try:
                repo_data = r_meta.json()
            except Exception as e:
                logger.debug(f"GitHub API metadata notice: {e}")

        if not isinstance(r_readme, Exception) and r_readme.status_code == 200 and r_readme.text.strip():
            readme_md = r_readme.text

        # Fallback to public raw URLs if API didn't return
        if not readme_md:
            readme_urls = [
                f"https://raw.githubusercontent.com/{owner}/{repo}/HEAD/README.md",
                f"https://raw.githubusercontent.com/{owner}/{repo}/main/README.md",
                f"https://raw.githubusercontent.com/{owner}/{repo}/master/README.md",
                f"https://raw.githubusercontent.com/{owner}/{repo}/HEAD/readme.md",
            ]
            for ru in readme_urls:
                try:
                    r = await client.get(ru, headers=headers)
                    if r.status_code == 200 and r.text.strip():
                        readme_md = r.text
                        break
                except Exception:
                    continue

        title = repo_data.get("full_name") or f"{owner}/{repo}"
        description = repo_data.get("description") or "GitHub Repository"
        default_branch = repo_data.get("default_branch", "main")

        if not readme_md:
            readme_md = f"# {title}\n\n{description}\n\nVisit [GitHub Repository]({repo_data.get('html_url', f'https://github.com/{owner}/{repo}')}) for more details."
        else:
            readme_md = _clean_github_markdown(readme_md, owner, repo, default_branch=default_branch)

        return {
            "type": "github",
            "url": f"https://github.com/{owner}/{repo}",
            "title": title,
            "repo_name": title,
            "description": description,
            "stars": repo_data.get("stargazers_count", 0),
            "forks": repo_data.get("forks_count", 0),
            "language": repo_data.get("language") or "Code",
            "license": repo_data.get("license", {}).get("spdx_id") if repo_data.get("license") else None,
            "clone_url": repo_data.get("clone_url") or f"https://github.com/{owner}/{repo}.git",
            "default_branch": default_branch,
            "content_markdown": readme_md
        }


def _parse_diff_to_files(diff_text: str) -> List[Dict[str, Any]]:
    """Parses unified diff text into structured file change records."""
    files: List[Dict[str, Any]] = []
    if not diff_text or not diff_text.strip():
        return files

    chunks = re.split(r"(^diff --git a/.*? b/.*?$)", diff_text, flags=re.MULTILINE)
    for i in range(1, len(chunks), 2):
        header = chunks[i].strip()
        body = chunks[i + 1] if i + 1 < len(chunks) else ""
        m = re.search(r"diff --git a/(.*?) b/(.*)$", header)
        if m:
            fname = m.group(2).strip()
            status = "modified"
            if "new file mode" in body:
                status = "added"
            elif "deleted file mode" in body:
                status = "deleted"

            patch_lines = [l for l in body.split("\n") if l.strip()]
            adds = sum(1 for l in patch_lines if l.startswith("+") and not l.startswith("+++"))
            dels = sum(1 for l in patch_lines if l.startswith("-") and not l.startswith("---"))

            files.append({
                "filename": fname,
                "status": status,
                "additions": adds,
                "deletions": dels,
                "changes": adds + dels,
                "patch": body.strip()
            })
    return files


async def _fetch_github_pr_info(owner: str, repo: str, pr_number: int) -> Dict[str, Any]:
    """
    Fetches GitHub Pull Request metadata, description, files list, commits, and unified diff concurrently.
    """
    import asyncio
    from app.integrations.github_client import github_client

    token = await _get_github_auth_token(owner, repo)
    headers = {
        "User-Agent": "Cyclode-Workstation/1.0",
        "Accept": "application/vnd.github.v3+json"
    }
    if token:
        headers["Authorization"] = f"token {token}"

    diff_headers = dict(headers)
    diff_headers["Accept"] = "application/vnd.github.v3.diff"

    pr_url = f"https://api.github.com/repos/{owner}/{repo}/pulls/{pr_number}"
    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
        r_pr, r_diff, r_files, r_commits, comments_res, auth_user_res = await asyncio.gather(
            client.get(pr_url, headers=headers),
            client.get(pr_url, headers=diff_headers),
            client.get(f"{pr_url}/files?per_page=100", headers=headers),
            client.get(f"{pr_url}/commits?per_page=50", headers=headers),
            github_client.list_pull_request_comments(owner, repo, pr_number, custom_token=token),
            github_client.get_authenticated_user(custom_token=token),
            return_exceptions=True
        )

        pr_data: Dict[str, Any] = {}
        if not isinstance(r_pr, Exception) and r_pr.status_code == 200:
            try:
                pr_data = r_pr.json()
            except Exception as e:
                logger.warning(f"Failed to parse GitHub PR {owner}/{repo}#{pr_number}: {e}")

        # Unified diff
        diff_text = ""
        if not isinstance(r_diff, Exception) and r_diff.status_code == 200:
            diff_text = r_diff.text

        if not diff_text:
            try:
                r_diff2 = await client.get(
                    f"https://patch-diff.githubusercontent.com/raw/{owner}/{repo}/pull/{pr_number}.diff",
                    headers=headers
                )
                if r_diff2.status_code == 200:
                    diff_text = r_diff2.text
            except Exception:
                pass

        # PR modified files list
        files_list: List[Dict[str, Any]] = []
        if not isinstance(r_files, Exception) and r_files.status_code == 200:
            try:
                for f in r_files.json():
                    files_list.append({
                        "filename": f.get("filename", ""),
                        "status": f.get("status", "modified"),
                        "additions": f.get("additions", 0),
                        "deletions": f.get("deletions", 0),
                        "changes": f.get("changes", 0),
                        "patch": f.get("patch", ""),
                        "raw_url": f.get("raw_url", ""),
                        "blob_url": f.get("blob_url", "")
                    })
            except Exception as e:
                logger.debug(f"Failed to parse PR files via API: {e}")

        # Fallback parse diff_text if files_list is empty
        if not files_list and diff_text:
            files_list = _parse_diff_to_files(diff_text)

        # PR commits list
        commits_list: List[Dict[str, Any]] = []
        if not isinstance(r_commits, Exception) and r_commits.status_code == 200:
            try:
                for c in r_commits.json():
                    commit_obj = c.get("commit", {})
                    author_obj = c.get("author") or {}
                    raw_msg = commit_obj.get("message", "")
                    lines = raw_msg.split("\n")
                    subject = lines[0].strip() if lines else ""
                    body = "\n".join(lines[1:]).strip() if len(lines) > 1 else ""
                    commits_list.append({
                        "sha": c.get("sha", ""),
                        "short_sha": (c.get("sha") or "")[:7],
                        "message": subject,
                        "body": body,
                        "full_message": raw_msg,
                        "author_name": commit_obj.get("author", {}).get("name") or author_obj.get("login") or "Unknown",
                        "author_login": author_obj.get("login", ""),
                        "author_avatar": author_obj.get("avatar_url", ""),
                        "date": commit_obj.get("author", {}).get("date", ""),
                        "html_url": c.get("html_url", "")
                    })
            except Exception as e:
                logger.debug(f"Failed to parse PR commits via API: {e}")

        comments_list: List[Dict[str, Any]] = comments_res if isinstance(comments_res, list) else []

        title = pr_data.get("title") or f"Pull Request #{pr_number}"
        user_login = pr_data.get("user", {}).get("login", "unknown")
        user_avatar = pr_data.get("user", {}).get("avatar_url", "")
        state = pr_data.get("state", "open")
        merged = pr_data.get("merged", False)
        status_str = "MERGED" if merged else state.upper()
        head_ref = pr_data.get("head", {}).get("ref", "")
        base_ref = pr_data.get("base", {}).get("ref", "main")
        html_url = pr_data.get("html_url") or f"https://github.com/{owner}/{repo}/pull/{pr_number}"
        raw_body = (pr_data.get("body") or "").strip()
        body = _clean_github_markdown(raw_body, owner, repo, default_branch=base_ref) if raw_body else ""
        additions = pr_data.get("additions", 0)
        deletions = pr_data.get("deletions", 0)
        changed_files = pr_data.get("changed_files", len(files_list))
        clean_body = body.strip() if body and body.strip() else "*No description provided.*"
        overview_md = clean_body

        # Build full markdown as fallback for non-tabbed readers
        full_md_parts = [clean_body]
        if diff_text.strip():
            full_md_parts.append("\n## Unified Diff\n")
            full_md_parts.append(f"```diff\n{diff_text.strip()}\n```\n")
        full_md = "\n".join(full_md_parts).strip()

        # Determine viewer user and author relationship
        viewer_login = None
        viewer_is_author = False
        if isinstance(auth_user_res, dict) and auth_user_res:
            viewer_login = auth_user_res.get("login")
            if viewer_login and user_login:
                viewer_is_author = (viewer_login.lower() == user_login.lower())

        # Fetch check-runs for head SHA or branch
        head_sha = pr_data.get("head", {}).get("sha", "") if isinstance(pr_data.get("head"), dict) else ""
        checks_data = {"total_count": 0, "conclusion": "unknown", "check_runs": []}
        try:
            check_target = head_sha or head_ref
            if check_target:
                checks_data = await github_client.get_check_runs(owner, repo, check_target, custom_token=token)
        except Exception as e:
            logger.debug(f"Failed to fetch check-runs in reader: {e}")

        # Compute review verdict from comments/reviews
        latest_review_by_user = {}
        for c in comments_list:
            if c.get("type") == "review":
                user = c.get("author") or "unknown"
                r_state = (c.get("review_state") or "COMMENTED").upper()
                if r_state in ("APPROVED", "CHANGES_REQUESTED", "DISMISSED", "COMMENTED"):
                    latest_review_by_user[user] = r_state
        
        review_verdict = "PENDING"
        if any(s == "CHANGES_REQUESTED" for s in latest_review_by_user.values()):
            review_verdict = "CHANGES_REQUESTED"
        elif any(s == "APPROVED" for s in latest_review_by_user.values()):
            review_verdict = "APPROVED"
        elif latest_review_by_user:
            review_verdict = "COMMENTED"

        return {
            "type": "github",
            "is_pr": True,
            "url": html_url,
            "title": f"{owner}/{repo} #{pr_number}: {title}",
            "repo_name": f"{owner}/{repo}",
            "pr_number": pr_number,
            "pr_title": title,
            "state": status_str,
            "mergeable": pr_data.get("mergeable"),
            "mergeable_state": pr_data.get("mergeable_state", "unknown"),
            "is_draft": pr_data.get("draft", False),
            "author": user_login,
            "author_avatar": user_avatar,
            "viewer_login": viewer_login,
            "viewer_is_author": viewer_is_author,
            "head_branch": head_ref,
            "head_sha": head_sha,
            "base_branch": base_ref,
            "checks": checks_data,
            "review_verdict": review_verdict,
            "additions": additions,
            "deletions": deletions,
            "changed_files_count": changed_files,
            "description": f"Pull Request #{pr_number} ({status_str}) - {title}",
            "clone_url": f"https://github.com/{owner}/{repo}.git",
            "default_branch": base_ref,
            "overview_markdown": overview_md,
            "content_markdown": overview_md,
            "diff_text": diff_text,
            "files": files_list,
            "commits": commits_list,
            "comments": comments_list,
            "comments_count": len(comments_list)
        }


async def _fetch_github_commit_info(owner: str, repo: str, sha: str) -> Dict[str, Any]:
    """
    Fetches GitHub Commit metadata, commit message body, author, and changed files with patches.
    """
    token = await _get_github_auth_token(owner, repo)
    headers = {
        "User-Agent": "Cyclode-Workstation/1.0",
        "Accept": "application/vnd.github.v3+json"
    }
    if token:
        headers["Authorization"] = f"token {token}"

    commit_url = f"https://api.github.com/repos/{owner}/{repo}/commits/{sha}"
    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
        try:
            r = await client.get(commit_url, headers=headers)
            if r.status_code == 200:
                data = r.json()
                commit_obj = data.get("commit", {})
                author_obj = data.get("author") or {}
                raw_msg = commit_obj.get("message", "")
                lines = raw_msg.split("\n")
                subject = lines[0].strip() if lines else ""
                body = "\n".join(lines[1:]).strip() if len(lines) > 1 else ""
                files = []
                for f in data.get("files", []):
                    files.append({
                        "filename": f.get("filename", ""),
                        "status": f.get("status", "modified"),
                        "additions": f.get("additions", 0),
                        "deletions": f.get("deletions", 0),
                        "changes": f.get("changes", 0),
                        "patch": f.get("patch", ""),
                        "raw_url": f.get("raw_url", ""),
                        "blob_url": f.get("blob_url", "")
                    })
                
                md_content = f"# Commit `{sha[:7]}`: {subject}\n\n**Author**: @{author_obj.get('login') or commit_obj.get('author', {}).get('name') or 'Unknown'} | **Date**: {commit_obj.get('author', {}).get('date', '')}\n\n{body}\n"
                return {
                    "type": "github",
                    "is_commit": True,
                    "url": data.get("html_url", f"https://github.com/{owner}/{repo}/commit/{sha}"),
                    "sha": sha,
                    "short_sha": sha[:7],
                    "message": subject,
                    "body": body,
                    "full_message": raw_msg,
                    "author_name": commit_obj.get("author", {}).get("name") or author_obj.get("login") or "Unknown",
                    "author_login": author_obj.get("login", ""),
                    "author_avatar": author_obj.get("avatar_url", ""),
                    "date": commit_obj.get("author", {}).get("date", ""),
                    "html_url": data.get("html_url", f"https://github.com/{owner}/{repo}/commit/{sha}"),
                    "stats": data.get("stats", {}),
                    "files": files,
                    "title": f"{owner}/{repo}@{sha[:7]}: {subject}",
                    "content_markdown": md_content,
                    "overview_markdown": md_content
                }
        except Exception as e:
            logger.warning(f"Failed to fetch commit {owner}/{repo}@{sha}: {e}")

    return {
        "type": "github",
        "is_commit": True,
        "sha": sha,
        "short_sha": sha[:7],
        "message": f"Commit {sha[:7]}",
        "body": "",
        "full_message": f"Commit {sha[:7]}",
        "files": [],
        "content_markdown": f"# Commit `{sha[:7]}`\n\nNo details available."
    }


async def _fetch_github_issue_info(owner: str, repo: str, issue_number: int) -> Dict[str, Any]:
    """
    Fetches GitHub Issue metadata, description, and comments.
    """
    token = await _get_github_auth_token(owner, repo)
    headers = {
        "User-Agent": "Cyclode-Workstation/1.0",
        "Accept": "application/vnd.github.v3+json"
    }
    if token:
        headers["Authorization"] = f"token {token}"

    issue_url = f"https://api.github.com/repos/{owner}/{repo}/issues/{issue_number}"
    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
        issue_data: Dict[str, Any] = {}
        try:
            r = await client.get(issue_url, headers=headers)
            if r.status_code == 200:
                issue_data = r.json()
        except Exception as e:
            logger.warning(f"Failed to fetch issue {owner}/{repo}#{issue_number}: {e}")

        # If it's a pull request returned by the issues endpoint
        if "pull_request" in issue_data:
            return await _fetch_github_pr_info(owner, repo, issue_number)

        comments = []
        try:
            r_comments = await client.get(f"{issue_url}/comments", headers=headers)
            if r_comments.status_code == 200:
                comments = r_comments.json()
        except Exception:
            pass

        title = issue_data.get("title") or f"Issue #{issue_number}"
        user_login = issue_data.get("user", {}).get("login", "unknown")
        state = issue_data.get("state", "open").upper()
        raw_body = (issue_data.get("body") or "").strip()
        body = _clean_github_markdown(raw_body, owner, repo) if raw_body else ""
        html_url = issue_data.get("html_url") or f"https://github.com/{owner}/{repo}/issues/{issue_number}"
        labels = [l.get("name") for l in issue_data.get("labels", []) if isinstance(l, dict) and l.get("name")]

        meta_parts = [f"**Status**: `{state}`", f"**Author**: @{user_login}"]
        if labels:
            meta_parts.append(f"**Labels**: {', '.join(f'`{lb}`' for lb in labels)}")

        md_parts = [
            f"# Issue #{issue_number}: {title}\n",
            f"{' | '.join(meta_parts)}\n",
            "## Description\n",
            f"{body if body else '*No description provided.*'}\n"
        ]

        if comments:
            md_parts.append(f"## Discussion ({len(comments)})\n")
            for c in comments:
                c_user = c.get("user", {}).get("login", "unknown")
                c_raw_body = (c.get("body") or "").strip()
                c_body = _clean_github_markdown(c_raw_body, owner, repo) if c_raw_body else ""
                c_date = (c.get("created_at") or "")[:10]
                md_parts.append(f"### @{c_user} ({c_date})\n\n{c_body}\n")

        full_md = "\n".join(md_parts).strip()

        return {
            "type": "github",
            "url": html_url,
            "title": f"{owner}/{repo} #{issue_number}: {title}",
            "repo_name": f"{owner}/{repo}",
            "description": f"Issue #{issue_number} ({state}) - {title}",
            "clone_url": f"https://github.com/{owner}/{repo}.git",
            "content_markdown": full_md
        }


async def _fetch_linear_issue_info(issue_key: str, original_url: str) -> Dict[str, Any]:
    from app.integrations.linear_client import linear_client
    issue = await linear_client.get_issue(issue_key)
    if not issue:
        content_markdown = f"""# Linear Issue: {issue_key}

Unable to retrieve ticket `{issue_key}` from Linear.

- Configure your Linear API key in **Settings &rarr; Integrations** to view and sync tickets directly within Cyclode.
- You can [open {issue_key} directly on Linear.app]({original_url}).
"""
        return {
            "type": "linear",
            "url": original_url,
            "title": f"Linear: {issue_key}",
            "domain": "linear.app",
            "description": f"Linear Issue {issue_key} (Unretrieved)",
            "content_markdown": content_markdown,
            "headings": [{"level": 1, "text": f"Linear: {issue_key}"}],
            "is_linear": True,
            "linear_issue": None,
            "read_time_minutes": 1,
            "cached": False
        }

    identifier = issue.get("identifier") or issue_key
    title_text = issue.get("title") or "Linear Ticket"
    title = f"{identifier}: {title_text}"
    state = issue.get("state", {}).get("name", "Todo")
    priority = issue.get("priorityLabel") or "Medium"
    assignee = issue.get("assignee", {}).get("name") or "Unassigned"
    desc = issue.get("description") or "*No description provided.*"

    comments_nodes = issue.get("comments", {})
    if isinstance(comments_nodes, dict):
        comments_list = comments_nodes.get("nodes", [])
    elif isinstance(comments_nodes, list):
        comments_list = comments_nodes
    else:
        comments_list = []

    comments_md = ""
    if comments_list:
        comments_md = "\n\n## Discussion & Comments\n\n" + "\n\n---\n\n".join([
            f"**{c.get('user', {}).get('name', 'Commenter')}** ({str(c.get('createdAt', ''))[:10]}):\n\n{c.get('body', '')}"
            for c in comments_list
        ])

    content_markdown = f"""# {title}

**Status:** `{state}` | **Priority:** `{priority}` | **Assignee:** @{assignee}
**Linear URL:** [{issue.get('url', original_url)}]({issue.get('url', original_url)})

## Description

{desc}
{comments_md}
"""

    return {
        "type": "linear",
        "url": issue.get("url", original_url),
        "title": title,
        "domain": "linear.app",
        "description": f"Linear Issue {identifier} ({state}) - {title_text}",
        "content_markdown": content_markdown,
        "headings": [{"level": 1, "text": title}, {"level": 2, "text": "Description"}],
        "is_linear": True,
        "linear_issue": issue,
        "read_time_minutes": max(1, len(content_markdown.split()) // 200),
        "cached": False
    }


async def _fetch_arxiv_paper_info(arxiv_id: str, original_url: str) -> Dict[str, Any]:
    """
    Fetches structured metadata and abstract for an arXiv paper, synthesizing
    rich markdown and canonical PDF streaming URLs.
    """
    clean_id = re.sub(r"^arxiv:\s*", "", arxiv_id, flags=re.IGNORECASE).strip()
    clean_id = clean_id.replace(".pdf", "").strip()

    title = f"arXiv:{clean_id}"
    authors: List[str] = []
    abstract = ""
    published = ""
    updated = ""
    categories: List[str] = []
    comment = ""
    doi = ""

    api_url = f"https://export.arxiv.org/api/query?id_list={clean_id}"
    headers = {
        "User-Agent": "CyclodeReader/1.0 (https://github.com/rubum/cyclode; mailto:support@cyclode.dev)",
        "Accept": "application/atom+xml,application/xml,text/xml",
    }

    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            resp = await client.get(api_url, headers=headers)
            if resp.status_code == 200 and resp.text:
                import xml.etree.ElementTree as ET
                root = ET.fromstring(resp.text)
                ns = {"atom": "http://www.w3.org/2005/Atom", "arxiv": "http://arxiv.org/schemas/atom"}
                entry = root.find("atom:entry", ns)
                if entry is not None:
                    title_elem = entry.find("atom:title", ns)
                    if title_elem is not None and title_elem.text:
                        title = re.sub(r"\s+", " ", title_elem.text).strip()

                    summary_elem = entry.find("atom:summary", ns)
                    if summary_elem is not None and summary_elem.text:
                        abstract = summary_elem.text.strip()

                    pub_elem = entry.find("atom:published", ns)
                    if pub_elem is not None and pub_elem.text:
                        published = pub_elem.text[:10]

                    upd_elem = entry.find("atom:updated", ns)
                    if upd_elem is not None and upd_elem.text:
                        updated = upd_elem.text[:10]

                    for a in entry.findall("atom:author", ns):
                        name_elem = a.find("atom:name", ns)
                        if name_elem is not None and name_elem.text:
                            authors.append(name_elem.text.strip())

                    for c in entry.findall("atom:category", ns):
                        term = c.attrib.get("term")
                        if term and term not in categories:
                            categories.append(term)

                    comm_elem = entry.find("arxiv:comment", ns)
                    if comm_elem is not None and comm_elem.text:
                        comment = comm_elem.text.strip()

                    doi_elem = entry.find("arxiv:doi", ns)
                    if doi_elem is not None and doi_elem.text:
                        doi = doi_elem.text.strip()
    except Exception as e:
        logger.warning(f"Error querying arXiv API for {clean_id}: {e}")

    # Fallback to HTML scraping if title/abstract not resolved
    if not abstract or title == f"arXiv:{clean_id}":
        abs_url = f"https://arxiv.org/abs/{clean_id}"
        try:
            async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as client:
                resp = await client.get(abs_url, headers={"User-Agent": "Mozilla/5.0"})
                if resp.status_code == 200:
                    html_text = resp.text
                    t_match = re.search(r'<meta\s+name="citation_title"\s+content="([^"]+)"', html_text)
                    if t_match:
                        title = t_match.group(1).strip()
                    if not authors:
                        authors = re.findall(r'<meta\s+name="citation_author"\s+content="([^"]+)"', html_text)
                    d_match = re.search(r'<meta\s+name="citation_date"\s+content="([^"]+)"', html_text)
                    if d_match:
                        published = d_match.group(1).strip()
                    ab_match = re.search(r'<blockquote\s+class="abstract[^"]*">\s*<span\s+class="descriptor">Abstract:</span>([\s\S]*?)</blockquote>', html_text)
                    if ab_match:
                        abstract = re.sub(r"<[^>]+>", "", ab_match.group(1)).strip()
        except Exception as e:
            logger.warning(f"Error scraping arXiv HTML for {clean_id}: {e}")

    canonical_abs_url = f"https://arxiv.org/abs/{clean_id}"
    canonical_pdf_url = f"https://arxiv.org/pdf/{clean_id}.pdf"
    proxy_pdf_url = f"/api/reader/proxy/pdf?url=https://arxiv.org/pdf/{clean_id}.pdf"

    # Synthesize rich executive Markdown overview
    md_lines = [
        f"# {title}",
        "",
        f"**arXiv Identifier:** [`arXiv:{clean_id}`]({canonical_abs_url}) · **PDF:** [Direct Download]({canonical_pdf_url})",
        "",
    ]
    if authors:
        md_lines.append(f"**Authors:** {', '.join(authors)}")
        md_lines.append("")
    if published:
        date_str = f"Published {published}" + (f" (Updated {updated})" if updated and updated != published else "")
        md_lines.append(f"**Date:** {date_str}")
        md_lines.append("")
    if categories:
        md_lines.append(f"**Subjects:** {', '.join([f'`{c}`' for c in categories])}")
        md_lines.append("")
    if comment:
        md_lines.append(f"**Comments:** *{comment}*")
        md_lines.append("")
    if doi:
        md_lines.append(f"**DOI:** [{doi}](https://doi.org/{doi})")
        md_lines.append("")

    md_lines.append("## Abstract")
    md_lines.append("")
    md_lines.append(abstract if abstract else "No abstract provided.")

    content_markdown = "\n".join(md_lines)

    return {
        "type": "arxiv",
        "url": canonical_abs_url,
        "title": title,
        "domain": "arxiv.org",
        "description": f"arXiv:{clean_id} - {title}",
        "arxiv_id": clean_id,
        "authors": authors,
        "published": published,
        "updated": updated,
        "categories": categories,
        "comment": comment,
        "doi": doi,
        "abstract": abstract,
        "pdf_url": proxy_pdf_url,
        "raw_pdf_url": canonical_pdf_url,
        "content_markdown": content_markdown,
        "overview_markdown": content_markdown,
    }


def _extract_snippet(text: str, query: str, max_chars: int = 220) -> str:
    if not text or not query:
        return ""
    lower_text = text.lower()
    lower_q = query.lower()
    idx = lower_text.find(lower_q)
    if idx == -1:
        lines = [line.strip() for line in text.split("\n") if line.strip() and not line.startswith("#")]
        candidate = " ".join(lines[:3])
        return candidate[:max_chars] + ("..." if len(candidate) > max_chars else "")

    half_window = max(10, (max_chars - len(query)) // 2)
    start = max(0, idx - half_window)
    end = min(len(text), idx + len(query) + half_window)
    prefix = "..." if start > 0 else ""
    suffix = "..." if end < len(text) else ""
    return f"{prefix}{text[start:end].replace(chr(10), ' ').strip()}{suffix}"


@router.get("/search")
async def search_doc_pages(
    q: str = Query(..., min_length=1, description="Search term or phrase"),
    domain: Optional[str] = Query(None, description="Filter by documentation domain, e.g. doc.arroyo.dev"),
    limit: int = Query(20, ge=1, le=50)
):
    """
    Full-text search across cached documentation pages with highlighted snippets.
    """
    clean_q = q.strip()
    if not clean_q:
        return {"query": q, "domain": domain, "total_results": 0, "results": []}

    try:
        async with async_session_factory() as session:
            conditions = [
                or_(
                    DocPageCacheModel.title.ilike(f"%{clean_q}%"),
                    DocPageCacheModel.content_markdown.ilike(f"%{clean_q}%")
                )
            ]
            if domain:
                clean_domain = domain.lower().strip()
                conditions.append(DocPageCacheModel.domain == clean_domain)

            stmt = (
                select(DocPageCacheModel)
                .where(and_(*conditions))
                .order_by(DocPageCacheModel.created_at.desc())
                .limit(limit)
            )
            res = await session.execute(stmt)
            pages = res.scalars().all()

            results = []
            for p in pages:
                snippet = _extract_snippet(p.content_markdown, clean_q)
                results.append({
                    "url": p.url,
                    "title": p.title,
                    "domain": p.domain,
                    "snippet": snippet
                })

            return {
                "query": clean_q,
                "domain": domain,
                "total_results": len(results),
                "results": results
            }
    except Exception as e:
        logger.warning(f"Error in doc search: {e}")
        return {"query": clean_q, "domain": domain, "total_results": 0, "results": []}


_READER_MEMORY_CACHE: Dict[str, Any] = {}
_READER_CACHE_TTL_SEC = 600.0


def _get_cached_reader_result(url: str) -> Optional[Dict[str, Any]]:
    import time
    entry = _READER_MEMORY_CACHE.get(url)
    if not entry:
        return None
    ts, payload = entry
    if time.monotonic() - ts > _READER_CACHE_TTL_SEC:
        _READER_MEMORY_CACHE.pop(url, None)
        return None
    return payload


def _set_cached_reader_result(url: str, payload: Dict[str, Any]) -> None:
    import time
    if len(_READER_MEMORY_CACHE) >= 256:
        oldest_key = next(iter(_READER_MEMORY_CACHE))
        _READER_MEMORY_CACHE.pop(oldest_key, None)
    _READER_MEMORY_CACHE[url] = (time.monotonic(), payload)


@router.get("")
async def get_url_reader(
    url: str = Query(..., description="Target URL to read"),
    refresh: bool = Query(False, description="Force fresh network fetch bypassing cache")
):
    """
    Returns clean, structured reader markdown and metadata for an external URL.
    Detects GitHub repositories to provide rich README and metadata views.
    """
    import asyncio
    clean_url = url.strip()
    if clean_url.startswith("blob:"):
        return {
            "type": "web",
            "url": clean_url,
            "title": "Local Document",
            "description": "Browser in-memory document",
            "content_markdown": "### Local Document\n\nThis is a client-side in-memory browser document (`blob:`).",
        }

    if not clean_url.startswith(("http://", "https://")):
        clean_url = "https://" + clean_url

    if not refresh:
        mem_hit = _get_cached_reader_result(clean_url)
        if mem_hit is not None:
            return mem_hit

    parsed = urlparse(clean_url)
    hostname = (parsed.hostname or "").lower()

    # Check for arXiv paper URL or identifier (e.g. arxiv.org/abs/2401.12345, arxiv.org/pdf/2401.12345, or arxiv:2401.12345)
    arxiv_match = re.search(
        r"(?:arxiv\.org/(?:abs|pdf|html)/|arxiv:)(\d{4}\.\d{4,5}(?:v\d+)?|[a-zA-Z\-]+/\d{7})",
        clean_url,
        re.IGNORECASE
    )
    if arxiv_match:
        arxiv_id = arxiv_match.group(1)
        try:
            arxiv_info = await _fetch_arxiv_paper_info(arxiv_id, clean_url)
            try:
                page_id = hashlib.sha256(clean_url.encode("utf-8")).hexdigest()[:32]
                async with async_session_factory() as session:
                    stmt = select(DocPageCacheModel).where(DocPageCacheModel.id == page_id)
                    res = await session.execute(stmt)
                    existing = res.scalars().first()
                    if existing:
                        existing.title = arxiv_info.get("title", f"arXiv:{arxiv_id}")
                        existing.content_markdown = arxiv_info.get("content_markdown", "")
                        existing.domain = "arxiv.org"
                    else:
                        new_page = DocPageCacheModel(
                            id=page_id,
                            url=clean_url,
                            domain="arxiv.org",
                            title=arxiv_info.get("title", f"arXiv:{arxiv_id}"),
                            content_markdown=arxiv_info.get("content_markdown", ""),
                            headings_json="[]"
                        )
                        session.add(new_page)
                    await session.commit()
            except Exception as e:
                logger.debug(f"arXiv doc caching notice: {e}")
            _set_cached_reader_result(clean_url, arxiv_info)
            return arxiv_info
        except Exception as e:
            logger.warning(f"Error resolving arXiv paper {arxiv_id}: {e}")

    # Check for direct PDF URL extension
    if parsed.path.lower().endswith(".pdf"):
        doc_title = parsed.path.split("/")[-1] or hostname
        proxy_pdf = f"/api/reader/proxy/pdf?url={quote(clean_url)}"
        return {
            "type": "pdf",
            "url": clean_url,
            "title": doc_title,
            "domain": hostname,
            "description": f"PDF Document from {hostname}",
            "pdf_url": proxy_pdf,
            "raw_pdf_url": clean_url,
            "content_markdown": f"# {doc_title}\n\n[Open Direct PDF]({clean_url})\n\n*(PDF document loaded in embedded viewport)*",
        }

    # Check for direct Word document URL extension (.docx / .doc)
    if parsed.path.lower().endswith((".docx", ".doc")):
        doc_title = parsed.path.split("/")[-1] or hostname
        try:
            async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
                res = await client.get(clean_url)
                if res.status_code == 200:
                    import tempfile
                    with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as tmp_f:
                        tmp_f.write(res.content)
                        tmp_path = Path(tmp_f.name)
                    try:
                        from app.api.tasks import _parse_docx_native
                        parsed_docx = _parse_docx_native(tmp_path)
                        return {
                            "type": "web",
                            "url": clean_url,
                            "title": doc_title,
                            "domain": hostname,
                            "description": f"Word Document from {hostname}",
                            "content_markdown": parsed_docx.get("text", ""),
                            "html": parsed_docx.get("html", ""),
                        }
                    finally:
                        if tmp_path.exists():
                            tmp_path.unlink()
        except Exception as e:
            logger.warning(f"Error resolving docx document {clean_url}: {e}")

    # Check for Linear issue URL: https://linear.app/<org>/issue/PD-1236/... or ticket key
    if "linear.app" in hostname:
        ticket_match = re.search(r"([a-zA-Z]{2,10}-\d+)", parsed.path)
        if ticket_match:
            issue_key = ticket_match.group(1).upper()
            try:
                linear_info = await _fetch_linear_issue_info(issue_key, clean_url)
                try:
                    page_id = hashlib.sha256(clean_url.encode("utf-8")).hexdigest()[:32]
                    async with async_session_factory() as session:
                        stmt = select(DocPageCacheModel).where(DocPageCacheModel.id == page_id)
                        res = await session.execute(stmt)
                        existing = res.scalars().first()
                        if existing:
                            existing.title = linear_info.get("title", f"Linear: {issue_key}")
                            existing.content_markdown = linear_info.get("content_markdown", "")
                            existing.domain = "linear.app"
                        else:
                            new_page = DocPageCacheModel(
                                id=page_id,
                                url=clean_url,
                                domain="linear.app",
                                title=linear_info.get("title", f"Linear: {issue_key}"),
                                content_markdown=linear_info.get("content_markdown", ""),
                                headings_json=json.dumps(linear_info.get("headings", []))
                            )
                            session.add(new_page)
                        await session.commit()
                except Exception as e:
                    logger.debug(f"Linear doc caching notice: {e}")
                if "Unable to retrieve ticket" not in linear_info.get("content_markdown", ""):
                    _set_cached_reader_result(clean_url, linear_info)
                return linear_info
            except Exception as e:
                logger.warning(f"Error resolving Linear ticket {issue_key}: {e}")

    # Check for GitHub repository, PR, or Issue URL
    if "github.com" in hostname:
        path_parts = [p for p in parsed.path.strip("/").split("/") if p]
        if len(path_parts) >= 2 and path_parts[0].lower() not in RESERVED_GITHUB_PATHS:
            owner = path_parts[0]
            repo = path_parts[1].replace(".git", "")

            # Check for GitHub Pull Request URL: /owner/repo/pull/123 or /owner/repo/pulls/123
            if len(path_parts) >= 4 and path_parts[2].lower() in ("pull", "pulls") and path_parts[3].isdigit():
                pr_number = int(path_parts[3])
                try:
                    gh_info = await _fetch_github_pr_info(owner, repo, pr_number)
                    try:
                        page_id = hashlib.sha256(gh_info["url"].encode("utf-8")).hexdigest()[:32]
                        async with async_session_factory() as session:
                            stmt = select(DocPageCacheModel).where(DocPageCacheModel.id == page_id)
                            res = await session.execute(stmt)
                            existing = res.scalars().first()
                            if existing:
                                existing.title = gh_info.get("title", f"{owner}/{repo} #{pr_number}")
                                existing.content_markdown = gh_info.get("content_markdown", "")
                                existing.domain = "github.com"
                            else:
                                new_page = DocPageCacheModel(
                                    id=page_id,
                                    url=gh_info["url"],
                                    domain="github.com",
                                    title=gh_info.get("title", f"{owner}/{repo} #{pr_number}"),
                                    content_markdown=gh_info.get("content_markdown", ""),
                                    headings_json="[]"
                                )
                                session.add(new_page)
                            await session.commit()
                    except Exception as e:
                        logger.debug(f"GitHub PR doc caching notice: {e}")
                    _set_cached_reader_result(clean_url, gh_info)
                    return gh_info
                except Exception as e:
                    logger.warning(f"Error resolving GitHub PR {owner}/{repo}#{pr_number}: {e}")

            # Check for GitHub Issue URL: /owner/repo/issues/123 or /owner/repo/issue/123
            elif len(path_parts) >= 4 and path_parts[2].lower() in ("issue", "issues") and path_parts[3].isdigit():
                issue_number = int(path_parts[3])
                try:
                    gh_info = await _fetch_github_issue_info(owner, repo, issue_number)
                    try:
                        page_id = hashlib.sha256(gh_info["url"].encode("utf-8")).hexdigest()[:32]
                        async with async_session_factory() as session:
                            stmt = select(DocPageCacheModel).where(DocPageCacheModel.id == page_id)
                            res = await session.execute(stmt)
                            existing = res.scalars().first()
                            if existing:
                                existing.title = gh_info.get("title", f"{owner}/{repo} #{issue_number}")
                                existing.content_markdown = gh_info.get("content_markdown", "")
                                existing.domain = "github.com"
                            else:
                                new_page = DocPageCacheModel(
                                    id=page_id,
                                    url=gh_info["url"],
                                    domain="github.com",
                                    title=gh_info.get("title", f"{owner}/{repo} #{issue_number}"),
                                    content_markdown=gh_info.get("content_markdown", ""),
                                    headings_json="[]"
                                )
                                session.add(new_page)
                            await session.commit()
                    except Exception as e:
                        logger.debug(f"GitHub issue doc caching notice: {e}")
                    _set_cached_reader_result(clean_url, gh_info)
                    return gh_info
                except Exception as e:
                    logger.warning(f"Error resolving GitHub Issue {owner}/{repo}#{issue_number}: {e}")

            # Check for GitHub Commit URL: /owner/repo/commit/sha
            elif len(path_parts) >= 4 and path_parts[2].lower() in ("commit", "commits"):
                commit_sha = path_parts[3]
                try:
                    commit_info = await _fetch_github_commit_info(owner, repo, commit_sha)
                    _set_cached_reader_result(clean_url, commit_info)
                    return commit_info
                except Exception as e:
                    logger.warning(f"Error resolving GitHub Commit {owner}/{repo}@{commit_sha}: {e}")

            # Fallback to GitHub Repository README
            try:
                gh_info = await _fetch_github_repo_info(owner, repo)
                try:
                    page_id = hashlib.sha256(gh_info["url"].encode("utf-8")).hexdigest()[:32]
                    async with async_session_factory() as session:
                        stmt = select(DocPageCacheModel).where(DocPageCacheModel.id == page_id)
                        res = await session.execute(stmt)
                        existing = res.scalars().first()
                        if existing:
                            existing.title = gh_info.get("title", f"{owner}/{repo}")
                            existing.content_markdown = gh_info.get("content_markdown", "")
                            existing.domain = "github.com"
                        else:
                            new_page = DocPageCacheModel(
                                id=page_id,
                                url=gh_info["url"],
                                domain="github.com",
                                title=gh_info.get("title", f"{owner}/{repo}"),
                                content_markdown=gh_info.get("content_markdown", ""),
                                headings_json="[]"
                            )
                            session.add(new_page)
                        await session.commit()
                except Exception as e:
                    logger.debug(f"GitHub doc caching notice: {e}")
                _set_cached_reader_result(clean_url, gh_info)
                return gh_info
            except Exception as e:
                logger.warning(f"Error resolving GitHub repo {owner}/{repo}: {e}")

    # Standard Web Documentation Reader: check persistent DB cache first when not refreshing
    page_id = hashlib.sha256(clean_url.encode("utf-8")).hexdigest()[:32]
    if not refresh:
        try:
            async with async_session_factory() as session:
                stmt = select(DocPageCacheModel).where(DocPageCacheModel.id == page_id)
                res = await session.execute(stmt)
                cached_doc = res.scalars().first()
                if cached_doc and cached_doc.content_markdown:
                    nav_tree = []
                    page_desc = ""
                    if cached_doc.headings_json:
                        try:
                            parsed_meta = json.loads(cached_doc.headings_json)
                            if isinstance(parsed_meta, dict):
                                nav_tree = parsed_meta.get("navigation", [])
                                page_desc = parsed_meta.get("description", "")
                        except Exception:
                            pass
                    db_hit_payload = {
                        "type": "web",
                        "url": clean_url,
                        "title": cached_doc.title or hostname,
                        "description": page_desc,
                        "content_markdown": cached_doc.content_markdown,
                        "navigation": nav_tree
                    }
                    _set_cached_reader_result(clean_url, db_hit_payload)
                    return db_hit_payload
        except Exception as e:
            logger.debug(f"DB doc cache lookup notice: {e}")

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }

    try:
        async with httpx.AsyncClient(timeout=12.0, follow_redirects=True) as client:
            resp = await client.get(clean_url, headers=headers)
            if resp.status_code != 200:
                return {
                    "type": "web",
                    "url": clean_url,
                    "title": hostname,
                    "description": f"HTTP {resp.status_code}",
                    "content_markdown": f"### Unable to load content\n\nServer responded with HTTP {resp.status_code}. You can [open this link in a new browser tab]({clean_url})."
                }

            content_type = resp.headers.get("content-type", "").lower()

            # If response is a PDF document
            if "application/pdf" in content_type or "application/x-pdf" in content_type:
                doc_title = parsed.path.split("/")[-1] or hostname
                if not doc_title.lower().endswith(".pdf"):
                    doc_title += ".pdf"
                proxy_pdf = f"/api/reader/proxy/pdf?url={quote(clean_url)}"
                return {
                    "type": "pdf",
                    "url": clean_url,
                    "title": doc_title,
                    "domain": hostname,
                    "description": f"PDF Document from {hostname}",
                    "pdf_url": proxy_pdf,
                    "raw_pdf_url": clean_url,
                    "content_markdown": f"# {doc_title}\n\n[Open Direct PDF]({clean_url})\n\n*(PDF document loaded in embedded viewport)*",
                }

            raw_text = resp.text

            # If raw markdown or text
            if "text/markdown" in content_type or "text/plain" in content_type:
                title = clean_url.split("/")[-1] or hostname
                plain_payload = {
                    "type": "web",
                    "url": clean_url,
                    "title": title,
                    "description": hostname,
                    "content_markdown": raw_text[:40000]
                }
                _set_cached_reader_result(clean_url, plain_payload)
                return plain_payload

            # Parse HTML title & meta description
            title_match = re.search(r"<title[^>]*>([^<]+)</title>", raw_text, re.IGNORECASE)
            page_title = title_match.group(1).strip() if title_match else hostname

            desc_match = re.search(r'<meta[^>]*name=["\']description["\'][^>]*content=["\']([^"\']+)["\']', raw_text, re.IGNORECASE)
            page_desc = desc_match.group(1).strip() if desc_match else ""

            # Single-pass BeautifulSoup parsing offloaded to worker thread
            navigation_tree, markdown_body = await asyncio.to_thread(_parse_html_doc_sync, raw_text, clean_url)

            if markdown_body.strip().startswith("#"):
                final_content = markdown_body.strip()
            else:
                final_content = f"# {page_title}\n\n{markdown_body}".strip()

            # Cache page content for full-text search and fast read-through
            try:
                headings_list = [
                    {"title": m.group(2).strip(), "level": len(m.group(1))}
                    for m in re.finditer(r"^(#{1,4})\s+(.+)$", final_content, re.MULTILINE)
                ]
                meta_json = json.dumps({
                    "headings": headings_list,
                    "navigation": navigation_tree,
                    "description": page_desc
                })
                async with async_session_factory() as session:
                    stmt = select(DocPageCacheModel).where(DocPageCacheModel.id == page_id)
                    res = await session.execute(stmt)
                    existing = res.scalars().first()
                    if existing:
                        existing.title = page_title
                        existing.content_markdown = final_content
                        existing.headings_json = meta_json
                        existing.domain = hostname
                    else:
                        new_page = DocPageCacheModel(
                            id=page_id,
                            url=clean_url,
                            domain=hostname,
                            title=page_title,
                            content_markdown=final_content,
                            headings_json=meta_json
                        )
                        session.add(new_page)
                    await session.commit()
            except Exception as e:
                logger.debug(f"Doc caching notice: {e}")

            web_payload = {
                "type": "web",
                "url": clean_url,
                "title": page_title,
                "description": page_desc,
                "content_markdown": final_content,
                "navigation": navigation_tree
            }
            _set_cached_reader_result(clean_url, web_payload)
            return web_payload
    except httpx.TimeoutException:
        return {
            "type": "web",
            "url": clean_url,
            "title": hostname,
            "description": "Request timed out",
            "content_markdown": f"### Request Timed Out\n\nThe server took too long to respond. You can try [opening the URL in a browser tab]({clean_url})."
        }
    except Exception as e:
        logger.warning(f"Error fetching URL reader for {clean_url}: {e}")
        return {
            "type": "web",
            "url": clean_url,
            "title": hostname,
            "description": "Load error",
            "content_markdown": f"### Error Loading Page\n\n{str(e)}\n\n[Open link in external browser]({clean_url})"
        }


_READER_FILE_CACHE: Dict[str, List[str]] = {}
_READER_FILE_CACHE_KEYS: List[str] = []
_MAX_READER_CACHE_ENTRIES = 128


def _cache_reader_file_lines(cache_key: str, lines: List[str]):
    global _READER_FILE_CACHE, _READER_FILE_CACHE_KEYS
    if cache_key in _READER_FILE_CACHE:
        if cache_key in _READER_FILE_CACHE_KEYS:
            _READER_FILE_CACHE_KEYS.remove(cache_key)
    elif len(_READER_FILE_CACHE_KEYS) >= _MAX_READER_CACHE_ENTRIES:
        oldest_key = _READER_FILE_CACHE_KEYS.pop(0)
        _READER_FILE_CACHE.pop(oldest_key, None)
    _READER_FILE_CACHE[cache_key] = lines
    _READER_FILE_CACHE_KEYS.append(cache_key)


@router.get("/diff/context")
async def get_reader_diff_context(
    raw_url: Optional[str] = Query(None, description="Direct raw URL to the file"),
    repo: Optional[str] = Query(None, description="Owner/Repo identifier (e.g. owner/repo)"),
    path: Optional[str] = Query(None, description="Clean file path in repository"),
    ref: Optional[str] = Query("main", description="Git ref (branch or commit sha)"),
    start_line: int = Query(1, ge=1, description="1-indexed start line"),
    end_line: int = Query(20, ge=1, description="1-indexed end line"),
):
    """
    On-demand context expansion endpoint for GitHub PRs and remote repositories.
    Fetches the source file from GitHub raw/API, caches it in memory,
    and returns the sliced line range for diff expansion.
    """
    clean_path = (path or "").replace("\\", "/").lstrip("/")
    cache_key = raw_url.strip() if raw_url and raw_url.strip() else f"{repo or ''}:{ref or 'main'}:{clean_path}"

    if cache_key in _READER_FILE_CACHE:
        all_lines = _READER_FILE_CACHE[cache_key]
    else:
        raw_text = ""
        # 1. If raw_url is provided, fetch it directly
        if raw_url and raw_url.strip():
            target_url = raw_url.strip()
            headers = {"User-Agent": "CyclodeReader/1.0"}
            if "github" in target_url:
                parsed = urlparse(target_url)
                parts = [p for p in parsed.path.strip("/").split("/") if p]
                if len(parts) >= 2:
                    owner, repo_name = parts[0], parts[1]
                    token = await _get_github_auth_token(owner, repo_name)
                    if token:
                        headers["Authorization"] = f"Bearer {token}"
            try:
                async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
                    resp = await client.get(target_url, headers=headers)
                    if resp.status_code == 200:
                        raw_text = resp.text
            except Exception as e:
                logger.debug(f"Failed to fetch raw_url {target_url}: {e}")

        # 2. If no raw_text yet and repo + clean_path are provided
        if not raw_text and repo and clean_path:
            repo_clean = repo.strip()
            if "/" in repo_clean:
                owner, repo_name = repo_clean.split("/", 1)
                token = await _get_github_auth_token(owner, repo_name)
                headers = {"User-Agent": "CyclodeReader/1.0"}
                if token:
                    headers["Authorization"] = f"Bearer {token}"

                target_ref = ref.strip() if ref else "main"
                raw_gh_url = f"https://raw.githubusercontent.com/{owner}/{repo_name}/{target_ref}/{clean_path}"
                try:
                    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
                        resp = await client.get(raw_gh_url, headers=headers)
                        if resp.status_code == 200:
                            raw_text = resp.text
                        else:
                            api_url = f"https://api.github.com/repos/{owner}/{repo_name}/contents/{clean_path}?ref={target_ref}"
                            api_headers = dict(headers)
                            api_headers["Accept"] = "application/vnd.github.raw+json"
                            resp_api = await client.get(api_url, headers=api_headers)
                            if resp_api.status_code == 200:
                                raw_text = resp_api.text
                except Exception as e:
                    logger.debug(f"Failed to fetch repo file {repo_clean}:{clean_path}: {e}")

        all_lines = raw_text.splitlines() if raw_text else []
        if all_lines:
            _cache_reader_file_lines(cache_key, all_lines)

    total_lines = len(all_lines)
    if total_lines == 0:
        return {
            "ok": True,
            "path": clean_path or raw_url or "",
            "start_line": 1,
            "end_line": 0,
            "total_lines": 0,
            "lines": []
        }

    s = max(1, min(start_line, total_lines))
    e = max(s, min(end_line, total_lines))
    sliced = all_lines[s - 1:e]

    return {
        "ok": True,
        "path": clean_path or raw_url or "",
        "start_line": s,
        "end_line": e,
        "total_lines": total_lines,
        "lines": sliced
    }


@router.get("/proxy/pdf")
async def proxy_pdf_stream(url: str = Query(..., description="Target PDF URL to proxy and stream")):
    """
    Proxies and streams an external PDF file to bypass browser CORS and frame-ancestors restrictions,
    enabling embedded viewing in Cyclode's DocsViewerTab.
    """
    clean_url = unquote(url).strip()
    if not clean_url.startswith(("http://", "https://")):
        clean_url = "https://" + clean_url

    parsed = urlparse(clean_url)
    if not parsed.hostname:
        raise HTTPException(status_code=400, detail="Invalid target URL provided")

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
        ),
        "Accept": "application/pdf,*/*;q=0.8",
    }

    try:
        client = httpx.AsyncClient(timeout=35.0, follow_redirects=True)
        req = client.build_request("GET", clean_url, headers=headers)
        resp = await client.send(req, stream=True)

        if resp.status_code >= 400:
            await resp.aclose()
            await client.aclose()
            raise HTTPException(status_code=resp.status_code, detail=f"Upstream server returned HTTP {resp.status_code}")

        # Extract filename for download header
        path_name = parsed.path.split("/")[-1] or "document.pdf"
        if not path_name.lower().endswith(".pdf"):
            path_name += ".pdf"

        async def stream_chunks():
            try:
                async for chunk in resp.aiter_bytes(chunk_size=65536):
                    yield chunk
            finally:
                await resp.aclose()
                await client.aclose()

        response_headers = {
            "Content-Disposition": f'inline; filename="{path_name}"',
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
            "Access-Control-Allow-Headers": "*",
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "public, max-age=86400",
        }

        if "content-length" in resp.headers:
            response_headers["Content-Length"] = resp.headers["content-length"]
        if "etag" in resp.headers:
            response_headers["ETag"] = resp.headers["etag"]
        if "last-modified" in resp.headers:
            response_headers["Last-Modified"] = resp.headers["last-modified"]

        return StreamingResponse(
            stream_chunks(),
            media_type="application/pdf",
            headers=response_headers,
            status_code=resp.status_code
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"Error in PDF proxy stream for {clean_url}: {e}")
        raise HTTPException(status_code=502, detail=f"Failed to fetch PDF stream: {str(e)}")


@router.get("/proxy/webview")
async def proxy_webview_stream(
    url: str = Query(..., description="Target web page URL to proxy with anti-popup shielding"),
    shield: bool = Query(True, description="Enable anti-popup, anti-modal, and cookie banner shielding")
):
    """
    Proxies and filters an external web page to bypass X-Frame-Options/CSP restrictions
    and optionally injects an anti-annoyance shield to strip intrusive newsletter popups,
    cookie consent banners, floating chat bubbles, and background scroll locks.
    """
    clean_url = unquote(url).strip()
    if not clean_url.startswith(("http://", "https://")):
        clean_url = "https://" + clean_url

    parsed = urlparse(clean_url)
    if not parsed.hostname:
        raise HTTPException(status_code=400, detail="Invalid target URL provided")

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }

    def _build_webview_error_html(target_url: str, reason: str) -> HTMLResponse:
        safe_url = (
            target_url.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
        )
        safe_reason = (
            reason.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
        )
        error_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Webview Unavailable</title>
<style>
  body {{
    margin: 0;
    padding: 32px 24px;
    background: #1e222a;
    color: #abb2bf;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: calc(100vh - 64px);
  }}
  .card {{
    max-width: 460px;
    width: 100%;
    background: #282c34;
    border: 1px solid #3e4451;
    border-radius: 12px;
    padding: 20px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
  }}
  .title {{
    color: #e5c07b;
    font-size: 14px;
    font-weight: 600;
    margin: 0 0 8px 0;
  }}
  .desc {{
    font-size: 12.5px;
    line-height: 1.6;
    color: #9da5b4;
    margin: 0 0 12px 0;
    word-break: break-word;
  }}
  .url-box {{
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    background: #1e222a;
    border: 1px solid #333842;
    border-radius: 6px;
    padding: 8px 10px;
    color: #61afef;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-bottom: 16px;
  }}
  .actions {{
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }}
  .btn {{
    display: inline-flex;
    align-items: center;
    padding: 7px 12px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;
    border: 1px solid transparent;
  }}
  .btn-primary {{
    background: rgba(97, 175, 239, 0.15);
    color: #61afef;
    border-color: rgba(97, 175, 239, 0.35);
  }}
  .btn-secondary {{
    background: #333842;
    color: #dcdfe4;
    border-color: #3e4451;
  }}
</style>
</head>
<body>
  <div class="card">
    <div class="title">Unable to load page in embedded webview</div>
    <p class="desc">{safe_reason}</p>
    <div class="url-box" title="{safe_url}">{safe_url}</div>
    <div class="actions">
      <a class="btn btn-primary" href="{safe_url}" target="_blank" rel="noopener noreferrer" data-cyclode-external="true">
        Open in Browser Tab ↗
      </a>
      <button type="button" class="btn btn-secondary" onclick="window.parent && window.parent.postMessage({{ type: 'CYCLODE_WEBVIEW_SWITCH_READER' }}, '*')">
        Switch to Reader Mode
      </button>
    </div>
  </div>
</body>
</html>"""
        return HTMLResponse(content=error_html, status_code=200, headers={"Access-Control-Allow-Origin": "*"})

    try:
        async with httpx.AsyncClient(timeout=25.0, follow_redirects=True, verify=False) as client:
            resp = await client.get(clean_url, headers=headers)
            if resp.status_code >= 400:
                return _build_webview_error_html(
                    clean_url,
                    f"The upstream server returned HTTP {resp.status_code} when attempting to embed this page."
                )

            raw_html = resp.text
            final_url = str(resp.url)
    except Exception as e:
        logger.warning(f"Error proxying webview for {clean_url}: {e}")
        return _build_webview_error_html(
            clean_url,
            f"Failed to fetch webpage from upstream server: {str(e)}"
        )

    # Strip existing <base> tags and restrictive CSP/X-Frame-Options meta tags so our base tag and nav bridge work reliably
    raw_html = re.sub(r'<base\b[^>]*>', '', raw_html, flags=re.IGNORECASE)
    raw_html = re.sub(
        r'<meta\b[^>]*http-equiv=["\']?(?:Content-Security-Policy|X-Frame-Options)["\']?[^>]*>',
        '',
        raw_html,
        flags=re.IGNORECASE,
    )

    final_url_json = json.dumps(final_url)
    shield_json = "true" if shield else "false"

    navigation_bridge_js = f"""
    <script id="cyclode-webview-nav-bridge">
    (function() {{
        var BASE_URL = {final_url_json};
        var SHIELD_MODE = {shield_json};
        var lastUserInteraction = 0;

        var recordInteraction = function() {{
            lastUserInteraction = Date.now();
        }};
        document.addEventListener('pointerdown', recordInteraction, true);
        document.addEventListener('mousedown', recordInteraction, true);
        document.addEventListener('keydown', recordInteraction, true);

        var navigateViaProxy = function(rawTargetUrl, linkTitle) {{
            if (!rawTargetUrl) return false;
            var resolved;
            try {{
                resolved = new URL(rawTargetUrl, BASE_URL).href;
            }} catch (err) {{
                return false;
            }}
            if (!/^https?:\\/\\//i.test(resolved)) {{
                return false;
            }}
            try {{
                if (window.parent && window.parent !== window) {{
                    window.parent.postMessage({{
                        type: 'CYCLODE_WEBVIEW_NAVIGATE',
                        url: resolved,
                        title: linkTitle || ''
                    }}, '*');
                }}
            }} catch (err) {{}}
            try {{
                var proxyBase = window.location.origin + window.location.pathname;
                var proxyUrl = proxyBase + '?url=' + encodeURIComponent(resolved) + '&shield=' + (SHIELD_MODE ? 'true' : 'false');
                window.location.href = proxyUrl;
            }} catch (err) {{}}
            return true;
        }};

        window.__cyclodeNavigateViaProxy = navigateViaProxy;
        window.__cyclodeHasRecentInteraction = function() {{
            return (Date.now() - lastUserInteraction) < 1500;
        }};

        // Intercept all <a> clicks in capture phase so <base href> does not escape the proxy
        document.addEventListener('click', function(e) {{
            var target = e.target;
            if (!target || typeof target.closest !== 'function') return;
            var anchor = target.closest('a[href]');
            if (!anchor) return;
            if (anchor.getAttribute('data-cyclode-external') === 'true') return;
            if (e.button && e.button !== 0) return;

            var rawHref = (anchor.getAttribute('href') || '').trim();
            if (!rawHref || /^javascript:/i.test(rawHref) || /^mailto:/i.test(rawHref) || /^tel:/i.test(rawHref)) {{
                return;
            }}

            // Handle in-page #hash anchors without cross-origin navigation
            if (rawHref.charAt(0) === '#') {{
                e.preventDefault();
                e.stopPropagation();
                var hashId = decodeURIComponent(rawHref.slice(1));
                if (!hashId) {{
                    window.scrollTo({{ top: 0, behavior: 'smooth' }});
                    return;
                }}
                var el = document.getElementById(hashId) || document.querySelector('[name="' + hashId.replace(/"/g, '\\\\"') + '"]');
                if (el && typeof el.scrollIntoView === 'function') {{
                    el.scrollIntoView({{ behavior: 'smooth', block: 'start' }});
                }}
                return;
            }}

            var resolvedHref;
            try {{
                resolvedHref = new URL(rawHref, BASE_URL).href;
            }} catch (err) {{
                return;
            }}

            var baseNoHash = BASE_URL.split('#')[0];
            var resolvedParts = resolvedHref.split('#');
            if (resolvedParts[0] === baseNoHash && resolvedParts.length > 1) {{
                e.preventDefault();
                e.stopPropagation();
                var samePageHash = decodeURIComponent(resolvedParts.slice(1).join('#'));
                var targetEl = samePageHash ? (document.getElementById(samePageHash) || document.querySelector('[name="' + samePageHash.replace(/"/g, '\\\\"') + '"]')) : null;
                if (targetEl && typeof targetEl.scrollIntoView === 'function') {{
                    targetEl.scrollIntoView({{ behavior: 'smooth', block: 'start' }});
                }} else if (!samePageHash) {{
                    window.scrollTo({{ top: 0, behavior: 'smooth' }});
                }}
                return;
            }}

            if (/^https?:\\/\\//i.test(resolvedHref)) {{
                e.preventDefault();
                e.stopPropagation();
                anchor.removeAttribute('target');
                var titleText = (anchor.innerText || anchor.textContent || anchor.getAttribute('title') || '').trim().slice(0, 120);
                navigateViaProxy(resolvedHref, titleText);
            }}
        }}, true);

        // Intercept GET form submissions (e.g. search inputs) so they remain proxied
        document.addEventListener('submit', function(e) {{
            var form = e.target;
            if (!form || form.tagName !== 'FORM') return;
            var method = (form.getAttribute('method') || 'get').toLowerCase();
            if (method !== 'get') return;
            var action = form.getAttribute('action') || BASE_URL;
            try {{
                var actionUrl = new URL(action, BASE_URL);
                var formData = new FormData(form);
                formData.forEach(function(value, key) {{
                    if (typeof value === 'string') {{
                        actionUrl.searchParams.set(key, value);
                    }}
                }});
                e.preventDefault();
                e.stopPropagation();
                navigateViaProxy(actionUrl.href, '');
            }} catch (err) {{}}
        }}, true);
    }})();
    </script>
    """

    def _inject_into_head(html_doc: str, head_payload: str) -> str:
        head_match = re.search(r'<head\b[^>]*>', html_doc, flags=re.IGNORECASE)
        if head_match:
            insert_pos = head_match.end()
            return html_doc[:insert_pos] + f"\n{head_payload}" + html_doc[insert_pos:]
        html_match = re.search(r'<html\b[^>]*>', html_doc, flags=re.IGNORECASE)
        if html_match:
            insert_pos = html_match.end()
            return html_doc[:insert_pos] + f"<head>{head_payload}</head>" + html_doc[insert_pos:]
        return f"<head>{head_payload}</head>\n" + html_doc

    base_tag = f'<base href="{final_url}">'

    if not shield:
        # Inject base href and navigation bridge so relative assets load and link clicks stay proxied
        unshielded_head = f"{base_tag}\n{navigation_bridge_js}"
        raw_html = _inject_into_head(raw_html, unshielded_head)
        return HTMLResponse(content=raw_html, headers={"Access-Control-Allow-Origin": "*"})

    # Shield Active: Anti-annoyance CSS, JS, and script stripping
    anti_annoyance_css = """
    <style id="cyclode-popup-shield">
    /* Cyclode Anti-Popup, Cookie Banner & Newsletter Modal Shield */
    [class*="popup" i]:not(html):not(body),
    [id*="popup" i],
    [class*="modal" i]:not([class*="code"]):not([class*="syntax"]):not([class*="prism"]):not(html):not(body),
    [id*="modal" i],
    [class*="overlay" i]:not([class*="code"]):not(html):not(body),
    [id*="overlay" i],
    [class*="cookie" i]:not(html):not(body),
    [id*="cookie" i],
    [class*="consent" i]:not(html):not(body),
    [id*="consent" i],
    [class*="newsletter" i]:not(html):not(body),
    [id*="newsletter" i],
    [class*="subscription" i]:not(html):not(body),
    [id*="subscription" i],
    [class*="leadbox" i],
    [id*="leadbox" i],
    [class*="optin" i],
    [id*="optin" i],
    [aria-modal="true"],
    div[role="dialog"]:not([class*="code"]):not([class*="prism"]),
    div[class*="floating-chat" i],
    div[id*="floating-chat" i],
    div[class*="whatsapp" i],
    div[id*="whatsapp" i],
    div[class*="chat-widget" i],
    div[id*="chat-widget" i],
    #onesignal-bell-container,
    #onesignal-slidedown-dialog,
    .sp-modal-content,
    .widget-overlay,
    .push-notification-banner {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
        z-index: -9999 !important;
        clip: rect(0 0 0 0) !important;
        clip-path: inset(50%) !important;
        height: 0 !important;
        width: 0 !important;
        position: absolute !important;
        overflow: hidden !important;
    }

    /* Prevent websites from freezing scroll on body / html behind modals */
    html, body {
        overflow: auto !important;
        overflow-y: auto !important;
        position: static !important;
        height: auto !important;
        max-height: none !important;
    }
    </style>
    """

    anti_annoyance_js = """
    <script id="cyclode-popup-shield-script">
    (function() {
        // Neutralize popups and alerts while allowing user-initiated navigations
        window.alert = function() { console.log('[Cyclode Shield] Blocked alert'); };
        window.confirm = function() { console.log('[Cyclode Shield] Blocked confirm'); return false; };
        window.prompt = function() { return null; };
        window.open = function(url) {
            if (url && window.__cyclodeHasRecentInteraction && window.__cyclodeHasRecentInteraction() && window.__cyclodeNavigateViaProxy) {
                window.__cyclodeNavigateViaProxy(String(url), '');
                return null;
            }
            console.log('[Cyclode Shield] Blocked window.open');
            return null;
        };

        // Neutralize push notification permission traps
        if (typeof Notification !== 'undefined') {
            Notification.requestPermission = function() {
                return Promise.resolve('denied');
            };
        }

        // MutationObserver to remove dynamically injected full-screen modal backdrops & scroll locks
        const unlock = function() {
            if (document.documentElement) {
                document.documentElement.style.setProperty('overflow', 'auto', 'important');
            }
            if (document.body) {
                document.body.style.setProperty('overflow', 'auto', 'important');
                document.body.style.setProperty('position', 'static', 'important');
            }
        };

        const purgeModals = function() {
            unlock();
            const modals = document.querySelectorAll('[aria-modal="true"], div[role="dialog"]');
            modals.forEach(function(el) {
                if (!el.closest('pre, code')) {
                    el.style.setProperty('display', 'none', 'important');
                }
            });
        };

        document.addEventListener('DOMContentLoaded', purgeModals);
        window.addEventListener('load', purgeModals);
        setInterval(purgeModals, 1000);
    })();
    </script>
    """

    # Neutralize common third-party popup / modal / tracker script tags
    annoyance_script_regex = re.compile(
        r'<script[^>]*src=["\'][^"\']*(?:optinmonster|cookiebot|onetrust|quantserve|mailchimp|sumome|hubspot|onesignal|intercom|drift|trustarc|usercentrics|termly|consentmanager)[^"\']*["\'][^>]*>.*?</script>',
        re.IGNORECASE | re.DOTALL
    )
    cleaned_html = annoyance_script_regex.sub('<!-- [Cyclode Shield: Intrusive Script Blocked] -->', raw_html)

    if "github.com" in parsed.hostname.lower():
        # GitHub's client scripts perform cross-origin AJAX fetches back to github.com which fail CORS
        # Strip script tags so the page renders statically and quickly without hanging or error loops
        cleaned_html = re.sub(r'<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>', '', cleaned_html, flags=re.I)

    # Base tag, navigation bridge, and shield assets
    injected_head = f"{base_tag}\n{navigation_bridge_js}\n{anti_annoyance_css}\n{anti_annoyance_js}"
    cleaned_html = _inject_into_head(cleaned_html, injected_head)

    response_headers = {
        "Content-Type": "text/html; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "public, max-age=300",
    }

    return HTMLResponse(content=cleaned_html, headers=response_headers)
