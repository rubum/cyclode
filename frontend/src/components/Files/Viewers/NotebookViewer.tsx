import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { 
  BookOpen, 
  Code2, 
  FileText, 
  Play, 
  Copy, 
  Check, 
  Search, 
  Layers, 
  AlertCircle, 
  Image as ImageIcon, 
  Download, 
  ChevronRight, 
  ChevronDown,
  Terminal,
  Cpu,
  Sparkles,
  Braces,
  RefreshCw,
  Eye,
  FileCode,
  Maximize2,
  Minimize2
} from 'lucide-react';
import { highlightCode } from '../../../utils/syntaxHighlighter';
import { MarkdownRenderer } from '../../Common/MarkdownRenderer';

interface NotebookViewerProps {
  content: string;
  filePath: string;
  rawUrl: string;
  isTruncated?: boolean;
  onSwitchToCode?: () => void;
}

interface NotebookCellOutput {
  output_type: string;
  name?: string;
  text?: string | string[];
  data?: Record<string, any>;
  execution_count?: number | null;
  ename?: string;
  evalue?: string;
  traceback?: string[];
}

interface NotebookCell {
  cell_type: 'code' | 'markdown' | 'raw';
  source: string | string[];
  execution_count?: number | null;
  outputs?: NotebookCellOutput[];
  metadata?: Record<string, any>;
}

interface NotebookData {
  cells: NotebookCell[];
  metadata?: {
    kernelspec?: {
      display_name?: string;
      language?: string;
      name?: string;
    };
    language_info?: {
      name?: string;
      version?: string;
    };
  };
  nbformat?: number;
  nbformat_minor?: number;
}

// Strip ANSI escape sequences for cleaner traceback display
function cleanAnsi(text: string): string {
  return text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}

function normalizeSource(source: string | string[] | undefined): string {
  if (!source) return '';
  if (Array.isArray(source)) {
    return source.join('');
  }
  return String(source);
}

function parseNotebookJSON(raw: string): { 
  notebook: NotebookData | null; 
  error: string | null; 
  isEmpty: boolean 
} {
  const trimmed = (raw || '').trim();
  if (!trimmed) {
    return { notebook: null, error: null, isEmpty: true };
  }

  // 1. Direct standard parse
  try {
    const parsed = JSON.parse(trimmed) as NotebookData;
    if (parsed && Array.isArray(parsed.cells)) {
      return { notebook: parsed, error: null, isEmpty: false };
    }
    if (parsed && typeof parsed === 'object') {
      return {
        notebook: {
          cells: Array.isArray((parsed as any).cells) ? (parsed as any).cells : [],
          metadata: (parsed as any).metadata || {},
          nbformat: (parsed as any).nbformat || 4,
          nbformat_minor: (parsed as any).nbformat_minor || 2,
        },
        error: null,
        isEmpty: false,
      };
    }
  } catch (err: any) {
    // 2. Lenient parse (remove UTF-8 BOM, trailing commas)
    try {
      const sanitized = trimmed
        .replace(/^\uFEFF/, '')
        .replace(/,\s*([\]}])/g, '$1');
      const parsed = JSON.parse(sanitized) as NotebookData;
      if (parsed && (Array.isArray(parsed.cells) || typeof parsed === 'object')) {
        return {
          notebook: {
            cells: Array.isArray(parsed.cells) ? parsed.cells : [],
            metadata: parsed.metadata || {},
            nbformat: parsed.nbformat || 4,
            nbformat_minor: parsed.nbformat_minor || 2,
          },
          error: null,
          isEmpty: false,
        };
      }
    } catch {
      // Retain original error message
      return { notebook: null, error: err?.message || 'Failed to parse notebook JSON', isEmpty: false };
    }
    return { notebook: null, error: err?.message || 'Failed to parse notebook JSON', isEmpty: false };
  }

  return { notebook: null, error: 'Invalid Jupyter notebook format: missing cells array', isEmpty: false };
}

export const NotebookViewer: React.FC<NotebookViewerProps> = ({
  content,
  filePath,
  rawUrl,
  isTruncated = false,
  onSwitchToCode,
}) => {
  const [filterType, setFilterType] = useState<'all' | 'code' | 'markdown'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showRawJson, setShowRawJson] = useState(false);
  const [copiedCellIndex, setCopiedCellIndex] = useState<number | null>(null);
  const [collapsedOutputs, setCollapsedOutputs] = useState<Record<number, boolean>>({});
  const [allOutputsCollapsed, setAllOutputsCollapsed] = useState(false);

  // Self-healing raw streaming state
  const [fetchedFullContent, setFetchedFullContent] = useState<string | null>(null);
  const [isSelfHealing, setIsSelfHealing] = useState(false);
  const [selfHealingAttempted, setSelfHealingAttempted] = useState(false);
  const [selfHealingError, setSelfHealingError] = useState<string | null>(null);

  // Reset state when filePath changes
  useEffect(() => {
    setFetchedFullContent(null);
    setIsSelfHealing(false);
    setSelfHealingAttempted(false);
    setSelfHealingError(null);
  }, [filePath]);

  // Determine current active content
  const activeContent = fetchedFullContent !== null ? fetchedFullContent : (content || '');

  // Parse notebook JSON
  const { notebook, error: parseError, isEmpty } = useMemo(() => {
    return parseNotebookJSON(activeContent);
  }, [activeContent]);

  // Trigger self-healing raw fetch if initial content is truncated or has parse error
  const triggerSelfHealing = useCallback(async () => {
    if (!rawUrl || isSelfHealing) return;
    setIsSelfHealing(true);
    setSelfHealingAttempted(true);
    setSelfHealingError(null);
    try {
      const res = await fetch(rawUrl);
      if (!res.ok) {
        throw new Error(`Failed to load full raw file (HTTP ${res.status})`);
      }
      const text = await res.text();
      setFetchedFullContent(text);
    } catch (err: any) {
      setSelfHealingError(err?.message || 'Network error fetching raw notebook');
    } finally {
      setIsSelfHealing(false);
    }
  }, [rawUrl, isSelfHealing]);

  // Auto-heal on initial parse error or truncation
  useEffect(() => {
    if ((parseError || isTruncated) && !selfHealingAttempted && rawUrl && fetchedFullContent === null) {
      triggerSelfHealing();
    }
  }, [parseError, isTruncated, selfHealingAttempted, rawUrl, fetchedFullContent, triggerSelfHealing]);

  const kernelName = notebook?.metadata?.kernelspec?.display_name || 
    notebook?.metadata?.language_info?.name || 'Python 3';
  const language = (notebook?.metadata?.language_info?.name || notebook?.metadata?.kernelspec?.language || 'python').toLowerCase();

  const cells = notebook?.cells || [];

  // Filter cells
  const filteredCells = useMemo(() => {
    return cells.map((cell, idx) => ({ cell, originalIndex: idx })).filter(({ cell }) => {
      if (filterType !== 'all' && cell.cell_type !== filterType) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const src = normalizeSource(cell.source).toLowerCase();
        const matchesSource = src.includes(q);
        const matchesOutput = (cell.outputs || []).some(o => {
          if (o.text) return normalizeSource(o.text).toLowerCase().includes(q);
          if (o.data) {
            const plain = o.data['text/plain'] ? normalizeSource(o.data['text/plain']).toLowerCase() : '';
            return plain.includes(q);
          }
          return false;
        });
        return matchesSource || matchesOutput;
      }
      return true;
    });
  }, [cells, filterType, searchQuery]);

  const stats = useMemo(() => {
    let codeCount = 0;
    let markdownCount = 0;
    cells.forEach(c => {
      if (c.cell_type === 'code') codeCount++;
      else if (c.cell_type === 'markdown') markdownCount++;
    });
    return { codeCount, markdownCount, total: cells.length };
  }, [cells]);

  const handleCopySource = (text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedCellIndex(idx);
    setTimeout(() => setCopiedCellIndex(null), 2000);
  };

  const toggleOutputCollapse = (idx: number) => {
    setCollapsedOutputs(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  const toggleCollapseAllOutputs = () => {
    const nextState = !allOutputsCollapsed;
    setAllOutputsCollapsed(nextState);
    const updated: Record<number, boolean> = {};
    cells.forEach((_, idx) => {
      updated[idx] = nextState;
    });
    setCollapsedOutputs(updated);
  };

  // 1. Loading / Self-Healing state
  if (isSelfHealing) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-onedark-bg text-onedark-muted font-sans space-y-4 select-none">
        <RefreshCw className="w-8 h-8 text-onedark-accent animate-spin" />
        <div className="max-w-md">
          <h3 className="text-sm font-semibold text-onedark-fg">Streaming Complete Notebook...</h3>
          <p className="text-xs text-onedark-muted mt-1 font-mono">
            Fetching un-truncated JSON structure from workspace raw endpoint
          </p>
        </div>
      </div>
    );
  }

  // 2. Empty notebook state
  if (isEmpty) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-onedark-bg text-onedark-muted font-sans space-y-4 select-none">
        <div className="p-3.5 rounded-2xl bg-onedark-surface/60 border border-onedark-borderSubtle shadow-xs">
          <BookOpen className="w-10 h-10 text-onedark-yellow opacity-80" />
        </div>
        <div className="max-w-md">
          <h3 className="text-sm font-semibold text-onedark-fg">Empty Jupyter Notebook</h3>
          <p className="text-xs text-onedark-muted mt-1">
            This <code className="font-mono text-onedark-accent">{filePath.split('/').pop()}</code> file is currently blank or contains no notebook cells.
          </p>
        </div>
        <div className="flex items-center space-x-2.5 pt-2">
          {onSwitchToCode && (
            <button
              type="button"
              onClick={onSwitchToCode}
              className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg bg-onedark-surface hover:bg-onedark-border text-onedark-fg text-xs font-semibold transition-colors border border-onedark-borderSubtle cursor-pointer shadow-xs"
            >
              <Code2 className="w-3.5 h-3.5 text-onedark-accent" />
              <span>Switch to Code View</span>
            </button>
          )}
          <a
            href={`${rawUrl}&download=true`}
            download={filePath.split('/').pop()}
            className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg bg-onedark-surface/60 hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg text-xs font-medium transition-colors border border-onedark-borderSubtle cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download file</span>
          </a>
        </div>
      </div>
    );
  }

  // 3. Parse Error State with Actionable Recovery Options
  if (parseError) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-onedark-bg text-onedark-muted font-sans space-y-5 select-none">
        <div className="p-3.5 rounded-2xl bg-onedark-red/10 border border-onedark-red/30 shadow-sm">
          <AlertCircle className="w-10 h-10 text-onedark-red flex-shrink-0" />
        </div>
        
        <div className="max-w-md">
          <h3 className="text-sm font-semibold text-onedark-fg">Failed to Parse Jupyter Notebook</h3>
          <div className="mt-2 p-2.5 rounded-lg bg-onedark-surface/60 border border-onedark-borderSubtle text-left font-mono text-[11.5px] text-onedark-red break-all">
            {parseError}
          </div>
          {selfHealingError && (
            <p className="text-[11px] text-onedark-muted mt-2 font-mono">
              Raw stream error: {selfHealingError}
            </p>
          )}
          <p className="text-xs text-onedark-muted mt-2">
            The JSON syntax could not be rendered as a notebook schema. You can inspect or edit the raw source directly.
          </p>
        </div>

        <div className="flex items-center space-x-2.5 pt-1 flex-wrap justify-center gap-2">
          {onSwitchToCode && (
            <button
              type="button"
              onClick={onSwitchToCode}
              className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg bg-onedark-accent/20 hover:bg-onedark-accent/30 text-onedark-accent text-xs font-semibold transition-colors border border-onedark-accent/40 cursor-pointer shadow-xs"
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>Switch to Raw Code View</span>
            </button>
          )}

          <button
            type="button"
            onClick={triggerSelfHealing}
            className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg bg-onedark-surface hover:bg-onedark-border text-onedark-fg text-xs font-semibold transition-colors border border-onedark-borderSubtle cursor-pointer shadow-xs"
          >
            <RefreshCw className="w-3.5 h-3.5 text-onedark-muted" />
            <span>Retry Full Reload</span>
          </button>

          <a
            href={`${rawUrl}&download=true`}
            download={filePath.split('/').pop()}
            className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg bg-onedark-surface/60 hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg text-xs font-medium transition-colors border border-onedark-borderSubtle cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download .ipynb file</span>
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-onedark-bg font-sans overflow-hidden select-text">
      {/* Notebook Toolbar */}
      <div className="px-3.5 py-2 bg-onedark-darker/90 border-b border-onedark-borderSubtle flex items-center justify-between flex-shrink-0 text-xs gap-3 select-none flex-wrap">
        {/* Left: Summary & Search */}
        <div className="flex items-center space-x-3 flex-1 min-w-0">
          <div className="flex items-center space-x-2 font-mono text-[11.5px] text-onedark-muted flex-shrink-0">
            <BookOpen className="w-4 h-4 text-onedark-yellow flex-shrink-0" />
            <span className="font-semibold text-onedark-fg">{stats.total} cells</span>
            <span className="text-onedark-border">·</span>
            <span className="text-onedark-blue">{stats.codeCount} code</span>
            <span className="text-onedark-border">·</span>
            <span className="text-onedark-purple">{stats.markdownCount} md</span>
          </div>

          <div className="flex items-center space-x-1.5 bg-onedark-surface/80 px-2 py-0.5 rounded-md border border-onedark-borderSubtle/60 text-[11px] text-onedark-muted font-mono flex-shrink-0">
            <Cpu className="w-3.5 h-3.5 text-onedark-green" />
            <span>{kernelName}</span>
          </div>

          <div className="relative flex items-center flex-1 max-w-xs">
            <Search className="w-3.5 h-3.5 text-onedark-muted absolute left-2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter cells & outputs..."
              className="w-full bg-onedark-surface/60 border border-transparent focus:border-onedark-accent/60 rounded-md pl-7 pr-3 py-1 text-[11.5px] text-onedark-fg font-mono focus:outline-none placeholder:text-onedark-muted/60"
            />
          </div>
        </div>

        {/* Right: Filter & Actions */}
        <div className="flex items-center space-x-2 flex-shrink-0">
          {/* Cell Type Filter */}
          <div className="flex items-center space-x-1 bg-onedark-surface/60 p-0.5 rounded-md border border-onedark-borderSubtle/60 text-[11px] font-mono">
            <button
              type="button"
              onClick={() => setFilterType('all')}
              className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
                filterType === 'all' ? 'bg-onedark-accent/20 text-onedark-accent font-semibold' : 'text-onedark-muted hover:text-onedark-fg'
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setFilterType('code')}
              className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
                filterType === 'code' ? 'bg-onedark-accent/20 text-onedark-accent font-semibold' : 'text-onedark-muted hover:text-onedark-fg'
              }`}
            >
              Code
            </button>
            <button
              type="button"
              onClick={() => setFilterType('markdown')}
              className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
                filterType === 'markdown' ? 'bg-onedark-accent/20 text-onedark-accent font-semibold' : 'text-onedark-muted hover:text-onedark-fg'
              }`}
            >
              Markdown
            </button>
          </div>

          {/* Collapse/Expand All Outputs */}
          <button
            type="button"
            onClick={toggleCollapseAllOutputs}
            className="flex items-center space-x-1 px-2 py-1 rounded-md text-[11px] font-mono bg-onedark-surface/60 hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg border border-onedark-borderSubtle transition-colors cursor-pointer"
            title={allOutputsCollapsed ? 'Expand all cell outputs' : 'Collapse all cell outputs'}
          >
            {allOutputsCollapsed ? <Maximize2 className="w-3.5 h-3.5" /> : <Minimize2 className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{allOutputsCollapsed ? 'Expand Outputs' : 'Collapse'}</span>
          </button>

          {/* Raw JSON toggle */}
          <button
            type="button"
            onClick={() => setShowRawJson(v => !v)}
            className={`flex items-center space-x-1 px-2.5 py-1 rounded-md text-[11px] font-mono transition-colors border border-onedark-borderSubtle cursor-pointer ${
              showRawJson ? 'bg-onedark-accent/20 text-onedark-accent border-onedark-accent/40 font-semibold' : 'bg-onedark-surface/60 text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface'
            }`}
            title="Toggle raw JSON view"
          >
            <Braces className="w-3.5 h-3.5" />
            <span>JSON</span>
          </button>

          {/* Switch to full editor code view */}
          {onSwitchToCode && (
            <button
              type="button"
              onClick={onSwitchToCode}
              className="flex items-center space-x-1 px-2.5 py-1 rounded-md text-[11px] font-mono bg-onedark-surface/60 hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg border border-onedark-borderSubtle transition-colors cursor-pointer"
              title="Switch to full code editor view"
            >
              <Code2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Code</span>
            </button>
          )}

          {/* Download Raw */}
          <a
            href={`${rawUrl}&download=true`}
            download={filePath.split('/').pop()}
            className="p-1 rounded-md bg-onedark-surface/60 hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg border border-onedark-borderSubtle transition-colors cursor-pointer"
            title="Download notebook file"
          >
            <Download className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* Notebook Content Container */}
      {showRawJson ? (
        <div className="flex-1 overflow-auto p-4 font-mono text-[12px] bg-onedark-bg">
          <pre className="text-onedark-fg leading-relaxed">
            <code>{activeContent}</code>
          </pre>
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-4 md:p-6 space-y-4 [scrollbar-gutter:stable]">
          {filteredCells.length === 0 ? (
            <div className="py-16 text-center text-onedark-muted font-mono text-xs">
              {searchQuery ? 'No matching notebook cells found.' : 'Notebook has no cells.'}
            </div>
          ) : (
            filteredCells.map(({ cell, originalIndex }) => {
              const sourceText = normalizeSource(cell.source);
              const isCopied = copiedCellIndex === originalIndex;
              const isOutputsCollapsed = !!collapsedOutputs[originalIndex];

              if (cell.cell_type === 'markdown') {
                return (
                  <div
                    key={originalIndex}
                    className="group relative flex rounded-xl border border-onedark-borderSubtle/50 hover:border-onedark-borderSubtle bg-onedark-surface/20 hover:bg-onedark-surface/30 transition-all overflow-hidden p-4 md:p-5"
                  >
                    {/* Left Gutter */}
                    <div className="select-none font-mono text-[11px] text-onedark-muted/40 w-14 flex-shrink-0 pt-0.5 flex items-start space-x-1">
                      <FileText className="w-3.5 h-3.5 text-onedark-muted/40 group-hover:text-onedark-purple transition-colors" />
                    </div>

                    {/* Markdown Body */}
                    <div className="flex-1 min-w-0">
                      <MarkdownRenderer content={sourceText} />
                    </div>

                    {/* Copy Button on hover */}
                    <button
                      type="button"
                      onClick={() => handleCopySource(sourceText, originalIndex)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity absolute top-3 right-3 p-1.5 rounded-lg bg-onedark-darker/90 hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg border border-onedark-borderSubtle/80 cursor-pointer shadow-xs"
                      title="Copy Markdown Source"
                    >
                      {isCopied ? <Check className="w-3.5 h-3.5 text-onedark-green" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                );
              }

              // Code Cell
              const execCount = cell.execution_count != null ? cell.execution_count : ' ';
              const hasOutputs = cell.outputs && cell.outputs.length > 0;

              return (
                <div
                  key={originalIndex}
                  className="group relative rounded-xl border border-onedark-borderSubtle/80 bg-onedark-darker/70 overflow-hidden shadow-xs hover:border-onedark-borderSubtle transition-all"
                >
                  {/* Code Input Box */}
                  <div className="flex bg-onedark-surface/30 border-b border-onedark-borderSubtle/40">
                    {/* In [X]: Execution Badge */}
                    <div className="select-none font-mono text-[11.5px] text-onedark-blue/80 w-16 min-w-[4rem] text-right pr-3 pt-3.5 font-semibold flex-shrink-0">
                      In [{execCount}]:
                    </div>

                    {/* Code Syntax Highlight */}
                    <div className="flex-1 min-w-0 p-3 pt-3 font-mono text-[12.5px] leading-[20px] overflow-x-auto selection:bg-onedark-accent/30 relative">
                      <pre className="text-onedark-fg m-0 font-mono">
                        <code
                          className={`language-${language}`}
                          dangerouslySetInnerHTML={{
                            __html: highlightCode(sourceText, language) || ' ',
                          }}
                        />
                      </pre>
                    </div>

                    {/* Top Right Copy Button */}
                    <div className="pt-2 pr-2 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => handleCopySource(sourceText, originalIndex)}
                        className="p-1.5 rounded-md bg-onedark-darker/80 hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg border border-onedark-borderSubtle cursor-pointer transition-colors"
                        title="Copy code cell"
                      >
                        {isCopied ? <Check className="w-3.5 h-3.5 text-onedark-green" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  {/* Cell Outputs */}
                  {hasOutputs && (
                    <div className="flex flex-col bg-onedark-bg/80 border-t border-onedark-borderSubtle/30">
                      {/* Output Header / Collapse Bar */}
                      <div className="flex items-center justify-between px-3 py-1 bg-onedark-darker/40 border-b border-onedark-borderSubtle/20 text-[10.5px] font-mono text-onedark-muted select-none">
                        <div className="flex items-center space-x-2">
                          <button
                            type="button"
                            onClick={() => toggleOutputCollapse(originalIndex)}
                            className="flex items-center space-x-1 hover:text-onedark-fg cursor-pointer"
                          >
                            <ChevronRight className={`w-3 h-3 transition-transform ${!isOutputsCollapsed ? 'rotate-90' : ''}`} />
                            <span>{isOutputsCollapsed ? 'Show Output' : 'Output'}</span>
                          </button>
                        </div>
                      </div>

                      {!isOutputsCollapsed && (
                        <div className="p-3 md:p-4 space-y-3 font-mono text-[12px]">
                          {cell.outputs!.map((out, outIdx) => {
                            // Stream stdout / stderr
                            if (out.output_type === 'stream') {
                              const text = normalizeSource(out.text);
                              const isStderr = out.name === 'stderr';
                              return (
                                <div
                                  key={outIdx}
                                  className={`rounded-lg p-2.5 overflow-x-auto leading-relaxed ${
                                    isStderr
                                      ? 'bg-onedark-red/10 text-onedark-red border border-onedark-red/30'
                                      : 'bg-onedark-darker/90 text-onedark-fg border border-onedark-borderSubtle/40'
                                  }`}
                                >
                                  <pre className="m-0 font-mono text-[11.5px] whitespace-pre-wrap break-all">
                                    {cleanAnsi(text)}
                                  </pre>
                                </div>
                              );
                            }

                            // Error / Traceback
                            if (out.output_type === 'error') {
                              const tb = (out.traceback || []).map(cleanAnsi).join('\n');
                              return (
                                <div
                                  key={outIdx}
                                  className="rounded-lg p-3 bg-onedark-red/10 border border-onedark-red/40 text-onedark-red overflow-x-auto"
                                >
                                  <div className="font-bold text-[12px] mb-1">
                                    {out.ename}: {out.evalue}
                                  </div>
                                  <pre className="m-0 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all text-onedark-fg/90">
                                    {tb}
                                  </pre>
                                </div>
                              );
                            }

                            // Display Data / Execute Result (Images, HTML, Plain text)
                            if (out.output_type === 'display_data' || out.output_type === 'execute_result') {
                              const data = out.data || {};

                              // Image (PNG / JPEG / WebP / SVG)
                              if (data['image/png'] || data['image/jpeg'] || data['image/webp']) {
                                const mime = data['image/png'] ? 'image/png' : data['image/jpeg'] ? 'image/jpeg' : 'image/webp';
                                const b64 = data[mime];
                                const src = `data:${mime};base64,${b64}`;
                                return (
                                  <div key={outIdx} className="my-2 bg-white/95 rounded-xl p-3 flex flex-col items-center justify-center border border-onedark-borderSubtle shadow-xs">
                                    <img
                                      src={src}
                                      alt={`Cell Output Plot ${outIdx + 1}`}
                                      className="max-w-full h-auto rounded object-contain"
                                    />
                                    <div className="mt-2 flex items-center justify-end w-full">
                                      <a
                                        href={src}
                                        download={`plot_cell_${originalIndex + 1}_${outIdx + 1}.png`}
                                        className="flex items-center space-x-1 text-[11px] text-slate-700 hover:text-slate-950 font-mono px-2 py-0.5 bg-slate-100 hover:bg-slate-200 rounded border border-slate-300 transition-colors"
                                      >
                                        <Download className="w-3 h-3" />
                                        <span>Download Plot</span>
                                      </a>
                                    </div>
                                  </div>
                                );
                              }

                              if (data['image/svg+xml']) {
                                const svg = normalizeSource(data['image/svg+xml']);
                                return (
                                  <div
                                    key={outIdx}
                                    className="my-2 bg-white/95 rounded-xl p-3 overflow-x-auto flex items-center justify-center border border-onedark-borderSubtle"
                                    dangerouslySetInnerHTML={{ __html: svg }}
                                  />
                                );
                              }

                              // HTML (e.g. Pandas DataFrame)
                              if (data['text/html']) {
                                const html = normalizeSource(data['text/html']);
                                return (
                                  <div
                                    key={outIdx}
                                    className="my-2 overflow-x-auto rounded-lg bg-onedark-surface/40 p-2 border border-onedark-borderSubtle/60 text-onedark-fg [scrollbar-gutter:stable]"
                                    dangerouslySetInnerHTML={{ __html: html }}
                                  />
                                );
                              }

                              // LaTeX Math
                              if (data['text/latex']) {
                                const latex = normalizeSource(data['text/latex']);
                                return (
                                  <div key={outIdx} className="my-2">
                                    <MarkdownRenderer content={`$$${latex}$$`} />
                                  </div>
                                );
                              }

                              // Plain text fallback
                              if (data['text/plain']) {
                                const text = normalizeSource(data['text/plain']);
                                return (
                                  <div
                                    key={outIdx}
                                    className="rounded-lg p-2.5 bg-onedark-darker/90 text-onedark-fg border border-onedark-borderSubtle/40 overflow-x-auto"
                                  >
                                    <pre className="m-0 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap break-all">
                                      {cleanAnsi(text)}
                                    </pre>
                                  </div>
                                );
                              }
                            }

                            return null;
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
