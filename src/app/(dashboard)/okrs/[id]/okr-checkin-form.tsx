"use client";

// Inline check-in form per Key Result. Server-rendered shell on the
// detail page; this client island handles the POST + refresh. After a
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
}: {
  okrId: string;
  keyResultId: string;
  unit: string;
  current: number;
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
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2 pt-1">
      <Input
        type="number"
        step="any"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="h-8 text-sm w-24"
        placeholder={`Value${unit ? ` (${unit})` : ""}`}
      />
      <Input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className="h-8 text-sm flex-1 min-w-32"
        placeholder="Optional note"
      />
      <Button type="submit" size="sm" disabled={saving} className="h-8">
        {saving ? "Saving…" : "Log check-in"}
      </Button>
      {error && <span className="text-xs text-red-400 w-full">{error}</span>}
    </form>
  );
}
