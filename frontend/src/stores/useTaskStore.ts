import { useState, useCallback, useRef, useEffect } from "react";
import { Task, TaskMessage, AuxTabType } from "../types";
import { parseCurrentRoute, buildSessionPath, syncBrowserUrl } from "../utils/urlRouter";

const API_BASE = import.meta.env.VITE_API_URL || "";

export interface SetActiveTaskOptions {
  replaceUrl?: boolean;
  skipUrl?: boolean;
}

export interface TaskStoreState {
  tasks: Task[];
  activeTaskId: string | null;
  activeTaskDetails: Task | null;
  sessionPreviews: Record<string, { url: string; title?: string } | null>;
  sessionFiles: Record<string, string | null>;
  sessionFileLines: Record<string, number | null>;
  sessionAuxTabs: Record<string, AuxTabType>;
  sessionDrafts: Record<string, string>;
  isClearingAll: boolean;
  deletingTaskId: string | null;
  isLoadingTasks: boolean;
  isSessionLoading: boolean;
  setIsSessionLoading: React.Dispatch<React.SetStateAction<boolean>>;
  fetchTasks: () => Promise<void>;
  fetchTaskDetails: (taskId: string) => Promise<void>;
  setActiveTaskId: (id: string | null, options?: SetActiveTaskOptions) => void;
  setActiveTaskDetails: React.Dispatch<React.SetStateAction<Task | null>>;
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  setSessionPreviews: React.Dispatch<React.SetStateAction<Record<string, { url: string; title?: string } | null>>>;
  setSessionFiles: React.Dispatch<React.SetStateAction<Record<string, string | null>>>;
  setSessionFileLines: React.Dispatch<React.SetStateAction<Record<string, number | null>>>;
  setSessionAuxTabs: React.Dispatch<React.SetStateAction<Record<string, AuxTabType>>>;
  setSessionDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setSessionDraft: (sessionKey: string, draft: string) => void;
  setIsClearingAll: (clearing: boolean) => void;
  setDeletingTaskId: (id: string | null) => void;
  activeTaskIdRef: React.MutableRefObject<string | null>;
}

export function useTaskStore(): TaskStoreState {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoadingTasks, setIsLoadingTasks] = useState<boolean>(true);
  const taskDetailsCacheRef = useRef<Map<string, Task>>(new Map());

  const [activeTaskId, setActiveTaskIdState] = useState<string | null>(() => {
    try {
      const route = parseCurrentRoute();
      if (route.sessionId) {
        sessionStorage.removeItem("cyclode_draft_mode");
        localStorage.setItem("cyclode_active_task_id", route.sessionId);
        return route.sessionId;
      }
      if (route.isExplicitNewSession || sessionStorage.getItem("cyclode_draft_mode") === "1") {
        sessionStorage.setItem("cyclode_draft_mode", "1");
        if (route.isExplicitNewSession) {
          syncBrowserUrl("/", { replace: true });
        }
        return null;
      }
      const savedId = localStorage.getItem("cyclode_active_task_id") || null;
      if (savedId && route.view === "chat") {
        syncBrowserUrl(buildSessionPath(savedId), { replace: true });
      }
      return savedId;
    } catch {
      return null;
    }
  });

  const activeTaskIdRef = useRef<string | null>(activeTaskId);
  useEffect(() => {
    activeTaskIdRef.current = activeTaskId;
  }, [activeTaskId]);

  const [activeTaskDetails, setActiveTaskDetailsState] = useState<Task | null>(() => {
    try {
      const targetId = activeTaskIdRef.current;
      const rawSnap = localStorage.getItem("cyclode_active_task_snapshot");
      if (targetId && rawSnap) {
        const parsed: Task = JSON.parse(rawSnap);
        if (parsed && parsed.id === targetId) {
          taskDetailsCacheRef.current.set(parsed.id, parsed);
          return parsed;
        }
      }
    } catch {
      // ignore
    }
    return null;
  });

  const tasksRef = useRef<Task[]>(tasks);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  const snapshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchDetailsAbortRef = useRef<AbortController | null>(null);

  const persistTaskSnapshot = useCallback((taskObj: Task | null) => {
    if (!taskObj || !taskObj.id || taskObj.id.startsWith("temp-")) return;
    taskDetailsCacheRef.current.set(taskObj.id, taskObj);

    if (activeTaskIdRef.current !== taskObj.id) return;
    // Skip expensive JSON serialization during active token streaming
    if ((taskObj.messages || []).some((m) => m.isStreaming)) return;

    if (snapshotTimerRef.current) {
      clearTimeout(snapshotTimerRef.current);
    }
    snapshotTimerRef.current = setTimeout(() => {
      snapshotTimerRef.current = null;
      const latest = taskDetailsCacheRef.current.get(taskObj.id) || taskObj;
      if (activeTaskIdRef.current !== latest.id) return;
      try {
        const slimMessages = (latest.messages || []).slice(-35).map((m) => ({
          ...m,
          content: m.content && m.content.length > 16000 ? m.content.slice(0, 16000) : m.content,
        }));
        const snapshot: Task = {
          ...latest,
          messages: slimMessages,
          logs: (latest.logs || []).slice(-25).map((l: any) => ({
            ...l,
            tool_output:
              typeof l.tool_output === "string" && l.tool_output.length > 2000
                ? l.tool_output.slice(0, 2000)
                : l.tool_output,
          })),
          diffs: [],
        };
        localStorage.setItem("cyclode_active_task_snapshot", JSON.stringify(snapshot));
      } catch {
        // ignore quota errors
      }
    }, 900);
  }, []);

  const setActiveTaskDetails: React.Dispatch<React.SetStateAction<Task | null>> = useCallback(
    (updater) => {
      setActiveTaskDetailsState((prev) => {
        const next = typeof updater === "function" ? (updater as (p: Task | null) => Task | null)(prev) : updater;
        if (next && next.id && !next.id.startsWith("temp-") && next !== prev) {
          persistTaskSnapshot(next);
        }
        return next;
      });
    },
    [persistTaskSnapshot]
  );

  const [sessionPreviews, setSessionPreviews] = useState<Record<string, { url: string; title?: string } | null>>({});
  const [sessionFiles, setSessionFiles] = useState<Record<string, string | null>>({});
  const [sessionFileLines, setSessionFileLines] = useState<Record<string, number | null>>({});
  const [sessionAuxTabs, setSessionAuxTabs] = useState<Record<string, AuxTabType>>({});
  const [sessionDrafts, setSessionDrafts] = useState<Record<string, string>>(() => {
    try {
      const saved = localStorage.getItem("cyclode_prompt_drafts");
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return {};
  });
  const [isClearingAll, setIsClearingAll] = useState<boolean>(false);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [isSessionLoading, setIsSessionLoading] = useState<boolean>(() => !!activeTaskId && !activeTaskDetails);

  const setActiveTaskId = useCallback((id: string | null, options?: SetActiveTaskOptions) => {
    const prevId = activeTaskIdRef.current;
    if (prevId !== id && fetchDetailsAbortRef.current) {
      fetchDetailsAbortRef.current.abort();
      fetchDetailsAbortRef.current = null;
    }
    setActiveTaskIdState(id);
    activeTaskIdRef.current = id;
    try {
      if (id && !id.startsWith("temp-")) {
        sessionStorage.removeItem("cyclode_draft_mode");
        localStorage.setItem("cyclode_active_task_id", id);
        if (!options?.skipUrl) {
          const shouldReplace = Boolean(options?.replaceUrl || (prevId && prevId.startsWith("temp-")));
          syncBrowserUrl(buildSessionPath(id), { replace: shouldReplace });
        }
        const cached = taskDetailsCacheRef.current.get(id);
        if (cached && cached.messages && cached.messages.length > 0) {
          setActiveTaskDetailsState(cached);
          setIsSessionLoading(false);
        } else {
          setIsSessionLoading(true);
          const summary = tasksRef.current.find((t) => t.id === id);
          if (summary) {
            setActiveTaskDetailsState({
              ...summary,
              messages: summary.messages || [],
            });
          } else {
            setActiveTaskDetailsState(null);
          }
        }
      } else if (id && id.startsWith("temp-")) {
        sessionStorage.removeItem("cyclode_draft_mode");
      } else if (!id) {
        sessionStorage.setItem("cyclode_draft_mode", "1");
        localStorage.removeItem("cyclode_active_task_id");
        localStorage.removeItem("cyclode_active_task_snapshot");
        if (!options?.skipUrl) {
          syncBrowserUrl("/", { replace: options?.replaceUrl });
        }
      }
    } catch {
      // ignore
    }
  }, []);

  const setSessionDraft = useCallback((sessionKey: string, draft: string) => {
    setSessionDrafts((prev) => {
      const next = { ...prev, [sessionKey]: draft };
      try {
        localStorage.setItem("cyclode_prompt_drafts", JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const fetchTaskDetails = useCallback(async (taskId: string) => {
    if (!taskId || taskId.startsWith("temp-")) return;
    if (fetchDetailsAbortRef.current) {
      fetchDetailsAbortRef.current.abort();
    }
    const controller = new AbortController();
    fetchDetailsAbortRef.current = controller;

    try {
      const res = await fetch(`${API_BASE}/api/tasks/${taskId}`, {
        signal: controller.signal,
      });
      if (res.status === 404) {
        taskDetailsCacheRef.current.delete(taskId);
        if (activeTaskIdRef.current === taskId) {
          setActiveTaskId(null, { replaceUrl: true });
          setActiveTaskDetailsState(null);
          setIsSessionLoading(false);
        }
        return;
      }
      if (res.ok) {
        const data = await res.json();
        if (activeTaskIdRef.current === taskId) {
          setActiveTaskDetails((prev) => {
            const isCurrentlyRunning = data.status === "RUNNING" || data.status === "INITIALIZING";

            // Fast short-circuit: if cached task is already complete and unchanged on server, keep reference to prevent a second full DOM re-render
            if (
              prev &&
              prev.id === taskId &&
              !isCurrentlyRunning &&
              prev.status === data.status &&
              prev.updated_at === data.updated_at &&
              (prev.messages?.length || 0) > 0 &&
              (prev.messages?.length || 0) === (data.messages?.length || 0) &&
              (prev.logs?.length || 0) === (data.logs?.length || 0) &&
              (prev.diffs?.length || 0) === (data.diffs?.length || 0) &&
              prev.result_summary === data.result_summary &&
              !(prev.messages || []).some((m) => m.isStreaming || m.isOptimistic)
            ) {
              return prev;
            }

            const sortByCreatedAt = <T extends { created_at?: string }>(items: T[]): T[] =>
              [...items].sort((a, b) => {
                const tA = a.created_at ? new Date(a.created_at).getTime() : Number.MAX_SAFE_INTEGER;
                const tB = b.created_at ? new Date(b.created_at).getTime() : Number.MAX_SAFE_INTEGER;
                return tA - tB;
              });

            if (!prev || prev.id !== taskId) {
              return {
                ...data,
                messages: sortByCreatedAt(data.messages || []),
                logs: sortByCreatedAt(
                  isCurrentlyRunning ? (data.logs || []) : (data.logs || []).map((l: any) => ({ ...l, isRunning: false }))
                ),
                active_tool: isCurrentlyRunning ? data.active_tool : null,
              };
            }

            const localMessages = prev.messages || [];
            const serverMessages: TaskMessage[] = sortByCreatedAt(data.messages || []);

            const isMatch = (localMsg: TaskMessage, serverMsg: TaskMessage) => {
              if (serverMsg.id === localMsg.id) return true;
              if (
                serverMsg.sender === localMsg.sender &&
                serverMsg.content.trim() === localMsg.content.trim() &&
                serverMsg.content.trim().length > 0
              ) {
                return true;
              }
              // Deduplicate stop/cancellation messages even if formatted slightly differently
              if (
                localMsg.content.includes("Task stopped") &&
                serverMsg.content.includes("Task stopped")
              ) {
                return true;
              }
              return false;
            };

            const inFlightMessages = localMessages.filter(
              (m) => m.isStreaming || (m.isOptimistic && !serverMessages.some((sm) => isMatch(m, sm)))
            );

            const serverLogs = sortByCreatedAt(data.logs || []);
            const runningLogs = isCurrentlyRunning
              ? (prev.logs || []).filter((l: any) => l.isRunning && !serverLogs.some((sl: any) => sl.id === l.id))
              : [];
            const rawMergedLogs = runningLogs.length > 0 ? [...serverLogs, ...runningLogs] : serverLogs;
            const mergedLogs = sortByCreatedAt(
              isCurrentlyRunning
                ? rawMergedLogs
                : rawMergedLogs.map((l: any) => ({ ...l, isRunning: false }))
            );
            const nextActiveTool = isCurrentlyRunning
              ? (prev.active_tool && data.status === "RUNNING" ? prev.active_tool : data.active_tool)
              : null;

            if (inFlightMessages.length === 0) {
              return {
                ...data,
                messages: serverMessages,
                logs: mergedLogs,
                active_tool: nextActiveTool,
              };
            }

            const mergedMessages = [...serverMessages];
            for (const inflight of inFlightMessages) {
              const alreadyPresent = serverMessages.some((sm) => isMatch(inflight, sm));
              if (!alreadyPresent) {
                mergedMessages.push(inflight);
              }
            }

            return {
              ...data,
              messages: sortByCreatedAt(mergedMessages),
              logs: mergedLogs,
              active_tool: nextActiveTool,
            };
          });

        }
      }
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      console.error("Error fetching task details:", err);
    } finally {
      if (activeTaskIdRef.current === taskId) {
        setIsSessionLoading(false);
      }
    }
  }, [setActiveTaskId, setActiveTaskDetails]);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/tasks`);
      if (res.ok) {
        const data: Task[] = await res.json();
        setTasks(data);

        // Auto-restore or select active task on load / reload
        const currentActive = activeTaskIdRef.current;
        const route = parseCurrentRoute();
        let isDraftMode = false;
        try {
          isDraftMode = sessionStorage.getItem("cyclode_draft_mode") === "1";
        } catch {
          // ignore
        }

        if (currentActive && currentActive.startsWith("temp-")) {
          // Keep optimistic temporary session active until POST /api/tasks resolves
          return;
        }

        if (data.length === 0) {
          if (currentActive) {
            setActiveTaskId(null, { replaceUrl: true, skipUrl: route.view !== "chat" });
            setActiveTaskDetailsState(null);
          }
          setIsSessionLoading(false);
        } else if (isDraftMode) {
          setIsSessionLoading(false);
        } else if (route.sessionId && currentActive === route.sessionId) {
          // Explicit /session/{id} route: let fetchTaskDetails(route.sessionId) handle hydration or 404 fallback
        } else if (!currentActive || !data.some((t: Task) => t.id === currentActive)) {
          let savedId: string | null = null;
          try {
            savedId = localStorage.getItem("cyclode_active_task_id");
          } catch {
            // ignore
          }
          const target = (savedId && data.find((t: Task) => t.id === savedId)) || data.find((t: Task) => !t.is_subsession) || data[0];
          if (target) {
            if (!taskDetailsCacheRef.current.has(target.id)) {
              setIsSessionLoading(true);
            }
            setActiveTaskId(target.id, { replaceUrl: true, skipUrl: route.view !== "chat" });
            fetchTaskDetails(target.id);
          } else {
            setIsSessionLoading(false);
          }
        }
      }
    } catch (err) {
      console.error("Error fetching tasks:", err);
    } finally {
      setIsLoadingTasks(false);
    }
  }, [fetchTaskDetails, setActiveTaskId]);

  return {
    tasks,
    activeTaskId,
    activeTaskDetails,
    sessionPreviews,
    sessionFiles,
    sessionFileLines,
    sessionAuxTabs,
    sessionDrafts,
    isClearingAll,
    deletingTaskId,
    isLoadingTasks,
    isSessionLoading,
    setIsSessionLoading,
    fetchTasks,
    fetchTaskDetails,
    setActiveTaskId,
    setActiveTaskDetails,
    setTasks,
    setSessionPreviews,
    setSessionFiles,
    setSessionFileLines,
    setSessionAuxTabs,
    setSessionDrafts,
    setSessionDraft,
    setIsClearingAll,
    setDeletingTaskId,
    activeTaskIdRef,
  };
}
