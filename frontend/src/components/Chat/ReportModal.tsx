import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  FileText,
  Download,
  Copy,
  Check,
  X,
  RefreshCw,
  ExternalLink,
  Code2,
  FolderPlus,
  Sparkles,
  Layers,
  Clock,
  Coins,
  Globe,
  CheckCircle2,
  AlertCircle,
  Printer,
  Terminal,
  Brain,
  Activity,
  FileCode2,
  WrapText,
  AlignLeft,
  ShieldCheck,
  ArrowUpRight
} from 'lucide-react';
import { SessionReport } from '../../types';
import { MarkdownRenderer } from '../Common/MarkdownRenderer';
import { formatRelativeTime, formatFullDateTime } from '../../utils/date';

interface ReportModalProps {
  isOpen: boolean;
  taskId: string;
  report: SessionReport | null;
  onClose: () => void;
  onReportUpdated?: (report: SessionReport) => void;
}

const API_BASE = import.meta.env.VITE_API_URL || '';

export const ReportModal: React.FC<ReportModalProps> = ({
  isOpen,
  taskId,
  report: initialReport,
  onClose,
  onReportUpdated,
}) => {
  const [report, setReport] = useState<SessionReport | null>(initialReport);
  const [activeTab, setActiveTab] = useState<'preview' | 'dossier' | 'raw'>('preview');
  const [copied, setCopied] = useState(false);
  const [isCompiling, setIsCompiling] = useState(false);
  const [isSavingToWorkspace, setIsSavingToWorkspace] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isWordWrap, setIsWordWrap] = useState(true);

  useEffect(() => {
    setReport(initialReport);
  }, [initialReport]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || typeof document === 'undefined') return null;

  const handleCopyMarkdown = () => {
    if (!report?.markdown) return;
    navigator.clipboard.writeText(report.markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCompile = async (saveToWorkspace = false) => {
    if (saveToWorkspace) {
      setIsSavingToWorkspace(true);
    } else {
      setIsCompiling(true);
    }
    setError(null);
    setStatusMessage(null);

    try {
      const res = await fetch(`${API_BASE}/api/tasks/${taskId}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          save_to_workspace: saveToWorkspace,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `Failed to compile report (${res.status})`);
      }

      const updatedReport: SessionReport = await res.json();
      setReport(updatedReport);
      onReportUpdated?.(updatedReport);

      if (saveToWorkspace && updatedReport.workspace_file_path) {
        setStatusMessage(`Saved to ${updatedReport.workspace_file_path}`);
        setTimeout(() => setStatusMessage(null), 4000);
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred while compiling the report');
    } finally {
      setIsCompiling(false);
      setIsSavingToWorkspace(false);
    }
  };

  const handleDownload = (format: 'markdown' | 'html') => {
    window.open(`${API_BASE}/api/tasks/${taskId}/report/download?format=${format}`, '_blank');
  };

  const handlePrint = () => {
    if (!report?.html) return;
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(report.html);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => {
        printWindow.print();
      }, 300);
    }
  };

  const rawLineCount = report?.markdown ? report.markdown.split('\n').length : 0;
  const rawCharCount = report?.markdown ? report.markdown.length : 0;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-3 sm:p-5 animate-in fade-in duration-200">
      <div 
        className="w-full max-w-6xl h-[90vh] bg-onedark-darker border border-onedark-border rounded-2xl shadow-2xl flex flex-col overflow-hidden text-onedark-fg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Bar */}
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-onedark-borderSubtle bg-onedark-darker flex-shrink-0">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-onedark-surface border border-onedark-borderSubtle flex items-center justify-center text-onedark-accent shadow-xs flex-shrink-0">
              <FileText className="w-5 h-5 stroke-[2.2]" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <h2 className="text-base font-bold text-onedark-fgBright tracking-tight truncate">
                  {report?.title || 'Session Intelligence Report'}
                </h2>
                <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-onedark-accent/15 text-onedark-accent border border-onedark-accent/30 font-bold tracking-wider flex-shrink-0">
                  Briefing
                </span>
              </div>
              <p className="text-xs text-onedark-muted mt-0.5 font-sans truncate">
                Autonomous multi-turn synthesis, verification metrics, and research intelligence
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 flex-shrink-0">
            {/* Quick Session Header Metrics */}
            {report?.metrics && (
              <div className="hidden md:flex items-center gap-2 mr-2 text-xs font-mono">
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-onedark-surface border border-onedark-borderSubtle text-onedark-fgBright font-medium shadow-xs">
                  <Clock className="w-3.5 h-3.5 text-onedark-accent" />
                  <span>{report.metrics.total_turns} turns</span>
                </span>
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-onedark-surface border border-onedark-borderSubtle text-onedark-fgBright font-medium shadow-xs">
                  <Coins className="w-3.5 h-3.5 text-onedark-yellow" />
                  <span>{report.metrics.total_tokens?.toLocaleString() || 0} tokens</span>
                </span>
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-onedark-surface border border-onedark-borderSubtle text-onedark-fgBright font-medium shadow-xs">
                  <Globe className="w-3.5 h-3.5 text-onedark-green" />
                  <span>{report.citations?.length || 0} citations</span>
                </span>
              </div>
            )}

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-onedark-muted hover:text-onedark-fgBright hover:bg-onedark-surface border border-transparent hover:border-onedark-borderSubtle transition-all cursor-pointer"
              title="Close (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Unified Navigation & Actions Toolbar (Single Streamlined Row) */}
        <div className="flex items-center justify-between gap-3 px-6 py-2.5 bg-onedark-bg border-b border-onedark-borderSubtle flex-shrink-0 flex-wrap sm:flex-nowrap">
          {/* Segmented View Switcher */}
          <div className="flex items-center gap-1 p-1 bg-onedark-darker rounded-xl border border-onedark-borderSubtle shadow-2xs">
            <button
              onClick={() => setActiveTab('preview')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                activeTab === 'preview'
                  ? 'bg-onedark-surface text-onedark-fgBright font-bold shadow-xs border border-onedark-borderSubtle'
                  : 'text-onedark-muted hover:text-onedark-fgBright hover:bg-onedark-surface/40 border border-transparent'
              }`}
            >
              <Sparkles className={`w-3.5 h-3.5 ${activeTab === 'preview' ? 'text-onedark-accent' : 'text-onedark-muted'}`} />
              <span>Executive Preview</span>
            </button>

            <button
              onClick={() => setActiveTab('dossier')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                activeTab === 'dossier'
                  ? 'bg-onedark-surface text-onedark-fgBright font-bold shadow-xs border border-onedark-borderSubtle'
                  : 'text-onedark-muted hover:text-onedark-fgBright hover:bg-onedark-surface/40 border border-transparent'
              }`}
            >
              <Layers className={`w-3.5 h-3.5 ${activeTab === 'dossier' ? 'text-onedark-purple' : 'text-onedark-muted'}`} />
              <span>Intelligence Dossier</span>
              {report?.citations && report.citations.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold bg-onedark-purple/20 text-onedark-purple">
                  {report.citations.length}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('raw')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                activeTab === 'raw'
                  ? 'bg-onedark-surface text-onedark-fgBright font-bold shadow-xs border border-onedark-borderSubtle'
                  : 'text-onedark-muted hover:text-onedark-fgBright hover:bg-onedark-surface/40 border border-transparent'
              }`}
            >
              <Code2 className={`w-3.5 h-3.5 ${activeTab === 'raw' ? 'text-onedark-accent' : 'text-onedark-muted'}`} />
              <span>Raw Markdown</span>
            </button>
          </div>

          {/* Action Toolbar with Clear Visual Hierarchy */}
          <div className="flex items-center gap-2">
            {statusMessage && (
              <span className="flex items-center gap-1.5 text-xs text-onedark-green font-medium mr-1.5 animate-in fade-in">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{statusMessage}</span>
              </span>
            )}

            {/* Recompile Button */}
            <button
              onClick={() => handleCompile(false)}
              disabled={isCompiling}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-onedark-surface hover:bg-onedark-surface/80 text-onedark-fgBright border border-onedark-borderSubtle hover:border-onedark-border transition-all disabled:opacity-50 shadow-xs active:scale-[0.98] cursor-pointer"
              title="Regenerate intelligence summary from session trajectory"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isCompiling ? 'animate-spin text-onedark-accent' : 'text-onedark-accent'}`} />
              <span>{isCompiling ? 'Compiling...' : 'Recompile'}</span>
            </button>

            {/* Save to Workspace Button with Gold Accent Indicator */}
            <button
              onClick={() => handleCompile(true)}
              disabled={isSavingToWorkspace}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-onedark-surface hover:bg-onedark-surface/80 text-onedark-fgBright border border-onedark-accent/30 hover:border-onedark-accent/60 transition-all disabled:opacity-50 shadow-xs active:scale-[0.98] cursor-pointer"
              title="Save markdown document directly into workspace reports/ folder"
            >
              <FolderPlus className="w-3.5 h-3.5 text-onedark-accent" />
              <span>{isSavingToWorkspace ? 'Saving...' : 'Save to Workspace'}</span>
            </button>

            {/* Copy Button */}
            <button
              onClick={handleCopyMarkdown}
              disabled={!report?.markdown}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-onedark-surface hover:bg-onedark-surface/80 text-onedark-fgBright border border-onedark-borderSubtle hover:border-onedark-border transition-all disabled:opacity-50 shadow-xs active:scale-[0.98] cursor-pointer"
              title="Copy entire markdown briefing to clipboard"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-onedark-green" />
                  <span className="text-onedark-green font-bold">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-onedark-muted" />
                  <span>Copy</span>
                </>
              )}
            </button>

            {/* Export Actions Cluster */}
            <div className="flex items-center border border-onedark-borderSubtle rounded-lg overflow-hidden bg-onedark-surface shadow-xs">
              <button
                onClick={() => handleDownload('markdown')}
                disabled={!report?.markdown}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-mono font-medium text-onedark-fg hover:text-onedark-fgBright hover:bg-onedark-darker/60 transition-colors border-r border-onedark-borderSubtle disabled:opacity-50 cursor-pointer"
                title="Download as GitHub Flavored Markdown (.md)"
              >
                <Download className="w-3.5 h-3.5 text-onedark-accent" />
                <span>.MD</span>
              </button>
              <button
                onClick={() => handleDownload('html')}
                disabled={!report?.html}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-mono font-medium text-onedark-fg hover:text-onedark-fgBright hover:bg-onedark-darker/60 transition-colors border-r border-onedark-borderSubtle disabled:opacity-50 cursor-pointer"
                title="Download as Standalone Printable HTML (.html)"
              >
                <Download className="w-3.5 h-3.5 text-onedark-green" />
                <span>.HTML</span>
              </button>
              <button
                onClick={handlePrint}
                disabled={!report?.html}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-onedark-fg hover:text-onedark-fgBright hover:bg-onedark-darker/60 transition-colors disabled:opacity-50 cursor-pointer"
                title="Print or Save as PDF via Browser Print Engine"
              >
                <Printer className="w-3.5 h-3.5 text-onedark-purple" />
              </button>
            </div>
          </div>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="px-6 py-2.5 bg-onedark-red/10 border-b border-onedark-red/30 text-xs text-onedark-red flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Content Body Canvas */}
        <div className="flex-1 overflow-y-auto p-6 bg-onedark-bg">
          {!report && !isCompiling ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8">
              <div className="w-16 h-16 rounded-2xl bg-onedark-surface border border-onedark-borderSubtle flex items-center justify-center text-onedark-accent mb-4 shadow-sm">
                <FileText className="w-8 h-8 stroke-[1.8]" />
              </div>
              <h3 className="text-lg font-bold text-onedark-fgBright mb-2 tracking-tight">No Report Compiled Yet</h3>
              <p className="text-sm text-onedark-muted max-w-md mb-6 leading-relaxed font-sans">
                Compile all multi-turn conversation logs, web research citations, file modifications, and planning milestones into an executive briefing.
              </p>
              <button
                onClick={() => handleCompile(false)}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-onedark-accent hover:brightness-105 active:scale-[0.98] text-gray-950 font-extrabold text-sm shadow-md transition-all border border-onedark-accent/40 cursor-pointer"
              >
                <Sparkles className="w-4 h-4 stroke-[2.2]" />
                <span>Compile Session Report Now</span>
              </button>
            </div>
          ) : isCompiling && !report ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8">
              <RefreshCw className="w-8 h-8 text-onedark-accent animate-spin mb-4" />
              <h3 className="text-base font-bold text-onedark-fgBright mb-1">Synthesizing Session Intelligence...</h3>
              <p className="text-xs text-onedark-muted">Harvesting citations, diffs, and turn milestones</p>
            </div>
          ) : (
            <>
              {/* Tab 1: Executive Preview */}
              {activeTab === 'preview' && (
                <div className="max-w-4xl mx-auto space-y-4">
                  {report?.workspace_file_path && (
                    <div className="px-4 py-2.5 rounded-xl bg-onedark-green/10 border border-onedark-green/25 flex items-center justify-between text-xs text-onedark-green shadow-xs">
                      <span className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                        <span>Persisted in workspace at <code className="font-mono bg-onedark-darker text-onedark-green px-1.5 py-0.5 rounded border border-onedark-green/30">{report.workspace_file_path}</code></span>
                      </span>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(report.workspace_file_path || '');
                          setStatusMessage('Path copied to clipboard');
                          setTimeout(() => setStatusMessage(null), 2500);
                        }}
                        className="text-xs font-mono underline hover:text-onedark-fgBright transition-colors cursor-pointer"
                      >
                        Copy Path
                      </button>
                    </div>
                  )}

                  <div className="bg-onedark-surface/40 border border-onedark-borderSubtle rounded-2xl p-6 sm:p-10 shadow-sm leading-relaxed">
                    <MarkdownRenderer content={report?.markdown || ''} />
                  </div>
                </div>
              )}

              {/* Tab 2: Intelligence Dossier (Asymmetric 2-Column Hub) */}
              {activeTab === 'dossier' && (
                <div className="max-w-5xl mx-auto">
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                    {/* Left Column: Primary Research & Work Products Stream (7 cols) */}
                    <div className="lg:col-span-7 space-y-6">
                      {/* External Citations & Sources */}
                      <div className="rounded-2xl bg-onedark-surface/50 border border-onedark-borderSubtle p-5 shadow-xs">
                        <div className="flex items-center justify-between mb-3.5">
                          <h3 className="text-sm font-bold text-onedark-fgBright flex items-center gap-2">
                            <Globe className="w-4 h-4 text-onedark-green" />
                            <span>External Citations & Intelligence Sources</span>
                          </h3>
                          <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-onedark-darker text-onedark-muted border border-onedark-borderSubtle font-semibold">
                            {report?.citations?.length || 0}
                          </span>
                        </div>

                        {report?.citations && report.citations.length > 0 ? (
                          <div className="space-y-2.5">
                            {report.citations.map((c, i) => (
                              <div 
                                key={i} 
                                className="flex items-center justify-between p-3 rounded-xl bg-onedark-darker border border-onedark-borderSubtle hover:border-onedark-accent/40 hover:bg-onedark-darker/90 transition-all group"
                              >
                                <div className="flex items-center gap-3 min-w-0 pr-3">
                                  {/* Favicon or fallback Globe */}
                                  <div className="w-6 h-6 rounded bg-onedark-surface flex items-center justify-center flex-shrink-0 border border-onedark-borderSubtle">
                                    <img 
                                      src={`https://www.google.com/s2/favicons?domain=${c.domain}&sz=32`} 
                                      alt="" 
                                      className="w-3.5 h-3.5 rounded-xs"
                                      onError={(e) => {
                                        (e.currentTarget as HTMLElement).style.display = 'none';
                                      }}
                                    />
                                    <Globe className="w-3.5 h-3.5 text-onedark-muted hidden group-has-[img[style*='display: none']]:block" />
                                  </div>
                                  <div className="min-w-0">
                                    <a 
                                      href={c.url} 
                                      target="_blank" 
                                      rel="noopener noreferrer"
                                      className="text-xs font-bold text-onedark-fgBright hover:text-onedark-accent flex items-center gap-1.5 truncate transition-colors"
                                    >
                                      <span className="truncate">{c.title}</span>
                                      <ArrowUpRight className="w-3 h-3 text-onedark-muted group-hover:text-onedark-accent flex-shrink-0 transition-colors" />
                                    </a>
                                    <p className="text-[11px] text-onedark-muted font-mono truncate mt-0.5">{c.url}</p>
                                  </div>
                                </div>
                                <span className="px-2 py-0.5 rounded-md text-[10.5px] font-mono bg-onedark-surface text-onedark-fgBright border border-onedark-borderSubtle flex-shrink-0 font-medium">
                                  {c.domain}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="p-4 rounded-xl bg-onedark-darker/50 border border-onedark-borderSubtle/60 text-center">
                            <Globe className="w-5 h-5 text-onedark-muted mx-auto mb-1.5 opacity-60" />
                            <p className="text-xs text-onedark-muted font-sans">No external web links cited in this session.</p>
                          </div>
                        )}
                      </div>

                      {/* Workspace Files Modified */}
                      <div className="rounded-2xl bg-onedark-surface/50 border border-onedark-borderSubtle p-5 shadow-xs">
                        <div className="flex items-center justify-between mb-3.5">
                          <h3 className="text-sm font-bold text-onedark-fgBright flex items-center gap-2">
                            <Code2 className="w-4 h-4 text-onedark-accent" />
                            <span>Workspace Touchpoint Files</span>
                          </h3>
                          <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-onedark-darker text-onedark-muted border border-onedark-borderSubtle font-semibold">
                            {report?.files_touched?.length || 0}
                          </span>
                        </div>

                        {report?.files_touched && report.files_touched.length > 0 ? (
                          <div className="space-y-2">
                            {report.files_touched.map((f, i) => (
                              <div 
                                key={i} 
                                className="flex items-center justify-between p-2.5 rounded-xl bg-onedark-darker border border-onedark-borderSubtle text-xs"
                              >
                                <div className="flex items-center gap-2 min-w-0 pr-2">
                                  <FileCode2 className="w-4 h-4 text-onedark-accent flex-shrink-0" />
                                  <span className="font-mono text-onedark-fgBright truncate">{f.path}</span>
                                </div>
                                <span className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase font-bold tracking-wider ${
                                  f.action === 'created' || f.action === 'added'
                                    ? 'bg-onedark-green/15 text-onedark-green border border-onedark-green/30'
                                    : 'bg-onedark-accent/15 text-onedark-accent border border-onedark-accent/30'
                                }`}>
                                  {f.action}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="p-4 rounded-xl bg-onedark-darker/50 border border-onedark-borderSubtle/60 text-center">
                            <FileCode2 className="w-5 h-5 text-onedark-muted mx-auto mb-1.5 opacity-60" />
                            <p className="text-xs text-onedark-muted font-sans">No workspace files modified in this session.</p>
                          </div>
                        )}
                      </div>

                      {/* Commands Executed Stream (if any) */}
                      {report?.commands_executed && report.commands_executed.length > 0 && (
                        <div className="rounded-2xl bg-onedark-surface/50 border border-onedark-borderSubtle p-5 shadow-xs">
                          <div className="flex items-center justify-between mb-3.5">
                            <h3 className="text-sm font-bold text-onedark-fgBright flex items-center gap-2">
                              <Terminal className="w-4 h-4 text-onedark-purple" />
                              <span>Terminal Executions & Verification</span>
                            </h3>
                            <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-onedark-darker text-onedark-muted border border-onedark-borderSubtle font-semibold">
                              {report.commands_executed.length}
                            </span>
                          </div>
                          <div className="space-y-2">
                            {report.commands_executed.map((cmd, i) => (
                              <div 
                                key={i} 
                                className="flex items-center justify-between p-2.5 rounded-xl bg-onedark-darker border border-onedark-borderSubtle font-mono text-xs"
                              >
                                <span className="text-onedark-fg truncate pr-3">{cmd.command}</span>
                                <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${
                                  cmd.exit_code === 0
                                    ? 'bg-onedark-green/15 text-onedark-green border border-onedark-green/30'
                                    : 'bg-onedark-red/15 text-onedark-red border border-onedark-red/30'
                                }`}>
                                  {cmd.exit_code === 0 ? 'PASSED' : `FAIL (${cmd.exit_code})`}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Right Column: Telemetry & Experiential Memory Sidebar (5 cols) */}
                    <div className="lg:col-span-5 space-y-6">
                      {/* Session Telemetry Card */}
                      <div className="rounded-2xl bg-onedark-surface/50 border border-onedark-borderSubtle p-5 shadow-xs space-y-4">
                        <div className="flex items-center justify-between">
                          <h3 className="text-sm font-bold text-onedark-fgBright flex items-center gap-2">
                            <Activity className="w-4 h-4 text-onedark-yellow" />
                            <span>Execution Telemetry</span>
                          </h3>
                          <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-onedark-green/15 text-onedark-green border border-onedark-green/30 font-bold">
                            {report?.evaluation_status || 'Verified'}
                          </span>
                        </div>

                        {/* 2x2 Telemetry Metric Matrix */}
                        <div className="grid grid-cols-2 gap-3">
                          <div className="p-3.5 rounded-xl bg-onedark-darker border border-onedark-borderSubtle">
                            <div className="text-[11px] text-onedark-muted mb-1 flex items-center gap-1.5 font-medium">
                              <Clock className="w-3.5 h-3.5 text-onedark-accent" />
                              <span>Turns</span>
                            </div>
                            <div className="text-xl font-bold text-onedark-fgBright font-mono tabular-nums">
                              {report?.metrics?.total_turns || 0}
                            </div>
                          </div>

                          <div className="p-3.5 rounded-xl bg-onedark-darker border border-onedark-borderSubtle">
                            <div className="text-[11px] text-onedark-muted mb-1 flex items-center gap-1.5 font-medium">
                              <Coins className="w-3.5 h-3.5 text-onedark-yellow" />
                              <span>Tokens</span>
                            </div>
                            <div className="text-xl font-bold text-onedark-fgBright font-mono tabular-nums">
                              {report?.metrics?.total_tokens?.toLocaleString() || 0}
                            </div>
                          </div>

                          <div className="p-3.5 rounded-xl bg-onedark-darker border border-onedark-borderSubtle">
                            <div className="text-[11px] text-onedark-muted mb-1 flex items-center gap-1.5 font-medium">
                              <Globe className="w-3.5 h-3.5 text-onedark-green" />
                              <span>Citations</span>
                            </div>
                            <div className="text-xl font-bold text-onedark-fgBright font-mono tabular-nums">
                              {report?.citations?.length || 0}
                            </div>
                          </div>

                          <div className="p-3.5 rounded-xl bg-onedark-darker border border-onedark-borderSubtle">
                            <div className="text-[11px] text-onedark-muted mb-1 flex items-center gap-1.5 font-medium">
                              <Layers className="w-3.5 h-3.5 text-onedark-purple" />
                              <span>Files</span>
                            </div>
                            <div className="text-xl font-bold text-onedark-fgBright font-mono tabular-nums">
                              {report?.files_touched?.length || 0}
                            </div>
                          </div>
                        </div>

                        {/* Metadata Details */}
                        <div className="pt-2 border-t border-onedark-borderSubtle/60 space-y-2 text-xs">
                          <div className="flex items-center justify-between text-onedark-muted">
                            <span>Persona:</span>
                            <span className="font-mono text-onedark-fgBright font-medium">{report?.persona || 'General'}</span>
                          </div>
                          <div className="flex items-center justify-between text-onedark-muted">
                            <span>Session Key:</span>
                            <span className="font-mono text-onedark-accent font-semibold">{taskId.slice(0, 8)}</span>
                          </div>
                          <div className="flex items-center justify-between text-onedark-muted">
                            <span>Synthesized:</span>
                            <span className="font-sans text-onedark-fg">{formatRelativeTime(report?.created_at)}</span>
                          </div>
                        </div>
                      </div>

                      {/* Experiential Heuristics Card (if present) */}
                      {report?.experiential_memories && report.experiential_memories.length > 0 && (
                        <div className="rounded-2xl bg-onedark-surface/50 border border-onedark-borderSubtle p-5 shadow-xs space-y-3">
                          <div className="flex items-center justify-between">
                            <h3 className="text-sm font-bold text-onedark-fgBright flex items-center gap-2">
                              <Brain className="w-4 h-4 text-onedark-accent" />
                              <span>Experiential Memories</span>
                            </h3>
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-onedark-accent/15 text-onedark-accent border border-onedark-accent/30 font-bold">
                              {report.experiential_memories.length}
                            </span>
                          </div>

                          <div className="space-y-2.5">
                            {report.experiential_memories.map((mem) => (
                              <div 
                                key={mem.id}
                                className="p-3 rounded-xl bg-onedark-darker border border-onedark-borderSubtle space-y-1.5"
                              >
                                <div className="flex items-center justify-between text-[10px] font-mono">
                                  <span className="text-onedark-accent uppercase font-bold tracking-wider">{mem.category}</span>
                                  <span className="text-onedark-green bg-onedark-green/10 px-1.5 py-0.2 rounded border border-onedark-green/20 font-semibold">{mem.status}</span>
                                </div>
                                <p className="text-xs text-onedark-fg leading-relaxed">{mem.insight}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Export & Deliverables Card */}
                      <div className="rounded-2xl bg-onedark-surface/50 border border-onedark-borderSubtle p-5 shadow-xs space-y-3">
                        <h3 className="text-sm font-bold text-onedark-fgBright flex items-center gap-2">
                          <Download className="w-4 h-4 text-onedark-accent" />
                          <span>Deliverable Exports</span>
                        </h3>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            onClick={() => handleDownload('markdown')}
                            className="p-3 rounded-xl bg-onedark-darker hover:bg-onedark-surface border border-onedark-borderSubtle text-left transition-all cursor-pointer group"
                          >
                            <div className="text-xs font-bold text-onedark-fgBright group-hover:text-onedark-accent flex items-center gap-1.5">
                              <span>Markdown</span>
                              <ArrowUpRight className="w-3 h-3 text-onedark-muted" />
                            </div>
                            <div className="text-[10.5px] text-onedark-muted font-mono mt-0.5">.MD raw format</div>
                          </button>

                          <button
                            onClick={() => handleDownload('html')}
                            className="p-3 rounded-xl bg-onedark-darker hover:bg-onedark-surface border border-onedark-borderSubtle text-left transition-all cursor-pointer group"
                          >
                            <div className="text-xs font-bold text-onedark-fgBright group-hover:text-onedark-green flex items-center gap-1.5">
                              <span>HTML Report</span>
                              <ArrowUpRight className="w-3 h-3 text-onedark-muted" />
                            </div>
                            <div className="text-[10.5px] text-onedark-muted font-mono mt-0.5">Standalone web</div>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 3: Raw Markdown */}
              {activeTab === 'raw' && (
                <div className="max-w-4xl mx-auto space-y-3">
                  {/* Raw Controls Bar */}
                  <div className="flex items-center justify-between px-2 text-xs font-mono text-onedark-muted">
                    <div className="flex items-center gap-3">
                      <span>{rawLineCount} lines</span>
                      <span>·</span>
                      <span>{rawCharCount.toLocaleString()} characters</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setIsWordWrap((v) => !v)}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-colors cursor-pointer ${
                          isWordWrap
                            ? 'bg-onedark-surface text-onedark-accent border-onedark-accent/40 font-semibold'
                            : 'bg-onedark-darker text-onedark-muted border-onedark-borderSubtle hover:text-onedark-fgBright'
                        }`}
                        title="Toggle Word Wrap"
                      >
                        <WrapText className="w-3.5 h-3.5" />
                        <span>{isWordWrap ? 'Wrapped' : 'No Wrap'}</span>
                      </button>

                      <button
                        onClick={handleCopyMarkdown}
                        className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-onedark-surface hover:bg-onedark-surface/80 text-onedark-fgBright border border-onedark-borderSubtle transition-all cursor-pointer shadow-xs active:scale-95"
                      >
                        {copied ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-onedark-green" />
                            <span className="text-onedark-green font-bold">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5 text-onedark-muted" />
                            <span>Copy Source</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Preformatted Code Block */}
                  <div className="p-6 rounded-2xl bg-onedark-darker border border-onedark-borderSubtle shadow-inner">
                    <pre className={`font-mono text-xs text-onedark-fgBright leading-relaxed select-all ${
                      isWordWrap ? 'whitespace-pre-wrap break-words' : 'overflow-x-auto whitespace-pre'
                    }`}>
                      {report?.markdown || ''}
                    </pre>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
