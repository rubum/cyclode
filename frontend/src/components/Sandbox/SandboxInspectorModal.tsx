import React, { useState, useEffect } from 'react';
import { 
  Box, 
  X, 
  Folder, 
  FolderOpen, 
  FileText, 
  RefreshCw, 
  GitBranch, 
  ShieldCheck, 
  Terminal, 
  HardDrive,
  FileCode,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { Task } from '../../types';

interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  type: string;
  size?: number;
  children?: FileNode[];
}

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
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({ '': true });
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const fetchSandboxData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/tasks/${task.id}/sandbox`);
      if (!res.ok) {
        throw new Error(`Failed to fetch sandbox details (${res.status})`);
      }
      const json: SandboxInfo = await res.json();
      setData(json);
      // Auto expand first-level folders
      const initialExpanded: Record<string, boolean> = { '': true };
      json.file_tree.forEach((node) => {
        if (node.is_dir) {
          initialExpanded[node.path] = true;
        }
      });
      setExpandedFolders(initialExpanded);
    } catch (err: any) {
      setError(err.message || 'Error loading sandbox inspector');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSandboxData();
  }, [task.id]);

  const toggleFolder = (path: string) => {
    setExpandedFolders((prev) => ({ ...prev, [path]: !prev[path] }));
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const renderTree = (nodes: FileNode[], depth = 0) => {
    return (
      <div className="space-y-0.5">
        {nodes.map((node) => {
          const isExpanded = !!expandedFolders[node.path];
          const isSelected = selectedFile === node.path;
          return (
            <div key={node.path} style={{ paddingLeft: `${depth * 14}px` }}>
              {node.is_dir ? (
                <div>
                  <button
                    onClick={() => toggleFolder(node.path)}
                    className="w-full flex items-center space-x-1.5 py-1 px-2 rounded-md hover:bg-onedark-surface text-xs font-mono text-onedark-fg hover:text-onedark-fgBright transition-colors text-left"
                  >
                    {isExpanded ? (
                      <FolderOpen className="w-3.5 h-3.5 text-onedark-yellow flex-shrink-0" />
                    ) : (
                      <Folder className="w-3.5 h-3.5 text-onedark-yellow flex-shrink-0" />
                    )}
                    <span className="font-semibold truncate">{node.name}</span>
                    <span className="text-[10px] text-onedark-muted font-normal ml-auto">
                      ({node.children ? node.children.length : 0})
                    </span>
                  </button>
                  {isExpanded && node.children && node.children.length > 0 && (
                    <div className="mt-0.5">{renderTree(node.children, depth + 1)}</div>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => setSelectedFile(node.path)}
                  className={`w-full flex items-center space-x-1.5 py-1 px-2 rounded-md text-xs font-mono transition-colors text-left ${
                    isSelected
                      ? 'bg-onedark-accent/20 text-onedark-accent font-semibold border border-onedark-accent/30'
                      : 'hover:bg-onedark-surface text-onedark-fg hover:text-onedark-fgBright'
                  }`}
                >
                  <FileCode className="w-3.5 h-3.5 text-onedark-blue flex-shrink-0" />
                  <span className="truncate flex-1">{node.name}</span>
                  {node.size !== undefined && (
                    <span className="text-[10px] text-onedark-muted font-mono flex-shrink-0">
                      {formatBytes(node.size)}
                    </span>
                  )}
                </button>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-fadeIn">
      <div className="w-full max-w-4xl bg-onedark-bg border border-onedark-border rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-scaleIn">
        
        {/* Header */}
        <div className="p-4 bg-onedark-darker border-b border-onedark-border flex items-center justify-between">
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
              onClick={fetchSandboxData}
              disabled={loading}
              className="p-1.5 rounded-lg border border-onedark-border bg-onedark-surface hover:bg-onedark-darker text-onedark-muted hover:text-onedark-fgBright transition-colors disabled:opacity-40"
              title="Refresh Filesystem"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg border border-transparent hover:border-onedark-border hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fgBright transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
          
          {/* Left Metadata & Metrics Panel */}
          <div className="w-full md:w-80 border-r border-onedark-borderSubtle bg-onedark-darker/60 p-4 space-y-4 overflow-y-auto">
            <div className="space-y-2">
              <div className="text-[10px] uppercase font-bold tracking-wider text-onedark-muted font-mono">
                Sandbox Environment
              </div>
              
              <div className="p-3 rounded-xl bg-onedark-surface/60 border border-onedark-borderSubtle space-y-2 text-xs font-mono">
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
            <div className="space-y-2">
              <div className="text-[10px] uppercase font-bold tracking-wider text-onedark-muted font-mono">
                Metrics & Isolation
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <div className="p-2.5 rounded-xl bg-onedark-surface/40 border border-onedark-borderSubtle">
                  <div className="text-[10px] text-onedark-muted">Files</div>
                  <div className="text-base font-bold text-onedark-fgBright mt-0.5">
                    {data ? data.file_count : 0}
                  </div>
                </div>

                <div className="p-2.5 rounded-xl bg-onedark-surface/40 border border-onedark-borderSubtle">
                  <div className="text-[10px] text-onedark-muted">Disk Size</div>
                  <div className="text-base font-bold text-onedark-fgBright mt-0.5">
                    {data ? formatBytes(data.total_size_bytes) : '0 B'}
                  </div>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-onedark-surface/40 border border-onedark-borderSubtle space-y-1.5 text-xs text-onedark-muted font-mono">
                <div className="flex items-center space-x-1.5 text-onedark-green">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span className="font-semibold text-[11px]">Filesystem Confinement</span>
                </div>
                <p className="text-[10px] leading-relaxed text-onedark-fgSubtle">
                  Commands and file operations are strictly bound to this ephemeral directory.
                </p>
              </div>
            </div>
          </div>

          {/* Right File Tree & Content Panel */}
          <div className="flex-1 p-4 overflow-y-auto bg-onedark-bg">
            <div className="flex items-center justify-between pb-3 mb-2 border-b border-onedark-borderSubtle">
              <div className="text-xs font-semibold text-onedark-fgBright flex items-center space-x-2 font-mono">
                <HardDrive className="w-4 h-4 text-onedark-accent" />
                <span>Sandbox Filesystem Explorer</span>
              </div>
              {selectedFile && (
                <span className="text-[11px] font-mono text-onedark-muted truncate max-w-xs">
                  {selectedFile}
                </span>
              )}
            </div>

            {loading && !data ? (
              <div className="py-12 flex flex-col items-center justify-center space-y-2 text-onedark-muted text-xs font-mono">
                <RefreshCw className="w-5 h-5 animate-spin text-onedark-accent" />
                <span>Reading sandbox directory...</span>
              </div>
            ) : error ? (
              <div className="p-4 rounded-xl bg-onedark-red/10 border border-onedark-red/30 text-onedark-red text-xs font-mono flex items-start space-x-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold">Sandbox Unavailable</div>
                  <div className="text-[11px] opacity-90 mt-0.5">{error}</div>
                </div>
              </div>
            ) : data && data.file_tree.length === 0 ? (
              <div className="py-12 flex flex-col items-center justify-center space-y-2 text-onedark-muted text-xs font-mono text-center">
                <Box className="w-6 h-6 text-onedark-border" />
                <div>
                  {data.exists_on_disk 
                    ? "Sandbox workspace directory is empty."
                    : "Ephemeral sandbox directory was purged upon task completion."}
                </div>
              </div>
            ) : data ? (
              <div className="p-2 rounded-xl bg-onedark-darker/60 border border-onedark-borderSubtle">
                {renderTree(data.file_tree)}
              </div>
            ) : null}
          </div>

        </div>

        {/* Footer */}
        <div className="p-3 bg-onedark-darker border-t border-onedark-border flex items-center justify-between text-[11px] font-mono text-onedark-muted">
          <span>Lifecycle: Disposable Ephemeral Sandbox</span>
          <button
            onClick={onClose}
            className="px-3 py-1 rounded-lg bg-onedark-surface hover:bg-onedark-border text-onedark-fg text-xs transition-colors"
          >
            Close Inspector
          </button>
        </div>

      </div>
    </div>
  );
};
