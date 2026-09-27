"use client";

// The Asset drawer (spec-tools-misc 2.2), 520 wide at /assets?asset=<id>:
// the fields in three groups (Identity, Money and cover, State), then the
// Danger card for a viewer who can delete. No Share: an Asset is not a
// ladder object. Copy link and Close in the header. Edit and Assign open
// the same dialogs the row menu opens.

import { useCallback, useEffect, useState } from "react";
import { Link2, Pencil, Trash2, UserRound, X } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { useOsToast } from "@/components/layout/os/toast";
import { useBoot } from "@/components/layout/os/boot-context";
import { useConfirm } from "@/components/ui/dialog-provider";
import { EntityTile, NEUTRAL_TILE } from "@/components/ui/entity-tile";
import { StatusChip } from "@/components/ui/chip";
import { Avatar } from "@/components/ui/avatar-stack";
import { SkeletonLines } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api-fetch";
import { formatDate } from "@/lib/format/date";
import { useDatePrefs } from "@/lib/format/use-date-prefs";
import { useOrgCurrency } from "@/lib/org/use-org-currency";
import { warrantyState } from "@/lib/assets/asset-view";
import { CONDITION_LABEL, STATUS_LABEL, personName, statusColor, typeLabel, type ApiAsset, type AssetRights } from "./types";
import { assetGlyph } from "./asset-glyph";

export function AssetDrawer({ id, rights, onClose, onEdit, onAssign, onChanged }: {
  id: string | null;
  rights: AssetRights;
  onClose: () => void;
  onEdit: (a: ApiAsset) => void;
  onAssign: (a: ApiAsset) => void;
  onChanged: () => void;
}) {
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const { boot } = useBoot();
  const datePrefs = useDatePrefs();
  const { formatExact: money } = useOrgCurrency();
  const [asset, setAsset] = useState<ApiAsset | null>(null);
  const [state, setState] = useState<"ok" | "missing" | "failed">("ok");

  const load = useCallback(async (assetId: string) => {
    const r = await apiFetch<ApiAsset>(`/api/assets/${assetId}`, { cache: "no-store" });
    if (!r.ok) { setState(r.status === 404 ? "missing" : "failed"); return; }
    setState("ok");
    setAsset(r.data);
  }, []);
  useEffect(() => {
    if (!id) return;
    const t = setTimeout(() => { setAsset(null); void load(id); }, 0);
    return () => clearTimeout(t);
  }, [id, load]);

  async function copyLink() {
    if (!asset) return;
    try { await navigator.clipboard.writeText(`${window.location.origin}/assets?asset=${asset.id}`); toast("Link copied"); }
    catch { toast("Couldn't copy the link", { tone: "danger" }); }
  }

  async function remove() {
    if (!asset) return;
    const ok = await confirm({
      title: `Delete ${asset.name}?`,
      description: `It moves to Trash. You can restore it from there for ${boot.org.trashDays} days.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    const r = await apiFetch(`/api/assets/${asset.id}`, { method: "DELETE" });
    if (!r.ok) { toast(r.error || "Couldn't delete the asset", { tone: "danger", action: { label: "Try again", onClick: () => void remove() } }); return; }
    toast(`${asset.name} moved to Trash`);
    onChanged();
    onClose();
  }

  const w = asset ? warrantyState(asset.warrantyExpiry) : null;
  const warrantyText = !asset ? "" : w?.kind === "none" ? "None" : w?.kind === "expired" ? `Expired · ${formatDate(asset.warrantyExpiry, datePrefs)}` : w?.kind === "soon" ? `${formatDate(asset.warrantyExpiry, datePrefs)} · in ${w.days} ${w.days === 1 ? "day" : "days"}` : formatDate(asset.warrantyExpiry, datePrefs);

  return (
    <Drawer
      open={Boolean(id)}
      onClose={onClose}
      ariaLabel="Asset"
      layerId="asset-drawer"
      header={
        <div className="flex h-12 items-center gap-2 px-4">
          <span className="min-w-0 flex-1 truncate text-sm text-ink-2">Assets › <span className="text-ink">{asset?.name ?? ""}</span></span>
          {asset ? (
            <button type="button" aria-label="Copy link" title="Copy link" onClick={() => void copyLink()} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
              <Link2 className="h-4 w-4" />
            </button>
          ) : null}
          <button type="button" aria-label="Close" title="Close" onClick={onClose} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>
      }
    >
      {state === "missing" ? (
        <OsEmptyView title="This asset isn't here any more." compact />
      ) : state === "failed" ? (
        <OsEmptyView variant="error" title="Couldn't load this asset" action={{ label: "Try again", onClick: () => id && void load(id) }} compact />
      ) : !asset ? (
        <div className="p-4"><SkeletonLines lines={8} /></div>
      ) : (
        <div className="flex flex-col gap-6 p-4">
          <div className="flex items-center gap-3">
            <EntityTile size="lg" icon={assetGlyph(asset.type)} {...NEUTRAL_TILE} />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-title font-semibold text-ink">{asset.name}</h2>
              <div className="mt-1 flex items-center gap-2">
                <StatusChip color={statusColor(asset.status)} label={STATUS_LABEL[asset.status]} />
                <span className="text-sm text-ink-2">{typeLabel(asset.type)}</span>
              </div>
            </div>
          </div>

          {(rights.canEdit || rights.canAssign) ? (
            <div className="flex flex-wrap gap-2">
              {rights.canEdit ? <GhostButton icon={Pencil} label="Edit" onClick={() => onEdit(asset)} /> : null}
              {rights.canAssign ? <GhostButton icon={UserRound} label={asset.assignedTo ? "Reassign" : "Assign to"} onClick={() => onAssign(asset)} /> : null}
            </div>
          ) : null}

          <Section title="Identity">
            <Row label="Name" value={asset.name} />
            <Row label="Type" value={typeLabel(asset.type)} />
            <Row label="Brand" value={asset.brand} />
            <Row label="Model" value={asset.model} />
            <Row label="Serial" value={asset.serialNumber} mono />
            <Row label="IMEI" value={asset.imeiNumber} mono />
          </Section>

          <Section title="Money and cover">
            <Row label="Purchase date" value={asset.purchaseDate ? formatDate(asset.purchaseDate, datePrefs) : null} />
            <Row label="Purchase cost" value={asset.purchaseCost != null ? money(asset.purchaseCost) : null} />
            <Row label="Warranty" value={warrantyText} danger={w?.kind === "expired" || w?.kind === "soon"} />
          </Section>

          <Section title="State">
            <Row label="Condition" value={CONDITION_LABEL[asset.condition]} />
            <Row label="Status" value={STATUS_LABEL[asset.status]} />
            <div className="flex min-h-9 items-center gap-3 text-sm">
              <span className="w-[120px] shrink-0 font-medium text-ink-2">Assigned to</span>
              {asset.assignedTo ? (
                <span className="flex min-w-0 items-center gap-2 text-base text-ink">
                  <Avatar person={{ id: asset.assignedTo.id, firstName: asset.assignedTo.firstName, lastName: asset.assignedTo.lastName, avatar: asset.assignedTo.avatar }} size={24} />
                  <span className="truncate">{personName(asset.assignedTo) || "Someone"}</span>
                  {asset.assignedAt ? <span className="text-sm text-ink-2">since {formatDate(asset.assignedAt, datePrefs, "date")}</span> : null}
                </span>
              ) : <span className="text-base text-ink-2">Unassigned</span>}
            </div>
            <Row label="Notes" value={asset.notes} multiline />
          </Section>

          {rights.canDelete ? (
            <section className="rounded-lg border border-danger-soft p-3">
              <button type="button" onClick={() => void remove()} className="inline-flex h-8 items-center gap-2 rounded-md px-2 text-sm font-medium text-danger-text hover:bg-danger-bg">
                <Trash2 className="h-4 w-4" /> Delete asset
              </button>
            </section>
          ) : null}
        </div>
      )}
    </Drawer>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-0.5">
      <h3 className="mb-1 text-lg font-semibold text-ink">{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, value, mono, multiline, danger }: { label: string; value: string | null | undefined; mono?: boolean; multiline?: boolean; danger?: boolean }) {
  return (
    <div className={`flex ${multiline ? "items-start py-1.5" : "min-h-9 items-center"} gap-3 text-sm`}>
      <span className="w-[120px] shrink-0 font-medium text-ink-2">{label}</span>
      {value ? (
        <span className={`min-w-0 flex-1 ${multiline ? "whitespace-pre-wrap break-words" : "truncate"} ${mono ? "font-mono text-sm tabular-nums" : "text-base"} ${danger ? "text-danger-text" : "text-ink"}`}>{value}</span>
      ) : (
        <span className="text-base text-ink-3">None</span>
      )}
    </div>
  );
}

function GhostButton({ icon: Icon, label, onClick }: { icon: typeof Pencil; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-raised px-2.5 text-sm font-medium text-ink hover:bg-hover">
      <Icon className="h-4 w-4" aria-hidden />{label}
    </button>
  );
}
