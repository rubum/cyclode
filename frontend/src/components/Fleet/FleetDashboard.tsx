import React from 'react';
import { Layers, Plus, ArrowRight } from 'lucide-react';
import { Task } from '../../types';

interface FleetDashboardProps {
  tasks: Task[];
  onSelectTask: (taskId: string) => void;
  onNewChat: () => void;
}

export const FleetDashboard: React.FC<FleetDashboardProps> = ({
  tasks,
  onSelectTask,
  onNewChat,
}) => {
  const running = tasks.filter((t) => t.status === 'RUNNING');
  const awaiting = tasks.filter((t) => t.status === 'AWAITING_APPROVAL');
  const completed = tasks.filter((t) => t.status === 'COMPLETED');

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-onedark-bg font-sans text-onedark-fg">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-onedark-fgBright flex items-center space-x-2">
            <Layers className="w-4 h-4 text-onedark-accent" />
            <span>Agent Fleet</span>
          </h1>
          <p className="text-xs text-onedark-muted mt-0.5">
            Active and past autonomous Antigravity workers.
          </p>
        </div>

        <button
          onClick={onNewChat}
          className="px-3 py-1.5 rounded-md bg-onedark-accent hover:bg-onedark-accent/90 text-onedark-darker font-medium text-xs flex items-center space-x-1.5 transition-colors shadow-sm"
        >
          <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
          <span>New Session</span>
        </button>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-4 gap-3">
        <div className="p-3.5 rounded-lg bg-onedark-darker border border-onedark-borderSubtle space-y-1">
          <div className="text-[11px] font-mono text-onedark-muted">Active Workers</div>
          <div className="text-lg font-semibold text-onedark-yellow">{running.length}</div>
        </div>

        <div className="p-3.5 rounded-lg bg-onedark-darker border border-onedark-borderSubtle space-y-1">
          <div className="text-[11px] font-mono text-onedark-muted">Awaiting Approval</div>
          <div className="text-lg font-semibold text-onedark-purple">{awaiting.length}</div>
        </div>

        <div className="p-3.5 rounded-lg bg-onedark-darker border border-onedark-borderSubtle space-y-1">
          <div className="text-[11px] font-mono text-onedark-muted">Completed</div>
          <div className="text-lg font-semibold text-onedark-green">{completed.length}</div>
        </div>

        <div className="p-3.5 rounded-lg bg-onedark-darker border border-onedark-borderSubtle space-y-1">
          <div className="text-[11px] font-mono text-onedark-muted">Fleet Status</div>
          <div className="text-xs font-mono text-onedark-green pt-1 flex items-center space-x-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-onedark-green animate-pulse" />
            <span>Autonomous & Ready</span>
          </div>
        </div>
      </div>

      {/* Grid */}
      <div className="space-y-3">
        <div className="text-xs font-mono uppercase tracking-wider text-onedark-muted font-semibold">
          Tasks ({tasks.length})
        </div>

        {tasks.length === 0 ? (
          <div className="p-10 text-center rounded-lg bg-onedark-darker border border-onedark-borderSubtle text-onedark-muted text-xs">
            No agent tasks recorded. Start a new session to begin.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {tasks.map((t) => (
              <div
                key={t.id}
                onClick={() => onSelectTask(t.id)}
                className="p-3.5 rounded-lg bg-onedark-darker border border-onedark-borderSubtle hover:border-onedark-accent/50 transition-all cursor-pointer space-y-2 group shadow-sm"
              >
                <div className="flex items-start justify-between">
                  <div className="space-y-0.5">
                    <h3 className="text-xs font-semibold text-onedark-fgBright group-hover:text-onedark-accent transition-colors">
                      {t.title}
                    </h3>
                    <div className="text-[10px] text-onedark-muted font-mono">
                      {t.persona}{t.repo_name ? ` • ${t.repo_name}` : ''}
                    </div>
                  </div>

                  <span className="px-2 py-0.5 rounded text-[10px] font-mono border border-onedark-border bg-onedark-surface text-onedark-fg capitalize">
                    {t.status.toLowerCase().replace('_', ' ')}
                  </span>
                </div>

                {t.result_summary && (
                  <p className="text-[11px] text-onedark-fg line-clamp-2 bg-onedark-bg p-2 rounded border border-onedark-borderSubtle font-mono">
                    {t.result_summary}
                  </p>
                )}

                <div className="pt-2 border-t border-onedark-borderSubtle flex items-center justify-between text-[11px] text-onedark-muted">
                  <span className="font-mono text-[10px]">{t.git_branch || 'main'}</span>
                  <span className="flex items-center space-x-1 text-onedark-accent group-hover:translate-x-0.5 transition-transform">
                    <span>Inspect</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
