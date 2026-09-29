"use client";

// Who can see this record (access 6.1): the read-only answer for one
// person's record, every viewer's to open from the record's "..." menu.
// Everyone in the workspace sees the card; the groups below read the
// people data too, each with the reason. Nothing here writes.

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SkeletonRows } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api-fetch";
import { PersonAvatar, personName, type PickPerson } from "./person-bits";

interface Group { key: string; label: string; people: Array<Omit<PickPerson, "email">>; total: number }
interface Answer { subject: Omit<PickPerson, "email">; groups: Group[] }

export function RecordAccessDialog({ userId, onClose }: { userId: string; onClose: () => void }) {
  const [data, setData] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void apiFetch<Answer>(`/api/users/${userId}/record-access`, { cache: "no-store" }).then((r) => {
      if (!live) return;
      if (r.ok) setData(r.data); else setError(r.error || "Couldn't load who can see this record");
    });
    return () => { live = false; };
  }, [userId]);
  const shown = (data?.groups ?? []).filter((g) => g.total > 0);
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Who can see this record</DialogTitle>
          <DialogDescription>
            Everyone in the workspace sees the card: name, photo, job title, department, office, manager and email.
            These people also see the phone, birthday, KRAs and KPIs, goals, reviews and skill ratings.
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
          {error ? <p role="alert" className="text-sm text-danger-text">{error}</p> : null}
          {!data && !error ? <SkeletonRows rows={5} rowHeight="36px" /> : null}
          {data ? (
            <section>
              <h3 className="mb-1 text-sm font-medium text-ink-2">The person</h3>
              <ul><PersonLine person={data.subject} /></ul>
            </section>
          ) : null}
          {shown.map((g) => (
            <section key={g.key}>
              <h3 className="mb-1 text-sm font-medium text-ink-2">{g.label} <span className="tabular-nums">{g.total}</span></h3>
              <ul>
                {g.people.map((p) => <PersonLine key={p.id} person={p} />)}
              </ul>
              {g.total > g.people.length ? <p className="px-1 text-sm text-ink-2">and {g.total - g.people.length} more</p> : null}
            </section>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PersonLine({ person }: { person: Omit<PickPerson, "email"> }) {
  const p = { ...person, email: null } as PickPerson;
  return (
    <li className="flex min-h-9 items-center gap-2 px-1">
      <PersonAvatar person={p} size={24} />
      <span className="truncate text-row text-ink">{personName(p)}</span>
    </li>
  );
}
