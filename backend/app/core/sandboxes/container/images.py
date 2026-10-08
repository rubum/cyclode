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
        "elixir": "hexpm/elixir:1.20-erlang-29.0.1-debian-trixie-20260518-slim",
        "ruby": "ruby:3.3-slim-bookworm",
        "php": "php:8.3-cli-bookworm",
        "default": "debian:bookworm-slim",
    }

    def __init__(self):
        self._cached_images: set[str] = set()

    def _image_exists_locally(self, image_name: str) -> bool:
        if image_name in self._cached_images:
            return True
        try:
            import subprocess
            res = subprocess.run(["docker", "image", "inspect", image_name], capture_output=True, timeout=2.0)
            if res.returncode == 0:
                self._cached_images.add(image_name)
                return True
        except Exception:
            pass
        return False

    def resolve_image_for_workspace(self, workspace_path: Optional[Path] = None) -> str:
        """Inspects workspace files to select the ideal runtime image."""
        if hasattr(settings, "SANDBOX_CONTAINER_IMAGE") and settings.SANDBOX_CONTAINER_IMAGE:
            return settings.SANDBOX_CONTAINER_IMAGE

        if not workspace_path or not workspace_path.exists():
            return self.IMAGE_MAP["default"]

        # 1. Check for custom project Dockerfiles or local dev image
        custom_dockerfiles = [
            workspace_path / "auth" / "Dockerfile.dev",
            workspace_path / "Dockerfile.dev",
            workspace_path / "docker" / "Dockerfile.dev",
            workspace_path / ".devcontainer" / "Dockerfile"
        ]
        for df in custom_dockerfiles:
            if df.exists():
                try:
                    for line in df.read_text(encoding="utf-8", errors="ignore").splitlines():
                        trimmed = line.strip()
                        if trimmed.upper().startswith("FROM "):
                            img = trimmed.split()[1].strip()
                            if img:
                                return img
                except Exception:
                    pass

        # 2. Check .tool-versions for runtime pinning
        tv_path = workspace_path / ".tool-versions"
        if tv_path.exists():
            try:
                tv_text = tv_path.read_text(encoding="utf-8", errors="ignore")
                if "elixir" in tv_text:
                    return "hexpm/elixir:1.20-erlang-29.0.1-debian-trixie-20260518-slim"
            except Exception:
                pass

        if (workspace_path / "pubspec.yaml").exists():
            return self.IMAGE_MAP["flutter"]
        if (workspace_path / "Cargo.toml").exists():
            return self.IMAGE_MAP["rust"]
        if (workspace_path / "go.mod").exists():
            return self.IMAGE_MAP["go"]
        if (workspace_path / "mix.exs").exists():
            return self.IMAGE_MAP["elixir"]
        if (workspace_path / "Gemfile").exists():
            return self.IMAGE_MAP["ruby"]
        if (workspace_path / "composer.json").exists():
            return self.IMAGE_MAP["php"]
        if (workspace_path / "package.json").exists() or (workspace_path / "client" / "package.json").exists():
            return self.IMAGE_MAP["node"]
        if (workspace_path / "requirements.txt").exists() or (workspace_path / "pyproject.toml").exists():
            return self.IMAGE_MAP["python"]

        return self.IMAGE_MAP["default"]


image_resolver = ImageResolver()
