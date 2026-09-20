import React, { useState, useEffect } from 'react';
import { 
  Radio, 
  X, 
  Check, 
  GitPullRequest, 
  AlertCircle, 
  Bug, 
  Play, 
  Sparkles, 
  Bot, 
  FolderGit2, 
  CheckCircle2, 
  AlertTriangle 
} from 'lucide-react';
import { RepositoryConfig, ListeningEventOption } from '../../types';

interface RepoListenerConfigModalProps {
  repo: RepositoryConfig;
  isOpen: boolean;
  onClose: () => void;
  onSaved?: (isListening: boolean, events: string[]) => void;
}

const API_BASE = import.meta.env.VITE_API_URL || '';

const AVAILABLE_REPO_EVENTS: ListeningEventOption[] = [
  {
    id: 'pull_request.opened',
    name: 'Pull Request Ingestion & Automated Review',
    description: 'Spawns an autonomous Code Reviewer agent whenever a new PR is opened to analyze diffs and check for security regressions.',
    source: 'github',
    event_type: 'pull_request.opened',
    category: 'review',
    sample_payload: {
      action: 'opened',
      pull_request: {
        number: 42,
        title: 'feat: add payment gateway webhook retry handler',
        body: 'Implements exponential backoff on transient webhook failures.',
        head: { ref: 'feature/retry-handler', sha: 'a8b9c1d' },
        base: { ref: 'main' }
      }
    }
  },
  {
    id: 'issues.opened',
    name: 'Issue Triage & Fix Prototyping',
    description: 'Spawns an Issue Resolver agent to investigate newly opened bug reports, reproduce them in the sandbox, and prepare a PR.',
    source: 'github',
    event_type: 'issues.opened',
    category: 'issue',
    sample_payload: {
      action: 'opened',
      issue: {
        number: 88,
        title: 'Uncaught TypeError on checkout form submission',
        body: 'Steps to reproduce: click checkout with empty promo code.'
      }
    }
  },
  {
    id: 'check_run',
    name: 'Default Branch CI Breakage Sentinel',
    description: 'Monitors the main/staging branch and awakens a CI Healer agent when test suites break outside active PR branches.',
    source: 'github',
    event_type: 'check_run',
    category: 'ci',
    sample_payload: {
      action: 'completed',
      check_run: {
        name: 'CI / main-build',
        conclusion: 'failure',
        output: {
          title: 'Nightly E2E Test Suite Failed',
          summary: 'TimeoutError in e2e/auth.spec.ts: line 112'
        }
      }
    }
  }
];

export const RepoListenerConfigModal: React.FC<RepoListenerConfigModalProps> = ({
  repo,
  isOpen,
  onClose,
  onSaved
}) => {
  const [isListening, setIsListening] = useState<boolean>(repo.is_listening || false);
  const [selectedEvents, setSelectedEvents] = useState<string[]>(
    repo.subscribed_events && repo.subscribed_events.length > 0
      ? repo.subscribed_events
      : ['pull_request.opened', 'issues.opened', 'check_run']
  );
  const [persona, setPersona] = useState<string>(repo.default_persona || 'AUTONOMOUS_WORKER');
  const [loading, setLoading] = useState<boolean>(false);
  const [testingEventId, setTestingEventId] = useState<string | null>(null);
  const [testFeedback, setTestFeedback] = useState<{ id: string; success: boolean; message: string } | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetch(`${API_BASE}/api/repositories/${repo.id}/listen`)
        .then((res) => res.json())
        .then((data) => {
          if (data && data.is_listening !== undefined) {
            setIsListening(data.is_listening);
            if (data.subscribed_events && data.subscribed_events.length > 0) {
              setSelectedEvents(data.subscribed_events);
            }
            if (data.default_persona) setPersona(data.default_persona);
          }
        })
        .catch(() => {});
    }
  }, [isOpen, repo.id]);

  if (!isOpen) return null;

  const toggleEvent = (eventId: string) => {
    setSelectedEvents((prev) =>
      prev.includes(eventId) ? prev.filter((id) => id !== eventId) : [...prev, eventId]
    );
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/repositories/${repo.id}/listen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          is_listening: isListening,
          subscribed_events: selectedEvents,
          default_persona: persona
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
        repository: {
          name: repo.name,
          full_name: repo.full_name,
          clone_url: repo.clone_url,
          default_branch: repo.default_branch
        }
      };

      const res = await fetch(`${API_BASE}/api/events/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: eventOpt.source,
          event_type: eventOpt.event_type,
          payload
        })
      });

      if (res.ok) {
        setTestFeedback({
          id: eventOpt.id,
          success: true,
          message: 'Simulated event dispatched! Spawning agent session.'
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
                  Repository Event Sentinel — {repo.full_name}
                </h3>
                {isListening && (
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-onedark-green opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-onedark-green" />
                  </span>
                )}
              </div>
              <p className="text-[11px] text-onedark-muted">
                Configure repo-wide autonomous webhooks for issues, pull requests, and CI monitoring.
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
          {/* Master Toggle */}
          <div className="p-3.5 rounded-lg bg-onedark-darker border border-onedark-borderSubtle flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="text-xs font-semibold text-onedark-fgBright flex items-center space-x-2">
                <span>Repository Sentinel Listener</span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                  isListening ? 'bg-onedark-green/20 text-onedark-green' : 'bg-onedark-surface text-onedark-muted'
                }`}>
                  {isListening ? 'Sentinel Active' : 'Sentinel Disabled'}
                </span>
              </div>
              <p className="text-[11px] text-onedark-muted">
                When active, Cyclode continuously monitors repository events and spawns agent tasks as an autonomous engineer.
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
              {isListening ? 'Disable Sentinel' : 'Enable Sentinel'}
            </button>
          </div>

          {/* Subscribed Events */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px] font-semibold text-onedark-muted uppercase">
              <span>Subscribed Repository Events ({selectedEvents.length} active)</span>
              <span className="text-[10px] text-onedark-muted lowercase">click cards to toggle</span>
            </div>

            <div className="space-y-2">
              {AVAILABLE_REPO_EVENTS.map((eventOpt) => {
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
                          <span>{isTesting ? 'Spawning...' : 'Test Trigger'}</span>
                        </button>
                      </div>
                    </div>

                    {/* Feedback */}
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

          {/* Persona selector */}
          <div className="p-3 rounded-lg bg-onedark-darker border border-onedark-borderSubtle space-y-1.5">
            <label className="text-[11px] font-semibold text-onedark-muted uppercase flex items-center space-x-1.5">
              <Bot className="w-3.5 h-3.5 text-onedark-accent" />
              <span>Default Agent Persona for Repo Events</span>
            </label>
            <select
              value={persona}
              onChange={(e) => setPersona(e.target.value)}
              className="w-full bg-onedark-surface border border-onedark-borderSubtle rounded p-1.5 text-xs text-onedark-fg focus:outline-none focus:border-onedark-accent"
            >
              <option value="AUTONOMOUS_WORKER">Autonomous Worker (Full End-to-End Execution)</option>
              <option value="CodeReviewer">Code Reviewer (Strict Audit & Commenting)</option>
              <option value="IssueResolver">Issue Resolver (Bug Fixes & Test Verification)</option>
              <option value="PAIR_PROGRAMMER">Pair Programmer (Interactive Assistance)</option>
            </select>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-onedark-borderSubtle flex items-center justify-between bg-onedark-darker/60">
          <div className="text-[11px] text-onedark-muted flex items-center space-x-1.5">
            <Sparkles className="w-3.5 h-3.5 text-onedark-accent" />
            <span>Applies across all branches in {repo.full_name}</span>
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
