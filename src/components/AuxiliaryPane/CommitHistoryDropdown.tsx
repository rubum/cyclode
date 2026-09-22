import React, { useState, useRef, useEffect } from 'react';
import { 
  GitBranch, 
  GitCommit, 
  History, 
  Check, 
  ChevronDown, 
  Copy, 
  Clock, 
  Sparkles, 
  RefreshCw,
  Search,
  Layers
} from 'lucide-react';
import { TaskCommit } from '../../types';

interface CommitHistoryDropdownProps {
  branch: string;
  commits: TaskCommit[];
  selectedMode: 'all' | 'working_tree' | 'commit';
  selectedCommit: TaskCommit | null;
  onSelectMode: (mode: 'all' | 'working_tree') => void;
  onSelectCommit: (commit: TaskCommit) => void;
  isLoading?: boolean;
  onRefresh?: () => void;
}

export const CommitHistoryDropdown: React.FC<CommitHistoryDropdownProps> = ({
  branch,
  commits,
  selectedMode,
  selectedCommit,
  onSelectMode,
  onSelectCommit,
  isLoading = false,
  onRefresh,
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [copiedSha, setCopiedSha] = useState<string | null>(null);
  const [copiedBranch, setCopiedBranch] = useState<boolean>(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleCopyBranch = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(branch);
    setCopiedBranch(true);
    setTimeout(() => setCopiedBranch(false), 2000);
  };

  const handleCopySha = (sha: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(sha);
    setCopiedSha(sha);
    setTimeout(() => setCopiedSha(null), 2000);
  };

  const filteredCommits = commits.filter((c) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      c.message.toLowerCase().includes(q) ||
      c.short_sha.toLowerCase().includes(q) ||
      (c.turn_label && c.turn_label.toLowerCase().includes(q))
    );
  });

  const getTriggerLabel = () => {
    if (selectedMode === 'commit' && selectedCommit) {
      return (
        <span className="flex items-center space-x-1.5 min-w-0">
          <GitCommit className="w-3.5 h-3.5 text-onedark-purple flex-shrink-0" />
          <span className="font-mono text-onedark-fgBright font-semibold truncate max-w-[140px]">
            {selectedCommit.turn_label || selectedCommit.short_sha}
          </span>
          <span className="text-[10px] text-onedark-muted font-mono hidden sm:inline truncate max-w-[120px]">
            ({selectedCommit.short_sha})
          </span>
        </span>
      );
    }
    if (selectedMode === 'working_tree') {
      return (
        <span className="flex items-center space-x-1.5 min-w-0">
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
          <span className="text-onedark-fgBright font-semibold truncate">Uncommitted</span>
          <span className="text-[10px] text-onedark-muted font-mono hidden sm:inline">(Working Tree)</span>
        </span>
      );
    }
    return (
      <span className="flex items-center space-x-1.5 min-w-0">
        <Layers className="w-3.5 h-3.5 text-onedark-accent flex-shrink-0" />
        <span className="text-onedark-fgBright font-semibold truncate">All Task Changes</span>
        <span className="text-[10px] text-onedark-muted font-mono hidden sm:inline">(Cumulative)</span>
      </span>
    );
  };

  return (
    <div className="relative flex items-center space-x-2" ref={dropdownRef}>
      {/* Branch Badge (Copyable) */}
      <button
        onClick={handleCopyBranch}
        className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-onedark-surface/90 hover:bg-onedark-surface border border-onedark-borderSubtle text-onedark-fgBright font-mono text-xs truncate transition-all cursor-pointer shadow-xs group"
        title={`Git Branch: ${branch} (Click to copy)`}
      >
        <GitBranch className="w-3.5 h-3.5 text-onedark-purple flex-shrink-0" />
        <span className="font-semibold truncate max-w-[150px] sm:max-w-[210px]">{branch}</span>
        {copiedBranch ? (
          <Check className="w-3 h-3 text-onedark-green flex-shrink-0" />
        ) : (
          <Copy className="w-3 h-3 text-onedark-muted opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
        )}
      </button>

      {/* History Dropdown Trigger */}
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className={`flex items-center space-x-2 px-2.5 py-1 rounded-lg border text-xs transition-all cursor-pointer shadow-xs ${
          isOpen
            ? 'bg-onedark-surface border-onedark-accent text-onedark-fgBright ring-1 ring-onedark-accent/30'
            : 'bg-onedark-surface/80 hover:bg-onedark-surface border-onedark-borderSubtle text-onedark-fg'
        }`}
        title="Select diff comparison scope or inspect turn commits"
      >
        <History className="w-3.5 h-3.5 text-onedark-muted flex-shrink-0" />
        {getTriggerLabel()}
        <ChevronDown
          className={`w-3.5 h-3.5 text-onedark-muted transition-transform duration-150 flex-shrink-0 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Popover Menu */}
      {isOpen && (
        <div className="absolute left-0 top-full mt-1.5 w-[380px] sm:w-[440px] max-w-[95vw] bg-onedark-surface/98 backdrop-blur-md rounded-xl border border-onedark-borderSubtle shadow-2xl z-50 overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-100">
          {/* Popover Header */}
          <div className="p-3 bg-onedark-darker/60 border-b border-onedark-borderSubtle flex items-center justify-between">
            <div className="flex items-center space-x-2 min-w-0">
              <History className="w-4 h-4 text-onedark-accent flex-shrink-0" />
              <div className="min-w-0">
                <h4 className="text-xs font-bold text-onedark-fgBright leading-none truncate">
                  Diff Compare & History
                </h4>
                <p className="text-[10.5px] text-onedark-muted font-mono leading-tight mt-0.5 truncate">
                  Branch: <span className="text-onedark-purple">{branch}</span>
                </p>
              </div>
            </div>

            {onRefresh && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRefresh();
                }}
                disabled={isLoading}
                className="p-1 rounded-md hover:bg-onedark-surface border border-transparent hover:border-onedark-borderSubtle text-onedark-muted hover:text-onedark-fg transition-all cursor-pointer disabled:opacity-50"
                title="Refresh commit history"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-onedark-accent' : ''}`} />
              </button>
            )}
          </div>

          {/* Primary Comparison Modes */}
          <div className="p-2 space-y-1 bg-onedark-darker/30 border-b border-onedark-borderSubtle">
            {/* All Task Changes */}
            <button
              onClick={() => {
                onSelectMode('all');
                setIsOpen(false);
              }}
              className={`w-full flex items-start justify-between p-2 rounded-lg text-left transition-all cursor-pointer ${
                selectedMode === 'all'
                  ? 'bg-onedark-accent/15 border border-onedark-accent/30 text-onedark-fgBright'
                  : 'hover:bg-onedark-surface/60 border border-transparent text-onedark-fg'
              }`}
            >
              <div className="flex items-start space-x-2 min-w-0 flex-1">
                <Layers className={`w-4 h-4 mt-0.5 flex-shrink-0 ${selectedMode === 'all' ? 'text-onedark-accent' : 'text-onedark-muted'}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-bold leading-tight">All Task Changes</span>
                    <span className="px-1.5 py-0.2 rounded text-[9.5px] font-mono bg-onedark-accent/10 text-onedark-accent border border-onedark-accent/20">
                      main...HEAD
                    </span>
                  </div>
                  <p className="text-[11px] text-onedark-muted leading-tight mt-0.5">
                    Cumulative diff of everything changed by this task since branching
                  </p>
                </div>
              </div>
              {selectedMode === 'all' && (
                <Check className="w-4 h-4 text-onedark-accent flex-shrink-0 ml-2" />
              )}
            </button>

            {/* Working Tree Changes */}
            <button
              onClick={() => {
                onSelectMode('working_tree');
                setIsOpen(false);
              }}
              className={`w-full flex items-start justify-between p-2 rounded-lg text-left transition-all cursor-pointer ${
                selectedMode === 'working_tree'
                  ? 'bg-amber-500/15 border border-amber-500/30 text-onedark-fgBright'
                  : 'hover:bg-onedark-surface/60 border border-transparent text-onedark-fg'
              }`}
            >
              <div className="flex items-start space-x-2 min-w-0 flex-1">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400 mt-1 flex-shrink-0 animate-pulse" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-bold leading-tight">Uncommitted Changes</span>
                    <span className="px-1.5 py-0.2 rounded text-[9.5px] font-mono bg-amber-500/10 text-amber-400 border border-amber-500/20">
                      Working Tree
                    </span>
                  </div>
                  <p className="text-[11px] text-onedark-muted leading-tight mt-0.5">
                    Live changes currently being edited before the next commit snapshot
                  </p>
                </div>
              </div>
              {selectedMode === 'working_tree' && (
                <Check className="w-4 h-4 text-amber-400 flex-shrink-0 ml-2" />
              )}
            </button>
          </div>

          {/* Commits List Section */}
          <div className="p-2.5 flex flex-col flex-1 min-h-0 max-h-[300px]">
            <div className="flex items-center justify-between pb-2 text-[10.5px] font-bold uppercase tracking-wider text-onedark-muted">
              <span>Turn & Commit Timeline ({commits.length})</span>
              {commits.length > 3 && (
                <div className="relative w-36">
                  <Search className="w-3 h-3 text-onedark-muted absolute left-1.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search commits..."
                    className="w-full pl-5 pr-1.5 py-0.5 text-[10.5px] rounded bg-onedark-darker border border-onedark-borderSubtle text-onedark-fg placeholder:text-onedark-muted focus:outline-none focus:border-onedark-accent font-mono"
                  />
                </div>
              )}
            </div>

            <div className="overflow-y-auto space-y-1 pr-1 select-none">
              {filteredCommits.length === 0 ? (
                <div className="py-6 text-center text-xs text-onedark-muted font-mono">
                  {searchQuery ? `No commits match "${searchQuery}"` : 'No commits recorded on this branch yet'}
                </div>
              ) : (
                filteredCommits.map((commit) => {
                  const isSelected = selectedMode === 'commit' && selectedCommit?.sha === commit.sha;
                  return (
                    <div
                      key={commit.sha}
                      onClick={() => {
                        onSelectCommit(commit);
                        setIsOpen(false);
                      }}
                      className={`p-2 rounded-lg border transition-all cursor-pointer flex items-start justify-between gap-2 ${
                        isSelected
                          ? 'bg-onedark-purple/15 border-onedark-purple/40 text-onedark-fgBright'
                          : 'hover:bg-onedark-surface/70 border-transparent text-onedark-fg'
                      }`}
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        {/* Top: Turn Label or Message */}
                        <div className="flex items-center space-x-2 flex-wrap">
                          {commit.turn_label ? (
                            <span className="px-1.5 py-0.5 rounded text-[9.5px] font-mono font-bold bg-onedark-purple/20 text-onedark-purple border border-onedark-purple/30 flex items-center space-x-1">
                              <Sparkles className="w-2.5 h-2.5" />
                              <span>{commit.turn_label}</span>
                            </span>
                          ) : (
                            <GitCommit className="w-3 h-3 text-onedark-muted flex-shrink-0" />
                          )}

                          <span className="text-xs font-semibold text-onedark-fgBright truncate max-w-[220px]" title={commit.message}>
                            {commit.message}
                          </span>
                        </div>

                        {/* Bottom: Metadata, SHA, Timestamp, Stats */}
                        <div className="flex items-center space-x-2 text-[10.5px] font-mono text-onedark-muted flex-wrap">
                          {/* Short SHA */}
                          <button
                            onClick={(e) => handleCopySha(commit.sha, e)}
                            className="px-1 py-0.2 rounded bg-onedark-darker hover:bg-onedark-surface border border-onedark-borderSubtle text-onedark-fgBright font-mono text-[9.5px] flex items-center space-x-1 transition-colors group"
                            title={`SHA: ${commit.sha} (Click to copy)`}
                          >
                            <span>{commit.short_sha}</span>
                            {copiedSha === commit.sha ? (
                              <Check className="w-2.5 h-2.5 text-onedark-green" />
                            ) : (
                              <Copy className="w-2.5 h-2.5 text-onedark-muted opacity-0 group-hover:opacity-100" />
                            )}
                          </button>

                          <span>•</span>

                          {/* Timestamp */}
                          <span className="flex items-center space-x-1 text-onedark-muted" title={commit.committed_at}>
                            <Clock className="w-2.5 h-2.5 text-onedark-muted" />
                            <span>{commit.relative_time || commit.committed_at.slice(0, 10)}</span>
                          </span>

                          {/* Line deltas */}
                          {((commit.additions || 0) > 0 || (commit.deletions || 0) > 0) && (
                            <>
                              <span>•</span>
                              <span className="text-onedark-green font-semibold">+{commit.additions || 0}</span>
                              <span className="text-onedark-red font-semibold">-{commit.deletions || 0}</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Selection Checkmark */}
                      {isSelected && (
                        <Check className="w-4 h-4 text-onedark-purple flex-shrink-0 mt-1" />
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
