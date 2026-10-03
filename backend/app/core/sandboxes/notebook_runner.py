import asyncio
import os
import io
import json
import time
import base64
import signal
import shutil
import logging
import subprocess
from pathlib import Path
from typing import Dict, Any, Optional, List, Tuple

from app.config import settings
from app.core.sandboxes.jailer import jailer
from app.core.sandboxes.container.client import container_client
from app.core.sandboxes.container.lifecycle import container_lifecycle
from app.api.websocket import ws_manager

logger = logging.getLogger("cyclode.notebook")


# Script template executed by the background Python worker process
KERNEL_WORKER_SCRIPT = """
import sys
import os
import io
import json
import base64
import traceback

global_namespace = {
    "__name__": "__main__",
    "__doc__": None,
}

def execute_payload(source_code, execution_count):
    old_stdout = sys.stdout
    old_stderr = sys.stderr
    sys.stdout = stdout_buf = io.StringIO()
    sys.stderr = stderr_buf = io.StringIO()

    outputs = []
    error_info = None

    try:
        import ast
        tree = ast.parse(source_code)
        
        # If the last statement is an expression (e.g. df, x + 1), evaluate it as an execute_result
        if tree.body and isinstance(tree.body[-1], ast.Expr):
            last_expr = tree.body.pop()
            if tree.body:
                exec(compile(tree, "<notebook>", "exec"), global_namespace)
            
            eval_code = compile(ast.Expression(last_expr.value), "<notebook>", "eval")
            res = eval(eval_code, global_namespace)

            # Check for matplotlib figures
            try:
                import matplotlib.pyplot as plt
                if plt.get_fignums():
                    for fnum in plt.get_fignums():
                        fig = plt.figure(fnum)
                        buf = io.BytesIO()
                        fig.savefig(buf, format="png", bbox_inches="tight", dpi=130)
                        buf.seek(0)
                        b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
                        outputs.append({
                            "output_type": "display_data",
                            "data": {"image/png": b64},
                            "metadata": {}
                        })
                    plt.close('all')
            except Exception:
                pass

            if res is not None:
                data = {"text/plain": repr(res)}
                try:
                    import pandas as pd
                    if isinstance(res, (pd.DataFrame, pd.Series)):
                        data["text/html"] = res.to_html() if isinstance(res, pd.DataFrame) else res.to_frame().to_html()
                except Exception:
                    pass
                outputs.append({
                    "output_type": "execute_result",
                    "execution_count": execution_count,
                    "data": data,
                    "metadata": {}
                })
        else:
            exec(compile(tree, "<notebook>", "exec"), global_namespace)

            # Check for matplotlib figures after exec
            try:
                import matplotlib.pyplot as plt
                if plt.get_fignums():
                    for fnum in plt.get_fignums():
                        fig = plt.figure(fnum)
                        buf = io.BytesIO()
                        fig.savefig(buf, format="png", bbox_inches="tight", dpi=130)
                        buf.seek(0)
                        b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
                        outputs.append({
                            "output_type": "display_data",
                            "data": {"image/png": b64},
                            "metadata": {}
                        })
                    plt.close('all')
            except Exception:
                pass

    except Exception as e:
        etype, evalue, tb = sys.exc_info()
        formatted_tb = traceback.format_exception(etype, evalue, tb)
        error_info = {
            "ename": getattr(e, "__class__", type(e)).__name__,
            "evalue": str(e),
            "traceback": formatted_tb
        }
        outputs.append({
            "output_type": "error",
            "ename": error_info["ename"],
            "evalue": error_info["evalue"],
            "traceback": error_info["traceback"]
        })
    finally:
        sys.stdout = old_stdout
        sys.stderr = old_stderr

    stdout_text = stdout_buf.getvalue()
    if stdout_text:
        outputs.insert(0, {
            "output_type": "stream",
            "name": "stdout",
            "text": stdout_text.splitlines(keepends=True)
        })

    stderr_text = stderr_buf.getvalue()
    if stderr_text:
        outputs.append({
            "output_type": "stream",
            "name": "stderr",
            "text": stderr_text.splitlines(keepends=True)
        })

    return outputs, error_info


def main():
    while True:
        try:
            line = sys.stdin.readline()
            if not line:
                break
            line = line.strip()
            if not line:
                continue
            
            req = json.loads(line)
            req_id = req.get("id")
            action = req.get("action")
            
            if action == "execute":
                source = req.get("source", "")
                exec_count = req.get("execution_count", 1)
                outputs, err = execute_payload(source, exec_count)
                resp = {
                    "id": req_id,
                    "status": "ok" if not err else "error",
                    "execution_count": exec_count,
                    "outputs": outputs,
                    "error": err
                }
                sys.stdout.write(json.dumps(resp) + "\\n")
                sys.stdout.flush()
            elif action == "ping":
                sys.stdout.write(json.dumps({"id": req_id, "status": "pong"}) + "\\n")
                sys.stdout.flush()
        except Exception as e:
            try:
                sys.stdout.write(json.dumps({"status": "fatal", "error": str(e)}) + "\\n")
                sys.stdout.flush()
            except Exception:
                break

if __name__ == "__main__":
    main()
"""


class NotebookKernelSession:
    """
    Manages an active Python REPL process executing code cells for a specific notebook.
    Preserves in-memory variables and state across cell runs.
    """

    def __init__(self, task_id: str, file_path: str, workspace_path: Path):
        self.task_id = task_id
        self.file_path = file_path
        self.workspace_path = workspace_path
        self.process: Optional[subprocess.Popen] = None
        self.execution_counter: int = 0
        self.is_running: bool = False
        self._lock = asyncio.Lock()
        self._req_counter = 0

    async def start(self) -> bool:
        """Starts the background kernel worker process."""
        if self.process and self.process.poll() is None:
            return True

        ws_dir = self.workspace_path.resolve()
        ws_dir.mkdir(parents=True, exist_ok=True)

        # Check for companion container
        container_name = container_lifecycle.get_container_name(self.task_id)
        is_container = False
        if await container_client.is_available():
            try:
                code, out, _ = await container_client.run_cli(
                    ["inspect", "--format", "{{.State.Running}}", container_name],
                    timeout=1.5
                )
                if code == 0 and out.strip().lower() == "true":
                    is_container = True
            except Exception:
                pass

        python_bin = shutil.which("python3") or shutil.which("python") or "python3"
        clean_env = jailer.get_clean_environment({
            "PYTHONUNBUFFERED": "1",
            "TERM": "xterm-256color",
            "HOME": str(ws_dir),
            "PWD": str(ws_dir),
            "CYCLODE_SANDBOX": "1",
            "CYCLODE_TASK_ID": self.task_id,
        })

        if is_container:
            engine_bin = container_client.binary_path or "docker"
            cmd = [
                engine_bin,
                "exec",
                "-i",
                "-w", "/workspace",
                "-e", "PYTHONUNBUFFERED=1",
                container_name,
                "python3",
                "-u",
                "-c",
                KERNEL_WORKER_SCRIPT
            ]
        else:
            cmd = [python_bin, "-u", "-c", KERNEL_WORKER_SCRIPT]

        try:
            self.process = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                cwd=str(ws_dir) if not is_container else None,
                env=clean_env if not is_container else None,
                text=True,
                bufsize=1,
            )
            logger.info(f"Started NotebookKernelSession for {self.task_id}:{self.file_path} (PID {self.process.pid})")
            return True
        except Exception as e:
            logger.error(f"Failed to start notebook kernel process for {self.task_id}: {e}")
            return False

    async def execute_cell(self, source_code: str) -> Dict[str, Any]:
        """Executes a code cell and returns standard Jupyter outputs and execution count."""
        async with self._lock:
            if not self.process or self.process.poll() is not None:
                started = await self.start()
                if not started or not self.process:
                    return {
                        "ok": False,
                        "execution_count": self.execution_counter,
                        "outputs": [{
                            "output_type": "error",
                            "ename": "KernelError",
                            "evalue": "Failed to spawn Python sandbox kernel",
                            "traceback": ["KernelError: Python environment unavailable in sandbox"]
                        }],
                        "execution_time_ms": 0,
                    }

            self.execution_counter += 1
            current_exec_count = self.execution_counter
            self._req_counter += 1
            req_id = f"req-{self._req_counter}"

            payload = {
                "id": req_id,
                "action": "execute",
                "source": source_code,
                "execution_count": current_exec_count
            }

            start_t = time.time()
            self.is_running = True

            try:
                loop = asyncio.get_running_loop()
                req_line = json.dumps(payload) + "\n"

                # Write request to worker stdin via executor
                await loop.run_in_executor(None, self.process.stdin.write, req_line)
                await loop.run_in_executor(None, self.process.stdin.flush)

                # Read response from worker stdout
                resp_line = await loop.run_in_executor(None, self.process.stdout.readline)
                elapsed_ms = int((time.time() - start_t) * 1000)

                if not resp_line:
                    return {
                        "ok": False,
                        "execution_count": current_exec_count,
                        "outputs": [{
                            "output_type": "error",
                            "ename": "KernelDeadError",
                            "evalue": "Kernel process terminated unexpectedly",
                            "traceback": ["Kernel process died during execution"]
                        }],
                        "execution_time_ms": elapsed_ms,
                    }

                resp_data = json.loads(resp_line.strip())
                outputs = resp_data.get("outputs", [])
                error_info = resp_data.get("error")

                return {
                    "ok": resp_data.get("status") == "ok",
                    "execution_count": current_exec_count,
                    "outputs": outputs,
                    "execution_time_ms": elapsed_ms,
                    "error": error_info,
                }

            except Exception as e:
                elapsed_ms = int((time.time() - start_t) * 1000)
                logger.error(f"Error executing notebook cell: {e}")
                return {
                    "ok": False,
                    "execution_count": current_exec_count,
                    "outputs": [{
                        "output_type": "error",
                        "ename": type(e).__name__,
                        "evalue": str(e),
                        "traceback": [f"Execution error: {str(e)}"]
                    }],
                    "execution_time_ms": elapsed_ms,
                }
            finally:
                self.is_running = False

    async def interrupt(self) -> bool:
        """Interrupts running execution."""
        if self.process and self.process.poll() is None:
            try:
                self.process.send_signal(signal.SIGINT)
                return True
            except Exception:
                pass
        return False

    async def restart(self) -> bool:
        """Restarts the kernel session and resets execution counter."""
        if self.process:
            try:
                self.process.terminate()
                self.process.wait(timeout=0.5)
            except Exception:
                try:
                    self.process.kill()
                except Exception:
                    pass
        self.process = None
        self.execution_counter = 0
        return await self.start()

    async def stop(self):
        """Terminates process and releases resources."""
        if self.process:
            try:
                self.process.terminate()
                self.process.wait(timeout=0.5)
            except Exception:
                try:
                    self.process.kill()
                except Exception:
                    pass
            self.process = None


class NotebookRunnerManager:
    """
    Central manager for active task notebook sessions.
    Handles cell execution, multi-cell pipelines, real-time WebSocket events, and .ipynb file persistence.
    """

    def __init__(self):
        # Maps (task_id, file_path) -> NotebookKernelSession
        self.sessions: Dict[Tuple[str, str], NotebookKernelSession] = {}

    def _get_session(self, task_id: str, file_path: str, workspace_path: Path) -> NotebookKernelSession:
        key = (task_id, file_path)
        if key not in self.sessions:
            self.sessions[key] = NotebookKernelSession(task_id, file_path, workspace_path)
        return self.sessions[key]

    async def execute_cell(
        self,
        task_id: str,
        file_path: str,
        workspace_path: Path,
        cell_index: int,
        source_code: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Executes a single code cell, updates the .ipynb notebook on disk, and broadcasts live events.
        """
        target_file = (workspace_path / file_path).resolve()
        if not target_file.exists() or not target_file.is_file():
            return {"ok": False, "error": f"File {file_path} not found"}

        # Read notebook JSON
        try:
            nb_data = json.loads(target_file.read_text(encoding="utf-8"))
        except Exception as e:
            return {"ok": False, "error": f"Failed to parse .ipynb JSON: {e}"}

        cells = nb_data.get("cells", [])
        if cell_index < 0 or cell_index >= len(cells):
            return {"ok": False, "error": f"Cell index {cell_index} out of range ({len(cells)} cells)"}

        cell = cells[cell_index]
        code_to_run = source_code if source_code is not None else "".join(cell.get("source", []))

        # Broadcast cell execution start
        await ws_manager.broadcast_task_event(
            task_id,
            "NOTEBOOK_CELL_START",
            {
                "file_path": file_path,
                "cell_index": cell_index,
            }
        )

        session = self._get_session(task_id, file_path, workspace_path)
        res = await session.execute_cell(code_to_run)

        # Update cell structure
        cell["execution_count"] = res.get("execution_count")
        cell["outputs"] = res.get("outputs", [])
        if source_code is not None:
            cell["source"] = source_code.splitlines(keepends=True)

        # Save updated notebook to disk
        try:
            target_file.write_text(json.dumps(nb_data, indent=1), encoding="utf-8")
        except Exception as e:
            logger.warning(f"Failed to auto-save .ipynb after execution: {e}")

        # Broadcast cell execution finish
        await ws_manager.broadcast_task_event(
            task_id,
            "NOTEBOOK_CELL_FINISH",
            {
                "file_path": file_path,
                "cell_index": cell_index,
                "execution_count": res.get("execution_count"),
                "outputs": res.get("outputs", []),
                "execution_time_ms": res.get("execution_time_ms", 0),
                "ok": res.get("ok", True),
            }
        )

        return res

    async def execute_all_cells(
        self,
        task_id: str,
        file_path: str,
        workspace_path: Path
    ) -> Dict[str, Any]:
        """
        Executes all code cells in sequential order, streaming progress via WebSocket.
        """
        target_file = (workspace_path / file_path).resolve()
        if not target_file.exists():
            return {"ok": False, "error": f"File {file_path} not found"}

        try:
            nb_data = json.loads(target_file.read_text(encoding="utf-8"))
        except Exception as e:
            return {"ok": False, "error": f"Failed to parse .ipynb JSON: {e}"}

        cells = nb_data.get("cells", [])
        total_code = sum(1 for c in cells if c.get("cell_type") == "code")
        executed_count = 0

        for idx, cell in enumerate(cells):
            if cell.get("cell_type") == "code":
                res = await self.execute_cell(task_id, file_path, workspace_path, idx)
                executed_count += 1
                if not res.get("ok"):
                    # Stop pipeline on unhandled exception
                    break

        return {"ok": True, "total_code_cells": total_code, "executed": executed_count}

    async def interrupt(self, task_id: str, file_path: str) -> bool:
        session = self.sessions.get((task_id, file_path))
        if session:
            return await session.interrupt()
        return False

    async def restart(self, task_id: str, file_path: str, workspace_path: Path, clear_outputs: bool = False) -> bool:
        key = (task_id, file_path)
        session = self.sessions.get(key)
        if session:
            await session.restart()
        else:
            session = self._get_session(task_id, file_path, workspace_path)
            await session.start()

        if clear_outputs:
            target_file = (workspace_path / file_path).resolve()
            if target_file.exists():
                try:
                    nb_data = json.loads(target_file.read_text(encoding="utf-8"))
                    for cell in nb_data.get("cells", []):
                        if cell.get("cell_type") == "code":
                            cell["outputs"] = []
                            cell["execution_count"] = None
                    target_file.write_text(json.dumps(nb_data, indent=1), encoding="utf-8")
                except Exception:
                    pass

        await ws_manager.broadcast_task_event(
            task_id,
            "NOTEBOOK_KERNEL_RESTARTED",
            {"file_path": file_path, "cleared_outputs": clear_outputs}
        )
        return True

    async def save_notebook(self, task_id: str, file_path: str, workspace_path: Path, notebook_data: Dict[str, Any]) -> bool:
        target_file = (workspace_path / file_path).resolve()
        try:
            target_file.relative_to(workspace_path)
            target_file.write_text(json.dumps(notebook_data, indent=1), encoding="utf-8")
            return True
        except Exception as e:
            logger.error(f"Failed to save notebook {file_path}: {e}")
            return False

    async def cleanup_task(self, task_id: str):
        keys_to_remove = [k for k in self.sessions if k[0] == task_id]
        for k in keys_to_remove:
            session = self.sessions.pop(k, None)
            if session:
                await session.stop()


notebook_runner = NotebookRunnerManager()
