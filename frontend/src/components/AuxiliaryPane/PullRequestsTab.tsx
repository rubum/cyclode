import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { 
  GitPullRequest, 
  Play, 
  ShieldCheck, 
  Bot, 
  ExternalLink, 
  RefreshCw, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  GitMerge, 
  FileCode2, 
  FileText,
  Terminal, 
  ChevronDown, 
  ChevronUp, 
  Plus, 
  MessageSquarePlus,
  Loader2,
  AlertTriangle,
  GitBranch,
  User,
  Sparkles,
  Search,
  Filter,
  Zap,
  Radio
} from 'lucide-react';
import { Task, TaskPR } from '../../types';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { MarkdownRenderer } from '../Common/MarkdownRenderer';
import { PRReviewAgentPopover, LineContext } from './PRReviewAgentPopover';
import { PRDetailView } from './PRDetailView';
import { PRListenerConfigModal } from './PRListenerConfigModal';

interface PullRequestsTabProps {
  task: Task | null;
  selectedPrUrl?: string | null;
  onClearSelectedPr?: () => void;
  onNavigateToFileLine?: (filename: string, line: number) => void;
  onOpenPreview?: (url: string, title?: string) => void;
  onCloneToSession?: (repoUrl: string, repoName: string) => void;
  onAskAboutComment?: (prompt: string) => void;
}

interface PRDiffFile {
  file_path: string;
  diff_content: string;
  additions: number;
  deletions: number;
}

const API_BASE = import.meta.env.VITE_API_URL || '';

export const PullRequestsTab: React.FC<PullRequestsTabProps> = ({ 
  task, 
  selectedPrUrl,
  onClearSelectedPr,
  onNavigateToFileLine, 
  onOpenPreview,
  onCloneToSession,
  onAskAboutComment
}) => {
  const [prs, setPrs] = useState<TaskPR[]>([]);
  const [selectedPr, setSelectedPr] = useState<{ url?: string; number?: number; record?: TaskPR } | null>(() => {
    if (selectedPrUrl) {
      if (task?.repo_name && !selectedPrUrl.toLowerCase().includes(task.repo_name.toLowerCase())) {
        return null;
      }
      return { url: selectedPrUrl };
    }
    return null;
  });

  const prevTaskIdRef = useRef<string | null>(task?.id || null);

  // Full state purge whenever the active session/task ID changes
  useEffect(() => {
    if (prevTaskIdRef.current !== (task?.id || null)) {
      prevTaskIdRef.current = task?.id || null;
      setSelectedPr(null);
      setPrs([]);
      setActivePopoverPR(null);
      setActiveLineComment(null);
      setSearchQuery('');
    }
  }, [task?.id]);

  useEffect(() => {
    if (selectedPrUrl) {
      if (task?.repo_name && !selectedPrUrl.toLowerCase().includes(task.repo_name.toLowerCase())) {
        setSelectedPr(null);
        return;
      }
      setSelectedPr({ url: selectedPrUrl });
    } else {
      setSelectedPr((prev) => (prev?.url && !prev.record ? null : prev));
    }
  }, [selectedPrUrl, task?.repo_name]);

  const [loading, setLoading] = useState<boolean>(false);
  const [actionLoading, setActionLoading] = useState<Record<string, string | null>>({});
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [authorFilter, setAuthorFilter] = useState<string>('ALL');
  const [scopeFilter, setScopeFilter] = useState<'SESSION' | 'ALL_REPO'>('SESSION');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Review Agent Popover state
  const [activePopoverPR, setActivePopoverPR] = useState<TaskPR | null>(null);
  const [activeLineComment, setActiveLineComment] = useState<LineContext | null>(null);
  const [activeListenerPR, setActiveListenerPR] = useState<TaskPR | null>(null);
  const [isSyncingRepo, setIsSyncingRepo] = useState<boolean>(false);
  const hasAutoSyncedRef = useRef<Record<string, boolean>>({});

  const { subscribe } = useWebSocket();

  // Helper to extract author and state intent from task prompt/title/description
  const extractPromptIntent = useCallback((prompt: string) => {
    if (!prompt) return {};
    const authorMatch = prompt.match(/\b(?:by|author[:=]?|from)\s+@?([a-zA-Z0-9_\-]+)\b/i);
    const stateMatch = prompt.match(/\b(open|closed|merged)\b/i);
    return {
      author: authorMatch ? authorMatch[1] : undefined,
      state: stateMatch ? stateMatch[1].toUpperCase() : undefined
    };
  }, []);

  // When task changes or mounts, auto-extract prompt intent to pre-set filters
  useEffect(() => {
    if (!task) return;
    const promptText = `${task.title || ''} ${task.description || ''}`;
    const intent = extractPromptIntent(promptText);
    if (intent.author) {
      setAuthorFilter(intent.author);
    }
    if (intent.state) {
      setStatusFilter(intent.state);
    }
  }, [task?.id, task?.title, task?.description, extractPromptIntent]);

  // Load PRs for the active task
  const fetchPRs = useCallback(async () => {
    if (!task?.id || task.id.startsWith('temp-')) {
      setPrs([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/tasks/${task.id}/prs`);
      if (res.ok) {
        const data = await res.json();
        setPrs(data);
      }
    } catch (err) {
      console.error('Failed to fetch PRs:', err);
    } finally {
      setLoading(false);
    }
  }, [task?.id]);

  const syncRepoPRs = useCallback(async () => {
    if (!task?.id || !task.repo_name) return;
    setIsSyncingRepo(true);
    try {
      const res = await fetch(`${API_BASE}/api/tasks/${task.id}/prs/sync_repo`, {
        method: 'POST'
      });
      if (res.ok) {
        await fetchPRs();
      }
    } catch (err) {
      console.error('Failed to sync repository PRs:', err);
    } finally {
      setIsSyncingRepo(false);
    }
  }, [task?.id, task?.repo_name, fetchPRs]);

  useEffect(() => {
    fetchPRs();
  }, [fetchPRs]);

  // Auto-sync repository PRs once on mount if repo is attached and PRs are empty
  useEffect(() => {
    if (task?.id && task.repo_name && prs.length === 0 && !loading && !hasAutoSyncedRef.current[task.id]) {
      hasAutoSyncedRef.current[task.id] = true;
      syncRepoPRs();
    }
  }, [task?.id, task?.repo_name, prs.length, loading, syncRepoPRs]);

  // WebSocket subscriptions for realtime updates with filter context reflection
  useEffect(() => {
    if (!task?.id) return;

    const unsubPrUpdated = subscribe('TASK_PR_UPDATED', (data: any) => {
      if (data.task_id === task.id) {
        fetchPRs();
        if (data.filter_context) {
          if (data.filter_context.author) {
            setAuthorFilter(data.filter_context.author);
          }
          if (data.filter_context.state) {
            setStatusFilter(data.filter_context.state.toUpperCase());
          }
        }
      }
    });

    const unsubPrTestCompleted = subscribe('TASK_PR_TEST_COMPLETED', (data: any) => {
      if (data.task_id === task.id) {
        fetchPRs();
      }
    });

    const unsubPrReviewed = subscribe('TASK_PR_REVIEWED', (data: any) => {
      if (data.task_id === task.id) {
        fetchPRs();
      }
    });

    const unsubPrListenerUpdated = subscribe('PR_LISTENER_UPDATED', (data: any) => {
      if (data && data.task_id === task.id) {
        setPrs((prev) =>
          prev.map((p) =>
            p.pr_number === data.pr_number
              ? {
                  ...p,
                  is_listening: data.is_listening,
                  listening_events: data.listening_events,
                  listener_persona: data.listener_persona,
                  auto_commit_fixes: data.auto_commit_fixes,
                }
              : p
          )
        );
      }
    });

    return () => {
      unsubPrUpdated();
      unsubPrTestCompleted();
      unsubPrReviewed();
      unsubPrListenerUpdated();
    };
  }, [subscribe, task?.id, fetchPRs]);

  // Trigger agent actions on a PR (e.g. sync)
  const handleTriggerAction = async (pr: TaskPR, action: 'run_tests' | 'post_review' | 'sync') => {
    if (!task?.id) return;
    const prIdentifier = pr.id || String(pr.pr_number);
    setActionLoading((prev) => ({ ...prev, [prIdentifier]: action }));

    try {
      const res = await fetch(`${API_BASE}/api/tasks/${task.id}/prs/${prIdentifier}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      if (res.ok) {
        await fetchPRs();
      }
    } catch (err) {
      console.error(`Failed to execute PR action '${action}':`, err);
    } finally {
      setActionLoading((prev) => ({ ...prev, [prIdentifier]: null }));
    }
  };

  // Launch Review Agent Popover for a PR
  const handleOpenReviewAgent = (pr: TaskPR, lineCtx?: LineContext) => {
    setActivePopoverPR(pr);
    if (lineCtx) {
      setActiveLineComment(lineCtx);
    } else {
      setActiveLineComment(null);
    }
  };

  // Scoped PR Lists
  const sessionScopedPrs = useMemo(() => {
    return prs.filter((p) => p.is_session_scoped !== false);
  }, [prs]);

  const displayedScopedPrs = useMemo(() => {
    if (scopeFilter === 'SESSION' && sessionScopedPrs.length > 0) {
      return sessionScopedPrs;
    }
    return prs;
  }, [scopeFilter, sessionScopedPrs, prs]);

  // Extract unique authors across displayed scoped PRs
  const uniqueAuthors = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of displayedScopedPrs) {
      const a = p.author || 'unknown';
      counts[a] = (counts[a] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [displayedScopedPrs]);

  const filteredPrs = useMemo(() => {
    return displayedScopedPrs.filter((pr) => {
      if (authorFilter !== 'ALL') {
        const prAuthor = (pr.author || '').toLowerCase();
        const targetAuthor = authorFilter.toLowerCase().replace('@', '');
        if (!prAuthor.includes(targetAuthor)) return false;
      }
      if (statusFilter !== 'ALL') {
        if (statusFilter === 'OPEN' && pr.status !== 'OPEN') return false;
        if (statusFilter === 'REVIEWING' && pr.status !== 'REVIEWING') return false;
        if (statusFilter === 'PASSING' && pr.status !== 'TESTS_PASSING') return false;
        if (statusFilter === 'FAILED' && pr.status !== 'TESTS_FAILED') return false;
        if (statusFilter === 'MERGED' && pr.status !== 'MERGED') return false;
        if (statusFilter === 'CLOSED' && pr.status !== 'CLOSED') return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchNum = String(pr.pr_number).includes(q);
        const matchTitle = pr.title?.toLowerCase().includes(q);
        const matchAuthor = pr.author?.toLowerCase().includes(q);
        const matchBranch = pr.head_branch?.toLowerCase().includes(q) || pr.base_branch?.toLowerCase().includes(q);
        if (!matchNum && !matchTitle && !matchAuthor && !matchBranch) return false;
      }
      return true;
    });
  }, [displayedScopedPrs, authorFilter, statusFilter, searchQuery]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'TESTS_PASSING':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-onedark-green/15 text-onedark-green">
            <CheckCircle2 className="w-3 h-3" />
            Tests Passing
          </span>
        );
      case 'TESTS_FAILED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-onedark-red/15 text-onedark-red">
            <XCircle className="w-3 h-3" />
            Tests Failed
          </span>
        );
      case 'REVIEWING':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-onedark-purple/15 text-onedark-purple animate-pulse">
            <Sparkles className="w-3 h-3" />
            Reviewing
          </span>
        );
      case 'MERGED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-purple-500/15 text-purple-400">
            <GitMerge className="w-3 h-3" />
            Merged
          </span>
        );
      case 'CLOSED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-onedark-muted/15 text-onedark-muted">
            Closed
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-onedark-accent/15 text-onedark-accent">
            <Clock className="w-3 h-3" />
            Open
          </span>
        );
    }
  };

  if (!task) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-onedark-muted font-sans text-xs">
        <GitPullRequest className="w-8 h-8 mb-2 opacity-40 text-onedark-accent" />
        <p>No active workspace session selected.</p>
      </div>
    );
  }

  // Check whether selectedPr actually belongs to the current task
  const isSelectedPrValidForTask = useMemo(() => {
    if (!selectedPr && !selectedPrUrl) return false;
    if (!task) return false;
    const prRecord = selectedPr?.record;
    if (prRecord && prRecord.task_id && prRecord.task_id !== task.id) return false;
    const effectiveUrl = selectedPr?.url || selectedPrUrl || prRecord?.html_url;
    if (effectiveUrl && task.repo_name) {
      if (!effectiveUrl.toLowerCase().includes(task.repo_name.toLowerCase())) {
        return false;
      }
    }
    return true;
  }, [selectedPr, selectedPrUrl, task]);

  // If a PR is selected or opened via previewTarget, render full-fidelity PR Inspector
  if ((selectedPr || selectedPrUrl) && isSelectedPrValidForTask) {
    const effectiveUrl = selectedPr?.url || selectedPrUrl;
    return (
      <PRDetailView
        key={`${effectiveUrl || selectedPr?.number || 'detail'}-${task.id}`}
        url={effectiveUrl}
        prNumber={selectedPr?.number}
        prRecord={selectedPr?.record}
        task={task}
        onBack={() => {
          setSelectedPr(null);
          onClearSelectedPr?.();
        }}
        onCloneToSession={onCloneToSession}
        onAskAboutComment={onAskAboutComment}
      />
    );
  }

  return (
    <div className="flex flex-col h-full bg-onedark-darker overflow-hidden text-onedark-fg font-sans text-xs">
      {/* Top Header & Scope Controls */}
      <div className="px-3 py-2.5 border-b border-onedark-borderSubtle bg-onedark-darker flex flex-col gap-2 flex-shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <GitPullRequest className="w-4 h-4 text-onedark-accent" />
            <span className="font-semibold text-onedark-fgBright text-xs">Pull Requests</span>
            <span className="px-1.5 py-0.2 rounded-full bg-onedark-surface text-[10px] font-mono text-onedark-muted">
              {displayedScopedPrs.length}
            </span>
          </div>

          {/* Session vs All Repo Segmented Toggle */}
          {prs.length > sessionScopedPrs.length && sessionScopedPrs.length > 0 && (
            <div className="flex items-center gap-1 bg-onedark-surface/60 p-0.5 rounded">
              <button
                onClick={() => setScopeFilter('SESSION')}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer ${
                  scopeFilter === 'SESSION'
                    ? 'bg-onedark-accent text-white font-semibold'
                    : 'text-onedark-muted hover:text-onedark-fg'
                }`}
              >
                Session ({sessionScopedPrs.length})
              </button>
              <button
                onClick={() => setScopeFilter('ALL_REPO')}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer ${
                  scopeFilter === 'ALL_REPO'
                    ? 'bg-onedark-accent text-white font-semibold'
                    : 'text-onedark-muted hover:text-onedark-fg'
                }`}
              >
                All ({prs.length})
              </button>
            </div>
          )}

          <div className="flex items-center gap-1.5 ml-auto">
            {task.repo_name && (
              <button
                onClick={() => syncRepoPRs()}
                disabled={isSyncingRepo || loading}
                title={`Sync all PRs from ${task.repo_name}`}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-onedark-surface hover:bg-onedark-surface/80 border border-onedark-borderSubtle text-[11px] text-onedark-fg font-medium transition-colors disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw className={`w-3 h-3 ${isSyncingRepo ? 'animate-spin text-onedark-accent' : ''}`} />
                <span>{isSyncingRepo ? 'Syncing...' : 'Sync Repo'}</span>
              </button>
            )}

            <button
              onClick={fetchPRs}
              disabled={loading}
              title="Refresh PRs"
              className="p-1.5 rounded-md hover:bg-onedark-surface border border-transparent hover:border-onedark-borderSubtle text-onedark-muted hover:text-onedark-fg transition-colors disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-onedark-accent' : ''}`} />
            </button>
          </div>
        </div>

        {/* Filter Pills & Search */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="relative flex-1 min-w-[120px]">
            <Search className="w-3 h-3 text-onedark-muted absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Filter PRs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-7 pr-2.5 py-1 text-[11px] rounded-md bg-onedark-surface border border-onedark-border text-onedark-fg placeholder:text-onedark-muted/60 focus:outline-none focus:border-onedark-accent"
            />
          </div>

          <div className="flex items-center gap-1 text-[10px]">
            {(['ALL', 'OPEN', 'REVIEWING', 'PASSING', 'FAILED', 'MERGED', 'CLOSED'] as const).map((filterKey) => (
              <button
                key={filterKey}
                onClick={() => setStatusFilter(filterKey)}
                className={`px-2 py-0.5 rounded font-mono transition-colors cursor-pointer border ${
                  statusFilter === filterKey
                    ? 'bg-onedark-accent text-white font-semibold shadow-xs border-onedark-accent'
                    : 'bg-onedark-surface/50 border-onedark-borderSubtle text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface'
                }`}
              >
                {filterKey === 'ALL' ? 'All' : filterKey.charAt(0) + filterKey.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Dynamic Author Chips Bar */}
        {uniqueAuthors.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 scrollbar-thin text-[10px] border-t border-onedark-borderSubtle pt-1.5">
            <span className="text-onedark-muted flex-shrink-0 flex items-center gap-1">
              <User className="w-3 h-3" /> Author:
            </span>
            <button
              onClick={() => setAuthorFilter('ALL')}
              className={`px-2 py-0.5 rounded font-mono transition-colors flex-shrink-0 cursor-pointer border ${
                authorFilter === 'ALL'
                  ? 'bg-onedark-purple text-white font-semibold shadow-xs border-onedark-purple'
                  : 'bg-onedark-surface/60 border-onedark-borderSubtle text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface'
              }`}
            >
              All ({displayedScopedPrs.length})
            </button>
            {uniqueAuthors.map(([author, count]) => {
              const isSelected = authorFilter.toLowerCase().replace('@', '') === author.toLowerCase().replace('@', '');
              return (
                <button
                  key={author}
                  onClick={() => setAuthorFilter(isSelected ? 'ALL' : author)}
                  className={`px-2 py-0.5 rounded font-mono transition-colors flex-shrink-0 flex items-center gap-1 cursor-pointer border ${
                    isSelected
                      ? 'bg-onedark-purple text-white font-semibold shadow-xs border-onedark-purple'
                      : 'bg-onedark-surface/60 border-onedark-borderSubtle text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface'
                  }`}
                >
                  <span>@{author}</span>
                  <span className="opacity-75">({count})</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* PR Cards Container */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {(loading || isSyncingRepo) && prs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-onedark-muted space-y-2">
            <Loader2 className="w-6 h-6 animate-spin text-onedark-accent" />
            <span className="text-xs font-mono">Synchronizing pull requests from repository...</span>
          </div>
        ) : filteredPrs.length === 0 ? (
          <div className="rounded-lg bg-onedark-surface/20 border border-onedark-borderSubtle p-8 text-center text-onedark-muted">
            <GitPullRequest className="w-8 h-8 mx-auto mb-2 opacity-30 text-onedark-accent" />
            <p className="font-medium text-onedark-fgBright text-xs mb-1">No matching pull requests</p>
            <p className="text-[11px] text-onedark-muted max-w-sm mx-auto mb-3">
              {prs.length === 0 
                ? `Pull requests linked to repo ${task.repo_name || 'workspace'} will appear here with live test execution, automated reviews, and diff analysis.`
                : authorFilter !== 'ALL' || statusFilter !== 'ALL'
                ? `No pull requests found matching author '${authorFilter}' with status '${statusFilter}'.`
                : 'No pull requests match the current filter query.'}
            </p>
            <div className="flex items-center justify-center gap-2 flex-wrap">
              {(authorFilter !== 'ALL' || statusFilter !== 'ALL' || scopeFilter !== 'ALL_REPO') && (
                <button
                  onClick={() => {
                    setAuthorFilter('ALL');
                    setStatusFilter('ALL');
                    setScopeFilter('ALL_REPO');
                  }}
                  className="px-3 py-1.5 rounded-md bg-onedark-surface hover:bg-onedark-surface/80 border border-onedark-borderSubtle text-onedark-fg text-xs font-medium transition-colors cursor-pointer"
                >
                  Reset Filters & Show All
                </button>
              )}
              {task.repo_name && prs.length === 0 && (
                <button
                  onClick={() => syncRepoPRs()}
                  disabled={isSyncingRepo}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-onedark-accent hover:bg-onedark-accentHover text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncingRepo ? 'animate-spin' : ''}`} />
                  <span>{isSyncingRepo ? 'Importing PRs...' : `Import PRs from ${task.repo_name}`}</span>
                </button>
              )}
            </div>
          </div>
        ) : (
          filteredPrs.map((pr) => {
            const prIdentifier = pr.id || String(pr.pr_number);
            const isActionRunning = actionLoading[prIdentifier] !== null && actionLoading[prIdentifier] !== undefined;
            const currentAction = actionLoading[prIdentifier];

            const adds = pr.diff_stats?.additions ?? 0;
            const dels = pr.diff_stats?.deletions ?? 0;
            const fileCount = pr.diff_stats?.changed_files ?? 0;

            const prUrl = pr.html_url || (task.repo_name ? `https://github.com/${task.repo_name}/pull/${pr.pr_number}` : undefined);

            return (
              <div 
                key={pr.id || pr.pr_number}
                onClick={() => setSelectedPr({ url: prUrl, number: pr.pr_number, record: pr })}
                className={`group rounded-lg p-2.5 transition-colors cursor-pointer select-none ${
                  pr.is_session_scoped 
                    ? 'bg-onedark-accent/10 hover:bg-onedark-accent/15 border border-onedark-accent/30 hover:border-onedark-accent/50' 
                    : 'bg-onedark-surface/30 hover:bg-onedark-surface/60 border border-onedark-borderSubtle hover:border-onedark-border'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start space-x-2.5 min-w-0 flex-1">
                    {/* PR State Icon */}
                    <div className="mt-0.5 flex-shrink-0">
                      <GitPullRequest className={`w-4 h-4 ${
                        pr.status === 'MERGED' 
                          ? 'text-onedark-purple' 
                          : pr.status === 'CLOSED' 
                          ? 'text-onedark-red' 
                          : 'text-onedark-green'
                      }`} />
                    </div>

                    <div className="min-w-0 flex-1">
                      {/* Top Row: #PR Number, Title, Status Badge */}
                      <div className="flex items-center gap-2 flex-wrap leading-snug mb-1.5">
                        <span className="font-mono text-xs font-bold text-onedark-accent group-hover:underline">
                          #{pr.pr_number}
                        </span>
                        <h4 
                          className="font-semibold text-onedark-fgBright text-xs truncate group-hover:text-onedark-accent transition-colors"
                          title={pr.title}
                        >
                          {pr.title}
                        </h4>
                        {getStatusBadge(pr.status)}
                        {pr.is_draft && (
                          <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-medium bg-onedark-muted/20 text-onedark-muted border border-onedark-muted/30">
                            Draft
                          </span>
                        )}
                        {pr.is_session_scoped && (
                          <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-medium bg-onedark-accent/15 text-onedark-accent">
                            Session
                          </span>
                        )}
                        {(() => {
                          const matches = `${pr.title} ${pr.head_branch || ''}`.match(/\b([A-Z]{2,10}-\d+)\b/gi);
                          if (!matches) return null;
                          const uniqueKeys = Array.from(new Set(matches.map(m => m.toUpperCase())));
                          return uniqueKeys.map(k => (
                            <span
                              key={k}
                              className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded-full font-mono text-[9.5px] font-bold bg-indigo-500/15 text-indigo-400 border border-indigo-500/30"
                            >
                              <Zap className="w-2.5 h-2.5" />
                              <span>{k}</span>
                            </span>
                          ));
                        })()}
                      </div>

                      {/* Metadata Row: Author, Branch flow, Diff stats, Date */}
                      <div className="flex items-center gap-2.5 text-[11px] text-onedark-muted flex-wrap">
                        {pr.author && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setAuthorFilter(pr.author);
                            }}
                            className="flex items-center gap-1 font-mono hover:text-onedark-fg transition-colors cursor-pointer"
                            title={`Filter by @${pr.author}`}
                          >
                            <User className="w-3 h-3 text-onedark-muted" />
                            @{pr.author}
                          </button>
                        )}

                        <span className="flex items-center gap-1 font-mono text-[10.5px] text-onedark-purple bg-onedark-surface/40 px-1.5 py-0.5 rounded">
                          <GitBranch className="w-3 h-3 text-onedark-purple flex-shrink-0" />
                          <span className="text-onedark-fgBright">{pr.head_branch || 'feature'}</span>
                          <span className="text-onedark-muted">➔</span>
                          <span className="text-onedark-muted">{pr.base_branch || 'main'}</span>
                        </span>

                        <span className="flex items-center gap-1.5 font-mono text-[10px]">
                          {(adds > 0 || dels > 0) ? (
                            <>
                              <span className="text-onedark-green font-semibold">+{adds.toLocaleString()}</span>
                              <span className="text-onedark-red font-semibold">-{dels.toLocaleString()}</span>
                            </>
                          ) : (
                            <span className="text-onedark-muted">diff pending</span>
                          )}
                          {fileCount > 0 && <span className="text-onedark-muted/80">({fileCount} files)</span>}
                        </span>

                        {pr.created_at && (
                          <span className="flex items-center gap-1 text-[10.5px] text-onedark-muted/70">
                            <Clock className="w-3 h-3" />
                            <span>{new Date(pr.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right Actions: Inspect, Listen, Sync, External Link */}
                  <div className="flex items-center gap-1.5 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                    {/* Listen Button */}
                    <button
                      type="button"
                      onClick={() => setActiveListenerPR(pr)}
                      className={`px-2 py-1 rounded-md text-[11px] font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                        pr.is_listening
                          ? 'bg-onedark-green/15 text-onedark-green border border-onedark-green/30 hover:bg-onedark-green/25'
                          : 'bg-onedark-surface hover:bg-onedark-border text-onedark-muted hover:text-onedark-fg border border-onedark-borderSubtle'
                      }`}
                      title="Configure autonomous webhook event listeners for this PR"
                    >
                      {pr.is_listening ? (
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-onedark-green opacity-75" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-onedark-green" />
                        </span>
                      ) : (
                        <Radio className="w-3 h-3" />
                      )}
                      <span>{pr.is_listening ? 'Listening' : 'Listen'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setSelectedPr({ url: prUrl, number: pr.pr_number, record: pr })}
                      className="px-2.5 py-1 rounded-md bg-onedark-surface/80 hover:bg-onedark-accent/20 text-[11px] text-onedark-accent font-semibold transition-all cursor-pointer flex items-center gap-1.5"
                      title="Open full-screen PR Inspector with diffs, commits, comments & review agent"
                    >
                      <FileText className="w-3 h-3" />
                      <span>Inspect</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleTriggerAction(pr, 'sync')}
                      disabled={isActionRunning}
                      className="p-1 rounded-md text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface transition-colors disabled:opacity-50 cursor-pointer"
                      title="Sync PR from GitHub"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${currentAction === 'sync' ? 'animate-spin text-onedark-accent' : ''}`} />
                    </button>

                    {pr.html_url && (
                      <a
                        href={pr.html_url}
                        target="_blank"
                        rel="noreferrer"
                        className="p-1 rounded-md text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface transition-colors"
                        title="Open on GitHub"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* PR Review Agent Popover */}
      {activePopoverPR && (
        <PRReviewAgentPopover
          isOpen={!!activePopoverPR}
          onClose={() => {
            setActivePopoverPR(null);
            setActiveLineComment(null);
          }}
          repoName={task.repo_name || 'workspace'}
          prNumber={activePopoverPR.pr_number}
          prTitle={activePopoverPR.title}
          author={activePopoverPR.author}
          headBranch={activePopoverPR.head_branch}
          baseBranch={activePopoverPR.base_branch}
          parentTaskId={task.id}
          activeLineComment={activeLineComment}
          onClearActiveLineComment={() => setActiveLineComment(null)}
          onNavigateToFileLine={onNavigateToFileLine}
        />
      )}

      {/* PR Listener Config Modal */}
      {activeListenerPR && task && (
        <PRListenerConfigModal
          task={task}
          pr={activeListenerPR}
          isOpen={!!activeListenerPR}
          onClose={() => setActiveListenerPR(null)}
          onSaved={(isListening, events) => {
            setPrs((prev) =>
              prev.map((p) =>
                p.pr_number === activeListenerPR.pr_number
                  ? { ...p, is_listening: isListening, listening_events: events }
                  : p
              )
            );
          }}
        />
      )}
    </div>
  );
};
