import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { 
  Bot, 
  Send, 
  Square,
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
  Pencil,
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
  modelName?: string;
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
  modelName,
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
  const [openThoughtTurns, setOpenThoughtTurns] = useState<Record<string, boolean>>({});
  const [isExpanded, setIsExpanded] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [attachedContext, setAttachedContext] = useState<LineContext | null>(null);
  const [showScrollBottomBtn, setShowScrollBottomBtn] = useState(false);

  // Resizable dimension state
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 530, height: 650 });
  const [isResizing, setIsResizing] = useState(false);

  // Subsession prompt history & edit state
  const cleanPath = filePath ? filePath.replace(/[^a-zA-Z0-9._-]/g, "_") : "root";
  const sessionKey = `files:${parentTaskId}:${cleanPath}`;
  const historyStorageKey = `cyclode:prompt_history:${sessionKey}`;

  const [promptHistory, setPromptHistory] = useState<string[]>(() => {
    try {
      const saved = sessionStorage.getItem(historyStorageKey);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const tempDraftRef = useRef<string>("");

  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState<string>("");

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isAutoScrollEnabledRef = useRef<boolean>(true);
  const scrollRafRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isSendingRef = useRef<boolean>(false);
  const { subscribe } = useWebSocket();

  // Auto-grow input textarea height dynamically
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = `${Math.min(140, Math.max(38, inputRef.current.scrollHeight))}px`;
    }
  }, [inputPrompt]);

  // Auto-resume existing subsession for this file if available
  useEffect(() => {
    if (!isOpen || !parentTaskId) return;

    let isMounted = true;

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
  }, [isOpen, parentTaskId, sessionKey]);

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

  // Instant user gesture interrupt: If user scrolls up by even 1px, immediately disengage auto-scroll
  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (e.deltaY < 0) {
      isAutoScrollEnabledRef.current = false;
      setShowScrollBottomBtn(true);
      if (scrollRafRef.current) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    } else if (e.deltaY > 0) {
      const container = scrollContainerRef.current;
      if (container) {
        const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
        if (distanceFromBottom <= 20) {
          isAutoScrollEnabledRef.current = true;
          setShowScrollBottomBtn(false);
        }
      }
    }
  }, []);

  // Handle touch interactions for mobile / trackpad pinch
  const handleTouchMove = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceFromBottom > 25) {
      isAutoScrollEnabledRef.current = false;
      setShowScrollBottomBtn(true);
    } else {
      isAutoScrollEnabledRef.current = true;
      setShowScrollBottomBtn(false);
    }
  }, []);

  // Handle user manual scroll
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    const isAtBottom = distanceFromBottom <= 20;
    if (isAtBottom) {
      isAutoScrollEnabledRef.current = true;
      setShowScrollBottomBtn(false);
    } else {
      setShowScrollBottomBtn(true);
    }
  }, []);

  const scrollToBottom = useCallback((smooth = true) => {
    const container = scrollContainerRef.current;
    if (!container) return;
    isAutoScrollEnabledRef.current = true;
    setShowScrollBottomBtn(false);
    if (smooth) {
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    } else {
      container.scrollTop = container.scrollHeight;
    }
  }, []);

  useEffect(() => {
    if (!isAutoScrollEnabledRef.current || !scrollContainerRef.current) return;

    if (scrollRafRef.current) {
      cancelAnimationFrame(scrollRafRef.current);
    }

    scrollRafRef.current = requestAnimationFrame(() => {
      const container = scrollContainerRef.current;
      if (!container || !isAutoScrollEnabledRef.current) return;

      const targetScrollTop = container.scrollHeight - container.clientHeight;
      if (targetScrollTop <= 0) return;

      const distance = Math.abs(targetScrollTop - container.scrollTop);
      if (distance <= 2) return;

      container.scrollTop = targetScrollTop;
    });

    return () => {
      if (scrollRafRef.current) {
        cancelAnimationFrame(scrollRafRef.current);
      }
    };
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

    const unsubThought = subscribe("AGENT_THOUGHT", (data: any) => {
      if (data.task_id === subTaskId) {
        setMessages(prev => {
          const thoughtIdx = prev.findIndex(m => m.id === data.id || (m.thought && data.thought && m.thought.trim() === data.thought.trim()));
          if (thoughtIdx >= 0) {
            return prev.map((m, idx) => idx === thoughtIdx ? { ...m, thought: data.thought, isStreaming: false } : m);
          }
          return [
            ...prev,
            {
              id: data.id || `thought-${Date.now()}`,
              task_id: subTaskId,
              sender: "agent",
              content: "",
              thought: data.thought,
              isStreaming: false,
              created_at: data.timestamp || new Date().toISOString()
            }
          ];
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
      unsubThought();
      unsubStatus();
    };
  }, [subTaskId, subscribe]);

  const handleStopSubTask = async () => {
    if (!subTaskId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(false);
    try {
      await fetch(`${API_BASE}/api/tasks/${subTaskId}/stop`, {
        method: "POST",
      });
    } catch (err) {
      console.error("Error stopping file agent subsession:", err);
    }
  };

  const handleRetryTurn = async (fromMessageId?: string) => {
    if (!subTaskId) return;

    setMessages(prev => {
      if (!fromMessageId) return prev;
      const targetIdx = prev.findIndex(m => m.id === fromMessageId);
      return targetIdx >= 0 ? prev.slice(0, targetIdx + 1) : prev;
    });

    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/tasks/${subTaskId}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from_message_id: fromMessageId || null }),
      });
      if (!res.ok) {
        throw new Error(`HTTP error ${res.status}`);
      }
    } catch (err) {
      console.error("Error retrying subsession turn:", err);
      setIsLoading(false);
    }
  };

  const handleStartEditTurn = (message: TaskMessage) => {
    setEditingMessageId(message.id);
    setEditingContent(message.content);
  };

  const handleSaveEditTurn = async (messageId: string) => {
    if (!subTaskId || !editingContent.trim()) return;

    const newContent = editingContent.trim();
    setEditingMessageId(null);

    setMessages(prev => {
      const targetIdx = prev.findIndex(m => m.id === messageId);
      if (targetIdx >= 0) {
        return prev.slice(0, targetIdx + 1).map((m, idx) =>
          idx === targetIdx ? { ...m, content: newContent } : m
        );
      }
      return prev;
    });

    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/tasks/${subTaskId}/messages/${messageId}/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newContent }),
      });
      if (!res.ok) {
        throw new Error(`HTTP error ${res.status}`);
      }
    } catch (err) {
      console.error("Error saving edited message in subsession:", err);
      setIsLoading(false);
    }
  };

  const handleSendMessage = async (customPrompt?: string) => {
    const rawText = customPrompt || inputPrompt;
    if ((!rawText.trim() && !attachedContext) || isSendingRef.current) return;

    isSendingRef.current = true;
    let finalPrompt = rawText.trim();
    if (attachedContext) {
      finalPrompt = `**Regarding snippet in** \`${attachedContext.filename}\` (lines ${attachedContext.startLine}-${attachedContext.endLine}):\n\`\`\`\n${attachedContext.content}\n\`\`\`\n\n${finalPrompt || "Please inspect and analyze this code."}`;
    }

    if (rawText.trim()) {
      setPromptHistory(prev => {
        const updated = [...prev.filter(p => p !== rawText.trim()), rawText.trim()].slice(-50);
        try {
          sessionStorage.setItem(historyStorageKey, JSON.stringify(updated));
        } catch {}
        return updated;
      });
    }
    setHistoryIndex(-1);
    tempDraftRef.current = "";

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
        const res = await fetch(`${API_BASE}/api/tasks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: `Code Discussion: ${filePath || "Workspace Files"}`,
            description: finalPrompt,
            persona: "PairProgrammer",
            model_name: modelName || undefined,
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
          content: "Failed to send message to Cyclode Agent. Please check connectivity.",
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
    setHistoryIndex(-1);
    tempDraftRef.current = "";
    onClearActiveSnippet?.();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (isLoading) {
        handleStopSubTask();
      } else {
        handleSendMessage();
      }
      return;
    }

    if (e.key === "ArrowUp") {
      const textarea = inputRef.current;
      if (!textarea) return;
      const isAtStart = textarea.selectionStart === 0 && textarea.selectionEnd === 0;
      if (isAtStart && promptHistory.length > 0) {
        e.preventDefault();
        if (historyIndex === -1) {
          tempDraftRef.current = inputPrompt;
          const nextIdx = promptHistory.length - 1;
          setHistoryIndex(nextIdx);
          setInputPrompt(promptHistory[nextIdx]);
        } else if (historyIndex > 0) {
          const nextIdx = historyIndex - 1;
          setHistoryIndex(nextIdx);
          setInputPrompt(promptHistory[nextIdx]);
        }
      }
      return;
    }

    if (e.key === "ArrowDown") {
      if (historyIndex !== -1) {
        e.preventDefault();
        if (historyIndex < promptHistory.length - 1) {
          const nextIdx = historyIndex + 1;
          setHistoryIndex(nextIdx);
          setInputPrompt(promptHistory[nextIdx]);
        } else {
          setHistoryIndex(-1);
          setInputPrompt(tempDraftRef.current || "");
        }
      }
      return;
    }

    if (e.key === "Escape" && historyIndex !== -1) {
      e.preventDefault();
      setHistoryIndex(-1);
      setInputPrompt(tempDraftRef.current || "");
    }
  };

  const handleCopyMessage = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const toggleThought = (turnId: string) => {
    setOpenThoughtTurns(prev => ({ ...prev, [turnId]: !prev[turnId] }));
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

  interface SubsessionTurn {
    id: string;
    userMessage?: TaskMessage;
    thoughts: Array<{ id: string; thought: string; created_at?: string; isStreaming?: boolean }>;
    agentMessages: TaskMessage[];
    systemMessages: TaskMessage[];
    isLatest: boolean;
  }

  // Aggregate flat message sequence into structured turns (User Prompt -> Consolidated Thoughts -> Response)
  const turns = useMemo(() => {
    const result: SubsessionTurn[] = [];
    let currentTurn: SubsessionTurn = {
      id: "turn-init",
      thoughts: [],
      agentMessages: [],
      systemMessages: [],
      isLatest: false
    };

    for (let i = 0; i < deduplicatedMessages.length; i++) {
      const msg = deduplicatedMessages[i];
      if (msg.sender === "user") {
        if (currentTurn.userMessage || currentTurn.thoughts.length > 0 || currentTurn.agentMessages.length > 0 || currentTurn.systemMessages.length > 0) {
          result.push(currentTurn);
        }
        currentTurn = {
          id: `turn-${msg.id || i}`,
          userMessage: msg,
          thoughts: [],
          agentMessages: [],
          systemMessages: [],
          isLatest: false
        };
      } else if (msg.sender === "system") {
        currentTurn.systemMessages.push(msg);
      } else {
        // Agent message
        if (msg.thought && msg.thought.trim().length > 0) {
          const cleanThought = msg.thought
            .replace(/^\*\*Auto-Continuation\*\*:[^\n]+\n?/g, "")
            .replace(/^\*\*Autonomous Scaffolding\*\*:[^\n]+\n?/g, "")
            .trim();
          if (cleanThought && !currentTurn.thoughts.some(t => t.id === msg.id || t.thought === cleanThought)) {
            currentTurn.thoughts.push({
              id: msg.id || `thought-${i}`,
              thought: cleanThought,
              created_at: msg.created_at,
              isStreaming: msg.isStreaming && !msg.content
            });
          }
        }
        if ((msg.content && msg.content.trim().length > 0) || (!msg.thought && msg.isStreaming)) {
          currentTurn.agentMessages.push(msg);
        }
      }
    }

    if (currentTurn.userMessage || currentTurn.thoughts.length > 0 || currentTurn.agentMessages.length > 0 || currentTurn.systemMessages.length > 0) {
      result.push(currentTurn);
    }

    if (result.length > 0) {
      result[result.length - 1].isLatest = true;
    }

    return result;
  }, [deduplicatedMessages]);

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
          {isLoading && (
            <button
              onClick={handleStopSubTask}
              className="p-1 rounded bg-onedark-red/15 hover:bg-onedark-red/25 text-onedark-red transition-colors cursor-pointer border border-onedark-red/30 flex items-center space-x-1 px-1.5"
              title="Stop active generation"
            >
              <Square className="w-3 h-3 fill-current" />
              <span className="text-[10px] font-mono font-medium">Stop</span>
            </button>
          )}
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
          onClick={() => handleSendMessage(`Explain the logic, architecture, and control flow of ${filePath ? "\`" + filePath + "\`" : "this file"}, highlighting key dependencies and error paths.`)}
          disabled={isLoading || isInitializing}
          className="flex items-center space-x-1 px-2.5 py-0.5 rounded-full bg-onedark-purple/20 hover:bg-onedark-purple/30 text-onedark-purple font-semibold transition-colors whitespace-nowrap cursor-pointer shadow-xs"
        >
          <Sparkles className="w-3 h-3" />
          <span>Explain File</span>
        </button>

        <button
          onClick={() => handleSendMessage(`Perform a security, bug, and edge-case audit on ${filePath ? "\`" + filePath + "\`" : "the active file"}. Look for unhandled exceptions, race conditions, memory leaks, and input validation risks.`)}
          disabled={isLoading || isInitializing}
          className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-onedark-surface/60 hover:bg-onedark-surface text-onedark-fg hover:text-onedark-fgBright transition-colors whitespace-nowrap cursor-pointer"
        >
          <ShieldCheck className="w-3 h-3 text-onedark-red" />
          <span>Security & Bug Audit</span>
        </button>

        <button
          onClick={() => handleSendMessage(`Suggest refactorings for ${filePath ? "\`" + filePath + "\`" : "this file"} to improve performance, readability, and idiomatic maintainability.`)}
          disabled={isLoading || isInitializing}
          className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-onedark-surface/60 hover:bg-onedark-surface text-onedark-fg hover:text-onedark-fgBright transition-colors whitespace-nowrap cursor-pointer"
        >
          <Code2 className="w-3 h-3 text-onedark-blue" />
          <span>Refactor & Optimize</span>
        </button>

        <button
          onClick={() => handleSendMessage(`Generate unit tests for ${filePath ? "\`" + filePath + "\`" : "this file"} covering both happy path and edge-case failure modes.`)}
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
        onWheel={handleWheel}
        onTouchMove={handleTouchMove}
        className="flex-1 p-3.5 overflow-y-auto space-y-3.5 select-text text-xs leading-relaxed relative [overflow-anchor:none]"
      >
        {turns.length === 0 && (
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

        {turns.map((turn, tIdx) => {
          const isTurnRunning = isLoading && turn.isLatest && (turn.agentMessages.length === 0 || (turn.agentMessages.length === 1 && !turn.agentMessages[0].content));
          const hasThoughts = turn.thoughts.length > 0;
          const isTurnOpen = openThoughtTurns[turn.id] ?? (isTurnRunning && turn.isLatest);
          const isEditingThis = turn.userMessage && editingMessageId === turn.userMessage.id;

          return (
            <div key={turn.id || tIdx} className="space-y-3.5">
              {/* User Message in Turn */}
              {turn.userMessage && (
                <div className="flex flex-col items-end space-y-1.5 group">
                  <div className="flex items-center space-x-1.5 px-1 text-[10.5px] text-onedark-muted font-mono">
                    <span>You</span>
                    <span>•</span>
                    <span>{new Date(turn.userMessage.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>

                  {isEditingThis ? (
                    <div className="w-full max-w-[94%] p-3 rounded-2xl bg-onedark-surface border border-onedark-accent/60 space-y-2 shadow-md">
                      <textarea
                        value={editingContent}
                        onChange={(e) => setEditingContent(e.target.value)}
                        rows={3}
                        className="w-full bg-onedark-bg p-2 rounded-lg border border-onedark-borderSubtle text-xs text-onedark-fg focus:outline-none resize-none font-sans"
                        placeholder="Edit message..."
                      />
                      <div className="flex items-center justify-end space-x-2">
                        <button
                          type="button"
                          onClick={() => setEditingMessageId(null)}
                          className="px-2.5 py-1 rounded-md text-xs text-onedark-muted hover:text-onedark-fg hover:bg-onedark-darker transition-colors cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSaveEditTurn(turn.userMessage!.id)}
                          className="px-3 py-1 rounded-md text-xs bg-onedark-accent hover:bg-onedark-accent/90 text-onedark-darker font-semibold transition-colors cursor-pointer"
                        >
                          Save & Retry
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="relative max-w-[94%]">
                      <div className="p-3 rounded-2xl shadow-xs leading-relaxed bg-onedark-accent/20 border border-onedark-accent/40 text-onedark-fgBright">
                        <UserSnippetMessageBubble
                          content={turn.userMessage.content}
                          onLinkClick={(url, text) => {
                            if (url.startsWith("#") || url.includes("#L") || url.includes(":")) {
                              const m = url.match(/(?:#L|:)(\d+)/);
                              if (m && onNavigateToFileLine) {
                                onNavigateToFileLine(text, parseInt(m[1], 10));
                              }
                            }
                          }}
                        />
                      </div>

                      {/* User Turn Action Bar */}
                      <div className="absolute -bottom-2.5 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-onedark-surface border border-onedark-borderSubtle rounded-lg px-1 py-0.5 flex items-center space-x-1 shadow-md z-10">
                        <button
                          type="button"
                          onClick={() => handleCopyMessage(turn.userMessage!.content, tIdx)}
                          className="p-1 rounded hover:bg-onedark-bg text-onedark-muted hover:text-onedark-fg transition-colors cursor-pointer"
                          title="Copy prompt"
                        >
                          {copiedIndex === tIdx ? <Check className="w-3 h-3 text-onedark-green" /> : <Copy className="w-3 h-3" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleStartEditTurn(turn.userMessage!)}
                          disabled={isLoading}
                          className="p-1 rounded hover:bg-onedark-bg text-onedark-muted hover:text-onedark-fg transition-colors cursor-pointer disabled:opacity-40"
                          title="Edit prompt"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRetryTurn(turn.userMessage!.id)}
                          disabled={isLoading}
                          className="p-1 rounded hover:bg-onedark-bg text-onedark-muted hover:text-onedark-accent transition-colors cursor-pointer disabled:opacity-40"
                          title="Retry from this turn"
                        >
                          <RotateCcw className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* System Messages in Turn */}
              {turn.systemMessages.map((sMsg, sIdx) => {
                const cleaned = sMsg.content
                  .replace(/^🛑\s*(?:\*\*)?Action Rejected by Reviewer\.(?:\*\*)?\s*Reason:\s*/i, "Action cancelled: ")
                  .replace(/^⏹\s*(?:\*\*)?Task stopped by user\.(?:\*\*)?/i, "Task stopped by user.")
                  .replace(/^■\s*(?:\*\*)?Task stopped by user\.(?:\*\*)?/i, "Task stopped by user.")
                  .replace(/^[🛑⏹■⚠️]\s*/, "")
                  .trim();

                return (
                  <div key={sMsg.id || sIdx} className="my-1.5 px-3 py-1.5 rounded-lg bg-onedark-surface/20 border border-onedark-borderSubtle/50 text-xs text-onedark-muted max-w-2xl text-left font-sans">
                    <MarkdownRenderer 
                      content={cleaned} 
                      onLinkClick={onNavigateToFileLine ? (url, text) => {
                        if (url.startsWith("#") || url.includes("#L") || url.includes(":")) {
                          const m = url.match(/(?:#L|:)(\d+)/);
                          if (m) onNavigateToFileLine(text, parseInt(m[1], 10));
                        }
                      } : undefined} 
                    />
                  </div>
                );
              })}

              {/* Unified Turn Reasoning Process Accordion */}
              {hasThoughts && (
                <div className={`w-full max-w-full rounded-xl border overflow-hidden text-xs transition-colors ${
                  isTurnRunning && turn.isLatest
                    ? "border-onedark-accent/30 bg-onedark-surface/40"
                    : "border-onedark-borderSubtle bg-onedark-surface/25 hover:bg-onedark-surface/40"
                }`}>
                  <button
                    type="button"
                    onClick={() => toggleThought(turn.id)}
                    className="w-full px-3 py-2 flex items-center justify-between text-onedark-muted hover:text-onedark-fg transition-colors select-none cursor-pointer"
                  >
                    <div className="flex items-center space-x-2">
                      <Sparkles className="w-3.5 h-3.5 text-onedark-accent animate-pulse" />
                      <span className="font-mono text-[11px] font-medium text-onedark-fg">
                        Reasoning process
                      </span>
                      <span className="text-[10.5px] text-onedark-muted font-mono">
                        ({turn.thoughts.length} step{turn.thoughts.length > 1 ? "s" : ""})
                      </span>
                    </div>

                    <div className="flex items-center space-x-2">
                      {isTurnRunning && turn.isLatest ? (
                        <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-950 border border-amber-300 dark:bg-onedark-yellow/10 dark:text-onedark-yellow dark:border-transparent text-[10px] font-mono flex items-center space-x-1 font-semibold">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-600 dark:bg-onedark-yellow animate-pulse" />
                          <span>Thinking...</span>
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-md bg-onedark-surface/60 text-onedark-muted text-[10px] font-mono">
                          {isTurnOpen ? "Hide" : "Show details"}
                        </span>
                      )}
                      <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isTurnOpen ? "rotate-180" : ""}`} />
                    </div>
                  </button>

                  {isTurnOpen && (
                    <div className="p-3 border-t border-onedark-borderSubtle/60 space-y-2 text-xs text-onedark-fg font-mono leading-relaxed bg-onedark-bg/40 max-h-60 overflow-y-auto [scrollbar-width:thin] [overflow-anchor:none]">
                      {turn.thoughts.map((t, tIdx) => (
                        <div key={t.id || tIdx} className="pl-2.5 border-l-2 border-onedark-accent/40 py-0.5 whitespace-pre-wrap">
                          {t.thought}
                          {t.isStreaming && (
                            <span className="inline-block w-1.5 h-3.5 ml-1 bg-onedark-accent animate-pulse align-middle" />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Agent Response Messages in Turn */}
              {turn.agentMessages.map((msg, mIdx) => (
                <div key={msg.id || mIdx} className="w-full flex flex-col space-y-1.5 items-start">
                  <div className="flex items-center space-x-1.5 px-1 text-[10.5px] text-onedark-muted font-mono">
                    <span>PairProgrammer</span>
                    <span>•</span>
                    <span>{new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                  <div className="p-3 rounded-2xl max-w-[94%] bg-onedark-surface/80 border border-onedark-border text-onedark-fg shadow-xs leading-relaxed group relative w-full">
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
                    
                    {/* Agent Message Hover Action Bar */}
                    <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center space-x-1 bg-onedark-darker/90 border border-onedark-borderSubtle rounded-lg p-0.5">
                      {msg.content && (
                        <button
                          type="button"
                          onClick={() => handleCopyMessage(msg.content, mIdx)}
                          className="p-1 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg transition-all cursor-pointer"
                          title="Copy response"
                        >
                          {copiedIndex === mIdx ? <Check className="w-3 h-3 text-onedark-green" /> : <Copy className="w-3 h-3" />}
                        </button>
                      )}
                      {turn.userMessage && (
                        <button
                          type="button"
                          onClick={() => handleRetryTurn(turn.userMessage!.id)}
                          disabled={isLoading}
                          className="p-1 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-accent transition-all cursor-pointer disabled:opacity-40"
                          title="Retry from this turn"
                        >
                          <RotateCcw className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {/* Live Status Indicator when Turn is Active before Agent Response arrives */}
              {isTurnRunning && turn.agentMessages.length === 0 && !turn.thoughts.some(t => t.isStreaming) && (
                <div className="flex items-center space-x-2 text-xs text-onedark-muted font-mono px-1 py-1">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-onedark-accent" />
                  <span>Agent is analyzing code & preparing response...</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Floating Scroll to Bottom Button */}
      {showScrollBottomBtn && (
        <div className="absolute bottom-20 right-5 z-20 animate-in fade-in slide-in-from-bottom-2 duration-150">
          <button
            onClick={() => scrollToBottom(true)}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-onedark-accent hover:bg-onedark-accent/90 text-onedark-darker shadow-lg shadow-black/35 text-[11px] font-bold transition-all backdrop-blur-xs cursor-pointer active:scale-95 border border-black/15 select-none group"
            title="Resume auto-scroll & jump to latest responses"
          >
            {isLoading ? (
              <span className="w-2 h-2 rounded-full bg-onedark-darker animate-pulse shrink-0" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 group-hover:translate-y-0.5 transition-transform shrink-0" />
            )}
            <span>{isLoading ? 'New responses below' : 'Scroll to bottom'}</span>
            <ChevronDown className="w-3.5 h-3.5 group-hover:translate-y-0.5 transition-transform shrink-0" />
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

        {/* Textarea Input & Action Buttons */}
        <div className="relative flex items-end bg-onedark-bg rounded-xl border border-transparent focus-within:border-onedark-accent/60 transition-colors p-2 gap-1.5">
          <textarea
            ref={inputRef}
            value={inputPrompt}
            onChange={(e) => setInputPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              attachedContext
                ? `Ask agent about ${attachedContext.filename} (L${attachedContext.startLine}-${attachedContext.endLine})...`
                : "Ask Cyclode Agent about this file (↑↓ for history)..."
            }
            rows={1}
            className="w-full bg-transparent border-none text-[13.5px] text-onedark-fg focus:outline-none resize-none px-2 py-1 placeholder:text-onedark-muted/60 leading-relaxed font-sans max-h-36 overflow-y-auto"
          />

          {isLoading ? (
            <button
              onClick={handleStopSubTask}
              className="p-2.5 rounded-lg transition-all flex-shrink-0 cursor-pointer bg-onedark-red/20 hover:bg-onedark-red/30 text-onedark-red border border-onedark-red/40 shadow-xs"
              title="Stop generation"
            >
              <Square className="w-4 h-4 fill-current stroke-[2.5]" />
            </button>
          ) : (
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
          )}
        </div>
      </div>
    </div>
  );
};
