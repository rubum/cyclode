import React, { useState, useEffect, useRef } from 'react';
import { 
  RefreshCw, 
  AlertCircle, 
  Box, 
  Layers,
  FolderLock,
  Sparkles
} from 'lucide-react';
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
  git_branch?: string;
  repo_url?: string;
  target_branch?: string;
  commit_sha?: string;
  file_tree?: FileNode[];
  file_count: number;
  total_size_bytes: number;
}

const API_BASE = import.meta.env.VITE_API_URL || '';

export const FilesExplorerTab: React.FC<FilesExplorerTabProps> = ({ task }) => {
  const [data, setData] = useState<SandboxInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const pollTimerRef = useRef<any>(null);
  const prevTaskIdRef = useRef<string | null>(null);

  const fileExistsInTree = (nodes: FileNode[], targetPath: string): boolean => {
    for (const n of nodes) {
      if (!n.is_dir && (n.path === targetPath || n.name === targetPath)) return true;
      if (n.children && fileExistsInTree(n.children, targetPath)) return true;
    }
    return false;
  };

  const findPreferredOrFirstFile = (nodes: FileNode[]): string | null => {
    const findByName = (items: FileNode[], names: string[]): string | null => {
      for (const item of items) {
        if (!item.is_dir && names.includes(item.name.toLowerCase())) return item.path;
        if (item.children) {
          const found = findByName(item.children, names);
          if (found) return found;
        }
      }
      return null;
    };

    const readme = findByName(nodes, ['readme.md', 'readme', 'pyproject.toml', 'package.json', 'mix.exs', 'cargo.toml', 'go.mod']);
    if (readme) return readme;

    const findFirst = (items: FileNode[]): string | null => {
      for (const item of items) {
        if (!item.is_dir) return item.path;
        if (item.children) {
          const found = findFirst(item.children);
          if (found) return found;
        }
      }
      return null;
    };
    return findFirst(nodes);
  };

  const fetchFilesystem = async (silent = false) => {
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
            total_size_bytes: 0
          });
          return;
        }
        throw new Error(`Failed to load sandbox filesystem (${res.status})`);
      }
      const json: SandboxInfo = await res.json();
      setData(json);

      if (json.file_tree && Array.isArray(json.file_tree) && json.file_tree.length > 0) {
        setSelectedFile((prev) => {
          if (prev && fileExistsInTree(json.file_tree!, prev)) {
            return prev;
          }
          return findPreferredOrFirstFile(json.file_tree!);
        });
      }
    } catch (err: any) {
      if (task.status !== 'INITIALIZING' && task.sandbox_status !== 'PROVISIONING') {
        setError(err.message || 'Error fetching sandbox explorer');
      }
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    const isNewTask = prevTaskIdRef.current !== task.id;
    prevTaskIdRef.current = task.id;

    if (isNewTask) {
      setSelectedFile(null);
      setData(null);
      fetchFilesystem(false);
    } else {
      // Same task: refresh tree silently in the background without resetting selectedFile or unmounting
      fetchFilesystem(true);
    }

    const isProvisioning = task.status === 'INITIALIZING' || task.sandbox_status === 'PROVISIONING';
    if (isProvisioning) {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      pollTimerRef.current = setInterval(() => {
        fetchFilesystem(true);
      }, 1800);
    }

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
    };
  }, [task.id, task.sandbox_status, task.status, task.workspace_path, task.updated_at]);

  if (loading && !data && task.status !== 'INITIALIZING' && task.sandbox_status !== 'PROVISIONING') {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-onedark-muted font-mono space-y-2">
        <RefreshCw className="w-5 h-5 animate-spin text-onedark-accent" />
        <span className="text-xs">Reading sandbox workspace...</span>
      </div>
    );
  }

  const isCurrentlyProvisioning = 
    task.sandbox_status === 'PROVISIONING' || 
    task.status === 'INITIALIZING' || 
    (data && data.sandbox_status === 'PROVISIONING' && (!data.file_tree || !Array.isArray(data.file_tree) || data.file_tree.length === 0));

  if (isCurrentlyProvisioning) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center text-onedark-muted font-mono select-none space-y-3">
        <div className="relative">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 animate-pulse">
            <Layers className="w-6 h-6 animate-bounce" />
          </div>
          <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-onedark-bg border-2 border-onedark-bg flex items-center justify-center">
            <RefreshCw className="w-3 h-3 text-amber-400 animate-spin" />
          </div>
        </div>
        <div>
          <div className="text-xs font-semibold text-onedark-fg">Provisioning Sandbox Workspace</div>
          <div className="text-[11px] text-onedark-muted mt-1 max-w-xs leading-relaxed">
            Allocating isolated filesystem, preparing repository worktree, and synchronizing workspace structure...
          </div>
        </div>
        <div className="flex items-center space-x-1.5 text-[10px] text-amber-400/80 bg-amber-500/10 px-2.5 py-1 rounded-full border border-amber-500/20">
          <Sparkles className="w-3 h-3" />
          <span>Files will appear automatically once ready</span>
        </div>
      </div>
    );
  }

  if (task.sandbox_status === 'AUTH_REQUIRED' || data?.sandbox_status === 'AUTH_REQUIRED') {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center text-onedark-muted font-mono select-none space-y-3">
        <div className="w-12 h-12 rounded-2xl bg-onedark-yellow/10 border border-onedark-yellow/30 flex items-center justify-center text-onedark-yellow">
          <FolderLock className="w-6 h-6" />
        </div>
        <div>
          <div className="text-xs font-semibold text-onedark-fg">Authentication Required</div>
          <div className="text-[11px] text-onedark-muted mt-1 max-w-xs leading-relaxed">
            This repository requires authentication. Please configure a Personal Access Token in the Repositories Vault to access files.
          </div>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="p-4 rounded-xl bg-onedark-red/10 border border-onedark-red/30 text-onedark-red text-xs font-mono m-4 flex items-start space-x-2">
        <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <div>
          <div className="font-semibold">Filesystem Unavailable</div>
          <div className="text-[11px] opacity-90 mt-0.5">{error}</div>
          <button
            onClick={() => fetchFilesystem(false)}
            className="mt-2 px-2.5 py-1 rounded bg-onedark-surface hover:bg-onedark-border text-onedark-fg text-[11px] transition-colors cursor-pointer"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const fileTree = Array.isArray(data?.file_tree) ? data.file_tree : [];

  if (!data || fileTree.length === 0) {
    const isDestroyed = task.sandbox_status === 'DESTROYED' || data?.sandbox_status === 'DESTROYED';
    const isNoRepo = !task.repo_name && !task.repo_url;
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center text-onedark-muted font-mono select-none space-y-2">
        <Box className="w-8 h-8 text-onedark-border mb-1 stroke-[1.2]" />
        <div className="text-xs font-semibold text-onedark-fg">
          {isNoRepo ? 'No Files in Session' : isDestroyed ? 'Sandbox Cleaned Up' : 'Workspace Empty'}
        </div>
        <div className="text-[11px] text-onedark-muted max-w-xs leading-relaxed">
          {isNoRepo
            ? 'This is a conversational session without a connected repository.'
            : isDestroyed
            ? 'The ephemeral sandbox workspace was safely cleaned up upon task completion.'
            : data?.exists_on_disk
            ? 'The sandbox workspace directory is currently empty.'
            : 'Sandbox workspace has not been initialized or is no longer present on disk.'}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col md:flex-row overflow-hidden font-sans">
      {/* Left Tree Explorer */}
      <div className="w-full md:w-72 lg:w-80 h-1/2 md:h-full border-b md:border-b-0 md:border-r border-onedark-borderSubtle flex-shrink-0">
        <FileTreeExplorer
          tree={fileTree}
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
          onFileNotFound={() => {
            const fallback = findPreferredOrFirstFile(fileTree);
            if (fallback) setSelectedFile(fallback);
          }}
        />
      </div>
    </div>
  );
};
