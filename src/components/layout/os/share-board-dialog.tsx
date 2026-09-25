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
//
// ListVisibilityControl, at the end of this file, is the List's tri-state on
// its own: the one Manage access dialog composes it (src/components/access/
// general-access.tsx). The dialog above is kept, exported and working;
// nothing mounts it any more.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Search, X, Lock, Globe, Users as UsersIcon, Plus, Info } from "lucide-react";
import { useOsToast } from "./toast";
import { useConfirm } from "@/components/ui/dialog-provider";
import { SkeletonLines } from "@/components/ui/skeleton";
import { Dots } from "@/components/ui/dots";
import { InlineRetry, VisibilityCards, VisibilityReadout, type VisibilityOption } from "./share-space-dialog";
import { generalErrorText } from "@/components/access/manage-access-model";

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
  // The naming canon, not three private vocabularies: "Restricted" replaces
  // Private on a Folder and a List, "Everyone in the org" replaces Org-wide and
  // Workspace-visible, and a List's default inherits from its Space.
  { value: "WORKSPACE", label: "Inherits from the Space", blurb: "Anyone who can open the Space (default)", Icon: UsersIcon },
  { value: "PRIVATE",   label: "Restricted",              blurb: "Only the people listed below", Icon: Lock },
  { value: "ORG",       label: "Everyone in the org",     blurb: "Every member of the organisation", Icon: Globe },
];

// Labelled by what the role can DO, since that's what people are choosing:
// Member = read + write, Guest = read only.
const ROLE_OPTIONS: { value: BoardRole; label: string }[] = [
  { value: "OWNER",   label: "Owner" },
  { value: "ADMIN",   label: "Full access" },
  { value: "MEMBER",  label: "Can edit" },
  { value: "GUEST",   label: "Can view" },
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

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="max-w-[520px] p-0 gap-0">
        <div className="px-6 pt-6 pb-3">
          <DialogTitle className="text-lg font-semibold">Share {boardName}</DialogTitle>
          <DialogDescription className="mt-1">
            {parentSpaceName ? (
              <>Tighten or widen access to this list inside <span className="font-medium">{parentSpaceName}</span>.</>
            ) : (
              <>Decide who can see this list.</>
            )}
          </DialogDescription>
        </div>

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
          {/* `inline-flex` on a box of mixed text and <span>s makes EVERY text
              node and span its own flex item, so this sentence rendered as
              three fragments jammed across one row. The flex box now holds the
              icon and ONE span, and the sentence is text inside that span. */}
          <div className="mt-2 flex items-start gap-1.5 text-xs text-zinc-500">
            <Info className="h-3 w-3 mt-0.5 shrink-0" />
            <span>
              Anyone you add below gets access to <span className="font-medium">this list</span>, even without access to the Space. <span className="font-medium">Can edit</span> to work on it, <span className="font-medium">Can view</span> to just see it.
            </span>
          </div>
        </div>

        <div className="px-6 pb-3 border-t border-zinc-100 pt-4">
          <div className="text-xs uppercase tracking-wide text-zinc-500 font-semibold mb-2">
            Add people
          </div>
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
        </div>

        <div className="px-6 pb-5 border-t border-zinc-100 pt-4">
          <div className="text-xs uppercase tracking-wide text-zinc-500 font-semibold mb-2">
            {members === null ? "Members" : `Members · ${members.length}`}
          </div>
          {members === null ? (
            <SkeletonLines lines={2} />
          ) : members.length === 0 ? (
            <div className="text-sm text-zinc-400">
              No one added to this list yet. Add someone above to give them direct access. The Space&apos;s own members keep their access either way.
            </div>
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
                      onChange={(e) => changeRole(m, e.target.value as BoardRole)}
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

/**
 * The List tri-state in the naming canon's words. A List inside a Folder
 * inherits from that Folder, not from the Space, so `parentFolderName` names
 * it when the List has one: the Space alone would promise the List to Space
 * members a Restricted Folder above it shuts out.
 */
export function listVisibilityOptions(spaceName: string | null | undefined, orgName: string, parentFolderName?: string | null): VisibilityOption<Visibility>[] {
  const inherit = parentFolderName
    ? { label: `Inherits from ${parentFolderName}`, blurb: `Anyone who can open ${parentFolderName}.` }
    : { label: spaceName ? `Inherits from ${spaceName}` : "Inherits from the Space", blurb: "Anyone who can open the Space." };
  return [
    { value: "WORKSPACE", label: inherit.label, blurb: inherit.blurb, Icon: UsersIcon },
    { value: "PRIVATE", label: "Restricted", blurb: "Only the people listed below, plus Admins.", Icon: Lock },
    { value: "ORG", label: `Everyone at ${orgName}`, blurb: `Every member of ${orgName}.`, Icon: Globe },
  ];
}

/**
 * Who can open a List: inherit the Space, Restricted, or everyone at the org,
 * written through PATCH /api/boards/[id] { visibility }. Not optimistic: the
 * card changes when the server agrees, and a failure keeps the choice on
 * screen with a Retry that sends it again.
 */
export function ListVisibilityControl({
  boardId, value, spaceName, parentFolderName, orgName, readOnly = false, onChanged,
}: {
  boardId: string;
  value: Visibility;
  spaceName?: string | null;
  /** The Folder the List sits in, when it has one: what it inherits from. */
  parentFolderName?: string | null;
  orgName: string;
  readOnly?: boolean;
  onChanged?: (next: Visibility) => void;
}) {
  const [busy, setBusy] = useState<Visibility | null>(null);
  const [failed, setFailed] = useState<{ message: string; next: Visibility } | null>(null);
  const options = listVisibilityOptions(spaceName, orgName, parentFolderName);

  const choose = async (next: Visibility) => {
    if (next === value || busy) return;
    setBusy(next);
    setFailed(null);
    try {
      const res = await fetch(`/api/boards/${boardId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ visibility: next }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setFailed({ message: generalErrorText(res.status, d, "list", "Couldn't change who can open this List."), next });
        return;
      }
      onChanged?.(next);
    } catch {
      setFailed({ message: "Couldn't change who can open this List. Check your connection.", next });
    } finally {
      setBusy(null);
    }
  };

  if (readOnly) return <VisibilityReadout option={options.find((o) => o.value === value)} />;
  return (
    <div>
      <VisibilityCards label="Who can open this List" options={options} value={value} busy={busy} onChoose={(v) => void choose(v)} />
      {failed ? <InlineRetry message={failed.message} onRetry={() => void choose(failed.next)} /> : null}
    </div>
  );
}
