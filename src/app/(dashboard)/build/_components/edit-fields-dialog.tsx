"use client";

// The Edit fields modal on /build/[slug] (spec-tools-misc 2.4): the app's
// field list with a name and a type per row, keyboard reorder (Move up and
// Move down are real buttons), add up to 20, remove down to one. Nothing is
// written until Save (PATCH /api/build/apps/[slug] { fields }); closing with
// unsaved changes asks first. A removed field hides its column and nothing
// else: every row keeps the values it holds, and adding a field back under
// the same key shows them again, which the copy says.

import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Dots } from "@/components/ui/dots";
import { useConfirm } from "@/components/ui/dialog-provider";
import { apiFetch } from "@/lib/api-fetch";
import { FIELD_TYPES, FIELD_TYPE_LABEL, fieldsProblem, uniqueFieldKey, type DraftField, type FieldType } from "@/lib/build/app-draft";

type Row = DraftField & { isNew?: boolean };

export function EditFieldsDialog({ slug, fields, onClose, onSaved }: {
  slug: string;
  fields: DraftField[];
  onClose: () => void;
  onSaved: (fields: DraftField[]) => void;
}) {
  const confirm = useConfirm();
  const [rows, setRows] = useState<Row[]>(() => fields.map((f) => ({ ...f })));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = JSON.stringify(rows.map((r) => [r.key, r.label, r.fieldType])) !== JSON.stringify(fields.map((f) => [f.key, f.label, f.fieldType]));
  const removed = fields.filter((f) => !rows.some((r) => r.key === f.key)).length;
  const problem = fieldsProblem(rows);

  const patch = (i: number, p: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const move = (i: number, dir: -1 | 1) => setRows((rs) => {
    const j = i + dir;
    if (j < 0 || j >= rs.length) return rs;
    const next = [...rs];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const add = () => setRows((rs) => [...rs, { key: uniqueFieldKey("Field", rs.map((r) => r.key)), label: "", fieldType: "TEXT", isNew: true }]);

  async function close() {
    if (dirty && !(await confirm({ title: "Discard these changes?", description: "The field changes you made here are not saved.", confirmLabel: "Discard", destructive: true }))) return;
    onClose();
  }

  async function save() {
    if (problem) { setError(problem); return; }
    // A field added here gets its key from its name, so the column reads well
    // in exports; a field that already existed keeps its key, and with it
    // every value the rows hold.
    const taken = rows.filter((r) => !r.isNew).map((r) => r.key);
    const out: DraftField[] = rows.map((r) => {
      if (!r.isNew) return { key: r.key, label: r.label.trim(), fieldType: r.fieldType, ...(r.options !== undefined ? { options: r.options } : {}) };
      const key = uniqueFieldKey(r.label.trim() || "Field", taken);
      taken.push(key);
      return { key, label: r.label.trim(), fieldType: r.fieldType };
    });
    setSaving(true);
    setError(null);
    const res = await apiFetch<{ app: { schema?: { fields?: DraftField[] } } }>(`/api/build/apps/${slug}`, { method: "PATCH", json: { fields: out } });
    setSaving(false);
    if (!res.ok) { setError(res.error || "Couldn't save the fields. Try again."); return; }
    onSaved(res.data.app.schema?.fields ?? out);
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) void close(); }}>
      <DialogContent className="max-h-[90vh] max-w-[960px] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit fields</DialogTitle>
          <DialogDescription>
            Rename a field, change its type or its order, add one or remove one. Removing a field hides its column; the values rows already hold stay with the rows.
          </DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col">
          {rows.map((f, i) => (
            <li key={`${f.key}-${i}`} className="flex h-10 items-center gap-2">
              <span className="flex flex-col">
                <button
                  type="button"
                  aria-label={`Move ${f.label || "field"} up`}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                  className="inline-flex h-4 w-6 items-center justify-center rounded text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-30"
                >
                  <ArrowUp className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${f.label || "field"} down`}
                  disabled={i === rows.length - 1}
                  onClick={() => move(i, 1)}
                  className="inline-flex h-4 w-6 items-center justify-center rounded text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-30"
                >
                  <ArrowDown className="h-3 w-3" />
                </button>
              </span>
              <input
                value={f.label}
                onChange={(e) => patch(i, { label: e.target.value })}
                aria-label="Field name"
                maxLength={80}
                className="h-8 min-w-0 flex-1 rounded-md border border-line bg-raised px-2 text-base text-ink"
              />
              <select
                value={f.fieldType}
                onChange={(e) => patch(i, { fieldType: e.target.value as FieldType })}
                aria-label="Field type"
                className="h-8 w-40 rounded-md border border-line bg-raised px-2 text-sm text-ink"
              >
                {FIELD_TYPES.map((t) => <option key={t} value={t}>{FIELD_TYPE_LABEL[t]}</option>)}
              </select>
              <button
                type="button"
                aria-label={`Remove ${f.label || "field"}`}
                disabled={rows.length <= 1}
                onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-40"
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          disabled={rows.length >= 20}
          onClick={add}
          className="inline-flex h-8 items-center gap-1.5 self-start rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-40"
        >
          <Plus className="h-4 w-4" /> Add field
        </button>
        {removed > 0 ? (
          <p className="text-sm text-ink-2">{removed === 1 ? "One field" : `${removed} fields`} will be hidden. The rows keep those values.</p>
        ) : null}
        {error ? <p role="alert" className="text-sm text-danger-text">{error}</p> : null}
        <DialogFooter>
          <button type="button" onClick={() => void close()} className="inline-flex h-9 items-center rounded-md px-3 text-base font-medium text-ink-2 hover:bg-hover hover:text-ink">Cancel</button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !dirty}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover disabled:opacity-50"
          >
            {saving ? <Dots variant="pending" /> : null} Save
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
