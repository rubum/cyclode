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
    
    created_at: Mapped[datetime] = mapped_column(DateTime, default=get_utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=get_utc_now, onupdate=get_utc_now)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    event: Mapped[Optional["EventModel"]] = relationship("EventModel", back_populates="tasks")
    messages: Mapped[List["TaskMessageModel"]] = relationship("TaskMessageModel", back_populates="task", cascade="all, delete-orphan")
    logs: Mapped[List["TaskLogModel"]] = relationship("TaskLogModel", back_populates="task", cascade="all, delete-orphan")
    approvals: Mapped[List["TaskApprovalModel"]] = relationship("TaskApprovalModel", back_populates="task", cascade="all, delete-orphan")
    diffs: Mapped[List["TaskDiffModel"]] = relationship("TaskDiffModel", back_populates="task", cascade="all, delete-orphan")


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
