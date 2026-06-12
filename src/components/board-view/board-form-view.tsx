"use client";

// BoardFormView — FORM renderer. A board tab that hosts an intake form
// whose submissions create Items on this board (FormDefinition.
// targetBoardId). View.config.formId points at the connected form.
//
// No form yet → setup card: create a new form targeting this board, or
// connect an existing one. Connected → render the live form via the
// chrome-less /embed/forms/[id] iframe + Edit / Copy link / Change
// actions.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, ClipboardList, ExternalLink, Link2, Loader2, RefreshCcw } from "lucide-react";

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
  const [copied, setCopied] = useState(false);
  const [picking, setPicking] = useState(false);

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

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/embed/forms/${formId}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  };

  if (!formId || picking) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white px-8 py-12">
        <div className="max-w-md mx-auto text-center">
          <ClipboardList className="w-8 h-8 mx-auto text-violet-400 mb-3" />
          <h3 className="text-[15px] font-semibold text-zinc-900 mb-1">
            {picking ? "Change the connected form" : "Connect a form to this List"}
          </h3>
          <p className="text-[12.5px] text-zinc-500 mb-5">
            Submissions create tasks on this List automatically. Create a fresh intake
            form, or connect a form you already built.
          </p>
          {error ? <p className="text-[12px] text-red-500 mb-3">{error}</p> : null}
          {canEdit ? (
            <div className="flex items-center justify-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => void createForm()}
                disabled={busy}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-medium text-white bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                Create intake form
              </button>
              {forms === null ? (
                <span className="text-[12px] text-zinc-400">Loading forms…</span>
              ) : forms.length > 0 ? (
                <select
                  defaultValue=""
                  onChange={(e) => { if (e.target.value) { persistFormId(e.target.value); setPicking(false); } }}
                  className="h-8 rounded-lg border border-zinc-200 bg-white px-2 text-[12.5px] text-zinc-700 outline-none focus:border-zinc-400"
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
                  className="h-8 px-3 rounded-lg text-[12.5px] text-zinc-500 hover:bg-zinc-50"
                >
                  Cancel
                </button>
              ) : null}
            </div>
          ) : (
            <p className="text-[12px] text-zinc-400">Ask a List editor to connect a form.</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white overflow-hidden">
      <div className="px-3 py-2 border-b border-zinc-100 flex items-center gap-2">
        <ClipboardList className="w-3.5 h-3.5 text-violet-500" />
        <span className="text-[12.5px] font-medium text-zinc-800">Live form</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => void copyLink()}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-zinc-200 text-[11.5px] text-zinc-600 hover:bg-zinc-50"
        >
          {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Link2 className="w-3 h-3" />}
          {copied ? "Copied" : "Copy link"}
        </button>
        <Link
          href={`/forms/${formId}`}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-zinc-200 text-[11.5px] text-zinc-600 hover:bg-zinc-50"
        >
          <ExternalLink className="w-3 h-3" />
          Edit form
        </Link>
        {canEdit ? (
          <button
            type="button"
            onClick={() => { setPicking(true); setForms(null); }}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-zinc-200 text-[11.5px] text-zinc-600 hover:bg-zinc-50"
            title="Connect a different form"
          >
            <RefreshCcw className="w-3 h-3" />
            Change
          </button>
        ) : null}
      </div>
      <iframe
        src={`/embed/forms/${formId}`}
        title="Board form"
        className="w-full bg-white"
        style={{ height: "calc(100vh - 320px)", minHeight: 480 }}
      />
    </div>
  );
}
