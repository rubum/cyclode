import { useState, useCallback, useRef, useEffect } from "react";
import { Task, TaskMessage } from "../types";

const API_BASE = import.meta.env.VITE_API_URL || "";

export interface TaskStoreState {
  tasks: Task[];
  activeTaskId: string | null;
  activeTaskDetails: Task | null;
  sessionPreviews: Record<string, { url: string; title?: string } | null>;
  isClearingAll: boolean;
  deletingTaskId: string | null;
  fetchTasks: () => Promise<void>;
  fetchTaskDetails: (taskId: string) => Promise<void>;
  setActiveTaskId: (id: string | null) => void;
  setActiveTaskDetails: React.Dispatch<React.SetStateAction<Task | null>>;
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  setSessionPreviews: React.Dispatch<React.SetStateAction<Record<string, { url: string; title?: string } | null>>>;
  setIsClearingAll: (clearing: boolean) => void;
  setDeletingTaskId: (id: string | null) => void;
  activeTaskIdRef: React.MutableRefObject<string | null>;
}

export function useTaskStore(): TaskStoreState {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeTaskDetails, setActiveTaskDetails] = useState<Task | null>(null);
  const [sessionPreviews, setSessionPreviews] = useState<Record<string, { url: string; title?: string } | null>>({});
  const [isClearingAll, setIsClearingAll] = useState<boolean>(false);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);

  const activeTaskIdRef = useRef<string | null>(activeTaskId);
  useEffect(() => {
    activeTaskIdRef.current = activeTaskId;
  }, [activeTaskId]);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/tasks`);
      if (res.ok) {
        const data = await res.json();
        setTasks(data);
      }
    } catch (err) {
      console.error("Error fetching tasks:", err);
    }
  }, []);

  const fetchTaskDetails = useCallback(async (taskId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/tasks/${taskId}`);
      if (res.ok) {
        const data = await res.json();
        if (activeTaskIdRef.current === taskId) {
          setActiveTaskDetails((prev) => {
            if (!prev || prev.id !== taskId) return data;

            const localMessages = prev.messages || [];
            const serverMessages: TaskMessage[] = data.messages || [];

            const inFlightMessages = localMessages.filter(
              (m) => m.isStreaming || (m.isOptimistic && !serverMessages.some((sm) => sm.content === m.content))
            );

            if (inFlightMessages.length === 0) {
              return {
                ...data,
                active_tool: prev.active_tool && data.status === "RUNNING" ? prev.active_tool : data.active_tool,
              };
            }

            const mergedMessages = [...serverMessages];
            for (const inflight of inFlightMessages) {
              const alreadyPresent = serverMessages.some(
                (sm) =>
                  sm.id === inflight.id ||
                  (sm.sender === inflight.sender &&
                    sm.content.trim() === inflight.content.trim() &&
                    sm.content.trim().length > 0)
              );
              if (!alreadyPresent) {
                mergedMessages.push(inflight);
              }
            }

            return {
              ...data,
              messages: mergedMessages,
              active_tool: prev.active_tool && data.status === "RUNNING" ? prev.active_tool : data.active_tool,
            };
          });
        }
      }
    } catch (err) {
      console.error("Error fetching task details:", err);
    }
  }, []);

  return {
    tasks,
    activeTaskId,
    activeTaskDetails,
    sessionPreviews,
    isClearingAll,
    deletingTaskId,
    fetchTasks,
    fetchTaskDetails,
    setActiveTaskId,
    setActiveTaskDetails,
    setTasks,
    setSessionPreviews,
    setIsClearingAll,
    setDeletingTaskId,
    activeTaskIdRef,
  };
}
