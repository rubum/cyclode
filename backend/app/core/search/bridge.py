import os
import re
import json
import shutil
import logging
import fnmatch
import subprocess
from pathlib import Path
from typing import Dict, Any, List, Optional

logger = logging.getLogger("cyclode.search")


class SearchBridge:
    """
    Unified 3-Tier Code Search & AST Intelligence Dispatcher:
      Tier 1: Native Rust Engine (cyclode-search / cyclode-searchd via PyO3 or CLI)
      Tier 2: High-throughput Ripgrep (rg --json)
      Tier 3: Pure Python resilient fallback
    """

    _rust_binary_path: Optional[Path] = None
    _pyo3_available: Optional[bool] = None

    @classmethod
    def _get_rust_binary(cls) -> Optional[Path]:
        if cls._rust_binary_path and cls._rust_binary_path.exists():
            return cls._rust_binary_path

        # 1. Check system PATH
        which_path = shutil.which("cyclode-searchd")
        if which_path:
            cls._rust_binary_path = Path(which_path)
            return cls._rust_binary_path

        # 2. Check local package bin directory (e.g. cyclode/bin/cyclode-searchd)
        import sys
        venv_bin = Path(sys.prefix) / "bin" / "cyclode-searchd"
        if venv_bin.exists():
            cls._rust_binary_path = venv_bin
            return cls._rust_binary_path

        pkg_bin = Path(__file__).resolve().parents[2] / "cyclode" / "bin" / "cyclode-searchd"
        if pkg_bin.exists():
            cls._rust_binary_path = pkg_bin
            return cls._rust_binary_path

        # 3. Check local repo build paths
        repo_target = Path(__file__).resolve().parents[4] / "crates" / "cyclode-search" / "target" / "release" / "cyclode-searchd"
        if repo_target.exists():
            cls._rust_binary_path = repo_target
            return cls._rust_binary_path

        debug_target = Path(__file__).resolve().parents[4] / "crates" / "cyclode-search" / "target" / "debug" / "cyclode-searchd"
        if debug_target.exists():
            cls._rust_binary_path = debug_target
            return cls._rust_binary_path

        return None

    @classmethod
    def _is_pyo3_available(cls) -> bool:
        if cls._pyo3_available is not None:
            return cls._pyo3_available
        try:
            import cyclode_search  # type: ignore
            cls._pyo3_available = True
        except ImportError:
            cls._pyo3_available = False
        return cls._pyo3_available

    @classmethod
    def search_text(
        cls,
        workspace_path: Path,
        query: str,
        is_regex: bool = False,
        case_sensitive: bool = False,
        max_results: int = 50,
        current_file: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Executes text / regex search across the workspace, prioritizing current_file matches.
        """
        if not query or not query.strip():
            return {"error": "Query string cannot be empty", "matches": []}

        ws_path = workspace_path.resolve()

        # 1. Tier 1: Try Native Rust Engine
        rust_bin = cls._get_rust_binary()
        if rust_bin:
            try:
                cmd = [
                    str(rust_bin),
                    "search",
                    "--workspace", str(ws_path),
                    "--query", query,
                    "--max-results", str(max_results)
                ]
                if is_regex:
                    cmd.append("--is-regex")
                if case_sensitive:
                    cmd.append("--case-sensitive")
                if current_file:
                    cmd.extend(["--current-file", current_file.strip().lstrip("/")])

                proc = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=15
                )
                if proc.returncode == 0 and proc.stdout.strip():
                    data = json.loads(proc.stdout)
                    data["engine"] = "rust_native"
                    return data
            except Exception as e:
                logger.debug(f"Native Rust search fallback triggered: {e}")

        # 2. Tier 2: Try Ripgrep (rg --json)
        rg_bin = shutil.which("rg")
        if rg_bin:
            try:
                res = cls._search_ripgrep(
                    ws_path,
                    query,
                    is_regex=is_regex,
                    case_sensitive=case_sensitive,
                    max_results=max_results,
                    current_file=current_file
                )
                if res and "matches" in res:
                    res["engine"] = "ripgrep"
                    return res
            except Exception as e:
                logger.debug(f"Ripgrep search fallback triggered: {e}")

        # 3. Tier 3: Pure Python Fallback
        from app.agent.tools import WorkspaceTools
        res = WorkspaceTools._search_code_pure_python(
            ws_path,
            query,
            is_regex=is_regex,
            case_sensitive=case_sensitive,
            max_results=max_results,
            current_file=current_file
        )
        res["engine"] = "python_fallback"
        return res

    @classmethod
    def _search_ripgrep(
        cls,
        workspace_path: Path,
        query: str,
        is_regex: bool = False,
        case_sensitive: bool = False,
        max_results: int = 50,
        current_file: Optional[str] = None
    ) -> Dict[str, Any]:
        flags = []
        if not case_sensitive:
            flags.append("-i")
        if not is_regex:
            flags.append("-F")

        cmd = [
            "rg",
            "--json",
            "--max-count", str(max_results * 2),
            "-g", "!.git",
            "-g", "!node_modules",
            "-g", "!dist",
            "-g", "!build",
            "-g", "!__pycache__",
            "-g", "!_build",
            "-g", "!deps",
        ] + flags + [query, "."]

        proc = subprocess.run(
            cmd,
            cwd=workspace_path,
            capture_output=True,
            text=True,
            timeout=10
        )

        current_file_matches = []
        workspace_matches = []
        norm_curr = current_file.strip().lstrip("/") if current_file else None

        for line in proc.stdout.splitlines():
            try:
                msg = json.loads(line)
                if msg.get("type") == "match":
                    data = msg.get("data", {})
                    path_str = data.get("path", {}).get("text", "")
                    line_num = data.get("line_number", 1)
                    line_content = data.get("lines", {}).get("text", "").rstrip("\r\n")

                    match_obj = {
                        "file_path": path_str,
                        "line_number": line_num,
                        "line_content": line_content
                    }

                    if norm_curr and (path_str == norm_curr or path_str.endswith(norm_curr)):
                        current_file_matches.append(match_obj)
                    else:
                        workspace_matches.append(match_obj)
            except Exception:
                continue

        combined = (current_file_matches + workspace_matches)[:max_results]
        return {
            "query": query,
            "total_matches": len(combined),
            "capped": len(combined) >= max_results,
            "matches": combined
        }

    @classmethod
    def search_ast(
        cls,
        workspace_path: Path,
        pattern: str,
        max_results: int = 50,
        current_file: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Executes structural AST symbol search across workspace with active file prioritization.
        """
        if not pattern or not pattern.strip():
            return {"error": "Pattern cannot be empty", "matches": []}

        ws_path = workspace_path.resolve()

        # 1. Tier 1: Try Native Rust Engine
        rust_bin = cls._get_rust_binary()
        if rust_bin:
            try:
                cmd = [
                    str(rust_bin),
                    "ast",
                    "--workspace", str(ws_path),
                    "--pattern", pattern,
                    "--max-results", str(max_results)
                ]
                if current_file:
                    cmd.extend(["--current-file", current_file.strip().lstrip("/")])

                proc = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=15
                )
                if proc.returncode == 0 and proc.stdout.strip():
                    data = json.loads(proc.stdout)
                    data["engine"] = "rust_native"
                    return data
            except Exception as e:
                logger.debug(f"Native Rust AST search fallback triggered: {e}")

        # 2. Tier 2: Pure Python Polyglot AST Engine
        from app.agent.tools import WorkspaceTools
        res = WorkspaceTools._tgrep_ast_pure_python(
            ws_path,
            pattern,
            max_results=max_results,
            current_file=current_file
        )
        res["engine"] = "python_fallback"
        return res
