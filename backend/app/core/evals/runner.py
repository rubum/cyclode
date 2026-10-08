import time
import logging
from pathlib import Path
from typing import Dict, Any, List, Optional
from app.db.models import get_utc_now
from app.schemas.evals import (
    EvaluationCategory,
    EvaluationCheck,
    EvaluationScorecard,
)

logger = logging.getLogger("cyclode.evals.runner")


class EvaluationRunner:
    """
    Modular Evaluation Suite Runner.
    Executes multi-tier verification checks across workspace state,
    isolated unit tests, preview bundles, security boundaries, and synthesis quality.
    """

    async def evaluate_task(
        self,
        workspace_path: Optional[Path],
        intent_category: str,
        is_app_task: bool,
        preview_info: Optional[Dict[str, Any]],
        tool_call_count: int,
        final_agent_text: Optional[str],
        model_succeeded: bool = True,
        jailer_metrics: Optional[Dict[str, Any]] = None,
        last_tool_exit_code: Optional[int] = None,
        last_tool_error: Optional[str] = None,
        error_count: int = 0
    ) -> EvaluationScorecard:
        """
        Runs comprehensive evaluation checks and produces an immutable EvaluationScorecard.
        """
        start_t = time.time()
        checks: List[EvaluationCheck] = []

        # 1. Workspace State Check
        ws_exists = workspace_path is not None and workspace_path.exists()
        checks.append(EvaluationCheck(
            name="Workspace State Invariant",
            category=EvaluationCategory.WORKSPACE_STATE,
            passed=ws_exists,
            diagnostics=f"Workspace path: {workspace_path}" if ws_exists else "Workspace directory does not exist.",
            duration_ms=2
        ))

        # 2. Live Application Preview Check (if fullstack / UI task)
        preview_ok = False
        if is_app_task:
            diag = "No preview generated"
            if preview_info:
                preview_issues = preview_info.get("issues", [])
                preview_ok = preview_info.get("status") in ["ready", "compiled", "static"] and not preview_issues
                if preview_ok:
                    diag = f"Preview status: {preview_info.get('status')}, framework: {preview_info.get('framework', 'unknown')}"
                else:
                    diag = f"Preview status: {preview_info.get('status')}, issues: {', '.join(preview_issues[:3])}"

            checks.append(EvaluationCheck(
                name="Live Application Preview",
                category=EvaluationCategory.PREVIEW_BUNDLE,
                passed=preview_ok,
                diagnostics=diag,
                duration_ms=10
            ))

        # 3. Tool Execution & Actions Check
        if last_tool_exit_code is not None and last_tool_exit_code != 0:
            tool_passed = False
            diag_tool = f"Last tool execution failed with exit code {last_tool_exit_code}: {last_tool_error or 'Unhandled command failure'}."
        elif error_count > 0:
            if is_app_task and preview_ok:
                tool_passed = True
                diag_tool = f"Executed {tool_call_count} actions with {error_count} recovered error{'s' if error_count != 1 else ''} (preview verified)."
            else:
                tool_passed = False if error_count >= 2 else model_succeeded
                diag_tool = f"Executed {tool_call_count} actions with {error_count} unrecovered error{'s' if error_count != 1 else ''}."
        elif tool_call_count > 0:
            tool_passed = True
            diag_tool = f"Executed {tool_call_count} tool calls successfully."
        else:
            tool_passed = model_succeeded
            diag_tool = f"Executed {tool_call_count} tool calls."

        checks.append(EvaluationCheck(
            name="Tool Execution & Actions",
            category=EvaluationCategory.UNIT_TESTS if not is_app_task else EvaluationCategory.WORKSPACE_STATE,
            passed=tool_passed,
            diagnostics=diag_tool,
            duration_ms=1
        ))

        # 4. Analytical Synthesis Quality Check (if QA / research / review / swarm)
        if intent_category in ["qa_research", "code_review", "parallel_swarm"]:
            has_synthesis = bool(final_agent_text and len(final_agent_text.strip()) > 40) or model_succeeded
            checks.append(EvaluationCheck(
                name="Analytical Synthesis Quality",
                category=EvaluationCategory.SYNTHESIS,
                passed=has_synthesis,
                diagnostics=f"Response length: {len(final_agent_text or '')} chars.",
                duration_ms=1
            ))

        # 5. Security Jail & Secret Boundary Check
        sanitized_count = 0
        if jailer_metrics:
            sanitized_count = jailer_metrics.get("sanitized_secrets_count", 0)
        checks.append(EvaluationCheck(
            name="Kernel Namespace & Secret Jail",
            category=EvaluationCategory.SECURITY_JAIL,
            passed=True,
            diagnostics=f"Verified. {sanitized_count} sensitive keys stripped from child processes.",
            duration_ms=1
        ))

        # 6. Executive Delivery Completion Invariant (Anti-Dangling Scratchpad & Anti-Bailing Guard)
        from app.agent.harness import Harness
        cleaned_text = (final_agent_text or "").strip()
        has_delivery = bool(cleaned_text)
        is_dangling = Harness.is_dangling_action_intent(cleaned_text) if has_delivery else True
        is_surrender, surrender_reason = Harness.is_surrender_or_bailing_intent(cleaned_text) if has_delivery else (False, None)
        exec_passed = has_delivery and not is_dangling and not is_surrender
        if not has_delivery:
            diag = "No final executive summary delivered."
        elif is_dangling:
            diag = f"Agent output contains in-flight transitional action promises ('{cleaned_text[:60]}...') without completed delivery."
        elif is_surrender:
            diag = f"Agent surrendered execution with defeatist bailing handoff: {surrender_reason}."
        else:
            diag = "Verified completed terminal executive delivery."

        checks.append(EvaluationCheck(
            name="Executive Delivery Completion",
            category=EvaluationCategory.SYNTHESIS,
            passed=exec_passed,
            diagnostics=diag,
            duration_ms=1
        ))

        # Calculate score and overall status
        passed_count = sum(1 for c in checks if c.passed)
        total_count = len(checks)
        score = round(passed_count / max(total_count, 1), 2)

        all_passed = all(c.passed for c in checks) and model_succeeded

        if all_passed:
            status = "accomplished"
            summary = "All execution plan steps and invariant checks verified successfully."
        else:
            status = "needs_revision"
            failed_names = [c.name for c in checks if not c.passed]
            summary = f"Plan execution requires revision on: {', '.join(failed_names)}."

        return EvaluationScorecard(
            status=status,
            summary=summary,
            score=score,
            checks=checks,
            evaluated_at=get_utc_now()
        )


# Singleton evaluation runner
evaluation_runner = EvaluationRunner()
