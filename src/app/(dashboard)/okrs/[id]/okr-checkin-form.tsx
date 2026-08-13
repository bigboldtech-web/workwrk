"use client";

// Inline check-in form per Key Result, labeled to ClickUp's check-in
// shape: a Start / Current / Target row above the value input, optional
// note, "Save update" in brand blue. Server-rendered shell on the detail
// page; this client island handles the POST + refresh (mechanics
// unchanged — direction-aware progress math stays server-side). After a
// successful check-in we router.refresh() so the recent-activity feed
// and progress bars re-render with the new value.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function OkrCheckInForm({
  okrId,
  keyResultId,
  unit,
  current,
  start,
  target,
}: {
  okrId: string;
  keyResultId: string;
  unit: string;
  current: number;
  start?: number;
  target?: number;
}) {
  const router = useRouter();
  const [value, setValue] = useState<string>(String(current));
  const [note, setNote] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const numValue = Number(value);
    if (Number.isNaN(numValue)) {
      setError("Enter a number");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/okrs/${okrId}/check-in`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyResultId, value: numValue, note: note.trim() || null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? "Check-in failed");
        return;
      }
      setNote("");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="pt-1">
      {/* ClickUp check-in shape: Start / Current / Target framing the value. */}
      {(start != null || target != null) && (
        <div className="mb-1 flex items-center gap-3 text-[11px] text-zinc-400">
          {start != null && <span>Start: <strong className="font-medium text-zinc-500">{start}{unit}</strong></span>}
          <span>Current: <strong className="font-medium text-zinc-500">{current}{unit}</strong></span>
          {target != null && <span>Target: <strong className="font-medium text-zinc-500">{target}{unit}</strong></span>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="number"
          step="any"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-8 text-sm w-24"
          placeholder={`Current${unit ? ` (${unit})` : ""}`}
          aria-label="Current value"
        />
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="h-8 text-sm flex-1 min-w-32"
          placeholder="Add a note (optional)"
          aria-label="Check-in note"
        />
        <Button type="submit" size="sm" disabled={saving} className="h-8">
          {saving ? "Saving…" : "Save update"}
        </Button>
        {error && <span className="text-xs text-red-400 w-full">{error}</span>}
      </div>
    </form>
  );
}
