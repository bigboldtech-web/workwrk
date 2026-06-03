"use client";

// SetStatusModal — light overlay launched from the profile dropdown.
// Mirrors ClickUp's "Set status" panel: a free-text "What's on your
// mind?" row at the top, then a short list of presets ("In a meeting
// — for an hour", "Focusing — until Thursday", …) that auto-fill the
// label + expiry.
//
// Mounted once at the OsShell level; visibility comes from
// useOsShell().statusModalOpen so any caller can pop it via
// openStatusModal().

import { useEffect, useState } from "react";
import { X, SmilePlus, CornerDownLeft } from "lucide-react";
import { useOsShell, type PresenceStatus } from "./shell-context";

type Preset = { emoji: string; label: string; expiry: string };

const PRESETS: Preset[] = [
  { emoji: "📅", label: "In a meeting", expiry: "for an hour" },
  { emoji: "📚", label: "Focusing",     expiry: "until Thursday" },
  { emoji: "🤒", label: "Sick",         expiry: "OOO for Today" },
  { emoji: "🏖️", label: "Vacation",     expiry: "OOO until Thursday" },
];

function expiryToIso(text: string): string | null {
  const now = new Date();
  if (text === "for an hour") {
    return new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  }
  if (text === "OOO for Today") {
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59).toISOString();
    return end;
  }
  if (text.includes("Thursday")) {
    const d = new Date(now);
    const day = d.getDay();
    const diff = (4 - day + 7) % 7 || 7;
    d.setDate(d.getDate() + diff);
    return d.toISOString();
  }
  return null;
}

export function SetStatusModal() {
  const { statusModalOpen, closeStatusModal } = useOsShell();
  if (!statusModalOpen) return null;
  return <SetStatusModalInner onClose={closeStatusModal} />;
}

function SetStatusModalInner({ onClose }: { onClose: () => void }) {
  const { setPresenceStatus, presenceStatus } = useOsShell();
  const [text, setText] = useState(() =>
    presenceStatus.label === "Online" ? "" : presenceStatus.label,
  );
  const [emoji, setEmoji] = useState<string | null>(() => presenceStatus.emoji);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const applyPreset = (p: Preset) => {
    const status: PresenceStatus = {
      emoji: p.emoji,
      label: p.label,
      expiresAt: expiryToIso(p.expiry),
    };
    setPresenceStatus(status);
    onClose();
  };

  const save = () => {
    if (!text.trim()) {
      setPresenceStatus({ emoji: null, label: "Online", expiresAt: null });
    } else {
      setPresenceStatus({ emoji, label: text.trim(), expiresAt: null });
    }
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); save(); }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center bg-black/40 backdrop-blur-sm pt-[16vh] px-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-[540px] bg-zinc-900 text-white rounded-2xl shadow-2xl border border-zinc-800 overflow-hidden">
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="text-[18px] font-semibold">Set status</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 pb-4 flex items-center gap-2">
          <button
            type="button"
            className="w-9 h-9 rounded-lg border border-zinc-700 bg-zinc-800 flex items-center justify-center hover:border-zinc-600"
            title="Pick emoji"
            onClick={() => setEmoji((e) => (e ? null : "😀"))}
          >
            {emoji ?? <SmilePlus className="w-4 h-4 text-zinc-400" />}
          </button>
          <input
            autoFocus
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="What's on your mind?"
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-[14px] placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none"
          />
        </div>
        <div className="px-5 pb-5">
          <div className="text-[12px] text-zinc-400 mb-2">For Cashkr Team</div>
          <div className="space-y-1">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => applyPreset(p)}
                className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-zinc-800 text-left"
              >
                <span className="text-[18px]">{p.emoji}</span>
                <span className="text-[14px] font-medium text-white">{p.label}</span>
                <span className="text-[13px] text-zinc-400">— {p.expiry}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="border-t border-zinc-800 px-5 py-3 flex justify-end">
          <button
            type="button"
            onClick={save}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-[13px] font-medium border border-zinc-700"
          >
            Save
            <CornerDownLeft className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
