import React, { useState, useMemo } from 'react';
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
  Clock,
  ArrowLeft,
  Search,
  X,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Copy,
  Check,
  Code2,
  RotateCcw
} from 'lucide-react';

interface WebhookSimulatorProps {
  onSimulate: (data: { source: string; event_type: string; payload: any }) => Promise<any>;
  onSuccess: (taskId: string) => void;
  onBackToChat?: () => void;
}

export const WebhookSimulator: React.FC<WebhookSimulatorProps> = ({ 
  onSimulate, 
  onSuccess,
  onBackToChat 
}) => {
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
  const [searchQuery, setSearchQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [isBannerCollapsed, setIsBannerCollapsed] = useState(false);
  const [copiedPayload, setCopiedPayload] = useState(false);

  const presets = [
    {
      id: 'github-pr-opened',
      label: 'GitHub: PR #42 Opened',
      desc: 'Provision ephemeral sandbox, clone branch, run security review',
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
      id: 'github-pr-sync',
      label: 'GitHub: PR #42 Commit 98a1c4f',
      desc: 'Awakens existing session to analyze incremental commit diffs',
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
      id: 'github-pr-comment',
      label: 'GitHub: PR #42 Comment (@cyclode Question)',
      desc: 'Awakens session with conversation context to answer code queries',
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
          body: "@cyclode please verify whether the Redis TTL for idempotency keys is set to 24 hours."
        }
      }
    },
    {
      id: 'sentry-zerodiv',
      label: 'Sentry Alert: ZeroDivisionError',
      desc: 'Triages production stack trace, inspects line 48, generates fix PR',
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
      id: 'appsignal-notfound',
      label: 'AppSignal: ActiveRecord::RecordNotFound',
      desc: 'Reproduces 404 exception in isolated sandbox with Ruby/Rails environment',
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
      id: 'slack-command',
      label: 'Slack: /cyclode review PR #42 test suite',
      desc: 'Interactive chat invocation dispatched from Slack channel',
      badge: 'Interactive',
      icon: Zap,
      source: 'slack',
      eventType: 'slash_command',
      payload: {
        command: "/cyclode",
        text: "run full security test suite on PR #42",
        user_name: "lead_architect",
        channel_name: "#security-triage"
      }
    }
  ];

  const filteredPresets = useMemo(() => {
    return presets.filter((p) => {
      if (sourceFilter !== 'all' && p.source !== sourceFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          p.label.toLowerCase().includes(q) ||
          p.desc.toLowerCase().includes(q) ||
          p.source.toLowerCase().includes(q) ||
          p.eventType.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [presets, sourceFilter, searchQuery]);

  const handleApplyPreset = (p: typeof presets[0]) => {
    setSource(p.source);
    setEventType(p.eventType);
    setCustomPayload(JSON.stringify(p.payload, null, 2));
    setFeedback(null);
  };

  const handleCopyPayload = () => {
    navigator.clipboard.writeText(customPayload);
    setCopiedPayload(true);
    setTimeout(() => setCopiedPayload(false), 2000);
  };

  const handleFormatJson = () => {
    try {
      const parsed = JSON.parse(customPayload);
      setCustomPayload(JSON.stringify(parsed, null, 2));
    } catch {
      // ignore
    }
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
    <div className="h-full w-full flex flex-col min-h-0 overflow-y-auto px-6 pb-8 bg-onedark-bg font-sans text-onedark-fg">
      {/* Sticky Header with Navigation Breadcrumb */}
      <div className="sticky top-0 z-20 bg-onedark-bg/95 backdrop-blur-md pt-6 pb-4 border-b border-onedark-borderSubtle mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center space-x-3">
            {onBackToChat && (
              <button
                onClick={onBackToChat}
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-onedark-darker hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fgBright text-xs font-mono font-medium border border-onedark-borderSubtle transition-all shadow-sm active:scale-95 cursor-pointer"
                title="Return to active chat workstation"
              >
                <ArrowLeft className="w-3.5 h-3.5 text-onedark-accent" />
                <span>← Workstation</span>
              </button>
            )}
            <div className="flex items-center space-x-2">
              <h1 className="text-base font-bold text-onedark-fgBright flex items-center space-x-2">
                <FlaskConical className="w-4 h-4 text-onedark-accent" />
                <span>Event & Webhook Simulator</span>
              </h1>
              <span className="px-2 py-0.5 rounded-full bg-onedark-accent/15 text-onedark-accent font-mono text-[10.5px] font-bold border border-onedark-accent/30">
                Sandbox Testing
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => setIsBannerCollapsed(!isBannerCollapsed)}
              className="px-2.5 py-1.5 rounded-lg bg-onedark-darker hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg text-xs font-mono flex items-center space-x-1.5 border border-onedark-borderSubtle transition-colors cursor-pointer"
            >
              <span>{isBannerCollapsed ? 'Show Info' : 'Hide Info'}</span>
              {isBannerCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Collapsible Sandbox Explanation Banner */}
        {!isBannerCollapsed && (
          <div className="mt-4 p-3.5 rounded-xl bg-onedark-darker border border-onedark-borderSubtle flex flex-col md:flex-row md:items-center justify-between gap-3 animate-fadeIn">
            <div className="flex items-start space-x-3">
              <div className="p-2 rounded-lg bg-onedark-surface border border-onedark-border text-onedark-accent flex-shrink-0 mt-0.5">
                <Sparkles className="w-4 h-4" />
              </div>
              <div className="space-y-0.5">
                <div className="text-xs font-semibold text-onedark-fgBright">
                  Zero-Risk End-to-End Simulation
                </div>
                <p className="text-[11.5px] text-onedark-muted leading-relaxed max-w-3xl">
                  Simulate real inbound payloads from GitHub webhooks, Sentry stack traces, AppSignal incidents, or Slack commands.
                  The dispatch engine verifies routing rules, spins up ephemeral isolated workspaces, and tests agent automations without modifying production branches.
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-2 font-mono text-[11px] text-onedark-accent bg-onedark-surface px-3 py-1.5 rounded-lg border border-onedark-border flex-shrink-0">
              <Clock className="w-3.5 h-3.5" />
              <span>Clone → Run → Review → Cleanup</span>
            </div>
          </div>
        )}

        {/* Sticky Search & Filter Toolbar */}
        <div className="mt-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-3 border-t border-onedark-borderSubtle/60">
          <div className="relative flex-1 max-w-md">
            <Search className="w-3.5 h-3.5 text-onedark-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search scenarios by title, payload keyword, or event..."
              className="w-full bg-onedark-darker border border-onedark-border rounded-lg pl-8 pr-8 py-1.5 text-xs text-onedark-fgBright placeholder:text-onedark-muted/60 focus:outline-none focus:border-onedark-accent transition-colors font-mono"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-onedark-muted hover:text-onedark-fgBright cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 sm:pb-0">
            {['all', 'github', 'sentry', 'appsignal', 'slack'].map((src) => (
              <button
                key={src}
                onClick={() => setSourceFilter(src)}
                className={`px-2.5 py-1 rounded-lg text-xs font-mono font-medium transition-all cursor-pointer ${
                  sourceFilter === src
                    ? 'bg-onedark-accent text-onedark-darker font-bold shadow-sm'
                    : 'bg-onedark-darker text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface border border-onedark-borderSubtle'
                }`}
              >
                {src === 'all' ? 'All Providers' : src.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content: 1-Click Presets & JSON Editor */}
      <div className="space-y-6">
        {/* Presets Grid */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-mono uppercase tracking-wider text-onedark-muted font-semibold flex items-center space-x-1.5">
              <span>1-Click Scenarios ({filteredPresets.length})</span>
            </div>
            <span className="text-[10.5px] font-mono text-onedark-muted">Select a preset to load parameters</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredPresets.map((p) => {
              const Icon = p.icon;
              const isCurrent = source === p.source && eventType === p.eventType;
              return (
                <button
                  key={p.id}
                  onClick={() => handleApplyPreset(p)}
                  className={`p-3.5 rounded-xl border text-left transition-all space-y-2 group relative overflow-hidden flex flex-col justify-between cursor-pointer ${
                    isCurrent
                      ? 'bg-onedark-surface border-onedark-accent shadow-sm'
                      : 'bg-onedark-darker border-onedark-borderSubtle hover:border-onedark-border hover:bg-onedark-surface/40'
                  }`}
                >
                  <div className="space-y-1.5 w-full">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center space-x-2 text-xs font-semibold text-onedark-fgBright group-hover:text-onedark-accent transition-colors">
                        <Icon className="w-4 h-4 flex-shrink-0 text-onedark-accent" />
                        <span className="truncate">{p.label}</span>
                      </div>
                      <span className={`px-1.5 py-0.5 rounded border text-[9.5px] font-mono flex-shrink-0 ${
                        p.badge === 'Awaken'
                          ? 'bg-onedark-purple/15 border-onedark-purple/30 text-onedark-purple'
                          : p.badge === 'APM Incident'
                          ? 'bg-onedark-red/15 border-onedark-red/30 text-onedark-red'
                          : p.badge === 'Interactive'
                          ? 'bg-onedark-blue/15 border-onedark-blue/30 text-onedark-blue'
                          : 'bg-onedark-accent/15 border-onedark-accent/30 text-onedark-accent'
                      }`}>
                        {p.badge}
                      </span>
                    </div>

                    <p className="text-[11px] text-onedark-muted leading-relaxed line-clamp-2">
                      {p.desc}
                    </p>
                  </div>

                  <div className="flex items-center justify-between text-[10.5px] font-mono text-onedark-muted pt-2 border-t border-onedark-borderSubtle/60 w-full mt-2">
                    <span className="truncate">{p.source} • {p.eventType}</span>
                    {isCurrent && (
                      <span className="text-onedark-accent font-bold text-[10px] flex items-center space-x-1">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>Active</span>
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Payload Editor Form */}
        <div className="p-5 rounded-2xl bg-onedark-darker border border-onedark-borderSubtle space-y-4 shadow-sm">
          <div className="flex items-center justify-between pb-3 border-b border-onedark-borderSubtle">
            <div className="flex items-center space-x-2">
              <Code2 className="w-4 h-4 text-onedark-accent" />
              <h3 className="text-xs font-bold text-onedark-fgBright">Payload Dispatch Configuration</h3>
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={handleFormatJson}
                className="px-2.5 py-1 rounded-lg bg-onedark-surface hover:bg-onedark-border text-onedark-muted hover:text-onedark-fgBright text-xs font-mono flex items-center space-x-1 border border-onedark-border transition-colors cursor-pointer"
                title="Format JSON"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Format JSON</span>
              </button>
              <button
                onClick={handleCopyPayload}
                className="px-2.5 py-1 rounded-lg bg-onedark-surface hover:bg-onedark-border text-onedark-muted hover:text-onedark-fgBright text-xs font-mono flex items-center space-x-1 border border-onedark-border transition-colors cursor-pointer"
                title="Copy Payload"
              >
                {copiedPayload ? <Check className="w-3 h-3 text-onedark-green" /> : <Copy className="w-3 h-3" />}
                <span>{copiedPayload ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>

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
              <span className="text-[10px] font-mono text-onedark-muted">Editable JSON (AES HMAC validated on server)</span>
            </div>
            <textarea
              rows={12}
              value={customPayload}
              onChange={(e) => setCustomPayload(e.target.value)}
              className="w-full bg-onedark-surface border border-onedark-border rounded-xl p-3.5 text-xs text-onedark-fg font-mono focus:outline-none focus:border-onedark-accent leading-relaxed shadow-inner"
              spellCheck={false}
            />
          </div>

          {/* Feedback Banner */}
          {feedback && (
            <div
              className={`p-3.5 rounded-xl border flex items-center space-x-2.5 text-xs font-mono animate-fadeIn ${
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
              <span className="leading-relaxed">{feedback.message}</span>
            </div>
          )}

          {/* Action Button */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-onedark-borderSubtle">
            <div className="text-[11px] text-onedark-muted flex items-center space-x-1.5 font-mono">
              <Clock className="w-3.5 h-3.5 text-onedark-accent flex-shrink-0" />
              <span>Sandbox lifecycle: clone → analyze → comment → auto-destroy</span>
            </div>

            <button
              onClick={handleTrigger}
              disabled={loading}
              className="px-5 py-2.5 rounded-xl bg-onedark-accent hover:bg-onedark-accent/90 text-onedark-darker text-xs font-bold flex items-center justify-center space-x-2 transition-all shadow-md active:scale-95 disabled:opacity-50 cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 fill-onedark-darker" />
              <span>{loading ? 'Dispatching & Provisioning...' : 'Dispatch Webhook Event'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
