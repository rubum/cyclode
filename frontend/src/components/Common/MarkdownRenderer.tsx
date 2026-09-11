import React, { useState } from 'react';
import { Copy, Check, Info, AlertTriangle, AlertCircle, Sparkles, Flame } from 'lucide-react';
import katex from 'katex';
import { highlightCode, resolveLanguage, escapeHtml } from '../../utils/syntaxHighlighter';

interface MarkdownRendererProps {
  content: string;
  className?: string;
  isStreaming?: boolean;
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

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, className = '', isStreaming = false }) => {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

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
            <li key={idx} className="leading-[1.7] pl-1 text-[#D1D5DB]">
              <span>{renderInline(item.content)}</span>
              {item.children && item.children.length > 0 && (
                <div className="mt-1.5 mb-1 pl-2 border-l border-onedark-borderSubtle/50 ml-1">
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
        className={`list-disc list-outside ${depth === 0 ? 'pl-5 my-2 space-y-1.5' : 'pl-4 my-1 space-y-1'} ${depth > 0 ? 'marker:text-onedark-muted/80 list-[circle]' : 'marker:text-onedark-accent/80'} text-[14px] leading-[1.7]`}
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
                <div className="flex-1 text-[#D1D5DB]">
                  <span>{renderInline(item.content)}</span>
                  {item.children && item.children.length > 0 && (
                    <div className="mt-1.5 mb-1 pl-2 border-l border-onedark-borderSubtle/50 ml-1">
                      {renderNestedList(item.children, item.childType || 'ul', undefined, depth + 1)}
                    </div>
                  )}
                </div>
              </li>
            );
          }
          return (
            <li key={idx} className="leading-[1.7] pl-1 text-[#D1D5DB]">
              <span>{renderInline(item.content)}</span>
              {item.children && item.children.length > 0 && (
                <div className="mt-1.5 mb-1 pl-2 border-l border-onedark-borderSubtle/50 ml-1">
                  {renderNestedList(item.children, item.childType || 'ul', undefined, depth + 1)}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    );
  };

  // Split by code blocks and display math blocks ($$...$$ or \[...\])
  const parts = content.split(/(```[\s\S]*?```|\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\])/g);

  return (
    <div className={`space-y-3 text-[14px] leading-[1.7] text-[#D1D5DB] font-sans ${className}`}>
      {parts.map((part, index) => {
        if (part.startsWith('```') && part.endsWith('```')) {
          // Code block
          const lines = part.slice(3, -3).trim().split('\n');
          const firstLine = lines[0].trim();
          const hasLang = /^[a-zA-Z0-9_-]+$/.test(firstLine);
          const language = hasLang ? firstLine : '';
          const codeLines = hasLang ? lines.slice(1) : lines;
          const code = codeLines.join('\n');

          return (
            <div key={index} className="my-3 rounded-xl border border-onedark-border bg-onedark-darker overflow-hidden shadow-xs">
              <div className="flex items-center justify-between px-3.5 py-1.5 bg-onedark-surface/70 border-b border-onedark-border text-[11px] text-onedark-muted font-mono select-none">
                <div className="flex items-center space-x-2">
                  <span className="text-onedark-accent font-semibold uppercase tracking-wider">{language || 'code'}</span>
                  <span className="text-[10px] text-onedark-muted">({codeLines.length} line{codeLines.length > 1 ? 's' : ''})</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleCopy(code, index)}
                  className="flex items-center space-x-1 hover:text-onedark-fgBright transition-colors px-2 py-0.5 rounded hover:bg-onedark-surface text-[11px]"
                >
                  {copiedIndex === index ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-onedark-green" />
                      <span className="text-[10.5px] text-onedark-green">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span className="text-[10.5px]">Copy</span>
                    </>
                  )}
                </button>
              </div>
              <div className="flex font-mono text-[12px] sm:text-[12.5px] leading-relaxed overflow-x-auto selection:bg-onedark-accent/30 p-3.5">
                {codeLines.length > 2 && (
                  <div className="select-none text-onedark-muted/50 text-right pr-3 border-r border-onedark-borderSubtle font-mono text-[11.5px] flex-shrink-0">
                    {codeLines.map((_, i) => (
                      <div key={i}>{i + 1}</div>
                    ))}
                  </div>
                )}
                <pre className={`text-onedark-fg font-mono ${codeLines.length > 2 ? 'pl-3' : ''} flex-1 overflow-x-auto`}>
                  <code
                    className={`language-${language || 'text'} font-mono leading-relaxed`}
                    dangerouslySetInnerHTML={{ __html: getHighlightedHtml(code, language) }}
                  />
                </pre>
              </div>
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
              className="my-3 py-3 px-4 rounded-xl bg-onedark-darker/90 border border-onedark-borderSubtle overflow-x-auto text-center text-[#F4F4F5] shadow-xs selection:bg-onedark-accent/30"
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
                      <div className="text-onedark-fg">{renderInline(block.content || '')}</div>
                    </div>
                  </div>
                );
              }

              if (block.type === 'table' && block.tableRows) {
                return (
                  <div key={bIdx} className="my-3 overflow-x-auto rounded-xl border border-onedark-border bg-onedark-darker/70 shadow-xs">
                    <table className="w-full text-left border-collapse text-[12px]">
                      {block.tableHeaders && (
                        <thead>
                          <tr className="bg-onedark-surface/70 border-b border-onedark-border text-onedark-fgBright font-semibold">
                            {block.tableHeaders.map((h, hIdx) => (
                              <th key={hIdx} className="px-3 py-1.5 font-mono text-[11.5px]">{renderInline(h)}</th>
                            ))}
                          </tr>
                        </thead>
                      )}
                      <tbody>
                        {block.tableRows.map((row, rIdx) => (
                          <tr key={rIdx} className="border-b border-onedark-borderSubtle last:border-0 hover:bg-onedark-surface/30">
                            {row.map((cell, cIdx) => (
                              <td key={cIdx} className="px-3 py-1.5 text-onedark-fg">{renderInline(cell)}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              }

              if (block.type === 'hr') {
                return <hr key={bIdx} className="border-t border-onedark-borderSubtle/60 my-3.5" />;
              }

              if ((block.type === 'ul' || block.type === 'ol') && block.items) {
                return (
                  <div key={bIdx}>
                    {renderNestedList(block.items, block.type, block.startNumber)}
                  </div>
                );
              }

              if (block.type === 'h1' && block.content) {
                return (
                  <h1 key={bIdx} className="text-[17px] font-bold text-[#F4F4F5] tracking-tight pt-3.5 pb-1 border-b border-onedark-borderSubtle/60">
                    {renderInline(block.content)}
                  </h1>
                );
              }

              if (block.type === 'h2' && block.content) {
                return (
                  <h2 key={bIdx} className="text-[15.5px] font-bold text-[#F4F4F5] tracking-tight pt-3 pb-0.5">
                    {renderInline(block.content)}
                  </h2>
                );
              }

              if (block.type === 'h3' && block.content) {
                return (
                  <h3 key={bIdx} className="text-[14.5px] font-semibold text-[#F4F4F5] pt-2 pb-0.5">
                    {renderInline(block.content)}
                  </h3>
                );
              }

              if (block.type === 'h4' && block.content) {
                return (
                  <h4 key={bIdx} className="text-[13.5px] font-semibold text-[#F4F4F5] pt-1.5 pb-0.5">
                    {renderInline(block.content)}
                  </h4>
                );
              }

              if (block.type === 'h5' && block.content) {
                return (
                  <h5 key={bIdx} className="text-[12.5px] font-semibold text-[#E5E5E5] pt-1 pb-0.5">
                    {renderInline(block.content)}
                  </h5>
                );
              }

              if (block.type === 'h6' && block.content) {
                return (
                  <h6 key={bIdx} className="text-[12px] font-medium text-onedark-muted pt-1 pb-0.5 uppercase tracking-wider">
                    {renderInline(block.content)}
                  </h6>
                );
              }

              if (block.type === 'blockquote' && block.content) {
                return (
                  <blockquote key={bIdx} className="border-l-2 border-onedark-accent/70 pl-3 py-1.5 my-2 bg-onedark-surface/40 rounded-r-lg text-[#D1D5DB] leading-[1.7] text-[13.5px]">
                    {renderInline(block.content)}
                  </blockquote>
                );
              }

              if (block.content) {
                return (
                  <p key={bIdx} className="leading-[1.7] text-[#D1D5DB]">
                    {renderInline(block.content)}
                  </p>
                );
              }

              return null;
            })}
          </div>
        );
      })}
      {isStreaming && (
        <span className="inline-block w-2 h-4 ml-1 bg-onedark-accent animate-pulse align-middle rounded-xs" title="Streaming..." />
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
  type: 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'ul' | 'ol' | 'blockquote' | 'alert' | 'table' | 'hr';
  content?: string;
  items?: NestedListItem[];
  startNumber?: number;
  alertType?: string;
  tableHeaders?: string[];
  tableRows?: string[][];
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
  let currentTable: { headers: string[]; rows: string[][] } | null = null;
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
      blocks.push({ type: 'table', tableHeaders: currentTable.headers, tableRows: currentTable.rows });
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

    // Horizontal Rule
    if (trimmed === '---' || trimmed === '***' || trimmed === '___') {
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

    // Table Row: | a | b |
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      flushParagraph();
      flushList();
      const cells = trimmed.slice(1, -1).split('|').map(c => c.trim());
      if (cells.every(c => /^:?-+:?$/.test(c))) {
        continue;
      }
      if (!currentTable) {
        currentTable = { headers: cells, rows: [] };
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
    // Escaped backticks: \` -> `
    .replace(/\\`/g, '`')
    // Escaped asterisks: \* -> *
    .replace(/\\\*/g, '*')
    // Escaped underscores: \_ -> _
    .replace(/\\_/g, '_');
}

function renderInline(rawText: string): React.ReactNode {
  // Match display math ($$...$$ or \[...\]), inline math ($...$ or \(...\)), inline code (`...`), bold, strikethrough, italic, and links
  const tokens = rawText.split(
    /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$(?!\s)(?:\\\$|[^\$\n])+?(?<!\s)\$|`+[^`]+`+|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\*[^*]+\*|(?<!\w)_[^_]+_(?!\w)|\[[^\]]+\]\([^)]+\))/g
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
          className="my-2.5 block overflow-x-auto text-center py-2 px-3 rounded-lg bg-onedark-darker/70 border border-onedark-borderSubtle/50 text-[#F4F4F5] selection:bg-onedark-accent/30"
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
          className="inline-math px-0.5 text-[#F4F4F5] align-baseline"
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
          className="px-1.5 py-0.5 rounded bg-onedark-surface/90 border border-onedark-borderSubtle text-onedark-yellow font-mono text-[12.5px] font-medium tracking-tight mx-0.5 align-baseline select-text"
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
        <strong key={i} className="font-semibold text-[#F4F4F5]">
          {renderInline(token.slice(2, -2))}
        </strong>
      );
    }

    // Strikethrough (~~...~~)
    if (token.startsWith('~~') && token.endsWith('~~') && token.length > 4) {
      return (
        <del key={i} className="line-through text-onedark-muted">
          {renderInline(token.slice(2, -2))}
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
          {renderInline(token.slice(1, -1))}
        </em>
      );
    }

    // Markdown Link [text](url)
    const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      return (
        <a
          key={i}
          href={linkMatch[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-onedark-accent underline underline-offset-2 hover:text-onedark-accent/80 transition-colors font-medium"
        >
          {linkMatch[1]}
        </a>
      );
    }

    // Plain text
    return <React.Fragment key={i}>{normalizeSpecialSymbols(token)}</React.Fragment>;
  });
}
