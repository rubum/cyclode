import { useState, useCallback, useRef, useEffect } from "react";
import { Task, TaskMessage, AuxTabType } from "../types";

const API_BASE = import.meta.env.VITE_API_URL || "";

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
  isSessionLoading: boolean;
  setIsSessionLoading: React.Dispatch<React.SetStateAction<boolean>>;
  fetchTasks: () => Promise<void>;
  fetchTaskDetails: (taskId: string) => Promise<void>;
  setActiveTaskId: (id: string | null) => void;
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
  const [activeTaskId, setActiveTaskIdState] = useState<string | null>(() => {
    try {
      return localStorage.getItem("cyclode_active_task_id") || null;
    } catch {
      return null;
    }
  });

  const activeTaskIdRef = useRef<string | null>(activeTaskId);
  useEffect(() => {
    activeTaskIdRef.current = activeTaskId;
  }, [activeTaskId]);

  const setActiveTaskId = useCallback((id: string | null) => {
    setActiveTaskIdState(id);
    activeTaskIdRef.current = id;
    try {
      if (id && !id.startsWith("temp-")) {
        localStorage.setItem("cyclode_active_task_id", id);
      } else if (!id) {
        localStorage.removeItem("cyclode_active_task_id");
      }
    } catch {
      // ignore
    }
  }, []);

  const [activeTaskDetails, setActiveTaskDetails] = useState<Task | null>(null);
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
  const [isSessionLoading, setIsSessionLoading] = useState<boolean>(() => !!activeTaskId);

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
    try {
      const res = await fetch(`${API_BASE}/api/tasks/${taskId}`);
      if (res.ok) {
        const data = await res.json();
        if (activeTaskIdRef.current === taskId) {
          setActiveTaskDetails((prev) => {
            if (!prev || prev.id !== taskId) return data;

            const localMessages = prev.messages || [];
            const serverMessages: TaskMessage[] = data.messages || [];

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

            const serverLogs = data.logs || [];
            const runningLogs = (prev.logs || []).filter((l: any) => l.isRunning && !serverLogs.some((sl: any) => sl.id === l.id));
            const mergedLogs = runningLogs.length > 0 ? [...serverLogs, ...runningLogs] : serverLogs;

            if (inFlightMessages.length === 0) {
              return {
                ...data,
                logs: mergedLogs,
                active_tool: prev.active_tool && data.status === "RUNNING" ? prev.active_tool : data.active_tool,
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
              messages: mergedMessages,
              logs: mergedLogs,
              active_tool: prev.active_tool && data.status === "RUNNING" ? prev.active_tool : data.active_tool,
            };
          });

        }
      }
    } catch (err) {
      console.error("Error fetching task details:", err);
    } finally {
      if (activeTaskIdRef.current === taskId) {
        setIsSessionLoading(false);
      }
    }
  }, []);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/tasks`);
      if (res.ok) {
        const data: Task[] = await res.json();
        setTasks(data);

        // Auto-restore or select active task on load / reload
        const currentActive = activeTaskIdRef.current;
        if ((!currentActive || !data.some((t: Task) => t.id === currentActive)) && data.length > 0) {
          let savedId: string | null = null;
          try {
            savedId = localStorage.getItem("cyclode_active_task_id");
          } catch {
            // ignore
          }
          const target = (savedId && data.find((t: Task) => t.id === savedId)) || data.find((t: Task) => !t.is_subsession) || data[0];
          if (target) {
            setIsSessionLoading(true);
            setActiveTaskId(target.id);
            fetchTaskDetails(target.id);
          }
        }
      }
    } catch (err) {
      console.error("Error fetching tasks:", err);
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
