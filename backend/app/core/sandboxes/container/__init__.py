"""
Modular OCI Container Engine Subsystem for Cyclode.
Provides client discovery, security policies, image resolution, lifecycle management, and execution.
"""

from app.core.sandboxes.container.client import ContainerClient, container_client
from app.core.sandboxes.container.policies import ContainerSecurityPolicy, default_security_policy
from app.core.sandboxes.container.images import ImageResolver, image_resolver
from app.core.sandboxes.container.executor import ContainerExecutor
from app.core.sandboxes.container.lifecycle import ContainerLifecycleManager

__all__ = [
    "ContainerClient",
    "container_client",
    "ContainerSecurityPolicy",
    "default_security_policy",
    "ImageResolver",
    "image_resolver",
    "ContainerExecutor",
    "ContainerLifecycleManager",
]
