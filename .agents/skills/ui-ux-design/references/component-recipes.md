# UI/UX Component Recipes

Production-ready, highly polished component patterns for React/Vue/HTML single-page applications.

---

## 1. Metric Stat Card with Trend Badge

```jsx
function MetricCard({ title, value, change, isPositive, icon: Icon }) {
  return (
    <div className="p-5 rounded-2xl bg-zinc-900/80 border border-zinc-800/80 hover:border-zinc-700/80 transition-all duration-200 shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-400">{title}</span>
        {Icon && (
          <div className="p-2 rounded-xl bg-zinc-800/60 border border-zinc-700/50 text-zinc-300">
            <Icon className="w-4 h-4" />
          </div>
        )}
      </div>
      <div className="flex items-baseline justify-between">
        <div className="text-2xl font-bold tracking-tight text-white">{value}</div>
        <div className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${
          isPositive ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
        }`}>
          <span>{isPositive ? '↑' : '↓'}</span>
          <span>{change}</span>
        </div>
      </div>
    </div>
  );
}
```

---

## 2. Interactive Modal with Backdrop Blur & ESC Listener

```jsx
function Modal({ isOpen, onClose, title, children }) {
  React.useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'auto';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fadeIn">
      <div 
        className="w-full max-w-lg rounded-2xl bg-zinc-900 border border-zinc-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/50">
          <h3 className="text-sm font-semibold text-white tracking-tight">{title}</h3>
          <button 
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>
        <div className="p-5 overflow-y-auto space-y-4">
          {children}
        </div>
      </div>
    </div>
  );
}
```

---

## 3. Shimmer Loading Skeleton Screen

```jsx
function SkeletonCard() {
  return (
    <div className="p-5 rounded-2xl bg-zinc-900/70 border border-zinc-800/60 space-y-3.5 animate-pulse">
      <div className="flex items-center space-x-3">
        <div className="w-9 h-9 rounded-full bg-zinc-800"></div>
        <div className="space-y-1.5 flex-1">
          <div className="h-3.5 w-1/3 bg-zinc-800 rounded"></div>
          <div className="h-2.5 w-1/5 bg-zinc-800/60 rounded"></div>
        </div>
      </div>
      <div className="space-y-2">
        <div className="h-3 w-full bg-zinc-800/80 rounded"></div>
        <div className="h-3 w-4/5 bg-zinc-800/60 rounded"></div>
      </div>
    </div>
  );
}
```
