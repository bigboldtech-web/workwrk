"use client";

// The setup form for an AI field (Batch 8, src/lib/ai-fields.ts), in the
// Fields panel in place of the tabs, as Connect and Mirror have theirs: its
// name, then what its type needs (Categorize its categories, Translation its
// language and what it translates), what a fill reads, and an optional
// instruction. The same form edits a field that exists.
//
// The server checks everything again (normalizeAiFieldOptions); the form only
// keeps a person from sending what would be refused.

import { useState } from "react";
import { ArrowLeft, Check, Plus, X } from "lucide-react";
import { Dots } from "@/components/ui/dots";
import { CHOICE_SWATCHES, FIELD_TYPE_BY_KEY, type FieldChoice, type FieldDef, type FieldOptions } from "@/lib/field-catalog";
import {
  AI_CHOICES_MAX,
  AI_CHOICES_MIN,
  AI_CHOICE_LABEL_MAX,
  AI_LANGUAGES,
  AI_PROMPT_MAX,
  aiFieldConfig,
  type AiFieldType,
  type TranslationSource,
} from "@/lib/ai-fields";
import { accessMessage } from "@/lib/access-message";

const BLURB: Record<AiFieldType, string> = {
  SUMMARY: "A short summary of each task, written by AI when someone asks.",
  SENTIMENT: "Positive, neutral, negative or mixed: the tone of what people wrote.",
  CATEGORIZE: "AI picks one of your categories for each task.",
  TRANSLATION: "The task's description or title, translated by AI.",
};

const PROMPT_HINT: Record<AiFieldType, string> = {
  SUMMARY: "For example: lead with what is blocking the task.",
  SENTIMENT: "For example: read only what the customer wrote.",
  CATEGORIZE: "For example: a task about invoices is always Billing.",
  TRANSLATION: "For example: keep product names in English.",
};

/** A refusal from the field routes, in words. */
export function aiOptionsMessage(payload: unknown, fallback: string): string {
  const p = (payload ?? {}) as { error?: unknown; issue?: unknown };
  if (p.error !== "invalid_options") return accessMessage(payload, fallback);
  switch (p.issue) {
    case "prompt_too_long": return `Keep the instruction under ${AI_PROMPT_MAX} characters.`;
    case "invalid_prompt": return "The instruction must be plain text.";
    case "too_few_choices": return `Add at least ${AI_CHOICES_MIN} categories.`;
    case "too_many_choices": return `Use at most ${AI_CHOICES_MAX} categories.`;
    case "invalid_choices": return "Give every category a different name.";
    case "unknown_language": return "Pick a language from the list.";
    case "invalid_source": return "Pick what to translate.";
    default: return fallback;
  }
}

function slug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function AiFieldSetup({
  boardId,
  type,
  existing = null,
  initialLabel,
  onCancel,
  onSaved,
}: {
  boardId: string;
  type: AiFieldType;
  /** Edit mode: the field being changed. */
  existing?: FieldDef | null;
  initialLabel?: string;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const entry = FIELD_TYPE_BY_KEY[type];
  const Icon = entry.Icon;
  const start = existing ? aiFieldConfig(existing) : null;
  const [label, setLabel] = useState(existing?.label ?? initialLabel ?? entry.label);
  const [prompt, setPrompt] = useState(start?.prompt ?? "");
  const [inputs, setInputs] = useState(start?.inputs ?? { description: true, comments: true, fields: true });
  const [choices, setChoices] = useState<FieldChoice[]>(start?.choices ?? []);
  const [draft, setDraft] = useState("");
  const [language, setLanguage] = useState(start?.language ?? "");
  const [from, setFrom] = useState<TranslationSource>(start?.translateFrom ?? "description");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addChoice = () => {
    const name = draft.trim().slice(0, AI_CHOICE_LABEL_MAX);
    if (!name) return;
    if (choices.some((c) => c.label.toLowerCase() === name.toLowerCase())) {
      setError("That category is already on the list.");
      return;
    }
    if (choices.length >= AI_CHOICES_MAX) {
      setError(`Use at most ${AI_CHOICES_MAX} categories.`);
      return;
    }
    const taken = new Set(choices.map((c) => c.value));
    const base = slug(name) || "category";
    let value = base;
    for (let n = 2; taken.has(value); n += 1) value = `${base}_${n}`;
    setChoices([...choices, { value, label: name, color: CHOICE_SWATCHES[choices.length % CHOICE_SWATCHES.length] }]);
    setDraft("");
    setError(null);
  };

  const blocker = (): string | null => {
    if (!label.trim()) return "Give the field a name.";
    if (type === "CATEGORIZE" && choices.length < AI_CHOICES_MIN) return `Add at least ${AI_CHOICES_MIN} categories.`;
    if (type === "TRANSLATION" && !language) return "Pick a language to translate into.";
    if (prompt.trim().length > AI_PROMPT_MAX) return `Keep the instruction under ${AI_PROMPT_MAX} characters.`;
    return null;
  };

  const submit = async () => {
    const why = blocker();
    if (why) {
      setError(why);
      return;
    }
    const options: FieldOptions = { ...(prompt.trim() ? { prompt: prompt.trim() } : {}) };
    if (type === "TRANSLATION") {
      options.language = language;
      options.translateFrom = from;
    } else {
      options.aiInputs = inputs;
      if (type === "CATEGORIZE") options.choices = choices;
    }
    setBusy(true);
    setError(null);
    try {
      const res = existing
        ? await fetch(`/api/boards/${boardId}/fields/${encodeURIComponent(existing.key)}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ...(label.trim() !== existing.label ? { label: label.trim() } : {}), options }),
          })
        : await fetch(`/api/boards/${boardId}/fields`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ label: label.trim(), type, options }),
          });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(aiOptionsMessage(data, existing ? "Couldn't save this field." : "Couldn't add this field."));
        return;
      }
      await onSaved();
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const toggle = (k: keyof typeof inputs) => setInputs((cur) => ({ ...cur, [k]: !cur[k] }));
  const inputCls = "h-9 w-full rounded-md border border-line bg-raised px-2.5 text-base text-ink outline-none focus:border-brand";

  return (
    <div className="flex flex-col gap-4 px-2 pt-1">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onCancel} aria-label="Back to fields" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
          <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
        </button>
        <Icon className="h-4 w-4 shrink-0" style={{ color: entry.color }} strokeWidth={1.5} aria-hidden />
        <h3 className="text-base font-semibold text-ink">{existing ? `Edit ${entry.label}` : `New ${entry.label} field`}</h3>
      </div>
      <p className="-mt-2 text-sm text-ink-2">{BLURB[type]}</p>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-ink">Name</span>
        <input value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} className={inputCls} />
      </label>

      {type === "CATEGORIZE" ? (
        <div>
          <span className="mb-1 block text-sm font-medium text-ink">Categories</span>
          <p className="mb-2 text-xs text-ink-2">Between {AI_CHOICES_MIN} and {AI_CHOICES_MAX}. Renaming one keeps the tasks already filled with it.</p>
          <ul className="space-y-1">
            {choices.map((c) => (
              <li key={c.value} className="flex items-center gap-2">
                <span className={`h-3 w-3 shrink-0 rounded-full ${c.color ? "" : "bg-ink-3"}`} style={c.color ? { background: c.color } : undefined} aria-hidden />
                <input
                  value={c.label}
                  maxLength={AI_CHOICE_LABEL_MAX}
                  aria-label="Category name"
                  onChange={(e) => setChoices(choices.map((x) => (x.value === c.value ? { ...x, label: e.target.value } : x)))}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (!v) setChoices(choices.map((x) => (x.value === c.value ? { ...x, label: c.label.trim() || "Category" } : x)));
                  }}
                  className="h-8 min-w-0 flex-1 rounded-md border border-line bg-raised px-2 text-sm text-ink outline-none focus:border-brand"
                />
                <button
                  type="button"
                  onClick={() => setChoices(choices.filter((x) => x.value !== c.value))}
                  aria-label={`Remove ${c.label}`}
                  className="inline-flex h-7 w-7 items-center justify-center rounded text-ink-3 hover:bg-hover hover:text-ink"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-1.5 flex items-center gap-2">
            <Plus className="h-3.5 w-3.5 shrink-0 text-ink-3" aria-hidden />
            <input
              value={draft}
              maxLength={AI_CHOICE_LABEL_MAX}
              placeholder="Add a category"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addChoice(); } }}
              onBlur={() => { if (draft.trim()) addChoice(); }}
              className="h-8 min-w-0 flex-1 rounded-md border border-line bg-raised px-2 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-brand"
            />
          </div>
        </div>
      ) : null}

      {type === "TRANSLATION" ? (
        <>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">Translate into</span>
            <select value={language} onChange={(e) => setLanguage(e.target.value)} className={inputCls}>
              <option value="">Pick a language</option>
              {AI_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">Translate</span>
            <select value={from} onChange={(e) => setFrom(e.target.value as TranslationSource)} className={inputCls}>
              <option value="description">The description</option>
              <option value="title">The task name</option>
            </select>
          </label>
        </>
      ) : (
        <fieldset>
          <legend className="mb-1 block text-sm font-medium text-ink">What AI reads</legend>
          <p className="mb-2 text-xs text-ink-2">Always the task name, status, priority and due date. Never people, files, links or other AI fields.</p>
          {(
            [
              ["description", "The description"],
              ["comments", "The latest 20 comments"],
              ["fields", "Other fields on this List"],
            ] as const
          ).map(([k, text]) => (
            <label key={k} className="flex items-center gap-2 py-0.5 text-sm text-ink">
              <input type="checkbox" checked={inputs[k]} onChange={() => toggle(k)} className="h-4 w-4 accent-[var(--os-brand)]" />
              {text}
            </label>
          ))}
        </fieldset>
      )}

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-ink">Instruction (optional)</span>
        <textarea
          rows={2}
          value={prompt}
          maxLength={AI_PROMPT_MAX}
          placeholder={PROMPT_HINT[type]}
          onChange={(e) => setPrompt(e.target.value)}
          className="w-full rounded-md border border-line bg-raised px-2.5 py-1.5 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-brand"
        />
        <span className="mt-0.5 block text-right text-xs tabular-nums text-ink-3">{prompt.length}/{AI_PROMPT_MAX}</span>
      </label>

      <p className="rounded-md bg-subtle px-3 py-2 text-xs text-ink-2">
        A task is filled only when someone with edit access chooses Fill with AI. What it reads is sent to the AI provider, and everyone who can see this List sees the result.
      </p>

      {error ? (
        <div className="flex items-start gap-2 rounded-md bg-danger-bg px-3 py-2" role="alert">
          <span className="min-w-0 flex-1 text-sm text-danger-text">{error}</span>
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} className="h-8 rounded-md px-3 text-sm text-ink-2 hover:bg-hover">Cancel</button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-brand px-3 text-sm font-medium text-ink-inv hover:bg-brand-hover disabled:opacity-50"
        >
          {busy ? <Dots variant="pending" /> : <Check className="h-4 w-4" strokeWidth={1.5} aria-hidden />}
          {existing ? "Save" : "Create field"}
        </button>
      </div>
    </div>
  );
}
