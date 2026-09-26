import os
import re
import uuid
import logging
from pathlib import Path
from typing import Optional, Tuple, Dict, Any

from app.core.sandboxes.artifacts.models import ArtifactType, ArtifactManifest
from app.core.sandboxes.container.client import container_client

logger = logging.getLogger("cyclode.sandbox.artifacts.packager")


class ArtifactPackager:
    """
    Builds, packages, and extracts reproducible software artifacts from workspace source trees.
    """

    def __init__(self, client=None):
        self.client = client or container_client

    def synthesize_dockerfile(self, workspace_path: Path) -> str:
        """
        Synthesizes an optimized, multi-stage production Dockerfile when none exists.
        """
        existing_df = workspace_path / "Dockerfile"
        if existing_df.exists() and existing_df.is_file():
            return existing_df.read_text(encoding="utf-8", errors="ignore")

        # React / Vite / Static Web
        if (workspace_path / "package.json").exists() or (workspace_path / "client" / "package.json").exists():
            return """# Multi-stage production build for Web Application
FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --prefer-offline --no-audit || npm install
COPY . .
RUN npm run build

FROM nginx:alpine-slim
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
"""

        # Python / FastAPI
        if (workspace_path / "requirements.txt").exists() or (workspace_path / "pyproject.toml").exists():
            return """# Production build for Python Application
FROM python:3.11-slim-bookworm
WORKDIR /app
COPY requirements*.txt pyproject*.toml ./
RUN pip install --no-cache-dir -r requirements.txt || true
COPY . .
EXPOSE 8000
CMD ["python3", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
"""

        # Go Application
        if (workspace_path / "go.mod").exists():
            return """# Multi-stage production build for Go
FROM golang:1.22-bookworm AS builder
WORKDIR /app
COPY go.mod go.sum* ./
RUN go mod download || true
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /bin/server .

FROM gcr.io/distroless/static-debian12
COPY --from=builder /bin/server /server
EXPOSE 8080
ENTRYPOINT ["/server"]
"""

        # Rust Application
        if (workspace_path / "Cargo.toml").exists():
            return """# Multi-stage production build for Rust
FROM rust:1.80-slim-bookworm AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock* ./
COPY src ./src
RUN cargo build --release

FROM debian:bookworm-slim
COPY --from=builder /app/target/release/* /usr/local/bin/
CMD ["app"]
"""

        # Default Static HTML Web Server
        return """# Lightweight Static Web Host
FROM nginx:alpine-slim
COPY . /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
"""

    async def package_artifact(
        self,
        task_id: str,
        workspace_path: Path,
        artifact_type: ArtifactType = ArtifactType.OCI_IMAGE,
        name: Optional[str] = None,
        tag: str = "latest"
    ) -> Tuple[Optional[ArtifactManifest], str]:
        """
        Builds and packages an artifact of the specified type.
        """
        clean_name = (name or f"cyclode-app-{task_id[:8]}").lower().replace(" ", "-")
        artifact_id = f"art-{uuid.uuid4().hex[:12]}"

        if artifact_type == ArtifactType.OCI_IMAGE:
            # Ensure Dockerfile exists in workspace
            dockerfile_path = workspace_path / "Dockerfile"
            if not dockerfile_path.exists():
                generated_content = self.synthesize_dockerfile(workspace_path)
                dockerfile_path.write_text(generated_content, encoding="utf-8")

            image_tag = f"{clean_name}:{tag}"
            if not await self.client.is_available():
                return None, "OCI container engine (docker/podman) is not running on host"

            code, out, err = await self.client.run_cli(
                ["build", "-t", image_tag, str(workspace_path.resolve())],
                timeout=300.0
            )
            combined_logs = out + ("\n" + err if err else "")

            if code != 0:
                logger.warning(f"Failed to build OCI image {image_tag}: {err}")
                return None, combined_logs

            # Query image inspect for digest and size
            _, insp_out, _ = await self.client.run_cli(["inspect", image_tag, "--format", "{{.Id}}||{{.Size}}"], timeout=10.0)
            parts = insp_out.strip().split("||")
            digest = parts[0] if parts else f"sha256:{uuid.uuid4().hex}"
            size = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 0

            manifest = ArtifactManifest(
                artifact_id=artifact_id,
                task_id=task_id,
                artifact_type=ArtifactType.OCI_IMAGE,
                name=clean_name,
                version=tag,
                tags=[image_tag],
                digest=digest,
                size_bytes=size,
                entry_point=image_tag,
                metadata={"engine": self.client.engine_type, "dockerfile": True}
            )
            return manifest, combined_logs

        elif artifact_type == ArtifactType.STATIC_BUNDLE:
            # Find primary dist / build directory
            bundle_dir = None
            for cand in ["dist", "build/web", "client/dist", "public", "Bundle"]:
                cand_p = workspace_path / cand
                if cand_p.exists() and cand_p.is_dir():
                    bundle_dir = cand_p
                    break

            if not bundle_dir:
                bundle_dir = workspace_path

            total_size = sum(f.stat().st_size for f in bundle_dir.glob("**/*") if f.is_file())
            manifest = ArtifactManifest(
                artifact_id=artifact_id,
                task_id=task_id,
                artifact_type=ArtifactType.STATIC_BUNDLE,
                name=clean_name,
                version=tag,
                tags=[f"{clean_name}:{tag}"],
                digest=f"sha256:{uuid.uuid4().hex}",
                size_bytes=total_size,
                entry_point=str(bundle_dir.relative_to(workspace_path)),
                metadata={"files_count": len(list(bundle_dir.glob("**/*")))}
            )
            return manifest, f"Packaged static distribution bundle from '{manifest.entry_point}' ({total_size} bytes)."

        return None, f"Unsupported artifact type '{artifact_type}'"


artifact_packager = ArtifactPackager()
