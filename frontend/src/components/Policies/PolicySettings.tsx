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
  GitPullRequest,
  GitMerge,
  MessageSquare, 
  Terminal, 
  Layers, 
  PlugZap,
  SlidersHorizontal,
  RotateCcw,
  AlertTriangle,
  FileCheck,
  Radio,
  Info
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
  const [statusFilter, setStatusFilter] = useState<'all' | 'auto' | 'require_approval' | 'disabled'>('all');
  const [isBannerCollapsed, setIsBannerCollapsed] = useState(false);

  useEffect(() => {
    setLocalPolicies(policies);
  }, [policies]);

  const handleChange = (action: string, level: 'auto' | 'require_approval' | 'disabled') => {
    setLocalPolicies((prev) => ({ ...prev, [action]: level }));
    setSaveSuccess(false);
  };

  // Determine dirty/unsaved state
  const unsavedCount = useMemo(() => {
    let count = 0;
    Object.keys(localPolicies).forEach((key) => {
      if (localPolicies[key] !== policies[key]) {
        count++;
      }
    });
    return count;
  }, [localPolicies, policies]);

  const hasUnsavedChanges = unsavedCount > 0;

  const handleDiscard = () => {
    setLocalPolicies(policies);
    setSaveSuccess(false);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onUpdatePolicies(localPolicies);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error('Failed to save policies:', err);
    } finally {
      setIsSaving(false);
    }
  };

  // Presets
  const applyPreset = (preset: 'recommended' | 'strict' | 'autonomous') => {
    if (preset === 'recommended') {
      setLocalPolicies({
        git_push: 'require_approval',
        create_pull_request: 'require_approval',
        post_comment: 'auto',
        post_pull_request_review: 'require_approval',
        post_pull_request_line_comment: 'require_approval',
        slack_notify: 'auto',
        merge_pr: 'require_approval',
        execute_shell: 'auto',
      });
    } else if (preset === 'strict') {
      setLocalPolicies({
        git_push: 'require_approval',
        create_pull_request: 'require_approval',
        post_comment: 'require_approval',
        post_pull_request_review: 'require_approval',
        post_pull_request_line_comment: 'require_approval',
        slack_notify: 'require_approval',
        merge_pr: 'require_approval',
        execute_shell: 'require_approval',
      });
    } else if (preset === 'autonomous') {
      setLocalPolicies({
        git_push: 'auto',
        create_pull_request: 'auto',
        post_comment: 'auto',
        post_pull_request_review: 'auto',
        post_pull_request_line_comment: 'auto',
        slack_notify: 'auto',
        merge_pr: 'require_approval',
        execute_shell: 'auto',
      });
    }
    setSaveSuccess(false);
  };

  const actionDescriptions: Record<string, { 
    label: string; 
    actionKey: string;
    desc: string; 
    category: string; 
    icon: any;
    risk: 'Critical Impact' | 'High Impact' | 'Moderate' | 'Low Impact' | 'Sandbox Isolated';
    riskBadgeTheme: string;
    categoryTheme: string;
  }> = {
    git_push: {
      label: 'Push Branch to Git Remote',
      actionKey: 'git_push',
      desc: 'Allows the agent to push new git branches (e.g. cyclode/fix-*) directly to upstream remote repositories.',
      category: 'Git Operations',
      icon: GitBranch,
      risk: 'High Impact',
      riskBadgeTheme: 'bg-amber-100 text-amber-950 border-amber-300 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-700/60',
      categoryTheme: 'text-onedark-fg bg-onedark-darker border-onedark-borderSubtle',
    },
    create_pull_request: {
      label: 'Create GitHub Pull Request',
      actionKey: 'create_pull_request',
      desc: 'Opens draft or ready-for-review Pull Requests with automated summaries and test status via GitHub API.',
      category: 'Git Operations',
      icon: GitPullRequest,
      risk: 'Moderate',
      riskBadgeTheme: 'bg-blue-100 text-blue-950 border-blue-300 dark:bg-blue-950/40 dark:text-blue-200 dark:border-blue-700/60',
      categoryTheme: 'text-onedark-fg bg-onedark-darker border-onedark-borderSubtle',
    },
    post_comment: {
      label: 'Post Issue / PR Comments',
      actionKey: 'post_comment',
      desc: 'Posts real-time task progress notes, diagnosis summaries, and reproduction plans onto GitHub issues.',
      category: 'Communication',
      icon: MessageSquare,
      risk: 'Low Impact',
      riskBadgeTheme: 'bg-emerald-100 text-emerald-950 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-700/60',
      categoryTheme: 'text-onedark-fg bg-onedark-darker border-onedark-borderSubtle',
    },
    post_pull_request_review: {
      label: 'Submit Formal PR Reviews',
      actionKey: 'post_pull_request_review',
      desc: 'Governs formal pull request review submissions (Approve, Request Changes, Comment) on GitHub pull requests.',
      category: 'Code Review',
      icon: FileCheck,
      risk: 'Moderate',
      riskBadgeTheme: 'bg-blue-100 text-blue-950 border-blue-300 dark:bg-blue-950/40 dark:text-blue-200 dark:border-blue-700/60',
      categoryTheme: 'text-onedark-fg bg-onedark-darker border-onedark-borderSubtle',
    },
    post_pull_request_line_comment: {
      label: 'Post Inline PR Diff Comments',
      actionKey: 'post_pull_request_line_comment',
      desc: 'Posts inline code review annotations on specific files, chunks, and lines in an open pull request diff.',
      category: 'Code Review',
      icon: MessageSquare,
      risk: 'Low Impact',
      riskBadgeTheme: 'bg-emerald-100 text-emerald-950 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-700/60',
      categoryTheme: 'text-onedark-fg bg-onedark-darker border-onedark-borderSubtle',
    },
    slack_notify: {
      label: 'Post Slack Broadcasts',
      actionKey: 'slack_notify',
      desc: 'Dispatches task alerts, interactive approval requests, and completion notices to configured Slack channels.',
      category: 'Communication',
      icon: Radio,
      risk: 'Low Impact',
      riskBadgeTheme: 'bg-emerald-100 text-emerald-950 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-700/60',
      categoryTheme: 'text-onedark-fg bg-onedark-darker border-onedark-borderSubtle',
    },
    merge_pr: {
      label: 'Merge Pull Requests',
      actionKey: 'merge_pr',
      desc: 'Allows autonomous merging of pull requests into the default trunk branch following verified test suites.',
      category: 'Production Ops',
      icon: GitMerge,
      risk: 'Critical Impact',
      riskBadgeTheme: 'bg-rose-100 text-rose-950 border-rose-300 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-700/60',
      categoryTheme: 'text-onedark-fg bg-onedark-darker border-onedark-borderSubtle',
    },
    execute_shell: {
      label: 'Execute Local Shell Commands',
      actionKey: 'execute_shell',
      desc: 'Executes build tools, test runners (pytest, npm test), and git operations inside isolated container sandboxes.',
      category: 'Sandbox Execution',
      icon: Terminal,
      risk: 'Sandbox Isolated',
      riskBadgeTheme: 'bg-cyan-100 text-cyan-950 border-cyan-300 dark:bg-cyan-950/40 dark:text-cyan-200 dark:border-cyan-700/60',
      categoryTheme: 'text-onedark-fg bg-onedark-darker border-onedark-borderSubtle',
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
    return { 
      total, 
      auto, 
      approval, 
      disabled,
      autoPct: total > 0 ? (auto / total) * 100 : 0,
      approvalPct: total > 0 ? (approval / total) * 100 : 0,
      disabledPct: total > 0 ? (disabled / total) * 100 : 0,
    };
  }, [entries]);

  const categories = useMemo(() => {
    const catCounts: Record<string, number> = {};
    Object.values(actionDescriptions).forEach((a) => {
      catCounts[a.category] = (catCounts[a.category] || 0) + 1;
    });
    return [
      { id: 'all', label: 'All Policies', count: entries.length },
      ...Object.keys(catCounts).map((cat) => ({ id: cat, label: cat, count: catCounts[cat] }))
    ];
  }, [entries.length]);

  const filteredEntries = useMemo(() => {
    return entries.filter(([action, level]) => {
      const info = actionDescriptions[action] || {
        label: action,
        actionKey: action,
        desc: 'Action approval rule',
        category: 'General',
        risk: 'Low Impact' as const,
        riskBadgeTheme: '',
        categoryTheme: '',
      };

      if (categoryFilter !== 'all' && info.category !== categoryFilter) {
        return false;
      }

      if (statusFilter !== 'all' && level !== statusFilter) {
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
  }, [entries, categoryFilter, statusFilter, searchQuery]);

  return (
    <div className="h-full w-full overflow-y-auto bg-onedark-bg font-sans text-onedark-fg pb-24">
      {/* Sticky Header with Elevation & Frosted Glass */}
      <div className="sticky top-0 z-20 bg-onedark-bg/95 backdrop-blur-md border-b border-onedark-borderSubtle shadow-xs">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
            <div className="flex items-center space-x-3">
              {onBackToChat && (
                <button
                  onClick={onBackToChat}
                  className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-onedark-surface hover:bg-onedark-darker text-onedark-fgBright hover:text-onedark-accent text-xs font-mono font-semibold transition-all active:scale-95 shadow-xs cursor-pointer border border-onedark-borderSubtle"
                  title="Return to Workstation / Chat"
                >
                  <ArrowLeft className="w-3.5 h-3.5 text-onedark-accent" />
                  <span>Workstation</span>
                </button>
              )}

              <div className="w-8 h-8 rounded-lg bg-onedark-accent/15 text-onedark-accent border border-onedark-accent/30 flex items-center justify-center shrink-0 shadow-xs">
                <ShieldCheck className="w-4 h-4" />
              </div>

              <div>
                <div className="flex items-center space-x-2">
                  <h1 className="text-base sm:text-lg font-bold text-onedark-fgBright tracking-tight">
                    Action Approval Policies
                  </h1>
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-onedark-surface text-onedark-fgBright font-semibold border border-onedark-borderSubtle">
                    {entries.length} Policies
                  </span>
                  {hasUnsavedChanges && (
                    <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[11px] font-mono font-bold bg-amber-100 text-amber-950 border border-amber-300 dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-500/40 animate-pulse">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                      <span>{unsavedCount} Unsaved</span>
                    </span>
                  )}
                  {saveSuccess && (
                    <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[11px] font-mono font-bold bg-emerald-100 text-emerald-950 border border-emerald-300 dark:bg-emerald-500/20 dark:text-emerald-300 dark:border-emerald-500/40 animate-fadeIn">
                      <Check className="w-3 h-3 text-emerald-700 dark:text-emerald-300 stroke-[2.5]" />
                      <span>Saved</span>
                    </span>
                  )}
                </div>
                <p className="text-[11px] sm:text-xs text-onedark-muted mt-0.5 line-clamp-1 sm:line-clamp-none">
                  Granular permission guardrails governing autonomous agent tool dispatch vs. human approval gates.
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              {onNavigateToIntegrations && (
                <button
                  onClick={onNavigateToIntegrations}
                  className="inline-flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg bg-onedark-surface hover:bg-onedark-darker text-onedark-fgBright hover:text-onedark-accent text-xs font-mono font-medium transition-all cursor-pointer shadow-xs border border-onedark-borderSubtle"
                  title="Manage API keys, external developer integrations, and skills"
                >
                  <PlugZap className="w-3.5 h-3.5 text-onedark-accent" />
                  <span>Integrations & Skills Hub →</span>
                </button>
              )}

              {hasUnsavedChanges && (
                <button
                  onClick={handleDiscard}
                  disabled={isSaving}
                  className="inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-lg bg-onedark-surface hover:bg-onedark-darker text-onedark-muted hover:text-onedark-fgBright text-xs font-mono font-medium transition-all cursor-pointer shadow-xs border border-onedark-borderSubtle"
                  title="Discard pending changes"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Discard</span>
                </button>
              )}

              <button
                onClick={handleSave}
                disabled={isSaving || (!hasUnsavedChanges && !saveSuccess)}
                className={`inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all shadow-sm cursor-pointer ${
                  hasUnsavedChanges
                    ? 'bg-onedark-accent hover:bg-onedark-accent/90 text-onedark-darker active:scale-95 shadow-amber-500/20'
                    : 'bg-onedark-surface text-onedark-muted border border-onedark-borderSubtle opacity-60 cursor-not-allowed'
                }`}
              >
                {saveSuccess ? (
                  <>
                    <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                    <span>Saved!</span>
                  </>
                ) : (
                  <>
                    <Save className="w-3.5 h-3.5" />
                    <span>{isSaving ? 'Saving...' : hasUnsavedChanges ? `Save (${unsavedCount})` : 'Saved'}</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Compact Search Toolbar & High-Contrast Filter Tabs */}
          <div className="mt-2.5 flex flex-col md:flex-row md:items-center justify-between gap-2 pt-1">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-onedark-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter by policy name, key (e.g. git_push)..."
                className="w-full bg-onedark-surface border border-onedark-borderSubtle hover:border-onedark-border rounded-lg pl-8 pr-7 py-1.5 text-xs text-onedark-fgBright placeholder:text-onedark-muted font-sans focus:outline-none focus:border-onedark-accent transition-colors shadow-xs"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-onedark-muted hover:text-onedark-fgBright p-0.5 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            <div className="flex items-center space-x-1.5 overflow-x-auto pb-0.5 md:pb-0">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setCategoryFilter(cat.id)}
                  className={`px-2.5 py-1 rounded-md text-xs font-mono font-semibold transition-all whitespace-nowrap cursor-pointer border flex items-center space-x-1.5 ${
                    categoryFilter === cat.id
                      ? 'bg-onedark-accent text-onedark-darker border-onedark-accent shadow-xs font-bold'
                      : 'bg-onedark-surface text-onedark-muted hover:text-onedark-fgBright hover:bg-onedark-darker border-onedark-borderSubtle'
                  }`}
                >
                  <span>{cat.label}</span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                    categoryFilter === cat.id
                      ? 'bg-onedark-darker/25 text-onedark-darker font-bold'
                      : 'bg-onedark-darker text-onedark-muted'
                  }`}>
                    {cat.count}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Container with Centered Layout */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 space-y-3.5">
        {/* Governance & Policy Distribution Summary Card */}
        <div className="rounded-xl bg-onedark-surface border border-onedark-borderSubtle shadow-xs overflow-hidden transition-all">
          <div 
            onClick={() => setIsBannerCollapsed(!isBannerCollapsed)}
            className="flex items-center justify-between px-3.5 py-2.5 sm:px-4 sm:py-3 cursor-pointer hover:bg-onedark-darker/40 transition-colors"
          >
            <div className="flex items-center space-x-2.5">
              <div className="p-1.5 rounded-lg bg-onedark-accent/15 border border-onedark-accent/30 text-onedark-accent">
                <SlidersHorizontal className="w-3.5 h-3.5" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <span className="text-xs sm:text-sm font-bold text-onedark-fgBright">Security Posture & Enforcement Distribution</span>
                  <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-950 border border-emerald-300 dark:bg-emerald-500/20 dark:text-emerald-300 dark:border-emerald-500/40">
                    Enforced at Tool Execution
                  </span>
                </div>
                <p className="text-[11px] text-onedark-muted mt-0.5">
                  Click any tier below to filter policy actions by enforcement level.
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-1.5 text-xs text-onedark-muted">
              <span className="text-[11px] font-mono hidden sm:inline">{isBannerCollapsed ? 'Expand Details' : 'Collapse Details'}</span>
              {isBannerCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
            </div>
          </div>

          {!isBannerCollapsed && (
            <div className="px-3.5 pb-3.5 sm:px-4 sm:pb-3.5 pt-1 space-y-3 border-t border-onedark-borderSubtle">
              {/* Visual Segmented Progress Ratio Bar */}
              <div className="space-y-1 pt-1.5">
                <div className="h-2 w-full bg-onedark-darker rounded-full overflow-hidden flex border border-onedark-borderSubtle shadow-inner">
                  <div 
                    style={{ width: `${counts.autoPct}%` }}
                    className="h-full bg-emerald-600 transition-all duration-300"
                    title={`Auto-Allow: ${counts.auto} actions (${Math.round(counts.autoPct)}%)`}
                  />
                  <div 
                    style={{ width: `${counts.approvalPct}%` }}
                    className="h-full bg-amber-500 transition-all duration-300"
                    title={`Require Approval: ${counts.approval} actions (${Math.round(counts.approvalPct)}%)`}
                  />
                  <div 
                    style={{ width: `${counts.disabledPct}%` }}
                    className="h-full bg-rose-600 transition-all duration-300"
                    title={`Disabled: ${counts.disabled} actions (${Math.round(counts.disabledPct)}%)`}
                  />
                </div>
              </div>

              {/* Interactive High-Contrast Metric Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <button
                  type="button"
                  onClick={() => setStatusFilter(statusFilter === 'auto' ? 'all' : 'auto')}
                  className={`p-3 rounded-xl text-left transition-all border cursor-pointer ${
                    statusFilter === 'auto'
                      ? 'bg-emerald-500/10 border-emerald-500 ring-2 ring-emerald-500/30 text-onedark-fgBright shadow-xs'
                      : 'bg-onedark-bg hover:bg-onedark-darker/60 border-onedark-borderSubtle hover:border-emerald-500/40'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 flex items-center space-x-1.5">
                      <Unlock className="w-3.5 h-3.5" />
                      <span>Auto-Allow</span>
                    </span>
                    {statusFilter === 'auto' ? (
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-600 text-white font-bold">
                        Filter Active
                      </span>
                    ) : (
                      <span className="text-[11px] font-mono text-onedark-muted font-bold tabular-nums">
                        {Math.round(counts.autoPct)}%
                      </span>
                    )}
                  </div>
                  <div className="flex items-baseline space-x-2 mt-1">
                    <span className="text-lg sm:text-xl font-extrabold text-onedark-fgBright font-mono tabular-nums">
                      {counts.auto}
                    </span>
                    <span className="text-xs text-onedark-muted font-medium">
                      actions ({Math.round(counts.autoPct)}%)
                    </span>
                  </div>
                  <p className="text-[11px] text-onedark-muted mt-0.5 truncate">
                    Executes autonomously without prompting
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setStatusFilter(statusFilter === 'require_approval' ? 'all' : 'require_approval')}
                  className={`p-3 rounded-xl text-left transition-all border cursor-pointer ${
                    statusFilter === 'require_approval'
                      ? 'bg-amber-500/10 border-amber-500 ring-2 ring-amber-500/30 text-onedark-fgBright shadow-xs'
                      : 'bg-onedark-bg hover:bg-onedark-darker/60 border-onedark-borderSubtle hover:border-amber-500/40'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300 flex items-center space-x-1.5">
                      <Lock className="w-3.5 h-3.5" />
                      <span>Human Approval</span>
                    </span>
                    {statusFilter === 'require_approval' ? (
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-amber-500 text-amber-950 font-bold">
                        Filter Active
                      </span>
                    ) : (
                      <span className="text-[11px] font-mono text-onedark-muted font-bold tabular-nums">
                        {Math.round(counts.approvalPct)}%
                      </span>
                    )}
                  </div>
                  <div className="flex items-baseline space-x-2 mt-1">
                    <span className="text-lg sm:text-xl font-extrabold text-onedark-fgBright font-mono tabular-nums">
                      {counts.approval}
                    </span>
                    <span className="text-xs text-onedark-muted font-medium">
                      actions ({Math.round(counts.approvalPct)}%)
                    </span>
                  </div>
                  <p className="text-[11px] text-onedark-muted mt-0.5 truncate">
                    Pauses agent execution for human review
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setStatusFilter(statusFilter === 'disabled' ? 'all' : 'disabled')}
                  className={`p-3 rounded-xl text-left transition-all border cursor-pointer ${
                    statusFilter === 'disabled'
                      ? 'bg-rose-500/10 border-rose-500 ring-2 ring-rose-500/30 text-onedark-fgBright shadow-xs'
                      : 'bg-onedark-bg hover:bg-onedark-darker/60 border-onedark-borderSubtle hover:border-rose-500/40'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-bold uppercase tracking-wider text-rose-700 dark:text-rose-400 flex items-center space-x-1.5">
                      <Ban className="w-3.5 h-3.5" />
                      <span>Forbidden (Disabled)</span>
                    </span>
                    {statusFilter === 'disabled' ? (
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-rose-600 text-white font-bold">
                        Filter Active
                      </span>
                    ) : (
                      <span className="text-[11px] font-mono text-onedark-muted font-bold tabular-nums">
                        {Math.round(counts.disabledPct)}%
                      </span>
                    )}
                  </div>
                  <div className="flex items-baseline space-x-2 mt-1">
                    <span className="text-lg sm:text-xl font-extrabold text-onedark-fgBright font-mono tabular-nums">
                      {counts.disabled}
                    </span>
                    <span className="text-xs text-onedark-muted font-medium">
                      actions ({Math.round(counts.disabledPct)}%)
                    </span>
                  </div>
                  <p className="text-[11px] text-onedark-muted mt-0.5 truncate">
                    Strictly blocked from model invocation
                  </p>
                </button>
              </div>

              {/* Quick Policy Presets Toolbar */}
              <div className="pt-2.5 border-t border-onedark-borderSubtle flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                <div className="flex items-center space-x-1.5 text-onedark-muted font-mono">
                  <Sparkles className="w-3.5 h-3.5 text-onedark-accent" />
                  <span className="font-semibold text-onedark-fgBright">Security Presets:</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => applyPreset('recommended')}
                    className="px-2.5 py-1 rounded-md bg-onedark-surface hover:bg-onedark-darker text-onedark-fgBright hover:text-onedark-accent border border-onedark-borderSubtle text-xs font-mono font-medium transition-all cursor-pointer shadow-xs"
                    title="Safe defaults: Auto-allow shell & comments, require approval for remote pushes, PR reviews, and merges"
                  >
                    Recommended Default
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset('strict')}
                    className="px-2.5 py-1 rounded-md bg-onedark-surface hover:bg-onedark-darker text-onedark-fgBright hover:text-amber-500 border border-onedark-borderSubtle text-xs font-mono font-medium transition-all cursor-pointer shadow-xs"
                    title="Strict zero-trust mode: all 8 actions require explicit human approval"
                  >
                    Strict Zero-Trust
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset('autonomous')}
                    className="px-2.5 py-1 rounded-md bg-onedark-surface hover:bg-onedark-darker text-onedark-fgBright hover:text-emerald-500 border border-onedark-borderSubtle text-xs font-mono font-medium transition-all cursor-pointer shadow-xs"
                    title="Autonomous development: Auto-allows all actions except production branch merges"
                  >
                    Autonomous Dev
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Policy Definitions Section */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between text-xs text-onedark-muted font-mono">
            <div className="flex items-center space-x-2">
              <span className="font-bold uppercase tracking-wider text-onedark-fgBright">
                Policy Definitions ({filteredEntries.length} of {entries.length})
              </span>
              {statusFilter !== 'all' && (
                <span className="px-2 py-0.5 rounded-full bg-onedark-accent/15 text-onedark-accent border border-onedark-accent/30 font-semibold">
                  Status: {statusFilter.replace('_', ' ')}
                </span>
              )}
            </div>
            {(searchQuery || categoryFilter !== 'all' || statusFilter !== 'all') && (
              <button
                onClick={() => { setSearchQuery(''); setCategoryFilter('all'); setStatusFilter('all'); }}
                className="text-onedark-accent hover:underline cursor-pointer font-medium"
              >
                Clear all filters
              </button>
            )}
          </div>

          {/* Compact Policy Cards Grid */}
          <div className="space-y-2">
            {filteredEntries.map(([action, level]) => {
              const info = actionDescriptions[action] || {
                label: action,
                actionKey: action,
                desc: 'Action approval rule governing agent permission',
                category: 'General',
                icon: ShieldCheck,
                risk: 'Moderate' as const,
                riskBadgeTheme: 'bg-zinc-100 text-zinc-900 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700',
                categoryTheme: 'text-onedark-fg bg-onedark-darker border-onedark-borderSubtle',
              };
              const ActionIcon = info.icon || ShieldCheck;

              return (
                <div
                  key={action}
                  className="px-3.5 py-2.5 sm:px-4 sm:py-3 rounded-xl bg-onedark-surface border border-onedark-borderSubtle hover:border-onedark-border flex flex-col md:flex-row md:items-center justify-between gap-2.5 transition-all shadow-xs"
                >
                  {/* Left: Icon, Details, Tags */}
                  <div className="flex items-center space-x-3 min-w-0 flex-1">
                    <div className="w-8 h-8 rounded-lg bg-onedark-darker text-onedark-accent flex items-center justify-center shrink-0 border border-onedark-borderSubtle">
                      <ActionIcon className="w-4 h-4" />
                    </div>

                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                        <h3 className="text-xs sm:text-sm font-bold text-onedark-fgBright">
                          {info.label}
                        </h3>
                        <code className="px-1.5 py-0.5 rounded font-mono text-[10.5px] bg-onedark-darker text-onedark-muted border border-onedark-borderSubtle font-medium">
                          {info.actionKey}
                        </code>
                        <span className={`px-2 py-0.5 rounded-full text-[10.5px] font-mono border font-medium ${info.categoryTheme}`}>
                          {info.category}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono border font-bold ${info.riskBadgeTheme}`}>
                          {info.risk}
                        </span>
                      </div>

                      <p className="text-xs text-onedark-muted leading-relaxed line-clamp-1 sm:line-clamp-none">
                        {info.desc}
                      </p>
                    </div>
                  </div>

                  {/* Right: High-Contrast Segmented Switcher */}
                  <div className="p-0.5 bg-onedark-darker rounded-lg border border-onedark-borderSubtle grid grid-cols-3 gap-0.5 w-full md:w-[270px] shrink-0">
                    {/* Auto-Allow Option */}
                    <button
                      type="button"
                      onClick={() => handleChange(action, 'auto')}
                      title="Auto-Allow: Executes autonomously without prompting for human confirmation"
                      className={`py-1 px-1.5 rounded-md flex items-center justify-center space-x-1.5 cursor-pointer transition-all text-xs select-none ${
                        level === 'auto'
                          ? 'bg-emerald-600 text-white font-bold shadow-xs border border-emerald-500'
                          : 'text-onedark-muted hover:text-onedark-fgBright hover:bg-onedark-surface/40 border border-transparent'
                      }`}
                    >
                      <Unlock className="w-3.5 h-3.5 shrink-0" />
                      <span className="font-mono text-[11px] sm:text-xs">Auto-Allow</span>
                    </button>

                    {/* Require Approval Option */}
                    <button
                      type="button"
                      onClick={() => handleChange(action, 'require_approval')}
                      title="Approval: Pauses agent execution and prompts in chat or Slack"
                      className={`py-1 px-1.5 rounded-md flex items-center justify-center space-x-1.5 cursor-pointer transition-all text-xs select-none ${
                        level === 'require_approval'
                          ? 'bg-amber-500 text-amber-950 font-bold shadow-xs border border-amber-400'
                          : 'text-onedark-muted hover:text-onedark-fgBright hover:bg-onedark-surface/40 border border-transparent'
                      }`}
                    >
                      <Lock className="w-3.5 h-3.5 shrink-0" />
                      <span className="font-mono text-[11px] sm:text-xs">Approval</span>
                    </button>

                    {/* Disabled Option */}
                    <button
                      type="button"
                      onClick={() => handleChange(action, 'disabled')}
                      title="Disabled: Strictly blocked from model invocation"
                      className={`py-1 px-1.5 rounded-md flex items-center justify-center space-x-1.5 cursor-pointer transition-all text-xs select-none ${
                        level === 'disabled'
                          ? 'bg-rose-600 text-white font-bold shadow-xs border border-rose-500'
                          : 'text-onedark-muted hover:text-onedark-fgBright hover:bg-onedark-surface/40 border border-transparent'
                      }`}
                    >
                      <Ban className="w-3.5 h-3.5 shrink-0" />
                      <span className="font-mono text-[11px] sm:text-xs">Disabled</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Empty Search Feedback */}
          {filteredEntries.length === 0 && (
            <div className="p-12 text-center border border-dashed border-onedark-border rounded-2xl bg-onedark-surface dark:bg-onedark-darker space-y-3.5">
              <ShieldCheck className="w-10 h-10 text-onedark-muted mx-auto opacity-50" />
              <h3 className="text-sm font-bold text-onedark-fgBright">No matching policies found</h3>
              <p className="text-xs text-onedark-muted max-w-md mx-auto">
                No action approval policy matches your current search or category filter.
              </p>
              <div>
                <button
                  onClick={() => { setSearchQuery(''); setCategoryFilter('all'); setStatusFilter('all'); }}
                  className="px-4 py-2 rounded-lg bg-onedark-accent text-onedark-darker text-xs font-mono font-bold transition-all cursor-pointer shadow-xs"
                >
                  Reset All Filters
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Floating Bottom Toast for Unsaved Changes */}
      {hasUnsavedChanges && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 animate-slideUp">
          <div className="flex items-center space-x-4 px-5 py-3 rounded-2xl bg-onedark-fgBright text-onedark-bg shadow-2xl border border-onedark-borderSubtle">
            <div className="flex items-center space-x-2">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
              <span className="text-xs font-mono font-bold">
                {unsavedCount} policy {unsavedCount === 1 ? 'action has' : 'actions have'} unsaved modifications
              </span>
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={handleDiscard}
                disabled={isSaving}
                className="px-3 py-1.5 rounded-lg text-xs font-mono font-semibold hover:bg-onedark-darker/20 transition-colors cursor-pointer"
              >
                Discard
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="px-4 py-1.5 rounded-lg bg-onedark-accent text-onedark-darker text-xs font-mono font-bold hover:bg-onedark-accent/90 transition-all cursor-pointer shadow-xs active:scale-95 flex items-center space-x-1.5"
              >
                {isSaving ? (
                  <span>Saving...</span>
                ) : (
                  <>
                    <Save className="w-3.5 h-3.5" />
                    <span>Save & Apply</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
