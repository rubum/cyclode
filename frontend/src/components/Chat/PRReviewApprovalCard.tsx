import React, { useState } from 'react';
import {
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  MessageSquare,
  ExternalLink,
  Edit3,
  Eye,
  Check,
  Send,
  X,
  FileCode,
  Sparkles,
  Loader2
} from 'lucide-react';
import { MarkdownRenderer } from '../Common/MarkdownRenderer';

interface PRReviewApprovalCardProps {
  taskId: string;
  approval: {
    id?: string;
    action_type: string;
    action_details: {
      repository?: string;
      repo?: string;
      pr_number?: number;
      body?: string;
      event?: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES' | string;
      commit_sha?: string;
      path?: string;
      line?: number;
      side?: string;
      description?: string;
    };
  };
  onApprove: (feedback?: string, customDetails?: any) => void;
  onReject: (feedback?: string) => void;
}

export const PRReviewApprovalCard: React.FC<PRReviewApprovalCardProps> = ({
  taskId,
  approval,
  onApprove,
  onReject,
}) => {
  const details = approval.action_details || {};
  const isLineComment = approval.action_type.includes('line_comment');
  const repo = details.repository || details.repo || 'Repository';
  const prNumber = details.pr_number || 1;
  const initialBody = details.body || '';
  const initialEvent = (details.event as 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES') || 'COMMENT';

  const [selectedEvent, setSelectedEvent] = useState<'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'>(initialEvent);
  const [editedBody, setEditedBody] = useState<string>(initialBody);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);

  const getSubmitButtonConfig = () => {
    if (isLineComment) {
      return {
        label: 'Post Line Comment to GitHub',
        tooltip: `Submit inline review comment on ${details.path || 'file'}:${details.line || 1} to GitHub`,
        buttonClass: 'bg-onedark-accent hover:bg-onedark-accent/90 text-onedark-darker shadow-md',
        Icon: Send,
        feedback: 'Line comment posted to GitHub',
      };
    }
    switch (selectedEvent) {
      case 'REQUEST_CHANGES':
        return {
          label: 'Request Changes & Post to GitHub',
          tooltip: 'Submit formal changes requested review to GitHub',
          buttonClass: 'bg-onedark-red hover:bg-onedark-red/90 text-white shadow-md shadow-onedark-red/20',
          Icon: AlertCircle,
          feedback: 'Changes requested and submitted to GitHub',
        };
      case 'APPROVE':
        return {
          label: 'Approve PR & Post to GitHub',
          tooltip: 'Submit formal approval review to GitHub',
          buttonClass: 'bg-onedark-green hover:bg-onedark-green/90 text-onedark-darker shadow-md shadow-onedark-green/20',
          Icon: CheckCircle2,
          feedback: 'Approved and submitted to GitHub',
        };
      case 'COMMENT':
      default:
        return {
          label: 'Post Comment to GitHub',
          tooltip: 'Submit general review comments to GitHub',
          buttonClass: 'bg-onedark-accent hover:bg-onedark-accent/90 text-onedark-darker shadow-md shadow-onedark-accent/20',
          Icon: MessageSquare,
          feedback: 'Review comments submitted to GitHub',
        };
    }
  };

  const getBadgeConfig = () => {
    if (isLineComment) {
      return {
        text: 'Inline Comment Staging',
        className: 'bg-onedark-surface text-onedark-accent border-onedark-accent/30',
        Icon: ShieldCheck,
        iconBoxClass: 'bg-onedark-accent/15 border-onedark-accent/30 text-onedark-accent',
      };
    }
    switch (selectedEvent) {
      case 'REQUEST_CHANGES':
        return {
          text: 'Request Changes Staging',
          className: 'bg-onedark-red/15 text-onedark-red border-onedark-red/30',
          Icon: AlertCircle,
          iconBoxClass: 'bg-onedark-red/15 border-onedark-red/30 text-onedark-red',
        };
      case 'APPROVE':
        return {
          text: 'Approval Staging',
          className: 'bg-onedark-green/15 text-onedark-green border-onedark-green/30',
          Icon: CheckCircle2,
          iconBoxClass: 'bg-onedark-green/15 border-onedark-green/30 text-onedark-green',
        };
      case 'COMMENT':
      default:
        return {
          text: 'Review Staging',
          className: 'bg-onedark-surface text-onedark-accent border-onedark-accent/30',
          Icon: ShieldCheck,
          iconBoxClass: 'bg-onedark-accent/15 border-onedark-accent/30 text-onedark-accent',
        };
    }
  };

  const buttonConfig = getSubmitButtonConfig();
  const badgeConfig = getBadgeConfig();
  const HeaderIcon = badgeConfig.Icon;

  const handlePostToGitHub = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onApprove(buttonConfig.feedback, {
        body: editedBody,
        event: selectedEvent,
        repository: repo,
        pr_number: prNumber,
        chat_only: false,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeepInChatOnly = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onApprove('chat_only', {
        body: editedBody,
        event: selectedEvent,
        repository: repo,
        pr_number: prNumber,
        chat_only: true,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDismiss = () => {
    onReject('Review submission cancelled by user');
  };

  return (
    <div className="rounded-xl border border-onedark-border bg-onedark-darker/95 p-4 sm:p-5 space-y-4 shadow-lg overflow-hidden relative transition-all">
      {/* Top Accent Strip */}
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-onedark-accent via-onedark-purple to-onedark-green" />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 pt-1">
        <div className="flex items-center space-x-2.5">
          <div className={`w-7 h-7 rounded-lg border flex items-center justify-center flex-shrink-0 shadow-xs transition-colors ${badgeConfig.iconBoxClass}`}>
            <HeaderIcon className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-xs font-bold text-onedark-fgBright">
                {isLineComment ? 'GitHub Inline PR Comment Staging' : 'GitHub PR Review Staging'}
              </span>
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded border font-semibold transition-colors ${badgeConfig.className}`}>
                {badgeConfig.text}
              </span>
            </div>
            <div className="text-[11px] text-onedark-muted font-mono flex items-center space-x-1.5 pt-0.5">
              <span>Target:</span>
              <strong className="text-onedark-fgBright font-semibold">{repo}#{prNumber}</strong>
              {details.path && (
                <>
                  <span className="text-onedark-muted/60">•</span>
                  <span className="text-onedark-muted">{details.path}:{details.line}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Edit / Preview Mode Switcher */}
        <div className="flex items-center space-x-1.5 self-start sm:self-auto bg-onedark-surface/60 p-1 rounded-lg border border-onedark-borderSubtle text-xs">
          <button
            type="button"
            onClick={() => setIsEditing(false)}
            className={`flex items-center space-x-1 px-2.5 py-1 rounded-md transition-colors cursor-pointer text-[11px] font-medium ${
              !isEditing
                ? 'bg-onedark-darker text-onedark-fgBright shadow-xs'
                : 'text-onedark-muted hover:text-onedark-fg'
            }`}
          >
            <Eye className="w-3 h-3" />
            <span>Preview</span>
          </button>
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className={`flex items-center space-x-1 px-2.5 py-1 rounded-md transition-colors cursor-pointer text-[11px] font-medium ${
              isEditing
                ? 'bg-onedark-darker text-onedark-fgBright shadow-xs'
                : 'text-onedark-muted hover:text-onedark-fg'
            }`}
          >
            <Edit3 className="w-3 h-3" />
            <span>Edit Draft</span>
          </button>
        </div>
      </div>

      {/* Review Event Type Selector (for Formal Reviews) */}
      {!isLineComment && (
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-onedark-muted uppercase tracking-wider font-mono">
            Review Submission Decision
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {/* Comment */}
            <button
              type="button"
              onClick={() => setSelectedEvent('COMMENT')}
              className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer flex items-center space-x-2.5 ${
                selectedEvent === 'COMMENT'
                  ? 'bg-onedark-accent/15 border-onedark-accent text-onedark-fgBright shadow-xs'
                  : 'bg-onedark-surface/30 hover:bg-onedark-surface/60 border-onedark-borderSubtle text-onedark-fg'
              }`}
            >
              <div className={`w-4 h-4 rounded-full border flex items-center justify-center flex-shrink-0 ${
                selectedEvent === 'COMMENT' ? 'border-onedark-accent bg-onedark-accent text-onedark-darker' : 'border-onedark-muted/40'
              }`}>
                {selectedEvent === 'COMMENT' && <Check className="w-2.5 h-2.5 stroke-[3]" />}
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold">General Comment</div>
                <div className="text-[10px] text-onedark-muted font-mono">No state change</div>
              </div>
            </button>

            {/* Approve */}
            <button
              type="button"
              onClick={() => setSelectedEvent('APPROVE')}
              className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer flex items-center space-x-2.5 ${
                selectedEvent === 'APPROVE'
                  ? 'bg-onedark-green/15 border-onedark-green text-onedark-fgBright shadow-xs'
                  : 'bg-onedark-surface/30 hover:bg-onedark-surface/60 border-onedark-borderSubtle text-onedark-fg'
              }`}
            >
              <div className={`w-4 h-4 rounded-full border flex items-center justify-center flex-shrink-0 ${
                selectedEvent === 'APPROVE' ? 'border-onedark-green bg-onedark-green text-onedark-darker' : 'border-onedark-muted/40'
              }`}>
                {selectedEvent === 'APPROVE' && <Check className="w-2.5 h-2.5 stroke-[3]" />}
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-onedark-green">Approve PR</div>
                <div className="text-[10px] text-onedark-muted font-mono">LGTM / Ready to merge</div>
              </div>
            </button>

            {/* Request Changes */}
            <button
              type="button"
              onClick={() => setSelectedEvent('REQUEST_CHANGES')}
              className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer flex items-center space-x-2.5 ${
                selectedEvent === 'REQUEST_CHANGES'
                  ? 'bg-onedark-red/15 border-onedark-red text-onedark-fgBright shadow-xs'
                  : 'bg-onedark-surface/30 hover:bg-onedark-surface/60 border-onedark-borderSubtle text-onedark-fg'
              }`}
            >
              <div className={`w-4 h-4 rounded-full border flex items-center justify-center flex-shrink-0 ${
                selectedEvent === 'REQUEST_CHANGES' ? 'border-onedark-red bg-onedark-red text-onedark-darker' : 'border-onedark-muted/40'
              }`}>
                {selectedEvent === 'REQUEST_CHANGES' && <Check className="w-2.5 h-2.5 stroke-[3]" />}
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-onedark-red">Request Changes</div>
                <div className="text-[10px] text-onedark-muted font-mono">Blocking defects found</div>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Review Body (Editable or Markdown Preview) */}
      <div className="space-y-1.5">
        <label className="text-[11px] font-semibold text-onedark-muted uppercase tracking-wider font-mono flex items-center justify-between">
          <span>{isEditing ? 'Edit Review Body (Markdown)' : 'Review Body Preview'}</span>
          <span className="text-[10px] text-onedark-muted/80 lowercase">{editedBody.length} characters</span>
        </label>

        {isEditing ? (
          <textarea
            value={editedBody}
            onChange={(e) => setEditedBody(e.target.value)}
            rows={8}
            placeholder="Write or edit the PR review comments..."
            className="w-full bg-onedark-surface/30 border border-onedark-borderSubtle rounded-xl p-3 text-xs text-onedark-fg font-mono focus:outline-none focus:border-onedark-accent resize-y leading-relaxed"
          />
        ) : (
          <div className="max-h-80 overflow-y-auto rounded-xl bg-onedark-surface/25 border border-onedark-borderSubtle p-3.5 text-xs text-onedark-fg font-sans leading-relaxed [scrollbar-gutter:stable]">
            {editedBody ? (
              <MarkdownRenderer content={editedBody} className="space-y-2 text-xs" />
            ) : (
              <div className="text-onedark-muted italic">No comment text provided.</div>
            )}
          </div>
        )}
      </div>

      {/* Action Buttons Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 pt-2 border-t border-onedark-borderSubtle/70">
        <div className="flex items-center space-x-2">
          {/* Dismiss / Reject */}
          <button
            type="button"
            onClick={handleDismiss}
            disabled={submitting}
            className="px-3 py-1.5 rounded-lg bg-onedark-surface/40 hover:bg-onedark-surface text-onedark-muted hover:text-onedark-red border border-onedark-borderSubtle text-xs font-medium transition-colors cursor-pointer flex items-center space-x-1.5 disabled:opacity-50"
            title="Cancel and dismiss this review without any action"
          >
            <X className="w-3.5 h-3.5" />
            <span>Dismiss</span>
          </button>

          {/* Keep in Chat Only */}
          <button
            type="button"
            onClick={handleKeepInChatOnly}
            disabled={submitting}
            className="px-3 py-1.5 rounded-lg bg-onedark-surface hover:bg-onedark-surface/80 text-onedark-fgBright border border-onedark-borderSubtle text-xs font-semibold transition-colors cursor-pointer flex items-center space-x-1.5 disabled:opacity-50"
            title="Acknowledge review in this session without posting externally to GitHub"
          >
            <MessageSquare className="w-3.5 h-3.5 text-onedark-accent" />
            <span>Keep in Chat Only</span>
          </button>
        </div>

        {/* Primary Action Button (Dynamic Decision-Aware) */}
        {(() => {
          const SubmitIcon = buttonConfig.Icon;
          return (
            <button
              type="button"
              onClick={handlePostToGitHub}
              disabled={submitting || !editedBody.trim()}
              className={`px-4 py-2 rounded-xl font-bold text-xs flex items-center justify-center space-x-1.5 transition-all cursor-pointer disabled:opacity-50 select-none ${buttonConfig.buttonClass}`}
              title={buttonConfig.tooltip}
            >
              {submitting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <SubmitIcon className="w-3.5 h-3.5" />
              )}
              <span>{buttonConfig.label}</span>
            </button>
          );
        })()}
      </div>
    </div>
  );
};
