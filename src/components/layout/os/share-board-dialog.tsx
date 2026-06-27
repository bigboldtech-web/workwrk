"use client";

// ShareBoardDialog — manage a Board's visibility + BoardMembers.
//
// Mirrors ShareSpaceDialog but talks to the Board endpoints (Phase 23b).
// Tighter scope: visibility selector + add-member search + member list.
// Email invitations + bulk-add by Department arrive in a later phase.
//
//   PATCH /api/boards/[id]                 → visibility update
//   GET   /api/boards/[id]/members         → current members
//   POST  /api/boards/[id]/members         → upsert member { userId, role }
//   DELETE /api/boards/[id]/members?userId → remove

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Search, X, Lock, Globe, Users as UsersIcon, Loader2, Plus, Info } from "lucide-react";
import { useOsToast } from "./toast";
import { useConfirm } from "@/components/ui/dialog-provider";

type Visibility = "PRIVATE" | "WORKSPACE" | "ORG";
type BoardRole = "OWNER" | "ADMIN" | "MEMBER" | "GUEST";

interface UserOption {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email: string;
}

interface Member {
  id: string;
  role: BoardRole;
  user: UserOption;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  boardId: string | null;
  boardName: string;
  initialVisibility: Visibility;
  /** Name of the parent Space, surfaced as context in the modal. */
  parentSpaceName?: string | null;
  onChanged?: () => void;
}

const VISIBILITY_OPTIONS: { value: Visibility; label: string; blurb: string; Icon: typeof Lock }[] = [
  { value: "WORKSPACE", label: "Inherit Space", blurb: "Members of the parent Space (default)", Icon: UsersIcon },
  { value: "PRIVATE",   label: "Private",        blurb: "Tighter than Space — board members only", Icon: Lock },
  { value: "ORG",       label: "Org-wide",       blurb: "Looser — every member of the org", Icon: Globe },
];

const ROLE_OPTIONS: { value: BoardRole; label: string }[] = [
  { value: "OWNER",   label: "Owner" },
  { value: "ADMIN",   label: "Admin" },
  { value: "MEMBER",  label: "Member" },
  { value: "GUEST",   label: "Guest" },
];

function displayName(u: UserOption): string {
  const full = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return full || u.email;
}

function avatarInitials(u: UserOption): string {
  return ((u.firstName?.[0] ?? "") + (u.lastName?.[0] ?? "")).toUpperCase() || u.email[0]?.toUpperCase() || "?";
}

export function ShareBoardDialog({
  open,
  onOpenChange,
  boardId,
  boardName,
  initialVisibility,
  parentSpaceName,
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

  const reset = useCallback(() => {
    setMembers(null);
    setUsers([]);
    setQuery("");
    setPickerOpen(false);
    setBusyVis(false);
    setBusyRoleId(null);
    setBusyRemoveId(null);
    setBusyAddId(null);
  }, []);

  const handleOpen = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  useEffect(() => {
    if (open) setVisibility(initialVisibility);
  }, [open, initialVisibility]);

  useEffect(() => {
    if (!open || !boardId) return;
    let active = true;
    fetch(`/api/boards/${boardId}/members`)
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
  }, [open, boardId]);

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
    if (!boardId || next === visibility) return;
    setBusyVis(true);
    try {
      const res = await fetch(`/api/boards/${boardId}`, {
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
    if (!boardId) return;
    setBusyAddId(user.id);
    try {
      const res = await fetch(`/api/boards/${boardId}/members`, {
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

  const changeRole = async (m: Member, role: BoardRole) => {
    if (!boardId || role === m.role) return;
    setBusyRoleId(m.user.id);
    try {
      const res = await fetch(`/api/boards/${boardId}/members`, {
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
    if (!boardId) return;
    if (!(await confirm({ title: "Remove member", description: `Remove ${displayName(m.user)} from this board?`, destructive: true, confirmLabel: "Remove" }))) return;
    setBusyRemoveId(m.user.id);
    try {
      const res = await fetch(`/api/boards/${boardId}/members?userId=${m.user.id}`, {
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

  if (!boardId) return null;

  const membersNeeded = visibility === "PRIVATE";

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="max-w-[520px] p-0 gap-0">
        <div className="px-6 pt-6 pb-3">
          <DialogTitle className="text-[16px] font-semibold">Share {boardName}</DialogTitle>
          <DialogDescription className="mt-1">
            {parentSpaceName ? (
              <>Tighten or widen access to this board inside <span className="font-medium">{parentSpaceName}</span>.</>
            ) : (
              <>Decide who can see this board.</>
            )}
          </DialogDescription>
        </div>

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
          {!membersNeeded ? (
            <div className="mt-2 text-[11px] text-zinc-500 inline-flex items-start gap-1.5">
              <Info className="h-3 w-3 mt-0.5 shrink-0" />
              The members list below only applies when visibility is set to Private.
            </div>
          ) : null}
        </div>

        <div className="px-6 pb-3 border-t border-zinc-100 pt-4">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500 font-semibold mb-2">
            Add people
          </div>
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
        </div>

        <div className="px-6 pb-5 border-t border-zinc-100 pt-4">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500 font-semibold mb-2">
            {members === null ? "Members" : `Members · ${members.length}`}
          </div>
          {members === null ? (
            <div className="text-[12px] text-zinc-400">Loading…</div>
          ) : members.length === 0 ? (
            <div className="text-[12px] text-zinc-400">
              {membersNeeded
                ? "No members yet — add someone above. Board owner + Space OWNER always retain access."
                : "Only matters when visibility is Private."}
            </div>
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
                      onChange={(e) => changeRole(m, e.target.value as BoardRole)}
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
