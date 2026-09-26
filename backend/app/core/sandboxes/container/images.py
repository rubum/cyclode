import logging
from pathlib import Path
from typing import Optional, Dict
from app.config import settings

logger = logging.getLogger("cyclode.sandbox.container.images")


class ImageResolver:
    """
    Resolves optimal container base images based on workspace framework manifests
    and provides asynchronous image verification.
    """

    IMAGE_MAP: Dict[str, str] = {
        "flutter": "ghcr.io/rubum/cyclode-mobile:latest",
        "react": "node:20-bookworm-slim",
        "node": "node:20-bookworm-slim",
        "rust": "rust:1.80-slim-bookworm",
        "go": "golang:1.22-bookworm",
        "python": "python:3.11-slim-bookworm",
        "default": "debian:bookworm-slim",
    }

    def __init__(self):
        self._cached_images: set[str] = set()

    def resolve_image_for_workspace(self, workspace_path: Optional[Path] = None) -> str:
        """Inspects workspace files to select the ideal runtime image."""
        if hasattr(settings, "SANDBOX_CONTAINER_IMAGE") and settings.SANDBOX_CONTAINER_IMAGE:
            return settings.SANDBOX_CONTAINER_IMAGE

        if not workspace_path or not workspace_path.exists():
            return self.IMAGE_MAP["default"]

        if (workspace_path / "pubspec.yaml").exists():
            return self.IMAGE_MAP["flutter"]
        if (workspace_path / "Cargo.toml").exists():
            return self.IMAGE_MAP["rust"]
        if (workspace_path / "go.mod").exists():
            return self.IMAGE_MAP["go"]
        if (workspace_path / "package.json").exists() or (workspace_path / "client" / "package.json").exists():
            return self.IMAGE_MAP["node"]
        if (workspace_path / "requirements.txt").exists() or (workspace_path / "pyproject.toml").exists():
            return self.IMAGE_MAP["python"]

        return self.IMAGE_MAP["default"]


image_resolver = ImageResolver()
