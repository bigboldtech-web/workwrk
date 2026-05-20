"use client";

// CustomFieldsPanel — drop-in component for any feature that wants to
// render the org's custom fields for an entity (Task, Lead, Ticket,
// Contract, …). Usage:
//
//   <CustomFieldsPanel entityType="TASK" entityId={task.id} />
//
// Fetches GET /api/custom-fields/values?entityType=...&entityId=...
// Saves on blur via PUT /api/custom-fields/values.
// If no definitions exist for this entityType, renders nothing —
// safe to embed everywhere without cluttering empty surfaces.

import { useCallback, useEffect, useState } from "react";
import { Loader2, Save, Plus } from "lucide-react";
import Link from "next/link";

type FieldType = "TEXT" | "TEXTAREA" | "NUMBER" | "DATE" | "CHECKBOX" | "SELECT" | "MULTI_SELECT" | "URL" | "EMAIL";

interface FieldRow {
  definitionId: string;
  key: string;
  label: string;
  fieldType: FieldType;
  required: boolean;
  options: Record<string, unknown>;
  value: unknown;
}

interface Props {
  entityType: string;
  entityId: string;
  // Optional callback so a parent can react to saves (e.g. refresh
  // a parent list).
  onSaved?: () => void;
  // When true, render an empty-state CTA pointing at /studio when the
  // entity type has no custom fields defined. Default: false (silent).
  showEmptyState?: boolean;
}

export function CustomFieldsPanel({ entityType, entityId, onSaved, showEmptyState = false }: Props) {
  const [fields, setFields] = useState<FieldRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/custom-fields/values?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`);
      if (!res.ok) return;
      const data = await res.json();
      setFields(data.fields ?? []);
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]);

  useEffect(() => { load(); }, [load]);

  const saveOne = useCallback(async (key: string, value: unknown) => {
    setSavingKey(key);
    try {
      await fetch("/api/custom-fields/values", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityType, entityId, values: { [key]: value } }),
      });
      setSavedKey(key);
      setTimeout(() => setSavedKey((s) => (s === key ? null : s)), 1500);
      onSaved?.();
    } finally {
      setSavingKey(null);
    }
  }, [entityType, entityId, onSaved]);

  if (loading) {
    return (
      <div className="inline-flex items-center gap-2 text-xs text-muted-2">
        <Loader2 size={12} className="animate-spin" /> Loading fields…
      </div>
    );
  }

  if (!fields || fields.length === 0) {
    if (!showEmptyState) return null;
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface-2 p-4 text-center">
        <p className="text-xs text-muted-2 mb-2">No custom fields defined for {entityType.toLowerCase()} yet.</p>
        <Link
          href="/studio"
          className="inline-flex items-center gap-1 text-xs font-medium text-violet-600 hover:text-violet-700"
        >
          <Plus size={11} /> Add custom fields in Studio
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {fields.map((f) => (
        <FieldRowEditor
          key={f.definitionId}
          field={f}
          saving={savingKey === f.key}
          justSaved={savedKey === f.key}
          onChange={(value) => {
            // Optimistic local update so input feels responsive
            setFields((prev) => prev?.map((x) => x.key === f.key ? { ...x, value } : x) ?? null);
            saveOne(f.key, value);
          }}
        />
      ))}
    </div>
  );
}

function FieldRowEditor({
  field,
  saving,
  justSaved,
  onChange,
}: {
  field: FieldRow;
  saving: boolean;
  justSaved: boolean;
  onChange: (v: unknown) => void;
}) {
  const labelEl = (
    <div className="flex items-center gap-2 mb-1">
      <label className="text-xs font-medium text-muted-2">
        {field.label}
        {field.required && <span className="text-rose-500 ml-0.5">*</span>}
      </label>
      {saving && <Loader2 size={10} className="animate-spin text-muted-2" />}
      {justSaved && <span className="text-[10px] text-emerald-600 inline-flex items-center gap-0.5"><Save size={9} /> Saved</span>}
    </div>
  );

  switch (field.fieldType) {
    case "TEXTAREA":
      return (
        <div>
          {labelEl}
          <textarea
            defaultValue={(field.value as string) ?? ""}
            onBlur={(e) => onChange(e.target.value || null)}
            rows={3}
            className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm resize-none"
          />
        </div>
      );
    case "NUMBER":
      return (
        <div>
          {labelEl}
          <input
            type="number"
            defaultValue={(field.value as number) ?? ""}
            onBlur={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
            className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm"
          />
        </div>
      );
    case "DATE":
      return (
        <div>
          {labelEl}
          <input
            type="date"
            defaultValue={field.value ? String(field.value).slice(0, 10) : ""}
            onChange={(e) => onChange(e.target.value || null)}
            className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm"
          />
        </div>
      );
    case "CHECKBOX":
      return (
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            defaultChecked={!!field.value}
            onChange={(e) => onChange(e.target.checked)}
            id={`cf-${field.definitionId}`}
          />
          <label htmlFor={`cf-${field.definitionId}`} className="text-xs font-medium text-muted-2">
            {field.label}
            {field.required && <span className="text-rose-500 ml-0.5">*</span>}
          </label>
          {saving && <Loader2 size={10} className="animate-spin text-muted-2" />}
          {justSaved && <span className="text-[10px] text-emerald-600">Saved</span>}
        </div>
      );
    case "SELECT": {
      const choices = (field.options.choices as { value: string; label: string }[]) ?? [];
      return (
        <div>
          {labelEl}
          <select
            defaultValue={(field.value as string) ?? ""}
            onChange={(e) => onChange(e.target.value || null)}
            className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm"
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
      const choices = (field.options.choices as { value: string; label: string }[]) ?? [];
      const current = (field.value as string[]) ?? [];
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
                    const next = selected
                      ? current.filter((v) => v !== c.value)
                      : [...current, c.value];
                    onChange(next);
                  }}
                  className={
                    "text-xs px-2 py-1 rounded-md border transition-colors " +
                    (selected
                      ? "bg-violet-100 dark:bg-violet-950/40 border-violet-300 text-violet-700"
                      : "bg-surface border-border text-muted hover:border-muted-2")
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
            defaultValue={(field.value as string) ?? ""}
            onBlur={(e) => onChange(e.target.value || null)}
            placeholder="https://"
            className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm"
          />
        </div>
      );
    case "EMAIL":
      return (
        <div>
          {labelEl}
          <input
            type="email"
            defaultValue={(field.value as string) ?? ""}
            onBlur={(e) => onChange(e.target.value || null)}
            className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm"
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
            defaultValue={(field.value as string) ?? ""}
            onBlur={(e) => onChange(e.target.value || null)}
            className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm"
          />
        </div>
      );
  }
}
