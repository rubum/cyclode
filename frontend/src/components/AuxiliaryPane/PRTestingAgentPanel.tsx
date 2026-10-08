import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Sparkles,
  Bot,
  Play,
  RotateCw,
  Square,
  Send,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Terminal,
  ChevronDown,
  ChevronRight,
  Code,
  Check,
  Copy,
  Layers,
  Wrench,
  BrainCircuit,
  FileCode,
  ExternalLink,
  RotateCcw,
  Trash2
} from 'lucide-react';
import { MarkdownRenderer } from '../Common/MarkdownRenderer';
import { useWebSocket } from '../../contexts/WebSocketContext';

const API_BASE = import.meta.env.VITE_API_URL || '';

export interface PRTestingAgentPanelProps {
  taskId: string;
  prNumber: number;
  initialSubsessionId?: string | null;
  onReRunTests?: () => void;
  isTestRunning?: boolean;
  onActiveChange?: (isActive: boolean) => void;
  onLaunchAgent?: () => void;
  testStatus?: 'idle' | 'running' | 'passed' | 'failed';
  initialFailureOutput?: string;
  testCommand?: string;
}

interface MessageItem {
  id?: string;
  sender: 'user' | 'agent' | 'system';
  content: string;
  thought?: string;
  created_at?: string;
}

interface ToolLogItem {
  id?: string;
  call_id?: string;
  tool_name: string;
  tool_input?: any;
  tool_output?: string;
  exit_code?: number;
  duration_ms?: number;
  status?: 'running' | 'completed' | 'failed';
  started_at?: number;
}

interface PlanStep {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
}

interface PlanData {
  steps?: PlanStep[];
  markdown?: string;
}

export const PRTestingAgentPanel: React.FC<PRTestingAgentPanelProps> = ({
  taskId,
  prNumber,
  initialSubsessionId,
  onReRunTests,
  isTestRunning = false,
  onActiveChange,
  onLaunchAgent,
  testStatus,
  initialFailureOutput,
  testCommand
}) => {
  const { subscribe } = useWebSocket();
  const [subsessionId, setSubsessionId] = useState<string | null>(initialSubsessionId || null);
  const [status, setStatus] = useState<'idle' | 'running' | 'completed' | 'failed'>('idle');
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [toolLogs, setToolLogs] = useState<ToolLogItem[]>([]);
  const [plan, setPlan] = useState<PlanData | null>(null);
  const [showPlanDetails, setShowPlanDetails] = useState<boolean>(true);
  const [showFailureDetails, setShowFailureDetails] = useState<boolean>(false);
  const [activeThought, setActiveThought] = useState<string>('');
  const [activeTool, setActiveTool] = useState<{ call_id?: string; name: string; input: any } | null>(null);
  const [liveStream, setLiveStream] = useState<string>('');
  const [inputPrompt, setInputPrompt] = useState<string>('');
  const [isSendingMessage, setIsSendingMessage] = useState<boolean>(false);
  const [isResetting, setIsResetting] = useState<boolean>(false);
  const [expandedLogIds, setExpandedLogIds] = useState<Record<string, boolean>>({});
  const [copiedLogId, setCopiedLogId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const streamBufferRef = useRef<string>('');
  const rafIdRef = useRef<number | null>(null);

  // Clear live stream and tool log outputs locally
  const handleClearStream = useCallback(() => {
    setToolLogs([]);
    setMessages([]);
    setPlan(null);
    setActiveThought('');
    setActiveTool(null);
    setLiveStream('');
    streamBufferRef.current = '';
    setExpandedLogIds({});
  }, []);

  // Reset and archive backend remediation subsession to start completely fresh
  const handleResetSession = useCallback(async () => {
    if (!taskId || !prNumber || isResetting) return;
    setIsResetting(true);
    try {
      await fetch(`${API_BASE}/api/tasks/${taskId}/prs/${prNumber}/test/remediate`, {
        method: 'DELETE'
      });
      handleClearStream();
      setSubsessionId(null);
      setStatus('idle');
      if (onActiveChange) {
        onActiveChange(false);
      }
    } catch (e) {
      console.error('Failed to reset Testing Agent subsession:', e);
    } finally {
      setIsResetting(false);
    }
  }, [taskId, prNumber, isResetting, handleClearStream, onActiveChange]);

  // Launch or resume testing agent
  const handleLaunchOrResume = useCallback(async () => {
    if (!taskId || !prNumber) return;
    if (onLaunchAgent) {
      onLaunchAgent();
      return;
    }
    setStatus('running');
    try {
      const res = await fetch(`${API_BASE}/api/tasks/${taskId}/prs/${prNumber}/test/remediate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'agent' })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.subsession_task_id) {
          setSubsessionId(data.subsession_task_id);
        }
      }
    } catch (e) {
      console.error('Failed to dispatch testing agent:', e);
      setStatus('idle');
    }
  }, [taskId, prNumber, onLaunchAgent]);

  // Notify parent of active state changes
  useEffect(() => {
    if (onActiveChange) {
      onActiveChange(status === 'running');
    }
  }, [status, onActiveChange]);

  // 1. Fetch initial subsession state on mount and update state
  const fetchSubsession = useCallback(async () => {
    if (!taskId || !prNumber) return;
    try {
      const res = await fetch(`${API_BASE}/api/tasks/${taskId}/prs/${prNumber}/test/remediate`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.exists && data.subsession) {
        const sub = data.subsession;
        setSubsessionId(sub.id);
        if (sub.plan) {
          setPlan(sub.plan);
        }
        const s = sub.status;
        if (s === 'RUNNING' || s === 'INITIALIZING') {
          setStatus('running');
        } else if (s === 'COMPLETED' || s === 'IDLE') {
          setStatus('completed');
        } else if (s === 'FAILED') {
          setStatus('failed');
        } else {
          setStatus('idle');
        }

        if (Array.isArray(sub.messages) && sub.messages.length > 0) {
          setMessages(sub.messages);
        }
        if (Array.isArray(sub.logs) && sub.logs.length > 0) {
          const formattedLogs: ToolLogItem[] = sub.logs.map((l: any) => ({
            id: l.id || `log-${l.created_at}`,
            tool_name: l.tool_name,
            tool_input: l.tool_input,
            tool_output: l.tool_output,
            exit_code: l.exit_code,
            duration_ms: l.duration_ms,
            status: 'completed'
          }));
          setToolLogs(formattedLogs);

          // Auto-expand the latest tool log if present
          const latestId = formattedLogs[formattedLogs.length - 1].id;
          if (latestId) {
            setExpandedLogIds((prev) => ({ ...prev, [latestId]: true }));
          }
        }
      }
    } catch (e) {
      console.error('Failed to load PR testing agent subsession:', e);
    }
  }, [taskId, prNumber]);

  useEffect(() => {
    fetchSubsession();
  }, [fetchSubsession]);

  // Background polling while running to guarantee telemetry synchronization
  useEffect(() => {
    if (status !== 'running') return;
    const interval = setInterval(() => {
      fetchSubsession();
    }, 3500);
    return () => clearInterval(interval);
  }, [status, fetchSubsession]);

  // Update subsessionId if parent provides a new one
  useEffect(() => {
    if (initialSubsessionId && initialSubsessionId !== subsessionId) {
      setSubsessionId(initialSubsessionId);
      setStatus('running');
    }
  }, [initialSubsessionId, subsessionId]);

  // 2. Real-time WebSocket event listeners confined to this subsession
  useEffect(() => {
    if (!subsessionId) return;

    const unsubStart = subscribe('STREAM_START', (data: any) => {
      if (data?.task_id === subsessionId) {
        setStatus('running');
        streamBufferRef.current = '';
        setLiveStream('');
      }
    });

    const unsubChunk = subscribe('STREAM_CHUNK', (data: any) => {
      if (data?.task_id === subsessionId && data?.delta) {
        streamBufferRef.current += data.delta;
        if (!rafIdRef.current) {
          rafIdRef.current = requestAnimationFrame(() => {
            setLiveStream(streamBufferRef.current);
            rafIdRef.current = null;
          });
        }
      }
    });

    const unsubEnd = subscribe('STREAM_END', (data: any) => {
      if (data?.task_id === subsessionId) {
        const finalChunk = streamBufferRef.current;
        streamBufferRef.current = '';
        setLiveStream('');
        if (finalChunk.trim()) {
          setMessages((prev) => [
            ...prev,
            { sender: 'agent', content: finalChunk, created_at: new Date().toISOString() }
          ]);
        }
      }
    });

    const unsubThought = subscribe('AGENT_THOUGHT', (data: any) => {
      if (data?.task_id === subsessionId && data?.thought) {
        setActiveThought(data.thought);
      }
    });

    // Handle tool execution start
    const handleToolStart = (data: any) => {
      if (data?.task_id === subsessionId) {
        const callId = data.call_id || `tool-${Date.now()}`;
        setActiveTool({ call_id: callId, name: data.tool_name || 'tool', input: data.tool_input });
        setToolLogs((prev) => {
          if (prev.some((l) => l.call_id === callId)) return prev;
          const newLog: ToolLogItem = {
            id: callId,
            call_id: callId,
            tool_name: data.tool_name || 'tool',
            tool_input: data.tool_input,
            status: 'running',
            started_at: Date.now()
          };
          // Auto-expand active running tool
          setExpandedLogIds((e) => ({ ...e, [callId]: true }));
          return [...prev, newLog];
        });
      }
    };

    // Handle tool execution end / output
    const handleToolEnd = (data: any) => {
      if (data?.task_id === subsessionId) {
        setActiveTool(null);
        setToolLogs((prev) => {
          const callId = data.call_id;
          const matchIdx = prev.findIndex(
            (l) => (callId && (l.call_id === callId || l.id === callId)) || (l.tool_name === data.tool_name && l.status === 'running')
          );
          const logEntry: ToolLogItem = {
            id: data.id || callId || `log-${Date.now()}`,
            call_id: callId,
            tool_name: data.tool_name || 'tool',
            tool_input: data.tool_input,
            tool_output: data.tool_output || data.result,
            exit_code: data.exit_code,
            duration_ms: data.duration_ms,
            status: 'completed'
          };
          if (matchIdx !== -1) {
            const updated = [...prev];
            updated[matchIdx] = { ...updated[matchIdx], ...logEntry };
            return updated;
          }
          return [...prev, logEntry];
        });
        if (data.id) {
          setExpandedLogIds((e) => ({ ...e, [data.id]: true }));
        }
      }
    };

    const unsubToolStart1 = subscribe('TOOL_START', handleToolStart);
    const unsubToolStart2 = subscribe('TOOL_EXECUTION_START', handleToolStart);
    const unsubToolEnd1 = subscribe('TOOL_END', handleToolEnd);
    const unsubToolEnd2 = subscribe('TOOL_EXECUTION_RESULT', handleToolEnd);

    const unsubStatus = subscribe('TASK_STATUS_CHANGE', (data: any) => {
      if (data?.task_id === subsessionId) {
        const s = data.status;
        if (s === 'RUNNING' || s === 'INITIALIZING') {
          setStatus('running');
        } else if (s === 'COMPLETED' || s === 'IDLE') {
          setStatus('completed');
          setActiveTool(null);
        } else if (s === 'FAILED' || s === 'ERROR') {
          setStatus('failed');
          setActiveTool(null);
        }
      }
    });

    const unsubChat = subscribe('CHAT_MESSAGE', (data: any) => {
      if (data?.task_id === subsessionId) {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.content === data.content && last.sender === data.sender) {
            return prev;
          }
          return [
            ...prev,
            {
              sender: data.sender || 'agent',
              content: data.content || '',
              thought: data.thought,
              created_at: data.timestamp || new Date().toISOString()
            }
          ];
        });
      }
    });

    const unsubPlan = subscribe('TASK_PLAN_UPDATED', (data: any) => {
      if (data?.task_id === subsessionId && data?.plan) {
        setPlan(data.plan);
      }
    });

    const unsubRemediateReset = subscribe('TASK_PR_TEST_REMEDIATION_RESET', (data: any) => {
      if (Number(data?.pr_number) === Number(prNumber)) {
        handleClearStream();
        setSubsessionId(null);
        setStatus('idle');
      }
    });

    return () => {
      unsubStart();
      unsubChunk();
      unsubEnd();
      unsubThought();
      unsubToolStart1();
      unsubToolStart2();
      unsubToolEnd1();
      unsubToolEnd2();
      unsubStatus();
      unsubChat();
      unsubPlan();
      unsubRemediateReset();
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    };
  }, [subsessionId, subscribe, prNumber, handleClearStream]);

  // Synchronize new subsession spawned for this PR
  useEffect(() => {
    if (!taskId || !prNumber) return;

    const unsubCreated = subscribe('TASK_CREATED', (data: any) => {
      if (
        data?.is_subsession &&
        data?.parent_task_id === taskId &&
        data?.session_key &&
        data.session_key.endsWith(`:pr:${prNumber}`)
      ) {
        setSubsessionId(data.id);
        setStatus('running');
      }
    });

    return () => {
      unsubCreated();
    };
  }, [taskId, prNumber, subscribe]);

  // Auto-scroll to bottom of chat on new chunks/messages/tools
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, liveStream, activeThought, activeTool, toolLogs]);

  // Send follow-up prompt
  const handleSendMessage = async () => {
    const text = inputPrompt.trim();
    if (!text || isSendingMessage || !taskId || !prNumber) return;

    setIsSendingMessage(true);
    setInputPrompt('');

    // Optimistically add user message
    setMessages((prev) => [
      ...prev,
      { sender: 'user', content: text, created_at: new Date().toISOString() }
    ]);
    setStatus('running');

    try {
      const res = await fetch(`${API_BASE}/api/tasks/${taskId}/prs/${prNumber}/test/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error('Failed to deliver message to testing agent:', err);
      }
    } catch (e) {
      console.error('Error sending message to testing agent:', e);
    } finally {
      setIsSendingMessage(false);
    }
  };

  // Cancel subsession
  const handleCancel = async () => {
    if (!taskId || !prNumber) return;
    try {
      await fetch(`${API_BASE}/api/tasks/${taskId}/prs/${prNumber}/test/cancel`, {
        method: 'POST'
      });
      setStatus('idle');
      setActiveTool(null);
    } catch (e) {
      console.error('Failed to cancel testing agent:', e);
    }
  };

  const handleCopyLog = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedLogId(id);
    setTimeout(() => setCopiedLogId(null), 2000);
  };

  const toggleLogExpand = (logId: string) => {
    setExpandedLogIds((prev) => ({
      ...prev,
      [logId]: !prev[logId]
    }));
  };

  return (
    <div className="rounded-xl border border-onedark-border bg-onedark-bg shadow-sm overflow-hidden flex flex-col animate-fadeIn">
      {/* 1. Header bar */}
      <div className="flex items-center justify-between px-3.5 py-2.5 bg-onedark-surface/80 border-b border-onedark-borderSubtle">
        <div className="flex items-center space-x-2.5 min-w-0">
          <div className="p-1.5 rounded-lg bg-onedark-accent/15 text-onedark-accent border border-onedark-accent/30 flex-shrink-0">
            <Sparkles className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center space-x-2">
              <span className="font-semibold text-xs text-onedark-fgBright">
                Testing Agent (Autonomous Remediator)
              </span>
              {status === 'running' ? (
                <span className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-onedark-accent/20 border border-onedark-accent/30 text-onedark-accent text-[10px] font-semibold animate-pulse">
                  <Loader2 className="w-2.5 h-2.5 animate-spin" />
                  <span>Diagnosing & Patching</span>
                </span>
              ) : status === 'completed' ? (
                <span className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-onedark-green/20 border border-onedark-green/30 text-onedark-green text-[10px] font-semibold">
                  <CheckCircle2 className="w-2.5 h-2.5" />
                  <span>Resolution Complete</span>
                </span>
              ) : status === 'failed' ? (
                <span className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-onedark-red/20 border border-onedark-red/30 text-onedark-red text-[10px] font-semibold">
                  <AlertCircle className="w-2.5 h-2.5" />
                  <span>Halted</span>
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full bg-onedark-surface border border-onedark-borderSubtle text-onedark-muted text-[10px]">
                  Idle
                </span>
              )}
            </div>
            <p className="text-[10.5px] text-onedark-muted truncate mt-0.5">
              Target worktree: <code className="font-mono text-onedark-fg">prs/pr-{prNumber}</code> · Live tool execution stream
            </p>
          </div>
        </div>

        {/* Header Actions */}
        <div className="flex items-center space-x-2 flex-shrink-0">
          {toolLogs.length > 0 && (
            <div className="flex items-center space-x-1 px-2 py-1 rounded-md bg-onedark-surface border border-onedark-borderSubtle text-onedark-fg text-[11px] font-mono">
              <Wrench className="w-3 h-3 text-onedark-accent" />
              <span>{toolLogs.length} tools executed</span>
            </div>
          )}

          {(toolLogs.length > 0 || messages.length > 0) && (
            <button
              type="button"
              onClick={handleClearStream}
              className="flex items-center space-x-1 px-2.5 py-1 rounded-md bg-onedark-surface hover:bg-onedark-darker border border-onedark-borderSubtle text-onedark-muted hover:text-onedark-red text-[11px] font-medium transition-all cursor-pointer shadow-xs active:scale-95"
              title="Clear current stream and message output from viewport"
            >
              <Trash2 className="w-3 h-3 text-onedark-muted hover:text-onedark-red transition-colors" />
              <span>Clear Feed</span>
            </button>
          )}

          {subsessionId && status !== 'running' && (
            <button
              type="button"
              onClick={handleResetSession}
              disabled={isResetting}
              className="flex items-center space-x-1 px-2.5 py-1 rounded-md bg-onedark-surface hover:bg-onedark-darker border border-onedark-borderSubtle text-onedark-muted hover:text-onedark-yellow text-[11px] font-medium transition-all cursor-pointer disabled:opacity-50 shadow-xs active:scale-95"
              title="Reset and archive current remediation session to start fresh"
            >
              {isResetting ? (
                <Loader2 className="w-3 h-3 animate-spin text-onedark-accent" />
              ) : (
                <RotateCcw className="w-3 h-3 text-onedark-yellow" />
              )}
              <span>New Session</span>
            </button>
          )}

          {status === 'running' ? (
            <button
              type="button"
              onClick={handleCancel}
              className="flex items-center space-x-1 px-2.5 py-1 rounded-md bg-onedark-red/15 hover:bg-onedark-red/25 border border-onedark-red/30 text-onedark-red text-[11px] font-semibold transition-all cursor-pointer shadow-xs active:scale-95"
              title="Stop agent run"
            >
              <Square className="w-3 h-3 fill-current" />
              <span>Stop</span>
            </button>
          ) : (!subsessionId || toolLogs.length === 0) ? (
            <button
              type="button"
              onClick={handleLaunchOrResume}
              className="flex items-center space-x-1.5 px-3 py-1 rounded-md bg-onedark-accent hover:bg-onedark-accent/90 text-white text-[11px] font-semibold transition-all cursor-pointer shadow-xs active:scale-95"
              title="Dispatch autonomous testing agent to diagnose and fix test failures"
            >
              <Sparkles className="w-3 h-3" />
              <span>Start Remediation</span>
            </button>
          ) : null}
        </div>
      </div>

      {/* 2. Messages & Live Tool Execution Viewport */}
      <div className="p-4 space-y-3.5 max-h-[520px] overflow-y-auto font-sans text-xs">
        {/* Collapsible Failing Test Context Drawer */}
        {initialFailureOutput && (
          <div className="rounded-xl border border-onedark-red/25 bg-onedark-red/10 overflow-hidden shadow-xs font-sans text-xs mb-3 animate-fadeIn">
            <div
              onClick={() => setShowFailureDetails((prev) => !prev)}
              className="flex items-center justify-between px-3.5 py-2 cursor-pointer select-none hover:bg-onedark-red/15 transition-colors"
            >
              <div className="flex items-center space-x-2">
                <AlertCircle className="w-3.5 h-3.5 text-onedark-red flex-shrink-0" />
                <span className="font-semibold text-onedark-fgBright text-[11.5px]">
                  Failing Test Suite Output {testCommand ? `(${testCommand})` : ''}
                </span>
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-onedark-red/20 text-onedark-red font-mono font-medium">
                  {initialFailureOutput.split('\n').length} lines
                </span>
              </div>
              <div className="flex items-center space-x-1 text-onedark-muted text-[10.5px]">
                <span>{showFailureDetails ? 'Hide' : 'View Trace'}</span>
                {showFailureDetails ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              </div>
            </div>
            {showFailureDetails && (
              <pre className="p-3 bg-onedark-darker text-onedark-fgBright font-mono text-[11px] leading-relaxed border-t border-onedark-borderSubtle whitespace-pre-wrap max-h-48 overflow-y-auto selection:bg-onedark-accent/30 select-text">
                {initialFailureOutput}
              </pre>
            )}
          </div>
        )}
        {/* Empty / Initializing / Ready State */}
        {messages.length === 0 && toolLogs.length === 0 && !liveStream && !activeThought && !activeTool && (!plan || !plan.steps || plan.steps.length === 0) && (
          <div className="py-8 text-center space-y-3 select-none">
            {status === 'running' ? (
              <>
                <Loader2 className="w-8 h-8 text-onedark-accent mx-auto animate-spin" />
                <div className="space-y-1">
                  <p className="text-onedark-fgBright font-semibold text-xs">
                    Testing Agent is analyzing failure output and formulating remediation plan...
                  </p>
                  <p className="text-onedark-muted text-[11px]">
                    Live diagnostics, tool executions, and step progress will appear here.
                  </p>
                </div>
              </>
            ) : (
              <>
                <Bot className="w-8 h-8 text-onedark-muted mx-auto opacity-50" />
                <div className="space-y-1">
                  <p className="text-onedark-fgBright font-semibold text-xs">
                    Autonomous Testing Agent Ready
                  </p>
                  <p className="text-onedark-muted text-[11.5px] max-w-sm mx-auto leading-relaxed">
                    Investigates test failures, restores missing dependencies, and patches code or tests directly inside the isolated PR sandbox.
                  </p>
                </div>
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={handleLaunchOrResume}
                    className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg bg-onedark-accent hover:bg-onedark-accent/90 text-white text-xs font-semibold shadow-xs transition-all cursor-pointer active:scale-95"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Start Autonomous Remediation</span>
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Dynamic Remediation Plan Stepper */}
        {plan && Array.isArray(plan.steps) && plan.steps.length > 0 && (
          <div className="rounded-xl border border-onedark-border bg-onedark-darker/60 overflow-hidden shadow-xs font-sans text-xs mb-3 animate-fadeIn">
            <div
              onClick={() => setShowPlanDetails((p) => !p)}
              className="flex items-center justify-between px-3.5 py-2 bg-onedark-surface/60 border-b border-onedark-borderSubtle cursor-pointer select-none hover:bg-onedark-surface/80 transition-colors"
            >
              <div className="flex items-center space-x-2">
                <BrainCircuit className="w-3.5 h-3.5 text-onedark-accent" />
                <span className="font-semibold text-onedark-fgBright text-[11.5px]">
                  Remediation Execution Plan
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-onedark-surface text-onedark-muted font-mono">
                  {plan.steps.filter((s) => s.status === 'completed').length}/{plan.steps.length} steps
                </span>
              </div>
              <div className="flex items-center space-x-1.5 text-onedark-muted text-[10.5px]">
                <span>{showPlanDetails ? 'Collapse' : 'Expand'}</span>
                {showPlanDetails ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              </div>
            </div>

            {showPlanDetails && (
              <div className="p-3 space-y-2 bg-onedark-darker/40">
                {plan.steps.map((step, sIdx) => {
                  const isDone = step.status === 'completed';
                  const isInProgress = step.status === 'in_progress';
                  return (
                    <div
                      key={step.id || `step-${sIdx}`}
                      className={`flex items-start space-x-2.5 p-2 rounded-lg text-[11.5px] leading-snug transition-colors ${
                        isInProgress
                          ? 'bg-onedark-accent/10 border border-onedark-accent/25 text-onedark-fgBright'
                          : isDone
                          ? 'text-onedark-muted line-through opacity-75'
                          : 'text-onedark-muted'
                      }`}
                    >
                      <div className="mt-0.5 flex-shrink-0">
                        {isDone ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-onedark-green" />
                        ) : isInProgress ? (
                          <Loader2 className="w-3.5 h-3.5 text-onedark-accent animate-spin" />
                        ) : (
                          <div className="w-3.5 h-3.5 rounded-full border border-onedark-border flex items-center justify-center text-[9px] font-mono text-onedark-muted">
                            {sIdx + 1}
                          </div>
                        )}
                      </div>
                      <div className="flex-1 font-mono text-[11px]">{step.title}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Message history */}
        {messages.map((m, idx) => (
          <div
            key={m.id || `msg-${idx}`}
            className={`flex flex-col space-y-1.5 ${
              m.sender === 'user' ? 'items-end' : 'items-start'
            }`}
          >
            <div className="flex items-center space-x-1.5 text-[10px] text-onedark-muted px-1 select-none">
              {m.sender === 'user' ? (
                <span className="font-semibold text-onedark-fgBright">You</span>
              ) : (
                <div className="flex items-center space-x-1 text-onedark-accent font-semibold">
                  <Bot className="w-3 h-3" />
                  <span>Testing Agent</span>
                </div>
              )}
            </div>

            {m.thought && (
              <div className="max-w-[95%] p-2.5 rounded-lg bg-onedark-purple/10 border border-onedark-purple/20 text-onedark-purple text-[11px] leading-relaxed flex items-start space-x-2">
                <BrainCircuit className="w-3.5 h-3.5 text-onedark-purple shrink-0 mt-0.5" />
                <div className="italic">{m.thought}</div>
              </div>
            )}

            <div
              className={`max-w-[95%] p-3.5 rounded-xl border leading-relaxed text-[12.5px] ${
                m.sender === 'user'
                  ? 'bg-onedark-accent/15 border-onedark-accent/30 text-onedark-fgBright'
                  : 'bg-onedark-surface/40 border-onedark-borderSubtle text-onedark-fg'
              }`}
            >
              <MarkdownRenderer content={m.content} />
            </div>
          </div>
        ))}

        {/* Live Thought Bubble */}
        {status === 'running' && activeThought && (
          <div className="p-3 rounded-xl bg-onedark-purple/10 border border-onedark-purple/25 text-onedark-purple text-[11.5px] flex items-start space-x-2.5 animate-fadeIn">
            <BrainCircuit className="w-4 h-4 text-onedark-purple shrink-0 mt-0.5 animate-pulse" />
            <div className="space-y-0.5">
              <span className="font-bold text-[10px] uppercase tracking-wider block opacity-75">
                Agent Thought
              </span>
              <p className="italic leading-relaxed">{activeThought}</p>
            </div>
          </div>
        )}

        {/* INLINE TOOL EXECUTION LOGS & TERMINAL OUTPUT */}
        {toolLogs.length > 0 && (
          <div className="space-y-2.5 pt-1">
            <div className="flex items-center justify-between text-[10.5px] font-mono text-onedark-muted px-1 select-none">
              <span className="uppercase tracking-wider font-semibold flex items-center space-x-1.5">
                <Terminal className="w-3 h-3 text-onedark-accent" />
                <span>Tool Execution Stream ({toolLogs.length})</span>
              </span>
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={handleClearStream}
                  className="hover:text-onedark-fg text-onedark-muted transition-colors flex items-center space-x-1 cursor-pointer"
                  title="Clear tool logs from viewport"
                >
                  <Trash2 className="w-2.5 h-2.5 text-onedark-muted hover:text-onedark-red transition-colors" />
                  <span>Clear Stream</span>
                </button>
                <span>·</span>
                <span>Live Workspace Telemetry</span>
              </div>
            </div>

            {toolLogs.map((log, idx) => {
              const logKey = log.id || log.call_id || `tool-${idx}`;
              const isExpanded = expandedLogIds[logKey] !== false; // Default expanded so user sees output
              const cmdText =
                typeof log.tool_input === 'string'
                  ? log.tool_input
                  : log.tool_input?.command || log.tool_input?.file_path || log.tool_input?.path || JSON.stringify(log.tool_input || '');

              return (
                <div
                  key={logKey}
                  className="rounded-xl border border-onedark-border bg-onedark-darker overflow-hidden shadow-xs font-mono text-xs animate-fadeIn"
                >
                  {/* Tool Header Bar */}
                  <div
                    onClick={() => toggleLogExpand(logKey)}
                    className="flex items-center justify-between px-3 py-2 bg-onedark-surface/60 border-b border-onedark-borderSubtle cursor-pointer select-none hover:bg-onedark-surface/80 transition-colors"
                  >
                    <div className="flex items-center space-x-2 min-w-0">
                      <span className="px-1.5 py-0.5 rounded bg-onedark-accent/15 text-onedark-accent font-semibold text-[10.5px] shrink-0">
                        {log.tool_name}
                      </span>
                      <span className="text-onedark-fgBright text-[11px] truncate max-w-md sm:max-w-xl font-medium">
                        $ {cmdText}
                      </span>
                    </div>

                    <div className="flex items-center space-x-2.5 shrink-0 text-[10.5px]">
                      {log.status === 'running' ? (
                        <span className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-onedark-accent/20 border border-onedark-accent/30 text-onedark-accent font-semibold text-[10px] animate-pulse">
                          <Loader2 className="w-2.5 h-2.5 animate-spin" />
                          <span>Running</span>
                        </span>
                      ) : (
                        <>
                          {log.duration_ms !== undefined && (
                            <span className="text-onedark-muted font-mono">
                              {(log.duration_ms / 1000).toFixed(2)}s
                            </span>
                          )}
                          {log.exit_code !== undefined && (
                            <span
                              className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                                log.exit_code === 0
                                  ? 'bg-onedark-green/20 text-onedark-green border border-onedark-green/30'
                                  : 'bg-onedark-red/20 text-onedark-red border border-onedark-red/30'
                              }`}
                            >
                              exit {log.exit_code}
                            </span>
                          )}
                        </>
                      )}
                      {isExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5 text-onedark-muted" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-onedark-muted" />
                      )}
                    </div>
                  </div>

                  {/* Terminal Console Output */}
                  {isExpanded && (
                    <div className="p-3 bg-[#181a1f] space-y-1.5 relative group">
                      {log.tool_output ? (
                        <>
                          <div className="flex items-center justify-between text-[10px] text-onedark-muted border-b border-onedark-borderSubtle/60 pb-1 mb-1">
                            <span className="text-onedark-muted/80">
                              {(log.tool_output || '').split('\n').length} lines
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCopyLog(logKey, log.tool_output || '');
                              }}
                              className="flex items-center space-x-1 px-1.5 py-0.5 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg transition-colors"
                            >
                              {copiedLogId === logKey ? (
                                <>
                                  <Check className="w-2.5 h-2.5 text-onedark-green" />
                                  <span className="text-onedark-green">Copied</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-2.5 h-2.5" />
                                  <span>Copy Output</span>
                                </>
                              )}
                            </button>
                          </div>
                          <pre className="text-onedark-fgBright text-[11px] leading-relaxed max-h-60 overflow-y-auto whitespace-pre-wrap select-text selection:bg-onedark-accent/30 font-mono">
                            {log.tool_output}
                          </pre>
                        </>
                      ) : log.status === 'running' ? (
                        <div className="flex items-center space-x-2 py-3 text-onedark-muted text-[11px]">
                          <Loader2 className="w-3.5 h-3.5 text-onedark-accent animate-spin" />
                          <span>Executing command inside PR worktree container...</span>
                        </div>
                      ) : (
                        <div className="py-2 text-onedark-muted/60 text-[10.5px] italic">
                          (No output returned)
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Live Stream Markdown */}
        {liveStream && (
          <div className="flex flex-col items-start space-y-1.5 animate-fadeIn">
            <div className="flex items-center space-x-1 text-onedark-accent font-semibold text-[10px] px-1 select-none">
              <Bot className="w-3 h-3" />
              <span>Testing Agent (generating...)</span>
            </div>
            <div className="max-w-[95%] p-3.5 rounded-xl border border-onedark-borderSubtle bg-onedark-surface/40 text-onedark-fg text-[12.5px] leading-relaxed">
              <MarkdownRenderer content={liveStream} />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 3. Follow-up Chat Input Bar */}
      <div className="p-3 bg-onedark-surface/60 border-t border-onedark-borderSubtle">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          className="flex items-center space-x-2"
        >
          <input
            type="text"
            value={inputPrompt}
            onChange={(e) => setInputPrompt(e.target.value)}
            disabled={isSendingMessage}
            placeholder={
              status === 'running'
                ? 'Send follow-up instruction or hint to Testing Agent...'
                : 'Ask Testing Agent to explain changes or investigate further...'
            }
            className="flex-1 px-3 py-1.5 bg-onedark-darker border border-onedark-borderSubtle focus:border-onedark-accent rounded-lg text-xs text-onedark-fgBright placeholder:text-onedark-muted/60 outline-none transition-all"
          />
          <button
            type="submit"
            disabled={!inputPrompt.trim() || isSendingMessage}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-onedark-accent hover:bg-onedark-accent/90 text-white text-xs font-semibold transition-all cursor-pointer disabled:opacity-40 active:scale-95 shadow-xs"
          >
            {isSendingMessage ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
            <span>Send</span>
          </button>
        </form>
      </div>
    </div>
  );
};
