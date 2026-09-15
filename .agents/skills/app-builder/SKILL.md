---
name: app-builder
description: Fullstack application blueprint and craftsman skill for designing, coding, testing, and delivering interactive web applications with immediate live preview in Cyclode.
---

# Fullstack App Craftsman Blueprint & Guidelines

Use this skill whenever asked to build, scaffold, prototype, or code complete web applications, interactive dashboards, e-commerce stores, productivity tools, or fullstack systems in Cyclode workspaces.

---

## 1. Core Operating Invariants

1. **Zero-Dependency Instant Preview Invariant**:
   - **ALWAYS** create a root `index.html` (or `public/index.html`) as the primary visual entry point.
   - **NEVER** run long-running, fragile package manager installs (e.g. `apt-get install nodejs npm`) in sandboxes when standalone CDN/ESM can deliver a fully functional, beautiful app instantly.
   - Load modern UI dependencies directly over CDN:
     - **Tailwind CSS**: `<script src="https://cdn.tailwindcss.com"></script>`
     - **React 18 & Babel**:
       ```html
       <script src="https://unpkg.com/react@18/umd/react.production.min.js" crossorigin></script>
       <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js" crossorigin></script>
       <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
       ```
     - **Lucide Icons**: `<script src="https://unpkg.com/lucide@latest"></script>`
     - **Chart.js (if dashboards are requested)**: `<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>`

2. **Dual-Surface & Multi-Tab Architecture**:
   - When apps involve multiple user roles (e.g. Customer Storefront + Merchant Admin, User Dashboard + Settings, Feed + Detail), structure clean client-side tabbed state navigation within the SPA.
   - Provide pre-seeded, realistic datasets (e.g. products with images, categories, orders, analytics metrics, user profiles) stored in a `localStorage` or memory store so the preview is 100% interactive on first render.

3. **Companion Async Backend API**:
   - When server persistence, background tasks, or database operations are needed, build a clean Python backend using **FastAPI** + **SQLAlchemy 2.0 async** + **SQLite/aiosqlite**.
   - Structure backend code in `backend/app/`:
     - `backend/app/main.py`: FastAPI app instance with CORS enabled (`allow_origins=["*"]`).
     - `backend/app/models.py`: SQLAlchemy database models.
     - `backend/app/schemas.py`: Pydantic request/response schemas.
     - `backend/app/database.py`: Async engine and session factory.
     - `backend/app/routes/`: Modular APIRouters.
     - `backend/app/seed.py`: Initial sample data seeder.
   - Write automated `pytest` test suites in `backend/tests/` to verify REST endpoints.

---

## 2. Standard Single-File SPA Template Pattern (`index.html`)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Application Title</title>
  <!-- Tailwind CSS -->
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            brand: { 50: '#eef2ff', 500: '#6366f1', 600: '#4f46e5', 700: '#4338ca' },
            surface: '#1e1e2e',
            darker: '#181825',
          }
        }
      }
    };
  </script>
  <!-- React 18 & Babel Standalone -->
  <script src="https://unpkg.com/react@18/umd/react.production.min.js" crossorigin></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js" crossorigin></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <!-- Lucide Icons -->
  <script src="https://unpkg.com/lucide@latest"></script>
</head>
<body class="bg-slate-900 text-slate-100 min-h-screen font-sans antialiased">
  <div id="root"></div>

  <script type="text/babel">
    const { useState, useEffect, useMemo, useCallback } = React;

    // --- Mock Storage & Seed Data Layer ---
    const STORAGE_KEY = 'cyclode_app_db_v1';
    const INITIAL_DATA = {
      items: [
        { id: '1', title: 'Sample Item 1', category: 'General', status: 'ACTIVE', created_at: new Date().toISOString() },
      ],
      settings: { theme: 'dark', notifications: true }
    };

    function loadState() {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        return saved ? JSON.parse(saved) : INITIAL_DATA;
      } catch (e) {
        return INITIAL_DATA;
      }
    }

    function saveState(data) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch (e) {}
    }

    // --- Main Application Component ---
    function App() {
      const [data, setData] = useState(loadState);
      const [activeTab, setActiveTab] = useState('storefront'); // 'storefront' | 'admin'

      useEffect(() => {
        saveState(data);
        if (window.lucide) window.lucide.createIcons();
      }, [data, activeTab]);

      return (
        <div className="flex flex-col min-h-screen">
          {/* Navigation Bar */}
          <header className="h-14 border-b border-slate-800 bg-slate-950/80 backdrop-blur px-4 flex items-center justify-between sticky top-0 z-20">
            <div className="flex items-center space-x-3">
              <span className="font-bold text-lg text-indigo-400">Cyclode App</span>
            </div>
            <div className="flex items-center space-x-1 bg-slate-900 p-1 rounded-lg border border-slate-800 text-xs">
              <button
                onClick={() => setActiveTab('storefront')}
                className={`px-3 py-1 rounded-md font-medium transition-all ${
                  activeTab === 'storefront' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Storefront
              </button>
              <button
                onClick={() => setActiveTab('admin')}
                className={`px-3 py-1 rounded-md font-medium transition-all ${
                  activeTab === 'admin' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Admin Portal
              </button>
            </div>
          </header>

          {/* Body */}
          <main className="flex-1 p-6 max-w-7xl mx-auto w-full">
            {activeTab === 'storefront' ? <div>Storefront Content</div> : <div>Admin Content</div>}
          </main>
        </div>
      );
    }

    ReactDOM.createRoot(document.getElementById('root')).render(<App />);
  </script>
</body>
</html>
```

---

## 3. Mandatory 5-Stage Execution Sequence

1. **Stage 1: System Design & Schema**:
   - Define entity schemas, state management, and endpoint contracts.
2. **Stage 2: Instant Frontend Entry Point (`index.html`)**:
   - Create `index.html` with Tailwind + React CDN, responsive layouts, multi-surface views, and realistic seed data.
3. **Stage 3: Companion Async Backend API**:
   - Create FastAPI service in `backend/app/` with SQLite and CORS configured.
4. **Stage 4: Automated Testing & Verification**:
   - Write tests in `backend/tests/` and run `pytest`.
   - Verify `index.html` exists and contains valid markup.
5. **Stage 5: Live Preview Confirmation**:
   - Confirm preview readiness and deliver analytical summary with clickable links to generated artifacts.
