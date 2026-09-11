import pytest
from app.config import PolicyLevel
from app.core.policies import ApprovalPolicyEngine


def test_approval_policy_defaults():
    engine = ApprovalPolicyEngine()
    # Check default behavior
    can_exec_pr, reason = engine.check_action("create_pull_request")
    assert can_exec_pr is False
    assert reason == "AWAITING_HUMAN_APPROVAL"

    # Set to auto allow
    engine.set_policy("create_pull_request", PolicyLevel.AUTO_ALLOW)
    can_exec_pr, reason = engine.check_action("create_pull_request")
    assert can_exec_pr is True
    assert reason == "AUTO_ALLOWED_BY_POLICY"

    # Set to disabled
    engine.set_policy("create_pull_request", PolicyLevel.DISABLED)
    can_exec_pr, reason = engine.check_action("create_pull_request")
    assert can_exec_pr is False
    assert reason == "ACTION_DISABLED_BY_POLICY"
