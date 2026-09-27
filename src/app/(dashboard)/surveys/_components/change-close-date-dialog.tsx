"use client";

// Change close date (spec-teams-performance /surveys, the 400 modal): what an
// Open survey gets instead of Edit, because its questions are fixed the
// moment people answer. A date Picker, and "Also send a reminder now" for the
// people who have not answered.

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { Switch } from "@/components/ui/switch";
import { useOsToast } from "@/components/layout/os/toast";
import { apiFetch } from "@/lib/api-fetch";

export function ChangeCloseDateDialog({ surveyId, title, closesAt, onClose, onSaved }: { surveyId: string; title: string; closesAt: string | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useOsToast();
  const [date, setDate] = useState<string | null>(closesAt ? closesAt.slice(0, 10) : null);
  const [remind, setRemind] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setErr(null);
    const r = await apiFetch(`/api/pulse-surveys/${surveyId}`, { method: "PATCH", json: { closesAt: date ? new Date(`${date}T23:59:59`).toISOString() : null, remind } });
    setBusy(false);
    if (!r.ok) { setErr(r.error || "Couldn't change the date"); return; }
    toast(remind ? "Close date changed and a reminder sent" : "Close date changed");
    onSaved();
  };
  return (
    <Dialog open onOpenChange={(v) => { if (!v && !busy) onClose(); }}>
      <DialogContent className="max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Change close date</DialogTitle>
          <DialogDescription>{title}. The questions stay as they are.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-ink">Closes on</span>
          <DateField value={date} onChange={setDate} ariaLabel="Closes on" placeholder="No close date" />
        </div>
        <label className="flex items-center gap-3 text-sm text-ink">
          <Switch checked={remind} onChange={setRemind} aria-label="Also send a reminder now" />
          Also send a reminder now
        </label>
        {err ? <p role="alert" className="m-0 text-sm text-danger-text">{err}</p> : null}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy}>{busy ? "Saving" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
