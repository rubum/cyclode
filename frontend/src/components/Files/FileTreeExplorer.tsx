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
  Target
} from 'lucide-react';

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
}

const API_BASE = import.meta.env.VITE_API_URL || '';

export const FileTreeExplorer: React.FC<FileTreeExplorerProps> = ({
  taskId,
  tree,
  selectedFile,
  onSelectFile,
  externalSearch,
  title = 'Sandbox Files',
  subtitle
}) => {
  const [filter, setFilter] = useState('');
  const [searchMode, setSearchMode] = useState<SearchMode>('files');
  const [isRegex, setIsRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResponse | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [scopeFilter, setScopeFilter] = useState<'all' | 'current' | 'workspace'>('all');
  const [collapsedSearchFiles, setCollapsedSearchFiles] = useState<Record<string, boolean>>({});

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
          max_results: '100',
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

  const toggleSearchFileCollapse = (filePath: string) => {
    setCollapsedSearchFiles((prev) => ({
      ...prev,
      [filePath]: !prev[filePath],
    }));
  };

  const highlightMatch = (text: string, query: string) => {
    if (!query.trim()) return text;
    try {
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(${escaped})`, caseSensitive ? 'g' : 'gi');
      const parts = text.split(regex);
      return (
        <span>
          {parts.map((part, i) =>
            regex.test(part) ? (
              <mark
                key={i}
                className="bg-onedark-yellow/20 text-onedark-yellow font-semibold rounded px-1 py-0.2 border border-onedark-yellow/30"
              >
                {part}
              </mark>
            ) : (
              part
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
                  style={{ paddingLeft: `${depth * 14 + 6}px` }}
                  className="flex items-center justify-between py-1 px-1.5 rounded-md hover:bg-onedark-surface/60 text-onedark-fg text-xs font-mono cursor-pointer transition-colors group"
                >
                  <div className="flex items-center space-x-1.5 min-w-0">
                    <span className="text-onedark-muted hover:text-onedark-fg">
                      {isLoading ? (
                        <Loader2 className="w-3 h-3 animate-spin text-onedark-accent" />
                      ) : isExpanded ? (
                        <ChevronDown className="w-3 h-3 text-onedark-muted" />
                      ) : (
                        <ChevronRight className="w-3 h-3 text-onedark-muted" />
                      )}
                    </span>
                    {isExpanded ? (
                      <FolderOpen className="w-3.5 h-3.5 text-onedark-folder flex-shrink-0" />
                    ) : (
                      <Folder className="w-3.5 h-3.5 text-onedark-folder flex-shrink-0" />
                    )}
                    <span className="truncate group-hover:text-onedark-fgBright">{node.name}</span>
                  </div>
                  {node.child_count !== undefined && (
                    <span className="text-[10px] text-onedark-muted/60 opacity-0 group-hover:opacity-100 pr-1 font-mono">
                      {node.child_count}
                    </span>
                  )}
                </div>

                {isExpanded && (
                  <div>
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
              style={{ paddingLeft: `${depth * 14 + 20}px` }}
              className={`flex items-center justify-between py-1 px-1.5 rounded-md text-xs font-mono transition-all cursor-pointer group ${
                isSelected
                  ? 'bg-onedark-surface text-onedark-fgBright font-semibold shadow-xs border-l-2 border-onedark-accent'
                  : 'text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/40 border-l-2 border-transparent'
              }`}
            >
              <div className="flex items-center space-x-1.5 min-w-0">
                <FileCode className={`w-3.5 h-3.5 flex-shrink-0 ${isSelected ? 'text-onedark-accent' : 'text-onedark-muted'}`} />
                <span className="truncate">{node.name}</span>
              </div>

              {typeof node.size === 'number' && (
                <span className="text-[10px] text-onedark-muted/50 group-hover:text-onedark-muted pr-1 font-mono flex-shrink-0">
                  {formatBytes(node.size)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-onedark-darker select-none text-onedark-fg font-sans border-r border-onedark-borderSubtle">
      {/* Header Panel */}
      <div className="p-3 border-b border-onedark-borderSubtle flex-shrink-0 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Folder className="w-4 h-4 text-onedark-folder" />
            <span className="font-semibold text-xs text-onedark-fgBright font-sans">{title}</span>
          </div>

          {searchMode === 'files' && (
            <div className="flex items-center space-x-1">
              <button
                onClick={expandAll}
                className="p-1 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg text-[10px] font-mono cursor-pointer transition-colors"
                title="Expand All Folders"
              >
                + Expand
              </button>
              <button
                onClick={collapseAll}
                className="p-1 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg text-[10px] font-mono cursor-pointer transition-colors"
                title="Collapse All Folders"
              >
                - Collapse
              </button>
            </div>
          )}
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
            <div className="px-1 text-[10.5px] text-onedark-muted flex items-center justify-between">
              <span>
                {totalMatchesCount} match{totalMatchesCount === 1 ? '' : 'es'} in {displayedGroups.length} file{displayedGroups.length === 1 ? '' : 's'}
              </span>
              {searchResults?.capped && (
                <span className="text-onedark-yellow font-semibold">(Results capped)</span>
              )}
            </div>

            {displayedGroups.map(({ filePath, matches }) => {
              const isCollapsed = !!collapsedSearchFiles[filePath];
              const isCurrent = currentFileGroup?.filePath === filePath;

              return (
                <div
                  key={filePath}
                  className={`rounded-lg border overflow-hidden text-xs shadow-xs transition-all ${
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
                              <div className="flex items-center space-x-1.5 flex-wrap">
                                {match.type && (
                                  <span className="px-1 py-0.2 rounded text-[9.5px] uppercase font-bold bg-onedark-purple/20 text-onedark-purple">
                                    {match.type}
                                  </span>
                                )}
                                <span className="text-onedark-fg font-semibold truncate">
                                  {match.signature}
                                </span>
                              </div>
                            ) : (
                              <div className="truncate text-onedark-fg/90">
                                {highlightMatch(match.line_content || '', filter)}
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
