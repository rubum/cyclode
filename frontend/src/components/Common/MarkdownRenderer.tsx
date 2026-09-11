import React, { useState } from 'react';
import { Copy, Check, Info, AlertTriangle, AlertCircle, Sparkles, Flame } from 'lucide-react';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, className = '' }) => {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const handleCopy = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  // Split by code blocks first
  const parts = content.split(/(```[\s\S]*?```)/g);

  return (
    <div className={`space-y-3 text-[13.5px] leading-relaxed text-onedark-fg font-sans ${className}`}>
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
            <div key={index} className="my-3 rounded-xl border border-onedark-border bg-onedark-darker overflow-hidden shadow-sm">
              <div className="flex items-center justify-between px-3.5 py-1.5 bg-onedark-surface/80 border-b border-onedark-border text-xs text-onedark-muted font-mono select-none">
                <div className="flex items-center space-x-2">
                  <span className="text-onedark-accent text-[11px] font-semibold uppercase">{language || 'code'}</span>
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
              <div className="flex font-mono text-[12.5px] leading-relaxed overflow-x-auto selection:bg-onedark-accent/30 p-3.5">
                {codeLines.length > 2 && (
                  <div className="select-none text-onedark-muted/60 text-right pr-3.5 border-r border-onedark-borderSubtle font-mono text-xs">
                    {codeLines.map((_, i) => (
                      <div key={i}>{i + 1}</div>
                    ))}
                  </div>
                )}
                <pre className={`text-onedark-fgBright font-mono ${codeLines.length > 2 ? 'pl-3.5' : ''}`}>
                  <code>{code}</code>
                </pre>
              </div>
            </div>
          );
        }

        // Parse standard text blocks (headings, lists, paragraphs, blockquotes, tables, alerts)
        const blocks = parseBlocks(part);
        return (
          <div key={index} className="space-y-2.5">
            {blocks.map((block, bIdx) => {
              if (block.type === 'alert') {
                const alertStyle = getAlertStyle(block.alertType || 'NOTE');
                const Icon = alertStyle.icon;
                return (
                  <div
                    key={bIdx}
                    className={`my-3 p-3.5 rounded-xl border ${alertStyle.border} ${alertStyle.bg} flex items-start space-x-3 text-xs leading-relaxed`}
                  >
                    <Icon className={`w-4 h-4 ${alertStyle.text} flex-shrink-0 mt-0.5`} />
                    <div className="space-y-1">
                      <div className={`font-bold font-mono text-[11px] uppercase tracking-wider ${alertStyle.text}`}>
                        {block.alertType}
                      </div>
                      <div className="text-onedark-fg">{renderInline(block.content || '')}</div>
                    </div>
                  </div>
                );
              }

              if (block.type === 'table' && block.tableRows) {
                return (
                  <div key={bIdx} className="my-3 overflow-x-auto rounded-xl border border-onedark-border bg-onedark-darker/60">
                    <table className="w-full text-left border-collapse text-xs">
                      {block.tableHeaders && (
                        <thead>
                          <tr className="bg-onedark-surface/60 border-b border-onedark-border text-onedark-fgBright font-semibold">
                            {block.tableHeaders.map((h, hIdx) => (
                              <th key={hIdx} className="px-3.5 py-2 font-mono">{renderInline(h)}</th>
                            ))}
                          </tr>
                        </thead>
                      )}
                      <tbody>
                        {block.tableRows.map((row, rIdx) => (
                          <tr key={rIdx} className="border-b border-onedark-borderSubtle last:border-0 hover:bg-onedark-surface/30">
                            {row.map((cell, cIdx) => (
                              <td key={cIdx} className="px-3.5 py-2 text-onedark-fg">{renderInline(cell)}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              }

              if (block.type === 'hr') {
                return <hr key={bIdx} className="border-t border-onedark-borderSubtle my-3" />;
              }

              if (block.type === 'ul' && block.items) {
                return (
                  <ul key={bIdx} className="list-disc list-outside pl-5 space-y-1.5 my-2 marker:text-onedark-accent">
                    {block.items.map((item, iIdx) => {
                      const isTaskUnchecked = item.startsWith('[ ] ');
                      const isTaskChecked = item.startsWith('[x] ') || item.startsWith('[X] ');
                      if (isTaskUnchecked || isTaskChecked) {
                        return (
                          <li key={iIdx} className="list-none -ml-5 flex items-start space-x-2 leading-relaxed">
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
                  <ol key={bIdx} className="list-decimal list-outside pl-5 space-y-1.5 my-2 marker:text-onedark-accent font-sans">
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
                  <h1 key={bIdx} className="text-lg font-bold text-onedark-fgBright pt-2 pb-1 border-b border-onedark-borderSubtle">
                    {renderInline(block.content)}
                  </h1>
                );
              }

              if (block.type === 'h2' && block.content) {
                return (
                  <h2 key={bIdx} className="text-base font-bold text-onedark-fgBright pt-2 pb-0.5">
                    {renderInline(block.content)}
                  </h2>
                );
              }

              if (block.type === 'h3' && block.content) {
                return (
                  <h3 key={bIdx} className="text-sm font-bold text-onedark-fgBright pt-1.5 pb-0.5">
                    {renderInline(block.content)}
                  </h3>
                );
              }

              if (block.type === 'h4' && block.content) {
                return (
                  <h4 key={bIdx} className="text-[13px] font-bold text-onedark-accent pt-1 pb-0.5 uppercase tracking-wide">
                    {renderInline(block.content)}
                  </h4>
                );
              }

              if (block.type === 'h5' && block.content) {
                return (
                  <h5 key={bIdx} className="text-xs font-semibold text-onedark-fgBright pt-1 pb-0.5">
                    {renderInline(block.content)}
                  </h5>
                );
              }

              if (block.type === 'h6' && block.content) {
                return (
                  <h6 key={bIdx} className="text-xs font-semibold text-onedark-muted pt-1 pb-0.5 uppercase tracking-wider">
                    {renderInline(block.content)}
                  </h6>
                );
              }

              if (block.type === 'blockquote' && block.content) {
                return (
                  <blockquote key={bIdx} className="border-l-2 border-onedark-accent/60 pl-3.5 py-1.5 my-2 bg-onedark-surface/30 rounded-r-lg text-onedark-fg leading-relaxed">
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

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      if (currentList) {
        blocks.push(currentList);
        currentList = null;
      }
      if (currentTable) {
        blocks.push({ type: 'table', tableHeaders: currentTable.headers, tableRows: currentTable.rows });
        currentTable = null;
      }
      continue;
    }

    // Horizontal Rule
    if (trimmed === '---' || trimmed === '***' || trimmed === '___') {
      if (currentList) { blocks.push(currentList); currentList = null; }
      if (currentTable) { blocks.push({ type: 'table', tableHeaders: currentTable.headers, tableRows: currentTable.rows }); currentTable = null; }
      blocks.push({ type: 'hr' });
      continue;
    }

    // GitHub Alert: > [!NOTE], > [!WARNING], > [!TIP]
    const alertMatch = trimmed.match(/^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i);
    if (alertMatch) {
      if (currentList) { blocks.push(currentList); currentList = null; }
      if (currentTable) { blocks.push({ type: 'table', tableHeaders: currentTable.headers, tableRows: currentTable.rows }); currentTable = null; }
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
      blocks.push({ type: 'table', tableHeaders: currentTable.headers, tableRows: currentTable.rows });
      currentTable = null;
    }

    // Bullet list
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      if (!currentList || currentList.type !== 'ul') {
        if (currentList) blocks.push(currentList);
        currentList = { type: 'ul', items: [] };
      }
      currentList.items.push(trimmed.slice(2));
      continue;
    }

    // Numbered list
    const numMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
    if (numMatch) {
      if (!currentList || currentList.type !== 'ol') {
        if (currentList) blocks.push(currentList);
        currentList = { type: 'ol', items: [] };
      }
      currentList.items.push(numMatch[2]);
      continue;
    }

    // End list if ongoing
    if (currentList) {
      blocks.push(currentList);
      currentList = null;
    }

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
    } else {
      blocks.push({ type: 'p', content: line });
    }
  }

  if (currentList) blocks.push(currentList);
  if (currentTable) blocks.push({ type: 'table', tableHeaders: currentTable.headers, tableRows: currentTable.rows });

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
          className="px-1.5 py-0.5 rounded bg-onedark-surface border border-onedark-border text-onedark-accent font-mono text-[12px]"
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
