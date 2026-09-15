import React, { useState, useEffect, useMemo } from 'react';
import { FileCode, Copy, Check, RefreshCw, AlertCircle, Code2, WrapText, Play, ExternalLink } from 'lucide-react';
import { highlightCode, resolveLanguage } from '../../utils/syntaxHighlighter';

interface CodeViewerProps {
  taskId: string;
  filePath: string | null;
  onFileNotFound?: () => void;
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

export const CodeViewer: React.FC<CodeViewerProps> = ({ taskId, filePath, onFileNotFound }) => {
  const [data, setData] = useState<FileContentResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [wrapLines, setWrapLines] = useState(false);
  const [viewMode, setViewMode] = useState<'code' | 'preview'>('code');
  const [previewReloadKey, setPreviewReloadKey] = useState<number>(0);

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

  const resolvedLang = useMemo(() => {
    if (!data) return 'text';
    return resolveLanguage(data.language, data.name);
  }, [data]);

  const highlightedLines = useMemo(() => {
    if (!data?.content) return [];
    const html = highlightCode(data.content, data.language, data.name);
    return html.split('\n');
  }, [data]);

  const lineCount = useMemo(() => {
    return highlightedLines.length;
  }, [highlightedLines]);

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
    <div className="h-full flex flex-col bg-onedark-bg font-mono text-[12.5px] overflow-hidden">
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
          <span className="px-1.5 py-0.5 rounded bg-onedark-surface border border-onedark-borderSubtle text-[10.5px] text-onedark-muted uppercase font-semibold">
            {resolvedLang}
          </span>
          <span className="text-[11px] text-onedark-muted hidden md:inline">
            {lineCount} lines · {formatBytes(data.size)}
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

      {/* Main Body: Code or Live Preview */}
      {viewMode === 'preview' && isHtml ? (
        <div className="flex-1 overflow-hidden bg-white relative">
          <iframe
            key={previewReloadKey}
            src={previewUrl}
            title={data.name}
            sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-modals allow-downloads"
            className="w-full h-full border-none"
          />
        </div>
      ) : (
        /* Syntax Highlighted Code Table (Line-synchronized, GitHub style) */
        <div className="flex-1 overflow-auto font-mono text-[12.5px] select-text">
          <table className={`border-collapse font-mono text-[12.5px] ${wrapLines ? 'min-w-full w-full table-fixed' : 'min-w-full w-max'}`}>
            <tbody>
              {highlightedLines.map((lineHtml, i) => (
                <tr key={i} className="hover:bg-onedark-surface/40 group/line transition-colors">
                  <td className="select-none pr-3 pl-3 text-right text-onedark-muted/40 group-hover/line:text-onedark-muted border-r border-onedark-borderSubtle/60 font-mono text-[11px] leading-[20px] align-top w-12 min-w-[3rem] sticky left-0 bg-onedark-bg group-hover/line:bg-onedark-surface/40 z-10">
                    {i + 1}
                  </td>
                  <td
                    className={`pl-3.5 pr-4 font-mono text-[12.5px] leading-[20px] align-top text-onedark-fg ${
                      wrapLines ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'
                    }`}
                    dangerouslySetInnerHTML={{ __html: lineHtml || ' ' }}
                  />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
