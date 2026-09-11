import { 
  Plus, 
  Layers, 
  MessageSquare, 
  Inbox, 
  FlaskConical, 
  ShieldCheck, 
  PlugZap,
  Sparkles,
  ChevronRight,
  Clock,
  Trash2,
  Settings,
  PanelLeftClose,
  FolderGit2
} from 'lucide-react';
import { Task } from '../../types';
import { useWebSocket } from '../../contexts/WebSocketContext';

interface SidebarProps {
  activeView: string;
  setActiveView: (view: string) => void;
  tasks: Task[];
  activeTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  onNewChat: () => void;
  onDeleteTask?: (taskId: string) => void;
  onClearAllTasks?: () => void;
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
  onOpenSettings,
  activeAgentsCount = 0,
  onToggleSidebar,
}) => {
  const { isConnected } = useWebSocket();
  const navItems = [
    { id: 'chat', label: 'Workstation / Chat', icon: MessageSquare },
    { id: 'repositories', label: 'Repositories & Vault', icon: FolderGit2, iconClass: 'text-onedark-folder' },
    { id: 'automations', label: 'Automations & Rules', icon: Sparkles },
    { id: 'fleet', label: 'Agent Fleet', icon: Layers, badge: tasks.length > 0 ? tasks.length : undefined },
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

  return (
    <div className="flex flex-col h-full bg-onedark-darker select-none border-r border-onedark-borderSubtle text-onedark-fg font-sans">
      {/* Primary Action Button */}
      <div className="p-3">
        <button
          onClick={onNewChat}
          className="w-full flex items-center justify-center space-x-2 py-2 px-3 rounded-lg bg-onedark-surface hover:bg-onedark-border text-onedark-fgBright font-semibold text-xs border border-onedark-border transition-all shadow-xs active:scale-95 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
          <span>New Session</span>
        </button>
      </div>

      {/* Main Navigation */}
      <div className="px-2 py-1 space-y-0.5 border-b border-onedark-borderSubtle">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveView(item.id)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-onedark-surface text-onedark-fgBright font-semibold'
                  : 'text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/40'
              }`}
            >
              <div className="flex items-center space-x-2.5">
                <Icon className={`w-4 h-4 ${isActive ? 'text-onedark-fgBright' : (item.iconClass || 'text-onedark-muted')}`} />
                <span>{item.label}</span>
              </div>
              {typeof item.badge === 'number' && item.badge > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-onedark-surface border border-onedark-border text-onedark-fg font-mono text-[10.5px] font-semibold">
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tasks List */}
      <div className="flex-1 overflow-y-auto px-2 py-3 space-y-1.5">
        <div className="px-2.5 flex items-center justify-between text-[11px] font-semibold tracking-wider text-onedark-muted uppercase mb-1">
          <div className="flex items-center space-x-1.5">
            <span>Recent Sessions</span>
            {tasks.length > 0 && (
              <span className="font-mono text-[10px] text-onedark-muted font-normal">
                ({tasks.length})
              </span>
            )}
          </div>
          {tasks.length > 0 && onClearAllTasks && (
            <button
              onClick={onClearAllTasks}
              className="text-[10px] font-normal text-onedark-muted hover:text-onedark-red transition-colors capitalize tracking-normal"
              title="Clear all recent sessions"
            >
              clear all
            </button>
          )}
        </div>

        {tasks.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-onedark-muted leading-relaxed">
            <Clock className="w-5 h-5 mx-auto mb-2 text-onedark-muted/60" />
            No active sessions.<br />Click New Session to begin.
          </div>
        ) : (
          tasks.map((task) => {
            const isSelected = activeTaskId === task.id && activeView === 'chat';
            return (
              <div
                key={task.id}
                onClick={() => {
                  onSelectTask(task.id);
                  setActiveView('chat');
                }}
                className={`group w-full text-left p-2.5 rounded-lg border transition-all cursor-pointer relative ${
                  isSelected
                    ? 'bg-onedark-surface border-onedark-border text-onedark-fgBright shadow-sm'
                    : 'bg-onedark-surface/20 border-transparent hover:bg-onedark-surface/50 text-onedark-fg'
                }`}
              >
                <div className="flex items-center justify-between space-x-2">
                  <span className="text-xs font-semibold truncate text-onedark-fgBright flex-1">
                    {task.title || 'Untitled Session'}
                  </span>
                  {onDeleteTask && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteTask(task.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-onedark-red/20 text-onedark-muted hover:text-onedark-red transition-all flex-shrink-0"
                      title="Delete session"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
                <div className="flex items-center justify-between mt-1.5 text-[11px]">
                  <span className="text-onedark-muted font-sans text-[11px] truncate">
                    {task.persona}
                  </span>
                  <span className={`px-1.5 py-0.5 rounded text-[9.5px] font-mono border ${getStatusColor(task.status)}`}>
                    {task.status === 'IDLE' ? 'STANDING BY' : task.status.replace('_', ' ')}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Sidebar Footer: Adappty Brand, Settings, and Realtime Connection Badge */}
      <div className="p-3 border-t border-onedark-borderSubtle bg-onedark-darker/95 flex flex-col space-y-2 select-none flex-shrink-0">
        <div className="flex items-center justify-between">
          {/* Brand Logo & Name */}
          <div className="flex items-center space-x-2">
            <div className="w-5 h-5 rounded bg-onedark-surface border border-onedark-border flex items-center justify-center shadow-xs">
              <span className="text-[11px] font-black text-onedark-yellow">A</span>
            </div>
            <span className="font-semibold text-xs tracking-tight text-onedark-fgBright">Adappty</span>
          </div>

          {/* Realtime Connection Badge & Settings */}
          <div className="flex items-center space-x-1.5">
            <div 
              className={`flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10.5px] font-mono border ${
                isConnected 
                  ? 'bg-onedark-green/10 text-onedark-green border-onedark-green/30' 
                  : 'bg-onedark-red/10 text-onedark-red border-onedark-red/30'
              }`}
              title={isConnected ? "Realtime WebSocket stream connected" : "WebSocket disconnected"}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-onedark-green animate-pulse' : 'bg-onedark-red'}`} />
              <span>{isConnected ? 'Live' : 'Offline'}</span>
            </div>

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
    </div>
  );
};
