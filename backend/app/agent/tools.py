import os
import re
import ast
import json
import fnmatch
import subprocess
from pathlib import Path
from typing import Dict, Any, List, Optional


class WorkspaceTools:
    """
    Real tool executions inside the task workspace directory.
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
                    if hasattr(ast, 'unparse'):
                        d_str = ast.unparse(d)
                    elif isinstance(d, ast.Name):
                        d_str = d.id
                    elif isinstance(d, ast.Attribute):
                        d_str = f"{getattr(d.value, 'id', '')}.{d.attr}"
                    elif isinstance(d, ast.Call):
                        d_str = getattr(d.func, 'id', '') or getattr(d.func, 'attr', '')

                    if d_str:
                        decorators.append(f"@{d_str}")
                        if any(k in d_str.lower() for k in ["app.", "router.", "api_router.", "get", "post", "put", "delete", "patch"]):
                            is_endpoint = True

                args = [a.arg for a in node.args.args]
                sig = f"{'async ' if isinstance(node, ast.AsyncFunctionDef) else ''}def {node.name}({', '.join(args)})"
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
                    if hasattr(ast, 'unparse'):
                        bases.append(ast.unparse(b))
                    elif isinstance(b, ast.Name):
                        bases.append(b.id)

                doc = ast.get_docstring(node)
                first_doc_line = doc.split("\n")[0].strip() if doc else ""
                sig = f"class {node.name}({', '.join(bases)})" if bases else f"class {node.name}"

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

        # Function declarations
        func_pattern = re.compile(r'^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(([^)]*)\)')
        # Arrow function components or constants
        arrow_pattern = re.compile(r'^\s*(?:export\s+)?const\s+([A-Za-z0-9_$]+)(?:\s*:\s*([A-Za-z0-9_$.<>\[\]]+))?\s*=\s*(?:async\s*)?\(([^)]*)\)\s*(?:=>|\{)')
        # Classes, Interfaces, Types
        type_pattern = re.compile(r'^\s*(?:export\s+)?(class|interface|type)\s+([A-Za-z0-9_$]+)(?:\s+extends\s+([A-Za-z0-9_$,\s]+))?')
        # Express / Fastify routes
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
                symbols.append({
                    "name": name,
                    "type": kind,
                    "file_path": file_path,
                    "line_number": idx,
                    "signature": f"{kind} {name}{' extends ' + extends_clause if extends_clause else ''}",
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

        # Filter by name_pattern, symbol_type, file_pattern
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

        # Find matching symbols or AST structures
        symbols_res = WorkspaceTools.find_symbols(workspace_path, max_results=200)
        symbols = symbols_res.get("symbols", [])

        # Check for decorator search: e.g. @app.get or @router
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

        # Check for class inheritance search: e.g. class:BaseModel or extends:BaseModel
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

        # Fallback: structural symbol or code search
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

