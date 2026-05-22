"use client";

// WorkspaceMembersDialog — lists who's in a workspace, lets managers
// add a teammate, change roles (OWNER / EDITOR / VIEWER), and remove.
// Backed by /api/workspaces/[id]/members. The "default" workspace is
// org-wide-visible regardless of membership; we still let admins
// curate explicit members on it so they can lock things down later
// without a schema change.

import { useCallback, useEffect, useState } from "react";
import {
  X, Loader2, UserPlus, Trash2, ChevronDown, AlertCircle, Check,
} from "lucide-react";

type Role = "OWNER" | "EDITOR" | "VIEWER";

interface Member {
  id: string;
  role: Role;
  createdAt: string;
  user: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string;
    accessLevel: string;
  };
}

interface AddableUser {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  accessLevel: string;
}

interface Props {
  workspaceId: string;
  workspaceName: string;
  onClose: () => void;
}

function userLabel(u: { firstName: string | null; lastName: string | null; email: string }) {
  const name = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim();
  return name || u.email;
}

export function WorkspaceMembersDialog({ workspaceId, workspaceName, onClose }: Props) {
  const [members, setMembers] = useState<Member[]>([]);
  const [addable, setAddable] = useState<AddableUser[]>([]);
  const [isDefault, setIsDefault] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null); // userId mid-flight
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState("");
  const [pickerRole, setPickerRole] = useState<Role>("EDITOR");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/workspaces/${workspaceId}/members`);
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error || "Failed to load members");
        setMembers([]);
        setAddable([]);
        return;
      }
      const d = await r.json();
      setMembers(d.members ?? []);
      setAddable(d.addableUsers ?? []);
      setIsDefault(!!d.isDefault);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Hide users who are already members from the picker.
  const memberUserIds = new Set(members.map((m) => m.user.id));
  const pickable = addable.filter((u) => !memberUserIds.has(u.id));

  const handleAdd = async () => {
    if (!picker) return;
    setBusy(picker);
    setError(null);
    try {
      const r = await fetch(`/api/workspaces/${workspaceId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: picker, role: pickerRole }),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error || "Failed to add member");
        return;
      }
      setPicker("");
      setPickerRole("EDITOR");
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const handleChangeRole = async (userId: string, role: Role) => {
    setBusy(userId);
    setError(null);
    try {
      const r = await fetch(`/api/workspaces/${workspaceId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, role }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error || "Failed to update role");
        return;
      }
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const handleRemove = async (userId: string) => {
    setBusy(userId);
    setError(null);
    try {
      const r = await fetch(`/api/workspaces/${workspaceId}/members?userId=${encodeURIComponent(userId)}`, {
        method: "DELETE",
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error || "Failed to remove");
        return;
      }
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      onClick={() => { if (!busy) onClose(); }}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-surface border border-border shadow-xl p-5 space-y-3 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Members of {workspaceName}</h2>
            {isDefault && (
              <p className="text-xs text-muted-2 mt-0.5">
                Default workspace — everyone in the org sees it. Explicit members get listed here for future per-workspace permissioning.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={!!busy}
            className="p-1 rounded hover:bg-surface-2 text-muted"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Add member */}
        <div className="rounded-lg border border-border bg-surface p-2.5 space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-2">Add a teammate</p>
          {pickable.length === 0 ? (
            <p className="text-xs text-muted-2">Everyone in the org is already a member.</p>
          ) : (
            <div className="flex items-center gap-1.5">
              <select
                value={picker}
                onChange={(e) => setPicker(e.target.value)}
                className="flex-1 min-w-0 px-2.5 py-1.5 rounded-md border border-border bg-surface text-xs"
              >
                <option value="">Pick someone…</option>
                {pickable.map((u) => (
                  <option key={u.id} value={u.id}>
                    {userLabel(u)} · {u.email}
                  </option>
                ))}
              </select>
              <select
                value={pickerRole}
                onChange={(e) => setPickerRole(e.target.value as Role)}
                className="px-2.5 py-1.5 rounded-md border border-border bg-surface text-xs"
              >
                <option value="OWNER">Owner</option>
                <option value="EDITOR">Editor</option>
                <option value="VIEWER">Viewer</option>
              </select>
              <button
                type="button"
                onClick={handleAdd}
                disabled={!picker || !!busy}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium disabled:opacity-50"
              >
                {busy === picker ? <Loader2 size={11} className="animate-spin" /> : <UserPlus size={11} />}
                Add
              </button>
            </div>
          )}
        </div>

        {error && (
          <div className="rounded-md border border-rose-500/30 bg-rose-500/10 p-2.5 text-xs text-rose-700 dark:text-rose-300 inline-flex items-start gap-2">
            <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Members list */}
        {loading ? (
          <div className="py-6 text-xs text-muted-2 inline-flex items-center gap-2">
            <Loader2 size={12} className="animate-spin" /> Loading members…
          </div>
        ) : members.length === 0 ? (
          <div className="py-4 text-xs text-muted-2 text-center">
            No explicit members yet.
            {isDefault && <span className="block mt-0.5">Default workspace is org-wide visible regardless.</span>}
          </div>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface overflow-hidden">
            {members.map((m) => {
              const isBusy = busy === m.user.id;
              return (
                <li key={m.id} className="flex items-center gap-2 px-3 py-2">
                  <div className="w-7 h-7 rounded-full bg-violet-100 dark:bg-violet-950/30 text-violet-600 flex items-center justify-center text-xs font-semibold flex-shrink-0">
                    {(m.user.firstName?.[0] ?? m.user.email[0] ?? "?").toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{userLabel(m.user)}</p>
                    <p className="text-[11px] text-muted-2 truncate">{m.user.email}</p>
                  </div>
                  <div className="relative">
                    <select
                      value={m.role}
                      onChange={(e) => handleChangeRole(m.user.id, e.target.value as Role)}
                      disabled={isBusy}
                      className="text-xs px-2 py-1 pr-6 rounded border border-border bg-surface appearance-none"
                    >
                      <option value="OWNER">Owner</option>
                      <option value="EDITOR">Editor</option>
                      <option value="VIEWER">Viewer</option>
                    </select>
                    <ChevronDown size={10} className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-muted-2" />
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemove(m.user.id)}
                    disabled={isBusy}
                    className="p-1.5 rounded text-muted-2 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20 disabled:opacity-50"
                    title="Remove"
                    aria-label="Remove member"
                  >
                    {isBusy ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex items-center justify-end pt-2 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-md text-sm font-medium bg-violet-600 hover:bg-violet-700 text-white inline-flex items-center gap-1.5"
          >
            <Check size={12} /> Done
          </button>
        </div>
      </div>
    </div>
  );
}
