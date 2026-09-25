"use client";

// ConnectFieldConfig: building a Connect or a Mirror column (gap 13,
// monday.com's connect-boards model), inside the Fields panel.
//
//   Connect  a name and the Lists it links to (1 to 10). The Lists are found
//            by searching the ones the viewer can read (GET
//            /api/boards?readable=1&targets=1), grouped like every other List
//            picker, and the chosen ones are named through `ids=` so a choice
//            never depends on which page of search results is loaded.
//   Mirror   a name, one Connect column of THIS List, and for each List that
//            column links to, the field to show (any field a mirror may read,
//            or Status, Priority, Due date, Start date or Assignee), with an
//            optional summary. Sum, Average, Min and Max are offered only when
//            every chosen field is a number.
//
// An existing column opens the same form to edit it; its kind never changes
// (the server refuses that as connect_mode_immutable). Lists and lookups the
// editor cannot see are kept by the server exactly as stored. Every refusal
// is a sentence, a failed save keeps the form with a Retry, and submit is
// locked while it is on its way.

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Cable, Check, FlipHorizontal2, ListChecks, X } from "lucide-react";
import { Picker, type PickerSectionDef } from "@/components/ui/picker";
import { Dots } from "@/components/ui/dots";
import { accessMessage } from "@/lib/access-message";
import { parseBoardSchema, type FieldDef } from "@/lib/field-catalog";
import {
  MAX_CONNECT_TARGETS,
  MIRROR_BUILTIN_KEYS,
  NUMERIC_FIELD_TYPES,
  connectTargets,
  isConnectField,
  isLookupableField,
  mirrorOptionsOf,
  type MirrorRollupFn,
} from "@/lib/list-connect";
import { groupReadableLists, readableListsUrl, type ReadableListRow, type ReadableListsResponse } from "@/lib/readable-lists";

const BUILTIN_CHOICES: Array<{ key: (typeof MIRROR_BUILTIN_KEYS)[number]; label: string }> = [
  { key: "__builtin_status", label: "Status" },
  { key: "__builtin_priority", label: "Priority" },
  { key: "__builtin_due", label: "Due date" },
  { key: "__builtin_start", label: "Start date" },
  { key: "__builtin_owner", label: "Assignee" },
];

const ROLLUPS: Array<{ value: MirrorRollupFn | ""; label: string; numeric?: boolean }> = [
  { value: "", label: "None" },
  { value: "SUM", label: "Sum", numeric: true },
  { value: "AVG", label: "Average", numeric: true },
  { value: "MIN", label: "Min", numeric: true },
  { value: "MAX", label: "Max", numeric: true },
  { value: "COUNT", label: "Count" },
  { value: "CONCAT", label: "Join" },
];

/** The fields and column routes' refusals, as sentences. */
export function fieldConfigMessage(payload: unknown, fallback: string, fields: readonly FieldDef[] = []): string {
  const p = (payload ?? {}) as { error?: unknown; issue?: unknown; usedBy?: unknown };
  if (p.error === "invalid_options") {
    switch (p.issue) {
      case "invalid_targets": return `Pick between 1 and ${MAX_CONNECT_TARGETS} Lists to connect.`;
      case "unknown_target_list": return "One of those Lists can't be connected. Pick Lists you can open.";
      case "link_field_not_connect": return "A Mirror needs a Connect column on this List.";
      case "no_lookups": return "Pick a field to show for at least one List.";
      case "unknown_lookup": return "One of those fields can't be shown. Pick another.";
      case "rollup_not_numeric": return "Sum, Average, Min and Max only work when every field is a number.";
      case "invalid_rollup": return "Pick one of the ways to summarize the values.";
      default: return accessMessage({ error: "invalid_options" }, fallback);
    }
  }
  if (p.error === "field_in_use") {
    const keys = Array.isArray(p.usedBy) ? p.usedBy.filter((k): k is string => typeof k === "string") : [];
    const labels = keys.map((k) => fields.find((f) => f.key === k)?.label ?? k);
    return labels.length
      ? `This Connect column feeds ${labels.join(", ")}. Remove those first.`
      : "Other columns read from this one. Remove those first.";
  }
  return accessMessage(payload, fallback);
}

const fieldCache = new Map<string, Promise<FieldDef[]>>();
function fieldsOfList(boardId: string): Promise<FieldDef[]> {
  let p = fieldCache.get(boardId);
  if (!p) {
    p = fetch(`/api/boards/${boardId}/fields`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { fields: [] }))
      .then((d) => parseBoardSchema({ fields: Array.isArray(d?.fields) ? d.fields : [] }).fields)
      .catch(() => {
        fieldCache.delete(boardId);
        return [] as FieldDef[];
      });
    fieldCache.set(boardId, p);
  }
  return p;
}

/** Named Lists, by id, through the readable-Lists read (never guessed). */
function useListNames(ids: readonly string[]) {
  const [names, setNames] = useState<Map<string, ReadableListRow>>(new Map());
  const key = [...ids].sort().join(",");
  useEffect(() => {
    if (!key) return;
    let alive = true;
    fetch(readableListsUrl({ ids: key.split(","), targets: true }), { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: ReadableListsResponse | null) => {
        if (!alive || !d) return;
        setNames((prev) => {
          const next = new Map(prev);
          for (const b of d.boards ?? []) next.set(b.id, b);
          return next;
        });
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [key]);
  return names;
}

export function ConnectFieldConfig({
  boardId,
  mode,
  fields,
  existing = null,
  initialLabel,
  onCancel,
  onSaved,
  onSwitchToConnect,
}: {
  boardId: string;
  mode: "connect" | "mirror";
  /** This List's fields (a Mirror reads one of its Connect columns). */
  fields: FieldDef[];
  /** Edit mode: the column being changed. */
  existing?: FieldDef | null;
  initialLabel?: string;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
  /** "Create a Connect column", offered by a Mirror with none to read. */
  onSwitchToConnect?: () => void;
}) {
  const editing = !!existing;
  const [label, setLabel] = useState(existing?.label ?? initialLabel ?? (mode === "connect" ? "Connected tasks" : "Mirror"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Connect ────────────────────────────────────────────────────────
  const [targets, setTargets] = useState<string[]>(() => (existing && isConnectField(existing) ? connectTargets(existing) : []));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [q, setQ] = useState("");
  const [lists, setLists] = useState<ReadableListsResponse | null>(null);
  const [listsState, setListsState] = useState<"loading" | "ready" | "failed">("loading");
  const named = useListNames(targets);
  const [seen, setSeen] = useState<Map<string, ReadableListRow>>(new Map());

  useEffect(() => {
    if (mode !== "connect" || !pickerOpen) return;
    let alive = true;
    const t = window.setTimeout(() => {
      fetch(readableListsUrl({ targets: true, q }), { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d: ReadableListsResponse) => {
          if (!alive) return;
          const res = { boards: Array.isArray(d?.boards) ? d.boards : [], spaces: Array.isArray(d?.spaces) ? d.spaces : [], truncated: !!d?.truncated };
          setLists(res);
          setSeen((prev) => { const next = new Map(prev); for (const b of res.boards) next.set(b.id, b); return next; });
          setListsState("ready");
        })
        .catch(() => { if (alive) setListsState("failed"); });
    }, q ? 200 : 0);
    return () => { alive = false; window.clearTimeout(t); };
  }, [mode, pickerOpen, q]);

  const nameOf = (id: string) => named.get(id)?.name ?? seen.get(id)?.name ?? null;
  const sections: PickerSectionDef[] = useMemo(
    () =>
      lists
        ? groupReadableLists(lists).map((g) => ({
            label: g.label,
            options: g.lists.map((l) => ({
              value: l.id,
              label: l.name,
              glyph: <ListChecks className="h-4 w-4" strokeWidth={1.5} aria-hidden />,
              disabled: !targets.includes(l.id) && targets.length >= MAX_CONNECT_TARGETS,
            })),
          }))
        : [],
    [lists, targets],
  );

  // ── Mirror ─────────────────────────────────────────────────────────
  const connectColumns = useMemo(() => fields.filter((f) => isConnectField(f)), [fields]);
  const storedMirror = existing ? mirrorOptionsOf(existing) : null;
  const [linkKey, setLinkKey] = useState<string>(() => storedMirror?.linkFieldKey ?? connectColumns[0]?.key ?? "");
  const [lookups, setLookups] = useState<Record<string, string>>(() => ({ ...(storedMirror?.lookupFieldKeys ?? {}) }));
  const [rollup, setRollup] = useState<MirrorRollupFn | "">(storedMirror?.rollupFn ?? "");
  const linkField = connectColumns.find((f) => f.key === linkKey) ?? null;
  const mirrorTargets = useMemo(() => (linkField ? connectTargets(linkField) : []), [linkField]);
  const mirrorNames = useListNames(mode === "mirror" ? mirrorTargets : []);
  const [targetFields, setTargetFields] = useState<Map<string, FieldDef[]>>(new Map());
  useEffect(() => {
    if (mode !== "mirror" || mirrorTargets.length === 0) return;
    let alive = true;
    void Promise.all(mirrorTargets.map(async (t) => [t, await fieldsOfList(t)] as const)).then((pairs) => {
      if (alive) setTargetFields(new Map(pairs));
    });
    return () => { alive = false; };
  }, [mode, mirrorTargets]);

  const typeOfLookup = (listId: string, key: string): string | null => {
    if ((MIRROR_BUILTIN_KEYS as readonly string[]).includes(key)) return key;
    return targetFields.get(listId)?.find((f) => f.key === key)?.type ?? null;
  };
  const chosenLookups = Object.entries(lookups).filter(([listId, key]) => mirrorTargets.includes(listId) && key);
  const allNumeric = chosenLookups.length > 0 && chosenLookups.every(([listId, key]) => NUMERIC_FIELD_TYPES.has(typeOfLookup(listId, key) ?? ""));
  const rollupChoices = ROLLUPS.filter((r) => !r.numeric || allNumeric);
  // A numeric summary stops being offered when a non-number field is chosen.
  const effectiveRollup = rollupChoices.some((r) => r.value === rollup) ? rollup : "";

  const submit = useCallback(async () => {
    if (busy) return;
    const name = label.trim();
    if (!name) { setError("Give the column a name."); return; }
    let body: Record<string, unknown>;
    if (mode === "connect") {
      if (targets.length === 0) { setError("Pick at least one List to connect."); return; }
      body = editing
        ? { label: name, options: { ...(existing?.options ?? {}), targetBoardIds: targets } }
        : { label: name, type: "RELATIONSHIP", options: { targetBoardIds: targets } };
    } else {
      if (!linkField) { setError("A Mirror needs a Connect column on this List."); return; }
      const lookupFieldKeys = Object.fromEntries(chosenLookups);
      if (Object.keys(lookupFieldKeys).length === 0) { setError("Pick a field to show for at least one List."); return; }
      const options = { linkFieldKey: linkField.key, lookupFieldKeys, ...(effectiveRollup ? { rollupFn: effectiveRollup } : {}) };
      body = editing ? { label: name, options } : { label: name, type: "MIRROR", options };
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(editing ? `/api/boards/${boardId}/fields/${encodeURIComponent(existing!.key)}` : `/api/boards/${boardId}/fields`, {
        method: editing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(fieldConfigMessage(data, editing ? "Couldn't save this column." : "Couldn't create this column.", fields));
        return;
      }
      await onSaved();
    } catch {
      setError("Couldn't reach the server. Nothing was lost; try again.");
    } finally {
      setBusy(false);
    }
  }, [busy, label, mode, targets, editing, existing, linkField, chosenLookups, effectiveRollup, boardId, fields, onSaved]);

  const Icon = mode === "connect" ? Cable : FlipHorizontal2;
  const title = editing ? `Edit ${mode === "connect" ? "Connect" : "Mirror"} column` : mode === "connect" ? "New Connect column" : "New Mirror column";

  return (
    <div className="flex flex-col gap-4 px-2 pt-1">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onCancel} aria-label="Back to fields" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
          <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
        </button>
        <Icon className="h-4 w-4 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
        <h3 className="text-base font-semibold text-ink">{title}</h3>
      </div>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-ink">Name</span>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={80}
          className="h-9 w-full rounded-md border border-line bg-raised px-2.5 text-base text-ink outline-none focus:border-brand"
        />
      </label>

      {mode === "connect" ? (
        <div>
          <span className="mb-1 block text-sm font-medium text-ink">Lists to connect</span>
          <p className="mb-2 text-xs text-ink-2">Each cell links tasks from these Lists. Up to {MAX_CONNECT_TARGETS}.</p>
          <div className="flex flex-wrap gap-1.5">
            {targets.map((id) => (
              <span key={id} className="inline-flex h-7 max-w-full items-center gap-1 rounded-md border border-line bg-subtle ps-2 pe-1 text-sm text-ink">
                <span className="truncate">{nameOf(id) ?? "List"}</span>
                <button
                  type="button"
                  onClick={() => setTargets((prev) => prev.filter((x) => x !== id))}
                  aria-label={`Remove ${nameOf(id) ?? "this List"}`}
                  className="inline-flex h-5 w-5 items-center justify-center rounded text-ink-3 hover:bg-active hover:text-ink"
                >
                  <X className="h-3 w-3" strokeWidth={1.5} />
                </button>
              </span>
            ))}
          </div>
          <div className="relative mt-2">
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              disabled={targets.length >= MAX_CONNECT_TARGETS}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-sm text-ink hover:bg-hover disabled:opacity-50"
            >
              <ListChecks className="h-4 w-4" strokeWidth={1.5} aria-hidden />
              {targets.length ? "Add a List" : "Choose Lists"}
            </button>
            <Picker
              open={pickerOpen}
              onClose={() => setPickerOpen(false)}
              multi
              selected={targets}
              sections={sections}
              alwaysSearch
              onSearchChange={setQ}
              ariaLabel="Lists to connect"
              searchPlaceholder="Search Lists…"
              loading={listsState === "loading" && !lists}
              emptyLabel={listsState === "failed" ? "Couldn't load your Lists. Check your connection and try again." : listsState === "loading" ? "Finding Lists…" : "No List matches that"}
              onSelect={(id) => setTargets((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= MAX_CONNECT_TARGETS ? prev : [...prev, id]))}
            />
          </div>
        </div>
      ) : connectColumns.length === 0 ? (
        <div className="rounded-lg border border-line bg-subtle px-3 py-3">
          <p className="text-sm text-ink">A Mirror needs a Connect column on this List</p>
          <p className="mt-1 text-xs text-ink-2">It shows a field of the tasks a Connect column links to.</p>
          {onSwitchToConnect ? (
            <button type="button" onClick={onSwitchToConnect} className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-raised px-2.5 text-sm text-ink hover:bg-hover">
              <Cable className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Create a Connect column
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">Connect column</span>
            <select
              value={linkKey}
              onChange={(e) => { setLinkKey(e.target.value); setLookups({}); }}
              className="h-9 w-full rounded-md border border-line bg-raised px-2 text-base text-ink outline-none focus:border-brand"
            >
              {connectColumns.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
          </label>
          <div>
            <span className="mb-1 block text-sm font-medium text-ink">Field to show</span>
            {mirrorTargets.length === 0 ? (
              <p className="text-sm text-ink-2">None of this column&apos;s Lists are shared with you</p>
            ) : (
              <div className="space-y-2">
                {mirrorTargets.map((listId) => {
                  const own = (targetFields.get(listId) ?? []).filter((f) => isLookupableField(f));
                  return (
                    <label key={listId} className="block">
                      <span className="mb-0.5 block truncate text-xs text-ink-2">{mirrorNames.get(listId)?.name ?? "List"}</span>
                      <select
                        value={lookups[listId] ?? ""}
                        onChange={(e) => setLookups((prev) => {
                          const next = { ...prev };
                          if (e.target.value) next[listId] = e.target.value; else delete next[listId];
                          return next;
                        })}
                        className="h-9 w-full rounded-md border border-line bg-raised px-2 text-base text-ink outline-none focus:border-brand"
                      >
                        <option value="">Not shown</option>
                        <optgroup label="Task">
                          {BUILTIN_CHOICES.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
                        </optgroup>
                        {own.length ? (
                          <optgroup label="Fields">
                            {own.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                          </optgroup>
                        ) : null}
                      </select>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">Summarize</span>
            <select
              value={effectiveRollup}
              onChange={(e) => setRollup(e.target.value as MirrorRollupFn | "")}
              className="h-9 w-full rounded-md border border-line bg-raised px-2 text-base text-ink outline-none focus:border-brand"
            >
              {rollupChoices.map((r) => <option key={r.value || "none"} value={r.value}>{r.label}</option>)}
            </select>
            {!allNumeric && chosenLookups.length > 0 ? (
              <span className="mt-1 block text-xs text-ink-2">Sum, Average, Min and Max appear when every field shown is a number.</span>
            ) : null}
          </label>
        </>
      )}

      {error ? (
        <div className="flex items-start gap-2 rounded-md bg-danger-bg px-3 py-2" role="alert">
          <span className="min-w-0 flex-1 text-sm text-danger-text">{error}</span>
          <button type="button" onClick={() => void submit()} disabled={busy} className="shrink-0 text-sm font-medium text-danger-text underline-offset-2 hover:underline disabled:opacity-50">
            Retry
          </button>
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} className="h-8 rounded-md px-3 text-sm text-ink-2 hover:bg-hover">Cancel</button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || (mode === "mirror" && connectColumns.length === 0)}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-brand px-3 text-sm font-medium text-ink-inv hover:bg-brand-hover disabled:opacity-50"
        >
          {busy ? <Dots variant="pending" /> : <Check className="h-4 w-4" strokeWidth={1.5} aria-hidden />}
          {editing ? "Save" : "Create column"}
        </button>
      </div>
    </div>
  );
}
