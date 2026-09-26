import logging
from typing import Optional, Tuple
from app.core.sandboxes.container.client import container_client

logger = logging.getLogger("cyclode.sandbox.artifacts.registry")


class RegistryClient:
    """
    Handles authentication and image publishing to OCI registries
    (GitHub Packages GHCR, Docker Hub, AWS ECR, and private registries).
    """

    def __init__(self, client=None):
        self.client = client or container_client

    async def login(
        self,
        registry_url: str,
        username: str,
        secret_token: str
    ) -> Tuple[bool, str]:
        """
        Authenticates the container runtime against an external OCI registry.
        """
        if not await self.client.is_available():
            return False, "OCI container engine is offline"

        clean_reg = registry_url.replace("https://", "").replace("http://", "").rstrip("/")
        args = ["login", clean_reg, "-u", username, "--password", secret_token]

        code, out, err = await self.client.run_cli(args, timeout=20.0)
        if code == 0:
            logger.info(f"Successfully authenticated against registry {clean_reg} as {username}")
            return True, f"Logged in to {clean_reg}"
        else:
            return False, f"Registry authentication failed: {err or out}"

    async def push_image(
        self,
        local_tag: str,
        remote_tag: str
    ) -> Tuple[bool, str]:
        """
        Tags and pushes an OCI image to a remote registry endpoint.
        """
        if not await self.client.is_available():
            return False, "OCI container engine is offline"

        # 1. Tag local image for remote
        tag_code, _, tag_err = await self.client.run_cli(["tag", local_tag, remote_tag], timeout=10.0)
        if tag_code != 0:
            return False, f"Failed to tag image '{local_tag}' as '{remote_tag}': {tag_err}"

        # 2. Push to remote registry
        push_code, out, err = await self.client.run_cli(["push", remote_tag], timeout=300.0)
        combined_logs = out + ("\n" + err if err else "")

        if push_code == 0:
            logger.info(f"Successfully pushed image {remote_tag}")
            return True, combined_logs
        else:
            logger.warning(f"Failed to push image {remote_tag}: {err}")
            return False, combined_logs


registry_client = RegistryClient()
