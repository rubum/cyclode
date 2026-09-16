---
name: ui-ux-design
description: Comprehensive UI/UX design craft system and aesthetic blueprint for designing modern, accessible, beautiful web applications with cohesive theme tokens, micro-interactions, visual hierarchy, and responsive layouts.
---

# UI/UX Design Craft System & Guidelines

Use this skill whenever designing, styling, prototyping, or refactoring user interfaces, web applications, dashboards, or components in Cyclode. This skill establishes aesthetic standards, typography stacks, non-generic color harmony, iconography rules, micro-interactions, and responsive ergonomics to guarantee every generated interface looks handcrafted and production-grade.

---

## 1. The Anti-AI Cliché & Domain Signature Invariants

> [!IMPORTANT]
> **Ban on "AI Purple/Indigo Slop"**: Never default to glowing electric indigo/purple gradients (`#6366f1` / `#a855f7`) on pitch black backdrops with oversized centered hero text and low-density empty cards. Every application must adopt a deliberate, domain-appropriate aesthetic archetype with tailored typography, custom color tokens, and intentional information density.

### The Domain Signature Invariant
Before generating code for any interface, establish:
1. **Domain Metaphor**: What physical or professional world does this product inhabit? (e.g. trading desk, printing press, laboratory journal, terminal workbench).
2. **Signature Element**: One distinct visual, structural, or interactive element tailored strictly to this product (e.g. an integrated telemetry ticker, a contextual command drawer, or a split diff viewer).
3. **Defaults to Reject**: Name 3 predictable layout clichés to avoid for this interface type (e.g. rejecting a generic 3-card metric top bar or an unmotivated centered search bar).

---

## 2. The 6 Aesthetic Archetypes

Always select a deliberate archetype based on the application's domain:

### Archetype 1: Warm Editorial Craft (Terracotta & Stone)
* **Best For**: Knowledge repositories, research engines, publishing tools, luxury commerce.
* **Canvas Backdrop**: `#fcfbf9` (Warm Paper) or `#141210` (Deep Charcoal Dark).
* **Surface Layers**: `#f4f1ea` (Card Surface) / `#1e1b18` (Dark Card Surface).
* **Borders & Dividers**: `#e6e2d8` (Light) or `rgba(255, 255, 255, 0.08)` (Dark).
* **Typography**: Fraunces / Newsreader (Serif Display) + Plus Jakarta Sans / Inter.
* **Accents**: `#c2410c` (Terracotta / Burnt Orange) or `#854d0e` (Warm Ochre).

### Archetype 2: Japanese Ink & Hanko Vermillion (Sumi Black)
* **Best For**: High-precision engineering suites, terminal companions, audio workstations.
* **Canvas Backdrop**: `#121214` (Deep Sumi Ink).
* **Surface Layers**: `#1a1a1d` (Card), `#242428` (Elevated / Popover).
* **Borders**: `rgba(255, 255, 255, 0.07)` (Hairline grid).
* **Typography**: Geist or Inter + JetBrains Mono / Geist Mono.
* **Accents**: `#e11d48` (Hanko Seal Vermillion) or `#f59e0b` (Warm Amber).

### Archetype 3: Botanical & Nordic Pine (Deep Forest & Sage)
* **Best For**: Climate tech, environmental metrics, health & wellness, scientific dashboards.
* **Canvas Backdrop**: `#0a0f0d` (Midnight Forest) or `#f3f6f4` (Light Nordic Dew).
* **Surface Layers**: `#111a16` (Pine Card) / `#ffffff` (Light Card).
* **Borders**: `#1f2e27` (Dark) / `#dbe4de` (Light).
* **Typography**: Plus Jakarta Sans / Satoshi + Space Grotesk.
* **Accents**: `#10b981` (Emerald) or `#84cc16` (Nordic Lime).

### Archetype 4: Swiss Minimalist Monochrome (International Klein Blue)
* **Best For**: High-frequency financial terminals, SQL browsers, data matrices, telemetry viewers.
* **Canvas Backdrop**: `#000000` (Pitch Black) or `#ffffff` (Stark White).
* **Surface Layers**: `#0e0e10` (Surface) / `#fafafa` (Light Surface).
* **Borders**: `#222226` (Geometric Wireframe).
* **Typography**: Space Grotesk / Cabinet Grotesk + Satoshi / Inter.
* **Accents**: Single spot `#2563eb` (International Klein Blue) or `#e11d48` (Precision Red).

### Archetype 5: Refined Obsidian Minimalist Dark (True Neutral Zinc)
* **Best For**: Productivity suites, issue trackers (Linear-style), task graphs.
* **Canvas Backdrop**: `#09090b` (True Neutral Zinc Canvas).
* **Surface Layers**: `#141416` (Card), `#1f1f23` (Elevated Layer).
* **Borders**: `rgba(255, 255, 255, 0.08)` (Subtle hairline).
* **Typography**: Inter + JetBrains Mono.
* **Accents**: Functional `#3b82f6` (Links), `#10b981` (Success), `#f59e0b` (Pending), `#f43f5e` (Failed).

### Archetype 6: OneDark Pro (Dev-Centric Code & Workbench)
* **Best For**: Code editors, diff viewers, log stream analyzers, developer sandboxes.
* **Canvas Backdrop**: `#1e2227` (Deep Editor Canvas).
* **Surface Layers**: `#282c34` (Workbench), `#21252b` (Sidebar), `#2c313a` (Card).
* **Borders**: `#3b4048` and `#4b5263`.
* **Syntax Accents**: Blue `#61afef`, Green `#98c379`, Purple `#c678dd`, Yellow `#e5c07b`, Coral `#e06c75`.

---

## 3. Typography & Font Pairing Stacks

Always import curated Google Fonts or Fontshare fonts rather than relying on generic system defaults:

1. **Curated Font Stacks**:
   * *Engineering & Tech*: `Inter` / `Geist` + `JetBrains Mono` / `Geist Mono`.
   * *Editorial & Knowledge*: `Fraunces` / `Newsreader` + `Plus Jakarta Sans`.
   * *Geometric Modernist*: `Space Grotesk` / `Cabinet Grotesk` + `Satoshi`.
2. **Optical Tracking (Letter-Spacing) Rules**:
   * Large Display Titles ($\ge 24\text{px}$): Tight negative tracking (`tracking-tight` or `-0.025em`).
   * Micro-Labels, Badges, and Uppercase Tags ($\le 12\text{px}$): Wide tracking (`tracking-widest` or `+0.08em`).
3. **Tabular Numbers Invariant (`tabular-nums`)**:
   * Always apply `tabular-nums` (`font-variant-numeric: tabular-nums`) to metrics, clocks, table columns, and counters to eliminate horizontal number shifting.
4. **Reading Measure**:
   * Constrain prose containers to `max-w-prose` (60–75 characters) with `leading-relaxed` (1.625) line spacing.

---

## 4. Iconography & Optical Alignment

1. **Unified Vector Set**:
   * Use **Lucide Icons** (`https://unpkg.com/lucide@latest`) as the default icon standard. Never mix disparate icon libraries in the same view.
2. **Stroke Width Consistency**:
   * Standardize on `stroke-[1.5]` or `stroke-[1.75]` across all navigation and interactive controls. Reserve `stroke-2` strictly for active status badges.
   * Always add `shrink-0` to prevent flexbox crushing.
3. **Touch Target Dimensions**:
   * Encapsulate optical icons ($14\text{px}$–$18\text{px}$) inside an interactive container with minimum dimensions of **$36\text{px} \times 36\text{px}$** (or $40\text{px} \times 40\text{px}$).
4. **Accessibility**:
   * Decorative icons must include `aria-hidden="true"`.
   * Icon-only buttons must include an explicit `aria-label="Action description"` and `title="Action description"`.

---

## 5. Spacing, Information Density & Layout Geometry

### 3-Tier Information Density Scale
* **High Density (Data-Dense / Telemetry)**: Padding `p-2` to `p-3`, text `text-xs`, row height `h-8` to `h-9` (28px–36px).
* **Balanced (Productivity / SaaS)**: Padding `p-3.5` to `p-5`, text `text-sm`, row height `h-10` to `h-11` (40px–44px).
* **Comfortable (Editorial / Marketing)**: Padding `p-6` to `p-10`, text `text-base`, row height `h-12` to `h-14` (48px–56px).

### Geometric Container Invariants
* **The Inset Formula**: The border radius of an inner element must equal outer radius minus padding:
  $$R_{\text{inner}} = R_{\text{outer}} - P$$
* **Spatial Hierarchy**: Internal container padding must be tighter than the external gap between containers ($P_{\text{inner}} < G_{\text{outer}}$).

---

## 6. Interaction Physics & Animation Tokens

1. **Deceleration Curves**: Use swift deceleration for reveals and modals:
   `cubic-bezier(0.16, 1, 0.3, 1)` (`--ease-out-expo`).
2. **Micro-Press Tactile Feedback**:
   Apply `active:scale-[0.98]` or `active:translate-y-0.5` with `transition-all duration-150`.
3. **Motion Sensitivity**:
   Always include `motion-reduce:transition-none` and `motion-reduce:animate-none`.

---

## 7. Pre-Delivery Critique & Self-Audit

Before finalizing an interface or completing a task, conduct the 4-step self-review:
1. **The Squint Test**: Blurring your vision must still reveal the top 3 dominant focal points clearly.
2. **Reading Path Continuity**: Visual flow travels naturally from Primary Title $\rightarrow$ Work Canvas $\rightarrow$ Actions.
3. **Single Depth Strategy**: Maintain one unified depth model (clean flat borders OR soft layered ambient shadows).
4. **6-State Matrix**: Verify `Default`, `Hover`, `Active/Press`, `Focus-Visible`, `Loading/Skeleton`, and `Empty/Error` states.

---

## 8. Design System Reference Guides

Consult the companion reference files for ready-to-use tokens, code guardrails, and component recipes:
* [Critique Protocol & Self-Audit](file:///Users/macken/Documents/antigravity/epic-rutherford/.agents/skills/ui-ux-design/references/critique-protocol.md)
* [AI Frontend Anti-Patterns](file:///Users/macken/Documents/antigravity/epic-rutherford/.agents/skills/ui-ux-design/references/anti-patterns.md)
* [Typography & Fonts Reference](file:///Users/macken/Documents/antigravity/epic-rutherford/.agents/skills/ui-ux-design/references/typography-fonts.md)
* [Iconography & Motion Physics Reference](file:///Users/macken/Documents/antigravity/epic-rutherford/.agents/skills/ui-ux-design/references/iconography-motion.md)
* [Color Palettes Reference](file:///Users/macken/Documents/antigravity/epic-rutherford/.agents/skills/ui-ux-design/references/color-palettes.md)
* [Component Recipes Reference](file:///Users/macken/Documents/antigravity/epic-rutherford/.agents/skills/ui-ux-design/references/component-recipes.md)

---

## 9. Reference Architectures & Examples

Study the complete, standalone reference application for master-detail audio and synchronized transcription:
* [VoxScribe Audio Studio Reference App](file:///Users/macken/Documents/antigravity/epic-rutherford/.agents/skills/ui-ux-design/examples/audio-studio/index.html) — Demonstrates canvas audio waveforms, synchronized word-seeking diarization, collapsible 48px recording dock, and single-accent Obsidian Dark craft.

