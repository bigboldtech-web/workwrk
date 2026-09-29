"use client";

// The "…" menu for one asset row (spec-tools-misc 2.2), rendered only for a
// viewer who can manage the row. Order: Open, Assign to, Unassign (when
// assigned), Change status, Edit, Copy link, then Delete. The "Check-out log
// · Soon" row is gone: it returns as a real row when the log exists.
//
//   Edit            the shared form dialog (PATCH /api/assets/[id]), page-owned
//   Assign          the assign dialog (PATCH assignedToId), page-owned
//   Unassign        PATCH { assignedToId: null }
//   Change status   PATCH { status }
//   Delete          DELETE /api/assets/[id], which moves it to Trash
//
// Rights come from the list response, so nothing renders that the API would
// answer 403 to; a 403 that still arrives is a toast, never a dead button.

import { useBoot } from "@/components/layout/os/boot-context";
import { useEffect, useRef, useState } from "react";
import {
  MoreHorizontal, Pencil, UserRound, UserMinus, CircleDot, Trash2, ExternalLink, Link2,
} from "lucide-react";
import { MenuList, MenuItem, MenuSeparator, MenuSubmenu } from "@/components/ui/menu";
import { MorePortal } from "@/components/layout/os/more-portal";
import { useOsToast } from "@/components/layout/os/toast";
import { useConfirm } from "@/components/ui/dialog-provider";
import { apiFetch } from "@/lib/api-fetch";
import { STATUS_LABEL, personName, statusColor, type ApiAsset, type AssetStatus, type AssetRights } from "./types";

// Statuses a person can set directly. ASSIGNED comes from assigning someone.
const DIRECT_STATUSES: AssetStatus[] = ["AVAILABLE", "IN_REPAIR", "RETIRED", "LOST"];

export function AssetRowMenu({ asset, rights, onEdit, onAssign, onOpen, onChanged }: {
  asset: ApiAsset;
  rights: AssetRights;
  onEdit: (a: ApiAsset) => void;
  onAssign: (a: ApiAsset) => void;
  onOpen: (a: ApiAsset) => void;
  onChanged: () => void;
}) {
  const { boot } = useBoot();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { toast } = useOsToast();
  const confirm = useConfirm();

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const close = () => setOpen(false);

  const patch = async (body: Record<string, unknown>, okMsg: string) => {
    close();
    setBusy(true);
    const r = await apiFetch(`/api/assets/${asset.id}`, { method: "PATCH", json: body });
    setBusy(false);
    if (!r.ok) {
      toast(r.status === 403 ? "You can't change this asset." : (r.error || "Couldn't update the asset"), { tone: "danger", action: { label: "Try again", onClick: () => void patch(body, okMsg) } });
      return;
    }
    toast(okMsg);
    onChanged();
  };

  const del = async () => {
    close();
    const ok = await confirm({
      title: `Delete ${asset.name}?`,
      description: `It moves to Trash. You can restore it from there for ${boot.org.trashDays} days.`,
      destructive: true,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    setBusy(true);
    const r = await apiFetch(`/api/assets/${asset.id}`, { method: "DELETE" });
    setBusy(false);
    if (!r.ok) {
      toast(r.status === 403 ? "You can't delete this asset." : (r.error || "Couldn't delete the asset"), { tone: "danger", action: { label: "Try again", onClick: () => void del() } });
      return;
    }
    toast(`${asset.name} moved to Trash`);
    onChanged();
  };

  const copyLink = async () => {
    close();
    try { await navigator.clipboard.writeText(`${window.location.origin}/assets?asset=${asset.id}`); toast("Link copied"); }
    catch { toast("Couldn't copy the link", { tone: "danger" }); }
  };

  const isAssigned = Boolean(asset.assignedTo);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        title="More actions"
        aria-label={`Actions for ${asset.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); }}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-50"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      <MorePortal anchorRef={btnRef} panelRef={panelRef} width={220} open={open} placement="below" onClose={close}>
        <MenuList className="min-w-[220px]" onClick={(e) => e.stopPropagation()} aria-label={`Actions for ${asset.name}`}>
          <MenuItem icon={ExternalLink} label="Open" onClick={() => { close(); onOpen(asset); }} />
          {rights.canAssign ? (
            <MenuItem
              icon={UserRound}
              label={isAssigned ? "Reassign" : "Assign to"}
              description={isAssigned ? personName(asset.assignedTo) || undefined : undefined}
              onClick={() => { close(); onAssign(asset); }}
            />
          ) : null}
          {rights.canAssign && isAssigned ? (
            <MenuItem icon={UserMinus} label="Unassign" onClick={() => void patch({ assignedToId: null }, "Unassigned")} />
          ) : null}
          {rights.canEdit ? (
            <MenuSubmenu icon={CircleDot} label="Change status">
              {DIRECT_STATUSES.map((s) => (
                <MenuItem
                  key={s}
                  leading={<span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: statusColor(s) }} aria-hidden />}
                  label={STATUS_LABEL[s]}
                  selected={asset.status === s}
                  onClick={() => void patch({ status: s }, `Status changed to ${STATUS_LABEL[s]}`)}
                />
              ))}
            </MenuSubmenu>
          ) : null}
          {rights.canEdit ? <MenuItem icon={Pencil} label="Edit" onClick={() => { close(); onEdit(asset); }} /> : null}
          <MenuItem icon={Link2} label="Copy link" onClick={() => void copyLink()} />
          {rights.canDelete ? (
            <>
              <MenuSeparator />
              <MenuItem icon={Trash2} label="Delete" destructive onClick={() => void del()} />
            </>
          ) : null}
        </MenuList>
      </MorePortal>
    </>
  );
}
