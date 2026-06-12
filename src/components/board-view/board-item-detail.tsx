"use client";

// BoardItemDetail — the shared body of a task's detail view. Rendered by
// both BoardItemDrawer (480px side panel) and the full-page task route
// (/tasks/[id]). Owns no data fetching: the host loads the item and passes
// it down with an onPatch callback. Sections: core field grid (status,
// owner, priority, tags, dates, type), custom fields (with search +
// hide-empty), description, subtasks, checklist, relations, linked
// attachments, time tracking, comments/activity.

import { useMemo, useState } from "react";
import { Check, ChevronDown, Search, EyeOff, Eye, X } from "lucide-react";
import type { BoardItemRow, StatusOption } from "@/lib/board-items-shared";
import type { FieldDef } from "@/lib/field-catalog";
import { AssigneePicker } from "./assignee-picker";
import { FieldValue } from "./field-value";
import { PriorityPicker } from "./priority-picker";
import { TagPicker } from "./tag-picker";
import { ItemThread } from "./item-thread";
import { LinkedAttachments } from "./linked-attachments";
import { TimeTracker } from "./time-tracker";
import { ItemTypePicker } from "./item-type-picker";
import { ItemSubtasks } from "./item-subtasks";
import { ItemChecklist } from "./item-checklist";

export type DetailPatch = Partial<Pick<BoardItemRow, "title" | "status">> & {
  metadata?: Record<string, unknown>;
  startAt?: string | null;
  dueAt?: string | null;
  ownerId?: string | null;
  priority?: string | null;
  tagIds?: string[];
  itemTypeId?: string | null;
};

interface BoardItemDetailProps {
  item: BoardItemRow;
  canEdit: boolean;
  currentUserId: string | null;
  customFields: FieldDef[];
  statusOptions: StatusOption[];
  onPatch: (body: DetailPatch, optimistic?: Partial<BoardItemRow>) => void;
  /** "drawer" (side panel) or "page" (full-page route). Affects spacing. */
  layout?: "drawer" | "page";
  /** When set, clicking a subtask navigates instead of doing nothing. */
  onOpenItem?: (itemId: string) => void;
}

function isEmptyValue(v: unknown): boolean {
  if (v == null || v === "") return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v as object).length === 0;
  return false;
}

export function BoardItemDetail({
  item,
  canEdit,
  currentUserId,
  customFields,
  statusOptions,
  onPatch,
  layout = "drawer",
  onOpenItem,
}: BoardItemDetailProps) {
  const [fieldSearch, setFieldSearch] = useState("");
  const [hideEmpty, setHideEmpty] = useState(false);

  const { shown, emptyCount } = useMemo(() => {
    const q = fieldSearch.trim().toLowerCase();
    let list = customFields;
    if (q) list = list.filter((f) => f.label.toLowerCase().includes(q));
    const emptyCount = list.filter((f) => isEmptyValue(item.metadata?.[f.key])).length;
    if (hideEmpty) list = list.filter((f) => !isEmptyValue(item.metadata?.[f.key]));
    return { shown: list, emptyCount };
  }, [customFields, fieldSearch, hideEmpty, item.metadata]);

  const pageWide = layout === "page";

  return (
    <div className={`space-y-5 ${pageWide ? "max-w-[760px]" : ""}`}>
      <TitleField item={item} canEdit={canEdit} onSave={(t) => onPatch({ title: t })} />

      {/* Core field grid */}
      <div className="space-y-3">
        <Row label="Status">
          <StatusPicker value={item.status} statuses={statusOptions} canEdit={canEdit} onChange={(v) => onPatch({ status: v })} />
        </Row>
        <Row label="Type">
          <ItemTypePicker value={item.itemTypeId ?? null} canEdit={canEdit} onChange={(id) => onPatch({ itemTypeId: id })} />
        </Row>
        <Row label="Owner">
          <AssigneePicker
            value={item.owner ? { ...item.owner, email: null } : null}
            canEdit={canEdit}
            onChange={(person) =>
              onPatch(
                { ownerId: person?.id ?? null },
                { owner: person ? { id: person.id, firstName: person.firstName ?? "", lastName: person.lastName ?? "", avatar: person.avatar } : null },
              )
            }
          />
        </Row>
        <Row label="Priority">
          <PriorityPicker value={item.priority ?? null} canEdit={canEdit} onChange={(priority) => onPatch({ priority })} />
        </Row>
        <Row label="Tags">
          <TagPicker value={item.tags ?? []} canEdit={canEdit} onChange={(tags) => onPatch({ tagIds: tags.map((t) => t.id) }, { tags })} />
        </Row>
        <Row label="Start date">
          <DateField value={item.startAt ?? null} canEdit={canEdit} onSave={(v) => onPatch({ startAt: v })} />
        </Row>
        <Row label="Due date">
          <DateField value={item.dueAt ?? null} canEdit={canEdit} onSave={(v) => onPatch({ dueAt: v })} />
        </Row>
      </div>

      {/* Custom fields with search + hide-empty */}
      {customFields.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs uppercase tracking-wide text-zinc-500">Fields</h3>
            <div className="flex items-center gap-1.5">
              <div className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md border border-zinc-200">
                <Search className="w-3 h-3 text-zinc-400" />
                <input value={fieldSearch} onChange={(e) => setFieldSearch(e.target.value)} placeholder="Search fields…" className="w-[110px] text-[12px] bg-transparent outline-none" />
              </div>
              {emptyCount > 0 ? (
                <button type="button" onClick={() => setHideEmpty((v) => !v)} className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11.5px] text-zinc-500 hover:bg-zinc-100">
                  {hideEmpty ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                  {hideEmpty ? `Show ${emptyCount} empty` : `Hide ${emptyCount} empty`}
                </button>
              ) : null}
            </div>
          </div>
          <div className="space-y-3">
            {shown.length === 0 ? (
              <p className="text-[12.5px] text-zinc-400">{fieldSearch ? "No matching fields." : "All fields empty."}</p>
            ) : (
              shown.map((f) => (
                <Row key={f.key} label={f.label}>
                  <FieldValue
                    field={f}
                    value={item.metadata?.[f.key]}
                    mode="edit"
                    disabled={!canEdit}
                    currentUserId={currentUserId}
                    onChange={(next) => onPatch({ metadata: { ...item.metadata, [f.key]: next } })}
                  />
                </Row>
              ))
            )}
          </div>
        </div>
      ) : null}

      <div className="space-y-1 text-[11px] text-zinc-400">
        <div>Created {new Date(item.createdAt).toLocaleString()}</div>
        <div>Updated {new Date(item.updatedAt).toLocaleString()}</div>
      </div>

      {/* Description */}
      <DescriptionField item={item} canEdit={canEdit} onSave={(desc) => onPatch({ metadata: { ...item.metadata, description: desc } })} />

      {/* Subtasks */}
      <ItemSubtasks item={item} canEdit={canEdit} statuses={statusOptions} onOpenItem={onOpenItem} />

      {/* Checklist (metadata-backed) */}
      <ItemChecklist item={item} canEdit={canEdit} onSave={(checklist) => onPatch({ metadata: { ...item.metadata, checklist } })} />

      {/* Linked notes + whiteboards + files + relations */}
      <LinkedAttachments sourceType="BOARD_ITEM" sourceId={item.id} spaceId={item.spaceId ?? null} canEdit={canEdit} />

      {/* Time tracking */}
      <TimeTracker entityType="BOARD_ITEM" entityId={item.id} canEdit={canEdit} />

      {/* Comments + Activity */}
      <ItemThread itemId={item.id} canEdit={canEdit} currentUserId={currentUserId} statuses={statusOptions} />
    </div>
  );
}

// ── Subcomponents (moved from BoardItemDrawer) ────────────────────

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-xs text-zinc-500 w-[88px] flex-shrink-0">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function DateField({ value, canEdit, onSave }: { value: Date | string | null; canEdit: boolean; onSave: (iso: string | null) => void }) {
  const toInputValue = (v: Date | string | null): string => {
    if (!v) return "";
    const d = v instanceof Date ? v : new Date(v);
    if (Number.isNaN(d.getTime())) return "";
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  };
  const inputValue = toInputValue(value);
  if (!canEdit) {
    return <span className="text-sm text-zinc-700">{inputValue ? new Date(inputValue).toLocaleDateString() : <span className="text-xs text-zinc-400">Not set</span>}</span>;
  }
  return (
    <div className="inline-flex items-center gap-1.5">
      <input
        type="date"
        value={inputValue}
        onChange={(e) => { const v = e.target.value; onSave(v ? `${v}T00:00:00.000Z` : null); }}
        className="h-7 px-2 text-sm border border-zinc-200 rounded bg-white focus:outline-none focus:border-zinc-400"
      />
      {inputValue ? <button type="button" onClick={() => onSave(null)} className="text-xs text-zinc-400 hover:text-zinc-700" aria-label="Clear date" title="Clear"><X className="w-3 h-3" /></button> : null}
    </div>
  );
}

function TitleField({ item, canEdit, onSave }: { item: BoardItemRow; canEdit: boolean; onSave: (title: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.title);
  const [syncedTitle, setSyncedTitle] = useState(item.title);
  if (syncedTitle !== item.title) { setSyncedTitle(item.title); setDraft(item.title); }

  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) { setDraft(item.title); setEditing(false); return; }
    if (trimmed !== item.title) onSave(trimmed);
    setEditing(false);
  };

  if (!canEdit || !editing) {
    return <button type="button" onClick={() => canEdit && setEditing(true)} className="w-full text-left text-lg font-semibold">{item.title}</button>;
  }
  return (
    <input
      autoFocus
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setDraft(item.title); setEditing(false); } }}
      className="w-full text-lg font-semibold bg-transparent outline-none border-b border-[var(--os-brand)]"
    />
  );
}

function DescriptionField({ item, canEdit, onSave }: { item: BoardItemRow; canEdit: boolean; onSave: (description: string) => void }) {
  const initial = typeof item.metadata?.description === "string" ? item.metadata.description : "";
  const [draft, setDraft] = useState(initial);
  const [synced, setSynced] = useState(initial);
  if (synced !== initial) { setSynced(initial); setDraft(initial); }
  return (
    <div>
      <h3 className="text-xs uppercase tracking-wide text-zinc-500 mb-2">Description</h3>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if (draft !== initial) onSave(draft); }}
        disabled={!canEdit}
        rows={4}
        placeholder={canEdit ? "Add a description…" : "No description"}
        className="w-full px-3 py-2 rounded-md border border-zinc-200 bg-white text-sm resize-y focus:outline-none focus:border-[var(--os-brand)] disabled:opacity-60"
      />
    </div>
  );
}

function StatusPicker({ value, statuses, canEdit, onChange }: { value: string | null; statuses: StatusOption[]; canEdit: boolean; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const current = value ? statuses.find((o) => o.value === value) ?? null : null;
  const pill = current ? (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium" style={{ background: `${current.color}22`, color: current.color }}>{current.label}</span>
  ) : (
    <span className="text-xs text-zinc-500">—</span>
  );
  if (!canEdit) return pill;
  return (
    <div className="relative inline-block">
      <button type="button" onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1.5">{pill}<ChevronDown className="w-3 h-3 text-zinc-500" /></button>
      {open ? (
        <div className="absolute z-10 mt-1 left-0 min-w-[180px] rounded-md border border-zinc-200 bg-white shadow-lg py-1" onMouseLeave={() => setOpen(false)}>
          {statuses.map((opt) => (
            <button key={opt.value} type="button" onClick={() => { onChange(opt.value); setOpen(false); }} className="flex items-center gap-2 w-full px-2 py-1.5 text-left text-sm hover:bg-zinc-50">
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium" style={{ background: `${opt.color}22`, color: opt.color }}>{opt.label}</span>
              {opt.value === value ? <Check className="w-3.5 h-3.5 ml-auto text-[var(--os-brand)]" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
