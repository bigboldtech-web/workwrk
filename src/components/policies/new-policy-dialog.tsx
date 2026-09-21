"use client";

// The New policy modal (spec-process section 2 `/policies`), 560: Title
// (required), Category (a Picker over settings.process.policyCategories
// with the "Manage categories…" footer), Effective date (optional),
// "Requires acknowledgement" (on), one primary "Create" that lands on
// /policies/[id]?edit=1. No "Untitled policy" rows: the title is asked here.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Plus } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Picker, PickerFooterRow } from "@/components/ui/picker";
import { DateField } from "@/components/ui/date-field";
import { Switch } from "@/components/ui/switch";
import { Dots } from "@/components/ui/dots";
import { useOsToast } from "@/components/layout/os/toast";
import { apiFetch } from "@/lib/api-fetch";

const FIELD = "h-9 w-full rounded-md border border-line-strong bg-raised px-3 text-base text-ink placeholder:text-ink-3 focus:outline-none focus-visible:border-brand";
const LABEL = "text-sm font-medium text-ink-2";

export function NewPolicyDialog({ open, onClose, categories, onCreated }: {
  open: boolean;
  onClose: () => void;
  categories: string[];
  onCreated?: (id: string) => void;
}) {
  const router = useRouter();
  const { toast } = useOsToast();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [effective, setEffective] = useState<string | null>(null);
  const [requiresAck, setRequiresAck] = useState(true);
  const [catOpen, setCatOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [seenOpen, setSeenOpen] = useState(open);
  if (seenOpen !== open) { setSeenOpen(open); setCatOpen(false); if (open) { setTitle(""); setCategory(null); setEffective(null); setRequiresAck(true); } }

  async function create() {
    if (busy || !title.trim()) return;
    setBusy(true);
    const r = await apiFetch<{ id?: string; data?: { id?: string } }>("/api/policies", { method: "POST", json: { title: title.trim(), category, effectiveDate: effective, requiresAck, status: "DRAFT" } });
    setBusy(false);
    if (!r.ok) { toast(r.error || "Couldn't create the policy", { tone: "danger" }); return; }
    const id = r.data?.id ?? r.data?.data?.id;
    if (!id) { toast("Couldn't create the policy", { tone: "danger" }); return; }
    onCreated?.(id);
    onClose();
    router.push(`/policies/${id}?edit=1`);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !busy) onClose(); }}>
      <DialogContent className="max-w-[560px]">
        <DialogTitle>New policy</DialogTitle>
        <DialogDescription>It starts as a draft. Write it on the next page, then publish it to the people who must acknowledge it.</DialogDescription>
        <form className="mt-2 flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void create(); }}>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Title <span className="font-normal text-ink-3">(required)</span></span>
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Expense policy" className={FIELD} />
          </label>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <span className={LABEL}>Category</span>
              <span className="relative block">
                <button type="button" onClick={() => setCatOpen((o) => !o)} className={`${FIELD} flex items-center gap-2 text-start`}>
                  <span className={`min-w-0 flex-1 truncate ${category ? "" : "text-ink-3"}`}>{category ?? "None"}</span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.5} aria-hidden />
                </button>
                <Picker
                  open={catOpen}
                  onClose={() => setCatOpen(false)}
                  ariaLabel="Category"
                  selected={category}
                  onSelect={(v) => { setCategory(v === "__none__" ? null : v); setCatOpen(false); }}
                  sections={[{ options: [{ value: "__none__", label: "None" }, ...categories.map((c) => ({ value: c, label: c }))] }]}
                  footer={<PickerFooterRow onClick={() => router.push("/sops/manage?tab=policy-categories")}>Manage categories…</PickerFooterRow>}
                />
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className={LABEL}>Effective date</span>
              <DateField value={effective} onChange={setEffective} ariaLabel="Effective date" placeholder="Not set" />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-base text-ink">Requires acknowledgement <span className="block text-sm text-ink-2">People assigned to it must confirm they have read it.</span></span>
            <Switch checked={requiresAck} onChange={setRequiresAck} aria-label="Requires acknowledgement" />
          </div>
          <div className="mt-2 flex items-center justify-end gap-2">
            <button type="button" onClick={onClose} className="inline-flex h-9 items-center rounded-md px-3 text-base font-medium text-ink-2 hover:bg-hover hover:text-ink">Cancel</button>
            <button type="submit" disabled={busy || !title.trim()} className="inline-flex h-9 items-center gap-2 rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover disabled:bg-active disabled:text-ink-4">
              {busy ? <Dots variant="pending" /> : <Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden />} Create
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
