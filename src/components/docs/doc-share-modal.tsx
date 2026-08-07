"use client";

/* DocShareModal — ClickUp-parity Share popover for /docs/[id].
 *
 * Layout (Mobbin ClickUp share modal order): header · invite stub
 * (honest Coming soon) · public-link toggle + copy · private link ·
 * "Share with" member roles · Make private footer.
 *
 * Backed by /api/docs/[id]/sharing (Organization.settings.docSharing —
 * org config, NOT doc content, so plain fetch is correct and the doc
 * autosave path is untouched). Every mutation is optimistic; on failure
 * the previous state is restored and a toast fires.
 */

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Globe, Lock, X } from "lucide-react";
import { MorePortal } from "@/components/layout/os/more-portal";
import { MenuItem, MenuList, MenuSeparator } from "@/components/ui/menu";
import { Switch } from "@/components/ui/switch";
import { useOsToast } from "@/components/layout/os/toast";
import { PersonAvatar, type PersonRef } from "@/components/board-view/assignee-picker";

type DocRole = "edit" | "view";

interface SharingState {
  restricted: boolean;
  members: Record<string, DocRole>;
  publicUrl: string | null;
}

interface Props {
  docId: string;
  docTitle: string;
  createdById: string | null;
  meId: string | null;
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  viewerRole: DocRole;
}

function personName(p: PersonRef): string {
  const n = `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim();
  return n || p.email || "Unknown";
}

export function DocShareModal({
  docId, docTitle, createdById, meId, open, onClose, anchorRef, viewerRole,
}: Props) {
  const { toast } = useOsToast();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const roleMenuPanelRef = useRef<HTMLDivElement | null>(null);
  const roleAnchorRef = useRef<HTMLElement | null>(null);

  const [sharing, setSharing] = useState<SharingState | null>(null);
  const [users, setUsers] = useState<PersonRef[]>([]);
  const usersLoadedRef = useRef(false);
  const [q, setQ] = useState("");
  const [copied, setCopied] = useState(false);
  const [roleMenuFor, setRoleMenuFor] = useState<string | null>(null);

  // Load sharing config on open.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/docs/${docId}/sharing`, { cache: "no-store" });
        if (!res.ok) return;
        const d = await res.json();
        if (cancelled) return;
        setSharing({
          restricted: !!d.sharing?.restricted,
          members: d.sharing?.members ?? {},
          publicUrl: d.sharing?.publicUrl ?? null,
        });
      } catch { /* panel stays in loading state */ }
    })();
    return () => { cancelled = true; };
  }, [open, docId]);

  // Load org members once (same source as field-value.tsx people cells).
  useEffect(() => {
    if (!open || usersLoadedRef.current || viewerRole !== "edit") return;
    usersLoadedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/users?scope=all&limit=200", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const items: PersonRef[] = Array.isArray(data?.data) ? data.data : [];
        if (!cancelled) setUsers(items);
      } catch { /* list stays empty */ }
    })();
    return () => { cancelled = true; };
  }, [open, viewerRole]);

  // Outside-click + Escape dismiss (same pattern as the peek picker in
  // block-doc-editor). The role submenu is its own portal, so clicks
  // inside it must not close the modal.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node | null;
      if (!t) return;
      if (panelRef.current?.contains(t)) return;
      if (roleMenuPanelRef.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
      setRoleMenuFor(null);
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (roleMenuFor) setRoleMenuFor(null);
      else onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchorRef, roleMenuFor]);

  async function patchSharing(body: Record<string, unknown>): Promise<SharingState | null> {
    try {
      const res = await fetch(`/api/docs/${docId}/sharing`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) return null;
      const d = await res.json().catch(() => null);
      if (!d?.sharing) return null;
      return {
        restricted: !!d.sharing.restricted,
        members: d.sharing.members ?? {},
        publicUrl: d.sharing.publicUrl ?? null,
      };
    } catch {
      return null;
    }
  }

  async function setRole(userId: string, role: DocRole | null) {
    if (!sharing) return;
    const prev = sharing;
    const members = { ...sharing.members };
    if (role) members[userId] = role;
    else delete members[userId];
    setSharing({ ...sharing, members });
    setRoleMenuFor(null);
    const fresh = await patchSharing({ members });
    if (fresh) setSharing(fresh);
    else { setSharing(prev); toast("Couldn't update sharing"); }
  }

  async function togglePublic(next: boolean) {
    if (!sharing) return;
    const prev = sharing;
    // Optimistic for OFF; ON needs the server-minted URL from the response.
    if (!next) setSharing({ ...sharing, publicUrl: null });
    const fresh = await patchSharing({ publicLink: next });
    if (fresh) {
      setSharing(fresh);
      if (!next) toast("Public link turned off");
    } else {
      setSharing(prev);
      toast("Couldn't update sharing");
    }
  }

  async function toggleRestricted() {
    if (!sharing) return;
    const prev = sharing;
    const next = !sharing.restricted;
    setSharing({ ...sharing, restricted: next });
    const fresh = await patchSharing({ restricted: next });
    if (fresh) setSharing(fresh);
    else { setSharing(prev); toast("Couldn't update sharing"); }
  }

  function copyPublic() {
    if (!sharing?.publicUrl) return;
    void navigator.clipboard.writeText(`${window.location.origin}${sharing.publicUrl}`).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }

  function copyInApp() {
    const url = `${window.location.origin}/docs/${docId}`;
    void navigator.clipboard.writeText(url).then(() => toast("Link copied"));
  }

  const needle = q.trim().toLowerCase();
  const rows = needle
    ? users.filter((u) => personName(u).toLowerCase().includes(needle) || (u.email ?? "").toLowerCase().includes(needle))
    : users;
  const canEdit = viewerRole === "edit";
  const menuUserRole = roleMenuFor ? sharing?.members[roleMenuFor] : undefined;

  return (
    <>
      <MorePortal anchorRef={anchorRef} width={440} open={open} placement="below" panelRef={panelRef}>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-[0_16px_48px_rgba(0,0,0,0.14)]">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[13px] font-semibold text-zinc-900">Share this doc</div>
              <div className="mt-0.5 max-w-[340px] truncate text-[12px] text-zinc-500">{docTitle}</div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid h-6 w-6 place-items-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {canEdit && (
            <>
              {/* Invite stub — honest Coming soon (no guest-invite backend yet). */}
              <button
                type="button"
                onClick={() => toast("Guest invites are coming soon")}
                className="mt-3 flex h-8 w-full items-center justify-between rounded-md border border-zinc-200 px-2.5 text-[12.5px] text-zinc-400 hover:border-zinc-300"
              >
                <span>Invite by name or email</span>
                <span className="inline-flex h-6 items-center rounded-md bg-zinc-900 px-2.5 text-[12px] font-semibold text-white">Invite</span>
              </button>

              {/* Public link */}
              <div className="mt-3 flex h-8 items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-zinc-700">
                  <Globe className="h-3.5 w-3.5 text-zinc-400" /> Share link with anyone
                </span>
                <Switch
                  checked={!!sharing?.publicUrl}
                  disabled={!sharing}
                  onChange={(next) => void togglePublic(next)}
                  aria-label="Public share link"
                />
              </div>
              {sharing?.publicUrl ? (
                <>
                  <button
                    type="button"
                    onClick={copyPublic}
                    className="mt-2 h-8 w-full rounded-md bg-zinc-900 text-[12.5px] font-semibold text-white hover:bg-zinc-800"
                  >
                    {copied ? "Copied!" : "Copy public link"}
                  </button>
                  <p className="mt-1.5 text-[11.5px] text-zinc-400">Anyone with this link can view. Turn off to revoke it.</p>
                </>
              ) : (
                <p className="mt-1.5 text-[11.5px] text-zinc-400">Off. Only workspace members with access can open this doc.</p>
              )}

              <div className="my-3 h-px bg-zinc-100" />
            </>
          )}

          {/* Private (in-app) link — every role may copy it. */}
          <div className={`flex h-7 items-center justify-between ${canEdit ? "" : "mt-3"}`}>
            <span className="text-[12.5px] font-medium text-zinc-700">Private link</span>
            <button
              type="button"
              onClick={copyInApp}
              className="text-[12.5px] font-medium text-[var(--os-brand-ink)] hover:underline"
            >
              Copy link
            </button>
          </div>

          {canEdit && (
            <>
              {/* Share with — per-member roles */}
              <div className="mt-3 mb-1 text-[12px] font-medium text-zinc-500">Share with</div>
              <input
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search people"
                className="h-7 w-full rounded-md border border-zinc-200 px-2 text-[12.5px] text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-[var(--os-brand)]"
              />
              <div className="mt-1 max-h-[220px] overflow-y-auto">
                {rows.length === 0 ? (
                  <div className="px-1.5 py-2 text-[12px] text-zinc-400">
                    {users.length === 0 ? "Loading people…" : "No matches"}
                  </div>
                ) : (
                  rows.map((u) => {
                    const isOwner = createdById !== null && u.id === createdById;
                    const listed = sharing?.members[u.id];
                    const label = listed === "edit" ? "Full edit" : listed === "view" ? "Can view" : "Default";
                    return (
                      <div key={u.id} className="flex h-8 items-center gap-2 rounded-md px-1.5 hover:bg-zinc-50">
                        <PersonAvatar person={u} size={22} />
                        <span className="min-w-0 flex-1 truncate text-[12.5px] text-zinc-800">
                          {personName(u)}
                          {meId === u.id ? <span className="text-zinc-400"> (you)</span> : null}
                        </span>
                        {isOwner ? (
                          <span className="text-[12px] text-zinc-400">Owner</span>
                        ) : (
                          <button
                            type="button"
                            disabled={!sharing}
                            onClick={(e) => {
                              roleAnchorRef.current = e.currentTarget;
                              setRoleMenuFor((cur) => (cur === u.id ? null : u.id));
                            }}
                            className="inline-flex h-6 items-center gap-0.5 rounded px-1.5 text-[12px] text-zinc-500 hover:bg-zinc-100"
                          >
                            {label}
                            <ChevronDown className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Make private footer */}
              <button
                type="button"
                onClick={() => void toggleRestricted()}
                disabled={!sharing}
                className="mt-3 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-zinc-200 text-[12.5px] font-medium text-zinc-700 hover:bg-zinc-50"
              >
                <Lock className="h-3.5 w-3.5" />
                {sharing?.restricted ? "Make workspace-visible" : "Make private"}
              </button>
              <p className="mt-1 text-[11.5px] text-zinc-400">
                {sharing?.restricted
                  ? "Only you, admins, and the people listed above can open this doc."
                  : "Everyone in the workspace keeps their current access."}
              </p>
            </>
          )}
        </div>
      </MorePortal>

      {/* Per-member role menu (second portal so it escapes the panel). */}
      <MorePortal
        anchorRef={roleAnchorRef}
        width={160}
        open={open && roleMenuFor !== null}
        placement="below"
        panelRef={roleMenuPanelRef}
      >
        <MenuList>
          <MenuItem
            label="Full edit"
            selected={menuUserRole === "edit"}
            onClick={() => { if (roleMenuFor) void setRole(roleMenuFor, "edit"); }}
          />
          <MenuItem
            label="Can view"
            selected={menuUserRole === "view"}
            onClick={() => { if (roleMenuFor) void setRole(roleMenuFor, "view"); }}
          />
          <MenuSeparator />
          <MenuItem
            label="Default access"
            selected={!menuUserRole}
            onClick={() => { if (roleMenuFor) void setRole(roleMenuFor, null); }}
          />
        </MenuList>
      </MorePortal>
    </>
  );
}
