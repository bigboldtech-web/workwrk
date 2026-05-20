"use client";

// Build — Phase D4. WorkwrK's Vibe equivalent. Describe an app, Claude
// generates a schema + sample data, you save it, and it becomes a real
// page at /build/[slug].

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Wand2,
  Sparkles,
  ArrowUp,
  Loader2,
  Plus,
  Trash2,
  Check,
  AlertCircle,
} from "lucide-react";

type FieldType = "TEXT" | "TEXTAREA" | "NUMBER" | "DATE" | "CHECKBOX" | "SELECT" | "MULTI_SELECT" | "URL" | "EMAIL";

interface AppField {
  key: string;
  label: string;
  fieldType: FieldType;
  options?: { choices?: { value: string; label?: string }[] };
}

interface GeneratedApp {
  name: string;
  slug: string;
  description?: string;
  iconKey?: string;
  hue?: string;
  fields: AppField[];
  sampleRows?: Record<string, unknown>[];
}

interface SavedApp {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  iconKey: string | null;
  hue: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

const IDEAS = [
  "Vendor scorecard with cost / quality / risk",
  "Customer onboarding checklist with milestones",
  "Bug triage board with severity + reproducibility",
  "Equipment request tracker for IT",
  "Sales objection log with response templates",
  "Internal mentorship pairings tracker",
  "Marketing campaign brief library",
  "Quarterly OKR check-in tracker",
];

const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  TEXT: "Text", TEXTAREA: "Long text", NUMBER: "Number", DATE: "Date",
  CHECKBOX: "Checkbox", SELECT: "Single select", MULTI_SELECT: "Multi select",
  URL: "URL", EMAIL: "Email",
};

export default function BuildPage() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<GeneratedApp | null>(null);
  const [tokens, setTokens] = useState<{ in: number; out: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [savedApps, setSavedApps] = useState<SavedApp[]>([]);
  const [loadingApps, setLoadingApps] = useState(true);

  const loadApps = useCallback(async () => {
    setLoadingApps(true);
    try {
      const res = await fetch("/api/build/apps");
      if (!res.ok) return;
      const data = await res.json();
      setSavedApps(data.apps ?? []);
    } finally {
      setLoadingApps(false);
    }
  }, []);

  useEffect(() => { loadApps(); }, [loadApps]);

  async function generate() {
    if (!prompt.trim() || generating) return;
    setGenerating(true);
    setGenerated(null);
    setError(null);
    try {
      const res = await fetch("/api/build/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Generate failed");
        return;
      }
      if (data.app) {
        setGenerated(data.app as GeneratedApp);
      } else {
        setError("Model didn't return valid JSON. Raw:\n\n" + (data.rawText ?? ""));
      }
      setTokens({ in: data.tokensIn ?? 0, out: data.tokensOut ?? 0 });
    } finally {
      setGenerating(false);
    }
  }

  async function saveApp() {
    if (!generated || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/build/apps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: generated.name,
          slug: generated.slug,
          description: generated.description,
          iconKey: generated.iconKey,
          hue: generated.hue,
          prompt,
          fields: generated.fields,
          sampleRows: generated.sampleRows,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Save failed");
        return;
      }
      router.push(`/build/${data.app.slug}`);
    } finally {
      setSaving(false);
    }
  }

  function applyIdea(idea: string) {
    setPrompt(idea);
    requestAnimationFrame(() => {
      const ta = document.getElementById("build-prompt") as HTMLTextAreaElement | null;
      ta?.focus();
    });
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="text-center mb-8 pt-6">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-gradient-to-r from-violet-200 to-pink-200 dark:from-violet-900/40 dark:to-pink-900/40 text-violet-700 dark:text-violet-300 text-xs font-medium mb-4">
          <Wand2 size={12} />
          Build
        </div>
        <h1 className="text-3xl font-semibold mb-2">Describe an app — get an app.</h1>
        <p className="text-muted max-w-xl mx-auto">
          Sketch any internal tool with a sentence. Claude generates the schema + sample data; you review, save, and use it.
        </p>
      </div>

      {/* Prompt */}
      <div className="relative mb-6 rounded-3xl p-[2px] bg-gradient-to-r from-violet-400 via-pink-400 to-amber-400">
        <div className="rounded-3xl bg-surface p-5">
          <textarea
            id="build-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) generate(); }}
            placeholder="Build a vendor scorecard with cost / quality / risk fields…"
            rows={3}
            disabled={generating}
            className="w-full bg-transparent text-sm focus:outline-none resize-none"
          />
          <div className="flex items-center justify-between pt-2 border-t border-border mt-2">
            <span className="text-[11px] text-muted-2">Cmd+Enter to generate</span>
            <button
              type="button"
              onClick={generate}
              disabled={!prompt.trim() || generating}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-1.5 rounded-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium disabled:opacity-30"
            >
              {generating ? <Loader2 size={12} className="animate-spin" /> : <ArrowUp size={12} />}
              {generating ? "Generating…" : "Generate"}
            </button>
          </div>
        </div>
      </div>

      {/* Ideas */}
      {!generated && (
        <div className="text-center mb-8">
          <p className="text-xs uppercase tracking-wider text-muted-2 mb-3">Ideas to start from</p>
          <div className="flex flex-wrap justify-center gap-2">
            {IDEAS.map((idea) => (
              <button
                key={idea}
                type="button"
                onClick={() => applyIdea(idea)}
                disabled={generating}
                className="text-xs px-3 py-1.5 rounded-full border border-border text-muted hover:border-violet-300 hover:text-violet-700 dark:hover:text-violet-300 transition-colors disabled:opacity-50"
              >
                {idea}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="mb-6 rounded-lg border border-rose-200 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-xs text-rose-700 inline-flex items-start gap-2 max-w-3xl mx-auto whitespace-pre-wrap font-mono">
          <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Generated preview */}
      {generated && (
        <div className="mb-10 rounded-2xl border-2 border-violet-200 dark:border-violet-800 bg-violet-50/40 dark:bg-violet-950/20 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 rounded-xl bg-${generated.hue ?? "violet"}-100 text-${generated.hue ?? "violet"}-600 flex items-center justify-center font-bold text-lg`}>
                {generated.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <h2 className="text-lg font-semibold">{generated.name}</h2>
                {generated.description && <p className="text-xs text-muted">{generated.description}</p>}
                <p className="font-mono text-[10px] text-muted-2 mt-0.5">/build/{generated.slug}</p>
              </div>
            </div>
            {tokens && <span className="text-[10px] text-muted-2">{tokens.in} in + {tokens.out} out</span>}
          </div>

          {/* Fields */}
          <div>
            <h3 className="text-xs uppercase tracking-wider text-muted-2 mb-2">Schema · {generated.fields.length} field{generated.fields.length === 1 ? "" : "s"}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {generated.fields.map((f) => (
                <div key={f.key} className="rounded-lg border border-border bg-surface px-3 py-2 text-xs">
                  <div className="font-medium">{f.label}</div>
                  <div className="text-muted-2 mt-0.5 inline-flex items-center gap-1.5">
                    <code className="font-mono text-[10px]">{f.key}</code>
                    <span>·</span>
                    <span>{FIELD_TYPE_LABEL[f.fieldType] ?? f.fieldType}</span>
                    {f.options?.choices && <span>· {f.options.choices.length} choices</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Sample rows */}
          {generated.sampleRows && generated.sampleRows.length > 0 && (
            <div>
              <h3 className="text-xs uppercase tracking-wider text-muted-2 mb-2">Sample data · {generated.sampleRows.length} row{generated.sampleRows.length === 1 ? "" : "s"}</h3>
              <div className="rounded-lg border border-border bg-surface overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-surface-2 text-muted-2 uppercase tracking-wider text-[10px]">
                    <tr>{generated.fields.map((f) => <th key={f.key} className="text-left px-3 py-2 font-medium">{f.label}</th>)}</tr>
                  </thead>
                  <tbody>
                    {generated.sampleRows.map((row, i) => (
                      <tr key={i} className="border-t border-border">
                        {generated.fields.map((f) => (
                          <td key={f.key} className="px-3 py-2 truncate max-w-[200px]">
                            {f.fieldType === "MULTI_SELECT" && Array.isArray(row[f.key])
                              ? (row[f.key] as string[]).join(", ")
                              : f.fieldType === "CHECKBOX"
                                ? row[f.key] ? "✓" : "—"
                                : String(row[f.key] ?? "—")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-violet-200 dark:border-violet-800">
            <button
              type="button"
              onClick={() => { setGenerated(null); setError(null); }}
              className="px-3 py-2 rounded-lg text-sm text-muted hover:bg-surface-2"
            >
              Discard
            </button>
            <button
              type="button"
              onClick={saveApp}
              disabled={saving}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              {saving ? "Saving…" : "Save app"}
            </button>
          </div>
        </div>
      )}

      {/* Saved apps */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-2 inline-flex items-center gap-1.5">
            <Sparkles size={12} /> Your apps
          </h2>
        </div>
        {loadingApps ? (
          <div className="text-sm text-muted text-center py-10">Loading apps…</div>
        ) : savedApps.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-surface text-center py-10">
            <Wand2 size={28} className="mx-auto mb-2 text-muted-2" />
            <p className="text-sm text-muted">No apps yet. Describe one above to get started.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {savedApps.map((a) => (
              <Link
                key={a.id}
                href={`/build/${a.slug}`}
                className="group rounded-xl border border-border bg-surface p-4 hover:border-violet-300 transition-colors"
              >
                <div className="flex items-start gap-3 mb-2">
                  <div className={`w-10 h-10 rounded-lg bg-${a.hue ?? "violet"}-100 text-${a.hue ?? "violet"}-600 flex items-center justify-center font-bold flex-shrink-0`}>
                    {a.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{a.name}</div>
                    {a.description && <p className="text-[11px] text-muted line-clamp-2">{a.description}</p>}
                  </div>
                </div>
                <div className="text-[10px] text-muted-2 font-mono">/build/{a.slug}</div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
