"use client";

/* RemovePersonDialog — the offboarding confirm. Before the destructive
 * action it shows what the person still holds (GET /api/users/[id]/handover)
 * so the manager can hand it over, offers an optional "Reassign open work
 * to…" picker (POST handover), then soft-deletes via DELETE /api/users/[id].
 *
 * Removal is reversible: deletedAt + INACTIVE only. All history (tasks,
 * docs, reviews, KPI records) survives, and the dialog says so in plain
 * words. Follows the shared confirm-dialog anatomy: tinted icon square
 * level with a 15px title, no divider hairlines, right-aligned footer.
 */

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { AlertTriangle, UserMinus } from "lucide-react";

interface HandoverBucket<T> {
  count: number;
  items: T[];
}

interface HandoverPayload {
  openTasks: HandoverBucket<{ id: string; title: string; board: string | null }>;
  okrs: HandoverBucket<{ id: string; title: string; quarter: string | null; status: string }>;
  kras: HandoverBucket<{ id: string; name: string }>;
  assets: HandoverBucket<{ id: string; name: string; type: string }>;
  directReports: HandoverBucket<{ id: string; firstName: string; lastName: string }>;
}

export interface ReassignCandidate {
  id: string;
  firstName?: string;
  lastName?: string;
}

function plural(n: number, singular: string, pluralWord?: string): string {
  return `${n} ${n === 1 ? singular : (pluralWord ?? `${singular}s`)}`;
}

function DetailLine({ label, names, count }: { label: string; names: string[]; count: number }) {
  if (count === 0) return null;
  const extra = count - names.length;
  return (
    <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
      <span className="font-medium text-zinc-600 dark:text-zinc-300">{label}:</span>{" "}
      {names.join(", ")}
      {extra > 0 ? ` +${extra} more` : ""}
    </p>
  );
}

export function RemovePersonDialog({
  open,
  onClose,
  userId,
  userName,
  firstName,
  candidates,
  onRemoved,
}: {
  open: boolean;
  onClose: () => void;
  userId: string;
  userName: string;
  firstName: string;
  candidates: ReassignCandidate[];
  onRemoved: () => void;
}) {
  const [handover, setHandover] = useState<HandoverPayload | null>(null);
  const [handoverLoading, setHandoverLoading] = useState(false);
  const [handoverError, setHandoverError] = useState(false);
  const [reassignTo, setReassignTo] = useState("");
  const [removing, setRemoving] = useState(false);
  const { success: toastSuccess, error: toastError } = useToast();

  useEffect(() => {
    if (!open) return;
    setReassignTo("");
    setHandover(null);
    setHandoverError(false);
    setHandoverLoading(true);
    fetch(`/api/users/${userId}/handover`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load failed"))))
      .then((data) => setHandover((data?.data ?? data) as HandoverPayload))
      .catch(() => setHandoverError(true))
      .finally(() => setHandoverLoading(false));
  }, [open, userId]);

  const pickable = candidates.filter((c) => c.id !== userId);
  const holdsWork =
    (handover?.openTasks.count ?? 0) > 0 || (handover?.directReports.count ?? 0) > 0;
  const showPicker = holdsWork && pickable.length > 0;
  const reassignName = (() => {
    const c = pickable.find((p) => p.id === reassignTo);
    return c ? [c.firstName, c.lastName].filter(Boolean).join(" ") : "";
  })();

  const summaryParts = handover
    ? [
        handover.openTasks.count > 0 ? plural(handover.openTasks.count, "open task") : null,
        handover.okrs.count > 0 ? plural(handover.okrs.count, "OKR") : null,
        handover.kras.count > 0 ? plural(handover.kras.count, "KRA") : null,
        handover.assets.count > 0 ? plural(handover.assets.count, "asset") : null,
        handover.directReports.count > 0 ? plural(handover.directReports.count, "direct report") : null,
      ].filter((p): p is string => p !== null)
    : [];

  const handleRemove = async () => {
    setRemoving(true);
    try {
      if (reassignTo) {
        const r = await fetch(`/api/users/${userId}/handover`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reassignToId: reassignTo }),
        });
        if (!r.ok) {
          const e = await r.json().catch(() => ({}));
          throw new Error(e.error || "Reassignment failed, nobody was removed");
        }
      }
      const res = await fetch(`/api/users/${userId}`, { method: "DELETE" });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || "Failed to remove");
      }
      toastSuccess(`${userName} removed. Restore anytime from the directory.`);
      onRemoved();
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Failed to remove");
    } finally {
      setRemoving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !removing) onClose(); }}>
      <DialogContent
        className="max-w-[460px] gap-0 p-6"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-red-50 dark:bg-[#E2445C]/15">
            <UserMinus size={15} className="text-[#E2445C]" />
          </span>
          <DialogTitle className="text-[15px] leading-none">
            Remove {userName} from the company
          </DialogTitle>
        </div>
        <p className="mt-2.5 text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">
          They lose access immediately. Their history (tasks, docs, reviews and records) is kept,
          and this can be undone later by restoring them.
        </p>

        {/* What they still hold */}
        <div className="mt-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/40 px-3 py-2.5 space-y-1">
          {handoverLoading ? (
            <p className="text-[12px] text-zinc-400">Checking what {firstName} still holds…</p>
          ) : handoverError || !handover ? (
            <p className="text-[12px] text-zinc-400">
              Couldn&rsquo;t load the handover summary. You can still remove them.
            </p>
          ) : summaryParts.length === 0 ? (
            <p className="text-[12px] text-zinc-500 dark:text-zinc-400">
              Nothing left to hand over: no open tasks, goals, assets or reports.
            </p>
          ) : (
            <>
              <p className="text-[12px] font-medium text-zinc-700 dark:text-zinc-200">
                Still holds: {summaryParts.join(" · ")}
              </p>
              <DetailLine
                label="Open tasks"
                count={handover.openTasks.count}
                names={handover.openTasks.items.map((t) => t.title)}
              />
              <DetailLine
                label="OKRs"
                count={handover.okrs.count}
                names={handover.okrs.items.map((o) => o.title)}
              />
              <DetailLine
                label="KRAs"
                count={handover.kras.count}
                names={handover.kras.items.map((k) => k.name)}
              />
              <DetailLine
                label="Assets"
                count={handover.assets.count}
                names={handover.assets.items.map((a) => a.name)}
              />
              <DetailLine
                label="Direct reports"
                count={handover.directReports.count}
                names={handover.directReports.items.map((r) =>
                  [r.firstName, r.lastName].filter(Boolean).join(" "),
                )}
              />
            </>
          )}
        </div>

        {/* No-manager warning */}
        {handover && handover.directReports.count > 0 ? (
          <div className="mt-2.5 flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-500/10 px-3 py-2 text-[12px] leading-relaxed text-amber-700 dark:text-amber-400">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span>
              {handover.directReports.count === 1
                ? `1 person reports to ${firstName}.`
                : `${handover.directReports.count} people report to ${firstName}.`}{" "}
              {reassignTo && reassignName
                ? `They will report to ${reassignName} instead.`
                : "After removal they will have no manager until you pick a new one."}
            </span>
          </div>
        ) : null}

        {/* Optional handover target */}
        {showPicker ? (
          <div className="mt-3">
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-400">
              Reassign open work to
            </p>
            <select
              value={reassignTo}
              onChange={(e) => setReassignTo(e.target.value)}
              disabled={removing}
              className="w-full h-8 px-2 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-[12.5px] text-zinc-700 dark:text-zinc-200 outline-none"
            >
              <option value="">Don&rsquo;t reassign now</option>
              {pickable.map((c) => (
                <option key={c.id} value={c.id}>
                  {[c.firstName, c.lastName].filter(Boolean).join(" ") || c.id}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-zinc-400">
              Moves their open tasks and direct reports to this person before removal. Completed
              work stays credited to {firstName}.
            </p>
          </div>
        ) : null}

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={removing}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" onClick={handleRemove} disabled={removing}>
            {removing ? "Removing…" : `Remove ${firstName}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
