import React, { useEffect, useState, useRef } from 'react';
import mermaid from 'mermaid';
import { Copy, Check, Download, AlertCircle, Maximize2, Minimize2, ArrowLeftRight, Sparkles } from 'lucide-react';

interface MermaidDiagramProps {
  code: string;
  className?: string;
}

let mermaidInitialized = false;

function ensureMermaidInitialized() {
  if (mermaidInitialized) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: 'dark',
    themeVariables: {
      darkMode: true,
      background: '#21252B',
      primaryColor: '#2C313A',
      primaryTextColor: '#F1F5F9',
      primaryBorderColor: '#61AFEF',
      lineColor: '#61AFEF',
      secondaryColor: '#282C34',
      tertiaryColor: '#21252B',
      edgeLabelBackground: '#21252B',
      nodeBorder: '#3E4451',
      clusterBkg: '#21252B',
      clusterBorder: '#3E4451',
      defaultLinkColor: '#61AFEF',
      fontFamily: 'Inter, -apple-system, sans-serif',
      fontSize: '12px',
    },
    securityLevel: 'strict',
    fontFamily: 'Inter, -apple-system, sans-serif',
  });
  mermaidInitialized = true;
}

export const MermaidDiagram: React.FC<MermaidDiagramProps> = ({ code, className = '' }) => {
  const [svgHtml, setSvgHtml] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [isFullWidth, setIsFullWidth] = useState<boolean>(false);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const cleanCode = code.trim();

  useEffect(() => {
    let isMounted = true;
    ensureMermaidInitialized();

    const renderId = `mermaid-svg-${Math.random().toString(36).substring(2, 9)}`;

    async function renderChart() {
      try {
        setError(null);
        // Render returns { svg, bindFunctions }
        const { svg } = await mermaid.render(renderId, cleanCode);
        if (isMounted) {
          setSvgHtml(svg);
        }
      } catch (err: any) {
        if (isMounted) {
          console.warn('Failed to parse Mermaid diagram:', err);
          setError(err?.message || 'Invalid Mermaid syntax');
          setSvgHtml('');
        }
      }
    }

    renderChart();

    return () => {
      isMounted = false;
      // Clean up temporary DOM element if created by mermaid
      const el = document.getElementById(renderId);
      if (el) el.remove();
    };
  }, [cleanCode]);

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
        <div className="flex items-center justify-between px-3.5 py-2 bg-rose-500/10 border-b border-rose-500/20 text-rose-400">
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-3.5 h-3.5" />
            <span className="font-semibold">Mermaid Syntax Warning</span>
          </div>
          <button
            onClick={handleCopy}
            className="flex items-center space-x-1 px-2 py-0.5 rounded text-[10.5px] hover:bg-rose-500/20 transition-colors cursor-pointer"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            <span>{copied ? 'Copied' : 'Copy Source'}</span>
          </button>
        </div>
        <div className="p-3 text-[11px] text-onedark-muted font-mono leading-relaxed overflow-x-auto">
          <pre className="text-onedark-fg">{cleanCode}</pre>
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        className={`my-3 rounded-xl bg-onedark-darker/90 border border-onedark-borderSubtle overflow-hidden shadow-xs group/mermaid transition-all ${
          isFullWidth ? 'w-full !max-w-none' : 'w-full'
        } ${className}`}
      >
        {/* Header Toolbar */}
        <div className="flex items-center justify-between px-3.5 py-1.5 bg-onedark-surface/50 border-b border-onedark-borderSubtle/60 text-[11px] text-onedark-muted font-mono select-none">
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
          className="p-5 overflow-x-auto flex items-center justify-center min-h-[140px] [&>svg]:max-w-full [&>svg]:h-auto [&>svg]:transition-all"
          dangerouslySetInnerHTML={{ __html: svgHtml }}
        />
      </div>

      {/* Expanded Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs animate-modal-enter">
          <div className="relative w-full max-w-5xl h-[80vh] flex flex-col bg-onedark-darker border border-onedark-border rounded-2xl overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between px-5 py-3 border-b border-onedark-borderSubtle bg-onedark-surface/40 select-none">
              <div className="flex items-center space-x-2">
                <Sparkles className="w-4 h-4 text-onedark-accent" />
                <span className="font-semibold text-xs text-onedark-fgBright">Workflow Diagram Inspection</span>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={handleDownloadSvg}
                  className="px-2.5 py-1 text-xs rounded-lg bg-onedark-surface hover:bg-onedark-surface/80 text-onedark-fg font-medium transition-colors cursor-pointer flex items-center space-x-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download SVG</span>
                </button>
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="p-1.5 rounded-lg hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fgBright transition-colors cursor-pointer"
                >
                  <Minimize2 className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div
              className="flex-1 p-6 overflow-auto flex items-center justify-center [&>svg]:max-w-full [&>svg]:max-h-full"
              dangerouslySetInnerHTML={{ __html: svgHtml }}
            />
          </div>
        </div>
      )}
    </>
  );
};
