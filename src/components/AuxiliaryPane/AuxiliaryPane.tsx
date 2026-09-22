import React, { useState, useEffect, useCallback } from 'react';
import { GitPullRequest, Activity, Cpu, Inbox, Folder, Compass, Play, GitCompare } from 'lucide-react';
import { Task, WorkspacePreviewInfo } from '../../types';
import { PullRequestsTab } from './PullRequestsTab';
import { TerminalTab } from './TerminalTab';
import { SubagentsTab } from './SubagentsTab';
import { EventInspectorTab } from './EventInspectorTab';
import { FilesExplorerTab } from './FilesExplorerTab';
import { DocsViewerTab } from './DocsViewerTab';
import { AppPreviewTab } from './AppPreviewTab';
import { ChangesDiffTab } from './ChangesDiffTab';
import { ErrorBoundary } from '../Common/ErrorBoundary';

const API_BASE = import.meta.env.VITE_API_URL || '';

export type AuxTabType = 'docs' | 'files' | 'preview' | 'changes' | 'prs' | 'activity' | 'subagents' | 'event';

interface AuxiliaryPaneProps {
  task: Task | null;
  repositories?: any[];
  activeTab?: AuxTabType;
  onTabChange?: (tab: AuxTabType) => void;
  previewTarget?: { url: string; title?: string } | null;
  onClearPreview?: () => void;
  onAskAboutRepo?: (repoName: string) => void;
  onCloneToSession?: (repoUrl: string, repoName: string) => void;
  onAskAboutComment?: (prompt: string) => void;
}

const isPrUrl = (targetUrl?: string | null): boolean => {
  if (!targetUrl) return false;
  return /github\.com\/[^/]+\/[^/]+\/pull\/\d+/i.test(targetUrl);
};

const isPrForTask = (targetUrl?: string | null, task?: Task | null): boolean => {
  if (!targetUrl || !isPrUrl(targetUrl)) return false;
  if (!task || (!task.repo_name && !task.repo_url)) return true;
  const repoName = task.repo_name?.toLowerCase();
  const urlLower = targetUrl.toLowerCase();
  if (repoName && urlLower.includes(repoName)) return true;
  return false;
};

export const AuxiliaryPane: React.FC<AuxiliaryPaneProps> = ({ 
  task, 
  repositories = [],
  activeTab: controlledTab, 
  onTabChange,
  previewTarget,
  onClearPreview,
  onAskAboutRepo,
  onCloneToSession,
  onAskAboutComment,
}) => {
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

  const [internalTab, setInternalTab] = useState<AuxTabType>(() => {
    if (previewTarget?.url) return isPrForTask(previewTarget.url, task) ? 'prs' : 'docs';
    if (task?.prs && task.prs.length > 0) return 'prs';
    if (task?.repo_name || task?.repo_url) return 'files';
    return 'activity';
  });

  const activeTab = controlledTab ?? internalTab;

  const handleTabClick = (tab: AuxTabType) => {
    setInternalTab(tab);
    onTabChange?.(tab);
  };

  const lastUrlRef = React.useRef(previewTarget?.url);
  const prevTaskIdRef = React.useRef(task?.id);

  // Reset lastUrlRef when task ID switches so that a new session's target is re-evaluated
  useEffect(() => {
    if (prevTaskIdRef.current !== task?.id) {
      prevTaskIdRef.current = task?.id;
      lastUrlRef.current = previewTarget?.url;
    }
  }, [task?.id, previewTarget?.url]);

  useEffect(() => {
    if (previewTarget?.url && previewTarget.url !== lastUrlRef.current) {
      if (isPrForTask(previewTarget.url, task)) {
        handleTabClick('prs');
      } else {
        handleTabClick('docs');
      }
    }
    lastUrlRef.current = previewTarget?.url;
  }, [previewTarget?.url, task]);

  useEffect(() => {
    if (!task) return;
    if (activeTab === 'docs' && !previewTarget?.url) {
      if (task.prs && task.prs.length > 0) {
        handleTabClick('prs');
      } else if (task.repo_name || task.repo_url) {
        handleTabClick('files');
      } else {
        handleTabClick('activity');
      }
    }
  }, [task?.id, previewTarget?.url]);

  const tabs = [
    { id: 'docs', label: 'Web & Docs', icon: Compass, badge: (previewTarget?.url && !isPrForTask(previewTarget.url, task)) ? '●' : undefined },
    { id: 'files', label: 'Files', icon: Folder, iconClass: 'text-onedark-folder' },
    { id: 'preview', label: 'Preview', icon: Play, iconClass: previewInfo?.has_preview ? 'text-onedark-green' : '', badge: previewInfo?.has_preview ? '●' : undefined },
    { id: 'changes', label: 'Changes', icon: GitCompare, count: task?.diffs?.length || 0, iconClass: (task?.diffs?.length || 0) > 0 ? 'text-onedark-accent' : '' },
    { id: 'prs', label: 'PRs', icon: GitPullRequest, count: task?.prs?.length || 0, badge: (previewTarget?.url && isPrForTask(previewTarget.url, task)) ? '●' : undefined },
    { id: 'activity', label: 'Tool Activity', icon: Activity, count: task?.logs?.length || 0 },
    { id: 'subagents', label: 'Subagents', icon: Cpu },
    { id: 'event', label: 'Event', icon: Inbox, badge: task?.event_id ? '●' : undefined },
  ];

  return (
    <div className="flex flex-col h-full bg-onedark-darker overflow-hidden select-none text-onedark-fg">
      {/* Tab bar */}
      <div className="flex items-center bg-onedark-darker px-2.5 py-1.5 space-x-1 overflow-x-auto no-scrollbar">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => handleTabClick(tab.id as any)}
              className={`flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium transition-all cursor-pointer flex-shrink-0 rounded-lg ${
                isActive
                  ? 'bg-onedark-surface text-onedark-fgBright shadow-xs font-semibold'
                  : 'text-onedark-muted hover:text-onedark-fgBright hover:bg-onedark-surface/40'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${tab.iconClass || ''}`} />
              <span>{tab.label}</span>
              {tab.badge && (
                <span className="w-1.5 h-1.5 rounded-full bg-onedark-green animate-pulse ml-0.5" />
              )}
              {tab.count !== undefined && tab.count > 0 && (
                <span className={`ml-1 text-[10px] font-mono ${isActive ? 'text-onedark-accent font-bold' : 'text-onedark-muted'}`}>
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab body */}
      <div className="flex-1 overflow-hidden">
        <ErrorBoundary key={`${activeTab}-${task?.id || 'none'}`} fallbackTitle={`Error Loading ${activeTab.toUpperCase()} Tab`}>
          {activeTab === 'docs' && (
            <DocsViewerTab
              url={previewTarget?.url || null}
              initialTitle={previewTarget?.title}
              onClear={onClearPreview}
              onAskAboutRepo={onAskAboutRepo}
              onCloneToSession={onCloneToSession}
              onAskAgent={onAskAboutComment}
              task={task}
              repositories={repositories}
            />
          )}
          {activeTab === 'files' && task && <FilesExplorerTab task={task} />}
          {activeTab === 'files' && !task && (
            <div className="h-full flex items-center justify-center text-xs text-onedark-muted font-mono">
              No active task selected
            </div>
          )}
          {activeTab === 'preview' && (
            <AppPreviewTab
              task={task}
              onSelectAuxTab={handleTabClick}
              onAskAgent={onAskAboutComment}
            />
          )}
          {activeTab === 'changes' && (
            <ChangesDiffTab task={task} onSelectAuxTab={handleTabClick} />
          )}
          {activeTab === 'prs' && (
            <PullRequestsTab
              task={task}
              selectedPrUrl={isPrForTask(previewTarget?.url, task) ? previewTarget?.url : undefined}
              onClearSelectedPr={onClearPreview}
              onCloneToSession={onCloneToSession}
              onAskAboutComment={onAskAboutComment}
            />
          )}
          {activeTab === 'activity' && <TerminalTab logs={task?.logs} />}
          {activeTab === 'subagents' && <SubagentsTab task={task} />}
          {activeTab === 'event' && <EventInspectorTab task={task} />}
        </ErrorBoundary>
      </div>
    </div>
  );
};

