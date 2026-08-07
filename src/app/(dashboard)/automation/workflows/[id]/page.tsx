"use client";

/* /automation/workflows/[id] — the form-based recipe builder.
 *
 * Monday-style sentence recipe ("When [trigger] … then [actions]"), per
 * the Mobbin refs (2026-08-07):
 *   - Empty recipe sentence + underlined fillable tokens:
 *     https://mobbin.com/screens/20183635-2391-4d40-96e8-4b8101a71ac6
 *   - "and then do this" action picker popover:
 *     https://mobbin.com/screens/d01f0e2f-0dc3-43c9-8042-99bc0ac48a5c
 *
 *  GET  /api/automation/workflows/[id]        → definition + versions + last 10 runs
 *  GET  /api/automation/triggers|actions      → registry catalogs
 *  GET  /api/users?scope=all  /api/boards?all=1 → picker data
 *  PUT  /api/automation/workflows/[id]        → Save draft
 *  POST .../publish  .../activate  .../deactivate
 *  DELETE .../[id]                            → useConfirm'd delete
 *
 * Conditions: the builder edits ONE flat AND/OR group (the engine also
 * accepts nested groups authored via the API — those are preserved as
 * opaque rows here, never silently dropped).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowDown,
  ChevronDown,
  ChevronLeft,
  Loader2,
  Plus,
  Search,
  Trash2,
  Workflow,
  X,
} from "lucide-react";
import { MorePortal } from "@/components/layout/os/more-portal";
import { MenuItem, MenuList, MenuSectionLabel, MenuSeparator } from "@/components/ui/menu";
import { Switch } from "@/components/ui/switch";
import { useConfirm } from "@/components/ui/dialog-provider";
import { useOsToast } from "@/components/layout/os/toast";
import { PersonAvatar, type PersonRef } from "@/components/board-view/assignee-picker";
import { CONDITION_OPERATORS } from "@/lib/automation/conditions";
import { DEFAULT_STATUS_OPTIONS, PRIORITY_OPTIONS } from "@/lib/board-items-shared";
import {
  CARD,
  DARK_PILL,
  RUN_STATUS_COLORS,
  StatusPill,
  WORKFLOW_STATUS_META,
  relTime,
} from "../../shared";

/* ───────────────────────────── types ───────────────────────────── */

interface ApiTriggerField {
  key: string;
  label: string;
  type: string;
}

interface ApiTrigger {
  key: string;
  name: string;
  category: string;
  description: string;
  isEmitting: boolean;
  fields: ApiTriggerField[];
}

interface ApiActionParam {
  key: string;
  label: string;
  type: "string" | "text" | "user" | "board" | "status" | "number";
  required: boolean;
  help?: string;
}

interface ApiAction {
  key: string;
  name: string;
  category: string;
  description: string;
  safeToRetry: boolean;
  available: boolean;
  requiresConnection: string | null;
  params: ApiActionParam[];
}

interface ApiRun {
  id: string;
  status: string;
  triggerEventKey: string;
  errorMessage: string | null;
  durationMs: number | null;
  createdAt: string;
}

interface ApiWorkflowDetail {
  id: string;
  name: string;
  description: string | null;
  status: string;
  severity: string;
  triggerEvent: string | null;
  publishedVersionId: string | null;
  publishedAt: string | null;
  lastRunAt: string | null;
  createdAt: string;
  definition: unknown;
  versions: Array<{ id: string; versionNumber: number; isPublished: boolean; createdAt: string }>;
  runs: ApiRun[];
}

interface CondRow {
  _id: number;
  /** Opaque nested group (authored via API) — preserved verbatim. */
  opaque?: unknown;
  field: string;
  operator: string;
  value: string;
}

interface ActionRow {
  _id: number;
  key: string | null;
  params: Record<string, string>;
}

interface ApiBoard {
  id: string;
  name: string;
}

/* ─────────────────────────── styling ─────────────────────────── */

const INPUT =
  "h-7 rounded-md border border-zinc-200 bg-white px-2 text-[12.5px] text-zinc-800 outline-none placeholder:text-zinc-400 focus:border-zinc-400";
const OUTLINE_PILL =
  "inline-flex h-7 items-center gap-1 rounded-md border border-zinc-200 bg-white px-3 text-[12.5px] font-medium text-zinc-700 hover:bg-zinc-50";
/** Monday-style fillable sentence token. */
const TOKEN =
  "inline-flex max-w-full items-center gap-1 border-b-2 pb-0.5 text-[20px] font-semibold leading-tight transition-colors";

function NotEmittingChip() {
  return (
    <span className="inline-flex h-[16px] items-center rounded-md border border-amber-200 bg-amber-50 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
      not emitting yet
    </span>
  );
}

let uidCounter = 1;
function uid(): number {
  return uidCounter++;
}

/* ─────────────────────── trigger token + picker ─────────────────────── */

function TriggerToken({
  triggers,
  value,
  onChange,
}: {
  triggers: ApiTrigger[];
  value: string | null;
  onChange: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const selected = value ? triggers.find((t) => t.key === value) : undefined;

  const byCategory = useMemo(() => {
    const map = new Map<string, ApiTrigger[]>();
    for (const t of triggers) {
      const list = map.get(t.category) ?? [];
      list.push(t);
      map.set(t.category, list);
    }
    return [...map.entries()];
  }, [triggers]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`${TOKEN} ${
          selected
            ? "border-zinc-900 text-zinc-900 hover:border-[#0073EA] hover:text-[#0073EA]"
            : "border-zinc-300 text-zinc-400 hover:border-zinc-500 hover:text-zinc-500"
        }`}
      >
        <span className="truncate">{selected ? selected.name : "this happens"}</span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
      </button>
      {selected && !selected.isEmitting ? <NotEmittingChip /> : null}
      {open ? (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
          <MorePortal anchorRef={btnRef} width={320} open={open} placement="below">
            <MenuList className="max-h-[420px] overflow-y-auto">
              {byCategory.map(([category, list], i) => (
                <div key={category}>
                  {i > 0 ? <MenuSeparator /> : null}
                  <MenuSectionLabel>{category}</MenuSectionLabel>
                  {list.map((t) => (
                    <MenuItem
                      key={t.key}
                      label={t.name}
                      title={t.description}
                      selected={t.key === value}
                      disabled={!t.isEmitting}
                      trailing={!t.isEmitting ? <NotEmittingChip /> : undefined}
                      onClick={() => {
                        onChange(t.key);
                        setOpen(false);
                      }}
                    />
                  ))}
                </div>
              ))}
            </MenuList>
          </MorePortal>
        </>
      ) : null}
    </>
  );
}

/* ─────────────────────── action token + picker ─────────────────────── */

function ActionToken({
  actions,
  value,
  onChange,
}: {
  actions: ApiAction[];
  value: string | null;
  onChange: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const selected = value ? actions.find((a) => a.key === value) : undefined;

  const byCategory = useMemo(() => {
    const map = new Map<string, ApiAction[]>();
    for (const a of actions) {
      const list = map.get(a.category) ?? [];
      list.push(a);
      map.set(a.category, list);
    }
    return [...map.entries()];
  }, [actions]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`${TOKEN} ${
          selected
            ? "border-zinc-900 text-zinc-900 hover:border-[#0073EA] hover:text-[#0073EA]"
            : "border-zinc-300 text-zinc-400 hover:border-zinc-500 hover:text-zinc-500"
        }`}
      >
        <span className="truncate">{selected ? selected.name.toLowerCase() : "do this"}</span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
          <MorePortal anchorRef={btnRef} width={300} open={open} placement="below">
            <MenuList className="max-h-[380px] overflow-y-auto">
              {byCategory.map(([category, list], i) => (
                <div key={category}>
                  {i > 0 ? <MenuSeparator /> : null}
                  <MenuSectionLabel>{category}</MenuSectionLabel>
                  {list.map((a) => (
                    <MenuItem
                      key={a.key}
                      label={a.name}
                      title={a.description}
                      selected={a.key === value}
                      disabled={!a.available}
                      trailing={
                        !a.available ? (
                          <span className="text-[10.5px] font-medium text-zinc-400">
                            coming soon
                          </span>
                        ) : undefined
                      }
                      onClick={() => {
                        onChange(a.key);
                        setOpen(false);
                      }}
                    />
                  ))}
                </div>
              ))}
            </MenuList>
          </MorePortal>
        </>
      ) : null}
    </>
  );
}

/* ───────────────────────── user param picker ───────────────────────── */

const USER_SPECIALS: Array<{ value: string; label: string; adminsOnly?: boolean }> = [
  { value: "assignee", label: "Assignee (from trigger)" },
  { value: "actor", label: "Actor (who triggered it)" },
  { value: "board_owner", label: "Board owner" },
  { value: "admins", label: "All workspace admins", adminsOnly: true },
];

function UserParamPicker({
  value,
  allowAdmins,
  people,
  onChange,
}: {
  value: string;
  allowAdmins: boolean;
  people: PersonRef[];
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const btnRef = useRef<HTMLButtonElement>(null);

  const specials = USER_SPECIALS.filter((s) => allowAdmins || !s.adminsOnly);
  const special = specials.find((s) => s.value === value);
  const person = people.find((p) => p.id === value);
  const label = special
    ? special.label
    : person
      ? `${person.firstName ?? ""} ${person.lastName ?? ""}`.trim() || person.email || person.id
      : value
        ? `${value.slice(0, 12)}…`
        : "Pick a person";

  const filtered = query.trim()
    ? people.filter((p) =>
        `${p.firstName ?? ""} ${p.lastName ?? ""} ${p.email ?? ""}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
      )
    : people;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`${INPUT} inline-flex w-full items-center justify-between gap-1 text-left ${
          value ? "" : "text-zinc-400"
        }`}
      >
        <span className="inline-flex min-w-0 items-center gap-1.5">
          {person ? <PersonAvatar person={person} size={18} /> : null}
          <span className="truncate">{label}</span>
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
          <MorePortal anchorRef={btnRef} width={260} open={open} placement="below">
            <MenuList className="overflow-hidden">
              <div className="flex h-8 items-center gap-2 border-b border-zinc-100 px-3 dark:border-[#2A2F38]">
                <Search className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search people…"
                  className="w-full bg-transparent text-[12.5px] text-zinc-800 outline-none placeholder:text-zinc-400 dark:text-zinc-200"
                />
              </div>
              <div className="max-h-[280px] overflow-y-auto py-1">
                <MenuSectionLabel>From the trigger</MenuSectionLabel>
                {specials.map((s) => (
                  <MenuItem
                    key={s.value}
                    label={s.label}
                    selected={s.value === value}
                    onClick={() => {
                      onChange(s.value);
                      setOpen(false);
                    }}
                  />
                ))}
                <MenuSeparator />
                <MenuSectionLabel>People</MenuSectionLabel>
                {filtered.length === 0 ? (
                  <div className="px-3 py-3 text-[12px] text-zinc-400">No people found</div>
                ) : (
                  filtered.slice(0, 30).map((p) => (
                    <MenuItem
                      key={p.id}
                      leading={<PersonAvatar person={p} size={20} />}
                      label={`${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.email || p.id}
                      selected={p.id === value}
                      onClick={() => {
                        onChange(p.id);
                        setOpen(false);
                      }}
                    />
                  ))
                )}
              </div>
            </MenuList>
          </MorePortal>
        </>
      ) : null}
    </>
  );
}

/* ───────────────────────── param input dispatch ───────────────────────── */

function ParamInput({
  actionKey,
  param,
  value,
  people,
  boards,
  onChange,
}: {
  actionKey: string;
  param: ApiActionParam;
  value: string;
  people: PersonRef[];
  boards: ApiBoard[];
  onChange: (next: string) => void;
}) {
  const [customStatus, setCustomStatus] = useState(
    () => value !== "" && !DEFAULT_STATUS_OPTIONS.some((s) => s.value === value),
  );

  if (param.type === "user") {
    return (
      <UserParamPicker
        value={value}
        allowAdmins={actionKey === "create_notification" && param.key === "userId"}
        people={people}
        onChange={onChange}
      />
    );
  }
  if (param.type === "board") {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`${INPUT} w-full`}>
        <option value="">Pick a board…</option>
        {boards.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    );
  }
  if (param.type === "status") {
    if (customStatus) {
      return (
        <div className="flex items-center gap-1">
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Status value…"
            className={`${INPUT} w-full`}
          />
          <button
            type="button"
            title="Back to the default statuses"
            onClick={() => {
              setCustomStatus(false);
              onChange("");
            }}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      );
    }
    return (
      <select
        value={value}
        onChange={(e) => {
          if (e.target.value === "__custom__") {
            setCustomStatus(true);
            onChange("");
          } else {
            onChange(e.target.value);
          }
        }}
        className={`${INPUT} w-full`}
      >
        <option value="">Pick a status…</option>
        {DEFAULT_STATUS_OPTIONS.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
        <option value="__custom__">Custom…</option>
      </select>
    );
  }
  if (param.key === "priority") {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`${INPUT} w-full`}>
        <option value="">No priority</option>
        {PRIORITY_OPTIONS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>
    );
  }
  if (param.type === "number") {
    return (
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${INPUT} w-full`}
      />
    );
  }
  if (param.type === "text") {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        placeholder="Supports {{field}} tokens from the trigger"
        className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-[12.5px] text-zinc-800 outline-none placeholder:text-zinc-400 focus:border-zinc-400"
      />
    );
  }
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`${INPUT} w-full`}
    />
  );
}

/* ───────────────────────────── page ───────────────────────────── */

export default function AutomationBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useOsToast();
  const confirm = useConfirm();

  const [wf, setWf] = useState<ApiWorkflowDetail | null>(null);
  const [loadError, setLoadError] = useState(false);

  const [triggers, setTriggers] = useState<ApiTrigger[]>([]);
  const [actionsCatalog, setActionsCatalog] = useState<ApiAction[]>([]);
  const [people, setPeople] = useState<PersonRef[]>([]);
  const [boards, setBoards] = useState<ApiBoard[]>([]);

  // Editable state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState("MINOR");
  const [triggerEvent, setTriggerEvent] = useState<string | null>(null);
  const [condLogic, setCondLogic] = useState<"AND" | "OR">("AND");
  const [condRows, setCondRows] = useState<CondRow[]>([]);
  const [actionRows, setActionRows] = useState<ActionRow[]>([]);
  const [dirty, setDirty] = useState(false);

  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [toggling, setToggling] = useState(false);

  const hydrate = useCallback((detail: ApiWorkflowDetail) => {
    setWf(detail);
    setName(detail.name);
    setDescription(detail.description ?? "");
    setSeverity(detail.severity);
    setTriggerEvent(detail.triggerEvent);

    const def =
      detail.definition && typeof detail.definition === "object"
        ? (detail.definition as Record<string, unknown>)
        : {};
    const cond =
      def.conditions && typeof def.conditions === "object"
        ? (def.conditions as Record<string, unknown>)
        : null;
    setCondLogic(cond?.logic === "OR" ? "OR" : "AND");
    const rows: CondRow[] = [];
    if (cond && Array.isArray(cond.rules)) {
      for (const node of cond.rules) {
        const n = node && typeof node === "object" ? (node as Record<string, unknown>) : null;
        if (n && typeof n.field === "string" && typeof n.operator === "string" && !Array.isArray(n.rules)) {
          rows.push({
            _id: uid(),
            field: n.field,
            operator: n.operator,
            value: n.value === undefined || n.value === null ? "" : String(n.value),
          });
        } else if (n) {
          // Nested group / unknown shape — keep it verbatim, never drop it.
          rows.push({ _id: uid(), opaque: node, field: "", operator: "", value: "" });
        }
      }
    }
    setCondRows(rows);

    const acts: ActionRow[] = [];
    if (Array.isArray(def.actions)) {
      for (const raw of def.actions) {
        const a = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
        const key =
          typeof a.key === "string"
            ? a.key
            : typeof a.action === "string"
              ? a.action
              : typeof a.type === "string"
                ? a.type
                : null;
        const rawParams =
          a.params && typeof a.params === "object"
            ? (a.params as Record<string, unknown>)
            : a.config && typeof a.config === "object"
              ? (a.config as Record<string, unknown>)
              : {};
        const params: Record<string, string> = {};
        for (const [k, v] of Object.entries(rawParams)) {
          if (v === null || v === undefined) continue;
          params[k] = typeof v === "string" ? v : String(v);
        }
        acts.push({ _id: uid(), key, params });
      }
    }
    setActionRows(acts);
    setDirty(false);
  }, []);

  // Initial load
  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch(`/api/automation/workflows/${id}`, { cache: "no-store" }).then((r) =>
        r.ok ? r.json() : null,
      ),
      fetch("/api/automation/triggers").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/automation/actions").then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([detail, trig, acts]) => {
        if (!alive) return;
        if (!detail?.workflow) {
          setLoadError(true);
          return;
        }
        hydrate(detail.workflow);
        setTriggers(Array.isArray(trig?.triggers) ? trig.triggers : []);
        setActionsCatalog(Array.isArray(acts?.actions) ? acts.actions : []);
      })
      .catch(() => {
        if (alive) setLoadError(true);
      });
    return () => {
      alive = false;
    };
  }, [id, hydrate]);

  // Picker data (people + boards) — loaded once, non-blocking.
  useEffect(() => {
    let alive = true;
    fetch("/api/users?scope=all&limit=100", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && Array.isArray(d?.data)) setPeople(d.data);
      })
      .catch(() => {});
    fetch("/api/boards?all=1", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && Array.isArray(d?.boards)) setBoards(d.boards);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const selectedTrigger = triggerEvent ? triggers.find((t) => t.key === triggerEvent) : undefined;

  const serializeDefinition = useCallback(() => {
    const opsNeedingValue = new Set(
      CONDITION_OPERATORS.filter((o) => o.needsValue).map((o) => String(o.key)),
    );
    const rules = condRows
      .map((row) => {
        if (row.opaque !== undefined) return row.opaque;
        if (!row.field || !row.operator) return null;
        const rule: Record<string, unknown> = { field: row.field, operator: row.operator };
        if (opsNeedingValue.has(row.operator)) rule.value = row.value;
        return rule;
      })
      .filter((r) => r !== null);

    const actions = actionRows
      .filter((row) => row.key)
      .map((row) => {
        const catalog = actionsCatalog.find((a) => a.key === row.key);
        const params: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(row.params)) {
          if (v === "") continue;
          const schema = catalog?.params.find((p) => p.key === k);
          if (schema?.type === "number") {
            const n = Number(v);
            if (Number.isFinite(n)) params[k] = n;
          } else {
            params[k] = v;
          }
        }
        return { key: row.key, name: catalog?.name ?? row.key, params };
      });

    return {
      conditions: rules.length > 0 ? { logic: condLogic, rules } : null,
      actions,
    };
  }, [condRows, condLogic, actionRows, actionsCatalog]);

  const saveDraft = useCallback(async (): Promise<boolean> => {
    if (!name.trim()) {
      toast("Give the automation a name first");
      return false;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/automation/workflows/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          triggerEvent: triggerEvent ?? null,
          severity,
          definition: serializeDefinition(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data?.error ?? "Couldn't save the automation");
        return false;
      }
      setWf((prev) => (prev ? { ...prev, ...data.workflow, runs: prev.runs, versions: prev.versions } : prev));
      setDirty(false);
      return true;
    } catch {
      toast("Couldn't save the automation");
      return false;
    } finally {
      setSaving(false);
    }
  }, [id, name, description, triggerEvent, severity, serializeDefinition, toast]);

  const publish = useCallback(async () => {
    if (!triggerEvent) {
      toast("Pick a trigger before publishing");
      return;
    }
    if (!actionRows.some((r) => r.key)) {
      toast("Add at least one action before publishing");
      return;
    }
    setPublishing(true);
    try {
      const saved = await saveDraft();
      if (!saved) return;
      const res = await fetch(`/api/automation/workflows/${id}/publish`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data?.error ?? "Couldn't publish the automation");
        return;
      }
      setWf((prev) => (prev ? { ...prev, ...data.workflow, runs: prev.runs, versions: prev.versions } : prev));
      toast("Published — the automation is live");
    } catch {
      toast("Couldn't publish the automation");
    } finally {
      setPublishing(false);
    }
  }, [id, triggerEvent, actionRows, saveDraft, toast]);

  const toggleActive = useCallback(
    async (next: boolean) => {
      if (!wf) return;
      setToggling(true);
      try {
        const res = await fetch(
          `/api/automation/workflows/${id}/${next ? "activate" : "deactivate"}`,
          { method: "POST" },
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast(data?.error ?? "Couldn't update the automation");
          return;
        }
        setWf((prev) => (prev ? { ...prev, ...data.workflow, runs: prev.runs, versions: prev.versions } : prev));
        toast(next ? "Automation activated" : "Automation deactivated");
      } catch {
        toast("Couldn't update the automation");
      } finally {
        setToggling(false);
      }
    },
    [id, wf, toast],
  );

  const remove = useCallback(async () => {
    if (!wf) return;
    const hasRuns = wf.runs.length > 0;
    const ok = await confirm({
      title: `Delete "${name || wf.name}"?`,
      description: hasRuns
        ? "This automation has run history, so it will be archived and its logs stay auditable."
        : "This automation never ran and will be permanently removed.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/automation/workflows/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data?.error ?? "Couldn't delete the automation");
        return;
      }
      toast(data?.archived ? "Archived — run history preserved" : "Automation deleted");
      router.push("/automation/workflows");
    } catch {
      toast("Couldn't delete the automation");
    }
  }, [id, wf, name, confirm, router, toast]);

  /* ── edit helpers (every mutation marks the form dirty) ── */

  const markDirty = () => setDirty(true);

  const updateCondRow = (rowId: number, patch: Partial<CondRow>) => {
    setCondRows((rows) => rows.map((r) => (r._id === rowId ? { ...r, ...patch } : r)));
    markDirty();
  };
  const removeCondRow = (rowId: number) => {
    setCondRows((rows) => rows.filter((r) => r._id !== rowId));
    markDirty();
  };
  const addCondRow = () => {
    const firstField = selectedTrigger?.fields[0]?.key ?? "";
    setCondRows((rows) => [...rows, { _id: uid(), field: firstField, operator: "eq", value: "" }]);
    markDirty();
  };

  const updateActionRow = (rowId: number, patch: Partial<ActionRow>) => {
    setActionRows((rows) => rows.map((r) => (r._id === rowId ? { ...r, ...patch } : r)));
    markDirty();
  };
  const setActionParam = (rowId: number, key: string, value: string) => {
    setActionRows((rows) =>
      rows.map((r) => (r._id === rowId ? { ...r, params: { ...r.params, [key]: value } } : r)),
    );
    markDirty();
  };
  const removeActionRow = (rowId: number) => {
    setActionRows((rows) => rows.filter((r) => r._id !== rowId));
    markDirty();
  };
  const addActionRow = () => {
    setActionRows((rows) => [...rows, { _id: uid(), key: null, params: {} }]);
    markDirty();
  };

  /* ── render ── */

  if (loadError) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-white">
        <p className="text-[13px] text-zinc-500">This automation doesn&apos;t exist or you can&apos;t view it.</p>
        <Link
          href="/automation/workflows"
          className="mt-3 text-[12.5px] font-medium text-[#0073EA] hover:underline"
        >
          Back to automations →
        </Link>
      </div>
    );
  }
  if (!wf) {
    return (
      <div className="flex h-full items-center gap-2 bg-white p-6 text-[13px] text-zinc-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  const statusMeta = WORKFLOW_STATUS_META[wf.status] ?? { label: wf.status, color: "#A1A1AA" };
  const canActivate = Boolean(wf.publishedVersionId) && wf.status !== "ARCHIVED";
  const conditionFieldOptions = selectedTrigger?.fields ?? [];

  return (
    <div className="flex h-full flex-col bg-white">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-2">
        <Link
          href="/automation/workflows"
          aria-label="Back to automations"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
        >
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <Workflow className="h-4 w-4 shrink-0 text-zinc-500" />
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            markDirty();
          }}
          aria-label="Automation name"
          placeholder="Name this automation"
          className="h-7 w-full min-w-0 max-w-md rounded-md border border-transparent bg-transparent px-1.5 text-[14px] font-semibold text-zinc-900 outline-none placeholder:font-normal placeholder:text-zinc-400 hover:border-zinc-200 focus:border-zinc-300"
        />
        <StatusPill color={statusMeta.color} label={statusMeta.label} />
        {dirty ? <span className="shrink-0 text-[11px] text-zinc-400">Unsaved changes</span> : null}

        <div className="ml-auto flex shrink-0 items-center gap-3">
          <label
            className="flex items-center gap-1.5 text-[12px] text-zinc-500"
            title={canActivate ? undefined : "Publish this workflow first"}
          >
            Active
            <Switch
              checked={wf.status === "ACTIVE"}
              disabled={!canActivate || toggling}
              onChange={(next) => void toggleActive(next)}
              aria-label="Toggle automation active"
            />
          </label>
          <button
            type="button"
            onClick={() => void remove()}
            aria-label="Delete automation"
            title="Delete automation"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-red-50 hover:text-[#E2445C]"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => void saveDraft().then((ok) => ok && toast("Draft saved"))}
            disabled={saving || publishing}
            className={OUTLINE_PILL}
          >
            {saving && !publishing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Save draft
          </button>
          <button
            type="button"
            onClick={() => void publish()}
            disabled={saving || publishing}
            className={DARK_PILL}
          >
            {publishing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {wf.publishedVersionId ? "Republish" : "Publish"}
          </button>
        </div>
      </div>

      {/* Body: recipe center + right rail */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-y-auto px-8 py-10">
          <div className="mx-auto max-w-2xl">
            {/* WHEN sentence */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="text-[20px] font-semibold leading-tight text-zinc-900">When</span>
              <TriggerToken
                triggers={triggers}
                value={triggerEvent}
                onChange={(key) => {
                  setTriggerEvent(key);
                  markDirty();
                }}
              />
            </div>
            {selectedTrigger ? (
              <p className="mt-1.5 text-[12px] text-zinc-400">{selectedTrigger.description}</p>
            ) : null}

            {/* Conditions */}
            <div className="mt-6">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-semibold uppercase tracking-wide text-zinc-400">
                  Only if
                </span>
                {condRows.length > 1 ? (
                  <div className="inline-flex overflow-hidden rounded-md border border-zinc-200">
                    {(["AND", "OR"] as const).map((logic) => (
                      <button
                        key={logic}
                        type="button"
                        onClick={() => {
                          setCondLogic(logic);
                          markDirty();
                        }}
                        className={`h-6 px-2.5 text-[11px] font-semibold ${
                          condLogic === logic
                            ? "bg-zinc-900 text-white"
                            : "bg-white text-zinc-500 hover:bg-zinc-50"
                        }`}
                      >
                        {logic === "AND" ? "All (AND)" : "Any (OR)"}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="mt-2 space-y-1.5">
                {condRows.map((row) =>
                  row.opaque !== undefined ? (
                    <div
                      key={row._id}
                      className="flex h-8 items-center gap-2 rounded-lg border border-dashed border-zinc-200 bg-zinc-50 px-2.5"
                    >
                      <span className="flex-1 truncate text-[12px] text-zinc-500">
                        Nested condition group (edited via the API) — kept as-is
                      </span>
                      <button
                        type="button"
                        onClick={() => removeCondRow(row._id)}
                        aria-label="Remove condition group"
                        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div key={row._id} className="flex items-center gap-1.5">
                      <select
                        value={row.field}
                        onChange={(e) => updateCondRow(row._id, { field: e.target.value })}
                        aria-label="Condition field"
                        className={`${INPUT} w-[180px] shrink-0`}
                      >
                        {row.field === "" ? <option value="">Pick a field…</option> : null}
                        {conditionFieldOptions.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.label}
                          </option>
                        ))}
                        {row.field !== "" &&
                        !conditionFieldOptions.some((f) => f.key === row.field) ? (
                          <option value={row.field}>{row.field}</option>
                        ) : null}
                      </select>
                      <select
                        value={row.operator}
                        onChange={(e) => updateCondRow(row._id, { operator: e.target.value })}
                        aria-label="Condition operator"
                        className={`${INPUT} w-[170px] shrink-0`}
                      >
                        {CONDITION_OPERATORS.map((op) => (
                          <option key={op.key} value={op.key}>
                            {op.label}
                          </option>
                        ))}
                      </select>
                      {CONDITION_OPERATORS.find((o) => o.key === row.operator)?.needsValue !==
                      false ? (
                        <input
                          value={row.value}
                          onChange={(e) => updateCondRow(row._id, { value: e.target.value })}
                          aria-label="Condition value"
                          placeholder="Value"
                          className={`${INPUT} min-w-0 flex-1`}
                        />
                      ) : (
                        <span className="flex-1" />
                      )}
                      <button
                        type="button"
                        onClick={() => removeCondRow(row._id)}
                        aria-label="Remove condition"
                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ),
                )}
              </div>
              <button
                type="button"
                onClick={addCondRow}
                className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-zinc-500 hover:text-zinc-900"
              >
                <Plus className="h-3.5 w-3.5" /> Add condition
              </button>
            </div>

            {/* Arrow */}
            <div className="my-6">
              <ArrowDown className="h-5 w-5 text-[#00C875]" aria-hidden />
            </div>

            {/* THEN actions */}
            <div className="space-y-4">
              {actionRows.length === 0 ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="text-[20px] font-semibold leading-tight text-zinc-900">Then</span>
                  <ActionToken
                    actions={actionsCatalog}
                    value={null}
                    onChange={(key) => {
                      setActionRows([{ _id: uid(), key, params: {} }]);
                      markDirty();
                    }}
                  />
                </div>
              ) : (
                actionRows.map((row, idx) => {
                  const catalog = row.key
                    ? actionsCatalog.find((a) => a.key === row.key)
                    : undefined;
                  return (
                    <div key={row._id}>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        <span className="text-[20px] font-semibold leading-tight text-zinc-900">
                          {idx === 0 ? "Then" : "and then"}
                        </span>
                        <ActionToken
                          actions={actionsCatalog}
                          value={row.key}
                          onChange={(key) => updateActionRow(row._id, { key, params: {} })}
                        />
                        <button
                          type="button"
                          onClick={() => removeActionRow(row._id)}
                          aria-label="Remove action"
                          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {catalog ? (
                        <div className="mt-2 grid grid-cols-1 gap-x-4 gap-y-2 rounded-xl border border-zinc-200 p-3 sm:grid-cols-2">
                          {catalog.params.map((param) => (
                            <div
                              key={param.key}
                              className={param.type === "text" ? "sm:col-span-2" : undefined}
                            >
                              <label className="mb-1 block text-[11px] font-medium text-zinc-500">
                                {param.label}
                                {param.required ? (
                                  <span className="ml-0.5 text-[#E2445C]">*</span>
                                ) : null}
                              </label>
                              <ParamInput
                                actionKey={catalog.key}
                                param={param}
                                value={row.params[param.key] ?? ""}
                                people={people}
                                boards={boards}
                                onChange={(v) => setActionParam(row._id, param.key, v)}
                              />
                              {param.help ? (
                                <p className="mt-0.5 text-[10.5px] text-zinc-400">{param.help}</p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
              {actionRows.length > 0 ? (
                <button
                  type="button"
                  onClick={addActionRow}
                  className="inline-flex items-center gap-1 text-[12px] font-medium text-zinc-500 hover:text-zinc-900"
                >
                  <Plus className="h-3.5 w-3.5" /> Add another action
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {/* Right rail */}
        <div className="hidden w-[300px] shrink-0 overflow-y-auto border-l border-zinc-100 p-4 lg:block">
          <div className={`${CARD} p-3`}>
            <div className="text-[12px] font-semibold text-zinc-900">Details</div>
            <label className="mt-2 block text-[11px] font-medium text-zinc-500">Description</label>
            <textarea
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                markDirty();
              }}
              rows={2}
              placeholder="What does this automation do?"
              className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-[12px] text-zinc-800 outline-none placeholder:text-zinc-400 focus:border-zinc-400"
            />
            <label className="mt-2 block text-[11px] font-medium text-zinc-500">
              Severity (for Health)
            </label>
            <select
              value={severity}
              onChange={(e) => {
                setSeverity(e.target.value);
                markDirty();
              }}
              className={`${INPUT} mt-1 w-full`}
            >
              <option value="CRITICAL">Critical</option>
              <option value="MAJOR">Major</option>
              <option value="MINOR">Minor</option>
            </select>
            <div className="mt-3 space-y-1 border-t border-zinc-100 pt-2 text-[11.5px] text-zinc-500">
              <div className="flex justify-between">
                <span>Published</span>
                <span className="tabular-nums">
                  {wf.publishedAt ? relTime(wf.publishedAt) : "Never"}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Last run</span>
                <span className="tabular-nums">{wf.lastRunAt ? relTime(wf.lastRunAt) : "Never"}</span>
              </div>
              <div className="flex justify-between">
                <span>Versions</span>
                <span className="tabular-nums">{wf.versions.length}</span>
              </div>
            </div>
          </div>

          <div className={`${CARD} mt-3 p-3`}>
            <div className="flex items-baseline justify-between">
              <div className="text-[12px] font-semibold text-zinc-900">Run history</div>
              <Link
                href={`/automation/logs?workflowId=${wf.id}`}
                className="text-[11px] font-medium text-zinc-500 hover:text-zinc-900"
              >
                All logs →
              </Link>
            </div>
            {wf.runs.length === 0 ? (
              <p className="mt-2 text-[12px] text-zinc-400">
                No runs yet. Publish the automation and trigger the event to see runs here.
              </p>
            ) : (
              <div className="mt-1.5">
                {wf.runs.map((run) => (
                  <Link
                    key={run.id}
                    href={`/automation/logs?runId=${run.id}`}
                    className="flex h-8 items-center gap-2 border-b border-zinc-100 px-1 last:border-0 hover:bg-zinc-50"
                  >
                    <StatusPill
                      color={RUN_STATUS_COLORS[run.status] ?? "#A1A1AA"}
                      label={run.status.toLowerCase()}
                    />
                    <span className="min-w-0 flex-1 truncate text-[11.5px] text-zinc-500">
                      {run.errorMessage ?? run.triggerEventKey}
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums text-zinc-400">
                      {relTime(run.createdAt)}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
