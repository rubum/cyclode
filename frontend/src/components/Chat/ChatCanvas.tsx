import React, { useState, useRef, useEffect, useMemo } from 'react';
import { 
  Send, 
  Sparkles, 
  Terminal, 
  CheckCircle2, 
  ChevronDown, 
  ChevronRight, 
  ShieldAlert, 
  Bot, 
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
  FolderGit2
} from 'lucide-react';
import { Task, TaskMessage, TaskLog } from '../../types';
import { MarkdownRenderer } from '../Common/MarkdownRenderer';
import { FormattedLogView } from '../Common/FormattedLogView';
import { SandboxInspectorModal } from '../Sandbox/SandboxInspectorModal';

interface ChatCanvasProps {
  task: Task | null;
  onSendMessage: (content: string) => void;
  onApprove: (feedback?: string) => void;
  onReject: (feedback?: string) => void;
  onNewChatWithPrompt?: (prompt: string, persona: string) => void;
  onEditMessage?: (messageId: string, newContent: string) => void;
  onRetryTask?: (fromMessageId?: string) => void;
  onStopTask?: () => void;
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  currentPreset?: 'standard' | 'wide' | 'fullscreen';
  onSetPreset?: (preset: 'standard' | 'wide' | 'fullscreen') => void;
  onOpenSandboxModal?: () => void;
}

interface ConversationTurn {
  id: string;
  userMessage?: {
    id: string;
    content: string;
    tokens?: number;
    created_at?: string;
  };
  thoughts: { id: string; thought: string; created_at: string; tokens?: number }[];
  logs: TaskLog[];
  agentMessages: TaskMessage[];
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

export const ChatCanvas: React.FC<ChatCanvasProps> = ({
  task,
  onSendMessage,
  onApprove,
  onReject,
  onNewChatWithPrompt,
  onEditMessage,
  onRetryTask,
  onStopTask,
  isSidebarCollapsed,
  onToggleSidebar,
  currentPreset,
  onSetPreset,
  onOpenSandboxModal,
}) => {
  const [inputValue, setInputValue] = useState('');
  const [selectedPersona, setSelectedPersona] = useState('PairProgrammer');
  const [openThoughts, setOpenThoughts] = useState<Record<string, boolean>>({});
  const [openActivities, setOpenActivities] = useState<Record<string, boolean>>({});
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isSandboxModalOpen, setIsSandboxModalOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isRunning = task?.status === 'RUNNING' || task?.status === 'INITIALIZING';

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
          // Deduplicate consecutive thoughts with identical text
          const lastThought = currentTurn.thoughts[currentTurn.thoughts.length - 1];
          if (!lastThought || lastThought.thought.trim() !== m.thought.trim()) {
            currentTurn.thoughts.push({
              id: m.id,
              thought: m.thought,
              created_at: m.created_at,
              tokens: m.tokens,
            });
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
        result[result.length - 1].agentMessages.push(m);
      }
    });

    // Distribute logs to turns
    if (result.length > 0) {
      allLogs.forEach((log) => {
        result[result.length - 1].logs.push(log);
      });
      result[result.length - 1].isLatest = true;
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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, isRunning, task?.approvals]);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = inputValue.trim();
    if (!trimmed) return;

    if (task) {
      onSendMessage(trimmed);
    } else if (onNewChatWithPrompt) {
      onNewChatWithPrompt(trimmed, selectedPersona);
    }
    setInputValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
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

  const starterTemplates = [
    {
      title: 'Auto Code Review',
      persona: 'CodeReviewer',
      prompt: 'Review PR #42 for acme/auth-service: check edge cases, null safety, and verify unit test passes.',
      icon: GitPullRequest,
      color: 'text-onedark-green',
      bgColor: 'bg-onedark-green/10',
    },
    {
      title: 'Fix Production Bug',
      persona: 'PairProgrammer',
      prompt: 'Investigate KeyError in auth_service.py: add defensive fallback and verify with pytest.',
      icon: Bug,
      color: 'text-onedark-red',
      bgColor: 'bg-onedark-red/10',
    },
    {
      title: 'APM Triage Alert',
      persona: 'APMTriage',
      prompt: 'Triage Sentry 500 spike alert on auth-service and create isolated regression test in sandbox.',
      icon: Activity,
      color: 'text-onedark-yellow',
      bgColor: 'bg-onedark-yellow/10',
    },
    {
      title: 'Test Verification',
      persona: 'PairProgrammer',
      prompt: 'Run automated test suite in disposable sandbox and check for coverage regressions.',
      icon: FileCode2,
      color: 'text-onedark-purple',
      bgColor: 'bg-onedark-purple/10',
    },
  ];

  const personas = [
    { id: 'PairProgrammer', label: 'Pair Programmer (Default)' },
    { id: 'CodeReviewer', label: 'Code Reviewer (PRs & Diffs)' },
    { id: 'IssueResolver', label: 'Issue Resolver (Bugfixer)' },
    { id: 'APMTriage', label: 'APM Triage (Sentry / AppSignal)' },
  ];

  // Empty State / New Task Launcher
  if (!task) {
    return (
      <div className="flex flex-col h-full bg-onedark-bg relative font-sans text-onedark-fg overflow-y-auto">
        {/* Top Control Bar in Empty State */}
        <div className="h-10 px-4 border-b border-onedark-borderSubtle bg-onedark-darker/70 flex items-center justify-between text-xs text-onedark-muted select-none flex-shrink-0">
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

          {onSetPreset && (
            <div className="flex items-center space-x-0.5 bg-onedark-surface/60 p-0.5 rounded-lg border border-onedark-borderSubtle font-mono text-[10.5px]">
              <button
                onClick={() => onSetPreset('standard')}
                className={`px-2 py-0.5 rounded-md transition-all ${
                  currentPreset === 'standard'
                    ? 'bg-onedark-darker text-onedark-fgBright font-semibold shadow-xs'
                    : 'text-onedark-muted hover:text-onedark-fg hover:bg-onedark-darker/40'
                }`}
              >
                Standard
              </button>
              <button
                onClick={() => onSetPreset('wide')}
                className={`px-2 py-0.5 rounded-md transition-all ${
                  currentPreset === 'wide'
                    ? 'bg-onedark-darker text-onedark-fgBright font-semibold shadow-xs'
                    : 'text-onedark-muted hover:text-onedark-fg hover:bg-onedark-darker/40'
                }`}
              >
                Wide
              </button>
              <button
                onClick={() => onSetPreset('fullscreen')}
                className={`px-2 py-0.5 rounded-md transition-all ${
                  currentPreset === 'fullscreen'
                    ? 'bg-onedark-darker text-onedark-fgBright font-semibold shadow-xs'
                    : 'text-onedark-muted hover:text-onedark-fg hover:bg-onedark-darker/40'
                }`}
              >
                Zen ⛶
              </button>
            </div>
          )}
        </div>

        <div className="w-full max-w-3xl lg:max-w-4xl xl:max-w-5xl mx-auto px-6 py-12 flex flex-col justify-center flex-1 space-y-8">
          {/* Header Hero */}
          <div className="text-center space-y-2.5">
            <div className="inline-flex items-center space-x-2 px-3.5 py-1 rounded-full bg-onedark-accent/10 border border-onedark-accent/20 text-onedark-accent text-xs font-mono mb-2 shadow-sm">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Event-Driven Autonomous Multi-Agent Orchestrator</span>
            </div>
            <h1 className="text-3xl font-extrabold text-onedark-fgBright tracking-tight sm:text-4xl">
              What do you want to build or automate?
            </h1>
            <p className="text-sm text-onedark-muted max-w-xl mx-auto leading-relaxed">
              Connect to remote repositories, trigger standing event automations, or execute tasks in disposable ephemeral sandboxes.
            </p>
          </div>

          {/* Prompt Launcher Form */}
          <form
            onSubmit={handleSubmit}
            className="p-3.5 rounded-2xl bg-onedark-darker border border-onedark-border shadow-xl focus-within:border-onedark-accent/80 focus-within:ring-2 focus-within:ring-onedark-accent/20 transition-all space-y-3"
          >
            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask Adappty to review a PR, investigate a bug, write tests, or triage an APM incident..."
              rows={3}
              className="w-full bg-transparent text-sm text-onedark-fgBright placeholder-onedark-muted focus:outline-none resize-none font-sans leading-relaxed p-1.5"
            />

            <div className="flex items-center justify-between pt-2 border-t border-onedark-borderSubtle">
              {/* Persona Selector */}
              <div className="flex items-center space-x-2">
                <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-onedark-surface border border-onedark-border text-xs text-onedark-fg font-mono shadow-sm">
                  <Bot className="w-3.5 h-3.5 text-onedark-accent" />
                  <select
                    value={selectedPersona}
                    onChange={(e) => setSelectedPersona(e.target.value)}
                    className="bg-transparent text-onedark-fg focus:outline-none cursor-pointer text-xs"
                  >
                    {personas.map((p) => (
                      <option key={p.id} value={p.id} className="bg-onedark-darker text-onedark-fg">
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={!inputValue.trim()}
                className="px-4 py-2 rounded-xl bg-onedark-accent hover:bg-onedark-accent/90 text-onedark-darker text-xs font-bold flex items-center space-x-1.5 transition-all duration-150 disabled:opacity-35 disabled:cursor-not-allowed shadow-sm active:scale-95"
              >
                <span>Run Task</span>
                <ArrowRight className="w-3.5 h-3.5 stroke-[2.5]" />
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
                  onClick={() => {
                    if (onNewChatWithPrompt) {
                      onNewChatWithPrompt(item.prompt, item.persona);
                    }
                  }}
                  className="p-4 rounded-xl bg-onedark-darker border border-onedark-borderSubtle hover:border-onedark-accent/50 hover:bg-onedark-surface/40 text-left transition-all duration-150 space-y-2 group shadow-sm flex flex-col justify-between"
                >
                  <div className="space-y-1.5 w-full">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <div className={`p-1.5 rounded-lg ${item.bgColor} ${item.color}`}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <span className="text-sm font-semibold text-onedark-fgBright group-hover:text-onedark-accent transition-colors">
                          {item.title}
                        </span>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-onedark-muted opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
                    </div>
                    <p className="text-xs text-onedark-muted line-clamp-2 leading-relaxed pl-0.5">
                      {item.prompt}
                    </p>
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
      <div className="h-10 px-3.5 border-b border-onedark-borderSubtle bg-onedark-darker/95 backdrop-blur-sm flex items-center justify-between gap-3 z-10 select-none flex-shrink-0">
        {/* Left: Sidebar Toggle, Repo Breadcrumb, Task Title */}
        <div className="flex items-center space-x-2.5 min-w-0 flex-1">
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
            <div className="flex items-center space-x-1 px-2 py-0.5 rounded-md bg-onedark-surface/60 border border-onedark-borderSubtle text-[11px] font-mono text-onedark-fgBright flex-shrink-0">
              <FolderGit2 className="w-3 h-3 text-onedark-accent" />
              <span>{task.repo_name}</span>
            </div>
          )}

          <h1 className="text-xs sm:text-sm font-bold text-onedark-fgBright truncate tracking-tight" title={task.title}>
            {task.title}
          </h1>
        </div>

        {/* Right: Sandbox, Status Badge, Presets, Retry */}
        <div className="flex items-center space-x-2 flex-shrink-0">
          {/* Status Badge */}
          <div className="flex items-center space-x-1.5">
            <span
              className={`px-2 py-0.5 rounded-full text-[10.5px] font-mono border flex items-center space-x-1 ${
                task.status === 'RUNNING' || task.status === 'INITIALIZING'
                  ? 'bg-onedark-yellow/10 text-onedark-yellow border-onedark-yellow/30'
                  : task.status === 'COMPLETED'
                  ? 'bg-onedark-green/10 text-onedark-green border-onedark-green/30'
                  : task.status === 'AWAITING_INPUT'
                  ? 'bg-onedark-accent/10 text-onedark-accent border-onedark-accent/30'
                  : task.status === 'AWAITING_APPROVAL'
                  ? 'bg-onedark-blue/10 text-onedark-blue border-onedark-blue/30'
                  : task.status === 'FAILED'
                  ? 'bg-onedark-red/10 text-onedark-red border-onedark-red/30'
                  : 'bg-onedark-surface text-onedark-muted border-onedark-borderSubtle'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  task.status === 'RUNNING' || task.status === 'INITIALIZING'
                    ? 'bg-onedark-yellow animate-pulse'
                    : task.status === 'COMPLETED'
                    ? 'bg-onedark-green'
                    : task.status === 'AWAITING_INPUT'
                    ? 'bg-onedark-accent'
                    : task.status === 'FAILED'
                    ? 'bg-onedark-red'
                    : 'bg-onedark-muted'
                }`}
              />
              <span>{task.status.replace('_', ' ')}</span>
            </span>
          </div>

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
              className={`px-2 py-0.5 rounded-md text-[11px] font-mono border flex items-center space-x-1.5 transition-all shadow-xs active:scale-95 cursor-pointer ${
                task.sandbox_status === 'ACTIVE'
                  ? 'bg-onedark-green/15 text-onedark-green border-onedark-green/30 hover:bg-onedark-green/25'
                  : task.sandbox_status === 'PROVISIONING'
                  ? 'bg-onedark-yellow/15 text-onedark-yellow border-onedark-yellow/30 hover:bg-onedark-yellow/25'
                  : task.sandbox_status === 'AUTH_REQUIRED'
                  ? 'bg-onedark-accent/15 text-onedark-accent border-onedark-accent/30 hover:bg-onedark-accent/25'
                  : 'bg-onedark-surface text-onedark-muted border-onedark-borderSubtle hover:bg-onedark-surface/80 hover:text-onedark-fg'
              }`}
              title="Inspect Sandbox Environment & Filesystem"
            >
              <Box className="w-3 h-3" />
              <span>Sandbox: {task.sandbox_status === 'DESTROYED' ? 'Destroyed' : task.sandbox_status.toLowerCase()} ↗</span>
            </button>
          )}

          {/* Presets */}
          {onSetPreset && (
            <div className="hidden sm:flex items-center space-x-0.5 bg-onedark-surface/60 p-0.5 rounded-lg border border-onedark-borderSubtle font-mono text-[10.5px]">
              <button
                onClick={() => onSetPreset('standard')}
                className={`px-2 py-0.5 rounded-md transition-all ${
                  currentPreset === 'standard'
                    ? 'bg-onedark-darker text-onedark-fgBright font-semibold shadow-xs'
                    : 'text-onedark-muted hover:text-onedark-fg hover:bg-onedark-darker/40'
                }`}
                title="Standard (Sidebar + Main + Aux)"
              >
                Standard
              </button>
              <button
                onClick={() => onSetPreset('wide')}
                className={`px-2 py-0.5 rounded-md transition-all ${
                  currentPreset === 'wide'
                    ? 'bg-onedark-darker text-onedark-fgBright font-semibold shadow-xs'
                    : 'text-onedark-muted hover:text-onedark-fg hover:bg-onedark-darker/40'
                }`}
                title="Wide (Collapsed Sidebar)"
              >
                Wide
              </button>
              <button
                onClick={() => onSetPreset('fullscreen')}
                className={`px-2 py-0.5 rounded-md transition-all ${
                  currentPreset === 'fullscreen'
                    ? 'bg-onedark-darker text-onedark-fgBright font-semibold shadow-xs'
                    : 'text-onedark-muted hover:text-onedark-fg hover:bg-onedark-darker/40'
                }`}
                title="Zen View (Canvas only)"
              >
                Zen ⛶
              </button>
            </div>
          )}

          {/* Retry Action */}
          {onRetryTask && !isRunning && (
            <button
              onClick={() => onRetryTask()}
              className="px-2 py-0.5 rounded-md border border-onedark-border bg-onedark-surface hover:bg-onedark-surface/90 text-onedark-muted hover:text-onedark-fgBright text-[11px] font-mono flex items-center space-x-1 transition-all shadow-xs active:scale-95 cursor-pointer"
              title="Retry / Regenerate response"
            >
              <RotateCcw className="w-3 h-3" />
              <span className="hidden md:inline">Retry</span>
            </button>
          )}
        </div>
      </div>

      {/* Centralized Conversation Feed */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="w-full max-w-3xl lg:max-w-4xl xl:max-w-5xl mx-auto space-y-6">
          {turns.map((turn, tIdx) => {
            const isTurnOpen = openThoughts[turn.id] ?? (isRunning && turn.isLatest);
            const isActOpen = openActivities[turn.id] ?? false;
            const hasThoughts = turn.thoughts.length > 0;
            const hasLogs = turn.logs.length > 0;
            const isTurnRunning = isRunning && turn.isLatest && turn.agentMessages.length === 0;

            return (
              <div key={turn.id || tIdx} className="space-y-4">
                {/* 1. User Message Block (with Input Token Metric) */}
                {turn.userMessage && (
                  <div className="flex justify-end group">
                    {editingMessageId === turn.userMessage.id ? (
                      <div className="w-full max-w-2xl p-3 rounded-2xl bg-onedark-surface border border-onedark-accent/60 shadow-lg space-y-2">
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
                      <div className="relative max-w-2xl flex flex-col items-end space-y-1">
                        <div className="flex items-center space-x-2 mb-0.5 pr-1 text-[11px] font-mono text-onedark-muted">
                          <span className="px-2 py-0.5 rounded-full bg-onedark-surface border border-onedark-borderSubtle text-onedark-muted">
                            ~{turn.userMessage.tokens || estimateTokens(turn.userMessage.content)} tokens in
                          </span>
                        </div>
                        <div className="px-4 py-3 rounded-2xl bg-onedark-surface border border-onedark-border text-onedark-fgBright font-sans text-sm leading-relaxed shadow-sm">
                          <div className="whitespace-pre-wrap">{maskSecretsInText(turn.userMessage.content)}</div>
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
                          <button
                            onClick={() => handleCopyText(turn.userMessage!.id, turn.userMessage!.content)}
                            className="p-1 rounded-md hover:bg-onedark-surface border border-transparent hover:border-onedark-border text-onedark-muted hover:text-onedark-fgBright transition-colors"
                            title="Copy text"
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

                {/* 2. Reasoning Process Accordion (Placed JUST ABOVE EACH RESPONSE) */}
                {hasThoughts && (
                  <div className="rounded-xl border border-onedark-border bg-onedark-darker/60 overflow-hidden shadow-sm transition-all">
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
                          <span className="px-2 py-0.5 rounded-full bg-onedark-yellow/10 text-onedark-yellow text-[10.5px] font-mono border border-onedark-yellow/30 flex items-center space-x-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-onedark-yellow animate-pulse" />
                            <span>Thinking...</span>
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-md bg-onedark-surface text-onedark-muted text-[10.5px] font-mono border border-onedark-borderSubtle">
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
                      <div className="p-3.5 border-t border-onedark-borderSubtle space-y-2 text-xs text-onedark-fg font-mono leading-relaxed bg-onedark-darker/90 max-h-80 overflow-y-auto">
                        {turn.thoughts.map((m, idx) => (
                          <div key={m.id || idx} className="pl-3 border-l-2 border-onedark-accent/40 py-0.5">
                            <div className="whitespace-pre-wrap">{m.thought}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 3. Turn Workspace Activity (Placed JUST ABOVE RESPONSE) */}
                {hasLogs && (
                  <div className="rounded-xl border border-onedark-border bg-onedark-darker/60 overflow-hidden shadow-sm transition-all">
                    <button
                      type="button"
                      onClick={() => setOpenActivities((prev) => ({ ...prev, [turn.id]: !isActOpen }))}
                      className="w-full px-3.5 py-2.5 flex items-center justify-between text-xs text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/30 transition-colors cursor-pointer select-none"
                    >
                      <div className="flex items-center space-x-2">
                        <Zap className="w-3.5 h-3.5 text-onedark-accent" />
                        <span className="font-mono text-xs font-medium text-onedark-fg">
                          Workspace Activity
                        </span>
                        <span className="text-[11px] text-onedark-muted font-mono">
                          ({turn.logs.length} tool{turn.logs.length > 1 ? 's' : ''} executed)
                        </span>
                      </div>

                      <div className="flex items-center space-x-2">
                        <span className="px-2 py-0.5 rounded-md bg-onedark-surface text-onedark-muted text-[10.5px] font-mono border border-onedark-borderSubtle">
                          {isActOpen ? 'Hide' : 'Show details'}
                        </span>
                        {isActOpen ? (
                          <ChevronDown className="w-4 h-4 text-onedark-muted" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-onedark-muted" />
                        )}
                      </div>
                    </button>

                    {isActOpen && (
                      <div className="p-3 border-t border-onedark-borderSubtle space-y-2 bg-onedark-darker/90">
                        {turn.logs.map((log, idx) => (
                          <FormattedLogView
                            key={log.id || idx}
                            log={log}
                            initiallyExpanded={false}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 4. Live Thinking / Responding Indicator (Shown when turn is active) */}
                {isTurnRunning && (
                  <div className="flex items-start space-x-3 pt-1">
                    <div className="w-7 h-7 rounded-lg bg-onedark-surface border border-onedark-accent/40 flex items-center justify-center flex-shrink-0 mt-0.5 shadow-sm animate-pulse">
                      <Bot className="w-4 h-4 text-onedark-accent" />
                    </div>

                    <div className="p-4 rounded-2xl bg-onedark-darker/90 border border-onedark-accent/30 shadow-md space-y-2.5 max-w-2xl w-full animate-fadeIn">
                      <div className="flex items-center space-x-2 text-xs font-mono text-onedark-accent">
                        <span className="w-2 h-2 rounded-full bg-onedark-accent animate-ping" />
                        <span className="font-semibold">Adappty is thinking & executing...</span>
                      </div>

                      {latestThoughtText && (
                        <div className="p-2.5 rounded-lg bg-onedark-surface/60 border border-onedark-borderSubtle text-xs text-onedark-fg font-mono leading-relaxed italic">
                          "{latestThoughtText}"
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* 5. Agent Messages (with Token Output Metric) */}
                {turn.agentMessages.map((m) => {
                  const outTokens = m.tokens || estimateTokens(m.content);
                  return (
                    <div
                      key={m.id}
                      className={`flex items-start space-x-3 group ${
                        m.sender === 'system' ? 'justify-center' : 'justify-start'
                      }`}
                    >
                      {m.sender !== 'system' && (
                        <div className="w-7 h-7 rounded-xl bg-onedark-accent/15 border border-onedark-accent/30 text-onedark-accent flex items-center justify-center flex-shrink-0 mt-0.5 shadow-sm">
                          <Bot className="w-4 h-4" />
                        </div>
                      )}

                      {m.sender === 'system' ? (
                        <div className="my-2 px-4 py-2.5 rounded-xl bg-onedark-surface/40 border border-onedark-border text-xs text-onedark-fg font-mono leading-relaxed max-w-2xl text-center">
                          <MarkdownRenderer content={maskSecretsInText(m.content)} />
                        </div>
                      ) : (
                        <div className="max-w-3xl w-full flex flex-col items-start space-y-1.5">
                          <div className="flex items-center justify-between w-full px-1 text-[11px] font-mono text-onedark-muted">
                            <span className="font-sans font-medium text-onedark-fg">{task.persona}</span>
                            <span className="px-2 py-0.5 rounded-md bg-onedark-surface border border-onedark-borderSubtle text-onedark-muted">
                              🪙 ~{outTokens} tokens out
                            </span>
                          </div>
                          <div className="px-5 py-4 rounded-2xl bg-onedark-darker/90 border border-onedark-border text-onedark-fg text-sm leading-relaxed shadow-sm w-full">
                            <MarkdownRenderer content={maskSecretsInText(m.content)} />
                          </div>
                          {/* Hover Action Bar */}
                          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center space-x-1 pl-1">
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
                                onClick={() => onRetryTask()}
                                className="p-1 rounded-md hover:bg-onedark-surface border border-transparent hover:border-onedark-border text-onedark-muted hover:text-onedark-fgBright transition-colors"
                                title="Regenerate response"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
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

          {/* Pending Action Approval Card */}
          {latestApproval && (
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
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Centralized Bottom Chat Input Bar */}
      <div className="p-4 border-t border-onedark-borderSubtle bg-onedark-darker/90">
        <div className="w-full max-w-3xl lg:max-w-4xl xl:max-w-5xl mx-auto">
          <form onSubmit={handleSubmit} className="flex flex-col space-y-2">
            <div className="flex items-center space-x-2 bg-onedark-darker border border-onedark-border rounded-xl px-3 py-1.5 focus-within:border-onedark-accent/80 focus-within:ring-1 focus-within:ring-onedark-accent/20 transition-all shadow-inner">
              <textarea
                rows={1}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isRunning ? "Task is running... Type follow-up instructions or hit Stop..." : "Type instructions, questions, or feedback to the agent..."}
                className="flex-1 bg-transparent text-sm text-onedark-fgBright placeholder-onedark-muted focus:outline-none resize-none font-sans leading-relaxed py-1.5 max-h-32 min-h-[32px]"
              />
              {isRunning && onStopTask ? (
                <button
                  type="button"
                  onClick={() => onStopTask()}
                  className="px-3 py-1.5 rounded-xl bg-onedark-red hover:bg-onedark-red/90 text-white text-xs font-bold flex items-center space-x-1.5 transition-all shadow-sm flex-shrink-0 active:scale-95 animate-pulse"
                  title="Stop execution (Esc)"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>Stop</span>
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!inputValue.trim()}
                  className="p-2 rounded-xl bg-onedark-accent hover:bg-onedark-accent/90 text-onedark-darker disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-sm flex-shrink-0 active:scale-95"
                  title="Send message (Enter ↵)"
                >
                  <Send className="w-4 h-4 stroke-[2.5]" />
                </button>
              )}
            </div>
            <div className="flex items-center justify-between px-1 text-[11px] text-onedark-muted font-mono select-none">
              <span>
                <kbd className="px-1.5 py-0.5 rounded bg-onedark-surface border border-onedark-border text-onedark-fgBright text-[10px]">Enter ↵</kbd> to send · <kbd className="px-1.5 py-0.5 rounded bg-onedark-surface border border-onedark-border text-onedark-fgBright text-[10px]">Shift + Enter</kbd> for newline
              </span>
              {isRunning && (
                <span className="text-onedark-yellow flex items-center space-x-1">
                  <kbd className="px-1.5 py-0.5 rounded bg-onedark-surface border border-onedark-border text-onedark-yellow text-[10px]">Esc</kbd>
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
