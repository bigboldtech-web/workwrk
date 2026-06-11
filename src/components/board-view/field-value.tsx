"use client";

// FieldValue — render or edit a value for any FieldDef. Two modes:
//   mode="display"  → compact, read-only (used in TABLE cells)
//   mode="edit"     → inline editor (used in drawer rows)
//
// Phase 3f wires editors for Tier 1 types (TEXT, LONG_TEXT, NUMBER,
// DATE, DATETIME, DROPDOWN, MULTI_SELECT, CHECKBOX, LABELS,
// TSHIRT_SIZE, URL, EMAIL, PHONE, MONEY, PERCENT, RATING). Tier 2 /
// AI types render as a muted "—" placeholder until Phase 4+.

import { useEffect, useState } from "react";
import { Check, ChevronDown, MapPin, Paperclip, Star, Target, ThumbsUp } from "lucide-react";
import type { FieldChoice, FieldDef } from "@/lib/field-catalog";
import { AssigneePicker, PersonAvatar, type PersonRef } from "./assignee-picker";

// Tiny module-level cache for KRA lookups — every KRA cell on the
// page shares one fetch instead of N parallel requests.
type KraLite = { id: string; name: string; category: string | null };
let _krasCache: { items: KraLite[]; loadedAt: number } | null = null;
let _krasPromise: Promise<KraLite[]> | null = null;

async function loadKras(): Promise<KraLite[]> {
  // Refresh every 60s so newly-added KRAs trickle in.
  if (_krasCache && Date.now() - _krasCache.loadedAt < 60_000) {
    return _krasCache.items;
  }
  if (_krasPromise) return _krasPromise;
  _krasPromise = (async () => {
    const res = await fetch("/api/kras?scope=all", { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    const items: KraLite[] = (data.kras ?? []).map((k: { id: string; name: string; category: string | null }) => ({
      id: k.id, name: k.name, category: k.category,
    }));
    _krasCache = { items, loadedAt: Date.now() };
    return items;
  })();
  try {
    return await _krasPromise;
  } finally {
    _krasPromise = null;
  }
}

// Module-level user cache — every USER/PEOPLE/VOTING cell on the page
// shares one fetch (same pattern as the KRA cache above).
let _usersCache: { items: PersonRef[]; loadedAt: number } | null = null;
let _usersPromise: Promise<PersonRef[]> | null = null;

async function loadUsers(): Promise<PersonRef[]> {
  if (_usersCache && Date.now() - _usersCache.loadedAt < 60_000) {
    return _usersCache.items;
  }
  if (_usersPromise) return _usersPromise;
  _usersPromise = (async () => {
    const res = await fetch("/api/users?scope=all&limit=200", { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    const items: PersonRef[] = Array.isArray(data?.data) ? data.data : [];
    _usersCache = { items, loadedAt: Date.now() };
    return items;
  })();
  try {
    return await _usersPromise;
  } finally {
    _usersPromise = null;
  }
}

function useOrgUsers(): PersonRef[] {
  const [users, setUsers] = useState<PersonRef[]>(_usersCache?.items ?? []);
  useEffect(() => {
    let active = true;
    void loadUsers().then((items) => { if (active) setUsers(items); });
    return () => { active = false; };
  }, []);
  return users;
}

interface FieldValueProps {
  field: FieldDef;
  value: unknown;
  mode: "display" | "edit";
  /** Called with the new value when the editor commits. */
  onChange?: (next: unknown) => void;
  /** Editor disabled (read-only). */
  disabled?: boolean;
  /** Session user id — needed by VOTING to toggle the viewer's vote. */
  currentUserId?: string | null;
}

export function FieldValue(props: FieldValueProps) {
  const { field, value, mode, onChange, disabled, currentUserId } = props;
  const readOnly = mode === "display" || disabled || !onChange;

  switch (field.type) {
    case "TEXT":
    case "URL":
    case "EMAIL":
    case "PHONE":
      return <TextValue field={field} value={value} readOnly={readOnly} onChange={onChange} />;
    case "LONG_TEXT":
      return <LongTextValue value={value} readOnly={readOnly} onChange={onChange} />;
    case "NUMBER":
    case "MONEY":
    case "PERCENT":
      return <NumberValue field={field} value={value} readOnly={readOnly} onChange={onChange} />;
    case "DATE":
    case "DATETIME":
      return <DateValue field={field} value={value} readOnly={readOnly} onChange={onChange} />;
    case "CHECKBOX":
      return <CheckboxValue value={value} readOnly={readOnly} onChange={onChange} />;
    case "DROPDOWN":
    case "TSHIRT_SIZE":
      return <DropdownValue field={field} value={value} readOnly={readOnly} onChange={onChange} />;
    case "MULTI_SELECT":
    case "LABELS":
      return <MultiSelectValue field={field} value={value} readOnly={readOnly} onChange={onChange} />;
    case "RATING":
      return <RatingValue field={field} value={value} readOnly={readOnly} onChange={onChange} />;
    case "KRA":
      return <KraValue value={value} readOnly={readOnly} onChange={onChange} />;
    case "USER":
      return <UserValue value={value} readOnly={readOnly} onChange={onChange} />;
    case "PEOPLE":
      return <PeopleValue value={value} readOnly={readOnly} onChange={onChange} />;
    case "PROGRESS_MANUAL":
      return <ProgressValue value={value} readOnly={readOnly} onChange={onChange} />;
    case "LOCATION":
      return <LocationValue value={value} readOnly={readOnly} onChange={onChange} />;
    case "VOTING":
      return <VotingValue value={value} readOnly={readOnly} onChange={onChange} currentUserId={currentUserId ?? null} />;
    case "FILES":
      return <FilesValue value={value} />;
    default:
      return <span className="text-xs text-zinc-500">—</span>;
  }
}

// ── Person (single user id) ───────────────────────────────────────

function UserValue({
  value,
  readOnly,
  onChange,
}: {
  value: unknown;
  readOnly: boolean;
  onChange?: (v: unknown) => void;
}) {
  const userId = typeof value === "string" ? value : null;
  const users = useOrgUsers();
  const person = userId ? users.find((u) => u.id === userId) ?? null : null;

  if (readOnly) {
    if (!userId) return <span className="text-xs text-zinc-500">—</span>;
    if (!person) return <span className="text-xs text-zinc-500">Loading…</span>;
    return (
      <span className="inline-flex items-center gap-1.5">
        <PersonAvatar person={person} size={20} />
        <span className="text-sm truncate">{`${person.firstName ?? ""} ${person.lastName ?? ""}`.trim() || person.email}</span>
      </span>
    );
  }
  return (
    <AssigneePicker
      value={person}
      canEdit
      onChange={(p) => onChange?.(p?.id ?? null)}
    />
  );
}

// ── People (array of user ids) ────────────────────────────────────

function PeopleValue({
  value,
  readOnly,
  onChange,
}: {
  value: unknown;
  readOnly: boolean;
  onChange?: (v: unknown) => void;
}) {
  const ids = Array.isArray(value) ? (value as string[]).filter((x) => typeof x === "string") : [];
  const users = useOrgUsers();
  const [open, setOpen] = useState(false);
  const selected = ids.map((id) => users.find((u) => u.id === id)).filter((u): u is PersonRef => !!u);

  const stack = ids.length === 0 ? (
    <span className="text-xs text-zinc-500">—</span>
  ) : (
    <span className="inline-flex items-center -space-x-1.5">
      {selected.slice(0, 4).map((p) => (
        <span key={p.id} className="rounded-full ring-2 ring-white" title={`${p.firstName ?? ""} ${p.lastName ?? ""}`.trim()}>
          <PersonAvatar person={p} size={22} />
        </span>
      ))}
      {ids.length > 4 ? <span className="text-[11px] text-zinc-500 pl-2.5">+{ids.length - 4}</span> : null}
    </span>
  );

  if (readOnly) return stack;
  const toggle = (id: string) => {
    const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
    onChange?.(next);
  };
  return (
    <div className="relative inline-block">
      <button type="button" onClick={() => setOpen((x) => !x)} className="inline-flex items-center gap-1.5 rounded px-1 py-0.5 -mx-1 hover:bg-zinc-100">
        {stack}
        <ChevronDown className="w-3 h-3 text-zinc-500" />
      </button>
      {open ? (
        <div
          className="absolute z-10 mt-1 left-0 min-w-[220px] max-h-[260px] overflow-y-auto rounded-md border border-zinc-200 bg-white shadow-lg py-1"
          onMouseLeave={() => setOpen(false)}
        >
          {users.length === 0 ? (
            <div className="px-2 py-2 text-xs text-zinc-500">Loading…</div>
          ) : (
            users.map((p) => {
              const on = ids.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggle(p.id)}
                  className="flex items-center gap-2 w-full px-2 py-1.5 text-left text-sm hover:bg-zinc-50"
                >
                  <PersonAvatar person={p} size={20} />
                  <span className="flex-1 truncate">{`${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.email}</span>
                  {on ? <Check className="w-3.5 h-3.5 text-[var(--os-brand)]" /> : null}
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}

// ── Progress (manual 0–100) ───────────────────────────────────────

function ProgressValue({
  value,
  readOnly,
  onChange,
}: {
  value: unknown;
  readOnly: boolean;
  onChange?: (v: unknown) => void;
}) {
  const n = typeof value === "number" ? Math.max(0, Math.min(100, value)) : null;
  const bar = (
    <span className="inline-flex items-center gap-2 min-w-[110px]">
      <span className="flex-1 h-1.5 rounded-full bg-zinc-100 overflow-hidden min-w-[64px]">
        <span className="block h-full rounded-full bg-[var(--os-brand)]" style={{ width: `${n ?? 0}%` }} />
      </span>
      <span className="text-xs text-zinc-600 tabular-nums w-8 text-right">{n == null ? "—" : `${n}%`}</span>
    </span>
  );
  if (readOnly) return bar;
  return (
    <span className="inline-flex items-center gap-2 w-full max-w-[200px]">
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={n ?? 0}
        onChange={(e) => onChange?.(Number(e.target.value))}
        className="flex-1 accent-[var(--os-brand)]"
      />
      <span className="text-xs text-zinc-600 tabular-nums w-8 text-right">{n == null ? "0%" : `${n}%`}</span>
    </span>
  );
}

// ── Location (free text + maps link) ──────────────────────────────

function LocationValue({
  value,
  readOnly,
  onChange,
}: {
  value: unknown;
  readOnly: boolean;
  onChange?: (v: unknown) => void;
}) {
  const v = typeof value === "string" ? value : "";
  const [draft, setDraft] = useState(v);
  // Derived-state-during-render pattern (guarded setState is allowed)
  // — avoids the cascading-renders lint that fires on useEffect(setDraft).
  const [synced, setSynced] = useState(v);
  if (synced !== v) {
    setSynced(v);
    setDraft(v);
  }
  if (readOnly) {
    if (!v) return <span className="text-xs text-zinc-500">—</span>;
    return (
      <a
        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v)}`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-sm text-[var(--os-brand)] hover:underline max-w-full"
      >
        <MapPin className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate">{v}</span>
      </a>
    );
  }
  return (
    <input
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== v) onChange?.(draft || null); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur(); }}
      className="w-full bg-transparent text-sm outline-none border-b border-transparent focus:border-[var(--os-brand)]"
      placeholder="Add a location…"
    />
  );
}

// ── Voting (array of voter user ids) ──────────────────────────────

function VotingValue({
  value,
  readOnly,
  onChange,
  currentUserId,
}: {
  value: unknown;
  readOnly: boolean;
  onChange?: (v: unknown) => void;
  currentUserId: string | null;
}) {
  const ids = Array.isArray(value) ? (value as string[]).filter((x) => typeof x === "string") : [];
  const voted = !!currentUserId && ids.includes(currentUserId);
  const canVote = !readOnly && !!currentUserId;
  return (
    <button
      type="button"
      disabled={!canVote}
      onClick={() => {
        if (!currentUserId) return;
        onChange?.(voted ? ids.filter((x) => x !== currentUserId) : [...ids, currentUserId]);
      }}
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium ${
        voted ? "bg-[color-mix(in_srgb,var(--os-brand)_14%,transparent)] text-[var(--os-brand)]" : "bg-zinc-100 text-zinc-600"
      } ${canVote ? "hover:opacity-80" : "cursor-default"}`}
      title={canVote ? (voted ? "Remove your vote" : "Vote") : undefined}
    >
      <ThumbsUp className={`w-3.5 h-3.5 ${voted ? "fill-current" : ""}`} />
      {ids.length}
    </button>
  );
}

// ── Files (display-only count; manage in the drawer's Files section) ──

function FilesValue({ value }: { value: unknown }) {
  const count = Array.isArray(value) ? value.length : 0;
  if (!count) return <span className="text-xs text-zinc-500">—</span>;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-zinc-600">
      <Paperclip className="w-3.5 h-3.5" />
      {count} file{count > 1 ? "s" : ""}
    </span>
  );
}

// ── Text-like (TEXT, URL, EMAIL, PHONE) ───────────────────────────

function TextValue({
  field,
  value,
  readOnly,
  onChange,
}: {
  field: FieldDef;
  value: unknown;
  readOnly: boolean;
  onChange?: (v: string) => void;
}) {
  const v = typeof value === "string" ? value : "";
  const [draft, setDraft] = useState(v);
  // Derived-state-during-render (guarded setState) — avoids the
  // cascading-renders lint that fires on useEffect(setDraft).
  const [synced, setSynced] = useState(v);
  if (synced !== v) {
    setSynced(v);
    setDraft(v);
  }
  if (readOnly) {
    if (!v) return <span className="text-xs text-zinc-500">—</span>;
    if (field.type === "URL" && /^https?:\/\//.test(v)) {
      return <a href={v} className="text-sm text-[var(--os-brand)] hover:underline truncate inline-block max-w-full" target="_blank" rel="noreferrer">{v}</a>;
    }
    if (field.type === "EMAIL" && v.includes("@")) {
      return <a href={`mailto:${v}`} className="text-sm text-[var(--os-brand)] hover:underline">{v}</a>;
    }
    return <span className="text-sm">{v}</span>;
  }
  return (
    <input
      type={field.type === "URL" ? "url" : field.type === "EMAIL" ? "email" : field.type === "PHONE" ? "tel" : "text"}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== v) onChange?.(draft); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur(); }}
      className="w-full bg-transparent text-sm outline-none border-b border-transparent focus:border-[var(--os-brand)]"
      placeholder="—"
    />
  );
}

function LongTextValue({
  value,
  readOnly,
  onChange,
}: {
  value: unknown;
  readOnly: boolean;
  onChange?: (v: string) => void;
}) {
  const v = typeof value === "string" ? value : "";
  const [draft, setDraft] = useState(v);
  const [synced, setSynced] = useState(v);
  if (synced !== v) {
    setSynced(v);
    setDraft(v);
  }
  if (readOnly) {
    if (!v) return <span className="text-xs text-zinc-500">—</span>;
    return <span className="text-sm whitespace-pre-wrap break-words">{v}</span>;
  }
  return (
    <textarea
      rows={3}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== v) onChange?.(draft); }}
      className="w-full px-2 py-1 rounded-md border border-zinc-200 bg-white text-sm resize-y focus:outline-none focus:border-[var(--os-brand)]"
      placeholder="—"
    />
  );
}

// ── Number-like (NUMBER, MONEY, PERCENT) ──────────────────────────

function NumberValue({
  field,
  value,
  readOnly,
  onChange,
}: {
  field: FieldDef;
  value: unknown;
  readOnly: boolean;
  onChange?: (v: number | null) => void;
}) {
  const n = typeof value === "number" ? value : null;
  const [draft, setDraft] = useState<string>(n == null ? "" : String(n));
  const [syncedN, setSyncedN] = useState(n);
  if (syncedN !== n) {
    setSyncedN(n);
    setDraft(n == null ? "" : String(n));
  }

  const formatDisplay = (x: number): string => {
    const decimals = field.options?.decimals ?? (field.type === "MONEY" ? 2 : 0);
    if (field.type === "MONEY") {
      const cur = field.options?.currency ?? "USD";
      try {
        return new Intl.NumberFormat(undefined, { style: "currency", currency: cur, minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(x);
      } catch {
        return `${cur} ${x.toFixed(decimals)}`;
      }
    }
    if (field.type === "PERCENT") return `${x.toFixed(decimals)}%`;
    return x.toFixed(decimals);
  };

  if (readOnly) {
    if (n == null) return <span className="text-xs text-zinc-500">—</span>;
    return <span className="text-sm">{formatDisplay(n)}</span>;
  }
  return (
    <input
      type="number"
      step="any"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft === "") { if (n != null) onChange?.(null); return; }
        const parsed = Number(draft);
        if (!Number.isFinite(parsed)) return;
        if (parsed !== n) onChange?.(parsed);
      }}
      className="w-full bg-transparent text-sm outline-none border-b border-transparent focus:border-[var(--os-brand)]"
      placeholder="—"
    />
  );
}

// ── Date / DateTime ───────────────────────────────────────────────

function DateValue({
  field,
  value,
  readOnly,
  onChange,
}: {
  field: FieldDef;
  value: unknown;
  readOnly: boolean;
  onChange?: (v: string | null) => void;
}) {
  const v = typeof value === "string" ? value : "";
  if (readOnly) {
    if (!v) return <span className="text-xs text-zinc-500">—</span>;
    // Invalid dates fall back to the raw string — no try/catch around
    // JSX (new Date never throws; it yields NaN time instead).
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return <span className="text-sm">{v}</span>;
    return (
      <span className="text-sm">
        {field.type === "DATETIME" ? d.toLocaleString() : d.toLocaleDateString()}
      </span>
    );
  }
  const kind: "DATE" | "DATETIME" = field.type === "DATETIME" ? "DATETIME" : "DATE";
  return (
    <input
      type={kind === "DATETIME" ? "datetime-local" : "date"}
      value={toInputDate(v, kind)}
      onChange={(e) => onChange?.(e.target.value || null)}
      className="bg-transparent text-sm outline-none border-b border-transparent focus:border-[var(--os-brand)]"
    />
  );
}

function toInputDate(raw: string, type: "DATE" | "DATETIME"): string {
  if (!raw) return "";
  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return "";
    if (type === "DATE") return d.toISOString().slice(0, 10);
    // datetime-local wants YYYY-MM-DDTHH:mm
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return "";
  }
}

// ── Checkbox ──────────────────────────────────────────────────────

function CheckboxValue({
  value,
  readOnly,
  onChange,
}: {
  value: unknown;
  readOnly: boolean;
  onChange?: (v: boolean) => void;
}) {
  const checked = !!value;
  return (
    <button
      type="button"
      disabled={readOnly}
      onClick={() => onChange?.(!checked)}
      className={`inline-flex items-center justify-center w-[18px] h-[18px] rounded border ${
        checked ? "bg-[var(--os-brand)] border-[var(--os-brand)] text-white" : "border-zinc-200 text-transparent"
      } ${readOnly ? "cursor-default opacity-70" : ""}`}
      aria-checked={checked}
    >
      <Check className="w-3 h-3" />
    </button>
  );
}

// ── Dropdown (single choice) ──────────────────────────────────────

function DropdownValue({
  field,
  value,
  readOnly,
  onChange,
}: {
  field: FieldDef;
  value: unknown;
  readOnly: boolean;
  onChange?: (v: string | null) => void;
}) {
  const choices: FieldChoice[] = field.options?.choices ?? [];
  const v = typeof value === "string" ? value : "";
  const current = choices.find((c) => c.value === v) ?? null;
  const [open, setOpen] = useState(false);

  const pill = current ? (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
      style={{ background: `${current.color ?? "#94a3b8"}22`, color: current.color ?? "#475569" }}
    >
      {current.label}
    </span>
  ) : (
    <span className="text-xs text-zinc-500">—</span>
  );

  if (readOnly) return pill;
  return (
    <div className="relative inline-block">
      <button type="button" onClick={() => setOpen((x) => !x)} className="inline-flex items-center gap-1.5">
        {pill}
        <ChevronDown className="w-3 h-3 text-zinc-500" />
      </button>
      {open ? (
        <div className="absolute z-10 mt-1 left-0 min-w-[180px] rounded-md border border-zinc-200 bg-white shadow-lg py-1" onMouseLeave={() => setOpen(false)}>
          {choices.length === 0 ? (
            <div className="px-2 py-1 text-xs text-zinc-500">No options yet</div>
          ) : (
            choices.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => { onChange?.(c.value); setOpen(false); }}
                className="flex items-center gap-2 w-full px-2 py-1.5 text-left text-sm hover:bg-zinc-50"
              >
                <span
                  className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                  style={{ background: `${c.color ?? "#94a3b8"}22`, color: c.color ?? "#475569" }}
                >
                  {c.label}
                </span>
                {c.value === v ? <Check className="w-3.5 h-3.5 ml-auto text-[var(--os-brand)]" /> : null}
              </button>
            ))
          )}
          <button
            type="button"
            onClick={() => { onChange?.(null); setOpen(false); }}
            className="block w-full px-2 py-1.5 text-left text-xs text-zinc-500 hover:bg-zinc-50"
          >
            Clear
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ── Multi-select / Labels (array of choice values) ────────────────

function MultiSelectValue({
  field,
  value,
  readOnly,
  onChange,
}: {
  field: FieldDef;
  value: unknown;
  readOnly: boolean;
  onChange?: (v: string[]) => void;
}) {
  const choices: FieldChoice[] = field.options?.choices ?? [];
  const values = Array.isArray(value) ? (value as string[]) : [];
  const chips = values.map((v) => choices.find((c) => c.value === v)).filter((c): c is FieldChoice => !!c);

  if (readOnly) {
    if (chips.length === 0) return <span className="text-xs text-zinc-500">—</span>;
    return (
      <span className="flex flex-wrap gap-1">
        {chips.map((c) => (
          <span
            key={c.value}
            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
            style={{ background: `${c.color ?? "#94a3b8"}22`, color: c.color ?? "#475569" }}
          >
            {c.label}
          </span>
        ))}
      </span>
    );
  }
  const toggle = (val: string) => {
    const next = values.includes(val) ? values.filter((x) => x !== val) : [...values, val];
    onChange?.(next);
  };
  return (
    <div className="flex flex-wrap gap-1">
      {choices.length === 0 ? (
        <span className="text-xs text-zinc-500">No options yet</span>
      ) : (
        choices.map((c) => {
          const on = values.includes(c.value);
          return (
            <button
              key={c.value}
              type="button"
              onClick={() => toggle(c.value)}
              className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                on ? "" : "opacity-50"
              }`}
              style={{ background: `${c.color ?? "#94a3b8"}22`, color: c.color ?? "#475569" }}
            >
              {c.label}
            </button>
          );
        })
      )}
    </div>
  );
}

// ── Rating (1..N stars) ───────────────────────────────────────────

// ── KRA picker (WorkwrK AI-OS) ────────────────────────────────────

function KraValue({
  value,
  readOnly,
  onChange,
}: {
  value: unknown;
  readOnly: boolean;
  onChange?: (v: string | null) => void;
}) {
  const v = typeof value === "string" ? value : "";
  const [kras, setKras] = useState<KraLite[]>(_krasCache?.items ?? []);
  const [loading, setLoading] = useState(!_krasCache);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let active = true;
    void loadKras().then((items) => {
      if (active) { setKras(items); setLoading(false); }
    });
    return () => { active = false; };
  }, []);

  const current = v ? kras.find((k) => k.id === v) : null;
  const display = current ? (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-[color-mix(in_srgb,var(--os-brand)_14%,transparent)] text-[var(--os-brand)]">
      <Target className="w-3 h-3" />
      {current.name}
    </span>
  ) : v ? (
    <span className="text-xs text-zinc-500">{loading ? "Loading…" : "Unknown KRA"}</span>
  ) : (
    <span className="text-xs text-zinc-500">—</span>
  );

  if (readOnly) return display;
  return (
    <div className="relative inline-block">
      <button type="button" onClick={() => setOpen((x) => !x)} className="inline-flex items-center gap-1.5">
        {display}
        <ChevronDown className="w-3 h-3 text-zinc-500" />
      </button>
      {open ? (
        <div
          className="absolute z-10 mt-1 left-0 min-w-[260px] max-h-[320px] overflow-y-auto rounded-md border border-zinc-200 bg-white shadow-lg py-1"
          onMouseLeave={() => setOpen(false)}
        >
          {loading ? (
            <div className="px-2 py-2 text-xs text-zinc-500">Loading…</div>
          ) : kras.length === 0 ? (
            <div className="px-2 py-2 text-xs text-zinc-500">No KRAs in this org yet.</div>
          ) : (
            kras.map((k) => (
              <button
                key={k.id}
                type="button"
                onClick={() => { onChange?.(k.id); setOpen(false); }}
                className="flex items-center gap-2 w-full px-2 py-1.5 text-left text-sm hover:bg-zinc-50"
              >
                <Target className="w-3.5 h-3.5 text-zinc-500" />
                <span className="flex-1 truncate">
                  {k.name}
                  {k.category ? <span className="ml-2 text-[10px] uppercase tracking-wide text-zinc-500">{k.category}</span> : null}
                </span>
                {k.id === v ? <Check className="w-3.5 h-3.5 text-[var(--os-brand)]" /> : null}
              </button>
            ))
          )}
          {v ? (
            <button
              type="button"
              onClick={() => { onChange?.(null); setOpen(false); }}
              className="block w-full px-2 py-1.5 text-left text-xs text-zinc-500 hover:bg-zinc-50 border-t border-zinc-200 mt-1"
            >
              Clear
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function RatingValue({
  field,
  value,
  readOnly,
  onChange,
}: {
  field: FieldDef;
  value: unknown;
  readOnly: boolean;
  onChange?: (v: number | null) => void;
}) {
  const max = field.options?.ratingMax ?? 5;
  const n = typeof value === "number" ? Math.max(0, Math.min(max, value)) : 0;
  return (
    <div className="inline-flex items-center gap-0.5">
      {Array.from({ length: max }, (_, i) => i + 1).map((i) => (
        <button
          key={i}
          type="button"
          disabled={readOnly}
          onClick={() => onChange?.(i === n ? null : i)}
          className={readOnly ? "cursor-default" : "cursor-pointer"}
          aria-label={`Rate ${i}`}
        >
          <Star className={`w-4 h-4 ${i <= n ? "fill-amber-400 text-amber-400" : "text-zinc-500"}`} />
        </button>
      ))}
    </div>
  );
}
