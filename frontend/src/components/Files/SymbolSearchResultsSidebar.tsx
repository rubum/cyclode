import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Search,
  Sparkles,
  ChevronDown,
  FileCode,
  X,
  Loader2,
  Filter,
  Layers,
  ArrowRight,
  Pin
} from 'lucide-react';
import { SearchMatch, SearchResponse, SearchMode } from './FileTreeExplorer';

interface SymbolSearchResultsSidebarProps {
  taskId: string;
  initialQuery?: string;
  initialMode?: SearchMode;
  currentFile: string | null;
  isOpen: boolean;
  onClose: () => void;
  onSelectMatch: (filePath: string, line: number, isSameFile: boolean) => void;
}

const API_BASE = import.meta.env.VITE_API_URL || '';

export const SymbolSearchResultsSidebar: React.FC<SymbolSearchResultsSidebarProps> = ({
  taskId,
  initialQuery = '',
  initialMode = 'ast',
  currentFile,
  isOpen,
  onClose,
  onSelectMatch,
}) => {
  const [query, setQuery] = useState(initialQuery);
  const [searchMode, setSearchMode] = useState<SearchMode>(initialMode);
  const [isRegex, setIsRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResponse | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [scopeFilter, setScopeFilter] = useState<'all' | 'current' | 'workspace'>('all');
  const [collapsedFiles, setCollapsedFiles] = useState<Record<string, boolean>>({});

  const debounceTimerRef = useRef<any>(null);

  // Sync initial query/mode changes from external triggers (e.g. Cmd+Click in CodeViewer)
  useEffect(() => {
    if (initialQuery && initialQuery !== query) {
      setQuery(initialQuery);
    }
  }, [initialQuery]);

  useEffect(() => {
    if (initialMode && initialMode !== searchMode) {
      setSearchMode(initialMode);
    }
  }, [initialMode]);

  // Execute search against backend API
  const performSearch = async (searchQuery: string, mode: SearchMode) => {
    if (!taskId || !searchQuery.trim()) {
      setSearchResults(null);
      setIsSearching(false);
      setSearchError(null);
      return;
    }

    setIsSearching(true);
    setSearchError(null);

    try {
      const modeParam = mode === 'ast' ? 'ast' : 'text';
      const params = new URLSearchParams({
        query: searchQuery.trim(),
        mode: modeParam,
        is_regex: String(isRegex),
        case_sensitive: String(caseSensitive),
        max_results: '100',
      });
      if (currentFile) {
        params.set('current_file', currentFile);
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

      // Auto-expand current file, and auto-expand others if small number of files (<4)
      const initialCollapsed: Record<string, boolean> = {};
      const uniqueFiles = Array.from(new Set((data.matches || []).map((m) => m.file_path)));
      if (uniqueFiles.length > 4) {
        uniqueFiles.forEach((f) => {
          if (f !== currentFile && !f.endsWith(currentFile || '___none___')) {
            initialCollapsed[f] = true;
          }
        });
      }
      setCollapsedFiles(initialCollapsed);
    } catch (err: any) {
      setSearchError(err.message || 'Error executing search');
    } finally {
      setIsSearching(false);
    }
  };

  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);

    if (query.trim()) {
      debounceTimerRef.current = setTimeout(() => {
        performSearch(query, searchMode);
      }, 250);
    } else {
      setSearchResults(null);
      setIsSearching(false);
    }

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [query, searchMode, isRegex, caseSensitive, taskId, currentFile]);

  // Group search matches by file, prioritizing currentFile at index 0
  const { currentFileGroup, workspaceGroups, totalMatchesCount } = useMemo(() => {
    if (!searchResults?.matches) {
      return { currentFileGroup: null, workspaceGroups: [], totalMatchesCount: 0 };
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
        Boolean(currentFile) &&
        (filePath === currentFile || filePath.endsWith(`/${currentFile}`) || (currentFile || '').endsWith(`/${filePath}`));

      if (isCurrent && !currentGrp) {
        currentGrp = { filePath, matches };
      } else {
        wsGrps.push({ filePath, matches });
      }
    });

    // Sort workspace groups by match count descending
    wsGrps.sort((a, b) => b.matches.length - a.matches.length);

    return {
      currentFileGroup: currentGrp,
      workspaceGroups: wsGrps,
      totalMatchesCount: searchResults.matches.length,
    };
  }, [searchResults, currentFile]);

  const currentFileMatchCount = currentFileGroup?.matches?.length || 0;
  const workspaceMatchCount = totalMatchesCount - currentFileMatchCount;

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

  const toggleFileCollapse = (filePath: string) => {
    setCollapsedFiles((prev) => ({ ...prev, [filePath]: !prev[filePath] }));
  };

  const highlightMatchInSnippet = (snippet?: string, term?: string) => {
    if (!snippet) return '';
    if (!term || !term.trim()) return snippet;

    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escaped})`, caseSensitive ? 'g' : 'gi');
    return snippet.split(regex).map((part, i) =>
      regex.test(part) ? (
        <mark
          key={i}
          className="search-highlight bg-amber-200 text-amber-950 border border-amber-400/80 dark:bg-amber-400/30 dark:text-amber-200 dark:border-amber-400/30 px-1 py-0.5 rounded font-semibold shadow-xs"
        >
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  if (!isOpen) return null;

  return (
    <div className="w-full md:w-80 lg:w-96 h-full border-l border-onedark-borderSubtle bg-onedark-darker flex flex-col flex-shrink-0 z-20 select-none font-sans overflow-hidden">
      {/* Header Bar */}
      <div className="p-2.5 border-b border-onedark-borderSubtle bg-onedark-surface/40 flex flex-col space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-1.5 font-semibold text-xs text-onedark-fgBright">
            <Sparkles className="w-3.5 h-3.5 text-onedark-purple flex-shrink-0" />
            <span>AST Symbol & Code Search</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface transition-colors cursor-pointer"
            title="Close Symbol Search (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Toggle Tabs */}
        <div className="flex bg-onedark-bg/90 p-0.5 rounded-lg border border-onedark-borderSubtle font-mono text-[11px]">
          <button
            type="button"
            onClick={() => {
              setSearchMode('ast');
              if (query.trim()) performSearch(query, 'ast');
            }}
            className={`flex-1 py-1 px-2 rounded-md text-center transition-all cursor-pointer font-medium flex items-center justify-center space-x-1.5 ${
              searchMode === 'ast'
                ? 'bg-onedark-surface text-onedark-purple font-semibold shadow-xs'
                : 'text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/40'
            }`}
            title="AST Structural Search (tgrep)"
          >
            <Sparkles className="w-3 h-3 flex-shrink-0 text-onedark-purple" />
            <span>AST (tgrep)</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setSearchMode('grep');
              if (query.trim()) performSearch(query, 'grep');
            }}
            className={`flex-1 py-1 px-2 rounded-md text-center transition-all cursor-pointer font-medium flex items-center justify-center space-x-1.5 ${
              searchMode === 'grep'
                ? 'bg-onedark-surface text-onedark-accent font-semibold shadow-xs'
                : 'text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/40'
            }`}
            title="Full-Text Content Search (Grep)"
          >
            <Search className="w-3 h-3 flex-shrink-0 text-onedark-accent" />
            <span>Grep (text)</span>
          </button>
        </div>

        {/* Search Input Bar */}
        <div className="relative flex items-center">
          <Search className="w-3.5 h-3.5 text-onedark-muted absolute left-2.5 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              searchMode === 'ast'
                ? 'Search symbol, @decorator, class:...'
                : 'Search text or regex...'
            }
            className="w-full bg-onedark-bg border border-transparent focus:border-onedark-accent/60 rounded-md pl-7 pr-16 py-1.5 text-[11.5px] text-onedark-fg focus:outline-none placeholder:text-onedark-muted/60 font-mono"
            autoFocus
          />
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
            {query && (
              <button
                onClick={() => setQuery('')}
                className="text-onedark-muted hover:text-onedark-fg p-0.5 cursor-pointer"
                title="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Scope Filter Pills */}
        {searchResults && totalMatchesCount > 0 && (
          <div className="flex items-center space-x-1 font-mono text-[10.5px] pt-0.5 overflow-x-auto no-scrollbar">
            <button
              onClick={() => setScopeFilter('all')}
              className={`px-2 py-0.5 rounded-full border transition-colors cursor-pointer flex items-center space-x-1 ${
                scopeFilter === 'all'
                  ? 'bg-onedark-surface text-onedark-fg border-onedark-accent/40 font-semibold'
                  : 'bg-onedark-bg/40 text-onedark-muted border-onedark-borderSubtle hover:text-onedark-fg'
              }`}
            >
              <span>All</span>
              <span className="opacity-70">({totalMatchesCount})</span>
            </button>
            {currentFile && (
              <button
                onClick={() => setScopeFilter('current')}
                className={`px-2 py-0.5 rounded-full border transition-colors cursor-pointer flex items-center space-x-1 ${
                  scopeFilter === 'current'
                    ? 'bg-onedark-accent/20 text-onedark-accent border-onedark-accent/60 font-semibold'
                    : 'bg-onedark-bg/40 text-onedark-muted border-onedark-borderSubtle hover:text-onedark-fg'
                }`}
              >
                <Pin className="w-2.5 h-2.5" />
                <span>This File</span>
                <span className="opacity-70">({currentFileMatchCount})</span>
              </button>
            )}
            <button
              onClick={() => setScopeFilter('workspace')}
              className={`px-2 py-0.5 rounded-full border transition-colors cursor-pointer flex items-center space-x-1 ${
                scopeFilter === 'workspace'
                  ? 'bg-onedark-surface text-onedark-fg border-onedark-accent/40 font-semibold'
                  : 'bg-onedark-bg/40 text-onedark-muted border-onedark-borderSubtle hover:text-onedark-fg'
              }`}
            >
              <span>Workspace</span>
              <span className="opacity-70">({workspaceMatchCount})</span>
            </button>
          </div>
        )}
      </div>

      {/* Results Content Body */}
      <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5 select-text">
        {isSearching ? (
          <div className="py-16 flex flex-col items-center justify-center space-y-2 text-onedark-muted text-xs">
            <Loader2 className="w-5 h-5 animate-spin text-onedark-accent" />
            <span className="font-mono text-[11.5px]">Scanning symbols & references...</span>
          </div>
        ) : searchError ? (
          <div className="p-3 rounded-lg bg-onedark-red/10 border border-onedark-red/30 text-onedark-red text-[11.5px] font-mono">
            {searchError}
          </div>
        ) : !query.trim() ? (
          <div className="py-12 text-center text-onedark-muted text-[11px] px-4 space-y-2">
            <Sparkles className="w-6 h-6 mx-auto text-onedark-purple/70 mb-2" />
            <div className="font-semibold text-onedark-fg">Interactive Code Symbol Search</div>
            <p className="text-onedark-muted/80 leading-relaxed">
              Cmd+Click or select any identifier in the code viewer to instantly inspect AST symbols, definitions, and references.
            </p>
          </div>
        ) : totalMatchesCount === 0 ? (
          <div className="py-12 text-center text-onedark-muted text-[11.5px] font-mono">
            No matches found for &quot;{query}&quot;.
          </div>
        ) : (
          <div className="space-y-2.5">
            {/* Matches Overview Header */}
            <div className="px-1 text-[10.5px] text-onedark-muted font-mono flex items-center justify-between">
              <span>
                {searchResults?.total_matches} match{searchResults?.total_matches === 1 ? '' : 'es'} in{' '}
                {displayedGroups.length} file{displayedGroups.length === 1 ? '' : 's'}
              </span>
              {searchResults?.capped && (
                <span className="text-onedark-yellow font-semibold">(Results capped)</span>
              )}
            </div>

            {/* Accordion File Cards */}
            {displayedGroups.map(({ filePath, matches }) => {
              const isCurrent =
                Boolean(currentFile) &&
                (filePath === currentFile ||
                  filePath.endsWith(`/${currentFile}`) ||
                  (currentFile || '').endsWith(`/${filePath}`));
              const isCollapsed = !isCurrent && !!collapsedFiles[filePath];

              return (
                <div
                  key={filePath}
                  className={`rounded-lg border overflow-hidden text-xs shadow-xs transition-colors ${
                    isCurrent
                      ? 'border-onedark-accent/50 bg-onedark-accent/5 ring-1 ring-onedark-accent/20'
                      : 'border-onedark-borderSubtle bg-onedark-surface/20'
                  }`}
                >
                  {/* Card File Header */}
                  <div
                    onClick={() => toggleFileCollapse(filePath)}
                    className={`flex items-center justify-between px-2.5 py-1.5 border-b cursor-pointer select-none gap-2 transition-colors ${
                      isCurrent
                        ? 'bg-onedark-accent/15 border-onedark-accent/30 hover:bg-onedark-accent/20'
                        : 'bg-onedark-surface/50 border-onedark-borderSubtle hover:bg-onedark-surface/80'
                    }`}
                  >
                    <div className="flex items-center space-x-1.5 min-w-0">
                      <ChevronDown
                        className={`w-3.5 h-3.5 text-onedark-muted transition-transform duration-150 flex-shrink-0 ${
                          isCollapsed ? '-rotate-90' : ''
                        }`}
                      />
                      <FileCode
                        className={`w-3.5 h-3.5 flex-shrink-0 ${
                          isCurrent ? 'text-onedark-accent font-bold' : 'text-onedark-blue'
                        }`}
                      />
                      <span
                        className={`truncate text-[11.5px] font-mono ${
                          isCurrent ? 'font-bold text-onedark-fgBright' : 'font-semibold text-onedark-fg'
                        }`}
                        title={filePath}
                      >
                        {filePath}
                      </span>
                    </div>

                    <div className="flex items-center space-x-1.5 flex-shrink-0">
                      {isCurrent && (
                        <span className="px-1.5 py-0.2 rounded bg-onedark-accent/25 text-[9.5px] font-bold text-onedark-accent font-mono">
                          CURRENT FILE
                        </span>
                      )}
                      <span className="px-1.5 py-0.2 rounded-full bg-onedark-darker text-[10px] text-onedark-muted font-mono">
                        {matches.length}
                      </span>
                    </div>
                  </div>

                  {/* Matching Rows */}
                  {!isCollapsed && (
                    <div className="divide-y divide-onedark-borderSubtle/60 bg-onedark-bg/80 font-mono text-[11px]">
                      {matches.map((match, idx) => {
                        const lineContent = match.line_content || match.signature || match.symbol || '';
                        return (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => onSelectMatch(match.file_path, match.line_number, isCurrent)}
                            className="w-full text-left px-2 py-1 hover:bg-onedark-surface/80 transition-colors flex items-start space-x-2 group cursor-pointer"
                          >
                            <span className="text-[10.5px] text-onedark-muted/60 group-hover:text-onedark-accent font-mono w-8 text-right flex-shrink-0 pt-0.5">
                              {match.line_number}
                            </span>
                            <div className="flex-1 truncate text-onedark-fg group-hover:text-onedark-fgBright">
                              {match.symbol && match.type && (
                                <span className="text-[10px] text-onedark-purple font-semibold mr-1.5 px-1 py-0.2 rounded bg-onedark-purple/10">
                                  {match.type}
                                </span>
                              )}
                              <span>{highlightMatchInSnippet(lineContent, query)}</span>
                            </div>
                          </button>
                        );
                      })}
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
