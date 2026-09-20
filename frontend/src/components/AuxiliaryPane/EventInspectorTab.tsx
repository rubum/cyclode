import React, { useState, useEffect, useCallback } from 'react';
import { 
  Inbox, 
  Send, 
  CheckCircle2, 
  XCircle, 
  Play, 
  RotateCcw, 
  Activity, 
  ShieldCheck, 
  GitPullRequest, 
  AlertTriangle, 
  Terminal, 
  Layers, 
  Clock, 
  DollarSign, 
  Check, 
  Copy, 
  ChevronDown, 
  ChevronRight,
  Filter,
  Sparkles,
  Bug,
  RefreshCw,
  Cpu,
  Zap,
  Info
} from 'lucide-react';
import { 
  Task, 
  EventTimelineItem, 
  AgentTrajectory, 
  EvaluationScorecard, 
  TrajectoryTurn 
} from '../../types';
import { useWebSocket } from '../../contexts/WebSocketContext';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface EventInspectorTabProps {
  task: Task | null;
}

type SubTab = 'timeline' | 'trajectory' | 'evals';
type EventFilter = 'all' | 'inbound' | 'outbound';

export const EventInspectorTab: React.FC<EventInspectorTabProps> = ({ task }) => {
  const { subscribe } = useWebSocket();
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('timeline');
  const [eventFilter, setEventFilter] = useState<EventFilter>('all');
  const [events, setEvents] = useState<EventTimelineItem[]>([]);
  const [trajectory, setTrajectory] = useState<AgentTrajectory | null>(null);
  const [evaluation, setEvaluation] = useState<EvaluationScorecard | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [injecting, setInjecting] = useState<boolean>(false);
  const [replaying, setReplaying] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [expandedTurns, setExpandedTurns] = useState<Record<number, boolean>>({});
  const [expandedEvents, setExpandedEvents] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [customPayload, setCustomPayload] = useState<string>('');
  const [showCustomModal, setShowCustomModal] = useState<boolean>(false);

  const fetchInspectorData = useCallback(async () => {
    if (!task?.id) {
      setEvents([]);
      setTrajectory(null);
      setEvaluation(null);
      return;
    }
    setLoading(true);
    try {
      const [eventsRes, trajRes, evalRes] = await Promise.all([
        fetch(`${API_BASE}/api/tasks/${task.id}/events`),
        fetch(`${API_BASE}/api/tasks/${task.id}/trajectory`),
        fetch(`${API_BASE}/api/tasks/${task.id}/evaluation`),
      ]);

      if (eventsRes.ok) {
        const eventsData = await eventsRes.json();
        const list = Array.isArray(eventsData) ? eventsData : (eventsData.timeline || eventsData.inbound || []);
        setEvents(list);
      }
      if (trajRes.ok) {
        const trajData = await trajRes.json();
        setTrajectory(trajData);
      }
      if (evalRes.ok) {
        const evalData = await evalRes.json();
        setEvaluation(evalData);
      }
    } catch {
      // ignore network errors
    } finally {
      setLoading(false);
    }
  }, [task?.id]);

  useEffect(() => {
    fetchInspectorData();
    const interval = setInterval(fetchInspectorData, 5000);
    return () => clearInterval(interval);
  }, [fetchInspectorData]);

  // Real-time WebSocket synchronization
  useEffect(() => {
    const unsubEvent = subscribe('EVENT_RECEIVED', (data: any) => {
      if (!task || task.id === data.task_id) {
        fetchInspectorData();
      }
    });
    const unsubOutgoing = subscribe('OUTGOING_EVENT', (data: any) => {
      if (!task || task.id === data.task_id) {
        fetchInspectorData();
      }
    });
    const unsubPlan = subscribe('TASK_PLAN_UPDATED', (data: any) => {
      if (!task || task.id === data.task_id) {
        fetchInspectorData();
      }
    });
    const unsubStatus = subscribe('TASK_STATUS_CHANGE', (data: any) => {
      if (!task || task.id === data.task_id) {
        fetchInspectorData();
      }
    });

    return () => {
      unsubEvent();
      unsubOutgoing();
      unsubPlan();
      unsubStatus();
    };
  }, [subscribe, task?.id, fetchInspectorData]);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleInjectEvent = async (source: string, event_type: string, payload: Record<string, any>) => {
    setInjecting(true);
    setFeedback(null);
    try {
      if (task?.id) {
        const res = await fetch(`${API_BASE}/api/tasks/${task.id}/events/inject`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source,
            event_type,
            payload,
            session_key: task.git_branch || task.id,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          setFeedback({
            type: 'success',
            message: `Event injected: ${data.title || event_type}. Agent awakened!`
          });
          await fetchInspectorData();
        } else {
          setFeedback({
            type: 'error',
            message: `Failed to inject event: HTTP ${res.status}`
          });
        }
      } else {
        const res = await fetch(`${API_BASE}/api/events/simulate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source,
            event_type,
            payload
          }),
        });
        if (res.ok) {
          const data = await res.json();
          setFeedback({
            type: 'success',
            message: `Simulated event dispatched: ${data.title || event_type}. Spawning task!`
          });
        } else {
          setFeedback({
            type: 'error',
            message: `Simulation error: HTTP ${res.status}`
          });
        }
      }
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: `Error injecting event: ${err.message || 'Network error'}`
      });
    } finally {
      setInjecting(false);
      setShowCustomModal(false);
    }
  };

  const handleReplay = async () => {
    if (!task?.id) return;
    setReplaying(true);
    try {
      const res = await fetch(`${API_BASE}/api/tasks/${task.id}/replay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        await fetchInspectorData();
      }
    } catch {
      // ignore
    } finally {
      setReplaying(false);
    }
  };

  const toggleTurn = (turnIndex: number) => {
    setExpandedTurns(prev => ({ ...prev, [turnIndex]: !prev[turnIndex] }));
  };

  const toggleEvent = (eventId: string) => {
    setExpandedEvents(prev => ({ ...prev, [eventId]: !prev[eventId] }));
  };

  const filteredEvents = events.filter(e => {
    const kind = e.kind || (e as any).direction?.toLowerCase() || 'inbound';
    if (eventFilter === 'inbound') return kind === 'inbound';
    if (eventFilter === 'outbound') return kind === 'outbound';
    return true;
  });

  return (
    <div className="flex flex-col h-full bg-onedark-darker font-mono text-xs text-onedark-fg select-text">
      {/* Top Header & Subtabs */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-onedark-borderSubtle bg-onedark-bg">
        <div className="flex items-center space-x-1">
          <button
            onClick={() => setActiveSubTab('timeline')}
            className={`px-2.5 py-1 text-xs rounded transition-colors ${
              activeSubTab === 'timeline'
                ? 'bg-onedark-surface text-onedark-fgBright font-semibold border border-onedark-border'
                : 'text-onedark-muted hover:text-onedark-fg'
            }`}
          >
            <div className="flex items-center space-x-1.5">
              <Inbox className="w-3.5 h-3.5 text-onedark-accent" />
              <span>Events ({events.length})</span>
            </div>
          </button>

          <button
            onClick={() => setActiveSubTab('trajectory')}
            className={`px-2.5 py-1 text-xs rounded transition-colors ${
              activeSubTab === 'trajectory'
                ? 'bg-onedark-surface text-onedark-fgBright font-semibold border border-onedark-border'
                : 'text-onedark-muted hover:text-onedark-fg'
            }`}
          >
            <div className="flex items-center space-x-1.5">
              <Layers className="w-3.5 h-3.5 text-onedark-yellow" />
              <span>Trajectory ({trajectory?.turns?.length || 0})</span>
            </div>
          </button>

          <button
            onClick={() => setActiveSubTab('evals')}
            className={`px-2.5 py-1 text-xs rounded transition-colors ${
              activeSubTab === 'evals'
                ? 'bg-onedark-surface text-onedark-fgBright font-semibold border border-onedark-border'
                : 'text-onedark-muted hover:text-onedark-fg'
            }`}
          >
            <div className="flex items-center space-x-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-onedark-green" />
              <span>Scorecard {evaluation ? `(${evaluation.score}%)` : ''}</span>
            </div>
          </button>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={fetchInspectorData}
            disabled={loading}
            className="p-1 rounded text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface transition-colors"
            title="Refresh inspector data"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* TAB 1: EVENT TIMELINE & SIMULATION INJECTOR */}
        {activeSubTab === 'timeline' && (
          <div className="space-y-3">
            {/* Quick Simulation Bar */}
            <div className="p-2.5 rounded-lg bg-onedark-bg border border-onedark-borderSubtle space-y-2">
              <div className="flex items-center justify-between text-[11px] text-onedark-muted">
                <span className="flex items-center space-x-1.5 font-semibold text-onedark-fg">
                  <Sparkles className="w-3.5 h-3.5 text-onedark-accent" />
                  <span>Simulate Webhook Event Trigger</span>
                </span>
                <span className="text-[10px] text-onedark-muted">Coalesced with 2.5s Debounce</span>
              </div>

              <div className="flex flex-wrap gap-1.5 pt-1">
                <button
                  onClick={() =>
                    handleInjectEvent('github', 'check_run', {
                      action: 'completed',
                      check_run: {
                        name: 'CI / pytest-suite',
                        conclusion: 'failure',
                        output: {
                          title: 'Test Suite Failed (2 failures)',
                          summary: 'AssertionError in backend/tests/test_auth.py: line 42',
                        },
                      },
                      repository: { full_name: task?.repo_name || 'octocat/repo' },
                    })
                  }
                  disabled={injecting}
                  className="px-2 py-1 rounded bg-onedark-surface hover:bg-onedark-border border border-onedark-borderSubtle text-[11px] text-onedark-red flex items-center space-x-1 transition-colors cursor-pointer active:scale-95"
                >
                  <Bug className="w-3 h-3" />
                  <span>CI Failure (check_run)</span>
                </button>

                <button
                  onClick={() =>
                    handleInjectEvent('github', 'issue_comment', {
                      action: 'created',
                      comment: {
                        body: '@cyclode please fix the authentication token expiration test.',
                        user: { login: 'senior-engineer' },
                      },
                      issue: { number: 104, title: 'Auth enhancement PR' },
                      repository: { full_name: task?.repo_name || 'octocat/repo' },
                    })
                  }
                  disabled={injecting}
                  className="px-2 py-1 rounded bg-onedark-surface hover:bg-onedark-border border border-onedark-borderSubtle text-[11px] text-onedark-cyan flex items-center space-x-1 transition-colors cursor-pointer active:scale-95"
                >
                  <GitPullRequest className="w-3 h-3" />
                  <span>PR Review Comment</span>
                </button>

                <button
                  onClick={() =>
                    handleInjectEvent('github', 'push', {
                      ref: `refs/heads/${task?.git_branch || 'feature/agent-branch'}`,
                      commits: [
                        { id: 'a1b2c3d', message: 'chore: updated schema signatures', added: ['schema.py'] },
                      ],
                      repository: { full_name: task?.repo_name || 'octocat/repo' },
                    })
                  }
                  disabled={injecting}
                  className="px-2 py-1 rounded bg-onedark-surface hover:bg-onedark-border border border-onedark-borderSubtle text-[11px] text-onedark-yellow flex items-center space-x-1 transition-colors cursor-pointer active:scale-95"
                >
                  <Clock className="w-3 h-3" />
                  <span>Push (Debounce Coalesce)</span>
                </button>

                <button
                  onClick={() =>
                    handleInjectEvent('sentry', 'issue_alert', {
                      event: {
                        title: 'ZeroDivisionError: division by zero in router.py',
                        environment: 'staging',
                        tags: { service: 'backend' },
                      },
                    })
                  }
                  disabled={injecting}
                  className="px-2 py-1 rounded bg-onedark-surface hover:bg-onedark-border border border-onedark-borderSubtle text-[11px] text-onedark-purple flex items-center space-x-1 transition-colors cursor-pointer active:scale-95"
                >
                  <AlertTriangle className="w-3 h-3" />
                  <span>Sentry Alert</span>
                </button>

                <button
                  onClick={() => setShowCustomModal(!showCustomModal)}
                  className="px-2 py-1 rounded bg-onedark-surface hover:bg-onedark-border border border-onedark-borderSubtle text-[11px] text-onedark-muted hover:text-onedark-fg transition-colors cursor-pointer"
                >
                  <span>Custom JSON...</span>
                </button>
              </div>

              {/* Feedback Alert Banner */}
              {feedback && (
                <div className={`p-2 rounded text-[11px] flex items-center space-x-2 border transition-all ${
                  feedback.type === 'success'
                    ? 'bg-onedark-green/10 text-onedark-green border-onedark-green/30'
                    : 'bg-onedark-red/10 text-onedark-red border-onedark-red/30'
                }`}>
                  {feedback.type === 'success' ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />}
                  <span className="flex-1">{feedback.message}</span>
                  <button onClick={() => setFeedback(null)} className="text-onedark-muted hover:text-onedark-fg">✕</button>
                </div>
              )}

              {showCustomModal && (
                <div className="pt-2 border-t border-onedark-borderSubtle space-y-2">
                  <textarea
                    value={customPayload}
                    onChange={(e) => setCustomPayload(e.target.value)}
                    placeholder='{"source": "custom", "event_type": "build_event", "payload": {"status": "error"}}'
                    className="w-full h-24 p-2 text-[11px] bg-onedark-darker border border-onedark-border rounded font-mono text-onedark-fg resize-none focus:outline-none focus:border-onedark-accent"
                  />
                  <div className="flex justify-end space-x-2">
                    <button
                      onClick={() => setShowCustomModal(false)}
                      className="px-2.5 py-1 text-[11px] rounded text-onedark-muted hover:text-onedark-fg"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        try {
                          const parsed = JSON.parse(customPayload);
                          handleInjectEvent(parsed.source || 'custom', parsed.event_type || 'custom_event', parsed.payload || parsed);
                        } catch {
                          alert('Invalid JSON');
                        }
                      }}
                      className="px-2.5 py-1 text-[11px] rounded bg-onedark-accent text-white hover:bg-onedark-accent/90"
                    >
                      Inject Event
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Filter Bar */}
            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center space-x-2">
                <Filter className="w-3.5 h-3.5 text-onedark-muted" />
                <span className="text-[11px] text-onedark-muted uppercase font-semibold">Timeline Stream</span>
              </div>
              <div className="flex items-center space-x-1">
                {(['all', 'inbound', 'outbound'] as EventFilter[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => setEventFilter(f)}
                    className={`px-2 py-0.5 rounded text-[10px] uppercase font-semibold transition-colors ${
                      eventFilter === f
                        ? 'bg-onedark-surface text-onedark-fgBright border border-onedark-border'
                        : 'text-onedark-muted hover:text-onedark-fg'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            {/* Events List */}
            {filteredEvents.length === 0 ? (
              <div className="p-8 text-center text-onedark-muted text-xs space-y-2 border border-dashed border-onedark-borderSubtle rounded-lg">
                <Inbox className="w-6 h-6 mx-auto opacity-40 text-onedark-accent" />
                <p>No {eventFilter !== 'all' ? eventFilter : ''} events recorded for this task session yet.</p>
                <p className="text-[11px] text-onedark-muted/80">
                  Use the quick simulation buttons above or send a GitHub webhook to awaken the agent.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredEvents.map((evt) => {
                  const isExpanded = !!expandedEvents[evt.id];
                  const isInbound = evt.kind === 'inbound';
                  return (
                    <div
                      key={evt.id}
                      className="p-2.5 rounded-lg bg-onedark-bg border border-onedark-borderSubtle space-y-2 hover:border-onedark-border transition-colors"
                    >
                      <div 
                        className="flex items-center justify-between cursor-pointer"
                        onClick={() => toggleEvent(evt.id)}
                      >
                        <div className="flex items-center space-x-2">
                          {isInbound ? (
                            <span className="p-1 rounded bg-onedark-accent/15 text-onedark-accent">
                              <Inbox className="w-3.5 h-3.5" />
                            </span>
                          ) : (
                            <span className="p-1 rounded bg-onedark-green/15 text-onedark-green">
                              <Send className="w-3.5 h-3.5" />
                            </span>
                          )}
                          <div className="flex flex-col">
                            <span className="text-xs font-semibold text-onedark-fgBright flex items-center space-x-1.5">
                              <span>{evt.title || `${evt.source}:${evt.event_type}`}</span>
                              <span className={`text-[9px] uppercase px-1.5 py-0.2 rounded font-bold ${
                                isInbound ? 'bg-onedark-surface text-onedark-accent' : 'bg-onedark-green/20 text-onedark-green'
                              }`}>
                                {evt.kind}
                              </span>
                            </span>
                            <span className="text-[10px] text-onedark-muted">
                              {evt.timestamp ? new Date(evt.timestamp).toLocaleTimeString() : 'Just now'} • {evt.source}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center space-x-2">
                          {evt.signature_valid && (
                            <span className="text-[10px] text-onedark-green flex items-center space-x-0.5">
                              <CheckCircle2 className="w-3 h-3" />
                              <span>HMAC</span>
                            </span>
                          )}
                          {evt.status_code && (
                            <span className={`text-[10px] font-mono ${
                              evt.status_code < 300 ? 'text-onedark-green' : 'text-onedark-red'
                            }`}>
                              HTTP {evt.status_code}
                            </span>
                          )}
                          {isExpanded ? (
                            <ChevronDown className="w-3.5 h-3.5 text-onedark-muted" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5 text-onedark-muted" />
                          )}
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="pt-2 border-t border-onedark-borderSubtle space-y-2 text-[11px]">
                          {evt.summary && (
                            <p className="text-onedark-fg text-xs bg-onedark-surface/40 p-2 rounded border border-onedark-borderSubtle">
                              {evt.summary}
                            </p>
                          )}
                          <div className="flex items-center justify-between text-onedark-muted text-[10px]">
                            <span>Event ID: {evt.id}</span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCopy(JSON.stringify(evt.payload, null, 2), evt.id);
                              }}
                              className="flex items-center space-x-1 hover:text-onedark-fg"
                            >
                              {copiedId === evt.id ? <Check className="w-3 h-3 text-onedark-green" /> : <Copy className="w-3 h-3" />}
                              <span>Copy JSON</span>
                            </button>
                          </div>
                          <pre className="p-2 rounded bg-onedark-darker border border-onedark-borderSubtle text-[10px] text-onedark-fg overflow-x-auto whitespace-pre-wrap max-h-56">
                            {JSON.stringify(evt.payload, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: AGENT TRAJECTORY AUDIT */}
        {activeSubTab === 'trajectory' && (
          <div className="space-y-3">
            {/* Trajectory Header Card */}
            <div className="p-3 rounded-lg bg-onedark-bg border border-onedark-borderSubtle space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Layers className="w-4 h-4 text-onedark-yellow" />
                  <span className="font-semibold text-onedark-fgBright text-xs">Autonomous Agent Trajectory</span>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={handleReplay}
                    disabled={replaying || !task}
                    className="px-2.5 py-1 rounded bg-onedark-surface hover:bg-onedark-border border border-onedark-borderSubtle text-[11px] text-onedark-yellow flex items-center space-x-1.5 transition-colors"
                  >
                    <RotateCcw className={`w-3 h-3 ${replaying ? 'animate-spin' : ''}`} />
                    <span>Time-Travel Replay</span>
                  </button>
                </div>
              </div>

              {trajectory ? (
                <div className="grid grid-cols-4 gap-2 pt-1 text-[11px]">
                  <div className="p-2 rounded bg-onedark-darker border border-onedark-borderSubtle">
                    <div className="text-onedark-muted text-[10px] uppercase">Turns</div>
                    <div className="font-bold text-onedark-fgBright">{trajectory.turns?.length || 0}</div>
                  </div>
                  <div className="p-2 rounded bg-onedark-darker border border-onedark-borderSubtle">
                    <div className="text-onedark-muted text-[10px] uppercase">Tokens</div>
                    <div className="font-bold text-onedark-cyan">{(trajectory.total_tokens || 0).toLocaleString()}</div>
                  </div>
                  <div className="p-2 rounded bg-onedark-darker border border-onedark-borderSubtle">
                    <div className="text-onedark-muted text-[10px] uppercase">Latency</div>
                    <div className="font-bold text-onedark-yellow">{((trajectory.total_latency_ms || 0) / 1000).toFixed(1)}s</div>
                  </div>
                  <div className="p-2 rounded bg-onedark-darker border border-onedark-borderSubtle">
                    <div className="text-onedark-muted text-[10px] uppercase">Est. Cost</div>
                    <div className="font-bold text-onedark-green">${(trajectory.estimated_cost_usd || 0).toFixed(4)}</div>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-onedark-muted">Trajectory tracking initialized for this task session.</div>
              )}
            </div>

            {/* Turns Timeline */}
            {!trajectory || !trajectory.turns || trajectory.turns.length === 0 ? (
              <div className="p-8 text-center text-onedark-muted text-xs space-y-2 border border-dashed border-onedark-borderSubtle rounded-lg">
                <Activity className="w-6 h-6 mx-auto opacity-40 text-onedark-yellow" />
                <p>No turns recorded in this session yet.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {trajectory.turns.map((turn: TrajectoryTurn) => {
                  const isExpanded = !!expandedTurns[turn.turn_index];
                  return (
                    <div
                      key={turn.turn_index}
                      className="p-2.5 rounded-lg bg-onedark-bg border border-onedark-borderSubtle space-y-2"
                    >
                      <div
                        className="flex items-center justify-between cursor-pointer"
                        onClick={() => toggleTurn(turn.turn_index)}
                      >
                        <div className="flex items-center space-x-2">
                          <span className="px-1.5 py-0.5 rounded bg-onedark-surface text-onedark-yellow font-bold text-[10px]">
                            Turn {turn.turn_index}
                          </span>
                          <span className="text-xs font-semibold text-onedark-fg">
                            {turn.tool_calls?.length || 0} tool action(s)
                          </span>
                        </div>
                        <div className="flex items-center space-x-2 text-[10px] text-onedark-muted">
                          <span>{turn.tokens_consumed ? `${turn.tokens_consumed} tokens` : ''}</span>
                          {isExpanded ? (
                            <ChevronDown className="w-3.5 h-3.5 text-onedark-muted" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5 text-onedark-muted" />
                          )}
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="pt-2 border-t border-onedark-borderSubtle space-y-2 text-[11px]">
                          {/* Internal Reasoning Thoughts */}
                          {turn.thoughts && turn.thoughts.length > 0 && (
                            <div className="space-y-1">
                              <div className="text-[10px] uppercase font-semibold text-onedark-muted">Reasoning & Intent:</div>
                              <div className="p-2 rounded bg-onedark-surface/40 border border-onedark-borderSubtle text-onedark-fg whitespace-pre-wrap">
                                {turn.thoughts.join('\n')}
                              </div>
                            </div>
                          )}

                          {/* Tool Invocations */}
                          {turn.tool_calls && turn.tool_calls.length > 0 && (
                            <div className="space-y-1.5">
                              <div className="text-[10px] uppercase font-semibold text-onedark-muted">Executed Tools:</div>
                              {turn.tool_calls.map((tool, idx) => (
                                <div key={idx} className="p-2 rounded bg-onedark-darker border border-onedark-borderSubtle space-y-1">
                                  <div className="flex items-center justify-between">
                                    <span className="font-bold text-onedark-cyan flex items-center space-x-1">
                                      <Terminal className="w-3 h-3" />
                                      <span>{tool.tool_name}</span>
                                    </span>
                                    <span className="text-[10px] text-onedark-muted">
                                      {tool.duration_ms ? `${tool.duration_ms}ms` : ''}
                                    </span>
                                  </div>
                                  <pre className="text-[10px] text-onedark-fgBright overflow-x-auto whitespace-pre-wrap">
                                    {JSON.stringify(tool.input_args, null, 2)}
                                  </pre>
                                  {tool.error && (
                                    <div className="text-onedark-red text-[10px] pt-1">
                                      Error: {tool.error}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}

                          {turn.diff_snapshot_sha && (
                            <div className="flex items-center space-x-1.5 text-[10px] text-onedark-muted pt-1">
                              <span>Git Diff Snapshot SHA:</span>
                              <span className="font-mono text-onedark-purple">{turn.diff_snapshot_sha}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: DETERMINISTIC EVALUATION SCORECARD */}
        {activeSubTab === 'evals' && (
          <div className="space-y-3">
            {/* Scorecard Hero */}
            <div className="p-3 rounded-lg bg-onedark-bg border border-onedark-borderSubtle space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <ShieldCheck className="w-4 h-4 text-onedark-green" />
                  <span className="font-semibold text-onedark-fgBright text-xs">Deterministic Evaluation Scorecard</span>
                </div>
                {evaluation && (
                  <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${
                    evaluation.status === 'accomplished' 
                      ? 'bg-onedark-green/20 text-onedark-green' 
                      : evaluation.status === 'needs_revision'
                      ? 'bg-onedark-red/20 text-onedark-red'
                      : 'bg-onedark-yellow/20 text-onedark-yellow'
                  }`}>
                    {evaluation.status.replace('_', ' ')}
                  </span>
                )}
              </div>

              {evaluation ? (
                <div className="space-y-2">
                  <p className="text-[11px] text-onedark-fg">
                    {evaluation.summary}
                  </p>
                  <div className="flex items-center space-x-2">
                    <div className="flex-1 bg-onedark-darker rounded-full h-2 overflow-hidden border border-onedark-borderSubtle">
                      <div
                        className={`h-full transition-all duration-500 ${
                          evaluation.score >= 80 ? 'bg-onedark-green' : evaluation.score >= 50 ? 'bg-onedark-yellow' : 'bg-onedark-red'
                        }`}
                        style={{ width: `${evaluation.score}%` }}
                      />
                    </div>
                    <span className="font-bold text-onedark-fgBright text-xs">{evaluation.score}%</span>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-onedark-muted">Evaluating task invariants and completion state...</div>
              )}
            </div>

            {/* Individual Check Results */}
            {evaluation?.checks && evaluation.checks.length > 0 ? (
              <div className="space-y-2">
                <div className="text-[10px] uppercase font-semibold text-onedark-muted">Verification Checks:</div>
                {evaluation.checks.map((check, idx) => (
                  <div
                    key={idx}
                    className="p-2.5 rounded-lg bg-onedark-bg border border-onedark-borderSubtle flex items-start justify-between space-x-3"
                  >
                    <div className="flex items-start space-x-2.5">
                      {check.passed ? (
                        <CheckCircle2 className="w-4 h-4 text-onedark-green flex-shrink-0 mt-0.5" />
                      ) : (
                        <XCircle className="w-4 h-4 text-onedark-red flex-shrink-0 mt-0.5" />
                      )}
                      <div>
                        <div className="text-xs font-semibold text-onedark-fgBright">{check.name}</div>
                        <div className="text-[10px] text-onedark-muted uppercase font-bold">{check.category.replace('_', ' ')}</div>
                        {check.diagnostics && (
                          <div className="mt-1 text-[10px] text-onedark-muted/90 bg-onedark-darker p-1.5 rounded border border-onedark-borderSubtle">
                            {check.diagnostics}
                          </div>
                        )}
                      </div>
                    </div>

                    {check.duration_ms !== null && check.duration_ms !== undefined && (
                      <span className="text-[10px] text-onedark-muted flex-shrink-0">
                        {check.duration_ms}ms
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
};

