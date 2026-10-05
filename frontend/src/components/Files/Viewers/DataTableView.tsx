import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { 
  Table, 
  Search, 
  ArrowUpDown, 
  ArrowUp, 
  ArrowDown, 
  ChevronLeft, 
  ChevronRight, 
  Download,
  Filter,
  Layers,
  FileSpreadsheet,
  Terminal,
  Play,
  RotateCcw,
  Sparkles,
  Info,
  ChevronDown,
  RefreshCw,
  AlertCircle,
  BarChart3
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend
} from 'recharts';
import { CHART_THEME } from '../../Charts/ChartTheme';

interface DataTableViewProps {
  taskId?: string;
  content: string;
  filePath: string;
  rawUrl: string;
}

interface ColumnStat {
  type: string;
  count: number;
  null_count: number;
  unique_count: number;
  min?: number;
  max?: number;
}

const API_BASE = import.meta.env.VITE_API_URL || '';

export const DataTableView: React.FC<DataTableViewProps> = ({
  taskId,
  content,
  filePath,
  rawUrl,
}) => {
  const [filterQuery, setFilterQuery] = useState('');
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(50);
  const [manualDelimiter, setManualDelimiter] = useState<string>('auto');

  // SQL Query state
  const [sqlQuery, setSqlQuery] = useState<string>('');
  const [isSqlMode, setIsSqlMode] = useState<boolean>(false);
  const [sqlRunning, setSqlRunning] = useState<boolean>(false);
  const [sqlHeaders, setSqlHeaders] = useState<string[]>([]);
  const [sqlRows, setSqlRows] = useState<any[][]>([]);
  const [sqlError, setSqlError] = useState<string | null>(null);
  const [serverStats, setServerStats] = useState<Record<string, ColumnStat>>({});
  const [showStats, setShowStats] = useState<boolean>(false);
  // View mode & charting state
  const [viewMode, setViewMode] = useState<'table' | 'chart'>('table');
  const [chartType, setChartType] = useState<'bar' | 'line' | 'area'>('bar');
  const [chartXCol, setChartXCol] = useState<string>('');
  const [chartYCol, setChartYCol] = useState<string>('');

  // Server table data state for binary files (xlsx, xls, parquet) or server-streamed tables
  const isBinaryTable = useMemo(() => {
    const lower = (filePath || '').toLowerCase();
    return lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.parquet') || lower.endsWith('.pq');
  }, [filePath]);

  const [loadingServerData, setLoadingServerData] = useState<boolean>(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverHeaders, setServerHeaders] = useState<string[]>([]);
  const [serverRows, setServerRows] = useState<any[][]>([]);

  const fetchServerTableData = useCallback(async (page: number = 1, currentSqlQuery?: string) => {
    if (!taskId || !filePath) return;
    setLoadingServerData(true);
    setServerError(null);
    try {
      const res = await fetch(`${API_BASE}/api/tasks/${taskId}/files/query-table`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: filePath,
          page,
          page_size: pageSize,
          sql_query: currentSqlQuery || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Failed to read table (HTTP ${res.status})`);
      }
      const data = await res.json();
      if (data.error) {
        setServerError(data.error);
      } else {
        setServerHeaders(data.headers || []);
        setServerRows(data.rows || []);
        if (data.summary_stats) {
          setServerStats(data.summary_stats);
        }
      }
    } catch (e: any) {
      setServerError(e?.message || 'Error loading table data');
    } finally {
      setLoadingServerData(false);
    }
  }, [taskId, filePath, pageSize]);

  useEffect(() => {
    if (isBinaryTable || !content.trim()) {
      fetchServerTableData(1);
    }
  }, [isBinaryTable, content, fetchServerTableData]);

  // Detect delimiter from content
  const detectedDelimiter = useMemo(() => {
    if (manualDelimiter !== 'auto') return manualDelimiter;
    if (filePath.toLowerCase().endsWith('.tsv')) return '\t';
    const firstFewLines = content.split('\n').slice(0, 5).join('\n');
    const counts = {
      ',': (firstFewLines.match(/,/g) || []).length,
      '\t': (firstFewLines.match(/\t/g) || []).length,
      ';': (firstFewLines.match(/;/g) || []).length,
      '|': (firstFewLines.match(/\|/g) || []).length,
    };
    let best = ',';
    let maxCount = -1;
    for (const [delim, count] of Object.entries(counts)) {
      if (count > maxCount) {
        maxCount = count;
        best = delim;
      }
    }
    return maxCount > 0 ? best : ',';
  }, [content, filePath, manualDelimiter]);

  // Robust CSV/TSV parser supporting quotes
  const { headers: clientHeaders, rows: clientRows } = useMemo(() => {
    if (!content.trim()) return { headers: [], rows: [] };
    const delim = detectedDelimiter;

    const parseLine = (text: string): string[] => {
      const result: string[] = [];
      let cur = '';
      let inQuotes = false;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '"') {
          if (inQuotes && text[i + 1] === '"') {
            cur += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (c === delim && !inQuotes) {
          result.push(cur.trim());
          cur = '';
        } else {
          cur += c;
        }
      }
      result.push(cur.trim());
      return result;
    };

    const rawLines = content.split('\n').filter((l) => l.trim().length > 0);
    if (rawLines.length === 0) return { headers: [], rows: [] };

    const rawHeaders = parseLine(rawLines[0]);
    const rawRows = rawLines.slice(1).map(parseLine);

    return {
      headers: rawHeaders,
      rows: rawRows,
    };
  }, [content, detectedDelimiter]);

  // Execute SQL Query on backend
  const handleExecuteSql = async () => {
    if (!taskId || !sqlQuery.trim()) return;
    setSqlRunning(true);
    setSqlError(null);
    try {
      const res = await fetch(`${API_BASE}/api/tasks/${taskId}/files/query-table`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: filePath,
          sql_query: sqlQuery.trim(),
          page: 1,
          page_size: 500,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Query failed (HTTP ${res.status})`);
      }
      const data = await res.json();
      if (data.error) {
        setSqlError(data.error);
      } else {
        setSqlHeaders(data.headers || []);
        setSqlRows(data.rows || []);
        setIsSqlMode(true);
        if (data.summary_stats) {
          setServerStats(data.summary_stats);
        }
      }
    } catch (e: any) {
      setSqlError(e?.message || 'Error executing SQL query');
    } finally {
      setSqlRunning(false);
    }
  };

  const handleResetSql = () => {
    setIsSqlMode(false);
    setSqlQuery('');
    setSqlError(null);
    setSqlHeaders([]);
    setSqlRows([]);
  };

  const activeHeaders = isSqlMode ? sqlHeaders : (clientHeaders.length > 0 ? clientHeaders : serverHeaders);
  const activeRows = isSqlMode ? sqlRows : (clientRows.length > 0 ? clientRows : serverRows);

  // Filter rows
  const filteredRows = useMemo(() => {
    if (!filterQuery.trim()) return activeRows;
    const q = filterQuery.toLowerCase();
    return activeRows.filter((r) => r.some((cell) => String(cell || '').toLowerCase().includes(q)));
  }, [activeRows, filterQuery]);

  // Sort rows
  const sortedRows = useMemo(() => {
    if (sortCol === null) return filteredRows;
    const sorted = [...filteredRows].sort((a, b) => {
      const valA = a[sortCol] ?? '';
      const valB = b[sortCol] ?? '';

      const numA = Number(valA);
      const numB = Number(valB);
      if (!isNaN(numA) && !isNaN(numB)) {
        return sortDir === 'asc' ? numA - numB : numB - numA;
      }
      return sortDir === 'asc' ? String(valA).localeCompare(String(valB)) : String(valB).localeCompare(String(valA));
    });
    return sorted;
  }, [filteredRows, sortCol, sortDir]);

  // Pagination slice
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedRows.slice(start, start + pageSize);
  }, [sortedRows, currentPage, pageSize]);

  // Derive chart dataset
  const resolvedXCol = chartXCol || activeHeaders[0] || '';
  const xColIdx = Math.max(0, activeHeaders.indexOf(resolvedXCol));

  // Auto-detect first numeric column for Y axis if not chosen
  const resolvedYCol = useMemo(() => {
    if (chartYCol && activeHeaders.includes(chartYCol)) return chartYCol;
    for (let i = 0; i < activeHeaders.length; i++) {
      if (i !== xColIdx && activeRows.some((r) => typeof r[i] === 'number' || (!isNaN(Number(r[i])) && r[i] !== ''))) {
        return activeHeaders[i];
      }
    }
    return activeHeaders[1] || activeHeaders[0] || '';
  }, [chartYCol, activeHeaders, xColIdx, activeRows]);

  const yColIdx = Math.max(0, activeHeaders.indexOf(resolvedYCol));

  const chartData = useMemo(() => {
    if (activeHeaders.length === 0 || activeRows.length === 0) return [];
    return sortedRows.slice(0, 100).map((r) => {
      const rawX = r[xColIdx];
      const rawY = r[yColIdx];
      const numY = typeof rawY === 'number' ? rawY : parseFloat(String(rawY));
      return {
        [resolvedXCol]: rawX != null ? String(rawX) : '',
        [resolvedYCol]: isNaN(numY) ? 0 : numY,
      };
    });
  }, [sortedRows, activeHeaders, xColIdx, yColIdx, resolvedXCol, resolvedYCol]);

  const handleHeaderClick = (colIdx: number) => {
    if (sortCol === colIdx) {
      if (sortDir === 'asc') setSortDir('desc');
      else {
        setSortCol(null);
        setSortDir('asc');
      }
    } else {
      setSortCol(colIdx);
      setSortDir('asc');
    }
  };

  const highlightMatch = (text: string, query: string) => {
    if (!query || !text) return text;
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === query.toLowerCase() ? (
        <mark
          key={i}
          className="search-highlight bg-onedark-yellow/20 text-onedark-yellow font-semibold rounded px-1 py-0.2 border border-onedark-yellow/30"
        >
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  if (loadingServerData && activeHeaders.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-onedark-muted font-mono space-y-2">
        <RefreshCw className="w-5 h-5 animate-spin text-onedark-accent" />
        <span className="text-xs">Loading spreadsheet table data...</span>
      </div>
    );
  }

  if (serverError && activeHeaders.length === 0) {
    return (
      <div className="p-4 rounded-xl bg-onedark-red/10 border border-onedark-red/30 text-onedark-red text-xs font-mono m-4 flex items-start space-x-2">
        <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <div>
          <div className="font-semibold">Failed to read spreadsheet table</div>
          <div className="text-[11px] opacity-90 mt-0.5">{serverError}</div>
          <button
            onClick={() => fetchServerTableData(1)}
            className="mt-2 px-2.5 py-1 rounded bg-onedark-surface hover:bg-onedark-border text-onedark-fg text-[11px] transition-colors cursor-pointer"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-onedark-bg font-sans overflow-hidden select-none">
      {/* Table Toolbar */}
      <div className="px-3.5 py-1.5 bg-onedark-darker/90 border-b border-onedark-borderSubtle flex items-center justify-between flex-shrink-0 text-xs gap-3 flex-wrap">
        {/* Left: Summary & Search */}
        <div className="flex items-center space-x-3 flex-1 min-w-0">
          <div className="flex items-center space-x-1.5 font-mono text-[11px] text-onedark-muted flex-shrink-0">
            <FileSpreadsheet className="w-4 h-4 text-onedark-green flex-shrink-0" />
            <span className="font-semibold text-onedark-fg">{activeRows.length} rows</span>
            <span className="text-onedark-border">·</span>
            <span>{activeHeaders.length} cols</span>
            {isSqlMode && (
              <span className="ml-1 px-1.5 py-0.5 rounded bg-onedark-purple/20 text-onedark-purple text-[10px] font-bold">
                SQL RESULT
              </span>
            )}
          </div>

          <div className="relative flex items-center flex-1 max-w-xs">
            <Search className="w-3.5 h-3.5 text-onedark-muted absolute left-2 pointer-events-none" />
            <input
              type="text"
              value={filterQuery}
              onChange={(e) => {
                setFilterQuery(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Filter table rows..."
              className="w-full bg-onedark-surface/60 border border-transparent focus:border-onedark-accent/60 rounded-md pl-7 pr-3 py-1 text-[11.5px] text-onedark-fg font-mono focus:outline-none placeholder:text-onedark-muted/60"
            />
          </div>
        </div>

        {/* Right: View mode, Delimiter, Stats & Settings */}
        <div className="flex items-center space-x-2 flex-shrink-0">
          {/* Table / Chart Toggle */}
          <div className="flex items-center bg-onedark-surface/60 rounded-md p-0.5 border border-onedark-borderSubtle">
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className={`flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-mono cursor-pointer transition-colors ${
                viewMode === 'table' ? 'bg-onedark-accent text-onedark-darker font-bold shadow-xs' : 'text-onedark-muted hover:text-onedark-fg'
              }`}
            >
              <Table className="w-3 h-3" />
              <span>Table</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('chart')}
              className={`flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] font-mono cursor-pointer transition-colors ${
                viewMode === 'chart' ? 'bg-onedark-accent text-onedark-darker font-bold shadow-xs' : 'text-onedark-muted hover:text-onedark-fg'
              }`}
            >
              <BarChart3 className="w-3 h-3" />
              <span>Chart</span>
            </button>
          </div>

          {/* Stats Toggle */}
          <button
            type="button"
            onClick={() => setShowStats((s) => !s)}
            className={`flex items-center space-x-1 px-2 py-1 rounded text-[11px] font-mono transition-colors border border-onedark-borderSubtle cursor-pointer ${
              showStats ? 'bg-onedark-accent/20 text-onedark-accent border-onedark-accent/40 font-semibold' : 'bg-onedark-surface/60 text-onedark-muted hover:text-onedark-fg'
            }`}
            title="Toggle column statistics summary"
          >
            <Info className="w-3 h-3" />
            <span>Stats</span>
          </button>

          {/* Delimiter Selector */}
          {!isSqlMode && (
            <div className="flex items-center space-x-1 text-[11px] font-mono text-onedark-muted">
              <span>Delim:</span>
              <select
                value={manualDelimiter}
                onChange={(e) => setManualDelimiter(e.target.value)}
                className="bg-onedark-surface border border-onedark-borderSubtle rounded px-1.5 py-0.5 text-onedark-fg text-[11px] font-mono cursor-pointer focus:outline-none"
              >
                <option value="auto">Auto ({detectedDelimiter === '\t' ? 'TSV' : detectedDelimiter})</option>
                <option value=",">Comma (,)</option>
                <option value="	">Tab (\t)</option>
                <option value=";">Semicolon (;)</option>
                <option value="|">Pipe (|)</option>
              </select>
            </div>
          )}

          {/* Page Size */}
          <div className="flex items-center space-x-1 text-[11px] font-mono text-onedark-muted">
            <span>Show:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="bg-onedark-surface border border-onedark-borderSubtle rounded px-1.5 py-0.5 text-onedark-fg text-[11px] font-mono cursor-pointer focus:outline-none"
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={500}>500</option>
            </select>
          </div>

          {/* Download Raw CSV/TSV */}
          <a
            href={`${rawUrl}&download=true`}
            download={filePath.split('/').pop()}
            className="p-1 rounded-md bg-onedark-surface/60 hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg border border-onedark-borderSubtle transition-colors cursor-pointer"
            title="Download dataset"
          >
            <Download className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* SQL Query Bar (if taskId is provided) */}
      {taskId && (
        <div className="px-3.5 py-2 bg-onedark-surface/40 border-b border-onedark-borderSubtle/60 flex items-center space-x-2 text-xs">
          <Terminal className="w-4 h-4 text-onedark-purple flex-shrink-0" />
          <input
            type="text"
            value={sqlQuery}
            onChange={(e) => setSqlQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleExecuteSql();
            }}
            placeholder="Run SQL (e.g. SELECT * FROM data_table WHERE score > 50 ORDER BY created_at DESC)..."
            className="flex-1 bg-onedark-darker/80 border border-onedark-borderSubtle/60 focus:border-onedark-purple rounded px-3 py-1 font-mono text-[11.5px] text-onedark-fg focus:outline-none placeholder:text-onedark-muted/50"
          />
          <button
            type="button"
            onClick={handleExecuteSql}
            disabled={sqlRunning || !sqlQuery.trim()}
            className="flex items-center space-x-1 px-3 py-1 rounded bg-onedark-purple hover:bg-onedark-purple/80 text-white font-semibold text-[11px] cursor-pointer disabled:opacity-40 transition-colors shadow-xs"
          >
            <Play className="w-3 h-3 fill-current" />
            <span>{sqlRunning ? 'Querying...' : 'Run SQL'}</span>
          </button>
          {isSqlMode && (
            <button
              type="button"
              onClick={handleResetSql}
              className="flex items-center space-x-1 px-2.5 py-1 rounded bg-onedark-surface hover:bg-onedark-border text-onedark-muted hover:text-onedark-fg text-[11px] font-mono cursor-pointer border border-onedark-borderSubtle transition-colors"
              title="Reset to full dataset"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset</span>
            </button>
          )}
        </div>
      )}

      {/* SQL Error Banner */}
      {sqlError && (
        <div className="px-3.5 py-2 bg-onedark-red/10 border-b border-onedark-red/30 text-onedark-red font-mono text-[11.5px] flex items-center space-x-2">
          <Info className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="truncate">{sqlError}</span>
        </div>
      )}

      {/* Column Statistics Bar */}
      {showStats && (
        <div className="px-3.5 py-2.5 bg-onedark-surface/60 border-b border-onedark-borderSubtle overflow-x-auto flex items-center space-x-4 text-[11px] font-mono text-onedark-muted flex-shrink-0">
          <div className="text-onedark-fgBright font-semibold flex items-center space-x-1 flex-shrink-0">
            <Sparkles className="w-3.5 h-3.5 text-onedark-yellow" />
            <span>Column Schema:</span>
          </div>
          {activeHeaders.map((h, idx) => (
            <div key={idx} className="bg-onedark-darker/80 px-2.5 py-1 rounded border border-onedark-borderSubtle/60 flex-shrink-0 space-x-1.5">
              <span className="text-onedark-fg font-semibold">{h || `Col ${idx + 1}`}</span>
              <span className="text-onedark-blue text-[10px]">
                {serverStats[h]?.type || (isNaN(Number(activeRows[0]?.[idx])) ? 'string' : 'number')}
              </span>
              {serverStats[h]?.null_count != null && (
                <span className="text-onedark-muted/60 text-[10px]">({serverStats[h].null_count} nulls)</span>
              )}
            </div>
          ))}
        </div>
      )}

      {viewMode === 'chart' ? (
        <div className="flex-1 flex flex-col p-4 bg-onedark-darker overflow-auto">
          {/* Chart Controls Bar */}
          <div className="flex items-center justify-between pb-3 mb-3 border-b border-onedark-borderSubtle flex-wrap gap-2 text-xs font-mono">
            <div className="flex items-center space-x-3">
              <div className="flex items-center space-x-1.5">
                <span className="text-onedark-muted">Type:</span>
                <select
                  value={chartType}
                  onChange={(e) => setChartType(e.target.value as any)}
                  className="bg-onedark-surface border border-onedark-borderSubtle rounded px-2 py-1 text-onedark-fg text-xs font-mono cursor-pointer focus:outline-none"
                >
                  <option value="bar">Bar Chart</option>
                  <option value="line">Line Chart</option>
                  <option value="area">Area Chart</option>
                </select>
              </div>

              <div className="flex items-center space-x-1.5">
                <span className="text-onedark-muted">X-Axis:</span>
                <select
                  value={resolvedXCol}
                  onChange={(e) => setChartXCol(e.target.value)}
                  className="bg-onedark-surface border border-onedark-borderSubtle rounded px-2 py-1 text-onedark-fg text-xs font-mono cursor-pointer focus:outline-none"
                >
                  {activeHeaders.map((h, i) => (
                    <option key={i} value={h}>{h || `Col ${i + 1}`}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center space-x-1.5">
                <span className="text-onedark-muted">Y-Axis:</span>
                <select
                  value={resolvedYCol}
                  onChange={(e) => setChartYCol(e.target.value)}
                  className="bg-onedark-surface border border-onedark-borderSubtle rounded px-2 py-1 text-onedark-fg text-xs font-mono cursor-pointer focus:outline-none"
                >
                  {activeHeaders.map((h, i) => (
                    <option key={i} value={h}>{h || `Col ${i + 1}`}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="text-[11px] text-onedark-muted">
              Plotting {Math.min(sortedRows.length, 100)} data points
            </div>
          </div>

          {/* Chart Display Canvas */}
          <div className="flex-1 min-h-[300px] w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              {chartType === 'line' ? (
                <LineChart data={chartData} margin={{ top: 12, right: 20, left: 10, bottom: 20 }}>
                  <CartesianGrid {...CHART_THEME.grid} />
                  <XAxis dataKey={resolvedXCol} {...CHART_THEME.axis} tick={{ fontSize: 10 }} />
                  <YAxis {...CHART_THEME.axis} tick={{ fontSize: 10 }} />
                  <Tooltip {...CHART_THEME.tooltip} />
                  <Legend wrapperStyle={{ paddingTop: 8, fontSize: 11, fontFamily: 'JetBrains Mono, Menlo, monospace', color: '#CBD5E1' }} />
                  <Line type="monotone" dataKey={resolvedYCol} stroke={CHART_THEME.colors.accent} strokeWidth={2.2} dot={{ r: 3, fill: CHART_THEME.colors.accent }} />
                </LineChart>
              ) : chartType === 'area' ? (
                <AreaChart data={chartData} margin={{ top: 12, right: 20, left: 10, bottom: 20 }}>
                  <defs>
                    <linearGradient id="dataAreaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CHART_THEME.colors.accent} stopOpacity={0.4} />
                      <stop offset="95%" stopColor={CHART_THEME.colors.accent} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid {...CHART_THEME.grid} />
                  <XAxis dataKey={resolvedXCol} {...CHART_THEME.axis} tick={{ fontSize: 10 }} />
                  <YAxis {...CHART_THEME.axis} tick={{ fontSize: 10 }} />
                  <Tooltip {...CHART_THEME.tooltip} />
                  <Legend wrapperStyle={{ paddingTop: 8, fontSize: 11, fontFamily: 'JetBrains Mono, Menlo, monospace', color: '#CBD5E1' }} />
                  <Area type="monotone" dataKey={resolvedYCol} stroke={CHART_THEME.colors.accent} fillOpacity={1} fill="url(#dataAreaGrad)" strokeWidth={2} />
                </AreaChart>
              ) : (
                <BarChart data={chartData} margin={{ top: 12, right: 20, left: 10, bottom: 20 }}>
                  <CartesianGrid {...CHART_THEME.grid} />
                  <XAxis dataKey={resolvedXCol} {...CHART_THEME.axis} tick={{ fontSize: 10 }} />
                  <YAxis {...CHART_THEME.axis} tick={{ fontSize: 10 }} />
                  <Tooltip {...CHART_THEME.tooltip} />
                  <Legend wrapperStyle={{ paddingTop: 8, fontSize: 11, fontFamily: 'JetBrains Mono, Menlo, monospace', color: '#CBD5E1' }} />
                  <Bar dataKey={resolvedYCol} fill={CHART_THEME.colors.accent} radius={[4, 4, 0, 0]} maxBarSize={48} />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        </div>
      ) : (
        <>
          {/* Grid Container */}
          <div className="flex-1 overflow-auto bg-onedark-bg relative [scrollbar-gutter:stable]">
            <table className="w-full text-left border-collapse font-mono text-[11.5px] select-text">
              <thead className="bg-onedark-surface sticky top-0 z-10 border-b border-onedark-borderSubtle shadow-xs">
                <tr>
                  <th className="w-12 px-2.5 py-1.5 text-onedark-muted/60 text-right font-normal border-r border-onedark-borderSubtle/60 select-none">
                    #
                  </th>
                  {activeHeaders.map((h, idx) => (
                    <th
                      key={idx}
                      onClick={() => handleHeaderClick(idx)}
                      className="px-3 py-1.5 text-onedark-fgBright font-semibold hover:bg-onedark-darker/60 cursor-pointer border-r border-onedark-borderSubtle/40 transition-colors select-none"
                    >
                      <div className="flex items-center justify-between space-x-1">
                        <span className="truncate">{h || `Column ${idx + 1}`}</span>
                        {sortCol === idx ? (
                          sortDir === 'asc' ? (
                            <ArrowUp className="w-3 h-3 text-onedark-accent flex-shrink-0" />
                          ) : (
                            <ArrowDown className="w-3 h-3 text-onedark-accent flex-shrink-0" />
                          )
                        ) : (
                          <ArrowUpDown className="w-2.5 h-2.5 text-onedark-muted/40 opacity-0 group-hover:opacity-100 flex-shrink-0" />
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-onedark-borderSubtle/30">
                {paginatedRows.length === 0 ? (
                  <tr>
                    <td colSpan={activeHeaders.length + 1} className="py-12 text-center text-onedark-muted">
                      {filterQuery ? 'No matching rows found.' : 'Dataset is empty.'}
                    </td>
                  </tr>
                ) : (
                  paginatedRows.map((row, rowIdx) => {
                    const globalRowIdx = (currentPage - 1) * pageSize + rowIdx + 1;
                    return (
                      <tr
                        key={rowIdx}
                        className="hover:bg-onedark-surface/40 transition-colors even:bg-onedark-surface/10"
                      >
                        <td className="px-2.5 py-1 text-onedark-muted/60 text-right border-r border-onedark-borderSubtle/40 select-none font-mono text-[10.5px]">
                          {globalRowIdx}
                        </td>
                        {activeHeaders.map((_, colIdx) => (
                          <td
                            key={colIdx}
                            className="px-3 py-1 text-onedark-fg border-r border-onedark-borderSubtle/20 max-w-xs truncate"
                            title={String(row[colIdx] ?? '')}
                          >
                            {highlightMatch(String(row[colIdx] ?? ''), filterQuery)}
                          </td>
                        ))}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          {totalPages > 1 && (
            <div className="px-3 py-1.5 bg-onedark-darker/90 border-t border-onedark-borderSubtle flex items-center justify-between flex-shrink-0 font-mono text-[11px] text-onedark-muted">
              <div>
                Showing {(currentPage - 1) * pageSize + 1}–
                {Math.min(currentPage * pageSize, sortedRows.length)} of {sortedRows.length} rows
                {filterQuery && ` (filtered from ${activeRows.length})`}
              </div>

              <div className="flex items-center space-x-1.5">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="p-1 rounded bg-onedark-surface hover:bg-onedark-surface/80 text-onedark-fg disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed border border-onedark-borderSubtle"
                  title="Previous page"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span className="px-2 font-semibold text-onedark-fg">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="p-1 rounded bg-onedark-surface hover:bg-onedark-surface/80 text-onedark-fg disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed border border-onedark-borderSubtle"
                  title="Next page"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
