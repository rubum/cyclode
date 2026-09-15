import React, { useState, useMemo } from 'react';
import { 
  Layers, 
  Plus, 
  ArrowRight, 
  Search, 
  X, 
  ArrowLeft, 
  LayoutGrid, 
  List, 
  ChevronDown, 
  ChevronUp, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  Activity, 
  Bot, 
  FolderGit2, 
  Sparkles,
  Zap
} from 'lucide-react';
import { Task } from '../../types';

interface FleetDashboardProps {
  tasks: Task[];
  onSelectTask: (taskId: string) => void;
  onNewChat: () => void;
  onBackToChat?: () => void;
}

export const FleetDashboard: React.FC<FleetDashboardProps> = ({
  tasks,
  onSelectTask,
  onNewChat,
  onBackToChat,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'RUNNING' | 'AWAITING_APPROVAL' | 'COMPLETED' | 'FAILED'>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [isBannerCollapsed, setIsBannerCollapsed] = useState(false);

  const counts = useMemo(() => {
    const total = tasks.length;
    const running = tasks.filter((t) => t.status === 'RUNNING').length;
    const awaiting = tasks.filter((t) => t.status === 'AWAITING_APPROVAL' || t.status === 'AWAITING_INPUT').length;
    const completed = tasks.filter((t) => t.status === 'COMPLETED').length;
    const failed = tasks.filter((t) => t.status === 'FAILED' || t.status === 'CANCELLED').length;
    return { total, running, awaiting, completed, failed };
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (statusFilter !== 'all') {
        if (statusFilter === 'AWAITING_APPROVAL') {
          if (t.status !== 'AWAITING_APPROVAL' && t.status !== 'AWAITING_INPUT') return false;
        } else if (statusFilter === 'FAILED') {
          if (t.status !== 'FAILED' && t.status !== 'CANCELLED') return false;
        } else if (t.status !== statusFilter) {
          return false;
        }
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const titleMatch = (t.title || '').toLowerCase().includes(q);
        const personaMatch = (t.persona || '').toLowerCase().includes(q);
        const repoMatch = (t.repo_name || '').toLowerCase().includes(q);
        const branchMatch = (t.git_branch || '').toLowerCase().includes(q);
        const summaryMatch = (t.result_summary || '').toLowerCase().includes(q);
        return titleMatch || personaMatch || repoMatch || branchMatch || summaryMatch;
      }
      return true;
    });
  }, [tasks, statusFilter, searchQuery]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'RUNNING':
        return {
          label: 'Running',
          className: 'bg-onedark-yellow/15 text-onedark-yellow border-onedark-yellow/30',
          icon: Activity
        };
      case 'COMPLETED':
        return {
          label: 'Completed',
          className: 'bg-onedark-green/15 text-onedark-green border-onedark-green/30',
          icon: CheckCircle2
        };
      case 'AWAITING_APPROVAL':
      case 'AWAITING_INPUT':
        return {
          label: 'Awaiting Review',
          className: 'bg-onedark-purple/15 text-onedark-purple border-onedark-purple/30',
          icon: Clock
        };
      case 'FAILED':
      case 'CANCELLED':
        return {
          label: status === 'CANCELLED' ? 'Stopped' : 'Failed',
          className: 'bg-onedark-red/15 text-onedark-red border-onedark-red/30',
          icon: AlertCircle
        };
      default:
        return {
          label: status.toLowerCase().replace('_', ' '),
          className: 'bg-onedark-surface text-onedark-fg border-onedark-border',
          icon: Bot
        };
    }
  };

  return (
    <div className="h-full w-full flex flex-col min-h-0 overflow-y-auto bg-onedark-bg font-sans text-onedark-fg">
      {/* Sticky Header with Navigation & Actions */}
      <div className="sticky top-0 z-20 bg-onedark-bg/95 backdrop-blur-md border-b border-onedark-borderSubtle">
        <div className="max-w-6xl mx-auto px-6 lg:px-8 py-5 space-y-3">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="flex items-center space-x-3">
              {onBackToChat && (
                <button
                  onClick={onBackToChat}
                  className="inline-flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg bg-onedark-darker hover:bg-onedark-surface text-onedark-fg hover:text-onedark-fgBright text-xs font-medium border border-onedark-border transition-all active:scale-95 shadow-xs cursor-pointer"
                  title="Return to Workstation / Chat"
                >
                  <ArrowLeft className="w-3.5 h-3.5 text-onedark-accent" />
                  <span>Workstation</span>
                </button>
              )}

              <div className="p-2 rounded-xl bg-onedark-darker border border-onedark-border text-onedark-accent shadow-xs">
                <Layers className="w-4 h-4" />
              </div>

              <div>
                <h1 className="text-base font-bold text-onedark-fgBright flex items-center space-x-2">
                  <span>Agent Fleet & Worker Orchestration</span>
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-onedark-surface text-onedark-fgBright border border-onedark-border">
                    {tasks.length} Sessions
                  </span>
                  {counts.running > 0 && (
                    <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-onedark-yellow/15 text-onedark-yellow border border-onedark-yellow/30">
                      <span className="w-1.5 h-1.5 rounded-full bg-onedark-yellow animate-pulse" />
                      <span>{counts.running} RUNNING</span>
                    </span>
                  )}
                </h1>
                <p className="text-xs text-onedark-fg/70 mt-0.5">
                  Active and historic autonomous Antigravity workers, subagents, and ephemeral task sessions.
                </p>
              </div>
            </div>

            {/* Top Actions */}
            <div className="flex items-center space-x-2">
              <div className="flex items-center bg-onedark-darker p-0.5 rounded-lg border border-onedark-border">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-1.5 rounded-md text-xs transition-colors cursor-pointer ${
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
                  className={`p-1.5 rounded-md text-xs transition-colors cursor-pointer ${
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
                onClick={onNewChat}
                className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg bg-onedark-accent hover:bg-onedark-accent/90 text-onedark-darker text-xs font-bold transition-all shadow-sm active:scale-95 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>New Session</span>
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
                placeholder="Search tasks by title, persona, repository, or summary..."
                className="w-full bg-onedark-darker border border-onedark-border rounded-lg pl-9 pr-8 py-1.5 text-xs text-onedark-fgBright placeholder:text-onedark-muted font-sans focus:outline-none focus:border-onedark-accent transition-colors"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-onedark-muted hover:text-onedark-fgBright p-0.5 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Status Filter Chips */}
            <div className="flex items-center space-x-1.5 overflow-x-auto pb-0.5">
              <button
                onClick={() => setStatusFilter('all')}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all whitespace-nowrap border cursor-pointer ${
                  statusFilter === 'all'
                    ? 'bg-onedark-surface text-onedark-fgBright border-onedark-border shadow-xs'
                    : 'bg-onedark-darker/60 text-onedark-muted hover:text-onedark-fg border-transparent'
                }`}
              >
                All <span className="font-mono text-[10px] ml-1 opacity-70">({counts.total})</span>
              </button>

              <button
                onClick={() => setStatusFilter('RUNNING')}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all whitespace-nowrap border flex items-center space-x-1 cursor-pointer ${
                  statusFilter === 'RUNNING'
                    ? 'bg-onedark-yellow/15 text-onedark-yellow border-onedark-yellow/30 shadow-xs'
                    : 'bg-onedark-darker/60 text-onedark-muted hover:text-onedark-yellow border-transparent'
                }`}
              >
                <Activity className="w-3 h-3" />
                <span>Running</span>
                <span className="font-mono text-[10px] ml-1 opacity-80">({counts.running})</span>
              </button>

              <button
                onClick={() => setStatusFilter('AWAITING_APPROVAL')}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all whitespace-nowrap border flex items-center space-x-1 cursor-pointer ${
                  statusFilter === 'AWAITING_APPROVAL'
                    ? 'bg-onedark-purple/15 text-onedark-purple border-onedark-purple/30 shadow-xs'
                    : 'bg-onedark-darker/60 text-onedark-muted hover:text-onedark-purple border-transparent'
                }`}
              >
                <Clock className="w-3 h-3" />
                <span>Review Needed</span>
                <span className="font-mono text-[10px] ml-1 opacity-80">({counts.awaiting})</span>
              </button>

              <button
                onClick={() => setStatusFilter('COMPLETED')}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all whitespace-nowrap border flex items-center space-x-1 cursor-pointer ${
                  statusFilter === 'COMPLETED'
                    ? 'bg-onedark-green/15 text-onedark-green border-onedark-green/30 shadow-xs'
                    : 'bg-onedark-darker/60 text-onedark-muted hover:text-onedark-green border-transparent'
                }`}
              >
                <CheckCircle2 className="w-3 h-3" />
                <span>Completed</span>
                <span className="font-mono text-[10px] ml-1 opacity-80">({counts.completed})</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-6 lg:px-8 py-8 space-y-6 w-full">
        {/* Collapsible Overview Metrics Banner */}
        <div className="rounded-xl bg-onedark-darker border border-onedark-borderSubtle overflow-hidden transition-all shadow-xs">
          <div 
            onClick={() => setIsBannerCollapsed(!isBannerCollapsed)}
            className="flex items-center justify-between p-3.5 cursor-pointer hover:bg-onedark-surface/40 transition-colors"
          >
            <div className="flex items-center space-x-2.5">
              <Activity className="w-4 h-4 text-onedark-accent" />
              <span className="text-xs font-bold text-onedark-fgBright">Fleet Concurrency & Worker Metrics</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-onedark-green/10 text-onedark-green border border-onedark-green/20">
                Antigravity Harness 2.0
              </span>
            </div>
            <div className="flex items-center space-x-2 text-xs text-onedark-fg/70">
              <span className="text-[11px] font-medium hidden sm:inline">{isBannerCollapsed ? 'Show Details' : 'Hide Details'}</span>
              {isBannerCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            </div>
          </div>

          {!isBannerCollapsed && (
            <div className="p-4 pt-0 border-t border-onedark-borderSubtle/60 grid grid-cols-2 md:grid-cols-4 gap-3 pt-3">
              <div className="p-3 rounded-lg bg-onedark-bg border border-onedark-borderSubtle">
                <div className="text-[10px] font-semibold text-onedark-fg/60 uppercase">Active Workers</div>
                <div className="text-base font-bold text-onedark-yellow mt-0.5">{counts.running} Active</div>
              </div>

              <div className="p-3 rounded-lg bg-onedark-bg border border-onedark-borderSubtle">
                <div className="text-[10px] font-semibold text-onedark-fg/60 uppercase">Awaiting Approval</div>
                <div className="text-base font-bold text-onedark-purple mt-0.5">{counts.awaiting} Pending</div>
              </div>

              <div className="p-3 rounded-lg bg-onedark-bg border border-onedark-borderSubtle">
                <div className="text-[10px] font-semibold text-onedark-fg/60 uppercase">Completed Fixes</div>
                <div className="text-base font-bold text-onedark-green mt-0.5">{counts.completed} Done</div>
              </div>

              <div className="p-3 rounded-lg bg-onedark-bg border border-onedark-borderSubtle">
                <div className="text-[10px] font-semibold text-onedark-fg/60 uppercase">Fleet Health</div>
                <div className="text-xs font-mono text-onedark-green pt-1 flex items-center space-x-1.5 font-bold">
                  <span className="w-2 h-2 rounded-full bg-onedark-green animate-pulse" />
                  <span>Ready & Responsive</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Main List / Grid View */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs text-onedark-fg/70">
          <span className="font-semibold uppercase tracking-wider text-[11px] text-onedark-fg/80">
            Recorded Agent Tasks ({filteredTasks.length} of {tasks.length})
          </span>
          {searchQuery && (
            <span className="text-onedark-accent">Filtered by: &ldquo;{searchQuery}&rdquo;</span>
          )}
        </div>

        {filteredTasks.length === 0 ? (
          <div className="p-10 text-center space-y-3 bg-onedark-darker rounded-xl border border-onedark-borderSubtle">
            <Layers className="w-8 h-8 mx-auto text-onedark-muted opacity-60" />
            <div className="space-y-1">
              <div className="text-sm font-bold text-onedark-fgBright">No tasks match your criteria</div>
              <p className="text-xs text-onedark-fg/70 max-w-sm mx-auto">
                No tasks match &ldquo;{searchQuery}&rdquo;. Try clearing your filter or launch a new session.
              </p>
            </div>
            <div className="flex items-center justify-center space-x-2 pt-2">
              <button
                onClick={() => { setSearchQuery(''); setStatusFilter('all'); }}
                className="px-3 py-1.5 bg-onedark-surface text-onedark-fgBright rounded-lg text-xs font-medium border border-onedark-border"
              >
                Reset Filters
              </button>
              <button
                onClick={onNewChat}
                className="px-3.5 py-1.5 bg-onedark-accent text-onedark-darker rounded-lg text-xs font-bold shadow-xs"
              >
                Launch New Session
              </button>
            </div>
          </div>
        ) : viewMode === 'table' ? (
          /* Table View */
          <div className="rounded-xl bg-onedark-darker border border-onedark-borderSubtle overflow-hidden shadow-xs">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-onedark-bg border-b border-onedark-borderSubtle text-onedark-fg/70 text-[11px] uppercase tracking-wider font-semibold">
                  <th className="py-3 px-4">Task Title</th>
                  <th className="py-3 px-3">Persona & Repo</th>
                  <th className="py-3 px-3">Branch</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-onedark-borderSubtle/60">
                {filteredTasks.map((t) => {
                  const statusInfo = getStatusBadge(t.status);
                  const StatusIcon = statusInfo.icon;
                  return (
                    <tr 
                      key={t.id} 
                      onClick={() => onSelectTask(t.id)}
                      className="hover:bg-onedark-surface/40 transition-colors cursor-pointer"
                    >
                      <td className="py-3 px-4">
                        <div className="font-bold text-onedark-fgBright truncate max-w-md">{t.title}</div>
                        {t.result_summary && (
                          <div className="text-[11px] text-onedark-fg/60 font-mono truncate max-w-md mt-0.5">
                            {t.result_summary}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        <div className="font-semibold text-onedark-fgBright">{t.persona}</div>
                        {t.repo_name && (
                          <div className="text-[11px] text-onedark-accent font-mono truncate">{t.repo_name}</div>
                        )}
                      </td>
                      <td className="py-3 px-3 font-mono text-[11px] text-onedark-fgBright">
                        <span className="bg-onedark-bg px-2 py-0.5 rounded border border-onedark-borderSubtle">
                          {t.git_branch || 'main'}
                        </span>
                      </td>
                      <td className="py-3 px-3">
                        <span className={`inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${statusInfo.className}`}>
                          <StatusIcon className="w-3 h-3" />
                          <span>{statusInfo.label}</span>
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right">
                        <button
                          onClick={(e) => { e.stopPropagation(); onSelectTask(t.id); }}
                          className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-onedark-surface hover:bg-onedark-border text-onedark-accent font-medium text-xs border border-onedark-border transition-colors"
                        >
                          <span>Inspect</span>
                          <ArrowRight className="w-3 h-3" />
                        </button>
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
            {filteredTasks.map((t) => {
              const statusInfo = getStatusBadge(t.status);
              const StatusIcon = statusInfo.icon;
              return (
                <div
                  key={t.id}
                  onClick={() => onSelectTask(t.id)}
                  className="p-4 rounded-xl bg-onedark-darker border border-onedark-borderSubtle hover:border-onedark-border transition-all cursor-pointer space-y-3 shadow-xs flex flex-col justify-between group"
                >
                  <div className="space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-0.5 flex-1 min-w-0">
                        <h3 className="text-xs font-bold text-onedark-fgBright group-hover:text-onedark-accent transition-colors truncate">
                          {t.title}
                        </h3>
                        <div className="text-xs text-onedark-fg/70 font-mono flex items-center space-x-1.5 truncate">
                          <span className="font-semibold text-onedark-accent">{t.persona}</span>
                          {t.repo_name && <span>• {t.repo_name}</span>}
                        </div>
                      </div>

                      <span className={`inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border shrink-0 ${statusInfo.className}`}>
                        <StatusIcon className="w-3 h-3" />
                        <span>{statusInfo.label}</span>
                      </span>
                    </div>

                    {t.result_summary && (
                      <p className="text-xs text-onedark-fgBright/90 line-clamp-2 bg-onedark-bg p-2.5 rounded-lg border border-onedark-borderSubtle font-mono text-[11px] leading-relaxed">
                        {t.result_summary}
                      </p>
                    )}
                  </div>

                  <div className="pt-2.5 border-t border-onedark-borderSubtle flex items-center justify-between text-xs text-onedark-fg/70 font-mono">
                    <span className="bg-onedark-bg px-2 py-0.5 rounded border border-onedark-borderSubtle text-onedark-fgBright text-[11px]">
                      {t.git_branch || 'main'}
                    </span>
                    <span className="inline-flex items-center space-x-1 text-onedark-accent font-sans font-medium text-xs group-hover:translate-x-0.5 transition-transform">
                      <span>Inspect Session</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
