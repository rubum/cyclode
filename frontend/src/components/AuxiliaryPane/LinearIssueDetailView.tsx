import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Zap,
  ExternalLink,
  RotateCw,
  Copy,
  Check,
  X,
  User,
  Clock,
  Send,
  Loader2,
  Tag,
  FolderKanban,
  CheckCircle2,
  AlertCircle,
  MessageSquare,
  Sparkles,
  ChevronDown,
  ArrowRight,
  Layers
} from 'lucide-react';
import { LinearIssue, LinearState, LinearComment, Task } from '../../types';
import { MarkdownRenderer } from '../Common/MarkdownRenderer';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface LinearIssueDetailViewProps {
  issueKey: string;
  onClose?: () => void;
  onImplementWithAgent?: (prompt: string) => void;
  task?: Task | null;
}

export const LinearIssueDetailView: React.FC<LinearIssueDetailViewProps> = ({
  issueKey,
  onClose,
  onImplementWithAgent,
  task
}) => {
  const [issue, setIssue] = useState<LinearIssue | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [isStatusDropdownOpen, setIsStatusDropdownOpen] = useState<boolean>(false);
  const [updatingStatus, setUpdatingStatus] = useState<boolean>(false);
  const [newComment, setNewComment] = useState<string>('');
  const [submittingComment, setSubmittingComment] = useState<boolean>(false);

  const cleanKey = issueKey.trim().toUpperCase();

  const fetchIssue = useCallback(async () => {
    if (!cleanKey) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/linear/issues/${cleanKey}`);
      if (!res.ok) {
        throw new Error(`Failed to load Linear issue ${cleanKey} (${res.status})`);
      }
      const data = await res.json();
      setIssue(data);
    } catch (err: any) {
      setError(err.message || 'Error communicating with Linear API');
    } finally {
      setLoading(false);
    }
  }, [cleanKey]);

  useEffect(() => {
    fetchIssue();
  }, [fetchIssue]);

  const handleCopyLink = () => {
    if (!issue?.url && !cleanKey) return;
    const url = issue?.url || `https://linear.app/issue/${cleanKey}`;
    navigator.clipboard.writeText(url);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleUpdateStatus = async (stateId: string) => {
    if (!issue) return;
    setUpdatingStatus(true);
    setIsStatusDropdownOpen(false);
    try {
      const res = await fetch(`${API_BASE}/api/linear/issues/${issue.identifier || cleanKey}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state_id: stateId }),
      });
      if (res.ok) {
        // Optimistically update or re-fetch
        await fetchIssue();
      }
    } catch (err) {
      console.error('Error updating status:', err);
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handlePostComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim() || submittingComment || !issue) return;

    setSubmittingComment(true);
    try {
      const res = await fetch(`${API_BASE}/api/linear/issues/${issue.identifier || cleanKey}/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: newComment.trim() }),
      });
      if (res.ok) {
        setNewComment('');
        await fetchIssue();
      }
    } catch (err) {
      console.error('Error posting comment:', err);
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleImplement = () => {
    if (!issue || !onImplementWithAgent) return;
    const prompt = `Implement Linear issue ${issue.identifier}: "${issue.title}".\n\n### Issue Description:\n${issue.description || 'No description provided.'}\n\nPlease inspect the repository, write the required changes, run tests, and prepare a Pull Request.`;
    onImplementWithAgent(prompt);
  };

  const getPriorityBadge = (priority: number, label?: string) => {
    switch (priority) {
      case 1:
        return { text: label || 'Urgent', color: 'text-rose-400 bg-rose-500/15 border-rose-500/30' };
      case 2:
        return { text: label || 'High', color: 'text-amber-400 bg-amber-500/15 border-amber-500/30' };
      case 3:
        return { text: label || 'Medium', color: 'text-yellow-400 bg-yellow-500/15 border-yellow-500/30' };
      case 4:
        return { text: label || 'Low', color: 'text-blue-400 bg-blue-500/15 border-blue-500/30' };
      default:
        return { text: label || 'No priority', color: 'text-onedark-muted bg-onedark-surface border-onedark-border' };
    }
  };

  const commentsList: LinearComment[] = issue?.comments
    ? (Array.isArray(issue.comments) ? issue.comments : (issue.comments as any).nodes || [])
    : [];

  const labelsList = issue?.labels
    ? (Array.isArray(issue.labels) ? issue.labels : (issue.labels as any).nodes || [])
    : [];

  const availableStates: LinearState[] = issue?.team?.states?.nodes || [
    { id: 'st-todo', name: 'Todo', color: '#e2e2e2' },
    { id: 'st-in-progress', name: 'In Progress', color: '#f2c94c' },
    { id: 'st-done', name: 'Done', color: '#4cb782' },
    { id: 'st-canceled', name: 'Canceled', color: '#eb5757' }
  ];

  return (
    <div className="flex flex-col h-full w-full bg-onedark-bg font-sans text-onedark-fg overflow-hidden select-text">
      {/* Top Header Bar */}
      <div className="bg-onedark-darker border-b border-onedark-borderSubtle px-4 py-2.5 flex items-center justify-between gap-3 flex-shrink-0">
        <div className="flex items-center space-x-2.5 min-w-0">
          <div className="p-1.5 rounded-lg bg-onedark-accent/15 text-onedark-accent border border-onedark-accent/30 flex-shrink-0">
            <Zap className="w-4 h-4" />
          </div>
          <div className="flex items-center space-x-2 min-w-0">
            <span className="font-mono text-xs font-bold text-onedark-accent tracking-wide whitespace-nowrap">
              {issue?.identifier || cleanKey}
            </span>
            <span className="text-onedark-borderSubtle">|</span>
            <span className="text-xs font-medium text-onedark-fgBright truncate">
              {issue?.title || `Linear Ticket ${cleanKey}`}
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-1.5 flex-shrink-0">
          {onImplementWithAgent && (
            <button
              onClick={handleImplement}
              className="flex items-center space-x-1.5 px-3 py-1 rounded-md bg-onedark-accent hover:bg-onedark-accent/90 text-onedark-darker text-xs font-mono font-bold transition-all cursor-pointer shadow-xs active:scale-95"
              title="Dispatch task to active agent"
            >
              <Sparkles className="w-3.5 h-3.5 fill-onedark-darker" />
              <span>⚡ Implement with Agent</span>
            </button>
          )}

          <button
            onClick={fetchIssue}
            disabled={loading}
            className="p-1.5 rounded-lg text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface transition-colors cursor-pointer"
            title="Refresh Linear Ticket"
          >
            <RotateCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-onedark-accent' : ''}`} />
          </button>

          <button
            onClick={handleCopyLink}
            className="p-1.5 rounded-lg text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface transition-colors cursor-pointer"
            title={isCopied ? "Copied Link!" : "Copy Link"}
          >
            {isCopied ? <Check className="w-3.5 h-3.5 text-onedark-green" /> : <Copy className="w-3.5 h-3.5" />}
          </button>

          {issue?.url && (
            <a
              href={issue.url}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 rounded-lg text-onedark-muted hover:text-onedark-accent hover:bg-onedark-surface transition-colors flex-shrink-0"
              title="Open in Linear.app"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}

          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-onedark-muted hover:text-onedark-fgBright hover:bg-onedark-surface transition-colors cursor-pointer"
              title="Close Ticket View"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Main Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {loading && !issue && (
          <div className="space-y-4 animate-pulse pt-4">
            <div className="h-6 bg-onedark-surface/60 rounded w-2/3"></div>
            <div className="h-4 bg-onedark-surface/40 rounded w-1/3"></div>
            <div className="h-32 bg-onedark-surface/30 rounded-lg"></div>
          </div>
        )}

        {error && !issue && (
          <div className="p-4 rounded-xl bg-onedark-red/10 border border-onedark-red/30 text-onedark-red text-xs font-mono space-y-2">
            <div className="flex items-center space-x-2 font-bold">
              <AlertCircle className="w-4 h-4" />
              <span>Failed to load Linear ticket</span>
            </div>
            <p className="text-onedark-fg/80">{error}</p>
            <button
              onClick={fetchIssue}
              className="px-3 py-1 bg-onedark-red/20 hover:bg-onedark-red/30 rounded text-[11px] font-semibold transition-colors cursor-pointer"
            >
              Try Again
            </button>
          </div>
        )}

        {issue && (
          <>
            {/* Title & Metadata Header Card */}
            <div className="p-4 rounded-xl bg-onedark-darker/60 border border-onedark-borderSubtle space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex items-center space-x-2">
                    <span className="px-2 py-0.5 rounded font-mono text-[11px] font-bold bg-onedark-accent/15 text-onedark-accent border border-onedark-accent/30">
                      {issue.identifier}
                    </span>
                    {issue.team && (
                      <span className="text-xs text-onedark-muted font-medium flex items-center space-x-1">
                        <FolderKanban className="w-3.5 h-3.5" />
                        <span>{issue.team.name}</span>
                      </span>
                    )}
                    {issue.project && (
                      <span className="text-xs text-onedark-muted font-medium flex items-center space-x-1">
                        <Layers className="w-3.5 h-3.5" />
                        <span>{issue.project.name}</span>
                      </span>
                    )}
                  </div>
                  <h1 className="text-base font-bold text-onedark-fgBright leading-snug">
                    {issue.title}
                  </h1>
                </div>

                {/* Status Dropdown */}
                <div className="relative">
                  <button
                    onClick={() => setIsStatusDropdownOpen(!isStatusDropdownOpen)}
                    disabled={updatingStatus}
                    className="flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-onedark-surface hover:bg-onedark-surface/80 border border-onedark-border text-xs font-medium text-onedark-fgBright transition-colors cursor-pointer"
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: issue.state?.color || '#8c8c8c' }}
                    />
                    <span>{issue.state?.name || 'Status'}</span>
                    {updatingStatus ? (
                      <Loader2 className="w-3 h-3 animate-spin text-onedark-accent" />
                    ) : (
                      <ChevronDown className="w-3 h-3 text-onedark-muted" />
                    )}
                  </button>

                  {isStatusDropdownOpen && (
                    <div className="absolute right-0 mt-1 w-44 rounded-lg bg-onedark-darker border border-onedark-border shadow-xl py-1 z-30 animate-fadeIn">
                      {availableStates.map((st) => (
                        <button
                          key={st.id}
                          onClick={() => handleUpdateStatus(st.id)}
                          className={`w-full flex items-center space-x-2.5 px-3 py-1.5 text-xs text-left hover:bg-onedark-surface transition-colors cursor-pointer ${
                            issue.state?.id === st.id ? 'text-onedark-accent font-semibold' : 'text-onedark-fg'
                          }`}
                        >
                          <span
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ backgroundColor: st.color || '#8c8c8c' }}
                          />
                          <span className="truncate">{st.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Attributes Chips */}
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-onedark-borderSubtle/40 text-xs">
                {/* Priority */}
                {(() => {
                  const pBadge = getPriorityBadge(issue.priority, issue.priorityLabel);
                  return (
                    <span className={`px-2 py-0.5 rounded-md font-medium text-[11px] border ${pBadge.color}`}>
                      {pBadge.text}
                    </span>
                  );
                })()}

                {/* Assignee */}
                <div className="flex items-center space-x-1.5 px-2 py-0.5 rounded-md bg-onedark-surface/40 text-onedark-fg text-[11px]">
                  {issue.assignee?.avatarUrl ? (
                    <img
                      src={issue.assignee.avatarUrl}
                      alt={issue.assignee.name}
                      className="w-3.5 h-3.5 rounded-full object-cover"
                    />
                  ) : (
                    <User className="w-3.5 h-3.5 text-onedark-muted" />
                  )}
                  <span>{issue.assignee ? issue.assignee.name : 'Unassigned'}</span>
                </div>

                {/* Created / Updated Date */}
                {issue.createdAt && (
                  <div className="flex items-center space-x-1 text-onedark-muted text-[11px]">
                    <Clock className="w-3 h-3" />
                    <span>{new Date(issue.createdAt).toLocaleDateString()}</span>
                  </div>
                )}

                {/* Labels */}
                {labelsList.map((lbl: any) => (
                  <span
                    key={lbl.id || lbl.name}
                    className="flex items-center space-x-1 px-2 py-0.5 rounded-md text-[10.5px] font-medium bg-onedark-surface/60 border border-onedark-borderSubtle"
                    style={{ color: lbl.color || '#abb2bf' }}
                  >
                    <Tag className="w-2.5 h-2.5" />
                    <span>{lbl.name}</span>
                  </span>
                ))}
              </div>
            </div>

            {/* Description Section */}
            <div className="p-4 rounded-xl bg-onedark-darker/40 border border-onedark-borderSubtle space-y-2">
              <h2 className="text-xs font-mono font-bold text-onedark-fgBright uppercase tracking-wider">
                Description
              </h2>
              {issue.description ? (
                <div className="text-xs leading-relaxed">
                  <MarkdownRenderer content={issue.description} />
                </div>
              ) : (
                <div className="text-xs text-onedark-muted italic">
                  No description provided for this issue.
                </div>
              )}
            </div>

            {/* Discussion & Comments */}
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-mono font-bold text-onedark-fgBright uppercase tracking-wider flex items-center space-x-2">
                  <MessageSquare className="w-3.5 h-3.5 text-onedark-accent" />
                  <span>Activity & Comments ({commentsList.length})</span>
                </h2>
              </div>

              {commentsList.length > 0 ? (
                <div className="space-y-3">
                  {commentsList.map((c: LinearComment) => (
                    <div
                      key={c.id}
                      className="p-3.5 rounded-xl bg-onedark-darker/50 border border-onedark-borderSubtle space-y-2 text-xs"
                    >
                      <div className="flex items-center justify-between text-[11px] text-onedark-muted">
                        <div className="flex items-center space-x-2">
                          {c.user?.avatarUrl ? (
                            <img
                              src={c.user.avatarUrl}
                              alt={c.user.name}
                              className="w-4 h-4 rounded-full"
                            />
                          ) : (
                            <div className="w-4 h-4 rounded-full bg-onedark-accent/20 flex items-center justify-center text-[10px] font-bold text-onedark-accent">
                              {c.user?.name ? c.user.name[0].toUpperCase() : 'U'}
                            </div>
                          )}
                          <span className="font-semibold text-onedark-fgBright">
                            {c.user?.displayName || c.user?.name || 'Commenter'}
                          </span>
                        </div>
                        <span>{new Date(c.createdAt).toLocaleString()}</span>
                      </div>
                      <div className="text-xs text-onedark-fg leading-relaxed">
                        <MarkdownRenderer content={c.body} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-4 rounded-xl bg-onedark-darker/20 border border-onedark-borderSubtle/40 text-xs text-onedark-muted text-center italic">
                  No comments yet on this ticket.
                </div>
              )}

              {/* Comment Composer */}
              <form onSubmit={handlePostComment} className="pt-2 space-y-2">
                <textarea
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Write a comment on Linear ticket..."
                  rows={3}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-onedark-darker border border-onedark-border text-xs text-onedark-fg font-sans focus:outline-none focus:border-onedark-accent placeholder-onedark-muted resize-y"
                />
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={submittingComment || !newComment.trim()}
                    className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg bg-onedark-accent hover:bg-onedark-accent/90 text-onedark-darker text-xs font-mono font-bold transition-all disabled:opacity-40 cursor-pointer shadow-xs active:scale-95"
                  >
                    {submittingComment ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Send className="w-3.5 h-3.5" />
                    )}
                    <span>Comment</span>
                  </button>
                </div>
              </form>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
