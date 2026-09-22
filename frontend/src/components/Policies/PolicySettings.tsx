import React, { useState, useEffect, useMemo } from 'react';
import { 
  ShieldCheck, 
  CheckCircle2, 
  Save, 
  Search, 
  X, 
  ArrowLeft, 
  ChevronDown, 
  ChevronUp, 
  Lock, 
  Unlock, 
  Ban, 
  Check, 
  Sparkles, 
  GitBranch, 
  MessageSquare, 
  Terminal, 
  Layers, 
  PlugZap 
} from 'lucide-react';
import { PolicyMap } from '../../types';

interface PolicySettingsProps {
  policies: PolicyMap;
  onUpdatePolicies: (newPolicies: PolicyMap) => Promise<any>;
  onBackToChat?: () => void;
  onNavigateToIntegrations?: () => void;
}

export const PolicySettings: React.FC<PolicySettingsProps> = ({ 
  policies, 
  onUpdatePolicies,
  onBackToChat,
  onNavigateToIntegrations
}) => {
  const [localPolicies, setLocalPolicies] = useState<PolicyMap>(policies);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [isBannerCollapsed, setIsBannerCollapsed] = useState(false);

  useEffect(() => {
    setLocalPolicies(policies);
  }, [policies]);

  const handleChange = (action: string, level: 'auto' | 'require_approval' | 'disabled') => {
    setLocalPolicies((prev) => ({ ...prev, [action]: level }));
    setSaveSuccess(false);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onUpdatePolicies(localPolicies);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  const actionDescriptions: Record<string, { label: string; desc: string; category: string; icon: any }> = {
    git_push: {
      label: 'Push Branch to Git Remote',
      desc: 'Allows the agent to push new branches (e.g. cyclode/fix-*) to upstream repository.',
      category: 'Git Operations',
      icon: GitBranch,
    },
    create_pull_request: {
      label: 'Create GitHub Pull Request',
      desc: 'Allows the agent to open Pull Requests via the GitHub API.',
      category: 'Git Operations',
      icon: GitBranch,
    },
    post_comment: {
      label: 'Post Issue / PR Comments',
      desc: 'Allows the agent to post progress updates directly onto GitHub issues.',
      category: 'Communication',
      icon: MessageSquare,
    },
    slack_notify: {
      label: 'Post Slack Broadcasts',
      desc: 'Allows the agent to send status alerts to configured Slack channels.',
      category: 'Communication',
      icon: MessageSquare,
    },
    merge_pr: {
      label: 'Merge Pull Requests',
      desc: 'Allows the agent to automatically merge Pull Requests upon test suite success.',
      category: 'Production Ops',
      icon: Sparkles,
    },
    execute_shell: {
      label: 'Execute Local Shell Commands',
      desc: 'Allows the agent to run test runners (pytest, npm test) and git inside the sandbox.',
      category: 'Sandbox Execution',
      icon: Terminal,
    },
  };

  const entries = useMemo(() => {
    return Object.entries(localPolicies);
  }, [localPolicies]);

  const counts = useMemo(() => {
    const total = entries.length;
    const auto = entries.filter(([_, level]) => level === 'auto').length;
    const approval = entries.filter(([_, level]) => level === 'require_approval').length;
    const disabled = entries.filter(([_, level]) => level === 'disabled').length;
    return { total, auto, approval, disabled };
  }, [entries]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    Object.values(actionDescriptions).forEach((a) => set.add(a.category));
    return ['all', ...Array.from(set)];
  }, []);

  const filteredEntries = useMemo(() => {
    return entries.filter(([action]) => {
      const info = actionDescriptions[action] || {
        label: action,
        desc: 'Action approval rule',
        category: 'General',
      };

      if (categoryFilter !== 'all' && info.category !== categoryFilter) {
        return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const labelMatch = info.label.toLowerCase().includes(q);
        const descMatch = info.desc.toLowerCase().includes(q);
        const catMatch = info.category.toLowerCase().includes(q);
        const actionMatch = action.toLowerCase().includes(q);
        return labelMatch || descMatch || catMatch || actionMatch;
      }

      return true;
    });
  }, [entries, categoryFilter, searchQuery]);

  return (
    <div className="h-full w-full overflow-y-auto bg-onedark-bg font-sans text-onedark-fg">
      {/* Sticky Header with Centered Max-Width */}
      <div className="sticky top-0 z-20 bg-onedark-bg/95 backdrop-blur-md border-b border-onedark-borderSubtle">
        <div className="max-w-5xl mx-auto px-6 lg:px-8 py-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center space-x-3.5">
              {onBackToChat && (
                <button
                  onClick={onBackToChat}
                  className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-onedark-darker hover:bg-onedark-surface text-onedark-fgBright hover:text-onedark-accent text-xs font-mono font-semibold transition-all active:scale-95 shadow-xs cursor-pointer border border-onedark-borderSubtle"
                  title="Return to Workstation / Chat"
                >
                  <ArrowLeft className="w-4 h-4 text-onedark-accent" />
                  <span>Workstation</span>
                </button>
              )}

              <div className="p-2 rounded-xl bg-onedark-darker text-onedark-accent shadow-xs border border-onedark-borderSubtle">
                <ShieldCheck className="w-5 h-5" />
              </div>

              <div>
                <div className="flex items-center space-x-2">
                  <h1 className="text-lg font-bold text-onedark-fgBright tracking-tight">
                    Action Approval Policies
                  </h1>
                  <span className="text-xs font-mono px-2.5 py-0.5 rounded-full bg-onedark-surface text-onedark-fgBright font-bold border border-onedark-borderSubtle">
                    {entries.length} Policies
                  </span>
                  {saveSuccess && (
                    <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-onedark-green/15 text-onedark-green border border-onedark-green/30 animate-in fade-in">
                      <Check className="w-3.5 h-3.5 text-onedark-green" />
                      <span>SAVED</span>
                    </span>
                  )}
                </div>
                <p className="text-xs text-onedark-fg/75 mt-0.5">
                  Granular permission guardrails governing autonomous agent actions vs. human approvals.
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-2.5">
              {onNavigateToIntegrations && (
                <button
                  onClick={onNavigateToIntegrations}
                  className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-onedark-darker hover:bg-onedark-surface text-onedark-fgBright hover:text-onedark-accent text-xs font-mono font-medium transition-all cursor-pointer shadow-xs border border-onedark-borderSubtle"
                  title="Manage API keys, external providers, and webhook gateways"
                >
                  <PlugZap className="w-4 h-4 text-onedark-accent" />
                  <span>Integrations & API Keys →</span>
                </button>
              )}

              <button
                onClick={handleSave}
                disabled={isSaving}
                className="inline-flex items-center space-x-1.5 px-4 py-1.5 bg-onedark-accent hover:bg-onedark-accent/90 text-onedark-darker rounded-lg text-xs font-mono font-bold transition-all shadow-sm active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                {saveSuccess ? (
                  <>
                    <Check className="w-4 h-4 stroke-[2.5]" />
                    <span>Policies Saved!</span>
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    <span>{isSaving ? 'Saving...' : 'Save Changes'}</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Sticky Search & Category Filter Toolbar */}
          <div className="mt-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-onedark-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search policy actions (e.g. git_push, comment, shell)..."
                className="w-full bg-onedark-darker border border-onedark-border rounded-xl pl-9 pr-8 py-2 text-xs text-onedark-fgBright placeholder:text-onedark-muted font-sans focus:outline-none focus:border-onedark-accent transition-colors shadow-xs"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-onedark-muted hover:text-onedark-fgBright p-1"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center space-x-1.5 overflow-x-auto pb-0.5">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono font-semibold transition-all whitespace-nowrap cursor-pointer border ${
                    categoryFilter === cat
                      ? 'bg-onedark-accent text-onedark-darker border-onedark-accent shadow-xs font-bold'
                      : 'bg-onedark-darker text-onedark-muted hover:text-onedark-fgBright hover:bg-onedark-surface border-onedark-borderSubtle'
                  }`}
                >
                  {cat === 'all' ? 'All Policies' : cat}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Centered with max-w-5xl */}
      <div className="max-w-5xl mx-auto px-6 lg:px-8 py-8 space-y-6">
        {/* Collapsible Overview Guardrails Banner */}
        <div className="rounded-xl bg-onedark-darker border border-onedark-borderSubtle overflow-hidden transition-all shadow-sm">
          <div 
            onClick={() => setIsBannerCollapsed(!isBannerCollapsed)}
            className="flex items-center justify-between p-4 cursor-pointer hover:bg-onedark-surface/60 transition-colors"
          >
            <div className="flex items-center space-x-3">
              <ShieldCheck className="w-5 h-5 text-onedark-accent" />
              <span className="text-sm font-bold text-onedark-fgBright">Active Policy Guardrails & Governance</span>
              <span className="text-xs font-mono font-bold px-2.5 py-0.5 rounded-full bg-onedark-green/15 text-onedark-green border border-onedark-green/30">
                Enforced at Tool Execution
              </span>
            </div>
            <div className="flex items-center space-x-2 text-xs text-onedark-muted">
              <span className="text-xs font-medium hidden sm:inline">{isBannerCollapsed ? 'Show Details' : 'Hide Details'}</span>
              {isBannerCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            </div>
          </div>

          {!isBannerCollapsed && (
            <div className="p-4 pt-0 border-t border-onedark-borderSubtle grid grid-cols-1 sm:grid-cols-3 gap-3.5 pt-3">
              <div className="p-4 rounded-xl bg-onedark-bg border border-onedark-borderSubtle shadow-xs">
                <div className="text-xs font-bold text-onedark-muted uppercase font-mono">Auto-Allow (Autonomous)</div>
                <div className="text-lg font-bold text-onedark-green mt-1">{counts.auto} Actions</div>
              </div>

              <div className="p-4 rounded-xl bg-onedark-bg border border-onedark-borderSubtle shadow-xs">
                <div className="text-xs font-bold text-onedark-muted uppercase font-mono">Require Human Approval</div>
                <div className="text-lg font-bold text-onedark-purple mt-1">{counts.approval} Actions</div>
              </div>

              <div className="p-4 rounded-xl bg-onedark-bg border border-onedark-borderSubtle shadow-xs">
                <div className="text-xs font-bold text-onedark-muted uppercase font-mono">Forbidden (Disabled)</div>
                <div className="text-lg font-bold text-onedark-red mt-1">{counts.disabled} Actions</div>
              </div>
            </div>
          )}
        </div>

        {/* Policy Cards Stack */}
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-onedark-muted font-mono">
            <span className="font-bold uppercase tracking-wider">
              Policy Definitions ({filteredEntries.length} of {entries.length})
            </span>
            {searchQuery && (
              <span className="text-onedark-accent font-semibold">Filtered by: &ldquo;{searchQuery}&rdquo;</span>
            )}
          </div>

          {filteredEntries.map(([action, level]) => {
            const info = actionDescriptions[action] || {
              label: action,
              desc: 'Action approval rule',
              category: 'General',
              icon: ShieldCheck,
            };
            const ActionIcon = info.icon || ShieldCheck;

            return (
              <div
                key={action}
                className="p-5 rounded-xl bg-onedark-darker border border-onedark-borderSubtle hover:border-onedark-border flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all shadow-xs"
              >
                <div className="flex items-start space-x-3.5 max-w-xl">
                  <div className="p-2.5 rounded-xl bg-onedark-surface text-onedark-fgBright shadow-xs mt-0.5 border border-onedark-borderSubtle">
                    <ActionIcon className="w-5 h-5 text-onedark-accent" />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2.5">
                      <h3 className="text-sm font-bold text-onedark-fgBright">{info.label}</h3>
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono bg-onedark-surface text-onedark-muted border border-onedark-borderSubtle">
                        {info.category}
                      </span>
                    </div>
                    <p className="text-xs text-onedark-fg/90 leading-relaxed font-normal">
                      {info.desc}
                    </p>
                  </div>
                </div>

                {/* Action Controls with Bordered Segmented Pill States */}
                <div className="grid grid-cols-3 gap-1 p-1 bg-onedark-bg rounded-xl border border-onedark-borderSubtle shrink-0 sm:w-80">
                  <label
                    className={`p-2.5 rounded-lg flex items-center space-x-2 cursor-pointer transition-all ${
                      level === 'auto'
                        ? 'bg-onedark-green/20 text-onedark-green font-bold shadow-xs'
                        : 'text-onedark-muted hover:text-onedark-fgBright hover:bg-onedark-surface/40'
                    }`}
                  >
                    <input
                      type="radio"
                      name={`policy_${action}`}
                      checked={level === 'auto'}
                      onChange={() => handleChange(action, 'auto')}
                      className="hidden"
                    />
                    <Unlock className={`w-3.5 h-3.5 shrink-0 ${level === 'auto' ? 'text-onedark-green' : 'text-onedark-muted'}`} />
                    <div>
                      <div className="text-xs font-bold leading-tight">Auto-Allow</div>
                      <div className="text-[10px] opacity-75 font-normal">Autonomous</div>
                    </div>
                  </label>

                  <label
                    className={`p-2.5 rounded-lg flex items-center space-x-2 cursor-pointer transition-all ${
                      level === 'require_approval'
                        ? 'bg-onedark-purple/20 text-onedark-purple font-bold shadow-xs'
                        : 'text-onedark-muted hover:text-onedark-fgBright hover:bg-onedark-surface/40'
                    }`}
                  >
                    <input
                      type="radio"
                      name={`policy_${action}`}
                      checked={level === 'require_approval'}
                      onChange={() => handleChange(action, 'require_approval')}
                      className="hidden"
                    />
                    <Lock className={`w-3.5 h-3.5 shrink-0 ${level === 'require_approval' ? 'text-onedark-purple' : 'text-onedark-muted'}`} />
                    <div>
                      <div className="text-xs font-bold leading-tight">Approval</div>
                      <div className="text-[10px] opacity-75 font-normal">Human Verify</div>
                    </div>
                  </label>

                  <label
                    className={`p-2.5 rounded-lg flex items-center space-x-2 cursor-pointer transition-all ${
                      level === 'disabled'
                        ? 'bg-onedark-red/20 text-onedark-red font-bold shadow-xs'
                        : 'text-onedark-muted hover:text-onedark-fgBright hover:bg-onedark-surface/40'
                    }`}
                  >
                    <input
                      type="radio"
                      name={`policy_${action}`}
                      checked={level === 'disabled'}
                      onChange={() => handleChange(action, 'disabled')}
                      className="hidden"
                    />
                    <Ban className={`w-3.5 h-3.5 shrink-0 ${level === 'disabled' ? 'text-onedark-red' : 'text-onedark-muted'}`} />
                    <div>
                      <div className="text-xs font-bold leading-tight">Disabled</div>
                      <div className="text-[10px] opacity-75 font-normal">Forbidden</div>
                    </div>
                  </label>
                </div>
              </div>
            );
          })}

          {filteredEntries.length === 0 && (
            <div className="p-12 text-center border border-dashed border-onedark-border rounded-2xl bg-onedark-darker/90 space-y-3.5">
              <ShieldCheck className="w-10 h-10 text-onedark-muted mx-auto opacity-50" />
              <h3 className="text-sm font-bold text-onedark-fgBright">No matching policies found</h3>
              <p className="text-xs text-onedark-muted max-w-md mx-auto">
                No action approval policy matches &ldquo;{searchQuery}&rdquo;.
              </p>
              {/gem|api|key|token|auth|slack|github|sentry|appsignal/i.test(searchQuery) && (
                <div className="pt-2">
                  <p className="text-xs text-onedark-accent font-medium mb-3">
                    Looking to configure API keys or external developer services?
                  </p>
                  {onNavigateToIntegrations && (
                    <button
                      onClick={onNavigateToIntegrations}
                      className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-lg bg-onedark-accent/15 text-onedark-accent border border-onedark-accent/30 text-xs font-mono font-bold hover:bg-onedark-accent/25 transition-all cursor-pointer shadow-xs"
                    >
                      <PlugZap className="w-4 h-4" />
                      <span>Go to Integrations & Skills Hub →</span>
                    </button>
                  )}
                </div>
              )}
              <div>
                <button
                  onClick={() => { setSearchQuery(''); setCategoryFilter('all'); }}
                  className="px-3.5 py-1.5 rounded-lg bg-onedark-surface hover:bg-onedark-border text-onedark-fg text-xs font-mono font-medium transition-colors cursor-pointer mt-2 border border-onedark-border"
                >
                  Reset Search
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
