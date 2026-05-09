"use client";

import * as React from "react";
import { X } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";

const isMac = typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("mac");
const mod = isMac ? "⌘" : "Ctrl";

const groups: { label: string; rows: { keys: string[]; action: string }[] }[] = [
  {
    label: "Global",
    rows: [
      { keys: ["?"], action: "Show keyboard shortcuts" },
      { keys: [mod, "K"], action: "Open command palette / focus search" },
      { keys: ["/"], action: "Focus search" },
      { keys: ["Esc"], action: "Close dialog / overlay" },
    ],
  },
  {
    label: "Navigation (press g, then a letter)",
    rows: [
      { keys: ["g", "d"], action: "Go to Dashboard" },
      { keys: ["g", "i"], action: "Go to Inbox" },
      { keys: ["g", "p"], action: "Go to People" },
      { keys: ["g", "t"], action: "Go to Tasks" },
      { keys: ["g", "o"], action: "Go to OKRs" },
      { keys: ["g", "k"], action: "Go to KRA & KPIs" },
      { keys: ["g", "m"], action: "Go to Meetings" },
      { keys: ["g", "r"], action: "Go to Reviews" },
      { keys: ["g", "a"], action: "Go to Analytics" },
      { keys: ["g", "n"], action: "Go to Announcements" },
      { keys: ["g", "c"], action: "Go to Clock" },
      { keys: ["g", "s"], action: "Go to Settings" },
    ],
  },
  {
    label: "Lists & tables",
    rows: [
      { keys: ["j"], action: "Move down a row" },
      { keys: ["k"], action: "Move up a row" },
      { keys: ["x"], action: "Toggle row selection" },
      { keys: ["e"], action: "Edit selected row" },
      { keys: ["c"], action: "Create new" },
    ],
  },
];

export function ShortcutsOverlay({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  React.useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="dash-shortcuts-overlay" onClick={onClose} role="dialog" aria-modal>
      <div className="dash-shortcuts-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dash-shortcuts-head">
          <h2 className="dash-shortcuts-title">Keyboard shortcuts</h2>
          <button
            type="button"
            className="dash-shortcuts-close"
            onClick={onClose}
            aria-label="Close shortcuts"
          >
            <X size={12} />
          </button>
        </div>
        <div className="dash-shortcuts-body">
          {groups.map((g) => (
            <div key={g.label} className="dash-shortcuts-group">
              <p className="dash-shortcuts-group-label">{g.label}</p>
              {g.rows.map((row, i) => (
                <div key={i} className="dash-shortcuts-row">
                  <span>{row.action}</span>
                  <span className="dash-shortcuts-keys">
                    <Kbd keys={row.keys} />
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Listens for `?` keydown globally; ignores when an input is focused. */
export function useShortcutsOverlay() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key !== "?") return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      e.preventDefault();
      setOpen((v) => !v);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, []);
  return { open, setOpen, close: () => setOpen(false), toggle: () => setOpen((v) => !v) };
}
