import { useState, useCallback, useEffect, useRef } from 'react';

export interface NavigationPoint {
  filePath: string;
  line: number;
  symbol?: string;
  timestamp: number;
}

export interface UseNavigationHistoryResult {
  history: NavigationPoint[];
  currentIndex: number;
  pushPoint: (point: { filePath: string; line?: number | null; symbol?: string }) => void;
  goBack: () => NavigationPoint | null;
  goForward: () => NavigationPoint | null;
  canGoBack: boolean;
  canGoForward: boolean;
  previousPoint: NavigationPoint | null;
  nextPoint: NavigationPoint | null;
  clearHistory: () => void;
}

export function useNavigationHistory(
  onNavigate?: (point: NavigationPoint) => void
): UseNavigationHistoryResult {
  const [history, setHistory] = useState<NavigationPoint[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(-1);

  const historyRef = useRef<NavigationPoint[]>(history);
  historyRef.current = history;

  const currentIndexRef = useRef<number>(currentIndex);
  currentIndexRef.current = currentIndex;

  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;

  const pushPoint = useCallback((point: { filePath: string; line?: number | null; symbol?: string }) => {
    const targetLine = point.line || 1;
    const newPoint: NavigationPoint = {
      filePath: point.filePath,
      line: targetLine,
      symbol: point.symbol,
      timestamp: Date.now(),
    };

    setHistory((prev) => {
      const curIdx = currentIndexRef.current;
      const currentPoint = curIdx >= 0 && curIdx < prev.length ? prev[curIdx] : null;

      // Avoid consecutive duplicate jumps to same file and very close line
      if (
        currentPoint &&
        currentPoint.filePath === newPoint.filePath &&
        Math.abs(currentPoint.line - newPoint.line) < 5 &&
        (!newPoint.symbol || newPoint.symbol === currentPoint.symbol)
      ) {
        return prev;
      }

      const truncated = curIdx >= 0 ? prev.slice(0, curIdx + 1) : [];
      const updated = [...truncated, newPoint];
      // Limit history to 50 items
      const limited = updated.length > 50 ? updated.slice(updated.length - 50) : updated;
      setCurrentIndex(limited.length - 1);
      return limited;
    });
  }, []);

  const goBack = useCallback((): NavigationPoint | null => {
    const curIdx = currentIndexRef.current;
    if (curIdx > 0) {
      const newIdx = curIdx - 1;
      setCurrentIndex(newIdx);
      const targetPoint = historyRef.current[newIdx];
      if (targetPoint && onNavigateRef.current) {
        onNavigateRef.current(targetPoint);
      }
      return targetPoint;
    }
    return null;
  }, []);

  const goForward = useCallback((): NavigationPoint | null => {
    const curIdx = currentIndexRef.current;
    if (curIdx >= 0 && curIdx < historyRef.current.length - 1) {
      const newIdx = curIdx + 1;
      setCurrentIndex(newIdx);
      const targetPoint = historyRef.current[newIdx];
      if (targetPoint && onNavigateRef.current) {
        onNavigateRef.current(targetPoint);
      }
      return targetPoint;
    }
    return null;
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    setCurrentIndex(-1);
  }, []);

  const canGoBack = currentIndex > 0;
  const canGoForward = currentIndex >= 0 && currentIndex < history.length - 1;
  const previousPoint = canGoBack ? history[currentIndex - 1] : null;
  const nextPoint = canGoForward ? history[currentIndex + 1] : null;

  // Keyboard shortcut listener: Cmd+[ / Cmd+] or Alt+Left / Alt+Right
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when inside text input or textarea
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      if ((e.metaKey && e.key === '[') || (e.altKey && e.key === 'ArrowLeft')) {
        e.preventDefault();
        goBack();
      } else if ((e.metaKey && e.key === ']') || (e.altKey && e.key === 'ArrowRight')) {
        e.preventDefault();
        goForward();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goBack, goForward]);

  return {
    history,
    currentIndex,
    pushPoint,
    goBack,
    goForward,
    canGoBack,
    canGoForward,
    previousPoint,
    nextPoint,
    clearHistory,
  };
}
