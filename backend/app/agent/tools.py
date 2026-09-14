import os
import re
import ast
import json
import fnmatch
import subprocess
import httpx
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime, timezone
import urllib.parse


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
    def search_code(
        workspace_path: Path,
        query: str,
        is_regex: bool = False,
        case_sensitive: bool = False,
        file_pattern: Optional[str] = None,
        max_results: int = 50
    ) -> Dict[str, Any]:
        """
        Fast workspace code search ignoring build/vendor folders.
        """
        if not query or not query.strip():
            return {"error": "Query string cannot be empty", "matches": []}

        flags = 0 if case_sensitive else re.IGNORECASE
        try:
            pattern = re.compile(query if is_regex else re.escape(query), flags)
        except re.error as e:
            return {"error": f"Invalid regex: {e}", "matches": []}

        ignored_dirs = {
            ".git", "node_modules", "venv", ".venv", "__pycache__",
            "dist", "build", ".next", ".cache", ".pytest_cache", ".gemini", "assets"
        }
        ignored_extensions = {
            ".png", ".jpg", ".jpeg", ".ico", ".svg", ".gif", ".webp",
            ".pdf", ".zip", ".tar", ".gz", ".pyc", ".db", ".sqlite", ".sqlite3", ".woff", ".woff2"
        }

        matches = []
        for root, dirs, files in os.walk(workspace_path):
            dirs[:] = [d for d in dirs if d not in ignored_dirs and not d.startswith(".")]
            rel_root = Path(root).relative_to(workspace_path)

            for f in files:
                if len(matches) >= max_results:
                    break
                p = Path(f)
                if p.suffix.lower() in ignored_extensions or f.startswith("."):
                    continue

                rel_file_path = str(rel_root / f) if str(rel_root) != "." else f
                if file_pattern:
                    if not fnmatch.fnmatch(rel_file_path, file_pattern) and not fnmatch.fnmatch(f, file_pattern):
                        continue

                full_path = Path(root) / f
                try:
                    with open(full_path, "r", encoding="utf-8", errors="ignore") as file_obj:
                        for line_idx, line in enumerate(file_obj, start=1):
                            if pattern.search(line):
                                matches.append({
                                    "file_path": rel_file_path,
                                    "line_number": line_idx,
                                    "line_content": line.rstrip("\r\n")
                                })
                                if len(matches) >= max_results:
                                    break
                except Exception:
                    continue

        return {
            "query": query,
            "total_matches": len(matches),
            "capped": len(matches) >= max_results,
            "matches": matches
        }

    @staticmethod
    def _extract_python_symbols(code: str, file_path: str) -> List[Dict[str, Any]]:
        symbols = []
        try:
            tree = ast.parse(code)
        except Exception:
            return symbols

        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                decorators = []
                is_endpoint = False
                for d in node.decorator_list:
                    d_str = ""
                    if hasattr(ast, "unparse"):
                        d_str = ast.unparse(d)
                    elif isinstance(d, ast.Name):
                        d_str = d.id
                    elif isinstance(d, ast.Attribute):
                        d_str = f"{getattr(d.value, 'id', '')}.{d.attr}"
                    elif isinstance(d, ast.Call):
                        d_str = getattr(d.func, "id", "") or getattr(d.func, "attr", "")

                    if d_str:
                        decorators.append(f"@{d_str}")
                        if any(k in d_str.lower() for k in ["app.", "router.", "api_router.", "get", "post", "put", "delete", "patch"]):
                            is_endpoint = True

                args = [a.arg for a in node.args.args]
                prefix = "async " if isinstance(node, ast.AsyncFunctionDef) else ""
                args_str = ", ".join(args)
                sig = f"{prefix}def {node.name}({args_str})"
                doc = ast.get_docstring(node)
                first_doc_line = doc.split("\n")[0].strip() if doc else ""

                symbols.append({
                    "name": node.name,
                    "type": "endpoint" if is_endpoint else "function",
                    "file_path": file_path,
                    "line_number": node.lineno,
                    "signature": sig,
                    "docstring": first_doc_line,
                    "decorators": decorators
                })
            elif isinstance(node, ast.ClassDef):
                bases = []
                for b in node.bases:
                    if hasattr(ast, "unparse"):
                        bases.append(ast.unparse(b))
                    elif isinstance(b, ast.Name):
                        bases.append(b.id)

                doc = ast.get_docstring(node)
                first_doc_line = doc.split("\n")[0].strip() if doc else ""
                bases_str = ", ".join(bases)
                sig = f"class {node.name}({bases_str})" if bases else f"class {node.name}"

                symbols.append({
                    "name": node.name,
                    "type": "class",
                    "file_path": file_path,
                    "line_number": node.lineno,
                    "signature": sig,
                    "docstring": first_doc_line,
                    "bases": bases
                })
        return symbols

    @staticmethod
    def _extract_ts_js_symbols(code: str, file_path: str) -> List[Dict[str, Any]]:
        symbols = []
        lines = code.split("\n")

        func_pattern = re.compile(r'^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(([^)]*)\)')
        arrow_pattern = re.compile(r'^\s*(?:export\s+)?const\s+([A-Za-z0-9_$]+)(?:\s*:\s*([A-Za-z0-9_$.<>\[\]]+))?\s*=\s*(?:async\s*)?\(([^)]*)\)\s*(?:=>|\{)')
        type_pattern = re.compile(r'^\s*(?:export\s+)?(class|interface|type)\s+([A-Za-z0-9_$]+)(?:\s+extends\s+([A-Za-z0-9_$,\s]+))?')
        route_pattern = re.compile(r'^\s*(?:app|router)\.(get|post|put|delete|patch)\(\s*[\'"`]([^\'"`]+)[\'"`]')

        for idx, line in enumerate(lines, start=1):
            m_func = func_pattern.match(line)
            if m_func:
                name, args = m_func.group(1), m_func.group(2)
                symbols.append({
                    "name": name,
                    "type": "function",
                    "file_path": file_path,
                    "line_number": idx,
                    "signature": f"function {name}({args.strip()})",
                    "docstring": ""
                })
                continue

            m_arrow = arrow_pattern.match(line)
            if m_arrow:
                name, type_annot, args = m_arrow.group(1), m_arrow.group(2) or "", m_arrow.group(3) or ""
                sym_type = "component" if type_annot and "FC" in type_annot or name[0].isupper() else "function"
                sig = f"const {name}: {type_annot}" if type_annot else f"const {name} = ({args.strip()})"
                symbols.append({
                    "name": name,
                    "type": sym_type,
                    "file_path": file_path,
                    "line_number": idx,
                    "signature": sig,
                    "docstring": ""
                })
                continue

            m_type = type_pattern.match(line)
            if m_type:
                kind, name, extends_clause = m_type.group(1), m_type.group(2), m_type.group(3) or ""
                ext_str = f" extends {extends_clause}" if extends_clause else ""
                symbols.append({
                    "name": name,
                    "type": kind,
                    "file_path": file_path,
                    "line_number": idx,
                    "signature": f"{kind} {name}{ext_str}",
                    "docstring": ""
                })
                continue

            m_route = route_pattern.match(line)
            if m_route:
                method, path = m_route.group(1).upper(), m_route.group(2)
                symbols.append({
                    "name": f"{method} {path}",
                    "type": "endpoint",
                    "file_path": file_path,
                    "line_number": idx,
                    "signature": f"{method} {path}",
                    "docstring": ""
                })

        return symbols

    @staticmethod
    def find_symbols(
        workspace_path: Path,
        name_pattern: str = "",
        symbol_type: Optional[str] = None,
        file_pattern: Optional[str] = None,
        max_results: int = 60
    ) -> Dict[str, Any]:
        """
        Extract and query code symbols (functions, classes, routes, interfaces) across the workspace using AST indexing.
        Cached on-demand per workspace to avoid re-parsing unchanged files.
        """
        cache_file = workspace_path / ".cyclode_symbols_cache.json"
        cache_data: Dict[str, Any] = {"files": {}}
        if cache_file.exists():
            try:
                cache_data = json.loads(cache_file.read_text(encoding="utf-8"))
            except Exception:
                cache_data = {"files": {}}

        ignored_dirs = {
            ".git", "node_modules", "venv", ".venv", "__pycache__",
            "dist", "build", ".next", ".cache", ".pytest_cache", ".gemini", "assets"
        }
        supported_exts = {".py", ".ts", ".tsx", ".js", ".jsx"}

        updated_cache = False
        all_symbols = []

        for root, dirs, files in os.walk(workspace_path):
            dirs[:] = [d for d in dirs if d not in ignored_dirs and not d.startswith(".")]
            rel_root = Path(root).relative_to(workspace_path)

            for f in files:
                p = Path(f)
                ext = p.suffix.lower()
                if ext not in supported_exts or f.startswith("."):
                    continue

                rel_file_path = str(rel_root / f) if str(rel_root) != "." else f
                full_path = Path(root) / f

                try:
                    mtime = full_path.stat().st_mtime
                    file_cache = cache_data.get("files", {}).get(rel_file_path)

                    if file_cache and file_cache.get("mtime") == mtime:
                        file_symbols = file_cache.get("symbols", [])
                    else:
                        content = full_path.read_text(encoding="utf-8", errors="ignore")
                        if ext == ".py":
                            file_symbols = WorkspaceTools._extract_python_symbols(content, rel_file_path)
                        else:
                            file_symbols = WorkspaceTools._extract_ts_js_symbols(content, rel_file_path)

                        if "files" not in cache_data:
                            cache_data["files"] = {}
                        cache_data["files"][rel_file_path] = {
                            "mtime": mtime,
                            "symbols": file_symbols
                        }
                        updated_cache = True

                    all_symbols.extend(file_symbols)
                except Exception:
                    continue

        if updated_cache:
            try:
                cache_file.write_text(json.dumps(cache_data), encoding="utf-8")
            except Exception:
                pass

        filtered = []
        name_lower = name_pattern.lower().strip() if name_pattern else ""
        type_lower = symbol_type.lower().strip() if symbol_type else ""

        for sym in all_symbols:
            if name_lower and name_lower not in sym["name"].lower():
                continue
            if type_lower and sym["type"].lower() != type_lower:
                continue
            if file_pattern and not fnmatch.fnmatch(sym["file_path"], file_pattern):
                continue
            filtered.append(sym)
            if len(filtered) >= max_results:
                break

        return {
            "query": name_pattern,
            "filter_type": symbol_type,
            "total_found": len(filtered),
            "symbols": filtered
        }

    @staticmethod
    def tgrep_ast(
        workspace_path: Path,
        pattern: str,
        language: Optional[str] = None,
        max_results: int = 30
    ) -> Dict[str, Any]:
        """
        Structural AST search for language patterns (e.g. decorators @app.post, class inheritance, function calls).
        """
        if not pattern or not pattern.strip():
            return {"error": "AST search pattern cannot be empty", "matches": []}

        pattern_clean = pattern.strip()
        matches = []

        symbols_res = WorkspaceTools.find_symbols(workspace_path, max_results=200)
        symbols = symbols_res.get("symbols", [])

        if pattern_clean.startswith("@"):
            dec_query = pattern_clean[1:].lower()
            for s in symbols:
                decs = s.get("decorators", [])
                if any(dec_query in d.lower() for d in decs):
                    matches.append({
                        "file_path": s["file_path"],
                        "line_number": s["line_number"],
                        "symbol": s["name"],
                        "type": s["type"],
                        "signature": s["signature"],
                        "decorators": decs
                    })
                    if len(matches) >= max_results:
                        break

        elif pattern_clean.startswith("class:") or pattern_clean.startswith("extends:"):
            base_query = pattern_clean.split(":", 1)[1].strip().lower()
            for s in symbols:
                if s["type"] == "class":
                    bases = [b.lower() for b in s.get("bases", [])]
                    if any(base_query in b for b in bases):
                        matches.append({
                            "file_path": s["file_path"],
                            "line_number": s["line_number"],
                            "symbol": s["name"],
                            "type": "class",
                            "signature": s["signature"],
                            "bases": s.get("bases", [])
                        })
                        if len(matches) >= max_results:
                            break

        if not matches:
            for s in symbols:
                if pattern_clean.lower() in s["name"].lower() or pattern_clean.lower() in s["signature"].lower():
                    matches.append({
                        "file_path": s["file_path"],
                        "line_number": s["line_number"],
                        "symbol": s["name"],
                        "type": s["type"],
                        "signature": s["signature"]
                    })
                    if len(matches) >= max_results:
                        break

        return {
            "pattern": pattern,
            "total_matches": len(matches),
            "matches": matches
        }

    @staticmethod
    async def fetch_url(url: str, timeout: float = 10.0) -> Dict[str, Any]:
        """
        Fetches live web content, cleans up HTML, and extracts readable text.
        """
        try:
            headers = {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
            }
            
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
        
        months_pat = r"january|february|march|april|may|june|july|august|september|october|november|december"
        research_wrapper = r"articles?|papers?|essays?|posts?|blogs?|discussions?|literature|benchmarks?|findings?|studies|get|find|fetch|lookup|show"
        entity_query = re.sub(
            rf"\b(news|announcements|announcement|latest|today|yesterday|tonight|this morning|this week|this month|this year|recently|recent|releases|update|updates|what happened|what is happening|what is happening at|what happened at|what happened with|esp the last weeks|especially the last weeks|in the last weeks|over the last weeks|last weeks|last week|tell me about|provide a summary of|summary of|2023|2024|2025|2026|{research_wrapper}|{months_pat})\b",
            "",
            clean_q,
            flags=re.IGNORECASE
        ).strip()
        entity_query = re.sub(r"^(?:at|with|about|for|in|on|to|of)\s+", "", entity_query).strip()
        entity_query = re.sub(r"(?:,\s*)?(?:esp(?:ecially)?\s+)?(?:the\s+)?(?:last|recent|past)\s+(?:weeks?|months?|days?|year)\s*$", "", entity_query, flags=re.IGNORECASE).strip()
        entity_query = entity_query.strip("'\"`").strip()
        entity_query = re.sub(r"\s+", " ", entity_query).strip()
        if not entity_query:
            entity_query = clean_q.strip("'\"`").strip()

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
            
            if entity_query == "cursor":
                if any(bad in title_lower for bad in ("mouse cursor", "windows 95", "win95", "sql cursor", "database cursor")):
                    return False
            
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
                                    if dt.tzinfo is None:
                                        raw_dt = dt.replace(tzinfo=timezone.utc)
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

    @staticmethod
    def _parse_repo(repository: Optional[str]) -> Tuple[str, str]:
        if not repository or not repository.strip():
            return "org", "repo"
        clean = repository.strip().replace(".git", "")
        if "github.com/" in clean:
            clean = clean.split("github.com/")[-1]
        if "/" in clean:
            parts = clean.split("/", 1)
            return parts[0], parts[1]
        return "org", clean

    @classmethod
    async def get_pull_request_details(cls, repository: str, pr_number: int) -> Dict[str, Any]:
        """
        Retrieves complete pull request metadata, description, branches, and modified files list.
        """
        from app.integrations.github_client import github_client
        from app.integrations.manager import integration_manager
        owner, repo = cls._parse_repo(repository)
        token = await integration_manager.get_github_token_for_repo(f"{owner}/{repo}")
        
        pr_data = await github_client.get_pull_request(owner, repo, pr_number, custom_token=token)
        files_data = await github_client.get_pull_request_files(owner, repo, pr_number, custom_token=token)
        
        return {
            "repository": f"{owner}/{repo}",
            "number": pr_number,
            "title": pr_data.get("title", f"Pull Request #{pr_number}"),
            "state": pr_data.get("state", "open"),
            "author": pr_data.get("user", {}).get("login", "unknown") if isinstance(pr_data.get("user"), dict) else "unknown",
            "head_branch": pr_data.get("head", {}).get("ref", "") if isinstance(pr_data.get("head"), dict) else "",
            "base_branch": pr_data.get("base", {}).get("ref", "main") if isinstance(pr_data.get("base"), dict) else "main",
            "body": pr_data.get("body", ""),
            "html_url": pr_data.get("html_url", f"https://github.com/{owner}/{repo}/pull/{pr_number}"),
            "changed_files_count": len(files_data),
            "files": [
                {
                    "filename": f.get("filename"),
                    "status": f.get("status"),
                    "additions": f.get("additions", 0),
                    "deletions": f.get("deletions", 0),
                    "patch": f.get("patch", "")[:1000] if f.get("patch") else ""
                }
                for f in files_data
            ]
        }

    @classmethod
    async def get_pull_request_diff(cls, repository: str, pr_number: int) -> Dict[str, Any]:
        """
        Fetches the full unified code diff for a specific pull request.
        """
        from app.integrations.github_client import github_client
        from app.integrations.manager import integration_manager
        owner, repo = cls._parse_repo(repository)
        token = await integration_manager.get_github_token_for_repo(f"{owner}/{repo}")
        
        diff_text = await github_client.get_pull_request_diff(owner, repo, pr_number, custom_token=token)
        return {
            "repository": f"{owner}/{repo}",
            "number": pr_number,
            "diff": diff_text,
            "length_bytes": len(diff_text)
        }

    @classmethod
    async def list_pull_requests(
        cls,
        repository: str,
        state: str = "open",
        author: Optional[str] = None,
        limit: int = 10
    ) -> Dict[str, Any]:
        """
        Lists pull requests in a GitHub repository filtered by status and optional author.
        """
        from app.integrations.github_client import github_client
        from app.integrations.manager import integration_manager
        owner, repo = cls._parse_repo(repository)
        token = await integration_manager.get_github_token_for_repo(f"{owner}/{repo}")
        
        prs = await github_client.list_pull_requests(owner, repo, state=state, custom_token=token)
        
        filtered = []
        for p in prs:
            if author:
                p_author = p.get("user", {}).get("login", "") if isinstance(p.get("user"), dict) else str(p.get("user") or "")
                if author.lower().replace("@", "") != p_author.lower():
                    continue
            filtered.append({
                "number": p.get("number"),
                "title": p.get("title"),
                "author": p.get("user", {}).get("login", "unknown") if isinstance(p.get("user"), dict) else "unknown",
                "state": p.get("state"),
                "head_branch": p.get("head", {}).get("ref") if isinstance(p.get("head"), dict) else "",
                "base_branch": p.get("base", {}).get("ref") if isinstance(p.get("base"), dict) else "",
                "html_url": p.get("html_url"),
                "additions": p.get("additions", 0),
                "deletions": p.get("deletions", 0)
            })
            if len(filtered) >= limit:
                break
                
        return {
            "repository": f"{owner}/{repo}",
            "total_found": len(filtered),
            "pull_requests": filtered
        }

    @classmethod
    async def post_pull_request_review(
        cls,
        repository: str,
        pr_number: int,
        body: str,
        event: str = "COMMENT"
    ) -> Dict[str, Any]:
        """
        Submits an AI code review or comment to a GitHub pull request.
        """
        from app.integrations.github_client import github_client
        from app.integrations.manager import integration_manager
        owner, repo = cls._parse_repo(repository)
        token = await integration_manager.get_github_token_for_repo(f"{owner}/{repo}")
        
        res = await github_client.post_pull_request_review(
            owner=owner,
            repo=repo,
            pull_number=pr_number,
            body=body,
            event=event,
            custom_token=token
        )
        return res

    @classmethod
    async def post_pull_request_line_comment(
        cls,
        repository: str,
        pr_number: int,
        body: str,
        commit_sha: str,
        path: str,
        line: int,
        side: str = "RIGHT"
    ) -> Dict[str, Any]:
        """
        Submits an inline review comment on a specific line of code in a GitHub pull request.
        """
        from app.integrations.github_client import github_client
        from app.integrations.manager import integration_manager
        owner, repo = cls._parse_repo(repository)
        token = await integration_manager.get_github_token_for_repo(f"{owner}/{repo}")
        
        res = await github_client.post_pull_request_line_comment(
            owner=owner,
            repo=repo,
            pull_number=pr_number,
            body=body,
            commit_sha=commit_sha,
            path=path,
            line=line,
            side=side,
            custom_token=token
        )
        return res

    @classmethod
    async def create_pull_request(
        cls,
        repository: str,
        title: str,
        body: str,
        head_branch: str,
        base_branch: Optional[str] = "main"
    ) -> Dict[str, Any]:
        """
        Creates a new pull request on GitHub.
        """
        from app.integrations.github_client import github_client
        from app.integrations.manager import integration_manager
        owner, repo = cls._parse_repo(repository)
        token = await integration_manager.get_github_token_for_repo(f"{owner}/{repo}")
        
        res = await github_client.create_pull_request(
            owner=owner,
            repo=repo,
            title=title,
            body=body,
            head_branch=head_branch,
            base_branch=base_branch or "main",
            custom_token=token
        )
        return res

    @classmethod
    async def connect_repository(
        cls,
        repo_url: str,
        token: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Connects and vaults a GitHub repository, verifying remote branch access.
        """
        from app.integrations.manager import integration_manager
        test_res = await integration_manager.test_remote_repo(repo_url, token)
        if test_res.get("accessible"):
            save_res = await integration_manager.save_repo_config(
                repo_url=repo_url,
                token=token,
                branches=test_res.get("branches"),
                default_branch=test_res.get("default_branch")
            )
            return {
                "success": True,
                "message": f"Successfully connected repository {save_res.get('full_name')}",
                "default_branch": test_res.get("default_branch"),
                "branches": test_res.get("branches")
            }
        return {
            "success": False,
            "message": test_res.get("message", "Failed to connect repository"),
            "auth_required": test_res.get("auth_required", False)
        }
