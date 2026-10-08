import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { 
  GitPullRequest, 
  ExternalLink, 
  RotateCw, 
  Copy, 
  Check, 
  X, 
  FolderGit2, 
  ChevronLeft, 
  ChevronRight, 
  ChevronDown, 
  ChevronUp,
  ChevronsUpDown,
  Bold,
  Italic,
  Code,
  Quote,
  List, 
  ListOrdered,
  CheckSquare,
  Link,
  Eye,
  Edit3,
  ListTree, 
  PanelLeft,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  FileText,
  FileCode2,
  GitCommit,
  User,
  Clock, 
  Loader2, 
  MessageSquarePlus,
  MessageSquare,
  Bot, 
  Play, 
  ShieldCheck, 
  CheckCircle2,
  GitMerge,
  AlertTriangle,
  Download, 
  AlertCircle, 
  Trash2,
  Terminal, 
  Sparkles, 
  Layers, 
  Filter,
  Send,
  CornerDownRight,
  ThumbsUp,
  Heart,
  Smile,
  Zap,
  ArrowRight,
  ShieldAlert,
  Tag,
  Radio,
  AlignJustify,
  Columns,
  LayoutGrid,
  WrapText,
  GitBranch,
  Package
} from 'lucide-react';
import { isProseFile } from '../../utils/syntaxHighlighter';
import { MarkdownRenderer } from '../Common/MarkdownRenderer';
import { PRReviewAgentPopover, LineContext } from './PRReviewAgentPopover';
import { PRTestingAgentPanel } from './PRTestingAgentPanel';
import { LinearIssueDetailView } from './LinearIssueDetailView';
import { PRListenerConfigModal } from './PRListenerConfigModal';
import { Task, TaskPR, PRCommentItem } from '../../types';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { createGrepMatcher } from '../../utils/grepMatcher';
import { 
  parseUnifiedPatchWithGaps, 
  parseSideBySidePatchWithGaps, 
  DiffHunkGap, 
  UnifiedDiffItem, 
  SideBySideDiffItem,
  SideBySideRow
} from '../../utils/diffContextParser';
import { DiffHunkExpander } from './DiffHunkExpander';
import { HunkFeedbackInput } from './HunkFeedbackInput';
import { DiffCodeLine } from '../Diff/DiffCodeLine';

const API_BASE = import.meta.env.VITE_API_URL || '';

export interface PRFileItem {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
  raw_url?: string;
  blob_url?: string;
}

export interface PRCommitItem {
  sha: string;
  short_sha: string;
  message: string;
  body?: string;
  full_message?: string;
  author_name: string;
  author_login?: string;
  author_avatar?: string;
  date?: string;
  html_url?: string;
  files?: PRFileItem[];
}

export interface PRReaderResponse {
  type: 'github' | 'web';
  is_pr?: boolean;
  url: string;
  title: string;
  description?: string;
  content_markdown: string;
  overview_markdown?: string;
  diff_text?: string;
  files?: PRFileItem[];
  commits?: PRCommitItem[];
  comments?: PRCommentItem[];
  comments_count?: number;
  pr_number?: number;
  pr_title?: string;
  state?: string;
  author?: string;
  author_avatar?: string;
  viewer_login?: string;
  viewer_is_author?: boolean;
  head_branch?: string;
  base_branch?: string;
  additions?: number;
  deletions?: number;
  changed_files_count?: number;
  repo_name?: string;
  clone_url?: string;
  is_draft?: boolean;
}

interface HeadingItem {
  level: number;
  title: string;
  id: string;
}

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

interface PRDiffSectionProps {
  files: PRFileItem[];
  diffText?: string;
  onLineComment?: (filename: string, line: number, content: string) => void;
  title?: string;
  targetFile?: string | null;
  targetLine?: number | null;
  searchQuery?: string;
  task?: Task | null;
  repoName?: string;
  headBranch?: string;
  baseBranch?: string;
  onAskAboutComment?: (prompt: string) => void;
}

export const PRDiffSection: React.FC<PRDiffSectionProps> = ({ 
  files, 
  diffText, 
  onLineComment, 
  title,
  targetFile,
  targetLine,
  searchQuery,
  task,
  repoName,
  headBranch,
  baseBranch,
  onAskAboutComment
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [collapsedFiles, setCollapsedFiles] = useState<Record<string, boolean>>({});
  const [copiedFile, setCopiedFile] = useState<string | null>(null);
  const [fileFilter, setFileFilter] = useState<string>(searchQuery || '');
  const [isRegex, setIsRegex] = useState<boolean>(false);
  const [searchDiffLines, setSearchDiffLines] = useState<boolean>(true);
  const [activeFilename, setActiveFilename] = useState<string | null>(null);
  const [pulsingTarget, setPulsingTarget] = useState<{ file: string; line?: number } | null>(null);
  const [currentMatchIndex, setCurrentMatchIndex] = useState<number>(0);

  // Layout mode: unified (default), split, or auto
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

  const [wrapLines, setWrapLines] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('cyclode_diff_wrap_lines');
      return saved === 'true';
    } catch {
      return false;
    }
  });

  const toggleWrapLines = useCallback(() => {
    setWrapLines((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('cyclode_diff_wrap_lines', String(next));
      } catch {}
      return next;
    });
  }, []);

  const [containerWidth, setContainerWidth] = useState<number>(1000);

  // Expanded context state by file path -> Record of lineNumber -> lineText
  const [expandedLinesByFile, setExpandedLinesByFile] = useState<Record<string, Record<number, string>>>({});
  const [fileTotalLines, setFileTotalLines] = useState<Record<string, number>>({});
  const [loadingGaps, setLoadingGaps] = useState<Record<string, boolean>>({});
  const [focusedHunkId, setFocusedHunkId] = useState<string | null>(null);
  const [commentingGap, setCommentingGap] = useState<DiffHunkGap | null>(null);

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

  const fetchDiffContext = useCallback(async (
    filePath: string,
    startLine: number,
    endLine: number,
    fileObj?: PRFileItem
  ) => {
    const gapKey = `${filePath}:${startLine}-${endLine}`;
    setLoadingGaps((prev) => ({ ...prev, [gapKey]: true }));
    try {
      let resJson: any = null;
      // 1. Try local task sandbox if task ID is available
      if (task?.id) {
        try {
          const res = await fetch(
            `${API_BASE}/api/tasks/${task.id}/diff/context?path=${encodeURIComponent(filePath)}&start_line=${startLine}&end_line=${endLine}`
          );
          if (res.ok) {
            const json = await res.json();
            if (json.ok && json.lines && json.lines.length > 0) {
              resJson = json;
            }
          }
        } catch {
          // fallback to reader
        }
      }

      // 2. Fallback to reader remote repository context API
      if (!resJson) {
        const rawUrl = fileObj?.raw_url || '';
        const params = new URLSearchParams({
          path: filePath,
          start_line: String(startLine),
          end_line: String(endLine),
        });
        if (rawUrl) params.set('raw_url', rawUrl);
        if (repoName) params.set('repo', repoName);
        if (headBranch) params.set('ref', headBranch);

        const res = await fetch(`${API_BASE}/api/reader/diff/context?${params.toString()}`);
        if (res.ok) {
          const json = await res.json();
          if (json.ok && json.lines) {
            resJson = json;
          }
        }
      }

      if (resJson && resJson.lines) {
        setExpandedLinesByFile((prev) => {
          const next = { ...prev };
          const fileLines = { ...(next[filePath] || {}) };
          resJson.lines.forEach((lineText: string, idx: number) => {
            fileLines[resJson.start_line + idx] = lineText;
          });
          next[filePath] = fileLines;
          return next;
        });
        if (resJson.total_lines) {
          setFileTotalLines((prev) => ({
            ...prev,
            [filePath]: resJson.total_lines
          }));
        }
      }
    } catch (err) {
      console.error('Failed to expand diff context:', err);
    } finally {
      setLoadingGaps((prev) => ({ ...prev, [gapKey]: false }));
    }
  }, [task?.id, repoName, headBranch]);

  const handleExpandUp = useCallback((gap: DiffHunkGap) => {
    const fileObj = files.find(f => f.filename === gap.filePath);
    const stepStart = Math.max(gap.gapStartNew, gap.gapEndNew - 19);
    fetchDiffContext(gap.filePath, stepStart, gap.gapEndNew, fileObj);
  }, [files, fetchDiffContext]);

  const handleExpandDown = useCallback((gap: DiffHunkGap) => {
    const fileObj = files.find(f => f.filename === gap.filePath);
    const stepEnd = Math.min(gap.gapEndNew, gap.gapStartNew + 19);
    fetchDiffContext(gap.filePath, gap.gapStartNew, stepEnd, fileObj);
  }, [files, fetchDiffContext]);

  const handleExpandAll = useCallback((gap: DiffHunkGap) => {
    const fileObj = files.find(f => f.filename === gap.filePath);
    fetchDiffContext(gap.filePath, gap.gapStartNew, gap.gapEndNew, fileObj);
  }, [files, fetchDiffContext]);

  const handleSendHunkFeedback = useCallback((feedback: string, gap: DiffHunkGap) => {
    if (onAskAboutComment) {
      onAskAboutComment(`Regarding ${gap.filePath}:${gap.gapStartNew}-${gap.gapEndNew}${gap.symbolContext ? ` (${gap.symbolContext})` : ''}: ${feedback}`);
    } else if (onLineComment) {
      onLineComment(gap.filePath, gap.gapStartNew, feedback);
    }
    setCommentingGap(null);
  }, [onAskAboutComment, onLineComment]);

  // Sync searchQuery from parent
  useEffect(() => {
    if (searchQuery !== undefined && searchQuery !== fileFilter) {
      setFileFilter(searchQuery);
    }
  }, [searchQuery]);

  const toggleFile = (filename: string) => {
    setCollapsedFiles((prev) => ({ ...prev, [filename]: !prev[filename] }));
  };

  const handleCopyPath = (filename: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(filename);
    setCopiedFile(filename);
    setTimeout(() => setCopiedFile(null), 1500);
  };

  const grepMatcher = useMemo(() => {
    return createGrepMatcher(fileFilter, { isRegex, searchDiffContent: searchDiffLines });
  }, [fileFilter, isRegex, searchDiffLines]);

  const fileGrepMap = useMemo(() => {
    const map = new Map<string, { matchesFilename: boolean; patchMatchCount: number; matchedLineIndices: Set<number> }>();
    if (!fileFilter.trim()) {
      return map;
    }
    for (const f of files) {
      const matchesFilename = grepMatcher.test(f.filename);
      const patchRes = searchDiffLines && f.patch ? grepMatcher.grepPatch(f.patch) : { hasMatch: false, matchingLinesCount: 0, matchedLineIndices: [] };
      map.set(f.filename, {
        matchesFilename,
        patchMatchCount: patchRes.matchingLinesCount,
        matchedLineIndices: new Set(patchRes.matchedLineIndices)
      });
    }
    return map;
  }, [files, fileFilter, grepMatcher, searchDiffLines]);

  const filteredFiles = useMemo(() => {
    if (!fileFilter.trim()) return files;
    return files.filter((f) => {
      const grepInfo = fileGrepMap.get(f.filename);
      if (!grepInfo) return false;
      return grepInfo.matchesFilename || grepInfo.patchMatchCount > 0;
    });
  }, [files, fileFilter, fileGrepMap]);

  // Compute all matches across filtered files
  const allMatches = useMemo<Array<{ filename: string; lineNum: number; lineText: string; matchIndexInFile: number; totalMatchesInFile: number }>>(() => {
    if (!fileFilter.trim() || !searchDiffLines) return [];
    const matches: Array<{ filename: string; lineNum: number; lineText: string; matchIndexInFile: number; totalMatchesInFile: number }> = [];
    for (const f of filteredFiles) {
      if (!f.patch) continue;
      const parsed = parseUnifiedPatch(f.patch);
      const fileMatches: Array<{ lineNum: number; lineText: string }> = [];
      for (const p of parsed) {
        if (p.type !== 'header' && grepMatcher.test(p.text)) {
          const lineNum = p.newLine || p.oldLine;
          if (lineNum) {
            fileMatches.push({ lineNum, lineText: p.text });
          }
        }
      }
      fileMatches.forEach((m, idx) => {
        matches.push({
          filename: f.filename,
          lineNum: m.lineNum,
          lineText: m.lineText,
          matchIndexInFile: idx,
          totalMatchesInFile: fileMatches.length
        });
      });
    }
    return matches;
  }, [filteredFiles, fileFilter, grepMatcher, searchDiffLines]);

  // Keep currentMatchIndex within bounds
  useEffect(() => {
    if (allMatches.length === 0) {
      setCurrentMatchIndex(0);
    } else if (currentMatchIndex >= allMatches.length) {
      setCurrentMatchIndex(0);
    }
  }, [allMatches.length, currentMatchIndex]);

  const scrollToDiffFile = (filename?: string, lineNum?: number) => {
    if (!filename) return;
    setCollapsedFiles((prev) => ({ ...prev, [filename]: false }));
    
    if (lineNum) {
      setPulsingTarget({ file: filename, line: lineNum });
      setTimeout(() => {
        const lineEl = document.getElementById(`diff-line-${encodeURIComponent(filename)}-${lineNum}`);
        if (lineEl) {
          lineEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
          const fileEl = document.getElementById(`diff-file-${encodeURIComponent(filename)}`);
          if (fileEl) {
            fileEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }
      }, 50);
      return;
    }

    // If there are search matches in diff lines, find the first matching line
    const grepInfo = fileGrepMap.get(filename);
    if (grepInfo && grepInfo.patchMatchCount > 0) {
      const fileItem = files.find((f) => f.filename === filename);
      if (fileItem && fileItem.patch) {
        const parsed = parseUnifiedPatch(fileItem.patch);
        for (const p of parsed) {
          if (p.type !== 'header' && grepMatcher.test(p.text)) {
            const matchLineNum = p.newLine || p.oldLine;
            if (matchLineNum) {
              setPulsingTarget({ file: filename, line: matchLineNum });
              setTimeout(() => {
                const el = document.getElementById(`diff-line-${encodeURIComponent(filename)}-${matchLineNum}`);
                if (el) {
                  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                } else {
                  const fileEl = document.getElementById(`diff-file-${encodeURIComponent(filename)}`);
                  if (fileEl) {
                    fileEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }
                }
              }, 50);
              return;
            }
          }
        }
      }
    }

    // Fallback: scroll to top of file card
    setPulsingTarget(null);
    const el = document.getElementById(`diff-file-${encodeURIComponent(filename)}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const jumpToMatchIndex = (index: number) => {
    if (allMatches.length === 0) return;
    const normalized = (index + allMatches.length) % allMatches.length;
    setCurrentMatchIndex(normalized);
    const m = allMatches[normalized];
    scrollToDiffFile(m.filename, m.lineNum);
  };

  const handleNextMatch = () => {
    jumpToMatchIndex(currentMatchIndex + 1);
  };

  const handlePrevMatch = () => {
    jumpToMatchIndex(currentMatchIndex - 1);
  };

  const handleJumpToNextMatchInFile = (filename: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const fileMatches = allMatches.map((m, idx) => ({ ...m, globalIndex: idx })).filter((m) => m.filename === filename);
    if (fileMatches.length === 0) return;

    const currentInFileIdx = fileMatches.findIndex((m) => m.globalIndex === currentMatchIndex);
    let nextMatch;
    if (currentInFileIdx >= 0) {
      nextMatch = fileMatches[(currentInFileIdx + 1) % fileMatches.length];
    } else {
      nextMatch = fileMatches[0];
    }
    setCurrentMatchIndex(nextMatch.globalIndex);
    scrollToDiffFile(nextMatch.filename, nextMatch.lineNum);
  };

  // When targetFile or targetLine changes, expand, auto-scroll and pulse
  useEffect(() => {
    if (!targetFile) return;
    setCollapsedFiles((prev) => ({ ...prev, [targetFile]: false }));

    let targetLineNum = targetLine;
    if (!targetLineNum && fileGrepMap.get(targetFile)?.patchMatchCount) {
      const fileItem = files.find((f) => f.filename === targetFile);
      if (fileItem && fileItem.patch) {
        const parsed = parseUnifiedPatch(fileItem.patch);
        for (const p of parsed) {
          if (p.type !== 'header' && grepMatcher.test(p.text)) {
            targetLineNum = p.newLine || p.oldLine || null;
            if (targetLineNum) break;
          }
        }
      }
    }

    setPulsingTarget(targetLineNum ? { file: targetFile, line: targetLineNum } : null);

    const timer = setTimeout(() => {
      if (targetLineNum) {
        const lineEl = document.getElementById(`diff-line-${encodeURIComponent(targetFile)}-${targetLineNum}`);
        if (lineEl) {
          lineEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }
      }
      const fileEl = document.getElementById(`diff-file-${encodeURIComponent(targetFile)}`);
      if (fileEl) {
        fileEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 100);

    const clearTimer = setTimeout(() => {
      setPulsingTarget(null);
    }, 4000);

    return () => {
      clearTimeout(timer);
      clearTimeout(clearTimer);
    };
  }, [targetFile, targetLine, fileGrepMap, grepMatcher, files]);

  // Track active visible file under the sticky top header
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !filteredFiles.length) return;

    let scrollParent: HTMLElement | null = null;
    let parent = container.parentElement;
    while (parent) {
      const overflowY = window.getComputedStyle(parent).overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') {
        scrollParent = parent;
        break;
      }
      parent = parent.parentElement;
    }

    const target = scrollParent || window;

    const handleScroll = () => {
      if (!filteredFiles.length) return;

      const headerEl = container.querySelector('[data-sticky-diff-header]');
      const headerBottom = headerEl ? headerEl.getBoundingClientRect().bottom : (scrollParent ? scrollParent.getBoundingClientRect().top + 60 : 60);

      let current: string = filteredFiles[0].filename;
      for (let i = 0; i < filteredFiles.length; i++) {
        const f = filteredFiles[i];
        const el = document.getElementById(`diff-file-${encodeURIComponent(f.filename)}`);
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.top <= headerBottom + 30) {
            current = f.filename;
          } else {
            break;
          }
        }
      }
      setActiveFilename(current);
    };

    handleScroll();

    target.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleScroll, { passive: true });

    return () => {
      target.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
    };
  }, [filteredFiles]);

  const activeFileIndex = useMemo(() => {
    if (!filteredFiles.length) return 0;
    const idx = filteredFiles.findIndex((f) => f.filename === activeFilename);
    return idx >= 0 ? idx : 0;
  }, [filteredFiles, activeFilename]);

  const activeFile = useMemo(() => {
    return filteredFiles[activeFileIndex] || filteredFiles[0] || null;
  }, [filteredFiles, activeFileIndex]);

  // Compute all expandable gaps across active files for keyboard navigation
  const allGaps = useMemo<DiffHunkGap[]>(() => {
    const gaps: DiffHunkGap[] = [];
    for (const f of filteredFiles) {
      if (!f.patch || collapsedFiles[f.filename]) continue;
      const items = parseUnifiedPatchWithGaps(
        f.patch,
        f.filename,
        expandedLinesByFile[f.filename],
        fileTotalLines[f.filename]
      );
      for (const item of items) {
        if (item.kind === 'gap') {
          gaps.push(item.gap);
        }
      }
    }
    return gaps;
  }, [filteredFiles, collapsedFiles, expandedLinesByFile, fileTotalLines]);

  // Keyboard navigation shortcuts (0/1/2 for layout, [/] for hunk jumps, z to toggle expand, c to comment)
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
      } else if (e.key === 'w' || e.key === 'W') {
        e.preventDefault();
        toggleWrapLines();
      } else if (e.key === ']' || e.key === '[') {
        e.preventDefault();
        if (allGaps.length === 0) return;
        const currentIdx = allGaps.findIndex(g => g.id === focusedHunkId);
        let nextIdx = 0;
        if (e.key === ']') {
          nextIdx = currentIdx < allGaps.length - 1 ? currentIdx + 1 : 0;
        } else {
          nextIdx = currentIdx > 0 ? currentIdx - 1 : allGaps.length - 1;
        }
        const nextGap = allGaps[nextIdx];
        setFocusedHunkId(nextGap.id);
        const el = document.getElementById(`diff-hunk-${nextGap.id}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      } else if (e.key === 'z' || e.key === 'Z') {
        if (focusedHunkId) {
          const gap = allGaps.find(g => g.id === focusedHunkId);
          if (gap) {
            e.preventDefault();
            handleExpandAll(gap);
          }
        }
      } else if (e.key === 'c' || e.key === 'C') {
        if (focusedHunkId) {
          const gap = allGaps.find(g => g.id === focusedHunkId);
          if (gap) {
            e.preventDefault();
            setCommentingGap(gap);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [allGaps, focusedHunkId, handleExpandAll, toggleWrapLines]);

  if (files.length === 0 && !diffText) {
    return (
      <div className="p-8 text-center text-xs text-onedark-muted font-sans leading-relaxed select-none">
        No unified diffs available for this pull request.
      </div>
    );
  }

  const getStatusBadge = (status: string) => {
    const s = (status || 'modified').toLowerCase();
    if (s === 'added' || s === 'new') {
      return (
        <span className="px-1.5 py-0.5 rounded text-[9.5px] uppercase font-mono font-bold bg-onedark-green/15 text-onedark-green border border-onedark-green/25 whitespace-nowrap flex-shrink-0 inline-flex items-center">
          + Added
        </span>
      );
    }
    if (s === 'deleted' || s === 'removed') {
      return (
        <span className="px-1.5 py-0.5 rounded text-[9.5px] uppercase font-mono font-bold bg-onedark-red/15 text-onedark-red border border-onedark-red/25 whitespace-nowrap flex-shrink-0 inline-flex items-center">
          - Deleted
        </span>
      );
    }
    if (s === 'renamed') {
      return (
        <span className="px-1.5 py-0.5 rounded text-[9.5px] uppercase font-mono font-bold bg-onedark-purple/15 text-onedark-purple border border-onedark-purple/25 whitespace-nowrap flex-shrink-0 inline-flex items-center">
          ➔ Renamed
        </span>
      );
    }
    return (
      <span className="px-1.5 py-0.5 rounded text-[9.5px] uppercase font-mono font-bold bg-onedark-blue/15 text-onedark-blue border border-onedark-blue/25 whitespace-nowrap flex-shrink-0 inline-flex items-center">
        ~ Modified
      </span>
    );
  };

  return (
    <div ref={containerRef} className="space-y-4 select-text">
      {/* Sticky Files Summary & Filter Bar */}
      <div 
        data-sticky-diff-header="true"
        className="sticky -top-4 z-20 -mx-4 px-4 py-2 bg-onedark-darker/95 backdrop-blur-md border-b border-onedark-borderSubtle flex flex-col gap-2 text-xs select-none shadow-sm transition-all"
      >
        {/* Tier 1: Files Summary & Diff Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
          {/* Main Title & Count */}
          <div className="flex items-center space-x-1.5 flex-shrink-0">
            <span className="font-semibold text-onedark-fgBright whitespace-nowrap">
              {title || 'Files Changed'}
            </span>
            <span className="px-1.5 py-0.2 rounded-full bg-onedark-surface text-[11px] font-mono font-bold text-onedark-accent border border-onedark-borderSubtle">
              {filteredFiles.length}{filteredFiles.length !== files.length ? ` / ${files.length}` : ''}
            </span>
            {files.length > 0 && (
              <span className="inline-flex items-center space-x-1 px-1.5 py-0.2 rounded bg-onedark-surface text-[10px] font-mono text-onedark-muted border border-onedark-borderSubtle">
                <span className="text-onedark-green font-semibold">+{files.reduce((acc, f) => acc + (f.additions || 0), 0)}</span>
                <span className="text-onedark-border">/</span>
                <span className="text-onedark-red font-semibold">-{files.reduce((acc, f) => acc + (f.deletions || 0), 0)}</span>
              </span>
            )}
          </div>

          {/* Global Controls: Search, Match Stepper, View Layouts, Wrap, Collapse */}
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 flex-shrink-0">
            {files.length > 0 && (
              <div className="flex items-center space-x-1.5">
                <div className="relative">
                  <Search className="w-3 h-3 text-onedark-muted absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={fileFilter}
                    onChange={(e) => setFileFilter(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (e.shiftKey) {
                          handlePrevMatch();
                        } else {
                          handleNextMatch();
                        }
                      }
                    }}
                    placeholder={isRegex ? "Grep files & diffs (/pattern/)..." : "Grep files & diffs..."}
                    className={`w-28 sm:w-40 lg:w-48 pl-6 pr-14 py-1 text-[10.5px] rounded-lg bg-onedark-bg border ${
                      isRegex
                        ? grepMatcher.isValid
                          ? 'border-onedark-purple/60 focus:border-onedark-purple text-onedark-fg'
                          : 'border-onedark-red/60 focus:border-onedark-red text-onedark-red'
                        : 'border-onedark-borderSubtle focus:border-onedark-accent text-onedark-fg'
                    } placeholder:text-onedark-muted focus:outline-none transition-all`}
                  />
                  <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
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

                {/* Grep matches stepper */}
                {fileFilter.trim() && (
                  <div className="flex items-center space-x-1 px-2 py-0.5 rounded-lg bg-onedark-surface border border-onedark-borderSubtle text-[11px] font-mono text-onedark-fg select-none">
                    {allMatches.length > 0 ? (
                      <>
                        <span className="text-onedark-purple font-semibold">
                          {currentMatchIndex + 1}/{allMatches.length}
                        </span>
                        <span className="text-onedark-muted hidden sm:inline">match{allMatches.length > 1 ? 'es' : ''}</span>
                        <div className="flex items-center space-x-0.5 ml-1 border-l border-onedark-borderSubtle pl-1">
                          <button
                            type="button"
                            onClick={handlePrevMatch}
                            className="p-0.5 rounded hover:bg-onedark-darker text-onedark-muted hover:text-onedark-fg cursor-pointer transition-colors"
                            title="Previous match (Shift+Enter / ▲)"
                          >
                            <ChevronUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={handleNextMatch}
                            className="p-0.5 rounded hover:bg-onedark-darker text-onedark-muted hover:text-onedark-fg cursor-pointer transition-colors"
                            title="Next match (Enter / ▼)"
                          >
                            <ChevronDown className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </>
                    ) : (
                      <span className="text-onedark-muted text-[10.5px]">0 diff matches</span>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Auto / Unified / Split View Toggle */}
            <div className="flex items-center rounded-lg bg-onedark-bg p-0.5 border border-onedark-borderSubtle">
              <button
                onClick={() => setLayoutPreference('auto')}
                className={`px-2 py-1 rounded-md text-[10.5px] font-medium transition-all cursor-pointer flex items-center space-x-1 ${
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
                className={`px-2 py-1 rounded-md text-[10.5px] font-medium transition-all cursor-pointer flex items-center space-x-1 ${
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
                className={`px-2 py-1 rounded-md text-[10.5px] font-medium transition-all cursor-pointer flex items-center space-x-1 ${
                  layoutPreference === 'split'
                    ? 'bg-onedark-surface text-onedark-fgBright shadow-xs'
                    : 'text-onedark-muted hover:text-onedark-fg'
                }`}
                title="Side-by-side Split View (hotkey: 2)"
              >
                <Columns className="w-3 h-3" />
                <span className="hidden sm:inline">Split</span>
              </button>
            </div>

            {/* Soft Line Wrap Toggle */}
            <button
              onClick={toggleWrapLines}
              className={`px-2 py-1 rounded-md border text-[10.5px] font-medium transition-all cursor-pointer flex items-center space-x-1 ${
                wrapLines
                  ? 'bg-onedark-accent/15 border-onedark-accent/40 text-onedark-accent'
                  : 'bg-onedark-surface hover:bg-onedark-surface/80 border-onedark-borderSubtle text-onedark-muted hover:text-onedark-fg'
              }`}
              title={`Toggle soft line wrap (hotkey: w) - currently ${wrapLines ? 'ON' : 'OFF'}`}
            >
              <WrapText className="w-3 h-3" />
              <span className="hidden sm:inline">{wrapLines ? 'Wrap' : 'No Wrap'}</span>
            </button>

            <button
              onClick={() => {
                const allCollapsed = filteredFiles.every((f) => collapsedFiles[f.filename]);
                const next: Record<string, boolean> = {};
                filteredFiles.forEach((f) => {
                  next[f.filename] = !allCollapsed;
                });
                setCollapsedFiles(next);
              }}
              className="px-2 py-1 rounded-md bg-onedark-surface hover:bg-onedark-surface/80 border border-onedark-borderSubtle text-[10.5px] text-onedark-fg hover:text-onedark-fgBright cursor-pointer font-medium whitespace-nowrap transition-colors"
            >
              {filteredFiles.every((f) => collapsedFiles[f.filename]) ? 'Expand all' : 'Collapse all'}
            </button>
          </div>
        </div>

        {/* Tier 2: Dedicated Active File Navigator Strip */}
        {activeFile && (
          <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-onedark-borderSubtle/60 text-xs min-w-0">
            {/* Left: Active File Info & Breadcrumb */}
            <div className="flex items-center space-x-2 min-w-0 flex-1">
              <span className="px-1.5 py-0.5 rounded font-mono text-[9.5px] font-bold bg-onedark-surface text-onedark-muted border border-onedark-borderSubtle whitespace-nowrap flex-shrink-0">
                {activeFileIndex + 1} / {filteredFiles.length}
              </span>

              <button
                type="button"
                onClick={() => scrollToDiffFile(activeFile.filename)}
                className="flex items-center space-x-1.5 min-w-0 cursor-pointer text-left overflow-hidden hover:text-onedark-accent transition-colors group"
                title={`Jump to top of ${activeFile.filename}`}
              >
                <FileCode2 className="w-3.5 h-3.5 text-onedark-accent flex-shrink-0" />
                <span className="font-mono text-[11.5px] flex items-center min-w-0 truncate">
                  {(() => {
                    const parts = activeFile.filename.split('/');
                    const fname = parts.pop();
                    const dname = parts.join('/');
                    return (
                      <>
                        {dname && (
                          <span className="text-onedark-muted/60 truncate shrink min-w-0" title={dname}>
                            {dname}/
                          </span>
                        )}
                        <span className="text-onedark-fgBright font-semibold shrink-0 group-hover:text-onedark-accent transition-colors">
                          {fname}
                        </span>
                      </>
                    );
                  })()}
                </span>
              </button>

              {getStatusBadge(activeFile.status)}

              <button
                type="button"
                onClick={(e) => handleCopyPath(activeFile.filename, e)}
                className="p-1 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg transition-colors cursor-pointer flex-shrink-0"
                title="Copy file path"
              >
                {copiedFile === activeFile.filename ? (
                  <Check className="w-3 h-3 text-onedark-green" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>

              <div className="hidden sm:flex items-center space-x-1 font-mono text-[10px] text-onedark-muted flex-shrink-0 pl-1.5 border-l border-onedark-borderSubtle whitespace-nowrap">
                <span className="text-onedark-green font-semibold">+{activeFile.additions || 0}</span>
                <span className="text-onedark-red font-semibold">-{activeFile.deletions || 0}</span>
              </div>
            </div>

            {/* Right: Matches in file & File Stepper */}
            <div className="flex items-center space-x-2 flex-shrink-0">
              {(() => {
                const grepInfo = fileGrepMap.get(activeFile.filename);
                if (grepInfo && grepInfo.patchMatchCount > 0) {
                  return (
                    <button
                      type="button"
                      onClick={(e) => handleJumpToNextMatchInFile(activeFile.filename, e)}
                      className="px-1.5 py-0.5 rounded text-[9.5px] font-mono bg-onedark-purple/20 hover:bg-onedark-purple/30 text-onedark-purple border border-onedark-purple/40 flex items-center gap-1 whitespace-nowrap cursor-pointer transition-colors"
                      title="Cycle through search matches in this file"
                    >
                      <Terminal className="w-2.5 h-2.5" />
                      <span>{grepInfo.patchMatchCount} match{grepInfo.patchMatchCount > 1 ? 'es' : ''} in diff</span>
                      <ChevronDown className="w-2.5 h-2.5 opacity-60" />
                    </button>
                  );
                }
                return null;
              })()}

              {filteredFiles.length > 1 && (
                <div className="flex items-center space-x-0.5 bg-onedark-surface/60 border border-onedark-borderSubtle rounded px-1 py-0.5">
                  <button
                    type="button"
                    disabled={activeFileIndex <= 0}
                    onClick={(e) => {
                      e.stopPropagation();
                      scrollToDiffFile(filteredFiles[activeFileIndex - 1]?.filename);
                    }}
                    className="p-0.5 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg disabled:opacity-20 disabled:pointer-events-none cursor-pointer transition-colors"
                    title="Previous file"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-[10px] font-mono text-onedark-muted px-1 select-none">
                    {activeFileIndex + 1}/{filteredFiles.length}
                  </span>
                  <button
                    type="button"
                    disabled={activeFileIndex >= filteredFiles.length - 1}
                    onClick={(e) => {
                      e.stopPropagation();
                      scrollToDiffFile(filteredFiles[activeFileIndex + 1]?.filename);
                    }}
                    className="p-0.5 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg disabled:opacity-20 disabled:pointer-events-none cursor-pointer transition-colors"
                    title="Next file"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Render Each File Diff */}
      <div className="space-y-3">
        {filteredFiles.length === 0 ? (
          <div className="p-8 text-center text-xs text-onedark-muted font-sans bg-onedark-surface/20 border border-onedark-borderSubtle rounded-xl">
            No changed files or diff lines match "{fileFilter}"
          </div>
        ) : (
          filteredFiles.map((f, idx) => {
            const isCollapsed = collapsedFiles[f.filename] ?? false;
            const pathParts = f.filename.split('/');
            const fileNameOnly = pathParts.pop();
            const dirPath = pathParts.join('/');
            const grepInfo = fileGrepMap.get(f.filename);
            const hasPatchMatches = (grepInfo?.patchMatchCount || 0) > 0;
            const isFileProse = isProseFile(f.filename);
            const shouldWrap = wrapLines || isFileProse;

            return (
              <div
                key={`${f.filename}-${idx}`}
                id={`diff-file-${encodeURIComponent(f.filename)}`}
                className="rounded-xl border border-onedark-borderSubtle overflow-hidden bg-onedark-darker transition-colors shadow-xs scroll-mt-14"
              >
                {/* File Header */}
                <div
                  onClick={() => toggleFile(f.filename)}
                  className="sticky top-0 z-10 backdrop-blur bg-onedark-surface/90 hover:bg-onedark-surface border-b border-onedark-borderSubtle flex items-center justify-between cursor-pointer select-none gap-2 px-3 py-2 shadow-xs transition-colors"
                >
                  <div className="flex items-center space-x-2 min-w-0 flex-1">
                    <ChevronDown
                      className={`w-3.5 h-3.5 text-onedark-muted transition-transform duration-150 flex-shrink-0 ${
                        isCollapsed ? '-rotate-90' : ''
                      }`}
                    />
                    <FileCode2 className="w-3.5 h-3.5 text-onedark-accent flex-shrink-0" />
                    <span className="font-mono text-xs flex items-center min-w-0 truncate" title={f.filename}>
                      {dirPath && <span className="text-onedark-muted/70 truncate shrink min-w-0">{dirPath}/</span>}
                      <span className="text-onedark-fgBright font-semibold shrink-0">{fileNameOnly}</span>
                    </span>
                    {getStatusBadge(f.status)}
                    {hasPatchMatches && (
                      <button
                        type="button"
                        onClick={(e) => handleJumpToNextMatchInFile(f.filename, e)}
                        className="px-1.5 py-0.5 rounded text-[9.5px] font-mono bg-onedark-purple/20 hover:bg-onedark-purple/30 text-onedark-purple border border-onedark-purple/40 flex items-center gap-1 whitespace-nowrap flex-shrink-0 cursor-pointer transition-colors"
                        title="Cycle through search matches in this file"
                      >
                        <Terminal className="w-2.5 h-2.5" />
                        <span>{grepInfo?.patchMatchCount} match{grepInfo && grepInfo.patchMatchCount > 1 ? 'es' : ''} in diff</span>
                        <ChevronDown className="w-2.5 h-2.5 opacity-60" />
                      </button>
                    )}
                  </div>

                  <div className="flex items-center space-x-2 flex-shrink-0">
                    <button
                      onClick={(e) => handleCopyPath(f.filename, e)}
                      className="p-1 rounded hover:bg-onedark-bg text-onedark-muted hover:text-onedark-fg transition-colors cursor-pointer"
                      title="Copy file path"
                    >
                      {copiedFile === f.filename ? <Check className="w-3 h-3 text-onedark-green" /> : <Copy className="w-3 h-3" />}
                    </button>

                    <div className="flex items-center space-x-1 font-mono text-[10.5px]">
                      <span className="text-onedark-green font-semibold">+{f.additions || 0}</span>
                      <span className="text-onedark-red font-semibold">-{f.deletions || 0}</span>
                    </div>
                  </div>
                </div>

                {/* File Patch Lines */}
                {!isCollapsed && (
                  <div className="p-2.5 overflow-x-auto text-[12.5px] leading-relaxed font-mono bg-onedark-bg/60 select-text">
                    {effectiveLayout === 'split' ? (
                      /* Side-by-Side (Split) View */
                      (() => {
                        const splitItems = f.patch
                          ? parseSideBySidePatchWithGaps(
                              f.patch,
                              f.filename,
                              expandedLinesByFile[f.filename],
                              fileTotalLines[f.filename]
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
                                  <div key={item.gap.id} id={`diff-hunk-${item.gap.id}`} className="py-0.5">
                                    <DiffHunkExpander
                                      gap={item.gap}
                                      isFocused={focusedHunkId === item.gap.id}
                                      isLoading={Boolean(loadingGaps[`${item.gap.filePath}:${item.gap.gapStartNew}-${item.gap.gapEndNew}`])}
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
                                <div key={itemIdx} className="grid grid-cols-2 divide-x divide-onedark-borderSubtle/30 font-mono text-[11px] items-stretch">
                                  {/* Left (Old / Deletions) */}
                                  <div
                                    className={`flex items-start px-1.5 py-0.5 overflow-hidden min-w-0 ${
                                      isExpanded
                                        ? 'bg-onedark-surface/20 text-onedark-fg/90'
                                        : isDel
                                        ? 'bg-onedark-red/15 text-onedark-red'
                                        : 'text-onedark-fg/80'
                                    }`}
                                  >
                                    <span className="w-7 flex-shrink-0 text-[10px] text-onedark-muted/60 text-right pr-2 select-none pt-0.5">
                                      {row.leftLineNum ?? ''}
                                    </span>
                                    <span className="w-3 flex-shrink-0 select-none font-bold text-center pt-0.5">
                                      {isDel ? '-' : ' '}
                                    </span>
                                    <DiffCodeLine
                                      text={row.leftText.replace(/^[+-]/, '')}
                                      fileName={f.filename}
                                      grepMatcher={fileFilter.trim() ? grepMatcher : null}
                                      wrap={shouldWrap}
                                      className={shouldWrap ? "whitespace-pre-wrap break-words [overflow-wrap:anywhere] flex-1 min-w-0" : "whitespace-pre flex-1 truncate"}
                                    />
                                  </div>

                                  {/* Right (New / Additions) */}
                                  <div
                                    className={`flex items-start px-1.5 py-0.5 overflow-hidden min-w-0 ${
                                      isExpanded
                                        ? 'bg-onedark-surface/20 text-onedark-fg/90'
                                        : isAdd
                                        ? 'bg-onedark-green/15 text-onedark-green'
                                        : 'text-onedark-fg/80'
                                    }`}
                                  >
                                    <span className="w-7 flex-shrink-0 text-[10px] text-onedark-muted/60 text-right pr-2 select-none pt-0.5">
                                      {row.rightLineNum ?? ''}
                                    </span>
                                    <span className="w-3 flex-shrink-0 select-none font-bold text-center pt-0.5">
                                      {isAdd ? '+' : ' '}
                                    </span>
                                    <DiffCodeLine
                                      text={row.rightText.replace(/^[+-]/, '')}
                                      fileName={f.filename}
                                      grepMatcher={fileFilter.trim() ? grepMatcher : null}
                                      wrap={shouldWrap}
                                      className={shouldWrap ? "whitespace-pre-wrap break-words [overflow-wrap:anywhere] flex-1 min-w-0" : "whitespace-pre flex-1 truncate"}
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
                        const parsedItems = f.patch
                          ? parseUnifiedPatchWithGaps(
                              f.patch,
                              f.filename,
                              expandedLinesByFile[f.filename],
                              fileTotalLines[f.filename]
                            )
                          : [];

                        if (parsedItems.length === 0) {
                          return (
                            <div className="text-onedark-muted italic py-1 px-2 text-xs font-sans">
                              Binary file change or empty patch
                            </div>
                          );
                        }

                        return parsedItems.map((item, itemIdx) => {
                          if (item.kind === 'gap') {
                            return (
                              <div key={item.gap.id} id={`diff-hunk-${item.gap.id}`} className="py-0.5">
                                <DiffHunkExpander
                                  gap={item.gap}
                                  isFocused={focusedHunkId === item.gap.id}
                                  isLoading={Boolean(loadingGaps[`${item.gap.filePath}:${item.gap.gapStartNew}-${item.gap.gapEndNew}`])}
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

                          const lineObj = item.line;
                          const isAddition = lineObj.type === 'addition';
                          const isDeletion = lineObj.type === 'deletion';
                          const isHeader = lineObj.type === 'header';
                          const isExpanded = Boolean(lineObj.isExpanded);
                          const activeLineNum = lineObj.newLine || lineObj.oldLine || 1;
                          const isLineGrepMatch = Boolean(fileFilter.trim() && !isHeader && grepMatcher.test(lineObj.text));
                          const isPulsing = Boolean(
                            pulsingTarget &&
                            pulsingTarget.line &&
                            (pulsingTarget.file === f.filename || pulsingTarget.file.endsWith('/' + f.filename) || f.filename.endsWith('/' + pulsingTarget.file)) &&
                            pulsingTarget.line === activeLineNum
                          );

                          return (
                            <div
                              key={itemIdx}
                              id={`diff-line-${encodeURIComponent(f.filename)}-${activeLineNum}`}
                              className={`group/line flex items-start px-1 py-0.5 rounded-xs transition-all relative scroll-mt-20 ${
                                isPulsing
                                  ? 'bg-onedark-purple/30 ring-2 ring-onedark-purple text-onedark-fgBright font-semibold shadow-xs'
                                  : isLineGrepMatch
                                  ? 'bg-onedark-purple/20 ring-1 ring-onedark-purple/60 text-onedark-fgBright font-semibold'
                                  : isAddition
                                  ? 'bg-onedark-green/10 text-onedark-green hover:bg-onedark-green/15'
                                  : isDeletion
                                  ? 'bg-onedark-red/10 text-onedark-red hover:bg-onedark-red/15'
                                  : isExpanded
                                  ? 'bg-onedark-surface/20 text-onedark-fg/90'
                                  : isHeader
                                  ? 'text-onedark-purple bg-onedark-surface/40 font-semibold my-0.5'
                                  : 'text-onedark-fg/90 hover:bg-onedark-surface/30'
                              }`}
                            >
                              {!isHeader ? (
                                <div className="flex items-center flex-shrink-0 w-20 text-[11px] font-mono text-onedark-muted/40 select-none mr-2 border-r border-onedark-borderSubtle pr-1.5 justify-between pt-0.5">
                                  <span className="w-7 text-right">{lineObj.oldLine ?? ''}</span>
                                  <span className="w-7 text-right">{lineObj.newLine ?? ''}</span>
                                  {onLineComment && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onLineComment(f.filename, activeLineNum, lineObj.text);
                                      }}
                                      className="opacity-0 group-hover/line:opacity-100 transition-opacity p-0.5 rounded bg-onedark-accent text-white hover:bg-onedark-accent/90 hover:scale-110 shadow-xs cursor-pointer ml-1"
                                      title={`Comment on line ${activeLineNum} with Reviewer Agent`}
                                    >
                                      <MessageSquarePlus className="w-3 h-3" />
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <div className="w-20 text-[11px] font-mono text-onedark-purple/60 select-none mr-2 border-r border-onedark-borderSubtle pr-1.5 text-center flex-shrink-0 pt-0.5">
                                  @@
                                </div>
                              )}

                              <DiffCodeLine
                                text={lineObj.text.replace(/^[+-]/, '')}
                                fileName={f.filename}
                                grepMatcher={fileFilter.trim() ? grepMatcher : null}
                                wrap={shouldWrap}
                                className={`font-mono text-[12.5px] leading-relaxed ${shouldWrap ? 'whitespace-pre-wrap break-words [overflow-wrap:anywhere]' : 'whitespace-pre'} flex-1 min-w-0`}
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

interface ParsedCommit {
  typeBadge?: { label: string; colorClass: string };
  ticket?: string;
  cleanSubject: string;
  bodyProse: string;
  trailers: Array<{ key: string; value: string; raw: string; type: 'co-author' | 'sign-off' | 'reference' | 'other' }>;
}

function parseCommitDetails(c: PRCommitItem): ParsedCommit {
  const subject = (c.message || '').trim();
  let cleanSubject = subject;
  let typeBadge: ParsedCommit['typeBadge'] | undefined = undefined;
  let ticket: string | undefined = undefined;

  // Conventional commit format: type(scope): message or type: message
  const conventionalMatch = subject.match(/^([a-zA-Z]+)(?:\(([^)]+)\))?:\s*(.+)$/);
  if (conventionalMatch) {
    const rawType = conventionalMatch[1].toLowerCase();
    const rawScope = conventionalMatch[2];
    const rest = conventionalMatch[3];
    cleanSubject = rest;

    let colorClass = 'bg-onedark-blue/15 text-onedark-blue';
    if (['feat', 'feature'].includes(rawType)) {
      colorClass = 'bg-onedark-green/15 text-onedark-green';
    } else if (['fix', 'bugfix', 'hotfix', 'patch'].includes(rawType)) {
      colorClass = 'bg-onedark-yellow/15 text-onedark-yellow';
    } else if (['perf', 'refactor', 'style'].includes(rawType)) {
      colorClass = 'bg-onedark-purple/15 text-onedark-purple';
    } else if (['test', 'ci', 'build', 'chore', 'docs'].includes(rawType)) {
      colorClass = 'bg-onedark-surface text-onedark-muted';
    }

    typeBadge = {
      label: rawType,
      colorClass
    };

    if (rawScope) {
      ticket = rawScope;
    }
  } else {
    // Ticket prefix format: [PD-1155] or PD-1155:
    const ticketMatch = subject.match(/^\[?([A-Z]{2,10}-\d+)\]?[:\s]+(.+)$/);
    if (ticketMatch) {
      ticket = ticketMatch[1];
      cleanSubject = ticketMatch[2];
    }
  }

  // Extract raw body
  let rawBody = c.body && c.body.trim() ? c.body.trim() : '';
  if (!rawBody && c.full_message) {
    const full = c.full_message.trim();
    if (full.startsWith(subject)) {
      rawBody = full.slice(subject.length).trim();
    } else if (full !== subject) {
      rawBody = full;
    }
  }

  // Extract trailers (Co-Authored-By, Signed-off-by, Refs, etc.)
  const bodyLines = rawBody.split('\n');
  const proseLines: string[] = [];
  const trailers: ParsedCommit['trailers'] = [];

  for (const line of bodyLines) {
    const trimmed = line.trim();
    const coAuthorMatch = trimmed.match(/^Co-[Aa]uthored-[Bb]y:\s*(.+)$/i);
    const signOffMatch = trimmed.match(/^Signed-off-by:\s*(.+)$/i);
    const reviewedMatch = trimmed.match(/^Reviewed-by:\s*(.+)$/i);
    const fixesMatch = trimmed.match(/^(Fixes|Closes|Resolves|Refs):\s*(.+)$/i);

    if (coAuthorMatch) {
      trailers.push({ key: 'Co-Authored-By', value: coAuthorMatch[1], raw: trimmed, type: 'co-author' });
    } else if (signOffMatch) {
      trailers.push({ key: 'Signed-off-by', value: signOffMatch[1], raw: trimmed, type: 'sign-off' });
    } else if (reviewedMatch) {
      trailers.push({ key: 'Reviewed-by', value: reviewedMatch[1], raw: trimmed, type: 'sign-off' });
    } else if (fixesMatch) {
      trailers.push({ key: fixesMatch[1], value: fixesMatch[2], raw: trimmed, type: 'reference' });
    } else {
      proseLines.push(line);
    }
  }

  const bodyProse = proseLines.join('\n').trim();

  return {
    typeBadge,
    ticket,
    cleanSubject,
    bodyProse,
    trailers
  };
}

interface PRCommitsSectionProps {
  commits: PRCommitItem[];
  repoName?: string;
  task?: Task | null;
  onAskAboutComment?: (prompt: string) => void;
  onLineComment?: (filename: string, line: number, content: string) => void;
}

export const PRCommitsSection: React.FC<PRCommitsSectionProps> = ({ 
  commits, 
  repoName, 
  task,
  onAskAboutComment,
  onLineComment 
}) => {
  const [copiedSha, setCopiedSha] = useState<string | null>(null);
  const [expandedBodies, setExpandedBodies] = useState<Record<string, boolean>>({});
  const [expandedDiffs, setExpandedDiffs] = useState<Record<string, boolean>>({});
  const [commitDiffData, setCommitDiffData] = useState<Record<string, PRFileItem[]>>({});
  const [loadingDiffs, setLoadingDiffs] = useState<Record<string, boolean>>({});

  const handleCopySha = (sha: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(sha);
    setCopiedSha(sha);
    setTimeout(() => setCopiedSha(null), 1500);
  };

  const toggleCommitDiff = async (sha: string, htmlUrl?: string) => {
    const isCurrentlyExpanded = !!expandedDiffs[sha];
    setExpandedDiffs(prev => ({ ...prev, [sha]: !isCurrentlyExpanded }));

    if (!isCurrentlyExpanded && !commitDiffData[sha]) {
      setLoadingDiffs(prev => ({ ...prev, [sha]: true }));
      try {
        const apiBase = import.meta.env.VITE_API_URL || '';
        const fetchUrl = htmlUrl || (repoName ? `https://github.com/${repoName}/commit/${sha}` : '');
        if (fetchUrl) {
          const res = await fetch(`${apiBase}/api/reader?url=${encodeURIComponent(fetchUrl)}`);
          if (res.ok) {
            const data = await res.json();
            setCommitDiffData(prev => ({ ...prev, [sha]: data.files || [] }));
          }
        }
      } catch (e) {
        console.error('Failed to load commit diff:', e);
      } finally {
        setLoadingDiffs(prev => ({ ...prev, [sha]: false }));
      }
    }
  };

  if (commits.length === 0) {
    return (
      <div className="p-8 text-center text-xs text-onedark-muted font-sans leading-relaxed select-none">
        No individual commit records cached for this pull request.<br />
        Open the pull request on GitHub to view full commit history.
      </div>
    );
  }

  return (
    <div className="space-y-3 select-text">
      <div className="px-3 py-2 bg-onedark-surface/50 border border-onedark-borderSubtle rounded-xl flex items-center justify-between text-xs select-none">
        <span className="font-semibold text-onedark-fgBright">
          Commits in this Pull Request ({commits.length})
        </span>
      </div>

      <div className="space-y-3">
        {commits.map((c, idx) => {
          const parsed = parseCommitDetails(c);
          const isBodyExpanded = !!expandedBodies[c.sha];
          const isDiffExpanded = !!expandedDiffs[c.sha];
          const diffFiles = commitDiffData[c.sha] || [];
          const isDiffLoading = !!loadingDiffs[c.sha];

          return (
            <div
              key={`${c.sha}-${idx}`}
              id={`commit-item-${c.sha}`}
              className="rounded-xl border border-onedark-borderSubtle bg-onedark-darker overflow-hidden hover:border-onedark-border transition-all shadow-xs scroll-mt-4"
            >
              <div className="p-3.5 flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="flex items-start space-x-3 min-w-0 flex-1">
                  {/* Author Avatar */}
                  <div className="w-7 h-7 rounded-full bg-onedark-surface border border-onedark-borderSubtle flex items-center justify-center text-onedark-accent flex-shrink-0 mt-0.5 overflow-hidden shadow-xs">
                    {c.author_avatar ? (
                      <img src={c.author_avatar} alt={c.author_name} className="w-full h-full object-cover" />
                    ) : (
                      <User className="w-3.5 h-3.5 text-onedark-muted" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    {/* Subject Line with Conventional Commit & Ticket Badges */}
                    <div className="flex flex-wrap items-center gap-1.5 leading-snug">
                      {parsed.typeBadge && (
                        <span className={`px-1.5 py-0.5 rounded-md font-mono text-[10px] font-bold uppercase tracking-wider border flex-shrink-0 ${parsed.typeBadge.colorClass}`}>
                          {parsed.typeBadge.label}
                        </span>
                      )}

                      {parsed.ticket && (
                        <span className="px-1.5 py-0.5 rounded-md font-mono text-[10.5px] font-semibold bg-onedark-accent/15 text-onedark-accent border border-onedark-accent/30 flex-shrink-0">
                          {parsed.ticket}
                        </span>
                      )}

                      <span className="text-[13px] font-bold text-onedark-fgBright select-text">
                        {parsed.cleanSubject}
                      </span>
                    </div>

                    {/* Commit Description Body Box */}
                    {(parsed.bodyProse || parsed.trailers.length > 0) && (
                      <div className="mt-2.5 bg-onedark-bg/95 p-3.5 rounded-lg border border-onedark-borderSubtle text-[13.5px] text-onedark-fg/90 font-sans leading-relaxed shadow-xs select-text">
                        {parsed.bodyProse && (
                          <div>
                            <div className={`max-w-none text-onedark-fg text-[13.5px] leading-relaxed ${!isBodyExpanded && parsed.bodyProse.length > 220 ? 'line-clamp-3' : ''}`}>
                              <MarkdownRenderer content={parsed.bodyProse} className="text-[13.5px] leading-relaxed text-onedark-fg" />
                            </div>

                            {parsed.bodyProse.length > 220 && (
                              <button
                                onClick={() => setExpandedBodies(prev => ({ ...prev, [c.sha]: !isBodyExpanded }))}
                                className="inline-flex items-center space-x-1.5 mt-2.5 px-2.5 py-1 rounded-md text-[11px] font-medium text-onedark-accent bg-onedark-accent/10 hover:bg-onedark-accent/20 border border-onedark-accent/25 transition-colors cursor-pointer"
                              >
                                <span>{isBodyExpanded ? 'Show less' : 'Show full description'}</span>
                                {isBodyExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                              </button>
                            )}
                          </div>
                        )}

                        {/* Git Trailers: Co-Authored-By, Signed-Off-By, Issue References */}
                        {parsed.trailers.length > 0 && (
                          <div className={`flex flex-wrap items-center gap-1.5 ${parsed.bodyProse ? 'mt-3 pt-2.5 border-t border-onedark-borderSubtle' : ''}`}>
                            {parsed.trailers.map((t, tIdx) => {
                              if (t.type === 'co-author') {
                                const nameMatch = t.value.match(/^([^<]+)(?:<([^>]+)>)?$/);
                                const authorName = nameMatch ? nameMatch[1].trim() : t.value;
                                const authorEmail = nameMatch && nameMatch[2] ? nameMatch[2].trim() : null;

                                return (
                                  <div
                                    key={tIdx}
                                    className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-onedark-surface/80 border border-onedark-borderSubtle text-[11px] text-onedark-muted shadow-2xs"
                                  >
                                    <Bot className="w-3.5 h-3.5 text-onedark-accent flex-shrink-0" />
                                    <span className="text-onedark-muted/80">Co-authored by</span>
                                    <span className="font-semibold text-onedark-fgBright">{authorName}</span>
                                    {authorEmail && <span className="font-mono text-[10px] text-onedark-muted/60">&lt;{authorEmail}&gt;</span>}
                                  </div>
                                );
                              }

                              if (t.type === 'sign-off') {
                                return (
                                  <div
                                    key={tIdx}
                                    className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-onedark-surface/80 border border-onedark-borderSubtle text-[11px] text-onedark-muted shadow-2xs"
                                  >
                                    <Check className="w-3.5 h-3.5 text-onedark-green flex-shrink-0" />
                                    <span className="text-onedark-muted/80">{t.key}:</span>
                                    <span className="font-medium text-onedark-fgBright">{t.value}</span>
                                  </div>
                                );
                              }

                              return (
                                <div
                                  key={tIdx}
                                  className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-onedark-surface/80 border border-onedark-borderSubtle text-[11px] text-onedark-muted shadow-2xs"
                                >
                                  <Sparkles className="w-3.5 h-3.5 text-onedark-purple flex-shrink-0" />
                                  <span className="text-onedark-muted/80">{t.key}:</span>
                                  <span className="font-mono font-medium text-onedark-accent">{t.value}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Author & Timestamp Footer */}
                    <div className="flex items-center space-x-2 text-[11px] text-onedark-muted mt-2 font-sans select-none">
                      <span className="font-semibold text-onedark-fgBright">@{c.author_login || c.author_name}</span>
                      {c.date && (
                        <>
                          <span>•</span>
                          <span className="flex items-center space-x-1 text-onedark-muted/80">
                            <Clock className="w-3 h-3" />
                            <span>{new Date(c.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right Actions: View Changes Toggle, SHA Copy, GitHub Link */}
                <div className="flex items-center space-x-1.5 self-end sm:self-start flex-shrink-0 pt-0.5 select-none">
                  <button
                    onClick={() => toggleCommitDiff(c.sha, c.html_url)}
                    className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-all cursor-pointer shadow-xs whitespace-nowrap ${
                      isDiffExpanded
                        ? 'bg-onedark-accent/20 border-onedark-accent/50 text-onedark-accent'
                        : 'bg-onedark-surface hover:bg-onedark-surface/80 border-onedark-border text-onedark-fg'
                    }`}
                    title="View files changed in this commit"
                  >
                    {isDiffLoading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-onedark-accent" />
                    ) : (
                      <FileCode2 className="w-3.5 h-3.5 text-onedark-blue" />
                    )}
                    <span>{isDiffExpanded ? 'Hide Diff' : 'View Diff'}</span>
                  </button>

                  <button
                    onClick={(e) => handleCopySha(c.sha, e)}
                    className="flex items-center space-x-1 px-2 py-1 rounded-md bg-onedark-surface hover:bg-onedark-surface/80 border border-onedark-border font-mono text-[10.5px] text-onedark-muted hover:text-onedark-fg transition-colors cursor-pointer shadow-xs whitespace-nowrap"
                    title="Copy Full Commit SHA"
                  >
                    {copiedSha === c.sha ? (
                      <Check className="w-3 h-3 text-onedark-green" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    <span>{c.short_sha || c.sha.slice(0, 7)}</span>
                  </button>

                  {c.html_url && (
                    <a
                      href={c.html_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1 rounded-md hover:bg-onedark-surface text-onedark-muted hover:text-onedark-accent transition-colors border border-transparent hover:border-onedark-borderSubtle"
                      title="View commit on GitHub"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              </div>

              {/* Commit Files & Unified Diff Accordion */}
              {isDiffExpanded && (
                <div className="border-t border-onedark-border bg-onedark-bg/80 p-3">
                  {isDiffLoading ? (
                    <div className="py-6 flex items-center justify-center space-x-2 text-xs text-onedark-muted">
                      <Loader2 className="w-4 h-4 text-onedark-accent animate-spin" />
                      <span>Loading commit diffs...</span>
                    </div>
                  ) : diffFiles.length > 0 ? (
                    <PRDiffSection 
                      files={diffFiles} 
                      title={`Commit ${c.short_sha} Changes (${diffFiles.length} files)`}
                      task={task}
                      repoName={repoName}
                      headBranch={c.sha}
                      onAskAboutComment={onAskAboutComment}
                      onLineComment={onLineComment}
                    />
                  ) : (
                    <div className="p-4 text-center text-xs text-onedark-muted font-sans">
                      No modified files recorded for this commit.
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const MiniDiffHunkViewer: React.FC<{
  diffHunk: string;
  filePath?: string;
  targetLine?: number;
  onJumpToDiff?: (path: string, line?: number) => void;
}> = ({ diffHunk, filePath, targetLine, onJumpToDiff }) => {
  const parsedLines = useMemo(() => parseUnifiedPatch(diffHunk), [diffHunk]);

  if (!diffHunk) return null;

  return (
    <div className="rounded-xl border border-onedark-borderSubtle bg-onedark-bg overflow-hidden font-mono text-[11.5px] shadow-2xs my-1.5">
      {filePath && (
        <div className="flex items-center justify-between px-3 py-1.5 bg-onedark-darker border-b border-onedark-borderSubtle text-xs">
          <div className="flex items-center space-x-1.5 truncate text-onedark-fg">
            <FileCode2 className="w-3.5 h-3.5 text-onedark-accent flex-shrink-0" />
            <span className="font-semibold text-onedark-fgBright truncate">{filePath}</span>
            {targetLine && (
              <span className="text-onedark-accent font-mono font-medium">:{targetLine}</span>
            )}
          </div>
          {onJumpToDiff && (
            <button
              onClick={() => onJumpToDiff(filePath, targetLine)}
              className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[10.5px] font-medium bg-onedark-accent/15 text-onedark-accent hover:bg-onedark-accent/25 border border-onedark-accent/30 transition-colors cursor-pointer"
              title="Jump to line in PR Diff tab"
            >
              <span>Jump to Diff</span>
              <ArrowRight className="w-2.5 h-2.5" />
            </button>
          )}
        </div>
      )}

      <div className="overflow-x-auto divide-y divide-onedark-borderSubtle max-h-64 leading-tight">
        {parsedLines.map((line, idx) => {
          const isTarget = targetLine && (line.newLine === targetLine || line.oldLine === targetLine);
          if (line.type === 'header') {
            return (
              <div
                key={idx}
                className="px-3 py-1 bg-onedark-purple/10 text-onedark-purple text-[10.5px] select-none font-semibold"
              >
                {line.text}
              </div>
            );
          }

          const isAddition = line.type === 'addition';
          const isDeletion = line.type === 'deletion';

          return (
            <div
              key={idx}
              className={`flex items-start px-2 py-0.5 transition-colors ${
                isAddition
                  ? 'bg-onedark-green/10 text-onedark-green hover:bg-onedark-green/15'
                  : isDeletion
                  ? 'bg-onedark-red/10 text-onedark-red hover:bg-onedark-red/15'
                  : 'text-onedark-fg/90 hover:bg-onedark-surface/30'
              } ${isTarget ? 'ring-1 ring-inset ring-onedark-accent font-semibold' : ''}`}
            >
              <span className="w-7 text-right select-none opacity-40 font-mono text-[10px] pr-1.5 flex-shrink-0">
                {line.oldLine || ''}
              </span>
              <span className="w-7 text-right select-none opacity-40 font-mono text-[10px] pr-2 flex-shrink-0 border-r border-onedark-borderSubtle">
                {line.newLine || ''}
              </span>
              <span className="w-4 text-center select-none font-bold text-xs flex-shrink-0">
                {isAddition ? '+' : isDeletion ? '-' : ' '}
              </span>
              <DiffCodeLine
                text={line.text.slice(1) || ' '}
                fileName={filePath}
                wrap={isProseFile(filePath)}
                className={`font-mono ${isProseFile(filePath) ? 'whitespace-pre-wrap break-words [overflow-wrap:anywhere]' : 'whitespace-pre'} flex-1 text-[11px] min-w-0 pl-1 leading-snug`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

export interface ParsedBotComment {
  category?: { label: string; colorClass: string };
  severity?: { label: string; colorClass: string };
  effort?: { label: string; colorClass: string };
  aiPrompt?: string;
  cleanBody: string;
  botConfig?: {
    runId?: string;
    profile?: string;
    plan?: string;
    configUsed?: string;
    remainingReviews?: string;
  };
  warningsCount?: number;
  summarySnippet?: string;
}

export function parseBotReviewComment(rawBody?: string): ParsedBotComment {
  if (!rawBody) return { cleanBody: '' };

  let category: ParsedBotComment['category'] = undefined;
  let severity: ParsedBotComment['severity'] = undefined;
  let effort: ParsedBotComment['effort'] = undefined;
  let aiPrompt: string | undefined = undefined;
  let botConfig: ParsedBotComment['botConfig'] = undefined;
  let warningsCount: number | undefined = undefined;
  let summarySnippet: string | undefined = undefined;

  let bodyText = rawBody;

  // Extract AI prompt block if available: <details><summary>...Prompt for AI Agents...</summary>...
  const promptMatch = bodyText.match(/(?:<details>\s*<summary>[\s\S]*?Prompt for AI Agents[\s\S]*?<\/summary>([\s\S]*?)<\/details>|>\s*🤖\s*Prompt for AI Agents[\r\n]+(?:```(?:[a-zA-Z0-9_-]+)?\s*([\s\S]*?)```|([\s\S]*?)(?=\n\n|\n[#<]|$)))/i);
  if (promptMatch) {
    aiPrompt = (promptMatch[1] || promptMatch[2] || promptMatch[3] || '').trim();
    aiPrompt = aiPrompt.replace(/^```[a-zA-Z0-9_-]*\s*/, '').replace(/\s*```$/, '').trim();
    bodyText = bodyText.replace(promptMatch[0], '').trim();
  }

  // Strip coderabbit raw image URLs at top
  bodyText = bodyText.replace(/^https?:\/\/[^\s\n]+#gh-(?:light|dark)-mode-only\s*$/gim, '');

  // Extract CodeRabbit / Bot Diagnostics metadata
  const runIdMatch = bodyText.match(/Run ID:\s*`?([a-zA-Z0-9_-]+)`?/i);
  const profileMatch = bodyText.match(/Review profile:\s*`?([a-zA-Z0-9_-]+)`?/i);
  const planMatch = bodyText.match(/Plan:\s*`?([a-zA-Z0-9_-]+)`?/i);
  const configMatch = bodyText.match(/Configuration used:\s*`?([^\n]+)`?/i);
  const allowanceMatch = bodyText.match(/Included review availability:\s*([^\n]+)/i);

  if (runIdMatch || profileMatch || planMatch || configMatch || allowanceMatch) {
    botConfig = {
      runId: runIdMatch ? runIdMatch[1] : undefined,
      profile: profileMatch ? profileMatch[1] : undefined,
      plan: planMatch ? planMatch[1] : undefined,
      configUsed: configMatch ? configMatch[1].replace(/Repository:\s*/i, '').trim() : undefined,
      remainingReviews: allowanceMatch ? allowanceMatch[1].trim() : undefined,
    };
  }

  // Extract warning counts e.g. "Failed checks (5 warnings)" or "5 warnings"
  const warningsMatch = bodyText.match(/(?:Failed checks\s*\()?(\d+)\s+warnings?\)?/i);
  if (warningsMatch) {
    warningsCount = parseInt(warningsMatch[1], 10);
  }

  // Extract Walkthrough summary snippet for collapsed preview
  const walkthroughMatch = bodyText.match(/Walkthrough\s*\n+([\s\S]*?)(?=\n\n\s*Changes|\n\n\s*#{1,4}|\nFailed checks|$)/i);
  if (walkthroughMatch) {
    summarySnippet = walkthroughMatch[1].replace(/[*_`#]/g, '').trim().slice(0, 160);
  }

  const lines = bodyText.split('\n');
  const cleanLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip bot metadata noise lines since they are preserved in botConfig
    if (/^Configuration used:/i.test(line) ||
        /^Review profile:/i.test(line) ||
        /^Plan:/i.test(line) ||
        /^Run ID:/i.test(line) ||
        /^Included review availability:/i.test(line) ||
        /^Review in Change Stack/i.test(line) ||
        /^Navigate logical layers of code changes/i.test(line) ||
        /^Reviewing files that changed from the base/i.test(line)) {
      continue;
    }

    // Check for piped badges: e.g. 🎯 Functional Correctness | 🟠 Major | ⚡ Quick win
    if (line.includes('|') && (
      line.includes('Correctness') ||
      line.includes('Security') ||
      line.includes('Performance') ||
      line.includes('Refactor') ||
      line.includes('Documentation') ||
      line.includes('Major') ||
      line.includes('Minor') ||
      line.includes('Critical') ||
      line.includes('Nitpick') ||
      line.includes('Quick win') ||
      line.includes('Suggestion')
    )) {
      const parts = line.split('|').map((p) => p.replace(/[*_`]/g, '').trim());
      for (const part of parts) {
        const lower = part.toLowerCase();
        // Category
        if (lower.includes('correctness') || lower.includes('functional') || lower.includes('bug') || lower.includes('logic')) {
          category = { label: 'Functional Correctness', colorClass: 'bg-onedark-purple/15 text-onedark-purple' };
        } else if (lower.includes('security') || lower.includes('vulnerability') || lower.includes('cve')) {
          category = { label: 'Security', colorClass: 'bg-onedark-red/15 text-onedark-red' };
        } else if (lower.includes('performance') || lower.includes('speed') || lower.includes('optimization')) {
          category = { label: 'Performance', colorClass: 'bg-onedark-yellow/15 text-onedark-yellow' };
        } else if (lower.includes('refactor') || lower.includes('clean') || lower.includes('maintainability')) {
          category = { label: 'Refactor', colorClass: 'bg-onedark-blue/15 text-onedark-blue' };
        } else if (lower.includes('doc') || lower.includes('style') || lower.includes('typo')) {
          category = { label: 'Documentation', colorClass: 'bg-onedark-surface text-onedark-fg' };
        }

        // Severity
        if (lower.includes('critical') || lower.includes('blocker')) {
          severity = { label: 'Critical', colorClass: 'bg-onedark-red/20 text-onedark-red font-bold' };
        } else if (lower.includes('major')) {
          severity = { label: 'Major', colorClass: 'bg-onedark-yellow/20 text-onedark-yellow font-bold' };
        } else if (lower.includes('minor')) {
          severity = { label: 'Minor', colorClass: 'bg-onedark-surface text-onedark-fgBright' };
        } else if (lower.includes('nitpick') || lower.includes('trivial') || lower.includes('info')) {
          severity = { label: 'Nitpick', colorClass: 'bg-onedark-blue/15 text-onedark-blue' };
        }

        // Effort
        if (lower.includes('quick win') || lower.includes('quick')) {
          effort = { label: 'Quick win', colorClass: 'bg-onedark-green/15 text-onedark-green' };
        } else if (lower.includes('complex') || lower.includes('high effort')) {
          effort = { label: 'High effort', colorClass: 'bg-onedark-purple/15 text-onedark-purple' };
        }
      }
      continue;
    }

    // Format plain Walkthrough / Changes / Failed checks lines as headings
    if (line === 'Walkthrough') {
      cleanLines.push('### 📖 Walkthrough');
      continue;
    }
    if (line === 'Changes') {
      cleanLines.push('### 📦 Changes');
      continue;
    }
    if (/^Failed checks\s*\(\d+\s+warnings?\)/i.test(line) || line.startsWith('❌ Failed checks')) {
      cleanLines.push(`### ⚠️ ${line.replace(/^❌\s*/, '')}`);
      continue;
    }

    cleanLines.push(lines[i]);
  }

  let cleanBody = cleanLines.join('\n').trim();
  cleanBody = cleanBody.replace(/^\n+/, '');

  if (!summarySnippet && cleanBody) {
    const firstLine = cleanBody.split('\n').find(l => l.trim() && !l.startsWith('#') && !l.startsWith('-') && !l.startsWith('|'));
    if (firstLine) {
      summarySnippet = firstLine.replace(/[*_`]/g, '').trim().slice(0, 140);
    }
  }

  return {
    category,
    severity,
    effort,
    aiPrompt,
    cleanBody,
    botConfig,
    warningsCount,
    summarySnippet
  };
}

interface PRCommentsSectionProps {
  comments: PRCommentItem[];
  prNumber?: number;
  task?: Task | null;
  onJumpToDiff?: (path: string, line?: number) => void;
  onRefreshComments?: () => Promise<void>;
  onAskAboutComment?: (prompt: string) => void;
  isSyncing?: boolean;
  lastSyncedAt?: Date | null;
}

const formatCommentTimeAgo = (dateStr?: string): string => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 2592000) return `${Math.floor(diffSec / 86400)}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

interface PRCommentComposerProps {
  prNumber?: number;
  taskId?: string;
  replyingTo: PRCommentItem | null;
  onCancelReply: () => void;
  onCommentPosted?: () => Promise<void>;
  onAskAboutComment?: (prompt: string) => void;
  comments?: PRCommentItem[];
}

export const PRCommentComposer: React.FC<PRCommentComposerProps> = ({
  prNumber,
  taskId,
  replyingTo,
  onCancelReply,
  onCommentPosted,
  onAskAboutComment,
  comments = []
}) => {
  const draftKey = `cyclode_pr_draft_${prNumber || 'generic'}`;
  const [activeTab, setActiveTab] = useState<'write' | 'preview'>('write');
  const [commentText, setCommentText] = useState<string>(() => {
    try {
      return sessionStorage.getItem(draftKey) || '';
    } catch {
      return '';
    }
  });
  const [isPosting, setIsPosting] = useState<boolean>(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [postSuccess, setPostSuccess] = useState<boolean>(false);
  const [showPresetsMenu, setShowPresetsMenu] = useState<boolean>(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      if (commentText) {
        sessionStorage.setItem(draftKey, commentText);
      } else {
        sessionStorage.removeItem(draftKey);
      }
    } catch {}
  }, [commentText, draftKey]);

  useEffect(() => {
    if (replyingTo && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [replyingTo]);

  const insertMarkdown = useCallback((prefix: string, suffix: string = '', defaultText: string = '') => {
    setActiveTab('write');
    const textarea = textareaRef.current;
    if (!textarea) {
      setCommentText((prev) => `${prev}${prefix}${defaultText}${suffix}`);
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = commentText.substring(start, end) || defaultText;
    const replacement = `${prefix}${selected}${suffix}`;
    const next = commentText.substring(0, start) + replacement + commentText.substring(end);
    setCommentText(next);

    setTimeout(() => {
      textarea.focus();
      const selectionStartPos = start + prefix.length;
      const selectionEndPos = start + prefix.length + selected.length;
      textarea.setSelectionRange(selectionStartPos, selectionEndPos);
    }, 0);
  }, [commentText]);

  const presets = [
    { label: 'LGTM 👍', text: 'LGTM! Verified and looks good to merge. 👍\n', title: 'Approve & LGTM' },
    { label: 'Nitpick 🔍', text: '**Nitpick:** ', title: 'Minor styling / clean-up' },
    { label: 'Question ❓', text: '**Question:** Could you clarify ', title: 'Ask for clarification' },
    { label: 'Request Changes ⚠️', text: '### ⚠️ Changes Requested\n\n- ', title: 'Block / Request updates' },
    { label: 'Test Request 🧪', text: '**Test Request:** Could we add automated test coverage for ', title: 'Request unit / integration tests' },
    { label: 'Code Suggestion 💡', text: '```suggestion\n// Replace with optimized logic\n```\n', title: 'Suggest inline diff replacement' }
  ];

  const distinctAuthors = useMemo(() => {
    const set = new Set<string>();
    if (replyingTo?.author) set.add(replyingTo.author);
    for (const c of comments) {
      if (c.author && !c.author.toLowerCase().includes('[bot]')) {
        set.add(c.author);
      }
    }
    return Array.from(set).slice(0, 4);
  }, [comments, replyingTo]);

  const handlePost = async () => {
    const text = commentText.trim();
    if (!text || !taskId || !prNumber) return;
    setIsPosting(true);
    setPostError(null);
    setPostSuccess(false);

    try {
      const apiBase = import.meta.env.VITE_API_URL || '';
      const res = await fetch(`${apiBase}/api/tasks/${taskId}/prs/${prNumber}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: text,
          in_reply_to_id: replyingTo?.raw_id
        })
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || errJson.error || `HTTP ${res.status}`);
      }

      setCommentText('');
      try {
        sessionStorage.removeItem(draftKey);
      } catch {}
      onCancelReply();
      setPostSuccess(true);
      setTimeout(() => setPostSuccess(false), 3000);
      if (onCommentPosted) {
        await onCommentPosted();
      }
    } catch (err: any) {
      setPostError(err.message || 'Failed to post comment');
    } finally {
      setIsPosting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!isPosting && commentText.trim()) {
        handlePost();
      }
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      insertMarkdown('**', '**', 'bold text');
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i') {
      e.preventDefault();
      insertMarkdown('*', '*', 'italic text');
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      insertMarkdown('[', '](https://...)', 'link text');
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
      e.preventDefault();
      insertMarkdown('`', '`', 'code');
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      setActiveTab((prev) => (prev === 'write' ? 'preview' : 'write'));
      return;
    }
    if (e.key === 'Escape' && replyingTo) {
      e.preventDefault();
      onCancelReply();
      return;
    }
  };

  const wordCount = useMemo(() => {
    const trimmed = commentText.trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
  }, [commentText]);

  return (
    <div className="mt-6 rounded-xl border border-onedark-borderSubtle bg-onedark-darker/90 shadow-sm overflow-hidden transition-all focus-within:border-onedark-border">
      {/* Header Bar: Mode Switcher, Reply Target, and Presets */}
      <div className="flex items-center justify-between px-3.5 py-2.5 bg-onedark-surface/60 border-b border-onedark-borderSubtle gap-2 flex-wrap">
        <div className="flex items-center space-x-2 min-w-0">
          <span className="font-semibold text-onedark-fgBright text-xs flex items-center space-x-1.5">
            <MessageSquarePlus className="w-3.5 h-3.5 text-onedark-accent flex-shrink-0" />
            <span className="truncate">
              {replyingTo ? `Reply to @${replyingTo.author}` : 'Add a comment'}
            </span>
          </span>

          {replyingTo && (
            <button
              onClick={onCancelReply}
              className="px-1.5 py-0.5 rounded text-[10.5px] bg-onedark-surface text-onedark-muted hover:text-onedark-fg border border-onedark-borderSubtle flex items-center space-x-1 cursor-pointer transition-colors"
              title="Cancel reply"
            >
              <span>Cancel</span>
              <X className="w-2.5 h-2.5" />
            </button>
          )}
        </div>

        {/* Right Header Controls: Presets Dropdown + Write/Preview Tabs */}
        <div className="flex items-center space-x-2">
          {/* Quick Presets Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowPresetsMenu((prev) => !prev)}
              className="inline-flex items-center space-x-1 px-2 py-1 rounded-lg text-[11px] font-medium bg-onedark-surface hover:bg-onedark-surface/80 border border-onedark-borderSubtle text-onedark-muted hover:text-onedark-fg transition-colors cursor-pointer"
              title="Insert common review templates"
            >
              <Sparkles className="w-3 h-3 text-onedark-yellow" />
              <span>Templates</span>
              <ChevronDown className="w-2.5 h-2.5 text-onedark-muted" />
            </button>

            {showPresetsMenu && (
              <div
                className="absolute right-0 top-full mt-1 w-56 rounded-xl border border-onedark-borderSubtle bg-onedark-surface/95 backdrop-blur-md shadow-lg p-1.5 z-20 space-y-0.5"
                onMouseLeave={() => setShowPresetsMenu(false)}
              >
                <div className="px-2 py-1 text-[10px] font-mono text-onedark-muted uppercase tracking-wider">
                  Review Templates
                </div>
                {presets.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => {
                      insertMarkdown(preset.text);
                      setShowPresetsMenu(false);
                    }}
                    className="w-full text-left px-2 py-1.5 rounded-lg text-xs hover:bg-onedark-darker text-onedark-fg flex items-center justify-between transition-colors cursor-pointer"
                    title={preset.title}
                  >
                    <span>{preset.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Write / Preview Tab Switcher */}
          <div className="flex items-center p-0.5 rounded-lg bg-onedark-surface border border-onedark-borderSubtle text-[11px] font-medium">
            <button
              type="button"
              onClick={() => setActiveTab('write')}
              className={`px-2.5 py-1 rounded-md transition-all cursor-pointer flex items-center space-x-1 ${
                activeTab === 'write'
                  ? 'bg-onedark-accent text-onedark-bg font-bold shadow-xs'
                  : 'text-onedark-muted hover:text-onedark-fg'
              }`}
            >
              <Edit3 className="w-3 h-3" />
              <span>Write</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('preview')}
              className={`px-2.5 py-1 rounded-md transition-all cursor-pointer flex items-center space-x-1 ${
                activeTab === 'preview'
                  ? 'bg-onedark-accent text-onedark-bg font-bold shadow-xs'
                  : 'text-onedark-muted hover:text-onedark-fg'
              }`}
            >
              <Eye className="w-3 h-3" />
              <span>Preview</span>
            </button>
          </div>
        </div>
      </div>

      {/* Replying-to Context Quote */}
      {replyingTo && (
        <div className="px-3.5 py-2 bg-onedark-surface/30 border-b border-onedark-borderSubtle flex items-center justify-between gap-2 text-[11px] text-onedark-muted">
          <div className="flex items-center space-x-2 truncate">
            <CornerDownRight className="w-3.5 h-3.5 text-onedark-accent flex-shrink-0" />
            <span className="italic truncate">&quot;{replyingTo.body.slice(0, 160)}...&quot;</span>
          </div>
        </div>
      )}

      {/* Formatting Action Toolbar (Visible in Write mode) */}
      {activeTab === 'write' && (
        <div className="flex items-center justify-between px-3 py-1.5 bg-onedark-surface/40 border-b border-onedark-borderSubtle text-onedark-muted overflow-x-auto gap-1">
          <div className="flex items-center space-x-1">
            <button
              type="button"
              onClick={() => insertMarkdown('**', '**', 'bold text')}
              className="p-1.5 rounded hover:bg-onedark-surface hover:text-onedark-fg transition-colors cursor-pointer"
              title="Bold (⌘+B)"
            >
              <Bold className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => insertMarkdown('*', '*', 'italic text')}
              className="p-1.5 rounded hover:bg-onedark-surface hover:text-onedark-fg transition-colors cursor-pointer"
              title="Italic (⌘+I)"
            >
              <Italic className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => insertMarkdown('`', '`', 'code')}
              className="p-1.5 rounded hover:bg-onedark-surface hover:text-onedark-fg transition-colors cursor-pointer font-mono"
              title="Inline Code (⌘+E)"
            >
              <Code className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => insertMarkdown('```ts\n', '\n```', '// code here')}
              className="p-1.5 rounded hover:bg-onedark-surface hover:text-onedark-fg transition-colors cursor-pointer font-mono text-[10.5px] font-bold"
              title="Code Block (```)"
            >
              {'{}'}
            </button>

            <div className="h-3.5 w-px bg-onedark-borderSubtle mx-1" />

            <button
              type="button"
              onClick={() => insertMarkdown('> ', '', 'quote')}
              className="p-1.5 rounded hover:bg-onedark-surface hover:text-onedark-fg transition-colors cursor-pointer"
              title="Blockquote (>)"
            >
              <Quote className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => insertMarkdown('- ', '', 'list item')}
              className="p-1.5 rounded hover:bg-onedark-surface hover:text-onedark-fg transition-colors cursor-pointer"
              title="Bulleted List (-)"
            >
              <List className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => insertMarkdown('1. ', '', 'first item')}
              className="p-1.5 rounded hover:bg-onedark-surface hover:text-onedark-fg transition-colors cursor-pointer"
              title="Numbered List (1.)"
            >
              <ListOrdered className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => insertMarkdown('- [ ] ', '', 'task item')}
              className="p-1.5 rounded hover:bg-onedark-surface hover:text-onedark-fg transition-colors cursor-pointer"
              title="Task Checklist (- [ ])"
            >
              <CheckSquare className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => insertMarkdown('[', '](https://...)', 'link title')}
              className="p-1.5 rounded hover:bg-onedark-surface hover:text-onedark-fg transition-colors cursor-pointer"
              title="Insert Link (⌘+K)"
            >
              <Link className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => insertMarkdown('```suggestion\n', '\n```', '// suggested change')}
              className="p-1.5 rounded hover:bg-onedark-surface hover:text-onedark-fg transition-colors cursor-pointer"
              title="Insert GitHub Code Suggestion"
            >
              <FileCode2 className="w-3.5 h-3.5 text-onedark-accent" />
            </button>
          </div>

          {/* Quick Mention Chips */}
          {distinctAuthors.length > 0 && (
            <div className="flex items-center space-x-1 pl-2 text-[10.5px]">
              <span className="text-onedark-muted/60 hidden md:inline">Mention:</span>
              {distinctAuthors.map((author) => (
                <button
                  key={author}
                  type="button"
                  onClick={() => insertMarkdown(`@${author} `)}
                  className="px-1.5 py-0.5 rounded bg-onedark-surface hover:bg-onedark-surface/80 border border-onedark-borderSubtle text-onedark-muted hover:text-onedark-fg font-mono transition-colors cursor-pointer"
                  title={`Mention @${author}`}
                >
                  @{author}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Main Editing / Preview Canvas */}
      <div className="p-3 bg-onedark-bg">
        {activeTab === 'write' ? (
          <textarea
            ref={textareaRef}
            id="pr-comment-composer-input"
            rows={4}
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              replyingTo
                ? `Reply to @${replyingTo.author}... (Supports Markdown, Math, & Suggestions)`
                : 'Leave a comment or review finding... (Supports Markdown, Math, & Suggestions)'
            }
            className="w-full bg-transparent text-xs text-onedark-fg placeholder-onedark-muted border-none outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:border-none shadow-none leading-relaxed resize-y min-h-[90px] font-sans"
            style={{ outline: 'none', border: 'none', boxShadow: 'none' }}
          />
        ) : (
          <div className="min-h-[90px] p-2.5 rounded-lg bg-onedark-darker/50 border border-onedark-borderSubtle text-onedark-fg text-[13px] leading-relaxed select-text">
            {commentText.trim() ? (
              <MarkdownRenderer content={commentText} />
            ) : (
              <div className="text-onedark-muted italic py-6 text-center text-xs">
                Nothing to preview yet. Switch to Write mode to type markdown.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Error & Success Alerts */}
      {postError && (
        <div className="px-3.5 py-2 bg-onedark-red/10 border-t border-onedark-red/20 text-[11px] text-onedark-red flex items-center space-x-1.5">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          <span>{postError}</span>
        </div>
      )}

      {postSuccess && (
        <div className="px-3.5 py-2 bg-onedark-green/10 border-t border-onedark-green/20 text-[11px] text-onedark-green flex items-center space-x-1.5">
          <Check className="w-3.5 h-3.5 flex-shrink-0" />
          <span>Comment posted successfully!</span>
        </div>
      )}

      {/* Bottom Footer: Stats, Shortcuts, and Primary Actions */}
      <div className="px-3.5 py-2.5 bg-onedark-surface/40 border-t border-onedark-borderSubtle flex items-center justify-between gap-2 flex-wrap text-[11px]">
        <div className="flex items-center space-x-2 text-onedark-muted">
          <span className="font-mono text-[10.5px]">
            {commentText.length} chars • {wordCount} words
          </span>
          <span className="hidden sm:inline-block font-mono text-[10px] px-1.5 py-0.5 rounded bg-onedark-surface border border-onedark-borderSubtle text-onedark-muted/80">
            ⌘+Enter to submit
          </span>
        </div>

        <div className="flex items-center space-x-2">
          {onAskAboutComment && commentText.trim().length > 10 && (
            <button
              type="button"
              onClick={() => {
                const prompt = `Please review and refine the following pull request comment for PR #${prNumber || ''}:\n\n${commentText}\n\nCheck for clarity, accuracy, and constructive engineering recommendations.`;
                onAskAboutComment(prompt);
              }}
              className="inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-onedark-accent hover:bg-onedark-accent/15 border border-onedark-accent/30 transition-all cursor-pointer shadow-2xs"
              title="Refine and review comment with Cyclode Agent"
            >
              <Sparkles className="w-3 h-3" />
              <span>Polish with Agent</span>
            </button>
          )}

          <button
            onClick={handlePost}
            disabled={isPosting || !commentText.trim()}
            className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-onedark-accent text-onedark-bg hover:brightness-110 active:scale-95 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
          >
            {isPosting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
            <span>{isPosting ? 'Posting...' : replyingTo ? 'Send Reply' : 'Comment'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export const PRCommentsSection: React.FC<PRCommentsSectionProps> = ({
  comments,
  prNumber,
  task,
  onJumpToDiff,
  onRefreshComments,
  onAskAboutComment,
  isSyncing = false,
  lastSyncedAt = null
}) => {
  const [filter, setFilter] = useState<'ALL' | 'CONVERSATION' | 'CODE' | 'REVIEWS'>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isRegex, setIsRegex] = useState<boolean>(false);
  const [replyingTo, setReplyingTo] = useState<PRCommentItem | null>(null);
  const [expandedDiffHunks, setExpandedDiffHunks] = useState<Record<string, boolean>>({});
  const [copiedPromptId, setCopiedPromptId] = useState<string | null>(null);
  const [collapsedComments, setCollapsedComments] = useState<Record<string, boolean>>({});

  const conversationCount = useMemo(() => comments.filter(c => c.type === 'conversation').length, [comments]);
  const codeCount = useMemo(() => comments.filter(c => c.type === 'code_comment').length, [comments]);
  const reviewCount = useMemo(() => comments.filter(c => c.type === 'review').length, [comments]);

  const grepMatcher = useMemo(() => {
    return createGrepMatcher(searchQuery, { isRegex });
  }, [searchQuery, isRegex]);

  const filteredComments = useMemo(() => {
    return comments.filter((c) => {
      if (filter === 'CONVERSATION' && c.type !== 'conversation') return false;
      if (filter === 'CODE' && c.type !== 'code_comment') return false;
      if (filter === 'REVIEWS' && c.type !== 'review') return false;
      if (searchQuery.trim()) {
        const matchesAuthor = grepMatcher.test(c.author);
        const matchesBody = grepMatcher.test(c.body);
        const matchesPath = grepMatcher.test(c.path);
        const matchesLine = c.line ? grepMatcher.test(String(c.line)) : false;
        return matchesAuthor || matchesBody || matchesPath || matchesLine;
      }
      return true;
    });
  }, [comments, filter, searchQuery, grepMatcher]);

  const isCommentCollapsed = useCallback((commentId: string, isBot: boolean, isReview: boolean, bodyLength: number): boolean => {
    if (collapsedComments[commentId] !== undefined) {
      return collapsedComments[commentId];
    }
    return isBot || (isReview && bodyLength > 300) || bodyLength > 500;
  }, [collapsedComments]);

  const toggleCollapse = useCallback((id: string, currentCollapsed: boolean) => {
    setCollapsedComments(prev => ({
      ...prev,
      [id]: !currentCollapsed
    }));
  }, []);

  const allCollapsed = useMemo(() => {
    if (filteredComments.length === 0) return false;
    return filteredComments.every((c) => {
      const isBot = (c.author || '').toLowerCase().includes('[bot]') || (c.author || '').toLowerCase() === 'coderabbitai';
      const isReview = c.type === 'review';
      return isCommentCollapsed(c.id, isBot, isReview, (c.body || '').length);
    });
  }, [filteredComments, isCommentCollapsed]);

  const toggleCollapseAll = useCallback(() => {
    const targetState = !allCollapsed;
    setCollapsedComments(prev => {
      const next: Record<string, boolean> = { ...prev };
      for (const c of filteredComments) {
        next[c.id] = targetState;
      }
      return next;
    });
  }, [allCollapsed, filteredComments]);

  const toggleDiffHunk = (commentId: string) => {
    setExpandedDiffHunks(prev => ({ ...prev, [commentId]: !prev[commentId] }));
  };

  return (
    <div className="space-y-4 font-sans text-xs">
      {/* Top Controls: Category Tabs, Search, and Auto-Sync Status */}
      <div className="flex flex-col gap-2.5 bg-onedark-surface/40 p-3 rounded-xl border border-onedark-borderSubtle">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Filter Chips + Expand/Collapse All */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => setFilter('ALL')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer flex items-center space-x-1.5 ${
                filter === 'ALL'
                  ? 'bg-onedark-accent text-onedark-bg font-semibold shadow-xs'
                  : 'bg-onedark-surface text-onedark-muted hover:text-onedark-fg border border-onedark-borderSubtle'
              }`}
            >
              <span>All</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${filter === 'ALL' ? 'bg-onedark-bg/30 text-onedark-bg font-bold' : 'bg-onedark-darker text-onedark-muted'}`}>
                {comments.length}
              </span>
            </button>

            <button
              onClick={() => setFilter('CONVERSATION')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer flex items-center space-x-1.5 ${
                filter === 'CONVERSATION'
                  ? 'bg-onedark-accent text-onedark-bg font-semibold shadow-xs'
                  : 'bg-onedark-surface text-onedark-muted hover:text-onedark-fg border border-onedark-borderSubtle'
              }`}
            >
              <MessageSquare className="w-3 h-3" />
              <span>Conversation</span>
              {conversationCount > 0 && (
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${filter === 'CONVERSATION' ? 'bg-onedark-bg/30 text-onedark-bg font-bold' : 'bg-onedark-darker text-onedark-muted'}`}>
                  {conversationCount}
                </span>
              )}
            </button>

            <button
              onClick={() => setFilter('CODE')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer flex items-center space-x-1.5 ${
                filter === 'CODE'
                  ? 'bg-onedark-accent text-onedark-bg font-semibold shadow-xs'
                  : 'bg-onedark-surface text-onedark-muted hover:text-onedark-fg border border-onedark-borderSubtle'
              }`}
            >
              <FileCode2 className="w-3 h-3 text-onedark-blue" />
              <span>Code Review</span>
              {codeCount > 0 && (
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${filter === 'CODE' ? 'bg-onedark-bg/30 text-onedark-bg font-bold' : 'bg-onedark-darker text-onedark-muted'}`}>
                  {codeCount}
                </span>
              )}
            </button>

            <button
              onClick={() => setFilter('REVIEWS')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer flex items-center space-x-1.5 ${
                filter === 'REVIEWS'
                  ? 'bg-onedark-accent text-onedark-bg font-semibold shadow-xs'
                  : 'bg-onedark-surface text-onedark-muted hover:text-onedark-fg border border-onedark-borderSubtle'
              }`}
            >
              <ShieldCheck className="w-3 h-3 text-onedark-green" />
              <span>Reviews</span>
              {reviewCount > 0 && (
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${filter === 'REVIEWS' ? 'bg-onedark-bg/30 text-onedark-bg font-bold' : 'bg-onedark-darker text-onedark-muted'}`}>
                  {reviewCount}
                </span>
              )}
            </button>

            {filteredComments.length > 0 && (
              <>
                <div className="h-4 w-px bg-onedark-borderSubtle mx-0.5 hidden sm:block" />
                <button
                  type="button"
                  onClick={toggleCollapseAll}
                  className="px-2 py-1 rounded-lg text-xs font-medium bg-onedark-surface hover:bg-onedark-surface/80 border border-onedark-borderSubtle text-onedark-muted hover:text-onedark-fg transition-all cursor-pointer flex items-center space-x-1.5 shadow-2xs"
                  title={allCollapsed ? "Expand all comments" : "Collapse all comments"}
                >
                  <ChevronsUpDown className="w-3 h-3 text-onedark-accent" />
                  <span>{allCollapsed ? 'Expand All' : 'Collapse All'}</span>
                </button>
              </>
            )}
          </div>

          {/* Auto-Sync Indicator & Actions */}
          <div className="flex items-center space-x-2 text-[11px] text-onedark-muted flex-wrap gap-y-1">
            {onAskAboutComment && comments.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  const allFeedbackSummary = comments
                    .map(c => `[Comment by @${c.author || 'reviewer'}${c.path ? ` on ${c.path}:${c.line || ''}` : ''}]:\n${c.body}`)
                    .join('\n\n---\n\n');
                  const prompt = `Please review and auto-fix all unresolved feedback and review comments for PR #${prNumber || ''}:\n\n${allFeedbackSummary}\n\nInspect the workspace files, fix all identified issues, run verification tests, and report the resolved changes.`;
                  onAskAboutComment(prompt);
                }}
                className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-onedark-accent/15 hover:bg-onedark-accent/25 text-onedark-accent border border-onedark-accent/30 transition-all cursor-pointer shadow-2xs"
                title="Dispatch all PR review comments to Agent to automatically fix in workspace"
              >
                <Zap className="w-3 h-3" />
                <span>Auto-Fix All Comments</span>
              </button>
            )}

            <span className="flex items-center space-x-1 font-mono">
              <span className={`w-1.5 h-1.5 rounded-full ${isSyncing ? 'bg-onedark-yellow animate-ping' : 'bg-onedark-green'}`} />
              <span>{isSyncing ? 'Syncing...' : lastSyncedAt ? `Synced ${formatCommentTimeAgo(lastSyncedAt.toISOString())}` : 'Live auto-sync active'}</span>
            </span>

            {onRefreshComments && (
              <button
                onClick={() => onRefreshComments()}
                disabled={isSyncing}
                title="Sync latest comments now"
                className="p-1 rounded-md bg-onedark-surface hover:bg-onedark-surface/80 border border-onedark-borderSubtle text-onedark-fg hover:text-onedark-fgBright transition-colors cursor-pointer disabled:opacity-50"
              >
                <RotateCw className={`w-3 h-3 ${isSyncing ? 'animate-spin text-onedark-accent' : ''}`} />
              </button>
            )}
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative w-full">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-onedark-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={isRegex ? "Grep comments, reviews, paths (/regex/)..." : "Search discussion comments, code reviews, authors..."}
            className={`w-full pl-8 pr-14 py-1.5 rounded-lg bg-onedark-darker border ${
              isRegex
                ? grepMatcher.isValid
                  ? 'border-onedark-purple/60 focus:border-onedark-purple text-onedark-fg'
                  : 'border-onedark-red/60 focus:border-onedark-red text-onedark-red'
                : 'border-onedark-borderSubtle focus:border-onedark-accent/60 text-onedark-fg'
            } text-xs placeholder-onedark-muted focus:outline-hidden`}
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="p-0.5 rounded text-onedark-muted hover:text-onedark-fg cursor-pointer"
                title="Clear filter"
              >
                <X className="w-3 h-3" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setIsRegex((prev) => !prev)}
              className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-bold transition-all cursor-pointer ${
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
      </div>

      {/* Empty State */}
      {filteredComments.length === 0 && (
        <div className="p-8 rounded-xl border border-onedark-borderSubtle bg-onedark-surface/30 text-center text-onedark-muted space-y-2">
          <MessageSquare className="w-8 h-8 mx-auto opacity-30 text-onedark-accent" />
          <p className="font-medium text-onedark-fgBright">No comments match the filter</p>
          <p className="text-[11px]">
            {comments.length === 0
              ? 'No comments have been posted to this pull request yet. Start the conversation below.'
              : 'Try selecting a different filter chip or clearing the search query.'}
          </p>
        </div>
      )}

      {/* Comments Feed */}
      <div className="space-y-3">
        {filteredComments.map((c) => {
          const isCodeComment = c.type === 'code_comment';
          const isReview = c.type === 'review';
          const isBot = (c.author || '').toLowerCase().includes('[bot]') || (c.author || '').toLowerCase() === 'coderabbitai';
          const botMeta = parseBotReviewComment(c.body);
          const collapsed = isCommentCollapsed(c.id, isBot, isReview, (c.body || '').length);
          const lineCount = c.body ? c.body.split('\n').length : 0;

          return (
            <div
              key={c.id}
              id={`comment-item-${c.id}`}
              className={`rounded-xl border transition-all overflow-hidden scroll-mt-4 ${
                isReview
                  ? c.review_state === 'APPROVED'
                    ? 'border-l-4 border-l-onedark-green border-onedark-green/30 bg-onedark-green/5 shadow-2xs'
                    : c.review_state === 'CHANGES_REQUESTED'
                    ? 'border-l-4 border-l-onedark-red border-onedark-red/30 bg-onedark-red/5 shadow-2xs'
                    : 'border-l-4 border-l-onedark-blue border-onedark-borderSubtle bg-onedark-surface/30'
                  : isCodeComment
                  ? isBot
                    ? 'border-l-4 border-l-onedark-purple border-onedark-borderSubtle bg-onedark-surface/40'
                    : 'border-l-4 border-l-onedark-blue border-onedark-borderSubtle bg-onedark-surface/40'
                  : 'border border-onedark-borderSubtle bg-onedark-surface/40'
              }`}
            >
              {/* Comment Header - Clickable to toggle collapse */}
              <div
                onClick={() => toggleCollapse(c.id, collapsed)}
                className="flex items-center justify-between px-3.5 py-2.5 border-b border-onedark-borderSubtle bg-onedark-surface/60 gap-2 cursor-pointer hover:bg-onedark-surface/80 transition-colors select-none"
              >
                <div className="flex items-center space-x-2.5 min-w-0 flex-wrap gap-y-1">
                  {/* Chevron Toggle Button */}
                  <span className="text-onedark-muted hover:text-onedark-fg transition-transform flex-shrink-0">
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${collapsed ? '-rotate-90 text-onedark-muted' : 'text-onedark-fg'}`} />
                  </span>

                  {c.author_avatar ? (
                    <img
                      src={c.author_avatar}
                      alt={c.author}
                      className="w-5 h-5 rounded-full ring-1 ring-onedark-borderSubtle flex-shrink-0"
                    />
                  ) : (
                    <div className="w-5 h-5 rounded-full bg-onedark-surface flex items-center justify-center font-mono text-[10px] text-onedark-accent flex-shrink-0">
                      {c.author ? c.author[0].toUpperCase() : 'U'}
                    </div>
                  )}

                  <span className="font-bold text-onedark-fgBright text-xs truncate">
                    @{c.author}
                  </span>

                  {/* Role / Association Badges */}
                  {isBot ? (
                    <span className="px-1.5 py-0.2 rounded text-[9.5px] font-mono tracking-tight uppercase bg-onedark-purple/15 text-onedark-purple border border-onedark-purple/30 font-bold flex items-center space-x-1">
                      <Bot className="w-2.5 h-2.5" />
                      <span>BOT</span>
                    </span>
                  ) : c.author_association && c.author_association !== 'NONE' && (
                    <span className={`px-1.5 py-0.2 rounded text-[9.5px] font-mono tracking-tight uppercase border ${
                      c.author_association === 'MEMBER'
                        ? 'bg-onedark-blue/15 text-onedark-blue border-onedark-blue/30 font-semibold'
                        : c.author_association === 'OWNER' || c.author_association === 'AUTHOR'
                        ? 'bg-onedark-green/15 text-onedark-green border-onedark-green/30 font-semibold'
                        : 'bg-onedark-surface text-onedark-muted border-onedark-borderSubtle'
                    }`}>
                      {c.author_association.toLowerCase()}
                    </span>
                  )}

                  {/* Review Decision Badge */}
                  {isReview && (
                    <span
                      className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded-md text-[10px] font-bold ${
                        c.review_state === 'APPROVED'
                          ? 'bg-onedark-green/20 text-onedark-green border border-onedark-green/30'
                          : c.review_state === 'CHANGES_REQUESTED'
                          ? 'bg-onedark-red/20 text-onedark-red border border-onedark-red/30'
                          : 'bg-onedark-blue/20 text-onedark-blue border border-onedark-blue/30'
                      }`}
                    >
                      {c.review_state === 'APPROVED' && <ShieldCheck className="w-3 h-3" />}
                      {c.review_state === 'CHANGES_REQUESTED' && <AlertCircle className="w-3 h-3" />}
                      {c.review_state === 'COMMENTED' && <MessageSquare className="w-3 h-3" />}
                      <span>{c.review_state === 'CHANGES_REQUESTED' ? 'Changes Requested' : c.review_state}</span>
                    </span>
                  )}

                  {isCodeComment && (
                    <span className="inline-flex items-center space-x-1 px-1.5 py-0.2 rounded text-[10px] font-medium bg-onedark-blue/15 text-onedark-blue border border-onedark-blue/25">
                      <FileCode2 className="w-2.5 h-2.5" />
                      <span>Inline Review</span>
                    </span>
                  )}

                  {/* Collapsed Header Badges for immediate high-level summary */}
                  {collapsed && (
                    <>
                      {botMeta.warningsCount !== undefined && botMeta.warningsCount > 0 && (
                        <span className="px-1.5 py-0.2 rounded text-[9.5px] font-bold bg-onedark-red/15 text-onedark-red border border-onedark-red/30 flex items-center space-x-1">
                          <AlertTriangle className="w-2.5 h-2.5" />
                          <span>{botMeta.warningsCount} warnings</span>
                        </span>
                      )}
                      {botMeta.category && (
                        <span className={`px-1.5 py-0.2 rounded text-[9.5px] font-medium border ${botMeta.category.colorClass}`}>
                          {botMeta.category.label}
                        </span>
                      )}
                      {botMeta.severity && (
                        <span className={`px-1.5 py-0.2 rounded text-[9.5px] font-bold border ${botMeta.severity.colorClass}`}>
                          {botMeta.severity.label}
                        </span>
                      )}
                    </>
                  )}
                </div>

                <div className="flex items-center space-x-2 text-onedark-muted flex-shrink-0">
                  {lineCount > 1 && (
                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-onedark-darker text-onedark-muted border border-onedark-borderSubtle hidden sm:inline-block">
                      {lineCount} lines
                    </span>
                  )}
                  <span className="text-[11px] font-mono">
                    {formatCommentTimeAgo(c.created_at)}
                  </span>
                  {c.html_url && (
                    <a
                      href={c.html_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="View on GitHub"
                      onClick={(e) => e.stopPropagation()}
                      className="hover:text-onedark-fgBright transition-colors p-0.5"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </div>

              {/* Collapsed Preview Snippet */}
              {collapsed ? (
                <div
                  onClick={() => toggleCollapse(c.id, collapsed)}
                  className="px-4 py-2.5 bg-onedark-darker/30 hover:bg-onedark-darker/60 transition-colors cursor-pointer flex items-center justify-between gap-3 text-[12px] text-onedark-muted select-none"
                >
                  <div className="flex items-center space-x-2 truncate min-w-0">
                    {c.path && (
                      <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded bg-onedark-surface border border-onedark-borderSubtle text-[10.5px] font-mono text-onedark-accent font-semibold flex-shrink-0">
                        <FileCode2 className="w-3 h-3" />
                        <span className="truncate max-w-[140px]">{c.path.split('/').pop()}</span>
                        {c.line && <span>:{c.line}</span>}
                      </span>
                    )}
                    <span className="truncate text-onedark-fg/75">
                      {botMeta.summarySnippet || (c.body || '').replace(/[*_`#]/g, '').trim().slice(0, 140) || 'Click to view comment contents...'}
                    </span>
                  </div>

                  <div className="flex items-center space-x-2 flex-shrink-0 text-[11px]">
                    {onJumpToDiff && c.path && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onJumpToDiff(c.path!, c.line);
                        }}
                        className="px-2 py-0.5 rounded text-[10.5px] font-medium bg-onedark-accent/15 text-onedark-accent hover:bg-onedark-accent/25 border border-onedark-accent/30 transition-colors cursor-pointer"
                      >
                        Diff
                      </button>
                    )}
                    <span className="text-onedark-muted/60 text-[10.5px]">Click to expand</span>
                  </div>
                </div>
              ) : (
                /* Expanded Content */
                <>
                  {/* Bot Metadata Chip Bar (Category, Severity, Effort, Warnings) */}
                  {(botMeta.category || botMeta.severity || botMeta.effort || (botMeta.warningsCount !== undefined && botMeta.warningsCount > 0)) && (
                    <div className="flex items-center gap-1.5 flex-wrap px-3.5 pt-2.5 pb-1 bg-onedark-surface/30 border-b border-onedark-borderSubtle">
                      {botMeta.warningsCount !== undefined && botMeta.warningsCount > 0 && (
                        <span className="px-2 py-0.5 rounded-md font-mono text-[10.5px] font-bold bg-onedark-red/15 text-onedark-red border border-onedark-red/30 flex items-center space-x-1">
                          <AlertTriangle className="w-3 h-3" />
                          <span>{botMeta.warningsCount} warnings</span>
                        </span>
                      )}
                      {botMeta.category && (
                        <span className={`px-2 py-0.5 rounded-md font-mono text-[10.5px] font-semibold border ${botMeta.category.colorClass}`}>
                          {botMeta.category.label}
                        </span>
                      )}
                      {botMeta.severity && (
                        <span className={`px-2 py-0.5 rounded-md font-mono text-[10.5px] font-bold border ${botMeta.severity.colorClass}`}>
                          {botMeta.severity.label}
                        </span>
                      )}
                      {botMeta.effort && (
                        <span className={`px-2 py-0.5 rounded-md font-mono text-[10.5px] font-medium border ${botMeta.effort.colorClass}`}>
                          {botMeta.effort.label}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Bot Configuration & Run Diagnostics Disclosure Tray */}
                  {botMeta.botConfig && (
                    <details className="group mx-3.5 mt-2.5 rounded-lg border border-onedark-borderSubtle bg-onedark-darker/60 text-[11px] overflow-hidden">
                      <summary className="px-2.5 py-1.5 font-mono text-onedark-muted hover:text-onedark-fg cursor-pointer select-none flex items-center justify-between transition-colors">
                        <span className="flex items-center space-x-1.5">
                          <Terminal className="w-3 h-3 text-onedark-purple" />
                          <span>Bot Review Diagnostics & Configuration</span>
                        </span>
                        <span className="text-[10px] text-onedark-muted group-open:rotate-180 transition-transform">▼</span>
                      </summary>
                      <div className="p-2.5 pt-1.5 border-t border-onedark-borderSubtle grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] font-mono text-onedark-fg/80">
                        {botMeta.botConfig.runId && (
                          <div><span className="text-onedark-muted">Run ID:</span> <span className="text-onedark-purple font-semibold">{botMeta.botConfig.runId}</span></div>
                        )}
                        {botMeta.botConfig.profile && (
                          <div><span className="text-onedark-muted">Profile:</span> <span className="text-onedark-blue font-medium">{botMeta.botConfig.profile}</span></div>
                        )}
                        {botMeta.botConfig.plan && (
                          <div><span className="text-onedark-muted">Plan:</span> <span className="text-onedark-green font-medium">{botMeta.botConfig.plan}</span></div>
                        )}
                        {botMeta.botConfig.configUsed && (
                          <div className="col-span-full"><span className="text-onedark-muted">Config:</span> {botMeta.botConfig.configUsed}</div>
                        )}
                        {botMeta.botConfig.remainingReviews && (
                          <div className="col-span-full"><span className="text-onedark-muted">Review Availability:</span> {botMeta.botConfig.remainingReviews}</div>
                        )}
                      </div>
                    </details>
                  )}

                  {/* Code Comment Anchor & Diff Snippet Context */}
                  {isCodeComment && (c.diff_hunk || c.path) && (
                    <div className="px-3.5 py-2 bg-onedark-darker/40 border-b border-onedark-borderSubtle">
                      {c.diff_hunk ? (
                        <MiniDiffHunkViewer
                          diffHunk={c.diff_hunk}
                          filePath={c.path}
                          targetLine={c.line}
                          onJumpToDiff={onJumpToDiff}
                        />
                      ) : c.path ? (
                        <div className="flex items-center justify-between text-xs font-mono">
                          <div className="flex items-center space-x-1.5 text-onedark-fg truncate">
                            <FileCode2 className="w-3.5 h-3.5 text-onedark-accent flex-shrink-0" />
                            <span className="font-semibold text-onedark-fgBright truncate">{c.path}</span>
                            {c.line && <span className="text-onedark-accent">:{c.line}</span>}
                          </div>
                          {onJumpToDiff && (
                            <button
                              onClick={() => onJumpToDiff(c.path!, c.line)}
                              className="px-2 py-0.5 rounded text-[10.5px] font-medium bg-onedark-accent/15 text-onedark-accent hover:bg-onedark-accent/25 border border-onedark-accent/30 transition-colors cursor-pointer"
                            >
                              Jump to Diff
                            </button>
                          )}
                        </div>
                      ) : null}
                    </div>
                  )}

                  {/* Comment Body Markdown & Actionable AI Prompt Card */}
                  <div className="px-4 py-3 text-onedark-fg text-[13.5px] leading-relaxed select-text space-y-3">
                    <MarkdownRenderer content={botMeta.cleanBody || c.body || '*No content provided.*'} />

                    {/* Structured AI Agent Prompt Box if present */}
                    {botMeta.aiPrompt && (
                      <div className="mt-3 p-3 rounded-xl border border-onedark-purple/30 bg-onedark-darker/90 space-y-2 shadow-xs">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center space-x-1.5 text-onedark-purple font-mono text-xs font-bold">
                            <Bot className="w-3.5 h-3.5" />
                            <span>Prompt for AI Agents</span>
                          </div>
                          <div className="flex items-center space-x-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard.writeText(botMeta.aiPrompt!);
                                setCopiedPromptId(c.id);
                                setTimeout(() => setCopiedPromptId(null), 2000);
                              }}
                              className="inline-flex items-center space-x-1 px-2 py-1 rounded bg-onedark-surface hover:bg-onedark-surface/80 border border-onedark-borderSubtle text-[10.5px] font-mono text-onedark-muted hover:text-onedark-fg transition-colors cursor-pointer"
                              title="Copy AI Prompt"
                            >
                              {copiedPromptId === c.id ? <Check className="w-3 h-3 text-onedark-green" /> : <Copy className="w-3 h-3" />}
                              <span>{copiedPromptId === c.id ? 'Copied' : 'Copy'}</span>
                            </button>

                            {onAskAboutComment && (
                              <button
                                type="button"
                                onClick={() => onAskAboutComment(botMeta.aiPrompt!)}
                                className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-onedark-accent hover:bg-onedark-accent/90 text-onedark-darker font-bold text-[11px] shadow-xs active:scale-95 transition-all cursor-pointer"
                                title="Execute prompt directly in Chat Workstation"
                              >
                                <Zap className="w-3 h-3 fill-current" />
                                <span>Fix with Cyclode</span>
                              </button>
                            )}
                          </div>
                        </div>

                        <pre className="p-2.5 rounded-lg bg-onedark-darker border border-onedark-borderSubtle text-[11px] font-mono text-onedark-fgBright whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto select-text">
                          {botMeta.aiPrompt}
                        </pre>
                      </div>
                    )}
                  </div>

                  {/* Comment Footer: Reactions & Actions */}
                  <div className="px-3.5 py-2 border-t border-onedark-borderSubtle bg-onedark-surface/20 rounded-b-xl flex items-center justify-between gap-2">
                    {/* Reaction Counters */}
                    <div className="flex items-center space-x-1.5 flex-wrap">
                      {c.reactions && Object.entries(c.reactions).map(([emojiKey, count]) => {
                        if (typeof count !== 'number' || count <= 0) return null;
                        const emojiIcon = emojiKey === '+1' ? '👍' : emojiKey === '-1' ? '👎' : emojiKey === 'heart' ? '❤️' : emojiKey === 'laugh' ? '😄' : emojiKey === 'rocket' ? '🚀' : emojiKey === 'eyes' ? '👀' : '🎉';
                        return (
                          <span
                            key={emojiKey}
                            className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded-md bg-onedark-surface border border-onedark-borderSubtle text-[10px] text-onedark-fg font-mono"
                          >
                            <span>{emojiIcon}</span>
                            <span>{count}</span>
                          </span>
                        );
                      })}
                    </div>

                    {/* Right Action Buttons: Fix with Agent + Reply */}
                    <div className="flex items-center space-x-1.5">
                      {onAskAboutComment && (
                        <button
                          type="button"
                          onClick={() => {
                            const remediationPrompt = botMeta.aiPrompt || (
                              `Please inspect and resolve the pull request review finding from @${c.author} on \`${c.path || 'active pull request'}\`${c.line ? ` (line ${c.line})` : ''}:\n\n` +
                              `> ${(botMeta.cleanBody || c.body).slice(0, 300).replace(/\n/g, '\n> ')}\n\n` +
                              `Review the repository code in the workspace and apply a verified fix with tests.`
                            );
                            onAskAboutComment(remediationPrompt);
                          }}
                          className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-md text-[11px] font-semibold text-onedark-accent hover:bg-onedark-accent/15 border border-onedark-accent/30 transition-colors cursor-pointer shadow-2xs"
                          title="Ask Cyclode Agent to fix this issue"
                        >
                          <Zap className="w-3 h-3" />
                          <span>Fix with Agent</span>
                        </button>
                      )}

                      {task?.id && (
                        <button
                          type="button"
                          onClick={() => {
                            setReplyingTo(c);
                            const textarea = document.getElementById('pr-comment-composer-input');
                            if (textarea) textarea.focus();
                          }}
                          className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-md text-[11px] font-medium text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/60 transition-colors cursor-pointer"
                        >
                          <CornerDownRight className="w-3 h-3" />
                          <span>Reply</span>
                        </button>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Interactive Rich Comment Composer */}
      {task?.id && prNumber && (
        <PRCommentComposer
          prNumber={prNumber}
          taskId={task.id}
          replyingTo={replyingTo}
          onCancelReply={() => setReplyingTo(null)}
          onCommentPosted={onRefreshComments}
          onAskAboutComment={onAskAboutComment}
          comments={comments}
        />
      )}
    </div>
  );
};

export interface PRReviewDecisionModalProps {
  isOpen: boolean;
  onClose: () => void;
  prNumber: number;
  prTitle?: string;
  initialEvent?: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
  onSubmitDecision: (event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT', body: string) => Promise<void>;
  isLoading?: boolean;
  isAuthor?: boolean;
}

export const PRReviewDecisionModal: React.FC<PRReviewDecisionModalProps> = ({
  isOpen,
  onClose,
  prNumber,
  prTitle,
  initialEvent = 'APPROVE',
  onSubmitDecision,
  isLoading = false,
  isAuthor = false
}) => {
  const [event, setEvent] = useState<'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'>(
    isAuthor ? 'COMMENT' : initialEvent
  );
  const [body, setBody] = useState<string>('');

  useEffect(() => {
    if (isOpen) {
      setEvent(isAuthor ? 'COMMENT' : initialEvent);
      setBody('');
    }
  }, [isOpen, initialEvent, isAuthor]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmitDecision(event, body);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-onedark-darker border border-onedark-border rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden text-onedark-fg font-sans">
        {/* Header */}
        <div className="p-4 bg-onedark-surface/60 border-b border-onedark-borderSubtle flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-7 h-7 rounded-lg bg-onedark-accent/15 border border-onedark-accent/30 flex items-center justify-center text-onedark-accent">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-onedark-fgBright">
                {isAuthor ? 'Add Discussion Comment' : 'Submit Code Review'}
              </h3>
              <p className="text-[11px] text-onedark-muted font-mono truncate max-w-sm">
                #{prNumber} {prTitle ? `• ${prTitle}` : ''}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4 text-xs">
          {/* Verdict Radio Option Tiles */}
          <div className="space-y-2">
            <label className="text-[11px] font-semibold text-onedark-muted uppercase tracking-wider">
              {isAuthor ? 'Action' : 'Review Verdict'}
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                disabled={isAuthor}
                onClick={() => !isAuthor && setEvent('APPROVE')}
                title={isAuthor ? 'Authors cannot approve their own pull request' : 'Approve merging'}
                className={`p-2.5 rounded-xl border text-left transition-all flex flex-col justify-between space-y-1.5 ${
                  isAuthor
                    ? 'opacity-35 cursor-not-allowed bg-onedark-surface/20 border-onedark-borderSubtle/50 text-onedark-muted'
                    : event === 'APPROVE'
                    ? 'bg-onedark-green/15 border-onedark-green/60 text-onedark-green ring-1 ring-onedark-green/30 cursor-pointer'
                    : 'bg-onedark-surface/50 border-onedark-borderSubtle text-onedark-fg hover:bg-onedark-surface cursor-pointer'
                }`}
              >
                <div className="flex items-center justify-between">
                  <CheckCircle2 className="w-4 h-4 text-onedark-green" />
                  {event === 'APPROVE' && <span className="w-1.5 h-1.5 rounded-full bg-onedark-green" />}
                </div>
                <div>
                  <div className="font-bold text-[12px]">Approve</div>
                  <div className="text-[10px] text-onedark-muted leading-tight mt-0.5">
                    {isAuthor ? 'Unavailable for author' : 'Submit feedback and approve merging'}
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setEvent('COMMENT')}
                className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between space-y-1.5 ${
                  event === 'COMMENT'
                    ? 'bg-onedark-accent/15 border-onedark-accent/60 text-onedark-accent ring-1 ring-onedark-accent/30'
                    : 'bg-onedark-surface/50 border-onedark-borderSubtle text-onedark-fg hover:bg-onedark-surface'
                }`}
              >
                <div className="flex items-center justify-between">
                  <MessageSquare className="w-4 h-4 text-onedark-accent" />
                  {event === 'COMMENT' && <span className="w-1.5 h-1.5 rounded-full bg-onedark-accent" />}
                </div>
                <div>
                  <div className="font-bold text-[12px]">Comment</div>
                  <div className="text-[10px] text-onedark-muted leading-tight mt-0.5">Submit general discussion notes</div>
                </div>
              </button>

              <button
                type="button"
                disabled={isAuthor}
                onClick={() => !isAuthor && setEvent('REQUEST_CHANGES')}
                title={isAuthor ? 'Authors cannot request changes from themselves' : 'Require changes before merging'}
                className={`p-2.5 rounded-xl border text-left transition-all flex flex-col justify-between space-y-1.5 ${
                  isAuthor
                    ? 'opacity-35 cursor-not-allowed bg-onedark-surface/20 border-onedark-borderSubtle/50 text-onedark-muted'
                    : event === 'REQUEST_CHANGES'
                    ? 'bg-onedark-red/15 border-onedark-red/60 text-onedark-red ring-1 ring-onedark-red/30 cursor-pointer'
                    : 'bg-onedark-surface/50 border-onedark-borderSubtle text-onedark-fg hover:bg-onedark-surface cursor-pointer'
                }`}
              >
                <div className="flex items-center justify-between">
                  <AlertCircle className="w-4 h-4 text-onedark-red" />
                  {event === 'REQUEST_CHANGES' && <span className="w-1.5 h-1.5 rounded-full bg-onedark-red" />}
                </div>
                <div>
                  <div className="font-bold text-[12px]">Request Changes</div>
                  <div className="text-[10px] text-onedark-muted leading-tight mt-0.5">
                    {isAuthor ? 'Unavailable for author' : 'Require changes before merging'}
                  </div>
                </div>
              </button>
            </div>
          </div>

          {/* Feedback Body Textarea */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-onedark-muted uppercase tracking-wider flex items-center justify-between">
              <span>Review Summary / Comments</span>
              <span className="text-[10px] text-onedark-muted/60 font-normal">Markdown supported</span>
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={
                event === 'APPROVE'
                  ? 'LGTM! Great work on the architecture and defensive checks...'
                  : event === 'REQUEST_CHANGES'
                  ? 'Please address the following comments before this PR can be merged...'
                  : 'Overall observations on the patch...'
              }
              rows={4}
              className="w-full bg-onedark-bg border border-onedark-border rounded-xl p-3 text-xs text-onedark-fg placeholder:text-onedark-muted/60 focus:outline-none focus:border-onedark-accent leading-relaxed font-mono"
            />
          </div>

          {/* Modal Footer */}
          <div className="pt-2 border-t border-onedark-borderSubtle flex items-center justify-end space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold text-white shadow-xs transition-all flex items-center space-x-1.5 cursor-pointer disabled:opacity-50 ${
                event === 'APPROVE'
                  ? 'bg-onedark-green hover:bg-onedark-green/90'
                  : event === 'REQUEST_CHANGES'
                  ? 'bg-onedark-red hover:bg-onedark-red/90'
                  : 'bg-onedark-accent hover:bg-onedark-accentHover'
              }`}
            >
              {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>
                {isLoading
                  ? 'Submitting...'
                  : isAuthor
                  ? 'Post Comment'
                  : event === 'APPROVE'
                  ? 'Submit Approval'
                  : event === 'REQUEST_CHANGES'
                  ? 'Submit Change Request'
                  : 'Submit Review'}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export interface PRMergeModalProps {
  isOpen: boolean;
  onClose: () => void;
  prNumber: number;
  prTitle?: string;
  headBranch?: string;
  baseBranch?: string;
  onConfirmMerge: (method: 'squash' | 'merge' | 'rebase', title?: string, message?: string) => Promise<void>;
  isLoading?: boolean;
}

export const PRMergeModal: React.FC<PRMergeModalProps> = ({
  isOpen,
  onClose,
  prNumber,
  prTitle = '',
  headBranch = 'feature',
  baseBranch = 'main',
  onConfirmMerge,
  isLoading = false
}) => {
  const [method, setMethod] = useState<'squash' | 'merge' | 'rebase'>('squash');
  const [commitTitle, setCommitTitle] = useState<string>('');
  const [commitMessage, setCommitMessage] = useState<string>('');

  useEffect(() => {
    if (isOpen) {
      setCommitTitle(`${prTitle} (#${prNumber})`);
      setCommitMessage(`Squash-merge pull request #${prNumber} from ${headBranch}`);
    }
  }, [isOpen, prTitle, prNumber, headBranch]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onConfirmMerge(method, commitTitle, commitMessage);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-onedark-darker border border-onedark-border rounded-2xl w-full max-w-md shadow-2xl overflow-hidden text-onedark-fg font-sans">
        {/* Header */}
        <div className="p-4 bg-onedark-surface/60 border-b border-onedark-borderSubtle flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-7 h-7 rounded-lg bg-onedark-purple/15 border border-onedark-purple/30 flex items-center justify-center text-onedark-purple">
              <GitMerge className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-onedark-fgBright">Merge Pull Request</h3>
              <p className="text-[11px] text-onedark-muted font-mono truncate">
                #{prNumber} into <span className="text-onedark-fgBright">{baseBranch}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4 text-xs">
          {/* Merge Strategy Options */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-onedark-muted uppercase tracking-wider">
              Merge Strategy
            </label>
            <div className="space-y-1.5">
              <button
                type="button"
                onClick={() => setMethod('squash')}
                className={`w-full p-2.5 rounded-xl border text-left transition-all cursor-pointer flex items-start justify-between ${
                  method === 'squash'
                    ? 'bg-onedark-purple/15 border-onedark-purple/60 text-onedark-fgBright ring-1 ring-onedark-purple/30'
                    : 'bg-onedark-surface/40 border-onedark-borderSubtle text-onedark-muted hover:bg-onedark-surface hover:text-onedark-fg'
                }`}
              >
                <div>
                  <div className="font-semibold text-xs text-onedark-fgBright">Squash and merge</div>
                  <div className="text-[10.5px] text-onedark-muted mt-0.5">Combine all commits from this PR into one single commit on {baseBranch}.</div>
                </div>
                {method === 'squash' && <Check className="w-4 h-4 text-onedark-purple flex-shrink-0 mt-0.5" />}
              </button>

              <button
                type="button"
                onClick={() => setMethod('rebase')}
                className={`w-full p-2.5 rounded-xl border text-left transition-all cursor-pointer flex items-start justify-between ${
                  method === 'rebase'
                    ? 'bg-onedark-purple/15 border-onedark-purple/60 text-onedark-fgBright ring-1 ring-onedark-purple/30'
                    : 'bg-onedark-surface/40 border-onedark-borderSubtle text-onedark-muted hover:bg-onedark-surface hover:text-onedark-fg'
                }`}
              >
                <div>
                  <div className="font-semibold text-xs text-onedark-fgBright">Rebase and merge</div>
                  <div className="text-[10.5px] text-onedark-muted mt-0.5">Apply all commits individually onto the tip of {baseBranch}.</div>
                </div>
                {method === 'rebase' && <Check className="w-4 h-4 text-onedark-purple flex-shrink-0 mt-0.5" />}
              </button>

              <button
                type="button"
                onClick={() => setMethod('merge')}
                className={`w-full p-2.5 rounded-xl border text-left transition-all cursor-pointer flex items-start justify-between ${
                  method === 'merge'
                    ? 'bg-onedark-purple/15 border-onedark-purple/60 text-onedark-fgBright ring-1 ring-onedark-purple/30'
                    : 'bg-onedark-surface/40 border-onedark-borderSubtle text-onedark-muted hover:bg-onedark-surface hover:text-onedark-fg'
                }`}
              >
                <div>
                  <div className="font-semibold text-xs text-onedark-fgBright">Create a merge commit</div>
                  <div className="text-[10.5px] text-onedark-muted mt-0.5">Preserve all individual commits with a merge commit.</div>
                </div>
                {method === 'merge' && <Check className="w-4 h-4 text-onedark-purple flex-shrink-0 mt-0.5" />}
              </button>
            </div>
          </div>

          {/* Commit Title */}
          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-onedark-muted uppercase tracking-wider">
              Commit Title
            </label>
            <input
              type="text"
              value={commitTitle}
              onChange={(e) => setCommitTitle(e.target.value)}
              className="w-full bg-onedark-bg border border-onedark-border rounded-xl p-2.5 text-xs text-onedark-fg font-mono focus:outline-none focus:border-onedark-purple"
            />
          </div>

          {/* Commit Message */}
          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-onedark-muted uppercase tracking-wider">
              Extended Commit Message
            </label>
            <textarea
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              rows={2}
              className="w-full bg-onedark-bg border border-onedark-border rounded-xl p-2.5 text-xs text-onedark-fg font-mono focus:outline-none focus:border-onedark-purple leading-relaxed"
            />
          </div>

          {/* Footer */}
          <div className="pt-2 border-t border-onedark-borderSubtle flex items-center justify-end space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="px-4 py-1.5 rounded-lg bg-onedark-purple hover:bg-onedark-purple/90 text-white font-bold text-xs shadow-xs transition-all flex items-center space-x-1.5 cursor-pointer disabled:opacity-50"
            >
              {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GitMerge className="w-3.5 h-3.5" />}
              <span>{isLoading ? 'Merging...' : `Confirm ${method === 'squash' ? 'Squash & Merge' : method === 'rebase' ? 'Rebase & Merge' : 'Merge'}`}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export interface PRDetailViewProps {
  url?: string | null;
  prNumber?: number;
  prRecord?: TaskPR | null;
  task?: Task | null;
  onBack?: () => void;
  onCloneToSession?: (repoUrl: string, repoName: string) => void;
  onAskAboutComment?: (prompt: string) => void;
}

export function cleanPRDescriptionMarkdown(raw: string): string {
  if (!raw || !raw.trim()) return 'No description provided for this pull request.';

  let text = raw.trim();

  // 1. Strip synthetic reader header dump at the beginning of the text if present
  text = text.replace(/^#*\s*Pull Request\s+#\d+:[^\n]*\n+/i, '');
  text = text.replace(/^(?:\*\*)?Status:(?:\*\*)?\s+[^\n]*\n+/i, '');
  text = text.replace(/^#*\s*Description\s*\n+/i, '');
  text = text.replace(/^(?:---|___|\*\*\*)\s*\n+/i, '');

  // 2. Normalize standalone raw Linear URLs
  text = text.replace(/(^|[\s(])(linear\.app\/[^\s)]+)/g, '$1https://$2');

  // Convert "Linear ticket\nhttps://linear.app/.../issue/(KEY)/..." into clean markdown
  text = text.replace(/(?:^|\n)(?:#{1,4}\s*)?(?:Linear ticket|Linear issue|Issue|Ticket)[\s:]*\n*(https?:\/\/linear\.app\/[^\s\n]+)/gi, (_match, url) => {
    const keyMatch = url.match(/\/issue\/([A-Za-z0-9_-]+)/i);
    const key = keyMatch ? keyMatch[1].toUpperCase() : 'Linear Issue';
    return `\n\n### Linked Issue\n- [${key}](${url})\n`;
  });

  // 3. Promote common section headings if written in plain bold or plain text
  const commonSections = [
    'What & why',
    'What and why',
    'Why',
    'Summary',
    'What changed',
    "What's changed",
    'Context',
    'Problem',
    'Solution',
    'Evidence',
    'Test Results',
    'Testing',
    'How to verify',
    'How to test',
    'Verification',
    'Test Plan',
    'Security & Permissions',
    'Risk & Rollback',
    'Dependencies',
    'Related PRs',
    'Notes'
  ];

  for (const sec of commonSections) {
    const escaped = sec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(`(^|\\n)\\*\\*${escaped}\\*\\*\\s*(?=\\n|$)`, 'gi'), `$1### ${sec}\n`);
    text = text.replace(new RegExp(`(^|\\n)${escaped}:\\s*(?=\\n)`, 'gi'), `$1### ${sec}\n`);
    text = text.replace(new RegExp(`(^|\\n)${escaped}\\s*(?=\\n\\s*\\n|\\n\\s*[-*1-9])`, 'gi'), `$1### ${sec}\n`);
  }

  return text.trim() || 'No description provided for this pull request.';
}

interface PRDetailLoadingProps {
  prNumber?: number;
  title?: string;
}

const PRDetailLoading: React.FC<PRDetailLoadingProps> = ({ prNumber, title }) => {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-4 text-center select-none animate-fadeIn">
      <div className="relative flex items-center justify-center mb-3">
        <div className="w-10 h-10 rounded-xl bg-onedark-accent/10 border border-onedark-accent/20 flex items-center justify-center">
          <Loader2 className="w-5 h-5 text-onedark-accent animate-spin" />
        </div>
      </div>
      <span className="text-xs font-semibold text-onedark-fgBright">
        {prNumber ? `Loading Pull Request #${prNumber}` : 'Loading Pull Request Telemetry...'}
      </span>
      {title && (
        <p className="text-[11.5px] text-onedark-muted truncate max-w-md mt-1 font-mono">
          {title}
        </p>
      )}
    </div>
  );
};

export const PRDetailView: React.FC<PRDetailViewProps> = ({
  url,
  prNumber,
  prRecord,
  task,
  onBack,
  onCloneToSession,
  onAskAboutComment
}) => {
  const [data, setData] = useState<PRReaderResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'reader' | 'webview'>('reader');
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [isBranchCopied, setIsBranchCopied] = useState<boolean>(false);
  const [isCheckoutCopied, setIsCheckoutCopied] = useState<boolean>(false);
  const [branchMenuOpen, setBranchMenuOpen] = useState<boolean>(false);
  const branchMenuRef = useRef<HTMLDivElement>(null);

  // Close branch dropdown on outside click
  useEffect(() => {
    if (!branchMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (branchMenuRef.current && !branchMenuRef.current.contains(e.target as Node)) {
        setBranchMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [branchMenuOpen]);

  const handleCopyBranch = useCallback((branchName: string) => {
    navigator.clipboard.writeText(branchName);
    setIsBranchCopied(true);
    setTimeout(() => setIsBranchCopied(false), 2000);
  }, []);

  const handleCopyCheckout = useCallback((branchName: string) => {
    navigator.clipboard.writeText(`git checkout ${branchName}`);
    setIsCheckoutCopied(true);
    setTimeout(() => setIsCheckoutCopied(false), 2000);
  }, []);

  const [prTab, setPrTab] = useState<'overview' | 'diff' | 'commits' | 'comments' | 'tests' | 'review'>('overview');
  const [comments, setComments] = useState<PRCommentItem[]>([]);
  const [isSyncingComments, setIsSyncingComments] = useState<boolean>(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  const { subscribe } = useWebSocket();

  const [isReviewPopoverOpen, setIsReviewPopoverOpen] = useState<boolean>(false);
  const [isListenerModalOpen, setIsListenerModalOpen] = useState<boolean>(false);
  const [isListening, setIsListening] = useState<boolean>(prRecord?.is_listening || false);
  const [activeLineComment, setActiveLineComment] = useState<LineContext | null>(null);
  const [targetDiffFile, setTargetDiffFile] = useState<string | null>(null);
  const [targetDiffLine, setTargetDiffLine] = useState<number | null>(null);
  const [isOutlineOpen, setIsOutlineOpen] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('cyclode_pr_outline_open');
      return saved !== null ? saved === 'true' : true;
    } catch {
      return true;
    }
  });
  const [outlineFilterQuery, setOutlineFilterQuery] = useState<string>('');
  const [isOutlineRegex, setIsOutlineRegex] = useState<boolean>(false);

  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [isReviewDecisionModalOpen, setIsReviewDecisionModalOpen] = useState<boolean>(false);
  const [initialReviewEvent, setInitialReviewEvent] = useState<'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'>('APPROVE');
  const [isMergeModalOpen, setIsMergeModalOpen] = useState<boolean>(false);
  const [selectedLinearTicket, setSelectedLinearTicket] = useState<string | null>(null);
  const [submittedVerdict, setSubmittedVerdict] = useState<'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | null>(null);

  // Dynamic PR Test Runner States
  const [localTestOutput, setLocalTestOutput] = useState<string | null>(prRecord?.test_output || null);
  const [testStatus, setTestStatus] = useState<'idle' | 'running' | 'passed' | 'failed'>(() => {
    if (prRecord?.status === 'TESTS_PASSING') return 'passed';
    if (prRecord?.status === 'TESTS_FAILED') return 'failed';
    return prRecord?.test_output ? 'passed' : 'idle';
  });
  const [testCommand, setTestCommand] = useState<string>('');
  const [customTestCommand, setCustomTestCommand] = useState<string>('');
  const [testExitCode, setTestExitCode] = useState<number | null>(null);
  const [testDurationMs, setTestDurationMs] = useState<number | null>(null);
  const [isTestOutputCopied, setIsTestOutputCopied] = useState<boolean>(false);
  const [autoHealEnabled, setAutoHealEnabled] = useState<boolean>(true);
  const [testingAgentSubsessionId, setTestingAgentSubsessionId] = useState<string | null>(null);
  const [isTestingAgentActive, setIsTestingAgentActive] = useState<boolean>(false);
  const [showTestingAgentPanel, setShowTestingAgentPanel] = useState<boolean>(false);
  const [sandboxSubTab, setSandboxSubTab] = useState<'agent' | 'console'>('agent');

  useEffect(() => {
    if (prRecord?.test_output && !localTestOutput) {
      setLocalTestOutput(prRecord.test_output);
      if (prRecord.status === 'TESTS_PASSING') setTestStatus('passed');
      else if (prRecord.status === 'TESTS_FAILED') setTestStatus('failed');
    }
  }, [prRecord?.test_output, prRecord?.status]);

  // Fetch existing Testing Agent subsession for this PR if already spawned
  useEffect(() => {
    const effectivePrNum = data?.pr_number || prNumber || prRecord?.pr_number;
    if (!task?.id || !effectivePrNum || prTab !== 'tests') return;
    fetch(`${API_BASE}/api/tasks/${task.id}/prs/${effectivePrNum}/test/remediate`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.exists && d.subsession) {
          setTestingAgentSubsessionId(d.subsession.id);
          setShowTestingAgentPanel(true);
          setSandboxSubTab('agent');
          if (d.subsession.status === 'RUNNING' || d.subsession.status === 'INITIALIZING') {
            setIsTestingAgentActive(true);
          }
        }
      })
      .catch(() => {});
  }, [task?.id, data?.pr_number, prNumber, prRecord?.pr_number, prTab]);

  // Synchronize active Testing Agent subsession in real time via WebSocket
  useEffect(() => {
    const effectivePrNum = data?.pr_number || prNumber || prRecord?.pr_number;
    if (!task?.id || !effectivePrNum) return;

    const sessionKey = `test:${task.repo_name || task.id}:pr:${effectivePrNum}`;

    const unsubCreated = subscribe('TASK_CREATED', (newTask: any) => {
      if (
        newTask?.is_subsession &&
        newTask?.parent_task_id === task.id &&
        (newTask?.session_key === sessionKey || newTask?.session_key?.endsWith(`:pr:${effectivePrNum}`))
      ) {
        setTestingAgentSubsessionId(newTask.id);
        setShowTestingAgentPanel(true);
        setIsTestingAgentActive(true);
        setSandboxSubTab('agent');
      }
    });

    const unsubStatus = subscribe('TASK_STATUS_CHANGE', (statusData: any) => {
      if (statusData?.task_id && statusData.task_id === testingAgentSubsessionId) {
        if (statusData.status === 'RUNNING' || statusData.status === 'INITIALIZING') {
          setIsTestingAgentActive(true);
        } else if (statusData.status === 'COMPLETED' || statusData.status === 'IDLE' || statusData.status === 'FAILED') {
          setIsTestingAgentActive(false);
        }
      }
    });

    return () => {
      unsubCreated();
      unsubStatus();
    };
  }, [subscribe, task?.id, task?.repo_name, data?.pr_number, prNumber, prRecord?.pr_number, testingAgentSubsessionId]);

  const handleClearTestOutput = useCallback(async () => {
    const effectivePrNum = data?.pr_number || prNumber || prRecord?.pr_number;
    setLocalTestOutput('');
    setTestStatus('idle');
    setTestExitCode(null);
    setTestDurationMs(null);
    if (!task?.id || !effectivePrNum) return;
    try {
      await fetch(`${API_BASE}/api/tasks/${task.id}/prs/${effectivePrNum}/test`, {
        method: 'DELETE'
      });
    } catch (e) {
      console.error('Failed to clear PR test output on server:', e);
    }
  }, [data?.pr_number, prNumber, prRecord?.pr_number, task?.id]);

  const handleCopyTestOutput = useCallback(() => {
    const textToCopy = localTestOutput || prRecord?.test_output || '';
    if (!textToCopy) return;
    navigator.clipboard.writeText(textToCopy);
    setIsTestOutputCopied(true);
    setTimeout(() => setIsTestOutputCopied(false), 2000);
  }, [localTestOutput, prRecord?.test_output]);

  const contentScrollRef = useRef<HTMLDivElement>(null);

  const detectedLinearTickets = useMemo(() => {
    const textToScan = `${data?.title || prRecord?.title || ''} ${data?.head_branch || prRecord?.head_branch || ''} ${data?.overview_markdown || ''} ${data?.content_markdown || ''}`;
    const matches = textToScan.match(/\b([A-Z]{2,10}-\d+)\b/gi);
    if (!matches) return [];
    return Array.from(new Set(matches.map(m => m.toUpperCase())));
  }, [data?.title, prRecord?.title, data?.head_branch, prRecord?.head_branch, data?.overview_markdown, data?.content_markdown]);

  // Determine effective target URL
  const targetUrl = useMemo(() => {
    if (url) return url;
    if (prRecord?.html_url) return prRecord.html_url;
    if (task?.repo_name && (prNumber || prRecord?.pr_number)) {
      return `https://github.com/${task.repo_name}/pull/${prNumber || prRecord?.pr_number}`;
    }
    return null;
  }, [url, prRecord, task, prNumber]);

  const effectivePrNum = prNumber || prRecord?.pr_number || data?.pr_number;

  // Sync initial comments when reader data finishes loading
  useEffect(() => {
    if (data?.comments && Array.isArray(data.comments)) {
      setComments(data.comments);
      setLastSyncedAt(new Date());
    }
  }, [data?.comments]);

  // Fast dedicated comments fetcher for auto-sync and refresh
  const fetchCommentsOnly = async () => {
    if (!task?.id || !effectivePrNum) return;
    setIsSyncingComments(true);
    try {
      const apiBase = import.meta.env.VITE_API_URL || '';
      const res = await fetch(`${apiBase}/api/tasks/${task.id}/prs/${effectivePrNum}/comments`);
      if (res.ok) {
        const json = await res.json();
        if (json.comments && Array.isArray(json.comments)) {
          setComments(json.comments);
          setLastSyncedAt(new Date());
        }
      }
    } catch (err) {
      console.debug('Failed to sync PR comments:', err);
    } finally {
      setIsSyncingComments(false);
    }
  };

  // WebSocket live auto-sync listener for PR comments, listener state, and test execution
  useEffect(() => {
    if (!task?.id || !effectivePrNum) return;
    const unsub = subscribe('PR_COMMENTS_UPDATED', (payload: any) => {
      if (payload.task_id === task.id || Number(payload.pr_number) === Number(effectivePrNum)) {
        fetchCommentsOnly();
      }
    });

    const unsubListener = subscribe('PR_LISTENER_UPDATED', (payload: any) => {
      if (payload.task_id === task.id && Number(payload.pr_number) === Number(effectivePrNum)) {
        setIsListening(payload.is_listening);
      }
    });

    const unsubTest = subscribe('TASK_PR_TEST_COMPLETED', (payload: any) => {
      if (payload.task_id === task.id && Number(payload.pr_number) === Number(effectivePrNum)) {
        const tr = payload.test_result || {};
        const out = (tr.stdout || '') + (tr.stderr ? (tr.stdout ? '\n' : '') + tr.stderr : '') || payload.test_output || '';
        if (out) setLocalTestOutput(out);
        setTestStatus(payload.status === 'TESTS_PASSING' || tr.ok ? 'passed' : 'failed');
        if (tr.command) {
          setTestCommand(tr.command);
          setCustomTestCommand(prev => prev || tr.command);
        }
        if (tr.exit_code !== undefined) setTestExitCode(tr.exit_code);
        if (tr.duration_ms !== undefined) setTestDurationMs(tr.duration_ms);
        setActionLoading(null);
      }
    });

    const unsubCleared = subscribe('TASK_PR_TEST_CLEARED', (payload: any) => {
      if (payload.task_id === task.id && Number(payload.pr_number) === Number(effectivePrNum)) {
        setLocalTestOutput('');
        setTestStatus('idle');
        setTestExitCode(null);
        setTestDurationMs(null);
      }
    });

    const unsubRemediateReset = subscribe('TASK_PR_TEST_REMEDIATION_RESET', (payload: any) => {
      if (payload.task_id === task.id && Number(payload.pr_number) === Number(effectivePrNum)) {
        setTestingAgentSubsessionId(null);
        setIsTestingAgentActive(false);
      }
    });

    return () => {
      unsub();
      unsubListener();
      unsubTest();
      unsubCleared();
      unsubRemediateReset();
    };
  }, [subscribe, task?.id, effectivePrNum]);

  // Adaptive background polling: polls every 20s when comments tab is active and page is visible
  useEffect(() => {
    if (prTab !== 'comments' || !effectivePrNum || !task?.id) return;
    if (comments.length === 0) {
      fetchCommentsOnly();
    }
    const interval = setInterval(() => {
      if (!document.hidden) {
        fetchCommentsOnly();
      }
    }, 20000);
    return () => clearInterval(interval);
  }, [prTab, effectivePrNum, task?.id]);

  const totalCommentsCount = comments.length || data?.comments_count || (data?.comments?.length ?? 0);

  // Compute latest review state from PR comments/reviews
  const latestReviewFromComments = useMemo(() => {
    const reviewItems = comments.filter((c) => c.type === 'review' && c.review_state);
    if (!reviewItems.length) return null;
    const last = reviewItems[reviewItems.length - 1];
    return last.review_state || null;
  }, [comments]);

  const effectiveReviewVerdict = submittedVerdict || latestReviewFromComments;

  const fetchPR = async (fetchUrl: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const apiBase = import.meta.env.VITE_API_URL || '';
      const res = await fetch(`${apiBase}/api/reader?url=${encodeURIComponent(fetchUrl)}`);
      if (!res.ok) {
        throw new Error(`Failed to load PR details (HTTP ${res.status})`);
      }
      const json: PRReaderResponse = await res.json();
      setData(json);
    } catch (err: any) {
      console.error('Error loading PR reader content:', err);
      setError(err.message || 'Failed to fetch pull request');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (targetUrl) {
      fetchPR(targetUrl);
    }
  }, [targetUrl]);

  const activeUrl = data?.url || targetUrl;

  const handleCopyUrl = () => {
    if (activeUrl) {
      navigator.clipboard.writeText(activeUrl);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    }
  };

  // Actions: Run sandbox tests & AI review
  const handleRunTests = async (overrideCommand?: string) => {
    const effectivePrNum = data?.pr_number || prNumber || prRecord?.pr_number;
    if (!task?.id || !effectivePrNum) return;
    setActionLoading('test');
    setTestStatus('running');
    setPrTab('tests');
    const cmdToRun = overrideCommand !== undefined ? overrideCommand : customTestCommand;
    try {
      const apiBase = import.meta.env.VITE_API_URL || '';
      const res = await fetch(`${apiBase}/api/tasks/${task.id}/prs/${effectivePrNum}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: cmdToRun.trim() || undefined,
          target_files: data?.files?.map(f => f.filename) || [],
          auto_heal: autoHealEnabled
        })
      });
      if (res.ok) {
        const json = await res.json();
        const tr = json.test_result || {};
        const out = (tr.stdout || '') + (tr.stderr ? (tr.stdout ? '\n' : '') + tr.stderr : '') || '';
        setLocalTestOutput(out || 'Tests completed with no console output.');
        setTestStatus(tr.ok ? 'passed' : 'failed');
        if (tr.command) {
          setTestCommand(tr.command);
          if (!customTestCommand) setCustomTestCommand(tr.command);
        }
        if (tr.exit_code !== undefined) setTestExitCode(tr.exit_code);
        if (tr.duration_ms !== undefined) setTestDurationMs(tr.duration_ms);

        // Auto-remediation trigger: If tests failed, immediately dispatch/resume the Testing Agent
        if (!tr.ok) {
          handleLaunchTestingAgent(out);
        }
      } else {
        const errJson = await res.json().catch(() => ({}));
        setTestStatus('failed');
        const errOut = `Test run failed (HTTP ${res.status}): ${errJson.detail || 'Unknown error'}`;
        setLocalTestOutput(errOut);
        handleLaunchTestingAgent(errOut);
      }
    } catch (e: any) {
      console.error('Error running PR sandbox tests:', e);
      setTestStatus('failed');
      const errOut = `Error executing tests: ${e?.message || e}`;
      setLocalTestOutput(errOut);
      handleLaunchTestingAgent(errOut);
    } finally {
      setActionLoading(null);
    }
  };

  const handleLaunchTestingAgent = async (failureOutput?: string) => {
    const effectivePrNum = data?.pr_number || prNumber || prRecord?.pr_number;
    if (!task?.id || !effectivePrNum) return;
    setActionLoading('remediate');
    setIsTestingAgentActive(true);
    setShowTestingAgentPanel(true);
    setSandboxSubTab('agent');

    try {
      const res = await fetch(`${API_BASE}/api/tasks/${task.id}/prs/${effectivePrNum}/test/remediate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'agent',
          command: customTestCommand || undefined,
          user_instruction: failureOutput
            ? `Automated test suite failed in PR #${effectivePrNum}.\nFailure Output:\n\`\`\`\n${failureOutput.slice(0, 3000)}\n\`\`\`\n\nPlease investigate and remedy the failure directly in 'prs/pr-${effectivePrNum}'.`
            : undefined
        })
      });
      if (res.ok) {
        const json = await res.json();
        if (json.subsession_task_id) {
          setTestingAgentSubsessionId(json.subsession_task_id);
        }
      }
    } catch (err) {
      console.error('Failed to dispatch testing agent:', err);
    } finally {
      setActionLoading(null);
    }
  };


  const handleSubmitDecision = async (event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT', body: string) => {
    const effectivePrNum = data?.pr_number || prNumber || prRecord?.pr_number;
    if (!task?.id || !effectivePrNum) return;
    
    // Optimistically update review verdict state immediately
    const verdictMap: Record<string, 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED'> = {
      APPROVE: 'APPROVED',
      REQUEST_CHANGES: 'CHANGES_REQUESTED',
      COMMENT: 'COMMENTED'
    };
    if (verdictMap[event]) {
      setSubmittedVerdict(verdictMap[event]);
    }

    setActionLoading('decision');
    try {
      const apiBase = import.meta.env.VITE_API_URL || '';
      await fetch(`${apiBase}/api/tasks/${task.id}/prs/${effectivePrNum}/review_decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event, body })
      });
      fetchCommentsOnly();
      if (targetUrl) fetchPR(targetUrl);
    } catch (e) {
      console.error('Error submitting review decision:', e);
    } finally {
      setActionLoading(null);
    }
  };

  const handleQuickApprove = async () => {
    await handleSubmitDecision('APPROVE', 'LGTM! Approved.');
  };

  const handleConfirmMerge = async (method: 'squash' | 'merge' | 'rebase', commitTitle?: string, commitMessage?: string) => {
    const effectivePrNum = data?.pr_number || prNumber || prRecord?.pr_number;
    if (!task?.id || !effectivePrNum) return;
    setActionLoading('merge');
    try {
      const apiBase = import.meta.env.VITE_API_URL || '';
      await fetch(`${apiBase}/api/tasks/${task.id}/prs/${effectivePrNum}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merge_method: method,
          commit_title: commitTitle,
          commit_message: commitMessage
        })
      });
      if (targetUrl) fetchPR(targetUrl);
    } catch (e) {
      console.error('Error merging pull request:', e);
    } finally {
      setActionLoading(null);
    }
  };

  // Extract on-page headings for Overview
  const overviewHeadings = useMemo<HeadingItem[]>(() => {
    const rawMd = data?.overview_markdown || data?.content_markdown || prRecord?.body || '';
    const md = cleanPRDescriptionMarkdown(rawMd);
    if (!md) return [];
    const lines = md.split('\n');
    const items: HeadingItem[] = [];
    let inCode = false;

    for (const line of lines) {
      if (line.trim().startsWith('```')) {
        inCode = !inCode;
        continue;
      }
      if (inCode) continue;

      const match = line.match(/^(#{1,4})\s+(.+)$/);
      if (match) {
        const level = match[1].length;
        const rawText = match[2].trim();
        const cleanText = rawText
          .replace(/<[^>]+>/g, '')
          .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
          .replace(/[*_`]/g, '')
          .trim();
        const id = cleanText
          .toLowerCase()
          .replace(/[^\w\s-]/g, '')
          .trim()
          .replace(/\s+/g, '-');

        if (cleanText) {
          items.push({ level, title: cleanText, id });
        }
      }
    }
    return items;
  }, [data?.overview_markdown, data?.content_markdown, prRecord?.body]);

  // Extract on-page headings for AI Review Report
  const reviewHeadings = useMemo<HeadingItem[]>(() => {
    const md = prRecord?.review_summary || '';
    if (!md) return [];
    const lines = md.split('\n');
    const items: HeadingItem[] = [];
    let inCode = false;

    for (const line of lines) {
      if (line.trim().startsWith('```')) {
        inCode = !inCode;
        continue;
      }
      if (inCode) continue;

      const match = line.match(/^(#{1,4})\s+(.+)$/);
      if (match) {
        const level = match[1].length;
        const rawText = match[2].trim();
        const cleanText = rawText
          .replace(/<[^>]+>/g, '')
          .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
          .replace(/[*_`]/g, '')
          .trim();
        const id = cleanText
          .toLowerCase()
          .replace(/[^\w\s-]/g, '')
          .trim()
          .replace(/\s+/g, '-');

        if (cleanText) {
          items.push({ level, title: cleanText, id });
        }
      }
    }
    return items;
  }, [prRecord?.review_summary]);

  const outlineGrepMatcher = useMemo(() => {
    return createGrepMatcher(outlineFilterQuery, { isRegex: isOutlineRegex });
  }, [outlineFilterQuery, isOutlineRegex]);

  // Tab-specific filtered data for sidebar
  const filteredOverviewHeadings = useMemo(() => {
    if (!outlineFilterQuery.trim()) return overviewHeadings;
    return overviewHeadings.filter(h => outlineGrepMatcher.test(h.title));
  }, [overviewHeadings, outlineFilterQuery, outlineGrepMatcher]);

  const filteredReviewHeadings = useMemo(() => {
    if (!outlineFilterQuery.trim()) return reviewHeadings;
    return reviewHeadings.filter(h => outlineGrepMatcher.test(h.title));
  }, [reviewHeadings, outlineFilterQuery, outlineGrepMatcher]);

  const filesList = data?.files || [];
  const filteredSidebarFiles = useMemo(() => {
    if (!outlineFilterQuery.trim()) return filesList;
    return filesList.filter(f => outlineGrepMatcher.test(f.filename) || (f.patch && outlineGrepMatcher.grepPatch(f.patch).hasMatch));
  }, [filesList, outlineFilterQuery, outlineGrepMatcher]);

  const commitsList = data?.commits || [];
  const filteredSidebarCommits = useMemo(() => {
    if (!outlineFilterQuery.trim()) return commitsList;
    return commitsList.filter(c => 
      outlineGrepMatcher.test(c.message) || 
      outlineGrepMatcher.test(c.author_name) || 
      outlineGrepMatcher.test(c.sha) ||
      outlineGrepMatcher.test(c.short_sha)
    );
  }, [commitsList, outlineFilterQuery, outlineGrepMatcher]);

  const filteredSidebarComments = useMemo(() => {
    if (!outlineFilterQuery.trim()) return comments;
    return comments.filter(c => 
      outlineGrepMatcher.test(c.author) || 
      outlineGrepMatcher.test(c.body) || 
      outlineGrepMatcher.test(c.path)
    );
  }, [comments, outlineFilterQuery, outlineGrepMatcher]);

  // Smooth scroll and navigation helpers
  const handleJumpToDiff = (filePath: string, line?: number) => {
    setPrTab('diff');
    setTargetDiffFile(filePath);
    setTargetDiffLine(line || null);
  };

  const handleSidebarDiffFileClick = (filename: string) => {
    setPrTab('diff');
    setTargetDiffFile(filename);
    let matchedLine: number | null = null;
    if (outlineFilterQuery.trim()) {
      const fileItem = filesList.find((f) => f.filename === filename);
      if (fileItem && fileItem.patch) {
        const parsed = parseUnifiedPatch(fileItem.patch);
        for (const p of parsed) {
          if (p.type !== 'header' && outlineGrepMatcher.test(p.text)) {
            matchedLine = p.newLine || p.oldLine || null;
            if (matchedLine) break;
          }
        }
      }
    }
    setTargetDiffLine(matchedLine);
  };

  const scrollToHeading = (id: string) => {
    if (!contentScrollRef.current) return;
    const target = contentScrollRef.current.querySelector(`[id="${id}"]`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const scrollToDiffFile = (filename: string) => {
    if (!contentScrollRef.current) return;
    const target = contentScrollRef.current.querySelector(`[id="diff-file-${encodeURIComponent(filename)}"]`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const scrollToCommit = (sha: string) => {
    if (!contentScrollRef.current) return;
    const target = contentScrollRef.current.querySelector(`[id="commit-item-${sha}"]`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const scrollToComment = (id: number | string) => {
    if (!contentScrollRef.current) return;
    const target = contentScrollRef.current.querySelector(`[id="comment-item-${id}"]`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Tab outline configuration
  const tabOutlineInfo = useMemo(() => {
    if (prTab === 'overview') {
      return {
        title: 'Outline',
        count: overviewHeadings.length,
        hasItems: overviewHeadings.length > 0,
        Icon: ListTree
      };
    }
    if (prTab === 'diff') {
      return {
        title: 'Files Changed',
        count: filesList.length,
        hasItems: filesList.length > 0,
        Icon: FileCode2
      };
    }
    if (prTab === 'commits') {
      return {
        title: 'Commits',
        count: commitsList.length,
        hasItems: commitsList.length > 0,
        Icon: GitCommit
      };
    }
    if (prTab === 'comments') {
      return {
        title: 'Comments',
        count: comments.length,
        hasItems: comments.length > 0,
        Icon: MessageSquare
      };
    }
    if (prTab === 'review') {
      return {
        title: 'Review Sections',
        count: reviewHeadings.length,
        hasItems: reviewHeadings.length > 0,
        Icon: ShieldCheck
      };
    }
    return {
      title: 'Outline',
      count: 0,
      hasItems: false,
      Icon: ListTree
    };
  }, [prTab, overviewHeadings.length, filesList.length, commitsList.length, comments.length, reviewHeadings.length]);

  const effectiveTitle = data?.title || prRecord?.title || `Pull Request #${data?.pr_number || prNumber || prRecord?.pr_number || ''}`;
  const effectiveState = (data?.state || prRecord?.status || 'OPEN').toUpperCase();
  const effectiveAuthor = data?.author || prRecord?.author;
  const isAuthor = Boolean(
    data?.viewer_is_author ||
    (data?.viewer_login && effectiveAuthor && data.viewer_login.toLowerCase() === effectiveAuthor.toLowerCase())
  );
  const approvalCount = useMemo(() => {
    return comments.filter((c) => c.type === 'review' && c.review_state === 'APPROVED').length;
  }, [comments]);
  const effectiveHeadBranch = data?.head_branch || prRecord?.head_branch;
  const effectiveBaseBranch = data?.base_branch || prRecord?.base_branch || 'main';
  const effectiveAdditions = data?.additions ?? prRecord?.diff_stats?.additions;
  const effectiveDeletions = data?.deletions ?? prRecord?.diff_stats?.deletions;
  const effectiveIsDraft = Boolean(data?.is_draft || prRecord?.is_draft || (data as any)?.draft || (prRecord as any)?.draft);

  return (
    <div className="flex flex-col h-full bg-onedark-darker overflow-hidden text-onedark-fg">
      {/* Top Breadcrumb & Controls Bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-onedark-borderSubtle bg-onedark-bg select-none gap-2 flex-shrink-0">
        <div className="flex items-center space-x-2 min-w-0 flex-1 overflow-hidden">
          {onBack && (
            <button
              onClick={onBack}
              className="flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-onedark-surface hover:bg-onedark-surface/80 border border-onedark-border text-onedark-fgBright text-xs font-semibold transition-all cursor-pointer whitespace-nowrap flex-shrink-0 shadow-xs active:scale-95"
              title="Return to Pull Requests List"
            >
              <ChevronLeft className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="whitespace-nowrap">Back to PRs</span>
            </button>
          )}

          <div className="flex items-center space-x-1.5 min-w-0 overflow-hidden">
            <FolderGit2 className="w-4 h-4 text-onedark-folder flex-shrink-0" />
            <span className="text-xs font-semibold text-onedark-fgBright truncate font-mono" title={effectiveTitle}>
              {effectiveTitle}
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-1 flex-shrink-0">
          {/* Collapsible Left Outline Toggle Button */}
          {tabOutlineInfo.hasItems && viewMode === 'reader' && (
            <button
              onClick={() => {
                setIsOutlineOpen(prev => {
                  const next = !prev;
                  try { localStorage.setItem('cyclode_pr_outline_open', String(next)); } catch {}
                  return next;
                });
              }}
              className={`flex items-center space-x-1.5 px-2 py-1 rounded text-xs transition-all border cursor-pointer whitespace-nowrap flex-shrink-0 ${
                isOutlineOpen
                  ? 'bg-onedark-accent/20 border-onedark-accent/40 text-onedark-accent font-semibold'
                  : 'bg-onedark-surface/60 border-onedark-borderSubtle text-onedark-muted hover:text-onedark-fg'
              }`}
              title={isOutlineOpen ? `Collapse ${tabOutlineInfo.title} Sidebar` : `Expand ${tabOutlineInfo.title} Sidebar`}
            >
              <tabOutlineInfo.Icon className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="hidden md:inline text-[11px] whitespace-nowrap">{tabOutlineInfo.title}</span>
              <span className="px-1.5 py-0.2 rounded-full bg-onedark-surface border border-onedark-borderSubtle text-[10px] text-onedark-muted font-mono">
                {tabOutlineInfo.count}
              </span>
            </button>
          )}

          {/* Mode Switcher */}
          <div className="flex items-center bg-onedark-surface/80 rounded border border-onedark-borderSubtle p-0.5 text-[11px] font-medium flex-shrink-0">
            <button
              onClick={() => setViewMode('reader')}
              className={`px-2 py-0.5 rounded transition-all cursor-pointer whitespace-nowrap ${
                viewMode === 'reader'
                  ? 'bg-onedark-accent text-white shadow-xs font-semibold'
                  : 'text-onedark-muted hover:text-onedark-fg'
              }`}
              title="Clean Reader Mode"
            >
              Reader
            </button>
            <button
              onClick={() => setViewMode('webview')}
              className={`px-2 py-0.5 rounded transition-all cursor-pointer whitespace-nowrap ${
                viewMode === 'webview'
                  ? 'bg-onedark-accent text-white shadow-xs font-semibold'
                  : 'text-onedark-muted hover:text-onedark-fg'
              }`}
              title="Live Embedded Webview"
            >
              Webview
            </button>
          </div>

          <button
            onClick={() => targetUrl && fetchPR(targetUrl)}
            className="p-1.5 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg transition-colors cursor-pointer flex-shrink-0"
            title="Refresh"
          >
            <RotateCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-onedark-accent' : ''}`} />
          </button>

          <button
            onClick={handleCopyUrl}
            className="p-1.5 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg transition-colors cursor-pointer flex-shrink-0"
            title={isCopied ? "Copied!" : "Copy Link"}
          >
            {isCopied ? <Check className="w-3.5 h-3.5 text-onedark-green" /> : <Copy className="w-3.5 h-3.5" />}
          </button>

          {activeUrl && (
            <a
              href={activeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-accent transition-colors flex-shrink-0"
              title="Open in new browser tab"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      </div>

      {/* GitHub PR Hero Header */}
      <div className="bg-onedark-surface/30 border-b border-onedark-borderSubtle select-none flex-shrink-0">
        <div className="px-3 py-2 flex flex-wrap items-center justify-between gap-2 border-b border-onedark-borderSubtle text-xs">
          {/* Metadata Row */}
          <div className="flex flex-wrap items-center gap-2 min-w-0 select-text">
            {/* Status Badge */}
            <span className={`px-2 py-0.5 rounded-full font-mono text-[10.5px] font-bold uppercase whitespace-nowrap flex-shrink-0 ${
              effectiveState === 'MERGED'
                ? 'bg-onedark-purple/20 text-onedark-purple'
                : effectiveState === 'CLOSED'
                ? 'bg-onedark-red/20 text-onedark-red'
                : 'bg-onedark-green/20 text-onedark-green'
            }`}>
              {effectiveState === 'MERGED' ? '● Merged' : effectiveState === 'CLOSED' ? '● Closed' : '● Open'}
            </span>

            {/* Draft Badge */}
            {effectiveIsDraft && (
              <span className="px-2 py-0.5 rounded-full font-mono text-[10.5px] font-bold uppercase bg-onedark-muted/20 text-onedark-muted border border-onedark-muted/30 whitespace-nowrap flex-shrink-0">
                Draft
              </span>
            )}

            {/* Author */}
            {effectiveAuthor && (
              <span className="text-onedark-muted flex items-center space-x-1 whitespace-nowrap flex-shrink-0">
                <span>by</span>
                <span className="font-semibold text-onedark-fgBright">@{effectiveAuthor}</span>
              </span>
            )}

            {/* Branch Flow with Interactive Copy & Checkout */}
            {effectiveHeadBranch && effectiveBaseBranch && (
              <div 
                ref={branchMenuRef}
                className="relative inline-flex items-center select-text"
              >
                <div className="flex items-center space-x-1.5 font-mono text-[11px] bg-onedark-surface/60 hover:bg-onedark-surface border border-onedark-borderSubtle px-2 py-0.5 rounded transition-all group">
                  <GitBranch className="w-3 h-3 text-onedark-accent flex-shrink-0" />
                  
                  {/* Clickable Head Branch */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCopyBranch(effectiveHeadBranch);
                    }}
                    className="font-semibold text-onedark-accent hover:underline cursor-pointer transition-colors"
                    title={`Click to copy branch name "${effectiveHeadBranch}"`}
                  >
                    {effectiveHeadBranch}
                  </button>

                  {/* Copy Branch Button */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCopyBranch(effectiveHeadBranch);
                    }}
                    className="p-0.5 rounded hover:bg-onedark-bg text-onedark-muted hover:text-onedark-fg transition-colors cursor-pointer"
                    title={isBranchCopied ? "Copied branch name!" : "Copy branch name"}
                  >
                    {isBranchCopied ? (
                      <Check className="w-3 h-3 text-onedark-green" />
                    ) : (
                      <Copy className="w-3 h-3 opacity-60 group-hover:opacity-100" />
                    )}
                  </button>

                  {/* Dropdown Toggle for Checkout Command */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setBranchMenuOpen((prev) => !prev);
                    }}
                    className="p-0.5 rounded hover:bg-onedark-bg text-onedark-muted hover:text-onedark-fg transition-colors cursor-pointer"
                    title="Branch options"
                  >
                    <ChevronDown className="w-2.5 h-2.5 opacity-60 group-hover:opacity-100" />
                  </button>

                  <span className="text-onedark-muted select-none">➔</span>
                  <span className="text-onedark-muted">{effectiveBaseBranch}</span>
                </div>

                {/* Dropdown Menu for Checkout Command */}
                {branchMenuOpen && (
                  <div 
                    className="absolute left-0 top-full mt-1 z-30 w-72 bg-onedark-bg border border-onedark-border rounded-lg shadow-xl p-1 text-xs select-none"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        handleCopyBranch(effectiveHeadBranch);
                        setBranchMenuOpen(false);
                      }}
                      className="w-full flex items-center justify-between px-2.5 py-1.5 rounded hover:bg-onedark-surface text-left cursor-pointer text-onedark-fgBright group"
                    >
                      <div className="flex items-center space-x-2 min-w-0">
                        <Copy className="w-3.5 h-3.5 text-onedark-accent flex-shrink-0" />
                        <div className="min-w-0">
                          <div className="font-medium text-[11px]">Copy Branch Name</div>
                          <div className="font-mono text-[10px] text-onedark-muted truncate">{effectiveHeadBranch}</div>
                        </div>
                      </div>
                      {isBranchCopied && <Check className="w-3.5 h-3.5 text-onedark-green flex-shrink-0" />}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        handleCopyCheckout(effectiveHeadBranch);
                        setBranchMenuOpen(false);
                      }}
                      className="w-full flex items-center justify-between px-2.5 py-1.5 rounded hover:bg-onedark-surface text-left cursor-pointer text-onedark-fgBright group mt-0.5"
                    >
                      <div className="flex items-center space-x-2 min-w-0">
                        <Terminal className="w-3.5 h-3.5 text-onedark-green flex-shrink-0" />
                        <div className="min-w-0">
                          <div className="font-medium text-[11px]">Copy Checkout Command</div>
                          <div className="font-mono text-[10px] text-onedark-muted truncate">git checkout {effectiveHeadBranch}</div>
                        </div>
                      </div>
                      {isCheckoutCopied && <Check className="w-3.5 h-3.5 text-onedark-green flex-shrink-0" />}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Additions / Deletions */}
            {(effectiveAdditions !== undefined || effectiveDeletions !== undefined) && (
              <div className="flex items-center space-x-1 font-mono text-[11px] whitespace-nowrap flex-shrink-0">
                <span className="text-onedark-green font-semibold">+{effectiveAdditions?.toLocaleString() || 0}</span>
                <span className="text-onedark-muted">/</span>
                <span className="text-onedark-red font-semibold">-{effectiveDeletions?.toLocaleString() || 0}</span>
              </div>
            )}

            {/* Detected Linear Ticket Chips */}
            {detectedLinearTickets.map((ticket) => (
              <button
                key={ticket}
                onClick={() => setSelectedLinearTicket(ticket)}
                className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 text-indigo-400 text-[10.5px] font-mono font-bold transition-all cursor-pointer whitespace-nowrap flex-shrink-0 active:scale-95 shadow-xs"
                title={`Open and inspect Linear issue ${ticket}`}
              >
                <Zap className="w-3 h-3 text-indigo-400" />
                <span>Linear: {ticket}</span>
              </button>
            ))}
          </div>

          {/* Action Toolbar */}
          <div className="flex flex-wrap items-center gap-1.5 flex-shrink-0">
            {/* Run Tests Button */}
            <button
              onClick={() => handleRunTests()}
              disabled={Boolean(actionLoading) || testStatus === 'running'}
              className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer disabled:opacity-50 whitespace-nowrap flex-shrink-0 ${
                testStatus === 'passed'
                  ? 'bg-onedark-green/15 text-onedark-green border border-onedark-green/30'
                  : isTestingAgentActive
                  ? 'bg-onedark-accent/15 text-onedark-accent border border-onedark-accent/30'
                  : testStatus === 'failed'
                  ? 'bg-onedark-red/15 text-onedark-red border border-onedark-red/30'
                  : 'bg-onedark-surface hover:bg-onedark-surface/80 text-onedark-fgBright'
              }`}
              title="Run test suite in ephemeral container"
            >
              {actionLoading === 'test' || testStatus === 'running' ? (
                <Loader2 className="w-3.5 h-3.5 text-onedark-accent animate-spin" />
              ) : isTestingAgentActive ? (
                <Loader2 className="w-3.5 h-3.5 text-onedark-accent animate-spin" />
              ) : testStatus === 'passed' ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-onedark-green" />
              ) : testStatus === 'failed' ? (
                <AlertCircle className="w-3.5 h-3.5 text-onedark-red" />
              ) : (
                <Play className="w-3.5 h-3.5 text-onedark-green fill-onedark-green" />
              )}
              <span>
                {actionLoading === 'test' || testStatus === 'running'
                  ? 'Running Tests...'
                  : isTestingAgentActive
                  ? 'Remediating Tests...'
                  : testStatus === 'passed'
                  ? 'Tests Passed'
                  : testStatus === 'failed'
                  ? 'Tests Failed'
                  : 'Run Tests'}
              </span>
            </button>


            {/* Review with Agent Popover Button */}
            <button
              onClick={() => setIsReviewPopoverOpen(!isReviewPopoverOpen)}
              className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer whitespace-nowrap flex-shrink-0 ${
                isReviewPopoverOpen
                  ? 'bg-onedark-accent/20 text-onedark-accent font-semibold'
                  : 'bg-onedark-surface hover:bg-onedark-surface/80 text-onedark-fgBright'
              }`}
              title="Open interactive PR Reviewer Agent sub-session launcher"
            >
              <Bot className="w-3.5 h-3.5 text-onedark-accent" />
              <span>Review with Agent</span>
            </button>

            {/* Event Listener Sentinel Button */}
            <button
              onClick={() => setIsListenerModalOpen(true)}
              className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer whitespace-nowrap flex-shrink-0 ${
                isListening
                  ? 'bg-onedark-green/20 text-onedark-green font-semibold border border-onedark-green/30'
                  : 'bg-onedark-surface hover:bg-onedark-surface/80 text-onedark-fgBright'
              }`}
              title="Configure autonomous webhook event listener for this PR"
            >
              {isListening ? (
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-onedark-green opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-onedark-green" />
                </span>
              ) : (
                <Radio className="w-3.5 h-3.5 text-onedark-accent" />
              )}
              <span>{isListening ? 'Listening' : 'Listen'}</span>
            </button>

            {/* PR Decision Actions (Only when not already merged/closed) */}
            {effectiveState !== 'MERGED' && effectiveState !== 'CLOSED' && (
              <>
                {isAuthor ? (
                  /* --- Author Persona Actions --- */
                  <>
                    {/* Overall Approvals Status Tag */}
                    {approvalCount > 0 ? (
                      <div 
                        className="flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-onedark-green/20 border border-onedark-green/30 text-onedark-green text-[11px] font-semibold select-none flex-shrink-0 shadow-2xs"
                        title={`${approvalCount} review approval${approvalCount > 1 ? 's' : ''} on this PR`}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                        <span>{approvalCount} {approvalCount === 1 ? 'Approval' : 'Approvals'}</span>
                      </div>
                    ) : (
                      <div 
                        className="flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-onedark-surface border border-onedark-borderSubtle text-onedark-muted text-[11px] font-medium select-none flex-shrink-0"
                        title="Awaiting review from peers"
                      >
                        <Clock className="w-3.5 h-3.5 text-onedark-muted flex-shrink-0" />
                        <span>Awaiting Reviews</span>
                      </div>
                    )}

                    {/* Add Discussion Comment Button (for Authors) */}
                    <button
                      onClick={() => {
                        setInitialReviewEvent('COMMENT');
                        setIsReviewDecisionModalOpen(true);
                      }}
                      disabled={Boolean(actionLoading)}
                      className="flex items-center space-x-1 px-2.5 py-1 rounded-md bg-onedark-surface hover:bg-onedark-surface/80 text-onedark-fgBright text-[11px] font-semibold transition-all cursor-pointer disabled:opacity-50 whitespace-nowrap flex-shrink-0 border border-onedark-borderSubtle"
                      title="Add a discussion comment on your pull request"
                    >
                      <MessageSquare className="w-3.5 h-3.5 text-onedark-accent" />
                      <span>Add Comment</span>
                    </button>

                    {/* Merge PR Modal Trigger (Author has merge rights) */}
                    <button
                      onClick={() => setIsMergeModalOpen(true)}
                      disabled={Boolean(actionLoading)}
                      className="flex items-center space-x-1 px-2.5 py-1 rounded-md bg-onedark-purple/20 hover:bg-onedark-purple/30 text-onedark-purple text-[11px] font-semibold transition-all cursor-pointer disabled:opacity-50 whitespace-nowrap flex-shrink-0"
                      title="Merge your pull request"
                    >
                      {actionLoading === 'merge' ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <GitMerge className="w-3.5 h-3.5" />
                      )}
                      <span>Merge PR</span>
                    </button>
                  </>
                ) : (
                  /* --- Reviewer Persona Actions --- */
                  <>
                    {/* State-aware Review Status Pill vs. Quick Approve Action */}
                    {effectiveReviewVerdict === 'APPROVED' ? (
                      <div
                        className="flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-onedark-green/20 border border-onedark-green/30 text-onedark-green text-[11px] font-semibold select-none flex-shrink-0 shadow-2xs"
                        title="You approved this pull request"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                        <span>Approved</span>
                      </div>
                    ) : effectiveReviewVerdict === 'CHANGES_REQUESTED' ? (
                      <div
                        className="flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-onedark-red/20 border border-onedark-red/30 text-onedark-red text-[11px] font-semibold select-none flex-shrink-0 shadow-2xs"
                        title="You requested changes on this pull request"
                      >
                        <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                        <span>Changes Requested</span>
                      </div>
                    ) : effectiveReviewVerdict === 'COMMENTED' ? (
                      <div
                        className="flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-onedark-surface border border-onedark-borderSubtle text-onedark-fgBright text-[11px] font-semibold select-none flex-shrink-0 shadow-2xs"
                        title="Review comments submitted"
                      >
                        <MessageSquare className="w-3.5 h-3.5 text-onedark-muted flex-shrink-0" />
                        <span>Commented</span>
                      </div>
                    ) : (
                      /* Unreviewed: Quick Approve Button */
                      <button
                        onClick={handleQuickApprove}
                        disabled={Boolean(actionLoading)}
                        className="flex items-center space-x-1 px-2.5 py-1 rounded-md bg-onedark-green/20 hover:bg-onedark-green/30 text-onedark-green text-[11px] font-semibold transition-all cursor-pointer disabled:opacity-50 whitespace-nowrap flex-shrink-0"
                        title="Quickly submit an approval review"
                      >
                        {actionLoading === 'decision' ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        )}
                        <span>Approve</span>
                      </button>
                    )}

                    {/* Submit Review / Re-Review Modal Trigger */}
                    <button
                      onClick={() => {
                        setInitialReviewEvent(
                          effectiveReviewVerdict === 'CHANGES_REQUESTED'
                            ? 'REQUEST_CHANGES'
                            : effectiveReviewVerdict === 'COMMENTED'
                            ? 'COMMENT'
                            : 'APPROVE'
                        );
                        setIsReviewDecisionModalOpen(true);
                      }}
                      disabled={Boolean(actionLoading)}
                      className="flex items-center space-x-1 px-2.5 py-1 rounded-md bg-onedark-surface hover:bg-onedark-surface/80 text-onedark-fgBright text-[11px] font-semibold transition-all cursor-pointer disabled:opacity-50 whitespace-nowrap flex-shrink-0 border border-onedark-borderSubtle"
                      title={
                        effectiveReviewVerdict
                          ? "Update or re-submit your code review verdict"
                          : "Open code review decision modal (Approve, Request Changes, Comment)"
                      }
                    >
                      <ShieldCheck className="w-3.5 h-3.5 text-onedark-accent" />
                      <span>{effectiveReviewVerdict ? 'Re-Review' : 'Submit Review'}</span>
                    </button>

                    {/* Merge PR Modal Trigger */}
                    <button
                      onClick={() => setIsMergeModalOpen(true)}
                      disabled={Boolean(actionLoading)}
                      className="flex items-center space-x-1 px-2.5 py-1 rounded-md bg-onedark-purple/20 hover:bg-onedark-purple/30 text-onedark-purple text-[11px] font-semibold transition-all cursor-pointer disabled:opacity-50 whitespace-nowrap flex-shrink-0"
                      title="Merge this pull request"
                    >
                      {actionLoading === 'merge' ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <GitMerge className="w-3.5 h-3.5" />
                      )}
                      <span>Merge PR</span>
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        {/* Sub-Tab Navigation - Horizontally scrollable without breaking lines */}
        <div className="flex items-center px-3 pt-1 space-x-1 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setPrTab('overview')}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-t-md text-xs font-medium border-b-2 transition-all cursor-pointer whitespace-nowrap flex-shrink-0 ${
              prTab === 'overview'
                ? 'border-onedark-accent text-onedark-fgBright bg-onedark-darker font-semibold'
                : 'border-transparent text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/40'
            }`}
          >
            <FileText className="w-3.5 h-3.5 text-onedark-accent flex-shrink-0" />
            <span>Overview</span>
          </button>

          <button
            onClick={() => setPrTab('diff')}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-t-md text-xs font-medium border-b-2 transition-all cursor-pointer whitespace-nowrap flex-shrink-0 ${
              prTab === 'diff'
                ? 'border-onedark-accent text-onedark-fgBright bg-onedark-darker font-semibold'
                : 'border-transparent text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/40'
            }`}
          >
            <FileCode2 className="w-3.5 h-3.5 text-onedark-blue flex-shrink-0" />
            <span>Files Changed</span>
            {(data?.files?.length || data?.changed_files_count || prRecord?.diff_stats?.changed_files || 0) > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-onedark-surface text-[10px] font-mono text-onedark-fgBright">
                {data?.files?.length || data?.changed_files_count || prRecord?.diff_stats?.changed_files}
              </span>
            )}
          </button>

          <button
            onClick={() => setPrTab('commits')}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-t-md text-xs font-medium border-b-2 transition-all cursor-pointer whitespace-nowrap flex-shrink-0 ${
              prTab === 'commits'
                ? 'border-onedark-accent text-onedark-fgBright bg-onedark-darker font-semibold'
                : 'border-transparent text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/40'
            }`}
          >
            <GitCommit className="w-3.5 h-3.5 text-onedark-purple flex-shrink-0" />
            <span>Commits</span>
            {(data?.commits?.length || 0) > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-onedark-surface text-[10px] font-mono text-onedark-fgBright">
                {data?.commits?.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setPrTab('comments')}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-t-md text-xs font-medium border-b-2 transition-all cursor-pointer whitespace-nowrap flex-shrink-0 ${
              prTab === 'comments'
                ? 'border-onedark-accent text-onedark-fgBright bg-onedark-darker font-semibold'
                : 'border-transparent text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/40'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5 text-onedark-accent flex-shrink-0" />
            <span>Comments</span>
            {totalCommentsCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-onedark-surface text-[10px] font-mono text-onedark-fgBright">
                {totalCommentsCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setPrTab('tests')}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-t-md text-xs font-medium border-b-2 transition-all cursor-pointer whitespace-nowrap flex-shrink-0 ${
              prTab === 'tests'
                ? 'border-onedark-accent text-onedark-fgBright bg-onedark-darker font-semibold'
                : 'border-transparent text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/40'
            }`}
            title="Ephemeral sandbox test suite execution"
          >
            <Terminal className="w-3.5 h-3.5 text-onedark-green flex-shrink-0" />
            <span>Sandbox Tests</span>
            {testStatus === 'running' ? (
              <Loader2 className="w-3 h-3 text-onedark-accent animate-spin" />
            ) : isTestingAgentActive ? (
              <span className="flex items-center space-x-1 px-1.5 py-0.2 rounded-full bg-onedark-accent/20 text-onedark-accent text-[9.5px] font-mono font-semibold animate-pulse">
                <Loader2 className="w-2.5 h-2.5 animate-spin" />
                <span>REMEDYING</span>
              </span>
            ) : testStatus === 'passed' ? (
              <span className="flex items-center space-x-0.5 px-1.5 py-0.2 rounded-full bg-onedark-green/20 text-onedark-green text-[10px] font-mono font-semibold">
                <Check className="w-2.5 h-2.5" />
                <span>PASS</span>
              </span>
            ) : testStatus === 'failed' ? (
              <span className="flex items-center space-x-0.5 px-1.5 py-0.2 rounded-full bg-onedark-red/20 text-onedark-red text-[10px] font-mono font-semibold">
                <X className="w-2.5 h-2.5" />
                <span>FAIL</span>
              </span>
            ) : (localTestOutput || prRecord?.test_output) ? (
              <span className="px-1.5 py-0.2 rounded-full bg-onedark-surface text-[10px] font-mono text-onedark-muted">
                logs
              </span>
            ) : null}
          </button>

          {prRecord?.review_summary && (
            <button
              onClick={() => setPrTab('review')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-t-md text-xs font-medium border-b-2 transition-all cursor-pointer whitespace-nowrap flex-shrink-0 ${
                prTab === 'review'
                  ? 'border-onedark-accent text-onedark-fgBright bg-onedark-darker font-semibold'
                  : 'border-transparent text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/40'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5 text-onedark-purple flex-shrink-0" />
              <span>AI Review Report</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Content Area with Collapsible Left Outline Rail */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Collapsible Document / Files / Commits / Comments Left Sidebar */}
        {!isLoading && !error && viewMode === 'reader' && isOutlineOpen && tabOutlineInfo.hasItems && (
          <aside className="w-60 xl:w-64 border-r border-onedark-borderSubtle bg-onedark-bg/95 flex flex-col flex-shrink-0 z-10 select-none transition-all duration-200">
            {/* Outline Header */}
            <div className="p-2.5 px-3 border-b border-onedark-borderSubtle flex items-center justify-between bg-onedark-surface/30">
              <div className="flex items-center space-x-2 min-w-0">
                <tabOutlineInfo.Icon className="w-3.5 h-3.5 text-onedark-accent flex-shrink-0" />
                <span className="text-xs font-semibold text-onedark-fgBright truncate">{tabOutlineInfo.title}</span>
                <span className="px-1.5 py-0.2 rounded-full bg-onedark-surface border border-onedark-borderSubtle text-[10px] text-onedark-muted font-mono flex-shrink-0">
                  {tabOutlineInfo.count}
                </span>
              </div>
              <button
                onClick={() => {
                  setIsOutlineOpen(false);
                  try { localStorage.setItem('cyclode_pr_outline_open', 'false'); } catch {}
                }}
                className="p-1 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg transition-colors cursor-pointer flex-shrink-0"
                title="Collapse Sidebar"
              >
                <PanelLeftClose className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Quick Filter */}
            {tabOutlineInfo.count > 3 && (
              <div className="p-2 border-b border-onedark-borderSubtle/60">
                <div className={`flex items-center space-x-1.5 bg-onedark-surface/60 rounded px-2 py-1 border ${
                  isOutlineRegex
                    ? outlineGrepMatcher.isValid
                      ? 'border-onedark-purple/60'
                      : 'border-onedark-red/60'
                    : 'border-onedark-borderSubtle'
                }`}>
                  <Search className="w-3 h-3 text-onedark-muted shrink-0" />
                  <input
                    type="text"
                    value={outlineFilterQuery}
                    onChange={(e) => setOutlineFilterQuery(e.target.value)}
                    placeholder={
                      isOutlineRegex
                        ? 'Grep (/pattern/)...'
                        : prTab === 'diff'
                        ? 'Filter files & diffs...'
                        : prTab === 'commits'
                        ? 'Filter commits...'
                        : prTab === 'comments'
                        ? 'Filter comments...'
                        : 'Filter sections...'
                    }
                    className="w-full bg-transparent border-none text-[11px] text-onedark-fg focus:outline-none placeholder:text-onedark-muted/60"
                  />
                  {outlineFilterQuery && (
                    <button onClick={() => setOutlineFilterQuery('')} className="text-onedark-muted hover:text-onedark-fg cursor-pointer">
                      <X className="w-3 h-3" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setIsOutlineRegex((prev) => !prev)}
                    className={`px-1 py-0.2 rounded font-mono text-[9px] font-bold transition-all cursor-pointer ${
                      isOutlineRegex
                        ? 'bg-onedark-purple text-white shadow-xs'
                        : 'text-onedark-muted hover:text-onedark-fg'
                    }`}
                    title={
                      isOutlineRegex
                        ? outlineGrepMatcher.isValid
                          ? 'Grep / Regular Expression active'
                          : `Regex error: ${outlineGrepMatcher.error || 'Invalid regex'}`
                        : 'Enable Grep / Regular Expression mode'
                    }
                  >
                    .*
                  </button>
                </div>
              </div>
            )}

            {/* Sidebar Content depending on prTab */}
            <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5 [scrollbar-width:thin]">
              {/* 1. Overview Tab Headings */}
              {prTab === 'overview' && (
                filteredOverviewHeadings.length === 0 ? (
                  <div className="p-3 text-center text-xs text-onedark-muted">No matching sections</div>
                ) : (
                  filteredOverviewHeadings.map((h, idx) => (
                    <button
                      key={`${h.id}-${idx}`}
                      onClick={() => scrollToHeading(h.id)}
                      className={`w-full text-left truncate py-1.5 px-2 rounded-md hover:bg-onedark-surface/70 transition-all text-xs cursor-pointer flex items-center group ${
                        h.level === 1
                          ? 'font-bold text-onedark-fgBright hover:text-onedark-accent'
                          : h.level === 2
                          ? 'pl-3.5 font-medium text-onedark-fg hover:text-onedark-fgBright'
                          : 'pl-6 text-onedark-muted text-[11.5px] hover:text-onedark-fg'
                      }`}
                      title={h.title}
                    >
                      <span className={`w-1 h-1 rounded-full mr-2 flex-shrink-0 transition-colors ${
                        h.level === 1 ? 'bg-onedark-accent' : h.level === 2 ? 'bg-onedark-muted/60 group-hover:bg-onedark-accent' : 'bg-transparent'
                      }`} />
                      <span className="truncate">{h.title}</span>
                    </button>
                  ))
                )
              )}

              {/* 2. Files Changed Tab File Tree */}
              {prTab === 'diff' && (
                filteredSidebarFiles.length === 0 ? (
                  <div className="p-3 text-center text-xs text-onedark-muted">No matching files</div>
                ) : (
                  filteredSidebarFiles.map((f, idx) => {
                    const pathParts = f.filename.split('/');
                    const fileNameOnly = pathParts.pop();
                    const dirPath = pathParts.join('/');
                    const isAdded = f.status === 'added' || f.status === 'new';
                    const isDeleted = f.status === 'deleted' || f.status === 'removed';
                    const patchGrepRes = outlineFilterQuery.trim() && f.patch ? outlineGrepMatcher.grepPatch(f.patch) : null;
                    const patchMatchCount = patchGrepRes?.matchingLinesCount || 0;

                    return (
                      <button
                        key={`${f.filename}-${idx}`}
                        onClick={() => handleSidebarDiffFileClick(f.filename)}
                        className="w-full text-left p-1.5 rounded-md hover:bg-onedark-surface/70 transition-all text-xs cursor-pointer flex items-center justify-between group font-mono gap-1"
                        title={f.filename}
                      >
                        <div className="flex items-center space-x-1.5 min-w-0 flex-1 overflow-hidden">
                          <span className={`text-[10px] font-bold w-3 text-center flex-shrink-0 ${
                            isAdded ? 'text-onedark-green' : isDeleted ? 'text-onedark-red' : 'text-onedark-blue'
                          }`}>
                            {isAdded ? '+' : isDeleted ? '-' : '~'}
                          </span>
                          <div className="min-w-0 flex-1 truncate">
                            {dirPath && (
                              <div className="text-[9.5px] text-onedark-muted/70 truncate leading-none">
                                {outlineFilterQuery.trim() && outlineGrepMatcher.test(dirPath) ? (
                                  outlineGrepMatcher.highlightSegments(dirPath).map((seg, sIdx) =>
                                    seg.matched ? (
                                      <mark key={sIdx} className="bg-onedark-yellow/30 text-onedark-yellow font-bold px-0.5 rounded-xs">
                                        {seg.text}
                                      </mark>
                                    ) : (
                                      <span key={sIdx}>{seg.text}</span>
                                    )
                                  )
                                ) : (
                                  dirPath
                                )}/
                              </div>
                            )}
                            <div className="text-[11.5px] text-onedark-fgBright font-medium truncate group-hover:text-onedark-accent flex items-center gap-1">
                              <span className="truncate">
                                {outlineFilterQuery.trim() && outlineGrepMatcher.test(fileNameOnly || '') ? (
                                  outlineGrepMatcher.highlightSegments(fileNameOnly || '').map((seg, sIdx) =>
                                    seg.matched ? (
                                      <mark key={sIdx} className="bg-onedark-yellow/30 text-onedark-yellow font-bold px-0.5 rounded-xs">
                                        {seg.text}
                                      </mark>
                                    ) : (
                                      <span key={sIdx}>{seg.text}</span>
                                    )
                                  )
                                ) : (
                                  fileNameOnly
                                )}
                              </span>
                              {patchMatchCount > 0 && (
                                <span className="px-1 py-0.2 rounded text-[9px] font-mono bg-onedark-purple/20 text-onedark-purple border border-onedark-purple/30 whitespace-nowrap flex-shrink-0" title={`${patchMatchCount} diff matches in this file`}>
                                  {patchMatchCount}m
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center space-x-1 text-[10px] text-right flex-shrink-0">
                          {(f.additions || 0) > 0 && <span className="text-onedark-green">+{f.additions}</span>}
                          {(f.deletions || 0) > 0 && <span className="text-onedark-red">-{f.deletions}</span>}
                        </div>
                      </button>
                    );
                  })
                )
              )}

              {/* 3. Commits Tab List */}
              {prTab === 'commits' && (
                filteredSidebarCommits.length === 0 ? (
                  <div className="p-3 text-center text-xs text-onedark-muted">No matching commits</div>
                ) : (
                  filteredSidebarCommits.map((c, idx) => {
                    const parsed = parseCommitDetails(c);
                    return (
                      <button
                        key={`${c.sha}-${idx}`}
                        onClick={() => scrollToCommit(c.sha)}
                        className="w-full text-left p-1.5 rounded-md hover:bg-onedark-surface/70 transition-all text-xs cursor-pointer space-y-1 group"
                        title={c.message}
                      >
                        <div className="flex items-center justify-between gap-1 text-[10px] font-mono">
                          <span className="text-onedark-accent font-semibold">{c.sha.slice(0, 7)}</span>
                          {parsed.ticket && (
                            <span className="px-1 py-0.2 rounded bg-onedark-accent/15 text-onedark-accent">
                              {parsed.ticket}
                            </span>
                          )}
                        </div>
                        <div className="text-[11.5px] text-onedark-fg group-hover:text-onedark-fgBright truncate font-sans">
                          {parsed.cleanSubject}
                        </div>
                      </button>
                    );
                  })
                )
              )}

              {/* 4. Comments Tab List */}
              {prTab === 'comments' && (
                filteredSidebarComments.length === 0 ? (
                  <div className="p-3 text-center text-xs text-onedark-muted">No matching comments</div>
                ) : (
                  filteredSidebarComments.map((c, idx) => {
                    const isBot = (c.author || '').toLowerCase().includes('[bot]') || (c.author || '').toLowerCase() === 'coderabbitai';
                    return (
                      <button
                        key={`${c.id}-${idx}`}
                        onClick={() => scrollToComment(c.id)}
                        className="w-full text-left p-1.5 rounded-md hover:bg-onedark-surface/70 transition-all text-xs cursor-pointer space-y-0.5 group"
                        title={c.body}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-bold text-[11px] text-onedark-fgBright truncate">
                            @{c.author}
                          </span>
                          {isBot && (
                            <span className="px-1 py-0.2 rounded text-[9px] font-mono bg-onedark-purple/20 text-onedark-purple font-bold">
                              BOT
                            </span>
                          )}
                        </div>
                        {c.path && (
                          <div className="text-[10px] font-mono text-onedark-accent truncate">
                            {c.path.split('/').pop()}{c.line ? `:${c.line}` : ''}
                          </div>
                        )}
                        <div className="text-[11px] text-onedark-muted group-hover:text-onedark-fg truncate font-sans">
                          {c.body ? c.body.replace(/[#*`_]/g, '').slice(0, 60) : 'No content'}
                        </div>
                      </button>
                    );
                  })
                )
              )}

              {/* 5. AI Review Tab Headings */}
              {prTab === 'review' && (
                filteredReviewHeadings.length === 0 ? (
                  <div className="p-3 text-center text-xs text-onedark-muted">No matching sections</div>
                ) : (
                  filteredReviewHeadings.map((h, idx) => (
                    <button
                      key={`${h.id}-${idx}`}
                      onClick={() => scrollToHeading(h.id)}
                      className={`w-full text-left truncate py-1.5 px-2 rounded-md hover:bg-onedark-surface/70 transition-all text-xs cursor-pointer flex items-center group ${
                        h.level === 1
                          ? 'font-bold text-onedark-fgBright hover:text-onedark-accent'
                          : h.level === 2
                          ? 'pl-3.5 font-medium text-onedark-fg hover:text-onedark-fgBright'
                          : 'pl-6 text-onedark-muted text-[11.5px] hover:text-onedark-fg'
                      }`}
                      title={h.title}
                    >
                      <span className={`w-1 h-1 rounded-full mr-2 flex-shrink-0 transition-colors ${
                        h.level === 1 ? 'bg-onedark-purple' : h.level === 2 ? 'bg-onedark-muted/60 group-hover:bg-onedark-purple' : 'bg-transparent'
                      }`} />
                      <span className="truncate">{h.title}</span>
                    </button>
                  ))
                )
              )}
            </div>
          </aside>
        )}

        {/* Main PR Body Viewport */}
        <div ref={contentScrollRef} className="flex-1 overflow-y-auto p-4 select-text relative">
          {isLoading && (
            <PRDetailLoading
              prNumber={data?.pr_number || prNumber || prRecord?.pr_number}
              title={effectiveTitle}
            />
          )}

          {error && !isLoading && (
            <div className="p-4 rounded-xl border border-onedark-red/30 bg-onedark-red/10 text-xs text-onedark-fg space-y-2">
              <div className="flex items-center space-x-2 text-onedark-red font-semibold">
                <AlertCircle className="w-4 h-4" />
                <span>Failed to preview PR</span>
              </div>
              <p className="text-onedark-muted leading-relaxed">{error}</p>
              {targetUrl && (
                <a
                  href={targetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center space-x-1 text-onedark-accent hover:underline font-medium pt-1"
                >
                  <span>Open directly on GitHub</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          )}

          {!isLoading && !error && viewMode === 'reader' && (
            prTab === 'overview' ? (
              <div className="max-w-none text-onedark-fg text-[14px] leading-[1.75] space-y-4">
                {/* Linked Linear Issue Card if detected */}
                {detectedLinearTickets.length > 0 && (
                  <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/25 flex flex-wrap items-center justify-between gap-2 shadow-xs">
                    <div className="flex items-center space-x-2.5">
                      <div className="w-7 h-7 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center">
                        <Zap className="w-4 h-4 text-indigo-400" />
                      </div>
                      <div>
                        <span className="text-xs font-bold text-onedark-fgBright">Linked Linear Tickets</span>
                        <p className="text-[11px] text-onedark-muted">Click any ticket to inspect issue telemetry and acceptance criteria</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {detectedLinearTickets.map((ticket) => (
                        <button
                          key={ticket}
                          onClick={() => setSelectedLinearTicket(ticket)}
                          className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/40 text-indigo-300 text-xs font-mono font-bold transition-all cursor-pointer shadow-xs active:scale-95"
                          title={`Open and inspect Linear issue ${ticket}`}
                        >
                          <Zap className="w-3 h-3 text-indigo-400" />
                          <span>{ticket}</span>
                          <ExternalLink className="w-2.5 h-2.5 text-indigo-400/80 ml-0.5" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="p-5 rounded-2xl bg-onedark-bg/70 border border-onedark-borderSubtle shadow-xs">
                  <MarkdownRenderer
                    content={cleanPRDescriptionMarkdown(
                      data?.overview_markdown || data?.content_markdown || prRecord?.body || ''
                    )}
                    onLinkClick={(targetLink, linkText) => {
                      const linearMatch = targetLink.match(/linear\.app\/[^\/]+\/issue\/([A-Za-z0-9_-]+)/i);
                      if (linearMatch) {
                        setSelectedLinearTicket(linearMatch[1].toUpperCase());
                        return;
                      }
                      const ticketMatch = linkText.match(/\b([A-Z]{2,10}-\d+)\b/);
                      if (ticketMatch) {
                        setSelectedLinearTicket(ticketMatch[1].toUpperCase());
                        return;
                      }
                      window.open(targetLink, '_blank', 'noopener,noreferrer');
                    }}
                  />
                </div>
              </div>
            ) : prTab === 'diff' ? (
              <PRDiffSection 
                files={data?.files || []} 
                diffText={data?.diff_text} 
                targetFile={targetDiffFile}
                targetLine={targetDiffLine}
                searchQuery={outlineFilterQuery}
                task={task}
                repoName={data?.repo_name || task?.repo_name}
                headBranch={data?.head_branch}
                baseBranch={data?.base_branch}
                onAskAboutComment={onAskAboutComment}
                onLineComment={(filename, line, content) => {
                  setActiveLineComment({ filename, line, content });
                  setIsReviewPopoverOpen(true);
                }}
              />
            ) : prTab === 'commits' ? (
              <PRCommitsSection 
                commits={data?.commits || []} 
                repoName={data?.repo_name || task?.repo_name}
                task={task}
                onAskAboutComment={onAskAboutComment}
                onLineComment={(filename, line, content) => {
                  setActiveLineComment({ filename, line, content });
                  setIsReviewPopoverOpen(true);
                }}
              />
            ) : prTab === 'comments' ? (
              <PRCommentsSection
                comments={comments}
                prNumber={effectivePrNum}
                task={task}
                isSyncing={isSyncingComments}
                lastSyncedAt={lastSyncedAt}
                onRefreshComments={fetchCommentsOnly}
                onAskAboutComment={onAskAboutComment}
                onJumpToDiff={handleJumpToDiff}
              />
            ) : prTab === 'tests' ? (
              <div className="space-y-3 animate-fadeIn">
                {/* Unified Sandbox Runner Bar */}
                <div className="p-3 bg-onedark-surface/60 border border-onedark-borderSubtle rounded-xl flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2.5 text-xs">
                  {/* Left: Status & Identity */}
                  <div className="flex items-center space-x-2.5 min-w-0">
                    <div className="p-1.5 rounded-lg bg-onedark-bg border border-onedark-borderSubtle text-onedark-accent flex-shrink-0">
                      <Terminal className="w-4 h-4" />
                    </div>
                    <div className="flex items-center space-x-2 min-w-0">
                      <span className="font-semibold text-onedark-fgBright whitespace-nowrap">
                        Sandbox Tests
                      </span>
                      {testStatus === 'running' ? (
                        <span className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-onedark-accent/20 border border-onedark-accent/30 text-onedark-accent text-[10.5px] font-semibold">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          <span>Running</span>
                        </span>
                      ) : isTestingAgentActive ? (
                        <span className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-onedark-accent/20 border border-onedark-accent/30 text-onedark-accent text-[10.5px] font-semibold animate-pulse">
                          <Sparkles className="w-3 h-3 text-onedark-accent animate-spin" />
                          <span>Remediating</span>
                        </span>
                      ) : testStatus === 'passed' ? (
                        <span className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-onedark-green/20 border border-onedark-green/30 text-onedark-green text-[10.5px] font-semibold">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>Passed {testExitCode !== null ? `(code ${testExitCode})` : ''}</span>
                        </span>
                      ) : testStatus === 'failed' ? (
                        <span className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-onedark-red/20 border border-onedark-red/30 text-onedark-red text-[10.5px] font-semibold">
                          <AlertCircle className="w-3 h-3" />
                          <span>Failed {testExitCode !== null ? `(code ${testExitCode})` : ''}</span>
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full bg-onedark-surface border border-onedark-borderSubtle text-onedark-muted text-[10.5px]">
                          Ready
                        </span>
                      )}
                      {testDurationMs !== null && (
                        <span className="hidden sm:inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-onedark-bg border border-onedark-borderSubtle text-[10.5px] font-mono text-onedark-muted">
                          <Clock className="w-2.5 h-2.5 text-onedark-muted" />
                          <span>{(testDurationMs / 1000).toFixed(2)}s</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Center / Input: Custom Command with auto-heal */}
                  <div className="flex-1 max-w-xl flex items-center space-x-2">
                    <div className="flex-1 relative flex items-center">
                      <span className="absolute left-2.5 text-onedark-muted font-mono text-xs select-none">$</span>
                      <input
                        type="text"
                        value={customTestCommand}
                        onChange={(e) => setCustomTestCommand(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleRunTests(customTestCommand);
                          }
                        }}
                        placeholder={testCommand || "Auto-detect (pytest, npm test, mix test, cargo test...)"}
                        className="w-full pl-6 pr-3 py-1 bg-onedark-bg border border-onedark-borderSubtle focus:border-onedark-accent rounded-lg text-xs font-mono text-onedark-fgBright placeholder:text-onedark-muted/60 outline-none transition-all shadow-inner"
                      />
                    </div>
                    <label className="hidden lg:flex items-center space-x-1.5 text-onedark-muted hover:text-onedark-fg text-[11px] cursor-pointer select-none whitespace-nowrap">
                      <input
                        type="checkbox"
                        checked={autoHealEnabled}
                        onChange={(e) => setAutoHealEnabled(e.target.checked)}
                        className="rounded border-onedark-border text-onedark-accent focus:ring-0 cursor-pointer w-3.5 h-3.5"
                      />
                      <span>Auto-heal</span>
                    </label>
                  </div>

                  {/* Right: Primary Run Button & Actions */}
                  <div className="flex items-center space-x-1.5 flex-shrink-0 justify-end">
                    {(localTestOutput || prRecord?.test_output) && (
                      <>
                        <button
                          type="button"
                          onClick={handleClearTestOutput}
                          className="p-1.5 rounded-lg bg-onedark-bg hover:bg-onedark-surface border border-onedark-borderSubtle text-onedark-muted hover:text-onedark-red transition-all cursor-pointer shadow-xs active:scale-95"
                          title="Clear test output and reset status"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={handleCopyTestOutput}
                          className="p-1.5 rounded-lg bg-onedark-bg hover:bg-onedark-surface border border-onedark-borderSubtle text-onedark-muted hover:text-onedark-fg transition-all cursor-pointer shadow-xs active:scale-95"
                          title="Copy test output"
                        >
                          {isTestOutputCopied ? (
                            <Check className="w-3.5 h-3.5 text-onedark-green" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => handleRunTests(customTestCommand)}
                      disabled={Boolean(actionLoading) || testStatus === 'running'}
                      className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-onedark-accent hover:bg-onedark-accent/90 text-white text-xs font-semibold transition-all cursor-pointer disabled:opacity-50 whitespace-nowrap shadow-xs active:scale-95"
                      title="Execute test suite in isolated sandbox worktree"
                    >
                      {actionLoading === 'test' || testStatus === 'running' ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Play className="w-3.5 h-3.5 fill-white" />
                      )}
                      <span>{testStatus === 'running' ? 'Running...' : (localTestOutput || prRecord?.test_output) ? 'Re-Run Tests' : 'Run Tests'}</span>
                    </button>
                  </div>
                </div>

                {/* Running Banner */}
                {testStatus === 'running' && (
                  <div className="flex items-center space-x-3 p-3.5 rounded-xl bg-onedark-accent/10 border border-onedark-accent/30 animate-pulse">
                    <Loader2 className="w-4 h-4 text-onedark-accent animate-spin flex-shrink-0" />
                    <div className="text-xs">
                      <p className="font-semibold text-onedark-fgBright">
                        Executing test suite in isolated PR worktree sandbox...
                      </p>
                      <p className="text-onedark-muted text-[11px] mt-0.5">
                        Capturing live stdout/stderr streams. Process timeout set to 120 seconds.
                      </p>
                    </div>
                  </div>
                )}

                {/* Sub-tab switcher: Autonomous Remediation vs Test Console Output */}
                <div className="flex items-center justify-between border-b border-onedark-borderSubtle/60 px-1 pt-1">
                  <div className="flex items-center space-x-1">
                    <button
                      type="button"
                      onClick={() => setSandboxSubTab('agent')}
                      className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-t-lg text-xs font-medium border-b-2 transition-all cursor-pointer ${
                        sandboxSubTab === 'agent'
                          ? 'border-onedark-accent text-onedark-fgBright bg-onedark-surface/40 font-semibold'
                          : 'border-transparent text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/20'
                      }`}
                    >
                      <Sparkles className={`w-3.5 h-3.5 ${isTestingAgentActive ? 'text-onedark-accent animate-spin' : 'text-onedark-accent'}`} />
                      <span>Autonomous Remediation</span>
                      {isTestingAgentActive ? (
                        <span className="flex h-2 w-2 relative ml-0.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-onedark-accent opacity-75" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-onedark-accent" />
                        </span>
                      ) : (testingAgentSubsessionId || showTestingAgentPanel) ? (
                        <span className="px-1.5 py-0.2 rounded-full bg-onedark-surface text-[9.5px] font-mono text-onedark-muted">
                          active
                        </span>
                      ) : null}
                    </button>

                    <button
                      type="button"
                      onClick={() => setSandboxSubTab('console')}
                      className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-t-lg text-xs font-medium border-b-2 transition-all cursor-pointer ${
                        sandboxSubTab === 'console'
                          ? 'border-onedark-accent text-onedark-fgBright bg-onedark-surface/40 font-semibold'
                          : 'border-transparent text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/20'
                      }`}
                    >
                      <Terminal className="w-3.5 h-3.5 text-onedark-muted" />
                      <span>Test Console Output</span>
                      {(localTestOutput || prRecord?.test_output) && (
                        <span className="px-1.5 py-0.2 rounded-full bg-onedark-surface text-[9.5px] font-mono text-onedark-muted">
                          {(localTestOutput || prRecord?.test_output || '').split('\n').length} lines
                        </span>
                      )}
                    </button>
                  </div>

                  {testCommand && (
                    <div className="hidden sm:flex items-center space-x-1.5 text-[10.5px] text-onedark-muted font-mono pb-1 pr-1">
                      <span>Command:</span>
                      <code className="px-1.5 py-0.5 rounded bg-onedark-surface text-onedark-fgBright">
                        {testCommand}
                      </code>
                    </div>
                  )}
                </div>

                {/* Sub-tab Body */}
                {sandboxSubTab === 'agent' ? (
                  <div className="space-y-3">
                    {(isTestingAgentActive || showTestingAgentPanel || testingAgentSubsessionId) && task?.id ? (
                      <PRTestingAgentPanel
                        taskId={task.id}
                        prNumber={Number(effectivePrNum || 0)}
                        initialSubsessionId={testingAgentSubsessionId}
                        onReRunTests={() => handleRunTests(customTestCommand)}
                        isTestRunning={actionLoading === 'test' || testStatus === 'running'}
                        onActiveChange={setIsTestingAgentActive}
                        onLaunchAgent={() => handleLaunchTestingAgent(localTestOutput || prRecord?.test_output)}
                        testStatus={testStatus}
                        initialFailureOutput={localTestOutput || prRecord?.test_output}
                        testCommand={testCommand || customTestCommand}
                      />
                    ) : testStatus === 'failed' ? (
                      <div className="p-4 rounded-xl border border-onedark-red/30 bg-onedark-red/10 space-y-3 text-xs animate-in fade-in">
                        <div className="flex items-start space-x-3">
                          <div className="p-2 rounded-lg bg-onedark-red/20 text-onedark-red flex-shrink-0 mt-0.5">
                            <AlertCircle className="w-5 h-5" />
                          </div>
                          <div className="space-y-1">
                            <h4 className="font-semibold text-onedark-fgBright text-sm">
                              Test Suite Failed in Sandbox
                            </h4>
                            <p className="text-onedark-muted text-xs leading-relaxed">
                              The test suite encountered errors in the isolated PR worktree sandbox. Launch the autonomous Testing Agent to investigate the stack trace, patch dependencies or code, and re-verify tests.
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center space-x-2 pt-1">
                          <button
                            type="button"
                            onClick={() => handleLaunchTestingAgent(localTestOutput || prRecord?.test_output)}
                            disabled={Boolean(actionLoading)}
                            className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg bg-onedark-accent hover:bg-onedark-accent/90 text-white font-semibold text-xs transition-all shadow-xs active:scale-95 cursor-pointer disabled:opacity-50"
                            title="Dispatches autonomous TestRemediator agent directly inside this PR worktree"
                          >
                            {actionLoading === 'remediate' ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Sparkles className="w-3.5 h-3.5" />
                            )}
                            <span>Resolve with Testing Agent</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-12 px-4 text-center rounded-xl bg-onedark-surface/20 border border-dashed border-onedark-borderSubtle select-none">
                        <div className="w-12 h-12 rounded-xl bg-onedark-surface border border-onedark-border flex items-center justify-center mb-3 text-onedark-accent">
                          <Sparkles className="w-6 h-6" />
                        </div>
                        <h4 className="text-sm font-semibold text-onedark-fgBright">Autonomous Remediation Workspace</h4>
                        <p className="text-xs text-onedark-muted max-w-md mt-1 mb-4 leading-relaxed">
                          When sandbox tests fail or require environment repairs, the Testing Agent can autonomously diagnose stack traces, synthesize fixes, and re-run verification directly in this isolated worktree.
                        </p>
                        <button
                          type="button"
                          onClick={() => handleLaunchTestingAgent()}
                          disabled={Boolean(actionLoading)}
                          className="flex items-center space-x-1.5 px-4 py-2 rounded-lg bg-onedark-accent hover:bg-onedark-accent/90 text-white text-xs font-semibold shadow-md transition-all cursor-pointer disabled:opacity-50 active:scale-95"
                        >
                          <Sparkles className="w-4 h-4" />
                          <span>Launch Remediation Agent</span>
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {localTestOutput || prRecord?.test_output ? (
                      <div className="relative group rounded-xl border border-onedark-border bg-onedark-darker shadow-inner overflow-hidden flex flex-col font-mono text-xs">
                        <div className="flex items-center justify-between px-3 py-1.5 bg-onedark-surface/60 border-b border-onedark-borderSubtle text-[11px] select-none text-onedark-muted">
                          <div className="flex items-center space-x-2">
                            <div className="flex space-x-1.5">
                              <div className="w-2.5 h-2.5 rounded-full bg-onedark-red/60" />
                              <div className="w-2.5 h-2.5 rounded-full bg-onedark-yellow/60" />
                              <div className="w-2.5 h-2.5 rounded-full bg-onedark-green/60" />
                            </div>
                            <span className="text-onedark-muted font-mono text-[10.5px]">console output</span>
                          </div>
                          <div className="flex items-center space-x-3">
                            <span className="text-[10px] text-onedark-muted font-mono">
                              {(localTestOutput || prRecord?.test_output || '').split('\n').length} lines
                            </span>
                            <button
                              type="button"
                              onClick={handleCopyTestOutput}
                              className="flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10.5px] text-onedark-muted hover:text-onedark-fgBright hover:bg-onedark-surface/80 transition-colors cursor-pointer"
                              title="Copy test output"
                            >
                              {isTestOutputCopied ? (
                                <>
                                  <Check className="w-3 h-3 text-onedark-green" />
                                  <span className="text-onedark-green">Copied</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3" />
                                  <span>Copy</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                        <pre className="p-4 text-onedark-fgBright font-mono text-[11.5px] leading-relaxed overflow-x-auto whitespace-pre-wrap max-h-[600px] overflow-y-auto selection:bg-onedark-accent/30 select-text">
                          {localTestOutput || prRecord?.test_output}
                        </pre>
                      </div>
                    ) : testStatus !== 'running' && (
                      <div className="flex flex-col items-center justify-center py-16 px-4 text-center rounded-xl bg-onedark-surface/20 border border-dashed border-onedark-borderSubtle select-none">
                        <div className="w-12 h-12 rounded-xl bg-onedark-surface border border-onedark-border flex items-center justify-center mb-3 text-onedark-accent">
                          <Terminal className="w-6 h-6" />
                        </div>
                        <h4 className="text-sm font-semibold text-onedark-fgBright">No test output recorded yet</h4>
                        <p className="text-xs text-onedark-muted max-w-md mt-1 mb-4 leading-relaxed">
                          Cyclode dynamically discovers test frameworks from CI workflows, package manifests, or PR test diffs, running them in an isolated ephemeral worktree.
                        </p>
                        <button
                          type="button"
                          onClick={() => handleRunTests()}
                          disabled={Boolean(actionLoading)}
                          className="flex items-center space-x-1.5 px-4 py-2 rounded-lg bg-onedark-accent hover:bg-onedark-accent/90 text-white text-xs font-semibold shadow-md transition-all cursor-pointer disabled:opacity-50 active:scale-95"
                        >
                          <Play className="w-4 h-4 fill-white" />
                          <span>Run Test Suite Now</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between px-3 py-2 bg-onedark-surface/50 border border-onedark-borderSubtle rounded-xl text-xs select-none">
                  <span className="font-semibold text-onedark-fgBright">
                    AI Review Report
                  </span>
                </div>
                <div className="p-4 rounded-xl bg-onedark-bg border border-onedark-border text-onedark-fg text-[13.5px] font-sans leading-[1.7]">
                  <MarkdownRenderer content={prRecord?.review_summary || 'No review summary recorded yet. Open "Review with Agent" above to run an interactive audit or ensemble review.'} />
                </div>
              </div>
            )
          )}

          {!isLoading && !error && viewMode === 'webview' && targetUrl && (
            <div className="h-full flex flex-col -m-4">
              <div className="px-3 py-1.5 bg-onedark-surface/80 border-b border-onedark-borderSubtle text-[11px] text-onedark-muted flex items-center justify-between">
                <span>Embedded webview</span>
                <button
                  onClick={() => setViewMode('reader')}
                  className="text-onedark-accent hover:underline font-medium cursor-pointer"
                >
                  Switch to Reader
                </button>
              </div>
              <iframe
                src={targetUrl}
                title={effectiveTitle}
                className="flex-1 w-full border-none bg-white min-h-[500px]"
                sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
              />
            </div>
          )}
        </div>
      </div>

      {/* Review Agent Popover */}
      <PRReviewAgentPopover
        isOpen={isReviewPopoverOpen}
        onClose={() => {
          setIsReviewPopoverOpen(false);
          setActiveLineComment(null);
        }}
        repoName={data?.repo_name || task?.repo_name || ''}
        prNumber={data?.pr_number || prNumber || prRecord?.pr_number || 0}
        prTitle={data?.pr_title || effectiveTitle}
        author={effectiveAuthor}
        headBranch={effectiveHeadBranch}
        baseBranch={effectiveBaseBranch}
        parentTaskId={task?.id}
        modelName={task?.model_name}
        activeLineComment={activeLineComment}
        onClearActiveLineComment={() => setActiveLineComment(null)}
        onNavigateToFileLine={(filename, line) => {
          setPrTab('diff');
        }}
      />
      {/* PR Review Decision Modal */}
      <PRReviewDecisionModal
        isOpen={isReviewDecisionModalOpen}
        onClose={() => setIsReviewDecisionModalOpen(false)}
        prNumber={Number(effectivePrNum) || 0}
        prTitle={data?.title || prRecord?.title}
        initialEvent={initialReviewEvent}
        onSubmitDecision={handleSubmitDecision}
        isLoading={actionLoading === 'decision'}
        isAuthor={isAuthor}
      />

      {/* PR Merge Modal */}
      <PRMergeModal
        isOpen={isMergeModalOpen}
        onClose={() => setIsMergeModalOpen(false)}
        prNumber={Number(effectivePrNum) || 0}
        prTitle={data?.title || prRecord?.title}
        headBranch={effectiveHeadBranch}
        baseBranch={effectiveBaseBranch}
        onConfirmMerge={handleConfirmMerge}
        isLoading={actionLoading === 'merge'}
      />

      {/* Linear Issue Detail Modal */}
      {selectedLinearTicket && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fadeIn"
          onClick={() => setSelectedLinearTicket(null)}
        >
          <div 
            className="w-full max-w-4xl h-[85vh] bg-onedark-darker border border-onedark-border rounded-xl shadow-2xl overflow-hidden flex flex-col animate-slideUp"
            onClick={(e) => e.stopPropagation()}
          >
            <LinearIssueDetailView
              issueKey={selectedLinearTicket}
              onClose={() => setSelectedLinearTicket(null)}
              onImplementWithAgent={onAskAboutComment}
              task={task}
            />
          </div>
        </div>
      )}

      {/* PR Listener Config Modal */}
      {isListenerModalOpen && task && (
        <PRListenerConfigModal
          task={task}
          pr={
            prRecord || {
              task_id: task.id,
              pr_number: Number(effectivePrNum) || 0,
              title: data?.title || '',
              author: data?.author || '',
              head_branch: effectiveHeadBranch,
              base_branch: effectiveBaseBranch,
              html_url: targetUrl || '',
              status: (effectiveState as any) || 'OPEN',
              worktree_path: '',
              is_listening: isListening
            }
          }
          isOpen={isListenerModalOpen}
          onClose={() => setIsListenerModalOpen(false)}
          onSaved={(newListening) => {
            setIsListening(newListening);
          }}
        />
      )}
    </div>
  );
};
