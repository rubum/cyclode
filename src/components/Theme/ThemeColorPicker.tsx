import React, { useState, useEffect, useRef } from 'react';
import { Palette, Check, RotateCcw, Sparkles, Sun, Moon, Monitor } from 'lucide-react';

export type ThemeMode = 'dark' | 'light' | 'system';

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
  { id: 'sapphire-blue', name: 'Sapphire Blue', hex: '#61AFEF', folderHex: '#E5C07B' },
  { id: 'ruby-crimson', name: 'Ruby Crimson', hex: '#E06C75', folderHex: '#E5C07B' },
  { id: 'titanium-silver', name: 'Titanium Silver', hex: '#E5E5E5', folderHex: '#E5C07B' },
];

let systemThemeListenerAttached = false;

function resolveSystemTheme(): 'dark' | 'light' {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'dark';
}

export const applyThemeMode = (mode: ThemeMode) => {
  try {
    localStorage.setItem('cyclode_theme_mode', mode);
  } catch (e) {}

  const effectiveTheme = mode === 'system' ? resolveSystemTheme() : mode;
  if (effectiveTheme === 'light') {
    document.documentElement.classList.add('light-theme');
  } else {
    document.documentElement.classList.remove('light-theme');
  }

  // Attach system listener once if system mode is selected
  if (mode === 'system' && !systemThemeListenerAttached && typeof window !== 'undefined' && window.matchMedia) {
    systemThemeListenerAttached = true;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', (e) => {
      const currentMode = localStorage.getItem('cyclode_theme_mode');
      if (currentMode === 'system') {
        if (e.matches) {
          document.documentElement.classList.remove('light-theme');
        } else {
          document.documentElement.classList.add('light-theme');
        }
      }
    });
  }
};

export const initThemeMode = (): ThemeMode => {
  let savedMode: ThemeMode = 'dark';
  try {
    const raw = localStorage.getItem('cyclode_theme_mode');
    if (raw === 'light' || raw === 'dark' || raw === 'system') {
      savedMode = raw;
    }
  } catch (e) {}
  applyThemeMode(savedMode);
  return savedMode;
};

export const applyThemeColors = (accentHex: string, folderHex: string = '#E5C07B') => {
  document.documentElement.style.setProperty('--color-accent', accentHex);
  document.documentElement.style.setProperty('--color-folder', folderHex);
  // Calculate subtle transparent background
  document.documentElement.style.setProperty('--color-accent-subtle', `${accentHex}26`);
  try {
    localStorage.setItem('cyclode_theme_accent', accentHex);
    localStorage.setItem('cyclode_theme_folder', folderHex);
  } catch (e) {
    // localStorage may be disabled
  }
};

export const initThemeColors = () => {
  try {
    const savedAccent = localStorage.getItem('cyclode_theme_accent');
    const savedFolder = localStorage.getItem('cyclode_theme_folder') || '#E5C07B';
    
    if (savedAccent) {
      applyThemeColors(savedAccent, savedFolder);
      return { accent: savedAccent, folder: savedFolder };
    }
  } catch (e) {}
  applyThemeColors('#E5C07B', '#E5C07B');
  return { accent: '#E5C07B', folder: '#E5C07B' };
};

interface ThemeColorPickerProps {
  direction?: 'up' | 'down' | 'auto';
  align?: 'left' | 'right' | 'auto';
}

export const ThemeColorPicker: React.FC<ThemeColorPickerProps> = ({
  direction = 'auto',
  align = 'right'
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>('dark');
  const [currentAccent, setCurrentAccent] = useState('#E5C07B');
  const [currentFolder, setCurrentFolder] = useState('#E5C07B');
  const [customHex, setCustomHex] = useState('#E5C07B');
  const [calculatedPlacement, setCalculatedPlacement] = useState<{ vertical: 'top' | 'bottom'; horizontal: 'left' | 'right' }>({
    vertical: 'bottom',
    horizontal: 'right'
  });
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const initialMode = initThemeMode();
    const initialColors = initThemeColors();
    setThemeMode(initialMode);
    setCurrentAccent(initialColors.accent);
    setCurrentFolder(initialColors.folder);
    setCustomHex(initialColors.accent);
  }, []);

  // Compute smart popover position on open
  useEffect(() => {
    if (isOpen && popoverRef.current) {
      const rect = popoverRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;

      let vertical: 'top' | 'bottom' = 'bottom';
      if (direction === 'up') {
        vertical = 'top';
      } else if (direction === 'down') {
        vertical = 'bottom';
      } else {
        vertical = spaceBelow < 380 && spaceAbove > spaceBelow ? 'top' : 'bottom';
      }

      let horizontal: 'left' | 'right' = 'right';
      if (align === 'left') {
        horizontal = 'left';
      } else if (align === 'right') {
        horizontal = 'right';
      } else {
        horizontal = 'right';
      }

      setCalculatedPlacement({ vertical, horizontal });
    }
  }, [isOpen, direction, align]);

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

  const handleModeChange = (mode: ThemeMode) => {
    setThemeMode(mode);
    applyThemeMode(mode);
  };

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
    handleModeChange('dark');
    selectPreset(THEME_PRESETS[0]);
  };

  const placementClasses = `${
    calculatedPlacement.vertical === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'
  } ${
    calculatedPlacement.horizontal === 'left' ? 'left-0' : 'right-0'
  }`;

  return (
    <div className="relative inline-block" ref={popoverRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="px-2 py-1 rounded-md border border-onedark-border bg-onedark-surface hover:bg-onedark-darker text-onedark-fg text-xs font-mono flex items-center space-x-1.5 transition-all shadow-xs active:scale-95 cursor-pointer"
        title="Change Appearance & Theme Color"
      >
        <span
          className="w-3 h-3 rounded-full border border-black/30 shadow-xs inline-block transition-transform hover:scale-110"
          style={{ backgroundColor: currentAccent }}
        />
        {themeMode === 'light' ? (
          <Sun className="w-3.5 h-3.5 text-onedark-accent" />
        ) : themeMode === 'system' ? (
          <Monitor className="w-3.5 h-3.5 text-onedark-muted" />
        ) : (
          <Moon className="w-3.5 h-3.5 text-onedark-muted" />
        )}
      </button>

      {isOpen && (
        <div className={`absolute ${placementClasses} w-[218px] bg-onedark-bg border border-onedark-border rounded-xl shadow-2xl p-3 z-50 animate-scaleIn font-sans max-h-[85vh] overflow-y-auto`}>
          <div className="flex items-center justify-between pb-2 mb-2.5 border-b border-onedark-borderSubtle">
            <div className="flex items-center space-x-1.5 text-xs font-semibold text-onedark-fgBright">
              <Sparkles className="w-3.5 h-3.5 text-onedark-accent" />
              <span>Appearance</span>
            </div>
            <button
              onClick={resetDefault}
              className="p-0.5 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg text-[10.5px] font-mono flex items-center space-x-1 transition-colors cursor-pointer"
              title="Reset to default OneDark"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset</span>
            </button>
          </div>

          {/* Theme Mode Segmented Toggle */}
          <div className="mb-3">
            <div className="text-[10px] uppercase font-mono font-semibold tracking-wider text-onedark-muted mb-1.5">
              Theme Mode
            </div>
            <div className="grid grid-cols-3 gap-1 bg-onedark-darker p-1 rounded-lg border border-onedark-borderSubtle">
              <button
                type="button"
                onClick={() => handleModeChange('dark')}
                className={`flex items-center justify-center space-x-1 py-1 px-1 rounded-md text-[11px] font-medium transition-all cursor-pointer ${
                  themeMode === 'dark'
                    ? 'bg-onedark-surface text-onedark-fgBright border border-onedark-border shadow-xs'
                    : 'text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/40'
                }`}
                title="Dark Mode"
              >
                <Moon className="w-3 h-3 text-onedark-accent" />
                <span>Dark</span>
              </button>
              <button
                type="button"
                onClick={() => handleModeChange('light')}
                className={`flex items-center justify-center space-x-1 py-1 px-1 rounded-md text-[11px] font-medium transition-all cursor-pointer ${
                  themeMode === 'light'
                    ? 'bg-onedark-surface text-onedark-fgBright border border-onedark-border shadow-xs'
                    : 'text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/40'
                }`}
                title="Light Mode"
              >
                <Sun className="w-3 h-3 text-onedark-accent" />
                <span>Light</span>
              </button>
              <button
                type="button"
                onClick={() => handleModeChange('system')}
                className={`flex items-center justify-center space-x-1 py-1 px-1 rounded-md text-[11px] font-medium transition-all cursor-pointer ${
                  themeMode === 'system'
                    ? 'bg-onedark-surface text-onedark-fgBright border border-onedark-border shadow-xs'
                    : 'text-onedark-muted hover:text-onedark-fg hover:bg-onedark-surface/40'
                }`}
                title="System Auto Mode"
              >
                <Monitor className="w-3 h-3 text-onedark-accent" />
                <span>Auto</span>
              </button>
            </div>
          </div>

          {/* Presets Grid */}
          <div className="mb-3">
            <div className="text-[10px] uppercase font-mono font-semibold tracking-wider text-onedark-muted mb-1.5">
              Accent Colors
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {THEME_PRESETS.map((preset) => {
                const isSelected = currentAccent.toLowerCase() === preset.hex.toLowerCase();
                return (
                  <button
                    key={preset.id}
                    onClick={() => selectPreset(preset)}
                    className={`flex flex-col items-center p-1 rounded-lg border transition-all cursor-pointer ${
                      isSelected
                        ? 'border-onedark-fgBright bg-onedark-surface shadow-xs scale-105'
                        : 'border-transparent hover:border-onedark-border hover:bg-onedark-surface/60'
                    }`}
                    title={preset.name}
                  >
                    <span
                      className="w-5 h-5 rounded-full flex items-center justify-center border border-black/20 shadow-xs"
                      style={{ backgroundColor: preset.hex }}
                    >
                      {isSelected && <Check className="w-3 h-3 text-black drop-shadow-xs stroke-[3]" />}
                    </span>
                    <span className="text-[9px] text-onedark-muted truncate w-full text-center mt-0.5">
                      {preset.name.split(' ')[0]}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom Color Picker Input */}
          <div className="pt-2 border-t border-onedark-borderSubtle">
            <div className="text-[10px] uppercase font-mono font-semibold tracking-wider text-onedark-muted mb-1.5 flex items-center justify-between">
              <span>Custom Hex</span>
              <span className="font-mono text-onedark-accent text-[10.5px] font-semibold">{customHex}</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <div className="relative w-7 h-7 rounded-md overflow-hidden border border-onedark-border flex-shrink-0 cursor-pointer">
                <input
                  type="color"
                  value={currentAccent.startsWith('#') ? currentAccent : '#E5C07B'}
                  onChange={(e) => handleCustomColorChange(e.target.value)}
                  className="absolute -top-2 -left-2 w-12 h-12 cursor-pointer opacity-0"
                />
                <div
                  className="w-full h-full rounded-xs"
                  style={{ backgroundColor: currentAccent }}
                />
              </div>
              <input
                type="text"
                value={customHex}
                onChange={(e) => handleCustomColorChange(e.target.value)}
                placeholder="#E5C07B"
                maxLength={7}
                className="flex-1 bg-onedark-darker border border-onedark-border rounded-md px-2 py-0.5 text-xs font-mono text-onedark-fg uppercase focus:outline-none focus:border-onedark-accent"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

