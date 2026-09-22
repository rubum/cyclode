import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { 
  Send, 
  Sparkles, 
  Terminal, 
  CheckCircle2, 
  ChevronDown, 
  ChevronRight, 
  ShieldAlert, 
  User, 
  ArrowRight, 
  GitPullRequest, 
  GitCommit,
  Bug, 
  Activity, 
  FileCode2, 
  Code2, 
  Pencil, 
  RotateCcw, 
  Copy, 
  Check, 
  Square, 
  Zap, 
  X,
  PanelLeftClose,
  PanelLeft,
  Box,
  Coins,
  FolderGit2,
  ExternalLink,
  Loader2,
  Play,
  LayoutGrid,
  Folder,
  Search,
  Globe,
  Link2,
  GitBranch,
  RefreshCw,
  Brain,
  Eye,
  AlertCircle,
  Clock,
  HelpCircle,
  ListOrdered,
  Circle,
  Bot,
  Cpu,
  Undo2,
  ShieldCheck,
  Compass,
  Plus
} from 'lucide-react';
import { Task, TaskMessage, TaskLog, RepositoryConfig, TaskPR, WorkspacePreviewInfo, TaskPlan, LayoutPreset } from '../../types';
import { MarkdownRenderer } from '../Common/MarkdownRenderer';
import { FormattedLogView } from '../Common/FormattedLogView';
import { SandboxInspectorModal } from '../Sandbox/SandboxInspectorModal';

const API_BASE = import.meta.env.VITE_API_URL || '';

export function extractPlanHighlightsFromMarkdown(text: string): { title: string; overview: string; phases: string[] } {
  const lines = text.split('\n').map(l => l.trim());
  let title = 'Implementation Plan';
  let overview = '';
  const phases: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('# Implementation Plan:') || line.startsWith('# Plan:') || line.startsWith('# ')) {
      title = line.replace(/^#+\s*(?:Implementation Plan:\s*)?/, '').trim();
    } else if (line.startsWith('Phase ') || line.startsWith('### Phase ') || /^\*{0,2}Phase\s+\d+/i.test(line)) {
      const cleanPhase = line.replace(/^###\s*/, '').replace(/\*+/g, '').replace(/:\s*$/, '').trim();
      if (!phases.includes(cleanPhase)) {
        phases.push(cleanPhase);
      }
    } else if (!overview && line && !line.startsWith('#') && !line.startsWith('-') && !line.startsWith('*') && !line.startsWith('Objective:')) {
      overview = line;
    }
  }

  return { title, overview, phases: phases.slice(0, 6) };
}

export const getToolActionInfo = (
  toolName: string,
  toolInput: Record<string, any> = {},
  isRunning: boolean = false
) => {
  const input = toolInput || {};
  switch (toolName) {
    case 'edit_file':
      return {
        icon: Pencil,
        verb: isRunning ? 'Editing' : 'Edited',
        target: input.file_path || input.path || 'file',
        colorClass: 'text-onedark-green',
        badgeBg: 'bg-onedark-green/10',
        badgeBorder: 'border-onedark-green/30',
      };
    case 'read_file':
      return {
        icon: FileCode2,
        verb: isRunning ? 'Reading' : 'Read',
        target: input.file_path || input.path || 'file',
        colorClass: 'text-onedark-accent',
        badgeBg: 'bg-onedark-accent/10',
        badgeBorder: 'border-onedark-accent/30',
      };
    case 'run_command':
      return {
        icon: Terminal,
        verb: isRunning ? 'Running' : 'Ran',
        target: input.command ? `$ ${input.command}` : 'command',
        colorClass: 'text-onedark-yellow',
        badgeBg: 'bg-onedark-yellow/10',
        badgeBorder: 'border-onedark-yellow/30',
      };
    case 'list_dir':
      return {
        icon: Folder,
        verb: isRunning ? 'Listing' : 'Listed',
        target: input.subpath || input.directory || '.',
        colorClass: 'text-onedark-folder',
        badgeBg: 'bg-onedark-folder/10',
        badgeBorder: 'border-onedark-folder/30',
      };
    case 'grep_search':
    case 'search_code':
      return {
        icon: Search,
        verb: isRunning ? 'Searching' : 'Searched',
        target: input.query ? `"${input.query}"` : 'codebase',
        colorClass: 'text-onedark-yellow',
        badgeBg: 'bg-onedark-yellow/10',
        badgeBorder: 'border-onedark-yellow/30',
      };
    case 'find_symbols':
      return {
        icon: Code2,
        verb: isRunning ? 'Finding symbols' : 'Found symbols',
        target: input.name_pattern ? `"${input.name_pattern}"` : 'symbols',
        colorClass: 'text-onedark-purple',
        badgeBg: 'bg-onedark-purple/10',
        badgeBorder: 'border-onedark-purple/30',
      };
    case 'search_web':
      return {
        icon: Globe,
        verb: isRunning ? 'Searching web for' : 'Web searched',
        target: input.query ? `"${input.query}"` : 'web',
        colorClass: 'text-onedark-accent',
        badgeBg: 'bg-onedark-accent/10',
        badgeBorder: 'border-onedark-accent/30',
      };
    case 'fetch_url':
      return {
        icon: Link2,
        verb: isRunning ? 'Fetching' : 'Fetched',
        target: input.url || 'URL',
        colorClass: 'text-onedark-accent',
        badgeBg: 'bg-onedark-accent/10',
        badgeBorder: 'border-onedark-accent/30',
      };
    case 'git_clone':
    case 'connect_repository':
      return {
        icon: GitBranch,
        verb: isRunning ? 'Cloning' : 'Cloned',
        target: input.repo_url || input.url || 'repository',
        colorClass: 'text-onedark-purple',
        badgeBg: 'bg-onedark-purple/10',
        badgeBorder: 'border-onedark-purple/30',
      };
    case 'tgrep_ast':
      return {
        icon: GitBranch,
        verb: isRunning ? 'Analyzing AST for' : 'Matched AST',
        target: input.pattern ? `"${input.pattern}"` : 'pattern',
        colorClass: 'text-onedark-purple',
        badgeBg: 'bg-onedark-purple/10',
        badgeBorder: 'border-onedark-purple/30',
      };
    case 'get_pull_request_details':
    case 'list_pull_requests':
    case 'create_pull_request':
    case 'post_pull_request_review':
    case 'get_pull_request_diff':
      return {
        icon: GitPullRequest,
        verb: isRunning ? 'Inspecting' : 'Inspected',
        target: input.repository ? `${input.repository} PRs` : 'Pull Requests',
        colorClass: 'text-onedark-green',
        badgeBg: 'bg-onedark-green/10',
        badgeBorder: 'border-onedark-green/30',
      };
    default:
      return {
        icon: Zap,
        verb: isRunning ? 'Executing' : 'Executed',
        target: toolName,
        colorClass: 'text-onedark-accent',
        badgeBg: 'bg-onedark-accent/10',
        badgeBorder: 'border-onedark-accent/30',
      };
  }
};

interface ChatCanvasProps {
  task: Task | null;
  repositories?: RepositoryConfig[];
  onSendMessage: (content: string, modelName?: string) => void;
  onApprove: (feedback?: string) => void;
  onReject: (feedback?: string) => void;
  onNewChatWithPrompt?: (prompt: string, persona: string, modelName?: string) => void;
  onEditMessage?: (messageId: string, newContent: string) => void;
  onRetryTask?: (fromMessageId?: string) => void;
  onResetTurn?: (turnIndex?: number) => void;
  onStopTask?: () => void;
  onUpdateTaskTitle?: (taskId: string, newTitle: string) => void;
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  currentPreset?: LayoutPreset;
  onSetPreset?: (preset: LayoutPreset) => void;
  onOpenSandboxModal?: () => void;
  onSelectAuxTab?: (tab: 'docs' | 'files' | 'prs' | 'activity' | 'subagents' | 'event' | 'preview') => void;
  onOpenPreview?: (url: string, title?: string) => void;
  onOpenPlan?: (taskId?: string, plan?: TaskPlan | null) => void;
  onNavigateToRepos?: () => void;
}

interface ConversationTurn {
  id: string;
  userMessage?: {
    id: string;
    content: string;
    tokens?: number;
    created_at?: string;
    isOptimistic?: boolean;
  };
  thoughts: { id: string; thought: string; created_at: string; tokens?: number; isStreaming?: boolean }[];
  logs: TaskLog[];
  agentMessages: TaskMessage[];
  plan?: TaskPlan | null;
  isLatest: boolean;
}

const isInternalNotice = (text?: string): boolean => {
  if (!text) return true;
  const lower = text.toLowerCase().trim();
  return (
    lower.startsWith('connecting to gemini') ||
    lower.startsWith('live gemini api unavailable') ||
    lower.startsWith('api notice') ||
    lower.startsWith('google ai studio quota notice') ||
    lower.startsWith('gemini execution notice')
  );
};

const estimateTokens = (text?: string): number => {
  if (!text) return 0;
  return Math.max(1, Math.round(text.length / 4));
};

const maskSecretsInText = (text?: string): string => {
  if (!text) return '';
  return text
    .replace(/(ghp_[A-Za-z0-9_]{4})[A-Za-z0-9_]+/g, '$1••••••••')
    .replace(/(github_pat_[A-Za-z0-9_]{4})[A-Za-z0-9_]+/g, '$1••••••••')
    .replace(/(xoxb-[A-Za-z0-9-]{4})[A-Za-z0-9-]+/g, '$1••••••••')
    .replace(/(xoxp-[A-Za-z0-9-]{4})[A-Za-z0-9-]+/g, '$1••••••••')
    .replace(/(AIzaSy[A-Za-z0-9_-]{4})[A-Za-z0-9_-]+/g, '$1••••••••')
    .replace(/(appsignal_[A-Za-z0-9_-]{4})[A-Za-z0-9_-]+/g, '$1••••••••');
};

const renderHighlightedInputText = (text: string) => {
  if (!text) return null;
  const mentionRegex = /(@[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)?)/g;
  const parts = text.split(mentionRegex);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('@') && part.length > 1) {
          return (
            <span
              key={i}
              className="font-bold text-onedark-yellow font-mono"
            >
              {part}
            </span>
          );
        }
        return <span key={i} className="text-onedark-fgBright">{part}</span>;
      })}
    </>
  );
};

const renderStyledMessageContent = (text?: string) => {
  if (!text) return null;
  const masked = maskSecretsInText(text);
  const mentionRegex = /(@[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)?)/g;
  const parts = masked.split(mentionRegex);

  return parts.map((part, i) => {
    if (part.startsWith('@') && part.length > 1) {
      return (
        <span
          key={i}
          className="font-bold text-onedark-yellow font-mono hover:underline cursor-pointer"
        >
          {part}
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });
};

interface InquiryCardProps {
  taskId: string;
  approval: any;
  onResolved: () => void;
}

const InquiryCard: React.FC<InquiryCardProps> = ({ taskId, approval, onResolved }) => {
  const details = approval.action_details || {};
  const question = details.question || 'Please specify your preference:';
  const options: Array<{ id: string; label: string; description?: string }> = details.options || [];
  const defaultOptionId = details.default_option_id || (options[0]?.id ?? '');
  const totalSeconds = details.timeout_seconds || 25;
  const expiresAt = details.expires_at ? new Date(details.expires_at).getTime() : Date.now() + totalSeconds * 1000;

  const [selectedId, setSelectedId] = useState<string>(defaultOptionId);
  const [customText, setCustomText] = useState<string>('');
  const [remainingSeconds, setRemainingSeconds] = useState<number>(() => {
    return Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      const diff = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      setRemainingSeconds(diff);
    }, 500);
    return () => clearInterval(timer);
  }, [expiresAt]);

  const handleSubmit = async (optId?: string, customResp?: string) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await fetch(`${API_BASE}/api/tasks/${taskId}/inquiry/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selected_option_id: optId || selectedId,
          custom_response: customResp || (customText.trim() ? customText.trim() : undefined),
        }),
      });
      onResolved();
    } catch (e) {
      console.error('Failed to submit inquiry response:', e);
    } finally {
      setSubmitting(false);
    }
  };

  const defaultOption = options.find((o) => o.id === defaultOptionId);
  const progressPercent = Math.min(100, Math.max(0, (remainingSeconds / totalSeconds) * 100));

  return (
    <div className="rounded-xl border border-onedark-border bg-onedark-darker/95 p-4 sm:p-5 space-y-3.5 shadow-md overflow-hidden relative transition-all">
      {/* Top Animated Countdown Bar */}
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-onedark-surface/60">
        <div
          className="h-full bg-onedark-accent/60 transition-all duration-500 ease-linear"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between pt-0.5">
        <div className="flex items-center space-x-2.5">
          <div className="w-5.5 h-5.5 rounded-md bg-onedark-accent/10 border border-onedark-accent/20 flex items-center justify-center text-onedark-accent flex-shrink-0">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <div>
            <span className="text-xs font-semibold text-onedark-fgBright">
              Interactive Inquiry & Configuration
            </span>
            <div className="text-[10px] text-onedark-muted font-mono">
              Autonomous Assistant Decision Point
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <span
            className={`px-2 py-0.5 rounded-full text-[10.5px] font-mono border flex items-center space-x-1.5 ${
              remainingSeconds <= 5
                ? 'bg-onedark-red/10 border-onedark-red/30 text-onedark-red animate-pulse'
                : 'bg-onedark-surface border-onedark-borderSubtle text-onedark-muted'
            }`}
          >
            <Clock className="w-3 h-3" />
            <span>
              {remainingSeconds > 0
                ? `Auto-proceeding in ${remainingSeconds}s`
                : 'Auto-proceeding...'}
            </span>
          </span>
        </div>
      </div>

      {/* Question Text */}
      <div className="p-3 rounded-lg bg-onedark-surface/30 border border-onedark-borderSubtle text-xs text-onedark-fg font-sans leading-relaxed">
        <MarkdownRenderer content={question} />
      </div>

      {/* Selectable Options Grid */}
      {options.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {options.map((option) => {
            const isSelected = selectedId === option.id;
            const isDefault = option.id === defaultOptionId;

            return (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  setSelectedId(option.id);
                  handleSubmit(option.id);
                }}
                disabled={submitting}
                className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer select-none relative group ${
                  isSelected
                    ? 'bg-onedark-accent/10 border-onedark-accent/50 text-onedark-fgBright shadow-xs'
                    : 'bg-onedark-surface/20 hover:bg-onedark-surface/60 border-onedark-borderSubtle text-onedark-fg'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex items-center space-x-1.5 flex-wrap">
                      <span className="text-xs font-medium">{option.label}</span>
                      {isDefault && (
                        <span className="px-1.5 py-0.2 rounded bg-onedark-surface border border-onedark-borderSubtle text-onedark-muted text-[9px] font-mono font-medium">
                          Recommended
                        </span>
                      )}
                    </div>
                    {option.description && (
                      <p className="text-[10.5px] text-onedark-muted line-clamp-2 leading-relaxed">
                        {option.description}
                      </p>
                    )}
                  </div>
                  <div
                    className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center flex-shrink-0 mt-0.5 ${
                      isSelected
                        ? 'border-onedark-accent bg-onedark-accent text-onedark-darker'
                        : 'border-onedark-muted/30 group-hover:border-onedark-muted'
                    }`}
                  >
                    {isSelected && <Check className="w-2 h-2 stroke-[3]" />}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Custom Write-In Input Field */}
      <div className="flex items-center space-x-2 pt-1">
        <input
          type="text"
          value={customText}
          onChange={(e) => setCustomText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (customText.trim()) handleSubmit(selectedId, customText.trim());
            }
          }}
          placeholder="Or write a custom answer / instruction..."
          className="flex-1 bg-onedark-surface/40 border border-onedark-borderSubtle rounded-xl px-3.5 py-2 text-xs text-onedark-fgBright font-sans focus:outline-none focus:border-onedark-accent placeholder-onedark-muted"
        />
        <button
          type="button"
          onClick={() => {
            if (customText.trim()) handleSubmit(selectedId, customText.trim());
            else handleSubmit(selectedId);
          }}
          disabled={submitting}
          className="px-3.5 py-2 rounded-xl bg-onedark-accent hover:bg-onedark-accent/90 text-onedark-darker font-bold text-xs font-sans flex items-center space-x-1.5 transition-all cursor-pointer shadow-sm disabled:opacity-50"
        >
          {submitting ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Send className="w-3.5 h-3.5" />
          )}
          <span>Proceed</span>
        </button>
      </div>

      {defaultOption && (
        <div className="text-[10.5px] text-onedark-muted font-mono flex items-center justify-between pt-1 border-t border-onedark-borderSubtle">
          <span>
            Default: <strong className="text-onedark-fg">{defaultOption.label}</strong>
          </span>
          <button
            type="button"
            onClick={() => handleSubmit(defaultOptionId)}
            className="text-onedark-accent hover:underline cursor-pointer"
          >
            Accept default immediately ➔
          </button>
        </div>
      )}
    </div>
  );
};

export const ChatCanvas: React.FC<ChatCanvasProps> = ({
  task,
  repositories: propRepositories,
  onSendMessage,
  onApprove,
  onReject,
  onNewChatWithPrompt,
  onEditMessage,
  onRetryTask,
  onResetTurn,
  onStopTask,
  onUpdateTaskTitle,
  isSidebarCollapsed,
  onToggleSidebar,
  currentPreset,
  onSetPreset,
  onOpenSandboxModal,
  onSelectAuxTab,
  onOpenPreview,
  onOpenPlan,
  onNavigateToRepos,
}) => {
  const [inputValue, setInputValue] = useState('');
  const [selectedPersona, setSelectedPersona] = useState('SoftwareEngineer');
  const [selectedModel, setSelectedModel] = useState('auto');
  const [openThoughts, setOpenThoughts] = useState<Record<string, boolean>>({});
  const [userToggledPlans, setUserToggledPlans] = useState<Record<string, boolean>>({});
  const [userToggledActivities, setUserToggledActivities] = useState<Record<string, boolean>>({});
  const [expandedLogIds, setExpandedLogIds] = useState<Record<string, boolean>>({});
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isSandboxModalOpen, setIsSandboxModalOpen] = useState(false);
  const [showScrollBottomBtn, setShowScrollBottomBtn] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState('');
  const [expandedRawPlanMsgIds, setExpandedRawPlanMsgIds] = useState<Record<string, boolean>>({});

  const [localRepos, setLocalRepos] = useState<RepositoryConfig[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState<number>(-1);
  const [selectedMentionIdx, setSelectedMentionIdx] = useState<number>(0);

  const [previewInfo, setPreviewInfo] = useState<WorkspacePreviewInfo | null>(null);

  const checkPreviewStatus = useCallback(async () => {
    if (!task?.id) {
      setPreviewInfo(null);
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/tasks/${task.id}/preview/inspect`);
      if (res.ok) {
        const data = await res.json();
        setPreviewInfo(data);
      }
    } catch {
      // ignore
    }
  }, [task?.id]);

  useEffect(() => {
    checkPreviewStatus();
    const interval = setInterval(checkPreviewStatus, 5000);
    return () => clearInterval(interval);
  }, [checkPreviewStatus]);

  useEffect(() => {
    if (task?.model_name) {
      setSelectedModel(task.model_name);
    }
  }, [task?.id, task?.model_name]);

  const handleStartEditTitle = () => {
    if (!task) return;
    setTitleInput(task.title || '');
    setIsEditingTitle(true);
  };

  const handleCommitTitle = () => {
    if (task && titleInput.trim() && onUpdateTaskTitle) {
      onUpdateTaskTitle(task.id, titleInput.trim());
    }
    setIsEditingTitle(false);
  };

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isAutoScrollEnabledRef = useRef<boolean>(true);
  const scrollRafRef = useRef<number | null>(null);

  const isRunning = task?.status === 'RUNNING' || task?.status === 'INITIALIZING';
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (task?.status === 'RUNNING' || task?.status === 'IDLE' || task?.status === 'COMPLETED' || task?.status === 'FAILED') {
      setIsSubmitting(false);
    }
  }, [task?.status]);

  // Group task messages and logs into sequential conversational turns
  const turns = useMemo(() => {
    if (!task) return [];

    const result: ConversationTurn[] = [];
    const allMessages = task.messages || [];
    const allLogs = task.logs || [];

    // Base initial prompt
    if (task.description) {
      result.push({
        id: 'initial',
        userMessage: {
          id: 'initial',
          content: task.description,
          tokens: estimateTokens(task.description),
          created_at: task.created_at,
        },
        thoughts: [],
        logs: [],
        agentMessages: [],
        isLatest: false,
      });
    }

    // Process all chronological messages
    allMessages.forEach((m) => {
      if (m.sender === 'user') {
        // If it's a new user message turn
        if (result.length === 0 || m.content !== task.description) {
          result.push({
            id: m.id,
            userMessage: {
              id: m.id,
              content: m.content,
              tokens: m.tokens || estimateTokens(m.content),
              created_at: m.created_at,
              isOptimistic: m.isOptimistic,
            },
            thoughts: [],
            logs: [],
            agentMessages: [],
            isLatest: false,
          });
        }
      } else if (m.thought) {
        if (!isInternalNotice(m.thought)) {
          // Add thought to the active turn
          if (result.length === 0) {
            result.push({
              id: 'init-turn',
              thoughts: [],
              logs: [],
              agentMessages: [],
              isLatest: false,
            });
          }
          const currentTurn = result[result.length - 1];
          const existingThoughtIdx = currentTurn.thoughts.findIndex(
            (t) => t.id === m.id || (t.thought.trim() === m.thought.trim() && m.thought.trim().length > 0)
          );
          if (existingThoughtIdx >= 0) {
            currentTurn.thoughts[existingThoughtIdx] = {
              ...currentTurn.thoughts[existingThoughtIdx],
              id: m.id.startsWith('thought-') ? currentTurn.thoughts[existingThoughtIdx].id : m.id,
              thought: m.thought,
              created_at: m.created_at,
              tokens: m.tokens ?? currentTurn.thoughts[existingThoughtIdx].tokens,
              isStreaming: m.isStreaming ?? false,
            };
          } else {
            const lastThought = currentTurn.thoughts[currentTurn.thoughts.length - 1];
            if (!lastThought || lastThought.thought.trim() !== m.thought.trim() || m.isStreaming) {
              currentTurn.thoughts.push({
                id: m.id,
                thought: m.thought,
                created_at: m.created_at,
                tokens: m.tokens,
                isStreaming: m.isStreaming,
              });
            }
          }
        }
      } else {
        // Agent or System message
        if (result.length === 0) {
          result.push({
            id: 'init-turn',
            thoughts: [],
            logs: [],
            agentMessages: [],
            isLatest: false,
          });
        }
        const currentTurn = result[result.length - 1];
        const existingMsgIdx = currentTurn.agentMessages.findIndex((msg) => {
          if (msg.id === m.id) return true;
          if (msg.sender === m.sender && msg.content.trim().length > 0 && m.content.trim().length > 0) {
            if (msg.content.trim() === m.content.trim()) return true;
            if (msg.isStreaming && m.content.trim().startsWith(msg.content.trim())) return true;
            if (m.isStreaming && msg.content.trim().startsWith(m.content.trim())) return true;
          }
          return false;
        });

        if (existingMsgIdx >= 0) {
          currentTurn.agentMessages[existingMsgIdx] = {
            ...currentTurn.agentMessages[existingMsgIdx],
            ...m,
            id: m.id.startsWith('msg-') || m.id.startsWith('stream_') ? currentTurn.agentMessages[existingMsgIdx].id : m.id,
            tokens: m.tokens ?? currentTurn.agentMessages[existingMsgIdx].tokens,
            plan: m.plan || currentTurn.agentMessages[existingMsgIdx].plan,
            isStreaming: m.isStreaming ?? false,
          };
        } else {
          currentTurn.agentMessages.push(m);
        }
      }
    });

    // Distribute logs strictly to the turn during which they executed (per-turn traceability)
    if (result.length > 0) {
      result[result.length - 1].isLatest = true;

      // Pre-compute turn start timestamps for chronological window assignment
      const turnWindows = result.map((turn, idx) => {
        const startTime = turn.userMessage?.created_at
          ? new Date(turn.userMessage.created_at).getTime()
          : (task.created_at ? new Date(task.created_at).getTime() : 0);
        return { idx, turn, startTime };
      });

      allLogs.forEach((log) => {
        // Direct matching if log has a message_id or turn_id
        if ((log as any).message_id) {
          const matchedTurn = result.find((t) => t.userMessage?.id === (log as any).message_id);
          if (matchedTurn) {
            matchedTurn.logs.push(log);
            return;
          }
        }

        const logTime = log.created_at ? new Date(log.created_at).getTime() : 0;
        if (!logTime || turnWindows.length === 1) {
          result[result.length - 1].logs.push(log);
          return;
        }

        // Locate the active turn window for this log
        let targetTurnIdx = 0;
        for (let i = 0; i < turnWindows.length; i++) {
          if (logTime >= turnWindows[i].startTime) {
            targetTurnIdx = i;
          } else {
            break;
          }
        }
        result[targetTurnIdx].logs.push(log);
      });

      // Attach plan to each turn
      result.forEach((turn, idx) => {
        const isLatestTurn = idx === result.length - 1;
        const msgWithPlan = turn.agentMessages.find((m) => !!m.plan);
        if (msgWithPlan?.plan) {
          turn.plan = msgWithPlan.plan;
        } else if (isLatestTurn && task.plan) {
          // If the latest turn is waiting for its own new plan to be generated
          // (i.e. it only has an optimistic user message or is in initial running state, with 0 agent messages and 0 logs)
          // and task.plan is an already completed historical plan, attribute task.plan to the preceding turn.
          const isFreshTurnWaiting = turn.agentMessages.length === 0 && turn.logs.length === 0 && (turn.userMessage?.isOptimistic || task.status === 'RUNNING');
          const planCompleted = task.plan.evaluation && task.plan.evaluation.status !== 'pending';

          if (isFreshTurnWaiting && planCompleted && result.length > 1) {
            // Attribute the completed plan to the preceding turn that actually ran it
            if (!result[result.length - 2].plan) {
              result[result.length - 2].plan = task.plan;
            }
            turn.plan = null;
          } else {
            turn.plan = task.plan;
          }
        }
      });
    }

    return result;
  }, [task]);

  // Handle thought accordions: auto open latest if running, auto collapse when done
  useEffect(() => {
    if (!task) return;
    if (isRunning && turns.length > 0) {
      const latestTurnId = turns[turns.length - 1].id;
      setOpenThoughts((prev) => ({ ...prev, [latestTurnId]: true }));
    } else if (!isRunning) {
      setOpenThoughts({});
    }
  }, [isRunning, task?.status, turns.length]);

  // Global Escape key listener to stop running task
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isRunning) {
        if (onStopTask) {
          e.preventDefault();
          onStopTask();
        }
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isRunning, onStopTask]);

  // Scroll to bottom helper
  const scrollToBottom = useCallback((smooth = true) => {
    const container = scrollContainerRef.current;
    if (!container) return;
    if (smooth) {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    } else {
      container.scrollTop = container.scrollHeight;
    }
  }, []);

  // Handle user manual scroll: detect if user scrolled away from bottom
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    const isAtBottom = distanceFromBottom <= 90;

    isAutoScrollEnabledRef.current = isAtBottom;
    setShowScrollBottomBtn(!isAtBottom);
  }, []);

  // Auto-scroll smoothly ONLY when user has not manually scrolled away
  useEffect(() => {
    if (!isAutoScrollEnabledRef.current || !scrollContainerRef.current) return;

    if (scrollRafRef.current) {
      cancelAnimationFrame(scrollRafRef.current);
    }

    scrollRafRef.current = requestAnimationFrame(() => {
      const container = scrollContainerRef.current;
      if (!container || !isAutoScrollEnabledRef.current) return;

      const targetScrollTop = container.scrollHeight - container.clientHeight;
      const distance = targetScrollTop - container.scrollTop;

      // Avoid layout thrashing if already within 2px of target
      if (Math.abs(distance) <= 2) return;

      container.scrollTop = targetScrollTop;
    });

    return () => {
      if (scrollRafRef.current) {
        cancelAnimationFrame(scrollRafRef.current);
      }
    };
  }, [turns, isRunning, task?.approvals]);

  // Reset scroll and re-enable auto-scroll when task changes
  useEffect(() => {
    if (task?.id) {
      isAutoScrollEnabledRef.current = true;
      setShowScrollBottomBtn(false);
      scrollToBottom(false);
    }
  }, [task?.id, scrollToBottom]);

  const emptyStateTextareaRef = useRef<HTMLTextAreaElement>(null);
  const emptyStateBackdropRef = useRef<HTMLDivElement>(null);
  const chatBackdropRef = useRef<HTMLDivElement>(null);

  const adjustTextareaHeight = useCallback(() => {
    const adjust = (el: HTMLTextAreaElement | null, minH = 36, maxH = 220) => {
      if (!el) return;
      el.style.height = 'auto';
      const scrollHeight = el.scrollHeight;
      const targetHeight = Math.min(Math.max(scrollHeight, minH), maxH);
      el.style.height = `${targetHeight}px`;
    };

    if (task) {
      adjust(textareaRef.current, 36, 220);
    } else {
      adjust(emptyStateTextareaRef.current, 72, 240);
    }
  }, [task]);

  useEffect(() => {
    adjustTextareaHeight();
  }, [inputValue, adjustTextareaHeight]);

  const fetchRepos = useCallback(async () => {
    const apiBase = import.meta.env.VITE_API_URL || '';
    const endpoints = [
      apiBase ? `${apiBase}/api/repositories` : null,
      '/api/repositories',
      'http://localhost:8000/api/repositories',
      'http://127.0.0.1:8000/api/repositories'
    ].filter(Boolean) as string[];
    for (const url of endpoints) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) {
            setLocalRepos(data);
            return;
          }
        }
      } catch {
        // try next endpoint
      }
    }
  }, []);

  useEffect(() => {
    fetchRepos();
  }, [fetchRepos]);

  const effectiveRepos = useMemo(() => {
    const repos = (propRepositories && propRepositories.length > 0) ? propRepositories : localRepos;
    if (repos && repos.length > 0) {
      return repos.filter(r => !r.id?.startsWith('starter-') && !r.full_name?.startsWith('acme/'));
    }
    return [];
  }, [propRepositories, localRepos]);

  const filteredRepos = useMemo(() => {
    if (mentionQuery === null) return [];
    if (!mentionQuery) return effectiveRepos;
    const q = mentionQuery.toLowerCase();
    return effectiveRepos.filter((r) =>
      (r.name && r.name.toLowerCase().includes(q)) ||
      (r.full_name && r.full_name.toLowerCase().includes(q))
    );
  }, [effectiveRepos, mentionQuery]);

  const insertMention = (repoName: string) => {
    if (mentionIndex === -1) return;
    const activeTextarea = (!task ? emptyStateTextareaRef.current : textareaRef.current) || textareaRef.current;
    const pos = (activeTextarea?.selectionStart !== null && activeTextarea?.selectionStart !== undefined)
      ? activeTextarea.selectionStart
      : inputValue.length;

    const before = inputValue.slice(0, mentionIndex);
    const after = inputValue.slice(pos);
    const inserted = `${before}@${repoName} ${after}`;
    setInputValue(inserted);
    setMentionQuery(null);
    setMentionIndex(-1);

    setTimeout(() => {
      if (activeTextarea) {
        const nextPos = mentionIndex + repoName.length + 2;
        activeTextarea.focus();
        activeTextarea.setSelectionRange(nextPos, nextPos);
      }
    }, 10);
  };

  const updateMentionState = (val: string, pos: number) => {
    const textBeforeCursor = val.slice(0, pos);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');

    if (lastAtIndex !== -1) {
      const isStartOrWhitespace = lastAtIndex === 0 || /\s/.test(textBeforeCursor[lastAtIndex - 1]);
      if (isStartOrWhitespace) {
        const query = textBeforeCursor.slice(lastAtIndex + 1);
        if (!/\s/.test(query)) {
          setMentionQuery(query.toLowerCase());
          setMentionIndex(lastAtIndex);
          setSelectedMentionIdx(0);
          if (effectiveRepos.length === 0) {
            fetchRepos();
          }
          return;
        }
      }
    }

    setMentionQuery(null);
    setMentionIndex(-1);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    const pos = (typeof e.target.selectionStart === 'number' && e.target.selectionStart > 0)
      ? e.target.selectionStart
      : val.length;
    setInputValue(val);
    updateMentionState(val, pos);
  };

  const handleCursorMove = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const target = e.currentTarget;
    const val = target.value;
    const pos = (typeof target.selectionStart === 'number' && target.selectionStart > 0)
      ? target.selectionStart
      : val.length;
    updateMentionState(val, pos);
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setMentionQuery(null);
    setMentionIndex(-1);
    const trimmed = inputValue.trim();
    if (!trimmed || isSubmitting) return;

    isAutoScrollEnabledRef.current = true;
    setShowScrollBottomBtn(false);
    scrollToBottom(true);
    setIsSubmitting(true);

    try {
      if (task) {
        await onSendMessage(trimmed, selectedModel);
      } else if (onNewChatWithPrompt) {
        await onNewChatWithPrompt(trimmed, selectedPersona, selectedModel);
      }
      setInputValue('');
    } catch (err) {
      console.error('Error submitting message:', err);
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery !== null) {
      if (filteredRepos.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedMentionIdx((prev) => (prev + 1) % filteredRepos.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedMentionIdx((prev) => (prev - 1 + filteredRepos.length) % filteredRepos.length);
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          const selected = filteredRepos[selectedMentionIdx] || filteredRepos[0];
          if (selected) {
            insertMention(selected.full_name || selected.name);
          }
          return;
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionQuery(null);
        setMentionIndex(-1);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const renderMentionMenu = (positionClasses: string) => {
    if (mentionQuery === null) return null;

    return (
      <div className={`absolute ${positionClasses} w-full max-w-sm max-h-64 overflow-y-auto bg-onedark-surface border border-onedark-border rounded-xl shadow-2xl z-50 p-1.5 font-sans text-xs`}>
        <div className="px-2.5 py-1.5 text-[10px] font-semibold text-onedark-muted uppercase tracking-wider flex items-center justify-between border-b border-onedark-borderSubtle mb-1">
          <span>Registered Repositories</span>
          {filteredRepos.length > 0 && (
            <span className="text-onedark-accent font-mono text-[9px]">↑↓ to navigate · ↵ select</span>
          )}
        </div>
        {filteredRepos.length === 0 ? (
          <div className="p-3 text-center space-y-1.5 text-onedark-muted">
            <p className="text-[11px]">
              {effectiveRepos.length === 0 ? 'No repositories registered in Vault' : `No repositories matching "@${mentionQuery}"`}
            </p>
            {onNavigateToRepos && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setMentionQuery(null);
                  setMentionIndex(-1);
                  onNavigateToRepos();
                }}
                className="text-xs text-onedark-accent hover:underline font-semibold cursor-pointer"
              >
                + Connect Repository in Vault
              </button>
            )}
          </div>
        ) : (
          filteredRepos.map((repo, idx) => (
            <button
              key={repo.id || repo.full_name}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insertMention(repo.full_name || repo.name)}
              onMouseEnter={() => setSelectedMentionIdx(idx)}
              className={`w-full text-left px-2.5 py-2 rounded-lg flex items-center space-x-2.5 transition-colors cursor-pointer ${
                selectedMentionIdx === idx
                  ? 'bg-onedark-accent/20 text-onedark-accent font-medium'
                  : 'text-onedark-fg hover:bg-onedark-darker/60'
              }`}
            >
              <FolderGit2 className="w-3.5 h-3.5 text-onedark-folder flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-semibold truncate flex items-center space-x-1.5">
                  <span>@{repo.full_name || repo.name}</span>
                  {repo.tech_stack && repo.tech_stack.length > 0 && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-onedark-darker text-onedark-muted border border-onedark-borderSubtle">
                      {repo.tech_stack[0]}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-onedark-muted truncate">{repo.clone_url || repo.full_name}</div>
              </div>
            </button>
          ))
        )}
      </div>
    );
  };

  const handleCopyText = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const startEditing = (messageId: string, currentContent: string) => {
    setEditingMessageId(messageId);
    setEditValue(currentContent);
  };

  const cancelEditing = () => {
    setEditingMessageId(null);
    setEditValue('');
  };

  const handleSaveEdit = (messageId: string) => {
    const trimmed = editValue.trim();
    if (!trimmed) return;
    if (onEditMessage) {
      onEditMessage(messageId, trimmed);
    }
    setEditingMessageId(null);
    setEditValue('');
  };

  const starterTemplates = useMemo(() => {
    if (effectiveRepos.length > 0) {
      const primaryRepo = effectiveRepos[0];
      const repoTag = `@${primaryRepo.full_name || primaryRepo.name}`;
      return [
        {
          title: 'Audit Architecture & Security',
          description: `Analyze component architecture, dependencies, and potential security vulnerabilities in ${repoTag}.`,
          prompt: `Perform a comprehensive architectural review and dependency security audit on ${repoTag}. Highlight circular dependencies, outdated packages, and potential performance bottlenecks.`,
          persona: 'SoftwareEngineer',
          icon: ShieldCheck,
          color: 'text-onedark-accent',
          bgColor: 'bg-onedark-accent/10',
          badge: repoTag,
        },
        {
          title: 'Generate Test Coverage',
          description: `Discover untested edge cases and generate isolated test suites for ${repoTag}.`,
          prompt: `Inspect ${repoTag} for missing unit and integration test coverage. Generate resilient test cases and verify them in the sandbox.`,
          persona: 'SoftwareEngineer',
          icon: CheckCircle2,
          color: 'text-onedark-green',
          bgColor: 'bg-onedark-green/10',
          badge: repoTag,
        },
        {
          title: 'Automated Code Review',
          description: `Review recent changes or branch diffs in ${repoTag} for null safety and regressions.`,
          prompt: `Review the latest branch changes in ${repoTag}. Check edge cases, null safety, code style, and verify that test suites pass.`,
          persona: 'CodeReviewer',
          icon: GitPullRequest,
          color: 'text-onedark-purple',
          bgColor: 'bg-onedark-purple/10',
          badge: repoTag,
        },
        {
          title: 'Scaffold Feature Branch',
          description: `Design and implement a new feature branch in ${repoTag} with live sandbox preview.`,
          prompt: `Scaffold a new feature in ${repoTag}: create the required data models, backend API routes, and frontend UI components.`,
          persona: 'AppBuilder',
          icon: LayoutGrid,
          color: 'text-onedark-yellow',
          bgColor: 'bg-onedark-yellow/10',
          badge: repoTag,
        },
      ];
    }

    return [
      {
        title: 'Scaffold Fullstack App',
        description: 'Generate a modern fullstack web app with React, TypeScript, Tailwind, and FastAPI in a live preview sandbox.',
        prompt: 'Build a modern fullstack web application with React, TypeScript, Tailwind CSS, and a FastAPI backend with live preview.',
        persona: 'AppBuilder',
        icon: LayoutGrid,
        color: 'text-onedark-accent',
        bgColor: 'bg-onedark-accent/10',
        badge: 'Sandbox',
      },
      {
        title: 'Connect Remote Repository',
        description: 'Link your GitHub or GitLab repository to enable automated PR reviews, audits, and auto-patching.',
        prompt: 'Connect repository https://github.com/[owner]/[repo] and analyze the codebase architecture.',
        persona: 'SoftwareEngineer',
        action: 'connect_repo',
        icon: FolderGit2,
        color: 'text-onedark-purple',
        bgColor: 'bg-onedark-purple/10',
        badge: 'Git Integration',
      },
      {
        title: 'Diagnose & Auto-Fix Error',
        description: 'Paste an error traceback or failing test log to diagnose root cause and test fixes in an isolated sandbox.',
        prompt: 'Diagnose and fix the following error:\n\n[Paste stack trace, error log, or failing test output here]\n\nAnalyze the root cause and generate a verified fix.',
        persona: 'IssueResolver',
        icon: Bug,
        color: 'text-onedark-red',
        bgColor: 'bg-onedark-red/10',
        badge: 'Bugfixer',
      },
      {
        title: 'Algorithmic Benchmark Sandbox',
        description: 'Create an isolated workspace to prototype algorithms, test third-party libraries, or benchmark performance.',
        prompt: 'Create an isolated Python/TypeScript benchmark workspace to evaluate and compare [algorithm or library name] with unit tests.',
        persona: 'SoftwareEngineer',
        icon: Terminal,
        color: 'text-onedark-yellow',
        bgColor: 'bg-onedark-yellow/10',
        badge: 'Prototyping',
      },
    ];
  }, [effectiveRepos]);

  const personas = [
    { id: 'SoftwareEngineer', label: 'Software Engineer' },
    { id: 'AppBuilder', label: 'App Builder' },
    { id: 'CodeReviewer', label: 'Code Reviewer' },
    { id: 'IssueResolver', label: 'Issue Resolver' },
    { id: 'APMTriage', label: 'APM Triage' },
  ];

  const modelOptions = [
    {
      group: 'Adaptive Orchestration',
      models: [
        { id: 'auto', label: 'Auto Tiering' },
      ],
    },
    {
      group: 'Google Gemini',
      models: [
        { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash (Agentic Workhorse)' },
        { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash (Sub-second Agentic)' },
      ],
    },
    {
      group: 'Anthropic Claude',
      models: [
        { id: 'claude-3-7-sonnet', label: 'Claude 3.7 Sonnet' },
        { id: 'claude-3-5-sonnet', label: 'Claude 3.5 Sonnet' },
        { id: 'claude-3-5-haiku', label: 'Claude 3.5 Haiku' },
      ],
    },
    {
      group: 'OpenAI / Codex',
      models: [
        { id: 'gpt-4o', label: 'GPT-4o' },
        { id: 'o3-mini', label: 'o3-mini' },
        { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
      ],
    },
  ];

  const handleSelectTemplate = (item: any) => {
    if (item.action === 'connect_repo') {
      if (onNavigateToRepos) {
        onNavigateToRepos();
      }
      return;
    }

    if (item.persona) {
      setSelectedPersona(item.persona);
    }

    setInputValue(item.prompt);

    setTimeout(() => {
      if (emptyStateTextareaRef.current) {
        emptyStateTextareaRef.current.focus();
        if (item.prompt.includes('[')) {
          const start = item.prompt.indexOf('[');
          const end = item.prompt.indexOf(']') + 1;
          if (start !== -1 && end !== -1) {
            emptyStateTextareaRef.current.setSelectionRange(start, end);
          }
        }
      }
    }, 50);
  };

  const contentMaxWidth = currentPreset === 'fullscreen'
    ? 'max-w-7xl 2xl:max-w-[1750px] px-2 sm:px-6'
    : currentPreset === 'wide'
    ? 'max-w-6xl 2xl:max-w-[1500px] px-2 sm:px-4'
    : currentPreset === 'preview'
    ? 'max-w-2xl 2xl:max-w-3xl px-2 sm:px-3'
    : 'max-w-3xl xl:max-w-4xl px-2 sm:px-4';

  const userMsgMaxWidth = currentPreset === 'fullscreen'
    ? 'max-w-4xl'
    : currentPreset === 'wide'
    ? 'max-w-3xl'
    : currentPreset === 'preview'
    ? 'max-w-xl'
    : 'max-w-2xl';

  // Empty State / New Task Launcher
  if (!task) {
    return (
      <div className="flex flex-col h-full bg-onedark-bg relative font-sans text-onedark-fg overflow-y-auto">
        {/* Top Control Bar in Empty State */}
        <div className="h-10 px-4 bg-onedark-darker/70 flex items-center justify-between text-xs text-onedark-muted select-none flex-shrink-0">
          <div className="flex items-center space-x-2">
            {onToggleSidebar && (
              <button
                onClick={onToggleSidebar}
                className="p-1 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fgBright transition-colors"
                title={isSidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
              >
                {isSidebarCollapsed ? <PanelLeft className="w-3.5 h-3.5" /> : <PanelLeftClose className="w-3.5 h-3.5" />}
              </button>
            )}
            <span className="font-mono text-[11px] text-onedark-fg">New Session</span>
          </div>

          <div className="flex items-center space-x-2">
            {onSetPreset && (
              <div className="flex items-center space-x-0.5 bg-onedark-surface/40 p-0.5 rounded-lg font-mono text-[10.5px]">
                <button
                  onClick={() => onSetPreset('split')}
                  className={`px-2 py-0.5 rounded-md transition-all ${
                    currentPreset === 'split' || currentPreset === 'standard'
                      ? 'bg-onedark-surface text-onedark-fgBright font-semibold shadow-xs'
                      : 'text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/40'
                  }`}
                  title="Split Studio (Default - 48% Auxiliary Pane)"
                >
                  Split
                </button>
                <button
                  onClick={() => onSetPreset('preview')}
                  className={`px-2 py-0.5 rounded-md transition-all ${
                    currentPreset === 'preview'
                      ? 'bg-onedark-surface text-onedark-fgBright font-semibold shadow-xs'
                      : 'text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/40'
                  }`}
                  title="Preview Focus (60% Auxiliary Pane)"
                >
                  Preview
                </button>
                <button
                  onClick={() => onSetPreset('wide')}
                  className={`px-2 py-0.5 rounded-md transition-all ${
                    currentPreset === 'wide'
                      ? 'bg-onedark-surface text-onedark-fgBright font-semibold shadow-xs'
                      : 'text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/40'
                  }`}
                  title="Wide Chat (25% Auxiliary Pane)"
                >
                  Wide
                </button>
                <button
                  onClick={() => onSetPreset('fullscreen')}
                  className={`px-2 py-0.5 rounded-md transition-all ${
                    currentPreset === 'fullscreen'
                      ? 'bg-onedark-surface text-onedark-fgBright font-semibold shadow-xs'
                      : 'text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/40'
                  }`}
                  title="Zen View (Canvas only)"
                >
                  Zen
                </button>
              </div>
            )}
          </div>
        </div>

        <div className={`w-full ${contentMaxWidth} mx-auto py-12 flex flex-col justify-center flex-1 space-y-8`}>
          {/* Header Hero */}
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-extrabold text-onedark-fgBright tracking-tight sm:text-4xl">
              What are we working on?
            </h1>
            <p className="text-sm text-onedark-muted max-w-xl mx-auto leading-relaxed">
              Ask a question, design a feature, resolve an issue, or paste a repository URL.
            </p>
          </div>

          {/* Prompt Launcher Form */}
          <form
            onSubmit={handleSubmit}
            className="p-3.5 rounded-2xl bg-onedark-surface/90 shadow-md backdrop-blur-md focus-within:ring-2 focus-within:ring-onedark-accent/20 transition-all space-y-3 relative"
          >
            <div className="relative w-full z-20">
              {/* Highlight backdrop overlay */}
              {inputValue && (
                <div
                  ref={emptyStateBackdropRef}
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 w-full bg-transparent text-[15px] font-sans leading-relaxed p-2.5 whitespace-pre-wrap break-words overflow-y-auto select-none"
                >
                  {renderHighlightedInputText(inputValue)}
                </div>
              )}

              <textarea
                ref={emptyStateTextareaRef}
                value={inputValue}
                onChange={handleInputChange}
                onKeyUp={handleCursorMove}
                onClick={handleCursorMove}
                onSelect={handleCursorMove}
                onKeyDown={handleKeyDown}
                onScroll={(e) => {
                  if (emptyStateBackdropRef.current) {
                    emptyStateBackdropRef.current.scrollTop = e.currentTarget.scrollTop;
                    emptyStateBackdropRef.current.scrollLeft = e.currentTarget.scrollLeft;
                  }
                }}
                placeholder="Ask a question, describe a change, paste a stack trace, or type '@' to reference a repo..."
                rows={3}
                className={`w-full bg-transparent text-[15px] placeholder-onedark-muted/60 focus:outline-none resize-none font-sans leading-relaxed p-2.5 min-h-[72px] max-h-[240px] overflow-y-auto caret-onedark-yellow ${
                  inputValue ? 'text-transparent' : 'text-onedark-fgBright'
                }`}
              />
              {/* Repository Mention Autocomplete Menu for Launcher */}
              {renderMentionMenu("top-full left-0 mt-1.5")}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-transparent gap-2 flex-wrap sm:flex-nowrap">
              {/* Persona Selector, Model Selector & Repo Pill */}
              <div className="flex items-center space-x-2 min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden py-0.5">
                {/* Persona Pill */}
                <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-onedark-darker/60 hover:bg-onedark-darker text-xs text-onedark-fg font-mono shadow-xs flex-shrink-0 transition-colors">
                  <Sparkles className="w-3.5 h-3.5 text-onedark-yellow flex-shrink-0" />
                  <select
                    value={selectedPersona}
                    onChange={(e) => setSelectedPersona(e.target.value)}
                    className="bg-transparent text-onedark-fg focus:outline-none cursor-pointer text-xs pr-1"
                  >
                    {personas.map((p) => (
                      <option key={p.id} value={p.id} className="bg-onedark-darker text-onedark-fg">
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Model Selector Pill */}
                <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-onedark-darker/60 hover:bg-onedark-darker text-xs text-onedark-fg font-mono shadow-xs flex-shrink-0 transition-colors">
                  <Bot className="w-3.5 h-3.5 text-onedark-accent flex-shrink-0" />
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="bg-transparent text-onedark-fg focus:outline-none cursor-pointer text-xs pr-1"
                  >
                    {modelOptions.map((g) => (
                      <optgroup key={g.group} label={g.group} className="bg-onedark-darker text-onedark-muted font-bold">
                        {g.models.map((m) => (
                          <option key={m.id} value={m.id} className="bg-onedark-darker text-onedark-fg">
                            {m.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>

                {/* Quick Mention Repository Pills or Connect Repo CTA */}
                {effectiveRepos.length > 0 ? (
                  <div className="flex items-center space-x-1.5 min-w-0 flex-shrink-0">
                    {effectiveRepos.slice(0, 3).map((r) => {
                      const tag = `@${r.full_name || r.name}`;
                      const isIncluded = inputValue.includes(tag);
                      return (
                        <button
                          key={r.id || r.full_name}
                          type="button"
                          onClick={() => {
                            if (!isIncluded) {
                              setInputValue((prev) => prev ? `${prev.trim()} ${tag} ` : `${tag} `);
                            }
                            emptyStateTextareaRef.current?.focus();
                          }}
                          className={`px-2 py-1 rounded-lg text-[11px] font-mono transition-all flex items-center space-x-1 cursor-pointer flex-shrink-0 max-w-[170px] ${
                            isIncluded
                              ? 'bg-onedark-accent/20 text-onedark-accent font-semibold'
                              : 'bg-onedark-darker/60 hover:bg-onedark-darker text-onedark-muted hover:text-onedark-fgBright'
                          }`}
                          title={`Click to reference ${tag}`}
                        >
                          <FolderGit2 className="w-3 h-3 text-onedark-folder flex-shrink-0" />
                          <span className="truncate">{tag}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  onNavigateToRepos && (
                    <button
                      type="button"
                      onClick={onNavigateToRepos}
                      className="px-2.5 py-1 rounded-lg bg-onedark-darker/60 hover:bg-onedark-darker text-[11px] font-mono text-onedark-muted hover:text-onedark-fgBright transition-all flex items-center space-x-1.5 cursor-pointer flex-shrink-0"
                      title="Connect a GitHub/GitLab repository"
                    >
                      <Plus className="w-3 h-3 text-onedark-accent flex-shrink-0" />
                      <span>Connect Repo</span>
                    </button>
                  )
                )}
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={!inputValue.trim() || isSubmitting}
                className="px-4 py-2 rounded-xl bg-onedark-fgBright hover:bg-white text-onedark-darker text-xs font-bold flex items-center space-x-1.5 transition-all duration-150 disabled:opacity-35 disabled:cursor-not-allowed shadow-sm active:scale-95 cursor-pointer flex-shrink-0"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Launching...</span>
                  </>
                ) : (
                  <>
                    <span>Run Task</span>
                    <ArrowRight className="w-3.5 h-3.5 stroke-[2.5]" />
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Starter Templates */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1">
            {starterTemplates.map((item, idx) => {
              const Icon = item.icon;
              return (
                <button
                  key={idx}
                  onClick={() => handleSelectTemplate(item)}
                  className="p-4 rounded-xl bg-onedark-surface/40 hover:bg-onedark-surface text-left transition-all duration-200 space-y-2.5 group shadow-xs hover:shadow-md hover:-translate-y-0.5 flex flex-col justify-between cursor-pointer"
                >
                  <div className="space-y-1.5 w-full">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2 min-w-0">
                        <div className={`p-1.5 rounded-lg ${item.bgColor} ${item.color} flex-shrink-0`}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <span className="text-sm font-semibold text-onedark-fgBright group-hover:text-onedark-accent transition-colors truncate">
                          {item.title}
                        </span>
                      </div>
                      {item.badge && (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-onedark-darker/60 text-onedark-muted group-hover:text-onedark-fg transition-colors flex-shrink-0">
                          {item.badge}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-onedark-muted line-clamp-2 leading-relaxed pl-0.5">
                      {item.description || item.prompt}
                    </p>
                  </div>
                  <div className="flex items-center justify-between pt-1 text-[11px] text-onedark-muted/80 group-hover:text-onedark-accent transition-colors">
                    <span className="font-mono text-[10px]">
                      {item.action === 'connect_repo' ? 'Open repository manager ➔' : 'Load prompt template ➔'}
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  const latestApproval = task.approvals?.find((a) => a.status === 'PENDING');
  const latestThoughtText = turns.length > 0 && turns[turns.length - 1].thoughts.length > 0
    ? turns[turns.length - 1].thoughts[turns[turns.length - 1].thoughts.length - 1].thought
    : null;

  return (
    <div className="flex flex-col h-full bg-onedark-bg relative font-sans text-onedark-fg">
      {/* Sleek Workstation Title & Control Bar */}
      <div className="h-10 px-3 bg-onedark-darker/95 backdrop-blur-sm flex items-center justify-between gap-2 z-10 select-none flex-shrink-0 min-w-0">
        {/* Left: Sidebar Toggle, Repo Breadcrumb, Task Title */}
        <div className="flex items-center space-x-2 min-w-0 flex-1 overflow-hidden">
          {onToggleSidebar && (
            <button
              onClick={onToggleSidebar}
              className="p-1 rounded-md hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fgBright transition-colors flex-shrink-0"
              title={isSidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
            >
              {isSidebarCollapsed ? <PanelLeft className="w-3.5 h-3.5" /> : <PanelLeftClose className="w-3.5 h-3.5" />}
            </button>
          )}

          {task.repo_name && (
            <div 
              className="flex items-center space-x-1 px-2 py-0.5 rounded-md bg-onedark-surface/60 text-[11px] font-mono text-onedark-fgBright flex-shrink-0 max-w-[120px] sm:max-w-[150px] truncate"
              title={`Repository: ${task.repo_name}`}
            >
              <FolderGit2 className="w-3 h-3 text-onedark-folder flex-shrink-0" />
              <span className="truncate">{task.repo_name}</span>
            </div>
          )}

          {isEditingTitle ? (
            <div className="flex items-center space-x-1.5 flex-1 max-w-sm">
              <input
                type="text"
                value={titleInput}
                onChange={(e) => setTitleInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleCommitTitle();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setIsEditingTitle(false);
                  }
                }}
                autoFocus
                className="bg-onedark-bg border border-onedark-accent text-xs sm:text-sm font-bold text-onedark-fgBright px-2 py-0.5 rounded outline-none w-full"
              />
              <button
                onClick={handleCommitTitle}
                className="p-1 rounded hover:bg-onedark-green/20 text-onedark-green transition-all flex-shrink-0"
                title="Save title"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setIsEditingTitle(false)}
                className="p-1 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg transition-all flex-shrink-0"
                title="Cancel"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center space-x-1.5 min-w-0 flex-1 group/title overflow-hidden">
              <h1 
                className="text-xs sm:text-sm font-bold text-onedark-fgBright truncate tracking-tight cursor-pointer hover:text-onedark-accent transition-colors" 
                title={task.title}
                onClick={handleStartEditTitle}
              >
                {task.title}
              </h1>
              {onUpdateTaskTitle && (
                <button
                  onClick={handleStartEditTitle}
                  className="opacity-0 group-hover/title:opacity-100 p-1 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg transition-all flex-shrink-0"
                  title="Rename session"
                >
                  <Pencil className="w-3 h-3" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Right: Sandbox, Model Badge, Status Badge, Presets, Retry */}
        <div className="flex items-center space-x-1.5 flex-shrink-0">
          {/* Model Badge */}
          {task.model_name && (
            <div 
              className={`hidden sm:flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10.5px] font-mono ${
                task.model_name.startsWith('claude') 
                  ? 'bg-amber-500/15 text-amber-400' 
                  : task.model_name.startsWith('gpt') || task.model_name.startsWith('o') || task.model_name.startsWith('codex')
                  ? 'bg-emerald-500/15 text-emerald-400' 
                  : 'bg-cyan-500/15 text-cyan-400'
              }`}
              title={`Active Model: ${task.model_name}`}
            >
              {task.model_name.startsWith('claude') ? (
                <Bot className="w-3 h-3" />
              ) : task.model_name.startsWith('gpt') || task.model_name.startsWith('o') || task.model_name.startsWith('codex') ? (
                <Cpu className="w-3 h-3" />
              ) : (
                <Sparkles className="w-3 h-3" />
              )}
              <span className="truncate max-w-[110px]">{task.model_name}</span>
            </div>
          )}

          {/* Status Badge */}
          <div className="flex items-center space-x-1 flex-shrink-0">
            <span
              className={`px-2 py-0.5 rounded-full text-[10.5px] font-mono flex items-center space-x-1.5 ${
                task.status === 'RUNNING' || task.status === 'INITIALIZING'
                  ? 'bg-onedark-yellow/10 text-onedark-yellow'
                  : task.status === 'COMPLETED'
                  ? 'bg-onedark-green/10 text-onedark-green'
                  : task.status === 'AWAITING_INPUT' || task.status === 'AWAITING_APPROVAL'
                  ? 'bg-onedark-accent/10 text-onedark-accent'
                  : task.status === 'FAILED'
                  ? 'bg-onedark-red/10 text-onedark-red'
                  : 'bg-onedark-surface/60 text-onedark-muted'
              }`}
              title={`Status: ${task.status}`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  task.status === 'RUNNING' || task.status === 'INITIALIZING'
                    ? 'bg-onedark-yellow animate-pulse'
                    : task.status === 'COMPLETED'
                    ? 'bg-onedark-green'
                    : task.status === 'AWAITING_INPUT' || task.status === 'AWAITING_APPROVAL'
                    ? 'bg-onedark-accent'
                    : task.status === 'FAILED'
                    ? 'bg-onedark-red'
                    : 'bg-onedark-muted'
                }`}
              />
              <span>
                {task.status === 'COMPLETED' ? 'Done' :
                 task.status === 'RUNNING' ? 'Running' :
                 task.status === 'INITIALIZING' ? 'Init' :
                 task.status === 'AWAITING_APPROVAL' ? 'Approval' :
                 task.status === 'AWAITING_INPUT' ? 'Input' :
                 task.status === 'FAILED' ? 'Failed' :
                 task.status === 'IDLE' ? 'Standby' :
                 task.status.replace('_', ' ')}
              </span>
            </span>
          </div>

          {/* Live App Preview Button */}
          {previewInfo?.has_preview && onSelectAuxTab && (
            <button
              onClick={() => onSelectAuxTab('preview')}
              className="px-2.5 py-0.5 rounded-md text-[11px] font-mono bg-onedark-green/15 text-onedark-green hover:bg-onedark-green/25 flex items-center space-x-1.5 transition-all shadow-xs active:scale-95 cursor-pointer flex-shrink-0"
              title={`Preview application (${previewInfo.title || previewInfo.entry_point || 'Web App'})`}
            >
              <Play className="w-3 h-3 fill-current" />
              <span className="font-semibold">Live Preview</span>
            </button>
          )}

          {/* Sandbox Inspector Button */}
          {task.sandbox_status && task.sandbox_status !== 'NONE' && (
            <button
              onClick={() => {
                if (onOpenSandboxModal) {
                  onOpenSandboxModal();
                } else {
                  setIsSandboxModalOpen(true);
                }
              }}
              className={`px-2 py-0.5 rounded-md text-[10.5px] font-mono flex items-center space-x-1.5 transition-all shadow-xs active:scale-95 cursor-pointer flex-shrink-0 ${
                task.sandbox_status === 'ACTIVE'
                  ? 'bg-onedark-green/10 text-onedark-green hover:bg-onedark-green/20'
                  : task.sandbox_status === 'PROVISIONING'
                  ? 'bg-onedark-yellow/10 text-onedark-yellow hover:bg-onedark-yellow/20'
                  : task.sandbox_status === 'AUTH_REQUIRED'
                  ? 'bg-onedark-accent/10 text-onedark-accent hover:bg-onedark-accent/20'
                  : 'bg-onedark-surface/60 text-onedark-muted hover:bg-onedark-surface hover:text-onedark-fg'
              }`}
              title="Inspect Sandbox Environment & Filesystem"
            >
              <Box className="w-3 h-3 flex-shrink-0" />
              <span className="hidden 2xl:inline">Sandbox: </span>
              <span>{task.sandbox_status === 'DESTROYED' ? 'Destroyed' : task.sandbox_status.toLowerCase()} ↗</span>
            </button>
          )}

          {/* Presets */}
          {onSetPreset && (
            <div className="hidden xl:flex items-center space-x-0.5 bg-onedark-surface/40 p-0.5 rounded-lg font-mono text-[10.5px] flex-shrink-0">
              <button
                onClick={() => onSetPreset('split')}
                className={`px-2 py-0.5 rounded-md transition-all ${
                  currentPreset === 'split' || currentPreset === 'standard'
                    ? 'bg-onedark-surface text-onedark-fgBright font-semibold shadow-xs'
                    : 'text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/40'
                }`}
                title="Split Studio (Default - 48% Auxiliary Pane)"
              >
                Split
              </button>
              <button
                onClick={() => onSetPreset('preview')}
                className={`px-2 py-0.5 rounded-md transition-all ${
                  currentPreset === 'preview'
                    ? 'bg-onedark-surface text-onedark-fgBright font-semibold shadow-xs'
                    : 'text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/40'
                }`}
                title="Preview Focus (60% Auxiliary Pane)"
              >
                Preview
              </button>
              <button
                onClick={() => onSetPreset('wide')}
                className={`px-2 py-0.5 rounded-md transition-all ${
                  currentPreset === 'wide'
                    ? 'bg-onedark-surface text-onedark-fgBright font-semibold shadow-xs'
                    : 'text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/40'
                }`}
                title="Wide Chat (25% Auxiliary Pane)"
              >
                Wide
              </button>
              <button
                onClick={() => onSetPreset('fullscreen')}
                className={`px-2 py-0.5 rounded-md transition-all ${
                  currentPreset === 'fullscreen'
                    ? 'bg-onedark-surface text-onedark-fgBright font-semibold shadow-xs'
                    : 'text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/40'
                }`}
                title="Zen View (Full Canvas)"
              >
                Zen
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Centralized Conversation Feed */}
      <div 
        ref={scrollContainerRef} 
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-6 relative [overflow-anchor:auto]"
      >
        <div className={`w-full ${contentMaxWidth} mx-auto space-y-6`}>
          {turns.map((turn, tIdx) => {
            const isTurnRunning = isRunning && turn.isLatest && (turn.agentMessages.length === 0 || (turn.agentMessages.length === 1 && !turn.agentMessages[0].content));
            const isTurnOpen = openThoughts[turn.id] ?? (isRunning && turn.isLatest);
            const isActOpen = userToggledActivities[turn.id] !== undefined 
              ? userToggledActivities[turn.id] 
              : (isTurnRunning && turn.isLatest);
            const hasThoughts = turn.thoughts.length > 0;
            const hasLogs = turn.logs.length > 0 || (isTurnRunning && turn.isLatest && !!task?.active_tool);
            const hasPlan = !!turn.plan && turn.plan.steps && turn.plan.steps.length > 0;
            const isPlanOpen = userToggledPlans[turn.id] !== undefined 
              ? userToggledPlans[turn.id] 
              : (isTurnRunning && turn.isLatest);

            const completedSteps = turn.plan?.steps?.filter((s) => s.status === 'completed').length || 0;
            const totalSteps = turn.plan?.steps?.length || 0;
            const evalStatus = turn.plan?.evaluation?.status || 'pending';

            return (
              <div key={turn.id || tIdx} className="space-y-4">
                {/* 1. User Message Block (with Input Token Metric) */}
                {turn.userMessage && (
                  <div className="flex justify-end group">
                    {editingMessageId === turn.userMessage.id ? (
                      <div className={`w-full ${userMsgMaxWidth} p-3 rounded-2xl bg-onedark-surface border border-onedark-accent/60 shadow-lg space-y-2`}>
                        <textarea
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
                              e.preventDefault();
                              handleSaveEdit(turn.userMessage!.id);
                            } else if (e.key === 'Escape') {
                              cancelEditing();
                            }
                          }}
                          rows={3}
                          className="w-full bg-onedark-darker border border-onedark-border rounded-xl p-3 text-sm text-onedark-fgBright font-sans focus:outline-none focus:border-onedark-accent resize-none leading-relaxed"
                          autoFocus
                        />
                        <div className="flex items-center justify-between px-1">
                          <span className="text-[11px] text-onedark-muted font-mono">
                            Enter ↵ to save · Esc to cancel
                          </span>
                          <div className="flex items-center space-x-2">
                            <button
                              onClick={cancelEditing}
                              className="px-3 py-1.5 rounded-lg border border-onedark-border hover:bg-onedark-darker text-onedark-muted hover:text-onedark-fg text-xs font-medium transition-colors"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => handleSaveEdit(turn.userMessage!.id)}
                              disabled={!editValue.trim()}
                              className="px-3.5 py-1.5 rounded-lg bg-onedark-accent hover:bg-onedark-accent/90 text-onedark-darker font-bold text-xs transition-all disabled:opacity-30 shadow-sm active:scale-95"
                            >
                              Save & Resubmit
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className={`relative ${userMsgMaxWidth} flex flex-col items-end space-y-1`}>
                        <div className="flex items-center space-x-2 mb-0.5 pr-1 text-[11px] font-mono text-onedark-muted">
                          {turn.userMessage.isOptimistic ? (
                            <span className="px-2 py-0.5 rounded-full bg-onedark-accent/10 text-onedark-accent flex items-center space-x-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-onedark-accent animate-pulse" />
                              <span>Sending...</span>
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full bg-onedark-surface/60 text-onedark-muted">
                              ~{turn.userMessage.tokens || estimateTokens(turn.userMessage.content)} tokens in
                            </span>
                          )}
                        </div>
                        <div className="px-4 py-2.5 rounded-2xl bg-onedark-surface/80 text-onedark-fgBright font-sans text-[13px] sm:text-[13.5px] leading-relaxed shadow-xs">
                          <div className="whitespace-pre-wrap">{renderStyledMessageContent(turn.userMessage.content)}</div>
                        </div>
                        {/* Hover Action Bar */}
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center space-x-1 pr-1">
                          {onEditMessage && !isRunning && (
                            <button
                              onClick={() => startEditing(turn.userMessage!.id, turn.userMessage!.content)}
                              className="p-1 rounded-md hover:bg-onedark-surface border border-transparent hover:border-onedark-border text-onedark-muted hover:text-onedark-fgBright transition-colors"
                              title="Edit prompt"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {onRetryTask && !isRunning && (
                            <button
                              onClick={() => onRetryTask(turn.userMessage!.id)}
                              className="p-1 rounded-md hover:bg-onedark-surface border border-transparent hover:border-onedark-border text-onedark-muted hover:text-onedark-fgBright transition-colors"
                              title="Retry from here"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {onResetTurn && !isRunning && (
                            <button
                              onClick={() => onResetTurn(tIdx + 1)}
                              className="p-1 rounded-md hover:bg-onedark-surface border border-transparent hover:border-onedark-border text-onedark-muted hover:text-onedark-yellow transition-colors"
                              title="Reset Turn (Rollback files & context to this turn)"
                            >
                              <Undo2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => handleCopyText(turn.userMessage!.id, turn.userMessage!.content)}
                            className="p-1 rounded-md hover:bg-onedark-surface border border-transparent hover:border-onedark-border text-onedark-muted hover:text-onedark-fgBright transition-colors"
                            title="Copy prompt"
                          >
                            {copiedId === turn.userMessage.id ? (
                              <Check className="w-3.5 h-3.5 text-onedark-green" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 2. Execution Plan Accordion (Situated ABOVE Reasoning & Activity) */}
                {hasPlan && (
                  <div className="rounded-xl bg-onedark-darker/40 hover:bg-onedark-darker/60 overflow-hidden shadow-xs transition-colors">
                    <button
                      type="button"
                      onClick={() => {
                        setUserToggledPlans((prev) => ({ ...prev, [turn.id]: !isPlanOpen }));
                      }}
                      className="w-full px-3.5 py-2.5 flex items-center justify-between text-xs text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/30 transition-colors cursor-pointer select-none"
                    >
                      <div className="flex items-center space-x-2 min-w-0 pr-2">
                        <ListOrdered className="w-3.5 h-3.5 text-onedark-accent shrink-0" />
                        <span className="font-mono text-xs font-medium text-onedark-fg">
                          Execution Plan
                        </span>
                        <span className="text-[11px] text-onedark-muted font-mono">
                          ({completedSteps}/{totalSteps} steps)
                        </span>

                        {evalStatus === 'accomplished' ? (
                          <span className="px-1.5 py-0.5 rounded bg-onedark-green/10 text-onedark-green text-[10px] font-mono flex items-center space-x-1">
                            <CheckCircle2 className="w-2.5 h-2.5" />
                            <span>Accomplished</span>
                          </span>
                        ) : evalStatus === 'evaluating' ? (
                          <span className="px-1.5 py-0.5 rounded bg-onedark-accent/10 text-onedark-accent text-[10px] font-mono flex items-center space-x-1">
                            <Loader2 className="w-2.5 h-2.5 animate-spin" />
                            <span>Evaluating</span>
                          </span>
                        ) : evalStatus === 'needs_revision' ? (
                          <span className="px-1.5 py-0.5 rounded bg-onedark-yellow/10 text-onedark-yellow text-[10px] font-mono flex items-center space-x-1">
                            <AlertCircle className="w-2.5 h-2.5" />
                            <span>Revision</span>
                          </span>
                        ) : null}
                      </div>

                      <div className="flex items-center space-x-2 shrink-0">
                        {isTurnRunning && turn.isLatest ? (
                          <span className="px-2 py-0.5 rounded-full bg-onedark-yellow/10 text-onedark-yellow text-[10.5px] font-mono flex items-center space-x-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-onedark-yellow animate-pulse" />
                            <span>Executing...</span>
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-md bg-onedark-surface/40 text-onedark-muted text-[10.5px] font-mono">
                            {isPlanOpen ? 'Hide' : 'Show steps'}
                          </span>
                        )}
                        {isPlanOpen ? (
                          <ChevronDown className="w-4 h-4 text-onedark-muted" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-onedark-muted" />
                        )}
                      </div>
                    </button>

                    {isPlanOpen && (
                      <div className="p-3.5 border-t border-white/[0.04] space-y-3.5 text-xs bg-onedark-darker/40">
                        {turn.plan?.objective && (
                          <div className="p-2.5 rounded-lg bg-onedark-surface/30 text-[11.5px] font-sans text-onedark-fg leading-relaxed">
                            <span className="font-semibold font-mono text-[10px] uppercase tracking-wider block mb-1 text-onedark-muted">
                              Goal
                            </span>
                            {turn.plan.objective}
                          </div>
                        )}

                        {/* Connected Stepper Timeline */}
                        <div className="relative pl-6 space-y-2.5 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-px before:bg-onedark-borderSubtle">
                          {turn.plan?.steps?.map((step, sIdx) => {
                            const isDone = step.status === 'completed';
                            const isInProgress = step.status === 'in_progress';
                            const isFailed = step.status === 'failed';

                            return (
                              <div
                                key={step.id || sIdx}
                                className={`relative flex items-start space-x-2.5 py-0.5 text-xs font-mono transition-colors ${
                                  isInProgress
                                    ? 'text-onedark-fgBright'
                                    : isDone
                                    ? 'text-onedark-fg'
                                    : isFailed
                                    ? 'text-onedark-red'
                                    : 'text-onedark-muted'
                                }`}
                              >
                                <div className="absolute -left-6 top-0.5 p-0.5 rounded-full bg-onedark-darker shrink-0 z-10">
                                  {isDone ? (
                                    <CheckCircle2 className="w-3.5 h-3.5 text-onedark-green" />
                                  ) : isInProgress ? (
                                    <Loader2 className="w-3.5 h-3.5 text-onedark-accent animate-spin" />
                                  ) : isFailed ? (
                                    <AlertCircle className="w-3.5 h-3.5 text-onedark-red" />
                                  ) : (
                                    <Circle className="w-3.5 h-3.5 text-onedark-muted/40" />
                                  )}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className={`leading-snug ${isInProgress ? 'font-medium text-onedark-fgBright' : isDone ? 'text-onedark-fg' : 'text-onedark-muted'}`}>
                                    {step.title}
                                  </div>
                                  {step.details && (
                                    <div className="text-[10.5px] text-onedark-muted mt-0.5 font-sans leading-normal">
                                      {step.details}
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {turn.plan?.evaluation && turn.plan.evaluation.status !== 'pending' && (
                          <div className={`p-2.5 rounded-lg text-xs font-mono space-y-1.5 ${
                            turn.plan.evaluation.status === 'accomplished'
                              ? 'bg-onedark-green/5 text-onedark-green'
                              : turn.plan.evaluation.status === 'needs_revision'
                              ? 'bg-onedark-yellow/5 text-onedark-yellow'
                              : 'bg-onedark-accent/5 text-onedark-accent'
                          }`}>
                            <div className="flex items-center space-x-2">
                              {turn.plan.evaluation.status === 'accomplished' ? (
                                <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-onedark-green" />
                              ) : turn.plan.evaluation.status === 'needs_revision' ? (
                                <AlertCircle className="w-3.5 h-3.5 shrink-0 text-onedark-yellow" />
                              ) : (
                                <Loader2 className="w-3.5 h-3.5 shrink-0 text-onedark-accent animate-spin" />
                              )}
                              <span className="font-semibold font-mono text-[11px]">
                                {turn.plan.evaluation.status === 'accomplished'
                                  ? 'Plan Evaluation: Accomplished'
                                  : turn.plan.evaluation.status === 'needs_revision'
                                  ? 'Plan Evaluation: Revision Required'
                                  : 'Plan Evaluation: In Progress'}
                              </span>
                            </div>
                            {turn.plan.evaluation.summary && (
                              <p className="text-[11px] font-sans text-onedark-fg pl-5 leading-relaxed">
                                {turn.plan.evaluation.summary}
                              </p>
                            )}
                            {turn.plan.evaluation.checks && turn.plan.evaluation.checks.length > 0 && (
                              <div className="flex items-center space-x-1.5 pl-5 pt-0.5 flex-wrap gap-1">
                                {turn.plan.evaluation.checks.map((chk, cIdx) => (
                                  <span
                                    key={cIdx}
                                    className={`px-1.5 py-0.2 rounded text-[10px] font-mono border flex items-center space-x-1 ${
                                      chk.passed
                                        ? 'bg-onedark-green/10 text-onedark-green border-onedark-green/25'
                                        : 'bg-onedark-red/10 text-onedark-red border-onedark-red/25'
                                    }`}
                                  >
                                    {chk.passed ? <Check className="w-2.5 h-2.5" /> : <AlertCircle className="w-2.5 h-2.5" />}
                                    <span>{chk.name}</span>
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* 3. Reasoning Process Accordion */}
                {hasThoughts && (
                  <div className="rounded-xl bg-onedark-darker/40 hover:bg-onedark-darker/60 overflow-hidden shadow-xs transition-colors">
                    <button
                      type="button"
                      onClick={() => setOpenThoughts((prev) => ({ ...prev, [turn.id]: !isTurnOpen }))}
                      className="w-full px-3.5 py-2.5 flex items-center justify-between text-xs text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/30 transition-colors cursor-pointer select-none"
                    >
                      <div className="flex items-center space-x-2">
                        <Sparkles className="w-3.5 h-3.5 text-onedark-accent" />
                        <span className="font-mono text-xs font-medium text-onedark-fg">
                          Reasoning process
                        </span>
                        <span className="text-[11px] text-onedark-muted font-mono">
                          ({turn.thoughts.length} step{turn.thoughts.length > 1 ? 's' : ''})
                        </span>
                      </div>

                      <div className="flex items-center space-x-2">
                        {isRunning && turn.isLatest ? (
                          <span className="px-2 py-0.5 rounded-full bg-onedark-yellow/10 text-onedark-yellow text-[10.5px] font-mono flex items-center space-x-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-onedark-yellow animate-pulse" />
                            <span>Thinking...</span>
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-md bg-onedark-surface/60 text-onedark-muted text-[10.5px] font-mono">
                            {isTurnOpen ? 'Hide' : 'Show details'}
                          </span>
                        )}
                        {isTurnOpen ? (
                          <ChevronDown className="w-4 h-4 text-onedark-muted" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-onedark-muted" />
                        )}
                      </div>
                    </button>

                    {isTurnOpen && (
                      <div className="p-3.5 border-t border-transparent space-y-2 text-xs text-onedark-fg font-mono leading-relaxed bg-onedark-darker/90 max-h-80 overflow-y-auto">
                        {turn.thoughts.map((m, idx) => (
                          <div key={m.id || idx} className="pl-3 border-l-2 border-onedark-accent/40 py-0.5">
                            <div className="whitespace-pre-wrap">
                              {m.thought}
                              {m.isStreaming && (
                                <span className="inline-block w-1.5 h-3.5 ml-1 bg-onedark-accent animate-pulse align-middle" />
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 3. Turn Workspace Activity (Inline Action Stream) */}
                {hasLogs && (() => {
                  const totalDuration = turn.logs.reduce((acc, l) => acc + (l.duration_ms || 0), 0);
                  const formattedDuration = totalDuration < 1000 
                    ? `${totalDuration}ms` 
                    : `${(totalDuration / 1000).toFixed(1)}s`;

                  const editCount = turn.logs.filter((l) => l.tool_name === 'edit_file').length;
                  const runCount = turn.logs.filter((l) => l.tool_name === 'run_command').length;
                  const readCount = turn.logs.filter((l) => ['read_file', 'grep_search', 'search_code', 'find_symbols', 'tgrep_ast', 'list_dir'].includes(l.tool_name)).length;
                  const webCount = turn.logs.filter((l) => ['search_web', 'fetch_url'].includes(l.tool_name)).length;
                  const prCount = turn.logs.filter((l) => l.tool_name.includes('pull_request') || l.tool_name.includes('connect_repository')).length;
                  const failedCount = turn.logs.filter((l) => l.exit_code !== 0 && !l.isRunning).length;
                  const hasRunning = turn.logs.some((l) => l.isRunning) || (isTurnRunning && turn.isLatest && !!task?.active_tool);

                  return (
                    <div className="rounded-xl bg-onedark-darker/40 hover:bg-onedark-darker/60 overflow-hidden shadow-xs transition-colors space-y-0">
                      {/* Summary Header */}
                      <div
                        onClick={() => setUserToggledActivities((prev) => ({ ...prev, [turn.id]: !isActOpen }))}
                        className={`w-full px-3.5 py-2.5 flex items-center justify-between text-xs transition-colors cursor-pointer select-none group/hdr ${
                          isActOpen ? 'bg-onedark-surface/30' : 'hover:bg-onedark-surface/40'
                        }`}
                      >
                        <div className="flex items-center space-x-2.5 min-w-0 pr-2">
                          <div className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 transition-colors ${
                            hasRunning
                              ? 'bg-onedark-accent/20 text-onedark-accent animate-pulse'
                              : failedCount > 0
                              ? 'bg-onedark-red/15 text-onedark-red'
                              : 'bg-onedark-surface text-onedark-muted group-hover/hdr:text-onedark-accent'
                          }`}>
                            {hasRunning ? (
                              <RefreshCw className="w-3 h-3 animate-spin" />
                            ) : (
                              <Zap className="w-3 h-3" />
                            )}
                          </div>

                          <div className="flex items-center space-x-2 flex-wrap gap-y-1 min-w-0">
                            <span className="font-mono text-[11.5px] font-medium text-onedark-fgBright">
                              Workspace Actions
                            </span>

                            {/* Categorized action chips */}
                            <div className="flex items-center space-x-1 flex-wrap gap-1">
                              {editCount > 0 && (
                                <span className="px-1.5 py-0.5 rounded bg-onedark-green/10 text-onedark-green text-[10px] font-mono flex items-center space-x-1">
                                  <Pencil className="w-2.5 h-2.5" />
                                  <span>{editCount} edit{editCount > 1 ? 's' : ''}</span>
                                </span>
                              )}
                              {runCount > 0 && (
                                <span className="px-1.5 py-0.5 rounded bg-onedark-yellow/10 text-onedark-yellow text-[10px] font-mono flex items-center space-x-1">
                                  <Terminal className="w-2.5 h-2.5" />
                                  <span>{runCount} run{runCount > 1 ? 's' : ''}</span>
                                </span>
                              )}
                              {readCount > 0 && (
                                <span className="px-1.5 py-0.5 rounded bg-onedark-accent/10 text-onedark-accent text-[10px] font-mono flex items-center space-x-1">
                                  <FileCode2 className="w-2.5 h-2.5" />
                                  <span>{readCount} read{readCount > 1 ? 's' : ''}</span>
                                </span>
                              )}
                              {webCount > 0 && (
                                <span className="px-1.5 py-0.5 rounded bg-onedark-purple/10 text-onedark-purple text-[10px] font-mono flex items-center space-x-1">
                                  <Globe className="w-2.5 h-2.5" />
                                  <span>{webCount} web</span>
                                </span>
                              )}
                              {prCount > 0 && (
                                <span className="px-1.5 py-0.5 rounded bg-onedark-green/10 text-onedark-green text-[10px] font-mono flex items-center space-x-1">
                                  <GitPullRequest className="w-2.5 h-2.5" />
                                  <span>{prCount} PR</span>
                                </span>
                              )}
                            </div>

                            <span className="text-[10.5px] text-onedark-muted font-mono hidden sm:inline">
                              • {turn.logs.length + (task?.active_tool && !turn.logs.some(l => l.isRunning) ? 1 : 0)} total ({formattedDuration})
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center space-x-1.5 flex-shrink-0">
                          {/* Status indicator pill */}
                          {hasRunning ? (
                            <span className="px-2 py-0.5 rounded-md bg-onedark-accent/15 text-onedark-accent text-[10px] font-mono flex items-center space-x-1.5 animate-pulse">
                              <span className="w-1.5 h-1.5 rounded-full bg-onedark-accent" />
                              <span>Executing...</span>
                            </span>
                          ) : failedCount > 0 ? (
                            <span className="px-2 py-0.5 rounded-md bg-onedark-red/10 text-onedark-red text-[10px] font-mono flex items-center space-x-1">
                              <AlertCircle className="w-2.5 h-2.5" />
                              <span>{failedCount} error{failedCount > 1 ? 's' : ''}</span>
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-md bg-onedark-green/5 text-onedark-green/90 text-[10px] font-mono flex items-center space-x-1">
                              <Check className="w-2.5 h-2.5" />
                              <span>Done ({formattedDuration})</span>
                            </span>
                          )}

                          {onSelectAuxTab && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onSelectAuxTab('activity');
                              }}
                              className="hidden md:flex items-center space-x-1 px-1.5 py-0.5 rounded-md bg-onedark-surface/30 hover:bg-onedark-surface text-onedark-muted hover:text-onedark-accent text-[10.5px] font-mono transition-colors"
                              title="Inspect logs in Auxiliary Tool Activity tab"
                            >
                              <span>Activity</span>
                              <ExternalLink className="w-2.5 h-2.5" />
                            </button>
                          )}

                          <span className="px-2 py-0.5 rounded-md bg-onedark-surface/40 text-onedark-muted text-[10.5px] font-mono flex items-center space-x-1 group-hover/hdr:text-onedark-fgBright transition-colors">
                            <span>{isActOpen ? 'Hide' : `Show (${turn.logs.length + (task?.active_tool && !turn.logs.some(l => l.isRunning) ? 1 : 0)})`}</span>
                            {isActOpen ? (
                              <ChevronDown className="w-3 h-3 ml-0.5 text-onedark-muted group-hover/hdr:text-onedark-fgBright" />
                            ) : (
                              <ChevronRight className="w-3 h-3 ml-0.5 text-onedark-muted group-hover/hdr:text-onedark-fgBright" />
                            )}
                          </span>
                        </div>
                      </div>

                      {/* Inline Action Items Stream */}
                      {isActOpen && (
                        <div className="p-1.5 border-t border-white/[0.04] space-y-0.5 bg-onedark-darker/40">
                          {turn.logs.map((log, idx) => {
                            const logKey = log.id || `log-${turn.id}-${idx}`;
                            const isExpanded = !!expandedLogIds[logKey];
                            const actionInfo = getToolActionInfo(log.tool_name, log.tool_input, log.isRunning);
                            const ActionIcon = actionInfo.icon;

                            return (
                              <div key={logKey} className="space-y-1">
                                <div
                                  onClick={() => setExpandedLogIds((prev) => ({ ...prev, [logKey]: !prev[logKey] }))}
                                  className={`flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs font-mono border transition-colors cursor-pointer select-none group/action ${
                                    log.isRunning
                                      ? 'bg-onedark-accent/10 text-onedark-fgBright border-onedark-accent/30 shadow-xs'
                                      : log.exit_code !== 0
                                      ? 'bg-onedark-red/10 text-onedark-red border-onedark-red/20 hover:bg-onedark-red/15 hover:border-onedark-red/30'
                                      : 'border-transparent hover:bg-onedark-surface/60 hover:border-onedark-borderSubtle hover:text-onedark-fgBright text-onedark-fg'
                                  }`}
                                >
                                  <div className="flex items-center space-x-2.5 min-w-0 pr-2">
                                    <div className={`p-1 rounded ${actionInfo.badgeBg} flex items-center justify-center flex-shrink-0`}>
                                      {log.isRunning ? (
                                        <RefreshCw className="w-3 h-3 animate-spin text-onedark-accent" />
                                      ) : (
                                        <ActionIcon className={`w-3.5 h-3.5 ${actionInfo.colorClass}`} />
                                      )}
                                    </div>
                                    <div className="truncate flex items-center space-x-1.5 text-xs">
                                      <span className={`font-semibold ${actionInfo.colorClass}`}>
                                        {actionInfo.verb}
                                      </span>
                                      <span className="text-onedark-fgBright font-mono truncate">
                                        {actionInfo.target}
                                      </span>
                                    </div>
                                  </div>

                                  <div className="flex items-center space-x-2 flex-shrink-0 text-[10.5px] text-onedark-muted">
                                    {log.isRunning ? (
                                      <span className="px-1.5 py-0.5 rounded bg-onedark-accent/20 text-onedark-accent text-[10px] animate-pulse">
                                        running...
                                      </span>
                                    ) : (
                                      <>
                                        <span className="font-mono text-onedark-muted/70">
                                          {log.duration_ms < 1000 ? `${log.duration_ms}ms` : `${(log.duration_ms / 1000).toFixed(1)}s`}
                                        </span>
                                        <span
                                          className={`px-1.5 py-0.5 rounded text-[9.5px] font-mono ${
                                            log.exit_code === 0
                                              ? 'bg-onedark-green/10 text-onedark-green'
                                              : 'bg-onedark-red/10 text-onedark-red'
                                          }`}
                                        >
                                          exit {log.exit_code}
                                        </span>
                                      </>
                                    )}
                                    <span className="text-onedark-muted/60 group-hover/action:text-onedark-fg transition-colors">
                                      {isExpanded ? (
                                        <ChevronDown className="w-3.5 h-3.5" />
                                      ) : (
                                        <ChevronRight className="w-3.5 h-3.5" />
                                      )}
                                    </span>
                                  </div>
                                </div>

                                {/* Expanded Individual Log */}
                                {isExpanded && (
                                  <div className="pl-3 pr-1 pt-0.5 pb-1">
                                    <FormattedLogView log={log} initiallyExpanded={true} isExpanded={true} />
                                  </div>
                                )}
                              </div>
                            );
                          })}

                          {/* Active executing tool if present in task but not yet in logs */}
                          {isTurnRunning && turn.isLatest && task?.active_tool && !turn.logs.some((l) => l.isRunning) && (() => {
                            const actionInfo = getToolActionInfo(task.active_tool.tool_name, task.active_tool.tool_input, true);
                            const ActionIcon = actionInfo.icon;
                            return (
                              <div className="flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs font-mono bg-onedark-accent/10 text-onedark-fgBright shadow-xs select-none">
                                <div className="flex items-center space-x-2.5 min-w-0 pr-2">
                                  <div className={`p-1 rounded ${actionInfo.badgeBg} flex items-center justify-center flex-shrink-0`}>
                                    <RefreshCw className="w-3 h-3 animate-spin text-onedark-accent" />
                                  </div>
                                  <div className="truncate flex items-center space-x-1.5 text-xs">
                                    <span className={`font-semibold ${actionInfo.colorClass}`}>
                                      {actionInfo.verb}
                                    </span>
                                    <span className="text-onedark-fgBright font-mono truncate">
                                      {actionInfo.target}
                                    </span>
                                  </div>
                                </div>
                                <div className="flex items-center space-x-2 flex-shrink-0 text-[10.5px]">
                                  <span className="px-1.5 py-0.5 rounded bg-onedark-accent/20 text-onedark-accent animate-pulse">
                                    running...
                                  </span>
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* 4. Live Terminal Pulsing Cursor (Shown when turn is active before first agent message arrives) */}
                {isTurnRunning && turn.agentMessages.length === 0 && !task?.active_tool && !turn.logs.some((l) => l.isRunning) && !turn.thoughts.some((t) => t.isStreaming) && (
                  <div className="w-full flex flex-col items-start space-y-1.5">
                    <div className="flex items-center justify-between w-full px-0.5 text-[11px] font-mono text-onedark-muted">
                      <span className="font-sans font-medium text-onedark-fg">{task.persona}</span>
                    </div>
                    <div className="text-onedark-fg text-[13px] sm:text-[13.5px] leading-relaxed w-full flex items-center min-h-[22px]">
                      <span className="terminal-cursor" title="Generating..." />
                    </div>
                  </div>
                )}

                {/* 5. Agent Messages (with Token Output Metric) */}
                {turn.agentMessages.map((m) => {
                  const outTokens = m.tokens || estimateTokens(m.content);
                  const isFullPlanDoc = Boolean(
                    m.content && 
                    (m.content.trim().startsWith('# Implementation Plan') || 
                     (m.content.includes('# Implementation Plan') && m.content.length > 400))
                  );
                  const isRawPlanExpanded = !!expandedRawPlanMsgIds[m.id];
                  const planInfo = isFullPlanDoc ? extractPlanHighlightsFromMarkdown(m.content) : null;

                  const handleMessageLinkClick = (url: string, text: string) => {
                    if (url.startsWith('plan://') || url === '#open-plan-doc' || url === 'action://open-plan-doc') {
                      if (onOpenPlan) {
                        onOpenPlan(task?.id, turn.plan);
                      } else if (onOpenPreview && task?.id) {
                        onOpenPreview(`plan://${task.id}`, 'Implementation Plan');
                      }
                      return;
                    }
                    if (onOpenPreview) {
                      onOpenPreview(url, text);
                    }
                  };

                  return (
                    <div
                      key={m.id}
                      className={`flex items-start group ${
                        m.sender === 'system' ? 'justify-center' : 'justify-start'
                      }`}
                    >
                      {m.sender === 'system' ? (
                        <div className="my-2 px-4 py-2.5 rounded-xl bg-onedark-surface/40 border border-onedark-border text-xs text-onedark-fg font-mono leading-relaxed max-w-2xl text-center">
                          <MarkdownRenderer content={maskSecretsInText(m.content)} isStreaming={m.isStreaming} onLinkClick={handleMessageLinkClick} />
                        </div>
                      ) : (
                        <div className="w-full flex flex-col items-start space-y-1.5">
                          <div className="flex items-center justify-between w-full px-0.5 text-[11px] font-mono text-onedark-muted">
                            <span className="font-sans font-medium text-onedark-fg">{task.persona}</span>
                            <span className="px-2 py-0.5 rounded-md bg-onedark-surface/60 text-onedark-muted">
                              ~{outTokens} tokens out
                            </span>
                          </div>
                          <div className="text-onedark-fg text-[13px] sm:text-[13.5px] leading-relaxed w-full">
                            {isFullPlanDoc && planInfo ? (
                              <div className="w-full space-y-3 my-1">
                                <div className="rounded-xl border border-onedark-accent/30 bg-gradient-to-r from-onedark-accent/10 via-onedark-surface/35 to-transparent p-4 space-y-3 shadow-xs">
                                  <div className="flex items-start justify-between gap-3 flex-wrap sm:flex-nowrap">
                                    <div className="space-y-1.5 min-w-0">
                                      <div className="flex items-center space-x-2">
                                        <span className="w-2 h-2 rounded-full bg-onedark-accent animate-pulse shrink-0" />
                                        <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-onedark-accent">
                                          Implementation Plan Formulated
                                        </span>
                                      </div>
                                      <h3 className="text-sm font-semibold text-onedark-fgBright">
                                        {planInfo.title}
                                      </h3>
                                      {planInfo.overview && (
                                        <p className="text-xs text-onedark-fg/90 leading-relaxed line-clamp-3">
                                          {planInfo.overview}
                                        </p>
                                      )}
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (onOpenPlan) {
                                          onOpenPlan(task?.id, turn.plan);
                                        } else if (onOpenPreview && task?.id) {
                                          onOpenPreview(`plan://${task.id}`, 'Implementation Plan');
                                        }
                                      }}
                                      className="shrink-0 px-3.5 py-2 rounded-lg bg-onedark-accent hover:bg-onedark-accent/90 text-onedark-bg font-semibold text-xs flex items-center space-x-1.5 transition-all cursor-pointer shadow-xs active:scale-[0.98]"
                                      title="Open architectural plan in Web & Docs"
                                    >
                                      <Compass className="w-3.5 h-3.5" />
                                      <span>Open Full Plan Doc</span>
                                      <ArrowRight className="w-3 h-3 ml-0.5" />
                                    </button>
                                  </div>

                                  {planInfo.phases.length > 0 && (
                                    <div className="pt-2.5 border-t border-white/[0.06] space-y-2">
                                      <span className="text-[10.5px] font-mono text-onedark-muted uppercase tracking-wider">
                                        Key Execution Phases
                                      </span>
                                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-0.5">
                                        {planInfo.phases.map((ph, pIdx) => (
                                          <div key={pIdx} className="flex items-center space-x-2 px-2.5 py-1.5 rounded-md bg-onedark-surface/40 border border-onedark-borderSubtle/60 text-xs text-onedark-fg font-mono">
                                            <span className="w-1.5 h-1.5 rounded-full bg-onedark-accent shrink-0" />
                                            <span className="truncate">{ph}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  <div className="pt-1 flex items-center justify-between text-[11px] font-mono text-onedark-muted border-t border-white/[0.04]">
                                    <button
                                      type="button"
                                      onClick={() => setExpandedRawPlanMsgIds(prev => ({ ...prev, [m.id]: !prev[m.id] }))}
                                      className="hover:text-onedark-fg transition-colors flex items-center space-x-1 cursor-pointer"
                                    >
                                      <span>{isRawPlanExpanded ? 'Hide raw plan document' : 'View raw plan markdown'}</span>
                                      <ChevronRight className={`w-3 h-3 transition-transform ${isRawPlanExpanded ? 'rotate-90' : ''}`} />
                                    </button>
                                    <span>Full spec rendered in Web & Docs</span>
                                  </div>
                                </div>

                                {isRawPlanExpanded && (
                                  <div className="pt-2 pl-2 border-l-2 border-onedark-accent/30 text-xs">
                                    <MarkdownRenderer
                                      content={maskSecretsInText(m.content)}
                                      isStreaming={m.isStreaming}
                                      onLinkClick={handleMessageLinkClick}
                                    />
                                  </div>
                                )}
                              </div>
                            ) : m.content ? (
                              <MarkdownRenderer
                                content={maskSecretsInText(m.content)}
                                isStreaming={m.isStreaming}
                                onLinkClick={handleMessageLinkClick}
                              />
                            ) : m.isStreaming ? (
                              <div className="flex items-center min-h-[22px]">
                                <span className="terminal-cursor" title="Generating..." />
                              </div>
                            ) : null}
                          </div>
                          {/* Hover Action Bar */}
                          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center space-x-1 pl-0.5 pt-0.5">
                            <button
                              onClick={() => handleCopyText(m.id, m.content)}
                              className="p-1 rounded-md hover:bg-onedark-surface border border-transparent hover:border-onedark-border text-onedark-muted hover:text-onedark-fgBright transition-colors"
                              title="Copy response"
                            >
                              {copiedId === m.id ? (
                                <Check className="w-3.5 h-3.5 text-onedark-green" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                            {onRetryTask && !isRunning && (
                              <button
                                onClick={() => onRetryTask(turn.userMessage?.id)}
                                className="p-1 rounded-md hover:bg-onedark-surface border border-transparent hover:border-onedark-border text-onedark-muted hover:text-onedark-fgBright transition-colors"
                                title="Regenerate response"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {onResetTurn && !isRunning && (
                              <button
                                onClick={() => onResetTurn(tIdx + 1)}
                                className="p-1 rounded-md hover:bg-onedark-surface border border-transparent hover:border-onedark-border text-onedark-muted hover:text-onedark-yellow transition-colors"
                                title="Reset Turn (Rollback files & context to this turn)"
                              >
                                <Undo2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}

          {/* Pending Action Approval Card or Interactive Inquiry Card */}
          {latestApproval && (
            latestApproval.action_type === 'user_inquiry' ? (
              <InquiryCard
                taskId={task.id}
                approval={latestApproval}
                onResolved={() => {
                  if (onApprove) onApprove();
                }}
              />
            ) : (
              <div className="rounded-xl border border-onedark-border bg-onedark-surface p-4 space-y-3 shadow-md">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2 text-onedark-yellow font-semibold text-xs">
                    <ShieldAlert className="w-4 h-4 text-onedark-yellow" />
                    <span>Action Approval Required</span>
                  </div>
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-onedark-darker text-onedark-muted border border-onedark-border">
                    Gated Policy
                  </span>
                </div>

                <div className="p-3.5 rounded-lg bg-onedark-darker border border-onedark-border text-xs text-onedark-fg font-mono space-y-1 leading-relaxed">
                  <div><strong className="text-onedark-muted">Action:</strong> {latestApproval.action_type}</div>
                  <div><strong className="text-onedark-muted">Target:</strong> {latestApproval.action_details.title || latestApproval.action_details.branch}</div>
                  {latestApproval.action_details.description && (
                    <div className="mt-2 text-onedark-muted whitespace-pre-wrap text-xs">
                      {latestApproval.action_details.description}
                    </div>
                  )}
                </div>

                <div className="flex items-center space-x-2.5 pt-1">
                  <button
                    onClick={() => onApprove()}
                    className="py-2 px-3.5 rounded-lg bg-onedark-green hover:bg-onedark-green/90 text-onedark-darker font-bold text-xs flex items-center space-x-1.5 transition-colors shadow-sm"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Approve & Execute</span>
                  </button>

                  <button
                    onClick={() => onReject()}
                    className="py-2 px-3.5 rounded-lg bg-onedark-darker hover:bg-onedark-surface text-onedark-red border border-onedark-border text-xs font-semibold transition-colors"
                  >
                    <span>Reject</span>
                  </button>
                </div>
              </div>
            )
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Centralized Bottom Chat Input Bar */}
      <div className="p-4 bg-onedark-darker/90">
        <div className={`w-full ${contentMaxWidth} mx-auto`}>
          <form onSubmit={handleSubmit} className="flex flex-col space-y-2 relative z-20">
            {/* Repository Mention Autocomplete Menu */}
            {renderMentionMenu("bottom-full left-0 mb-2")}

            <div className="flex items-end space-x-2 bg-onedark-darker border border-onedark-border rounded-xl px-3.5 py-2 focus-within:border-onedark-accent/80 focus-within:ring-1 focus-within:ring-onedark-accent/20 transition-all shadow-inner min-h-[46px]">
              <div className="relative flex-1 min-h-[36px] max-h-[220px] flex items-center">
                {/* Highlight backdrop overlay */}
                {inputValue && (
                  <div
                    ref={chatBackdropRef}
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 w-full bg-transparent text-[15px] font-sans leading-relaxed py-1.5 whitespace-pre-wrap break-words overflow-y-auto select-none"
                  >
                    {renderHighlightedInputText(inputValue)}
                  </div>
                )}
                <textarea
                  ref={textareaRef}
                  rows={1}
                  value={inputValue}
                  onChange={handleInputChange}
                  onKeyUp={handleCursorMove}
                  onClick={handleCursorMove}
                  onSelect={handleCursorMove}
                  onKeyDown={handleKeyDown}
                  onScroll={(e) => {
                    if (chatBackdropRef.current) {
                      chatBackdropRef.current.scrollTop = e.currentTarget.scrollTop;
                      chatBackdropRef.current.scrollLeft = e.currentTarget.scrollLeft;
                    }
                  }}
                  placeholder={isRunning ? "Task is running... Type follow-up instructions or hit Stop..." : "Type instructions, or '@' to reference a registered repo (e.g. 'Get pending prs in @myproject')..."}
                  className={`w-full bg-transparent text-[15px] placeholder-onedark-muted/60 focus:outline-none resize-none font-sans leading-relaxed py-1.5 min-h-[36px] max-h-[220px] overflow-y-auto caret-onedark-yellow ${
                    inputValue ? 'text-transparent' : 'text-onedark-fgBright'
                  }`}
                />
              </div>
              {isRunning ? (
                <button
                  type="button"
                  onClick={() => onStopTask && onStopTask()}
                  className="h-9 px-3.5 rounded-xl bg-onedark-red hover:bg-onedark-red/90 text-white text-xs font-bold flex items-center space-x-1.5 transition-all shadow-sm flex-shrink-0 active:scale-95 animate-pulse cursor-pointer mb-0.5"
                  title="Stop execution (Esc)"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>Stop</span>
                </button>
              ) : isSubmitting ? (
                <button
                  type="button"
                  disabled
                  className="h-9 w-9 rounded-xl bg-onedark-accent/70 text-onedark-darker flex items-center justify-center transition-all shadow-sm flex-shrink-0 cursor-wait mb-0.5"
                  title="Processing request..."
                >
                  <Loader2 className="w-4 h-4 animate-spin stroke-[2.5]" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!inputValue.trim()}
                  className="h-9 w-9 rounded-xl bg-onedark-accent hover:bg-onedark-accent/90 text-onedark-darker disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-sm flex items-center justify-center flex-shrink-0 active:scale-95 cursor-pointer mb-0.5"
                  title="Send message (Enter ↵)"
                >
                  <Send className="w-4 h-4 stroke-[2.5]" />
                </button>
              )}
            </div>
            <div className="flex items-center justify-between px-1 text-[11px] text-onedark-muted font-mono select-none">
              <div className="flex items-center space-x-3 min-w-0 flex-1">
                <span className="flex-shrink-0">
                  <kbd className="px-1.5 py-0.5 rounded bg-onedark-surface/60 text-onedark-fgBright text-[10px]">Enter ↵</kbd> to send · <kbd className="px-1.5 py-0.5 rounded bg-onedark-surface/60 text-onedark-fgBright text-[10px]">Shift + Enter</kbd> for newline
                </span>
                {effectiveRepos.length > 0 && (
                  <div className="hidden sm:flex items-center space-x-1.5 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden py-0.5 min-w-0">
                    {effectiveRepos.slice(0, 3).map((r) => {
                      const tag = `@${r.full_name || r.name}`;
                      const isIncluded = inputValue.includes(tag);
                      return (
                        <button
                          key={r.id || r.full_name}
                          type="button"
                          onClick={() => {
                            if (!isIncluded) {
                              setInputValue((prev) => prev ? `${prev.trim()} ${tag} ` : `${tag} `);
                            }
                            textareaRef.current?.focus();
                          }}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition-all flex items-center space-x-1 cursor-pointer flex-shrink-0 max-w-[150px] ${
                            isIncluded
                              ? 'bg-onedark-accent/20 text-onedark-accent font-semibold'
                              : 'bg-onedark-surface/60 hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fgBright'
                          }`}
                          title={`Click to reference ${tag}`}
                        >
                          <FolderGit2 className="w-2.5 h-2.5 text-onedark-folder flex-shrink-0" />
                          <span className="truncate">{tag}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {showScrollBottomBtn && (
                  <button
                    type="button"
                    onClick={() => {
                      isAutoScrollEnabledRef.current = true;
                      setShowScrollBottomBtn(false);
                      scrollToBottom(true);
                    }}
                    className="text-onedark-accent hover:text-onedark-fgBright transition-colors flex items-center space-x-1 cursor-pointer font-medium flex-shrink-0"
                  >
                    <ChevronDown className="w-3 h-3" />
                    <span>Jump to latest</span>
                  </button>
                )}
              </div>
              {isRunning && (
                <span className="text-onedark-yellow flex items-center space-x-1 flex-shrink-0">
                  <kbd className="px-1.5 py-0.5 rounded bg-onedark-surface/60 text-onedark-yellow text-[10px]">Esc</kbd>
                  <span>to stop</span>
                </span>
              )}
            </div>
          </form>
        </div>
      </div>

      {/* Ephemeral Sandbox Filesystem & Runtime Inspector Modal */}
      {isSandboxModalOpen && task && (
        <SandboxInspectorModal
          task={task}
          onClose={() => setIsSandboxModalOpen(false)}
        />
      )}
    </div>
  );
};
