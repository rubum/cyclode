import React, { useState, useEffect, useMemo } from 'react';
import {
  Brain,
  FileText,
  Globe,
  Sparkles,
  Download,
  Copy,
  Check,
  Search,
  ExternalLink,
  ThumbsUp,
  ThumbsDown,
  Layers,
  Clock,
  Coins,
  RefreshCw,
  ChevronsUpDown,
  Code2,
  CheckCircle2,
  Activity
} from 'lucide-react';
import { Task, KnowledgeEntry, SessionReport } from '../../types';
import { MarkdownRenderer } from '../Common/MarkdownRenderer';
import { FormattedLogView } from '../Common/FormattedLogView';

interface IntelligenceTabProps {
  task?: Task | null;
}

const API_BASE = import.meta.env.VITE_API_URL || '';
const taskMemoriesCache = new Map<string, KnowledgeEntry[]>();

export const IntelligenceTab: React.FC<IntelligenceTabProps> = ({ task }) => {
  const [activeSection, setActiveSection] = useState<'briefing' | 'citations' | 'memory' | 'audit'>('briefing');
  const [memories, setMemories] = useState<KnowledgeEntry[]>(() =>
    task?.id ? taskMemoriesCache.get(task.id) || [] : []
  );
  const [isLoadingMemories, setIsLoadingMemories] = useState(false);
  const [isCompilingReport, setIsCompilingReport] = useState(false);
  const [report, setReport] = useState<SessionReport | null>(task?.report || null);
  const [copied, setCopied] = useState(false);
  const [auditQuery, setAuditQuery] = useState('');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  // Sync report when task or task.id updates
  useEffect(() => {
    setReport(task?.report || null);
  }, [task?.id, task?.report]);

  // Fetch task memories with client-side cache and AbortController
  useEffect(() => {
    if (!task?.id || task.id.startsWith('temp-')) {
      setMemories([]);
      return;
    }
    const taskId = task.id;
    const cached = taskMemoriesCache.get(taskId);
    if (cached) {
      setMemories(cached);
      if (task.status !== 'RUNNING' && task.status !== 'INITIALIZING') {
        return;
      }
    }

    const controller = new AbortController();
    const fetchMemories = async () => {
      if (!cached) setIsLoadingMemories(true);
      try {
        const res = await fetch(`${API_BASE}/api/memories/task/${taskId}`, {
          signal: controller.signal,
        });
        if (res.ok) {
          const data = await res.json();
          taskMemoriesCache.set(taskId, data);
          setMemories(data);
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        console.error('Failed to fetch task memories:', err);
      } finally {
        setIsLoadingMemories(false);
      }
    };
    fetchMemories();
    return () => controller.abort();
  }, [task?.id, task?.status]);

  const handleCompileReport = async () => {
    if (!task?.id || task.id.startsWith('temp-')) return;
    setIsCompilingReport(true);
    try {
      const res = await fetch(`${API_BASE}/api/tasks/${task.id}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ save_to_workspace: false }),
      });
      if (res.ok) {
        const compiled: SessionReport = await res.json();
        setReport(compiled);
        if (task) {
          task.report = compiled;
        }
      }
    } catch (e) {
      console.error('Failed to compile report:', e);
    } finally {
      setIsCompilingReport(false);
    }
  };

  const handleCopyMarkdown = () => {
    if (!report?.markdown) return;
    navigator.clipboard.writeText(report.markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleVoteMemory = async (memoryId: string, delta: number) => {
    try {
      const res = await fetch(`${API_BASE}/api/memories/${memoryId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delta }),
      });
      if (res.ok) {
        const updated: KnowledgeEntry = await res.json();
        setMemories((prev) => prev.map((m) => (m.id === memoryId ? updated : m)));
      }
    } catch (err) {
      console.error('Failed to vote memory:', err);
    }
  };

  const logs = task?.logs || [];
  const filteredLogs = useMemo(() => {
    if (!auditQuery.trim()) return logs;
    const q = auditQuery.toLowerCase();
    return logs.filter((log) => {
      const name = (log.tool_name || '').toLowerCase();
      const out = (log.tool_output || '').toLowerCase();
      const inp = JSON.stringify(log.tool_input || {}).toLowerCase();
      return name.includes(q) || out.includes(q) || inp.includes(q);
    });
  }, [logs, auditQuery]);

  const citations = report?.citations || [];

  return (
    <div className="flex flex-col h-full bg-onedark-darker overflow-hidden text-onedark-fg select-text">
      {/* Top Header & Telemetry Strip */}
      <div className="px-4 py-2.5 bg-onedark-darker border-b border-onedark-borderSubtle flex items-center justify-between flex-shrink-0">
        <div className="flex items-center space-x-2">
          <Brain className="w-4 h-4 text-onedark-accent" />
          <span className="text-xs font-bold text-onedark-fgBright">Session Intelligence</span>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-onedark-surface text-onedark-accent border border-onedark-accent/40 font-semibold tracking-wider uppercase">
            Cognitive
          </span>
        </div>

        {/* Quick Metrics */}
        <div className="flex items-center space-x-2 text-[11px] font-mono text-onedark-muted">
          <span className="hidden sm:flex items-center space-x-1 px-2 py-0.5 rounded bg-onedark-surface/60 border border-onedark-borderSubtle text-onedark-fg">
            <Coins className="w-3 h-3 text-onedark-yellow" />
            <span>{task?.total_tokens?.toLocaleString() || 0} tok</span>
          </span>
          <span className="flex items-center space-x-1 px-2 py-0.5 rounded bg-onedark-surface/60 border border-onedark-borderSubtle text-onedark-fg">
            <Globe className="w-3 h-3 text-onedark-green" />
            <span>{citations.length} refs</span>
          </span>
          <span className="flex items-center space-x-1 px-2 py-0.5 rounded bg-onedark-surface/60 border border-onedark-borderSubtle text-onedark-fg">
            <Sparkles className="w-3 h-3 text-onedark-purple" />
            <span>{memories.length} rules</span>
          </span>
        </div>
      </div>

      {/* Segmented Section Switcher */}
      <div className="px-3 py-1.5 bg-onedark-darker border-b border-onedark-borderSubtle flex items-center justify-between gap-2 flex-shrink-0">
        <div className="flex items-center space-x-1 bg-onedark-bg p-1 rounded-lg font-mono text-[11px] border border-onedark-borderSubtle">
          <button
            onClick={() => setActiveSection('briefing')}
            className={`px-2.5 py-1 rounded-md transition-all flex items-center space-x-1.5 ${
              activeSection === 'briefing'
                ? 'bg-onedark-surface text-onedark-fgBright font-semibold shadow-xs border border-onedark-borderSubtle'
                : 'text-onedark-muted hover:text-onedark-fgBright hover:bg-onedark-surface/40 border border-transparent'
            }`}
          >
            <FileText className={`w-3 h-3 ${activeSection === 'briefing' ? 'text-onedark-accent' : 'text-onedark-muted'}`} />
            <span>Briefing</span>
          </button>
          <button
            onClick={() => setActiveSection('citations')}
            className={`px-2.5 py-1 rounded-md transition-all flex items-center space-x-1.5 ${
              activeSection === 'citations'
                ? 'bg-onedark-surface text-onedark-fgBright font-semibold shadow-xs border border-onedark-borderSubtle'
                : 'text-onedark-muted hover:text-onedark-fgBright hover:bg-onedark-surface/40 border border-transparent'
            }`}
          >
            <Globe className={`w-3 h-3 ${activeSection === 'citations' ? 'text-onedark-green' : 'text-onedark-muted'}`} />
            <span>Sources ({citations.length})</span>
          </button>
          <button
            onClick={() => setActiveSection('memory')}
            className={`px-2.5 py-1 rounded-md transition-all flex items-center space-x-1.5 ${
              activeSection === 'memory'
                ? 'bg-onedark-surface text-onedark-fgBright font-semibold shadow-xs border border-onedark-borderSubtle'
                : 'text-onedark-muted hover:text-onedark-fgBright hover:bg-onedark-surface/40 border border-transparent'
            }`}
          >
            <Sparkles className={`w-3 h-3 ${activeSection === 'memory' ? 'text-onedark-purple' : 'text-onedark-muted'}`} />
            <span>Memory ({memories.length})</span>
          </button>
          <button
            onClick={() => setActiveSection('audit')}
            className={`px-2.5 py-1 rounded-md transition-all flex items-center space-x-1.5 ${
              activeSection === 'audit'
                ? 'bg-onedark-surface text-onedark-fgBright font-semibold shadow-xs border border-onedark-borderSubtle'
                : 'text-onedark-muted hover:text-onedark-fgBright hover:bg-onedark-surface/40 border border-transparent'
            }`}
          >
            <Activity className={`w-3 h-3 ${activeSection === 'audit' ? 'text-onedark-accent' : 'text-onedark-muted'}`} />
            <span>Audit ({logs.length})</span>
          </button>
        </div>

        {/* Section specific quick action */}
        {activeSection === 'briefing' && (
          <div className="flex items-center space-x-1">
            {report?.markdown && (
              <button
                onClick={handleCopyMarkdown}
                className="p-1 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fgBright transition-colors"
                title="Copy markdown report"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-onedark-green" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            )}
            <button
              onClick={handleCompileReport}
              disabled={isCompilingReport}
              className="p-1 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fgBright transition-colors disabled:opacity-50"
              title="Recompile session intelligence report"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isCompilingReport ? 'animate-spin text-onedark-accent' : 'text-onedark-accent'}`} />
            </button>
          </div>
        )}
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-3">
        {/* Sub-view 1: Executive Briefing */}
        {activeSection === 'briefing' && (
          <div className="h-full">
            {report?.markdown ? (
              <div className="bg-onedark-surface/50 rounded-xl border border-onedark-borderSubtle p-4 space-y-4 shadow-xs">
                <MarkdownRenderer content={report.markdown} />
              </div>
            ) : isCompilingReport ? (
              <div className="h-full flex flex-col items-center justify-center p-8 text-center">
                <RefreshCw className="w-6 h-6 text-onedark-accent animate-spin mb-3" />
                <p className="text-xs text-onedark-muted">Synthesizing multi-turn intelligence briefing...</p>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center p-8 text-center space-y-3">
                <div className="w-12 h-12 rounded-xl bg-onedark-surface border border-onedark-borderSubtle flex items-center justify-center text-onedark-accent shadow-xs">
                  <FileText className="w-6 h-6" />
                </div>
                <h4 className="text-sm font-bold text-onedark-fgBright">No Briefing Compiled Yet</h4>
                <p className="text-xs text-onedark-muted max-w-xs leading-relaxed font-sans">
                  Synthesize multi-turn objectives, tool executions, research citations, and deliverable summaries into an executive report.
                </p>
                <button
                  onClick={handleCompileReport}
                  className="px-4 py-2 rounded-lg bg-onedark-accent hover:brightness-105 active:scale-[0.98] text-onedark-darker text-xs font-bold shadow-sm transition-all flex items-center space-x-1.5 border border-onedark-accent/40"
                >
                  <Sparkles className="w-3.5 h-3.5 stroke-[2.2] text-onedark-darker" />
                  <span>Compile Intelligence Report</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Sub-view 2: Sources & Citations */}
        {activeSection === 'citations' && (
          <div className="space-y-2">
            {citations.length === 0 ? (
              <div className="p-8 text-center text-onedark-muted text-xs space-y-1">
                <Globe className="w-6 h-6 mx-auto mb-2 opacity-40 text-onedark-green" />
                <div>No external web research links cited in this session yet.</div>
              </div>
            ) : (
              citations.map((c, i) => (
                <div
                  key={i}
                  className="p-3 rounded-lg bg-onedark-darker border border-onedark-borderSubtle hover:border-onedark-border transition-colors space-y-1 shadow-xs"
                >
                  <div className="flex items-center justify-between">
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-semibold text-onedark-accent hover:underline flex items-center space-x-1.5 truncate pr-2"
                    >
                      <span className="truncate">{c.title || c.domain}</span>
                      <ExternalLink className="w-3 h-3 flex-shrink-0" />
                    </a>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-onedark-surface text-onedark-fgBright border border-onedark-borderSubtle flex-shrink-0 font-medium">
                      {c.domain}
                    </span>
                  </div>
                  <p className="text-[11px] font-mono text-onedark-muted truncate">{c.url}</p>
                </div>
              ))
            )}
          </div>
        )}

        {/* Sub-view 3: Experiential Memory */}
        {activeSection === 'memory' && (
          <div className="space-y-2.5">
            {isLoadingMemories ? (
              <div className="p-8 text-center text-xs text-onedark-muted">
                <RefreshCw className="w-5 h-5 text-onedark-accent animate-spin mx-auto mb-2" />
                <span>Loading experiential memory heuristics...</span>
              </div>
            ) : memories.length === 0 ? (
              <div className="p-8 text-center text-onedark-muted text-xs space-y-1">
                <Brain className="w-6 h-6 mx-auto mb-2 opacity-40 text-onedark-accent" />
                <div>No heuristics extracted from this session yet.</div>
                <p className="text-[11px] opacity-75">
                  Heuristics are automatically captured when tools recover from errors or verify key architectural rules.
                </p>
              </div>
            ) : (
              memories.map((m) => (
                <div
                  key={m.id}
                  className="p-3.5 rounded-lg bg-onedark-surface/70 border border-onedark-borderSubtle space-y-2 text-xs shadow-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-onedark-purple/15 text-onedark-purple border border-onedark-purple/30 font-semibold">
                      {m.category.replace('_', ' ')}
                    </span>
                    <span
                      className={`text-[10px] font-mono px-2 py-0.5 rounded font-semibold ${
                        m.status === 'PROMOTED'
                          ? 'bg-onedark-green/15 text-onedark-green border border-onedark-green/30'
                          : 'bg-onedark-yellow/15 text-onedark-yellow border border-onedark-yellow/30'
                      }`}
                    >
                      {m.status}
                    </span>
                  </div>

                  <p className="text-xs text-onedark-fgBright leading-relaxed font-sans font-medium">{m.insight}</p>

                  {m.context_files && m.context_files.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {m.context_files.map((cf, idx) => (
                        <span key={idx} className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-onedark-darker text-onedark-muted border border-onedark-borderSubtle">
                          {cf}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Voting and reinforcement bar */}
                  <div className="pt-2 border-t border-onedark-borderSubtle/60 flex items-center justify-between text-[11px] font-mono text-onedark-muted">
                    <span className="font-medium">Utility Score: <strong className="text-onedark-fgBright">{m.utility_score}</strong></span>
                    <div className="flex items-center space-x-1">
                      <button
                        onClick={() => handleVoteMemory(m.id, 0.5)}
                        className="p-1 rounded hover:bg-onedark-green/20 text-onedark-muted hover:text-onedark-green transition-colors"
                        title="Reinforce heuristic (+0.5 utility)"
                      >
                        <ThumbsUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleVoteMemory(m.id, -0.5)}
                        className="p-1 rounded hover:bg-onedark-red/20 text-onedark-muted hover:text-onedark-red transition-colors"
                        title="Penalize heuristic (-0.5 utility)"
                      >
                        <ThumbsDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Sub-view 4: Execution Audit (The legacy tool activity capabilities preserved) */}
        {activeSection === 'audit' && (
          <div className="h-full flex flex-col space-y-2">
            {/* Search input */}
            <div className="flex items-center space-x-1.5 bg-onedark-surface/40 rounded-lg px-2.5 py-1 text-xs border border-onedark-borderSubtle/60 flex-shrink-0">
              <Search className="w-3.5 h-3.5 text-onedark-muted" />
              <input
                type="text"
                value={auditQuery}
                onChange={(e) => setAuditQuery(e.target.value)}
                placeholder="Filter tools, commands, or outputs..."
                className="w-full bg-transparent text-onedark-fgBright placeholder-onedark-muted/60 focus:outline-none text-[11px] font-mono"
              />
            </div>

            <div className="flex-1 overflow-y-auto space-y-0.5">
              {filteredLogs.length === 0 ? (
                <div className="text-onedark-muted text-xs p-8 text-center space-y-1">
                  <Activity className="w-5 h-5 mx-auto mb-2 opacity-40 text-onedark-accent" />
                  <div>{logs.length === 0 ? 'No workspace tools executed yet.' : 'No matching execution logs found.'}</div>
                </div>
              ) : (
                filteredLogs.map((log, index) => {
                  const logId = log.id || `audit-log-${index}`;
                  const isItemExpanded = expandedLogId === logId;
                  return (
                    <FormattedLogView
                      key={logId}
                      log={log}
                      isExpanded={isItemExpanded}
                      onToggle={() => setExpandedLogId((prev) => (prev === logId ? null : logId))}
                      isTerminalTab={true}
                    />
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
