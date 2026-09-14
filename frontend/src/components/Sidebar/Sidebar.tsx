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
  ExternalLink
} from 'lucide-react';
import { Task, TaskPR } from '../../types';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { ConfirmModal } from '../Common/ConfirmModal';
import { CyclodeIcon } from '../Common/CyclodeIcon';

interface SidebarProps {
  activeView: string;
  setActiveView: (view: string) => void;
  tasks: Task[];
  activeTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  onNewChat: () => void;
  onDeleteTask?: (taskId: string) => void;
  onClearAllTasks?: () => void;
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
        return 'text-onedark-yellow bg-onedark-yellow/10 border-onedark-yellow/20';
      case 'COMPLETED':
        return 'text-onedark-green bg-onedark-green/10 border-onedark-green/20';
      case 'IDLE':
        return 'text-onedark-purple bg-onedark-purple/10 border-onedark-purple/20';
      case 'AWAITING_APPROVAL':
        return 'text-onedark-accent bg-onedark-accent/10 border-onedark-accent/20';
      case 'AWAITING_INPUT':
        return 'text-onedark-accent bg-onedark-accent/10 border-onedark-accent/20';
      case 'FAILED':
        return 'text-onedark-red bg-onedark-red/10 border-onedark-red/20';
      default:
        return 'text-onedark-muted bg-onedark-surface border-onedark-border';
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
      case 'COMPLETED':
        return 'Done';
      case 'RUNNING':
        return 'Running';
      case 'IDLE':
        return 'Standby';
      case 'AWAITING_APPROVAL':
        return 'Approval';
      case 'AWAITING_INPUT':
        return 'Input';
      case 'FAILED':
        return 'Failed';
      case 'INITIALIZING':
        return 'Init';
      default:
        return status.replace('_', ' ');
    }
  };

  return (
    <div className="flex flex-col h-full bg-onedark-darker select-none border-r border-onedark-borderSubtle text-onedark-fg font-sans">
      {/* Top Action: New Session Button */}
      <div className="p-3 pb-2 border-b border-onedark-borderSubtle/60">
        <button
          onClick={() => {
            onNewChat();
            setActiveView('chat');
          }}
          className="w-full flex items-center justify-between py-2 px-3 rounded-lg bg-onedark-surface hover:bg-onedark-border/80 text-onedark-fgBright font-semibold text-xs border border-onedark-border transition-all shadow-xs active:scale-[0.98] group cursor-pointer"
        >
          <div className="flex items-center space-x-2">
            <div className="w-4 h-4 rounded bg-onedark-yellow/15 border border-onedark-yellow/30 flex items-center justify-center text-onedark-yellow group-hover:scale-105 transition-transform">
              <Plus className="w-3 h-3 stroke-[2.5]" />
            </div>
            <span>New Session</span>
          </div>
          <span className="text-[10px] font-mono text-onedark-muted/60 group-hover:text-onedark-muted bg-onedark-darker/60 px-1.5 py-0.5 rounded border border-onedark-borderSubtle">
            +
          </span>
        </button>
      </div>

      {/* Primary Middle Section: Recent Sessions History (Scrollable) */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1 min-h-0">
        <div className="px-2.5 flex items-center justify-between text-[11px] font-semibold tracking-wider text-onedark-muted uppercase mb-1">
          <div className="flex items-center space-x-1.5">
            <span>Recent Sessions</span>
            {tasks.length > 0 && (
              <span className="font-mono text-[10px] text-onedark-muted font-normal">
                ({tasks.length})
              </span>
            )}
          </div>
          <div className="flex items-center space-x-2">
            {tasks.length > 0 && onClearAllTasks && (
              <button
                onClick={() => setIsClearAllOpen(true)}
                className="text-[10px] font-normal text-onedark-muted hover:text-onedark-red transition-colors capitalize tracking-normal cursor-pointer"
                title="Clear all recent sessions"
              >
                clear all
              </button>
            )}
          </div>
        </div>

        {tasks.length > 2 && (
          <div className="px-1 mb-2">
            <div className="flex items-center space-x-1.5 bg-onedark-surface/40 rounded-md px-2 py-1 border border-onedark-borderSubtle text-[11px] focus-within:border-onedark-accent/50">
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

        {tasks.length === 0 ? (
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
            return (
              <div
                key={task.id}
                onClick={() => {
                  onSelectTask(task.id);
                  setActiveView('chat');
                }}
                className={`group w-full text-left px-2.5 py-1.5 rounded-lg border transition-all cursor-pointer relative ${
                  isSelected
                    ? 'bg-onedark-surface border-onedark-border text-onedark-fgBright shadow-xs'
                    : 'bg-onedark-surface/20 border-transparent hover:bg-onedark-surface/50 text-onedark-fg'
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
                        {onDeleteTask && (
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
                        )}
                      </div>
                    </>
                  )}
                </div>
                <div className="flex items-center justify-between mt-0.5 text-[10px]">
                  <span className="text-onedark-muted font-sans text-[10px] truncate max-w-[130px]">
                    {task.persona}
                  </span>
                  <span className={`inline-flex items-center space-x-1 px-1.5 py-0.2 rounded text-[9px] font-mono border leading-none ${getStatusColor(task.status)}`}>
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
              className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-onedark-surface text-onedark-fgBright font-semibold'
                  : 'text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/40'
              }`}
            >
              <div className="flex items-center space-x-2.5">
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-onedark-fgBright' : (item.iconClass || 'text-onedark-muted')}`} />
                <span>{item.label}</span>
              </div>
              {typeof item.badge === 'number' && item.badge > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-onedark-surface border border-onedark-border text-onedark-fg font-mono text-[10px] font-semibold">
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Sidebar Footer: Cyclode Brand, Settings, and Realtime Connection Badge */}
      <div className="p-3 border-t border-onedark-borderSubtle bg-onedark-darker/95 flex flex-col space-y-2 select-none flex-shrink-0">
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
              className={`flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10.5px] font-mono border transition-all ${
                isConnected 
                  ? 'bg-onedark-green/10 text-onedark-green border-onedark-green/30 cursor-default' 
                  : isConnecting
                  ? 'bg-onedark-yellow/10 text-onedark-yellow border-onedark-yellow/30 cursor-wait'
                  : 'bg-onedark-red/10 text-onedark-red border-onedark-red/30 hover:bg-onedark-red/20 cursor-pointer active:scale-95'
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
          <div className="flex items-center justify-between text-[10.5px] font-mono text-onedark-muted px-1 pt-1.5 border-t border-onedark-borderSubtle/50">
            <span>Autonomous Fleet</span>
            <span className="text-onedark-yellow font-medium">{activeAgentsCount} Running</span>
          </div>
        )}
      </div>

      {/* Delete Single Task Confirm Modal */}
      <ConfirmModal
        isOpen={!!taskToDelete}
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
        onConfirm={() => {
          if (taskToDelete && onDeleteTask) {
            onDeleteTask(taskToDelete.id);
            setTaskToDelete(null);
          }
        }}
        onCancel={() => setTaskToDelete(null)}
      />

      {/* Clear All Tasks Confirm Modal */}
      <ConfirmModal
        isOpen={isClearAllOpen}
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
        onConfirm={() => {
          if (onClearAllTasks) {
            onClearAllTasks();
          }
          setIsClearAllOpen(false);
        }}
        onCancel={() => setIsClearAllOpen(false)}
      />
    </div>
  );
};
