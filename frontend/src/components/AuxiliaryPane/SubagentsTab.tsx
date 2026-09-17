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
        <div key={sub.id} className="p-3 rounded-lg bg-dark-950 border border-dark-800 text-xs space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 font-medium text-zinc-200">
              <Cpu className="w-3.5 h-3.5 text-brand-400" />
              <span>{sub.role}</span>
            </div>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-dark-850 text-zinc-400 border border-dark-800">
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
