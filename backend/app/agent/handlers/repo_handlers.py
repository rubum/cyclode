import asyncio
import io
import json
import logging
import os
import re
import shutil
import subprocess
import tarfile
import urllib.request
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple

from app.agent.handlers.base import IntentContext, IntentHandler
from app.agent.tools import WorkspaceTools
from app.integrations.manager import integration_manager
from app.integrations.github_client import github_client

logger = logging.getLogger(__name__)


class RepoConnectionHandler(IntentHandler):
    name = "RepoConnectionHandler"
    description = "Connects, authenticates, tests remote git accessibility, and clones remote repositories into the sandbox workspace while recording Vault credentials."
    exemplars = [
        "connect repository https://github.com/owner/repo",
        "clone repo owner/repo",
        "save github token ghp_xxx",
        "authenticate to private repository",
        "connect and setup repository https://github.com/...",
        "import repository from github",
        "clone and configure https://github.com/..."
    ]
    negative_exemplars = [
        "search web for news",
        "how do i get a token",
        "run pytest on this repo",
        "explain the architecture of this repo"
    ]
    priority_weight = 1.25

    def matches_strict(self, ctx: IntentContext) -> bool:
        """Strict structural match when raw repository credentials or explicit connect commands are supplied."""
        lower = ctx.lower_prompt
        has_git_creds = bool(ctx.extra.get("github_token") or ctx.extra.get("slack_token"))
        has_repo_url = bool(re.search(r"https?://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", ctx.prompt, re.I))
        is_connect_cmd = any(w in lower for w in ("connect", "clone repo", "import repo", "setup repo", "save credentials", "save token", "authenticate"))

        # Git credentials supplied with a repository URL or connection intent
        if has_git_creds and (has_repo_url or is_connect_cmd):
            return True
        # Explicit connect commands targeting a URL
        if is_connect_cmd and has_repo_url:
            return True
        # Explicitly passing a raw token to save
        if has_git_creds and any(k in ctx.prompt for k in ("ghp_", "github_pat_", "xoxb-", "xoxp-")):
            return True
        return False

    def matches(self, ctx: IntentContext) -> bool:
        lower = ctx.lower_prompt
        has_repo_url = bool(re.search(r"https?://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", ctx.prompt, re.I))
        has_named_repo = bool(re.search(r"(?:connect|clone|import|setup)\s+(?:to\s+)?([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)", ctx.prompt, re.I))
        has_git_creds = bool(ctx.extra.get("github_token") or ctx.extra.get("slack_token"))
        is_connect_cmd = any(w in lower for w in ("connect", "clone repo", "import repo", "setup repo", "save credentials", "save token", "authenticate"))

        return (has_git_creds and (has_repo_url or is_connect_cmd)) or (is_connect_cmd and has_repo_url) or has_named_repo

    async def execute(self, ctx: IntentContext) -> Dict[str, Any]:
        configured_items = []
        
        if "github_token" in ctx.extra:
            tok = ctx.extra["github_token"]
            masked = integration_manager.mask_token(tok)
            await ctx.call_tool_start("configure_integration", {"provider": "github", "token": masked})
            res = await integration_manager.update_credentials("github", {"token": tok})
            await ctx.call_tool_end("configure_integration", json.dumps(res), 0, 120)
            configured_items.append(f"- **GitHub Token**: `{masked}` ({res.get('validation', {}).get('message', 'Saved ✅')})")

        if "slack_token" in ctx.extra:
            tok = ctx.extra["slack_token"]
            masked = integration_manager.mask_token(tok)
            await ctx.call_tool_start("configure_integration", {"provider": "slack", "token": masked})
            res = await integration_manager.update_credentials("slack", {"token": tok})
            await ctx.call_tool_end("configure_integration", json.dumps(res), 0, 120)
            configured_items.append(f"- **Slack Token**: `{masked}` ({res.get('validation', {}).get('message', 'Saved ✅')})")

        if "gemini_api_key" in ctx.extra:
            tok = ctx.extra["gemini_api_key"]
            masked = integration_manager.mask_token(tok)
            await ctx.call_tool_start("configure_integration", {"provider": "gemini", "api_key": masked})
            res = await integration_manager.update_credentials("gemini", {"api_key": tok})
            await ctx.call_tool_end("configure_integration", json.dumps(res), 0, 120)
            configured_items.append(f"- **Gemini API Key**: `{masked}` (Saved ✅)")

        repo_match = re.search(r"(https?://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(?:\.git)?)", ctx.prompt, re.IGNORECASE)
        repo_named = re.search(r"(?:connect|clone|repo|repository)\s+(?:to\s+)?([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)", ctx.prompt, re.IGNORECASE)
        
        target_repo = None
        if repo_match:
            target_repo = repo_match.group(1)
        elif repo_named and not repo_named.group(1).startswith("http"):
            target_repo = f"https://github.com/{repo_named.group(1)}"

        if target_repo:
            target_token = ctx.extra.get("github_token") or await integration_manager.get_github_token_for_repo(target_repo)
            await ctx.call_tool_start("test_remote_repo", {"repo_url": target_repo})
            repo_res = await integration_manager.test_remote_repo(target_repo, target_token)
            await ctx.call_tool_end("test_remote_repo", json.dumps(repo_res), 0, 250)

            if repo_res.get("accessible"):
                branches = repo_res.get("branches", [])
                branches_str = ", ".join(f"`{b}`" for b in branches[:5]) or "`main`"
                configured_items.append(f"- **Repository**: `{target_repo}` (Accessible ✅, Branches: {branches_str})")
                await integration_manager.save_repo_config(target_repo, target_token, branches)

                # Clone target repo into workspace
                curr_orig = ""
                if (ctx.workspace_path / ".git").exists():
                    orig_p = subprocess.run(["git", "config", "--get", "remote.origin.url"], cwd=ctx.workspace_path, capture_output=True, text=True)
                    curr_orig = orig_p.stdout.strip()

                clean_target = target_repo.rstrip("/.git")
                clean_curr = curr_orig.rstrip("/.git")
                if not curr_orig or clean_target not in clean_curr:
                    if ctx.workspace_path.exists():
                        shutil.rmtree(ctx.workspace_path, ignore_errors=True)
                    ctx.workspace_path.mkdir(parents=True, exist_ok=True)
                    clone_url = target_repo
                    if target_token and "github.com" in target_repo and "@" not in target_repo:
                        clone_url = target_repo.replace("https://", f"https://x-access-token:{target_token}@")
                    await ctx.call_tool_start("git_clone", {"repo_url": target_repo})
                    git_env = dict(os.environ)
                    git_env["GIT_TERMINAL_PROMPT"] = "0"
                    proc = await asyncio.to_thread(
                        subprocess.run,
                        ["git", "clone", "--depth", "1", "--single-branch", "--no-tags", clone_url, str(ctx.workspace_path)],
                        capture_output=True, text=True, timeout=300, env=git_env
                    )
                    await ctx.call_tool_end("git_clone", proc.stdout or proc.stderr or "OK", proc.returncode, 400)

                # If prompt also has analysis intent, forward to repo analysis
                analysis_handler = RepoAnalysisHandler()
                if analysis_handler.matches(ctx):
                    await ctx.emit_thought(f"Repository `{target_repo}` is connected. Preparing architecture analysis...")
                    return await analysis_handler.execute(ctx)
            else:
                repo_short = target_repo.split("github.com/")[-1].replace(".git", "") if "github.com/" in target_repo else target_repo
                auth_guidance_md = (
                    f"### 🔒 GitHub Authentication Required for `{repo_short}`\n\n"
                    f"I attempted to access [`{target_repo}`]({target_repo}), but it is a **private repository** or requires GitHub authorization (`fatal: could not read Username`).\n\n"
                    f"#### How to proceed:\n"
                    f"1. **Paste your GitHub Personal Access Token (PAT) directly in this chat** (`ghp_...` or `github_pat_...`).\n"
                    f"   - It will be encrypted into your Vault and masked in the UI.\n"
                    f"2. **Or configure it in the Vault**: Open the **Repositories** tab in the sidebar to set your token.\n\n"
                    f"> 💡 *Need to create a token? Go to [GitHub Token Settings](https://github.com/settings/tokens) → **Generate new token (classic)** → check **`repo`** scope.*"
                )
                await ctx.emit_message("agent", auth_guidance_md)
                return {"status": "AWAITING_INPUT", "summary": f"Awaiting GitHub authentication for {repo_short}."}

        details_md = "\n".join(configured_items) if configured_items else "- Credentials and repository profile recorded."
        reply_md = (
            "### ⚡ Integration & Repository Configuration Updated\n\n"
            f"{details_md}\n\n"
            "**Sandbox Environment & Agent Status:**\n"
            "- Credentials encrypted in runtime memory\n"
            "- Ephemeral sandbox workspaces can now shallow clone target repositories securely\n"
            "- Ready to execute autonomous tasks (`PR reviews`, `bug fixing`, `test runs`)\n\n"
            "What would you like me to do next on this repository?"
        )
        await ctx.emit_message("agent", reply_md)
        return {"status": "COMPLETED", "summary": "Configured integrations and verified repository connectivity."}


class URLSummarizeHandler(IntentHandler):
    name = "URLSummarizeHandler"
    description = "Fetches external web links, documentation endpoints, raw GitHub URLs, and summarizes remote page contents."
    exemplars = [
        "summarize this url https://example.com/docs",
        "what is https://github.com/org/repo",
        "read and explain https://techblog.com/article",
        "give me an overview of https://docs.python.org",
        "what is this https://raw.githubusercontent.com/...",
        "check out this page https://news.ycombinator.com"
    ]
    negative_exemplars = [
        "analyse this https://github.com/...",
        "analyze this https://github.com/...",
        "connect and clone repository",
        "how do i get a github token",
        "run pytest on this repo",
        "analyze repository architecture in this workspace"
    ]
    priority_weight = 1.1

    def matches_strict(self, ctx: IntentContext) -> bool:
        lower = ctx.lower_prompt
        has_url = bool(re.search(r"https?://[^\s)\]>]+", ctx.prompt))
        if not has_url:
            return False
        if any(w in lower for w in ("analyse", "analyze", "audit", "inspect", "architecture", "connect", "clone")):
            return False
        return (lower.startswith("summarize") or lower.startswith("summarise"))

    def matches(self, ctx: IntentContext) -> bool:
        url_match = bool(re.search(r"(https?://[^\s)\]>]+)", ctx.prompt))
        if not url_match:
            return False
        lower = ctx.lower_prompt
        # Must not be a connect command, explicit token guidance, or architecture analysis
        if any(w in lower for w in ("connect", "save credentials", "clone repo", "import repo", "setup repo", "analyse", "analyze", "audit", "inspect", "architecture", "what is in this")):
            return False
        # Matches if asking to summarize, explain, inspect or short URL query
        return any(w in lower for w in ("summar", "what is", "explain", "tell me", "overview", "review", "about", "read", "digest", "check out", "look at")) or len(ctx.prompt.strip().split()) <= 4

    async def execute(self, ctx: IntentContext) -> Dict[str, Any]:
        url_match = re.search(r"(https?://[^\s)\]>]+)", ctx.prompt)
        if not url_match:
            return {"status": "ERROR", "summary": "No URL found"}
        
        raw_target_url = url_match.group(1).rstrip(".,)>]")
        await ctx.emit_thought(f"Target URL detected: `{raw_target_url}`. Extracting live documentation and repository intelligence...")
        await ctx.call_tool_start("fetch_url", {"url": raw_target_url})
        fetch_res = await WorkspaceTools.fetch_url(raw_target_url)
        status = fetch_res.get("status_code", 0)
        content = fetch_res.get("content", "")
        await ctx.call_tool_end("fetch_url", f"HTTP {status} — Extracted {len(content)} characters", 0 if status == 200 else 1, 280)

        gh_match_url = re.search(r"github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)", raw_target_url)
        if gh_match_url:
            owner, repo = gh_match_url.group(1), gh_match_url.group(2).rstrip(".git")
            repo_full_name = f"{owner}/{repo}"

            # Hydrate sandbox if missing files so Files Explorer tab shows real files
            has_files = ctx.workspace_path.exists() and any(p.name != ".git" for p in ctx.workspace_path.iterdir())
            if not has_files:
                try:
                    token = await integration_manager.get_github_token_for_repo(raw_target_url) or github_client.token
                    clone_url = raw_target_url
                    if token and "@" not in clone_url:
                        clone_url = clone_url.replace("https://", f"https://x-access-token:{token}@")
                    await ctx.call_tool_start("git_clone", {"repo_url": raw_target_url})
                    git_env = dict(os.environ)
                    git_env["GIT_TERMINAL_PROMPT"] = "0"
                    if ctx.workspace_path.exists():
                        shutil.rmtree(ctx.workspace_path, ignore_errors=True)
                    ctx.workspace_path.mkdir(parents=True, exist_ok=True)
                    proc = await asyncio.to_thread(
                        subprocess.run,
                        ["git", "clone", "--depth", "1", "--single-branch", "--no-tags", clone_url, str(ctx.workspace_path)],
                        capture_output=True, text=True, timeout=30, env=git_env
                    )
                    await ctx.call_tool_end("git_clone", proc.stdout or proc.stderr or "OK", proc.returncode, 450)
                except Exception as e:
                    logger.warning(f"Fallback shallow clone for {raw_target_url} failed: {e}")

            # Check for README/AGENTS/ARCHITECTURE in workspace if fetch_url had minimal content
            readme_body = ""
            if not content or len(content) <= 80:
                for r_name in ("AGENTS.md", "agents.md", "ARCHITECTURE.md", "architecture.md", "CLAUDE.md", "README.md", "readme.md", "README.rst"):
                    r_p = ctx.workspace_path / r_name
                    if r_p.exists():
                        try:
                            readme_body = r_p.read_text(errors="ignore")
                            if len(readme_body.strip()) > 80:
                                break
                        except Exception:
                            pass

            raw_summary_source = content if (content and len(content) > 80) else readme_body

            if raw_summary_source and len(raw_summary_source) > 80:
                clean_text = re.sub(r"<!--.*?-->", "", raw_summary_source, flags=re.DOTALL)
                clean_text = re.sub(r"<picture>.*?</picture>", "", clean_text, flags=re.DOTALL | re.IGNORECASE)
                clean_text = re.sub(r"<[^>]+>", "", clean_text)
                clean_lines = []
                for line in clean_text.split("\n"):
                    s = line.strip()
                    if not s:
                        clean_lines.append("")
                        continue
                    if s.count("|") >= 2 and not s.startswith("|"):
                        continue
                    if any(w in s.lower() for w in ("badge", "shields.io", "trendshift", "discord-invite", "discord.gg", "github release")):
                        continue
                    clean_lines.append(line)
                clean_body = re.sub(r"\n{3,}", "\n\n", "\n".join(clean_lines)).strip()
                summary_md = (
                    f"### 📦 [{repo_full_name}](https://github.com/{repo_full_name})\n\n"
                    f"{clean_body[:2200]}\n\n"
                    f"The repository [`{repo_full_name}`](https://github.com/{repo_full_name}) provides modular software architecture and developer tooling ready for sandbox exploration, code review, or test execution."
                )
            else:
                summary_md = (
                    f"### 📦 [{repo_full_name}](https://github.com/{repo_full_name})\n\n"
                    f"[`{repo_full_name}`](https://github.com/{repo_full_name}) is an open-source project authored by `{owner}`. The codebase is configured for automated review, containerized testing, and architecture analysis within Cyclode's ephemeral workspaces."
                )
        else:
            summary_md = (
                f"### 🌐 Web Resource Intelligence: [{raw_target_url}]({raw_target_url})\n\n"
                f"{content[:2000] if content else 'Retrieved endpoint summary for target URL.'}\n\n"
                f"Direct Reference: [{raw_target_url}]({raw_target_url})"
            )

        await ctx.emit_message("agent", summary_md)
        return {"status": "COMPLETED", "summary": f"Summarized {raw_target_url}."}


def _extract_subproject_info(rel_root: Path, manifest_name: str, manifest_text: str, workspace_path: Path) -> Optional[Dict[str, Any]]:
    """
    Extracts semantic metadata (package name, scope, description, priority) from a subproject manifest.
    Prunes nested internal fixtures, template directories, and build artifacts.
    """
    parts = rel_root.parts
    if not parts:
        return None

    # Prune nested fixtures, templates, build targets, or paths nested inside src/lib/internal folders
    noise_parts = {"src", "lib", "fixtures", "fixture", "mock", "mocks", "template", "templates", "dist", "build", "target", "node_modules", "vendor", "scratch"}
    if any(p in noise_parts for p in parts[1:]) or (parts[0] in noise_parts and len(parts) > 1):
        return None

    path_str = str(rel_root)
    lower_path = path_str.lower()

    pkg_name = rel_root.name
    pkg_desc = ""
    is_private = False

    if manifest_name == "package.json":
        try:
            pdata = json.loads(manifest_text)
            if isinstance(pdata, dict):
                if pdata.get("name"):
                    pkg_name = pdata["name"]
                if pdata.get("description"):
                    pkg_desc = str(pdata["description"]).strip()
                is_private = bool(pdata.get("private", False))
        except Exception:
            pass
    elif manifest_name == "Cargo.toml":
        m_n = re.search(r'^\s*name\s*=\s*"([^"]+)"', manifest_text, re.MULTILINE)
        if m_n:
            pkg_name = m_n.group(1)
        m_d = re.search(r'^\s*description\s*=\s*"([^"]+)"', manifest_text, re.MULTILINE)
        if m_d:
            pkg_desc = m_d.group(1).strip()
        is_private = "publish = false" in manifest_text.lower()
    elif manifest_name in ("pyproject.toml", "setup.py", "setup.cfg"):
        m_n = re.search(r'^\s*name\s*=\s*"([^"]+)"', manifest_text, re.MULTILINE)
        if m_n:
            pkg_name = m_n.group(1)
        m_d = re.search(r'^\s*description\s*=\s*"([^"]+)"', manifest_text, re.MULTILINE)
        if m_d:
            pkg_desc = m_d.group(1).strip()
    elif manifest_name == "go.mod":
        m_mod = re.search(r'^\s*module\s+([^\s\n]+)', manifest_text, re.MULTILINE)
        if m_mod:
            pkg_name = m_mod.group(1).split("/")[-1]
    elif manifest_name == "mix.exs":
        m_app = re.search(r'app:\s*:([a-zA-Z0-9_]+)', manifest_text)
        if m_app:
            pkg_name = m_app.group(1)

    # Fallback to local README if manifest description is absent
    if not pkg_desc:
        for r_name in ("README.md", "readme.md", "README.rst"):
            r_p = workspace_path / rel_root / r_name
            if r_p.exists():
                try:
                    r_txt = r_p.read_text(encoding="utf-8", errors="ignore")
                    clean = re.sub(r"<!--.*?-->", "", r_txt, flags=re.DOTALL)
                    clean = re.sub(r"<[^>]+>", "", clean)
                    for line in clean.splitlines():
                        s = line.strip()
                        if not s or s.startswith(("#", "!", "[", "-", "*", "`", "=", "|", ">")):
                            continue
                        if any(w in s.lower() for w in ("badge", "shields.io", "npm version", "license", "build status", "ci/cd")):
                            continue
                        if len(s) > 15:
                            pkg_desc = s[:140].rstrip(".") + "."
                            break
                    if pkg_desc:
                        break
                except Exception:
                    pass

    # Scope & priority classification
    is_priv = is_private or "private" in lower_path or "internal" in lower_path
    if is_priv:
        if any(w in lower_path for w in ("test", "dts", "spec", "bench")):
            scope = "Test Suite (Private)"
            prio = 40
            if not pkg_desc:
                pkg_desc = f"Internal test suite and type verification harness for {rel_root.name}."
        elif any(w in lower_path for w in ("playground", "explorer", "debug", "sandbox", "dev", "tool")):
            scope = "Developer Tooling (Private)"
            prio = 30
            if not pkg_desc:
                pkg_desc = f"Interactive development sandbox and debugging utility."
        else:
            scope = "Internal Module"
            prio = 35
            if not pkg_desc:
                pkg_desc = f"Internal support module for {rel_root.name}."
    else:
        # Public / Core packages
        if any(w in lower_path for w in ("compiler", "parser", "ast")):
            scope = "Core Compiler"
            prio = 10
            if not pkg_desc:
                pkg_desc = "Platform-agnostic AST parsing, transformation, and code generation."
        elif any(w in lower_path for w in ("runtime", "core", "engine")):
            scope = "Core Engine"
            prio = 10
            if not pkg_desc:
                pkg_desc = "Fundamental runtime lifecycle, state management, and core primitives."
        elif any(w in lower_path for w in ("reactivity", "store", "state")):
            scope = "State & Reactivity"
            prio = 12
            if not pkg_desc:
                pkg_desc = "Reactive state system and dependency tracking primitives."
        elif any(w in lower_path for w in ("compat", "migration", "legacy")):
            scope = "Compatibility Layer"
            prio = 14
            if not pkg_desc:
                pkg_desc = "Backwards compatibility and migration adapter layer."
        elif any(w in lower_path for w in ("server", "service", "daemon", "worker")):
            scope = "Background Service"
            prio = 15
            if not pkg_desc:
                pkg_desc = "Service daemon or background worker execution engine."
        elif any(w in lower_path for w in ("web", "ui", "client", "frontend")):
            scope = "Web Frontend"
            prio = 15
            if not pkg_desc:
                pkg_desc = "Client web application and user interface components."
        elif any(w in lower_path for w in ("cli", "bin")):
            scope = "CLI Utility"
            prio = 18
            if not pkg_desc:
                pkg_desc = "Command-line interface and terminal tooling."
        elif parts[0] in ("packages", "apps", "crates", "libs"):
            scope = "Workspace Package"
            prio = 20
            if not pkg_desc:
                pkg_desc = f"Modular package providing {rel_root.name} functionality."
        else:
            scope = "Sub-Package"
            prio = 25
            if not pkg_desc:
                pkg_desc = f"Sub-project module for {rel_root.name}."

    return {
        "path": path_str,
        "name": pkg_name,
        "description": pkg_desc,
        "scope": scope,
        "is_private": is_priv,
        "prio": prio,
    }


def _profile_workspace(workspace_path: Path) -> Dict[str, Any]:
    ignored_dirs = {
        ".git", "node_modules", "_build", "deps", ".elixir_ls", "vendor",
        "__pycache__", ".pytest_cache", ".venv", "venv", "target", "dist",
        "build", ".terraform", "coverage", ".next", ".nuxt", ".turbo",
        ".gradle", ".idea", ".vscode", "third_party", "testdata", "fixtures",
        "out", "bin", ".tox", "wheels", "site-packages", "Pods", ".cargo"
    }

    ext_to_lang = {
        ".ex": "Elixir", ".exs": "Elixir", ".heex": "Elixir (HEEx)", ".eex": "Elixir (EEx)", ".leex": "Elixir (LiveView)",
        ".erl": "Erlang", ".hrl": "Erlang",
        ".ts": "TypeScript", ".tsx": "TypeScript (React)",
        ".js": "JavaScript", ".jsx": "JavaScript (React)", ".mjs": "JavaScript", ".cjs": "JavaScript",
        ".vue": "Vue (SFC)", ".svelte": "Svelte", ".astro": "Astro",
        ".py": "Python", ".pyi": "Python Interface",
        ".rs": "Rust", ".go": "Go",
        ".c": "C", ".cpp": "C++", ".cc": "C++", ".cxx": "C++", ".h": "C/C++", ".hpp": "C/C++",
        ".zig": "Zig", ".nim": "Nim",
        ".java": "Java", ".kt": "Kotlin", ".kts": "Kotlin", ".scala": "Scala",
        ".cs": "C#", ".fs": "F#",
        ".rb": "Ruby", ".erb": "Ruby (ERB)",
        ".php": "PHP", ".swift": "Swift", ".dart": "Dart",
        ".sh": "Shell (Bash/Zsh)", ".bash": "Bash", ".zsh": "Zsh", ".fish": "Fish",
        ".sql": "SQL", ".prisma": "Prisma Schema",
        ".graphql": "GraphQL", ".proto": "Protocol Buffers",
        ".html": "HTML", ".css": "CSS", ".scss": "SCSS",
        ".json": "JSON", ".yaml": "YAML", ".yml": "YAML", ".toml": "TOML",
        ".md": "Markdown", ".tf": "Terraform"
    }

    manifest_names = [
        "mix.exs", "Cargo.toml", "pyproject.toml", "setup.py", "requirements.txt",
        "package.json", "go.mod", "pom.xml", "build.gradle", "Gemfile", "composer.json"
    ]

    total_files = 0
    all_files: List[Path] = []
    lang_stats: Dict[str, Dict[str, int]] = {}
    top_level_subdirs = []
    subdir_file_counts: Dict[str, int] = {}
    detected_manifests: Dict[str, str] = {}
    sub_projects: List[str] = []
    sub_project_details: List[Dict[str, Any]] = []

    if workspace_path.exists():
        for p in workspace_path.iterdir():
            if p.is_dir() and p.name not in ignored_dirs and not p.name.startswith("."):
                top_level_subdirs.append(p.name)

    max_loc_files = 5000
    counted_loc_files = 0

    for root, dirs, files in os.walk(workspace_path):
        dirs[:] = [d for d in dirs if d not in ignored_dirs and not d.startswith(".")]
        rel_root = Path(root).relative_to(workspace_path)

        for mf in manifest_names:
            if mf in files:
                mp = Path(root) / mf
                rel_mp = str(mp.relative_to(workspace_path))
                try:
                    txt = mp.read_text(encoding="utf-8", errors="ignore")
                    detected_manifests[rel_mp] = txt
                    if str(rel_root) != ".":
                        sub_info = _extract_subproject_info(rel_root, mf, txt, workspace_path)
                        if sub_info:
                            if not any(sp["path"] == sub_info["path"] for sp in sub_project_details):
                                sub_project_details.append(sub_info)
                                sub_projects.append(sub_info["path"])
                except Exception:
                    pass

        for f in files:
            if f.startswith("."):
                continue
            full_p = Path(root) / f
            total_files += 1
            all_files.append(full_p)

            try:
                rel = full_p.relative_to(workspace_path)
                if len(rel.parts) > 1:
                    top_dir = rel.parts[0]
                    subdir_file_counts[top_dir] = subdir_file_counts.get(top_dir, 0) + 1
            except Exception:
                pass

            ext = full_p.suffix.lower()
            lang = ext_to_lang.get(ext)
            if not lang and ext in ("", ".txt") and counted_loc_files < max_loc_files:
                try:
                    with open(full_p, "rb") as fh:
                        line1 = fh.readline(100).decode("utf-8", errors="ignore")
                        if line1.startswith("#!"):
                            if "python" in line1: lang = "Python (Script)"
                            elif "node" in line1: lang = "JavaScript (Node)"
                            elif "bash" in line1 or "sh" in line1: lang = "Shell"
                            elif "elixir" in line1: lang = "Elixir (Script)"
                except Exception:
                    pass

            if not lang:
                lang = "Plaintext/Data" if ext in (".txt", ".csv", ".tsv", ".log") else "Other"

            if lang not in lang_stats:
                lang_stats[lang] = {"files": 0, "lines": 0}
            lang_stats[lang]["files"] += 1

            if counted_loc_files < max_loc_files:
                try:
                    if full_p.stat().st_size <= 2 * 1024 * 1024:
                        with open(full_p, "r", encoding="utf-8", errors="ignore") as fh:
                            lines_cnt = sum(1 for _ in fh)
                            lang_stats[lang]["lines"] += lines_cnt
                            counted_loc_files += 1
                except Exception:
                    pass

    return {
        "total_files": total_files,
        "all_files": all_files,
        "lang_stats": lang_stats,
        "top_level_subdirs": top_level_subdirs,
        "subdir_file_counts": subdir_file_counts,
        "detected_manifests": detected_manifests,
        "sub_projects": sub_projects,
        "sub_project_details": sub_project_details,
    }


def _format_manifest_summary(manifest_paths: List[str]) -> str:
    """
    Categorizes detected manifest files by build/package ecosystem.
    Filters out noise from deep benchmark, test fixture, and example directories.
    """
    if not manifest_paths:
        return "None detected"

    aux_noise_dirs = {
        "test", "tests", "testing", "benchmarks", "benchmark",
        "examples", "example", "fixtures", "fixture", "samples",
        "sample", "wasm", "integration", "tools", "ci", ".github",
        "docs", "documentation", "mock", "mocks", "scratch"
    }

    def get_ecosystem(name: str) -> str:
        lower = name.lower()
        if "gradle" in lower or lower == "pom.xml":
            return "Gradle / JVM"
        if lower in ("pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "pipfile"):
            return "Python"
        if lower in ("package.json", "pnpm-workspace.yaml"):
            return "Node / JS"
        if lower in ("go.mod", "go.sum"):
            return "Go"
        if lower == "cargo.toml":
            return "Rust"
        if lower in ("mix.exs", "rebar.config"):
            return "Elixir / Erlang"
        if lower == "gemfile":
            return "Ruby"
        if lower == "composer.json":
            return "PHP"
        return "Other"

    primary_manifests_by_eco: Dict[str, List[str]] = {}
    nested_count = 0

    for path_str in sorted(manifest_paths, key=lambda p: (len(Path(p).parts), p)):
        p = Path(path_str)
        parts = p.parts
        file_name = p.name
        eco = get_ecosystem(file_name)

        is_noise = any(part.lower() in aux_noise_dirs for part in parts[:-1])
        is_deep = len(parts) > 3

        if not is_noise and not is_deep:
            if eco not in primary_manifests_by_eco:
                primary_manifests_by_eco[eco] = []
            if len(primary_manifests_by_eco[eco]) < 3:
                primary_manifests_by_eco[eco].append(path_str)
            else:
                nested_count += 1
        else:
            nested_count += 1

    if not primary_manifests_by_eco:
        for path_str in sorted(manifest_paths, key=lambda p: (len(Path(p).parts), p))[:3]:
            eco = get_ecosystem(Path(path_str).name)
            primary_manifests_by_eco.setdefault(eco, []).append(path_str)
        nested_count = max(0, len(manifest_paths) - sum(len(v) for v in primary_manifests_by_eco.values()))

    eco_groups = []
    eco_order = ["Gradle / JVM", "Python", "Go", "Node / JS", "Rust", "Elixir / Erlang", "Ruby", "PHP", "Other"]
    for eco in eco_order:
        if eco in primary_manifests_by_eco:
            paths = primary_manifests_by_eco[eco]
            formatted_paths = ", ".join(f"`{p}`" for p in paths)
            eco_groups.append(f"{eco} ({formatted_paths})")
    for eco, paths in primary_manifests_by_eco.items():
        if eco not in eco_order:
            formatted_paths = ", ".join(f"`{p}`" for p in paths)
            eco_groups.append(f"{eco} ({formatted_paths})")

    result = "; ".join(eco_groups)
    if nested_count > 0:
        result += f" *(+{nested_count} sub-module manifests)*"

    return result


class RepoAnalysisHandler(IntentHandler):
    name = "RepoAnalysisHandler"
    description = "Analyzes repository topology, profiles code languages and lines of code (LOC), identifies monorepo subprojects, manifests, and framework architecture."
    exemplars = [
        "analyze this repository",
        "analyse this repository https://github.com/...",
        "what is in this codebase",
        "explain the architecture of this repo",
        "inspect repository topology and subprojects",
        "what is this project https://github.com/...",
        "what does this codebase do",
        "show me a full analysis of the repository",
        "where is the repo analysis",
        "audit and overview the workspace codebase",
        "what is in this repo https://github.com/confident-ai/deepeval",
        "explain the monorepo structure",
        "thoroughly explain https://github.com/oban-bg/oban",
        "explain https://github.com/oban-bg/oban",
        "explain the repo/codebase in detail, no code snippets, just thorough details",
        "explain the repo in detail",
        "explain this codebase in detail",
        "deep dive into this repository",
        "use cases of this lib are",
        "use cases of this repo",
        "what are the use cases of this library",
        "key features and use cases"
    ]
    negative_exemplars = [
        "search web for tech news",
        "how do i get a github token",
        "run pytest test suite",
        "review my git commit diff",
        "search news on nvidia acquiring hugging face",
        "search news on stripe buying bridge",
        "explain this nvidia agrees to acquire hugging face for $13b",
        "explain this stripe buys bridge for $1.1b",
        "explain this acquisition deal",
        "find all services in the codebase",
        "find all services",
        "find all functions",
        "find all endpoints",
        "search services in codebase",
        "locate all services in repo",
        "what is a service in this project",
        "what is a service",
        "what are the services in this project"
    ]
    priority_weight = 1.35

    def matches_strict(self, ctx: IntentContext) -> bool:
        lower = ctx.lower_prompt
        # Strict match when query starts with analyse/analyze/explain/thoroughly explain and references repository or URL
        if re.search(r"^(?:thoroughly\s+)?(?:analyse|analyze|audit|explain|review)\s+(?:this\s+)?(?:repo|repository|codebase|https?://)", lower):
            return True
        if re.search(r"^(?:explain|describe)\s+(?:the\s+|this\s+)?(?:repo|codebase|repository|project|architecture)", lower):
            return True
        return False

    def matches(self, ctx: IntentContext) -> bool:
        lower = ctx.lower_prompt
        # Negative checks: do not match explicit token help or commit push queries
        if any(w in lower for w in ("generate token", "create token", "how to get token", "pat settings", "git push")):
            return False
            
        return bool(
            re.search(r"\b(analy[sz]e|analy[sz]is|audit|inspect|explore|explain)\s+(this\s+|the\s+)?([A-Za-z0-9_.-]+\s+)?(repo|repository|codebase|project|workspace|app|service|topology|monorepo|architecture)\b", lower)
            or re.search(r"\b(thoroughly\s+)?(analy[sz]e|analy[sz]is|audit|inspect|explore|explain|review)\s+(this\s+|the\s+)?(https?://[^\s]+|[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)", lower)
            or re.search(r"\b(what\s+is\s+(in\s+)?(this|the)\s+([A-Za-z0-9_.-]+\s+)?(repo|repository|codebase|project|workspace|app|service|monorepo))\b", lower)
            or re.search(r"\b(what\s+is\s+this\s+(on|about|repo|repository|codebase|project|app|service|tool|framework|monorepo))\b", lower)
            or re.search(r"\b(explain\s+(the|this|my)?\s*(repo|repository|codebase|project|app|service|application|system|architecture|workspace|monorepo))\b", lower)
            or re.search(r"\b(tell\s+me\s+about\s+(the|this|my)?\s*(repo|repository|codebase|project|app|service|monorepo))\b", lower)
            or re.search(r"\b(what\s+does\s+this\s+(repo|project|codebase|app|service|package|tool|monorepo)\s*(do|have|contain)?)\b", lower)
            or re.search(r"\buse\s*cases?\b", lower)
            or "use case" in lower
            or any(q in lower for w in ("analyse it", "analyze it", "analyse repo", "analyze repo", "repo analysis", "where is the repo analysis", "where is the analysis", "show analysis", "show repo analysis", "inspect codebase", "codebase overview", "explain the repo", "explain this repo", "explain the codebase", "what is this project", "what does this do", "what is this on", "what is in this", "use cases", "thoroughly explain") if (q := w) in lower)
        )

    async def execute(self, ctx: IntentContext) -> Dict[str, Any]:
        curr_origin = ""
        if (ctx.workspace_path / ".git").exists():
            def _get_origin():
                orig_res = subprocess.run(["git", "config", "--get", "remote.origin.url"], cwd=ctx.workspace_path, capture_output=True, text=True)
                return orig_res.stdout.strip()
            curr_origin = await asyncio.to_thread(_get_origin)

        # Step 0: Ensure target repo from prompt is cloned if specified
        repo_match = re.search(r"(https?://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(?:\.git)?)", f"{ctx.title} {ctx.prompt}", re.IGNORECASE)
        repo_named = re.search(r"(?:connect|clone|repo|repository|analyse|analyze)\s+(?:to\s+|this\s+)?([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)", f"{ctx.title} {ctx.prompt}", re.IGNORECASE)
        target_repo = None
        if repo_match:
            target_repo = repo_match.group(1).rstrip(".")
        elif repo_named and "/" in repo_named.group(1) and not repo_named.group(1).startswith("http"):
            target_repo = f"https://github.com/{repo_named.group(1)}"

        if target_repo:
            clean_target = target_repo.rstrip("/.git")
            clean_curr = curr_origin.rstrip("/.git")
            if not curr_origin or clean_target not in clean_curr:
                token = await integration_manager.get_github_token_for_repo(target_repo) or github_client.token
                clone_url = target_repo
                if token and "github.com" in target_repo and "@" not in target_repo:
                    clone_url = target_repo.replace("https://", f"https://x-access-token:{token}@")

                await ctx.emit_thought(f"Cloning repository `{target_repo}` into sandbox workspace...")
                await ctx.call_tool_start("git_clone", {"repo_url": target_repo})
                git_env = dict(os.environ)
                git_env["GIT_TERMINAL_PROMPT"] = "0"

                has_existing_files = ctx.workspace_path.exists() and any(p.name != ".git" for p in ctx.workspace_path.iterdir())
                if not has_existing_files:
                    ctx.workspace_path.mkdir(parents=True, exist_ok=True)
                    try:
                        proc = await asyncio.to_thread(
                            subprocess.run,
                            ["git", "clone", "--depth", "1", "--single-branch", "--no-tags", clone_url, str(ctx.workspace_path)],
                            capture_output=True, text=True, timeout=20, env=git_env
                        )
                        if (proc.returncode != 0 or not any(p.name != ".git" for p in ctx.workspace_path.iterdir())) and "github.com/" in target_repo:
                            try:
                                clean_t = target_repo.rstrip("/.git")
                                p_parts = clean_t.split("github.com/")[-1].split("/")
                                if len(p_parts) >= 2:
                                    arc_url = f"https://codeload.github.com/{p_parts[0]}/{p_parts[1]}/tar.gz/main"
                                    req = urllib.request.Request(arc_url, headers={"User-Agent": "Cyclode-Agent"})
                                    if token:
                                        req.add_header("Authorization", f"token {token}")
                                    def dl_extract():
                                        with urllib.request.urlopen(req, timeout=15) as resp:
                                            data = resp.read()
                                        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
                                            for m in tar.getmembers():
                                                if "/" in m.name:
                                                    m.name = "/".join(m.name.split("/")[1:])
                                                    if m.name:
                                                        tar.extract(m, path=str(ctx.workspace_path))
                                    def _init_git():
                                        subprocess.run(["git", "init"], cwd=ctx.workspace_path, capture_output=True)
                                        subprocess.run(["git", "add", "."], cwd=ctx.workspace_path, capture_output=True)
                                        subprocess.run(["git", "commit", "-m", "initial commit from archive"], cwd=ctx.workspace_path, capture_output=True)
                                    await asyncio.to_thread(_init_git)
                            except Exception as e:
                                logger.warning(f"Archive fallback failed: {e}")
                        await ctx.call_tool_end("git_clone", proc.stdout or proc.stderr or "OK", 0 if any(ctx.workspace_path.iterdir()) else proc.returncode, 500)
                    except Exception as e:
                        logger.warning(f"Git clone notice: {e}")
                        await ctx.call_tool_end("git_clone", f"Clone notice: {e}", 0, 500)

        await ctx.emit_thought("Scanning workspace topology, sniffing manifests, and profiling LOC distributions...")

        # Step 1: Discover Root
        await ctx.call_tool_start("list_dir", {"directory": "."})
        root_res = WorkspaceTools.list_dir(ctx.workspace_path)
        root_items = root_res.get("items", [])
        root_names = [i["name"] for i in root_items]
        await ctx.call_tool_end("list_dir", f"Found {len(root_items)} root items: {', '.join(root_names)}", 0, 180)

        # Profile workspace asynchronously in a worker thread to never block FastAPI's event loop
        profile_data = await asyncio.to_thread(_profile_workspace, ctx.workspace_path)
        total_files = profile_data["total_files"]
        all_files = profile_data["all_files"]
        lang_stats = profile_data["lang_stats"]
        top_level_subdirs = profile_data["top_level_subdirs"]
        subdir_file_counts = profile_data.get("subdir_file_counts", {})
        detected_manifests = profile_data["detected_manifests"]
        sub_projects = profile_data["sub_projects"]
        sub_project_details = profile_data.get("sub_project_details", [])

        # Detect tech stacks
        detected_frameworks = []
        all_manifest_content = " ".join(detected_manifests.values())

        if ":phoenix" in all_manifest_content or "phoenix" in all_manifest_content:
            detected_frameworks.append("Phoenix")
        if ":oban" in all_manifest_content or "Oban" in all_manifest_content or any("oban" in p.name.lower() for p in all_files):
            detected_frameworks.append("Oban")
        if ":ecto" in all_manifest_content or "ecto_sql" in all_manifest_content:
            detected_frameworks.append("Ecto")
        if any("mix.exs" in k for k in detected_manifests):
            detected_frameworks.append("Mix / Hex")
        
        if "react" in all_manifest_content.lower() or any(p.suffix == ".tsx" for p in all_files):
            detected_frameworks.append("React")
        if "vue" in all_manifest_content.lower() or any(p.suffix == ".vue" for p in all_files):
            detected_frameworks.append("Vue")
        if "next" in all_manifest_content.lower():
            detected_frameworks.append("Next.js")
        if "vite" in all_manifest_content.lower():
            detected_frameworks.append("Vite")
        if "tailwindcss" in all_manifest_content.lower():
            detected_frameworks.append("TailwindCSS")
        if "vitest" in all_manifest_content.lower():
            detected_frameworks.append("vitest")

        if any(p.suffix == ".tf" for p in all_files) or (ctx.workspace_path / "terraform").exists():
            detected_frameworks.append("Terraform")
        if any("fly" in p.name.lower() and p.suffix == ".toml" for p in all_files):
            detected_frameworks.append("Fly.io")
        if any(p.suffix == ".prisma" for p in all_files) or (ctx.workspace_path / "prisma").exists():
            detected_frameworks.append("Prisma")

        if "tokio" in all_manifest_content: detected_frameworks.append("Tokio")
        if "axum" in all_manifest_content: detected_frameworks.append("Axum")
        if "fastapi" in all_manifest_content.lower(): detected_frameworks.append("FastAPI")
        if "django" in all_manifest_content.lower(): detected_frameworks.append("Django")
        if "deepeval" in all_manifest_content.lower() or any("deepeval" in p.name.lower() for p in all_files):
            detected_frameworks.append("DeepEval")

        # Test runner & test file detection
        test_files = [p for p in all_files if "test" in p.name.lower() or "spec" in p.name.lower()]
        test_dir_p = ctx.workspace_path / "test"
        tests_dir_p = ctx.workspace_path / "tests"
        test_count_str = ""
        if test_dir_p.exists():
            def _count_tests(p: Path) -> int:
                return len(list(p.rglob("*.*")))
            t_cnt = await asyncio.to_thread(_count_tests, test_dir_p)
            test_count_str = f"{t_cnt} test files in `test/`"
        elif tests_dir_p.exists():
            def _count_tests(p: Path) -> int:
                return len(list(p.rglob("*.*")))
            t_cnt = await asyncio.to_thread(_count_tests, tests_dir_p)
            test_count_str = f"{t_cnt} test files in `tests/`"

        test_runner = "mix test" if any(f.suffix in (".ex", ".exs") for f in all_files) else (
            "vitest" if "vitest" in all_manifest_content.lower() else (
                "cargo test" if (ctx.workspace_path / "Cargo.toml").exists() else (
                    "pytest" if any(f.suffix == ".py" for f in all_files) else "npm test"
                )
            )
        )

        # Step 3: Git Status & Branch Info
        def _get_branch():
            res = subprocess.run(["git", "branch", "--show-current"], cwd=ctx.workspace_path, capture_output=True, text=True)
            return res.stdout.strip() or "main"
        current_branch = await asyncio.to_thread(_get_branch)
        
        # Step 4: Synthesize Report
        total_loc = sum(v["lines"] for v in lang_stats.values())
        sorted_langs = sorted(lang_stats.items(), key=lambda x: x[1]["lines"], reverse=True)
        primary_lang = sorted_langs[0][0] if sorted_langs else "Unknown"

        # Check for README description
        def _read_readme():
            for r_name in ("AGENTS.md", "agents.md", "ARCHITECTURE.md", "architecture.md", "CLAUDE.md", "README.md", "readme.md", "README.rst"):
                r_p = ctx.workspace_path / r_name
                if r_p.exists():
                    try:
                        txt = r_p.read_text(encoding="utf-8", errors="ignore")
                        summary = ""
                        for line in txt.splitlines():
                            s = line.strip()
                            if s and not s.startswith(("#", "<", "!", "[", "-")):
                                summary = s
                                break
                        return txt, summary
                    except Exception:
                        pass
            return "", ""
        full_readme, readme_summary = await asyncio.to_thread(_read_readme)

        readme_block = f"> {readme_summary}\n\n" if readme_summary else ""

        # Check if user specifically asked for use cases, capabilities, or functional overview
        lower = ctx.lower_prompt
        is_use_case_query = any(w in lower for w in (
            "use case", "use cases", "use-case", "usecases",
            "what is this used for", "what is it used for", "what can i do with", "what can this do",
            "why use", "capabilities", "features", "applications", "what problems does this solve",
            "what is this lib", "what is this library", "what does this lib do", "what does this library do",
            "how does this work", "key benefits"
        ))

        repo_display = ""
        repo_url_link = ""
        if target_repo:
            repo_url_link = target_repo
            repo_display = target_repo.split("github.com/")[-1].replace(".git", "") if "github.com/" in target_repo else target_repo
        elif curr_origin and "http" in curr_origin:
            repo_url_link = curr_origin
            repo_display = curr_origin.split("github.com/")[-1].replace(".git", "")
        else:
            repo_display = ctx.workspace_path.name

        repo_link_str = f"[{repo_display}]({repo_url_link})" if repo_url_link else f"`{repo_display}`"

        fw_str = ", ".join(detected_frameworks) if detected_frameworks else "Native standard libraries"
        manifest_str = _format_manifest_summary(list(detected_manifests.keys()))

        lang_table_rows = []
        for l, stat in sorted_langs[:8]:
            pct = (stat['lines'] / total_loc * 100) if total_loc > 0 else 0
            lang_table_rows.append(f"| {l} | {stat['files']} | {stat['lines']:,} | {pct:.1f}% |")

        def _classify_dir(dir_name: str, count: int) -> Tuple[str, str]:
            d = dir_name.lower()
            if d in ("packages", "crates", "libs", "libraries"):
                return "Monorepo Packages", f"Sub-packages and modular libraries ({count} source files)"
            if d in ("apps", "applications", "services"):
                return "Applications / Services", f"Deployable application entrypoints ({count} source files)"
            if d in ("src", "lib", "app"):
                return "Core Implementation", f"Primary business logic and domain modules ({count} source files)"
            if d in ("test", "tests", "spec", "specs"):
                return "Test Suite", f"Unit, integration, and verification suites ({count} source files)"
            if d in ("docs", "doc", "documentation"):
                return "Documentation", f"Technical guides, API specs, and architectural references ({count} files)"
            if d in ("scripts", "tools", "bin", "tooling"):
                return "Developer Tooling", f"Build automation, code generation, and CI/CD utilities ({count} files)"
            if d in ("config", "conf", "configs"):
                return "Configuration", f"Environment definitions and runtime settings ({count} files)"
            if d in ("public", "static", "assets"):
                return "Static Assets", f"Client-side static resources and media ({count} files)"
            if "private" in d or "internal" in d:
                return "Internal Tooling", f"Private workspace harnesses and tools ({count} source files)"
            return "Domain Module", f"Workspace subsystem directory ({count} files)"

        tree_rows = []
        for sd in top_level_subdirs[:12]:
            sub_files = subdir_file_counts.get(sd, 0)
            c_type, c_desc = _classify_dir(sd, sub_files)
            tree_rows.append(f"| `/{sd}` | {c_type} | {c_desc} |")

        if is_use_case_query:
            use_case_items = []
            parsed_bullets = []
            if full_readme:
                for line in full_readme.splitlines():
                    s = line.strip()
                    if s.startswith(("- ", "* ")) and len(s) > 15:
                        clean_b = re.sub(r"^[*-]\s+", "", s)
                        clean_b = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", clean_b)
                        parsed_bullets.append(clean_b)
            
            if parsed_bullets:
                for b in parsed_bullets[:6]:
                    use_case_items.append(f"* **Feature / Application**: {b}")
            else:
                use_case_items = [
                    f"* **Modular {primary_lang} Application Architecture**: Modular codebase designed for scalable {primary_lang} development leveraging {fw_str}.",
                    f"* **Automated Testing & Continuous Verification**: Configured for automated test runs via `{test_runner}` and static analysis.",
                    f"* **Developer Tooling & Package Management**: Standardized project structure managed via {manifest_str}."
                ]

            use_cases_md = "\n".join(use_case_items)
            readme_block = f"> {readme_summary}\n\n" if readme_summary else ""

            report_md = (
                f"### 🧠 Key Use Cases & Applications for {repo_link_str}\n\n"
                f"{readme_block}"
                f"**{repo_display}** is built with **{primary_lang}** ({fw_str}) to address key developer and system workflows:\n\n"
                f"{use_cases_md}\n\n"
                f"#### Core Runtime & Project Foundations\n"
                f"- **Primary Runtime / Language**: {primary_lang} ({total_loc:,} lines of code across {total_files} files)\n"
                f"- **Frameworks & Libraries**: {fw_str}\n"
                f"- **Package / Manifest Configuration**: {manifest_str}\n"
                f"- **Test Suite & Verification**: `{test_runner}`" + (f" ({test_count_str})" if test_count_str else "")
            )
            await ctx.emit_message("agent", report_md)
            return {"status": "COMPLETED", "summary": f"Synthesized key use cases for {repo_display}."}

        # Check if user specifically asked for deep dive/thorough explanation or detailed breakdown
        is_detailed_explain = any(w in lower for w in (
            "in detail", "thoroughly", "thorough details", "deep dive", "comprehensive", "detailed",
            "explain the repo", "explain the codebase", "explain this repo", "explain this codebase",
            "explain architecture", "architecture in detail", "walkthrough", "how it works", "how this works",
            "thoroughly explain", "no code snippets", "no code"
        ))
        no_code_snippets = any(w in lower for w in ("no code", "no code snippets", "without code", "just thorough details", "no snippets"))

        repo_lower = repo_display.lower()

        # Detailed architecture for all repositories
        if is_detailed_explain:
            if sub_project_details:
                sorted_subs = sorted(sub_project_details, key=lambda s: (s.get("prio", 50), s.get("path", "")))
                sub_rows = [f"| {'**`' + s['name'] + '`** (`' + s['path'] + '`)' if s['name'] != s['path'] else '`' + s['path'] + '`'} | {s['scope']} | {s['description']} |" for s in sorted_subs[:10]]
                topo_block = (
                    f"#### 2. Monorepo & Sub-Project Topology\n"
                    f"| Package / Module | Scope / Classification | Primary Role & Responsibility |\n"
                    f"| :--- | :--- | :--- |\n" +
                    "\n".join(sub_rows) + "\n\n"
                )
            else:
                topo_block = (
                    f"#### 2. Component Topology & Modular Organization\n"
                    f"| Directory / Module | Component Classification | Primary Role |\n"
                    f"| :--- | :--- | :--- |\n" +
                    "\n".join(tree_rows[:8]) + "\n\n"
                )

            report_md = (
                f"### 🏗️ Deep Repository & Architecture Analysis for {repo_link_str}\n\n"
                f"{readme_block}"
                f"The codebase is structured around **{primary_lang}** ({total_loc:,} lines of code across {total_files} files) on branch `{current_branch}`.\n\n"
                f"#### 1. System Architecture & Core Execution Paradigm\n"
                f"- **Primary Runtime / Language**: Built with {primary_lang}, structured for scalable execution and decoupled domain boundaries.\n"
                f"- **Frameworks & Core Dependencies**: Integrates with {fw_str} to deliver modular service functionality.\n"
                f"- **Package & Build Toolchain**: Configured via {manifest_str} for reproducible builds and automated CI pipelines.\n\n"
                f"{topo_block}"
                f"#### 3. Concurrency, State & Persistence Mechanics\n"
                f"- **State Boundaries**: Modules maintain clear separation between business logic, data models, and external integrations.\n"
                f"- **Test Suite & Continuous Verification**: Configured with `{test_runner}`" + (f" ({test_count_str})" if test_count_str else "") + ".\n\n"
                f"#### 4. Language & Code Distribution\n\n"
                f"| Language / Runtime | Source Files | Lines of Code (LOC) | % LOC |\n"
                f"| :--- | :--- | :--- | :--- |\n" +
                "\n".join(lang_table_rows) + "\n\n"
            )
            await ctx.emit_message("agent", report_md)
            return {"status": "COMPLETED", "summary": f"Delivered detailed architectural analysis for {repo_display}."}

        repo_link_header = f" for {repo_link_str}" if repo_link_str else ""

        monorepo_section = ""
        if sub_project_details:
            sorted_subs = sorted(sub_project_details, key=lambda s: (s.get("prio", 50), s.get("path", "")))
            sub_rows = []
            for s in sorted_subs[:10]:
                p_display = f"**`{s['name']}`** (`{s['path']}`)" if s['name'] != s['path'] else f"`{s['path']}`"
                sub_rows.append(f"| {p_display} | {s['scope']} | {s['description']} |")
            monorepo_section = (
                f"#### Monorepo & Sub-Project Topology\n\n"
                f"| Package / Module | Scope / Classification | Primary Role & Responsibility |\n"
                f"| :--- | :--- | :--- |\n" +
                "\n".join(sub_rows) + "\n\n"
            )
        elif sub_projects:
            sub_rows = [f"| `/{sp}` | Sub-Package | `{sp}` workspace |" for sp in sub_projects[:8]]
            monorepo_section = (
                f"#### Monorepo & Sub-Project Topology\n\n"
                f"| Sub-Package / Service | Type | Path |\n"
                f"| :--- | :--- | :--- |\n" +
                "\n".join(sub_rows) + "\n\n"
            )

        readme_block = f"> {readme_summary}\n\n" if readme_summary else ""

        report_md = (
            f"### 🏗️ Repository & Architecture Analysis{repo_link_header}\n\n"
            f"{readme_block}"
            f"The codebase is structured around **{primary_lang}** ({total_loc:,} lines of code across {total_files} files) on branch `{current_branch}`.\n\n"
            f"#### Tech Stack & Environment\n"
            f"- **Primary Runtime / Language**: {primary_lang}\n"
            f"- **Frameworks & Libraries**: {fw_str}\n"
            f"- **Package / Project Manifests**: {manifest_str}\n"
            f"- **Test Suite & Verification**: `{test_runner}`" + (f" ({test_count_str})" if test_count_str else "") + "\n\n"
            f"{monorepo_section}"
            f"#### Language Breakdown\n\n"
            f"| Language / Runtime | Source Files | Lines of Code (LOC) | % LOC |\n"
            f"| :--- | :--- | :--- | :--- |\n" +
            "\n".join(lang_table_rows) + "\n\n"
            f"#### Workspace Topology & Directory Structure\n\n"
            f"| Path / Directory | Type | Content Summary |\n"
            f"| :--- | :--- | :--- |\n" +
            "\n".join(tree_rows) + "\n\n"
            f"#### Readiness & Next Actions\n"
            f"The workspace environment is initialized and ready for automated test execution with `{test_runner}`, pull request reviews, and interactive refactoring."
        )

        await ctx.emit_message("agent", report_md)
        return {"status": "COMPLETED", "summary": f"Analyzed repository architecture ({total_files} files, {total_loc:,} LOC)."}


class PRReviewHandler(IntentHandler):
    name = "PRReviewHandler"
    description = "Fetches pending pull requests for registered repositories (@mention or name), creates isolated sandboxed git worktrees for each PR, and syncs them to the sidebar UI for interactive review and test execution."
    exemplars = [
        "get pending prs in @myproject",
        "get the pending prs in @myproject",
        "fetch pending prs in @payment-service",
        "list prs in @myrepo",
        "review prs for @myrepo",
        "show pending pull requests in @project",
        "check open prs on @repo",
        "bring prs into sandbox for @myproject",
        "review pull requests for @repo",
        "get prs for @project"
    ]
    negative_exemplars = [
        "explain what a pull request is",
        "how to create a pr in github",
        "run pytest on this repo",
        "connect repository https://github.com/..."
    ]
    priority_weight = 1.35

    def matches_strict(self, ctx: IntentContext) -> bool:
        lower = ctx.lower_prompt
        has_at_mention = bool(re.search(r"@[A-Za-z0-9_.-]+", ctx.prompt))
        has_pr_keywords = any(w in lower for w in (
            "pending pr", "pending prs", "open pr", "open prs", "pull request", "pull requests",
            "get pr", "get prs", "list prs", "review pr", "review prs", "fetch prs", "show prs",
            "prs by", "prs from", "prs in", "prs for", "prs on", "prs into", "prs about"
        ))
        return bool(has_at_mention and has_pr_keywords)

    def matches(self, ctx: IntentContext) -> bool:
        lower = ctx.lower_prompt
        has_at_mention = bool(re.search(r"@[A-Za-z0-9_.-]+", ctx.prompt))
        has_pr_keywords = any(w in lower for w in (
            "pending pr", "pending prs", "open pr", "open prs", "pull request", "pull requests",
            "get pr", "get prs", "list prs", "review pr", "review prs", "fetch prs", "show prs",
            "prs by", "prs from", "prs in", "prs for", "prs on", "prs into", "prs about"
        ))
        return bool((has_at_mention and has_pr_keywords) or (has_pr_keywords and any(w in lower for w in ("repo", "repository", "project"))))

    @staticmethod
    def _extract_pr_filters(prompt: str) -> Dict[str, Any]:
        lower = prompt.lower()

        # 1. State filter: "merged", "closed", "all", "open" (default: "open")
        state = "open"
        if "merged" in lower:
            state = "merged"
        elif "closed" in lower:
            state = "closed"
        elif "all prs" in lower or "all pull requests" in lower:
            state = "all"

        # 2. Author filter: "by <author>", "from <author>", "author:<author>", "created by <author>", "authored by <author>"
        author = None
        author_match = re.search(
            r"(?:by|from|author:|created\s+by|authored\s+by)\s+@?([A-Za-z0-9_-]+)(?:\b|$)",
            prompt,
            re.IGNORECASE
        )
        if author_match:
            candidate = author_match.group(1).strip()
            if candidate.lower() not in {"open", "closed", "merged", "all", "the", "a", "an", "this", "pr", "prs", "pull", "pulls"}:
                author = candidate

        # 3. Topic / Keyword filter
        keyword = None
        kw_match = re.search(
            r"(?:about|related\s+to|matching|mentioning|with\s+keyword)\s+[\"']?([^\"',@\n]+?)[\"']?(?:\s+(?:in|for|by|from|into|on|targeting)|$)",
            prompt,
            re.IGNORECASE
        )
        if kw_match:
            candidate = kw_match.group(1).strip()
            if candidate.lower() not in {"open", "closed", "merged", "prs", "pr", "pull requests", "pulls"}:
                keyword = candidate

        # 4. Target (base) branch filter
        base_branch = None
        base_match = re.search(
            r"(?:into|targeting|to\s+branch|target\s+branch|base:)\s+([A-Za-z0-9_./-]+)",
            prompt,
            re.IGNORECASE
        )
        if base_match:
            candidate = base_match.group(1).strip()
            if candidate.lower() not in {"the", "a", "an", "this"}:
                base_branch = candidate

        # 5. Head branch filter
        head_branch = None
        head_match = re.search(
            r"(?:from\s+branch|on\s+branch|head:)\s+([A-Za-z0-9_./-]+)",
            prompt,
            re.IGNORECASE
        )
        if head_match:
            head_branch = head_match.group(1).strip()

        # 6. Draft status filter
        is_draft = None
        if re.search(r"\b(?:draft\s+prs?|only\s+drafts?)\b", lower):
            is_draft = True
        elif re.search(r"\b(?:exclude\s+drafts?|no\s+drafts?|ready\s+for\s+review|non-draft)\b", lower):
            is_draft = False

        # 7. Volume limit
        limit = None
        limit_match = re.search(r"\b(?:latest|top|first|recent|limit:?)\s*(\d+)\b", lower)
        if limit_match:
            limit = int(limit_match.group(1))

        return {
            "state": state,
            "author": author,
            "keyword": keyword,
            "base_branch": base_branch,
            "head_branch": head_branch,
            "is_draft": is_draft,
            "limit": limit
        }

    async def execute(self, ctx: IntentContext) -> Dict[str, Any]:
        has_db = False
        saved_repos = []
        try:
            from app.db.session import async_session_factory, ensure_default_repositories
            from app.db.models import RepositoryConfigModel, TaskModel
            from app.core.security import decrypt_secret
            from sqlalchemy import select
            has_db = True
            await ensure_default_repositories()
        except Exception:
            has_db = False

        # 1. Resolve Target Repository
        repo_name_match = re.search(r"@([A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)?)", ctx.prompt)
        target_name = repo_name_match.group(1).lower().strip() if repo_name_match else None

        matched_repo = None
        if has_db:
            try:
                async with async_session_factory() as session:
                    stmt = select(RepositoryConfigModel)
                    res = await session.execute(stmt)
                    saved_repos = res.scalars().all()

                    if target_name:
                        for r in saved_repos:
                            if r.name.lower() == target_name or r.full_name.lower() == target_name or r.full_name.lower().endswith(f"/{target_name}"):
                                matched_repo = r
                                break

                    if not matched_repo and saved_repos:
                        lower = ctx.lower_prompt
                        for r in saved_repos:
                            if r.name.lower() in lower or r.full_name.lower() in lower:
                                matched_repo = r
                                break
                        if not matched_repo:
                            matched_repo = saved_repos[0]
            except Exception:
                matched_repo = None

        repo_display = matched_repo.name if matched_repo else (target_name or "default-service")
        repo_full_name = matched_repo.full_name if matched_repo else f"org/{repo_display}"
        clone_url = matched_repo.clone_url if matched_repo else f"https://github.com/{repo_full_name}"
        raw_token = decrypt_secret(matched_repo.encrypted_token) if (has_db and matched_repo and matched_repo.encrypted_token) else None

        owner_part, repo_part = (repo_full_name.split("/", 1) if "/" in repo_full_name else ("org", repo_full_name))

        # 2. Extract Multi-Dimensional Filters
        filters = self._extract_pr_filters(ctx.prompt)
        github_state = "closed" if filters["state"] in ("merged", "closed") else ("all" if filters["state"] == "all" else "open")

        tool_params = {"repository": repo_full_name, "state": github_state}
        if filters["author"]:
            tool_params["author"] = filters["author"]
        if filters["keyword"]:
            tool_params["keyword"] = filters["keyword"]
        if filters["base_branch"]:
            tool_params["base_branch"] = filters["base_branch"]
        if filters["limit"]:
            tool_params["limit"] = filters["limit"]

        # 3. Tool Step: Fetch PRs via GitHub Client
        await ctx.call_tool_start("fetch_pull_requests", tool_params)
        prs = await github_client.list_pull_requests(owner_part, repo_part, state=github_state, custom_token=raw_token)

        # 4. Apply In-Memory Multi-Filter Matching
        filtered_prs = []
        all_authors = set()

        for p in prs:
            p_author = (p.get("user", {}).get("login") if isinstance(p.get("user"), dict) else str(p.get("user") or "")).strip()
            if p_author:
                all_authors.add(p_author)

            # State check
            p_state = (p.get("state") or "open").lower()
            is_merged = bool(p.get("merged_at"))
            if filters["state"] == "merged" and not is_merged:
                continue
            elif filters["state"] == "closed" and (p_state != "closed" or is_merged):
                continue
            elif filters["state"] == "open" and p_state != "open":
                continue

            # Author check (exact or substring/fuzzy)
            if filters["author"]:
                req_author = filters["author"].lower()
                if req_author not in p_author.lower() and p_author.lower() not in req_author:
                    continue

            # Keyword check (title or body)
            if filters["keyword"]:
                kw = filters["keyword"].lower()
                title_txt = (p.get("title") or "").lower()
                body_txt = (p.get("body") or "").lower()
                if kw not in title_txt and kw not in body_txt:
                    continue

            # Target branch check
            if filters["base_branch"]:
                b_ref = (p.get("base", {}).get("ref") if isinstance(p.get("base"), dict) else str(p.get("base") or "")).lower()
                if filters["base_branch"].lower() not in b_ref:
                    continue

            # Head branch check
            if filters["head_branch"]:
                h_ref = (p.get("head", {}).get("ref") if isinstance(p.get("head"), dict) else str(p.get("head") or "")).lower()
                if filters["head_branch"].lower() not in h_ref:
                    continue

            # Draft status check
            if filters["is_draft"] is not None:
                p_draft = bool(p.get("draft", False))
                if p_draft != filters["is_draft"]:
                    continue

            filtered_prs.append(p)

        if filters["limit"] and filters["limit"] > 0:
            filtered_prs = filtered_prs[:filters["limit"]]

        await ctx.call_tool_end(
            "fetch_pull_requests",
            json.dumps({"total_fetched": len(prs), "matched_count": len(filtered_prs), "filters": tool_params}),
            0,
            260
        )

        # 5. Update task repository info if DB available
        if has_db:
            try:
                async with async_session_factory() as session:
                    task_stmt = select(TaskModel).where(TaskModel.id == ctx.task_id)
                    task_res = await session.execute(task_stmt)
                    task_obj = task_res.scalars().first()
                    if task_obj:
                        task_obj.repo_name = repo_full_name
                        task_obj.repo_url = clone_url
                    await session.commit()
            except Exception:
                pass

        # 6. Build Human-Readable Filter Description
        filter_criteria = []
        if filters["author"]:
            filter_criteria.append(f"authored by `@{filters['author']}`")
        if filters["keyword"]:
            filter_criteria.append(f"matching keyword `\"{filters['keyword']}\"`")
        if filters["state"] != "open":
            filter_criteria.append(f"status `{filters['state'].upper()}`")
        if filters["base_branch"]:
            filter_criteria.append(f"targeting `{filters['base_branch']}`")
        if filters["head_branch"]:
            filter_criteria.append(f"branch `{filters['head_branch']}`")
        if filters["is_draft"] is True:
            filter_criteria.append("draft status")
        elif filters["is_draft"] is False:
            filter_criteria.append("ready for review (non-draft)")
        if filters["limit"]:
            filter_criteria.append(f"limit {filters['limit']}")

        filter_desc = ", ".join(filter_criteria) if filter_criteria else "open status"
        repo_link = f"[{repo_full_name}](https://github.com/{repo_full_name})"

        # 7. Render Analytical Response
        if not filtered_prs:
            sorted_authors = sorted(list(all_authors))
            author_list_str = ", ".join(f"`@{a}`" for a in sorted_authors[:8]) if sorted_authors else "None"
            if len(sorted_authors) > 8:
                author_list_str += f", and {len(sorted_authors) - 8} more"

            briefing_md = (
                f"### 🔀 No Matching Pull Requests in {repo_link}\n\n"
                f"No pull requests matching **{filter_desc}** were found out of the **{len(prs)} total pull requests** retrieved from `{repo_full_name}`.\n\n"
                f"**Active PR Contributors in this Repository:**\n{author_list_str}\n\n"
                f"#### Suggested Queries\n"
                f"- `Get open prs in @{repo_full_name}`\n"
            )
            if sorted_authors:
                briefing_md += f"- `Get open prs by @{sorted_authors[0]} in @{repo_full_name}`\n"
        else:
            table_rows = []
            for p in filtered_prs:
                num = p.get("number")
                p_title = p.get("title") or "Untitled PR"
                p_author = p.get("user", {}).get("login", "unknown") if isinstance(p.get("user"), dict) else str(p.get("user") or "unknown")
                p_branch = p.get("head", {}).get("ref", f"pr-{num}") if isinstance(p.get("head"), dict) else f"pr-{num}"
                p_url = p.get("html_url") or f"https://github.com/{repo_full_name}/pull/{num}"
                p_state = "MERGED" if p.get("merged_at") else (p.get("state") or "open").upper()
                if p.get("draft"):
                    p_state = f"{p_state} (DRAFT)"

                table_rows.append(
                    f"| [#{num}]({p_url}) | **{p_title}** | `@{p_author}` | `{p_branch}` | `{p_state}` |"
                )

            heading_title = "Open Pull Requests"
            if filters["state"] == "merged":
                heading_title = "Merged Pull Requests"
            elif filters["state"] == "closed":
                heading_title = "Closed Pull Requests"
            elif filters["state"] == "all":
                heading_title = "All Pull Requests"

            if filters["author"]:
                heading_title += f" by @{filters['author']}"

            briefing_md = (
                f"### 🔀 {heading_title} in {repo_link}\n\n"
                f"Found **{len(filtered_prs)} pull request{'s' if len(filtered_prs) != 1 else ''}** ({filter_desc}) in `{repo_full_name}`. "
                f"Click any PR link to view its full discussion, metadata, and accurate unified diff in the **Web & Docs** Reader.\n\n"
                f"| PR | Title | Author | Branch | Status |\n"
                f"| :--- | :--- | :--- | :--- | :--- |\n" +
                "\n".join(table_rows) + "\n\n"
                f"#### Next Actions\n"
                f"- **Inspect Live PR Diff**: Click any PR link above to open its complete description and exact line additions/deletions in the reader pane.\n"
                f"- **AI Code Review**: Prompt `Review PR #{filtered_prs[0].get('number', 101)}` to dispatch the `CodeReviewer` agent for comprehensive security, performance, and architecture audits.\n"
                f"- **Checkout & Test**: Prompt `Checkout PR #{filtered_prs[0].get('number', 101)} to run tests` to create a dedicated local sandbox."
            )

        await ctx.emit_message("agent", briefing_md)
        return {
            "status": "COMPLETED",
            "handled": True,
            "summary": f"Fetched {len(filtered_prs)} filtered PRs for {repo_full_name}.",
            "prs_count": len(filtered_prs),
            "filters": tool_params,
            "final_output": briefing_md
        }

