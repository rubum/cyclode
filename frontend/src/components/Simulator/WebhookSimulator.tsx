import React, { useState } from 'react';
import { 
  FlaskConical, 
  Play, 
  GitPullRequest, 
  GitCommit, 
  MessageSquare, 
  Activity, 
  Bug, 
  Zap,
  CheckCircle2,
  AlertCircle,
  Clock
} from 'lucide-react';

interface WebhookSimulatorProps {
  onSimulate: (data: { source: string; event_type: string; payload: any }) => Promise<any>;
  onSuccess: (taskId: string) => void;
}

export const WebhookSimulator: React.FC<WebhookSimulatorProps> = ({ onSimulate, onSuccess }) => {
  const [source, setSource] = useState('github');
  const [eventType, setEventType] = useState('pull_request.opened');
  const [customPayload, setCustomPayload] = useState(
    JSON.stringify(
      {
        repository: {
          full_name: "octocat/fintech-api",
          clone_url: "https://github.com/octocat/fintech-api.git"
        },
        pull_request: {
          number: 42,
          title: "Add Stripe webhooks idempotency and signature validation",
          head: {
            ref: "feature/stripe-idempotency",
            sha: "7a3f81e"
          },
          base: {
            ref: "main"
          },
          body: "Implements idempotency key caching and HMAC signature verification for inbound webhook endpoints."
        }
      },
      null,
      2
    )
  );
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string; taskId?: string } | null>(null);

  const presets = [
    {
      label: 'GitHub: PR #42 Opened (Spawn Shallow Clone)',
      badge: 'New Task',
      icon: GitPullRequest,
      source: 'github',
      eventType: 'pull_request.opened',
      payload: {
        repository: {
          full_name: "octocat/fintech-api",
          clone_url: "https://github.com/octocat/fintech-api.git"
        },
        pull_request: {
          number: 42,
          title: "Add Stripe webhooks idempotency and signature validation",
          head: {
            ref: "feature/stripe-idempotency",
            sha: "7a3f81e"
          },
          base: {
            ref: "main"
          },
          body: "Implements idempotency key caching and HMAC signature verification for inbound webhook endpoints."
        }
      }
    },
    {
      label: 'GitHub: PR #42 Commit 98a1c4f (Awaken Session)',
      badge: 'Awaken',
      icon: GitCommit,
      source: 'github',
      eventType: 'pull_request.synchronize',
      payload: {
        repository: {
          full_name: "octocat/fintech-api",
          clone_url: "https://github.com/octocat/fintech-api.git"
        },
        pull_request: {
          number: 42,
          title: "Add Stripe webhooks idempotency and signature validation",
          head: {
            ref: "feature/stripe-idempotency",
            sha: "98a1c4f"
          },
          base: {
            ref: "main"
          },
          body: "Pushed commit 98a1c4f: added constant-time HMAC comparison and tightened token expiry."
        }
      }
    },
    {
      label: 'GitHub: PR #42 Comment (@adappty Question)',
      badge: 'Awaken',
      icon: MessageSquare,
      source: 'github',
      eventType: 'issue_comment.created',
      payload: {
        repository: {
          full_name: "octocat/fintech-api"
        },
        issue: {
          number: 42,
          title: "Add Stripe webhooks idempotency and signature validation",
          pull_request: {}
        },
        comment: {
          id: 8921104,
          user: {
            login: "senior-eng"
          },
          body: "@adappty please verify whether the Redis TTL for idempotency keys is set to 24 hours."
        }
      }
    },
    {
      label: 'Sentry Alert: ZeroDivisionError in PricingCalculator',
      badge: 'APM Incident',
      icon: Bug,
      source: 'sentry',
      eventType: 'issue.created',
      payload: {
        project: {
          name: "octocat/fintech-api",
          slug: "fintech-api"
        },
        issue: {
          id: "SEC-8821",
          title: "ZeroDivisionError: division by zero in PricingCalculator.calculate_discount",
          culprit: "app/services/pricing_calculator.py:48",
          level: "error",
          count: 142
        }
      }
    },
    {
      label: 'AppSignal Alert: ActiveRecord::RecordNotFound',
      badge: 'Exception',
      icon: Activity,
      source: 'appsignal',
      eventType: 'exception',
      payload: {
        incident: {
          exception_name: "ActiveRecord::RecordNotFound",
          error_message: "Couldn't find Order with 'id'=99999",
          repository: "octocat/fintech-api",
          severity: "high"
        },
        backtrace: [
          "app/controllers/orders_controller.rb:45:in `show'",
          "app/services/auth_service.py:12:in `validate'"
        ]
      }
    },
    {
      label: 'Slack Command: /adappty review PR #42 test suite',
      badge: 'Interactive',
      icon: Zap,
      source: 'slack',
      eventType: 'slash_command',
      payload: {
        command: "/adappty",
        text: "run full security test suite on PR #42",
        user_name: "lead_architect",
        channel_name: "#security-triage"
      }
    }
  ];

  const handleApplyPreset = (p: typeof presets[0]) => {
    setSource(p.source);
    setEventType(p.eventType);
    setCustomPayload(JSON.stringify(p.payload, null, 2));
    setFeedback(null);
  };

  const handleTrigger = async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const parsed = JSON.parse(customPayload);
      const res = await onSimulate({ source, event_type: eventType, payload: parsed });
      const taskId = res.task_id || res.id;
      setFeedback({
        type: 'success',
        message: `Webhook received & dispatched successfully.${taskId ? ` Session Task ID: ${taskId}` : ''}`,
        taskId
      });
      if (taskId) {
        // Automatically switch view after brief pause
        setTimeout(() => {
          onSuccess(taskId);
        }, 1200);
      }
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: `Simulation error: ${err.message}`
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-onedark-bg font-sans text-onedark-fg">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-onedark-borderSubtle pb-5">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-xl font-bold text-onedark-fgBright flex items-center space-x-2">
              <FlaskConical className="w-5 h-5 text-onedark-accent" />
              <span>Event & Webhook Simulator</span>
            </h1>
            <span className="px-2.5 py-0.5 rounded-full bg-onedark-accent/15 text-onedark-accent font-mono text-xs font-semibold border border-onedark-accent/20">
              Ephemeral Sandbox Testing
            </span>
          </div>
          <p className="text-xs text-onedark-muted mt-1 leading-relaxed max-w-2xl">
            Simulate real GitHub webhook payloads, PR synchronization commits, @adappty mentions, and APM error alerts to verify isolated sandbox execution, automated code review, and session awakening.
          </p>
        </div>
      </div>

      {/* 1-Click Presets */}
      <div className="space-y-2.5">
        <div className="text-[11px] font-mono uppercase tracking-wider text-onedark-muted font-semibold">
          1-Click Automated Scenarios
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {presets.map((p, idx) => {
            const Icon = p.icon;
            const isCurrent = source === p.source && eventType === p.eventType;
            return (
              <button
                key={idx}
                onClick={() => handleApplyPreset(p)}
                className={`p-3.5 rounded-xl border text-left transition-all space-y-2 group relative overflow-hidden ${
                  isCurrent
                    ? 'bg-onedark-surface border-onedark-accent shadow-sm'
                    : 'bg-onedark-darker border-onedark-borderSubtle hover:border-onedark-border hover:bg-onedark-surface/40'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-2 text-xs font-semibold text-onedark-fgBright group-hover:text-onedark-accent transition-colors">
                    <Icon className="w-4 h-4 flex-shrink-0 text-onedark-accent" />
                    <span className="truncate">{p.label}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[10.5px] font-mono text-onedark-muted pt-1 border-t border-onedark-borderSubtle">
                  <span>{p.source} • {p.eventType}</span>
                  <span className={`px-1.5 py-0.2 rounded border text-[9.5px] ${
                    p.badge === 'Awaken'
                      ? 'bg-onedark-purple/15 border-onedark-purple/30 text-onedark-purple'
                      : p.badge === 'APM Incident'
                      ? 'bg-onedark-red/15 border-onedark-red/30 text-onedark-red'
                      : 'bg-onedark-blue/15 border-onedark-blue/30 text-onedark-blue'
                  }`}>
                    {p.badge}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Payload Editor Form */}
      <div className="p-5 rounded-2xl bg-onedark-darker border border-onedark-borderSubtle space-y-4 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-mono text-onedark-muted mb-1.5 font-medium">Provider Source</label>
            <input
              type="text"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="w-full bg-onedark-surface border border-onedark-border rounded-xl px-3 py-2 text-xs text-onedark-fgBright font-mono focus:outline-none focus:border-onedark-accent transition-colors"
              placeholder="github"
            />
          </div>
          <div>
            <label className="block text-xs font-mono text-onedark-muted mb-1.5 font-medium">Event Type Name</label>
            <input
              type="text"
              value={eventType}
              onChange={(e) => setEventType(e.target.value)}
              className="w-full bg-onedark-surface border border-onedark-border rounded-xl px-3 py-2 text-xs text-onedark-fgBright font-mono focus:outline-none focus:border-onedark-accent transition-colors"
              placeholder="pull_request.opened"
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-mono text-onedark-muted font-medium">JSON Inbound Webhook Body</label>
            <span className="text-[10px] font-mono text-onedark-muted">Editable JSON</span>
          </div>
          <textarea
            rows={10}
            value={customPayload}
            onChange={(e) => setCustomPayload(e.target.value)}
            className="w-full bg-onedark-surface border border-onedark-border rounded-xl p-3.5 text-xs text-onedark-fg font-mono focus:outline-none focus:border-onedark-accent leading-relaxed shadow-inner"
            spellCheck={false}
          />
        </div>

        {/* Feedback Banner */}
        {feedback && (
          <div
            className={`p-3 rounded-xl border flex items-center space-x-2 text-xs font-mono animate-fadeIn ${
              feedback.type === 'success'
                ? 'bg-onedark-green/10 border-onedark-green/30 text-onedark-green'
                : 'bg-onedark-red/10 border-onedark-red/30 text-onedark-red'
            }`}
          >
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
        )}

        {/* Action Button */}
        <div className="flex items-center justify-between pt-2 border-t border-onedark-borderSubtle">
          <div className="text-[11px] text-onedark-muted flex items-center space-x-1.5 font-mono">
            <Clock className="w-3.5 h-3.5" />
            <span>Sandbox lifecycle: clone $\rightarrow$ analyze $\rightarrow$ comment $\rightarrow$ auto-destroy</span>
          </div>

          <button
            onClick={handleTrigger}
            disabled={loading}
            className="px-5 py-2.5 rounded-xl bg-onedark-accent hover:bg-onedark-accent/90 text-onedark-darker text-xs font-bold flex items-center space-x-2 transition-all shadow-md active:scale-95 disabled:opacity-50 cursor-pointer"
          >
            <Play className="w-3.5 h-3.5 fill-onedark-darker" />
            <span>{loading ? 'Dispatching & Provisioning...' : 'Dispatch Webhook Event'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
