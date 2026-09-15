import React, { useState, useEffect, useMemo } from 'react';
import { 
  PlugZap, 
  CheckCircle2, 
  Key, 
  Settings, 
  X, 
  ShieldCheck, 
  RefreshCw, 
  AlertCircle, 
  Sparkles, 
  Webhook, 
  Copy, 
  Check, 
  ArrowLeft, 
  Search, 
  ChevronDown, 
  ChevronUp, 
  FolderGit2,
  MessageSquare,
  Activity,
  AlertTriangle,
  Lock
} from 'lucide-react';
import { Integration, SkillCatalogItem, WebhookEndpoint } from '../../types';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface IntegrationsViewProps {
  integrations: Integration[];
  activeSkills: string[];
  skillsCatalog?: SkillCatalogItem[];
  webhookEndpoints?: WebhookEndpoint[];
  onRefreshIntegrations?: () => void;
  onBackToChat?: () => void;
  onNavigateToPolicies?: () => void;
}

export const IntegrationsView: React.FC<IntegrationsViewProps> = ({
  integrations,
  activeSkills,
  skillsCatalog = [],
  webhookEndpoints = [],
  onRefreshIntegrations,
  onBackToChat,
  onNavigateToPolicies,
}) => {
  const [selectedIntegration, setSelectedIntegration] = useState<Integration | null>(null);
  const [tokenInput, setTokenInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ success?: boolean; message?: string } | null>(null);
  const [copiedEndpointId, setCopiedEndpointId] = useState<string | null>(null);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'providers' | 'skills' | 'gateways'>('all');
  const [isBannerCollapsed, setIsBannerCollapsed] = useState(false);

  // Close modal on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedIntegration) {
        setSelectedIntegration(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIntegration]);

  const handleOpenConfig = (item: Integration) => {
    setSelectedIntegration(item);
    setTokenInput('');
    setFeedback(null);
  };

  const handleCopyWebhookUrl = (endpoint: WebhookEndpoint) => {
    const origin = window.location.origin;
    const fullUrl = `${origin}${endpoint.path}`;
    navigator.clipboard.writeText(fullUrl);
    setCopiedEndpointId(endpoint.id);
    setTimeout(() => setCopiedEndpointId(null), 2000);
  };

  const handleSaveCredential = async () => {
    if (!selectedIntegration || !tokenInput.trim()) return;

    setSubmitting(true);
    setFeedback(null);

    const payload: Record<string, any> = {};
    if (selectedIntegration.id === 'github') {
      payload.token = tokenInput.trim();
    } else if (selectedIntegration.id === 'slack') {
      payload.token = tokenInput.trim();
    } else if (selectedIntegration.id === 'appsignal') {
      payload.api_key = tokenInput.trim();
    } else if (selectedIntegration.id === 'gemini') {
      payload.api_key = tokenInput.trim();
    } else if (selectedIntegration.id === 'sentry') {
      payload.token = tokenInput.trim();
    } else {
      payload.token = tokenInput.trim();
    }

    try {
      const res = await fetch(`${API_BASE}/api/integrations/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: selectedIntegration.id,
          credentials: payload,
        }),
      });

      const data = await res.json();
      if (data.status === 'configured' || data.validation?.valid) {
        setFeedback({
          success: true,
          message: data.validation?.message || 'Credentials validated and encrypted in Vault successfully.',
        });
        if (onRefreshIntegrations) {
          onRefreshIntegrations();
        }
      } else {
        setFeedback({
          success: false,
          message: data.validation?.message || 'Failed to validate credentials with provider.',
        });
      }
    } catch (err: any) {
      setFeedback({
        success: false,
        message: err.message || 'Error communicating with server.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  // Filtered skills
  const allSkills = useMemo(() => {
    return skillsCatalog.length > 0
      ? skillsCatalog
      : activeSkills.map((s) => ({
          id: s,
          name: s.toUpperCase(),
          path: `.agents/skills/${s}/SKILL.md`,
          description: `Agent routine for ${s}`,
          tools: [`${s}.execute`],
          status: 'ACTIVE' as const,
          category: 'Core',
        }));
  }, [skillsCatalog, activeSkills]);

  const filteredSkills = useMemo(() => {
    if (activeTab === 'gateways' || activeTab === 'providers') return [];
    return allSkills.filter((s) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.path.toLowerCase().includes(q) ||
        s.tools.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [allSkills, searchQuery, activeTab]);

  // Filtered gateways
  const filteredGateways = useMemo(() => {
    if (activeTab === 'skills' || activeTab === 'providers') return [];
    return webhookEndpoints.filter((ep) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        ep.name.toLowerCase().includes(q) ||
        ep.description.toLowerCase().includes(q) ||
        ep.path.toLowerCase().includes(q) ||
        ep.events.some((ev) => ev.toLowerCase().includes(q))
      );
    });
  }, [webhookEndpoints, searchQuery, activeTab]);

  // Filtered providers
  const filteredIntegrations = useMemo(() => {
    if (activeTab === 'skills' || activeTab === 'gateways') return [];
    return integrations.filter((item) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        item.name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.id.toLowerCase().includes(q) ||
        item.skills.some((s) => s.toLowerCase().includes(q))
      );
    });
  }, [integrations, searchQuery, activeTab]);

  const getProviderIcon = (id: string) => {
    switch (id) {
      case 'gemini':
        return <Sparkles className="w-5 h-5 text-cyan-400" />;
      case 'github':
        return <FolderGit2 className="w-5 h-5 text-purple-400" />;
      case 'slack':
        return <MessageSquare className="w-5 h-5 text-emerald-400" />;
      case 'appsignal':
        return <Activity className="w-5 h-5 text-amber-400" />;
      case 'sentry':
        return <AlertTriangle className="w-5 h-5 text-rose-400" />;
      default:
        return <PlugZap className="w-5 h-5 text-onedark-accent" />;
    }
  };

  const getProviderBadgeTheme = (id: string) => {
    switch (id) {
      case 'gemini':
        return 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400';
      case 'github':
        return 'bg-purple-500/10 border-purple-500/30 text-purple-400';
      case 'slack':
        return 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400';
      case 'appsignal':
        return 'bg-amber-500/10 border-amber-500/30 text-amber-400';
      case 'sentry':
        return 'bg-rose-500/10 border-rose-500/30 text-rose-400';
      default:
        return 'bg-onedark-accent/10 border-onedark-accent/30 text-onedark-accent';
    }
  };

  return (
    <div className="h-full w-full overflow-y-auto bg-onedark-bg font-sans text-onedark-fg">
      {/* Sticky Header with Centered Max-Width */}
      <div className="sticky top-0 z-20 bg-onedark-bg/95 backdrop-blur-md border-b border-onedark-borderSubtle">
        <div className="max-w-6xl mx-auto px-6 lg:px-8 py-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center space-x-3.5">
              {onBackToChat && (
                <button
                  onClick={onBackToChat}
                  className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-onedark-darker hover:bg-onedark-surface text-onedark-fgBright hover:text-onedark-accent text-xs font-mono font-semibold border border-onedark-border transition-all shadow-sm active:scale-95 cursor-pointer"
                  title="Return to active chat workstation"
                >
                  <ArrowLeft className="w-4 h-4 text-onedark-accent" />
                  <span>Workstation</span>
                </button>
              )}
              <div className="flex items-center space-x-2.5">
                <div className="p-2 rounded-xl bg-onedark-darker border border-onedark-border text-onedark-accent shadow-xs">
                  <PlugZap className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <h1 className="text-lg font-bold text-onedark-fgBright tracking-tight">
                      Integrations & Skills Hub
                    </h1>
                    <span className="px-2 py-0.5 rounded-full bg-onedark-accent/15 text-onedark-accent font-mono text-[11px] font-bold border border-onedark-accent/30">
                      AES-256 Vault
                    </span>
                  </div>
                  <p className="text-xs text-onedark-fg/75 mt-0.5">
                    Manage API keys, external developer providers, and background AI skills.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              {onNavigateToPolicies && (
                <button
                  onClick={onNavigateToPolicies}
                  className="px-3 py-1.5 rounded-lg bg-onedark-darker hover:bg-onedark-surface text-onedark-fgBright hover:text-onedark-accent text-xs font-mono font-medium flex items-center space-x-1.5 border border-onedark-border transition-colors cursor-pointer shadow-xs"
                  title="Manage action approval policies and execution permissions"
                >
                  <ShieldCheck className="w-4 h-4 text-onedark-accent" />
                  <span>Approval Policies →</span>
                </button>
              )}

              {onRefreshIntegrations && (
                <button
                  onClick={onRefreshIntegrations}
                  className="px-3 py-1.5 rounded-lg bg-onedark-darker hover:bg-onedark-surface text-onedark-fgBright text-xs font-mono font-medium flex items-center space-x-1.5 border border-onedark-border transition-colors cursor-pointer shadow-xs"
                  title="Refresh Integrations Status"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-onedark-muted" />
                  <span>Sync Status</span>
                </button>
              )}
              <button
                onClick={() => setIsBannerCollapsed(!isBannerCollapsed)}
                className="px-2.5 py-1.5 rounded-lg bg-onedark-darker hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fgBright text-xs font-mono flex items-center space-x-1.5 border border-onedark-borderSubtle transition-colors cursor-pointer"
              >
                <span>{isBannerCollapsed ? 'Show Stats' : 'Hide Stats'}</span>
                {isBannerCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          {/* Collapsible Overview Stat Cards */}
          {!isBannerCollapsed && (
            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3.5 animate-fadeIn">
              <div className="p-4 rounded-xl bg-onedark-darker/90 border border-onedark-border flex items-center space-x-3.5 shadow-sm">
                <div className="p-2.5 rounded-xl bg-onedark-surface text-cyan-400 border border-onedark-borderSubtle">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-bold text-onedark-muted uppercase tracking-wider font-mono">External Providers</div>
                  <div className="text-base font-bold text-onedark-fgBright mt-0.5">{integrations.length} Active Services</div>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-onedark-darker/90 border border-onedark-border flex items-center space-x-3.5 shadow-sm">
                <div className="p-2.5 rounded-xl bg-onedark-surface text-onedark-accent border border-onedark-borderSubtle">
                  <PlugZap className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-bold text-onedark-muted uppercase tracking-wider font-mono">Mounted Skills</div>
                  <div className="text-base font-bold text-onedark-fgBright mt-0.5">{allSkills.length} Agent Capabilities</div>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-onedark-darker/90 border border-onedark-border flex items-center space-x-3.5 shadow-sm">
                <div className="p-2.5 rounded-xl bg-onedark-surface text-onedark-green border border-onedark-borderSubtle">
                  <Webhook className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-bold text-onedark-muted uppercase tracking-wider font-mono">Inbound Gateways</div>
                  <div className="text-base font-bold text-onedark-fgBright mt-0.5">{webhookEndpoints.length || 3} Endpoints Active</div>
                </div>
              </div>
            </div>
          )}

          {/* Sticky Search & Tab Selector Toolbar */}
          <div className="mt-5 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-3.5 border-t border-onedark-borderSubtle">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-onedark-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search providers (Gemini, GitHub), skills, or tokens..."
                className="w-full bg-onedark-darker border border-onedark-border rounded-lg pl-9 pr-8 py-2 text-xs text-onedark-fgBright placeholder:text-onedark-muted focus:outline-none focus:border-onedark-accent transition-colors font-sans shadow-xs"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-onedark-muted hover:text-onedark-fgBright cursor-pointer p-1"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center space-x-2 overflow-x-auto pb-1 sm:pb-0">
              {[
                { id: 'all', label: 'All Resources' },
                { id: 'providers', label: `Providers & Keys (${integrations.length})` },
                { id: 'skills', label: `Mounted Skills (${allSkills.length})` },
                { id: 'gateways', label: `Webhook Gateways (${webhookEndpoints.length})` },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono font-semibold transition-all cursor-pointer whitespace-nowrap ${
                    activeTab === tab.id
                      ? 'bg-onedark-accent text-onedark-darker shadow-sm'
                      : 'bg-onedark-darker text-onedark-muted hover:text-onedark-fgBright hover:bg-onedark-surface border border-onedark-borderSubtle'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Sections - Centered with max-w-6xl */}
      <div className="max-w-6xl mx-auto px-6 lg:px-8 py-8 space-y-8">
        {/* 1. External Provider Connections (API Keys & Vault) */}
        {(activeTab === 'all' || activeTab === 'providers') && filteredIntegrations.length > 0 && (
          <div className="space-y-3.5">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold text-onedark-muted uppercase tracking-wider flex items-center space-x-2 font-mono">
                <PlugZap className="w-4 h-4 text-onedark-accent" />
                <span>External Provider Connections & API Keys ({filteredIntegrations.length})</span>
              </h2>
              <span className="text-xs text-onedark-muted font-mono flex items-center space-x-1">
                <Lock className="w-3 h-3 text-onedark-accent" />
                <span>Encrypted at rest with AES-256 Vault</span>
              </span>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {filteredIntegrations.map((item) => (
                <div
                  key={item.id}
                  className="p-5 rounded-xl bg-onedark-darker/90 hover:bg-onedark-surface/30 border border-onedark-border hover:border-onedark-borderSubtle/80 space-y-4 shadow-sm transition-all flex flex-col justify-between"
                >
                  <div className="space-y-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center space-x-3">
                        <div className={`p-2.5 rounded-xl border ${getProviderBadgeTheme(item.id)}`}>
                          {getProviderIcon(item.id)}
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-onedark-fgBright">{item.name}</h3>
                          <div className="text-xs text-onedark-muted font-mono mt-0.5">Auth: {item.auth_type}</div>
                        </div>
                      </div>

                      {item.configured ? (
                        <span className="px-3 py-1 rounded-full text-xs font-mono bg-onedark-green/15 text-onedark-green border border-onedark-green/30 flex items-center space-x-1.5 font-bold shrink-0">
                          <CheckCircle2 className="w-3.5 h-3.5 text-onedark-green" />
                          <span>Configured</span>
                        </span>
                      ) : (
                        <span className="px-3 py-1 rounded-full text-xs font-mono bg-onedark-yellow/15 text-onedark-yellow border border-onedark-yellow/30 flex items-center space-x-1.5 font-bold shrink-0">
                          <Key className="w-3.5 h-3.5 text-onedark-yellow" />
                          <span>Key Not Set</span>
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-onedark-fg/90 leading-relaxed font-normal">
                      {item.description}
                    </p>
                  </div>

                  <div className="pt-3 border-t border-onedark-borderSubtle flex items-center justify-between gap-3">
                    <div className="flex flex-wrap gap-1.5">
                      {item.skills.map((s) => (
                        <span
                          key={s}
                          className="px-2 py-0.5 rounded bg-onedark-surface text-onedark-fgBright/80 border border-onedark-borderSubtle text-[11px] font-mono"
                        >
                          {s}
                        </span>
                      ))}
                    </div>

                    <button
                      onClick={() => handleOpenConfig(item)}
                      className="px-3.5 py-1.5 rounded-lg bg-onedark-surface hover:bg-onedark-border text-onedark-fgBright text-xs font-mono font-semibold flex items-center space-x-1.5 transition-colors border border-onedark-border cursor-pointer shrink-0 shadow-xs active:scale-95"
                    >
                      <Settings className="w-3.5 h-3.5 text-onedark-accent" />
                      <span>{item.configured ? 'Update Key' : 'Configure Key'}</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 2. Mounted Antigravity Skills Catalog */}
        {(activeTab === 'all' || activeTab === 'skills') && filteredSkills.length > 0 && (
          <div className="space-y-3.5">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold text-onedark-muted uppercase tracking-wider flex items-center space-x-2 font-mono">
                <Sparkles className="w-4 h-4 text-onedark-accent" />
                <span>Mounted Antigravity Skills ({filteredSkills.length})</span>
              </h2>
              <span className="text-xs text-onedark-muted font-mono">Progressive tool disclosure via Markdown schemas</span>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {filteredSkills.map((skill) => {
                const isActive = skill.status === 'ACTIVE';
                return (
                  <div
                    key={skill.id}
                    className="p-5 rounded-xl bg-onedark-darker/90 hover:bg-onedark-surface/30 border border-onedark-border hover:border-onedark-borderSubtle/80 transition-all flex flex-col justify-between space-y-3 shadow-sm"
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-bold text-onedark-fgBright">{skill.name}</h3>
                          <div className="text-xs text-onedark-accent font-mono mt-0.5">{skill.path}</div>
                        </div>
                        <span
                          className={`inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold border shrink-0 ${
                            isActive
                              ? 'bg-onedark-green/15 text-onedark-green border-onedark-green/30'
                              : 'bg-onedark-yellow/15 text-onedark-yellow border-onedark-yellow/30'
                          }`}
                        >
                          {isActive ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Key className="w-3.5 h-3.5" />}
                          <span>{isActive ? 'Mounted & Ready' : 'Auth Required'}</span>
                        </span>
                      </div>

                      <p className="text-xs text-onedark-fg/90 leading-relaxed">
                        {skill.description}
                      </p>
                    </div>

                    <div className="pt-3 border-t border-onedark-borderSubtle flex flex-wrap gap-1.5">
                      {skill.tools.map((t) => (
                        <span
                          key={t}
                          className="px-2 py-0.5 rounded bg-onedark-surface text-onedark-fgBright/80 text-[11px] font-mono border border-onedark-borderSubtle"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 3. Inbound Webhook Gateway Endpoints */}
        {(activeTab === 'all' || activeTab === 'gateways') && filteredGateways.length > 0 && (
          <div className="space-y-3.5">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold text-onedark-muted uppercase tracking-wider flex items-center space-x-2 font-mono">
                <Webhook className="w-4 h-4 text-onedark-green" />
                <span>Inbound Webhook Gateways ({filteredGateways.length})</span>
              </h2>
              <span className="text-xs text-onedark-muted font-mono">Real-time HTTP ingress endpoints</span>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {filteredGateways.map((ep) => {
                const isCopied = copiedEndpointId === ep.id;
                return (
                  <div
                    key={ep.id}
                    className="p-5 rounded-xl bg-onedark-darker/90 hover:bg-onedark-surface/30 border border-onedark-border hover:border-onedark-borderSubtle/80 space-y-3.5 flex flex-col justify-between shadow-sm transition-all"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-bold text-onedark-fgBright">{ep.name}</h4>
                        <span className="px-2 py-0.5 rounded text-xs font-mono bg-onedark-accent/15 text-onedark-accent font-bold border border-onedark-accent/30">
                          {ep.method}
                        </span>
                      </div>
                      <p className="text-xs text-onedark-fg/90 leading-relaxed">{ep.description}</p>
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {ep.events.map((ev) => (
                          <span key={ev} className="text-[11px] font-mono text-onedark-fgBright/80 bg-onedark-surface px-2 py-0.5 rounded border border-onedark-borderSubtle">
                            {ev}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="pt-3 border-t border-onedark-borderSubtle flex items-center justify-between gap-3">
                      <div className="text-xs font-mono text-onedark-muted truncate max-w-[280px]" title={ep.path}>
                        {ep.path}
                      </div>
                      <button
                        onClick={() => handleCopyWebhookUrl(ep)}
                        className="px-3 py-1.5 rounded-lg bg-onedark-surface hover:bg-onedark-border text-onedark-fgBright text-xs font-mono font-semibold flex items-center space-x-1.5 transition-colors border border-onedark-border cursor-pointer shrink-0 shadow-xs"
                        title="Copy Full Webhook URL"
                      >
                        {isCopied ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-onedark-green" />
                            <span className="text-xs text-onedark-green font-bold">Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5 text-onedark-muted" />
                            <span className="text-xs">Copy URL</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Empty Search Feedback */}
        {filteredSkills.length === 0 && filteredGateways.length === 0 && filteredIntegrations.length === 0 && (
          <div className="p-12 text-center border border-dashed border-onedark-border rounded-2xl bg-onedark-darker/90 space-y-3.5">
            <PlugZap className="w-10 h-10 text-onedark-muted mx-auto opacity-50" />
            <h3 className="text-sm font-bold text-onedark-fgBright">No matching resources found</h3>
            <p className="text-xs text-onedark-muted max-w-sm mx-auto">
              No provider, skill, or gateway matched &ldquo;{searchQuery}&rdquo;. Try clearing your search.
            </p>
            <button
              onClick={() => { setSearchQuery(''); setActiveTab('all'); }}
              className="px-3.5 py-1.5 rounded-lg bg-onedark-surface hover:bg-onedark-border text-onedark-accent text-xs font-mono font-bold transition-colors cursor-pointer border border-onedark-border"
            >
              Reset Filters
            </button>
          </div>
        )}
      </div>

      {/* Configuration Modal with High Contrast & Clear Instruction */}
      {selectedIntegration && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-fadeIn"
          onClick={() => setSelectedIntegration(null)}
        >
          <div 
            className="w-full max-w-lg bg-onedark-darker border border-onedark-border rounded-xl shadow-2xl overflow-hidden animate-slideUp"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 bg-onedark-surface/40 border-b border-onedark-border flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className={`p-2 rounded-lg border ${getProviderBadgeTheme(selectedIntegration.id)}`}>
                  {getProviderIcon(selectedIntegration.id)}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-onedark-fgBright">
                    Configure {selectedIntegration.name}
                  </h3>
                  <span className="text-[11px] font-mono text-onedark-muted">
                    {selectedIntegration.auth_type}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setSelectedIntegration(null)}
                className="p-1.5 rounded-lg text-onedark-muted hover:text-onedark-fgBright hover:bg-onedark-surface transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="text-xs text-onedark-fg/90 leading-relaxed">
                Enter your {selectedIntegration.auth_type}. The secret is encrypted at rest using AES-256 and will automatically be provisioned to runtime agent harnesses.
              </div>

              <div className="space-y-2">
                <label className="text-xs font-mono font-semibold text-onedark-fgBright flex items-center justify-between">
                  <span>
                    {selectedIntegration.id === 'github' ? 'GitHub Personal Access Token (PAT)' :
                     selectedIntegration.id === 'slack' ? 'Slack Bot User OAuth Token (xoxb-)' :
                     selectedIntegration.id === 'appsignal' ? 'AppSignal Push API Key' :
                     selectedIntegration.id === 'gemini' ? 'Google AI Studio / Gemini API Key' :
                     selectedIntegration.id === 'sentry' ? 'Sentry Auth Token' : 'API Token'}
                  </span>
                  <span className="text-[10.5px] font-mono text-onedark-accent">Required</span>
                </label>
                <input
                  type="password"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder={
                    selectedIntegration.id === 'github' ? 'ghp_xxxxxxxxxxxxxxxxxxxx' :
                    selectedIntegration.id === 'slack' ? 'xoxb-xxxxxxxxxxxxxxxxxxxx' :
                    selectedIntegration.id === 'gemini' ? 'AIzaSyxxxxxxxxxxxxxxxxxxxx' :
                    selectedIntegration.id === 'sentry' ? 'sntrys_xxxxxxxxxxxxxxxxxxxx' : 'Enter secret key...'
                  }
                  className="w-full px-3.5 py-2.5 rounded-lg bg-onedark-bg border border-onedark-border text-xs text-onedark-fgBright font-mono focus:outline-none focus:border-onedark-accent shadow-xs"
                  autoFocus
                />
              </div>

              {feedback && (
                <div className={`p-3.5 rounded-lg border text-xs font-mono flex items-start space-x-2.5 ${
                  feedback.success
                    ? 'bg-onedark-green/15 border-onedark-green/40 text-onedark-green'
                    : 'bg-onedark-red/15 border-onedark-red/40 text-onedark-red'
                }`}>
                  {feedback.success ? (
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5 text-onedark-green" />
                  ) : (
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-onedark-red" />
                  )}
                  <div className="leading-relaxed">{feedback.message}</div>
                </div>
              )}
            </div>

            <div className="p-4 bg-onedark-surface/30 border-t border-onedark-border flex items-center justify-between">
              <span className="text-xs font-mono text-onedark-muted flex items-center space-x-1.5">
                <Lock className="w-3.5 h-3.5 text-onedark-accent" />
                <span>AES-256 Encrypted</span>
              </span>
              <div className="flex items-center space-x-2.5">
                <button
                  onClick={() => setSelectedIntegration(null)}
                  className="px-3.5 py-1.5 rounded-lg bg-onedark-surface hover:bg-onedark-border text-onedark-fgBright text-xs font-mono transition-colors cursor-pointer border border-onedark-border"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveCredential}
                  disabled={submitting || !tokenInput.trim()}
                  className="px-4 py-1.5 rounded-lg bg-onedark-accent hover:bg-onedark-accent/90 text-onedark-darker text-xs font-mono font-bold flex items-center space-x-1.5 transition-all disabled:opacity-40 cursor-pointer shadow-xs active:scale-95"
                >
                  {submitting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>Save & Validate</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
