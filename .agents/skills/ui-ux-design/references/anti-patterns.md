# AI Frontend Anti-Patterns & Code Hallucinations Reference

Autonomous agents frequently generate subtle, hard-to-detect frontend bugs due to statistical template matching. This guide identifies the most common AI frontend hallucinations and provides strict correction rules.

---

## 1. Dynamic Tailwind Class Interpolation (JIT Breaking)

> [!CAUTION]
> **Never write string-interpolated Tailwind classes**: Tailwind CSS uses a static scanner (JIT) to generate CSS classes at build time. Dynamic concatenations like `bg-${color}-500` or `text-${size}` are stripped from the final bundle, resulting in unstyled elements.

### ❌ Anti-Pattern (Broken JIT):
```javascript
// FAILS: Tailwind JIT scanner will not generate these classes
function StatusBadge({ status }) {
  const color = status === 'active' ? 'emerald' : 'rose';
  return <span className={`px-2 py-0.5 bg-${color}-500/10 text-${color}-400`}>{status}</span>;
}
```

### ✅ Correct Pattern (Explicit Class Mapping):
```javascript
// PASSES: Explicit full class strings are detected by Tailwind scanner
const STATUS_STYLES = {
  active: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  pending: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  failed: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
};

function StatusBadge({ status }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-mono font-medium border ${STATUS_STYLES[status] || STATUS_STYLES.pending}`}>
      {status.toUpperCase()}
    </span>
  );
}
```

---

## 2. Viewport Shifting & Mobile Address Bar Clashing (`h-screen`)

> [!WARNING]
> `h-screen` maps to `100vh`, which does not account for dynamic browser toolbars/address bars on mobile devices (iOS Safari, Android Chrome), causing bottom navigation buttons to be cut off.

### ❌ Anti-Pattern:
```html
<div class="h-screen flex flex-col">...</div>
```

### ✅ Correct Pattern (Dynamic Viewport Height):
```html
<!-- Uses modern dynamic viewport height (dvh) with fallback -->
<div class="min-h-screen min-h-dvh flex flex-col">...</div>
```

---

## 3. Pseudo-Transparency Contrast Collapse

AI models often stack multiple semi-transparent overlays (`bg-white/5`, `bg-zinc-900/50`, `backdrop-blur-md`) without verifying cumulative contrast, leading to washed-out, illegible text.

### ❌ Anti-Pattern:
```html
<div class="bg-white/5">
  <div class="bg-white/5 text-white/40">
    <!-- Resulting text contrast is under 2:1 (fails WCAG AA) -->
    <p>Unreadable faded label</p>
  </div>
</div>
```

### ✅ Correct Pattern (Calibrated Opacity):
```html
<div class="bg-zinc-900 border border-zinc-800">
  <div class="p-4">
    <!-- Clear 4.5:1+ contrast against dark surface -->
    <p class="text-xs font-medium text-zinc-400">Crisp secondary metadata</p>
    <p class="text-sm font-semibold text-zinc-100">Primary label</p>
  </div>
</div>
```

---

## 4. External Anchor Security Vulnerabilities

Opening new browser tabs without `rel="noopener noreferrer"` exposes applications to `window.opener` reverse-tabnabbing security exploits.

### ❌ Anti-Pattern:
```html
<a href="https://example.com" target="_blank">Documentation</a>
```

### ✅ Correct Pattern:
```html
<a href="https://example.com" target="_blank" rel="noopener noreferrer" class="text-zinc-300 hover:text-white underline underline-offset-4 decoration-zinc-600">
  Documentation
</a>
```

---

## 5. Native Browser Dialogs vs. In-App Primitives

Native JavaScript dialogs (`alert()`, `confirm()`, `prompt()`) freeze browser execution threads, look unstyled, and are blocked in iframe environments (such as preview panels).

### ❌ Anti-Pattern:
```javascript
// FAILS in sandboxes and preview iframes
if (confirm("Delete this workspace?")) {
  deleteWorkspace();
}
```

### ✅ Correct Pattern:
Use custom in-app confirmation modals or toast triggers (see [component-recipes.md](file:///Users/macken/Documents/antigravity/epic-rutherford/.agents/skills/ui-ux-design/references/component-recipes.md)).

---

## 6. Modal Scroll-Lock Memory Leaks

When displaying overlay dialogs or drawers, setting `document.body.style.overflow = 'hidden'` without a cleanup listener leaves the user unable to scroll if the component unmounts unexpectedly.

### ✅ Correct React Cleanup Pattern:
```javascript
useEffect(() => {
  if (!isOpen) return;
  const originalStyle = window.getComputedStyle(document.body).overflow;
  document.body.style.overflow = 'hidden';
  return () => {
    document.body.style.overflow = originalStyle;
  };
}, [isOpen]);
```

---

## 7. Hallucinated or Non-Existent CSS Classes

Never guess Tailwind classes that are not part of standard Tailwind core without custom plugins:
* ❌ `text-shadow`, `text-shadow-md` (Requires custom CSS or plugin)
* ❌ `glow`, `glow-indigo` (Use `shadow-[0_0_20px_rgba(99,102,241,0.25)]` or `ring-2 ring-indigo-500/30`)
* ❌ `flex-center` (Use `flex items-center justify-center`)
* ❌ `p-18`, `gap-18` (Tailwind standard spacing jumps from 16 to 20: use `p-16`, `p-20`, or arbitrary `p-[72px]`)

---

## 8. The "Multi-Color Rainbow" Trap

> [!CAUTION]
> **Never assign separate saturated accent colors across adjacent UI controls**: Stacking purple buttons, green badges, glowing red indicators, and blue borders simultaneously destroys visual hierarchy and immediately signals an AI-generated interface.

### ❌ Anti-Pattern (Color Clutter):
```html
<!-- FAILS: 4 saturated primary accents competing on the same card -->
<div class="p-4 bg-slate-900 border border-blue-500 rounded-xl">
  <button class="bg-purple-600 text-white">AI Summary</button>
  <button class="bg-green-600 text-white">Backup</button>
  <button class="bg-red-600 text-white shadow-lg shadow-red-500/50">Record</button>
</div>
```

### ✅ Correct Pattern (Strict Single Accent Hierarchy):
```html
<!-- PASSES: Single signature accent (amber) with subtle neutral secondary actions -->
<div class="p-4 bg-zinc-900 border border-zinc-800 rounded-2xl flex items-center justify-between">
  <button class="px-3.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-300 border border-zinc-700/60 transition-colors">
    AI Summary
  </button>
  <button class="px-3.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-300 border border-zinc-700/60 transition-colors">
    Backup
  </button>
  <button class="px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 active:scale-[0.98] text-xs font-semibold text-zinc-950 transition-all shadow-xs">
    Record
  </button>
</div>
```

---

## 9. The "Dominant Creation Box" Crushing Sidebar Lists

> [!WARNING]
> When a sidebar contains both a creation tool (e.g. recording widget, filter builder) and a resource list, letting the creation box occupy $>20\%$ of vertical space squishes the primary navigation list into an unusable sliver.

### ❌ Anti-Pattern:
```html
<!-- FAILS: 300px static recorder card taking half the sidebar height -->
<aside class="w-80 h-full flex flex-col p-4">
  <div class="h-[320px] bg-zinc-900 rounded-2xl p-6">...Huge Recorder...</div>
  <div class="flex-1 overflow-y-auto mt-4">...Only 2 notes fit here...</div>
</aside>
```

### ✅ Correct Pattern (The 80/20 Sidebar Content Ratio):
```html
<!-- PASSES: Compact 48px header or floating bottom dock, reserving 80%+ for list stream -->
<aside class="w-80 h-full flex flex-col bg-zinc-900 border-r border-zinc-800">
  <!-- Compact sticky top bar (< 20% height) -->
  <div class="p-3 border-b border-zinc-800 flex items-center justify-between">
    <span class="text-xs font-semibold text-zinc-200">Recordings (24)</span>
    <button class="px-2.5 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-100 flex items-center space-x-1.5">
      <i data-lucide="plus" class="w-3.5 h-3.5"></i>
      <span>New</span>
    </button>
  </div>
  <!-- Primary scrollable resource stream (>= 80% height) -->
  <div class="flex-1 overflow-y-auto p-3 space-y-2">
    <!-- Clean list items -->
  </div>
</aside>
```

---

## 10. The Disconnected Data Visualizer & Scrubber

AI models frequently render audio waveforms, stock charts, or video timelines as static decorative SVG bars with a standard HTML `<input type="range">` slider floating awkwardly below.

### ❌ Anti-Pattern:
```html
<!-- FAILS: Static decorative bars disconnected from playback slider -->
<div class="space-y-2">
  <div class="flex items-center space-x-1 h-12 bg-zinc-900 p-2">...Static SVG Bars...</div>
  <input type="range" class="w-full" />
</div>
```

### ✅ Correct Pattern (Integrated Scrubber Track):
* The visualizer **must be the interactive scrub track itself**. The playback head and progress fill overlay directly across the waveform bars, with hover timecode tooltips (see [component-recipes.md](file:///Users/macken/Documents/antigravity/epic-rutherford/.agents/skills/ui-ux-design/references/component-recipes.md)).

---

## 11. Raw `<textarea>` Dump for Structured Media Transcripts

Placing speech transcripts, LLM reasoning steps, or audit logs into an unformatted, resizable `<textarea>` looks crude and lacks media synchronization.

### ❌ Anti-Pattern:
```html
<!-- FAILS: Plain textarea with resize handle -->
<textarea class="w-full h-64 bg-zinc-900 text-zinc-300 p-4 rounded-xl resize">
  We need to migrate our worker pool...
</textarea>
```

### ✅ Correct Pattern (Synchronized Speaker Diarization Stream):
* Transcripts must be rendered as **structured DOM speaker blocks** with speaker avatar, timestamp pill, and clickable word spans for synchronized audio seeking.

---

## 12. Raw Unicode Emoji Pollution in System Navigation

Sprinkling OS emojis (`💡`, `🚀`, `🔥`, `📁`) into pill tags, table headers, and sidebar items causes visual clutter and renders inconsistently across platforms (macOS Apple Color Emoji vs Windows Segoe UI Emoji).

### ❌ Anti-Pattern:
```html
<!-- FAILS: Raw emojis render with mismatched styles and colors -->
<div class="flex space-x-2">
  <span>💡 Ideas</span>
  <span>👥 Meetings</span>
  <span>💼 Lectures</span>
</div>
```

### ✅ Correct Pattern (Unified Vector Icons):
```html
<!-- PASSES: Pure Lucide SVG icons with uniform stroke and subtle container styling -->
<div class="flex items-center space-x-1.5">
  <span class="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-zinc-800/80 border border-zinc-700/60 text-xs font-medium text-zinc-300">
    <i data-lucide="lightbulb" class="w-3.5 h-3.5 stroke-[1.5] text-zinc-400" aria-hidden="true"></i>
    <span>Ideas</span>
  </span>
  <span class="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-zinc-800/80 border border-zinc-700/60 text-xs font-medium text-zinc-300">
    <i data-lucide="users" class="w-3.5 h-3.5 stroke-[1.5] text-zinc-400" aria-hidden="true"></i>
    <span>Meetings</span>
  </span>
</div>
```

