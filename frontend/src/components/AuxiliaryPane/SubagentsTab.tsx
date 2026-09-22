import React from 'react';
import { Cpu, CheckCircle2, Flame, AlertCircle } from 'lucide-react';
import { Task } from '../../types';

interface SubagentsTabProps {
  task: Task | null;
}

export const SubagentsTab: React.FC<SubagentsTabProps> = ({ task }) => {
  if (!task) {
    return <div className="p-4 text-xs text-zinc-500">No active subagents.</div>;
  }

  const subagents = [
    {
      id: 'sub-01',
      role: task.persona,
      model: task.model_name,
      status: task.status,
      description: 'Primary problem solver & test executor',
    },
    {
      id: 'sub-02',
      role: 'CodeSearcher',
      model: 'gemini-2.5-flash',
      status: 'COMPLETED',
      description: 'Indexed and searched codebase references',
    }
  ];

  return (
    <div className="p-3 space-y-3">
      <div className="text-[10px] uppercase font-semibold text-zinc-500 font-mono">
        Active Subagents ({subagents.length})
      </div>

      {subagents.map((sub) => (
        <div key={sub.id} className="p-3.5 rounded-xl bg-onedark-surface/40 hover:bg-onedark-surface/60 border border-onedark-borderSubtle text-xs space-y-2 shadow-xs transition-colors">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 font-medium text-onedark-fgBright">
              <Cpu className="w-3.5 h-3.5 text-onedark-accent" />
              <span>{sub.role}</span>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-onedark-surface text-onedark-muted font-medium border border-onedark-borderSubtle">
              {sub.status}
            </span>
          </div>

          <p className="text-[11px] text-zinc-400">{sub.description}</p>
          <div className="text-[10px] font-mono text-onedark-accent">{sub.model}</div>
        </div>
      ))}
    </div>
  );
};
