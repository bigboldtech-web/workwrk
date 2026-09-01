"use client";

// ShareFolderDialog — grant specific people access to ONE folder without
// giving them the whole Space. Granular access: a folder member reaches this
// folder (and its subtree of boards/docs) and nothing else; the Space shows as
// a bare container around it.
//
// Deliberately leaner than ShareSpaceDialog: no visibility tri-state and no
// department/office/email bulk pickers — a folder share is a targeted "share
// with these people" action. All mutations hit /api/folders/[id]/members.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Search, X, Loader2, Plus, FolderTree } from "lucide-react";
import { useOsToast } from "./toast";
import { useConfirm } from "@/components/ui/dialog-provider";

type FolderRole = "OWNER" | "ADMIN" | "MEMBER" | "GUEST";

interface UserOption {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email: string;
  avatar?: string | null;
}

interface Member {
  id: string;
  role: FolderRole;
  user: UserOption;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  folderId: string | null;
  folderName: string;
  onChanged?: () => void;
}

const ROLE_OPTIONS: { value: FolderRole; label: string; blurb: string }[] = [
  { value: "ADMIN", label: "Admin", blurb: "Can edit + manage access" },
  { value: "MEMBER", label: "Can edit", blurb: "Can edit the contents" },
  { value: "GUEST", label: "Can view", blurb: "Read-only" },
];

function displayName(u: UserOption): string {
  const full = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return full || u.email;
}
function avatarInitials(u: UserOption): string {
  return ((u.firstName?.[0] ?? "") + (u.lastName?.[0] ?? "")).toUpperCase() || u.email[0]?.toUpperCase() || "?";
}
function Avatar({ user }: { user: UserOption }) {
  return (
    <span className="h-6 w-6 rounded-full bg-zinc-100 border border-zinc-200 inline-flex items-center justify-center text-[11px] font-semibold text-zinc-600 shrink-0">
      {avatarInitials(user)}
    </span>
  );
}

export function ShareFolderDialog({ open, onOpenChange, folderId, folderName, onChanged }: Props) {
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [query, setQuery] = useState("");
  const [addRole, setAddRole] = useState<FolderRole>("MEMBER");
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [busyRoleId, setBusyRoleId] = useState<string | null>(null);
  const [busyRemoveId, setBusyRemoveId] = useState<string | null>(null);
  const [busyAddId, setBusyAddId] = useState<string | null>(null);

  const reset = useCallback(() => {
    setMembers(null);
    setUsers([]);
    setQuery("");
    setPickerOpen(false);
    setBusyRoleId(null);
    setBusyRemoveId(null);
    setBusyAddId(null);
  }, []);

  const handleOpen = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  useEffect(() => {
    if (!open || !folderId) return;
    let active = true;
    fetch(`/api/folders/${folderId}/members`)
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
  }, [open, folderId]);

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
        return u.email.toLowerCase().includes(q) || displayName(u).toLowerCase().includes(q);
      })
      .slice(0, 10);
  }, [users, memberIds, query]);

  const addMember = async (user: UserOption) => {
    if (!folderId) return;
    setBusyAddId(user.id);
    try {
      const res = await fetch(`/api/folders/${folderId}/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: user.id, role: addRole }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data?.error ?? "Could not add member");
        return;
      }
      const data = await res.json();
      const m: Member = data.member?.user ? data.member : { id: data.member?.id ?? user.id, role: addRole, user };
      setMembers((prev) => [...(prev ?? []), m]);
      setQuery("");
      setPickerOpen(false);
      onChanged?.();
    } finally {
      setBusyAddId(null);
    }
  };

  const changeRole = async (m: Member, role: FolderRole) => {
    if (!folderId || role === m.role) return;
    setBusyRoleId(m.user.id);
    try {
      const res = await fetch(`/api/folders/${folderId}/members`, {
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
    if (!folderId) return;
    if (!(await confirm({ title: "Remove access", description: `Remove ${displayName(m.user)} from this folder?`, destructive: true, confirmLabel: "Remove" }))) return;
    setBusyRemoveId(m.user.id);
    try {
      const res = await fetch(`/api/folders/${folderId}/members?userId=${m.user.id}`, { method: "DELETE" });
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

  if (!folderId) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="max-w-[480px] p-0 gap-0">
        <div className="px-6 pt-6 pb-3">
          <DialogTitle className="text-[16px] font-semibold inline-flex items-center gap-2">
            <FolderTree className="h-4 w-4 text-zinc-500" /> Share {folderName}
          </DialogTitle>
          <DialogDescription className="mt-1">
            People you add reach this folder and its contents only — not the rest of the Space.
          </DialogDescription>
        </div>

        {/* Add people */}
        <div className="px-6 pb-3 border-t border-zinc-100 pt-4">
          <div className="text-[12px] uppercase tracking-wide text-zinc-500 font-semibold mb-2">Add people</div>
          <div className="flex items-center gap-1.5">
            <div className="relative flex-1" ref={pickerRef}>
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setPickerOpen(true); }}
                onFocus={() => setPickerOpen(true)}
                placeholder="Type a name or email…"
                className="w-full h-9 pl-8 pr-2 rounded-md border border-zinc-200 bg-white text-[14px] focus:outline-none focus:border-zinc-400"
              />
              {pickerOpen ? (
                <div className="absolute left-0 right-0 top-10 z-10 rounded-md border border-zinc-200 bg-white shadow-lg max-h-[220px] overflow-y-auto">
                  {candidates.length === 0 ? (
                    <div className="px-3 py-3 text-[13px] text-zinc-400">
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
                          <span className="block text-[13.5px] font-medium truncate">{displayName(u)}</span>
                          <span className="block text-[12px] text-zinc-500 truncate">{u.email}</span>
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
            <select
              value={addRole}
              onChange={(e) => setAddRole(e.target.value as FolderRole)}
              className="h-9 px-2 rounded-md border border-zinc-200 bg-white text-[13px] focus:outline-none focus:border-zinc-400"
              title="Access level for people you add"
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Members */}
        <div className="px-6 pb-5 border-t border-zinc-100 pt-4">
          <div className="text-[12px] uppercase tracking-wide text-zinc-500 font-semibold mb-2">
            {members === null ? "Shared with" : `Shared with · ${members.length}`}
          </div>
          {members === null ? (
            <div className="text-[13px] text-zinc-400">Loading…</div>
          ) : members.length === 0 ? (
            <div className="text-[13px] text-zinc-400">
              Not shared with anyone yet. Space members already have access.
            </div>
          ) : (
            <ul className="rounded-lg border border-zinc-200 divide-y divide-zinc-100 max-h-[260px] overflow-y-auto">
              {members.map((m) => {
                const busy = busyRoleId === m.user.id || busyRemoveId === m.user.id;
                return (
                  <li key={m.user.id} className="flex items-center gap-2.5 px-3 py-2">
                    <Avatar user={m.user} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13.5px] font-medium truncate">{displayName(m.user)}</span>
                      <span className="block text-[12px] text-zinc-500 truncate">{m.user.email}</span>
                    </span>
                    <select
                      value={m.role === "OWNER" ? "ADMIN" : m.role}
                      onChange={(e) => changeRole(m, e.target.value as FolderRole)}
                      disabled={busy}
                      className="h-7 px-1.5 rounded-md border border-zinc-200 bg-white text-[12.5px] focus:outline-none focus:border-zinc-400"
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
                      aria-label="Remove access"
                    >
                      {busyRemoveId === m.user.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
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
