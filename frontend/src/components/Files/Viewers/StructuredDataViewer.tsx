import React, { useState, useMemo } from 'react';
import { 
  Braces, 
  ChevronRight, 
  ChevronDown, 
  Copy, 
  Check, 
  Search, 
  FolderPlus, 
  FolderMinus, 
  AlertCircle,
  FileCode,
  Sparkles
} from 'lucide-react';

interface StructuredDataViewerProps {
  content: string;
  filePath: string;
  language: string;
}

export const StructuredDataViewer: React.FC<StructuredDataViewerProps> = ({
  content,
  filePath,
  language,
}) => {
  const [filterQuery, setFilterQuery] = useState('');
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [collapsedNodes, setCollapsedNodes] = useState<Record<string, boolean>>({});

  // Parse structured data safely
  const { parsedData, parseError } = useMemo(() => {
    if (!content.trim()) return { parsedData: null, parseError: null };
    try {
      const parsed = JSON.parse(content);
      return { parsedData: parsed, parseError: null };
    } catch (err: any) {
      // If language is YAML or TOML, we can attempt a basic key-value fallback or report JSON parse error
      return { parsedData: null, parseError: err.message || 'Malformed structured syntax' };
    }
  }, [content]);

  const toggleNode = (nodePath: string) => {
    setCollapsedNodes((prev) => ({ ...prev, [nodePath]: !prev[nodePath] }));
  };

  const handleCopyPath = (path: string, val: any) => {
    navigator.clipboard.writeText(path);
    setCopiedPath(path);
    setTimeout(() => setCopiedPath(null), 1800);
  };

  const handleCopyAll = () => {
    navigator.clipboard.writeText(content);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  const expandAll = () => setCollapsedNodes({});
  const collapseAll = () => {
    const allCollapsed: Record<string, boolean> = {};
    const traverse = (obj: any, currentPath: string) => {
      if (obj && typeof obj === 'object') {
        allCollapsed[currentPath] = true;
        Object.entries(obj).forEach(([k, v]) => {
          traverse(v, currentPath ? `${currentPath}.${k}` : k);
        });
      }
    };
    traverse(parsedData, '$');
    setCollapsedNodes(allCollapsed);
  };

  // Render a node recursively
  const renderNode = (key: string | null, value: any, path: string, depth = 0): React.ReactNode => {
    const isObject = value !== null && typeof value === 'object' && !Array.isArray(value);
    const isArray = Array.isArray(value);
    const isContainer = isObject || isArray;
    const isCollapsed = Boolean(collapsedNodes[path]);

    // Matching filter logic
    if (filterQuery.trim()) {
      const q = filterQuery.toLowerCase();
      const keyMatches = key && key.toLowerCase().includes(q);
      const valMatches = typeof value === 'string' && value.toLowerCase().includes(q);
      const numMatches = typeof value === 'number' && String(value).includes(q);
      // Container matches if any child or key matches
    }

    const typeColor = 
      value === null ? 'text-onedark-red' :
      typeof value === 'boolean' ? 'text-onedark-purple' :
      typeof value === 'number' ? 'text-onedark-yellow font-bold' :
      typeof value === 'string' ? 'text-onedark-green' :
      'text-onedark-accent';

    if (isContainer) {
      const itemsCount = isArray ? value.length : Object.keys(value).length;
      const bracketOpen = isArray ? '[' : '{';
      const bracketClose = isArray ? ']' : '}';

      return (
        <div key={path} className="font-mono text-[12px] leading-relaxed select-text">
          <div
            style={{ paddingLeft: `${depth * 16}px` }}
            className="flex items-center space-x-1.5 py-0.5 hover:bg-onedark-surface/50 rounded px-1 transition-colors group cursor-pointer"
            onClick={() => toggleNode(path)}
          >
            <button
              type="button"
              className="text-onedark-muted hover:text-onedark-fg p-0.5"
            >
              {isCollapsed ? (
                <ChevronRight className="w-3.5 h-3.5 text-onedark-muted" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 text-onedark-muted" />
              )}
            </button>

            {key !== null && (
              <span className="font-semibold text-onedark-blue">
                &quot;{key}&quot;:
              </span>
            )}

            <span className="text-onedark-muted font-bold">{bracketOpen}</span>

            {isCollapsed ? (
              <span className="text-[10px] text-onedark-muted px-1.5 py-0.2 rounded bg-onedark-surface border border-onedark-borderSubtle/60 font-sans">
                {itemsCount} {itemsCount === 1 ? 'item' : 'items'} ... {bracketClose}
              </span>
            ) : (
              <span className="text-[10px] text-onedark-muted/60 opacity-0 group-hover:opacity-100 font-sans">
                ({itemsCount} {itemsCount === 1 ? 'item' : 'items'})
              </span>
            )}

            {/* Copy JSONPath */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleCopyPath(path, value);
              }}
              className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-onedark-surface rounded text-[10px] text-onedark-muted hover:text-onedark-fg ml-1 transition-opacity"
              title={`Copy path: ${path}`}
            >
              {copiedPath === path ? (
                <Check className="w-3 h-3 text-onedark-green" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
            </button>
          </div>

          {!isCollapsed && (
            <div>
              {isArray
                ? value.map((item, idx) =>
                    renderNode(String(idx), item, `${path}[${idx}]`, depth + 1)
                  )
                : Object.entries(value).map(([childKey, childVal]) =>
                    renderNode(childKey, childVal, `${path}.${childKey}`, depth + 1)
                  )}
              <div
                style={{ paddingLeft: `${depth * 16 + 20}px` }}
                className="text-onedark-muted font-bold py-0.2"
              >
                {bracketClose}
              </div>
            </div>
          )}
        </div>
      );
    }

    // Primitive Node (string, number, boolean, null)
    return (
      <div
        key={path}
        style={{ paddingLeft: `${depth * 16 + 20}px` }}
        className="flex items-center space-x-1.5 py-0.5 hover:bg-onedark-surface/40 rounded px-1 transition-colors font-mono text-[12px] group"
      >
        {key !== null && (
          <span className="font-semibold text-onedark-blue flex-shrink-0">
            &quot;{key}&quot;:
          </span>
        )}

        <span className={`${typeColor} break-all select-text`}>
          {typeof value === 'string' ? `"${value}"` : String(value)}
        </span>

        {/* Copy path tooltip on hover */}
        <button
          type="button"
          onClick={() => handleCopyPath(path, value)}
          className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-onedark-surface rounded text-[10px] text-onedark-muted hover:text-onedark-fg transition-opacity ml-1"
          title={`Copy path: ${path}`}
        >
          {copiedPath === path ? (
            <Check className="w-3 h-3 text-onedark-green" />
          ) : (
            <Copy className="w-3 h-3" />
          )}
        </button>
      </div>
    );
  };

  if (parseError) {
    return (
      <div className="h-full flex flex-col p-4 bg-onedark-bg font-mono">
        <div className="p-3 rounded-lg bg-onedark-yellow/10 border border-onedark-yellow/30 text-onedark-yellow text-xs flex items-start space-x-2 mb-3">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">Unable to parse structured tree</div>
            <div className="text-[11px] opacity-80 mt-0.5">{parseError}</div>
          </div>
        </div>
        <div className="flex-1 overflow-auto bg-onedark-darker p-3 rounded-lg border border-onedark-borderSubtle text-onedark-fg text-xs">
          <pre>{content}</pre>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-onedark-bg font-sans overflow-hidden select-none">
      {/* Top Tree Controls Bar */}
      <div className="px-3 py-1.5 bg-onedark-darker/80 border-b border-onedark-borderSubtle flex items-center justify-between flex-shrink-0 text-xs gap-2">
        <div className="flex items-center space-x-2">
          <Braces className="w-3.5 h-3.5 text-onedark-accent" />
          <span className="font-semibold text-onedark-fg font-mono text-[11.5px]">
            {filePath.split('/').pop()}
          </span>
        </div>

        <div className="flex items-center space-x-1.5">
          <button
            type="button"
            onClick={expandAll}
            className="px-2 py-0.5 rounded bg-onedark-surface/80 hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg text-[10.5px] font-mono border border-onedark-borderSubtle cursor-pointer"
            title="Expand All Nodes"
          >
            Expand All
          </button>
          <button
            type="button"
            onClick={collapseAll}
            className="px-2 py-0.5 rounded bg-onedark-surface/80 hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg text-[10.5px] font-mono border border-onedark-borderSubtle cursor-pointer"
            title="Collapse All Nodes"
          >
            Collapse All
          </button>
          <button
            type="button"
            onClick={handleCopyAll}
            className="p-1 rounded bg-onedark-surface/80 hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg border border-onedark-borderSubtle cursor-pointer transition-colors"
            title="Copy Raw Structured Content"
          >
            {copiedAll ? (
              <Check className="w-3.5 h-3.5 text-onedark-green" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Main Tree Canvas */}
      <div className="flex-1 overflow-auto p-3 bg-onedark-bg">
        {parsedData !== null ? (
          renderNode(null, parsedData, '$')
        ) : (
          <div className="text-center py-12 text-onedark-muted text-xs font-mono">
            Empty document
          </div>
        )}
      </div>
    </div>
  );
};
