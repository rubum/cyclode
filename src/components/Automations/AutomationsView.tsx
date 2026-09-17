import React, { useState, useEffect, useMemo } from 'react';
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
  MessageSquare,
  Search,
  X,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  LayoutGrid,
  List,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { AutomationRule } from '../../types';
import { ConfirmModal } from '../Common/ConfirmModal';

interface AutomationsViewProps {
  automations: AutomationRule[];
  onToggleRule: (ruleId: string, enabled: boolean) => Promise<void>;
  onCreateRule: (rule: Partial<AutomationRule>) => Promise<void>;
  onDeleteRule?: (ruleId: string) => Promise<void>;
  onNavigateToSimulator?: () => void;
  onBackToChat?: () => void;
}

export const AutomationsView: React.FC<AutomationsViewProps> = ({
  automations,
  onToggleRule,
  onCreateRule,
  onDeleteRule,
  onNavigateToSimulator,
  onBackToChat,
}) => {
  const [filterSource, setFilterSource] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [isBannerCollapsed, setIsBannerCollapsed] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [ruleToDelete, setRuleToDelete] = useState<AutomationRule | null>(null);

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

  // Close modal on ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showCreateModal) {
        setShowCreateModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showCreateModal]);

  const filteredRules = useMemo(() => {
    return automations.filter((r) => {
      if (filterSource !== 'all' && r.source.toLowerCase() !== filterSource.toLowerCase()) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const nameMatch = r.name.toLowerCase().includes(q);
        const eventMatch = (r.event_type || '').toLowerCase().includes(q);
        const personaMatch = (r.persona || '').toLowerCase().includes(q);
        const repoMatch = (r.repo_filter || '').toLowerCase().includes(q);
        return nameMatch || eventMatch || personaMatch || repoMatch;
      }
      return true;
    });
  }, [automations, filterSource, searchQuery]);

  const sourceCounts = useMemo(() => {
    const counts: Record<string, number> = { all: automations.length, github: 0, sentry: 0, appsignal: 0, slack: 0 };
    automations.forEach((r) => {
      const s = (r.source || 'github').toLowerCase();
      if (counts[s] !== undefined) {
        counts[s]++;
      }
    });
    return counts;
  }, [automations]);

  const activeCount = automations.filter((r) => r.enabled).length;

  const getSourceIcon = (source: string) => {
    switch (source.toLowerCase()) {
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
    <div className="h-full w-full overflow-y-auto bg-onedark-bg font-sans text-onedark-fg">
      {/* Sticky Header with Navigation & Primary Actions */}
      <div className="sticky top-0 z-20 bg-onedark-bg/95 backdrop-blur-md border-b border-onedark-borderSubtle">
        <div className="max-w-6xl mx-auto px-6 lg:px-8 py-5 space-y-3">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="flex items-center space-x-3">
              {onBackToChat && (
                <button
                  onClick={onBackToChat}
                  className="inline-flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg bg-onedark-darker hover:bg-onedark-surface text-onedark-fg hover:text-onedark-fgBright text-xs font-medium border border-onedark-border transition-all active:scale-95 shadow-xs"
                  title="Return to Workstation / Chat"
                >
                  <ArrowLeft className="w-3.5 h-3.5 text-onedark-accent" />
                  <span>Workstation</span>
                </button>
              )}

              <div className="p-2 rounded-xl bg-onedark-darker border border-onedark-border text-onedark-accent shadow-xs">
                <Sparkles className="w-4 h-4" />
              </div>

              <div>
                <h1 className="text-base font-bold text-onedark-fgBright flex items-center space-x-2">
                  <span>Automations & Standing Triggers</span>
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-onedark-green/15 text-onedark-green border border-onedark-green/30">
                    {activeCount} Active
                  </span>
                </h1>
                <p className="text-xs text-onedark-fg/70 mt-0.5">
                  Automated event routers, standing agent routines, and PR triage handlers.
                </p>
              </div>
            </div>

            {/* Top Actions */}
            <div className="flex items-center space-x-2">
              <div className="flex items-center bg-onedark-darker p-0.5 rounded-lg border border-onedark-border">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-1.5 rounded-md text-xs transition-colors ${
                    viewMode === 'grid'
                      ? 'bg-onedark-surface text-onedark-accent shadow-xs'
                      : 'text-onedark-muted hover:text-onedark-fgBright'
                  }`}
                  title="Grid View (Cards)"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setViewMode('table')}
                  className={`p-1.5 rounded-md text-xs transition-colors ${
                    viewMode === 'table'
                      ? 'bg-onedark-surface text-onedark-accent shadow-xs'
                      : 'text-onedark-muted hover:text-onedark-fgBright'
                  }`}
                  title="Compact List View"
                >
                  <List className="w-3.5 h-3.5" />
                </button>
              </div>

              {onNavigateToSimulator && (
                <button
                  onClick={onNavigateToSimulator}
                  className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-onedark-darker hover:bg-onedark-surface text-onedark-fgBright rounded-lg text-xs font-medium transition-all border border-onedark-border shadow-xs"
                >
                  <Zap className="w-3.5 h-3.5 text-onedark-yellow" />
                  <span>Simulate Event</span>
                </button>
              )}

              <button
                onClick={() => setShowCreateModal(true)}
                className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 bg-onedark-accent hover:bg-onedark-accent/90 text-onedark-darker rounded-lg text-xs font-bold transition-all shadow-sm active:scale-95"
              >
                <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>New Rule</span>
              </button>
            </div>
          </div>

          {/* Sticky Search & Filter Toolbar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-1">
            <div className="relative flex-1 max-w-md">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-onedark-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search rules by name, event, persona, or repo..."
                className="w-full bg-onedark-darker border border-onedark-border rounded-lg pl-9 pr-8 py-1.5 text-xs text-onedark-fgBright placeholder:text-onedark-muted font-sans focus:outline-none focus:border-onedark-accent transition-colors"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-onedark-muted hover:text-onedark-fgBright p-0.5"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            <div className="flex items-center space-x-1.5 overflow-x-auto pb-0.5">
              {['all', 'github', 'sentry', 'appsignal', 'slack'].map((src) => (
                <button
                  key={src}
                  onClick={() => setFilterSource(src)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium capitalize transition-all whitespace-nowrap border ${
                    filterSource === src
                      ? 'bg-onedark-surface text-onedark-fgBright border-onedark-border shadow-xs'
                      : 'bg-onedark-darker/60 text-onedark-muted hover:text-onedark-fg border-transparent'
                  }`}
                >
                  {src} <span className="font-mono text-[10px] ml-1 opacity-70">({sourceCounts[src] || 0})</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Centered with max-w-6xl */}
      <div className="max-w-6xl mx-auto px-6 lg:px-8 py-8 space-y-6">
        {/* Collapsible Info Banner */}
        <div className="rounded-xl bg-onedark-darker border border-onedark-borderSubtle overflow-hidden transition-all shadow-xs">
        <div 
          onClick={() => setIsBannerCollapsed(!isBannerCollapsed)}
          className="flex items-center justify-between p-3.5 cursor-pointer hover:bg-onedark-surface/40 transition-colors"
        >
          <div className="flex items-center space-x-2.5">
            <Sparkles className="w-4 h-4 text-onedark-accent" />
            <span className="text-xs font-bold text-onedark-fgBright">Standing Triggers & Autonomous Sandboxes</span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-onedark-purple/10 text-onedark-purple border border-onedark-purple/20">
              Ephemeral Worktrees
            </span>
          </div>
          <div className="flex items-center space-x-2 text-xs text-onedark-fg/70">
            <span className="text-[11px] font-medium hidden sm:inline">{isBannerCollapsed ? 'Show Details' : 'Hide Details'}</span>
            {isBannerCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </div>
        </div>

        {!isBannerCollapsed && (
          <div className="p-4 pt-0 border-t border-onedark-borderSubtle/60 grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3">
            <div className="p-3 rounded-lg bg-onedark-bg border border-onedark-borderSubtle">
              <div className="text-[10px] font-semibold text-onedark-fg/60 uppercase">Active Handlers</div>
              <div className="text-sm font-bold text-onedark-green mt-0.5">{activeCount} Trigger Rules</div>
            </div>
            <div className="p-3 rounded-lg bg-onedark-bg border border-onedark-borderSubtle">
              <div className="text-[10px] font-semibold text-onedark-fg/60 uppercase">Auto-Response Comments</div>
              <div className="text-sm font-bold text-onedark-fgBright mt-0.5">
                {automations.filter(r => r.auto_post_comment).length} Enabled
              </div>
            </div>
            <div className="p-3 rounded-lg bg-onedark-bg border border-onedark-borderSubtle">
              <div className="text-[10px] font-semibold text-onedark-fg/60 uppercase">Approval Guardrails</div>
              <div className="text-sm font-bold text-onedark-yellow mt-0.5">
                {automations.filter(r => r.require_approval).length} Gated
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Main List / Grid View */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs text-onedark-fg/70">
          <span className="font-semibold uppercase tracking-wider text-[11px] text-onedark-fg/80">
            Automation Rules ({filteredRules.length} of {automations.length})
          </span>
          {searchQuery && (
            <span className="text-onedark-accent">Filtered by: &ldquo;{searchQuery}&rdquo;</span>
          )}
        </div>

        {filteredRules.length === 0 ? (
          <div className="p-10 text-center space-y-3 bg-onedark-darker rounded-xl border border-onedark-borderSubtle">
            <Sparkles className="w-8 h-8 mx-auto text-onedark-muted opacity-60" />
            <div className="space-y-1">
              <div className="text-sm font-bold text-onedark-fgBright">No matching automation rules</div>
              <p className="text-xs text-onedark-fg/70 max-w-sm mx-auto">
                No rules match &ldquo;{searchQuery}&rdquo;. Try clearing your search or creating a new automation rule.
              </p>
            </div>
            <button
              onClick={() => { setSearchQuery(''); setFilterSource('all'); }}
              className="px-3 py-1.5 bg-onedark-surface text-onedark-fgBright rounded-lg text-xs font-medium border border-onedark-border"
            >
              Reset Filters
            </button>
          </div>
        ) : viewMode === 'table' ? (
          /* Table View */
          <div className="rounded-xl bg-onedark-darker border border-onedark-borderSubtle overflow-hidden shadow-xs">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-onedark-bg border-b border-onedark-borderSubtle text-onedark-fg/70 text-[11px] uppercase tracking-wider font-semibold">
                  <th className="py-3 px-4">Rule Name</th>
                  <th className="py-3 px-3">Source & Event</th>
                  <th className="py-3 px-3">Persona</th>
                  <th className="py-3 px-3">Action</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-onedark-borderSubtle/60">
                {filteredRules.map((rule) => {
                  const SourceIcon = getSourceIcon(rule.source);
                  return (
                    <tr key={rule.id} className="hover:bg-onedark-surface/30 transition-colors">
                      <td className="py-3 px-4 font-bold text-onedark-fgBright">{rule.name}</td>
                      <td className="py-3 px-3 font-mono text-[11px]">
                        <span className="inline-flex items-center space-x-1 text-onedark-accent">
                          <SourceIcon className="w-3 h-3" />
                          <span>{rule.source}:{rule.event_type}</span>
                        </span>
                      </td>
                      <td className="py-3 px-3">
                        <span className="font-semibold text-onedark-fgBright">{rule.persona}</span>
                      </td>
                      <td className="py-3 px-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-mono border ${
                          rule.action === 'awaken_session'
                            ? 'bg-onedark-purple/15 text-onedark-purple border-onedark-purple/30'
                            : 'bg-onedark-accent/15 text-onedark-accent border-onedark-accent/30'
                        }`}>
                          {rule.action === 'awaken_session' ? 'Awaken' : 'Spawn Task'}
                        </span>
                      </td>
                      <td className="py-3 px-3">
                        <span className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                          rule.enabled
                            ? 'bg-onedark-green/15 text-onedark-green border-onedark-green/30'
                            : 'bg-onedark-surface text-onedark-muted border-onedark-border'
                        }`}>
                          {rule.enabled ? 'Active' : 'Paused'}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right">
                        <div className="flex items-center justify-end space-x-1.5">
                          <button
                            onClick={() => onToggleRule(rule.id, !rule.enabled)}
                            className={`p-1.5 rounded-lg border transition-all ${
                              rule.enabled
                                ? 'bg-onedark-green/15 border-onedark-green/30 text-onedark-green'
                                : 'bg-onedark-surface border-onedark-border text-onedark-muted'
                            }`}
                            title={rule.enabled ? 'Disable rule' : 'Enable rule'}
                          >
                            <Power className="w-3 h-3" />
                          </button>
                          {onDeleteRule && (
                            <button
                              onClick={() => setRuleToDelete(rule)}
                              className="p-1.5 rounded-lg bg-onedark-surface hover:bg-onedark-red/20 text-onedark-fg/70 hover:text-onedark-red border border-onedark-border transition-colors cursor-pointer"
                              title="Delete rule"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          /* Grid View */
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredRules.map((rule) => {
              const SourceIcon = getSourceIcon(rule.source);
              return (
                <div
                  key={rule.id}
                  className={`p-4 rounded-xl bg-onedark-darker border transition-all duration-150 space-y-3.5 shadow-xs flex flex-col justify-between ${
                    rule.enabled
                      ? 'border-onedark-border hover:border-onedark-border'
                      : 'border-onedark-borderSubtle opacity-60'
                  }`}
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center space-x-2.5">
                        <div
                          className={`p-2 rounded-lg border ${
                            rule.enabled
                              ? 'bg-onedark-surface border-onedark-border text-onedark-accent'
                              : 'bg-onedark-bg border-onedark-borderSubtle text-onedark-muted'
                          }`}
                        >
                          <SourceIcon className="w-4 h-4" />
                        </div>
                        <div>
                          <h2 className="text-sm font-bold text-onedark-fgBright">{rule.name}</h2>
                          <div className="flex items-center space-x-2 mt-0.5 text-xs text-onedark-fg/70 font-mono">
                            <span className="uppercase text-[11px] font-semibold text-onedark-fgBright">{rule.source}</span>
                            <span>•</span>
                            <span className="text-[11px] text-onedark-accent">{rule.event_type}</span>
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={() => onToggleRule(rule.id, !rule.enabled)}
                        className={`p-1.5 rounded-lg border transition-all shadow-xs active:scale-95 ${
                          rule.enabled
                            ? 'bg-onedark-green/15 border-onedark-green/30 text-onedark-green hover:bg-onedark-green/25'
                            : 'bg-onedark-surface border-onedark-border text-onedark-muted hover:text-onedark-fg'
                        }`}
                        title={rule.enabled ? 'Click to pause' : 'Click to activate'}
                      >
                        <Power className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5 font-mono text-xs">
                      <span className="px-2.5 py-0.5 rounded-md bg-onedark-bg border border-onedark-borderSubtle text-onedark-fgBright">
                        Persona: <strong className="text-onedark-accent font-semibold">{rule.persona}</strong>
                      </span>

                      <span className={`px-2.5 py-0.5 rounded-md border ${
                        rule.action === 'awaken_session'
                          ? 'bg-onedark-purple/15 border-onedark-purple/30 text-onedark-purple'
                          : 'bg-onedark-accent/15 border-onedark-accent/30 text-onedark-accent'
                      }`}>
                        {rule.action === 'awaken_session' ? '⚡ Awaken Session' : '🚀 Spawn New Task'}
                      </span>

                      <span className="px-2.5 py-0.5 rounded-md bg-onedark-bg border border-onedark-borderSubtle text-onedark-fg/70">
                        Repo: {rule.repo_filter}
                      </span>
                    </div>
                  </div>

                  <div className="pt-2.5 border-t border-onedark-borderSubtle flex items-center justify-between text-xs text-onedark-fg/70 font-mono">
                    <div className="flex items-center space-x-3">
                      <span className="flex items-center space-x-1 text-xs">
                        <Check className={`w-3.5 h-3.5 ${rule.auto_post_comment ? 'text-onedark-green' : 'text-onedark-muted'}`} />
                        <span className={rule.auto_post_comment ? 'text-onedark-fgBright' : 'text-onedark-muted'}>Auto-reply</span>
                      </span>
                      <span className="flex items-center space-x-1 text-xs">
                        <Lock className={`w-3.5 h-3.5 ${rule.require_approval ? 'text-onedark-yellow' : 'text-onedark-muted'}`} />
                        <span className={rule.require_approval ? 'text-onedark-yellow' : 'text-onedark-fgBright'}>
                          {rule.require_approval ? 'Approval Gated' : 'Auto Exec'}
                        </span>
                      </span>
                    </div>

                    {onDeleteRule && (
                      <button
                        onClick={() => setRuleToDelete(rule)}
                        className="p-1.5 rounded-lg bg-onedark-surface hover:bg-onedark-red/20 text-onedark-fg/60 hover:text-onedark-red border border-onedark-border transition-colors cursor-pointer"
                        title="Delete Rule"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>

      {/* Create Modal with ESC support */}
      {showCreateModal && (
        <div 
          onClick={(e) => { if (e.target === e.currentTarget) setShowCreateModal(false); }}
          className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200"
        >
          <div className="bg-onedark-darker border border-onedark-border rounded-xl w-full max-w-lg shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-onedark-borderSubtle pb-3">
              <h3 className="text-sm font-bold text-onedark-fgBright flex items-center space-x-2">
                <Sparkles className="w-4 h-4 text-onedark-accent" />
                <span>Create Automation Rule</span>
              </h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-onedark-fg/60 hover:text-onedark-fgBright p-1 rounded-md hover:bg-onedark-surface transition-colors"
                title="Close (Esc)"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-3.5 text-xs font-sans">
              <div>
                <label className="block text-xs font-semibold text-onedark-fgBright mb-1">Rule Name</label>
                <input
                  type="text"
                  required
                  value={newRule.name}
                  onChange={(e) => setNewRule({ ...newRule, name: e.target.value })}
                  placeholder="e.g. Automated Hotfix Reviewer"
                  className="w-full bg-onedark-bg border border-onedark-border rounded-lg px-3 py-1.5 text-xs text-onedark-fgBright focus:outline-none focus:border-onedark-accent"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-onedark-fgBright mb-1">Source</label>
                  <select
                    value={newRule.source}
                    onChange={(e) => setNewRule({ ...newRule, source: e.target.value })}
                    className="w-full bg-onedark-bg border border-onedark-border rounded-lg px-3 py-1.5 text-xs text-onedark-fgBright focus:outline-none focus:border-onedark-accent"
                  >
                    <option value="github">GitHub</option>
                    <option value="sentry">Sentry</option>
                    <option value="appsignal">AppSignal</option>
                    <option value="slack">Slack</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-onedark-fgBright mb-1">Event Type</label>
                  <input
                    type="text"
                    required
                    value={newRule.event_type}
                    onChange={(e) => setNewRule({ ...newRule, event_type: e.target.value })}
                    placeholder="pull_request.opened"
                    className="w-full bg-onedark-bg border border-onedark-border rounded-lg px-3 py-1.5 text-xs text-onedark-fgBright focus:outline-none focus:border-onedark-accent font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-onedark-fgBright mb-1">Persona</label>
                  <select
                    value={newRule.persona}
                    onChange={(e) => setNewRule({ ...newRule, persona: e.target.value })}
                    className="w-full bg-onedark-bg border border-onedark-border rounded-lg px-3 py-1.5 text-xs text-onedark-fgBright focus:outline-none focus:border-onedark-accent"
                  >
                    <option value="CodeReviewer">CodeReviewer</option>
                    <option value="PairProgrammer">PairProgrammer</option>
                    <option value="IssueResolver">IssueResolver</option>
                    <option value="APMTriage">APMTriage</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-onedark-fgBright mb-1">Action</label>
                  <select
                    value={newRule.action}
                    onChange={(e) => setNewRule({ ...newRule, action: e.target.value as any })}
                    className="w-full bg-onedark-bg border border-onedark-border rounded-lg px-3 py-1.5 text-xs text-onedark-fgBright focus:outline-none focus:border-onedark-accent"
                  >
                    <option value="spawn_task">Spawn New Task</option>
                    <option value="awaken_session">Awaken Existing Session</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center space-x-4 pt-1">
                <label className="flex items-center space-x-2 cursor-pointer text-xs font-medium text-onedark-fgBright">
                  <input
                    type="checkbox"
                    checked={newRule.auto_post_comment}
                    onChange={(e) => setNewRule({ ...newRule, auto_post_comment: e.target.checked })}
                    className="rounded border-onedark-border bg-onedark-bg text-onedark-accent"
                  />
                  <span>Auto-post comment</span>
                </label>

                <label className="flex items-center space-x-2 cursor-pointer text-xs font-medium text-onedark-fgBright">
                  <input
                    type="checkbox"
                    checked={newRule.require_approval}
                    onChange={(e) => setNewRule({ ...newRule, require_approval: e.target.checked })}
                    className="rounded border-onedark-border bg-onedark-bg text-onedark-accent"
                  />
                  <span>Require approval</span>
                </label>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-onedark-borderSubtle">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-onedark-fg/70 hover:text-onedark-fgBright hover:bg-onedark-surface transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-onedark-accent hover:bg-onedark-accent/90 text-onedark-darker text-xs font-bold transition-all shadow-xs"
                >
                  Create Rule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Rule Confirm Modal */}
      <ConfirmModal
        isOpen={!!ruleToDelete}
        title="Delete Automation Rule"
        description={`Are you sure you want to delete rule "${ruleToDelete?.name}"?`}
        confirmText="Delete Rule"
        cancelText="Cancel"
        variant="danger"
        impactItems={[
          `Inbound events for '${ruleToDelete?.source} • ${ruleToDelete?.event_type}' will no longer trigger this automated routine`,
          'Target repo filter setting will be removed',
        ]}
        safeItems={[
          'Remote repositories and codebases are completely unaffected',
        ]}
        onConfirm={async () => {
          if (ruleToDelete && onDeleteRule) {
            await onDeleteRule(ruleToDelete.id);
            setRuleToDelete(null);
          }
        }}
        onCancel={() => setRuleToDelete(null)}
      />
    </div>
  );
};