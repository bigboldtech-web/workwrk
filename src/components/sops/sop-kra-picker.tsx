"use client";

// "Linked KRA" picker for the SOP page's Details strip: a Picker over
// GET /api/kras, writing `kraId` through PATCH /api/sops/[id] and trusting
// the server's echo (if the API does not accept kraId the row is unchanged
// and the UI must not pretend otherwise). Moved out of the old SOP page
// with its behaviour intact and its shadcn chrome replaced by the Picker.

import { useCallback, useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Picker } from "@/components/ui/picker";
import { useOsToast } from "@/components/layout/os/toast";
import { apiFetch } from "@/lib/api-fetch";

export function SopKraPicker({ sopId, kraId, canEdit, onSaved }: {
  sopId: string | null;
  kraId: string | null;
  canEdit: boolean;
  onSaved: (next: string | null) => void;
}) {
  const { toast } = useOsToast();
  const [open, setOpen] = useState(false);
  const [kras, setKras] = useState<Array<{ id: string; name: string }> | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    const r = await apiFetch<{ data?: Array<{ id: string; name: string }> } | Array<{ id: string; name: string }>>("/api/kras?limit=200", { cache: "no-store" });
    if (!r.ok) { setKras([]); setFailed(true); return; }
    const list = Array.isArray(r.data) ? r.data : r.data?.data ?? [];
    setKras(list.map((k) => ({ id: k.id, name: k.name })));
  }, []);

  // Resolve the linked KRA's name for display without opening the menu.
  useEffect(() => {
    if (kraId && kras === null) { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }
  }, [kraId, kras, load]);

  const currentName = kraId ? (kras?.find((k) => k.id === kraId)?.name ?? "Linked") : null;

  const pick = async (next: string | null) => {
    setOpen(false);
    if (next === kraId) return;
    if (!sopId) { onSaved(next); return; }
    setSaving(true);
    const r = await apiFetch<{ kraId?: string | null }>(`/api/sops/${sopId}`, { method: "PATCH", json: { kraId: next } });
    setSaving(false);
    if (!r.ok) { toast(r.error || "Couldn't update the linked KRA", { tone: "danger" }); return; }
    const echoed = (r.data?.kraId ?? null) as string | null;
    if (echoed !== next) toast("Linking KRAs isn't available yet", { tone: "danger" });
    onSaved(echoed);
  };

  if (!canEdit) return <span className="text-base text-ink">{currentName ?? <span className="text-ink-3">None</span>}</span>;

  return (
    <span className="relative inline-block">
      <button
        type="button"
        disabled={saving}
        onClick={() => { const next = !open; setOpen(next); if (next && (kras === null || failed)) { setKras(null); void load(); } }}
        className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-base text-ink hover:bg-hover disabled:opacity-60"
        title="Link this SOP to a Key Responsibility Area"
      >
        <span className={currentName ? "" : "text-ink-3"}>{currentName ?? "None"}</span>
        <ChevronDown className="h-4 w-4 text-ink-3" strokeWidth={1.5} aria-hidden />
      </button>
      <Picker
        open={open}
        onClose={() => setOpen(false)}
        ariaLabel="Linked KRA"
        searchPlaceholder="Find a KRA"
        selected={kraId ?? "__none__"}
        onSelect={(v) => void pick(v === "__none__" ? null : v)}
        emptyLabel={failed ? "Couldn't load KRAs. Reopen to retry." : kras === null ? "Loading" : "No KRAs in this workspace yet."}
        sections={[{ options: [{ value: "__none__", label: "No linked KRA" }, ...(kras ?? []).map((k) => ({ value: k.id, label: k.name }))] }]}
        width={280}
      />
    </span>
  );
}
