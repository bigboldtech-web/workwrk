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
//
// Docs-found fixes batch 8: a report who also reports to them in another
// workspace moves with the removal itself (DELETE, with `handoverTo`, the
// person picked), never with the handover before it, so a refused removal
// leaves that workspace's line as it was; the dialog says so when it is
// refused. A person who owns only Spaces, Folders or Lists is handed over
// first too: the removal waits for every handover now (409 handover_first).

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SkeletonLines } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api-fetch";
import { useOsToast } from "@/components/layout/os/toast";
import { PeoplePickerField, type PickPerson } from "./person-bits";
import { linesAlsoElsewhereNote } from "@/lib/people/reporting-lines";

interface Bucket<T> { count: number; items: T[] }
interface Handover {
  openTasks: Bucket<{ id: string; title: string }>;
  okrs: Bucket<{ id: string; title: string }>;
  kras: Bucket<{ id: string; name: string }>;
  assets: Bucket<{ id: string; name: string }>;
  directReports: Bucket<{ id: string; firstName: string; lastName: string }>;
  containers?: { count: number };
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
        summary.containers?.count ? plural(summary.containers.count, "Space, Folder or List", "Spaces, Folders and Lists") : null,
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
    // Their Spaces, Folders and Lists too (batch 8): the removal waits for
    // every handover, as a deactivation does.
    const needsHandover = !summary || summary.openTasks.count > 0 || summary.directReports.count > 0 || (summary.containers?.count ?? 0) > 0;
    type Person = { name: string | null };
    type Moved = { reportsRehomed?: Array<Person & { managerName: string | null }>; reportsAlsoElsewhere?: Person[]; reportsAtAccountEnd?: Person[]; reportsReassigned?: number };
    const rehomed: Array<Person & { managerName: string | null }> = [];
    const alsoMoved: Person[] = [];
    let waiting: Person[] = [];
    let reportsMoved = 0;
    if (needsHandover) {
      const h = await apiFetch<Moved & { data?: Moved }>(`/api/users/${userId}/handover`, { method: "POST", json: { reassignToId: to.id } });
      if (!h.ok) {
        setBusy(false);
        setError(`Nothing was removed. The handover failed: ${h.error || "try again"}.`);
        return;
      }
      const moved = h.data?.data ?? h.data;
      rehomed.push(...(moved?.reportsRehomed ?? []));
      alsoMoved.push(...(moved?.reportsAlsoElsewhere ?? []));
      // A report who also reports to them in another workspace moves with
      // the removal itself, never with the handover (batch 8).
      waiting = moved?.reportsAtAccountEnd ?? [];
      reportsMoved = (moved?.reportsReassigned ?? 0) + (moved?.reportsRehomed?.length ?? 0);
    }
    const d = await apiFetch<Moved>(`/api/users/${userId}?handoverTo=${encodeURIComponent(to.id)}`, { method: "DELETE" });
    setBusy(false);
    if (!d.ok) {
      // The lines another workspace relies on did not move: they wait for the
      // removal, and the dialog says so (batch 8; it said every report moved).
      const left = linesAlsoElsewhereNote(waiting, fullName, "removed");
      setError(needsHandover
        ? `Their open work${reportsMoved > 0 ? " and reports" : ""} moved to ${to.firstName ?? "the new owner"}, but ${firstName} is still here: ${d.error || "try Remove again"}.${left ? ` ${left}` : ""}`
        : d.error || "Couldn't remove them");
      return;
    }
    rehomed.push(...(d.data?.reportsRehomed ?? []));
    alsoMoved.push(...(d.data?.reportsAlsoElsewhere ?? []));
    // Reports that could not go to the new owner (the new owner themselves,
    // or a move that would make a loop) went up a level or to no manager: say
    // exactly where, never silently.
    let rehomedNote = rehomed.length ? " " + rehomed.map((r) => `${r.name ?? "Someone"} now ${r.managerName ? `reports to ${r.managerName}` : "has no manager"}`).join(". ") + "." : "";
    // A report who also reported to them in another workspace moved too, and
    // that workspace's Audit log records it (batch 7; batch 6 said "left as
    // it is", untrue once this removal landed).
    const alsoSaid = linesAlsoElsewhereNote(alsoMoved, fullName, "done");
    if (alsoSaid) rehomedNote += ` ${alsoSaid}`;
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
