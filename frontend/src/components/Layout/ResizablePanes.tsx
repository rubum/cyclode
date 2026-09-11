import React, { useState, useRef, useEffect } from 'react';

interface ResizablePanesProps {
  sidebar: React.ReactNode;
  center: React.ReactNode;
  auxiliary: React.ReactNode;
  activeView: string;
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  currentPreset?: 'standard' | 'wide' | 'fullscreen';
  onSetPreset?: (preset: 'standard' | 'wide' | 'fullscreen') => void;
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
  const [sidebarWidth, setSidebarWidth] = useState<number>(260);
  const [internalSidebarCollapsed, setInternalSidebarCollapsed] = useState<boolean>(false);
  const [auxiliaryWidthPercent, setAuxiliaryWidthPercent] = useState<number>(35);
  const [isAuxCollapsed, setIsAuxCollapsed] = useState<boolean>(false);

  const isSidebarCollapsed = controlledSidebarCollapsed !== undefined ? controlledSidebarCollapsed : internalSidebarCollapsed;
  const toggleSidebar = controlledToggleSidebar || (() => setInternalSidebarCollapsed(!internalSidebarCollapsed));

  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingSidebar = useRef<boolean>(false);
  const isDraggingAux = useRef<boolean>(false);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingSidebar.current) {
        const newWidth = Math.max(180, Math.min(450, e.clientX));
        setSidebarWidth(newWidth);
      }
      if (isDraggingAux.current && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const distanceFromRight = rect.right - e.clientX;
        const newPercent = Math.max(15, Math.min(65, (distanceFromRight / rect.width) * 100));
        setAuxiliaryWidthPercent(newPercent);
      }
    };

    const handleMouseUp = () => {
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
    if (controlledPreset === 'standard') {
      setIsAuxCollapsed(false);
      setAuxiliaryWidthPercent(35);
    } else if (controlledPreset === 'wide') {
      setIsAuxCollapsed(false);
      setAuxiliaryWidthPercent(25);
    } else if (controlledPreset === 'fullscreen') {
      setIsAuxCollapsed(true);
    }
  }, [controlledPreset]);

  const setPreset = (preset: 'standard' | 'wide' | 'fullscreen') => {
    if (controlledSetPreset) {
      controlledSetPreset(preset);
    }
    if (preset === 'standard') {
      if (controlledToggleSidebar && isSidebarCollapsed) controlledToggleSidebar();
      setInternalSidebarCollapsed(false);
      setIsAuxCollapsed(false);
      setAuxiliaryWidthPercent(35);
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

  const computedPreset = controlledPreset || (isAuxCollapsed
    ? 'fullscreen'
    : auxiliaryWidthPercent <= 25
    ? 'wide'
    : 'standard');

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
        <div className="flex-1 overflow-hidden">
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
