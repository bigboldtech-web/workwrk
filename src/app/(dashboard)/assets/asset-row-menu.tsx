"use client";

// The "…" overflow menu for one asset row. Same primitives as the rest of
// the app (MenuList / MenuItem via MorePortal, useConfirm for destructive):
//
//   Edit…            → shared form dialog (PATCH /api/assets/[id])   — page-owned
//   Assign / Reassign → assign dialog (PATCH assignedToId)           — page-owned
//   Unassign          → PATCH { assignedToId: null }  (when assigned)
//   Change status ›   → PATCH { status }
//   Check-out log     → Coming soon (no check-in/out backend yet)
//   Delete asset      → DELETE /api/assets/[id]  (destructive, confirmed)
//
// Mutations are enforced server-side (requirePermission); a 403 surfaces as
// a clear toast rather than a dead button.

import { useEffect, useRef, useState } from "react";
import {
  MoreHorizontal, Pencil, UserRound, UserMinus, CircleDot, LogOut, Trash2,
} from "lucide-react";
import { MenuList, MenuItem, MenuSeparator, MenuSubmenu } from "@/components/ui/menu";
import { MorePortal } from "@/components/layout/os/more-portal";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/dialog-provider";
import {
  STATUS_LABEL, STATUS_HUE, personName,
  type ApiAsset, type AssetStatus,
} from "./types";

// Statuses a person can set directly. ASSIGNED is intentionally excluded —
// it's derived from assigning an owner, not picked from a list.
const DIRECT_STATUSES: AssetStatus[] = ["AVAILABLE", "IN_REPAIR", "RETIRED", "LOST"];

export function AssetRowMenu({
  asset, onEdit, onAssign, onChanged,
}: {
  asset: ApiAsset;
  onEdit: (a: ApiAsset) => void;
  onAssign: (a: ApiAsset) => void;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const toast = useToast();
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
    try {
      const res = await fetch(`/api/assets/${asset.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast.error(
          "Couldn't update asset",
          res.status === 403 ? "You don't have permission for this." : (d?.error ?? `HTTP ${res.status}`),
        );
        return;
      }
      toast.success(okMsg);
      onChanged();
    } catch {
      toast.error("Network error", "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    close();
    const ok = await confirm({
      title: "Delete asset",
      description: `Delete "${asset.name}"? This removes it from the register permanently and can't be undone.`,
      destructive: true,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/assets/${asset.id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast.error(
          "Couldn't delete asset",
          res.status === 403 ? "You don't have permission for this." : (d?.error ?? `HTTP ${res.status}`),
        );
        return;
      }
      toast.success("Asset deleted");
      onChanged();
    } catch {
      toast.error("Network error", "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const isAssigned = Boolean(asset.assignedTo);

  return (
    <span className="ast__more" data-open={open ? "true" : "false"}>
      <button
        ref={btnRef}
        type="button"
        className="ast__more-btn"
        title="More actions"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); }}
      >
        <MoreHorizontal />
      </button>
      <MorePortal anchorRef={btnRef} panelRef={panelRef} width={210} open={open} placement="below">
        <MenuList className="min-w-[210px]" onClick={(e) => e.stopPropagation()}>
          <MenuItem icon={Pencil} label="Edit…" onClick={() => { close(); onEdit(asset); }} />
          <MenuItem
            icon={UserRound}
            label={isAssigned ? "Reassign…" : "Assign to…"}
            description={isAssigned ? personName(asset.assignedTo) || undefined : undefined}
            onClick={() => { close(); onAssign(asset); }}
          />
          {isAssigned && (
            <MenuItem icon={UserMinus} label="Unassign" onClick={() => void patch({ assignedToId: null }, "Asset unassigned")} />
          )}

          <MenuSeparator />
          <MenuSubmenu icon={CircleDot} label="Change status">
            {DIRECT_STATUSES.map((s) => (
              <MenuItem
                key={s}
                leading={<span className="ast__status-dot" style={{ background: STATUS_HUE[s] }} />}
                label={STATUS_LABEL[s]}
                selected={asset.status === s}
                onClick={() => void patch({ status: s }, `Status → ${STATUS_LABEL[s]}`)}
              />
            ))}
          </MenuSubmenu>

          <MenuItem icon={LogOut} label="Check-out log" badge={<span className="ast__soon">Soon</span>} disabled />

          <MenuSeparator />
          <MenuItem icon={Trash2} label="Delete asset" destructive onClick={() => void del()} />
        </MenuList>
      </MorePortal>
    </span>
  );
}
