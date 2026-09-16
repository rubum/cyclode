---
name: ui-ux-design
description: Comprehensive UI/UX design craft system and aesthetic blueprint for designing modern, accessible, beautiful web applications with cohesive theme tokens, micro-interactions, visual hierarchy, and responsive layouts.
---

# UI/UX Design Craft System & Guidelines

Use this skill whenever designing, styling, prototyping, or refactoring user interfaces, web applications, dashboards, or components in Cyclode. This skill establishes aesthetic standards, color harmony, visual hierarchy, micro-interactions, and responsive ergonomics to guarantee every generated interface looks handcrafted and production-grade.

---

## 1. The 4 Aesthetic Archetypes

Always select a deliberate aesthetic archetype based on the application's domain rather than defaulting to generic gray utility styling.

### Archetype 1: Obsidian Minimalist Dark (Linear / Raycast / Vercel style)
* **Best For**: Developer tools, productivity apps, AI interfaces, modern dashboards.
* **Canvas Backdrop**: `#09090b` (deep neutral zinc) or `#030712` (deep obsidian).
* **Surface Layers**: `#18181b` (card), `#27272a` (elevated/hover).
* **Borders & Dividers**: `border-white/10` or `border-zinc-800/80` (never harsh opaque solid borders).
* **Typography**: Clean white headings (`text-zinc-100`), muted secondary labels (`text-zinc-400`), tight tracking (`tracking-tight`).
* **Accents**: Luminous electric indigo (`#6366f1`), cyan (`#06b6d4`), or emerald (`#10b981`) with soft glow focus rings (`ring-2 ring-indigo-500/30`).

### Archetype 2: OneDark Pro (Atom / VS Code Dev-Centric)
* **Best For**: Code editors, terminal companions, telemetry explorers, developer sandboxes.
* **Canvas Backdrop**: `#1e2227` (deep editor backdrop).
* **Surface Layers**: `#282c34` (workbench surface), `#21252b` (sidebar tone), `#2c313a` (card layer).
* **Borders**: `#3b4048` and `#4b5263` (subtle syntax dividers).
* **Syntax Accents**:
  * Blue: `#61afef` (functions/links)
  * Green: `#98c379` (strings/success)
  * Purple: `#c678dd` (keywords/accents)
  * Yellow/Amber: `#e5c07b` (warnings/classes)
  * Red/Coral: `#e06c75` (errors/destructive)

### Archetype 3: Crisp Editorial SaaS Light (Stripe / Framer / Notion style)
* **Best For**: E-commerce storefronts, business analytics, documentation, marketing platforms.
* **Canvas Backdrop**: `#f8fafc` (warm slate) or `#ffffff` (crisp white).
* **Surface Layers**: `#ffffff` (card surface) with subtle layered shadows (`shadow-xs` to `shadow-md`).
* **Borders**: `border-slate-200/80` (soft outline).
* **Typography**: Deep slate headings (`text-slate-900 font-semibold`), neutral body (`text-slate-600`), refined micro-labels (`text-slate-400 font-mono text-[11px]`).
* **Accents**: Deep royal violet (`#4f46e5`) or rich sapphire (`#2563eb`).

### Archetype 4: Modern Glassmorphic / Gradient Ambient
* **Best For**: Social media feeds, multimedia showcases, portfolio sites, Web3/crypto apps.
* **Translucent Surfaces**: `backdrop-blur-md bg-zinc-900/75 border border-white/10 shadow-2xl`.
* **Ambient Glows**: Subtle radial gradient backdrops (`bg-gradient-to-tr from-indigo-950/40 via-transparent to-purple-950/30`).
* **Hover States**: Glass highlights (`hover:bg-white/10 hover:border-white/20 transition-all duration-200`).

---

## 2. Visual Hierarchy & Spacing Rhythm

1. **Surface Elevation Model (Z-Index Rhythm)**:
   * **Level 0 (Canvas)**: Root background (`bg-zinc-950` or `bg-slate-900`).
   * **Level 1 (Card/Container)**: Primary surface (`bg-zinc-900 border border-zinc-800`).
   * **Level 2 (Active/Hover/Dropdown)**: Popovers, menus, input focus (`bg-zinc-800 border border-zinc-700`).
   * **Level 3 (Modal/Drawer Overlay)**: Full dialogs (`backdrop-blur-md bg-black/60`).

2. **Typography Scaling & Optical Spacing**:
   * **Display / Page Title**: `text-2xl sm:text-3xl font-bold tracking-tight text-white`.
   * **Section Header**: `text-lg font-semibold tracking-tight text-zinc-100`.
   * **Card Title**: `text-sm font-semibold text-zinc-200`.
   * **Body Text**: `text-sm text-zinc-300 leading-relaxed`.
   * **Secondary / Metadata**: `text-xs text-zinc-400 font-medium`.
   * **Micro Labels / Badges**: `text-[10px] sm:text-[11px] font-mono uppercase tracking-wider text-zinc-400`.

3. **Spatial Grid (4px / 8px Increments)**:
   * Compact spacing between related items: `gap-1.5` (6px) or `gap-2` (8px).
   * Container internal padding: `p-3.5` (14px) or `p-5` (20px).
   * Section separation: `space-y-6` (24px) or `space-y-8` (32px).

---

## 3. Micro-Interactions & State Completeness

Every interactive component MUST implement full state completeness:

### A. Buttons & Clickable Triggers
* Always provide hover, focus, active, and disabled states:
```html
<button class="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:scale-[0.98] text-white text-xs font-medium transition-all duration-150 shadow-xs hover:shadow-indigo-500/25 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center space-x-1.5">
  <i data-lucide="plus" class="w-3.5 h-3.5"></i>
  <span>Create Item</span>
</button>
```

### B. Shimmer Loading Skeletons
* Never show blank white flickers during asynchronous data loads:
```html
<div class="p-4 rounded-xl bg-zinc-900 border border-zinc-800 space-y-3 animate-pulse">
  <div class="flex items-center space-x-3">
    <div class="w-10 h-10 rounded-full bg-zinc-800"></div>
    <div class="space-y-1.5 flex-1">
      <div class="h-3.5 w-1/3 bg-zinc-800 rounded"></div>
      <div class="h-2.5 w-1/4 bg-zinc-800/60 rounded"></div>
    </div>
  </div>
  <div class="h-3 w-full bg-zinc-800/80 rounded"></div>
  <div class="h-3 w-4/5 bg-zinc-800/60 rounded"></div>
</div>
```

### C. Rich Empty States
* Never render an empty gray box when filters or tables have 0 results:
```html
<div class="p-8 rounded-2xl bg-zinc-900/60 border border-dashed border-zinc-800 text-center flex flex-col items-center justify-center space-y-3">
  <div class="w-12 h-12 rounded-2xl bg-zinc-800/80 border border-zinc-700/60 flex items-center justify-center text-zinc-400">
    <i data-lucide="inbox" class="w-6 h-6 stroke-[1.5]"></i>
  </div>
  <div class="space-y-1">
    <div class="text-sm font-semibold text-zinc-200">No items found</div>
    <div class="text-xs text-zinc-400 max-w-xs">Try adjusting your search terms or filter criteria.</div>
  </div>
  <button class="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 transition-colors">
    Reset Filters
  </button>
</div>
```

---

## 4. Responsive & Mobile-First Ergonomics

1. **Touch Target Sizing**:
   * Ensure interactive buttons, icon buttons, and list triggers have a hit area of at least **40px × 40px** (or `p-2` with minimum `min-h-[38px]`).
2. **Adaptive Layouts**:
   * **Desktop (≥ 1024px)**: 3-column layouts (Navigation Sidebar → Main Stream/Canvas → Auxiliary/Detail Pane).
   * **Tablet (768px – 1023px)**: 2-column layout (Collapsible Navigation → Main View).
   * **Mobile (< 768px)**: Single column with bottom navigation bar or top slide-out drawer (`fixed inset-y-0 left-0 z-50 w-72 bg-zinc-900 transform transition-transform`).
3. **Form Ergonomics**:
   * Stack form fields vertically on mobile (`flex-col sm:flex-row`).
   * Group related inputs into clearly titled cards with descriptive helper hints.

---

## 5. Accessibility (a11y) & Contrast Rules

* **Text Contrast**: Ensure WCAG AA compliance (minimum 4.5:1 contrast for normal body text, 3:1 for large headings).
* **Focus States**: Explicit, visible focus rings on keyboard navigation (`focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none`).
* **Semantic Tags**: Use proper semantic HTML elements (`<header>`, `<main>`, `<nav>`, `<section>`, `<article>`, `<button>`, `<input>`).
* **Icon Pairing**: Always accompany standalone icon buttons with descriptive `aria-label` or `title` attributes.

---

## 6. Design System Reference Guides

Consult the companion reference files for ready-to-use palettes and component recipes:
* [Color Palettes Reference](file:///Users/macken/Documents/antigravity/epic-rutherford/.agents/skills/ui-ux-design/references/color-palettes.md)
* [Component Recipes Reference](file:///Users/macken/Documents/antigravity/epic-rutherford/.agents/skills/ui-ux-design/references/component-recipes.md)
