import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  FileText,
  FileCode2,
  Copy,
  Check,
  X,
  WrapText,
  Pencil,
  Eye,
  CornerDownLeft,
  Download,
  Code2
} from 'lucide-react';
import { SniffedPastedDoc, formatBytes } from '../../utils/pastedDocSniffer';
import { highlightCode, splitHtmlLines } from '../../utils/syntaxHighlighter';

interface PastedDocModalProps {
  isOpen: boolean;
  doc: SniffedPastedDoc | null;
  onClose: () => void;
  onUpdateDoc?: (updated: SniffedPastedDoc) => void;
  onUnwrapDoc?: (doc: SniffedPastedDoc) => void;
  readOnly?: boolean;
}

const SUPPORTED_LANGUAGES = [
  { id: 'text', label: 'Plain Text' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'python', label: 'Python' },
  { id: 'sql', label: 'SQL' },
  { id: 'json', label: 'JSON' },
  { id: 'yaml', label: 'YAML' },
  { id: 'bash', label: 'Bash / Shell' },
  { id: 'rust', label: 'Rust' },
  { id: 'go', label: 'Go' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'html', label: 'HTML' },
  { id: 'css', label: 'CSS' },
];

export const PastedDocModal: React.FC<PastedDocModalProps> = ({
  isOpen,
  doc,
  onClose,
  onUpdateDoc,
  onUnwrapDoc,
  readOnly = false,
}) => {
  const [copied, setCopied] = useState(false);
  const [isWordWrap, setIsWordWrap] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState('');
  const [contentValue, setContentValue] = useState('');
  const [selectedLang, setSelectedLang] = useState('text');

  const titleInputRef = useRef<HTMLInputElement>(null);

  // Sync internal state when active doc changes
  useEffect(() => {
    if (doc) {
      setTitleValue(doc.title);
      setContentValue(doc.content);
      setSelectedLang(doc.language);
      setIsEditing(false);
      setIsEditingTitle(false);
      setCopied(false);
    }
  }, [doc]);

  // Handle escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isEditingTitle]);

  // Syntax highlighting computation (must precede any conditional returns)
  const highlightedLines = useMemo(() => {
    if (!isOpen || !doc || isEditing) return [];
    try {
      const html = highlightCode(contentValue, selectedLang, titleValue);
      return splitHtmlLines(html);
    } catch {
      return contentValue.split(/\r?\n/);
    }
  }, [isOpen, doc, contentValue, selectedLang, titleValue, isEditing]);

  if (!isOpen || !doc) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(contentValue);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy document content:', err);
    }
  };

  const handleDownload = () => {
    const blob = new Blob([contentValue], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = titleValue || doc.title;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleSaveDocChanges = () => {
    if (onUpdateDoc && !readOnly) {
      const lines = contentValue.split(/\r?\n/);
      const updated: SniffedPastedDoc = {
        ...doc,
        title: titleValue.trim() || doc.title,
        content: contentValue,
        language: selectedLang,
        lineCount: lines.length,
        charCount: contentValue.length,
        wordCount: contentValue.trim() ? contentValue.trim().split(/\s+/).length : 0,
        sizeBytes: new Blob([contentValue]).size,
      };
      onUpdateDoc(updated);
    }
    setIsEditing(false);
    setIsEditingTitle(false);
  };

  const handleTitleBlur = () => {
    setIsEditingTitle(false);
    if (!titleValue.trim()) {
      setTitleValue(doc.title);
    } else if (onUpdateDoc && !readOnly) {
      onUpdateDoc({
        ...doc,
        title: titleValue.trim(),
      });
    }
  };

  const handleLanguageChange = (newLang: string) => {
    setSelectedLang(newLang);
    if (onUpdateDoc && !readOnly) {
      onUpdateDoc({
        ...doc,
        language: newLang,
      });
    }
  };

  const lines = contentValue.split(/\r?\n/);
  const currentBytes = new Blob([contentValue]).size;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl h-[88vh] max-h-[900px] flex flex-col rounded-2xl bg-onedark-surface border border-onedark-border shadow-2xl shadow-black/60 overflow-hidden font-sans select-text"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header Bar */}
        <div className="px-4 py-3 bg-onedark-darker/90 border-b border-onedark-borderSubtle flex items-center justify-between gap-3 flex-shrink-0">
          <div className="flex items-center space-x-3 min-w-0 flex-1">
            <div className="p-2 rounded-xl bg-onedark-accent/15 border border-onedark-accent/25 text-onedark-accent flex items-center justify-center flex-shrink-0">
              {selectedLang === 'text' || selectedLang === 'markdown' ? (
                <FileText className="w-5 h-5" />
              ) : (
                <FileCode2 className="w-5 h-5" />
              )}
            </div>

            <div className="flex flex-col min-w-0 flex-1">
              {isEditingTitle && !readOnly ? (
                <input
                  ref={titleInputRef}
                  type="text"
                  value={titleValue}
                  onChange={(e) => setTitleValue(e.target.value)}
                  onBlur={handleTitleBlur}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleTitleBlur();
                    if (e.key === 'Escape') {
                      setTitleValue(doc.title);
                      setIsEditingTitle(false);
                    }
                  }}
                  className="px-2 py-0.5 rounded bg-onedark-surface border border-onedark-accent text-sm font-semibold font-mono text-onedark-fgBright focus:outline-none w-full max-w-sm"
                />
              ) : (
                <div className="flex items-center space-x-2 group">
                  <h3
                    className="font-mono font-semibold text-sm sm:text-base text-onedark-fgBright truncate cursor-pointer hover:text-onedark-accent transition-colors"
                    title={!readOnly ? "Click to rename document" : undefined}
                    onClick={() => {
                      if (!readOnly) setIsEditingTitle(true);
                    }}
                  >
                    {titleValue || doc.title}
                  </h3>
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => setIsEditingTitle(true)}
                      className="opacity-0 group-hover:opacity-100 text-onedark-muted hover:text-onedark-fg p-0.5 rounded transition-opacity"
                      title="Rename document"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}

              {/* Metadata Badges */}
              <div className="flex items-center space-x-2 text-[11px] font-mono text-onedark-muted mt-0.5 flex-wrap">
                <span>{lines.length} lines</span>
                <span>·</span>
                <span>{contentValue.length.toLocaleString()} chars</span>
                <span>·</span>
                <span>{formatBytes(currentBytes)}</span>
                <span>·</span>
                <span className="uppercase text-[10px] px-1.5 py-0.2 rounded bg-onedark-surface border border-onedark-borderSubtle text-onedark-fg">
                  {selectedLang}
                </span>
              </div>
            </div>
          </div>

          {/* Action Toolbar */}
          <div className="flex items-center space-x-1.5 flex-shrink-0">
            {/* Language Selector */}
            <div className="relative">
              <select
                value={selectedLang}
                onChange={(e) => handleLanguageChange(e.target.value)}
                disabled={readOnly}
                className="h-8 pl-2.5 pr-6 rounded-lg bg-onedark-surface/80 hover:bg-onedark-surface border border-onedark-borderSubtle text-xs font-mono text-onedark-fg focus:outline-none focus:border-onedark-accent cursor-pointer transition-colors disabled:opacity-50 appearance-none"
                title="Change syntax language"
              >
                {SUPPORTED_LANGUAGES.map((l) => (
                  <option key={l.id} value={l.id} className="bg-onedark-darker text-onedark-fg">
                    {l.label}
                  </option>
                ))}
              </select>
              <Code2 className="w-3 h-3 text-onedark-muted absolute right-2 top-2.5 pointer-events-none" />
            </div>

            {/* Word Wrap Toggle */}
            <button
              type="button"
              onClick={() => setIsWordWrap(!isWordWrap)}
              className={`h-8 px-2.5 rounded-lg border text-xs font-mono flex items-center space-x-1.5 transition-colors cursor-pointer ${
                isWordWrap
                  ? 'bg-onedark-accent/20 border-onedark-accent text-onedark-accent'
                  : 'bg-onedark-surface/80 hover:bg-onedark-surface border-onedark-borderSubtle text-onedark-muted hover:text-onedark-fg'
              }`}
              title="Toggle line wrapping"
            >
              <WrapText className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Wrap</span>
            </button>

            {/* Edit / View Mode Toggle */}
            {!readOnly && (
              <button
                type="button"
                onClick={() => {
                  if (isEditing) {
                    handleSaveDocChanges();
                  } else {
                    setIsEditing(true);
                  }
                }}
                className={`h-8 px-2.5 rounded-lg border text-xs font-mono flex items-center space-x-1.5 transition-colors cursor-pointer ${
                  isEditing
                    ? 'bg-onedark-yellow/20 border-onedark-yellow text-onedark-yellow font-semibold'
                    : 'bg-onedark-surface/80 hover:bg-onedark-surface border-onedark-borderSubtle text-onedark-muted hover:text-onedark-fg'
                }`}
                title={isEditing ? "Finish editing" : "Edit document text"}
              >
                {isEditing ? <Eye className="w-3.5 h-3.5" /> : <Pencil className="w-3.5 h-3.5" />}
                <span className="hidden sm:inline">{isEditing ? 'Preview' : 'Edit'}</span>
              </button>
            )}

            {/* Copy Button */}
            <button
              type="button"
              onClick={handleCopy}
              className="h-8 px-2.5 rounded-lg bg-onedark-surface/80 hover:bg-onedark-surface border border-onedark-borderSubtle text-onedark-muted hover:text-onedark-fg text-xs font-mono flex items-center space-x-1.5 transition-colors cursor-pointer"
              title="Copy all text to clipboard"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-onedark-green" /> : <Copy className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{copied ? 'Copied!' : 'Copy'}</span>
            </button>

            {/* Download Button */}
            <button
              type="button"
              onClick={handleDownload}
              className="h-8 w-8 rounded-lg bg-onedark-surface/80 hover:bg-onedark-surface border border-onedark-borderSubtle text-onedark-muted hover:text-onedark-fg flex items-center justify-center transition-colors cursor-pointer"
              title="Download document file"
            >
              <Download className="w-3.5 h-3.5" />
            </button>

            {/* Close Button */}
            <button
              type="button"
              onClick={onClose}
              className="h-8 w-8 rounded-lg bg-onedark-surface/80 hover:bg-onedark-surface hover:text-onedark-red border border-onedark-borderSubtle text-onedark-muted flex items-center justify-center transition-colors cursor-pointer ml-1"
              title="Close modal (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Document Body Area */}
        <div className="flex-1 min-h-0 relative overflow-hidden bg-onedark-darker/60 flex flex-col">
          {isEditing ? (
            <textarea
              value={contentValue}
              onChange={(e) => setContentValue(e.target.value)}
              className="w-full h-full p-4 font-mono text-xs sm:text-[13px] leading-relaxed bg-onedark-darker text-onedark-fgBright focus:outline-none resize-none overflow-y-auto selection:bg-onedark-accent/30"
              placeholder="Paste or edit document text here..."
              autoFocus
            />
          ) : (
            <div className="w-full h-full overflow-auto flex select-text">
              {/* Line Numbers Gutter */}
              <div
                aria-hidden="true"
                className="py-3 px-3 sm:px-4 bg-onedark-darker/90 border-r border-onedark-borderSubtle/60 text-right font-mono text-[11px] sm:text-xs text-onedark-muted/50 select-none flex flex-col flex-shrink-0 min-w-[48px] sm:min-w-[56px]"
              >
                {lines.map((_, i) => (
                  <div key={i} className="leading-relaxed h-[20px]">
                    {i + 1}
                  </div>
                ))}
              </div>

              {/* Syntax Highlighted Lines */}
              <div
                className={`py-3 px-4 font-mono text-xs sm:text-[13px] leading-relaxed flex-1 text-onedark-fg overflow-x-auto ${
                  isWordWrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'
                }`}
              >
                {highlightedLines.map((lineHtml, i) => (
                  <div
                    key={i}
                    className="h-[20px] leading-relaxed hover:bg-onedark-surface/30 px-1 -mx-1 rounded"
                    dangerouslySetInnerHTML={{ __html: lineHtml || '&nbsp;' }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer Bar */}
        <div className="px-4 py-2.5 bg-onedark-darker/90 border-t border-onedark-borderSubtle flex items-center justify-between flex-shrink-0 text-xs font-mono text-onedark-muted">
          <div className="flex items-center space-x-2">
            <span>Esc to close</span>
            <span>·</span>
            <span>Click title or "Edit" to modify</span>
          </div>

          <div className="flex items-center space-x-2">
            {!readOnly && onUnwrapDoc && (
              <button
                type="button"
                onClick={() => {
                  onUnwrapDoc(doc);
                  onClose();
                }}
                className="px-3 py-1.5 rounded-lg border border-onedark-borderSubtle hover:border-onedark-accent/60 bg-onedark-surface hover:bg-onedark-surfaceHighlight text-onedark-fg hover:text-onedark-accent transition-colors flex items-center space-x-1.5 cursor-pointer"
                title="Convert back to raw inline text in the prompt input"
              >
                <CornerDownLeft className="w-3.5 h-3.5" />
                <span>Paste Inline into Prompt</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                if (isEditing) handleSaveDocChanges();
                onClose();
              }}
              className="px-4 py-1.5 rounded-lg bg-onedark-accent hover:bg-onedark-accent/90 text-onedark-darker font-bold transition-all shadow-sm active:scale-95 cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
