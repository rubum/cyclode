import { useState, useCallback } from "react";
import { LayoutPreset, AuxTabType } from "../types";
import { parseCurrentRoute } from "../utils/urlRouter";

export type { AuxTabType };

export type ViewType =
  | "chat"
  | "fleet"
  | "events"
  | "automations"
  | "policies"
  | "integrations"
  | "repositories"
  | "simulator";

export interface LayoutState {
  activeView: ViewType;
  isSidebarCollapsed: boolean;
  currentPreset: LayoutPreset;
  activeAuxTab: AuxTabType;
  isSandboxModalOpen: boolean;
  setActiveView: (view: ViewType) => void;
  setIsSidebarCollapsed: (collapsed: boolean | ((prev: boolean) => boolean)) => void;
  setCurrentPreset: (preset: LayoutPreset) => void;
  setActiveAuxTab: (tab: AuxTabType) => void;
  setIsSandboxModalOpen: (open: boolean) => void;
}

export function useLayoutStore(): LayoutState {
  const [activeView, setActiveView] = useState<ViewType>(() => parseCurrentRoute().view);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);
  const [currentPreset, setCurrentPresetState] = useState<LayoutPreset>(() => {
    try {
      const saved = localStorage.getItem("cyclode_layout_preset");
      if (saved && ["split", "preview", "wide", "fullscreen", "standard"].includes(saved)) {
        return (saved === "standard" ? "split" : saved) as LayoutPreset;
      }
    } catch {
      // ignore
    }
    return "split";
  });
  const [activeAuxTab, setActiveAuxTab] = useState<AuxTabType>("intelligence");
  const [isSandboxModalOpen, setIsSandboxModalOpen] = useState<boolean>(false);

  const setCurrentPreset = useCallback((preset: LayoutPreset) => {
    setCurrentPresetState(preset);
    try {
      localStorage.setItem("cyclode_layout_preset", preset);
    } catch {
      // ignore
    }
  }, []);

  return {
    activeView,
    isSidebarCollapsed,
    currentPreset,
    activeAuxTab,
    isSandboxModalOpen,
    setActiveView,
    setIsSidebarCollapsed,
    setCurrentPreset,
    setActiveAuxTab,
    setIsSandboxModalOpen,
  };
}
