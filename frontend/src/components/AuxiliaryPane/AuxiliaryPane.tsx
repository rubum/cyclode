import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { GitPullRequest, Activity, Cpu, Inbox, Folder, Compass, Play, GitCompare, Terminal as TerminalIcon } from 'lucide-react';
import { Task, WorkspacePreviewInfo } from '../../types';
import { PullRequestsTab } from './PullRequestsTab';
import { TerminalTab } from './TerminalTab';
import { ToolActivityTab } from './ToolActivityTab';
import { AgentsTab } from './AgentsTab';
import { SubagentsTab } from './SubagentsTab';
import { EventInspectorTab } from './EventInspectorTab';
import { FilesExplorerTab } from './FilesExplorerTab';
import { DocsViewerTab } from './DocsViewerTab';
import { AppPreviewTab } from './AppPreviewTab';
import { ChangesDiffTab } from './ChangesDiffTab';
import { ErrorBoundary } from '../Common/ErrorBoundary';

const API_BASE = import.meta.env.VITE_API_URL || '';

export type AuxTabType = 'docs' | 'files' | 'terminal' | 'preview' | 'changes' | 'prs' | 'activity' | 'agents' | 'subagents' | 'event';

interface AuxiliaryPaneProps {
  task: Task | null;
  repositories?: any[];
  activeTab?: AuxTabType;
  onTabChange?: (tab: AuxTabType) => void;
  previewTarget?: { url: string; title?: string } | null;
  selectedFilePath?: string | null;
  selectedLineNumber?: number | null;
  onSelectFile?: (filePath: string, line?: number) => void;
  onClearSelectedFilePath?: () => void;
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
  selectedFilePath,
  selectedLineNumber,
  onSelectFile,
  onClearSelectedFilePath,
  onClearPreview,
  onAskAboutRepo,
  onCloneToSession,
  onAskAboutComment,
}) => {
  const [previewInfo, setPreviewInfo] = useState<WorkspacePreviewInfo | null>(null);
  const [targetCommitSha, setTargetCommitSha] = useState<string | null>(null);

  const sessionKey = task?.id || 'draft';
  const [visitedTabsMap, setVisitedTabsMap] = useState<Record<string, Set<AuxTabType>>>({});

  const checkPreviewStatus = useCallback(async () => {
    if (!task?.id || task.id.startsWith('temp-')) {
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

  const visitedTabs = useMemo(() => {
    const existing = visitedTabsMap[sessionKey];
    if (existing) return existing;
    return new Set<AuxTabType>([activeTab]);
  }, [visitedTabsMap, sessionKey, activeTab]);

  useEffect(() => {
    setVisitedTabsMap((prev) => {
      const current = prev[sessionKey];
      if (current && current.has(activeTab)) return prev;
      const next = new Set(current || []);
      next.add(activeTab);
      return { ...prev, [sessionKey]: next };
    });
  }, [activeTab, sessionKey]);

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
    { id: 'terminal', label: 'Terminal', icon: TerminalIcon, iconClass: 'text-onedark-accent' },
    { id: 'preview', label: 'Preview', icon: Play, iconClass: previewInfo?.has_preview ? 'text-onedark-green' : '', badge: previewInfo?.has_preview ? '●' : undefined },
    { id: 'changes', label: 'Changes', icon: GitCompare, count: task?.diffs?.length || 0, iconClass: (task?.diffs?.length || 0) > 0 ? 'text-onedark-accent' : '' },
    { id: 'prs', label: 'PRs', icon: GitPullRequest, count: task?.prs?.length || 0, badge: (previewTarget?.url && isPrForTask(previewTarget.url, task)) ? '●' : undefined },
    { id: 'activity', label: 'Tool Activity', icon: Activity, count: task?.logs?.length || 0 },
    { id: 'agents', label: 'Agents', icon: Cpu },
    { id: 'event', label: 'Event', icon: Inbox, badge: task?.event_id ? '●' : undefined },
  ];

  return (
    <div className="flex flex-col h-full bg-onedark-darker overflow-hidden select-none text-onedark-fg">
      {/* Tab bar with kinetic styling */}
      <div className="flex items-center bg-onedark-darker px-2 py-1.5 space-x-1 overflow-x-auto no-scrollbar border-b border-onedark-borderSubtle/60">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id || (tab.id === 'agents' && activeTab === 'subagents');
          return (
            <button
              key={tab.id}
              onClick={() => handleTabClick(tab.id as any)}
              className={`relative flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium cursor-pointer flex-shrink-0 rounded-lg btn-tactile transition-all duration-150 ${
                isActive
                  ? 'bg-onedark-surface text-onedark-fgBright shadow-xs font-semibold border border-onedark-borderSubtle'
                  : 'bg-onedark-surface/40 text-onedark-muted hover:text-onedark-fgBright hover:bg-onedark-surface/70 border border-onedark-borderSubtle/60'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 transition-transform duration-150 ${isActive ? 'scale-105' : ''} ${tab.iconClass || ''}`} />
              <span>{tab.label}</span>
              {tab.badge && (
                <span className="w-1.5 h-1.5 rounded-full bg-onedark-green animate-subagent-pulse ml-0.5" />
              )}
              {tab.count !== undefined && tab.count > 0 && (
                <span className={`ml-1 text-[10px] font-mono transition-colors duration-150 ${isActive ? 'text-onedark-accent font-bold' : 'text-onedark-muted'}`}>
                  {tab.count}
                </span>
              )}
              {isActive && (
                <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-onedark-accent rounded-full animate-active-tab-glow" />
              )}
            </button>
          );
        })}
      </div>

      {/* Tab body with persistent keep-alive state across tab switches */}
      <div className="flex-1 relative overflow-hidden">
        {visitedTabs.has('docs') && (
          <div
            className={`absolute inset-0 w-full h-full transition-opacity duration-150 ${
              activeTab === 'docs'
                ? 'opacity-100 pointer-events-auto z-10 visible'
                : 'opacity-0 pointer-events-none z-0 invisible'
            }`}
            aria-hidden={activeTab !== 'docs'}
          >
            <ErrorBoundary fallbackTitle="Error Loading DOCS Tab">
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
            </ErrorBoundary>
          </div>
        )}

        {visitedTabs.has('files') && (
          <div
            className={`absolute inset-0 w-full h-full transition-opacity duration-150 ${
              activeTab === 'files'
                ? 'opacity-100 pointer-events-auto z-10 visible'
                : 'opacity-0 pointer-events-none z-0 invisible'
            }`}
            aria-hidden={activeTab !== 'files'}
          >
            <ErrorBoundary fallbackTitle="Error Loading FILES Tab">
              {task ? (
                <FilesExplorerTab 
                  task={task} 
                  selectedFilePath={selectedFilePath} 
                  selectedLineNumber={selectedLineNumber}
                  onSelectFile={onSelectFile}
                  onClearSelectedFilePath={onClearSelectedFilePath}
                  onViewCommitDiff={(sha) => {
                    setTargetCommitSha(sha);
                    handleTabClick('changes');
                  }}
                />
              ) : (
                <div className="h-full flex flex-col items-center justify-center p-6 text-center text-onedark-muted font-mono select-none bg-onedark-darker">
                  <div className="p-3 rounded-2xl bg-onedark-surface/40 border border-onedark-borderSubtle/80 mb-3 shadow-xs">
                    <Folder className="w-8 h-8 text-onedark-folder/80 stroke-[1.5]" />
                  </div>
                  <div className="text-xs font-semibold text-onedark-fg">No active task selected</div>
                  <div className="text-[11px] text-onedark-muted mt-1.5 max-w-xs leading-relaxed">
                    Select or launch an engineering task to inspect its workspace repository files.
                  </div>
                </div>
              )}
            </ErrorBoundary>
          </div>
        )}

        {visitedTabs.has('terminal') && (
          <div
            className={`absolute inset-0 w-full h-full transition-opacity duration-150 ${
              activeTab === 'terminal'
                ? 'opacity-100 pointer-events-auto z-10 visible'
                : 'opacity-0 pointer-events-none z-0 invisible'
            }`}
            aria-hidden={activeTab !== 'terminal'}
          >
            <ErrorBoundary fallbackTitle="Error Loading TERMINAL Tab">
              <TerminalTab
                task={task}
                isActive={activeTab === 'terminal'}
                onOpenFile={(filePath) => {
                  if (filePath) {
                    onSelectFile?.(filePath);
                    handleTabClick('files');
                  }
                }}
              />
            </ErrorBoundary>
          </div>
        )}

        {visitedTabs.has('preview') && (
          <div
            className={`absolute inset-0 w-full h-full transition-opacity duration-150 ${
              activeTab === 'preview'
                ? 'opacity-100 pointer-events-auto z-10 visible'
                : 'opacity-0 pointer-events-none z-0 invisible'
            }`}
            aria-hidden={activeTab !== 'preview'}
          >
            <ErrorBoundary fallbackTitle="Error Loading PREVIEW Tab">
              <AppPreviewTab
                task={task}
                onSelectAuxTab={handleTabClick}
                onAskAgent={onAskAboutComment}
              />
            </ErrorBoundary>
          </div>
        )}

        {visitedTabs.has('changes') && (
          <div
            className={`absolute inset-0 w-full h-full transition-opacity duration-150 ${
              activeTab === 'changes'
                ? 'opacity-100 pointer-events-auto z-10 visible'
                : 'opacity-0 pointer-events-none z-0 invisible'
            }`}
            aria-hidden={activeTab !== 'changes'}
          >
            <ErrorBoundary fallbackTitle="Error Loading CHANGES Tab">
              <ChangesDiffTab 
                task={task} 
                onSelectAuxTab={handleTabClick} 
                targetCommitSha={targetCommitSha}
                onClearTargetCommitSha={() => setTargetCommitSha(null)}
              />
            </ErrorBoundary>
          </div>
        )}

        {visitedTabs.has('prs') && (
          <div
            className={`absolute inset-0 w-full h-full transition-opacity duration-150 ${
              activeTab === 'prs'
                ? 'opacity-100 pointer-events-auto z-10 visible'
                : 'opacity-0 pointer-events-none z-0 invisible'
            }`}
            aria-hidden={activeTab !== 'prs'}
          >
            <ErrorBoundary fallbackTitle="Error Loading PRs Tab">
              <PullRequestsTab
                task={task}
                selectedPrUrl={isPrForTask(previewTarget?.url, task) ? previewTarget?.url : undefined}
                onClearSelectedPr={onClearPreview}
                onCloneToSession={onCloneToSession}
                onAskAboutComment={onAskAboutComment}
              />
            </ErrorBoundary>
          </div>
        )}

        {visitedTabs.has('activity') && (
          <div
            className={`absolute inset-0 w-full h-full transition-opacity duration-150 ${
              activeTab === 'activity'
                ? 'opacity-100 pointer-events-auto z-10 visible'
                : 'opacity-0 pointer-events-none z-0 invisible'
            }`}
            aria-hidden={activeTab !== 'activity'}
          >
            <ErrorBoundary fallbackTitle="Error Loading ACTIVITY Tab">
              <ToolActivityTab logs={task?.logs} />
            </ErrorBoundary>
          </div>
        )}

        {(visitedTabs.has('agents') || visitedTabs.has('subagents')) && (
          <div
            className={`absolute inset-0 w-full h-full transition-opacity duration-150 ${
              (activeTab === 'agents' || activeTab === 'subagents')
                ? 'opacity-100 pointer-events-auto z-10 visible'
                : 'opacity-0 pointer-events-none z-0 invisible'
            }`}
            aria-hidden={activeTab !== 'agents' && activeTab !== 'subagents'}
          >
            <ErrorBoundary fallbackTitle="Error Loading AGENTS Tab">
              <AgentsTab task={task} />
            </ErrorBoundary>
          </div>
        )}

        {visitedTabs.has('event') && (
          <div
            className={`absolute inset-0 w-full h-full transition-opacity duration-150 ${
              activeTab === 'event'
                ? 'opacity-100 pointer-events-auto z-10 visible'
                : 'opacity-0 pointer-events-none z-0 invisible'
            }`}
            aria-hidden={activeTab !== 'event'}
          >
            <ErrorBoundary fallbackTitle="Error Loading EVENT Tab">
              <EventInspectorTab task={task} />
            </ErrorBoundary>
          </div>
        )}
      </div>
    </div>
  );
};

