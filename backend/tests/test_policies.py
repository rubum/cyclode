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


def test_pr_review_policy_gating():
    engine = ApprovalPolicyEngine()

    # PR Review default
    can_exec_review, reason = engine.check_action("post_pull_request_review")
    assert can_exec_review is False
    assert reason == "AWAITING_HUMAN_APPROVAL"

    # Line comment default
    can_exec_comment, reason = engine.check_action("post_pull_request_line_comment")
    assert can_exec_comment is False
    assert reason == "AWAITING_HUMAN_APPROVAL"

    # Toggle to AUTO_ALLOW
    engine.set_policy("post_pull_request_review", PolicyLevel.AUTO_ALLOW)
    can_exec_review, reason = engine.check_action("post_pull_request_review")
    assert can_exec_review is True
    assert reason == "AUTO_ALLOWED_BY_POLICY"


@pytest.mark.asyncio
async def test_github_client_line_comment_accepts_commit_sha_and_commit_id(monkeypatch):
    from app.integrations.github_client import github_client
    monkeypatch.setenv("GITHUB_MOCK_TEST_MODE", "1")

    # Calling with commit_sha keyword argument must not raise TypeError
    res1 = await github_client.post_pull_request_line_comment(
        owner="rubum",
        repo="cyclode",
        pr_number=4,
        body="Inline comment test",
        commit_sha="abcdef123456",
        path="backend/app/main.py",
        line=42
    )
    assert res1.get("ok") is True
    assert res1.get("simulated") is True

    # Calling with commit_id keyword argument must also work
    res2 = await github_client.post_pull_request_line_comment(
        owner="rubum",
        repo="cyclode",
        pr_number=4,
        body="Inline comment test 2",
        commit_id="abcdef123456",
        path="backend/app/main.py",
        line=43
    )
    assert res2.get("ok") is True
    assert res2.get("simulated") is True


@pytest.mark.asyncio
async def test_agent_pool_multi_approval_lifecycle(monkeypatch):
    import uuid
    from app.db.session import async_session_factory
    from app.db.models import TaskModel, TaskApprovalModel
    from app.agent.pool import agent_pool
    from sqlalchemy import select

    monkeypatch.setenv("GITHUB_MOCK_TEST_MODE", "1")
    task_id = f"test-task-{uuid.uuid4().hex[:8]}"

    async with async_session_factory() as session:
        task = TaskModel(
            id=task_id,
            title="Test PR Review and Comments",
            workspace_path="/tmp",
            status="AWAITING_APPROVAL"
        )
        session.add(task)
        await session.flush()

        appr1 = TaskApprovalModel(
            id=f"appr-rev-{uuid.uuid4().hex[:6]}",
            task_id=task_id,
            action_type="post_pull_request_review",
            action_details={"repository": "rubum/cyclode", "pr_number": 4, "body": "PR Review", "event": "COMMENT"},
            status="PENDING"
        )
        appr2 = TaskApprovalModel(
            id=f"appr-line-{uuid.uuid4().hex[:6]}",
            task_id=task_id,
            action_type="post_pull_request_line_comment",
            action_details={"repository": "rubum/cyclode", "pr_number": 4, "body": "Line comment", "commit_sha": "abc", "path": "test.py", "line": 10},
            status="PENDING"
        )
        session.add_all([appr1, appr2])
        await session.commit()

    # Approve only the line comment first using approval_id
    res1 = await agent_pool.approve_task(task_id, feedback="Approved line comment", approval_id=appr2.id)
    assert res1["ok"] is True
    assert res1["status"] == "APPROVED"
    assert res1["remaining_pending"] == 1

    # Task status must still be AWAITING_APPROVAL because appr1 is still pending!
    async with async_session_factory() as session:
        t1 = (await session.execute(select(TaskModel).where(TaskModel.id == task_id))).scalar_one()
        assert t1.status == "AWAITING_APPROVAL"

    # Now approve the remaining review
    res2 = await agent_pool.approve_task(task_id, feedback="Approved formal review", approval_id=appr1.id)
    assert res2["ok"] is True
    assert res2["status"] == "APPROVED"
    assert res2["remaining_pending"] == 0

    # Task status must now be COMPLETED
    async with async_session_factory() as session:
        t2 = (await session.execute(select(TaskModel).where(TaskModel.id == task_id))).scalar_one()
        assert t2.status == "COMPLETED"


@pytest.mark.asyncio
async def test_agent_pool_approve_all(monkeypatch):
    import uuid
    from app.db.session import async_session_factory
    from app.db.models import TaskModel, TaskApprovalModel
    from app.agent.pool import agent_pool
    from sqlalchemy import select

    monkeypatch.setenv("GITHUB_MOCK_TEST_MODE", "1")
    task_id = f"test-task-{uuid.uuid4().hex[:8]}"

    async with async_session_factory() as session:
        task = TaskModel(
            id=task_id,
            title="Test Batch Approve All",
            workspace_path="/tmp",
            status="AWAITING_APPROVAL"
        )
        session.add(task)
        await session.flush()

        appr1 = TaskApprovalModel(
            id=f"appr-1-{uuid.uuid4().hex[:6]}",
            task_id=task_id,
            action_type="post_pull_request_review",
            action_details={"repository": "rubum/cyclode", "pr_number": 4, "body": "Review", "event": "COMMENT"},
            status="PENDING"
        )
        appr2 = TaskApprovalModel(
            id=f"appr-2-{uuid.uuid4().hex[:6]}",
            task_id=task_id,
            action_type="post_pull_request_line_comment",
            action_details={"repository": "rubum/cyclode", "pr_number": 4, "body": "Comment 1", "commit_sha": "abc", "path": "a.py", "line": 1},
            status="PENDING"
        )
        session.add_all([appr1, appr2])
        await session.commit()

    # Batch approve all
    res = await agent_pool.approve_task(task_id, feedback="Batch approve all", approve_all=True)
    assert res["ok"] is True
    assert res["status"] == "APPROVED"
    assert res["remaining_pending"] == 0
    assert len(res["results"]) == 2

    async with async_session_factory() as session:
        t = (await session.execute(select(TaskModel).where(TaskModel.id == task_id))).scalar_one()
        assert t.status == "COMPLETED"
