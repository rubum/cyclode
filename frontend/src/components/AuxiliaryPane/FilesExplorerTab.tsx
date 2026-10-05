import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  RefreshCw, 
  AlertCircle, 
  Box, 
  Layers,
  FolderLock,
  Sparkles,
  Bot,
  Folder,
  PanelLeftOpen,
  PanelLeftClose
} from 'lucide-react';
import { Task } from '../../types';
import { FileTreeExplorer, FileNode, ExternalSearchRequest } from '../Files/FileTreeExplorer';
import { CodeViewer, LineContext } from '../Files/CodeViewer';
import { FileAgentPopover } from '../Files/FileAgentPopover';
import { useNavigationHistory } from '../../hooks/useNavigationHistory';
import { useWebSocketContext } from '../../contexts/WebSocketContext';

interface FilesExplorerTabProps {
  task: Task;
  selectedFilePath?: string | null;
  selectedLineNumber?: number | null;
  onSelectFile?: (filePath: string, line?: number) => void;
  onClearSelectedFilePath?: () => void;
  onViewCommitDiff?: (commitSha: string) => void;
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

// Client-side cache for instant workspace file tree rendering across task switches
const sandboxCache = new Map<string, SandboxInfo>();
// Client-side cache for last viewed file and line per task
const taskActiveFileCache = new Map<string, { filePath: string; line: number | null }>();

const DEFAULT_TREE_WIDTH = 280;
const MIN_TREE_WIDTH = 180;
const MAX_TREE_WIDTH = 600;

export const FilesExplorerTab: React.FC<FilesExplorerTabProps> = ({ 
  task,
  selectedFilePath,
  selectedLineNumber,
  onSelectFile,
  onClearSelectedFilePath,
  onViewCommitDiff,
}) => {
  const [data, setData] = useState<SandboxInfo | null>(() => (task?.id ? sandboxCache.get(task.id) || null : null));
  const [loading, setLoading] = useState<boolean>(() => !(task?.id && sandboxCache.has(task.id)));
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(() => {
    if (selectedFilePath) return selectedFilePath;
    if (task?.id && taskActiveFileCache.has(task.id)) {
      return taskActiveFileCache.get(task.id)!.filePath;
    }
    return null;
  });
  const [targetLine, setTargetLine] = useState<number | null>(() => {
    if (selectedLineNumber !== undefined) return selectedLineNumber;
    if (task?.id && taskActiveFileCache.has(task.id)) {
      return taskActiveFileCache.get(task.id)!.line;
    }
    return null;
  });

  const handleSelectFile = useCallback((path: string, line?: number | null) => {
    setSelectedFile(path);
    const lineVal = line ?? null;
    setTargetLine(lineVal);
    if (task?.id) {
      taskActiveFileCache.set(task.id, { filePath: path, line: lineVal });
    }
    onSelectFile?.(path, line ?? undefined);
  }, [task?.id, onSelectFile]);

  useEffect(() => {
    if (selectedFilePath) {
      setSelectedFile(selectedFilePath);
      const lineVal = selectedLineNumber ?? null;
      setTargetLine(lineVal);
      if (task?.id) {
        taskActiveFileCache.set(task.id, { filePath: selectedFilePath, line: lineVal });
      }
    }
  }, [selectedFilePath, selectedLineNumber, task?.id]);
  const [activeSnippetContext, setActiveSnippetContext] = useState<LineContext | null>(null);
  const [initialAgentPrompt, setInitialAgentPrompt] = useState<string | undefined>(undefined);
  const [isAgentPopoverOpen, setIsAgentPopoverOpen] = useState(false);

  // External Search Trigger State for FileTreeExplorer
  const [externalSearch, setExternalSearch] = useState<ExternalSearchRequest | null>(null);

  // File tree explorer sidebar collapse state
  const [isTreeCollapsed, setIsTreeCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('cyclode_file_tree_collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const handleToggleTreeCollapsed = useCallback(() => {
    setIsTreeCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('cyclode_file_tree_collapsed', String(next));
      } catch {}
      return next;
    });
  }, []);

  // Keyboard shortcut: Option+1 or Alt+1 to toggle file tree sidebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === '1' || e.code === 'Digit1')) {
        e.preventDefault();
        handleToggleTreeCollapsed();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleToggleTreeCollapsed]);

  // File tree explorer sidebar resizer state
  const tabContainerRef = useRef<HTMLDivElement>(null);
  const [treeWidth, setTreeWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('cyclode_file_tree_width');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= MIN_TREE_WIDTH && parsed <= MAX_TREE_WIDTH) {
          return parsed;
        }
      }
    } catch {}
    return DEFAULT_TREE_WIDTH;
  });

  const isDraggingResizer = useRef(false);
  const [isResizingTree, setIsResizingTree] = useState(false);
  const treeWidthRef = useRef<number>(treeWidth);

  useEffect(() => {
    treeWidthRef.current = treeWidth;
  }, [treeWidth]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingResizer.current && tabContainerRef.current) {
        const containerRect = tabContainerRef.current.getBoundingClientRect();
        const maxWidth = Math.min(MAX_TREE_WIDTH, Math.max(MIN_TREE_WIDTH, containerRect.width - 200));
        const newWidth = Math.max(MIN_TREE_WIDTH, Math.min(maxWidth, e.clientX - containerRect.left));
        setTreeWidth(newWidth);
        treeWidthRef.current = newWidth;
      }
    };

    const handleMouseUp = () => {
      if (isDraggingResizer.current) {
        try {
          localStorage.setItem('cyclode_file_tree_width', String(treeWidthRef.current));
        } catch {}
        isDraggingResizer.current = false;
        setIsResizingTree(false);
        document.body.style.cursor = 'default';
        document.body.style.userSelect = 'auto';
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const handleResizerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingResizer.current = true;
    setIsResizingTree(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const handleResetTreeWidth = useCallback(() => {
    setTreeWidth(DEFAULT_TREE_WIDTH);
    treeWidthRef.current = DEFAULT_TREE_WIDTH;
    try {
      localStorage.setItem('cyclode_file_tree_width', String(DEFAULT_TREE_WIDTH));
    } catch {}
  }, []);

  // Navigation History Stack Hook
  const {
    history,
    currentIndex,
    pushPoint,
    goBack,
    goForward,
    canGoBack,
    canGoForward,
    previousPoint,
    nextPoint,
  } = useNavigationHistory((point) => {
    handleSelectFile(point.filePath, point.line);
  });

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
    if (!task?.id || task.id.startsWith('temp-')) {
      setLoading(false);
      return;
    }
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/tasks/${task.id}/sandbox`);
      if (!res.ok) {
        if (res.status === 404 && (task.status === 'INITIALIZING' || task.sandbox_status === 'PROVISIONING')) {
          const fallbackData: SandboxInfo = {
            task_id: task.id,
            sandbox_status: 'PROVISIONING',
            workspace_path: task.workspace_path || '',
            exists_on_disk: false,
            file_tree: [],
            file_count: 0,
            total_size_bytes: 0
          };
          setData((prev) => prev || fallbackData);
          return;
        }
        throw new Error(`Failed to load sandbox filesystem (${res.status})`);
      }
      const json: SandboxInfo = await res.json();
      sandboxCache.set(task.id, json);
      setData(json);

      if (json.file_tree && Array.isArray(json.file_tree) && json.file_tree.length > 0) {
        setSelectedFile((prev) => {
          if (prev && fileExistsInTree(json.file_tree!, prev)) {
            return prev;
          }
          const cachedActive = task?.id ? taskActiveFileCache.get(task.id) : null;
          if (cachedActive && fileExistsInTree(json.file_tree!, cachedActive.filePath)) {
            setTargetLine(cachedActive.line);
            return cachedActive.filePath;
          }
          const fallback = findPreferredOrFirstFile(json.file_tree!);
          if (fallback && task?.id) {
            taskActiveFileCache.set(task.id, { filePath: fallback, line: null });
            onSelectFile?.(fallback);
          }
          return fallback;
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

  const handleRenameFile = useCallback(async (oldPath: string, newPath: string): Promise<boolean> => {
    if (!task?.id || task.id.startsWith('temp-')) return false;
    try {
      const res = await fetch(`${API_BASE}/api/tasks/${task.id}/files/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old_path: oldPath, new_path: newPath }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || `Failed to rename file (${res.status})`);
      }
      const renameResult = await res.json();

      setSelectedFile((prev) => {
        if (!prev) return prev;
        if (prev === oldPath) {
          if (task?.id) {
            taskActiveFileCache.set(task.id, { filePath: renameResult.new_path, line: targetLine });
          }
          return renameResult.new_path;
        }
        if (prev.startsWith(oldPath + '/')) {
          const updated = renameResult.new_path + prev.slice(oldPath.length);
          if (task?.id) {
            taskActiveFileCache.set(task.id, { filePath: updated, line: targetLine });
          }
          return updated;
        }
        return prev;
      });

      await fetchFilesystem(true);
      return true;
    } catch (err: any) {
      console.error('Rename file error:', err);
      alert(err.message || 'Failed to rename file');
      return false;
    }
  }, [task?.id, targetLine]);

  const { subscribe } = useWebSocketContext();

  useEffect(() => {
    if (!subscribe) return;
    const unsubToolEnd = subscribe('TOOL_END', (event: any) => {
      if (event.task_id === task.id) {
        const mutatingTools = ['edit_file', 'replace_file_content', 'batch_replace_content', 'apply_unified_patch', 'run_command', 'git_clone'];
        if (mutatingTools.includes(event.tool_name)) {
          fetchFilesystem(true);
        }
      }
    });
    const unsubDiff = subscribe('DIFF_UPDATED', (event: any) => {
      if (event.task_id === task.id) {
        fetchFilesystem(true);
      }
    });
    return () => {
      unsubToolEnd();
      unsubDiff();
    };
  }, [subscribe, task.id]);

  useEffect(() => {
    const isNewTask = prevTaskIdRef.current !== task.id;
    prevTaskIdRef.current = task.id;

    if (isNewTask) {
      setIsAgentPopoverOpen(false);
      setActiveSnippetContext(null);

      const cachedActive = taskActiveFileCache.get(task.id);
      const cached = sandboxCache.get(task.id);
      if (cached) {
        setData(cached);
        setLoading(false);
        if (cachedActive && cached.file_tree && fileExistsInTree(cached.file_tree, cachedActive.filePath)) {
          setSelectedFile(cachedActive.filePath);
          setTargetLine(cachedActive.line);
        } else if (cached.file_tree && Array.isArray(cached.file_tree) && cached.file_tree.length > 0) {
          setSelectedFile((prev) => {
            if (prev && fileExistsInTree(cached.file_tree!, prev)) {
              return prev;
            }
            const fallback = findPreferredOrFirstFile(cached.file_tree!);
            if (fallback && task?.id) {
              taskActiveFileCache.set(task.id, { filePath: fallback, line: null });
              onSelectFile?.(fallback);
            }
            return fallback;
          });
        }
        // Fetch silently in background to refresh freshness
        fetchFilesystem(true);
      } else {
        if (cachedActive) {
          setSelectedFile(cachedActive.filePath);
          setTargetLine(cachedActive.line);
        } else {
          setSelectedFile(null);
          setTargetLine(null);
        }
        setData(null);
        fetchFilesystem(false);
      }
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
        <div className="flex items-center space-x-1.5 text-[10px] text-amber-900 bg-amber-100 border border-amber-300 dark:text-amber-400/90 dark:bg-amber-500/10 dark:border-amber-500/20 px-2.5 py-1 rounded-full font-medium">
          <Sparkles className="w-3 h-3 text-amber-600 dark:text-amber-400" />
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

  if ((!data || fileTree.length === 0) && !selectedFile) {
    const isDestroyed = task.sandbox_status === 'DESTROYED' || data?.sandbox_status === 'DESTROYED';
    const isNoRepo = !task.repo_name && !task.repo_url;
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center text-onedark-muted font-mono select-none space-y-2">
        <Box className="w-8 h-8 text-onedark-border mb-1 stroke-[1.2]" />
        <div className="text-xs font-semibold text-onedark-fg">
          {isDestroyed ? 'Sandbox Cleaned Up' : isNoRepo ? 'Live Sandbox Ready' : 'Workspace Empty'}
        </div>
        <div className="text-[11px] text-onedark-muted max-w-xs leading-relaxed">
          {isDestroyed
            ? 'The ephemeral sandbox workspace was safely cleaned up upon task completion.'
            : isNoRepo
            ? 'Ephemeral sandbox initialized. Workspace files will appear here as they are created by the agent.'
            : data?.exists_on_disk
            ? 'The sandbox workspace directory is currently empty.'
            : 'Sandbox workspace has not been initialized or is no longer present on disk.'}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={tabContainerRef}
      style={{ '--tree-w': `${treeWidth}px` } as React.CSSProperties}
      className="h-full flex flex-col md:flex-row overflow-hidden font-sans relative"
    >
      {/* Left Tree Explorer */}
      {fileTree.length > 0 && (
        <>
          {!isTreeCollapsed ? (
            <>
              <div
                className={`w-full md:w-[var(--tree-w)] h-1/2 md:h-full border-b md:border-b-0 md:border-r border-onedark-borderSubtle flex-shrink-0 relative ${
                  isResizingTree ? 'transition-none select-none' : 'transition-[width] duration-150'
                }`}
              >
                <FileTreeExplorer
                  taskId={task.id}
                  tree={fileTree}
                  selectedFile={selectedFile}
                  onSelectFile={(path, line) => {
                    pushPoint({ filePath: path, line: line || 1 });
                    handleSelectFile(path, line || null);
                  }}
                  onRenameFile={handleRenameFile}
                  externalSearch={externalSearch}
                  title="Sandbox Files"
                  onToggleCollapse={handleToggleTreeCollapsed}
                />
              </div>

              {/* Draggable Vertical Splitter Handle (Desktop) */}
              <div
                onMouseDown={handleResizerMouseDown}
                onDoubleClick={handleResetTreeWidth}
                className="hidden md:flex w-1.5 -ml-1 hover:bg-onedark-accent/60 active:bg-onedark-accent cursor-col-resize transition-colors flex-shrink-0 z-20 bg-transparent items-center justify-center group"
                title="Drag to resize file tree (Double-click to reset)"
              >
                <div className="w-0.5 h-6 bg-onedark-borderSubtle/60 rounded-full group-hover:bg-onedark-accent transition-colors" />
              </div>
            </>
          ) : (
            <>
              {/* Desktop slim collapsed rail */}
              <div className="hidden md:flex flex-col items-center py-2 px-1 bg-onedark-darker border-r border-onedark-borderSubtle flex-shrink-0 select-none z-10 w-9 space-y-3">
                <button
                  type="button"
                  onClick={handleToggleTreeCollapsed}
                  className="p-1.5 rounded-md hover:bg-onedark-surface text-onedark-muted hover:text-onedark-accent transition-colors cursor-pointer border border-transparent hover:border-onedark-borderSubtle"
                  title="Expand Sandbox Files (Option+1)"
                >
                  <PanelLeftOpen className="w-4 h-4" />
                </button>
                <div
                  onClick={handleToggleTreeCollapsed}
                  className="flex flex-col items-center space-y-2 cursor-pointer group py-2"
                  title="Expand Sandbox Files (Option+1)"
                >
                  <Folder className="w-3.5 h-3.5 text-onedark-folder group-hover:scale-110 transition-transform" />
                  <span className="text-[10px] font-mono [writing-mode:vertical-rl] tracking-wider uppercase text-onedark-muted group-hover:text-onedark-fgBright transition-colors">
                    Files ({data?.file_count || fileTree.length})
                  </span>
                </div>
              </div>

              {/* Mobile compact header strip */}
              <div className="md:hidden flex items-center justify-between px-3 py-1.5 bg-onedark-darker border-b border-onedark-borderSubtle text-xs select-none">
                <div className="flex items-center space-x-2">
                  <Folder className="w-3.5 h-3.5 text-onedark-folder" />
                  <span className="font-semibold text-onedark-fgBright">Sandbox Files ({data?.file_count || fileTree.length})</span>
                </div>
                <button
                  type="button"
                  onClick={handleToggleTreeCollapsed}
                  className="px-2 py-0.5 rounded bg-onedark-surface text-onedark-accent text-[11px] font-mono cursor-pointer border border-onedark-borderSubtle"
                >
                  Expand
                </button>
              </div>
            </>
          )}
        </>
      )}

      {/* Center Code Viewer */}
      <div className="flex-1 h-1/2 md:h-full overflow-hidden bg-onedark-bg flex flex-col min-w-0">
        <CodeViewer
          taskId={task.id}
          filePath={selectedFile}
          targetLine={targetLine}
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          onGoBack={goBack}
          onGoForward={goForward}
          previousFileTooltip={previousPoint?.filePath}
          nextFileTooltip={nextPoint?.filePath}
          onSearchSymbol={(symbol, mode) => {
            setExternalSearch({
              query: symbol,
              mode: mode === 'grep' ? 'grep' : 'ast',
              timestamp: Date.now(),
            });
          }}
          onFileNotFound={() => {
            const fallback = findPreferredOrFirstFile(fileTree);
            if (fallback) {
              pushPoint({ filePath: fallback, line: 1 });
              handleSelectFile(fallback, 1);
            }
          }}
          onAskAboutLine={(context, prompt) => {
            setActiveSnippetContext(context);
            setInitialAgentPrompt(prompt);
            setIsAgentPopoverOpen(true);
          }}
          onOpenAgentChat={() => setIsAgentPopoverOpen(true)}
          onViewCommitDiff={onViewCommitDiff}
        />
      </div>

      {/* Interactive File Agent Sub-Session Popover */}
      {isAgentPopoverOpen && (
        <FileAgentPopover
          isOpen={isAgentPopoverOpen}
          onClose={() => {
            setIsAgentPopoverOpen(false);
            setActiveSnippetContext(null);
            setInitialAgentPrompt(undefined);
          }}
          taskId={task.id}
          filePath={selectedFile}
          modelName={task.model_name}
          activeSnippet={activeSnippetContext}
          initialPrompt={initialAgentPrompt}
          onClearActiveSnippet={() => {
            setActiveSnippetContext(null);
            setInitialAgentPrompt(undefined);
          }}
          onNavigateToFileLine={(filename, line) => {
            pushPoint({ filePath: filename, line: line || 1 });
            handleSelectFile(filename, line || 1);
          }}
        />
      )}
    </div>
  );
};

