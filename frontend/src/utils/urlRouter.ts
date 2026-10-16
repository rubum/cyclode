import type { ViewType } from "../stores/useLayoutStore";

const TOP_LEVEL_VIEWS: ReadonlySet<ViewType> = new Set<ViewType>([
  "fleet",
  "events",
  "automations",
  "policies",
  "integrations",
  "repositories",
  "simulator",
]);

export interface ParsedRoute {
  view: ViewType;
  sessionId: string | null;
  isExplicitNewSession: boolean;
}

/**
 * Parses a URL pathname into the application's view and session state.
 * - `/session/{id}` -> `{ view: 'chat', sessionId: id, isExplicitNewSession: false }`
 * - `/new` -> `{ view: 'chat', sessionId: null, isExplicitNewSession: true }`
 * - `/fleet`, `/events`, `/automations`, `/policies`, `/integrations`, `/repositories`, `/simulator`
 *   -> `{ view: <view>, sessionId: null, isExplicitNewSession: false }`
 * - `/` (or fallback) -> `{ view: 'chat', sessionId: null, isExplicitNewSession: false }`
 */
export function parseCurrentRoute(pathname?: string): ParsedRoute {
  const rawPath =
    pathname ?? (typeof window !== "undefined" ? window.location.pathname : "/");
  const normalized = rawPath.replace(/\/+$/, "") || "/";

  const sessionMatch = normalized.match(/^\/session\/([^/?#]+)$/);
  if (sessionMatch && sessionMatch[1]) {
    try {
      const decoded = decodeURIComponent(sessionMatch[1]).trim();
      if (decoded && !decoded.startsWith("temp-")) {
        return {
          view: "chat",
          sessionId: decoded,
          isExplicitNewSession: false,
        };
      }
    } catch {
      // Ignore malformed URI components and fall through
    }
  }

  if (normalized === "/new") {
    return {
      view: "chat",
      sessionId: null,
      isExplicitNewSession: true,
    };
  }

  const trimmedSegment = normalized.slice(1) as ViewType;
  if (TOP_LEVEL_VIEWS.has(trimmedSegment)) {
    return {
      view: trimmedSegment,
      sessionId: null,
      isExplicitNewSession: false,
    };
  }

  return {
    view: "chat",
    sessionId: null,
    isExplicitNewSession: false,
  };
}

export function buildSessionPath(sessionId: string | null): string {
  if (!sessionId || sessionId.startsWith("temp-")) {
    return "/";
  }
  return `/session/${encodeURIComponent(sessionId)}`;
}

export function buildViewPath(view: ViewType, activeTaskId: string | null): string {
  if (view === "chat") {
    return buildSessionPath(activeTaskId);
  }
  return `/${view}`;
}

export function syncBrowserUrl(
  targetPath: string,
  options?: { replace?: boolean }
): void {
  if (typeof window === "undefined") return;
  const currentPath = window.location.pathname;
  if (currentPath === targetPath) return;
  try {
    if (options?.replace) {
      window.history.replaceState(null, "", targetPath);
    } else {
      window.history.pushState(null, "", targetPath);
    }
  } catch {
    // Ignore history API errors in restricted environments
  }
}
