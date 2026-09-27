"use client";

// Assign, reassign or unassign an asset (spec-tools-misc 2.2): a people
// Picker over GET /api/people/pick?q= (the whole company, the way every
// people picker reads), one primary "Assign", and a destructive ghost
// "Unassign" when the asset is assigned. PATCHes /api/assets/[id] with
// { assignedToId }; the server checks the person is in this org.
//
// With `count` (the bulk bar) it picks a person and hands the id back
// through `onPick` instead of writing one asset itself.

import { useEffect, useState } from "react";
import { UserMinus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Picker } from "@/components/ui/picker";
import { Avatar } from "@/components/ui/avatar-stack";
import { useOsToast } from "@/components/layout/os/toast";
import { apiFetch } from "@/lib/api-fetch";
import { personName, type ApiAsset } from "./types";

type Person = { id: string; firstName: string | null; lastName: string | null; email: string | null; avatar?: string | null };

export function AssignDialog({ open, onOpenChange, asset, onSaved, count, onPick }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  asset: ApiAsset | null;
  onSaved: () => void;
  /** Bulk mode: how many assets the pick applies to. */
  count?: number;
  onPick?: (userId: string | null) => void;
}) {
  const { toast } = useOsToast();
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<Person | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Reset on open, adjusted during render rather than in an effect.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) { setPicked(null); setQuery(""); setPickerOpen(true); }
  }

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      setLoading(true);
      const r = await apiFetch<{ people: Person[] }>(`/api/people/pick?q=${encodeURIComponent(query)}`, { cache: "no-store" });
      setLoading(false);
      if (r.ok) setPeople(r.data.people);
    }, 200);
    return () => clearTimeout(t);
  }, [open, query]);

  async function write(assignedToId: string | null) {
    if (onPick) { onPick(assignedToId); return; }
    if (!asset) return;
    setBusy(true);
    const r = await apiFetch(`/api/assets/${asset.id}`, { method: "PATCH", json: { assignedToId } });
    setBusy(false);
    if (!r.ok) {
      toast(r.status === 403 ? "You can't assign this asset." : (r.error || "Couldn't change the assignment"), { tone: "danger" });
      return;
    }
    toast(assignedToId ? "Assigned" : "Unassigned");
    onOpenChange(false);
    onSaved();
  }

  const currentId = asset?.assignedTo?.id ?? null;
  const title = count ? `Assign ${count} ${count === 1 ? "asset" : "assets"}` : asset?.assignedTo ? "Reassign asset" : "Assign asset";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {count ? "Pick who gets them." : asset ? `${asset.name}${asset.assignedTo ? ` · with ${personName(asset.assignedTo) || "someone"} today` : ""}` : ""}
          </DialogDescription>
        </DialogHeader>

        {/* The Picker is an absolute child of the dialog (ui/dialog centres
            with a transform, so a portal would land elsewhere), and the
            dialog reserves the room it needs so the list is never clipped. */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            aria-haspopup="listbox"
            aria-expanded={pickerOpen}
            className="flex h-10 w-full items-center gap-2 rounded-md border border-line-strong bg-raised px-3 text-left text-base text-ink"
          >
            {picked ? (
              <>
                <Avatar person={{ id: picked.id, firstName: picked.firstName, lastName: picked.lastName, avatar: picked.avatar }} size={24} />
                <span className="min-w-0 flex-1 truncate">{personName(picked) || picked.email || "Someone"}</span>
              </>
            ) : (
              <span className="text-ink-3">Pick a person</span>
            )}
          </button>
          <Picker
            open={pickerOpen}
            onClose={() => setPickerOpen(false)}
            alwaysSearch
            onSearchChange={setQuery}
            loading={loading}
            searchPlaceholder="Search people"
            ariaLabel="Assign to"
            selected={picked?.id ?? currentId}
            sections={[{
              options: people.map((p) => ({
                value: p.id,
                label: personName(p) || p.email || "Someone",
                description: p.email ?? undefined,
                hint: p.id === currentId ? "Has it today" : undefined,
                keywords: p.email ?? undefined,
                disabled: p.id === currentId,
              })),
            }]}
            onSelect={(v) => { setPicked(people.find((p) => p.id === v) ?? null); setPickerOpen(false); }}
            className="w-full"
          />
        </div>
        {/* Room for the list, so the dialog never clips it. */}
        {pickerOpen ? <div className="h-[300px]" aria-hidden /> : null}

        <DialogFooter>
          {currentId && !count ? (
            <button type="button" onClick={() => void write(null)} disabled={busy} className="me-auto inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-base font-medium text-danger-text hover:bg-danger-bg disabled:opacity-50">
              <UserMinus className="h-4 w-4" aria-hidden /> Unassign
            </button>
          ) : null}
          <button type="button" onClick={() => onOpenChange(false)} className="inline-flex h-9 items-center rounded-md px-3 text-base font-medium text-ink-2 hover:bg-hover hover:text-ink">Cancel</button>
          <button type="button" onClick={() => picked && void write(picked.id)} disabled={busy || !picked} className="inline-flex h-9 items-center rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover disabled:opacity-50">Assign</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
