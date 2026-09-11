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
import { SandboxInspectorModal } from './components/Sandbox/SandboxInspectorModal';
import { Task, EventItem, PolicyMap, Integration, AutomationRule } from './types';

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

    const unsubThought = subscribe('AGENT_THOUGHT', (data: any) => {
      if (activeTaskId === data.task_id) {
        setActiveTaskDetails((prev) => {
          if (!prev) return prev;
          const messages = prev.messages || [];
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
        fetchTaskDetails(data.task_id);
      }
    });

    return () => {
      unsubTaskCreated();
      unsubStatus();
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

  const handleNewChatWithPrompt = async (prompt: string, persona: string) => {
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
        setActiveView('chat');
        fetchTasks();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSendMessage = async (content: string) => {
    if (!activeTaskId) return;
    try {
      await fetch(`${API_BASE}/api/tasks/${activeTaskId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
    } catch (err) {
      console.error(err);
    }
  };

  const handleApprove = async (feedback?: string) => {
    if (!activeTaskId) return;
    try {
      await fetch(`${API_BASE}/api/tasks/${activeTaskId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback }),
      });
      fetchTaskDetails(activeTaskId);
    } catch (err) {
      console.error(err);
    }
  };

  const handleReject = async (feedback?: string) => {
    if (!activeTaskId) return;
    try {
      await fetch(`${API_BASE}/api/tasks/${activeTaskId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback }),
      });
      fetchTaskDetails(activeTaskId);
    } catch (err) {
      console.error(err);
    }
  };

  const handleEditMessage = async (messageId: string, content: string) => {
    if (!activeTaskId) return;
    try {
      const url = messageId === 'initial'
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
