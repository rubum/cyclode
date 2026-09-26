from dataclasses import dataclass, field
from typing import List, Optional


@dataclass
class ContainerSecurityPolicy:
    """
    Encapsulates security constraints, cgroup resource limits, and capability sets
    for running autonomous agent sandboxes.
    """
    cpus: float = 4.0
    memory: str = "3g"
    pids_limit: int = 512
    cap_drop: List[str] = field(default_factory=lambda: ["ALL"])
    cap_add: List[str] = field(default_factory=lambda: ["CHOWN", "SETUID", "SETGID", "DAC_OVERRIDE", "FOWNER"])
    security_opts: List[str] = field(default_factory=lambda: ["no-new-privileges:true"])
    network_mode: str = "bridge"
    tmpfs_mounts: List[str] = field(default_factory=lambda: ["/tmp:rw,noexec,nosuid,size=512m"])
    env_vars: dict[str, str] = field(default_factory=lambda: {
        "DEBIAN_FRONTEND": "noninteractive",
        "CI": "true",
        "PAGER": "cat",
        "TERM": "xterm-256color"
    })

    def to_cli_args(self) -> List[str]:
        """Generates standard OCI CLI arguments for docker / podman run."""
        args: List[str] = []
        if self.cpus:
            args.extend(["--cpus", str(self.cpus)])
        if self.memory:
            args.extend(["--memory", self.memory])
        if self.pids_limit:
            args.extend(["--pids-limit", str(self.pids_limit)])

        for cap in self.cap_drop:
            args.extend(["--cap-drop", cap])
        for cap in self.cap_add:
            args.extend(["--cap-add", cap])

        for opt in self.security_opts:
            args.extend(["--security-opt", opt])

        if self.network_mode:
            args.extend(["--network", self.network_mode])

        for tmpfs in self.tmpfs_mounts:
            args.extend(["--tmpfs", tmpfs])

        for k, v in self.env_vars.items():
            args.extend(["-e", f"{k}={v}"])

        return args


default_security_policy = ContainerSecurityPolicy()
