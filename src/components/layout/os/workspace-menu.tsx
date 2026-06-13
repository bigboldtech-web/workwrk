"use client";

// WorkspaceMenu — popover that drops out of the top-left workspace
// switcher. Matches the 2026-06-03 ClickUp screenshot:
//
//   ┌──────────────────────────────────────┐
//   │ [K]  Cashkr Team                     │
//   │      10 members · Free Forever · Up… │
//   │                                      │
//   │  [⚙ Settings]   [👥 People]          │
//   │                                      │
//   │  Manage                              │
//   │  🎨 Apps                             │
//   │  📋 Templates                        │
//   │  ⚡ Automations                       │
//   │                                      │
//   │  Switch Workspaces                   │
//   │  [K] Cashkr Team                     │
//   │  [👤] Ibrahim Surya's Workspace      │
//   │                                      │
//   │  [+ Create Workspace]                │
//   └──────────────────────────────────────┘
//
// Click outside or press Escape to close.

import { useEffect, useRef, useState } from "react";
import {
  Settings as SettingsIcon, Users as UsersIcon, Sparkles, LayoutGrid, Zap, Plus,
} from "lucide-react";
import { MenuItem } from "@/components/ui/menu";

interface WorkspaceMenuProps {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}

type Tab = "settings" | "people";

export function WorkspaceMenu({ open, onClose, anchorRef }: WorkspaceMenuProps) {
  const [tab, setTab] = useState<Tab>("settings");
  const popoverRef = useRef<HTMLDivElement>(null);

  // Click outside closes the menu.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onClose, anchorRef]);

  // Escape closes.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={popoverRef}
      className="absolute left-3 top-[52px] w-[360px] bg-white rounded-lg shadow-xl border border-zinc-200 z-50"
      role="menu"
    >
      {/* Header */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-md bg-zinc-900 text-white flex items-center justify-center text-base font-bold">
            K
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-zinc-900">Cashkr Team</div>
            <div className="text-xs text-zinc-500">
              10 members · Free Forever · <button className="hover:underline" style={{ color: "var(--os-brand)" }}>Upgrade</button>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="grid grid-cols-2 gap-2 mt-4">
          <button
            type="button"
            onClick={() => setTab("settings")}
            className={`flex items-center justify-center gap-1.5 h-8 rounded-md text-sm transition-colors ${
              tab === "settings"
                ? "bg-zinc-100 text-zinc-900 font-medium"
                : "text-zinc-600 hover:bg-zinc-50"
            }`}
          >
            <SettingsIcon className="w-3.5 h-3.5" />
            Settings
          </button>
          <button
            type="button"
            onClick={() => setTab("people")}
            className={`flex items-center justify-center gap-1.5 h-8 rounded-md text-sm transition-colors ${
              tab === "people"
                ? "bg-zinc-100 text-zinc-900 font-medium"
                : "text-zinc-600 hover:bg-zinc-50"
            }`}
          >
            <UsersIcon className="w-3.5 h-3.5" />
            People
          </button>
        </div>
      </div>

      {tab === "settings" ? (
        <>
          {/* Manage section */}
          <div className="px-4 pb-2 pt-1">
            <div className="text-[11px] uppercase tracking-wide text-zinc-500 font-medium mb-1.5">Manage</div>
            <ul className="space-y-0.5">
              <li><MenuItem variant="inset" icon={Sparkles}    label="Apps" /></li>
              <li><MenuItem variant="inset" icon={LayoutGrid}  label="Templates" /></li>
              <li><MenuItem variant="inset" icon={Zap}         label="Automations" /></li>
            </ul>
          </div>

          {/* Divider */}
          <div className="border-t border-zinc-100 mx-4" />

          {/* Switch Workspaces */}
          <div className="px-4 py-2">
            <div className="text-[11px] uppercase tracking-wide text-zinc-500 font-medium mb-1.5">Switch Workspaces</div>
            <ul className="space-y-0.5">
              <li>
                <MenuItem
                  variant="inset"
                  leading={<span className="w-6 h-6 rounded-md bg-zinc-900 text-white flex items-center justify-center text-[10px] font-bold shrink-0">K</span>}
                  label="Cashkr Team"
                  selected
                />
              </li>
              <li>
                <MenuItem
                  variant="inset"
                  leading={<span className="w-6 h-6 rounded-md text-white flex items-center justify-center text-[10px] font-bold shrink-0" style={{ background: "var(--os-brand)" }}>IS</span>}
                  label="Ibrahim Surya's Workspace"
                />
              </li>
            </ul>
          </div>

          {/* Create Workspace */}
          <div className="px-3 pb-3 pt-1">
            <button
              type="button"
              className="w-full flex items-center justify-center gap-1.5 h-9 rounded-md border border-zinc-200 hover:bg-zinc-50 text-sm text-zinc-700"
            >
              <Plus className="w-3.5 h-3.5" />
              Create Workspace
            </button>
          </div>
        </>
      ) : (
        <div className="px-4 pb-4 pt-2 text-sm text-zinc-500">
          People management coming soon.
        </div>
      )}
    </div>
  );
}
