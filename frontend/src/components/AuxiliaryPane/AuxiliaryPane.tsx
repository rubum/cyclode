import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { GitPullRequest, Activity, Cpu, Inbox, Folder, Compass, Play, GitCompare, Brain, Terminal as TerminalIcon, MoreHorizontal, ChevronDown, X, RotateCcw } from 'lucide-react';
import { Task, WorkspacePreviewInfo } from '../../types';
import { PullRequestsTab } from './PullRequestsTab';
import { IntelligenceTab } from './IntelligenceTab';
import { AgentsTab } from './AgentsTab';
import { SubagentsTab } from './SubagentsTab';
import { EventInspectorTab } from './EventInspectorTab';
import { FilesExplorerTab } from './FilesExplorerTab';
import { AppPreviewTab } from './AppPreviewTab';
import { ChangesDiffTab } from './ChangesDiffTab';
import { ErrorBoundary } from '../Common/ErrorBoundary';

const TerminalTab = React.lazy(() => import('./TerminalTab').then(m => ({ default: m.TerminalTab })));
const DocsViewerTab = React.lazy(() => import('./DocsViewerTab').then(m => ({ default: m.DocsViewerTab })));

const API_BASE = import.meta.env.VITE_API_URL || '';

export type AuxTabType = 'docs' | 'files' | 'terminal' | 'preview' | 'changes' | 'prs' | 'intelligence' | 'agents' | 'subagents' | 'event';

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
    const interval = setInterval(checkPreviewStatus, 15000);
    return () => clearInterval(interval);
  }, [checkPreviewStatus]);

  const [internalTab, setInternalTab] = useState<AuxTabType>(() => {
    if (previewTarget?.url) return isPrForTask(previewTarget.url, task) ? 'prs' : 'docs';
    if (task?.prs && task.prs.length > 0) return 'prs';
    if (task?.repo_name || task?.repo_url) return 'files';
    return 'intelligence';
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

  // Persisted set of tabs closed/hidden by the user
  const [hiddenTabs, setHiddenTabs] = useState<Set<AuxTabType>>(() => {
    try {
      const saved = localStorage.getItem('cyclode:aux_hidden_tabs');
      if (saved) {
        return new Set<AuxTabType>(JSON.parse(saved));
      }
    } catch {}
    return new Set<AuxTabType>();
  });

  useEffect(() => {
    try {
      localStorage.setItem('cyclode:aux_hidden_tabs', JSON.stringify(Array.from(hiddenTabs)));
    } catch {}
  }, [hiddenTabs]);

  const handleTabClick = (tab: AuxTabType) => {
    // If activating a tab that was hidden, unhide it so it appears in the tab strip
    setHiddenTabs((prev) => {
      if (!prev.has(tab)) return prev;
      const next = new Set(prev);
      next.delete(tab);
      return next;
    });
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
        handleTabClick('intelligence');
      }
    }
  }, [task?.id, previewTarget?.url]);

  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showMoreMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setShowMoreMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMoreMenu]);

  const allTabs: Array<{
    id: AuxTabType;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    iconClass?: string;
    badge?: string;
    count?: number;
    isContextual: boolean;
    hasData: boolean;
  }> = [
    {
      id: 'docs',
      label: 'Web & Docs',
      icon: Compass,
      badge: (previewTarget?.url && !isPrForTask(previewTarget.url, task)) ? '●' : undefined,
      isContextual: true,
      hasData: Boolean(previewTarget?.url && !isPrForTask(previewTarget.url, task)),
    },
    {
      id: 'files',
      label: 'Files',
      icon: Folder,
      iconClass: 'text-onedark-folder',
      isContextual: false,
      hasData: true,
    },
    {
      id: 'terminal',
      label: 'Terminal',
      icon: TerminalIcon,
      iconClass: 'text-onedark-accent',
      isContextual: false,
      hasData: true,
    },
    {
      id: 'preview',
      label: 'Preview',
      icon: Play,
      iconClass: previewInfo?.has_preview ? 'text-onedark-green' : '',
      badge: previewInfo?.has_preview ? '●' : undefined,
      isContextual: true,
      hasData: Boolean(previewInfo?.has_preview),
    },
    {
      id: 'changes',
      label: 'Changes',
      icon: GitCompare,
      count: task?.diffs?.length || 0,
      iconClass: (task?.diffs?.length || 0) > 0 ? 'text-onedark-accent' : '',
      isContextual: true,
      hasData: (task?.diffs?.length || 0) > 0 || Boolean(targetCommitSha),
    },
    {
      id: 'prs',
      label: 'PRs',
      icon: GitPullRequest,
      count: task?.prs?.length || 0,
      badge: (previewTarget?.url && isPrForTask(previewTarget.url, task)) ? '●' : undefined,
      isContextual: true,
      hasData: (task?.prs?.length || 0) > 0 || Boolean(previewTarget?.url && isPrForTask(previewTarget.url, task)),
    },
    {
      id: 'intelligence',
      label: 'Intelligence',
      icon: Brain,
      badge: task?.report ? '●' : undefined,
      isContextual: false,
      hasData: true,
    },
    {
      id: 'agents',
      label: 'Agents',
      icon: Cpu,
      isContextual: false,
      hasData: true,
    },
    {
      id: 'event',
      label: 'Event',
      icon: Inbox,
      badge: task?.event_id ? '●' : undefined,
      isContextual: true,
      hasData: Boolean(task?.event_id),
    },
  ];

  // Core tabs stay visible unless closed by the user; contextual tabs are promoted if they have data or are actively selected
  const visibleTabs = allTabs.filter(
    (tab) =>
      !hiddenTabs.has(tab.id) &&
      (!tab.isContextual || tab.hasData || activeTab === tab.id || (tab.id === 'agents' && activeTab === 'subagents'))
  );

  // Tabs not currently on the visible strip are cleanly listed under Additional Views
  const overflowTabs = allTabs.filter(
    (tab) => !visibleTabs.some((vt) => vt.id === tab.id)
  );

  const hasOverflowActivity = overflowTabs.some(
    (tab) => tab.hasData || (tab.count !== undefined && tab.count > 0) || Boolean(tab.badge)
  );

  const handleCloseTab = (tabId: AuxTabType) => {
    if (visibleTabs.length <= 1) return;

    setHiddenTabs((prev) => {
      const next = new Set(prev);
      next.add(tabId);
      return next;
    });

    // If closing active tab, switch to adjacent or fallback tab
    if (activeTab === tabId || (tabId === 'agents' && activeTab === 'subagents')) {
      const remainingTabs = visibleTabs.filter((t) => t.id !== tabId);
      const currentIndex = visibleTabs.findIndex((t) => t.id === tabId);
      const fallback =
        (currentIndex > 0 ? remainingTabs[currentIndex - 1] : remainingTabs[0]) ||
        allTabs.find((t) => !hiddenTabs.has(t.id) && t.id !== tabId) ||
        allTabs.find((t) => t.id === 'files') ||
        allTabs[0];
      if (fallback) {
        setInternalTab(fallback.id as any);
        onTabChange?.(fallback.id as any);
      }
    }
  };

  const handleOpenOverflowTab = (tabId: AuxTabType) => {
    handleTabClick(tabId as any);
    setShowMoreMenu(false);
  };

  return (
    <div className="flex flex-col h-full bg-onedark-darker overflow-hidden select-none text-onedark-fg">
      {/* Tab bar with kinetic styling and contextual visibility */}
      <div className="flex items-center justify-between bg-onedark-darker px-2 py-1.5 border-b border-onedark-borderSubtle/60">
        <div className="flex items-center space-x-1 overflow-x-auto no-scrollbar min-w-0 flex-1">
          {visibleTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id || (tab.id === 'agents' && activeTab === 'subagents');
            const canClose = visibleTabs.length > 1;
            return (
              <div
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                tabIndex={0}
                onClick={() => handleTabClick(tab.id as any)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleTabClick(tab.id as any);
                  }
                }}
                className={`group relative flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium cursor-pointer flex-shrink-0 rounded-lg btn-tactile transition-all duration-150 ${
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
                  <span className={`ml-0.5 text-[10px] font-mono transition-colors duration-150 ${isActive ? 'text-onedark-accent font-bold' : 'text-onedark-muted'}`}>
                    {tab.count}
                  </span>
                )}
                {canClose && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCloseTab(tab.id as any);
                    }}
                    className="p-0.5 -mr-1 ml-0.5 rounded text-onedark-muted/60 hover:text-onedark-fgBright hover:bg-onedark-surface/80 transition-all opacity-0 group-hover:opacity-100 cursor-pointer focus:opacity-100"
                    title="Move to Additional Views"
                    aria-label={`Move ${tab.label} to Additional Views`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
                {isActive && (
                  <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-onedark-accent rounded-full animate-active-tab-glow" />
                )}
              </div>
            );
          })}
        </div>

        {/* Overflow dropdown for contextual views without active data or tabs closed by user */}
        {overflowTabs.length > 0 && (
          <div className="relative flex-shrink-0 ml-1.5" ref={moreMenuRef}>
            <button
              type="button"
              onClick={() => setShowMoreMenu((prev) => !prev)}
              className={`relative flex items-center space-x-1 px-2 py-1.5 text-xs rounded-lg border transition-all cursor-pointer ${
                showMoreMenu
                  ? 'bg-onedark-surface text-onedark-fgBright border-onedark-borderSubtle shadow-xs'
                  : 'bg-onedark-surface/30 hover:bg-onedark-surface/60 text-onedark-muted hover:text-onedark-fg border-transparent hover:border-onedark-borderSubtle/50'
              }`}
              title="Additional views"
              aria-label="Additional views"
            >
              <MoreHorizontal className="w-3.5 h-3.5" />
              <ChevronDown className={`w-3 h-3 transition-transform duration-150 ${showMoreMenu ? 'rotate-180' : ''}`} />
              {hasOverflowActivity && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-onedark-green border-2 border-onedark-darker animate-subagent-pulse" />
              )}
            </button>

            {showMoreMenu && (
              <div className="absolute right-0 top-full mt-1.5 w-48 bg-onedark-bg border border-onedark-border rounded-xl shadow-2xl py-1 z-50 animate-scaleIn font-sans">
                <div className="px-2.5 py-1 text-[10px] font-mono font-semibold uppercase tracking-wider text-onedark-muted border-b border-onedark-borderSubtle/60 flex items-center justify-between">
                  <span>Additional Views</span>
                  <span className="text-[10px] font-normal text-onedark-muted">{overflowTabs.length}</span>
                </div>
                <div className="py-0.5 max-h-64 overflow-y-auto no-scrollbar">
                  {overflowTabs.map((tab) => {
                    const Icon = tab.icon;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => handleOpenOverflowTab(tab.id as any)}
                        className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs text-onedark-fg hover:text-onedark-fgBright hover:bg-onedark-surface/70 transition-colors text-left cursor-pointer group/item"
                      >
                        <div className="flex items-center space-x-2 min-w-0">
                          <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${tab.iconClass || 'text-onedark-muted'}`} />
                          <span className="truncate">{tab.label}</span>
                        </div>
                        <div className="flex items-center space-x-1.5 ml-2 flex-shrink-0">
                          {tab.badge && (
                            <span className="w-1.5 h-1.5 rounded-full bg-onedark-green animate-subagent-pulse" />
                          )}
                          {tab.count !== undefined && tab.count > 0 && (
                            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-onedark-surface text-onedark-accent font-semibold border border-onedark-borderSubtle">
                              {tab.count}
                            </span>
                          )}
                          <span className="text-[10px] text-onedark-muted opacity-0 group-hover/item:opacity-100 transition-opacity">
                            Open
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
                {hiddenTabs.size > 0 && (
                  <div className="pt-1 mt-1 border-t border-onedark-borderSubtle/60 px-1">
                    <button
                      type="button"
                      onClick={() => setHiddenTabs(new Set())}
                      className="w-full flex items-center space-x-1.5 px-2 py-1 text-[11px] text-onedark-muted hover:text-onedark-fgBright hover:bg-onedark-surface/60 rounded-md transition-colors cursor-pointer"
                      title="Restore all default tabs to the top bar"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Reset tabs to default</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
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
              <React.Suspense fallback={<div className="h-full flex items-center justify-center text-xs text-onedark-muted font-mono">Loading documentation...</div>}>
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
              </React.Suspense>
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
                  key={task.id}
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
              <React.Suspense fallback={<div className="h-full flex items-center justify-center text-xs text-onedark-muted font-mono">Loading terminal...</div>}>
                <TerminalTab
                  key={task?.id}
                  task={task}
                  isActive={activeTab === 'terminal'}
                  onOpenFile={(filePath) => {
                    if (filePath) {
                      onSelectFile?.(filePath);
                      handleTabClick('files');
                    }
                  }}
                />
              </React.Suspense>
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
                key={task?.id}
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
                key={task?.id}
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
                key={task?.id}
                task={task}
                selectedPrUrl={isPrForTask(previewTarget?.url, task) ? previewTarget?.url : undefined}
                onClearSelectedPr={onClearPreview}
                onCloneToSession={onCloneToSession}
                onAskAboutComment={onAskAboutComment}
              />
            </ErrorBoundary>
          </div>
        )}

        {visitedTabs.has('intelligence') && (
          <div
            className={`absolute inset-0 w-full h-full transition-opacity duration-150 ${
              activeTab === 'intelligence'
                ? 'opacity-100 pointer-events-auto z-10 visible'
                : 'opacity-0 pointer-events-none z-0 invisible'
            }`}
            aria-hidden={activeTab !== 'intelligence'}
          >
            <ErrorBoundary fallbackTitle="Error Loading Intelligence Tab">
              <IntelligenceTab key={task?.id} task={task} />
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

