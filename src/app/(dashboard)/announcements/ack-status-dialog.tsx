"use client";

/* "Who has / hasn't acknowledged" — admin view for a must-acknowledge
 * announcement.
 *
 * Reads GET /api/announcements/[id]/acknowledge, which is manager-gated
 * and org-scoped server-side (returns the org roster minus the author,
 * each row carrying acknowledgedAt when present). Announcements are NOT
 * anonymous, so naming who acked is the model's intended behavior.
 * The pending list mirrors the notify fan-out (org-wide) — audience
 * targeting is not yet enforced anywhere.
 */

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Clock, Loader2, Users } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";

type RosterRow = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  avatar: string | null;
  acknowledgedAt: string | null;
};

type AckStatus = {
  mustAcknowledge: boolean;
  roster: RosterRow[];
  acknowledgedCount: number;
  totalCount: number;
};

function fullName(u: RosterRow): string {
  const n = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim();
  return n || u.email;
}
function initials(u: RosterRow): string {
  const a = (u.firstName ?? u.email)[0] ?? "?";
  const b = (u.lastName ?? "")[0] ?? "";
  return `${a}${b}`.toUpperCase();
}
function ackedWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export function AckStatusDialog({
  announcementId,
  title,
  onClose,
}: {
  announcementId: string;
  title: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<AckStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/announcements/${announcementId}/acknowledge`);
      if (!res.ok) throw new Error(res.status === 403 ? "Manager access required." : `Couldn't load (HTTP ${res.status}).`);
      const json = (await res.json()) as AckStatus;
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Network error — couldn't load.");
    }
  }, [announcementId]);

  useEffect(() => { void load(); }, [load]);

  const acked = (data?.roster ?? []).filter((u) => u.acknowledgedAt);
  const pending = (data?.roster ?? []).filter((u) => !u.acknowledgedAt);
  const pct = data && data.totalCount > 0 ? Math.round((data.acknowledgedCount / data.totalCount) * 100) : 0;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="workwrk-os os-portal-panel max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Acknowledgment status</DialogTitle>
          <DialogDescription>{title}</DialogDescription>
        </DialogHeader>

        {error ? (
          <div className="py-8 text-center text-[13px] text-[var(--os-c-red)]">{error}</div>
        ) : data === null ? (
          <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-[var(--os-ink-3)]">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="flex flex-col gap-4 py-1">
            {/* Summary */}
            <div className="flex flex-col gap-2 rounded-lg border border-[var(--os-line)] p-3">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-[13px] text-[var(--os-ink-2)]">
                  <Users className="w-3.5 h-3.5" /> Organization-wide
                </span>
                <span className="text-[13px] font-semibold text-[var(--os-ink)]">
                  {data.acknowledgedCount} / {data.totalCount} acknowledged
                </span>
              </div>
              <div className="h-2 rounded-full bg-[var(--os-surface-2)] overflow-hidden">
                <div className="h-full rounded-full bg-[var(--os-brand)]" style={{ width: `${pct}%` }} />
              </div>
            </div>

            {/* Acknowledged */}
            <section className="flex flex-col gap-1.5">
              <h4 className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--os-ink-2)]">
                <CheckCircle2 className="w-3.5 h-3.5 text-[var(--os-c-green)]" /> Acknowledged
                <span className="text-[var(--os-ink-3)] font-normal">{acked.length}</span>
              </h4>
              {acked.length === 0 ? (
                <p className="text-[12.5px] text-[var(--os-ink-3)] px-0.5">No one has acknowledged yet.</p>
              ) : (
                <ul className="flex flex-col gap-1 max-h-[180px] overflow-y-auto">
                  {acked.map((u) => (
                    <li key={u.id} className="flex items-center gap-2.5 rounded-lg px-1.5 py-1">
                      <Initials u={u} />
                      <span className="flex-1 min-w-0">
                        <span className="block text-[13px] text-[var(--os-ink)] truncate">{fullName(u)}</span>
                        <span className="block text-[11.5px] text-[var(--os-ink-3)] truncate">{u.email}</span>
                      </span>
                      <span className="inline-flex items-center gap-1 text-[11.5px] text-[var(--os-ink-3)] shrink-0">
                        <Clock className="w-3 h-3" /> {ackedWhen(u.acknowledgedAt!)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Pending */}
            <section className="flex flex-col gap-1.5">
              <h4 className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--os-ink-2)]">
                <Clock className="w-3.5 h-3.5 text-[var(--os-c-orange)]" /> Pending
                <span className="text-[var(--os-ink-3)] font-normal">{pending.length}</span>
              </h4>
              {pending.length === 0 ? (
                <p className="text-[12.5px] text-[var(--os-ink-3)] px-0.5">Everyone has acknowledged. 🎉</p>
              ) : (
                <ul className="flex flex-col gap-1 max-h-[180px] overflow-y-auto">
                  {pending.map((u) => (
                    <li key={u.id} className="flex items-center gap-2.5 rounded-lg px-1.5 py-1">
                      <Initials u={u} />
                      <span className="flex-1 min-w-0">
                        <span className="block text-[13px] text-[var(--os-ink)] truncate">{fullName(u)}</span>
                        <span className="block text-[11.5px] text-[var(--os-ink-3)] truncate">{u.email}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Initials({ u }: { u: RosterRow }) {
  return (
    <span
      className="inline-flex items-center justify-center w-7 h-7 rounded-full shrink-0 text-[10.5px] font-semibold text-[var(--os-ink-2)] bg-[var(--os-surface-2)]"
      aria-hidden="true"
    >
      {initials(u)}
    </span>
  );
}
