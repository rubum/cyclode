import React, { useState, useEffect } from 'react';
import { 
  Radio, 
  X, 
  Check, 
  Bug, 
  GitPullRequest, 
  Clock, 
  GitMerge, 
  Play, 
  Sparkles, 
  ShieldCheck, 
  Bot, 
  Activity, 
  CheckCircle2, 
  AlertTriangle 
} from 'lucide-react';
import { Task, TaskPR, ListeningEventOption } from '../../types';

interface PRListenerConfigModalProps {
  task: Task;
  pr: TaskPR;
  isOpen: boolean;
  onClose: () => void;
  onSaved?: (isListening: boolean, events: string[]) => void;
}

const API_BASE = import.meta.env.VITE_API_URL || '';

const AVAILABLE_PR_EVENTS: ListeningEventOption[] = [
  {
    id: 'check_run',
    name: 'CI / Test Failure Triggers',
    description: 'Awakens the agent when GitHub Actions or CI check runs fail, allowing the agent to analyze trace logs and apply fixes in the sandbox.',
    source: 'github',
    event_type: 'check_run',
    category: 'ci',
    sample_payload: {
      action: 'completed',
      check_run: {
        name: 'CI / pytest-suite',
        conclusion: 'failure',
        output: {
          title: 'Unit Tests Failed (2 assertions)',
          summary: 'AssertionError: Expected 200 got 401 in test_auth.py:42'
        }
      }
    }
  },
  {
    id: 'pull_request_review_comment',
    name: 'PR Review & Inline Comments',
    description: 'Awakens the agent when reviewers post comments, requesting code refactoring, styling fixes, or explaining requirements.',
    source: 'github',
    event_type: 'pull_request_review_comment',
    category: 'review',
    sample_payload: {
      action: 'created',
      comment: {
        body: '@cyclode please fix the authentication token expiration test.',
        user: { login: 'senior-engineer' }
      }
    }
  },
  {
    id: 'push',
    name: 'Commit Pushes (2.5s Coalesced Debounce)',
    description: 'Coalesces rapid code pushes on this PR branch and awakens the agent to perform continuous review and verification.',
    source: 'github',
    event_type: 'push',
    category: 'code',
    sample_payload: {
      ref: 'refs/heads/feature/branch',
      commits: [{ id: 'c7a8b9f', message: 'chore: updated schema signatures' }]
    }
  },
  {
    id: 'pull_request.synchronize',
    name: 'Merge Conflict & Branch Sync',
    description: 'Awakens the agent when the target base branch diverges or merge conflicts are detected.',
    source: 'github',
    event_type: 'pull_request.synchronize',
    category: 'code',
    sample_payload: {
      action: 'synchronize',
      before: 'a1b2c3d',
      after: 'd4e5f6a'
    }
  }
];

export const PRListenerConfigModal: React.FC<PRListenerConfigModalProps> = ({
  task,
  pr,
  isOpen,
  onClose,
  onSaved
}) => {
  const [isListening, setIsListening] = useState<boolean>(pr.is_listening || false);
  const [selectedEvents, setSelectedEvents] = useState<string[]>(
    pr.listening_events && pr.listening_events.length > 0 
      ? pr.listening_events 
      : ['check_run', 'pull_request_review_comment', 'push']
  );
  const [persona, setPersona] = useState<string>(pr.listener_persona || 'PAIR_PROGRAMMER');
  const [autoCommit, setAutoCommit] = useState<boolean>(
    pr.auto_commit_fixes !== undefined ? pr.auto_commit_fixes : true
  );
  const [loading, setLoading] = useState<boolean>(false);
  const [testingEventId, setTestingEventId] = useState<string | null>(null);
  const [testFeedback, setTestFeedback] = useState<{ id: string; success: boolean; message: string } | null>(null);

  useEffect(() => {
    if (isOpen) {
      // Load current status from API
      fetch(`${API_BASE}/api/tasks/${task.id}/prs/${pr.pr_number}/listen`)
        .then((res) => res.json())
        .then((data) => {
          if (data && data.is_listening !== undefined) {
            setIsListening(data.is_listening);
            if (data.listening_events && data.listening_events.length > 0) {
              setSelectedEvents(data.listening_events);
            }
            if (data.listener_persona) setPersona(data.listener_persona);
            if (data.auto_commit_fixes !== undefined) setAutoCommit(data.auto_commit_fixes);
          }
        })
        .catch(() => {});
    }
  }, [isOpen, task.id, pr.pr_number]);

  if (!isOpen) return null;

  const toggleEvent = (eventId: string) => {
    setSelectedEvents((prev) =>
      prev.includes(eventId) ? prev.filter((id) => id !== eventId) : [...prev, eventId]
    );
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/tasks/${task.id}/prs/${pr.pr_number}/listen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          is_listening: isListening,
          listening_events: selectedEvents,
          listener_persona: persona,
          auto_commit_fixes: autoCommit
        })
      });

      if (res.ok) {
        onSaved?.(isListening, selectedEvents);
        onClose();
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const handleTestTrigger = async (eventOpt: ListeningEventOption) => {
    setTestingEventId(eventOpt.id);
    setTestFeedback(null);
    try {
      const payload = {
        ...eventOpt.sample_payload,
        repository: { full_name: task.repo_name || 'octocat/Hello-World' },
        issue: { number: pr.pr_number, title: pr.title },
        pull_request: { number: pr.pr_number, title: pr.title, head: { ref: pr.head_branch } }
      };

      const res = await fetch(`${API_BASE}/api/tasks/${task.id}/events/inject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: eventOpt.source,
          event_type: eventOpt.event_type,
          payload,
          session_key: task.git_branch || `github:${task.repo_name || 'repo'}:pr:${pr.pr_number}`
        })
      });

      if (res.ok) {
        setTestFeedback({
          id: eventOpt.id,
          success: true,
          message: 'Trigger sent! Agent awakened in sandbox.'
        });
      } else {
        setTestFeedback({
          id: eventOpt.id,
          success: false,
          message: `Trigger returned status HTTP ${res.status}`
        });
      }
    } catch (err: any) {
      setTestFeedback({
        id: eventOpt.id,
        success: false,
        message: err.message || 'Trigger failed'
      });
    } finally {
      setTestingEventId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-onedark-bg border border-onedark-borderSubtle rounded-xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 border-b border-onedark-borderSubtle flex items-center justify-between bg-onedark-darker/60">
          <div className="flex items-center space-x-3">
            <div className={`p-2 rounded-lg ${isListening ? 'bg-onedark-green/15 text-onedark-green' : 'bg-onedark-surface text-onedark-muted'}`}>
              <Radio className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-sm font-semibold text-onedark-fgBright">
                  Configure Event Listener — PR #{pr.pr_number}
                </h3>
                {isListening && (
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-onedark-green opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-onedark-green" />
                  </span>
                )}
              </div>
              <p className="text-[11px] text-onedark-muted truncate max-w-md">
                {pr.title} ({pr.head_branch} &rarr; {pr.base_branch})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Master Enable/Disable Switch */}
          <div className="p-3.5 rounded-lg bg-onedark-darker border border-onedark-borderSubtle flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="text-xs font-semibold text-onedark-fgBright flex items-center space-x-2">
                <span>Autonomous Event Listener</span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                  isListening ? 'bg-onedark-green/20 text-onedark-green' : 'bg-onedark-surface text-onedark-muted'
                }`}>
                  {isListening ? 'Active (Listening)' : 'Disabled'}
                </span>
              </div>
              <p className="text-[11px] text-onedark-muted">
                When enabled, incoming webhook triggers for this PR automatically awaken the autonomous agent session.
              </p>
            </div>

            <button
              onClick={() => setIsListening(!isListening)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                isListening
                  ? 'bg-onedark-green text-black hover:bg-onedark-green/90 shadow-sm'
                  : 'bg-onedark-surface hover:bg-onedark-border text-onedark-fg border border-onedark-borderSubtle'
              }`}
            >
              {isListening ? 'Disable Listener' : 'Enable Listener'}
            </button>
          </div>

          {/* Subscribed Events List */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px] font-semibold text-onedark-muted uppercase">
              <span>Select Subscribed Webhook Events ({selectedEvents.length} active)</span>
              <span className="text-[10px] text-onedark-muted lowercase">click cards to toggle</span>
            </div>

            <div className="space-y-2">
              {AVAILABLE_PR_EVENTS.map((eventOpt) => {
                const isSelected = selectedEvents.includes(eventOpt.id);
                const isTesting = testingEventId === eventOpt.id;
                const feedback = testFeedback?.id === eventOpt.id ? testFeedback : null;

                return (
                  <div
                    key={eventOpt.id}
                    className={`p-3 rounded-lg border transition-all ${
                      isSelected
                        ? 'bg-onedark-surface/60 border-onedark-accent/40'
                        : 'bg-onedark-darker/40 border-onedark-borderSubtle opacity-60'
                    }`}
                  >
                    <div className="flex items-start justify-between space-x-3">
                      <div 
                        className="flex items-start space-x-3 flex-1 cursor-pointer select-none"
                        onClick={() => toggleEvent(eventOpt.id)}
                      >
                        <div className={`mt-0.5 w-4 h-4 rounded flex items-center justify-center border transition-colors ${
                          isSelected
                            ? 'bg-onedark-accent border-onedark-accent text-white'
                            : 'border-onedark-border bg-onedark-darker'
                        }`}>
                          {isSelected && <Check className="w-3 h-3" />}
                        </div>

                        <div className="space-y-1">
                          <div className="flex items-center space-x-2">
                            <span className="text-xs font-semibold text-onedark-fgBright">
                              {eventOpt.name}
                            </span>
                            <span className="text-[10px] font-mono text-onedark-muted bg-onedark-darker px-1.5 py-0.5 rounded border border-onedark-borderSubtle">
                              {eventOpt.event_type}
                            </span>
                          </div>
                          <p className="text-[11px] text-onedark-muted leading-relaxed">
                            {eventOpt.description}
                          </p>
                        </div>
                      </div>

                      {/* Test Trigger Button */}
                      <div className="flex flex-col items-end space-y-1 flex-shrink-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleTestTrigger(eventOpt);
                          }}
                          disabled={isTesting}
                          className="px-2.5 py-1 rounded bg-onedark-surface hover:bg-onedark-border border border-onedark-borderSubtle text-[11px] text-onedark-cyan flex items-center space-x-1.5 transition-colors cursor-pointer active:scale-95 disabled:opacity-50"
                        >
                          <Play className={`w-3 h-3 ${isTesting ? 'animate-spin' : ''}`} />
                          <span>{isTesting ? 'Sending...' : 'Test Trigger'}</span>
                        </button>
                      </div>
                    </div>

                    {/* Inline feedback banner for test trigger */}
                    {feedback && (
                      <div className={`mt-2 p-1.5 rounded text-[11px] flex items-center space-x-2 ${
                        feedback.success
                          ? 'bg-onedark-green/10 text-onedark-green border border-onedark-green/20'
                          : 'bg-onedark-red/10 text-onedark-red border border-onedark-red/20'
                      }`}>
                        {feedback.success ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />}
                        <span>{feedback.message}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Autonomous Configuration Options */}
          <div className="grid grid-cols-2 gap-3 pt-2">
            <div className="p-3 rounded-lg bg-onedark-darker border border-onedark-borderSubtle space-y-1.5">
              <label className="text-[11px] font-semibold text-onedark-muted uppercase flex items-center space-x-1.5">
                <Bot className="w-3.5 h-3.5 text-onedark-accent" />
                <span>Agent Persona on Trigger</span>
              </label>
              <select
                value={persona}
                onChange={(e) => setPersona(e.target.value)}
                className="w-full bg-onedark-surface border border-onedark-borderSubtle rounded p-1.5 text-xs text-onedark-fg focus:outline-none focus:border-onedark-accent"
              >
                <option value="PAIR_PROGRAMMER">Pair Programmer (Interactive & Verified)</option>
                <option value="CodeReviewer">Code Reviewer (Strict Audit & Quality)</option>
                <option value="IssueResolver">Issue Resolver (Deep Bug Fix & Tests)</option>
                <option value="AUTONOMOUS_WORKER">Autonomous Worker (Full Auto-Pilot)</option>
              </select>
            </div>

            <div className="p-3 rounded-lg bg-onedark-darker border border-onedark-borderSubtle flex items-center justify-between">
              <div className="space-y-0.5">
                <div className="text-[11px] font-semibold text-onedark-muted uppercase flex items-center space-x-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-onedark-green" />
                  <span>Auto-Commit Fixes</span>
                </div>
                <p className="text-[10px] text-onedark-muted">
                  Automatically commit sandbox fixes to the PR branch.
                </p>
              </div>
              <button
                onClick={() => setAutoCommit(!autoCommit)}
                className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer ${
                  autoCommit ? 'bg-onedark-green' : 'bg-onedark-surface'
                }`}
              >
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                  autoCommit ? 'translate-x-4' : 'translate-x-0'
                }`} />
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-onedark-borderSubtle flex items-center justify-between bg-onedark-darker/60">
          <div className="text-[11px] text-onedark-muted flex items-center space-x-1.5">
            <Sparkles className="w-3.5 h-3.5 text-onedark-accent" />
            <span>Changes persist immediately to Cyclode Event Router</span>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-xs text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={loading}
              className="px-4 py-1.5 rounded-lg bg-onedark-accent text-white hover:bg-onedark-accent/90 text-xs font-semibold shadow-sm transition-all flex items-center space-x-1.5"
            >
              <Check className="w-3.5 h-3.5" />
              <span>{loading ? 'Saving...' : 'Save & Activate'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
