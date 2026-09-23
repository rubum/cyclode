import React, { useState, useRef } from 'react';
import { 
  Play, 
  Pause, 
  Volume2, 
  VolumeX, 
  Download, 
  Film, 
  Music, 
  RotateCcw,
  Sparkles
} from 'lucide-react';

interface MediaViewerProps {
  filePath: string;
  fileSize?: number;
  rawUrl: string;
}

export const MediaViewer: React.FC<MediaViewerProps> = ({
  filePath,
  fileSize,
  rawUrl,
}) => {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const isAudio = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'].includes(ext);
  const isVideo = ['mp4', 'webm', 'mov', 'mkv', 'avi'].includes(ext);

  const [playbackRate, setPlaybackRate] = useState<number>(1.0);
  const [isLooping, setIsLooping] = useState<boolean>(false);
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement>(null);

  const formatBytes = (bytes?: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const handleRateChange = (rate: number) => {
    setPlaybackRate(rate);
    if (mediaRef.current) {
      mediaRef.current.playbackRate = rate;
    }
  };

  return (
    <div className="h-full flex flex-col bg-onedark-bg font-sans overflow-hidden select-none">
      {/* Top Media Bar */}
      <div className="px-3 py-1.5 bg-onedark-darker/80 border-b border-onedark-borderSubtle flex items-center justify-between flex-shrink-0 text-xs">
        <div className="flex items-center space-x-2 font-mono text-[11px] text-onedark-muted">
          {isAudio ? (
            <Music className="w-4 h-4 text-onedark-accent flex-shrink-0" />
          ) : (
            <Film className="w-4 h-4 text-onedark-purple flex-shrink-0" />
          )}
          <span className="font-semibold text-onedark-fg">{filePath.split('/').pop()}</span>
          {fileSize !== undefined && (
            <>
              <span className="text-onedark-border">·</span>
              <span>{formatBytes(fileSize)}</span>
            </>
          )}
          <span className="text-onedark-border">·</span>
          <span className="uppercase text-[10px] px-1.5 py-0.2 rounded bg-onedark-surface border border-onedark-borderSubtle">
            {ext}
          </span>
        </div>

        {/* Right Controls */}
        <div className="flex items-center space-x-2">
          {/* Playback Rate Selector */}
          <div className="flex items-center space-x-1 font-mono text-[10.5px] text-onedark-muted">
            <span>Speed:</span>
            <select
              value={playbackRate}
              onChange={(e) => handleRateChange(Number(e.target.value))}
              className="bg-onedark-surface border border-onedark-borderSubtle rounded px-1.5 py-0.5 text-onedark-fg text-[11px] font-mono cursor-pointer focus:outline-none"
            >
              <option value={0.5}>0.5×</option>
              <option value={1.0}>1.0×</option>
              <option value={1.25}>1.25×</option>
              <option value={1.5}>1.5×</option>
              <option value={2.0}>2.0×</option>
            </select>
          </div>

          {/* Loop toggle */}
          <button
            type="button"
            onClick={() => setIsLooping(!isLooping)}
            className={`px-2 py-0.5 rounded text-[10.5px] font-mono border transition-colors cursor-pointer ${
              isLooping
                ? 'bg-onedark-surface text-onedark-accent border-onedark-accent/40 font-semibold'
                : 'bg-onedark-surface/40 text-onedark-muted border-onedark-borderSubtle hover:text-onedark-fg'
            }`}
          >
            Loop
          </button>

          {/* Download Raw Media */}
          <a
            href={`${rawUrl}&download=true`}
            download={filePath.split('/').pop()}
            className="p-1.5 rounded-md bg-onedark-surface/60 hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg border border-onedark-borderSubtle transition-colors cursor-pointer"
            title="Download media file"
          >
            <Download className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* Main Player Viewport */}
      <div className="flex-1 overflow-auto flex items-center justify-center p-6 bg-onedark-darker/40">
        {isVideo ? (
          <div className="w-full max-w-4xl max-h-[75vh] flex flex-col items-center justify-center rounded-xl overflow-hidden border border-onedark-borderSubtle bg-onedark-bg shadow-lg">
            <video
              ref={mediaRef as React.RefObject<HTMLVideoElement>}
              src={rawUrl}
              controls
              loop={isLooping}
              className="w-full h-full max-h-[70vh] object-contain rounded"
            />
          </div>
        ) : (
          <div className="w-full max-w-md p-6 rounded-2xl border border-onedark-borderSubtle bg-onedark-surface/30 backdrop-blur-xs flex flex-col items-center space-y-4 shadow-md">
            <div className="w-16 h-16 rounded-full bg-onedark-accent/15 border border-onedark-accent/30 flex items-center justify-center text-onedark-accent animate-pulse">
              <Music className="w-8 h-8" />
            </div>

            <div className="text-center">
              <div className="text-sm font-semibold text-onedark-fg font-mono truncate max-w-xs">
                {filePath.split('/').pop()}
              </div>
              <div className="text-xs text-onedark-muted mt-0.5">
                {formatBytes(fileSize)} · Audio Playback
              </div>
            </div>

            <audio
              ref={mediaRef as React.RefObject<HTMLAudioElement>}
              src={rawUrl}
              controls
              loop={isLooping}
              className="w-full"
            />
          </div>
        )}
      </div>
    </div>
  );
};
