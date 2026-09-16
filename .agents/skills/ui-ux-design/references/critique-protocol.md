# Pre-Delivery Critique Protocol & Self-Audit Guide

Before presenting any generated interface or completing a UI task, run through this rigorous self-evaluation checklist. If any criterion fails, iterate on the code before finalizing.

---

## 1. Composition & Visual Hierarchy

### The Squint Test
* **Blur your eyes or look at the screen from a distance**:
  * Can you instantly identify the **three most important visual elements**?
  * If the entire interface blurs into a uniform sea of cards or identical gray boxes, hierarchy has failed. Increase contrast on primary elements and reduce secondary noise.

### Focal Point Invariant
* Every view must have **one dominant primary action or hero data point** (e.g., the primary CTA button or main visualization canvas).
* When everything on screen is given equal visual weight, nothing gets noticed.

### Reading Path Continuity
* Verify that an eye scanning the page moves logically:
  1. Primary Status / Title Heading
  2. Main Data Stream / Work Canvas
  3. Contextual Controls & Filters
  4. Auxiliary / Secondary Metadata

---

## 2. Craft, Spacing & Proportions

### Spacing System Rigor
* Every margin, padding, and gap must trace directly to a defined spacing token scale (`gap-1.5`, `gap-3`, `p-4`, `p-6`).
* Inconsistent random gaps (`margin-top: 13px`) are the clearest indicator of uncalibrated UI code.

### Density Calibration
* Verify density matches the product's actual purpose:
  * **Data-Dense (Trading, Logs, Telemetry)**: Compact rows (`h-8` to `h-9`), `text-xs`, minimal vertical whitespace.
  * **Productivity (Linear-style tools)**: Balanced padding (`p-4`), `text-sm`, clear row separation.
  * **Editorial / Publishing**: Generous breathing room (`p-8`), `max-w-prose`, high line-heights.

---

## 3. Depth Strategy & Whisper-Quiet Elevation

### Single Depth Strategy Rule
* **Choose ONE primary depth model and apply it consistently across the entire view**:
  * *Option A (Flat Border-First)*: Clean 1px translucent borders (`border-white/10` or `border-zinc-800`) with zero heavy drop shadows.
  * *Option B (Layered Ambient Shadows)*: Soft diffuse elevation shadows (`shadow-sm`, `shadow-md`, `shadow-indigo-500/10`) with minimal border contrast.
* Mixing harsh heavy drop shadows alongside sharp thick borders creates visual clutter.

### Quiet Elevation Invariant
* Elevation jumps between canvas $\rightarrow$ card $\rightarrow$ dropdown must be subtle (only a few percentage points of background lightness shift).

---

## 4. The 6-State Completeness Matrix

Verify that every interactive component supports all 6 essential states:

| State | Requirement | Verification Check |
| :--- | :--- | :--- |
| **1. Default** | Clear, legible surface with unambiguous hierarchy | Text contrast $\ge 4.5:1$ (WCAG AA) |
| **2. Hover** | Smooth visual feedback (`150ms` transition) | Background tint or border highlight |
| **3. Active / Press** | Tactile mechanical compression | `active:scale-[0.98]` or `active:translate-y-0.5` |
| **4. Focus-Visible** | Unambiguous keyboard navigation focus ring | `focus-visible:ring-2 focus-visible:outline-none` |
| **5. Loading / Skeleton** | Shimmer placeholder matching exact content layout | `animate-pulse` without layout shift |
| **6. Empty / Error** | Contextual icon, clear description & reset CTA | Never show an unstyled blank empty rectangle |

---

## 5. Typography & Numbers Verification

* [ ] Large headings have negative optical tracking (`tracking-tight` or `tracking-tighter`).
* [ ] Uppercase micro-caps and badges have wide tracking (`tracking-widest`).
* [ ] All numeric figures, metrics, timestamps, and table columns use `tabular-nums` (`font-variant-numeric: tabular-nums`).
* [ ] Multi-line prose paragraphs are constrained to `max-w-prose` (60–75 characters per line).
