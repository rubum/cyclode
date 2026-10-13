import os
import json
import asyncio
import logging
from pathlib import Path
from typing import Optional, Dict, Any
from app.core.sandboxes.base import CommandResult

logger = logging.getLogger("cyclode.sandbox.container.daemon")

# Directory shared between host backend and sandbox containers for IPC sockets
SOCKETS_DIR = Path("/cyclode_sockets") if Path("/cyclode_sockets").exists() else Path("/tmp/cyclode_sockets")

DAEMON_SCRIPT_PYTHON = r'''
import sys
import os
import json
import socket
import subprocess

sock_path = sys.argv[1] if len(sys.argv) > 1 else "/cyclode_sockets/default.sock"
os.makedirs(os.path.dirname(sock_path), exist_ok=True)
if os.path.exists(sock_path):
    try:
        os.remove(sock_path)
    except Exception:
        pass

server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
server.bind(sock_path)
server.listen(10)
os.chmod(sock_path, 0o777)

while True:
    try:
        conn, _ = server.accept()
        raw_req = b""
        while b"\n" not in raw_req:
            chunk = conn.recv(4096)
            if not chunk:
                break
            raw_req += chunk
        if not raw_req:
            conn.close()
            continue
        req = json.loads(raw_req.decode("utf-8").strip())
        cmd = req.get("command", "")
        cwd = req.get("workdir", "/workspace")
        env_extra = req.get("env") or {}
        env = os.environ.copy()
        env.update(env_extra)

        proc = subprocess.Popen(
            cmd,
            shell=True,
            cwd=cwd if os.path.isdir(cwd) else None,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        stdout, stderr = proc.communicate()
        resp = json.dumps({
            "exit_code": proc.returncode,
            "stdout": stdout,
            "stderr": stderr
        }) + "\n"
        conn.sendall(resp.encode("utf-8"))
        conn.close()
    except Exception as e:
        try:
            err_resp = json.dumps({"exit_code": 1, "stdout": "", "stderr": str(e)}) + "\n"
            conn.sendall(err_resp.encode("utf-8"))
            conn.close()
        except Exception:
            pass
'''


def get_socket_path(task_id: str) -> Path:
    clean_id = task_id.replace(" ", "-").replace("/", "-")[:32]
    return SOCKETS_DIR / f"{clean_id}.sock"


async def dispatch_daemon_command(
    task_id: str,
    command: str,
    workdir: str = "/workspace",
    timeout: float = 120.0,
    env: Optional[Dict[str, str]] = None
) -> Optional[CommandResult]:
    """
    Dispatches a command directly to the in-container cyclode-daemon over a UNIX domain socket.
    Returns CommandResult on success, or None if daemon is offline (triggering docker exec fallback).
    """
    sock_path = get_socket_path(task_id)
    if not sock_path.exists():
        return None

    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_unix_connection(str(sock_path)),
            timeout=1.5
        )
    except Exception as e:
        logger.debug(f"Daemon socket connection failed for task {task_id}: {e}")
        return None

    try:
        payload = json.dumps({
            "command": command,
            "workdir": workdir,
            "env": env or {}
        }) + "\n"
        writer.write(payload.encode("utf-8"))
        await writer.drain()

        raw_line = await asyncio.wait_for(reader.readline(), timeout=float(timeout))
        if not raw_line:
            return None

        data = json.loads(raw_line.decode("utf-8").strip())
        writer.close()
        await writer.wait_closed()

        return CommandResult(
            command=command,
            exit_code=int(data.get("exit_code", 0)),
            stdout=data.get("stdout", ""),
            stderr=data.get("stderr", "")
        )
    except Exception as e:
        logger.warning(f"Error during daemon command execution for task {task_id}: {e}")
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:
            pass
        return None
