import React from 'react';
import { 
  FileText, 
  ExternalLink, 
  Download, 
  Layers 
} from 'lucide-react';

interface DocumentViewerProps {
  filePath: string;
  fileSize?: number;
  rawUrl: string;
}

export const DocumentViewer: React.FC<DocumentViewerProps> = ({
  filePath,
  fileSize,
  rawUrl,
}) => {
  const formatBytes = (bytes?: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <div className="h-full flex flex-col bg-onedark-bg font-sans overflow-hidden select-none">
      {/* Top Document Bar */}
      <div className="px-3 py-1.5 bg-onedark-darker/80 border-b border-onedark-borderSubtle flex items-center justify-between flex-shrink-0 text-xs">
        <div className="flex items-center space-x-2 font-mono text-[11px] text-onedark-muted">
          <FileText className="w-4 h-4 text-onedark-red flex-shrink-0" />
          <span className="font-semibold text-onedark-fg">{filePath.split('/').pop()}</span>
          {fileSize !== undefined && (
            <>
              <span className="text-onedark-border">·</span>
              <span>{formatBytes(fileSize)}</span>
            </>
          )}
          <span className="text-onedark-border">·</span>
          <span className="uppercase text-[10px] px-1.5 py-0.2 rounded bg-onedark-surface border border-onedark-borderSubtle">
            PDF Document
          </span>
        </div>

        {/* Right Controls */}
        <div className="flex items-center space-x-1.5">
          <a
            href={rawUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 rounded-md bg-onedark-surface/60 hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg border border-onedark-borderSubtle transition-colors cursor-pointer flex items-center space-x-1 text-[11px]"
            title="Open in new window"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>Open in Tab</span>
          </a>

          <a
            href={`${rawUrl}&download=true`}
            download={filePath.split('/').pop()}
            className="p-1.5 rounded-md bg-onedark-surface/60 hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg border border-onedark-borderSubtle transition-colors cursor-pointer"
            title="Download PDF"
          >
            <Download className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* Main Iframe Viewer */}
      <div className="flex-1 overflow-hidden p-2 bg-onedark-darker/50">
        <iframe
          src={rawUrl}
          title={filePath}
          className="w-full h-full rounded-lg border border-onedark-borderSubtle bg-white"
        />
      </div>
    </div>
  );
};
