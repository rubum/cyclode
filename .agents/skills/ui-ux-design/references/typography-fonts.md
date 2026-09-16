# Typography & Font Stacks Reference

High-craft web applications rely on intentional typography pairing, optical letter-spacing, line-height geometry, and strict numeric alignment. This guide provides production-ready font stacks, Google Fonts / Fontshare CDN snippets, and Tailwind CSS configuration presets.

---

## 1. Curated Font Pairing Stacks

### A. Modern Precision & Developer Tools (Geist / Inter + JetBrains Mono)
* **Heading / Display**: Geist or Inter (Variable, Weights: 500, 600, 700)
* **Body**: Inter or Geist (Weights: 400, 450, 500)
* **Code / Numbers / Readouts**: Geist Mono or JetBrains Mono (`tabular-nums`)
* **CDN Import**:
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
```

### B. Editorial SaaS & Thoughtful Knowledge Tools (Fraunces / Newsreader + Plus Jakarta Sans)
* **Heading / Display**: Fraunces or Newsreader (Serif Display, Weights: 500, 600, 700)
* **Body / UI Labels**: Plus Jakarta Sans or General Sans (Clean Sans, Weights: 400, 500, 600)
* **Micro Metadata / Footnotes**: Plus Jakarta Sans (`text-xs text-slate-500 font-medium`)
* **CDN Import**:
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;600;700&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,600;1,6..72,400&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
```

### C. Geometric Modernist & Product Dashboards (Space Grotesk / Cabinet Grotesk + Satoshi)
* **Heading / Display**: Space Grotesk or Cabinet Grotesk (Weights: 600, 700)
* **Body / Controls**: Satoshi or Plus Jakarta Sans (Weights: 400, 500)
* **CDN Import (Google Fonts + Fontshare)**:
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet">
<link href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700&f[]=cabinet-grotesk@500,700,800&display=swap" rel="stylesheet">
```

---

## 2. Tailwind CSS Typography Configuration

Add this configuration to your `tailwind.config` script or theme setup:

```javascript
tailwind.config = {
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'Plus Jakarta Sans', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['Space Grotesk', 'Fraunces', 'Cabinet Grotesk', 'Inter', 'sans-serif'],
        editorial: ['Newsreader', 'Fraunces', 'Georgia', 'serif'],
        mono: ['JetBrains Mono', 'Geist Mono', 'Fira Code', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      letterSpacing: {
        tighter: '-0.04em',
        tight: '-0.025em',
        normal: '0em',
        wide: '0.025em',
        wider: '0.05em',
        widest: '0.1em',
      }
    }
  }
};
```

---

## 3. Optical Scale & Spatial Hierarchy Table

| Hierarchy Level | Tailwind Classes | Line Height | Tracking | Recommended Weight | Usage |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Hero Display** | `text-3xl sm:text-4xl lg:text-5xl` | `leading-[1.1]` | `tracking-tighter` (`-0.035em`) | `font-bold` (700) | Landing headers, hero value statements |
| **Page Title** | `text-2xl sm:text-3xl` | `leading-[1.2]` | `tracking-tight` (`-0.025em`) | `font-semibold` / `font-bold` | Primary dashboard views, document titles |
| **Section Header** | `text-lg sm:text-xl` | `leading-snug` | `tracking-tight` (`-0.015em`) | `font-semibold` (600) | Card group headers, panel section labels |
| **Card / Item Title** | `text-sm sm:text-base` | `leading-normal` | `tracking-normal` | `font-medium` (500) | Metric card labels, list item headers |
| **Body Paragraph** | `text-sm sm:text-[15px]` | `leading-relaxed` (1.625) | `tracking-normal` | `font-normal` (400) | Prose descriptions, helper explanations |
| **Secondary / Meta** | `text-xs sm:text-[13px]` | `leading-normal` | `tracking-normal` | `font-medium` (500) | Timestamps, author badges, status hints |
| **Micro Caps / Badges** | `text-[10px] sm:text-[11px] uppercase` | `leading-none` | `tracking-widest` (`+0.08em`) | `font-semibold` / `font-mono` | Pill tags, table column headers, keyboard shortcuts |

---

## 4. Numeric & Tabular Alignment Invariant

> [!IMPORTANT]
> **Always enforce `tabular-nums` on figures**: Standard proportional numbers vary in width (e.g. `1` is narrower than `8`), causing metrics, timers, clocks, financial values, and data tables to jitter during state updates.

### Correct Pattern for Metrics and Financial Readouts:
```html
<!-- High-craft financial / analytics readout with tabular numbers and monospaced currency -->
<div class="flex items-baseline space-x-1">
  <span class="text-sm font-mono text-zinc-400 font-medium">$</span>
  <span class="text-3xl font-semibold tracking-tight text-white tabular-nums">142,850.00</span>
  <span class="text-xs font-mono text-emerald-400 font-medium tabular-nums ml-2">+12.4%</span>
</div>
```

---

## 5. Maximum Reading Measure (Line Length)

To prevent visual fatigue when scanning continuous prose, always constrain text containers:
* **Optimal Reading Width**: 60 to 75 characters per line (`max-w-prose` or `max-w-2xl`).
* **Line Height Invariant**: Body text must maintain at least `1.5` to `1.65` line height (`leading-relaxed`). Avoid `leading-none` or `leading-tight` on multi-line paragraphs.
