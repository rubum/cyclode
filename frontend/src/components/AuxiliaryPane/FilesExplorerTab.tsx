import React, { useState, useEffect } from 'react';
import { RefreshCw, AlertCircle, Box, HardDrive } from 'lucide-react';
import { Task } from '../../types';
import { FileTreeExplorer, FileNode } from '../Files/FileTreeExplorer';
import { CodeViewer } from '../Files/CodeViewer';

interface FilesExplorerTabProps {
  task: Task;
}

interface SandboxInfo {
  task_id: string;
  sandbox_status: string;
  workspace_path: string;
  exists_on_disk: boolean;
  file_tree: FileNode[];
  file_count: number;
  total_size_bytes: number;
}

const API_BASE = import.meta.env.VITE_API_URL || '';

export const FilesExplorerTab: React.FC<FilesExplorerTabProps> = ({ task }) => {
  const [data, setData] = useState<SandboxInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const fetchFilesystem = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/tasks/${task.id}/sandbox`);
      if (!res.ok) {
        throw new Error(`Failed to load sandbox filesystem (${res.status})`);
      }
      const json: SandboxInfo = await res.json();
      setData(json);

      // If no file selected yet, auto-select first file in tree if exists
      if (!selectedFile && json.file_tree.length > 0) {
        const findFirstFile = (nodes: FileNode[]): string | null => {
          for (const n of nodes) {
            if (!n.is_dir) return n.path;
            if (n.children) {
              const childFile = findFirstFile(n.children);
              if (childFile) return childFile;
            }
          }
          return null;
        };
        const first = findFirstFile(json.file_tree);
        if (first) setSelectedFile(first);
      }
    } catch (err: any) {
      setError(err.message || 'Error fetching sandbox explorer');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFilesystem();
  }, [task.id, task.status]);

  if (loading && !data) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-onedark-muted font-mono space-y-2">
        <RefreshCw className="w-5 h-5 animate-spin text-onedark-accent" />
        <span className="text-xs">Reading sandbox workspace...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 rounded-xl bg-onedark-red/10 border border-onedark-red/30 text-onedark-red text-xs font-mono m-4 flex items-start space-x-2">
        <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <div>
          <div className="font-semibold">Filesystem Unavailable</div>
          <div className="text-[11px] opacity-90 mt-0.5">{error}</div>
          <button
            onClick={fetchFilesystem}
            className="mt-2 px-2.5 py-1 rounded bg-onedark-surface hover:bg-onedark-border text-onedark-fg text-[11px] transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data || data.file_tree.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center text-onedark-muted font-mono select-none">
        <Box className="w-8 h-8 text-onedark-border mb-2 stroke-[1.2]" />
        <div className="text-xs font-semibold text-onedark-fg">Workspace Empty</div>
        <div className="text-[11px] text-onedark-muted mt-1 max-w-xs">
          {data?.exists_on_disk
            ? 'The sandbox workspace directory is currently empty.'
            : 'Sandbox environment was cleaned up upon completion.'}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col md:flex-row overflow-hidden font-sans">
      {/* Left Tree Explorer */}
      <div className="w-full md:w-72 lg:w-80 h-1/2 md:h-full border-b md:border-b-0 md:border-r border-onedark-borderSubtle flex-shrink-0">
        <FileTreeExplorer
          tree={data.file_tree}
          selectedFile={selectedFile}
          onSelectFile={(path) => setSelectedFile(path)}
          title="Sandbox Files"
        />
      </div>

      {/* Right Code Viewer */}
      <div className="flex-1 h-1/2 md:h-full overflow-hidden bg-onedark-bg">
        <CodeViewer
          taskId={task.id}
          filePath={selectedFile}
        />
      </div>
    </div>
  );
};
