# UI/UX Design System Color Palettes

Ready-to-use Tailwind CSS configuration presets for modern web applications.

---

## 1. Obsidian Minimalist Dark (Linear / Raycast Preset)

```javascript
tailwind.config = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        canvas: '#09090b',
        surface: {
          DEFAULT: '#18181b',
          elevated: '#27272a',
          hover: '#3f3f46',
        },
        border: {
          subtle: 'rgba(255, 255, 255, 0.08)',
          DEFAULT: 'rgba(255, 255, 255, 0.14)',
          active: 'rgba(255, 255, 255, 0.24)',
        },
        brand: {
          50: '#eef2ff',
          100: '#e0e7ff',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
        },
        accent: {
          cyan: '#06b6d4',
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

## 2. OneDark Pro Theme (VS Code / Atom Dev Preset)

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

## 3. Crisp Editorial SaaS Light Preset

```javascript
tailwind.config = {
  theme: {
    extend: {
      colors: {
        slate: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
        },
        primary: {
          50: '#eef2ff',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
        }
      }
    }
  }
};
```
