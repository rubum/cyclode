import React, { useState } from 'react';
import { Copy, Check, Info, AlertTriangle, AlertCircle, Sparkles, Flame, ChevronRight, ChevronDown, Compass, ArrowRight, Maximize2, Minimize2, ArrowLeftRight } from 'lucide-react';
import katex from 'katex';
import { highlightCode, resolveLanguage, escapeHtml } from '../../utils/syntaxHighlighter';

interface MarkdownRendererProps {
  content: string;
  className?: string;
  isStreaming?: boolean;
  onLinkClick?: (url: string, text: string) => void;
}

function getHighlightedHtml(code: string, lang: string): string {
  return highlightCode(code, lang);
}

function renderKatex(latex: string, displayMode: boolean = false): string {
  try {
    return katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      output: 'htmlAndMathml',
      strict: false,
    });
  } catch (e) {
    return `<span class="katex-error font-mono text-onedark-yellow text-[12px]">${escapeHtml(latex)}</span>`;
  }
}

interface NestedListItem {
  content: string;
  isTask?: boolean;
  isTaskChecked?: boolean;
  orderNumber?: number;
  children?: NestedListItem[];
  childType?: 'ul' | 'ol';
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, className = '', isStreaming = false, onLinkClick }) => {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const inline = (text: string) => renderInline(text, onLinkClick);

  const handleCopy = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const renderNestedList = (items: NestedListItem[], type: 'ul' | 'ol', startNumber?: number, depth: number = 0) => {
    if (type === 'ol') {
      return (
        <ol
          start={startNumber}
          className={`list-decimal list-outside ${depth === 0 ? 'pl-5 my-2 space-y-2' : 'pl-4 my-1 space-y-1'} marker:text-onedark-accent marker:font-semibold font-sans text-[14px] leading-[1.7]`}
        >
          {items.map((item, idx) => (
            <li key={idx} className="leading-[1.7] pl-1 text-onedark-fg">
              <span>{inline(item.content)}</span>
              {item.children && item.children.length > 0 && (
                <div className="mt-1.5 mb-1 pl-2 border-l border-onedark-borderSubtle ml-1">
                  {renderNestedList(item.children, item.childType || 'ul', undefined, depth + 1)}
                </div>
              )}
            </li>
          ))}
        </ol>
      );
    }

    return (
      <ul
        className={`list-disc list-outside ${depth === 0 ? 'pl-5 my-2 space-y-1.5' : 'pl-4 my-1 space-y-1'} ${depth > 0 ? 'marker:text-onedark-muted list-[circle]' : 'marker:text-onedark-accent'} text-[14px] leading-[1.7]`}
      >
        {items.map((item, idx) => {
          if (item.isTask) {
            return (
              <li key={idx} className="list-none -ml-4 flex items-start space-x-2 leading-[1.7]">
                <input
                  type="checkbox"
                  readOnly
                  checked={item.isTaskChecked}
                  className="mt-1 rounded border-onedark-border bg-onedark-darker text-onedark-accent focus:ring-0 focus:ring-offset-0 cursor-default"
                />
                <div className="flex-1 text-onedark-fg">
                  <span>{inline(item.content)}</span>
                  {item.children && item.children.length > 0 && (
                    <div className="mt-1.5 mb-1 pl-2 border-l border-onedark-borderSubtle ml-1">
                      {renderNestedList(item.children, item.childType || 'ul', undefined, depth + 1)}
                    </div>
                  )}
                </div>
              </li>
            );
          }
          return (
            <li key={idx} className="leading-[1.7] pl-1 text-onedark-fg">
              <span>{inline(item.content)}</span>
              {item.children && item.children.length > 0 && (
                <div className="mt-1.5 mb-1 pl-2 border-l border-onedark-borderSubtle ml-1">
                  {renderNestedList(item.children, item.childType || 'ul', undefined, depth + 1)}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    );
  };

  // Strip raw HTML comments and normalize unclosed code blocks during active streaming
  const normalizedContent = (() => {
    let text = content || '';
    // Strip HTML comments (e.g. <!-- CURSOR_AGENT_PR_BODY_END -->, <!-- release notes by coderabbit.ai -->)
    text = text.replace(/<!--[\s\S]*?-->/g, '');

    // Strip standalone tracking / light-mode image badge links (e.g. https://app.coderabbit.ai/...#gh-light-mode-only)
    text = text.replace(/^https?:\/\/[^\s\n]+#gh-(?:light|dark)-mode-only\s*$/gim, '');
    // Strip legacy/raw tool invocation traces
    text = text.replace(/\[Executed Tool:[^\]]+\]/g, '');
    text = text.replace(/\[Tool Result for [^\]]+:\s*[\s\S]*?\]/g, '');

    if (!isStreaming) return text;
    const codeBlockCount = (text.match(/```/g) || []).length;
    if (codeBlockCount % 2 !== 0) {
      return text + '\n```';
    }
    return text;
  })();

  // Split by code blocks and display math blocks ($$...$$ or \[...\])
  const parts = normalizedContent.split(/(```[\s\S]*?```|\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\])/g);
  let cursorAttached = false;
  const renderCursor = () => {
    cursorAttached = true;
    return (
      <span
        className="inline-block w-1.5 h-3.5 ml-1 bg-onedark-accent animate-pulse align-middle rounded-xs"
        title="Streaming..."
      />
    );
  };

  const [collapsedCodeBlocks, setCollapsedCodeBlocks] = useState<Record<number, boolean>>({});
  const [fullHeightCodeBlocks, setFullHeightCodeBlocks] = useState<Record<number, boolean>>({});
  const [fullWidthCodeBlocks, setFullWidthCodeBlocks] = useState<Record<number, boolean>>({});

  const toggleCodeBlock = (idx: number) => {
    setCollapsedCodeBlocks((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  const toggleFullHeight = (idx: number) => {
    setFullHeightCodeBlocks((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  const toggleFullWidth = (idx: number) => {
    setFullWidthCodeBlocks((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  return (
    <div className={`space-y-3 text-[14px] leading-[1.7] text-onedark-fg font-sans ${className}`}>
      {parts.map((part, index) => {
        if (part.startsWith('```') && part.endsWith('```')) {
          // Code block
          const lines = part.slice(3, -3).trim().split('\n');
          const firstLine = lines[0].trim();
          const hasLang = /^[a-zA-Z0-9_-]+$/.test(firstLine);
          const language = hasLang ? firstLine : '';
          const codeLines = hasLang ? lines.slice(1) : lines;
          const code = codeLines.join('\n');
          const isCollapsed = !!collapsedCodeBlocks[index];
          const isFullHeight = !!fullHeightCodeBlocks[index];
          const isFullWidth = !!fullWidthCodeBlocks[index];
          const isLongCode = codeLines.length > 15;

          return (
            <div
              key={index}
              className={`my-3 rounded-xl bg-onedark-darker/90 border border-onedark-borderSubtle overflow-hidden shadow-xs group/code text-left transition-all ${
                isFullWidth ? 'w-full !max-w-none' : 'w-full'
              }`}
            >
              <div className="flex items-center justify-between px-3.5 py-1.5 bg-onedark-surface/50 border-b border-onedark-borderSubtle/60 text-[11px] text-onedark-muted font-mono select-none flex-wrap gap-1">
                <div className="flex items-center space-x-2">
                  <span className="text-onedark-accent font-semibold uppercase tracking-wider text-[10.5px]">{language || 'code'}</span>
                  <span className="text-[10px] text-onedark-muted/70">({codeLines.length} line{codeLines.length > 1 ? 's' : ''})</span>
                </div>
                <div className="flex items-center space-x-1.5">
                  <button
                    type="button"
                    onClick={() => toggleFullWidth(index)}
                    className={`flex items-center space-x-1 transition-colors px-2 py-0.5 rounded text-[10.5px] cursor-pointer ${
                      isFullWidth
                        ? 'bg-onedark-accent/20 text-onedark-accent font-semibold'
                        : 'hover:text-onedark-fgBright hover:bg-onedark-surface text-onedark-muted'
                    }`}
                    title={isFullWidth ? 'Restore standard width' : 'Expand to full width'}
                  >
                    <ArrowLeftRight className="w-3 h-3" />
                    <span>{isFullWidth ? 'Standard Width' : 'Full Width'}</span>
                  </button>

                  {isLongCode && !isCollapsed && (
                    <button
                      type="button"
                      onClick={() => toggleFullHeight(index)}
                      className={`flex items-center space-x-1 transition-colors px-2 py-0.5 rounded text-[10.5px] cursor-pointer ${
                        isFullHeight
                          ? 'bg-onedark-accent/20 text-onedark-accent font-semibold'
                          : 'hover:text-onedark-fgBright hover:bg-onedark-surface text-onedark-muted'
                      }`}
                      title={isFullHeight ? 'Constrain height to scrollable window' : 'Expand to full height'}
                    >
                      {isFullHeight ? (
                        <>
                          <Minimize2 className="w-3 h-3" />
                          <span>Scroll Window</span>
                        </>
                      ) : (
                        <>
                          <Maximize2 className="w-3 h-3" />
                          <span>Full Height</span>
                        </>
                      )}
                    </button>
                  )}
                  {codeLines.length > 6 && (
                    <button
                      type="button"
                      onClick={() => toggleCodeBlock(index)}
                      className="flex items-center space-x-1 hover:text-onedark-fgBright transition-colors px-2 py-0.5 rounded hover:bg-onedark-surface text-[10.5px] text-onedark-muted cursor-pointer"
                    >
                      <ChevronRight className={`w-3 h-3 transition-transform ${!isCollapsed ? 'rotate-90' : ''}`} />
                      <span>{isCollapsed ? 'Expand' : 'Collapse'}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleCopy(code, index)}
                    className="flex items-center space-x-1 hover:text-onedark-fgBright transition-colors px-2 py-0.5 rounded hover:bg-onedark-surface text-[10.5px] text-onedark-muted cursor-pointer"
                  >
                    {copiedIndex === index ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-onedark-green" />
                        <span className="text-[10px] text-onedark-green">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span className="text-[10px]">Copy</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
              {!isCollapsed && (
                <div className={`flex font-mono text-[12px] sm:text-[12.5px] leading-relaxed overflow-x-auto selection:bg-onedark-accent/30 p-3.5 ${
                  isLongCode && !isFullHeight ? 'max-h-72 overflow-y-auto [scrollbar-width:thin]' : ''
                }`}>
                  {codeLines.length > 2 && (
                    <div className="select-none text-onedark-muted/40 text-right pr-3 border-r border-onedark-borderSubtle/40 font-mono text-[11.5px] flex-shrink-0">
                      {codeLines.map((_, i) => (
                        <div key={i}>{i + 1}</div>
                      ))}
                    </div>
                  )}
                  <pre className={`text-onedark-fg font-mono ${codeLines.length > 2 ? 'pl-3' : ''} flex-1 overflow-x-auto m-0`}>
                    <code
                      className={`language-${language || 'text'} font-mono leading-relaxed`}
                      dangerouslySetInnerHTML={{ __html: getHighlightedHtml(code, language) }}
                    />
                  </pre>
                </div>
              )}
            </div>
          );
        }

        // Display Math Block ($$...$$ or \[...\])
        if (
          (part.startsWith('$$') && part.endsWith('$$') && part.length >= 4) ||
          (part.startsWith('\\[') && part.endsWith('\\]') && part.length >= 4)
        ) {
          const math = part.startsWith('$$') ? part.slice(2, -2).trim() : part.slice(2, -2).trim();
          return (
            <div
              key={index}
              className="my-3 py-3 px-4 rounded-xl bg-onedark-darker/80 overflow-x-auto text-center text-onedark-fgBright shadow-xs selection:bg-onedark-accent/30"
              dangerouslySetInnerHTML={{ __html: renderKatex(math, true) }}
            />
          );
        }

        // Parse standard text blocks (headings, lists, paragraphs, blockquotes, tables, alerts)
        const blocks = parseBlocks(part);
        return (
          <div key={index} className="space-y-2">
            {blocks.map((block, bIdx) => {
              if (block.type === 'alert') {
                const alertStyle = getAlertStyle(block.alertType || 'NOTE');
                const Icon = alertStyle.icon;
                return (
                  <div
                    key={bIdx}
                    className={`my-2.5 p-3 rounded-xl border ${alertStyle.border} ${alertStyle.bg} flex items-start space-x-2.5 text-[12.5px] leading-relaxed`}
                  >
                    <Icon className={`w-3.5 h-3.5 ${alertStyle.text} flex-shrink-0 mt-0.5`} />
                    <div className="space-y-0.5">
                      <div className={`font-bold font-mono text-[10.5px] uppercase tracking-wider ${alertStyle.text}`}>
                        {block.alertType}
                      </div>
                      <div className="text-onedark-fg">{inline(block.content || '')}</div>
                    </div>
                  </div>
                );
              }

              if (block.type === 'table' && block.tableRows) {
                const headerCount = block.tableHeaders?.length || 0;
                const alignments = block.tableAlignments || [];
                const getAlignmentClass = (idx: number) => {
                  const align = alignments[idx];
                  if (align === 'center') return 'text-center';
                  if (align === 'right') return 'text-right';
                  return 'text-left';
                };

                return (
                  <div key={bIdx} className="my-3 overflow-x-auto rounded-xl bg-onedark-darker/40 shadow-xs [scrollbar-gutter:stable]">
                    <table className="w-full border-collapse text-[12.5px] table-auto">
                      {block.tableHeaders && block.tableHeaders.length > 0 && (
                        <thead>
                          <tr className="bg-onedark-surface/60 text-onedark-fgBright font-medium">
                            {block.tableHeaders.map((h, hIdx) => (
                              <th
                                key={hIdx}
                                className={`px-3.5 py-2 font-mono text-[11.5px] whitespace-nowrap ${getAlignmentClass(hIdx)}`}
                              >
                                {inline(h)}
                              </th>
                            ))}
                          </tr>
                        </thead>
                      )}
                      <tbody>
                        {block.tableRows.map((row, rIdx) => {
                          const cells = [...row];
                          while (headerCount > 0 && cells.length < headerCount) {
                            cells.push('');
                          }
                          return (
                            <tr key={rIdx} className="odd:bg-transparent even:bg-onedark-surface/20 hover:bg-onedark-surface/40 transition-colors">
                              {cells.map((cell, cIdx) => (
                                <td
                                  key={cIdx}
                                  className={`px-3.5 py-2 text-onedark-fg break-words ${getAlignmentClass(cIdx)}`}
                                >
                                  {inline(cell)}
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              }

              if (block.type === 'details') {
                return (
                  <details
                    key={bIdx}
                    className="my-2 rounded-lg bg-onedark-surface/30 overflow-hidden group"
                  >
                    <summary className="px-3.5 py-2 bg-onedark-surface/50 hover:bg-onedark-surface/80 cursor-pointer text-xs font-semibold text-onedark-fgBright select-none transition-colors flex items-center space-x-1.5 list-none">
                      <ChevronRight className="w-3.5 h-3.5 text-onedark-accent transition-transform group-open:rotate-90 flex-shrink-0" />
                      <span>{inline(block.summary || 'Details')}</span>
                    </summary>
                    {block.content && (
                      <div className="p-3 text-xs space-y-2">
                        <MarkdownRenderer content={block.content} onLinkClick={onLinkClick} />
                      </div>
                    )}
                  </details>
                );
              }

              if (block.type === 'hr') {
                return <div key={bIdx} className="my-6 h-px bg-gradient-to-r from-transparent via-onedark-fg/15 to-transparent border-0" />;
              }

              if ((block.type === 'ul' || block.type === 'ol') && block.items) {
                return (
                  <div key={bIdx}>
                    {renderNestedList(block.items, block.type, block.startNumber)}
                  </div>
                );
              }

              const slugify = (text: string) =>
                text
                  .toLowerCase()
                  .replace(/<[^>]+>/g, '')
                  .replace(/[^\w\s-]/g, '')
                  .trim()
                  .replace(/\s+/g, '-');

              const isLastValidPart = index === parts.length - 1 || parts.slice(index + 1).every((p) => !p.trim());
              const isLastBlock = bIdx === blocks.length - 1;
              const shouldAttachCursor = isStreaming && isLastValidPart && isLastBlock && !cursorAttached;

              if (block.type === 'h1' && block.content) {
                const hId = slugify(block.content);
                return (
                  <h1 id={hId} key={bIdx} className="text-[17px] font-bold text-onedark-fgBright tracking-tight pt-3.5 pb-1 border-b border-onedark-borderSubtle scroll-mt-4">
                    {inline(block.content)}
                    {shouldAttachCursor && renderCursor()}
                  </h1>
                );
              }

              if (block.type === 'h2' && block.content) {
                const hId = slugify(block.content);
                return (
                  <h2 id={hId} key={bIdx} className="text-[15.5px] font-bold text-onedark-fgBright tracking-tight pt-3 pb-0.5 scroll-mt-4">
                    {inline(block.content)}
                    {shouldAttachCursor && renderCursor()}
                  </h2>
                );
              }

              if (block.type === 'h3' && block.content) {
                const hId = slugify(block.content);
                return (
                  <h3 id={hId} key={bIdx} className="text-[14.5px] font-semibold text-onedark-fgBright pt-2 pb-0.5 scroll-mt-4">
                    {inline(block.content)}
                    {shouldAttachCursor && renderCursor()}
                  </h3>
                );
              }

              if (block.type === 'h4' && block.content) {
                const hId = slugify(block.content);
                return (
                  <h4 id={hId} key={bIdx} className="text-[13.5px] font-semibold text-onedark-fgBright pt-1.5 pb-0.5 scroll-mt-4">
                    {inline(block.content)}
                    {shouldAttachCursor && renderCursor()}
                  </h4>
                );
              }

              if (block.type === 'h5' && block.content) {
                const hId = slugify(block.content);
                return (
                  <h5 id={hId} key={bIdx} className="text-[12.5px] font-semibold text-onedark-fgBright pt-1 pb-0.5 scroll-mt-4">
                    {inline(block.content)}
                    {shouldAttachCursor && renderCursor()}
                  </h5>
                );
              }

              if (block.type === 'h6' && block.content) {
                const hId = slugify(block.content);
                return (
                  <h6 id={hId} key={bIdx} className="text-[12px] font-medium text-onedark-muted pt-1 pb-0.5 uppercase tracking-wider scroll-mt-4">
                    {inline(block.content)}
                    {shouldAttachCursor && renderCursor()}
                  </h6>
                );
              }

              if (block.type === 'blockquote' && block.content) {
                return (
                  <blockquote key={bIdx} className="border-l-2 border-onedark-accent pl-3 py-1.5 my-2 bg-onedark-surface/60 rounded-r-lg text-onedark-fg leading-[1.7] text-[13.5px]">
                    {inline(block.content)}
                    {shouldAttachCursor && renderCursor()}
                  </blockquote>
                );
              }

              if (block.content) {
                return (
                  <p key={bIdx} className="leading-[1.7] text-onedark-fg">
                    {inline(block.content)}
                    {shouldAttachCursor && renderCursor()}
                  </p>
                );
              }

              return null;
            })}
          </div>
        );
      })}
      {isStreaming && !cursorAttached && (
        <span className="inline-block w-1.5 h-3.5 ml-1 bg-onedark-accent animate-pulse align-middle rounded-xs" title="Streaming..." />
      )}
    </div>
  );
};

function getAlertStyle(type: string) {
  switch (type.toUpperCase()) {
    case 'TIP':
      return { border: 'border-onedark-green/40', bg: 'bg-onedark-green/10', text: 'text-onedark-green', icon: Sparkles };
    case 'IMPORTANT':
      return { border: 'border-onedark-purple/40', bg: 'bg-onedark-purple/10', text: 'text-onedark-purple', icon: Flame };
    case 'WARNING':
      return { border: 'border-onedark-yellow/40', bg: 'bg-onedark-yellow/10', text: 'text-onedark-yellow', icon: AlertTriangle };
    case 'CAUTION':
      return { border: 'border-onedark-red/40', bg: 'bg-onedark-red/10', text: 'text-onedark-red', icon: AlertCircle };
    case 'NOTE':
    default:
      return { border: 'border-onedark-yellow/40', bg: 'bg-onedark-yellow/10', text: 'text-onedark-yellow', icon: Info };
  }
}

interface BlockItem {
  type: 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'ul' | 'ol' | 'blockquote' | 'alert' | 'table' | 'hr' | 'details';
  content?: string;
  items?: NestedListItem[];
  startNumber?: number;
  alertType?: string;
  tableHeaders?: string[];
  tableRows?: string[][];
  tableAlignments?: ('left' | 'center' | 'right')[];
  summary?: string;
}

function parseTask(content: string): { isTask: boolean; isTaskChecked: boolean; cleanContent: string } {
  if (content.startsWith('[ ] ')) {
    return { isTask: true, isTaskChecked: false, cleanContent: content.slice(4) };
  }
  if (content.startsWith('[x] ') || content.startsWith('[X] ')) {
    return { isTask: true, isTaskChecked: true, cleanContent: content.slice(4) };
  }
  return { isTask: false, isTaskChecked: false, cleanContent: content };
}

function parseBlocks(text: string): BlockItem[] {
  const lines = text.split('\n');
  const blocks: BlockItem[] = [];
  let currentList: { type: 'ul' | 'ol'; items: NestedListItem[]; startNumber?: number } | null = null;
  let currentTable: { headers: string[]; rows: string[][]; alignments?: ('left' | 'center' | 'right')[] } | null = null;
  let currentParagraph: string[] = [];

  const flushParagraph = () => {
    if (currentParagraph.length > 0) {
      blocks.push({ type: 'p', content: currentParagraph.join(' ') });
      currentParagraph = [];
    }
  };

  const flushList = () => {
    if (currentList) {
      blocks.push({ type: currentList.type, items: currentList.items, startNumber: currentList.startNumber });
      currentList = null;
    }
  };

  const flushTable = () => {
    if (currentTable) {
      blocks.push({
        type: 'table',
        tableHeaders: currentTable.headers,
        tableRows: currentTable.rows,
        tableAlignments: currentTable.alignments
      });
      currentTable = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      flushList();
      flushTable();
      continue;
    }

    // Ignore lines that are isolated HTML comments
    if (/^<!--[\s\S]*?-->$/i.test(trimmed) || trimmed.startsWith('<!--') || trimmed.endsWith('-->')) {
      continue;
    }

    // Ignore lines that only contain HTML wrapper tags or stray summary/details tags
    if (/^<\/?(?:p|div|center|picture|source|span|summary|details)[^>]*>$/i.test(trimmed)) {
      continue;
    }

    // Ignore standalone summary lines outside details (e.g. <summary>📝 Walkthrough</summary>)
    if (/^<summary[^>]*>[\s\S]*?<\/summary>$/i.test(trimmed)) {
      continue;
    }

    // Details / Summary Accordion Block
    if (/<details\b[^>]*>/i.test(trimmed)) {
      flushParagraph();
      flushList();
      flushTable();
      let summaryText = 'Details';
      const detailsLines: string[] = [];

      // Check if <summary> is on the same line as <details>
      const inlineSummaryMatch = trimmed.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);
      if (inlineSummaryMatch) {
        summaryText = inlineSummaryMatch[1].replace(/<[^>]+>/g, '').trim() || summaryText;
      }

      // Check if closing </details> is on the same line
      if (/<\/details>/i.test(trimmed)) {
        const afterSummary = trimmed
          .replace(/<details\b[^>]*>/i, '')
          .replace(/<summary[^>]*>[\s\S]*?<\/summary>/i, '')
          .replace(/<\/details>/i, '')
          .trim();
        if (afterSummary) {
          detailsLines.push(afterSummary);
        }
      } else {
        for (let j = i + 1; j < lines.length; j++) {
          const dTrimmed = lines[j].trim();
          if (/<\/details>/i.test(dTrimmed)) {
            i = j;
            break;
          }
          const sMatch = dTrimmed.match(/^<summary[^>]*>([\s\S]*?)<\/summary>/i);
          if (sMatch) {
            summaryText = sMatch[1].replace(/<[^>]+>/g, '').trim() || summaryText;
          } else if (!/^<\/?summary[^>]*>/i.test(dTrimmed)) {
            detailsLines.push(lines[j]);
          }
          i = j;
        }
      }

      const innerContent = detailsLines.join('\n').trim();
      blocks.push({
        type: 'details',
        summary: summaryText,
        content: innerContent
      });
      continue;
    }

    // HTML Headings: <h1>Title</h1> to <h6>Title</h6>
    const htmlHeadingMatch = trimmed.match(/^<h([1-6])[^>]*>([\s\S]*?)<\/h\1>$/i);
    if (htmlHeadingMatch) {
      flushParagraph();
      flushList();
      flushTable();
      const level = htmlHeadingMatch[1];
      const headingText = htmlHeadingMatch[2].replace(/<[^>]+>/g, '').trim();
      blocks.push({ type: `h${level}` as any, content: headingText });
      continue;
    }

    // Horizontal Rule
    if (trimmed === '---' || trimmed === '***' || trimmed === '___' || /^<hr\s*\/?>$/i.test(trimmed)) {
      flushParagraph();
      flushList();
      flushTable();
      blocks.push({ type: 'hr' });
      continue;
    }

    // GitHub Alert: > [!NOTE], > [!WARNING], > [!TIP]
    const alertMatch = trimmed.match(/^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i);
    if (alertMatch) {
      flushParagraph();
      flushList();
      flushTable();
      const alertType = alertMatch[1].toUpperCase();
      let alertContent = alertMatch[2];
      while (i + 1 < lines.length && lines[i + 1].trim().startsWith('>')) {
        i++;
        alertContent += ' ' + lines[i].trim().slice(1).trim();
      }
      blocks.push({ type: 'alert', alertType, content: alertContent.trim() });
      continue;
    }

    // Table Row: starts with '|' or contains multiple pipes when table is already active
    if (trimmed.startsWith('|') || (currentTable && trimmed.includes('|'))) {
      flushParagraph();
      flushList();
      let rawRow = trimmed;
      if (rawRow.startsWith('|')) rawRow = rawRow.slice(1);
      if (rawRow.endsWith('|')) rawRow = rawRow.slice(0, -1);
      const cells = rawRow.split('|').map(c => c.trim());
      // Check delimiter row
      const isDelimiter = cells.length > 0 && cells.every(c => /^:?-+:?$/.test(c));
      if (isDelimiter) {
        if (currentTable) {
          currentTable.alignments = cells.map(c => {
            if (c.startsWith(':') && c.endsWith(':')) return 'center';
            if (c.endsWith(':')) return 'right';
            return 'left';
          });
        }
        continue;
      }
      if (!currentTable) {
        currentTable = { headers: cells, rows: [], alignments: [] };
      } else {
        currentTable.rows.push(cells);
      }
      continue;
    } else if (currentTable) {
      flushTable();
    }

    // Check for List item matches
    // 1. Bullet item: -, *, +, or unicode bullet •
    const bulletMatch = line.match(/^(\s*)(?:[-*+]|•)\s+(.*)$/);
    // 2. Numbered item: 1. or 1)
    const numMatch = line.match(/^(\s*)(\d+)[.)]\s+(.*)$/);

    if (bulletMatch) {
      flushParagraph();
      const indent = bulletMatch[1].replace(/\t/g, '  ').length;
      const { isTask, isTaskChecked, cleanContent } = parseTask(bulletMatch[2]);
      const newItem: NestedListItem = { content: cleanContent, isTask, isTaskChecked, children: [] };

      if (currentList) {
        if (currentList.type === 'ol') {
          // If we are currently in an ordered list, this bullet belongs as a child of the current OL item!
          const lastItem = currentList.items[currentList.items.length - 1];
          if (lastItem) {
            if (!lastItem.children) lastItem.children = [];
            lastItem.childType = 'ul';
            lastItem.children.push(newItem);
          } else {
            currentList.items.push(newItem);
          }
        } else {
          // In an unordered list
          if (indent >= 2 && currentList.items.length > 0) {
            // Indented sub-bullet
            const lastItem = currentList.items[currentList.items.length - 1];
            if (!lastItem.children) lastItem.children = [];
            lastItem.childType = 'ul';
            lastItem.children.push(newItem);
          } else {
            // Sibling bullet
            currentList.items.push(newItem);
          }
        }
      } else {
        // Start new unordered list
        currentList = { type: 'ul', items: [newItem] };
      }
      continue;
    }

    if (numMatch) {
      flushParagraph();
      const indent = numMatch[1].replace(/\t/g, '  ').length;
      const num = parseInt(numMatch[2], 10);
      const { isTask, isTaskChecked, cleanContent } = parseTask(numMatch[3]);
      const newItem: NestedListItem = { content: cleanContent, orderNumber: num, isTask, isTaskChecked, children: [] };

      if (currentList) {
        if (currentList.type === 'ol') {
          if (indent >= 2 && currentList.items.length > 0) {
            // Nested numbered list under last item
            const lastItem = currentList.items[currentList.items.length - 1];
            if (!lastItem.children) lastItem.children = [];
            lastItem.childType = 'ol';
            lastItem.children.push(newItem);
          } else {
            // Top-level item in existing ordered list
            currentList.items.push(newItem);
          }
        } else {
          // Was in a UL
          if (indent >= 2 && currentList.items.length > 0) {
            const lastItem = currentList.items[currentList.items.length - 1];
            if (!lastItem.children) lastItem.children = [];
            lastItem.childType = 'ol';
            lastItem.children.push(newItem);
          } else {
            flushList();
            currentList = { type: 'ol', items: [newItem], startNumber: num };
          }
        }
      } else {
        currentList = { type: 'ol', items: [newItem], startNumber: num };
      }
      continue;
    }

    // End list if ongoing and moving to heading or blockquote
    if (trimmed.startsWith('#') || trimmed.startsWith('> ')) {
      flushParagraph();
      flushList();

      // Headings (longest prefix first)
      if (trimmed.startsWith('###### ')) {
        blocks.push({ type: 'h6', content: trimmed.slice(7) });
      } else if (trimmed.startsWith('##### ')) {
        blocks.push({ type: 'h5', content: trimmed.slice(6) });
      } else if (trimmed.startsWith('#### ')) {
        blocks.push({ type: 'h4', content: trimmed.slice(5) });
      } else if (trimmed.startsWith('### ')) {
        blocks.push({ type: 'h3', content: trimmed.slice(4) });
      } else if (trimmed.startsWith('## ')) {
        blocks.push({ type: 'h2', content: trimmed.slice(3) });
      } else if (trimmed.startsWith('# ')) {
        blocks.push({ type: 'h1', content: trimmed.slice(2) });
      } else if (trimmed.startsWith('> ')) {
        blocks.push({ type: 'blockquote', content: trimmed.slice(2) });
      }
      continue;
    }

    // Standard paragraph line
    flushList();
    currentParagraph.push(line);
  }

  flushParagraph();
  flushList();
  flushTable();

  return blocks;
}

function normalizeSpecialSymbols(text: string): string {
  return text
    // Decode common HTML entities
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&bull;/gi, '•')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    // Strip stray HTML comments
    .replace(/<!--[\s\S]*?-->/g, '')
    // Strip stray HTML wrapper tags while preserving formatting tags
    .replace(/<\/?(?:p|div|center|picture|source|span)[^>]*>/gi, '')
    // Convert <br> or <br/> to newline
    .replace(/<br\s*\/?>/gi, '\n')
    // Escaped backticks: \` -> `
    .replace(/\\`/g, '`')
    // Escaped asterisks: \* -> *
    .replace(/\\\*/g, '*')
    // Escaped underscores: \_ -> _
    .replace(/\\_/g, '_');
}

function renderInline(rawText: string, onLinkClick?: (url: string, text: string) => void): React.ReactNode {
  // Pre-normalize HTML entities and strip inline HTML comments
  const decodedText = rawText
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&bull;/gi, '•')
    .replace(/<!--[\s\S]*?-->/g, '');

  // Match display math, inline math, inline code, bold, strikethrough, italic, sub/sup/kbd/mark/code, linked images, images, links, HTML tags, and raw URLs
  const tokens = decodedText.split(
    /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$(?!\s)(?:\\\$|[^\$\n])+?(?<!\s)\$|`+[^`]+`+|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\*[^*]+\*|(?<!\w)_[^_]+_(?!\w)|<sub\b[^>]*>[\s\S]*?<\/sub>|<sup\b[^>]*>[\s\S]*?<\/sup>|<kbd\b[^>]*>[\s\S]*?<\/kbd>|<mark\b[^>]*>[\s\S]*?<\/mark>|<code\b[^>]*>[\s\S]*?<\/code>|\[!\[[^\]]*\]\([^)]+\)\]\([^)]+\)|!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\)|<img\s+[^>]*src=["'][^"']+["'][^>]*\/?>|<a\s+[^>]*href=["'][^"']+["'][^>]*>[\s\S]*?<\/a>|https?:\/\/[^\s<>()"']+)/gi
  );

  return tokens.map((token, i) => {
    if (!token) return null;

    // Display Math ($$...$$ or \[...\])
    if (
      (token.startsWith('$$') && token.endsWith('$$') && token.length >= 4) ||
      (token.startsWith('\\[') && token.endsWith('\\]') && token.length >= 4)
    ) {
      const math = token.startsWith('$$') ? token.slice(2, -2).trim() : token.slice(2, -2).trim();
      return (
        <span
          key={i}
          className="my-2.5 block overflow-x-auto text-center py-2 px-3 rounded-lg bg-onedark-darker border border-onedark-borderSubtle text-onedark-fgBright selection:bg-onedark-accent/30"
          dangerouslySetInnerHTML={{ __html: renderKatex(math, true) }}
        />
      );
    }

    // Inline Math ($...$ or \(...\))
    if (
      (token.startsWith('$') && token.endsWith('$') && token.length >= 2 && !token.startsWith('$$')) ||
      (token.startsWith('\\(') && token.endsWith('\\)') && token.length >= 4)
    ) {
      const math = token.startsWith('$') ? token.slice(1, -1).trim() : token.slice(2, -2).trim();
      return (
        <span
          key={i}
          className="inline-math px-0.5 text-onedark-fgBright align-baseline"
          dangerouslySetInnerHTML={{ __html: renderKatex(math, false) }}
        />
      );
    }

    // Inline code (`...` or ``...``)
    const codeMatch = token.match(/^(`+)([\s\S]+?)\1$/);
    if (codeMatch) {
      return (
        <code
          key={i}
          className="px-1.5 py-0.5 rounded-md bg-onedark-surface/60 text-onedark-accent font-mono text-[12.5px] font-medium tracking-tight mx-0.5 align-baseline select-text"
        >
          {codeMatch[2]}
        </code>
      );
    }

    // Bold (**...** or __...__)
    if (
      (token.startsWith('**') && token.endsWith('**') && token.length > 4) ||
      (token.startsWith('__') && token.endsWith('__') && token.length > 4)
    ) {
      return (
        <strong key={i} className="font-semibold text-onedark-fgBright">
          {renderInline(token.slice(2, -2), onLinkClick)}
        </strong>
      );
    }

    // Strikethrough (~~...~~)
    if (token.startsWith('~~') && token.endsWith('~~') && token.length > 4) {
      return (
        <del key={i} className="line-through text-onedark-muted">
          {renderInline(token.slice(2, -2), onLinkClick)}
        </del>
      );
    }

    // Italic (*...* or _..._)
    if (
      (token.startsWith('*') && token.endsWith('*') && token.length > 2) ||
      (token.startsWith('_') && token.endsWith('_') && token.length > 2)
    ) {
      return (
        <em key={i} className="italic text-onedark-fgBright">
          {renderInline(token.slice(1, -1), onLinkClick)}
        </em>
      );
    }

    // HTML <sub>...</sub>
    const subMatch = token.match(/^<sub\b[^>]*>([\s\S]*?)<\/sub>$/i);
    if (subMatch) {
      return (
        <sub key={i} className="text-[10px] text-onedark-muted inline leading-tight align-sub font-mono">
          {renderInline(subMatch[1], onLinkClick)}
        </sub>
      );
    }

    // HTML <sup>...</sup>
    const supMatch = token.match(/^<sup\b[^>]*>([\s\S]*?)<\/sup>$/i);
    if (supMatch) {
      return (
        <sup key={i} className="text-[10px] text-onedark-muted inline leading-tight align-super font-mono">
          {renderInline(supMatch[1], onLinkClick)}
        </sup>
      );
    }

    // HTML <kbd>...</kbd>
    const kbdMatch = token.match(/^<kbd\b[^>]*>([\s\S]*?)<\/kbd>$/i);
    if (kbdMatch) {
      return (
        <kbd
          key={i}
          className="px-1.5 py-0.5 rounded bg-onedark-surface border border-onedark-border font-mono text-[10.5px] text-onedark-fgBright shadow-2xs inline-block align-baseline mx-0.5"
        >
          {kbdMatch[1]}
        </kbd>
      );
    }

    // HTML <mark>...</mark>
    const markMatch = token.match(/^<mark\b[^>]*>([\s\S]*?)<\/mark>$/i);
    if (markMatch) {
      return (
        <mark
          key={i}
          className="search-highlight bg-onedark-yellow/20 text-onedark-yellow font-semibold px-1 py-0.5 rounded border border-onedark-yellow/30"
        >
          {renderInline(markMatch[1], onLinkClick)}
        </mark>
      );
    }

    // HTML <code>...</code>
    const htmlCodeMatch = token.match(/^<code\b[^>]*>([\s\S]*?)<\/code>$/i);
    if (htmlCodeMatch) {
      return (
        <code
          key={i}
          className="px-1.5 py-0.5 rounded bg-onedark-surface border border-onedark-borderSubtle text-onedark-accent font-mono text-[12px] font-semibold tracking-tight mx-0.5 align-baseline select-text shadow-2xs"
        >
          {htmlCodeMatch[1]}
        </code>
      );
    }

    // Linked image: [![alt](imgUrl)](linkUrl)
    const linkedImgMatch = token.match(/^\[!\[([^\]]*)\]\(([^)]+)\)\]\(([^)]+)\)$/);
    if (linkedImgMatch) {
      const altText = linkedImgMatch[1];
      const imgUrl = linkedImgMatch[2];
      const linkUrl = linkedImgMatch[3];
      return (
        <a
          key={i}
          href={linkUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block my-1 mr-1.5 align-middle transition-opacity hover:opacity-85 cursor-pointer"
          title={`Open ${altText || linkUrl}`}
          onClick={(e) => {
            if (onLinkClick && !e.metaKey && !e.ctrlKey) {
              e.preventDefault();
              onLinkClick(linkUrl, altText || 'link');
            }
          }}
        >
          <img
            src={imgUrl}
            alt={altText}
            className="inline-block max-h-8 max-w-full rounded border border-transparent align-middle"
            loading="lazy"
            onError={(e) => {
              (e.currentTarget as HTMLElement).style.display = 'none';
            }}
          />
        </a>
      );
    }

    // Markdown Image: ![alt](imgUrl)
    const imgMatch = token.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (imgMatch) {
      const altText = imgMatch[1];
      const imgUrl = imgMatch[2];
      return (
        <img
          key={i}
          src={imgUrl}
          alt={altText}
          className="inline-block max-w-full max-h-[360px] object-contain rounded-lg my-2 align-middle border border-onedark-borderSubtle shadow-xs"
          loading="lazy"
          onError={(e) => {
            (e.currentTarget as HTMLElement).style.display = 'none';
          }}
        />
      );
    }

    // HTML <img> tag
    const htmlImgMatch = token.match(/^<img\s+([^>]*)\/?>$/i);
    if (htmlImgMatch) {
      const attrs = htmlImgMatch[1];
      const srcMatch = attrs.match(/src=["']([^"']+)["']/i);
      const altMatch = attrs.match(/alt=["']([^"']*)["']/i);
      if (srcMatch) {
        return (
          <img
            key={i}
            src={srcMatch[1]}
            alt={altMatch ? altMatch[1] : ''}
            className="inline-block max-w-full max-h-[360px] object-contain rounded-lg my-2 align-middle border border-onedark-borderSubtle shadow-xs"
            loading="lazy"
            onError={(e) => {
              (e.currentTarget as HTMLElement).style.display = 'none';
            }}
          />
        );
      }
    }

    // HTML <a> tag
    const htmlAnchorMatch = token.match(/^<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>$/i);
    if (htmlAnchorMatch) {
      const linkUrl = htmlAnchorMatch[1];
      const rawLinkContent = htmlAnchorMatch[2].trim();
      const linkText = rawLinkContent.replace(/<[^>]+>/g, '').trim() || linkUrl;
      return (
        <a
          key={i}
          href={linkUrl}
          onClick={(e) => {
            if (linkUrl.startsWith('#')) {
              e.preventDefault();
              const targetId = linkUrl.slice(1);
              const targetEl = document.getElementById(targetId);
              if (targetEl) {
                targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }
              return;
            }
            if (e.metaKey || e.ctrlKey || !onLinkClick) {
              return;
            }
            e.preventDefault();
            onLinkClick(linkUrl, linkText);
          }}
          target="_blank"
          rel="noopener noreferrer"
          className="text-onedark-accent underline underline-offset-2 hover:text-onedark-accent/80 transition-colors font-medium cursor-pointer inline"
          title={`Preview ${linkText} in sidebar (Cmd/Ctrl + click for new tab)`}
        >
          {linkText}
        </a>
      );
    }

    // Markdown Link [text](url)
    const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      const linkText = linkMatch[1];
      const linkUrl = linkMatch[2];

      const isPlanAction = linkUrl.startsWith('plan://') || linkUrl === '#open-plan-doc' || linkUrl === 'action://open-plan-doc';
      if (isPlanAction) {
        return (
          <button
            key={i}
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (onLinkClick) {
                onLinkClick(linkUrl, linkText);
              }
            }}
            className="inline-flex items-center space-x-2 my-2 px-3.5 py-2 rounded-lg bg-onedark-accent/15 hover:bg-onedark-accent/25 border border-onedark-accent/35 text-onedark-accent text-xs font-sans font-medium transition-all group cursor-pointer shadow-xs active:scale-[0.99]"
            title="Open architectural plan in Web & Docs"
          >
            <Compass className="w-3.5 h-3.5 text-onedark-accent shrink-0 animate-pulse" />
            <span className="font-semibold">{linkText.replace(/^[👉📄\s]+/, '')}</span>
            <ArrowRight className="w-3 h-3 text-onedark-accent group-hover:translate-x-0.5 transition-transform" />
          </button>
        );
      }

      return (
        <a
          key={i}
          href={linkUrl}
          onClick={(e) => {
            if (linkUrl.startsWith('#')) {
              e.preventDefault();
              const targetId = linkUrl.slice(1);
              const targetEl = document.getElementById(targetId);
              if (targetEl) {
                targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }
              return;
            }
            if (e.metaKey || e.ctrlKey || !onLinkClick) {
              return;
            }
            e.preventDefault();
            onLinkClick(linkUrl, linkText);
          }}
          target="_blank"
          rel="noopener noreferrer"
          className="text-onedark-accent underline underline-offset-2 hover:text-onedark-accent/80 transition-colors font-medium cursor-pointer inline"
          title={`Preview ${linkText} in sidebar (Cmd/Ctrl + click for new tab)`}
        >
          {linkText}
        </a>
      );
    }

    // Autolink Raw URLs: https://... or http://...
    if (/^https?:\/\/[^\s<>()"']+$/i.test(token)) {
      const cleanUrl = token.replace(/[.,;:!)]+$/, '');
      const trailingPunct = token.slice(cleanUrl.length);

      let displayText = cleanUrl;
      try {
        const u = new URL(cleanUrl);
        if (cleanUrl.length > 55) {
          displayText = `${u.hostname}${u.pathname.length > 25 ? u.pathname.slice(0, 25) + '…' : u.pathname}`;
        }
      } catch {}

      return (
        <React.Fragment key={i}>
          <a
            href={cleanUrl}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || !onLinkClick) {
                return;
              }
              e.preventDefault();
              onLinkClick(cleanUrl, displayText);
            }}
            target="_blank"
            rel="noopener noreferrer"
            className="text-onedark-accent underline underline-offset-2 hover:text-onedark-accent/80 transition-colors font-mono text-[12.5px] cursor-pointer break-all inline"
            title={`Preview ${cleanUrl} in sidebar`}
          >
            {displayText}
          </a>
          {trailingPunct}
        </React.Fragment>
      );
    }

    // Plain text
    return <React.Fragment key={i}>{normalizeSpecialSymbols(token)}</React.Fragment>;
  });
}
