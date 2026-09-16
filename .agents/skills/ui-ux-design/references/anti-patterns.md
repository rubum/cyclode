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
