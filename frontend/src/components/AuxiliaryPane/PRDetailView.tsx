import React, { useState, useEffect, useMemo, useRef } from 'react';
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
  List, 
  ListTree, 
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
  Download, 
  AlertCircle, 
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
  Tag
} from 'lucide-react';
import { MarkdownRenderer } from '../Common/MarkdownRenderer';
import { PRReviewAgentPopover, LineContext } from './PRReviewAgentPopover';
import { Task, TaskPR, PRCommentItem } from '../../types';
import { useWebSocket } from '../../contexts/WebSocketContext';

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
  head_branch?: string;
  base_branch?: string;
  additions?: number;
  deletions?: number;
  changed_files_count?: number;
  repo_name?: string;
  clone_url?: string;
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
}

export const PRDiffSection: React.FC<PRDiffSectionProps> = ({ files, diffText, onLineComment, title }) => {
  const [collapsedFiles, setCollapsedFiles] = useState<Record<string, boolean>>({});
  const [copiedFile, setCopiedFile] = useState<string | null>(null);
  const [fileFilter, setFileFilter] = useState<string>('');

  const toggleFile = (filename: string) => {
    setCollapsedFiles((prev) => ({ ...prev, [filename]: !prev[filename] }));
  };

  const handleCopyPath = (filename: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(filename);
    setCopiedFile(filename);
    setTimeout(() => setCopiedFile(null), 1500);
  };

  const filteredFiles = useMemo(() => {
    if (!fileFilter.trim()) return files;
    const q = fileFilter.toLowerCase();
    return files.filter(f => f.filename.toLowerCase().includes(q));
  }, [files, fileFilter]);

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
        <span className="px-1.5 py-0.2 rounded text-[9.5px] uppercase font-mono bg-onedark-green/15 text-onedark-green border border-onedark-green/30">
          + Added
        </span>
      );
    }
    if (s === 'deleted' || s === 'removed') {
      return (
        <span className="px-1.5 py-0.2 rounded text-[9.5px] uppercase font-mono bg-onedark-red/15 text-onedark-red border border-onedark-red/30">
          - Deleted
        </span>
      );
    }
    if (s === 'renamed') {
      return (
        <span className="px-1.5 py-0.2 rounded text-[9.5px] uppercase font-mono bg-onedark-purple/15 text-onedark-purple border border-onedark-purple/30">
          ➔ Renamed
        </span>
      );
    }
    return (
      <span className="px-1.5 py-0.2 rounded text-[9.5px] uppercase font-mono bg-onedark-blue/15 text-onedark-blue border border-onedark-blue/30">
        ~ Modified
      </span>
    );
  };

  return (
    <div className="space-y-4 select-text">
      {/* Files Summary & Filter Bar */}
      <div className="px-3 py-2 bg-onedark-surface/50 border border-onedark-borderSubtle rounded-xl flex flex-wrap items-center justify-between gap-2 text-xs select-none">
        <div className="flex items-center space-x-2">
          <span className="font-semibold text-onedark-fgBright">
            {title || `Files Changed (${files.length})`}
          </span>
          {files.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-onedark-surface text-[10.5px] font-mono text-onedark-muted border border-onedark-border">
              {files.reduce((acc, f) => acc + (f.additions || 0), 0).toLocaleString()} additions, {files.reduce((acc, f) => acc + (f.deletions || 0), 0).toLocaleString()} deletions
            </span>
          )}
        </div>

        <div className="flex items-center space-x-2">
          {files.length > 3 && (
            <div className="relative">
              <Search className="w-3 h-3 text-onedark-muted absolute left-2 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={fileFilter}
                onChange={(e) => setFileFilter(e.target.value)}
                placeholder="Filter files..."
                className="w-36 pl-6 pr-2 py-0.5 text-[10.5px] rounded bg-onedark-bg border border-onedark-border text-onedark-fg placeholder:text-onedark-muted focus:outline-none focus:border-onedark-accent"
              />
            </div>
          )}

          <button
            onClick={() => {
              const allCollapsed = filteredFiles.every((f) => collapsedFiles[f.filename]);
              const next: Record<string, boolean> = {};
              filteredFiles.forEach((f) => {
                next[f.filename] = !allCollapsed;
              });
              setCollapsedFiles(next);
            }}
            className="text-[11px] text-onedark-accent hover:underline cursor-pointer font-medium"
          >
            {filteredFiles.every((f) => collapsedFiles[f.filename]) ? 'Expand all' : 'Collapse all'}
          </button>
        </div>
      </div>

      {/* Render Each File Diff */}
      <div className="space-y-3">
        {filteredFiles.map((f, idx) => {
          const isCollapsed = collapsedFiles[f.filename] ?? false;
          const parsedLines = f.patch ? parseUnifiedPatch(f.patch) : [];
          const pathParts = f.filename.split('/');
          const fileNameOnly = pathParts.pop();
          const dirPath = pathParts.join('/');

          return (
            <div
              key={`${f.filename}-${idx}`}
              className="rounded-xl border border-onedark-border overflow-hidden bg-onedark-darker transition-colors"
            >
              {/* File Header */}
              <div
                onClick={() => toggleFile(f.filename)}
                className="px-3 py-2 bg-onedark-surface/40 hover:bg-onedark-surface/60 border-b border-onedark-borderSubtle/60 flex items-center justify-between cursor-pointer select-none gap-2"
              >
                <div className="flex items-center space-x-2 min-w-0 flex-1">
                  <ChevronDown
                    className={`w-3.5 h-3.5 text-onedark-muted transition-transform duration-150 flex-shrink-0 ${
                      isCollapsed ? '-rotate-90' : ''
                    }`}
                  />
                  <FileCode2 className="w-3.5 h-3.5 text-onedark-accent flex-shrink-0" />
                  <span className="font-mono text-xs truncate" title={f.filename}>
                    {dirPath && <span className="text-onedark-muted/70">{dirPath}/</span>}
                    <span className="text-onedark-fgBright font-semibold">{fileNameOnly}</span>
                  </span>
                  {getStatusBadge(f.status)}
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
                  {parsedLines.length > 0 ? (
                    parsedLines.map((lineObj, lineIdx) => {
                      const isAddition = lineObj.type === 'addition';
                      const isDeletion = lineObj.type === 'deletion';
                      const isHeader = lineObj.type === 'header';
                      const activeLineNum = lineObj.newLine || lineObj.oldLine || 1;

                      return (
                        <div
                          key={lineIdx}
                          className={`group/line flex items-center px-1 py-0.5 rounded-xs transition-colors relative ${
                            isAddition
                              ? 'bg-onedark-green/10 text-[#98C379] hover:bg-onedark-green/15'
                              : isDeletion
                              ? 'bg-onedark-red/10 text-[#E06C75] hover:bg-onedark-red/15'
                              : isHeader
                              ? 'text-onedark-purple bg-onedark-surface/40 font-semibold'
                              : 'text-onedark-fg/90 hover:bg-onedark-surface/30'
                          }`}
                        >
                          {!isHeader ? (
                            <div className="flex items-center flex-shrink-0 w-20 text-[11px] font-mono text-onedark-muted/40 select-none mr-2 border-r border-onedark-borderSubtle/40 pr-1.5 justify-between">
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
                            <div className="w-20 text-[11px] font-mono text-onedark-purple/60 select-none mr-2 border-r border-onedark-borderSubtle/40 pr-1.5 text-center flex-shrink-0">
                              @@
                            </div>
                          )}

                          <pre className="font-mono text-[12.5px] leading-relaxed whitespace-pre flex-1 overflow-x-visible">
                            {lineObj.text || ' '}
                          </pre>
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-onedark-muted italic py-1 px-2 text-xs font-sans">
                      Binary file change or empty patch
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

    let colorClass = 'bg-onedark-blue/15 text-onedark-blue border-onedark-blue/30';
    if (['feat', 'feature'].includes(rawType)) {
      colorClass = 'bg-onedark-green/15 text-onedark-green border-onedark-green/30';
    } else if (['fix', 'bugfix', 'hotfix', 'patch'].includes(rawType)) {
      colorClass = 'bg-onedark-yellow/15 text-onedark-yellow border-onedark-yellow/30';
    } else if (['perf', 'refactor', 'style'].includes(rawType)) {
      colorClass = 'bg-onedark-purple/15 text-onedark-purple border-onedark-purple/30';
    } else if (['test', 'ci', 'build', 'chore', 'docs'].includes(rawType)) {
      colorClass = 'bg-onedark-surface text-onedark-muted border-onedark-borderSubtle';
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
  onLineComment?: (filename: string, line: number, content: string) => void;
}

export const PRCommitsSection: React.FC<PRCommitsSectionProps> = ({ commits, repoName, onLineComment }) => {
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
              className="rounded-xl border border-onedark-border bg-onedark-darker overflow-hidden hover:border-onedark-borderSubtle transition-all shadow-xs"
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
                      <div className="mt-2.5 bg-onedark-bg/95 p-3.5 rounded-lg border border-onedark-borderSubtle/80 text-[12.5px] text-onedark-fg/90 font-sans leading-relaxed shadow-xs select-text">
                        {parsed.bodyProse && (
                          <div>
                            <div className={`prose prose-invert max-w-none text-onedark-fg/95 text-[12.5px] leading-relaxed ${!isBodyExpanded && parsed.bodyProse.length > 220 ? 'line-clamp-3' : ''}`}>
                              <MarkdownRenderer content={parsed.bodyProse} className="text-[12.5px] leading-relaxed text-onedark-fg/95" />
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
                          <div className={`flex flex-wrap items-center gap-1.5 ${parsed.bodyProse ? 'mt-3 pt-2.5 border-t border-onedark-borderSubtle/60' : ''}`}>
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

      <div className="overflow-x-auto divide-y divide-onedark-borderSubtle/20 max-h-64 leading-tight">
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
              <span className="w-7 text-right select-none opacity-40 font-mono text-[10px] pr-2 flex-shrink-0 border-r border-onedark-borderSubtle/40">
                {line.newLine || ''}
              </span>
              <span className="w-4 text-center select-none font-bold text-xs flex-shrink-0">
                {isAddition ? '+' : isDeletion ? '-' : ' '}
              </span>
              <pre className="font-mono whitespace-pre flex-1 text-[11px] overflow-x-auto pl-1 leading-snug">
                {line.text.slice(1) || ' '}
              </pre>
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
}

export function parseBotReviewComment(rawBody?: string): ParsedBotComment {
  if (!rawBody) return { cleanBody: '' };

  let category: ParsedBotComment['category'] = undefined;
  let severity: ParsedBotComment['severity'] = undefined;
  let effort: ParsedBotComment['effort'] = undefined;
  let aiPrompt: string | undefined = undefined;

  // Extract AI prompt block if available: <details><summary>...Prompt for AI Agents...</summary>...
  const promptMatch = rawBody.match(/(?:<details>\s*<summary>[\s\S]*?Prompt for AI Agents[\s\S]*?<\/summary>([\s\S]*?)<\/details>|>\s*🤖\s*Prompt for AI Agents[\r\n]+(?:```(?:[a-zA-Z0-9_-]+)?\s*([\s\S]*?)```|([\s\S]*?)(?=\n\n|\n[#<]|$)))/i);
  if (promptMatch) {
    aiPrompt = (promptMatch[1] || promptMatch[2] || promptMatch[3] || '').trim();
    aiPrompt = aiPrompt.replace(/^```[a-zA-Z0-9_-]*\s*/, '').replace(/\s*```$/, '').trim();
  }

  const lines = rawBody.split('\n');
  const cleanLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

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
          category = { label: 'Functional Correctness', colorClass: 'bg-onedark-purple/15 text-onedark-purple border-onedark-purple/30' };
        } else if (lower.includes('security') || lower.includes('vulnerability') || lower.includes('cve')) {
          category = { label: 'Security', colorClass: 'bg-onedark-red/15 text-onedark-red border-onedark-red/30' };
        } else if (lower.includes('performance') || lower.includes('speed') || lower.includes('optimization')) {
          category = { label: 'Performance', colorClass: 'bg-onedark-yellow/15 text-onedark-yellow border-onedark-yellow/30' };
        } else if (lower.includes('refactor') || lower.includes('clean') || lower.includes('maintainability')) {
          category = { label: 'Refactor', colorClass: 'bg-onedark-blue/15 text-onedark-blue border-onedark-blue/30' };
        } else if (lower.includes('doc') || lower.includes('style') || lower.includes('typo')) {
          category = { label: 'Documentation', colorClass: 'bg-onedark-surface text-onedark-fg border-onedark-borderSubtle' };
        }

        // Severity
        if (lower.includes('critical') || lower.includes('blocker')) {
          severity = { label: 'Critical', colorClass: 'bg-onedark-red/20 text-onedark-red border-onedark-red/40 font-bold' };
        } else if (lower.includes('major')) {
          severity = { label: 'Major', colorClass: 'bg-onedark-yellow/20 text-onedark-yellow border-onedark-yellow/40 font-bold' };
        } else if (lower.includes('minor')) {
          severity = { label: 'Minor', colorClass: 'bg-onedark-surface text-onedark-fgBright border-onedark-borderSubtle' };
        } else if (lower.includes('nitpick') || lower.includes('trivial') || lower.includes('info')) {
          severity = { label: 'Nitpick', colorClass: 'bg-onedark-blue/15 text-onedark-blue border-onedark-blue/30' };
        }

        // Effort
        if (lower.includes('quick win') || lower.includes('quick')) {
          effort = { label: 'Quick win', colorClass: 'bg-onedark-green/15 text-onedark-green border-onedark-green/30' };
        } else if (lower.includes('complex') || lower.includes('high effort')) {
          effort = { label: 'High effort', colorClass: 'bg-onedark-purple/15 text-onedark-purple border-onedark-purple/30' };
        }
      }
      continue;
    }

    cleanLines.push(lines[i]);
  }

  return { category, severity, effort, aiPrompt, cleanBody: cleanLines.join('\n').trim() };
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
  const [newCommentText, setNewCommentText] = useState<string>('');
  const [replyingTo, setReplyingTo] = useState<PRCommentItem | null>(null);
  const [isPosting, setIsPosting] = useState<boolean>(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [postSuccess, setPostSuccess] = useState<boolean>(false);
  const [expandedDiffHunks, setExpandedDiffHunks] = useState<Record<string, boolean>>({});
  const [copiedPromptId, setCopiedPromptId] = useState<string | null>(null);

  const conversationCount = useMemo(() => comments.filter(c => c.type === 'conversation').length, [comments]);
  const codeCount = useMemo(() => comments.filter(c => c.type === 'code_comment').length, [comments]);
  const reviewCount = useMemo(() => comments.filter(c => c.type === 'review').length, [comments]);

  const filteredComments = useMemo(() => {
    return comments.filter((c) => {
      if (filter === 'CONVERSATION' && c.type !== 'conversation') return false;
      if (filter === 'CODE' && c.type !== 'code_comment') return false;
      if (filter === 'REVIEWS' && c.type !== 'review') return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesAuthor = c.author?.toLowerCase().includes(q);
        const matchesBody = c.body?.toLowerCase().includes(q);
        const matchesPath = c.path?.toLowerCase().includes(q);
        return matchesAuthor || matchesBody || matchesPath;
      }
      return true;
    });
  }, [comments, filter, searchQuery]);

  const handlePost = async () => {
    const text = newCommentText.trim();
    if (!text || !task?.id || !prNumber) return;
    setIsPosting(true);
    setPostError(null);
    setPostSuccess(false);

    try {
      const apiBase = import.meta.env.VITE_API_URL || '';
      const res = await fetch(`${apiBase}/api/tasks/${task.id}/prs/${prNumber}/comments`, {
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

      setNewCommentText('');
      setReplyingTo(null);
      setPostSuccess(true);
      setTimeout(() => setPostSuccess(false), 3000);
      if (onRefreshComments) {
        await onRefreshComments();
      }
    } catch (err: any) {
      setPostError(err.message || 'Failed to post comment');
    } finally {
      setIsPosting(false);
    }
  };

  const toggleDiffHunk = (commentId: string) => {
    setExpandedDiffHunks(prev => ({ ...prev, [commentId]: !prev[commentId] }));
  };

  return (
    <div className="space-y-4 font-sans text-xs">
      {/* Top Controls: Category Tabs, Search, and Auto-Sync Status */}
      <div className="flex flex-col gap-2.5 bg-onedark-surface/40 p-3 rounded-xl border border-onedark-borderSubtle">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Filter Chips */}
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
          </div>

          {/* Auto-Sync Indicator & Refresh Button */}
          <div className="flex items-center space-x-2 text-[11px] text-onedark-muted">
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
            placeholder="Search discussion comments, code reviews, authors..."
            className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-onedark-darker border border-onedark-borderSubtle text-xs text-onedark-fg placeholder-onedark-muted focus:outline-hidden focus:border-onedark-accent/60"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-onedark-muted hover:text-onedark-fg"
            >
              <X className="w-3 h-3" />
            </button>
          )}
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

          return (
            <div
              key={c.id}
              className={`rounded-xl border transition-all overflow-hidden ${
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
              {/* Comment Header */}
              <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-onedark-borderSubtle/60 bg-onedark-surface/60 gap-2">
                <div className="flex items-center space-x-2.5 min-w-0 flex-wrap gap-y-1">
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
                </div>

                <div className="flex items-center space-x-2 text-onedark-muted flex-shrink-0">
                  <span className="text-[11px] font-mono">
                    {formatCommentTimeAgo(c.created_at)}
                  </span>
                  {c.html_url && (
                    <a
                      href={c.html_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="View on GitHub"
                      className="hover:text-onedark-fgBright transition-colors p-0.5"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </div>

              {/* Bot Metadata Chip Bar (Category, Severity, Effort) */}
              {(botMeta.category || botMeta.severity || botMeta.effort) && (
                <div className="flex items-center gap-1.5 flex-wrap px-3.5 pt-2.5 pb-1 bg-onedark-surface/30 border-b border-onedark-borderSubtle/40">
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

              {/* Code Comment Anchor & Diff Snippet Context */}
              {isCodeComment && (c.diff_hunk || c.path) && (
                <div className="px-3.5 py-2 bg-onedark-darker/40 border-b border-onedark-borderSubtle/60">
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
              <div className="px-4 py-3 text-onedark-fg text-xs leading-relaxed select-text space-y-3">
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

                    <pre className="p-2.5 rounded-lg bg-black/40 border border-onedark-borderSubtle text-[11px] font-mono text-onedark-fg/90 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto select-text">
                      {botMeta.aiPrompt}
                    </pre>
                  </div>
                )}
              </div>

              {/* Comment Footer: Reactions & Actions */}
              <div className="px-3.5 py-2 border-t border-onedark-borderSubtle/40 bg-onedark-surface/20 rounded-b-xl flex items-center justify-between gap-2">
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
            </div>
          );
        })}
      </div>

      {/* Interactive Comment Composer */}
      {task?.id && prNumber && (
        <div className="mt-6 p-3.5 rounded-xl border border-onedark-border bg-onedark-darker/90 shadow-sm space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-onedark-fgBright text-xs flex items-center space-x-1.5">
              <MessageSquarePlus className="w-3.5 h-3.5 text-onedark-accent" />
              <span>{replyingTo ? `Reply to @${replyingTo.author}` : 'Add a comment'}</span>
            </span>

            {replyingTo && (
              <button
                onClick={() => setReplyingTo(null)}
                className="text-[11px] text-onedark-muted hover:text-onedark-fg flex items-center space-x-1 cursor-pointer"
              >
                <span>Cancel reply</span>
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {replyingTo && (
            <div className="p-2 rounded-lg bg-onedark-surface/60 border border-onedark-borderSubtle text-[11px] text-onedark-muted line-clamp-2 italic">
              &quot;{replyingTo.body.slice(0, 140)}...&quot;
            </div>
          )}

          <textarea
            id="pr-comment-composer-input"
            rows={3}
            value={newCommentText}
            onChange={(e) => setNewCommentText(e.target.value)}
            placeholder={
              replyingTo
                ? `Reply to @${replyingTo.author}... (Markdown supported)`
                : 'Leave a comment on this pull request... (Markdown supported)'
            }
            className="w-full p-2.5 rounded-lg bg-onedark-bg border border-onedark-borderSubtle text-xs text-onedark-fg placeholder-onedark-muted focus:outline-hidden focus:border-onedark-accent leading-relaxed resize-y min-h-[70px]"
          />

          {postError && (
            <div className="text-[11px] text-onedark-red flex items-center space-x-1">
              <AlertCircle className="w-3 h-3" />
              <span>{postError}</span>
            </div>
          )}

          {postSuccess && (
            <div className="text-[11px] text-onedark-green flex items-center space-x-1">
              <Check className="w-3 h-3" />
              <span>Comment posted successfully!</span>
            </div>
          )}

          <div className="flex items-center justify-between pt-1">
            <span className="text-[10px] text-onedark-muted">
              Supports GitHub Flavored Markdown
            </span>

            <button
              onClick={handlePost}
              disabled={isPosting || !newCommentText.trim()}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-onedark-accent text-onedark-bg hover:brightness-110 active:scale-95 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
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
      )}
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
  const [prTab, setPrTab] = useState<'overview' | 'diff' | 'commits' | 'comments' | 'tests' | 'review'>('overview');
  const [comments, setComments] = useState<PRCommentItem[]>([]);
  const [isSyncingComments, setIsSyncingComments] = useState<boolean>(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  const { subscribe } = useWebSocket();

  const [isReviewPopoverOpen, setIsReviewPopoverOpen] = useState<boolean>(false);
  const [activeLineComment, setActiveLineComment] = useState<LineContext | null>(null);
  const [isOutlineOpen, setIsOutlineOpen] = useState<boolean>(false);

  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const contentScrollRef = useRef<HTMLDivElement>(null);
  const outlinePopoverRef = useRef<HTMLDivElement>(null);

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

  // WebSocket live auto-sync listener for PR comments
  useEffect(() => {
    if (!task?.id || !effectivePrNum) return;
    const unsub = subscribe('PR_COMMENTS_UPDATED', (payload: any) => {
      if (payload.task_id === task.id || Number(payload.pr_number) === Number(effectivePrNum)) {
        fetchCommentsOnly();
      }
    });
    return () => unsub();
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
  const handleRunTests = async () => {
    const effectivePrNum = data?.pr_number || prNumber || prRecord?.pr_number;
    if (!task?.id || !effectivePrNum) return;
    setActionLoading('test');
    try {
      const apiBase = import.meta.env.VITE_API_URL || '';
      await fetch(`${apiBase}/api/tasks/${task.id}/prs/${effectivePrNum}/run_tests`, {
        method: 'POST'
      });
      setPrTab('tests');
    } catch (e) {
      console.error('Error running PR sandbox tests:', e);
    } finally {
      setActionLoading(null);
    }
  };

  const handleGenerateReview = async () => {
    const effectivePrNum = data?.pr_number || prNumber || prRecord?.pr_number;
    if (!task?.id || !effectivePrNum) return;
    setActionLoading('review');
    try {
      const apiBase = import.meta.env.VITE_API_URL || '';
      await fetch(`${apiBase}/api/tasks/${task.id}/prs/${effectivePrNum}/generate_review`, {
        method: 'POST'
      });
      setPrTab('review');
    } catch (e) {
      console.error('Error generating AI review:', e);
    } finally {
      setActionLoading(null);
    }
  };

  // Extract on-page headings for Table of Contents
  const headings = useMemo<HeadingItem[]>(() => {
    const md = data?.overview_markdown || data?.content_markdown || prRecord?.body || '';
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

  const scrollToHeading = (id: string) => {
    if (!contentScrollRef.current) return;
    const target = contentScrollRef.current.querySelector(`[id="${id}"]`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setIsOutlineOpen(false);
    }
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (outlinePopoverRef.current && !outlinePopoverRef.current.contains(e.target as Node)) {
        setIsOutlineOpen(false);
      }
    };
    if (isOutlineOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOutlineOpen]);

  const effectiveTitle = data?.title || prRecord?.title || `Pull Request #${data?.pr_number || prNumber || prRecord?.pr_number || ''}`;
  const effectiveState = (data?.state || prRecord?.status || 'OPEN').toUpperCase();
  const effectiveAuthor = data?.author || prRecord?.author;
  const effectiveHeadBranch = data?.head_branch || prRecord?.head_branch;
  const effectiveBaseBranch = data?.base_branch || prRecord?.base_branch || 'main';
  const effectiveAdditions = data?.additions ?? prRecord?.diff_stats?.additions;
  const effectiveDeletions = data?.deletions ?? prRecord?.diff_stats?.deletions;

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
          {/* Table of Contents / Outline Popover */}
          {headings.length > 1 && (
            <div className="relative" ref={outlinePopoverRef}>
              <button
                onClick={() => setIsOutlineOpen(!isOutlineOpen)}
                className={`flex items-center space-x-1 px-2 py-1 rounded text-xs transition-all border cursor-pointer whitespace-nowrap flex-shrink-0 ${
                  isOutlineOpen
                    ? 'bg-onedark-accent/20 border-onedark-accent/40 text-onedark-accent font-semibold'
                    : 'bg-onedark-surface/60 border-onedark-borderSubtle text-onedark-muted hover:text-onedark-fg'
                }`}
                title="Table of Contents (Jump to section)"
              >
                <List className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="hidden md:inline text-[11px] whitespace-nowrap">Outline</span>
                <span className="px-1 py-0.2 rounded-full bg-onedark-surface text-[10px] text-onedark-muted font-mono">
                  {headings.length}
                </span>
              </button>

              {isOutlineOpen && (
                <div className="absolute right-0 mt-1.5 w-64 max-h-80 overflow-y-auto rounded-xl border border-onedark-border bg-onedark-bg shadow-xl z-50 p-2 space-y-0.5">
                  <div className="flex items-center justify-between px-2 py-1 border-b border-onedark-borderSubtle mb-1 text-[11px] font-semibold text-onedark-fgBright">
                    <span>Table of Contents</span>
                    <button
                      onClick={() => setIsOutlineOpen(false)}
                      className="text-onedark-muted hover:text-onedark-fg p-0.5 rounded cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  {headings.map((h, idx) => (
                    <button
                      key={`${h.id}-${idx}`}
                      onClick={() => scrollToHeading(h.id)}
                      className={`w-full text-left truncate py-1 px-2 rounded hover:bg-onedark-surface transition-colors text-xs cursor-pointer ${
                        h.level === 1
                          ? 'font-bold text-onedark-fgBright'
                          : h.level === 2
                          ? 'pl-3.5 font-medium text-onedark-fg'
                          : 'pl-6 text-onedark-muted text-[11px]'
                      }`}
                      title={h.title}
                    >
                      {h.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
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
        <div className="px-3 py-2 flex flex-wrap items-center justify-between gap-2 border-b border-onedark-borderSubtle/60 text-xs">
          {/* Metadata Row */}
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            {/* Status Badge */}
            <span className={`px-2 py-0.5 rounded-full font-mono text-[10.5px] font-bold border uppercase whitespace-nowrap flex-shrink-0 ${
              effectiveState === 'MERGED'
                ? 'bg-onedark-purple/20 text-onedark-purple border-onedark-purple/40'
                : effectiveState === 'CLOSED'
                ? 'bg-onedark-red/20 text-onedark-red border-onedark-red/40'
                : 'bg-onedark-green/20 text-onedark-green border-onedark-green/40'
            }`}>
              {effectiveState === 'MERGED' ? '● Merged' : effectiveState === 'CLOSED' ? '● Closed' : '● Open'}
            </span>

            {/* Author */}
            {effectiveAuthor && (
              <span className="text-onedark-muted flex items-center space-x-1 whitespace-nowrap flex-shrink-0">
                <span>by</span>
                <span className="font-semibold text-onedark-fgBright">@{effectiveAuthor}</span>
              </span>
            )}

            {/* Branch Flow */}
            {effectiveHeadBranch && effectiveBaseBranch && (
              <div className="flex items-center space-x-1 font-mono text-[11px] bg-onedark-bg/80 px-2 py-0.5 rounded border border-onedark-borderSubtle whitespace-nowrap flex-shrink-0">
                <span className="text-onedark-accent font-semibold">{effectiveHeadBranch}</span>
                <span className="text-onedark-muted">➔</span>
                <span className="text-onedark-muted">{effectiveBaseBranch}</span>
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
          </div>

          {/* Action Toolbar */}
          <div className="flex flex-wrap items-center gap-1.5 flex-shrink-0">
            {/* Run Tests Button */}
            <button
              onClick={handleRunTests}
              disabled={Boolean(actionLoading)}
              className="flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-onedark-surface hover:bg-onedark-surface/80 border border-onedark-border text-[11px] text-onedark-fgBright font-medium transition-all cursor-pointer shadow-xs disabled:opacity-50 whitespace-nowrap flex-shrink-0"
              title="Run test suite in ephemeral container"
            >
              {actionLoading === 'test' ? (
                <Loader2 className="w-3.5 h-3.5 text-onedark-accent animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5 text-onedark-green fill-onedark-green" />
              )}
              <span>Run Tests</span>
            </button>

            {/* AI Review Button */}
            <button
              onClick={handleGenerateReview}
              disabled={Boolean(actionLoading)}
              className="flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-onedark-surface hover:bg-onedark-surface/80 border border-onedark-border text-[11px] text-onedark-fgBright font-medium transition-all cursor-pointer shadow-xs disabled:opacity-50 whitespace-nowrap flex-shrink-0"
              title="Generate comprehensive AI code review report"
            >
              {actionLoading === 'review' ? (
                <Loader2 className="w-3.5 h-3.5 text-onedark-purple animate-spin" />
              ) : (
                <ShieldCheck className="w-3.5 h-3.5 text-onedark-purple" />
              )}
              <span>AI Review</span>
            </button>

            {/* Review with Agent Popover Button */}
            <button
              onClick={() => setIsReviewPopoverOpen(!isReviewPopoverOpen)}
              className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-all cursor-pointer shadow-xs whitespace-nowrap flex-shrink-0 ${
                isReviewPopoverOpen
                  ? 'bg-onedark-accent/20 border-onedark-accent/50 text-onedark-accent font-semibold ring-1 ring-onedark-accent/30'
                  : 'bg-onedark-surface hover:bg-onedark-surface/80 border-onedark-border text-onedark-fgBright'
              }`}
              title="Open interactive PR Reviewer Agent sub-session launcher"
            >
              <Bot className="w-3.5 h-3.5 text-onedark-accent" />
              <span>Review with Agent</span>
            </button>

            {onCloneToSession && data?.clone_url && (
              <button
                onClick={() => onCloneToSession(data.clone_url!, data.repo_name || '')}
                className="flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-onedark-accent/20 hover:bg-onedark-accent/30 border border-onedark-accent/40 text-onedark-accent text-[11px] font-semibold transition-all cursor-pointer shadow-xs whitespace-nowrap flex-shrink-0"
                title="Clone PR repository into current session sandbox"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Clone to Session</span>
              </button>
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

          {prRecord?.test_output && (
            <button
              onClick={() => setPrTab('tests')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-t-md text-xs font-medium border-b-2 transition-all cursor-pointer whitespace-nowrap flex-shrink-0 ${
                prTab === 'tests'
                  ? 'border-onedark-accent text-onedark-fgBright bg-onedark-darker font-semibold'
                  : 'border-transparent text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/40'
              }`}
            >
              <Terminal className="w-3.5 h-3.5 text-onedark-green flex-shrink-0" />
              <span>Test Output</span>
            </button>
          )}

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

      {/* Main PR Body Viewport */}
      <div ref={contentScrollRef} className="flex-1 overflow-y-auto p-4 select-text">
        {isLoading && (
          <div className="space-y-4 animate-pulse pt-2">
            <div className="h-5 bg-onedark-surface/80 rounded w-1/2"></div>
            <div className="h-3 bg-onedark-surface/60 rounded w-5/6"></div>
            <div className="h-3 bg-onedark-surface/50 rounded w-4/6"></div>
            <div className="h-24 bg-onedark-surface/40 rounded-lg"></div>
            <div className="h-3 bg-onedark-surface/50 rounded w-full"></div>
            <div className="h-3 bg-onedark-surface/50 rounded w-3/4"></div>
          </div>
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
            <div className="prose prose-invert max-w-none text-onedark-fg text-[13.5px] leading-relaxed">
              <MarkdownRenderer
                content={data?.overview_markdown || data?.content_markdown || prRecord?.body || 'No description provided for this pull request.'}
              />
            </div>
          ) : prTab === 'diff' ? (
            <PRDiffSection 
              files={data?.files || []} 
              diffText={data?.diff_text} 
              onLineComment={(filename, line, content) => {
                setActiveLineComment({ filename, line, content });
                setIsReviewPopoverOpen(true);
              }}
            />
          ) : prTab === 'commits' ? (
            <PRCommitsSection 
              commits={data?.commits || []} 
              repoName={data?.repo_name || task?.repo_name}
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
              onJumpToDiff={() => {
                setPrTab('diff');
              }}
            />
          ) : prTab === 'tests' ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between px-3 py-2 bg-onedark-surface/50 border border-onedark-borderSubtle rounded-xl text-xs select-none">
                <span className="font-semibold text-onedark-fgBright">
                  Sandbox Test Execution Logs
                </span>
              </div>
              <pre className="p-3 rounded-xl bg-onedark-bg border border-onedark-border text-onedark-fg font-mono text-xs overflow-x-auto whitespace-pre-wrap leading-relaxed">
                {prRecord?.test_output || 'No test output recorded yet. Click "Run Tests" above to execute tests.'}
              </pre>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between px-3 py-2 bg-onedark-surface/50 border border-onedark-borderSubtle rounded-xl text-xs select-none">
                <span className="font-semibold text-onedark-fgBright">
                  AI Review Report
                </span>
              </div>
              <div className="p-4 rounded-xl bg-onedark-bg border border-onedark-border text-onedark-fg text-xs font-sans leading-relaxed">
                <MarkdownRenderer content={prRecord?.review_summary || 'No review summary generated yet. Click "AI Review" above to analyze.'} />
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
        activeLineComment={activeLineComment}
        onClearActiveLineComment={() => setActiveLineComment(null)}
        onNavigateToFileLine={(filename, line) => {
          setPrTab('diff');
        }}
      />
    </div>
  );
};
