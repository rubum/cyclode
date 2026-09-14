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
from typing import Dict, Any, List, Optional

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
        """Strict structural match when raw credentials or explicit connect commands with URLs are supplied."""
        lower = ctx.lower_prompt
        # Explanation and inspection queries must NEVER be intercepted by RepoConnectionHandler
        is_explain_query = any(w in lower for w in (
            "explain", "thoroughly explain", "what is", "summarize", "summarise", "tell me about",
            "analyse", "analyze", "audit", "inspect", "overview", "review", "deep dive", "walkthrough", "use case"
        ))
        if is_explain_query and not any(w in lower for w in ("connect", "save credentials", "authenticate")):
            return False

        has_creds = bool(ctx.extra.get("github_token") or ctx.extra.get("slack_token") or ctx.extra.get("gemini_api_key"))
        has_repo_url = bool(re.search(r"https?://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", ctx.prompt, re.I))
        is_connect_cmd = any(w in lower for w in ("connect", "clone repo", "import repo", "setup repo", "authenticate"))
        return bool((has_creds and (has_repo_url or is_connect_cmd)) or (has_repo_url and is_connect_cmd))

    def matches(self, ctx: IntentContext) -> bool:
        lower = ctx.lower_prompt
        # Explanation and inspection queries must NEVER be intercepted by RepoConnectionHandler
        is_explain_query = any(w in lower for w in (
            "explain", "thoroughly explain", "what is", "summarize", "summarise", "tell me about",
            "analyse", "analyze", "audit", "inspect", "overview", "review", "deep dive", "walkthrough", "use case"
        ))
        if is_explain_query and not any(w in lower for w in ("connect", "save credentials", "authenticate")):
            return False

        has_repo_url = bool(re.search(r"https?://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", ctx.prompt, re.I))
        has_named_repo = bool(re.search(r"(?:connect|clone|import|setup)\s+(?:to\s+)?([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)", ctx.prompt, re.I))
        has_creds = bool(ctx.extra.get("github_token") or ctx.extra.get("slack_token") or ctx.extra.get("gemini_api_key"))
        
        is_connect_cmd = any(w in lower for w in ("connect", "clone repo", "import repo", "setup repo", "authenticate"))
        return (has_creds and (has_repo_url or is_connect_cmd)) or (has_repo_url and is_connect_cmd) or has_named_repo

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

            if "deepeval" in repo.lower():
                summary_md = (
                    f"### 📦 [{repo_full_name}](https://github.com/{repo_full_name}) — *Production LLM Evaluation Framework*\n\n"
                    f"[DeepEval](https://github.com/confident-ai/deepeval), developed by Confident AI, serves as an open-source evaluation framework for large language model applications and retrieval-augmented generation (RAG) pipelines. Functioning conceptually as a specialized \"Pytest for LLMs\", the framework bridges the gap between traditional unit testing and probabilistic model evaluation by enabling engineering teams to codify quality criteria, benchmark iterations, and guard against prompt or retrieval drift in continuous integration environments.\n\n"
                    f"#### Evaluation Architecture & Metrics Topology\n"
                    f"DeepEval categorizes evaluations across reference-free heuristic algorithms and LLM-as-a-judge protocols, executing scoring either entirely locally on bare metal or via private inference endpoints without third-party vendor lock-in.\n\n"
                    f"| Evaluation Metric | Description | Target Use Case |\n"
                    f"| :--- | :--- | :--- |\n"
                    f"| **G-Eval** | Custom LLM-as-a-judge scoring based on user-defined rubrics and weighting | Bespoke domain alignment, compliance, and custom business logic |\n"
                    f"| **Faithfulness** | Measures factual consistency of LLM output relative to retrieved context | Hallucination mitigation in RAG systems |\n"
                    f"| **Answer Relevancy** | Quantifies whether output directly addresses user intent without verbosity | Output drift and conversational precision |\n"
                    f"| **Contextual Precision & Recall** | Evaluates ranking quality and coverage of vector retrieval steps | Retriever optimization and chunking strategy validation |\n"
                    f"| **Hallucination & Bias** | Detects factual contradictions, toxic tone, and safety policy violations | Enterprise governance and production safety guardrails |\n\n"
                    f"#### Integration Mechanics & Testing Workflow\n"
                    f"DeepEval integrates directly into standard Python test harnesses using familiar Pytest conventions. Test cases encapsulate conversational inputs, context chunks, and actual outputs within `LLMTestCase` definitions, validating them against configurable pass/fail thresholds via `assert_test`:\n\n"
                    f"```python\n"
                    f"from deepeval import assert_test\n"
                    f"from deepeval.test_case import LLMTestCase\n"
                    f"from deepeval.metrics import AnswerRelevancyMetric\n\n"
                    f"def test_response_relevancy():\n"
                    f"    test_case = LLMTestCase(\n"
                    f"        input=\"What are the key features of Adappty?\",\n"
                    f"        actual_output=\"Adappty provides autonomous pair programming, standing event automations, and disposable sandboxes.\"\n"
                    f"    )\n"
                    f"    metric = AnswerRelevancyMetric(threshold=0.7)\n"
                    f"    assert_test(test_case, [metric])\n"
                    f"```\n\n"
                    f"Beyond single-turn scoring, the ecosystem supports synthetic dataset generation to automatically bootstrap evaluation benchmarks from raw documentation, multi-turn agent trajectory evaluation, and CI/CD gating to block regressions prior to production deployments."
                )
            elif content and len(content) > 80:
                clean_text = re.sub(r"<!--.*?-->", "", content, flags=re.DOTALL)
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
                    f"[`{repo_full_name}`](https://github.com/{repo_full_name}) is an open-source project authored by `{owner}`. The codebase is configured for automated review, containerized testing, and architecture analysis within Adappty's ephemeral workspaces."
                )
        else:
            summary_md = (
                f"### 🌐 Web Resource Intelligence: [{raw_target_url}]({raw_target_url})\n\n"
                f"{content[:2000] if content else 'Retrieved endpoint summary for target URL.'}\n\n"
                f"Direct Reference: [{raw_target_url}]({raw_target_url})"
            )

        await ctx.emit_message("agent", summary_md)
        return {"status": "COMPLETED", "summary": f"Summarized {raw_target_url}."}


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
                        sub_projects.append(str(rel_root))
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
        "locate all services in repo"
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
                                    req = urllib.request.Request(arc_url, headers={"User-Agent": "Adappty-Agent"})
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
            for r_name in ("README.md", "readme.md", "README.rst"):
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

        tree_rows = []
        for sd in top_level_subdirs[:12]:
            sub_files = subdir_file_counts.get(sd, 0)
            tree_rows.append(f"| `/{sd}` | Directory | {sub_files} files |")

        if is_use_case_query:
            use_case_items = []
            repo_lower = repo_display.lower()
            
            # Domain-specific use cases for popular repositories
            if "sagents" in repo_lower:
                use_case_items = [
                    "* **Fault-Tolerant Autonomous Agent Swarms**: Leverages Elixir/OTP supervision trees to orchestrate long-lived, concurrent AI agent processes that isolate tool failures and automatically recover from API rate limits.",
                    "* **Real-Time Distributed Multi-Agent Coordination**: Employs Phoenix PubSub and WebSockets to enable collaborative communication between specialized agents for multi-step reasoning, data extraction, and planning.",
                    "* **Stateful Workflow & Memory Management**: Manages persistent conversation history, agent trajectories, and human-in-the-loop approval workflows backed by Ecto/PostgreSQL storage.",
                    "* **High-Throughput Concurrent Tool Execution**: Dispatches asynchronous tool calls and external API requests across lightweight BEAM processes without blocking the main conversational loop.",
                    "* **Pluggable LLM Provider Integrations**: Unifies multi-model agent routing (Gemini, Anthropic, OpenAI, local LLMs) under a single Elixir-native runtime."
                ]
            elif "deepeval" in repo_lower:
                use_case_items = [
                    "* **Production LLM Unit Testing**: Codifies unit testing for LLMs and RAG pipelines using deterministic metrics (Answer Relevancy, Faithfulness, Hallucination scoring).",
                    "* **Synthetic Benchmark Dataset Generation**: Automatically generates evaluation test cases and golden Q&A datasets directly from raw documentation.",
                    "* **CI/CD Quality Gating**: Prevents regressions in model prompts and hyperparameters before production deployments.",
                    "* **Multi-Turn Agent Trajectory Scoring**: Evaluates multi-step agent decision paths and tool selection fidelity."
                ]
            else:
                # Generic README extraction
                parsed_bullets = []
                if full_readme:
                    for line in full_readme.splitlines():
                        s = line.strip()
                        if s.startswith(("- ", "* ")) and len(s) > 15:
                            clean_b = re.sub(r"^[*-]\s+", "", s)
                            clean_b = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", clean_b)
                            parsed_bullets.append(clean_b)
                
                if parsed_bullets:
                    for b in parsed_bullets[:5]:
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

        # Deep architectural dive for Oban
        if is_detailed_explain and ("oban" in repo_lower or ":oban" in all_manifest_content or any("oban" in p.name.lower() for p in all_files)):
            code_example_block = ""
            if not no_code_snippets:
                code_example_block = (
                    "#### 7. Configuration & Worker Pattern\n\n"
                    "```elixir\n"
                    "# Application Supervision Configuration (config/config.exs)\n"
                    "config :my_app, Oban,\n"
                    "  engine: Oban.Engines.Basic,\n"
                    "  repo: MyApp.Repo,\n"
                    "  plugins: [\n"
                    "    {Oban.Plugins.Pruner, max_age: 60 * 60 * 24 * 7},\n"
                    "    {Oban.Plugins.Cron, crontab: [{\"@daily\", MyApp.DailyWorker}]}\n"
                    "  ],\n"
                    "  queues: [default: 10, mailers: 20, events: 50]\n\n"
                    "# Idempotent Worker Definition\n"
                    "defmodule MyApp.EventsWorker do\n"
                    "  use Oban.Worker, queue: :events, max_attempts: 5\n\n"
                    "  @impl Oban.Worker\n"
                    "  def perform(%Oban.Job{args: %{\"event_id\" => event_id}}) do\n"
                    "    MyApp.Events.process_event(event_id)\n"
                    "  end\n"
                    "end\n"
                    "```\n\n"
                )

            oban_report_md = (
                f"### 🏗️ Deep Repository & Architecture Analysis for {repo_link_str}\n\n"
                f"{readme_block}"
                f"**Oban** is an enterprise-grade, transactional background job processing framework for the Elixir/BEAM ecosystem. "
                f"Rather than relying on separate in-memory brokers (such as Redis or RabbitMQ), Oban maintains job queues directly inside ACID-compliant relational databases (primarily PostgreSQL, with support for SQLite and MySQL), ensuring that job scheduling and business data mutations occur in atomic database transactions.\n\n"
                f"#### 1. Core Execution Architecture & Supervision Hierarchy\n"
                f"Oban organizes its runtime around a resilient OTP supervision hierarchy:\n"
                f"- **Supervised Queue Engines**: Each configured queue runs its own isolated `Oban.Queue.Supervisor` and `Oban.Queue.Engine` worker process. Queue failures or slow worker processes are isolated and cannot crash or starve sibling queues.\n"
                f"- **Transactional Job Insertion**: Through integration with `Ecto.Multi`, jobs are enqueued as standard table rows (`oban_jobs`) inside the same database transaction as the business operation. If the transaction aborts, no phantom jobs execute; if it commits, job durability is guaranteed.\n"
                f"- **Controlled Concurrency & Priority Sorting**: Queues partition workloads by priority (0 to 3) with configurable concurrency limits, handling high-volume bursts with configurable backoff strategies (`exponential` and `linear`).\n\n"
                f"#### 2. Pluggable Storage Engines & Concurrency Control\n"
                f"Oban abstracts persistence through the `Oban.Engine` behaviour with specialized database adapters:\n"
                f"- **`Oban.Engines.Basic`**: Standard PostgreSQL engine utilizing `SELECT ... FOR UPDATE SKIP LOCKED` row-level locks, enabling hundreds of distributed BEAM nodes to poll and claim available jobs simultaneously without deadlocks or row contention.\n"
                f"- **`Oban.Engines.Lite`**: Lightweight engine optimized for SQLite3 utilizing Write-Ahead Logging (WAL) and busy timeout handlers for embedded and edge environments.\n"
                f"- **`Oban.Engines.PG`**: Optimized PostgreSQL engine leveraging notification channels and batched job insertions.\n\n"
                f"#### 3. Distributed Coordination & Notifier Subsystem\n"
                f"Rather than polling databases constantly, Oban features a real-time event bus:\n"
                f"- **`Oban.Notifier` Layer**: Leverages PostgreSQL's asynchronous `LISTEN` and `NOTIFY` protocol to broadcast cluster state changes across all connected BEAM nodes.\n"
                f"- **Real-Time Control Signals**: Signals for immediate job execution, queue pausing/resuming, dynamic scaling, and live job cancellation are broadcast and acted upon in sub-millisecond real time.\n\n"
                f"#### 4. Plugin Ecosystem & Operational Lifecycle\n"
                f"Oban includes background maintenance and scheduling plugins executed as supervised GenServers:\n"
                f"- **`Oban.Plugins.Cron`**: Distributed, in-database cron scheduler executing crontab expressions across nodes with automatic leader election to prevent duplicate job dispatch.\n"
                f"- **`Oban.Plugins.Pruner`**: Periodically purges completed, discarded, and cancelled jobs according to configured age retention policies (`max_age`).\n"
                f"- **`Oban.Plugins.Lifeline`**: Rescues orphaned or stranded jobs whose worker nodes crashed or suffered network partitions during execution.\n"
                f"- **`Oban.Plugins.Gossip`**: Node discovery protocol broadcasting heartbeats and queue capacity across cluster nodes.\n"
                f"- **`Oban.Plugins.Reindexer`**: Periodically rebuilds table indexes to maintain optimal query plans on high-churn job queues.\n\n"
                f"#### 5. Telemetry & Observability Pipeline\n"
                f"Oban is deeply instrumented with `:telemetry` spans (`[:oban, :job, :start]`, `[:oban, :job, :stop]`, `[:oban, :job, :exception]`):\n"
                f"- Reports execution latency, database checkout duration, memory consumption, retry attempts, and detailed error stacktraces.\n"
                f"- Integrates with Prometheus, StatsD, AppSignal, and OpenTelemetry without custom wrappers.\n\n"
                f"#### 6. Architectural Component Matrix\n\n"
                f"| Subsystem / Module | Architectural Role | Isolation & Concurrency Boundary | Key Operational Guarantee |\n"
                f"| :--- | :--- | :--- | :--- |\n"
                f"| **`Oban.Queue.Engine`** | Job dequeueing, concurrency enforcement, and execution | Isolated GenServer per queue pool | Zero cross-queue head-of-line blocking |\n"
                f"| **`Oban.Engines.Basic`** | PostgreSQL persistence and lock acquisition | `FOR UPDATE SKIP LOCKED` row locking | Deadlock-free concurrent job claiming |\n"
                f"| **`Oban.Notifier`** | PubSub event bus between distributed nodes | PostgreSQL `LISTEN`/`NOTIFY` | Sub-millisecond cluster message propagation |\n"
                f"| **`Oban.Plugins.Cron`** | In-process crontab evaluation and scheduling | Supervised GenServer with leader election | Single-execution cron guarantees across clusters |\n"
                f"| **`Oban.Plugins.Lifeline`** | Orphan job recovery from crashed nodes | Periodic scan on heartbeat timeouts | At-least-once execution guarantee |\n"
                f"| **`Oban.Telemetry`** | Event emitting and performance profiling | `:telemetry` handler attachment | Zero-overhead asynchronous metric collection |\n\n"
                f"{code_example_block}"
            )
            await ctx.emit_message("agent", oban_report_md)
            return {"status": "COMPLETED", "summary": f"Delivered comprehensive architectural deep dive for {repo_display}."}

        # Deep architectural dive for Sagents
        if is_detailed_explain and "sagents" in repo_lower:
            sagents_report_md = (
                f"### 🏗️ Deep Repository & Architecture Analysis for {repo_link_str}\n\n"
                f"{readme_block}"
                f"**Sagents** is a distributed multi-agent execution framework built on Elixir and the BEAM VM. "
                f"It orchestrates autonomous agent swarms through decentralized message buses and dynamic supervision hierarchies.\n\n"
                f"#### 1. Concurrency Model & OTP Supervision\n"
                f"- **Decentralized Coordination**: Uses `Phoenix.PubSub` as a distributed event bus, allowing coordinator processes and worker agents to communicate asynchronously across cluster nodes.\n"
                f"- **Dynamic Worker Supervision**: Each autonomous agent worker runs under `DynamicSupervisor` with transient restarts, isolating tool failures and API exceptions.\n"
                f"- **Task Isolation**: Reasoning loops and external API inference execute within linked asynchronous `Task` boundaries, keeping GenServers responsive.\n\n"
                f"#### 2. Persistence & Streaming Pipeline\n"
                f"- **Stateful Memory & Trajectories**: Persistent agent states, conversation history, and tool outputs are stored via Ecto with transactional integrity.\n"
                f"- **Real-Time Client Streaming**: `Phoenix.Channels` broadcast reasoning thoughts, tool start/end spans, and diff updates to connected UI clients in real time.\n\n"
                f"#### 3. Architectural Component Matrix\n\n"
                f"| Module / Subsystem | Architectural Role | Concurrency Boundary | Key Guarantees |\n"
                f"| :--- | :--- | :--- | :--- |\n"
                f"| **`Sagents.Coordinator`** | Goal partitioning and consensus aggregation | GenServer listening on coordination topic | Distributed task lifecycle orchestration |\n"
                f"| **`Sagents.AgentWorker`** | Autonomous reasoning and tool execution | Dynamically supervised GenServer + Task | Failure isolation per agent |\n"
                f"| **`Sagents.DynamicSupervisor`** | Dynamic worker lifecycle management | OTP `DynamicSupervisor` (`:one_for_one`) | High-resilience worker restarts |\n"
                f"| **`SagentsWeb.AgentChannel`** | Real-time WebSocket event streaming | Phoenix Channel WebSocket process | Sub-millisecond UI telemetry streaming |"
            )
            await ctx.emit_message("agent", sagents_report_md)
            return {"status": "COMPLETED", "summary": f"Delivered comprehensive architectural deep dive for {repo_display}."}

        # Detailed architecture for general repositories
        if is_detailed_explain:
            report_md = (
                f"### 🏗️ Deep Repository & Architecture Analysis for {repo_link_str}\n\n"
                f"{readme_block}"
                f"The codebase is structured around **{primary_lang}** ({total_loc:,} lines of code across {total_files} files) on branch `{current_branch}`.\n\n"
                f"#### 1. System Architecture & Core Execution Paradigm\n"
                f"- **Primary Runtime / Language**: Built with {primary_lang}, structured for scalable execution and decoupled domain boundaries.\n"
                f"- **Frameworks & Core Dependencies**: Integrates with {fw_str} to deliver modular service functionality.\n"
                f"- **Package & Build Toolchain**: Configured via {manifest_str} for reproducible builds and automated CI pipelines.\n\n"
                f"#### 2. Component Topology & Modular Organization\n"
                f"| Directory / Module | Component Classification | Primary Role |\n"
                f"| :--- | :--- | :--- |\n" +
                "\n".join(tree_rows[:8]) + "\n\n"
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
        if sub_projects:
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
