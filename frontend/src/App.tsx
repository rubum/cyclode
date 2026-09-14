import React, { useState, useEffect, useCallback, useRef } from 'react';
import { WebSocketProvider, useWebSocket } from './contexts/WebSocketContext';
import { Sidebar } from './components/Sidebar/Sidebar';
import { ResizablePanes } from './components/Layout/ResizablePanes';
import { ChatCanvas } from './components/Chat/ChatCanvas';
import { AuxiliaryPane } from './components/AuxiliaryPane/AuxiliaryPane';
import { FleetDashboard } from './components/Fleet/FleetDashboard';
import { EventInbox } from './components/Events/EventInbox';
import { WebhookSimulator } from './components/Simulator/WebhookSimulator';
import { AutomationsView } from './components/Automations/AutomationsView';
import { PolicySettings } from './components/Policies/PolicySettings';
import { IntegrationsView } from './components/Integrations/IntegrationsView';
import { RepositoriesView } from './components/Repositories/RepositoriesView';
import { SandboxInspectorModal } from './components/Sandbox/SandboxInspectorModal';
import { Task, TaskMessage, EventItem, PolicyMap, Integration, AutomationRule, SkillCatalogItem, WebhookEndpoint, RepositoryConfig } from './types';

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
  const [currentPreset, setCurrentPreset] = useState<'standard' | 'wide' | 'fullscreen'>('standard');
  const [activeAuxTab, setActiveAuxTab] = useState<'files' | 'diff' | 'activity' | 'subagents' | 'event' | 'docs'>('activity');
  const [sessionPreviews, setSessionPreviews] = useState<Record<string, { url: string; title?: string } | null>>({});
  const activePreviewTarget = activeTaskId ? (sessionPreviews[activeTaskId] || null) : null;

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
    try {
      const res = await fetch(`${API_BASE}/api/tasks/${taskId}`);
      if (res.ok) {
        const data = await res.json();
        // Guard against race conditions: only update if user is still viewing this task
        if (activeTaskIdRef.current === taskId) {
          setActiveTaskDetails(data);
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
        setActiveView('chat');
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
          const messages = prev.messages || [];
          const exists = messages.some(
            (m) => m.thought === data.thought || (m.content === data.thought && m.thought)
          );
          if (exists) return prev;
          return {
            ...prev,
            messages: [
              ...messages,
              {
                id: `thought-${Date.now()}`,
                task_id: data.task_id,
                sender: 'agent',
                content: data.thought,
                thought: data.thought,
                tokens: data.tokens,
                created_at: data.timestamp,
              },
            ],
          };
        });
      }
    });

    const unsubToolEnd = subscribe('TOOL_END', (data: any) => {
      if (activeTaskId === data.task_id) {
        fetchTaskDetails(data.task_id);
      }
    });

    const unsubDiff = subscribe('DIFF_UPDATED', (data: any) => {
      if (activeTaskId === data.task_id) {
        setActiveTaskDetails((prev) => (prev ? { ...prev, diffs: data.diffs } : prev));
      }
    });

    const unsubApproval = subscribe('APPROVAL_REQUIRED', (data: any) => {
      fetchTasks();
      if (activeTaskId === data.task_id) {
        fetchTaskDetails(data.task_id);
      }
    });

    const unsubChat = subscribe('CHAT_MESSAGE', (data: any) => {
      if (activeTaskId === data.task_id) {
        setActiveTaskDetails((prev) => {
          if (!prev) return prev;
          const messages = [...(prev.messages || [])];
          // Reconcile optimistic user message or streaming agent message
          const optIdx = messages.findIndex(
            (m) => (m.isOptimistic && m.sender === data.sender && m.content === data.content) ||
                   (m.isStreaming && m.content === data.content)
          );
          if (optIdx >= 0) {
            messages[optIdx] = {
              ...messages[optIdx],
              id: data.id || messages[optIdx].id,
              tokens: data.tokens || messages[optIdx].tokens,
              isOptimistic: false,
              isStreaming: false,
            };
            return { ...prev, messages };
          }
          // If already present, don't duplicate
          const existingIdx = messages.findIndex((m) => m.id === data.id);
          if (existingIdx >= 0) {
            messages[existingIdx] = {
              ...messages[existingIdx],
              content: data.content,
              tokens: data.tokens,
              isStreaming: false,
            };
            return { ...prev, messages };
          }
          return {
            ...prev,
            messages: [
              ...messages,
              {
                id: data.id || `msg-${Date.now()}`,
                task_id: data.task_id,
                sender: data.sender,
                content: data.content,
                tokens: data.tokens,
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
      unsubToolEnd();
      unsubDiff();
      unsubApproval();
      unsubChat();
      unsubEventReceived();
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

  const handleNewChatWithPrompt = async (prompt: string, persona: string = 'PairProgrammer') => {
    const tempId = `temp-${Date.now()}`;
    const initialTitle = getCleanInitialTitle(prompt);
    const tempTask: Task = {
      id: tempId,
      title: initialTitle,
      custom_title: false,
      description: prompt,
      persona: persona || 'PairProgrammer',
      model_name: 'gemini-2.5-flash',
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
          persona: persona || 'PairProgrammer',
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (activeTaskIdRef.current === tempId) {
          setActiveTaskId(data.task_id);
          fetchTaskDetails(data.task_id);
        }
        fetchTasks();
      }
    } catch (err) {
      console.error('Error creating task:', err);
    }
  };

  const handleSendMessage = async (content: string) => {
    if (!activeTaskId) return;
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

    setActiveTaskDetails((prev) =>
      prev
        ? {
            ...prev,
            status: 'RUNNING',
            messages: [...(prev.messages || []), optimisticMsg],
          }
        : prev
    );

    setTasks((prev) =>
      prev.map((t) => (t.id === activeTaskId ? { ...t, status: 'RUNNING' } : t))
    );

    try {
      await fetch(`${API_BASE}/api/tasks/${activeTaskId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
    } catch (err) {
      console.error('Error sending message:', err);
    }
  };

  const handleApprove = async (feedback?: string) => {
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
        status: 'COMPLETED',
        approvals: updatedApprovals,
        messages: [
          ...(prev.messages || []),
          {
            id: `approve-${Date.now()}`,
            task_id: activeTaskId,
            sender: 'agent',
            content: '🎉 **Action Approved!** Submitting pull request and completing task...',
            created_at: new Date().toISOString(),
            isOptimistic: true,
          },
        ],
      };
    });
    setTasks((prev) =>
      prev.map((t) => (t.id === activeTaskId ? { ...t, status: 'COMPLETED' } : t))
    );

    try {
      await fetch(`${API_BASE}/api/tasks/${activeTaskId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback }),
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
        messages: [
          ...(prev.messages || []),
          {
            id: `reject-${Date.now()}`,
            task_id: activeTaskId,
            sender: 'system',
            content: `🛑 **Action Rejected by Reviewer.** Reason: ${feedback || 'No feedback provided.'}`,
            created_at: new Date().toISOString(),
            isOptimistic: true,
          },
        ],
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

  const handleStopTask = async () => {
    if (!activeTaskId) return;
    setActiveTaskDetails((prev) =>
      prev
        ? {
            ...prev,
            status: 'CANCELLED',
            messages: [
              ...(prev.messages || []),
              {
                id: `stop-${Date.now()}`,
                task_id: activeTaskId,
                sender: 'system',
                content: '⏹ **Task stopped by user.**',
                created_at: new Date().toISOString(),
                isOptimistic: true,
              },
            ],
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
    try {
      const res = await fetch(`${API_BASE}/api/tasks/${taskId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        if (activeTaskId === taskId) {
          setActiveTaskId(null);
          setActiveTaskDetails(null);
        }
        setSessionPreviews((prev) => {
          const next = { ...prev };
          delete next[taskId];
          return next;
        });
        fetchTasks();
      }
    } catch (err) {
      console.error('Error deleting task:', err);
    }
  };

  const handleClearAllTasks = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/tasks`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setActiveTaskId(null);
        setActiveTaskDetails(null);
        setSessionPreviews({});
        fetchTasks();
      }
    } catch (err) {
      console.error('Error clearing all tasks:', err);
    }
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
            onStopTask={handleStopTask}
            onUpdateTaskTitle={handleUpdateTaskTitle}
            isSidebarCollapsed={isSidebarCollapsed}
            onToggleSidebar={handleToggleSidebar}
            currentPreset={currentPreset}
            onSetPreset={handleSetPreset}
            onOpenSandboxModal={() => setIsSandboxModalOpen(true)}
            onSelectAuxTab={handleSelectAuxTab}
            onOpenPreview={handleOpenPreview}
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

  const handleSelectAuxTab = (tab: 'files' | 'diff' | 'activity' | 'subagents' | 'event') => {
    setActiveAuxTab(tab);
    if (currentPreset === 'fullscreen') {
      handleSetPreset('standard');
    }
  };

  const handleSetPreset = (preset: 'standard' | 'wide' | 'fullscreen') => {
    setCurrentPreset(preset);
    if (preset === 'standard') {
      setIsSidebarCollapsed(false);
    } else if (preset === 'wide' || preset === 'fullscreen') {
      setIsSidebarCollapsed(true);
    }
  };

  const handleToggleSidebar = () => {
    setIsSidebarCollapsed((prev) => !prev);
  };

  const handleOpenPreview = (url: string, title?: string) => {
    if (activeTaskId) {
      setSessionPreviews((prev) => ({
        ...prev,
        [activeTaskId]: { url, title },
      }));
    }
    if (currentPreset === 'fullscreen') {
      handleSetPreset('standard');
    }
  };

  const handleClearPreview = () => {
    if (activeTaskId) {
      setSessionPreviews((prev) => ({
        ...prev,
        [activeTaskId]: null,
      }));
    }
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
            onUpdateTaskTitle={handleUpdateTaskTitle}
            onOpenSettings={() => setActiveView('policies')}
            activeAgentsCount={tasks.filter((t) => t.status === 'RUNNING').length}
            onToggleSidebar={handleToggleSidebar}
          />
        }
        center={renderCenterView()}
        auxiliary={
          <AuxiliaryPane 
            task={activeTaskDetails} 
            repositories={repositories}
            activeTab={activeAuxTab} 
            onTabChange={setActiveAuxTab}
            previewTarget={activePreviewTarget}
            onClearPreview={handleClearPreview}
            onAskAboutRepo={(repoName) => {
              setActiveView('chat');
              handleSendMessage(`Can you analyze the architecture and features of the ${repoName} repository?`);
            }}
            onCloneToSession={(cloneUrl, repoName) => {
              setActiveView('chat');
              handleSendMessage(`Please clone and inspect the repository ${cloneUrl} into this session workspace.`);
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
