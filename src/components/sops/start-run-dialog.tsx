"use client";

// StartRunDialog (spec-process section 2 `/sops/[id]` and `/process-runs`):
// the 560 modal that starts one execution of a Checklist SOP. Title
// prefilled "{SOP} · {date}", Assign to (a people Picker, with an "Anyone
// with the link" row that returns null; the retired "none" sentinel is gone),
// Due date, primary "Start run". With no `sop` given (Run history's Start
// run) a SOP picker limited to published Checklists comes first.

import { useEffect, useMemo, useState } from "react";
import { Play } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Picker, type PickerOption } from "@/components/ui/picker";
import { DateField } from "@/components/ui/date-field";
import { Dots } from "@/components/ui/dots";
import { PersonAvatar, type PersonRef } from "@/components/board-view/assignee-picker";
import { useOsToast } from "@/components/layout/os/toast";
import { useBoot } from "@/components/layout/os/boot-context";
import { apiFetch } from "@/lib/api-fetch";
import { useFormat } from "@/lib/format/use-date-prefs";

export interface StartedRun {
  id: string;
  title: string;
  shareToken: string | null;
  shareLink?: string;
}

const FIELD = "h-9 w-full rounded-md border border-line-strong bg-raised px-3 text-base text-ink placeholder:text-ink-3 focus:outline-none focus-visible:border-brand";
const LABEL = "text-sm font-medium text-ink-2";

function personName(p: PersonRef): string {
  return `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.email || "Unknown";
}

export function StartRunDialog({ open, onClose, sop, defaultAssigneeId, onStarted }: {
  open: boolean;
  onClose: () => void;
  /** The checklist to run; omit to show a SOP picker first. */
  sop?: { id: string; title: string } | null;
  /** Preselect the assignee (My SOPs presets to me). */
  defaultAssigneeId?: string | null;
  onStarted?: (run: StartedRun) => void;
}) {
  const { toast } = useOsToast();
  const fmt = useFormat();
  const { boot } = useBoot();
  const [sopId, setSopId] = useState<string | null>(sop?.id ?? null);
  const [sopTitle, setSopTitle] = useState<string>(sop?.title ?? "");
  const [sops, setSops] = useState<Array<{ id: string; title: string }> | null>(null);
  const [sopOpen, setSopOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [assigneeId, setAssigneeId] = useState<string | null>(defaultAssigneeId ?? null);
  const [people, setPeople] = useState<PersonRef[]>([]);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [dueDate, setDueDate] = useState("");
  const [busy, setBusy] = useState(false);

  // Reset per open (the Picker pattern: adopt during render, never in an effect).
  const [seenOpen, setSeenOpen] = useState(open);
  if (seenOpen !== open) {
    setSeenOpen(open);
    if (open) {
      setSopId(sop?.id ?? null);
      setSopTitle(sop?.title ?? "");
      setTitle("");
      setAssigneeId(defaultAssigneeId ?? null);
      setDueDate("");
    }
  }

  useEffect(() => {
    if (!open) return;
    let live = true;
    void (async () => {
      const p = await apiFetch<{ data?: PersonRef[] } | PersonRef[]>("/api/users?scope=all&limit=200", { cache: "no-store" });
      if (!live) return;
      const list = p.ok ? (Array.isArray(p.data) ? p.data : p.data?.data ?? []) : [];
      setPeople(list);
      if (!sop) {
        const s = await apiFetch<{ data: Array<{ id: string; title: string }> }>("/api/sops?view=published&kind=checklist&pageSize=100", { cache: "no-store" });
        if (!live) return;
        setSops(s.ok ? s.data.data : []);
      }
    })();
    return () => { live = false; };
  }, [open, sop]);

  const placeholder = useMemo(() => (sopTitle ? `${sopTitle} · ${fmt.date(new Date(), "date")}` : ""), [sopTitle, fmt]);
  const assignee = people.find((p) => p.id === assigneeId) ?? null;
  const peopleOptions: PickerOption[] = [
    { value: "__anyone__", label: "Anyone with the link", description: "No assignee; whoever opens the link runs it" },
    ...people.map((p) => ({ value: p.id, label: personName(p), description: p.email ?? undefined, glyph: <PersonAvatar person={p} size={20} /> })),
  ];

  async function start() {
    if (!sopId || busy) return;
    setBusy(true);
    const r = await apiFetch<StartedRun & { data?: StartedRun }>("/api/process-runs", {
      method: "POST",
      json: { sopId, title: title.trim() || placeholder, assigneeId, dueDate: dueDate || undefined },
    });
    setBusy(false);
    if (!r.ok) { toast(r.error || "Couldn't start the run", { tone: "danger" }); return; }
    const run = (r.data as { data?: StartedRun }).data ?? r.data;
    toast("Run started");
    onStarted?.(run);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-[560px]">
        <DialogTitle>Start run</DialogTitle>
        <DialogDescription>{sopTitle ? `Start a run of "${sopTitle}".` : "Pick a checklist SOP and who runs it."}</DialogDescription>
        <div className="mt-2 flex flex-col gap-4">
          {!sop ? (
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Checklist SOP</span>
              <span className="relative block">
                <button type="button" onClick={() => setSopOpen((o) => !o)} className={`${FIELD} flex items-center text-start`}>
                  <span className={sopTitle ? "" : "text-ink-3"}>{sopTitle || (sops === null ? "Loading checklists" : sops.length === 0 ? "No published checklists yet" : "Choose a checklist")}</span>
                </button>
                <Picker open={sopOpen} onClose={() => setSopOpen(false)} ariaLabel="Checklist SOP" searchPlaceholder="Find a checklist" selected={sopId}
                  onSelect={(v) => { setSopId(v); setSopTitle(sops?.find((s) => s.id === v)?.title ?? ""); setSopOpen(false); }}
                  sections={[{ options: (sops ?? []).map((s) => ({ value: s.id, label: s.title })) }]} width={320} />
              </span>
            </label>
          ) : null}
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={placeholder || "Run title"} className={FIELD} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Assign to</span>
            <span className="relative block">
              <button type="button" onClick={() => setPeopleOpen((o) => !o)} className={`${FIELD} flex items-center gap-2 text-start`}>
                {assignee ? <><PersonAvatar person={assignee} size={20} />{personName(assignee)}</> : <span className="text-ink-2">Anyone with the link</span>}
              </button>
              <Picker open={peopleOpen} onClose={() => setPeopleOpen(false)} ariaLabel="Assign to" searchPlaceholder="Find a person" selected={assigneeId ?? "__anyone__"}
                onSelect={(v) => { setAssigneeId(v === "__anyone__" ? null : v); setPeopleOpen(false); }} sections={[{ options: peopleOptions }]} width={320} />
            </span>
          </label>
          <div className="flex flex-col gap-1">
            <span className={LABEL}>Due date</span>
            <DateField value={dueDate || null} onChange={(v) => setDueDate(v ?? "")} placeholder="No due date" ariaLabel="Due date" />
          </div>
          <p className="text-sm text-ink-2">Anyone with the run link can open it, signed in or not. {boot.org.name} keeps the history here.</p>
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="inline-flex h-9 items-center rounded-md px-3 text-base font-medium text-ink-2 hover:bg-hover hover:text-ink">Cancel</button>
          <button type="button" onClick={() => void start()} disabled={busy || !sopId} className="inline-flex h-9 items-center gap-2 rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover disabled:bg-active disabled:text-ink-4">
            {busy ? <Dots variant="pending" /> : <Play className="h-4 w-4" strokeWidth={1.5} aria-hidden />}
            Start run
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
