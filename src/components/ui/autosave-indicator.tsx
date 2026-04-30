"use client";

import { Cloud, CloudOff } from "lucide-react";
import type { AutosaveStatus } from "@/hooks/use-autosave";

interface Props {
  status: AutosaveStatus;
  lastSavedAt: Date | null;
  /** Tweak the wording shown in each state. Useful for "draft" vs
   *  "doc" vs "review" contexts. */
  labels?: {
    saving?: string;
    saved?: string;
    error?: string;
    dirty?: string;
    idle?: string;
  };
  className?: string;
}

/**
 * Tiny, consistent autosave indicator. Drop next to any title /
 * header on a page that uses `useAutosave` so users always know
 * their work is safe.
 */
export function AutosaveIndicator({ status, lastSavedAt, labels, className }: Props) {
  const at = lastSavedAt ? lastSavedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  const text =
    status === "saving" ? (labels?.saving ?? "Saving…")
    : status === "saved" ? `${labels?.saved ?? "Saved"}${at ? ` at ${at}` : ""}`
    : status === "error" ? (labels?.error ?? "Save failed — retrying")
    : status === "dirty" ? (labels?.dirty ?? "Unsaved changes")
    : (labels?.idle ?? "Autosave on");

  const icon =
    status === "error"
      ? <CloudOff size={11} className="text-red-400" />
      : <Cloud size={11} className={
          status === "saving" ? "animate-pulse" :
          status === "saved" ? "text-green-400" :
          ""
        } />;

  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] text-muted ${className ?? ""}`}>
      {icon}
      <span>{text}</span>
    </span>
  );
}
