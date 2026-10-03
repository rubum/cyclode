import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { 
  Terminal as TerminalIcon, 
  Plus, 
  X, 
  RotateCcw, 
  Trash2, 
  GitBranch, 
  Folder, 
  RefreshCw,
  Copy,
  Check,
  Play,
  Box,
  Zap,
  Cpu
} from 'lucide-react';
import { Task } from '../../types';
import { useWebSocket } from '../../contexts/WebSocketContext';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface TerminalSessionState {
  id: string;
  title: string;
  shell: string;
  runtimeMode?: string;
  containerName?: string | null;
  isAlive: boolean;
  pid?: number | null;
  cols: number;
  rows: number;
}

interface TerminalTabProps {
  task?: Task | null;
  onOpenFile?: (filePath: string) => void;
}

const ONEDARK_TERMINAL_THEME = {
  background: '#181a1f',
  foreground: '#abb2bf',
  cursor: '#528bff',
  cursorAccent: '#181a1f',
  selectionBackground: 'rgba(62, 68, 81, 0.75)',
  selectionForeground: '#f1f5f9',
  black: '#1e2227',
  red: '#e06c75',
  green: '#98c379',
  yellow: '#e5c07b',
  blue: '#61afef',
  magenta: '#c678dd',
  cyan: '#56b6c2',
  white: '#abb2bf',
  brightBlack: '#5c6370',
  brightRed: '#e06c75',
  brightGreen: '#98c379',
  brightYellow: '#e5c07b',
  brightBlue: '#61afef',
  brightMagenta: '#c678dd',
  brightCyan: '#56b6c2',
  brightWhite: '#ffffff',
};

const ONELIGHT_TERMINAL_THEME = {
  background: '#fafafa',
  foreground: '#24292e',
  cursor: '#24292e',
  cursorAccent: '#fafafa',
  selectionBackground: 'rgba(3, 102, 214, 0.25)',
  selectionForeground: '#090a0c',
  black: '#24292e',
  red: '#cb2431',
  green: '#22863a',
  yellow: '#b08800',
  blue: '#0366d6',
  magenta: '#6f42c1',
  cyan: '#1b7c83',
  white: '#6a737d',
  brightBlack: '#586069',
  brightRed: '#d73a49',
  brightGreen: '#28a745',
  brightYellow: '#dbab09',
  brightBlue: '#2188ff',
  brightMagenta: '#8a63d2',
  brightCyan: '#3192aa',
  brightWhite: '#24292e',
};

export const TerminalTab: React.FC<TerminalTabProps> = ({ task, onOpenFile }) => {
  const taskId = task?.id;
  const { isConnected, sendMessage, subscribe } = useWebSocket();

  const [sessions, setSessions] = useState<TerminalSessionState[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [hasCopied, setHasCopied] = useState(false);
  const [isLightMode, setIsLightMode] = useState<boolean>(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('light-theme')
  );

  // In-flight mutex to avoid double spawning during React mount/strict mode
  const isSpawningRef = useRef(false);

  // Map of session_id -> { term, fitAddon, container }
  const terminalInstancesRef = useRef<Map<string, {
    term: XTerm;
    fitAddon: FitAddon;
    container: HTMLDivElement | null;
  }>>(new Map());

  const activeSessionIdRef = useRef<string | null>(null);
  activeSessionIdRef.current = activeSessionId;

  const terminalContainersRef = useRef<Map<string, HTMLDivElement>>(new Map());

  // Listen for real-time dark/light theme changes
  useEffect(() => {
    const handleThemeChange = () => {
      const isLight = document.documentElement.classList.contains('light-theme');
      setIsLightMode(isLight);
      const activeTheme = isLight ? ONELIGHT_TERMINAL_THEME : ONEDARK_TERMINAL_THEME;
      terminalInstancesRef.current.forEach(({ term }) => {
        term.options.theme = activeTheme;
      });
    };

    handleThemeChange();

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.attributeName === 'class') {
          handleThemeChange();
        }
      }
    });

    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    return () => observer.disconnect();
  }, []);

  // Spawn new session helper
  const spawnNewSession = useCallback(async () => {
    if (!taskId || taskId.startsWith('temp-') || isSpawningRef.current) return;
    isSpawningRef.current = true;
    try {
      const res = await fetch(`${API_BASE}/api/tasks/${taskId}/terminals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cols: 120, rows: 32 }),
      });
      if (res.ok) {
        const newSession = await res.json();
        setSessions((prev) => {
          if (prev.some((s) => s.id === newSession.session_id)) {
            return prev;
          }
          const nextIndex = prev.length + 1;
          const rawShell = newSession.shell || 'bash';
          const sessionState: TerminalSessionState = {
            id: newSession.session_id,
            title: `${rawShell} (${nextIndex})`,
            shell: rawShell,
            runtimeMode: newSession.runtime_mode,
            containerName: newSession.container_name,
            isAlive: true,
            pid: newSession.pid,
            cols: newSession.cols || 120,
            rows: newSession.rows || 32,
          };
          return [...prev, sessionState];
        });
        setActiveSessionId(newSession.session_id);
      }
    } catch (err) {
      console.error('Failed to spawn terminal session:', err);
    } finally {
      isSpawningRef.current = false;
    }
  }, [taskId]);

  // Load sessions on task switch
  const loadSessions = useCallback(async () => {
    if (!taskId || taskId.startsWith('temp-')) {
      setSessions([]);
      setActiveSessionId(null);
      return;
    }

    setIsLoadingSessions(true);
    try {
      const res = await fetch(`${API_BASE}/api/tasks/${taskId}/terminals`);
      if (res.ok) {
        const data: Array<any> = await res.json();
        if (data.length > 0) {
          const loadedSessions: TerminalSessionState[] = data.map((s, idx) => ({
            id: s.session_id,
            title: `${s.shell || 'shell'} (${idx + 1})`,
            shell: s.shell || 'bash',
            runtimeMode: s.runtime_mode,
            containerName: s.container_name,
            isAlive: s.is_alive,
            pid: s.pid,
            cols: s.cols || 80,
            rows: s.rows || 24,
          }));
          setSessions(loadedSessions);
          if (!activeSessionIdRef.current || !loadedSessions.some((s) => s.id === activeSessionIdRef.current)) {
            setActiveSessionId(loadedSessions[0].id);
          }
        } else {
          await spawnNewSession();
        }
      }
    } catch (err) {
      console.error('Error loading terminal sessions:', err);
    } finally {
      setIsLoadingSessions(false);
    }
  }, [taskId, spawnNewSession]);

  const handleKillSession = async (sessionId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!taskId) return;

    try {
      await fetch(`${API_BASE}/api/tasks/${taskId}/terminals/${sessionId}`, {
        method: 'DELETE',
      });
    } catch {
      // ignore
    }

    const inst = terminalInstancesRef.current.get(sessionId);
    if (inst) {
      inst.term.dispose();
      terminalInstancesRef.current.delete(sessionId);
    }

    setSessions((prev) => {
      const remaining = prev.filter((s) => s.id !== sessionId);
      if (activeSessionId === sessionId) {
        setActiveSessionId(remaining.length > 0 ? remaining[0].id : null);
      }
      return remaining;
    });
  };

  const handleClearScreen = () => {
    if (!activeSessionId) return;
    const inst = terminalInstancesRef.current.get(activeSessionId);
    if (inst) {
      inst.term.clear();
      // Send clear sequence to PTY
      sendMessage({
        type: 'TERMINAL_INPUT',
        session_id: activeSessionId,
        data: 'clear\n',
      });
    }
  };

  const handleCopyScrollback = () => {
    if (!activeSessionId || !taskId) return;
    fetch(`${API_BASE}/api/tasks/${taskId}/terminals/${activeSessionId}/scrollback`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.scrollback) {
          navigator.clipboard.writeText(data.scrollback);
          setHasCopied(true);
          setTimeout(() => setHasCopied(false), 2000);
        }
      })
      .catch(() => {});
  };

  const handleQuickCommand = (cmd: string) => {
    if (!activeSessionId) return;
    sendMessage({
      type: 'TERMINAL_INPUT',
      session_id: activeSessionId,
      data: `${cmd}\n`,
    });
    const inst = terminalInstancesRef.current.get(activeSessionId);
    if (inst) {
      inst.term.focus();
    }
  };

  const handleRestartSession = async () => {
    if (!activeSessionId || !taskId) return;
    const currentId = activeSessionId;
    await handleKillSession(currentId);
    await spawnNewSession();
  };

  // Mount/bind xterm instance for a given session
  const initTerminal = useCallback((sessionId: string, containerEl: HTMLDivElement) => {
    if (terminalInstancesRef.current.has(sessionId)) {
      const existing = terminalInstancesRef.current.get(sessionId)!;
      existing.fitAddon.fit();
      return;
    }

    const currentTheme = document.documentElement.classList.contains('light-theme')
      ? ONELIGHT_TERMINAL_THEME
      : ONEDARK_TERMINAL_THEME;

    const term = new XTerm({
      theme: currentTheme,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Menlo', 'Monaco', 'Courier New', monospace",
      fontSize: 12.5,
      lineHeight: 1.3,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 10000,
      convertEol: true,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    // Clickable link navigation
    const webLinksAddon = new WebLinksAddon((_event, uri) => {
      const cleanPath = uri.replace(/^file:\/\//, '').replace(/:\d+(:\d+)?$/, '');
      if (onOpenFile && (cleanPath.startsWith('/') || cleanPath.startsWith('./') || cleanPath.includes('.'))) {
        onOpenFile(cleanPath);
      } else {
        window.open(uri, '_blank', 'noopener,noreferrer');
      }
    });
    term.loadAddon(webLinksAddon);

    term.open(containerEl);
    fitAddon.fit();

    // Wire keystroke transmission to backend
    term.onData((data) => {
      sendMessage({
        type: 'TERMINAL_INPUT',
        session_id: sessionId,
        data,
      });
    });

    terminalInstancesRef.current.set(sessionId, {
      term,
      fitAddon,
      container: containerEl,
    });

    // Fetch initial scrollback
    if (taskId) {
      fetch(`${API_BASE}/api/tasks/${taskId}/terminals/${sessionId}/scrollback`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.scrollback) {
            term.write(data.scrollback);
          }
        })
        .catch(() => {});
    }

    // Sync initial dimensions with server
    setTimeout(() => {
      fitAddon.fit();
      if (term.cols && term.rows) {
        sendMessage({
          type: 'TERMINAL_RESIZE',
          session_id: sessionId,
          cols: term.cols,
          rows: term.rows,
        });
      }
    }, 100);
  }, [taskId, sendMessage, onOpenFile]);

  // Initial load
  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Handle incoming output from WebSocket
  useEffect(() => {
    const unsubscribeOutput = subscribe('TERMINAL_OUTPUT', (payload: { session_id: string; data: string }) => {
      if (!payload?.session_id || !payload.data) return;
      const inst = terminalInstancesRef.current.get(payload.session_id);
      if (inst) {
        inst.term.write(payload.data);
      }
    });

    const unsubscribeExit = subscribe('TERMINAL_EXIT', (payload: { session_id: string; return_code: number }) => {
      if (!payload?.session_id) return;
      setSessions((prev) =>
        prev.map((s) => (s.id === payload.session_id ? { ...s, isAlive: false } : s))
      );
      const inst = terminalInstancesRef.current.get(payload.session_id);
      if (inst) {
        inst.term.write(`\r\n\x1b[33m[Process exited with status ${payload.return_code}]\x1b[0m\r\n`);
      }
    });

    return () => {
      unsubscribeOutput();
      unsubscribeExit();
    };
  }, [subscribe]);

  // Handle ResizeObserver for dynamic pane resizing
  useEffect(() => {
    const handleResize = () => {
      if (activeSessionId) {
        const inst = terminalInstancesRef.current.get(activeSessionId);
        if (inst && inst.container) {
          try {
            inst.fitAddon.fit();
            sendMessage({
              type: 'TERMINAL_RESIZE',
              session_id: activeSessionId,
              cols: inst.term.cols,
              rows: inst.term.rows,
            });
          } catch {
            // ignore fit calculations during hidden state
          }
        }
      }
    };

    window.addEventListener('resize', handleResize);
    const observer = new ResizeObserver(() => {
      handleResize();
    });

    const activeEl = activeSessionId ? terminalContainersRef.current.get(activeSessionId) : null;
    if (activeEl) {
      observer.observe(activeEl);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      observer.disconnect();
    };
  }, [activeSessionId, sendMessage]);

  // Trigger fit and focus when activeSessionId changes
  useEffect(() => {
    if (activeSessionId) {
      setTimeout(() => {
        const inst = terminalInstancesRef.current.get(activeSessionId);
        if (inst) {
          try {
            inst.fitAddon.fit();
            inst.term.focus();
          } catch {
            // ignore
          }
        }
      }, 50);
    }
  }, [activeSessionId]);

  // Teardown all instances on unmount
  useEffect(() => {
    return () => {
      terminalInstancesRef.current.forEach((inst) => {
        try {
          inst.term.dispose();
        } catch {
          // ignore
        }
      });
      terminalInstancesRef.current.clear();
    };
  }, []);

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const activeCols = activeSession?.cols || 120;
  const activeRows = activeSession?.rows || 32;

  if (!task) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-onedark-bg text-onedark-muted text-xs font-mono p-8 text-center">
        <TerminalIcon className="w-8 h-8 opacity-40 mb-2 text-onedark-accent" />
        <div>No active workspace selected.</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-onedark-bg overflow-hidden text-onedark-fg font-mono text-xs select-none">
      {/* Top Session Control & Multi-Tab Bar (Adapts to Dark / Light Theme) */}
      <div className="flex items-center justify-between px-2.5 py-1.5 bg-onedark-darker border-b border-onedark-borderSubtle/80 flex-shrink-0">
        {/* Left: Session Tabs */}
        <div className="flex items-center space-x-1 overflow-x-auto no-scrollbar flex-1 mr-3">
          {sessions.map((s) => {
            const isActive = s.id === activeSessionId;
            const isDocker = s.runtimeMode === 'container';
            return (
              <div
                key={s.id}
                onClick={() => setActiveSessionId(s.id)}
                className={`group relative flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all duration-150 ${
                  isActive
                    ? 'bg-onedark-surface text-onedark-fgBright shadow-xs font-semibold border border-onedark-borderSubtle'
                    : 'bg-onedark-surface/35 text-onedark-muted hover:text-onedark-fgBright hover:bg-onedark-surface/60 border border-onedark-borderSubtle/50'
                }`}
              >
                <div className={`w-1.5 h-1.5 rounded-full ${s.isAlive ? 'bg-onedark-green animate-subagent-pulse' : 'bg-onedark-muted/50'}`} />
                {isDocker ? (
                  <Cpu className="w-3.5 h-3.5 text-onedark-cyan flex-shrink-0" />
                ) : (
                  <TerminalIcon className="w-3.5 h-3.5 text-onedark-accent flex-shrink-0" />
                )}
                <span className="truncate max-w-[130px] font-mono text-[11.5px]">{s.title}</span>
                <button
                  type="button"
                  onClick={(e) => handleKillSession(s.id, e)}
                  className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-onedark-darker/60 hover:text-onedark-red transition-all cursor-pointer ml-0.5"
                  title="Close Session"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}

          {/* New Session Button */}
          <button
            type="button"
            onClick={spawnNewSession}
            disabled={isLoadingSessions}
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg text-[11.5px] font-medium bg-onedark-surface/35 text-onedark-muted hover:text-onedark-fgBright hover:bg-onedark-surface/60 border border-onedark-borderSubtle/50 transition-colors cursor-pointer"
            title="Open New Terminal Shell"
          >
            <Plus className="w-3.5 h-3.5 text-onedark-muted hover:text-onedark-accent" />
            <span>New</span>
          </button>
        </div>

        {/* Right: Quick Action Chips & Controls */}
        <div className="flex items-center space-x-2 text-onedark-muted flex-shrink-0">
          {/* Quick-Action Command Chips */}
          <div className="hidden lg:flex items-center space-x-1 bg-onedark-surface/60 px-1.5 py-0.5 rounded-md border border-onedark-borderSubtle/60">
            <button
              type="button"
              onClick={() => handleQuickCommand('git status -sb')}
              className="px-2 py-0.5 rounded text-[10.5px] text-onedark-muted hover:text-onedark-accent hover:bg-onedark-surface transition-colors flex items-center space-x-1 cursor-pointer"
              title="Run 'git status -sb'"
            >
              <Zap className="w-3 h-3 text-onedark-accent" />
              <span>status</span>
            </button>
            <span className="text-onedark-borderSubtle">|</span>
            <button
              type="button"
              onClick={() => handleQuickCommand('pytest -v 2>/dev/null || npm test')}
              className="px-2 py-0.5 rounded text-[10.5px] text-onedark-muted hover:text-onedark-green hover:bg-onedark-surface transition-colors flex items-center space-x-1 cursor-pointer"
              title="Run tests (pytest or npm test)"
            >
              <Play className="w-3 h-3 text-onedark-green" />
              <span>test</span>
            </button>
            <span className="text-onedark-borderSubtle">|</span>
            <button
              type="button"
              onClick={() => handleQuickCommand('npm run build 2>/dev/null || cargo build 2>/dev/null || echo "No build script"')}
              className="px-2 py-0.5 rounded text-[10.5px] text-onedark-muted hover:text-onedark-purple hover:bg-onedark-surface transition-colors flex items-center space-x-1 cursor-pointer"
              title="Run build"
            >
              <Box className="w-3 h-3 text-onedark-purple" />
              <span>build</span>
            </button>
          </div>

          {/* Directory & Branch Indicators */}
          <div className="hidden sm:flex items-center space-x-1 text-[10.5px] text-onedark-muted bg-onedark-surface/60 px-2 py-0.5 rounded border border-onedark-borderSubtle/60 max-w-[140px] truncate" title={task.workspace_path}>
            <Folder className="w-3 h-3 flex-shrink-0 text-onedark-folder" />
            <span className="truncate">{task.workspace_path.split('/').pop() || 'workspace'}</span>
          </div>

          {task.git_branch && (
            <div className="hidden md:flex items-center space-x-1 text-[10.5px] text-onedark-muted bg-onedark-surface/60 px-2 py-0.5 rounded border border-onedark-borderSubtle/60">
              <GitBranch className="w-3 h-3 flex-shrink-0 text-onedark-accent" />
              <span className="truncate max-w-[100px]">{task.git_branch}</span>
            </div>
          )}

          {/* Utility Buttons */}
          <div className="flex items-center space-x-0.5">
            <button
              type="button"
              onClick={handleCopyScrollback}
              className="p-1.5 rounded hover:bg-onedark-surface hover:text-onedark-fg transition-colors cursor-pointer"
              title={hasCopied ? 'Copied scrollback!' : 'Copy Terminal Scrollback'}
            >
              {hasCopied ? <Check className="w-3.5 h-3.5 text-onedark-green" /> : <Copy className="w-3.5 h-3.5" />}
            </button>

            <button
              type="button"
              onClick={handleClearScreen}
              className="p-1.5 rounded hover:bg-onedark-surface hover:text-onedark-fg transition-colors cursor-pointer"
              title="Clear Terminal Screen (Ctrl+L)"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={handleRestartSession}
              className="p-1.5 rounded hover:bg-onedark-surface hover:text-onedark-fg transition-colors cursor-pointer"
              title="Restart Shell Session"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={loadSessions}
              className="p-1.5 rounded hover:bg-onedark-surface hover:text-onedark-fg transition-colors cursor-pointer"
              title="Refresh Sessions"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingSessions ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Terminal Viewport Canvas */}
      <div className={`flex-1 relative overflow-hidden ${isLightMode ? 'bg-[#fafafa]' : 'bg-[#181a1f]'}`}>
        {sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-onedark-muted space-y-3">
            <TerminalIcon className="w-8 h-8 opacity-40 animate-pulse text-onedark-accent" />
            <div className="text-xs">Initializing sandbox pseudo-terminal...</div>
            <button
              type="button"
              onClick={spawnNewSession}
              className="px-3 py-1.5 rounded-lg bg-onedark-surface hover:bg-onedark-surface/80 text-onedark-fgBright text-xs border border-onedark-borderSubtle/80 flex items-center space-x-1.5 transition-colors cursor-pointer shadow-xs"
            >
              <Plus className="w-3.5 h-3.5 text-onedark-accent" />
              <span>Spawn Terminal Shell</span>
            </button>
          </div>
        ) : (
          sessions.map((s) => (
            <div
              key={s.id}
              ref={(el) => {
                if (el) {
                  terminalContainersRef.current.set(s.id, el);
                  initTerminal(s.id, el);
                } else {
                  terminalContainersRef.current.delete(s.id);
                }
              }}
              className={`absolute inset-0 p-2.5 overflow-hidden transition-opacity duration-150 ${
                s.id === activeSessionId ? 'opacity-100 z-10 pointer-events-auto' : 'opacity-0 z-0 pointer-events-none'
              }`}
            />
          ))
        )}
      </div>

      {/* Bottom Telemetry Status Footer */}
      <div className="flex items-center justify-between px-3 py-1 bg-onedark-darker border-t border-onedark-borderSubtle/80 text-[10.5px] text-onedark-muted flex-shrink-0 font-mono">
        <div className="flex items-center space-x-2">
          <span className="flex items-center space-x-1">
            <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-onedark-green' : 'bg-onedark-red'}`} />
            <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
          </span>
          <span className="text-onedark-borderSubtle">|</span>
          <span>{activeCols} × {activeRows}</span>
          <span className="text-onedark-borderSubtle">|</span>
          <span>UTF-8</span>
        </div>

        <div className="flex items-center space-x-2">
          {activeSession?.runtimeMode === 'container' ? (
            <span className="flex items-center space-x-1 text-onedark-cyan" title={activeSession?.containerName || ''}>
              <Cpu className="w-3 h-3" />
              <span>Docker Sandbox ({activeSession.containerName?.slice(0, 18)}..)</span>
            </span>
          ) : (
            <span className="flex items-center space-x-1 text-onedark-accent">
              <Zap className="w-3 h-3" />
              <span>Host CoW Workspace</span>
            </span>
          )}
          {activeSession?.pid && (
            <>
              <span className="text-onedark-borderSubtle">|</span>
              <span>PID: {activeSession.pid}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
