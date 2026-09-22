import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  GitBranch, 
  GitCompare, 
  RefreshCw, 
  Search, 
  FileCode2, 
  ChevronDown, 
  Copy, 
  Check, 
  Compass, 
  Folder
} from 'lucide-react';
import { Task, TaskDiff } from '../../types';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface ParsedDiffLine {
  oldLine: number | null;
  newLine: number | null;
  type: 'header' | 'addition' | 'deletion' | 'context';
  text: string;
}

function parseUnifiedPatch(patch: string): ParsedDiffLine[] {
  if (!patch) return [];
  const lines = patch.split('\n');
  const result: ParsedDiffLine[] = [];
  let oldLineNum = 1;
  let newLineNum = 1;

  for (const rawLine of lines) {
    if (rawLine.startsWith('@@')) {
      const match = rawLine.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLineNum = parseInt(match[1], 10);
        newLineNum = parseInt(match[2], 10);
      }
      result.push({
        oldLine: null,
        newLine: null,
        type: 'header',
        text: rawLine
      });
    } else if (rawLine.startsWith('+') && !rawLine.startsWith('+++')) {
      result.push({
        oldLine: null,
        newLine: newLineNum,
        type: 'addition',
        text: rawLine
      });
      newLineNum++;
    } else if (rawLine.startsWith('-') && !rawLine.startsWith('---')) {
      result.push({
        oldLine: oldLineNum,
        newLine: null,
        type: 'deletion',
        text: rawLine
      });
      oldLineNum++;
    } else {
      result.push({
        oldLine: oldLineNum,
        newLine: newLineNum,
        type: 'context',
        text: rawLine
      });
      oldLineNum++;
      newLineNum++;
    }
  }
  return result;
}

interface ChangesDiffTabProps {
  task: Task | null;
  onSelectAuxTab?: (tab: any) => void;
}

export const ChangesDiffTab: React.FC<ChangesDiffTabProps> = ({ task, onSelectAuxTab }) => {
  const [diffs, setDiffs] = useState<TaskDiff[]>(() => task?.diffs || []);
  const [branch, setBranch] = useState<string>(() => task?.git_branch || 'main');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [fileFilter, setFileFilter] = useState<string>('');
  const [collapsedFiles, setCollapsedFiles] = useState<Record<string, boolean>>({});
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [copiedPatch, setCopiedPatch] = useState<string | null>(null);
  const [copiedBranch, setCopiedBranch] = useState<boolean>(false);

  // Sync with task updates from props/WebSocket
  useEffect(() => {
    if (task?.diffs) {
      setDiffs(task.diffs);
    }
    if (task?.git_branch) {
      setBranch(task.git_branch);
    }
  }, [task?.diffs, task?.git_branch]);

  // Fetch live diff from endpoint
  const fetchLiveDiff = useCallback(async () => {
    if (!task?.id) return;
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/tasks/${task.id}/diff`);
      if (res.ok) {
        const data = await res.json();
        if (data.diffs) {
          setDiffs(data.diffs);
        }
        if (data.branch) {
          setBranch(data.branch);
        }
      }
    } catch {
      // ignore network errors
    } finally {
      setIsLoading(false);
    }
  }, [task?.id]);

  useEffect(() => {
    fetchLiveDiff();
  }, [fetchLiveDiff]);

  const handleCopyBranch = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(branch);
    setCopiedBranch(true);
    setTimeout(() => setCopiedBranch(false), 2000);
  };

  const handleCopyPath = (filePath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(filePath);
    setCopiedPath(filePath);
    setTimeout(() => setCopiedPath(null), 1500);
  };

  const handleCopyPatch = (patch: string, filePath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(patch);
    setCopiedPatch(filePath);
    setTimeout(() => setCopiedPatch(null), 1500);
  };

  const toggleFile = (filePath: string) => {
    setCollapsedFiles((prev) => ({ ...prev, [filePath]: !prev[filePath] }));
  };

  const filteredDiffs = useMemo(() => {
    if (!fileFilter.trim()) return diffs;
    const q = fileFilter.toLowerCase();
    return diffs.filter((d) => d.file_path.toLowerCase().includes(q));
  }, [diffs, fileFilter]);

  const totalAdditions = useMemo(() => {
    return diffs.reduce((acc, d) => acc + (d.additions || 0), 0);
  }, [diffs]);

  const totalDeletions = useMemo(() => {
    return diffs.reduce((acc, d) => acc + (d.deletions || 0), 0);
  }, [diffs]);

  const getStatusBadge = (status?: string) => {
    const s = (status || 'M').toUpperCase();
    if (s === 'A' || s === 'ADDED') {
      return (
        <span className="px-1.5 py-0.5 rounded text-[9.5px] uppercase font-mono font-bold bg-onedark-green/15 text-onedark-green border border-onedark-green/25">
          + Added
        </span>
      );
    }
    if (s === 'D' || s === 'DELETED') {
      return (
        <span className="px-1.5 py-0.5 rounded text-[9.5px] uppercase font-mono font-bold bg-onedark-red/15 text-onedark-red border border-onedark-red/25">
          - Deleted
        </span>
      );
    }
    return (
      <span className="px-1.5 py-0.5 rounded text-[9.5px] uppercase font-mono font-bold bg-amber-500/15 text-amber-400 border border-amber-500/25">
        ~ Modified
      </span>
    );
  };

  if (!task) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-onedark-muted font-mono select-none">
        No active task selected
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-onedark-darker text-onedark-fg select-none overflow-hidden">
      {/* Top Header & Branch Telemetry Bar */}
      <div className="p-3 bg-onedark-surface/40 border-b border-onedark-borderSubtle flex flex-col gap-2.5 flex-shrink-0">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          {/* Branch Pill */}
          <div className="flex items-center space-x-2 min-w-0">
            <button
              onClick={handleCopyBranch}
              className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-onedark-surface/90 hover:bg-onedark-surface border border-onedark-borderSubtle text-onedark-fgBright font-mono text-xs truncate transition-all cursor-pointer shadow-xs group"
              title={`Git Branch: ${branch} (Click to copy)`}
            >
              <GitBranch className="w-3.5 h-3.5 text-onedark-purple flex-shrink-0" />
              <span className="font-semibold truncate max-w-[200px] sm:max-w-[280px]">{branch}</span>
              {copiedBranch ? (
                <Check className="w-3 h-3 text-onedark-green flex-shrink-0" />
              ) : (
                <Copy className="w-3 h-3 text-onedark-muted opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
              )}
            </button>

            {/* Live Indicator */}
            <span className="hidden sm:inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-onedark-green/10 text-onedark-green text-[10px] font-mono border border-onedark-green/20">
              <span className="w-1.5 h-1.5 rounded-full bg-onedark-green animate-pulse" />
              <span>live tracking</span>
            </span>
          </div>

          {/* Stats & Actions */}
          <div className="flex items-center space-x-2 flex-shrink-0">
            {diffs.length > 0 && (
              <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-onedark-bg border border-onedark-borderSubtle text-xs font-mono">
                <span className="text-onedark-fg font-semibold">{diffs.length} file{diffs.length > 1 ? 's' : ''}</span>
                <span className="text-onedark-border">|</span>
                <span className="text-onedark-green font-bold">+{totalAdditions}</span>
                <span className="text-onedark-red font-bold">-{totalDeletions}</span>
              </div>
            )}

            <button
              onClick={fetchLiveDiff}
              disabled={isLoading}
              className="p-1.5 rounded-lg bg-onedark-surface/80 hover:bg-onedark-surface border border-onedark-borderSubtle text-onedark-muted hover:text-onedark-fgBright transition-all cursor-pointer disabled:opacity-50"
              title="Refresh git diff"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-onedark-accent' : ''}`} />
            </button>
          </div>
        </div>

        {/* Search & Collapse Controls */}
        {diffs.length > 0 && (
          <div className="flex items-center justify-between gap-2 pt-0.5">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-3.5 h-3.5 text-onedark-muted absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={fileFilter}
                onChange={(e) => setFileFilter(e.target.value)}
                placeholder="Filter modified files..."
                className="w-full pl-8 pr-2.5 py-1 text-xs rounded-lg bg-onedark-bg border border-onedark-border text-onedark-fg placeholder:text-onedark-muted focus:outline-none focus:border-onedark-accent font-mono transition-colors"
              />
            </div>

            <button
              onClick={() => {
                const allCollapsed = filteredDiffs.every((d) => collapsedFiles[d.file_path]);
                const nextState: Record<string, boolean> = {};
                filteredDiffs.forEach((d) => {
                  nextState[d.file_path] = !allCollapsed;
                });
                setCollapsedFiles(nextState);
              }}
              className="text-xs text-onedark-accent hover:underline font-medium cursor-pointer flex-shrink-0"
            >
              {filteredDiffs.every((d) => collapsedFiles[d.file_path]) ? 'Expand All' : 'Collapse All'}
            </button>
          </div>
        )}
      </div>

      {/* Main Diff Content Stream */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 select-text">
        {diffs.length === 0 ? (
          /* Empty State */
          <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-4 max-w-md mx-auto select-none">
            <div className="w-12 h-12 rounded-2xl bg-onedark-surface/60 border border-onedark-borderSubtle flex items-center justify-center text-onedark-accent shadow-sm">
              <GitCompare className="w-6 h-6" />
            </div>

            <div className="space-y-1.5">
              <h3 className="text-sm font-bold text-onedark-fgBright">
                No Working Tree Diffs Yet
              </h3>
              <p className="text-xs text-onedark-muted leading-relaxed">
                The agent is currently on branch <code className="text-onedark-purple font-mono font-semibold">{branch}</code>. As changes are made or files are edited according to the plan, unified diffs will appear here in real time.
              </p>
            </div>

            <div className="flex items-center space-x-2 pt-2">
              {onSelectAuxTab && (
                <>
                  <button
                    onClick={() => onSelectAuxTab('docs')}
                    className="px-3 py-1.5 rounded-lg bg-onedark-surface hover:bg-onedark-surface/80 border border-onedark-borderSubtle text-xs font-medium text-onedark-fg flex items-center space-x-1.5 transition-all cursor-pointer"
                  >
                    <Compass className="w-3.5 h-3.5 text-onedark-accent" />
                    <span>View Plan Doc</span>
                  </button>
                  <button
                    onClick={() => onSelectAuxTab('files')}
                    className="px-3 py-1.5 rounded-lg bg-onedark-surface hover:bg-onedark-surface/80 border border-onedark-borderSubtle text-xs font-medium text-onedark-fg flex items-center space-x-1.5 transition-all cursor-pointer"
                  >
                    <Folder className="w-3.5 h-3.5 text-onedark-folder" />
                    <span>Explore Files</span>
                  </button>
                </>
              )}
            </div>
          </div>
        ) : filteredDiffs.length === 0 ? (
          <div className="p-8 text-center text-xs text-onedark-muted font-mono select-none">
            No changed files match "{fileFilter}"
          </div>
        ) : (
          filteredDiffs.map((d, idx) => {
            const isCollapsed = collapsedFiles[d.file_path] ?? false;
            const parsedLines = d.diff_content ? parseUnifiedPatch(d.diff_content) : [];
            const pathParts = d.file_path.split('/');
            const fileNameOnly = pathParts.pop();
            const dirPath = pathParts.join('/');

            return (
              <div
                key={`${d.file_path}-${idx}`}
                className="rounded-xl border border-onedark-borderSubtle overflow-hidden bg-onedark-surface/20 transition-all shadow-xs"
              >
                {/* File Header */}
                <div
                  onClick={() => toggleFile(d.file_path)}
                  className="px-3 py-2 bg-onedark-surface/60 hover:bg-onedark-surface/80 border-b border-onedark-borderSubtle flex items-center justify-between cursor-pointer select-none gap-2"
                >
                  <div className="flex items-center space-x-2 min-w-0 flex-1">
                    <ChevronDown
                      className={`w-3.5 h-3.5 text-onedark-muted transition-transform duration-150 flex-shrink-0 ${
                        isCollapsed ? '-rotate-90' : ''
                      }`}
                    />
                    <FileCode2 className="w-3.5 h-3.5 text-onedark-accent flex-shrink-0" />
                    <span className="font-mono text-xs truncate" title={d.file_path}>
                      {dirPath && <span className="text-onedark-muted/70">{dirPath}/</span>}
                      <span className="text-onedark-fgBright font-semibold">{fileNameOnly}</span>
                    </span>
                    {getStatusBadge(d.status)}
                  </div>

                  <div className="flex items-center space-x-2 flex-shrink-0">
                    <button
                      onClick={(e) => handleCopyPath(d.file_path, e)}
                      className="p-1 rounded-md hover:bg-onedark-bg text-onedark-muted hover:text-onedark-fgBright transition-colors cursor-pointer"
                      title="Copy file path"
                    >
                      {copiedPath === d.file_path ? (
                        <Check className="w-3 h-3 text-onedark-green" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>

                    <button
                      onClick={(e) => handleCopyPatch(d.diff_content, d.file_path, e)}
                      className="px-1.5 py-0.5 rounded-md hover:bg-onedark-bg text-onedark-muted hover:text-onedark-fgBright text-[10px] font-mono transition-colors cursor-pointer border border-onedark-borderSubtle"
                      title="Copy raw git patch"
                    >
                      {copiedPatch === d.file_path ? 'Copied!' : 'Patch'}
                    </button>

                    <div className="flex items-center space-x-1 font-mono text-[11px]">
                      <span className="text-onedark-green font-bold">+{d.additions || 0}</span>
                      <span className="text-onedark-red font-bold">-{d.deletions || 0}</span>
                    </div>
                  </div>
                </div>

                {/* Diff Line Renderer */}
                {!isCollapsed && (
                  <div className="p-2.5 overflow-x-auto text-[12px] leading-relaxed font-mono bg-onedark-bg/80 select-text">
                    {parsedLines.length > 0 ? (
                      parsedLines.map((lineObj, lineIdx) => {
                        const isAddition = lineObj.type === 'addition';
                        const isDeletion = lineObj.type === 'deletion';
                        const isHeader = lineObj.type === 'header';

                        return (
                          <div
                            key={lineIdx}
                            className={`flex items-center px-1.5 py-0.5 rounded-xs transition-colors ${
                              isAddition
                                ? 'bg-onedark-green/15 text-onedark-green font-medium'
                                : isDeletion
                                ? 'bg-onedark-red/15 text-onedark-red font-medium'
                                : isHeader
                                ? 'text-onedark-purple bg-onedark-surface/40 font-semibold my-0.5'
                                : 'text-onedark-fg hover:bg-onedark-surface/20'
                            }`}
                          >
                            {/* Line Numbers */}
                            {!isHeader ? (
                              <div className="flex items-center space-x-2 text-[10px] font-mono text-onedark-muted/60 select-none w-14 flex-shrink-0 text-right pr-2">
                                <span className="w-6">{lineObj.oldLine ?? ''}</span>
                                <span className="w-6 text-onedark-fg/70">{lineObj.newLine ?? ''}</span>
                              </div>
                            ) : (
                              <div className="w-14 flex-shrink-0 text-[10px] font-mono text-onedark-purple select-none pr-2">
                                ...
                              </div>
                            )}

                            {/* Gutter prefix indicator */}
                            <span className="w-4 select-none font-bold text-center flex-shrink-0">
                              {isAddition ? '+' : isDeletion ? '-' : ' '}
                            </span>

                            {/* Content */}
                            <span className="whitespace-pre flex-1 min-w-0">
                              {lineObj.text.replace(/^[+-]/, '')}
                            </span>
                          </div>
                        );
                      })
                    ) : (
                      <div className="p-3 text-xs text-onedark-muted italic">
                        Binary file or no detailed hunk content available.
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
