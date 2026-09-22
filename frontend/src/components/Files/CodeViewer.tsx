import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { 
  FileCode, 
  Copy, 
  Check, 
  RefreshCw, 
  AlertCircle, 
  Code2, 
  WrapText, 
  Play, 
  ExternalLink,
  MessageSquarePlus,
  Bot,
  Sparkles,
  Zap,
  TestTube,
  ShieldCheck,
  Bug,
  X
} from 'lucide-react';
import { highlightCode, resolveLanguage, escapeHtml } from '../../utils/syntaxHighlighter';

export interface LineContext {
  filename: string;
  startLine: number;
  endLine: number;
  content: string;
}

interface CodeViewerProps {
  taskId: string;
  filePath: string | null;
  targetLine?: number | null;
  onFileNotFound?: () => void;
  onClose?: () => void;
  onAskAboutLine?: (context: LineContext, initialPrompt?: string) => void;
  onOpenAgentChat?: () => void;
}

interface FileContentResponse {
  path: string;
  name: string;
  content: string;
  size: number;
  lines: number;
  total_lines?: number;
  language: string;
  start_line?: number;
  end_line?: number;
  is_truncated?: boolean;
  is_binary?: boolean;
}

const API_BASE = import.meta.env.VITE_API_URL || '';

export const CodeViewer: React.FC<CodeViewerProps> = ({ 
  taskId, 
  filePath, 
  targetLine,
  onFileNotFound,
  onAskAboutLine,
  onOpenAgentChat
}) => {
  const [data, setData] = useState<FileContentResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [wrapLines, setWrapLines] = useState(false);
  const [viewMode, setViewMode] = useState<'code' | 'preview'>('code');
  const [previewReloadKey, setPreviewReloadKey] = useState<number>(0);
  const [activeHighlightLine, setActiveHighlightLine] = useState<number | null>(null);

  // Virtualized Viewport State (20px fixed row height)
  const ROW_HEIGHT = 20;
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Floating Selection State
  const [selectionRange, setSelectionRange] = useState<{
    startLine: number;
    endLine: number;
    text: string;
    top: number;
    left: number;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    setViewportHeight(el.clientHeight || 600);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.height > 0) {
          setViewportHeight(entry.contentRect.height);
        }
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  };

  useEffect(() => {
    if (!taskId || !filePath) {
      setData(null);
      return;
    }

    let isMounted = true;
    const fetchContent = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `${API_BASE}/api/tasks/${taskId}/files/content?path=${encodeURIComponent(filePath)}`
        );
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.detail || `Failed to read file (${res.status})`);
        }
        const json = await res.json();
        if (isMounted) {
          setData(json);
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err.message || 'Error loading file');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchContent();
    return () => {
      isMounted = false;
    };
  }, [taskId, filePath]);

  const handleLoadNextChunk = async () => {
    if (!taskId || !filePath || !data || loadingMore) return;
    setLoadingMore(true);
    try {
      const currentEnd = data.end_line || data.lines;
      const nextStart = currentEnd + 1;
      const nextEnd = currentEnd + 1000;
      const res = await fetch(
        `${API_BASE}/api/tasks/${taskId}/files/content?path=${encodeURIComponent(filePath)}&start_line=${nextStart}&end_line=${nextEnd}`
      );
      if (!res.ok) throw new Error('Failed to load next chunk');
      const json = await res.json();
      setData((prev) => {
        if (!prev) return json;
        return {
          ...prev,
          content: prev.content + '\n' + json.content,
          end_line: json.end_line,
          lines: prev.lines + json.lines,
          is_truncated: json.is_truncated,
        };
      });
    } catch (err: any) {
      console.error('Failed to load next chunk', err);
    } finally {
      setLoadingMore(false);
    }
  };

  const handleLoadEntireFile = async () => {
    if (!taskId || !filePath || !data || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/tasks/${taskId}/files/content?path=${encodeURIComponent(filePath)}&start_line=1&end_line=${data.total_lines || 100000}&max_bytes=10485760`
      );
      if (!res.ok) throw new Error('Failed to load full file');
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      console.error('Failed to load full file', err);
    } finally {
      setLoadingMore(false);
    }
  };

  // Handle auto-scroll to targetLine with virtual window calculation
  useEffect(() => {
    if (!targetLine || !data) return;

    setActiveHighlightLine(targetLine);
    const fileBaseLine = data.start_line || 1;
    const targetIdx = targetLine - fileBaseLine;
    if (targetIdx >= 0 && scrollContainerRef.current) {
      const targetOffset = (targetIdx * ROW_HEIGHT) - (viewportHeight / 2) + (ROW_HEIGHT / 2);
      scrollContainerRef.current.scrollTo({
        top: Math.max(0, targetOffset),
        behavior: 'smooth'
      });
    }

    const fadeTimer = setTimeout(() => {
      setActiveHighlightLine(null);
    }, 4000);

    return () => {
      clearTimeout(fadeTimer);
    };
  }, [targetLine, data, viewportHeight]);

  const handleCopy = () => {
    if (!data?.content) return;
    navigator.clipboard.writeText(data.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const resolvedLang = useMemo(() => {
    if (!data) return 'text';
    return resolveLanguage(data.language, data.name);
  }, [data]);

  const rawLines = useMemo(() => {
    if (!data?.content) return [];
    return data.content.split('\n');
  }, [data]);

  const highlightedLines = useMemo(() => {
    if (!data?.content) return [];
    // If file is very large (>500KB or >5000 lines), bypass heavy Prism grammar to prevent freezing UI thread
    if (data.size > 500 * 1024 || rawLines.length > 5000) {
      return rawLines.map(escapeHtml);
    }
    const html = highlightCode(data.content, data.language, data.name);
    return html.split('\n');
  }, [data, rawLines]);

  const lineCount = useMemo(() => {
    return highlightedLines.length;
  }, [highlightedLines]);

  // Virtual window slice calculations
  const OVERSCAN = 25;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(lineCount, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN);
  const topSpacerHeight = startIndex * ROW_HEIGHT;
  const bottomSpacerHeight = Math.max(0, (lineCount - endIndex) * ROW_HEIGHT);
  const visibleLines = highlightedLines.slice(startIndex, endIndex);

  // Selection detection
  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !containerRef.current) {
      setSelectionRange(null);
      return;
    }

    const text = sel.toString().trim();
    if (!text || text.length < 2) {
      setSelectionRange(null);
      return;
    }

    try {
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const containerRect = containerRef.current.getBoundingClientRect();

      // Find start and end line from DOM elements
      let startNode: Node | null = range.startContainer;
      let endNode: Node | null = range.endContainer;

      while (startNode && !(startNode as HTMLElement).id?.startsWith('line-row-')) {
        startNode = startNode.parentNode;
      }
      while (endNode && !(endNode as HTMLElement).id?.startsWith('line-row-')) {
        endNode = endNode.parentNode;
      }

      let startL = 1;
      let endL = 1;

      if (startNode && (startNode as HTMLElement).id) {
        startL = parseInt((startNode as HTMLElement).id.replace('line-row-', ''), 10) || 1;
      }
      if (endNode && (endNode as HTMLElement).id) {
        endL = parseInt((endNode as HTMLElement).id.replace('line-row-', ''), 10) || startL;
      }
      if (startL > endL) {
        const tmp = startL;
        startL = endL;
        endL = tmp;
      }

      setSelectionRange({
        startLine: startL,
        endLine: endL,
        text,
        top: Math.max(10, rect.top - containerRect.top - 44),
        left: Math.max(10, Math.min(rect.left - containerRect.left, containerRect.width - 320)),
      });
    } catch {
      setSelectionRange(null);
    }
  }, []);

  const handleAskAboutGutterLine = (lineNum: number) => {
    if (!filePath || !data) return;
    const baseLine = data.start_line || 1;
    const lineIndex = lineNum - baseLine;
    const lineContent = rawLines[lineIndex] || '';
    const context: LineContext = {
      filename: filePath,
      startLine: lineNum,
      endLine: lineNum,
      content: lineContent,
    };
    onAskAboutLine?.(context);
  };

  const handleSelectionAction = (initialPrompt?: string) => {
    if (!selectionRange || !filePath) return;
    const context: LineContext = {
      filename: filePath,
      startLine: selectionRange.startLine,
      endLine: selectionRange.endLine,
      content: selectionRange.text,
    };
    onAskAboutLine?.(context, initialPrompt);
    setSelectionRange(null);
  };

  if (!filePath) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center text-onedark-muted font-mono select-none">
        <Code2 className="w-10 h-10 text-onedark-border mb-3 stroke-[1.2]" />
        <div className="text-xs font-semibold text-onedark-fg">No file selected</div>
        <div className="text-[11px] text-onedark-muted mt-1 max-w-xs">
          Select a file from the explorer tree on the left to inspect its syntax-highlighted contents.
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-onedark-muted font-mono space-y-2">
        <RefreshCw className="w-5 h-5 animate-spin text-onedark-accent" />
        <div className="text-xs">Reading {filePath}...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 rounded-xl bg-onedark-red/10 border border-onedark-red/30 text-onedark-red text-xs font-mono m-4 flex items-start space-x-2">
        <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="font-semibold">Unable to Read File</div>
          <div className="text-[11px] opacity-90 mt-0.5">{error}</div>
          {onFileNotFound && (
            <button
              onClick={onFileNotFound}
              className="mt-2.5 px-3 py-1 rounded bg-onedark-surface hover:bg-onedark-border text-onedark-fg text-[11px] transition-colors cursor-pointer border border-onedark-borderSubtle"
            >
              Open Available File
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const isHtml = data?.name.toLowerCase().endsWith('.html') || data?.name.toLowerCase().endsWith('.htm');
  const previewUrl = taskId && filePath ? `${API_BASE}/api/tasks/${taskId}/preview/${filePath}` : '';

  return (
    <div 
      ref={containerRef}
      onMouseUp={handleMouseUp}
      className="h-full flex flex-col bg-onedark-bg font-mono text-[12.5px] overflow-hidden relative"
    >
      {/* File Header Bar */}
      <div className="px-3.5 py-2 bg-onedark-darker border-b border-onedark-borderSubtle flex items-center justify-between flex-shrink-0 select-none gap-2">
        <div className="flex items-center space-x-2 truncate min-w-0">
          <FileCode className="w-3.5 h-3.5 text-onedark-accent flex-shrink-0" />
          <span className="font-semibold text-onedark-fgBright truncate text-[12.5px]">
            {data.name}
          </span>
          <span className="text-[11px] text-onedark-muted truncate hidden sm:inline">
            ({data.path})
          </span>
        </div>

        {/* Mode Toggle (when viewing HTML) */}
        {isHtml && (
          <div className="flex items-center space-x-0.5 bg-onedark-surface p-0.5 rounded-lg border border-onedark-borderSubtle font-mono text-[11px] flex-shrink-0">
            <button
              onClick={() => setViewMode('code')}
              className={`px-2 py-0.5 rounded-md transition-all cursor-pointer ${
                viewMode === 'code'
                  ? 'bg-onedark-darker text-onedark-fgBright font-semibold shadow-xs'
                  : 'text-onedark-muted hover:text-onedark-fg'
              }`}
            >
              Code
            </button>
            <button
              onClick={() => setViewMode('preview')}
              className={`px-2 py-0.5 rounded-md transition-all cursor-pointer flex items-center space-x-1 ${
                viewMode === 'preview'
                  ? 'bg-onedark-darker text-onedark-green font-semibold shadow-xs'
                  : 'text-onedark-muted hover:text-onedark-fg'
              }`}
            >
              <Play className="w-3 h-3 fill-current" />
              <span>Live Preview</span>
            </button>
          </div>
        )}

        <div className="flex items-center space-x-2 flex-shrink-0">
          {/* Ask Agent for whole file button */}
          {onAskAboutLine && (
            <button
              onClick={() => {
                const baseLine = data.start_line || 1;
                const totalFileLines = data.total_lines || lineCount;
                if (lineCount <= 200 && !data.is_truncated) {
                  const wholeFileContext: LineContext = {
                    filename: filePath,
                    startLine: baseLine,
                    endLine: baseLine + lineCount - 1,
                    content: data.content,
                  };
                  onAskAboutLine(wholeFileContext);
                } else {
                  const headSlice = rawLines.slice(0, 80).join('\n');
                  const summaryMsg = `// [Context Outline for ${filePath} (${totalFileLines} lines, ${formatBytes(data.size)})]\n` +
                    `// Initial 80 lines displayed below. To read specific sections, call read_file(file_path="${filePath}", start_line=..., end_line=...)\n\n` +
                    headSlice;
                  const outlineContext: LineContext = {
                    filename: filePath,
                    startLine: baseLine,
                    endLine: Math.min(baseLine + 79, baseLine + lineCount - 1),
                    content: summaryMsg,
                  };
                  onAskAboutLine(outlineContext);
                }
              }}
              className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-onedark-accent/15 hover:bg-onedark-accent/25 text-onedark-accent border border-onedark-accent/30 transition-all cursor-pointer shadow-2xs"
              title="Discuss this file with Cyclode Agent"
            >
              <Zap className="w-3 h-3" />
              <span className="hidden sm:inline">Ask Cyclode</span>
            </button>
          )}

          <span className="px-1.5 py-0.5 rounded bg-onedark-surface border border-onedark-borderSubtle text-[10.5px] text-onedark-muted uppercase font-semibold">
            {resolvedLang}
          </span>
          <span className="text-[11px] text-onedark-muted hidden md:inline">
            {data.total_lines && data.total_lines !== lineCount
              ? `Lines ${data.start_line || 1}–${data.end_line || lineCount} of ${data.total_lines}`
              : `${lineCount} lines`} · {formatBytes(data.size)}
          </span>

          {viewMode === 'code' ? (
            <>
              <button
                onClick={() => setWrapLines(!wrapLines)}
                className={`p-1 rounded transition-colors ${
                  wrapLines
                    ? 'bg-onedark-surface text-onedark-accent'
                    : 'hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fgBright'
                }`}
                title={wrapLines ? 'Disable line wrap' : 'Enable line wrap'}
              >
                <WrapText className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleCopy}
                className="p-1 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fgBright transition-colors cursor-pointer"
                title="Copy file content"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-onedark-green" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setPreviewReloadKey((k) => k + 1)}
                className="p-1 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fgBright transition-colors cursor-pointer"
                title="Reload preview frame"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => window.open(previewUrl, '_blank', 'noopener,noreferrer')}
                className="p-1 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fgBright transition-colors cursor-pointer"
                title="Open in new window"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Floating Selection Action Toolbar */}
      {selectionRange && (
        <div
          style={{ top: `${selectionRange.top}px`, left: `${selectionRange.left}px` }}
          className="absolute z-40 flex items-center space-x-1 p-1 bg-onedark-darker border border-onedark-accent/60 rounded-xl shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 select-none"
        >
          <div className="px-2 py-0.5 text-[10px] font-mono text-onedark-accent border-r border-onedark-borderSubtle mr-0.5 font-bold">
            L{selectionRange.startLine}-{selectionRange.endLine}
          </div>

          <button
            onClick={() => handleSelectionAction()}
            className="flex items-center space-x-1 px-2 py-1 rounded-lg text-xs font-semibold bg-onedark-accent text-onedark-bg hover:brightness-110 transition-all cursor-pointer shadow-xs"
            title="Ask agent about this selection"
          >
            <Zap className="w-3 h-3" />
            <span>Ask</span>
          </button>

          <button
            onClick={() =>
              handleSelectionAction(
                `Please explain the following code snippet from \`${filePath}\` (lines ${selectionRange.startLine}-${selectionRange.endLine}):\n\`\`\`\n${selectionRange.text}\n\`\`\`\nExplain its functionality, control flow, inputs, outputs, and any potential edge cases.`
              )
            }
            className="flex items-center space-x-1 px-2 py-1 rounded-lg text-xs font-medium text-onedark-fg hover:text-onedark-fgBright hover:bg-onedark-surface transition-all cursor-pointer"
            title="Explain this code snippet"
          >
            <Sparkles className="w-3 h-3 text-onedark-purple" />
            <span>Explain</span>
          </button>

          <button
            onClick={() =>
              handleSelectionAction(
                `Please refactor and modernize the following code snippet from \`${filePath}\` (lines ${selectionRange.startLine}-${selectionRange.endLine}):\n\`\`\`\n${selectionRange.text}\n\`\`\`\nImprove readability, error handling, performance, and idiomatic quality. Provide the modified diff.`
              )
            }
            className="flex items-center space-x-1 px-2 py-1 rounded-lg text-xs font-medium text-onedark-fg hover:text-onedark-fgBright hover:bg-onedark-surface transition-all cursor-pointer"
            title="Refactor this snippet"
          >
            <Code2 className="w-3 h-3 text-onedark-blue" />
            <span>Refactor</span>
          </button>

          <button
            onClick={() =>
              handleSelectionAction(
                `Please generate comprehensive unit tests covering the code snippet from \`${filePath}\` (lines ${selectionRange.startLine}-${selectionRange.endLine}):\n\`\`\`\n${selectionRange.text}\n\`\`\`\nEnsure full branch coverage and edge-case handling.`
              )
            }
            className="flex items-center space-x-1 px-2 py-1 rounded-lg text-xs font-medium text-onedark-fg hover:text-onedark-fgBright hover:bg-onedark-surface transition-all cursor-pointer"
            title="Generate unit tests"
          >
            <TestTube className="w-3 h-3 text-onedark-green" />
            <span>Test</span>
          </button>

          <button
            onClick={() => setSelectionRange(null)}
            className="p-1 text-onedark-muted hover:text-onedark-fg rounded cursor-pointer"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Main Body: Binary, Live Preview, or Virtualized Code Table */}
      {data.is_binary ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-onedark-muted font-mono select-none">
          <FileCode className="w-12 h-12 text-onedark-accent/50 mb-3" />
          <div className="text-sm font-semibold text-onedark-fg">Binary File ({formatBytes(data.size)})</div>
          <p className="text-xs text-onedark-muted mt-1 max-w-sm">
            Cyclode does not render binary files in the code viewer to prevent memory corruption.
          </p>
        </div>
      ) : viewMode === 'preview' && isHtml ? (
        <div className="flex-1 overflow-hidden bg-white relative">
          <iframe
            key={previewReloadKey}
            src={previewUrl}
            title={data.name}
            sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-modals allow-downloads allow-pointer-lock"
            allow="accelerometer; camera; encrypted-media; display-capture; geolocation; gyroscope; microphone; midi; clipboard-read; clipboard-write; web-share; serial; xr-spatial-tracking; autoplay; fullscreen; pointer-lock"
            className="w-full h-full border-none"
          />
        </div>
      ) : (
        /* Syntax Highlighted Code Table (Virtual Window, Line-synchronized) */
        <div 
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-auto font-mono text-[12.5px] select-text relative flex flex-col"
        >
          <div className="flex-1">
            <table className={`border-collapse font-mono text-[12.5px] ${wrapLines ? 'min-w-full w-full table-fixed' : 'min-w-full w-max'}`}>
              <tbody>
                {topSpacerHeight > 0 && (
                  <tr style={{ height: `${topSpacerHeight}px` }} aria-hidden="true">
                    <td colSpan={2} />
                  </tr>
                )}
                {visibleLines.map((lineHtml, i) => {
                  const lineNum = (data.start_line || 1) + startIndex + i;
                  const isTarget = activeHighlightLine === lineNum;

                  return (
                    <tr 
                      key={lineNum} 
                      id={`line-row-${lineNum}`}
                      style={{ height: `${ROW_HEIGHT}px` }}
                      className={`hover:bg-onedark-surface/50 group/line transition-colors ${
                        isTarget ? 'bg-onedark-accent/20 ring-1 ring-inset ring-onedark-accent' : ''
                      }`}
                    >
                      {/* Gutter with line number and hover 💬 button */}
                      <td className="select-none pr-2 pl-3 text-right text-onedark-muted/40 group-hover/line:text-onedark-muted border-r border-onedark-borderSubtle font-mono text-[11px] leading-[20px] align-top w-16 min-w-[4rem] sticky left-0 bg-onedark-bg group-hover/line:bg-onedark-surface/50 z-10">
                        <div className="flex items-center justify-end space-x-1.5">
                          {onAskAboutLine && (
                            <button
                              onClick={() => handleAskAboutGutterLine(lineNum)}
                              className="opacity-0 group-hover/line:opacity-100 transition-opacity p-0.5 rounded bg-onedark-accent text-onedark-bg hover:scale-110 shadow-xs cursor-pointer"
                              title={`Ask Cyclode Agent about line ${lineNum}`}
                            >
                              <MessageSquarePlus className="w-2.5 h-2.5" />
                            </button>
                          )}
                          <span>{lineNum}</span>
                        </div>
                      </td>

                      <td
                        className={`pl-3.5 pr-4 font-mono text-[12.5px] leading-[20px] align-top text-onedark-fg ${
                          wrapLines ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'
                        }`}
                        dangerouslySetInnerHTML={{ __html: lineHtml || ' ' }}
                      />
                    </tr>
                  );
                })}
                {bottomSpacerHeight > 0 && (
                  <tr style={{ height: `${bottomSpacerHeight}px` }} aria-hidden="true">
                    <td colSpan={2} />
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Truncation Banner */}
          {data.is_truncated && (
            <div className="sticky bottom-0 left-0 right-0 p-2.5 bg-onedark-darker/95 backdrop-blur-md border-t border-onedark-borderSubtle flex items-center justify-between text-xs z-20">
              <div className="flex items-center space-x-2 text-onedark-muted font-mono text-[11.5px]">
                <AlertCircle className="w-3.5 h-3.5 text-onedark-yellow flex-shrink-0" />
                <span>
                  Showing lines {data.start_line || 1}–{data.end_line || lineCount} of {data.total_lines || lineCount} ({formatBytes(data.size)})
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={handleLoadNextChunk}
                  disabled={loadingMore}
                  className="px-2.5 py-1 rounded bg-onedark-surface hover:bg-onedark-surface/80 border border-onedark-borderSubtle text-onedark-fg font-mono text-[11px] cursor-pointer transition-colors disabled:opacity-50"
                >
                  {loadingMore ? 'Loading...' : 'Load Next 1,000 Lines'}
                </button>
                <button
                  onClick={handleLoadEntireFile}
                  disabled={loadingMore}
                  className="px-2.5 py-1 rounded bg-onedark-accent/20 hover:bg-onedark-accent/30 border border-onedark-accent/40 text-onedark-accent font-mono text-[11px] cursor-pointer transition-colors disabled:opacity-50"
                >
                  Load Entire File
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

