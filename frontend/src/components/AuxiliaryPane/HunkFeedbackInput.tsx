import React, { useState } from 'react';
import { Send, X, MessageSquare, Bot } from 'lucide-react';
import { DiffHunkGap } from '../../utils/diffContextParser';

interface HunkFeedbackInputProps {
  gap: DiffHunkGap;
  onSubmit: (feedback: string, gap: DiffHunkGap) => void;
  onCancel: () => void;
}

export const HunkFeedbackInput: React.FC<HunkFeedbackInputProps> = ({
  gap,
  onSubmit,
  onCancel
}) => {
  const [text, setText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || isSubmitting) return;
    setIsSubmitting(true);
    onSubmit(text.trim(), gap);
  };

  return (
    <div className="p-3 my-1 rounded bg-onedark-surface border border-onedark-blue/40 shadow-lg text-xs space-y-2">
      <div className="flex items-center justify-between text-onedark-muted">
        <div className="flex items-center space-x-1.5">
          <MessageSquare className="w-3.5 h-3.5 text-onedark-blue" />
          <span className="font-semibold text-onedark-fg">Direct Feedback to Agent</span>
          <span className="font-mono text-[10px] text-onedark-blue/80 bg-onedark-blue/10 px-1.5 py-0.5 rounded">
            {gap.filePath}:{gap.gapStartNew}-{gap.gapEndNew}
          </span>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="text-onedark-muted hover:text-onedark-fg p-0.5 rounded cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-2">
        <textarea
          autoFocus
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              handleSubmit(e);
            } else if (e.key === 'Escape') {
              onCancel();
            }
          }}
          placeholder="Ask agent to adjust this hunk (e.g. 'Use pattern matching instead of if check')... (⌘Enter to send)"
          className="w-full p-2 bg-onedark-bg border border-onedark-border/50 rounded text-onedark-fg focus:outline-none focus:border-onedark-blue font-sans text-xs resize-none placeholder:text-onedark-muted/60"
        />

        <div className="flex items-center justify-between">
          <span className="text-[10px] text-onedark-muted/70">
            Esc to cancel · ⌘+Enter to submit
          </span>
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-2.5 py-1 rounded text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/60 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!text.trim() || isSubmitting}
              className="flex items-center space-x-1.5 px-3 py-1 rounded bg-onedark-blue hover:bg-onedark-blue/90 text-white font-medium disabled:opacity-50 transition-colors shadow-xs"
            >
              <Send className="w-3 h-3" />
              <span>{isSubmitting ? 'Sending...' : 'Send to Agent'}</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
