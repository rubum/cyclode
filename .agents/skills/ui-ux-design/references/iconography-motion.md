# Iconography & Motion Physics Reference

High-craft digital products require seamless iconographic harmony and tactile physics. This guide provides standards for icon libraries, stroke weights, hit areas, accessibility, and easing curves.

---

## 1. Icon Library Standards

Always use a unified vector icon set. Never mix disparate icon libraries in the same application.

### Recommended Libraries
1. **Lucide Icons (Recommended Default)**: Clean, modern, extensive icon set designed for precision software.
   ```html
   <!-- Lucide CDN Script -->
   <script src="https://unpkg.com/lucide@latest"></script>
   <script>
     // Initialize icons after DOM rendering
     document.addEventListener('DOMContentLoaded', () => {
       lucide.createIcons();
     });
   </script>
   ```
2. **Phosphor Icons**: Versatile icon family with multiple weight styles (thin, light, regular, bold, duotone).
   ```html
   <script src="https://unpkg.com/@phosphor-icons/web"></script>
   ```
3. **Heroicons**: Tailwind-native icons with solid, outline, and micro variants.

---

## 2. Stroke Width & Optical Alignment Rules

| Context | Stroke Class | Target Size | Alignment Rule |
| :--- | :--- | :--- | :--- |
| **Inline with Body Text** | `stroke-[1.5]` or `stroke-[1.75]` | `w-4 h-4` (16px) | `inline-flex items-center shrink-0` |
| **Buttons & Action Triggers** | `stroke-[1.75]` | `w-3.5 h-3.5` (14px) or `w-4 h-4` | Centered with `space-x-1.5` gap |
| **Standalone Icon Buttons** | `stroke-[1.5]` | `w-4 h-4` to `w-5 h-5` | Centered inside $\ge 36\text{px} \times 36\text{px}$ touch target |
| **Feature Badges / Empty States** | `stroke-[1.25]` to `stroke-[1.5]` | `w-6 h-6` (24px) to `w-8 h-8` | Centered in soft tinted background circle/squircle |

### Strict Stroke Width Consistency
* **Do NOT mix stroke weights** randomly (e.g. some icons at 1.0px and others at 2.5px in the same card). Maintain a consistent `1.5px` or `1.75px` stroke across all navigation and action controls.
* **Always add `shrink-0`**: In flexbox layouts, icons will crush or warp unless protected by `shrink-0` or `flex-shrink: 0`.

---

## 3. Touch Targets vs. Optical Icon Dimensions

> [!IMPORTANT]
> **The 36px/40px Ergonomic Rule**: A 16px icon alone is nearly impossible to tap accurately on mobile or touchscreens. Always encapsulate the icon inside an interactive container with minimum dimensions of $36\text{px} \times 36\text{px}$ (or $40\text{px} \times 40\text{px}$).

### High-Craft Icon Button Pattern:
```html
<button 
  type="button" 
  aria-label="Filter records" 
  class="w-9 h-9 min-w-[36px] min-h-[36px] rounded-lg bg-zinc-800/80 hover:bg-zinc-700/80 active:scale-[0.96] text-zinc-400 hover:text-zinc-100 border border-zinc-700/50 flex items-center justify-center transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 cursor-pointer"
>
  <i data-lucide="sliders-horizontal" class="w-4 h-4 stroke-[1.5]" aria-hidden="true"></i>
</button>
```

---

## 4. Accessibility (a11y) for Icons

1. **Decorative Icons** (accompanied by visible text):
   * Add `aria-hidden="true"` to prevent screen readers from announcing redundant visual glyphs.
2. **Interactive Icon Buttons** (no visible text):
   * Must include an explicit `aria-label="Descriptive action"` on the `<button>` element.
   * Provide a native `title="Descriptive action"` tooltip for desktop hover discoverability.

---

## 5. Interaction Physics & Animation Easing Curves

High-craft interfaces feel alive through **subtle deceleration physics and immediate mechanical feedback**.

### Easing Tokens
```css
:root {
  /* Fast deceleration for entrances and reveals (smooth spring-like stop) */
  --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
  /* Standard transition curve for hovers and toggles */
  --ease-smooth: cubic-bezier(0.2, 0, 0, 1);
}
```

### Motion Timing Standards
* **Micro-Interactions (Hovers, active presses, badge toggles)**: `100ms` to `150ms`.
* **Dropdowns & Popovers (Scale + Fade in)**: `150ms` to `200ms` with `--ease-out-expo`.
* **Modals, Drawers & Full Dialogs**: `200ms` to `300ms` with `--ease-out-expo`.
* **Tactile Button Press**: `active:scale-[0.98]` or `active:translate-y-0.5`.

### Tailwind CSS Animation Presets
```javascript
tailwind.config = {
  theme: {
    extend: {
      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        slideDown: {
          '0%': { opacity: '0', transform: 'translateY(-8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideInRight: {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        }
      },
      animation: {
        'fade-in': 'fadeIn 180ms cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'slide-down': 'slideDown 200ms cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'slide-drawer': 'slideInRight 250ms cubic-bezier(0.16, 1, 0.3, 1) forwards',
      }
    }
  }
};
```

### Motion Sensitivity Rule
Always include `motion-reduce:transition-none` and `motion-reduce:animate-none` to honor user OS accessibility preferences.
