"use client";

// Members — the people-governance surface. Lists everyone and lets an
// admin set each person's ACCESS LEVEL (this is the manager-side vs
// user-side assignment) and their REPORTING MANAGER (the hierarchy).
// Backed by GET /api/users (scope=all) + PATCH /api/users/[id] — both
// already exist; access-level changes are Company-Admin gated server-side
// (with last-admin protection), so non-admins see this read-only.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Search, Users, ShieldCheck, UserPlus, MailX } from "lucide-react";
import { useRole } from "@/hooks/use-role";
import { ACCESS_LEVELS, type AccessLevel } from "@/lib/permissions";
import { InviteModal } from "@/components/layout/os/invite-modal";
import { useOsToast } from "@/components/layout/os/toast";

// Access levels that count as the "manager / admin side".
const MANAGER_SIDE = new Set<AccessLevel>([
  "SUPER_ADMIN", "COMPANY_ADMIN", "C_LEVEL", "VP", "DIRECTOR", "HR", "MANAGER", "TEAM_LEAD",
]);

type PendingInvite = {
  id: string;
  email: string;
  accessLevel: AccessLevel;
  accepted: boolean;
  createdAt: string;
  expiresAt: string;
};

// "3d ago" style stamp for the pending-invites table.
function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

type Member = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  avatar: string | null;
  accessLevel: AccessLevel;
  managerId: string | null;
  department: { id: string; name: string } | null;
  manager: { id: string; firstName: string | null; lastName: string | null } | null;
  _count?: { directReports?: number; kraAssignments?: number };
};

const nameOf = (m: { firstName: string | null; lastName: string | null }) =>
  `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim() || "Unnamed";

export default function MembersPage() {
  const { accessLevel } = useRole();
  const canEdit = accessLevel === "COMPANY_ADMIN" || accessLevel === "SUPER_ADMIN";
  const { toast } = useOsToast();

  const [members, setMembers] = useState<Member[] | null>(null);
  const [q, setQ] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/users?scope=all&limit=500")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setMembers(((d?.data as Member[]) ?? [])))
      .catch(() => setMembers([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const loadInvites = useCallback(() => {
    fetch("/api/invitations")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) =>
        setInvites(
          Array.isArray(d) ? (d as PendingInvite[]).filter((i) => !i.accepted) : [],
        ),
      )
      .catch(() => setInvites([]));
  }, []);
  useEffect(() => { loadInvites(); }, [loadInvites]);

  const revoke = async (inv: PendingInvite) => {
    setRevokingId(inv.id);
    try {
      const res = await fetch("/api/invitations", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: inv.id }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.error ?? "Revoke failed");
      }
      setInvites((prev) => prev.filter((i) => i.id !== inv.id));
      toast(`Invitation to ${inv.email} revoked`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Revoke failed");
    } finally {
      setRevokingId(null);
    }
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    setSavingId(id); setErr(null);
    setMembers((prev) => prev?.map((m) => (m.id === id ? { ...m, ...body } as Member : m)) ?? prev);
    try {
      const res = await fetch(`/api/users/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.error ?? "Update failed");
      }
      load(); // resync manager names + counts
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Update failed");
      load(); // revert optimistic on failure
    } finally {
      setSavingId(null);
    }
  };

  const filtered = useMemo(() => {
    const list = members ?? [];
    const s = q.trim().toLowerCase();
    if (!s) return list;
    return list.filter((m) =>
      `${m.firstName ?? ""} ${m.lastName ?? ""} ${m.email ?? ""}`.toLowerCase().includes(s),
    );
  }, [members, q]);

  const managerCount = (members ?? []).filter((m) => MANAGER_SIDE.has(m.accessLevel)).length;
  const memberCount = (members ?? []).length - managerCount;

  return (
    <div className="px-6 pt-6">
      <header className="mb-1 flex items-center justify-between">
        <h1 className="text-[16px] font-bold text-zinc-900">Members</h1>
        {canEdit ? (
          <button
            type="button"
            onClick={() => setInviteOpen(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-zinc-900 px-3 text-[13.5px] font-medium text-white hover:bg-zinc-800"
          >
            <UserPlus className="h-3.5 w-3.5" /> Invite
          </button>
        ) : null}
      </header>
      <p className="mb-4 text-[13px] text-zinc-500">
        Set each person’s access level and who they report to.
        {canEdit ? "" : " You need Company Admin to make changes — this view is read-only."}
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1 text-[13px] text-zinc-700">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> {managerCount} managers &amp; admins
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1 text-[13px] text-zinc-700">
          <Users className="h-3.5 w-3.5 text-zinc-400" /> {memberCount} members
        </span>
        <div className="ml-auto inline-flex h-8 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2.5">
          <Search className="h-3.5 w-3.5 text-zinc-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search people…"
            className="w-48 bg-transparent text-[14px] text-zinc-800 outline-none placeholder:text-zinc-400"
          />
        </div>
      </div>

      {err ? (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">{err}</div>
      ) : null}

      {members === null ? (
        <div className="flex items-center gap-2 text-[14px] text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading members…
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-[12px] uppercase tracking-wide text-zinc-400">
                <th className="px-3 py-2 font-semibold">Person</th>
                <th className="px-3 py-2 font-semibold">Access level</th>
                <th className="px-3 py-2 font-semibold">Reports to</th>
                <th className="px-3 py-2 text-center font-semibold">Reports</th>
                <th className="px-3 py-2 text-center font-semibold">KRAs</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => (
                <tr key={m.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50/60">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2.5">
                      {m.avatar ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.avatar} alt="" className="h-7 w-7 rounded-full object-cover" />
                      ) : (
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-200 text-[12px] font-semibold text-zinc-600">
                          {(m.firstName?.[0] ?? "?").toUpperCase()}
                        </span>
                      )}
                      <div className="min-w-0">
                        <div className="truncate font-medium text-zinc-900">{nameOf(m)}</div>
                        <div className="truncate text-[13px] text-zinc-500">{m.email ?? m.department?.name ?? ""}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={m.accessLevel}
                      disabled={!canEdit || savingId === m.id}
                      onChange={(e) => patch(m.id, { accessLevel: e.target.value })}
                      className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-[13.5px] text-zinc-800 disabled:opacity-60"
                    >
                      {ACCESS_LEVELS.map((l) => (
                        <option key={l.value} value={l.value}>{l.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={m.managerId ?? ""}
                      disabled={!canEdit || savingId === m.id}
                      onChange={(e) => patch(m.id, { managerId: e.target.value || null })}
                      className="h-8 max-w-[200px] rounded-md border border-zinc-200 bg-white px-2 text-[13.5px] text-zinc-800 disabled:opacity-60"
                    >
                      <option value="">— None —</option>
                      {(members ?? [])
                        .filter((o) => o.id !== m.id)
                        .map((o) => (
                          <option key={o.id} value={o.id}>{nameOf(o)}</option>
                        ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-center tabular-nums text-zinc-600">{m._count?.directReports ?? 0}</td>
                  <td className="px-3 py-2 text-center tabular-nums text-zinc-600">{m._count?.kraAssignments ?? 0}</td>
                </tr>
              ))}
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-[14px] text-zinc-400">
                    No people match “{q}”.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

      {invites.length > 0 ? (
        <section className="mt-6">
          <h2 className="mb-2 text-[14px] font-semibold text-zinc-900">
            Pending invites <span className="font-normal text-zinc-400">({invites.length})</span>
          </h2>
          <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-[12px] uppercase tracking-wide text-zinc-400">
                  <th className="px-3 py-2 font-semibold">Email</th>
                  <th className="px-3 py-2 font-semibold">Access level</th>
                  <th className="px-3 py-2 font-semibold">Invited</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  {canEdit ? <th className="px-3 py-2" /> : null}
                </tr>
              </thead>
              <tbody>
                {invites.map((inv) => {
                  const expired = new Date(inv.expiresAt).getTime() < Date.now();
                  return (
                    <tr key={inv.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50/60">
                      <td className="px-3 py-2 font-medium text-zinc-900">{inv.email}</td>
                      <td className="px-3 py-2 text-zinc-600">
                        {ACCESS_LEVELS.find((l) => l.value === inv.accessLevel)?.label ?? inv.accessLevel}
                      </td>
                      <td className="px-3 py-2 text-zinc-600">{timeAgo(inv.createdAt)}</td>
                      <td className="px-3 py-2">
                        {expired ? (
                          <span className="inline-flex rounded-full bg-red-50 px-2 py-0.5 text-[12.5px] font-medium text-red-700 dark:bg-red-500/15 dark:text-red-400">
                            Expired
                          </span>
                        ) : (
                          <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[12.5px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                            Pending
                          </span>
                        )}
                      </td>
                      {canEdit ? (
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => void revoke(inv)}
                            disabled={revokingId === inv.id}
                            className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[13px] font-medium text-zinc-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-500/15 dark:hover:text-red-400"
                          >
                            {revokingId === inv.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <MailX className="h-3.5 w-3.5" />
                            )}
                            Revoke
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <InviteModal open={inviteOpen} onOpenChange={setInviteOpen} onSent={loadInvites} />
      <div className="h-10" />
    </div>
  );
}
