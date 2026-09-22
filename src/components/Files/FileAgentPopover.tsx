import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { 
  Bot, 
  Send, 
  X, 
  Sparkles, 
  ShieldCheck, 
  TestTube, 
  Copy, 
  Check, 
  ChevronDown, 
  Loader2, 
  Code2, 
  FileCode2, 
  Plus, 
  Minimize2, 
  Maximize2, 
  RotateCcw,
  Trash2
} from "lucide-react";
import { MarkdownRenderer } from "../Common/MarkdownRenderer";
import { useWebSocket } from "../../contexts/WebSocketContext";
import { TaskMessage } from "../../types";
import { LineContext } from "./CodeViewer";

interface FileAgentPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  taskId: string;
  filePath: string | null;
  activeSnippet?: LineContext | null;
  initialPrompt?: string;
  onClearActiveSnippet?: () => void;
  onNavigateToFileLine?: (filename: string, line?: number) => void;
}

const API_BASE = import.meta.env.VITE_API_URL || "";

const UserSnippetMessageBubble: React.FC<{
  content: string;
  onLinkClick?: (url: string, text: string) => void;
}> = ({ content, onLinkClick }) => {
  const [isSnippetExpanded, setIsSnippetExpanded] = useState(false);
  const [copiedSnippet, setCopiedSnippet] = useState(false);

  // Regex to extract attached snippet context from prompt
  const snippetMatch = content.match(
    /^\*\*Regarding snippet in\*\*\s*`([^`]+)`(?:\s*\(([^)]+)\))?:\s*\n```(?:[a-zA-Z0-9_-]+)?\s*([\s\S]*?)```(?:\n\n|\n)?([\s\S]*)$/
  );

  if (!snippetMatch) {
    return <MarkdownRenderer content={content} onLinkClick={onLinkClick} />;
  }

  const filename = snippetMatch[1];
  const lineRange = snippetMatch[2] || "";
  const snippetCode = snippetMatch[3];
  const userPrompt = snippetMatch[4]?.trim() || "";
  const lineCount = snippetCode.split("\n").length;

  const handleCopySnippet = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(snippetCode);
    setCopiedSnippet(true);
    setTimeout(() => setCopiedSnippet(false), 2000);
  };

  return (
    <div className="space-y-2">
      {/* Collapsible Snippet Card */}
      <div className="rounded-xl bg-onedark-darker/90 overflow-hidden font-mono text-[11px] shadow-xs">
        <div
          onClick={() => setIsSnippetExpanded(!isSnippetExpanded)}
          className="flex items-center justify-between px-3 py-1.5 bg-onedark-surface/60 hover:bg-onedark-surface cursor-pointer select-none gap-2 transition-colors"
        >
          <div className="flex items-center space-x-1.5 min-w-0">
            <FileCode2 className="w-3.5 h-3.5 text-onedark-accent flex-shrink-0" />
            <span className="font-semibold text-onedark-fgBright truncate">{filename}</span>
            {lineRange && <span className="text-onedark-accent/80 font-medium">({lineRange})</span>}
            <span className="text-[10px] text-onedark-muted px-1.5 py-0.2 rounded-full bg-onedark-darker">
              {lineCount} lines
            </span>
          </div>

          <div className="flex items-center space-x-1.5 flex-shrink-0">
            <button
              onClick={handleCopySnippet}
              className="p-1 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg transition-colors cursor-pointer"
              title="Copy snippet"
            >
              {copiedSnippet ? <Check className="w-3 h-3 text-onedark-green" /> : <Copy className="w-3 h-3" />}
            </button>
            <span className="text-onedark-accent flex items-center text-[10.5px] font-sans font-medium">
              {isSnippetExpanded ? "Collapse" : "Expand"}
              <ChevronDown className={`w-3.5 h-3.5 ml-0.5 transition-transform ${isSnippetExpanded ? "rotate-180" : ""}`} />
            </span>
          </div>
        </div>

        {/* Expanded Code View */}
        {isSnippetExpanded && (
          <div className="p-3 bg-onedark-bg/95 border-t border-transparent max-h-72 overflow-auto text-[11.5px] leading-relaxed select-text">
            <pre className="font-mono whitespace-pre text-onedark-fg/90">{snippetCode}</pre>
          </div>
        )}
      </div>

      {/* User Inquiry Text */}
      {userPrompt && (
        <div className="text-onedark-fgBright text-xs leading-relaxed select-text">
          <MarkdownRenderer content={userPrompt} onLinkClick={onLinkClick} />
        </div>
      )}
    </div>
  );
};

export const FileAgentPopover: React.FC<FileAgentPopoverProps> = ({
  isOpen,
  onClose,
  taskId: parentTaskId,
  filePath,
  activeSnippet,
  initialPrompt,
  onClearActiveSnippet,
  onNavigateToFileLine
}) => {
  const [subTaskId, setSubTaskId] = useState<string | null>(null);
  const [messages, setMessages] = useState<TaskMessage[]>([]);
  const [inputPrompt, setInputPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [showThoughts, setShowThoughts] = useState<Record<string, boolean>>({});
  const [isExpanded, setIsExpanded] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [attachedContext, setAttachedContext] = useState<LineContext | null>(null);
  const [showScrollBottomBtn, setShowScrollBottomBtn] = useState(false);

  // Resizable dimension state
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 530, height: 650 });
  const [isResizing, setIsResizing] = useState(false);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isAutoScrollEnabledRef = useRef<boolean>(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isSendingRef = useRef<boolean>(false);
  const { subscribe } = useWebSocket();

  // Auto-resume existing subsession for this file if available
  useEffect(() => {
    if (!isOpen || !parentTaskId) return;

    let isMounted = true;
    const cleanPath = filePath ? filePath.replace(/[^a-zA-Z0-9._-]/g, "_") : "root";
    const sessionKey = `files:${parentTaskId}:${cleanPath}`;

    const fetchExistingSession = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/tasks?session_key=${encodeURIComponent(sessionKey)}&limit=1`);
        if (res.ok) {
          const data = await res.json();
          if (data && data.length > 0 && isMounted) {
            const existingTask = data[0];
            setSubTaskId(existingTask.id);
            const detailsRes = await fetch(`${API_BASE}/api/tasks/${existingTask.id}`);
            if (detailsRes.ok && isMounted) {
              const details = await detailsRes.json();
              if (details.messages && Array.isArray(details.messages)) {
                setMessages(details.messages);
              }
            }
          }
        }
      } catch (err) {
        console.error("Failed to load existing file subsession:", err);
      }
    };

    fetchExistingSession();

    return () => {
      isMounted = false;
    };
  }, [isOpen, parentTaskId, filePath]);

  // Synchronize attached snippet from props
  useEffect(() => {
    if (activeSnippet) {
      setAttachedContext(activeSnippet);
      if (inputRef.current) {
        inputRef.current.focus();
      }
    }
  }, [activeSnippet]);

  // Pre-fill input prompt if initialPrompt is provided (without auto-dispatching)
  useEffect(() => {
    if (isOpen && initialPrompt) {
      setInputPrompt(initialPrompt);
      if (inputRef.current) {
        inputRef.current.focus();
      }
    }
  }, [isOpen, initialPrompt]);

  // Handle user manual scroll
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    const isAtBottom = distanceFromBottom <= 60;
    isAutoScrollEnabledRef.current = isAtBottom;
    setShowScrollBottomBtn(!isAtBottom);
  }, []);

  const scrollToBottom = useCallback((smooth = false) => {
    const container = scrollContainerRef.current;
    if (!container) return;
    if (smooth) {
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    } else {
      container.scrollTop = container.scrollHeight;
    }
    isAutoScrollEnabledRef.current = true;
    setShowScrollBottomBtn(false);
  }, []);

  useEffect(() => {
    if (!isAutoScrollEnabledRef.current || !scrollContainerRef.current) return;
    scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
  }, [messages, isLoading]);

  // Handle popover drag resizing
  const startResize = useCallback((e: React.MouseEvent, direction: "top" | "left" | "top-left") => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);

    const startX = e.clientX;
    const startY = e.clientY;
    const startW = size.width;
    const startH = size.height;

    const onMouseMove = (moveEvent: MouseEvent) => {
      let newW = startW;
      let newH = startH;

      if (direction === "left" || direction === "top-left") {
        const dx = startX - moveEvent.clientX;
        newW = Math.min(Math.max(380, startW + dx), window.innerWidth - 32);
      }
      if (direction === "top" || direction === "top-left") {
        const dy = startY - moveEvent.clientY;
        newH = Math.min(Math.max(380, startH + dy), window.innerHeight - 32);
      }

      setSize({ width: newW, height: newH });
    };

    const onMouseUp = () => {
      setIsResizing(false);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [size]);

  // WebSocket subscriptions
  useEffect(() => {
    if (!subTaskId) return;

    const unsubStreamStart = subscribe("STREAM_START", (data: any) => {
      if (data.task_id === subTaskId) {
        setIsLoading(true);
        if (data.stream_type === "thought") {
          setShowThoughts(prev => ({ ...prev, [data.stream_id]: true }));
        }
        setMessages(prev => {
          const existingIdx = prev.findIndex(m => m.id === data.stream_id);
          if (existingIdx >= 0) {
            return prev.map((m, idx) => idx === existingIdx ? { ...m, isStreaming: true } : m);
          }
          return [
            ...prev,
            {
              id: data.stream_id,
              task_id: subTaskId,
              sender: "agent",
              content: "",
              thought: data.stream_type === "thought" ? "" : undefined,
              isStreaming: true,
              created_at: data.timestamp || new Date().toISOString()
            }
          ];
        });
      }
    });

    const unsubStreamChunk = subscribe("STREAM_CHUNK", (data: any) => {
      if (data.task_id === subTaskId) {
        setMessages(prev => {
          return prev.map(m => {
            if (m.id === data.stream_id) {
              return {
                ...m,
                content: data.stream_type === "message" ? data.accumulated : m.content,
                thought: data.stream_type === "thought" ? data.accumulated : m.thought,
                isStreaming: true
              };
            }
            return m;
          });
        });
      }
    });

    const unsubStreamEnd = subscribe("STREAM_END", (data: any) => {
      if (data.task_id === subTaskId) {
        setIsLoading(false);
        setMessages(prev => {
          return prev.map(m => {
            if (m.id === data.stream_id) {
              return {
                ...m,
                content: data.stream_type === "message" ? data.final_content : m.content,
                thought: data.stream_type === "thought" ? data.final_content : m.thought,
                isStreaming: false
              };
            }
            return m;
          });
        });
      }
    });

    const unsubStatus = subscribe("TASK_STATUS_CHANGE", (data: any) => {
      if (data.task_id === subTaskId && ["COMPLETED", "FAILED", "IDLE", "CANCELLED"].includes(data.status)) {
        setIsLoading(false);
      }
    });

    return () => {
      unsubStreamStart();
      unsubStreamChunk();
      unsubStreamEnd();
      unsubStatus();
    };
  }, [subTaskId, subscribe]);

  const handleSendMessage = async (customPrompt?: string) => {
    const rawText = customPrompt || inputPrompt;
    if ((!rawText.trim() && !attachedContext) || isSendingRef.current) return;

    isSendingRef.current = true;
    let finalPrompt = rawText.trim();
    if (attachedContext) {
      finalPrompt = `**Regarding snippet in** \`${attachedContext.filename}\` (lines ${attachedContext.startLine}-${attachedContext.endLine}):\n\`\`\`\n${attachedContext.content}\n\`\`\`\n\n${finalPrompt || "Please inspect and analyze this code."}`;
    }

    setInputPrompt("");
    setAttachedContext(null);
    onClearActiveSnippet?.();

    const userMsgId = `user-${Date.now()}`;
    const newMsg: TaskMessage = {
      id: userMsgId,
      task_id: subTaskId || "pending",
      sender: "user",
      content: finalPrompt,
      created_at: new Date().toISOString()
    };
    setMessages(prev => [...prev, newMsg]);
    setIsLoading(true);

    isAutoScrollEnabledRef.current = true;
    setShowScrollBottomBtn(false);

    try {
      if (!subTaskId) {
        setIsInitializing(true);
        const cleanPath = filePath ? filePath.replace(/[^a-zA-Z0-9._-]/g, "_") : "root";
        const sessionKey = `files:${parentTaskId}:${cleanPath}`;
        const res = await fetch(`${API_BASE}/api/tasks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: `Code Discussion: ${filePath || "Workspace Files"}`,
            description: finalPrompt,
            persona: "PairProgrammer",
            session_key: sessionKey,
            is_subsession: true,
            parent_task_id: parentTaskId || null,
          })
        });
        setIsInitializing(false);

        if (res.ok) {
          const data = await res.json();
          setSubTaskId(data.task_id);
          return;
        }
        throw new Error("Failed to spawn file discussion subsession");
      } else {
        const res = await fetch(`${API_BASE}/api/tasks/${subTaskId}/message`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: finalPrompt })
        });
        if (!res.ok) {
          throw new Error(`HTTP error ${res.status}`);
        }
      }
    } catch (err) {
      console.error("Error dispatching message to file agent:", err);
      setIsLoading(false);
      setIsInitializing(false);
      setMessages(prev => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          task_id: subTaskId || "err",
          sender: "system",
          content: "⚠️ Failed to send message to Cyclode Agent. Please check connectivity.",
          created_at: new Date().toISOString()
        }
      ]);
    } finally {
      isSendingRef.current = false;
    }
  };

  const handleClearChat = () => {
    setMessages([]);
    setSubTaskId(null);
    setAttachedContext(null);
    setInputPrompt("");
    onClearActiveSnippet?.();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
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

  // Deduplicate messages by unique ID and remove consecutive identical messages
  const deduplicatedMessages = useMemo(() => {
    const seen = new Set<string>();
    const result: TaskMessage[] = [];
    for (const m of messages) {
      if (!m.id) {
        result.push(m);
        continue;
      }
      if (seen.has(m.id)) continue;
      seen.add(m.id);

      if (result.length > 0) {
        const prev = result[result.length - 1];
        if (
          prev.sender === m.sender &&
          prev.content.trim() === m.content.trim() &&
          m.content.trim().length > 0 &&
          !m.isStreaming &&
          !prev.isStreaming
        ) {
          continue;
        }
      }
      result.push(m);
    }
    return result;
  }, [messages]);

  if (!isOpen) return null;

  return (
    <div 
      style={{
        width: isExpanded ? "min(860px, 95vw)" : `${size.width}px`,
        height: isExpanded ? "min(85vh, 900px)" : `${size.height}px`
      }}
      className={`fixed z-50 flex flex-col bg-onedark-darker border border-onedark-border shadow-2xl rounded-2xl overflow-hidden bottom-4 right-4 animate-in fade-in slide-in-from-bottom-3 ${
        isResizing ? "select-none transition-none" : "transition-all duration-150"
      }`}
    >
      {/* Resizing Edge Handles */}
      <div
        onMouseDown={(e) => startResize(e, "top")}
        className="absolute top-0 left-0 right-0 h-2.5 cursor-ns-resize z-30 hover:bg-onedark-accent/30 transition-colors"
        title="Drag to resize height"
      />
      <div
        onMouseDown={(e) => startResize(e, "left")}
        className="absolute top-0 left-0 bottom-0 w-2.5 cursor-ew-resize z-30 hover:bg-onedark-accent/30 transition-colors"
        title="Drag to resize width"
      />
      <div
        onMouseDown={(e) => startResize(e, "top-left")}
        className="absolute top-0 left-0 w-5 h-5 cursor-nwse-resize z-40 flex items-center justify-center p-0.5 group/grip"
        title="Drag corner to resize width & height"
      >
        <div className="w-2.5 h-2.5 border-t-2 border-l-2 border-onedark-muted/60 group-hover/grip:border-onedark-accent rounded-tl-sm transition-colors" />
      </div>

      {/* Header Bar */}
      <div className="flex items-center justify-between px-3.5 py-2.5 bg-onedark-surface/90 border-b border-onedark-borderSubtle select-none flex-shrink-0">
        <div className="flex items-center space-x-2 truncate">
          <div className="w-6 h-6 rounded-lg bg-onedark-accent/20 flex items-center justify-center text-onedark-accent flex-shrink-0">
            <Bot className="w-3.5 h-3.5" />
          </div>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center space-x-1.5">
              <span className="font-semibold text-xs text-onedark-fgBright font-sans">Cyclode Code Assistant</span>
              <span className="px-1.5 py-0.2 rounded-full bg-onedark-accent/15 text-[10px] font-mono font-bold text-onedark-accent">
                Subsession
              </span>
            </div>
            <span className="text-[10.5px] text-onedark-muted truncate font-mono" title={filePath || "Workspace Files"}>
              {filePath || "Workspace Files"}
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-1 flex-shrink-0">
          <button
            onClick={handleClearChat}
            className="p-1 rounded hover:bg-onedark-bg text-onedark-muted hover:text-onedark-red transition-colors cursor-pointer"
            title="Clear chat and reset context"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => {
              setSubTaskId(null);
              setMessages([]);
            }}
            className="p-1 rounded hover:bg-onedark-bg text-onedark-muted hover:text-onedark-fg transition-colors cursor-pointer"
            title="Start new discussion thread"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 rounded hover:bg-onedark-bg text-onedark-muted hover:text-onedark-fg transition-colors cursor-pointer"
            title={isExpanded ? "Collapse to custom size" : "Expand window"}
          >
            {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-onedark-bg text-onedark-muted hover:text-onedark-red transition-colors cursor-pointer"
            title="Close discussion"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Quick Action Chips Bar */}
      <div className="px-3 py-1.5 bg-onedark-surface/40 border-b border-onedark-borderSubtle flex items-center space-x-1.5 overflow-x-auto select-none no-scrollbar flex-shrink-0 text-[11px]">
        <button
          onClick={() => handleSendMessage(`Explain the logic, architecture, and control flow of ${filePath ? "`" + filePath + "`" : "this file"}, highlighting key dependencies and error paths.`)}
          disabled={isLoading || isInitializing}
          className="flex items-center space-x-1 px-2.5 py-0.5 rounded-full bg-onedark-purple/20 hover:bg-onedark-purple/30 text-onedark-purple font-semibold transition-colors whitespace-nowrap cursor-pointer shadow-xs"
        >
          <Sparkles className="w-3 h-3" />
          <span>Explain File</span>
        </button>

        <button
          onClick={() => handleSendMessage(`Perform a security, bug, and edge-case audit on ${filePath ? "`" + filePath + "`" : "the active file"}. Look for unhandled exceptions, race conditions, memory leaks, and input validation risks.`)}
          disabled={isLoading || isInitializing}
          className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-onedark-surface/60 hover:bg-onedark-surface text-onedark-fg hover:text-onedark-fgBright transition-colors whitespace-nowrap cursor-pointer"
        >
          <ShieldCheck className="w-3 h-3 text-onedark-red" />
          <span>Security & Bug Audit</span>
        </button>

        <button
          onClick={() => handleSendMessage(`Suggest refactorings for ${filePath ? "`" + filePath + "`" : "this file"} to improve performance, readability, and idiomatic maintainability.`)}
          disabled={isLoading || isInitializing}
          className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-onedark-surface/60 hover:bg-onedark-surface text-onedark-fg hover:text-onedark-fgBright transition-colors whitespace-nowrap cursor-pointer"
        >
          <Code2 className="w-3 h-3 text-onedark-blue" />
          <span>Refactor & Optimize</span>
        </button>

        <button
          onClick={() => handleSendMessage(`Generate unit tests for ${filePath ? "`" + filePath + "`" : "this file"} covering both happy path and edge-case failure modes.`)}
          disabled={isLoading || isInitializing}
          className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-onedark-surface/60 hover:bg-onedark-surface text-onedark-fg hover:text-onedark-fgBright transition-colors whitespace-nowrap cursor-pointer"
        >
          <TestTube className="w-3 h-3 text-onedark-green" />
          <span>Generate Tests</span>
        </button>
      </div>

      {/* Messages Conversation Container */}
      <div 
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 p-3.5 overflow-y-auto space-y-3.5 select-text text-xs leading-relaxed relative"
      >
        {deduplicatedMessages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-onedark-muted select-none space-y-2.5">
            <div className="w-10 h-10 rounded-2xl bg-onedark-surface/60 border border-onedark-border flex items-center justify-center text-onedark-accent">
              <Bot className="w-5 h-5" />
            </div>
            <div className="space-y-1 max-w-xs">
              <div className="text-xs font-semibold text-onedark-fgBright">Interactive Code Assistant</div>
              <p className="text-[11px] text-onedark-muted leading-normal">
                Ask about specific functions, request refactors, or select lines in the code viewer to discuss targeted snippets.
              </p>
            </div>
          </div>
        )}

        {deduplicatedMessages.map((msg, index) => {
          const isAgent = msg.sender === "agent";
          const isSystem = msg.sender === "system";
          const hasContent = Boolean(msg.content && msg.content.trim().length > 0);
          const hasThought = Boolean(msg.thought && msg.thought.trim().length > 0);

          if (!hasContent && !hasThought && !msg.isStreaming) {
            return null;
          }

          if (isSystem) {
            return (
              <div key={msg.id || index} className="p-2 rounded-lg bg-onedark-surface/40 border border-onedark-borderSubtle text-[11px] text-onedark-muted font-mono">
                {msg.content}
              </div>
            );
          }

          return (
            <div key={msg.id || index} className={`flex flex-col space-y-1.5 ${isAgent ? "items-start" : "items-end"}`}>
              <div className="flex items-center space-x-1.5 px-1 text-[10.5px] text-onedark-muted font-mono">
                <span>{isAgent ? "PairProgrammer" : "You"}</span>
                <span>•</span>
                <span>{new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
              </div>

              {/* Agent Thought Accordion */}
              {isAgent && hasThought && (
                <div className="w-full max-w-full rounded-xl border border-onedark-borderSubtle bg-onedark-surface/30 overflow-hidden text-[11px]">
                  <button
                    onClick={() => toggleThought(msg.id)}
                    className="w-full px-2.5 py-1.5 flex items-center justify-between text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/50 transition-colors select-none cursor-pointer"
                  >
                    <div className="flex items-center space-x-1.5">
                      <Sparkles className="w-3 h-3 text-onedark-accent animate-pulse" />
                      <span className="font-mono text-[10.5px] font-medium">Reasoning & Inspection</span>
                    </div>
                    <ChevronDown className={`w-3 h-3 transition-transform ${showThoughts[msg.id] ? "rotate-180" : ""}`} />
                  </button>
                  {showThoughts[msg.id] && (
                    <div className="p-2.5 border-t border-onedark-borderSubtle text-[11px] text-onedark-muted font-mono bg-onedark-bg/40 leading-relaxed whitespace-pre-wrap">
                      {msg.thought}
                    </div>
                  )}
                </div>
              )}

              {/* Main Message Bubble */}
              {(hasContent || (!hasThought && msg.isStreaming)) && (
                <div 
                  className={`p-3 rounded-2xl max-w-[94%] shadow-xs leading-relaxed group relative ${
                    isAgent
                      ? "bg-onedark-surface/80 text-onedark-fg"
                      : "bg-onedark-accent/20 text-onedark-fgBright"
                  }`}
                >
                  {isAgent ? (
                    <MarkdownRenderer 
                      content={msg.content} 
                      isStreaming={msg.isStreaming} 
                      onLinkClick={(url, text) => {
                        if (url.startsWith("#") || url.includes("#L") || url.includes(":")) {
                          const m = url.match(/(?:#L|:)(\d+)/);
                          if (m && onNavigateToFileLine) {
                            onNavigateToFileLine(text, parseInt(m[1], 10));
                          }
                        }
                      }}
                    />
                  ) : (
                    <UserSnippetMessageBubble 
                      content={msg.content} 
                      onLinkClick={(url, text) => {
                        if (url.startsWith("#") || url.includes("#L") || url.includes(":")) {
                          const m = url.match(/(?:#L|:)(\d+)/);
                          if (m && onNavigateToFileLine) {
                            onNavigateToFileLine(text, parseInt(m[1], 10));
                          }
                        }
                      }}
                    />
                  )}

                  {msg.content && (
                    <button
                      onClick={() => handleCopyMessage(msg.content, index)}
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-onedark-bg/80 text-onedark-muted hover:text-onedark-fg transition-all cursor-pointer"
                      title="Copy message"
                    >
                      {copiedIndex === index ? <Check className="w-3 h-3 text-onedark-green" /> : <Copy className="w-3 h-3" />}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {isLoading && (
          <div className="flex items-center space-x-2 text-xs text-onedark-muted font-mono p-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-onedark-accent" />
            <span>Agent is thinking & analyzing code...</span>
          </div>
        )}
      </div>

      {/* Floating Scroll to Bottom Button */}
      {showScrollBottomBtn && (
        <div className="absolute bottom-20 right-5 z-20">
          <button
            onClick={() => scrollToBottom(true)}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-onedark-accent/90 hover:bg-onedark-accent text-white shadow-lg text-[11px] font-medium transition-all backdrop-blur-xs cursor-pointer animate-in fade-in"
          >
            <ChevronDown className="w-3.5 h-3.5" />
            <span>Scroll to bottom</span>
          </button>
        </div>
      )}

      {/* Composer Area */}
      <div className="p-3 bg-onedark-surface/80 border-t border-onedark-borderSubtle space-y-2 flex-shrink-0 select-none">
        {/* Attached Snippet Context Chip */}
        {attachedContext && (
          <div className="flex items-center justify-between px-2.5 py-1 rounded-lg bg-onedark-accent/15 text-xs text-onedark-accent animate-in fade-in">
            <div className="flex items-center space-x-1.5 truncate">
              <FileCode2 className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="font-mono text-[11px] font-semibold truncate">
                {attachedContext.filename} : L{attachedContext.startLine}{attachedContext.endLine !== attachedContext.startLine ? `-${attachedContext.endLine}` : ""}
              </span>
              <span className="text-[10px] text-onedark-muted truncate">
                (&quot;{attachedContext.content.trim().slice(0, 45)}...&quot;)
              </span>
            </div>
            <button
              onClick={() => {
                setAttachedContext(null);
                onClearActiveSnippet?.();
              }}
              className="text-onedark-muted hover:text-onedark-fg p-0.5 rounded cursor-pointer"
              title="Remove snippet context"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Textarea Input */}
        <div className="relative flex items-end bg-onedark-bg rounded-xl border border-transparent focus-within:border-onedark-accent/60 transition-colors p-2">
          <textarea
            ref={inputRef}
            value={inputPrompt}
            onChange={(e) => setInputPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              attachedContext
                ? `Ask agent about ${attachedContext.filename} (L${attachedContext.startLine}-${attachedContext.endLine})...`
                : "Ask Cyclode Agent about this file or codebase..."
            }
            rows={2}
            className="w-full bg-transparent border-none text-[13.5px] text-onedark-fg focus:outline-none resize-none px-2.5 py-1.5 placeholder:text-onedark-muted/60 leading-relaxed font-sans"
          />

          <button
            onClick={() => handleSendMessage()}
            disabled={(!inputPrompt.trim() && !attachedContext) || isInitializing}
            className={`p-2.5 rounded-lg transition-all flex-shrink-0 cursor-pointer ${
              (inputPrompt.trim() || attachedContext) && !isInitializing
                ? "bg-onedark-accent hover:bg-onedark-accent/90 text-onedark-darker shadow-xs"
                : "bg-onedark-surface text-onedark-muted/40 cursor-not-allowed"
            }`}
            title="Send message (Enter)"
          >
            {isInitializing ? (
              <Loader2 className="w-4 h-4 animate-spin stroke-[2.5]" />
            ) : (
              <Send className="w-4 h-4 stroke-[2.5]" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
