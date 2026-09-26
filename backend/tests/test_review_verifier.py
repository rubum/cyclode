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


@pytest.mark.asyncio
async def test_async_llm_ensemble_probes_mocked():
    from unittest.mock import AsyncMock, MagicMock
    from app.agent.providers.base import BaseLLMProvider

    mock_provider = MagicMock(spec=BaseLLMProvider)
    mock_provider.get_api_key.return_value = "mock-key"
    
    # Return structured JSON for probes
    mock_provider.generate_structured_json = AsyncMock(return_value={
        "result": {
            "hypotheses": [
                {
                    "file_path": "backend/auth/tenant.py",
                    "line_start": 45,
                    "line_end": 50,
                    "title": "Tenant Isolation Cross-Account Data Leak",
                    "description": "Tenant ID parameter missing in where clause.",
                    "invariant_violated": "All queries must scope to active tenant ID.",
                    "reproduction_scenario": "User A can access User B records by incrementing id.",
                    "suggested_diff": "```diff\n-WHERE id = :id\n+WHERE id = :id AND tenant_id = :tenant_id\n```",
                    "preliminary_confidence": 0.94
                }
            ]
        }
    })

    diff_text = """
diff --git a/backend/auth/tenant.py b/backend/auth/tenant.py
--- a/backend/auth/tenant.py
+++ b/backend/auth/tenant.py
@@ -44,3 +44,4 @@ def get_tenant_record(id):
+    return db.query("SELECT * FROM records WHERE id = :id", id=id)
"""

    hypotheses = await review_verifier.generate_ensemble_hypotheses_async(
        diff_text=diff_text,
        provider=mock_provider,
        model_name="claude-fable-5-1"
    )

    assert len(hypotheses) >= 1
    assert any("Tenant Isolation" in h.title for h in hypotheses)
    assert any(h.category == "security" for h in hypotheses)


@pytest.mark.asyncio
async def test_async_adversarial_falsification_confirmed_and_falsified(tmp_path: Path):
    from unittest.mock import AsyncMock, MagicMock
    from app.agent.providers.base import BaseLLMProvider

    src_file = tmp_path / "backend" / "order.py"
    src_file.parent.mkdir(parents=True, exist_ok=True)
    src_file.write_text(
        "def process_order(order_id):\n"
        "    if not order_id:\n"
        "        raise ValueError('Missing order id')\n"
        "    payment_gateway.charge(order_id)\n",
        encoding="utf-8"
    )

    # 1. Test Confirmed Bug
    mock_provider_confirmed = MagicMock(spec=BaseLLMProvider)
    mock_provider_confirmed.get_api_key.return_value = "mock-key"
    mock_provider_confirmed.generate_structured_json = AsyncMock(return_value={
        "result": {
            "verdict": "CONFIRMED",
            "confidence": 0.96,
            "verification_proof": "Confirmed that double charge occurs on retry.",
            "reproduction_scenario": "Network timeout on charge response triggers second charge.",
            "suggested_diff": "```diff\n-payment_gateway.charge(order_id)\n+payment_gateway.idempotent_charge(order_id, idempotency_key=order_id)\n```"
        }
    })

    hypo_real = ReviewHypothesis(
        id="hypo-idempotency",
        category="logic_invariant",
        scanner_name="LLMLogicInvariantScanner",
        file_path="backend/order.py",
        line_start=4,
        line_end=4,
        title="Missing Idempotency Key in Payment Charge",
        description="Charge is executed without an idempotency key.",
        invariant_violated="Payment operations must be idempotent.",
        reproduction_scenario="Retry on network disconnect charges twice.",
        suggested_diff="",
        preliminary_confidence=0.92
    )

    verified = await review_verifier.verify_and_falsify_async(
        hypothesis=hypo_real,
        workspace_path=tmp_path,
        provider=mock_provider_confirmed,
        model_name="claude-fable-5-1"
    )

    assert verified is not None
    assert verified.category == "LOGIC_BUG"
    assert verified.confidence_score == 0.96
    assert "double charge" in verified.verification_evidence

    # 2. Test Falsified False Alarm
    mock_provider_falsified = MagicMock(spec=BaseLLMProvider)
    mock_provider_falsified.get_api_key.return_value = "mock-key"
    mock_provider_falsified.generate_structured_json = AsyncMock(return_value={
        "result": {
            "verdict": "FALSIFIED",
            "confidence": 0.30,
            "verification_proof": "Guard clause 'if not order_id' upstream already guarantees order_id is present.",
            "reproduction_scenario": "None"
        }
    })

    hypo_false_alarm = ReviewHypothesis(
        id="hypo-false-alarm",
        category="logic_invariant",
        scanner_name="LLMLogicInvariantScanner",
        file_path="backend/order.py",
        line_start=4,
        line_end=4,
        title="Potential Null Pointer on order_id",
        description="order_id might be None.",
        invariant_violated="order_id must be truthy.",
        reproduction_scenario="Passing None crashes.",
        suggested_diff="",
        preliminary_confidence=0.85
    )

    rejected = await review_verifier.verify_and_falsify_async(
        hypothesis=hypo_false_alarm,
        workspace_path=tmp_path,
        provider=mock_provider_falsified,
        model_name="claude-fable-5-1"
    )

    assert rejected is None


@pytest.mark.asyncio
async def test_workspace_tools_verify_code_hypothesis_tool(tmp_path: Path):
    src_file = tmp_path / "backend" / "server.py"
    src_file.parent.mkdir(parents=True, exist_ok=True)
    src_file.write_text("import os\ndef run(cmd):\n    os.system(cmd)\n", encoding="utf-8")

    res = await WorkspaceTools.verify_code_hypothesis(
        workspace_path=tmp_path,
        file_path="backend/server.py",
        line_range="3",
        invariant_violated="Command execution must not use os.system",
        reproduction_scenario="Passing semicolon separates commands"
    )

    assert "verified" in res


@pytest.mark.asyncio
async def test_review_verifier_with_vault_credentials():
    from unittest.mock import patch, AsyncMock
    from app.config import settings
    from app.integrations.manager import integration_manager
    from app.agent.providers.deepseek import DeepSeekProvider

    # DeepSeek key configured exclusively in Vault / integration manager
    with patch.object(settings, "DEEPSEEK_API_KEY", None), \
         patch.dict("os.environ", {}, clear=True):
        integration_manager._custom_credentials["deepseek"] = {"api_key": "sk-vault-deepseek-key"}

        diff_text = """
diff --git a/backend/main.py b/backend/main.py
--- a/backend/main.py
+++ b/backend/main.py
@@ -10,1 +10,1 @@
-def query(param):
+def query(param): os.system(f"rm {param}")
"""
        # Patch DeepSeekProvider.generate_structured_json
        with patch.object(DeepSeekProvider, "generate_structured_json", new_callable=AsyncMock) as mock_json:
            mock_json.return_value = {
                "result": {
                    "hypotheses": [
                        {
                            "file_path": "backend/main.py",
                            "line_start": 10,
                            "line_end": 10,
                            "title": "Command Injection Vulnerability",
                            "description": "Untrusted param passed directly to os.system.",
                            "invariant_violated": "Do not pass unsanitized input to shell.",
                            "reproduction_scenario": "param = '; rm -rf /'",
                            "suggested_diff": "```diff\n-os.system(f'rm {param}')\n+subprocess.run(['rm', param], check=True)\n```",
                            "preliminary_confidence": 0.95
                        }
                    ]
                }
            }

            hypotheses = await review_verifier.generate_ensemble_hypotheses_async(
                diff_text=diff_text,
                model_name="deepseek:deepseek-flash"
            )

            assert len(hypotheses) >= 1
            assert any("Command Injection" in h.title for h in hypotheses)


