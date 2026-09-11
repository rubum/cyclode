import React, { useState } from 'react';
import { Copy, Check, Info, AlertTriangle, AlertCircle, Sparkles, Flame } from 'lucide-react';
import { highlightCode, resolveLanguage } from '../../utils/syntaxHighlighter';

interface MarkdownRendererProps {
  content: string;
  className?: string;
  isStreaming?: boolean;
}

function getHighlightedHtml(code: string, lang: string): string {
  return highlightCode(code, lang);
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, className = '', isStreaming = false }) => {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const handleCopy = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  // Split by code blocks first
  const parts = content.split(/(```[\s\S]*?```)/g);

  return (
    <div className={`space-y-2.5 text-[13px] sm:text-[13.5px] leading-relaxed text-[#ABB2BF] font-sans ${className}`}>
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

              if (block.type === 'ul' && block.items) {
                return (
                  <ul key={bIdx} className="list-disc list-outside pl-4 space-y-1.5 my-1.5 marker:text-onedark-accent/70 text-[13px] sm:text-[13.5px] leading-relaxed">
                    {block.items.map((item, iIdx) => {
                      const isTaskUnchecked = item.startsWith('[ ] ');
                      const isTaskChecked = item.startsWith('[x] ') || item.startsWith('[X] ');
                      if (isTaskUnchecked || isTaskChecked) {
                        return (
                          <li key={iIdx} className="list-none -ml-4 flex items-start space-x-2 leading-relaxed">
                            <input
                              type="checkbox"
                              readOnly
                              checked={isTaskChecked}
                              className="mt-0.5 rounded border-onedark-border bg-onedark-darker text-onedark-accent focus:ring-0 focus:ring-offset-0 cursor-default"
                            />
                            <span>{renderInline(item.slice(4))}</span>
                          </li>
                        );
                      }
                      return (
                        <li key={iIdx} className="leading-relaxed pl-0.5">
                          {renderInline(item)}
                        </li>
                      );
                    })}
                  </ul>
                );
              }

              if (block.type === 'ol' && block.items) {
                return (
                  <ol key={bIdx} className="list-decimal list-outside pl-4 space-y-1.5 my-1.5 marker:text-onedark-accent/70 font-sans text-[13px] sm:text-[13.5px] leading-relaxed">
                    {block.items.map((item, iIdx) => (
                      <li key={iIdx} className="leading-relaxed pl-0.5">
                        {renderInline(item)}
                      </li>
                    ))}
                  </ol>
                );
              }

              if (block.type === 'h1' && block.content) {
                return (
                  <h1 key={bIdx} className="text-[15.5px] font-bold text-onedark-fgBright tracking-tight pt-3 pb-1 border-b border-onedark-borderSubtle/60">
                    {renderInline(block.content)}
                  </h1>
                );
              }

              if (block.type === 'h2' && block.content) {
                return (
                  <h2 key={bIdx} className="text-[14px] font-bold text-onedark-fgBright tracking-tight pt-2.5 pb-0.5">
                    {renderInline(block.content)}
                  </h2>
                );
              }

              if (block.type === 'h3' && block.content) {
                return (
                  <h3 key={bIdx} className="text-[13px] font-semibold text-onedark-fgBright pt-2 pb-0.5">
                    {renderInline(block.content)}
                  </h3>
                );
              }

              if (block.type === 'h4' && block.content) {
                return (
                  <h4 key={bIdx} className="text-[12px] font-bold text-onedark-accent pt-1.5 pb-0.5 uppercase tracking-wider">
                    {renderInline(block.content)}
                  </h4>
                );
              }

              if (block.type === 'h5' && block.content) {
                return (
                  <h5 key={bIdx} className="text-[11.5px] font-semibold text-onedark-fgBright pt-1 pb-0.5">
                    {renderInline(block.content)}
                  </h5>
                );
              }

              if (block.type === 'h6' && block.content) {
                return (
                  <h6 key={bIdx} className="text-[11px] font-semibold text-onedark-muted pt-1 pb-0.5 uppercase tracking-wider">
                    {renderInline(block.content)}
                  </h6>
                );
              }

              if (block.type === 'blockquote' && block.content) {
                return (
                  <blockquote key={bIdx} className="border-l-2 border-onedark-accent/70 pl-3 py-1 my-2 bg-onedark-surface/40 rounded-r-lg text-onedark-fg leading-relaxed text-[12.5px]">
                    {renderInline(block.content)}
                  </blockquote>
                );
              }

              if (block.content) {
                return (
                  <p key={bIdx} className="leading-relaxed">
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
    default:
      return { border: 'border-onedark-blue/40', bg: 'bg-onedark-blue/10', text: 'text-onedark-blue', icon: Info };
  }
}

interface BlockItem {
  type: 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'ul' | 'ol' | 'blockquote' | 'alert' | 'table' | 'hr';
  content?: string;
  items?: string[];
  alertType?: string;
  tableHeaders?: string[];
  tableRows?: string[][];
}

function parseBlocks(text: string): BlockItem[] {
  const lines = text.split('\n');
  const blocks: BlockItem[] = [];
  let currentList: { type: 'ul' | 'ol'; items: string[] } | null = null;
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
      blocks.push(currentList);
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
      // Gather subsequent blockquote lines
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
      // Check if it's separator row: | --- | --- |
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

    // Bullet list
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      flushParagraph();
      if (!currentList || currentList.type !== 'ul') {
        flushList();
        currentList = { type: 'ul', items: [] };
      }
      currentList.items.push(trimmed.slice(2));
      continue;
    }

    // Numbered list
    const numMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
    if (numMatch) {
      flushParagraph();
      if (!currentList || currentList.type !== 'ol') {
        flushList();
        currentList = { type: 'ol', items: [] };
      }
      currentList.items.push(numMatch[2]);
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
    .replace(/\\_/g, '_')
    // LaTeX arrows & math
    .replace(/\$\\to\$/g, '→')
    .replace(/\\to\b/g, '→')
    .replace(/\$\\leftarrow\$/g, '←')
    .replace(/\\leftarrow\b/g, '←')
    .replace(/\$\\Rightarrow\$/g, '⇒')
    .replace(/\\Rightarrow\b/g, '⇒')
    .replace(/\$\\iff\$/g, '⇔')
    .replace(/\\iff\b/g, '⇔')
    .replace(/\$\\approx\$/g, '≈')
    .replace(/\\approx\b/g, '≈')
    .replace(/\$\\neq\$/g, '≠')
    .replace(/\\neq\b/g, '≠')
    .replace(/\$\\le\$/g, '≤')
    .replace(/\\le\b/g, '≤')
    .replace(/\$\\ge\$/g, '≥')
    .replace(/\\ge\b/g, '≥')
    .replace(/\$\\times\$/g, '×')
    .replace(/\\times\b/g, '×');
}

function renderInline(rawText: string): React.ReactNode {
  const text = normalizeSpecialSymbols(rawText);

  // Match inline code (`...`), bold (**...** or __...__), strikethrough (~~...~~), italic (*...* or _..._), and links ([...](...))
  const tokens = text.split(/(`+[^`]+`+|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\*[^*]+\*|(?<!\w)_[^_]+_(?!\w)|\[[^\]]+\]\([^)]+\))/g);

  return tokens.map((token, i) => {
    if (!token) return null;

    // Inline code (`...` or ``...``)
    const codeMatch = token.match(/^(`+)([\s\S]+?)\1$/);
    if (codeMatch) {
      return (
        <code
          key={i}
          className="px-1.5 py-0.5 rounded bg-onedark-surface/80 border border-onedark-borderSubtle text-onedark-cyan font-mono text-[12px] font-medium tracking-tight mx-0.5 align-baseline select-text"
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
          {token.slice(2, -2)}
        </strong>
      );
    }

    // Strikethrough (~~...~~)
    if (token.startsWith('~~') && token.endsWith('~~') && token.length > 4) {
      return (
        <del key={i} className="line-through text-onedark-muted">
          {token.slice(2, -2)}
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
          {token.slice(1, -1)}
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

    return token;
  });
}
