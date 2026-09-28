import React, { useState, useEffect, useMemo } from 'react';
import { 
  Archive, 
  File, 
  Folder, 
  FolderOpen, 
  Search, 
  Download, 
  RefreshCw, 
  AlertCircle, 
  FileCode, 
  Image as ImageIcon, 
  FileText, 
  ChevronRight, 
  ChevronDown,
  Layers,
  HardDrive
} from 'lucide-react';

interface ArchiveEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  compressed_size: number;
  date: string;
}

interface ArchiveInspectResponse {
  path: string;
  name: string;
  format: 'zip' | 'tar';
  total_files: number;
  total_uncompressed_size: number;
  total_compressed_size: number;
  compression_ratio: string;
  entries: ArchiveEntry[];
}

interface ArchiveViewerProps {
  taskId: string;
  filePath: string;
  fileSize?: number;
  rawUrl: string;
}

const API_BASE = import.meta.env.VITE_API_URL || '';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export const ArchiveViewer: React.FC<ArchiveViewerProps> = ({
  taskId,
  filePath,
  fileSize,
  rawUrl,
}) => {
  const [data, setData] = useState<ArchiveInspectResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [viewMode, setViewMode] = useState<'flat' | 'tree'>('flat');
  const [sortCol, setSortCol] = useState<'name' | 'size' | 'date'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const fetchArchiveContents = async () => {
    if (!taskId || !filePath) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/tasks/${taskId}/files/archive-inspect?path=${encodeURIComponent(filePath)}`
      );
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `Failed to inspect archive (HTTP ${res.status})`);
      }
      const inspectData = await res.json();
      setData(inspectData);
    } catch (e: any) {
      setError(e?.message || 'Error reading archive hierarchy');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchArchiveContents();
  }, [taskId, filePath]);

  const filteredEntries = useMemo(() => {
    if (!data?.entries) return [];
    let list = [...data.entries];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((e) => e.path.toLowerCase().includes(q) || e.name.toLowerCase().includes(q));
    }
    list.sort((a, b) => {
      // Always put directories first
      if (a.is_dir && !b.is_dir) return -1;
      if (!a.is_dir && b.is_dir) return 1;

      let valA: any = a[sortCol];
      let valB: any = b[sortCol];
      if (typeof valA === 'string') {
        valA = valA.toLowerCase();
        valB = (valB || '').toLowerCase();
        return sortDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      return sortDir === 'asc' ? valA - valB : valB - valA;
    });
    return list;
  }, [data, searchQuery, sortCol, sortDir]);

  const handleSort = (col: 'name' | 'size' | 'date') => {
    if (sortCol === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  };

  const getFileIcon = (entry: ArchiveEntry) => {
    if (entry.is_dir) return <Folder className="w-4 h-4 text-onedark-yellow flex-shrink-0" />;
    const lower = entry.name.toLowerCase();
    if (
      lower.endsWith('.png') ||
      lower.endsWith('.jpg') ||
      lower.endsWith('.jpeg') ||
      lower.endsWith('.svg') ||
      lower.endsWith('.gif') ||
      lower.endsWith('.webp')
    ) {
      return <ImageIcon className="w-4 h-4 text-onedark-purple flex-shrink-0" />;
    }
    if (
      lower.endsWith('.py') ||
      lower.endsWith('.ts') ||
      lower.endsWith('.tsx') ||
      lower.endsWith('.js') ||
      lower.endsWith('.jsx') ||
      lower.endsWith('.rs') ||
      lower.endsWith('.go') ||
      lower.endsWith('.json') ||
      lower.endsWith('.yaml') ||
      lower.endsWith('.yml')
    ) {
      return <FileCode className="w-4 h-4 text-onedark-blue flex-shrink-0" />;
    }
    if (lower.endsWith('.md') || lower.endsWith('.txt') || lower.endsWith('.pdf')) {
      return <FileText className="w-4 h-4 text-onedark-green flex-shrink-0" />;
    }
    return <File className="w-4 h-4 text-onedark-muted flex-shrink-0" />;
  };

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-onedark-muted font-mono space-y-3">
        <RefreshCw className="w-8 h-8 text-onedark-accent animate-spin" />
        <span className="text-xs">Inspecting archive hierarchy...</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-onedark-muted font-sans space-y-4">
        <AlertCircle className="w-12 h-12 text-onedark-red flex-shrink-0" />
        <div className="max-w-md">
          <h3 className="text-sm font-semibold text-onedark-fg">Failed to Inspect Archive</h3>
          <p className="text-xs text-onedark-muted mt-1 font-mono">{error || 'Unknown archive error'}</p>
        </div>
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={fetchArchiveContents}
            className="px-3 py-1.5 rounded-lg bg-onedark-surface hover:bg-onedark-border text-onedark-fg text-xs font-semibold transition-colors border border-onedark-borderSubtle cursor-pointer"
          >
            Retry
          </button>
          <a
            href={`${rawUrl}&download=true`}
            download={filePath.split('/').pop()}
            className="px-3.5 py-1.5 rounded-lg bg-onedark-accent hover:bg-onedark-accent/90 text-onedark-bg text-xs font-semibold transition-colors"
          >
            Download Archive
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-onedark-bg font-sans overflow-hidden select-text">
      {/* Archive Header Toolbar */}
      <div className="px-3.5 py-2 bg-onedark-darker/90 border-b border-onedark-borderSubtle flex items-center justify-between flex-shrink-0 text-xs gap-3 select-none flex-wrap">
        {/* Left: Metadata summary */}
        <div className="flex items-center space-x-3 flex-1 min-w-0">
          <div className="flex items-center space-x-2 font-mono text-[11.5px] text-onedark-muted flex-shrink-0">
            <Archive className="w-4 h-4 text-onedark-accent flex-shrink-0" />
            <span className="font-semibold text-onedark-fg">{data.total_files} files</span>
            <span className="text-onedark-border">·</span>
            <span className="text-onedark-yellow">{data.compression_ratio} compression</span>
          </div>

          <div className="flex items-center space-x-2 bg-onedark-surface/80 px-2 py-0.5 rounded-md border border-onedark-borderSubtle/60 text-[11px] text-onedark-muted font-mono flex-shrink-0">
            <HardDrive className="w-3.5 h-3.5 text-onedark-green" />
            <span>
              {formatBytes(data.total_compressed_size)} &rarr; {formatBytes(data.total_uncompressed_size)} uncompressed
            </span>
          </div>

          <div className="relative flex items-center flex-1 max-w-xs">
            <Search className="w-3.5 h-3.5 text-onedark-muted absolute left-2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search files inside archive..."
              className="w-full bg-onedark-surface/60 border border-transparent focus:border-onedark-accent/60 rounded-md pl-7 pr-3 py-1 text-[11.5px] text-onedark-fg font-mono focus:outline-none placeholder:text-onedark-muted/60"
            />
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center space-x-2 flex-shrink-0">
          <button
            type="button"
            onClick={fetchArchiveContents}
            className="p-1 rounded-md bg-onedark-surface/60 hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg border border-onedark-borderSubtle transition-colors cursor-pointer"
            title="Refresh archive contents"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>

          <a
            href={`${rawUrl}&download=true`}
            download={data.name}
            className="flex items-center space-x-1.5 px-3 py-1 rounded-md bg-onedark-surface hover:bg-onedark-border text-onedark-fg text-xs font-semibold transition-colors border border-onedark-borderSubtle shadow-xs cursor-pointer"
            title="Download full archive"
          >
            <Download className="w-3.5 h-3.5 text-onedark-accent" />
            <span>Download</span>
          </a>
        </div>
      </div>

      {/* Archive File Table */}
      <div className="flex-1 overflow-auto bg-onedark-bg relative [scrollbar-gutter:stable]">
        <table className="w-full text-left border-collapse font-mono text-[11.5px] select-text">
          <thead className="bg-onedark-surface/80 sticky top-0 z-10 border-b border-onedark-borderSubtle shadow-xs backdrop-blur-xs select-none">
            <tr>
              <th
                onClick={() => handleSort('name')}
                className="px-3.5 py-2 text-onedark-fgBright font-semibold hover:bg-onedark-darker/60 cursor-pointer border-r border-onedark-borderSubtle/40 transition-colors"
              >
                File Path / Name
              </th>
              <th
                onClick={() => handleSort('size')}
                className="w-28 px-3 py-2 text-onedark-fgBright font-semibold hover:bg-onedark-darker/60 cursor-pointer text-right border-r border-onedark-borderSubtle/40 transition-colors"
              >
                Size
              </th>
              <th
                onClick={() => handleSort('date')}
                className="w-44 px-3 py-2 text-onedark-fgBright font-semibold hover:bg-onedark-darker/60 cursor-pointer text-right transition-colors"
              >
                Modified Date
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-onedark-borderSubtle/30">
            {filteredEntries.length === 0 ? (
              <tr>
                <td colSpan={3} className="py-16 text-center text-onedark-muted">
                  {searchQuery ? 'No matching files in archive.' : 'Archive is empty.'}
                </td>
              </tr>
            ) : (
              filteredEntries.map((entry, idx) => (
                <tr
                  key={idx}
                  className="hover:bg-onedark-surface/40 transition-colors even:bg-onedark-surface/10"
                >
                  <td className="px-3.5 py-1.5 text-onedark-fg border-r border-onedark-borderSubtle/20">
                    <div className="flex items-center space-x-2 truncate">
                      {getFileIcon(entry)}
                      <span className={entry.is_dir ? 'font-semibold text-onedark-yellow' : 'text-onedark-fg'}>
                        {entry.path}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-1.5 text-onedark-muted text-right border-r border-onedark-borderSubtle/20 font-mono">
                    {entry.is_dir ? '-' : formatBytes(entry.size)}
                  </td>
                  <td className="px-3 py-1.5 text-onedark-muted text-right font-mono text-[10.5px]">
                    {entry.date || '-'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
