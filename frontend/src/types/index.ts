export type TaskStatus = 
  | 'QUEUED'
  | 'INITIALIZING'
  | 'RUNNING'
  | 'AWAITING_APPROVAL'
  | 'AWAITING_INPUT'
  | 'IDLE'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface TaskMessage {
  id: string;
  task_id: string;
  sender: 'user' | 'agent' | 'system';
  content: string;
  thought?: string;
  tokens?: number;
  created_at: string;
  isOptimistic?: boolean;
  isStreaming?: boolean;
}

export interface StreamStartEvent {
  task_id: string;
  stream_id: string;
  stream_type: 'thought' | 'message';
  sender: 'agent' | 'system';
  timestamp: string;
}

export interface StreamChunkEvent {
  task_id: string;
  stream_id: string;
  stream_type: 'thought' | 'message';
  delta: string;
  accumulated: string;
}

export interface StreamEndEvent {
  task_id: string;
  stream_id: string;
  stream_type: 'thought' | 'message';
  final_content: string;
  tokens?: number;
  timestamp: string;
}

export interface TaskLog {
  id: string;
  task_id: string;
  tool_name: string;
  tool_input: Record<string, any>;
  tool_output: string;
  exit_code: number;
  duration_ms: number;
  created_at: string;
  isRunning?: boolean;
}

export interface TaskApproval {
  id: string;
  task_id: string;
  action_type: string;
  action_details: Record<string, any>;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  feedback?: string;
  created_at: string;
  resolved_at?: string;
}

export interface TaskDiff {
  id: string;
  task_id: string;
  file_path: string;
  diff_content: string;
  additions: number;
  deletions: number;
  created_at: string;
}

export interface TaskPR {
  id?: string;
  task_id: string;
  pr_number: number;
  title: string;
  author: string;
  head_branch: string;
  base_branch: string;
  html_url: string;
  status: 'OPEN' | 'REVIEWING' | 'TESTS_PASSING' | 'TESTS_FAILED' | 'MERGED' | 'CLOSED';
  worktree_path: string;
  diff_stats?: {
    changed_files?: number;
    additions?: number;
    deletions?: number;
    files?: string[];
  };
  review_summary?: string;
  test_output?: string;
  body?: string;
  is_session_scoped?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface Task {
  id: string;
  session_key?: string;
  event_id?: string;
  title: string;
  custom_title?: boolean;
  description: string;
  persona: string;
  model_name: string;
  status: TaskStatus;
  repo_name?: string;
  repo_url?: string;
  target_branch?: string;
  commit_sha?: string;
  sandbox_status?: 'NONE' | 'PROVISIONING' | 'ACTIVE' | 'DESTROYED' | 'AUTH_REQUIRED' | 'CLONE_FAILED';
  workspace_path: string;
  git_branch?: string;
  total_tokens?: number;
  result_summary?: string;
  is_subsession?: boolean;
  parent_task_id?: string | null;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  messages?: TaskMessage[];
  logs?: TaskLog[];
  active_tool?: { tool_name: string; tool_input: Record<string, any>; timestamp?: string } | null;
  approvals?: TaskApproval[];
  diffs?: TaskDiff[];
  prs?: TaskPR[];
}

export interface AutomationRule {
  id: string;
  name: string;
  source: string;
  event_type: string;
  repo_filter: string;
  persona: string;
  action: 'spawn_task' | 'awaken_session';
  auto_post_comment: boolean;
  require_approval: boolean;
  enabled: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface EventItem {
  id: string;
  source: string;
  event_type: string;
  payload: Record<string, any>;
  signature_valid: boolean;
  status: string;
  created_at: string;
}

export interface Integration {
  id: string;
  name: string;
  description: string;
  configured: boolean;
  auth_type: string;
  skills: string[];
  icon: string;
}

export interface SkillCatalogItem {
  id: string;
  name: string;
  path: string;
  description: string;
  tools: string[];
  status: 'ACTIVE' | 'AUTH_REQUIRED';
  category: string;
}

export interface WebhookEndpoint {
  id: string;
  provider: string;
  name: string;
  path: string;
  method: string;
  secret_configured: boolean;
  events: string[];
  description: string;
}


export interface RepositoryConfig {
  id: string;
  name: string;
  full_name: string;
  clone_url: string;
  default_branch: string;
  auth_provider: string;
  has_token: boolean;
  masked_token?: string;
  tech_stack: string[];
  test_command: string;
  manifest_cache?: Record<string, any>;
  status: 'CONNECTED' | 'AUTH_REQUIRED' | 'UNREACHABLE';
  last_synced_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface PolicyMap {
  [action_type: string]: 'auto' | 'require_approval' | 'disabled';
}

export interface WebSocketEvent {
  type: string;
  data: any;
}

export interface PRCommentItem {
  id: string;
  raw_id?: number;
  type: 'conversation' | 'code_comment' | 'review';
  author: string;
  author_avatar?: string;
  author_association?: string;
  body: string;
  created_at?: string;
  updated_at?: string;
  html_url?: string;
  reactions?: Record<string, number>;
  path?: string;
  line?: number;
  original_line?: number;
  diff_hunk?: string;
  commit_id?: string;
  in_reply_to_id?: number | null;
  review_state?: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED';
}

export interface LinearState {
  id: string;
  name: string;
  color: string;
  type?: string;
}

export interface LinearUser {
  id: string;
  name: string;
  displayName?: string;
  avatarUrl?: string;
  email?: string;
}

export interface LinearLabel {
  id: string;
  name: string;
  color: string;
}

export interface LinearComment {
  id: string;
  body: string;
  createdAt: string;
  user?: LinearUser;
}

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  priority: number;
  priorityLabel?: string;
  url: string;
  createdAt: string;
  updatedAt?: string;
  state: LinearState;
  assignee?: LinearUser;
  creator?: LinearUser;
  team?: {
    id: string;
    name: string;
    key: string;
    states?: { nodes: LinearState[] };
  };
  project?: {
    id: string;
    name: string;
  };
  labels?: { nodes: LinearLabel[] } | LinearLabel[];
  comments?: { nodes: LinearComment[] } | LinearComment[];
}

export interface WorkspacePreviewInfo {
  has_preview: boolean;
  type?: 'static' | 'dev_server' | null;
  entry_point?: string | null;
  title?: string | null;
  assets_count?: number;
  available_entry_points?: string[];
  preview_url?: string | null;
}

