import re
import json
import hashlib
import logging
from typing import Optional, Dict, Any, List
from urllib.parse import urlparse, urljoin
from html.parser import HTMLParser
import httpx
from fastapi import APIRouter, HTTPException, Query
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


def _clean_html_to_markdown(html_text: str, base_url: str = "") -> str:
    """
    Extracts readable article/main text and converts HTML into clean Markdown.
    Uses BeautifulSoup when installed, with StandardDocParser fallback.
    """
    try:
        from bs4 import BeautifulSoup, NavigableString, Tag, Comment
        soup = BeautifulSoup(html_text, "html.parser")

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
                for li in node.find_all("li", recursive=False):
                    lines.append(f"- {li.get_text(strip=True)}\n")
                lines.append("\n")
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


def _extract_site_navigation(html_text: str, base_url: str = "") -> list:
    """
    Extracts structured navigation tree (guides, chapters, pages) from
    documentation sidebars (e.g. Docusaurus, Astro Starlight, VitePress, MkDocs, GitBook).
    """
    if not html_text:
        return []

    try:
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(html_text, "html.parser")

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
    except Exception as e:
        logger.debug(f"GitHub token lookup notice for {owner}/{repo}: {e}")
    return token


async def _fetch_github_repo_info(owner: str, repo: str) -> Dict[str, Any]:
    """
    Fetches GitHub repository information and README markdown with Vault token support.
    """
    token = await _get_github_auth_token(owner, repo)

    headers = {
        "User-Agent": "Cyclode-Workstation/1.0",
        "Accept": "application/vnd.github.v3+json"
    }
    if token:
        headers["Authorization"] = f"token {token}"

    repo_url = f"https://api.github.com/repos/{owner}/{repo}"
    readme_api_url = f"https://api.github.com/repos/{owner}/{repo}/readme"

    async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
        repo_data: Dict[str, Any] = {}
        readme_md: Optional[str] = None

        # Fetch repo metadata
        try:
            r = await client.get(repo_url, headers=headers)
            if r.status_code == 200:
                repo_data = r.json()
        except Exception as e:
            logger.debug(f"GitHub API metadata notice: {e}")

        # Fetch README via official GitHub API with raw accept header
        try:
            readme_headers = dict(headers)
            readme_headers["Accept"] = "application/vnd.github.raw+json"
            r = await client.get(readme_api_url, headers=readme_headers)
            if r.status_code == 200 and r.text.strip():
                readme_md = r.text
        except Exception:
            pass

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
    Fetches GitHub Pull Request metadata, description, files list, commits, and unified diff.
    """
    token = await _get_github_auth_token(owner, repo)
    headers = {
        "User-Agent": "Cyclode-Workstation/1.0",
        "Accept": "application/vnd.github.v3+json"
    }
    if token:
        headers["Authorization"] = f"token {token}"

    pr_url = f"https://api.github.com/repos/{owner}/{repo}/pulls/{pr_number}"
    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
        pr_data: Dict[str, Any] = {}
        try:
            r = await client.get(pr_url, headers=headers)
            if r.status_code == 200:
                pr_data = r.json()
        except Exception as e:
            logger.warning(f"Failed to fetch GitHub PR {owner}/{repo}#{pr_number}: {e}")

        # Fetch unified diff
        diff_text = ""
        try:
            diff_headers = dict(headers)
            diff_headers["Accept"] = "application/vnd.github.v3.diff"
            r_diff = await client.get(pr_url, headers=diff_headers)
            if r_diff.status_code == 200:
                diff_text = r_diff.text
        except Exception as e:
            logger.debug(f"Failed to fetch PR diff via GitHub API: {e}")

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

        # Fetch PR modified files list
        files_list: List[Dict[str, Any]] = []
        try:
            r_files = await client.get(f"{pr_url}/files?per_page=100", headers=headers)
            if r_files.status_code == 200:
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
            logger.debug(f"Failed to fetch PR files via API: {e}")

        # Fallback parse diff_text if files_list is empty
        if not files_list and diff_text:
            files_list = _parse_diff_to_files(diff_text)

        # Fetch PR commits list
        commits_list: List[Dict[str, Any]] = []
        try:
            r_commits = await client.get(f"{pr_url}/commits?per_page=50", headers=headers)
            if r_commits.status_code == 200:
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
            logger.debug(f"Failed to fetch PR commits via API: {e}")

        # Fetch PR comments (issue comments, review comments, reviews)
        comments_list: List[Dict[str, Any]] = []
        try:
            from app.integrations.github_client import github_client
            comments_list = await github_client.list_pull_request_comments(owner, repo, pr_number, custom_token=token)
        except Exception as e:
            logger.debug(f"Failed to fetch PR comments in reader: {e}")

        title = pr_data.get("title") or f"Pull Request #{pr_number}"
        user_login = pr_data.get("user", {}).get("login", "unknown")
        user_avatar = pr_data.get("user", {}).get("avatar_url", "")
        state = pr_data.get("state", "open")
        merged = pr_data.get("merged", False)
        status_str = "MERGED" if merged else state.upper()
        head_ref = pr_data.get("head", {}).get("ref", "")
        base_ref = pr_data.get("base", {}).get("ref", "main")
        raw_body = (pr_data.get("body") or "").strip()
        body = _clean_github_markdown(raw_body, owner, repo, default_branch=base_ref) if raw_body else ""
        additions = pr_data.get("additions", 0)
        deletions = pr_data.get("deletions", 0)
        changed_files = pr_data.get("changed_files", len(files_list))
        html_url = pr_data.get("html_url") or f"https://github.com/{owner}/{repo}/pull/{pr_number}"

        meta_parts = [f"**Status**: `{status_str}`", f"**Author**: @{user_login}"]
        if head_ref and base_ref:
            meta_parts.append(f"**Branches**: `{head_ref}` ➔ `{base_ref}`")
        if additions or deletions or changed_files:
            meta_parts.append(f"**Changes**: `+{additions:,}` / `-{deletions:,}` ({changed_files} files)")

        overview_parts = [
            f"# Pull Request #{pr_number}: {title}\n",
            f"{' | '.join(meta_parts)}\n",
            "## Description\n",
            f"{body if body else '*No description provided.*'}\n"
        ]
        overview_md = "\n".join(overview_parts).strip()

        # Build full markdown as fallback for non-tabbed readers
        full_md_parts = list(overview_parts)
        if diff_text.strip():
            full_md_parts.append("\n## Unified Diff\n")
            full_md_parts.append(f"```diff\n{diff_text.strip()}\n```\n")
        full_md = "\n".join(full_md_parts).strip()

        return {
            "type": "github",
            "is_pr": True,
            "url": html_url,
            "title": f"{owner}/{repo} #{pr_number}: {title}",
            "repo_name": f"{owner}/{repo}",
            "pr_number": pr_number,
            "pr_title": title,
            "state": status_str,
            "author": user_login,
            "author_avatar": user_avatar,
            "head_branch": head_ref,
            "base_branch": base_ref,
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
        raise HTTPException(status_code=404, detail=f"Linear issue {issue_key} not found")

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


@router.get("")
async def get_url_reader(url: str = Query(..., description="Target URL to read")):
    """
    Returns clean, structured reader markdown and metadata for an external URL.
    Detects GitHub repositories to provide rich README and metadata views.
    """
    clean_url = url.strip()
    if not clean_url.startswith(("http://", "https://")):
        clean_url = "https://" + clean_url

    parsed = urlparse(clean_url)
    hostname = (parsed.hostname or "").lower()

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
                    return gh_info
                except Exception as e:
                    logger.warning(f"Error resolving GitHub Issue {owner}/{repo}#{issue_number}: {e}")

            # Check for GitHub Commit URL: /owner/repo/commit/sha
            elif len(path_parts) >= 4 and path_parts[2].lower() in ("commit", "commits"):
                commit_sha = path_parts[3]
                try:
                    return await _fetch_github_commit_info(owner, repo, commit_sha)
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
                return gh_info
            except Exception as e:
                logger.warning(f"Error resolving GitHub repo {owner}/{repo}: {e}")

    # Standard Web Documentation Reader
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

            content_type = resp.headers.get("content-type", "")
            raw_text = resp.text

            # If raw markdown or text
            if "text/markdown" in content_type or "text/plain" in content_type:
                title = clean_url.split("/")[-1] or hostname
                return {
                    "type": "web",
                    "url": clean_url,
                    "title": title,
                    "description": hostname,
                    "content_markdown": raw_text[:40000]
                }

            # Parse HTML
            title_match = re.search(r"<title[^>]*>([^<]+)</title>", raw_text, re.IGNORECASE)
            page_title = title_match.group(1).strip() if title_match else hostname

            # Extract meta description
            desc_match = re.search(r'<meta[^>]*name=["\']description["\'][^>]*content=["\']([^"\']+)["\']', raw_text, re.IGNORECASE)
            page_desc = desc_match.group(1).strip() if desc_match else ""

            navigation_tree = _extract_site_navigation(raw_text, base_url=clean_url)
            markdown_body = _clean_html_to_markdown(raw_text, base_url=clean_url)

            if markdown_body.strip().startswith("#"):
                final_content = markdown_body.strip()
            else:
                final_content = f"# {page_title}\n\n{markdown_body}".strip()

            # Cache page content for full-text search
            try:
                page_id = hashlib.sha256(clean_url.encode("utf-8")).hexdigest()[:32]
                headings_list = [
                    {"title": m.group(2).strip(), "level": len(m.group(1))}
                    for m in re.finditer(r"^(#{1,4})\s+(.+)$", final_content, re.MULTILINE)
                ]
                async with async_session_factory() as session:
                    stmt = select(DocPageCacheModel).where(DocPageCacheModel.id == page_id)
                    res = await session.execute(stmt)
                    existing = res.scalars().first()
                    if existing:
                        existing.title = page_title
                        existing.content_markdown = final_content
                        existing.headings_json = json.dumps(headings_list)
                        existing.domain = hostname
                    else:
                        new_page = DocPageCacheModel(
                            id=page_id,
                            url=clean_url,
                            domain=hostname,
                            title=page_title,
                            content_markdown=final_content,
                            headings_json=json.dumps(headings_list)
                        )
                        session.add(new_page)
                    await session.commit()
            except Exception as e:
                logger.debug(f"Doc caching notice: {e}")

            return {
                "type": "web",
                "url": clean_url,
                "title": page_title,
                "description": page_desc,
                "content_markdown": final_content,
                "navigation": navigation_tree
            }
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
