import React, { useState } from 'react';
import { Copy, Check, Info, AlertTriangle, AlertCircle, Sparkles, Flame } from 'lucide-react';
import Prism from 'prismjs';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-diff';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-markup';

interface MarkdownRendererProps {
  content: string;
  className?: string;
  isStreaming?: boolean;
}

function getHighlightedHtml(code: string, lang: string): string {
  const normLang = (lang || '').toLowerCase().trim();
  let grammar: Prism.Grammar | undefined;
  let prismLang = 'text';

  if (normLang === 'ts' || normLang === 'typescript') {
    grammar = Prism.languages.typescript;
    prismLang = 'typescript';
  } else if (normLang === 'js' || normLang === 'javascript') {
    grammar = Prism.languages.javascript;
    prismLang = 'javascript';
  } else if (normLang === 'tsx') {
    grammar = Prism.languages.tsx;
    prismLang = 'tsx';
  } else if (normLang === 'jsx') {
    grammar = Prism.languages.jsx;
    prismLang = 'jsx';
  } else if (normLang === 'py' || normLang === 'python') {
    grammar = Prism.languages.python;
    prismLang = 'python';
  } else if (normLang === 'sh' || normLang === 'bash' || normLang === 'shell' || normLang === 'zsh') {
    grammar = Prism.languages.bash;
    prismLang = 'bash';
  } else if (normLang === 'json') {
    grammar = Prism.languages.json;
    prismLang = 'json';
  } else if (normLang === 'yaml' || normLang === 'yml') {
    grammar = Prism.languages.yaml;
    prismLang = 'yaml';
  } else if (normLang === 'sql') {
    grammar = Prism.languages.sql;
    prismLang = 'sql';
  } else if (normLang === 'diff') {
    grammar = Prism.languages.diff;
    prismLang = 'diff';
  } else if (normLang === 'md' || normLang === 'markdown') {
    grammar = Prism.languages.markdown;
    prismLang = 'markdown';
  } else if (normLang === 'css') {
    grammar = Prism.languages.css;
    prismLang = 'css';
  } else if (normLang === 'html' || normLang === 'xml' || normLang === 'svg' || normLang === 'markup') {
    grammar = Prism.languages.markup;
    prismLang = 'markup';
  } else if (Prism.languages[normLang]) {
    grammar = Prism.languages[normLang];
    prismLang = normLang;
  }

  if (grammar) {
    try {
      return Prism.highlight(code, grammar, prismLang);
    } catch {
      // fallback to escaped html
    }
  }

  return code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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
    <div className={`space-y-3.5 text-[15px] leading-[1.7] text-onedark-fg font-sans ${className}`}>
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
            <div key={index} className="my-3.5 rounded-xl border border-onedark-border bg-onedark-darker overflow-hidden shadow-sm">
              <div className="flex items-center justify-between px-3.5 py-1.5 bg-onedark-surface/80 border-b border-onedark-border text-xs text-onedark-muted font-mono select-none">
                <div className="flex items-center space-x-2">
                  <span className="text-onedark-accent text-[11.5px] font-semibold uppercase">{language || 'code'}</span>
                  <span className="text-[10.5px] text-onedark-muted">({codeLines.length} line{codeLines.length > 1 ? 's' : ''})</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleCopy(code, index)}
                  className="flex items-center space-x-1 hover:text-onedark-fgBright transition-colors px-2 py-0.5 rounded hover:bg-onedark-surface"
                >
                  {copiedIndex === index ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-onedark-green" />
                      <span className="text-[11px] text-onedark-green">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span className="text-[11px]">Copy</span>
                    </>
                  )}
                </button>
              </div>
              <div className="flex font-mono text-[13px] leading-[1.65] overflow-x-auto selection:bg-onedark-accent/30 p-3.5">
                {codeLines.length > 2 && (
                  <div className="select-none text-onedark-muted/50 text-right pr-3.5 border-r border-onedark-borderSubtle font-mono text-xs flex-shrink-0">
                    {codeLines.map((_, i) => (
                      <div key={i}>{i + 1}</div>
                    ))}
                  </div>
                )}
                <pre className={`text-onedark-fg font-mono ${codeLines.length > 2 ? 'pl-3.5' : ''} flex-1 overflow-x-auto`}>
                  <code
                    className={`language-${language || 'text'} font-mono leading-[1.65]`}
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
          <div key={index} className="space-y-3">
            {blocks.map((block, bIdx) => {
              if (block.type === 'alert') {
                const alertStyle = getAlertStyle(block.alertType || 'NOTE');
                const Icon = alertStyle.icon;
                return (
                  <div
                    key={bIdx}
                    className={`my-3.5 p-4 rounded-xl border ${alertStyle.border} ${alertStyle.bg} flex items-start space-x-3 text-[14px] leading-relaxed`}
                  >
                    <Icon className={`w-4 h-4 ${alertStyle.text} flex-shrink-0 mt-0.5`} />
                    <div className="space-y-1">
                      <div className={`font-bold font-mono text-[11.5px] uppercase tracking-wider ${alertStyle.text}`}>
                        {block.alertType}
                      </div>
                      <div className="text-onedark-fg">{renderInline(block.content || '')}</div>
                    </div>
                  </div>
                );
              }

              if (block.type === 'table' && block.tableRows) {
                return (
                  <div key={bIdx} className="my-3.5 overflow-x-auto rounded-xl border border-onedark-border bg-onedark-darker/60">
                    <table className="w-full text-left border-collapse text-[13.5px]">
                      {block.tableHeaders && (
                        <thead>
                          <tr className="bg-onedark-surface/60 border-b border-onedark-border text-onedark-fgBright font-semibold">
                            {block.tableHeaders.map((h, hIdx) => (
                              <th key={hIdx} className="px-4 py-2.5 font-mono">{renderInline(h)}</th>
                            ))}
                          </tr>
                        </thead>
                      )}
                      <tbody>
                        {block.tableRows.map((row, rIdx) => (
                          <tr key={rIdx} className="border-b border-onedark-borderSubtle last:border-0 hover:bg-onedark-surface/30">
                            {row.map((cell, cIdx) => (
                              <td key={cIdx} className="px-4 py-2.5 text-onedark-fg">{renderInline(cell)}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              }

              if (block.type === 'hr') {
                return <hr key={bIdx} className="border-t border-onedark-borderSubtle my-4" />;
              }

              if (block.type === 'ul' && block.items) {
                return (
                  <ul key={bIdx} className="list-disc list-outside pl-6 space-y-2.5 my-2.5 marker:text-onedark-muted/80 text-[15px] leading-[1.7]">
                    {block.items.map((item, iIdx) => {
                      const isTaskUnchecked = item.startsWith('[ ] ');
                      const isTaskChecked = item.startsWith('[x] ') || item.startsWith('[X] ');
                      if (isTaskUnchecked || isTaskChecked) {
                        return (
                          <li key={iIdx} className="list-none -ml-6 flex items-start space-x-2.5 leading-[1.7]">
                            <input
                              type="checkbox"
                              readOnly
                              checked={isTaskChecked}
                              className="mt-1 rounded border-onedark-border bg-onedark-darker text-onedark-accent focus:ring-0 focus:ring-offset-0 cursor-default"
                            />
                            <span>{renderInline(item.slice(4))}</span>
                          </li>
                        );
                      }
                      return (
                        <li key={iIdx} className="leading-[1.7] pl-1">
                          {renderInline(item)}
                        </li>
                      );
                    })}
                  </ul>
                );
              }

              if (block.type === 'ol' && block.items) {
                return (
                  <ol key={bIdx} className="list-decimal list-outside pl-6 space-y-2.5 my-2.5 marker:text-onedark-muted font-sans text-[15px] leading-[1.7]">
                    {block.items.map((item, iIdx) => (
                      <li key={iIdx} className="leading-[1.7] pl-1">
                        {renderInline(item)}
                      </li>
                    ))}
                  </ol>
                );
              }

              if (block.type === 'h1' && block.content) {
                return (
                  <h1 key={bIdx} className="text-[19px] font-bold text-onedark-fgBright pt-3 pb-1 tracking-tight">
                    {renderInline(block.content)}
                  </h1>
                );
              }

              if (block.type === 'h2' && block.content) {
                return (
                  <h2 key={bIdx} className="text-[17.5px] font-bold text-onedark-fgBright pt-3 pb-1 tracking-tight">
                    {renderInline(block.content)}
                  </h2>
                );
              }

              if (block.type === 'h3' && block.content) {
                return (
                  <h3 key={bIdx} className="text-[16px] font-semibold text-onedark-fgBright pt-2.5 pb-0.5">
                    {renderInline(block.content)}
                  </h3>
                );
              }

              if (block.type === 'h4' && block.content) {
                return (
                  <h4 key={bIdx} className="text-[15px] font-semibold text-onedark-accent pt-2 pb-0.5 uppercase tracking-wide">
                    {renderInline(block.content)}
                  </h4>
                );
              }

              if (block.type === 'h5' && block.content) {
                return (
                  <h5 key={bIdx} className="text-[14.5px] font-semibold text-onedark-fgBright pt-1.5 pb-0.5">
                    {renderInline(block.content)}
                  </h5>
                );
              }

              if (block.type === 'h6' && block.content) {
                return (
                  <h6 key={bIdx} className="text-[14px] font-semibold text-onedark-muted pt-1 pb-0.5 uppercase tracking-wider">
                    {renderInline(block.content)}
                  </h6>
                );
              }

              if (block.type === 'blockquote' && block.content) {
                return (
                  <blockquote key={bIdx} className="border-l-2 border-onedark-accent/60 pl-4 py-1.5 my-2.5 bg-onedark-surface/30 rounded-r-lg text-onedark-fg text-[15px] leading-[1.7]">
                    {renderInline(block.content)}
                  </blockquote>
                );
              }

              if (block.content) {
                return (
                  <p key={bIdx} className="leading-[1.7] text-[15px] text-onedark-fg">
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

function renderInline(text: string): React.ReactNode {
  // Regex for inline code, bold, italic, links
  const tokens = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g);

  return tokens.map((token, i) => {
    if (token.startsWith('`') && token.endsWith('`') && token.length > 2) {
      return (
        <code
          key={i}
          className="px-2 py-0.5 mx-0.5 rounded-md bg-onedark-darker/90 border border-onedark-borderSubtle text-[#e5c07b] font-mono text-[13.5px] inline-block font-normal shadow-2xs"
        >
          {token.slice(1, -1)}
        </code>
      );
    }
    if (token.startsWith('**') && token.endsWith('**') && token.length > 4) {
      return (
        <strong key={i} className="font-semibold text-onedark-fgBright">
          {token.slice(2, -2)}
        </strong>
      );
    }
    if (token.startsWith('*') && token.endsWith('*') && token.length > 2) {
      return <em key={i} className="italic text-onedark-fgBright">{token.slice(1, -1)}</em>;
    }
    const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      return (
        <a
          key={i}
          href={linkMatch[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-onedark-accent underline hover:text-onedark-accent/80 transition-colors font-medium"
        >
          {linkMatch[1]}
        </a>
      );
    }
    return token;
  });
}
