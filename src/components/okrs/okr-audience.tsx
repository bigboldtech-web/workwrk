"use client";

// OkrAudience — the goal detail's audience strip: resolved-members avatar
// stack (+N overflow) plus, for editors, the same mixed people/departments/
// roles picker used at create time. Edits go through
// POST/DELETE /api/okrs/[id]/assignees; every response returns the fresh
// resolved summary, so the stack always reflects read-time membership.

import { useState } from "react";
import {
  GoalAudiencePicker,
  MemberAvatarStack,
  type AudienceEntry,
  type AudienceMember,
} from "@/components/okrs/goal-audience-picker";

interface AudienceResponse {
  entries?: AudienceEntry[];
  audience?: { members: AudienceMember[]; totalMembers: number };
}

interface OkrAudienceProps {
  okrId: string;
  canEdit: boolean;
  initialEntries: AudienceEntry[];
  initialMembers: AudienceMember[];
  initialTotal: number;
}

export function OkrAudience({ okrId, canEdit, initialEntries, initialMembers, initialTotal }: OkrAudienceProps) {
  const [entries, setEntries] = useState<AudienceEntry[]>(initialEntries);
  const [members, setMembers] = useState<AudienceMember[]>(initialMembers);
  const [total, setTotal] = useState(initialTotal);
  const [error, setError] = useState<string | null>(null);

  async function apply(next: AudienceEntry[]) {
    const prev = entries;
    const key = (e: AudienceEntry) => `${e.type}:${e.id}`;
    const prevKeys = new Set(prev.map(key));
    const nextKeys = new Set(next.map(key));
    const added = next.filter((e) => !prevKeys.has(key(e)));
    const removed = prev.filter((e) => !nextKeys.has(key(e)));
    if (added.length === 0 && removed.length === 0) return;

    setEntries(next); // optimistic — reverted if either request fails
    setError(null);
    try {
      let latest: AudienceResponse | null = null;
      if (added.length > 0) {
        const res = await fetch(`/api/okrs/${okrId}/assignees`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assignees: added.map((e) => ({ type: e.type, id: e.id })) }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Couldn't add assignees");
        latest = await res.json();
      }
      if (removed.length > 0) {
        const res = await fetch(`/api/okrs/${okrId}/assignees`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assignees: removed.map((e) => ({ type: e.type, id: e.id })) }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Couldn't remove assignees");
        latest = await res.json();
      }
      if (latest?.entries) setEntries(latest.entries);
      if (latest?.audience) {
        setMembers(latest.audience.members);
        setTotal(latest.audience.totalMembers);
      }
    } catch (e) {
      setEntries(prev); // never leave the UI claiming a save that failed
      setError(e instanceof Error ? e.message : "Saving the audience failed");
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <MemberAvatarStack members={members} total={total} size={22} />
      {total > 0 && (
        <span className="text-[12px] text-zinc-500">
          {total} member{total === 1 ? "" : "s"}
        </span>
      )}
      {canEdit ? (
        <div className="min-w-[220px] max-w-[320px] flex-1">
          <GoalAudiencePicker value={entries} onChange={(next) => void apply(next)} />
        </div>
      ) : null}
      {error && <span className="text-[12px] text-[#E2445C]">{error}</span>}
    </div>
  );
}
