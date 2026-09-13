import os
import subprocess
import httpx
from pathlib import Path
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone
import urllib.parse
import re


class WorkspaceTools:
    """
    Real tool executions inside the task workspace directory and live web intelligence.
    """

    @staticmethod
    def list_dir(workspace_path: Path, subpath: str = ".") -> Dict[str, Any]:
        target = (workspace_path / subpath).resolve()
        if not target.is_relative_to(workspace_path):
            return {"error": "Access denied outside workspace"}
        if not target.exists():
            return {"error": f"Path '{subpath}' does not exist"}

        files = []
        for p in target.iterdir():
            if ".git" not in p.parts:
                files.append({
                    "name": p.name,
                    "is_dir": p.is_dir(),
                    "type": "directory" if p.is_dir() else "file",
                    "size": p.stat().st_size if p.is_file() else None
                })
        return {"path": str(subpath), "items": files}

    @staticmethod
    def read_file(workspace_path: Path, file_path: str) -> Dict[str, Any]:
        target = (workspace_path / file_path).resolve()
        if not target.is_relative_to(workspace_path):
            return {"error": "Access denied outside workspace"}
        if not target.exists() or not target.is_file():
            return {"error": f"File '{file_path}' not found"}

        try:
            content = target.read_text(encoding="utf-8")
            return {"file_path": file_path, "content": content}
        except Exception as e:
            return {"error": str(e)}

    @staticmethod
    def edit_file(workspace_path: Path, file_path: str, content: str) -> Dict[str, Any]:
        target = (workspace_path / file_path).resolve()
        if not target.is_relative_to(workspace_path):
            return {"error": "Access denied outside workspace"}

        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        return {"file_path": file_path, "status": "written", "bytes": len(content)}

    @staticmethod
    def run_command(workspace_path: Path, command: str) -> Dict[str, Any]:
        try:
            proc = subprocess.run(
                command,
                shell=True,
                cwd=workspace_path,
                capture_output=True,
                text=True,
                timeout=60
            )
            return {
                "command": command,
                "exit_code": proc.returncode,
                "stdout": proc.stdout,
                "stderr": proc.stderr
            }
        except subprocess.TimeoutExpired:
            return {"command": command, "error": "Command timed out after 60 seconds", "exit_code": 124}
        except Exception as e:
            return {"command": command, "error": str(e), "exit_code": 1}

    @staticmethod
    async def fetch_url(url: str, timeout: float = 10.0) -> Dict[str, Any]:
        """
        Fetches live web content, cleans up HTML, and extracts readable text.
        """
        try:
            headers = {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
            }
            
            # If GitHub repo URL, try fetching the README directly from raw.githubusercontent.com for high-fidelity content
            gh_match = re.search(r"github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)(?:/?$|#|\?)", url)
            if gh_match:
                owner, repo = gh_match.group(1), gh_match.group(2).rstrip(".git")
                for branch in ("main", "master"):
                    raw_url = f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/README.md"
                    try:
                        async with httpx.AsyncClient(follow_redirects=True, timeout=timeout) as client:
                            raw_resp = await client.get(raw_url, headers=headers)
                            raw_txt = raw_resp.text
                            clean_md = re.sub(r"<!--.*?-->", "", raw_txt, flags=re.DOTALL)
                            clean_md = re.sub(r"<picture>.*?</picture>", "", clean_md, flags=re.DOTALL | re.IGNORECASE)
                            clean_md = re.sub(r"<[^>]+>", " ", clean_md)
                            clean_md = re.sub(r"[ \t]+", " ", clean_md)
                            clean_md = re.sub(r"\n{3,}", "\n\n", clean_md).strip()
                            if len(clean_md) > 100:
                                return {
                                    "url": url,
                                    "status_code": 200,
                                    "content": clean_md[:6000],
                                    "raw_length": len(raw_txt),
                                    "source": "GitHub README"
                                }
                    except Exception:
                        pass

            async with httpx.AsyncClient(follow_redirects=True, timeout=timeout) as client:
                resp = await client.get(url, headers=headers)
                if resp.status_code >= 400:
                    return {"url": url, "error": f"HTTP {resp.status_code}", "status_code": resp.status_code}
                
                text = resp.text
                # Simple HTML tag stripping for text extraction
                clean_text = re.sub(r"<script[^>]*>.*?</script>", "", text, flags=re.DOTALL | re.IGNORECASE)
                clean_text = re.sub(r"<style[^>]*>.*?</style>", "", clean_text, flags=re.DOTALL | re.IGNORECASE)
                clean_text = re.sub(r"<[^>]+>", " ", clean_text)
                clean_text = re.sub(r"\s+", " ", clean_text).strip()
                
                return {
                    "url": url,
                    "status_code": resp.status_code,
                    "content": clean_text[:4000],
                    "raw_length": len(text)
                }
        except Exception as e:
            return {"url": url, "error": str(e)}

    @staticmethod
    async def search_web(query: str, limit: int = 5, temporal_context: Optional[str] = None) -> Dict[str, Any]:
        """
        Executes live web retrieval across news, developer feeds, and real-time tech endpoints.
        Supports temporal anchoring (e.g. 'this week', 'latest', 'today', 'this month', 'last weeks')
        with strict age cutoffs and homonym disambiguation.
        """
        now = datetime.now(timezone.utc)
        current_year = now.year
        
        results = []
        clean_q = query.lower().strip()
        full_context = f"{clean_q} {(temporal_context or '').lower()}".strip()

        # Granular temporal window definitions
        if any(w in full_context for w in ("today", "yesterday", "tonight", "this morning", "hours ago", "last 24 hours")):
            max_age_days = 7
            is_temporal = True
        elif any(w in full_context for w in ("this week", "last week", "past week", "last 7 days")):
            max_age_days = 14
            is_temporal = True
        elif any(w in full_context for w in ("this month", "last weeks", "esp the last weeks", "especially the last weeks", "in the last weeks", "past weeks", "last month", "last 30 days")):
            max_age_days = 60
            is_temporal = True
        elif any(w in full_context for w in ("recent", "latest", "current", "news", "2026", "announcements", "updates", "releases")):
            max_age_days = 180
            is_temporal = True
        else:
            max_age_days = None
            is_temporal = False
        
        # Extract core search subject by stripping conversational qualifiers and temporal modifiers
        months_pat = r"january|february|march|april|may|june|july|august|september|october|november|december"
        entity_query = re.sub(
            rf"\b(news|announcements|announcement|latest|today|yesterday|tonight|this morning|this week|this month|this year|recently|recent|releases|update|updates|what happened|what is happening|what is happening at|what happened at|what happened with|esp the last weeks|especially the last weeks|in the last weeks|over the last weeks|last weeks|last week|tell me about|provide a summary of|summary of|2023|2024|2025|2026|{months_pat})\b",
            "",
            clean_q,
            flags=re.IGNORECASE
        ).strip()
        entity_query = re.sub(r"^(?:at|with|about|for|in|on|to)\s+", "", entity_query).strip()
        entity_query = re.sub(r"(?:,\s*)?(?:esp(?:ecially)?\s+)?(?:the\s+)?(?:last|recent|past)\s+(?:weeks?|months?|days?|year)\s*$", "", entity_query, flags=re.IGNORECASE).strip()
        entity_query = re.sub(r"\s+", " ", entity_query).strip()
        if not entity_query:
            entity_query = clean_q

        # Domain expansions for ambiguous developer entities
        ENTITY_EXPANSIONS = {
            "cursor": ["cursor ide", "cursor ai", "cursor"],
            "bolt": ["bolt.new", "bolt ai", "bolt"],
            "copilot": ["github copilot", "copilot"],
        }
        search_queries = ENTITY_EXPANSIONS.get(entity_query, [entity_query])

        ENTITY_ALIASES = {
            "spacex": ["spacex", "space x", "elon musk", "musk", "starship", "starlink", "falcon 9", "falcon heavy"],
            "cursor": ["cursor", "anysphere"],
            "apple": ["apple", "ios", "macos", "iphone", "ipad", "macbook", "tim cook", "vision pro", "swift"],
            "nvidia": ["nvidia", "jensen huang", "blackwell", "geforce", "cuda", "h100", "b200"],
            "openai": ["openai", "chatgpt", "sam altman", "gpt-4", "gpt-5", "o1", "sora"],
            "anthropic": ["anthropic", "claude", "dario amodei"],
            "google": ["google", "alphabet", "sundar pichai", "gemini", "deepmind", "android"],
            "meta": ["meta", "zuckerberg", "llama", "facebook", "instagram", "quest"],
            "microsoft": ["microsoft", "satya nadella", "azure", "windows", "copilot", "github"],
            "databricks": ["databricks", "spark", "lakehouse", "tabular"],
            "stripe": ["stripe", "collison", "bridge"],
            "hugging face": ["hugging face", "huggingface", "transformers"],
            "huggingface": ["hugging face", "huggingface", "transformers"],
        }

        def is_valid_candidate(hit: Dict[str, Any]) -> bool:
            title_lower = hit["title"].lower()
            
            # 1. Filter homonyms for ambiguous developer terms
            if entity_query == "cursor":
                if any(bad in title_lower for bad in ("mouse cursor", "windows 95", "win95", "sql cursor", "database cursor")):
                    return False
            
            # 2. Target entity relevance gate (ensure the article actually mentions the target entity or aliases)
            if entity_query in ENTITY_ALIASES:
                if not any(alias in title_lower for alias in ENTITY_ALIASES[entity_query]):
                    return False
            elif len(entity_query.split()) == 1 and len(entity_query) >= 3:
                if entity_query not in title_lower:
                    return False
            elif len(entity_query.split()) > 1:
                stopwords = {"the", "and", "for", "with", "this", "that", "from", "about", "what", "how"}
                words = [w for w in entity_query.split() if len(w) >= 3 and w not in stopwords]
                if words and not any(w in title_lower for w in words):
                    return False

            # 3. Filter by date if temporal
            if max_age_days is not None:
                raw_dt = hit.get("_raw_dt")
                if not raw_dt:
                    return False
                age = (now - raw_dt).total_seconds() / 86400
                if age > max_age_days:
                    return False
            return True

        async def fetch_hn(q_str: str, max_hits: int, by_date: bool = False):
            hits_found = []
            try:
                endpoint = "search_by_date" if by_date else "search"
                async with httpx.AsyncClient(timeout=8.0) as client:
                    hn_url = f"https://hn.algolia.com/api/v1/{endpoint}?query={urllib.parse.quote(q_str)}&tags=story&hitsPerPage={max_hits}"
                    resp = await client.get(hn_url)
                    if resp.status_code == 200:
                        data = resp.json()
                        for hit in data.get("hits", [])[:max_hits]:
                            title = hit.get("title")
                            url = hit.get("url") or f"https://news.ycombinator.com/item?id={hit.get('objectID')}"
                            points = hit.get("points", 0)
                            created_at = hit.get("created_at", "")
                            date_str = None
                            raw_dt = None
                            if created_at:
                                try:
                                    dt = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
                                    date_str = dt.strftime("%b %d, %Y")
                                    raw_dt = dt
                                except Exception:
                                    date_str = created_at[:10]
                            if title and url:
                                candidate = {
                                    "title": title,
                                    "url": url,
                                    "source": "Hacker News",
                                    "score": points,
                                    "date": date_str,
                                    "_raw_dt": raw_dt
                                }
                                if is_valid_candidate(candidate):
                                    hits_found.append(candidate)
            except Exception:
                pass
            return hits_found

        # 1. If temporal, search by date using entity query / expansions
        if is_temporal:
            for sq in search_queries:
                if len(results) >= limit:
                    break
                more = await fetch_hn(sq, limit - len(results), by_date=True)
                seen_urls = {r["url"] for r in results}
                for m in more:
                    if m["url"] not in seen_urls:
                        results.append(m)
                        seen_urls.add(m["url"])
            
            # Supplement with current year anchored search if still under limit
            if len(results) < limit:
                for sq in search_queries:
                    if len(results) >= limit:
                        break
                    more = await fetch_hn(f"{sq} {current_year}", limit - len(results), by_date=False)
                    seen_urls = {r["url"] for r in results}
                    for m in more:
                        if m["url"] not in seen_urls:
                            results.append(m)
                            seen_urls.add(m["url"])
        else:
            for sq in search_queries:
                if len(results) >= limit:
                    break
                more = await fetch_hn(sq, limit - len(results), by_date=False)
                seen_urls = {r["url"] for r in results}
                for m in more:
                    if m["url"] not in seen_urls:
                        results.append(m)
                        seen_urls.add(m["url"])

        # Deduplicate and clean internal fields
        deduped = []
        seen = set()
        for r in results:
            if r["url"] not in seen and r["title"] not in seen:
                seen.add(r["url"])
                seen.add(r["title"])
                clean_item = {k: v for k, v in r.items() if not k.startswith("_")}
                deduped.append(clean_item)
            if len(deduped) >= limit:
                break

        return {
            "query": query,
            "results_count": len(deduped),
            "results": deduped
        }
