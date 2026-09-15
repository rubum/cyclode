from datetime import datetime, timezone
import uuid
from typing import Optional, Dict, Any, List
from sqlalchemy import String, Text, Boolean, Integer, DateTime, JSON, ForeignKey
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


def generate_uuid() -> str:
    return str(uuid.uuid4())


def get_utc_now() -> datetime:
    return datetime.now(timezone.utc)


class EventModel(Base):
    __tablename__ = "events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    source: Mapped[str] = mapped_column(String(50), nullable=False)  # github, slack, appsignal, sentry, api, cron
    event_type: Mapped[str] = mapped_column(String(100), nullable=False)  # issues.opened, pull_request.opened, pull_request.synchronize, etc.
    payload: Mapped[Dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    signature_valid: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[str] = mapped_column(String(30), default="PROCESSED")  # PROCESSED, IGNORED, ERROR
    created_at: Mapped[datetime] = mapped_column(DateTime, default=get_utc_now)

    tasks: Mapped[List["TaskModel"]] = relationship("TaskModel", back_populates="event", cascade="all, delete-orphan")


class TaskModel(Base):
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    session_key: Mapped[Optional[str]] = mapped_column(String(200), index=True, nullable=True)  # e.g. github:org/repo:pr:42
    event_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("events.id"), nullable=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    custom_title: Mapped[bool] = mapped_column(Boolean, default=False)
    description: Mapped[str] = mapped_column(Text, default="")
    persona: Mapped[str] = mapped_column(String(50), default="IssueResolver")
    model_name: Mapped[str] = mapped_column(String(50), default="gemini-3.7-flash")
    status: Mapped[str] = mapped_column(String(30), default="QUEUED")
    # QUEUED, INITIALIZING, RUNNING, AWAITING_APPROVAL, AWAITING_INPUT, IDLE, COMPLETED, FAILED, CANCELLED
    
    repo_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    repo_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    target_branch: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    commit_sha: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    sandbox_status: Mapped[str] = mapped_column(String(50), default="NONE")  # NONE, PROVISIONING, ACTIVE, DESTROYED
    
    workspace_path: Mapped[str] = mapped_column(String(500), default="/workspaces")
    git_branch: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    total_tokens: Mapped[int] = mapped_column(Integer, default=0)
    result_summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    is_subsession: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    parent_task_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=True, index=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=get_utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=get_utc_now, onupdate=get_utc_now)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    event: Mapped[Optional["EventModel"]] = relationship("EventModel", back_populates="tasks")
    messages: Mapped[List["TaskMessageModel"]] = relationship("TaskMessageModel", back_populates="task", cascade="all, delete-orphan")
    logs: Mapped[List["TaskLogModel"]] = relationship("TaskLogModel", back_populates="task", cascade="all, delete-orphan")
    approvals: Mapped[List["TaskApprovalModel"]] = relationship("TaskApprovalModel", back_populates="task", cascade="all, delete-orphan")
    diffs: Mapped[List["TaskDiffModel"]] = relationship("TaskDiffModel", back_populates="task", cascade="all, delete-orphan")
    prs: Mapped[List["TaskPRModel"]] = relationship("TaskPRModel", back_populates="task", cascade="all, delete-orphan")
    
    subsessions: Mapped[List["TaskModel"]] = relationship(
        "TaskModel",
        back_populates="parent_task",
        cascade="all, delete-orphan",
        foreign_keys=[parent_task_id]
    )
    parent_task: Mapped[Optional["TaskModel"]] = relationship(
        "TaskModel",
        back_populates="subsessions",
        remote_side=[id],
        foreign_keys=[parent_task_id]
    )


class TaskPRModel(Base):
    __tablename__ = "task_prs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    task_id: Mapped[str] = mapped_column(String(36), ForeignKey("tasks.id"), nullable=False)
    pr_number: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    author: Mapped[str] = mapped_column(String(100), default="")
    head_branch: Mapped[str] = mapped_column(String(200), default="")
    base_branch: Mapped[str] = mapped_column(String(200), default="main")
    html_url: Mapped[str] = mapped_column(String(500), default="")
    status: Mapped[str] = mapped_column(String(50), default="OPEN")  # OPEN, REVIEWING, TESTS_PASSING, TESTS_FAILED, MERGED, CLOSED
    worktree_path: Mapped[str] = mapped_column(String(300), default="")  # e.g. "prs/pr-104"
    diff_stats: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict)
    review_summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    test_output: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    body: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_session_scoped: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=get_utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=get_utc_now, onupdate=get_utc_now)

    task: Mapped["TaskModel"] = relationship("TaskModel", back_populates="prs")


class TaskMessageModel(Base):
    __tablename__ = "task_messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    task_id: Mapped[str] = mapped_column(String(36), ForeignKey("tasks.id"), nullable=False)
    sender: Mapped[str] = mapped_column(String(30), nullable=False)  # user, agent, system
    content: Mapped[str] = mapped_column(Text, nullable=False)
    thought: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # Gemini 3.7 Flash reasoning
    tokens: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=get_utc_now)

    task: Mapped["TaskModel"] = relationship("TaskModel", back_populates="messages")


class TaskLogModel(Base):
    __tablename__ = "task_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    task_id: Mapped[str] = mapped_column(String(36), ForeignKey("tasks.id"), nullable=False)
    tool_name: Mapped[str] = mapped_column(String(100), nullable=False)
    tool_input: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict)
    tool_output: Mapped[str] = mapped_column(Text, default="")
    exit_code: Mapped[int] = mapped_column(Integer, default=0)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=get_utc_now)

    task: Mapped["TaskModel"] = relationship("TaskModel", back_populates="logs")


class TaskApprovalModel(Base):
    __tablename__ = "task_approvals"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    task_id: Mapped[str] = mapped_column(String(36), ForeignKey("tasks.id"), nullable=False)
    action_type: Mapped[str] = mapped_column(String(100), nullable=False)  # create_pull_request, git_push, merge_pr
    action_details: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(30), default="PENDING")  # PENDING, APPROVED, REJECTED
    feedback: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=get_utc_now)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    task: Mapped["TaskModel"] = relationship("TaskModel", back_populates="approvals")


class TaskDiffModel(Base):
    __tablename__ = "task_diffs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    task_id: Mapped[str] = mapped_column(String(36), ForeignKey("tasks.id"), nullable=False)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    diff_content: Mapped[str] = mapped_column(Text, nullable=False)
    additions: Mapped[int] = mapped_column(Integer, default=0)
    deletions: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=get_utc_now)

    task: Mapped["TaskModel"] = relationship("TaskModel", back_populates="diffs")


class AutomationRuleModel(Base):
    __tablename__ = "automation_rules"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    source: Mapped[str] = mapped_column(String(50), nullable=False)  # github, sentry, appsignal, slack
    event_type: Mapped[str] = mapped_column(String(100), nullable=False)  # pull_request.opened, pull_request.synchronize, issue_comment.created, etc.
    repo_filter: Mapped[str] = mapped_column(String(200), default="*")
    persona: Mapped[str] = mapped_column(String(50), default="CodeReviewer")
    action: Mapped[str] = mapped_column(String(50), default="spawn_task")  # spawn_task, awaken_session
    auto_post_comment: Mapped[bool] = mapped_column(Boolean, default=True)
    require_approval: Mapped[bool] = mapped_column(Boolean, default=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=get_utc_now)


class RepositoryConfigModel(Base):
    __tablename__ = "repository_configs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    name: Mapped[str] = mapped_column(String(100), nullable=False)                # e.g. "payment-service"
    full_name: Mapped[str] = mapped_column(String(200), unique=True, index=True) # e.g. "acme/payment-service"
    clone_url: Mapped[str] = mapped_column(String(500), nullable=False)
    default_branch: Mapped[str] = mapped_column(String(100), default="main")
    
    # Encrypted Credential Vault
    encrypted_token: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    auth_provider: Mapped[str] = mapped_column(String(50), default="github")
    
    # Cached Codebase & Architecture Profile
    tech_stack: Mapped[List[str]] = mapped_column(JSON, default=list)            # ["Elixir", "Phoenix", "Oban"] or ["Python", "FastAPI"]
    test_command: Mapped[Optional[str]] = mapped_column(String(200), nullable=True, default="")
    manifest_cache: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict)
    
    # Status & Timestamps
    status: Mapped[str] = mapped_column(String(50), default="CONNECTED")         # CONNECTED, AUTH_REQUIRED, UNREACHABLE
    last_synced_at: Mapped[datetime] = mapped_column(DateTime, default=get_utc_now)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=get_utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=get_utc_now, onupdate=get_utc_now)


class DocPageCacheModel(Base):
    __tablename__ = "doc_pages_cache"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)                 # Hash of url
    url: Mapped[str] = mapped_column(String(500), unique=True, index=True)
    domain: Mapped[str] = mapped_column(String(200), index=True)                 # e.g. "doc.arroyo.dev"
    title: Mapped[str] = mapped_column(String(300), default="")
    content_markdown: Mapped[str] = mapped_column(Text, default="")
    headings_json: Mapped[str] = mapped_column(Text, default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=get_utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=get_utc_now, onupdate=get_utc_now)

