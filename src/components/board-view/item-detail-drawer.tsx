"use client";

// ItemDetailDrawer — right-side slide-in for any BoardView row. Renders
// the core fields as editable inputs (same per-fieldType editors used
// in the Table view) and embeds <CustomFieldsPanel> so the org's
// custom fields show up automatically. Drop into any module page:
//
//   <ItemDetailDrawer
//     open={!!openItem}
//     onClose={() => setOpenItem(null)}
//     item={openItem}
//     title={openItem ? `${openItem.firstName} ${openItem.lastName}` : ""}
//     entityType="LEAD"
//     fields={LEAD_FIELDS}
//     editableFields={["status", "source"]}
//     getValue={(l, k) => l[k]}
//     onChangeField={async (id, key, value) => { ... await refresh() }}
//   />

import { useEffect } from "react";
import { X } from "lucide-react";
import type { BoardField } from "./board-view";
import { CustomFieldsPanel } from "@/components/custom-fields/custom-fields-panel";

interface Props<T> {
  open: boolean;
  onClose: () => void;
  item: T | null;
  title: string;
  /** Polymorphic entityType passed to CustomFieldsPanel (e.g. "LEAD"). */
  entityType: string;
  fields: BoardField[];
  getValue: (item: T, fieldKey: string) => unknown;
  /** Stable id getter — defaults to item.id. */
  getId?: (item: T) => string;
  /** If supplied, those field keys render as editable inputs. */
  editableFields?: string[];
  onChangeField?: (id: string, fieldKey: string, value: unknown) => Promise<void> | void;
  /** Optional extra content rendered below custom fields (activity, related, etc.). */
  children?: React.ReactNode;
  /** Optional right-aligned action buttons in the header. */
  headerActions?: React.ReactNode;
}

export function ItemDetailDrawer<T>(props: Props<T>) {
  const { open, onClose, item, title, entityType, fields, getValue, editableFields, onChangeField, children, headerActions } = props;
  const getId = props.getId ?? ((it: T) => (it as { id: string }).id);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !item) return null;

  const id = getId(item);
  const editable = editableFields ?? fields.map((f) => f.key);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close detail drawer"
        onClick={onClose}
        className="absolute inset-0 bg-black/30 backdrop-blur-[1px]"
      />
      <aside className="relative h-full w-full max-w-[480px] bg-surface border-l border-border shadow-2xl flex flex-col">
        <header className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <h2 className="flex-1 text-base font-semibold truncate" title={title}>{title || "Untitled"}</h2>
          {headerActions}
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-surface-2 text-muted-2 hover:text-foreground"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-2 mb-3">Details</h3>
            <div className="space-y-3">
              {fields.map((f) => {
                const value = getValue(item, f.key);
                const canEdit = !!onChangeField && editable.includes(f.key);
                return (
                  <FieldEditor
                    key={f.key}
                    field={f}
                    value={value}
                    editable={canEdit}
                    onChange={(v) => onChangeField?.(id, f.key, v)}
                  />
                );
              })}
            </div>
          </section>

          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-2 mb-3">Custom fields</h3>
            <CustomFieldsPanel entityType={entityType} entityId={id} showEmptyState />
          </section>

          {children}
        </div>
      </aside>
    </div>
  );
}

// ── Per-fieldType editor (mirrors Table view inline editor; lays out
// vertically with a label, suitable for the drawer's wider column).

interface FieldEditorProps {
  field: BoardField;
  value: unknown;
  editable: boolean;
  onChange: (value: unknown) => void;
}

function FieldEditor({ field, value, editable, onChange }: FieldEditorProps) {
  const labelEl = (
    <label className="block text-xs font-medium text-muted-2 mb-1">{field.label}</label>
  );

  if (!editable) {
    return (
      <div>
        {labelEl}
        <DisplayValue field={field} value={value} />
      </div>
    );
  }

  switch (field.fieldType) {
    case "TEXTAREA":
      return (
        <div>
          {labelEl}
          <textarea
            defaultValue={(value as string) ?? ""}
            onBlur={(e) => onChange(e.target.value || null)}
            rows={3}
            className="w-full px-3 py-2 rounded-lg border border-border bg-surface-2 text-sm resize-none"
          />
        </div>
      );
    case "NUMBER":
      return (
        <div>
          {labelEl}
          <input
            type="number"
            defaultValue={value == null ? "" : Number(value)}
            onBlur={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
            className="w-full px-3 py-2 rounded-lg border border-border bg-surface-2 text-sm"
          />
        </div>
      );
    case "DATE":
      return (
        <div>
          {labelEl}
          <input
            type="date"
            defaultValue={value ? String(value).slice(0, 10) : ""}
            onChange={(e) => onChange(e.target.value || null)}
            className="w-full px-3 py-2 rounded-lg border border-border bg-surface-2 text-sm"
          />
        </div>
      );
    case "CHECKBOX":
      return (
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            defaultChecked={!!value}
            onChange={(e) => onChange(e.target.checked)}
            id={`drawer-${field.key}`}
          />
          <label htmlFor={`drawer-${field.key}`} className="text-xs font-medium text-muted-2">{field.label}</label>
        </div>
      );
    case "SELECT": {
      const choices = field.options?.choices ?? [];
      return (
        <div>
          {labelEl}
          <select
            defaultValue={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value || null)}
            className="w-full px-3 py-2 rounded-lg border border-border bg-surface-2 text-sm"
          >
            <option value="">— None —</option>
            {choices.map((c) => (
              <option key={c.value} value={c.value}>{c.label ?? c.value}</option>
            ))}
          </select>
        </div>
      );
    }
    case "MULTI_SELECT": {
      const choices = field.options?.choices ?? [];
      const current = (value as string[]) ?? [];
      return (
        <div>
          {labelEl}
          <div className="flex flex-wrap gap-1.5">
            {choices.map((c) => {
              const selected = current.includes(c.value);
              return (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => {
                    const next = selected ? current.filter((v) => v !== c.value) : [...current, c.value];
                    onChange(next);
                  }}
                  className={
                    "text-xs px-2 py-1 rounded-md border transition-colors " +
                    (selected
                      ? "bg-violet-100 dark:bg-violet-950/40 border-violet-300 text-violet-700"
                      : "bg-surface-2 border-border text-muted hover:border-muted-2")
                  }
                >
                  {c.label ?? c.value}
                </button>
              );
            })}
          </div>
        </div>
      );
    }
    case "URL":
      return (
        <div>
          {labelEl}
          <input
            type="url"
            defaultValue={(value as string) ?? ""}
            onBlur={(e) => onChange(e.target.value || null)}
            placeholder="https://"
            className="w-full px-3 py-2 rounded-lg border border-border bg-surface-2 text-sm"
          />
        </div>
      );
    case "EMAIL":
      return (
        <div>
          {labelEl}
          <input
            type="email"
            defaultValue={(value as string) ?? ""}
            onBlur={(e) => onChange(e.target.value || null)}
            className="w-full px-3 py-2 rounded-lg border border-border bg-surface-2 text-sm"
          />
        </div>
      );
    case "TEXT":
    default:
      return (
        <div>
          {labelEl}
          <input
            type="text"
            defaultValue={(value as string) ?? ""}
            onBlur={(e) => onChange(e.target.value || null)}
            className="w-full px-3 py-2 rounded-lg border border-border bg-surface-2 text-sm"
          />
        </div>
      );
  }
}

function DisplayValue({ field, value }: { field: BoardField; value: unknown }) {
  if (value == null || value === "") {
    return <p className="text-sm text-muted-2">—</p>;
  }
  if (field.fieldType === "SELECT") {
    const choice = field.options?.choices?.find((c) => c.value === value);
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium"
        style={choice?.color ? { backgroundColor: `${choice.color}22`, color: choice.color } : undefined}
      >
        {choice?.label ?? String(value)}
      </span>
    );
  }
  if (field.fieldType === "MULTI_SELECT") {
    const arr = (value as string[]) ?? [];
    return (
      <div className="flex flex-wrap gap-1">
        {arr.map((v) => {
          const choice = field.options?.choices?.find((c) => c.value === v);
          return (
            <span key={v} className="px-1.5 py-0.5 rounded-md bg-surface-2 text-xs">{choice?.label ?? v}</span>
          );
        })}
      </div>
    );
  }
  if (field.fieldType === "CHECKBOX") {
    return <p className="text-sm">{value ? "Yes" : "No"}</p>;
  }
  if (field.fieldType === "DATE") {
    return <p className="text-sm">{new Date(String(value)).toLocaleDateString()}</p>;
  }
  if (field.fieldType === "URL" && typeof value === "string") {
    return (
      <a href={value} target="_blank" rel="noopener noreferrer" className="text-sm text-violet-600 hover:underline truncate block">
        {value}
      </a>
    );
  }
  return <p className="text-sm whitespace-pre-wrap">{String(value)}</p>;
}
