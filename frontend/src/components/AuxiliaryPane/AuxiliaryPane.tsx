import React, { useState, useEffect } from 'react';
import { GitPullRequest, Activity, Cpu, Inbox, Folder, Compass } from 'lucide-react';
import { Task } from '../../types';
import { PullRequestsTab } from './PullRequestsTab';
import { TerminalTab } from './TerminalTab';
import { SubagentsTab } from './SubagentsTab';
import { EventInspectorTab } from './EventInspectorTab';
import { FilesExplorerTab } from './FilesExplorerTab';
import { DocsViewerTab } from './DocsViewerTab';
import { ErrorBoundary } from '../Common/ErrorBoundary';

interface AuxiliaryPaneProps {
  task: Task | null;
  repositories?: any[];
  activeTab?: 'docs' | 'files' | 'prs' | 'activity' | 'subagents' | 'event';
  onTabChange?: (tab: 'docs' | 'files' | 'prs' | 'activity' | 'subagents' | 'event') => void;
  previewTarget?: { url: string; title?: string } | null;
  onClearPreview?: () => void;
  onAskAboutRepo?: (repoName: string) => void;
  onCloneToSession?: (repoUrl: string, repoName: string) => void;
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
}) => {
  const [internalTab, setInternalTab] = useState<'docs' | 'files' | 'prs' | 'activity' | 'subagents' | 'event'>(() => {
    if (previewTarget?.url) return isPrForTask(previewTarget.url, task) ? 'prs' : 'docs';
    if (task?.prs && task.prs.length > 0) return 'prs';
    if (task?.repo_name || task?.repo_url) return 'files';
    return 'activity';
  });

  const activeTab = controlledTab ?? internalTab;

  const handleTabClick = (tab: 'docs' | 'files' | 'prs' | 'activity' | 'subagents' | 'event') => {
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
    { id: 'prs', label: 'PRs', icon: GitPullRequest, count: task?.prs?.length || 0, badge: (previewTarget?.url && isPrForTask(previewTarget.url, task)) ? '●' : undefined },
    { id: 'activity', label: 'Tool Activity', icon: Activity, count: task?.logs?.length || 0 },
    { id: 'subagents', label: 'Subagents', icon: Cpu },
    { id: 'event', label: 'Event', icon: Inbox },
  ];

  return (
    <div className="flex flex-col h-full bg-onedark-darker overflow-hidden select-none border-l border-onedark-borderSubtle text-onedark-fg">
      {/* Tab bar */}
      <div className="flex items-center border-b border-onedark-borderSubtle bg-onedark-darker px-2 pt-1 space-x-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => handleTabClick(tab.id as any)}
              className={`flex items-center space-x-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-all cursor-pointer ${
                isActive
                  ? 'border-onedark-accent text-onedark-fgBright bg-onedark-surface/60 rounded-t-md'
                  : 'border-transparent text-onedark-muted hover:text-onedark-fg'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${tab.iconClass || ''}`} />
              <span>{tab.label}</span>
              {tab.count !== undefined && tab.count > 0 && (
                <span className="ml-1 text-[10px] font-mono text-onedark-accent">
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
          {activeTab === 'prs' && (
            <PullRequestsTab
              task={task}
              selectedPrUrl={isPrForTask(previewTarget?.url, task) ? previewTarget?.url : undefined}
              onClearSelectedPr={onClearPreview}
              onCloneToSession={onCloneToSession}
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

