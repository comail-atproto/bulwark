"use client";

import { create } from "zustand";

export type ActiveView = "sidebar" | "list" | "viewer";

// Column width constraints (in pixels)
const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 400;
const SIDEBAR_DEFAULT = 256;
const EMAIL_LIST_MIN = 240;
const EMAIL_LIST_MAX = 600;
const EMAIL_LIST_DEFAULT = 384;
// Email list height (in pixels) for horizontal "Reading Pane at Bottom" layout
const EMAIL_LIST_HEIGHT_MIN = 160;
const EMAIL_LIST_HEIGHT_MAX = 800;
const EMAIL_LIST_HEIGHT_DEFAULT = 320;

interface UIState {
  // Mobile view state
  activeView: ActiveView;
  sidebarOpen: boolean;

  // Tablet list visibility (auto-hide when email selected)
  tabletListVisible: boolean;

  // Device detection (hydrated client-side)
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;

  // Resizable column widths (desktop only)
  sidebarWidth: number;
  emailListWidth: number;
  emailListHeight: number;

  // Sidebar collapsed state (desktop)
  sidebarCollapsed: boolean;

  // Actions
  setActiveView: (view: ActiveView) => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setTabletListVisible: (visible: boolean) => void;
  setDeviceType: (isMobile: boolean, isTablet: boolean, isDesktop: boolean) => void;
  setSidebarWidth: (width: number) => void;
  setEmailListWidth: (width: number) => void;
  setEmailListHeight: (height: number) => void;
  resetSidebarWidth: () => void;
  resetEmailListWidth: () => void;
  resetEmailListHeight: () => void;
  persistColumnWidths: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebarCollapsed: () => void;

  // Navigation helpers
  showEmailList: () => void;
  showEmailViewer: () => void;
  goBack: () => void;
}

// Column widths are hydrated from localStorage by the page component on mount

export const useUIStore = create<UIState>((set, get) => ({
  // Initial state (SSR-safe defaults)
  activeView: "list",
  sidebarOpen: false,
  tabletListVisible: true,
  isMobile: false,
  isTablet: false,
  isDesktop: true,
  sidebarWidth: SIDEBAR_DEFAULT,
  emailListWidth: EMAIL_LIST_DEFAULT,
  emailListHeight: EMAIL_LIST_HEIGHT_DEFAULT,
  sidebarCollapsed: false,

  // Actions
  setActiveView: (view) => set({ activeView: view }),

  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

  setTabletListVisible: (visible) => set({ tabletListVisible: visible }),

  setDeviceType: (isMobile, isTablet, isDesktop) =>
    set({ isMobile, isTablet, isDesktop }),

  setSidebarWidth: (width) =>
    set({ sidebarWidth: Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width)) }),

  setEmailListWidth: (width) =>
    set({ emailListWidth: Math.min(EMAIL_LIST_MAX, Math.max(EMAIL_LIST_MIN, width)) }),

  setEmailListHeight: (height) =>
    set({ emailListHeight: Math.min(EMAIL_LIST_HEIGHT_MAX, Math.max(EMAIL_LIST_HEIGHT_MIN, height)) }),

  resetSidebarWidth: () => {
    set({ sidebarWidth: SIDEBAR_DEFAULT });
    const { emailListWidth, emailListHeight } = get();
    try {
      localStorage.setItem("column-widths", JSON.stringify({ sidebarWidth: SIDEBAR_DEFAULT, emailListWidth, emailListHeight }));
    } catch { /* localStorage may be unavailable */ }
  },

  resetEmailListWidth: () => {
    set({ emailListWidth: EMAIL_LIST_DEFAULT });
    const { sidebarWidth, emailListHeight } = get();
    try {
      localStorage.setItem("column-widths", JSON.stringify({ sidebarWidth, emailListWidth: EMAIL_LIST_DEFAULT, emailListHeight }));
    } catch { /* localStorage may be unavailable */ }
  },

  resetEmailListHeight: () => {
    set({ emailListHeight: EMAIL_LIST_HEIGHT_DEFAULT });
    const { sidebarWidth, emailListWidth } = get();
    try {
      localStorage.setItem("column-widths", JSON.stringify({ sidebarWidth, emailListWidth, emailListHeight: EMAIL_LIST_HEIGHT_DEFAULT }));
    } catch { /* localStorage may be unavailable */ }
  },

  persistColumnWidths: () => {
    const { sidebarWidth, emailListWidth, emailListHeight } = get();
    try {
      localStorage.setItem("column-widths", JSON.stringify({ sidebarWidth, emailListWidth, emailListHeight }));
    } catch { /* localStorage may be unavailable */ }
  },

  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  toggleSidebarCollapsed: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  // Navigation helpers for mobile
  showEmailList: () => {
    const { isMobile } = get();
    if (isMobile) {
      set({ activeView: "list", sidebarOpen: false });
    }
  },

  showEmailViewer: () => {
    const { isMobile } = get();
    if (isMobile) {
      set({ activeView: "viewer" });
    }
  },

  goBack: () => {
    const { activeView, isMobile } = get();
    if (!isMobile) return;

    if (activeView === "viewer") {
      set({ activeView: "list" });
    } else if (activeView === "list") {
      set({ sidebarOpen: true });
    }
  },
}));
