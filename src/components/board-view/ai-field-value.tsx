"use client";

// The four AI field types (Batch 8, src/lib/ai-fields.ts) in a table cell or
// a task detail row: the value, who wrote it (AI or a person), Fill with AI
// or Refill, and a person's correction.
//
// Offered only as far as the workspace allows. With "AI fields in Lists" off,
// or Ask AI not available to this viewer (a Guest, the AI app hidden, AI
// turned off), a stored value still reads and nothing offers a fill or an
// edit; a stored value of any other shape reads as the empty placeholder,
// exactly as these columns did before.
//
// A cell never replaces a person's correction: its Refill is offered on an
// AI value only. The task detail's Refill over a correction asks first.

import { useContext, useState, type ReactNode } from "react";
import { RotateCw, Sparkles } from "lucide-react";
import { Dots } from "@/components/ui/dots";
import { useConfirm } from "@/components/ui/dialog-provider";
import { BootContext } from "@/components/layout/os/boot-context";
import { OsShellContext } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { WINDOW_EVENTS } from "@/lib/realtime-events";
import type { FieldDef } from "@/lib/field-catalog";
import {
  AI_TEXT_MAX,
  SENTIMENTS,
  SENTIMENT_LABEL,
  aiFieldConfig,
  aiFieldNotReady,
  parseAiValue,
  type AiFieldConfig,
  type AiFieldType,
  type AiFieldValue,
  type Sentiment,
} from "@/lib/ai-fields";
import { requestAiFill } from "@/lib/ai-fill-client";

const EMPTY = "—";

/** Each sentiment's chip, in the semantic tokens (light and dark themes). */
const SENTIMENT_TONE: Record<Sentiment, string> = {
  positive: "bg-success-bg text-success-text",
  neutral: "bg-subtle text-ink-2",
  negative: "bg-danger-bg text-danger-text",
  mixed: "bg-warning-bg text-warning-text",
};

/** Fill with AI is offered: the workspace turned AI fields on and this viewer has Ask AI. */
export function useAiFieldsAvailable(): boolean {
  const boot = useContext(BootContext);
  const shell = useContext(OsShellContext);
  return Boolean(boot?.boot.org.aiFields) && Boolean(shell?.askAiVisible);
}

/**
 * Every host showing this task re-reads it (the List under the drawer, the
 * open task). `boardId: null` so no List reads the event as the task leaving.
 */
function announce(itemId: string) {
  try {
    window.dispatchEvent(new CustomEvent(WINDOW_EVENTS.realtime, { detail: { type: "item", itemId, boardId: null } }));
  } catch {
    // The host's own poll catches up.
  }
}

function dayOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function provenance(v: AiFieldValue): string {
  const day = dayOf(v.at);
  return v.source === "ai" ? `Filled with AI${day ? ` on ${day}` : ""}` : `Edited by hand${day ? ` on ${day}` : ""}`;
}

const NOT_READY_TEXT = {
  needs_categories: "Add at least two categories to this field in the Fields panel.",
  needs_language: "Pick a language for this field in the Fields panel.",
} as const;

/** A pill: a token tone, or a choice's own colour (choice colours are data). */
function Chip({ tone, color, children }: { tone?: string; color?: string; children: ReactNode }) {
  return (
    <span
      className={`inline-flex max-w-full items-center truncate whitespace-nowrap px-2 py-0.5 rounded text-xs font-medium ${color ? "" : tone ?? "bg-subtle text-ink-2"}`}
      style={color ? { background: `${color}22`, color } : undefined}
    >
      {children}
    </span>
  );
}

function ValueBody({ config, value, full }: { config: AiFieldConfig; value: AiFieldValue; full: boolean }) {
  if (value.sentiment) return <Chip tone={SENTIMENT_TONE[value.sentiment]}>{SENTIMENT_LABEL[value.sentiment]}</Chip>;
  if (value.choice) {
    const c = config.choices.find((x) => x.value === value.choice);
    if (!c) return <span className="text-xs text-ink-3">{EMPTY}</span>;
    return <Chip color={c.color}>{c.label}</Chip>;
  }
  if (full) return <p className="text-xs text-ink whitespace-pre-wrap break-words">{value.text}</p>;
  return <span className="min-w-0 truncate text-xs" title={value.text}>{value.text}</span>;
}

export function AiFieldValue({
  field,
  value,
  editable,
  itemId,
  fieldListId,
  layout,
  onChange,
  onFilled,
}: {
  field: FieldDef;
  value: unknown;
  /** The viewer may change this task's fields here. */
  editable: boolean;
  itemId: string | null;
  /** The List whose field this is: the task's home, or a List it is linked into. */
  fieldListId: string | null;
  layout: "cell" | "row";
  /** A person's correction, written as any field edit is. */
  onChange?: (next: unknown) => void;
  /** The host's own copy takes a fill's value (else every host re-reads the task). */
  onFilled?: (value: AiFieldValue) => void;
}) {
  const config = aiFieldConfig(field);
  const available = useAiFieldsAvailable();
  const { toast } = useOsToast();
  // A fill's answer shows at once, until the host's value moves.
  const [local, setLocal] = useState<{ base: unknown; value: AiFieldValue } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!config) return <span className="text-xs text-ink-3">{EMPTY}</span>;
  const type = field.type as AiFieldType;
  // What is stored, as this person sees it: a fill's answer until the host
  // catches up, else the host's value.
  const raw = local && local.base === value ? local.value : value;
  const shown = parseAiValue(type, raw);
  // A value of another shape (written before AI fields, by an import or an
  // API client) is data: it is shown, and never treated as empty.
  const older = !shown && !(raw === undefined || raw === null || raw === "") ? raw : undefined;
  const canFill = available && editable && !!itemId;
  const notReady = aiFieldNotReady(config);

  const fill = async () => {
    if (!itemId || busy) return;
    setBusy(true);
    // The value replaced is exactly the one shown here, or nothing is written.
    const r = await requestAiFill({ itemId, fieldKey: field.key, contextBoardId: fieldListId, expect: raw ?? null });
    setBusy(false);
    if (!r.ok) {
      toast(r.message);
      return;
    }
    if ("skipped" in r) return;
    setLocal({ base: value, value: r.value });
    if (onFilled) onFilled(r.value);
    else announce(itemId);
  };

  if (layout === "row") {
    return (
      <AiRow
        config={config}
        shown={shown}
        older={older}
        busy={busy}
        canFill={canFill && !notReady}
        notReady={canFill ? notReady : null}
        canCorrect={available && editable && !!onChange}
        onFill={fill}
        onCorrect={(next) => {
          if (next) setLocal({ base: value, value: next });
          else setLocal(null);
          onChange?.(next);
        }}
      />
    );
  }

  if (busy) return <Dots variant="pending" label="Filling" className="text-ink-3" />;
  if (older !== undefined) {
    return <span className="min-w-0 truncate text-xs text-ink-2" title="An older value, not written by AI fields">{olderText(older)}</span>;
  }
  if (!shown) {
    if (!canFill || notReady) return <span className="text-xs text-ink-3">{EMPTY}</span>;
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); void fill(); }}
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-ink-3 hover:bg-hover hover:text-ink"
        title="Fill with AI"
      >
        <Sparkles className="w-3 h-3" aria-hidden />
        Fill
      </button>
    );
  }
  return (
    <span className="group/ai inline-flex min-w-0 max-w-full items-center gap-1" title={provenance(shown)}>
      {shown.source === "ai" ? <Sparkles className="w-3 h-3 shrink-0 text-brand-deep" aria-label="Filled with AI" /> : null}
      <ValueBody config={config} value={shown} full={false} />
      {canFill && !notReady && shown.source === "ai" ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); void fill(); }}
          className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded text-ink-3 opacity-0 group-hover/ai:opacity-100 focus-visible:opacity-100 hover:bg-hover hover:text-ink"
          aria-label="Refill with AI"
          title="Refill with AI"
        >
          <RotateCw className="w-3 h-3" />
        </button>
      ) : null}
    </span>
  );
}

/** An older value in words: its text, or a plain note for any other shape. */
function olderText(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "Older value";
}

// ── The task detail row: the value, where it came from, and its actions ──

function AiRow({
  config,
  shown,
  older,
  busy,
  canFill,
  notReady,
  canCorrect,
  onFill,
  onCorrect,
}: {
  config: AiFieldConfig;
  shown: AiFieldValue | null;
  /** A stored value of another shape: shown, and replaced only when asked twice. */
  older: unknown;
  busy: boolean;
  canFill: boolean;
  notReady: keyof typeof NOT_READY_TEXT | null;
  canCorrect: boolean;
  onFill: () => Promise<void>;
  onCorrect: (next: AiFieldValue | null) => void;
}) {
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const stamp = () => ({ source: "person" as const, at: new Date().toISOString(), by: null });

  const refill = async () => {
    // A person's correction is theirs, and an older value is data: replacing
    // either is asked first.
    if (shown?.source === "person" || older !== undefined) {
      const ok = await confirm({
        title: older !== undefined ? "Replace the older value?" : "Replace the edited value?",
        description: older !== undefined
          ? "This field holds a value that was not written by AI fields. A new AI fill replaces it."
          : "Someone edited this value by hand. A new AI fill replaces it.",
        confirmLabel: "Replace",
      });
      if (!ok) return;
    }
    await onFill();
  };
  const hasValue = !!shown || older !== undefined;

  const link = "text-xs font-medium text-ink-2 hover:text-ink";
  const actions = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {shown ? (
        <span className="inline-flex items-center gap-1 text-xs text-ink-3">
          {shown.source === "ai" ? <Sparkles className="w-3 h-3 text-brand-deep" aria-hidden /> : null}
          {provenance(shown)}
        </span>
      ) : null}
      {busy ? <Dots variant="pending" label="Filling" className="text-ink-3" /> : null}
      {!busy && canFill ? (
        <button type="button" className={`${link} inline-flex items-center gap-1`} onClick={() => void (hasValue ? refill() : onFill())}>
          {hasValue ? <RotateCw className="w-3 h-3" aria-hidden /> : <Sparkles className="w-3 h-3" aria-hidden />}
          {hasValue ? "Refill" : "Fill with AI"}
        </button>
      ) : null}
      {!busy && notReady ? <span className="text-xs text-ink-3">{NOT_READY_TEXT[notReady]}</span> : null}
      {!busy && canCorrect ? (
        <button
          type="button"
          className={link}
          onClick={() => { setDraft(shown?.text ?? (typeof older === "string" ? older : "")); setEditing(true); }}
        >
          Edit
        </button>
      ) : null}
      {!busy && canCorrect && hasValue ? (
        <button type="button" className={link} onClick={() => onCorrect(null)}>
          Clear
        </button>
      ) : null}
    </div>
  );

  if (editing) {
    if (config.type === "SUMMARY" || config.type === "TRANSLATION") {
      const save = () => {
        const text = draft.trim();
        setEditing(false);
        if (text === (shown?.text ?? "").trim()) return;
        onCorrect(text ? { text, ...stamp() } : null);
      };
      return (
        <div className="w-full space-y-1.5">
          <textarea
            rows={config.type === "TRANSLATION" ? 5 : 3}
            value={draft}
            maxLength={AI_TEXT_MAX}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") setEditing(false); }}
            aria-label={config.type === "TRANSLATION" ? "Translation" : "Summary"}
            className="w-full px-2 py-1 rounded-md border border-line bg-raised text-xs resize-y focus:outline-none focus:border-[var(--os-brand)]"
          />
          <div className="flex items-center gap-2">
            <button type="button" onClick={save} className="h-7 rounded-md bg-[var(--os-brand)] px-2.5 text-xs font-medium text-white">
              Save
            </button>
            <button type="button" onClick={() => setEditing(false)} className="h-7 rounded-md px-2.5 text-xs font-medium text-ink-2 hover:bg-hover">
              Cancel
            </button>
          </div>
        </div>
      );
    }
    const options: Array<{ key: string; label: string; tone?: string; color?: string; pick: AiFieldValue }> =
      config.type === "SENTIMENT"
        ? SENTIMENTS.map((s) => ({ key: s, label: SENTIMENT_LABEL[s], tone: SENTIMENT_TONE[s], pick: { sentiment: s, ...stamp() } }))
        : config.choices.map((c) => ({ key: c.value, label: c.label, color: c.color, pick: { choice: c.value, ...stamp() } }));
    const current = shown?.sentiment ?? shown?.choice ?? null;
    return (
      <div className="w-full space-y-1.5">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Pick a value">
          {options.map((o) => (
            <button
              key={o.key}
              type="button"
              aria-pressed={current === o.key}
              onClick={() => { setEditing(false); if (current !== o.key) onCorrect(o.pick); }}
              className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${o.color ? "" : o.tone ?? "bg-subtle text-ink-2"} ${current === o.key ? "ring-2 ring-[var(--os-brand)]" : ""}`}
              style={o.color ? { background: `${o.color}22`, color: o.color } : undefined}
            >
              {o.label}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setEditing(false)} className="text-xs font-medium text-ink-2 hover:text-ink">
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 space-y-1">
      {shown ? (
        <ValueBody config={config} value={shown} full />
      ) : older !== undefined ? (
        <p className="text-xs text-ink-2 whitespace-pre-wrap break-words">
          {olderText(older)}
          <span className="block text-ink-3">An older value, not written by AI fields.</span>
        </p>
      ) : (
        <span className="text-xs text-ink-3">{EMPTY}</span>
      )}
      {canFill || notReady || canCorrect || hasValue || busy ? actions : null}
    </div>
  );
}
