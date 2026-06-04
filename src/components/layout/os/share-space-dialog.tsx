"use client";

// ShareSpaceDialog — manage a Space's visibility + members.
//
//   Header row: visibility selector (Private / Workspace / Org)
//   Search-to-add row: type → matches /api/users → click to add as MEMBER
//   Members list: avatar + name + role dropdown + remove
//
// All mutations hit existing routes: PATCH /api/spaces/[id] (visibility),
// POST /api/spaces/[id]/members (add or upsert role),
// DELETE /api/spaces/[id]/members?userId=…

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Search, X, Lock, Globe, Users as UsersIcon, Loader2, Plus, Building2, MapPin, UserPlus } from "lucide-react";
import { useOsToast } from "./toast";

type Visibility = "PRIVATE" | "WORKSPACE" | "ORG";
type SpaceRole = "OWNER" | "ADMIN" | "MEMBER" | "GUEST";

interface UserOption {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email: string;
  avatar?: string | null;
  departmentId?: string | null;
  officeId?: string | null;
}

interface GroupRow {
  id: string;
  name: string;
  memberCount: number;
}

type PickerTab = "people" | "departments" | "offices";

interface Member {
  id: string;
  role: SpaceRole;
  user: UserOption;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  spaceId: string | null;
  spaceName: string;
  initialVisibility: Visibility;
  onChanged?: () => void;
}

const VISIBILITY_OPTIONS: { value: Visibility; label: string; blurb: string; Icon: typeof Lock }[] = [
  { value: "PRIVATE", label: "Private", blurb: "Only invited members", Icon: Lock },
  { value: "WORKSPACE", label: "Workspace", blurb: "Members + org admins", Icon: UsersIcon },
  { value: "ORG", label: "Org-wide", blurb: "Every member of the org", Icon: Globe },
];

const ROLE_OPTIONS: { value: SpaceRole; label: string }[] = [
  { value: "OWNER", label: "Owner" },
  { value: "ADMIN", label: "Admin" },
  { value: "MEMBER", label: "Member" },
  { value: "GUEST", label: "Guest" },
];

function displayName(u: UserOption): string {
  const full = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return full || u.email;
}

function avatarInitials(u: UserOption): string {
  return ((u.firstName?.[0] ?? "") + (u.lastName?.[0] ?? "")).toUpperCase() || u.email[0]?.toUpperCase() || "?";
}

export function ShareSpaceDialog({
  open,
  onOpenChange,
  spaceId,
  spaceName,
  initialVisibility,
  onChanged,
}: Props) {
  const { toast } = useOsToast();
  const [visibility, setVisibility] = useState<Visibility>(initialVisibility);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [query, setQuery] = useState("");
  const [busyVis, setBusyVis] = useState(false);
  const [busyRoleId, setBusyRoleId] = useState<string | null>(null);
  const [busyRemoveId, setBusyRemoveId] = useState<string | null>(null);
  const [busyAddId, setBusyAddId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<PickerTab>("people");
  const [departments, setDepartments] = useState<GroupRow[] | null>(null);
  const [offices, setOffices] = useState<GroupRow[] | null>(null);
  const [busyGroupId, setBusyGroupId] = useState<string | null>(null);
  const [bulkResult, setBulkResult] = useState<{ added: number; skipped: number } | null>(null);

  const reset = useCallback(() => {
    setMembers(null);
    setUsers([]);
    setQuery("");
    setPickerOpen(false);
    setBusyVis(false);
    setBusyRoleId(null);
    setBusyRemoveId(null);
    setBusyAddId(null);
    setTab("people");
    setDepartments(null);
    setOffices(null);
    setBusyGroupId(null);
    setBulkResult(null);
  }, []);

  const handleOpen = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  // Keep visibility in sync if caller re-opens with a different space.
  useEffect(() => {
    if (open) setVisibility(initialVisibility);
  }, [open, initialVisibility]);

  // Fetch members + users when the dialog opens.
  useEffect(() => {
    if (!open || !spaceId) return;
    let active = true;
    fetch(`/api/spaces/${spaceId}/members`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!active || !data) return;
        setMembers(Array.isArray(data.members) ? data.members : []);
      })
      .catch(() => { if (active) setMembers([]); });
    fetch("/api/users?scope=all&limit=200")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!active || !data) return;
        setUsers(Array.isArray(data?.data) ? data.data : []);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [open, spaceId]);

  // Lazy-fetch groups when their tab is first opened.
  useEffect(() => {
    if (!open) return;
    if (tab === "departments" && departments === null) {
      let active = true;
      fetch("/api/departments")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!active || !Array.isArray(data)) return;
          setDepartments(
            data.map((d: { id: string; name: string; _count?: { members?: number } }) => ({
              id: d.id,
              name: d.name,
              memberCount: d._count?.members ?? 0,
            })),
          );
        })
        .catch(() => { if (active) setDepartments([]); });
      return () => { active = false; };
    }
    if (tab === "offices" && offices === null) {
      let active = true;
      fetch("/api/offices")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!active || !Array.isArray(data)) return;
          // Office count comes from joining against users client-side
          // (the GET /api/offices payload doesn't include _count).
          setOffices(
            data.map((o: { id: string; name: string }) => ({
              id: o.id,
              name: o.name,
              memberCount: users.filter((u) => u.officeId === o.id).length,
            })),
          );
        })
        .catch(() => { if (active) setOffices([]); });
      return () => { active = false; };
    }
  }, [open, tab, departments, offices, users]);

  // Picker close on outside click.
  useEffect(() => {
    if (!pickerOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!pickerRef.current?.contains(e.target as Node)) setPickerOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [pickerOpen]);

  const memberIds = useMemo(() => new Set((members ?? []).map((m) => m.user.id)), [members]);
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users
      .filter((u) => !memberIds.has(u.id))
      .filter((u) => {
        if (!q) return true;
        if (u.email.toLowerCase().includes(q)) return true;
        if (displayName(u).toLowerCase().includes(q)) return true;
        return false;
      })
      .slice(0, 10);
  }, [users, memberIds, query]);

  const setVis = async (next: Visibility) => {
    if (!spaceId || next === visibility) return;
    setBusyVis(true);
    try {
      const res = await fetch(`/api/spaces/${spaceId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ visibility: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data?.error ?? "Could not update visibility");
        return;
      }
      setVisibility(next);
      onChanged?.();
    } finally {
      setBusyVis(false);
    }
  };

  const addMember = async (user: UserOption) => {
    if (!spaceId) return;
    setBusyAddId(user.id);
    try {
      const res = await fetch(`/api/spaces/${spaceId}/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: user.id, role: "MEMBER" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data?.error ?? "Could not add member");
        return;
      }
      const data = await res.json();
      const m: Member = data.member?.user
        ? data.member
        : { id: data.member?.id ?? user.id, role: "MEMBER", user };
      setMembers((prev) => [...(prev ?? []), m]);
      setQuery("");
      setPickerOpen(false);
      onChanged?.();
    } finally {
      setBusyAddId(null);
    }
  };

  const addGroup = async (kind: "department" | "office", group: GroupRow) => {
    if (!spaceId) return;
    const targets = users.filter((u) =>
      kind === "department" ? u.departmentId === group.id : u.officeId === group.id,
    );
    const newOnes = targets.filter((u) => !memberIds.has(u.id));
    if (newOnes.length === 0) {
      setBulkResult({ added: 0, skipped: targets.length });
      toast(`Everyone in ${group.name} is already in this Space`);
      return;
    }
    setBusyGroupId(group.id);
    setBulkResult(null);
    try {
      const results = await Promise.allSettled(
        newOnes.map((u) =>
          fetch(`/api/spaces/${spaceId}/members`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ userId: u.id, role: "MEMBER" }),
          }).then((r) => (r.ok ? r.json() : Promise.reject(r))),
        ),
      );
      const added: Member[] = [];
      let failures = 0;
      results.forEach((r, i) => {
        if (r.status === "fulfilled") {
          const u = newOnes[i];
          added.push(
            r.value?.member?.user
              ? r.value.member
              : { id: r.value?.member?.id ?? u.id, role: "MEMBER", user: u },
          );
        } else {
          failures++;
        }
      });
      if (added.length > 0) {
        setMembers((prev) => [...(prev ?? []), ...added]);
        onChanged?.();
      }
      setBulkResult({ added: added.length, skipped: targets.length - newOnes.length });
      if (failures > 0) toast(`${failures} member${failures === 1 ? "" : "s"} couldn't be added`);
    } finally {
      setBusyGroupId(null);
    }
  };

  const changeRole = async (m: Member, role: SpaceRole) => {
    if (!spaceId || role === m.role) return;
    setBusyRoleId(m.user.id);
    try {
      const res = await fetch(`/api/spaces/${spaceId}/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: m.user.id, role }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data?.error ?? "Could not update role");
        return;
      }
      setMembers((prev) => (prev ?? []).map((x) => (x.user.id === m.user.id ? { ...x, role } : x)));
      onChanged?.();
    } finally {
      setBusyRoleId(null);
    }
  };

  const removeMember = async (m: Member) => {
    if (!spaceId) return;
    if (!window.confirm(`Remove ${displayName(m.user)} from this Space?`)) return;
    setBusyRemoveId(m.user.id);
    try {
      const res = await fetch(`/api/spaces/${spaceId}/members?userId=${m.user.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data?.error ?? "Could not remove member");
        return;
      }
      setMembers((prev) => (prev ?? []).filter((x) => x.user.id !== m.user.id));
      onChanged?.();
    } finally {
      setBusyRemoveId(null);
    }
  };

  if (!spaceId) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="max-w-[520px] p-0 gap-0">
        <div className="px-6 pt-6 pb-3">
          <DialogTitle className="text-[16px] font-semibold">Share {spaceName}</DialogTitle>
          <DialogDescription className="mt-1">
            Decide who can see this Space and what they can do.
          </DialogDescription>
        </div>

        {/* Visibility selector */}
        <div className="px-6 pb-3">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500 font-semibold mb-2">
            Visibility
          </div>
          <div className="grid grid-cols-3 gap-2">
            {VISIBILITY_OPTIONS.map((opt) => {
              const active = visibility === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setVis(opt.value)}
                  disabled={busyVis}
                  className={`text-left rounded-lg border bg-white p-2.5 transition ${
                    active ? "border-zinc-900 ring-1 ring-zinc-900" : "border-zinc-200 hover:bg-zinc-50"
                  } disabled:opacity-60`}
                >
                  <div className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold">
                    <opt.Icon className="h-3.5 w-3.5" />
                    {opt.label}
                  </div>
                  <div className="text-[11px] text-zinc-500 mt-0.5 leading-snug">{opt.blurb}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Add member — tabbed picker (People / Departments / Offices) */}
        <div className="px-6 pb-3 border-t border-zinc-100 pt-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] uppercase tracking-wide text-zinc-500 font-semibold">
              Add people
            </div>
            <div className="inline-flex items-center rounded-md border border-zinc-200 overflow-hidden text-[11px]">
              <PickerTabBtn active={tab === "people"} onClick={() => setTab("people")}>
                <UserPlus className="h-3 w-3" /> People
              </PickerTabBtn>
              <PickerTabBtn active={tab === "departments"} onClick={() => setTab("departments")}>
                <Building2 className="h-3 w-3" /> Departments
              </PickerTabBtn>
              <PickerTabBtn active={tab === "offices"} onClick={() => setTab("offices")}>
                <MapPin className="h-3 w-3" /> Offices
              </PickerTabBtn>
            </div>
          </div>

          {tab === "people" ? (
            <div className="relative" ref={pickerRef}>
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setPickerOpen(true); }}
                onFocus={() => setPickerOpen(true)}
                placeholder="Type a name or email…"
                className="w-full h-9 pl-8 pr-2 rounded-md border border-zinc-200 bg-white text-[13px] focus:outline-none focus:border-zinc-400"
              />
              {pickerOpen ? (
                <div className="absolute left-0 right-0 top-10 z-10 rounded-md border border-zinc-200 bg-white shadow-lg max-h-[220px] overflow-y-auto">
                  {candidates.length === 0 ? (
                    <div className="px-3 py-3 text-[12px] text-zinc-400">
                      {query ? `No match for "${query}"` : "Start typing to find people"}
                    </div>
                  ) : (
                    candidates.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => addMember(u)}
                        disabled={busyAddId === u.id}
                        className="w-full text-left px-2.5 py-1.5 flex items-center gap-2 hover:bg-zinc-50 disabled:opacity-60"
                      >
                        <Avatar user={u} />
                        <span className="flex-1 min-w-0">
                          <span className="block text-[12.5px] font-medium truncate">{displayName(u)}</span>
                          <span className="block text-[11px] text-zinc-500 truncate">{u.email}</span>
                        </span>
                        {busyAddId === u.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" />
                        ) : (
                          <Plus className="h-3.5 w-3.5 text-zinc-400" />
                        )}
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>
          ) : null}

          {tab === "departments" ? (
            <GroupPickerList
              kind="department"
              groups={departments}
              busyGroupId={busyGroupId}
              onAdd={(g) => addGroup("department", g)}
              EmptyIcon={Building2}
              emptyLabel="No departments configured yet"
            />
          ) : null}

          {tab === "offices" ? (
            <GroupPickerList
              kind="office"
              groups={offices}
              busyGroupId={busyGroupId}
              onAdd={(g) => addGroup("office", g)}
              EmptyIcon={MapPin}
              emptyLabel="No offices configured yet"
            />
          ) : null}

          {bulkResult ? (
            <div className="mt-2 text-[11.5px] text-zinc-500">
              Added {bulkResult.added} · skipped {bulkResult.skipped} already in this Space
            </div>
          ) : null}
        </div>

        {/* Members list */}
        <div className="px-6 pb-5 border-t border-zinc-100 pt-4">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500 font-semibold mb-2">
            {members === null ? "Members" : `Members · ${members.length}`}
          </div>
          {members === null ? (
            <div className="text-[12px] text-zinc-400">Loading…</div>
          ) : members.length === 0 ? (
            <div className="text-[12px] text-zinc-400">No members yet. Add someone above.</div>
          ) : (
            <ul className="rounded-lg border border-zinc-200 divide-y divide-zinc-100 max-h-[260px] overflow-y-auto">
              {members.map((m) => {
                const busy = busyRoleId === m.user.id || busyRemoveId === m.user.id;
                return (
                  <li key={m.user.id} className="flex items-center gap-2.5 px-3 py-2">
                    <Avatar user={m.user} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-[12.5px] font-medium truncate">{displayName(m.user)}</span>
                      <span className="block text-[11px] text-zinc-500 truncate">{m.user.email}</span>
                    </span>
                    <select
                      value={m.role}
                      onChange={(e) => changeRole(m, e.target.value as SpaceRole)}
                      disabled={busy}
                      className="h-7 px-1.5 rounded-md border border-zinc-200 bg-white text-[11.5px] focus:outline-none focus:border-zinc-400"
                    >
                      {ROLE_OPTIONS.map((r) => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => removeMember(m)}
                      disabled={busy}
                      className="h-7 w-7 rounded hover:bg-red-50 inline-flex items-center justify-center text-zinc-400 hover:text-red-500 disabled:opacity-50"
                      aria-label="Remove member"
                    >
                      {busyRemoveId === m.user.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <X className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Avatar({ user }: { user: UserOption }) {
  return (
    <span className="h-6 w-6 rounded-full bg-zinc-100 border border-zinc-200 inline-flex items-center justify-center text-[10px] font-semibold text-zinc-600 shrink-0">
      {avatarInitials(user)}
    </span>
  );
}

function PickerTabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2 py-1 inline-flex items-center gap-1 transition-colors ${
        active ? "bg-zinc-900 text-white" : "bg-white text-zinc-600 hover:bg-zinc-50"
      }`}
    >
      {children}
    </button>
  );
}

function GroupPickerList({
  kind,
  groups,
  busyGroupId,
  onAdd,
  EmptyIcon,
  emptyLabel,
}: {
  kind: "department" | "office";
  groups: GroupRow[] | null;
  busyGroupId: string | null;
  onAdd: (g: GroupRow) => void;
  EmptyIcon: typeof Building2;
  emptyLabel: string;
}) {
  if (groups === null) {
    return <div className="text-[12px] text-zinc-400 py-3 text-center">Loading {kind === "department" ? "departments" : "offices"}…</div>;
  }
  if (groups.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-zinc-200 px-4 py-6 text-center">
        <EmptyIcon className="h-5 w-5 text-zinc-300 mx-auto mb-1.5" />
        <div className="text-[12px] text-zinc-500">{emptyLabel}</div>
      </div>
    );
  }
  return (
    <ul className="rounded-md border border-zinc-200 divide-y divide-zinc-100 max-h-[240px] overflow-y-auto">
      {groups.map((g) => {
        const busy = busyGroupId === g.id;
        return (
          <li key={g.id} className="flex items-center gap-2.5 px-3 py-2">
            <span className="h-6 w-6 rounded-md bg-zinc-100 inline-flex items-center justify-center shrink-0">
              {kind === "department" ? (
                <Building2 className="h-3 w-3 text-zinc-500" />
              ) : (
                <MapPin className="h-3 w-3 text-zinc-500" />
              )}
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-[12.5px] font-medium text-zinc-900 truncate">{g.name}</span>
              <span className="block text-[11px] text-zinc-500">
                {g.memberCount} {g.memberCount === 1 ? "person" : "people"}
              </span>
            </span>
            <button
              type="button"
              onClick={() => onAdd(g)}
              disabled={busy || g.memberCount === 0}
              className="h-7 px-2.5 rounded-md bg-zinc-900 text-white text-[11.5px] font-medium hover:bg-zinc-800 disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              Add all
            </button>
          </li>
        );
      })}
    </ul>
  );
}
