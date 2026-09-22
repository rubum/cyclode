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
  AlertCircle, 
  Globe, 
  ExternalLink, 
  Link2, 
  GitBranch, 
  Calendar,
  Code2,
  Eye,
  WrapText
} from 'lucide-react';
import { TaskLog } from '../../types';
import { highlightCode } from '../../utils/syntaxHighlighter';

interface FormattedLogViewProps {
  log: TaskLog;
  initiallyExpanded?: boolean;
  isTerminalTab?: boolean;
  isExpanded?: boolean;
  onToggle?: () => void;
  hideHeader?: boolean;
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

const parseLinkItems = (text: string) => {
  const items: Array<{ title: string; url: string; source?: string; date?: string }> = [];
  const lines = text.split('\n');
  const linkRegex = /\[(.*?)\]\((https?:\/\/[^\s)]+)\)(?:\s*[•·-]\s*(.*?))?$/;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(linkRegex);
    if (m) {
      const remainder = m[3] ? m[3].replace(/\*/g, '').trim() : undefined;
      let source: string | undefined = remainder;
      let date: string | undefined = undefined;

      if (remainder && remainder.includes('•')) {
        const parts = remainder.split('•').map((p) => p.trim());
        source = parts[0];
        date = parts[1];
      } else if (remainder && remainder.includes(' - ')) {
        const parts = remainder.split(' - ').map((p) => p.trim());
        source = parts[0];
        date = parts[1];
      }

      items.push({
        title: m[1].trim(),
        url: m[2].trim(),
        source,
        date,
      });
    }
  }
  return items;
};

export const FormattedLogView: React.FC<FormattedLogViewProps> = ({
  log,
  initiallyExpanded = false,
  isTerminalTab = false,
  isExpanded: controlledExpanded,
  onToggle,
  hideHeader = false,
}) => {
  const [internalExpanded, setInternalExpanded] = useState(initiallyExpanded);
  const [activeViewTab, setActiveViewTab] = useState<'visual' | 'raw' | 'input'>('visual');
  const [wrapLines, setWrapLines] = useState(true);
  const [copied, setCopied] = useState(false);

  const isExpanded = controlledExpanded !== undefined ? controlledExpanded : internalExpanded;

  const handleHeaderClick = () => {
    if (onToggle) {
      onToggle();
    } else {
      setInternalExpanded(!internalExpanded);
    }
  };

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
    let targetUrl = maskSecretsInText(input.url || input.target_url || input.repo_url || (rawJson && rawJson.url) || '');
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
        isDirectoryList = false;
      }
    }

    const linkItems = parseLinkItems(formattedOutput);

    return {
      commandStr,
      filePath,
      query,
      targetUrl,
      subpath,
      formattedOutput,
      isFileContent,
      isDirectoryList,
      dirItems,
      isCommandOutput,
      stdout,
      stderr,
      linkItems,
    };
  };

  const meta = getToolMetadata();

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    let textToCopy = meta.formattedOutput || log.tool_output || '';
    if (activeViewTab === 'input') {
      textToCopy = JSON.stringify(log.tool_input || {}, null, 2);
    }
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Select appropriate icon
  const renderIcon = () => {
    switch (log.tool_name) {
      case 'run_command':
        return <Terminal className="w-3.5 h-3.5 text-onedark-accent flex-shrink-0" />;
      case 'grep_search':
        return <Search className="w-3.5 h-3.5 text-onedark-yellow flex-shrink-0" />;
      case 'search_web':
        return <Globe className="w-3.5 h-3.5 text-onedark-accent flex-shrink-0" />;
      case 'fetch_url':
        return <Link2 className="w-3.5 h-3.5 text-onedark-accent flex-shrink-0" />;
      case 'git_clone':
        return <GitBranch className="w-3.5 h-3.5 text-onedark-purple flex-shrink-0" />;
      case 'read_file':
        return <FileCode2 className="w-3.5 h-3.5 text-onedark-accent flex-shrink-0" />;
      case 'edit_file':
        return <Pencil className="w-3.5 h-3.5 text-onedark-green flex-shrink-0" />;
      case 'list_dir':
        return <Folder className="w-3.5 h-3.5 text-onedark-folder flex-shrink-0" />;
      default:
        return <Terminal className="w-3.5 h-3.5 text-onedark-accent flex-shrink-0" />;
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
      case 'search_web':
        return (
          <span className="truncate">
            <span className="text-onedark-muted">search </span>
            <span className="text-onedark-accent font-mono font-semibold">"{meta.query || (log.tool_input && log.tool_input.query) || 'web'}"</span>
          </span>
        );
      case 'fetch_url':
        return (
          <span className="truncate">
            <span className="text-onedark-muted">fetch </span>
            <span className="text-onedark-accent font-mono font-semibold">{meta.targetUrl || 'url'}</span>
          </span>
        );
      case 'git_clone':
        return (
          <span className="truncate">
            <span className="text-onedark-muted">git clone </span>
            <span className="text-onedark-purple font-mono font-semibold">{meta.targetUrl || 'repository'}</span>
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
    <div
      className={`rounded-lg transition-colors overflow-hidden text-xs ${
        hideHeader
          ? 'bg-onedark-darker/90 border border-white/[0.06]'
          : isExpanded
          ? 'bg-onedark-darker/95 shadow-sm my-1.5 group'
          : 'hover:bg-onedark-surface/40 text-onedark-fg group'
      }`}
    >
      {/* Header bar (only if not embedded/hidden) */}
      {!hideHeader && (
        <div
          onClick={handleHeaderClick}
          className="px-2.5 py-1.5 flex items-center justify-between cursor-pointer select-none text-onedark-fg hover:text-onedark-fgBright transition-colors"
        >
          <div className="flex items-center space-x-2 truncate pr-2">
            {renderIcon()}
            <div className="truncate text-xs font-mono">{renderTitle()}</div>
            <span className="text-[10px] text-onedark-muted font-mono flex-shrink-0">
              ({log.duration_ms < 1000 ? `${log.duration_ms}ms` : `${(log.duration_ms / 1000).toFixed(1)}s`})
            </span>
          </div>

          <div className="flex items-center space-x-1.5 text-xs font-mono flex-shrink-0">
            {log.exit_code !== 0 && (
              <span className="px-1.5 py-0.5 rounded text-[9.5px] font-mono bg-onedark-red/15 text-onedark-red font-semibold">
                exit {log.exit_code}
              </span>
            )}

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
              <ChevronRight className="w-3.5 h-3.5 text-onedark-muted/40 group-hover:text-onedark-muted transition-colors" />
            )}
          </div>
        </div>
      )}

      {/* Body / Content */}
      {isExpanded && (
        <div className="bg-onedark-darker flex flex-col max-h-[520px]">
          {/* Sub-tab Toolbar */}
          <div className="flex items-center justify-between px-3 py-1.5 bg-onedark-darker/90 text-[11px] font-mono flex-shrink-0 select-none border-b border-white/[0.04]">
            <div className="flex items-center space-x-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveViewTab('visual');
                }}
                className={`flex items-center space-x-1 px-2 py-0.5 rounded transition-all cursor-pointer ${
                  activeViewTab === 'visual'
                    ? 'bg-onedark-accent/20 text-onedark-accent font-semibold border border-onedark-accent/30'
                    : 'text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/40 border border-transparent'
                }`}
              >
                <Eye className="w-3 h-3" />
                <span>Visual</span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveViewTab('raw');
                }}
                className={`flex items-center space-x-1 px-2 py-0.5 rounded transition-all cursor-pointer ${
                  activeViewTab === 'raw'
                    ? 'bg-onedark-accent/20 text-onedark-accent font-semibold border border-onedark-accent/30'
                    : 'text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/40 border border-transparent'
                }`}
              >
                <Terminal className="w-3 h-3" />
                <span>Raw Output</span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveViewTab('input');
                }}
                className={`flex items-center space-x-1 px-2 py-0.5 rounded transition-all cursor-pointer ${
                  activeViewTab === 'input'
                    ? 'bg-onedark-accent/20 text-onedark-accent font-semibold border border-onedark-accent/30'
                    : 'text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/40 border border-transparent'
                }`}
              >
                <Code2 className="w-3 h-3" />
                <span>Input Payload</span>
              </button>
            </div>

            <div className="flex items-center space-x-2 text-[10.5px]">
              {activeViewTab === 'raw' && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setWrapLines(!wrapLines);
                  }}
                  className={`px-1.5 py-0.5 rounded border transition-colors flex items-center space-x-1 cursor-pointer ${
                    wrapLines
                      ? 'bg-onedark-surface text-onedark-fgBright border-onedark-borderSubtle'
                      : 'text-onedark-muted border-transparent hover:text-onedark-fg'
                  }`}
                  title="Toggle Word Wrap"
                >
                  <WrapText className="w-3 h-3" />
                  <span>Wrap</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center space-x-1 px-2 py-0.5 rounded bg-onedark-surface/60 hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg transition-all cursor-pointer"
                title="Copy current tab contents"
              >
                {copied ? <Check className="w-3 h-3 text-onedark-green" /> : <Copy className="w-3 h-3" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>

          {/* Tab Body Viewport */}
          <div className="p-3 font-mono text-xs overflow-y-auto overflow-x-auto select-text leading-relaxed flex-1">
            {activeViewTab === 'input' ? (
              <div className="space-y-1">
                <div className="text-[10.5px] text-onedark-muted pb-1 flex items-center justify-between">
                  <span>Input Arguments Payload</span>
                  <span className="text-onedark-accent font-semibold">{log.tool_name}</span>
                </div>
                <pre
                  className="leading-relaxed whitespace-pre font-mono text-[11.5px] pt-1"
                  dangerouslySetInnerHTML={{
                    __html: highlightCode(JSON.stringify(log.tool_input || {}, null, 2), 'json')
                  }}
                />
              </div>
            ) : activeViewTab === 'raw' ? (
              <div className="space-y-1">
                <div className="text-[10.5px] text-onedark-muted pb-1 flex items-center justify-between">
                  <span>Raw Terminal / Output Stream</span>
                  <span>{(log.tool_output || '').length} chars</span>
                </div>
                <pre
                  className={`text-onedark-fg leading-relaxed font-mono text-[11.5px] pt-1 ${
                    wrapLines ? 'whitespace-pre-wrap' : 'whitespace-pre'
                  }`}
                >
                  {meta.formattedOutput || '(No output recorded)'}
                </pre>
              </div>
            ) : (
              /* Visual / Parsed View */
              meta.linkItems.length > 0 ? (
                <div className="space-y-1.5 py-0.5">
                  {meta.linkItems.map((item, idx) => {
                    let domain = '';
                    try {
                      domain = new URL(item.url).hostname.replace(/^www\./, '');
                    } catch (e) {
                      domain = item.source || 'web';
                    }
                    return (
                      <a
                        key={idx}
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center justify-between p-2 rounded-lg bg-onedark-surface/30 hover:bg-onedark-surface/80 border border-onedark-borderSubtle hover:border-onedark-accent/40 transition-all text-xs group/link no-underline"
                      >
                        <div className="flex items-center space-x-2.5 min-w-0 pr-2">
                          <div className="w-5 h-5 rounded bg-onedark-accent/10 border border-onedark-accent/20 flex items-center justify-center flex-shrink-0 text-onedark-accent">
                            <Globe className="w-3 h-3" />
                          </div>
                          <div className="truncate font-sans font-medium text-onedark-fgBright group-hover/link:text-onedark-accent transition-colors">
                            {item.title}
                          </div>
                        </div>
                        <div className="flex items-center space-x-1.5 flex-shrink-0 text-[10.5px] font-mono text-onedark-muted">
                          {item.date && (
                            <span className="hidden sm:inline-flex items-center space-x-1 px-1.5 py-0.5 rounded bg-onedark-surface text-onedark-fg/70 border border-onedark-borderSubtle text-[10px]">
                              <Calendar className="w-2.5 h-2.5 text-onedark-muted" />
                              <span>{item.date}</span>
                            </span>
                          )}
                          <span className="px-1.5 py-0.5 rounded bg-onedark-darker border border-onedark-borderSubtle">
                            {item.source || domain}
                          </span>
                          <ExternalLink className="w-3 h-3 text-onedark-muted group-hover/link:text-onedark-accent" />
                        </div>
                      </a>
                    );
                  })}
                </div>
              ) : meta.isDirectoryList && meta.dirItems.length > 0 ? (
                /* Directory listing JSON */
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 py-1">
                  {meta.dirItems.map((item, idx) => (
                    <div
                      key={idx}
                      className="flex items-center space-x-2 px-2.5 py-1.5 rounded-md bg-onedark-surface/40 border border-onedark-borderSubtle text-xs font-mono"
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
                    <div className="text-[11px] text-onedark-accent font-semibold pb-1 border-b border-onedark-borderSubtle flex items-center justify-between">
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
                    <div className="pt-1.5 border-t border-onedark-borderSubtle">
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
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
};
