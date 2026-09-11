import React, { useState, useEffect } from 'react';
import { 
  Bot, 
  GitPullRequest, 
  Activity, 
  Bug, 
  ShieldCheck, 
  Plus, 
  Power, 
  Check, 
  Sparkles, 
  RefreshCw, 
  Trash2, 
  ArrowUpRight,
  Zap,
  Lock,
  MessageSquare
} from 'lucide-react';
import { AutomationRule } from '../../types';

interface AutomationsViewProps {
  automations: AutomationRule[];
  onToggleRule: (ruleId: string, enabled: boolean) => Promise<void>;
  onCreateRule: (rule: Partial<AutomationRule>) => Promise<void>;
  onDeleteRule?: (ruleId: string) => Promise<void>;
  onNavigateToSimulator?: () => void;
}

export const AutomationsView: React.FC<AutomationsViewProps> = ({
  automations,
  onToggleRule,
  onCreateRule,
  onDeleteRule,
  onNavigateToSimulator,
}) => {
  const [filterSource, setFilterSource] = useState<string>('all');
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [newRule, setNewRule] = useState<Partial<AutomationRule>>({
    name: '',
    source: 'github',
    event_type: 'pull_request.opened',
    repo_filter: '*',
    persona: 'CodeReviewer',
    action: 'spawn_task',
    auto_post_comment: true,
    require_approval: false,
    enabled: true,
  });

  const filteredRules = automations.filter((r) => {
    if (filterSource === 'all') return true;
    return r.source === filterSource;
  });

  const getSourceIcon = (source: string) => {
    switch (source) {
      case 'github':
        return GitPullRequest;
      case 'sentry':
      case 'appsignal':
        return Activity;
      case 'slack':
        return MessageSquare;
      default:
        return Zap;
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRule.name) return;
    await onCreateRule(newRule);
    setShowCreateModal(false);
    setNewRule({
      name: '',
      source: 'github',
      event_type: 'pull_request.opened',
      repo_filter: '*',
      persona: 'CodeReviewer',
      action: 'spawn_task',
      auto_post_comment: true,
      require_approval: false,
      enabled: true,
    });
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-onedark-bg font-sans text-onedark-fg">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-onedark-borderSubtle pb-5">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-xl font-bold text-onedark-fgBright">Automations & Standing Triggers</h1>
            <span className="px-2.5 py-0.5 rounded-full bg-onedark-accent/15 text-onedark-accent font-mono text-xs font-semibold border border-onedark-accent/20">
              {automations.filter((r) => r.enabled).length} Active
            </span>
          </div>
          <p className="text-xs text-onedark-muted mt-1 leading-relaxed max-w-2xl">
            Configure standing agent triggers for PR reviews, commit awakenings, @adappty mentions, and APM incident auto-triage running in disposable ephemeral sandboxes.
          </p>
        </div>

        <div className="flex items-center space-x-2.5 flex-shrink-0">
          {onNavigateToSimulator && (
            <button
              onClick={onNavigateToSimulator}
              className="px-3.5 py-2 rounded-lg bg-onedark-surface hover:bg-onedark-surface/80 border border-onedark-border text-onedark-fg text-xs font-semibold flex items-center space-x-1.5 transition-all shadow-sm active:scale-95"
            >
              <Zap className="w-3.5 h-3.5 text-onedark-accent" />
              <span>Simulate Webhook</span>
            </button>
          )}

          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 rounded-lg bg-onedark-accent hover:bg-onedark-accent/90 text-onedark-darker text-xs font-bold flex items-center space-x-1.5 transition-all shadow-sm active:scale-95"
          >
            <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>New Automation Rule</span>
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center space-x-1.5 bg-onedark-darker p-1 rounded-xl border border-onedark-borderSubtle max-w-md">
        {['all', 'github', 'sentry', 'appsignal', 'slack'].map((src) => (
          <button
            key={src}
            onClick={() => setFilterSource(src)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all ${
              filterSource === src
                ? 'bg-onedark-surface text-onedark-fgBright shadow-sm font-semibold'
                : 'text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/40'
            }`}
          >
            {src}
          </button>
        ))}
      </div>

      {/* Automation Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredRules.map((rule) => {
          const SourceIcon = getSourceIcon(rule.source);
          return (
            <div
              key={rule.id}
              className={`p-5 rounded-2xl bg-onedark-darker border transition-all duration-150 space-y-4 shadow-sm flex flex-col justify-between ${
                rule.enabled
                  ? 'border-onedark-border hover:border-onedark-accent/40'
                  : 'border-onedark-borderSubtle opacity-60'
              }`}
            >
              <div className="space-y-3">
                {/* Card Header & Toggle */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-2.5">
                    <div
                      className={`p-2 rounded-xl border ${
                        rule.enabled
                          ? 'bg-onedark-surface border-onedark-border text-onedark-accent'
                          : 'bg-onedark-darker border-onedark-borderSubtle text-onedark-muted'
                      }`}
                    >
                      <SourceIcon className="w-4 h-4" />
                    </div>
                    <div>
                      <h2 className="text-sm font-bold text-onedark-fgBright">{rule.name}</h2>
                      <div className="flex items-center space-x-2 mt-0.5 text-xs text-onedark-muted font-mono">
                        <span className="uppercase text-[10.5px] font-semibold text-onedark-fg">{rule.source}</span>
                        <span>•</span>
                        <span className="text-[11px]">{rule.event_type}</span>
                      </div>
                    </div>
                  </div>

                  {/* Power Toggle Button */}
                  <button
                    onClick={() => onToggleRule(rule.id, !rule.enabled)}
                    className={`p-1.5 rounded-xl border transition-all shadow-sm active:scale-95 ${
                      rule.enabled
                        ? 'bg-onedark-green/15 border-onedark-green/30 text-onedark-green hover:bg-onedark-green/25'
                        : 'bg-onedark-surface border-onedark-border text-onedark-muted hover:text-onedark-fg'
                    }`}
                    title={rule.enabled ? 'Click to disable' : 'Click to enable'}
                  >
                    <Power className="w-4 h-4" />
                  </button>
                </div>

                {/* Configuration Badges */}
                <div className="flex flex-wrap items-center gap-2 pt-1 font-mono text-[11px]">
                  <span className="px-2 py-0.5 rounded-md bg-onedark-surface border border-onedark-borderSubtle text-onedark-fg">
                    Persona: <strong className="text-onedark-accent font-semibold">{rule.persona}</strong>
                  </span>

                  <span className={`px-2 py-0.5 rounded-md border ${
                    rule.action === 'awaken_session'
                      ? 'bg-onedark-purple/10 border-onedark-purple/20 text-onedark-purple'
                      : 'bg-onedark-blue/10 border-onedark-blue/20 text-onedark-blue'
                  }`}>
                    {rule.action === 'awaken_session' ? '⚡ Awaken Session' : '🚀 Spawn New Task'}
                  </span>

                  <span className="px-2 py-0.5 rounded-md bg-onedark-surface border border-onedark-borderSubtle text-onedark-muted">
                    Repo: {rule.repo_filter}
                  </span>
                </div>
              </div>

              {/* Card Footer Features */}
              <div className="pt-3 border-t border-onedark-borderSubtle flex items-center justify-between text-xs text-onedark-muted font-mono">
                <div className="flex items-center space-x-3">
                  <span className="flex items-center space-x-1">
                    <Check className={`w-3 h-3 ${rule.auto_post_comment ? 'text-onedark-green' : 'text-onedark-muted'}`} />
                    <span>Auto-reply</span>
                  </span>
                  <span className="flex items-center space-x-1">
                    <Lock className={`w-3 h-3 ${rule.require_approval ? 'text-onedark-yellow' : 'text-onedark-muted'}`} />
                    <span>{rule.require_approval ? 'Approval Gated' : 'Auto Exec'}</span>
                  </span>
                </div>

                {onDeleteRule && (
                  <button
                    onClick={() => onDeleteRule(rule.id)}
                    className="hover:text-onedark-red transition-colors p-1 rounded hover:bg-onedark-surface"
                    title="Delete Rule"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 backdrop-blur-sm animate-fadeIn">
          <div className="bg-onedark-darker border border-onedark-border rounded-2xl w-full max-w-lg shadow-2xl p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-onedark-borderSubtle pb-3">
              <h3 className="text-base font-bold text-onedark-fgBright">Create New Automation Trigger</h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-onedark-muted hover:text-onedark-fg text-xs font-mono"
              >
                Close
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-4 text-xs font-sans">
              <div>
                <label className="block text-onedark-muted font-mono mb-1">Rule Name</label>
                <input
                  type="text"
                  required
                  value={newRule.name}
                  onChange={(e) => setNewRule({ ...newRule, name: e.target.value })}
                  placeholder="e.g. Automated Hotfix Reviewer"
                  className="w-full bg-onedark-surface border border-onedark-border rounded-xl px-3 py-2 text-onedark-fgBright focus:outline-none focus:border-onedark-accent text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-onedark-muted font-mono mb-1">Source</label>
                  <select
                    value={newRule.source}
                    onChange={(e) => setNewRule({ ...newRule, source: e.target.value })}
                    className="w-full bg-onedark-surface border border-onedark-border rounded-xl px-3 py-2 text-onedark-fgBright focus:outline-none focus:border-onedark-accent text-xs"
                  >
                    <option value="github">GitHub</option>
                    <option value="sentry">Sentry</option>
                    <option value="appsignal">AppSignal</option>
                    <option value="slack">Slack</option>
                  </select>
                </div>

                <div>
                  <label className="block text-onedark-muted font-mono mb-1">Event Type</label>
                  <input
                    type="text"
                    required
                    value={newRule.event_type}
                    onChange={(e) => setNewRule({ ...newRule, event_type: e.target.value })}
                    placeholder="pull_request.opened"
                    className="w-full bg-onedark-surface border border-onedark-border rounded-xl px-3 py-2 text-onedark-fgBright focus:outline-none focus:border-onedark-accent text-xs font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-onedark-muted font-mono mb-1">Persona</label>
                  <select
                    value={newRule.persona}
                    onChange={(e) => setNewRule({ ...newRule, persona: e.target.value })}
                    className="w-full bg-onedark-surface border border-onedark-border rounded-xl px-3 py-2 text-onedark-fgBright focus:outline-none focus:border-onedark-accent text-xs"
                  >
                    <option value="CodeReviewer">CodeReviewer</option>
                    <option value="PairProgrammer">PairProgrammer</option>
                    <option value="IssueResolver">IssueResolver</option>
                    <option value="APMTriage">APMTriage</option>
                  </select>
                </div>

                <div>
                  <label className="block text-onedark-muted font-mono mb-1">Action</label>
                  <select
                    value={newRule.action}
                    onChange={(e) => setNewRule({ ...newRule, action: e.target.value as any })}
                    className="w-full bg-onedark-surface border border-onedark-border rounded-xl px-3 py-2 text-onedark-fgBright focus:outline-none focus:border-onedark-accent text-xs"
                  >
                    <option value="spawn_task">Spawn New Task</option>
                    <option value="awaken_session">Awaken Existing Session</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center space-x-4 pt-2">
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newRule.auto_post_comment}
                    onChange={(e) => setNewRule({ ...newRule, auto_post_comment: e.target.checked })}
                    className="rounded border-onedark-border bg-onedark-surface text-onedark-accent"
                  />
                  <span>Auto-post response comment</span>
                </label>

                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newRule.require_approval}
                    onChange={(e) => setNewRule({ ...newRule, require_approval: e.target.checked })}
                    className="rounded border-onedark-border bg-onedark-surface text-onedark-accent"
                  />
                  <span>Require approval before execute</span>
                </label>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-4 border-t border-onedark-borderSubtle">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-xl border border-onedark-border hover:bg-onedark-surface text-onedark-muted text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-onedark-accent hover:bg-onedark-accent/90 text-onedark-darker text-xs font-bold"
                >
                  Create Rule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};