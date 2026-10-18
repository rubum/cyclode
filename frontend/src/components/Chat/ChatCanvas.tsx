import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { 
  Send, 
  Sparkles, 
  Terminal, 
  CheckCircle2, 
  ChevronDown, 
  ChevronLeft,
  ChevronRight, 
  ShieldAlert, 
  User, 
  ArrowRight, 
  GitPullRequest, 
  GitCommit,
  Bug, 
  Activity, 
  FileCode2, 
  Code2, 
  Pencil, 
  RotateCcw, 
  Copy, 
  Check, 
  Square, 
  Zap, 
  X,
  Box,
  Coins,
  FolderGit2,
  ExternalLink,
  Loader2,
  Play,
  LayoutGrid,
  Folder,
  FolderOpen,
  Search,
  Globe,
  Link2,
  GitBranch,
  RefreshCw,
  Brain,
  Eye,
  AlertCircle,
  Clock,
  HelpCircle,
  ListOrdered,
  Circle,
  Bot,
  Cpu,
  Undo2,
  ShieldCheck,
  Compass,
  Plus,
  GitCompare,
  Paperclip,
  FileText,
  Table,
  Image as ImageIcon,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Download,
  Trash2
} from 'lucide-react';
import { Task, TaskMessage, TaskLog, RepositoryConfig, TaskPR, WorkspacePreviewInfo, TaskPlan, LayoutPreset } from '../../types';
import { MarkdownRenderer } from '../Common/MarkdownRenderer';
import { FormattedLogView } from '../Common/FormattedLogView';
import { ConfirmModal } from '../Common/ConfirmModal';
import { SandboxInspectorModal } from '../Sandbox/SandboxInspectorModal';
import { PRReviewApprovalCard } from './PRReviewApprovalCard';
import { readDroppedFileSystemEntries, extractFilesFromInput, groupAttachmentsByFolder, openNativeFolderPicker, UploadableItem } from '../../utils/fileUpload';
import { isLongPastedText, createSniffedPastedDoc, SniffedPastedDoc, localPastedDocs } from '../../utils/pastedDocSniffer';
import { PastedDocModal } from './PastedDocModal';
import { PastedDocPill } from './PastedDocPill';
import { ReportModal } from './ReportModal';

const API_BASE = import.meta.env.VITE_API_URL || '';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function getAttachmentIcon(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (['csv', 'tsv', 'parquet', 'tab'].includes(ext)) {
    return { icon: Table, color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' };
  }
  if (['ipynb', 'py', 'ts', 'tsx', 'js', 'jsx', 'json', 'rs', 'go', 'sql', 'html', 'css'].includes(ext)) {
    return { icon: FileCode2, color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' };
  }
  if (['zip', 'tar', 'gz', 'tgz', 'bz2', 'whl', 'rar', '7z'].includes(ext)) {
    return { icon: Box, color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/20' };
  }
  if (['pdf', 'doc', 'docx', 'md', 'txt'].includes(ext)) {
    return { icon: FileText, color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/20' };
  }
  if (['png', 'jpg', 'jpeg', 'svg', 'webp', 'gif'].includes(ext)) {
    return { icon: ImageIcon, color: 'text-cyan-400', bg: 'bg-cyan-500/10 border-cyan-500/20' };
  }
  return { icon: Paperclip, color: 'text-onedark-accent', bg: 'bg-onedark-accent/10 border-onedark-accent/20' };
}

export interface ParsedFolderAttachment {
  name: string;
  path: string;
  fileCount?: number;
  sizeStr?: string;
}

export interface ParsedAttachment {
  name: string;
  path: string;
  sizeStr?: string;
  rawUrl?: string;
  blobUrl?: string;
  category: 'image' | 'table' | 'notebook' | 'archive' | 'doc' | 'code' | 'general';
}

export interface ParsedUserAttachmentsResult {
  cleanedText: string;
  folders: ParsedFolderAttachment[];
  attachments: ParsedAttachment[];
}

const localAttachmentBlobUrls = new Map<string, string>();

export const parseUserMessageAttachments = (
  content: string,
  taskId?: string
): ParsedUserAttachmentsResult => {
  if (!content) return { cleanedText: '', folders: [], attachments: [] };
  if (!content.includes('[Uploaded ')) {
    return { cleanedText: content, folders: [], attachments: [] };
  }

  const folders: ParsedFolderAttachment[] = [];
  const attachments: ParsedAttachment[] = [];

  // 1. Workspace Folders: [Uploaded Workspace Folder: Name/ (10 files, 2.3 MB)]
  const folderRegex = /\[Uploaded Workspace Folder:\s*([^\]\n]+?)\]/gi;
  let folderMatch;
  while ((folderMatch = folderRegex.exec(content)) !== null) {
    const inner = folderMatch[1].trim();
    const parenMatch = inner.match(/^(.*?)(?:\s*\((.*?)\))$/i);
    const rawFolderName = (parenMatch ? parenMatch[1] : inner).trim();
    const metaStr = parenMatch ? parenMatch[2].trim() : '';

    let fileCount: number | undefined;
    let sizeStr: string | undefined;

    if (metaStr) {
      const countMatch = metaStr.match(/(\d+)\s*files?/i);
      if (countMatch) {
        fileCount = parseInt(countMatch[1], 10);
      }
      const sizeMatch = metaStr.match(/([\d.]+\s*(?:B|KB|MB|GB|TB|bytes?))/i);
      if (sizeMatch) {
        sizeStr = sizeMatch[1].trim();
      }
    }

    const cleanPath = rawFolderName.replace(/\/+$/, '');
    folders.push({
      name: rawFolderName.endsWith('/') ? rawFolderName : `${rawFolderName}/`,
      path: cleanPath,
      fileCount,
      sizeStr,
    });
  }

  // 2. Workspace Files: [Uploaded Workspace File: path/to/file.ext (1.2 MB)]
  const wsFileRegex = /\[Uploaded Workspace File:\s*([^\]\n]+?)\]/gi;
  let wsFileMatch;
  while ((wsFileMatch = wsFileRegex.exec(content)) !== null) {
    const inner = wsFileMatch[1].trim();
    const sizeMatch = inner.match(/^(.*?)(?:\s*\(([\d.]+\s*(?:B|KB|MB|GB|bytes?|TB))\))$/i);
    const rawPath = (sizeMatch ? sizeMatch[1] : inner).trim();
    const sizeStr = sizeMatch ? sizeMatch[2].trim() : undefined;
    const name = rawPath.split(/[/\\]/).pop() || rawPath;
    const lower = name.toLowerCase();

    let category: ParsedAttachment['category'] = 'general';
    if (/\.(png|jpe?g|webp|gif|svg|bmp|ico)$/i.test(lower)) {
      category = 'image';
    } else if (/\.(csv|tsv|parquet|xlsx|xls|jsonl)$/i.test(lower)) {
      category = 'table';
    } else if (/\.ipynb$/i.test(lower)) {
      category = 'notebook';
    } else if (/\.(zip|tar|gz|tgz|tar\.gz|tar\.bz2|bz2)$/i.test(lower)) {
      category = 'archive';
    } else if (/\.(pdf|md|markdown|txt|docx|doc)$/i.test(lower)) {
      category = 'doc';
    } else if (/\.(py|ts|tsx|js|jsx|json|yaml|yml|sh|sql|go|rs|cpp|c|h|html|css)$/i.test(lower)) {
      category = 'code';
    }

    const blobUrl = localAttachmentBlobUrls.get(name);
    const serverUrl = taskId && !taskId.startsWith('temp-')
      ? `${API_BASE}/api/tasks/${taskId}/files/raw?path=${encodeURIComponent(rawPath)}`
      : undefined;
    const rawUrl = serverUrl || blobUrl;

    attachments.push({
      name,
      path: rawPath,
      sizeStr,
      rawUrl,
      blobUrl,
      category,
    });
  }

  // 3. Attachments: [Uploaded Attachment: file.png (50 KB)]
  const attachmentRegex = /\[Uploaded Attachment:\s*([^\]\n]+?)\]/gi;
  let match;
  while ((match = attachmentRegex.exec(content)) !== null) {
    const inner = match[1].trim();
    const sizeMatch = inner.match(/^(.*?)(?:\s*\(([\d.]+\s*(?:B|KB|MB|GB|bytes?|TB))\))$/i);
    const rawPath = (sizeMatch ? sizeMatch[1] : inner).trim();
    const sizeStr = sizeMatch ? sizeMatch[2].trim() : undefined;
    const name = rawPath.split(/[/\\]/).pop() || rawPath;
    const lower = name.toLowerCase();

    let category: ParsedAttachment['category'] = 'general';
    if (/\.(png|jpe?g|webp|gif|svg|bmp|ico)$/i.test(lower)) {
      category = 'image';
    } else if (/\.(csv|tsv|parquet|xlsx|xls|jsonl)$/i.test(lower)) {
      category = 'table';
    } else if (/\.ipynb$/i.test(lower)) {
      category = 'notebook';
    } else if (/\.(zip|tar|gz|tgz|tar\.gz|tar\.bz2|bz2)$/i.test(lower)) {
      category = 'archive';
    } else if (/\.(pdf|md|markdown|txt|docx|doc)$/i.test(lower)) {
      category = 'doc';
    } else if (/\.(py|ts|tsx|js|jsx|json|yaml|yml|sh|sql|go|rs|cpp|c|h|html|css)$/i.test(lower)) {
      category = 'code';
    }

    const relPath = rawPath.startsWith('.cyclode/attachments/') || rawPath.startsWith('attachments/')
      ? rawPath
      : `.cyclode/attachments/${name}`;

    const blobUrl = localAttachmentBlobUrls.get(name);
    const serverUrl = taskId && !taskId.startsWith('temp-')
      ? `${API_BASE}/api/tasks/${taskId}/files/raw?path=${encodeURIComponent(relPath)}`
      : undefined;
    const rawUrl = serverUrl || blobUrl;

    attachments.push({
      name,
      path: relPath,
      sizeStr,
      rawUrl,
      blobUrl,
      category,
    });
  }

  const cleanedText = content
    .replace(folderRegex, '')
    .replace(wsFileRegex, '')
    .replace(attachmentRegex, '')
    .trim();

  return { cleanedText, folders, attachments };
};

interface AttachmentImagePreviewProps {
  att: ParsedAttachment;
  onOpenLightbox: () => void;
  onViewRight: () => void;
}

export const AttachmentImagePreview: React.FC<AttachmentImagePreviewProps> = ({
  att,
  onOpenLightbox,
  onViewRight,
}) => {
  const [loadState, setLoadState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [retryKey, setRetryKey] = useState<number>(0);

  const imgSrc = useMemo(() => {
    if (att.blobUrl) return att.blobUrl;
    if (!att.rawUrl) return '';
    if (att.rawUrl.startsWith('blob:')) return att.rawUrl;
    return retryKey > 0 ? `${att.rawUrl}&_t=${retryKey}` : att.rawUrl;
  }, [att.rawUrl, att.blobUrl, retryKey]);

  return (
    <div className="group/img relative rounded-xl overflow-hidden border border-onedark-borderSubtle bg-onedark-darker/70 hover:border-onedark-accent/60 shadow-md transition-all max-w-xs sm:max-w-sm flex-1 min-w-[200px] flex flex-col">
      <div 
        onClick={onOpenLightbox}
        className="relative aspect-video max-h-48 overflow-hidden bg-onedark-darker/90 flex items-center justify-center cursor-pointer select-none"
      >
        {loadState === 'loading' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-onedark-surface/30 animate-pulse text-onedark-muted space-y-1.5 z-0">
            <Loader2 className="w-5 h-5 animate-spin text-onedark-accent" />
            <span className="text-[10px] font-mono">Loading image...</span>
          </div>
        )}

        {loadState === 'error' ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-3 text-center bg-onedark-surface/40 z-10 space-y-2">
            <div className="p-2 rounded-lg bg-onedark-darker/80 text-onedark-accent">
              <ImageIcon className="w-6 h-6" />
            </div>
            <div className="flex flex-col items-center">
              <span className="text-[11px] font-mono text-onedark-fg font-medium truncate max-w-[180px]">{att.name}</span>
              <span className="text-[10px] text-onedark-muted font-mono">{att.sizeStr || 'Image preview'}</span>
            </div>
            <div className="flex items-center space-x-1.5 pt-0.5">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setLoadState('loading');
                  setRetryKey(Date.now());
                }}
                className="px-2 py-0.5 rounded bg-onedark-surface hover:bg-onedark-surfaceHighlight text-[10.5px] font-mono text-onedark-fg transition-colors flex items-center space-x-1 cursor-pointer"
              >
                <RotateCw className="w-3 h-3" />
                <span>Retry</span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onViewRight();
                }}
                className="px-2 py-0.5 rounded bg-onedark-accent/20 hover:bg-onedark-accent/30 text-onedark-accent text-[10.5px] font-mono font-medium transition-colors flex items-center space-x-1 cursor-pointer"
              >
                <ExternalLink className="w-3 h-3" />
                <span>View</span>
              </button>
            </div>
          </div>
        ) : (
          imgSrc && (
            <img
              src={imgSrc}
              alt={att.name}
              loading="lazy"
              onLoad={() => setLoadState('loaded')}
              onError={() => setLoadState('error')}
              className={`w-full h-full object-contain group-hover/img:scale-105 transition-transform duration-200 ${
                loadState === 'loaded' ? 'opacity-100' : 'opacity-0'
              }`}
            />
          )
        )}

        {loadState === 'loaded' && (
          <>
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-60 group-hover/img:opacity-40 transition-opacity pointer-events-none" />
            <div className="absolute top-2 right-2 p-1.5 rounded-lg bg-onedark-darker/80 backdrop-blur-md text-onedark-fg group-hover/img:text-onedark-accent opacity-0 group-hover/img:opacity-100 transition-all shadow-sm">
              <ZoomIn className="w-3.5 h-3.5" />
            </div>
          </>
        )}
      </div>

      <div className="px-2.5 py-1.5 flex items-center justify-between text-xs font-mono bg-onedark-surface/90 border-t border-onedark-borderSubtle/60 mt-auto">
        <div className="flex items-center space-x-1.5 min-w-0 pr-2">
          <ImageIcon className="w-3.5 h-3.5 text-onedark-accent flex-shrink-0" />
          <span className="truncate text-onedark-fgBright text-[11.5px] font-semibold">{att.name}</span>
          {att.sizeStr && (
            <span className="text-[10px] text-onedark-muted ml-1 flex-shrink-0">{att.sizeStr}</span>
          )}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onViewRight();
          }}
          className="px-2 py-0.5 rounded-md bg-onedark-darker hover:bg-onedark-surfaceHighlight text-[11px] font-mono text-onedark-muted hover:text-onedark-fgBright border border-onedark-borderSubtle/70 transition-all flex items-center space-x-1 flex-shrink-0 cursor-pointer shadow-2xs active:scale-95"
          title="Open in Files on the right"
        >
          <ExternalLink className="w-3 h-3 text-onedark-accent" />
          <span>View</span>
        </button>
      </div>
    </div>
  );
};

export interface ChatAttachment {
  id: string;
  file: File;
  name: string;
  size: number;
  relativePath?: string;
  rootFolder?: string;
  status: 'uploading' | 'ready' | 'error';
  path?: string;
  category?: string;
  error?: string;
  pastedDoc?: SniffedPastedDoc;
}

function extractPlanHighlightsFromMarkdown(text: string): { title: string; overview: string; phases: string[] } {
  const lines = text.split('\n').map(l => l.trim());
  let title = 'Implementation Plan';
  let overview = '';
  const phases: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('# Implementation Plan:') || line.startsWith('# Plan:') || line.startsWith('# ')) {
      title = line.replace(/^#+\s*(?:Implementation Plan:\s*)?/, '').trim();
    } else if (line.includes('I have formulated an implementation plan for **')) {
      const match = line.match(/\*\*([^*]+)\*\*/);
      if (match) title = match[1].trim();
    } else if (/^\s*(?:[-*]|\#{1,4})?\s*\*{0,2}(Phase\s+\d+[:\-]?\s*[^*]+?)(?:\*\*|:|\n|$)/i.test(line)) {
      const match = line.match(/^\s*(?:[-*]|\#{1,4})?\s*\*{0,2}(Phase\s+\d+[:\-]?\s*[^*]+?)(?:\*\*|:|\n|$)/i);
      if (match) {
        const cleanPhase = match[1].replace(/^[-*#\s]+/, '').replace(/\*+/g, '').replace(/:\s*$/, '').trim();
        if (cleanPhase && !phases.includes(cleanPhase)) {
          phases.push(cleanPhase);
        }
      }
    } else if (!overview && line && !line.startsWith('#') && !line.startsWith('-') && !line.startsWith('*') && !line.startsWith('Objective:') && !line.includes('I have formulated') && !line.includes('Inspect Full Plan')) {
      overview = line;
    }
  }

  return { title, overview, phases: phases.slice(0, 6) };
}

const getToolActionInfo = (
  toolName: string,
  toolInput: Record<string, any> = {},
  isRunning: boolean = false
) => {
  const input = toolInput || {};
  const getFilePath = () => input.file_path || input.path || input.filePath || input.target_file || input.filename || input.file;
  switch (toolName) {
    case 'edit_file':
      return {
        icon: Pencil,
        verb: isRunning ? 'Editing' : 'Edited',
        target: getFilePath() || 'file',
        colorClass: 'text-onedark-green',
        badgeBg: 'bg-onedark-green/10',
        badgeBorder: 'border-onedark-green/30',
      };
    case 'read_file':
      return {
        icon: FileCode2,
        verb: isRunning ? 'Reading' : 'Read',
        target: getFilePath() || 'file',
        colorClass: 'text-onedark-accent',
        badgeBg: 'bg-onedark-accent/10',
        badgeBorder: 'border-onedark-accent/30',
      };
    case 'replace_file_content':
    case 'batch_replace_content':
    case 'apply_unified_patch':
      return {
        icon: Pencil,
        verb: isRunning ? 'Updating' : 'Updated',
        target: getFilePath() || 'file',
        colorClass: 'text-onedark-green',
        badgeBg: 'bg-onedark-green/10',
        badgeBorder: 'border-onedark-green/30',
      };
    case 'get_file_outline':
      return {
        icon: FileCode2,
        verb: isRunning ? 'Extracting outline' : 'Extracted outline',
        target: getFilePath() || 'file',
        colorClass: 'text-onedark-accent',
        badgeBg: 'bg-onedark-accent/10',
        badgeBorder: 'border-onedark-accent/30',
      };
    case 'run_command':
      return {
        icon: Terminal,
        verb: isRunning ? 'Running' : 'Ran',
        target: (input.command || input.cmd) ? `$ ${input.command || input.cmd}` : 'command',
        colorClass: 'text-onedark-yellow',
        badgeBg: 'bg-onedark-yellow/10',
        badgeBorder: 'border-onedark-yellow/30',
      };
    case 'list_dir':
      return {
        icon: Folder,
        verb: isRunning ? 'Listing' : 'Listed',
        target: input.subpath || input.directory || input.path || input.dir || '.',
        colorClass: 'text-onedark-folder',
        badgeBg: 'bg-onedark-folder/10',
        badgeBorder: 'border-onedark-folder/30',
      };
    case 'grep_search':
    case 'search_code':
      return {
        icon: Search,
        verb: isRunning ? 'Searching' : 'Searched',
        target: (input.query || input.search || input.pattern) ? `"${input.query || input.search || input.pattern}"` : 'codebase',
        colorClass: 'text-onedark-yellow',
        badgeBg: 'bg-onedark-yellow/10',
        badgeBorder: 'border-onedark-yellow/30',
      };
    case 'find_symbols':
      return {
        icon: Code2,
        verb: isRunning ? 'Finding symbols' : 'Found symbols',
        target: input.name_pattern ? `"${input.name_pattern}"` : 'symbols',
        colorClass: 'text-onedark-purple',
        badgeBg: 'bg-onedark-purple/10',
        badgeBorder: 'border-onedark-purple/30',
      };
    case 'search_web':
      return {
        icon: Globe,
        verb: isRunning ? 'Searching web for' : 'Web searched',
        target: input.query ? `"${input.query}"` : 'web',
        colorClass: 'text-onedark-accent',
        badgeBg: 'bg-onedark-accent/10',
        badgeBorder: 'border-onedark-accent/30',
      };
    case 'fetch_url':
      return {
        icon: Link2,
        verb: isRunning ? 'Fetching' : 'Fetched',
        target: input.url || 'URL',
        colorClass: 'text-onedark-accent',
        badgeBg: 'bg-onedark-accent/10',
        badgeBorder: 'border-onedark-accent/30',
      };
    case 'git_clone':
    case 'connect_repository':
      return {
        icon: GitBranch,
        verb: isRunning ? 'Cloning' : 'Cloned',
        target: input.repo_url || input.url || 'repository',
        colorClass: 'text-onedark-purple',
        badgeBg: 'bg-onedark-purple/10',
        badgeBorder: 'border-onedark-purple/30',
      };
    case 'tgrep_ast':
      return {
        icon: GitBranch,
        verb: isRunning ? 'Analyzing AST for' : 'Matched AST',
        target: input.pattern ? `"${input.pattern}"` : 'pattern',
        colorClass: 'text-onedark-purple',
        badgeBg: 'bg-onedark-purple/10',
        badgeBorder: 'border-onedark-purple/30',
      };
    case 'get_pull_request_details':
    case 'list_pull_requests':
    case 'create_pull_request':
    case 'post_pull_request_review':
    case 'get_pull_request_diff':
      return {
        icon: GitPullRequest,
        verb: isRunning ? 'Inspecting' : 'Inspected',
        target: input.repository ? `${input.repository} PRs` : 'Pull Requests',
        colorClass: 'text-onedark-green',
        badgeBg: 'bg-onedark-green/10',
        badgeBorder: 'border-onedark-green/30',
      };
    default:
      return {
        icon: Zap,
        verb: isRunning ? 'Executing' : 'Executed',
        target: toolName,
        colorClass: 'text-onedark-accent',
        badgeBg: 'bg-onedark-accent/10',
        badgeBorder: 'border-onedark-accent/30',
      };
  }
};

interface ChatCanvasProps {
  task: Task | null;
  isLoadingSession?: boolean;
  repositories?: RepositoryConfig[];
  currentDraft?: string;
  onDraftChange?: (draft: string) => void;
  onSendMessage: (content: string, modelName?: string, files?: File[]) => Promise<void> | void;
  onApprove: (feedback?: string, customDetails?: any) => void;
  onReject: (feedback?: string, customDetails?: any) => void;
  onNewChatWithPrompt?: (prompt: string, persona: string, modelName?: string, files?: File[]) => void;
  onEditMessage?: (messageId: string, newContent: string) => void;
  onRetryTask?: (fromMessageId?: string) => void;
  onResetTurn?: (turnIndex?: number, promptToRestore?: string) => void;
  onStopTask?: () => void;
  onUpdateTaskTitle?: (taskId: string, newTitle: string) => void;
  onDeleteTask?: (taskId: string) => void;
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  currentPreset?: LayoutPreset;
  onSetPreset?: (preset: LayoutPreset) => void;
  onOpenSandboxModal?: () => void;
  onSelectAuxTab?: (tab: 'docs' | 'files' | 'prs' | 'intelligence' | 'subagents' | 'event' | 'preview' | 'changes') => void;
  onOpenFile?: (filePath: string) => void;
  onOpenDoc?: (target: { url: string; title?: string }) => void;
  onOpenPreview?: (url: string, title?: string) => void;
  onOpenPlan?: (taskId?: string, plan?: TaskPlan | null) => void;
  onNavigateToRepos?: () => void;
}

interface ConversationTurn {
  id: string;
  userMessage?: {
    id: string;
    content: string;
    tokens?: number;
    created_at?: string;
    isOptimistic?: boolean;
  };
  thoughts: { id: string; stream_id?: string; thought: string; created_at: string; tokens?: number; isStreaming?: boolean }[];
  logs: TaskLog[];
  agentMessages: TaskMessage[];
  plan?: TaskPlan | null;
  isLatest: boolean;
}

const isInternalNotice = (text?: string): boolean => {
  if (!text) return true;
  const lower = text.toLowerCase().trim();
  return (
    lower.startsWith('connecting to gemini') ||
    lower.startsWith('live gemini api unavailable') ||
    lower.startsWith('api notice') ||
    lower.startsWith('google ai studio quota notice') ||
    lower.startsWith('gemini execution notice')
  );
};

const estimateTokens = (text?: string): number => {
  if (!text) return 0;
  return Math.max(1, Math.round(text.length / 4));
};

const maskSecretsInText = (text?: string): string => {
  if (!text) return '';
  return text
    .replace(/(ghp_[A-Za-z0-9_]{4})[A-Za-z0-9_]+/g, '$1••••••••')
    .replace(/(github_pat_[A-Za-z0-9_]{4})[A-Za-z0-9_]+/g, '$1••••••••')
    .replace(/(xoxb-[A-Za-z0-9-]{4})[A-Za-z0-9-]+/g, '$1••••••••')
    .replace(/(xoxp-[A-Za-z0-9-]{4})[A-Za-z0-9-]+/g, '$1••••••••')
    .replace(/(AIzaSy[A-Za-z0-9_-]{4})[A-Za-z0-9_-]+/g, '$1••••••••')
    .replace(/(appsignal_[A-Za-z0-9_-]{4})[A-Za-z0-9_-]+/g, '$1••••••••');
};

const getThoughtStepPreview = (text?: string): string => {
  if (!text) return 'Reasoning...';
  const firstNonEmptyLine = text
    .split('\n')
    .map((line) => line.replace(/^[-*#>+\s`]+/, '').replace(/\*\*/g, '').replace(/`/g, '').trim())
    .find((line) => line.length > 0);
  return firstNonEmptyLine || 'Reasoning...';
};

interface ReasoningProcessContainerProps {
  thoughts: Array<{ id: string; thought: string; created_at?: string; tokens?: number; isStreaming?: boolean }>;
  isStreamingActive: boolean;
  onLinkClick?: (url: string, text: string) => void;
}

const ReasoningProcessContainer: React.FC<ReasoningProcessContainerProps> = ({
  thoughts,
  isStreamingActive,
  onLinkClick,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isUserScrolledUpRef = useRef(false);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (e.deltaY < 0) {
      isUserScrolledUpRef.current = true;
    } else if (e.deltaY > 0) {
      const el = scrollRef.current;
      if (el) {
        const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 15;
        if (isAtBottom) {
          isUserScrolledUpRef.current = false;
        }
      }
    }
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 20;
    isUserScrolledUpRef.current = !isAtBottom;
  }, []);

  // Auto-scroll to bottom on thoughts updates if user hasn't scrolled away
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || isUserScrolledUpRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [thoughts]);

  // Reset scroll lock when streaming starts or resumes
  useEffect(() => {
    if (isStreamingActive) {
      isUserScrolledUpRef.current = false;
      const el = scrollRef.current;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    }
  }, [isStreamingActive]);

  return (
    <div className="border-t border-white/[0.06] bg-onedark-darker/60 flex flex-col">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        onWheel={handleWheel}
        className="p-3.5 sm:p-4 space-y-3.5 text-xs text-onedark-fg/90 max-h-96 overflow-y-auto [scrollbar-width:thin] [overflow-anchor:none]"
      >
        {thoughts.map((m, idx) => (
          <div
            key={m.id || idx}
            className="relative pl-3.5 border-l-2 border-onedark-accent/30 hover:border-onedark-accent/70 transition-colors py-0.5 group/step"
          >
            {thoughts.length > 1 && (
              <div className="flex items-center space-x-2 text-[10.5px] font-mono text-onedark-muted mb-1.5 select-none">
                <span className={`font-semibold uppercase tracking-wider text-[10px] ${
                  m.isStreaming ? 'text-onedark-yellow' : 'text-onedark-accent/80'
                }`}>
                  Step {idx + 1}
                </span>
                {m.tokens && (
                  <>
                    <span className="text-onedark-borderSubtle">•</span>
                    <span>{m.tokens} tokens</span>
                  </>
                )}
                {m.isStreaming && (
                  <span className="inline-flex items-center text-onedark-yellow" title="Streaming">
                    <span className="w-1.5 h-1.5 rounded-full bg-onedark-yellow animate-pulse" />
                  </span>
                )}
              </div>
            )}
            <MarkdownRenderer
              content={m.thought}
              isStreaming={Boolean(m.isStreaming)}
              onLinkClick={onLinkClick}
              className="text-[13px] leading-relaxed font-sans text-onedark-fg space-y-2 [&_p]:leading-relaxed [&_p]:text-onedark-fg/90 [&_strong]:text-onedark-fgBright [&_strong]:font-semibold [&_code]:font-mono [&_code]:text-[11.5px] [&_code]:bg-onedark-surface [&_code]:text-onedark-accent [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:border [&_code]:border-onedark-borderSubtle/60 [&_a_code]:bg-transparent [&_a_code]:border-0 [&_a_code]:p-0 [&_a_code]:rounded-none [&_a_code]:shadow-none [&_pre]:my-2 [&_ul]:my-1.5 [&_ol]:my-1.5 select-text"
            />
          </div>
        ))}
      </div>
    </div>
  );
};

const renderHighlightedInputText = (text: string) => {
  if (!text) return null;
  const mentionRegex = /(@[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)?)/g;
  const parts = text.split(mentionRegex);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('@') && part.length > 1) {
          return (
            <span
              key={i}
              className="text-onedark-yellow font-sans font-normal underline decoration-onedark-yellow/40 underline-offset-2"
            >
              {part}
            </span>
          );
        }
        return <span key={i} className="text-onedark-fgBright">{part}</span>;
      })}
    </>
  );
};

const renderStyledMessageContent = (text?: string) => {
  if (!text) return null;
  const masked = maskSecretsInText(text);
  const mentionRegex = /(@[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)?)/g;
  const parts = masked.split(mentionRegex);

  return parts.map((part, i) => {
    if (part.startsWith('@') && part.length > 1) {
      return (
        <span
          key={i}
          className="font-bold text-onedark-yellow font-mono hover:underline cursor-pointer"
        >
          {part}
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });
};

interface SystemMessageCardProps {
  content: string;
  isStreaming?: boolean;
  task?: Task | null;
  onLinkClick?: (url: string, text: string) => void;
}

const cleanSystemText = (text: string) => {
  return text
    .replace(/^🛑\s*(?:\*\*)?Action Rejected by Reviewer\.(?:\*\*)?\s*Reason:\s*/i, 'Action cancelled: ')
    .replace(/^⏹\s*(?:\*\*)?Task stopped by user\.(?:\*\*)?/i, 'Task stopped by user.')
    .replace(/^■\s*(?:\*\*)?Task stopped by user\.(?:\*\*)?/i, 'Task stopped by user.')
    .replace(/^[🛑⏹■⚠️]\s*/, '')
    .trim();
};

const SystemMessageCard: React.FC<SystemMessageCardProps> = ({
  content,
  isStreaming,
  task,
  onLinkClick,
}) => {
  const isAwakened =
    content.includes('Session Awakened:') ||
    content.includes('**Session Awakened:**') ||
    content.includes('Event Trigger:') ||
    content.includes('Inbound event');

  if (!isAwakened) {
    const cleaned = cleanSystemText(content);
    return (
      <div className="my-1.5 px-3 py-1.5 rounded-lg bg-onedark-surface/20 border border-onedark-borderSubtle/50 text-xs text-onedark-muted max-w-2xl text-left font-sans">
        <MarkdownRenderer
          content={maskSecretsInText(cleaned)}
          isStreaming={isStreaming}
          onLinkClick={onLinkClick}
          className="text-xs text-onedark-muted space-y-1"
        />
      </div>
    );
  }

  return (
    <div className="my-3 w-full max-w-3xl rounded-xl border border-onedark-yellow/30 bg-onedark-darker/95 overflow-hidden shadow-xs text-left">
      {/* Header Bar */}
      <div className="px-3.5 py-2.5 bg-onedark-surface/60 border-b border-onedark-borderSubtle flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center space-x-2">
          <div className="w-5 h-5 rounded-md bg-onedark-yellow/15 text-onedark-yellow border border-onedark-yellow/30 flex items-center justify-center shrink-0">
            <Zap className="w-3 h-3 animate-pulse" />
          </div>
          <span className="text-[11px] font-mono font-bold tracking-wider uppercase text-onedark-yellow">
            Session Awakened
          </span>
          <span className="w-1.5 h-1.5 rounded-full bg-onedark-yellow animate-ping shrink-0" />
        </div>

        <div className="flex items-center space-x-2 shrink-0">
          {task?.repo_name && (
            <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[10.5px] font-mono bg-onedark-surface text-onedark-fg border border-onedark-borderSubtle">
              <FolderGit2 className="w-3 h-3 text-onedark-folder" />
              <span>{task.repo_name}</span>
            </span>
          )}
          {task?.commit_sha && (
            <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[10.5px] font-mono bg-onedark-surface text-onedark-muted border border-onedark-borderSubtle">
              <GitCommit className="w-3 h-3 text-onedark-accent" />
              <span>{task.commit_sha.slice(0, 7)}</span>
            </span>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="p-3.5 space-y-2.5 text-xs leading-relaxed text-onedark-fg">
        <MarkdownRenderer
          content={maskSecretsInText(content)}
          isStreaming={isStreaming}
          onLinkClick={onLinkClick}
        />
      </div>
    </div>
  );
};

export interface QuickActionItem {
  id: string;
  label: string;
  prompt: string;
  variant?: 'primary' | 'secondary' | 'success' | 'danger' | 'warning' | 'neutral' | 'accent';
  icon?: 'check' | 'x' | 'message' | 'sparkles' | 'play' | 'git' | 'arrow' | string;
  description?: string;
}

export function extractQuickActions(rawContent: string): { cleanedContent: string; actions: QuickActionItem[] } {
  if (!rawContent) return { cleanedContent: '', actions: [] };

  const actions: QuickActionItem[] = [];
  let cleaned = rawContent;

  // 1. Structured XML tags: <quick-actions> ... </quick-actions> or <quick_actions> ... </quick_actions>
  const quickActionsBlockRegex = /<(?:quick-actions|quick_actions)>([\s\S]*?)<\/(?:quick-actions|quick_actions)>/gi;
  let blockMatch;
  while ((blockMatch = quickActionsBlockRegex.exec(rawContent)) !== null) {
    const blockContent = blockMatch[1];
    const actionTagRegex = /<action\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/action>)/gi;
    let actionMatch;
    while ((actionMatch = actionTagRegex.exec(blockContent)) !== null) {
      const attrsStr = actionMatch[1];
      const innerText = (actionMatch[2] || '').trim();

      const idMatch = attrsStr.match(/\bid=["']([^"']+)["']/i);
      const labelMatch = attrsStr.match(/\blabel=["']([^"']+)["']/i);
      const promptMatch = attrsStr.match(/\bprompt=["']([^"']+)["']/i);
      const variantMatch = attrsStr.match(/\bvariant=["']([^"']+)["']/i);
      const iconMatch = attrsStr.match(/\bicon=["']([^"']+)["']/i);
      const descMatch = attrsStr.match(/\bdescription=["']([^"']+)["']/i);

      const label = labelMatch ? labelMatch[1] : (innerText || 'Action');
      const prompt = promptMatch ? promptMatch[1] : (innerText || label);
      const id = idMatch ? idMatch[1] : `qa-${actions.length + 1}`;
      const variant = (variantMatch ? variantMatch[1].toLowerCase() : 'neutral') as QuickActionItem['variant'];
      const icon = (iconMatch ? iconMatch[1].toLowerCase() : undefined) as QuickActionItem['icon'];
      const description = descMatch ? descMatch[1] : undefined;

      actions.push({ id, label, prompt, variant, icon, description });
    }
  }

  // Strip quick-actions XML blocks so they don't leak into markdown
  cleaned = cleaned.replace(quickActionsBlockRegex, '').trimEnd();
  cleaned = cleaned.replace(/<(?:quick-actions|quick_actions)>[\s\S]*$/gi, '').trimEnd();

  // 2. Fallback Heuristics for PR Review & Test Remediation questions
  if (actions.length === 0) {
    // Check for PR review staging question (e.g. "Want me to stage this as a formal GitHub review on #1259 — approve, or comment...?")
    const reviewPattern = /(?:stage|submit|post) (?:this as )?a (?:formal )?(?:github )?review on #?(\d+)/i;
    const reviewMatch = rawContent.match(reviewPattern);
    if (reviewMatch) {
      const prNum = reviewMatch[1];
      actions.push({
        id: `approve-pr-${prNum}`,
        label: `Approve #${prNum}`,
        prompt: `Please approve PR #${prNum} with this review.`,
        variant: 'success',
        icon: 'check',
        description: `Submit approved review for PR #${prNum}`
      });
      actions.push({
        id: `comment-pr-${prNum}`,
        label: `Comment on #${prNum}`,
        prompt: `Please comment on PR #${prNum} with this review.`,
        variant: 'neutral',
        icon: 'message',
        description: `Submit neutral review comment for PR #${prNum}`
      });
      actions.push({
        id: `changes-pr-${prNum}`,
        label: `Request Changes #${prNum}`,
        prompt: `Please request changes on PR #${prNum} with this review.`,
        variant: 'danger',
        icon: 'x',
        description: `Submit changes requested review for PR #${prNum}`
      });
    } else {
      // Check for test remediation question (e.g. "Want me to investigate and fix the failing test suite for PR #1258?")
      const testFixPattern = /(?:investigate|fix|remedy) (?:the )?failing test(?:s)?(?: suite)? for (?:pr )?#?(\d+)/i;
      const testFixMatch = rawContent.match(testFixPattern);
      if (testFixMatch) {
        const prNum = testFixMatch[1];
        actions.push({
          id: `fix-tests-${prNum}`,
          label: `Fix Failing Tests (#${prNum})`,
          prompt: `Please investigate and fix the failing test suite for PR #${prNum}.`,
          variant: 'accent',
          icon: 'sparkles',
          description: `Launch autonomous testing agent on PR #${prNum}`
        });
      }
    }
  }

  return { cleanedContent: cleaned, actions };
}

interface ProcessedAgentMessageData {
  outTokens: number;
  cleanedContent: string;
  maskedContent: string;
  quickActions: QuickActionItem[];
  isFullPlanDoc: boolean;
  planInfo: { title: string; overview: string; phases: string[] } | null;
}

const processedAgentMsgCache = new Map<string, ProcessedAgentMessageData>();

function getProcessedAgentMessage(
  msg: TaskMessage,
  intentCategory?: string
): ProcessedAgentMessageData {
  const rawContent = msg.content || '';
  const cacheKey = `${msg.id}:${rawContent.length}:${msg.tokens || 0}:${intentCategory || ''}`;
  if (!msg.isStreaming) {
    const cached = processedAgentMsgCache.get(cacheKey);
    if (cached) return cached;
  }

  const outTokens = msg.tokens || estimateTokens(rawContent);
  const { cleanedContent, actions: quickActions } = extractQuickActions(rawContent);
  const maskedContent = maskSecretsInText(cleanedContent);
  const isFullPlanDoc = Boolean(
    rawContent &&
      (rawContent.trim().startsWith('# Implementation Plan') ||
        (rawContent.includes('# Implementation Plan') && rawContent.length > 250) ||
        rawContent.includes('I have formulated an implementation plan') ||
        rawContent.includes('Implementation Plan Formulated')) &&
      (intentCategory === 'planning' || rawContent.includes('I have formulated an implementation plan'))
  );
  const planInfo = isFullPlanDoc ? extractPlanHighlightsFromMarkdown(rawContent) : null;

  const result: ProcessedAgentMessageData = {
    outTokens,
    cleanedContent,
    maskedContent,
    quickActions,
    isFullPlanDoc,
    planInfo,
  };

  if (!msg.isStreaming) {
    if (processedAgentMsgCache.size >= 400) {
      const oldestKey = processedAgentMsgCache.keys().next().value;
      if (oldestKey !== undefined) processedAgentMsgCache.delete(oldestKey);
    }
    processedAgentMsgCache.set(cacheKey, result);
  }

  return result;
}

interface QuickActionChipsProps {
  actions: QuickActionItem[];
  onSelectAction: (action: QuickActionItem) => void;
  disabled?: boolean;
}

export const QuickActionChips: React.FC<QuickActionChipsProps> = ({
  actions,
  onSelectAction,
  disabled
}) => {
  if (!actions || actions.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 pt-2.5 animate-in fade-in slide-in-from-bottom-1 duration-200">
      {actions.map((act) => {
        let variantClasses = 'bg-onedark-surface hover:bg-onedark-surface/80 text-onedark-fgBright border-onedark-borderSubtle hover:border-onedark-border';
        let defaultIcon = <ArrowRight className="w-3.5 h-3.5" />;

        if (act.variant === 'success') {
          variantClasses = 'bg-onedark-green/15 hover:bg-onedark-green/25 text-onedark-green border-onedark-green/30 hover:border-onedark-green/50 shadow-xs shadow-onedark-green/5';
          defaultIcon = <CheckCircle2 className="w-3.5 h-3.5" />;
        } else if (act.variant === 'danger') {
          variantClasses = 'bg-onedark-red/15 hover:bg-onedark-red/25 text-onedark-red border-onedark-red/30 hover:border-onedark-red/50 shadow-xs shadow-onedark-red/5';
          defaultIcon = <X className="w-3.5 h-3.5" />;
        } else if (act.variant === 'accent' || act.variant === 'primary') {
          variantClasses = 'bg-onedark-accent/15 hover:bg-onedark-accent/25 text-onedark-accent border-onedark-accent/30 hover:border-onedark-accent/50 shadow-xs shadow-onedark-accent/5';
          defaultIcon = <Sparkles className="w-3.5 h-3.5" />;
        } else if (act.variant === 'warning') {
          variantClasses = 'bg-onedark-yellow/15 hover:bg-onedark-yellow/25 text-onedark-yellow border-onedark-yellow/30 hover:border-onedark-yellow/50 shadow-xs shadow-onedark-yellow/5';
          defaultIcon = <AlertCircle className="w-3.5 h-3.5" />;
        }

        let iconElement = defaultIcon;
        if (act.icon === 'check') iconElement = <CheckCircle2 className="w-3.5 h-3.5" />;
        else if (act.icon === 'x') iconElement = <X className="w-3.5 h-3.5" />;
        else if (act.icon === 'message') iconElement = <FileText className="w-3.5 h-3.5" />;
        else if (act.icon === 'sparkles') iconElement = <Sparkles className="w-3.5 h-3.5" />;
        else if (act.icon === 'play') iconElement = <Play className="w-3.5 h-3.5 fill-current" />;
        else if (act.icon === 'git') iconElement = <GitPullRequest className="w-3.5 h-3.5" />;
        else if (act.icon === 'arrow') iconElement = <ArrowRight className="w-3.5 h-3.5" />;

        return (
          <button
            key={act.id}
            type="button"
            disabled={disabled}
            onClick={() => onSelectAction(act)}
            title={act.description || act.prompt}
            className={`group inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all shadow-xs active:scale-95 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed select-none ${variantClasses}`}
          >
            <span className="shrink-0 group-hover:scale-110 transition-transform duration-150">
              {iconElement}
            </span>
            <span className="font-semibold tracking-tight">{act.label}</span>
          </button>
        );
      })}
    </div>
  );
};

interface InquiryCardProps {
  taskId: string;
  approval: any;
  onResolved: () => void;
}

const InquiryCard: React.FC<InquiryCardProps> = ({ taskId, approval, onResolved }) => {
  const details = approval.action_details || {};
  const question = details.question || 'Please specify your preference:';
  const options: Array<{ id: string; label: string; description?: string }> = details.options || [];
  const defaultOptionId = details.default_option_id || (options[0]?.id ?? '');
  const totalSeconds = details.timeout_seconds || 25;
  const expiresAt = details.expires_at ? new Date(details.expires_at).getTime() : Date.now() + totalSeconds * 1000;

  const [selectedId, setSelectedId] = useState<string>(defaultOptionId);
  const [customText, setCustomText] = useState<string>('');
  const [remainingSeconds, setRemainingSeconds] = useState<number>(() => {
    return Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      const diff = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      setRemainingSeconds(diff);
    }, 500);
    return () => clearInterval(timer);
  }, [expiresAt]);

  const handleSubmit = async (optId?: string, customResp?: string) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await fetch(`${API_BASE}/api/tasks/${taskId}/inquiry/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selected_option_id: optId || selectedId,
          custom_response: customResp || (customText.trim() ? customText.trim() : undefined),
        }),
      });
      onResolved();
    } catch (e) {
      console.error('Failed to submit inquiry response:', e);
    } finally {
      setSubmitting(false);
    }
  };

  const defaultOption = options.find((o) => o.id === defaultOptionId);
  const progressPercent = Math.min(100, Math.max(0, (remainingSeconds / totalSeconds) * 100));

  return (
    <div className="rounded-xl border border-onedark-border bg-onedark-darker/95 p-4 sm:p-5 space-y-3.5 shadow-md overflow-hidden relative transition-all">
      {/* Top Animated Countdown Bar */}
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-onedark-surface/60">
        <div
          className="h-full bg-onedark-accent/60 transition-all duration-500 ease-linear"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 pt-0.5 min-w-0">
        <div className="flex items-center space-x-2.5 min-w-0 flex-1">
          <div className="w-5.5 h-5.5 rounded-md bg-onedark-accent/10 border border-onedark-accent/20 flex items-center justify-center text-onedark-accent flex-shrink-0">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <span className="text-xs font-semibold text-onedark-fgBright truncate block">
              Interactive Inquiry & Configuration
            </span>
            <div className="text-[10px] text-onedark-muted font-mono truncate">
              Autonomous Assistant Decision Point
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2 shrink-0">
          <span
            className={`px-2 py-0.5 rounded-full text-[10.5px] font-mono border flex items-center space-x-1.5 whitespace-nowrap ${
              remainingSeconds <= 5
                ? 'bg-onedark-red/10 border-onedark-red/30 text-onedark-red animate-pulse'
                : 'bg-onedark-surface border-onedark-borderSubtle text-onedark-muted'
            }`}
          >
            <Clock className="w-3 h-3" />
            <span>
              {remainingSeconds > 0
                ? `Auto-proceeding in ${remainingSeconds}s`
                : 'Auto-proceeding...'}
            </span>
          </span>
        </div>
      </div>

      {/* Question Text */}
      <div className="p-3 rounded-lg bg-onedark-surface/30 border border-onedark-borderSubtle text-xs text-onedark-fg font-sans leading-relaxed">
        <MarkdownRenderer content={question} />
      </div>

      {/* Selectable Options Grid */}
      {options.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {options.map((option) => {
            const isSelected = selectedId === option.id;
            const isDefault = option.id === defaultOptionId;

            return (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  setSelectedId(option.id);
                  handleSubmit(option.id);
                }}
                disabled={submitting}
                className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer select-none relative group ${
                  isSelected
                    ? 'bg-onedark-accent/10 border-onedark-accent/50 text-onedark-fgBright shadow-xs'
                    : 'bg-onedark-surface/20 hover:bg-onedark-surface/60 border-onedark-borderSubtle text-onedark-fg'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex items-center space-x-1.5 flex-wrap">
                      <span className="text-xs font-medium">{option.label}</span>
                      {isDefault && (
                        <span className="px-1.5 py-0.2 rounded bg-onedark-surface border border-onedark-borderSubtle text-onedark-muted text-[9px] font-mono font-medium">
                          Recommended
                        </span>
                      )}
                    </div>
                    {option.description && (
                      <p className="text-[10.5px] text-onedark-muted line-clamp-2 leading-relaxed">
                        {option.description}
                      </p>
                    )}
                  </div>
                  <div
                    className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center flex-shrink-0 mt-0.5 ${
                      isSelected
                        ? 'border-onedark-accent bg-onedark-accent text-onedark-accentFg'
                        : 'border-onedark-muted/30 group-hover:border-onedark-muted'
                    }`}
                  >
                    {isSelected && <Check className="w-2 h-2 stroke-[3]" />}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Custom Write-In Input Field */}
      <div className="flex items-center space-x-2 pt-1">
        <input
          type="text"
          value={customText}
          onChange={(e) => setCustomText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (customText.trim()) handleSubmit(selectedId, customText.trim());
            }
          }}
          placeholder="Or write a custom answer / instruction..."
          className="flex-1 bg-onedark-surface/40 border border-onedark-borderSubtle rounded-xl px-3.5 py-2 text-xs text-onedark-fgBright font-sans focus:outline-none focus:border-onedark-accent placeholder-onedark-muted"
        />
        <button
          type="button"
          onClick={() => {
            if (customText.trim()) handleSubmit(selectedId, customText.trim());
            else handleSubmit(selectedId);
          }}
          disabled={submitting}
          className="px-3.5 py-2 rounded-xl bg-onedark-accent hover:bg-onedark-accent/90 text-onedark-accentFg font-bold text-xs font-sans flex items-center space-x-1.5 transition-all cursor-pointer shadow-sm disabled:opacity-50"
        >
          {submitting ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Send className="w-3.5 h-3.5" />
          )}
          <span>Proceed</span>
        </button>
      </div>

      {defaultOption && (
        <div className="text-[10.5px] text-onedark-muted font-mono flex items-center justify-between pt-1 border-t border-onedark-borderSubtle">
          <span>
            Default: <strong className="text-onedark-fg">{defaultOption.label}</strong>
          </span>
          <button
            type="button"
            onClick={() => handleSubmit(defaultOptionId)}
            className="text-onedark-accent hover:underline cursor-pointer"
          >
            Accept default immediately ➔
          </button>
        </div>
      )}
    </div>
  );
};

interface RepoAutoCarouselProps {
  repos: RepositoryConfig[];
  inputValue: string;
  onSelectRepo: (tag: string) => void;
  onConnectRepo?: () => void;
}

const RepoAutoCarousel: React.FC<RepoAutoCarouselProps> = ({
  repos,
  inputValue,
  onSelectRepo,
  onConnectRepo,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const animationFrameRef = useRef<number | null>(null);
  const scrollPosRef = useRef<number>(0);

  // Auto-scroll continuous animation
  useEffect(() => {
    const el = containerRef.current;
    if (!el || repos.length === 0) return;

    let lastTimestamp = performance.now();
    const speed = 0.35; // smooth ticker speed

    const step = (now: number) => {
      const delta = now - lastTimestamp;
      lastTimestamp = now;

      if (!isHovered && el) {
        scrollPosRef.current += speed * (delta / 16.67);
        const maxScroll = el.scrollWidth - el.clientWidth;

        if (maxScroll > 10) {
          if (scrollPosRef.current >= maxScroll) {
            scrollPosRef.current = 0;
            el.scrollLeft = 0;
          } else {
            el.scrollLeft = scrollPosRef.current;
          }
        }
      } else if (el) {
        scrollPosRef.current = el.scrollLeft;
      }

      animationFrameRef.current = requestAnimationFrame(step);
    };

    animationFrameRef.current = requestAnimationFrame(step);
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [isHovered, repos]);

  const handleScrollManual = (direction: 'left' | 'right') => {
    const el = containerRef.current;
    if (!el) return;
    const scrollAmount = 240;
    const newTarget = direction === 'left' ? Math.max(0, el.scrollLeft - scrollAmount) : el.scrollLeft + scrollAmount;
    el.scrollTo({ left: newTarget, behavior: 'smooth' });
    scrollPosRef.current = newTarget;
  };

  if (repos.length === 0 && !onConnectRepo) return null;

  return (
    <div 
      className="relative w-full group/carousel select-none py-0.5"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Left Gradient Fade Mask & Scroll Button */}
      <div className="absolute left-0 top-0 bottom-0 w-12 bg-gradient-to-r from-onedark-bg via-onedark-bg/80 to-transparent z-10 pointer-events-none rounded-l-xl flex items-center pl-1">
        <button
          type="button"
          onClick={() => handleScrollManual('left')}
          className="pointer-events-auto h-6 w-6 rounded-full bg-onedark-darker/90 hover:bg-onedark-surface border border-onedark-borderSubtle text-onedark-muted hover:text-onedark-fgBright flex items-center justify-center transition-all opacity-0 group-hover/carousel:opacity-100 shadow-md cursor-pointer active:scale-95"
          title="Scroll previous"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Right Gradient Fade Mask & Scroll Button */}
      <div className="absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-onedark-bg via-onedark-bg/80 to-transparent z-10 pointer-events-none rounded-r-xl flex items-center justify-end pr-1">
        <button
          type="button"
          onClick={() => handleScrollManual('right')}
          className="pointer-events-auto h-6 w-6 rounded-full bg-onedark-darker/90 hover:bg-onedark-surface border border-onedark-borderSubtle text-onedark-muted hover:text-onedark-fgBright flex items-center justify-center transition-all opacity-0 group-hover/carousel:opacity-100 shadow-md cursor-pointer active:scale-95"
          title="Scroll next"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Scrolling Carousel Track */}
      <div
        ref={containerRef}
        onScroll={() => {
          if (containerRef.current) {
            scrollPosRef.current = containerRef.current.scrollLeft;
          }
        }}
        className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden px-8 py-1"
      >
        {repos.map((r) => {
          const tag = `@${r.full_name || r.name}`;
          const isIncluded = inputValue.includes(tag);
          return (
            <button
              key={r.id || r.full_name}
              type="button"
              onClick={() => onSelectRepo(tag)}
              className={`h-8 px-3 rounded-lg text-xs font-mono transition-all flex items-center space-x-2 cursor-pointer flex-shrink-0 border shadow-2xs group/chip ${
                isIncluded
                  ? 'bg-onedark-accent/20 border-onedark-accent text-onedark-accent font-semibold shadow-xs'
                  : 'bg-onedark-surface/40 hover:bg-onedark-surface/80 border-onedark-borderSubtle/80 hover:border-onedark-accent/50 text-onedark-fg hover:text-onedark-fgBright'
              }`}
              title={`Click to reference ${tag} in prompt`}
            >
              <FolderGit2 className="w-3.5 h-3.5 text-onedark-folder flex-shrink-0 group-hover/chip:scale-110 transition-transform" />
              <span className="font-medium truncate max-w-[200px]">{r.full_name || r.name}</span>
              {r.default_branch && (
                <span className="text-[10px] text-onedark-muted font-normal px-1.5 py-0.5 rounded bg-onedark-darker/60 border border-onedark-borderSubtle/40 hidden sm:inline">
                  {r.default_branch}
                </span>
              )}
            </button>
          );
        })}

        {onConnectRepo && (
          <button
            type="button"
            onClick={onConnectRepo}
            className="h-8 px-3 rounded-lg bg-onedark-surface/20 hover:bg-onedark-surface/60 border border-dashed border-onedark-borderSubtle/80 hover:border-onedark-accent/50 text-xs font-mono text-onedark-muted hover:text-onedark-fg transition-all flex items-center space-x-1.5 cursor-pointer flex-shrink-0 shadow-2xs"
            title="Connect a GitHub or GitLab repository"
          >
            <Plus className="w-3.5 h-3.5 text-onedark-accent flex-shrink-0" />
            <span>Connect Repo</span>
          </button>
        )}
      </div>
    </div>
  );
};

export const ChatCanvas: React.FC<ChatCanvasProps> = ({
  task,
  isLoadingSession,
  repositories: propRepositories,
  currentDraft,
  onDraftChange,
  onSendMessage,
  onApprove,
  onReject,
  onNewChatWithPrompt,
  onEditMessage,
  onRetryTask,
  onResetTurn,
  onStopTask,
  onUpdateTaskTitle,
  onDeleteTask,
  isSidebarCollapsed,
  onToggleSidebar,
  currentPreset,
  onSetPreset,
  onOpenSandboxModal,
  onSelectAuxTab,
  onOpenFile,
  onOpenDoc,
  onOpenPreview,
  onOpenPlan,
  onNavigateToRepos,
}) => {
  const onDraftChangeRef = useRef(onDraftChange);
  useEffect(() => {
    onDraftChangeRef.current = onDraftChange;
  }, [onDraftChange]);

  const [inputValue, setRawInputValue] = useState(currentDraft || '');

  const setInputValue = useCallback((valOrUpdater: string | ((prev: string) => string)) => {
    if (typeof valOrUpdater === 'function') {
      setRawInputValue((prev) => {
        const next = valOrUpdater(prev);
        setTimeout(() => {
          onDraftChangeRef.current?.(next);
        }, 0);
        return next;
      });
    } else {
      setRawInputValue(valOrUpdater);
      setTimeout(() => {
        onDraftChangeRef.current?.(valOrUpdater);
      }, 0);
    }
  }, []);

  useEffect(() => {
    if (currentDraft !== undefined) {
      setRawInputValue(currentDraft);
    }
  }, [currentDraft, task?.id]);
  const [selectedPersona, setSelectedPersona] = useState('General');
  const [selectedModel, setSelectedModel] = useState('auto');
  const [openThoughts, setOpenThoughts] = useState<Record<string, boolean>>({});
  const [expandedThoughtIds, setExpandedThoughtIds] = useState<Record<string, boolean>>({});
  const [userToggledPlans, setUserToggledPlans] = useState<Record<string, boolean>>({});
  const [userToggledActivities, setUserToggledActivities] = useState<Record<string, boolean>>({});
  const [expandedLogIds, setExpandedLogIds] = useState<Record<string, boolean>>({});
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isSandboxModalOpen, setIsSandboxModalOpen] = useState(false);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeletingSession, setIsDeletingSession] = useState(false);
  const [showScrollBottomBtn, setShowScrollBottomBtn] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState('');
  const [copiedBranch, setCopiedBranch] = useState(false);
  const [expandedRawPlanMsgIds, setExpandedRawPlanMsgIds] = useState<Record<string, boolean>>({});
  const [activeApprovalId, setActiveApprovalId] = useState<string | null>(null);

  const [localRepos, setLocalRepos] = useState<RepositoryConfig[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState<number>(-1);
  const [selectedMentionIdx, setSelectedMentionIdx] = useState<number>(0);

  const [previewInfo, setPreviewInfo] = useState<WorkspacePreviewInfo | null>(null);
  const [lightboxImage, setLightboxImage] = useState<{ url: string; name: string; sizeStr?: string } | null>(null);
  const [lightboxZoom, setLightboxZoom] = useState<number>(1);
  const [lightboxRotation, setLightboxRotation] = useState<number>(0);

  const checkPreviewStatus = useCallback(async () => {
    if (!task?.id || task.id.startsWith('temp-')) {
      setPreviewInfo(null);
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/tasks/${task.id}/preview/inspect`);
      if (res.ok) {
        const data = await res.json();
        setPreviewInfo(data);
      }
    } catch {
      // ignore
    }
  }, [task?.id]);

  useEffect(() => {
    const initTimer = setTimeout(() => {
      checkPreviewStatus();
    }, 600);
    const isTaskRunning = task?.status === 'RUNNING' || task?.status === 'INITIALIZING';
    const interval = isTaskRunning ? setInterval(checkPreviewStatus, 15000) : null;
    return () => {
      clearTimeout(initTimer);
      if (interval) clearInterval(interval);
    };
  }, [checkPreviewStatus, task?.status]);

  const handleGlobalLinkClick = useCallback((url: string, text: string) => {
    if (url.startsWith('plan://') || url === '#open-plan-doc' || url === 'action://open-plan-doc') {
      if (onOpenPlan && task?.plan) {
        onOpenPlan(task.id, task.plan);
      } else if (onOpenPreview && task?.id) {
        onOpenPreview(`plan://${task.id}`, 'Implementation Plan');
      }
      return;
    }
    if (onOpenPreview) {
      onOpenPreview(url, text);
    }
  }, [onOpenPlan, onOpenPreview, task?.id, task?.plan]);

  const handleStartEditTitle = () => {
    if (!task) return;
    setTitleInput(task.title || '');
    setIsEditingTitle(true);
  };

  const handleCommitTitle = () => {
    if (task && titleInput.trim() && onUpdateTaskTitle) {
      onUpdateTaskTitle(task.id, titleInput.trim());
    }
    setIsEditingTitle(false);
  };

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatFileInputRef = useRef<HTMLInputElement>(null);
  const chatFolderInputRef = useRef<HTMLInputElement>(null);
  const attachMenuEmptyRef = useRef<HTMLDivElement>(null);
  const attachMenuChatRef = useRef<HTMLDivElement>(null);
  const personaMenuEmptyRef = useRef<HTMLDivElement>(null);
  const modelMenuEmptyRef = useRef<HTMLDivElement>(null);
  const personaMenuChatRef = useRef<HTMLDivElement>(null);
  const modelMenuChatRef = useRef<HTMLDivElement>(null);
  const repoMenuChatRef = useRef<HTMLDivElement>(null);
  const isAutoScrollEnabledRef = useRef<boolean>(true);
  const showScrollBottomBtnRef = useRef<boolean>(false);
  const scrollRafRef = useRef<number | null>(null);
  const userScrollRafRef = useRef<number | null>(null);

  const updateShowScrollBottomBtn = useCallback((next: boolean) => {
    if (showScrollBottomBtnRef.current !== next) {
      showScrollBottomBtnRef.current = next;
      setShowScrollBottomBtn(next);
    }
  }, []);

  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [isDraggingInput, setIsDraggingInput] = useState<boolean>(false);
  const [showAttachMenuEmpty, setShowAttachMenuEmpty] = useState<boolean>(false);
  const [showAttachMenuChat, setShowAttachMenuChat] = useState<boolean>(false);
  const [showPersonaMenuEmpty, setShowPersonaMenuEmpty] = useState<boolean>(false);
  const [showModelMenuEmpty, setShowModelMenuEmpty] = useState<boolean>(false);
  const [showPersonaMenuChat, setShowPersonaMenuChat] = useState<boolean>(false);
  const [showModelMenuChat, setShowModelMenuChat] = useState<boolean>(false);
  const [showRepoMenuChat, setShowRepoMenuChat] = useState<boolean>(false);
  const [activeModalDoc, setActiveModalDoc] = useState<SniffedPastedDoc | null>(null);
  const [isDocModalOpen, setIsDocModalOpen] = useState<boolean>(false);
  const [isDocModalReadOnly, setIsDocModalReadOnly] = useState<boolean>(false);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (attachMenuEmptyRef.current && !attachMenuEmptyRef.current.contains(e.target as Node)) {
        setShowAttachMenuEmpty(false);
      }
      if (attachMenuChatRef.current && !attachMenuChatRef.current.contains(e.target as Node)) {
        setShowAttachMenuChat(false);
      }
      if (personaMenuEmptyRef.current && !personaMenuEmptyRef.current.contains(e.target as Node)) {
        setShowPersonaMenuEmpty(false);
      }
      if (modelMenuEmptyRef.current && !modelMenuEmptyRef.current.contains(e.target as Node)) {
        setShowModelMenuEmpty(false);
      }
      if (personaMenuChatRef.current && !personaMenuChatRef.current.contains(e.target as Node)) {
        setShowPersonaMenuChat(false);
      }
      if (modelMenuChatRef.current && !modelMenuChatRef.current.contains(e.target as Node)) {
        setShowModelMenuChat(false);
      }
      if (repoMenuChatRef.current && !repoMenuChatRef.current.contains(e.target as Node)) {
        setShowRepoMenuChat(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const setFolderInputRef = (el: HTMLInputElement | null) => {
    chatFolderInputRef.current = el;
    if (el) {
      el.setAttribute('webkitdirectory', '');
      el.setAttribute('directory', '');
      el.setAttribute('mozdirectory', '');
      (el as any).webkitdirectory = true;
    }
  };

  const handleAttachItems = async (items: UploadableItem[]) => {
    if (!items || items.length === 0) return;
    const newItems: ChatAttachment[] = items.map((item) => {
      try {
        const blobUrl = URL.createObjectURL(item.file);
        localAttachmentBlobUrls.set(item.name, blobUrl);
      } catch {
        // ignore
      }
      return {
        id: item.id,
        file: item.file,
        name: item.name,
        size: item.size,
        relativePath: item.relativePath,
        rootFolder: item.rootFolder,
        status: task?.id ? 'uploading' : 'ready',
      };
    });
    setAttachments((prev) => [...prev, ...newItems]);

    if (task?.id) {
      const formData = new FormData();
      newItems.forEach((item) => {
        const rel = item.relativePath || item.file.name;
        formData.append('files', item.file, rel);
      });
      formData.append('target_type', 'workspace');
      try {
        const res = await fetch(`${API_BASE}/api/tasks/${task.id}/files/upload`, {
          method: 'POST',
          body: formData,
        });
        if (res.ok) {
          const data = await res.json();
          const uploadedList: any[] = data.uploaded || [];
          const uploadedMap = new Map(uploadedList.map((u) => [u.path, u]));
          setAttachments((prev) =>
            prev.map((a) => {
              if (!newItems.some((ni) => ni.id === a.id)) return a;
              const rel = a.relativePath || a.file.name;
              const rec: any = uploadedMap.get(rel) || (a.name ? uploadedMap.get(a.name) : undefined);
              return rec
                ? { ...a, status: 'ready', path: rec.path, category: rec.category }
                : { ...a, status: 'ready' };
            })
          );
        } else {
          setAttachments((prev) =>
            prev.map((a) =>
              newItems.some((ni) => ni.id === a.id) ? { ...a, status: 'error', error: 'Upload failed' } : a
            )
          );
        }
      } catch (e: any) {
        setAttachments((prev) =>
          prev.map((a) =>
            newItems.some((ni) => ni.id === a.id) ? { ...a, status: 'error', error: e.message } : a
          )
        );
      }
    }
  };

  const handleSelectFolder = async () => {
    setShowAttachMenuEmpty(false);
    setShowAttachMenuChat(false);
    const nativeItems = await openNativeFolderPicker();
    if (nativeItems !== null) {
      if (nativeItems.length > 0) {
        await handleAttachItems(nativeItems);
      }
      return;
    }
    chatFolderInputRef.current?.click();
  };

  const handleAttachFiles = async (files: FileList | File[]) => {
    const items = extractFilesFromInput(files);
    await handleAttachItems(items);
  };

  const handleAttachDropped = async (dataTransfer: DataTransfer) => {
    const items = await readDroppedFileSystemEntries(dataTransfer);
    await handleAttachItems(items);
  };

  const handleRemoveAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const handleRemoveFolder = (rootFolder: string) => {
    setAttachments((prev) => prev.filter((a) => a.rootFolder !== rootFolder));
  };

  const handleOpenDocModal = (doc: SniffedPastedDoc, readOnly: boolean = false) => {
    setActiveModalDoc(doc);
    setIsDocModalReadOnly(readOnly);
    setIsDocModalOpen(true);
  };

  const handleUnwrapPastedDoc = (doc: SniffedPastedDoc) => {
    setAttachments((prev) => prev.filter((a) => a.id !== doc.id));
    const activeTextarea = (!task ? emptyStateTextareaRef.current : textareaRef.current) || textareaRef.current;
    if (activeTextarea) {
      const start = activeTextarea.selectionStart ?? inputValue.length;
      const end = activeTextarea.selectionEnd ?? inputValue.length;
      const before = inputValue.substring(0, start);
      const after = inputValue.substring(end);
      const prefix = before && !before.endsWith('\n') ? '\n' : '';
      const suffix = after && !after.startsWith('\n') ? '\n' : '';
      const updated = before + prefix + doc.content + suffix + after;
      setInputValue(updated);
      setTimeout(() => {
        activeTextarea.focus();
        const newCursor = start + prefix.length + doc.content.length;
        activeTextarea.setSelectionRange(newCursor, newCursor);
      }, 0);
    } else {
      setInputValue((prev) => (prev ? `${prev}\n${doc.content}` : doc.content));
    }
  };

  const handleUpdatePastedDoc = (updated: SniffedPastedDoc) => {
    localPastedDocs.set(updated.title, updated);
    localPastedDocs.set(updated.id, updated);
    setActiveModalDoc(updated);

    const newFile = new File([updated.content], updated.title, { type: 'text/plain;charset=utf-8' });
    try {
      const blobUrl = URL.createObjectURL(newFile);
      localAttachmentBlobUrls.set(updated.title, blobUrl);
    } catch {
      // ignore
    }

    setAttachments((prev) =>
      prev.map((a) => {
        if (a.id === updated.id) {
          return {
            ...a,
            name: updated.title,
            size: updated.sizeBytes,
            file: newFile,
            pastedDoc: updated,
          };
        }
        return a;
      })
    );
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    // 1. Check for clipboard image blobs (e.g. screenshot pastes)
    const items = e.clipboardData?.items;
    if (items) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            const ext = item.type.split('/')[1] || 'png';
            const name = `screenshot_${Date.now()}.${ext}`;
            const renamedFile = new File([file], name, { type: file.type });
            handleAttachItems([
              {
                id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                file: renamedFile,
                name,
                size: renamedFile.size,
                relativePath: name,
                status: 'ready',
              },
            ]);
            return;
          }
        }
      }
    }

    // 2. Check for text across clipboard MIME types (standard text/plain, text, text/markdown)
    const text =
      e.clipboardData?.getData('text/plain') ||
      e.clipboardData?.getData('text') ||
      e.clipboardData?.getData('text/markdown') ||
      '';

    if (text && isLongPastedText(text)) {
      e.preventDefault();

      let docText = text;
      let promptPrefix = '';

      // Check if pasted text starts with an opening directive line (e.g. "Create a landing page based on this:")
      const firstLineBreak = text.indexOf('\n');
      if (firstLineBreak > 0 && firstLineBreak <= 140) {
        const firstLine = text.substring(0, firstLineBreak).trim();
        const remainder = text.substring(firstLineBreak).trim();
        if (
          firstLine &&
          !firstLine.startsWith('#') &&
          !firstLine.startsWith('```') &&
          !firstLine.startsWith('//') &&
          !firstLine.startsWith('/*') &&
          !firstLine.startsWith('import ') &&
          !firstLine.startsWith('def ') &&
          !firstLine.startsWith('{') &&
          !firstLine.startsWith('[') &&
          isLongPastedText(remainder)
        ) {
          promptPrefix = firstLine;
          docText = remainder;
        }
      }

      if (promptPrefix) {
        setInputValue((prev) => (prev ? `${prev.trim()} ${promptPrefix}` : promptPrefix));
      }

      const existingDocCount = attachments.filter((a) => a.pastedDoc).length + 1;
      const doc = createSniffedPastedDoc(docText, existingDocCount);

      localPastedDocs.set(doc.title, doc);
      localPastedDocs.set(doc.id, doc);

      const file = new File([doc.content], doc.title, { type: 'text/plain;charset=utf-8' });
      try {
        const blobUrl = URL.createObjectURL(file);
        localAttachmentBlobUrls.set(doc.title, blobUrl);
      } catch {
        // ignore
      }

      const newAttachment: ChatAttachment = {
        id: doc.id,
        file,
        name: doc.title,
        size: doc.sizeBytes,
        status: 'ready',
        category: 'doc',
        pastedDoc: doc,
      };

      setAttachments((prev) => [...prev, newAttachment]);
    }
  };

  const isRunning = task?.status === 'RUNNING' || task?.status === 'INITIALIZING';
  const isRunningRef = useRef(isRunning);
  useEffect(() => {
    isRunningRef.current = isRunning;
  }, [isRunning]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (task?.status === 'RUNNING' || task?.status === 'IDLE' || task?.status === 'COMPLETED' || task?.status === 'FAILED') {
      setIsSubmitting(false);
    }
  }, [task?.status]);

  useEffect(() => {
    if (task) {
      if (task.persona) setSelectedPersona(task.persona);
      if (task.model_name) setSelectedModel(task.model_name);
    }
  }, [task?.id, task?.persona, task?.model_name]);

  // Group task messages and logs into sequential conversational turns
  const turns = useMemo(() => {
    if (!task) return [];

    const result: ConversationTurn[] = [];
    const allMessages = [...(task.messages || [])].sort((a, b) => {
      const tA = a.created_at ? new Date(a.created_at).getTime() : Number.MAX_SAFE_INTEGER;
      const tB = b.created_at ? new Date(b.created_at).getTime() : Number.MAX_SAFE_INTEGER;
      return tA - tB;
    });
    const allLogs = [...(task.logs || [])].sort((a, b) => {
      const tA = a.created_at ? new Date(a.created_at).getTime() : Number.MAX_SAFE_INTEGER;
      const tB = b.created_at ? new Date(b.created_at).getTime() : Number.MAX_SAFE_INTEGER;
      return tA - tB;
    });

    // Base initial prompt
    if (task.description) {
      result.push({
        id: 'initial',
        userMessage: {
          id: 'initial',
          content: task.description,
          tokens: estimateTokens(task.description),
          created_at: task.created_at,
        },
        thoughts: [],
        logs: [],
        agentMessages: [],
        isLatest: false,
      });
    }

    // Process all chronological messages
    allMessages.forEach((m) => {
      if (m.sender === 'user') {
        // If it's a new user message turn
        if (result.length === 0 || m.content !== task.description) {
          result.push({
            id: m.id,
            userMessage: {
              id: m.id,
              content: m.content,
              tokens: m.tokens || estimateTokens(m.content),
              created_at: m.created_at,
              isOptimistic: m.isOptimistic,
            },
            thoughts: [],
            logs: [],
            agentMessages: [],
            isLatest: false,
          });
        }
      } else {
        // Agent or System message
        if (result.length === 0) {
          result.push({
            id: 'init-turn',
            thoughts: [],
            logs: [],
            agentMessages: [],
            isLatest: false,
          });
        }
        const currentTurn = result[result.length - 1];

        // 1. Process thought if present
        if (m.thought && !isInternalNotice(m.thought)) {
          const msgStreamId = (m as any).stream_id;
          const existingThoughtIdx = currentTurn.thoughts.findIndex(
            (t) =>
              t.id === m.id ||
              (msgStreamId && (t.id === msgStreamId || t.stream_id === msgStreamId)) ||
              (t.thought.trim() === m.thought.trim() && m.thought.trim().length > 0)
          );
          if (existingThoughtIdx >= 0) {
            const prevThought = currentTurn.thoughts[existingThoughtIdx];
            currentTurn.thoughts[existingThoughtIdx] = {
              ...prevThought,
              id: m.id.startsWith('thought-') ? prevThought.id : m.id,
              stream_id: prevThought.stream_id || msgStreamId || prevThought.id,
              thought: m.thought,
              created_at: m.created_at,
              tokens: m.tokens ?? prevThought.tokens,
              isStreaming: m.isStreaming ?? false,
            };
          } else {
            const lastThought = currentTurn.thoughts[currentTurn.thoughts.length - 1];
            if (!lastThought || lastThought.thought.trim() !== m.thought.trim() || m.isStreaming) {
              currentTurn.thoughts.push({
                id: m.id,
                stream_id: msgStreamId || m.id,
                thought: m.thought,
                created_at: m.created_at,
                tokens: m.tokens,
                isStreaming: m.isStreaming,
              });
            }
          }
        }

        // 2. Process content if present (filter out any thought mirroring)
        const isDuplicatedThought = Boolean(
          (m.thought && m.content && m.content.trim() === m.thought.trim()) ||
          (m.content && currentTurn.thoughts.some((t) => t.thought.trim() === m.content.trim()))
        );
        if (m.content && m.content.trim().length > 0 && !isDuplicatedThought) {
          const existingMsgIdx = currentTurn.agentMessages.findIndex((msg) => {
            if (msg.id === m.id) return true;
            if (msg.sender === m.sender && msg.content.trim().length > 0 && m.content.trim().length > 0) {
              if (msg.content.trim() === m.content.trim()) return true;
              if (msg.isStreaming && m.content.trim().startsWith(msg.content.trim())) return true;
              if (m.isStreaming && msg.content.trim().startsWith(m.content.trim())) return true;
            }
            return false;
          });

          if (existingMsgIdx >= 0) {
            currentTurn.agentMessages[existingMsgIdx] = {
              ...currentTurn.agentMessages[existingMsgIdx],
              ...m,
              id: m.id.startsWith('msg-') || m.id.startsWith('stream_') ? currentTurn.agentMessages[existingMsgIdx].id : m.id,
              tokens: m.tokens ?? currentTurn.agentMessages[existingMsgIdx].tokens,
              plan: m.plan || currentTurn.agentMessages[existingMsgIdx].plan,
              isStreaming: m.isStreaming ?? false,
            };
          } else {
            currentTurn.agentMessages.push(m);
          }
        }
      }
    });

    // Distribute logs strictly to the turn during which they executed (per-turn traceability)
    if (result.length > 0) {
      result[result.length - 1].isLatest = true;

      // Pre-compute turn start timestamps for chronological window assignment
      const turnWindows = result.map((turn, idx) => {
        const startTime = turn.userMessage?.created_at
          ? new Date(turn.userMessage.created_at).getTime()
          : (task.created_at ? new Date(task.created_at).getTime() : 0);
        return { idx, turn, startTime };
      });

      allLogs.forEach((log) => {
        // Direct matching if log has a message_id or turn_id
        if ((log as any).message_id) {
          const matchedTurn = result.find((t) => t.userMessage?.id === (log as any).message_id);
          if (matchedTurn) {
            matchedTurn.logs.push(log);
            return;
          }
        }

        const logTime = log.created_at ? new Date(log.created_at).getTime() : 0;
        if (!logTime || turnWindows.length === 1) {
          result[result.length - 1].logs.push(log);
          return;
        }

        // Locate the active turn window for this log
        let targetTurnIdx = 0;
        for (let i = 0; i < turnWindows.length; i++) {
          if (logTime >= turnWindows[i].startTime) {
            targetTurnIdx = i;
          } else {
            break;
          }
        }
        result[targetTurnIdx].logs.push(log);
      });

      // Attach plan to each turn (live task.plan prioritized for active/latest turn)
      result.forEach((turn, idx) => {
        const isLatestTurn = idx === result.length - 1;
        const msgWithPlan = turn.agentMessages.find((m) => !!m.plan);

        if (isLatestTurn && task.plan) {
          // If the latest turn is waiting for its own new plan to be generated
          // (i.e. it only has an optimistic user message or is in initial running state, with 0 agent messages and 0 logs)
          // and task.plan is an already completed historical plan, attribute task.plan to the preceding turn.
          const isFreshTurnWaiting = turn.agentMessages.length === 0 && turn.logs.length === 0 && (turn.userMessage?.isOptimistic || task.status === 'RUNNING');
          const planCompleted = task.plan.evaluation && task.plan.evaluation.status !== 'pending' && task.plan.evaluation.status !== 'ready_for_review';

          if (isFreshTurnWaiting && planCompleted && result.length > 1) {
            // Attribute the completed plan to the preceding turn that actually ran it
            if (!result[result.length - 2].plan) {
              result[result.length - 2].plan = task.plan;
            }
            turn.plan = msgWithPlan?.plan || null;
          } else {
            // Live active turn receives real-time task.plan with advancing step statuses
            turn.plan = task.plan;
          }
        } else if (msgWithPlan?.plan) {
          turn.plan = msgWithPlan.plan;
        }
      });
    }

    return result;
  }, [task]);

  // Global Escape key listener to stop running task
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isRunning) {
        if (onStopTask) {
          e.preventDefault();
          onStopTask();
        }
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isRunning, onStopTask]);

  // Scroll to bottom helper
  const scrollToBottom = useCallback((smooth = true) => {
    const container = scrollContainerRef.current;
    if (!container) return;
    isAutoScrollEnabledRef.current = true;
    updateShowScrollBottomBtn(false);
    if (smooth) {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    } else {
      container.scrollTop = container.scrollHeight;
    }
  }, [updateShowScrollBottomBtn]);

  // Handle user manual scroll: coalesce layout reads once per animation frame
  const handleScroll = useCallback(() => {
    if (userScrollRafRef.current !== null) return;
    userScrollRafRef.current = requestAnimationFrame(() => {
      userScrollRafRef.current = null;
      const container = scrollContainerRef.current;
      if (!container) return;
      const { scrollTop, scrollHeight, clientHeight } = container;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      const isAtBottom = distanceFromBottom <= 40;

      if (isAtBottom) {
        isAutoScrollEnabledRef.current = true;
        updateShowScrollBottomBtn(false);
      } else {
        updateShowScrollBottomBtn(true);
      }
    });
  }, [updateShowScrollBottomBtn]);

  // Attach native passive wheel & touchmove listeners so GPU compositor never blocks on JS
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const onPassiveWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) {
        isAutoScrollEnabledRef.current = false;
        updateShowScrollBottomBtn(true);
        if (scrollRafRef.current) {
          cancelAnimationFrame(scrollRafRef.current);
          scrollRafRef.current = null;
        }
      }
    };

    const onPassiveTouchMove = () => {
      handleScroll();
    };

    container.addEventListener('wheel', onPassiveWheel, { passive: true });
    container.addEventListener('touchmove', onPassiveTouchMove, { passive: true });

    const ro = new ResizeObserver(() => {
      if (isAutoScrollEnabledRef.current && isRunningRef.current) {
        container.scrollTop = container.scrollHeight - container.clientHeight;
        updateShowScrollBottomBtn(false);
      }
    });
    ro.observe(container);

    return () => {
      container.removeEventListener('wheel', onPassiveWheel);
      container.removeEventListener('touchmove', onPassiveTouchMove);
      ro.disconnect();
      if (userScrollRafRef.current !== null) {
        cancelAnimationFrame(userScrollRafRef.current);
        userScrollRafRef.current = null;
      }
    };
  }, [task?.id, handleScroll, updateShowScrollBottomBtn]);

  // Auto-scroll smoothly ONLY when user has not manually scrolled away
  useEffect(() => {
    if (!isAutoScrollEnabledRef.current || !scrollContainerRef.current) return;

    if (scrollRafRef.current) {
      cancelAnimationFrame(scrollRafRef.current);
    }

    scrollRafRef.current = requestAnimationFrame(() => {
      const container = scrollContainerRef.current;
      if (!container || !isAutoScrollEnabledRef.current) return;

      const targetScrollTop = container.scrollHeight - container.clientHeight;
      if (targetScrollTop <= 0) return;

      const distance = Math.abs(targetScrollTop - container.scrollTop);

      // Avoid layout thrashing if already within 2px of target
      if (distance <= 2) return;

      container.scrollTop = targetScrollTop;
    });

    return () => {
      if (scrollRafRef.current) {
        cancelAnimationFrame(scrollRafRef.current);
      }
    };
  }, [turns, isRunning, task?.approvals, task?.active_tool]);

  // Reset scroll and re-enable auto-scroll when task changes
  useEffect(() => {
    if (task?.id) {
      isAutoScrollEnabledRef.current = true;
      updateShowScrollBottomBtn(false);
      scrollToBottom(false);
    }
  }, [task?.id, scrollToBottom, updateShowScrollBottomBtn]);

  const emptyStateTextareaRef = useRef<HTMLTextAreaElement>(null);
  const emptyStateBackdropRef = useRef<HTMLDivElement>(null);
  const chatBackdropRef = useRef<HTMLDivElement>(null);
  const mentionMenuRef = useRef<HTMLDivElement>(null);
  const mentionItemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const adjustTextareaHeight = useCallback(() => {
    const adjust = (el: HTMLTextAreaElement | null, minH = 36, maxH = 220) => {
      if (!el) return;
      el.style.height = 'auto';
      const scrollHeight = el.scrollHeight;
      const targetHeight = Math.min(Math.max(scrollHeight, minH), maxH);
      el.style.height = `${targetHeight}px`;
    };

    if (task) {
      adjust(textareaRef.current, 36, 220);
    } else {
      adjust(emptyStateTextareaRef.current, 72, 240);
    }
  }, [task]);

  useEffect(() => {
    adjustTextareaHeight();
  }, [inputValue, adjustTextareaHeight]);

  const handleTurnResetClick = useCallback((turnIndex: number, turnData: ConversationTurn) => {
    if (!onResetTurn) return;
    const rawPrompt = turnData.userMessage?.content || (turnIndex === 1 ? task?.description : '') || '';
    const sanitizedPrompt = rawPrompt
      ? (parseUserMessageAttachments(rawPrompt, task?.id).cleanedText.trim() || rawPrompt.trim())
      : '';

    if (sanitizedPrompt) {
      setInputValue(sanitizedPrompt);
      setTimeout(() => {
        const activeTextarea = (!task ? emptyStateTextareaRef.current : textareaRef.current) || textareaRef.current;
        if (activeTextarea) {
          activeTextarea.focus();
          activeTextarea.selectionStart = activeTextarea.selectionEnd = sanitizedPrompt.length;
        }
      }, 50);
    }

    onResetTurn(turnIndex, sanitizedPrompt);
  }, [onResetTurn, task?.description, task?.id, setInputValue]);

  const fetchRepos = useCallback(async () => {
    const apiBase = import.meta.env.VITE_API_URL || '';
    const endpoints = [
      apiBase ? `${apiBase}/api/repositories` : null,
      '/api/repositories',
      'http://localhost:8000/api/repositories',
      'http://127.0.0.1:8000/api/repositories'
    ].filter(Boolean) as string[];
    for (const url of endpoints) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) {
            setLocalRepos(data);
            return;
          }
        }
      } catch {
        // try next endpoint
      }
    }
  }, []);

  useEffect(() => {
    if (!propRepositories || propRepositories.length === 0) {
      fetchRepos();
    }
  }, [fetchRepos, propRepositories]);

  const effectiveRepos = useMemo(() => {
    const repos = (propRepositories && propRepositories.length > 0) ? propRepositories : localRepos;
    if (repos && repos.length > 0) {
      return repos.filter(r => !r.id?.startsWith('starter-') && !r.full_name?.startsWith('acme/'));
    }
    return [];
  }, [propRepositories, localRepos]);

  const filteredRepos = useMemo(() => {
    if (mentionQuery === null) return [];
    if (!mentionQuery) return effectiveRepos;
    const q = mentionQuery.toLowerCase();
    return effectiveRepos.filter((r) =>
      (r.name && r.name.toLowerCase().includes(q)) ||
      (r.full_name && r.full_name.toLowerCase().includes(q))
    );
  }, [effectiveRepos, mentionQuery]);

  useEffect(() => {
    setSelectedMentionIdx(0);
  }, [mentionQuery]);

  useEffect(() => {
    if (filteredRepos.length > 0 && selectedMentionIdx >= filteredRepos.length) {
      setSelectedMentionIdx(filteredRepos.length - 1);
    }
  }, [filteredRepos.length, selectedMentionIdx]);

  useEffect(() => {
    if (mentionQuery !== null && mentionItemRefs.current[selectedMentionIdx]) {
      mentionItemRefs.current[selectedMentionIdx]?.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
      });
    }
  }, [selectedMentionIdx, mentionQuery]);

  const insertMention = (repoName: string) => {
    if (mentionIndex === -1) return;
    const activeTextarea = (!task ? emptyStateTextareaRef.current : textareaRef.current) || textareaRef.current;

    const textAfterAt = inputValue.slice(mentionIndex);
    const tokenMatch = textAfterAt.match(/^@[^\s]*/);
    const tokenLen = tokenMatch ? tokenMatch[0].length : 1;
    const before = inputValue.slice(0, mentionIndex);
    const after = inputValue.slice(mentionIndex + tokenLen);
    const inserted = `${before}@${repoName} ${after}`;
    const nextPos = mentionIndex + repoName.length + 2;

    if (activeTextarea) {
      activeTextarea.value = inserted;
      activeTextarea.focus();
      activeTextarea.setSelectionRange(nextPos, nextPos);
    }
    setInputValue(inserted);
    setMentionQuery(null);
    setMentionIndex(-1);

    requestAnimationFrame(() => {
      if (activeTextarea && document.activeElement === activeTextarea) {
        activeTextarea.setSelectionRange(nextPos, nextPos);
      }
    });
  };

  const updateMentionState = (val: string, pos: number) => {
    const textBeforeCursor = val.slice(0, pos);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');

    if (lastAtIndex !== -1) {
      const isStartOrWhitespace = lastAtIndex === 0 || /\s/.test(textBeforeCursor[lastAtIndex - 1]);
      if (isStartOrWhitespace) {
        const query = textBeforeCursor.slice(lastAtIndex + 1);
        if (!/\s/.test(query)) {
          setMentionQuery(query.toLowerCase());
          setMentionIndex(lastAtIndex);
          if (effectiveRepos.length === 0) {
            fetchRepos();
          }
          return;
        }
      }
    }

    setMentionQuery(null);
    setMentionIndex(-1);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    const pos = typeof e.target.selectionStart === 'number'
      ? e.target.selectionStart
      : val.length;
    setInputValue(val);
    updateMentionState(val, pos);
  };

  const handleCursorMove = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const target = e.currentTarget;
    const val = target.value;
    const pos = typeof target.selectionStart === 'number'
      ? target.selectionStart
      : val.length;
    updateMentionState(val, pos);
  };

  const handleKeyUp = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery !== null && ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', 'Enter', 'Tab', 'Escape'].includes(e.key)) {
      return;
    }
    handleCursorMove(e);
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setMentionQuery(null);
    setMentionIndex(-1);
    const trimmed = inputValue.trim();
    const readyAttachments = attachments.filter((a) => a.status === 'ready');
    if ((!trimmed && readyAttachments.length === 0) || isSubmitting) return;

    isAutoScrollEnabledRef.current = true;
    setShowScrollBottomBtn(false);
    scrollToBottom(true);
    setIsSubmitting(true);

    let basePrompt = trimmed;
    if (!basePrompt && readyAttachments.length > 0) {
      const { folders, standaloneFiles } = groupAttachmentsByFolder(readyAttachments as any);
      if (folders.length > 0) {
        basePrompt = `Please inspect, analyze, and work with the uploaded folder${folders.length > 1 ? 's' : ''} in the workspace: ${folders.map((f) => f.rootFolder).join(', ')}.`;
      } else {
        basePrompt = `Please inspect and work with the uploaded workspace file${standaloneFiles.length > 1 ? 's' : ''}: ${standaloneFiles.map((f) => f.name).join(', ')}.`;
      }
    }

    let promptWithAttachments = basePrompt;
    if (readyAttachments.length > 0) {
      const { folders, standaloneFiles } = groupAttachmentsByFolder(readyAttachments as any);
      const notes: string[] = [];
      for (const folder of folders) {
        notes.push(`[Uploaded Workspace Folder: ${folder.rootFolder}/ (${folder.fileCount} files, ${formatBytes(folder.totalSize)})]`);
      }
      for (const f of standaloneFiles) {
        notes.push(`[Uploaded Workspace File: ${f.relativePath || (f as any).path || f.name} (${formatBytes(f.size)})]`);
      }
      promptWithAttachments = `${basePrompt}\n\n${notes.join('\n')}`;
    }

    try {
      const filesToSend = readyAttachments.map((a) => {
        if (a.relativePath) {
          (a.file as any).customRelativePath = a.relativePath;
        }
        return a.file;
      });
      if (task) {
        await onSendMessage(promptWithAttachments, selectedModel, filesToSend);
      } else if (onNewChatWithPrompt) {
        await onNewChatWithPrompt(promptWithAttachments, selectedPersona, selectedModel, filesToSend);
      }
      setInputValue('');
      setAttachments([]);
    } catch (err) {
      console.error('Error submitting message:', err);
      setIsSubmitting(false);
    }
  };

  const handleExecuteQuickAction = useCallback(async (action: QuickActionItem) => {
    if (isRunning) return;
    try {
      if (task) {
        await onSendMessage(action.prompt, selectedModel);
      } else if (onNewChatWithPrompt) {
        await onNewChatWithPrompt(action.prompt, selectedPersona, selectedModel);
      }
    } catch (err) {
      console.error('Error executing quick action:', err);
    }
  }, [isRunning, task, onSendMessage, selectedModel, onNewChatWithPrompt, selectedPersona]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery !== null) {
      if (filteredRepos.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedMentionIdx((prev) => (prev + 1) % filteredRepos.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedMentionIdx((prev) => (prev - 1 + filteredRepos.length) % filteredRepos.length);
          return;
        }
        if (e.key === 'PageDown') {
          e.preventDefault();
          setSelectedMentionIdx((prev) => Math.min(prev + 5, filteredRepos.length - 1));
          return;
        }
        if (e.key === 'PageUp') {
          e.preventDefault();
          setSelectedMentionIdx((prev) => Math.max(prev - 5, 0));
          return;
        }
        if (e.key === 'Home') {
          e.preventDefault();
          setSelectedMentionIdx(0);
          return;
        }
        if (e.key === 'End') {
          e.preventDefault();
          setSelectedMentionIdx(filteredRepos.length - 1);
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          const selected = filteredRepos[selectedMentionIdx] || filteredRepos[0];
          if (selected) {
            insertMention(selected.full_name || selected.name);
          }
          return;
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionQuery(null);
        setMentionIndex(-1);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const renderMentionMenu = (positionClasses: string) => {
    if (mentionQuery === null) return null;

    return (
      <div
        ref={mentionMenuRef}
        onMouseDown={(e) => {
          // Keep active textarea focused when interacting with menu padding, header, or scrollbar
          e.preventDefault();
        }}
        className={`absolute ${positionClasses} w-full max-w-md sm:max-w-lg max-h-64 overflow-y-auto bg-onedark-darker border border-onedark-border/90 rounded-xl shadow-2xl shadow-black/80 z-50 p-1.5 font-sans text-xs`}
      >
        <div className="px-2.5 py-1.5 text-[10px] font-semibold text-onedark-muted uppercase tracking-wider flex items-center justify-between border-b border-onedark-borderSubtle mb-1 select-none">
          <span className="flex items-center space-x-1.5">
            <span>Registered Repositories</span>
            {filteredRepos.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-onedark-surface border border-onedark-borderSubtle text-[9px] font-mono text-onedark-fg font-normal">
                {filteredRepos.length}
              </span>
            )}
          </span>
          {filteredRepos.length > 0 && (
            <span className="text-onedark-accent font-mono text-[9px]">↑↓ to navigate · ↵ select</span>
          )}
        </div>
        {filteredRepos.length === 0 ? (
          <div className="p-3 text-center space-y-1.5 text-onedark-muted">
            <p className="text-[11px]">
              {effectiveRepos.length === 0 ? 'No repositories registered in Vault' : `No repositories matching "@${mentionQuery}"`}
            </p>
            {onNavigateToRepos && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setMentionQuery(null);
                  setMentionIndex(-1);
                  onNavigateToRepos();
                }}
                className="text-xs text-onedark-accent hover:underline font-semibold cursor-pointer"
              >
                + Connect Repository in Vault
              </button>
            )}
          </div>
        ) : (
          filteredRepos.map((repo, idx) => (
            <button
              key={repo.id || repo.full_name}
              ref={(el) => {
                mentionItemRefs.current[idx] = el;
              }}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insertMention(repo.full_name || repo.name)}
              onMouseMove={() => {
                if (selectedMentionIdx !== idx) {
                  setSelectedMentionIdx(idx);
                }
              }}
              className={`w-full text-left px-2.5 py-2 rounded-lg flex items-center space-x-2.5 transition-colors cursor-pointer ${
                selectedMentionIdx === idx
                  ? 'bg-onedark-accent/20 text-onedark-accent font-medium border border-onedark-accent/30'
                  : 'text-onedark-fg hover:bg-onedark-surface/60 border border-transparent'
              }`}
            >
              <FolderGit2 className="w-3.5 h-3.5 text-onedark-folder flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-semibold truncate flex items-center space-x-1.5">
                  <span>@{repo.full_name || repo.name}</span>
                  {repo.tech_stack && repo.tech_stack.length > 0 && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-onedark-surface text-onedark-muted border border-onedark-borderSubtle">
                      {repo.tech_stack[0]}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-onedark-muted truncate">{repo.clone_url || repo.full_name}</div>
              </div>
            </button>
          ))
        )}
      </div>
    );
  };

  const handleCopyText = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const startEditing = (messageId: string, currentContent: string) => {
    setEditingMessageId(messageId);
    setEditValue(currentContent);
  };

  const cancelEditing = () => {
    setEditingMessageId(null);
    setEditValue('');
  };

  const handleSaveEdit = (messageId: string) => {
    const trimmed = editValue.trim();
    if (!trimmed) return;
    if (onEditMessage) {
      onEditMessage(messageId, trimmed);
    }
    setEditingMessageId(null);
    setEditValue('');
  };

  const starterTemplates = useMemo(() => {
    if (effectiveRepos.length > 0) {
      const primaryRepo = effectiveRepos[0];
      const repoTag = `@${primaryRepo.full_name || primaryRepo.name}`;
      return [
        {
          title: 'Audit Architecture & Security',
          description: `Analyze component architecture, dependencies, and potential security vulnerabilities in ${repoTag}.`,
          prompt: `Perform a comprehensive architectural review and dependency security audit on ${repoTag}. Highlight circular dependencies, outdated packages, and potential performance bottlenecks.`,
          persona: 'SoftwareEngineer',
          icon: ShieldCheck,
          color: 'text-onedark-accent',
          bgColor: 'bg-onedark-accent/10',
          badge: repoTag,
        },
        {
          title: 'Generate Test Coverage',
          description: `Discover untested edge cases and generate isolated test suites for ${repoTag}.`,
          prompt: `Inspect ${repoTag} for missing unit and integration test coverage. Generate resilient test cases and verify them in the sandbox.`,
          persona: 'SoftwareEngineer',
          icon: CheckCircle2,
          color: 'text-onedark-green',
          bgColor: 'bg-onedark-green/10',
          badge: repoTag,
        },
        {
          title: 'Automated Code Review',
          description: `Review recent changes or branch diffs in ${repoTag} for null safety and regressions.`,
          prompt: `Review the latest branch changes in ${repoTag}. Check edge cases, null safety, code style, and verify that test suites pass.`,
          persona: 'CodeReviewer',
          icon: GitPullRequest,
          color: 'text-onedark-purple',
          bgColor: 'bg-onedark-purple/10',
          badge: repoTag,
        },
        {
          title: 'Scaffold Feature Branch',
          description: `Design and implement a new feature branch in ${repoTag} with live sandbox preview.`,
          prompt: `Scaffold a new feature in ${repoTag}: create the required data models, backend API routes, and frontend UI components.`,
          persona: 'AppBuilder',
          icon: LayoutGrid,
          color: 'text-onedark-yellow',
          bgColor: 'bg-onedark-yellow/10',
          badge: repoTag,
        },
      ];
    }

    return [
      {
        title: 'Scaffold Fullstack App',
        description: 'Generate a modern fullstack web app with React, TypeScript, Tailwind, and FastAPI in a live preview sandbox.',
        prompt: 'Build a modern fullstack web application with React, TypeScript, Tailwind CSS, and a FastAPI backend with live preview.',
        persona: 'AppBuilder',
        icon: LayoutGrid,
        color: 'text-onedark-accent',
        bgColor: 'bg-onedark-accent/10',
        badge: 'Sandbox',
      },
      {
        title: 'Connect Remote Repository',
        description: 'Link your GitHub or GitLab repository to enable automated PR reviews, audits, and auto-patching.',
        prompt: 'Connect repository https://github.com/[owner]/[repo] and analyze the codebase architecture.',
        persona: 'SoftwareEngineer',
        action: 'connect_repo',
        icon: FolderGit2,
        color: 'text-onedark-purple',
        bgColor: 'bg-onedark-purple/10',
        badge: 'Git Integration',
      },
      {
        title: 'Diagnose & Auto-Fix Error',
        description: 'Paste an error traceback or failing test log to diagnose root cause and test fixes in an isolated sandbox.',
        prompt: 'Diagnose and fix the following error:\n\n[Paste stack trace, error log, or failing test output here]\n\nAnalyze the root cause and generate a verified fix.',
        persona: 'IssueResolver',
        icon: Bug,
        color: 'text-onedark-red',
        bgColor: 'bg-onedark-red/10',
        badge: 'Bugfixer',
      },
      {
        title: 'Algorithmic Benchmark Sandbox',
        description: 'Create an isolated workspace to prototype algorithms, test third-party libraries, or benchmark performance.',
        prompt: 'Create an isolated Python/TypeScript benchmark workspace to evaluate and compare [algorithm or library name] with unit tests.',
        persona: 'SoftwareEngineer',
        icon: Terminal,
        color: 'text-onedark-yellow',
        bgColor: 'bg-onedark-yellow/10',
        badge: 'Prototyping',
      },
    ];
  }, [effectiveRepos]);

  const personas = [
    {
      id: 'General',
      label: 'General Assistant',
      subtitle: 'Research, Q&A & general tasks',
      icon: Sparkles,
      color: 'text-onedark-yellow',
    },
    {
      id: 'SoftwareEngineer',
      label: 'Software Engineer',
      subtitle: 'Architecture, code & tests',
      icon: Code2,
      color: 'text-onedark-accent',
    },
    {
      id: 'AppBuilder',
      label: 'App Builder',
      subtitle: 'Full-stack UI & live preview',
      icon: LayoutGrid,
      color: 'text-onedark-green',
    },
    {
      id: 'CodeReviewer',
      label: 'Code Reviewer',
      subtitle: 'PR audits, diffs & security',
      icon: GitPullRequest,
      color: 'text-onedark-folder',
    },
    {
      id: 'IssueResolver',
      label: 'Issue Resolver',
      subtitle: 'Root-cause debugging & fixes',
      icon: Bug,
      color: 'text-onedark-red',
    },
    {
      id: 'APMTriage',
      label: 'APM Triage',
      subtitle: 'Telemetry, logs & latency',
      icon: Activity,
      color: 'text-onedark-yellow',
    },
  ];

  const modelOptions = [
    {
      group: 'Adaptive Orchestration',
      icon: Zap,
      color: 'text-onedark-yellow',
      models: [
        { id: 'auto', label: 'Auto Tiering (Dynamic Complexity Routing)' },
      ],
    },
    {
      group: 'Google Gemini',
      icon: Sparkles,
      color: 'text-onedark-accent',
      models: [
        { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash (Agentic Workhorse)' },
        { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash (Sub-second Agentic)' },
      ],
    },
    {
      group: 'DeepSeek AI',
      icon: Brain,
      color: 'text-onedark-accent',
      models: [
        { id: 'deepseek-flash', label: 'DeepSeek-V4.1-Flash (552B MoE / 1M Context)' },
        { id: 'deepseek-v4-pro', label: 'DeepSeek-V4-Pro (High Capacity Frontier)' },
        { id: 'deepseek-chat', label: 'DeepSeek-V3 (General Agentic)' },
        { id: 'deepseek-reasoner', label: 'DeepSeek-R1 (Hybrid CoT)' },
      ],
    },
    {
      group: 'Anthropic Claude',
      icon: Bot,
      color: 'text-onedark-yellow',
      models: [
        { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (Flagship Autonomous & Coding)' },
        { id: 'claude-fable-5-1', label: 'Claude Fable 5.1 (Mythos Frontier Long-Horizon)' },
        { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (Balanced Intelligence)' },
        { id: 'claude-3-7-sonnet', label: 'Claude 3.7 Sonnet (Hybrid Thinking)' },
        { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (Fast Sub-agents)' },
      ],
    },
    {
      group: 'OpenAI / Codex',
      icon: Cpu,
      color: 'text-onedark-green',
      models: [
        { id: 'gpt-6-astra', label: 'GPT-6 Astra (Flagship Autonomous)' },
        { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol (Complex Work)' },
        { id: 'gpt-6-sol', label: 'GPT-6 Sol (Agentic Coding)' },
        { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol (Flagship Professional)' },
        { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini (Subagents & Coding)' },
        { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex (Agentic Coding)' },
        { id: 'o3-pro', label: 'o3-pro (High-Compute Reasoning)' },
        { id: 'o3', label: 'o3 (Frontier Reasoning)' },
        { id: 'o3-mini', label: 'o3-mini (STEM Reasoning)' },
        { id: 'gpt-4.1', label: 'GPT-4.1 (Smartest General)' },
        { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini (Fast Lightweight)' },
        { id: 'gpt-4o', label: 'GPT-4o (Omni Multimodal)' },
        { id: 'gpt-4o-mini', label: 'GPT-4o Mini (Cost Efficient)' },
      ],
    },
  ];

  const getShortModelLabel = (fullLabel: string) => {
    return fullLabel.replace(/\s*\([^)]*\)\s*$/, '').trim();
  };

  const getModelSubtitle = (fullLabel: string) => {
    const match = fullLabel.match(/\(([^)]*)\)\s*$/);
    return match ? match[1].trim() : '';
  };

  const activePersonaObj = personas.find((p) => p.id === selectedPersona) || personas[0];
  const activePersonaLabel = activePersonaObj.label;
  const ActivePersonaIcon = activePersonaObj.icon;

  const activeModelGroupObj =
    modelOptions.find((g) => g.models.some((m) => m.id === selectedModel)) || modelOptions[0];
  const ActiveModelIcon = activeModelGroupObj.icon;
  const activeModelFullLabel =
    modelOptions.flatMap((g) => g.models).find((m) => m.id === selectedModel)?.label || 'Auto Tiering';
  const activeModelShortLabel = getShortModelLabel(activeModelFullLabel);

  const renderPersonaSelector = (variant: 'empty' | 'chat') => {
    const isOpen = variant === 'empty' ? showPersonaMenuEmpty : showPersonaMenuChat;
    const setIsOpen = variant === 'empty' ? setShowPersonaMenuEmpty : setShowPersonaMenuChat;
    const closeOtherMenus = () => {
      if (variant === 'empty') {
        setShowModelMenuEmpty(false);
        setShowAttachMenuEmpty(false);
      } else {
        setShowModelMenuChat(false);
        setShowAttachMenuChat(false);
        setShowRepoMenuChat(false);
      }
    };
    const menuRef = variant === 'empty' ? personaMenuEmptyRef : personaMenuChatRef;

    return (
      <div ref={menuRef} className="relative min-w-0 shrink">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            closeOtherMenus();
            setIsOpen((v) => !v);
          }}
          className={`h-7 px-2.5 rounded-lg border text-[11.5px] font-mono font-medium transition-all flex items-center space-x-1.5 cursor-pointer active:scale-[0.98] group max-w-full ${
            isOpen
              ? 'bg-onedark-surface border-onedark-accent/60 text-onedark-fgBright shadow-xs'
              : 'bg-onedark-darker/70 hover:bg-onedark-surface border-onedark-borderSubtle/80 hover:border-onedark-border text-onedark-fg hover:text-onedark-fgBright shadow-2xs'
          }`}
          title={`Persona: ${activePersonaLabel}`}
        >
          <ActivePersonaIcon className={`w-3.5 h-3.5 ${activePersonaObj.color} flex-shrink-0 group-hover:scale-110 transition-transform`} />
          <span className="truncate max-w-[140px]">{activePersonaLabel}</span>
          <ChevronDown
            className={`w-3 h-3 text-onedark-muted group-hover:text-onedark-fg transition-transform duration-150 flex-shrink-0 ${
              isOpen ? 'rotate-180 text-onedark-accent' : ''
            }`}
          />
        </button>

        {isOpen && (
          <div className="absolute left-0 bottom-full mb-1.5 w-64 rounded-xl bg-onedark-darker border border-onedark-border shadow-2xl p-1.5 z-50 flex flex-col space-y-0.5 text-xs font-sans animate-in fade-in zoom-in-95 duration-100">
            <div className="px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-onedark-muted/80 select-none">
              Agent Persona
            </div>
            {personas.map((p) => {
              const isSelected = p.id === selectedPersona;
              const ItemIcon = p.icon;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setSelectedPersona(p.id);
                    setIsOpen(false);
                  }}
                  className={`w-full px-2.5 py-1.5 text-left rounded-lg flex items-center justify-between gap-2 cursor-pointer transition-colors group/item ${
                    isSelected
                      ? 'bg-onedark-accent/15 text-onedark-fgBright font-medium'
                      : 'hover:bg-onedark-surface text-onedark-fg hover:text-onedark-fgBright'
                  }`}
                >
                  <div className="flex items-center space-x-2.5 min-w-0">
                    <div
                      className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 border transition-colors ${
                        isSelected
                          ? 'bg-onedark-darker/90 border-onedark-borderSubtle'
                          : 'bg-onedark-surface/50 border-onedark-borderSubtle/50 group-hover/item:bg-onedark-darker/80'
                      }`}
                    >
                      <ItemIcon className={`w-3.5 h-3.5 ${p.color}`} />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="truncate font-mono text-[11.5px] leading-tight">{p.label}</span>
                      <span className="truncate text-[10px] text-onedark-muted leading-tight mt-0.5">{p.subtitle}</span>
                    </div>
                  </div>
                  {isSelected && <Check className="w-3.5 h-3.5 text-onedark-accent flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderModelSelector = (variant: 'empty' | 'chat') => {
    const isOpen = variant === 'empty' ? showModelMenuEmpty : showModelMenuChat;
    const setIsOpen = variant === 'empty' ? setShowModelMenuEmpty : setShowModelMenuChat;
    const closeOtherMenus = () => {
      if (variant === 'empty') {
        setShowPersonaMenuEmpty(false);
        setShowAttachMenuEmpty(false);
      } else {
        setShowPersonaMenuChat(false);
        setShowAttachMenuChat(false);
        setShowRepoMenuChat(false);
      }
    };
    const menuRef = variant === 'empty' ? modelMenuEmptyRef : modelMenuChatRef;

    return (
      <div ref={menuRef} className="relative min-w-0 shrink">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            closeOtherMenus();
            setIsOpen((v) => !v);
          }}
          className={`h-7 px-2.5 rounded-lg border text-[11.5px] font-mono font-medium transition-all flex items-center space-x-1.5 cursor-pointer active:scale-[0.98] group max-w-full ${
            isOpen
              ? 'bg-onedark-surface border-onedark-accent/60 text-onedark-fgBright shadow-xs'
              : 'bg-onedark-darker/70 hover:bg-onedark-surface border-onedark-borderSubtle/80 hover:border-onedark-border text-onedark-fg hover:text-onedark-fgBright shadow-2xs'
          }`}
          title={`Model: ${activeModelFullLabel}`}
        >
          <ActiveModelIcon className={`w-3.5 h-3.5 ${activeModelGroupObj.color} flex-shrink-0 group-hover:scale-110 transition-transform`} />
          <span className="truncate max-w-[165px]">{activeModelShortLabel}</span>
          <ChevronDown
            className={`w-3 h-3 text-onedark-muted group-hover:text-onedark-fg transition-transform duration-150 flex-shrink-0 ${
              isOpen ? 'rotate-180 text-onedark-accent' : ''
            }`}
          />
        </button>

        {isOpen && (
          <div className="absolute left-0 bottom-full mb-1.5 w-72 max-h-80 overflow-y-auto rounded-xl bg-onedark-darker border border-onedark-border shadow-2xl p-1.5 z-50 flex flex-col space-y-1 text-xs font-sans animate-in fade-in zoom-in-95 duration-100">
            {modelOptions.map((g, gIdx) => {
              const GroupIcon = g.icon;
              return (
                <div key={g.group} className={gIdx > 0 ? 'pt-1 border-t border-onedark-borderSubtle/50' : ''}>
                  <div className="px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-onedark-muted/80 select-none flex items-center space-x-1.5">
                    <GroupIcon className={`w-3 h-3 ${g.color} flex-shrink-0`} />
                    <span>{g.group}</span>
                  </div>
                  <div className="flex flex-col space-y-0.5">
                    {g.models.map((m) => {
                      const isSelected = m.id === selectedModel;
                      const shortName = getShortModelLabel(m.label);
                      const subtitle = getModelSubtitle(m.label);
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => {
                            setSelectedModel(m.id);
                            setIsOpen(false);
                          }}
                          className={`w-full px-2.5 py-1.5 text-left rounded-lg flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-onedark-accent/15 text-onedark-fgBright font-medium'
                              : 'hover:bg-onedark-surface text-onedark-fg hover:text-onedark-fgBright'
                          }`}
                        >
                          <div className="flex items-center space-x-2 min-w-0">
                            <GroupIcon className={`w-3.5 h-3.5 flex-shrink-0 ${isSelected ? g.color : 'text-onedark-muted'}`} />
                            <div className="flex flex-col min-w-0">
                              <span className="truncate font-mono text-[11.5px] leading-tight">{shortName}</span>
                              {subtitle && (
                                <span className="truncate text-[10px] text-onedark-muted leading-tight mt-0.5">{subtitle}</span>
                              )}
                            </div>
                          </div>
                          {isSelected && <Check className="w-3.5 h-3.5 text-onedark-accent flex-shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderRepoSelector = () => {
    if (effectiveRepos.length === 0) return null;
    const mentionedRepos = effectiveRepos.filter((r) => {
      const tag = `@${r.full_name || r.name}`;
      return inputValue.includes(tag);
    });
    const firstMentioned = mentionedRepos[0];
    const shortRepoLabel = firstMentioned
      ? `@${(firstMentioned.full_name || firstMentioned.name).split('/').pop()}${mentionedRepos.length > 1 ? ` +${mentionedRepos.length - 1}` : ''}`
      : '@repo';

    return (
      <div ref={repoMenuChatRef} className="relative min-w-0 shrink">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setShowPersonaMenuChat(false);
            setShowModelMenuChat(false);
            setShowAttachMenuChat(false);
            setShowRepoMenuChat((v) => !v);
          }}
          className={`h-7 px-2.5 rounded-lg border text-[11.5px] font-mono font-medium transition-all flex items-center space-x-1.5 cursor-pointer active:scale-[0.98] group max-w-full ${
            showRepoMenuChat || mentionedRepos.length > 0
              ? 'bg-onedark-accent/15 border-onedark-accent/50 text-onedark-accent shadow-xs'
              : 'bg-onedark-darker/70 hover:bg-onedark-surface border-onedark-borderSubtle/80 hover:border-onedark-border text-onedark-muted hover:text-onedark-fgBright shadow-2xs'
          }`}
          title="Reference a registered repository (@)"
        >
          <FolderGit2 className="w-3 h-3 text-onedark-folder flex-shrink-0 group-hover:scale-110 transition-transform" />
          <span className="truncate max-w-[120px]">{shortRepoLabel}</span>
          <ChevronDown
            className={`w-3 h-3 text-onedark-muted group-hover:text-onedark-fg transition-transform duration-150 flex-shrink-0 ${
              showRepoMenuChat ? 'rotate-180 text-onedark-accent' : ''
            }`}
          />
        </button>

        {showRepoMenuChat && (
          <div className="absolute left-0 bottom-full mb-1.5 w-64 max-h-64 overflow-y-auto rounded-xl bg-onedark-darker border border-onedark-border shadow-2xl p-1.5 z-50 flex flex-col space-y-0.5 text-xs font-sans animate-in fade-in zoom-in-95 duration-100">
            <div className="px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-onedark-muted/80 select-none">
              Reference Repository
            </div>
            {effectiveRepos.map((r) => {
              const fullName = r.full_name || r.name;
              const tag = `@${fullName}`;
              const isIncluded = inputValue.includes(tag);
              return (
                <button
                  key={r.id || fullName}
                  type="button"
                  onClick={() => {
                    if (!isIncluded) {
                      setInputValue((prev) => (prev ? `${prev.trim()} ${tag} ` : `${tag} `));
                    } else {
                      setInputValue((prev) => prev.replace(tag, '').replace(/\s{2,}/g, ' ').trim());
                    }
                    setShowRepoMenuChat(false);
                    textareaRef.current?.focus();
                  }}
                  className={`w-full px-2.5 py-1.5 text-left rounded-lg flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                    isIncluded
                      ? 'bg-onedark-accent/15 text-onedark-fgBright font-medium'
                      : 'hover:bg-onedark-surface text-onedark-fg hover:text-onedark-fgBright'
                  }`}
                >
                  <div className="flex items-center space-x-2 min-w-0">
                    <FolderGit2 className="w-3.5 h-3.5 text-onedark-folder flex-shrink-0" />
                    <span className="truncate font-mono text-[11.5px]">{tag}</span>
                  </div>
                  {isIncluded && <Check className="w-3.5 h-3.5 text-onedark-accent flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const handleSelectTemplate = (item: any) => {
    if (item.action === 'connect_repo') {
      if (onNavigateToRepos) {
        onNavigateToRepos();
      }
      return;
    }

    if (item.persona) {
      setSelectedPersona(item.persona);
    }

    setInputValue(item.prompt);

    setTimeout(() => {
      if (emptyStateTextareaRef.current) {
        emptyStateTextareaRef.current.focus();
        if (item.prompt.includes('[')) {
          const start = item.prompt.indexOf('[');
          const end = item.prompt.indexOf(']') + 1;
          if (start !== -1 && end !== -1) {
            emptyStateTextareaRef.current.setSelectionRange(start, end);
          }
        }
      }
    }, 50);
  };

  const contentMaxWidth = currentPreset === 'fullscreen'
    ? 'max-w-7xl 2xl:max-w-[1750px] px-2 sm:px-6'
    : currentPreset === 'wide'
    ? 'max-w-6xl 2xl:max-w-[1500px] px-2 sm:px-4'
    : currentPreset === 'preview'
    ? 'max-w-2xl 2xl:max-w-3xl px-2 sm:px-3'
    : 'max-w-3xl xl:max-w-4xl px-2 sm:px-4';

  const userMsgMaxWidth = currentPreset === 'fullscreen'
    ? 'max-w-4xl'
    : currentPreset === 'wide'
    ? 'max-w-3xl'
    : currentPreset === 'preview'
    ? 'max-w-xl'
    : 'max-w-2xl';

  // Empty State / New Task Launcher (or cold restore when no task is cached)
  if (!task) {
    if (isLoadingSession) {
      return (
        <div className="flex flex-col h-full bg-onedark-bg relative font-sans text-onedark-fg">
          <div className="h-10 px-4 bg-onedark-darker/80 border-b border-onedark-borderSubtle/60 flex items-center justify-between text-xs text-onedark-muted select-none flex-shrink-0">
            <div className="flex items-center space-x-2">
              <Sparkles className="w-3.5 h-3.5 text-onedark-accent" />
              <span className="font-mono text-[11.5px] font-semibold text-onedark-fgBright">Restoring Session</span>
            </div>
          </div>
          <div className="flex-1 flex flex-col items-center justify-center p-6 space-y-3">
            <div className="w-10 h-10 rounded-xl bg-onedark-surface/60 border border-onedark-borderSubtle/60 flex items-center justify-center shadow-lg backdrop-blur-xs">
              <Loader2 className="w-5 h-5 text-onedark-accent animate-spin" />
            </div>
            <div className="text-center space-y-1">
              <h3 className="text-sm font-medium text-onedark-fgBright font-mono">Restoring Session</h3>
              <p className="text-xs text-onedark-muted font-sans max-w-sm">
                Loading session and workspace context...
              </p>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="flex flex-col h-full bg-onedark-bg relative font-sans text-onedark-fg overflow-y-auto">
        {/* Top Control Bar in Empty State */}
        <div className="h-10 px-4 bg-onedark-darker/80 border-b border-onedark-borderSubtle/60 flex items-center justify-between text-xs text-onedark-muted select-none flex-shrink-0">
          <div className="flex items-center space-x-2">
            <Sparkles className="w-3.5 h-3.5 text-onedark-accent" />
            <span className="font-mono text-[11.5px] font-semibold text-onedark-fgBright">New Session</span>
          </div>

          <div className="flex items-center space-x-2">
            {onSetPreset && (
              <div className="flex items-center space-x-0.5 bg-onedark-surface/40 p-0.5 rounded-lg font-mono text-[10.5px]">
                <button
                  onClick={() => onSetPreset('split')}
                  className={`px-2 py-0.5 rounded-md transition-all ${
                    currentPreset === 'split' || currentPreset === 'standard'
                      ? 'bg-onedark-surface text-onedark-fgBright font-semibold shadow-xs'
                      : 'text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/40'
                  }`}
                  title="Split Studio (Default - 48% Auxiliary Pane)"
                >
                  Split
                </button>
                <button
                  onClick={() => onSetPreset('preview')}
                  className={`px-2 py-0.5 rounded-md transition-all ${
                    currentPreset === 'preview'
                      ? 'bg-onedark-surface text-onedark-fgBright font-semibold shadow-xs'
                      : 'text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/40'
                  }`}
                  title="Preview Focus (60% Auxiliary Pane)"
                >
                  Preview
                </button>
                <button
                  onClick={() => onSetPreset('wide')}
                  className={`px-2 py-0.5 rounded-md transition-all ${
                    currentPreset === 'wide'
                      ? 'bg-onedark-surface text-onedark-fgBright font-semibold shadow-xs'
                      : 'text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/40'
                  }`}
                  title="Wide Chat (25% Auxiliary Pane)"
                >
                  Wide
                </button>
                <button
                  onClick={() => onSetPreset('fullscreen')}
                  className={`px-2 py-0.5 rounded-md transition-all ${
                    currentPreset === 'fullscreen'
                      ? 'bg-onedark-surface text-onedark-fgBright font-semibold shadow-xs'
                      : 'text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/40'
                  }`}
                  title="Zen View (Canvas only)"
                >
                  Zen
                </button>
              </div>
            )}
          </div>
        </div>

        <div className={`w-full ${contentMaxWidth} mx-auto py-12 flex flex-col justify-center flex-1 space-y-8`}>
          {/* Header Hero */}
          <div className="text-center space-y-2.5">
            <h1 className="text-3xl font-extrabold text-onedark-fgBright tracking-tight sm:text-4xl">
              What are we working on?
            </h1>
            <p className="text-sm text-onedark-muted max-w-xl mx-auto leading-relaxed">
              Ask a question, design a feature, resolve an issue, or paste a repository URL.
            </p>
          </div>

          {/* Prompt Launcher Form */}
          <form
            onSubmit={handleSubmit}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDraggingInput(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setIsDraggingInput(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setIsDraggingInput(false);
              handleAttachDropped(e.dataTransfer);
            }}
            className={`p-4 sm:p-5 rounded-2xl bg-onedark-surface/60 border border-onedark-border/80 shadow-xl shadow-black/20 backdrop-blur-xl focus-within:border-onedark-accent/60 focus-within:ring-2 focus-within:ring-onedark-accent/15 focus-within:bg-onedark-surface/80 transition-all duration-200 space-y-3 relative z-30 ${
              isDraggingInput ? 'ring-2 ring-onedark-accent border-onedark-accent bg-onedark-surface' : ''
            }`}
          >
            {/* Attachment Pills in Empty State */}
            {attachments.length > 0 && (() => {
              const { folders, standaloneFiles } = groupAttachmentsByFolder(attachments as any);
              return (
                <div className="flex items-center gap-2 overflow-x-auto py-1 px-1 flex-wrap border-b border-onedark-borderSubtle/60 pb-2.5">
                  {folders.map((folder) => (
                    <div
                      key={`folder-${folder.rootFolder}`}
                      className="flex items-center space-x-2 px-2.5 py-1.5 rounded-lg bg-onedark-darker/80 border border-onedark-yellow/30 text-xs font-mono text-onedark-fg shadow-2xs group"
                    >
                      <div className="p-1 rounded bg-onedark-yellow/15 flex items-center justify-center">
                        <Folder className="w-3.5 h-3.5 text-onedark-yellow flex-shrink-0" />
                      </div>
                      <span className="truncate max-w-[160px] font-semibold text-onedark-fgBright">{folder.rootFolder}/</span>
                      <span className="text-onedark-muted/80 text-[10.5px]">({folder.fileCount} files · {formatBytes(folder.totalSize)})</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveFolder(folder.rootFolder)}
                        className="text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/80 rounded p-0.5 cursor-pointer transition-colors ml-1"
                        title={`Remove ${folder.rootFolder}/ folder`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  {standaloneFiles.map((att) => {
                    if (att.pastedDoc) {
                      return (
                        <PastedDocPill
                          key={att.id}
                          doc={att.pastedDoc}
                          onOpenModal={(d) => handleOpenDocModal(d, false)}
                          onUnwrapDoc={handleUnwrapPastedDoc}
                          onRemoveDoc={handleRemoveAttachment}
                        />
                      );
                    }
                    const meta = getAttachmentIcon(att.name);
                    const IconComp = meta.icon;
                    return (
                      <div
                        key={att.id}
                        className="flex items-center space-x-2 px-2.5 py-1.5 rounded-lg bg-onedark-darker/80 border border-onedark-borderSubtle/80 text-xs font-mono text-onedark-fg shadow-2xs group"
                      >
                        <div className={`p-1 rounded ${meta.bg} flex items-center justify-center`}>
                          <IconComp className={`w-3.5 h-3.5 ${meta.color} flex-shrink-0`} />
                        </div>
                        <span className="truncate max-w-[160px] font-semibold text-onedark-fgBright">{att.name}</span>
                        <span className="text-onedark-muted/80 text-[10.5px]">({formatBytes(att.size)})</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveAttachment(att.id)}
                          className="text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/80 rounded p-0.5 cursor-pointer transition-colors ml-1"
                          title="Remove attachment"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            <div className="relative w-full z-20">
              {/* Highlight backdrop overlay */}
              {inputValue && (
                <div
                  ref={emptyStateBackdropRef}
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 w-full bg-transparent text-[15px] font-sans leading-relaxed p-2.5 whitespace-pre-wrap break-words overflow-y-auto select-none"
                >
                  {renderHighlightedInputText(inputValue)}
                </div>
              )}

              <textarea
                ref={emptyStateTextareaRef}
                value={inputValue}
                onChange={handleInputChange}
                onPaste={handlePaste}
                onKeyUp={handleKeyUp}
                onClick={handleCursorMove}
                onSelect={handleCursorMove}
                onKeyDown={handleKeyDown}
                onScroll={(e) => {
                  if (emptyStateBackdropRef.current) {
                    emptyStateBackdropRef.current.scrollTop = e.currentTarget.scrollTop;
                    emptyStateBackdropRef.current.scrollLeft = e.currentTarget.scrollLeft;
                  }
                }}
                placeholder="Ask a question, describe a change, paste a stack trace, or type '@' to reference a repo..."
                rows={3}
                className={`w-full bg-transparent text-[15px] placeholder-onedark-muted/60 focus:outline-none resize-none font-sans leading-relaxed p-2.5 min-h-[80px] max-h-[260px] overflow-y-auto caret-onedark-yellow ${
                  inputValue ? 'text-transparent' : 'text-onedark-fgBright'
                }`}
              />
              {/* Repository Mention Autocomplete Menu for Launcher */}
              {renderMentionMenu("bottom-full left-0 mb-2.5")}
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-onedark-borderSubtle/60 gap-2.5 flex-wrap sm:flex-nowrap">
              {/* Persona Selector, Model Selector & Attach Button */}
              <div className="flex items-center flex-wrap gap-2 min-w-0 flex-1 py-0.5">
                {renderPersonaSelector('empty')}
                {renderModelSelector('empty')}

                {/* Hidden file & folder inputs for empty state attachments */}
                <input
                  ref={chatFileInputRef}
                  type="file"
                  multiple
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      handleAttachFiles(e.target.files);
                    }
                    e.target.value = '';
                  }}
                />
                <input
                  ref={setFolderInputRef}
                  type="file"
                  // @ts-ignore
                  webkitdirectory=""
                  directory=""
                  multiple
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      handleAttachFiles(e.target.files);
                    }
                    e.target.value = '';
                  }}
                />

                {/* Attach Button with Split Option in Empty State */}
                <div ref={attachMenuEmptyRef} className="relative flex items-center">
                  <button
                    type="button"
                    onClick={() => chatFileInputRef.current?.click()}
                    className="h-7 pl-2.5 pr-2 rounded-l-lg bg-onedark-darker/70 hover:bg-onedark-surface border border-r-0 border-onedark-borderSubtle/80 hover:border-onedark-border text-[11.5px] text-onedark-fg hover:text-onedark-fgBright font-mono font-medium shadow-2xs flex-shrink-0 transition-all flex items-center space-x-1.5 cursor-pointer active:scale-95 group"
                    title="Upload files to workspace"
                  >
                    <Paperclip className="w-3 h-3 text-onedark-accent flex-shrink-0 group-hover:scale-110 transition-transform" />
                    <span>Attach</span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowPersonaMenuEmpty(false);
                      setShowModelMenuEmpty(false);
                      setShowAttachMenuEmpty((v) => !v);
                    }}
                    className="h-7 px-1.5 rounded-r-lg bg-onedark-darker/70 hover:bg-onedark-surface border border-onedark-borderSubtle/80 hover:border-onedark-border text-[11.5px] text-onedark-muted hover:text-onedark-fgBright font-mono shadow-2xs flex-shrink-0 transition-all flex items-center justify-center cursor-pointer active:scale-95 group"
                    title="Upload folder options"
                  >
                    <ChevronDown className={`w-3 h-3 text-onedark-muted group-hover:text-onedark-fgBright transition-transform duration-150 ${showAttachMenuEmpty ? 'rotate-180 text-onedark-accent' : ''}`} />
                  </button>

                  {showAttachMenuEmpty && (
                    <div 
                      className="absolute left-0 bottom-full mb-1.5 w-44 rounded-xl bg-onedark-darker border border-onedark-border shadow-2xl p-1 z-50 flex flex-col space-y-0.5 text-xs font-sans animate-in fade-in zoom-in-95 duration-100"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setShowAttachMenuEmpty(false);
                          chatFileInputRef.current?.click();
                        }}
                        className="w-full px-2.5 py-2 text-left rounded-lg hover:bg-onedark-surface text-onedark-fg hover:text-onedark-fgBright flex items-center space-x-2 cursor-pointer transition-colors"
                      >
                        <FileText className="w-3.5 h-3.5 text-onedark-accent" />
                        <span>Upload Files</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleSelectFolder}
                        className="w-full px-2.5 py-2 text-left rounded-lg hover:bg-onedark-surface text-onedark-fg hover:text-onedark-fgBright flex items-center space-x-2 cursor-pointer transition-colors"
                      >
                        <Folder className="w-3.5 h-3.5 text-onedark-yellow" />
                        <span>Upload Folder</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={(!inputValue.trim() && attachments.length === 0) || isSubmitting}
                className={`h-8 px-4 rounded-lg text-xs font-mono font-bold tracking-wide flex items-center space-x-1.5 transition-all duration-150 shadow-sm flex-shrink-0 ${
                  (!inputValue.trim() && attachments.length === 0) || isSubmitting
                    ? 'bg-onedark-surface text-onedark-muted border border-onedark-borderSubtle cursor-not-allowed select-none'
                    : 'bg-onedark-accent hover:brightness-110 active:scale-95 text-onedark-accentFg font-extrabold cursor-pointer shadow-md ring-1 ring-onedark-accent/40'
                }`}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Launching...</span>
                  </>
                ) : (
                  <>
                    <span>Run Task</span>
                    <ArrowRight className="w-3.5 h-3.5 stroke-[2.5]" />
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Auto-scrolling Repository Carousel below Input Area without heading */}
          <RepoAutoCarousel
            repos={effectiveRepos}
            inputValue={inputValue}
            onSelectRepo={(tag) => {
              if (!inputValue.includes(tag)) {
                setInputValue((prev) => prev ? `${prev.trim()} ${tag} ` : `${tag} `);
              }
              emptyStateTextareaRef.current?.focus();
            }}
            onConnectRepo={onNavigateToRepos}
          />

          {/* Starter Templates */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-2">
            {starterTemplates.map((item, idx) => {
              const Icon = item.icon;
              return (
                <button
                  key={idx}
                  onClick={() => handleSelectTemplate(item)}
                  className="p-4 rounded-xl bg-onedark-surface/30 hover:bg-onedark-surface/70 border border-onedark-borderSubtle/70 hover:border-onedark-accent/40 text-left transition-all duration-200 space-y-3 group shadow-xs hover:shadow-md hover:-translate-y-0.5 flex flex-col justify-between cursor-pointer relative overflow-hidden"
                >
                  <div className="space-y-2 w-full">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2.5 min-w-0">
                        <div className={`p-1.5 rounded-lg ${item.bgColor} ${item.color} border border-white/5 flex-shrink-0 group-hover:scale-105 transition-transform`}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <span className="text-sm font-semibold text-onedark-fgBright group-hover:text-onedark-accent transition-colors truncate">
                          {item.title}
                        </span>
                      </div>
                      {item.badge && (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-onedark-darker/60 border border-onedark-borderSubtle/60 text-onedark-muted group-hover:text-onedark-fg transition-colors flex-shrink-0">
                          {item.badge}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-onedark-muted line-clamp-2 leading-relaxed pl-0.5">
                      {item.description || item.prompt}
                    </p>
                  </div>
                  <div className="flex items-center justify-between pt-1 text-[11px] text-onedark-muted/80 group-hover:text-onedark-accent transition-colors">
                    <span className="font-mono text-[10.5px]">
                      {item.action === 'connect_repo' ? 'Open repository manager ➔' : 'Load prompt template ➔'}
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  const pendingApprovals = (task.approvals || []).filter((a) => a.status === 'PENDING');

  const currentApproval = (() => {
    if (pendingApprovals.length === 0) return null;
    if (activeApprovalId) {
      const found = pendingApprovals.find((a) => a.id === activeApprovalId);
      if (found) return found;
    }
    const mainReview = pendingApprovals.find((a) =>
      a.action_type === 'post_pull_request_review' || a.action_type === 'post_pr_review'
    );
    return mainReview || pendingApprovals[0];
  })();

  const latestApproval = currentApproval;
  const isAnyStreamActive = Boolean(
    task.messages?.some((m) => m.isStreaming) ||
    turns.some((t) => t.isLatest && (
      t.agentMessages.some((m) => m.isStreaming) ||
      t.thoughts.some((th) => th.isStreaming)
    ))
  );
  const shouldShowApproval = Boolean(
    latestApproval &&
    (latestApproval.action_type === 'user_inquiry' || (!isAnyStreamActive && !isRunning))
  );
  const latestThoughtText = turns.length > 0 && turns[turns.length - 1].thoughts.length > 0
    ? turns[turns.length - 1].thoughts[turns[turns.length - 1].thoughts.length - 1].thought
    : null;

  return (
    <div className="flex flex-col h-full bg-onedark-bg relative font-sans text-onedark-fg">
      {/* Sleek Workstation Title & Control Bar */}
      <div className="h-10 px-3 bg-onedark-darker flex items-center justify-between gap-2 z-10 select-none flex-shrink-0 min-w-0">
        {/* Left: Repo Breadcrumb, Task Title */}
        <div className="flex items-center space-x-2 min-w-0 flex-1 overflow-hidden">
          {task.repo_name && (
            <div 
              className="flex items-center space-x-1 px-2 py-0.5 rounded-md bg-onedark-surface/60 text-[11px] font-mono text-onedark-fgBright flex-shrink-0 max-w-[120px] sm:max-w-[150px] truncate"
              title={`Repository: ${task.repo_name}`}
            >
              <FolderGit2 className="w-3 h-3 text-onedark-folder flex-shrink-0" />
              <span className="truncate">{task.repo_name}</span>
            </div>
          )}

          {task.git_branch && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(task.git_branch || '');
                setCopiedBranch(true);
                setTimeout(() => setCopiedBranch(false), 2000);
              }}
              className="flex items-center space-x-1 px-2 py-0.5 rounded-md bg-onedark-surface/60 hover:bg-onedark-surface text-[11px] font-mono text-onedark-purple flex-shrink-0 max-w-[130px] sm:max-w-[170px] truncate transition-colors cursor-pointer group"
              title={`Active Git Branch: ${task.git_branch} (Click to copy)`}
            >
              <GitBranch className="w-3 h-3 text-onedark-purple flex-shrink-0" />
              <span className="truncate">{task.git_branch}</span>
              {copiedBranch ? (
                <Check className="w-2.5 h-2.5 text-onedark-green flex-shrink-0" />
              ) : (
                <Copy className="w-2.5 h-2.5 text-onedark-muted opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
              )}
            </button>
          )}

          {task.diffs && task.diffs.length > 0 && onSelectAuxTab && (
            <button
              type="button"
              onClick={() => onSelectAuxTab('changes')}
              className="flex items-center space-x-1 px-2 py-0.5 rounded-md bg-onedark-surface/60 hover:bg-onedark-surface border border-onedark-borderSubtle text-[10.5px] font-mono transition-all cursor-pointer shadow-xs active:scale-95 flex-shrink-0"
              title={`${task.diffs.length} modified file${task.diffs.length > 1 ? 's' : ''}. Click to inspect changes`}
            >
              <GitCompare className="w-3 h-3 text-onedark-accent flex-shrink-0" />
              <span className="text-onedark-fgBright font-medium">{task.diffs.length} diff{task.diffs.length > 1 ? 's' : ''}</span>
              <span className="text-onedark-green font-bold">+{task.diffs.reduce((acc, d) => acc + (d.additions || 0), 0)}</span>
              <span className="text-onedark-red font-bold">-{task.diffs.reduce((acc, d) => acc + (d.deletions || 0), 0)}</span>
            </button>
          )}

          {isEditingTitle ? (
            <div className="flex items-center space-x-1.5 flex-1 max-w-sm">
              <input
                type="text"
                value={titleInput}
                onChange={(e) => setTitleInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleCommitTitle();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setIsEditingTitle(false);
                  }
                }}
                autoFocus
                className="bg-onedark-bg border border-onedark-accent text-xs sm:text-sm font-bold text-onedark-fgBright px-2 py-0.5 rounded outline-none w-full"
              />
              <button
                onClick={handleCommitTitle}
                className="p-1 rounded hover:bg-onedark-green/20 text-onedark-green transition-all flex-shrink-0"
                title="Save title"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setIsEditingTitle(false)}
                className="p-1 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg transition-all flex-shrink-0"
                title="Cancel"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center space-x-1.5 min-w-0 flex-1 group/title overflow-hidden">
              <h1 
                className="text-xs sm:text-sm font-bold text-onedark-fgBright truncate tracking-tight cursor-pointer hover:text-onedark-accent transition-colors" 
                title={task.title}
                onClick={handleStartEditTitle}
              >
                {task.title}
              </h1>
              {onUpdateTaskTitle && (
                <button
                  onClick={handleStartEditTitle}
                  className="opacity-0 group-hover/title:opacity-100 p-1 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg transition-all flex-shrink-0 cursor-pointer"
                  title="Rename session"
                >
                  <Pencil className="w-3 h-3" />
                </button>
              )}
              {onDeleteTask && (
                <button
                  type="button"
                  onClick={() => setIsDeleteModalOpen(true)}
                  className="opacity-0 group-hover/title:opacity-100 p-1 rounded hover:bg-onedark-red/20 text-onedark-muted hover:text-onedark-red transition-all flex-shrink-0 cursor-pointer"
                  title="Delete session"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Right: Sandbox Button & Views (Layout Presets) */}
        <div className="flex items-center space-x-1.5 flex-shrink-0">
          {/* Sandbox Inspector Button */}
          {task.sandbox_status && task.sandbox_status !== 'NONE' && (
            <button
              onClick={() => {
                if (onOpenSandboxModal) {
                  onOpenSandboxModal();
                } else {
                  setIsSandboxModalOpen(true);
                }
              }}
              className={`px-2 py-0.5 rounded-md text-[10.5px] font-mono flex items-center space-x-1.5 transition-all shadow-xs active:scale-95 cursor-pointer flex-shrink-0 ${
                task.sandbox_status === 'ACTIVE'
                  ? 'bg-onedark-green/10 text-onedark-green hover:bg-onedark-green/20'
                  : task.sandbox_status === 'PROVISIONING'
                  ? 'bg-onedark-yellow/10 text-onedark-yellow hover:bg-onedark-yellow/20'
                  : task.sandbox_status === 'AUTH_REQUIRED'
                  ? 'bg-onedark-accent/10 text-onedark-accent hover:bg-onedark-accent/20'
                  : 'bg-onedark-surface/60 text-onedark-muted hover:bg-onedark-surface hover:text-onedark-fg'
              }`}
              title="Inspect Sandbox Environment & Filesystem"
            >
              <Box className="w-3 h-3 flex-shrink-0" />
              <span>Sandbox: {task.sandbox_status === 'DESTROYED' ? 'Destroyed' : task.sandbox_status.toLowerCase()} ↗</span>
            </button>
          )}

          {/* Presets (Views) */}
          {onSetPreset && (
            <div className="flex items-center space-x-0.5 bg-onedark-surface/40 p-0.5 rounded-lg font-mono text-[10.5px] flex-shrink-0">
              <button
                onClick={() => onSetPreset('split')}
                className={`px-2 py-0.5 rounded-md transition-all ${
                  currentPreset === 'split' || currentPreset === 'standard'
                    ? 'bg-onedark-surface text-onedark-fgBright font-semibold shadow-xs'
                    : 'text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/40'
                }`}
                title="Split Studio (Default - 48% Auxiliary Pane)"
              >
                Split
              </button>
              <button
                onClick={() => onSetPreset('preview')}
                className={`px-2 py-0.5 rounded-md transition-all ${
                  currentPreset === 'preview'
                    ? 'bg-onedark-surface text-onedark-fgBright font-semibold shadow-xs'
                    : 'text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/40'
                }`}
                title="Preview Focus (60% Auxiliary Pane)"
              >
                Preview
              </button>
              <button
                onClick={() => onSetPreset('wide')}
                className={`px-2 py-0.5 rounded-md transition-all ${
                  currentPreset === 'wide'
                    ? 'bg-onedark-surface text-onedark-fgBright font-semibold shadow-xs'
                    : 'text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/40'
                }`}
                title="Wide Chat (25% Auxiliary Pane)"
              >
                Wide
              </button>
              <button
                onClick={() => onSetPreset('fullscreen')}
                className={`px-2 py-0.5 rounded-md transition-all ${
                  currentPreset === 'fullscreen'
                    ? 'bg-onedark-surface text-onedark-fgBright font-semibold shadow-xs'
                    : 'text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/40'
                }`}
                title="Zen View (Full Canvas)"
              >
                Zen
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Centralized Conversation Feed */}
      <div 
        ref={scrollContainerRef} 
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-6 relative [overflow-anchor:none] chat-scroll-viewport"
      >
        <div className={`w-full ${contentMaxWidth} mx-auto space-y-6`}>
          {turns.map((turn, tIdx) => {
            const isTurnRunning = isRunning && turn.isLatest && (turn.agentMessages.length === 0 || (turn.agentMessages.length === 1 && !turn.agentMessages[0].content));
            const isTurnOpen = Boolean(openThoughts[turn.id]);
            const isActOpen = Boolean(userToggledActivities[turn.id]);
            const hasThoughts = turn.thoughts.length > 0;
            const hasLogs = turn.logs.length > 0 || (isRunning && turn.isLatest && !!task?.active_tool);
            const hasPlan = !!turn.plan && turn.plan.steps && turn.plan.steps.length > 0;
            const isPlanOpen = userToggledPlans[turn.id] !== undefined 
              ? userToggledPlans[turn.id] 
              : (isTurnRunning && turn.isLatest);

            const completedSteps = turn.plan?.steps?.filter((s) => s.status === 'completed').length || 0;
            const totalSteps = turn.plan?.steps?.length || 0;
            const evalStatus = turn.plan?.evaluation?.status || 'pending';
            const shouldContainTurn = !turn.isLatest && editingMessageId !== turn.userMessage?.id;

            return (
              <div key={turn.id || tIdx} className={`space-y-4 ${shouldContainTurn ? 'chat-turn-contained' : ''}`}>
                {/* 1. User Message Block (with Input Token Metric) */}
                {turn.userMessage && (
                  <div className="flex justify-end group">
                    {editingMessageId === turn.userMessage.id ? (
                      <div className={`w-full ${userMsgMaxWidth} p-3 rounded-2xl bg-onedark-surface border border-onedark-accent/60 shadow-lg space-y-2`}>
                        <textarea
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
                              e.preventDefault();
                              handleSaveEdit(turn.userMessage!.id);
                            } else if (e.key === 'Escape') {
                              cancelEditing();
                            }
                          }}
                          rows={3}
                          className="w-full bg-onedark-darker border border-onedark-border rounded-xl p-3 text-sm text-onedark-fgBright font-sans focus:outline-none focus:border-onedark-accent resize-none leading-relaxed"
                          autoFocus
                        />
                        <div className="flex items-center justify-between px-1">
                          <span className="text-[11px] text-onedark-muted font-mono">
                            Enter ↵ to save · Esc to cancel
                          </span>
                          <div className="flex items-center space-x-2">
                            <button
                              onClick={cancelEditing}
                              className="px-3 py-1.5 rounded-lg border border-onedark-border hover:bg-onedark-darker text-onedark-muted hover:text-onedark-fg text-xs font-medium transition-colors"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => handleSaveEdit(turn.userMessage!.id)}
                              disabled={!editValue.trim()}
                              className="px-3.5 py-1.5 rounded-lg bg-onedark-accent hover:bg-onedark-accent/90 text-onedark-accentFg font-bold text-xs transition-all disabled:opacity-30 shadow-sm active:scale-95"
                            >
                              Save & Resubmit
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className={`relative ${
                        (turn.userMessage.content.startsWith('Inbound') ||
                         turn.userMessage.content.includes('```') ||
                         turn.userMessage.content.includes('pull_request') ||
                         turn.userMessage.content.includes('Event Trigger'))
                          ? 'w-full max-w-full items-start'
                          : `${userMsgMaxWidth} items-end`
                      } flex flex-col space-y-1`}>
                        <div className="flex items-center space-x-2 mb-0.5 pr-1 text-[11px] font-mono text-onedark-muted">
                          {turn.userMessage.isOptimistic ? (
                            <span className="px-2 py-0.5 rounded-full bg-onedark-accent/10 text-onedark-accent flex items-center space-x-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-onedark-accent animate-pulse" />
                              <span>Sending...</span>
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full bg-onedark-surface/60 text-onedark-muted">
                              ~{turn.userMessage.tokens || estimateTokens(turn.userMessage.content)} tokens in
                            </span>
                          )}
                        </div>
                        <div className="px-4 py-2.5 rounded-2xl bg-onedark-surface/80 text-onedark-fgBright font-sans text-[13px] sm:text-[13.5px] leading-relaxed shadow-xs text-left w-full max-w-full overflow-hidden">
                          {(() => {
                            const { cleanedText, folders: parsedFolders, attachments: parsedAttachments } = parseUserMessageAttachments(turn.userMessage.content, task?.id);
                            const hasMedia = parsedFolders.length > 0 || parsedAttachments.length > 0;
                            return (
                              <>
                                {cleanedText && (
                                  <MarkdownRenderer
                                    content={maskSecretsInText(cleanedText)}
                                    onLinkClick={handleGlobalLinkClick}
                                  />
                                )}
                                {hasMedia && (
                                  <div className={`mt-2.5 pt-2.5 ${cleanedText ? 'border-t border-onedark-borderSubtle/50' : ''} flex flex-wrap gap-2.5`}>
                                    {/* Render Parsed Workspace Folders */}
                                    {parsedFolders.map((folder, fIdx) => (
                                      <div
                                        key={`folder-${fIdx}`}
                                        onClick={() => {
                                          if (onOpenFile) {
                                            onOpenFile(folder.path);
                                          } else if (onSelectAuxTab) {
                                            onSelectAuxTab('files');
                                          }
                                        }}
                                        className="flex items-center space-x-3 px-3.5 py-2.5 rounded-xl bg-onedark-darker/90 hover:bg-onedark-darker border border-onedark-yellow/30 hover:border-onedark-yellow/60 text-xs font-sans text-onedark-fg shadow-md transition-all cursor-pointer group active:scale-[0.99] min-w-[240px] flex-1 max-w-md"
                                        title={`Browse ${folder.name} in Files explorer`}
                                      >
                                        <div className="p-2 rounded-lg bg-onedark-yellow/15 border border-onedark-yellow/20 flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform">
                                          <Folder className="w-4 h-4 text-onedark-yellow" />
                                        </div>
                                        <div className="flex flex-col min-w-0 pr-1 flex-1">
                                          <div className="flex items-center space-x-1.5 min-w-0">
                                            <span className="font-semibold text-onedark-fgBright truncate font-mono text-[12px] group-hover:text-onedark-yellow transition-colors">
                                              {folder.name}
                                            </span>
                                          </div>
                                          <div className="flex items-center space-x-1.5 text-[10.5px] text-onedark-muted font-mono mt-0.5">
                                            {folder.fileCount !== undefined && <span>{folder.fileCount} {folder.fileCount === 1 ? 'file' : 'files'}</span>}
                                            {folder.fileCount !== undefined && folder.sizeStr && <span>·</span>}
                                            {folder.sizeStr && <span>{folder.sizeStr}</span>}
                                            <span>·</span>
                                            <span className="text-onedark-yellow/90 font-medium">Folder</span>
                                          </div>
                                        </div>
                                        <div className="px-2 py-1 rounded-md bg-onedark-surface hover:bg-onedark-surfaceHighlight text-[11px] font-mono text-onedark-muted group-hover:text-onedark-fg transition-colors flex items-center space-x-1 flex-shrink-0">
                                          <FolderOpen className="w-3 h-3 text-onedark-yellow" />
                                          <span>Browse</span>
                                        </div>
                                      </div>
                                    ))}

                                    {/* Render Parsed Workspace Files & Attachments */}
                                    {parsedAttachments.map((att, attIdx) => {
                                      const ext = att.name.toLowerCase();
                                      const isDoc = /\.(pdf|docx?|epub|markdown|md|txt)$/i.test(ext);

                                      const handleOpenAttachment = () => {
                                        if (isDoc) {
                                          if (onOpenDoc && att.rawUrl) {
                                            onOpenDoc({ url: att.rawUrl, title: att.name });
                                          } else if (onSelectAuxTab) {
                                            onSelectAuxTab('docs');
                                          }
                                        } else {
                                          if (onOpenFile) {
                                            onOpenFile(att.path);
                                          } else if (onSelectAuxTab) {
                                            onSelectAuxTab('files');
                                          }
                                        }
                                      };

                                      if (att.category === 'image') {
                                        return (
                                          <AttachmentImagePreview
                                            key={attIdx}
                                            att={att}
                                            onOpenLightbox={() => {
                                              if (att.rawUrl) {
                                                setLightboxImage({ url: att.rawUrl, name: att.name, sizeStr: att.sizeStr });
                                                setLightboxZoom(1);
                                                setLightboxRotation(0);
                                              }
                                            }}
                                            onViewRight={handleOpenAttachment}
                                          />
                                        );
                                      }

                                      const cachedDoc = localPastedDocs.get(att.name);
                                      if (cachedDoc) {
                                        const previewLines = cachedDoc.content.split(/\r?\n/).slice(0, 3).join('\n');
                                        return (
                                          <div
                                            key={attIdx}
                                            className="flex flex-col rounded-xl bg-onedark-darker/90 border border-onedark-accent/30 hover:border-onedark-accent/70 text-xs font-sans text-onedark-fg shadow-md transition-all min-w-[280px] flex-1 max-w-md overflow-hidden group cursor-pointer"
                                            onClick={() => handleOpenDocModal(cachedDoc, true)}
                                          >
                                            <div className="flex items-center space-x-2.5 px-3 py-2 bg-onedark-surface/60 border-b border-onedark-borderSubtle">
                                              <div className="p-1 rounded bg-onedark-accent/15 border border-onedark-accent/25 flex items-center justify-center flex-shrink-0 text-onedark-accent">
                                                {cachedDoc.language === 'text' ? <FileText className="w-3.5 h-3.5" /> : <FileCode2 className="w-3.5 h-3.5" />}
                                              </div>
                                              <div className="flex flex-col min-w-0 flex-1">
                                                <span className="font-semibold text-onedark-fgBright truncate font-mono text-[12px] group-hover:text-onedark-accent transition-colors">
                                                  {cachedDoc.title}
                                                </span>
                                                <div className="flex items-center space-x-1.5 text-[10.5px] text-onedark-muted font-mono">
                                                  <span>{cachedDoc.lineCount} lines</span>
                                                  <span>·</span>
                                                  <span>{formatBytes(cachedDoc.sizeBytes)}</span>
                                                  <span>·</span>
                                                  <span className="uppercase text-[9px] px-1 rounded bg-onedark-darker text-onedark-fg">{cachedDoc.language}</span>
                                                </div>
                                              </div>
                                              <button
                                                type="button"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  handleOpenDocModal(cachedDoc, true);
                                                }}
                                                className="px-2 py-1 rounded-md bg-onedark-surface hover:bg-onedark-surfaceHighlight text-[11px] font-mono text-onedark-accent hover:text-onedark-fgBright transition-colors flex items-center space-x-1 flex-shrink-0 cursor-pointer"
                                                title="Inspect full document"
                                              >
                                                <Eye className="w-3 h-3" />
                                                <span>View</span>
                                              </button>
                                            </div>
                                            <div className="px-3 py-2 font-mono text-[11px] text-onedark-muted bg-onedark-darker/95 relative overflow-hidden select-none">
                                              <pre className="whitespace-pre overflow-hidden leading-relaxed max-h-[60px]">
                                                {previewLines}
                                              </pre>
                                              <div className="absolute inset-x-0 bottom-0 h-5 bg-gradient-to-t from-onedark-darker to-transparent pointer-events-none" />
                                            </div>
                                          </div>
                                        );
                                      }

                                      const meta = getAttachmentIcon(att.name);
                                      const IconComp = meta.icon;

                                      return (
                                        <div
                                          key={attIdx}
                                          className="flex items-center space-x-2.5 px-3 py-2 rounded-xl bg-onedark-darker/80 border border-onedark-borderSubtle hover:border-onedark-border text-xs font-sans text-onedark-fg shadow-2xs group min-w-[220px] flex-1 max-w-sm"
                                        >
                                          <div className={`p-1.5 rounded-lg ${meta.bg} flex items-center justify-center flex-shrink-0`}>
                                            <IconComp className={`w-4 h-4 ${meta.color}`} />
                                          </div>
                                          <div className="flex flex-col min-w-0 pr-1 flex-1">
                                            <span className="font-semibold text-onedark-fgBright truncate font-mono text-[11.5px]">
                                              {att.name}
                                            </span>
                                            <div className="flex items-center space-x-1.5 text-[10.5px] text-onedark-muted font-mono">
                                              {att.sizeStr && <span>{att.sizeStr}</span>}
                                              <span>·</span>
                                              <span className="capitalize">{att.category}</span>
                                            </div>
                                          </div>
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleOpenAttachment();
                                            }}
                                            className="px-2 py-1 rounded-md bg-onedark-surface hover:bg-onedark-surfaceHighlight text-[11px] font-mono text-onedark-muted hover:text-onedark-fg transition-colors flex items-center space-x-1 ml-auto cursor-pointer flex-shrink-0"
                                            title={isDoc ? "Open in Web & Docs" : "Open in Files"}
                                          >
                                            <ExternalLink className="w-3 h-3 text-onedark-accent" />
                                            <span>View</span>
                                          </button>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </>
                            );
                          })()}
                        </div>
                        {/* Hover Action Bar */}
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center space-x-1 pr-1">
                          {onEditMessage && !isRunning && (
                            <button
                              onClick={() => startEditing(turn.userMessage!.id, turn.userMessage!.content)}
                              className="p-1 rounded-md hover:bg-onedark-surface border border-transparent hover:border-onedark-border text-onedark-muted hover:text-onedark-fgBright transition-colors"
                              title="Edit prompt"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {onRetryTask && !isRunning && (
                            <button
                              onClick={() => onRetryTask(turn.userMessage!.id)}
                              className="p-1 rounded-md hover:bg-onedark-surface border border-transparent hover:border-onedark-border text-onedark-muted hover:text-onedark-fgBright transition-colors"
                              title="Retry from here"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {onResetTurn && !isRunning && (
                            <button
                              onClick={() => handleTurnResetClick(tIdx + 1, turn)}
                              className="p-1 rounded-md hover:bg-onedark-surface border border-transparent hover:border-onedark-border text-onedark-muted hover:text-onedark-yellow transition-colors"
                              title="Reset Turn (Rollback files & context to this turn)"
                            >
                              <Undo2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => handleCopyText(turn.userMessage!.id, turn.userMessage!.content)}
                            className="p-1 rounded-md hover:bg-onedark-surface border border-transparent hover:border-onedark-border text-onedark-muted hover:text-onedark-fgBright transition-colors"
                            title="Copy prompt"
                          >
                            {copiedId === turn.userMessage.id ? (
                              <Check className="w-3.5 h-3.5 text-onedark-green" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 2. Plan / Approach Progress (Situated ABOVE Reasoning & Activity) */}
                {hasPlan ? (() => {
                  const steps = turn.plan?.steps || [];
                  const checks = turn.plan?.evaluation?.checks || [];
                  const passedChecks = checks.filter((c) => c.passed);
                  const failedChecks = checks.filter((c) => !c.passed);
                  const hasFailedStep = steps.some((s) => s.status === 'failed');
                  const activeIdx = steps.findIndex((s) => s.status === 'in_progress');
                  const currentStepNum = activeIdx >= 0 ? activeIdx + 1 : Math.min(completedSteps + 1, totalSteps);
                  const hasOverview = Boolean(
                    turn.plan?.overview &&
                    turn.plan.overview !== turn.plan.title &&
                    turn.plan.overview.length > 40
                  );

                  const formatStepLabel = (rawTitle: string) => {
                    if (!rawTitle) return { text: '', fileChips: [] as string[] };
                    const fileChips: string[] = [];
                    let cleaned = rawTitle.trim();

                    // Strip mechanical prefixes
                    cleaned = cleaned.replace(/^Execute:\s*/i, '');
                    cleaned = cleaned.replace(/^Step\s+\d+:\s*/i, '');

                    // Extract complete [Uploaded ...] tags
                    cleaned = cleaned.replace(
                      /\[Uploaded\s+(?:Workspace\s+)?(?:File|Attachment|Folder):\s*([^\]\n]+?)\]/gi,
                      (_, inner: string) => {
                        const nameOnly = inner.replace(/\s*\([\d.]+\s*(?:B|KB|MB|GB|TB|bytes?)\)\s*$/i, '').trim();
                        const base = nameOnly.split(/[/\\]/).pop() || nameOnly;
                        if (base && !fileChips.includes(base)) fileChips.push(base);
                        return '';
                      }
                    );

                    // Handle truncated trailing [Uploaded ... tag (e.g. cut off at 80 chars)
                    if (/\[Uploaded[^\]]*$/i.test(cleaned)) {
                      const partialMatch = cleaned.match(/\[Uploaded\s+(?:Workspace\s+)?(?:File|Attachment|Folder)(?::\s*([^\]\n]*))?$/i);
                      if (partialMatch && partialMatch[1]) {
                        const partialName = partialMatch[1].replace(/\s*\([\d.]*.*$/, '').trim().split(/[/\\]/).pop();
                        if (partialName && !fileChips.includes(partialName)) {
                          fileChips.push(partialName);
                        }
                      }
                      cleaned = cleaned.replace(/\s*\[Uploaded[^\]]*$/i, '').trim();
                      if (fileChips.length === 0 && turn.userMessage?.content) {
                        const parsed = parseUserMessageAttachments(turn.userMessage.content, task?.id);
                        parsed.attachments.forEach((a) => {
                          if (a.name && !fileChips.includes(a.name)) fileChips.push(a.name);
                        });
                        parsed.folders.forEach((f) => {
                          if (f.name && !fileChips.includes(f.name)) fileChips.push(f.name);
                        });
                      }
                    }

                    // Clean trailing prepositions left dangling when "[Uploaded Workspace File]" was stripped
                    if (fileChips.length > 0) {
                      cleaned = cleaned.replace(/\b(?:in|from|on|for)\s+this\s*$/i, '').trim();
                    }

                    return { text: cleaned || rawTitle, fileChips };
                  };

                  const isSynthesizingPlaceholder =
                    totalSteps === 1 &&
                    /Synthesizing dynamic execution plan/i.test(steps[0]?.title || '');

                  // Phase 1: Planning Placeholder — only show before reasoning or tool execution begins
                  if (isSynthesizingPlaceholder) {
                    if (isTurnRunning && turn.isLatest && !hasThoughts && !hasLogs) {
                      const isProvisioning = task?.sandbox_status === 'PROVISIONING';
                      return (
                        <div className="rounded-xl overflow-hidden shadow-xs bg-onedark-darker/60 border border-white/[0.08]">
                          <div className="w-full px-3.5 py-2 flex items-center justify-between text-xs font-sans text-onedark-muted select-none">
                            <div className="flex items-center space-x-2.5 min-w-0 pr-2">
                              <Loader2
                                className={`w-3.5 h-3.5 animate-spin shrink-0 ${
                                  isProvisioning ? 'text-onedark-yellow' : 'text-onedark-accent'
                                }`}
                              />
                              <span className="text-xs font-medium text-onedark-fg">
                                {isProvisioning
                                  ? 'Preparing sandbox workspace and repository…'
                                  : 'Planning approach…'}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    }
                    return null;
                  }

                  const isSingleSimpleStep =
                    totalSteps === 1 &&
                    !isSynthesizingPlaceholder &&
                    evalStatus !== 'needs_revision' &&
                    evalStatus !== 'ready_for_review' &&
                    !hasFailedStep &&
                    failedChecks.length === 0 &&
                    !hasOverview &&
                    !steps[0]?.details;

                  // Single-Step Compact Bar (No redundant 1/1 accordion or green evaluation box)
                  if (isSingleSimpleStep) {
                    const singleStep = steps[0];
                    const isStepActive = (isTurnRunning && turn.isLatest) || singleStep.status === 'in_progress';
                    const isBypassPlan = (turn.plan as any)?.requires_plan === false;

                    // When the agent bypassed planning (1-step fast-path) and is already showing live Reasoning or Actions below,
                    // don't render a redundant 1-step header while streaming.
                    if (isStepActive && isBypassPlan && (hasThoughts || hasLogs)) {
                      return null;
                    }
                    const { text: cleanSingleText, fileChips: singleChips } = formatStepLabel(singleStep.title);

                    return (
                      <div className={`rounded-xl overflow-hidden shadow-xs transition-all duration-200 ${
                        isStepActive
                          ? 'bg-onedark-darker/60 border border-white/[0.08]'
                          : 'bg-onedark-darker/40 border border-white/[0.04]'
                      }`}>
                        <div className="w-full px-3.5 py-2 flex items-center justify-between gap-3 text-xs font-sans select-none">
                          <div className="flex items-center space-x-2.5 min-w-0 flex-1">
                            {isStepActive ? (
                              <Loader2 className="w-3.5 h-3.5 text-onedark-accent animate-spin shrink-0" />
                            ) : (
                              <CheckCircle2 className="w-3.5 h-3.5 text-onedark-green/80 shrink-0" />
                            )}
                            <span className={`truncate ${isStepActive ? 'text-onedark-fgBright font-medium' : 'text-onedark-fg'}`}>
                              {cleanSingleText}
                            </span>
                            {singleChips.map((chip, cIdx) => (
                              <span
                                key={cIdx}
                                className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded-md bg-onedark-surface/70 border border-white/[0.05] text-[11px] font-mono text-onedark-fg shrink-0 max-w-[180px]"
                              >
                                <FileText className="w-2.5 h-2.5 text-onedark-accent shrink-0" />
                                <span className="truncate">{chip}</span>
                              </span>
                            ))}
                          </div>

                          <div className="flex items-center space-x-1.5 shrink-0">
                            {isStepActive ? (
                              <span className="text-[11px] text-onedark-muted font-sans">
                                Working…
                              </span>
                            ) : (
                              passedChecks.slice(0, 3).map((chk, cIdx) => (
                                <span
                                  key={cIdx}
                                  className="px-2 py-0.5 rounded-md bg-onedark-surface/50 text-onedark-muted text-[10.5px] font-sans hidden sm:inline-flex items-center"
                                >
                                  {chk.name}
                                </span>
                              ))
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  }

                  // Multi-Step Plan / Review / Diagnostic Mode
                  const isPlanActivelyRunning = isTurnRunning && turn.isLatest;
                  const activeStepObj = activeIdx >= 0 ? steps[activeIdx] : null;
                  const activeStepFormatted = activeStepObj ? formatStepLabel(activeStepObj.title) : null;
                  const showDiagnosticBox =
                    evalStatus === 'needs_revision' ||
                    evalStatus === 'ready_for_review' ||
                    failedChecks.length > 0;

                  return (
                    <div className={`rounded-xl overflow-hidden shadow-xs transition-all duration-200 ${
                      isPlanActivelyRunning
                        ? 'bg-onedark-darker/60 border border-white/[0.08]'
                        : 'bg-onedark-darker/40 hover:bg-onedark-darker/60 border border-white/[0.04]'
                    }`}>
                      <button
                        type="button"
                        onClick={() => {
                          setUserToggledPlans((prev) => ({ ...prev, [turn.id]: !isPlanOpen }));
                        }}
                        className="w-full px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs font-sans text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/30 transition-colors cursor-pointer select-none btn-tactile"
                      >
                        <div className="flex items-center space-x-2.5 min-w-0 flex-1">
                          {isPlanActivelyRunning ? (
                            <Loader2 className="w-3.5 h-3.5 text-onedark-accent animate-spin shrink-0" />
                          ) : evalStatus === 'ready_for_review' ? (
                            <Sparkles className="w-3.5 h-3.5 text-onedark-accent shrink-0" />
                          ) : evalStatus === 'needs_revision' || hasFailedStep ? (
                            <AlertCircle className="w-3.5 h-3.5 text-onedark-yellow shrink-0" />
                          ) : (
                            <CheckCircle2 className="w-3.5 h-3.5 text-onedark-green/80 shrink-0" />
                          )}

                          <span className="text-xs font-medium text-onedark-fg shrink-0">
                            {evalStatus === 'ready_for_review'
                              ? 'Plan'
                              : isPlanActivelyRunning
                              ? 'Approach'
                              : evalStatus === 'needs_revision' || hasFailedStep
                              ? 'Plan'
                              : `Completed ${totalSteps} steps`}
                          </span>

                          {isPlanActivelyRunning ? (
                            <>
                              <span className="text-[11px] text-onedark-muted font-mono shrink-0">
                                Step {currentStepNum} of {totalSteps}
                              </span>
                              {!isPlanOpen && activeStepFormatted && (
                                <span className="text-xs text-onedark-fgBright truncate pl-1 border-l border-white/[0.08]">
                                  {activeStepFormatted.text}
                                </span>
                              )}
                            </>
                          ) : evalStatus === 'ready_for_review' ? (
                            <span className="text-[11px] text-onedark-muted font-mono shrink-0">
                              · {totalSteps} {totalSteps === 1 ? 'step' : 'steps'}
                            </span>
                          ) : evalStatus === 'needs_revision' || hasFailedStep ? (
                            <span className="text-[11px] text-onedark-muted font-mono shrink-0">
                              · {completedSteps}/{totalSteps} completed
                            </span>
                          ) : null}
                        </div>

                        <div className="flex items-center space-x-2 shrink-0">
                          {evalStatus === 'ready_for_review' ? (
                            <span className="px-2 py-0.5 rounded-full bg-onedark-accent/10 text-onedark-accent text-[10.5px] font-sans font-medium flex items-center space-x-1">
                              <span>Ready for review</span>
                            </span>
                          ) : evalStatus === 'needs_revision' || hasFailedStep ? (
                            <span className="px-2 py-0.5 rounded-full bg-onedark-yellow/10 text-onedark-yellow text-[10.5px] font-sans font-medium flex items-center space-x-1">
                              <span>Needs attention</span>
                            </span>
                          ) : isPlanActivelyRunning ? (
                            <div className="flex items-center space-x-1" title={`Step ${currentStepNum} of ${totalSteps}`}>
                              {steps.map((s, idx) => (
                                <span
                                  key={s.id || idx}
                                  className={`h-1.5 rounded-full transition-all duration-300 ${
                                    s.status === 'completed'
                                      ? 'w-3 bg-onedark-green/80'
                                      : s.status === 'in_progress'
                                      ? 'w-4 bg-onedark-accent animate-pulse'
                                      : 'w-2 bg-onedark-surface'
                                  }`}
                                />
                              ))}
                            </div>
                          ) : (
                            !isPlanOpen &&
                            passedChecks.slice(0, 2).map((chk, cIdx) => (
                              <span
                                key={cIdx}
                                className="px-2 py-0.5 rounded-md bg-onedark-surface/50 text-onedark-muted text-[10.5px] font-sans hidden sm:inline-flex items-center"
                              >
                                {chk.name}
                              </span>
                            ))
                          )}

                          {isPlanOpen ? (
                            <ChevronDown className="w-4 h-4 text-onedark-muted" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-onedark-muted" />
                          )}
                        </div>
                      </button>

                      {isPlanOpen && (
                        <div className="px-3.5 py-3 border-t border-white/[0.04] space-y-3 text-xs font-sans bg-onedark-darker/40">
                          {hasOverview && (
                            <div className="p-2.5 rounded-lg bg-onedark-surface/30 text-[11.5px] font-sans text-onedark-fg leading-relaxed">
                              {turn.plan!.overview}
                            </div>
                          )}

                          {/* Fixed-Step Timeline */}
                          <div className="relative pl-6 space-y-2 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-px before:bg-onedark-borderSubtle">
                            {steps.map((step, sIdx) => {
                              const isDone = step.status === 'completed';
                              const isInProgress = step.status === 'in_progress';
                              const isFailed = step.status === 'failed';
                              const { text: stepText, fileChips } = formatStepLabel(step.title);

                              return (
                                <div
                                  key={step.id || sIdx}
                                  className="relative flex items-start space-x-2 py-0.5 text-xs font-sans transition-colors"
                                >
                                  <div className={`absolute -left-6 top-0.5 p-0.5 rounded-full bg-onedark-darker shrink-0 z-10 transition-transform duration-200 ${
                                    isDone ? 'animate-status-morph' : isInProgress ? 'scale-105' : ''
                                  }`}>
                                    {isDone ? (
                                      <CheckCircle2 className="w-3.5 h-3.5 text-onedark-green/80" />
                                    ) : isInProgress ? (
                                      <Loader2 className="w-3.5 h-3.5 text-onedark-accent animate-spin" />
                                    ) : isFailed ? (
                                      <AlertCircle className="w-3.5 h-3.5 text-onedark-red" />
                                    ) : (
                                      <Circle className="w-3.5 h-3.5 text-onedark-muted/35" />
                                    )}
                                  </div>

                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center flex-wrap gap-1.5 leading-snug">
                                      <span className="font-mono text-[11px] text-onedark-muted/70 select-none">
                                        {sIdx + 1}.
                                      </span>
                                      <span className={
                                        isInProgress
                                          ? 'font-medium text-onedark-fgBright'
                                          : isFailed
                                          ? 'text-onedark-red font-medium'
                                          : isDone
                                          ? 'text-onedark-muted'
                                          : 'text-onedark-muted/60'
                                      }>
                                        {stepText}
                                      </span>
                                      {fileChips.map((chip, cIdx) => (
                                        <span
                                          key={cIdx}
                                          className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded-md bg-onedark-surface/70 border border-white/[0.05] text-[10.5px] font-mono text-onedark-fg"
                                        >
                                          <FileText className="w-2.5 h-2.5 text-onedark-accent shrink-0" />
                                          <span className="truncate max-w-[180px]">{chip}</span>
                                        </span>
                                      ))}
                                    </div>
                                    {step.details && (
                                      <div className="text-[11px] text-onedark-muted mt-0.5 font-sans leading-normal pl-4">
                                        {step.details}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          {/* Only show callout box when review or revision/error is needed */}
                          {showDiagnosticBox && turn.plan?.evaluation && (
                            <div className={`p-2.5 rounded-lg text-xs font-sans space-y-1.5 ${
                              evalStatus === 'ready_for_review'
                                ? 'bg-onedark-accent/5 text-onedark-accent border border-onedark-accent/15'
                                : 'bg-onedark-yellow/5 text-onedark-yellow border border-onedark-yellow/15'
                            }`}>
                              {turn.plan.evaluation.summary && (
                                <p className="text-[11.5px] text-onedark-fg leading-relaxed">
                                  {turn.plan.evaluation.summary}
                                </p>
                              )}
                              {failedChecks.length > 0 && (
                                <div className="flex items-center flex-wrap gap-1.5 pt-0.5">
                                  {failedChecks.map((chk, cIdx) => (
                                    <span
                                      key={cIdx}
                                      className="px-2 py-0.5 rounded-md text-[10.5px] font-sans bg-onedark-red/10 text-onedark-red flex items-center space-x-1"
                                    >
                                      <AlertCircle className="w-2.5 h-2.5 shrink-0" />
                                      <span>{chk.name}</span>
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}

                          {/* Subtle capability tags footer when expanded and completed */}
                          {!showDiagnosticBox && passedChecks.length > 0 && (
                            <div className="pt-2 border-t border-white/[0.04] flex items-center flex-wrap gap-1.5">
                              {passedChecks.map((chk, cIdx) => (
                                <span
                                  key={cIdx}
                                  className="px-2 py-0.5 rounded-md bg-onedark-surface/40 text-onedark-muted text-[10.5px] font-sans inline-flex items-center space-x-1"
                                >
                                  <Check className="w-2.5 h-2.5 text-onedark-green/70" />
                                  <span>{chk.name}</span>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })() : (isTurnRunning && turn.isLatest && !hasThoughts && !hasLogs) ? (
                  <div className="rounded-xl overflow-hidden shadow-xs bg-onedark-darker/60 border border-white/[0.08]">
                    <div className="w-full px-3.5 py-2 flex items-center justify-between text-xs font-sans text-onedark-muted select-none">
                      <div className="flex items-center space-x-2.5 min-w-0 pr-2">
                        <Loader2
                          className={`w-3.5 h-3.5 animate-spin shrink-0 ${
                            task?.sandbox_status === 'PROVISIONING' ? 'text-onedark-yellow' : 'text-onedark-accent'
                          }`}
                        />
                        <span className="text-xs font-medium text-onedark-fg">
                          {task?.sandbox_status === 'PROVISIONING'
                            ? 'Preparing sandbox workspace and repository…'
                            : 'Planning approach…'}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : null}

                {/* 3. Reasoning Process (History Header + Latest Step Expanded) */}
                {hasThoughts && (() => {
                  const totalThoughtSteps = turn.thoughts.length;
                  const streamingThoughtIdx = isRunning
                    ? turn.thoughts.map((t) => Boolean(t.isStreaming)).lastIndexOf(true)
                    : -1;
                  const isAnyThoughtStreaming = streamingThoughtIdx >= 0;

                  return (
                    <div className="rounded-xl bg-onedark-darker/40 hover:bg-onedark-darker/60 overflow-hidden shadow-xs transition-colors border border-white/[0.04] space-y-0">
                      {/* Reasoning History Header */}
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => setOpenThoughts((prev) => ({ ...prev, [turn.id]: !isTurnOpen }))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setOpenThoughts((prev) => ({ ...prev, [turn.id]: !isTurnOpen }));
                          }
                        }}
                        className={`w-full px-3.5 py-2.5 flex items-center justify-between text-xs transition-colors cursor-pointer select-none group/thdr ${
                          isTurnOpen ? 'bg-onedark-surface/30' : 'hover:bg-onedark-surface/40'
                        }`}
                      >
                        <div className="flex items-center space-x-2.5 min-w-0 pr-2">
                          <div className="w-5 h-5 rounded-md bg-onedark-surface text-onedark-accent flex items-center justify-center flex-shrink-0">
                            <Sparkles className="w-3 h-3" />
                          </div>
                          <div className="flex items-center space-x-2 min-w-0">
                            <span className="font-mono text-[11.5px] font-medium text-onedark-fgBright truncate">
                              Reasoning process
                            </span>
                            <span className="text-[11px] text-onedark-muted font-mono">
                              ({totalThoughtSteps} step{totalThoughtSteps > 1 ? 's' : ''})
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center space-x-2 flex-shrink-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              const fullText = turn.thoughts.map((t) => t.thought).filter(Boolean).join('\n\n---\n\n');
                              if (fullText) {
                                handleCopyText(`thoughts-${turn.id}`, fullText);
                              }
                            }}
                            className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded hover:bg-onedark-surface/80 hover:text-onedark-fg text-onedark-muted transition-colors cursor-pointer"
                            title="Copy full reasoning text to clipboard"
                          >
                            {copiedId === `thoughts-${turn.id}` ? (
                              <>
                                <Check className="w-3 h-3 text-onedark-green" />
                                <span className="text-[10px] text-onedark-green font-medium">Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                <span className="text-[10px]">Copy</span>
                              </>
                            )}
                          </button>
                          <span className="flex items-center space-x-1 text-onedark-muted group-hover/thdr:text-onedark-fgBright text-[11px] font-mono transition-colors pl-1">
                            <span>{isTurnOpen ? 'Hide' : 'Show'}</span>
                            <ChevronDown
                              className={`w-3.5 h-3.5 transition-transform duration-200 ${
                                isTurnOpen ? 'rotate-180 text-onedark-accent' : 'text-onedark-muted group-hover/thdr:text-onedark-fgBright'
                              }`}
                            />
                          </span>
                        </div>
                      </div>

                      {/* Collapsed State: Latest / Current Reasoning Step Expanded by default */}
                      {!isTurnOpen && turn.thoughts.length > 0 && (() => {
                        const targetIdx = isAnyThoughtStreaming ? streamingThoughtIdx : turn.thoughts.length - 1;
                        const targetThought = turn.thoughts[targetIdx];
                        if (!targetThought) return null;
                        const isStepStreaming = Boolean(isRunning && targetThought.isStreaming);
                        const peekKey = `peek-thought-${turn.id}`;
                        const stepAnimKey = targetThought.stream_id || targetThought.id || `thought-step-${turn.id}-${targetIdx}`;
                        const isExpanded = expandedThoughtIds[peekKey] !== undefined ? expandedThoughtIds[peekKey] : true;
                        const stepPreview = getThoughtStepPreview(targetThought.thought);

                        return (
                          <div className="border-t border-white/[0.04] bg-onedark-darker/60 overflow-hidden">
                            <div key={stepAnimKey} className="animate-reasoning-slide-up">
                              <div
                                onClick={() => setExpandedThoughtIds((prev) => ({ ...prev, [peekKey]: !isExpanded }))}
                                className={`px-3.5 py-2 flex items-center justify-between text-xs font-mono cursor-pointer select-none transition-colors ${
                                  isStepStreaming
                                    ? 'bg-onedark-yellow/5 text-onedark-fgBright'
                                    : isExpanded
                                    ? 'bg-onedark-surface/30 text-onedark-fgBright'
                                    : 'hover:bg-onedark-surface/30 text-onedark-fg'
                                }`}
                              >
                                <div className="flex items-center space-x-2.5 min-w-0 pr-2">
                                  <div className={`p-1 rounded ${isStepStreaming ? 'bg-onedark-yellow/15' : 'bg-onedark-accent/10'} flex items-center justify-center flex-shrink-0`}>
                                    {isStepStreaming ? (
                                      <RefreshCw className="w-3 h-3 animate-spin text-onedark-yellow" />
                                    ) : (
                                      <Sparkles className="w-3 h-3 text-onedark-accent" />
                                    )}
                                  </div>
                                  <div className="truncate flex items-center space-x-2 text-xs">
                                    <span className={`font-semibold flex-shrink-0 ${isStepStreaming ? 'text-onedark-yellow' : 'text-onedark-accent'}`}>
                                      Step {targetIdx + 1}
                                    </span>
                                    <span className="text-onedark-fg/80 font-sans truncate">
                                      {stepPreview}
                                    </span>
                                  </div>
                                </div>

                                <div className="flex items-center space-x-2 flex-shrink-0 text-[10.5px] text-onedark-muted">
                                  {isStepStreaming ? (
                                    <span className="px-1.5 py-0.5 rounded bg-onedark-yellow/15 text-onedark-yellow text-[10px] animate-pulse">
                                      thinking...
                                    </span>
                                  ) : targetThought.tokens ? (
                                    <span className="font-mono text-onedark-muted/70">
                                      {targetThought.tokens} tokens
                                    </span>
                                  ) : null}
                                  <span className="text-onedark-muted/60">
                                    {isExpanded ? (
                                      <ChevronDown className="w-3.5 h-3.5" />
                                    ) : (
                                      <ChevronRight className="w-3.5 h-3.5" />
                                    )}
                                  </span>
                                </div>
                              </div>

                              {isExpanded && (
                                <div className="px-4 py-2.5 border-t border-white/[0.04] bg-onedark-darker/80 max-h-72 overflow-y-auto [scrollbar-width:thin]">
                                  <MarkdownRenderer
                                    content={targetThought.thought}
                                    isStreaming={isStepStreaming}
                                    onLinkClick={handleGlobalLinkClick}
                                    className="text-[13px] leading-relaxed font-sans text-onedark-fg space-y-2 [&_p]:leading-relaxed [&_p]:text-onedark-fg/90 [&_strong]:text-onedark-fgBright [&_strong]:font-semibold [&_code]:font-mono [&_code]:text-[11.5px] [&_code]:bg-onedark-surface [&_code]:text-onedark-accent [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:border [&_code]:border-onedark-borderSubtle/60 [&_a_code]:bg-transparent [&_a_code]:border-0 [&_a_code]:p-0 [&_a_code]:rounded-none [&_a_code]:shadow-none [&_pre]:my-2 [&_ul]:my-1.5 [&_ol]:my-1.5 select-text"
                                  />
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Expanded State: All Reasoning Steps */}
                      {isTurnOpen && (
                        <div className="p-1.5 border-t border-white/[0.04] space-y-0.5 bg-onedark-darker/40 overflow-hidden">
                          {turn.thoughts.map((m, idx) => {
                            const thoughtKey = m.stream_id || m.id || `thought-${turn.id}-${idx}`;
                            const isLatestStep = idx === turn.thoughts.length - 1;
                            const isStepStreaming = Boolean(isRunning && m.isStreaming);
                            const defaultExpanded = isAnyThoughtStreaming ? idx === streamingThoughtIdx : isLatestStep;
                            const isExpanded = expandedThoughtIds[thoughtKey] !== undefined ? expandedThoughtIds[thoughtKey] : defaultExpanded;
                            const stepPreview = getThoughtStepPreview(m.thought);

                            return (
                              <div key={thoughtKey} className="space-y-1 animate-reasoning-slide-up">
                                <div
                                  onClick={() => setExpandedThoughtIds((prev) => ({ ...prev, [thoughtKey]: !isExpanded }))}
                                  className={`flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs font-mono border transition-colors cursor-pointer select-none group/tstep ${
                                    isStepStreaming
                                      ? 'bg-onedark-yellow/10 text-onedark-fgBright border-onedark-yellow/30 shadow-xs'
                                      : isExpanded
                                      ? 'bg-onedark-surface/40 border-onedark-borderSubtle text-onedark-fgBright'
                                      : 'border-transparent hover:bg-onedark-surface/60 hover:border-onedark-borderSubtle hover:text-onedark-fgBright text-onedark-fg'
                                  }`}
                                >
                                  <div className="flex items-center space-x-2.5 min-w-0 pr-2">
                                    <div className={`p-1 rounded ${isStepStreaming ? 'bg-onedark-yellow/15' : 'bg-onedark-accent/10'} flex items-center justify-center flex-shrink-0`}>
                                      {isStepStreaming ? (
                                        <RefreshCw className="w-3 h-3 animate-spin text-onedark-yellow" />
                                      ) : (
                                        <Sparkles className="w-3 h-3 text-onedark-accent" />
                                      )}
                                    </div>
                                    <div className="truncate flex items-center space-x-2 text-xs">
                                      <span className={`font-semibold flex-shrink-0 ${isStepStreaming ? 'text-onedark-yellow' : 'text-onedark-accent'}`}>
                                        Step {idx + 1}
                                      </span>
                                      <span className="text-onedark-fg/80 font-sans truncate">
                                        {stepPreview}
                                      </span>
                                    </div>
                                  </div>

                                  <div className="flex items-center space-x-2 flex-shrink-0 text-[10.5px] text-onedark-muted">
                                    {isStepStreaming ? (
                                      <span className="px-1.5 py-0.5 rounded bg-onedark-yellow/15 text-onedark-yellow text-[10px] animate-pulse">
                                        thinking...
                                      </span>
                                    ) : m.tokens ? (
                                      <span className="font-mono text-onedark-muted/70">
                                        {m.tokens} tokens
                                      </span>
                                    ) : null}
                                    <span className="text-onedark-muted/60 group-hover/tstep:text-onedark-fg transition-colors">
                                      {isExpanded ? (
                                        <ChevronDown className="w-3.5 h-3.5" />
                                      ) : (
                                        <ChevronRight className="w-3.5 h-3.5" />
                                      )}
                                    </span>
                                  </div>
                                </div>

                                {isExpanded && (
                                  <div className="pl-3 pr-1 pt-0.5 pb-1">
                                    <div className="px-3.5 py-2.5 rounded-lg bg-onedark-darker/90 border border-white/[0.06] max-h-72 overflow-y-auto [scrollbar-width:thin]">
                                      <MarkdownRenderer
                                        content={m.thought}
                                        isStreaming={isStepStreaming}
                                        onLinkClick={handleGlobalLinkClick}
                                        className="text-[13px] leading-relaxed font-sans text-onedark-fg space-y-2 [&_p]:leading-relaxed [&_p]:text-onedark-fg/90 [&_strong]:text-onedark-fgBright [&_strong]:font-semibold [&_code]:font-mono [&_code]:text-[11.5px] [&_code]:bg-onedark-surface [&_code]:text-onedark-accent [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:border [&_code]:border-onedark-borderSubtle/60 [&_a_code]:bg-transparent [&_a_code]:border-0 [&_a_code]:p-0 [&_a_code]:rounded-none [&_a_code]:shadow-none [&_pre]:my-2 [&_ul]:my-1.5 [&_ol]:my-1.5 select-text"
                                      />
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* 3. Turn Workspace Activity (Inline Action Stream) */}
                {hasLogs && (() => {
                  const completedLogs = turn.logs.filter((l) => !l.isRunning);
                  const completedCount = completedLogs.length;
                  const totalDuration = completedLogs.reduce((acc, l) => acc + (l.duration_ms || 0), 0);
                  const formattedDuration = totalDuration < 1000 
                    ? `${totalDuration}ms` 
                    : `${(totalDuration / 1000).toFixed(1)}s`;

                  const editCount = turn.logs.filter((l) => l.tool_name === 'edit_file').length;
                  const runCount = turn.logs.filter((l) => l.tool_name === 'run_command').length;
                  const readCount = turn.logs.filter((l) => ['read_file', 'grep_search', 'search_code', 'search_files', 'find_symbols', 'tgrep_ast', 'list_dir'].includes(l.tool_name)).length;
                  const webCount = turn.logs.filter((l) => ['search_web', 'fetch_url'].includes(l.tool_name)).length;
                  const prCount = turn.logs.filter((l) => l.tool_name.includes('pull_request') || l.tool_name.includes('connect_repository')).length;
                  const failedCount = completedLogs.filter((l) => l.exit_code !== 0).length;
                  const totalActions = turn.logs.length + (turn.isLatest && task?.active_tool && !turn.logs.some(l => l.isRunning) ? 1 : 0);
                  const breakdownParts: string[] = [];
                  if (runCount > 0) breakdownParts.push(`${runCount} run${runCount > 1 ? 's' : ''}`);
                  if (readCount > 0) breakdownParts.push(`${readCount} read${readCount > 1 ? 's' : ''}`);
                  if (editCount > 0) breakdownParts.push(`${editCount} edit${editCount > 1 ? 's' : ''}`);
                  if (prCount > 0) breakdownParts.push(`${prCount} PR${prCount > 1 ? 's' : ''}`);
                  if (webCount > 0) breakdownParts.push(`${webCount} web`);
                  const breakdownText = breakdownParts.join(' · ');

                  return (
                    <div className="rounded-xl bg-onedark-darker/40 hover:bg-onedark-darker/60 overflow-hidden shadow-xs transition-colors space-y-0">
                      {/* Action History Header */}
                      <div
                        onClick={() => setUserToggledActivities((prev) => ({ ...prev, [turn.id]: !isActOpen }))}
                        className={`w-full px-3.5 py-2.5 flex items-center justify-between text-xs transition-colors cursor-pointer select-none group/hdr ${
                          isActOpen ? 'bg-onedark-surface/30' : 'hover:bg-onedark-surface/40'
                        }`}
                        title={breakdownText ? `${totalActions} actions: ${breakdownText}` : undefined}
                      >
                        <div className="flex items-center space-x-2.5 min-w-0 pr-2">
                          <div className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 transition-colors ${
                            failedCount > 0
                              ? 'bg-onedark-red/15 text-onedark-red'
                              : 'bg-onedark-surface text-onedark-muted group-hover/hdr:text-onedark-fgBright'
                          }`}>
                            <Zap className="w-3 h-3" />
                          </div>

                          <div className="flex items-center space-x-2 min-w-0">
                            <span className="font-mono text-[11.5px] font-medium text-onedark-fgBright truncate">
                              {completedCount > 0
                                ? `${completedCount} action${completedCount === 1 ? '' : 's'} completed in ${formattedDuration}`
                                : 'Workspace activity'}
                            </span>

                            {breakdownText && (
                              <span className="text-[10.5px] text-onedark-muted/60 font-mono hidden xl:inline truncate">
                                · {breakdownText}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center space-x-2 flex-shrink-0">
                          {/* Error count pill */}
                          {failedCount > 0 && (
                            <span className="px-2 py-0.5 rounded-full bg-onedark-red/10 text-onedark-red text-[10.5px] font-mono flex items-center space-x-1 font-medium">
                              <AlertCircle className="w-2.5 h-2.5" />
                              <span>{failedCount} error{failedCount > 1 ? 's' : ''}</span>
                            </span>
                          )}

                          {onSelectAuxTab && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onSelectAuxTab('intelligence');
                              }}
                              className="hidden md:flex items-center space-x-1 px-1.5 py-0.5 rounded text-onedark-muted hover:text-onedark-accent hover:bg-onedark-surface/40 text-[10.5px] font-mono transition-colors"
                              title="Inspect logs in Auxiliary Intelligence tab"
                            >
                              <span>Audit</span>
                              <ExternalLink className="w-2.5 h-2.5 opacity-70" />
                            </button>
                          )}

                          <span className="flex items-center space-x-1 text-onedark-muted group-hover/hdr:text-onedark-fgBright text-[11px] font-mono transition-colors pl-1">
                            <span>{isActOpen ? 'Hide' : 'Show'}</span>
                            <ChevronDown
                              className={`w-3.5 h-3.5 transition-transform duration-200 ${
                                isActOpen ? 'rotate-180 text-onedark-accent' : 'text-onedark-muted group-hover/hdr:text-onedark-fgBright'
                              }`}
                            />
                          </span>
                        </div>
                      </div>

                      {/* Collapsed State: Latest / Current Log is Expanded by default */}
                      {!isActOpen && (turn.logs.length > 0 || (isRunning && turn.isLatest && !!task?.active_tool)) && (() => {
                        const runningLog = isRunning ? [...turn.logs].reverse().find((l) => l.isRunning) : undefined;
                        const activeTaskTool = (isRunning && turn.isLatest && task?.active_tool && !runningLog) ? task.active_tool : null;
                        const targetLog = runningLog || (activeTaskTool ? null : turn.logs[turn.logs.length - 1]);
                        if (!activeTaskTool && !targetLog) return null;

                        const toolName = activeTaskTool ? activeTaskTool.tool_name : targetLog!.tool_name;
                        const toolInput = activeTaskTool ? activeTaskTool.tool_input : targetLog!.tool_input;
                        const isLogRunning = isRunning && (activeTaskTool ? true : Boolean(targetLog!.isRunning));
                        const actionInfo = getToolActionInfo(toolName, toolInput, isLogRunning);
                        const ActionIcon = actionInfo.icon;
                        const peekKey = `peek-latest-${turn.id}`;
                        const isExpanded = expandedLogIds[peekKey] !== undefined ? expandedLogIds[peekKey] : true;

                        const displayLog: TaskLog = targetLog || {
                          id: `active-${task.id}`,
                          task_id: task.id,
                          tool_name: activeTaskTool!.tool_name,
                          tool_input: activeTaskTool!.tool_input,
                          tool_output: '',
                          exit_code: 0,
                          duration_ms: 0,
                          created_at: new Date().toISOString(),
                          isRunning: isLogRunning,
                        };

                        return (
                          <div className="border-t border-white/[0.04] bg-onedark-darker/60">
                            <div
                              onClick={() => setExpandedLogIds((prev) => ({ ...prev, [peekKey]: !isExpanded }))}
                              className={`px-3.5 py-2 hover:bg-onedark-darker/80 transition-colors flex items-center justify-between text-xs font-mono cursor-pointer select-none group/peek min-h-[36px] ${
                                isLogRunning
                                  ? 'bg-onedark-accent/10 text-onedark-fgBright'
                                  : targetLog && targetLog.exit_code !== 0
                                  ? 'bg-onedark-red/10 text-onedark-red'
                                  : ''
                              }`}
                            >
                              <div className="flex items-center space-x-2.5 min-w-0 pr-2">
                                <div className={`p-1 rounded ${actionInfo.badgeBg} flex items-center justify-center flex-shrink-0`}>
                                  {isLogRunning ? (
                                    <RefreshCw className="w-3 h-3 animate-spin text-onedark-accent" />
                                  ) : (
                                    <ActionIcon className={`w-3.5 h-3.5 ${actionInfo.colorClass}`} />
                                  )}
                                </div>
                                <div className="truncate flex items-center space-x-1.5 text-xs">
                                  <span className={`font-semibold ${actionInfo.colorClass}`}>
                                    {actionInfo.verb}
                                  </span>
                                  <span className="text-onedark-fgBright font-mono truncate">
                                    {actionInfo.target}
                                  </span>
                                </div>
                              </div>

                              <div className="flex items-center space-x-2 flex-shrink-0 text-[10.5px]">
                                {isLogRunning ? (
                                  <span className="px-1.5 py-0.5 rounded bg-onedark-accent/20 text-onedark-accent animate-pulse font-medium">
                                    running...
                                  </span>
                                ) : targetLog ? (
                                  <>
                                    <span className="font-mono text-onedark-muted/70 hidden sm:inline">
                                      {targetLog.duration_ms < 1000 ? `${targetLog.duration_ms}ms` : `${(targetLog.duration_ms / 1000).toFixed(1)}s`}
                                    </span>
                                    <span
                                      className={`px-1.5 py-0.5 rounded text-[9.5px] font-mono ${
                                        targetLog.exit_code === 0
                                          ? 'bg-onedark-green/10 text-onedark-green'
                                          : 'bg-onedark-red/10 text-onedark-red'
                                      }`}
                                    >
                                      exit {targetLog.exit_code}
                                    </span>
                                  </>
                                ) : null}
                                <span className="text-onedark-muted/60 group-hover/peek:text-onedark-fg transition-colors">
                                  {isExpanded ? (
                                    <ChevronDown className="w-3.5 h-3.5" />
                                  ) : (
                                    <ChevronRight className="w-3.5 h-3.5" />
                                  )}
                                </span>
                              </div>
                            </div>

                            {/* Expanded Individual Log View */}
                            {isExpanded && (
                              <div className="px-3 pb-2 pt-0.5">
                                <FormattedLogView log={displayLog} initiallyExpanded={true} isExpanded={true} hideHeader={true} />
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* Inline Action Items Stream */}
                      {isActOpen && (() => {
                        const lastRunningIdx = isRunning ? turn.logs.map((l) => Boolean(l.isRunning)).lastIndexOf(true) : -1;
                        const isStandaloneActiveToolRunning = Boolean(isRunning && turn.isLatest && task?.active_tool && lastRunningIdx === -1);
                        return (
                        <div className="p-1.5 border-t border-white/[0.04] space-y-0.5 bg-onedark-darker/40">
                          {/* Categorized action chips summary bar in expanded view */}
                          {breakdownParts.length > 0 && (
                            <div className="px-2 py-1.5 mb-1.5 flex items-center space-x-1.5 flex-wrap gap-1 border-b border-white/[0.04] text-[10.5px] font-mono">
                              <span className="text-onedark-muted/60 text-[10px]">Breakdown:</span>
                              {editCount > 0 && (
                                <span className="px-1.5 py-0.5 rounded bg-onedark-surface/60 text-onedark-fg font-mono flex items-center space-x-1">
                                  <Pencil className="w-2.5 h-2.5 text-onedark-green" />
                                  <span>{editCount} edit{editCount > 1 ? 's' : ''}</span>
                                </span>
                              )}
                              {runCount > 0 && (
                                <span className="px-1.5 py-0.5 rounded bg-onedark-surface/60 text-onedark-fg font-mono flex items-center space-x-1">
                                  <Terminal className="w-2.5 h-2.5 text-onedark-yellow" />
                                  <span>{runCount} run{runCount > 1 ? 's' : ''}</span>
                                </span>
                              )}
                              {readCount > 0 && (
                                <span className="px-1.5 py-0.5 rounded bg-onedark-surface/60 text-onedark-fg font-mono flex items-center space-x-1">
                                  <FileCode2 className="w-2.5 h-2.5 text-onedark-accent" />
                                  <span>{readCount} read{readCount > 1 ? 's' : ''}</span>
                                </span>
                              )}
                              {webCount > 0 && (
                                <span className="px-1.5 py-0.5 rounded bg-onedark-surface/60 text-onedark-fg font-mono flex items-center space-x-1">
                                  <Globe className="w-2.5 h-2.5 text-onedark-purple" />
                                  <span>{webCount} web</span>
                                </span>
                              )}
                              {prCount > 0 && (
                                <span className="px-1.5 py-0.5 rounded bg-onedark-surface/60 text-onedark-fg font-mono flex items-center space-x-1">
                                  <GitPullRequest className="w-2.5 h-2.5 text-onedark-green" />
                                  <span>{prCount} PR</span>
                                </span>
                              )}
                            </div>
                          )}
                          {turn.logs.map((log, idx) => {
                            const logKey = (log as any).call_id || log.id || `log-${turn.id}-${idx}`;
                            const isLatestLogInTurn = idx === turn.logs.length - 1;
                            const isActionRunning = isRunning && Boolean(log.isRunning);
                            const defaultExpanded = lastRunningIdx >= 0
                              ? idx === lastRunningIdx
                              : (isLatestLogInTurn && !isStandaloneActiveToolRunning);
                            const isExpanded = expandedLogIds[logKey] !== undefined ? expandedLogIds[logKey] : defaultExpanded;
                            const actionInfo = getToolActionInfo(log.tool_name, log.tool_input, isActionRunning);
                            const ActionIcon = actionInfo.icon;

                            return (
                              <div key={logKey} className="space-y-1">
                                <div
                                  onClick={() => setExpandedLogIds((prev) => ({ ...prev, [logKey]: !isExpanded }))}
                                  className={`flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs font-mono border transition-colors cursor-pointer select-none group/action ${
                                    isActionRunning
                                      ? 'bg-onedark-accent/10 text-onedark-fgBright border-onedark-accent/30 shadow-xs'
                                      : log.exit_code !== 0
                                      ? 'bg-onedark-red/10 text-onedark-red border-onedark-red/20 hover:bg-onedark-red/15 hover:border-onedark-red/30'
                                      : isExpanded
                                      ? 'bg-onedark-surface/40 border-onedark-borderSubtle text-onedark-fgBright'
                                      : 'border-transparent hover:bg-onedark-surface/60 hover:border-onedark-borderSubtle hover:text-onedark-fgBright text-onedark-fg'
                                  }`}
                                >
                                  <div className="flex items-center space-x-2.5 min-w-0 pr-2">
                                    <div className={`p-1 rounded ${actionInfo.badgeBg} flex items-center justify-center flex-shrink-0`}>
                                      {isActionRunning ? (
                                        <RefreshCw className="w-3 h-3 animate-spin text-onedark-accent" />
                                      ) : (
                                        <ActionIcon className={`w-3.5 h-3.5 ${actionInfo.colorClass}`} />
                                      )}
                                    </div>
                                    <div className="truncate flex items-center space-x-1.5 text-xs">
                                      <span className={`font-semibold ${actionInfo.colorClass}`}>
                                        {actionInfo.verb}
                                      </span>
                                      <span className="text-onedark-fgBright font-mono truncate">
                                        {actionInfo.target}
                                      </span>
                                    </div>
                                  </div>

                                  <div className="flex items-center space-x-2 flex-shrink-0 text-[10.5px] text-onedark-muted">
                                    {isActionRunning ? (
                                      <span className="px-1.5 py-0.5 rounded bg-onedark-accent/20 text-onedark-accent text-[10px] animate-pulse">
                                        running...
                                      </span>
                                    ) : (
                                      <>
                                        <span className="font-mono text-onedark-muted/70">
                                          {log.duration_ms < 1000 ? `${log.duration_ms}ms` : `${(log.duration_ms / 1000).toFixed(1)}s`}
                                        </span>
                                        <span
                                          className={`px-1.5 py-0.5 rounded text-[9.5px] font-mono ${
                                            log.exit_code === 0
                                              ? 'bg-onedark-green/10 text-onedark-green'
                                              : 'bg-onedark-red/10 text-onedark-red'
                                          }`}
                                        >
                                          exit {log.exit_code}
                                        </span>
                                      </>
                                    )}
                                    <span className="text-onedark-muted/60 group-hover/action:text-onedark-fg transition-colors">
                                      {isExpanded ? (
                                        <ChevronDown className="w-3.5 h-3.5" />
                                      ) : (
                                        <ChevronRight className="w-3.5 h-3.5" />
                                      )}
                                    </span>
                                  </div>
                                </div>

                                {/* Expanded Individual Log */}
                                {isExpanded && (
                                  <div className="pl-3 pr-1 pt-0.5 pb-1">
                                    <FormattedLogView log={log} initiallyExpanded={true} isExpanded={true} hideHeader={true} />
                                  </div>
                                )}
                              </div>
                            );
                          })}

                          {/* Active executing tool if present in task but not yet in logs */}
                          {isStandaloneActiveToolRunning && task?.active_tool && (() => {
                            const actionInfo = getToolActionInfo(task.active_tool.tool_name, task.active_tool.tool_input, true);
                            const standaloneKey = `active-tool-${turn.id}`;
                            const isExpanded = expandedLogIds[standaloneKey] !== undefined ? expandedLogIds[standaloneKey] : true;
                            const syntheticActiveLog = {
                              id: standaloneKey,
                              task_id: task.id,
                              tool_name: task.active_tool.tool_name,
                              tool_input: task.active_tool.tool_input,
                              tool_output: '',
                              exit_code: 0,
                              duration_ms: 0,
                              created_at: new Date().toISOString(),
                              isRunning: true,
                            } as TaskLog;
                            return (
                              <div className="space-y-1">
                                <div
                                  onClick={() => setExpandedLogIds((prev) => ({ ...prev, [standaloneKey]: !isExpanded }))}
                                  className="flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs font-mono bg-onedark-accent/10 text-onedark-fgBright border border-onedark-accent/30 shadow-xs cursor-pointer select-none"
                                >
                                  <div className="flex items-center space-x-2.5 min-w-0 pr-2">
                                    <div className={`p-1 rounded ${actionInfo.badgeBg} flex items-center justify-center flex-shrink-0`}>
                                      <RefreshCw className="w-3 h-3 animate-spin text-onedark-accent" />
                                    </div>
                                    <div className="truncate flex items-center space-x-1.5 text-xs">
                                      <span className={`font-semibold ${actionInfo.colorClass}`}>
                                        {actionInfo.verb}
                                      </span>
                                      <span className="text-onedark-fgBright font-mono truncate">
                                        {actionInfo.target}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="flex items-center space-x-2 flex-shrink-0 text-[10.5px]">
                                    <span className="px-1.5 py-0.5 rounded bg-onedark-accent/20 text-onedark-accent animate-pulse">
                                      running...
                                    </span>
                                    <span className="text-onedark-muted/60">
                                      {isExpanded ? (
                                        <ChevronDown className="w-3.5 h-3.5" />
                                      ) : (
                                        <ChevronRight className="w-3.5 h-3.5" />
                                      )}
                                    </span>
                                  </div>
                                </div>
                                {isExpanded && (
                                  <div className="pl-3 pr-1 pt-0.5 pb-1">
                                    <FormattedLogView log={syntheticActiveLog} initiallyExpanded={true} isExpanded={true} hideHeader={true} />
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                        );
                      })()}
                    </div>
                  );
                })()}

                {/* 4. Live Terminal Pulsing Cursor (Shown when turn is active after plan is ready, before first agent message arrives) */}
                {isTurnRunning && hasPlan && task?.sandbox_status !== 'PROVISIONING' && turn.agentMessages.length === 0 && !task?.active_tool && !turn.logs.some((l) => l.isRunning) && !turn.thoughts.some((t) => t.isStreaming) && (
                  <div className="w-full flex flex-col items-start space-y-1.5">
                    <div className="flex items-center justify-between w-full px-0.5 text-[11px] font-mono text-onedark-muted">
                      <span className="font-sans font-medium text-onedark-fg">{task.persona}</span>
                    </div>
                    <div className="text-onedark-fg text-[13px] sm:text-[13.5px] leading-relaxed w-full flex items-center min-h-[22px]">
                      <span className="terminal-cursor" title="Generating..." />
                    </div>
                  </div>
                )}

                {/* 5. Agent Messages (with Token Output Metric) */}
                {turn.agentMessages.map((m) => {
                  const {
                    outTokens,
                    cleanedContent,
                    maskedContent,
                    quickActions,
                    isFullPlanDoc,
                    planInfo,
                  } = getProcessedAgentMessage(m, turn.plan?.intent_category);
                  const isRawPlanExpanded = !!expandedRawPlanMsgIds[m.id];

                  const handleMessageLinkClick = (url: string, text: string) => {
                    if (url.startsWith('plan://') || url === '#open-plan-doc' || url === 'action://open-plan-doc') {
                      if (onOpenPlan) {
                        onOpenPlan(task?.id, turn.plan);
                      } else if (onOpenPreview && task?.id) {
                        onOpenPreview(`plan://${task.id}`, 'Implementation Plan');
                      }
                      return;
                    }
                    if (onOpenPreview) {
                      onOpenPreview(url, text);
                    }
                  };

                  return (
                    <div
                      key={m.id}
                      className="flex items-start group justify-start w-full"
                    >
                      {m.sender === 'system' ? (
                        <SystemMessageCard
                          content={m.content}
                          isStreaming={m.isStreaming}
                          task={task}
                          onLinkClick={handleMessageLinkClick}
                        />
                      ) : (
                        <div className="w-full flex flex-col items-start space-y-1.5">
                          <div className="flex items-center justify-between w-full px-0.5 text-[11px] font-mono text-onedark-muted">
                            <span className="font-sans font-medium text-onedark-fg">{task.persona}</span>
                            <span className="px-2 py-0.5 rounded-md bg-onedark-surface/60 text-onedark-muted">
                              ~{outTokens} tokens out
                            </span>
                          </div>
                          <div className="text-onedark-fg text-[13px] sm:text-[13.5px] leading-relaxed w-full">
                            {isFullPlanDoc && planInfo ? (
                              <div className="w-full space-y-3 my-1">
                                <div className="rounded-xl border border-onedark-accent/30 bg-gradient-to-r from-onedark-accent/10 via-onedark-surface/35 to-transparent p-4 space-y-3 shadow-xs">
                                  <div className="flex items-start justify-between gap-3 flex-wrap sm:flex-nowrap">
                                    <div className="space-y-1.5 min-w-0">
                                      <div className="flex items-center space-x-2">
                                        <span className="w-2 h-2 rounded-full bg-onedark-accent animate-pulse shrink-0" />
                                        <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-onedark-accent">
                                          Implementation Plan Formulated
                                        </span>
                                      </div>
                                      <h3 className="text-sm font-semibold text-onedark-fgBright">
                                        {planInfo.title}
                                      </h3>
                                      {planInfo.overview && (
                                        <p className="text-xs text-onedark-fg/90 leading-relaxed line-clamp-3">
                                          {planInfo.overview}
                                        </p>
                                      )}
                                    </div>
                                    <div className="flex items-center space-x-2 shrink-0">
                                      {task?.diffs && task.diffs.length > 0 && onSelectAuxTab && (
                                        <button
                                          type="button"
                                          onClick={() => onSelectAuxTab('changes')}
                                          className="px-3 py-2 rounded-lg bg-onedark-surface/80 hover:bg-onedark-surface text-onedark-fgBright border border-onedark-borderSubtle font-semibold text-xs flex items-center space-x-1.5 transition-all cursor-pointer shadow-xs active:scale-[0.98]"
                                          title="Inspect live working tree changes and git diffs"
                                        >
                                          <GitCompare className="w-3.5 h-3.5 text-onedark-accent" />
                                          <span>Changes ({task.diffs.length})</span>
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => {
                                          if (onOpenPlan) {
                                            onOpenPlan(task?.id, turn.plan);
                                          } else if (onOpenPreview && task?.id) {
                                            onOpenPreview(`plan://${task.id}`, 'Implementation Plan');
                                          }
                                        }}
                                        className="shrink-0 px-3.5 py-2 rounded-lg bg-onedark-accent hover:bg-onedark-accent/90 text-onedark-accentFg font-semibold text-xs flex items-center space-x-1.5 transition-all cursor-pointer shadow-xs active:scale-[0.98]"
                                        title="Open architectural plan in Web & Docs"
                                      >
                                        <Compass className="w-3.5 h-3.5" />
                                        <span>Open Full Plan Doc</span>
                                        <ArrowRight className="w-3 h-3 ml-0.5" />
                                      </button>
                                    </div>
                                  </div>

                                  {planInfo.phases.length > 0 && (
                                    <div className="pt-2.5 border-t border-white/[0.06] space-y-2">
                                      <span className="text-[10.5px] font-mono text-onedark-muted uppercase tracking-wider">
                                        Key Execution Phases
                                      </span>
                                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-0.5">
                                        {planInfo.phases.map((ph, pIdx) => (
                                          <div key={pIdx} className="flex items-center space-x-2 px-2.5 py-1.5 rounded-md bg-onedark-surface/40 border border-onedark-borderSubtle/60 text-xs text-onedark-fg font-mono">
                                            <span className="w-1.5 h-1.5 rounded-full bg-onedark-accent shrink-0" />
                                            <span className="truncate">{ph}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  <div className="pt-1 flex items-center justify-between text-[11px] font-mono text-onedark-muted border-t border-white/[0.04]">
                                    <button
                                      type="button"
                                      onClick={() => setExpandedRawPlanMsgIds(prev => ({ ...prev, [m.id]: !prev[m.id] }))}
                                      className="hover:text-onedark-fg transition-colors flex items-center space-x-1 cursor-pointer"
                                    >
                                      <span>{isRawPlanExpanded ? 'Hide raw plan document' : 'View raw plan markdown'}</span>
                                      <ChevronRight className={`w-3 h-3 transition-transform ${isRawPlanExpanded ? 'rotate-90' : ''}`} />
                                    </button>
                                    <span>Full spec rendered in Web & Docs</span>
                                  </div>
                                </div>

                                {isRawPlanExpanded && (
                                  <div className="pt-2 pl-2 border-l-2 border-onedark-accent/30 text-xs">
                                    <MarkdownRenderer
                                      content={maskedContent}
                                      isStreaming={m.isStreaming}
                                      onLinkClick={handleMessageLinkClick}
                                    />
                                  </div>
                                )}
                              </div>
                            ) : m.content ? (
                              <MarkdownRenderer
                                content={maskedContent}
                                isStreaming={m.isStreaming}
                                onLinkClick={handleMessageLinkClick}
                              />
                            ) : m.isStreaming ? (
                              <div className="flex items-center min-h-[22px]">
                                <span className="terminal-cursor" title="Generating..." />
                              </div>
                            ) : null}
                          </div>

                          {/* Quick Action Chips */}
                          {!m.isStreaming && quickActions.length > 0 && (
                            <QuickActionChips
                              actions={quickActions}
                              disabled={isRunning}
                              onSelectAction={handleExecuteQuickAction}
                            />
                          )}

                          {/* Hover Action Bar */}
                          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center space-x-1 pl-0.5 pt-0.5">
                            <button
                              onClick={() => handleCopyText(m.id, cleanedContent)}
                              className="p-1 rounded-md hover:bg-onedark-surface border border-transparent hover:border-onedark-border text-onedark-muted hover:text-onedark-fgBright transition-colors"
                              title="Copy response"
                            >
                              {copiedId === m.id ? (
                                <Check className="w-3.5 h-3.5 text-onedark-green" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                            {onRetryTask && !isRunning && (
                              <button
                                onClick={() => onRetryTask(turn.userMessage?.id)}
                                className="p-1 rounded-md hover:bg-onedark-surface border border-transparent hover:border-onedark-border text-onedark-muted hover:text-onedark-fgBright transition-colors"
                                title="Regenerate response"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {onResetTurn && !isRunning && (
                              <button
                                onClick={() => handleTurnResetClick(tIdx + 1, turn)}
                                className="p-1 rounded-md hover:bg-onedark-surface border border-transparent hover:border-onedark-border text-onedark-muted hover:text-onedark-yellow transition-colors"
                                title="Reset Turn (Rollback files & context to this turn)"
                              >
                                <Undo2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}

          {/* Inline Session History Loading Indicator */}
          {isLoadingSession && (
            <div className="w-full max-w-md mx-auto my-6 p-3.5 rounded-xl bg-onedark-surface/40 border border-onedark-borderSubtle/60 flex items-center space-x-3 shadow-xs animate-in fade-in duration-200">
              <Loader2 className="w-4 h-4 text-onedark-accent animate-spin shrink-0" />
              <div className="text-xs min-w-0">
                <p className="font-mono font-medium text-onedark-fgBright">Restoring session history</p>
                <p className="text-[11px] text-onedark-muted truncate">Loading turns, diffs, and execution logs...</p>
              </div>
            </div>
          )}

          {/* Pending Action Approval Card or Interactive Inquiry Card or PR Review Staging Card */}
          {shouldShowApproval && latestApproval && (
            <div className="space-y-2.5">
              {/* Multi-Item Staging Bar if multiple approvals are pending */}
              {pendingApprovals.length > 1 && (
                <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 px-3 rounded-lg bg-onedark-surface/90 border border-onedark-borderSubtle text-xs shadow-sm">
                  <div className="flex items-center space-x-2 min-w-0 flex-1 overflow-hidden">
                    <span className="font-semibold text-onedark-fg flex items-center space-x-1.5 shrink-0">
                      <span className="w-2 h-2 rounded-full bg-onedark-yellow animate-pulse" />
                      <span>Staged Items ({pendingApprovals.length})</span>
                    </span>
                    <div className="flex items-center space-x-1 overflow-x-auto py-0.5 scrollbar-thin">
                      {pendingApprovals.map((appr, idx) => {
                        const isSelected = appr.id === latestApproval.id;
                        const isReview = appr.action_type.includes('review');
                        const path = appr.action_details?.path;
                        const line = appr.action_details?.line;
                        const label = isReview
                          ? 'Formal Review'
                          : (path ? `${path.split('/').pop()}:${line || ''}` : `Comment #${idx + 1}`);

                        return (
                          <button
                            key={appr.id || idx}
                            onClick={() => setActiveApprovalId(appr.id || null)}
                            className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors whitespace-nowrap cursor-pointer ${
                              isSelected
                                ? 'bg-onedark-accent text-onedark-accentFg font-bold shadow-sm'
                                : 'bg-onedark-darker text-onedark-muted hover:text-onedark-fg hover:bg-onedark-darker/80 border border-onedark-borderSubtle/40'
                            }`}
                            title={path ? `${path}:${line}` : 'PR Review'}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 shrink-0">
                    <button
                      onClick={() => onApprove && onApprove('Approve all staged items', { approve_all: true })}
                      className="px-2.5 py-1 rounded bg-onedark-green hover:bg-onedark-green/90 text-onedark-greenFg font-bold text-xs flex items-center space-x-1 shadow-sm transition-colors cursor-pointer"
                      title="Approve and submit all staged comments and review to GitHub"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Approve All ({pendingApprovals.length})</span>
                    </button>
                    <button
                      onClick={() => onReject && onReject('Dismiss all staged items', { reject_all: true })}
                      className="px-2 py-1 rounded bg-onedark-darker hover:bg-onedark-surface text-onedark-muted hover:text-onedark-red border border-onedark-borderSubtle/60 text-xs transition-colors cursor-pointer"
                      title="Dismiss all pending approvals"
                    >
                      <span>Dismiss All</span>
                    </button>
                  </div>
                </div>
              )}

              {latestApproval.action_type === 'user_inquiry' ? (
                <InquiryCard
                  taskId={task.id}
                  approval={latestApproval}
                  onResolved={() => {
                    if (onApprove) onApprove();
                  }}
                />
              ) : (latestApproval.action_type === 'post_pull_request_review' || latestApproval.action_type === 'post_pull_request_line_comment' || latestApproval.action_type === 'post_pr_review' || latestApproval.action_type === 'post_line_comment') ? (
                <PRReviewApprovalCard
                  taskId={task.id}
                  approval={latestApproval}
                  onApprove={onApprove}
                  onReject={onReject}
                />
              ) : (
                <div className="rounded-xl border border-onedark-border bg-onedark-surface p-4 space-y-3 shadow-md">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center space-x-2 text-onedark-yellow font-semibold text-xs min-w-0">
                      <ShieldAlert className="w-4 h-4 text-onedark-yellow shrink-0" />
                      <span className="truncate">Action Approval Required</span>
                    </div>
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-onedark-darker text-onedark-muted border border-onedark-border shrink-0">
                      Gated Policy
                    </span>
                  </div>

                  <div className="p-3.5 rounded-lg bg-onedark-darker border border-onedark-border text-xs text-onedark-fg font-mono space-y-1 leading-relaxed break-words">
                    <div><strong className="text-onedark-muted">Action:</strong> {latestApproval.action_type}</div>
                    <div><strong className="text-onedark-muted">Target:</strong> {latestApproval.action_details.command || latestApproval.action_details.title || latestApproval.action_details.branch || 'Workspace Action'}</div>
                    {latestApproval.action_details.description && (
                      <div className="mt-2 text-onedark-muted whitespace-pre-wrap text-xs">
                        {latestApproval.action_details.description}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5 pt-1">
                    <button
                      onClick={() => onApprove(undefined, { approval_id: latestApproval.id })}
                      className="py-2 px-3.5 rounded-lg bg-onedark-green hover:bg-onedark-green/90 text-onedark-greenFg font-bold text-xs flex items-center space-x-1.5 transition-colors shadow-sm cursor-pointer whitespace-nowrap"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Approve & Execute</span>
                    </button>

                    <button
                      onClick={() => onReject(undefined, { approval_id: latestApproval.id })}
                      className="py-2 px-3.5 rounded-lg bg-onedark-darker hover:bg-onedark-surface text-onedark-red border border-onedark-border text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <span>Reject</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Centralized Bottom Chat Input Bar */}
      <div className="relative p-3 sm:p-4 bg-onedark-darker border-t border-onedark-borderSubtle/60 flex-shrink-0">
        {/* Floating Jump to Bottom Button - Anchored strictly ABOVE the input bar so it NEVER blocks or overlaps input */}
        {showScrollBottomBtn && (
          <div className={`w-full ${contentMaxWidth} mx-auto relative pointer-events-none`}>
            <div className="absolute -top-14 sm:-top-15 right-2 sm:right-4 z-30 animate-in fade-in slide-in-from-bottom-2 duration-150 pointer-events-auto">
              <button
                type="button"
                onClick={() => scrollToBottom(true)}
                className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-full bg-onedark-accent hover:bg-onedark-accent/90 text-onedark-accentFg shadow-xl shadow-black/40 text-xs font-bold cursor-pointer transition-all active:scale-95 border border-black/15 group select-none"
                title="Resume auto-scroll & jump to latest responses"
              >
                {isRunning ? (
                  <span className="w-2 h-2 rounded-full bg-onedark-accentFg animate-pulse shrink-0" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 group-hover:translate-y-0.5 transition-transform shrink-0" />
                )}
                <span className="tracking-wide">{isRunning ? 'New activity below' : 'Jump to latest'}</span>
                <ChevronDown className="w-3.5 h-3.5 group-hover:translate-y-0.5 transition-transform shrink-0" />
              </button>
            </div>
          </div>
        )}

        <div className={`w-full ${contentMaxWidth} mx-auto`}>
          <form onSubmit={handleSubmit} className="flex flex-col relative z-20">
            {/* Repository Mention Autocomplete Menu */}
            {renderMentionMenu("bottom-full left-0 mb-2")}

            {/* Hidden file & folder inputs for chat attachments */}
            <input
              ref={chatFileInputRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  handleAttachFiles(e.target.files);
                }
                e.target.value = '';
              }}
            />
            <input
              ref={setFolderInputRef}
              type="file"
              // @ts-ignore
              webkitdirectory=""
              directory=""
              multiple
              style={{ display: 'none' }}
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  handleAttachFiles(e.target.files);
                }
                e.target.value = '';
              }}
            />

            {/* Unified Two-Tier Composer Card */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingInput(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setIsDraggingInput(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setIsDraggingInput(false);
                handleAttachDropped(e.dataTransfer);
              }}
              className={`flex flex-col bg-onedark-surface/35 hover:bg-onedark-surface/50 focus-within:bg-onedark-surface/70 border border-onedark-border/80 focus-within:border-onedark-accent/70 rounded-2xl focus-within:ring-2 focus-within:ring-onedark-accent/15 transition-all shadow-md relative ${
                isDraggingInput ? 'ring-2 ring-onedark-accent border-onedark-accent bg-onedark-surface/60' : ''
              }`}
            >
              {/* 1. Optional Attachment Pills Strip Inside Card */}
              {attachments.length > 0 && (() => {
                const { folders, standaloneFiles } = groupAttachmentsByFolder(attachments as any);
                return (
                  <div className="flex items-center gap-1.5 px-3.5 pt-2.5 pb-2 flex-wrap border-b border-onedark-borderSubtle/50">
                    {folders.map((folder) => (
                      <div
                        key={`folder-${folder.rootFolder}`}
                        className="flex items-center space-x-2 px-2.5 py-1 rounded-lg bg-onedark-darker/70 border border-onedark-yellow/30 text-[11px] font-mono text-onedark-fg shadow-2xs group"
                      >
                        <div className="p-0.5 rounded bg-onedark-yellow/15 flex items-center justify-center">
                          <Folder className="w-3 h-3 text-onedark-yellow flex-shrink-0" />
                        </div>
                        <span className="truncate max-w-[150px] font-semibold text-onedark-fgBright">{folder.rootFolder}/</span>
                        <span className="text-onedark-muted/80 text-[10px]">({folder.fileCount} files · {formatBytes(folder.totalSize)})</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveFolder(folder.rootFolder)}
                          className="text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/80 rounded p-0.5 cursor-pointer transition-colors ml-0.5"
                          title={`Remove ${folder.rootFolder}/ folder`}
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    ))}
                    {standaloneFiles.map((att) => {
                      if (att.pastedDoc) {
                        return (
                          <PastedDocPill
                            key={att.id}
                            doc={att.pastedDoc}
                            onOpenModal={(d) => handleOpenDocModal(d, false)}
                            onUnwrapDoc={handleUnwrapPastedDoc}
                            onRemoveDoc={handleRemoveAttachment}
                          />
                        );
                      }
                      const meta = getAttachmentIcon(att.name);
                      const IconComp = meta.icon;
                      return (
                        <div
                          key={att.id}
                          className="flex items-center space-x-2 px-2.5 py-1 rounded-lg bg-onedark-darker/70 border border-onedark-borderSubtle/80 text-[11px] font-mono text-onedark-fg shadow-2xs group"
                        >
                          <div className={`p-0.5 rounded ${meta.bg} flex items-center justify-center`}>
                            <IconComp className={`w-3 h-3 ${meta.color} flex-shrink-0`} />
                          </div>
                          <span className="truncate max-w-[150px] font-semibold text-onedark-fgBright">{att.name}</span>
                          <span className="text-onedark-muted/80 text-[10px]">({formatBytes(att.size)})</span>
                          {att.status === 'uploading' ? (
                            <Loader2 className="w-3 h-3 animate-spin text-onedark-accent" />
                          ) : att.status === 'error' ? (
                            <span className="text-onedark-red font-bold text-[10px]" title={att.error}>!</span>
                          ) : (
                            <Check className="w-3 h-3 text-onedark-green" />
                          )}
                          <button
                            type="button"
                            onClick={() => handleRemoveAttachment(att.id)}
                            className="text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/80 rounded p-0.5 cursor-pointer transition-colors ml-0.5"
                            title="Remove attachment"
                          >
                            <X className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {/* 2. Top Zone: Full-Width Unobstructed Text Input */}
              <div className="relative w-full px-3.5 pt-2.5 pb-1 min-h-[40px] max-h-[220px] flex items-center">
                {inputValue && (
                  <div
                    ref={chatBackdropRef}
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-3.5 top-2.5 bottom-1 bg-transparent text-[15px] font-sans leading-relaxed py-1 whitespace-pre-wrap break-words overflow-y-auto select-none"
                  >
                    {renderHighlightedInputText(inputValue)}
                  </div>
                )}
                <textarea
                  ref={textareaRef}
                  rows={1}
                  value={inputValue}
                  onChange={handleInputChange}
                  onFocus={() => {
                    const container = scrollContainerRef.current;
                    if (container) {
                      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
                      if (distanceFromBottom <= 80) {
                        isAutoScrollEnabledRef.current = true;
                        updateShowScrollBottomBtn(false);
                      }
                    }
                  }}
                  onPaste={handlePaste}
                  onKeyUp={handleKeyUp}
                  onClick={handleCursorMove}
                  onSelect={handleCursorMove}
                  onKeyDown={handleKeyDown}
                  onScroll={(e) => {
                    if (chatBackdropRef.current) {
                      chatBackdropRef.current.scrollTop = e.currentTarget.scrollTop;
                      chatBackdropRef.current.scrollLeft = e.currentTarget.scrollLeft;
                    }
                  }}
                  placeholder={
                    isRunning
                      ? "Task is running... Type follow-up instructions or hit Stop..."
                      : "Type instructions, or '@' to reference a repo..."
                  }
                  className={`w-full bg-transparent text-[15px] placeholder-onedark-muted/65 focus:outline-none resize-none font-sans leading-relaxed py-1 min-h-[32px] max-h-[200px] overflow-y-auto caret-onedark-yellow ${
                    inputValue ? 'text-transparent' : 'text-onedark-fgBright'
                  }`}
                />
              </div>

              {/* 3. Bottom Action Toolbar Inside Card (Single Row) */}
              <div className="flex items-center justify-between gap-2 px-3 pb-2.5 pt-1 select-none">
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  {/* Attach Split Pill */}
                  <div
                    ref={attachMenuChatRef}
                    className="relative flex-shrink-0 flex items-center h-7 bg-onedark-darker/70 rounded-lg border border-onedark-borderSubtle/80 hover:border-onedark-border shadow-2xs transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() => chatFileInputRef.current?.click()}
                      className="h-full px-2 text-onedark-muted hover:text-onedark-fgBright hover:bg-onedark-surface rounded-l-lg flex items-center justify-center transition-all cursor-pointer active:scale-95 group"
                      title="Attach file(s) to workspace"
                    >
                      <Paperclip className="w-3.5 h-3.5 text-onedark-muted group-hover:text-onedark-accent transition-colors" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowPersonaMenuChat(false);
                        setShowModelMenuChat(false);
                        setShowRepoMenuChat(false);
                        setShowAttachMenuChat((v) => !v);
                      }}
                      className="h-full px-1 text-onedark-muted hover:text-onedark-fgBright hover:bg-onedark-surface rounded-r-lg border-l border-onedark-borderSubtle/50 flex items-center justify-center transition-all cursor-pointer active:scale-95 group"
                      title="Upload folder options"
                    >
                      <ChevronDown
                        className={`w-2.5 h-2.5 text-onedark-muted group-hover:text-onedark-fg transition-transform duration-150 ${
                          showAttachMenuChat ? 'rotate-180 text-onedark-accent' : ''
                        }`}
                      />
                    </button>

                    {showAttachMenuChat && (
                      <div className="absolute left-0 bottom-full mb-1.5 w-44 rounded-xl bg-onedark-darker border border-onedark-border shadow-2xl p-1 z-50 flex flex-col space-y-0.5 text-xs font-sans animate-in fade-in zoom-in-95 duration-100">
                        <button
                          type="button"
                          onClick={() => {
                            setShowAttachMenuChat(false);
                            chatFileInputRef.current?.click();
                          }}
                          className="w-full px-2.5 py-2 text-left rounded-lg hover:bg-onedark-surface text-onedark-fg hover:text-onedark-fgBright flex items-center space-x-2 cursor-pointer transition-colors"
                        >
                          <FileText className="w-3.5 h-3.5 text-onedark-accent" />
                          <span>Upload Files</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleSelectFolder}
                          className="w-full px-2.5 py-2 text-left rounded-lg hover:bg-onedark-surface text-onedark-fg hover:text-onedark-fgBright flex items-center space-x-2 cursor-pointer transition-colors"
                        >
                          <Folder className="w-3.5 h-3.5 text-onedark-yellow" />
                          <span>Upload Folder</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Persona, Model & Repo Selector Pills */}
                  {renderPersonaSelector('chat')}
                  {renderModelSelector('chat')}
                  {renderRepoSelector()}
                </div>

                {/* Right Side: Send / Stop Action */}
                <div className="flex items-center space-x-2 flex-shrink-0">
                  {isRunning && (
                    <span className="hidden sm:flex items-center space-x-1 text-[10.5px] font-mono text-onedark-yellow">
                      <kbd className="px-1.5 py-0.5 rounded bg-onedark-darker/80 border border-onedark-borderSubtle/60 text-onedark-yellow text-[10px]">
                        Esc
                      </kbd>
                      <span>to stop</span>
                    </span>
                  )}

                  {isRunning ? (
                    <button
                      type="button"
                      onClick={() => onStopTask && onStopTask()}
                      className="h-7 px-3 rounded-lg bg-red-600 hover:bg-red-500 active:bg-red-700 text-white text-xs font-bold font-mono flex items-center space-x-1.5 transition-all shadow-md flex-shrink-0 ring-1 ring-red-500/30 animate-pulse cursor-pointer"
                      title="Stop execution (Esc)"
                    >
                      <Square className="w-3 h-3 fill-current" />
                      <span>Stop</span>
                    </button>
                  ) : isSubmitting ? (
                    <button
                      type="button"
                      disabled
                      className="h-7 w-7 rounded-lg bg-onedark-accent/80 text-onedark-accentFg flex items-center justify-center transition-all shadow-sm flex-shrink-0 cursor-wait font-bold"
                      title="Processing request..."
                    >
                      <Loader2 className="w-3.5 h-3.5 animate-spin stroke-[2.5]" />
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={!inputValue.trim() && attachments.length === 0}
                      className={`h-7 w-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-all shadow-2xs ${
                        !inputValue.trim() && attachments.length === 0
                          ? 'bg-onedark-darker/70 text-onedark-muted/60 border border-onedark-borderSubtle/80 cursor-not-allowed select-none'
                          : 'bg-onedark-accent hover:brightness-110 active:scale-95 text-onedark-accentFg font-extrabold cursor-pointer shadow-md ring-1 ring-onedark-accent/40'
                      }`}
                      title="Send message (Enter ↵)"
                    >
                      <Send className="w-3.5 h-3.5 stroke-[2.5]" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </form>
        </div>
      </div>

      {/* Ephemeral Sandbox Filesystem & Runtime Inspector Modal */}
      {isSandboxModalOpen && task && (
        <SandboxInspectorModal
          task={task}
          onClose={() => setIsSandboxModalOpen(false)}
        />
      )}

      {/* Global Image Lightbox Modal */}
      {lightboxImage && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex flex-col items-center justify-between p-4 sm:p-6 animate-in fade-in duration-200 select-none"
          onClick={() => setLightboxImage(null)}
        >
          {/* Top Header */}
          <div
            className="w-full max-w-5xl flex items-center justify-between px-4 py-2.5 rounded-xl bg-onedark-darker/90 border border-onedark-borderSubtle text-xs text-onedark-fg font-mono shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center space-x-2 min-w-0">
              <ImageIcon className="w-4 h-4 text-onedark-accent flex-shrink-0" />
              <span className="font-bold text-onedark-fgBright truncate max-w-sm sm:max-w-md">
                {lightboxImage.name}
              </span>
              {lightboxImage.sizeStr && (
                <span className="text-[11px] text-onedark-muted px-2 py-0.5 rounded bg-onedark-surface border border-onedark-borderSubtle">
                  {lightboxImage.sizeStr}
                </span>
              )}
            </div>

            <div className="flex items-center space-x-1.5 sm:space-x-2">
              <button
                type="button"
                onClick={() => setLightboxZoom((prev) => Math.max(0.25, prev - 0.25))}
                className="p-1.5 rounded-lg hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg transition-colors cursor-pointer"
                title="Zoom Out (-)"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="text-[11px] text-onedark-muted px-1.5 font-mono min-w-[3.5rem] text-center">
                {Math.round(lightboxZoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() => setLightboxZoom((prev) => Math.min(4, prev + 0.25))}
                className="p-1.5 rounded-lg hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg transition-colors cursor-pointer"
                title="Zoom In (+)"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setLightboxRotation((prev) => (prev + 90) % 360)}
                className="p-1.5 rounded-lg hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg transition-colors cursor-pointer"
                title="Rotate 90° (r)"
              >
                <RotateCw className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setLightboxZoom(1);
                  setLightboxRotation(0);
                }}
                className="p-1.5 rounded-lg hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg transition-colors cursor-pointer"
                title="Reset View"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
              <a
                href={lightboxImage.url}
                download={lightboxImage.name}
                className="p-1.5 rounded-lg hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg transition-colors"
                title="Download Image"
                onClick={(e) => e.stopPropagation()}
              >
                <Download className="w-4 h-4" />
              </a>
              {onSelectAuxTab && (
                <button
                  type="button"
                  onClick={() => {
                    onSelectAuxTab('files');
                    setLightboxImage(null);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-onedark-surface hover:bg-onedark-surfaceHighlight text-onedark-fgBright text-xs font-sans transition-colors flex items-center space-x-1 cursor-pointer"
                  title="Open in Files Studio Tab"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-onedark-accent" />
                  <span className="hidden sm:inline">Studio</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setLightboxImage(null)}
                className="p-1.5 rounded-lg hover:bg-onedark-surface text-onedark-muted hover:text-onedark-red transition-colors ml-1 cursor-pointer"
                title="Close (Esc)"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Center Image Container */}
          <div
            className="flex-1 w-full max-w-6xl flex items-center justify-center p-4 overflow-hidden relative"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={lightboxImage.url}
              alt={lightboxImage.name}
              style={{
                transform: `scale(${lightboxZoom}) rotate(${lightboxRotation}deg)`,
                transition: 'transform 0.15s ease-out',
              }}
              className="max-h-[80vh] max-w-[90vw] object-contain rounded-lg shadow-2xl cursor-grab active:cursor-grabbing border border-onedark-borderSubtle"
              draggable={false}
            />
          </div>

          {/* Bottom Hint */}
          <div className="text-[11px] font-mono text-onedark-muted/70 flex items-center space-x-3">
            <span>Scroll or +/- to Zoom</span>
            <span>·</span>
            <span>R to Rotate</span>
            <span>·</span>
            <span>Esc to Close</span>
          </div>
        </div>
      )}

      {/* Delete Current Session Confirm Modal */}
      {task && (
        <ConfirmModal
          isOpen={isDeleteModalOpen}
          isLoading={isDeletingSession}
          title="Delete Agent Session"
          description={`Are you sure you want to delete session "${task.title || 'Untitled'}"?`}
          confirmText="Delete Session"
          cancelText="Cancel"
          variant="danger"
          impactItems={[
            'Removes chat conversation history and agent thought logs',
            'Ephemeral workspace scratch directory will be cleaned up',
            'You will be taken back to the home launchpad',
          ]}
          safeItems={[
            'Remote repositories and code branches are completely untouched',
          ]}
          onConfirm={async () => {
            if (onDeleteTask && task.id) {
              const targetId = task.id;
              setIsDeleteModalOpen(false);
              setIsDeletingSession(true);
              try {
                await onDeleteTask(targetId);
              } finally {
                setIsDeletingSession(false);
              }
            }
          }}
          onCancel={() => {
            if (!isDeletingSession) setIsDeleteModalOpen(false);
          }}
        />
      )}

      {/* Pasted Document Inspector Modal */}
      {isDocModalOpen && activeModalDoc && (
        <PastedDocModal
          isOpen={isDocModalOpen}
          doc={activeModalDoc}
          onClose={() => setIsDocModalOpen(false)}
          onUpdateDoc={handleUpdatePastedDoc}
          onUnwrapDoc={handleUnwrapPastedDoc}
          readOnly={isDocModalReadOnly}
        />
      )}

      {/* Session Intelligence Report Modal */}
      {isReportModalOpen && task && (
        <ReportModal
          isOpen={isReportModalOpen}
          taskId={task.id}
          report={task.report || null}
          onClose={() => setIsReportModalOpen(false)}
          onReportUpdated={(updatedReport) => {
            if (task) {
              task.report = updatedReport;
            }
          }}
        />
      )}
    </div>
  );
};
