"use client";

// KraDialog — create or edit a KRA under the role-first spine.
//
// A KRA exists ONLY inside a job title, so the role select is REQUIRED on
// create (POST /api/kras rejects roleId-less KRAs). Edit mode PATCHes
// name/description/category and lets an admin re-home the KRA to another
// job title. Built on the ui/dialog anatomy: tinted icon square level
// with a 15px title, no divider hairlines.

import { useEffect, useState } from "react";
import { Target, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export type KraDialogRole = { id: string; title: string };

export type KraDialogKra = {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  roleId?: string | null;
  /** Role-level default weight (0..100) inherited by every holder. */
  weight?: number | null;
};

export function KraDialog({
  open,
  onOpenChange,
  roles,
  defaultRoleId,
  lockRole = false,
  kra,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Job titles the KRA can belong to. */
  roles: KraDialogRole[];
  /** Preselected job title (e.g. the workspace's active role). */
  defaultRoleId?: string | null;
  /** Hide the role select (creating from inside a role's workspace). */
  lockRole?: boolean;
  /** When set, the dialog edits this KRA instead of creating one. */
  kra?: KraDialogKra | null;
  onSaved: (msg: string) => void;
}) {
  const editing = Boolean(kra);
  const [roleId, setRoleId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [weight, setWeight] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setRoleId(kra?.roleId ?? defaultRoleId ?? "");
    setName(kra?.name ?? "");
    setDescription(kra?.description ?? "");
    setWeight(kra?.weight ? String(kra.weight) : "");
    setError(null);
  }, [open, kra, defaultRoleId]);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) { setError("Give the KRA a name."); return; }
    if (!roleId) { setError("Pick the job title this KRA belongs to."); return; }
    const weightNum = weight.trim() === "" ? 0 : Number(weight);
    if (!Number.isFinite(weightNum) || weightNum < 0 || weightNum > 100) {
      setError("Weight must be between 0 and 100.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/kras", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          editing
            ? { id: kra!.id, name: trimmed, description: description.trim() || null, roleId, weight: weightNum }
            : { name: trimmed, description: description.trim() || undefined, roleId, weight: weightNum },
        ),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(
          res.status === 403
            ? "You don't have permission to manage KRAs."
            : (d?.error ?? "Couldn't save the KRA."),
        );
        return;
      }
      onSaved(editing ? "KRA updated" : "KRA created");
      onOpenChange(false);
    } catch {
      setError("Couldn't save the KRA.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[440px] gap-0 p-5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#0073EA]/10">
            <Target size={15} className="text-[#0073EA]" />
          </span>
          <DialogTitle className="leading-none">{editing ? "Edit KRA" : "New KRA"}</DialogTitle>
        </div>
        <p className="mt-2 text-[12.5px] leading-relaxed text-zinc-500 dark:text-zinc-400">
          A KRA is a permanent area of responsibility inside a job title. Everyone
          holding that title inherits it.
        </p>

        <div className="mt-4 space-y-3">
          {!lockRole || editing ? (
            <label className="block">
              <span className="text-[12px] font-medium text-zinc-600">Job title</span>
              <select
                value={roleId}
                onChange={(e) => setRoleId(e.target.value)}
                className="mt-1 w-full h-9 px-2 rounded-md border border-zinc-200 bg-white text-[13px] focus:outline-none focus:border-[#0073EA]"
              >
                <option value="" disabled>Pick a job title…</option>
                {roles.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
              </select>
            </label>
          ) : (
            <div className="text-[12px] text-zinc-500">
              Job title:{" "}
              <span className="font-medium text-zinc-800 dark:text-zinc-200">
                {roles.find((r) => r.id === roleId)?.title ?? "—"}
              </span>
            </div>
          )}

          <label className="block">
            <span className="text-[12px] font-medium text-zinc-600">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
              placeholder="e.g. Pipeline generation"
              autoFocus
              className="mt-1 w-full h-9 px-2.5 rounded-md border border-zinc-200 text-[13px] focus:outline-none focus:border-[#0073EA]"
            />
          </label>

          <label className="block">
            <span className="text-[12px] font-medium text-zinc-600">
              Description <span className="text-zinc-400 font-normal">(optional)</span>
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="What outcome does this area own?"
              className="mt-1 w-full px-2.5 py-2 rounded-md border border-zinc-200 text-[13px] resize-none focus:outline-none focus:border-[#0073EA]"
            />
          </label>

          <label className="block">
            <span className="text-[12px] font-medium text-zinc-600">
              Weight % <span className="text-zinc-400 font-normal">(share of the job title, 0 to 100)</span>
            </span>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={100}
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                placeholder="0"
                className="w-24 h-9 px-2.5 rounded-md border border-zinc-200 text-[13px] text-right tabular-nums focus:outline-none focus:border-[#0073EA]"
              />
              <span className="text-[11.5px] text-zinc-400">Every holder inherits this as their starting weightage.</span>
            </div>
          </label>

          {error ? <p className="text-[12px] text-red-600">{error}</p> : null}
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void submit()} disabled={busy || !name.trim() || !roleId}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            {editing ? "Save changes" : "Create KRA"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
