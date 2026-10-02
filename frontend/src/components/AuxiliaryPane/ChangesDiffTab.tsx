import React, { useState, useEffect, useMemo, useCallback, useRef, useContext } from 'react';
import { 
  GitCompare, 
  RefreshCw, 
  Search, 
  FileCode2, 
  ChevronDown, 
  Copy, 
  Check, 
  Compass, 
  Folder,
  AlignJustify,
  Columns,
  Sparkles,
  X,
  Terminal,
  Bot,
  LayoutGrid,
  ChevronsUpDown,
  CornerDownRight
} from 'lucide-react';
import { Task, TaskDiff, TaskCommit } from '../../types';
import { CommitHistoryDropdown } from './CommitHistoryDropdown';
import { createGrepMatcher } from '../../utils/grepMatcher';
import { 
  parseUnifiedPatchWithGaps, 
  parseSideBySidePatchWithGaps, 
  DiffHunkGap, 
  UnifiedDiffItem, 
  SideBySideDiffItem,
  SideBySideRow,
  ParsedDiffLine
} from '../../utils/diffContextParser';
import { DiffHunkExpander } from './DiffHunkExpander';
import { InlineAgentRationale } from './InlineAgentRationale';
import { HunkFeedbackInput } from './HunkFeedbackInput';
import { DiffCodeLine } from '../Diff/DiffCodeLine';
import { useWebSocket } from '../../contexts/WebSocketContext';

const API_BASE = import.meta.env.VITE_API_URL || '';

function parseUnifiedPatch(patch: string): ParsedDiffLine[] {
  if (!patch) return [];
  const lines = patch.split('\n');
  const result: ParsedDiffLine[] = [];
  let oldLineNum = 1;
  let newLineNum = 1;
  let inHunk = false;

  for (const rawLine of lines) {
    if (rawLine.startsWith('@@')) {
      inHunk = true;
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
      continue;
    }

    if (!inHunk) {
      // Skip pre-hunk git header metadata (diff --git, index, ---, +++, mode, etc.)
      continue;
    }

    if (rawLine.startsWith('\\')) {
      // Skip git \ No newline at end of file markers
      continue;
    }

    if (rawLine.startsWith('+') && !rawLine.startsWith('+++')) {
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

function parseSideBySidePatch(patch: string): SideBySideRow[] {

  if (!patch) return [];
  const lines = patch.split('\n');
  const rows: SideBySideRow[] = [];
  let oldLineNum = 1;
  let newLineNum = 1;
  let inHunk = false;

  let pendingDeletions: { lineNum: number; text: string }[] = [];
  let pendingAdditions: { lineNum: number; text: string }[] = [];

  const flushPending = () => {
    const maxLen = Math.max(pendingDeletions.length, pendingAdditions.length);
    for (let i = 0; i < maxLen; i++) {
      const del = pendingDeletions[i];
      const add = pendingAdditions[i];
      rows.push({
        leftLineNum: del ? del.lineNum : null,
        leftText: del ? del.text : '',
        leftType: del ? 'deletion' : 'empty',
        rightLineNum: add ? add.lineNum : null,
        rightText: add ? add.text : '',
        rightType: add ? 'addition' : 'empty',
      });
    }
    pendingDeletions = [];
    pendingAdditions = [];
  };

  for (const rawLine of lines) {
    if (rawLine.startsWith('@@')) {
      inHunk = true;
      flushPending();
      const match = rawLine.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLineNum = parseInt(match[1], 10);
        newLineNum = parseInt(match[2], 10);
      }
      rows.push({
        leftLineNum: null,
        leftText: rawLine,
        leftType: 'header',
        rightLineNum: null,
        rightText: rawLine,
        rightType: 'header',
      });
      continue;
    }

    if (!inHunk) {
      // Skip pre-hunk git header metadata
      continue;
    }

    if (rawLine.startsWith('\\')) {
      // Skip git \ No newline at end of file markers
      continue;
    }

    if (rawLine.startsWith('+') && !rawLine.startsWith('+++')) {
      pendingAdditions.push({ lineNum: newLineNum, text: rawLine });
      newLineNum++;
    } else if (rawLine.startsWith('-') && !rawLine.startsWith('---')) {
      pendingDeletions.push({ lineNum: oldLineNum, text: rawLine });
      oldLineNum++;
    } else {
      flushPending();
      rows.push({
        leftLineNum: oldLineNum,
        leftText: rawLine,
        leftType: 'context',
        rightLineNum: newLineNum,
        rightText: rawLine,
        rightType: 'context',
      });
      oldLineNum++;
      newLineNum++;
    }
  }
  flushPending();
  return rows;
}

interface ChangesDiffTabProps {
  task: Task | null;
  onSelectAuxTab?: (tab: any) => void;
  targetCommitSha?: string | null;
  onClearTargetCommitSha?: () => void;
}

export const ChangesDiffTab: React.FC<ChangesDiffTabProps> = ({ 
  task, 
  onSelectAuxTab,
  targetCommitSha,
  onClearTargetCommitSha
}) => {
  const [diffs, setDiffs] = useState<TaskDiff[]>(() => task?.diffs || []);
  const [branch, setBranch] = useState<string>(() => task?.git_branch || 'main');
  const [commits, setCommits] = useState<TaskCommit[]>([]);
  const [selectedMode, setSelectedMode] = useState<'all' | 'working_tree' | 'commit'>(() => targetCommitSha ? 'commit' : 'all');
  const [selectedCommit, setSelectedCommit] = useState<TaskCommit | null>(() => targetCommitSha ? {
    sha: targetCommitSha,
    short_sha: targetCommitSha.slice(0, 7),
    author: 'Commit',
    email: '',
    committed_at: new Date().toISOString(),
    relative_time: '',
    message: `Commit ${targetCommitSha.slice(0, 7)}`
  } : null);
  const [diffLayout, setDiffLayout] = useState<'unified' | 'split'>('unified');
  const [layoutPreference, setLayoutPreferenceState] = useState<'auto' | 'unified' | 'split'>(() => {
    try {
      const saved = localStorage.getItem('cyclode_diff_layout_preference');
      if (saved && ['auto', 'unified', 'split'].includes(saved)) {
        return saved as 'auto' | 'unified' | 'split';
      }
    } catch {}
    return 'unified';
  });

  const setLayoutPreference = useCallback((pref: 'auto' | 'unified' | 'split') => {
    setLayoutPreferenceState(pref);
    try {
      localStorage.setItem('cyclode_diff_layout_preference', pref);
    } catch {}
  }, []);

  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(1000);

  // ResizeObserver for responsive layout inspection
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          setContainerWidth(entry.contentRect.width);
        }
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const effectiveLayout = useMemo<'unified' | 'split'>(() => {
    if (layoutPreference === 'split') return 'split';
    if (layoutPreference === 'unified') return 'unified';
    return 'unified';
  }, [layoutPreference]);

  // Context expansion state
  const [expandedLinesByFile, setExpandedLinesByFile] = useState<Record<string, Record<number, string>>>({});
  const [fileTotalLines, setFileTotalLines] = useState<Record<string, number>>({});
  const [loadingGaps, setLoadingGaps] = useState<Record<string, boolean>>({});
  const [focusedHunkId, setFocusedHunkId] = useState<string | null>(null);
  const [showAgentRationale, setShowAgentRationale] = useState<boolean>(true);
  const [commentingGap, setCommentingGap] = useState<DiffHunkGap | null>(null);
  const [agentRationales, setAgentRationales] = useState<Record<string, { intent: string; tool?: string }>>({});

  // Optional websocket message dispatch for hunk feedback
  let wsContext: any = null;
  try {
    wsContext = useWebSocket();
  } catch {
    // outside provider fallback
  }

  // Fetch diff context slice
  const fetchDiffContext = useCallback(async (gap: DiffHunkGap, startLine: number, endLine: number) => {
    if (!task?.id || task.id.startsWith('temp-')) return;
    const loadingKey = `${gap.filePath}:${startLine}-${endLine}`;
    setLoadingGaps(prev => ({ ...prev, [gap.id]: true, [loadingKey]: true }));

    try {
      let url = `${API_BASE}/api/tasks/${task.id}/diff/context?path=${encodeURIComponent(gap.filePath)}&start_line=${startLine}&end_line=${endLine}&mode=${selectedMode}`;
      if (selectedMode === 'commit' && selectedCommit) {
        url += `&commit_sha=${selectedCommit.sha}`;
      }
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.lines && Array.isArray(data.lines)) {
          setExpandedLinesByFile(prev => {
            const currentFileMap = { ...(prev[gap.filePath] || {}) };
            data.lines.forEach((lineText: string, idx: number) => {
              currentFileMap[data.start_line + idx] = lineText;
            });
            return {
              ...prev,
              [gap.filePath]: currentFileMap
            };
          });

          if (data.total_lines) {
            setFileTotalLines(prev => ({
              ...prev,
              [gap.filePath]: data.total_lines
            }));
          }
        }
      }
    } catch (err) {
      console.error('Failed to fetch diff context', err);
    } finally {
      setLoadingGaps(prev => ({ ...prev, [gap.id]: false, [loadingKey]: false }));
    }
  }, [task?.id, selectedMode, selectedCommit]);

  const handleExpandUp = useCallback((gap: DiffHunkGap) => {
    const start = Math.max(gap.gapStartNew, gap.gapEndNew - 19);
    fetchDiffContext(gap, start, gap.gapEndNew);
  }, [fetchDiffContext]);

  const handleExpandDown = useCallback((gap: DiffHunkGap) => {
    const end = Math.min(gap.gapEndNew, gap.gapStartNew + 19);
    fetchDiffContext(gap, gap.gapStartNew, end);
  }, [fetchDiffContext]);

  const handleExpandAll = useCallback((gap: DiffHunkGap) => {
    fetchDiffContext(gap, gap.gapStartNew, gap.gapEndNew);
  }, [fetchDiffContext]);

  // Direct feedback to agent
  const handleSendHunkFeedback = useCallback((feedback: string, gap: DiffHunkGap) => {
    if (!task?.id) return;
    const prompt = `Regarding file \`${gap.filePath}\` (lines ${gap.gapStartNew}-${gap.gapEndNew}${gap.symbolContext ? ` - ${gap.symbolContext}` : ''}):\n${feedback}`;
    if (wsContext?.sendMessage) {
      wsContext.sendMessage({
        type: "USER_INPUT",
        task_id: task.id,
        content: prompt
      });
    }
    setCommentingGap(null);
  }, [task?.id, wsContext]);

  // Load agent trajectory to extract intent annotations
  useEffect(() => {
    if (!task?.id || task.id.startsWith('temp-')) return;
    const loadTrajectory = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/tasks/${task.id}/trajectory`);
        if (res.ok) {
          const data = await res.json();
          const map: Record<string, { intent: string; tool?: string }> = {};
          if (data.turns && Array.isArray(data.turns)) {
            for (const turn of data.turns) {
              if (turn.tool_calls && Array.isArray(turn.tool_calls)) {
                for (const tc of turn.tool_calls) {
                  const targetFile = tc.arguments?.TargetFile || tc.arguments?.target_file || tc.arguments?.path || tc.arguments?.file_path;
                  const desc = tc.arguments?.Description || tc.arguments?.instruction || tc.description;
                  if (targetFile && desc) {
                    const normPath = targetFile.replace(/\\/g, '/').split('/sandbox-')[1] || targetFile;
                    const clean = normPath.replace(/^[a-zA-Z0-9_-]+\//, '').replace(/^\//, '');
                    map[targetFile] = { intent: desc, tool: tc.tool_name };
                    map[clean] = { intent: desc, tool: tc.tool_name };
                    const basename = targetFile.split('/').pop();
                    if (basename) {
                      map[basename] = { intent: desc, tool: tc.tool_name };
                    }
                  }
                }
              }
            }
          }
          setAgentRationales(map);
        }
      } catch {
        // ignore
      }
    };
    loadTrajectory();
  }, [task?.id]);

  // Keyboard navigation & Hunk review hotkeys
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      if (e.key === '0') {
        e.preventDefault();
        setLayoutPreference('auto');
      } else if (e.key === '1') {
        e.preventDefault();
        setLayoutPreference('unified');
      } else if (e.key === '2') {
        e.preventDefault();
        setLayoutPreference('split');
      } else if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        setShowAgentRationale(prev => !prev);
      } else if (e.key === '[' || e.key === ']') {
        e.preventDefault();
        const allGaps = document.querySelectorAll<HTMLElement>('[data-hunk-id]');
        if (allGaps.length === 0) return;
        const ids = Array.from(allGaps).map(el => el.getAttribute('data-hunk-id')!);
        let nextIdx = 0;
        if (focusedHunkId) {
          const curIdx = ids.indexOf(focusedHunkId);
          if (curIdx !== -1) {
            nextIdx = e.key === ']' ? (curIdx + 1) % ids.length : (curIdx - 1 + ids.length) % ids.length;
          }
        }
        const nextId = ids[nextIdx];
        setFocusedHunkId(nextId);
        const el = document.querySelector<HTMLElement>(`[data-hunk-id="${nextId}"]`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        el?.focus();
      } else if (e.key === 'z' || e.key === 'Z') {
        if (focusedHunkId) {
          e.preventDefault();
          const el = document.querySelector<HTMLElement>(`[data-hunk-id="${focusedHunkId}"]`);
          if (el) {
            const btn = el.querySelector<HTMLButtonElement>('button');
            btn?.click();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusedHunkId]);


  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [fileFilter, setFileFilter] = useState<string>('');
  const [isRegex, setIsRegex] = useState<boolean>(false);
  const [collapsedFiles, setCollapsedFiles] = useState<Record<string, boolean>>({});
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [copiedPatch, setCopiedPatch] = useState<string | null>(null);

  // Sync branch from task prop
  useEffect(() => {
    if (task?.git_branch) {
      setBranch(task.git_branch);
    }
  }, [task?.git_branch]);

  // Fetch commits on task load
  const fetchCommits = useCallback(async () => {
    if (!task?.id || task.id.startsWith('temp-')) return;
    try {
      const res = await fetch(`${API_BASE}/api/tasks/${task.id}/commits`);
      if (res.ok) {
        const data = await res.json();
        if (data.commits) {
          setCommits(data.commits);
        }
        if (data.branch) {
          setBranch(task?.git_branch || data.branch);
        }
      }
    } catch {
      // ignore
    }
  }, [task?.id, task?.git_branch]);

  // Fetch live diff according to selected mode
  const fetchLiveDiff = useCallback(async () => {
    if (!task?.id || task.id.startsWith('temp-')) return;
    setIsLoading(true);
    try {
      let url = `${API_BASE}/api/tasks/${task.id}/diff?mode=${selectedMode}`;
      if (selectedMode === 'commit' && selectedCommit) {
        url += `&commit_sha=${selectedCommit.sha}`;
      }
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.diffs) {
          setDiffs(data.diffs);
        }
        if (data.branch) {
          setBranch(task?.git_branch || data.branch);
        }
      }
    } catch {
      // ignore network errors
    } finally {
      setIsLoading(false);
    }
  }, [task?.id, task?.git_branch, selectedMode, selectedCommit]);

  useEffect(() => {
    fetchCommits();
  }, [fetchCommits]);

  useEffect(() => {
    fetchLiveDiff();
  }, [fetchLiveDiff]);

  // Synchronize incoming targetCommitSha prop with commit diff selection
  useEffect(() => {
    if (targetCommitSha) {
      setSelectedMode('commit');
      const match = commits.find((c) => c.sha === targetCommitSha || c.short_sha === targetCommitSha || c.sha.startsWith(targetCommitSha));
      if (match) {
        setSelectedCommit(match);
      } else {
        setSelectedCommit({
          sha: targetCommitSha,
          short_sha: targetCommitSha.slice(0, 7),
          author: 'Commit',
          email: '',
          committed_at: new Date().toISOString(),
          relative_time: '',
          message: `Commit ${targetCommitSha.slice(0, 7)}`
        });
      }
    }
  }, [targetCommitSha, commits]);

  const handleSelectMode = (mode: 'all' | 'working_tree') => {
    setSelectedMode(mode);
    setSelectedCommit(null);
  };

  const handleSelectCommit = (commit: TaskCommit) => {
    setSelectedMode('commit');
    setSelectedCommit(commit);
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

  const grepMatcher = useMemo(() => {
    return createGrepMatcher(fileFilter, { isRegex, searchDiffContent: true });
  }, [fileFilter, isRegex]);

  const diffGrepMap = useMemo(() => {
    const map = new Map<string, { matchesPath: boolean; patchMatchCount: number; matchedLineIndices: Set<number> }>();
    if (!fileFilter.trim()) return map;
    for (const d of diffs) {
      const matchesPath = grepMatcher.test(d.file_path);
      const patchRes = d.diff_content ? grepMatcher.grepPatch(d.diff_content) : { hasMatch: false, matchingLinesCount: 0, matchedLineIndices: [] };
      map.set(d.file_path, {
        matchesPath,
        patchMatchCount: patchRes.matchingLinesCount,
        matchedLineIndices: new Set(patchRes.matchedLineIndices),
      });
    }
    return map;
  }, [diffs, fileFilter, grepMatcher]);

  const filteredDiffs = useMemo(() => {
    if (!fileFilter.trim()) return diffs;
    return diffs.filter((d) => {
      const grepInfo = diffGrepMap.get(d.file_path);
      if (!grepInfo) return false;
      return grepInfo.matchesPath || grepInfo.patchMatchCount > 0;
    });
  }, [diffs, fileFilter, diffGrepMap]);

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
      <span className="px-1.5 py-0.5 rounded text-[9.5px] uppercase font-mono font-bold bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-500/15 dark:text-amber-400 dark:border-amber-500/25">
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
      {/* Top Header & Commit Telemetry Bar */}
      <div className="p-3 bg-onedark-surface/40 border-b border-onedark-borderSubtle flex flex-col gap-2.5 flex-shrink-0">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          {/* Commit & Branch Telemetry Dropdown */}
          <CommitHistoryDropdown
            branch={branch}
            commits={commits}
            selectedMode={selectedMode}
            selectedCommit={selectedCommit}
            onSelectMode={handleSelectMode}
            onSelectCommit={handleSelectCommit}
            isLoading={isLoading}
            onRefresh={() => {
              fetchCommits();
              fetchLiveDiff();
            }}
          />

          {/* Stats, View Toggle, & Actions */}
          <div className="flex items-center space-x-2 flex-shrink-0">
            {diffs.length > 0 && (
              <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-onedark-bg border border-onedark-borderSubtle text-xs font-mono">
                <span className="text-onedark-fg font-semibold">{diffs.length} file{diffs.length > 1 ? 's' : ''}</span>
                <span className="text-onedark-border">|</span>
                <span className="text-onedark-green font-bold">+{totalAdditions}</span>
                <span className="text-onedark-red font-bold">-{totalDeletions}</span>
              </div>
            )}

            {/* Auto / Unified / Split View Toggle */}
            <div className="flex items-center rounded-lg bg-onedark-bg p-0.5 border border-onedark-borderSubtle">
              <button
                onClick={() => setLayoutPreference('auto')}
                className={`px-2 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer flex items-center space-x-1 ${
                  layoutPreference === 'auto'
                    ? 'bg-onedark-surface text-onedark-fgBright shadow-xs'
                    : 'text-onedark-muted hover:text-onedark-fg'
                }`}
                title="Auto responsive layout (hotkey: 0)"
              >
                <LayoutGrid className="w-3 h-3" />
                <span className="hidden sm:inline">Auto</span>
                {layoutPreference === 'auto' && (
                  <span className="text-[9px] text-onedark-blue font-mono ml-0.5 uppercase">
                    {effectiveLayout[0]}
                  </span>
                )}
              </button>
              <button
                onClick={() => setLayoutPreference('unified')}
                className={`px-2 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer flex items-center space-x-1 ${
                  layoutPreference === 'unified'
                    ? 'bg-onedark-surface text-onedark-fgBright shadow-xs'
                    : 'text-onedark-muted hover:text-onedark-fg'
                }`}
                title="Unified Diff View (hotkey: 1)"
              >
                <AlignJustify className="w-3 h-3" />
                <span className="hidden sm:inline">Unified</span>
              </button>
              <button
                onClick={() => setLayoutPreference('split')}
                className={`px-2 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer flex items-center space-x-1 ${
                  layoutPreference === 'split'
                    ? 'bg-onedark-surface text-onedark-fgBright shadow-xs'
                    : 'text-onedark-muted hover:text-onedark-fg'
                }`}
                title="Side-by-Side Split Diff View (hotkey: 2)"
              >
                <Columns className="w-3 h-3" />
                <span className="hidden sm:inline">Split</span>
              </button>
            </div>

            {/* Agent Intent Rationale Toggle */}
            <button
              onClick={() => setShowAgentRationale((prev) => !prev)}
              className={`p-1.5 rounded-lg border text-xs font-medium transition-all cursor-pointer flex items-center space-x-1 ${
                showAgentRationale
                  ? 'bg-onedark-purple/15 border-onedark-purple/40 text-onedark-purple'
                  : 'bg-onedark-surface/60 hover:bg-onedark-surface border-onedark-borderSubtle text-onedark-muted hover:text-onedark-fg'
              }`}
              title="Toggle inline agent intent rationale (hotkey: a)"
            >
              <Bot className="w-3.5 h-3.5" />
            </button>


            <button
              onClick={() => {
                fetchCommits();
                fetchLiveDiff();
              }}
              disabled={isLoading}
              className="p-1.5 rounded-lg bg-onedark-surface/80 hover:bg-onedark-surface border border-onedark-borderSubtle text-onedark-muted hover:text-onedark-fgBright transition-all cursor-pointer disabled:opacity-50"
              title="Refresh diff"
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
                placeholder={isRegex ? "Grep files & diffs (/pattern/)..." : "Grep modified files & diffs..."}
                className={`w-full pl-8 pr-14 py-1 text-xs rounded-lg bg-onedark-bg border ${
                  isRegex
                    ? grepMatcher.isValid
                      ? 'border-onedark-purple/60 focus:border-onedark-purple text-onedark-fg'
                      : 'border-onedark-red/60 focus:border-onedark-red text-onedark-red'
                    : 'border-onedark-border focus:border-onedark-accent text-onedark-fg'
                } placeholder:text-onedark-muted font-mono transition-colors focus:outline-none`}
              />
              <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                {fileFilter && (
                  <button
                    type="button"
                    onClick={() => setFileFilter('')}
                    className="p-0.5 rounded text-onedark-muted hover:text-onedark-fg cursor-pointer"
                    title="Clear filter"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsRegex((prev) => !prev)}
                  className={`px-1 py-0.2 rounded font-mono text-[9.5px] font-bold transition-all cursor-pointer ${
                    isRegex
                      ? 'bg-onedark-purple text-white shadow-xs'
                      : 'text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface'
                  }`}
                  title={
                    isRegex
                      ? grepMatcher.isValid
                        ? 'Grep / Regular Expression active (Click to disable)'
                        : `Regex error: ${grepMatcher.error || 'Invalid regex'}`
                      : 'Enable Grep / Regular Expression mode'
                  }
                >
                  .*
                </button>
              </div>
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

      {/* Active Commit Filter Banner (when inspecting a single commit/turn) */}
      {selectedMode === 'commit' && selectedCommit && (
        <div className="px-3 py-1.5 bg-onedark-purple/10 border-b border-onedark-purple/20 flex items-center justify-between text-xs flex-wrap gap-2">
          <div className="flex items-center space-x-2 min-w-0">
            <Sparkles className="w-3.5 h-3.5 text-onedark-purple flex-shrink-0" />
            <span className="font-semibold text-onedark-fgBright">
              Inspecting {selectedCommit.turn_label || 'Commit'}:
            </span>
            <code className="text-[11px] font-mono bg-onedark-darker px-1.5 py-0.5 rounded text-onedark-purple border border-onedark-purple/25">
              {selectedCommit.short_sha}
            </code>
            <span className="text-onedark-muted truncate max-w-xs sm:max-w-md" title={selectedCommit.message}>
              {selectedCommit.message}
            </span>
          </div>

          <button
            onClick={() => handleSelectMode('all')}
            className="text-onedark-accent hover:underline text-xs font-semibold cursor-pointer flex-shrink-0 ml-auto"
          >
            Show All Task Changes
          </button>
        </div>
      )}

      {/* Main Diff Content Stream */}
      <div ref={containerRef} className="flex-1 overflow-y-auto p-3 space-y-3 select-text">
        {diffs.length === 0 ? (

          /* Empty State */
          <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-4 max-w-md mx-auto select-none">
            <div className="w-12 h-12 rounded-2xl bg-onedark-surface/60 border border-onedark-borderSubtle flex items-center justify-center text-onedark-accent shadow-sm">
              <GitCompare className="w-6 h-6" />
            </div>

            <div className="space-y-1.5">
              <h3 className="text-sm font-bold text-onedark-fgBright">
                {selectedMode === 'working_tree'
                  ? 'No Uncommitted Changes'
                  : selectedMode === 'commit'
                  ? 'No Changes Found for This Commit'
                  : 'No Task Diffs Recorded Yet'}
              </h3>
              <p className="text-xs text-onedark-muted leading-relaxed">
                {selectedMode === 'working_tree'
                  ? 'The working tree is clean. All previous modifications have been committed to turn snapshots.'
                  : selectedMode === 'commit'
                  ? 'This commit does not contain file deltas or was an empty turn checkpoint.'
                  : `The agent is currently on branch ${branch}. When files are edited or created according to the plan, diffs appear here automatically.`}
              </p>
            </div>

            {selectedMode !== 'all' && (
              <button
                onClick={() => handleSelectMode('all')}
                className="px-3 py-1.5 rounded-lg bg-onedark-accent/15 hover:bg-onedark-accent/25 border border-onedark-accent/30 text-xs font-semibold text-onedark-accent transition-all cursor-pointer"
              >
                View All Task Changes (Cumulative)
              </button>
            )}

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
            const pathParts = d.file_path.split('/');
            const fileNameOnly = pathParts.pop();
            const dirPath = pathParts.join('/');
            const grepInfo = diffGrepMap.get(d.file_path);
            const hasPatchMatches = (grepInfo?.patchMatchCount || 0) > 0;

            return (
              <div
                key={`${d.file_path}-${idx}`}
                className="rounded-xl border border-onedark-borderSubtle overflow-hidden bg-onedark-surface/20 transition-all shadow-xs"
              >
                {/* File Header */}
                <div
                  onClick={() => toggleFile(d.file_path)}
                  className="sticky top-0 z-10 backdrop-blur bg-onedark-surface/90 hover:bg-onedark-surface border-b border-onedark-borderSubtle flex items-center justify-between cursor-pointer select-none gap-2 px-3 py-2 shadow-xs transition-colors"
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
                    {hasPatchMatches && (
                      <span className="px-1.5 py-0.2 rounded text-[9.5px] font-mono bg-onedark-purple/15 text-onedark-purple border border-onedark-purple/30 flex items-center gap-1">
                        <Terminal className="w-2.5 h-2.5" />
                        {grepInfo?.patchMatchCount} match{grepInfo && grepInfo.patchMatchCount > 1 ? 'es' : ''} in diff
                      </span>
                    )}
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

                {/* Agent Intent Rationale Banner */}
                {showAgentRationale && agentRationales[d.file_path] && (
                  <div className="px-3 pt-2">
                    <InlineAgentRationale
                      intent={agentRationales[d.file_path].intent}
                      toolName={agentRationales[d.file_path].tool}
                      onDismiss={() => {
                        setAgentRationales(prev => {
                          const next = { ...prev };
                          delete next[d.file_path];
                          return next;
                        });
                      }}
                    />
                  </div>
                )}

                {/* Diff Line Renderer */}
                {!isCollapsed && (
                  <div className="p-2.5 overflow-x-auto text-[12px] leading-relaxed font-mono bg-onedark-bg/80 select-text">
                    {effectiveLayout === 'split' ? (
                      /* Side-by-Side (Split) View */
                      (() => {
                        const splitItems = d.diff_content
                          ? parseSideBySidePatchWithGaps(
                              d.diff_content,
                              d.file_path,
                              expandedLinesByFile[d.file_path],
                              fileTotalLines[d.file_path]
                            )
                          : [];

                        if (splitItems.length === 0) {
                          return (
                            <div className="p-3 text-xs text-onedark-muted italic">
                              Binary file or no detailed hunk content available.
                            </div>
                          );
                        }
                        return (
                          <div className="w-full flex flex-col divide-y divide-onedark-borderSubtle/30">
                            {/* Split Column Headers */}
                            <div className="grid grid-cols-2 text-[10px] font-mono font-bold uppercase text-onedark-muted bg-onedark-darker/60 py-1 px-2 border-b border-onedark-borderSubtle/60 select-none">
                              <div>Original (Before)</div>
                              <div>Modified (After)</div>
                            </div>

                            {splitItems.map((item, itemIdx) => {
                              if (item.kind === 'gap') {
                                return (
                                  <div key={item.gap.id} className="py-0.5">
                                    <DiffHunkExpander
                                      gap={item.gap}
                                      isFocused={focusedHunkId === item.gap.id}
                                      isLoading={Boolean(loadingGaps[item.gap.id])}
                                      onExpandUp={handleExpandUp}
                                      onExpandDown={handleExpandDown}
                                      onExpandAll={handleExpandAll}
                                      onFocus={(id) => setFocusedHunkId(id)}
                                      onCommentClick={(gap) => setCommentingGap(gap)}
                                    />
                                    {commentingGap && commentingGap.id === item.gap.id && (
                                      <HunkFeedbackInput
                                        gap={item.gap}
                                        onSubmit={handleSendHunkFeedback}
                                        onCancel={() => setCommentingGap(null)}
                                      />
                                    )}
                                  </div>
                                );
                              }

                              const { row } = item;
                              const isDel = row.leftType === 'deletion';
                              const isAdd = row.rightType === 'addition';
                              const isExpanded = Boolean(row.isExpanded);

                              return (
                                <div key={itemIdx} className="grid grid-cols-2 divide-x divide-onedark-borderSubtle/30 font-mono text-[11px]">
                                  {/* Left (Old / Deletions) */}
                                  <div
                                    className={`flex items-start px-1.5 py-0.5 overflow-hidden ${
                                      isExpanded
                                        ? 'bg-onedark-surface/20 text-onedark-fg/90'
                                        : isDel
                                        ? 'bg-onedark-red/15 text-onedark-red'
                                        : 'text-onedark-fg/80'
                                    }`}
                                  >
                                    <span className="w-7 flex-shrink-0 text-[10px] text-onedark-muted/60 text-right pr-2 select-none">
                                      {row.leftLineNum ?? ''}
                                    </span>
                                    <span className="w-3 flex-shrink-0 select-none font-bold text-center">
                                      {isDel ? '-' : ' '}
                                    </span>
                                    <DiffCodeLine
                                      text={row.leftText.replace(/^[+-]/, '')}
                                      fileName={d.file_path}
                                      grepMatcher={fileFilter.trim() ? grepMatcher : null}
                                      className="whitespace-pre flex-1 truncate"
                                    />
                                  </div>

                                  {/* Right (New / Additions) */}
                                  <div
                                    className={`flex items-start px-1.5 py-0.5 overflow-hidden ${
                                      isExpanded
                                        ? 'bg-onedark-surface/20 text-onedark-fg/90'
                                        : isAdd
                                        ? 'bg-onedark-green/15 text-onedark-green'
                                        : 'text-onedark-fg/80'
                                    }`}
                                  >
                                    <span className="w-7 flex-shrink-0 text-[10px] text-onedark-muted/60 text-right pr-2 select-none">
                                      {row.rightLineNum ?? ''}
                                    </span>
                                    <span className="w-3 flex-shrink-0 select-none font-bold text-center">
                                      {isAdd ? '+' : ' '}
                                    </span>
                                    <DiffCodeLine
                                      text={row.rightText.replace(/^[+-]/, '')}
                                      fileName={d.file_path}
                                      grepMatcher={fileFilter.trim() ? grepMatcher : null}
                                      className="whitespace-pre flex-1 truncate"
                                    />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()
                    ) : (
                      /* Unified Diff View */
                      (() => {
                        const parsedItems = d.diff_content
                          ? parseUnifiedPatchWithGaps(
                              d.diff_content,
                              d.file_path,
                              expandedLinesByFile[d.file_path],
                              fileTotalLines[d.file_path]
                            )
                          : [];

                        if (parsedItems.length === 0) {
                          return (
                            <div className="p-3 text-xs text-onedark-muted italic">
                              Binary file or no detailed hunk content available.
                            </div>
                          );
                        }

                        return parsedItems.map((item, itemIdx) => {
                          if (item.kind === 'gap') {
                            return (
                              <div key={item.gap.id} className="py-0.5">
                                <DiffHunkExpander
                                  gap={item.gap}
                                  isFocused={focusedHunkId === item.gap.id}
                                  isLoading={Boolean(loadingGaps[item.gap.id])}
                                  onExpandUp={handleExpandUp}
                                  onExpandDown={handleExpandDown}
                                  onExpandAll={handleExpandAll}
                                  onFocus={(id) => setFocusedHunkId(id)}
                                  onCommentClick={(gap) => setCommentingGap(gap)}
                                />
                                {commentingGap && commentingGap.id === item.gap.id && (
                                  <HunkFeedbackInput
                                    gap={item.gap}
                                    onSubmit={handleSendHunkFeedback}
                                    onCancel={() => setCommentingGap(null)}
                                  />
                                )}
                              </div>
                            );
                          }

                          const { line: lineObj } = item;
                          const isAddition = lineObj.type === 'addition';
                          const isDeletion = lineObj.type === 'deletion';
                          const isHeader = lineObj.type === 'header';
                          const isExpanded = Boolean(lineObj.isExpanded);
                          const isLineGrepMatch = Boolean(fileFilter.trim() && !isHeader && grepMatcher.test(lineObj.text));

                          return (
                            <div
                              key={itemIdx}
                              className={`group/line flex items-center px-1.5 py-0.5 rounded-xs transition-colors ${
                                isLineGrepMatch
                                  ? 'bg-onedark-purple/20 ring-1 ring-onedark-purple/60 text-onedark-fgBright font-semibold'
                                  : isAddition
                                  ? 'bg-onedark-green/15 text-onedark-green font-medium'
                                  : isDeletion
                                  ? 'bg-onedark-red/15 text-onedark-red font-medium'
                                  : isExpanded
                                  ? 'bg-onedark-surface/20 text-onedark-fg/90'
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
                              <DiffCodeLine
                                text={lineObj.text.replace(/^[+-]/, '')}
                                fileName={d.file_path}
                                grepMatcher={fileFilter.trim() ? grepMatcher : null}
                                className="whitespace-pre flex-1 min-w-0"
                              />
                            </div>
                          );
                        });
                      })()
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
