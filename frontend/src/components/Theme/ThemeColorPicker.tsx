import React, { useState, useEffect, useRef } from 'react';
import { Palette, Check, RotateCcw, Sparkles } from 'lucide-react';

export interface ThemePreset {
  id: string;
  name: string;
  hex: string;
  folderHex: string;
}

export const THEME_PRESETS: ThemePreset[] = [
  { id: 'amber-gold', name: 'Amber Gold', hex: '#E5C07B', folderHex: '#E5C07B' },
  { id: 'warm-bronze', name: 'Warm Bronze', hex: '#D19A66', folderHex: '#E5C07B' },
  { id: 'mocha-gold', name: 'Mocha Gold', hex: '#C8A265', folderHex: '#E5C07B' },
  { id: 'emerald-sage', name: 'Emerald Sage', hex: '#98C379', folderHex: '#E5C07B' },
  { id: 'royal-purple', name: 'Royal Purple', hex: '#C678DD', folderHex: '#E5C07B' },
  { id: 'coral-sunset', name: 'Coral Sunset', hex: '#E07A5F', folderHex: '#E5C07B' },
  { id: 'ruby-crimson', name: 'Ruby Crimson', hex: '#E06C75', folderHex: '#E5C07B' },
  { id: 'titanium-silver', name: 'Titanium Silver', hex: '#E5E5E5', folderHex: '#E5C07B' },
];

export const applyThemeColors = (accentHex: string, folderHex: string = '#E5C07B') => {
  document.documentElement.style.setProperty('--color-accent', accentHex);
  document.documentElement.style.setProperty('--color-folder', folderHex);
  // Calculate subtle transparent background
  document.documentElement.style.setProperty('--color-accent-subtle', `${accentHex}26`);
  try {
    localStorage.setItem('adappty_theme_accent', accentHex);
    localStorage.setItem('adappty_theme_folder', folderHex);
  } catch (e) {
    // localStorage may be disabled
  }
};

const LEGACY_BLUE_HEXES = ['#61afef', '#56b6c2', '#818cf8', '#3b82f6', '#2563eb', '#60a5fa', '#38bdf8', '#06b6d4', '#0284c7'];

export const initThemeColors = () => {
  try {
    const savedAccent = localStorage.getItem('adappty_theme_accent');
    const savedFolder = localStorage.getItem('adappty_theme_folder') || '#E5C07B';
    
    // Auto-migrate any legacy blue/cyan accents to default Amber Gold (#E5C07B)
    if (savedAccent && !LEGACY_BLUE_HEXES.includes(savedAccent.toLowerCase())) {
      applyThemeColors(savedAccent, savedFolder);
      return { accent: savedAccent, folder: savedFolder };
    }
  } catch (e) {}
  applyThemeColors('#E5C07B', '#E5C07B');
  return { accent: '#E5C07B', folder: '#E5C07B' };
};

export const ThemeColorPicker: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [currentAccent, setCurrentAccent] = useState('#E5C07B');
  const [currentFolder, setCurrentFolder] = useState('#E5C07B');
  const [customHex, setCustomHex] = useState('#E5C07B');
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const initial = initThemeColors();
    setCurrentAccent(initial.accent);
    setCurrentFolder(initial.folder);
    setCustomHex(initial.accent);
  }, []);

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const selectPreset = (preset: ThemePreset) => {
    setCurrentAccent(preset.hex);
    setCurrentFolder(preset.folderHex);
    setCustomHex(preset.hex);
    applyThemeColors(preset.hex, preset.folderHex);
  };

  const handleCustomColorChange = (hex: string) => {
    setCustomHex(hex);
    if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
      setCurrentAccent(hex);
      applyThemeColors(hex, currentFolder);
    }
  };

  const resetDefault = () => {
    selectPreset(THEME_PRESETS[0]);
  };

  return (
    <div className="relative inline-block" ref={popoverRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="px-2 py-1 rounded-md border border-onedark-border bg-onedark-surface hover:bg-onedark-darker text-onedark-fg text-xs font-mono flex items-center space-x-1.5 transition-all shadow-xs active:scale-95 cursor-pointer"
        title="Change Accent & Theme Color"
      >
        <span
          className="w-3 h-3 rounded-full border border-black/30 shadow-xs inline-block transition-transform hover:scale-110"
          style={{ backgroundColor: currentAccent }}
        />
        <Palette className="w-3.5 h-3.5 text-onedark-muted" />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-72 bg-onedark-bg border border-onedark-border rounded-xl shadow-2xl p-3.5 z-50 animate-scaleIn font-sans">
          <div className="flex items-center justify-between pb-2 mb-3 border-b border-onedark-borderSubtle">
            <div className="flex items-center space-x-1.5 text-xs font-semibold text-onedark-fgBright">
              <Sparkles className="w-3.5 h-3.5 text-onedark-accent" />
              <span>Theme & Accent Colors</span>
            </div>
            <button
              onClick={resetDefault}
              className="p-1 rounded-md hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg text-[11px] font-mono flex items-center space-x-1 transition-colors"
              title="Reset to default OneDark"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset</span>
            </button>
          </div>

          {/* Presets Grid */}
          <div className="mb-3.5">
            <div className="text-[10.5px] uppercase font-mono font-semibold tracking-wider text-onedark-muted mb-2">
              Palette Presets
            </div>
            <div className="grid grid-cols-4 gap-2">
              {THEME_PRESETS.map((preset) => {
                const isSelected = currentAccent.toLowerCase() === preset.hex.toLowerCase();
                return (
                  <button
                    key={preset.id}
                    onClick={() => selectPreset(preset)}
                    className={`flex flex-col items-center p-1.5 rounded-lg border transition-all cursor-pointer ${
                      isSelected
                        ? 'border-onedark-fgBright bg-onedark-surface shadow-xs scale-105'
                        : 'border-transparent hover:border-onedark-border hover:bg-onedark-surface/60'
                    }`}
                    title={preset.name}
                  >
                    <span
                      className="w-6 h-6 rounded-full flex items-center justify-center border border-black/20 shadow-xs"
                      style={{ backgroundColor: preset.hex }}
                    >
                      {isSelected && <Check className="w-3.5 h-3.5 text-black drop-shadow-xs stroke-[3]" />}
                    </span>
                    <span className="text-[9.5px] text-onedark-muted truncate w-full text-center mt-1">
                      {preset.name.split(' ')[0]}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom Color Picker Input */}
          <div className="pt-2 border-t border-onedark-borderSubtle">
            <div className="text-[10.5px] uppercase font-mono font-semibold tracking-wider text-onedark-muted mb-2 flex items-center justify-between">
              <span>Custom Color Picker</span>
              <span className="font-mono text-onedark-accent text-[11px]">{customHex}</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="relative w-9 h-8 rounded-lg overflow-hidden border border-onedark-border flex-shrink-0 cursor-pointer">
                <input
                  type="color"
                  value={currentAccent.startsWith('#') ? currentAccent : '#E5C07B'}
                  onChange={(e) => handleCustomColorChange(e.target.value)}
                  className="absolute -top-2 -left-2 w-14 h-14 cursor-pointer opacity-0"
                />
                <div
                  className="w-full h-full rounded-md"
                  style={{ backgroundColor: currentAccent }}
                />
              </div>
              <input
                type="text"
                value={customHex}
                onChange={(e) => handleCustomColorChange(e.target.value)}
                placeholder="#E5C07B"
                maxLength={7}
                className="flex-1 bg-onedark-darker border border-onedark-border rounded-lg px-2.5 py-1 text-xs font-mono text-onedark-fg uppercase focus:outline-none focus:border-onedark-accent"
              />
            </div>
          </div>

          {/* Folder Icon Color Info */}
          <div className="mt-3 p-2 rounded-lg bg-onedark-darker/60 border border-onedark-borderSubtle text-[11px] font-mono text-onedark-muted flex items-center justify-between">
            <div className="flex items-center space-x-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-onedark-folder" />
              <span>Folder Icons: Warm Amber</span>
            </div>
            <span className="text-[10px] text-onedark-yellow font-bold">#E5C07B</span>
          </div>
        </div>
      )}
    </div>
  );
};
