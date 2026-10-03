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
//
// THE PIECES THE ONE MANAGE ACCESS DIALOG COMPOSES live here too, defined in
// this file so everything a Space's sharing does stays in one place:
// SpaceVisibilityControl (the tri-state), SpaceDepartmentAdd and
// SpaceOfficeAdd (bulk add, one person at a time through the grants route the
// dialog hands them, never lowering a role) and SpaceEmailInvites (the email
// invitations with their pending list, resend and revoke). The dialog above
// is kept, exported and working; nothing mounts it any more.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Search, X, Lock, Globe, Users as UsersIcon, Plus, Building2, MapPin, UserPlus, Mail, Copy, Check, Send, Trash2, RotateCw } from "lucide-react";
import { useOsToast } from "./toast";
import { useConfirm } from "@/components/ui/dialog-provider";
import { SkeletonLines } from "@/components/ui/skeleton";
import { Dots } from "@/components/ui/dots";
import { panelRoleLabel, type PanelRole } from "@/lib/access/access-panel";
import { generalErrorText } from "@/components/access/manage-access-model";

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

type PickerTab = "people" | "departments" | "offices" | "email";

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
  // One vocabulary across the three Share bodies (naming canon).
  { value: "PRIVATE", label: "Invite only", blurb: "Only the people listed below", Icon: Lock },
  { value: "WORKSPACE", label: "Space members", blurb: "The people below, plus org admins", Icon: UsersIcon },
  { value: "ORG", label: "Everyone in the org", blurb: "Every member of the organisation", Icon: Globe },
];

/** A SpaceMember role in the product's words (panelRoleLabel), never the raw enum. */
export const SPACE_ROLE_PANEL: Record<SpaceRole, PanelRole> = { OWNER: "OWNER", ADMIN: "FULL", MEMBER: "EDIT", GUEST: "VIEW" };

const ROLE_OPTIONS: { value: SpaceRole; label: string }[] = (["OWNER", "ADMIN", "MEMBER", "GUEST"] as const).map((value) => ({
  value,
  label: panelRoleLabel(SPACE_ROLE_PANEL[value]),
}));

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
  const confirm = useConfirm();
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
    if (!(await confirm({ title: "Remove member", description: `Remove ${displayName(m.user)} from this Space?`, destructive: true, confirmLabel: "Remove" }))) return;
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
          <DialogTitle className="text-lg font-semibold">Share {spaceName}</DialogTitle>
          <DialogDescription className="mt-1">
            Decide who can see this Space and what they can do.
          </DialogDescription>
        </div>

        {/* Visibility selector */}
        <div className="px-6 pb-3">
          <div className="text-xs uppercase tracking-wide text-zinc-500 font-semibold mb-2">
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
                  className={`text-start rounded-lg border bg-white p-2.5 transition ${
                    active ? "border-zinc-900 ring-1 ring-zinc-900" : "border-zinc-200 hover:bg-zinc-50"
                  } disabled:opacity-60`}
                >
                  <div className="inline-flex items-center gap-1.5 text-base font-semibold">
                    <opt.Icon className="h-3.5 w-3.5" />
                    {opt.label}
                  </div>
                  <div className="text-xs text-zinc-500 mt-0.5 leading-snug">{opt.blurb}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Add member — tabbed picker (People / Departments / Offices) */}
        <div className="px-6 pb-3 border-t border-zinc-100 pt-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs uppercase tracking-wide text-zinc-500 font-semibold">
              Add people
            </div>
            <div className="inline-flex items-center rounded-md border border-zinc-200 overflow-hidden text-xs">
              <PickerTabBtn active={tab === "people"} onClick={() => setTab("people")}>
                <UserPlus className="h-3 w-3" /> People
              </PickerTabBtn>
              <PickerTabBtn active={tab === "departments"} onClick={() => setTab("departments")}>
                <Building2 className="h-3 w-3" /> Departments
              </PickerTabBtn>
              <PickerTabBtn active={tab === "offices"} onClick={() => setTab("offices")}>
                <MapPin className="h-3 w-3" /> Offices
              </PickerTabBtn>
              <PickerTabBtn active={tab === "email"} onClick={() => setTab("email")}>
                <Mail className="h-3 w-3" /> Invite
              </PickerTabBtn>
            </div>
          </div>

          {tab === "people" ? (
            <div className="relative" ref={pickerRef}>
              <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setPickerOpen(true); }}
                onFocus={() => setPickerOpen(true)}
                placeholder="Type a name or email…"
                className="w-full h-9 ps-8 pe-2 rounded-md border border-zinc-200 bg-white text-base focus:outline-none focus:border-zinc-400"
              />
              {pickerOpen ? (
                <div className="absolute start-0 end-0 top-10 z-10 rounded-md border border-zinc-200 bg-white shadow-lg max-h-[220px] overflow-y-auto">
                  {candidates.length === 0 ? (
                    <div className="px-3 py-3 text-sm text-zinc-400">
                      {query ? `No match for "${query}"` : "Start typing to find people"}
                    </div>
                  ) : (
                    candidates.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => addMember(u)}
                        disabled={busyAddId === u.id}
                        className="w-full text-start px-2.5 py-1.5 flex items-center gap-2 hover:bg-zinc-50 disabled:opacity-60"
                      >
                        <Avatar user={u} />
                        <span className="flex-1 min-w-0">
                          <span className="block text-base font-medium truncate">{displayName(u)}</span>
                          <span className="block text-xs text-zinc-500 truncate">{u.email}</span>
                        </span>
                        {busyAddId === u.id ? (
                          <Dots variant="pending" />
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

          {tab === "email" ? (
            <SpaceEmailInvites spaceId={spaceId} />
          ) : null}

          {bulkResult ? (
            <div className="mt-2 text-xs text-zinc-500">
              Added {bulkResult.added} · skipped {bulkResult.skipped} already in this Space
            </div>
          ) : null}
        </div>

        {/* Members list */}
        <div className="px-6 pb-5 border-t border-zinc-100 pt-4">
          <div className="text-xs uppercase tracking-wide text-zinc-500 font-semibold mb-2">
            {members === null ? "Members" : `Members · ${members.length}`}
          </div>
          {members === null ? (
            <SkeletonLines lines={2} />
          ) : members.length === 0 ? (
            <div className="text-sm text-zinc-400">No members yet. Add someone above.</div>
          ) : (
            <ul className="rounded-lg border border-zinc-200 divide-y divide-zinc-100 max-h-[260px] overflow-y-auto">
              {members.map((m) => {
                const busy = busyRoleId === m.user.id || busyRemoveId === m.user.id;
                return (
                  <li key={m.user.id} className="flex items-center gap-2.5 px-3 py-2">
                    <Avatar user={m.user} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-base font-medium truncate">{displayName(m.user)}</span>
                      <span className="block text-xs text-zinc-500 truncate">{m.user.email}</span>
                    </span>
                    <select
                      value={m.role}
                      onChange={(e) => changeRole(m, e.target.value as SpaceRole)}
                      disabled={busy}
                      className="h-7 px-1.5 rounded-md border border-zinc-200 bg-white text-xs focus:outline-none focus:border-zinc-400"
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
                        <Dots variant="pending" />
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
    <span className="h-6 w-6 rounded-full bg-zinc-100 border border-zinc-200 inline-flex items-center justify-center text-xs font-semibold text-zinc-600 shrink-0">
      {avatarInitials(user)}
    </span>
  );
}

interface PendingInvite {
  id: string;
  email: string;
  spaceRole: SpaceRole | null;
  createdAt: string;
  expiresAt: string;
  inviteUrl: string;
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/**
 * Invite someone to this Space by email: they get a sign-up link and join the
 * Space at the role chosen here. Keeps its pending list with copy, resend and
 * revoke. Its own route (/api/spaces/[id]/invitations), because an invitation
 * is not a grant yet: the person does not exist until they sign up.
 */
export function SpaceEmailInvites({ spaceId }: { spaceId: string | null }) {
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<SpaceRole>("MEMBER");
  const [busy, setBusy] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [reused, setReused] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingInvite[] | null>(null);
  const [busyInviteId, setBusyInviteId] = useState<string | null>(null);

  const loadPending = useCallback(() => {
    if (!spaceId) return;
    fetch(`/api/spaces/${spaceId}/invitations`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        setPending(Array.isArray(data.invitations) ? data.invitations : []);
      })
      .catch(() => setPending([]));
  }, [spaceId]);

  useEffect(() => {
    loadPending();
  }, [loadPending]);

  const send = async () => {
    if (!spaceId) return;
    const trimmed = email.trim().toLowerCase();
    if (!trimmed.includes("@")) {
      toast("Enter a valid email address");
      return;
    }
    setBusy(true);
    setInviteUrl(null);
    setReused(false);
    try {
      const res = await fetch(`/api/spaces/${spaceId}/invitations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: trimmed, spaceRole: role }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data?.error ?? "Could not send invitation");
        return;
      }
      setInviteUrl(data.inviteUrl ?? null);
      setReused(Boolean(data.reused));
      setEmail("");
      loadPending();
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast("Couldn't copy. Select the link and copy it by hand.");
    }
  };

  const copyInvite = async (invite: PendingInvite) => {
    try {
      await navigator.clipboard.writeText(invite.inviteUrl);
      setCopiedId(invite.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      toast("Couldn't copy");
    }
  };

  const resend = async (invite: PendingInvite) => {
    if (!spaceId) return;
    setBusyInviteId(invite.id);
    try {
      const res = await fetch(`/api/spaces/${spaceId}/invitations/${invite.id}/resend`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data?.error ?? "Could not resend");
        return;
      }
      toast(`Resent to ${invite.email}`);
    } finally {
      setBusyInviteId(null);
    }
  };

  const revoke = async (invite: PendingInvite) => {
    if (!spaceId) return;
    if (!(await confirm({ title: "Revoke invitation", description: `Revoke the invitation to ${invite.email}?`, destructive: true, confirmLabel: "Revoke" }))) return;
    setBusyInviteId(invite.id);
    setPending((prev) => (prev ?? []).filter((p) => p.id !== invite.id));
    try {
      const res = await fetch(`/api/spaces/${spaceId}/invitations/${invite.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data?.error ?? "Could not revoke");
        loadPending();
      }
    } finally {
      setBusyInviteId(null);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void send(); }}
          placeholder="name@company.com"
          className="flex-1 h-9 px-3 rounded-md border border-zinc-200 bg-white text-base focus:outline-none focus:border-zinc-400"
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as SpaceRole)}
          aria-label="Access for the person you invite"
          className="h-9 px-2 rounded-md border border-line-strong bg-raised text-sm text-ink focus:outline-none focus-visible:border-brand"
        >
          {(["GUEST", "MEMBER", "ADMIN"] as const).map((r) => (
            <option key={r} value={r}>{panelRoleLabel(SPACE_ROLE_PANEL[r])}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={send}
          disabled={busy || !email.trim()}
          className="h-9 px-3 rounded-md bg-[#0073EA] text-white text-base font-medium hover:bg-[#0060B9] disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          {busy ? <Dots variant="pending" /> : <Mail className="h-3.5 w-3.5" />}
          Send invite
        </button>
      </div>

      <div className="mt-2 text-xs text-zinc-500 leading-snug">
        We&rsquo;ll email them a link. They land on Sign-up, set a password, and join this Space automatically.
      </div>

      {inviteUrl ? (
        <div className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-2.5">
          <div className="text-xs text-zinc-500 mb-1.5">
            {reused ? "Reusing an active invitation." : "Invitation sent."} Share the link if the email doesn&rsquo;t arrive:
          </div>
          <div className="flex items-center gap-1.5">
            <code className="flex-1 min-w-0 text-xs text-zinc-700 truncate px-2 py-1 rounded bg-white border border-zinc-200">
              {inviteUrl}
            </code>
            <button
              type="button"
              onClick={copy}
              className="h-7 w-7 rounded-md hover:bg-zinc-200 inline-flex items-center justify-center text-zinc-500"
              aria-label="Copy link"
              title="Copy link"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      ) : null}

      {pending && pending.length > 0 ? (
        <div className="mt-4 pt-3 border-t border-zinc-100">
          <div className="text-xs uppercase tracking-wide text-zinc-500 font-semibold mb-2">
            Pending invitations · {pending.length}
          </div>
          <ul className="rounded-md border border-zinc-200 divide-y divide-zinc-100 max-h-[200px] overflow-y-auto">
            {pending.map((inv) => {
              const busy = busyInviteId === inv.id;
              return (
                <li key={inv.id} className="px-2.5 py-2 flex items-center gap-2">
                  <Mail className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-base font-medium text-zinc-900 truncate">{inv.email}</span>
                    <span className="block text-xs text-zinc-500">
                      {panelRoleLabel(SPACE_ROLE_PANEL[inv.spaceRole ?? "MEMBER"])} · sent {relTime(inv.createdAt)}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => copyInvite(inv)}
                    disabled={busy}
                    className="h-6 w-6 rounded hover:bg-zinc-100 inline-flex items-center justify-center text-zinc-400 hover:text-zinc-700 disabled:opacity-50"
                    title="Copy link"
                    aria-label="Copy link"
                  >
                    {copiedId === inv.id ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => resend(inv)}
                    disabled={busy}
                    className="h-6 w-6 rounded hover:bg-zinc-100 inline-flex items-center justify-center text-zinc-400 hover:text-zinc-700 disabled:opacity-50"
                    title="Resend email"
                    aria-label="Resend email"
                  >
                    {busy ? <Dots variant="pending" /> : <Send className="h-3 w-3" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => revoke(inv)}
                    disabled={busy}
                    className="h-6 w-6 rounded hover:bg-red-50 inline-flex items-center justify-center text-zinc-400 hover:text-red-500 disabled:opacity-50"
                    title="Revoke"
                    aria-label="Revoke"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
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
    return <div className="text-sm text-zinc-400 py-3 text-center">Loading {kind === "department" ? "departments" : "offices"}…</div>;
  }
  if (groups.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-zinc-200 px-4 py-6 text-center">
        <EmptyIcon className="h-5 w-5 text-zinc-300 mx-auto mb-1.5" />
        <div className="text-sm text-zinc-500">{emptyLabel}</div>
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
              <span className="block text-base font-medium text-zinc-900 truncate">{g.name}</span>
              <span className="block text-xs text-zinc-500">
                {g.memberCount} {g.memberCount === 1 ? "person" : "people"}
              </span>
            </span>
            <button
              type="button"
              onClick={() => onAdd(g)}
              disabled={busy || g.memberCount === 0}
              className="h-7 px-2.5 rounded-md bg-[#0073EA] text-white text-xs font-medium hover:bg-[#0060B9] disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {busy ? <Dots variant="pending" /> : <Plus className="h-3 w-3" />}
              Add all
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* ───────────── The Space pieces of the one Manage access dialog ─────────────
 *
 * Defined here, next to the dialog they came out of, and composed by
 * src/components/access/general-access.tsx and manage-access-dialog.tsx. They
 * never call the member routes: a write goes through the callback the dialog
 * hands them (the grants route) or through the Space's own PATCH.
 */

export interface VisibilityOption<V extends string> {
  value: V;
  label: string;
  blurb: string;
  Icon: typeof Lock;
}

/** The Space tri-state in the naming canon's words. */
export function spaceVisibilityOptions(orgName: string): VisibilityOption<Visibility>[] {
  return [
    { value: "PRIVATE", label: "Invite only", blurb: "Only the people listed below.", Icon: Lock },
    { value: "WORKSPACE", label: "Space members", blurb: "The people listed below, plus Admins.", Icon: UsersIcon },
    { value: "ORG", label: `Everyone at ${orgName}`, blurb: `Every member of ${orgName}.`, Icon: Globe },
  ];
}

/**
 * One row of three cards, shared by the Space and List tri-states. The
 * selected card carries the brand border and the selected ground, and a
 * keyboard focus ring of its own: one indicator each, never two stacked.
 */
export function VisibilityCards<V extends string>({
  label, options, value, busy, onChoose,
}: {
  label: string;
  options: VisibilityOption<V>[];
  value: V;
  busy: V | null;
  onChoose: (next: V) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-3 gap-2 max-sm:grid-cols-1">
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-busy={busy === opt.value || undefined}
            onClick={() => onChoose(opt.value)}
            className={`min-w-0 rounded-lg border p-2.5 text-start transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--os-focus)] ${
              active ? "border-brand bg-selected" : "border-line bg-raised hover:bg-hover"
            }`}
          >
            {/* The label wraps rather than truncates: "Everyone at <org>"
                is the whole point of the card, and an org name can be long. */}
            <span className="flex items-start gap-1.5 text-base font-medium leading-snug text-ink">
              <opt.Icon className="mt-[3px] h-3.5 w-3.5 shrink-0 text-ink-2" strokeWidth={1.75} aria-hidden />
              <span className="min-w-0 break-words">{opt.label}</span>
              {busy === opt.value ? <Dots variant="pending" /> : null}
            </span>
            <span className="mt-0.5 block text-xs leading-snug text-ink-2">{opt.blurb}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The chosen option as a sentence, for a viewer who cannot change it. */
export function VisibilityReadout<V extends string>({ option }: { option: VisibilityOption<V> | undefined }) {
  if (!option) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-line bg-subtle px-3 py-2.5">
      <option.Icon className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.75} aria-hidden />
      <span className="min-w-0">
        <span className="block text-base font-medium text-ink">{option.label}</span>
        <span className="block text-sm text-ink-2">{option.blurb}</span>
      </span>
    </div>
  );
}

/** A failed write, said once, with a real Retry that sends the same change again. */
export function InlineRetry({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <p role="alert" className="m-0 mt-2 flex items-start gap-1.5 text-sm text-danger-text">
      <span className="min-w-0 flex-1">{message}</span>
      <button type="button" onClick={onRetry} className="inline-flex shrink-0 items-center gap-1 font-medium text-brand-deep hover:underline">
        <RotateCw className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden /> Retry
      </button>
    </p>
  );
}

/**
 * Who can see a Space: Invite only, Space members or Everyone at the org,
 * written through PATCH /api/spaces/[id]. Not optimistic: the card changes
 * when the server agrees, and a failure keeps the choice with a Retry.
 */
export function SpaceVisibilityControl({
  spaceId, value, orgName, readOnly = false, onChanged,
}: {
  spaceId: string;
  value: Visibility;
  orgName: string;
  readOnly?: boolean;
  onChanged?: (next: Visibility) => void;
}) {
  const [busy, setBusy] = useState<Visibility | null>(null);
  const [failed, setFailed] = useState<{ message: string; next: Visibility } | null>(null);
  const options = spaceVisibilityOptions(orgName);

  const choose = async (next: Visibility) => {
    if (next === value || busy) return;
    setBusy(next);
    setFailed(null);
    try {
      const res = await fetch(`/api/spaces/${spaceId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ visibility: next }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setFailed({ message: generalErrorText(res.status, d, "space", "Couldn't change who can see this Space."), next });
        return;
      }
      onChanged?.(next);
    } catch {
      setFailed({ message: "Couldn't change who can see this Space. Check your connection.", next });
    } finally {
      setBusy(null);
    }
  };

  if (readOnly) return <VisibilityReadout option={options.find((o) => o.value === value)} />;
  return (
    <div>
      <VisibilityCards label="Who can see this Space" options={options} value={value} busy={busy} onChoose={(v) => void choose(v)} />
      {failed ? <InlineRetry message={failed.message} onRetry={() => void choose(failed.next)} /> : null}
    </div>
  );
}

/** One person a bulk add writes, and what the dialog's grants call answered. */
export interface BulkPerson { id: string; name: string }
export type BulkGrant = (person: BulkPerson) => Promise<{ ok: true } | { ok: false; message: string }>;

interface BulkAddProps {
  /** The role everyone is raised to, as a word ("Can edit"). Nobody is ever lowered. */
  roleLabel: string;
  /** Writes one person through the grants route in raise mode. */
  grantOne: BulkGrant;
}

type BulkRun = {
  groupId: string;
  groupName: string;
  queue: BulkPerson[];
  done: number;
  total: number;
  error: string | null;
};

function personLabelOf(u: { firstName?: string | null; lastName?: string | null; email?: string | null }): string {
  return [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.email || "Someone";
}

/**
 * Add every person in a department or an office, ONE AFTER ANOTHER. Each
 * write raises that person to the role and never lowers anyone who already
 * holds more (problem 36). The first failure stops the run with the rest
 * still queued, and Retry carries on from the person who failed, so a
 * half-finished add is never mistaken for a finished one.
 */
function GroupBulkAdd({ kind, roleLabel, grantOne }: BulkAddProps & { kind: "department" | "office" }) {
  const [groups, setGroups] = useState<GroupRow[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [run, setRun] = useState<BulkRun | null>(null);
  const [done, setDone] = useState<{ groupName: string; added: number } | null>(null);
  const [reload, setReload] = useState(0);
  const noun = kind === "department" ? "departments" : "offices";

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      setLoadFailed(false);
      fetch(kind === "department" ? "/api/departments" : "/api/offices", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((data: Array<{ id: string; name: string; _count?: { members?: number } }>) => {
          if (!alive) return;
          setGroups(Array.isArray(data) ? data.map((g) => ({ id: g.id, name: g.name, memberCount: g._count?.members ?? 0 })) : []);
        })
        .catch(() => { if (alive) setLoadFailed(true); });
    }, 0);
    return () => { alive = false; clearTimeout(t); };
  }, [kind, reload]);

  // The whole group, from the directory (scope=directory: every Member reads
  // the whole workspace, filtered by department or office on the server, 100
  // a page), never /api/users?scope=all, whose team scope answered a Space
  // admin below org-wide levels with only their own reports in the group,
  // and stopped at 200. Only people who can sign in are added (the
  // directory leaves deactivated people out): an inactive account would stop
  // the run on a person who could never open the Space anyway.
  const membersOf = async (g: GroupRow): Promise<BulkPerson[]> => {
    const out: BulkPerson[] = [];
    for (let page = 1; page <= 50; page++) {
      const qs = new URLSearchParams({ scope: "directory", size: "100", page: String(page) });
      qs.set(kind === "department" ? "dept" : "office", g.id);
      const res = await fetch(`/api/users?${qs}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const rows: Array<{ id: string; firstName?: string | null; lastName?: string | null; email?: string | null; status?: string }> =
        Array.isArray(data?.data) ? data.data : [];
      for (const u of rows) if (u.status !== "INACTIVE") out.push({ id: u.id, name: personLabelOf(u) });
      if (!data?.pagination?.hasMore) break;
    }
    return out;
  };

  const drain = async (start: BulkRun) => {
    let queue = start.queue;
    let count = start.done;
    setRun({ ...start, error: null });
    while (queue.length > 0) {
      const next = queue[0];
      const r = await grantOne(next);
      if (!r.ok) {
        setRun({ ...start, queue, done: count, error: `Couldn't add ${next.name}: ${r.message} ${queue.length} not added yet.` });
        return;
      }
      queue = queue.slice(1);
      count += 1;
      setRun({ ...start, queue, done: count, error: null });
    }
    setRun(null);
    setDone({ groupName: start.groupName, added: count });
  };

  const addAll = async (g: GroupRow) => {
    if (run) return;
    setDone(null);
    let people: BulkPerson[];
    try {
      people = await membersOf(g);
    } catch {
      setRun({ groupId: g.id, groupName: g.name, queue: [], done: 0, total: 0, error: `Couldn't read who is in ${g.name}.` });
      return;
    }
    if (people.length === 0) {
      setDone({ groupName: g.name, added: 0 });
      return;
    }
    await drain({ groupId: g.id, groupName: g.name, queue: people, done: 0, total: people.length, error: null });
  };

  if (loadFailed) {
    return <InlineRetry message={`Couldn't load the ${noun}.`} onRetry={() => setReload((n) => n + 1)} />;
  }
  if (groups === null) return <SkeletonLines lines={3} />;
  if (groups.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-line px-4 py-5 text-center">
        {kind === "department" ? <Building2 className="mx-auto mb-1.5 h-5 w-5 text-ink-3" aria-hidden /> : <MapPin className="mx-auto mb-1.5 h-5 w-5 text-ink-3" aria-hidden />}
        <div className="text-sm text-ink-2">No {noun} set up yet.</div>
      </div>
    );
  }
  return (
    <div>
      <ul className="max-h-[220px] divide-y divide-line-soft overflow-y-auto rounded-md border border-line">
        {groups.map((g) => {
          const running = run?.groupId === g.id && !run.error;
          return (
            <li key={g.id} className="flex items-center gap-2.5 px-3 py-2">
              <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-active">
                {kind === "department" ? <Building2 className="h-3 w-3 text-ink-2" aria-hidden /> : <MapPin className="h-3 w-3 text-ink-2" aria-hidden />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base font-medium text-ink">{g.name}</span>
                <span className="block text-xs text-ink-2">{g.memberCount} {g.memberCount === 1 ? "person" : "people"}</span>
              </span>
              {running ? (
                <span className="inline-flex shrink-0 items-center gap-1.5 text-sm text-ink-2" aria-live="polite">
                  <Dots variant="pending" /> {run.done} of {run.total}
                </span>
              ) : g.memberCount > 0 ? (
                <button
                  type="button"
                  onClick={() => void addAll(g)}
                  aria-disabled={run !== null && !run.error ? true : undefined}
                  className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-line-strong bg-raised px-2.5 text-sm font-medium text-ink hover:bg-hover"
                  title={`Add everyone in ${g.name} at ${roleLabel}`}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden /> Add all
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {run?.error ? (
        <InlineRetry
          message={run.error}
          onRetry={() => { if (run.queue.length > 0) void drain({ ...run, error: null }); else { const g = groups.find((x) => x.id === run.groupId); setRun(null); if (g) void addAll(g); } }}
        />
      ) : null}
      {done ? (
        <p className="m-0 mt-2 text-sm text-ink-2" role="status">
          {done.added === 0
            ? `No one in ${done.groupName} can be added from here.`
            : `Added ${done.added} ${done.added === 1 ? "person" : "people"} from ${done.groupName} at ${roleLabel}. Nobody who had more was lowered.`}
        </p>
      ) : null}
    </div>
  );
}

/** Everyone in a department, raised to the chosen role one person at a time. */
export function SpaceDepartmentAdd(props: BulkAddProps) {
  return <GroupBulkAdd kind="department" {...props} />;
}

/** Everyone in an office, raised to the chosen role one person at a time. */
export function SpaceOfficeAdd(props: BulkAddProps) {
  return <GroupBulkAdd kind="office" {...props} />;
}
