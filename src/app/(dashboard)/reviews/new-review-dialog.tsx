"use client";

// New cycle (spec-teams-performance /reviews, the 560 modal on ui/dialog):
// a name, the type, the period (filled from the type, editable) and who it
// covers. The People team and Admin pick Everyone, some departments or
// named people; a manager's cycle covers the people who report to them
// (DECIDED: a manager may run a review cycle for their chain), and launch
// clips it to that chain whatever it says. Creating makes a Draft: nobody
// is asked for anything until the cycle is launched.

import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { PickerButton } from "@/components/dashboards/widget-registry";
import { PeoplePickerField, type PickPerson } from "@/components/people/person-bits";
import { useConfirm } from "@/components/ui/dialog-provider";
import { apiFetch } from "@/lib/api-fetch";
import { CYCLE_TYPES, defaultCycleName, defaultCyclePeriod } from "@/lib/performance/review-cycle";

type Audience = "ALL" | "DEPARTMENTS" | "USERS";

export function NewReviewCycleDialog({
  open,
  onOpenChange,
  now,
  onCreated,
  orgWide,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Today (passed from the page so the dialog stays render-pure). */
  now: Date;
  onCreated: (cycle: { id: string; name: string }) => void;
  /** People team or Admin: may pick any audience. */
  orgWide: boolean;
}) {
  const confirm = useConfirm();
  const [type, setType] = useState("QUARTERLY");
  const [name, setName] = useState(() => defaultCycleName("QUARTERLY", now));
  const [touchedName, setTouchedName] = useState(false);
  const [start, setStart] = useState(() => defaultCyclePeriod("QUARTERLY", now).start);
  const [end, setEnd] = useState(() => defaultCyclePeriod("QUARTERLY", now).end);
  const [audience, setAudience] = useState<Audience>("ALL");
  const [deptIds, setDeptIds] = useState<string[]>([]);
  const [people, setPeople] = useState<PickPerson[]>([]);
  const [depts, setDepts] = useState<Array<{ id: string; name: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const dirty = touchedName || audience !== "ALL" || deptIds.length > 0 || people.length > 0;

  useEffect(() => {
    if (!open || !orgWide || depts.length) return;
    void apiFetch<Array<{ id: string; name: string }>>("/api/departments", { cache: "no-store" }).then((r) => { if (r.ok && Array.isArray(r.data)) setDepts(r.data); });
  }, [open, orgWide, depts.length]);

  const pickType = (t: string) => {
    setType(t);
    const p = defaultCyclePeriod(t, now);
    setStart(p.start);
    setEnd(p.end);
    if (!touchedName) setName(defaultCycleName(t, now));
  };

  const requestClose = async () => {
    if (busy) return;
    if (dirty && !(await confirm({ title: "Discard this cycle?", description: "Nothing has been created yet.", confirmLabel: "Discard", destructive: true }))) return;
    onOpenChange(false);
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) { setError("Give the cycle a name."); nameRef.current?.focus(); return; }
    if (!start || !end) { setError("Pick when the cycle starts and closes."); return; }
    if (start > end) { setError("The cycle must close on or after the day it starts."); return; }
    if (audience === "DEPARTMENTS" && !deptIds.length) { setError("Pick at least one department."); return; }
    if (audience === "USERS" && !people.length) { setError("Pick at least one person."); return; }
    setBusy(true);
    setError(null);
    const r = await apiFetch<{ id: string; name: string }>("/api/reviews", {
      method: "POST",
      json: {
        name: trimmed,
        type,
        startDate: new Date(`${start}T00:00:00Z`).toISOString(),
        endDate: new Date(`${end}T23:59:59Z`).toISOString(),
        audienceType: orgWide ? audience : audience === "USERS" ? "USERS" : "ALL",
        departmentIds: audience === "DEPARTMENTS" ? deptIds : [],
        userIds: audience === "USERS" ? people.map((p) => p.id) : [],
      },
    });
    setBusy(false);
    if (!r.ok) { setError(r.error || "Couldn't create the cycle."); return; }
    onCreated({ id: r.data.id, name: r.data.name });
    onOpenChange(false);
  };

  const audienceOptions = orgWide
    ? [{ value: "ALL", label: "Everyone" }, { value: "DEPARTMENTS", label: "Departments" }, { value: "USERS", label: "Specific people" }]
    : [{ value: "ALL", label: "Everyone who reports to me" }, { value: "USERS", label: "Specific people who report to me" }];

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) void requestClose(); }}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>New cycle</DialogTitle>
          <DialogDescription>It starts as a draft. Nobody is asked for anything until you launch it.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => { e.preventDefault(); void submit(); }}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void submit(); } }}
        >
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-ink">Name</span>
            <input
              ref={nameRef}
              autoFocus
              value={name}
              maxLength={200}
              onChange={(e) => { setName(e.target.value); setTouchedName(true); }}
              className="h-9 rounded-md border border-line bg-raised px-3 text-row text-ink outline-none focus-visible:border-[var(--os-focus)]"
            />
          </label>
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-ink">Type</span>
            <PickerButton
              ariaLabel="Cycle type"
              label={CYCLE_TYPES.find((t) => t.value === type)?.label ?? type}
              selected={type}
              sections={[{ options: CYCLE_TYPES }]}
              onSelect={pickType}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-ink">Starts</span>
              <DateField value={start} onChange={(v) => setStart(v ?? "")} ariaLabel="Starts" allowClear={false} />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-ink">Closes</span>
              <DateField value={end} onChange={(v) => setEnd(v ?? "")} ariaLabel="Closes" allowClear={false} align="end" />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-ink">Covers</span>
            <PickerButton
              ariaLabel="Who the cycle covers"
              label={audienceOptions.find((o) => o.value === audience)?.label ?? "Everyone"}
              selected={audience}
              sections={[{ options: audienceOptions }]}
              onSelect={(v) => setAudience(v as Audience)}
            />
            {audience === "DEPARTMENTS" ? (
              <PickerButton
                ariaLabel="Departments"
                multi
                keepOpen
                label={deptIds.length ? depts.filter((d) => deptIds.includes(d.id)).map((d) => d.name).join(", ") : <span className="text-ink-3">Pick departments</span>}
                selected={deptIds}
                sections={[{ options: depts.map((d) => ({ value: d.id, label: d.name })) }]}
                onSelect={(id) => setDeptIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))}
                emptyLabel="No departments yet"
                className="mt-2"
              />
            ) : null}
            {audience === "USERS" ? (
              <div className="mt-2">
                <PeoplePickerField
                  ariaLabel="People"
                  multiple
                  value={people.map((p) => p.id)}
                  people={people}
                  placeholder="Pick people"
                  onChange={(_ids, picked) => setPeople(picked)}
                />
              </div>
            ) : null}
            <p className="m-0 text-xs text-ink-2">
              {orgWide
                ? "Launching creates a review for every active person it covers, with their manager as the reviewer."
                : "A cycle you start covers the people who report to you, directly or through someone else."}
            </p>
          </div>
          {error ? <p role="alert" className="m-0 text-sm text-danger-text">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => void requestClose()} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy} aria-busy={busy}>{busy ? "Creating" : "Create cycle"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
