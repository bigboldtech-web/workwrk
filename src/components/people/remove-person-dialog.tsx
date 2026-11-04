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
// Docs-found fixes batch 8: a person who owns only Spaces, Folders or Lists
// is handed over first too: the removal waits for every handover now (409
// handover_first). Every report here moves with the handover
// (workspace-status-2.md E4, E6, step 4): their lines in another workspace
// are that workspace's own, so the removal moves none itself and nothing is
// said about them (batch 8's `handoverTo` and its words retired).
//
// Batch 9: a refused removal says what the handover really moved, from its
// answer (it said "Their open work moved to X" when nothing had), and only
// that the person is still here when nothing moved. A viewer who may remove
// the person but not hand their work over (`canHandOver` false: an org-wide
// level or the People team outside their own solid tree, whom the handover
// refuses) is never shown the summary or the picker: the dialog says who
// can hand the work over, and the removal goes ahead only if nothing is left.
// They still get the two notes (their other workspaces, the API keys that
// stop working): GET /api/users/[id]/handover?notes=1, a boolean and a
// count under DELETE's own rule (docs/plans/workspace-status.md, the final
// review, product L6).

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SkeletonLines } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api-fetch";
import { useOsToast } from "@/components/layout/os/toast";
import { PeoplePickerField, type PickPerson } from "./person-bits";
import { refusedRemovalWords, type HandoverMoved } from "@/lib/people/reporting-lines";
import { leavingNotes } from "@/lib/people/leaving-notes";

interface Bucket<T> { count: number; items: T[] }
interface Handover {
  openTasks: Bucket<{ id: string; title: string }>;
  okrs: Bucket<{ id: string; title: string }>;
  kras: Bucket<{ id: string; name: string }>;
  assets: Bucket<{ id: string; name: string }>;
  directReports: Bucket<{ id: string; firstName: string; lastName: string }>;
  containers?: { count: number };
  /** Goal targets they count from their Lists (recurring-goals.md C10); absent when none. */
  goalSources?: { count: number };
  /** They also belong to another live workspace, which this does not affect (workspace-status D17). */
  alsoElsewhere?: boolean;
  /** The live API keys they made here, which stop working with the removal (D15). */
  apiKeys?: number;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function RemovePersonDialog({
  userId,
  firstName,
  fullName,
  manager,
  me,
  canHandOver,
  onClose,
  onRemoved,
}: {
  userId: string;
  firstName: string;
  fullName: string;
  manager: PickPerson | null;
  me: PickPerson;
  /** The record's access.handover (batch 9): may this viewer read what they hold and hand it over? */
  canHandOver: boolean;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const { toast } = useOsToast();
  const [summary, setSummary] = useState<Handover | null>(null);
  const [summaryFailed, setSummaryFailed] = useState(false);
  const [notesOnly, setNotesOnly] = useState<{ alsoElsewhere?: boolean; apiKeys?: number } | null>(null);
  const initial = manager && manager.id !== userId ? manager : me;
  const [to, setTo] = useState<PickPerson>(initial);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // The summary names their work: read only by someone who may hand it
    // over. Anyone else reads the two notes alone (see the header).
    if (!canHandOver) {
      let live = true;
      void apiFetch<{ alsoElsewhere?: boolean; apiKeys?: number }>(`/api/users/${userId}/handover?notes=1`, { cache: "no-store" }).then((r) => {
        if (live && r.ok) setNotesOnly(r.data);
      });
      return () => { live = false; };
    }
    let live = true;
    void apiFetch<Handover>(`/api/users/${userId}/handover`, { cache: "no-store" }).then((r) => {
      if (!live) return;
      if (r.ok) setSummary(r.data);
      else setSummaryFailed(true);
    });
    return () => { live = false; };
  }, [userId, canHandOver]);

  const holds = summary
    ? [
        summary.openTasks.count ? plural(summary.openTasks.count, "open task") : null,
        summary.directReports.count ? plural(summary.directReports.count, "direct report") : null,
        summary.containers?.count ? plural(summary.containers.count, "Space, Folder or List", "Spaces, Folders and Lists") : null,
        summary.okrs.count ? plural(summary.okrs.count, "live goal") : null,
        summary.kras.count ? plural(summary.kras.count, "KRA") : null,
        summary.assets.count ? plural(summary.assets.count, "asset") : null,
        summary.goalSources?.count ? plural(summary.goalSources.count, "goal target counted from their Lists", "goal targets counted from their Lists") : null,
      ].filter(Boolean)
    : [];
  const confirmed = typed.trim().toLowerCase() === firstName.trim().toLowerCase() && firstName.trim() !== "";
  // Their other workspaces, and the API keys they made here (D15, D17).
  const leaving = leavingNotes(summary ?? notesOnly);

  async function remove() {
    if (!confirmed || busy) return;
    setBusy(true);
    setError(null);
    // Their Spaces, Folders and Lists too (batch 8): the removal waits for
    // every handover, as a deactivation does. A viewer who may not hand it
    // over runs none (batch 9): the removal answers 409 if anything is left.
    const needsHandover = canHandOver && (!summary || summary.openTasks.count > 0 || summary.directReports.count > 0 || (summary.containers?.count ?? 0) > 0 || (summary.goalSources?.count ?? 0) > 0);
    type Person = { name: string | null };
    const rehomed: Array<Person & { managerName: string | null }> = [];
    // What the handover answered it moved (batch 9), for a refused removal's words.
    let moved: HandoverMoved | null = null;
    if (needsHandover) {
      const h = await apiFetch<HandoverMoved & { data?: HandoverMoved }>(`/api/users/${userId}/handover`, { method: "POST", json: { reassignToId: to.id } });
      if (!h.ok) {
        setBusy(false);
        setError(`Nothing was removed. The handover failed: ${h.error || "try again"}.`);
        return;
      }
      moved = h.data?.data ?? h.data ?? {};
      rehomed.push(...(moved.reportsRehomed ?? []));
    }
    // The handover moved every report here (workspace-status-2.md E4, E6):
    // the removal moves no line itself.
    const d = await apiFetch(`/api/users/${userId}`, { method: "DELETE" });
    setBusy(false);
    if (!d.ok) {
      // Said from what really moved (batch 9).
      setError(needsHandover
        ? refusedRemovalWords({ firstName, recipientName: to.firstName || "the new owner", moved, error: d.error })
        : d.error || "Couldn't remove them");
      return;
    }
    // Reports that could not go to the new owner (the new owner themselves,
    // or a move that would make a loop) went up a level or to no manager: say
    // exactly where, never silently.
    const rehomedNote = rehomed.length ? " " + rehomed.map((r) => `${r.name ?? "Someone"} now ${r.managerName ? `reports to ${r.managerName}` : "has no manager"}`).join(". ") + "." : "";
    // True for everyone removed (the step 3 review L6): the Directory's
    // Removed view lists both kinds since step 4 (someone anchored here, and
    // someone here through a membership), and only an Owner, Admin or the
    // People team sees that view, so the toast names an Admin.
    toast(`${fullName} was removed. An Admin can restore them from the Directory's Removed view.${rehomedNote}`);
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
            {!canHandOver ? (
              <span className="text-ink-2">Only an Admin or a manager above {firstName} can hand over their work. If they still hold open tasks, direct reports or Spaces, the removal waits until that is done.</span>
            ) : summary === null && !summaryFailed ? (
              <SkeletonLines lines={2} />
            ) : summaryFailed ? (
              <span className="text-ink-2">Couldn&apos;t load what they hold. Their open work and reports still move to the person below.</span>
            ) : holds.length === 0 ? (
              <span className="text-ink-2">{firstName} holds no open work and has no direct reports.</span>
            ) : (
              <span>{firstName} holds {holds.join(", ")}.</span>
            )}
          </div>
          {leaving.elsewhere ? <p className="text-sm text-ink-2">{leaving.elsewhere}</p> : null}
          {leaving.keys ? (
            <p role="alert" className="rounded-md bg-[var(--os-warning-bg)] px-3 py-2 text-sm text-[var(--os-warning-text)]">{leaving.keys}</p>
          ) : null}
          {canHandOver ? (
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
          ) : null}
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
