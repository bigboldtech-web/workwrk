"use client";

// A card's filter, inside the widget editor: rule rows (field, operator,
// value), AND or OR, and Hide completed, up to 20 rules. The operators are
// the List filter bar's own (operatorsFor, OPERATOR_LABEL), so a card and a
// List view read one rule the same way.
//
// Status, tag and custom field rules are offered only for Choose Lists: a
// status or a field means something only against the Lists that define it,
// and "All my Lists" or "A Space" has no single set to pick from. Values come
// from the right place for each field: the chosen Lists' statuses and
// choices, org people from /api/people/pick (a filter value, not a report
// recipient), priorities from PRIORITY_OPTIONS, a due date from a native date
// input.

import { useEffect, useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { OPERATOR_LABEL, operatorsFor } from "@/components/board-view/board-filter-bar";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { PRIORITY_OPTIONS, type StatusOption } from "@/lib/board-items-shared";
import { MAX_WIDGET_RULES, type WidgetFilter, type WidgetRule } from "@/lib/dashboards/widgets";
import type { FilterOperatorName } from "@/lib/list-comfort";
import type { FieldDef } from "@/lib/field-catalog";
import { PickerButton } from "./widget-registry";

type Person = { id: string; firstName?: string | null; lastName?: string | null; email?: string | null };
type Tag = { id: string; name: string };

const BUILTIN_LABEL: Record<string, string> = {
  status: "Status",
  assignee: "Assignee",
  priority: "Priority",
  due: "Due date",
  title: "Title",
  tags: "Tags",
  type: "Task type",
};

const CHOICE_TYPES: ReadonlySet<string> = new Set(["DROPDOWN", "CUSTOM_DROPDOWN", "MULTI_SELECT", "LABELS", "TSHIRT_SIZE"]);
// Field types a text-style rule can read; connect, mirror, file and button
// columns hold nothing a filter can compare.
const FILTERABLE_TYPES: ReadonlySet<string> = new Set([
  "TEXT", "LONG_TEXT", "CUSTOM_TEXT", "NUMBER", "MONEY", "PERCENT", "RATING", "DROPDOWN", "CUSTOM_DROPDOWN",
  "MULTI_SELECT", "LABELS", "TSHIRT_SIZE", "CHECKBOX", "URL", "EMAIL", "PHONE", "LOCATION",
]);

function personName(p: Person | undefined): string {
  if (!p) return "Someone";
  return `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.email || "Someone";
}

function needsValue(op: FilterOperatorName): boolean {
  return op !== "isSet" && op !== "isNotSet";
}

export function WidgetFilterEditor({
  filter,
  onChange,
  listsSource,
  fields,
  statuses,
}: {
  filter: WidgetFilter;
  onChange: (next: WidgetFilter) => void;
  /** The source is Choose Lists, so status, tag and field rules apply. */
  listsSource: boolean;
  fields: FieldDef[];
  statuses: StatusOption[];
}) {
  const [people, setPeople] = useState<Map<string, Person>>(new Map());
  const [peopleQ, setPeopleQ] = useState("");
  const [peopleRows, setPeopleRows] = useState<Person[] | null>(null);
  const [tags, setTags] = useState<Tag[] | null>(null);

  const needsPeople = filter.rules.some((r) => r.field === "assignee");
  const needsTags = filter.rules.some((r) => r.field === "tags");

  // People for assignee values: a search page, and every name ever seen, so
  // a stored rule's person keeps their name.
  useEffect(() => {
    if (!needsPeople) return;
    let live = true;
    const t = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/people/pick?includeSelf=1&limit=20${peopleQ ? `&q=${encodeURIComponent(peopleQ)}` : ""}`, { cache: "no-store" });
          const body = res.ok ? ((await res.json()) as { people?: Person[] }) : null;
          if (!live) return;
          const rows = body?.people ?? [];
          setPeopleRows(rows);
          setPeople((prev) => {
            const next = new Map(prev);
            for (const p of rows) next.set(p.id, p);
            return next;
          });
        } catch {
          if (live) setPeopleRows([]);
        }
      })();
    }, peopleQ ? 200 : 0);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [needsPeople, peopleQ]);

  useEffect(() => {
    if (!needsTags || tags !== null) return;
    let live = true;
    void (async () => {
      try {
        const res = await fetch("/api/tags", { cache: "no-store" });
        const body = res.ok ? ((await res.json()) as Array<{ id: string; name: string; archived?: boolean }>) : [];
        if (live) setTags(Array.isArray(body) ? body.filter((t) => !t.archived).map((t) => ({ id: t.id, name: t.name })) : []);
      } catch {
        if (live) setTags([]);
      }
    })();
    return () => {
      live = false;
    };
  }, [needsTags, tags]);

  const customFields = useMemo(() => (listsSource ? fields.filter((f) => FILTERABLE_TYPES.has(String(f.type))) : []), [fields, listsSource]);
  const fieldByKey = useMemo(() => new Map(fields.map((f) => [f.key, f] as const)), [fields]);

  const fieldSections = [
    {
      options: [
        ...(listsSource ? [{ value: "status", label: BUILTIN_LABEL.status }] : []),
        { value: "assignee", label: BUILTIN_LABEL.assignee },
        { value: "priority", label: BUILTIN_LABEL.priority },
        { value: "due", label: BUILTIN_LABEL.due },
        { value: "title", label: BUILTIN_LABEL.title },
        ...(listsSource ? [{ value: "tags", label: BUILTIN_LABEL.tags }] : []),
      ],
    },
    ...(customFields.length ? [{ label: "Fields", options: customFields.map((f) => ({ value: f.key, label: f.label })) }] : []),
  ];

  const labelOf = (field: string) => BUILTIN_LABEL[field] ?? fieldByKey.get(field)?.label ?? "A field";

  const setRule = (i: number, next: WidgetRule) => onChange({ ...filter, rules: filter.rules.map((r, j) => (j === i ? next : r)) });
  const removeRule = (i: number) => onChange({ ...filter, rules: filter.rules.filter((_, j) => j !== i) });
  const addRule = () => {
    if (filter.rules.length >= MAX_WIDGET_RULES) return;
    onChange({ ...filter, rules: [...filter.rules, { field: "priority", operator: "is", value: "" }] });
  };

  const valueControl = (rule: WidgetRule, i: number) => {
    if (!needsValue(rule.operator)) return null;
    const set = (value: string) => setRule(i, { ...rule, value });
    if (rule.field === "due") {
      return (
        <input
          type="date"
          value={/^\d{4}-\d{2}-\d{2}$/.test(rule.value) ? rule.value : ""}
          onChange={(e) => set(e.target.value)}
          aria-label="Due date"
          className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-raised px-2 text-sm text-ink"
        />
      );
    }
    if (rule.field === "title") {
      return (
        <input
          value={rule.value}
          maxLength={200}
          onChange={(e) => set(e.target.value)}
          placeholder="Words in the title"
          aria-label="Title contains"
          className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-raised px-2 text-sm text-ink placeholder:text-ink-3"
        />
      );
    }
    if (rule.field === "priority") {
      const opt = PRIORITY_OPTIONS.find((p) => p.value === rule.value);
      return (
        <PickerButton
          ariaLabel="Priority"
          label={opt?.label ?? "Pick a priority"}
          value={rule.value}
          sections={[{ options: PRIORITY_OPTIONS.map((p) => ({ value: p.value, label: p.label })) }]}
          onSelect={set}
          width={200}
        />
      );
    }
    if (rule.field === "status") {
      const opt = statuses.find((s) => s.value === rule.value);
      return (
        <PickerButton
          ariaLabel="Status"
          label={opt?.label ?? (rule.value || "Pick a status")}
          value={rule.value}
          emptyLabel="Choose Lists to pick a status"
          sections={[{ options: statuses.map((s) => ({ value: s.value, label: s.label, glyph: <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} /> })) }]}
          onSelect={set}
          width={220}
        />
      );
    }
    if (rule.field === "assignee") {
      return (
        <PickerButton
          ariaLabel="Person"
          label={rule.value ? personName(people.get(rule.value)) : "Pick a person"}
          value={rule.value}
          alwaysSearch
          searchPlaceholder="Search people"
          onSearchChange={setPeopleQ}
          loading={peopleRows === null}
          emptyLabel="No one matches"
          sections={[{ options: (peopleRows ?? []).map((p) => ({ value: p.id, label: personName(p), keywords: p.email ?? undefined })) }]}
          onSelect={set}
          width={240}
        />
      );
    }
    if (rule.field === "tags") {
      const tag = tags?.find((t) => t.id === rule.value);
      return (
        <PickerButton
          ariaLabel="Tag"
          label={tag?.name ?? (rule.value ? "A tag" : "Pick a tag")}
          value={rule.value}
          loading={tags === null}
          emptyLabel="No tags yet"
          sections={[{ options: (tags ?? []).map((t) => ({ value: t.id, label: t.name })) }]}
          onSelect={set}
          width={220}
        />
      );
    }
    const f = fieldByKey.get(rule.field);
    const choices = f && CHOICE_TYPES.has(String(f.type)) ? f.options?.choices ?? [] : [];
    if (choices.length && rule.operator !== "contains") {
      const ch = choices.find((c) => c.value === rule.value);
      return (
        <PickerButton
          ariaLabel={f?.label ?? "Value"}
          label={ch?.label ?? (rule.value || "Pick a value")}
          value={rule.value}
          sections={[{ options: choices.map((c) => ({ value: c.value, label: c.label })) }]}
          onSelect={set}
          width={220}
        />
      );
    }
    return (
      <input
        value={rule.value}
        maxLength={200}
        onChange={(e) => set(e.target.value)}
        placeholder="Value"
        aria-label="Value"
        className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-raised px-2 text-sm text-ink placeholder:text-ink-3"
      />
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-6 items-center justify-between gap-2">
        <span className="text-sm text-ink-2">Filter</span>
        {filter.rules.length > 1 ? (
          <SegmentedControl
            size="sm"
            label="Match"
            value={filter.connector}
            onChange={(v) => onChange({ ...filter, connector: v })}
            options={[
              { value: "AND", label: "All" },
              { value: "OR", label: "Any" },
            ]}
          />
        ) : null}
      </div>
      {filter.rules.map((rule, i) => {
        const ops = operatorsFor(rule.field) as FilterOperatorName[];
        return (
          <div key={i} className="flex flex-col gap-1.5 rounded-md border border-line p-2">
            <div className="flex items-center gap-1.5">
              <PickerButton
                ariaLabel="Field"
                label={labelOf(rule.field)}
                value={rule.field}
                sections={fieldSections}
                onSelect={(field) => {
                  const nextOps = operatorsFor(field) as FilterOperatorName[];
                  setRule(i, { field, operator: nextOps.includes(rule.operator) ? rule.operator : nextOps[0], value: "" });
                }}
                width={220}
              />
              <PickerButton
                ariaLabel="Condition"
                label={OPERATOR_LABEL[rule.operator]}
                value={rule.operator}
                sections={[{ options: ops.map((o) => ({ value: o, label: OPERATOR_LABEL[o] })) }]}
                onSelect={(op) => setRule(i, { ...rule, operator: op as FilterOperatorName, value: needsValue(op as FilterOperatorName) ? rule.value : "" })}
                width={180}
              />
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => removeRule(i)}
                aria-label="Remove filter"
                title="Remove filter"
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
              >
                <X className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
              </button>
            </div>
            {needsValue(rule.operator) ? <div className="flex items-center">{valueControl(rule, i)}</div> : null}
          </div>
        );
      })}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={addRule}
          disabled={filter.rules.length >= MAX_WIDGET_RULES}
          className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink disabled:text-ink-4"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
          Add filter
        </button>
        <label className="inline-flex items-center gap-2 text-sm text-ink-2">
          Hide completed
          <Switch checked={filter.hideDone} onChange={(on) => onChange({ ...filter, hideDone: on })} aria-label="Hide completed" />
        </label>
      </div>
      {filter.rules.length >= MAX_WIDGET_RULES ? <p className="m-0 text-xs text-ink-2">A widget can have up to 20 filters.</p> : null}
    </div>
  );
}
