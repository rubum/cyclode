import React, { useState, useEffect } from 'react';
import { FileCode, GitPullRequest, Play, Sparkles, CheckCircle2, AlertCircle, RefreshCw, ExternalLink } from 'lucide-react';
import { TaskDiff, TaskPR } from '../../types';

interface DiffViewerTabProps {
  diffs?: TaskDiff[];
  prs?: TaskPR[];
  selectedPRNumber?: number | null;
  onSelectPR?: (prNumber: number | null) => void;
  taskId?: string;
}

export const DiffViewerTab: React.FC<DiffViewerTabProps> = ({
  diffs = [],
  prs = [],
  selectedPRNumber,
  onSelectPR,
  taskId
}) => {
  const [prDiffs, setPrDiffs] = useState<TaskDiff[]>([]);
  const [loadingPrDiffs, setLoadingPrDiffs] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);

  // Fetch PR-specific diffs when a PR is selected
  useEffect(() => {
    if (!taskId || !selectedPRNumber) {
      setPrDiffs([]);
      return;
    }

    const fetchPRDiff = async () => {
      setLoadingPrDiffs(true);
      try {
        const res = await fetch(`/api/tasks/${taskId}/prs/${selectedPRNumber}/diff`);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.diffs)) {
            setPrDiffs(data.diffs.map((d: any, idx: number) => ({
              id: d.id || `${d.file_path}-${idx}`,
              task_id: taskId,
              file_path: d.file_path,
              diff_content: d.diff_content,
              additions: d.additions || 0,
              deletions: d.deletions || 0,
              created_at: new Date().toISOString()
            })));
          }
        }
      } catch (err) {
        console.error('Failed to load PR diff:', err);
      } finally {
        setLoadingPrDiffs(false);
      }
    };

    fetchPRDiff();
  }, [taskId, selectedPRNumber]);

  const activePR = prs.find((p) => p.pr_number === selectedPRNumber);
  const displayedDiffs = selectedPRNumber ? prDiffs : diffs;

  const handleRunPRTest = async () => {
    if (!taskId || !selectedPRNumber) return;
    setIsTesting(true);
    try {
      await fetch(`/api/tasks/${taskId}/prs/${selectedPRNumber}/test`, { method: 'POST' });
    } catch (err) {
      console.error('Failed to run test:', err);
    } finally {
      setIsTesting(false);
    }
  };

  const handleRunPRReview = async () => {
    if (!taskId || !selectedPRNumber) return;
    setIsReviewing(true);
    try {
      await fetch(`/api/tasks/${taskId}/prs/${selectedPRNumber}/review`, { method: 'POST' });
    } catch (err) {
      console.error('Failed to trigger review:', err);
    } finally {
      setIsReviewing(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-onedark-darker overflow-hidden text-onedark-fg font-sans text-xs">
      {/* Top PR Selector Bar (if PRs exist) */}
      {prs.length > 0 && (
        <div className="px-3 py-2 border-b border-onedark-borderSubtle bg-onedark-surface/40 flex flex-col space-y-2 flex-shrink-0">
          <div className="flex items-center justify-between space-x-2">
            <div className="flex items-center space-x-1.5 flex-1 min-w-0">
              <GitPullRequest className="w-3.5 h-3.5 text-onedark-accent flex-shrink-0" />
              <select
                value={selectedPRNumber ? String(selectedPRNumber) : ''}
                onChange={(e) => {
                  const val = e.target.value;
                  onSelectPR?.(val ? parseInt(val, 10) : null);
                }}
                className="bg-onedark-darker border border-onedark-border rounded px-2 py-1 text-xs text-onedark-fgBright outline-none focus:border-onedark-accent font-medium truncate flex-1 cursor-pointer"
              >
                <option value="">Working Tree Diffs (Workspace)</option>
                {prs.map((p) => (
                  <option key={p.pr_number} value={p.pr_number}>
                    PR #{p.pr_number}: {p.title} ({p.head_branch || 'branch'})
                  </option>
                ))}
              </select>
            </div>

            {selectedPRNumber && (
              <div className="flex items-center space-x-1.5 flex-shrink-0">
                <button
                  onClick={handleRunPRTest}
                  disabled={isTesting}
                  className="px-2 py-1 rounded bg-onedark-accent/15 hover:bg-onedark-accent/25 text-onedark-accent border border-onedark-accent/30 text-[11px] font-semibold flex items-center space-x-1 transition-all disabled:opacity-50 cursor-pointer shadow-xs"
                  title="Run unit tests in this PR sandbox"
                >
                  <Play className={`w-3 h-3 ${isTesting ? 'animate-spin' : ''}`} />
                  <span>{isTesting ? 'Testing...' : 'Run Tests'}</span>
                </button>
                <button
                  onClick={handleRunPRReview}
                  disabled={isReviewing}
                  className="px-2 py-1 rounded bg-onedark-purple/15 hover:bg-onedark-purple/25 text-onedark-purple border border-onedark-purple/30 text-[11px] font-semibold flex items-center space-x-1 transition-all disabled:opacity-50 cursor-pointer shadow-xs"
                  title="Generate Agent Code Review"
                >
                  <Sparkles className={`w-3 h-3 ${isReviewing ? 'animate-pulse' : ''}`} />
                  <span>{isReviewing ? 'Reviewing...' : 'AI Review'}</span>
                </button>
              </div>
            )}
          </div>

          {activePR && (
            <div className="flex items-center justify-between text-[11px] font-mono text-onedark-muted pt-0.5">
              <div className="flex items-center space-x-2 truncate">
                <span>@{activePR.author || 'author'}</span>
                <span>•</span>
                <span className="text-onedark-fg truncate">{activePR.head_branch} ➔ {activePR.base_branch || 'main'}</span>
              </div>
              <span
                className={`px-1.5 py-0.2 rounded text-[9.5px] border uppercase ${
                  activePR.status === 'TESTS_PASSING'
                    ? 'bg-onedark-green/10 text-onedark-green border-onedark-green/30'
                    : activePR.status === 'TESTS_FAILED'
                    ? 'bg-onedark-red/10 text-onedark-red border-onedark-red/30'
                    : activePR.status === 'REVIEWING'
                    ? 'bg-onedark-yellow/10 text-onedark-yellow border-onedark-yellow/30'
                    : 'bg-onedark-purple/10 text-onedark-purple border-onedark-purple/30'
                }`}
              >
                {activePR.status.replace('_', ' ')}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Diff Content Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 font-mono text-xs text-onedark-fg">
        {loadingPrDiffs ? (
          <div className="p-8 text-center text-xs text-onedark-muted font-sans flex items-center justify-center space-x-2">
            <RefreshCw className="w-4 h-4 animate-spin text-onedark-accent" />
            <span>Loading pull request diffs...</span>
          </div>
        ) : displayedDiffs.length === 0 ? (
          <div className="p-8 text-center text-xs text-onedark-muted font-sans leading-relaxed">
            {selectedPRNumber ? (
              <>No modified files found in PR #{selectedPRNumber} worktree.</>
            ) : (
              <>No modified files in this workspace yet.<br />Run a task or fetch PRs to inspect diffs.</>
            )}
          </div>
        ) : (
          displayedDiffs.map((d) => (
            <div key={d.id || d.file_path} className="rounded border border-onedark-border bg-onedark-darker overflow-hidden shadow-xs">
              {/* Header */}
              <div className="px-3 py-1.5 bg-onedark-surface border-b border-onedark-border flex items-center justify-between text-onedark-fgBright">
                <div className="flex items-center space-x-2 text-[11px] font-mono truncate flex-1 min-w-0">
                  <FileCode className="w-3.5 h-3.5 text-onedark-accent flex-shrink-0" />
                  <span className="truncate">{d.file_path}</span>
                </div>

                <div className="flex items-center space-x-2 text-[10px] ml-2 flex-shrink-0">
                  <span className="text-onedark-green font-semibold">+{d.additions || 0}</span>
                  <span className="text-onedark-red font-semibold">-{d.deletions || 0}</span>
                </div>
              </div>

              {/* Lines */}
              <div className="p-2 overflow-x-auto text-[11px] leading-relaxed">
                {d.diff_content ? (
                  d.diff_content.split('\n').map((line, idx) => {
                    const isAddition = line.startsWith('+') && !line.startsWith('+++');
                    const isDeletion = line.startsWith('-') && !line.startsWith('---');
                    const isHeader = line.startsWith('@@');

                    return (
                      <div
                        key={idx}
                        className={`px-1 py-0.5 rounded-sm ${
                          isAddition
                            ? 'diff-addition'
                            : isDeletion
                            ? 'diff-deletion'
                            : isHeader
                            ? 'text-onedark-purple bg-onedark-surface/30 font-semibold'
                            : 'text-onedark-fg'
                        }`}
                      >
                        <pre className="font-mono whitespace-pre">{line || ' '}</pre>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-onedark-muted italic py-1 px-2">Binary or empty diff</div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
