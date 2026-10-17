"""
CortexDB Tier-1 Sidecar & MCP Bridge for Cyclode.

Mirrors the SearchBridge architecture to optionally connect to a live `cortexdb-grpc`
server (via `cortexdb_client` or HTTP/gRPC) or `cortexdb-mcp-stdio` binary when
configured via environment variables (`CORTEXDB_REMOTE`, `CORTEXDB_GRPC_ADDR`,
`CORTEXDB_PATH`), failing open to Cyclode's native Tier-2 SQLAlchemy CortexDB engine.
"""

import os
import json
import shutil
import socket
import logging
import subprocess
from pathlib import Path
from typing import Dict, Any, List, Optional

logger = logging.getLogger("cyclode.memory.cortex_bridge")


class CortexDBBridge:
    """
    2-Tier Dispatcher for CortexDB integration:
      Tier 1a: Live `cortexdb-grpc` sidecar via `cortexdb_client` (if running/configured)
      Tier 1b: Local `cortexdb-mcp-stdio` binary invocation (if installed on PATH)
      Tier 2: Native Python/SQLAlchemy CortexDB-inspired engine in `memory.py`
    """

    _grpc_checked: bool = False
    _grpc_available: bool = False
    _mcp_binary_path: Optional[Path] = None

    @classmethod
    def get_grpc_address(cls) -> Optional[str]:
        addr = os.environ.get("CORTEXDB_REMOTE") or os.environ.get("CORTEXDB_GRPC_ADDR")
        if addr:
            return addr.strip()
        return None

    @classmethod
    def is_sidecar_reachable(cls, timeout: float = 0.25) -> bool:
        addr = cls.get_grpc_address()
        if not addr:
            return False
        host, _, port_str = addr.replace("https://", "").replace("http://", "").partition(":")
        port = int(port_str) if port_str.isdigit() else 47821
        try:
            with socket.create_connection((host or "127.0.0.1", port), timeout=timeout):
                return True
        except Exception:
            return False

    @classmethod
    def get_mcp_binary(cls) -> Optional[Path]:
        if cls._mcp_binary_path and cls._mcp_binary_path.exists():
            return cls._mcp_binary_path
        for bin_name in ("cortexdb-mcp-stdio", "cortexdb-mcp"):
            found = shutil.which(bin_name)
            if found:
                cls._mcp_binary_path = Path(found)
                return cls._mcp_binary_path
        return None

    @classmethod
    def get_active_tier(cls) -> str:
        if cls.is_sidecar_reachable():
            return "cortexdb_grpc_sidecar"
        if cls.get_mcp_binary():
            return "cortexdb_mcp_binary"
        return "native_sqlalchemy_cortex"

    @classmethod
    def remember_BestEffort(
        cls,
        memory_id: str,
        content: str,
        scope: str = "repo",
        namespace: str = "cyclode",
        entities: Optional[List[str]] = None,
        relations: Optional[List[Dict[str, str]]] = None,
    ) -> bool:
        """
        Mirrors a memory write to the Tier-1 CortexDB sidecar if configured and reachable.
        Always non-blocking / fail-open so native database transactions never stall.
        """
        addr = cls.get_grpc_address()
        if not addr or not cls.is_sidecar_reachable():
            return False
        try:
            from cortexdb_client import CortexClient, proto  # type: ignore

            token = os.environ.get("CORTEXDB_GRPC_TOKEN", "")
            with CortexClient.connect(addr, token=token) as client:
                client.memory.SaveMemory(
                    proto.SaveMemoryRequest(
                        memory_id=memory_id,
                        scope=scope,
                        namespace=namespace,
                        content=content,
                    )
                )
                return True
        except Exception as exc:
            logger.debug(f"CortexDB sidecar remember fallback notice: {exc}")
            return False

    @classmethod
    def recall_sidecar(
        cls,
        query: str,
        entity_names: Optional[List[str]] = None,
        keywords: Optional[List[str]] = None,
        top_k: int = 5,
    ) -> Optional[Dict[str, Any]]:
        """
        Queries the Tier-1 CortexDB sidecar's KnowledgeMemory.Recall if active.
        Returns None when sidecar is unconfigured or unreachable so Tier-2 handles recall.
        """
        addr = cls.get_grpc_address()
        if not addr or not cls.is_sidecar_reachable():
            return None
        try:
            from cortexdb_client import CortexClient, proto  # type: ignore

            token = os.environ.get("CORTEXDB_GRPC_TOKEN", "")
            with CortexClient.connect(addr, token=token) as client:
                hits = client.knowledge.SearchKnowledge(
                    proto.SearchKnowledgeRequest(
                        query=query,
                        top_k=top_k,
                    )
                )
                results = []
                for h in getattr(hits, "results", []):
                    results.append(
                        {
                            "knowledge_id": getattr(h, "knowledge_id", ""),
                            "score": getattr(h, "score", 0.0),
                            "snippet": getattr(h, "snippet", ""),
                        }
                    )
                return {"engine": "cortexdb_grpc_sidecar", "results": results}
        except Exception as exc:
            logger.debug(f"CortexDB sidecar recall fallback notice: {exc}")
            return None
