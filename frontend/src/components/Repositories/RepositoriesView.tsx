import React, { useState, useEffect, useCallback } from 'react';
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
  X
} from 'lucide-react';
import { RepositoryConfig } from '../../types';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface RepositoriesViewProps {
  onSelectRepoForChat?: (repoFullName: string) => void;
}

export const RepositoriesView: React.FC<RepositoriesViewProps> = ({ onSelectRepoForChat }) => {
  const [repositories, setRepositories] = useState<RepositoryConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingRepo, setEditingRepo] = useState<RepositoryConfig | null>(null);

  // Form State
  const [repoFullName, setRepoFullName] = useState('');
  const [repoToken, setRepoToken] = useState('');
  const [defaultBranch, setDefaultBranch] = useState('main');
  const [testCommand, setTestCommand] = useState('pytest');
  const [submitting, setSubmitting] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ success?: boolean; message?: string } | null>(null);

  const [discovering, setDiscovering] = useState(false);

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
    setTestCommand('pytest');
    setFeedback(null);
    setIsAddModalOpen(true);
  };

  const handleOpenEdit = (repo: RepositoryConfig) => {
    setEditingRepo(repo);
    setRepoFullName(repo.full_name);
    setRepoToken('');
    setDefaultBranch(repo.default_branch || 'main');
    setTestCommand(repo.test_command || 'pytest');
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
          test_command: testCommand.trim() || 'pytest',
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
          setTimeout(() => setIsAddModalOpen(false), 800);
        } else {
          setFeedback({ success: false, message: data.detail || 'Failed to update repository.' });
        }
      } else {
        const payload = {
          full_name: repoFullName.trim(),
          token: repoToken.trim() || undefined,
          default_branch: defaultBranch.trim() || 'main',
          test_command: testCommand.trim() || 'pytest',
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
      }
    } catch (err) {
      console.error('Error testing connection:', err);
    } finally {
      setTestingId(null);
    }
  };

  const handleDeleteRepository = async (repoId: string) => {
    if (!window.confirm('Remove this repository configuration and stored credentials from vault?')) return;
    try {
      const res = await fetch(`${API_BASE}/api/repositories/${repoId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setRepositories((prev) => prev.filter((r) => r.id !== repoId));
      }
    } catch (err) {
      console.error('Error deleting repo:', err);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-onedark-bg font-sans text-onedark-fg">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-onedark-fgBright flex items-center space-x-2">
            <FolderGit2 className="w-4 h-4 text-onedark-accent" />
            <span>Repository & Vault Manager</span>
          </h1>
          <p className="text-xs text-onedark-muted mt-0.5">
            Persistent repository configurations, encrypted access tokens, and cached architecture profiles across sessions.
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={handleDiscoverRepositories}
            disabled={discovering}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-onedark-surface hover:bg-onedark-border text-onedark-fgBright rounded-lg text-xs font-mono transition-all border border-onedark-border disabled:opacity-50"
            title="Scan task history and environment to auto-register repositories"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${discovering ? 'animate-spin text-onedark-accent' : 'text-onedark-muted'}`} />
            <span>{discovering ? 'Discovering...' : 'Discover Workspaces'}</span>
          </button>
          <button
            onClick={handleOpenAdd}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-onedark-accent hover:bg-onedark-accent/90 text-onedark-darker rounded-lg text-xs font-bold transition-all shadow-sm active:scale-95"
          >
            <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>Connect Repository</span>
          </button>
        </div>
      </div>


      {/* Overview Banner */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="p-3.5 rounded-xl bg-onedark-darker border border-onedark-borderSubtle flex items-center space-x-3">
          <div className="p-2.5 rounded-lg bg-onedark-surface text-onedark-accent border border-onedark-border">
            <FolderGit2 className="w-4 h-4" />
          </div>
          <div>
            <div className="text-[11px] font-medium text-onedark-muted uppercase tracking-wider">Connected Repos</div>
            <div className="text-base font-bold text-onedark-fgBright mt-0.5">{repositories.length}</div>
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-onedark-darker border border-onedark-borderSubtle flex items-center space-x-3">
          <div className="p-2.5 rounded-lg bg-onedark-surface text-onedark-green border border-onedark-border">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div>
            <div className="text-[11px] font-medium text-onedark-muted uppercase tracking-wider">Vault Security</div>
            <div className="text-xs font-semibold text-onedark-fgBright mt-0.5">AES-256 Encrypted</div>
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-onedark-darker border border-onedark-borderSubtle flex items-center space-x-3">
          <div className="p-2.5 rounded-lg bg-onedark-surface text-onedark-purple border border-onedark-border">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <div className="text-[11px] font-medium text-onedark-muted uppercase tracking-wider">Multi-Session Memory</div>
            <div className="text-xs font-semibold text-onedark-fgBright mt-0.5">Auto-Clone Ready</div>
          </div>
        </div>
      </div>

      {/* Repositories List */}
      <div className="space-y-3">
        <h2 className="text-xs font-semibold text-onedark-muted uppercase tracking-wider">
          Saved Repositories ({repositories.length})
        </h2>

        {loading ? (
          <div className="p-8 text-center text-xs text-onedark-muted bg-onedark-darker rounded-xl border border-onedark-borderSubtle">
            <RefreshCw className="w-4 h-4 animate-spin mx-auto mb-2 text-onedark-accent" />
            Loading repository configurations...
          </div>
        ) : repositories.length === 0 ? (
          <div className="p-8 text-center space-y-3 bg-onedark-darker rounded-xl border border-onedark-borderSubtle">
            <FolderGit2 className="w-8 h-8 mx-auto text-onedark-muted opacity-50" />
            <div className="space-y-1">
              <div className="text-xs font-semibold text-onedark-fgBright">No repositories connected yet</div>
              <p className="text-[11px] text-onedark-muted max-w-sm mx-auto">
                Connect your GitHub repository to enable multi-session agent persistence, automated PR reviews, and instant code tasks.
              </p>
            </div>
            <div className="flex items-center justify-center space-x-2 pt-1">
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
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-onedark-accent text-onedark-darker rounded-lg text-xs font-bold"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Connect First Repo</span>
              </button>
            </div>
          </div>

        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {repositories.map((repo) => {
              const isTesting = testingId === repo.id;
              const isConnected = repo.status === 'CONNECTED';
              const branches = repo.manifest_cache?.branches || [];

              return (
                <div
                  key={repo.id}
                  className="p-4 rounded-xl bg-onedark-darker border border-onedark-borderSubtle hover:border-onedark-border transition-all flex flex-col justify-between space-y-3.5"
                >
                  <div className="space-y-2.5">
                    {/* Title & Status */}
                    <div className="flex items-start justify-between">
                      <div className="space-y-0.5">
                        <div className="flex items-center space-x-2">
                          <h3 className="text-xs font-bold text-onedark-fgBright font-mono">{repo.full_name}</h3>
                          <a
                            href={repo.clone_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-onedark-muted hover:text-onedark-accent transition-colors"
                          >
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                        <div className="text-[11px] text-onedark-muted font-mono">{repo.clone_url}</div>
                      </div>

                      <span
                        className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                          isConnected
                            ? 'bg-onedark-green/10 text-onedark-green border-onedark-green/20'
                            : 'bg-onedark-yellow/10 text-onedark-yellow border-onedark-yellow/20'
                        }`}
                      >
                        {isConnected ? (
                          <CheckCircle2 className="w-2.5 h-2.5" />
                        ) : (
                          <AlertCircle className="w-2.5 h-2.5" />
                        )}
                        <span>{isConnected ? 'Connected' : 'Auth Required'}</span>
                      </span>
                    </div>

                    {/* Metadata Badges */}
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded bg-onedark-surface text-onedark-fg text-[11px] border border-onedark-border">
                        <GitBranch className="w-3 h-3 text-onedark-muted" />
                        <span>Branch: {repo.default_branch}</span>
                      </span>

                      <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded bg-onedark-surface text-onedark-fg text-[11px] border border-onedark-border font-mono">
                        <Terminal className="w-3 h-3 text-onedark-accent" />
                        <span>{repo.test_command || 'pytest'}</span>
                      </span>

                      {repo.has_token && (
                        <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded bg-onedark-surface text-onedark-purple text-[11px] border border-onedark-border">
                          <Key className="w-3 h-3" />
                          <span className="font-mono">{repo.masked_token || 'Token Saved'}</span>
                        </span>
                      )}
                    </div>

                    {/* Branches preview */}
                    {branches.length > 0 && (
                      <div className="text-[11px] text-onedark-muted">
                        <span className="font-medium text-onedark-fg">Remote Branches:</span>{' '}
                        {branches.slice(0, 4).map((b: string) => (
                          <span key={b} className="font-mono text-[10px] bg-onedark-surface px-1.5 py-0.5 rounded mr-1 border border-onedark-borderSubtle">
                            {b}
                          </span>
                        ))}
                        {branches.length > 4 && <span className="text-[10px]">+{branches.length - 4} more</span>}
                      </div>
                    )}
                  </div>

                  {/* Actions Footer */}
                  <div className="pt-2 border-t border-onedark-borderSubtle flex items-center justify-between">
                    <div className="flex items-center space-x-1.5">
                      <button
                        onClick={() => handleTestConnection(repo.id)}
                        disabled={isTesting}
                        className="p-1.5 rounded-lg bg-onedark-surface hover:bg-onedark-border text-onedark-muted hover:text-onedark-fg transition-colors text-xs flex items-center space-x-1 border border-onedark-borderSubtle"
                        title="Test Git Connectivity"
                      >
                        <RefreshCw className={`w-3 h-3 ${isTesting ? 'animate-spin text-onedark-accent' : ''}`} />
                        <span className="text-[11px]">Test</span>
                      </button>

                      <button
                        onClick={() => handleOpenEdit(repo)}
                        className="p-1.5 rounded-lg bg-onedark-surface hover:bg-onedark-border text-onedark-muted hover:text-onedark-fg transition-colors text-xs flex items-center space-x-1 border border-onedark-borderSubtle"
                        title="Edit Repository Settings"
                      >
                        <Edit2 className="w-3 h-3" />
                        <span className="text-[11px]">Edit</span>
                      </button>

                      <button
                        onClick={() => handleDeleteRepository(repo.id)}
                        className="p-1.5 rounded-lg bg-onedark-surface hover:bg-onedark-red/20 text-onedark-muted hover:text-onedark-red transition-colors text-xs border border-onedark-borderSubtle"
                        title="Delete from Vault"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>

                    {onSelectRepoForChat && (
                      <button
                        onClick={() => onSelectRepoForChat(repo.full_name)}
                        className="flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-onedark-accent hover:bg-onedark-accent/90 text-onedark-darker text-xs font-bold transition-all"
                      >
                        <Play className="w-3 h-3 fill-current" />
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

      {/* Add / Edit Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-onedark-darker border border-onedark-border rounded-xl max-w-md w-full p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-onedark-borderSubtle pb-3">
              <h3 className="text-sm font-semibold text-onedark-fgBright flex items-center space-x-2">
                <FolderGit2 className="w-4 h-4 text-onedark-accent" />
                <span>{editingRepo ? 'Edit Repository Config' : 'Connect Repository to Vault'}</span>
              </h3>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-onedark-muted hover:text-onedark-fg p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveRepository} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-onedark-fg mb-1">
                  Repository Name or URL <span className="text-onedark-red">*</span>
                </label>
                <input
                  type="text"
                  value={repoFullName}
                  onChange={(e) => setRepoFullName(e.target.value)}
                  disabled={!!editingRepo}
                  placeholder="e.g. gowaylo/waylo or https://github.com/gowaylo/waylo"
                  className="w-full bg-onedark-bg border border-onedark-border rounded-lg px-3 py-1.5 text-xs text-onedark-fg font-mono focus:outline-none focus:border-onedark-accent disabled:opacity-50"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-onedark-fg mb-1 flex items-center justify-between">
                  <span>GitHub Personal Access Token (PAT)</span>
                  <span className="text-[10px] text-onedark-muted">Encrypted at rest</span>
                </label>
                <input
                  type="password"
                  value={repoToken}
                  onChange={(e) => setRepoToken(e.target.value)}
                  placeholder={editingRepo?.has_token ? 'Leave blank to keep existing encrypted token' : 'ghp_...'}
                  className="w-full bg-onedark-bg border border-onedark-border rounded-lg px-3 py-1.5 text-xs text-onedark-fg font-mono focus:outline-none focus:border-onedark-accent"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-onedark-fg mb-1">Default Branch</label>
                  <input
                    type="text"
                    value={defaultBranch}
                    onChange={(e) => setDefaultBranch(e.target.value)}
                    placeholder="main"
                    className="w-full bg-onedark-bg border border-onedark-border rounded-lg px-3 py-1.5 text-xs text-onedark-fg font-mono focus:outline-none focus:border-onedark-accent"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-onedark-fg mb-1">Test Command</label>
                  <input
                    type="text"
                    value={testCommand}
                    onChange={(e) => setTestCommand(e.target.value)}
                    placeholder="pytest"
                    className="w-full bg-onedark-bg border border-onedark-border rounded-lg px-3 py-1.5 text-xs text-onedark-fg font-mono focus:outline-none focus:border-onedark-accent"
                  />
                </div>
              </div>

              {feedback && (
                <div
                  className={`p-2.5 rounded-lg text-xs flex items-center space-x-2 ${
                    feedback.success
                      ? 'bg-onedark-green/10 text-onedark-green border border-onedark-green/20'
                      : 'bg-onedark-red/10 text-onedark-red border border-onedark-red/20'
                  }`}
                >
                  {feedback.success ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 shrink-0" />}
                  <span>{feedback.message}</span>
                </div>
              )}

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-onedark-borderSubtle">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-3 py-1.5 text-xs text-onedark-muted hover:text-onedark-fg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-3.5 py-1.5 bg-onedark-accent hover:bg-onedark-accent/90 text-onedark-darker rounded-lg text-xs font-bold transition-all disabled:opacity-50 flex items-center space-x-1.5"
                >
                  {submitting && <RefreshCw className="w-3 h-3 animate-spin" />}
                  <span>{editingRepo ? 'Save Changes' : 'Save & Verify'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
