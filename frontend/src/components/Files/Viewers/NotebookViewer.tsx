import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
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
  Minimize2,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Copy as DuplicateIcon,
  Square,
  RotateCcw,
  Zap,
  Edit3,
  CheckSquare,
  Table as TableIcon
} from 'lucide-react';
import { highlightCode } from '../../../utils/syntaxHighlighter';
import { MarkdownRenderer } from '../../Common/MarkdownRenderer';
import { LineContext } from '../CodeViewer';

interface NotebookViewerProps {
  taskId?: string;
  content: string;
  filePath: string;
  rawUrl: string;
  isTruncated?: boolean;
  onSwitchToCode?: () => void;
  onAskAboutLine?: (context: LineContext, initialPrompt?: string) => void;
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

const API_BASE = import.meta.env.VITE_API_URL || '';

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

function toSourceArray(text: string): string[] {
  return text.split('\n').map((line, idx, arr) => (idx < arr.length - 1 ? line + '\n' : line));
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
      return { notebook: null, error: err?.message || 'Failed to parse notebook JSON', isEmpty: false };
    }
    return { notebook: null, error: err?.message || 'Failed to parse notebook JSON', isEmpty: false };
  }

  return { notebook: null, error: 'Invalid Jupyter notebook format: missing cells array', isEmpty: false };
}

export const NotebookViewer: React.FC<NotebookViewerProps> = ({
  taskId,
  content,
  filePath,
  rawUrl,
  isTruncated = false,
  onSwitchToCode,
  onAskAboutLine,
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

  // Execution & Live Notebook State
  const [liveNotebook, setLiveNotebook] = useState<NotebookData | null>(null);
  const [runningCellIndex, setRunningCellIndex] = useState<number | null>(null);
  const [isExecutingAll, setIsExecutingAll] = useState(false);
  const [executionTimes, setExecutionTimes] = useState<Record<number, number>>({});
  const [editingMarkdownIndex, setEditingMarkdownIndex] = useState<number | null>(null);
  const [editedMarkdownDraft, setEditedMarkdownDraft] = useState<string>('');
  const [editingCodeIndex, setEditingCodeIndex] = useState<number | null>(null);
  const [editedCodeDraft, setEditedCodeDraft] = useState<string>('');
  const [hoveredDividerIndex, setHoveredDividerIndex] = useState<number | null>(null);

  // Reset state when filePath changes
  useEffect(() => {
    setFetchedFullContent(null);
    setIsSelfHealing(false);
    setSelfHealingAttempted(false);
    setSelfHealingError(null);
    setLiveNotebook(null);
    setRunningCellIndex(null);
    setEditingMarkdownIndex(null);
    setEditingCodeIndex(null);
  }, [filePath]);

  // Determine current active content
  const activeContent = fetchedFullContent !== null ? fetchedFullContent : (content || '');

  // Parse notebook JSON
  const { notebook: parsedNotebook, error: parseError, isEmpty } = useMemo(() => {
    return parseNotebookJSON(activeContent);
  }, [activeContent]);

  // Sync parsed notebook into live state when it updates
  useEffect(() => {
    if (parsedNotebook) {
      setLiveNotebook(parsedNotebook);
    }
  }, [parsedNotebook]);

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

  const notebook = liveNotebook || parsedNotebook;
  const kernelName = notebook?.metadata?.kernelspec?.display_name || 
    notebook?.metadata?.language_info?.name || 'Python 3 (Sandbox)';
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

  // Auto-save notebook structure to disk
  const persistNotebook = useCallback(async (updatedNb: NotebookData) => {
    if (!taskId) return;
    try {
      await fetch(`${API_BASE}/api/tasks/${taskId}/notebooks/save`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: filePath,
          notebook: updatedNb,
        }),
      });
    } catch (err) {
      console.warn('Failed to persist notebook:', err);
    }
  }, [taskId, filePath]);

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

  // Cell Execution Handler
  const handleExecuteCell = async (cellIndex: number, overrideSource?: string) => {
    if (!taskId || runningCellIndex !== null) return;
    const targetCell = cells[cellIndex];
    if (!targetCell || targetCell.cell_type !== 'code') return;

    setRunningCellIndex(cellIndex);
    const codeToRun = overrideSource !== undefined ? overrideSource : normalizeSource(targetCell.source);

    try {
      const res = await fetch(`${API_BASE}/api/tasks/${taskId}/notebooks/execute-cell`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: filePath,
          cell_index: cellIndex,
          source: codeToRun,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setLiveNotebook((prev) => {
          if (!prev) return prev;
          const nextCells = [...prev.cells];
          nextCells[cellIndex] = {
            ...nextCells[cellIndex],
            execution_count: data.execution_count,
            outputs: data.outputs || [],
            source: toSourceArray(codeToRun),
          };
          return { ...prev, cells: nextCells };
        });

        if (data.execution_time_ms) {
          setExecutionTimes(prev => ({ ...prev, [cellIndex]: data.execution_time_ms }));
        }
      }
    } catch (err) {
      console.error('Error executing cell:', err);
    } finally {
      setRunningCellIndex(null);
      setEditingCodeIndex(null);
    }
  };

  // Execute All Code Cells
  const handleExecuteAll = async () => {
    if (!taskId || runningCellIndex !== null || isExecutingAll) return;
    setIsExecutingAll(true);

    for (let i = 0; i < cells.length; i++) {
      if (cells[i].cell_type === 'code') {
        setRunningCellIndex(i);
        try {
          const res = await fetch(`${API_BASE}/api/tasks/${taskId}/notebooks/execute-cell`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              path: filePath,
              cell_index: i,
              source: normalizeSource(cells[i].source),
            }),
          });
          if (res.ok) {
            const data = await res.json();
            setLiveNotebook((prev) => {
              if (!prev) return prev;
              const nextCells = [...prev.cells];
              nextCells[i] = {
                ...nextCells[i],
                execution_count: data.execution_count,
                outputs: data.outputs || [],
              };
              return { ...prev, cells: nextCells };
            });
            if (data.execution_time_ms) {
              setExecutionTimes(prev => ({ ...prev, [i]: data.execution_time_ms }));
            }
            if (!data.ok) {
              break; // Stop pipeline on error
            }
          }
        } catch (err) {
          console.error('Error executing all cells:', err);
          break;
        }
      }
    }

    setRunningCellIndex(null);
    setIsExecutingAll(false);
  };

  // Interrupt Kernel Execution
  const handleInterrupt = async () => {
    if (!taskId) return;
    try {
      await fetch(`${API_BASE}/api/tasks/${taskId}/notebooks/interrupt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath }),
      });
    } catch {
      // ignore
    }
  };

  // Restart Kernel & Optionally Clear Outputs
  const handleRestartKernel = async (clearOutputs: boolean = false) => {
    if (!taskId) return;
    try {
      await fetch(`${API_BASE}/api/tasks/${taskId}/notebooks/restart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, clear_outputs: clearOutputs }),
      });

      if (clearOutputs) {
        setLiveNotebook((prev) => {
          if (!prev) return prev;
          const nextCells = prev.cells.map(c => (c.cell_type === 'code' ? { ...c, outputs: [], execution_count: null } : c));
          return { ...prev, cells: nextCells };
        });
        setExecutionTimes({});
      }
    } catch (err) {
      console.error('Failed to restart kernel:', err);
    }
  };

  // Cell Management (Add, Delete, Move, Duplicate)
  const handleAddCell = (type: 'code' | 'markdown', insertAfterIndex: number = -1) => {
    const newCell: NotebookCell = {
      cell_type: type,
      source: type === 'code' ? ['# Write code here\n'] : ['### Markdown Section\n'],
      metadata: {},
      outputs: type === 'code' ? [] : undefined,
      execution_count: type === 'code' ? null : undefined,
    };

    setLiveNotebook((prev) => {
      const baseCells = prev ? [...prev.cells] : [];
      const targetPos = insertAfterIndex === -1 ? baseCells.length : insertAfterIndex + 1;
      baseCells.splice(targetPos, 0, newCell);
      const updated: NotebookData = {
        cells: baseCells,
        metadata: prev?.metadata || {
          kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
        },
        nbformat: 4,
        nbformat_minor: 2,
      };
      persistNotebook(updated);
      return updated;
    });

    if (type === 'markdown') {
      setEditingMarkdownIndex(insertAfterIndex === -1 ? cells.length : insertAfterIndex + 1);
      setEditedMarkdownDraft('### Markdown Section\n');
    } else {
      setEditingCodeIndex(insertAfterIndex === -1 ? cells.length : insertAfterIndex + 1);
      setEditedCodeDraft('# Write code here\n');
    }
  };

  const handleDeleteCell = (idx: number) => {
    setLiveNotebook((prev) => {
      if (!prev) return prev;
      const nextCells = prev.cells.filter((_, i) => i !== idx);
      const updated = { ...prev, cells: nextCells };
      persistNotebook(updated);
      return updated;
    });
  };

  const handleDuplicateCell = (idx: number) => {
    setLiveNotebook((prev) => {
      if (!prev) return prev;
      const target = prev.cells[idx];
      const clone: NotebookCell = JSON.parse(JSON.stringify(target));
      const nextCells = [...prev.cells];
      nextCells.splice(idx + 1, 0, clone);
      const updated = { ...prev, cells: nextCells };
      persistNotebook(updated);
      return updated;
    });
  };

  const handleMoveCell = (idx: number, direction: 'up' | 'down') => {
    setLiveNotebook((prev) => {
      if (!prev) return prev;
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= prev.cells.length) return prev;
      const nextCells = [...prev.cells];
      const temp = nextCells[idx];
      nextCells[idx] = nextCells[targetIdx];
      nextCells[targetIdx] = temp;
      const updated = { ...prev, cells: nextCells };
      persistNotebook(updated);
      return updated;
    });
  };

  // Agent Collaboration Actions
  const handleAskAboutCell = (cell: NotebookCell, idx: number) => {
    if (!onAskAboutLine) return;
    const sourceText = normalizeSource(cell.source);
    const outputsText = (cell.outputs || []).map(o => {
      if (o.text) return normalizeSource(o.text);
      if (o.ename && o.evalue) return `${o.ename}: ${o.evalue}`;
      if (o.data?.['text/plain']) return normalizeSource(o.data['text/plain']);
      return '';
    }).filter(Boolean).join('\n');

    const promptContext = `// [Jupyter Cell ${idx + 1} (${cell.cell_type.toUpperCase()}) from ${filePath}]\n` +
      `// Source:\n${sourceText}\n` +
      (outputsText ? `\n// Outputs:\n${outputsText}` : '');

    const lineContext: LineContext = {
      filename: filePath,
      startLine: idx + 1,
      endLine: idx + 1,
      content: promptContext,
    };

    onAskAboutLine(lineContext, `Please explain this notebook cell (Cell ${idx + 1}):\n\`\`\`${language}\n${sourceText}\n\`\`\`\nExplain the logic, performance, and key data transformations.`);
  };

  const handleFixErrorWithAgent = (cell: NotebookCell, idx: number, errorOutput: NotebookCellOutput) => {
    if (!onAskAboutLine) return;
    const sourceText = normalizeSource(cell.source);
    const tb = (errorOutput.traceback || []).map(cleanAnsi).join('\n');
    const prompt = `Please help fix this Python exception occurring in Jupyter Notebook Cell ${idx + 1} (${filePath}):\n\n` +
      `Error: ${errorOutput.ename}: ${errorOutput.evalue}\n` +
      `Traceback:\n\`\`\`\n${tb}\n\`\`\`\n\n` +
      `Cell Source Code:\n\`\`\`python\n${sourceText}\n\`\`\`\n\n` +
      `Explain the root cause and provide the corrected cell code.`;

    const lineContext: LineContext = {
      filename: filePath,
      startLine: idx + 1,
      endLine: idx + 1,
      content: sourceText,
    };

    onAskAboutLine(lineContext, prompt);
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
          <button
            type="button"
            onClick={() => handleAddCell('code')}
            className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg bg-onedark-accent/20 hover:bg-onedark-accent/30 text-onedark-accent text-xs font-semibold transition-colors border border-onedark-accent/40 cursor-pointer shadow-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Code Cell</span>
          </button>
          {onSwitchToCode && (
            <button
              type="button"
              onClick={onSwitchToCode}
              className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg bg-onedark-surface hover:bg-onedark-border text-onedark-fg text-xs font-semibold transition-colors border border-onedark-borderSubtle cursor-pointer shadow-xs"
            >
              <Code2 className="w-3.5 h-3.5 text-onedark-muted" />
              <span>Raw Code View</span>
            </button>
          )}
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
      {/* Global Interactive Notebook Toolbar */}
      <div className="px-3.5 py-2 bg-onedark-darker/95 border-b border-onedark-borderSubtle flex items-center justify-between flex-shrink-0 text-xs gap-3 select-none flex-wrap backdrop-blur-xs">
        {/* Left: Global Execution Actions & Summary */}
        <div className="flex items-center space-x-2.5 flex-1 min-w-0 flex-wrap gap-y-1.5">
          {/* Run All / Interrupt Button */}
          {runningCellIndex !== null || isExecutingAll ? (
            <button
              type="button"
              onClick={handleInterrupt}
              className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-onedark-red/20 hover:bg-onedark-red/30 text-onedark-red border border-onedark-red/40 font-semibold text-[11.5px] cursor-pointer transition-all shadow-xs"
              title="Interrupt Kernel Execution"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>Interrupt</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleExecuteAll}
              className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-onedark-green/15 hover:bg-onedark-green/25 text-onedark-green border border-onedark-green/30 font-semibold text-[11.5px] cursor-pointer transition-all shadow-xs"
              title="Run All Notebook Cells sequentially"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Run All</span>
            </button>
          )}

          {/* Restart Kernel */}
          <button
            type="button"
            onClick={() => handleRestartKernel(false)}
            className="inline-flex items-center space-x-1 px-2 py-1 rounded-md bg-onedark-surface/60 hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg border border-onedark-borderSubtle text-[11px] font-mono cursor-pointer transition-colors"
            title="Restart Python Kernel Session"
          >
            <RotateCcw className="w-3 h-3" />
            <span className="hidden sm:inline">Restart</span>
          </button>

          {/* Add Cell Buttons */}
          <div className="flex items-center space-x-1 bg-onedark-surface/60 p-0.5 rounded-md border border-onedark-borderSubtle text-[11px] font-mono">
            <button
              type="button"
              onClick={() => handleAddCell('code')}
              className="flex items-center space-x-1 px-2 py-0.5 rounded text-onedark-muted hover:text-onedark-accent hover:bg-onedark-surface transition-colors cursor-pointer"
              title="Add Code Cell at bottom"
            >
              <Plus className="w-3 h-3" />
              <span>Code</span>
            </button>
            <span className="text-onedark-borderSubtle">|</span>
            <button
              type="button"
              onClick={() => handleAddCell('markdown')}
              className="flex items-center space-x-1 px-2 py-0.5 rounded text-onedark-muted hover:text-onedark-purple hover:bg-onedark-surface transition-colors cursor-pointer"
              title="Add Markdown Cell at bottom"
            >
              <Plus className="w-3 h-3" />
              <span>Markdown</span>
            </button>
          </div>

          {/* Kernel Status Badge */}
          <div className="flex items-center space-x-1.5 bg-onedark-surface/70 px-2 py-0.5 rounded-md border border-onedark-borderSubtle/60 text-[11px] text-onedark-muted font-mono flex-shrink-0">
            <div className={`w-2 h-2 rounded-full ${runningCellIndex !== null ? 'bg-onedark-yellow animate-subagent-pulse' : 'bg-onedark-green'}`} />
            <span className="font-medium text-onedark-fgBright">
              {runningCellIndex !== null ? `Running Cell ${runningCellIndex + 1}...` : kernelName}
            </span>
          </div>

          {/* Search Filter */}
          <div className="relative flex items-center flex-1 max-w-xs min-w-[120px]">
            <Search className="w-3.5 h-3.5 text-onedark-muted absolute left-2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter notebook..."
              className="w-full bg-onedark-surface/60 border border-transparent focus:border-onedark-accent/60 rounded-md pl-7 pr-3 py-1 text-[11.5px] text-onedark-fg font-mono focus:outline-none placeholder:text-onedark-muted/60"
            />
          </div>
        </div>

        {/* Right: Filter & View Toggles */}
        <div className="flex items-center space-x-2 flex-shrink-0">
          {/* Cell Type Filter */}
          <div className="flex items-center space-x-0.5 bg-onedark-surface/60 p-0.5 rounded-md border border-onedark-borderSubtle text-[11px] font-mono">
            <button
              type="button"
              onClick={() => setFilterType('all')}
              className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
                filterType === 'all' ? 'bg-onedark-surface text-onedark-accent font-semibold shadow-2xs' : 'text-onedark-muted hover:text-onedark-fg'
              }`}
            >
              All ({stats.total})
            </button>
            <button
              type="button"
              onClick={() => setFilterType('code')}
              className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
                filterType === 'code' ? 'bg-onedark-surface text-onedark-blue font-semibold shadow-2xs' : 'text-onedark-muted hover:text-onedark-fg'
              }`}
            >
              Code ({stats.codeCount})
            </button>
            <button
              type="button"
              onClick={() => setFilterType('markdown')}
              className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
                filterType === 'markdown' ? 'bg-onedark-surface text-onedark-purple font-semibold shadow-2xs' : 'text-onedark-muted hover:text-onedark-fg'
              }`}
            >
              MD ({stats.markdownCount})
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
            <span className="hidden md:inline">{allOutputsCollapsed ? 'Expand' : 'Collapse'}</span>
          </button>

          {/* Raw JSON toggle */}
          <button
            type="button"
            onClick={() => setShowRawJson(v => !v)}
            className={`flex items-center space-x-1 px-2 py-1 rounded-md text-[11px] font-mono transition-colors border border-onedark-borderSubtle cursor-pointer ${
              showRawJson ? 'bg-onedark-accent/20 text-onedark-accent border-onedark-accent/40 font-semibold' : 'bg-onedark-surface/60 text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface'
            }`}
            title="Toggle raw JSON view"
          >
            <Braces className="w-3.5 h-3.5" />
            <span>JSON</span>
          </button>

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
            <code>{JSON.stringify(notebook, null, 2)}</code>
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
              const isRunningThisCell = runningCellIndex === originalIndex;
              const executionTime = executionTimes[originalIndex];

              // Markdown Cell Rendering
              if (cell.cell_type === 'markdown') {
                const isEditingMd = editingMarkdownIndex === originalIndex;

                return (
                  <div key={originalIndex} className="group relative">
                    <div
                      className={`relative rounded-xl border transition-all overflow-hidden ${
                        isEditingMd 
                          ? 'border-onedark-accent ring-1 ring-onedark-accent/40 bg-onedark-surface/40' 
                          : 'border-onedark-borderSubtle/60 hover:border-onedark-borderSubtle bg-onedark-surface/25 hover:bg-onedark-surface/35'
                      }`}
                    >
                      {/* Top Action Toolbar on hover */}
                      <div className="absolute top-2 right-2 flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity z-10 bg-onedark-darker/90 backdrop-blur-xs p-1 rounded-lg border border-onedark-borderSubtle shadow-xs">
                        {isEditingMd ? (
                          <button
                            type="button"
                            onClick={() => {
                              setLiveNotebook((prev) => {
                                if (!prev) return prev;
                                const nextCells = [...prev.cells];
                                nextCells[originalIndex] = {
                                  ...nextCells[originalIndex],
                                  source: toSourceArray(editedMarkdownDraft),
                                };
                                const updated = { ...prev, cells: nextCells };
                                persistNotebook(updated);
                                return updated;
                              });
                              setEditingMarkdownIndex(null);
                            }}
                            className="p-1 rounded bg-onedark-green/20 hover:bg-onedark-green/30 text-onedark-green transition-colors cursor-pointer"
                            title="Save Markdown (Shift+Enter)"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingMarkdownIndex(originalIndex);
                              setEditedMarkdownDraft(sourceText);
                            }}
                            className="p-1 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg transition-colors cursor-pointer"
                            title="Edit Markdown"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => handleAskAboutCell(cell, originalIndex)}
                          className="p-1 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-accent transition-colors cursor-pointer"
                          title="Ask Cyclode Agent about this markdown"
                        >
                          <Zap className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => handleMoveCell(originalIndex, 'up')}
                          disabled={originalIndex === 0}
                          className="p-1 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg disabled:opacity-30 transition-colors cursor-pointer"
                          title="Move Up"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => handleMoveCell(originalIndex, 'down')}
                          disabled={originalIndex === cells.length - 1}
                          className="p-1 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg disabled:opacity-30 transition-colors cursor-pointer"
                          title="Move Down"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDuplicateCell(originalIndex)}
                          className="p-1 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg transition-colors cursor-pointer"
                          title="Duplicate Cell"
                        >
                          <DuplicateIcon className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDeleteCell(originalIndex)}
                          className="p-1 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-red transition-colors cursor-pointer"
                          title="Delete Cell"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => handleCopySource(sourceText, originalIndex)}
                          className="p-1 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg transition-colors cursor-pointer"
                          title="Copy Markdown Source"
                        >
                          {isCopied ? <Check className="w-3.5 h-3.5 text-onedark-green" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>

                      {/* Markdown Body or In-Place Editor */}
                      {isEditingMd ? (
                        <div className="p-4">
                          <textarea
                            value={editedMarkdownDraft}
                            onChange={(e) => setEditedMarkdownDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && (e.shiftKey || e.metaKey || e.ctrlKey)) {
                                e.preventDefault();
                                setLiveNotebook((prev) => {
                                  if (!prev) return prev;
                                  const nextCells = [...prev.cells];
                                  nextCells[originalIndex] = {
                                    ...nextCells[originalIndex],
                                    source: toSourceArray(editedMarkdownDraft),
                                  };
                                  const updated = { ...prev, cells: nextCells };
                                  persistNotebook(updated);
                                  return updated;
                                });
                                setEditingMarkdownIndex(null);
                              }
                            }}
                            rows={Math.max(4, sourceText.split('\n').length + 1)}
                            className="w-full bg-onedark-darker/90 border border-onedark-borderSubtle rounded-lg p-3 text-onedark-fg font-mono text-[12.5px] leading-relaxed focus:outline-none focus:border-onedark-accent resize-y selection:bg-onedark-accent/30"
                            placeholder="Type markdown content..."
                            autoFocus
                          />
                          <div className="flex items-center justify-between mt-2 text-[11px] font-mono text-onedark-muted">
                            <span>Press <kbd className="px-1 py-0.5 bg-onedark-surface rounded border border-onedark-borderSubtle">Shift + Enter</kbd> to render</span>
                            <button
                              type="button"
                              onClick={() => {
                                setLiveNotebook((prev) => {
                                  if (!prev) return prev;
                                  const nextCells = [...prev.cells];
                                  nextCells[originalIndex] = {
                                    ...nextCells[originalIndex],
                                    source: toSourceArray(editedMarkdownDraft),
                                  };
                                  const updated = { ...prev, cells: nextCells };
                                  persistNotebook(updated);
                                  return updated;
                                });
                                setEditingMarkdownIndex(null);
                              }}
                              className="px-2.5 py-1 rounded bg-onedark-accent text-white font-semibold cursor-pointer"
                            >
                              Render Markdown
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div 
                          onDoubleClick={() => {
                            setEditingMarkdownIndex(originalIndex);
                            setEditedMarkdownDraft(sourceText);
                          }}
                          className="p-4 md:p-5 text-onedark-fg leading-relaxed cursor-text"
                        >
                          <MarkdownRenderer content={sourceText} />
                        </div>
                      )}
                    </div>

                    {/* Cell Insertion Divider on hover */}
                    <div 
                      onMouseEnter={() => setHoveredDividerIndex(originalIndex)}
                      onMouseLeave={() => setHoveredDividerIndex(null)}
                      className="relative h-3 flex items-center justify-center my-1 group/divider"
                    >
                      <div className="absolute inset-x-4 h-px bg-transparent group-hover/divider:bg-onedark-borderSubtle/60 transition-colors" />
                      <div className="opacity-0 group-hover/divider:opacity-100 transition-opacity z-10 flex items-center space-x-1.5 bg-onedark-darker px-2 py-0.5 rounded-full border border-onedark-borderSubtle shadow-xs text-[10.5px] font-mono">
                        <button
                          type="button"
                          onClick={() => handleAddCell('code', originalIndex)}
                          className="hover:text-onedark-accent flex items-center space-x-0.5 text-onedark-muted cursor-pointer"
                        >
                          <Plus className="w-3 h-3" />
                          <span>Code</span>
                        </button>
                        <span className="text-onedark-borderSubtle">·</span>
                        <button
                          type="button"
                          onClick={() => handleAddCell('markdown', originalIndex)}
                          className="hover:text-onedark-purple flex items-center space-x-0.5 text-onedark-muted cursor-pointer"
                        >
                          <Plus className="w-3 h-3" />
                          <span>Markdown</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              }

              // Code Cell Rendering
              const execCount = cell.execution_count != null ? cell.execution_count : (isRunningThisCell ? '*' : ' ');
              const hasOutputs = cell.outputs && cell.outputs.length > 0;
              const isEditingCode = editingCodeIndex === originalIndex;
              const currentSourceCode = isEditingCode ? editedCodeDraft : sourceText;

              return (
                <div key={originalIndex} className="group relative">
                  <div
                    className={`relative rounded-xl border transition-all overflow-hidden shadow-xs ${
                      isRunningThisCell
                        ? 'border-onedark-yellow ring-1 ring-onedark-yellow/50 bg-onedark-darker'
                        : isEditingCode
                        ? 'border-onedark-accent ring-1 ring-onedark-accent/40 bg-onedark-darker'
                        : 'border-onedark-borderSubtle hover:border-onedark-borderSubtle/90 bg-onedark-darker/90'
                    }`}
                  >
                    {/* Code Input Header & Gutter Box */}
                    <div className="flex bg-onedark-surface/30 border-b border-onedark-borderSubtle/40 relative">
                      {/* Interactive Run Button & In [X]: Execution Badge */}
                      <div className="select-none font-mono text-[11.5px] w-18 min-w-[4.5rem] flex items-start justify-end pr-3 pt-3 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => handleExecuteCell(originalIndex, isEditingCode ? editedCodeDraft : undefined)}
                          disabled={runningCellIndex !== null}
                          className={`p-1 rounded-md transition-all cursor-pointer flex items-center space-x-1 ${
                            isRunningThisCell
                              ? 'bg-onedark-yellow/20 text-onedark-yellow animate-subagent-pulse'
                              : 'hover:bg-onedark-accent/20 hover:text-onedark-accent text-onedark-blue font-semibold'
                          }`}
                          title="Run cell (Shift+Enter)"
                        >
                          {isRunningThisCell ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin text-onedark-yellow" />
                          ) : (
                            <Play className="w-3.5 h-3.5 fill-current opacity-80 hover:opacity-100" />
                          )}
                          <span className="text-[11px]">[{execCount}]</span>
                        </button>
                      </div>

                      {/* Code Syntax Highlight / Inline Editor */}
                      <div className="flex-1 min-w-0 p-3 pt-2.5 font-mono text-[12.5px] leading-[20px] overflow-x-auto relative">
                        {isEditingCode ? (
                          <textarea
                            value={editedCodeDraft}
                            onChange={(e) => setEditedCodeDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && (e.shiftKey || e.metaKey || e.ctrlKey)) {
                                e.preventDefault();
                                handleExecuteCell(originalIndex, editedCodeDraft);
                              }
                            }}
                            rows={Math.max(3, editedCodeDraft.split('\n').length + 1)}
                            className="w-full bg-onedark-bg/90 border border-onedark-borderSubtle rounded-lg p-2.5 text-onedark-fg font-mono text-[12.5px] leading-[20px] focus:outline-none focus:border-onedark-accent resize-y selection:bg-onedark-accent/30"
                            placeholder="Type python code..."
                            autoFocus
                          />
                        ) : (
                          <div 
                            onDoubleClick={() => {
                              setEditingCodeIndex(originalIndex);
                              setEditedCodeDraft(sourceText);
                            }}
                            className="cursor-text"
                          >
                            <pre className="text-onedark-fg m-0 font-mono">
                              <code
                                className={`language-${language}`}
                                dangerouslySetInnerHTML={{
                                  __html: highlightCode(sourceText, language) || ' ',
                                }}
                              />
                            </pre>
                          </div>
                        )}
                      </div>

                      {/* Top Right Action Toolbar on hover */}
                      <div className="pt-2 pr-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center space-x-1 flex-shrink-0 z-10">
                        {executionTime !== undefined && (
                          <span className="text-[10px] font-mono text-onedark-green bg-onedark-surface/80 px-1.5 py-0.5 rounded border border-onedark-borderSubtle mr-1">
                            {executionTime}ms
                          </span>
                        )}

                        <button
                          type="button"
                          onClick={() => handleAskAboutCell(cell, originalIndex)}
                          className="p-1 rounded-md bg-onedark-darker hover:bg-onedark-surface text-onedark-muted hover:text-onedark-accent border border-onedark-borderSubtle cursor-pointer transition-colors"
                          title="Ask Cyclode Agent about this code"
                        >
                          <Zap className="w-3.5 h-3.5 text-onedark-accent" />
                        </button>

                        {isEditingCode ? (
                          <button
                            type="button"
                            onClick={() => handleExecuteCell(originalIndex, editedCodeDraft)}
                            className="p-1 rounded-md bg-onedark-green/20 hover:bg-onedark-green/30 text-onedark-green border border-onedark-green/40 cursor-pointer transition-colors"
                            title="Execute code (Shift+Enter)"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingCodeIndex(originalIndex);
                              setEditedCodeDraft(sourceText);
                            }}
                            className="p-1 rounded-md bg-onedark-darker hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg border border-onedark-borderSubtle cursor-pointer transition-colors"
                            title="Edit code directly"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => handleMoveCell(originalIndex, 'up')}
                          disabled={originalIndex === 0}
                          className="p-1 rounded-md bg-onedark-darker hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg disabled:opacity-30 border border-onedark-borderSubtle cursor-pointer transition-colors"
                          title="Move Up"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => handleMoveCell(originalIndex, 'down')}
                          disabled={originalIndex === cells.length - 1}
                          className="p-1 rounded-md bg-onedark-darker hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg disabled:opacity-30 border border-onedark-borderSubtle cursor-pointer transition-colors"
                          title="Move Down"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDuplicateCell(originalIndex)}
                          className="p-1 rounded-md bg-onedark-darker hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg border border-onedark-borderSubtle cursor-pointer transition-colors"
                          title="Duplicate Cell"
                        >
                          <DuplicateIcon className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDeleteCell(originalIndex)}
                          className="p-1 rounded-md bg-onedark-darker hover:bg-onedark-surface text-onedark-muted hover:text-onedark-red border border-onedark-borderSubtle cursor-pointer transition-colors"
                          title="Delete Cell"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => handleCopySource(sourceText, originalIndex)}
                          className="p-1 rounded-md bg-onedark-darker hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg border border-onedark-borderSubtle cursor-pointer transition-colors"
                          title="Copy code cell"
                        >
                          {isCopied ? <Check className="w-3.5 h-3.5 text-onedark-green" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>

                    {/* Cell Outputs Area */}
                    {hasOutputs && (
                      <div className="flex flex-col bg-onedark-bg/90 border-t border-onedark-borderSubtle/40">
                        {/* Output Header / Collapse Bar */}
                        <div className="flex items-center justify-between px-3 py-1 bg-onedark-darker/50 border-b border-onedark-borderSubtle/20 text-[10.5px] font-mono text-onedark-muted select-none">
                          <div className="flex items-center space-x-2">
                            <button
                              type="button"
                              onClick={() => toggleOutputCollapse(originalIndex)}
                              className="flex items-center space-x-1 hover:text-onedark-fg cursor-pointer"
                            >
                              <ChevronRight className={`w-3 h-3 transition-transform ${!isOutputsCollapsed ? 'rotate-90' : ''}`} />
                              <span>{isOutputsCollapsed ? 'Show Output' : `Out [${execCount}]:`}</span>
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
                                    <pre className="m-0 font-mono text-[11.5px] whitespace-pre-wrap break-all leading-relaxed">
                                      {cleanAnsi(text)}
                                    </pre>
                                  </div>
                                );
                              }

                              // Error / Traceback with Agent Fix action
                              if (out.output_type === 'error') {
                                const tb = (out.traceback || []).map(cleanAnsi).join('\n');
                                return (
                                  <div
                                    key={outIdx}
                                    className="rounded-lg p-3.5 bg-onedark-red/10 border border-onedark-red/40 text-onedark-red overflow-x-auto relative"
                                  >
                                    <div className="flex items-center justify-between mb-2">
                                      <div className="font-bold text-[12.5px] text-onedark-red">
                                        {out.ename}: {out.evalue}
                                      </div>
                                      {onAskAboutLine && (
                                        <button
                                          type="button"
                                          onClick={() => handleFixErrorWithAgent(cell, originalIndex, out)}
                                          className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-onedark-red/20 hover:bg-onedark-red/30 text-onedark-red border border-onedark-red/50 transition-colors cursor-pointer shadow-xs"
                                        >
                                          <Zap className="w-3 h-3" />
                                          <span>Fix with Cyclode Agent</span>
                                        </button>
                                      )}
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

                  {/* Cell Insertion Divider on hover */}
                  <div 
                    onMouseEnter={() => setHoveredDividerIndex(originalIndex)}
                    onMouseLeave={() => setHoveredDividerIndex(null)}
                    className="relative h-3 flex items-center justify-center my-1 group/divider"
                  >
                    <div className="absolute inset-x-4 h-px bg-transparent group-hover/divider:bg-onedark-borderSubtle/60 transition-colors" />
                    <div className="opacity-0 group-hover/divider:opacity-100 transition-opacity z-10 flex items-center space-x-1.5 bg-onedark-darker px-2 py-0.5 rounded-full border border-onedark-borderSubtle shadow-xs text-[10.5px] font-mono">
                      <button
                        type="button"
                        onClick={() => handleAddCell('code', originalIndex)}
                        className="hover:text-onedark-accent flex items-center space-x-0.5 text-onedark-muted cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                        <span>Code</span>
                      </button>
                      <span className="text-onedark-borderSubtle">·</span>
                      <button
                        type="button"
                        onClick={() => handleAddCell('markdown', originalIndex)}
                        className="hover:text-onedark-purple flex items-center space-x-0.5 text-onedark-muted cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                        <span>Markdown</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
