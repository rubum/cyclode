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
  Filter
} from 'lucide-react';
import { Task, TaskPR } from '../../types';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { MarkdownRenderer } from '../Common/MarkdownRenderer';
import { PRReviewAgentPopover, LineContext } from './PRReviewAgentPopover';
import { PRDetailView } from './PRDetailView';

interface PullRequestsTabProps {
  task: Task | null;
  selectedPrUrl?: string | null;
  onClearSelectedPr?: () => void;
  onNavigateToFileLine?: (filename: string, line: number) => void;
  onOpenPreview?: (url: string, title?: string) => void;
  onCloneToSession?: (repoUrl: string, repoName: string) => void;
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
  onCloneToSession
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
      setPrDiffsData({});
      setExpandedDiffs({});
      setExpandedOverview({});
      setExpandedTests({});
      setExpandedReviews({});
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
  
  // Expanded panels
  const [expandedOverview, setExpandedOverview] = useState<Record<number, boolean>>({});
  const [expandedDiffs, setExpandedDiffs] = useState<Record<number, boolean>>({});
  const [expandedTests, setExpandedTests] = useState<Record<number, boolean>>({});
  const [expandedReviews, setExpandedReviews] = useState<Record<number, boolean>>({});
  const [prDiffsData, setPrDiffsData] = useState<Record<number, PRDiffFile[]>>({});
  const [diffsLoading, setDiffsLoading] = useState<Record<number, boolean>>({});

  // Review Agent Popover state
  const [activePopoverPR, setActivePopoverPR] = useState<TaskPR | null>(null);
  const [activeLineComment, setActiveLineComment] = useState<LineContext | null>(null);
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
    if (!task?.id) {
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

    return () => {
      unsubPrUpdated();
      unsubPrTestCompleted();
      unsubPrReviewed();
    };
  }, [subscribe, task?.id, fetchPRs]);

  // Fetch diffs for a specific PR
  const fetchPRDiffs = async (prNumber: number) => {
    if (!task?.id) return;
    setDiffsLoading((prev) => ({ ...prev, [prNumber]: true }));
    try {
      const res = await fetch(`${API_BASE}/api/tasks/${task.id}/prs/${prNumber}/diff`);
      if (res.ok) {
        const data = await res.json();
        setPrDiffsData((prev) => ({ ...prev, [prNumber]: data.diffs || [] }));
      }
    } catch (err) {
      console.error(`Failed to fetch diffs for PR #${prNumber}:`, err);
    } finally {
      setDiffsLoading((prev) => ({ ...prev, [prNumber]: false }));
    }
  };

  const toggleOverview = (prNumber: number) => {
    setExpandedOverview((prev) => ({ ...prev, [prNumber]: !prev[prNumber] }));
  };

  const toggleDiffView = (prNumber: number) => {
    setExpandedDiffs((prev) => {
      const next = !prev[prNumber];
      if (next && !prDiffsData[prNumber]) {
        fetchPRDiffs(prNumber);
      }
      return { ...prev, [prNumber]: next };
    });
  };

  const toggleTestView = (prNumber: number) => {
    setExpandedTests((prev) => ({ ...prev, [prNumber]: !prev[prNumber] }));
  };

  const toggleReviewView = (prNumber: number) => {
    setExpandedReviews((prev) => ({ ...prev, [prNumber]: !prev[prNumber] }));
  };

  // Trigger agent actions on a PR
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
        if (action === 'run_tests') {
          setExpandedTests((prev) => ({ ...prev, [pr.pr_number]: true }));
        } else if (action === 'post_review') {
          setExpandedReviews((prev) => ({ ...prev, [pr.pr_number]: true }));
        }
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
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-onedark-green/15 text-onedark-green border border-onedark-green/30">
            <CheckCircle2 className="w-3 h-3" />
            Tests Passing
          </span>
        );
      case 'TESTS_FAILED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-onedark-red/15 text-onedark-red border border-onedark-red/30">
            <XCircle className="w-3 h-3" />
            Tests Failed
          </span>
        );
      case 'REVIEWING':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-onedark-purple/15 text-onedark-purple border border-onedark-purple/30 animate-pulse">
            <Sparkles className="w-3 h-3" />
            Reviewing
          </span>
        );
      case 'MERGED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-purple-500/15 text-purple-400 border border-purple-500/30">
            <GitMerge className="w-3 h-3" />
            Merged
          </span>
        );
      case 'CLOSED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-onedark-muted/15 text-onedark-muted border border-onedark-borderSubtle">
            Closed
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-onedark-accent/15 text-onedark-accent border border-onedark-accent/30">
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
      />
    );
  }

  return (
    <div className="flex flex-col h-full bg-onedark-darker overflow-hidden text-onedark-fg font-sans text-xs">
      {/* Top Header & Scope Controls */}
      <div className="px-3 py-2.5 border-b border-onedark-border bg-onedark-darker flex flex-col gap-2 flex-shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <GitPullRequest className="w-4 h-4 text-onedark-accent" />
            <span className="font-semibold text-onedark-fgBright text-xs">Pull Requests</span>
            <span className="px-1.5 py-0.2 rounded-full bg-onedark-surface text-[10px] font-mono text-onedark-muted border border-onedark-border">
              {displayedScopedPrs.length}
            </span>
          </div>

          {/* Session vs All Repo Segmented Toggle */}
          {prs.length > sessionScopedPrs.length && sessionScopedPrs.length > 0 && (
            <div className="flex items-center gap-1 bg-onedark-surface/60 p-0.5 rounded border border-onedark-border">
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
                className="flex items-center gap-1 px-2 py-1 rounded bg-onedark-surface hover:bg-onedark-borderSubtle text-[11px] text-onedark-fg font-medium border border-onedark-border transition-colors disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw className={`w-3 h-3 ${isSyncingRepo ? 'animate-spin text-onedark-accent' : ''}`} />
                <span>{isSyncingRepo ? 'Syncing...' : 'Sync Repo'}</span>
              </button>
            )}

            <button
              onClick={fetchPRs}
              disabled={loading}
              title="Refresh PRs"
              className="p-1.5 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg transition-colors disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-onedark-accent' : ''}`} />
            </button>
          </div>
        </div>

        {/* Filter Pills & Search */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="relative flex-1 min-w-[120px]">
            <Search className="w-3 h-3 text-onedark-muted absolute left-2 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Filter PRs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-6 pr-2 py-1 text-[11px] rounded bg-onedark-surface border border-onedark-border text-onedark-fg placeholder:text-onedark-muted focus:outline-none focus:border-onedark-accent"
            />
          </div>

          <div className="flex items-center gap-1 text-[10px]">
            {(['ALL', 'OPEN', 'REVIEWING', 'PASSING', 'FAILED', 'MERGED', 'CLOSED'] as const).map((filterKey) => (
              <button
                key={filterKey}
                onClick={() => setStatusFilter(filterKey)}
                className={`px-2 py-0.5 rounded font-mono transition-colors cursor-pointer ${
                  statusFilter === filterKey
                    ? 'bg-onedark-accent text-white font-semibold shadow-xs'
                    : 'bg-onedark-surface/60 text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface'
                }`}
              >
                {filterKey === 'ALL' ? 'All' : filterKey.charAt(0) + filterKey.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Dynamic Author Chips Bar */}
        {uniqueAuthors.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 scrollbar-thin text-[10px] border-t border-onedark-border/30 pt-1.5">
            <span className="text-onedark-muted flex-shrink-0 flex items-center gap-1">
              <User className="w-3 h-3" /> Author:
            </span>
            <button
              onClick={() => setAuthorFilter('ALL')}
              className={`px-2 py-0.5 rounded font-mono transition-colors flex-shrink-0 cursor-pointer ${
                authorFilter === 'ALL'
                  ? 'bg-onedark-purple text-white font-semibold shadow-xs'
                  : 'bg-onedark-surface text-onedark-muted hover:text-onedark-fg hover:bg-onedark-borderSubtle'
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
                  className={`px-2 py-0.5 rounded font-mono transition-colors flex-shrink-0 flex items-center gap-1 cursor-pointer ${
                    isSelected
                      ? 'bg-onedark-purple text-white font-semibold shadow-xs'
                      : 'bg-onedark-surface text-onedark-muted hover:text-onedark-fg hover:bg-onedark-borderSubtle'
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
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {(loading || isSyncingRepo) && prs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-onedark-muted space-y-2">
            <Loader2 className="w-6 h-6 animate-spin text-onedark-accent" />
            <span className="text-xs font-mono">Synchronizing pull requests from repository...</span>
          </div>
        ) : filteredPrs.length === 0 ? (
          <div className="rounded-lg border border-dashed border-onedark-borderSubtle bg-onedark-surface/20 p-8 text-center text-onedark-muted">
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
                  className="px-3 py-1.5 rounded bg-onedark-surface hover:bg-onedark-borderSubtle text-onedark-fg text-xs font-medium border border-onedark-border transition-colors cursor-pointer"
                >
                  Reset Filters & Show All
                </button>
              )}
              {task.repo_name && prs.length === 0 && (
                <button
                  onClick={() => syncRepoPRs()}
                  disabled={isSyncingRepo}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-onedark-accent hover:bg-onedark-accentHover text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer disabled:opacity-50"
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
            const isOverviewExpanded = !!expandedOverview[pr.pr_number];
            const isDiffExpanded = !!expandedDiffs[pr.pr_number];
            const isTestExpanded = !!expandedTests[pr.pr_number];
            const isReviewExpanded = !!expandedReviews[pr.pr_number];
            const diffs = prDiffsData[pr.pr_number] || [];
            const isDiffLoading = !!diffsLoading[pr.pr_number];

            const adds = pr.diff_stats?.additions ?? (diffs.reduce((acc, d) => acc + (d.additions || 0), 0));
            const dels = pr.diff_stats?.deletions ?? (diffs.reduce((acc, d) => acc + (d.deletions || 0), 0));
            const fileCount = pr.diff_stats?.changed_files ?? diffs.length;

            return (
              <div 
                key={pr.id || pr.pr_number}
                className={`rounded-lg border bg-onedark-surface/30 overflow-hidden shadow-sm transition-all ${
                  pr.is_session_scoped 
                    ? 'border-onedark-border/80 ring-1 ring-onedark-accent/20' 
                    : 'border-onedark-border hover:border-onedark-borderSubtle'
                }`}
              >
                {/* PR Header Row */}
                <div className="p-3 bg-onedark-surface/60 border-b border-onedark-border/60">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <button
                          onClick={() => setSelectedPr({ url: pr.html_url || (task.repo_name ? `https://github.com/${task.repo_name}/pull/${pr.pr_number}` : undefined), number: pr.pr_number, record: pr })}
                          className="font-mono text-xs font-bold text-onedark-accent hover:underline cursor-pointer"
                          title="Open PR Inspector"
                        >
                          #{pr.pr_number}
                        </button>
                        <h4 
                          onClick={() => setSelectedPr({ url: pr.html_url || (task.repo_name ? `https://github.com/${task.repo_name}/pull/${pr.pr_number}` : undefined), number: pr.pr_number, record: pr })}
                          className="font-semibold text-onedark-fgBright text-xs truncate cursor-pointer hover:text-onedark-accent transition-colors"
                          title="Open PR Inspector"
                        >
                          {pr.title}
                        </h4>
                        {getStatusBadge(pr.status)}
                      </div>

                      <div className="flex items-center gap-3 text-[11px] text-onedark-muted flex-wrap">
                        {pr.author && (
                          <button
                            onClick={() => setAuthorFilter(pr.author)}
                            className="flex items-center gap-1 font-mono hover:text-onedark-fg transition-colors cursor-pointer"
                            title={`Filter by @${pr.author}`}
                          >
                            <User className="w-3 h-3 text-onedark-muted" />
                            @{pr.author}
                          </button>
                        )}

                        <span className="flex items-center gap-1 font-mono text-onedark-purple">
                          <GitBranch className="w-3 h-3" />
                          <span className="text-onedark-fgBright">{pr.head_branch || 'feature'}</span>
                          <span className="text-onedark-muted">➔</span>
                          <span>{pr.base_branch || 'main'}</span>
                        </span>

                        <span className="flex items-center gap-1.5 font-mono text-[10px]">
                          {(adds > 0 || dels > 0) ? (
                            <>
                              <span className="text-onedark-green font-semibold">+{adds}</span>
                              <span className="text-onedark-red font-semibold">-{dels}</span>
                            </>
                          ) : (
                            <span className="text-onedark-muted">diff pending</span>
                          )}
                          {fileCount > 0 && <span className="text-onedark-muted">({fileCount} files)</span>}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => setSelectedPr({ url: pr.html_url || (task.repo_name ? `https://github.com/${task.repo_name}/pull/${pr.pr_number}` : undefined), number: pr.pr_number, record: pr })}
                        className="px-2 py-1 rounded bg-onedark-surface hover:bg-onedark-surface/80 border border-onedark-border text-[11px] text-onedark-accent font-semibold transition-colors cursor-pointer flex items-center gap-1"
                        title="Open full-screen PR Inspector with unified diffs, overview & review agent"
                      >
                        <FileText className="w-3 h-3" />
                        <span>Inspect</span>
                      </button>

                      {pr.html_url && (
                        <a
                          href={pr.html_url}
                          target="_blank"
                          rel="noreferrer"
                          className="p-1 rounded text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface transition-colors"
                          title="Open on GitHub"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>
                  </div>

                  {/* Quick Action Button Toolbar */}
                  <div className="mt-3 pt-2 border-t border-onedark-border/40 flex items-center gap-1.5 flex-wrap">
                    {/* Run Tests Button */}
                    <button
                      onClick={() => handleTriggerAction(pr, 'run_tests')}
                      disabled={isActionRunning}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium bg-onedark-surface hover:bg-onedark-borderSubtle text-onedark-fg border border-onedark-border transition-colors disabled:opacity-50 cursor-pointer"
                      title="Run tests in sandbox worktree"
                    >
                      {currentAction === 'run_tests' ? (
                        <Loader2 className="w-3 h-3 animate-spin text-onedark-accent" />
                      ) : (
                        <Play className="w-3 h-3 text-onedark-green fill-onedark-green/30" />
                      )}
                      <span>Run Tests</span>
                    </button>

                    {/* AI Review Button */}
                    <button
                      onClick={() => handleTriggerAction(pr, 'post_review')}
                      disabled={isActionRunning}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium bg-onedark-surface hover:bg-onedark-borderSubtle text-onedark-fg border border-onedark-border transition-colors disabled:opacity-50 cursor-pointer"
                      title="Trigger AI Code Review"
                    >
                      {currentAction === 'post_review' ? (
                        <Loader2 className="w-3 h-3 animate-spin text-onedark-accent" />
                      ) : (
                        <ShieldCheck className="w-3 h-3 text-onedark-purple" />
                      )}
                      <span>AI Review</span>
                    </button>

                    {/* Review Agent Sub-Session Popover Button */}
                    <button
                      onClick={() => handleOpenReviewAgent(pr)}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-semibold bg-onedark-accent/15 hover:bg-onedark-accent/25 text-onedark-accent border border-onedark-accent/30 transition-colors cursor-pointer"
                      title="Launch interactive PR review sub-session agent"
                    >
                      <Bot className="w-3 h-3" />
                      <span>Review Agent</span>
                    </button>

                    {/* Sync Metadata Button */}
                    <button
                      onClick={() => handleTriggerAction(pr, 'sync')}
                      disabled={isActionRunning}
                      className="p-1 rounded text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface transition-colors disabled:opacity-50 ml-auto"
                      title="Sync PR from GitHub"
                    >
                      <RefreshCw className={`w-3 h-3 ${currentAction === 'sync' ? 'animate-spin text-onedark-accent' : ''}`} />
                    </button>
                  </div>
                </div>

                {/* Sub-panel Toggles Bar */}
                <div className="px-3 py-1.5 bg-onedark-darker/60 flex items-center justify-between text-[11px] border-b border-onedark-border/30">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleOverview(pr.pr_number)}
                      className={`flex items-center gap-1 px-2 py-0.5 rounded transition-colors cursor-pointer ${
                        isOverviewExpanded
                          ? 'bg-onedark-surface text-onedark-fgBright font-medium'
                          : 'text-onedark-muted hover:text-onedark-fg'
                      }`}
                    >
                      <FileText className="w-3 h-3 text-onedark-accent" />
                      <span>Overview</span>
                      {isOverviewExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>

                    <button
                      onClick={() => toggleDiffView(pr.pr_number)}
                      className={`flex items-center gap-1 px-2 py-0.5 rounded transition-colors cursor-pointer ${
                        isDiffExpanded
                          ? 'bg-onedark-surface text-onedark-fgBright font-medium'
                          : 'text-onedark-muted hover:text-onedark-fg'
                      }`}
                    >
                      <FileCode2 className="w-3 h-3 text-onedark-accent" />
                      <span>Diffs</span>
                      {isDiffExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>

                    {pr.test_output && (
                      <button
                        onClick={() => toggleTestView(pr.pr_number)}
                        className={`flex items-center gap-1 px-2 py-0.5 rounded transition-colors cursor-pointer ${
                          isTestExpanded
                            ? 'bg-onedark-surface text-onedark-fgBright font-medium'
                            : 'text-onedark-muted hover:text-onedark-fg'
                        }`}
                      >
                        <Terminal className="w-3 h-3 text-onedark-green" />
                        <span>Test Output</span>
                        {isTestExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      </button>
                    )}

                    {pr.review_summary && (
                      <button
                        onClick={() => toggleReviewView(pr.pr_number)}
                        className={`flex items-center gap-1 px-2 py-0.5 rounded transition-colors cursor-pointer ${
                          isReviewExpanded
                            ? 'bg-onedark-surface text-onedark-fgBright font-medium'
                            : 'text-onedark-muted hover:text-onedark-fg'
                        }`}
                      >
                        <ShieldCheck className="w-3 h-3 text-onedark-purple" />
                        <span>Review Notes</span>
                        {isReviewExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      </button>
                    )}
                  </div>
                </div>

                {/* PR Overview Accordion */}
                {isOverviewExpanded && (
                  <div className="p-3 bg-onedark-darker border-b border-onedark-border/40 text-xs">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-[11px] text-onedark-muted">
                        <span className="font-semibold text-onedark-fgBright">Pull Request Overview</span>
                        {pr.html_url && (
                          <a
                            href={pr.html_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-onedark-accent hover:underline flex items-center gap-1"
                          >
                            <span>Open on GitHub</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>

                      <div className="p-3 rounded bg-onedark-surface/40 border border-onedark-border leading-relaxed text-onedark-fg space-y-2">
                        <div className="font-semibold text-onedark-fgBright text-xs">{pr.title}</div>
                        <div className="text-[11px] text-onedark-muted font-mono space-y-1">
                          <div>Author: <span className="text-onedark-fgBright">@{pr.author || 'unknown'}</span></div>
                          <div>Branches: <span className="text-onedark-purple font-semibold">{pr.head_branch || 'feature'}</span> ➔ <span className="text-onedark-muted">{pr.base_branch || 'main'}</span></div>
                          <div>Changeset: {(adds > 0 || dels > 0) ? <><span className="text-onedark-green font-semibold">+{adds}</span> / <span className="text-onedark-red font-semibold">-{dels}</span></> : 'diff pending'} across {fileCount} file(s)</div>
                          {pr.created_at && <div>Created: <span className="text-onedark-fg">{new Date(pr.created_at).toLocaleString()}</span></div>}
                        </div>

                        {pr.body && (
                          <div className="pt-2 border-t border-onedark-border/40">
                            <div className="text-[11px] font-semibold text-onedark-muted mb-1">Description</div>
                            <div className="p-2.5 rounded bg-black/20 text-[11px] leading-relaxed">
                              <MarkdownRenderer content={pr.body} />
                            </div>
                          </div>
                        )}

                        <div className="pt-2 border-t border-onedark-border/50 flex items-center gap-2">
                          <button
                            onClick={() => toggleDiffView(pr.pr_number)}
                            className="flex items-center gap-1 px-2 py-1 rounded bg-onedark-surface text-[11px] font-medium text-onedark-fg hover:bg-onedark-borderSubtle border border-onedark-border transition-colors cursor-pointer"
                          >
                            <FileCode2 className="w-3 h-3 text-onedark-accent" />
                            <span>{isDiffExpanded ? 'Collapse Diffs' : 'View Code Diffs'}</span>
                          </button>

                          <button
                            onClick={() => handleOpenReviewAgent(pr)}
                            className="flex items-center gap-1 px-2 py-1 rounded bg-onedark-accent/15 text-[11px] font-medium text-onedark-accent hover:bg-onedark-accent/25 border border-onedark-accent/30 transition-colors cursor-pointer"
                          >
                            <Bot className="w-3 h-3" />
                            <span>Launch Review Agent</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Test Output Accordion */}
                {isTestExpanded && pr.test_output && (
                  <div className="p-3 bg-onedark-darker border-b border-onedark-border/40 font-mono text-[11px]">
                    <div className="flex items-center justify-between text-onedark-muted mb-1.5">
                      <span className="font-semibold text-onedark-fgBright">Sandbox Test Execution Log:</span>
                    </div>
                    <pre className="p-2.5 rounded bg-black/40 border border-onedark-border text-onedark-fg whitespace-pre-wrap overflow-x-auto max-h-60 leading-relaxed">
                      {pr.test_output}
                    </pre>
                  </div>
                )}

                {/* Review Notes Accordion */}
                {isReviewExpanded && pr.review_summary && (
                  <div className="p-3 bg-onedark-surface/20 border-b border-onedark-border/40">
                    <div className="p-3 rounded bg-onedark-surface/40 border border-onedark-border">
                      <MarkdownRenderer content={pr.review_summary} />
                    </div>
                  </div>
                )}

                {/* Diffs Accordion View */}
                {isDiffExpanded && (
                  <div className="p-3 bg-onedark-darker space-y-3">
                    {isDiffLoading ? (
                      <div className="flex items-center justify-center py-6 text-onedark-muted gap-2">
                        <Loader2 className="w-4 h-4 animate-spin text-onedark-accent" />
                        <span className="font-mono text-xs">Loading diffs...</span>
                      </div>
                    ) : diffs.length === 0 ? (
                      <div className="py-4 text-center text-onedark-muted text-[11px]">
                        No unified diffs available for this pull request.
                      </div>
                    ) : (
                      diffs.map((d) => (
                        <div 
                          key={d.file_path}
                          className="rounded border border-onedark-border bg-onedark-darker overflow-hidden shadow-xs"
                        >
                          {/* File Header */}
                          <div className="px-3 py-1.5 bg-onedark-surface border-b border-onedark-border flex items-center justify-between text-onedark-fgBright">
                            <div className="flex items-center space-x-2 text-[11px] font-mono truncate flex-1 min-w-0">
                              <FileCode2 className="w-3.5 h-3.5 text-onedark-accent flex-shrink-0" />
                              <span className="truncate">{d.file_path}</span>
                            </div>

                            <div className="flex items-center space-x-2 text-[10px] ml-2 flex-shrink-0 font-mono">
                              <span className="text-onedark-green font-semibold">+{d.additions || 0}</span>
                              <span className="text-onedark-red font-semibold">-{d.deletions || 0}</span>
                            </div>
                          </div>

                          {/* Diff Lines (12.5px font-size requirement) */}
                          <div className="p-2 overflow-x-auto text-[12.5px] leading-relaxed font-mono">
                            {d.diff_content ? (
                              d.diff_content.split('\n').map((line, idx) => {
                                const isAddition = line.startsWith('+') && !line.startsWith('+++');
                                const isDeletion = line.startsWith('-') && !line.startsWith('---');
                                const isHeader = line.startsWith('@@');

                                return (
                                  <div
                                    key={idx}
                                    className={`group flex items-center px-1 py-0.5 rounded-sm hover:bg-onedark-surface/40 transition-colors ${
                                      isAddition
                                        ? 'diff-addition'
                                        : isDeletion
                                        ? 'diff-deletion'
                                        : isHeader
                                        ? 'text-onedark-purple bg-onedark-surface/30 font-semibold'
                                        : 'text-onedark-fg'
                                    }`}
                                  >
                                    {/* Line comment trigger */}
                                    <button
                                      onClick={() => handleOpenReviewAgent(pr, {
                                        filename: d.file_path,
                                        line: idx + 1,
                                        content: line
                                      })}
                                      className="opacity-0 group-hover:opacity-100 p-0.5 mr-1 text-onedark-accent hover:text-onedark-fgBright hover:bg-onedark-surface rounded transition-opacity cursor-pointer flex-shrink-0"
                                      title="Review this line with Agent"
                                    >
                                      <MessageSquarePlus className="w-3 h-3" />
                                    </button>

                                    <pre className="font-mono whitespace-pre flex-1 text-[12.5px]">{line || ' '}</pre>
                                  </div>
                                );
                              })
                            ) : (
                              <div className="text-onedark-muted italic py-1 px-2 text-[11px]">Binary or empty diff</div>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
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
    </div>
  );
};
