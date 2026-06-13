"use client";

// Hierarchy — the org's reporting tree, built from User.managerId. A
// read view (editing "reports to" lives in Members); this is the visible
// "who reports to whom" the control center was missing. Built client-side
// from GET /api/users so it needs no new endpoint.

import { useEffect, useMemo, useState } from "react";
import { Loader2, ChevronRight, Network } from "lucide-react";
import Link from "next/link";
import { ACCESS_LEVELS, type AccessLevel } from "@/lib/permissions";

type U = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  avatar: string | null;
  accessLevel: AccessLevel;
  managerId: string | null;
  _count?: { directReports?: number };
};

const LABEL: Record<string, string> = Object.fromEntries(ACCESS_LEVELS.map((l) => [l.value, l.label]));
const nameOf = (m: { firstName: string | null; lastName: string | null }) =>
  `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim() || "Unnamed";

export default function HierarchyPage() {
  const [users, setUsers] = useState<U[] | null>(null);

  useEffect(() => {
    fetch("/api/users?scope=all&limit=500")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setUsers(((d?.data as U[]) ?? [])))
      .catch(() => setUsers([]));
  }, []);

  const { roots, childrenOf } = useMemo(() => {
    const list = users ?? [];
    const ids = new Set(list.map((u) => u.id));
    const childrenOf = new Map<string, U[]>();
    const roots: U[] = [];
    for (const u of list) {
      if (u.managerId && ids.has(u.managerId)) {
        const arr = childrenOf.get(u.managerId) ?? [];
        arr.push(u);
        childrenOf.set(u.managerId, arr);
      } else {
        roots.push(u);
      }
    }
    const sortFn = (a: U, b: U) => nameOf(a).localeCompare(nameOf(b));
    roots.sort(sortFn);
    childrenOf.forEach((arr) => arr.sort(sortFn));
    return { roots, childrenOf };
  }, [users]);

  return (
    <div className="px-6 pt-6">
      <header className="mb-1 flex items-center gap-2">
        <Network className="h-5 w-5 text-zinc-700" />
        <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-zinc-900">Hierarchy</h1>
      </header>
      <p className="mb-4 text-[13px] text-zinc-500">
        Your org’s reporting lines. Change who reports to whom in{" "}
        <Link href="/settings/members" className="text-zinc-700 underline underline-offset-2 hover:text-zinc-900">Members</Link>.
      </p>

      {users === null ? (
        <div className="flex items-center gap-2 text-[13px] text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading hierarchy…
        </div>
      ) : roots.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-white px-4 py-6 text-center text-[13px] text-zinc-400">
          No people yet.
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-200 bg-white p-1.5">
          {roots.map((r) => (
            <Node key={r.id} user={r} childrenOf={childrenOf} depth={0} />
          ))}
        </div>
      )}
      <div className="h-10" />
    </div>
  );
}

function Node({ user, childrenOf, depth }: { user: U; childrenOf: Map<string, U[]>; depth: number }) {
  const kids = childrenOf.get(user.id) ?? [];
  const [open, setOpen] = useState(depth < 2); // expand the top two levels by default

  return (
    <div>
      <div
        className="flex items-center gap-2 rounded-lg py-1.5 pr-2 hover:bg-zinc-50"
        style={{ paddingLeft: 8 + depth * 20 }}
      >
        {kids.length > 0 ? (
          <span
            role="button"
            tabIndex={0}
            onClick={() => setOpen((o) => !o)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((o) => !o); } }}
            aria-label={open ? "Collapse" : "Expand"}
            className="inline-flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center text-zinc-400 hover:text-zinc-700"
          >
            <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""}`} />
          </span>
        ) : (
          <span className="inline-block h-4 w-4 shrink-0" />
        )}
        {user.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.avatar} alt="" className="h-6 w-6 rounded-full object-cover" />
        ) : (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-[10px] font-semibold text-zinc-600">
            {(user.firstName?.[0] ?? "?").toUpperCase()}
          </span>
        )}
        <span className="truncate text-[13px] font-medium text-zinc-900">{nameOf(user)}</span>
        <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[10.5px] font-medium text-zinc-500">
          {LABEL[user.accessLevel] ?? user.accessLevel}
        </span>
        {kids.length > 0 ? (
          <span className="shrink-0 text-[11px] text-zinc-400">{kids.length} report{kids.length > 1 ? "s" : ""}</span>
        ) : null}
      </div>
      {open && kids.map((k) => <Node key={k.id} user={k} childrenOf={childrenOf} depth={depth + 1} />)}
    </div>
  );
}
