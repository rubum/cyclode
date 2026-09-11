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

export interface Task {
  id: string;
  session_key?: string;
  event_id?: string;
  title: string;
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
  total_tokens: number;
  result_summary?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  messages?: TaskMessage[];
  logs?: TaskLog[];
  approvals?: TaskApproval[];
  diffs?: TaskDiff[];
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

