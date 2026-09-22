import React, { useState, useMemo } from 'react';
import { 
  Plus, 
  Layers, 
  MessageSquare, 
  Inbox, 
  FlaskConical, 
  ShieldCheck, 
  PlugZap, 
  Sparkles,
  Clock,
  Trash2,
  Settings,
  PanelLeftClose,
  FolderGit2,
  Pencil,
  Check,
  X,
  Search,
  GitPullRequest,
  Play,
  FileCode2,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  RefreshCw
} from 'lucide-react';
import { Task, TaskPR } from '../../types';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { ConfirmModal } from '../Common/ConfirmModal';
import { CyclodeIcon } from '../Common/CyclodeIcon';
import { ThemeColorPicker } from '../Theme/ThemeColorPicker';

interface SidebarProps {
  activeView: string;
  setActiveView: (view: string) => void;
  tasks: Task[];
  activeTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  onNewChat: () => void;
  onDeleteTask?: (taskId: string) => void;
  onClearAllTasks?: () => void;
  isClearingAll?: boolean;
  deletingTaskId?: string | null;
  onUpdateTaskTitle?: (taskId: string, newTitle: string) => void;
  onOpenSettings?: () => void;
  activeAgentsCount?: number;
  onToggleSidebar?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeView,
  setActiveView,
  tasks,
  activeTaskId,
  onSelectTask,
  onNewChat,
  onDeleteTask,
  onClearAllTasks,
  isClearingAll = false,
  deletingTaskId = null,
  onUpdateTaskTitle,
  onOpenSettings,
  activeAgentsCount = 0,
  onToggleSidebar,
}) => {
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string>('');
  const [sessionSearchQuery, setSessionSearchQuery] = useState<string>('');

  const filteredTasks = useMemo(() => {
    const primaryTasks = tasks.filter((t) => !t.is_subsession);
    if (!sessionSearchQuery.trim()) return primaryTasks;
    const q = sessionSearchQuery.toLowerCase();
    return primaryTasks.filter((t) =>
      (t.title && t.title.toLowerCase().includes(q)) ||
      (t.repo_name && t.repo_name.toLowerCase().includes(q)) ||
      (t.description && t.description.toLowerCase().includes(q))
    );
  }, [tasks, sessionSearchQuery]);

  const handleCommitEdit = (taskId: string) => {
    if (editingTitle.trim() && onUpdateTaskTitle) {
      onUpdateTaskTitle(taskId, editingTitle.trim());
    }
    setEditingTaskId(null);
  };
  const { isConnected, isConnecting, reconnect } = useWebSocket();
  const [taskToDelete, setTaskToDelete] = useState<Task | null>(null);
  const [isClearAllOpen, setIsClearAllOpen] = useState(false);

  const primaryTasksCount = useMemo(() => tasks.filter((t) => !t.is_subsession).length, [tasks]);

  const toolNavItems = [
    { id: 'repositories', label: 'Repositories & Vault', icon: FolderGit2, iconClass: 'text-onedark-folder' },
    { id: 'automations', label: 'Automations & Rules', icon: Sparkles },
    { id: 'fleet', label: 'Agent Fleet', icon: Layers, badge: primaryTasksCount > 0 ? primaryTasksCount : undefined },
    { id: 'events', label: 'Event Inbox', icon: Inbox },
    { id: 'simulator', label: 'Webhook Simulator', icon: FlaskConical },
    { id: 'policies', label: 'Approval Policies', icon: ShieldCheck },
    { id: 'integrations', label: 'Integrations', icon: PlugZap },
  ];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'RUNNING':
        return 'text-onedark-yellow bg-onedark-yellow/10';
      case 'COMPLETED':
        return 'text-onedark-green bg-onedark-green/10';
      case 'IDLE':
        return 'text-onedark-purple bg-onedark-purple/10';
      case 'AWAITING_APPROVAL':
      case 'AWAITING_INPUT':
        return 'text-onedark-accent bg-onedark-accent/10';
      case 'FAILED':
        return 'text-onedark-red bg-onedark-red/10';
      default:
        return 'text-onedark-muted bg-onedark-surface/60';
    }
  };

  const getStatusDot = (status: string) => {
    switch (status) {
      case 'RUNNING':
        return 'bg-onedark-yellow animate-pulse';
      case 'COMPLETED':
        return 'bg-onedark-green';
      case 'IDLE':
        return 'bg-onedark-purple';
      case 'AWAITING_APPROVAL':
      case 'AWAITING_INPUT':
        return 'bg-onedark-accent animate-pulse';
      case 'FAILED':
        return 'bg-onedark-red';
      default:
        return 'bg-onedark-muted';
    }
  };

  const formatStatus = (status: string) => {
    switch (status) {
      case 'RUNNING':
        return 'Running';
      case 'COMPLETED':
        return 'Done';
      case 'FAILED':
        return 'Failed';
      case 'IDLE':
        return 'Standby';
      case 'AWAITING_APPROVAL':
        return 'Approval';
      case 'AWAITING_INPUT':
        return 'Input';
      default:
        return status.toLowerCase();
    }
  };

  return (
    <div className="flex flex-col h-full bg-onedark-darker select-none text-onedark-fg font-sans">
      {/* Top Action: New Session Button */}
      <div className="p-3 pb-2">
        <button
          onClick={() => {
            onNewChat();
            setActiveView('chat');
          }}
          className="w-full flex items-center justify-between py-2 px-3 rounded-lg bg-onedark-surface/60 hover:bg-onedark-surface text-onedark-fgBright font-medium text-xs transition-all shadow-xs active:scale-[0.98] group cursor-pointer"
        >
          <div className="flex items-center space-x-2">
            <div className="w-4 h-4 rounded bg-onedark-yellow/15 flex items-center justify-center text-onedark-yellow group-hover:scale-105 transition-transform">
              <Plus className="w-3 h-3 stroke-[2.5]" />
            </div>
            <span>New Session</span>
          </div>
          <span className="text-[10px] font-mono text-onedark-muted/60 group-hover:text-onedark-muted bg-onedark-darker/60 px-1.5 py-0.5 rounded">
            +
          </span>
        </button>
      </div>

      {/* Fixed Header Section: Recent Sessions & Clear All & Search */}
      <div className="px-3 pt-3 pb-1 flex flex-col flex-shrink-0 select-none">
        <div className="px-1 flex items-center justify-between text-[11px] font-semibold tracking-wider text-onedark-muted uppercase mb-1.5">
          <div className="flex items-center space-x-1.5">
            <span>Recent Sessions</span>
            {primaryTasksCount > 0 && (
              <span className="font-mono text-[10px] text-onedark-muted font-normal">
                ({primaryTasksCount})
              </span>
            )}
          </div>
          <div className="flex items-center space-x-2">
            {primaryTasksCount > 0 && onClearAllTasks && (
              isClearingAll ? (
                <div className="flex items-center space-x-1 text-[10px] text-onedark-red font-mono animate-pulse">
                  <RefreshCw className="w-3 h-3 animate-spin text-onedark-red" />
                  <span>Clearing...</span>
                </div>
              ) : (
                <button
                  onClick={() => setIsClearAllOpen(true)}
                  className="text-[10px] font-normal text-onedark-muted hover:text-onedark-red transition-colors capitalize tracking-normal cursor-pointer"
                  title="Clear all recent sessions"
                >
                  clear all
                </button>
              )
            )}
          </div>
        </div>

        {primaryTasksCount > 2 && (
          <div className="mb-1">
            <div className="flex items-center space-x-1.5 bg-onedark-surface/40 rounded-md px-2 py-1 text-[11px] border border-transparent focus-within:border-onedark-accent/40 transition-colors">
              <Search className="w-3 h-3 text-onedark-muted flex-shrink-0" />
              <input
                type="text"
                value={sessionSearchQuery}
                onChange={(e) => setSessionSearchQuery(e.target.value)}
                placeholder="Search sessions..."
                className="w-full bg-transparent border-none text-[11px] text-onedark-fg focus:outline-none placeholder:text-onedark-muted/60"
              />
              {sessionSearchQuery && (
                <button
                  onClick={() => setSessionSearchQuery('')}
                  className="text-onedark-muted hover:text-onedark-fg cursor-pointer"
                  title="Clear search"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Primary Middle Section: Recent Sessions History (Scrollable) */}
      <div className={`flex-1 overflow-y-auto px-2 py-1 space-y-0.5 min-h-0 relative transition-all duration-300 ${
        isClearingAll ? 'opacity-35 pointer-events-none select-none' : ''
      }`}>
        {isClearingAll && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-onedark-darker/60 backdrop-blur-[1px] rounded-lg">
            <RefreshCw className="w-5 h-5 text-onedark-red animate-spin mb-1.5" />
            <span className="text-[11px] font-mono text-onedark-fgBright">Deleting all sessions...</span>
          </div>
        )}
        {primaryTasksCount === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-onedark-muted leading-relaxed">
            <Clock className="w-5 h-5 mx-auto mb-2 text-onedark-muted/60" />
            No active sessions.<br />Click New Session to begin.
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-onedark-muted leading-relaxed">
            No sessions match "{sessionSearchQuery}"
          </div>
        ) : (
          filteredTasks.map((task) => {
            const isSelected = activeTaskId === task.id && activeView === 'chat';
            const isBeingDeleted = deletingTaskId === task.id;
            return (
              <div
                key={task.id}
                onClick={() => {
                  if (isBeingDeleted || isClearingAll) return;
                  onSelectTask(task.id);
                  setActiveView('chat');
                }}
                className={`group w-full text-left px-2.5 py-1.5 rounded-lg transition-all cursor-pointer relative ${
                  isBeingDeleted ? 'opacity-45 pointer-events-none cursor-not-allowed' : ''
                } ${
                  isSelected
                    ? 'bg-onedark-surface/80 text-onedark-fgBright shadow-xs border-l-2 border-onedark-accent'
                    : 'bg-transparent hover:bg-onedark-surface/50 text-onedark-fg hover:text-onedark-fgBright border-l-2 border-transparent'
                }`}
              >
                <div className="flex items-center justify-between space-x-1.5">
                  {editingTaskId === task.id ? (
                    <div 
                      className="flex items-center space-x-1 flex-1 min-w-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="text"
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleCommitEdit(task.id);
                          } else if (e.key === 'Escape') {
                            e.preventDefault();
                            setEditingTaskId(null);
                          }
                        }}
                        autoFocus
                        className="flex-1 bg-onedark-bg border border-onedark-accent text-xs text-onedark-fgBright px-1.5 py-0.5 rounded outline-none w-full min-w-0 font-medium"
                      />
                      <button
                        onClick={() => handleCommitEdit(task.id)}
                        className="p-0.5 rounded hover:bg-onedark-green/20 text-onedark-green transition-all flex-shrink-0 cursor-pointer"
                        title="Save title"
                      >
                        <Check className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => setEditingTaskId(null)}
                        className="p-0.5 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg transition-all flex-shrink-0 cursor-pointer"
                        title="Cancel"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <span 
                        className="text-xs font-medium truncate text-onedark-fgBright flex-1 leading-snug"
                        title={task.title || 'Untitled Session'}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          if (onUpdateTaskTitle) {
                            setEditingTaskId(task.id);
                            setEditingTitle(task.title || '');
                          }
                        }}
                      >
                        {task.title || 'Untitled Session'}
                      </span>
                      <div className="flex items-center space-x-0.5 flex-shrink-0">
                        {onUpdateTaskTitle && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingTaskId(task.id);
                              setEditingTitle(task.title || '');
                            }}
                            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-onedark-accent/20 text-onedark-muted hover:text-onedark-accent transition-all flex-shrink-0 cursor-pointer"
                            title="Rename session"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                        )}
                        {isBeingDeleted ? (
                          <div className="p-0.5 text-onedark-red flex items-center justify-center flex-shrink-0" title="Deleting session...">
                            <RefreshCw className="w-3 h-3 animate-spin" />
                          </div>
                        ) : (
                          onDeleteTask && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setTaskToDelete(task);
                              }}
                              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-onedark-red/20 text-onedark-muted hover:text-onedark-red transition-all flex-shrink-0 cursor-pointer"
                              title="Delete session"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )
                        )}
                      </div>
                    </>
                  )}
                </div>
                <div className="flex items-center justify-between mt-0.5 text-[10px]">
                  <span className="text-onedark-muted font-sans text-[10px] truncate max-w-[130px]">
                    {task.persona}
                  </span>
                  <span className={`inline-flex items-center space-x-1 px-1.5 py-0.5 rounded text-[9px] font-mono leading-none ${getStatusColor(task.status)}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${getStatusDot(task.status)}`} />
                    <span>{formatStatus(task.status)}</span>
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Bottom Pinned Section: Workspace Tools & Management */}
      <div className="flex-shrink-0 border-t border-onedark-borderSubtle bg-onedark-darker/95 p-2 space-y-0.5">
        <div className="px-2.5 py-1 text-[10px] font-semibold tracking-wider text-onedark-muted/70 uppercase">
          Workspace & Tools
        </div>
        {toolNavItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveView(item.id)}
              className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-medium border transition-all cursor-pointer ${
                isActive
                  ? 'bg-onedark-surface text-onedark-fgBright font-semibold border-onedark-borderSubtle shadow-xs'
                  : 'border-transparent text-onedark-muted hover:text-onedark-fgBright hover:bg-onedark-surface/60 hover:border-onedark-borderSubtle'
              }`}
            >
              <div className="flex items-center space-x-2.5">
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-onedark-fgBright' : (item.iconClass || 'text-onedark-muted')}`} />
                <span>{item.label}</span>
              </div>
              {typeof item.badge === 'number' && item.badge > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-onedark-surface text-onedark-fg font-mono text-[10px] font-semibold">
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Sidebar Footer: Cyclode Brand, Settings, and Realtime Connection Badge */}
      <div className="p-3 bg-onedark-darker/95 flex flex-col space-y-2 select-none flex-shrink-0">
        <div className="flex items-center justify-between">
          {/* Brand Logo & Name */}
          <div className="flex items-center space-x-2">
            <CyclodeIcon className="w-6 h-6 flex-shrink-0" />
            <span className="font-bold text-[14px] tracking-tight text-onedark-fgBright font-sans">Cyclode</span>
          </div>

          {/* Realtime Connection Badge & Settings */}
          <div className="flex items-center space-x-1.5">
            <button 
              onClick={isConnected ? undefined : reconnect}
              disabled={isConnected}
              className={`flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10.5px] font-mono transition-all ${
                isConnected 
                  ? 'bg-onedark-green/15 text-onedark-green cursor-default' 
                  : isConnecting
                  ? 'bg-onedark-yellow/15 text-onedark-yellow cursor-wait'
                  : 'bg-onedark-red/15 text-onedark-red hover:bg-onedark-red/25 cursor-pointer active:scale-95'
              }`}
              title={
                isConnected 
                  ? "Realtime WebSocket stream connected" 
                  : isConnecting
                  ? "Connecting to backend WebSocket..."
                  : "WebSocket disconnected. Click to reconnect."
              }
            >
              <span className={`w-1.5 h-1.5 rounded-full ${
                isConnected 
                  ? 'bg-onedark-green animate-pulse' 
                  : isConnecting
                  ? 'bg-onedark-yellow animate-ping'
                  : 'bg-onedark-red'
              }`} />
              <span>{isConnected ? 'Live' : isConnecting ? 'Connecting' : 'Offline'}</span>
            </button>

            <ThemeColorPicker direction="up" align="right" />

            {onOpenSettings && (
              <button
                onClick={onOpenSettings}
                className="p-1 rounded-md hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fgBright transition-colors cursor-pointer"
                title="Policies & Global Settings"
              >
                <Settings className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {activeAgentsCount > 0 && (
          <div className="flex items-center justify-between text-[10.5px] font-mono text-onedark-muted px-1 pt-1.5">
            <span>Autonomous Fleet</span>
            <span className="text-onedark-yellow font-medium">{activeAgentsCount} Running</span>
          </div>
        )}
      </div>

      {/* Delete Single Task Confirm Modal */}
      <ConfirmModal
        isOpen={!!taskToDelete}
        isLoading={!!deletingTaskId}
        title="Delete Agent Session"
        description={`Are you sure you want to delete session "${taskToDelete?.title || 'Untitled'}"?`}
        confirmText="Delete Session"
        cancelText="Cancel"
        variant="danger"
        impactItems={[
          'Removes chat conversation history and agent thought logs',
          'Ephemeral workspace scratch directory will be cleaned up',
        ]}
        safeItems={[
          'Remote repositories and code branches are completely untouched',
        ]}
        onConfirm={async () => {
          if (taskToDelete && onDeleteTask) {
            try {
              await onDeleteTask(taskToDelete.id);
            } finally {
              setTaskToDelete(null);
            }
          }
        }}
        onCancel={() => {
          if (!deletingTaskId) setTaskToDelete(null);
        }}
      />

      {/* Clear All Tasks Confirm Modal */}
      <ConfirmModal
        isOpen={isClearAllOpen}
        isLoading={isClearingAll}
        title="Clear All Recent Sessions"
        description={`Are you sure you want to remove all ${tasks.length} recent sessions from your workstation history?`}
        confirmText="Clear All Sessions"
        cancelText="Cancel"
        variant="danger"
        impactItems={[
          `Clears conversation records and logs for ${tasks.length} agent sessions`,
          'Active agent runs will be stopped',
        ]}
        safeItems={[
          'Your repository configurations and Vault credentials remain saved',
          'Remote codebases are NEVER modified',
        ]}
        onConfirm={async () => {
          if (onClearAllTasks) {
            try {
              await onClearAllTasks();
            } finally {
              setIsClearAllOpen(false);
            }
          }
        }}
        onCancel={() => {
          if (!isClearingAll) setIsClearAllOpen(false);
        }}
      />
    </div>
  );
};
