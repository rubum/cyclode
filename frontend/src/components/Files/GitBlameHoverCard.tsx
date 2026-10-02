import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { 
  GitCommit, 
  Copy, 
  Check, 
  ExternalLink, 
  Eye, 
  Sparkles, 
  X 
} from 'lucide-react';

export interface LineBlame {
  line: number;
  sha: string;
  short_sha: string;
  author: string;
  email: string;
  committed_at: string | null;
  relative_time: string;
  summary: string;
  is_uncommitted?: boolean;
}

interface GitBlameHoverCardProps {
  blame: LineBlame;
  filePath: string;
  position: { top: number; left: number };
  onClose: () => void;
  onAskAgent?: (prompt: string) => void;
  onViewDiff?: (sha: string) => void;
}

export const GitBlameHoverCard: React.FC<GitBlameHoverCardProps> = ({
  blame,
  filePath,
  position,
  onClose,
  onAskAgent,
  onViewDiff
}) => {
  const [copiedSha, setCopiedSha] = useState(false);

  // Close on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleCopySha = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(blame.sha);
    setCopiedSha(true);
    setTimeout(() => setCopiedSha(false), 2000);
  };

  // Generate deterministic avatar monogram background color
  const getAvatarColor = (name: string) => {
    if (blame.is_uncommitted) return 'bg-amber-500/20 text-amber-400 border-amber-500/40';
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const colors = [
      'bg-cyan-500/20 text-cyan-400 border-cyan-500/40',
      'bg-purple-500/20 text-purple-400 border-purple-500/40',
      'bg-blue-500/20 text-blue-400 border-blue-500/40',
      'bg-emerald-500/20 text-emerald-400 border-emerald-500/40',
      'bg-pink-500/20 text-pink-400 border-pink-500/40',
      'bg-indigo-500/20 text-indigo-400 border-indigo-500/40'
    ];
    return colors[Math.abs(hash) % colors.length];
  };

  const initials = useMemo(() => {
    return blame.author
      .split(' ')
      .filter(Boolean)
      .map(n => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || 'U';
  }, [blame.author]);

  const exactTimeStr = useMemo(() => {
    if (!blame.committed_at) return 'Active Session';
    try {
      const d = new Date(blame.committed_at);
      if (isNaN(d.getTime())) return blame.committed_at;
      return d.toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
      });
    } catch {
      return blame.committed_at;
    }
  }, [blame.committed_at]);

  const cardContent = (
    <>
      {/* Invisible backdrop for outside click dismiss */}
      <div
        className="fixed inset-0 z-50 bg-transparent"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />

      {/* Main Blame Inspection Popover */}
      <div
        style={{ top: `${position.top}px`, left: `${position.left}px` }}
        className="fixed z-50 w-96 max-w-[calc(100vw-32px)] bg-onedark-darker/95 border border-onedark-border shadow-2xl rounded-xl p-3.5 backdrop-blur-md animate-in fade-in zoom-in-95 duration-100 font-sans text-xs select-text"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header with Author Identity & Timestamp */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center space-x-2.5 min-w-0">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center font-mono text-[11px] font-bold border shrink-0 ${getAvatarColor(blame.author)}`}>
              {initials}
            </div>
            <div className="flex flex-col min-w-0">
              <div className="flex items-center space-x-1.5 truncate">
                <span className="font-semibold text-onedark-fgBright text-xs truncate">
                  {blame.author}
                </span>
                {blame.is_uncommitted && (
                  <span className="px-1.5 py-0.2 rounded-full bg-amber-500/15 text-[9.5px] font-mono font-bold text-amber-400 border border-amber-500/30">
                    Uncommitted
                  </span>
                )}
              </div>
              <div className="flex items-center space-x-1 text-[10.5px] text-onedark-muted truncate font-mono">
                {blame.email && (
                  <>
                    <span className="truncate">{blame.email}</span>
                    <span>•</span>
                  </>
                )}
                <span title={exactTimeStr}>{blame.relative_time}</span>
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface transition-colors cursor-pointer shrink-0"
            title="Close details"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Commit Message Box */}
        <div className="mt-2.5 p-2.5 rounded-lg bg-onedark-bg/70 border border-onedark-borderSubtle text-onedark-fg text-[11.5px] font-mono leading-relaxed select-text">
          <div className="flex items-start space-x-2">
            <GitCommit className="w-3.5 h-3.5 text-onedark-accent shrink-0 mt-0.5" />
            <span className="break-words font-medium">{blame.summary || 'No commit message'}</span>
          </div>
        </div>

        {/* Commit Metadata & Quick Actions */}
        <div className="mt-3 pt-2.5 border-t border-onedark-borderSubtle flex items-center justify-between gap-2 select-none">
          {/* Short SHA pill */}
          {!blame.is_uncommitted ? (
            <button
              onClick={handleCopySha}
              className="flex items-center space-x-1 px-2 py-1 rounded-md bg-onedark-surface/80 hover:bg-onedark-surface border border-onedark-borderSubtle text-[11px] font-mono text-onedark-accent transition-colors cursor-pointer group"
              title="Copy full commit SHA"
            >
              <span>{blame.short_sha}</span>
              {copiedSha ? (
                <Check className="w-3 h-3 text-onedark-green" />
              ) : (
                <Copy className="w-3 h-3 opacity-60 group-hover:opacity-100" />
              )}
            </button>
          ) : (
            <span className="text-[10.5px] font-mono text-onedark-muted">
              Line {blame.line}
            </span>
          )}

          {/* Action Buttons */}
          <div className="flex items-center space-x-1.5">
            {onViewDiff && !blame.is_uncommitted && (
              <button
                onClick={() => onViewDiff(blame.sha)}
                className="flex items-center space-x-1 px-2.5 py-1 rounded-md bg-onedark-surface hover:bg-onedark-surface/80 border border-onedark-borderSubtle text-onedark-fg hover:text-onedark-fgBright text-[11px] font-medium transition-colors cursor-pointer"
                title="View commit diff"
              >
                <Eye className="w-3 h-3 text-onedark-blue" />
                <span>Diff</span>
              </button>
            )}

            {onAskAgent && (
              <button
                onClick={() => {
                  const prompt = blame.is_uncommitted
                    ? `Please inspect the uncommitted edits on line ${blame.line} of \`${filePath}\` and explain the rationale and potential impacts.`
                    : `Please explain why commit \`${blame.short_sha}\` ("${blame.summary}") by ${blame.author} modified line ${blame.line} in \`${filePath}\` and summarize its architectural context.`;
                  onAskAgent(prompt);
                  onClose();
                }}
                className="flex items-center space-x-1 px-2.5 py-1 rounded-md bg-onedark-accent/20 hover:bg-onedark-accent/30 border border-onedark-accent/40 text-onedark-accent text-[11px] font-semibold transition-colors cursor-pointer shadow-xs"
                title="Ask Cyclode Agent about this change"
              >
                <Sparkles className="w-3 h-3" />
                <span>Ask Agent</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );

  return createPortal(cardContent, document.body);
};
