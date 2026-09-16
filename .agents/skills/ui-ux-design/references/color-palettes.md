# UI/UX Design System Color Palettes

Ready-to-use, production-grade Tailwind CSS configuration presets for modern web applications. These palettes deliberately avoid generic "AI purple/indigo neon glow" clichés in favor of domain-crafted aesthetic harmonies.

---

## 1. Warm Editorial Craft (Terracotta & Stone)
* **Best For**: Knowledge repositories, publishing tools, research engines, luxury e-commerce, architectural journals.
* **Canvas Backdrop**: `#fcfbf9` (Warm Paper) or `#181614` (Deep Charcoal Dark).
* **Surfaces**: `#f4f1ea` (Card Surface) / `#221f1b` (Dark Card Surface).
* **Accent**: `#c2410c` (Terracotta / Burnt Orange) or `#854d0e` (Warm Ochre).

```javascript
tailwind.config = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        craft: {
          bg: '#fcfbf9',
          card: '#f4f1ea',
          cardHover: '#ebe7dd',
          border: '#e6e2d8',
          ink: '#2d2a26',
          muted: '#78716c',
          terracotta: '#c2410c',
          ochre: '#854d0e',
          sage: '#4d7c0f',
        },
        craftDark: {
          bg: '#141210',
          card: '#1e1b18',
          cardHover: '#282420',
          border: 'rgba(255, 255, 255, 0.08)',
          ink: '#f5f5f4',
          muted: '#a8a29e',
          terracotta: '#ea580c',
          ochre: '#d97706',
        }
      }
    }
  }
};
```

---

## 2. Japanese Ink & Hanko Vermillion (Sumi Black)
* **Best For**: High-precision engineering suites, terminal companions, audio workstations, command dashboards.
* **Canvas Backdrop**: `#121214` (Deep Sumi Ink).
* **Surfaces**: `#1a1a1d` (Primary Card), `#242428` (Elevated / Popover).
* **Borders**: `rgba(255, 255, 255, 0.07)` (Subtle hairline grid).
* **Accent**: `#e11d48` (Hanko Seal Vermillion) or `#f59e0b` (Warm Lantern Amber).

```javascript
tailwind.config = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        sumi: {
          canvas: '#121214',
          card: '#1a1a1d',
          cardElevated: '#242428',
          cardHover: '#2e2e34',
          borderSubtle: 'rgba(255, 255, 255, 0.07)',
          borderHover: 'rgba(255, 255, 255, 0.16)',
          inkLight: '#f4f4f5',
          inkMuted: '#a1a1aa',
          vermillion: '#e11d48',
          vermillionHover: '#f43f5e',
          amber: '#f59e0b',
        }
      }
    }
  }
};
```

---

## 3. Botanical & Nordic Pine (Deep Forest & Sage)
* **Best For**: Climate tech, environmental metrics, health & wellness platforms, scientific dashboards.
* **Canvas Backdrop**: `#0a0f0d` (Midnight Forest) or `#f3f6f4` (Light Nordic Dew).
* **Surfaces**: `#111a16` (Pine Card) / `#ffffff` (Light Card).
* **Borders**: `#1b2923` (Dark Border) / `#dbe4de` (Light Border).
* **Accent**: `#10b981` (Vibrant Emerald) or `#84cc16` (Nordic Lime).

```javascript
tailwind.config = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        botanical: {
          bg: '#0a0f0d',
          card: '#111a16',
          cardHover: '#18241f',
          border: '#1f2e27',
          pine: '#2dd4bf',
          emerald: '#10b981',
          sage: '#86efac',
          moss: '#84cc16',
          text: '#ecfdf5',
          textMuted: '#6ee7b7',
        }
      }
    }
  }
};
```

---

## 4. Swiss Minimalist Monochrome (International Klein Blue Accent)
* **Best For**: High-frequency financial terminals, SQL browsers, data matrices, telemetry viewers.
* **Canvas Backdrop**: `#000000` (Pitch Black) or `#ffffff` (Stark White).
* **Surfaces**: `#0e0e10` (Surface) / `#fafafa` (Light Surface).
* **Borders**: `#222226` (Geometric Wireframe).
* **Single Spot Accent**: `#2563eb` (International Klein Blue) or `#e11d48` (Precision Red).

```javascript
tailwind.config = {
  theme: {
    extend: {
      colors: {
        swiss: {
          canvas: '#000000',
          surface: '#0e0e10',
          surfaceHover: '#18181c',
          border: '#222226',
          borderLight: '#33333a',
          text: '#ffffff',
          textMuted: '#71717a',
          kleinBlue: '#2563eb',
          kleinBlueHover: '#3b82f6',
        }
      }
    }
  }
};
```

---

## 5. Refined Obsidian Minimalist Dark (True Neutral Zinc)
* **Best For**: Productivity suites, issue trackers (Linear-style), task graphs.
* **Canvas Backdrop**: `#09090b` (True Neutral Zinc Canvas).
* **Surfaces**: `#141416` (Card), `#1f1f23` (Elevated Layer).
* **Borders**: `rgba(255, 255, 255, 0.08)` (Never opaque solid gray).
* **Functional Accents**: `#3b82f6` (Blue links), `#10b981` (Success), `#f59e0b` (Pending), `#f43f5e` (Failed).

```javascript
tailwind.config = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        obsidian: {
          canvas: '#09090b',
          card: '#141416',
          cardElevated: '#1f1f23',
          cardHover: '#28282e',
          borderSubtle: 'rgba(255, 255, 255, 0.08)',
          borderActive: 'rgba(255, 255, 255, 0.18)',
          text: '#fafafa',
          textMuted: '#a1a1aa',
          accent: '#3b82f6',
          emerald: '#10b981',
          amber: '#f59e0b',
          rose: '#f43f5e',
        }
      }
    }
  }
};
```

---

## 6. OneDark Pro Theme (Dev-Centric Code & Workbench Preset)
* **Best For**: Code sandboxes, diff viewers, log stream analyzers.

```javascript
tailwind.config = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        onedark: {
          bg: '#1e2227',
          surface: '#282c34',
          sidebar: '#21252b',
          card: '#2c313a',
          borderSubtle: '#3b4048',
          border: '#4b5263',
          fg: '#abb2bf',
          fgBright: '#e5eaf5',
          muted: '#5c6370',
          blue: '#61afef',
          green: '#98c379',
          purple: '#c678dd',
          yellow: '#e5c07b',
          red: '#e06c75',
          cyan: '#56b6c2',
        }
      }
    }
  }
};
```

---

## 7. OKLCH Perceptual Scale & Brand-Tinted Neutrals

The `oklch` (Lightness, Chroma, Hue) color model produces **perceptually uniform lightness steps**, ensuring equal lightness values look equally bright to the human eye regardless of hue.

### Tinting Neutrals for Visual Cohesion
Never use completely desaturated dead grays (`#71717a` or `oklch(0.5 0 0)`). Tint the neutral scale with $0.005$ to $0.012$ chroma matching your primary brand hue:

```css
:root {
  /* Slate neutrals tinted with subtle slate-blue (Hue: 250, Chroma: 0.008) */
  --neutral-50:  oklch(0.98 0.005 250);
  --neutral-100: oklch(0.95 0.006 250);
  --neutral-200: oklch(0.90 0.008 250);
  --neutral-300: oklch(0.82 0.009 250);
  --neutral-400: oklch(0.68 0.010 250);
  --neutral-500: oklch(0.54 0.012 250);
  --neutral-600: oklch(0.42 0.012 250);
  --neutral-700: oklch(0.32 0.011 250);
  --neutral-800: oklch(0.22 0.010 250);
  --neutral-900: oklch(0.14 0.008 250);
  --neutral-950: oklch(0.09 0.006 250);
}
```

### Dark Mode Chroma Reduction Rule
In dark mode interfaces, reduce the chroma (saturation) of accent colors by **15%–20%** compared to light mode. High-chroma saturated colors on pitch dark backdrops cause visual vibration and optical glare.

