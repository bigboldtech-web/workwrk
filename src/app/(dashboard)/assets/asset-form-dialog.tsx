"use client";

// Add / edit an asset. Create mode POSTs /api/assets; edit mode PATCHes
// /api/assets/[id]. Offers only fields the Asset model + routes accept
// (name, type, brand, model, serial, IMEI, purchase date/cost, warranty,
// condition, notes, and — edit only — status). Assignment is a separate
// row action, so this form never sets an owner.

import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  ASSET_TYPES, ASSET_CONDITIONS, ASSET_STATUSES,
  CONDITION_LABEL, STATUS_LABEL, typeLabel,
  type ApiAsset,
} from "./types";

const SELECT_CLASS =
  "flex h-10 w-full rounded-lg border border-border bg-white dark:bg-surface-2 px-3 py-2 text-[13.5px] text-foreground " +
  "transition-fast hover:border-muted-2/60 focus-visible:outline-none focus-visible:border-[color:var(--accent)] " +
  "focus-visible:ring-[3px] focus-visible:ring-[color:var(--accent)]/15 disabled:cursor-not-allowed disabled:opacity-50";

type FormState = {
  name: string; type: string; brand: string; model: string;
  serialNumber: string; imeiNumber: string;
  purchaseDate: string; purchaseCost: string; warrantyExpiry: string;
  condition: string; status: string; notes: string;
};

function isoToDateInput(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function initialState(asset: ApiAsset | null): FormState {
  return {
    name: asset?.name ?? "",
    type: asset?.type ?? "LAPTOP",
    brand: asset?.brand ?? "",
    model: asset?.model ?? "",
    serialNumber: asset?.serialNumber ?? "",
    imeiNumber: asset?.imeiNumber ?? "",
    purchaseDate: isoToDateInput(asset?.purchaseDate),
    purchaseCost: asset?.purchaseCost != null ? String(asset.purchaseCost) : "",
    warrantyExpiry: isoToDateInput(asset?.warrantyExpiry),
    condition: asset?.condition ?? "GOOD",
    status: asset?.status ?? "AVAILABLE",
    notes: asset?.notes ?? "",
  };
}

export function AssetFormDialog({
  open, onOpenChange, asset, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Present = edit that asset; null/undefined = create a new one. */
  asset?: ApiAsset | null;
  onSaved: () => void;
}) {
  const isEdit = Boolean(asset);
  const toast = useToast();
  const [form, setForm] = useState<FormState>(() => initialState(asset ?? null));
  const [saving, setSaving] = useState(false);

  // Re-seed whenever the dialog opens (or the target asset changes) so a
  // reused instance never shows a previous asset's values.
  useEffect(() => {
    if (open) setForm(initialState(asset ?? null));
  }, [open, asset]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        type: form.type,
        brand: form.brand.trim() || null,
        model: form.model.trim() || null,
        serialNumber: form.serialNumber.trim() || null,
        imeiNumber: form.imeiNumber.trim() || null,
        purchaseDate: form.purchaseDate || null,
        purchaseCost: form.purchaseCost.trim() || null,
        warrantyExpiry: form.warrantyExpiry || null,
        condition: form.condition,
        notes: form.notes.trim() || null,
      };
      if (isEdit) payload.status = form.status;

      const res = await fetch(
        isEdit ? `/api/assets/${asset!.id}` : "/api/assets",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast.error(
          isEdit ? "Couldn't save asset" : "Couldn't add asset",
          res.status === 403 ? "You don't have permission for this." : (d?.error ?? `HTTP ${res.status}`),
        );
        return;
      }
      toast.success(isEdit ? "Asset saved" : "Asset added");
      onOpenChange(false);
      onSaved();
    } catch {
      toast.error("Network error", "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit asset" : "Add asset"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update this asset's details, condition and status."
              : "Register a physical asset. You can assign it to a person afterward."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3.5 py-1">
          <div className="grid gap-1.5">
            <Label htmlFor="ast-name">Name<span className="text-[#E2445C]"> *</span></Label>
            <Input
              id="ast-name"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder='e.g. "MacBook Pro 16&quot; — Design"'
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3.5">
            <div className="grid gap-1.5">
              <Label htmlFor="ast-type">Type</Label>
              <select
                id="ast-type"
                className={SELECT_CLASS}
                value={form.type}
                onChange={(e) => set("type", e.target.value)}
              >
                {ASSET_TYPES.map((t) => (
                  <option key={t} value={t}>{typeLabel(t)}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ast-condition">Condition</Label>
              <select
                id="ast-condition"
                className={SELECT_CLASS}
                value={form.condition}
                onChange={(e) => set("condition", e.target.value)}
              >
                {ASSET_CONDITIONS.map((c) => (
                  <option key={c} value={c}>{CONDITION_LABEL[c]}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3.5">
            <div className="grid gap-1.5">
              <Label htmlFor="ast-brand">Brand</Label>
              <Input id="ast-brand" value={form.brand} onChange={(e) => set("brand", e.target.value)} placeholder="Apple" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ast-model">Model</Label>
              <Input id="ast-model" value={form.model} onChange={(e) => set("model", e.target.value)} placeholder="A2991" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3.5">
            <div className="grid gap-1.5">
              <Label htmlFor="ast-serial">Serial number</Label>
              <Input id="ast-serial" value={form.serialNumber} onChange={(e) => set("serialNumber", e.target.value)} placeholder="C02…" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ast-imei">IMEI</Label>
              <Input id="ast-imei" value={form.imeiNumber} onChange={(e) => set("imeiNumber", e.target.value)} placeholder="For phones / tablets" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3.5">
            <div className="grid gap-1.5">
              <Label htmlFor="ast-pdate">Purchase date</Label>
              <Input id="ast-pdate" type="date" value={form.purchaseDate} onChange={(e) => set("purchaseDate", e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ast-pcost">Cost</Label>
              <Input id="ast-pcost" type="number" min="0" step="0.01" value={form.purchaseCost} onChange={(e) => set("purchaseCost", e.target.value)} placeholder="0.00" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ast-warranty">Warranty ends</Label>
              <Input id="ast-warranty" type="date" value={form.warrantyExpiry} onChange={(e) => set("warrantyExpiry", e.target.value)} />
            </div>
          </div>

          {isEdit && (
            <div className="grid gap-1.5">
              <Label htmlFor="ast-status">Status</Label>
              <select
                id="ast-status"
                className={SELECT_CLASS}
                value={form.status}
                onChange={(e) => set("status", e.target.value)}
              >
                {ASSET_STATUSES.map((s) => (
                  <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                ))}
              </select>
              <p className="text-[11.5px] text-muted-2">Assignment is managed from the row actions menu.</p>
            </div>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="ast-notes">Notes</Label>
            <Textarea id="ast-notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Anything worth recording…" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving ? "Saving…" : isEdit ? "Save changes" : "Add asset"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
