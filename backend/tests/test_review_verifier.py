import pytest
from pathlib import Path
from app.agent.review_verifier import (
    ReviewVerifier,
    ReviewHypothesis,
    VerifiedFinding,
    review_verifier
)
from app.agent.tools import WorkspaceTools


def test_style_ban_filter_rejects_cosmetic_nits():
    # 1. Formatting and naming preferences must be rejected
    assert ReviewVerifier.is_style_or_cosmetic(
        title="Consider renaming variable to user_id",
        description="The variable name 'u' could be improved for better readability."
    ) is True

    assert ReviewVerifier.is_style_or_cosmetic(
        title="Missing docstring on function",
        description="Please add docstring comments for public API documentation."
    ) is True

    assert ReviewVerifier.is_style_or_cosmetic(
        title="Trailing whitespace detected",
        description="Remove trailing whitespace on line 42 for cleaner syntax."
    ) is True

    assert ReviewVerifier.is_style_or_cosmetic(
        title="Use camelCase instead of snake_case",
        description="Follow JavaScript naming conventions."
    ) is True

    # 2. Real critical runtime and security bugs must NOT be rejected
    assert ReviewVerifier.is_style_or_cosmetic(
        title="SQL Injection Vulnerability",
        description="Direct f-string string interpolation into SQL cursor."
    ) is False

    assert ReviewVerifier.is_style_or_cosmetic(
        title="Unawaited async coroutine causing race condition",
        description="The async send_notification task is dropped without awaiting."
    ) is False


def test_ensemble_scanner_security_probes():
    diff_text = """
diff --git a/app/db.py b/app/db.py
--- a/app/db.py
+++ b/app/db.py
@@ -10,4 +10,6 @@ def get_user(user_id):
+    query = f"SELECT * FROM users WHERE id = '{user_id}'"
+    cursor.execute(query)
+    api_key = "AIzaSyDUMMY_SECRET_KEY_1234567890"
+    subprocess.run(f"echo {user_id}", shell=True)
"""
    hypotheses = review_verifier.generate_ensemble_hypotheses(diff_text)
    assert len(hypotheses) >= 3
    
    titles = [h.title for h in hypotheses]
    assert any("SQL Injection" in t for t in titles)
    assert any("Command Injection" in t for t in titles)
    assert any("Hardcoded" in t for t in titles)


def test_ensemble_scanner_concurrency_and_resource_leaks():
    diff_text = """
diff --git a/app/service.py b/app/service.py
--- a/app/service.py
+++ b/app/service.py
@@ -20,4 +20,4 @@ async def process_payment(order_id):
+    client = httpx.AsyncClient()
+    asyncio.create_task(client.post("https://api.gateway.com/pay"))
"""
    hypotheses = review_verifier.generate_ensemble_hypotheses(diff_text)
    assert len(hypotheses) >= 1

    categories = [h.category for h in hypotheses]
    assert "concurrency" in categories or "resource_leak" in categories


def test_ensemble_scanner_logic_invariants():
    diff_text = """
diff --git a/app/worker.py b/app/worker.py
--- a/app/worker.py
+++ b/app/worker.py
@@ -30,4 +30,5 @@ def run_job():
+    try:
+        sync_records()
+    except:
+        pass
"""
    hypotheses = review_verifier.generate_ensemble_hypotheses(diff_text)
    assert len(hypotheses) >= 1
    assert any("Silent Exception Swallowing" in h.title for h in hypotheses)


def test_falsification_and_verification_step(tmp_path: Path):
    src_file = tmp_path / "app" / "db.py"
    src_file.parent.mkdir(parents=True, exist_ok=True)
    src_file.write_text("def get_user(id):\n    cursor.execute(f'SELECT * FROM x WHERE id={id}')\n", encoding="utf-8")

    # 1. Valid security hypothesis should verify
    valid_hypo = ReviewHypothesis(
        id="hypo-1",
        category="security",
        scanner_name="SecurityScanner",
        file_path="app/db.py",
        line_start=2,
        line_end=2,
        title="SQL Injection Vulnerability",
        description="Formatted string in execute call.",
        invariant_violated="Database queries must be parameterized.",
        reproduction_scenario="Supplying SQL payload alters query.",
        suggested_diff="```diff\n-cursor.execute(f'...{id}')\n+cursor.execute('...', (id,))\n```",
        preliminary_confidence=0.95
    )

    verified = review_verifier.verify_and_falsify(valid_hypo, workspace_path=tmp_path)
    assert verified is not None
    assert verified.category == "SECURITY_CRITICAL"
    assert verified.severity == "CRITICAL"
    assert verified.confidence_score >= 0.90

    # 2. Cosmetic / Style hypothesis must be rejected
    style_hypo = ReviewHypothesis(
        id="hypo-2",
        category="logic_invariant",
        scanner_name="StyleScanner",
        file_path="app/db.py",
        line_start=1,
        line_end=1,
        title="Rename function get_user",
        description="Consider using fetch_user for cleaner naming conventions.",
        invariant_violated="Naming convention.",
        reproduction_scenario="None.",
        suggested_diff="",
        preliminary_confidence=0.80
    )

    rejected = review_verifier.verify_and_falsify(style_hypo, workspace_path=tmp_path)
    assert rejected is None


def test_deduplication_and_clustering():
    findings = [
        VerifiedFinding(
            id="vf-1",
            category="SECURITY_CRITICAL",
            severity="CRITICAL",
            file_path="app/db.py",
            line_start=10,
            line_end=10,
            title="SQL Injection",
            violation_summary="Unparameterized query",
            verification_evidence="Verified",
            reproduction_steps="Inject SQL",
            suggested_diff="",
            confidence_score=0.95
        ),
        VerifiedFinding(
            id="vf-2",
            category="SECURITY_CRITICAL",
            severity="CRITICAL",
            file_path="app/db.py",
            line_start=11,
            line_end=11,
            title="SQL Injection Duplicate",
            violation_summary="Same unparameterized query block",
            verification_evidence="Verified",
            reproduction_steps="Inject SQL",
            suggested_diff="",
            confidence_score=0.95
        ),
        VerifiedFinding(
            id="vf-3",
            category="LOGIC_BUG",
            severity="HIGH",
            file_path="app/api.py",
            line_start=50,
            line_end=50,
            title="Unhandled Exception",
            violation_summary="Exception dropped",
            verification_evidence="Verified",
            reproduction_steps="Raise error",
            suggested_diff="",
            confidence_score=0.92
        )
    ]

    deduped = review_verifier.deduplicate_and_cluster(findings)
    assert len(deduped) == 2
    assert deduped[0].file_path == "app/db.py"
    assert deduped[1].file_path == "app/api.py"


def test_review_markdown_synthesis():
    # 1. Clean report when zero findings
    clean_report = review_verifier.format_review_markdown([])
    assert "All Invariant Verification Checks Passed with Zero Flaws Detected" in clean_report
    assert "Security & Auth Boundaries" in clean_report
    assert "Zero-Style Invariant" in clean_report

    # 2. Report with verified findings
    sample_finding = VerifiedFinding(
        id="vf-test",
        category="SECURITY_CRITICAL",
        severity="CRITICAL",
        file_path="backend/auth.py",
        line_start=14,
        line_end=14,
        title="Hardcoded JWT Secret Key",
        violation_summary="Static token committed in code",
        verification_evidence="Found raw string assignment on line 14",
        reproduction_steps="Token extractable by inspecting repository",
        suggested_diff="```diff\n-SECRET = 'static'\n+SECRET = os.environ['JWT_SECRET']\n```",
        confidence_score=0.96
    )

    findings_report = review_verifier.format_review_markdown([sample_finding], pr_meta={"title": "Add Auth", "number": 105})
    assert "Verified Code Review: Add Auth #105" in findings_report
    assert "Verified Findings Summary" in findings_report
    assert "Hardcoded JWT Secret Key" in findings_report
    assert "backend/auth.py:14" in findings_report


@pytest.mark.asyncio
async def test_workspace_tools_run_verified_code_review(tmp_path: Path):
    sample_diff = """
diff --git a/app/main.py b/app/main.py
--- a/app/main.py
+++ b/app/main.py
@@ -1,4 +1,5 @@
+cursor.execute(f"SELECT * FROM items WHERE name = '{name}'")
"""
    result = await WorkspaceTools.run_verified_code_review(
        workspace_path=tmp_path,
        diff_text=sample_diff
    )

    assert result["success"] is True
    assert result["total_hypotheses_scanned"] >= 1
    assert result["verified_findings_count"] >= 1
    assert "review_markdown" in result
    assert "SQL Injection" in result["review_markdown"]
