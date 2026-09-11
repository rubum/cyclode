import React, { useState, useEffect } from 'react';
import { 
  Box, 
  X, 
  RefreshCw, 
  GitBranch, 
  ShieldCheck, 
  AlertCircle
} from 'lucide-react';
import { Task } from '../../types';
import { FileTreeExplorer, FileNode } from '../Files/FileTreeExplorer';
import { CodeViewer } from '../Files/CodeViewer';

interface SandboxInfo {
  task_id: string;
  sandbox_status: string;
  workspace_path: string;
  exists_on_disk: boolean;
  git_branch?: string;
  repo_url?: string;
  target_branch?: string;
  commit_sha?: string;
  file_tree: FileNode[];
  file_count: number;
  total_size_bytes: number;
  runtime: {
    mode: string;
    isolation: string;
    lifecycle: string;
    timeout_seconds: number;
  };
}

interface SandboxInspectorModalProps {
  task: Task;
  onClose: () => void;
}

const API_BASE = import.meta.env.VITE_API_URL || '';

export const SandboxInspectorModal: React.FC<SandboxInspectorModalProps> = ({ task, onClose }) => {
  const [data, setData] = useState<SandboxInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const pollTimerRef = React.useRef<any>(null);

  const fetchSandboxData = async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/tasks/${task.id}/sandbox`);
      if (!res.ok) {
        if (res.status === 404 && (task.status === 'INITIALIZING' || task.sandbox_status === 'PROVISIONING')) {
          setData((prev) => prev || {
            task_id: task.id,
            sandbox_status: 'PROVISIONING',
            workspace_path: task.workspace_path || '',
            exists_on_disk: false,
            file_tree: [],
            file_count: 0,
            total_size_bytes: 0,
            runtime: {
              mode: 'ephemeral_sandbox',
              isolation: 'filesystem_confinement',
              lifecycle: 'active_execution',
              timeout_seconds: 60
            }
          });
          return;
        }
        throw new Error(`Failed to fetch sandbox details (${res.status})`);
      }
      const json: SandboxInfo = await res.json();
      setData(json);

      if (!selectedFile && json.file_tree && json.file_tree.length > 0) {
        const findFirstFile = (nodes: FileNode[]): string | null => {
          for (const n of nodes) {
            if (!n.is_dir) return n.path;
            if (n.children) {
              const f = findFirstFile(n.children);
              if (f) return f;
            }
          }
          return null;
        };
        const first = findFirstFile(json.file_tree);
        if (first) setSelectedFile(first);
      }
    } catch (err: any) {
      if (task.status !== 'INITIALIZING' && task.sandbox_status !== 'PROVISIONING') {
        setError(err.message || 'Error loading sandbox inspector');
      }
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchSandboxData();

    const isProvisioning = task.status === 'INITIALIZING' || task.sandbox_status === 'PROVISIONING' || (data && data.sandbox_status === 'PROVISIONING');
    if (isProvisioning) {
      pollTimerRef.current = setInterval(() => {
        fetchSandboxData(true);
      }, 1800);
    }

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
    };
  }, [task.id, task.status, task.sandbox_status]);

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-fadeIn">
      <div className="w-full max-w-5xl bg-onedark-bg border border-onedark-border rounded-2xl shadow-2xl overflow-hidden flex flex-col h-[85vh] animate-scaleIn">
        
        {/* Header */}
        <div className="p-4 bg-onedark-darker border-b border-onedark-border flex items-center justify-between flex-shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-xl bg-onedark-accent/15 border border-onedark-accent/30 text-onedark-accent flex items-center justify-center">
              <Box className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-sm font-semibold text-onedark-fgBright font-sans">
                  Sandbox & Runtime Inspector
                </h2>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono uppercase font-bold border ${
                  task.sandbox_status === 'ACTIVE'
                    ? 'bg-onedark-green/15 text-onedark-green border-onedark-green/30'
                    : task.sandbox_status === 'PROVISIONING'
                    ? 'bg-onedark-yellow/15 text-onedark-yellow border-onedark-yellow/30'
                    : 'bg-onedark-surface text-onedark-muted border-onedark-border'
                }`}>
                  {task.sandbox_status}
                </span>
              </div>
              <p className="text-[11px] text-onedark-muted font-mono">
                Task ID: {task.id}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => fetchSandboxData(false)}
              disabled={loading}
              className="p-1.5 rounded-lg border border-onedark-border bg-onedark-surface hover:bg-onedark-darker text-onedark-muted hover:text-onedark-fgBright transition-colors disabled:opacity-40 cursor-pointer"
              title="Refresh Filesystem"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg border border-transparent hover:border-onedark-border hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fgBright transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
          
          {/* Left Metadata & Metrics Panel */}
          <div className="w-full md:w-64 lg:w-72 border-b md:border-b-0 md:border-r border-onedark-borderSubtle bg-onedark-darker/70 p-3.5 space-y-3.5 overflow-y-auto flex-shrink-0">
            <div className="space-y-1.5">
              <div className="text-[10px] uppercase font-bold tracking-wider text-onedark-muted font-mono">
                Sandbox Environment
              </div>
              
              <div className="p-2.5 rounded-xl bg-onedark-surface/60 border border-onedark-borderSubtle space-y-2 text-xs font-mono">
                <div>
                  <div className="text-[10px] text-onedark-muted">Workspace Mount</div>
                  <div className="text-onedark-fg truncate text-[11px]" title={data?.workspace_path || task.workspace_path}>
                    {data?.workspace_path || task.workspace_path}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] text-onedark-muted">Git Branch</div>
                  <div className="text-onedark-accent flex items-center space-x-1 text-[11px]">
                    <GitBranch className="w-3 h-3" />
                    <span>{data?.git_branch || task.git_branch || 'main'}</span>
                  </div>
                </div>

                {data?.repo_url && (
                  <div>
                    <div className="text-[10px] text-onedark-muted">Repository</div>
                    <div className="text-onedark-fg truncate text-[11px]">{data.repo_url}</div>
                  </div>
                )}
              </div>
            </div>

            {/* Storage & Boundary Stats */}
            <div className="space-y-1.5">
              <div className="text-[10px] uppercase font-bold tracking-wider text-onedark-muted font-mono">
                Metrics & Isolation
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <div className="p-2 rounded-xl bg-onedark-surface/40 border border-onedark-borderSubtle">
                  <div className="text-[10px] text-onedark-muted">Files</div>
                  <div className="text-sm font-bold text-onedark-fgBright mt-0.5">
                    {data ? data.file_count : 0}
                  </div>
                </div>

                <div className="p-2 rounded-xl bg-onedark-surface/40 border border-onedark-borderSubtle">
                  <div className="text-[10px] text-onedark-muted">Disk Size</div>
                  <div className="text-sm font-bold text-onedark-fgBright mt-0.5">
                    {data ? formatBytes(data.total_size_bytes) : '0 B'}
                  </div>
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-onedark-surface/40 border border-onedark-borderSubtle space-y-1 text-xs text-onedark-muted font-mono">
                <div className="flex items-center space-x-1.5 text-onedark-green">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span className="font-semibold text-[11px]">Filesystem Confinement</span>
                </div>
                <p className="text-[10px] leading-relaxed text-onedark-fgSubtle">
                  Commands and file reads are strictly bound to this ephemeral directory.
                </p>
              </div>
            </div>
          </div>

          {/* Middle File Tree Panel */}
          <div className="w-full md:w-72 lg:w-80 border-b md:border-b-0 md:border-r border-onedark-borderSubtle flex-shrink-0 overflow-hidden">
            {loading && !data ? (
              <div className="h-full flex flex-col items-center justify-center p-6 text-onedark-muted font-mono space-y-2">
                <RefreshCw className="w-5 h-5 animate-spin text-onedark-accent" />
                <span className="text-xs">Reading sandbox directory...</span>
              </div>
            ) : error ? (
              <div className="p-4 rounded-xl bg-onedark-red/10 border border-onedark-red/30 text-onedark-red text-xs font-mono m-4 flex items-start space-x-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold">Sandbox Unavailable</div>
                  <div className="text-[11px] opacity-90 mt-0.5">{error}</div>
                </div>
              </div>
            ) : data ? (
              <FileTreeExplorer
                tree={data.file_tree}
                selectedFile={selectedFile}
                onSelectFile={(path) => setSelectedFile(path)}
                title="Filesystem Tree"
              />
            ) : null}
          </div>

          {/* Right Code Viewer Panel */}
          <div className="flex-1 overflow-hidden bg-onedark-bg">
            <CodeViewer
              taskId={task.id}
              filePath={selectedFile}
            />
          </div>

        </div>

        {/* Footer */}
        <div className="p-3 bg-onedark-darker border-t border-onedark-border flex items-center justify-between text-[11px] font-mono text-onedark-muted flex-shrink-0">
          <span>Lifecycle: Disposable Ephemeral Sandbox</span>
          <button
            onClick={onClose}
            className="px-3 py-1 rounded-lg bg-onedark-surface hover:bg-onedark-border text-onedark-fg text-xs transition-colors cursor-pointer"
          >
            Close Inspector
          </button>
        </div>

      </div>
    </div>
  );
};
