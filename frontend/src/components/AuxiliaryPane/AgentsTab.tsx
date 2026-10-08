import React, { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react';
import { 
  Cpu, 
  CheckCircle2, 
  AlertCircle, 
  Activity, 
  Bot, 
  ChevronDown, 
  ChevronRight, 
  Terminal, 
  Zap, 
  Layers,
  Plus,
  ShieldCheck,
  Code2,
  FileCode2,
  StopCircle,
  ExternalLink,
  GitPullRequest,
  Check,
  CheckCheck,
  RefreshCw,
  GitCompare,
  Flame,
  Search,
  Trash2,
  ChevronsUpDown,
  Clock,
  ListChecks,
  PackageCheck,
  Copy,
  Globe,
  FileText,
  Circle,
  Target,
  Sparkles,
  GitBranch,
  ArrowRight,
  Workflow,
  TrendingUp,
  Database,
  Info
} from 'lucide-react';
import { Task, SubagentPod, TaskPlan, TaskLog, TaskDiff } from '../../types';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { MarkdownRenderer } from '../Common/MarkdownRenderer';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface AgentsTabProps {
  task: Task | null;
  onOpenSubsession?: (subtaskId: string) => void;
}

type DrawerTab = 'plan' | 'logs' | 'results';

// Stabilized, isolated timer component to prevent parent re-renders
const SwarmTimer: React.FC<{ isRunning: boolean }> = memo(({ isRunning }) => {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [isRunning]);

  const m = Math.floor(seconds / 60);
  const s = seconds % 60;

  return (
    <span className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-onedark-yellow/10 text-[11px] font-mono font-semibold text-onedark-yellow border border-onedark-yellow/25 tabular-nums shadow-xs">
      <Clock className="w-3 h-3 text-onedark-yellow shrink-0" />
      <span>{m}:{s < 10 ? '0' : ''}{s}</span>
    </span>
  );
});

SwarmTimer.displayName = 'SwarmTimer';

// Helper to strip redundant "Phase X: " prefixes when displaying phase titles
function formatPhaseTitle(phaseNumber: number | undefined, rawTitle: string) {
  if (!rawTitle) return { badge: `Phase ${phaseNumber || 1}`, cleanTitle: '' };
  
  const regex = phaseNumber 
    ? new RegExp(`^Phase\\s*${phaseNumber}\\s*[:\\-]\\s*`, 'i')
    : /^Phase\\s*\\d+\\s*[:\\-]\\s*/i;

  const clean = rawTitle.replace(regex, '').trim();
  return {
    badge: `Phase ${phaseNumber || 1}`,
    cleanTitle: clean || rawTitle
  };
}

// Tool-specific color token and icon helper using theme variables
function getToolStyle(toolName: string) {
  switch (toolName.toLowerCase()) {
    case 'search_web':
    case 'fetch_url':
      return {
        icon: Globe,
        color: 'text-onedark-accent',
        bg: 'bg-onedark-accent/10',
        border: 'border-onedark-accent/20',
        label: 'Web Intelligence'
      };
    case 'read_file':
    case 'get_file_outline':
    case 'search_code':
    case 'find_symbols':
      return {
        icon: FileText,
        color: 'text-onedark-green',
        bg: 'bg-onedark-green/10',
        border: 'border-onedark-green/20',
        label: 'Code Inspection'
      };
    case 'edit_file':
    case 'replace_file_content':
    case 'write_to_file':
      return {
        icon: Code2,
        color: 'text-onedark-yellow',
        bg: 'bg-onedark-yellow/10',
        border: 'border-onedark-yellow/20',
        label: 'Code Mutation'
      };
    case 'run_command':
    case 'bash':
    case 'terminal':
      return {
        icon: Terminal,
        color: 'text-onedark-purple',
        bg: 'bg-onedark-purple/10',
        border: 'border-onedark-purple/20',
        label: 'Terminal Shell'
      };
    case 'delegate_subtasks':
    case 'batch_review_prs':
      return {
        icon: Layers,
        color: 'text-onedark-accent',
        bg: 'bg-onedark-accent/10',
        border: 'border-onedark-accent/20',
        label: 'Swarm Dispatch'
      };
    default:
      return {
        icon: Terminal,
        color: 'text-onedark-accent',
        bg: 'bg-onedark-accent/10',
        border: 'border-onedark-accent/20',
        label: 'Tool Execution'
      };
  }
}

// Structured developer log span item
const ToolLogItem: React.FC<{ log: TaskLog; index: number }> = memo(({ log }) => {
  const [isCopied, setIsCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const toolStyle = getToolStyle(log.tool_name);
  const IconComp = toolStyle.icon;

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (log.tool_output) {
      navigator.clipboard.writeText(log.tool_output);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    }
  };

  // Extract query, file path, or main argument if available in log
  const formattedParam = useMemo(() => {
    if (!log.tool_output) return null;
    const matchQuery = log.tool_output.match(/search\s*for\s*'([^']+)'/i) || log.tool_output.match(/query:\s*"([^"]+)"/i);
    if (matchQuery) return matchQuery[1];
    return null;
  }, [log.tool_output]);

  // Extract markdown link citations if search_web results
  const citations = useMemo(() => {
    if (!log.tool_output || !log.tool_name.includes('search')) return [];
    const linkMatches = Array.from(log.tool_output.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g));
    return linkMatches.slice(0, 3).map((m) => ({ title: m[1], url: m[2] }));
  }, [log.tool_output, log.tool_name]);

  return (
    <div className="rounded-lg border border-onedark-borderSubtle bg-onedark-surface/60 hover:bg-onedark-surface/90 transition-colors overflow-hidden group">
      {/* Header bar */}
      <div 
        onClick={() => setIsExpanded(!isExpanded)}
        className="px-3 py-2 flex items-center justify-between cursor-pointer select-none text-xs font-mono"
      >
        <div className="flex items-center space-x-2 min-w-0">
          <div className={`p-1 rounded-md border ${toolStyle.bg} ${toolStyle.border} ${toolStyle.color} shrink-0`}>
            <IconComp className="w-3.5 h-3.5" />
          </div>
          <span className="font-bold text-onedark-fgBright truncate">
            {log.tool_name}
          </span>
          {formattedParam && (
            <span className="hidden sm:inline text-[11px] text-onedark-muted truncate max-w-xs px-1.5 py-0.5 rounded bg-onedark-darker border border-onedark-borderSubtle">
              "{formattedParam}"
            </span>
          )}
        </div>

        <div className="flex items-center space-x-2 shrink-0">
          <span className="text-[10px] text-onedark-muted tabular-nums bg-onedark-darker px-2 py-0.5 rounded border border-onedark-borderSubtle">
            {log.duration_ms ? `${log.duration_ms}ms` : 'fast'}
          </span>
          <button
            onClick={handleCopy}
            className="p-1 text-onedark-muted hover:text-onedark-fgBright hover:bg-onedark-darker rounded transition-colors"
            title="Copy Output"
          >
            {isCopied ? <Check className="w-3 h-3 text-onedark-green" /> : <Copy className="w-3 h-3" />}
          </button>
          <ChevronDown className={`w-3.5 h-3.5 text-onedark-muted transition-transform duration-150 ${isExpanded ? 'rotate-180' : ''}`} />
        </div>
      </div>

      {/* Citations Preview (if search results) */}
      {citations.length > 0 && !isExpanded && (
        <div className="px-3 pb-2 flex flex-wrap gap-1.5">
          {citations.map((c, i) => (
            <a
              key={i}
              href={c.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center space-x-1 px-2 py-0.5 rounded bg-onedark-accent/10 hover:bg-onedark-accent/20 text-onedark-accent border border-onedark-accent/20 text-[10px] font-mono truncate max-w-[240px] transition-colors"
              title={c.title}
            >
              <Globe className="w-2.5 h-2.5 shrink-0" />
              <span className="truncate">{c.title}</span>
              <ExternalLink className="w-2.5 h-2.5 shrink-0 opacity-70" />
            </a>
          ))}
        </div>
      )}

      {/* Output Content Accordion */}
      {isExpanded && log.tool_output && (
        <div className="border-t border-onedark-borderSubtle bg-onedark-darker/70 p-2.5 text-[11px] font-mono">
          <pre className="text-onedark-fg overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-60 rounded p-2 bg-onedark-darker border border-onedark-borderSubtle">
            {log.tool_output}
          </pre>
        </div>
      )}
    </div>
  );
});

ToolLogItem.displayName = 'ToolLogItem';

// Expandable file diff viewer with additions/deletions and patch inspection
const SubagentDiffItem: React.FC<{ diff: TaskDiff }> = memo(({ diff }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (diff.diff_content) {
      navigator.clipboard.writeText(diff.diff_content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const lines = useMemo(() => {
    if (!diff.diff_content) return [];
    return diff.diff_content.split('\n');
  }, [diff.diff_content]);

  return (
    <div className="rounded-lg border border-onedark-borderSubtle bg-onedark-surface/40 overflow-hidden text-xs">
      <div
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex items-center justify-between p-2 cursor-pointer hover:bg-onedark-surface/70 transition-colors font-mono"
      >
        <div className="flex items-center space-x-2 truncate pr-2">
          {isOpen ? (
            <ChevronDown className="w-3.5 h-3.5 text-onedark-muted shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-onedark-muted shrink-0" />
          )}
          <FileCode2 className="w-3.5 h-3.5 text-onedark-accent shrink-0" />
          <span className="text-onedark-fg font-medium truncate">{diff.file_path}</span>
        </div>

        <div className="flex items-center space-x-2 shrink-0">
          <span className="text-[10px] text-onedark-green font-semibold">+{diff.additions || 0}</span>
          <span className="text-[10px] text-onedark-red font-semibold">-{diff.deletions || 0}</span>
          <button
            onClick={handleCopy}
            title="Copy diff patch"
            className="p-1 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg transition-colors"
          >
            {copied ? <Check className="w-3 h-3 text-onedark-green" /> : <Copy className="w-3 h-3" />}
          </button>
        </div>
      </div>

      {isOpen && diff.diff_content && (
        <div className="border-t border-onedark-borderSubtle/60 bg-onedark-darker p-2 overflow-x-auto max-h-72 overflow-y-auto font-mono text-[11px] leading-tight">
          {lines.map((line, idx) => {
            const isAdd = line.startsWith('+') && !line.startsWith('+++');
            const isDel = line.startsWith('-') && !line.startsWith('---');
            const isHunkHeader = line.startsWith('@@');

            let lineClass = 'text-onedark-fg/80';
            let bgClass = '';
            if (isAdd) {
              lineClass = 'text-onedark-green';
              bgClass = 'bg-onedark-green/10';
            } else if (isDel) {
              lineClass = 'text-onedark-red';
              bgClass = 'bg-onedark-red/10';
            } else if (isHunkHeader) {
              lineClass = 'text-onedark-cyan font-bold';
              bgClass = 'bg-onedark-cyan/10';
            }

            return (
              <div key={idx} className={`px-2 py-0.5 rounded-xs flex whitespace-pre ${bgClass} ${lineClass}`}>
                <span className="w-8 shrink-0 text-onedark-muted/60 select-none text-right pr-2">{idx + 1}</span>
                <span className="flex-1 font-mono">{line}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

SubagentDiffItem.displayName = 'SubagentDiffItem';

// Dedicated Subagent Assigned Goal Banner with copy utility and clean typography
const SubagentGoalBanner: React.FC<{ description: string }> = memo(({ description }) => {
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(description);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!description || !description.trim()) return null;

  const isLong = description.length > 250;

  return (
    <div className="rounded-lg bg-onedark-surface/50 border border-onedark-borderSubtle p-3 space-y-2 font-sans">
      <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-onedark-muted">
        <span className="flex items-center space-x-1.5 font-bold text-onedark-accent">
          <Target className="w-3.5 h-3.5 shrink-0" />
          <span>Assigned Goal & Directives</span>
        </span>
        <div className="flex items-center space-x-2">
          <span className="text-[10px] text-onedark-muted font-mono tabular-nums">
            {description.length} chars
          </span>
          <button
            type="button"
            onClick={handleCopy}
            title="Copy full goal prompt"
            className="flex items-center space-x-1 px-2 py-0.5 rounded bg-onedark-surface hover:bg-onedark-darker text-onedark-muted hover:text-onedark-fg border border-onedark-borderSubtle/60 transition-colors"
          >
            {copied ? (
              <>
                <Check className="w-3 h-3 text-onedark-green" />
                <span className="text-onedark-green">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>
      </div>
      <div className="relative">
        <p className={`text-xs text-onedark-fgBright leading-relaxed whitespace-pre-wrap select-text font-sans ${
          isLong && !isExpanded ? 'line-clamp-4' : ''
        }`}>
          {description}
        </p>
        {isLong && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
            className="mt-1 text-[10.5px] font-mono text-onedark-accent hover:underline flex items-center space-x-1"
          >
            <span>{isExpanded ? 'Show less' : 'Show full goal'}</span>
            <ChevronDown className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>
    </div>
  );
});

SubagentGoalBanner.displayName = 'SubagentGoalBanner';

// Reusable Sleek Drawer Tab Header (Crisp segmented pill bar, no raw emojis)
const DrawerTabBar: React.FC<{
  activeTab: DrawerTab;
  onSelectTab: (tab: DrawerTab) => void;
  planCount?: number;
  logsCount?: number;
  hasResults?: boolean;
  resultsLabel?: string;
}> = ({ activeTab, onSelectTab, planCount = 0, logsCount = 0, hasResults, resultsLabel = 'Deliverables' }) => {
  return (
    <div className="flex items-center space-x-1 p-1 rounded-lg bg-onedark-darker/60 border border-onedark-borderSubtle/60 mb-3 text-xs font-mono select-none">
      <button
        type="button"
        onClick={() => onSelectTab('plan')}
        className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md font-medium transition-all ${
          activeTab === 'plan'
            ? 'bg-onedark-surface text-onedark-fgBright font-semibold shadow-xs border border-onedark-borderSubtle'
            : 'text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/30 border border-transparent'
        }`}
      >
        <ListChecks className={`w-3.5 h-3.5 ${activeTab === 'plan' ? 'text-onedark-accent' : 'text-onedark-muted'}`} />
        <span>Plan & Steps</span>
        {planCount > 0 && (
          <span className="px-1.5 py-0.2 rounded-full bg-onedark-darker text-[10px] text-onedark-muted border border-onedark-borderSubtle">
            {planCount}
          </span>
        )}
      </button>

      <button
        type="button"
        onClick={() => onSelectTab('logs')}
        className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md font-medium transition-all ${
          activeTab === 'logs'
            ? 'bg-onedark-surface text-onedark-fgBright font-semibold shadow-xs border border-onedark-borderSubtle'
            : 'text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/30 border border-transparent'
        }`}
      >
        <Terminal className={`w-3.5 h-3.5 ${activeTab === 'logs' ? 'text-onedark-accent' : 'text-onedark-muted'}`} />
        <span>Live Logs</span>
        {logsCount > 0 && (
          <span className="px-1.5 py-0.2 rounded-full bg-onedark-darker text-[10px] text-onedark-muted border border-onedark-borderSubtle tabular-nums">
            {logsCount}
          </span>
        )}
      </button>

      <button
        type="button"
        onClick={() => onSelectTab('results')}
        className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md font-medium transition-all ${
          activeTab === 'results'
            ? 'bg-onedark-surface text-onedark-fgBright font-semibold shadow-xs border border-onedark-borderSubtle'
            : 'text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/30 border border-transparent'
        }`}
      >
        <PackageCheck className={`w-3.5 h-3.5 ${activeTab === 'results' ? 'text-onedark-accent' : 'text-onedark-muted'}`} />
        <span>{resultsLabel}</span>
        {hasResults && (
          <span className="w-1.5 h-1.5 rounded-full bg-onedark-green" />
        )}
      </button>
    </div>
  );
};

// Helper to extract file references from subagent prompts
const extractTargetFiles = (text: string): string[] => {
  if (!text) return [];
  const regex = /(?:[\w\.\-\/]+)\.(?:ex|exs|py|ts|tsx|js|jsx|json|md|rs|go|yml|yaml|toml|lock|css|html)\b/gi;
  const matches = text.match(regex) || [];
  return Array.from(new Set(matches));
};

// Helper to generate a clean, distinct 1-word label for satellite constellation nodes
function getSatelliteLabel(sub: SubagentPod): string {
  const p = (sub.persona || '').toLowerCase();
  const r = (sub.role_definition || '').toLowerCase();
  const combined = `${p} ${r}`;

  if (combined.includes('architect')) return 'Architect';
  if (combined.includes('tooling')) return 'Tooling';
  if (combined.includes('observability') || combined.includes('telemetry') || combined.includes('tracing')) return 'Telemetry';
  if (combined.includes('skew') || combined.includes('dep') || combined.includes('config')) return 'Deps';
  if (combined.includes('doc') || combined.includes('synthesizer') || combined.includes('contract')) return 'Docs';
  if (combined.includes('qa') || combined.includes('test')) return 'QA';
  if (combined.includes('review') || combined.includes('pr')) return 'Review';
  if (combined.includes('supervis') || combined.includes('genserver') || combined.includes('otp')) return 'OTP';
  if (combined.includes('perf') || combined.includes('flame') || combined.includes('speed')) return 'Perf';
  if (combined.includes('trade') || combined.includes('market') || combined.includes('quant')) return 'Trading';
  if (combined.includes('data') || combined.includes('sql') || combined.includes('db')) return 'Data';
  if (combined.includes('security') || combined.includes('audit')) return 'Security';

  // Fallback: take clean title word or persona
  const cleanTitle = (sub.title || '').replace(/^Sagents vs /i, '').replace(/^Elixir /i, '').trim();
  const firstWord = cleanTitle.split(' ')[0];
  return firstWord || sub.persona || 'Pod';
}

export const AgentsTab: React.FC<AgentsTabProps> = ({ task, onOpenSubsession }) => {
  const { subscribe } = useWebSocket();

  const [subagents, setSubagents] = useState<SubagentPod[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedAgentIds, setExpandedAgentIds] = useState<Set<string>>(() => {
    // If task is completed, collapse orchestrator by default so worker pods are front-and-center
    if (task?.status === 'COMPLETED') return new Set<string>();
    return new Set(['orchestrator']);
  });
  const [activeDrawers, setActiveDrawers] = useState<Record<string, DrawerTab>>({ orchestrator: 'plan' });
  const [statusFilter, setStatusFilter] = useState<'all' | 'running' | 'completed' | 'failed'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSpawnModalOpen, setIsSpawnModalOpen] = useState(false);
  const [isApplyingDiff, setIsApplyingDiff] = useState<string | null>(null);
  const [applySuccessId, setApplySuccessId] = useState<string | null>(null);
  const [followUpInputs, setFollowUpInputs] = useState<Record<string, string>>({});
  const [isSendingPodMsg, setIsSendingPodMsg] = useState<Record<string, boolean>>({});
  const [expandedGoals, setExpandedGoals] = useState<Record<string, boolean>>({});
  const [copiedGoalId, setCopiedGoalId] = useState<string | null>(null);

  // Spawn Modal Form State
  const [spawnTitle, setSpawnTitle] = useState('');
  const [spawnPrompt, setSpawnPrompt] = useState('');
  const [spawnPersona, setSpawnPersona] = useState('SoftwareEngineer');
  const [spawnModel, setSpawnModel] = useState('');

  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const isSwarmPlanned = useMemo(() => {
    if (!task?.plan) return false;
    const cat = task.plan.intent_category;
    if (cat === 'parallel_swarm') return true;
    const ov = (task.plan.overview || '').toLowerCase();
    const obj = (task.plan.objective || '').toLowerCase();
    if (ov.includes('subagent') || ov.includes('parallel') || ov.includes('swarm') || obj.includes('subagent')) return true;
    if (task.plan.phases?.some((p) => (p.title || '').toLowerCase().includes('subagent') || (p.objective || '').toLowerCase().includes('subagent'))) return true;
    if (task.plan.steps?.some((s) => (s.title || '').toLowerCase().includes('subagent') || (s.title || '').toLowerCase().includes('pod'))) return true;
    return false;
  }, [task?.plan]);

  const plannedPodNames = useMemo(() => {
    if (!task?.plan) return [];
    const names: string[] = [];
    if (task.plan.steps) {
      for (const s of task.plan.steps) {
        const title = s.title || '';
        const match = title.match(/pod\s*\d*\s*[:\-]\s*(?:implement\s+)?([a-z0-9_\-\s]+?)(?:\s+module|\s*\(|$)/i);
        if (match && match[1]) {
          const clean = match[1].trim().split(' ')[0];
          if (clean && clean.length > 2 && !names.includes(clean)) names.push(clean);
        }
      }
    }
    if (names.length === 0 && isSwarmPlanned) {
      return ['Sources', 'Transforms', 'Sinks', 'Pipeline'];
    }
    return names.slice(0, 5);
  }, [task?.plan, isSwarmPlanned]);

  const fetchSubagents = useCallback(async () => {
    if (!task?.id || task.id.startsWith('temp-')) {
      setSubagents([]);
      return;
    }
    try {
      setIsLoading(true);
      const res = await fetch(`${API_BASE}/api/tasks/${task.id}/subagents`);
      if (res.ok) {
        const data = await res.json();
        setSubagents(data.subagents || []);
      }
    } catch (err) {
      console.error('Error fetching subagents:', err);
    } finally {
      setIsLoading(false);
    }
  }, [task?.id]);

  useEffect(() => {
    fetchSubagents();
  }, [fetchSubagents]);

  // WebSocket Live Telemetry Subscriptions
  useEffect(() => {
    if (!task?.id) return;

    const unSubCreated = subscribe('TASK_CREATED', (evt: any) => {
      if (evt.parent_task_id === task.id || evt.is_subsession) {
        fetchSubagents();
      }
    });

    const unSubStatus = subscribe('TASK_STATUS_CHANGE', (evt: any) => {
      if (evt.parent_task_id === task.id || subagents.some((s) => s.id === evt.task_id)) {
        setSubagents((prev) =>
          prev.map((s) => (s.id === evt.task_id ? { ...s, status: evt.status } : s))
        );
      }
    });

    const unSubToolStart = subscribe('TOOL_START', (evt: any) => {
      setSubagents((prev) =>
        prev.map((s) =>
          s.id === evt.task_id
            ? {
                ...s,
                active_tool: {
                  tool_name: evt.tool_name,
                  tool_input: evt.tool_input || {},
                  timestamp: evt.timestamp || new Date().toISOString()
                }
              }
            : s
        )
      );
    });

    const unSubToolEnd = subscribe('TOOL_END', (evt: any) => {
      setSubagents((prev) =>
        prev.map((s) => (s.id === evt.task_id ? { ...s, active_tool: null } : s))
      );
      fetchSubagents();
    });

    const unSubPlan = subscribe('TASK_PLAN_UPDATED', (evt: any) => {
      setSubagents((prev) =>
        prev.map((s) => (s.id === evt.task_id ? { ...s, plan: evt.plan } : s))
      );
    });

    const unSubCleared = subscribe('SUBAGENTS_CLEARED', (evt: any) => {
      if (evt.task_id === task.id) {
        setSubagents([]);
      }
    });

    return () => {
      unSubCreated();
      unSubStatus();
      unSubToolStart();
      unSubToolEnd();
      unSubPlan();
      unSubCleared();
    };
  }, [task?.id, subscribe, fetchSubagents, subagents]);

  const toggleExpandAgent = (id: string) => {
    setExpandedAgentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleExpandAll = () => {
    if (expandedAgentIds.size >= subagents.length + 1) {
      setExpandedAgentIds(new Set());
    } else {
      const allIds = new Set(['orchestrator', ...subagents.map((s) => s.id)]);
      setExpandedAgentIds(allIds);
    }
  };

  const scrollToCard = (id: string) => {
    if (!expandedAgentIds.has(id)) {
      setExpandedAgentIds((prev) => new Set(prev).add(id));
    }
    const el = cardRefs.current[id];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const handleApplyDiff = async (subagentId: string) => {
    if (!task?.id) return;
    try {
      setIsApplyingDiff(subagentId);
      const res = await fetch(`${API_BASE}/api/tasks/${task.id}/subagents/${subagentId}/apply-diff`, {
        method: 'POST'
      });
      if (res.ok) {
        setApplySuccessId(subagentId);
        setTimeout(() => setApplySuccessId(null), 3000);
      } else {
        const errData = await res.json().catch(() => ({}));
        alert(`Failed to apply diff: ${errData.detail || 'Unknown error'}`);
      }
    } catch (err) {
      console.error('Error applying subagent diff:', err);
    } finally {
      setIsApplyingDiff(null);
    }
  };

  const handleCancelAll = async () => {
    if (!task?.id) return;
    try {
      await fetch(`${API_BASE}/api/tasks/${task.id}/subagents/cancel-all`, { method: 'POST' });
      fetchSubagents();
    } catch (err) {
      console.error('Error cancelling all subagents:', err);
    }
  };

  const handleClearAll = async () => {
    if (!task?.id) return;
    try {
      setSubagents([]);
      await fetch(`${API_BASE}/api/tasks/${task.id}/subagents`, { method: 'DELETE' });
      fetchSubagents();
    } catch (err) {
      console.error('Error clearing all subagents:', err);
    }
  };

  const handleSpawnSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!task?.id || !spawnTitle.trim() || !spawnPrompt.trim()) return;

    try {
      const res = await fetch(`${API_BASE}/api/tasks/${task.id}/subagents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: spawnTitle.trim(),
          description: spawnPrompt.trim(),
          persona: spawnPersona,
          model_name: spawnModel || undefined
        })
      });
      if (res.ok) {
        setIsSpawnModalOpen(false);
        setSpawnTitle('');
        setSpawnPrompt('');
        fetchSubagents();
      }
    } catch (err) {
      console.error('Error spawning subagent:', err);
    }
  };

  const filteredSubagents = useMemo(() => {
    return subagents.filter((sub) => {
      if (statusFilter === 'running' && !(sub.status === 'RUNNING' || sub.status === 'INITIALIZING')) return false;
      if (statusFilter === 'completed' && sub.status !== 'COMPLETED') return false;
      if (statusFilter === 'failed' && !(sub.status === 'FAILED' || sub.status === 'CANCELLED')) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = sub.title.toLowerCase().includes(q);
        const matchesPersona = sub.persona.toLowerCase().includes(q);
        const matchesPrompt = sub.description.toLowerCase().includes(q);
        const matchesKey = (sub.session_key || '').toLowerCase().includes(q);
        if (!matchesTitle && !matchesPersona && !matchesPrompt && !matchesKey) return false;
      }
      return true;
    });
  }, [subagents, statusFilter, searchQuery]);

  const activeRunningCount = useMemo(() => {
    const subsRunning = subagents.filter((s) => s.status === 'RUNNING' || s.status === 'INITIALIZING').length;
    return (task?.status === 'RUNNING' ? 1 : 0) + subsRunning;
  }, [task?.status, subagents]);

  const completedCount = useMemo(() => {
    return subagents.filter((s) => s.status === 'COMPLETED').length;
  }, [subagents]);

  const totalTokens = useMemo(() => {
    const parentTokens = task?.total_tokens || 0;
    const subTokens = subagents.reduce((acc, s) => acc + (s.total_tokens || 0), 0);
    return parentTokens + subTokens;
  }, [task?.total_tokens, subagents]);

  const totalFilesTouched = useMemo(() => {
    const parentDiffs = task?.diffs?.length || 0;
    const subDiffs = subagents.reduce((acc, s) => acc + (s.diffs?.length || 0), 0);
    return parentDiffs + subDiffs;
  }, [task?.diffs, subagents]);

  const completionPercentage = useMemo(() => {
    if (subagents.length === 0) return 0;
    return Math.round((completedCount / subagents.length) * 100);
  }, [completedCount, subagents.length]);

  // Overall Goal Resolution
  const overallGoal = useMemo(() => {
    if (!task) return '';
    if (task.plan?.objective) return task.plan.objective;
    if (task.description && task.description.trim()) return task.description;
    if (task.title && task.title.trim()) return task.title;
    return 'Execute instructions and coordinate multi-agent workstreams.';
  }, [task]);

  // Orchestrator Strategic Decision Summary
  const orchestratorStrategy = useMemo(() => {
    if (!task) return null;
    if (subagents.length > 0) {
      return `Decomposed mission into ${subagents.length} parallel specialized pod${subagents.length > 1 ? 's' : ''} to execute concurrently across isolated workstreams.`;
    }
    if (task.active_tool) {
      const activeToolName = typeof task.active_tool === 'string' ? task.active_tool : task.active_tool.tool_name;
      if (activeToolName === 'delegate_subtasks') {
        return 'Analyzing task complexity and synthesizing multi-agent pod delegation plan.';
      }
      return `Executing single-agent tool pipeline: ${activeToolName}`;
    }
    if (task.plan?.overview) {
      return task.plan.overview;
    }
    return 'Lead Orchestrator is coordinating sequential phases and verifying deliverables.';
  }, [task, subagents]);

  const getPersonaConfig = (persona: string, roleDefinition?: string) => {
    const pLower = (persona || '').toLowerCase();
    const effectiveLabel = roleDefinition || persona || 'SoftwareEngineer';

    if (pLower.includes('architect') || pLower.includes('runtime')) {
      return {
        icon: Workflow,
        label: effectiveLabel,
        badgeClass: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/25',
        iconColor: 'text-indigo-400',
        iconBg: 'bg-indigo-500/10',
        badgeBorder: 'border-indigo-500/25',
        borderGlow: 'hover:border-indigo-500/40'
      };
    }
    if (pLower.includes('observability') || pLower.includes('telemetry') || pLower.includes('tracing') || pLower.includes('stream')) {
      return {
        icon: Activity,
        label: effectiveLabel,
        badgeClass: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25',
        iconColor: 'text-emerald-400',
        iconBg: 'bg-emerald-500/10',
        badgeBorder: 'border-emerald-500/25',
        borderGlow: 'hover:border-emerald-500/40'
      };
    }
    if (pLower.includes('tooling') || pLower.includes('security') || pLower.includes('audit')) {
      return {
        icon: ShieldCheck,
        label: effectiveLabel,
        badgeClass: 'bg-rose-500/10 text-rose-400 border-rose-500/25',
        iconColor: 'text-rose-400',
        iconBg: 'bg-rose-500/10',
        badgeBorder: 'border-rose-500/25',
        borderGlow: 'hover:border-rose-500/40'
      };
    }
    if (pLower.includes('config') || pLower.includes('dep') || pLower.includes('skew') || pLower.includes('package')) {
      return {
        icon: PackageCheck,
        label: effectiveLabel,
        badgeClass: 'bg-amber-500/10 text-amber-400 border-amber-500/25',
        iconColor: 'text-amber-400',
        iconBg: 'bg-amber-500/10',
        badgeBorder: 'border-amber-500/25',
        borderGlow: 'hover:border-amber-500/40'
      };
    }
    if (pLower.includes('doc') || pLower.includes('synthesizer') || pLower.includes('contract')) {
      return {
        icon: FileText,
        label: effectiveLabel,
        badgeClass: 'bg-sky-500/10 text-sky-400 border-sky-500/25',
        iconColor: 'text-sky-400',
        iconBg: 'bg-sky-500/10',
        badgeBorder: 'border-sky-500/25',
        borderGlow: 'hover:border-sky-500/40'
      };
    }
    if (pLower.includes('qa') || pLower.includes('test')) {
      return {
        icon: CheckCheck,
        label: effectiveLabel,
        badgeClass: 'bg-green-500/10 text-green-400 border-green-500/25',
        iconColor: 'text-green-400',
        iconBg: 'bg-green-500/10',
        badgeBorder: 'border-green-500/25',
        borderGlow: 'hover:border-green-500/40'
      };
    }
    if (pLower.includes('review') || pLower.includes('pr')) {
      return {
        icon: GitPullRequest,
        label: effectiveLabel,
        badgeClass: 'bg-purple-500/10 text-purple-400 border-purple-500/25',
        iconColor: 'text-purple-400',
        iconBg: 'bg-purple-500/10',
        badgeBorder: 'border-purple-500/25',
        borderGlow: 'hover:border-purple-500/40'
      };
    }
    if (pLower.includes('perf') || pLower.includes('flame') || pLower.includes('speed')) {
      return {
        icon: Flame,
        label: effectiveLabel,
        badgeClass: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/25',
        iconColor: 'text-yellow-400',
        iconBg: 'bg-yellow-500/10',
        badgeBorder: 'border-yellow-500/25',
        borderGlow: 'hover:border-yellow-500/40'
      };
    }
    if (pLower.includes('trade') || pLower.includes('market') || pLower.includes('finance') || pLower.includes('quant')) {
      return {
        icon: TrendingUp,
        label: effectiveLabel,
        badgeClass: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25',
        iconColor: 'text-emerald-400',
        iconBg: 'bg-emerald-500/10',
        badgeBorder: 'border-emerald-500/25',
        borderGlow: 'hover:border-emerald-500/40'
      };
    }
    if (pLower.includes('data') || pLower.includes('sql') || pLower.includes('db') || pLower.includes('etl')) {
      return {
        icon: Database,
        label: effectiveLabel,
        badgeClass: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/25',
        iconColor: 'text-cyan-400',
        iconBg: 'bg-cyan-500/10',
        badgeBorder: 'border-cyan-500/25',
        borderGlow: 'hover:border-cyan-500/40'
      };
    }

    return {
      icon: Code2,
      label: effectiveLabel,
      badgeClass: 'bg-onedark-accent/10 text-onedark-accent border-onedark-accent/25',
      iconColor: 'text-onedark-accent',
      iconBg: 'bg-onedark-accent/10',
      badgeBorder: 'border-onedark-accent/25',
      borderGlow: 'hover:border-onedark-accent/40'
    };
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'RUNNING':
      case 'INITIALIZING':
        return (
          <span className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full bg-onedark-yellow/10 text-onedark-yellow font-mono text-[10px] font-semibold border border-onedark-yellow/25 shadow-xs">
            <span className="relative flex h-1.5 w-1.5 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-onedark-yellow opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-onedark-yellow" />
            </span>
            <span>Running</span>
          </span>
        );
      case 'COMPLETED':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full bg-onedark-green/10 text-onedark-green font-mono text-[10px] font-semibold border border-onedark-green/25 shadow-xs">
            <CheckCircle2 className="w-3 h-3 shrink-0" />
            <span>Completed</span>
          </span>
        );
      case 'FAILED':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full bg-onedark-red/10 text-onedark-red font-mono text-[10px] font-semibold border border-onedark-red/25 shadow-xs">
            <AlertCircle className="w-3 h-3 shrink-0" />
            <span>Failed</span>
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full bg-onedark-surface text-onedark-muted font-mono text-[10px] font-medium border border-onedark-borderSubtle">
            <StopCircle className="w-3 h-3 shrink-0" />
            <span>Cancelled</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full bg-onedark-darker/60 text-onedark-muted/80 font-mono text-[10px] font-medium border border-onedark-borderSubtle/60">
            <span className="w-1.5 h-1.5 rounded-full bg-onedark-muted/40 shrink-0" />
            <span>Standby</span>
          </span>
        );
    }
  };

  if (!task) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center text-xs text-onedark-muted font-mono">
        <Cpu className="w-8 h-8 mb-2 text-onedark-muted/40" />
        <span>No active task session selected</span>
      </div>
    );
  }

  const isOrchestratorRunning = task.status === 'RUNNING' || task.status === 'INITIALIZING';

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4 font-sans text-onedark-fg bg-onedark-bg">
      {/* Pinned Sticky Swarm Execution Topology HUD (Attachment 2) */}
      {(subagents.length > 0 || (isSwarmPlanned && isOrchestratorRunning)) && (
        <div className="sticky top-0 z-30 -mx-4 -mt-4 px-4 pt-3 pb-2.5 bg-onedark-bg/95 backdrop-blur-md border-b border-onedark-borderSubtle/80 shadow-xs space-y-2">
          {/* Header Row */}
          <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-onedark-muted px-1">
            <span className="flex items-center space-x-1.5 font-bold text-onedark-fgBright">
              <Workflow className={`w-3.5 h-3.5 ${subagents.length === 0 ? 'text-onedark-yellow animate-spin' : 'text-onedark-accent'} shrink-0`} />
              <span>Swarm Execution Topology</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[9px] font-mono ${
                subagents.length === 0 
                  ? 'bg-onedark-yellow/10 text-onedark-yellow border border-onedark-yellow/30 animate-pulse'
                  : 'bg-onedark-surface text-onedark-accent border border-onedark-borderSubtle/60'
              }`}>
                {subagents.length > 0 ? `${subagents.length} Pods` : `${plannedPodNames.length} Pods Planned`}
              </span>
            </span>
            <div className="flex items-center space-x-2 font-semibold">
              {subagents.length > 0 ? (
                <>
                  <span className="text-onedark-yellow tabular-nums">{activeRunningCount} Active</span>
                  <span className="text-onedark-muted">·</span>
                  <span className="text-onedark-green tabular-nums">{completedCount} Done</span>
                </>
              ) : (
                <span className="text-onedark-yellow text-[10px] font-mono flex items-center space-x-1">
                  <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                  <span>Awaiting Dispatch</span>
                </span>
              )}
            </div>
          </div>

          {/* Node Constellation Map */}
          <div className="relative py-2 px-3 rounded-xl bg-onedark-darker/70 border border-onedark-borderSubtle/60 flex items-center justify-between overflow-x-auto no-scrollbar gap-3">
            {/* Root: Lead Orchestrator */}
            <div 
              onClick={() => scrollToCard('orchestrator')}
              className="relative z-10 flex flex-col items-center space-y-1 cursor-pointer group shrink-0"
              title="Jump to Session Lead Orchestrator"
            >
              <div className={`w-8 h-8 rounded-lg bg-onedark-surface border-2 flex items-center justify-center transition-all ${
                isOrchestratorRunning 
                  ? 'border-onedark-yellow text-onedark-yellow shadow-[0_0_10px_rgba(229,192,123,0.3)] animate-pulse' 
                  : 'border-onedark-accent text-onedark-accent group-hover:border-onedark-accent/80'
              }`}>
                <Bot className="w-4 h-4" />
              </div>
              <span className="block text-[9px] font-mono text-onedark-fgBright font-bold group-hover:text-onedark-accent transition-colors">
                Orchestrator
              </span>
            </div>

            {/* Central Dispatch RPC Conduit */}
            <div className="flex-1 flex items-center justify-center px-2 relative min-w-[50px]">
              <div className="w-full h-0.5 bg-onedark-borderSubtle relative overflow-hidden rounded-full">
                {(activeRunningCount > 0 || subagents.length === 0) && (
                  <div className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-onedark-yellow to-transparent animate-pulse" />
                )}
              </div>
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-5 h-5 rounded-md bg-onedark-surface border border-onedark-borderSubtle flex items-center justify-center text-onedark-muted shadow-2xs">
                <Zap className={`w-2.5 h-2.5 transition-colors ${activeRunningCount > 0 || subagents.length === 0 ? 'text-onedark-yellow animate-pulse' : 'text-onedark-muted/60'}`} />
              </div>
            </div>

            {/* Satellites: Spawned Worker Pods or Planned Ghost Pods */}
            <div className="flex items-center space-x-2.5 shrink-0 overflow-x-auto no-scrollbar py-0.5">
              {subagents.length > 0 ? (
                subagents.map((sub, idx) => {
                  const conf = getPersonaConfig(sub.persona, sub.role_definition);
                  const IconComp = conf.icon;
                  const isRunning = sub.status === 'RUNNING' || sub.status === 'INITIALIZING';
                  const isDone = sub.status === 'COMPLETED';
                  const label = getSatelliteLabel(sub);

                  return (
                    <div
                      key={sub.id}
                      onClick={() => scrollToCard(sub.id)}
                      className="flex flex-col items-center space-y-1 cursor-pointer group shrink-0"
                      title={`${sub.title} (${sub.persona}) - Status: ${sub.status}`}
                    >
                      <div className={`w-8 h-8 rounded-lg bg-onedark-surface border flex items-center justify-center transition-all ${
                        isRunning
                          ? 'border-onedark-yellow text-onedark-yellow shadow-[0_0_10px_rgba(229,192,123,0.35)] ring-1 ring-onedark-yellow/30 animate-pulse'
                          : isDone
                          ? 'border-onedark-green text-onedark-green bg-onedark-green/5'
                          : 'border-onedark-borderSubtle text-onedark-muted/60 group-hover:border-onedark-fg/40'
                      }`}>
                        <IconComp className="w-3.5 h-3.5" />
                      </div>
                      <span className="text-[9px] font-mono text-onedark-muted group-hover:text-onedark-fgBright transition-colors max-w-[65px] truncate text-center">
                        {label}
                      </span>
                    </div>
                  );
                })
              ) : (
                plannedPodNames.map((name, idx) => (
                  <div
                    key={idx}
                    className="flex flex-col items-center space-y-1 shrink-0 opacity-80"
                    title={`Planned worker pod: ${name} (Awaiting orchestrator dispatch)`}
                  >
                    <div className="w-8 h-8 rounded-lg bg-onedark-surface/40 border border-dashed border-onedark-yellow/40 flex items-center justify-center text-onedark-yellow/70 animate-pulse">
                      <Cpu className="w-3.5 h-3.5" />
                    </div>
                    <span className="text-[9px] font-mono text-onedark-yellow/80 max-w-[65px] truncate text-center">
                      {name}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Integrated Hairline Swarm Progress Bar */}
          <div className="w-full h-1 rounded-full bg-onedark-surface overflow-hidden border border-onedark-borderSubtle/40">
            <div 
              className={`h-full bg-gradient-to-r from-onedark-accent via-onedark-yellow to-onedark-green transition-all duration-300 rounded-full ${
                subagents.length === 0 ? 'w-1/4 animate-pulse' : ''
              }`}
              style={{ width: subagents.length > 0 ? `${completionPercentage}%` : '20%' }}
            />
          </div>
        </div>
      )}

      {/* 1. Unified Mission Control & Orchestrator Strategy Deck */}
      <div className="rounded-2xl bg-onedark-darker/90 border border-onedark-borderSubtle p-4 shadow-sm relative overflow-hidden backdrop-blur-xs space-y-3.5">
        {/* Mission Control Top Bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="p-1.5 rounded-lg bg-onedark-accent/10 border border-onedark-accent/20 text-onedark-accent">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-xs font-bold text-onedark-fgBright font-mono uppercase tracking-wider">
                  Mission Control
                </span>
                <span className="px-1.5 py-0.2 rounded text-[9.5px] font-mono bg-onedark-surface text-onedark-accent border border-onedark-borderSubtle">
                  {task.persona || 'SoftwareEngineer'}
                </span>
              </div>
              <span className="text-[10px] font-mono text-onedark-muted">
                {task.model_name || 'gemini-3.7-flash'} · {1 + subagents.length} Total Agents
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <SwarmTimer isRunning={activeRunningCount > 0} />
            <button
              onClick={fetchSubagents}
              className="p-1.5 rounded-lg text-onedark-muted hover:text-onedark-fgBright hover:bg-onedark-surface border border-transparent hover:border-onedark-borderSubtle transition-colors"
              title="Refresh Swarm Telemetry"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Overall Mission Goal & Strategic Decision Banner */}
        <div className="rounded-xl bg-onedark-surface/60 border border-onedark-borderSubtle/80 p-3 space-y-2.5">
          {/* Section A: Overall Goal */}
          <div className="space-y-1">
            <div className="flex items-center space-x-1.5 text-[10px] font-mono font-bold uppercase tracking-wider text-onedark-muted">
              <Target className="w-3.5 h-3.5 text-onedark-accent shrink-0" />
              <span>Overall Mission Goal</span>
            </div>
            <p className="text-xs text-onedark-fgBright font-medium leading-relaxed pl-5">
              {overallGoal}
            </p>
          </div>

          {/* Section B: Orchestrator Strategic Decision */}
          <div className="pt-2 border-t border-onedark-borderSubtle/60 space-y-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-1.5 text-[10px] font-mono font-bold uppercase tracking-wider text-onedark-muted">
                <Sparkles className="w-3.5 h-3.5 text-onedark-yellow shrink-0" />
                <span>Orchestration Strategy & Decision</span>
              </div>
              {subagents.length > 0 && (
                <span className="text-[9.5px] font-mono px-2 py-0.5 rounded-full bg-onedark-yellow/10 text-onedark-yellow border border-onedark-yellow/20">
                  {subagents.length} Spawned Pods
                </span>
              )}
            </div>
            <p className="text-[11.5px] text-onedark-fg/90 font-sans leading-relaxed pl-5">
              {orchestratorStrategy}
            </p>
          </div>
        </div>

        {/* Global Swarm Metrics Bar (Fixed Tabular Nums) */}
        <div className="grid grid-cols-4 gap-2 pt-1 text-center font-mono">
          <div className="p-2 rounded-xl bg-onedark-surface/40 border border-onedark-borderSubtle/60">
            <div className="text-[9px] uppercase tracking-wider text-onedark-muted">Active</div>
            <div className="text-xs font-bold text-onedark-yellow mt-0.5 tabular-nums">{activeRunningCount}</div>
          </div>
          <div className="p-2 rounded-xl bg-onedark-surface/40 border border-onedark-borderSubtle/60">
            <div className="text-[9px] uppercase tracking-wider text-onedark-muted">Tokens</div>
            <div className="text-xs font-bold text-onedark-accent mt-0.5 tabular-nums">{totalTokens.toLocaleString()}</div>
          </div>
          <div className="p-2 rounded-xl bg-onedark-surface/40 border border-onedark-borderSubtle/60">
            <div className="text-[9px] uppercase tracking-wider text-onedark-muted">Modified</div>
            <div className="text-xs font-bold text-onedark-green mt-0.5 tabular-nums">{totalFilesTouched}</div>
          </div>
          <div className="p-2 rounded-xl bg-onedark-surface/40 border border-onedark-borderSubtle/60">
            <div className="text-[9px] uppercase tracking-wider text-onedark-muted">Finished</div>
            <div className="text-xs font-bold text-onedark-fgBright mt-0.5 tabular-nums">{completedCount}</div>
          </div>
        </div>
      </div>

      {/* 2. Orchestrator Section (Main Session Lead) */}
      <div className="space-y-2" ref={(el) => (cardRefs.current['orchestrator'] = el)}>
        <div className="text-[10px] uppercase font-bold text-onedark-muted font-mono tracking-wider px-1 flex items-center justify-between">
          <span>Session Orchestrator</span>
          <span className="text-[10px] font-mono text-onedark-accent">Root Engine</span>
        </div>

        <div className="rounded-xl border border-onedark-borderSubtle bg-onedark-surface/70 overflow-hidden shadow-sm transition-colors hover:border-onedark-border">
          {/* Card Header */}
          <div 
            onClick={() => toggleExpandAgent('orchestrator')}
            className="p-3.5 cursor-pointer select-none space-y-2.5 hover:bg-onedark-surface/90 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3 font-medium text-onedark-fgBright">
                <div className="p-2 rounded-xl border bg-onedark-darker border-onedark-borderSubtle text-onedark-accent">
                  <Bot className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-bold text-onedark-fgBright">{task.persona || 'SoftwareEngineer'}</span>
                    <span className="px-1.5 py-0.2 rounded text-[9.5px] font-mono bg-onedark-accent/10 text-onedark-accent border border-onedark-accent/20">
                      Lead Orchestrator
                    </span>
                  </div>
                  <div className="flex items-center space-x-2 text-[10px] font-mono text-onedark-muted mt-0.5">
                    <span className="text-onedark-accent font-medium">{task.model_name || 'gemini-3.7-flash'}</span>
                    <span>·</span>
                    <span className="tabular-nums">{(task.logs || []).length} ops</span>
                    <span>·</span>
                    <span className="tabular-nums">{task.total_tokens || 0} tokens</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                {getStatusBadge(task.status)}
                {expandedAgentIds.has('orchestrator') ? (
                  <ChevronDown className="w-4 h-4 text-onedark-muted" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-onedark-muted" />
                )}
              </div>
            </div>

            {/* Stabilized Live Tool Slot with Fixed Boundary */}
            <div className="min-h-[28px] flex items-center">
              {task.active_tool ? (
                <div className="w-full flex items-center space-x-2 px-2.5 py-1 rounded-lg bg-onedark-yellow/10 border border-onedark-yellow/25 text-[11px] font-mono text-onedark-yellow">
                  <Activity className="w-3.5 h-3.5 animate-spin text-onedark-yellow shrink-0" />
                  <span className="truncate">
                    Active tool: {typeof task.active_tool === 'string' ? task.active_tool : task.active_tool.tool_name}
                  </span>
                </div>
              ) : (
                <p className="text-[11px] text-onedark-muted font-sans truncate">
                  Orchestrator coordinating session plan and delegating tasks.
                </p>
              )}
            </div>
          </div>

          {/* Orchestrator Drawer */}
          {expandedAgentIds.has('orchestrator') && (
            <div className="border-t border-onedark-borderSubtle bg-onedark-darker/70 p-3.5 space-y-3">
              <DrawerTabBar
                activeTab={activeDrawers.orchestrator || 'plan'}
                onSelectTab={(t) => setActiveDrawers((prev) => ({ ...prev, orchestrator: t }))}
                planCount={task.plan?.phases?.length || task.plan?.steps?.length || 0}
                logsCount={(task.logs || []).length}
                hasResults={!!task.result_summary}
                resultsLabel="Deliverables"
              />

              {/* Drawer Content: Plan & Steps (Compact Interconnected Stepper) */}
              {(activeDrawers.orchestrator || 'plan') === 'plan' && (
                <div className="space-y-3">
                  {task.plan?.phases && task.plan.phases.length > 0 ? (
                    <div className="relative pl-4 border-l border-onedark-borderSubtle space-y-3 ml-2">
                      {task.plan.phases.map((phase, idx) => {
                        const { badge, cleanTitle } = formatPhaseTitle(phase.phase_number || idx + 1, phase.title);

                        return (
                          <div key={idx} className="relative space-y-1 group">
                            {/* Timeline Node Bullet */}
                            <div className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-onedark-darker border-2 border-onedark-accent shrink-0 group-hover:scale-110 transition-transform" />

                            <div className="p-2.5 rounded-lg bg-onedark-surface/50 border border-onedark-borderSubtle hover:border-onedark-border transition-colors">
                              <div className="flex items-center space-x-2">
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-onedark-darker text-onedark-accent border border-onedark-borderSubtle">
                                  {badge}
                                </span>
                                <span className="text-xs font-bold text-onedark-fgBright truncate">{cleanTitle}</span>
                              </div>
                              {phase.objective && (
                                <p className="text-[11.5px] text-onedark-muted font-sans mt-1 leading-relaxed pl-0.5">
                                  {phase.objective}
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : task.plan?.steps && task.plan.steps.length > 0 ? (
                    <div className="space-y-1.5">
                      {task.plan.steps.map((step, idx) => (
                        <div key={step.id || idx} className="flex items-center space-x-2.5 p-2 rounded-lg bg-onedark-surface/40 border border-onedark-borderSubtle/60 text-xs font-mono">
                          {step.status === 'completed' ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-onedark-green shrink-0" />
                          ) : (
                            <Circle className="w-3.5 h-3.5 text-onedark-muted/60 shrink-0" />
                          )}
                          <span className="truncate text-onedark-fg">{step.title}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-4 text-center text-onedark-muted text-xs font-mono">
                      No structured plan generated yet.
                    </div>
                  )}
                </div>
              )}

              {/* Drawer Content: Logs (Structured Tool Span Viewer) */}
              {activeDrawers.orchestrator === 'logs' && (
                <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                  {(task.logs || []).slice(-15).map((log, idx) => (
                    <ToolLogItem key={log.id || idx} log={log} index={idx} />
                  ))}
                  {(!task.logs || task.logs.length === 0) && (
                    <div className="p-4 text-center text-onedark-muted text-xs font-mono">
                      No tool executions recorded.
                    </div>
                  )}
                </div>
              )}

              {/* Drawer Content: Deliverables */}
              {activeDrawers.orchestrator === 'results' && (
                <div className="space-y-2">
                  {task.result_summary ? (
                    <div className="p-3.5 rounded-lg bg-onedark-surface/50 border border-onedark-borderSubtle font-sans text-xs text-onedark-fg leading-relaxed max-h-[600px] overflow-y-auto">
                      <MarkdownRenderer content={task.result_summary} />
                    </div>
                  ) : (
                    <div className="p-4 text-center text-onedark-muted font-mono text-xs">
                      Synthesis pending task completion.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 3. Worker Pods Roster (Subagents) */}
      <div className="space-y-3 pt-2">
        {/* Roster Controls Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex items-center space-x-2">
            <span className="text-[10px] uppercase font-bold text-onedark-muted font-mono tracking-wider px-1">
              Worker Pods ({filteredSubagents.length})
            </span>
            <button
              onClick={toggleExpandAll}
              className="text-[10px] font-mono text-onedark-accent hover:underline flex items-center space-x-1"
            >
              <ChevronsUpDown className="w-3 h-3" />
              <span>{expandedAgentIds.size >= subagents.length + 1 ? 'Collapse All' : 'Expand All'}</span>
            </button>
          </div>

          <div className="flex items-center space-x-2">
            {/* Filter Pills */}
            <div className="flex items-center space-x-0.5 bg-onedark-surface p-0.5 rounded-lg border border-onedark-borderSubtle font-mono text-[9.5px]">
              {(['all', 'running', 'completed'] as const).map((filter) => (
                <button
                  key={filter}
                  onClick={() => setStatusFilter(filter)}
                  className={`px-2.5 py-0.5 rounded capitalize transition-colors ${
                    statusFilter === filter
                      ? 'bg-onedark-darker text-onedark-fgBright font-bold shadow-xs border border-onedark-borderSubtle'
                      : 'text-onedark-muted hover:text-onedark-fg border border-transparent'
                  }`}
                >
                  {filter}
                </button>
              ))}
            </div>

            {/* Stop Swarm Button */}
            {activeRunningCount > 1 && (
              <button
                onClick={handleCancelAll}
                className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg border border-onedark-red/30 bg-onedark-red/10 text-onedark-red font-mono text-[10px] font-bold hover:bg-onedark-red/20 transition-colors shadow-xs"
                title="Cancel all active subagents"
              >
                <StopCircle className="w-3 h-3" />
                <span>Stop Swarm</span>
              </button>
            )}

            {/* Clear Swarm Button */}
            {subagents.length > 0 && (
              <button
                onClick={handleClearAll}
                className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg border border-onedark-borderSubtle bg-onedark-surface text-onedark-muted hover:text-onedark-red hover:border-onedark-red/30 hover:bg-onedark-red/10 font-mono text-[10px] font-bold transition-colors shadow-xs"
                title="Clear all subagents (cancels running and removes completed pods)"
              >
                <Trash2 className="w-3 h-3" />
                <span>Clear Swarm</span>
              </button>
            )}

            {/* Quick Actions */}
            <button
              onClick={() => setIsSpawnModalOpen(true)}
              className="flex items-center space-x-1.5 px-3 py-1 rounded-lg bg-onedark-accent text-onedark-darker font-mono text-[10px] font-bold hover:bg-onedark-accent/90 transition-colors shadow-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Spawn Pod</span>
            </button>
          </div>
        </div>

        {/* Live Search & Filter Bar */}
        {subagents.length > 2 && (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-onedark-muted pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter pods by title, persona, prompt..."
              className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-onedark-surface border border-onedark-borderSubtle text-xs text-onedark-fg placeholder:text-onedark-muted focus:outline-none focus:ring-1 focus:ring-onedark-accent/40 focus:border-onedark-accent font-sans transition-colors"
            />
          </div>
        )}

        {/* Worker Cards List */}
        <div className="space-y-3">
          {filteredSubagents.map((sub) => {
            const isExpanded = expandedAgentIds.has(sub.id);
            const currentDrawer = activeDrawers[sub.id] || 'results';
            const isRunning = sub.status === 'RUNNING' || sub.status === 'INITIALIZING';
            const isStandby = sub.status !== 'RUNNING' && sub.status !== 'INITIALIZING' && sub.status !== 'COMPLETED' && sub.status !== 'FAILED';
            const conf = getPersonaConfig(sub.persona, sub.role_definition);
            const IconComp = conf.icon;
            const targetFiles = extractTargetFiles(sub.description);

            const completedSteps = sub.plan?.steps ? sub.plan.steps.filter((s) => s.status === 'completed').length : 0;
            const totalSteps = sub.plan?.steps ? sub.plan.steps.length : 0;
            const hasDeliverable = Boolean(sub.result_summary && sub.result_summary.trim().length > 0);
            const hasDiffs = Boolean(sub.diffs && sub.diffs.length > 0);

            return (
              <div 
                key={sub.id} 
                ref={(el) => (cardRefs.current[sub.id] = el)}
                className={`rounded-xl border transition-all duration-200 overflow-hidden shadow-xs group ${
                  isRunning
                    ? 'bg-onedark-darker/90 border-onedark-yellow/40 shadow-[0_0_15px_rgba(229,192,123,0.12)] ring-1 ring-onedark-yellow/20'
                    : isStandby
                    ? 'bg-onedark-surface/40 hover:bg-onedark-surface/70 border-onedark-borderSubtle/60 opacity-90'
                    : 'bg-onedark-surface/60 hover:bg-onedark-surface/90 border-onedark-borderSubtle'
                }`}
              >
                {/* Header card */}
                <div 
                  onClick={() => toggleExpandAgent(sub.id)}
                  className="p-3.5 cursor-pointer select-none space-y-2.5"
                >
                  {/* Top Row: Avatar, Title, Role Pill, Status & Chevron */}
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center space-x-3 min-w-0 flex-1">
                      <div className={`p-2 rounded-xl border shrink-0 transition-transform group-hover:scale-105 ${
                        isRunning 
                          ? 'bg-onedark-yellow/10 border-onedark-yellow/30 text-onedark-yellow animate-pulse' 
                          : `${conf.iconBg} ${conf.badgeBorder} ${conf.iconColor}`
                      }`}>
                        <IconComp className="w-4 h-4" />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center flex-wrap gap-2">
                          <h4 className="text-xs font-bold text-onedark-fgBright truncate leading-tight">
                            {sub.title}
                          </h4>
                          <span 
                            title={sub.role_definition || sub.persona}
                            className={`px-2 py-0.5 rounded-full text-[9px] font-mono font-medium border shrink-0 ${conf.badgeClass}`}
                          >
                            {sub.persona}
                          </span>
                        </div>

                        <div className="flex items-center space-x-2 text-[10px] font-mono text-onedark-muted mt-1">
                          <span className="text-onedark-accent font-medium">{sub.model_name || 'deepseek-v4-pro'}</span>
                          <span>·</span>
                          <span className="tabular-nums">{(sub.logs || []).length} ops</span>
                          <span>·</span>
                          <span className="tabular-nums">{(sub.total_tokens || 0).toLocaleString()} tokens</span>
                          {sub.session_key && (
                            <>
                              <span>·</span>
                              <span className="text-onedark-fg/60 truncate max-w-[140px]">{sub.session_key}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2 shrink-0">
                      {getStatusBadge(sub.status)}
                      <div className="p-1 rounded-md text-onedark-muted hover:text-onedark-fg transition-colors">
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Active Tool Live Telemetry Banner (When Running) */}
                  {sub.active_tool && (
                    <div className="w-full flex items-center space-x-2 px-2.5 py-1.5 rounded-lg bg-onedark-yellow/10 border border-onedark-yellow/25 text-[11px] font-mono text-onedark-yellow animate-pulse">
                      <Activity className="w-3.5 h-3.5 animate-spin text-onedark-yellow shrink-0" />
                      <span className="truncate">
                        ⚡ {typeof sub.active_tool === 'string' ? sub.active_tool : sub.active_tool.tool_name}
                        {typeof sub.active_tool === 'object' && sub.active_tool.tool_input?.query && `: "${sub.active_tool.tool_input.query}"`}
                      </span>
                    </div>
                  )}

                  {/* Deliverable & Outcome Metric Strip (When Completed / In Progress with deliverables) */}
                  {(hasDeliverable || hasDiffs || totalSteps > 0) && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-[10.5px] font-mono">
                      {hasDeliverable && (
                        <div className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-onedark-green/10 text-onedark-green border border-onedark-green/20 font-semibold shadow-2xs">
                          <FileText className="w-3 h-3 shrink-0" />
                          <span>Report ({sub.result_summary && sub.result_summary.length > 1024 ? `${(sub.result_summary.length / 1024).toFixed(1)} KB` : `${sub.result_summary?.length || 0} B`})</span>
                        </div>
                      )}
                      {hasDiffs && (
                        <div className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-onedark-accent/10 text-onedark-accent border border-onedark-accent/20 font-semibold shadow-2xs">
                          <GitCompare className="w-3 h-3 shrink-0" />
                          <span>{sub.diffs!.length} file{sub.diffs!.length > 1 ? 's' : ''} modified (+{sub.diffs!.reduce((a, d) => a + (d.additions || 0), 0)}, -{sub.diffs!.reduce((a, d) => a + (d.deletions || 0), 0)})</span>
                        </div>
                      )}
                      {totalSteps > 0 && (
                        <div className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-onedark-darker/60 text-onedark-muted border border-onedark-borderSubtle">
                          <CheckCircle2 className="w-3 h-3 text-onedark-green shrink-0" />
                          <span className="tabular-nums">
                            {completedSteps}/{totalSteps} steps completed
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Inset Mission Scope Box */}
                  {sub.description && (
                    <div className="rounded-lg bg-onedark-darker/60 border border-onedark-borderSubtle/60 p-2.5 space-y-1.5 transition-colors">
                      <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-onedark-muted">
                        <span className="flex items-center space-x-1.5 font-semibold text-onedark-fg/70">
                          <Target className="w-3.5 h-3.5 text-onedark-accent shrink-0" />
                          <span>Assigned Scope</span>
                        </span>
                        <div className="flex items-center space-x-2">
                          <span className="text-[9.5px] font-mono text-onedark-muted tabular-nums">
                            {sub.description.length} chars
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigator.clipboard.writeText(sub.description);
                              setCopiedGoalId(sub.id);
                              setTimeout(() => setCopiedGoalId(null), 2000);
                            }}
                            title="Copy full assigned scope"
                            className="p-1 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg transition-colors"
                          >
                            {copiedGoalId === sub.id ? <Check className="w-3 h-3 text-onedark-green" /> : <Copy className="w-3 h-3" />}
                          </button>
                        </div>
                      </div>

                      <div className="relative">
                        <p 
                          title={sub.description}
                          className={`text-[11.5px] text-onedark-fg/80 leading-relaxed font-sans transition-all ${
                            expandedGoals[sub.id] ? 'whitespace-pre-wrap' : 'line-clamp-2'
                          }`}
                        >
                          {sub.description}
                        </p>

                        {sub.description.length > 110 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedGoals((prev) => ({ ...prev, [sub.id]: !prev[sub.id] }));
                            }}
                            className="mt-1 text-[10px] font-mono text-onedark-accent hover:underline flex items-center space-x-1"
                          >
                            <span>{expandedGoals[sub.id] ? 'Show less' : 'Expand full directive'}</span>
                            <ChevronDown className={`w-3 h-3 transition-transform ${expandedGoals[sub.id] ? 'rotate-180' : ''}`} />
                          </button>
                        )}
                      </div>

                      {/* Extracted file target chips */}
                      {targetFiles.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-onedark-borderSubtle/30">
                          <span className="text-[9px] font-mono text-onedark-muted uppercase tracking-wider">Targets:</span>
                          {targetFiles.slice(0, 4).map((f, i) => {
                            const fileName = f.split('/').pop() || f;
                            return (
                              <span
                                key={i}
                                title={f}
                                className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded bg-onedark-surface/80 text-onedark-fgBright border border-onedark-borderSubtle text-[10px] font-mono"
                              >
                                <FileCode2 className="w-2.5 h-2.5 text-onedark-accent shrink-0" />
                                <span className="truncate max-w-[120px]">{fileName}</span>
                              </span>
                            );
                          })}
                          {targetFiles.length > 4 && (
                            <span className="text-[9px] font-mono text-onedark-muted px-1">
                              +{targetFiles.length - 4} more
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Expandable 3-Tab Telemetry Drawer */}
                {isExpanded && (
                  <div className="border-t border-onedark-borderSubtle bg-onedark-darker/70 p-3.5 space-y-3 text-xs font-mono">
                    {/* Dedicated Subagent Goal Banner */}
                    <SubagentGoalBanner description={sub.description} />

                    <DrawerTabBar
                      activeTab={currentDrawer}
                      onSelectTab={(t) => setActiveDrawers((prev) => ({ ...prev, [sub.id]: t }))}
                      planCount={sub.plan?.steps?.length || 0}
                      logsCount={(sub.logs || []).length}
                      hasResults={!!sub.result_summary || (sub.diffs && sub.diffs.length > 0)}
                      resultsLabel="Results & Diff"
                    />

                    {/* Tab 1: Plan & Steps */}
                    {currentDrawer === 'plan' && (
                      <div className="space-y-2">
                        {sub.plan?.objective && (
                          <div className="p-2.5 rounded-lg bg-onedark-surface/40 border border-onedark-borderSubtle/60 text-xs font-sans text-onedark-fg leading-relaxed">
                            <span className="text-onedark-accent font-mono text-[10px] font-bold uppercase tracking-wider block mb-1">
                              Plan Objective:
                            </span>
                            {sub.plan.objective}
                          </div>
                        )}
                        {sub.plan?.steps && sub.plan.steps.length > 0 ? (
                          <div className="space-y-1.5">
                            {sub.plan.steps.map((step, idx) => (
                              <div key={step.id || idx} className="flex items-center space-x-2.5 p-2 rounded-lg bg-onedark-surface/40 border border-onedark-borderSubtle/60">
                                {step.status === 'completed' ? (
                                  <CheckCircle2 className="w-3.5 h-3.5 text-onedark-green shrink-0" />
                                ) : (
                                  <Circle className="w-3.5 h-3.5 text-onedark-muted/60 shrink-0" />
                                )}
                                <span className="truncate text-onedark-fg">{step.title}</span>
                              </div>
                            ))}
                          </div>
                        ) : !sub.plan?.objective ? (
                          <div className="p-3 rounded-lg bg-onedark-surface/40 border border-onedark-borderSubtle text-onedark-muted text-[11.5px] font-sans leading-relaxed">
                            {sub.description}
                          </div>
                        ) : null}
                      </div>
                    )}

                    {/* Tab 2: Logs (Structured Tool Span Viewer) */}
                    {currentDrawer === 'logs' && (
                      <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                        {(sub.logs || []).map((log, idx) => (
                          <ToolLogItem key={log.id || idx} log={log} index={idx} />
                        ))}
                        {(!sub.logs || sub.logs.length === 0) && (
                          <div className="p-4 text-center text-onedark-muted text-xs">
                            No tool invocations recorded.
                          </div>
                        )}
                      </div>
                    )}

                    {/* Tab 3: Results & Diff */}
                    {currentDrawer === 'results' && (
                      <div className="space-y-3 font-sans">
                        {sub.result_summary ? (
                          <div className="p-3.5 rounded-lg bg-onedark-surface/50 border border-onedark-borderSubtle text-xs text-onedark-fg leading-relaxed max-h-[600px] overflow-y-auto">
                            <MarkdownRenderer content={sub.result_summary} />
                          </div>
                        ) : (
                          <div className="p-4 text-center text-onedark-muted text-xs">
                            No final deliverables or report recorded yet.
                          </div>
                        )}

                        {/* Diff stats & interactive file diff viewer */}
                        {sub.diffs && sub.diffs.length > 0 ? (
                          <div className="space-y-2">
                            <div className="p-3 rounded-lg bg-onedark-surface/60 border border-onedark-borderSubtle flex items-center justify-between">
                              <div className="flex items-center space-x-2 text-xs font-mono">
                                <GitCompare className="w-4 h-4 text-onedark-accent" />
                                <span className="font-bold text-onedark-fgBright">
                                  {sub.diffs.length} file{sub.diffs.length > 1 ? 's' : ''} modified
                                </span>
                                <span className="text-[10px] text-onedark-green font-semibold">
                                  +{sub.diffs.reduce((acc, d) => acc + (d.additions || 0), 0)}
                                </span>
                                <span className="text-[10px] text-onedark-red font-semibold">
                                  -{sub.diffs.reduce((acc, d) => acc + (d.deletions || 0), 0)}
                                </span>
                              </div>

                              <button
                                onClick={() => handleApplyDiff(sub.id)}
                                disabled={isApplyingDiff === sub.id}
                                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg font-mono text-[11px] font-semibold transition-all shadow-xs ${
                                  applySuccessId === sub.id
                                    ? 'bg-onedark-green text-onedark-darker'
                                    : 'bg-onedark-accent text-onedark-darker hover:bg-onedark-accent/90'
                                }`}
                              >
                                {applySuccessId === sub.id ? (
                                  <>
                                    <Check className="w-3.5 h-3.5" />
                                    <span>Applied to Workspace!</span>
                                  </>
                                ) : isApplyingDiff === sub.id ? (
                                  <>
                                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                    <span>Applying Patch...</span>
                                  </>
                                ) : (
                                  <>
                                    <CheckCheck className="w-3.5 h-3.5" />
                                    <span>Apply Diff to Workspace</span>
                                  </>
                                )}
                              </button>
                            </div>

                            {/* Itemized file diff cards with expandable diff hunk */}
                            <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
                              {sub.diffs.map((diffItem, dIdx) => (
                                <SubagentDiffItem key={diffItem.id || dIdx} diff={diffItem} />
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="px-3 py-2 rounded-lg bg-onedark-surface/30 border border-onedark-borderSubtle/50 text-[11px] font-mono text-onedark-muted flex items-center space-x-2">
                            <Info className="w-3.5 h-3.5 text-onedark-blue shrink-0" />
                            <span>Analytical / Research Pod (No filesystem mutations)</span>
                          </div>
                        )}

                        {/* Follow-up / Iteration Prompt Bar */}
                        <form
                          onSubmit={async (e) => {
                            e.preventDefault();
                            const inputVal = followUpInputs[sub.id] || '';
                            if (!inputVal.trim() || !task?.id || isSendingPodMsg[sub.id]) return;
                            try {
                              setIsSendingPodMsg((prev) => ({ ...prev, [sub.id]: true }));
                              const res = await fetch(`${API_BASE}/api/tasks/${task.id}/subagents/${sub.id}/messages`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ content: inputVal.trim() })
                              });
                              if (res.ok) {
                                setFollowUpInputs((prev) => ({ ...prev, [sub.id]: '' }));
                                fetchSubagents();
                              }
                            } catch (err) {
                              console.error('Failed to send pod instruction:', err);
                            } finally {
                              setIsSendingPodMsg((prev) => ({ ...prev, [sub.id]: false }));
                            }
                          }}
                          className="pt-2 flex items-center space-x-2 border-t border-onedark-borderSubtle/60"
                        >
                          <input
                            type="text"
                            value={followUpInputs[sub.id] || ''}
                            onChange={(e) => setFollowUpInputs((prev) => ({ ...prev, [sub.id]: e.target.value }))}
                            placeholder={`Instruct ${sub.title}... (e.g. "Add tests for edge cases")`}
                            disabled={isRunning}
                            className="flex-1 px-3 py-1.5 rounded-lg bg-onedark-surface border border-onedark-borderSubtle text-xs text-onedark-fg placeholder:text-onedark-muted focus:outline-none focus:ring-1 focus:ring-onedark-accent/40 focus:border-onedark-accent font-sans transition-colors disabled:opacity-50"
                          />
                          <button
                            type="submit"
                            disabled={isRunning || !(followUpInputs[sub.id] || '').trim() || isSendingPodMsg[sub.id]}
                            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-onedark-accent text-onedark-darker font-mono text-[11px] font-semibold hover:bg-onedark-accent/90 disabled:opacity-40 transition-colors shrink-0 shadow-xs"
                          >
                            {isSendingPodMsg[sub.id] ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <ArrowRight className="w-3.5 h-3.5" />
                            )}
                            <span>Iterate</span>
                          </button>
                        </form>

                        {/* Subsession drilldown link */}
                        {onOpenSubsession && (
                          <div className="pt-1 flex justify-end">
                            <button
                              onClick={() => onOpenSubsession(sub.id)}
                              className="flex items-center space-x-1 text-[11px] font-mono text-onedark-accent hover:underline"
                            >
                              <span>Open full sub-session conversation</span>
                              <ExternalLink className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {filteredSubagents.length === 0 && (
            isSwarmPlanned && isOrchestratorRunning ? (
              <div className="p-8 text-center rounded-2xl bg-onedark-yellow/5 border border-dashed border-onedark-yellow/30 space-y-3">
                <div className="w-10 h-10 mx-auto rounded-xl bg-onedark-yellow/10 border border-onedark-yellow/30 flex items-center justify-center text-onedark-yellow">
                  <Workflow className="w-5 h-5 animate-pulse" />
                </div>
                <div className="space-y-1">
                  <div className="text-xs font-bold text-onedark-fgBright flex items-center justify-center space-x-2">
                    <span>Orchestrator Preparing Swarm Dispatch</span>
                    <span className="w-1.5 h-1.5 rounded-full bg-onedark-yellow animate-ping" />
                  </div>
                  <p className="text-[11px] text-onedark-muted max-w-md mx-auto font-sans">
                    The active execution plan specifies a parallel multi-agent swarm ({plannedPodNames.join(', ')}). The Lead Orchestrator is grounding workspace context and will dispatch worker pods concurrently.
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                  {plannedPodNames.map((name, i) => (
                    <span key={i} className="px-2.5 py-1 rounded-lg bg-onedark-surface/80 border border-onedark-borderSubtle text-[10.5px] font-mono text-onedark-fg flex items-center space-x-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-onedark-yellow/70 animate-pulse" />
                      <span>Planned: {name}</span>
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div className="p-8 text-center rounded-2xl bg-onedark-surface/30 border border-dashed border-onedark-borderSubtle space-y-3">
                <Cpu className="w-9 h-9 mx-auto text-onedark-muted/40" />
                <div className="space-y-1">
                  <div className="text-xs font-bold text-onedark-fgBright">No matching worker pods</div>
                  <p className="text-[11px] text-onedark-muted max-w-sm mx-auto font-sans">
                    The orchestrator can autonomously dispatch parallel subagents (PR reviews, security audits, test suites) or you can launch one manually.
                  </p>
                </div>
                <button
                  onClick={() => setIsSpawnModalOpen(true)}
                  className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-lg bg-onedark-surface border border-onedark-borderSubtle text-xs font-mono font-medium hover:border-onedark-accent text-onedark-fgBright transition-colors"
                >
                  <Plus className="w-3.5 h-3.5 text-onedark-accent" />
                  <span>Spawn Custom Worker Pod</span>
                </button>
              </div>
            )
          )}
        </div>
      </div>

      {/* 4. Spawn Worker Pod Modal */}
      {isSpawnModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-onedark-darker border border-onedark-borderSubtle rounded-2xl p-5 max-w-md w-full shadow-xl space-y-4 font-sans text-onedark-fg">
            <div className="flex items-center justify-between border-b border-onedark-borderSubtle pb-3">
              <div className="flex items-center space-x-2">
                <Cpu className="w-4 h-4 text-onedark-accent" />
                <span className="text-xs font-bold text-onedark-fgBright font-mono uppercase tracking-wide">
                  Spawn Worker Pod
                </span>
              </div>
              <button
                onClick={() => setIsSpawnModalOpen(false)}
                className="text-onedark-muted hover:text-onedark-fg text-sm font-mono"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSpawnSubmit} className="space-y-3">
              <div>
                <label className="block text-[11px] font-mono font-semibold text-onedark-muted mb-1">
                  Worker Title
                </label>
                <input
                  type="text"
                  value={spawnTitle}
                  onChange={(e) => setSpawnTitle(e.target.value)}
                  placeholder="e.g. PR #104 Reviewer or Security Auditor"
                  required
                  className="w-full px-3 py-2 rounded-lg bg-onedark-surface border border-onedark-borderSubtle text-xs text-onedark-fg focus:outline-none focus:ring-1 focus:ring-onedark-accent/40 focus:border-onedark-accent font-sans transition-colors"
                />
              </div>

              <div>
                <label className="block text-[11px] font-mono font-semibold text-onedark-muted mb-1">
                  Persona Role
                </label>
                <select
                  value={spawnPersona}
                  onChange={(e) => setSpawnPersona(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-onedark-surface border border-onedark-borderSubtle text-xs text-onedark-fg focus:outline-none focus:ring-1 focus:ring-onedark-accent/40 focus:border-onedark-accent font-mono transition-colors"
                >
                  <option value="SoftwareEngineer">SoftwareEngineer (General Implementation)</option>
                  <option value="CodeReviewer">CodeReviewer (PR & AST Diff Audit)</option>
                  <option value="SecurityAuditor">SecurityAuditor (CVE & Vulnerability Scan)</option>
                  <option value="TestEngineer">TestEngineer (Pytest & Regression QA)</option>
                  <option value="PerformanceEngineer">PerformanceEngineer (Benchmarks & Query Plans)</option>
                  <option value="DocumentationWriter">DocumentationWriter (API & Guides)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-mono font-semibold text-onedark-muted mb-1">
                  Task Prompt & Instructions
                </label>
                <textarea
                  value={spawnPrompt}
                  onChange={(e) => setSpawnPrompt(e.target.value)}
                  placeholder="Specify the exact subtask objective, files to inspect, or tests to run..."
                  rows={4}
                  required
                  className="w-full px-3 py-2 rounded-lg bg-onedark-surface border border-onedark-borderSubtle text-xs text-onedark-fg focus:outline-none focus:ring-1 focus:ring-onedark-accent/40 focus:border-onedark-accent font-sans transition-colors"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsSpawnModalOpen(false)}
                  className="px-3 py-1.5 rounded-lg border border-onedark-borderSubtle text-xs font-mono text-onedark-muted hover:text-onedark-fg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-onedark-accent text-onedark-darker font-mono text-xs font-bold hover:bg-onedark-accent/90 transition-colors shadow-xs"
                >
                  Launch Pod
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
