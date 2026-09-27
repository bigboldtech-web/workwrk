"use client";

// Remove person (spec-teams-people /people/[id], settings 5.5): the
// transfer dialog. It shows what the person still holds (GET
// /api/users/[id]/handover), preselects who takes it over (their manager,
// else the person removing them; access invariant 13 for a dialog a person
// stands in front of), asks for the first name typed back, then hands the
// open work and the direct reports over (POST handover) and removes the
// person (DELETE /api/users/[id]).
//
// Removal is reversible: the record is soft-deleted and every piece of
// history (tasks, docs, reviews, KPI numbers) stays. If the handover fails
// nothing is removed; if the removal fails after a handover, the work has
// moved and the person is still there, and the dialog says exactly that.

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SkeletonLines } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api-fetch";
import { useOsToast } from "@/components/layout/os/toast";
import { PeoplePickerField, type PickPerson } from "./person-bits";

interface Bucket<T> { count: number; items: T[] }
interface Handover {
  openTasks: Bucket<{ id: string; title: string }>;
  okrs: Bucket<{ id: string; title: string }>;
  kras: Bucket<{ id: string; name: string }>;
  assets: Bucket<{ id: string; name: string }>;
  directReports: Bucket<{ id: string; firstName: string; lastName: string }>;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function RemovePersonDialog({
  userId,
  firstName,
  fullName,
  manager,
  me,
  onClose,
  onRemoved,
}: {
  userId: string;
  firstName: string;
  fullName: string;
  manager: PickPerson | null;
  me: PickPerson;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const { toast } = useOsToast();
  const [summary, setSummary] = useState<Handover | null>(null);
  const [summaryFailed, setSummaryFailed] = useState(false);
  const initial = manager && manager.id !== userId ? manager : me;
  const [to, setTo] = useState<PickPerson>(initial);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void apiFetch<Handover>(`/api/users/${userId}/handover`, { cache: "no-store" }).then((r) => {
      if (!live) return;
      if (r.ok) setSummary(r.data);
      else setSummaryFailed(true);
    });
    return () => { live = false; };
  }, [userId]);

  const holds = summary
    ? [
        summary.openTasks.count ? plural(summary.openTasks.count, "open task") : null,
        summary.directReports.count ? plural(summary.directReports.count, "direct report") : null,
        summary.okrs.count ? plural(summary.okrs.count, "live goal") : null,
        summary.kras.count ? plural(summary.kras.count, "KRA") : null,
        summary.assets.count ? plural(summary.assets.count, "asset") : null,
      ].filter(Boolean)
    : [];
  const confirmed = typed.trim().toLowerCase() === firstName.trim().toLowerCase() && firstName.trim() !== "";

  async function remove() {
    if (!confirmed || busy) return;
    setBusy(true);
    setError(null);
    const needsHandover = !summary || summary.openTasks.count > 0 || summary.directReports.count > 0;
    let rehomedNote = "";
    if (needsHandover) {
      const h = await apiFetch<{ reportsRehomed?: Array<{ name: string | null; managerName: string | null }>; data?: { reportsRehomed?: Array<{ name: string | null; managerName: string | null }> } }>(`/api/users/${userId}/handover`, { method: "POST", json: { reassignToId: to.id } });
      if (h.ok) {
        // Reports that could not go to the new owner (the new owner
        // themselves, or a move that would make a loop) went up a level or
        // to no manager: say exactly where, never silently.
        const rehomed = h.data?.reportsRehomed ?? h.data?.data?.reportsRehomed ?? [];
        if (rehomed.length) {
          rehomedNote = " " + rehomed.map((r) => `${r.name ?? "Someone"} now ${r.managerName ? `reports to ${r.managerName}` : "has no manager"}`).join(". ") + ".";
        }
      }
      if (!h.ok) {
        setBusy(false);
        setError(`Nothing was removed. The handover failed: ${h.error || "try again"}.`);
        return;
      }
    }
    const d = await apiFetch(`/api/users/${userId}`, { method: "DELETE" });
    setBusy(false);
    if (!d.ok) {
      setError(needsHandover
        ? `Their open work and reports moved to ${to.firstName ?? "the new owner"}, but ${firstName} is still here: ${d.error || "try Remove again"}.`
        : d.error || "Couldn't remove them");
      return;
    }
    toast(`${fullName} was removed. Restore them from the Directory's Removed view.${rehomedNote}`);
    onRemoved();
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v && !busy) onClose(); }}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Remove {fullName} from the workspace</DialogTitle>
          <DialogDescription>They lose access at once. Their history (tasks, docs, reviews and KPI numbers) stays, and an Admin can restore them.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-line bg-subtle px-3 py-2.5 text-sm text-ink">
            {summary === null && !summaryFailed ? (
              <SkeletonLines lines={2} />
            ) : summaryFailed ? (
              <span className="text-ink-2">Couldn&apos;t load what they hold. Their open work and reports still move to the person below.</span>
            ) : holds.length === 0 ? (
              <span className="text-ink-2">{firstName} holds no open work and has no direct reports.</span>
            ) : (
              <span>{firstName} holds {holds.join(", ")}.</span>
            )}
          </div>
          <label className="flex flex-col gap-1 text-sm font-medium text-ink">
            <span>Hand their open work and reports to</span>
            <PeoplePickerField
              ariaLabel="Hand over to"
              value={[to.id]}
              people={[to, me, ...(manager ? [manager] : [])]}
              exclude={[userId]}
              allowClear={false}
              onChange={(_ids, picked) => { if (picked[0]) setTo(picked[0]); }}
            />
            <span className="text-xs font-normal text-ink-2">Done work keeps its owner. Goals, KRAs and assets stay on the record for the People team to reassign.</span>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-ink">
            <span>Type {firstName} to confirm</span>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void remove(); }}
              aria-label={`Type ${firstName} to confirm`}
              className="h-9 rounded-md border border-line bg-raised px-3 text-sm text-ink focus:border-brand focus:outline-none"
            />
          </label>
          {error ? <p role="alert" className="text-sm text-danger-text">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="destructive" onClick={() => void remove()} disabled={!confirmed || busy}>{busy ? "Removing" : "Remove"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
