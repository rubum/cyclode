import React from 'react';
import { ChevronUp, ChevronDown, ChevronsUpDown, Loader2, Sparkles, MessageSquare } from 'lucide-react';
import { DiffHunkGap } from '../../utils/diffContextParser';

interface DiffHunkExpanderProps {
  gap: DiffHunkGap;
  isFocused?: boolean;
  isLoading?: boolean;
  onExpandUp: (gap: DiffHunkGap) => void;
  onExpandDown: (gap: DiffHunkGap) => void;
  onExpandAll: (gap: DiffHunkGap) => void;
  onFocus?: (gapId: string) => void;
  onCommentClick?: (gap: DiffHunkGap) => void;
}

export const DiffHunkExpander: React.FC<DiffHunkExpanderProps> = ({
  gap,
  isFocused = false,
  isLoading = false,
  onExpandUp,
  onExpandDown,
  onExpandAll,
  onFocus,
  onCommentClick
}) => {
  const isSmallGap = gap.gapSize <= 20;

  const handleBarClick = (e: React.MouseEvent) => {
    // If user clicked the bar background directly, focus or expand all if small
    onFocus?.(gap.id);
    if (isSmallGap && !isLoading) {
      onExpandAll(gap);
    }
  };

  return (
    <div
      tabIndex={0}
      data-hunk-id={gap.id}
      onClick={handleBarClick}
      className={`group relative flex items-center justify-between px-3 py-1 my-0.5 rounded text-xs select-none transition-all duration-150 border ${
        isFocused
          ? 'bg-onedark-blue/15 border-onedark-blue/60 ring-1 ring-onedark-blue/50 text-onedark-fgBright'
          : 'bg-onedark-surface/50 hover:bg-onedark-surface/80 border-onedark-border/30 hover:border-onedark-border/60 text-onedark-muted'
      }`}
    >
      {/* Left controls */}
      <div className="flex items-center space-x-1.5" onClick={(e) => e.stopPropagation()}>
        {isLoading ? (
          <div className="flex items-center space-x-1.5 px-2 py-0.5 text-onedark-blue font-medium animate-pulse">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>Loading {gap.gapSize} lines...</span>
          </div>
        ) : isSmallGap ? (
          <button
            type="button"
            onClick={() => onExpandAll(gap)}
            className="flex items-center space-x-1 px-2.5 py-0.5 rounded bg-onedark-blue/15 hover:bg-onedark-blue/25 text-onedark-blue font-medium transition-colors cursor-pointer border border-onedark-blue/30 hover:border-onedark-blue/60 btn-tactile"
            title={`Expand all ${gap.gapSize} unchanged lines (or press 'z')`}
          >
            <ChevronsUpDown className="w-3.5 h-3.5" />
            <span>
              {gap.type === 'top'
                ? `Expand lines 1..${gap.gapEndNew} (${gap.gapSize} lines to top)`
                : gap.type === 'bottom'
                ? `Expand lines below (${gap.gapSize} lines to EOF)`
                : `Expand all ${gap.gapSize} lines`}
            </span>
          </button>
        ) : (
          <div className="flex items-center space-x-1">
            {gap.type !== 'bottom' && (
              <button
                type="button"
                onClick={() => onExpandUp(gap)}
                className="flex items-center space-x-1 px-2 py-0.5 rounded bg-onedark-surface hover:bg-onedark-border/50 text-onedark-fg font-medium transition-colors cursor-pointer border border-onedark-border/40 hover:border-onedark-blue/50 btn-tactile"
                title="Expand 20 lines up"
              >
                <ChevronUp className="w-3.5 h-3.5 text-onedark-blue" />
                <span>20 lines</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => onExpandAll(gap)}
              className="flex items-center space-x-1 px-2.5 py-0.5 rounded bg-onedark-blue/15 hover:bg-onedark-blue/25 text-onedark-blue font-medium transition-colors cursor-pointer border border-onedark-blue/30 hover:border-onedark-blue/60 btn-tactile"
              title={`Expand all ${gap.gapSize} lines (or press 'z')`}
            >
              <ChevronsUpDown className="w-3.5 h-3.5" />
              <span>All {gap.gapSize} lines</span>
            </button>

            {gap.type !== 'top' && (
              <button
                type="button"
                onClick={() => onExpandDown(gap)}
                className="flex items-center space-x-1 px-2 py-0.5 rounded bg-onedark-surface hover:bg-onedark-border/50 text-onedark-fg font-medium transition-colors cursor-pointer border border-onedark-border/40 hover:border-onedark-blue/50 btn-tactile"
                title="Expand 20 lines down"
              >
                <ChevronDown className="w-3.5 h-3.5 text-onedark-blue" />
                <span>20 lines</span>
              </button>
            )}
          </div>
        )}

        {/* Comment on Hunk Button */}
        {onCommentClick && (
          <button
            type="button"
            onClick={() => onCommentClick(gap)}
            className="opacity-0 group-hover:opacity-100 flex items-center space-x-1 px-1.5 py-0.5 rounded text-[11px] text-onedark-muted hover:text-onedark-green hover:bg-onedark-green/10 transition-all cursor-pointer ml-2 btn-tactile"
            title="Ask agent about this hunk (or press 'c')"
          >
            <MessageSquare className="w-3 h-3" />
            <span>Comment</span>
          </button>
        )}
      </div>

      {/* Right Context Badge & Hotkey Hint */}
      <div className="flex items-center space-x-2 overflow-hidden text-right pl-2">
        <span className="opacity-0 group-hover:opacity-80 text-[10px] text-onedark-muted transition-opacity hidden sm:inline">
          <kbd className="px-1 py-0.2 rounded bg-onedark-surface border border-onedark-border/40 font-mono text-[9px]">z</kbd> expand · <kbd className="px-1 py-0.2 rounded bg-onedark-surface border border-onedark-border/40 font-mono text-[9px]">[ ]</kbd> jump
        </span>

        {gap.symbolContext ? (
          <span
            className="truncate font-mono text-[11px] text-onedark-purple/90 bg-onedark-purple/10 px-2 py-0.5 rounded border border-onedark-purple/20 max-w-[280px]"
            title={gap.symbolContext}
          >
            {gap.symbolContext}
          </span>
        ) : (
          <span className="font-mono text-[10px] text-onedark-muted/60">
            {gap.type === 'top' ? 'Top of file' : gap.type === 'bottom' ? 'End of file' : `@@ -${gap.gapStartOld} +${gap.gapStartNew} @@`}
          </span>
        )}
      </div>
    </div>
  );
};
