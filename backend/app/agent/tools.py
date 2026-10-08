import os
import re
import ast
import json
import csv
import sqlite3
import zipfile
import tarfile
import fnmatch
import subprocess
import html
import httpx
import asyncio
import base64
import mimetypes
import logging
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime, timezone
import urllib.parse

logger = logging.getLogger("cyclode.tools")


ANSI_ESCAPE_RE = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')


def compact_command_output(text: str, max_lines: int = 50, max_chars: int = 3500) -> str:
    """Strips ANSI sequences and applies middle-elision for long command outputs to preserve context tokens."""
    if not text:
        return ""
    clean = ANSI_ESCAPE_RE.sub("", text)
    lines = clean.splitlines()
    if len(lines) > max_lines:
        head = lines[:20]
        tail = lines[-30:]
        omitted = len(lines) - 50
        return "\n".join(head) + f"\n\n... [Omitted {omitted} lines of intermediate command logs] ...\n\n" + "\n".join(tail)
    if len(clean) > max_chars:
        return clean[:1200] + f"\n\n... [Omitted intermediate log content ({len(clean)} chars total)] ...\n\n" + clean[-1800:]
    return clean


class WorkspaceTools:
    """
    Real tool executions inside the task workspace directory and live web intelligence.
    """

    @staticmethod
    def list_dir(workspace_path: Path, subpath: str = ".") -> Dict[str, Any]:
        ws_root = workspace_path.resolve()
        target = (ws_root / subpath).resolve()
        if not target.is_relative_to(ws_root):
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
    def read_file(
        workspace_path: Path,
        file_path: str,
        start_line: Optional[int] = None,
        end_line: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Reads file content from workspace.
        Prefers inspecting full file in a single turn without line slices unless the file is massive (>500KB).
        """
        if not file_path or not str(file_path).strip():
            return {"error": "file_path cannot be empty"}
        clean_path = str(file_path).strip().lstrip("/")
        if clean_path.startswith("./"):
            clean_path = clean_path[2:]
        if not clean_path:
            return {"error": "Invalid file_path (points to workspace root)"}
        ws_root = workspace_path.resolve()
        target = (ws_root / clean_path).resolve()
        if not target.is_relative_to(ws_root):
            return {"error": "Access denied outside workspace"}
        if not target.exists() or not target.is_file():
            alt_target = (ws_root / ".cyclode" / "attachments" / Path(clean_path).name).resolve()
            if alt_target.exists() and alt_target.is_file() and alt_target.is_relative_to(ws_root):
                target = alt_target
            else:
                return {"error": f"File '{clean_path}' not found"}

        lockfiles = {"package-lock.json", "pnpm-lock.yaml", "yarn.lock", "Cargo.lock", "poetry.lock", "composer.lock", "Pipfile.lock"}
        minified_exts = {".min.js", ".min.css", ".map", ".bundle.js"}

        filename = target.name.lower()
        is_lockfile = filename in lockfiles
        is_minified = any(filename.endswith(ext) for ext in minified_exts)

        if filename.endswith((".docx", ".doc")):
            try:
                from app.api.tasks import _parse_docx_native
                parsed = _parse_docx_native(target)
                raw_text = parsed.get("text", "")
                lines = raw_text.splitlines()
                if not lines:
                    lines = ["[Document is empty]"]
                total_lines = len(lines)
                formatted = "\n".join(f"{i+1:4d} | {l}" for i, l in enumerate(lines))
                return {
                    "file_path": file_path,
                    "content": f"[Microsoft Word Document: {target.name} ({parsed.get('words_count', 0)} words, {parsed.get('paragraphs_count', 0)} paragraphs)]\n\n{formatted}",
                    "total_lines": total_lines,
                    "is_binary": False
                }
            except Exception as e:
                return {
                    "file_path": file_path,
                    "content": f"[Error reading DOCX file: {str(e)}]",
                    "total_lines": 0,
                    "is_binary": True
                }

        try:
            # Check for binary file by inspecting initial 4KB buffer
            try:
                with open(target, "rb") as bf:
                    if b"\x00" in bf.read(4096):
                        return {
                            "file_path": file_path,
                            "content": f"[Notice: '{file_path}' is a binary file ({target.stat().st_size} bytes). Binary files cannot be inspected as text.]",
                            "total_lines": 0,
                            "is_binary": True
                        }
            except Exception:
                pass

            raw_text = target.read_text(encoding="utf-8", errors="ignore")
            lines = raw_text.splitlines()
            total_lines = len(lines)

            # Sanitize runaway single lines (>1000 chars)
            sanitized_lines = [
                line if len(line) <= 1000 else (line[:1000] + " ... [Line truncated: length exceeded 1000 characters]")
                for line in lines
            ]

            MAX_READ_BYTES = 64 * 1024

            if (is_lockfile or is_minified) and start_line is None and end_line is None:
                head_slice = "\n".join(sanitized_lines[:50])
                msg = (
                    f"[Notice: '{file_path}' is a generated lockfile or bundle ({total_lines} lines, {len(raw_text)} bytes). "
                    "Truncated to protect token context. Inspect manifest files (e.g. package.json, pyproject.toml) or specify start_line/end_line.]\n\n"
                    f"{head_slice}\n\n... [Remaining {total_lines - 50} lines omitted] ..."
                )
                return {"file_path": file_path, "content": msg, "total_lines": total_lines, "truncated": True}

            if start_line is not None or end_line is not None:
                s = max(1, start_line or 1)
                e = min(total_lines, end_line or total_lines)
                if s > total_lines:
                    return {"file_path": file_path, "content": f"(File has {total_lines} lines; start_line {s} is beyond EOF)", "total_lines": total_lines}
                sliced = sanitized_lines[s - 1 : e]
                content = "\n".join(f"{s + i}: {line}" for i, line in enumerate(sliced))
                if len(content) > MAX_READ_BYTES:
                    content = content[:MAX_READ_BYTES] + f"\n\n... [Content truncated at {MAX_READ_BYTES} bytes. Specify a smaller start_line/end_line range] ..."
                return {"file_path": file_path, "content": content, "start_line": s, "end_line": e, "total_lines": total_lines}

            if total_lines > 250:
                head = "\n".join(sanitized_lines[:250])
                msg = (
                    f"{head}\n\n... [File truncated at line 250 of {total_lines}. Use start_line=251, end_line={min(total_lines, 500)} to view next chunk] ..."
                )
                if len(msg) > MAX_READ_BYTES:
                    msg = msg[:MAX_READ_BYTES] + f"\n\n... [Content truncated at {MAX_READ_BYTES} bytes] ..."
                return {"file_path": file_path, "content": msg, "total_lines": total_lines, "truncated": True}

            content = "\n".join(sanitized_lines)
            if len(content) > MAX_READ_BYTES:
                content = content[:MAX_READ_BYTES] + f"\n\n... [Content truncated at {MAX_READ_BYTES} bytes] ..."
            return {"file_path": file_path, "content": content, "total_lines": total_lines}
        except Exception as e:
            return {"error": str(e)}

    @staticmethod
    def edit_file(workspace_path: Path, file_path: str, content: str, append: bool = False) -> Dict[str, Any]:
        if not file_path or not str(file_path).strip():
            return {"error": "file_path cannot be empty"}
        if content is None or (not append and not str(content).strip()):
            return {"error": "content cannot be empty. Provide the complete file implementation when calling edit_file."}
        clean_path = str(file_path).strip().lstrip("/")
        if clean_path.startswith("./"):
            clean_path = clean_path[2:]
        if not clean_path:
            return {"error": "Invalid file_path (points to workspace root)"}
        ws_root = workspace_path.resolve()
        target = (ws_root / clean_path).resolve()
        if not target.is_relative_to(ws_root):
            return {"error": "Access denied outside workspace"}
        if target.exists() and target.is_dir():
            return {"error": f"Target path '{clean_path}' is a directory, not a file"}

        target.parent.mkdir(parents=True, exist_ok=True)
        if append and target.exists() and target.is_file():
            # CoW protection on append: if file is a shared hardlink, unlink first to write to a private inode
            if target.stat().st_nlink > 1:
                orig_content = target.read_text(encoding="utf-8", errors="ignore")
                target.unlink()
                target.write_text(orig_content + content, encoding="utf-8")
            else:
                with target.open("a", encoding="utf-8") as f:
                    f.write(content)
            return {"file_path": clean_path, "status": "appended", "bytes": len(content), "total_bytes": target.stat().st_size}

        # CoW protection: if file is a shared hardlink, unlink first to write to a new private inode
        if target.exists() and target.is_file() and target.stat().st_nlink > 1:
            target.unlink()
        target.write_text(content, encoding="utf-8")
        return {"file_path": clean_path, "status": "written", "bytes": len(content)}

    @staticmethod
    def _fuzzy_search_and_replace(
        original: str,
        target_content: str,
        replacement_content: str,
        allow_multiple: bool = False
    ) -> Tuple[Optional[str], int, Optional[str]]:
        """
        Performs multi-tiered search and replace:
        1. Exact substring match
        2. Line ending / trailing whitespace normalized match
        3. Indentation-tolerant matching (preserving file's base indentation)
        4. Anchor-based block match (matching top/bottom anchors for resilient block replacement)
        
        Returns (updated_text, replacements_count, error_message).
        """
        if not target_content:
            return None, 0, "target_content cannot be empty"

        # Tier 1: Exact Match
        count = original.count(target_content)
        if count >= 1:
            if count > 1 and not allow_multiple:
                return None, 0, f"Target content matched {count} times. Provide a more unique block of context or set allow_multiple=True."
            updated = original.replace(target_content, replacement_content) if allow_multiple else original.replace(target_content, replacement_content, 1)
            return updated, count if allow_multiple else 1, None

        # Normalization helper
        def normalize_lines(text: str) -> List[str]:
            return [line.rstrip() for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n")]

        orig_lines = normalize_lines(original)
        target_lines = normalize_lines(target_content)

        if not target_lines or not orig_lines:
            return None, 0, "Target content not found in file."

        t_len = len(target_lines)
        matches: List[Tuple[int, int]] = []  # List of (start_idx, end_idx) inclusive

        # Tier 2 Search: Exact normalized line matches
        for i in range(len(orig_lines) - t_len + 1):
            if orig_lines[i : i + t_len] == target_lines:
                matches.append((i, i + t_len - 1))

        # Tier 3 Search: Indentation-tolerant matching
        if not matches:
            first_target_non_empty = next((l for l in target_lines if l.strip()), "")
            target_indent = len(first_target_non_empty) - len(first_target_non_empty.lstrip())
            stripped_target = [l[target_indent:] if len(l) >= target_indent and l[:target_indent].isspace() else l.lstrip() for l in target_lines]

            for i in range(len(orig_lines) - t_len + 1):
                window = orig_lines[i : i + t_len]
                first_orig_non_empty = next((l for l in window if l.strip()), "")
                orig_indent = len(first_orig_non_empty) - len(first_orig_non_empty.lstrip())
                stripped_window = [l[orig_indent:] if len(l) >= orig_indent and l[:orig_indent].isspace() else l.lstrip() for l in window]
                
                if stripped_window == stripped_target:
                    matches.append((i, i + t_len - 1))

        # Tier 4 Search: Anchor-based matching (top 1-2 lines + bottom line)
        if not matches and t_len >= 2:
            non_empty_targets = [l.strip() for l in target_lines if l.strip()]
            if len(non_empty_targets) >= 2:
                first_anchor = non_empty_targets[0]
                second_anchor = non_empty_targets[1] if len(non_empty_targets) >= 3 else None
                last_anchor = non_empty_targets[-1]

                for i in range(len(orig_lines)):
                    if orig_lines[i].strip() == first_anchor:
                        if second_anchor and (i + 1 >= len(orig_lines) or orig_lines[i + 1].strip() != second_anchor):
                            continue
                        
                        max_search = min(len(orig_lines), i + max(t_len * 3, t_len + 30))
                        start_search_j = i + (2 if second_anchor else 1)
                        candidate_ends = []
                        for j in range(start_search_j, max_search):
                            if orig_lines[j].strip() == last_anchor:
                                candidate_ends.append(j)
                        
                        if len(candidate_ends) == 1:
                            matches.append((i, candidate_ends[0]))

        if not matches:
            return None, 0, "Target content not found in file. Ensure the code snippet matches the current file contents."

        if len(matches) > 1 and not allow_multiple:
            return None, 0, f"Target content matched {len(matches)} locations. Provide more unique surrounding context."

        # Apply replacements
        updated_lines = list(original.splitlines())
        has_trailing_newline = original.endswith("\n")
        newline_char = "\r\n" if "\r\n" in original else "\n"

        target_matches = matches if allow_multiple else [matches[0]]
        sorted_matches = sorted(target_matches, key=lambda m: m[0], reverse=True)
        repl_lines = replacement_content.splitlines()

        for start_idx, end_idx in sorted_matches:
            updated_lines[start_idx : end_idx + 1] = repl_lines

        final_text = newline_char.join(updated_lines)
        if has_trailing_newline and not final_text.endswith(newline_char):
            final_text += newline_char

        return final_text, len(sorted_matches), None

    @staticmethod
    def replace_file_content(
        workspace_path: Path,
        file_path: str,
        target_content: str,
        replacement_content: str,
        allow_multiple: bool = False
    ) -> Dict[str, Any]:
        if not file_path or not str(file_path).strip():
            return {"error": "file_path cannot be empty"}
        clean_path = str(file_path).strip().lstrip("/")
        if clean_path.startswith("./"):
            clean_path = clean_path[2:]
        if not clean_path:
            return {"error": "Invalid file_path (points to workspace root)"}
        ws_root = workspace_path.resolve()
        target = (ws_root / clean_path).resolve()
        if not target.is_relative_to(ws_root):
            return {"error": "Access denied outside workspace"}
        if not target.exists() or not target.is_file():
            return {"error": f"File '{clean_path}' not found"}

        try:
            original = target.read_text(encoding="utf-8")
            updated, count, err = WorkspaceTools._fuzzy_search_and_replace(
                original=original,
                target_content=target_content,
                replacement_content=replacement_content,
                allow_multiple=allow_multiple
            )
            if err or updated is None:
                return {"error": err or "Replacement failed"}

            # CoW protection: if file is a shared hardlink, unlink first to write to a new private inode
            if target.stat().st_nlink > 1:
                target.unlink()
            target.write_text(updated, encoding="utf-8")
            return {
                "file_path": file_path,
                "status": "replaced",
                "replacements_count": count,
                "bytes_written": len(updated.encode("utf-8"))
            }
        except Exception as e:
            return {"error": str(e)}

    @staticmethod
    def batch_replace_content(
        workspace_path: Path,
        edits: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Atomically applies multiple search-and-replace operations across one or more files
        in a single turn with atomic validation, rollback on error, and CoW hardlink protection.
        """
        if not edits:
            return {"error": "edits must be a non-empty list of replacement operations"}
        if isinstance(edits, dict):
            edits = [edits]
        elif not isinstance(edits, list):
            return {"error": "edits must be a non-empty list of replacement operations"}

        ws_root = workspace_path.resolve()
        
        # 1. Pre-validation phase: Check all file paths and target contents
        validated_operations = []
        files_to_read = set()

        for idx, edit in enumerate(edits):
            if not isinstance(edit, dict):
                return {"error": f"Edit at index {idx} must be an object"}
            
            f_path = (
                edit.get("file_path")
                or edit.get("path")
                or edit.get("filePath")
                or edit.get("target_file")
                or edit.get("filename")
                or edit.get("file")
            )
            t_content = (
                edit.get("target_content")
                if edit.get("target_content") is not None
                else (
                    edit.get("target")
                    if edit.get("target") is not None
                    else (
                        edit.get("search")
                        if edit.get("search") is not None
                        else (
                            edit.get("old_content")
                            if edit.get("old_content") is not None
                            else edit.get("oldContent")
                        )
                    )
                )
            )
            r_content = (
                edit.get("replacement_content")
                if edit.get("replacement_content") is not None
                else (
                    edit.get("replacement")
                    if edit.get("replacement") is not None
                    else (
                        edit.get("replace")
                        if edit.get("replace") is not None
                        else (
                            edit.get("new_content")
                            if edit.get("new_content") is not None
                            else (edit.get("newContent") or "")
                        )
                    )
                )
            )
            allow_mult = bool(edit.get("allow_multiple", edit.get("allowMultiple", False)))

            if not f_path or not isinstance(f_path, str) or not f_path.strip():
                return {"error": f"Edit at index {idx} missing valid 'file_path'"}
            if t_content is None or not isinstance(t_content, str) or not t_content:
                return {"error": f"Edit at index {idx} ('{f_path}') missing 'target_content'"}

            target_file = (ws_root / f_path.strip().lstrip("/")).resolve()
            if not target_file.is_relative_to(ws_root):
                return {"error": f"Access denied: '{f_path}' is outside workspace"}
            if not target_file.exists() or not target_file.is_file():
                return {"error": f"File '{f_path}' not found in workspace"}

            validated_operations.append({
                "file_path": f_path,
                "target_file": target_file,
                "target_content": t_content,
                "replacement_content": r_content,
                "allow_multiple": allow_mult
            })
            files_to_read.add(target_file)

        # 2. In-memory transaction phase: Apply edits to file buffers
        file_buffers = {}
        for tf in files_to_read:
            try:
                file_buffers[tf] = tf.read_text(encoding="utf-8")
            except Exception as e:
                return {"error": f"Failed reading file '{tf.name}': {str(e)}"}

        total_replacements = 0
        file_stats = {}

        for idx, op in enumerate(validated_operations):
            tf = op["target_file"]
            current_content = file_buffers[tf]
            updated_text, count, err = WorkspaceTools._fuzzy_search_and_replace(
                original=current_content,
                target_content=op["target_content"],
                replacement_content=op["replacement_content"],
                allow_multiple=op["allow_multiple"]
            )
            if err or updated_text is None:
                return {"error": f"Batch edit failed on '{op['file_path']}' (edit #{idx+1}): {err}"}

            file_buffers[tf] = updated_text
            total_replacements += count
            f_key = op["file_path"]
            file_stats[f_key] = file_stats.get(f_key, 0) + count

        # 3. Disk Flush Phase: Write all modified buffers atomically with CoW protection
        total_bytes = 0
        for tf, new_content in file_buffers.items():
            if tf.stat().st_nlink > 1:
                tf.unlink()
            tf.write_text(new_content, encoding="utf-8")
            total_bytes += len(new_content.encode("utf-8"))

        return {
            "status": "success",
            "modified_files_count": len(file_buffers),
            "modified_files": list(file_stats.keys()),
            "files_modified": list(file_stats.keys()),
            "total_replacements": total_replacements,
            "bytes_written": total_bytes,
            "details": [{"file_path": fp, "replacements": cnt} for fp, cnt in file_stats.items()]
        }

    @staticmethod
    def _apply_patch_pure_python(ws_root: Path, patch_text: str) -> List[str]:
        """
        Pure Python fallback unified diff patch applier.
        Parses standard unidiff hunks and modifies files in-memory before disk flush.
        """
        lines = patch_text.splitlines()
        file_patches: Dict[str, List[List[str]]] = {}
        current_file = None

        i = 0
        while i < len(lines):
            line = lines[i]
            if line.startswith("--- "):
                if i + 1 < len(lines) and lines[i + 1].startswith("+++ "):
                    dest_file = lines[i + 1][4:].strip()
                    if dest_file.startswith("b/") or dest_file.startswith("a/"):
                        dest_file = dest_file[2:]
                    dest_file = dest_file.split("\t")[0].strip()
                    current_file = dest_file
                    if current_file not in file_patches:
                        file_patches[current_file] = []
                    i += 2
                    continue
            if line.startswith("@@ ") and current_file:
                current_hunk = [line]
                i += 1
                while i < len(lines) and not lines[i].startswith("@@ ") and not lines[i].startswith("--- "):
                    current_hunk.append(lines[i])
                    i += 1
                file_patches[current_file].append(current_hunk)
                continue
            i += 1

        applied_files = []
        for rel_file, hunks in file_patches.items():
            target_path = (ws_root / rel_file).resolve()
            if not target_path.is_relative_to(ws_root):
                continue
            
            orig_text = target_path.read_text(encoding="utf-8") if target_path.exists() else ""
            file_lines = orig_text.splitlines()

            for hunk in hunks:
                if not hunk:
                    continue
                header = hunk[0]
                m = re.match(r'^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@', header)
                orig_start = (int(m.group(1)) - 1) if m else 0
                hunk_lines = hunk[1:]
                
                add_lines = []
                match_lines = []
                for hl in hunk_lines:
                    if hl.startswith("-"):
                        match_lines.append(hl[1:])
                    elif hl.startswith(" "):
                        match_lines.append(hl[1:])
                        add_lines.append(hl[1:])
                    elif hl.startswith("+"):
                        add_lines.append(hl[1:])

                pos = -1
                for test_pos in [orig_start, max(0, orig_start - 1), orig_start + 1]:
                    if 0 <= test_pos <= len(file_lines):
                        if not match_lines or file_lines[test_pos : test_pos + len(match_lines)] == match_lines:
                            pos = test_pos
                            break
                
                if pos == -1:
                    for idx in range(len(file_lines) - len(match_lines) + 1):
                        if file_lines[idx : idx + len(match_lines)] == match_lines:
                            pos = idx
                            break

                if pos != -1 and match_lines:
                    file_lines[pos : pos + len(match_lines)] = add_lines

            new_text = "\n".join(file_lines)
            if orig_text.endswith("\n") and not new_text.endswith("\n"):
                new_text += "\n"

            target_path.parent.mkdir(parents=True, exist_ok=True)
            if target_path.exists() and target_path.stat().st_nlink > 1:
                target_path.unlink()
            target_path.write_text(new_text, encoding="utf-8")
            applied_files.append(rel_file)

        return applied_files

    @staticmethod
    def apply_unified_patch(
        workspace_path: Path,
        patch_content: Optional[str] = None,
        patch: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Applies a multi-file unified diff patch atomically using git apply, patch CLI, or pure-Python patch engine.
        """
        raw_patch = patch_content if patch_content is not None else patch
        if not raw_patch or not raw_patch.strip():
            return {"error": "patch or patch_content cannot be empty"}

        ws_root = workspace_path.resolve()

        header_files = []
        for line in raw_patch.splitlines():
            if line.startswith("--- ") or line.startswith("+++ "):
                target_f = line[4:].strip()
                if target_f.startswith("a/") or target_f.startswith("b/"):
                    target_f = target_f[2:]
                target_f = target_f.split("\t")[0].strip()
                if target_f and target_f != "/dev/null":
                    header_files.append(target_f)
        unique_files = list(dict.fromkeys(header_files))

        # Try git apply
        for p_flag in ["-p0", "-p1"]:
            try:
                res = subprocess.run(
                    ["git", "apply", p_flag, "--unidiff-zero", "--whitespace=nowarn", "-"],
                    input=raw_patch,
                    text=True,
                    cwd=ws_root,
                    capture_output=True,
                    timeout=10
                )
                if res.returncode == 0:
                    return {
                        "status": "success",
                        "modified_files": unique_files,
                        "files_modified": unique_files,
                        "engine": "git_apply"
                    }
            except Exception:
                pass

        # Try patch CLI
        for p_flag in ["-p0", "-p1"]:
            try:
                res_patch = subprocess.run(
                    ["patch", p_flag, "--silent", "-N"],
                    input=raw_patch,
                    text=True,
                    cwd=ws_root,
                    capture_output=True,
                    timeout=10
                )
                if res_patch.returncode == 0:
                    return {
                        "status": "success",
                        "modified_files": unique_files,
                        "files_modified": unique_files,
                        "engine": "patch_cli"
                    }
            except Exception:
                pass

        # Fallback to pure Python patch engine
        try:
            applied = WorkspaceTools._apply_patch_pure_python(ws_root, raw_patch)
            return {
                "status": "success",
                "modified_files": applied or unique_files,
                "files_modified": applied or unique_files,
                "engine": "python_diff_engine"
            }
        except Exception as e:
            return {"error": f"Error applying unified patch: {str(e)}"}

    @staticmethod
    def _extract_symbols_for_file(code: str, file_path: str, ext: str) -> List[Dict[str, Any]]:
        """Unified AST and structural symbol extractor across Python, JS/TS, Elixir, Go, Rust, Ruby, Java, Kotlin, PHP, C/C++."""
        if ext == ".py":
            return WorkspaceTools._extract_python_symbols(code, file_path)
        if ext in {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"}:
            return WorkspaceTools._extract_ts_js_symbols(code, file_path)

        symbols: List[Dict[str, Any]] = []
        lines = code.split("\n")

        if ext in {".ex", ".exs"}:
            for idx, line in enumerate(lines, start=1):
                m_mod = re.match(r'^\s*defmodule\s+([A-Za-z0-9_.]+)', line)
                if m_mod:
                    symbols.append({
                        "name": m_mod.group(1),
                        "type": "module",
                        "file_path": file_path,
                        "line_number": idx,
                        "signature": line.strip(),
                        "docstring": ""
                    })
                    continue
                m_fn = re.match(r'^\s*(def|defp|defmacro|defguard)\s+([A-Za-z0-9_?!]+)(?:\(([^)]*)\))?', line)
                if m_fn:
                    kind, name, args = m_fn.group(1), m_fn.group(2), m_fn.group(3) or ""
                    symbols.append({
                        "name": name,
                        "type": "function" if kind in ("def", "defp") else "macro",
                        "file_path": file_path,
                        "line_number": idx,
                        "signature": f"{kind} {name}({args})" if args else f"{kind} {name}",
                        "docstring": ""
                    })
                    continue
        elif ext == ".go":
            for idx, line in enumerate(lines, start=1):
                m_fn = re.match(r'^\s*func\s+(?:\([^)]+\)\s+)?([A-Za-z0-9_]+)\s*\(([^)]*)\)', line)
                if m_fn:
                    symbols.append({
                        "name": m_fn.group(1),
                        "type": "function",
                        "file_path": file_path,
                        "line_number": idx,
                        "signature": line.strip(),
                        "docstring": ""
                    })
                m_type = re.match(r'^\s*type\s+([A-Za-z0-9_]+)\s+(struct|interface)', line)
                if m_type:
                    symbols.append({
                        "name": m_type.group(1),
                        "type": m_type.group(2),
                        "file_path": file_path,
                        "line_number": idx,
                        "signature": line.strip(),
                        "docstring": ""
                    })
        elif ext == ".rs":
            for idx, line in enumerate(lines, start=1):
                m_fn = re.match(r'^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z0-9_]+)\s*\(', line)
                if m_fn:
                    symbols.append({
                        "name": m_fn.group(1),
                        "type": "function",
                        "file_path": file_path,
                        "line_number": idx,
                        "signature": line.strip(),
                        "docstring": ""
                    })
                m_type = re.match(r'^\s*(?:pub\s+)?(struct|enum|trait|impl)\s+([A-Za-z0-9_]+)', line)
                if m_type:
                    symbols.append({
                        "name": m_type.group(2),
                        "type": m_type.group(1),
                        "file_path": file_path,
                        "line_number": idx,
                        "signature": line.strip(),
                        "docstring": ""
                    })
        elif ext == ".rb":
            for idx, line in enumerate(lines, start=1):
                m_class = re.match(r'^\s*(class|module)\s+([A-Za-z0-9_:]+)', line)
                if m_class:
                    symbols.append({
                        "name": m_class.group(2),
                        "type": m_class.group(1),
                        "file_path": file_path,
                        "line_number": idx,
                        "signature": line.strip(),
                        "docstring": ""
                    })
                m_def = re.match(r'^\s*def\s+([A-Za-z0-9_?!.]+)', line)
                if m_def:
                    symbols.append({
                        "name": m_def.group(1),
                        "type": "function",
                        "file_path": file_path,
                        "line_number": idx,
                        "signature": line.strip(),
                        "docstring": ""
                    })
        elif ext in {".java", ".kt"}:
            for idx, line in enumerate(lines, start=1):
                m_cls = re.match(r'^\s*(?:public\s+|private\s+|protected\s+)?(?:abstract\s+|data\s+)?(class|interface|enum)\s+([A-Za-z0-9_]+)', line)
                if m_cls:
                    symbols.append({
                        "name": m_cls.group(2),
                        "type": m_cls.group(1),
                        "file_path": file_path,
                        "line_number": idx,
                        "signature": line.strip(),
                        "docstring": ""
                    })
                m_fun = re.match(r'^\s*(?:public\s+|private\s+|protected\s+)?(?:suspend\s+)?fun\s+([A-Za-z0-9_]+)', line)
                if m_fun:
                    symbols.append({
                        "name": m_fun.group(1),
                        "type": "function",
                        "file_path": file_path,
                        "line_number": idx,
                        "signature": line.strip(),
                        "docstring": ""
                    })
        elif ext in {".php"}:
            for idx, line in enumerate(lines, start=1):
                m_cls = re.match(r'^\s*(?:abstract\s+|final\s+)?(class|interface|trait)\s+([A-Za-z0-9_]+)', line)
                if m_cls:
                    symbols.append({
                        "name": m_cls.group(2),
                        "type": m_cls.group(1),
                        "file_path": file_path,
                        "line_number": idx,
                        "signature": line.strip(),
                        "docstring": ""
                    })
                m_fn = re.match(r'^\s*(?:public\s+|private\s+|protected\s+|static\s+)*function\s+([A-Za-z0-9_]+)', line)
                if m_fn:
                    symbols.append({
                        "name": m_fn.group(1),
                        "type": "function",
                        "file_path": file_path,
                        "line_number": idx,
                        "signature": line.strip(),
                        "docstring": ""
                    })
        elif ext in {".hs", ".lhs"}:
            for idx, line in enumerate(lines, start=1):
                m_mod = re.match(r'^\s*module\s+([A-Za-z0-9_.]+)', line)
                if m_mod:
                    symbols.append({
                        "name": m_mod.group(1),
                        "type": "module",
                        "file_path": file_path,
                        "line_number": idx,
                        "signature": line.strip(),
                        "docstring": ""
                    })
                    continue
                m_data = re.match(r'^\s*(data|newtype|type)\s+(?:family\s+)?([A-Za-z0-9_]+)', line)
                if m_data:
                    kind, name = m_data.group(1), m_data.group(2)
                    symbols.append({
                        "name": name,
                        "type": kind,
                        "file_path": file_path,
                        "line_number": idx,
                        "signature": line.strip(),
                        "docstring": ""
                    })
                    continue
                m_cls = re.match(r'^\s*(class|instance)\s+(?:.*=>\s*)?([A-Za-z0-9_]+)', line)
                if m_cls:
                    kind, name = m_cls.group(1), m_cls.group(2)
                    symbols.append({
                        "name": name,
                        "type": kind,
                        "file_path": file_path,
                        "line_number": idx,
                        "signature": line.strip(),
                        "docstring": ""
                    })
                    continue
                m_sig = re.match(r'^\s*([a-z_][A-Za-z0-9_\']*)\s*::\s*(.+)', line)
                if m_sig:
                    name, sig = m_sig.group(1), m_sig.group(2)
                    symbols.append({
                        "name": name,
                        "type": "function",
                        "file_path": file_path,
                        "line_number": idx,
                        "signature": f"{name} :: {sig.strip()}",
                        "docstring": ""
                    })
        elif ext in {".cs"}:
            for idx, line in enumerate(lines, start=1):
                m_cls = re.match(r'^\s*(?:(?:public|private|protected|internal|abstract|sealed|static|partial|readonly)\s+)*(class|interface|struct|record|enum)\s+([A-Za-z0-9_]+)', line)
                if m_cls:
                    symbols.append({
                        "name": m_cls.group(2),
                        "type": m_cls.group(1),
                        "file_path": file_path,
                        "line_number": idx,
                        "signature": line.strip(),
                        "docstring": ""
                    })
                    continue
                m_fn = re.match(r'^\s*(?:(?:public|private|protected|internal|abstract|sealed|static|async|override|virtual)\s+)+[A-Za-z0-9_<>\[\],\s?]+\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)', line)
                if m_fn and not any(k in line for k in ["class ", "interface ", "struct ", "record ", "enum ", "namespace "]):
                    symbols.append({
                        "name": m_fn.group(1),
                        "type": "function",
                        "file_path": file_path,
                        "line_number": idx,
                        "signature": line.strip().rstrip("{;"),
                        "docstring": ""
                    })
        elif ext in {".swift"}:
            for idx, line in enumerate(lines, start=1):
                m_cls = re.match(r'^\s*(?:(?:public|private|fileprivate|internal|open|final)\s+)*(struct|class|protocol|enum|actor|extension)\s+([A-Za-z0-9_]+)', line)
                if m_cls:
                    symbols.append({
                        "name": m_cls.group(2),
                        "type": m_cls.group(1),
                        "file_path": file_path,
                        "line_number": idx,
                        "signature": line.strip().rstrip("{"),
                        "docstring": ""
                    })
                    continue
                m_fn = re.match(r'^\s*(?:(?:public|private|fileprivate|internal|open|static|class|override|mutating|async)\s+)*func\s+([A-Za-z0-9_]+)\s*(?:<[^>]+>)?\s*\(([^)]*)\)', line)
                if m_fn:
                    symbols.append({
                        "name": m_fn.group(1),
                        "type": "function",
                        "file_path": file_path,
                        "line_number": idx,
                        "signature": line.strip().rstrip("{"),
                        "docstring": ""
                    })
        elif ext in {".dart"}:
            for idx, line in enumerate(lines, start=1):
                m_cls = re.match(r'^\s*(?:(?:abstract|sealed|base|interface|final)\s+)*(class|mixin|enum|extension)\s+([A-Za-z0-9_]+)', line)
                if m_cls:
                    symbols.append({
                        "name": m_cls.group(2),
                        "type": m_cls.group(1),
                        "file_path": file_path,
                        "line_number": idx,
                        "signature": line.strip().rstrip("{"),
                        "docstring": ""
                    })
                    continue
                m_fn = re.match(r'^\s*(?:(?:static|@override|Future|Stream|void|[A-Za-z0-9_<>?]+)\s+)+([A-Za-z0-9_]+)\s*\(([^)]*)\)\s*(?:async\s*)?(?:\{|=>)', line)
                if m_fn and not any(k in line for k in ["class ", "mixin ", "enum ", "extension "]):
                    symbols.append({
                        "name": m_fn.group(1),
                        "type": "function",
                        "file_path": file_path,
                        "line_number": idx,
                        "signature": line.strip().rstrip("{=>"),
                        "docstring": ""
                    })
        elif ext in {".scala", ".sc"}:
            for idx, line in enumerate(lines, start=1):
                m_cls = re.match(r'^\s*(?:(?:sealed|abstract|final|case|implicit|lazy)\s+)*(case\s+class|class|object|trait|enum)\s+([A-Za-z0-9_]+)', line)
                if m_cls:
                    symbols.append({
                        "name": m_cls.group(2),
                        "type": m_cls.group(1),
                        "file_path": file_path,
                        "line_number": idx,
                        "signature": line.strip().rstrip("{"),
                        "docstring": ""
                    })
                    continue
                m_fn = re.match(r'^\s*(?:(?:override|private|protected|implicit|inline)\s+)*def\s+([A-Za-z0-9_+=:<>!?-]+)', line)
                if m_fn:
                    symbols.append({
                        "name": m_fn.group(1),
                        "type": "function",
                        "file_path": file_path,
                        "line_number": idx,
                        "signature": line.strip().rstrip("{="),
                        "docstring": ""
                    })
        elif ext in {".lua"}:
            for idx, line in enumerate(lines, start=1):
                m_fn = re.match(r'^\s*(?:local\s+)?function\s+([A-Za-z0-9_.:]+)\s*\(([^)]*)\)', line)
                if m_fn:
                    symbols.append({
                        "name": m_fn.group(1),
                        "type": "function",
                        "file_path": file_path,
                        "line_number": idx,
                        "signature": f"function {m_fn.group(1)}({m_fn.group(2)})",
                        "docstring": ""
                    })
        elif ext in {".c", ".cpp", ".h", ".hpp", ".cc", ".cxx"}:
            for idx, line in enumerate(lines, start=1):
                m_cls = re.match(r'^\s*(?:typedef\s+)?(struct|class|enum|union)\s+([A-Za-z0-9_]+)', line)
                if m_cls:
                    symbols.append({
                        "name": m_cls.group(2),
                        "type": m_cls.group(1),
                        "file_path": file_path,
                        "line_number": idx,
                        "signature": line.strip().rstrip("{;"),
                        "docstring": ""
                    })
                    continue
                m_fn = re.match(r'^\s*(?:(?:inline|static|virtual|explicit|constexpr|extern\s+"C")\s+)*(?:(?:const|unsigned|signed|struct|enum)\s+)*[A-Za-z0-9_<>:*&]+\s+([A-Za-z0-9_:]+)\s*\(([^)]*)\)\s*(?:const)?\s*(?:\{|;)', line)
                if m_fn and not any(k in line for k in ["struct ", "class ", "enum ", "union ", "return ", "typedef "]):
                    symbols.append({
                        "name": m_fn.group(1),
                        "type": "function",
                        "file_path": file_path,
                        "line_number": idx,
                        "signature": line.strip().rstrip("{;"),
                        "docstring": ""
                    })
        elif ext in {".tf", ".hcl"}:
            for idx, line in enumerate(lines, start=1):
                m_block = re.match(r'^\s*(resource|module|variable|output|data|provider|locals)\s+(?:"([^"]+)"|([A-Za-z0-9_-]+))(?:\s+"([^"]+)")?', line)
                if m_block:
                    kind = m_block.group(1)
                    first_arg = m_block.group(2) or m_block.group(3) or ""
                    second_arg = m_block.group(4) or ""
                    sym_name = f"{first_arg}.{second_arg}" if second_arg else first_arg
                    symbols.append({
                        "name": sym_name,
                        "type": kind,
                        "file_path": file_path,
                        "line_number": idx,
                        "signature": line.strip().rstrip("{"),
                        "docstring": ""
                    })
        elif ext in {".sol"}:
            for idx, line in enumerate(lines, start=1):
                m_cls = re.match(r'^\s*(contract|interface|library)\s+([A-Za-z0-9_]+)', line)
                if m_cls:
                    symbols.append({
                        "name": m_cls.group(2),
                        "type": m_cls.group(1),
                        "file_path": file_path,
                        "line_number": idx,
                        "signature": line.strip().rstrip("{"),
                        "docstring": ""
                    })
                    continue
                m_fn = re.match(r'^\s*(function|event|modifier|error)\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)', line)
                if m_fn:
                    symbols.append({
                        "name": m_fn.group(2),
                        "type": m_fn.group(1),
                        "file_path": file_path,
                        "line_number": idx,
                        "signature": line.strip().rstrip("{;"),
                        "docstring": ""
                    })
        elif ext in {".zig"}:
            for idx, line in enumerate(lines, start=1):
                m_cls = re.match(r'^\s*(?:pub\s+)?const\s+([A-Za-z0-9_]+)\s*=\s*(struct|enum|union)', line)
                if m_cls:
                    symbols.append({
                        "name": m_cls.group(1),
                        "type": m_cls.group(2),
                        "file_path": file_path,
                        "line_number": idx,
                        "signature": line.strip().rstrip("{"),
                        "docstring": ""
                    })
                    continue
                m_fn = re.match(r'^\s*(?:pub\s+)?(?:export\s+)?fn\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)', line)
                if m_fn:
                    symbols.append({
                        "name": m_fn.group(1),
                        "type": "function",
                        "file_path": file_path,
                        "line_number": idx,
                        "signature": line.strip().rstrip("{"),
                        "docstring": ""
                    })
        elif ext in {".clj", ".cljs", ".cljc", ".edn"}:
            for idx, line in enumerate(lines, start=1):
                m_ns = re.match(r'^\s*\(\s*ns\s+([A-Za-z0-9_.-]+)', line)
                if m_ns:
                    symbols.append({
                        "name": m_ns.group(1),
                        "type": "namespace",
                        "file_path": file_path,
                        "line_number": idx,
                        "signature": line.strip(),
                        "docstring": ""
                    })
                    continue
                m_def = re.match(r"^\s*\(\s*(defn|defn-|defmacro|defmulti|defmethod|defprotocol|defrecord|deftype|def)\s+([A-Za-z0-9_.*+!?'<>=/-]+)", line)
                if m_def:
                    symbols.append({
                        "name": m_def.group(2),
                        "type": m_def.group(1),
                        "file_path": file_path,
                        "line_number": idx,
                        "signature": line.strip(),
                        "docstring": ""
                    })
        elif ext in {".erl", ".hrl"}:
            for idx, line in enumerate(lines, start=1):
                m_mod = re.match(r'^\s*-module\s*\(\s*([A-Za-z0-9_]+)\s*\)\.', line)
                if m_mod:
                    symbols.append({
                        "name": m_mod.group(1),
                        "type": "module",
                        "file_path": file_path,
                        "line_number": idx,
                        "signature": line.strip(),
                        "docstring": ""
                    })
                    continue
                m_rec = re.match(r'^\s*-record\s*\(\s*([A-Za-z0-9_]+)', line)
                if m_rec:
                    symbols.append({
                        "name": m_rec.group(1),
                        "type": "record",
                        "file_path": file_path,
                        "line_number": idx,
                        "signature": line.strip(),
                        "docstring": ""
                    })
                    continue
                m_fn = re.match(r'^\s*([a-z][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*(?:when.*)?->', line)
                if m_fn:
                    symbols.append({
                        "name": m_fn.group(1),
                        "type": "function",
                        "file_path": file_path,
                        "line_number": idx,
                        "signature": line.strip(),
                        "docstring": ""
                    })
        elif ext in {".ml", ".mli"}:
            for idx, line in enumerate(lines, start=1):
                m_mod = re.match(r'^\s*module\s+([A-Z][A-Za-z0-9_]*)', line)
                if m_mod:
                    symbols.append({
                        "name": m_mod.group(1),
                        "type": "module",
                        "file_path": file_path,
                        "line_number": idx,
                        "signature": line.strip(),
                        "docstring": ""
                    })
                    continue
                m_typ = re.match(r'^\s*type\s+(?:nonrec\s+)?([a-z_][A-Za-z0-9_\']*)', line)
                if m_typ:
                    symbols.append({
                        "name": m_typ.group(1),
                        "type": "type",
                        "file_path": file_path,
                        "line_number": idx,
                        "signature": line.strip(),
                        "docstring": ""
                    })
                    continue
                m_let = re.match(r'^\s*let\s+(?:rec\s+)?([a-z_][A-Za-z0-9_\']*)', line)
                if m_let:
                    symbols.append({
                        "name": m_let.group(1),
                        "type": "function",
                        "file_path": file_path,
                        "line_number": idx,
                        "signature": line.strip(),
                        "docstring": ""
                    })
        elif ext in {".fs", ".fsi", ".fsx"}:
            for idx, line in enumerate(lines, start=1):
                m_mod = re.match(r'^\s*(?:module|namespace)\s+([A-Za-z0-9_.]+)', line)
                if m_mod:
                    symbols.append({
                        "name": m_mod.group(1),
                        "type": "module",
                        "file_path": file_path,
                        "line_number": idx,
                        "signature": line.strip(),
                        "docstring": ""
                    })
                    continue
                m_typ = re.match(r'^\s*type\s+([A-Za-z0-9_]+)', line)
                if m_typ:
                    symbols.append({
                        "name": m_typ.group(1),
                        "type": "type",
                        "file_path": file_path,
                        "line_number": idx,
                        "signature": line.strip(),
                        "docstring": ""
                    })
                    continue
                m_let = re.match(r'^\s*let\s+(?:rec\s+)?([A-Za-z0-9_]+)', line)
                if m_let:
                    symbols.append({
                        "name": m_let.group(1),
                        "type": "function",
                        "file_path": file_path,
                        "line_number": idx,
                        "signature": line.strip(),
                        "docstring": ""
                    })

        return symbols

    @staticmethod
    def get_file_outline(workspace_path: Path, file_path: str) -> Dict[str, Any]:
        """Extracts AST symbols, function signatures, classes, and types without function bodies for token-efficient repo exploration."""
        ws_root = workspace_path.resolve()
        target = (ws_root / file_path).resolve()
        if not target.is_relative_to(ws_root):
            return {"error": "Access denied outside workspace"}
        if not target.exists() or not target.is_file():
            return {"error": f"File '{file_path}' not found"}

        try:
            code = target.read_text(encoding="utf-8", errors="ignore")
            ext = target.suffix.lower()

            symbols = WorkspaceTools._extract_symbols_for_file(code, file_path, ext)

            if not symbols:
                head_lines = code.splitlines()[:40]
                return {
                    "file_path": file_path,
                    "symbol_count": 0,
                    "outline": "\n".join(head_lines),
                    "symbols": []
                }

            outline_lines = [f"# Outline for {file_path} ({len(symbols)} symbols):"]
            for s in symbols:
                decorators = " ".join(s.get("decorators", []))
                prefix = f"{decorators} " if decorators else ""
                doc = f" -- {s['docstring']}" if s.get("docstring") else ""
                outline_lines.append(f"  Line {s.get('line_number', '?')}: {prefix}{s.get('signature', s.get('name'))}{doc}")

            return {
                "file_path": file_path,
                "symbol_count": len(symbols),
                "outline": "\n".join(outline_lines),
                "symbols": symbols
            }
        except Exception as e:
            return {"error": str(e)}

    @staticmethod
    def run_command(workspace_path: Path, command: str, bypass_safety: bool = False) -> Dict[str, Any]:
        from app.core.sandboxes.jailer import jailer
        try:
            is_safe, safety_err = jailer.validate_command_safety(command, workspace_path, bypass_safety=bypass_safety)
            if not is_safe:
                return {
                    "command": command,
                    "exit_code": 1,
                    "error": safety_err,
                    "stderr": safety_err,
                    "stdout": ""
                }

            cmd_args, use_shell = jailer.wrap_command(workspace_path, command)
            clean_env = jailer.get_clean_environment()

            proc = subprocess.run(
                cmd_args if not use_shell else command,
                shell=use_shell,
                cwd=workspace_path,
                capture_output=True,
                text=True,
                timeout=60,
                env=clean_env
            )
            return {
                "command": command,
                "exit_code": proc.returncode,
                "stdout": compact_command_output(proc.stdout),
                "stderr": compact_command_output(proc.stderr),
                "isolation": jailer.isolation_type
            }
        except subprocess.TimeoutExpired:
            return {
                "command": command,
                "error": (
                    "Command timed out after 60 seconds. "
                    "If this command was attempting to start a persistent development server or preview listener (e.g. 'vite preview', 'npm start'), "
                    "note that Cyclode serves live previews automatically from workspace files. Do NOT start foreground servers. "
                    "Never ask the user to run commands locally on their machine. "
                    "Compile static assets using 'npm run build' or inspect error logs directly."
                ),
                "exit_code": 124,
                "stderr": "Command timed out after 60 seconds (exit code 124)",
                "stdout": ""
            }
        except Exception as e:
            return {"command": command, "error": str(e), "exit_code": 1}

    @staticmethod
    async def speculative_branch_test(
        workspace_path: Path,
        hypotheses: List[Dict[str, Any]],
        test_command: str,
        timeout: int = 45
    ) -> Dict[str, Any]:
        """
        Executes parallel multi-branch speculative testing across Copy-on-Write (CoW) sandbox forks in <10ms.
        Evaluates alternative refactor/bug-fix hypotheses in parallel without state pollution.
        """
        if not hypotheses:
            return {"error": "No hypotheses provided for speculative execution", "results": []}

        import uuid
        import time
        from app.core.sandboxes.manager import sandbox_manager
        from app.core.sandboxes.base import SandboxContext

        parent_task_id = workspace_path.name.replace("sandbox-", "")
        results = []

        async def run_single_hypothesis(idx: int, hyp: Dict[str, Any]) -> Dict[str, Any]:
            hyp_name = hyp.get("name", f"Hypothesis {chr(65 + idx)}")
            fork_id = f"{parent_task_id}-hyp-{idx}-{uuid.uuid4().hex[:6]}"
            fork_ctx = None
            t0 = time.time()
            try:
                # 1. Fork workspace in sub-10ms
                active_sandboxes = getattr(sandbox_manager.provider, "_active_sandboxes", {})
                parent_ctx = active_sandboxes.get(parent_task_id)
                if not parent_ctx and workspace_path.exists():
                    parent_ctx = SandboxContext(
                        task_id=parent_task_id,
                        workspace_path=workspace_path
                    )

                if parent_ctx:
                    fork_ctx = await sandbox_manager.fork_sandbox(parent_ctx, fork_id)
                else:
                    fork_ctx = await sandbox_manager.get_or_create(fork_id)

                fork_ws = fork_ctx.workspace_path

                # 2. Apply hypothesis edits to the fork
                applied_edits = 0
                for edit in hyp.get("edits", []):
                    f_path = (
                        edit.get("file_path")
                        or edit.get("path")
                        or edit.get("filePath")
                        or edit.get("target_file")
                        or edit.get("filename")
                        or edit.get("file")
                        or ""
                    )
                    tc = (
                        edit.get("target_content")
                        if edit.get("target_content") is not None
                        else (
                            edit.get("target")
                            if edit.get("target") is not None
                            else (
                                edit.get("search")
                                if edit.get("search") is not None
                                else (
                                    edit.get("old_content")
                                    if edit.get("old_content") is not None
                                    else edit.get("oldContent")
                                )
                            )
                        )
                    )
                    rc = (
                        edit.get("replacement_content")
                        if edit.get("replacement_content") is not None
                        else (
                            edit.get("replacement")
                            if edit.get("replacement") is not None
                            else (
                                edit.get("replace")
                                if edit.get("replace") is not None
                                else (
                                    edit.get("new_content")
                                    if edit.get("new_content") is not None
                                    else edit.get("newContent")
                                )
                            )
                        )
                    )
                    c = edit.get("content") if edit.get("content") is not None else (edit.get("code") if edit.get("code") is not None else edit.get("text"))
                    if f_path and tc and rc is not None:
                        rep_res = WorkspaceTools.replace_file_content(fork_ws, f_path, tc, rc)
                        if rep_res.get("status") == "replaced":
                            applied_edits += 1
                    elif f_path and c:
                        WorkspaceTools.edit_file(fork_ws, f_path, c)
                        applied_edits += 1

                # 3. Run test command in the isolated fork
                cmd_res = WorkspaceTools.run_command(fork_ws, test_command)
                duration_ms = int((time.time() - t0) * 1000)

                return {
                    "index": idx,
                    "hypothesis_name": hyp_name,
                    "fork_task_id": fork_id,
                    "applied_edits": applied_edits,
                    "exit_code": cmd_res.get("exit_code", 1),
                    "passed": cmd_res.get("exit_code") == 0,
                    "stdout": cmd_res.get("stdout", "")[:800],
                    "stderr": cmd_res.get("stderr", "")[:800],
                    "duration_ms": duration_ms
                }
            except Exception as e:
                return {
                    "index": idx,
                    "hypothesis_name": hyp_name,
                    "fork_task_id": fork_id,
                    "error": str(e),
                    "passed": False,
                    "exit_code": 1
                }
            finally:
                if fork_ctx:
                    await sandbox_manager.destroy(fork_ctx)

        # Run all hypotheses concurrently in separate CoW forks
        tasks = [run_single_hypothesis(i, h) for i, h in enumerate(hypotheses[:4])]
        results = await asyncio.gather(*tasks)

        # Identify winning hypothesis
        passed_runs = [r for r in results if r.get("passed")]
        winning_hyp = passed_runs[0] if passed_runs else None

        return {
            "total_hypotheses_tested": len(hypotheses),
            "test_command": test_command,
            "winning_hypothesis": winning_hyp.get("hypothesis_name") if winning_hyp else None,
            "winner_index": winning_hyp.get("index") if winning_hyp else None,
            "all_results": results
        }

    @staticmethod
    def search_code(
        workspace_path: Path,
        query: str,
        is_regex: bool = False,
        case_sensitive: bool = False,
        file_pattern: Optional[str] = None,
        max_results: int = 50,
        current_file: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Fast workspace code search ignoring build/vendor folders, prioritizing current_file matches.
        Dispatches via SearchBridge 3-Tier Cascade (Rust cyclode-searchd -> Ripgrep -> Python fallback).
        """
        from app.core.search import SearchBridge
        res = SearchBridge.search_text(
            workspace_path,
            query,
            is_regex=is_regex,
            case_sensitive=case_sensitive,
            max_results=max_results,
            current_file=current_file
        )
        if "matches" in res:
            if file_pattern:
                res["matches"] = [
                    m for m in res["matches"]
                    if fnmatch.fnmatch(m.get("file_path", ""), file_pattern) or fnmatch.fnmatch(Path(m.get("file_path", "")).name, file_pattern)
                ]
                res["total_matches"] = len(res["matches"])
            res["files_matched"] = list(dict.fromkeys([m.get("file_path", "") for m in res["matches"] if m.get("file_path")]))
            res["total_files_matched"] = len(res["files_matched"])
        return res

    @staticmethod
    def _search_code_pure_python(
        workspace_path: Path,
        query: str,
        is_regex: bool = False,
        case_sensitive: bool = False,
        file_pattern: Optional[str] = None,
        max_results: int = 50,
        current_file: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Pure Python fallback code search implementation.
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

        current_file_matches = []
        workspace_matches = []
        normalized_current = None
        if current_file:
            normalized_current = current_file.strip().lstrip("/")

        # First scan current_file directly if specified
        if normalized_current:
            target_path = workspace_path / normalized_current
            if target_path.exists() and target_path.is_file():
                try:
                    with open(target_path, "r", encoding="utf-8", errors="ignore") as file_obj:
                        for line_idx, line in enumerate(file_obj, start=1):
                            if pattern.search(line):
                                current_file_matches.append({
                                    "file_path": normalized_current,
                                    "line_number": line_idx,
                                    "line_content": line.rstrip("\r\n")
                                })
                except Exception:
                    pass

        # Now scan the rest of the workspace
        for root, dirs, files in os.walk(workspace_path):
            dirs[:] = [d for d in dirs if d not in ignored_dirs and not d.startswith(".")]
            try:
                rel_root = Path(root).relative_to(workspace_path)
            except ValueError:
                rel_root = Path(root).resolve().relative_to(workspace_path.resolve())

            for f in files:
                p = Path(f)
                if p.suffix.lower() in ignored_extensions or f.startswith("."):
                    continue

                rel_file_path = str(rel_root / f) if str(rel_root) != "." else f
                if normalized_current and (rel_file_path == normalized_current or rel_file_path.endswith(normalized_current)):
                    # Already scanned as current_file
                    continue

                if file_pattern:
                    if not fnmatch.fnmatch(rel_file_path, file_pattern) and not fnmatch.fnmatch(f, file_pattern):
                        continue

                full_path = Path(root) / f
                try:
                    file_matches_count = 0
                    with open(full_path, "r", encoding="utf-8", errors="ignore") as file_obj:
                        for line_idx, line in enumerate(file_obj, start=1):
                            if pattern.search(line):
                                workspace_matches.append({
                                    "file_path": rel_file_path,
                                    "line_number": line_idx,
                                    "line_content": line.rstrip("\r\n")
                                })
                                file_matches_count += 1
                                if file_matches_count >= 50:
                                    break
                except Exception:
                    continue

        all_raw = current_file_matches + workspace_matches
        files_matched = list(dict.fromkeys([m["file_path"] for m in all_raw]))
        effective_limit = max(max_results, 500)
        combined_matches = all_raw[:effective_limit]
        is_capped = len(all_raw) > len(combined_matches)

        return {
            "query": query,
            "total_matches": len(combined_matches),
            "total_files_matched": len(files_matched),
            "files_matched": files_matched,
            "capped": is_capped,
            "matches": combined_matches
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
        Extract and query code symbols across multi-language projects using AST & structural indexing.
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
            "dist", "build", ".next", ".cache", ".pytest_cache", ".gemini", "assets", "_build", "deps"
        }
        supported_exts = {
            ".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
            ".ex", ".exs", ".go", ".rs", ".rb", ".java", ".kt", ".php",
            ".c", ".cpp", ".h", ".hpp", ".cc", ".cxx",
            ".hs", ".lhs", ".cs", ".swift", ".dart", ".scala", ".sc",
            ".lua", ".tf", ".hcl", ".sol", ".zig", ".clj", ".cljs",
            ".erl", ".hrl", ".ml", ".mli", ".fs", ".fsx"
        }
        MAX_AST_FILE_SIZE = 500 * 1024

        updated_cache = False
        all_symbols = []

        for root, dirs, files in os.walk(workspace_path):
            dirs[:] = [d for d in dirs if d not in ignored_dirs and not d.startswith(".")]
            try:
                rel_root = Path(root).relative_to(workspace_path)
            except ValueError:
                rel_root = Path(root).resolve().relative_to(workspace_path.resolve())

            for f in files:
                p = Path(f)
                ext = p.suffix.lower()
                if ext not in supported_exts or f.startswith("."):
                    continue

                f_lower = f.lower()
                if f_lower.endswith((".min.js", ".min.ts", ".bundle.js", ".chunk.js", ".map")):
                    continue

                rel_file_path = str(rel_root / f) if str(rel_root) != "." else f
                full_path = Path(root) / f

                try:
                    fstat = full_path.stat()
                    if fstat.st_size > MAX_AST_FILE_SIZE:
                        continue
                    mtime = fstat.st_mtime
                    file_cache = cache_data.get("files", {}).get(rel_file_path)

                    if file_cache and file_cache.get("mtime") == mtime:
                        file_symbols = file_cache.get("symbols", [])
                    else:
                        content = full_path.read_text(encoding="utf-8", errors="ignore")
                        # Skip files with runaway lines (>2000 chars)
                        first_lines = content.splitlines()[:5]
                        if any(len(line) > 2000 for line in first_lines):
                            continue

                        file_symbols = WorkspaceTools._extract_symbols_for_file(content, rel_file_path, ext)

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
        max_results: int = 30,
        current_file: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Structural AST search for language patterns, prioritizing current_file matches.
        Dispatches via SearchBridge 3-Tier Cascade (Rust cyclode-searchd -> Python AST engine).
        """
        from app.core.search import SearchBridge
        return SearchBridge.search_ast(
            workspace_path,
            pattern,
            max_results=max_results,
            current_file=current_file
        )

    @staticmethod
    def _tgrep_ast_pure_python(
        workspace_path: Path,
        pattern: str,
        language: Optional[str] = None,
        max_results: int = 30,
        current_file: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Pure Python fallback structural AST search.
        """
        if not pattern or not pattern.strip():
            return {"error": "AST search pattern cannot be empty", "matches": []}

        pattern_clean = pattern.strip()
        matches = []

        symbols_res = WorkspaceTools.find_symbols(workspace_path, max_results=10000)
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

        elif pattern_clean.startswith("class:") or pattern_clean.startswith("extends:"):
            base_query = pattern_clean.split(":", 1)[1].strip().lower()
            for s in symbols:
                if s["type"] in ("class", "module", "struct", "interface"):
                    bases = [b.lower() for b in s.get("bases", [])]
                    if any(base_query in b for b in bases):
                        matches.append({
                            "file_path": s["file_path"],
                            "line_number": s["line_number"],
                            "symbol": s["name"],
                            "type": s["type"],
                            "signature": s["signature"],
                            "bases": s.get("bases", [])
                        })

        if not matches:
            for s in symbols:
                if pattern_clean.lower() in s["name"].lower() or pattern_clean.lower() in s.get("signature", "").lower():
                    matches.append({
                        "file_path": s["file_path"],
                        "line_number": s["line_number"],
                        "symbol": s["name"],
                        "type": s["type"],
                        "signature": s["signature"]
                    })

        # Fallback to code references if AST index has 0 matches for this identifier
        if not matches:
            grep_res = WorkspaceTools._search_code_pure_python(
                workspace_path,
                pattern_clean,
                is_regex=False,
                case_sensitive=False,
                max_results=max(max_results, 500),
                current_file=current_file
            )
            for gm in grep_res.get("matches", []):
                matches.append({
                    "file_path": gm["file_path"],
                    "line_number": gm["line_number"],
                    "symbol": pattern_clean,
                    "type": "reference",
                    "signature": gm.get("line_content", "")
                })

        # Prioritize current_file matches if provided
        effective_limit = max(max_results, 500)
        if current_file:
            norm_curr = current_file.strip().lstrip("/")
            curr_matches = [m for m in matches if m["file_path"] == norm_curr or m["file_path"].endswith(norm_curr)]
            other_matches = [m for m in matches if m not in curr_matches]
            combined_matches = (curr_matches + other_matches)[:effective_limit]
        else:
            combined_matches = matches[:effective_limit]

        files_matched = list(dict.fromkeys([m["file_path"] for m in matches]))

        return {
            "pattern": pattern,
            "total_matches": len(combined_matches),
            "total_files_matched": len(files_matched),
            "files_matched": files_matched,
            "matches": combined_matches
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
        Executes live web retrieval across news, developer feeds, search engines, and real-time tech endpoints.
        Supports dual retrieval (DuckDuckGo web search + Hacker News Algolia) with temporal anchoring.
        """
        now = datetime.now(timezone.utc)
        current_year = now.year
        
        results = []
        clean_q = query.strip()
        # Sanitize query: strip surrounding quotes and boolean operators for robust search engine parsing
        clean_q = re.sub(r'["\']', ' ', clean_q)
        clean_q = re.sub(r'\b(OR|AND)\b', ' ', clean_q, flags=re.IGNORECASE)
        clean_q = re.sub(r'\s+', ' ', clean_q).strip()
        if not clean_q:
            clean_q = query.strip()

        full_context = f"{clean_q.lower()} {(temporal_context or '').lower()}".strip()

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
            clean_q.lower(),
            flags=re.IGNORECASE
        ).strip()
        entity_query = re.sub(r"^(?:at|with|about|for|in|on|to|of)\s+", "", entity_query).strip()
        entity_query = re.sub(r"(?:,\s*)?(?:esp(?:ecially)?\s+)?(?:the\s+)?(?:last|recent|past)\s+(?:weeks?|months?|days?|year)\s*$", "", entity_query, flags=re.IGNORECASE).strip()
        entity_query = entity_query.strip("'\"`").strip()
        entity_query = re.sub(r"\s+", " ", entity_query).strip()
        if not entity_query:
            entity_query = clean_q.lower().strip("'\"`").strip()

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
                stopwords = {"the", "and", "for", "with", "this", "that", "from", "about", "what", "how", "browse", "blogs"}
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

        async def fetch_duckduckgo(q_str: str, max_hits: int) -> List[Dict[str, Any]]:
            hits_found = []
            try:
                headers = {
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.9"
                }
                async with httpx.AsyncClient(follow_redirects=True, timeout=8.0) as client:
                    resp = await client.post(
                        "https://html.duckduckgo.com/html/",
                        data={"q": q_str},
                        headers=headers
                    )
                    if resp.status_code == 200:
                        body_html = resp.text
                        pattern = re.compile(
                            r'<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="(?P<raw_url>[^"]+)"[^>]*>(?P<title>.*?)</a>.*?(?:<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>(?P<snippet>.*?)</a>)?',
                            re.DOTALL | re.IGNORECASE
                        )
                        for match in pattern.finditer(body_html):
                            if len(hits_found) >= max_hits:
                                break
                            raw_u = match.group("raw_url")
                            raw_t = match.group("title") or ""
                            raw_s = match.group("snippet") or ""

                            clean_title = html.unescape(re.sub(r"<[^>]+>", "", raw_t)).strip()
                            clean_snippet = html.unescape(re.sub(r"<[^>]+>", "", raw_s)).strip()

                            target_url = raw_u
                            if "uddg=" in raw_u:
                                try:
                                    parsed_u = urllib.parse.urlparse(raw_u)
                                    qs = urllib.parse.parse_qs(parsed_u.query)
                                    if "uddg" in qs:
                                        target_url = qs["uddg"][0]
                                except Exception:
                                    pass

                            if target_url.startswith("//"):
                                target_url = "https:" + target_url
                            if not target_url.startswith("http"):
                                continue

                            if target_url and clean_title:
                                hits_found.append({
                                    "title": clean_title,
                                    "url": target_url,
                                    "snippet": clean_snippet,
                                    "source": "Web Search"
                                })
            except Exception:
                pass
            return hits_found

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

        # 1. Fetch from DuckDuckGo
        ddg_hits = await fetch_duckduckgo(clean_q, max_hits=limit)
        results.extend(ddg_hits)

        # 2. Fetch from Hacker News
        if len(results) < limit:
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

        # Fallback if no results found yet: try raw un-entity search on DuckDuckGo
        if not results and clean_q != entity_query:
            fallback_ddg = await fetch_duckduckgo(entity_query, max_hits=limit)
            results.extend(fallback_ddg)

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
        files_data = await github_client.get_pull_request_files(owner, repo, pr_number, custom_token=token) or []
        
        if not pr_data:
            pr_data = {
                "title": f"Pull Request #{pr_number}",
                "state": "open",
                "user": {"login": "unknown"},
                "head": {"ref": ""},
                "base": {"ref": "main"},
                "body": "",
                "html_url": f"https://github.com/{owner}/{repo}/pull/{pr_number}"
            }
        
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
            pr_number=pr_number,
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
            pr_number=pr_number,
            body=body,
            commit_id=commit_sha,
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
        base_branch: Optional[str] = "main",
        draft: Optional[bool] = False
    ) -> Dict[str, Any]:
        """
        Creates a new pull request on GitHub (with draft support).
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
            draft=bool(draft),
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

    @classmethod
    async def run_verified_code_review(
        cls,
        workspace_path: Path,
        repository: Optional[str] = None,
        pr_number: Optional[int] = None,
        diff_text: Optional[str] = None,
        model_name: Optional[str] = None,
        provider: Optional[Any] = None,
        client: Optional[httpx.AsyncClient] = None
    ) -> Dict[str, Any]:
        """
        Executes the high-signal 4-stage verified review pipeline on a PR or unified diff.
        Applies multi-perspective ensemble scanning, adversarial falsification, zero-style filtering,
        and root-cause deduplication.
        """
        from app.agent.review_verifier import review_verifier

        diff = diff_text or ""
        pr_meta: Dict[str, Any] = {}

        if repository and pr_number:
            diff_res = await cls.get_pull_request_diff(repository, pr_number)
            if diff_res.get("diff"):
                diff = diff_res["diff"]
            pr_details = await cls.get_pull_request_details(repository, pr_number)
            pr_meta = pr_details

        if not diff.strip():
            # Fallback to local git diff if in a git workspace
            try:
                git_proc = subprocess.run(
                    ["git", "diff", "HEAD~1"],
                    cwd=workspace_path,
                    capture_output=True,
                    text=True,
                    timeout=10
                )
                if git_proc.returncode == 0 and git_proc.stdout.strip():
                    diff = git_proc.stdout
            except Exception:
                pass

        if not diff.strip():
            return {
                "success": False,
                "error": "No diff text found for review. Provide diff_text or repository + pr_number."
            }

        return await review_verifier.run_full_review_async(
            diff_text=diff,
            workspace_path=workspace_path,
            pr_meta=pr_meta,
            model_name=model_name,
            provider=provider,
            client=client
        )

    @classmethod
    async def verify_code_hypothesis(
        cls,
        workspace_path: Path,
        file_path: str,
        line_range: str,
        invariant_violated: str,
        reproduction_scenario: str,
        model_name: Optional[str] = None,
        provider: Optional[Any] = None,
        client: Optional[httpx.AsyncClient] = None
    ) -> Dict[str, Any]:
        """
        Adversarially verifies or falsifies a single code issue hypothesis against local workspace context.
        """
        from app.agent.review_verifier import review_verifier, ReviewHypothesis

        # Parse line range
        start_line = 1
        end_line = 1
        if "-" in line_range:
            parts = line_range.split("-")
            try:
                start_line = int(parts[0].strip())
                end_line = int(parts[1].strip())
            except Exception:
                pass
        elif line_range.isdigit():
            start_line = end_line = int(line_range)

        hypo = ReviewHypothesis(
            id="hypo-ad-hoc",
            category="logic_invariant",
            scanner_name="ManualVerificationProbe",
            file_path=file_path,
            line_start=start_line,
            line_end=end_line,
            title="Candidate Invariant Hypothesis",
            description=f"Testing invariant: {invariant_violated}",
            invariant_violated=invariant_violated,
            reproduction_scenario=reproduction_scenario,
            suggested_diff="",
            preliminary_confidence=0.90
        )

        verified = await review_verifier.verify_and_falsify_async(
            hypothesis=hypo,
            workspace_path=workspace_path,
            model_name=model_name,
            provider=provider,
            client=client
        )
        if verified:
            return {
                "verified": True,
                "confidence": verified.confidence_score,
                "category": verified.category,
                "severity": verified.severity,
                "evidence": verified.verification_evidence,
                "message": "Hypothesis survived adversarial falsification and is verified."
            }
        return {
            "verified": False,
            "message": "Hypothesis was falsified, mitigated by context, or rejected under the Zero-Style invariant."
        }

    @staticmethod
    async def package_artifact(
        workspace_path: Path,
        artifact_type: str = "OCI_IMAGE",
        name: Optional[str] = None,
        tag: str = "latest"
    ) -> Dict[str, Any]:
        """
        Builds and packages software artifacts (e.g. OCI Container Image, Static Distribution Bundle)
        from workspace source files.
        """
        from app.core.sandboxes.artifacts import artifact_packager, ArtifactType

        task_id = workspace_path.name.replace("sandbox-", "")
        type_enum = ArtifactType.OCI_IMAGE if artifact_type.upper() == "OCI_IMAGE" else ArtifactType.STATIC_BUNDLE

        manifest, logs = await artifact_packager.package_artifact(
            task_id=task_id,
            workspace_path=workspace_path,
            artifact_type=type_enum,
            name=name,
            tag=tag
        )

        if manifest:
            return {
                "ok": True,
                "artifact": manifest.to_dict(),
                "logs": logs[:1000]
            }
        return {
            "ok": False,
            "error": "Artifact packaging failed",
            "logs": logs[:1000]
        }

    @staticmethod
    async def deploy_staging(
        workspace_path: Path,
        artifact_manifest_dict: Dict[str, Any],
        port: int = 80
    ) -> Dict[str, Any]:
        """
        Deploys a packaged artifact into an isolated staging container with live endpoint routing.
        """
        from app.core.sandboxes.artifacts import staging_deployer, ArtifactManifest, ArtifactType

        manifest = ArtifactManifest(
            artifact_id=artifact_manifest_dict.get("artifact_id", "art-unknown"),
            task_id=artifact_manifest_dict.get("task_id", workspace_path.name.replace("sandbox-", "")),
            artifact_type=ArtifactType(artifact_manifest_dict.get("artifact_type", "OCI_IMAGE")),
            name=artifact_manifest_dict.get("name", "app"),
            version=artifact_manifest_dict.get("version", "latest"),
            tags=artifact_manifest_dict.get("tags", []),
            digest=artifact_manifest_dict.get("digest", ""),
            entry_point=artifact_manifest_dict.get("entry_point")
        )

        record = await staging_deployer.deploy_staging(manifest, container_port=port)
        return {
            "ok": record.status.value == "RUNNING",
            "deployment": record.to_dict()
        }

    @staticmethod
    async def publish_artifact(
        local_tag: str,
        remote_tag: str,
        registry_url: Optional[str] = None,
        username: Optional[str] = None,
        token: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Pushes a packaged OCI container image to a remote registry (GHCR, Docker Hub, ECR).
        """
        from app.core.sandboxes.artifacts import registry_client

        if registry_url and username and token:
            ok, login_msg = await registry_client.login(registry_url, username, token)
            if not ok:
                return {"ok": False, "error": f"Login failed: {login_msg}"}

        success, logs = await registry_client.push_image(local_tag, remote_tag)
        return {
            "ok": success,
            "remote_tag": remote_tag,
            "logs": logs[:1000]
        }

    # =========================================================================
    # Linear Issue Tracking Tools
    # =========================================================================

    @classmethod
    async def get_linear_issue(cls, issue_key: str) -> Dict[str, Any]:
        """
        Fetches full Linear ticket details, description, comments, and priority by issue key (e.g. 'PD-1198', 'ENG-402').
        """
        from app.integrations.linear_client import linear_client
        from app.integrations.manager import integration_manager

        if not integration_manager.is_capability_enabled("linear.get_issue"):
            return {"error": "Capability 'linear.get_issue' is disabled by integration capability policy."}

        lin_token = integration_manager.get_custom_credential("linear", "token") or integration_manager.get_custom_credential("linear", "api_key")

        issue = await linear_client.get_issue(issue_key, custom_token=lin_token)
        if issue:
            return issue
        return {
            "error": f"Linear issue '{issue_key}' not found or Linear integration is not configured with an active API key."
        }

    @classmethod
    async def search_linear_issues(cls, query: str) -> Dict[str, Any]:
        """
        Searches Linear issues matching a query string.
        """
        from app.integrations.linear_client import linear_client
        from app.integrations.manager import integration_manager

        if not integration_manager.is_capability_enabled("linear.get_issue"):
            return {"error": "Capability 'linear.get_issue' is disabled by integration capability policy."}

        lin_token = integration_manager.get_custom_credential("linear", "token") or integration_manager.get_custom_credential("linear", "api_key")

        issues = await linear_client.search_issues(query, custom_token=lin_token)
        return {
            "query": query,
            "issues": issues or [],
            "total_found": len(issues or [])
        }

    @classmethod
    async def post_linear_comment(cls, issue_key: str, comment: str) -> Dict[str, Any]:
        """
        Posts a progress update or PR resolution comment to a Linear issue.
        """
        from app.integrations.linear_client import linear_client
        from app.integrations.manager import integration_manager

        if not integration_manager.is_capability_enabled("linear.post_comment"):
            return {"error": "Capability 'linear.post_comment' is disabled by integration capability policy."}

        lin_token = integration_manager.get_custom_credential("linear", "token") or integration_manager.get_custom_credential("linear", "api_key")

        issue = await linear_client.get_issue(issue_key, custom_token=lin_token)
        issue_id = issue.get("id", issue_key) if issue else issue_key
        return await linear_client.post_comment(issue_id, comment, custom_token=lin_token)

    @classmethod
    async def update_linear_issue_status(cls, issue_key: str, state_id: str) -> Dict[str, Any]:
        """
        Transitions a Linear issue workflow status (e.g. 'In Progress', 'Done', or state ID).
        """
        from app.integrations.linear_client import linear_client
        from app.integrations.manager import integration_manager

        if not integration_manager.is_capability_enabled("linear.update_status"):
            return {"error": "Capability 'linear.update_status' is disabled by integration capability policy."}

        lin_token = integration_manager.get_custom_credential("linear", "token") or integration_manager.get_custom_credential("linear", "api_key")

        issue = await linear_client.get_issue(issue_key, custom_token=lin_token)
        issue_id = issue.get("id", issue_key) if issue else issue_key

        target_state_id = state_id
        if issue and "team" in issue and issue["team"]:
            states = issue["team"].get("states", {}).get("nodes", [])
            for st in states:
                if st.get("id") == state_id or st.get("name", "").lower() == state_id.strip().lower():
                    target_state_id = st.get("id")
                    break

        return await linear_client.update_issue_status(issue_id, target_state_id, custom_token=lin_token)

    @classmethod
    async def list_linear_teams(cls) -> Dict[str, Any]:
        """
        Lists Linear teams, their keys, workflow states, and labels.
        """
        from app.integrations.linear_client import linear_client
        from app.integrations.manager import integration_manager

        if not integration_manager.is_capability_enabled("linear.get_issue"):
            return {"error": "Capability 'linear.get_issue' is disabled by integration capability policy."}

        lin_token = integration_manager.get_custom_credential("linear", "token") or integration_manager.get_custom_credential("linear", "api_key")
        teams = await linear_client.list_teams(custom_token=lin_token)
        return {
            "teams": teams or [],
            "count": len(teams or [])
        }

    @classmethod
    async def create_linear_issue(
        cls,
        title: str,
        team: Optional[str] = "PD",
        description: Optional[str] = "",
        priority: Optional[int] = 0,
        state: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Creates a new Linear issue in the specified team (default 'PD').
        """
        from app.integrations.linear_client import linear_client
        from app.integrations.manager import integration_manager

        if not integration_manager.is_capability_enabled("linear.create_issue"):
            return {"error": "Capability 'linear.create_issue' is disabled by integration capability policy."}

        lin_token = integration_manager.get_custom_credential("linear", "token") or integration_manager.get_custom_credential("linear", "api_key")
        team_id = team or "PD"
        return await linear_client.create_issue(
            title=title,
            team_id_or_key=team_id,
            description=description,
            priority=priority,
            state_id=state,
            custom_token=lin_token
        )

    # =========================================================================
    # Ingrations Universal Tool Ecosystem
    # =========================================================================

    @classmethod
    def ingrations_search_tools(
        cls,
        query: str,
        category: Optional[str] = None,
        limit: int = 5
    ) -> Dict[str, Any]:
        """
        Sub-millisecond semantic BM25 search across 16+ apps in Ingrations catalog.
        """
        try:
            from ingrations import Ingrations
            from app.integrations.manager import integration_manager
            client = Ingrations()
            results = client.search_tools(query, limit=limit, category=category)
            return {
                "query": query,
                "count": len(results),
                "results": [
                    {
                        "action_id": r.action_id,
                        "app_name": r.app_name,
                        "action_name": r.action_name,
                        "description": r.description,
                        "category": r.category,
                        "score": round(r.score, 2),
                        "enabled": integration_manager.is_capability_enabled(r.action_id),
                        "parameters": [
                            {"name": p.name, "type": p.type, "required": p.required, "description": p.description}
                            for p in (client.get_action(r.action_id).parameters if client.get_action(r.action_id) else [])
                        ]
                    }
                    for r in results
                ]
            }
        except Exception as e:
            logger.error(f"Ingrations search failed: {e}")
            return {"error": f"Failed to search tools: {str(e)}", "query": query, "results": []}

    @classmethod
    async def ingrations_execute(
        cls,
        action_id: str,
        params: Optional[Dict[str, Any]] = None,
        dry_run: bool = False
    ) -> Dict[str, Any]:
        """
        Executes an external action using Ingrations execution engine.
        """
        try:
            from ingrations import Ingrations
            from app.integrations.manager import integration_manager

            if not integration_manager.is_capability_enabled(action_id):
                return {
                    "success": False,
                    "action_id": action_id,
                    "status_code": 403,
                    "error": f"Capability '{action_id}' is disabled by integration capability policy."
                }

            # Sync any credentials from Cyclode into Ingrations AuthManager
            integration_manager.sync_to_ingrations()

            client = Ingrations()
            result = await client.execute(action_id, params=params, dry_run=dry_run)
            return result.model_dump()
        except Exception as e:
            logger.error(f"Ingrations execute failed for '{action_id}': {e}")
            return {
                "success": False,
                "action_id": action_id,
                "status_code": 500,
                "error": f"Execution error: {str(e)}"
            }

    # =========================================================================
    # Tabular Data & Archive Inspection Tools
    # =========================================================================

    @staticmethod
    def query_table(
        workspace_path: Path,
        file_path: str,
        sql_query: Optional[str] = None,
        filter_query: Optional[str] = None,
        sort_col: Optional[str] = None,
        sort_dir: str = "asc",
        page: int = 1,
        page_size: int = 50
    ) -> Dict[str, Any]:
        """
        Parses and queries structured tabular files (CSV, TSV, JSONL, Parquet, SQLite) with column statistics,
        filtering, sorting, and in-memory SQL execution.
        """
        if not file_path or not str(file_path).strip():
            return {"error": "file_path cannot be empty"}
        clean_rel = str(file_path).strip().lstrip("/\\")
        ws_root = workspace_path.resolve()
        target_file = (ws_root / clean_rel).resolve()
        try:
            target_file.relative_to(ws_root)
        except ValueError:
            return {"error": "Access denied outside workspace"}
        if not target_file.exists() or not target_file.is_file():
            alt_target = (ws_root / ".cyclode" / "attachments" / Path(clean_rel).name).resolve()
            if alt_target.exists() and alt_target.is_file() and alt_target.is_relative_to(ws_root):
                target_file = alt_target
            else:
                return {"error": f"File '{clean_rel}' not found"}

        ext = target_file.suffix.lower()
        headers: List[str] = []
        rows: List[List[Any]] = []

        if ext in {".csv", ".tsv", ".txt"}:
            delim = "\t" if ext == ".tsv" else ","
            try:
                with open(target_file, "r", encoding="utf-8", errors="replace") as f:
                    sample = f.read(4096)
                    f.seek(0)
                    if ext != ".tsv" and sample:
                        counts = {",": sample.count(","), "\t": sample.count("\t"), ";": sample.count(";"), "|": sample.count("|")}
                        best_delim = max(counts, key=counts.get)
                        if counts[best_delim] > 0:
                            delim = best_delim
                    reader = csv.reader(f, delimiter=delim)
                    raw_rows = list(reader)
                    if raw_rows:
                        headers = [str(h).strip() for h in raw_rows[0]]
                        rows = raw_rows[1:]
            except Exception as e:
                return {"error": f"Failed to parse delimited file: {str(e)}"}
        elif ext == ".jsonl":
            try:
                with open(target_file, "r", encoding="utf-8", errors="replace") as f:
                    json_objs = []
                    for line in f:
                        if line.strip():
                            json_objs.append(json.loads(line))
                if json_objs:
                    all_keys = []
                    for o in json_objs:
                        if isinstance(o, dict):
                            for k in o.keys():
                                if k not in all_keys:
                                    all_keys.append(k)
                    headers = all_keys
                    for o in json_objs:
                        if isinstance(o, dict):
                            rows.append([str(o.get(k, "")) for k in headers])
                        else:
                            rows.append([str(o)])
            except Exception as e:
                return {"error": f"Failed to parse JSONL file: {str(e)}"}
        else:
            try:
                import pandas as pd
                if ext in {".parquet", ".pq"}:
                    df = pd.read_parquet(target_file)
                elif ext in {".xlsx", ".xls"}:
                    df = pd.read_excel(target_file)
                else:
                    df = pd.read_csv(target_file)
                headers = [str(c) for c in df.columns]
                rows = df.astype(str).values.tolist()
            except Exception as e:
                return {"error": f"Unsupported tabular format: {str(e)}"}

        # Column statistics & type inference
        col_types: Dict[str, str] = {}
        summary_stats: Dict[str, Dict[str, Any]] = {}

        for c_idx, h in enumerate(headers):
            vals = [r[c_idx] for r in rows if len(r) > c_idx and r[c_idx] != ""]
            total_vals = len(vals)
            null_count = len(rows) - total_vals
            unique_vals = len(set(vals))

            numeric_vals = []
            is_num = True if total_vals > 0 else False
            for v in vals[:200]:
                try:
                    numeric_vals.append(float(v))
                except ValueError:
                    is_num = False
                    break

            col_type = "number" if is_num else "string"
            col_types[h] = col_type
            stat_dict: Dict[str, Any] = {
                "type": col_type,
                "count": len(rows),
                "null_count": null_count,
                "unique_count": unique_vals,
            }
            if is_num and numeric_vals:
                stat_dict["min"] = min(numeric_vals)
                stat_dict["max"] = max(numeric_vals)
            summary_stats[h] = stat_dict

        # SQL Execution
        if sql_query and sql_query.strip():
            try:
                conn = sqlite3.connect(":memory:")
                sanitized_cols = [re.sub(r"[^\w]", "_", h) or f"col_{i}" for i, h in enumerate(headers)]
                col_defs = ", ".join([f'"{c}" TEXT' for c in sanitized_cols])
                conn.execute(f"CREATE TABLE data_table ({col_defs})")
                placeholders = ", ".join(["?"] * len(sanitized_cols))
                conn.executemany(
                    f"INSERT INTO data_table VALUES ({placeholders})",
                    [[r[i] if i < len(r) else None for i in range(len(sanitized_cols))] for r in rows]
                )
                cur = conn.cursor()
                cur.execute(sql_query.strip())
                sql_headers = [desc[0] for desc in cur.description] if cur.description else headers
                sql_rows = [list(r) for r in cur.fetchall()]
                conn.close()

                total_sql_rows = len(sql_rows)
                page_start = (page - 1) * page_size
                page_end = page_start + page_size
                paginated_sql_rows = sql_rows[page_start:page_end]

                return {
                    "file_path": clean_rel,
                    "headers": sql_headers,
                    "column_types": {h: "string" for h in sql_headers},
                    "rows": paginated_sql_rows,
                    "total_rows": total_sql_rows,
                    "page": page,
                    "page_size": page_size,
                    "summary_stats": summary_stats,
                    "is_sql_result": True
                }
            except Exception as e:
                return {
                    "file_path": clean_rel,
                    "headers": headers,
                    "column_types": col_types,
                    "rows": [],
                    "total_rows": 0,
                    "page": page,
                    "page_size": page_size,
                    "summary_stats": summary_stats,
                    "is_sql_result": True,
                    "error": f"SQL Error: {str(e)}"
                }

        filtered_rows = rows
        if filter_query and filter_query.strip():
            q = filter_query.strip().lower()
            filtered_rows = [r for r in rows if any(q in str(cell).lower() for cell in r)]

        if sort_col and sort_col in headers:
            s_idx = headers.index(sort_col)
            is_numeric = col_types.get(sort_col) == "number"

            def sort_key(row):
                val = row[s_idx] if s_idx < len(row) else ""
                if is_numeric:
                    try:
                        return (0, float(val))
                    except (ValueError, TypeError):
                        return (1, 0)
                return (0, str(val).lower())

            filtered_rows = sorted(filtered_rows, key=sort_key, reverse=(sort_dir == "desc"))

        total_filtered = len(filtered_rows)
        start_idx = (page - 1) * page_size
        end_idx = start_idx + page_size
        page_rows = filtered_rows[start_idx:end_idx]

        return {
            "file_path": clean_rel,
            "headers": headers,
            "column_types": col_types,
            "rows": page_rows,
            "total_rows": total_filtered,
            "page": page,
            "page_size": page_size,
            "summary_stats": summary_stats,
            "is_sql_result": False
        }

    @staticmethod
    def inspect_archive(workspace_path: Path, file_path: str) -> Dict[str, Any]:
        """
        Safely inspects archive hierarchy (.zip, .tar, .tar.gz, .tgz, .tar.bz2) in memory without disk extraction.
        """
        if not file_path or not str(file_path).strip():
            return {"error": "file_path cannot be empty"}
        clean_rel = str(file_path).strip().lstrip("/\\")
        ws_root = workspace_path.resolve()
        target_file = (ws_root / clean_rel).resolve()
        try:
            target_file.relative_to(ws_root)
        except ValueError:
            return {"error": "Access denied outside workspace"}
        if not target_file.exists() or not target_file.is_file():
            alt_target = (ws_root / ".cyclode" / "attachments" / Path(clean_rel).name).resolve()
            if alt_target.exists() and alt_target.is_file() and alt_target.is_relative_to(ws_root):
                target_file = alt_target
            else:
                return {"error": f"Archive file '{clean_rel}' not found"}

        entries = []
        total_uncompressed = 0
        name_lower = target_file.name.lower()

        if name_lower.endswith(".zip"):
            try:
                with zipfile.ZipFile(target_file, "r") as zf:
                    for info in zf.infolist():
                        is_dir = info.is_dir()
                        total_uncompressed += info.file_size
                        date_str = f"{info.date_time[0]}-{info.date_time[1]:02d}-{info.date_time[2]:02d} {info.date_time[3]:02d}:{info.date_time[4]:02d}:{info.date_time[5]:02d}"
                        entries.append({
                            "name": Path(info.filename).name or info.filename,
                            "path": info.filename.rstrip("/"),
                            "is_dir": is_dir,
                            "size": info.file_size,
                            "compressed_size": info.compress_size,
                            "date": date_str
                        })
            except Exception as e:
                return {"error": f"Failed to inspect zip archive: {str(e)}"}
        elif any(name_lower.endswith(ext) for ext in [".tar", ".tar.gz", ".tgz", ".tar.bz2", ".tbz2"]):
            try:
                with tarfile.open(target_file, "r:*") as tf:
                    for member in tf.getmembers():
                        is_dir = member.isdir()
                        total_uncompressed += member.size
                        date_str = datetime.fromtimestamp(member.mtime, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
                        entries.append({
                            "name": Path(member.name).name or member.name,
                            "path": member.name.rstrip("/"),
                            "is_dir": is_dir,
                            "size": member.size,
                            "compressed_size": member.size,
                            "date": date_str
                        })
            except Exception as e:
                return {"error": f"Failed to inspect tar archive: {str(e)}"}
        else:
            return {"error": "Unsupported archive format (expected .zip, .tar, .tar.gz, .tgz, .tar.bz2)"}

        comp_size = target_file.stat().st_size
        ratio = f"{(total_uncompressed / max(1, comp_size)):.1f}x" if total_uncompressed > 0 else "1.0x"

        return {
            "file_path": clean_rel,
            "name": target_file.name,
            "format": "zip" if name_lower.endswith(".zip") else "tar",
            "total_files": len(entries),
            "total_uncompressed_size": total_uncompressed,
            "total_compressed_size": comp_size,
            "compression_ratio": ratio,
            "entries": entries[:2000]
        }

    @staticmethod
    async def perform_multimodal_vision_analysis(
        b64_data: str,
        mime_type: str,
        prompt: str,
        active_provider: Optional[Any] = None
    ) -> Optional[str]:
        """
        Executes a multi-tier multimodal cascade to analyze image data (OCR, UI hierarchy, error logs):
        1. Explicit active provider if supplied and vision-capable.
        2. Priority provider aligned with current ANTIGRAVITY_MAJOR_MODEL (e.g. DeepSeek if configured).
        3. Fallback cascade across all configured vision engines:
           - Google Gemini (gemini-3.7-flash)
           - DeepSeek-V4.1-Flash (deepseek-flash)
           - Anthropic Claude (claude-3-5-haiku)
           - OpenAI (gpt-4o-mini)
        """
        # 1. Active provider attempt
        if active_provider and hasattr(active_provider, "analyze_visual"):
            try:
                res = await active_provider.analyze_visual(b64_data=b64_data, mime_type=mime_type, prompt=prompt)
                if res and res.strip():
                    return res.strip()
            except Exception as e:
                logger.debug(f"Active provider vision inspection notice: {e}")

        from app.config import settings
        from app.agent.providers.gemini import GeminiProvider
        from app.agent.providers.deepseek import DeepSeekProvider
        from app.agent.providers.claude import ClaudeProvider
        from app.agent.providers.openai import OpenAIProvider

        major_model = (getattr(settings, "ANTIGRAVITY_MAJOR_MODEL", None) or getattr(settings, "ANTIGRAVITY_MODEL", "")).lower()

        if "deepseek" in major_model:
            cascade_order = [
                ("deepseek", DeepSeekProvider()),
                ("gemini", GeminiProvider()),
                ("claude", ClaudeProvider()),
                ("openai", OpenAIProvider()),
            ]
        elif "claude" in major_model or "anthropic" in major_model or "fable" in major_model:
            cascade_order = [
                ("claude", ClaudeProvider()),
                ("gemini", GeminiProvider()),
                ("deepseek", DeepSeekProvider()),
                ("openai", OpenAIProvider()),
            ]
        elif "openai" in major_model or "gpt" in major_model:
            cascade_order = [
                ("openai", OpenAIProvider()),
                ("gemini", GeminiProvider()),
                ("deepseek", DeepSeekProvider()),
                ("claude", ClaudeProvider()),
            ]
        else:
            cascade_order = [
                ("gemini", GeminiProvider()),
                ("deepseek", DeepSeekProvider()),
                ("claude", ClaudeProvider()),
                ("openai", OpenAIProvider()),
            ]

        for prov_name, prov_inst in cascade_order:
            try:
                if prov_inst.get_api_key():
                    res = await prov_inst.analyze_visual(
                        b64_data=b64_data,
                        mime_type=mime_type,
                        prompt=prompt
                    )
                    if res and res.strip():
                        return res.strip()
            except Exception as e:
                logger.debug(f"Vision provider '{prov_name}' cascade error: {e}")

        return None

    @staticmethod
    async def view_image(
        workspace_path: Path,
        file_path: str,
        prompt: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Inspects and visually analyzes an image file (PNG, JPG, WEBP, GIF, SVG, BMP) from the workspace or attachments.
        Extracts dimensions, format, file size, and uses multimodal AI vision to return OCR text, layout descriptions,
        and visual inspection answers.
        """
        if not file_path or not str(file_path).strip():
            return {"error": "file_path cannot be empty"}
        clean_rel = str(file_path).strip().lstrip("/\\")
        ws_root = workspace_path.resolve()
        target_file = (ws_root / clean_rel).resolve()

        # If not found directly, check inside .cyclode/attachments/
        if not target_file.exists():
            alt_target = (ws_root / ".cyclode" / "attachments" / Path(clean_rel).name).resolve()
            if alt_target.exists():
                target_file = alt_target
                clean_rel = str(target_file.relative_to(ws_root))

        try:
            target_file.relative_to(ws_root)
        except ValueError:
            return {"error": "Access denied outside workspace"}

        if not target_file.exists() or not target_file.is_file():
            return {"error": f"Image file '{clean_rel}' not found"}

        file_size = target_file.stat().st_size
        mime_type, _ = mimetypes.guess_type(target_file.name)
        if not mime_type:
            ext = target_file.suffix.lower()
            if ext == ".png":
                mime_type = "image/png"
            elif ext in {".jpg", ".jpeg"}:
                mime_type = "image/jpeg"
            elif ext == ".webp":
                mime_type = "image/webp"
            elif ext == ".gif":
                mime_type = "image/gif"
            elif ext == ".svg":
                mime_type = "image/svg+xml"
            else:
                mime_type = "image/png"

        # Image properties
        width, height, img_format, mode = None, None, target_file.suffix.lstrip(".").upper(), "RGB"
        try:
            from PIL import Image as PILImage
            with PILImage.open(target_file) as im:
                width, height = im.size
                img_format = im.format or img_format
                mode = im.mode
        except Exception:
            pass

        # SVG special handling (extract text elements directly)
        if target_file.suffix.lower() == ".svg":
            try:
                svg_text = target_file.read_text(encoding="utf-8", errors="replace")
                return {
                    "file_path": clean_rel,
                    "name": target_file.name,
                    "mime_type": "image/svg+xml",
                    "size_bytes": file_size,
                    "format": "SVG",
                    "svg_preview": svg_text[:2000],
                    "visual_analysis": f"Vector SVG graphics file with {len(svg_text)} bytes.",
                }
            except Exception as e:
                return {"error": f"Failed to read SVG file: {str(e)}"}

        # Base64 encode for vision inspection
        raw_bytes = target_file.read_bytes()
        b64_data = base64.b64encode(raw_bytes).decode("utf-8")

        analysis_prompt = prompt.strip() if prompt and prompt.strip() else (
            "Analyze this image in detail. Extract all visible text and code (OCR), identify UI layout, "
            "components, dialog boxes, errors, buttons, and state indicators."
        )

        visual_analysis = None
        try:
            visual_analysis = await WorkspaceTools.perform_multimodal_vision_analysis(
                b64_data=b64_data,
                mime_type=mime_type,
                prompt=analysis_prompt
            )
        except Exception as e:
            logger.debug(f"Vision API cascade notice: {e}")

        task_id = workspace_path.name.replace("sandbox-", "")
        result: Dict[str, Any] = {
            "file_path": clean_rel,
            "name": target_file.name,
            "mime_type": mime_type,
            "size_bytes": file_size,
            "dimensions": f"{width}x{height} px" if width and height else "unknown",
            "format": img_format,
            "color_mode": mode,
            "raw_url": f"/api/tasks/{task_id}/files/raw?path={urllib.parse.quote(clean_rel)}"
        }
        if visual_analysis:
            result["visual_analysis"] = visual_analysis
        else:
            result["visual_analysis"] = (
                f"Image metadata: {img_format} {width}x{height} ({mode}), {file_size} bytes. "
                "(Visual model inspection offline/unconfigured. Configure DEEPSEEK_API_KEY or GEMINI_API_KEY for automatic multimodal analysis)."
            )
        return result

    @classmethod
    async def delegate_subtasks(
        cls,
        workspace_path: Path,
        subtasks: List[Dict[str, Any]],
        wait_for_completion: bool = True,
        timeout: int = 120,
        clear_existing: bool = True
    ) -> Dict[str, Any]:
        """
        Dispatches concurrent subagent tasks linked to the current parent task session.
        Each subtask object can specify:
          - title: (str) Short descriptive objective
          - prompt / description: (str) Detailed prompt instructions for the subagent
          - persona: (str) Subagent role (e.g. 'CodeReviewer', 'SecurityAuditor', 'SoftwareEngineer', 'TestEngineer', 'PerformanceEngineer')
          - model_name: (Optional[str]) Model override or inherited
          - session_key: (Optional[str]) E.g., 'pr-42', 'auth-module'
          - repo_name: (Optional[str])
          - repo_url: (Optional[str])
          - target_branch: (Optional[str])
        """
        if not subtasks:
            return {"error": "No subtasks provided for delegation", "subtasks_dispatched": 0, "results": []}

        # Cap concurrency to 5 maximum to avoid resource exhaustion
        if len(subtasks) > 5:
            subtasks = subtasks[:5]

        from app.agent.pool import agent_pool
        from app.db.session import async_session_factory
        from app.db.models import TaskModel, TaskDiffModel
        from sqlalchemy import select
        from sqlalchemy.orm import selectinload
        import time

        parent_task_id = workspace_path.name.replace("sandbox-", "")
        if not parent_task_id or parent_task_id == "default":
            parent_task_id = "default"

        # Clear prior subagents (both active and completed) before launching new swarm wave
        if clear_existing:
            retained_keys = [item.get("session_key") for item in subtasks if item.get("session_key")]
            await agent_pool.clear_subagents(
                parent_task_id=parent_task_id,
                retain_session_keys=retained_keys
            )

        # Check for existing subagents with matching session_keys under this parent task
        existing_subagents_by_key: Dict[str, Any] = {}
        async with async_session_factory() as session:
            stmt_existing = select(TaskModel).where(TaskModel.parent_task_id == parent_task_id)
            res_existing = await session.execute(stmt_existing)
            for existing in res_existing.scalars().all():
                if existing.session_key:
                    existing_subagents_by_key[existing.session_key] = existing

        dispatched_ids = []
        for idx, item in enumerate(subtasks):
            s_title = item.get("title") or f"Subtask {idx + 1}"
            s_prompt = item.get("prompt") or item.get("description") or s_title
            s_persona = item.get("persona") or "SoftwareEngineer"
            s_persona_inst = item.get("persona_instructions") or item.get("system_instructions")
            s_role_def = item.get("role_definition")
            s_model = item.get("model_name")
            s_session_key = item.get("session_key")
            s_repo_name = item.get("repo_name")
            s_repo_url = item.get("repo_url")
            s_target_branch = item.get("target_branch")

            # Stateful reuse: if matching session_key already exists, send follow-up message instead of spawning duplicate
            if s_session_key and s_session_key in existing_subagents_by_key:
                existing_pod = existing_subagents_by_key[s_session_key]
                try:
                    logger.info(f"Statefully reusing existing subagent pod '{existing_pod.title}' ({existing_pod.id}) for session_key='{s_session_key}'")
                    await agent_pool.send_user_message(
                        task_id=existing_pod.id,
                        message_text=s_prompt,
                        model_name=s_model
                    )
                    dispatched_ids.append(existing_pod.id)
                    continue
                except Exception as e:
                    logger.warning(f"Failed to reuse subagent pod {existing_pod.id}, will spawn fresh: {e}")

            try:
                sub_id = await agent_pool.spawn_task(
                    title=s_title,
                    description=s_prompt,
                    persona=s_persona,
                    persona_instructions=s_persona_inst,
                    role_definition=s_role_def,
                    model_name=s_model,
                    session_key=s_session_key,
                    repo_name=s_repo_name,
                    repo_url=s_repo_url,
                    target_branch=s_target_branch,
                    is_subsession=True,
                    parent_task_id=parent_task_id
                )
                dispatched_ids.append(sub_id)
            except Exception as e:
                logger.error(f"Failed to spawn subtask '{s_title}': {e}")

        if not wait_for_completion or not dispatched_ids:
            return {
                "subtasks_dispatched": len(dispatched_ids),
                "subagent_task_ids": dispatched_ids,
                "status": "DISPATCHED_ASYNC",
                "message": f"Successfully launched/resumed {len(dispatched_ids)} concurrent subagent pods in background."
            }

        # Poll until completion or timeout
        start_time = time.time()
        final_results = []
        while time.time() - start_time < timeout:
            async with async_session_factory() as session:
                stmt = select(TaskModel).where(TaskModel.id.in_(dispatched_ids)).options(
                    selectinload(TaskModel.diffs),
                    selectinload(TaskModel.logs),
                    selectinload(TaskModel.messages)
                )
                res = await session.execute(stmt)
                tasks_list = res.scalars().all()

                all_done = True
                for t in tasks_list:
                    if t.status in ["RUNNING", "INITIALIZING", "QUEUED"]:
                        all_done = False
                        break

                if all_done and len(tasks_list) == len(dispatched_ids):
                    for t in tasks_list:
                        last_agent_msg = ""
                        if t.messages:
                            agent_msgs = [m.content for m in t.messages if m.sender == "agent" and m.content]
                            if agent_msgs:
                                last_agent_msg = agent_msgs[-1]

                        summary = t.result_summary or ""
                        if last_agent_msg and (not summary or len(last_agent_msg) > len(summary)):
                            summary = last_agent_msg
                        if not summary:
                            summary = "Completed without explicit summary."
                        final_results.append({
                            "id": t.id,
                            "title": t.title,
                            "persona": t.persona,
                            "session_key": t.session_key,
                            "status": t.status,
                            "result_summary": summary,
                            "diffs_count": len(t.diffs or []),
                            "tools_count": len(t.logs or []),
                            "total_tokens": t.total_tokens
                        })
                    break

            await asyncio.sleep(1.0)

        # If timeout reached before all done
        if not final_results:
            async with async_session_factory() as session:
                stmt = select(TaskModel).where(TaskModel.id.in_(dispatched_ids)).options(
                    selectinload(TaskModel.diffs),
                    selectinload(TaskModel.logs)
                )
                res = await session.execute(stmt)
                for t in res.scalars().all():
                    final_results.append({
                        "id": t.id,
                        "title": t.title,
                        "persona": t.persona,
                        "session_key": t.session_key,
                        "status": t.status,
                        "result_summary": t.result_summary or f"Status: {t.status} (timed out after {timeout}s)",
                        "diffs_count": len(t.diffs or []),
                        "tools_count": len(t.logs or []),
                        "total_tokens": t.total_tokens
                    })

        return {
            "subtasks_dispatched": len(dispatched_ids),
            "results": final_results,
            "status": "COMPLETED" if all(r["status"] == "COMPLETED" for r in final_results) else "PARTIAL"
        }

    @classmethod
    async def send_subagent_message(
        cls,
        workspace_path: Path,
        message: str,
        subagent_id: Optional[str] = None,
        session_key: Optional[str] = None,
        wait_for_completion: bool = True,
        timeout: int = 120
    ) -> Dict[str, Any]:
        """
        Sends a follow-up message/instruction to an existing subagent pod by subagent_id or session_key,
        resuming its conversation in its existing sandbox without creating a duplicate task record.
        """
        from app.agent.pool import agent_pool
        from app.db.session import async_session_factory
        from app.db.models import TaskModel, TaskDiffModel
        from sqlalchemy import select
        from sqlalchemy.orm import selectinload
        import time

        parent_task_id = workspace_path.name.replace("sandbox-", "")
        if not parent_task_id or parent_task_id == "default":
            parent_task_id = "default"

        if not message or not message.strip():
            return {"error": "Message content cannot be empty"}

        if not subagent_id and not session_key:
            return {"error": "Must provide either subagent_id or session_key to identify target pod"}

        target_pod_id = subagent_id
        pod_title = ""
        pod_persona = ""
        async with async_session_factory() as session:
            stmt = select(TaskModel).where(TaskModel.parent_task_id == parent_task_id)
            if subagent_id:
                stmt = stmt.where(TaskModel.id == subagent_id)
            elif session_key:
                stmt = stmt.where(TaskModel.session_key == session_key)

            res = await session.execute(stmt)
            target_task = res.scalars().first()
            if not target_task:
                return {
                    "error": f"Subagent pod matching subagent_id='{subagent_id}' or session_key='{session_key}' not found under parent task '{parent_task_id}'."
                }
            target_pod_id = target_task.id
            pod_title = target_task.title
            pod_persona = target_task.persona

        # Dispatch follow-up message into existing subagent pod
        res = await agent_pool.send_user_message(
            task_id=target_pod_id,
            message_text=message.strip()
        )
        if not res.get("ok"):
            return {"error": f"Failed to send message to subagent: {res.get('error')}"}

        if not wait_for_completion:
            return {
                "subagent_id": target_pod_id,
                "title": pod_title,
                "persona": pod_persona,
                "status": "DISPATCHED_ASYNC",
                "message": f"Sent follow-up instruction to subagent '{pod_title}' ({target_pod_id}) in background."
            }

        # Poll until subagent completes follow-up turn or timeout
        start_time = time.time()
        while time.time() - start_time < timeout:
            async with async_session_factory() as session:
                stmt = select(TaskModel).where(TaskModel.id == target_pod_id).options(
                    selectinload(TaskModel.diffs),
                    selectinload(TaskModel.logs),
                    selectinload(TaskModel.messages)
                )
                res = await session.execute(stmt)
                t = res.scalars().first()
                if t and t.status not in ["RUNNING", "INITIALIZING", "QUEUED"]:
                    last_agent_msg = ""
                    if t.messages:
                        agent_msgs = [m.content for m in t.messages if m.sender == "agent" and m.content]
                        if agent_msgs:
                            last_agent_msg = agent_msgs[-1]
                    summary = t.result_summary or ""
                    if last_agent_msg and (not summary or len(last_agent_msg) > len(summary)):
                        summary = last_agent_msg
                    if not summary:
                        summary = "Completed without explicit summary."
                    return {
                        "subagent_id": t.id,
                        "title": t.title,
                        "persona": t.persona,
                        "session_key": t.session_key,
                        "status": t.status,
                        "result_summary": summary,
                        "diffs_count": len(t.diffs or []),
                        "tools_count": len(t.logs or []),
                        "total_tokens": t.total_tokens
                    }
            await asyncio.sleep(1.0)

        # Timeout reached
        async with async_session_factory() as session:
            stmt = select(TaskModel).where(TaskModel.id == target_pod_id).options(
                selectinload(TaskModel.diffs),
                selectinload(TaskModel.logs)
            )
            res = await session.execute(stmt)
            t = res.scalars().first()
            return {
                "subagent_id": target_pod_id,
                "title": pod_title,
                "persona": pod_persona,
                "session_key": t.session_key if t else None,
                "status": t.status if t else "TIMEOUT",
                "result_summary": t.result_summary if t else f"Timed out after {timeout}s waiting for subagent completion.",
                "diffs_count": len(t.diffs or []) if t else 0,
                "tools_count": len(t.logs or []) if t else 0,
                "total_tokens": t.total_tokens if t else 0
            }

    @classmethod
    async def batch_review_prs(
        cls,
        workspace_path: Path,
        repository: str,
        pr_numbers: List[int],
        wait_for_completion: bool = True,
        timeout: int = 180
    ) -> Dict[str, Any]:
        """
        Spawns dedicated CodeReviewer subagents for multiple GitHub pull requests in parallel.
        """
        if not pr_numbers:
            return {"error": "No PR numbers provided", "results": []}

        subtasks = []
        for num in pr_numbers:
            subtasks.append({
                "title": f"Review PR #{num} on {repository}",
                "prompt": (
                    f"Perform a thorough, verified code review for PR #{num} in repository '{repository}'. "
                    f"1. Fetch the diff and review all modified files.\n"
                    f"2. Run linter/syntax checks and unit tests.\n"
                    f"3. Provide an executive summary and post line-by-line review comments for any issues found."
                ),
                "persona": "CodeReviewer",
                "session_key": f"pr-{num}",
                "repo_name": repository
            })

        return await cls.delegate_subtasks(
            workspace_path=workspace_path,
            subtasks=subtasks,
            wait_for_completion=wait_for_completion,
            timeout=timeout
        )

    @classmethod
    async def apply_subagent_diff(
        cls,
        workspace_path: Path,
        subagent_task_id: str
    ) -> Dict[str, Any]:
        """
        Fetches the code diffs produced by a completed subagent task and atomically applies them
        to the parent workspace.
        """
        from app.db.session import async_session_factory
        from app.db.models import TaskModel, TaskDiffModel
        from sqlalchemy import select
        from sqlalchemy.orm import selectinload

        ws_root = workspace_path.resolve()
        parent_task_id = ws_root.name.replace("sandbox-", "")

        async with async_session_factory() as session:
            stmt = select(TaskModel).where(TaskModel.id == subagent_task_id).options(
                selectinload(TaskModel.diffs)
            )
            res = await session.execute(stmt)
            subagent = res.scalars().first()
            if not subagent:
                return {"error": f"Subagent task '{subagent_task_id}' not found"}

            diffs = subagent.diffs or []
            if not diffs:
                sub_ws = Path(subagent.workspace_path)
                if sub_ws.exists() and (sub_ws / ".git").exists():
                    try:
                        git_diff = subprocess.check_output(
                            ["git", "diff", "HEAD~1", "HEAD"],
                            cwd=str(sub_ws),
                            stderr=subprocess.STDOUT,
                            text=True
                        )
                        if git_diff.strip():
                            res_patch = cls.apply_unified_patch(workspace_path, git_diff)
                            return {
                                "success": True,
                                "subagent_id": subagent_task_id,
                                "message": "Successfully applied subagent git patch to workspace.",
                                "patch_result": res_patch
                            }
                    except Exception:
                        pass
                return {"error": f"No diffs or modifications found in subagent task '{subagent_task_id}'"}

            applied_files = []
            total_additions = 0
            total_deletions = 0

            for d in diffs:
                if d.diff_content and d.diff_content.strip():
                    try:
                        cls.apply_unified_patch(workspace_path, d.diff_content)
                        applied_files.append(d.file_path)
                        total_additions += d.additions
                        total_deletions += d.deletions
                    except Exception as e:
                        logger.warning(f"Patch application failed for {d.file_path}: {e}")

            from app.api.websocket import ws_manager
            await ws_manager.broadcast("DIFF_UPDATED", {
                "task_id": parent_task_id,
                "diffs": [
                    {"file_path": f, "additions": total_additions, "deletions": total_deletions}
                    for f in applied_files
                ]
            })

            return {
                "success": True,
                "subagent_id": subagent_task_id,
                "applied_files": applied_files,
                "additions": total_additions,
                "deletions": total_deletions,
                "message": f"Successfully applied diff from subagent '{subagent_task_id}' ({len(applied_files)} files modified)."
            }

    @classmethod
    async def get_subagent_results(
        cls,
        workspace_path: Path,
        subagent_task_ids: List[str]
    ) -> Dict[str, Any]:
        """
        Retrieves live status, active tool, result summary, and diffs for specified subagents.
        """
        from app.db.session import async_session_factory
        from app.db.models import TaskModel
        from sqlalchemy import select
        from sqlalchemy.orm import selectinload

        if not subagent_task_ids:
            return {"results": []}

        async with async_session_factory() as session:
            stmt = select(TaskModel).where(TaskModel.id.in_(subagent_task_ids)).options(
                selectinload(TaskModel.diffs),
                selectinload(TaskModel.logs)
            )
            res = await session.execute(stmt)
            tasks_list = res.scalars().all()
            
            results = []
            for t in tasks_list:
                results.append({
                    "id": t.id,
                    "title": t.title,
                    "persona": t.persona,
                    "model_name": t.model_name,
                    "status": t.status,
                    "result_summary": t.result_summary,
                    "diffs_count": len(t.diffs or []),
                    "tools_count": len(t.logs or []),
                    "total_tokens": t.total_tokens,
                    "created_at": t.created_at.isoformat() if t.created_at else None,
                    "completed_at": t.completed_at.isoformat() if t.completed_at else None
                })
            return {"results": results}
