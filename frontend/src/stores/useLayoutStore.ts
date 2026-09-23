import { useState, useCallback, useEffect } from "react";
import { LayoutPreset } from "../types";

export type ViewType =
  | "chat"
  | "fleet"
  | "events"
  | "automations"
  | "policies"
  | "integrations"
  | "repositories"
  | "simulator";

export type AuxTabType =
  | "files"
  | "prs"
  | "activity"
  | "subagents"
  | "event"
  | "docs"
  | "preview"
  | "changes";

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
  const [activeView, setActiveView] = useState<ViewType>("chat");
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
  const [activeAuxTab, setActiveAuxTab] = useState<AuxTabType>("activity");
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
