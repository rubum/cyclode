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

## 7. Interactive Audio Waveform Scrubber with Bookmarks

```html
<div class="p-5 rounded-2xl bg-zinc-900 border border-zinc-800 space-y-4 shadow-sm">
  <!-- Header / Now Playing -->
  <div class="flex items-center justify-between">
    <div class="flex items-center space-x-3">
      <button 
        type="button" 
        id="play-btn"
        class="w-10 h-10 rounded-full bg-orange-600 hover:bg-orange-500 active:scale-95 text-white flex items-center justify-center transition-all shadow-md shadow-orange-600/20 cursor-pointer"
        aria-label="Play audio"
      >
        <i data-lucide="play" class="w-4 h-4 fill-current ml-0.5" aria-hidden="true"></i>
      </button>
      <div>
        <div class="text-sm font-semibold text-zinc-100 tracking-tight">Q3 Architecture Review</div>
        <div class="text-xs text-zinc-400 font-mono tabular-nums">00:04 <span class="text-zinc-600">/</span> 00:19</div>
      </div>
    </div>

    <!-- Speed Multiplier -->
    <div class="flex items-center space-x-2">
      <button class="px-2 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 text-xs font-mono text-zinc-300 transition-colors">1.0x</button>
      <button class="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors" aria-label="More options">
        <i data-lucide="more-horizontal" class="w-4 h-4 stroke-[1.5]"></i>
      </button>
    </div>
  </div>

  <!-- Interactive Waveform Canvas Container -->
  <div class="relative w-full h-16 bg-zinc-950/60 rounded-xl border border-zinc-800/80 overflow-hidden cursor-pointer group">
    <!-- Visual Waveform Canvas -->
    <canvas id="waveform-canvas" class="w-full h-full block"></canvas>
    
    <!-- Hover Playhead Line -->
    <div id="hover-line" class="absolute top-0 bottom-0 w-px bg-white/40 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity"></div>
  </div>

  <!-- Bookmark Chips Pinned to Audio Timecodes -->
  <div class="flex items-center space-x-2 overflow-x-auto pb-1 text-xs">
    <button class="px-2.5 py-1 rounded-lg bg-zinc-800/90 hover:bg-zinc-700/90 text-zinc-300 border border-zinc-700/50 flex items-center space-x-1.5 shrink-0 transition-colors cursor-pointer">
      <span class="font-mono text-[10px] text-orange-400 tabular-nums">00:00</span>
      <span>Problem Scope</span>
    </button>
    <button class="px-2.5 py-1 rounded-lg bg-zinc-800/90 hover:bg-zinc-700/90 text-zinc-300 border border-zinc-700/50 flex items-center space-x-1.5 shrink-0 transition-colors cursor-pointer">
      <span class="font-mono text-[10px] text-orange-400 tabular-nums">00:06</span>
      <span>Kubernetes Ingestion</span>
    </button>
    <button class="px-2.5 py-1 rounded-lg bg-zinc-800/90 hover:bg-zinc-700/90 text-zinc-300 border border-zinc-700/50 flex items-center space-x-1.5 shrink-0 transition-colors cursor-pointer">
      <span class="font-mono text-[10px] text-orange-400 tabular-nums">00:12</span>
      <span>Failover Staging</span>
    </button>
  </div>
</div>
```

---

## 8. Synchronized Diarization Transcript with Click-to-Seek

```html
<div class="p-5 rounded-2xl bg-zinc-900 border border-zinc-800 space-y-4">
  <div class="flex items-center justify-between border-b border-zinc-800/80 pb-3">
    <div class="flex items-center space-x-2">
      <i data-lucide="file-text" class="w-4 h-4 text-zinc-400 stroke-[1.5]"></i>
      <span class="text-xs font-semibold uppercase tracking-wider text-zinc-300 font-mono">Synchronized Transcript</span>
    </div>
    <span class="text-xs font-mono text-zinc-500 tabular-nums">54 words · 175 WPM</span>
  </div>

  <!-- Diarized Paragraph Block -->
  <div class="space-y-3 text-sm leading-relaxed">
    <div class="space-y-1.5">
      <div class="flex items-center space-x-2">
        <span class="text-xs font-semibold text-orange-400">Sarah Chen</span>
        <span class="text-[11px] font-mono text-zinc-500 tabular-nums">00:00</span>
      </div>
      <p class="text-zinc-300 cursor-pointer select-text">
        <span class="hover:bg-zinc-800 hover:text-white px-0.5 rounded transition-colors text-white font-medium bg-orange-500/20" data-seek="0.0">We</span>
        <span class="hover:bg-zinc-800 hover:text-white px-0.5 rounded transition-colors" data-seek="0.4">need</span>
        <span class="hover:bg-zinc-800 hover:text-white px-0.5 rounded transition-colors" data-seek="0.8">to</span>
        <span class="hover:bg-zinc-800 hover:text-white px-0.5 rounded transition-colors" data-seek="1.1">migrate</span>
        <span class="hover:bg-zinc-800 hover:text-white px-0.5 rounded transition-colors" data-seek="1.6">our</span>
        <span class="hover:bg-zinc-800 hover:text-white px-0.5 rounded transition-colors" data-seek="2.0">background</span>
        <span class="hover:bg-zinc-800 hover:text-white px-0.5 rounded transition-colors" data-seek="2.6">worker</span>
        <span class="hover:bg-zinc-800 hover:text-white px-0.5 rounded transition-colors" data-seek="3.1">pool.</span>
      </p>
    </div>
  </div>
</div>
```

---

## 9. Compact Floating Recording Dock with Live VU Meter

```html
<div class="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 px-4 py-2.5 rounded-full bg-zinc-900/95 backdrop-blur-md border border-zinc-700/80 shadow-2xl flex items-center space-x-4">
  <!-- Record Trigger with Pulse Halo -->
  <button 
    type="button"
    class="w-8 h-8 rounded-full bg-rose-600 hover:bg-rose-500 active:scale-95 text-white flex items-center justify-center transition-all shadow-md shadow-rose-600/30 cursor-pointer shrink-0"
    aria-label="Start recording"
  >
    <div class="w-2.5 h-2.5 rounded-full bg-white animate-ping"></div>
  </button>

  <!-- Live Audio Level VU Meter -->
  <div class="flex items-center space-x-1 h-4">
    <div class="w-1 bg-rose-500 rounded-full h-2 animate-pulse"></div>
    <div class="w-1 bg-rose-500 rounded-full h-4 animate-pulse delay-75"></div>
    <div class="w-1 bg-rose-500 rounded-full h-3 animate-pulse delay-150"></div>
    <div class="w-1 bg-rose-500 rounded-full h-1 animate-pulse"></div>
  </div>

  <!-- Digital Timer -->
  <div class="text-xs font-mono font-medium text-zinc-100 tabular-nums">00:04.82</div>

  <!-- Divider -->
  <div class="w-px h-4 bg-zinc-700"></div>

  <!-- Stop / Finish Button -->
  <button class="text-xs font-medium text-zinc-300 hover:text-white transition-colors cursor-pointer">
    Save Note
  </button>
</div>

