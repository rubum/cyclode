import React, { useState, useEffect, useCallback } from 'react';
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
import { Task, TaskMessage, EventItem, PolicyMap, Integration, AutomationRule } from './types';

const API_BASE = import.meta.env.VITE_API_URL || '';

const MainApp: React.FC = () => {
  const { subscribe } = useWebSocket();
  const [activeView, setActiveView] = useState<string>('chat');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeTaskDetails, setActiveTaskDetails] = useState<Task | null>(null);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [automations, setAutomations] = useState<AutomationRule[]>([]);
  const [policies, setPolicies] = useState<PolicyMap>({});
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [activeSkills, setActiveSkills] = useState<string[]>([]);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);
  const [currentPreset, setCurrentPreset] = useState<'standard' | 'wide' | 'fullscreen'>('standard');
  const [isSandboxModalOpen, setIsSandboxModalOpen] = useState<boolean>(false);

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
        setActiveTaskDetails(data);
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
      }
    } catch (err) {
      console.error('Error fetching integrations:', err);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
    fetchAutomations();
    fetchEvents();
    fetchPolicies();
    fetchIntegrations();
  }, [fetchTasks, fetchAutomations, fetchEvents, fetchPolicies, fetchIntegrations]);

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
      setActiveTaskId(data.id);
      setActiveView('chat');
    });

    const unsubStatus = subscribe('TASK_STATUS_CHANGE', (data: any) => {
      fetchTasks();
      if (activeTaskId === data.task_id) {
        fetchTaskDetails(data.task_id);
      }
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

    const unsubStreamChunk = subscribe('STREAM_CHUNK', (data: any) => {
      if (activeTaskId === data.task_id) {
        setActiveTaskDetails((prev) => {
          if (!prev) return prev;
          const messages = [...(prev.messages || [])];
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
          return { ...prev, messages };
        });
      }
    });

    const unsubStreamEnd = subscribe('STREAM_END', (data: any) => {
      if (activeTaskId === data.task_id) {
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

    return () => {
      unsubTaskCreated();
      unsubStatus();
      unsubStreamStart();
      unsubStreamChunk();
      unsubStreamEnd();
      unsubThought();
      unsubToolEnd();
      unsubDiff();
      unsubApproval();
      unsubChat();
    };
  }, [subscribe, activeTaskId, fetchTasks, fetchTaskDetails]);

  const handleSelectTask = (taskId: string) => {
    setActiveTaskId(taskId);
    setActiveView('chat');
  };

  const handleNewChat = () => {
    setActiveTaskId(null);
    setActiveTaskDetails(null);
    setActiveView('chat');
  };

  const handleNewChatWithPrompt = async (prompt: string, persona: string = 'PairProgrammer') => {
    const tempId = `temp-${Date.now()}`;
    const tempTask: Task = {
      id: tempId,
      title: prompt.slice(0, 70),
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
          title: prompt.slice(0, 70),
          description: prompt,
          persona: persona || 'PairProgrammer',
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setActiveTaskId(data.task_id);
        fetchTasks();
        fetchTaskDetails(data.task_id);
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
        description: messageId === 'initial' ? content : prev.description,
        messages: newMessages,
      };
    });
    setTasks((prev) =>
      prev.map((t) => (t.id === activeTaskId ? { ...t, status: 'RUNNING' } : t))
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
    setActiveTaskDetails((prev) => (prev ? { ...prev, status: 'RUNNING' } : prev));
    setTasks((prev) =>
      prev.map((t) => (t.id === activeTaskId ? { ...t, status: 'RUNNING' } : t))
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
            onSendMessage={handleSendMessage}
            onApprove={handleApprove}
            onReject={handleReject}
            onNewChatWithPrompt={handleNewChatWithPrompt}
            onEditMessage={handleEditMessage}
            onRetryTask={handleRetryTask}
            onStopTask={handleStopTask}
            isSidebarCollapsed={isSidebarCollapsed}
            onToggleSidebar={handleToggleSidebar}
            currentPreset={currentPreset}
            onSetPreset={handleSetPreset}
            onOpenSandboxModal={() => setIsSandboxModalOpen(true)}
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
          />
        );
      case 'fleet':
        return (
          <FleetDashboard
            tasks={tasks}
            onSelectTask={handleSelectTask}
            onNewChat={handleNewChat}
          />
        );
      case 'events':
        return <EventInbox events={events} onRefresh={fetchEvents} />;
      case 'simulator':
        return (
          <WebhookSimulator
            onSimulate={handleSimulateWebhook}
            onSuccess={(taskId) => {
              setActiveTaskId(taskId);
              setActiveView('chat');
              fetchTasks();
            }}
          />
        );
      case 'policies':
        return (
          <PolicySettings
            policies={policies}
            onUpdatePolicies={handleUpdatePolicies}
          />
        );
      case 'integrations':
        return (
          <IntegrationsView
            integrations={integrations}
            activeSkills={activeSkills}
            onRefreshIntegrations={fetchIntegrations}
          />
        );
      case 'repositories':
        return (
          <RepositoriesView
            onSelectRepoForChat={(repoFullName) => {
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
            onOpenSettings={() => setActiveView('policies')}
            activeAgentsCount={tasks.filter((t) => t.status === 'RUNNING').length}
            onToggleSidebar={handleToggleSidebar}
          />
        }
        center={renderCenterView()}
        auxiliary={<AuxiliaryPane task={activeTaskDetails} />}
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
