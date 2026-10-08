import React, { useState, useEffect, useMemo } from 'react';

export interface ChartThemeConfig {
  isLight: boolean;
  colors: {
    accent: string;
    green: string;
    yellow: string;
    red: string;
    purple: string;
    bronze: string;
    teal: string;
    palette: string[];
  };
  grid: {
    stroke: string;
    strokeDasharray: string;
  };
  axis: {
    stroke: string;
    tickLine: boolean;
    tick: {
      fill: string;
      fontSize: number;
      fontFamily: string;
    };
  };
  tooltip: {
    contentStyle: React.CSSProperties;
    labelStyle: React.CSSProperties;
    itemStyle: React.CSSProperties;
  };
}

/**
 * Reads the current theme mode and custom accent color from the DOM.
 */
function readCurrentThemeFromDOM(): { isLight: boolean; accentColor: string } {
  if (typeof document === 'undefined') {
    return { isLight: false, accentColor: '#61AFEF' };
  }
  const isLight = document.documentElement.classList.contains('light-theme');
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim();
  return {
    isLight,
    accentColor: accent || (isLight ? '#D97706' : '#61AFEF'),
  };
}

/**
 * Zero-overhead hook that reacts instantly when the user toggles dark/light mode
 * or changes the theme color in the sidebar.
 */
export function useThemeObserver(): { isLight: boolean; accentColor: string } {
  const [themeState, setThemeState] = useState(readCurrentThemeFromDOM);

  useEffect(() => {
    // Initial read
    setThemeState(readCurrentThemeFromDOM());

    // Observe class attribute (for .light-theme) and style attribute (for --color-accent)
    const observer = new MutationObserver(() => {
      setThemeState(readCurrentThemeFromDOM());
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style'],
    });

    return () => observer.disconnect();
  }, []);

  return themeState;
}

/**
 * Builds a complete ChartThemeConfig object for a given theme mode and accent color.
 */
export function getChartTheme(isLight: boolean, accentColor?: string): ChartThemeConfig {
  const effectiveAccent = accentColor || (isLight ? '#D97706' : '#61AFEF');

  if (isLight) {
    return {
      isLight: true,
      colors: {
        accent: effectiveAccent,
        green: '#16A34A',  // Emerald-600 (accessible on white)
        yellow: '#D97706', // Amber-600
        red: '#DC2626',    // Red-600
        purple: '#7C3AED', // Purple-600
        bronze: '#C2410C', // Orange-700
        teal: '#0D9488',   // Teal-600
        palette: [
          effectiveAccent,
          '#16A34A',
          '#0284C7',
          '#7C3AED',
          '#0D9488',
          '#EA580C',
          '#DC2626',
        ],
      },
      grid: {
        stroke: 'rgba(0, 0, 0, 0.08)',
        strokeDasharray: '3 3',
      },
      axis: {
        stroke: 'rgba(0, 0, 0, 0.16)',
        tickLine: false,
        tick: {
          fill: '#475569', // Slate-600, high contrast on light backgrounds
          fontSize: 11,
          fontFamily: 'JetBrains Mono, Menlo, monospace',
        },
      },
      tooltip: {
        contentStyle: {
          backgroundColor: '#FFFFFF',
          borderColor: '#E2E8F0',
          borderWidth: 1,
          borderRadius: '8px',
          color: '#0F172A',
          fontSize: '11px',
          fontFamily: 'JetBrains Mono, Menlo, monospace',
          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
          padding: '8px 12px',
        },
        labelStyle: {
          color: '#0F172A',
          fontWeight: 600,
          marginBottom: '4px',
        },
        itemStyle: {
          padding: '2px 0',
          color: '#334155',
        },
      },
    };
  }

  // Dark Mode (OneDark Palette)
  return {
    isLight: false,
    colors: {
      accent: effectiveAccent,
      green: '#98C379',
      yellow: '#E5C07B',
      red: '#E06C75',
      purple: '#C678DD',
      bronze: '#D19A66',
      teal: '#56B6C2',
      palette: [
        effectiveAccent,
        '#98C379',
        '#E5C07B',
        '#C678DD',
        '#56B6C2',
        '#D19A66',
        '#E06C75',
      ],
    },
    grid: {
      stroke: 'rgba(255, 255, 255, 0.07)',
      strokeDasharray: '3 3',
    },
    axis: {
      stroke: 'rgba(255, 255, 255, 0.15)',
      tickLine: false,
      tick: {
        fill: '#CBD5E1',
        fontSize: 11,
        fontFamily: 'JetBrains Mono, Menlo, monospace',
      },
    },
    tooltip: {
      contentStyle: {
        backgroundColor: '#21252B',
        borderColor: '#3E4451',
        borderWidth: 1,
        borderRadius: '8px',
        color: '#CBD5E1',
        fontSize: '11px',
        fontFamily: 'JetBrains Mono, Menlo, monospace',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
        padding: '8px 12px',
      },
      labelStyle: {
        color: '#F1F5F9',
        fontWeight: 600,
        marginBottom: '4px',
      },
      itemStyle: {
        padding: '2px 0',
      },
    },
  };
}

/**
 * Primary React hook for theme-aware charting.
 * Automatically synchronizes with the active theme mode and user-selected accent color.
 */
export function useChartTheme(): ChartThemeConfig {
  const { isLight, accentColor } = useThemeObserver();
  return useMemo(() => getChartTheme(isLight, accentColor), [isLight, accentColor]);
}

/**
 * Backwards-compatible static theme fallback for non-React contexts.
 */
export const CHART_THEME = getChartTheme(false, '#61AFEF');
