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
  Zap,
  Lock,
  Bot,
  Cpu,
  SlidersHorizontal,
  Layers,
  Settings2,
  CheckSquare,
  GitPullRequest,
  FileText,
  Radio,
  Mail,
  Cloud,
  Database,
  Shield,
  CreditCard,
  Target,
  Globe,
  Power
} from 'lucide-react';
import { Integration, SkillCatalogItem, WebhookEndpoint, ModelSettings } from '../../types';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface IntegrationsViewProps {
  integrations: Integration[];
  activeSkills: string[];
  skillsCatalog?: SkillCatalogItem[];
  webhookEndpoints?: WebhookEndpoint[];
  disabledCapabilities?: string[];
  onRefreshIntegrations?: () => void;
  onBackToChat?: () => void;
  onNavigateToPolicies?: () => void;
}

export const IntegrationsView: React.FC<IntegrationsViewProps> = ({
  integrations,
  activeSkills,
  skillsCatalog = [],
  webhookEndpoints = [],
  disabledCapabilities = [],
  onRefreshIntegrations,
  onBackToChat,
  onNavigateToPolicies,
}) => {
  const [selectedIntegration, setSelectedIntegration] = useState<Integration | null>(null);
  const [tokenInput, setTokenInput] = useState('');
  const [modelInput, setModelInput] = useState('');
  const [baseUrlInput, setBaseUrlInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ success?: boolean; message?: string } | null>(null);
  const [copiedEndpointId, setCopiedEndpointId] = useState<string | null>(null);

  // Model Orchestration Settings State
  const [modelSettings, setModelSettings] = useState<ModelSettings | null>(null);
  const [loadingModelSettings, setLoadingModelSettings] = useState(false);
  const [savingModelSettings, setSavingModelSettings] = useState(false);
  const [modelSettingsFeedback, setModelSettingsFeedback] = useState<{ success?: boolean; message?: string } | null>(null);

  const [routingMode, setRoutingMode] = useState<string>('adaptive');
  const [majorModel, setMajorModel] = useState<string>('gemini-3.8-flash');
  const [minorModel, setMinorModel] = useState<string>('gemini-3.7-flash');
  const [defaultModel, setDefaultModel] = useState<string>('gemini-3.7-flash');

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'providers' | 'skills' | 'gateways'>('all');
  const [isBannerCollapsed, setIsBannerCollapsed] = useState(false);

  // Fetch live model settings
  const fetchModelSettings = async () => {
    try {
      setLoadingModelSettings(true);
      const res = await fetch(`${API_BASE}/api/integrations/model-settings`);
      if (res.ok) {
        const data: ModelSettings = await res.json();
        setModelSettings(data);
        setRoutingMode(data.routing_mode || 'adaptive');
        setMajorModel(data.major_model || 'gemini-3.8-flash');
        setMinorModel(data.minor_model || 'gemini-3.7-flash');
        setDefaultModel(data.default_model || 'gemini-3.7-flash');
      }
    } catch (err) {
      console.error('Failed to load model settings:', err);
    } finally {
      setLoadingModelSettings(false);
    }
  };

  useEffect(() => {
    fetchModelSettings();
  }, []);

  // Capabilities State & Real-time Handlers
  const [disabledCaps, setDisabledCaps] = useState<Set<string>>(() => new Set(disabledCapabilities));
  const [togglingCap, setTogglingCap] = useState<string | null>(null);

  useEffect(() => {
    if (disabledCapabilities && disabledCapabilities.length > 0) {
      setDisabledCaps(new Set(disabledCapabilities));
    }
  }, [disabledCapabilities]);

  const fetchCapabilities = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/integrations`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.disabled_capabilities)) {
          setDisabledCaps(new Set(data.disabled_capabilities));
        }
      }
    } catch (err) {
      console.error('Failed to load disabled capabilities:', err);
    }
  };

  useEffect(() => {
    fetchCapabilities();
  }, []);

  const isToolDisabled = (toolName: string): boolean => {
    if (disabledCaps.has(toolName)) return true;
    const canonicalMap: Record<string, string> = {
      'get_linear_issue': 'linear.get_issue',
      'search_linear_issues': 'linear.get_issue',
      'post_linear_comment': 'linear.post_comment',
      'update_linear_issue_status': 'linear.update_status',
      'linear.get_issue': 'get_linear_issue',
      'linear.post_comment': 'post_linear_comment',
      'linear.update_status': 'update_linear_issue_status',
    };
    const alias = canonicalMap[toolName];
    if (alias && disabledCaps.has(alias)) return true;
    return false;
  };

  const handleToggleCapability = async (toolName: string) => {
    const currentlyDisabled = isToolDisabled(toolName);
    const newEnabled = currentlyDisabled;
    setTogglingCap(toolName);

    setDisabledCaps((prev) => {
      const next = new Set(prev);
      if (newEnabled) {
        next.delete(toolName);
        const canonicalMap: Record<string, string> = {
          'get_linear_issue': 'linear.get_issue',
          'search_linear_issues': 'linear.get_issue',
          'post_linear_comment': 'linear.post_comment',
          'update_linear_issue_status': 'linear.update_status',
          'linear.get_issue': 'get_linear_issue',
          'linear.post_comment': 'post_linear_comment',
          'linear.update_status': 'update_linear_issue_status',
        };
        if (canonicalMap[toolName]) next.delete(canonicalMap[toolName]);
      } else {
        next.add(toolName);
      }
      return next;
    });

    try {
      const res = await fetch(`${API_BASE}/api/integrations/capabilities/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool_name: toolName, enabled: newEnabled }),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.disabled_capabilities)) {
          setDisabledCaps(new Set(data.disabled_capabilities));
        }
      } else {
        fetchCapabilities();
      }
    } catch (err) {
      console.error('Failed to toggle capability:', err);
      fetchCapabilities();
    } finally {
      setTogglingCap(null);
    }
  };

  const handleBatchCapabilities = async (tools: string[], mode: 'all_on' | 'all_off' | 'read_only') => {
    const readOnlyPrefixes = ['get', 'list', 'search', 'fetch', 'view', 'inspect', 'read', 'check', 'correlate', 'query'];

    setDisabledCaps((prev) => {
      const next = new Set(prev);
      if (mode === 'all_on') {
        tools.forEach((t) => next.delete(t));
      } else if (mode === 'all_off') {
        tools.forEach((t) => next.add(t));
      } else if (mode === 'read_only') {
        tools.forEach((t) => {
          const action = t.includes('.') ? t.split('.').pop()! : t;
          const isRead = readOnlyPrefixes.some((p) => action.toLowerCase().startsWith(p));
          if (isRead) {
            next.delete(t);
          } else {
            next.add(t);
          }
        });
      }
      return next;
    });

    try {
      const res = await fetch(`${API_BASE}/api/integrations/capabilities/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tools, mode }),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.disabled_capabilities)) {
          setDisabledCaps(new Set(data.disabled_capabilities));
        }
      } else {
        fetchCapabilities();
      }
    } catch (err) {
      console.error('Failed to batch toggle capabilities:', err);
      fetchCapabilities();
    }
  };

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
    if (item.id === 'gemini') {
      setModelInput(modelSettings?.providers?.gemini?.model || 'gemini-3.7-flash');
      setBaseUrlInput('');
    } else if (item.id === 'deepseek') {
      setModelInput(modelSettings?.providers?.deepseek?.model || 'deepseek-flash');
      setBaseUrlInput(modelSettings?.providers?.deepseek?.base_url || 'https://api.deepseek.com');
    } else if (item.id === 'anthropic') {
      setModelInput(modelSettings?.providers?.anthropic?.model || 'claude-fable-5-1');
      setBaseUrlInput('');
    } else if (item.id === 'openai') {
      setModelInput(modelSettings?.providers?.openai?.model || 'gpt-6-astra');
      setBaseUrlInput(modelSettings?.providers?.openai?.base_url || 'https://api.openai.com/v1');
    } else {
      setModelInput('');
      setBaseUrlInput('');
    }
  };

  const handleCopyWebhookUrl = (endpoint: WebhookEndpoint) => {
    const origin = window.location.origin;
    const fullUrl = `${origin}${endpoint.path}`;
    navigator.clipboard.writeText(fullUrl);
    setCopiedEndpointId(endpoint.id);
    setTimeout(() => setCopiedEndpointId(null), 2000);
  };

  const handleSaveModelSettings = async () => {
    setSavingModelSettings(true);
    setModelSettingsFeedback(null);
    try {
      const res = await fetch(`${API_BASE}/api/integrations/model-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          routing_mode: routingMode,
          major_model: majorModel,
          minor_model: minorModel,
          default_model: defaultModel,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setModelSettings(data);
        setModelSettingsFeedback({
          success: true,
          message: 'Model orchestration & adaptive tiering saved successfully.',
        });
        setTimeout(() => setModelSettingsFeedback(null), 3500);
      } else {
        setModelSettingsFeedback({
          success: false,
          message: 'Failed to update model orchestration settings.',
        });
      }
    } catch (err: any) {
      setModelSettingsFeedback({
        success: false,
        message: err.message || 'Error updating model orchestration.',
      });
    } finally {
      setSavingModelSettings(false);
    }
  };

  const handleSaveCredential = async () => {
    if (!selectedIntegration) return;
    if (!selectedIntegration.configured && !tokenInput.trim()) return;

    setSubmitting(true);
    setFeedback(null);

    const payload: Record<string, any> = {};
    const hasToken = Boolean(tokenInput.trim());

    if (selectedIntegration.id === 'github') {
      if (hasToken) payload.token = tokenInput.trim();
    } else if (selectedIntegration.id === 'slack') {
      if (hasToken) payload.token = tokenInput.trim();
    } else if (selectedIntegration.id === 'appsignal') {
      if (hasToken) payload.api_key = tokenInput.trim();
    } else if (selectedIntegration.id === 'gemini') {
      if (hasToken) payload.api_key = tokenInput.trim();
      if (modelInput.trim()) payload.model = modelInput.trim();
    } else if (selectedIntegration.id === 'deepseek') {
      if (hasToken) payload.api_key = tokenInput.trim();
      if (modelInput.trim()) payload.model = modelInput.trim();
      if (baseUrlInput.trim()) payload.base_url = baseUrlInput.trim();
    } else if (selectedIntegration.id === 'anthropic') {
      if (hasToken) payload.api_key = tokenInput.trim();
      if (modelInput.trim()) payload.model = modelInput.trim();
    } else if (selectedIntegration.id === 'openai') {
      if (hasToken) payload.api_key = tokenInput.trim();
      if (modelInput.trim()) payload.model = modelInput.trim();
      if (baseUrlInput.trim()) payload.base_url = baseUrlInput.trim();
    } else if (selectedIntegration.id === 'linear') {
      if (hasToken) payload.token = tokenInput.trim();
    } else if (selectedIntegration.id === 'sentry') {
      if (hasToken) payload.token = tokenInput.trim();
    } else if (selectedIntegration.id === 'jira') {
      if (hasToken) payload.token = tokenInput.trim();
      if (baseUrlInput.trim()) {
        payload.domain = baseUrlInput.trim();
        payload.base_url = baseUrlInput.trim();
      }
    } else {
      if (hasToken) payload.token = tokenInput.trim();
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
        fetchModelSettings();
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

  // Base skills catalog
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

  // Unified Services: Merge provider connections with their matching mounted skill schemas
  const unifiedServices = useMemo(() => {
    return integrations.map((item) => {
      const matchingSkill = skillsCatalog.find((s) => s.id === item.id);

      let path = matchingSkill?.path;
      if (!path) {
        if (item.id === 'ingrations') {
          path = 'builtin://ingrations-engine';
        } else if (['gemini', 'anthropic', 'deepseek', 'openai'].includes(item.id)) {
          path = 'vault://llm-gateway';
        } else {
          path = `ingrations://${item.id}`;
        }
      }

      let category = matchingSkill?.category;
      if (!category) {
        if (['gemini', 'anthropic', 'deepseek', 'openai'].includes(item.id)) {
          category = 'AI Model & Reasoning';
        } else if (item.id === 'ingrations') {
          category = 'Core Runtime Engine';
        } else {
          category = 'Ecosystem Provider';
        }
      }

      const mergedSkills = Array.from(new Set([...item.skills, ...(matchingSkill?.tools || [])]));

      return {
        ...item,
        path,
        category,
        skills: mergedSkills.length > 0 ? mergedSkills : item.skills,
      };
    });
  }, [integrations, skillsCatalog]);

  // Built-in Workspace Skills: Filter out services that already have a dedicated provider card
  const workspaceSkills = useMemo(() => {
    const integrationIds = new Set(integrations.map((i) => i.id));
    return allSkills.filter((s) => !integrationIds.has(s.id));
  }, [allSkills, integrations]);

  // Filtered unified services
  const filteredUnifiedServices = useMemo(() => {
    if (activeTab === 'skills' || activeTab === 'gateways') return [];
    return unifiedServices.filter((item) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        item.name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.id.toLowerCase().includes(q) ||
        item.path.toLowerCase().includes(q) ||
        (item.category && item.category.toLowerCase().includes(q)) ||
        item.skills.some((s) => s.toLowerCase().includes(q))
      );
    });
  }, [unifiedServices, searchQuery, activeTab]);

  // Filtered workspace skills
  const filteredWorkspaceSkills = useMemo(() => {
    if (activeTab === 'providers' || activeTab === 'gateways') return [];
    return workspaceSkills.filter((s) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.path.toLowerCase().includes(q) ||
        (s.category && s.category.toLowerCase().includes(q)) ||
        s.tools.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [workspaceSkills, searchQuery, activeTab]);

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

  const getProviderIcon = (id: string) => {
    switch (id) {
      case 'gemini':
        return <Sparkles className="w-5 h-5 text-cyan-400" />;
      case 'deepseek':
        return <Zap className="w-5 h-5 text-blue-400" />;
      case 'anthropic':
        return <Bot className="w-5 h-5 text-amber-400" />;
      case 'openai':
        return <Cpu className="w-5 h-5 text-emerald-400" />;
      case 'github':
        return <FolderGit2 className="w-5 h-5 text-purple-400" />;
      case 'linear':
        return <Zap className="w-5 h-5 text-indigo-400" />;
      case 'slack':
        return <MessageSquare className="w-5 h-5 text-emerald-400" />;
      case 'appsignal':
        return <Activity className="w-5 h-5 text-amber-400" />;
      case 'sentry':
        return <AlertTriangle className="w-5 h-5 text-rose-400" />;
      case 'jira':
        return <CheckSquare className="w-5 h-5 text-blue-400" />;
      case 'gitlab':
        return <GitPullRequest className="w-5 h-5 text-orange-400" />;
      case 'notion':
        return <FileText className="w-5 h-5 text-zinc-300" />;
      case 'discord':
        return <Radio className="w-5 h-5 text-indigo-400" />;
      case 'google_workspace':
        return <Mail className="w-5 h-5 text-rose-400" />;
      case 'aws':
        return <Cloud className="w-5 h-5 text-amber-400" />;
      case 'supabase':
        return <Database className="w-5 h-5 text-emerald-400" />;
      case 'cloudflare':
        return <Shield className="w-5 h-5 text-orange-400" />;
      case 'datadog':
        return <Activity className="w-5 h-5 text-purple-400" />;
      case 'stripe':
        return <CreditCard className="w-5 h-5 text-violet-400" />;
      case 'salesforce':
        return <Cloud className="w-5 h-5 text-sky-400" />;
      case 'hubspot':
        return <Target className="w-5 h-5 text-orange-400" />;
      case 'ingrations':
        return <PlugZap className="w-5 h-5 text-cyan-400" />;
      default:
        return <PlugZap className="w-5 h-5 text-onedark-accent" />;
    }
  };

  const getProviderBadgeTheme = (id: string) => {
    switch (id) {
      case 'gemini':
        return 'bg-cyan-100 border-cyan-300 text-cyan-950 dark:bg-cyan-500/10 dark:border-cyan-500/30 dark:text-cyan-400';
      case 'deepseek':
        return 'bg-blue-100 border-blue-300 text-blue-950 dark:bg-blue-500/10 dark:border-blue-500/30 dark:text-blue-400';
      case 'anthropic':
        return 'bg-amber-100 border-amber-300 text-amber-950 dark:bg-amber-500/10 dark:border-amber-500/30 dark:text-amber-400';
      case 'openai':
        return 'bg-emerald-100 border-emerald-300 text-emerald-950 dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:text-emerald-400';
      case 'github':
        return 'bg-purple-100 border-purple-300 text-purple-950 dark:bg-purple-500/10 dark:border-purple-500/30 dark:text-purple-400';
      case 'linear':
        return 'bg-indigo-100 border-indigo-300 text-indigo-950 dark:bg-indigo-500/10 dark:border-indigo-500/30 dark:text-indigo-400';
      case 'slack':
        return 'bg-emerald-100 border-emerald-300 text-emerald-950 dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:text-emerald-400';
      case 'appsignal':
        return 'bg-amber-100 border-amber-300 text-amber-950 dark:bg-amber-500/10 dark:border-amber-500/30 dark:text-amber-400';
      case 'sentry':
        return 'bg-rose-100 border-rose-300 text-rose-950 dark:bg-rose-500/10 dark:border-rose-500/30 dark:text-rose-400';
      case 'jira':
        return 'bg-blue-100 border-blue-300 text-blue-950 dark:bg-blue-500/10 dark:border-blue-500/30 dark:text-blue-400';
      case 'gitlab':
        return 'bg-orange-100 border-orange-300 text-orange-950 dark:bg-orange-500/10 dark:border-orange-500/30 dark:text-orange-400';
      case 'notion':
        return 'bg-zinc-100 border-zinc-300 text-zinc-950 dark:bg-zinc-500/10 dark:border-zinc-500/30 dark:text-zinc-300';
      case 'discord':
        return 'bg-indigo-100 border-indigo-300 text-indigo-950 dark:bg-indigo-500/10 dark:border-indigo-500/30 dark:text-indigo-400';
      case 'google_workspace':
        return 'bg-rose-100 border-rose-300 text-rose-950 dark:bg-rose-500/10 dark:border-rose-500/30 dark:text-rose-400';
      case 'aws':
        return 'bg-amber-100 border-amber-300 text-amber-950 dark:bg-amber-500/10 dark:border-amber-500/30 dark:text-amber-400';
      case 'supabase':
        return 'bg-emerald-100 border-emerald-300 text-emerald-950 dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:text-emerald-400';
      case 'cloudflare':
        return 'bg-orange-100 border-orange-300 text-orange-950 dark:bg-orange-500/10 dark:border-orange-500/30 dark:text-orange-400';
      case 'datadog':
        return 'bg-purple-100 border-purple-300 text-purple-950 dark:bg-purple-500/10 dark:border-purple-500/30 dark:text-purple-400';
      case 'stripe':
        return 'bg-violet-100 border-violet-300 text-violet-950 dark:bg-violet-500/10 dark:border-violet-500/30 dark:text-violet-400';
      case 'salesforce':
        return 'bg-sky-100 border-sky-300 text-sky-950 dark:bg-sky-500/10 dark:border-sky-500/30 dark:text-sky-400';
      case 'hubspot':
        return 'bg-orange-100 border-orange-300 text-orange-950 dark:bg-orange-500/10 dark:border-orange-500/30 dark:text-orange-400';
      case 'ingrations':
        return 'bg-cyan-100 border-cyan-300 text-cyan-950 dark:bg-cyan-500/10 dark:border-cyan-500/30 dark:text-cyan-400';
      default:
        return 'bg-amber-100 border-amber-300 text-amber-950 dark:bg-onedark-accent/10 dark:border-onedark-accent/30 dark:text-onedark-accent';
    }
  };

  const getWorkspaceSkillIcon = (id: string) => {
    switch (id) {
      case 'git-worktree':
        return <FolderGit2 className="w-5 h-5 text-purple-400" />;
      case 'codebase-analyzer':
        return <Cpu className="w-5 h-5 text-cyan-400" />;
      case 'test-runner':
        return <CheckSquare className="w-5 h-5 text-emerald-400" />;
      case 'web-research':
        return <Globe className="w-5 h-5 text-blue-400" />;
      default:
        return <Sparkles className="w-5 h-5 text-onedark-accent" />;
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
                  onClick={() => {
                    onRefreshIntegrations();
                    fetchCapabilities();
                  }}
                  className="px-3 py-1.5 rounded-lg bg-onedark-darker hover:bg-onedark-surface text-onedark-fgBright text-xs font-mono font-medium flex items-center space-x-1.5 border border-onedark-border transition-colors cursor-pointer shadow-xs"
                  title="Refresh Integrations Status & Capabilities"
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
                  <PlugZap className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-bold text-onedark-muted uppercase tracking-wider font-mono">Connected Services</div>
                  <div className="text-base font-bold text-onedark-fgBright mt-0.5">{unifiedServices.length} Active Services</div>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-onedark-darker/90 border border-onedark-border flex items-center space-x-3.5 shadow-sm">
                <div className="p-2.5 rounded-xl bg-onedark-surface text-onedark-accent border border-onedark-borderSubtle">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-bold text-onedark-muted uppercase tracking-wider font-mono">Workspace Skills</div>
                  <div className="text-base font-bold text-onedark-fgBright mt-0.5 flex items-center space-x-2">
                    <span>{workspaceSkills.length} Core Capabilities</span>
                    {disabledCaps.size > 0 && (
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-medium">
                        {disabledCaps.size} paused
                      </span>
                    )}
                  </div>
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
                placeholder="Search services (Jira, GitHub), workspace skills, or tokens..."
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
                { id: 'providers', label: `Connected Services (${unifiedServices.length})` },
                { id: 'skills', label: `Workspace Skills (${workspaceSkills.length})` },
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
        {/* AI Model Orchestration & Adaptive Routing Card */}
        {(activeTab === 'all' || activeTab === 'providers') && (
          <div className="p-5 sm:p-6 rounded-2xl bg-onedark-darker/95 border border-onedark-border shadow-md space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-onedark-borderSubtle">
              <div className="flex items-center space-x-3.5">
                <div className="p-2.5 rounded-xl bg-onedark-accent/10 border border-onedark-accent/30 text-onedark-accent shadow-xs">
                  <SlidersHorizontal className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center space-x-2.5">
                    <h2 className="text-sm font-bold text-onedark-fgBright tracking-tight">
                      AI Model Orchestration & Adaptive Routing
                    </h2>
                    <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold border ${
                      routingMode === 'adaptive'
                        ? 'bg-onedark-green/15 text-onedark-green border-onedark-green/30'
                        : 'bg-onedark-accent/15 text-onedark-accent border-onedark-accent/30'
                    }`}>
                      {routingMode === 'adaptive' ? 'Task-Adaptive Tiering' : 'Manual Fixed Default'}
                    </span>
                  </div>
                  <p className="text-xs text-onedark-fg/75 mt-0.5">
                    Dynamically allocates lightweight models for Q&A / sub-plans and frontier reasoning models for fullstack scaffolds.
                  </p>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={handleSaveModelSettings}
                  disabled={savingModelSettings || loadingModelSettings}
                  className="px-4 py-2 rounded-lg bg-onedark-accent hover:bg-onedark-accent/90 text-onedark-darker text-xs font-mono font-bold flex items-center space-x-1.5 transition-all disabled:opacity-40 cursor-pointer shadow-xs active:scale-95"
                >
                  {savingModelSettings ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  <span>Save Routing Config</span>
                </button>
              </div>
            </div>

            {modelSettingsFeedback && (
              <div className={`p-3 rounded-lg border text-xs font-mono flex items-center space-x-2.5 animate-fadeIn ${
                modelSettingsFeedback.success
                  ? 'bg-onedark-green/15 border-onedark-green/40 text-onedark-green'
                  : 'bg-onedark-red/15 border-onedark-red/40 text-onedark-red'
              }`}>
                {modelSettingsFeedback.success ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-onedark-green" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0 text-onedark-red" />
                )}
                <span>{modelSettingsFeedback.message}</span>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 pt-1">
              {/* Routing Mode */}
              <div className="p-4 rounded-xl bg-onedark-surface/40 border border-onedark-borderSubtle space-y-3 flex flex-col justify-between">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-mono font-bold text-onedark-fgBright uppercase tracking-wider flex items-center space-x-1.5">
                      <Layers className="w-3.5 h-3.5 text-onedark-accent" />
                      <span>Routing Strategy</span>
                    </label>
                  </div>
                  <p className="text-[11.5px] text-onedark-muted leading-relaxed">
                    Choose whether agent execution dynamically shifts models by task complexity or locks to a static model.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setRoutingMode('adaptive')}
                    className={`px-3 py-2 rounded-lg text-xs font-mono font-semibold transition-all border text-center cursor-pointer ${
                      routingMode === 'adaptive'
                        ? 'bg-onedark-accent text-onedark-darker border-onedark-accent font-bold shadow-xs'
                        : 'bg-onedark-darker text-onedark-muted hover:text-onedark-fgBright border-onedark-border'
                    }`}
                  >
                    Adaptive Tiering
                  </button>
                  <button
                    type="button"
                    onClick={() => setRoutingMode('manual')}
                    className={`px-3 py-2 rounded-lg text-xs font-mono font-semibold transition-all border text-center cursor-pointer ${
                      routingMode === 'manual'
                        ? 'bg-onedark-accent text-onedark-darker border-onedark-accent font-bold shadow-xs'
                        : 'bg-onedark-darker text-onedark-muted hover:text-onedark-fgBright border-onedark-border'
                    }`}
                  >
                    Fixed Default
                  </button>
                </div>
              </div>

              {/* Major Model Tier */}
              <div className="p-4 rounded-xl bg-onedark-surface/40 border border-onedark-borderSubtle space-y-3 flex flex-col justify-between">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-mono font-bold text-amber-400 uppercase tracking-wider flex items-center space-x-1.5">
                      <Bot className="w-3.5 h-3.5 text-amber-400" />
                      <span>Major Tier (Frontier Reasoning)</span>
                    </label>
                  </div>
                  <p className="text-[11.5px] text-onedark-muted leading-relaxed">
                    Fullstack builds, scaffolding, complex code modifications, and debugging.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <select
                    value={majorModel}
                    onChange={(e) => setMajorModel(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-onedark-darker border border-onedark-border text-xs text-onedark-fgBright font-mono focus:outline-none focus:border-onedark-accent cursor-pointer"
                  >
                    <optgroup label="DeepSeek AI">
                      <option value="deepseek-reasoner">DeepSeek-R1 (Hybrid CoT / Frontier)</option>
                      <option value="deepseek-v4-pro">DeepSeek-V4-Pro (High Capacity Frontier)</option>
                      <option value="deepseek-flash">DeepSeek-V4.1-Flash (552B MoE / 1M Context)</option>
                      <option value="deepseek-chat">DeepSeek-V3 (General Agentic)</option>
                    </optgroup>
                    <optgroup label="Google Gemini">
                      <option value="gemini-3.8-flash">Gemini 3.8 Flash (High-Speed Reasoning)</option>
                      <option value="gemini-3.7-flash">Gemini 3.7 Flash (Agentic Workhorse)</option>
                    </optgroup>
                    <optgroup label="Anthropic Claude">
                      <option value="claude-fable-5-1">Claude Fable 5.1 (Mythos Frontier)</option>
                      <option value="claude-3-7-sonnet">Claude 3.7 Sonnet (Hybrid Thinking)</option>
                    </optgroup>
                    <optgroup label="OpenAI / Codex">
                      <option value="gpt-6-astra">GPT-6 Astra (Flagship Autonomous)</option>
                      <option value="gpt-6.1-sol">GPT-6.1 Sol (Near-Astra Complex Work)</option>
                      <option value="gpt-6-sol">GPT-6 Sol (Agentic Coding)</option>
                      <option value="gpt-5.6-sol">GPT-5.6 Sol (Flagship Professional)</option>
                      <option value="gpt-5.3-codex">GPT-5.3 Codex (Agentic Coding Frontier)</option>
                      <option value="o3-pro">o3-pro (High-Compute Reasoning)</option>
                      <option value="o3">o3 (Frontier Reasoning)</option>
                      <option value="gpt-4.1">GPT-4.1 (Smartest General)</option>
                      <option value="gpt-4o">GPT-4o (Omni Multimodal)</option>
                    </optgroup>
                  </select>
                  <div className="text-[10.5px] font-mono text-onedark-muted/80 truncate">
                    Allocated for app_building, review_audit, devops
                  </div>
                </div>
              </div>

              {/* Minor Model Tier */}
              <div className="p-4 rounded-xl bg-onedark-surface/40 border border-onedark-borderSubtle space-y-3 flex flex-col justify-between">
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <Zap className="w-3.5 h-3.5 text-onedark-accent" />
                    <span className="text-xs font-semibold text-onedark-fgBright font-sans">
                      Minor Model (Fast Routing)
                    </span>
                  </div>
                  <p className="text-[11.5px] text-onedark-muted leading-relaxed">
                    Lightweight model for conceptual Q&A, greetings, and dynamic intent classification.
                  </p>
                </div>
                <div className="space-y-1.5 pt-1">
                  <select
                    value={minorModel}
                    onChange={(e) => setMinorModel(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-onedark-darker border border-onedark-border text-xs text-onedark-fgBright font-mono focus:outline-none focus:border-onedark-accent cursor-pointer"
                  >
                    <optgroup label="DeepSeek AI">
                      <option value="deepseek-flash">DeepSeek-V4.1-Flash (Ultra-Fast Routing)</option>
                      <option value="deepseek-chat">DeepSeek-V3 (Lightweight)</option>
                    </optgroup>
                    <optgroup label="Google Gemini">
                      <option value="gemini-3.7-flash">Gemini 3.7 Flash (Agentic Workhorse)</option>
                      <option value="gemini-3.8-flash">Gemini 3.8 Flash (Sub-second Agentic)</option>
                    </optgroup>
                    <optgroup label="Anthropic Claude">
                      <option value="claude-3-5-haiku">Claude 3.5 Haiku (Fast Sub-agent)</option>
                    </optgroup>
                    <optgroup label="OpenAI / Codex">
                      <option value="gpt-5.4-mini">GPT-5.4 Mini (Subagents & Fast Coding)</option>
                      <option value="o3-mini">o3-mini (STEM Reasoning)</option>
                      <option value="gpt-4.1-mini">GPT-4.1 Mini (Fast Lightweight)</option>
                      <option value="gpt-4o-mini">GPT-4o Mini (Cost Efficient)</option>
                    </optgroup>
                  </select>
                  <div className="text-[10.5px] font-mono text-onedark-muted/80 truncate">
                    Allocated for qa_research, titles, greetings
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 1. Unified Ecosystem & Connected Provider Services */}
        {(activeTab === 'all' || activeTab === 'providers') && filteredUnifiedServices.length > 0 && (
          <div className="space-y-3.5">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold text-onedark-muted uppercase tracking-wider flex items-center space-x-2 font-mono">
                <PlugZap className="w-4 h-4 text-onedark-accent" />
                <span>Connected Services & Tool Capabilities ({filteredUnifiedServices.length})</span>
              </h2>
              <span className="text-xs text-onedark-muted font-mono flex items-center space-x-1">
                <Lock className="w-3 h-3 text-onedark-accent" />
                <span>Encrypted at rest with AES-256 Vault</span>
              </span>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {filteredUnifiedServices.map((item) => {
                const isIngrations = item.id === 'ingrations';
                const isConfigured = item.configured;

                return (
                  <div
                    key={item.id}
                    className="p-5 rounded-xl bg-onedark-darker/90 hover:bg-onedark-surface/30 border border-onedark-border hover:border-onedark-borderSubtle space-y-4 shadow-sm transition-all flex flex-col justify-between overflow-hidden"
                  >
                    <div className="space-y-2.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start space-x-3 min-w-0 flex-1">
                          <div className={`p-2.5 rounded-xl border shrink-0 ${getProviderBadgeTheme(item.id)}`}>
                            {getProviderIcon(item.id)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                              <h3 className="text-sm font-bold text-onedark-fgBright truncate" title={item.name}>
                                {item.name}
                              </h3>
                              {item.category && (
                                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-onedark-surface text-onedark-muted border border-onedark-borderSubtle shrink-0">
                                  {item.category}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center space-x-1.5 mt-1 text-[11px] font-mono text-onedark-muted min-w-0">
                              <span className="text-onedark-accent truncate max-w-[170px]" title={item.path}>
                                {item.path}
                              </span>
                              <span className="text-onedark-borderSubtle shrink-0">•</span>
                              <span className="truncate flex-1 min-w-0" title={item.auth_type}>
                                {item.auth_type}
                              </span>
                            </div>
                          </div>
                        </div>

                        {(() => {
                          const enabledSkillsCount = item.skills.filter((s) => !isToolDisabled(s)).length;
                          const totalSkillsCount = item.skills.length;
                          const allSkillsDisabled = totalSkillsCount > 0 && enabledSkillsCount === 0;
                          const partialSkillsEnabled = enabledSkillsCount > 0 && enabledSkillsCount < totalSkillsCount;

                          return (
                            <div className="shrink-0 pt-0.5">
                              {isIngrations ? (
                                allSkillsDisabled ? (
                                  <span className="px-2.5 py-1 rounded-full text-xs font-mono bg-rose-100 text-rose-950 border border-rose-300 dark:bg-rose-500/15 dark:text-rose-400 dark:border-rose-500/30 flex items-center space-x-1.5 font-bold whitespace-nowrap" title="All engine capabilities paused">
                                    <Power className="w-3.5 h-3.5 text-rose-700 dark:text-rose-400 shrink-0" />
                                    <span>Engine Paused</span>
                                  </span>
                                ) : partialSkillsEnabled ? (
                                  <span className="px-2.5 py-1 rounded-full text-xs font-mono bg-cyan-100 text-cyan-950 border border-cyan-300 dark:bg-cyan-500/15 dark:text-cyan-400 dark:border-cyan-500/30 flex items-center space-x-1.5 font-bold whitespace-nowrap">
                                    <CheckCircle2 className="w-3.5 h-3.5 text-cyan-700 dark:text-cyan-400 shrink-0" />
                                    <span>Engine ({enabledSkillsCount}/{totalSkillsCount})</span>
                                  </span>
                                ) : (
                                  <span className="px-2.5 py-1 rounded-full text-xs font-mono bg-cyan-100 text-cyan-950 border border-cyan-300 dark:bg-cyan-500/15 dark:text-cyan-400 dark:border-cyan-500/30 flex items-center space-x-1.5 font-bold whitespace-nowrap">
                                    <CheckCircle2 className="w-3.5 h-3.5 text-cyan-700 dark:text-cyan-400 shrink-0" />
                                    <span>Built-in Engine</span>
                                  </span>
                                )
                              ) : isConfigured ? (
                                allSkillsDisabled ? (
                                  <span 
                                    className="px-2.5 py-1 rounded-full text-xs font-mono bg-rose-100 text-rose-950 border border-rose-300 dark:bg-rose-500/15 dark:text-rose-400 dark:border-rose-500/30 flex items-center space-x-1.5 font-bold whitespace-nowrap"
                                    title="All capabilities paused for this service"
                                  >
                                    <Power className="w-3.5 h-3.5 text-rose-700 dark:text-rose-400 shrink-0" />
                                    <span>Service Paused</span>
                                  </span>
                                ) : partialSkillsEnabled ? (
                                  <span 
                                    className="px-2.5 py-1 rounded-full text-xs font-mono bg-amber-100 text-amber-950 border border-amber-300 dark:bg-onedark-yellow/15 dark:text-onedark-yellow dark:border-onedark-yellow/30 flex items-center space-x-1.5 font-bold whitespace-nowrap"
                                    title="Some capabilities paused"
                                  >
                                    <CheckCircle2 className="w-3.5 h-3.5 text-amber-700 dark:text-onedark-yellow shrink-0" />
                                    <span>Ready ({enabledSkillsCount}/{totalSkillsCount})</span>
                                  </span>
                                ) : (
                                  <span 
                                    className="px-2.5 py-1 rounded-full text-xs font-mono bg-emerald-100 text-emerald-950 border border-emerald-300 dark:bg-onedark-green/15 dark:text-onedark-green dark:border-onedark-green/30 flex items-center space-x-1.5 font-bold whitespace-nowrap"
                                    title="Encrypted in AES-256 Vault and provisioned to agent runtime"
                                  >
                                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 dark:text-onedark-green shrink-0" />
                                    <span>Mounted & Ready</span>
                                  </span>
                                )
                              ) : (
                                <span className="px-2.5 py-1 rounded-full text-xs font-mono bg-amber-100 text-amber-950 border border-amber-300 dark:bg-onedark-yellow/15 dark:text-onedark-yellow dark:border-onedark-yellow/30 flex items-center space-x-1.5 font-bold whitespace-nowrap">
                                  <Key className="w-3.5 h-3.5 text-amber-700 dark:text-onedark-yellow shrink-0" />
                                  <span>Key Not Set</span>
                                </span>
                              )}
                            </div>
                          );
                        })()}
                      </div>

                      <p className="text-xs text-onedark-fg/90 leading-relaxed font-normal">
                        {item.description}
                      </p>
                    </div>

                    <div className="pt-3 border-t border-onedark-borderSubtle flex flex-col space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                          <span className="text-[11px] font-mono text-onedark-muted uppercase tracking-wider font-semibold">
                            Capabilities ({item.skills.filter((s) => !isToolDisabled(s)).length}/{item.skills.length})
                          </span>
                          {item.skills.length > 1 && (
                            <div className="flex items-center space-x-1 text-[10px] font-mono text-onedark-muted/80 bg-onedark-surface/60 px-1.5 py-0.5 rounded border border-onedark-borderSubtle/60">
                              <button
                                type="button"
                                onClick={() => handleBatchCapabilities(item.skills, 'all_on')}
                                className="hover:text-onedark-accent transition-colors font-medium cursor-pointer"
                                title="Enable all capabilities for this service"
                              >
                                All On
                              </button>
                              <span className="text-onedark-borderSubtle">•</span>
                              <button
                                type="button"
                                onClick={() => handleBatchCapabilities(item.skills, 'read_only')}
                                className="hover:text-onedark-accent transition-colors font-medium cursor-pointer"
                                title="Enable read-only tools, pause write/action tools"
                              >
                                Read-Only
                              </button>
                              <span className="text-onedark-borderSubtle">•</span>
                              <button
                                type="button"
                                onClick={() => handleBatchCapabilities(item.skills, 'all_off')}
                                className="hover:text-onedark-accent transition-colors font-medium cursor-pointer"
                                title="Pause all capabilities for this service"
                              >
                                All Off
                              </button>
                            </div>
                          )}
                        </div>

                        {isIngrations ? (
                          <button
                            onClick={() => handleOpenConfig(item)}
                            className="px-3.5 py-1.5 rounded-lg bg-onedark-surface hover:bg-onedark-border text-onedark-fgBright text-xs font-mono font-semibold flex items-center space-x-1.5 transition-colors border border-onedark-border cursor-pointer shrink-0 shadow-xs active:scale-95"
                          >
                            <PlugZap className="w-3.5 h-3.5 text-cyan-400" />
                            <span>Engine Info</span>
                          </button>
                        ) : (
                          <button
                            onClick={() => handleOpenConfig(item)}
                            className={`px-3.5 py-1.5 rounded-lg text-xs font-mono font-semibold flex items-center space-x-1.5 transition-all cursor-pointer shrink-0 shadow-xs active:scale-95 ${
                              isConfigured
                                ? 'bg-onedark-surface hover:bg-onedark-border text-onedark-fgBright border border-onedark-border'
                                : 'bg-onedark-accent text-onedark-darker hover:bg-onedark-accent/90 border border-onedark-accent font-bold shadow-sm'
                            }`}
                          >
                            <Settings className="w-3.5 h-3.5" />
                            <span>{isConfigured ? 'Update Key' : 'Configure Key'}</span>
                          </button>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-1.5 min-w-0">
                        {item.skills.map((s) => {
                          const disabled = isToolDisabled(s);
                          const isToggling = togglingCap === s;
                          return (
                            <button
                              key={s}
                              type="button"
                              onClick={() => handleToggleCapability(s)}
                              disabled={isToggling}
                              title={disabled ? `Click to enable capability: ${s}` : `Click to disable capability: ${s}`}
                              className={`group inline-flex items-center space-x-1.5 px-2 py-0.5 rounded text-[11px] font-mono border transition-all cursor-pointer select-none active:scale-95 ${
                                disabled
                                  ? 'bg-onedark-darker/60 text-onedark-muted/60 border-onedark-borderSubtle/40 hover:border-onedark-muted/50 hover:text-onedark-fg line-through decoration-rose-500/50'
                                  : 'bg-onedark-surface text-onedark-fgBright/90 border-onedark-borderSubtle hover:border-onedark-accent/50 hover:text-onedark-fgBright'
                              }`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full shrink-0 transition-colors ${
                                  disabled
                                    ? 'bg-rose-500/60'
                                    : 'bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.6)]'
                                }`}
                              />
                              <span className={disabled ? 'opacity-70' : ''}>{s}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 2. Built-in Workspace Skills Catalog (No External Credentials Required) */}
        {(activeTab === 'all' || activeTab === 'skills') && filteredWorkspaceSkills.length > 0 && (
          <div className="space-y-3.5">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold text-onedark-muted uppercase tracking-wider flex items-center space-x-2 font-mono">
                <Sparkles className="w-4 h-4 text-onedark-accent" />
                <span>Built-in Workspace Skills ({filteredWorkspaceSkills.length})</span>
              </h2>
              <span className="text-xs text-onedark-muted font-mono">Autonomous local runtime capabilities</span>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {filteredWorkspaceSkills.map((skill) => (
                <div
                  key={skill.id}
                  className="p-5 rounded-xl bg-onedark-darker/90 hover:bg-onedark-surface/30 border border-onedark-border hover:border-onedark-borderSubtle transition-all flex flex-col justify-between space-y-3 shadow-sm overflow-hidden"
                >
                  <div className="space-y-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start space-x-3 min-w-0 flex-1">
                        <div className="p-2.5 rounded-xl border bg-cyan-100 border-cyan-300 text-cyan-950 dark:bg-cyan-500/10 dark:border-cyan-500/30 dark:text-cyan-400 shrink-0">
                          {getWorkspaceSkillIcon(skill.id)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                            <h3 className="text-sm font-bold text-onedark-fgBright truncate" title={skill.name}>
                              {skill.name}
                            </h3>
                            {skill.category && (
                              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-onedark-surface text-onedark-muted border border-onedark-borderSubtle shrink-0">
                                {skill.category}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-onedark-accent font-mono mt-0.5 truncate" title={skill.path}>
                            {skill.path}
                          </div>
                        </div>
                      </div>

                      {(() => {
                        const enabledToolsCount = skill.tools.filter((t) => !isToolDisabled(t)).length;
                        const totalToolsCount = skill.tools.length;
                        const allToolsDisabled = totalToolsCount > 0 && enabledToolsCount === 0;
                        const partialToolsEnabled = enabledToolsCount > 0 && enabledToolsCount < totalToolsCount;

                        return (
                          <div className="shrink-0 pt-0.5">
                            {allToolsDisabled ? (
                              <span className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-bold border shrink-0 bg-rose-100 text-rose-950 border-rose-300 dark:bg-rose-500/15 dark:text-rose-400 dark:border-rose-500/30 whitespace-nowrap" title="All tools paused for this skill">
                                <Power className="w-3.5 h-3.5 text-rose-700 dark:text-rose-400 shrink-0" />
                                <span>Skill Paused</span>
                              </span>
                            ) : partialToolsEnabled ? (
                              <span className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-bold border shrink-0 bg-amber-100 text-amber-950 border-amber-300 dark:bg-onedark-yellow/15 dark:text-onedark-yellow dark:border-onedark-yellow/30 whitespace-nowrap" title="Some tools paused">
                                <CheckCircle2 className="w-3.5 h-3.5 text-amber-700 dark:text-onedark-yellow shrink-0" />
                                <span>Ready ({enabledToolsCount}/{totalToolsCount})</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-bold border shrink-0 bg-emerald-100 text-emerald-950 border-emerald-300 dark:bg-onedark-green/15 dark:text-onedark-green dark:border-onedark-green/30 whitespace-nowrap">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 dark:text-onedark-green shrink-0" />
                                <span>Mounted & Ready</span>
                              </span>
                            )}
                          </div>
                        );
                      })()}
                    </div>

                    <p className="text-xs text-onedark-fg/90 leading-relaxed font-normal">
                      {skill.description}
                    </p>
                  </div>

                  <div className="pt-3 border-t border-onedark-borderSubtle flex flex-col space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-mono text-onedark-muted uppercase tracking-wider font-semibold">
                        Tools ({skill.tools.filter((t) => !isToolDisabled(t)).length}/{skill.tools.length})
                      </span>
                      {skill.tools.length > 1 && (
                        <div className="flex items-center space-x-1 text-[10px] font-mono text-onedark-muted/80 bg-onedark-surface/60 px-1.5 py-0.5 rounded border border-onedark-borderSubtle/60">
                          <button
                            type="button"
                            onClick={() => handleBatchCapabilities(skill.tools, 'all_on')}
                            className="hover:text-onedark-accent transition-colors font-medium cursor-pointer"
                            title="Enable all tools in skill"
                          >
                            All On
                          </button>
                          <span className="text-onedark-borderSubtle">•</span>
                          <button
                            type="button"
                            onClick={() => handleBatchCapabilities(skill.tools, 'read_only')}
                            className="hover:text-onedark-accent transition-colors font-medium cursor-pointer"
                            title="Enable read-only tools"
                          >
                            Read-Only
                          </button>
                          <span className="text-onedark-borderSubtle">•</span>
                          <button
                            type="button"
                            onClick={() => handleBatchCapabilities(skill.tools, 'all_off')}
                            className="hover:text-onedark-accent transition-colors font-medium cursor-pointer"
                            title="Pause all tools in skill"
                          >
                            All Off
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-1.5 min-w-0">
                      {skill.tools.map((t) => {
                        const disabled = isToolDisabled(t);
                        const isToggling = togglingCap === t;
                        return (
                          <button
                            key={t}
                            type="button"
                            onClick={() => handleToggleCapability(t)}
                            disabled={isToggling}
                            title={disabled ? `Click to enable capability: ${t}` : `Click to disable capability: ${t}`}
                            className={`group inline-flex items-center space-x-1.5 px-2 py-0.5 rounded text-[11px] font-mono border transition-all cursor-pointer select-none active:scale-95 ${
                              disabled
                                ? 'bg-onedark-darker/60 text-onedark-muted/60 border-onedark-borderSubtle/40 hover:border-onedark-muted/50 hover:text-onedark-fg line-through decoration-rose-500/50'
                                : 'bg-onedark-surface text-onedark-fgBright/90 border-onedark-borderSubtle hover:border-onedark-accent/50 hover:text-onedark-fgBright'
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full shrink-0 transition-colors ${
                                disabled
                                  ? 'bg-rose-500/60'
                                  : 'bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.6)]'
                              }`}
                            />
                            <span className={disabled ? 'opacity-70' : ''}>{t}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))}
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
                    className="p-5 rounded-xl bg-onedark-darker/90 hover:bg-onedark-surface/30 border border-onedark-border hover:border-onedark-borderSubtle space-y-3.5 flex flex-col justify-between shadow-sm transition-all overflow-hidden"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <h4 className="text-sm font-bold text-onedark-fgBright truncate min-w-0 flex-1" title={ep.name}>
                          {ep.name}
                        </h4>
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
        {filteredUnifiedServices.length === 0 && filteredWorkspaceSkills.length === 0 && filteredGateways.length === 0 && (
          <div className="p-12 text-center border border-dashed border-onedark-border rounded-2xl bg-onedark-darker/90 space-y-3.5">
            <PlugZap className="w-10 h-10 text-onedark-muted mx-auto opacity-50" />
            <h3 className="text-sm font-bold text-onedark-fgBright">No matching resources found</h3>
            <p className="text-xs text-onedark-muted max-w-sm mx-auto">
              No service, skill, or gateway matched &ldquo;{searchQuery}&rdquo;. Try clearing your search.
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
              {selectedIntegration.id === 'ingrations' ? (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-onedark-surface/60 border border-onedark-borderSubtle space-y-2.5">
                    <div className="flex items-center space-x-2 text-sm font-bold text-onedark-fgBright">
                      <Sparkles className="w-4 h-4 text-cyan-400" />
                      <span>Built-in Open-Source Tool Engine</span>
                    </div>
                    <p className="text-xs text-onedark-fg/90 leading-relaxed">
                      <strong>Ingrations</strong> is Cyclode&apos;s universal tool catalog and execution engine. It is installed as a local Python package (<code className="text-cyan-400 font-mono">ingrations&gt;=0.1.0</code>) and executes tools natively inside your environment.
                    </p>
                    <div className="p-2.5 rounded-lg bg-onedark-bg border border-onedark-borderSubtle text-xs text-onedark-fgBright flex items-center space-x-2">
                      <CheckCircle2 className="w-4 h-4 text-onedark-green shrink-0" />
                      <span><strong>No Master API Key Needed:</strong> Ingrations does not require an account, token, or subscription.</span>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-onedark-surface/40 border border-onedark-borderSubtle space-y-2.5">
                    <h4 className="text-xs font-mono font-bold text-onedark-fgBright uppercase tracking-wider flex items-center space-x-1.5">
                      <Key className="w-3.5 h-3.5 text-onedark-accent" />
                      <span>How Authentication Works</span>
                    </h4>
                    <p className="text-xs text-onedark-fg/80 leading-relaxed">
                      Instead of a single global key, you configure API tokens for each individual external provider (e.g. <strong>Jira</strong>, <strong>Stripe</strong>, <strong>Notion</strong>, <strong>AWS</strong>, <strong>GitHub</strong>) in their dedicated cards below. Ingrations dynamically routes your saved credentials when executing actions.
                    </p>
                    <div className="grid grid-cols-2 gap-2 pt-1 font-mono text-[11px] text-onedark-muted">
                      <div className="p-2 rounded bg-onedark-bg border border-onedark-borderSubtle">
                        <div className="text-onedark-fgBright font-bold">16 Supported Apps</div>
                        <div>DevTools, Cloud, CRM, etc.</div>
                      </div>
                      <div className="p-2 rounded bg-onedark-bg border border-onedark-borderSubtle">
                        <div className="text-onedark-fgBright font-bold">74 Pre-built Actions</div>
                        <div>FTS5 BM25 Auto-Discovery</div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <>
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
                     selectedIntegration.id === 'deepseek' ? 'DeepSeek API Key (sk-...)' :
                     selectedIntegration.id === 'anthropic' ? 'Anthropic API Key (sk-ant-...)' :
                     selectedIntegration.id === 'openai' ? 'OpenAI API Key (sk-...)' :
                     selectedIntegration.id === 'linear' ? 'Linear API Key / Personal API Key (lin_api_...)' :
                     selectedIntegration.id === 'sentry' ? 'Sentry Auth Token' :
                     selectedIntegration.id === 'jira' ? 'Atlassian Email : API Token (user@company.com:ATATT3...)' :
                     selectedIntegration.id === 'gitlab' ? 'GitLab Personal Access Token (glpat-...)' :
                     selectedIntegration.id === 'notion' ? 'Notion Integration Secret (secret_...)' :
                     selectedIntegration.id === 'stripe' ? 'Stripe Secret / Restricted Key (sk_... / rk_...)' :
                     selectedIntegration.id === 'aws' ? 'AWS Access Key ID : Secret Access Key' :
                     selectedIntegration.id === 'supabase' ? 'Supabase Service Role / Anon API Key' :
                     selectedIntegration.id === 'cloudflare' ? 'Cloudflare API Token' :
                     selectedIntegration.id === 'datadog' ? 'Datadog API Key' :
                     selectedIntegration.id === 'discord' ? 'Discord Bot Token / Webhook URL' :
                     selectedIntegration.id === 'hubspot' ? 'HubSpot Private App Token (pat-na1-...)' :
                     selectedIntegration.id === 'salesforce' ? 'Salesforce OAuth Access Token' :
                     selectedIntegration.id === 'google_workspace' ? 'Google Workspace Token / Key' :
                     `${selectedIntegration.name} API Key / Token`}
                  </span>
                  {selectedIntegration.configured ? (
                    <span className="text-[10.5px] font-mono text-emerald-400">Encrypted in Vault</span>
                  ) : (
                    <span className="text-[10.5px] font-mono text-onedark-accent">Required</span>
                  )}
                </label>
                <input
                  type="password"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder={
                    selectedIntegration.configured
                      ? '•••••••••••• (Active in Vault - leave blank to keep)'
                      : (
                        selectedIntegration.id === 'github' ? 'ghp_xxxxxxxxxxxxxxxxxxxx' :
                        selectedIntegration.id === 'slack' ? 'xoxb-xxxxxxxxxxxxxxxxxxxx' :
                        selectedIntegration.id === 'gemini' ? 'AIzaSyxxxxxxxxxxxxxxxxxxxx' :
                        selectedIntegration.id === 'deepseek' ? 'sk-xxxxxxxxxxxxxxxxxxxx' :
                        selectedIntegration.id === 'anthropic' ? 'sk-ant-xxxxxxxxxxxxxxxxxxxx' :
                        selectedIntegration.id === 'openai' ? 'sk-xxxxxxxxxxxxxxxxxxxx' :
                        selectedIntegration.id === 'linear' ? 'lin_api_xxxxxxxxxxxxxxxxxxxx' :
                        selectedIntegration.id === 'sentry' ? 'sntrys_xxxxxxxxxxxxxxxxxxxx' :
                        selectedIntegration.id === 'jira' ? 'user@company.com:ATATT3xFfGF0...' :
                        selectedIntegration.id === 'gitlab' ? 'glpat-xxxxxxxxxxxxxxxxxxxx' :
                        selectedIntegration.id === 'notion' ? 'secret_xxxxxxxxxxxxxxxxxxxx' :
                        selectedIntegration.id === 'stripe' ? 'sk_live_xxxxxxxxxxxxxxxxxxxx' :
                        selectedIntegration.id === 'hubspot' ? 'pat-na1-xxxxxxxxxxxxxxxxxxxx' :
                        selectedIntegration.id === 'cloudflare' ? 'v1.0-xxxxxxxxxxxxxxxxxxxx' :
                        selectedIntegration.id === 'aws' ? 'AKIAIOSFODNN7EXAMPLE:wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' :
                        selectedIntegration.id === 'supabase' ? 'eyJhbGciOiJIUzI1NiIsInR5cCI...' :
                        'Enter secret key...'
                      )
                  }
                  className="w-full px-3.5 py-2.5 rounded-lg bg-onedark-bg border border-onedark-border text-xs text-onedark-fgBright font-mono focus:outline-none focus:border-onedark-accent shadow-xs"
                  autoFocus
                />
                {selectedIntegration.id === 'jira' && (
                  <p className="text-[11px] text-onedark-muted leading-relaxed pt-1">
                    Format: <code className="text-onedark-fgBright font-mono">user@company.com:api_token</code>. Generate your API token from Atlassian Account Settings &rarr; Security &rarr; Create API token. Ingrations automatically base64-encodes this as Basic Auth.
                  </p>
                )}
              </div>

              {/* Optional Default Model Configuration for AI Providers */}
              {(selectedIntegration.id === 'gemini' || selectedIntegration.id === 'deepseek' || selectedIntegration.id === 'anthropic' || selectedIntegration.id === 'openai') && (
                <div className="space-y-2 pt-2 border-t border-onedark-borderSubtle">
                  <label className="text-xs font-mono font-semibold text-onedark-fgBright flex items-center justify-between">
                    <span>Default Model</span>
                    <span className="text-[10.5px] font-mono text-onedark-muted">Optional Override</span>
                  </label>
                  {selectedIntegration.id === 'gemini' && (
                    <select
                      value={modelInput}
                      onChange={(e) => setModelInput(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-lg bg-onedark-bg border border-onedark-border text-xs text-onedark-fgBright font-mono focus:outline-none focus:border-onedark-accent cursor-pointer"
                    >
                      <option value="gemini-3.7-flash">Gemini 3.7 Flash (Default / Agentic Workhorse)</option>
                      <option value="gemini-3.8-flash">Gemini 3.8 Flash (Sub-second Agentic)</option>
                    </select>
                  )}
                  {selectedIntegration.id === 'deepseek' && (
                    <select
                      value={modelInput}
                      onChange={(e) => setModelInput(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-lg bg-onedark-bg border border-onedark-border text-xs text-onedark-fgBright font-mono focus:outline-none focus:border-onedark-accent cursor-pointer"
                    >
                      <option value="deepseek-flash">DeepSeek-V4.1-Flash (Default / 552B MoE / 1M Context)</option>
                      <option value="deepseek-v4-pro">DeepSeek-V4-Pro (High Capacity Frontier)</option>
                      <option value="deepseek-chat">DeepSeek-V3 (General Agentic)</option>
                      <option value="deepseek-reasoner">DeepSeek-R1 (Hybrid CoT)</option>
                    </select>
                  )}
                  {selectedIntegration.id === 'anthropic' && (
                    <select
                      value={modelInput}
                      onChange={(e) => setModelInput(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-lg bg-onedark-bg border border-onedark-border text-xs text-onedark-fgBright font-mono focus:outline-none focus:border-onedark-accent cursor-pointer"
                    >
                      <option value="claude-fable-5-1">Claude Fable 5.1 (Default / Mythos Frontier)</option>
                      <option value="claude-3-7-sonnet">Claude 3.7 Sonnet (Thinking)</option>
                      <option value="claude-3-5-sonnet">Claude 3.5 Sonnet</option>
                      <option value="claude-3-5-haiku">Claude 3.5 Haiku (Fast)</option>
                    </select>
                  )}
                  {selectedIntegration.id === 'openai' && (
                    <select
                      value={modelInput}
                      onChange={(e) => setModelInput(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-lg bg-onedark-bg border border-onedark-border text-xs text-onedark-fgBright font-mono focus:outline-none focus:border-onedark-accent cursor-pointer"
                    >
                      <option value="gpt-6-astra">GPT-6 Astra (Default / Flagship Autonomous)</option>
                      <option value="gpt-6.1-sol">GPT-6.1 Sol (Near-Astra Complex Work)</option>
                      <option value="gpt-6-sol">GPT-6 Sol (Agentic Coding)</option>
                      <option value="gpt-5.6-sol">GPT-5.6 Sol (Flagship Professional)</option>
                      <option value="gpt-5.4-mini">GPT-5.4 Mini (Subagents & Coding)</option>
                      <option value="gpt-5.3-codex">GPT-5.3 Codex (Agentic Coding Frontier)</option>
                      <option value="o3-pro">o3-pro (High-Compute Reasoning)</option>
                      <option value="o3">o3 (Frontier Reasoning)</option>
                      <option value="o3-mini">o3-mini (STEM Reasoning)</option>
                      <option value="gpt-4.1">GPT-4.1 (Smartest General)</option>
                      <option value="gpt-4.1-mini">GPT-4.1 Mini (Fast Lightweight)</option>
                      <option value="gpt-4o">GPT-4o (Omni Multimodal)</option>
                      <option value="gpt-4o-mini">GPT-4o Mini (Cost Efficient)</option>
                      <option value="codex">Codex / GPT-5.3</option>
                    </select>
                  )}
                </div>
              )}

              {/* Custom Base URL for OpenAI and DeepSeek */}
              {(selectedIntegration.id === 'openai' || selectedIntegration.id === 'deepseek') && (
                <div className="space-y-2 pt-1">
                  <label className="text-xs font-mono font-semibold text-onedark-fgBright flex items-center justify-between">
                    <span>{selectedIntegration.id === 'deepseek' ? 'DeepSeek API Base URL' : 'OpenAI API Base URL'}</span>
                    <span className="text-[10.5px] font-mono text-onedark-muted">Custom Endpoint</span>
                  </label>
                  <input
                    type="text"
                    value={baseUrlInput}
                    onChange={(e) => setBaseUrlInput(e.target.value)}
                    placeholder={selectedIntegration.id === 'deepseek' ? 'https://api.deepseek.com' : 'https://api.openai.com/v1'}
                    className="w-full px-3.5 py-2 rounded-lg bg-onedark-bg border border-onedark-border text-xs text-onedark-fgBright font-mono focus:outline-none focus:border-onedark-accent shadow-xs"
                  />
                  <p className="text-[11px] text-onedark-muted">
                    {selectedIntegration.id === 'deepseek'
                      ? 'Supports official DeepSeek endpoint, proxy gateways, or enterprise clusters.'
                      : 'Supports custom LLM gateways, OpenRouter, Together AI, or local Ollama endpoints.'}
                  </p>
                </div>
              )}

              {/* Atlassian / Jira Cloud Domain configuration */}
              {selectedIntegration.id === 'jira' && (
                <div className="space-y-2 pt-1">
                  <label className="text-xs font-mono font-semibold text-onedark-fgBright flex items-center justify-between">
                    <span>Atlassian Cloud Subdomain / Host</span>
                    <span className="text-[10.5px] font-mono text-onedark-accent">Required</span>
                  </label>
                  <input
                    type="text"
                    value={baseUrlInput}
                    onChange={(e) => setBaseUrlInput(e.target.value)}
                    placeholder="e.g. yourcompany.atlassian.net"
                    className="w-full px-3.5 py-2 rounded-lg bg-onedark-bg border border-onedark-border text-xs text-onedark-fgBright font-mono focus:outline-none focus:border-onedark-accent shadow-xs"
                  />
                  <p className="text-[11px] text-onedark-muted">
                    Your Atlassian Cloud instance domain (e.g. <code className="text-onedark-fgBright">acme.atlassian.net</code>). Agents query <code className="text-onedark-fgBright">https://[domain]/rest/api/3/...</code>.
                  </p>
                </div>
              )}

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
                </>
              )}
            </div>

            <div className="p-4 bg-onedark-surface/30 border-t border-onedark-border flex items-center justify-between">
              <span className="text-xs font-mono text-onedark-muted flex items-center space-x-1.5">
                <Lock className="w-3.5 h-3.5 text-onedark-accent" />
                <span>AES-256 Encrypted</span>
              </span>
              <div className="flex items-center space-x-2.5">
                {selectedIntegration.id === 'ingrations' ? (
                  <button
                    onClick={() => setSelectedIntegration(null)}
                    className="px-4 py-1.5 rounded-lg bg-onedark-accent hover:bg-onedark-accent/90 text-onedark-darker text-xs font-mono font-bold transition-all cursor-pointer shadow-xs active:scale-95"
                  >
                    Close & Browse Providers
                  </button>
                ) : (
                  <>
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
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
