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


@pytest.mark.asyncio
async def test_post_pull_request_review_author_fallback(monkeypatch):
    import httpx
    from app.integrations.github_client import github_client

    monkeypatch.delenv("GITHUB_MOCK_TEST_MODE", raising=False)
    monkeypatch.setattr(github_client, "token", "dummy_token")

    calls = []

    async def mock_post(client, url, *args, **kwargs):
        json_data = kwargs.get("json", {})
        calls.append({"url": url, "json": json_data})
        if json_data.get("event") == "REQUEST_CHANGES":
            # Simulate GitHub's author error
            req = httpx.Request("POST", url)
            return httpx.Response(
                422,
                request=req,
                text='{"message":"Unprocessable Entity","errors":["Review Can not request changes on your own pull request"]}'
            )
        elif json_data.get("event") == "COMMENT":
            # Fallback succeeds
            req = httpx.Request("POST", url)
            return httpx.Response(
                200,
                request=req,
                json={"id": 555, "state": "COMMENTED", "html_url": "https://github.com/rubum/cyclode/pull/4#pullrequestreview-555"}
            )
        req = httpx.Request("POST", url)
        return httpx.Response(500, request=req)

    monkeypatch.setattr(httpx.AsyncClient, "post", mock_post)

    res = await github_client.post_pull_request_review(
        owner="rubum",
        repo="cyclode",
        pr_number=4,
        body="Needs tests.",
        event="REQUEST_CHANGES"
    )

    assert res["ok"] is True
    assert res.get("converted_to_comment") is True
    assert len(calls) == 2
    assert calls[0]["json"]["event"] == "REQUEST_CHANGES"
    assert calls[1]["json"]["event"] == "COMMENT"
    assert "Review Verdict: Changes Requested" in calls[1]["json"]["body"]


@pytest.mark.asyncio
async def test_post_pull_request_line_comment_outside_diff_fallback(monkeypatch):
    import httpx
    from app.integrations.github_client import github_client

    monkeypatch.delenv("GITHUB_MOCK_TEST_MODE", raising=False)
    monkeypatch.setattr(github_client, "token", "dummy_token")

    calls = []

    async def mock_post(client, url, *args, **kwargs):
        json_data = kwargs.get("json", {})
        calls.append({"url": url, "json": json_data})
        if "/pulls/4/comments" in str(url):
            # Simulate line outside diff hunk
            req = httpx.Request("POST", str(url))
            return httpx.Response(
                422,
                request=req,
                text='{"message":"Validation Failed","errors":[{"resource":"PullRequestReviewComment","code":"custom","message":"line must be part of the diff"}]}'
            )
        elif "/issues/4/comments" in str(url):
            # Fallback to issue comment succeeds
            req = httpx.Request("POST", str(url))
            return httpx.Response(
                201,
                request=req,
                json={"id": 888, "html_url": "https://github.com/rubum/cyclode/pull/4#issuecomment-888"}
            )
        req = httpx.Request("POST", str(url))
        return httpx.Response(500, request=req)

    monkeypatch.setattr(httpx.AsyncClient, "post", mock_post)

    res = await github_client.post_pull_request_line_comment(
        owner="rubum",
        repo="cyclode",
        pr_number=4,
        body="Missing type annotation.",
        commit_sha="c0ffee",
        path="backend/app/main.py",
        line=100
    )

    assert res["ok"] is True
    assert res.get("converted_to_issue_comment") is True
    assert len(calls) == 2
    assert "/pulls/4/comments" in str(calls[0]["url"])
    assert "/issues/4/comments" in str(calls[1]["url"])
    assert "Review Comment on `backend/app/main.py:100`" in calls[1]["json"]["body"]


@pytest.mark.asyncio
async def test_agent_pool_approve_review_failure_propagation(monkeypatch):
    import uuid
    from app.db.session import async_session_factory
    from app.db.models import TaskModel, TaskApprovalModel, TaskMessageModel
    from app.agent.pool import agent_pool
    from app.integrations.github_client import github_client
    from sqlalchemy import select

    monkeypatch.delenv("GITHUB_MOCK_TEST_MODE", raising=False)
    task_id = f"test-task-{uuid.uuid4().hex[:8]}"

    async def mock_review_fail(*args, **kwargs):
        return {"ok": False, "error": "Bad credentials (401)"}

    monkeypatch.setattr(github_client, "post_pull_request_review", mock_review_fail)

    async with async_session_factory() as session:
        task = TaskModel(
            id=task_id,
            title="Test Failure Propagation",
            workspace_path="/tmp",
            status="AWAITING_APPROVAL"
        )
        session.add(task)
        await session.flush()

        appr = TaskApprovalModel(
            id=f"appr-fail-{uuid.uuid4().hex[:6]}",
            task_id=task_id,
            action_type="post_pull_request_review",
            action_details={"repository": "rubum/cyclode", "pr_number": 4, "body": "Review", "event": "APPROVE"},
            status="PENDING"
        )
        session.add(appr)
        await session.commit()

    res = await agent_pool.approve_task(task_id, feedback="Go ahead", approve_all=True)
    assert res["ok"] is True
    assert len(res["results"]) == 1
    assert res["results"][0]["result"]["ok"] is False

    # Check that TaskMessage recorded failure rather than "Submitted approved review"
    async with async_session_factory() as session:
        messages = (await session.execute(
            select(TaskMessageModel).where(TaskMessageModel.task_id == task_id)
        )).scalars().all()
        assert any("Failed to submit review" in m.content for m in messages)
        assert not any("Submitted approved review" in m.content for m in messages)

