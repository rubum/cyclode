import React, { useState, useEffect } from 'react';
import { 
  Box, 
  X, 
  RefreshCw, 
  GitBranch, 
  ShieldCheck, 
  AlertCircle,
  Copy,
  Check,
  Terminal,
  Folder,
  FolderGit2,
  Code2,
  HardDrive,
  Clock,
  Layers,
  FileText
} from 'lucide-react';
import { Task } from '../../types';

interface SandboxDirectory {
  name: string;
  file_count: number;
  size_bytes: number;
}

interface SandboxLanguage {
  name: string;
  count: number;
  size_bytes: number;
  percentage: number;
}

interface SandboxManifest {
  name: string;
  type: string;
  size_bytes: number;
}

interface SandboxGitStatus {
  branch: string;
  repo_url: string;
  commit_sha: string;
  is_clean: boolean;
  modified_count: number;
  untracked_count: number;
}

interface SandboxRecentLog {
  tool_name: string;
  exit_code: number;
  duration_ms: number;
  created_at: string | null;
  tool_input: Record<string, any>;
}

interface SandboxInfo {
  task_id: string;
  sandbox_status: string;
  workspace_path: string;
  host_path?: string;
  container_path?: string;
  exists_on_disk: boolean;
  git_branch?: string;
  repo_url?: string;
  target_branch?: string;
  commit_sha?: string;
  file_count: number;
  total_size_bytes: number;
  top_directories?: SandboxDirectory[];
  languages?: SandboxLanguage[];
  manifests?: SandboxManifest[];
  git_status?: SandboxGitStatus;
  recent_logs?: SandboxRecentLog[];
  cli_command?: string;
  runtime: {
    mode: string;
    isolation: string;
    lifecycle: string;
    timeout_seconds: number;
  };
}

interface SandboxInspectorModalProps {
  task: Task;
  onClose: () => void;
}

const API_BASE = import.meta.env.VITE_API_URL || '';

export const SandboxInspectorModal: React.FC<SandboxInspectorModalProps> = ({ task, onClose }) => {
  const [data, setData] = useState<SandboxInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const pollTimerRef = React.useRef<any>(null);

  const fetchSandboxData = async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/tasks/${task.id}/sandbox`);
      if (!res.ok) {
        if (res.status === 404 && (task.status === 'INITIALIZING' || task.sandbox_status === 'PROVISIONING')) {
          setData((prev) => prev || {
            task_id: task.id,
            sandbox_status: 'PROVISIONING',
            workspace_path: task.workspace_path || '',
            exists_on_disk: false,
            file_count: 0,
            total_size_bytes: 0,
            runtime: {
              mode: 'ephemeral_sandbox',
              isolation: 'filesystem_confinement',
              lifecycle: 'active_execution',
              timeout_seconds: 60
            }
          });
          return;
        }
        throw new Error(`Failed to fetch sandbox details (${res.status})`);
      }
      const json: SandboxInfo = await res.json();
      setData(json);
    } catch (err: any) {
      if (task.status !== 'INITIALIZING' && task.sandbox_status !== 'PROVISIONING') {
        setError(err.message || 'Error loading sandbox inspector');
      }
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchSandboxData();

    const isProvisioning = task.status === 'INITIALIZING' || task.sandbox_status === 'PROVISIONING' || (data && data.sandbox_status === 'PROVISIONING');
    if (isProvisioning) {
      pollTimerRef.current = setInterval(() => {
        fetchSandboxData(true);
      }, 1800);
    }

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
    };
  }, [task.id, task.status, task.sandbox_status]);

  const handleCopy = (text: string, key: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const getLangColor = (name: string) => {
    switch (name.toLowerCase()) {
      case 'rust':
        return 'bg-amber-600 text-amber-100 border-amber-500/40';
      case 'typescript':
      case 'tsx':
        return 'bg-blue-600 text-blue-100 border-blue-500/40';
      case 'javascript':
      case 'jsx':
        return 'bg-yellow-600 text-yellow-100 border-yellow-500/40';
      case 'python':
        return 'bg-emerald-600 text-emerald-100 border-emerald-500/40';
      case 'go':
        return 'bg-cyan-600 text-cyan-100 border-cyan-500/40';
      case 'shell':
      case 'powershell':
        return 'bg-purple-600 text-purple-100 border-purple-500/40';
      case 'markdown':
        return 'bg-slate-600 text-slate-100 border-slate-500/40';
      default:
        return 'bg-onedark-surface text-onedark-fg border-onedark-border';
    }
  };

  const hostPath = data?.host_path || data?.workspace_path || task.workspace_path || '';
  const containerPath = data?.container_path || (data?.workspace_path?.startsWith('/workspaces') ? data.workspace_path : `/workspaces/sandbox-${task.id}`);
  const wsPath = hostPath || containerPath;
  const cliCommand = data?.cli_command || (containerPath ? `docker exec -it cyclode-backend bash -c "cd ${containerPath} && exec bash"` : '');
  const repoUrl = data?.repo_url || data?.git_status?.repo_url || task.repo_url || '';
  const gitBranch = data?.git_status?.branch || data?.git_branch || task.git_branch || 'main';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-fadeIn">
      <div className="w-full max-w-5xl bg-onedark-bg border border-onedark-border rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-scaleIn">
        
        {/* Header */}
        <div className="p-4 bg-onedark-darker border-b border-onedark-border flex items-center justify-between flex-shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-onedark-accent/15 border border-onedark-accent/30 text-onedark-accent flex items-center justify-center shadow-xs">
              <Box className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-sm font-semibold text-onedark-fgBright font-sans">
                  Sandbox & Runtime Inspector
                </h2>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono uppercase font-bold border ${
                  task.sandbox_status === 'ACTIVE'
                    ? 'bg-onedark-green/15 text-onedark-green border-onedark-green/30'
                    : task.sandbox_status === 'PROVISIONING'
                    ? 'bg-onedark-yellow/15 text-onedark-yellow border-onedark-yellow/30'
                    : 'bg-onedark-surface text-onedark-muted border-onedark-border'
                }`}>
                  {task.sandbox_status || 'ACTIVE'}
                </span>
              </div>
              <div className="flex items-center space-x-2 mt-0.5">
                <span className="text-[11px] text-onedark-muted font-mono">
                  Task ID: {task.id}
                </span>
                <button
                  onClick={() => handleCopy(task.id, 'task_id')}
                  className="text-onedark-muted hover:text-onedark-fgBright p-0.5 transition-colors cursor-pointer"
                  title="Copy Task ID"
                >
                  {copiedKey === 'task_id' ? (
                    <Check className="w-3 h-3 text-onedark-green" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => fetchSandboxData(false)}
              disabled={loading}
              className="p-1.5 rounded-lg border border-onedark-border bg-onedark-surface hover:bg-onedark-darker text-onedark-muted hover:text-onedark-fgBright transition-colors disabled:opacity-40 cursor-pointer"
              title="Refresh Diagnostics"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-onedark-accent' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg border border-transparent hover:border-onedark-border hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fgBright transition-colors cursor-pointer"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Quick Actions & Target Context Header */}
        <div className="px-4 py-3 bg-onedark-surface/30 border-b border-onedark-borderSubtle space-y-2.5">
          {/* Target Being Acted On */}
          <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-onedark-darker/80 border border-onedark-borderSubtle text-xs font-mono">
            <div className="flex items-center space-x-2.5 min-w-0 flex-1">
              <span className="px-2 py-0.5 rounded bg-onedark-accent/20 border border-onedark-accent/40 text-onedark-accent font-bold text-[10px] tracking-wider uppercase flex-shrink-0">
                Acting On
              </span>
              
              <div className="flex items-center space-x-2 truncate">
                {repoUrl ? (
                  <span className="font-bold text-onedark-fgBright truncate text-xs flex items-center space-x-1.5" title={repoUrl}>
                    <FolderGit2 className="w-3.5 h-3.5 text-onedark-folder flex-shrink-0" />
                    <span>{repoUrl.replace('https://github.com/', '')}</span>
                  </span>
                ) : (
                  <span className="font-bold text-onedark-fgBright truncate text-xs flex items-center space-x-1.5">
                    <Box className="w-3.5 h-3.5 text-onedark-accent flex-shrink-0" />
                    <span>Workspace Directory</span>
                  </span>
                )}

                <span className="text-onedark-muted/50 text-[11px]">•</span>

                <span
                  className="text-onedark-muted truncate text-[11px] max-w-[280px] sm:max-w-md"
                  title={`Host Path: ${hostPath}\nContainer Path: ${containerPath}`}
                >
                  {hostPath || containerPath}
                </span>

                <span className="text-onedark-muted/50 text-[11px]">•</span>

                <span className="text-onedark-accent text-[11px] flex items-center space-x-1 flex-shrink-0 font-semibold" title={`Branch: ${gitBranch}`}>
                  <GitBranch className="w-3 h-3" />
                  <span>{gitBranch}</span>
                </span>
              </div>
            </div>

            <div className="flex items-center space-x-1.5 text-[10.5px] text-onedark-green bg-onedark-green/10 border border-onedark-green/20 px-2.5 py-0.5 rounded-full flex-shrink-0">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Filesystem Jailed</span>
            </div>
          </div>

          {/* Quick Action Buttons */}
          <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
            <div className="flex items-center space-x-2 flex-wrap gap-y-1.5">
              <span className="text-[10.5px] uppercase font-bold tracking-wider text-onedark-muted font-mono mr-1">
                Quick Actions:
              </span>

              {hostPath && (
                <button
                  onClick={() => handleCopy(hostPath, 'host_path')}
                  className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-onedark-surface hover:bg-onedark-border text-onedark-fgBright border border-onedark-borderSubtle text-[11px] font-mono transition-all active:scale-95 cursor-pointer shadow-xs"
                  title={`Copy Host Full Path (Mac / Terminal / IDE): ${hostPath}`}
                >
                  {copiedKey === 'host_path' ? (
                    <Check className="w-3.5 h-3.5 text-onedark-green" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 text-onedark-accent" />
                  )}
                  <span>Copy Host Path</span>
                </button>
              )}

              {containerPath && (
                <button
                  onClick={() => handleCopy(containerPath, 'container_path')}
                  className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-onedark-surface hover:bg-onedark-border text-onedark-fg border border-onedark-borderSubtle text-[11px] font-mono transition-all active:scale-95 cursor-pointer shadow-xs"
                  title={`Copy Container Mount Path (Docker internal): ${containerPath}`}
                >
                  {copiedKey === 'container_path' ? (
                    <Check className="w-3.5 h-3.5 text-onedark-green" />
                  ) : (
                    <HardDrive className="w-3.5 h-3.5 text-onedark-blue" />
                  )}
                  <span>Copy Container Path</span>
                </button>
              )}

              {cliCommand && (
                <button
                  onClick={() => handleCopy(cliCommand, 'cli')}
                  className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-onedark-surface hover:bg-onedark-border text-onedark-fgBright border border-onedark-borderSubtle text-[11px] font-mono transition-all active:scale-95 cursor-pointer shadow-xs"
                  title={`Copy: ${cliCommand}`}
                >
                  {copiedKey === 'cli' ? (
                    <Check className="w-3.5 h-3.5 text-onedark-green" />
                  ) : (
                    <Terminal className="w-3.5 h-3.5 text-onedark-purple" />
                  )}
                  <span>Copy Shell Command</span>
                </button>
              )}

              {repoUrl && (
                <button
                  onClick={() => handleCopy(repoUrl, 'repo_url')}
                  className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-onedark-surface hover:bg-onedark-border text-onedark-fgBright border border-onedark-borderSubtle text-[11px] font-mono transition-all active:scale-95 cursor-pointer shadow-xs"
                  title={`Copy: ${repoUrl}`}
                >
                  {copiedKey === 'repo_url' ? (
                    <Check className="w-3.5 h-3.5 text-onedark-green" />
                  ) : (
                    <FolderGit2 className="w-3.5 h-3.5 text-onedark-folder" />
                  )}
                  <span>Copy Repo URL</span>
                </button>
              )}

              {gitBranch && (
                <button
                  onClick={() => handleCopy(gitBranch, 'branch')}
                  className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-onedark-surface hover:bg-onedark-border text-onedark-fgBright border border-onedark-borderSubtle text-[11px] font-mono transition-all active:scale-95 cursor-pointer shadow-xs"
                  title={`Copy: ${gitBranch}`}
                >
                  {copiedKey === 'branch' ? (
                    <Check className="w-3.5 h-3.5 text-onedark-green" />
                  ) : (
                    <GitBranch className="w-3.5 h-3.5 text-onedark-accent" />
                  )}
                  <span>Copy Branch</span>
                </button>
              )}
            </div>

            {copiedKey && (
              <span className="text-[11px] text-onedark-green font-mono flex items-center space-x-1 animate-fadeIn">
                <Check className="w-3.5 h-3.5" />
                <span>Copied to clipboard!</span>
              </span>
            )}
          </div>
        </div>

        {/* Scrollable Dashboard Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          
          {loading && !data && (
            <div className="py-16 flex flex-col items-center justify-center space-y-2 text-onedark-muted font-mono">
              <RefreshCw className="w-6 h-6 animate-spin text-onedark-accent" />
              <span className="text-xs">Analyzing runtime sandbox diagnostics...</span>
            </div>
          )}

          {error && (
            <div className="p-4 rounded-xl bg-onedark-red/10 border border-onedark-red/30 text-onedark-red text-xs font-mono flex items-start space-x-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold">Sandbox Diagnosis Notice</div>
                <div className="text-[11px] opacity-90 mt-0.5">{error}</div>
              </div>
            </div>
          )}

          {data && (
            <>
              {/* Top Row: Metrics & Runtime Boundary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 font-mono">
                {/* Mount Card */}
                <div className="p-3.5 rounded-xl bg-onedark-surface/40 border border-onedark-borderSubtle space-y-2">
                  <div className="flex items-center justify-between text-[11px] text-onedark-muted uppercase font-bold tracking-wider">
                    <span className="flex items-center space-x-1.5">
                      <HardDrive className="w-3.5 h-3.5 text-onedark-accent" />
                      <span>Workspace Mount</span>
                    </span>
                    <span className="text-[10px] text-onedark-green bg-onedark-green/10 border border-onedark-green/20 px-1.5 py-0.2 rounded">
                      Mounted
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    <div className="bg-onedark-darker/80 p-2 rounded-lg border border-onedark-borderSubtle/60 text-[11px] space-y-1">
                      <div className="flex items-center justify-between text-onedark-muted text-[10px]">
                        <span className="font-semibold text-onedark-fgBright">Host Machine Path</span>
                        <button
                          onClick={() => handleCopy(hostPath, 'card_host')}
                          className="text-onedark-muted hover:text-onedark-fgBright p-0.5 transition-colors cursor-pointer"
                          title="Copy Host Path"
                        >
                          {copiedKey === 'card_host' ? <Check className="w-3 h-3 text-onedark-green" /> : <Copy className="w-3 h-3" />}
                        </button>
                      </div>
                      <div className="text-onedark-fg select-all break-all font-mono leading-tight">
                        {hostPath || 'Not provisioned'}
                      </div>
                    </div>
                    {containerPath && containerPath !== hostPath && (
                      <div className="bg-onedark-darker/50 px-2 py-1.5 rounded-lg border border-onedark-borderSubtle/40 text-[10.5px] flex items-center justify-between">
                        <span className="text-onedark-muted truncate mr-2" title={`Container: ${containerPath}`}>
                          Container: <span className="text-onedark-fg font-mono">{containerPath}</span>
                        </span>
                        <button
                          onClick={() => handleCopy(containerPath, 'card_container')}
                          className="text-onedark-muted hover:text-onedark-fgBright p-0.5 transition-colors cursor-pointer flex-shrink-0"
                          title="Copy Container Path"
                        >
                          {copiedKey === 'card_container' ? <Check className="w-3 h-3 text-onedark-green" /> : <Copy className="w-3 h-3" />}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Storage & Files Count */}
                <div className="p-3.5 rounded-xl bg-onedark-surface/40 border border-onedark-borderSubtle space-y-2">
                  <div className="flex items-center justify-between text-[11px] text-onedark-muted uppercase font-bold tracking-wider">
                    <span className="flex items-center space-x-1.5">
                      <Layers className="w-3.5 h-3.5 text-onedark-purple" />
                      <span>Sandbox Footprint</span>
                    </span>
                    <span className="text-[10px] text-onedark-muted font-normal">
                      Ephemeral
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-0.5">
                    <div className="p-2 rounded-lg bg-onedark-darker/60 border border-onedark-borderSubtle/40">
                      <div className="text-[10px] text-onedark-muted">Total Files</div>
                      <div className="text-base font-bold text-onedark-fgBright mt-0.5">
                        {data.file_count.toLocaleString()}
                      </div>
                    </div>
                    <div className="p-2 rounded-lg bg-onedark-darker/60 border border-onedark-borderSubtle/40">
                      <div className="text-[10px] text-onedark-muted">Disk Footprint</div>
                      <div className="text-base font-bold text-onedark-fgBright mt-0.5">
                        {formatBytes(data.total_size_bytes)}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Git & Branch State */}
                <div className="p-3.5 rounded-xl bg-onedark-surface/40 border border-onedark-borderSubtle space-y-2">
                  <div className="flex items-center justify-between text-[11px] text-onedark-muted uppercase font-bold tracking-wider">
                    <span className="flex items-center space-x-1.5">
                      <GitBranch className="w-3.5 h-3.5 text-onedark-accent" />
                      <span>Git Workspace</span>
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.2 rounded border font-semibold ${
                      data.git_status?.is_clean
                        ? 'text-onedark-green bg-onedark-green/10 border-onedark-green/20'
                        : 'text-onedark-yellow bg-onedark-yellow/10 border-onedark-yellow/20'
                    }`}>
                      {data.git_status?.is_clean ? 'Clean' : 'Modified'}
                    </span>
                  </div>
                  <div className="space-y-1 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-onedark-muted text-[11px]">Branch:</span>
                      <span className="text-onedark-fgBright font-semibold truncate max-w-[170px]" title={gitBranch}>
                        {gitBranch}
                      </span>
                    </div>
                    {repoUrl && (
                      <div className="flex items-center justify-between">
                        <span className="text-onedark-muted text-[11px]">Origin:</span>
                        <span className="text-onedark-fg truncate max-w-[170px] text-[11px]" title={repoUrl}>
                          {repoUrl.replace('https://github.com/', '')}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Second Row: Directory Hierarchy & Language Breakdown */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Top Directories Breakdown */}
                <div className="p-3.5 rounded-xl bg-onedark-surface/40 border border-onedark-borderSubtle space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-1.5 text-xs font-semibold text-onedark-fgBright font-sans">
                      <Folder className="w-3.5 h-3.5 text-onedark-folder" />
                      <span>Top Folders & Storage Distribution</span>
                    </div>
                    <span className="text-[10px] text-onedark-muted font-mono">
                      {data.top_directories?.length || 0} top folders
                    </span>
                  </div>

                  {!data.top_directories || data.top_directories.length === 0 ? (
                    <div className="p-4 text-center text-xs text-onedark-muted font-mono">
                      No subdirectories detected
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {data.top_directories.map((dir, idx) => {
                        const pct = data.total_size_bytes > 0
                          ? Math.round((dir.size_bytes / data.total_size_bytes) * 100)
                          : 0;
                        return (
                          <div
                            key={`${dir.name}-${idx}`}
                            className="p-2 rounded-lg bg-onedark-darker/60 border border-onedark-borderSubtle/40 text-xs font-mono flex items-center justify-between"
                          >
                            <div className="flex items-center space-x-2 min-w-0 flex-1 mr-2">
                              <Folder className="w-3.5 h-3.5 text-onedark-folder flex-shrink-0" />
                              <span className="font-semibold text-onedark-fgBright truncate">
                                {dir.name}/
                              </span>
                              <span className="text-[10px] text-onedark-muted flex-shrink-0">
                                ({dir.file_count} file{dir.file_count === 1 ? '' : 's'})
                              </span>
                            </div>
                            <div className="flex items-center space-x-2 flex-shrink-0">
                              <div className="w-16 h-1.5 bg-onedark-surface rounded-full overflow-hidden hidden sm:block">
                                <div
                                  className="h-full bg-onedark-accent rounded-full"
                                  style={{ width: `${Math.max(4, pct)}%` }}
                                />
                              </div>
                              <span className="text-[11px] font-semibold text-onedark-fg w-14 text-right">
                                {formatBytes(dir.size_bytes)}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Language & Technology Breakdown */}
                <div className="p-3.5 rounded-xl bg-onedark-surface/40 border border-onedark-borderSubtle space-y-2.5 flex flex-col">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-1.5 text-xs font-semibold text-onedark-fgBright font-sans">
                      <Code2 className="w-3.5 h-3.5 text-onedark-green" />
                      <span>Code & Language Distribution</span>
                    </div>
                    {data.manifests && data.manifests.length > 0 && (
                      <span className="text-[10px] text-onedark-accent font-mono">
                        {data.manifests.length} manifest{data.manifests.length === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>

                  {/* Segmented language distribution bar */}
                  {data.languages && data.languages.length > 0 && (
                    <div className="w-full h-2 rounded-full overflow-hidden flex bg-onedark-surface/80 border border-onedark-borderSubtle/60">
                      {data.languages.map((l, i) => (
                        <div
                          key={i}
                          style={{ width: `${Math.max(2, l.percentage)}%` }}
                          className={`${getLangColor(l.name).split(' ')[0]} transition-all`}
                          title={`${l.name}: ${l.percentage}% (${formatBytes(l.size_bytes)})`}
                        />
                      ))}
                    </div>
                  )}

                  {/* Language Badges */}
                  <div className="grid grid-cols-2 gap-1.5 flex-1 overflow-y-auto max-h-48 pt-1">
                    {data.languages?.map((lang, idx) => (
                      <div
                        key={idx}
                        className="p-2 rounded-lg bg-onedark-darker/60 border border-onedark-borderSubtle/40 flex items-center justify-between text-xs font-mono"
                      >
                        <span className="font-semibold text-onedark-fgBright text-[11px] truncate mr-1">
                          {lang.name}
                        </span>
                        <div className="flex items-center space-x-1 text-[10.5px] flex-shrink-0">
                          <span className="text-onedark-accent font-bold">
                            {lang.percentage}%
                          </span>
                          <span className="text-onedark-muted">
                            ({formatBytes(lang.size_bytes)})
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Detected Manifests */}
                  {data.manifests && data.manifests.length > 0 && (
                    <div className="pt-2 border-t border-onedark-borderSubtle">
                      <div className="text-[10px] text-onedark-muted uppercase font-bold tracking-wider font-mono mb-1.5">
                        Detected Build & Package Manifests:
                      </div>
                      <div className="flex flex-wrap gap-1.5 font-mono text-[11px]">
                        {data.manifests.map((m, idx) => (
                          <span
                            key={idx}
                            className="px-2 py-0.5 rounded-md bg-onedark-surface border border-onedark-borderSubtle text-onedark-fgBright flex items-center space-x-1"
                          >
                            <FileText className="w-3 h-3 text-onedark-accent" />
                            <span className="font-semibold">{m.name}</span>
                            <span className="text-onedark-muted text-[10px]">({m.type})</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Third Row: Recent Tool Runs & Command History */}
              <div className="p-3.5 rounded-xl bg-onedark-surface/40 border border-onedark-borderSubtle space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1.5 text-xs font-semibold text-onedark-fgBright font-sans">
                    <Terminal className="w-3.5 h-3.5 text-onedark-purple" />
                    <span>Recent Sandbox Tool Executions</span>
                  </div>
                  <span className="text-[10px] text-onedark-muted font-mono">
                    {data.recent_logs?.length || 0} recent executions
                  </span>
                </div>

                {!data.recent_logs || data.recent_logs.length === 0 ? (
                  <div className="p-4 rounded-lg bg-onedark-darker/40 border border-onedark-borderSubtle/30 text-center text-xs text-onedark-muted font-mono">
                    No tool commands recorded in this sandbox session yet.
                  </div>
                ) : (
                  <div className="space-y-1.5 font-mono">
                    {data.recent_logs.map((log, idx) => {
                      const isSuccess = log.exit_code === 0;
                      return (
                        <div
                          key={idx}
                          className="p-2 rounded-lg bg-onedark-darker/60 border border-onedark-borderSubtle/40 flex items-center justify-between text-xs"
                        >
                          <div className="flex items-center space-x-2 min-w-0 flex-1 mr-2">
                            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                              isSuccess ? 'bg-onedark-green' : 'bg-onedark-red'
                            }`} />
                            <span className="font-bold text-onedark-fgBright text-[11px]">
                              {log.tool_name}
                            </span>
                            <span className="text-onedark-muted text-[11px] truncate">
                              {JSON.stringify(log.tool_input)}
                            </span>
                          </div>
                          <div className="flex items-center space-x-2 text-[10.5px] text-onedark-muted flex-shrink-0">
                            <span className="flex items-center space-x-1">
                              <Clock className="w-3 h-3" />
                              <span>{log.duration_ms}ms</span>
                            </span>
                            <span className={`px-1 py-0.2 rounded text-[10px] font-bold ${
                              isSuccess ? 'text-onedark-green bg-onedark-green/10' : 'text-onedark-red bg-onedark-red/10'
                            }`}>
                              Exit {log.exit_code}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}

        </div>

        {/* Footer */}
        <div className="p-3 bg-onedark-darker border-t border-onedark-border flex items-center justify-between text-[11px] font-mono text-onedark-muted flex-shrink-0">
          <div className="flex items-center space-x-2">
            <span className="w-1.5 h-1.5 rounded-full bg-onedark-green animate-pulse" />
            <span>Filesystem Confinement Active · Ephemeral Storage</span>
          </div>
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg bg-onedark-surface hover:bg-onedark-border text-onedark-fgBright text-xs transition-all cursor-pointer font-sans font-medium"
          >
            Close Inspector
          </button>
        </div>

      </div>
    </div>
  );
};
