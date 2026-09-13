import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  BookOpen, 
  ExternalLink, 
  RotateCw, 
  Copy, 
  Check, 
  X, 
  FolderGit2, 
  Star, 
  GitFork, 
  MessageSquare, 
  Download, 
  Globe, 
  AlertCircle, 
  ChevronLeft, 
  ChevronRight, 
  ChevronDown, 
  List, 
  ListTree, 
  Search,
  FileText,
  Loader2
} from 'lucide-react';
import { MarkdownRenderer } from '../Common/MarkdownRenderer';

export interface DocNavItem {
  title: string;
  url?: string;
  children?: DocNavItem[];
}

export interface DocSearchResult {
  url: string;
  title: string;
  domain: string;
  snippet: string;
}

interface ReaderResponse {
  type: 'github' | 'web';
  url: string;
  title: string;
  description?: string;
  content_markdown: string;
  navigation?: DocNavItem[];
  repo_name?: string;
  stars?: number;
  forks?: number;
  language?: string;
  clone_url?: string;
  default_branch?: string;
}

interface HeadingItem {
  level: number;
  title: string;
  id: string;
}

interface DocsViewerTabProps {
  url: string | null;
  initialTitle?: string;
  onClear?: () => void;
  onAskAboutRepo?: (repoName: string) => void;
  onCloneToSession?: (repoUrl: string, repoName: string) => void;
}

interface DocTreeNodeProps {
  item: DocNavItem;
  activeUrl: string | null;
  onSelectUrl: (url: string) => void;
  depth?: number;
}

const DocTreeNode: React.FC<DocTreeNodeProps> = ({ item, activeUrl, onSelectUrl, depth = 0 }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const hasChildren = Boolean(item.children && item.children.length > 0);
  const isActive = Boolean(
    item.url &&
    activeUrl &&
    (activeUrl === item.url || activeUrl.replace(/\/$/, '') === item.url.replace(/\/$/, ''))
  );

  return (
    <div className="text-xs select-none">
      <div 
        className={`flex items-center space-x-1 py-1 px-1.5 rounded transition-colors group cursor-pointer ${
          isActive 
            ? 'bg-onedark-accent/20 text-onedark-accent font-semibold border-l-2 border-onedark-accent' 
            : 'text-onedark-fg hover:bg-onedark-surface/60 hover:text-onedark-fgBright'
        }`}
        style={{ paddingLeft: `${Math.max(6, depth * 12 + 6)}px` }}
        onClick={() => {
          if (hasChildren && !item.url) {
            setIsExpanded(!isExpanded);
          } else if (item.url) {
            onSelectUrl(item.url);
          }
        }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
            className="p-0.5 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg"
          >
            <ChevronDown className={`w-3 h-3 transition-transform duration-150 ${isExpanded ? '' : '-rotate-90'}`} />
          </button>
        ) : (
          <span className="w-3.5 flex-shrink-0" />
        )}

        {item.url ? (
          <span className="truncate flex-1" title={item.title}>
            {item.title}
          </span>
        ) : (
          <span className="truncate flex-1 font-semibold text-onedark-fgBright/90" title={item.title}>
            {item.title}
          </span>
        )}
      </div>

      {hasChildren && isExpanded && (
        <div className="space-y-0.5">
          {item.children!.map((child, idx) => (
            <DocTreeNode
              key={`${child.title}-${idx}`}
              item={child}
              activeUrl={activeUrl}
              onSelectUrl={onSelectUrl}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const renderHighlightedSnippet = (snippet: string, query: string) => {
  if (!query.trim()) return <span>{snippet}</span>;
  const escaped = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = snippet.split(regex);
  return (
    <span>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark key={i} className="bg-onedark-accent/30 text-onedark-accent font-medium px-0.5 rounded">
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </span>
  );
};

export const DocsViewerTab: React.FC<DocsViewerTabProps> = ({
  url,
  initialTitle,
  onClear,
  onAskAboutRepo,
  onCloneToSession,
}) => {
  const [data, setData] = useState<ReaderResponse | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string | null>(url);
  const [history, setHistory] = useState<string[]>(url ? [url] : []);
  const [historyIndex, setHistoryIndex] = useState<number>(url ? 0 : -1);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'reader' | 'webview'>('reader');
  const [isCopied, setIsCopied] = useState<boolean>(false);

  const [isOutlineOpen, setIsOutlineOpen] = useState<boolean>(false);
  const [isSiteTreeOpen, setIsSiteTreeOpen] = useState<boolean>(false);
  const [treeSearchQuery, setTreeSearchQuery] = useState<string>('');
  const [searchMode, setSearchMode] = useState<'tree' | 'full'>('tree');
  const [fullSearchResults, setFullSearchResults] = useState<DocSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);

  const contentScrollRef = useRef<HTMLDivElement>(null);
  const outlinePopoverRef = useRef<HTMLDivElement>(null);

  // Sync with incoming url prop from parent (e.g. task switch or external link click)
  useEffect(() => {
    if (url) {
      if (history.length === 0 || history[historyIndex] !== url) {
        setHistory((prev) => {
          const next = historyIndex >= 0 ? [...prev.slice(0, historyIndex + 1), url] : [url];
          return next;
        });
        setHistoryIndex((prev) => prev + 1);
        setCurrentUrl(url);
      }
    }
  }, [url]);

  const fetchDoc = async (targetUrl: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const apiBase = import.meta.env.VITE_API_URL || '';
      const res = await fetch(`${apiBase}/api/reader?url=${encodeURIComponent(targetUrl)}`);
      if (!res.ok) {
        throw new Error(`Failed to load page (HTTP ${res.status})`);
      }
      const json: ReaderResponse = await res.json();
      setData(json);

      // Auto-open site tree on first load of a doc with navigation
      if (json.navigation && json.navigation.length > 0) {
        setIsSiteTreeOpen(true);
      }
    } catch (err: any) {
      console.error('Error fetching reader content:', err);
      setError(err.message || 'Failed to fetch documentation');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (currentUrl) {
      fetchDoc(currentUrl);
    } else {
      setData(null);
      setError(null);
    }
  }, [currentUrl]);

  // Navigate to a new internal link or nav target
  const navigateTo = (targetUrl: string) => {
    if (!targetUrl || targetUrl === currentUrl) return;
    const nextHist = [...history.slice(0, historyIndex + 1), targetUrl];
    setHistory(nextHist);
    setHistoryIndex(nextHist.length - 1);
    setCurrentUrl(targetUrl);
  };

  const handleGoBack = () => {
    if (historyIndex > 0) {
      const nextIdx = historyIndex - 1;
      setHistoryIndex(nextIdx);
      setCurrentUrl(history[nextIdx]);
    }
  };

  const handleGoForward = () => {
    if (historyIndex < history.length - 1) {
      const nextIdx = historyIndex + 1;
      setHistoryIndex(nextIdx);
      setCurrentUrl(history[nextIdx]);
    }
  };

  const activeUrl = data?.url || currentUrl || url;

  const handleCopyUrl = () => {
    if (activeUrl) {
      navigator.clipboard.writeText(activeUrl);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    }
  };

  // Debounced full-text search across cached doc pages
  useEffect(() => {
    if (searchMode !== 'full' || !treeSearchQuery.trim()) {
      setFullSearchResults([]);
      setIsSearching(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const apiBase = import.meta.env.VITE_API_URL || '';
        let domainParam = '';
        if (activeUrl) {
          try {
            const parsed = new URL(activeUrl);
            domainParam = `&domain=${encodeURIComponent(parsed.hostname)}`;
          } catch {}
        }
        const res = await fetch(`${apiBase}/api/reader/search?q=${encodeURIComponent(treeSearchQuery.trim())}${domainParam}`);
        if (res.ok) {
          const json = await res.json();
          setFullSearchResults(json.results || []);
        }
      } catch (e) {
        console.error('Error searching docs:', e);
      } finally {
        setIsSearching(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [searchMode, treeSearchQuery, activeUrl]);

  // Extract on-page headings for Table of Contents
  const headings = useMemo<HeadingItem[]>(() => {
    if (!data?.content_markdown) return [];
    const lines = data.content_markdown.split('\n');
    const items: HeadingItem[] = [];
    let inCode = false;

    for (const line of lines) {
      if (line.trim().startsWith('```')) {
        inCode = !inCode;
        continue;
      }
      if (inCode) continue;

      const match = line.match(/^(#{1,4})\s+(.+)$/);
      if (match) {
        const level = match[1].length;
        const rawText = match[2].trim();
        const cleanText = rawText
          .replace(/<[^>]+>/g, '')
          .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
          .replace(/[*_`]/g, '')
          .trim();
        const id = cleanText
          .toLowerCase()
          .replace(/[^\w\s-]/g, '')
          .trim()
          .replace(/\s+/g, '-');

        if (cleanText) {
          items.push({ level, title: cleanText, id });
        }
      }
    }
    return items;
  }, [data?.content_markdown]);

  const scrollToHeading = (id: string) => {
    if (!contentScrollRef.current) return;
    const target = contentScrollRef.current.querySelector(`[id="${id}"]`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setIsOutlineOpen(false);
    }
  };

  // Close outline popover when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (outlinePopoverRef.current && !outlinePopoverRef.current.contains(e.target as Node)) {
        setIsOutlineOpen(false);
      }
    };
    if (isOutlineOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOutlineOpen]);

  // Filter site navigation items
  const filteredNav = useMemo(() => {
    if (!data?.navigation) return [];
    if (!treeSearchQuery.trim()) return data.navigation;
    const q = treeSearchQuery.toLowerCase();

    const filterNodes = (nodes: DocNavItem[]): DocNavItem[] => {
      return nodes
        .map((node) => {
          const matches = node.title.toLowerCase().includes(q);
          const sub = node.children ? filterNodes(node.children) : [];
          if (matches || sub.length > 0) {
            return { ...node, children: sub.length > 0 ? sub : node.children };
          }
          return null;
        })
        .filter(Boolean) as DocNavItem[];
    };

    return filterNodes(data.navigation);
  }, [data?.navigation, treeSearchQuery]);

  if (!url) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center text-onedark-muted select-none">
        <div className="w-12 h-12 rounded-2xl bg-onedark-surface/60 border border-onedark-borderSubtle flex items-center justify-center mb-3 text-onedark-accent/70 shadow-sm">
          <BookOpen className="w-6 h-6" />
        </div>
        <h3 className="text-sm font-semibold text-onedark-fgBright mb-1">In-Workstation Web & Docs</h3>
        <p className="text-xs text-onedark-muted max-w-xs leading-relaxed">
          Click any library or repository link in your chat to preview documentation and READMEs here side-by-side.
        </p>
      </div>
    );
  }

  const isGitHub = data?.type === 'github' || url.includes('github.com');

  return (
    <div className="flex flex-col h-full bg-onedark-darker overflow-hidden text-onedark-fg">
      {/* Top Browser Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-onedark-borderSubtle bg-onedark-bg select-none gap-2 flex-shrink-0">
        {/* Left: History Controls & Title */}
        <div className="flex items-center space-x-1.5 min-w-0 flex-1">
          {/* Back & Forward History */}
          <div className="flex items-center space-x-0.5 mr-0.5">
            <button
              onClick={handleGoBack}
              disabled={historyIndex <= 0}
              className={`p-1 rounded transition-colors ${
                historyIndex > 0
                  ? 'hover:bg-onedark-surface text-onedark-fg hover:text-onedark-fgBright'
                  : 'text-onedark-muted/30 cursor-not-allowed'
              }`}
              title="Back (Go to previous page)"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleGoForward}
              disabled={historyIndex >= history.length - 1}
              className={`p-1 rounded transition-colors ${
                historyIndex < history.length - 1
                  ? 'hover:bg-onedark-surface text-onedark-fg hover:text-onedark-fgBright'
                  : 'text-onedark-muted/30 cursor-not-allowed'
              }`}
              title="Forward (Go to next page)"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {isGitHub ? (
            <FolderGit2 className="w-4 h-4 text-onedark-folder flex-shrink-0" />
          ) : (
            <Globe className="w-4 h-4 text-onedark-accent flex-shrink-0" />
          )}
          <span 
            className="text-xs font-semibold text-onedark-fgBright truncate font-mono"
            title={data?.title || initialTitle || url}
          >
            {data?.title || initialTitle || url}
          </span>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center space-x-1 flex-shrink-0">
          {/* Site Tree & Search Drawer Toggle */}
          {((data?.navigation && data.navigation.length > 0) || (data && !isGitHub)) && (
            <button
              onClick={() => setIsSiteTreeOpen(!isSiteTreeOpen)}
              className={`flex items-center space-x-1 px-2 py-1 rounded text-xs transition-all border cursor-pointer ${
                isSiteTreeOpen
                  ? 'bg-onedark-accent/20 border-onedark-accent/40 text-onedark-accent font-semibold'
                  : 'bg-onedark-surface/60 border-onedark-borderSubtle text-onedark-muted hover:text-onedark-fg'
              }`}
              title="Toggle Documentation Sections & Full-Text Search"
            >
              <ListTree className="w-3.5 h-3.5" />
              <span className="hidden sm:inline text-[11px]">Docs & Search</span>
            </button>
          )}

          {/* Table of Contents / Outline Popover */}
          {headings.length > 1 && (
            <div className="relative" ref={outlinePopoverRef}>
              <button
                onClick={() => setIsOutlineOpen(!isOutlineOpen)}
                className={`flex items-center space-x-1 px-2 py-1 rounded text-xs transition-all border ${
                  isOutlineOpen
                    ? 'bg-onedark-accent/20 border-onedark-accent/40 text-onedark-accent font-semibold'
                    : 'bg-onedark-surface/60 border-onedark-borderSubtle text-onedark-muted hover:text-onedark-fg'
                }`}
                title="Table of Contents (Jump to section)"
              >
                <List className="w-3.5 h-3.5" />
                <span className="hidden sm:inline text-[11px]">Outline</span>
                <span className="px-1 py-0.2 rounded-full bg-onedark-surface text-[10px] text-onedark-muted font-mono">
                  {headings.length}
                </span>
              </button>

              {isOutlineOpen && (
                <div className="absolute right-0 mt-1.5 w-64 max-h-80 overflow-y-auto rounded-xl border border-onedark-border bg-onedark-bg shadow-xl z-50 p-2 space-y-0.5">
                  <div className="flex items-center justify-between px-2 py-1 border-b border-onedark-borderSubtle mb-1 text-[11px] font-semibold text-onedark-fgBright">
                    <span>Table of Contents</span>
                    <button
                      onClick={() => setIsOutlineOpen(false)}
                      className="text-onedark-muted hover:text-onedark-fg p-0.5 rounded"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  {headings.map((h, idx) => (
                    <button
                      key={`${h.id}-${idx}`}
                      onClick={() => scrollToHeading(h.id)}
                      className={`w-full text-left truncate py-1 px-2 rounded hover:bg-onedark-surface transition-colors text-xs ${
                        h.level === 1
                          ? 'font-bold text-onedark-fgBright'
                          : h.level === 2
                          ? 'pl-3.5 font-medium text-onedark-fg'
                          : 'pl-6 text-onedark-muted text-[11px]'
                      }`}
                      title={h.title}
                    >
                      {h.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Mode Switcher */}
          <div className="flex items-center bg-onedark-surface/80 rounded border border-onedark-borderSubtle p-0.5 text-[11px] font-medium mr-0.5">
            <button
              onClick={() => setViewMode('reader')}
              className={`px-2 py-0.5 rounded transition-all ${
                viewMode === 'reader'
                  ? 'bg-onedark-accent text-white shadow-xs font-semibold'
                  : 'text-onedark-muted hover:text-onedark-fg'
              }`}
              title="Clean Reader Mode"
            >
              Reader
            </button>
            <button
              onClick={() => setViewMode('webview')}
              className={`px-2 py-0.5 rounded transition-all ${
                viewMode === 'webview'
                  ? 'bg-onedark-accent text-white shadow-xs font-semibold'
                  : 'text-onedark-muted hover:text-onedark-fg'
              }`}
              title="Live Embedded Webview"
            >
              Webview
            </button>
          </div>

          <button
            onClick={() => fetchDoc(currentUrl || url)}
            className="p-1.5 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg transition-colors"
            title="Refresh"
          >
            <RotateCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-onedark-accent' : ''}`} />
          </button>

          <button
            onClick={handleCopyUrl}
            className="p-1.5 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg transition-colors"
            title={isCopied ? "Copied!" : "Copy Link"}
          >
            {isCopied ? <Check className="w-3.5 h-3.5 text-onedark-green" /> : <Copy className="w-3.5 h-3.5" />}
          </button>

          <a
            href={activeUrl || url}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-accent transition-colors"
            title="Open in new browser tab"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>

          {onClear && (
            <button
              onClick={onClear}
              className="p-1.5 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-red transition-colors ml-1"
              title="Close preview"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* GitHub Repository Header Bar */}
      {data?.type === 'github' && (
        <div className="px-3 py-2 bg-onedark-surface/40 border-b border-onedark-borderSubtle flex flex-wrap items-center justify-between gap-2 text-xs flex-shrink-0">
          <div className="flex items-center space-x-2">
            {data.language && (
              <span className="px-2 py-0.5 rounded-full bg-onedark-accent/15 border border-onedark-accent/30 text-onedark-accent font-mono text-[10.5px] font-semibold">
                {data.language}
              </span>
            )}
            {typeof data.stars === 'number' && data.stars > 0 && (
              <span className="flex items-center space-x-1 text-onedark-yellow text-[11px] font-mono">
                <Star className="w-3 h-3 fill-onedark-yellow" />
                <span>{data.stars.toLocaleString()}</span>
              </span>
            )}
            {typeof data.forks === 'number' && data.forks > 0 && (
              <span className="flex items-center space-x-1 text-onedark-muted text-[11px] font-mono">
                <GitFork className="w-3 h-3" />
                <span>{data.forks.toLocaleString()}</span>
              </span>
            )}
          </div>

          <div className="flex items-center space-x-1.5">
            {onAskAboutRepo && data.repo_name && (
              <button
                onClick={() => onAskAboutRepo(data.repo_name!)}
                className="flex items-center space-x-1 px-2 py-1 rounded bg-onedark-surface hover:bg-onedark-surface/80 border border-onedark-border text-onedark-fgBright text-[11px] font-medium transition-all"
                title="Ask PairProgrammer about this repo"
              >
                <MessageSquare className="w-3 h-3 text-onedark-accent" />
                <span>Ask Agent</span>
              </button>
            )}

            {onCloneToSession && data.clone_url && (
              <button
                onClick={() => onCloneToSession(data.clone_url!, data.repo_name || '')}
                className="flex items-center space-x-1 px-2 py-1 rounded bg-onedark-accent/20 hover:bg-onedark-accent/30 border border-onedark-accent/40 text-onedark-accent text-[11px] font-medium transition-all"
                title="Connect repository to current session"
              >
                <Download className="w-3 h-3" />
                <span>Clone to Session</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Main Content Area with Optional Collapsible Site Tree */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Collapsible Site Tree & Full Doc Search Drawer */}
        {isSiteTreeOpen && (
          <div className="w-64 border-r border-onedark-borderSubtle bg-onedark-bg/95 flex flex-col flex-shrink-0 z-10 shadow-lg sm:shadow-none">
            {/* Drawer Header with Mode Switch and Search Input */}
            <div className="p-2 border-b border-onedark-borderSubtle space-y-2">
              <div className="flex items-center justify-between">
                {/* Search Mode Toggle */}
                <div className="flex items-center bg-onedark-surface/80 rounded p-0.5 text-[10.5px] border border-onedark-borderSubtle">
                  <button
                    onClick={() => setSearchMode('tree')}
                    className={`px-2 py-0.5 rounded transition-all cursor-pointer ${
                      searchMode === 'tree'
                        ? 'bg-onedark-accent text-white font-semibold shadow-xs'
                        : 'text-onedark-muted hover:text-onedark-fg'
                    }`}
                  >
                    Sections
                  </button>
                  <button
                    onClick={() => setSearchMode('full')}
                    className={`px-2 py-0.5 rounded transition-all cursor-pointer ${
                      searchMode === 'full'
                        ? 'bg-onedark-accent text-white font-semibold shadow-xs'
                        : 'text-onedark-muted hover:text-onedark-fg'
                    }`}
                  >
                    Full Docs
                  </button>
                </div>

                <button
                  onClick={() => setIsSiteTreeOpen(false)}
                  className="p-1 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg transition-colors cursor-pointer"
                  title="Collapse Drawer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Search input */}
              <div className="flex items-center space-x-1.5 bg-onedark-surface/60 rounded px-2 py-1 border border-onedark-borderSubtle/60">
                {isSearching ? (
                  <Loader2 className="w-3 h-3 text-onedark-accent animate-spin flex-shrink-0" />
                ) : (
                  <Search className="w-3 h-3 text-onedark-muted flex-shrink-0" />
                )}
                <input
                  type="text"
                  value={treeSearchQuery}
                  onChange={(e) => setTreeSearchQuery(e.target.value)}
                  placeholder={searchMode === 'tree' ? 'Filter sections...' : 'Search cached docs...'}
                  className="w-full bg-transparent border-none text-[11px] text-onedark-fg focus:outline-none placeholder:text-onedark-muted/60"
                />
                {treeSearchQuery && (
                  <button onClick={() => setTreeSearchQuery('')} className="text-onedark-muted hover:text-onedark-fg cursor-pointer">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>

            {/* Content list */}
            <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
              {searchMode === 'tree' ? (
                // Section Tree view
                filteredNav.length === 0 ? (
                  <div className="p-3 text-center text-xs text-onedark-muted">
                    {treeSearchQuery ? `No sections match "${treeSearchQuery}"` : 'No sections available'}
                  </div>
                ) : (
                  filteredNav.map((node, idx) => (
                    <DocTreeNode
                      key={`${node.title}-${idx}`}
                      item={node}
                      activeUrl={activeUrl}
                      onSelectUrl={(targetUrl) => navigateTo(targetUrl)}
                    />
                  ))
                )
              ) : (
                // Full Doc Search Results view
                <div className="space-y-1.5">
                  {!treeSearchQuery.trim() ? (
                    <div className="p-3 text-center text-xs text-onedark-muted leading-relaxed">
                      Type terms above to search full body of indexed documentation.
                    </div>
                  ) : isSearching ? (
                    <div className="p-4 text-center text-xs text-onedark-muted space-y-1">
                      <Loader2 className="w-4 h-4 text-onedark-accent animate-spin mx-auto mb-1" />
                      <span>Searching documentation...</span>
                    </div>
                  ) : fullSearchResults.length === 0 ? (
                    <div className="p-3 text-center text-xs text-onedark-muted leading-relaxed">
                      No documentation matches found for "{treeSearchQuery}".
                    </div>
                  ) : (
                    <>
                      <div className="px-1 py-0.5 text-[10px] text-onedark-muted font-mono">
                        {fullSearchResults.length} page{fullSearchResults.length === 1 ? '' : 's'} matched
                      </div>
                      {fullSearchResults.map((res, idx) => {
                        const isSelected = activeUrl === res.url;
                        return (
                          <div
                            key={`${res.url}-${idx}`}
                            onClick={() => navigateTo(res.url)}
                            className={`p-2 rounded-lg border text-left cursor-pointer transition-all ${
                              isSelected
                                ? 'bg-onedark-accent/20 border-onedark-accent/40 text-onedark-fgBright'
                                : 'bg-onedark-surface/30 border-onedark-borderSubtle hover:bg-onedark-surface hover:border-onedark-border'
                            }`}
                          >
                            <div className="flex items-center space-x-1.5 mb-1">
                              <FileText className="w-3 h-3 text-onedark-accent flex-shrink-0" />
                              <span className="text-xs font-semibold text-onedark-fgBright truncate flex-1">
                                {res.title || res.url}
                              </span>
                            </div>
                            {res.snippet && (
                              <p className="text-[11px] text-onedark-muted line-clamp-2 leading-relaxed font-sans">
                                {renderHighlightedSnippet(res.snippet, treeSearchQuery)}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Reader / Webview Viewport */}
        <div ref={contentScrollRef} className="flex-1 overflow-y-auto p-4 select-text">
          {isLoading && (
            <div className="space-y-4 animate-pulse pt-2">
              <div className="h-5 bg-onedark-surface/80 rounded w-1/2"></div>
              <div className="h-3 bg-onedark-surface/60 rounded w-5/6"></div>
              <div className="h-3 bg-onedark-surface/50 rounded w-4/6"></div>
              <div className="h-24 bg-onedark-surface/40 rounded-lg"></div>
              <div className="h-3 bg-onedark-surface/50 rounded w-full"></div>
              <div className="h-3 bg-onedark-surface/50 rounded w-3/4"></div>
            </div>
          )}

          {error && !isLoading && (
            <div className="p-4 rounded-xl border border-onedark-red/30 bg-onedark-red/10 text-xs text-onedark-fg space-y-2">
              <div className="flex items-center space-x-2 text-onedark-red font-semibold">
                <AlertCircle className="w-4 h-4" />
                <span>Failed to preview document</span>
              </div>
              <p className="text-onedark-muted leading-relaxed">{error}</p>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center space-x-1 text-onedark-accent hover:underline font-medium pt-1"
              >
                <span>Open directly in external browser tab</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}

          {!isLoading && !error && viewMode === 'reader' && data && (
            <div className="prose prose-invert max-w-none text-onedark-fg text-[13.5px] leading-relaxed">
              <MarkdownRenderer content={data.content_markdown} onLinkClick={(nextUrl) => navigateTo(nextUrl)} />
            </div>
          )}

          {!isLoading && !error && viewMode === 'webview' && (
            <div className="h-full flex flex-col -m-4">
              <div className="px-3 py-1.5 bg-onedark-surface/80 border-b border-onedark-borderSubtle text-[11px] text-onedark-muted flex items-center justify-between">
                <span>Embedded webview (sites with strict CSP or X-Frame-Options may block display)</span>
                <button
                  onClick={() => setViewMode('reader')}
                  className="text-onedark-accent hover:underline font-medium"
                >
                  Switch to Reader
                </button>
              </div>
              <iframe
                src={url}
                title={data?.title || 'Web Preview'}
                className="flex-1 w-full border-none bg-white"
                sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
