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
import { Signature, Type, Calendar, PenLine, Trash2, Mail, CheckSquare, ChevronDown, UserPlus, X, Plus, CheckCircle2 } from "lucide-react";
import { BlockNoteCanvas } from "@/components/docs/blocknote-canvas";
import { PdfPages } from "@/components/agreements/pdf-pages";

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

const PARTY_COLORS = ["#f4a08c", "#f6c177", "#f2dd72", "#c8e06b", "#7fd4a8", "#6ec5d6", "#8ea2ee", "#c79df0"];
export function partyColor(parties: BuilderParty[], partyId: string): string {
  const i = Math.max(0, parties.findIndex((p) => p.id === partyId));
  return PARTY_COLORS[i % PARTY_COLORS.length];
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
  onAddParty: () => void;
  onRemoveParty: (id: string) => void;
  onRenameParty: (id: string, name: string) => void;
}

export function AgreementFieldBuilder({
  agreementId, content, sourceType, pdfUrl, parties, fields,
  onFieldsChange, onAddParty, onRemoveParty, onRenameParty,
}: Props) {
  const [activeParty, setActiveParty] = useState<string | null>(parties[0]?.id ?? null);
  const [selectedField, setSelectedField] = useState<string | null>(null);
  const [dragType, setDragType] = useState<FieldType | null>(null);
  const [editParty, setEditParty] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
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
        className={`group absolute flex cursor-move items-center justify-center rounded text-[11px] font-medium ${isSel ? "ring-2 ring-violet-400" : ""}`}
        style={{ left: f.x, top: f.y, width: f.w, height: f.h, border: `1.5px dashed ${color}`, background: `${color}22`, color: "#3f3f46" }}
      >
        <span className="pointer-events-none flex items-center gap-1 truncate px-1">
          <Icon className="h-3.5 w-3.5" />
          {f.type !== "checkbox" && <span className="truncate">{f.required ? "* " : ""}{f.label || fieldLabel(f.type)}</span>}
        </span>
        <span className="pointer-events-none absolute -left-1.5 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-semibold text-white" style={{ background: color }}>{partyIdx + 1}</span>
        <button type="button" onClick={(e) => { e.stopPropagation(); removeField(f.id); }}
          className="absolute -right-2 -top-2 hidden h-4 w-4 items-center justify-center rounded-full bg-white text-zinc-400 shadow group-hover:flex hover:text-red-500" style={{ border: `1px solid ${color}` }}>
          <Trash2 className="h-2.5 w-2.5" />
        </button>
        <span onMouseDown={(e) => startResize(e, f)} className="absolute -bottom-1 -right-1 h-3 w-3 cursor-se-resize rounded-full border border-white" style={{ background: color }} />
        {isSel && (
          <div onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}
            className="absolute left-0 top-full z-30 mt-2 w-52 rounded-lg border border-zinc-200 bg-white p-2.5 text-left shadow-lg" style={{ cursor: "default" }}>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[11px] font-semibold text-zinc-500">{fieldLabel(f.type)} · {party?.name ?? "Party"}</span>
              <button type="button" onClick={() => setSelectedField(null)} className="text-zinc-400 hover:text-zinc-700"><X className="h-3.5 w-3.5" /></button>
            </div>

            {f.type === "dropdown" && (() => {
              const opts = f.options ?? ["Option 1", "Option 2"];
              const setOpts = (next: string[]) => patchField(f.id, { options: next });
              return (
                <div className="mb-2">
                  <div className="mb-1 text-[12px] font-medium text-zinc-600">Options</div>
                  <div className="space-y-1.5">
                    {opts.map((o, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <input value={o} onChange={(e) => setOpts(opts.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`Option ${i + 1}`}
                          className="h-7 flex-1 rounded border border-zinc-200 px-2 text-[12px] outline-none focus:border-zinc-300" />
                        {opts.length > 1 && <button type="button" onClick={() => setOpts(opts.filter((_, j) => j !== i))} className="text-zinc-300 hover:text-red-500"><X className="h-3.5 w-3.5" /></button>}
                      </div>
                    ))}
                  </div>
                  <button type="button" onClick={() => setOpts([...opts, `Option ${opts.length + 1}`])} className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-medium text-violet-600 hover:text-violet-700"><Plus className="h-3 w-3" /> Add option</button>
                </div>
              );
            })()}

            <label className="flex cursor-pointer items-center justify-between gap-2 text-[12px] text-zinc-700">
              Required
              <button type="button" role="switch" aria-checked={!!f.required} onClick={() => patchField(f.id, { required: !f.required })}
                className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${f.required ? "bg-violet-600" : "bg-zinc-300"}`}>
                <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${f.required ? "left-3.5" : "left-0.5"}`} />
              </button>
            </label>

            {(f.type === "text" || f.type === "email" || f.type === "dropdown") && (
              <div className="mt-2">
                <div className="mb-1 text-[12px] font-medium text-zinc-600">Label</div>
                <input value={f.label ?? ""} onChange={(e) => patchField(f.id, { label: e.target.value })} placeholder="Label / placeholder"
                  className="h-7 w-full rounded border border-zinc-200 px-2 text-[12px] outline-none focus:border-zinc-300" />
              </div>
            )}

            {f.type === "dropdown" && (
              <div className="mt-2">
                <div className="mb-1 text-[12px] font-medium text-zinc-600">Default value</div>
                <select value={f.defaultValue ?? ""} onChange={(e) => patchField(f.id, { defaultValue: e.target.value })}
                  className="h-8 w-full rounded border border-zinc-200 bg-white px-2 text-[12px] text-zinc-700 outline-none">
                  <option value="">None</option>
                  {(f.options ?? []).map((o, i) => <option key={i} value={o}>{o}</option>)}
                </select>
              </div>
            )}

            <button type="button" onClick={() => removeField(f.id)} className="mt-2.5 inline-flex items-center gap-1 text-[12px] text-red-500 hover:text-red-600"><Trash2 className="h-3 w-3" /> Delete field</button>
          </div>
        )}
      </div>
    );
  }

  // Drop+overlay layer for a page (PDF: absolute over the canvas; written: the box itself).
  function pageDropProps(pageIdx: number) {
    return {
      ref: (el: HTMLDivElement | null) => registerPage(pageIdx, el),
      onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; },
      onDrop: (e: React.DragEvent) => dropOnPage(e, pageIdx),
      onClick: () => setSelectedField(null),
    };
  }

  return (
    <div className="flex gap-4">
      {/* ── Parties (left) ── */}
      <aside className="w-56 shrink-0">
        <div className="rounded-xl border border-zinc-200 bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[12px] font-semibold text-zinc-500">Parties</span>
            <span className="rounded bg-zinc-100 px-1.5 text-[11px] text-zinc-500">{parties.length}</span>
          </div>
          <div className="space-y-1.5">
            {parties.map((p) => {
              const on = selected === p.id;
              const editing = editParty === p.id;
              const color = partyColor(parties, p.id);
              const commit = () => { onRenameParty(p.id, draftName.trim() || p.name); setEditParty(null); };
              return (
                <div key={p.id}
                  onClick={() => { if (!editing) setActiveParty(p.id); }}
                  onDoubleClick={() => { setEditParty(p.id); setDraftName(p.name); }}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 transition-colors ${on ? "border-violet-300 bg-violet-50/40" : "border-zinc-200 hover:bg-zinc-50"}`}>
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-white" style={{ background: color }}><UserPlus className="h-3.5 w-3.5" /></span>
                  {editing ? (
                    <>
                      <input autoFocus value={draftName} onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setDraftName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditParty(null); }}
                        className="min-w-0 flex-1 rounded border border-violet-300 px-2 py-1 text-[13px] font-medium text-zinc-800 outline-none" />
                      <button type="button" onClick={(e) => { e.stopPropagation(); commit(); }} className="rounded-md bg-violet-600 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-violet-500">Save</button>
                    </>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-zinc-800">{p.name}</span>
                      {p.status === "SIGNED" ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" /> : null}
                      <button type="button" onClick={(e) => { e.stopPropagation(); onRemoveParty(p.id); }} className="rounded p-0.5 text-zinc-300 hover:text-red-500"><X className="h-3.5 w-3.5" /></button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <button type="button" onClick={onAddParty} className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-violet-300 px-2 py-1.5 text-[13px] font-medium text-violet-600 hover:bg-violet-50">
            <Plus className="h-3.5 w-3.5" /> Add new party
          </button>
        </div>
        <p className="mt-2 px-1 text-[11px] leading-relaxed text-zinc-400">Click a party to select it, then drag a field from the right onto the document. Double-click a party to rename it.</p>
      </aside>

      {/* ── Document (center) ── */}
      <div className="min-w-0 flex-1">
        {isPdf ? (
          <PdfPages url={pdfUrl!} width={760} renderPage={(i) => (
            <div {...pageDropProps(i)} className={`absolute inset-0 ${dragType ? "ring-2 ring-inset ring-violet-300" : ""}`}>
              {fields.filter((f) => (f.page ?? 0) === i).map(renderField)}
            </div>
          )} />
        ) : (
          <div {...pageDropProps(0)} className={`relative mx-auto w-[760px] max-w-full rounded-xl border bg-white px-10 py-7 ${dragType ? "border-violet-400 ring-2 ring-violet-200" : "border-zinc-200"}`}>
            <div className="pointer-events-none select-none">
              <BlockNoteCanvas key={`${agreementId}-build`} initialBnDoc={null} legacyBlocks={null} initialHtml={content || ""} readonly onChange={() => { /* readonly */ }} entity={{ type: "agreement", id: agreementId }} />
            </div>
            {fields.filter((f) => (f.page ?? 0) === 0).map(renderField)}
          </div>
        )}
      </div>

      {/* ── Fields (right) ── */}
      <aside className="w-52 shrink-0">
        <div className="rounded-xl border border-zinc-200 bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[12px] font-semibold text-zinc-500">Fields</span>
            {selected ? <span className="inline-flex items-center gap-1 rounded-full px-1.5 text-[11px] font-medium text-white" style={{ background: partyColor(parties, selected) }}>{parties.findIndex((p) => p.id === selected) + 1}</span> : null}
          </div>
          {!selected ? <div className="mb-2 rounded-md bg-amber-50 px-2 py-1.5 text-[11px] text-amber-700">Add &amp; select a party first.</div> : null}
          <div className="space-y-1.5">
            {FIELD_TOOLS.map((t) => (
              <div key={t.type}
                draggable={!!selected}
                onDragStart={(e) => { e.dataTransfer.setData("fieldType", t.type); e.dataTransfer.effectAllowed = "copy"; setDragType(t.type); }}
                onDragEnd={() => setDragType(null)}
                className={`flex items-center gap-2 rounded-lg border border-zinc-200 px-2.5 py-2 text-[13px] text-zinc-700 ${selected ? "cursor-grab hover:border-violet-300 hover:bg-violet-50 active:cursor-grabbing" : "cursor-not-allowed opacity-50"}`}
                title={selected ? "Drag onto the document" : "Select a party first"}>
                <t.Icon className="h-4 w-4 text-zinc-400" /> {t.label}
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-zinc-400">Drag a field onto the page. Click a placed field to set Required or delete it.</p>
        </div>
      </aside>
    </div>
  );
}
