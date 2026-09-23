import React, { useState, useRef, useEffect } from 'react';
import { 
  ZoomIn, 
  ZoomOut, 
  Maximize2, 
  RotateCcw, 
  Grid, 
  Download, 
  Code2, 
  Eye, 
  Sparkles,
  Layers,
  Image as ImageIcon
} from 'lucide-react';

interface ImageViewerProps {
  taskId: string;
  filePath: string;
  fileSize?: number;
  rawUrl: string;
  svgContent?: string;
}

export const ImageViewer: React.FC<ImageViewerProps> = ({
  taskId,
  filePath,
  fileSize,
  rawUrl,
  svgContent,
}) => {
  const [zoom, setZoom] = useState<number>(100);
  const [showCheckerboard, setShowCheckerboard] = useState<boolean>(true);
  const [viewSvgCode, setViewSvgCode] = useState<boolean>(false);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [loadError, setLoadError] = useState<boolean>(false);
  const isSvg = filePath.toLowerCase().endsWith('.svg');

  const imgRef = useRef<HTMLImageElement>(null);

  const handleZoomIn = () => setZoom((prev) => Math.min(prev + 25, 400));
  const handleZoomOut = () => setZoom((prev) => Math.max(prev - 25, 25));
  const handleResetZoom = () => setZoom(100);
  const handleFitZoom = () => setZoom(75);

  const formatBytes = (bytes?: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const calculateAspectRatio = (w: number, h: number) => {
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    const r = gcd(w, h);
    return `${w / r}:${h / r}`;
  };

  return (
    <div className="h-full flex flex-col bg-onedark-bg font-sans overflow-hidden select-none">
      {/* Top Image Viewer Sub-Toolbar */}
      <div className="px-3 py-1.5 bg-onedark-darker/70 border-b border-onedark-borderSubtle flex items-center justify-between flex-shrink-0 text-xs text-onedark-fg">
        {/* Left: Dimension & File Telemetry */}
        <div className="flex items-center space-x-2 font-mono text-[11px] text-onedark-muted">
          <div className="flex items-center space-x-1">
            <ImageIcon className="w-3.5 h-3.5 text-onedark-accent" />
            <span className="font-semibold text-onedark-fg">{filePath.split('/').pop()}</span>
          </div>
          {dimensions && (
            <>
              <span className="text-onedark-border">·</span>
              <span className="px-1.5 py-0.2 rounded bg-onedark-surface border border-onedark-borderSubtle text-onedark-fg text-[10.5px]">
                {dimensions.width} × {dimensions.height} px
              </span>
              <span className="hidden sm:inline opacity-70">
                ({calculateAspectRatio(dimensions.width, dimensions.height)})
              </span>
            </>
          )}
          {fileSize !== undefined && (
            <>
              <span className="text-onedark-border">·</span>
              <span>{formatBytes(fileSize)}</span>
            </>
          )}
        </div>

        {/* Right: Controls & Toggles */}
        <div className="flex items-center space-x-1.5">
          {/* SVG Visual/Code Toggle */}
          {isSvg && svgContent && (
            <div className="flex items-center space-x-0.5 bg-onedark-surface/80 p-0.5 rounded-md border border-onedark-borderSubtle text-[11px]">
              <button
                type="button"
                onClick={() => setViewSvgCode(false)}
                className={`px-2 py-0.5 rounded transition-colors cursor-pointer flex items-center space-x-1 ${
                  !viewSvgCode
                    ? 'bg-onedark-darker text-onedark-accent font-semibold shadow-xs'
                    : 'text-onedark-muted hover:text-onedark-fg'
                }`}
                title="Rendered SVG Preview"
              >
                <Eye className="w-3 h-3" />
                <span>Preview</span>
              </button>
              <button
                type="button"
                onClick={() => setViewSvgCode(true)}
                className={`px-2 py-0.5 rounded transition-colors cursor-pointer flex items-center space-x-1 ${
                  viewSvgCode
                    ? 'bg-onedark-darker text-onedark-purple font-semibold shadow-xs'
                    : 'text-onedark-muted hover:text-onedark-fg'
                }`}
                title="View SVG XML Source"
              >
                <Code2 className="w-3 h-3" />
                <span>XML Code</span>
              </button>
            </div>
          )}

          {!viewSvgCode && (
            <>
              {/* Zoom Controls */}
              <div className="flex items-center space-x-0.5 bg-onedark-surface/60 p-0.5 rounded-md border border-onedark-borderSubtle">
                <button
                  type="button"
                  onClick={handleZoomOut}
                  disabled={zoom <= 25}
                  className="p-1 rounded text-onedark-muted hover:text-onedark-fg disabled:opacity-30 cursor-pointer"
                  title="Zoom Out (-25%)"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleResetZoom}
                  className="px-1.5 py-0.5 font-mono text-[10.5px] text-onedark-fg hover:bg-onedark-surface rounded cursor-pointer min-w-[40px] text-center"
                  title="Reset to 100%"
                >
                  {zoom}%
                </button>
                <button
                  type="button"
                  onClick={handleZoomIn}
                  disabled={zoom >= 400}
                  className="p-1 rounded text-onedark-muted hover:text-onedark-fg disabled:opacity-30 cursor-pointer"
                  title="Zoom In (+25%)"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Checkerboard toggle */}
              <button
                type="button"
                onClick={() => setShowCheckerboard(!showCheckerboard)}
                className={`p-1.5 rounded-md border transition-colors cursor-pointer ${
                  showCheckerboard
                    ? 'bg-onedark-surface text-onedark-accent border-onedark-accent/40'
                    : 'bg-onedark-surface/40 text-onedark-muted border-onedark-borderSubtle hover:text-onedark-fg'
                }`}
                title="Toggle transparency checkerboard"
              >
                <Grid className="w-3.5 h-3.5" />
              </button>

              {/* Fit button */}
              <button
                type="button"
                onClick={handleFitZoom}
                className="p-1.5 rounded-md bg-onedark-surface/60 hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg border border-onedark-borderSubtle transition-colors cursor-pointer"
                title="Fit viewport"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}

          {/* Download Raw Image */}
          <a
            href={`${rawUrl}&download=true`}
            download={filePath.split('/').pop()}
            className="p-1.5 rounded-md bg-onedark-surface/60 hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg border border-onedark-borderSubtle transition-colors cursor-pointer"
            title="Download image asset"
          >
            <Download className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* Main Image Canvas Viewport */}
      <div className="flex-1 overflow-auto flex items-center justify-center p-6 relative">
        {viewSvgCode && svgContent ? (
          <div className="w-full h-full font-mono text-[12px] bg-onedark-bg text-onedark-fg p-4 overflow-auto rounded-lg border border-onedark-borderSubtle">
            <pre className="leading-relaxed select-text">{svgContent}</pre>
          </div>
        ) : loadError ? (
          <div className="text-center text-onedark-muted p-6 space-y-2">
            <ImageIcon className="w-10 h-10 mx-auto text-onedark-red/60" />
            <div className="text-xs font-semibold text-onedark-fg">Failed to load image asset</div>
            <div className="text-[11px] text-onedark-muted">The image file may be corrupted or in an unsupported format.</div>
          </div>
        ) : (
          <div
            className={`p-4 rounded-xl transition-all shadow-sm border border-onedark-borderSubtle/60 flex items-center justify-center ${
              showCheckerboard ? 'bg-[linear-gradient(45deg,#1e2227_25%,transparent_25%),linear-gradient(-45deg,#1e2227_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#1e2227_75%),linear-gradient(-45deg,transparent_75%,#1e2227_75%)] bg-[size:20px_20px] bg-[#16181d]' : 'bg-onedark-darker'
            }`}
          >
            <img
              ref={imgRef}
              src={rawUrl}
              alt={filePath}
              style={{
                width: zoom === 100 && dimensions ? `${dimensions.width}px` : undefined,
                maxWidth: zoom !== 100 ? `${zoom}%` : '100%',
                maxHeight: '75vh',
                transform: zoom !== 100 && zoom > 100 ? `scale(${zoom / 100})` : undefined,
                transformOrigin: 'center center',
                imageRendering: zoom > 200 ? 'pixelated' : 'auto'
              }}
              onLoad={(e) => {
                const target = e.currentTarget;
                setDimensions({ width: target.naturalWidth, height: target.naturalHeight });
                setLoadError(false);
              }}
              onError={() => setLoadError(true)}
              className="object-contain rounded transition-transform"
            />
          </div>
        )}
      </div>
    </div>
  );
};
