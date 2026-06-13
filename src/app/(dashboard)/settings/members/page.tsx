"use client";

// Members — the people-governance surface. Lists everyone and lets an
// admin set each person's ACCESS LEVEL (this is the manager-side vs
// user-side assignment) and their REPORTING MANAGER (the hierarchy).
// Backed by GET /api/users (scope=all) + PATCH /api/users/[id] — both
// already exist; access-level changes are Company-Admin gated server-side
// (with last-admin protection), so non-admins see this read-only.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Search, Users, ShieldCheck } from "lucide-react";
import { useRole } from "@/hooks/use-role";
import { ACCESS_LEVELS, type AccessLevel } from "@/lib/permissions";

// Access levels that count as the "manager / admin side".
const MANAGER_SIDE = new Set<AccessLevel>([
  "SUPER_ADMIN", "COMPANY_ADMIN", "C_LEVEL", "VP", "DIRECTOR", "HR", "MANAGER", "TEAM_LEAD",
]);

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

  const [members, setMembers] = useState<Member[] | null>(null);
  const [q, setQ] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/users?scope=all&limit=500")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setMembers(((d?.data as Member[]) ?? [])))
      .catch(() => setMembers([]));
  }, []);
  useEffect(() => { load(); }, [load]);

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
      <header className="mb-1 flex items-center gap-2">
        <Users className="h-5 w-5 text-zinc-700" />
        <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-zinc-900">Members</h1>
      </header>
      <p className="mb-4 text-[13px] text-zinc-500">
        Set each person’s access level and who they report to.
        {canEdit ? "" : " You need Company Admin to make changes — this view is read-only."}
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1 text-[12px] text-zinc-700">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> {managerCount} managers &amp; admins
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1 text-[12px] text-zinc-700">
          <Users className="h-3.5 w-3.5 text-zinc-400" /> {memberCount} members
        </span>
        <div className="ml-auto inline-flex h-8 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2.5">
          <Search className="h-3.5 w-3.5 text-zinc-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search people…"
            className="w-48 bg-transparent text-[13px] text-zinc-800 outline-none placeholder:text-zinc-400"
          />
        </div>
      </div>

      {err ? (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">{err}</div>
      ) : null}

      {members === null ? (
        <div className="flex items-center gap-2 text-[13px] text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading members…
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-[11px] uppercase tracking-wide text-zinc-400">
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
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-200 text-[11px] font-semibold text-zinc-600">
                          {(m.firstName?.[0] ?? "?").toUpperCase()}
                        </span>
                      )}
                      <div className="min-w-0">
                        <div className="truncate font-medium text-zinc-900">{nameOf(m)}</div>
                        <div className="truncate text-[12px] text-zinc-500">{m.email ?? m.department?.name ?? ""}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={m.accessLevel}
                      disabled={!canEdit || savingId === m.id}
                      onChange={(e) => patch(m.id, { accessLevel: e.target.value })}
                      className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-[12.5px] text-zinc-800 disabled:opacity-60"
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
                      className="h-8 max-w-[200px] rounded-md border border-zinc-200 bg-white px-2 text-[12.5px] text-zinc-800 disabled:opacity-60"
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
                  <td colSpan={5} className="px-3 py-6 text-center text-[13px] text-zinc-400">
                    No people match “{q}”.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
      <div className="h-10" />
    </div>
  );
}
