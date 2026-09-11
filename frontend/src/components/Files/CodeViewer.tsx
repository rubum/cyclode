import React, { useState, useEffect } from 'react';
import { FileCode, Copy, Check, RefreshCw, AlertCircle, FileText, Code2 } from 'lucide-react';

interface CodeViewerProps {
  taskId: string;
  filePath: string | null;
  onClose?: () => void;
}

interface FileContentResponse {
  path: string;
  name: string;
  content: string;
  size: number;
  lines: number;
  language: string;
}

const API_BASE = import.meta.env.VITE_API_URL || '';

export const CodeViewer: React.FC<CodeViewerProps> = ({ taskId, filePath, onClose }) => {
  const [data, setData] = useState<FileContentResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

  if (!filePath) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center text-onedark-muted font-mono select-none">
        <Code2 className="w-10 h-10 text-onedark-border mb-3 stroke-[1.2]" />
        <div className="text-xs font-semibold text-onedark-fg">No file selected</div>
        <div className="text-[11px] text-onedark-muted mt-1 max-w-xs">
          Select a file from the explorer tree on the left to inspect its contents.
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
        <div>
          <div className="font-semibold">Unable to Read File</div>
          <div className="text-[11px] opacity-90 mt-0.5">{error}</div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const lines = data.content.split('\n');

  return (
    <div className="h-full flex flex-col bg-onedark-bg font-mono text-xs overflow-hidden">
      {/* File Header Bar */}
      <div className="px-3.5 py-2 bg-onedark-darker border-b border-onedark-borderSubtle flex items-center justify-between flex-shrink-0 select-none">
        <div className="flex items-center space-x-2 truncate">
          <FileCode className="w-3.5 h-3.5 text-onedark-accent flex-shrink-0" />
          <span className="font-semibold text-onedark-fgBright truncate text-[11.5px]">
            {data.name}
          </span>
          <span className="text-[10px] text-onedark-muted truncate hidden sm:inline">
            ({data.path})
          </span>
        </div>

        <div className="flex items-center space-x-2 flex-shrink-0">
          <span className="px-1.5 py-0.5 rounded bg-onedark-surface border border-onedark-borderSubtle text-[10px] text-onedark-muted uppercase">
            {data.language}
          </span>
          <span className="text-[10.5px] text-onedark-muted">
            {data.lines} lines · {formatBytes(data.size)}
          </span>
          <button
            onClick={handleCopy}
            className="p-1 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fgBright transition-colors"
            title="Copy file content"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-onedark-green" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Code Content with Line Numbers */}
      <div className="flex-1 overflow-auto p-2 font-mono text-[11.5px] leading-relaxed select-text">
        <table className="w-full border-collapse">
          <tbody>
            {lines.map((line, idx) => (
              <tr key={idx} className="hover:bg-onedark-surface/30 group">
                <td className="w-10 pr-3 text-right text-[10.5px] text-onedark-muted/60 select-none align-top py-0.5 group-hover:text-onedark-muted">
                  {idx + 1}
                </td>
                <td className="text-onedark-fg whitespace-pre font-mono align-top py-0.5 break-all">
                  {line || ' '}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
