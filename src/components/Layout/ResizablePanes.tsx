import React, { useState, useRef, useEffect } from 'react';
import { LayoutPreset } from '../../types';

interface ResizablePanesProps {
  sidebar: React.ReactNode;
  center: React.ReactNode;
  auxiliary: React.ReactNode;
  activeView: string;
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  currentPreset?: LayoutPreset;
  onSetPreset?: (preset: LayoutPreset) => void;
}

export const ResizablePanes: React.FC<ResizablePanesProps> = ({
  sidebar,
  center,
  auxiliary,
  activeView,
  isSidebarCollapsed: controlledSidebarCollapsed,
  onToggleSidebar: controlledToggleSidebar,
  currentPreset: controlledPreset,
  onSetPreset: controlledSetPreset,
}) => {
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('cyclode_layout_sidebar_w');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= 180 && parsed <= 450) return parsed;
      }
    } catch {
      // ignore
    }
    return 240;
  });

  const [internalSidebarCollapsed, setInternalSidebarCollapsed] = useState<boolean>(false);
  const [auxiliaryWidthPercent, setAuxiliaryWidthPercent] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('cyclode_layout_aux_pct');
      if (saved) {
        const parsed = parseFloat(saved);
        if (!isNaN(parsed) && parsed >= 15 && parsed <= 75) return parsed;
      }
    } catch {
      // ignore
    }
    return 48;
  });
  const [isAuxCollapsed, setIsAuxCollapsed] = useState<boolean>(false);

  const isSidebarCollapsed = controlledSidebarCollapsed !== undefined ? controlledSidebarCollapsed : internalSidebarCollapsed;
  const toggleSidebar = controlledToggleSidebar || (() => setInternalSidebarCollapsed(!internalSidebarCollapsed));

  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingSidebar = useRef<boolean>(false);
  const isDraggingAux = useRef<boolean>(false);
  const sidebarWidthRef = useRef<number>(sidebarWidth);
  const auxWidthPercentRef = useRef<number>(auxiliaryWidthPercent);

  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth;
  }, [sidebarWidth]);

  useEffect(() => {
    auxWidthPercentRef.current = auxiliaryWidthPercent;
  }, [auxiliaryWidthPercent]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingSidebar.current) {
        const newWidth = Math.max(180, Math.min(450, e.clientX));
        setSidebarWidth(newWidth);
        sidebarWidthRef.current = newWidth;
      }
      if (isDraggingAux.current && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const distanceFromRight = rect.right - e.clientX;
        const newPercent = Math.max(15, Math.min(75, (distanceFromRight / rect.width) * 100));
        setAuxiliaryWidthPercent(newPercent);
        auxWidthPercentRef.current = newPercent;
      }
    };

    const handleMouseUp = () => {
      if (isDraggingSidebar.current) {
        try {
          localStorage.setItem('cyclode_layout_sidebar_w', String(sidebarWidthRef.current));
        } catch {
          // ignore
        }
      }
      if (isDraggingAux.current) {
        try {
          localStorage.setItem('cyclode_layout_aux_pct', String(auxWidthPercentRef.current));
        } catch {
          // ignore
        }
      }
      isDraggingSidebar.current = false;
      isDraggingAux.current = false;
      document.body.style.cursor = 'default';
      document.body.style.userSelect = 'auto';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  useEffect(() => {
    if (!controlledPreset) return;
    if (controlledPreset === 'split' || controlledPreset === 'standard') {
      setIsAuxCollapsed(false);
      setAuxiliaryWidthPercent(48);
    } else if (controlledPreset === 'preview') {
      setIsAuxCollapsed(false);
      setAuxiliaryWidthPercent(60);
    } else if (controlledPreset === 'wide') {
      setIsAuxCollapsed(false);
      setAuxiliaryWidthPercent(25);
    } else if (controlledPreset === 'fullscreen') {
      setIsAuxCollapsed(true);
    }
  }, [controlledPreset]);

  const setPreset = (preset: LayoutPreset) => {
    if (controlledSetPreset) {
      controlledSetPreset(preset);
    }
    if (preset === 'split' || preset === 'standard') {
      if (controlledToggleSidebar && isSidebarCollapsed) controlledToggleSidebar();
      setInternalSidebarCollapsed(false);
      setIsAuxCollapsed(false);
      setAuxiliaryWidthPercent(48);
    } else if (preset === 'preview') {
      if (controlledToggleSidebar && !isSidebarCollapsed) controlledToggleSidebar();
      setInternalSidebarCollapsed(true);
      setIsAuxCollapsed(false);
      setAuxiliaryWidthPercent(60);
    } else if (preset === 'wide') {
      if (controlledToggleSidebar && !isSidebarCollapsed) controlledToggleSidebar();
      setInternalSidebarCollapsed(true);
      setIsAuxCollapsed(false);
      setAuxiliaryWidthPercent(25);
    } else if (preset === 'fullscreen') {
      if (controlledToggleSidebar && !isSidebarCollapsed) controlledToggleSidebar();
      setInternalSidebarCollapsed(true);
      setIsAuxCollapsed(true);
    }
  };

  const computedPreset: LayoutPreset = controlledPreset || (isAuxCollapsed
    ? 'fullscreen'
    : auxiliaryWidthPercent >= 55
    ? 'preview'
    : auxiliaryWidthPercent <= 30
    ? 'wide'
    : 'split');

  return (
    <div ref={containerRef} className="flex h-full w-full overflow-hidden bg-onedark-bg">
      {/* Left Sidebar */}
      <div
        style={{ width: isSidebarCollapsed ? '0px' : `${sidebarWidth}px` }}
        className={`relative flex-shrink-0 transition-all duration-150 overflow-hidden border-r border-onedark-borderSubtle bg-onedark-darker ${
          isSidebarCollapsed ? 'w-0' : ''
        }`}
      >
        <div style={{ width: `${sidebarWidth}px` }} className="h-full">
          {sidebar}
        </div>
      </div>

      {/* Sidebar Resize Gutter */}
      {!isSidebarCollapsed && (
        <div
          onMouseDown={() => {
            isDraggingSidebar.current = true;
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
          }}
          className="w-1 hover:w-1.5 hover:bg-onedark-accent/60 cursor-col-resize transition-colors flex-shrink-0 z-10 bg-onedark-borderSubtle"
        />
      )}

      {/* Center Main Workstation */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden relative bg-onedark-bg">
        <div className="flex-1 h-full min-h-0 flex flex-col overflow-hidden">
          {React.isValidElement(center)
            ? React.cloneElement(center as React.ReactElement<any>, {
                isSidebarCollapsed,
                onToggleSidebar: toggleSidebar,
                currentPreset: computedPreset,
                onSetPreset: setPreset,
              })
            : center}
        </div>
      </div>

      {/* Auxiliary Pane */}
      {activeView === 'chat' && !isAuxCollapsed && (
        <>
          <div
            onMouseDown={() => {
              isDraggingAux.current = true;
              document.body.style.cursor = 'col-resize';
              document.body.style.userSelect = 'none';
            }}
            className="w-1 hover:w-1.5 hover:bg-onedark-accent/60 cursor-col-resize transition-colors flex-shrink-0 z-10 bg-onedark-borderSubtle"
          />

          <div
            style={{ width: `${auxiliaryWidthPercent}%` }}
            className="flex-shrink-0 h-full border-l border-onedark-borderSubtle bg-onedark-darker overflow-hidden flex flex-col"
          >
            {auxiliary}
          </div>
        </>
      )}
    </div>
  );
};
