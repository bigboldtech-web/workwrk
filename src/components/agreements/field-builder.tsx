"use client";

/* AgreementFieldBuilder — BreezeDoc-style 3-pane builder.
 *
 *  ┌────────────┬───────────────────────────┬────────────┐
 *  │  Parties   │        Document            │   Fields   │
 *  │ (select)   │  (drop target + overlay)  │ (drag src) │
 *  └────────────┴───────────────────────────┴────────────┘
 *
 * The party selected on the LEFT drives binding: a field dragged from the
 * RIGHT and dropped on the document is assigned to the selected party and
 * inherits its colour. Works on a written (BlockNote) document — a single
 * 760px page — or on an uploaded PDF rendered page-by-page at 760px, so field
 * coordinates round-trip stably to the signer. Each field stores its `page`.
 */

import { useCallback, useRef, useState } from "react";
import { Signature, Type, Calendar, PenLine, Trash2, Mail, CheckSquare, ChevronDown, X, Plus } from "lucide-react";
import { BlockNoteCanvas } from "@/components/docs/blocknote-canvas";
import { PdfPages } from "@/components/agreements/pdf-pages";
import { partyHue } from "@/lib/contracts";

export type FieldType = "signature" | "initials" | "text" | "email" | "date" | "checkbox" | "dropdown";
export interface PlacedField {
  id: string;
  type: FieldType;
  partyId: string;
  page?: number; // 0 for written docs; PDF page index otherwise
  x: number; y: number; w: number; h: number;
  label?: string;
  required?: boolean;
  options?: string[]; // dropdown choices
  defaultValue?: string; // dropdown default
}
export interface BuilderParty { id: string; name: string; role: string; email?: string; status?: string; token?: string; order?: number }

/** The party's hue: lib/contracts PARTY_HUES, indexed by party order (one source). */
export function partyColor(parties: BuilderParty[], partyId: string): string {
  return partyHue(Math.max(0, parties.findIndex((p) => p.id === partyId)));
}
export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

type ToolMeta = { type: FieldType; label: string; Icon: typeof Type; w: number; h: number };
const FIELD_TOOLS: ToolMeta[] = [
  { type: "signature", label: "Signature", Icon: Signature, w: 190, h: 52 },
  { type: "initials", label: "Initials", Icon: PenLine, w: 80, h: 46 },
  { type: "text", label: "Text", Icon: Type, w: 150, h: 34 },
  { type: "email", label: "Email", Icon: Mail, w: 180, h: 34 },
  { type: "checkbox", label: "Checkbox", Icon: CheckSquare, w: 28, h: 28 },
  { type: "date", label: "Date", Icon: Calendar, w: 130, h: 34 },
  { type: "dropdown", label: "Dropdown", Icon: ChevronDown, w: 150, h: 34 },
];
const TOOL_BY_TYPE = new Map(FIELD_TOOLS.map((t) => [t.type, t]));
function fieldLabel(t: FieldType) { return TOOL_BY_TYPE.get(t)?.label ?? "Field"; }
function newId() { return `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`; }

interface Props {
  agreementId: string;
  content: string;
  sourceType?: string;
  pdfUrl?: string | null;
  parties: BuilderParty[];
  fields: PlacedField[];
  onFieldsChange: (fields: PlacedField[]) => void;
  /**
   * spec-process section 2 `/agreements/[id]`: the parties and the field tools
   * live in the 272 right panel (PartiesPanel), so the builder renders the
   * document alone; the active party is controlled from outside and a
   * `pendingTool` is placed where the document is clicked.
   */
  activePartyId?: string | null;
  onActivePartyChange?: (id: string) => void;
  pendingTool?: FieldType | null;
  onToolPlaced?: () => void;
  /** The document width; 720 in the app's column, 760 on the older layout. */
  width?: number;
}

export function AgreementFieldBuilder({
  agreementId, content, sourceType, pdfUrl, parties, fields,
  onFieldsChange,
  activePartyId, pendingTool = null, onToolPlaced, width = 760,
}: Props) {
  // The active party is owned by the page (PartiesPanel); a caller that does
  // not control it gets the first party.
  const activeParty = activePartyId !== undefined ? activePartyId : (parties[0]?.id ?? null);
  const [selectedField, setSelectedField] = useState<string | null>(null);
  const [dragType, setDragType] = useState<FieldType | null>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const selected = parties.find((p) => p.id === activeParty) ? activeParty : (parties[0]?.id ?? null);
  const isPdf = sourceType === "pdf" && !!pdfUrl;
  const update = useCallback((next: PlacedField[]) => onFieldsChange(next), [onFieldsChange]);

  function registerPage(i: number, el: HTMLDivElement | null) { if (el) pageRefs.current.set(i, el); else pageRefs.current.delete(i); }

  function dropOnPage(e: React.DragEvent, pageIdx: number) {
    e.preventDefault();
    const type = (e.dataTransfer.getData("fieldType") || dragType) as FieldType | "";
    setDragType(null);
    const el = pageRefs.current.get(pageIdx);
    if (!type || !selected || !el) return;
    const rect = el.getBoundingClientRect();
    const spec = TOOL_BY_TYPE.get(type as FieldType)!;
    const x = Math.max(0, Math.min(rect.width - spec.w, e.clientX - rect.left - spec.w / 2));
    const y = Math.max(0, Math.min(rect.height - spec.h, e.clientY - rect.top - spec.h / 2));
    const f: PlacedField = { id: newId(), type: type as FieldType, partyId: selected, page: pageIdx, x, y, w: spec.w, h: spec.h, required: type === "signature" || type === "initials" };
    update([...fields, f]);
    setSelectedField(f.id);
  }

  function startMove(e: React.MouseEvent, f: PlacedField) {
    e.stopPropagation();
    setSelectedField(f.id);
    const el = pageRefs.current.get(f.page ?? 0);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const off = { dx: e.clientX - rect.left - f.x, dy: e.clientY - rect.top - f.y };
    const onMove = (ev: MouseEvent) => {
      const r = el.getBoundingClientRect();
      const x = Math.max(0, Math.min(r.width - f.w, ev.clientX - r.left - off.dx));
      const y = Math.max(0, Math.min(r.height - f.h, ev.clientY - r.top - off.dy));
      onFieldsChange(fields.map((ff) => (ff.id === f.id ? { ...ff, x, y } : ff)));
    };
    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
  }

  function startResize(e: React.MouseEvent, f: PlacedField) {
    e.stopPropagation(); e.preventDefault();
    const start = { sx: e.clientX, sy: e.clientY, sw: f.w, sh: f.h };
    const onMove = (ev: MouseEvent) => {
      const w = Math.max(40, start.sw + (ev.clientX - start.sx));
      const h = Math.max(22, start.sh + (ev.clientY - start.sy));
      onFieldsChange(fields.map((ff) => (ff.id === f.id ? { ...ff, w, h } : ff)));
    };
    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
  }

  function patchField(id: string, patch: Partial<PlacedField>) { update(fields.map((f) => (f.id === id ? { ...f, ...patch } : f))); }
  function removeField(id: string) { update(fields.filter((f) => f.id !== id)); if (selectedField === id) setSelectedField(null); }

  function renderField(f: PlacedField) {
    const color = partyColor(parties, f.partyId);
    const party = parties.find((p) => p.id === f.partyId);
    const partyIdx = parties.findIndex((p) => p.id === f.partyId);
    const Icon = TOOL_BY_TYPE.get(f.type)?.Icon ?? Type;
    const isSel = selectedField === f.id;
    return (
      <div
        key={f.id}
        onMouseDown={(e) => startMove(e, f)}
        onClick={(e) => { e.stopPropagation(); setSelectedField(f.id); }}
        className={`group absolute flex cursor-move items-center justify-center rounded text-xs font-medium ${isSel ? "ring-2 ring-[var(--os-brand)]" : ""}`}
        style={{ left: f.x, top: f.y, width: f.w, height: f.h, border: `1.5px dashed ${color}`, background: `${color}22`, color: "var(--os-ink)" }}
      >
        <span className="pointer-events-none flex items-center gap-1 truncate px-1">
          <Icon className="h-3.5 w-3.5" />
          {f.type !== "checkbox" && <span className="truncate">{f.required ? "* " : ""}{f.label || fieldLabel(f.type)}</span>}
        </span>
        <span className="pointer-events-none absolute -left-1.5 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-micro font-semibold text-white" style={{ background: color }}>{partyIdx + 1}</span>
        <button type="button" onClick={(e) => { e.stopPropagation(); removeField(f.id); }}
          className="absolute -right-2 -top-2 hidden h-4 w-4 items-center justify-center rounded-full bg-raised text-ink-2 shadow group-hover:flex hover:text-danger-text" style={{ border: `1px solid ${color}` }}>
          <Trash2 className="h-2.5 w-2.5" />
        </button>
        <span onMouseDown={(e) => startResize(e, f)} className="absolute -bottom-1 -right-1 h-3 w-3 cursor-se-resize rounded-full border border-white" style={{ background: color }} />
        {isSel && (
          <div onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}
            className="absolute left-0 top-full z-30 mt-2 w-52 rounded-lg border border-line bg-raised p-2.5 text-left shadow-[var(--os-shadow-pop)]" style={{ cursor: "default" }}>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-semibold text-ink-2">{fieldLabel(f.type)} · {party?.name ?? "Party"}</span>
              <button type="button" onClick={() => setSelectedField(null)} className="text-ink-2 hover:text-ink"><X className="h-3.5 w-3.5" /></button>
            </div>

            {f.type === "dropdown" && (() => {
              const opts = f.options ?? ["Option 1", "Option 2"];
              const setOpts = (next: string[]) => patchField(f.id, { options: next });
              return (
                <div className="mb-2">
                  <div className="mb-1 text-sm font-medium text-ink-2">Options</div>
                  <div className="space-y-1.5">
                    {opts.map((o, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <input value={o} onChange={(e) => setOpts(opts.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`Option ${i + 1}`}
                          className="h-7 flex-1 rounded border border-line-strong bg-raised px-2 text-sm text-ink outline-none focus:border-brand" />
                        {opts.length > 1 && <button type="button" onClick={() => setOpts(opts.filter((_, j) => j !== i))} className="text-ink-3 hover:text-danger-text"><X className="h-3.5 w-3.5" /></button>}
                      </div>
                    ))}
                  </div>
                  <button type="button" onClick={() => setOpts([...opts, `Option ${opts.length + 1}`])} className="mt-1.5 inline-flex items-center gap-1 text-sm font-medium text-brand-deep hover:underline"><Plus className="h-3 w-3" /> Add option</button>
                </div>
              );
            })()}

            <label className="flex cursor-pointer items-center justify-between gap-2 text-sm text-ink">
              Required
              <button type="button" role="switch" aria-checked={!!f.required} onClick={() => patchField(f.id, { required: !f.required })}
                className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${f.required ? "bg-brand" : "bg-line-strong"}`} style={{ background: f.required ? "var(--os-brand)" : "var(--os-line-strong)" }}>
                <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${f.required ? "left-3.5" : "left-0.5"}`} />
              </button>
            </label>

            {(f.type === "text" || f.type === "email" || f.type === "dropdown") && (
              <div className="mt-2">
                <div className="mb-1 text-sm font-medium text-ink-2">Label</div>
                <input value={f.label ?? ""} onChange={(e) => patchField(f.id, { label: e.target.value })} placeholder="Label / placeholder"
                  className="h-7 w-full rounded border border-line-strong bg-raised px-2 text-sm text-ink outline-none focus:border-brand" />
              </div>
            )}

            {f.type === "dropdown" && (
              <div className="mt-2">
                <div className="mb-1 text-sm font-medium text-ink-2">Default value</div>
                <select value={f.defaultValue ?? ""} onChange={(e) => patchField(f.id, { defaultValue: e.target.value })}
                  className="h-8 w-full rounded border border-line-strong bg-raised px-2 text-sm text-ink outline-none">
                  <option value="">None</option>
                  {(f.options ?? []).map((o, i) => <option key={i} value={o}>{o}</option>)}
                </select>
              </div>
            )}

            <button type="button" onClick={() => removeField(f.id)} className="mt-2.5 inline-flex items-center gap-1 text-sm text-danger-text hover:underline"><Trash2 className="h-3 w-3" /> Delete field</button>
          </div>
        )}
      </div>
    );
  }

  // Drop+overlay layer for a page (PDF: absolute over the canvas; written: the box itself).
  function placeAt(e: React.MouseEvent, pageIdx: number) {
    const el = pageRefs.current.get(pageIdx);
    if (!pendingTool || !selected || !el) return false;
    const rect = el.getBoundingClientRect();
    const spec = TOOL_BY_TYPE.get(pendingTool)!;
    const x = Math.max(0, Math.min(rect.width - spec.w, e.clientX - rect.left - spec.w / 2));
    const y = Math.max(0, Math.min(rect.height - spec.h, e.clientY - rect.top - spec.h / 2));
    const f: PlacedField = { id: newId(), type: pendingTool, partyId: selected, page: pageIdx, x, y, w: spec.w, h: spec.h, required: pendingTool === "signature" || pendingTool === "initials" };
    update([...fields, f]);
    setSelectedField(f.id);
    onToolPlaced?.();
    return true;
  }
  function pageDropProps(pageIdx: number) {
    return {
      ref: (el: HTMLDivElement | null) => registerPage(pageIdx, el),
      onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; },
      onDrop: (e: React.DragEvent) => dropOnPage(e, pageIdx),
      onClick: (e: React.MouseEvent) => { if (!placeAt(e, pageIdx)) setSelectedField(null); },
      style: pendingTool && selected ? ({ cursor: "crosshair" } as React.CSSProperties) : undefined,
    };
  }

  const doc = isPdf ? (
    <PdfPages url={pdfUrl!} width={width} renderPage={(i) => (
      <div {...pageDropProps(i)} className={`absolute inset-0 ${dragType || (pendingTool && selected) ? "ring-2 ring-inset ring-[var(--os-brand-soft)]" : ""}`}>
        {fields.filter((f) => (f.page ?? 0) === i).map(renderField)}
      </div>
    )} />
  ) : (
    <div {...pageDropProps(0)} className={`relative mx-auto max-w-full rounded-lg border bg-raised px-10 py-7 ${dragType || (pendingTool && selected) ? "border-brand ring-2 ring-[var(--os-brand-soft)]" : "border-line"}`} style={{ width, ...(pendingTool && selected ? { cursor: "crosshair" } : {}) }}>
      <div className="pointer-events-none select-none os-prose">
        <BlockNoteCanvas key={`${agreementId}-build`} initialBnDoc={null} legacyBlocks={null} initialHtml={content || ""} readonly onChange={() => { /* readonly */ }} entity={{ type: "agreement", id: agreementId }} />
      </div>
      {fields.filter((f) => (f.page ?? 0) === 0).map(renderField)}
    </div>
  );
  // The parties and the field tools live in the 272 right panel
  // (components/agreements/parties-panel.tsx, spec-process section 2
  // `/agreements/[id]`); the builder renders the document alone.
  return <div className="min-w-0 flex-1">{doc}</div>;
}
