# UI/UX Component Recipes

Production-ready, highly polished component patterns for HTML, Tailwind CSS, and React single-page applications.

---

## 1. Form Input with Clear Button, Keyboard Badge & Inline Error State

```html
<div class="space-y-1.5 w-full max-w-sm">
  <div class="flex items-center justify-between text-xs">
    <label for="search-input" class="font-medium text-zinc-300">Project Search</label>
    <span class="text-zinc-500 font-mono text-[11px]">Required</span>
  </div>
  
  <div class="relative flex items-center">
    <div class="absolute left-3 flex items-center pointer-events-none text-zinc-500">
      <i data-lucide="search" class="w-4 h-4 stroke-[1.5]" aria-hidden="true"></i>
    </div>
    
    <input
      id="search-input"
      type="text"
      placeholder="Type to filter repositories..."
      class="w-full pl-9 pr-16 py-2 rounded-lg bg-zinc-900 border border-zinc-700/80 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:border-zinc-500 transition-all duration-150"
    />
    
    <div class="absolute right-2.5 flex items-center space-x-1.5">
      <kbd class="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-[10px] font-mono text-zinc-400">⌘K</kbd>
    </div>
  </div>

  <!-- Inline Validation Message -->
  <p class="text-xs text-rose-400 flex items-center space-x-1 pt-0.5">
    <i data-lucide="alert-circle" class="w-3.5 h-3.5 stroke-[1.75]" aria-hidden="true"></i>
    <span>Repository name cannot contain special characters.</span>
  </p>
</div>
```

---

## 2. Sliding Segmented Control / Tab Switcher

```html
<div class="inline-flex p-1 rounded-xl bg-zinc-900/90 border border-zinc-800/90 shadow-inner" role="tablist">
  <button 
    role="tab" 
    aria-selected="true"
    class="px-3 py-1.5 rounded-lg bg-zinc-800 text-xs font-medium text-white shadow-xs transition-all duration-150 flex items-center space-x-1.5 cursor-pointer"
  >
    <i data-lucide="layout-grid" class="w-3.5 h-3.5 stroke-[1.5]" aria-hidden="true"></i>
    <span>Overview</span>
  </button>
  
  <button 
    role="tab" 
    aria-selected="false"
    class="px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors flex items-center space-x-1.5 cursor-pointer"
  >
    <i data-lucide="activity" class="w-3.5 h-3.5 stroke-[1.5]" aria-hidden="true"></i>
    <span>Telemetry</span>
    <span class="px-1.5 py-0.2 rounded-full bg-zinc-800 text-[10px] font-mono text-zinc-400">12</span>
  </button>

  <button 
    role="tab" 
    aria-selected="false"
    class="px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors flex items-center space-x-1.5 cursor-pointer"
  >
    <i data-lucide="settings" class="w-3.5 h-3.5 stroke-[1.5]" aria-hidden="true"></i>
    <span>Settings</span>
  </button>
</div>
```

---

## 3. Data-Dense Table with Sticky Header & Strict Alignment

```html
<div class="w-full rounded-2xl border border-zinc-800/80 bg-zinc-900/60 overflow-hidden shadow-sm">
  <div class="overflow-x-auto">
    <table class="w-full text-left text-xs border-collapse">
      <thead class="sticky top-0 z-10 bg-zinc-900/95 backdrop-blur-md border-b border-zinc-800 text-zinc-400 uppercase font-mono text-[10px] tracking-wider">
        <tr>
          <th class="py-3 px-4 text-left font-semibold">Service Name</th>
          <th class="py-3 px-4 text-center font-semibold">Status</th>
          <th class="py-3 px-4 text-right font-semibold">Latency</th>
          <th class="py-3 px-4 text-right font-semibold">Throughput</th>
          <th class="py-3 px-4 text-right font-semibold">Actions</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-zinc-800/60 text-zinc-300">
        <tr class="hover:bg-zinc-800/40 transition-colors group">
          <td class="py-3 px-4 font-medium text-zinc-100 flex items-center space-x-2.5">
            <div class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
            <span>api-gateway-us-east</span>
          </td>
          <td class="py-3 px-4 text-center">
            <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              HEALTHY
            </span>
          </td>
          <td class="py-3 px-4 text-right font-mono tabular-nums text-zinc-200">14.2 ms</td>
          <td class="py-3 px-4 text-right font-mono tabular-nums text-zinc-200">18,420 req/s</td>
          <td class="py-3 px-4 text-right">
            <button class="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-zinc-700 text-zinc-400 hover:text-white transition-all cursor-pointer">
              <i data-lucide="more-horizontal" class="w-4 h-4 stroke-[1.5]"></i>
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</div>
```

---

## 4. Stackable Toast Notification Container

```html
<div class="fixed bottom-5 right-5 z-50 flex flex-col space-y-2.5 max-w-sm w-full pointer-events-none">
  <!-- Toast Item -->
  <div class="pointer-events-auto p-3.5 rounded-xl bg-zinc-900 border border-zinc-700/80 shadow-2xl flex items-start space-x-3 transform transition-all duration-200 animate-slide-down">
    <div class="p-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 shrink-0">
      <i data-lucide="check" class="w-4 h-4 stroke-[2]" aria-hidden="true"></i>
    </div>
    
    <div class="space-y-0.5 flex-1 min-w-0">
      <h4 class="text-xs font-semibold text-zinc-100 tracking-tight">Deployment Complete</h4>
      <p class="text-[11px] text-zinc-400 leading-snug truncate">v1.4.2 successfully pushed to production.</p>
    </div>

    <button class="text-zinc-500 hover:text-zinc-300 p-1 rounded transition-colors cursor-pointer" aria-label="Dismiss">
      <i data-lucide="x" class="w-3.5 h-3.5 stroke-[1.5]"></i>
    </button>
  </div>
</div>
```

---

## 5. Command Palette (`Cmd+K`) Quick Modal

```html
<div class="fixed inset-0 z-50 flex items-start justify-center pt-24 p-4 bg-black/75 backdrop-blur-md">
  <div class="w-full max-w-lg rounded-2xl bg-zinc-900 border border-zinc-700/80 shadow-2xl overflow-hidden animate-fade-in flex flex-col">
    <!-- Search Bar -->
    <div class="px-4 py-3.5 border-b border-zinc-800 flex items-center space-x-3 bg-zinc-900/50">
      <i data-lucide="search" class="w-4 h-4 text-zinc-400 stroke-[1.5]" aria-hidden="true"></i>
      <input 
        type="text" 
        placeholder="Type a command or search actions..." 
        class="w-full bg-transparent text-sm text-white placeholder-zinc-500 focus:outline-none"
        autofocus
      />
      <kbd class="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-[10px] font-mono text-zinc-400">ESC</kbd>
    </div>

    <!-- Results Group -->
    <div class="p-2 overflow-y-auto max-h-72 space-y-1">
      <div class="px-2.5 py-1 text-[10px] font-mono uppercase text-zinc-500 tracking-wider">Suggested Actions</div>
      
      <button class="w-full px-3 py-2 rounded-lg text-left text-xs text-zinc-200 hover:bg-zinc-800 flex items-center justify-between group transition-colors cursor-pointer">
        <div class="flex items-center space-x-2.5">
          <i data-lucide="git-branch" class="w-4 h-4 text-zinc-400 group-hover:text-white stroke-[1.5]"></i>
          <span>Create New Branch</span>
        </div>
        <kbd class="text-[10px] font-mono text-zinc-500 group-hover:text-zinc-300">⌘N</kbd>
      </button>

      <button class="w-full px-3 py-2 rounded-lg text-left text-xs text-zinc-200 hover:bg-zinc-800 flex items-center justify-between group transition-colors cursor-pointer">
        <div class="flex items-center space-x-2.5">
          <i data-lucide="play" class="w-4 h-4 text-zinc-400 group-hover:text-white stroke-[1.5]"></i>
          <span>Trigger Full Preview Build</span>
        </div>
        <kbd class="text-[10px] font-mono text-zinc-500 group-hover:text-zinc-300">⌘B</kbd>
      </button>
    </div>
  </div>
</div>
```

---

## 6. Metric Stat Card with Sparkline & Trend Badge

```html
<div class="p-5 rounded-2xl bg-zinc-900/80 border border-zinc-800/80 hover:border-zinc-700/80 transition-all duration-200 shadow-sm space-y-3">
  <div class="flex items-center justify-between">
    <span class="text-xs font-medium text-zinc-400">Total API Invocations</span>
    <div class="p-1.5 rounded-lg bg-zinc-800/80 border border-zinc-700/50 text-zinc-300">
      <i data-lucide="zap" class="w-3.5 h-3.5 stroke-[1.5]" aria-hidden="true"></i>
    </div>
  </div>
  
  <div class="flex items-baseline justify-between">
    <div class="text-2xl font-bold tracking-tight text-white font-mono tabular-nums">1,842,900</div>
    <div class="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[11px] font-mono font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
      <span>↑</span>
      <span class="tabular-nums">14.8%</span>
    </div>
  </div>

  <div class="text-[11px] text-zinc-500 leading-none">Compared to 1,605,200 last cycle</div>
</div>
```

---

## 7. Interactive Waveform Scrubber Track (Integrated Media Timeline)

```html
<div class="p-4 rounded-2xl bg-zinc-900 border border-zinc-800 space-y-3">
  <!-- Top Bar: Play Trigger, Title & Timecodes -->
  <div class="flex items-center justify-between">
    <div class="flex items-center space-x-3">
      <button 
        type="button" 
        class="w-8 h-8 rounded-full bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white flex items-center justify-center transition-all shadow-xs cursor-pointer"
        aria-label="Play audio"
      >
        <i data-lucide="play" class="w-3.5 h-3.5 fill-white stroke-none ml-0.5" aria-hidden="true"></i>
      </button>
      <div>
        <h4 class="text-xs font-semibold text-zinc-100">Q3 Cloud Infrastructure Sync</h4>
        <span class="text-[11px] text-zinc-400 font-mono tabular-nums">00:06 / 00:19</span>
      </div>
    </div>

    <!-- Playback Speed Multiplier -->
    <button class="px-2 py-0.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-[11px] font-mono text-zinc-300 transition-colors">
      1.5x
    </button>
  </div>

  <!-- Waveform Scrub Track Container -->
  <div class="relative h-12 w-full bg-zinc-950/60 rounded-xl p-2 flex items-center justify-between gap-0.5 cursor-pointer group select-none">
    <!-- Past Audio Bars (Accent Colored) -->
    <div class="w-1 rounded-full bg-indigo-500 h-4 group-hover:brightness-110"></div>
    <div class="w-1 rounded-full bg-indigo-500 h-8 group-hover:brightness-110"></div>
    <div class="w-1 rounded-full bg-indigo-500 h-6 group-hover:brightness-110"></div>
    <div class="w-1 rounded-full bg-indigo-500 h-10 group-hover:brightness-110"></div>
    <!-- Active Playhead Line -->
    <div class="relative w-1 rounded-full bg-white h-10 shadow-[0_0_8px_rgba(255,255,255,0.8)]">
      <!-- Hover Timecode Tooltip -->
      <span class="absolute -top-7 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-[10px] font-mono text-white opacity-0 group-hover:opacity-100 transition-opacity">
        00:06
      </span>
    </div>
    <!-- Future Audio Bars (Muted Gray) -->
    <div class="w-1 rounded-full bg-zinc-700/60 h-7 group-hover:bg-zinc-600"></div>
    <div class="w-1 rounded-full bg-zinc-700/60 h-4 group-hover:bg-zinc-600"></div>
    <div class="w-1 rounded-full bg-zinc-700/60 h-8 group-hover:bg-zinc-600"></div>
    <div class="w-1 rounded-full bg-zinc-700/60 h-5 group-hover:bg-zinc-600"></div>
    <div class="w-1 rounded-full bg-zinc-700/60 h-3 group-hover:bg-zinc-600"></div>
  </div>
</div>
```

---

## 8. Synchronized Speaker Diarization / Media Transcript Stream

```html
<div class="space-y-4">
  <!-- Speaker Block 1 -->
  <div class="p-4 rounded-2xl bg-zinc-900/60 border border-zinc-800/80 space-y-2 hover:border-zinc-700/80 transition-colors">
    <div class="flex items-center justify-between">
      <div class="flex items-center space-x-2.5">
        <div class="w-6 h-6 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-mono text-[10px] font-bold flex items-center justify-center">
          S1
        </div>
        <span class="text-xs font-semibold text-zinc-200">DevOps Lead</span>
      </div>
      <!-- Click-to-Seek Timecode Badge -->
      <button class="px-2 py-0.5 rounded-full bg-zinc-800/80 hover:bg-zinc-700 text-[11px] font-mono tabular-nums text-zinc-400 hover:text-zinc-200 border border-zinc-700/50 transition-colors cursor-pointer">
        00:00
      </button>
    </div>
    
    <!-- Word-Synchronized Transcript Paragraph -->
    <p class="text-sm text-zinc-300 leading-relaxed">
      <span class="hover:bg-indigo-500/20 hover:text-white rounded px-0.5 transition-colors cursor-pointer">We</span>
      <span class="hover:bg-indigo-500/20 hover:text-white rounded px-0.5 transition-colors cursor-pointer">need</span>
      <span class="hover:bg-indigo-500/20 hover:text-white rounded px-0.5 transition-colors cursor-pointer">to</span>
      <span class="hover:bg-indigo-500/20 hover:text-white rounded px-0.5 transition-colors cursor-pointer">migrate</span>
      <span class="bg-indigo-500/30 text-indigo-200 font-medium rounded px-0.5">our</span>
      <span class="bg-indigo-500/30 text-indigo-200 font-medium rounded px-0.5">background</span>
      <span class="hover:bg-indigo-500/20 hover:text-white rounded px-0.5 transition-colors cursor-pointer">audio</span>
      <span class="hover:bg-indigo-500/20 hover:text-white rounded px-0.5 transition-colors cursor-pointer">worker</span>
      <span class="hover:bg-indigo-500/20 hover:text-white rounded px-0.5 transition-colors cursor-pointer">pool</span>
      <span class="hover:bg-indigo-500/20 hover:text-white rounded px-0.5 transition-colors cursor-pointer">to</span>
      <span class="hover:bg-indigo-500/20 hover:text-white rounded px-0.5 transition-colors cursor-pointer">Kubernetes.</span>
    </p>
  </div>
</div>
```

---

## 9. Compact Sticky Action Dock & Search Sidebar Header

```html
<div class="p-3 border-b border-zinc-800 bg-zinc-900/90 backdrop-blur-md flex items-center justify-between space-x-2">
  <!-- Search Input with Keyboard Badge -->
  <div class="relative flex-1">
    <i data-lucide="search" class="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2 stroke-[1.5]" aria-hidden="true"></i>
    <input 
      type="text" 
      placeholder="Filter notes..." 
      class="w-full pl-8 pr-10 py-1.5 rounded-lg bg-zinc-950/70 border border-zinc-800 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-400"
    />
    <kbd class="absolute right-2 top-1/2 -translate-y-1/2 px-1 py-0.2 rounded bg-zinc-800 border border-zinc-700 text-[9px] font-mono text-zinc-400">⌘K</kbd>
  </div>

  <!-- Compact 32px New Item Trigger -->
  <button 
    type="button" 
    class="px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white text-xs font-medium flex items-center space-x-1 transition-all cursor-pointer shrink-0"
    aria-label="Create note"
  >
    <i data-lucide="plus" class="w-3.5 h-3.5 stroke-[2]" aria-hidden="true"></i>
    <span class="hidden sm:inline">New</span>
  </button>
</div>
```

---

## 10. Standardized 3+1 Action Toolbar with Contextual Overflow Dropdown

```html
<div class="flex items-center space-x-2">
  <!-- Action 1: Primary Trigger -->
  <button class="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white text-xs font-medium flex items-center space-x-1.5 transition-all shadow-xs cursor-pointer">
    <i data-lucide="sparkles" class="w-3.5 h-3.5 stroke-[1.75]" aria-hidden="true"></i>
    <span>Generate Summary</span>
  </button>

  <!-- Action 2: Secondary Trigger -->
  <button class="px-3 py-1.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white border border-zinc-700/60 text-xs font-medium flex items-center space-x-1.5 transition-colors cursor-pointer">
    <i data-lucide="share-2" class="w-3.5 h-3.5 stroke-[1.5]" aria-hidden="true"></i>
    <span>Share</span>
  </button>

  <!-- Action 3+1: Contextual Overflow Menu Trigger -->
  <div class="relative">
    <button 
      type="button" 
      aria-label="More actions" 
      class="p-1.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-white border border-zinc-700/60 transition-colors cursor-pointer"
    >
      <i data-lucide="more-horizontal" class="w-4 h-4 stroke-[1.5]" aria-hidden="true"></i>
    </button>
  </div>
</div>
```

