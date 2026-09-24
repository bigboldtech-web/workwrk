"use client";

// BoardFormView: the FORM renderer. A board tab that hosts an intake form
// whose responses create Items on this board (FormDefinition.
// targetBoardId). View.config.formId points at the connected form.
//
// No form yet → setup card: create a new form targeting this board, or
// connect an existing one. Connected → render the live form INLINE through
// the one FormRenderer (it used to iframe /embed/forms/[id], and the embed
// now serves a form's public link only, as an embed must), with Copy link
// (the responder URL, which the person it is sent to can open), Copy embed
// code (the iframe snippet, offered only while the form's public link is on,
// since the embed serves nothing else), Edit form (only for someone the
// builder would open for: GET /api/forms/[id] answers them) and Change.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, ClipboardList, ExternalLink, Link2, RefreshCcw } from "lucide-react";
import { Dots } from "@/components/ui/dots";
import { FormRenderer } from "@/components/forms/form-renderer";
import { usePublicForm } from "@/components/forms/use-public-form";

interface ApiForm {
  id: string;
  name: string;
  targetBoardId?: string | null;
  submissionCount?: number;
}

interface BoardFormViewProps {
  boardId: string;
  viewId: string | null;
  viewConfig: Record<string, unknown>;
  canEdit: boolean;
}

export function BoardFormView({ boardId, viewId, viewConfig, canEdit }: BoardFormViewProps) {
  const [formId, setFormId] = useState<string | null>(
    typeof viewConfig?.formId === "string" ? (viewConfig.formId as string) : null,
  );
  const [forms, setForms] = useState<ApiForm[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"link" | "embed" | null>(null);
  const [picking, setPicking] = useState(false);
  // What the builder's own read says about the connected form: whether its
  // public link is live (Copy embed code) and whether this person can open
  // the builder at all (Edit form). A 404 (a Guest's form made by someone
  // else) hides Edit form rather than linking to the in-shell 404.
  const [meta, setMeta] = useState<{ id: string; publicLive: boolean; canOpen: boolean } | null>(null);
  useEffect(() => {
    if (!formId) return;
    let alive = true;
    void fetch(`/api/forms/${encodeURIComponent(formId)}`, { cache: "no-store" })
      .then(async (r) => {
        const d = r.ok ? await r.json().catch(() => null) : null;
        const f = (d?.data ?? d) as { isPublic?: boolean; publicLinksAllowed?: boolean } | null;
        if (alive) setMeta({ id: formId, publicLive: !!f?.isPublic && f.publicLinksAllowed !== false, canOpen: r.ok });
      })
      .catch(() => { if (alive) setMeta({ id: formId, publicLive: false, canOpen: true }); });
    return () => { alive = false; };
  }, [formId]);
  const formMeta = meta && meta.id === formId ? meta : null;

  const persistFormId = useCallback((next: string | null) => {
    setFormId(next);
    if (!viewId) return;
    void fetch(`/api/boards/${boardId}/views/${viewId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config: { ...(viewConfig ?? {}), formId: next } }),
    }).catch(() => {});
  }, [boardId, viewId, viewConfig]);

  // Load org forms for the picker (setup + "change form").
  useEffect(() => {
    if (formId && !picking) return;
    if (forms !== null) return;
    let cancelled = false;
    void fetch("/api/forms")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => {
        if (cancelled) return;
        const rows = Array.isArray(d) ? d : Array.isArray(d?.data) ? d.data : [];
        setForms(rows);
      })
      .catch(() => { if (!cancelled) setForms([]); });
    return () => { cancelled = true; };
  }, [formId, picking, forms]);

  const createForm = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/forms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Intake form",
          targetBoardId: boardId,
          fields: [
            { id: Math.random().toString(36).slice(2, 10), type: "short_text", label: "Title", required: true },
            { id: Math.random().toString(36).slice(2, 10), type: "long_text", label: "Details", required: false },
          ],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as { error?: string })?.error ?? "Couldn't create form");
        return;
      }
      const created = (data as { data?: ApiForm })?.data ?? (data as ApiForm);
      if (created?.id) {
        persistFormId(created.id);
        setPicking(false);
      }
    } finally {
      setBusy(false);
    }
  };

  // Copy link hands out the RESPONDER, which a colleague or (with a public
  // link) a customer can open; the embed URL is chrome-less and only serves a
  // public form, so it rides in the iframe snippet instead.
  const copy = async (what: "link" | "embed") => {
    if (!formId) return;
    const origin = window.location.origin;
    const text = what === "link"
      ? `${origin}/forms/${formId}/respond`
      : `<iframe src="${origin}/embed/forms/${formId}" width="100%" height="640" style="border:0" title="Form"></iframe>`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1200);
    } catch {}
  };

  if (!formId || picking) {
    return (
      <div className="rounded-lg border border-line bg-raised px-8 py-12">
        <div className="max-w-md mx-auto text-center">
          <ClipboardList className="w-8 h-8 mx-auto text-ink-4 mb-3" />
          <h3 className="text-base font-semibold text-ink mb-1">
            {picking ? "Change the connected form" : "Connect a form to this List"}
          </h3>
          <p className="text-base text-ink-2 mb-5">
            Responses create tasks on this List automatically. Create a fresh intake
            form, or connect a form you already built.
          </p>
          {error ? <p className="text-sm text-danger-text mb-3">{error}</p> : null}
          {canEdit ? (
            <div className="flex items-center justify-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => void createForm()}
                disabled={busy}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-base font-medium text-ink-inv bg-brand hover:bg-brand-hover disabled:opacity-50"
              >
                {busy ? <Dots variant="pending" /> : null}
                Create intake form
              </button>
              {forms === null ? (
                <span className="inline-flex h-8 items-center px-2" aria-busy="true" aria-label="Your forms"><Dots variant="pending" /></span>
              ) : forms.length > 0 ? (
                <select
                  defaultValue=""
                  onChange={(e) => { if (e.target.value) { persistFormId(e.target.value); setPicking(false); } }}
                  className="h-8 rounded-lg border border-line bg-raised px-2 text-base text-ink outline-none focus:border-brand"
                >
                  <option value="" disabled>Connect existing…</option>
                  {forms.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}{typeof f.submissionCount === "number" ? ` (${f.submissionCount})` : ""}
                    </option>
                  ))}
                </select>
              ) : null}
              {picking ? (
                <button
                  type="button"
                  onClick={() => setPicking(false)}
                  className="h-8 px-3 rounded-lg text-base text-ink-2 hover:bg-hover"
                >
                  Cancel
                </button>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-ink-3">Ask a List editor to connect a form.</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-line bg-raised overflow-hidden">
      <div className="px-3 py-2 border-b border-line-soft flex items-center gap-2">
        <ClipboardList className="w-3.5 h-3.5 text-brand-deep" />
        <span className="text-base font-medium text-ink">Live form</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => void copy("link")}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-line text-xs text-ink-2 hover:bg-hover"
        >
          {copied === "link" ? <Check className="w-3 h-3 text-success-text" /> : <Link2 className="w-3 h-3" />}
          {copied === "link" ? "Copied" : "Copy link"}
        </button>
        {formMeta?.publicLive ? (
          <button
            type="button"
            onClick={() => void copy("embed")}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-line text-xs text-ink-2 hover:bg-hover"
            title="An iframe snippet for a page outside WorkwrK"
          >
            {copied === "embed" ? <Check className="w-3 h-3 text-success-text" /> : null}
            {copied === "embed" ? "Copied" : "Copy embed code"}
          </button>
        ) : null}
        {formMeta?.canOpen ? (
          <Link
            href={`/forms/${formId}`}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-line text-xs text-ink-2 hover:bg-hover"
          >
            <ExternalLink className="w-3 h-3" />
            Edit form
          </Link>
        ) : null}
        {canEdit ? (
          <button
            type="button"
            onClick={() => { setPicking(true); setForms(null); }}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-line text-xs text-ink-2 hover:bg-hover"
            title="Connect a different form"
          >
            <RefreshCcw className="w-3 h-3" />
            Change
          </button>
        ) : null}
      </div>
      <div className="overflow-auto bg-app p-4" style={{ height: "calc(100vh - 320px)", minHeight: 480 }}>
        <BoardLiveForm key={formId} formId={formId} />
      </div>
    </div>
  );
}

/** The connected form, answered in place by whoever is looking at the List. */
function BoardLiveForm({ formId }: { formId: string }) {
  const { state, form, answers, setAnswers, submit, reload } = usePublicForm(formId, { embed: false });
  if (state === "loading") {
    return (
      <div className="mx-auto max-w-[640px] rounded-lg border border-line bg-raised p-6" aria-busy="true" aria-label="The form">
        {[0, 1, 2].map((i) => (
          <div key={i} className="mb-5 flex flex-col gap-2">
            <span className="h-3.5 w-1/3 rounded bg-skeleton os-skeleton-pulse" />
            <span className="h-9 w-full rounded-md bg-skeleton os-skeleton-pulse" />
          </div>
        ))}
      </div>
    );
  }
  if (state === "invalid") {
    return <p className="py-12 text-center text-row text-ink-2">This form is not shared with you.</p>;
  }
  if (state === "error" || !form) {
    return (
      <div className="py-12 text-center">
        <p className="text-row text-ink">We could not load this form.</p>
        <button type="button" onClick={() => void reload()} className="mt-2 text-sm font-medium text-brand-deep hover:underline">Retry</button>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-[640px]">
      <FormRenderer form={form} answers={answers} onAnswersChange={setAnswers} onSubmit={submit} abilities={{ pickPeople: form.viewer.canSubmit, upload: form.viewer.canSubmit }} />
    </div>
  );
}
