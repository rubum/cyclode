from enum import Enum
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any


class ArtifactType(str, Enum):
    OCI_IMAGE = "OCI_IMAGE"
    STATIC_BUNDLE = "STATIC_BUNDLE"
    WASM_MODULE = "WASM_MODULE"
    STANDALONE_BINARY = "STANDALONE_BINARY"


class PublishTarget(str, Enum):
    OCI_REGISTRY = "OCI_REGISTRY"
    GITHUB_PACKAGES = "GITHUB_PACKAGES"
    STAGING_PREVIEW = "STAGING_PREVIEW"
    STATIC_S3 = "STATIC_S3"
    LOCAL_EXPORT = "LOCAL_EXPORT"


class DeploymentStatus(str, Enum):
    PENDING = "PENDING"
    BUILDING = "BUILDING"
    RUNNING = "RUNNING"
    FAILED = "FAILED"
    STOPPED = "STOPPED"


@dataclass
class ArtifactManifest:
    """
    Metadata representation of a packaged software artifact.
    """
    artifact_id: str
    task_id: str
    artifact_type: ArtifactType
    name: str
    version: str = "latest"
    tags: List[str] = field(default_factory=lambda: ["latest"])
    digest: str = ""
    size_bytes: int = 0
    entry_point: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_dict(self) -> Dict[str, Any]:
        return {
            "artifact_id": self.artifact_id,
            "task_id": self.task_id,
            "artifact_type": self.artifact_type.value,
            "name": self.name,
            "version": self.version,
            "tags": self.tags,
            "digest": self.digest,
            "size_bytes": self.size_bytes,
            "entry_point": self.entry_point,
            "metadata": self.metadata,
            "created_at": self.created_at,
        }


@dataclass
class DeploymentRecord:
    """
    Tracks an active staging or published deployment endpoint.
    """
    deployment_id: str
    artifact_id: str
    task_id: str
    target: PublishTarget
    status: DeploymentStatus = DeploymentStatus.PENDING
    endpoint_url: Optional[str] = None
    container_id: Optional[str] = None
    ports: Dict[str, int] = field(default_factory=dict)
    error_message: Optional[str] = None
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_dict(self) -> Dict[str, Any]:
        return {
            "deployment_id": self.deployment_id,
            "artifact_id": self.artifact_id,
            "task_id": self.task_id,
            "target": self.target.value,
            "status": self.status.value,
            "endpoint_url": self.endpoint_url,
            "container_id": self.container_id,
            "ports": self.ports,
            "error_message": self.error_message,
            "created_at": self.created_at,
        }
