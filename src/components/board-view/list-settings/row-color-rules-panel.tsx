"use client";

// RowColorRulesPanel: a List's Conditional colors (gap 14, List comfort),
// opened from the List's "…" menu.
//
// Ordered rules: the FIRST rule that matches a row colours it. A rule is a
// field, an operator and a value, spoken in exactly the filter bar's
// vocabulary (list-comfort.ts FILTER_OPERATORS, board-filter-bar.tsx
// operatorsFor), so "Status is Done" means the same here as in a filter, and
// a colour from the product palette. Up to 20 rules, reordered by drag or by
// the up and down buttons. A refused Save keeps every rule and offers Retry;
// a saved one tells any open List page to re-read its settings.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from "lucide-react";
import { Dots } from "@/components/ui/dots";
import { accessMessage } from "@/lib/access-message";
import { PRIORITY_OPTIONS, type ItemTag, type StatusOption } from "@/lib/board-items-shared";
import { parseBoardSchema, type FieldDef } from "@/lib/field-catalog";
import { ruleFieldIdOf } from "@/lib/field-keys";
import { MAX_ROW_COLOR_RULES, ROW_COLORS, type RowColor, type RowColorRule } from "@/lib/list-comfort";
import { LIST_SETTINGS_CHANGED, ROW_COLOR_LABEL, ROW_COLOR_SWATCH, ROW_COLOR_TINT } from "@/lib/table-comfort";
import { OPERATOR_LABEL, operatorsFor, type FilterOperator } from "../board-filter-bar";
import type { PersonRef } from "../assignee-picker";
import { useItemTypes } from "../use-item-types";

let seq = 0;
function newRuleKey(): string {
  seq += 1;
  return `rc_${Date.now().toString(36)}_${seq}`;
}

const selectCls = "h-8 min-w-0 rounded-md border border-line bg-raised px-2 text-sm text-ink outline-none focus:border-brand";

export function RowColorRulesPanel({
  boardId,
  onDone,
  onDirtyChange,
}: {
  boardId: string;
  onDone: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [rules, setRules] = useState<RowColorRule[]>([]);
  const [statuses, setStatuses] = useState<StatusOption[]>([]);
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [people, setPeople] = useState<PersonRef[]>([]);
  const [tags, setTags] = useState<ItemTag[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const { list: itemTypes } = useItemTypes();
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const [settingsRes, fieldsRes, peopleRes, tagsRes] = await Promise.all([
        fetch(`/api/boards/${boardId}/settings`, { cache: "no-store" }),
        fetch(`/api/boards/${boardId}/fields`, { cache: "no-store" }),
        fetch(`/api/boards/${encodeURIComponent(boardId)}/assignable?limit=200`, { cache: "no-store" }).catch(() => null),
        fetch("/api/tags", { cache: "no-store" }).catch(() => null),
      ]);
      if (!settingsRes.ok || !fieldsRes.ok) { setState("failed"); return; }
      const settings = (await settingsRes.json()) as { rowColorRules?: RowColorRule[]; statuses?: StatusOption[] };
      setRules(Array.isArray(settings.rowColorRules) ? settings.rowColorRules : []);
      setStatuses(Array.isArray(settings.statuses) ? settings.statuses : []);
      setFields(parseBoardSchema(await fieldsRes.json()).fields);
      const p = peopleRes && peopleRes.ok ? await peopleRes.json().catch(() => null) : null;
      setPeople(Array.isArray(p?.data) ? p.data : []);
      const t = tagsRes && tagsRes.ok ? await tagsRes.json().catch(() => null) : null;
      setTags(Array.isArray(t) ? t : Array.isArray(t?.tags) ? t.tags : []);
      setState("ready");
    } catch {
      setState("failed");
    }
  }, [boardId]);
  useEffect(() => { void load(); }, [load]);

  const fieldOptions = useMemo(() => [
    { key: "status", label: "Status" },
    { key: "assignee", label: "Assignee" },
    { key: "priority", label: "Priority" },
    { key: "due", label: "Due date" },
    { key: "tags", label: "Tags" },
    { key: "title", label: "Title" },
    ...(itemTypes.length > 0 ? [{ key: "type", label: "Task Type" }] : []),
    // Computed columns hold no stored value a rule could read. A field keyed
    // like a built-in is offered by its own id, as the filter bar does.
    ...fields.filter((f) => f.type !== "MIRROR").map((f) => ({ key: ruleFieldIdOf(f.key), label: f.label })),
  ], [fields, itemTypes.length]);

  const change = (next: RowColorRule[]) => {
    setRules(next);
    setDirty(true);
    setError(null);
  };
  const update = (i: number, patch: Partial<RowColorRule>) => change(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= rules.length || from === to) return;
    const next = [...rules];
    const [r] = next.splice(from, 1);
    next.splice(to, 0, r);
    change(next);
  };
  const add = () => {
    if (rules.length >= MAX_ROW_COLOR_RULES) return;
    change([...rules, { id: newRuleKey(), field: "status", operator: "is", value: "", color: ROW_COLORS[rules.length % ROW_COLORS.length] }]);
  };

  const saving = useRef(false);
  const save = async () => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/boards/${boardId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rowColorRules: rules.length ? rules : null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(accessMessage(data, "Couldn't save the color rules. Your rules are kept; try again."));
        return;
      }
      setDirty(false);
      try { window.dispatchEvent(new CustomEvent(LIST_SETTINGS_CHANGED, { detail: { boardId } })); } catch { /* nothing to tell */ }
      onDone();
    } catch {
      setError("Couldn't reach the server. Your rules are kept; try again.");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  if (state === "loading") return <div className="px-5 py-6"><Dots variant="pending" label="Loading" className="text-ink-3" /></div>;
  if (state === "failed") {
    return (
      <div className="px-5 py-6 text-center">
        <p className="text-sm text-ink-2">Couldn&apos;t load this List&apos;s settings.</p>
        <button type="button" onClick={() => void load()} className="mt-2 text-base font-medium text-brand-deep hover:underline">Retry</button>
      </div>
    );
  }

  const valueControl = (r: RowColorRule, i: number) => {
    if (r.operator === "isSet" || r.operator === "isNotSet") return <span className="flex-1" />;
    const set = (value: string) => update(i, { value });
    const cls = `${selectCls} flex-1`;
    switch (r.field) {
      case "status":
        return (
          <select value={r.value} onChange={(e) => set(e.target.value)} className={cls} aria-label="Status">
            <option value="">Select…</option>
            {statuses.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        );
      case "assignee":
        return (
          <select value={r.value} onChange={(e) => set(e.target.value)} className={cls} aria-label="Person">
            <option value="">Select…</option>
            {people.map((p) => <option key={p.id} value={p.id}>{`${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.email || "Someone"}</option>)}
          </select>
        );
      case "priority":
        return (
          <select value={r.value} onChange={(e) => set(e.target.value)} className={cls} aria-label="Priority">
            <option value="">Select…</option>
            {PRIORITY_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        );
      case "tags":
        return (
          <select value={r.value} onChange={(e) => set(e.target.value)} className={cls} aria-label="Tag">
            <option value="">Select…</option>
            {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        );
      case "type":
        return (
          <select value={r.value} onChange={(e) => set(e.target.value)} className={cls} aria-label="Task type">
            <option value="">Select…</option>
            {itemTypes.map((t) => <option key={t.id} value={t.id}>{t.singular}</option>)}
          </select>
        );
      case "due":
        return <input type="date" value={r.value} onChange={(e) => set(e.target.value)} className={cls} aria-label="Date" />;
      default: {
        const f = fields.find((x) => ruleFieldIdOf(x.key) === r.field);
        const choices = f?.options?.choices ?? [];
        if (choices.length > 0 && (r.operator === "is" || r.operator === "isNot")) {
          return (
            <select value={r.value} onChange={(e) => set(e.target.value)} className={cls} aria-label="Value">
              <option value="">Select…</option>
              {choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          );
        }
        return <input value={r.value} maxLength={200} onChange={(e) => set(e.target.value)} placeholder="Value" className={cls} aria-label="Value" />;
      }
    }
  };

  return (
    <div className="flex flex-col gap-3 px-5 py-4">
      <p className="text-sm text-ink-2">The first rule that matches colours the row.</p>
      {rules.length === 0 ? (
        <p className="rounded-md border border-dashed border-line px-3 py-4 text-center text-sm text-ink-2">No color rules yet.</p>
      ) : (
        <ol className="space-y-2">
          {rules.map((r, i) => {
            const ops = operatorsFor(r.field) as FilterOperator[];
            return (
              <li
                key={r.id}
                draggable
                onDragStart={(e) => { setDragIdx(i); e.dataTransfer.effectAllowed = "move"; }}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
                onDrop={(e) => { e.preventDefault(); if (dragIdx !== null) move(dragIdx, i); setDragIdx(null); }}
                onDragEnd={() => setDragIdx(null)}
                className={`rounded-lg border border-line p-2 ${dragIdx === i ? "opacity-50" : ""}`}
                style={{ background: ROW_COLOR_TINT[r.color] }}
              >
                <div className="flex items-center gap-1.5">
                  <span className="cursor-grab text-ink-3" aria-hidden><GripVertical className="h-3.5 w-3.5" /></span>
                  <select
                    value={r.field}
                    onChange={(e) => {
                      const field = e.target.value;
                      const nextOps = operatorsFor(field);
                      update(i, { field, operator: nextOps.includes(r.operator as FilterOperator) ? r.operator : nextOps[0], value: "" });
                    }}
                    className={`${selectCls} w-[118px] shrink-0`}
                    aria-label="Field"
                  >
                    {fieldOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                  </select>
                  <select
                    value={r.operator}
                    onChange={(e) => update(i, { operator: e.target.value as RowColorRule["operator"] })}
                    className={`${selectCls} w-[96px] shrink-0`}
                    aria-label="Operator"
                  >
                    {ops.map((o) => <option key={o} value={o}>{OPERATOR_LABEL[o]}</option>)}
                  </select>
                  {valueControl(r, i)}
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  <span className="text-xs text-ink-2">Color</span>
                  <div role="radiogroup" aria-label="Row color" className="flex items-center gap-1">
                    {ROW_COLORS.map((c: RowColor) => (
                      <button
                        key={c}
                        type="button"
                        role="radio"
                        aria-checked={r.color === c}
                        aria-label={ROW_COLOR_LABEL[c]}
                        title={ROW_COLOR_LABEL[c]}
                        onClick={() => update(i, { color: c })}
                        className={`h-5 w-5 rounded-full ring-offset-1 ring-offset-[var(--os-surface)] ${r.color === c ? "ring-2 ring-ink" : "ring-1 ring-line"}`}
                        style={{ background: ROW_COLOR_SWATCH[c] }}
                      />
                    ))}
                  </div>
                  <span className="flex-1" />
                  <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label="Move rule up" title="Move up" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover disabled:opacity-40">
                    <ArrowUp className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </button>
                  <button type="button" onClick={() => move(i, i + 1)} disabled={i === rules.length - 1} aria-label="Move rule down" title="Move down" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover disabled:opacity-40">
                    <ArrowDown className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </button>
                  <button type="button" onClick={() => change(rules.filter((_, j) => j !== i))} aria-label="Delete rule" title="Delete rule" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-danger-text">
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {rules.length < MAX_ROW_COLOR_RULES ? (
        <button type="button" onClick={add} className="inline-flex h-8 w-fit items-center gap-1.5 rounded-md px-2 text-sm text-ink-2 hover:bg-hover hover:text-ink">
          <Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Add rule
        </button>
      ) : (
        <p className="text-xs text-ink-2">A List holds up to {MAX_ROW_COLOR_RULES} color rules.</p>
      )}

      {error ? (
        <div className="flex items-start gap-2 rounded-md bg-danger-bg px-3 py-2" role="alert">
          <span className="min-w-0 flex-1 text-sm text-danger-text">{error}</span>
          <button type="button" onClick={() => void save()} disabled={busy} className="shrink-0 text-sm font-medium text-danger-text underline-offset-2 hover:underline disabled:opacity-50">Retry</button>
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-2 pt-1">
        <button type="button" onClick={onDone} className="h-8 rounded-md px-3 text-sm text-ink-2 hover:bg-hover">Cancel</button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-brand px-3 text-sm font-medium text-ink-inv hover:bg-brand-hover disabled:opacity-50"
        >
          {busy ? <Dots variant="pending" /> : null}
          Save
        </button>
      </div>
    </div>
  );
}
