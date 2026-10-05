import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  FileText,
  Edit3,
  Eye,
  Save,
  Download,
  ExternalLink,
  Copy,
  Check,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  List,
  ListOrdered,
  Heading1,
  Heading2,
  Heading3,
  Table,
  Undo,
  Redo,
  Loader2,
  AlertCircle,
  FileCheck,
  Moon,
  Sun,
  BookOpen
} from 'lucide-react';

export type DocxTheme = 'dark' | 'sepia' | 'light';

interface DocxMetadata {
  html: string;
  text: string;
  headings: Array<{ level: number; text: string }>;
  paragraphs_count: number;
  words_count: number;
  characters_count: number;
  tables_count: number;
  size: number;
  raw_url: string;
  error?: string;
}

interface DocxViewerProps {
  taskId: string;
  filePath: string;
  fileSize?: number;
  rawUrl: string;
  onRefresh?: () => void;
}

const API_BASE = (import.meta as any).env?.VITE_API_URL || '';

export const DocxViewer: React.FC<DocxViewerProps> = ({
  taskId,
  filePath,
  fileSize,
  rawUrl,
  onRefresh,
}) => {
  const [data, setData] = useState<DocxMetadata | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Theme state: 'dark' | 'sepia' | 'light'
  const [docTheme, setDocTheme] = useState<DocxTheme>(() => {
    try {
      const saved = localStorage.getItem('cyclode_docx_theme');
      if (saved === 'dark' || saved === 'sepia' || saved === 'light') return saved;
    } catch (e) {}
    return 'dark';
  });

  const handleThemeChange = (newTheme: DocxTheme) => {
    setDocTheme(newTheme);
    try {
      localStorage.setItem('cyclode_docx_theme', newTheme);
    } catch (e) {}
  };

  // Mode: 'preview' | 'edit'
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [zoom, setZoom] = useState<number>(100);
  const [copied, setCopied] = useState<boolean>(false);

  // Edit state
  const [hasChanges, setHasChanges] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const editorRef = useRef<HTMLDivElement>(null);

  const formatBytes = (bytes?: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const fetchDocx = useCallback(async () => {
    if (!taskId || !filePath) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/tasks/${taskId}/files/docx-inspect?path=${encodeURIComponent(filePath)}`
      );
      if (res.ok) {
        const json = await res.json();
        setData(json);
        setHasChanges(false);
      } else {
        const errJson = await res.json().catch(() => ({}));
        setError(errJson.detail || 'Failed to inspect DOCX file');
      }
    } catch (err: any) {
      setError(err.message || 'Error loading document');
    } finally {
      setLoading(false);
    }
  }, [taskId, filePath]);

  useEffect(() => {
    fetchDocx();
  }, [fetchDocx]);

  // Sync editor content when switching to edit mode
  useEffect(() => {
    if (isEditing && editorRef.current && data) {
      editorRef.current.innerHTML = data.html || '';
    }
  }, [isEditing, data]);

  const handleCopyText = () => {
    if (!data?.text) return;
    navigator.clipboard.writeText(data.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleFormat = (command: string, value: string | undefined = undefined) => {
    document.execCommand(command, false, value);
    if (editorRef.current) {
      setHasChanges(true);
    }
  };

  const handleInsertTable = () => {
    const tableHtml = `
      <table class="w-full border-collapse border border-onedark-borderSubtle my-3">
        <tbody>
          <tr>
            <td class="border border-onedark-borderSubtle p-2">Cell 1</td>
            <td class="border border-onedark-borderSubtle p-2">Cell 2</td>
          </tr>
          <tr>
            <td class="border border-onedark-borderSubtle p-2">Cell 3</td>
            <td class="border border-onedark-borderSubtle p-2">Cell 4</td>
          </tr>
        </tbody>
      </table>
      <p><br/></p>
    `;
    document.execCommand('insertHTML', false, tableHtml);
    setHasChanges(true);
  };

  const handleSave = async () => {
    if (!editorRef.current || !taskId || !filePath || isSaving) return;
    setIsSaving(true);
    setSaveSuccess(false);
    try {
      const htmlContent = editorRef.current.innerHTML;
      const res = await fetch(`${API_BASE}/api/tasks/${taskId}/files/docx-save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: filePath,
          html: htmlContent,
        }),
      });

      if (res.ok) {
        const updated = await res.json();
        setData(updated);
        setHasChanges(false);
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2500);
        if (onRefresh) onRefresh();
      } else {
        const errJson = await res.json().catch(() => ({}));
        alert(`Save failed: ${errJson.detail || 'Unknown error'}`);
      }
    } catch (err: any) {
      alert(`Save error: ${err.message || 'Network error'}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Keyboard shortcut: Cmd+S / Ctrl+S to save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        if (isEditing && hasChanges) {
          e.preventDefault();
          handleSave();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isEditing, hasChanges, isSaving]);

  // Theme definitions
  const themeStyles: Record<DocxTheme, {
    containerBg: string;
    paperBg: string;
    paperBorder: string;
    paperShadow: string;
    textColor: string;
    fontFamily: string;
    proseClass: string;
    themeClass: string;
  }> = {
    dark: {
      containerBg: 'bg-[#0b0e14]',
      paperBg: 'bg-[#161b22]',
      paperBorder: 'border-[#30363d]',
      paperShadow: 'shadow-2xl shadow-black/60',
      textColor: '#e6edf3',
      fontFamily: 'Calibri, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      proseClass: 'prose prose-invert max-w-none',
      themeClass: 'docx-dark',
    },
    sepia: {
      containerBg: 'bg-[#211b15]',
      paperBg: 'bg-[#fbf0d9]',
      paperBorder: 'border-[#e4d6b4]',
      paperShadow: 'shadow-2xl shadow-black/40',
      textColor: '#382e22',
      fontFamily: 'Georgia, "Times New Roman", Cambria, serif',
      proseClass: 'prose prose-stone max-w-none',
      themeClass: 'docx-sepia',
    },
    light: {
      containerBg: 'bg-[#e2e8f0]',
      paperBg: 'bg-white',
      paperBorder: 'border-gray-200',
      paperShadow: 'shadow-2xl shadow-slate-400/25',
      textColor: '#1f2937',
      fontFamily: 'Calibri, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      proseClass: 'prose prose-slate max-w-none',
      themeClass: 'docx-light',
    },
  };

  const currentTheme = themeStyles[docTheme];

  return (
    <div className="h-full flex flex-col bg-onedark-bg font-sans overflow-hidden select-none">
      {/* Dynamic Theme Styles for DOCX Rendered Elements */}
      <style>{`
        .docx-rendered-content.docx-dark {
          color: #c9d1d9;
        }
        .docx-rendered-content.docx-dark h1 {
          color: #79c0ff;
          border-bottom: 1px solid #30363d;
          padding-bottom: 0.3em;
          margin-top: 1.2em;
          margin-bottom: 0.6em;
          font-weight: 700;
        }
        .docx-rendered-content.docx-dark h2 {
          color: #a5d6ff;
          margin-top: 1em;
          margin-bottom: 0.5em;
          font-weight: 600;
        }
        .docx-rendered-content.docx-dark h3 {
          color: #d2a8ff;
          margin-top: 0.8em;
          margin-bottom: 0.4em;
          font-weight: 600;
        }
        .docx-rendered-content.docx-dark p {
          color: #c9d1d9;
          margin-top: 0.4em;
          margin-bottom: 0.4em;
        }
        .docx-rendered-content.docx-dark strong, .docx-rendered-content.docx-dark b {
          color: #f0f6fc;
          font-weight: 600;
        }
        .docx-rendered-content.docx-dark em, .docx-rendered-content.docx-dark i {
          color: #abb2bf;
        }
        .docx-rendered-content.docx-dark a {
          color: #58a6ff;
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .docx-rendered-content.docx-dark a:hover {
          color: #79c0ff;
        }
        /* Lists & Nesting in Dark Theme */
        .docx-rendered-content.docx-dark ul {
          list-style-type: disc !important;
          list-style-position: outside;
          padding-left: 2rem;
          margin-top: 0.4em;
          margin-bottom: 0.4em;
          color: #c9d1d9;
        }
        .docx-rendered-content.docx-dark ul ul {
          list-style-type: circle !important;
          padding-left: 1.5rem;
          margin-top: 0.25em;
          margin-bottom: 0.25em;
        }
        .docx-rendered-content.docx-dark ul ul ul {
          list-style-type: square !important;
        }
        .docx-rendered-content.docx-dark ol {
          list-style-type: decimal !important;
          list-style-position: outside;
          padding-left: 2rem;
          margin-top: 0.4em;
          margin-bottom: 0.4em;
          color: #c9d1d9;
        }
        .docx-rendered-content.docx-dark ol ol {
          list-style-type: lower-alpha !important;
          padding-left: 1.5rem;
          margin-top: 0.25em;
          margin-bottom: 0.25em;
        }
        .docx-rendered-content.docx-dark ol ol ol {
          list-style-type: lower-roman !important;
        }
        .docx-rendered-content.docx-dark li {
          margin-top: 0.3em;
          margin-bottom: 0.3em;
          line-height: 1.65;
          padding-left: 0.25em;
        }
        .docx-rendered-content.docx-dark li::marker {
          color: #79c0ff;
          font-weight: 600;
        }
        .docx-rendered-content.docx-dark table {
          border-collapse: collapse;
          width: 100%;
          margin: 1em 0;
          border: 1px solid #30363d;
        }
        .docx-rendered-content.docx-dark th, .docx-rendered-content.docx-dark td {
          border: 1px solid #30363d;
          padding: 8px 12px;
          color: #c9d1d9;
        }
        .docx-rendered-content.docx-dark th {
          background-color: #21262d;
          color: #f0f6fc;
          font-weight: 600;
        }
        .docx-rendered-content.docx-dark tr:nth-child(even) td {
          background-color: #161b22;
        }
        .docx-rendered-content.docx-dark tr:nth-child(odd) td {
          background-color: #191f28;
        }
        .docx-rendered-content.docx-dark blockquote {
          border-left: 3px solid #388bfd;
          padding-left: 1em;
          margin: 0.8em 0;
          color: #8b949e;
          background-color: rgba(56, 139, 253, 0.05);
          padding-top: 0.3em;
          padding-bottom: 0.3em;
        }
        .docx-rendered-content.docx-dark code {
          background-color: #0d1117;
          color: #79c0ff;
          padding: 0.2em 0.4em;
          border-radius: 4px;
          border: 1px solid #30363d;
          font-size: 0.88em;
        }

        /* Sepia Mode */
        .docx-rendered-content.docx-sepia {
          color: #3e3223;
        }
        .docx-rendered-content.docx-sepia h1 {
          color: #2c2214;
          border-bottom: 1px solid #e0d3ad;
          padding-bottom: 0.3em;
          font-weight: 700;
        }
        .docx-rendered-content.docx-sepia h2 {
          color: #382c1a;
          font-weight: 600;
        }
        .docx-rendered-content.docx-sepia h3 {
          color: #4a3b25;
          font-weight: 600;
        }
        .docx-rendered-content.docx-sepia a {
          color: #8f5902;
          text-decoration: underline;
        }
        .docx-rendered-content.docx-sepia strong, .docx-rendered-content.docx-sepia b {
          color: #1f170c;
          font-weight: 600;
        }
        /* Lists & Nesting in Sepia Theme */
        .docx-rendered-content.docx-sepia ul {
          list-style-type: disc !important;
          list-style-position: outside;
          padding-left: 2rem;
          margin-top: 0.4em;
          margin-bottom: 0.4em;
          color: #3e3223;
        }
        .docx-rendered-content.docx-sepia ul ul {
          list-style-type: circle !important;
          padding-left: 1.5rem;
          margin-top: 0.25em;
          margin-bottom: 0.25em;
        }
        .docx-rendered-content.docx-sepia ul ul ul {
          list-style-type: square !important;
        }
        .docx-rendered-content.docx-sepia ol {
          list-style-type: decimal !important;
          list-style-position: outside;
          padding-left: 2rem;
          margin-top: 0.4em;
          margin-bottom: 0.4em;
          color: #3e3223;
        }
        .docx-rendered-content.docx-sepia ol ol {
          list-style-type: lower-alpha !important;
          padding-left: 1.5rem;
          margin-top: 0.25em;
          margin-bottom: 0.25em;
        }
        .docx-rendered-content.docx-sepia ol ol ol {
          list-style-type: lower-roman !important;
        }
        .docx-rendered-content.docx-sepia li {
          margin-top: 0.3em;
          margin-bottom: 0.3em;
          line-height: 1.65;
          padding-left: 0.25em;
        }
        .docx-rendered-content.docx-sepia li::marker {
          color: #8f5902;
          font-weight: 600;
        }
        .docx-rendered-content.docx-sepia table, .docx-rendered-content.docx-sepia th, .docx-rendered-content.docx-sepia td {
          border: 1px solid #d9c89e;
        }
        .docx-rendered-content.docx-sepia th {
          background-color: #efe2c4;
          color: #2b2012;
          font-weight: 600;
        }
        .docx-rendered-content.docx-sepia td {
          background-color: #fbf0d9;
          padding: 8px 12px;
        }
        .docx-rendered-content.docx-sepia tr:nth-child(even) td {
          background-color: #f5e8cd;
        }

        /* Light Mode */
        .docx-rendered-content.docx-light {
          color: #1f2937;
        }
        .docx-rendered-content.docx-light h1, .docx-rendered-content.docx-light h2, .docx-rendered-content.docx-light h3 {
          color: #111827;
        }
        .docx-rendered-content.docx-light a {
          color: #2563eb;
          text-decoration: underline;
        }
        /* Lists & Nesting in Light Theme */
        .docx-rendered-content.docx-light ul {
          list-style-type: disc !important;
          list-style-position: outside;
          padding-left: 2rem;
          margin-top: 0.4em;
          margin-bottom: 0.4em;
          color: #1f2937;
        }
        .docx-rendered-content.docx-light ul ul {
          list-style-type: circle !important;
          padding-left: 1.5rem;
          margin-top: 0.25em;
          margin-bottom: 0.25em;
        }
        .docx-rendered-content.docx-light ul ul ul {
          list-style-type: square !important;
        }
        .docx-rendered-content.docx-light ol {
          list-style-type: decimal !important;
          list-style-position: outside;
          padding-left: 2rem;
          margin-top: 0.4em;
          margin-bottom: 0.4em;
          color: #1f2937;
        }
        .docx-rendered-content.docx-light ol ol {
          list-style-type: lower-alpha !important;
          padding-left: 1.5rem;
          margin-top: 0.25em;
          margin-bottom: 0.25em;
        }
        .docx-rendered-content.docx-light ol ol ol {
          list-style-type: lower-roman !important;
        }
        .docx-rendered-content.docx-light li {
          margin-top: 0.3em;
          margin-bottom: 0.3em;
          line-height: 1.65;
          padding-left: 0.25em;
        }
        .docx-rendered-content.docx-light li::marker {
          color: #2563eb;
          font-weight: 600;
        }
        .docx-rendered-content.docx-light table, .docx-rendered-content.docx-light th, .docx-rendered-content.docx-light td {
          border: 1px solid #e5e7eb;
          padding: 8px 12px;
        }
        .docx-rendered-content.docx-light th {
          background-color: #f9fafb;
          color: #111827;
          font-weight: 600;
        }
        .docx-rendered-content.docx-light td {
          background-color: #ffffff;
        }
      `}</style>

      {/* Top Document Header Bar */}
      <div className="px-3 py-1.5 bg-onedark-darker/90 border-b border-onedark-borderSubtle flex items-center justify-between flex-shrink-0 text-xs gap-2">
        <div className="flex items-center space-x-2 font-mono text-[11px] text-onedark-muted truncate min-w-0">
          <FileText className="w-4 h-4 text-onedark-blue flex-shrink-0" />
          <span className="font-semibold text-onedark-fg truncate">{filePath.split('/').pop()}</span>
          {fileSize !== undefined && (
            <>
              <span className="text-onedark-border">·</span>
              <span className="flex-shrink-0">{formatBytes(fileSize)}</span>
            </>
          )}
          {data && (
            <>
              <span className="text-onedark-border">·</span>
              <span className="flex-shrink-0 text-onedark-muted/80">
                {data.words_count.toLocaleString()} words
              </span>
              <span className="text-onedark-border">·</span>
              <span className="flex-shrink-0 text-onedark-muted/80">
                {data.paragraphs_count} paragraphs
              </span>
            </>
          )}
          {hasChanges && (
            <span className="px-1.5 py-0.5 rounded bg-onedark-yellow/20 text-onedark-yellow text-[10px] font-bold">
              Unsaved changes
            </span>
          )}
        </div>

        {/* Right Controls */}
        <div className="flex items-center space-x-1.5 flex-shrink-0">
          {/* Theme Selector Toggle */}
          <div className="flex items-center bg-onedark-surface/60 rounded-md border border-onedark-borderSubtle p-0.5 text-[11px]">
            <button
              onClick={() => handleThemeChange('dark')}
              className={`p-1 px-1.5 rounded flex items-center space-x-1 cursor-pointer transition-colors ${
                docTheme === 'dark'
                  ? 'bg-onedark-darker text-onedark-accent font-semibold shadow-xs'
                  : 'text-onedark-muted hover:text-onedark-fg'
              }`}
              title="Dark Mode (Obsidian / OneDark)"
            >
              <Moon className="w-3 h-3" />
              <span className="hidden sm:inline text-[10px]">Dark</span>
            </button>
            <button
              onClick={() => handleThemeChange('sepia')}
              className={`p-1 px-1.5 rounded flex items-center space-x-1 cursor-pointer transition-colors ${
                docTheme === 'sepia'
                  ? 'bg-amber-900/40 text-amber-300 font-semibold shadow-xs'
                  : 'text-onedark-muted hover:text-onedark-fg'
              }`}
              title="Sepia / Reader Mode"
            >
              <BookOpen className="w-3 h-3" />
              <span className="hidden sm:inline text-[10px]">Sepia</span>
            </button>
            <button
              onClick={() => handleThemeChange('light')}
              className={`p-1 px-1.5 rounded flex items-center space-x-1 cursor-pointer transition-colors ${
                docTheme === 'light'
                  ? 'bg-slate-200 text-slate-900 font-semibold shadow-xs'
                  : 'text-onedark-muted hover:text-onedark-fg'
              }`}
              title="Light / Paper Mode"
            >
              <Sun className="w-3 h-3" />
              <span className="hidden sm:inline text-[10px]">Light</span>
            </button>
          </div>

          {/* Zoom Controls */}
          <div className="flex items-center bg-onedark-surface/60 rounded-md border border-onedark-borderSubtle px-1 py-0.5 space-x-1 text-[11px]">
            <button
              onClick={() => setZoom((z) => Math.max(50, z - 10))}
              className="p-1 hover:text-onedark-fg text-onedark-muted rounded hover:bg-onedark-darker cursor-pointer"
              title="Zoom out"
            >
              <ZoomOut className="w-3 h-3" />
            </button>
            <span className="font-mono text-[10px] w-8 text-center text-onedark-muted">{zoom}%</span>
            <button
              onClick={() => setZoom((z) => Math.min(200, z + 10))}
              className="p-1 hover:text-onedark-fg text-onedark-muted rounded hover:bg-onedark-darker cursor-pointer"
              title="Zoom in"
            >
              <ZoomIn className="w-3 h-3" />
            </button>
            <button
              onClick={() => setZoom(100)}
              className="p-1 hover:text-onedark-fg text-onedark-muted rounded hover:bg-onedark-darker cursor-pointer"
              title="Reset Zoom"
            >
              <RotateCcw className="w-2.5 h-2.5" />
            </button>
          </div>

          {/* Copy Text Button */}
          <button
            onClick={handleCopyText}
            className="p-1.5 rounded-md bg-onedark-surface/60 hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg border border-onedark-borderSubtle transition-colors cursor-pointer flex items-center space-x-1 text-[11px]"
            title="Copy document plain text"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-onedark-green" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>

          {/* Mode Switcher: Preview vs Edit */}
          <div className="flex items-center bg-onedark-surface/60 rounded-md border border-onedark-borderSubtle p-0.5">
            <button
              onClick={() => setIsEditing(false)}
              className={`px-2 py-1 rounded text-[11px] font-medium flex items-center space-x-1 transition-colors cursor-pointer ${
                !isEditing
                  ? 'bg-onedark-darker text-onedark-accent shadow-xs'
                  : 'text-onedark-muted hover:text-onedark-fg'
              }`}
            >
              <Eye className="w-3 h-3" />
              <span>Preview</span>
            </button>
            <button
              onClick={() => setIsEditing(true)}
              className={`px-2 py-1 rounded text-[11px] font-medium flex items-center space-x-1 transition-colors cursor-pointer ${
                isEditing
                  ? 'bg-onedark-darker text-onedark-accent shadow-xs'
                  : 'text-onedark-muted hover:text-onedark-fg'
              }`}
            >
              <Edit3 className="w-3 h-3" />
              <span>Edit</span>
            </button>
          </div>

          {/* Save Button (In Edit Mode) */}
          {isEditing && (
            <button
              onClick={handleSave}
              disabled={isSaving || !hasChanges}
              className="px-2.5 py-1 rounded-md bg-onedark-accent hover:bg-onedark-accent/90 disabled:opacity-40 disabled:cursor-not-allowed text-onedark-darker font-bold text-[11px] flex items-center space-x-1 transition-all cursor-pointer shadow-xs"
              title="Save document (Cmd+S)"
            >
              {isSaving ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : saveSuccess ? (
                <FileCheck className="w-3 h-3" />
              ) : (
                <Save className="w-3 h-3" />
              )}
              <span>{isSaving ? 'Saving...' : saveSuccess ? 'Saved!' : 'Save'}</span>
            </button>
          )}

          {/* Raw Tab & Download */}
          <a
            href={rawUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 rounded-md bg-onedark-surface/60 hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg border border-onedark-borderSubtle transition-colors cursor-pointer"
            title="Open in new window"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
          <a
            href={`${rawUrl}&download=true`}
            download={filePath.split('/').pop()}
            className="p-1.5 rounded-md bg-onedark-surface/60 hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg border border-onedark-borderSubtle transition-colors cursor-pointer"
            title="Download DOCX"
          >
            <Download className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* Rich WYSIWYG Formatting Toolbar (Visible in Edit Mode) */}
      {isEditing && (
        <div className="px-3 py-1 bg-onedark-surface/40 border-b border-onedark-borderSubtle/60 flex items-center gap-1 flex-wrap text-xs">
          {/* Headings */}
          <button
            type="button"
            onClick={() => handleFormat('formatBlock', '<p>')}
            className="p-1.5 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg text-[11px] font-mono cursor-pointer"
            title="Normal Paragraph"
          >
            P
          </button>
          <button
            type="button"
            onClick={() => handleFormat('formatBlock', '<h1>')}
            className="p-1.5 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg cursor-pointer"
            title="Heading 1"
          >
            <Heading1 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => handleFormat('formatBlock', '<h2>')}
            className="p-1.5 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg cursor-pointer"
            title="Heading 2"
          >
            <Heading2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => handleFormat('formatBlock', '<h3>')}
            className="p-1.5 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg cursor-pointer"
            title="Heading 3"
          >
            <Heading3 className="w-3.5 h-3.5" />
          </button>

          <div className="w-[1px] h-4 bg-onedark-borderSubtle mx-1" />

          {/* Inline Styles */}
          <button
            type="button"
            onClick={() => handleFormat('bold')}
            className="p-1.5 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg cursor-pointer"
            title="Bold (Cmd+B)"
          >
            <Bold className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => handleFormat('italic')}
            className="p-1.5 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg cursor-pointer"
            title="Italic (Cmd+I)"
          >
            <Italic className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => handleFormat('underline')}
            className="p-1.5 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg cursor-pointer"
            title="Underline (Cmd+U)"
          >
            <Underline className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => handleFormat('strikeThrough')}
            className="p-1.5 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg cursor-pointer"
            title="Strikethrough"
          >
            <Strikethrough className="w-3.5 h-3.5" />
          </button>

          <div className="w-[1px] h-4 bg-onedark-borderSubtle mx-1" />

          {/* Alignments */}
          <button
            type="button"
            onClick={() => handleFormat('justifyLeft')}
            className="p-1.5 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg cursor-pointer"
            title="Align Left"
          >
            <AlignLeft className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => handleFormat('justifyCenter')}
            className="p-1.5 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg cursor-pointer"
            title="Align Center"
          >
            <AlignCenter className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => handleFormat('justifyRight')}
            className="p-1.5 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg cursor-pointer"
            title="Align Right"
          >
            <AlignRight className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => handleFormat('justifyFull')}
            className="p-1.5 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg cursor-pointer"
            title="Justify"
          >
            <AlignJustify className="w-3.5 h-3.5" />
          </button>

          <div className="w-[1px] h-4 bg-onedark-borderSubtle mx-1" />

          {/* Lists & Tables */}
          <button
            type="button"
            onClick={() => handleFormat('insertUnorderedList')}
            className="p-1.5 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg cursor-pointer"
            title="Bullet List"
          >
            <List className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => handleFormat('insertOrderedList')}
            className="p-1.5 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg cursor-pointer"
            title="Numbered List"
          >
            <ListOrdered className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleInsertTable}
            className="p-1.5 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg cursor-pointer"
            title="Insert Table"
          >
            <Table className="w-3.5 h-3.5" />
          </button>

          <div className="w-[1px] h-4 bg-onedark-borderSubtle mx-1" />

          {/* Undo / Redo */}
          <button
            type="button"
            onClick={() => handleFormat('undo')}
            className="p-1.5 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg cursor-pointer"
            title="Undo (Cmd+Z)"
          >
            <Undo className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => handleFormat('redo')}
            className="p-1.5 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg cursor-pointer"
            title="Redo (Cmd+Shift+Z)"
          >
            <Redo className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Canvas Area */}
      <div className={`flex-1 overflow-auto p-4 md:p-8 flex justify-center items-start transition-colors duration-200 ${currentTheme.containerBg}`}>
        {loading ? (
          <div className="flex flex-col items-center justify-center p-12 text-onedark-muted space-y-3">
            <Loader2 className="w-8 h-8 animate-spin text-onedark-accent" />
            <span className="text-xs font-mono">Parsing DOCX document...</span>
          </div>
        ) : error ? (
          <div className="max-w-md p-4 rounded-lg bg-onedark-red/10 border border-onedark-red/30 text-onedark-red flex items-start space-x-3 text-xs">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-semibold">Unable to load document</div>
              <div className="text-[11px] opacity-90">{error}</div>
            </div>
          </div>
        ) : (
          <div
            style={{
              transform: `scale(${zoom / 100})`,
              transformOrigin: 'top center',
              transition: 'transform 0.15s ease-out, background-color 0.2s ease, border-color 0.2s ease',
            }}
            className={`w-full max-w-[850px] min-h-[1050px] ${currentTheme.paperBg} ${currentTheme.paperBorder} ${currentTheme.paperShadow} rounded-sm p-12 md:p-16 border select-text leading-relaxed transition-shadow duration-200`}
          >
            {isEditing ? (
              <div
                ref={editorRef}
                contentEditable
                suppressContentEditableWarning
                onInput={() => setHasChanges(true)}
                className={`outline-none min-h-[950px] ${currentTheme.proseClass} focus:ring-0 docx-rendered-content ${currentTheme.themeClass}`}
                style={{
                  fontFamily: currentTheme.fontFamily,
                  fontSize: '15px',
                  lineHeight: '1.65',
                  color: currentTheme.textColor,
                }}
              />
            ) : (
              <div
                dangerouslySetInnerHTML={{ __html: data?.html || '<p class="text-gray-400 italic">Empty document</p>' }}
                className={`${currentTheme.proseClass} docx-rendered-content ${currentTheme.themeClass}`}
                style={{
                  fontFamily: currentTheme.fontFamily,
                  fontSize: '15px',
                  lineHeight: '1.65',
                  color: currentTheme.textColor,
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
};
