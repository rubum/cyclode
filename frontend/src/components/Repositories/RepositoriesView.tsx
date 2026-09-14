import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  FolderGit2, 
  Plus, 
  GitBranch, 
  ShieldCheck, 
  Key, 
  CheckCircle2, 
  AlertCircle, 
  Trash2, 
  RefreshCw, 
  Terminal, 
  ExternalLink, 
  Play, 
  Sparkles,
  Edit2,
  X,
  Radio,
  Zap,
  Copy,
  Check,
  Search,
  LayoutGrid,
  List,
  ChevronDown,
  ChevronUp,
  ArrowLeft
} from 'lucide-react';
import { RepositoryConfig } from '../../types';
import { ConfirmModal } from '../Common/ConfirmModal';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface RepositoriesViewProps {
  onSelectRepoForChat?: (repoFullName: string) => void;
  onNavigateToInbox?: () => void;
  onBackToChat?: () => void;
  onRepositoriesChanged?: () => void;
}

export const RepositoriesView: React.FC<RepositoriesViewProps> = ({ 
  onSelectRepoForChat, 
  onNavigateToInbox,
  onBackToChat,
  onRepositoriesChanged
}) => {
  const [repositories, setRepositories] = useState<RepositoryConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingRepo, setEditingRepo] = useState<RepositoryConfig | null>(null);

  // Deletion Confirmation Modal State
  const [deleteModalState, setDeleteModalState] = useState<{
    isOpen: boolean;
    type: 'single' | 'all';
    repo?: RepositoryConfig;
    isDeleting?: boolean;
  }>({
    isOpen: false,
    type: 'single',
  });

  // Search, Status Filters & View Mode
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'connected' | 'auth_required' | 'webhook_active'>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [isBannerCollapsed, setIsBannerCollapsed] = useState(false);

  // Form State
  const [repoFullName, setRepoFullName] = useState('');
  const [repoToken, setRepoToken] = useState('');
  const [defaultBranch, setDefaultBranch] = useState('main');
  const [testCommand, setTestCommand] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [webhookActionId, setWebhookActionId] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{ id: string; success: boolean; message: string } | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [feedback, setFeedback] = useState<{ success?: boolean; message?: string } | null>(null);

  const [discovering, setDiscovering] = useState(false);

  // Close modal on ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isAddModalOpen) {
        setIsAddModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAddModalOpen]);

  const fetchRepositories = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/api/repositories`);
      if (res.ok) {
        const data = await res.json();
        setRepositories(data);
      }
    } catch (err) {
      console.error('Error loading repositories:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleDiscoverRepositories = async () => {
    setDiscovering(true);
    try {
      const res = await fetch(`${API_BASE}/api/repositories/discover`, {
        method: 'POST',
      });
      const data = await res.json();
      if (res.ok && data.repositories) {
        setRepositories(data.repositories);
        onRepositoriesChanged?.();
      }
    } catch (err) {
      console.error('Error discovering repositories:', err);
    } finally {
      setDiscovering(false);
    }
  };

  useEffect(() => {
    fetchRepositories();
  }, [fetchRepositories]);


  const handleOpenAdd = () => {
    setEditingRepo(null);
    setRepoFullName('');
    setRepoToken('');
    setDefaultBranch('main');
    setTestCommand('');
    setFeedback(null);
    setIsAddModalOpen(true);
  };

  const handleOpenEdit = (repo: RepositoryConfig) => {
    setEditingRepo(repo);
    setRepoFullName(repo.full_name);
    setRepoToken('');
    setDefaultBranch(repo.default_branch || 'main');
    setTestCommand(repo.test_command || '');
    setFeedback(null);
    setIsAddModalOpen(true);
  };

  const handleSaveRepository = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoFullName.trim()) return;

    setSubmitting(true);
    setFeedback(null);

    try {
      if (editingRepo) {
        const payload: Record<string, any> = {
          default_branch: defaultBranch.trim() || 'main',
          test_command: testCommand.trim() || undefined,
        };
        if (repoToken.trim()) {
          payload.token = repoToken.trim();
        }

        const res = await fetch(`${API_BASE}/api/repositories/${editingRepo.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        const data = await res.json();
        if (res.ok && data.ok) {
          setFeedback({ success: true, message: 'Repository updated and connectivity verified.' });
          await fetchRepositories();
          onRepositoriesChanged?.();
          setTimeout(() => setIsAddModalOpen(false), 800);
        } else {
          setFeedback({ success: false, message: data.detail || 'Failed to update repository.' });
        }
      } else {
        const payload = {
          full_name: repoFullName.trim(),
          token: repoToken.trim() || undefined,
          default_branch: defaultBranch.trim() || 'main',
          test_command: testCommand.trim() || undefined,
        };

        const res = await fetch(`${API_BASE}/api/repositories`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        const data = await res.json();
        if (res.ok && data.ok) {
          setFeedback({
            success: true,
            message: data.validation?.message || 'Repository connected and saved to vault successfully.',
          });
          await fetchRepositories();
          onRepositoriesChanged?.();
          setTimeout(() => setIsAddModalOpen(false), 900);
        } else {
          setFeedback({
            success: false,
            message: data.validation?.message || data.detail || 'Failed to save repository.',
          });
        }
      }
    } catch (err: any) {
      setFeedback({ success: false, message: err.message || 'Server communication error.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleTestConnection = async (repoId: string) => {
    setTestingId(repoId);
    try {
      const res = await fetch(`${API_BASE}/api/repositories/${repoId}/test-connection`, {
        method: 'POST',
      });
      const data = await res.json();
      if (res.ok) {
        await fetchRepositories();
        onRepositoriesChanged?.();
      }
    } catch (err) {
      console.error('Error testing connection:', err);
    } finally {
      setTestingId(null);
    }
  };

  const handlePromptDeleteRepo = (repo: RepositoryConfig) => {
    setDeleteModalState({
      isOpen: true,
      type: 'single',
      repo,
      isDeleting: false,
    });
  };

  const handlePromptClearAll = () => {
    setDeleteModalState({
      isOpen: true,
      type: 'all',
      isDeleting: false,
    });
  };

  const handleConfirmDelete = async () => {
    setDeleteModalState((prev) => ({ ...prev, isDeleting: true }));
    try {
      if (deleteModalState.type === 'single' && deleteModalState.repo) {
        const repoId = deleteModalState.repo.id;
        const res = await fetch(`${API_BASE}/api/repositories/${repoId}`, {
          method: 'DELETE',
        });
        if (res.ok) {
          setRepositories((prev) => prev.filter((r) => r.id !== repoId));
          onRepositoriesChanged?.();
        }
      } else if (deleteModalState.type === 'all') {
        const res = await fetch(`${API_BASE}/api/repositories`, {
          method: 'DELETE',
        });
        if (res.ok) {
          setRepositories([]);
          onRepositoriesChanged?.();
        }
      }
    } catch (err) {
      console.error('Error deleting repo(s):', err);
    } finally {
      setDeleteModalState({ isOpen: false, type: 'single' });
    }
  };

  const handleInstallWebhook = async (repoId: string) => {
    setWebhookActionId(repoId);
    setActionFeedback(null);
    try {
      const webhookUrl = `${window.location.protocol}//${window.location.hostname}:8000/api/webhooks/github`;
      const res = await fetch(`${API_BASE}/api/repositories/${repoId}/install-webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhook_url: webhookUrl }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setActionFeedback({
          id: repoId,
          success: true,
          message: data.message || 'Webhook listener registered on GitHub successfully!',
        });
        await fetchRepositories();
      } else {
        let msg = data.message || data.detail || 'Failed to install webhook listener.';
        if (typeof msg === 'string' && (msg.includes('localhost') || msg.includes('127.0.0.1') || msg.includes('public Internet'))) {
          msg = `GitHub requires a publicly reachable URL and rejected 'localhost'. For local testing, click the '⚡ Simulate' button to trigger events offline, or expose port 8000 via ngrok / Cloudflare Tunnel.`;
        }
        setActionFeedback({
          id: repoId,
          success: false,
          message: msg,
        });
      }
    } catch (err: any) {
      setActionFeedback({
        id: repoId,
        success: false,
        message: err.message || 'Communication error with GitHub API.',
      });
    } finally {
      setWebhookActionId(null);
    }
  };

  const handleSimulateEvent = async (repoId: string) => {
    setWebhookActionId(repoId);
    setActionFeedback(null);
    try {
      const res = await fetch(`${API_BASE}/api/repositories/${repoId}/simulate-event`, {
        method: 'POST',
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setActionFeedback({
          id: repoId,
          success: true,
          message: `Triggered pull_request.opened on ${data.result?.session_key || 'repo'}! Agent task #${data.result?.task_id?.slice(0, 8)} started.`,
        });
      } else {
        setActionFeedback({
          id: repoId,
          success: false,
          message: data.detail || 'Failed to dispatch simulated event.',
        });
      }
    } catch (err: any) {
      setActionFeedback({
        id: repoId,
        success: false,
        message: err.message || 'Failed to trigger simulated event.',
      });
    } finally {
      setWebhookActionId(null);
    }
  };

  const handleCopyWebhookUrl = () => {
    const url = `${window.location.protocol}//${window.location.hostname}:8000/api/webhooks/github`;
    navigator.clipboard.writeText(url);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  // Filtered & Searched Repositories
  const filteredRepositories = useMemo(() => {
    return repositories.filter((repo) => {
      // Status filter
      if (statusFilter === 'connected' && repo.status !== 'CONNECTED') return false;
      if (statusFilter === 'auth_required' && repo.status === 'CONNECTED') return false;
      if (statusFilter === 'webhook_active' && !repo.manifest_cache?.webhook_listener?.installed) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const nameMatch = repo.full_name.toLowerCase().includes(q);
        const branchMatch = (repo.default_branch || '').toLowerCase().includes(q);
        const urlMatch = (repo.clone_url || '').toLowerCase().includes(q);
        return nameMatch || branchMatch || urlMatch;
      }

      return true;
    });
  }, [repositories, statusFilter, searchQuery]);

  // Status Counts
  const counts = useMemo(() => {
    const total = repositories.length;
    const connected = repositories.filter((r) => r.status === 'CONNECTED').length;
    const authRequired = total - connected;
    const webhookActive = repositories.filter((r) => r.manifest_cache?.webhook_listener?.installed).length;
    return { total, connected, authRequired, webhookActive };
  }, [repositories]);

  return (
    <div className="h-full w-full flex flex-col min-h-0 overflow-y-auto px-6 pb-8 bg-onedark-bg font-sans text-onedark-fg">
      {/* Sticky Header with Navigation & Primary Actions */}
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

            <div>
              <h1 className="text-base font-bold text-onedark-fgBright flex items-center space-x-2">
                <FolderGit2 className="w-4 h-4 text-onedark-folder" />
                <span>Repository & Vault Manager</span>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-onedark-surface text-onedark-fgBright border border-onedark-border">
                  {repositories.length}
                </span>
              </h1>
              <p className="text-xs text-onedark-fg/70 mt-0.5">
                Persistent git access, encrypted tokens, and automated event listeners.
              </p>
            </div>
          </div>

          {/* Top Actions */}
          <div className="flex items-center space-x-2">
            {/* View Mode Toggle */}
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

            <button
              onClick={handleDiscoverRepositories}
              disabled={discovering}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-onedark-darker hover:bg-onedark-surface text-onedark-fgBright rounded-lg text-xs font-medium transition-all border border-onedark-border disabled:opacity-50 cursor-pointer"
              title="Scan task history and environment to auto-register repositories"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${discovering ? 'animate-spin text-onedark-accent' : 'text-onedark-accent'}`} />
              <span>{discovering ? 'Discovering...' : 'Discover Workspaces'}</span>
            </button>

            {repositories.length > 0 && (
              <button
                onClick={handlePromptClearAll}
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-onedark-darker hover:bg-onedark-red/15 text-onedark-muted hover:text-onedark-red rounded-lg text-xs font-medium transition-all border border-onedark-borderSubtle hover:border-onedark-red/30 cursor-pointer"
                title="Clear all repository configurations and credentials from local Vault"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear All</span>
              </button>
            )}

            <button
              onClick={handleOpenAdd}
              className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 bg-onedark-accent hover:bg-onedark-accent/90 text-onedark-darker rounded-lg text-xs font-bold transition-all shadow-sm active:scale-95 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>Connect Repository</span>
            </button>
          </div>
        </div>

        {/* Sticky Search & Filter Toolbar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-1">
          {/* Search Input */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-onedark-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search repositories by name, branch, or URL..."
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

          {/* Status Filter Chips */}
          <div className="flex items-center space-x-1.5 overflow-x-auto pb-0.5">
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all whitespace-nowrap border ${
                statusFilter === 'all'
                  ? 'bg-onedark-surface text-onedark-fgBright border-onedark-border shadow-xs'
                  : 'bg-onedark-darker/60 text-onedark-muted hover:text-onedark-fg border-transparent'
              }`}
            >
              All <span className="font-mono text-[10px] ml-1 opacity-70">({counts.total})</span>
            </button>

            <button
              onClick={() => setStatusFilter('connected')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all whitespace-nowrap border flex items-center space-x-1 ${
                statusFilter === 'connected'
                  ? 'bg-onedark-green/15 text-onedark-green border-onedark-green/30 shadow-xs'
                  : 'bg-onedark-darker/60 text-onedark-muted hover:text-onedark-green border-transparent'
              }`}
            >
              <CheckCircle2 className="w-3 h-3" />
              <span>Connected</span>
              <span className="font-mono text-[10px] ml-1 opacity-80">({counts.connected})</span>
            </button>

            <button
              onClick={() => setStatusFilter('auth_required')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all whitespace-nowrap border flex items-center space-x-1 ${
                statusFilter === 'auth_required'
                  ? 'bg-onedark-yellow/15 text-onedark-yellow border-onedark-yellow/30 shadow-xs'
                  : 'bg-onedark-darker/60 text-onedark-muted hover:text-onedark-yellow border-transparent'
              }`}
            >
              <AlertCircle className="w-3 h-3" />
              <span>Needs Auth</span>
              <span className="font-mono text-[10px] ml-1 opacity-80">({counts.authRequired})</span>
            </button>

            <button
              onClick={() => setStatusFilter('webhook_active')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all whitespace-nowrap border flex items-center space-x-1 ${
                statusFilter === 'webhook_active'
                  ? 'bg-onedark-accent/15 text-onedark-accent border-onedark-accent/30 shadow-xs'
                  : 'bg-onedark-darker/60 text-onedark-muted hover:text-onedark-accent border-transparent'
              }`}
            >
              <Radio className="w-3 h-3" />
              <span>Listener Active</span>
              <span className="font-mono text-[10px] ml-1 opacity-80">({counts.webhookActive})</span>
            </button>
          </div>
        </div>
      </div>

      {/* Collapsible Info & Ingestion Endpoint Banner */}
      <div className="mb-5 rounded-xl bg-onedark-darker border border-onedark-borderSubtle overflow-hidden transition-all shadow-xs">
        <div 
          onClick={() => setIsBannerCollapsed(!isBannerCollapsed)}
          className="flex items-center justify-between p-3.5 cursor-pointer hover:bg-onedark-surface/40 transition-colors"
        >
          <div className="flex items-center space-x-2.5">
            <Radio className="w-4 h-4 text-onedark-accent" />
            <span className="text-xs font-bold text-onedark-fgBright">Webhook Ingestion & Vault Status</span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-onedark-green/10 text-onedark-green border border-onedark-green/20">
              HMAC SHA-256
            </span>
          </div>
          <div className="flex items-center space-x-2 text-xs text-onedark-fg/70">
            <span className="text-[11px] font-medium hidden sm:inline">{isBannerCollapsed ? 'Show Details' : 'Hide Details'}</span>
            {isBannerCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </div>
        </div>

        {!isBannerCollapsed && (
          <div className="p-4 pt-0 border-t border-onedark-borderSubtle/60 space-y-3.5 mt-2">
            {/* Overview Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
              <div className="p-3 rounded-lg bg-onedark-bg border border-onedark-borderSubtle flex items-center space-x-3">
                <div className="p-2 rounded-md bg-onedark-surface text-onedark-folder border border-onedark-border">
                  <FolderGit2 className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-[10px] font-semibold text-onedark-fg/60 uppercase tracking-wider">Connected Repos</div>
                  <div className="text-sm font-bold text-onedark-fgBright mt-0.5">{repositories.length} Repositories</div>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-onedark-bg border border-onedark-borderSubtle flex items-center space-x-3">
                <div className="p-2 rounded-md bg-onedark-surface text-onedark-green border border-onedark-border">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-[10px] font-semibold text-onedark-fg/60 uppercase tracking-wider">Vault Security</div>
                  <div className="text-sm font-bold text-onedark-fgBright mt-0.5">AES-256 Encrypted</div>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-onedark-bg border border-onedark-borderSubtle flex items-center space-x-3">
                <div className="p-2 rounded-md bg-onedark-surface text-onedark-purple border border-onedark-border">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-[10px] font-semibold text-onedark-fg/60 uppercase tracking-wider">Multi-Session Memory</div>
                  <div className="text-sm font-bold text-onedark-fgBright mt-0.5">Auto-Clone Ready</div>
                </div>
              </div>
            </div>

            {/* Webhook Endpoint Reference Bar */}
            <div className="p-3 rounded-lg bg-onedark-bg border border-onedark-borderSubtle space-y-2.5">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="text-xs font-semibold text-onedark-fgBright">Active Ingestion Endpoint</div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={handleCopyWebhookUrl}
                    className="inline-flex items-center space-x-1.5 px-2.5 py-1 bg-onedark-surface hover:bg-onedark-border text-onedark-fgBright rounded-lg text-xs font-mono border border-onedark-border transition-colors"
                  >
                    {copiedUrl ? (
                      <>
                        <Check className="w-3 h-3 text-onedark-green" />
                        <span className="text-onedark-green font-medium">Copied URL</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3 text-onedark-accent" />
                        <span>Copy URL</span>
                      </>
                    )}
                  </button>
                  {onNavigateToInbox && (
                    <button
                      onClick={onNavigateToInbox}
                      className="inline-flex items-center space-x-1 px-2.5 py-1 bg-onedark-accent/15 hover:bg-onedark-accent/25 text-onedark-accent rounded-lg text-xs font-medium border border-onedark-accent/30 transition-colors"
                    >
                      <span>View Inbox</span>
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono">
                <div className="p-2.5 rounded-lg bg-onedark-darker border border-onedark-borderSubtle text-onedark-fgBright select-all break-all">
                  <span className="text-onedark-fg/60 text-[10px] block font-sans">GitHub Webhook URL:</span>
                  {window.location.protocol}//{window.location.hostname}:8000/api/webhooks/github
                </div>
                <div className="p-2.5 rounded-lg bg-onedark-darker border border-onedark-borderSubtle text-onedark-fgBright">
                  <span className="text-onedark-fg/60 text-[10px] block font-sans">Trigger Events:</span>
                  <span className="text-onedark-accent font-semibold">pull_request</span>, <span className="text-onedark-accent font-semibold">issues</span>, <span className="text-onedark-accent font-semibold">issue_comment</span>, <span className="text-onedark-accent font-semibold">push</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Main Repositories List / Grid View */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs text-onedark-fg/70">
          <span className="font-semibold uppercase tracking-wider text-[11px] text-onedark-fg/80">
            Saved Repositories ({filteredRepositories.length} of {repositories.length})
          </span>
          {searchQuery && (
            <span className="text-onedark-accent">
              Filtered by: &ldquo;{searchQuery}&rdquo;
            </span>
          )}
        </div>

        {loading ? (
          <div className="p-10 text-center text-xs text-onedark-fg/70 bg-onedark-darker rounded-xl border border-onedark-borderSubtle space-y-2">
            <RefreshCw className="w-5 h-5 animate-spin mx-auto text-onedark-accent" />
            <p>Loading repository configurations from vault...</p>
          </div>
        ) : filteredRepositories.length === 0 ? (
          <div className="p-10 text-center space-y-3 bg-onedark-darker rounded-xl border border-onedark-borderSubtle">
            <FolderGit2 className="w-8 h-8 mx-auto text-onedark-muted opacity-60" />
            <div className="space-y-1">
              <div className="text-sm font-bold text-onedark-fgBright">
                {repositories.length === 0 ? 'No repositories connected yet' : 'No matching repositories found'}
              </div>
              <p className="text-xs text-onedark-fg/70 max-w-sm mx-auto">
                {repositories.length === 0
                  ? 'Connect your GitHub repository to enable multi-session agent persistence, automated PR reviews, and instant code tasks.'
                  : `No repositories match your current filter "${searchQuery}". Clear your search to see all repositories.`}
              </p>
            </div>
            {repositories.length === 0 ? (
              <div className="flex items-center justify-center space-x-2 pt-2">
                <button
                  onClick={handleDiscoverRepositories}
                  disabled={discovering}
                  className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-onedark-surface hover:bg-onedark-border text-onedark-fgBright rounded-lg text-xs font-mono border border-onedark-border disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${discovering ? 'animate-spin text-onedark-accent' : 'text-onedark-muted'}`} />
                  <span>{discovering ? 'Discovering...' : 'Discover from Task History'}</span>
                </button>
                <button
                  onClick={handleOpenAdd}
                  className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 bg-onedark-accent text-onedark-darker rounded-lg text-xs font-bold shadow-xs"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Connect First Repo</span>
                </button>
              </div>
            ) : (
              <button
                onClick={() => { setSearchQuery(''); setStatusFilter('all'); }}
                className="px-3 py-1.5 bg-onedark-surface text-onedark-fgBright rounded-lg text-xs font-medium border border-onedark-border"
              >
                Reset Filters
              </button>
            )}
          </div>
        ) : viewMode === 'table' ? (
          /* Compact Table View */
          <div className="rounded-xl bg-onedark-darker border border-onedark-borderSubtle overflow-hidden shadow-xs">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-onedark-bg border-b border-onedark-borderSubtle text-onedark-fg/70 text-[11px] uppercase tracking-wider font-semibold">
                  <th className="py-3 px-4">Repository</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3">Branch</th>
                  <th className="py-3 px-3">Webhook Listener</th>
                  <th className="py-3 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-onedark-borderSubtle/60">
                {filteredRepositories.map((repo) => {
                  const isConnected = repo.status === 'CONNECTED';
                  const hasListener = Boolean(repo.manifest_cache?.webhook_listener?.installed);
                  const isTesting = testingId === repo.id;

                  return (
                    <tr key={repo.id} className="hover:bg-onedark-surface/30 transition-colors">
                      <td className="py-3 px-4">
                        <div className="space-y-0.5">
                          <div className="flex items-center space-x-2">
                            <span className="font-bold text-onedark-fgBright font-mono">{repo.full_name}</span>
                            <a
                              href={repo.clone_url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-onedark-fg/50 hover:text-onedark-accent transition-colors"
                            >
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                          <div className="text-[11px] text-onedark-fg/60 font-mono truncate max-w-xs">{repo.clone_url}</div>
                        </div>
                      </td>

                      <td className="py-3 px-3">
                        <span
                          className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                            isConnected
                              ? 'bg-onedark-green/15 text-onedark-green border-onedark-green/30'
                              : 'bg-onedark-yellow/15 text-onedark-yellow border-onedark-yellow/30'
                          }`}
                        >
                          {isConnected ? <CheckCircle2 className="w-2.5 h-2.5" /> : <AlertCircle className="w-2.5 h-2.5" />}
                          <span>{isConnected ? 'Connected' : 'Needs Auth'}</span>
                        </span>
                      </td>

                      <td className="py-3 px-3">
                        <span className="font-mono text-onedark-fgBright bg-onedark-bg px-2 py-0.5 rounded border border-onedark-borderSubtle text-[11px]">
                          {repo.default_branch}
                        </span>
                      </td>

                      <td className="py-3 px-3">
                        <div className="flex items-center space-x-2">
                          {hasListener ? (
                            <span className="inline-flex items-center space-x-1 text-onedark-green font-mono text-[11px] bg-onedark-green/10 px-2 py-0.5 rounded border border-onedark-green/20">
                              <CheckCircle2 className="w-3 h-3" />
                              <span>Active</span>
                            </span>
                          ) : (
                            <button
                              onClick={() => handleInstallWebhook(repo.id)}
                              disabled={webhookActionId === repo.id || !repo.has_token}
                              className="inline-flex items-center space-x-1 text-onedark-fgBright hover:text-onedark-accent text-[11px] bg-onedark-surface px-2 py-0.5 rounded border border-onedark-border disabled:opacity-40"
                              title={repo.has_token ? "Auto-install webhook on GitHub" : "Requires GitHub PAT token in Vault"}
                            >
                              <Radio className={`w-3 h-3 text-onedark-accent ${webhookActionId === repo.id ? 'animate-pulse' : ''}`} />
                              <span>Install Hook</span>
                            </button>
                          )}

                          <button
                            onClick={() => handleSimulateEvent(repo.id)}
                            disabled={webhookActionId === repo.id}
                            className="p-1 rounded bg-onedark-surface hover:bg-onedark-border text-onedark-yellow border border-onedark-border disabled:opacity-40"
                            title="Simulate Event"
                          >
                            <Zap className="w-3 h-3" />
                          </button>
                        </div>
                      </td>

                      <td className="py-3 px-3 text-right">
                        <div className="flex items-center justify-end space-x-1.5">
                          <button
                            onClick={() => handleTestConnection(repo.id)}
                            disabled={isTesting}
                            className="p-1.5 rounded-lg bg-onedark-surface hover:bg-onedark-border text-onedark-fgBright border border-onedark-border transition-colors"
                            title="Test Connection"
                          >
                            <RefreshCw className={`w-3 h-3 ${isTesting ? 'animate-spin text-onedark-accent' : ''}`} />
                          </button>

                          <button
                            onClick={() => handleOpenEdit(repo)}
                            className="p-1.5 rounded-lg bg-onedark-surface hover:bg-onedark-border text-onedark-fgBright border border-onedark-border transition-colors"
                            title="Edit Settings"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>

                          <button
                            onClick={() => handlePromptDeleteRepo(repo)}
                            className="p-1.5 rounded-lg bg-onedark-surface hover:bg-onedark-red/20 text-onedark-fg/70 hover:text-onedark-red border border-onedark-border transition-colors cursor-pointer"
                            title="Delete Repo from Vault"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>

                          {onSelectRepoForChat && (
                            <button
                              onClick={() => onSelectRepoForChat(repo.full_name)}
                              className="ml-1 inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-onedark-accent hover:bg-onedark-accent/90 text-onedark-darker text-xs font-bold transition-all shadow-xs"
                            >
                              <Play className="w-3 h-3 fill-current" />
                              <span>Work</span>
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
          /* Detailed Grid View (2-Columns) */
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredRepositories.map((repo) => {
              const isTesting = testingId === repo.id;
              const isConnected = repo.status === 'CONNECTED';
              const branches = repo.manifest_cache?.branches || [];
              const hasListener = Boolean(repo.manifest_cache?.webhook_listener?.installed);

              return (
                <div
                  key={repo.id}
                  className="p-4 rounded-xl bg-onedark-darker border border-onedark-borderSubtle hover:border-onedark-border transition-all flex flex-col justify-between space-y-3.5 shadow-xs"
                >
                  <div className="space-y-3">
                    {/* Title & Status Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-0.5 flex-1 min-w-0">
                        <div className="flex items-center space-x-2">
                          <h3 className="text-sm font-bold text-onedark-fgBright font-mono truncate">{repo.full_name}</h3>
                          <a
                            href={repo.clone_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-onedark-fg/60 hover:text-onedark-accent transition-colors shrink-0"
                            title="Open repository on GitHub"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>
                        <div className="text-xs text-onedark-fg/70 font-mono truncate">{repo.clone_url}</div>
                      </div>

                      <span
                        className={`inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border shrink-0 ${
                          isConnected
                            ? 'bg-onedark-green/15 text-onedark-green border-onedark-green/30'
                            : 'bg-onedark-yellow/15 text-onedark-yellow border-onedark-yellow/30'
                        }`}
                      >
                        {isConnected ? (
                          <CheckCircle2 className="w-3 h-3" />
                        ) : (
                          <AlertCircle className="w-3 h-3" />
                        )}
                        <span>{isConnected ? 'Connected' : 'Auth Required'}</span>
                      </span>
                    </div>

                    {/* Metadata Badges */}
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-md bg-onedark-bg text-onedark-fgBright text-xs border border-onedark-borderSubtle font-mono font-medium">
                        <GitBranch className="w-3 h-3 text-onedark-accent" />
                        <span>{repo.default_branch}</span>
                      </span>

                      <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-md bg-onedark-bg text-onedark-fgBright text-xs border border-onedark-borderSubtle font-mono">
                        <Terminal className="w-3 h-3 text-onedark-accent" />
                        <span>{repo.test_command || 'Auto-detect'}</span>
                      </span>

                      {repo.has_token && (
                        <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-md bg-onedark-bg text-onedark-purple text-xs border border-onedark-borderSubtle font-mono">
                          <Key className="w-3 h-3" />
                          <span>{repo.masked_token || 'Token Saved'}</span>
                        </span>
                      )}
                    </div>

                    {/* Branches preview */}
                    {branches.length > 0 && (
                      <div className="text-xs text-onedark-fg/70 flex items-center flex-wrap gap-1">
                        <span className="font-medium text-onedark-fgBright">Branches:</span>
                        {branches.slice(0, 4).map((b: string) => (
                          <span key={b} className="font-mono text-[11px] bg-onedark-bg px-1.5 py-0.5 rounded border border-onedark-borderSubtle text-onedark-fgBright">
                            {b}
                          </span>
                        ))}
                        {branches.length > 4 && <span className="text-[10px] text-onedark-fg/60">+{branches.length - 4} more</span>}
                      </div>
                    )}

                    {/* Webhook Listener Controls */}
                    <div className="pt-2.5 border-t border-onedark-borderSubtle/60 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-onedark-fgBright flex items-center space-x-1.5 font-medium">
                          <Radio className="w-3.5 h-3.5 text-onedark-accent" />
                          <span>Webhook Listener:</span>
                        </span>
                        {hasListener ? (
                          <span className="inline-flex items-center space-x-1 text-onedark-green font-mono text-[11px] bg-onedark-green/10 px-2 py-0.5 rounded border border-onedark-green/20 font-medium">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>Active (Hook #{repo.manifest_cache?.webhook_listener?.hook_id || 'OK'})</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center space-x-1 text-onedark-yellow font-mono text-[11px] bg-onedark-yellow/10 px-2 py-0.5 rounded border border-onedark-yellow/20 font-medium">
                            <AlertCircle className="w-3 h-3" />
                            <span>Not Registered</span>
                          </span>
                        )}
                      </div>

                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => handleInstallWebhook(repo.id)}
                          disabled={webhookActionId === repo.id || !repo.has_token}
                          className="flex-1 py-1.5 px-2.5 rounded-lg bg-onedark-surface hover:bg-onedark-border text-onedark-fgBright text-xs font-medium border border-onedark-border flex items-center justify-center space-x-1.5 transition-colors disabled:opacity-40"
                          title={repo.has_token ? "Auto-install webhook on GitHub via PAT" : "Requires GitHub PAT token in Vault"}
                        >
                          <Radio className={`w-3.5 h-3.5 text-onedark-accent ${webhookActionId === repo.id ? 'animate-pulse' : ''}`} />
                          <span>{webhookActionId === repo.id ? 'Registering...' : 'Install Webhook on GitHub'}</span>
                        </button>

                        <button
                          onClick={() => handleSimulateEvent(repo.id)}
                          disabled={webhookActionId === repo.id}
                          className="py-1.5 px-3 rounded-lg bg-onedark-surface hover:bg-onedark-border text-onedark-yellow hover:text-onedark-accent text-xs font-mono font-medium border border-onedark-border flex items-center space-x-1 transition-colors disabled:opacity-40"
                          title="Simulate a pull_request.opened event on this repo"
                        >
                          <Zap className="w-3.5 h-3.5" />
                          <span>Simulate</span>
                        </button>
                      </div>

                      {actionFeedback && actionFeedback.id === repo.id && (
                        <div className={`p-2 rounded-lg text-xs font-mono ${actionFeedback.success ? 'bg-onedark-green/15 text-onedark-green border border-onedark-green/30' : 'bg-onedark-red/15 text-onedark-red border border-onedark-red/30'}`}>
                          {actionFeedback.message}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Actions Footer */}
                  <div className="pt-2.5 border-t border-onedark-borderSubtle flex items-center justify-between">
                    <div className="flex items-center space-x-1.5">
                      <button
                        onClick={() => handleTestConnection(repo.id)}
                        disabled={isTesting}
                        className="px-2.5 py-1.5 rounded-lg bg-onedark-surface hover:bg-onedark-border text-onedark-fgBright transition-colors text-xs font-medium flex items-center space-x-1 border border-onedark-border"
                        title="Test Git Connectivity"
                      >
                        <RefreshCw className={`w-3 h-3 ${isTesting ? 'animate-spin text-onedark-accent' : 'text-onedark-muted'}`} />
                        <span>Test</span>
                      </button>

                      <button
                        onClick={() => handleOpenEdit(repo)}
                        className="px-2.5 py-1.5 rounded-lg bg-onedark-surface hover:bg-onedark-border text-onedark-fgBright transition-colors text-xs font-medium flex items-center space-x-1 border border-onedark-border"
                        title="Edit Repository Settings"
                      >
                        <Edit2 className="w-3 h-3 text-onedark-muted" />
                        <span>Edit</span>
                      </button>

                      <button
                        onClick={() => handlePromptDeleteRepo(repo)}
                        className="p-1.5 rounded-lg bg-onedark-surface hover:bg-onedark-red/20 text-onedark-fg/60 hover:text-onedark-red transition-colors text-xs border border-onedark-border cursor-pointer"
                        title="Delete from Vault"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>

                    {onSelectRepoForChat && (
                      <button
                        onClick={() => onSelectRepoForChat(repo.full_name)}
                        className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg bg-onedark-accent hover:bg-onedark-accent/90 text-onedark-darker text-xs font-bold transition-all shadow-xs active:scale-95"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>Work on Repo</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add / Edit Modal with ESC support */}
      {isAddModalOpen && (
        <div 
          onClick={(e) => { if (e.target === e.currentTarget) setIsAddModalOpen(false); }}
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
        >
          <div className="bg-onedark-darker border border-onedark-border rounded-xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-onedark-borderSubtle pb-3">
              <h3 className="text-sm font-bold text-onedark-fgBright flex items-center space-x-2">
                <FolderGit2 className="w-4 h-4 text-onedark-folder" />
                <span>{editingRepo ? 'Edit Repository Config' : 'Connect Repository to Vault'}</span>
              </h3>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-onedark-fg/60 hover:text-onedark-fgBright p-1 rounded-md hover:bg-onedark-surface transition-colors"
                title="Close (Esc)"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveRepository} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-onedark-fgBright mb-1">
                  Repository Name or URL <span className="text-onedark-red">*</span>
                </label>
                <input
                  type="text"
                  value={repoFullName}
                  onChange={(e) => setRepoFullName(e.target.value)}
                  disabled={!!editingRepo}
                  placeholder="e.g. organization/repository or https://github.com/organization/repository"
                  className="w-full bg-onedark-bg border border-onedark-border rounded-lg px-3 py-1.5 text-xs text-onedark-fgBright font-mono focus:outline-none focus:border-onedark-accent disabled:opacity-50"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-onedark-fgBright mb-1 flex items-center justify-between">
                  <span>GitHub Personal Access Token (PAT)</span>
                  <span className="text-[10px] text-onedark-green font-mono">AES-256 Encrypted</span>
                </label>
                <input
                  type="password"
                  value={repoToken}
                  onChange={(e) => setRepoToken(e.target.value)}
                  placeholder={editingRepo?.has_token ? 'Leave blank to keep existing encrypted token' : 'ghp_...'}
                  className="w-full bg-onedark-bg border border-onedark-border rounded-lg px-3 py-1.5 text-xs text-onedark-fgBright font-mono focus:outline-none focus:border-onedark-accent"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-onedark-fgBright mb-1">Default Branch</label>
                  <input
                    type="text"
                    value={defaultBranch}
                    onChange={(e) => setDefaultBranch(e.target.value)}
                    placeholder="main"
                    className="w-full bg-onedark-bg border border-onedark-border rounded-lg px-3 py-1.5 text-xs text-onedark-fgBright font-mono focus:outline-none focus:border-onedark-accent"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-onedark-fgBright mb-1">Test Command</label>
                  <input
                    type="text"
                    value={testCommand}
                    onChange={(e) => setTestCommand(e.target.value)}
                    placeholder="e.g. pytest, npm test"
                    className="w-full bg-onedark-bg border border-onedark-border rounded-lg px-3 py-1.5 text-xs text-onedark-fgBright font-mono focus:outline-none focus:border-onedark-accent"
                  />
                </div>
              </div>

              {feedback && (
                <div
                  className={`p-2.5 rounded-lg text-xs flex items-center space-x-2 ${
                    feedback.success
                      ? 'bg-onedark-green/15 text-onedark-green border border-onedark-green/30'
                      : 'bg-onedark-red/15 text-onedark-red border border-onedark-red/30'
                  }`}
                >
                  {feedback.success ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
                  <span>{feedback.message}</span>
                </div>
              )}

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-onedark-borderSubtle">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-3.5 py-1.5 text-xs font-medium text-onedark-fg/70 hover:text-onedark-fgBright rounded-lg hover:bg-onedark-surface transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-1.5 bg-onedark-accent hover:bg-onedark-accent/90 text-onedark-darker rounded-lg text-xs font-bold transition-all disabled:opacity-50 flex items-center space-x-1.5 shadow-xs"
                >
                  {submitting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>{editingRepo ? 'Save Changes' : 'Save & Verify'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirm Deletion Modal */}
      <ConfirmModal
        isOpen={deleteModalState.isOpen}
        title={
          deleteModalState.type === 'single'
            ? `Delete '${deleteModalState.repo?.name || 'Repository'}' from Vault`
            : 'Clear All Repositories from Vault'
        }
        description={
          deleteModalState.type === 'single'
            ? `Remove '${deleteModalState.repo?.full_name}' configuration and stored credentials from Cyclode's local database?`
            : `Are you sure you want to remove all ${repositories.length} repository configurations and encrypted access tokens from Cyclode's local Vault?`
        }
        confirmText={
          deleteModalState.type === 'single'
            ? 'Delete Repository'
            : 'Clear All Repositories'
        }
        cancelText="Cancel"
        variant="danger"
        requireMatchText={deleteModalState.type === 'all' ? 'CLEAR ALL' : undefined}
        matchPlaceholder='Type "CLEAR ALL" to confirm'
        isLoading={deleteModalState.isDeleting}
        impactItems={
          deleteModalState.type === 'single'
            ? [
                `Removes '${deleteModalState.repo?.full_name}' metadata and cached manifests from local database`,
                'Purges stored AES-256 encrypted access token (PAT) from Vault',
                'Local automated listeners targeting this repository will stop triggering',
              ]
            : [
                `Wipes all ${repositories.length} repository records from local SQLite database`,
                'Permanently purges all encrypted tokens (PATs) and custom build commands',
                'Disables local webhook listener bindings for all repositories',
              ]
        }
        safeItems={
          deleteModalState.type === 'all'
            ? [
                'Remote GitHub/GitLab repositories and codebases are NEVER modified',
                'No remote commits, branches, or pull requests will be deleted',
                'Default templates can be restored anytime using "Discover Workspaces"',
              ]
            : [
                'Remote GitHub/GitLab repositories and codebases are NEVER modified',
                'No remote commits, branches, or pull requests will be deleted',
              ]
        }
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteModalState({ isOpen: false, type: 'single' })}
      />
    </div>
  );
};
