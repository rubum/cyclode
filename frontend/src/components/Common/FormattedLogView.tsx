import React, { useState } from 'react';
import { 
  Terminal, 
  FileCode2, 
  Folder, 
  Search, 
  Pencil, 
  Copy, 
  Check, 
  ChevronDown, 
  ChevronRight,
  FileText,
  AlertCircle
} from 'lucide-react';
import { TaskLog } from '../../types';
import { highlightCode } from '../../utils/syntaxHighlighter';

interface FormattedLogViewProps {
  log: TaskLog;
  initiallyExpanded?: boolean;
  isTerminalTab?: boolean;
}

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

export const FormattedLogView: React.FC<FormattedLogViewProps> = ({
  log,
  initiallyExpanded = false,
  isTerminalTab = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(initiallyExpanded);
  const [copied, setCopied] = useState(false);

  // Extract command or primary target from tool_input or tool_output
  const getToolMetadata = () => {
    let rawJson: any = null;
    if (log.tool_output && (log.tool_output.trim().startsWith('{') || log.tool_output.trim().startsWith('['))) {
      try {
        rawJson = JSON.parse(log.tool_output);
      } catch (e) {
        // Not valid JSON, keep as raw string
      }
    }

    const input = log.tool_input || {};
    let commandStr = maskSecretsInText(input.command || (rawJson && rawJson.command) || '');
    let filePath = maskSecretsInText(input.file_path || input.path || (rawJson && rawJson.file_path) || '');
    let query = maskSecretsInText(input.query || '');
    let subpath = input.subpath || input.directory || (rawJson && rawJson.path) || '.';

    let formattedOutput = maskSecretsInText(log.tool_output || '');
    let isFileContent = false;
    let isDirectoryList = false;
    let dirItems: Array<{ name: string; is_dir?: boolean; type?: string; size?: number | null }> = [];
    let isCommandOutput = false;
    let stdout = '';
    let stderr = '';

    if (rawJson) {
      if (rawJson.content !== undefined) {
        isFileContent = true;
        formattedOutput = maskSecretsInText(rawJson.content);
      } else if (rawJson.items !== undefined && Array.isArray(rawJson.items)) {
        isDirectoryList = true;
        dirItems = rawJson.items;
      } else if (rawJson.stdout !== undefined || rawJson.stderr !== undefined) {
        isCommandOutput = true;
        stdout = maskSecretsInText(rawJson.stdout || '');
        stderr = maskSecretsInText(rawJson.stderr || '');
        formattedOutput = [stdout, stderr ? `stderr:\n${stderr}` : ''].filter(Boolean).join('\n');
      }
    } else {
      if (log.tool_name === 'read_file') {
        isFileContent = true;
      } else if (log.tool_name === 'list_dir') {
        // If plain text list with 📁 / 📄
        isDirectoryList = false;
      }
    }

    return {
      commandStr,
      filePath,
      query,
      subpath,
      formattedOutput,
      isFileContent,
      isDirectoryList,
      dirItems,
      isCommandOutput,
      stdout,
      stderr,
    };
  };

  const meta = getToolMetadata();

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(meta.formattedOutput || log.tool_output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Select appropriate icon
  const renderIcon = () => {
    switch (log.tool_name) {
      case 'run_command':
        return <Terminal className="w-3.5 h-3.5 text-onedark-accent" />;
      case 'grep_search':
        return <Search className="w-3.5 h-3.5 text-onedark-yellow" />;
      case 'read_file':
        return <FileCode2 className="w-3.5 h-3.5 text-onedark-accent" />;
      case 'edit_file':
        return <Pencil className="w-3.5 h-3.5 text-onedark-green" />;
      case 'list_dir':
        return <Folder className="w-3.5 h-3.5 text-onedark-folder" />;
      default:
        return <Terminal className="w-3.5 h-3.5 text-onedark-accent" />;
    }
  };

  // Primary action label
  const renderTitle = () => {
    switch (log.tool_name) {
      case 'run_command':
        return (
          <span className="truncate">
            <span className="text-onedark-accent font-bold">$ </span>
            <span className="text-onedark-fgBright font-mono font-semibold">{meta.commandStr || 'run_command'}</span>
          </span>
        );
      case 'grep_search':
        return (
          <span className="truncate">
            <span className="text-onedark-muted">grep </span>
            <span className="text-onedark-yellow font-mono">"{meta.query || (log.tool_input && log.tool_input.query) || 'pattern'}"</span>
          </span>
        );
      case 'read_file':
        return (
          <span className="truncate">
            <span className="text-onedark-muted">read </span>
            <span className="text-onedark-fgBright font-mono">{meta.filePath || (log.tool_input && log.tool_input.file_path) || 'file'}</span>
          </span>
        );
      case 'edit_file':
        return (
          <span className="truncate">
            <span className="text-onedark-muted">edit </span>
            <span className="text-onedark-green font-mono">{meta.filePath || (log.tool_input && log.tool_input.file_path) || 'file'}</span>
          </span>
        );
      case 'list_dir':
        return (
          <span className="truncate">
            <span className="text-onedark-muted">ls </span>
            <span className="text-onedark-fgBright font-mono">{meta.subpath || '.'}</span>
          </span>
        );
      default:
        return <span className="font-semibold text-onedark-fgBright">{log.tool_name}</span>;
    }
  };

  return (
    <div className="rounded-lg border border-onedark-borderSubtle bg-onedark-surface/40 hover:bg-onedark-surface/60 transition-all overflow-hidden text-xs shadow-sm group">
      {/* Header bar */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="px-3 py-2 flex items-center justify-between cursor-pointer select-none text-onedark-fg hover:text-onedark-fgBright transition-colors"
      >
        <div className="flex items-center space-x-2 truncate pr-2">
          {renderIcon()}
          <div className="truncate text-xs font-mono">{renderTitle()}</div>
          <span className="text-[10.5px] text-onedark-muted font-mono flex-shrink-0">
            ({log.duration_ms}ms)
          </span>
        </div>

        <div className="flex items-center space-x-2 text-xs font-mono flex-shrink-0">
          <span
            className={`px-1.5 py-0.2 rounded text-[10px] font-mono border ${
              log.exit_code === 0
                ? 'bg-onedark-green/10 text-onedark-green border-onedark-green/20'
                : 'bg-onedark-red/10 text-onedark-red border-onedark-red/20'
            }`}
          >
            exit {log.exit_code}
          </span>

          <button
            onClick={handleCopy}
            className="p-1 rounded hover:bg-onedark-darker text-onedark-muted hover:text-onedark-fg transition-colors opacity-0 group-hover:opacity-100"
            title="Copy log output"
          >
            {copied ? <Check className="w-3 h-3 text-onedark-green" /> : <Copy className="w-3 h-3" />}
          </button>

          {isExpanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-onedark-muted" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-onedark-muted" />
          )}
        </div>
      </div>

      {/* Body / Content */}
      {isExpanded && (
        <div className="border-t border-onedark-borderSubtle bg-onedark-darker/95 p-3 font-mono text-xs overflow-x-auto select-text leading-relaxed">
          {/* If directory listing JSON */}
          {meta.isDirectoryList && meta.dirItems.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 py-1">
              {meta.dirItems.map((item, idx) => (
                <div
                  key={idx}
                  className="flex items-center space-x-2 px-2.5 py-1.5 rounded-md bg-onedark-surface/40 border border-onedark-borderSubtle/50 text-xs font-mono"
                >
                  {item.is_dir || item.type === 'directory' ? (
                    <Folder className="w-3.5 h-3.5 text-onedark-folder flex-shrink-0" />
                  ) : (
                    <FileText className="w-3.5 h-3.5 text-onedark-fg flex-shrink-0" />
                  )}
                  <span className="text-onedark-fgBright truncate font-medium">{item.name}</span>
                  {item.size !== null && item.size !== undefined && (
                    <span className="text-[10px] text-onedark-muted ml-auto font-mono">
                      {item.size > 1024 ? `${(item.size / 1024).toFixed(1)} KB` : `${item.size} B`}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : meta.isFileContent ? (
            /* File view with line numbers */
            <div className="space-y-1">
              {meta.filePath && (
                <div className="text-[11px] text-onedark-accent font-semibold pb-1 border-b border-onedark-borderSubtle/60 flex items-center justify-between">
                  <span>{meta.filePath}</span>
                  <span className="text-onedark-muted font-normal text-[10px]">
                    {meta.formattedOutput.split('\n').length} lines
                  </span>
                </div>
              )}
              <pre
                className="leading-relaxed whitespace-pre font-mono text-[11.5px] pt-1"
                dangerouslySetInnerHTML={{
                  __html: highlightCode(meta.formattedOutput, undefined, meta.filePath)
                }}
              />
            </div>
          ) : meta.isCommandOutput ? (
            /* Terminal stdout & stderr */
            <div className="space-y-2">
              {meta.stdout && (
                <pre className="text-onedark-fgBright leading-relaxed whitespace-pre-wrap font-mono text-[11.5px]">
                  {meta.stdout}
                </pre>
              )}
              {meta.stderr && (
                <div className="pt-1.5 border-t border-onedark-borderSubtle/60">
                  <div className="text-onedark-red text-[10.5px] font-bold mb-1 flex items-center space-x-1">
                    <AlertCircle className="w-3 h-3" />
                    <span>stderr</span>
                  </div>
                  <pre className="text-onedark-red/90 leading-relaxed whitespace-pre-wrap font-mono text-[11px]">
                    {meta.stderr}
                  </pre>
                </div>
              )}
              {!meta.stdout && !meta.stderr && (
                <span className="text-onedark-muted italic text-[11px]">(No terminal output)</span>
              )}
            </div>
          ) : (
            /* General text log output */
            <pre className="text-onedark-fg leading-relaxed whitespace-pre-wrap font-mono text-[11.5px]">
              {meta.formattedOutput || '(No output)'}
            </pre>
          )}
        </div>
      )}
    </div>
  );
};
