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
  Layers,
  ChevronDown,
  Sparkles,
  Maximize2,
  Trash2,
  Globe
} from 'lucide-react';
import { Task, WorkspacePreviewInfo } from '../../types';

interface AppPreviewTabProps {
  task: Task | null;
  onSelectAuxTab?: (tab: string) => void;
}

interface ConsoleEntry {
  id: string;
  type: 'log' | 'warn' | 'error' | 'info';
  message: string;
  timestamp: string;
}

const API_BASE = import.meta.env.VITE_API_URL || '';

export const AppPreviewTab: React.FC<AppPreviewTabProps> = ({ task }) => {
  const [previewInfo, setPreviewInfo] = useState<WorkspacePreviewInfo | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [viewport, setViewport] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [currentPath, setCurrentPath] = useState<string>('index.html');
  const [iframeKey, setIframeKey] = useState<number>(0);
  const [copied, setCopied] = useState<boolean>(false);
  const [consoleOpen, setConsoleOpen] = useState<boolean>(false);
  const [consoleLogs, setConsoleLogs] = useState<ConsoleEntry[]>([]);
  const [entryDropdownOpen, setEntryDropdownOpen] = useState<boolean>(false);

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

  useEffect(() => {
    const isNewTask = prevTaskIdRef.current !== task?.id;
    prevTaskIdRef.current = task?.id || null;

    if (isNewTask) {
      setConsoleLogs([]);
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
        setConsoleLogs((prev) => [
          ...prev.slice(-150),
          {
            id: Math.random().toString(36).substring(2, 9),
            type: e.data.level || 'log',
            message: typeof e.data.payload === 'string' ? e.data.payload : JSON.stringify(e.data.payload),
            timestamp: new Date().toLocaleTimeString(),
          },
        ]);
      }
    };

    window.addEventListener('message', handleWindowMessage);
    return () => window.removeEventListener('message', handleWindowMessage);
  }, []);

  const handleReload = () => {
    setIframeKey((prev) => prev + 1);
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

  const handleOpenExternal = () => {
    if (!previewUrl) return;
    window.open(previewUrl, '_blank', 'noopener,noreferrer');
  };

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
        <button
          onClick={() => inspectPreview(false)}
          className="mt-2 px-3 py-1 rounded bg-onedark-surface hover:bg-onedark-border text-onedark-fg text-[11px] transition-colors cursor-pointer border border-onedark-borderSubtle flex items-center space-x-1.5"
        >
          <RotateCw className="w-3 h-3" />
          <span>Check Workspace</span>
        </button>
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

          {previewInfo.title && (
            <span className="hidden xl:inline-block text-[11px] text-onedark-muted truncate max-w-[140px] font-medium" title={previewInfo.title}>
              {previewInfo.title}
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

        {/* Right: Console Drawer Toggle, Copy URL, External Link */}
        <div className="flex items-center space-x-1.5">
          <button
            onClick={() => setConsoleOpen(!consoleOpen)}
            className={`px-2 py-1 rounded text-[11px] font-mono flex items-center space-x-1 transition-colors cursor-pointer border ${
              consoleOpen
                ? 'bg-onedark-accent/15 border-onedark-accent/30 text-onedark-accent'
                : 'border-transparent text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface'
            }`}
            title="Toggle Console Output"
          >
            <Terminal className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Console</span>
            {consoleLogs.length > 0 && (
              <span className="ml-0.5 px-1 rounded-full bg-onedark-accent text-[9px] font-bold text-onedark-darker">
                {consoleLogs.length}
              </span>
            )}
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
      <div className="flex-1 overflow-auto bg-onedark-bg flex items-center justify-center p-2 relative">
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

      {/* Collapsible Console / Runtime Log Drawer */}
      {consoleOpen && (
        <div className="h-40 border-t border-onedark-borderSubtle bg-onedark-darker flex flex-col flex-shrink-0 z-20 font-mono text-[11px]">
          <div className="px-3 py-1.5 border-b border-onedark-borderSubtle flex items-center justify-between bg-onedark-surface/40 select-none">
            <div className="flex items-center space-x-1.5 text-onedark-fg font-semibold">
              <Terminal className="w-3.5 h-3.5 text-onedark-accent" />
              <span>Runtime Console</span>
              <span className="text-onedark-muted text-[10px]">({consoleLogs.length} events)</span>
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setConsoleLogs([])}
                className="p-1 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg transition-colors"
                title="Clear console"
              >
                <Trash2 className="w-3 h-3" />
              </button>
              <button
                onClick={() => setConsoleOpen(false)}
                className="text-onedark-muted hover:text-onedark-fg text-xs px-1"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1 select-text">
            {consoleLogs.length === 0 ? (
              <div className="text-onedark-muted/60 text-[10.5px] italic py-2 text-center">
                Console output and errors will be recorded here.
              </div>
            ) : (
              consoleLogs.map((log) => (
                <div
                  key={log.id}
                  className={`flex items-start space-x-2 py-0.5 px-1 rounded ${
                    log.type === 'error'
                      ? 'bg-onedark-red/10 text-onedark-red'
                      : log.type === 'warn'
                      ? 'bg-onedark-yellow/10 text-onedark-yellow'
                      : 'text-onedark-fg'
                  }`}
                >
                  <span className="text-onedark-muted text-[9.5px] select-none flex-shrink-0 mt-0.5">
                    {log.timestamp}
                  </span>
                  <span className="break-all whitespace-pre-wrap flex-1">{log.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
