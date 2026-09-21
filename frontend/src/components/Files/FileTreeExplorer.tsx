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
  FileText
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

interface FileTreeExplorerProps {
  taskId?: string;
  tree: FileNode[];
  selectedFile: string | null;
  onSelectFile: (path: string, line?: number) => void;
  title?: string;
  subtitle?: string;
}

const API_BASE = import.meta.env.VITE_API_URL || '';

export const FileTreeExplorer: React.FC<FileTreeExplorerProps> = ({
  taskId,
  tree,
  selectedFile,
  onSelectFile,
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
  const [collapsedSearchFiles, setCollapsedSearchFiles] = useState<Record<string, boolean>>({});

  const debounceTimerRef = useRef<any>(null);

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

  const toggleFolder = (path: string) => {
    setExpandedFolders((prev) => ({ ...prev, [path]: !prev[path] }));
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
        const url = `${API_BASE}/api/tasks/${taskId}/files/search?query=${encodeURIComponent(
          filter.trim()
        )}&mode=${modeParam}&is_regex=${isRegex}&case_sensitive=${caseSensitive}&max_results=80`;

        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`Search failed (${res.status})`);
        }
        const data: SearchResponse = await res.json();
        setSearchResults(data);
      } catch (err: any) {
        setSearchError(err.message || 'Error searching files');
      } finally {
        setIsSearching(false);
      }
    }, 280);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [filter, searchMode, isRegex, caseSensitive, taskId]);

  // Group search results by file path
  const groupedResults = useMemo(() => {
    if (!searchResults?.matches) return [];
    const map = new Map<string, SearchMatch[]>();
    for (const match of searchResults.matches) {
      const list = map.get(match.file_path) || [];
      list.push(match);
      map.set(match.file_path, list);
    }
    return Array.from(map.entries()).map(([filePath, matches]) => ({
      filePath,
      matches,
    }));
  }, [searchResults]);

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

  const highlightMatch = (text: string, query: string) => {
    if (!query || !text) return text;
    try {
      const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, caseSensitive ? 'g' : 'gi'));
      return parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark key={i} className="bg-onedark-yellow/30 text-onedark-yellow px-0.5 rounded-xs font-bold">
            {part}
          </mark>
        ) : (
          part
        )
      );
    } catch {
      return text;
    }
  };

  const toggleSearchFileCollapse = (filePath: string) => {
    setCollapsedSearchFiles((prev) => ({ ...prev, [filePath]: !prev[filePath] }));
  };

  const renderNodes = (nodes: FileNode[], depth = 0) => {
    return (
      <div className="space-y-0.5 select-none">
        {nodes.map((node) => {
          const isExpanded = !!expandedFolders[node.path] || !!filter.trim();
          const isSelected = selectedFile === node.path;
          const childCount = node.child_count !== undefined ? node.child_count : (node.children ? node.children.length : 0);

          return (
            <div key={node.path}>
              {node.is_dir ? (
                <div>
                  <button
                    type="button"
                    onClick={() => toggleFolder(node.path)}
                    style={{ paddingLeft: `${depth * 14 + 8}px` }}
                    className="w-full flex items-center space-x-1.5 py-1 pr-2 rounded-md hover:bg-onedark-surface/60 text-[12.5px] font-mono text-onedark-fg hover:text-onedark-fgBright transition-colors text-left group cursor-pointer"
                  >
                    {isExpanded ? (
                      <FolderOpen className="w-4 h-4 text-onedark-folder flex-shrink-0" />
                    ) : (
                      <Folder className="w-4 h-4 text-onedark-folder flex-shrink-0" />
                    )}
                    <span className="font-semibold text-onedark-fg group-hover:text-onedark-fgBright truncate">
                      {node.name}
                    </span>
                    <span className="text-[10.5px] text-onedark-muted font-normal ml-1">
                      ({childCount})
                    </span>
                  </button>

                  {isExpanded && (
                    node.children && node.children.length > 0 ? (
                      <div className="mt-0.5">
                        {renderNodes(node.children, depth + 1)}
                      </div>
                    ) : childCount > 0 ? (
                      <div 
                        style={{ paddingLeft: `${(depth + 1) * 14 + 8}px` }}
                        className="py-1 text-[11px] text-onedark-muted italic select-none"
                      >
                        (Subtree depth limit reached)
                      </div>
                    ) : (
                      <div 
                        style={{ paddingLeft: `${(depth + 1) * 14 + 8}px` }}
                        className="py-1 text-[11px] text-onedark-muted/60 italic select-none"
                      >
                        (Empty directory)
                      </div>
                    )
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onSelectFile(node.path)}
                  style={{ paddingLeft: `${depth * 14 + 8}px` }}
                  className={`w-full flex items-center space-x-1.5 py-1 pr-2.5 rounded-md text-[12.5px] font-mono transition-all text-left cursor-pointer ${
                    isSelected
                      ? 'bg-onedark-accent/20 text-onedark-accent font-semibold border border-onedark-accent/40 shadow-xs'
                      : 'hover:bg-onedark-surface text-onedark-fg/90 hover:text-onedark-fgBright'
                  }`}
                >
                  <FileCode className={`w-3.5 h-3.5 flex-shrink-0 ${
                    isSelected ? 'text-onedark-accent' : 'text-onedark-fg/70'
                  }`} />
                  <span className="truncate flex-1 text-[12.5px]">{node.name}</span>
                  {node.size !== undefined && (
                    <span className="text-[10.5px] text-onedark-muted font-mono flex-shrink-0 ml-2">
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
    <div className="h-full flex flex-col bg-onedark-darker/60 font-mono text-[12.5px] overflow-hidden">
      {/* Explorer Header */}
      <div className="p-2.5 border-b border-onedark-borderSubtle bg-onedark-darker flex-shrink-0 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Folder className="w-4 h-4 text-onedark-folder flex-shrink-0" />
            <span className="font-semibold text-onedark-fgBright text-[12.5px] truncate">
              {title}
            </span>
          </div>

          {searchMode === 'files' && (
            <div className="flex items-center space-x-1">
              <button
                onClick={expandAll}
                className="p-1 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg text-[10.5px] cursor-pointer"
                title="Expand all folders"
              >
                Expand
              </button>
              <span className="text-onedark-border">·</span>
              <button
                onClick={collapseAll}
                className="p-1 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg text-[10.5px] cursor-pointer"
                title="Collapse all folders"
              >
                Collapse
              </button>
            </div>
          )}
        </div>

        {/* Search Mode Toggle Tabs */}
        <div className="flex items-center p-0.5 bg-onedark-darker rounded-lg border border-onedark-borderSubtle text-[11px] font-mono">
          <button
            onClick={() => setSearchMode('files')}
            className={`flex-1 py-1 px-1.5 rounded-md text-center transition-all cursor-pointer font-medium flex items-center justify-center space-x-1.5 whitespace-nowrap ${
              searchMode === 'files'
                ? 'bg-onedark-surface text-onedark-fgBright font-semibold border border-onedark-border/60 shadow-xs'
                : 'text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/40'
            }`}
            title="Browse File Tree"
          >
            <Folder className="w-3 h-3 flex-shrink-0" />
            <span>Files</span>
          </button>
          <button
            onClick={() => setSearchMode('grep')}
            className={`flex-1 py-1 px-1.5 rounded-md text-center transition-all cursor-pointer font-medium flex items-center justify-center space-x-1.5 whitespace-nowrap ${
              searchMode === 'grep'
                ? 'bg-onedark-surface text-onedark-accent font-semibold border border-onedark-accent/40 shadow-xs'
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
                ? 'bg-onedark-surface text-onedark-purple font-semibold border border-onedark-purple/40 shadow-xs'
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
            className="w-full bg-onedark-bg border border-onedark-borderSubtle focus:border-onedark-accent rounded-md pl-7 pr-16 py-1 text-[11.5px] text-onedark-fg focus:outline-none placeholder:text-onedark-muted font-mono"
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
        ) : groupedResults.length === 0 ? (
          <div className="py-8 text-center text-onedark-muted text-[11.5px]">
            No code matches found for &quot;{filter}&quot;.
          </div>
        ) : (
          /* Grouped Search Results */
          <div className="space-y-2.5">
            <div className="px-1 text-[10.5px] text-onedark-muted flex items-center justify-between">
              <span>
                {searchResults?.total_matches} match
                {searchResults?.total_matches === 1 ? '' : 'es'} in {groupedResults.length} file
                {groupedResults.length === 1 ? '' : 's'}
              </span>
              {searchResults?.capped && (
                <span className="text-onedark-yellow font-semibold">(Results capped)</span>
              )}
            </div>

            {groupedResults.map(({ filePath, matches }) => {
              const isCollapsed = !!collapsedSearchFiles[filePath];
              const isSelected = selectedFile === filePath;

              return (
                <div
                  key={filePath}
                  className="rounded-lg border border-onedark-borderSubtle bg-onedark-surface/30 overflow-hidden text-xs"
                >
                  {/* File Header */}
                  <div
                    onClick={() => toggleSearchFileCollapse(filePath)}
                    className="flex items-center justify-between px-2.5 py-1.5 bg-onedark-surface/70 hover:bg-onedark-surface border-b border-onedark-borderSubtle/60 cursor-pointer select-none gap-2"
                  >
                    <div className="flex items-center space-x-1.5 min-w-0">
                      <ChevronDown
                        className={`w-3.5 h-3.5 text-onedark-muted transition-transform duration-150 flex-shrink-0 ${
                          isCollapsed ? '-rotate-90' : ''
                        }`}
                      />
                      <FileCode className="w-3.5 h-3.5 text-onedark-accent flex-shrink-0" />
                      <span className="font-semibold text-onedark-fgBright truncate text-[11.5px]">
                        {filePath}
                      </span>
                    </div>

                    <span className="px-1.5 py-0.2 rounded-full bg-onedark-darker text-[10px] text-onedark-muted font-mono flex-shrink-0">
                      {matches.length}
                    </span>
                  </div>

                  {/* Matching Lines */}
                  {!isCollapsed && (
                    <div className="divide-y divide-onedark-borderSubtle/20 bg-onedark-bg/80 font-mono text-[11px]">
                      {matches.map((match, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => onSelectFile(match.file_path, match.line_number)}
                          className="w-full text-left px-2 py-1.5 hover:bg-onedark-surface/60 transition-colors flex items-start space-x-2 group cursor-pointer"
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
