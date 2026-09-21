"use client";

// SignPreviewDialog (spec-process section 2 `/agreements/[id]`, the header
// ghost "Preview as signer"): the public sign page's read-only rendering in
// a 720 modal at 90vh, no signing. The document with every party's fields
// drawn over it: the previewed party's fields as the dashed brand outlines
// they will see, the other parties' fields as dashed line outlines. A Picker
// swaps the previewed party, so the sender can check each person's view
// before Send. Nothing here writes.

import { useState } from "react";
import { ChevronDown, PenLine } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Picker } from "@/components/ui/picker";
import { Dots } from "@/components/ui/dots";
import { BlockNoteCanvas } from "@/components/docs/blocknote-canvas";
import { PdfPages } from "@/components/agreements/pdf-pages";
import { FIELD_TYPE_LABEL, partyRoleLabel, remainingRequired, signingBarLabel } from "@/lib/contracts";

export interface PreviewField { id: string; type: string; partyId: string; page?: number; x: number; y: number; w: number; h: number; label?: string; required?: boolean }
export interface PreviewParty { id: string; name: string; role: string }

export function SignPreviewDialog({ open, onClose, title, content, sourceType, pdfUrl, fields, parties, orgName }: {
  open: boolean;
  onClose: () => void;
  title: string;
  content: string;
  sourceType: string;
  pdfUrl: string | null;
  fields: PreviewField[];
  parties: PreviewParty[];
  orgName: string;
}) {
  const [partyId, setPartyId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const party = parties.find((p) => p.id === partyId) ?? parties[0] ?? null;
  const mine = fields.filter((f) => party && f.partyId === party.id);

  const renderField = (f: PreviewField) => {
    const own = !!party && f.partyId === party.id;
    const base: React.CSSProperties = { position: "absolute", left: f.x, top: f.y, width: f.w, height: f.h };
    const label = f.label || FIELD_TYPE_LABEL[f.type as keyof typeof FIELD_TYPE_LABEL] || f.type;
    if (!own) return <div key={f.id} className="flex items-center justify-center overflow-hidden rounded border border-dashed border-line-strong bg-subtle text-xs text-ink-2" style={base} aria-label={label} />;
    return (
      <div key={f.id} className="flex items-center justify-center gap-1 overflow-hidden rounded border-2 border-dashed border-brand-deep bg-brand-soft text-xs font-medium text-brand-deep" style={base} aria-label={label}>
        {f.type === "signature" || f.type === "initials" ? <PenLine className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden /> : null}
        <span className="truncate">{f.type === "checkbox" ? "" : label}</span>
      </div>
    );
  };
  const onPage = (i: number) => fields.filter((f) => (f.page ?? 0) === i).map(renderField);
  const bottom = fields.filter((f) => (f.page ?? 0) === 0).reduce((m, f) => Math.max(m, f.y + f.h), 0) + 24;
  const { total } = remainingRequired(mine, {});

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-[768px] max-h-[90vh] gap-0 p-0">
        <div className="flex items-center gap-3 border-b border-line px-5 py-3">
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-row font-medium text-ink">Preview as signer</DialogTitle>
            <DialogDescription className="text-sm text-ink-2">What {party ? party.name : "a party"} sees on the signing page. Nothing here can be signed.</DialogDescription>
          </div>
          {parties.length > 1 && party ? (
            <span className="relative shrink-0">
              <button type="button" onClick={() => setPickerOpen((o) => !o)} className="inline-flex h-8 items-center gap-2 rounded-md border border-line-strong bg-raised px-2 text-sm text-ink" aria-label="Preview as">
                <span className="max-w-[160px] truncate">{party.name}</span>
                <ChevronDown className="h-4 w-4 text-ink-3" strokeWidth={1.5} aria-hidden />
              </button>
              <Picker open={pickerOpen} onClose={() => setPickerOpen(false)} ariaLabel="Preview as" selected={party.id} onSelect={(v) => { setPartyId(v); setPickerOpen(false); }} sections={[{ options: parties.map((p) => ({ value: p.id, label: p.name, description: partyRoleLabel(p.role) })) }]} width={240} />
            </span>
          ) : null}
        </div>
        <div className="os-chrome overflow-y-auto bg-app px-4 pb-24 pt-5 sm:px-6" style={{ maxHeight: "calc(90vh - 128px)" }}>
          <div className="mx-auto max-w-[720px]">
            <div className="mb-4 flex items-center gap-3 text-sm text-ink-2"><span className="truncate font-medium text-ink">{orgName}</span><span className="ms-auto shrink-0">Sent by you</span></div>
            <h2 className="text-xl font-semibold text-ink">{title || "Untitled contract"}</h2>
            {party ? <p className="mt-1 text-sm text-ink-2">You&apos;re signing as {party.name} · {partyRoleLabel(party.role)}</p> : <p className="mt-1 text-sm text-ink-2">Add a party to preview their view.</p>}
            <div className="mt-1 inline-flex items-center gap-2 text-sm text-ink-2"><Dots variant="quad-steps" done={1} total={4} label="Step 1 of 4" /><span>Review › Fill › Sign › Done</span></div>
            <div className="mt-5 -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              {sourceType === "pdf" && pdfUrl ? (
                <PdfPages url={pdfUrl} width={720} renderPage={(i) => <div className="absolute inset-0">{onPage(i)}</div>} />
              ) : (
                <div className="relative w-[720px] rounded-lg border border-line bg-raised px-10 py-7" style={{ minHeight: bottom }}>
                  <div className="pointer-events-none select-none os-prose">
                    <BlockNoteCanvas key={`preview-${party?.id ?? "none"}`} initialBnDoc={null} legacyBlocks={null} initialHtml={content || ""} readonly onChange={() => {}} entity={{ type: "agreement", id: "preview" }} />
                  </div>
                  {onPage(0)}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="flex h-14 items-center gap-3 border-t border-line bg-raised px-5">
          <span className="min-w-0 flex-1 truncate text-sm text-ink-2">{party ? signingBarLabel(mine, {}) : "No parties yet"}{total ? ` · ${total} required` : ""}</span>
          <span className="text-sm text-ink-3">Decline · Finish signing appear here for the party</span>
          <button type="button" onClick={onClose} className="inline-flex h-9 items-center rounded-md border border-line bg-raised px-3 text-base font-medium text-ink hover:bg-hover">Close</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
