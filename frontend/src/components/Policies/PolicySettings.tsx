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
  Layers
} from 'lucide-react';
import { PolicyMap } from '../../types';

interface PolicySettingsProps {
  policies: PolicyMap;
  onUpdatePolicies: (newPolicies: PolicyMap) => Promise<any>;
  onBackToChat?: () => void;
}

export const PolicySettings: React.FC<PolicySettingsProps> = ({ 
  policies, 
  onUpdatePolicies,
  onBackToChat 
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
      desc: 'Allows the agent to push new branches (e.g. adappty/fix-*) to upstream.',
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
      desc: 'Allows the agent to run test runners (pytest, npm test) and git in the sandbox.',
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
    <div className="h-full w-full flex flex-col min-h-0 overflow-y-auto px-6 pb-8 bg-onedark-bg font-sans text-onedark-fg">
      {/* Sticky Header with Navigation & Primary Action */}
      <div className="sticky top-0 z-20 bg-onedark-bg/95 backdrop-blur-md pt-5 pb-4 border-b border-onedark-borderSubtle -mx-6 px-6 mb-5 space-y-3">
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
              <ShieldCheck className="w-4 h-4" />
            </div>

            <div>
              <h1 className="text-base font-bold text-onedark-fgBright flex items-center space-x-2">
                <span>Action Approval Policies</span>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-onedark-surface text-onedark-fgBright border border-onedark-border">
                  {entries.length} Policies
                </span>
                {saveSuccess && (
                  <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-onedark-green/15 text-onedark-green border border-onedark-green/30 animate-in fade-in">
                    <Check className="w-3 h-3 text-onedark-green" />
                    <span>SAVED</span>
                  </span>
                )}
              </h1>
              <p className="text-xs text-onedark-fg/70 mt-0.5">
                Granular permission guardrails governing autonomous actions vs. human approvals.
              </p>
            </div>
          </div>

          <button
            onClick={handleSave}
            disabled={isSaving}
            className="inline-flex items-center space-x-1.5 px-4 py-1.5 bg-onedark-accent hover:bg-onedark-accent/90 text-onedark-darker rounded-lg text-xs font-bold transition-all shadow-sm active:scale-95 disabled:opacity-50"
          >
            {saveSuccess ? (
              <>
                <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>Policies Saved!</span>
              </>
            ) : (
              <>
                <Save className="w-3.5 h-3.5" />
                <span>{isSaving ? 'Saving...' : 'Save Changes'}</span>
              </>
            )}
          </button>
        </div>

        {/* Sticky Search & Category Filter Toolbar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-1">
          <div className="relative flex-1 max-w-md">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-onedark-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search policy actions (e.g. git_push, comment, shell)..."
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
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all whitespace-nowrap border ${
                  categoryFilter === cat
                    ? 'bg-onedark-surface text-onedark-fgBright border-onedark-border shadow-xs'
                    : 'bg-onedark-darker/60 text-onedark-muted hover:text-onedark-fg border-transparent'
                }`}
              >
                {cat === 'all' ? 'All Policies' : cat}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Collapsible Overview Guardrails Banner */}
      <div className="mb-5 rounded-xl bg-onedark-darker border border-onedark-borderSubtle overflow-hidden transition-all shadow-xs">
        <div 
          onClick={() => setIsBannerCollapsed(!isBannerCollapsed)}
          className="flex items-center justify-between p-3.5 cursor-pointer hover:bg-onedark-surface/40 transition-colors"
        >
          <div className="flex items-center space-x-2.5">
            <ShieldCheck className="w-4 h-4 text-onedark-accent" />
            <span className="text-xs font-bold text-onedark-fgBright">Active Policy Guardrails & Governance</span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-onedark-green/10 text-onedark-green border border-onedark-green/20">
              Enforced at Tool Execution
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
              <div className="text-[10px] font-semibold text-onedark-fg/60 uppercase">Auto-Allow (Autonomous)</div>
              <div className="text-base font-bold text-onedark-green mt-0.5">{counts.auto} Actions</div>
            </div>

            <div className="p-3 rounded-lg bg-onedark-bg border border-onedark-borderSubtle">
              <div className="text-[10px] font-semibold text-onedark-fg/60 uppercase">Require Human Approval</div>
              <div className="text-base font-bold text-onedark-purple mt-0.5">{counts.approval} Actions</div>
            </div>

            <div className="p-3 rounded-lg bg-onedark-bg border border-onedark-borderSubtle">
              <div className="text-[10px] font-semibold text-onedark-fg/60 uppercase">Forbidden (Disabled)</div>
              <div className="text-base font-bold text-onedark-red mt-0.5">{counts.disabled} Actions</div>
            </div>
          </div>
        )}
      </div>

      {/* Policy Cards Grid */}
      <div className="space-y-3.5">
        <div className="flex items-center justify-between text-xs text-onedark-fg/70">
          <span className="font-semibold uppercase tracking-wider text-[11px] text-onedark-fg/80">
            Policy Definitions ({filteredEntries.length} of {entries.length})
          </span>
          {searchQuery && (
            <span className="text-onedark-accent">Filtered by: &ldquo;{searchQuery}&rdquo;</span>
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
            <div key={action} className="p-4 rounded-xl bg-onedark-darker border border-onedark-borderSubtle hover:border-onedark-border transition-all space-y-3 shadow-xs">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start space-x-3">
                  <div className="p-2 rounded-lg bg-onedark-surface text-onedark-accent border border-onedark-border shrink-0 mt-0.5">
                    <ActionIcon className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-onedark-fgBright font-mono">{info.label}</div>
                    <div className="text-xs text-onedark-fg/70 mt-0.5">{info.desc}</div>
                  </div>
                </div>

                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-onedark-surface text-onedark-fgBright border border-onedark-border shrink-0">
                  {info.category}
                </span>
              </div>

              {/* Selector Pills */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2 border-t border-onedark-borderSubtle/60 text-xs font-sans">
                <label
                  className={`p-2.5 rounded-lg border flex items-center space-x-2.5 cursor-pointer transition-all ${
                    level === 'auto'
                      ? 'bg-onedark-green/15 border-onedark-green/40 text-onedark-fgBright font-bold shadow-xs'
                      : 'bg-onedark-bg border-onedark-borderSubtle text-onedark-fg/70 hover:text-onedark-fgBright hover:bg-onedark-surface/40'
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
                    <div className="text-xs font-bold">Auto-Allow</div>
                    <div className="text-[10px] opacity-75 font-normal">Autonomous execution</div>
                  </div>
                </label>

                <label
                  className={`p-2.5 rounded-lg border flex items-center space-x-2.5 cursor-pointer transition-all ${
                    level === 'require_approval'
                      ? 'bg-onedark-purple/15 border-onedark-purple/40 text-onedark-fgBright font-bold shadow-xs'
                      : 'bg-onedark-bg border-onedark-borderSubtle text-onedark-fg/70 hover:text-onedark-fgBright hover:bg-onedark-surface/40'
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
                    <div className="text-xs font-bold">Require Approval</div>
                    <div className="text-[10px] opacity-75 font-normal">Human verification</div>
                  </div>
                </label>

                <label
                  className={`p-2.5 rounded-lg border flex items-center space-x-2.5 cursor-pointer transition-all ${
                    level === 'disabled'
                      ? 'bg-onedark-red/15 border-onedark-red/40 text-onedark-fgBright font-bold shadow-xs'
                      : 'bg-onedark-bg border-onedark-borderSubtle text-onedark-fg/70 hover:text-onedark-fgBright hover:bg-onedark-surface/40'
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
                    <div className="text-xs font-bold">Disabled</div>
                    <div className="text-[10px] opacity-75 font-normal">Action forbidden</div>
                  </div>
                </label>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
