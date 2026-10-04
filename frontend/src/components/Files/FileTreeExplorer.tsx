import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  Folder, 
  FolderOpen, 
  FileCode, 
  Search, 
  ChevronRight, 
  ChevronDown, 
  X, 
  Loader2, 
  Code2, 
  Sparkles, 
  Layers, 
  Terminal, 
  FileText, 
  Target,
  Upload,
  Plus,
  FoldVertical,
  UnfoldVertical,
  PanelLeftClose
} from 'lucide-react';
import { createGrepMatcher } from '../../utils/grepMatcher';
import { readDroppedFileSystemEntries, extractFilesFromInput, openNativeFolderPicker, UploadableItem } from '../../utils/fileUpload';

export interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  type: string;
  size?: number;
  child_count?: number;
  children?: FileNode[];
}

export interface SearchMatch {
  file_path: string;
  line_number: number;
  line_content?: string;
  symbol?: string;
  type?: string;
  signature?: string;
  decorators?: string[];
  bases?: string[];
}

export interface SearchResponse {
  query: string;
  mode: 'text' | 'ast' | 'files';
  total_matches: number;
  capped: boolean;
  matches: SearchMatch[];
  total_files_matched?: number;
  files_matched?: string[];
}

export type SearchMode = 'files' | 'grep' | 'ast';

export interface ExternalSearchRequest {
  query: string;
  mode?: 'grep' | 'ast';
  timestamp?: number;
}

interface FileTreeExplorerProps {
  taskId?: string;
  tree: FileNode[];
  selectedFile: string | null;
  onSelectFile: (path: string, line?: number) => void;
  externalSearch?: ExternalSearchRequest | null;
  title?: string;
  subtitle?: string;
  onRefresh?: () => void;
  onToggleCollapse?: () => void;
}

const API_BASE = import.meta.env.VITE_API_URL || '';

export const FileTreeExplorer: React.FC<FileTreeExplorerProps> = ({
  taskId,
  tree,
  selectedFile,
  onSelectFile,
  externalSearch,
  title = 'Sandbox Files',
  subtitle,
  onRefresh,
  onToggleCollapse,
}) => {
  const [filter, setFilter] = useState('');
  const [searchMode, setSearchMode] = useState<SearchMode>('files');
  const [isRegex, setIsRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResponse | null>(null);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const uploadMenuRef = useRef<HTMLDivElement>(null);
  const [showUploadMenu, setShowUploadMenu] = useState<boolean>(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [scopeFilter, setScopeFilter] = useState<'all' | 'current' | 'workspace'>('all');
  const [collapsedSearchFiles, setCollapsedSearchFiles] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (uploadMenuRef.current && !uploadMenuRef.current.contains(e.target as Node)) {
        setShowUploadMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const debounceTimerRef = useRef<any>(null);
  const lastExternalSearchRef = useRef<number | undefined>(undefined);

  // Sync external search trigger (e.g. symbol / keyword clicked in CodeViewer)
  useEffect(() => {
    if (externalSearch && externalSearch.query && externalSearch.timestamp !== lastExternalSearchRef.current) {
      lastExternalSearchRef.current = externalSearch.timestamp;
      setSearchMode(externalSearch.mode === 'grep' ? 'grep' : 'ast');
      setFilter(externalSearch.query);
      setScopeFilter('all');
    }
  }, [externalSearch]);

  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>(() => {
    // Auto-expand root level directories
    const initial: Record<string, boolean> = { '': true };
    tree.forEach((node) => {
      if (node.is_dir) {
        initial[node.path] = true;
      }
    });
    return initial;
  });

  // Auto-expand ancestor directories of active selectedFile
  useEffect(() => {
    if (selectedFile) {
      const parts = selectedFile.split('/');
      if (parts.length > 1) {
        const pathsToExpand: Record<string, boolean> = {};
        let currentPath = '';
        for (let i = 0; i < parts.length - 1; i++) {
          currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];
          pathsToExpand[currentPath] = true;
        }
        setExpandedFolders((prev) => ({ ...prev, ...pathsToExpand }));
      }
    }
  }, [selectedFile]);

  const [dynamicChildren, setDynamicChildren] = useState<Record<string, FileNode[]>>({});
  const [loadingFolders, setLoadingFolders] = useState<Record<string, boolean>>({});

  const toggleFolder = async (node: FileNode) => {
    const nextState = !expandedFolders[node.path];
    setExpandedFolders((prev) => ({ ...prev, [node.path]: nextState }));

    const hasStaticChildren = Boolean(node.children && node.children.length > 0);
    const hasDynamic = Boolean(dynamicChildren[node.path] && dynamicChildren[node.path].length > 0);

    if (nextState && !hasStaticChildren && !hasDynamic && (node.child_count === undefined || node.child_count > 0) && taskId) {
      setLoadingFolders((prev) => ({ ...prev, [node.path]: true }));
      try {
        const res = await fetch(`${API_BASE}/api/tasks/${taskId}/files/children?path=${encodeURIComponent(node.path)}`);
        if (res.ok) {
          const json = await res.json();
          if (json.children) {
            setDynamicChildren((prev) => ({ ...prev, [node.path]: json.children }));
          }
        }
      } catch (err) {
        console.error('Failed to fetch subtree children for', node.path, err);
      } finally {
        setLoadingFolders((prev) => ({ ...prev, [node.path]: false }));
      }
    }
  };

  const expandAll = () => {
    const allExpanded: Record<string, boolean> = {};
    const traverse = (nodes: FileNode[]) => {
      nodes.forEach((n) => {
        if (n.is_dir) {
          allExpanded[n.path] = true;
          if (n.children) traverse(n.children);
        }
      });
    };
    traverse(tree);
    setExpandedFolders(allExpanded);
  };

  const collapseAll = () => {
    setExpandedFolders({});
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  // Perform backend search when in grep or ast mode
  useEffect(() => {
    if (searchMode === 'files' || !filter.trim() || !taskId) {
      setSearchResults(null);
      setIsSearching(false);
      setSearchError(null);
      return;
    }

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(async () => {
      setIsSearching(true);
      setSearchError(null);
      try {
        const modeParam = searchMode === 'ast' ? 'ast' : 'text';
        const params = new URLSearchParams({
          query: filter.trim(),
          mode: modeParam,
          is_regex: String(isRegex),
          case_sensitive: String(caseSensitive),
          max_results: '500',
        });
        if (selectedFile) {
          params.set('current_file', selectedFile);
        }

        const url = `${API_BASE}/api/tasks/${taskId}/files/search?${params.toString()}`;

        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`Search failed (${res.status})`);
        }
        const data: SearchResponse & { error?: string } = await res.json();
        if (data.error && (!data.matches || data.matches.length === 0)) {
          setSearchError(data.error);
          setSearchResults(null);
          return;
        }
        setSearchResults(data);

        // Auto-expand current file, and auto-expand others if <= 4 files
        const initialCollapsed: Record<string, boolean> = {};
        const uniqueFiles = Array.from(new Set((data.matches || []).map((m) => m.file_path)));
        if (uniqueFiles.length > 4) {
          uniqueFiles.forEach((f) => {
            const isCur = selectedFile && (f === selectedFile || f.endsWith(`/${selectedFile}`) || selectedFile.endsWith(`/${f}`));
            if (!isCur) {
              initialCollapsed[f] = true;
            }
          });
        }
        setCollapsedSearchFiles(initialCollapsed);
      } catch (err: any) {
        setSearchError(err.message || 'Error searching files');
      } finally {
        setIsSearching(false);
      }
    }, 250);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [filter, searchMode, isRegex, caseSensitive, taskId, selectedFile]);

  // Group search results by file path, prioritizing active file
  const { currentFileGroup, workspaceGroups, totalMatchesCount, currentFileMatchCount, workspaceMatchCount } = useMemo(() => {
    if (!searchResults?.matches) {
      return {
        currentFileGroup: null,
        workspaceGroups: [],
        totalMatchesCount: 0,
        currentFileMatchCount: 0,
        workspaceMatchCount: 0,
      };
    }

    const map = new Map<string, SearchMatch[]>();
    searchResults.matches.forEach((m) => {
      const list = map.get(m.file_path) || [];
      list.push(m);
      map.set(m.file_path, list);
    });

    let currentGrp: { filePath: string; matches: SearchMatch[] } | null = null;
    const wsGrps: { filePath: string; matches: SearchMatch[] }[] = [];

    Array.from(map.entries()).forEach(([filePath, matches]) => {
      const isCurrent =
        Boolean(selectedFile) &&
        (filePath === selectedFile || filePath.endsWith(`/${selectedFile}`) || (selectedFile || '').endsWith(`/${filePath}`));

      if (isCurrent && !currentGrp) {
        currentGrp = { filePath, matches };
      } else {
        wsGrps.push({ filePath, matches });
      }
    });

    // Sort workspace groups by match count descending
    wsGrps.sort((a, b) => b.matches.length - a.matches.length);

    const curCount = currentGrp ? currentGrp.matches.length : 0;
    const totCount = searchResults.matches.length;

    return {
      currentFileGroup: currentGrp,
      workspaceGroups: wsGrps,
      totalMatchesCount: totCount,
      currentFileMatchCount: curCount,
      workspaceMatchCount: totCount - curCount,
    };
  }, [searchResults, selectedFile]);

  // Filter groups according to scopeFilter
  const displayedGroups = useMemo(() => {
    if (scopeFilter === 'current') {
      return currentFileGroup ? [currentFileGroup] : [];
    }
    if (scopeFilter === 'workspace') {
      return workspaceGroups;
    }
    return currentFileGroup ? [currentFileGroup, ...workspaceGroups] : workspaceGroups;
  }, [scopeFilter, currentFileGroup, workspaceGroups]);

  // Filter tree nodes for files mode
  const filteredTree = useMemo(() => {
    if (searchMode !== 'files' || !filter.trim()) return tree;
    const query = filter.toLowerCase();

    const filterNode = (node: FileNode): FileNode | null => {
      if (!node.is_dir) {
        return node.name.toLowerCase().includes(query) || node.path.toLowerCase().includes(query)
          ? node
          : null;
      }
      const filteredChildren = (node.children || [])
        .map(filterNode)
        .filter(Boolean) as FileNode[];

      if (filteredChildren.length > 0 || node.name.toLowerCase().includes(query)) {
        return {
          ...node,
          children: filteredChildren,
        };
      }
      return null;
    };

    return tree.map(filterNode).filter(Boolean) as FileNode[];
  }, [tree, filter, searchMode]);

  // Summary list of all matching files across codebase
  const matchedFilesSummary = useMemo(() => {
    if (!searchResults) return [];

    const countMap = new Map<string, number>();
    (searchResults.matches || []).forEach((m) => {
      countMap.set(m.file_path, (countMap.get(m.file_path) || 0) + 1);
    });

    const allFilesSet = new Set<string>([
      ...Array.from(countMap.keys()),
      ...(searchResults.files_matched || []),
    ]);

    const list = Array.from(allFilesSet).map((filePath) => {
      const parts = filePath.split('/');
      const fileName = parts[parts.length - 1] || filePath;
      const isCurrent =
        Boolean(selectedFile) &&
        (filePath === selectedFile || filePath.endsWith(`/${selectedFile}`) || (selectedFile || '').endsWith(`/${filePath}`));
      const count = countMap.get(filePath) || 0;
      return {
        filePath,
        fileName,
        isCurrent,
        count,
      };
    });

    list.sort((a, b) => {
      if (a.isCurrent && !b.isCurrent) return -1;
      if (!a.isCurrent && b.isCurrent) return 1;
      if (b.count !== a.count) return b.count - a.count;
      return a.filePath.localeCompare(b.filePath);
    });

    return list;
  }, [searchResults, selectedFile]);

  const expandAllSearchFiles = () => {
    setCollapsedSearchFiles({});
  };

  const collapseAllSearchFiles = () => {
    const collapsed: Record<string, boolean> = {};
    displayedGroups.forEach((g) => {
      collapsed[g.filePath] = true;
    });
    setCollapsedSearchFiles(collapsed);
  };

  const scrollToSearchFile = (filePath: string) => {
    setCollapsedSearchFiles((prev) => ({
      ...prev,
      [filePath]: false,
    }));
    setTimeout(() => {
      const safeId = `search-file-${filePath.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
      const el = document.getElementById(safeId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, 50);
  };

  const toggleSearchFileCollapse = (filePath: string) => {
    setCollapsedSearchFiles((prev) => ({
      ...prev,
      [filePath]: !prev[filePath],
    }));
  };

  const searchMatcher = useMemo(() => {
    return createGrepMatcher(filter, { isRegex, caseSensitive, isAst: searchMode === 'ast' });
  }, [filter, isRegex, caseSensitive, searchMode]);

  const highlightMatch = (text: string | null | undefined, _query?: string) => {
    if (!text) return null;
    if (!filter.trim()) return text;
    try {
      const segments = searchMatcher.highlightSegments(text);
      return (
        <span>
          {segments.map((seg, i) =>
            seg.matched ? (
              <mark
                key={i}
                className="bg-onedark-yellow/25 text-onedark-yellow font-semibold rounded px-0.5 border border-onedark-yellow/40 shadow-xs"
              >
                {seg.text}
              </mark>
            ) : (
              <span key={i}>{seg.text}</span>
            )
          )}
        </span>
      );
    } catch {
      return text;
    }
  };

  // Node renderer for Files mode
  const renderNodes = (nodes: FileNode[], depth = 0) => {
    return (
      <div className="space-y-0.5">
        {nodes.map((node) => {
          const isSelected = selectedFile === node.path;
          const isExpanded = expandedFolders[node.path];
          const hasChildren = node.children && node.children.length > 0;
          const dynamicList = dynamicChildren[node.path];
          const isLoading = loadingFolders[node.path];

          if (node.is_dir) {
            return (
              <div key={node.path} className="select-none">
                <div
                  onClick={() => toggleFolder(node)}
                  title={`${node.path || node.name}${node.child_count !== undefined ? ` (${node.child_count} items)` : ''}`}
                  style={{ paddingLeft: `${depth * 14 + 6}px` }}
                  className="flex items-center justify-between py-1 px-1.5 rounded-md hover:bg-onedark-surface/60 text-onedark-fg text-xs font-mono cursor-pointer transition-colors group"
                >
                  <div className="flex items-center space-x-1.5 min-w-0">
                    <span className="w-3.5 h-3.5 flex items-center justify-center flex-shrink-0">
                      {isLoading ? (
                        <Loader2 className="w-3 h-3 animate-spin text-onedark-accent" />
                      ) : (
                        <ChevronRight className={`w-3 h-3 text-onedark-muted transition-transform duration-150 ${isExpanded ? 'rotate-90 text-onedark-accent' : ''}`} />
                      )}
                    </span>
                    {isExpanded ? (
                      <FolderOpen className="w-3.5 h-3.5 text-onedark-folder flex-shrink-0 transition-transform duration-150 scale-105" />
                    ) : (
                      <Folder className="w-3.5 h-3.5 text-onedark-folder flex-shrink-0 transition-transform duration-150" />
                    )}
                    <span className="truncate group-hover:text-onedark-fgBright transition-colors duration-150">{node.name}</span>
                  </div>
                  {node.child_count !== undefined && (
                    <span className="text-[10px] text-onedark-muted/60 opacity-0 group-hover:opacity-100 pr-1 font-mono transition-opacity duration-150">
                      {node.child_count}
                    </span>
                  )}
                </div>

                {isExpanded && (
                  <div className="animate-stream-fade-in">
                    {hasChildren && renderNodes(node.children!, depth + 1)}
                    {dynamicList && renderNodes(dynamicList, depth + 1)}
                  </div>
                )}
              </div>
            );
          }

          // File Item
          return (
            <div
              key={node.path}
              onClick={() => onSelectFile(node.path)}
              title={`${node.name}${typeof node.size === 'number' ? ` • ${formatBytes(node.size)}` : ''}\nPath: ${node.path}`}
              style={{ paddingLeft: `${depth * 14 + 20}px` }}
              className={`flex items-center justify-between py-1 px-1.5 rounded-md text-xs font-mono cursor-pointer group transition-all duration-150 btn-tactile ${
                isSelected
                  ? 'bg-onedark-surface text-onedark-fgBright font-semibold shadow-xs border-l-2 border-onedark-accent'
                  : 'text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/40 border-l-2 border-transparent'
              }`}
            >
              <div className="flex items-center space-x-1.5 min-w-0">
                <FileCode className={`w-3.5 h-3.5 flex-shrink-0 transition-colors duration-150 ${isSelected ? 'text-onedark-accent' : 'text-onedark-muted'}`} />
                <span className="truncate transition-colors duration-150">{node.name}</span>
              </div>

              {typeof node.size === 'number' && (
                <span className="text-[10px] text-onedark-muted/50 group-hover:text-onedark-muted pr-1 font-mono flex-shrink-0 transition-colors duration-150">
                  {formatBytes(node.size)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const handleUploadItems = async (items: UploadableItem[]) => {
    if (!taskId || !items || items.length === 0) return;
    setIsUploading(true);
    try {
      const formData = new FormData();
      items.forEach((item) => {
        const rel = item.relativePath || item.file.name;
        formData.append('files', item.file, rel);
      });
      formData.append('target_type', 'workspace');

      const res = await fetch(`${API_BASE}/api/tasks/${taskId}/files/upload`, {
        method: 'POST',
        body: formData,
      });
      if (res.ok) {
        const data = await res.json();
        if (data.uploaded && data.uploaded.length > 0) {
          onSelectFile(data.uploaded[0].path);
        }
        if (onRefresh) onRefresh();
      }
    } catch (err) {
      console.error('Failed to upload files to workspace:', err);
    } finally {
      setIsUploading(false);
      setIsDragging(false);
    }
  };

  const setFolderInputRef = (el: HTMLInputElement | null) => {
    folderInputRef.current = el;
    if (el) {
      el.setAttribute('webkitdirectory', '');
      el.setAttribute('directory', '');
      el.setAttribute('mozdirectory', '');
      (el as any).webkitdirectory = true;
    }
  };

  const handleSelectFolder = async () => {
    setShowUploadMenu(false);
    const nativeItems = await openNativeFolderPicker();
    if (nativeItems !== null) {
      if (nativeItems.length > 0) {
        await handleUploadItems(nativeItems);
      }
      return;
    }
    folderInputRef.current?.click();
  };

  const handleUploadFiles = async (files: FileList | File[]) => {
    const items = extractFilesFromInput(files);
    await handleUploadItems(items);
  };

  const handleUploadDropped = async (dataTransfer: DataTransfer) => {
    const items = await readDroppedFileSystemEntries(dataTransfer);
    await handleUploadItems(items);
  };

  return (
    <div 
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        handleUploadDropped(e.dataTransfer);
      }}
      className={`flex flex-col h-full bg-onedark-darker select-none text-onedark-fg font-sans border-r border-onedark-borderSubtle relative transition-colors ${
        isDragging ? 'ring-2 ring-onedark-accent/60 bg-onedark-surface/40' : ''
      }`}
    >
      {/* Hidden file & folder inputs for uploads */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            handleUploadFiles(e.target.files);
          }
          e.target.value = '';
        }}
      />
      <input
        ref={setFolderInputRef}
        type="file"
        // @ts-ignore
        webkitdirectory=""
        directory=""
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            handleUploadFiles(e.target.files);
          }
          e.target.value = '';
        }}
      />

      {/* Drag & Drop Overlay */}
      {isDragging && (
        <div className="absolute inset-0 bg-onedark-darker/90 backdrop-blur-xs z-30 flex flex-col items-center justify-center p-4 border-2 border-dashed border-onedark-accent rounded-lg pointer-events-none text-center space-y-2">
          <Upload className="w-8 h-8 text-onedark-accent animate-bounce" />
          <div className="text-xs font-semibold text-onedark-fgBright">Drop files or folders to ingest into workspace</div>
          <div className="text-[10.5px] text-onedark-muted">Hierarchy will be preserved in workspace root</div>
        </div>
      )}

      {/* Header Panel */}
      <div className="p-3 border-b border-onedark-borderSubtle flex-shrink-0 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Folder className="w-4 h-4 text-onedark-folder" />
            <span className="font-semibold text-xs text-onedark-fgBright font-sans">{title}</span>
          </div>

          <div className="flex items-center space-x-1">
            {taskId && (
              <div ref={uploadMenuRef} className="relative flex items-center bg-onedark-surface/40 rounded border border-onedark-borderSubtle/60 hover:border-onedark-borderSubtle">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  className="px-1.5 py-0.5 rounded-l text-onedark-muted hover:text-onedark-accent text-[10px] font-mono cursor-pointer transition-colors flex items-center space-x-1"
                  title="Upload files to workspace"
                >
                  {isUploading ? (
                    <Loader2 className="w-3 h-3 animate-spin text-onedark-accent" />
                  ) : (
                    <>
                      <Upload className="w-3 h-3" />
                      <span>Upload</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowUploadMenu((v) => !v);
                  }}
                  disabled={isUploading}
                  className="px-1 py-0.5 rounded-r text-onedark-muted hover:text-onedark-accent text-[10px] font-mono cursor-pointer transition-colors flex items-center border-l border-onedark-borderSubtle/40"
                  title="More upload options (upload folder)"
                >
                  <ChevronDown className={`w-2.5 h-2.5 transition-transform duration-150 ${showUploadMenu ? 'rotate-180 text-onedark-accent' : ''}`} />
                </button>

                {showUploadMenu && (
                  <div
                    className="absolute right-0 top-full mt-1 w-36 rounded-lg bg-onedark-darker border border-onedark-border shadow-xl p-1 z-50 flex flex-col space-y-0.5 text-xs font-sans animate-in fade-in zoom-in-95 duration-100"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setShowUploadMenu(false);
                        fileInputRef.current?.click();
                      }}
                      className="w-full px-2 py-1.5 text-left rounded hover:bg-onedark-surface text-onedark-fg hover:text-onedark-fgBright flex items-center space-x-2 cursor-pointer"
                    >
                      <FileText className="w-3.5 h-3.5 text-onedark-accent" />
                      <span>Upload Files</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleSelectFolder}
                      className="w-full px-2 py-1.5 text-left rounded hover:bg-onedark-surface text-onedark-fg hover:text-onedark-fgBright flex items-center space-x-2 cursor-pointer"
                    >
                      <Folder className="w-3.5 h-3.5 text-onedark-yellow" />
                      <span>Upload Folder</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {searchMode === 'files' && (
              <div className="flex items-center space-x-0.5 border-l border-onedark-borderSubtle/60 pl-1 ml-0.5">
                <button
                  type="button"
                  onClick={expandAll}
                  className="p-1 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fgBright transition-colors cursor-pointer"
                  title="Expand All Folders"
                >
                  <UnfoldVertical className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={collapseAll}
                  className="p-1 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fgBright transition-colors cursor-pointer"
                  title="Collapse All Folders"
                >
                  <FoldVertical className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {onToggleCollapse && (
              <button
                type="button"
                onClick={onToggleCollapse}
                className="p-1 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fgBright transition-colors cursor-pointer ml-0.5 border border-transparent hover:border-onedark-borderSubtle"
                title="Collapse file explorer panel (Option+1)"
              >
                <PanelLeftClose className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Mode Selector Tabs: Files, Grep, AST */}
        <div className="flex items-center bg-onedark-darker/90 p-0.5 rounded-lg border border-onedark-borderSubtle text-[11px]">
          <button
            onClick={() => {
              setSearchMode('files');
              setFilter('');
              setSearchResults(null);
              setSearchError(null);
            }}
            className={`flex-1 py-1 px-1.5 rounded-md text-center transition-all cursor-pointer font-medium flex items-center justify-center space-x-1.5 whitespace-nowrap ${
              searchMode === 'files'
                ? 'bg-onedark-surface text-onedark-fgBright font-semibold shadow-xs'
                : 'text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/40'
            }`}
            title="Browse File Tree"
          >
            <Folder className="w-3 h-3 flex-shrink-0 text-onedark-folder" />
            <span>Files</span>
          </button>
          <button
            onClick={() => setSearchMode('grep')}
            className={`flex-1 py-1 px-1.5 rounded-md text-center transition-all cursor-pointer font-medium flex items-center justify-center space-x-1.5 whitespace-nowrap ${
              searchMode === 'grep'
                ? 'bg-onedark-surface text-onedark-accent font-semibold shadow-xs'
                : 'text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/40'
            }`}
            title="Full-Text Content Search (Grep)"
          >
            <Search className="w-3 h-3 flex-shrink-0" />
            <span>Grep</span>
          </button>
          <button
            onClick={() => setSearchMode('ast')}
            className={`flex-1 py-1 px-1.5 rounded-md text-center transition-all cursor-pointer font-medium flex items-center justify-center space-x-1.5 whitespace-nowrap ${
              searchMode === 'ast'
                ? 'bg-onedark-surface text-onedark-purple font-semibold shadow-xs'
                : 'text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/40'
            }`}
            title="AST Structural Search (tgrep)"
          >
            <Sparkles className="w-3 h-3 flex-shrink-0 text-onedark-purple" />
            <span>AST</span>
          </button>
        </div>

        {/* Search / Filter Input Bar */}
        <div className="relative flex items-center">
          <Search className="w-3.5 h-3.5 text-onedark-muted absolute left-2.5 pointer-events-none" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={
              searchMode === 'files'
                ? 'Filter file names...'
                : searchMode === 'grep'
                ? 'Search text or regex across files...'
                : 'Search AST (@router, class:, func:)...'
            }
            className="w-full bg-onedark-bg/80 border border-transparent focus:border-onedark-accent/60 rounded-md pl-7 pr-16 py-1 text-[11.5px] text-onedark-fg focus:outline-none placeholder:text-onedark-muted/60 font-mono"
          />

          {/* Quick Option Buttons inside search box */}
          <div className="absolute right-1.5 flex items-center space-x-1">
            {searchMode === 'grep' && (
              <>
                <button
                  onClick={() => setIsRegex(!isRegex)}
                  className={`px-1 py-0.2 rounded text-[10px] font-mono cursor-pointer transition-colors ${
                    isRegex
                      ? 'bg-onedark-accent text-onedark-bg font-bold'
                      : 'text-onedark-muted hover:text-onedark-fg bg-onedark-surface'
                  }`}
                  title={isRegex ? 'Regex enabled' : 'Enable regex search'}
                >
                  .*
                </button>
                <button
                  onClick={() => setCaseSensitive(!caseSensitive)}
                  className={`px-1 py-0.2 rounded text-[10px] font-mono cursor-pointer transition-colors ${
                    caseSensitive
                      ? 'bg-onedark-accent text-onedark-bg font-bold'
                      : 'text-onedark-muted hover:text-onedark-fg bg-onedark-surface'
                  }`}
                  title={caseSensitive ? 'Case sensitive' : 'Match case'}
                >
                  Aa
                </button>
              </>
            )}

            {filter && (
              <button
                onClick={() => setFilter('')}
                className="text-onedark-muted hover:text-onedark-fg p-0.5 cursor-pointer"
                title="Clear search"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Scope Filters (All / This File / Workspace) */}
        {searchMode !== 'files' && searchResults && totalMatchesCount > 0 && (
          <div className="flex items-center space-x-1 pt-0.5">
            <button
              onClick={() => setScopeFilter('all')}
              className={`px-2 py-0.5 rounded-full text-[10px] font-mono transition-all cursor-pointer ${
                scopeFilter === 'all'
                  ? 'bg-onedark-accent/20 text-onedark-accent font-semibold border border-onedark-accent/40 shadow-xs'
                  : 'text-onedark-muted hover:text-onedark-fg bg-onedark-surface/40 hover:bg-onedark-surface border border-transparent'
              }`}
            >
              All ({totalMatchesCount})
            </button>
            {currentFileGroup && currentFileMatchCount > 0 && (
              <button
                onClick={() => setScopeFilter('current')}
                className={`px-2 py-0.5 rounded-full text-[10px] font-mono transition-all cursor-pointer flex items-center space-x-1 ${
                  scopeFilter === 'current'
                    ? 'bg-onedark-purple/20 text-onedark-purple font-semibold border border-onedark-purple/40 shadow-xs'
                    : 'text-onedark-muted hover:text-onedark-fg bg-onedark-surface/40 hover:bg-onedark-surface border border-transparent'
                }`}
                title="Only matches in the active file"
              >
                <Target className="w-2.5 h-2.5 flex-shrink-0" />
                <span>This File ({currentFileMatchCount})</span>
              </button>
            )}
            {workspaceMatchCount > 0 && (
              <button
                onClick={() => setScopeFilter('workspace')}
                className={`px-2 py-0.5 rounded-full text-[10px] font-mono transition-all cursor-pointer ${
                  scopeFilter === 'workspace'
                    ? 'bg-onedark-blue/20 text-onedark-blue font-semibold border border-onedark-blue/40 shadow-xs'
                    : 'text-onedark-muted hover:text-onedark-fg bg-onedark-surface/40 hover:bg-onedark-surface border border-transparent'
                }`}
              >
                Workspace ({workspaceMatchCount})
              </button>
            )}
          </div>
        )}

        {/* AST Helper prompt hints */}
        {searchMode === 'ast' && !filter && (
          <div className="text-[10px] text-onedark-muted flex flex-wrap items-center gap-1.5 px-0.5">
            <span className="text-onedark-muted/80">Examples:</span>
            <button
              onClick={() => setFilter('@router')}
              className="px-1.5 py-0.5 bg-onedark-surface border border-onedark-borderSubtle hover:border-onedark-purple/50 rounded-md text-onedark-purple hover:underline cursor-pointer transition-colors"
            >
              @router
            </button>
            <button
              onClick={() => setFilter('class:')}
              className="px-1.5 py-0.5 bg-onedark-surface border border-onedark-borderSubtle hover:border-onedark-blue/50 rounded-md text-onedark-blue hover:underline cursor-pointer transition-colors"
            >
              class:
            </button>
            <button
              onClick={() => setFilter('endpoint')}
              className="px-1.5 py-0.5 bg-onedark-surface border border-onedark-borderSubtle hover:border-onedark-accent/50 rounded-md text-onedark-accent hover:underline cursor-pointer transition-colors"
            >
              endpoint
            </button>
          </div>
        )}
      </div>

      {/* Body: File Tree OR Search Results Feed */}
      <div className="flex-1 overflow-y-auto p-2">
        {searchMode === 'files' ? (
          filteredTree.length === 0 ? (
            <div className="py-8 text-center text-onedark-muted text-[11.5px]">
              {filter ? 'No files match your filter.' : 'No files in workspace.'}
            </div>
          ) : (
            renderNodes(filteredTree)
          )
        ) : isSearching ? (
          <div className="py-12 flex flex-col items-center justify-center space-y-2 text-onedark-muted text-xs">
            <Loader2 className="w-5 h-5 animate-spin text-onedark-accent" />
            <span className="font-mono text-[11.5px]">Searching codebase...</span>
          </div>
        ) : searchError ? (
          <div className="p-3 rounded-lg bg-onedark-red/10 border border-onedark-red/30 text-onedark-red text-[11.5px]">
            {searchError}
          </div>
        ) : !filter.trim() ? (
          <div className="py-10 text-center text-onedark-muted text-[11px] px-4 space-y-1.5">
            {searchMode === 'grep' ? (
              <Search className="w-6 h-6 mx-auto text-onedark-accent/70 mb-2" />
            ) : (
              <Sparkles className="w-6 h-6 mx-auto text-onedark-purple/70 mb-2" />
            )}
            <div className="font-semibold text-onedark-fg">
              {searchMode === 'grep' ? 'Full-Text Content Search' : 'AST Structural Search'}
            </div>
            <p className="text-onedark-muted/80 leading-relaxed">
              {searchMode === 'grep'
                ? 'Type keywords or regular expressions to find terms across all files in the workspace.'
                : 'Query endpoints, decorators, classes, and function declarations.'}
            </p>
          </div>
        ) : displayedGroups.length === 0 ? (
          <div className="py-8 text-center text-onedark-muted text-[11.5px]">
            No code matches found for &quot;{filter}&quot;
            {scopeFilter === 'current' ? ' in this file.' : '.'}
          </div>
        ) : (
          /* Grouped Search Results */
          <div className="space-y-2">
            {/* Search Results Summary & Actions Bar */}
            <div className="px-1 text-[10.5px] text-onedark-muted flex items-center justify-between">
              <div className="flex items-center space-x-1.5">
                <span>
                  {totalMatchesCount} match{totalMatchesCount === 1 ? '' : 'es'} in{' '}
                  {searchResults?.total_files_matched || displayedGroups.length} file{((searchResults?.total_files_matched || displayedGroups.length) === 1 ? '' : 's')}
                </span>
                {searchResults?.capped && (
                  <span className="text-onedark-yellow font-semibold text-[10px] px-1 py-0.2 rounded bg-onedark-yellow/10 border border-onedark-yellow/30">
                    Capped
                  </span>
                )}
              </div>

              {displayedGroups.length > 1 && (
                <div className="flex items-center space-x-1 text-[10px]">
                  <button
                    type="button"
                    onClick={expandAllSearchFiles}
                    className="px-1.5 py-0.5 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg cursor-pointer transition-colors"
                    title="Expand all file matches"
                  >
                    Expand all
                  </button>
                  <span className="text-onedark-borderSubtle">·</span>
                  <button
                    type="button"
                    onClick={collapseAllSearchFiles}
                    className="px-1.5 py-0.5 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg cursor-pointer transition-colors"
                    title="Collapse all file matches"
                  >
                    Collapse all
                  </button>
                </div>
              )}
            </div>

            {/* Matched Files Quick Chip Strip */}
            {matchedFilesSummary.length > 1 && (
              <div className="flex items-center gap-1.5 overflow-x-auto py-1 px-1 bg-onedark-surface/30 rounded-lg border border-onedark-borderSubtle/60 no-scrollbar">
                <div className="flex items-center space-x-1 text-[10px] text-onedark-muted font-medium flex-shrink-0 pr-1 pl-0.5">
                  <Layers className="w-3 h-3 text-onedark-accent" />
                  <span>Files:</span>
                </div>
                {matchedFilesSummary.map((item) => (
                  <button
                    key={item.filePath}
                    type="button"
                    onClick={() => scrollToSearchFile(item.filePath)}
                    className={`px-2 py-0.5 rounded-md text-[10.5px] font-mono flex items-center space-x-1.5 flex-shrink-0 transition-all cursor-pointer border ${
                      item.isCurrent
                        ? 'bg-onedark-purple/20 border-onedark-purple/50 text-onedark-purple font-semibold shadow-xs'
                        : 'bg-onedark-surface/60 border-onedark-borderSubtle hover:border-onedark-accent/50 text-onedark-fg hover:text-onedark-fgBright'
                    }`}
                    title={`${item.filePath} (${item.count} matches)`}
                  >
                    <span className="truncate max-w-[130px]">{item.fileName}</span>
                    <span className="px-1 py-0.2 rounded-full bg-onedark-darker text-[9px] text-onedark-muted font-mono">
                      {item.count}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {displayedGroups.map(({ filePath, matches }) => {
              const isCollapsed = !!collapsedSearchFiles[filePath];
              const isCurrent = currentFileGroup?.filePath === filePath;
              const fileElemId = `search-file-${filePath.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

              return (
                <div
                  key={filePath}
                  id={fileElemId}
                  className={`rounded-lg border overflow-hidden text-xs shadow-xs transition-all scroll-mt-2 ${
                    isCurrent
                      ? 'border-onedark-purple/40 bg-onedark-purple/5 ring-1 ring-onedark-purple/20'
                      : 'border-onedark-borderSubtle bg-onedark-surface/20'
                  }`}
                >
                  {/* File Header */}
                  <div
                    onClick={() => toggleSearchFileCollapse(filePath)}
                    className={`flex items-center justify-between px-2.5 py-1.5 border-b border-onedark-borderSubtle cursor-pointer select-none gap-2 transition-colors ${
                      isCurrent
                        ? 'bg-onedark-surface/70 hover:bg-onedark-surface/90 text-onedark-fgBright'
                        : 'bg-onedark-surface/40 hover:bg-onedark-surface/80 text-onedark-fg'
                    }`}
                  >
                    <div className="flex items-center space-x-1.5 min-w-0">
                      <ChevronDown
                        className={`w-3.5 h-3.5 text-onedark-muted transition-transform duration-150 flex-shrink-0 ${
                          isCollapsed ? '-rotate-90' : ''
                        }`}
                      />
                      <FileCode className={`w-3.5 h-3.5 flex-shrink-0 ${isCurrent ? 'text-onedark-purple' : 'text-onedark-accent'}`} />
                      <span className="font-semibold text-onedark-fgBright truncate text-[11.5px]">
                        {filePath}
                      </span>
                    </div>

                    <div className="flex items-center space-x-1.5 flex-shrink-0">
                      {isCurrent && (
                        <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-onedark-purple/20 text-onedark-purple border border-onedark-purple/30">
                          CURRENT FILE
                        </span>
                      )}
                      <span className="px-1.5 py-0.2 rounded-full bg-onedark-darker text-[10px] text-onedark-muted font-mono">
                        {matches.length}
                      </span>
                    </div>
                  </div>

                  {/* Matching Lines */}
                  {!isCollapsed && (
                    <div className="divide-y divide-onedark-borderSubtle/60 bg-onedark-bg/60 font-mono text-[11px]">
                      {matches.map((match, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => onSelectFile(match.file_path, match.line_number)}
                          className="w-full text-left px-2 py-1.5 border border-transparent hover:bg-onedark-surface/60 hover:border-onedark-borderSubtle hover:text-onedark-fgBright transition-all flex items-start space-x-2 group cursor-pointer"
                        >
                          <span className="w-8 text-right font-mono text-onedark-muted/60 group-hover:text-onedark-accent flex-shrink-0 select-none">
                            {match.line_number}
                          </span>

                          <div className="min-w-0 flex-1 leading-snug">
                            {match.signature ? (
                              <div className="space-y-0.5">
                                <div className="flex items-center space-x-1.5 flex-wrap">
                                  {match.type && (
                                    <span className="px-1 py-0.2 rounded text-[9.5px] uppercase font-bold bg-onedark-purple/20 text-onedark-purple">
                                      {match.type}
                                    </span>
                                  )}
                                  <span className="text-onedark-fg font-semibold truncate">
                                    {highlightMatch(match.signature)}
                                  </span>
                                </div>
                                {match.decorators && match.decorators.length > 0 && (
                                  <div className="text-[10px] text-onedark-muted/80 flex items-center space-x-1 truncate font-mono">
                                    <span className="text-onedark-purple">@</span>
                                    <span>{match.decorators.map((d) => highlightMatch(d)).reduce((prev, curr) => [prev, ', ', curr] as any)}</span>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="truncate text-onedark-fg/90">
                                {highlightMatch(match.line_content || '')}
                              </div>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
