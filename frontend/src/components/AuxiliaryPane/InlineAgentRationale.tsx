import React from 'react';
import { Bot, Sparkles, X } from 'lucide-react';

interface InlineAgentRationaleProps {
  intent: string;
  toolName?: string;
  onDismiss?: () => void;
}

export const InlineAgentRationale: React.FC<InlineAgentRationaleProps> = ({
  intent,
  toolName,
  onDismiss
}) => {
  if (!intent) return null;

  return (
    <div className="flex items-start justify-between px-3 py-1.5 my-1 rounded bg-onedark-purple/10 border border-onedark-purple/30 text-xs text-onedark-fg leading-relaxed">
      <div className="flex items-start space-x-2 min-w-0 pr-2">
        <Bot className="w-3.5 h-3.5 text-onedark-purple flex-shrink-0 mt-0.5" />
        <div className="min-w-0">
          <span className="font-semibold text-onedark-purple mr-1.5">
            Agent Intent{toolName ? ` (${toolName})` : ''}:
          </span>
          <span className="text-onedark-fg/90">{intent}</span>
        </div>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="text-onedark-muted hover:text-onedark-fg p-0.5 rounded cursor-pointer transition-colors"
          title="Dismiss note"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
};
