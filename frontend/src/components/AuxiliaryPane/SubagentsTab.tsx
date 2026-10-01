import React, { useState } from 'react';
import { 
  Cpu, 
  CheckCircle2, 
  Flame, 
  AlertCircle, 
  Activity, 
  Bot, 
  Sparkles, 
  ChevronDown, 
  ChevronRight, 
  Terminal, 
  Zap, 
  Layers 
} from 'lucide-react';
import { Task } from '../../types';

interface SubagentsTabProps {
  task: Task | null;
}

export const SubagentsTab: React.FC<SubagentsTabProps> = ({ task }) => {
  const [expandedSubId, setExpandedSubId] = useState<string | null>(null);

  if (!task) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center text-xs text-onedark-muted font-mono">
        <Cpu className="w-8 h-8 mb-2 text-onedark-muted/40 animate-subagent-pulse" />
        <span>No active task session selected</span>
      </div>
    );
  }

  const isTaskRunning = task.status === 'RUNNING';

  const subagents = [
    {
      id: 'sub-01',
      role: task.persona || 'General Orchestrator',
      model: task.model_name || 'gemini-3.7-flash',
      status: task.status,
      description: 'Primary problem solver, planning synthesizer & executor',
      activeTool: isTaskRunning ? (task.active_tool || 'Analyzing context & requirements') : undefined,
      toolsCount: (task.logs || []).length || 4,
      isOrchestrator: true,
    },
    {
      id: 'sub-02',
      role: 'CodeSearcher & Grep Agent',
      model: 'gemini-3.7-flash',
      status: 'COMPLETED',
      description: 'Indexed AST definitions, imports & semantic workspace references',
      toolsCount: 6,
      isOrchestrator: false,
    },
    {
      id: 'sub-03',
      role: 'Review & Diff Verifier',
      model: 'gemini-3.7-flash',
      status: task.status === 'COMPLETED' ? 'COMPLETED' : 'IDLE',
      description: 'Pre-flight linter, typecheck guardrail & verification monitor',
      toolsCount: 2,
      isOrchestrator: false,
    }
  ];

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'RUNNING':
        return (
          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-onedark-yellow/15 text-onedark-yellow font-mono text-[10px] font-semibold border border-onedark-yellow/30 animate-subagent-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-onedark-yellow animate-ping mr-0.5" />
            <span>Running</span>
          </span>
        );
      case 'COMPLETED':
        return (
          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-onedark-green/15 text-onedark-green font-mono text-[10px] font-medium border border-onedark-green/30">
            <CheckCircle2 className="w-3 h-3" />
            <span>Completed</span>
          </span>
        );
      case 'FAILED':
        return (
          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-onedark-red/15 text-onedark-red font-mono text-[10px] font-medium border border-onedark-red/30">
            <AlertCircle className="w-3 h-3" />
            <span>Failed</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-onedark-surface text-onedark-muted font-mono text-[10px] font-medium border border-onedark-borderSubtle">
            <span>Standby</span>
          </span>
        );
    }
  };

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4 font-sans text-onedark-fg">
      {/* Topology Header */}
      <div className="rounded-2xl bg-onedark-darker border border-onedark-borderSubtle p-3.5 shadow-xs relative overflow-hidden">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-2">
            <Layers className="w-4 h-4 text-onedark-accent" />
            <span className="text-xs font-semibold text-onedark-fgBright font-mono uppercase tracking-wide">
              Swarm Topology & Telemetry
            </span>
          </div>
          <span className="text-[10px] font-mono text-onedark-muted bg-onedark-surface px-2 py-0.5 rounded-full border border-onedark-borderSubtle">
            {subagents.length} Nodes Active
          </span>
        </div>

        {/* Animated Mesh Telemetry Canvas */}
        <div className="relative h-20 rounded-xl bg-onedark-surface/50 border border-onedark-borderSubtle/60 flex items-center justify-between px-6 overflow-hidden">
          {/* SVG Connection Lines with Pulse Flow */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none stroke-onedark-borderSubtle" strokeWidth="1.5">
            <line x1="22%" y1="50%" x2="50%" y2="50%" strokeDasharray="4 4" className={isTaskRunning ? 'animate-pulse' : ''} />
            <line x1="50%" y1="50%" x2="78%" y2="50%" strokeDasharray="4 4" />
          </svg>

          {/* Node 1: Orchestrator */}
          <div className="relative z-10 flex flex-col items-center space-y-1">
            <div className={`w-8 h-8 rounded-xl bg-onedark-darker border flex items-center justify-center transition-all ${
              isTaskRunning ? 'border-onedark-yellow text-onedark-yellow shadow-[0_0_12px_rgba(var(--color-yellow-rgb),0.35)] animate-subagent-pulse' : 'border-onedark-accent/60 text-onedark-accent'
            }`}>
              <Bot className="w-4 h-4" />
            </div>
            <span className="text-[10px] font-mono text-onedark-fgBright font-medium">Orchestrator</span>
          </div>

          {/* Center Signal Pulse */}
          <div className="relative z-10 flex flex-col items-center space-y-1">
            <div className="w-7 h-7 rounded-lg bg-onedark-darker border border-onedark-borderSubtle flex items-center justify-center text-onedark-muted">
              <Zap className={`w-3.5 h-3.5 ${isTaskRunning ? 'text-onedark-yellow animate-bounce' : 'text-onedark-muted/60'}`} />
            </div>
            <span className="text-[9px] font-mono text-onedark-muted">RPC Bus</span>
          </div>

          {/* Node 2: Worker Subagent */}
          <div className="relative z-10 flex flex-col items-center space-y-1">
            <div className="w-8 h-8 rounded-xl bg-onedark-darker border border-onedark-green/50 text-onedark-green flex items-center justify-center shadow-xs">
              <Cpu className="w-4 h-4" />
            </div>
            <span className="text-[10px] font-mono text-onedark-fgBright font-medium">Worker Pod</span>
          </div>
        </div>
      </div>

      {/* Subagents Grid List */}
      <div className="space-y-3">
        <div className="text-[10px] uppercase font-semibold text-onedark-muted font-mono tracking-wider px-0.5">
          Active Swarm Roster
        </div>

        {subagents.map((sub) => {
          const isExpanded = expandedSubId === sub.id;
          const isRunning = sub.status === 'RUNNING';

          return (
            <div 
              key={sub.id} 
              className={`rounded-xl border transition-all duration-200 overflow-hidden shadow-xs ${
                isRunning
                  ? 'bg-onedark-darker/90 border-onedark-accent/50 animate-cognitive-pulse'
                  : 'bg-onedark-surface/60 hover:bg-onedark-surface/90 border-onedark-borderSubtle hover:border-onedark-border'
              }`}
            >
              {/* Header card */}
              <div 
                onClick={() => setExpandedSubId(isExpanded ? null : sub.id)}
                className="p-3.5 cursor-pointer select-none space-y-2.5 btn-tactile"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2.5 font-medium text-onedark-fgBright">
                    <div className={`p-1.5 rounded-lg border ${
                      isRunning 
                        ? 'bg-onedark-yellow/15 border-onedark-yellow/30 text-onedark-yellow' 
                        : 'bg-onedark-surface border-onedark-borderSubtle text-onedark-accent'
                    }`}>
                      <Cpu className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <span className="text-xs font-semibold text-onedark-fgBright">{sub.role}</span>
                      <div className="flex items-center space-x-2 text-[10px] font-mono text-onedark-muted">
                        <span className="text-onedark-accent font-medium">{sub.model}</span>
                        <span>·</span>
                        <span>{sub.toolsCount} operations</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    {getStatusBadge(sub.status)}
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4 text-onedark-muted transition-transform duration-150" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-onedark-muted transition-transform duration-150" />
                    )}
                  </div>
                </div>

                <p className="text-[11.5px] text-onedark-fg/80 leading-relaxed font-sans">
                  {sub.description}
                </p>

                {sub.activeTool && (
                  <div className="flex items-center space-x-2 px-2.5 py-1.5 rounded-lg bg-onedark-darker border border-onedark-yellow/30 text-[11px] font-mono text-onedark-yellow">
                    <Activity className="w-3.5 h-3.5 animate-spin text-onedark-yellow shrink-0" />
                    <span className="truncate">Active tool: {typeof sub.activeTool === 'string' ? sub.activeTool : sub.activeTool.tool_name}</span>
                  </div>
                )}
              </div>

              {/* Expandable Telemetry Drawer */}
              {isExpanded && (
                <div className="px-3.5 py-3 border-t border-onedark-borderSubtle/60 bg-onedark-darker/60 space-y-2 text-xs font-mono animate-stream-fade-in">
                  <div className="flex items-center justify-between text-[11px] text-onedark-muted">
                    <span>Subagent ID: {sub.id}</span>
                    <span>Sandbox mode: Isolated Jailer</span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-onedark-surface/40 border border-onedark-borderSubtle text-[11px] text-onedark-fg space-y-1 font-mono">
                    <div className="text-[10px] uppercase text-onedark-muted font-bold">Capabilities & Tools</div>
                    <div className="flex flex-wrap gap-1 pt-1">
                      {['read_file', 'edit_file', 'run_command', 'grep_search', 'search_symbols'].map((tool) => (
                        <span key={tool} className="px-1.5 py-0.5 rounded bg-onedark-darker border border-onedark-borderSubtle text-[10px] text-onedark-muted">
                          {tool}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
