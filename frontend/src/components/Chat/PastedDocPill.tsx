import React from 'react';
import {
  FileText,
  FileCode2,
  Eye,
  CornerDownLeft,
  X
} from 'lucide-react';
import { SniffedPastedDoc, formatBytes } from '../../utils/pastedDocSniffer';

interface PastedDocPillProps {
  doc: SniffedPastedDoc;
  onOpenModal: (doc: SniffedPastedDoc) => void;
  onUnwrapDoc?: (doc: SniffedPastedDoc) => void;
  onRemoveDoc?: (docId: string) => void;
  isReadonly?: boolean;
}

export const PastedDocPill: React.FC<PastedDocPillProps> = ({
  doc,
  onOpenModal,
  onUnwrapDoc,
  onRemoveDoc,
  isReadonly = false,
}) => {
  const isCode = doc.language !== 'text';

  return (
    <div
      onClick={() => onOpenModal(doc)}
      className="flex items-center space-x-2 px-2.5 py-1.5 rounded-lg bg-onedark-surface/80 hover:bg-onedark-surface border border-onedark-accent/30 hover:border-onedark-accent/70 text-[11px] font-mono text-onedark-fg shadow-2xs group cursor-pointer transition-all active:scale-[0.99]"
      title={`Click to view and inspect ${doc.title}`}
    >
      {/* Icon Badge */}
      <div className="p-1 rounded bg-onedark-accent/15 border border-onedark-accent/25 flex items-center justify-center flex-shrink-0 text-onedark-accent group-hover:scale-105 transition-transform">
        {isCode ? (
          <FileCode2 className="w-3.5 h-3.5" />
        ) : (
          <FileText className="w-3.5 h-3.5" />
        )}
      </div>

      {/* Title & Metrics */}
      <span className="truncate max-w-[170px] font-semibold text-onedark-fgBright group-hover:text-onedark-accent transition-colors">
        {doc.title}
      </span>
      <span className="text-onedark-muted/80 text-[10.5px] flex-shrink-0">
        ({doc.lineCount} lines · {formatBytes(doc.sizeBytes)})
      </span>

      {/* Language badge */}
      <span className="text-[9.5px] uppercase px-1 py-0.2 rounded bg-onedark-darker/60 text-onedark-muted border border-onedark-borderSubtle flex-shrink-0">
        {doc.language}
      </span>

      {/* Actions */}
      <div className="flex items-center space-x-0.5 ml-1 flex-shrink-0">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenModal(doc);
          }}
          className="text-onedark-muted hover:text-onedark-accent hover:bg-onedark-darker/60 rounded p-1 cursor-pointer transition-colors"
          title="Inspect document"
        >
          <Eye className="w-3 h-3" />
        </button>

        {!isReadonly && onUnwrapDoc && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onUnwrapDoc(doc);
            }}
            className="text-onedark-muted hover:text-onedark-yellow hover:bg-onedark-darker/60 rounded p-1 cursor-pointer transition-colors"
            title="Expand back into inline prompt text"
          >
            <CornerDownLeft className="w-3 h-3" />
          </button>
        )}

        {!isReadonly && onRemoveDoc && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemoveDoc(doc.id);
            }}
            className="text-onedark-muted hover:text-onedark-red hover:bg-onedark-darker/60 rounded p-1 cursor-pointer transition-colors"
            title="Remove document"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
};
