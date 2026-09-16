import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Monitor,
  Tablet,
  Smartphone,
  RotateCw,
  ExternalLink,
  Copy,
  Check,
  Terminal,
  AlertCircle,
  Play,
  ChevronDown,
  Sparkles,
  Trash2,
  Globe,
  Search,
  RefreshCw,
  X,
  Wrench,
  CheckCircle2,
  XCircle,
  FileCode,
  ArrowRight
} from 'lucide-react';
import { Task, WorkspacePreviewInfo } from '../../types';

interface AppPreviewTabProps {
  task: Task | null;
  onSelectAuxTab?: (tab: string) => void;
  onAskAgent?: (prompt: string) => void;
}

interface ConsoleEntry {
  id: string;
  type: 'log' | 'warn' | 'error' | 'info';
  message: string;
  timestamp: string;
}

interface DiagnosticData {
  task_id: string;
  has_preview: boolean;
  entry_point?: string;
  available_entry_points: string[];
  framework?: string;
  title?: string;
  assets_found: Array<{ name: string; type: string; size: number }>;
  diagnostics: {
    entry_point_exists: boolean;
    has_html_files: boolean;
    has_js_bundles: boolean;
    has_package_json: boolean;
    has_vite_config: boolean;
    workspace_total_files: number;
  };
  suggested_actions: string[];
}

const API_BASE = import.meta.env.VITE_API_URL || '';

export const AppPreviewTab: React.FC<AppPreviewTabProps> = ({
  task,
  onSelectAuxTab,
  onAskAgent,
}) => {
  const [previewInfo, setPreviewInfo] = useState<WorkspacePreviewInfo | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [viewport, setViewport] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [currentPath, setCurrentPath] = useState<string>('index.html');
  const [iframeKey, setIframeKey] = useState<number>(0);
  const [copied, setCopied] = useState<boolean>(false);
  const [logsCopied, setLogsCopied] = useState<boolean>(false);

  // DevTools & Console State
  const [devToolsOpen, setDevToolsOpen] = useState<boolean>(false);
  const [devToolsTab, setDevToolsTab] = useState<'console' | 'diagnostics'>('console');
  const [consoleLogs, setConsoleLogs] = useState<ConsoleEntry[]>([]);
  const [consoleFilter, setConsoleFilter] = useState<'all' | 'error' | 'warn' | 'log'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [entryDropdownOpen, setEntryDropdownOpen] = useState<boolean>(false);
  const [errorBannerDismissed, setErrorBannerDismissed] = useState<boolean>(false);

  // Detailed Diagnostics State
  const [diagnosticsData, setDiagnosticsData] = useState<DiagnosticData | null>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState<boolean>(false);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const pollTimerRef = useRef<any>(null);
  const prevTaskIdRef = useRef<string | null>(null);

  // Fetch preview inspection from backend
  const inspectPreview = useCallback(async (silent = false) => {
    if (!task?.id) {
      setPreviewInfo(null);
      setLoading(false);
      return;
    }

    if (!silent) setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/api/tasks/${task.id}/preview/inspect`);
      if (!res.ok) {
        throw new Error(`Failed to inspect workspace (${res.status})`);
      }
      const data: WorkspacePreviewInfo = await res.json();
      setPreviewInfo(data);

      if (data.has_preview && data.entry_point) {
        setCurrentPath((prev) => {
          if (!prev || prev === 'index.html') return data.entry_point!;
          return prev;
        });
      }
    } catch (err: any) {
      if (!silent) setError(err.message || 'Error checking app preview');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [task?.id]);

  // Fetch deep diagnostics
  const fetchDiagnostics = useCallback(async () => {
    if (!task?.id) return;
    setDiagnosticsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/tasks/${task.id}/preview/diagnostics`);
      if (res.ok) {
        const data: DiagnosticData = await res.json();
        setDiagnosticsData(data);
      }
    } catch (err) {
      // ignore
    } finally {
      setDiagnosticsLoading(false);
    }
  }, [task?.id]);

  useEffect(() => {
    const isNewTask = prevTaskIdRef.current !== task?.id;
    prevTaskIdRef.current = task?.id || null;

    if (isNewTask) {
      setConsoleLogs([]);
      setErrorBannerDismissed(false);
      inspectPreview(false);
    } else {
      inspectPreview(true);
    }

    // Auto-poll when task is running or initializing
    if (task?.status === 'RUNNING' || task?.status === 'INITIALIZING') {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      pollTimerRef.current = setInterval(() => {
        inspectPreview(true);
      }, 3000);
    }

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [task?.id, task?.status, inspectPreview]);

  // Listen to message events from iframe
  useEffect(() => {
    const handleWindowMessage = (e: MessageEvent) => {
      if (e.data && e.data.source === 'cyclode-preview-console') {
        const newLevel = (e.data.level || 'log') as 'log' | 'warn' | 'error' | 'info';
        const formattedMsg = typeof e.data.payload === 'string'
          ? e.data.payload
          : JSON.stringify(e.data.payload, null, 2);

        setConsoleLogs((prev) => [
          ...prev.slice(-200),
          {
            id: Math.random().toString(36).substring(2, 9),
            type: newLevel,
            message: formattedMsg,
            timestamp: new Date().toLocaleTimeString(),
          },
        ]);

        if (newLevel === 'error') {
          setErrorBannerDismissed(false);
        }
      }
    };

    window.addEventListener('message', handleWindowMessage);
    return () => window.removeEventListener('message', handleWindowMessage);
  }, []);

  const handleReload = () => {
    setIframeKey((prev) => prev + 1);
    inspectPreview(true);
  };

  const previewUrl = task?.id
    ? `${API_BASE}/api/tasks/${task.id}/preview/${currentPath}`
    : '';

  const handleCopyUrl = () => {
    if (!previewUrl) return;
    const fullUrl = previewUrl.startsWith('http') ? previewUrl : `${window.location.origin}${previewUrl}`;
    navigator.clipboard.writeText(fullUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyAllLogs = () => {
    const logsText = consoleLogs.map((l) => `[${l.timestamp}] [${l.type.toUpperCase()}] ${l.message}`).join('\n');
    navigator.clipboard.writeText(logsText);
    setLogsCopied(true);
    setTimeout(() => setLogsCopied(false), 2000);
  };

  const handleOpenExternal = () => {
    if (!previewUrl) return;
    window.open(previewUrl, '_blank', 'noopener,noreferrer');
  };

  const handleAskAgentToFixPreview = () => {
    const errorLogs = consoleLogs.filter((l) => l.type === 'error');
    const errorDetails = errorLogs.length > 0
      ? errorLogs.map((e) => `[${e.timestamp}] ${e.message}`).join('\n')
      : 'The app preview is not rendering properly or encountered runtime errors.';

    const prompt = `I noticed runtime errors in the App Preview:\n\`\`\`\n${errorDetails}\n\`\`\`\nPlease inspect the workspace files, fix the issue causing this error, and verify the application runs smoothly.`;
    onAskAgent?.(prompt);
  };

  const handleAskAgentSuggestion = (actionText: string) => {
    const prompt = `Regarding the App Preview:\nAction needed: ${actionText}\nPlease update the workspace files to implement this and ensure the preview renders properly.`;
    onAskAgent?.(prompt);
  };

  // Filtered console logs
  const filteredLogs = consoleLogs.filter((log) => {
    if (consoleFilter === 'error' && log.type !== 'error') return false;
    if (consoleFilter === 'warn' && log.type !== 'warn') return false;
    if (consoleFilter === 'log' && log.type !== 'log' && log.type !== 'info') return false;
    if (searchQuery.trim()) {
      return log.message.toLowerCase().includes(searchQuery.toLowerCase());
    }
    return true;
  });

  const errorCount = consoleLogs.filter((l) => l.type === 'error').length;
  const warnCount = consoleLogs.filter((l) => l.type === 'warn').length;
  const latestError = consoleLogs.slice().reverse().find((l) => l.type === 'error');

  // Render Loading State
  if (loading && !previewInfo) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-onedark-muted font-mono space-y-2 bg-onedark-darker">
        <RotateCw className="w-5 h-5 animate-spin text-onedark-accent" />
        <span className="text-xs">Scanning workspace for web application...</span>
      </div>
    );
  }

  // Render No Preview Found State
  if (!previewInfo?.has_preview) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center text-onedark-muted font-mono select-none space-y-3 bg-onedark-darker">
        <div className="w-12 h-12 rounded-2xl bg-onedark-surface border border-onedark-border flex items-center justify-center text-onedark-muted">
          <Play className="w-6 h-6 stroke-[1.5]" />
        </div>
        <div>
          <div className="text-xs font-semibold text-onedark-fg">No Web Application Found</div>
          <div className="text-[11px] text-onedark-muted mt-1 max-w-xs leading-relaxed">
            When Cyclode creates an <code className="text-onedark-accent bg-onedark-surface px-1 py-0.5 rounded">index.html</code>, frontend bundle, or single-page app in this workspace, the live interactive preview will automatically appear here.
          </div>
        </div>
        <div className="flex items-center space-x-2 pt-1">
          <button
            onClick={() => inspectPreview(false)}
            className="px-3 py-1 rounded bg-onedark-surface hover:bg-onedark-border text-onedark-fg text-[11px] transition-colors cursor-pointer border border-onedark-borderSubtle flex items-center space-x-1.5"
          >
            <RotateCw className="w-3 h-3" />
            <span>Check Workspace</span>
          </button>
          {onAskAgent && (
            <button
              onClick={() => onAskAgent('Please create a fully functional web application with an index.html file in this workspace so I can preview it.')}
              className="px-3 py-1 rounded bg-onedark-accent/15 hover:bg-onedark-accent/25 text-onedark-accent border border-onedark-accent/30 text-[11px] font-sans font-medium transition-colors cursor-pointer flex items-center space-x-1.5"
            >
              <Sparkles className="w-3 h-3" />
              <span>Ask Agent to Build App</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  const availableEntries = previewInfo.available_entry_points || [];

  return (
    <div className="h-full flex flex-col bg-onedark-bg font-sans overflow-hidden select-none">
      {/* Top Browser Navigation & Viewport Bar */}
      <div className="h-10 px-3 bg-onedark-darker border-b border-onedark-borderSubtle flex items-center justify-between gap-2 flex-shrink-0 z-20">
        {/* Left: Reload & Address Bar / Entry Point Selector */}
        <div className="flex items-center space-x-2 flex-1 min-w-0">
          <button
            onClick={handleReload}
            className="p-1.5 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fgBright transition-colors cursor-pointer"
            title="Reload preview"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>

          {/* Address / Entry Point Bar */}
          <div className="relative flex-1 max-w-md">
            <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-onedark-bg border border-onedark-borderSubtle text-[11px] font-mono text-onedark-fg focus-within:border-onedark-accent transition-colors">
              <Globe className="w-3 h-3 text-onedark-accent flex-shrink-0" />
              <span className="text-onedark-muted select-none">/</span>
              <span className="truncate flex-1 text-onedark-fgBright font-semibold">{currentPath}</span>

              {availableEntries.length > 1 && (
                <button
                  onClick={() => setEntryDropdownOpen(!entryDropdownOpen)}
                  className="p-0.5 hover:bg-onedark-surface rounded text-onedark-muted hover:text-onedark-fg transition-colors"
                  title="Switch entry point"
                >
                  <ChevronDown className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Dropdown for multiple HTML files */}
            {entryDropdownOpen && availableEntries.length > 1 && (
              <div className="absolute top-full left-0 mt-1 w-full bg-onedark-darker border border-onedark-border rounded-lg shadow-xl z-30 py-1 font-mono text-xs max-h-48 overflow-y-auto">
                <div className="px-2.5 py-1 text-[10px] text-onedark-muted font-sans font-semibold uppercase tracking-wider">
                  Available Entry Points
                </div>
                {availableEntries.map((entry) => (
                  <button
                    key={entry}
                    onClick={() => {
                      setCurrentPath(entry);
                      setEntryDropdownOpen(false);
                    }}
                    className={`w-full text-left px-2.5 py-1.5 text-xs hover:bg-onedark-surface flex items-center justify-between transition-colors ${
                      currentPath === entry ? 'text-onedark-accent font-semibold bg-onedark-surface/40' : 'text-onedark-fg'
                    }`}
                  >
                    <span className="truncate">{entry}</span>
                    {currentPath === entry && <Check className="w-3 h-3 text-onedark-accent" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {previewInfo.framework && (
            <span className="hidden xl:inline-flex items-center px-1.5 py-0.5 rounded bg-onedark-surface border border-onedark-borderSubtle text-[10px] font-mono text-onedark-accent font-medium">
              {previewInfo.framework}
            </span>
          )}

          {previewInfo.build_status === 'needs_build' && (
            <span className="hidden lg:inline-flex items-center px-1.5 py-0.5 rounded bg-onedark-yellow/15 border border-onedark-yellow/30 text-[10px] font-mono text-onedark-yellow font-medium">
              Needs Build
            </span>
          )}
        </div>

        {/* Center: Viewport Mode Switcher */}
        <div className="flex items-center space-x-0.5 bg-onedark-surface/60 p-0.5 rounded-lg border border-onedark-borderSubtle">
          <button
            onClick={() => setViewport('desktop')}
            className={`p-1 rounded-md transition-all cursor-pointer ${
              viewport === 'desktop'
                ? 'bg-onedark-darker text-onedark-fgBright shadow-xs'
                : 'text-onedark-muted hover:text-onedark-fg hover:bg-onedark-darker/40'
            }`}
            title="Desktop (100% full width)"
          >
            <Monitor className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setViewport('tablet')}
            className={`p-1 rounded-md transition-all cursor-pointer ${
              viewport === 'tablet'
                ? 'bg-onedark-darker text-onedark-fgBright shadow-xs'
                : 'text-onedark-muted hover:text-onedark-fg hover:bg-onedark-darker/40'
            }`}
            title="Tablet (768px)"
          >
            <Tablet className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setViewport('mobile')}
            className={`p-1 rounded-md transition-all cursor-pointer ${
              viewport === 'mobile'
                ? 'bg-onedark-darker text-onedark-fgBright shadow-xs'
                : 'text-onedark-muted hover:text-onedark-fg hover:bg-onedark-darker/40'
            }`}
            title="Mobile (375px)"
          >
            <Smartphone className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Right: DevTools Drawer Toggle, Copy URL, External Link */}
        <div className="flex items-center space-x-1.5">
          <button
            onClick={() => {
              setDevToolsOpen(!devToolsOpen);
              if (!devToolsOpen && devToolsTab === 'diagnostics') {
                fetchDiagnostics();
              }
            }}
            className={`px-2 py-1 rounded text-[11px] font-mono flex items-center space-x-1 transition-colors cursor-pointer border ${
              devToolsOpen
                ? 'bg-onedark-accent/15 border-onedark-accent/30 text-onedark-accent'
                : errorCount > 0
                ? 'bg-onedark-red/15 border-onedark-red/30 text-onedark-red hover:bg-onedark-red/25'
                : 'border-transparent text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface'
            }`}
            title="Toggle DevTools & Inspector"
          >
            <Terminal className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">DevTools</span>
            {errorCount > 0 ? (
              <span className="ml-0.5 px-1 rounded-full bg-onedark-red text-[9px] font-bold text-white">
                {errorCount}
              </span>
            ) : consoleLogs.length > 0 ? (
              <span className="ml-0.5 px-1 rounded-full bg-onedark-accent text-[9px] font-bold text-onedark-darker">
                {consoleLogs.length}
              </span>
            ) : null}
          </button>

          <button
            onClick={handleCopyUrl}
            className="p-1.5 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fgBright transition-colors cursor-pointer"
            title="Copy preview URL"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-onedark-green" /> : <Copy className="w-3.5 h-3.5" />}
          </button>

          <button
            onClick={handleOpenExternal}
            className="p-1.5 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fgBright transition-colors cursor-pointer"
            title="Open in new browser tab"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Preview Canvas Area */}
      <div className="flex-1 overflow-auto bg-onedark-bg flex flex-col items-center justify-center p-2 relative">
        {/* Floating Runtime Error Alert Banner */}
        {errorCount > 0 && !errorBannerDismissed && (
          <div className="absolute top-4 left-4 right-4 z-30 max-w-xl mx-auto animate-fadeIn">
            <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-onedark-darker/95 border border-onedark-red/40 shadow-2xl backdrop-blur-md text-xs">
              <div className="flex items-start space-x-2.5 min-w-0 flex-1">
                <AlertCircle className="w-4 h-4 text-onedark-red flex-shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center space-x-1.5">
                    <span className="font-semibold text-onedark-red">
                      {errorCount} Runtime {errorCount === 1 ? 'Error' : 'Errors'} Detected
                    </span>
                    <span className="text-[10px] text-onedark-muted">in Preview</span>
                  </div>
                  {latestError && (
                    <div className="text-[11px] font-mono text-onedark-fg truncate mt-0.5 opacity-90">
                      {latestError.message}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center space-x-1.5 flex-shrink-0">
                {onAskAgent && (
                  <button
                    onClick={handleAskAgentToFixPreview}
                    className="px-2.5 py-1 rounded-lg bg-onedark-red/20 hover:bg-onedark-red/30 text-onedark-red border border-onedark-red/40 text-[11px] font-medium transition-all flex items-center space-x-1 cursor-pointer shadow-xs active:scale-95"
                    title="Send error logs to agent for automatic fix"
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>Ask Agent to Fix</span>
                  </button>
                )}
                <button
                  onClick={() => {
                    setDevToolsOpen(true);
                    setDevToolsTab('console');
                    setConsoleFilter('error');
                  }}
                  className="px-2 py-1 rounded-lg bg-onedark-surface hover:bg-onedark-border text-onedark-fg text-[11px] transition-colors cursor-pointer"
                >
                  Inspect
                </button>
                <button
                  onClick={() => setErrorBannerDismissed(true)}
                  className="p-1 text-onedark-muted hover:text-onedark-fg rounded transition-colors"
                  title="Dismiss alert"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Floating Uncompiled Template Warning Banner */}
        {previewInfo?.build_status === 'needs_build' && errorCount === 0 && !errorBannerDismissed && (
          <div className="absolute top-4 left-4 right-4 z-30 max-w-xl mx-auto animate-fadeIn">
            <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-onedark-darker/95 border border-onedark-yellow/40 shadow-2xl backdrop-blur-md text-xs">
              <div className="flex items-start space-x-2.5 min-w-0 flex-1">
                <AlertCircle className="w-4 h-4 text-onedark-yellow flex-shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center space-x-1.5">
                    <span className="font-semibold text-onedark-yellow">
                      Uncompiled Frontend Template
                    </span>
                    <span className="text-[10px] text-onedark-muted">({previewInfo.entry_point || 'client/index.html'})</span>
                  </div>
                  <div className="text-[11px] text-onedark-fg truncate mt-0.5 opacity-90">
                    Production bundle is missing. Run <code className="text-onedark-accent font-mono">npm run build</code> to compile for live preview.
                  </div>
                </div>
              </div>

              <div className="flex items-center space-x-1.5 flex-shrink-0">
                {onAskAgent && (
                  <button
                    onClick={() => onAskAgent('Please execute npm run build (or cd client && npm run build) to compile the client application into a production dist/index.html bundle so it renders in the live preview.')}
                    className="px-2.5 py-1 rounded-lg bg-onedark-yellow/20 hover:bg-onedark-yellow/30 text-onedark-yellow border border-onedark-yellow/40 text-[11px] font-medium transition-all flex items-center space-x-1 cursor-pointer shadow-xs active:scale-95"
                    title="Ask agent to build frontend bundle"
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>Build App</span>
                  </button>
                )}
                <button
                  onClick={() => setErrorBannerDismissed(true)}
                  className="p-1 text-onedark-muted hover:text-onedark-fg rounded transition-colors"
                  title="Dismiss alert"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}

        <div
          className={`h-full transition-all duration-200 flex flex-col overflow-hidden ${
            viewport === 'desktop'
              ? 'w-full rounded-none'
              : viewport === 'tablet'
              ? 'w-[768px] max-w-full rounded-xl border border-onedark-border shadow-2xl bg-white'
              : 'w-[375px] max-w-full rounded-2xl border border-onedark-border shadow-2xl bg-white'
          }`}
        >
          {/* Bezel header for Mobile/Tablet */}
          {viewport !== 'desktop' && (
            <div className="h-4 bg-onedark-darker/90 flex items-center justify-center flex-shrink-0 select-none">
              <div className="w-12 h-1 rounded-full bg-onedark-muted/40" />
            </div>
          )}

          <iframe
            key={iframeKey}
            ref={iframeRef}
            src={previewUrl}
            title={previewInfo.title || 'App Preview'}
            sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-modals allow-downloads"
            className="w-full flex-1 border-none bg-white"
          />
        </div>
      </div>

      {/* Collapsible DevTools Drawer (Console + Diagnostics) */}
      {devToolsOpen && (
        <div className="h-56 border-t border-onedark-borderSubtle bg-onedark-darker flex flex-col flex-shrink-0 z-20 font-mono text-[11px]">
          {/* DevTools Navigation Header */}
          <div className="px-3 py-1.5 border-b border-onedark-borderSubtle flex items-center justify-between bg-onedark-surface/40 select-none">
            {/* Tabs */}
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setDevToolsTab('console')}
                className={`px-2 py-1 rounded text-xs font-medium font-sans flex items-center space-x-1.5 transition-colors cursor-pointer ${
                  devToolsTab === 'console'
                    ? 'bg-onedark-surface text-onedark-accent font-semibold border border-onedark-borderSubtle'
                    : 'text-onedark-muted hover:text-onedark-fg'
                }`}
              >
                <Terminal className="w-3.5 h-3.5" />
                <span>Console</span>
                {consoleLogs.length > 0 && (
                  <span className="text-[10px] px-1 py-0.2 rounded-full bg-onedark-bg text-onedark-muted">
                    {consoleLogs.length}
                  </span>
                )}
              </button>

              <button
                onClick={() => {
                  setDevToolsTab('diagnostics');
                  fetchDiagnostics();
                }}
                className={`px-2 py-1 rounded text-xs font-medium font-sans flex items-center space-x-1.5 transition-colors cursor-pointer ${
                  devToolsTab === 'diagnostics'
                    ? 'bg-onedark-surface text-onedark-accent font-semibold border border-onedark-borderSubtle'
                    : 'text-onedark-muted hover:text-onedark-fg'
                }`}
              >
                <Wrench className="w-3.5 h-3.5" />
                <span>Diagnostics & Assets</span>
              </button>
            </div>

            {/* Right Controls */}
            <div className="flex items-center space-x-2">
              {devToolsTab === 'console' && (
                <>
                  {/* Log Filter Buttons */}
                  <div className="flex items-center space-x-1 bg-onedark-bg p-0.5 rounded border border-onedark-borderSubtle">
                    <button
                      onClick={() => setConsoleFilter('all')}
                      className={`px-1.5 py-0.5 rounded text-[10px] transition-colors cursor-pointer ${
                        consoleFilter === 'all' ? 'bg-onedark-surface text-onedark-fg font-semibold' : 'text-onedark-muted hover:text-onedark-fg'
                      }`}
                    >
                      All
                    </button>
                    <button
                      onClick={() => setConsoleFilter('error')}
                      className={`px-1.5 py-0.5 rounded text-[10px] transition-colors cursor-pointer ${
                        consoleFilter === 'error' ? 'bg-onedark-red/20 text-onedark-red font-semibold' : 'text-onedark-muted hover:text-onedark-red'
                      }`}
                    >
                      Errors {errorCount > 0 && `(${errorCount})`}
                    </button>
                    <button
                      onClick={() => setConsoleFilter('warn')}
                      className={`px-1.5 py-0.5 rounded text-[10px] transition-colors cursor-pointer ${
                        consoleFilter === 'warn' ? 'bg-onedark-yellow/20 text-onedark-yellow font-semibold' : 'text-onedark-muted hover:text-onedark-yellow'
                      }`}
                    >
                      Warns {warnCount > 0 && `(${warnCount})`}
                    </button>
                  </div>

                  {/* Search input */}
                  <div className="relative">
                    <Search className="w-3 h-3 absolute left-1.5 top-1.5 text-onedark-muted" />
                    <input
                      type="text"
                      placeholder="Filter..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-5 pr-2 py-0.5 w-24 sm:w-32 bg-onedark-bg border border-onedark-borderSubtle rounded text-[10px] text-onedark-fg focus:outline-none focus:border-onedark-accent"
                    />
                  </div>

                  {/* Fix with Agent button */}
                  {errorCount > 0 && onAskAgent && (
                    <button
                      onClick={handleAskAgentToFixPreview}
                      className="px-2 py-0.5 rounded bg-onedark-red/20 hover:bg-onedark-red/30 text-onedark-red border border-onedark-red/40 text-[10px] font-medium transition-colors flex items-center space-x-1 cursor-pointer"
                      title="Ask Agent to fix console errors"
                    >
                      <Sparkles className="w-2.5 h-2.5" />
                      <span className="hidden sm:inline">Fix Errors</span>
                    </button>
                  )}

                  <button
                    onClick={handleCopyAllLogs}
                    className="p-1 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg transition-colors"
                    title="Copy all logs"
                  >
                    {logsCopied ? <Check className="w-3 h-3 text-onedark-green" /> : <Copy className="w-3 h-3" />}
                  </button>

                  <button
                    onClick={() => setConsoleLogs([])}
                    className="p-1 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg transition-colors"
                    title="Clear console"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </>
              )}

              {devToolsTab === 'diagnostics' && (
                <button
                  onClick={fetchDiagnostics}
                  className="p-1 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg transition-colors"
                  title="Refresh diagnostics"
                >
                  <RefreshCw className={`w-3 h-3 ${diagnosticsLoading ? 'animate-spin text-onedark-accent' : ''}`} />
                </button>
              )}

              <button
                onClick={() => setDevToolsOpen(false)}
                className="text-onedark-muted hover:text-onedark-fg text-xs px-1"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Drawer Body */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1 select-text">
            {devToolsTab === 'console' ? (
              filteredLogs.length === 0 ? (
                <div className="text-onedark-muted/60 text-[10.5px] italic py-4 text-center">
                  {consoleLogs.length === 0
                    ? 'No console events recorded yet. Telemetry listener is active.'
                    : 'No logs match the current filter.'}
                </div>
              ) : (
                filteredLogs.map((log) => (
                  <div
                    key={log.id}
                    className={`flex items-start space-x-2 py-0.5 px-1.5 rounded transition-colors ${
                      log.type === 'error'
                        ? 'bg-onedark-red/10 text-onedark-red border-l-2 border-onedark-red'
                        : log.type === 'warn'
                        ? 'bg-onedark-yellow/10 text-onedark-yellow border-l-2 border-onedark-yellow'
                        : 'text-onedark-fg hover:bg-onedark-surface/40'
                    }`}
                  >
                    <span className="text-onedark-muted text-[9.5px] select-none flex-shrink-0 mt-0.5">
                      {log.timestamp}
                    </span>
                    <span className={`text-[9px] px-1 py-0.2 rounded font-bold uppercase select-none flex-shrink-0 mt-0.5 ${
                      log.type === 'error' ? 'bg-onedark-red/20 text-onedark-red' :
                      log.type === 'warn' ? 'bg-onedark-yellow/20 text-onedark-yellow' :
                      'bg-onedark-surface text-onedark-muted'
                    }`}>
                      {log.type}
                    </span>
                    <span className="break-all whitespace-pre-wrap flex-1">{log.message}</span>
                  </div>
                ))
              )
            ) : (
              /* Diagnostics Tab Content */
              <div className="p-1 space-y-3 font-sans">
                {diagnosticsLoading ? (
                  <div className="flex items-center justify-center py-6 text-onedark-muted text-xs space-x-2">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-onedark-accent" />
                    <span>Analyzing workspace structure...</span>
                  </div>
                ) : (
                  <>
                    {/* Status & Framework Summary */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div className="p-2 rounded-lg bg-onedark-surface/50 border border-onedark-borderSubtle">
                        <div className="text-[10px] text-onedark-muted uppercase font-medium">Framework</div>
                        <div className="text-xs font-semibold text-onedark-accent mt-0.5 truncate">
                          {diagnosticsData?.framework || previewInfo?.framework || 'Vanilla Web'}
                        </div>
                      </div>

                      <div className="p-2 rounded-lg bg-onedark-surface/50 border border-onedark-borderSubtle">
                        <div className="text-[10px] text-onedark-muted uppercase font-medium">Entry Point</div>
                        <div className="text-xs font-semibold text-onedark-fgBright mt-0.5 flex items-center space-x-1">
                          {diagnosticsData?.diagnostics.entry_point_exists !== false ? (
                            <CheckCircle2 className="w-3 h-3 text-onedark-green" />
                          ) : (
                            <XCircle className="w-3 h-3 text-onedark-red" />
                          )}
                          <span className="truncate">{diagnosticsData?.entry_point || currentPath}</span>
                        </div>
                      </div>

                      <div className="p-2 rounded-lg bg-onedark-surface/50 border border-onedark-borderSubtle">
                        <div className="text-[10px] text-onedark-muted uppercase font-medium">Telemetry</div>
                        <div className="text-xs font-semibold text-onedark-green mt-0.5 flex items-center space-x-1">
                          <CheckCircle2 className="w-3 h-3 text-onedark-green" />
                          <span>Active (PostMessage)</span>
                        </div>
                      </div>

                      <div className="p-2 rounded-lg bg-onedark-surface/50 border border-onedark-borderSubtle">
                        <div className="text-[10px] text-onedark-muted uppercase font-medium">Total Files</div>
                        <div className="text-xs font-semibold text-onedark-fg mt-0.5 font-mono">
                          {diagnosticsData?.diagnostics.workspace_total_files ?? 0} files
                        </div>
                      </div>
                    </div>

                    {/* Discovered Web Assets */}
                    <div>
                      <div className="text-[11px] font-semibold text-onedark-fg mb-1.5 flex items-center justify-between">
                        <span>Discovered Assets ({diagnosticsData?.assets_found?.length || 0})</span>
                        <span className="text-[10px] font-normal text-onedark-muted">Workspace root</span>
                      </div>
                      <div className="bg-onedark-bg rounded-lg border border-onedark-borderSubtle overflow-hidden max-h-32 overflow-y-auto">
                        {(diagnosticsData?.assets_found || []).length === 0 ? (
                          <div className="p-2 text-center text-xs text-onedark-muted/60">No web assets found in workspace</div>
                        ) : (
                          <table className="w-full text-[11px] font-mono">
                            <tbody>
                              {(diagnosticsData?.assets_found || []).map((asset) => (
                                <tr key={asset.name} className="border-b border-onedark-borderSubtle/50 hover:bg-onedark-surface/40">
                                  <td className="px-2 py-1 text-onedark-fg flex items-center space-x-1.5">
                                    <FileCode className="w-3 h-3 text-onedark-accent flex-shrink-0" />
                                    <span className="truncate">{asset.name}</span>
                                  </td>
                                  <td className="px-2 py-1 text-right text-onedark-muted text-[10px]">
                                    {asset.size ? `${(asset.size / 1024).toFixed(1)} KB` : '0 KB'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </div>

                    {/* Suggested Actions */}
                    {diagnosticsData?.suggested_actions && diagnosticsData.suggested_actions.length > 0 && (
                      <div>
                        <div className="text-[11px] font-semibold text-onedark-fg mb-1.5">Recommendations</div>
                        <div className="space-y-1">
                          {diagnosticsData.suggested_actions.map((action, i) => (
                            <div
                              key={i}
                              className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-onedark-surface/40 border border-onedark-borderSubtle text-xs"
                            >
                              <span className="text-onedark-fg text-[11px]">{action}</span>
                              {onAskAgent && (
                                <button
                                  onClick={() => handleAskAgentSuggestion(action)}
                                  className="px-2 py-0.5 rounded bg-onedark-accent/15 hover:bg-onedark-accent/25 text-onedark-accent text-[10.5px] font-medium transition-colors flex items-center space-x-1 cursor-pointer flex-shrink-0 ml-2"
                                >
                                  <span>Apply</span>
                                  <ArrowRight className="w-2.5 h-2.5" />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

