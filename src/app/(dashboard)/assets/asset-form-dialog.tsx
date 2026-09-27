"use client";

// Add and edit an asset (spec-tools-misc 2.2), 560 wide on ui/dialog and
// the tokens. Create mode POSTs /api/assets; edit mode PATCHes
// /api/assets/[id]. Only fields the Asset model and routes accept (name,
// type, brand, model, serial, IMEI, purchase date and cost, warranty,
// condition, notes and, on edit only, status). Assignment is a separate
// action, so this form never sets an owner. "(required)" is a word, never a
// red asterisk. One primary: "Add asset" or "Save".

import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { useOsToast } from "@/components/layout/os/toast";
import { useConfirm } from "@/components/ui/dialog-provider";
import { apiFetch } from "@/lib/api-fetch";
import { useOrgCurrency } from "@/lib/org/use-org-currency";
import {
  ASSET_TYPES, ASSET_CONDITIONS, ASSET_STATUSES,
  CONDITION_LABEL, STATUS_LABEL, typeLabel,
  type ApiAsset,
} from "./types";

const INPUT = "h-9 w-full rounded-md border border-line-strong bg-raised px-3 text-base font-normal text-ink placeholder:text-ink-3";
const SELECT_CLASS = `${INPUT} appearance-none`;
const LABEL = "flex flex-col gap-1 text-sm font-medium text-ink";

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
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const { currency } = useOrgCurrency();
  const [form, setForm] = useState<FormState>(() => initialState(asset ?? null));
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(initialState(asset ?? null));

  async function close() {
    if (dirty && !(await confirm({ title: isEdit ? "Discard the changes?" : "Discard this asset?", description: "What you typed here is not saved.", confirmLabel: "Discard", destructive: true }))) return;
    onOpenChange(false);
  }

  // Re-seed whenever the dialog opens (or the target asset changes) so a
  // reused instance never shows a previous asset's values. Adjusted during
  // render (the React "store previous props" pattern), not in an effect.
  const seed = open ? (asset?.id ?? "new") : null;
  const [seeded, setSeeded] = useState<string | null>(null);
  if (seed !== seeded) {
    setSeeded(seed);
    if (seed) setForm(initialState(asset ?? null));
  }

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.name.trim()) { setProblem("Give the asset a name."); return; }
    setProblem(null);
    setSaving(true);
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
    const r = await apiFetch(isEdit ? `/api/assets/${asset!.id}` : "/api/assets", { method: isEdit ? "PATCH" : "POST", json: payload });
    setSaving(false);
    if (!r.ok) {
      setProblem(r.status === 403 ? "You can't change assets." : (r.error || (isEdit ? "Couldn't save the asset." : "Couldn't add the asset.")));
      return;
    }
    toast(isEdit ? "Asset saved" : `${form.name.trim()} added`);
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) void close(); else onOpenChange(true); }}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit asset" : "Add asset"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Change its details, condition and status." : "A physical thing the company owns. You can assign it to a person afterwards."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
          <label className={LABEL}>
            <span>Name <span className="font-normal text-ink-2">(required)</span></span>
            <input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="MacBook Pro 16, Design" autoFocus maxLength={120} className={INPUT} />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className={LABEL}>
              Type
              <select className={SELECT_CLASS} value={form.type} onChange={(e) => set("type", e.target.value)}>
                {ASSET_TYPES.map((t) => <option key={t} value={t}>{typeLabel(t)}</option>)}
              </select>
            </label>
            <label className={LABEL}>
              Condition
              <select className={SELECT_CLASS} value={form.condition} onChange={(e) => set("condition", e.target.value)}>
                {ASSET_CONDITIONS.map((c) => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className={LABEL}>
              Brand
              <input value={form.brand} onChange={(e) => set("brand", e.target.value)} placeholder="Apple" maxLength={80} className={INPUT} />
            </label>
            <label className={LABEL}>
              Model
              <input value={form.model} onChange={(e) => set("model", e.target.value)} placeholder="A2991" maxLength={80} className={INPUT} />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className={LABEL}>
              Serial number
              <input value={form.serialNumber} onChange={(e) => set("serialNumber", e.target.value)} maxLength={80} className={`${INPUT} font-mono text-sm`} />
            </label>
            <label className={LABEL}>
              IMEI
              <input value={form.imeiNumber} onChange={(e) => set("imeiNumber", e.target.value)} placeholder="Phones and tablets" maxLength={40} className={`${INPUT} font-mono text-sm`} />
            </label>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <label className={LABEL}>
              Purchase date
              <input type="date" value={form.purchaseDate} onChange={(e) => set("purchaseDate", e.target.value)} className={INPUT} />
            </label>
            <label className={LABEL}>
              <span>Cost <span className="font-normal text-ink-2">({currency})</span></span>
              <input type="number" min="0" step="0.01" value={form.purchaseCost} onChange={(e) => set("purchaseCost", e.target.value)} placeholder="0.00" className={`${INPUT} tabular-nums`} />
            </label>
            <label className={LABEL}>
              Warranty ends
              <input type="date" value={form.warrantyExpiry} onChange={(e) => set("warrantyExpiry", e.target.value)} className={INPUT} />
            </label>
          </div>

          {isEdit ? (
            <label className={LABEL}>
              Status
              <select className={SELECT_CLASS} value={form.status} onChange={(e) => set("status", e.target.value)}>
                {ASSET_STATUSES.filter((s) => s !== "ASSIGNED" || asset?.status === "ASSIGNED").map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
              <span className="text-xs font-normal text-ink-2">Assigned is set by assigning it to someone, from the row menu.</span>
            </label>
          ) : null}

          <label className={LABEL}>
            Notes
            <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3} maxLength={2000} className="rounded-md border border-line-strong bg-raised px-3 py-2 text-base font-normal text-ink placeholder:text-ink-3" />
          </label>

          {problem ? <p role="alert" className="text-sm text-danger-text">{problem}</p> : null}
        </div>

        <DialogFooter>
          <button type="button" onClick={() => void close()} disabled={saving} className="inline-flex h-9 items-center rounded-md px-3 text-base font-medium text-ink-2 hover:bg-hover hover:text-ink">Cancel</button>
          <button type="button" onClick={() => void submit()} disabled={saving} className="inline-flex h-9 items-center rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover disabled:opacity-50">
            {isEdit ? "Save" : "Add asset"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
