import React, { useState, useMemo } from 'react';
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
  FileSpreadsheet
} from 'lucide-react';

interface DataTableViewProps {
  content: string;
  filePath: string;
  rawUrl: string;
}

export const DataTableView: React.FC<DataTableViewProps> = ({
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
  const { headers, rows } = useMemo(() => {
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

  // Filter rows
  const filteredRows = useMemo(() => {
    if (!filterQuery.trim()) return rows;
    const q = filterQuery.toLowerCase();
    return rows.filter((r) => r.some((cell) => cell.toLowerCase().includes(q)));
  }, [rows, filterQuery]);

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
      return sortDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
    });
    return sorted;
  }, [filteredRows, sortCol, sortDir]);

  // Pagination slice
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedRows.slice(start, start + pageSize);
  }, [sortedRows, currentPage, pageSize]);

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
          className="bg-amber-200 text-amber-950 border border-amber-400/80 dark:bg-amber-400/30 dark:text-amber-200 dark:border-amber-400/30 px-1 py-0.2 rounded font-semibold"
        >
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  return (
    <div className="h-full flex flex-col bg-onedark-bg font-sans overflow-hidden select-none">
      {/* Table Toolbar */}
      <div className="px-3 py-1.5 bg-onedark-darker/80 border-b border-onedark-borderSubtle flex items-center justify-between flex-shrink-0 text-xs gap-3">
        {/* Left: Summary & Search */}
        <div className="flex items-center space-x-3 flex-1 min-w-0">
          <div className="flex items-center space-x-1.5 font-mono text-[11px] text-onedark-muted flex-shrink-0">
            <FileSpreadsheet className="w-4 h-4 text-onedark-green flex-shrink-0" />
            <span className="font-semibold text-onedark-fg">{rows.length} rows</span>
            <span className="text-onedark-border">·</span>
            <span>{headers.length} cols</span>
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

        {/* Right: Delimiter & Pagination Settings */}
        <div className="flex items-center space-x-2 flex-shrink-0">
          {/* Delimiter Selector */}
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
            title="Download CSV dataset"
          >
            <Download className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* Grid Container */}
      <div className="flex-1 overflow-auto bg-onedark-bg relative">
        <table className="w-full text-left border-collapse font-mono text-[11.5px] select-text">
          <thead className="bg-onedark-surface sticky top-0 z-10 border-b border-onedark-borderSubtle shadow-xs">
            <tr>
              <th className="w-12 px-2.5 py-1.5 text-onedark-muted/60 text-right font-normal border-r border-onedark-borderSubtle/60 select-none">
                #
              </th>
              {headers.map((h, idx) => (
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
                <td colSpan={headers.length + 1} className="py-12 text-center text-onedark-muted">
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
                    {headers.map((_, colIdx) => (
                      <td
                        key={colIdx}
                        className="px-3 py-1 text-onedark-fg border-r border-onedark-borderSubtle/20 max-w-xs truncate"
                        title={row[colIdx]}
                      >
                        {highlightMatch(row[colIdx] || '', filterQuery)}
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
            {filterQuery && ` (filtered from ${rows.length})`}
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
    </div>
  );
};
