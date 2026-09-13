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
  LayoutGrid,
  List,
  ExternalLink,
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
}

export const IntegrationsView: React.FC<IntegrationsViewProps> = ({
  integrations,
  activeSkills,
  skillsCatalog = [],
  webhookEndpoints = [],
  onRefreshIntegrations,
  onBackToChat,
}) => {
  const [selectedIntegration, setSelectedIntegration] = useState<Integration | null>(null);
  const [tokenInput, setTokenInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ success?: boolean; message?: string } | null>(null);
  const [copiedEndpointId, setCopiedEndpointId] = useState<string | null>(null);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'skills' | 'gateways' | 'providers'>('all');
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
                <PlugZap className="w-4 h-4 text-onedark-accent" />
                <span>Integrations & Skills Hub</span>
              </h1>
              <span className="px-2 py-0.5 rounded-full bg-onedark-accent/15 text-onedark-accent font-mono text-[10.5px] font-bold border border-onedark-accent/30">
                AES-256 Vault
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {onRefreshIntegrations && (
              <button
                onClick={onRefreshIntegrations}
                className="px-2.5 py-1.5 rounded-lg bg-onedark-darker hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg text-xs font-mono flex items-center space-x-1.5 border border-onedark-borderSubtle transition-colors cursor-pointer"
                title="Refresh Integrations Status"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Sync Status</span>
              </button>
            )}
            <button
              onClick={() => setIsBannerCollapsed(!isBannerCollapsed)}
              className="px-2.5 py-1.5 rounded-lg bg-onedark-darker hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg text-xs font-mono flex items-center space-x-1.5 border border-onedark-borderSubtle transition-colors cursor-pointer"
            >
              <span>{isBannerCollapsed ? 'Show Stats' : 'Hide Stats'}</span>
              {isBannerCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Collapsible Overview Stat Cards */}
        {!isBannerCollapsed && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3 animate-fadeIn">
            <div className="p-3.5 rounded-xl bg-onedark-darker border border-onedark-borderSubtle flex items-center space-x-3 shadow-sm">
              <div className="p-2.5 rounded-lg bg-onedark-surface text-onedark-accent border border-onedark-border">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <div className="text-[11px] font-medium text-onedark-muted uppercase tracking-wider font-mono">Mounted Skills</div>
                <div className="text-base font-bold text-onedark-fgBright mt-0.5">{allSkills.length} Agent Capabilities</div>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-onedark-darker border border-onedark-borderSubtle flex items-center space-x-3 shadow-sm">
              <div className="p-2.5 rounded-lg bg-onedark-surface text-onedark-green border border-onedark-border">
                <Webhook className="w-4 h-4" />
              </div>
              <div>
                <div className="text-[11px] font-medium text-onedark-muted uppercase tracking-wider font-mono">Inbound Gateways</div>
                <div className="text-base font-bold text-onedark-fgBright mt-0.5">{webhookEndpoints.length || 3} Endpoints Active</div>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-onedark-darker border border-onedark-borderSubtle flex items-center space-x-3 shadow-sm">
              <div className="p-2.5 rounded-lg bg-onedark-surface text-onedark-purple border border-onedark-border">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div>
                <div className="text-[11px] font-medium text-onedark-muted uppercase tracking-wider font-mono">HMAC Verification</div>
                <div className="text-xs font-semibold text-onedark-fgBright mt-0.5">SHA-256 Signature Auth</div>
              </div>
            </div>
          </div>
        )}

        {/* Sticky Search & Tab Selector Toolbar */}
        <div className="mt-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-3 border-t border-onedark-borderSubtle/60">
          <div className="relative flex-1 max-w-md">
            <Search className="w-3.5 h-3.5 text-onedark-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search skills, endpoints, tokens, or providers..."
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
            {[
              { id: 'all', label: 'All Resources' },
              { id: 'skills', label: `Skills (${allSkills.length})` },
              { id: 'gateways', label: `Gateways (${webhookEndpoints.length})` },
              { id: 'providers', label: `Providers (${integrations.length})` },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-2.5 py-1 rounded-lg text-xs font-mono font-medium transition-all cursor-pointer whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'bg-onedark-accent text-onedark-darker font-bold shadow-sm'
                    : 'bg-onedark-darker text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface border border-onedark-borderSubtle'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content Sections */}
      <div className="space-y-7">
        {/* Mounted Antigravity Skills Catalog */}
        {(activeTab === 'all' || activeTab === 'skills') && filteredSkills.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-onedark-muted uppercase tracking-wider flex items-center space-x-1.5 font-mono">
                <Sparkles className="w-3.5 h-3.5 text-onedark-accent" />
                <span>Mounted Antigravity Skills ({filteredSkills.length})</span>
              </h2>
              <span className="text-[11px] text-onedark-muted">Progressive tool disclosure via Markdown schemas</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredSkills.map((skill) => {
                const isActive = skill.status === 'ACTIVE';
                return (
                  <div
                    key={skill.id}
                    className="p-3.5 rounded-xl bg-onedark-darker border border-onedark-borderSubtle hover:border-onedark-border transition-all flex flex-col justify-between space-y-2.5 shadow-sm"
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className="text-xs font-bold text-onedark-fgBright">{skill.name}</h3>
                          <div className="text-[10px] text-onedark-accent font-mono mt-0.5">{skill.path}</div>
                        </div>
                        <span
                          className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border flex-shrink-0 ${
                            isActive
                              ? 'bg-onedark-green/10 text-onedark-green border-onedark-green/20'
                              : 'bg-onedark-yellow/10 text-onedark-yellow border-onedark-yellow/20'
                          }`}
                        >
                          {isActive ? <CheckCircle2 className="w-2.5 h-2.5" /> : <Key className="w-2.5 h-2.5" />}
                          <span>{isActive ? 'Mounted & Ready' : 'Auth Required'}</span>
                        </span>
                      </div>

                      <p className="text-[11px] text-onedark-muted leading-relaxed line-clamp-2">
                        {skill.description}
                      </p>
                    </div>

                    <div className="pt-2 border-t border-onedark-borderSubtle/60 flex flex-wrap gap-1">
                      {skill.tools.map((t) => (
                        <span
                          key={t}
                          className="px-1.5 py-0.5 rounded bg-onedark-surface text-onedark-fg text-[10px] font-mono border border-onedark-borderSubtle"
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

        {/* Inbound Webhook Gateway Endpoints */}
        {(activeTab === 'all' || activeTab === 'gateways') && filteredGateways.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-onedark-muted uppercase tracking-wider flex items-center space-x-1.5 font-mono">
                <Webhook className="w-3.5 h-3.5 text-onedark-green" />
                <span>Inbound Webhook Gateways ({filteredGateways.length})</span>
              </h2>
              <span className="text-[11px] text-onedark-muted">Endpoints ready for external event dispatch</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {filteredGateways.map((ep) => {
                const isCopied = copiedEndpointId === ep.id;
                return (
                  <div
                    key={ep.id}
                    className="p-3.5 rounded-xl bg-onedark-darker border border-onedark-borderSubtle space-y-2.5 flex flex-col justify-between shadow-sm"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-bold text-onedark-fgBright">{ep.name}</h4>
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-onedark-accent/15 text-onedark-accent font-bold">
                          {ep.method}
                        </span>
                      </div>
                      <p className="text-[11px] text-onedark-muted">{ep.description}</p>
                      <div className="flex flex-wrap gap-1 pt-1">
                        {ep.events.map((ev) => (
                          <span key={ev} className="text-[10px] font-mono text-onedark-fg bg-onedark-surface px-1.5 py-0.5 rounded border border-onedark-borderSubtle">
                            {ev}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="pt-2 border-t border-onedark-borderSubtle flex items-center justify-between">
                      <div className="text-[10px] font-mono text-onedark-muted truncate max-w-[170px]" title={ep.path}>
                        {ep.path}
                      </div>
                      <button
                        onClick={() => handleCopyWebhookUrl(ep)}
                        className="px-2 py-1 rounded bg-onedark-surface hover:bg-onedark-border text-onedark-fgBright text-xs font-mono flex items-center space-x-1 transition-colors border border-onedark-border cursor-pointer"
                        title="Copy Full Webhook URL"
                      >
                        {isCopied ? (
                          <>
                            <Check className="w-3 h-3 text-onedark-green" />
                            <span className="text-[10px] text-onedark-green font-bold">Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3 text-onedark-muted" />
                            <span className="text-[10px]">Copy URL</span>
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

        {/* External Provider Connections */}
        {(activeTab === 'all' || activeTab === 'providers') && filteredIntegrations.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-onedark-muted uppercase tracking-wider flex items-center space-x-1.5 font-mono">
                <PlugZap className="w-3.5 h-3.5 text-onedark-accent" />
                <span>External Provider Connections ({filteredIntegrations.length})</span>
              </h2>
              <span className="text-[11px] text-onedark-muted">Credentials encrypted at rest with AES-256</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {filteredIntegrations.map((item) => (
                <div
                  key={item.id}
                  className="p-4 rounded-xl bg-onedark-darker border border-onedark-borderSubtle space-y-3 shadow-sm hover:border-onedark-border transition-colors flex flex-col justify-between"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="text-xs font-bold text-onedark-fgBright">{item.name}</h3>
                        <div className="text-[11px] text-onedark-muted font-mono mt-0.5">Auth: {item.auth_type}</div>
                      </div>

                      {item.configured ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-onedark-green/15 text-onedark-green border border-onedark-green/30 flex items-center space-x-1 font-semibold">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>Configured</span>
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-onedark-surface text-onedark-muted border border-onedark-border flex items-center space-x-1">
                          <Key className="w-3 h-3" />
                          <span>Key Not Set</span>
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-onedark-fg leading-relaxed">{item.description}</p>
                  </div>

                  <div className="pt-2.5 border-t border-onedark-borderSubtle flex items-center justify-between">
                    <div className="flex flex-wrap gap-1">
                      {item.skills.map((s) => (
                        <span
                          key={s}
                          className="px-2 py-0.5 rounded bg-onedark-surface text-onedark-muted border border-onedark-borderSubtle text-[10px] font-mono"
                        >
                          {s}
                        </span>
                      ))}
                    </div>

                    <button
                      onClick={() => handleOpenConfig(item)}
                      className="px-2.5 py-1 rounded-lg bg-onedark-surface hover:bg-onedark-border text-onedark-fgBright text-xs font-mono flex items-center space-x-1 transition-colors border border-onedark-border cursor-pointer"
                    >
                      <Settings className="w-3 h-3" />
                      <span>Configure</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty Search Feedback */}
        {filteredSkills.length === 0 && filteredGateways.length === 0 && filteredIntegrations.length === 0 && (
          <div className="p-12 text-center border border-dashed border-onedark-borderSubtle rounded-2xl bg-onedark-darker space-y-3">
            <PlugZap className="w-8 h-8 text-onedark-muted mx-auto opacity-50" />
            <h3 className="text-sm font-semibold text-onedark-fgBright">No matching resources found</h3>
            <p className="text-xs text-onedark-muted max-w-sm mx-auto">
              No skill, gateway, or provider matched &ldquo;{searchQuery}&rdquo;. Try clearing your search query.
            </p>
            <button
              onClick={() => { setSearchQuery(''); setActiveTab('all'); }}
              className="px-3 py-1.5 rounded-lg bg-onedark-surface hover:bg-onedark-border text-onedark-accent text-xs font-mono font-medium transition-colors cursor-pointer"
            >
              Reset Filters
            </button>
          </div>
        )}
      </div>

      {/* Configuration Modal with Backdrop Dismiss */}
      {selectedIntegration && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fadeIn"
          onClick={() => setSelectedIntegration(null)}
        >
          <div 
            className="w-full max-w-lg bg-onedark-darker border border-onedark-border rounded-xl shadow-2xl overflow-hidden animate-slideUp"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 bg-onedark-darker border-b border-onedark-borderSubtle flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Settings className="w-4 h-4 text-onedark-accent" />
                <h3 className="text-sm font-semibold text-onedark-fgBright">
                  Configure {selectedIntegration.name}
                </h3>
              </div>
              <button
                onClick={() => setSelectedIntegration(null)}
                className="p-1 rounded-md text-onedark-muted hover:text-onedark-fgBright hover:bg-onedark-surface transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="text-xs text-onedark-fg leading-relaxed">
                Enter your {selectedIntegration.auth_type}. The secret is encrypted at rest using AES-256 and will automatically be shared with the Repository Vault.
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-mono text-onedark-muted">
                  {selectedIntegration.id === 'github' ? 'GitHub Personal Access Token (PAT)' :
                   selectedIntegration.id === 'slack' ? 'Slack Bot User OAuth Token' :
                   selectedIntegration.id === 'appsignal' ? 'AppSignal Push API Key' :
                   selectedIntegration.id === 'gemini' ? 'Google AI Studio / Gemini API Key' : 'API Token'}
                </label>
                <input
                  type="password"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder={
                    selectedIntegration.id === 'github' ? 'ghp_xxxxxxxxxxxxxxxxxxxx' :
                    selectedIntegration.id === 'slack' ? 'xoxb-xxxxxxxxxxxxxxxxxxxx' :
                    selectedIntegration.id === 'gemini' ? 'AIzaSyxxxxxxxxxxxxxxxxxxxx' : 'Enter secret key...'
                  }
                  className="w-full px-3 py-2 rounded-lg bg-onedark-bg border border-onedark-border text-xs text-onedark-fgBright font-mono focus:outline-none focus:border-onedark-accent"
                />
              </div>

              {feedback && (
                <div className={`p-3 rounded-lg border text-xs font-mono flex items-start space-x-2 ${
                  feedback.success
                    ? 'bg-onedark-green/10 border-onedark-green/30 text-onedark-green'
                    : 'bg-onedark-red/10 border-onedark-red/30 text-onedark-red'
                }`}>
                  {feedback.success ? (
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  )}
                  <div>{feedback.message}</div>
                </div>
              )}
            </div>

            <div className="p-4 bg-onedark-darker border-t border-onedark-borderSubtle flex items-center justify-between">
              <span className="text-[11px] font-mono text-onedark-muted flex items-center space-x-1">
                <Lock className="w-3 h-3 text-onedark-accent" />
                <span>AES-256 Encrypted in Vault</span>
              </span>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setSelectedIntegration(null)}
                  className="px-3 py-1.5 rounded-lg bg-onedark-surface hover:bg-onedark-border text-onedark-fg text-xs transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveCredential}
                  disabled={submitting || !tokenInput.trim()}
                  className="px-4 py-1.5 rounded-lg bg-onedark-accent hover:bg-onedark-accent/90 text-onedark-darker text-xs font-semibold flex items-center space-x-1.5 transition-colors disabled:opacity-40 cursor-pointer"
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


