import React, { useState, useEffect, useCallback } from 'react';
import { 
  PanelLeft, 
  PanelLeftClose, 
  GitPullRequest, 
  Box, 
  RotateCcw, 
  Settings,
  Play,
  GitBranch,
  GitCompare,
  Copy,
  Check
} from 'lucide-react';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { Task, WorkspacePreviewInfo, LayoutPreset } from '../../types';
import { CyclodeIcon } from '../Common/CyclodeIcon';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface HeaderProps {
  activeTask: Task | null;
  activeAgentsCount: number;
  currentPreset?: LayoutPreset;
  onSetPreset?: (preset: LayoutPreset) => void;
  onOpenSandboxModal?: () => void;
  onOpenPreview?: () => void;
  onOpenChanges?: () => void;
  onRetryTask?: () => void;
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onOpenSettings: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTask,
  activeAgentsCount,
  currentPreset = 'split',
  onSetPreset,
  onOpenSandboxModal,
  onOpenPreview,
  onOpenChanges,
  onRetryTask,
  isSidebarCollapsed = false,
  onToggleSidebar,
  onOpenSettings,
}) => {
  const { isConnected } = useWebSocket();
  const isRunning = activeTask?.status === 'RUNNING' || activeTask?.status === 'INITIALIZING';

  const [previewInfo, setPreviewInfo] = useState<WorkspacePreviewInfo | null>(null);
  const [copiedBranch, setCopiedBranch] = useState(false);

  const diffAdds = (activeTask?.diffs || []).reduce((acc, d) => acc + (d.additions || 0), 0);
  const diffDels = (activeTask?.diffs || []).reduce((acc, d) => acc + (d.deletions || 0), 0);

  const checkPreviewStatus = useCallback(async () => {
    if (!activeTask?.id || activeTask.id.startsWith('temp-')) {
      setPreviewInfo(null);
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/tasks/${activeTask.id}/preview/inspect`);
      if (res.ok) {
        const data = await res.json();
        setPreviewInfo(data);
      }
    } catch {
      // ignore
    }
  }, [activeTask?.id]);

  useEffect(() => {
    checkPreviewStatus();
    const interval = setInterval(checkPreviewStatus, 5000);
    return () => clearInterval(interval);
  }, [checkPreviewStatus]);

  return (
    <header className="h-11 border-b border-onedark-borderSubtle bg-onedark-darker px-3.5 flex items-center justify-between select-none z-20 text-onedark-fg text-xs font-sans">
      {/* Left: Repo Breadcrumb & Session Context */}
      <div className="flex items-center space-x-2.5 min-w-0">
        {activeTask?.repo_name && (
          <div className="flex items-center space-x-1.5 px-2 py-0.5 rounded-md bg-onedark-surface/40 border border-onedark-borderSubtle text-onedark-fgBright font-mono text-[11px] truncate">
            <GitPullRequest className="w-3 h-3 text-onedark-accent flex-shrink-0" />
            <span className="truncate">{activeTask.repo_name}</span>
          </div>
        )}

        {activeTask?.session_key && (
          <span className="hidden md:inline-block px-2 py-0.5 rounded-md bg-onedark-accent/10 text-onedark-accent border border-onedark-accent/25 text-[10.5px] font-semibold font-mono truncate">
            {activeTask.session_key}
          </span>
        )}

        {activeTask?.git_branch && (
          <button
            onClick={() => {
              navigator.clipboard.writeText(activeTask.git_branch || '');
              setCopiedBranch(true);
              setTimeout(() => setCopiedBranch(false), 2000);
            }}
            className="flex items-center space-x-1.5 px-2 py-0.5 rounded-md bg-onedark-surface/40 hover:bg-onedark-surface border border-onedark-borderSubtle text-onedark-fgBright font-mono text-[11px] truncate transition-colors cursor-pointer group"
            title={`Active Git Branch: ${activeTask.git_branch} (Click to copy)`}
          >
            <GitBranch className="w-3 h-3 text-onedark-purple flex-shrink-0" />
            <span className="truncate max-w-[130px] sm:max-w-[180px]">{activeTask.git_branch}</span>
            {copiedBranch ? (
              <Check className="w-2.5 h-2.5 text-onedark-green flex-shrink-0" />
            ) : (
              <Copy className="w-2.5 h-2.5 text-onedark-muted opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
            )}
          </button>
        )}

        {activeTask?.diffs && activeTask.diffs.length > 0 && onOpenChanges && (
          <button
            onClick={onOpenChanges}
            className="flex items-center space-x-1 px-2 py-0.5 rounded-md bg-onedark-surface/60 hover:bg-onedark-surface border border-onedark-borderSubtle text-[11px] font-mono transition-all cursor-pointer shadow-xs active:scale-95"
            title={`${activeTask.diffs.length} modified file${activeTask.diffs.length > 1 ? 's' : ''}: +${diffAdds} -${diffDels}. Click to inspect changes`}
          >
            <GitCompare className="w-3 h-3 text-onedark-accent flex-shrink-0" />
            <span className="text-onedark-fgBright font-medium">{activeTask.diffs.length} file{activeTask.diffs.length > 1 ? 's' : ''}</span>
            <span className="text-onedark-green font-bold">+{diffAdds}</span>
            <span className="text-onedark-red font-bold">-{diffDels}</span>
          </button>
        )}
      </div>

      {/* Center: Contextual Task Controls & Layout Preset */}
      <div className="flex items-center space-x-2">
        {onSetPreset && (
          <div className="flex items-center space-x-0.5 bg-onedark-surface/60 p-0.5 rounded-lg border border-onedark-borderSubtle font-mono text-[10.5px]">
            <button
              onClick={() => onSetPreset('standard')}
              className={`px-2 py-0.5 rounded-md transition-all ${
                currentPreset === 'standard'
                  ? 'bg-onedark-darker text-onedark-fgBright font-semibold shadow-xs'
                  : 'text-onedark-muted hover:text-onedark-fg hover:bg-onedark-darker/40'
              }`}
              title="Standard Layout"
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
              title="Wide Layout"
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
              title="Zen Focus Mode"
            >
              Zen ⛶
            </button>
          </div>
        )}

        {/* Live App Preview Action */}
        {previewInfo?.has_preview && onOpenPreview && (
          <button
            onClick={onOpenPreview}
            className="px-2.5 py-0.5 rounded-md text-[11px] font-mono border border-onedark-green/40 bg-onedark-green/15 text-onedark-green hover:bg-onedark-green/25 flex items-center space-x-1.5 transition-all shadow-xs active:scale-95 cursor-pointer flex-shrink-0"
            title={`Preview app (${previewInfo.title || previewInfo.entry_point})`}
          >
            <Play className="w-3 h-3 fill-current" />
            <span className="font-semibold">Preview App</span>
          </button>
        )}

        {/* Sandbox Inspector Button */}
        {activeTask?.sandbox_status && activeTask.sandbox_status !== 'NONE' && (
          <button
            onClick={onOpenSandboxModal}
            className={`px-2 py-0.5 rounded-md text-[11px] font-mono border flex items-center space-x-1.5 transition-all shadow-xs active:scale-95 cursor-pointer font-medium ${
              activeTask.sandbox_status === 'ACTIVE'
                ? 'bg-emerald-100 text-emerald-950 border-emerald-300 hover:bg-emerald-200 dark:bg-onedark-green/15 dark:text-onedark-green dark:border-onedark-green/30 dark:hover:bg-onedark-green/25'
                : activeTask.sandbox_status === 'PROVISIONING'
                ? 'bg-amber-100 text-amber-950 border-amber-300 hover:bg-amber-200 dark:bg-onedark-yellow/15 dark:text-onedark-yellow dark:border-onedark-yellow/30 dark:hover:bg-onedark-yellow/25'
                : activeTask.sandbox_status === 'AUTH_REQUIRED'
                ? 'bg-amber-100 text-amber-950 border-amber-300 hover:bg-amber-200 dark:bg-onedark-accent/15 dark:text-onedark-accent dark:border-onedark-accent/30 dark:hover:bg-onedark-accent/25'
                : 'bg-onedark-surface text-onedark-muted border-onedark-borderSubtle hover:bg-onedark-surface/80 hover:text-onedark-fg'
            }`}
            title="Inspect Sandbox Environment & Filesystem"
          >
            <Box className="w-3 h-3" />
            <span>Sandbox: {activeTask.sandbox_status === 'DESTROYED' ? 'Destroyed' : activeTask.sandbox_status.toLowerCase()} ↗</span>
          </button>
        )}

        {/* Retry Action */}
        {onRetryTask && !isRunning && activeTask && (
          <button
            onClick={onRetryTask}
            className="px-2 py-0.5 rounded-md border border-onedark-border bg-onedark-surface hover:bg-onedark-surface/90 text-onedark-muted hover:text-onedark-fgBright text-[11px] font-mono flex items-center space-x-1 transition-all shadow-xs active:scale-95 cursor-pointer"
            title="Retry / Regenerate response"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Retry</span>
          </button>
        )}

        {/* Status Badge */}
        {activeTask && (
          <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-mono border flex items-center space-x-1.5 shadow-xs font-semibold ${
            activeTask.status === 'RUNNING'
              ? 'bg-amber-100 border-amber-300 text-amber-950 dark:bg-onedark-yellow/15 dark:border-onedark-yellow/30 dark:text-onedark-yellow'
              : activeTask.status === 'AWAITING_APPROVAL'
              ? 'bg-amber-100 border-amber-300 text-amber-950 dark:bg-onedark-accent/15 dark:border-onedark-accent/30 dark:text-onedark-accent'
              : activeTask.status === 'AWAITING_INPUT'
              ? 'bg-amber-100 border-amber-300 text-amber-950 dark:bg-onedark-accent/15 dark:border-onedark-accent/30 dark:text-onedark-accent'
              : activeTask.status === 'IDLE'
              ? 'bg-purple-100 border-purple-300 text-purple-950 dark:bg-onedark-purple/15 dark:border-onedark-purple/30 dark:text-onedark-purple'
              : activeTask.status === 'COMPLETED'
              ? 'bg-emerald-100 border-emerald-300 text-emerald-950 dark:bg-onedark-green/15 dark:border-onedark-green/30 dark:text-onedark-green'
              : activeTask.status === 'CANCELLED'
              ? 'bg-rose-100 border-rose-300 text-rose-950 dark:bg-onedark-red/15 dark:border-onedark-red/30 dark:text-onedark-red'
              : 'bg-onedark-surface border-onedark-border text-onedark-muted'
          }`}>
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                activeTask.status === 'RUNNING'
                  ? 'bg-onedark-yellow animate-pulse'
                  : activeTask.status === 'AWAITING_APPROVAL'
                  ? 'bg-onedark-accent animate-pulse'
                  : activeTask.status === 'AWAITING_INPUT'
                  ? 'bg-onedark-accent animate-pulse'
                  : activeTask.status === 'IDLE'
                  ? 'bg-onedark-purple animate-pulse'
                  : activeTask.status === 'COMPLETED'
                  ? 'bg-onedark-green'
                  : activeTask.status === 'CANCELLED'
                  ? 'bg-onedark-red'
                  : 'bg-onedark-muted'
              }`}
            />
            <span>{activeTask.status === 'IDLE' ? 'Standing By' : activeTask.status === 'AWAITING_INPUT' ? 'Awaiting Input' : activeTask.status.replace('_', ' ')}</span>
          </span>
        )}
      </div>

      {/* Right: Active Agents, Connection Status & Settings */}
      <div className="flex items-center space-x-3">
        {activeAgentsCount > 0 && (
          <div className="flex items-center space-x-1.5 px-2 py-0.5 rounded bg-onedark-surface border border-onedark-border text-[11px] text-onedark-green font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-onedark-green animate-pulse" />
            <span>{activeAgentsCount} active</span>
          </div>
        )}

        <div className="flex items-center space-x-1.5 text-[11px] text-onedark-muted font-mono">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              isConnected ? 'bg-onedark-green' : 'bg-onedark-muted'
            }`}
          />
          <span>{isConnected ? 'connected' : 'connecting'}</span>
        </div>

        <button
          onClick={onOpenSettings}
          className="p-1 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fgBright transition-colors cursor-pointer"
          title="Settings & Policies"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
};
