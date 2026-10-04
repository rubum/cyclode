import React, { useState, useEffect, useCallback, useRef } from 'react';
import { WebSocketProvider, useWebSocket } from './contexts/WebSocketContext';
import { Sidebar } from './components/Sidebar/Sidebar';
import { ResizablePanes } from './components/Layout/ResizablePanes';
import { ChatCanvas } from './components/Chat/ChatCanvas';
import { AuxiliaryPane, AuxTabType } from './components/AuxiliaryPane/AuxiliaryPane';
import { FleetDashboard } from './components/Fleet/FleetDashboard';
import { EventInbox } from './components/Events/EventInbox';
import { WebhookSimulator } from './components/Simulator/WebhookSimulator';
import { AutomationsView } from './components/Automations/AutomationsView';
import { PolicySettings } from './components/Policies/PolicySettings';
import { IntegrationsView } from './components/Integrations/IntegrationsView';
import { RepositoriesView } from './components/Repositories/RepositoriesView';
import { SandboxInspectorModal } from './components/Sandbox/SandboxInspectorModal';
import { Task, TaskMessage, TaskLog, EventItem, PolicyMap, Integration, AutomationRule, SkillCatalogItem, WebhookEndpoint, RepositoryConfig, LayoutPreset } from './types';

const API_BASE = import.meta.env.VITE_API_URL || '';

const MainApp: React.FC = () => {
  const { subscribe } = useWebSocket();
  const [activeView, setActiveView] = useState<string>('chat');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [repositories, setRepositories] = useState<RepositoryConfig[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeTaskDetails, setActiveTaskDetails] = useState<Task | null>(null);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [automations, setAutomations] = useState<AutomationRule[]>([]);
  const [policies, setPolicies] = useState<PolicyMap>({});
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [activeSkills, setActiveSkills] = useState<string[]>([]);
  const [skillsCatalog, setSkillsCatalog] = useState<SkillCatalogItem[]>([]);
  const [webhookEndpoints, setWebhookEndpoints] = useState<WebhookEndpoint[]>([]);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);
  const [currentPreset, setCurrentPreset] = useState<LayoutPreset>(() => {
    try {
      const saved = localStorage.getItem('cyclode_layout_preset');
      if (saved && ['split', 'preview', 'wide', 'fullscreen', 'standard'].includes(saved)) {
        return (saved === 'standard' ? 'split' : saved) as LayoutPreset;
      }
    } catch {
      // ignore
    }
    return 'split';
  });
  const [activeAuxTab, setActiveAuxTab] = useState<AuxTabType>('terminal');
  const [sessionPreviews, setSessionPreviews] = useState<Record<string, { url: string; title?: string } | null>>({});
  const [sessionFiles, setSessionFiles] = useState<Record<string, string | null>>({});
  const [sessionFileLines, setSessionFileLines] = useState<Record<string, number | null>>({});
  const [sessionAuxTabs, setSessionAuxTabs] = useState<Record<string, AuxTabType>>({});

  const currentTaskAuxTab = activeTaskId ? (sessionAuxTabs[activeTaskId] || activeAuxTab) : activeAuxTab;
  const activePreviewTarget = activeTaskId ? (sessionPreviews[activeTaskId] || null) : (sessionPreviews['draft'] || null);
  const selectedAuxFilePath = activeTaskId ? (sessionFiles[activeTaskId] || null) : (sessionFiles['draft'] || null);
  const selectedAuxFileLine = activeTaskId ? (sessionFileLines[activeTaskId] || null) : (sessionFileLines['draft'] || null);

  const handleAuxTabChange = useCallback((tab: AuxTabType) => {
    setActiveAuxTab(tab);
    const sessionKey = activeTaskIdRef.current || 'draft';
    setSessionAuxTabs((prev) => ({ ...prev, [sessionKey]: tab }));
  }, []);

  const handleAuxSelectFile = useCallback((filePath: string, line?: number) => {
    const sessionKey = activeTaskIdRef.current || 'draft';
    setSessionFiles((prev) => ({ ...prev, [sessionKey]: filePath }));
    if (line !== undefined) {
      setSessionFileLines((prev) => ({ ...prev, [sessionKey]: line }));
    }
  }, []);
  const [isClearingAll, setIsClearingAll] = useState<boolean>(false);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);

  const [isSandboxModalOpen, setIsSandboxModalOpen] = useState<boolean>(false);
  const streamBufferRef = useRef<Map<string, any>>(new Map());
  const streamRafRef = useRef<number | null>(null);
  const activeTaskIdRef = useRef<string | null>(activeTaskId);

  useEffect(() => {
    activeTaskIdRef.current = activeTaskId;
  }, [activeTaskId]);

  // Fetch tasks
  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/tasks`);
      if (res.ok) {
        const data = await res.json();
        setTasks(data);
      }
    } catch (err) {
      console.error('Error fetching tasks:', err);
    }
  }, []);

  // Fetch active task details
  const fetchTaskDetails = useCallback(async (taskId: string) => {
    if (!taskId || taskId.startsWith('temp-')) return;
    try {
      const res = await fetch(`${API_BASE}/api/tasks/${taskId}`);
      if (res.ok) {
        const data = await res.json();
        // Guard against race conditions: only update if user is still viewing this task
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
                localMsg.content.includes('Task stopped') &&
                serverMsg.content.includes('Task stopped')
              ) {
                return true;
              }
              return false;
            };

            const inFlightMessages = localMessages.filter(
              (m) => m.isStreaming || (m.isOptimistic && !serverMessages.some((sm) => isMatch(m, sm)))
            );

            const serverLogs: TaskLog[] = data.logs || [];
            const runningLogs = (prev.logs || []).filter((l) => l.isRunning && !serverLogs.some((sl) => sl.id === l.id));
            const mergedLogs = runningLogs.length > 0 ? [...serverLogs, ...runningLogs] : serverLogs;

            if (inFlightMessages.length === 0) {
              return {
                ...data,
                logs: mergedLogs,
                active_tool: prev.active_tool && data.status === 'RUNNING' ? prev.active_tool : data.active_tool,
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
              active_tool: prev.active_tool && data.status === 'RUNNING' ? prev.active_tool : data.active_tool,
            };
          });
        }
      }
    } catch (err) {
      console.error('Error fetching task details:', err);
    }
  }, []);

  // Fetch automations
  const fetchAutomations = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/automations`);
      if (res.ok) {
        const data = await res.json();
        setAutomations(data);
      }
    } catch (err) {
      console.error('Error fetching automations:', err);
    }
  }, []);

  // Fetch events
  const fetchEvents = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/events`);
      if (res.ok) {
        const data = await res.json();
        setEvents(data);
      }
    } catch (err) {
      console.error('Error fetching events:', err);
    }
  }, []);

  // Fetch policies
  const fetchPolicies = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/policies`);
      if (res.ok) {
        const data = await res.json();
        setPolicies(data);
      }
    } catch (err) {
      console.error('Error fetching policies:', err);
    }
  }, []);

  // Fetch integrations
  const fetchIntegrations = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/integrations`);
      if (res.ok) {
        const data = await res.json();
        setIntegrations(data.integrations || []);
        setActiveSkills(data.active_skills || []);
        setSkillsCatalog(data.skills_catalog || []);
        setWebhookEndpoints(data.webhook_endpoints || []);
      }
    } catch (err) {
      console.error('Error fetching integrations:', err);
    }
  }, []);

  // Fetch repositories
  const fetchRepositories = useCallback(async () => {
    const endpoints = [
      `${API_BASE}/api/repositories`,
      '/api/repositories',
      'http://localhost:8000/api/repositories',
      'http://127.0.0.1:8000/api/repositories'
    ];
    for (const url of endpoints) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) {
            setRepositories(data);
            return;
          }
        }
      } catch {
        // try next endpoint
      }
    }
  }, []);

  useEffect(() => {
    fetchTasks();
    fetchAutomations();
    fetchEvents();
    fetchPolicies();
    fetchIntegrations();
    fetchRepositories();
  }, [fetchTasks, fetchAutomations, fetchEvents, fetchPolicies, fetchIntegrations, fetchRepositories]);

  useEffect(() => {
    if (activeTaskId) {
      fetchTaskDetails(activeTaskId);
    } else {
      setActiveTaskDetails(null);
    }
  }, [activeTaskId, fetchTaskDetails]);

  // WebSocket event listeners
  useEffect(() => {
    const unsubTaskCreated = subscribe('TASK_CREATED', (data: any) => {
      fetchTasks();
      // Only auto-focus newly created task if not a subsession AND (if no task is currently active or if user was waiting on a temp task)
      if (!data.is_subsession && (!activeTaskIdRef.current || activeTaskIdRef.current.startsWith('temp-'))) {
        setActiveTaskId(data.id);
        activeTaskIdRef.current = data.id;
        setActiveView('chat');
        fetchTaskDetails(data.id);
      }
    });

    const unsubStatus = subscribe('TASK_STATUS_CHANGE', (data: any) => {
      fetchTasks();
      if (activeTaskId === data.task_id) {
        fetchTaskDetails(data.task_id);
      }
    });

    const unsubTitleUpdated = subscribe('TASK_TITLE_UPDATED', (data: any) => {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === data.task_id
            ? { ...t, title: data.title, custom_title: data.custom_title }
            : t
        )
      );
      setActiveTaskDetails((prev) =>
        prev && prev.id === data.task_id
          ? { ...prev, title: data.title, custom_title: data.custom_title }
          : prev
      );
    });

    const unsubStreamStart = subscribe('STREAM_START', (data: any) => {
      if (activeTaskId === data.task_id) {
        setActiveTaskDetails((prev) => {
          if (!prev) return prev;
          const messages = [...(prev.messages || [])];
          const existingIdx = messages.findIndex((m) => m.id === data.stream_id);
          if (existingIdx >= 0) {
            messages[existingIdx] = {
              ...messages[existingIdx],
              isStreaming: true,
            };
          } else {
            messages.push({
              id: data.stream_id,
              task_id: data.task_id,
              sender: data.sender || 'agent',
              content: '',
              thought: data.stream_type === 'thought' ? '' : undefined,
              isStreaming: true,
              created_at: data.timestamp || new Date().toISOString(),
            });
          }
          return { ...prev, status: 'RUNNING', messages };
        });
      }
    });

    const flushStreamBuffer = () => {
      if (streamBufferRef.current.size === 0) return;
      const chunks = Array.from(streamBufferRef.current.values());
      streamBufferRef.current.clear();

      setActiveTaskDetails((prev) => {
        if (!prev) return prev;
        let messages = [...(prev.messages || [])];
        for (const data of chunks) {
          if (activeTaskId !== data.task_id) continue;
          const existingIdx = messages.findIndex((m) => m.id === data.stream_id);
          if (existingIdx >= 0) {
            messages[existingIdx] = {
              ...messages[existingIdx],
              content: data.accumulated,
              thought: data.stream_type === 'thought' ? data.accumulated : messages[existingIdx].thought,
              isStreaming: true,
            };
          } else {
            messages.push({
              id: data.stream_id,
              task_id: data.task_id,
              sender: 'agent',
              content: data.accumulated,
              thought: data.stream_type === 'thought' ? data.accumulated : undefined,
              isStreaming: true,
              created_at: new Date().toISOString(),
            });
          }
        }
        return { ...prev, messages };
      });
    };

    const unsubStreamChunk = subscribe('STREAM_CHUNK', (data: any) => {
      if (activeTaskId === data.task_id) {
        streamBufferRef.current.set(data.stream_id, data);
        if (!streamRafRef.current) {
          streamRafRef.current = requestAnimationFrame(() => {
            streamRafRef.current = null;
            flushStreamBuffer();
          });
        }
      }
    });

    const unsubStreamEnd = subscribe('STREAM_END', (data: any) => {
      if (activeTaskId === data.task_id) {
        if (streamRafRef.current) {
          cancelAnimationFrame(streamRafRef.current);
          streamRafRef.current = null;
        }
        streamBufferRef.current.delete(data.stream_id);

        setActiveTaskDetails((prev) => {
          if (!prev) return prev;
          const messages = [...(prev.messages || [])];
          const existingIdx = messages.findIndex((m) => m.id === data.stream_id);
          if (existingIdx >= 0) {
            messages[existingIdx] = {
              ...messages[existingIdx],
              content: data.final_content,
              thought: data.stream_type === 'thought' ? data.final_content : messages[existingIdx].thought,
              tokens: data.tokens,
              isStreaming: false,
            };
          } else {
            messages.push({
              id: data.stream_id,
              task_id: data.task_id,
              sender: 'agent',
              content: data.final_content,
              thought: data.stream_type === 'thought' ? data.final_content : undefined,
              tokens: data.tokens,
              isStreaming: false,
              created_at: data.timestamp || new Date().toISOString(),
            });
          }
          return { ...prev, messages };
        });
      }
    });

    const unsubThought = subscribe('AGENT_THOUGHT', (data: any) => {
      if (activeTaskId === data.task_id) {
        setActiveTaskDetails((prev) => {
          if (!prev) return prev;
          const messages = [...(prev.messages || [])];
          
          // Reconcile with existing streamed thought or matching thought entry
          const thoughtIdx = messages.findIndex(
            (m) =>
              (data.id && m.id === data.id) ||
              (data.stream_id && m.id === data.stream_id) ||
              (m.thought && data.thought && m.thought.trim() === data.thought.trim()) ||
              (m.content && data.thought && m.content.trim() === data.thought.trim() && m.thought)
          );

          if (thoughtIdx >= 0) {
            messages[thoughtIdx] = {
              ...messages[thoughtIdx],
              id: data.id || messages[thoughtIdx].id,
              thought: data.thought,
              content: data.thought,
              tokens: data.tokens ?? messages[thoughtIdx].tokens,
              isStreaming: false,
              created_at: messages[thoughtIdx].created_at || data.timestamp || new Date().toISOString(),
            };
            return { ...prev, messages };
          }

          return {
            ...prev,
            messages: [
              ...messages,
              {
                id: data.id || `thought-${Date.now()}`,
                task_id: data.task_id,
                sender: 'agent',
                content: data.thought,
                thought: data.thought,
                tokens: data.tokens,
                isStreaming: false,
                created_at: data.timestamp || new Date().toISOString(),
              },
            ],
          };
        });
      }
    });

    const unsubToolStart = subscribe('TOOL_START', (data: any) => {
      if (activeTaskId === data.task_id) {
        setActiveTaskDetails((prev) => {
          if (!prev) return prev;
          const currentLogs = [...(prev.logs || [])];
          const callId = data.call_id || `live-log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          
          if (currentLogs.some((l: any) => (l.call_id && l.call_id === callId) || l.id === callId)) {
            return prev;
          }

          const newRunningLog: TaskLog & { call_id?: string } = {
            id: callId,
            task_id: data.task_id,
            tool_name: data.tool_name,
            tool_input: data.tool_input || {},
            tool_output: '',
            exit_code: 0,
            duration_ms: 0,
            created_at: data.timestamp || new Date().toISOString(),
            isRunning: true,
            call_id: data.call_id,
          };
          return {
            ...prev,
            active_tool: {
              tool_name: data.tool_name,
              tool_input: data.tool_input || {},
              timestamp: data.timestamp || new Date().toISOString(),
            },
            logs: [...currentLogs, newRunningLog],
          };
        });
      }
    });

    const unsubToolEnd = subscribe('TOOL_END', (data: any) => {
      if (activeTaskId === data.task_id) {
        setActiveTaskDetails((prev) => {
          if (!prev) return prev;
          let matched = false;
          const logs = (prev.logs || []).map((l: any) => {
            // First priority: match exact call_id
            if (data.call_id && (l.call_id === data.call_id || l.id === data.call_id)) {
              matched = true;
              return {
                ...l,
                id: data.id || l.id,
                tool_output: data.tool_output,
                exit_code: data.exit_code,
                duration_ms: data.duration_ms,
                isRunning: false,
              };
            }
            // Fallback: match first running log with same tool_name if not matched by call_id
            if (!matched && !data.call_id && l.isRunning && l.tool_name === data.tool_name) {
              matched = true;
              return {
                ...l,
                id: data.id || l.id,
                tool_output: data.tool_output,
                exit_code: data.exit_code,
                duration_ms: data.duration_ms,
                isRunning: false,
              };
            }
            return l;
          });
          return {
            ...prev,
            active_tool: null,
            logs,
          };
        });
        fetchTaskDetails(data.task_id);
      }
    });

    const unsubDiff = subscribe('DIFF_UPDATED', (data: any) => {
      if (activeTaskId === data.task_id) {
        setActiveTaskDetails((prev) => (prev ? { ...prev, diffs: data.diffs } : prev));
      }
    });

    const unsubPrUpdated = subscribe('TASK_PR_UPDATED', (data: any) => {
      if (activeTaskId === data.task_id) {
        fetchTaskDetails(data.task_id);
      }
    });

    const unsubPrTestCompleted = subscribe('TASK_PR_TEST_COMPLETED', (data: any) => {
      if (activeTaskId === data.task_id) {
        fetchTaskDetails(data.task_id);
      }
    });

    const unsubPrReviewed = subscribe('TASK_PR_REVIEWED', (data: any) => {
      if (activeTaskId === data.task_id) {
        fetchTaskDetails(data.task_id);
      }
    });

    const unsubApproval = subscribe('APPROVAL_REQUIRED', (data: any) => {
      fetchTasks();
      if (activeTaskId === data.task_id) {
        fetchTaskDetails(data.task_id);
      }
    });

    const unsubPlanUpdated = subscribe('TASK_PLAN_UPDATED', (data: any) => {
      if (activeTaskId === data.task_id) {
        setActiveTaskDetails((prev) => (prev ? { ...prev, plan: data.plan } : prev));
      }
    });

    const unsubChat = subscribe('CHAT_MESSAGE', (data: any) => {
      if (activeTaskId === data.task_id) {
        setActiveTaskDetails((prev) => {
          if (!prev) return prev;
          const messages = [...(prev.messages || [])];
          
          // Reconcile optimistic user message or streamed agent message
          const targetIdx = messages.findIndex((m) => {
            if (data.id && m.id === data.id) return true;
            if (data.stream_id && m.id === data.stream_id) return true;
            if (m.isOptimistic && m.sender === data.sender && m.content.trim() === data.content.trim()) return true;
            if (
              data.sender === 'agent' &&
              m.sender === 'agent' &&
              (m.id.startsWith('msg-') || m.id.startsWith('stream_') || m.isStreaming) &&
              m.content.trim().length > 0 &&
              (m.content.trim() === data.content.trim() || data.content.trim().startsWith(m.content.trim()))
            ) {
              return true;
            }
            return false;
          });

          if (targetIdx >= 0) {
            messages[targetIdx] = {
              ...messages[targetIdx],
              id: data.id || messages[targetIdx].id,
              task_id: data.task_id || messages[targetIdx].task_id,
              sender: data.sender || messages[targetIdx].sender,
              content: data.content,
              tokens: data.tokens ?? messages[targetIdx].tokens,
              plan: data.plan || messages[targetIdx].plan,
              isOptimistic: false,
              isStreaming: false,
              created_at: messages[targetIdx].created_at || data.timestamp || new Date().toISOString(),
            };
            return {
              ...prev,
              plan: data.plan || prev.plan,
              messages,
            };
          }

          return {
            ...prev,
            plan: data.plan || prev.plan,
            messages: [
              ...messages,
              {
                id: data.id || `msg-${Date.now()}`,
                task_id: data.task_id,
                sender: data.sender,
                content: data.content,
                tokens: data.tokens,
                plan: data.plan,
                isStreaming: false,
                created_at: data.timestamp || new Date().toISOString(),
              },
            ],
          };
        });
        fetchTasks();
      }
    });

    const unsubEventReceived = subscribe('EVENT_RECEIVED', (data: any) => {
      fetchEvents();
      fetchTasks();
    });

    const unsubTurnReset = subscribe('TASK_TURN_RESET', (data: any) => {
      if (activeTaskId === data.task_id) {
        fetchTaskDetails(data.task_id);
        fetchTasks();
      }
    });

    return () => {
      if (streamRafRef.current) {
        cancelAnimationFrame(streamRafRef.current);
        streamRafRef.current = null;
      }
      streamBufferRef.current.clear();
      unsubTaskCreated();
      unsubStatus();
      unsubTitleUpdated();
      unsubStreamStart();
      unsubStreamChunk();
      unsubStreamEnd();
      unsubThought();
      unsubToolStart();
      unsubToolEnd();
      unsubDiff();
      unsubPrUpdated();
      unsubPrTestCompleted();
      unsubPrReviewed();
      unsubApproval();
      unsubPlanUpdated();
      unsubChat();
      unsubEventReceived();
      unsubTurnReset();
    };
  }, [subscribe, activeTaskId, fetchTasks, fetchTaskDetails, fetchEvents]);

  const handleSelectTask = (taskId: string) => {
    if (taskId === activeTaskId) return;
    setActiveTaskId(taskId);
    setActiveView('chat');
    const existing = tasks.find((t) => t.id === taskId);
    if (existing) {
      setActiveTaskDetails({
        ...existing,
        messages: existing.messages || [],
      });
    } else {
      setActiveTaskDetails(null);
    }
  };

  const handleNewChat = () => {
    setActiveTaskId(null);
    setActiveTaskDetails(null);
    setActiveView('chat');
    setSessionPreviews((prev) => {
      const next = { ...prev };
      delete next['draft'];
      return next;
    });
    setSessionFiles((prev) => {
      const next = { ...prev };
      delete next['draft'];
      return next;
    });
  };

  const getCleanInitialTitle = (text: string): string => {
    if (!text || !text.trim()) return 'New Session';
    let clean = text.replace(/https?:\/\/\S+/g, '').trim();
    const ghMatch = text.match(/github\.com\/[A-Za-z0-9_.-]+\/([A-Za-z0-9_.-]+)/i);
    const repo = ghMatch ? ghMatch[1].replace('.git', '') : null;
    clean = clean.replace(/^[#*`>\-\s]+/, '');
    clean = clean.replace(/^(?:please\s+)?(?:can\s+you\s+)?(?:could\s+you\s+)?(?:help\s+(?:me\s+)?(?:to\s+)?)?/i, '');
    clean = clean.replace(/\s+/g, ' ').trim();
    if (!clean && repo) return `Explore ${repo}`;
    if (repo && !clean.toLowerCase().includes(repo.toLowerCase())) {
      const words = clean.split(' ').slice(0, 4).join(' ');
      clean = `${words} (${repo})`.trim();
    } else {
      clean = clean.split(' ').slice(0, 6).join(' ');
    }
    clean = clean.replace(/[:;,.\-?!]+$/, '').trim();
    if (clean.length > 50) clean = clean.slice(0, 47).trim() + '...';
    if (clean) clean = clean[0].toUpperCase() + clean.slice(1);
    return clean || 'New Session';
  };

  const handleUpdateTaskTitle = async (taskId: string, newTitle: string) => {
    const trimmed = newTitle.trim();
    if (!trimmed) return;

    // Optimistic update in UI
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, title: trimmed, custom_title: true } : t))
    );
    setActiveTaskDetails((prev) =>
      prev && prev.id === taskId ? { ...prev, title: trimmed, custom_title: true } : prev
    );

    try {
      const res = await fetch(`${API_BASE}/api/tasks/${taskId}/title`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed }),
      });
      if (!res.ok) {
        fetchTasks();
        if (activeTaskId === taskId) {
          fetchTaskDetails(taskId);
        }
      }
    } catch (err) {
      console.error('Error updating task title:', err);
      fetchTasks();
      if (activeTaskId === taskId) {
        fetchTaskDetails(taskId);
      }
    }
  };

  const handleNewChatWithPrompt = async (
    prompt: string,
    persona: string = 'General',
    modelName: string = 'auto',
    files?: File[]
  ) => {
    const tempId = `temp-${Date.now()}`;
    const initialTitle = getCleanInitialTitle(prompt);
    const tempTask: Task = {
      id: tempId,
      title: initialTitle,
      custom_title: false,
      description: prompt,
      persona: persona || 'General',
      model_name: modelName || 'auto',
      status: 'INITIALIZING',
      sandbox_status: 'PROVISIONING',
      workspace_path: '/workspaces/default',
      total_tokens: Math.max(1, Math.round(prompt.length / 4)),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      messages: [
        {
          id: `init-${Date.now()}`,
          task_id: tempId,
          sender: 'user',
          content: prompt,
          tokens: Math.max(1, Math.round(prompt.length / 4)),
          created_at: new Date().toISOString(),
          isOptimistic: true,
        },
      ],
    };

    setTasks((prev) => [tempTask, ...prev]);
    setActiveTaskId(tempId);
    setActiveTaskDetails(tempTask);
    setActiveView('chat');

    try {
      const res = await fetch(`${API_BASE}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: initialTitle,
          description: prompt,
          persona: persona || 'General',
          model_name: modelName || 'auto',
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const createdId = data.id || data.task_id;
        if (createdId) {
          if (activeTaskIdRef.current === tempId) {
            setActiveTaskId(createdId);
            activeTaskIdRef.current = createdId;
          }
          setTasks((prev) =>
            prev.map((t) => (t.id === tempId ? { ...t, ...data, id: createdId } : t))
          );

          // Migrate any draft or tempId session previews and file selections
          setSessionPreviews((prev) => {
            const draftPreview = prev['draft'] || prev[tempId];
            if (!draftPreview) return prev;
            const next = { ...prev, [createdId]: draftPreview };
            delete next['draft'];
            delete next[tempId];
            return next;
          });
          setSessionFiles((prev) => {
            const draftFile = prev['draft'] || prev[tempId];
            if (!draftFile) return prev;
            const next = { ...prev, [createdId]: draftFile };
            delete next['draft'];
            delete next[tempId];
            return next;
          });

          if (files && files.length > 0) {
            try {
              const formData = new FormData();
              files.forEach((f) => {
                const rel = (f as any).webkitRelativePath || (f as any).customRelativePath || f.name;
                formData.append('files', f, rel);
              });
              formData.append('target_type', 'workspace');
              await fetch(`${API_BASE}/api/tasks/${createdId}/files/upload`, {
                method: 'POST',
                body: formData,
              });
            } catch (uploadErr) {
              console.error('Failed to upload initial workspace files:', uploadErr);
            }
          }

          fetchTaskDetails(createdId);
        }
      } else {
        const errJson = await res.json().catch(() => ({}));
        const errMsg = errJson.error || errJson.detail || `Server returned ${res.status}`;
        console.error('Failed to create task:', res.status, errMsg);
        setTasks((prev) =>
          prev.map((t) =>
            t.id === tempId
              ? {
                  ...t,
                  status: 'FAILED',
                  result_summary: errMsg,
                  messages: [
                    ...(t.messages || []),
                    {
                      id: `err-${Date.now()}`,
                      task_id: tempId,
                      sender: 'agent',
                      content: `### ⚠️ Failed to initialize task\n\n${errMsg}`,
                      tokens: 10,
                      created_at: new Date().toISOString(),
                    },
                  ],
                }
              : t
          )
        );
      }
    } catch (err) {
      console.error('Error creating task:', err);
    }
  };

  const handleSendMessage = async (content: string, modelName?: string, files?: File[]) => {
    if (!activeTaskId) return;

    if (files && files.length > 0) {
      try {
        const formData = new FormData();
        files.forEach((f) => {
          const rel = (f as any).webkitRelativePath || (f as any).customRelativePath || f.name;
          formData.append('files', f, rel);
        });
        formData.append('target_type', 'workspace');
        await fetch(`${API_BASE}/api/tasks/${activeTaskId}/files/upload`, {
          method: 'POST',
          body: formData,
        });
      } catch (uploadErr) {
        console.error('Failed to upload workspace files:', uploadErr);
      }
    }

    const optMsgId = `opt-user-${Date.now()}`;
    const optimisticMsg: TaskMessage = {
      id: optMsgId,
      task_id: activeTaskId,
      sender: 'user',
      content: content,
      tokens: Math.max(1, Math.round(content.length / 4)),
      created_at: new Date().toISOString(),
      isOptimistic: true,
    };

    setActiveTaskDetails((prev) => {
      if (!prev) return prev;
      // Freeze the previous turn's active plan onto its last agent message so history is permanently preserved
      const updatedMessages = [...(prev.messages || [])];
      if (prev.plan && updatedMessages.length > 0) {
        for (let i = updatedMessages.length - 1; i >= 0; i--) {
          if (updatedMessages[i].sender === 'agent' && !updatedMessages[i].thought) {
            if (!updatedMessages[i].plan) {
              updatedMessages[i] = { ...updatedMessages[i], plan: prev.plan };
            }
            break;
          }
        }
      }

      return {
        ...prev,
        status: 'RUNNING',
        model_name: modelName || prev.model_name,
        plan: null, // Reset active plan for incoming turn
        messages: [...updatedMessages, optimisticMsg],
      };
    });

    setTasks((prev) =>
      prev.map((t) => (t.id === activeTaskId ? { ...t, status: 'RUNNING', model_name: modelName || t.model_name } : t))
    );

    try {
      await fetch(`${API_BASE}/api/tasks/${activeTaskId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, model_name: modelName }),
      });
    } catch (err) {
      console.error('Error sending message:', err);
    }
  };

  const handleApprove = async (feedback?: string, custom_details?: any) => {
    if (!activeTaskId) return;
    setActiveTaskDetails((prev) => {
      if (!prev) return prev;
      const updatedApprovals = (prev.approvals || []).map((a) =>
        a.status === 'PENDING'
          ? { ...a, status: 'APPROVED' as const, feedback, resolved_at: new Date().toISOString() }
          : a
      );
      return {
        ...prev,
        approvals: updatedApprovals,
      };
    });

    try {
      await fetch(`${API_BASE}/api/tasks/${activeTaskId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback, custom_details }),
      });
      fetchTaskDetails(activeTaskId);
      fetchTasks();
    } catch (err) {
      console.error('Error approving action:', err);
    }
  };

  const handleReject = async (feedback?: string) => {
    if (!activeTaskId) return;
    setActiveTaskDetails((prev) => {
      if (!prev) return prev;
      const updatedApprovals = (prev.approvals || []).map((a) =>
        a.status === 'PENDING'
          ? { ...a, status: 'REJECTED' as const, feedback, resolved_at: new Date().toISOString() }
          : a
      );
      return {
        ...prev,
        status: 'CANCELLED',
        approvals: updatedApprovals,
      };
    });
    setTasks((prev) =>
      prev.map((t) => (t.id === activeTaskId ? { ...t, status: 'CANCELLED' } : t))
    );

    try {
      await fetch(`${API_BASE}/api/tasks/${activeTaskId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback }),
      });
      fetchTaskDetails(activeTaskId);
      fetchTasks();
    } catch (err) {
      console.error('Error rejecting action:', err);
    }
  };

  const handleEditMessage = async (messageId: string, content: string) => {
    if (!activeTaskId) return;
    setActiveTaskDetails((prev) => {
      if (!prev) return prev;
      let newMessages: TaskMessage[] = [];
      if (messageId === 'initial') {
        newMessages = [];
      } else {
        const targetIdx = (prev.messages || []).findIndex((m) => m.id === messageId);
        if (targetIdx >= 0) {
          newMessages = prev.messages!.slice(0, targetIdx + 1).map((m, idx) =>
            idx === targetIdx ? { ...m, content } : m
          );
        } else {
          newMessages = prev.messages || [];
        }
      }
      return {
        ...prev,
        status: 'RUNNING',
        result_summary: null,
        logs: [],
        diffs: [],
        approvals: [],
        description: messageId === 'initial' ? content : prev.description,
        messages: newMessages,
      };
    });
    setTasks((prev) =>
      prev.map((t) => (t.id === activeTaskId ? { ...t, status: 'RUNNING', result_summary: undefined } : t))
    );

    try {
      const url =
        messageId === 'initial'
          ? `${API_BASE}/api/tasks/${activeTaskId}/description`
          : `${API_BASE}/api/tasks/${activeTaskId}/messages/${messageId}/edit`;

      const res = await fetch(url, {
        method: messageId === 'initial' ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (res.ok) {
        fetchTaskDetails(activeTaskId);
        fetchTasks();
      }
    } catch (err) {
      console.error('Error editing message:', err);
    }
  };

  const handleRetryTask = async (fromMessageId?: string) => {
    if (!activeTaskId) return;

    setActiveTaskDetails((prev) => {
      if (!prev) return prev;
      let newMessages: TaskMessage[] = [];
      if (!fromMessageId || fromMessageId === 'initial') {
        if (!fromMessageId && prev.messages && prev.messages.length > 0) {
          // If fromMessageId wasn't passed, retry from the last user message
          const userMsgs = prev.messages.filter((m) => m.sender === 'user');
          if (userMsgs.length > 0) {
            const lastUserMsgId = userMsgs[userMsgs.length - 1].id;
            const targetIdx = prev.messages.findIndex((m) => m.id === lastUserMsgId);
            newMessages = targetIdx >= 0 ? prev.messages.slice(0, targetIdx + 1) : [];
          } else {
            newMessages = [];
          }
        } else {
          // Retrying initial prompt: immediately clear all subsequent messages
          newMessages = [];
        }
      } else {
        const targetIdx = (prev.messages || []).findIndex((m) => m.id === fromMessageId);
        if (targetIdx >= 0) {
          newMessages = prev.messages!.slice(0, targetIdx + 1);
        } else {
          newMessages = [];
        }
      }
      return {
        ...prev,
        status: 'RUNNING',
        result_summary: null,
        logs: [],
        diffs: [],
        approvals: [],
        messages: newMessages,
      };
    });
    setTasks((prev) =>
      prev.map((t) => (t.id === activeTaskId ? { ...t, status: 'RUNNING', result_summary: undefined } : t))
    );

    try {
      const res = await fetch(`${API_BASE}/api/tasks/${activeTaskId}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from_message_id: fromMessageId || null }),
      });
      if (res.ok) {
        fetchTaskDetails(activeTaskId);
        fetchTasks();
      }
    } catch (err) {
      console.error('Error retrying task:', err);
    }
  };

  const handleResetTurn = async (turnIndex?: number) => {
    if (!activeTaskId) return;
    try {
      const res = await fetch(`${API_BASE}/api/tasks/${activeTaskId}/reset-turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turn_index: turnIndex }),
      });
      if (res.ok) {
        fetchTaskDetails(activeTaskId);
        fetchTasks();
      }
    } catch (err) {
      console.error('Error resetting turn:', err);
    }
  };

  const handleStopTask = async () => {
    if (!activeTaskId || activeTaskId.startsWith('temp-')) return;
    setActiveTaskDetails((prev) =>
      prev
        ? {
            ...prev,
            status: 'CANCELLED',
          }
        : prev
    );
    setTasks((prev) =>
      prev.map((t) => (t.id === activeTaskId ? { ...t, status: 'CANCELLED' } : t))
    );

    try {
      await fetch(`${API_BASE}/api/tasks/${activeTaskId}/stop`, {
        method: 'POST',
      });
      fetchTaskDetails(activeTaskId);
      fetchTasks();
    } catch (err) {
      console.error('Error stopping task:', err);
    }
  };

  const handleToggleRule = async (ruleId: string, enabled: boolean) => {
    try {
      const res = await fetch(`${API_BASE}/api/automations/${ruleId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (res.ok) {
        fetchAutomations();
      }
    } catch (err) {
      console.error('Error toggling rule:', err);
    }
  };

  const handleCreateRule = async (rule: Partial<AutomationRule>) => {
    try {
      const res = await fetch(`${API_BASE}/api/automations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rule),
      });
      if (res.ok) {
        fetchAutomations();
      }
    } catch (err) {
      console.error('Error creating rule:', err);
    }
  };

  const handleDeleteRule = async (ruleId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/automations/${ruleId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        fetchAutomations();
      }
    } catch (err) {
      console.error('Error deleting rule:', err);
    }
  };

  const handleSimulateWebhook = async (data: { source: string; event_type: string; payload: any }) => {
    const res = await fetch(`${API_BASE}/api/events/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return await res.json();
  };

  const handleUpdatePolicies = async (newPolicies: PolicyMap) => {
    const res = await fetch(`${API_BASE}/api/policies`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ policies: newPolicies }),
    });
    const updated = await res.json();
    setPolicies(updated);
  };

  const handleDeleteTask = async (taskId: string) => {
    // 1. Snapshot previous state for rollback
    const prevTasks = [...tasks];
    const prevActiveId = activeTaskId;
    const prevActiveDetails = activeTaskDetails;

    // 2. Optimistic local state eviction
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    setSessionPreviews((prev) => {
      const next = { ...prev };
      delete next[taskId];
      return next;
    });

    if (activeTaskId === taskId) {
      const remaining = prevTasks.filter((t) => t.id !== taskId && !t.is_subsession);
      if (remaining.length > 0) {
        setActiveTaskId(remaining[0].id);
      } else {
        setActiveTaskId(null);
        setActiveTaskDetails(null);
      }
    }

    try {
      const res = await fetch(`${API_BASE}/api/tasks/${taskId}`, {
        method: 'DELETE',
      });
      if (!res.ok && res.status !== 404) {
        console.error('Failed to delete task:', res.status, res.statusText);
        setTasks(prevTasks);
        setActiveTaskId(prevActiveId);
        setActiveTaskDetails(prevActiveDetails);
      }
    } catch (err) {
      console.error('Error deleting task:', err);
      setTasks(prevTasks);
      setActiveTaskId(prevActiveId);
      setActiveTaskDetails(prevActiveDetails);
    }
  };

  const handleClearAllTasks = async () => {
    const prevTasks = [...tasks];
    const prevActiveId = activeTaskId;
    const prevActiveDetails = activeTaskDetails;

    // Optimistically clear all local sessions immediately
    setTasks([]);
    setActiveTaskId(null);
    setActiveTaskDetails(null);
    setSessionPreviews({});

    try {
      const res = await fetch(`${API_BASE}/api/tasks`, {
        method: 'DELETE',
      });
      if (!res.ok && res.status !== 404) {
        console.error('Failed to clear all tasks:', res.status, res.statusText);
        setTasks(prevTasks);
        setActiveTaskId(prevActiveId);
        setActiveTaskDetails(prevActiveDetails);
      }
    } catch (err) {
      console.error('Error clearing all tasks:', err);
      setTasks(prevTasks);
      setActiveTaskId(prevActiveId);
      setActiveTaskDetails(prevActiveDetails);
    }
  };

  const handleOpenFile = (filePath: string) => {
    const sessionKey = activeTaskId || 'draft';
    setSessionFiles((prev) => ({ ...prev, [sessionKey]: filePath }));
    handleAuxTabChange('files');
  };

  const handleOpenDoc = (target: { url: string; title?: string }) => {
    const sessionKey = activeTaskId || 'draft';
    setSessionPreviews((prev) => ({ ...prev, [sessionKey]: target }));
    handleAuxTabChange('docs');
  };

  const renderCenterView = () => {
    switch (activeView) {
      case 'chat':
        return (
          <ChatCanvas
            task={activeTaskDetails}
            repositories={repositories}
            onSendMessage={handleSendMessage}
            onApprove={handleApprove}
            onReject={handleReject}
            onNewChatWithPrompt={handleNewChatWithPrompt}
            onEditMessage={handleEditMessage}
            onRetryTask={handleRetryTask}
            onResetTurn={handleResetTurn}
            onStopTask={handleStopTask}
            onUpdateTaskTitle={handleUpdateTaskTitle}
            isSidebarCollapsed={isSidebarCollapsed}
            onToggleSidebar={handleToggleSidebar}
            currentPreset={currentPreset}
            onSetPreset={handleSetPreset}
            onOpenSandboxModal={() => setIsSandboxModalOpen(true)}
            onSelectAuxTab={handleSelectAuxTab}
            onOpenFile={handleOpenFile}
            onOpenDoc={handleOpenDoc}
            onOpenPreview={handleOpenPreview}
            onOpenPlan={handleOpenPlanDocument}
            onNavigateToRepos={() => setActiveView('repositories')}
          />
        );
      case 'automations':
        return (
          <AutomationsView
            automations={automations}
            onToggleRule={handleToggleRule}
            onCreateRule={handleCreateRule}
            onDeleteRule={handleDeleteRule}
            onNavigateToSimulator={() => setActiveView('simulator')}
            onBackToChat={() => setActiveView('chat')}
          />
        );
      case 'fleet':
        return (
          <FleetDashboard
            tasks={tasks}
            onSelectTask={handleSelectTask}
            onNewChat={handleNewChat}
            onBackToChat={() => setActiveView('chat')}
          />
        );
      case 'events':
        return (
          <EventInbox 
            events={events} 
            onRefresh={fetchEvents} 
            onSelectTask={handleSelectTask} 
            onBackToChat={() => setActiveView('chat')}
            onNavigateToRepos={() => setActiveView('repositories')}
          />
        );
      case 'simulator':
        return (
          <WebhookSimulator
            onSimulate={handleSimulateWebhook}
            onSuccess={(taskId) => {
              setActiveTaskId(taskId);
              setActiveView('chat');
              fetchTasks();
            }}
            onBackToChat={() => setActiveView('chat')}
          />
        );
      case 'policies':
        return (
          <PolicySettings
            policies={policies}
            onUpdatePolicies={handleUpdatePolicies}
            onBackToChat={() => setActiveView('chat')}
            onNavigateToIntegrations={() => setActiveView('integrations')}
          />
        );
      case 'integrations':
        return (
          <IntegrationsView
            integrations={integrations}
            activeSkills={activeSkills}
            skillsCatalog={skillsCatalog}
            webhookEndpoints={webhookEndpoints}
            onRefreshIntegrations={fetchIntegrations}
            onBackToChat={() => setActiveView('chat')}
            onNavigateToPolicies={() => setActiveView('policies')}
          />
        );

      case 'repositories':
        return (
          <RepositoriesView
            onNavigateToInbox={() => setActiveView('events')}
            onBackToChat={() => {
              fetchRepositories();
              setActiveView('chat');
            }}
            onRepositoriesChanged={fetchRepositories}
            onSelectRepoForChat={(repoFullName) => {
              fetchRepositories();
              setActiveView('chat');
              handleNewChatWithPrompt(`Connect and analyze repository https://github.com/${repoFullName}`);
            }}
          />
        );
      default:
        return null;
    }
  };

  const activeTask = tasks.find((t) => t.id === activeTaskId);

  const handleSelectAuxTab = (tab: 'files' | 'prs' | 'activity' | 'subagents' | 'event' | 'docs' | 'preview' | 'changes') => {
    handleAuxTabChange(tab as AuxTabType);
    if (currentPreset === 'fullscreen') {
      handleSetPreset('split');
    }
  };

  const handleSetPreset = (preset: LayoutPreset) => {
    const normalized: LayoutPreset = preset === 'standard' ? 'split' : preset;
    setCurrentPreset(normalized);
    try {
      localStorage.setItem('cyclode_layout_preset', normalized);
    } catch {
      // ignore
    }
    if (normalized === 'split') {
      setIsSidebarCollapsed(false);
    } else if (normalized === 'preview' || normalized === 'wide' || normalized === 'fullscreen') {
      setIsSidebarCollapsed(true);
    }
  };

  const handleToggleSidebar = useCallback(() => {
    setIsSidebarCollapsed((prev) => !prev);
  }, []);

  // Global keyboard shortcuts (Cmd+B / Ctrl+B for Sidebar toggle, Cmd+N / Ctrl+N for New Session)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;

      const key = e.key.toLowerCase();
      if (key === 'b') {
        e.preventDefault();
        handleToggleSidebar();
      } else if (key === 'n' && !e.shiftKey && !e.altKey) {
        const activeEl = document.activeElement;
        const isInputActive = activeEl instanceof HTMLInputElement || activeEl instanceof HTMLTextAreaElement;
        if (!isInputActive) {
          e.preventDefault();
          handleNewChat();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleToggleSidebar, handleNewChat]);

  const handleOpenPreview = (url: string, title?: string) => {
    if (url.startsWith('plan://') || url === '#open-plan-doc' || url === 'action://open-plan-doc') {
      const planTaskId = url.startsWith('plan://') ? url.replace('plan://', '').split('/')[0] : activeTaskId;
      handleOpenPlanDocument(planTaskId || activeTaskId);
      return;
    }
    if (activeTaskId) {
      setSessionPreviews((prev) => ({
        ...prev,
        [activeTaskId]: { url, title },
      }));
    }
    if (currentPreset === 'fullscreen') {
      handleSetPreset('split');
    }
  };

  const handleOpenPlanDocument = (taskId?: string, plan?: any) => {
    const targetTaskId = taskId || activeTaskId;
    if (!targetTaskId) return;
    const planTitle = plan?.objective 
      ? `Plan: ${plan.objective.length > 35 ? plan.objective.slice(0, 35) + '...' : plan.objective}`
      : 'Implementation Plan';

    setSessionPreviews((prev) => ({
      ...prev,
      [targetTaskId]: {
        url: `plan://${targetTaskId}`,
        title: planTitle
      }
    }));
    handleAuxTabChange('docs');
    if (currentPreset === 'fullscreen') {
      handleSetPreset('split');
    }
  };

  const handleClearPreview = () => {
    const sessionKey = activeTaskId || 'draft';
    setSessionPreviews((prev) => ({
      ...prev,
      [sessionKey]: null,
    }));
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-onedark-bg text-onedark-fg font-sans overflow-hidden">
      <ResizablePanes
        activeView={activeView}
        isSidebarCollapsed={isSidebarCollapsed}
        onToggleSidebar={handleToggleSidebar}
        currentPreset={currentPreset}
        onSetPreset={handleSetPreset}
        sidebar={
          <Sidebar
            activeView={activeView}
            setActiveView={setActiveView}
            tasks={tasks}
            activeTaskId={activeTaskId}
            onSelectTask={handleSelectTask}
            onNewChat={handleNewChat}
            onDeleteTask={handleDeleteTask}
            onClearAllTasks={handleClearAllTasks}
            isClearingAll={isClearingAll}
            deletingTaskId={deletingTaskId}
            onUpdateTaskTitle={handleUpdateTaskTitle}
            onOpenSettings={() => setActiveView('policies')}
            activeAgentsCount={tasks.filter((t) => t.status === 'RUNNING').length}
            onToggleSidebar={handleToggleSidebar}
            isCollapsed={isSidebarCollapsed}
          />
        }
        center={renderCenterView()}
        auxiliary={
          <AuxiliaryPane 
            task={activeTaskDetails} 
            repositories={repositories}
            activeTab={currentTaskAuxTab} 
            onTabChange={handleAuxTabChange}
            previewTarget={activePreviewTarget}
            selectedFilePath={selectedAuxFilePath}
            selectedLineNumber={selectedAuxFileLine}
            onSelectFile={handleAuxSelectFile}
            onClearSelectedFilePath={() => {
              const sessionKey = activeTaskId || 'draft';
              setSessionFiles((prev) => ({ ...prev, [sessionKey]: null }));
              setSessionFileLines((prev) => ({ ...prev, [sessionKey]: null }));
            }}
            onClearPreview={handleClearPreview}
            onAskAboutRepo={(repoName) => {
              setActiveView('chat');
              handleSendMessage(`Can you analyze the architecture and features of the ${repoName} repository?`);
            }}
            onCloneToSession={(cloneUrl, repoName) => {
              setActiveView('chat');
              handleSendMessage(`Please clone and inspect the repository ${cloneUrl} into this session workspace.`);
            }}
            onAskAboutComment={(prompt) => {
              setActiveView('chat');
              handleSendMessage(prompt);
            }}
          />
        }
      />

      {isSandboxModalOpen && (activeTaskDetails || activeTask) && (
        <SandboxInspectorModal
          task={(activeTaskDetails || activeTask)!}
          onClose={() => setIsSandboxModalOpen(false)}
        />
      )}
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <WebSocketProvider>
      <MainApp />
    </WebSocketProvider>
  );
};

export default App;
