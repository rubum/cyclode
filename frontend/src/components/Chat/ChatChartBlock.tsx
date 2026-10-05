import React, { useState, useMemo } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend
} from 'recharts';
import {
  BarChart3,
  Table as TableIcon,
  Code2,
  Copy,
  Check,
  Download,
  Maximize2,
  Minimize2,
  ArrowLeftRight,
  AlertCircle,
  Sparkles
} from 'lucide-react';
import { CHART_THEME } from '../Charts/ChartTheme';
import { ErrorBoundary } from '../Common/ErrorBoundary';

export interface ChartSeriesConfig {
  key: string;
  label?: string;
  color?: string;
}

export interface ChartSpecification {
  type?: 'bar' | 'line' | 'area' | 'pie';
  title?: string;
  description?: string;
  xAxis?: string;
  yAxisUnit?: string;
  series?: Array<string | ChartSeriesConfig | Record<string, any>>;
  data: Array<Record<string, any>>;
}

interface ChatChartBlockProps {
  rawJson: string;
  isStreaming?: boolean;
  className?: string;
}

const ChatChartBlockInner: React.FC<ChatChartBlockProps> = ({
  rawJson,
  isStreaming = false,
  className = ''
}) => {
  const [viewMode, setViewMode] = useState<'chart' | 'table' | 'json'>('chart');
  const [copied, setCopied] = useState<boolean>(false);
  const [isFullWidth, setIsFullWidth] = useState<boolean>(false);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);

  // Parse JSON specification safely
  const { spec, parseError } = useMemo(() => {
    try {
      const parsed = JSON.parse(rawJson);
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.data)) {
        return { spec: null, parseError: 'Missing or invalid "data" array in chart specification.' };
      }
      return { spec: parsed as ChartSpecification, parseError: null };
    } catch (err: any) {
      return { spec: null, parseError: err?.message || 'Invalid JSON syntax.' };
    }
  }, [rawJson]);

  // Determine series, xAxis, and data columns automatically and safely
  const { derivedXAxis, derivedSeries, chartType, normalizedData, xAxisTitle } = useMemo(() => {
    if (!spec || !Array.isArray(spec.data) || spec.data.length === 0) {
      return { derivedXAxis: '', derivedSeries: [], chartType: 'bar', normalizedData: [], xAxisTitle: '' };
    }

    // 1. Normalize data objects and sanitize numbers
    const normalizedData = spec.data.map((row) => {
      if (typeof row !== 'object' || row === null) return { value: row };
      const cleanRow: Record<string, any> = {};
      for (const [k, v] of Object.entries(row)) {
        if (typeof v === 'string') {
          const trimmed = v.trim();
          const cleanNum = trimmed.replace(/,/g, '');
          if (!isNaN(Number(cleanNum)) && cleanNum !== '') {
            cleanRow[k] = Number(cleanNum);
          } else {
            cleanRow[k] = v;
          }
        } else {
          cleanRow[k] = v;
        }
      }
      return cleanRow;
    });

    const firstRow = normalizedData[0] || {};
    const keys = Object.keys(firstRow);

    // 2. Resolve the actual dataKey to use for the X-Axis
    let xAxis = '';
    const rawXAxis = typeof spec.xAxis === 'string' ? spec.xAxis.trim() : '';

    if (rawXAxis && keys.includes(rawXAxis)) {
      // Direct exact match in firstRow
      xAxis = rawXAxis;
    } else if (rawXAxis) {
      // Case-insensitive match in firstRow
      const lower = rawXAxis.toLowerCase();
      const match = keys.find((k) => k.toLowerCase() === lower);
      if (match) {
        xAxis = match;
      }
    }

    // If spec.xAxis was not a valid key in firstRow, check conventional label keys
    if (!xAxis) {
      const preferredKeys = ['label', 'name', 'category', 'bucket', 'x', 'date', 'time', 'timestamp', 'key', 'item', 'group', 'percentile'];
      const foundPreferred = preferredKeys.find((pk) => keys.some((k) => k.toLowerCase() === pk));
      if (foundPreferred) {
        xAxis = keys.find((k) => k.toLowerCase() === foundPreferred) || '';
      }
    }

    // If still not matched, find first non-numeric key in firstRow
    if (!xAxis) {
      xAxis = keys.find((k) => typeof firstRow[k] === 'string') || keys[0] || 'name';
    }

    const xAxisTitle = rawXAxis && rawXAxis !== xAxis ? rawXAxis : '';

    // 3. Resolve series
    const nonXKeys = keys.filter((k) => k !== xAxis);
    const numericKeys = nonXKeys.filter((k) => typeof firstRow[k] === 'number');
    const availableSeriesKeys = numericKeys.length > 0 ? numericKeys : nonXKeys;

    const rawSeries = Array.isArray(spec.series) ? spec.series : [];
    let series: ChartSeriesConfig[] = [];

    if (rawSeries.length === 0) {
      series = availableSeriesKeys.map((k, idx) => ({
        key: k,
        label: k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        color: CHART_THEME.colors.palette[idx % CHART_THEME.colors.palette.length],
      }));
    } else {
      series = rawSeries.map((s: any, idx: number) => {
        let rawKey = typeof s === 'string' ? s : String(s?.key || s?.dataKey || s?.name || '');
        let rawLabel = typeof s === 'object' && s?.label ? String(s.label) : (typeof s === 'object' && s?.name ? String(s.name) : rawKey);
        let rawColor = typeof s === 'object' && s?.color ? String(s.color) : CHART_THEME.colors.palette[idx % CHART_THEME.colors.palette.length];

        // Resolve rawKey against actual keys in firstRow
        let resolvedKey = rawKey;
        if (!keys.includes(resolvedKey)) {
          // Try case-insensitive
          const lower = rawKey.toLowerCase();
          const match = keys.find((k) => k.toLowerCase() === lower);
          if (match) {
            resolvedKey = match;
          } else {
            // Try fuzzy match (e.g. "Latency" matching "Latency (ms)")
            const fuzzy = keys.find((k) => k.toLowerCase().includes(lower) || lower.includes(k.toLowerCase()));
            if (fuzzy) {
              resolvedKey = fuzzy;
            } else if (availableSeriesKeys[idx]) {
              resolvedKey = availableSeriesKeys[idx];
            }
          }
        }

        return {
          key: resolvedKey || availableSeriesKeys[idx] || `series_${idx}`,
          label: rawLabel || resolvedKey || `Series ${idx + 1}`,
          color: rawColor,
        };
      });
    }

    const type = spec.type || 'bar';
    return { derivedXAxis: xAxis, derivedSeries: series, chartType: type, normalizedData, xAxisTitle };
  }, [spec]);

  const handleCopy = () => {
    navigator.clipboard.writeText(rawJson);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadCsv = () => {
    if (!normalizedData || normalizedData.length === 0) return;
    const headers = Object.keys(normalizedData[0] || {});
    const csvRows = [
      headers.join(','),
      ...normalizedData.map((row) =>
        headers.map((h) => JSON.stringify(row[h] ?? '')).join(',')
      )
    ];
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${(spec?.title || 'chart-data').toLowerCase().replace(/\s+/g, '-')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // If currently streaming and incomplete JSON, show graceful skeleton
  if (isStreaming && parseError) {
    return (
      <div className={`my-3 p-4 rounded-xl bg-onedark-darker border border-onedark-borderSubtle flex items-center space-x-3 text-xs text-onedark-muted animate-pulse ${className}`}>
        <Sparkles className="w-4 h-4 text-onedark-accent animate-spin" />
        <span className="font-mono">Streaming dynamic visualization...</span>
      </div>
    );
  }

  // If finalized but invalid JSON or empty series, show graceful code container
  if (!spec || parseError || derivedSeries.length === 0) {
    return (
      <div className={`my-3 rounded-xl bg-onedark-darker border border-onedark-borderSubtle overflow-hidden text-xs ${className}`}>
        <div className="flex items-center justify-between px-3.5 py-2 bg-amber-500/10 border-b border-amber-500/20 text-amber-400">
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-3.5 h-3.5" />
            <span className="font-semibold">Chart Parse Warning: {parseError || 'No valid series found'}</span>
          </div>
          <button
            onClick={handleCopy}
            className="flex items-center space-x-1 px-2 py-0.5 rounded text-[10.5px] hover:bg-amber-500/20 transition-colors cursor-pointer"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            <span>{copied ? 'Copied' : 'Copy JSON'}</span>
          </button>
        </div>
        <div className="p-3 text-[11px] text-onedark-muted font-mono leading-relaxed overflow-x-auto">
          <pre className="text-onedark-fg">{rawJson}</pre>
        </div>
      </div>
    );
  }

  const renderChartGraphic = (height: number | '100%' = 260) => {
    switch (chartType) {
      case 'line':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <LineChart data={normalizedData} margin={{ top: 16, right: 24, left: 10, bottom: 24 }}>
              <CartesianGrid {...CHART_THEME.grid} />
              <XAxis
                dataKey={derivedXAxis}
                stroke={CHART_THEME.axis.stroke}
                tickLine={CHART_THEME.axis.tickLine}
                tick={CHART_THEME.axis.tick}
              />
              <YAxis
                stroke={CHART_THEME.axis.stroke}
                tickLine={CHART_THEME.axis.tickLine}
                tick={CHART_THEME.axis.tick}
                unit={spec.yAxisUnit ? ` ${spec.yAxisUnit}` : undefined}
              />
              <Tooltip {...CHART_THEME.tooltip} />
              <Legend
                wrapperStyle={{
                  paddingTop: 10,
                  fontSize: 11,
                  fontFamily: 'JetBrains Mono, Menlo, monospace',
                  color: '#CBD5E1'
                }}
              />
              {derivedSeries.map((s) => (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.color}
                  strokeWidth={2.4}
                  dot={{ r: 3.5, fill: s.color }}
                  activeDot={{ r: 5.5, strokeWidth: 1.5, stroke: '#FFFFFF' }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        );

      case 'area':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <AreaChart data={normalizedData} margin={{ top: 16, right: 24, left: 10, bottom: 24 }}>
              <defs>
                {derivedSeries.map((s) => (
                  <linearGradient key={`grad-${s.key}`} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={s.color} stopOpacity={0.4} />
                    <stop offset="95%" stopColor={s.color} stopOpacity={0.02} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid {...CHART_THEME.grid} />
              <XAxis
                dataKey={derivedXAxis}
                stroke={CHART_THEME.axis.stroke}
                tickLine={CHART_THEME.axis.tickLine}
                tick={CHART_THEME.axis.tick}
              />
              <YAxis
                stroke={CHART_THEME.axis.stroke}
                tickLine={CHART_THEME.axis.tickLine}
                tick={CHART_THEME.axis.tick}
                unit={spec.yAxisUnit ? ` ${spec.yAxisUnit}` : undefined}
              />
              <Tooltip {...CHART_THEME.tooltip} />
              <Legend
                wrapperStyle={{
                  paddingTop: 10,
                  fontSize: 11,
                  fontFamily: 'JetBrains Mono, Menlo, monospace',
                  color: '#CBD5E1'
                }}
              />
              {derivedSeries.map((s) => (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.color}
                  fillOpacity={1}
                  fill={`url(#grad-${s.key})`}
                  strokeWidth={2}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        );

      case 'pie': {
        const valueKey = derivedSeries[0]?.key || Object.keys(normalizedData[0] || {})[1] || 'value';
        return (
          <ResponsiveContainer width="100%" height={height}>
            <PieChart margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
              <Tooltip {...CHART_THEME.tooltip} />
              <Legend
                wrapperStyle={{
                  paddingTop: 10,
                  fontSize: 11,
                  fontFamily: 'JetBrains Mono, Menlo, monospace',
                  color: '#CBD5E1'
                }}
              />
              <Pie
                data={normalizedData}
                dataKey={valueKey}
                nameKey={derivedXAxis}
                cx="50%"
                cy="50%"
                innerRadius={height === '100%' ? 60 : 45}
                outerRadius={height === '100%' ? 110 : 85}
                paddingAngle={3}
              >
                {normalizedData.map((_, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={CHART_THEME.colors.palette[index % CHART_THEME.colors.palette.length]}
                  />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        );
      }

      case 'bar':
      default:
        return (
          <ResponsiveContainer width="100%" height={height}>
            <BarChart data={normalizedData} margin={{ top: 16, right: 24, left: 10, bottom: 24 }}>
              <CartesianGrid {...CHART_THEME.grid} />
              <XAxis
                dataKey={derivedXAxis}
                stroke={CHART_THEME.axis.stroke}
                tickLine={CHART_THEME.axis.tickLine}
                tick={CHART_THEME.axis.tick}
              />
              <YAxis
                stroke={CHART_THEME.axis.stroke}
                tickLine={CHART_THEME.axis.tickLine}
                tick={CHART_THEME.axis.tick}
                unit={spec.yAxisUnit ? ` ${spec.yAxisUnit}` : undefined}
              />
              <Tooltip {...CHART_THEME.tooltip} />
              <Legend
                wrapperStyle={{
                  paddingTop: 10,
                  fontSize: 11,
                  fontFamily: 'JetBrains Mono, Menlo, monospace',
                  color: '#CBD5E1'
                }}
              />
              {derivedSeries.map((s) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  fill={s.color}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={48}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        );
    }
  };

  return (
    <>
      <div
        className={`my-3 rounded-xl bg-onedark-darker/90 border border-onedark-borderSubtle overflow-hidden shadow-xs group/chart transition-all ${
          isFullWidth ? 'w-full !max-w-none' : 'w-full'
        } ${className}`}
      >
        {/* Header Toolbar */}
        <div className="flex items-center justify-between px-3.5 py-1.5 bg-onedark-surface/50 border-b border-onedark-borderSubtle/60 text-[11px] text-onedark-muted font-mono select-none flex-wrap gap-1">
          <div className="flex items-center space-x-2">
            <BarChart3 className="w-3.5 h-3.5 text-onedark-accent" />
            <span className="font-semibold text-onedark-fgBright">
              {spec.title || 'Dynamic Visualization'}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-onedark-accent/15 text-onedark-accent font-semibold uppercase">
              {chartType}
            </span>
            {xAxisTitle && (
              <span className="text-[10.5px] text-onedark-muted font-mono hidden sm:inline">
                by {xAxisTitle}
              </span>
            )}
          </div>

          <div className="flex items-center space-x-1.5">
            {/* View Mode Switcher */}
            <div className="flex items-center bg-onedark-darker p-0.5 rounded-lg border border-onedark-border">
              <button
                type="button"
                onClick={() => setViewMode('chart')}
                className={`px-2 py-0.5 rounded text-[10.5px] transition-colors cursor-pointer ${
                  viewMode === 'chart'
                    ? 'bg-onedark-surface text-onedark-accent font-semibold shadow-xs'
                    : 'text-onedark-muted hover:text-onedark-fgBright'
                }`}
              >
                Chart
              </button>
              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={`px-2 py-0.5 rounded text-[10.5px] transition-colors cursor-pointer ${
                  viewMode === 'table'
                    ? 'bg-onedark-surface text-onedark-accent font-semibold shadow-xs'
                    : 'text-onedark-muted hover:text-onedark-fgBright'
                }`}
              >
                Table
              </button>
              <button
                type="button"
                onClick={() => setViewMode('json')}
                className={`px-2 py-0.5 rounded text-[10.5px] transition-colors cursor-pointer ${
                  viewMode === 'json'
                    ? 'bg-onedark-surface text-onedark-accent font-semibold shadow-xs'
                    : 'text-onedark-muted hover:text-onedark-fgBright'
                }`}
              >
                JSON
              </button>
            </div>

            <button
              type="button"
              onClick={() => setIsFullWidth(!isFullWidth)}
              className={`flex items-center space-x-1 transition-colors px-2 py-0.5 rounded text-[10.5px] cursor-pointer ${
                isFullWidth
                  ? 'bg-onedark-accent/20 text-onedark-accent font-semibold'
                  : 'hover:text-onedark-fgBright hover:bg-onedark-surface text-onedark-muted'
              }`}
              title={isFullWidth ? 'Restore standard width' : 'Expand full width'}
            >
              <ArrowLeftRight className="w-3 h-3" />
              <span>{isFullWidth ? 'Standard' : 'Full Width'}</span>
            </button>

            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="flex items-center space-x-1 px-2 py-0.5 rounded text-[10.5px] hover:text-onedark-fgBright hover:bg-onedark-surface text-onedark-muted transition-colors cursor-pointer"
              title="Expand full screen"
            >
              <Maximize2 className="w-3 h-3" />
            </button>

            <button
              type="button"
              onClick={handleDownloadCsv}
              className="flex items-center space-x-1 px-2 py-0.5 rounded text-[10.5px] hover:text-onedark-fgBright hover:bg-onedark-surface text-onedark-muted transition-colors cursor-pointer"
              title="Download CSV dataset"
            >
              <Download className="w-3 h-3" />
              <span>CSV</span>
            </button>

            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center space-x-1 px-2 py-0.5 rounded text-[10.5px] hover:text-onedark-fgBright hover:bg-onedark-surface text-onedark-muted transition-colors cursor-pointer"
              title="Copy JSON source"
            >
              {copied ? <Check className="w-3 h-3 text-onedark-green" /> : <Copy className="w-3 h-3" />}
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-3.5">
          {spec.description && (
            <p className="text-xs text-onedark-fg/75 mb-3 font-sans leading-relaxed">
              {spec.description}
            </p>
          )}

          {viewMode === 'chart' && (
            <div className="w-full pt-1">
              {renderChartGraphic(260)}
            </div>
          )}

          {viewMode === 'table' && (
            <div className="w-full max-h-72 overflow-auto rounded-lg border border-onedark-borderSubtle bg-onedark-bg">
              <table className="w-full text-left text-[11px] font-mono border-collapse">
                <thead className="bg-onedark-surface/60 text-onedark-muted sticky top-0 border-b border-onedark-borderSubtle">
                  <tr>
                    <th className="py-1.5 px-3 font-semibold">{xAxisTitle || derivedXAxis}</th>
                    {derivedSeries.map((s) => (
                      <th key={s.key} className="py-1.5 px-3 font-semibold">
                        {s.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-onedark-borderSubtle/50">
                  {normalizedData.map((row, idx) => (
                    <tr key={idx} className="hover:bg-onedark-surface/30 transition-colors">
                      <td className="py-1.5 px-3 text-onedark-fgBright font-medium">
                        {String(row[derivedXAxis] ?? '')}
                      </td>
                      {derivedSeries.map((s) => (
                        <td key={s.key} className="py-1.5 px-3 text-onedark-fg">
                          {typeof row[s.key] === 'number'
                            ? Number(row[s.key]).toLocaleString()
                            : String(row[s.key] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {viewMode === 'json' && (
            <div className="w-full max-h-72 overflow-auto rounded-lg border border-onedark-borderSubtle bg-onedark-bg p-3">
              <pre className="text-[11px] font-mono text-onedark-fg leading-relaxed">
                {JSON.stringify(spec, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>

      {/* Expanded Fullscreen Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs animate-modal-enter">
          <div className="relative w-full max-w-5xl h-[80vh] flex flex-col bg-onedark-darker border border-onedark-border rounded-2xl overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between px-5 py-3 border-b border-onedark-borderSubtle bg-onedark-surface/40 select-none">
              <div className="flex items-center space-x-2">
                <BarChart3 className="w-4 h-4 text-onedark-accent" />
                <span className="font-semibold text-xs text-onedark-fgBright">
                  {spec.title || 'Data Visualization Inspection'}
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={handleDownloadCsv}
                  className="px-2.5 py-1 text-xs rounded-lg bg-onedark-surface hover:bg-onedark-surface/80 text-onedark-fg font-medium transition-colors cursor-pointer flex items-center space-x-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download CSV</span>
                </button>
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="p-1.5 rounded-lg hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fgBright transition-colors cursor-pointer"
                >
                  <Minimize2 className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 p-6 overflow-auto flex items-center justify-center">
              {renderChartGraphic('100%')}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export const ChatChartBlock: React.FC<ChatChartBlockProps> = (props) => {
  return (
    <ErrorBoundary
      fallbackTitle="Visualization Error"
      fallbackMessage="An unexpected error occurred while rendering the chart component."
    >
      <ChatChartBlockInner {...props} />
    </ErrorBoundary>
  );
};
