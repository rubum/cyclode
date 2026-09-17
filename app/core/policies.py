from typing import Dict, Any, Tuple, Optional
from app.config import settings, PolicyLevel


class ApprovalPolicyEngine:
    def __init__(self):
        # Dynamic policy registry that can be inspected and updated at runtime via API
        self._policies: Dict[str, PolicyLevel] = {
            "git_push": settings.POLICY_GIT_PUSH,
            "create_pull_request": settings.POLICY_CREATE_PR,
            "post_comment": settings.POLICY_POST_COMMENTS,
            "slack_notify": settings.POLICY_SLACK_NOTIFY,
            "merge_pr": settings.POLICY_MERGE_PR,
            "execute_shell": settings.POLICY_EXECUTE_SHELL,
        }

    def get_policy(self, action_type: str) -> PolicyLevel:
        return self._policies.get(action_type, PolicyLevel.REQUIRE_APPROVAL)

    def set_policy(self, action_type: str, policy: PolicyLevel):
        self._policies[action_type] = policy

    def get_all_policies(self) -> Dict[str, str]:
        return {k: v.value for k, v in self._policies.items()}

    def check_action(self, action_type: str, action_details: Optional[Dict[str, Any]] = None) -> Tuple[bool, str]:
        """
        Evaluates whether an action should execute automatically or be held for human approval.
        Returns: (can_execute_immediately, status_reason)
        """
        policy = self.get_policy(action_type)

        if policy == PolicyLevel.AUTO_ALLOW:
            return True, "AUTO_ALLOWED_BY_POLICY"
        elif policy == PolicyLevel.DISABLED:
            return False, "ACTION_DISABLED_BY_POLICY"
        else:
            return False, "AWAITING_HUMAN_APPROVAL"


policy_engine = ApprovalPolicyEngine()
