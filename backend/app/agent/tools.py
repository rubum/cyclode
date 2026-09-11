import os
import subprocess
from pathlib import Path
from typing import Dict, Any, List


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
