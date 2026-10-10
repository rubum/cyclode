import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import mermaid from 'mermaid';
import {
  Copy,
  Check,
  Download,
  AlertCircle,
  Maximize2,
  Minimize2,
  ArrowLeftRight,
  Sparkles,
  ZoomIn,
  ZoomOut,
  RotateCcw
} from 'lucide-react';
import { useThemeObserver } from '../Charts/ChartTheme';

interface MermaidDiagramProps {
  code: string;
  className?: string;
  isStreaming?: boolean;
}

/**
 * Sanitizes and normalizes raw Mermaid diagram text:
 * - Strips leading/trailing markdown code fences (```mermaid ... ```)
 * - Strips standalone 'mermaid' header keywords
 * - Injects missing diagram declarations (e.g. flowchart TD)
 * - Auto-quotes unquoted node labels containing special chars, pipes (|), HTML breaks (<br/>), etc.
 * - Heals mismatched or dangling double quotes
 */
export function sanitizeMermaidCode(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  let code = raw.trim();

  // 1. Strip leading and trailing markdown code fences
  code = code.replace(/^`{3,}(?:mermaid)?\s*\n?/i, '');
  code = code.replace(/\n?`{3,}\s*$/i, '');
  code = code.trim();

  // 2. Strip standalone 'mermaid' header line if present
  const firstLine = code.split('\n')[0].trim();
  if (/^mermaid\s*$/i.test(firstLine)) {
    code = code.replace(/^mermaid\s*\n?/i, '').trim();
  }

  // 3. Check for recognized diagram keywords
  const diagramKeywords = [
    'flowchart', 'graph', 'sequenceDiagram', 'classDiagram', 'stateDiagram',
    'stateDiagram-v2', 'erDiagram', 'gantt', 'pie', 'gitGraph', 'journey',
    'mindmap', 'quadrantChart', 'timeline', 'xychart-beta', 'c4context',
    'c4container', 'c4component', 'c4dynamic', 'c4deployment', 'sankey-beta',
    'packet-beta', 'kanban', 'architecture-beta', 'block-beta', 'requirementDiagram'
  ];

  const firstNonEmptyLine = code.split('\n').map(l => l.trim()).find(l => l.length > 0 && !l.startsWith('%%')) || '';
  const firstWord = firstNonEmptyLine.split(/[\s\t\n({[]/)[0];

  const hasDiagramType = diagramKeywords.some(kw => 
    firstWord.toLowerCase() === kw.toLowerCase() ||
    firstNonEmptyLine.toLowerCase().startsWith(kw.toLowerCase())
  );

  if (!hasDiagramType) {
    // If it looks like a flowchart or graph (has arrows or node brackets), prepend flowchart TD
    if (/-->|---|==>|-\.->|\[.*\]|\(.*\)/.test(code)) {
      code = 'flowchart TD\n' + code;
    }
  }

  // 4. Sanitize node labels in flowchart/graph diagrams
  const lines = code.split('\n');
  const sanitizedLines = lines.map(line => {
    // Preserve comments and style directives
    if (line.trim().startsWith('%%') || line.trim().startsWith('style ') || line.trim().startsWith('classDef ')) {
      return line;
    }

    let l = line;

    // Fix stadium ([ ... ])
    l = l.replace(/([a-zA-Z0-9_.-]+)\(\[\s*([^\n\r]*?)\s*\]\)/g, (_, id, content) => {
      let clean = content.trim().replace(/^"+|"+$/g, '').replace(/"/g, "'");
      return `${id}(["${clean}"])`;
    });

    // Fix cylinder [( ... )]
    l = l.replace(/([a-zA-Z0-9_.-]+)\[\(\s*([^\n\r]*?)\s*\)\]/g, (_, id, content) => {
      let clean = content.trim().replace(/^"+|"+$/g, '').replace(/"/g, "'");
      return `${id}[("${clean}")]`;
    });

    // Fix circle (( ... ))
    l = l.replace(/([a-zA-Z0-9_.-]+)\(\(\s*([^\n\r]*?)\s*\)\)/g, (_, id, content) => {
      let clean = content.trim().replace(/^"+|"+$/g, '').replace(/"/g, "'");
      return `${id}(("${clean}"))`;
    });

    // Fix round ( ... )
    l = l.replace(/([a-zA-Z0-9_.-]+)\((?![\(\[])\s*([^\n\r)]*?)\s*(?<![\)\]])\)/g, (match, id, content) => {
      let clean = content.trim();
      if (clean.startsWith('"') && clean.endsWith('"') && (clean.match(/"/g) || []).length === 2) return match;
      clean = clean.replace(/^"+|"+$/g, '').replace(/"/g, "'");
      return `${id}("${clean}")`;
    });

    // Fix rhombus { ... }
    l = l.replace(/([a-zA-Z0-9_.-]+)\{\s*([^\n\r{}]+?)\s*\}/g, (match, id, content) => {
      let clean = content.trim();
      if (clean.startsWith('"') && clean.endsWith('"') && (clean.match(/"/g) || []).length === 2) return match;
      clean = clean.replace(/^"+|"+$/g, '').replace(/"/g, "'");
      return `${id}{"${clean}"}`;
    });

    // Fix square brackets [ ... ] - must NOT match cylinder [( ... )]
    l = l.replace(/([a-zA-Z0-9_.-]+)\[(?!\()\s*([^\n\r\]]*?)\s*(?<!\))\]/g, (match, id, content) => {
      let clean = content.trim();
      if (clean.startsWith('"') && clean.endsWith('"') && (clean.match(/"/g) || []).length === 2) {
        return match;
      }
      clean = clean.replace(/^"+|"+$/g, '').replace(/"/g, "'");
      return `${id}["${clean}"]`;
    });

    return l;
  });

  return sanitizedLines.join('\n');
}

/**
 * Secondary aggressive fallback repair when the primary sanitized render throws an error.
 * Strips dangling edge connectors and cleans malformed lines.
 */
export function repairMermaidAggressive(code: string): string {
  const lines = code.split('\n');
  const cleaned: string[] = [];

  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line) continue;
    // Remove dangling arrows at end of line (e.g. "A -->")
    line = line.replace(/(?:-->|---|==>|-\.->)\s*$/, '').trim();
    if (!line) continue;
    cleaned.push(line);
  }

  return cleaned.join('\n');
}

/**
 * Extracts coordinate viewBox width and height from Mermaid SVG string.
 */
function extractSvgDimensions(svgString: string): { width: number; height: number } | null {
  if (!svgString) return null;
  const match = svgString.match(/viewBox=["']\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*["']/i);
  if (match) {
    const width = parseFloat(match[3]);
    const height = parseFloat(match[4]);
    if (!isNaN(width) && !isNaN(height) && width > 0 && height > 0) {
      return { width, height };
    }
  }
  return null;
}

/**
 * Re-configures Mermaid with theme-specific variables tailored for either
 * crisp light-mode or deep OneDark dark-mode, inheriting the active accent color.
 */
function configureMermaid(isLight: boolean, accentColor: string) {
  mermaid.initialize({
    startOnLoad: false,
    suppressErrorRendering: true,
    theme: 'base',
    themeVariables: isLight
      ? {
          darkMode: false,
          background: 'transparent',
          mainBkg: '#FFFFFF',
          primaryColor: '#FFFFFF',
          primaryTextColor: '#0F172A',
          primaryBorderColor: accentColor || '#D97706',
          lineColor: accentColor || '#475569',
          secondaryColor: '#F8FAFC',
          secondaryTextColor: '#0F172A',
          secondaryBorderColor: '#CBD5E1',
          tertiaryColor: '#FFFFFF',
          tertiaryTextColor: '#0F172A',
          tertiaryBorderColor: '#E2E8F0',
          edgeLabelBackground: '#FFFFFF',
          nodeBorder: '#CBD5E1',
          nodeTextColor: '#0F172A',
          clusterBkg: '#F8FAFC',
          clusterBorder: '#CBD5E1',
          defaultLinkColor: accentColor || '#475569',
          titleColor: '#0F172A',
          fontFamily: 'Inter, -apple-system, sans-serif',
          fontSize: '12px',
          actorBkg: '#FFFFFF',
          actorBorder: accentColor || '#D97706',
          actorTextColor: '#0F172A',
          actorLineColor: '#64748B',
          signalColor: accentColor || '#475569',
          signalTextColor: '#0F172A',
          labelBoxBkgColor: '#FFFFFF',
          labelBoxBorderColor: '#CBD5E1',
          labelTextColor: '#0F172A',
          loopTextColor: '#0F172A',
          noteBorderColor: '#E2E8F0',
          noteBkgColor: '#FEF3C7',
          noteTextColor: '#92400E',
        }
      : {
          darkMode: true,
          background: 'transparent',
          mainBkg: '#2C313A',
          primaryColor: '#2C313A',
          primaryTextColor: '#F1F5F9',
          primaryBorderColor: accentColor || '#61AFEF',
          lineColor: accentColor || '#61AFEF',
          secondaryColor: '#282C34',
          secondaryTextColor: '#F1F5F9',
          secondaryBorderColor: '#3E4451',
          tertiaryColor: '#21252B',
          tertiaryTextColor: '#F1F5F9',
          tertiaryBorderColor: '#3E4451',
          edgeLabelBackground: '#21252B',
          nodeBorder: '#3E4451',
          nodeTextColor: '#F1F5F9',
          clusterBkg: '#21252B',
          clusterBorder: '#3E4451',
          defaultLinkColor: accentColor || '#61AFEF',
          titleColor: '#F1F5F9',
          fontFamily: 'Inter, -apple-system, sans-serif',
          fontSize: '12px',
          actorBkg: '#2C313A',
          actorBorder: accentColor || '#61AFEF',
          actorTextColor: '#F1F5F9',
          actorLineColor: '#5C6370',
          signalColor: accentColor || '#61AFEF',
          signalTextColor: '#F1F5F9',
          labelBoxBkgColor: '#21252B',
          labelBoxBorderColor: '#3E4451',
          labelTextColor: '#F1F5F9',
          loopTextColor: '#F1F5F9',
          noteBorderColor: '#4B5263',
          noteBkgColor: '#3E4451',
          noteTextColor: '#E5C07B',
        },
    securityLevel: 'strict',
    fontFamily: 'Inter, -apple-system, sans-serif',
  });
}

export const MermaidDiagram: React.FC<MermaidDiagramProps> = ({ code, className = '', isStreaming = false }) => {
  const [svgHtml, setSvgHtml] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [isFullWidth, setIsFullWidth] = useState<boolean>(false);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const modalCanvasRef = useRef<HTMLDivElement>(null);

  // Zoom & Pan state for inspection modal
  const [zoom, setZoom] = useState<number>(1.0);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragStartRef = useRef<{ x: number; y: number; panX: number; panY: number }>({ x: 0, y: 0, panX: 0, panY: 0 });

  const svgDims = useMemo(() => extractSvgDimensions(svgHtml), [svgHtml]);

  const { isLight, accentColor } = useThemeObserver();
  const cleanCode = useMemo(() => sanitizeMermaidCode(code), [code]);

  // Calculate zoom scale needed to fit the diagram inside modal viewport
  const calculateFitZoom = useCallback(() => {
    if (!modalCanvasRef.current || !svgDims) return 1.0;
    const rect = modalCanvasRef.current.getBoundingClientRect();
    const padding = 72;
    const scaleX = (rect.width - padding) / svgDims.width;
    const scaleY = (rect.height - padding) / svgDims.height;
    const fit = Math.min(Math.max(Math.min(scaleX, scaleY), 0.2), 2.0);
    return Number(fit.toFixed(2));
  }, [svgDims]);

  const handleFitView = useCallback(() => {
    const fit = calculateFitZoom();
    setZoom(fit);
    setPan({ x: 0, y: 0 });
  }, [calculateFitZoom]);

  const handleResetZoom = useCallback(() => {
    setZoom(1.0);
    setPan({ x: 0, y: 0 });
  }, []);

  // When modal opens, initialize zoom scale and center pan
  useEffect(() => {
    if (isModalOpen) {
      setPan({ x: 0, y: 0 });
      const rafId = requestAnimationFrame(() => {
        const fit = calculateFitZoom();
        // If diagram fits comfortably (>= 70%), use fit; otherwise default to 1.0 for immediate readability
        setZoom(fit >= 0.7 ? fit : 1.0);
      });
      return () => cancelAnimationFrame(rafId);
    }
  }, [isModalOpen, calculateFitZoom]);

  // Non-passive wheel event listener for smooth zoom centered at cursor
  useEffect(() => {
    if (!isModalOpen || !modalCanvasRef.current) return;
    const canvasEl = modalCanvasRef.current;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvasEl.getBoundingClientRect();
      const delta = -e.deltaY;
      const factor = Math.exp(delta * 0.002);

      setZoom((prevZoom) => {
        const newZoom = Math.min(Math.max(0.2, Number((prevZoom * factor).toFixed(3))), 5.0);
        if (newZoom === prevZoom) return prevZoom;

        // Position of cursor relative to canvas center
        const cursorX = e.clientX - (rect.left + rect.width / 2);
        const cursorY = e.clientY - (rect.top + rect.height / 2);

        setPan((prevPan) => ({
          x: Math.round(cursorX - (cursorX - prevPan.x) * (newZoom / prevZoom)),
          y: Math.round(cursorY - (cursorY - prevPan.y) * (newZoom / prevZoom)),
        }));

        return newZoom;
      });
    };

    canvasEl.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      canvasEl.removeEventListener('wheel', handleWheel);
    };
  }, [isModalOpen]);

  // Pointer drag panning handlers
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return; // Only left-click
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: pan.x,
      panY: pan.y,
    };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setPan({
      x: Math.round(dragStartRef.current.panX + dx),
      y: Math.round(dragStartRef.current.panY + dy),
    });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    setIsDragging(false);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    } catch {
      // Ignored if capture already released
    }
  };

  // Double click toggles between 100% and fit
  const handleDoubleClick = () => {
    if (Math.abs(zoom - 1.0) > 0.08) {
      handleResetZoom();
    } else {
      handleFitView();
    }
  };

  // Keyboard navigation when modal is open
  useEffect(() => {
    if (!isModalOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsModalOpen(false);
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        setZoom((z) => Math.min(5.0, Number((z + 0.25).toFixed(2))));
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        setZoom((z) => Math.max(0.2, Number((z - 0.25).toFixed(2))));
      } else if (e.key === '0') {
        e.preventDefault();
        handleResetZoom();
      } else if (e.key === 'ArrowLeft') {
        setPan((p) => ({ ...p, x: p.x + 50 }));
      } else if (e.key === 'ArrowRight') {
        setPan((p) => ({ ...p, x: p.x - 50 }));
      } else if (e.key === 'ArrowUp') {
        setPan((p) => ({ ...p, y: p.y + 50 }));
      } else if (e.key === 'ArrowDown') {
        setPan((p) => ({ ...p, y: p.y - 50 }));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isModalOpen, handleResetZoom]);

  useEffect(() => {
    let isMounted = true;
    configureMermaid(isLight, accentColor);

    if (!cleanCode || cleanCode.trim().length < 5) {
      setSvgHtml('');
      setError(null);
      return;
    }

    // If streaming and diagram ends abruptly with an arrow or open bracket, wait for more chunks
    if (isStreaming && (cleanCode.endsWith('-->') || cleanCode.endsWith('---') || cleanCode.endsWith('==>') || cleanCode.endsWith('['))) {
      return;
    }

    const renderId = `mermaid-svg-${Math.random().toString(36).substring(2, 9)}`;

    async function renderChart() {
      try {
        setError(null);
        // Primary render attempt
        const { svg } = await mermaid.render(renderId, cleanCode);
        if (isMounted) {
          setSvgHtml(svg);
        }
      } catch (primaryErr: any) {
        // Attempt secondary aggressive recovery
        const repaired = repairMermaidAggressive(cleanCode);
        if (repaired && repaired !== cleanCode) {
          try {
            const retryId = `${renderId}-r`;
            const { svg } = await mermaid.render(retryId, repaired);
            if (isMounted) {
              setSvgHtml(svg);
              setError(null);
              return;
            }
          } catch {
            // Secondary recovery failed, proceed to clean error display
          }
        }

        if (isMounted) {
          // If streaming, don't show error yet - the diagram may still be in transit
          if (!isStreaming) {
            setError(primaryErr?.message || 'Invalid Mermaid syntax');
          }
          setSvgHtml('');
        }
      }
    }

    renderChart();

    return () => {
      isMounted = false;
      // Clean up temporary DOM elements created by mermaid
      const el = document.getElementById(renderId);
      if (el) el.remove();
      const dEl = document.getElementById(`d${renderId}`);
      if (dEl) dEl.remove();
      const rEl = document.getElementById(`${renderId}-r`);
      if (rEl) rEl.remove();
      const dREl = document.getElementById(`d${renderId}-r`);
      if (dREl) dREl.remove();
    };
  }, [cleanCode, isLight, accentColor, isStreaming]);

  const handleCopy = () => {
    navigator.clipboard.writeText(cleanCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadSvg = () => {
    if (!svgHtml) return;
    const blob = new Blob([svgHtml], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `cyclode-diagram-${Date.now()}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (error) {
    return (
      <div className={`my-3 rounded-xl bg-onedark-darker border border-onedark-borderSubtle overflow-hidden text-xs ${className}`}>
        <div className="flex items-center justify-between px-3.5 py-2 bg-amber-500/10 border-b border-amber-500/20 text-amber-400">
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-3.5 h-3.5" />
            <span className="font-semibold">Workflow Diagram (Source View)</span>
          </div>
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center space-x-1 hover:text-onedark-fgBright transition-colors text-[11px] font-mono cursor-pointer"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            <span>{copied ? 'Copied' : 'Copy Source'}</span>
          </button>
        </div>
        <div className="p-3 font-mono text-[11px] text-onedark-fg/80 whitespace-pre-wrap overflow-x-auto leading-relaxed bg-onedark-darkest/40">
          {cleanCode || code}
        </div>
        <div className="px-3.5 py-1.5 bg-onedark-surface/40 border-t border-onedark-borderSubtle/60 text-[10.5px] text-onedark-muted font-mono">
          Syntax issue: {error.split('\n')[0]}
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        className={`my-3 rounded-xl bg-onedark-darker/60 border border-onedark-borderSubtle overflow-hidden shadow-xs group/mermaid transition-all ${
          isFullWidth ? 'w-full !max-w-none' : 'w-full'
        } ${className}`}
      >
        {/* Header Toolbar */}
        <div className="flex items-center justify-between px-3.5 py-1.5 bg-onedark-surface/60 border-b border-onedark-borderSubtle/60 text-[11px] text-onedark-muted font-mono select-none">
          <div className="flex items-center space-x-2">
            <Sparkles className="w-3.5 h-3.5 text-onedark-accent" />
            <span className="text-onedark-accent font-semibold uppercase tracking-wider text-[10.5px]">Workflow Diagram</span>
          </div>

          <div className="flex items-center space-x-1.5">
            <button
              type="button"
              onClick={() => setIsFullWidth(!isFullWidth)}
              className={`flex items-center space-x-1 transition-colors px-2 py-0.5 rounded text-[10.5px] cursor-pointer ${
                isFullWidth
                  ? 'bg-onedark-accent/20 text-onedark-accent font-semibold'
                  : 'hover:text-onedark-fgBright hover:bg-onedark-surface text-onedark-muted'
              }`}
              title={isFullWidth ? 'Restore standard width' : 'Expand full width'}
            >
              <ArrowLeftRight className="w-3 h-3" />
              <span>{isFullWidth ? 'Standard' : 'Full Width'}</span>
            </button>

            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="flex items-center space-x-1 px-2 py-0.5 rounded text-[10.5px] hover:text-onedark-fgBright hover:bg-onedark-surface text-onedark-muted transition-colors cursor-pointer"
              title="Expand in full-screen modal"
            >
              <Maximize2 className="w-3 h-3" />
              <span>Expand</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadSvg}
              disabled={!svgHtml}
              className="flex items-center space-x-1 px-2 py-0.5 rounded text-[10.5px] hover:text-onedark-fgBright hover:bg-onedark-surface text-onedark-muted transition-colors cursor-pointer disabled:opacity-40"
              title="Download SVG"
            >
              <Download className="w-3 h-3" />
              <span>SVG</span>
            </button>

            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center space-x-1 px-2 py-0.5 rounded text-[10.5px] hover:text-onedark-fgBright hover:bg-onedark-surface text-onedark-muted transition-colors cursor-pointer"
              title="Copy Mermaid source"
            >
              {copied ? <Check className="w-3 h-3 text-onedark-green" /> : <Copy className="w-3 h-3" />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
        </div>

        {/* Diagram Canvas */}
        <div
          ref={containerRef}
          onDoubleClick={() => setIsModalOpen(true)}
          title="Double-click to expand and inspect"
          className="p-5 overflow-x-auto flex items-center justify-center min-h-[140px] [&>svg]:max-w-full [&>svg]:h-auto [&>svg]:transition-all cursor-pointer"
        >
          {svgHtml ? (
            <div
              className="w-full flex items-center justify-center [&>svg]:max-w-full [&>svg]:h-auto"
              dangerouslySetInnerHTML={{ __html: svgHtml }}
            />
          ) : (
            <div className="flex items-center gap-2 text-xs font-mono text-onedark-muted py-6">
              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-onedark-accent border-t-transparent" />
              <span>Rendering workflow diagram...</span>
            </div>
          )}
        </div>
      </div>

      {/* Expanded Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs animate-modal-enter">
          <div className="relative w-full max-w-6xl h-[85vh] flex flex-col bg-onedark-darker border border-onedark-border rounded-2xl overflow-hidden shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-onedark-borderSubtle bg-onedark-surface/40 select-none flex-wrap gap-2">
              <div className="flex items-center space-x-2">
                <Sparkles className="w-4 h-4 text-onedark-accent" />
                <span className="font-semibold text-xs text-onedark-fgBright">Workflow Diagram Inspection</span>
                <span className="text-[10px] text-onedark-muted font-mono hidden sm:inline px-1.5 py-0.5 rounded bg-onedark-surface border border-onedark-borderSubtle">
                  Interactive Canvas
                </span>
              </div>
              <div className="flex items-center space-x-2">
                {/* Zoom HUD Controls */}
                <div className="flex items-center bg-onedark-darker/90 border border-onedark-border rounded-lg p-0.5 shadow-xs">
                  <button
                    type="button"
                    onClick={() => setZoom((z) => Math.max(0.2, Number((z - 0.25).toFixed(2))))}
                    className="p-1 rounded text-onedark-muted hover:text-onedark-fgBright hover:bg-onedark-surface transition-colors cursor-pointer"
                    title="Zoom Out (-)"
                  >
                    <ZoomOut className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={handleResetZoom}
                    className="px-2 py-0.5 text-[11px] font-mono font-medium text-onedark-fgBright hover:text-onedark-accent transition-colors cursor-pointer min-w-[50px] text-center"
                    title="Reset to 100% (0)"
                  >
                    {Math.round(zoom * 100)}%
                  </button>
                  <button
                    type="button"
                    onClick={() => setZoom((z) => Math.min(5.0, Number((z + 0.25).toFixed(2))))}
                    className="p-1 rounded text-onedark-muted hover:text-onedark-fgBright hover:bg-onedark-surface transition-colors cursor-pointer"
                    title="Zoom In (+)"
                  >
                    <ZoomIn className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={handleFitView}
                    className="p-1 rounded text-onedark-muted hover:text-onedark-fgBright hover:bg-onedark-surface transition-colors cursor-pointer ml-0.5 border-l border-onedark-borderSubtle/60"
                    title="Fit to Screen"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleDownloadSvg}
                  className="px-2.5 py-1 text-xs rounded-lg bg-onedark-surface hover:bg-onedark-surface/80 text-onedark-fg font-medium transition-colors cursor-pointer flex items-center space-x-1.5 border border-onedark-borderSubtle shadow-xs"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download SVG</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="p-1.5 rounded-lg hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fgBright transition-colors cursor-pointer"
                  title="Close (Esc)"
                >
                  <Minimize2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Interactive Canvas */}
            <div
              ref={modalCanvasRef}
              className={`flex-1 relative overflow-hidden flex items-center justify-center select-none bg-onedark-bg/40 ${
                isDragging ? 'cursor-grabbing' : 'cursor-grab'
              }`}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onDoubleClick={handleDoubleClick}
            >
              <div
                style={{
                  transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
                  transformOrigin: 'center center',
                  transition: isDragging ? 'none' : 'transform 0.12s cubic-bezier(0.16, 1, 0.3, 1)',
                  width: svgDims ? `${svgDims.width}px` : 'auto',
                  height: svgDims ? `${svgDims.height}px` : 'auto',
                }}
                className="flex items-center justify-center pointer-events-none [&>svg]:w-full [&>svg]:h-full [&>svg]:max-w-none [&>svg]:pointer-events-auto"
                dangerouslySetInnerHTML={{ __html: svgHtml }}
              />

              {/* Navigation Hint Pill */}
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-onedark-darker/90 backdrop-blur-md border border-onedark-borderSubtle/80 text-[10px] font-mono text-onedark-muted pointer-events-none flex items-center space-x-2 select-none shadow-md">
                <span>Drag to pan</span>
                <span className="opacity-40">·</span>
                <span>Scroll to zoom</span>
                <span className="opacity-40">·</span>
                <span>Double-click to toggle fit</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
