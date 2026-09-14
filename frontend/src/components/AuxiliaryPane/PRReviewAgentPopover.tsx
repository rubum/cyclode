import React, { useState, useEffect, useRef } from 'react';
import { 
  Bot, 
  Send, 
  Square, 
  X, 
  Sparkles, 
  ShieldCheck, 
  Bug, 
  TestTube, 
  ExternalLink, 
  Copy, 
  Check, 
  ChevronDown, 
  ChevronUp, 
  Flame, 
  Loader2,
  Code2,
  FileCode2,
  CheckCircle2,
  MessageSquarePlus,
  RefreshCw
} from 'lucide-react';
import { MarkdownRenderer } from '../Common/MarkdownRenderer';
import { useWebSocket } from '../../context/WebSocketContext';
import { Task, TaskMessage } from '../../types';

export interface LineContext {
  filename: string;
  line: number;
  content: string;
}

interface PRReviewAgentPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  repoName: string;
  prNumber: number;
  prTitle: string;
  author?: string;
  headBranch?: string;
  baseBranch?: string;
  activeLineComment?: LineContext | null;
  onClearActiveLineComment?: () => void;
  onNavigateToFileLine?: (filename: string, line: number) => void;
}

const API_BASE = '/api';

export const PRReviewAgentPopover: React.FC<PRReviewAgentPopoverProps> = ({
  isOpen,
  onClose,
  repoName,
  prNumber,
  prTitle,
  author,
  headBranch,
  baseBranch,
  activeLineComment,
  onClearActiveLineComment,
  onNavigateToFileLine
}) => {
  const [taskId, setTaskId] = useState<string | null>(null);
  const [messages, setMessages] = useState<TaskMessage[]>([]);
  const [inputPrompt, setInputPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [showThoughts, setShowThoughts] = useState<Record<string, boolean>>({});
  const [isExpanded, setIsExpanded] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [attachedContext, setAttachedContext] = useState<LineContext | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { subscribe } = useWebSocket();

  // Synchronize attached line context from props
  useEffect(() => {
    if (activeLineComment) {
      setAttachedContext(activeLineComment);
      if (inputRef.current) {
        inputRef.current.focus();
      }
    }
  }, [activeLineComment]);

  // Scroll to bottom when new messages or chunks arrive
  const scrollToBottom = () => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  // Subscribe to WebSocket streaming events for active review task
  useEffect(() => {
    if (!taskId) return;

    const unsubStreamStart = subscribe('STREAM_START', (data: any) => {
      if (data.task_id === taskId) {
        setIsLoading(true);
        setMessages(prev => {
          const existingIdx = prev.findIndex(m => m.id === data.stream_id);
          if (existingIdx >= 0) {
            return prev.map((m, idx) => idx === existingIdx ? { ...m, isStreaming: true } : m);
          }
          return [
            ...prev,
            {
              id: data.stream_id,
              task_id: taskId,
              sender: 'agent',
              content: '',
              thought: data.stream_type === 'thought' ? '' : undefined,
              isStreaming: true,
              created_at: data.timestamp || new Date().toISOString()
            }
          ];
        });
      }
    });

    const unsubStreamChunk = subscribe('STREAM_CHUNK', (data: any) => {
      if (data.task_id === taskId) {
        setMessages(prev => {
          return prev.map(m => {
            if (m.id === data.stream_id) {
              return {
                ...m,
                content: data.stream_type === 'message' ? data.accumulated : m.content,
                thought: data.stream_type === 'thought' ? data.accumulated : m.thought,
                isStreaming: true
              };
            }
            return m;
          });
        });
      }
    });

    const unsubStreamEnd = subscribe('STREAM_END', (data: any) => {
      if (data.task_id === taskId) {
        setIsLoading(false);
        setMessages(prev => {
          return prev.map(m => {
            if (m.id === data.stream_id) {
              return {
                ...m,
                content: data.stream_type === 'message' ? data.final_content : m.content,
                thought: data.stream_type === 'thought' ? data.final_content : m.thought,
                isStreaming: false
              };
            }
            return m;
          });
        });
      }
    });

    const unsubStatus = subscribe('TASK_STATUS_CHANGE', (data: any) => {
      if (data.task_id === taskId && ['COMPLETED', 'FAILED', 'IDLE', 'CANCELLED'].includes(data.status)) {
        setIsLoading(false);
      }
    });

    return () => {
      unsubStreamStart();
      unsubStreamChunk();
      unsubStreamEnd();
      unsubStatus();
    };
  }, [taskId, subscribe]);

  // Initialize or spawn a dedicated Reviewer task session on demand
  const ensureReviewTask = async (): Promise<string> => {
    if (taskId) return taskId;

    setIsInitializing(true);
    try {
      const res = await fetch(`${API_BASE}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `Code Review: ${repoName} #${prNumber} - ${prTitle}`,
          description: `Interactive Code Review session for ${repoName} Pull Request #${prNumber} (${prTitle}). Head: ${headBranch || 'unknown'}, Base: ${baseBranch || 'main'}, Author: @${author || 'unknown'}.`,
          persona: 'CodeReviewer'
        })
      });

      if (res.ok) {
        const data = await res.json();
        const newTaskId = data.task_id;
        setTaskId(newTaskId);
        setIsInitializing(false);
        return newTaskId;
      }
      throw new Error('Failed to spawn review session');
    } catch (e) {
      setIsInitializing(false);
      throw e;
    }
  };

  const handleSendMessage = async (customPrompt?: string) => {
    const rawText = customPrompt || inputPrompt;
    if (!rawText.trim() && !attachedContext) return;

    let finalPrompt = rawText.trim();
    if (attachedContext) {
      finalPrompt = `**Regarding line in** \`${attachedContext.filename}\` (line ${attachedContext.line}):\n\`\`\`\n${attachedContext.content}\n\`\`\`\n\n${finalPrompt || 'Please review and analyze this change.'}`;
    }

    // Reset input states
    setInputPrompt('');
    setAttachedContext(null);
    onClearActiveLineComment?.();

    // Optimistic user message
    const userMsgId = `user-${Date.now()}`;
    const newMsg: TaskMessage = {
      id: userMsgId,
      task_id: taskId || 'pending',
      sender: 'user',
      content: finalPrompt,
      created_at: new Date().toISOString()
    };
    setMessages(prev => [...prev, newMsg]);
    setIsLoading(true);

    try {
      const activeId = await ensureReviewTask();
      await fetch(`${API_BASE}/tasks/${activeId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: finalPrompt })
      });
    } catch (err) {
      console.error('Error dispatching reviewer message:', err);
      setIsLoading(false);
      setMessages(prev => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          task_id: taskId || 'err',
          sender: 'system',
          content: `⚠️ Failed to send message to reviewer agent. Please check connectivity.`,
          created_at: new Date().toISOString()
        }
      ]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleCopyMessage = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const toggleThought = (msgId: string) => {
    setShowThoughts(prev => ({ ...prev, [msgId]: !prev[msgId] }));
  };

  if (!isOpen) return null;

  return (
    <div 
      className={`fixed z-50 flex flex-col bg-onedark-darker border border-onedark-border shadow-2xl rounded-2xl overflow-hidden transition-all duration-200 animate-in fade-in slide-in-from-bottom-3 ${
        isExpanded 
          ? 'bottom-4 right-4 w-[760px] max-w-[95vw] h-[85vh]' 
          : 'bottom-4 right-4 w-[480px] max-w-[92vw] h-[640px] max-h-[85vh]'
      }`}
    >
      {/* Header Bar */}
      <div className="flex items-center justify-between px-3.5 py-2.5 bg-onedark-surface/90 border-b border-onedark-border select-none flex-shrink-0">
        <div className="flex items-center space-x-2 truncate">
          <div className="w-6 h-6 rounded-lg bg-onedark-accent/20 border border-onedark-accent/40 flex items-center justify-center text-onedark-accent flex-shrink-0">
            <Bot className="w-3.5 h-3.5" />
          </div>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center space-x-1.5">
              <span className="font-semibold text-xs text-onedark-fgBright font-sans">PR Reviewer Agent</span>
              <span className="px-1.5 py-0.2 rounded-full bg-onedark-accent/15 border border-onedark-accent/30 text-[10px] font-mono font-bold text-onedark-accent">
                #{prNumber}
              </span>
            </div>
            <span className="text-[10.5px] text-onedark-muted truncate font-mono" title={`${repoName} - ${prTitle}`}>
              {repoName}
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-1 flex-shrink-0">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 rounded hover:bg-onedark-bg text-onedark-muted hover:text-onedark-fg transition-colors"
            title={isExpanded ? "Collapse to standard size" : "Expand reviewer window"}
          >
            {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-onedark-bg text-onedark-muted hover:text-onedark-red transition-colors"
            title="Close review popover"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Quick Action Chips Bar */}
      <div className="px-3 py-1.5 bg-onedark-surface/40 border-b border-onedark-borderSubtle flex items-center space-x-1.5 overflow-x-auto select-none no-scrollbar flex-shrink-0 text-[11px]">
        <button
          onClick={() => handleSendMessage(`Perform a comprehensive Security & Vulnerability audit on PR #${prNumber}. Look for injection risks, unhandled auth edge-cases, and leaked secrets.`)}
          disabled={isLoading || isInitializing}
          className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-onedark-bg hover:bg-onedark-surface border border-onedark-borderSubtle text-onedark-fg hover:text-onedark-fgBright transition-colors whitespace-nowrap cursor-pointer"
        >
          <ShieldCheck className="w-3 h-3 text-onedark-green" />
          <span>Security Audit</span>
        </button>

        <button
          onClick={() => handleSendMessage(`Scan PR #${prNumber} for edge-cases, null/undefined dereferences, race conditions, and performance regressions.`)}
          disabled={isLoading || isInitializing}
          className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-onedark-bg hover:bg-onedark-surface border border-onedark-borderSubtle text-onedark-fg hover:text-onedark-fgBright transition-colors whitespace-nowrap cursor-pointer"
        >
          <Bug className="w-3 h-3 text-onedark-yellow" />
          <span>Bug Scan</span>
        </button>

        <button
          onClick={() => handleSendMessage(`Run the automated test suite in the sandbox workspace to verify whether the changes in PR #${prNumber} pass.`)}
          disabled={isLoading || isInitializing}
          className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-onedark-bg hover:bg-onedark-surface border border-onedark-borderSubtle text-onedark-fg hover:text-onedark-fgBright transition-colors whitespace-nowrap cursor-pointer"
        >
          <TestTube className="w-3 h-3 text-onedark-purple" />
          <span>Run Tests</span>
        </button>

        <button
          onClick={() => handleSendMessage(`Generate a structured GitHub Pull Request review summary with key findings, code recommendations, and submit the review comment to the GitHub repository.`)}
          disabled={isLoading || isInitializing}
          className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-onedark-accent/15 hover:bg-onedark-accent/25 border border-onedark-accent/30 text-onedark-accent font-semibold transition-colors whitespace-nowrap cursor-pointer"
        >
          <ExternalLink className="w-3 h-3 text-onedark-accent" />
          <span>Post Review to GitHub</span>
        </button>
      </div>

      {/* Messages Conversation Container */}
      <div className="flex-1 p-3.5 overflow-y-auto space-y-3.5 select-text text-xs leading-relaxed">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-onedark-muted select-none space-y-2.5">
            <div className="w-10 h-10 rounded-2xl bg-onedark-surface/60 border border-onedark-border flex items-center justify-center text-onedark-accent">
              <Bot className="w-5 h-5" />
            </div>
            <div className="space-y-1 max-w-xs">
              <div className="text-xs font-semibold text-onedark-fgBright">Interactive PR Code Reviewer</div>
              <p className="text-[11px] text-onedark-muted leading-normal">
                Ask questions about modified files, audit security risks, or click any line in the diff view to discuss specific changes.
              </p>
            </div>
          </div>
        )}

        {messages.map((msg, index) => {
          const isAgent = msg.sender === 'agent';
          const isSystem = msg.sender === 'system';

          if (isSystem) {
            return (
              <div key={msg.id || index} className="p-2 rounded-lg bg-onedark-surface/40 border border-onedark-borderSubtle text-[11px] text-onedark-muted font-mono">
                {msg.content}
              </div>
            );
          }

          return (
            <div key={msg.id || index} className={`flex flex-col space-y-1.5 ${isAgent ? 'items-start' : 'items-end'}`}>
              <div className="flex items-center space-x-1.5 px-1 text-[10.5px] text-onedark-muted font-mono">
                <span>{isAgent ? 'CodeReviewer' : 'You'}</span>
                <span>•</span>
                <span>{new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>

              {/* Agent Thought Accordion if present */}
              {isAgent && msg.thought && (
                <div className="w-full max-w-full rounded-xl border border-onedark-borderSubtle bg-onedark-surface/30 overflow-hidden text-[11px]">
                  <button
                    onClick={() => toggleThought(msg.id)}
                    className="w-full px-2.5 py-1.5 flex items-center justify-between text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/50 transition-colors select-none"
                  >
                    <div className="flex items-center space-x-1.5">
                      <Sparkles className="w-3 h-3 text-onedark-accent animate-pulse" />
                      <span className="font-mono text-[10.5px] font-medium">Reviewer Reasoning</span>
                    </div>
                    <ChevronDown className={`w-3 h-3 transition-transform ${showThoughts[msg.id] ? 'rotate-180' : ''}`} />
                  </button>
                  {showThoughts[msg.id] && (
                    <div className="p-2.5 border-t border-onedark-borderSubtle text-[11px] text-onedark-muted font-mono bg-onedark-bg/40 leading-relaxed whitespace-pre-wrap">
                      {msg.thought}
                    </div>
                  )}
                </div>
              )}

              {/* Main Message Bubble */}
              <div 
                className={`p-3 rounded-2xl max-w-[94%] shadow-xs leading-relaxed group relative ${
                  isAgent
                    ? 'bg-onedark-surface/80 border border-onedark-border text-onedark-fg'
                    : 'bg-onedark-accent/20 border border-onedark-accent/40 text-onedark-fgBright'
                }`}
              >
                <MarkdownRenderer 
                  content={msg.content} 
                  isStreaming={msg.isStreaming} 
                  onLinkClick={(url, text) => {
                    if (url.startsWith('#') || url.includes('#L')) {
                      const m = url.match(/(?:#L|:)(\d+)/);
                      if (m && onNavigateToFileLine) {
                        onNavigateToFileLine(text, parseInt(m[1], 10));
                      }
                    }
                  }}
                />

                {/* Copy button */}
                <button
                  onClick={() => handleCopyMessage(msg.content, index)}
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-onedark-bg/80 text-onedark-muted hover:text-onedark-fg transition-all"
                  title="Copy message"
                >
                  {copiedIndex === index ? <Check className="w-3 h-3 text-onedark-green" /> : <Copy className="w-3 h-3" />}
                </button>
              </div>
            </div>
          );
        })}

        {isLoading && (
          <div className="flex items-center space-x-2 text-xs text-onedark-muted font-mono p-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-onedark-accent" />
            <span>Reviewer agent is analyzing diffs...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input / Composer Area */}
      <div className="p-3 bg-onedark-surface/80 border-t border-onedark-border space-y-2 flex-shrink-0 select-none">
        {/* Attached Line Context Chip */}
        {attachedContext && (
          <div className="flex items-center justify-between px-2.5 py-1 rounded-lg bg-onedark-bg border border-onedark-accent/40 text-xs text-onedark-accent animate-in fade-in">
            <div className="flex items-center space-x-1.5 truncate">
              <FileCode2 className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="font-mono text-[11px] font-semibold truncate">
                {attachedContext.filename} : L{attachedContext.line}
              </span>
              <span className="text-[10px] text-onedark-muted truncate">
                ("{attachedContext.content.trim().slice(0, 40)}...")
              </span>
            </div>
            <button
              onClick={() => {
                setAttachedContext(null);
                onClearActiveLineComment?.();
              }}
              className="text-onedark-muted hover:text-onedark-fg p-0.5 rounded cursor-pointer"
              title="Remove attached line context"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Textarea Input */}
        <div className="relative flex items-end bg-onedark-bg rounded-xl border border-onedark-borderSubtle focus-within:border-onedark-accent transition-colors p-1.5">
          <textarea
            ref={inputRef}
            value={inputPrompt}
            onChange={(e) => setInputPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={attachedContext ? `Ask agent about ${attachedContext.filename} (line ${attachedContext.line})...` : "Ask reviewer agent or discuss diffs..."}
            rows={2}
            className="w-full bg-transparent border-none text-xs text-onedark-fg focus:outline-none resize-none px-2 py-1 placeholder:text-onedark-muted/60 leading-relaxed font-sans"
          />

          <button
            onClick={() => handleSendMessage()}
            disabled={(!inputPrompt.trim() && !attachedContext) || isInitializing}
            className={`p-2 rounded-lg transition-all flex-shrink-0 cursor-pointer ${
              (inputPrompt.trim() || attachedContext) && !isInitializing
                ? 'bg-onedark-accent hover:bg-onedark-accent/90 text-white shadow-xs'
                : 'bg-onedark-surface text-onedark-muted/40 cursor-not-allowed'
            }`}
            title="Send to Reviewer Agent (Enter)"
          >
            {isInitializing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
