"use client";

// usePublicForm: the load, the draft and the send behind the two public
// responders (/forms/[id]/respond and /embed/forms/[id]). FormRenderer draws;
// this decides what a send means.
//
// Data integrity (the founder's rule: answers are never lost):
//   - every keystroke is mirrored into sessionStorage, keyed per form, which
//     survives the same-tab round trip through /login;
//   - on load, a draft younger than a day is restored into the fields, and a
//     stale one is deleted, so a shared machine does not keep a stranger's
//     answers. Nothing is kept in localStorage any more (a legacy draft there
//     is read once and removed);
//   - the embed hands its answers to the new first-party tab in the URL
//     fragment (#draft=...), because a third-party iframe's storage is
//     partitioned by the host site and the new tab could never read it; the
//     responder strips the fragment on arrival;
//   - Submit goes out with keepalive and is retried on a network error or a
//     5xx, four attempts with a growing pause, before a failure is shown. Each
//     Submit carries one submission key, so a retry after a lost answer finds
//     the response the first attempt wrote instead of writing a second;
//   - a failure never clears the fields, and the draft is only dropped after
//     the server has answered 201.
//
// Sign-in (the decided model, access invariant 19: a public link carries Can
// view, sending needs a session): a signed-out visitor who presses Submit is
// sent to /login?callbackUrl=<this form> with the draft saved, and comes back
// to the same answers. The embed cannot navigate its host, so it offers the
// same round trip in a new tab instead. The one exception is a public form
// that accepts responses from people without an account (D16): the read says
// `viewer.anonymousSubmit`, and Submit posts straight away with no sign-in.
//
// A send that still fails after its retries says so with a Retry link, which
// presses Submit again with the same answers and the same submission key, so
// a first attempt that did land is found instead of written twice.

import { useCallback, useEffect, useRef, useState } from "react";
import type { RendererForm, SubmitOutcome } from "./form-renderer";
import { fetchWithRetry } from "@/lib/fetch-retry";
import {
  draftHash, formDraftKey, newSubmissionKey, readDraftHash, readFormDraft, readFormFields,
  writeFormDraft, type FormAnswers,
} from "@/lib/forms/fields";

export interface PublicFormPayload extends RendererForm {
  /** canSubmit: a member sending as themselves. anonymousSubmit: anyone
   *  else, allowed because the form accepts responses without an account. */
  viewer: { signedIn: boolean; canSubmit: boolean; anonymousSubmit: boolean };
}

type LoadState = "loading" | "ready" | "invalid" | "error";

function readStored(store: Storage, key: string): FormAnswers | null {
  const raw = store.getItem(key);
  if (raw === null) return null;
  const draft = readFormDraft(raw);
  if (!draft) store.removeItem(key);
  return draft;
}

/** A draft handed over by an embed in the address bar moves into this tab's
 *  session store and out of the URL (and history). Run before the form is
 *  even fetched, so a sign-in round trip that starts from the invalid card
 *  still finds it. */
function consumeHashDraft(formId: string): FormAnswers | null {
  let fromHash: FormAnswers | null = null;
  try {
    if (!window.location.hash.startsWith("#draft=")) return null;
    fromHash = readDraftHash(window.location.hash);
    window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    if (fromHash) window.sessionStorage.setItem(formDraftKey(formId), writeFormDraft(fromHash));
  } catch { /* a blocked store: the answers still reach the fields below */ }
  return fromHash;
}

function readDraft(formId: string): FormAnswers | null {
  const key = formDraftKey(formId);
  let draft: FormAnswers | null = null;
  try { draft = readStored(window.sessionStorage, key); } catch { /* private mode */ }
  try {
    const legacy = readStored(window.localStorage, key);
    window.localStorage.removeItem(key);
    draft = draft ?? legacy;
  } catch { /* ignore */ }
  return draft;
}

function saveDraft(formId: string, answers: FormAnswers) {
  try { window.sessionStorage.setItem(formDraftKey(formId), writeFormDraft(answers)); } catch { /* private mode: the fields still hold the answers */ }
}

function clearDraft(formId: string) {
  const key = formDraftKey(formId);
  try { window.sessionStorage.removeItem(key); } catch { /* ignore */ }
  try { window.localStorage.removeItem(key); } catch { /* ignore */ }
}

export function respondPath(formId: string): string {
  return `/forms/${encodeURIComponent(formId)}/respond`;
}

export function signInHref(formId: string): string {
  return `/login?callbackUrl=${encodeURIComponent(respondPath(formId))}`;
}

async function postWithRetry(url: string, body: string): Promise<Response | null> {
  try {
    return await fetchWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      credentials: "same-origin",
    }, { attempts: 4 });
  } catch {
    return null;
  }
}

export function usePublicForm(formId: string | undefined, opts: { embed: boolean }) {
  const [state, setState] = useState<LoadState>("loading");
  const [form, setForm] = useState<PublicFormPayload | null>(null);
  const [answers, setAnswersState] = useState<FormAnswers>({});
  // For the invalid card: a signed-in person is not offered "Sign in" again.
  const [invalidSignedIn, setInvalidSignedIn] = useState(false);
  // One key per Submit of one set of answers; a new edit starts a new one.
  const submissionKey = useRef<string | null>(null);

  // The first load starts in "loading" already; only a Retry resets it, so
  // no state is set synchronously inside the mount effect.
  const load = useCallback(async () => {
    if (!formId) return;
    const handedOver = consumeHashDraft(formId);
    try {
      const res = await fetch(`/api/public/forms/${encodeURIComponent(formId)}${opts.embed ? "?embed=1" : ""}`, { cache: "no-store" });
      if (res.status === 404) {
        const d = await res.json().catch(() => null) as { signedIn?: unknown } | null;
        setInvalidSignedIn(d?.signedIn === true);
        setState("invalid");
        return;
      }
      if (!res.ok) { console.warn(`form load failed: HTTP ${res.status}`); setState("error"); return; }
      const d = await res.json();
      const payload: PublicFormPayload = {
        id: d.id,
        name: typeof d.name === "string" ? d.name : "",
        description: typeof d.description === "string" ? d.description : null,
        fields: readFormFields(d.fields),
        settings: {
          closed: d.settings?.closed === true,
          confirmationMessage: String(d.settings?.confirmationMessage ?? "Thanks, your response has been recorded."),
          closedMessage: String(d.settings?.closedMessage ?? "This form is no longer accepting responses."),
          allowAnother: d.settings?.allowAnother !== false,
          redirectUrl: typeof d.settings?.redirectUrl === "string" ? d.settings.redirectUrl : null,
        },
        viewer: {
          signedIn: d.viewer?.signedIn === true,
          canSubmit: d.viewer?.canSubmit === true,
          anonymousSubmit: d.viewer?.anonymousSubmit === true,
        },
      };
      setForm(payload);
      const draft = handedOver ?? readDraft(formId);
      if (draft) setAnswersState(draft);
      setState("ready");
    } catch (e) {
      console.warn("form load failed", e);
      setState("error");
    }
  }, [formId, opts.embed]);

  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);

  const setAnswers = useCallback((next: FormAnswers) => {
    setAnswersState(next);
    submissionKey.current = null;
    if (formId) saveDraft(formId, next);
  }, [formId]);

  // Every change is already mirrored to the draft store; saving once more on
  // the way out covers a browser that dropped a write.
  const goSignIn = useCallback(() => {
    if (formId) saveDraft(formId, answers);
  }, [formId, answers]);

  const submit = useCallback(async (a: FormAnswers): Promise<SubmitOutcome> => {
    if (!formId || !form) return { ok: false, message: "We could not send your answers." };
    saveDraft(formId, a);

    // Signed out: sending needs a session, unless this form takes responses
    // without an account. The responder goes to sign in and comes back; the
    // embed opens the responder in a new tab.
    if (!form.viewer.signedIn && !form.viewer.anonymousSubmit) {
      if (opts.embed) {
        return {
          ok: false,
          message: "Sign in to send your answers.",
          action: { label: "Open this form in a new tab", href: respondPath(formId) + draftHash(a), newTab: true },
        };
      }
      window.location.assign(signInHref(formId));
      return { ok: false, message: "Sign in to send your answers. They are kept for you.", action: { label: "Sign in", href: signInHref(formId), onClick: goSignIn } };
    }

    submissionKey.current ??= newSubmissionKey();
    const res = await postWithRetry(
      `/api/forms/${encodeURIComponent(formId)}/responses`,
      JSON.stringify({ data: a, submissionKey: submissionKey.current }),
    );
    // `retry` makes the renderer press Submit again itself (same answers, same
    // key), so the link resends exactly what is on screen.
    const retry = { label: "Retry", retry: true } as const;
    if (!res) {
      return { ok: false, message: "We could not send your answers. They are still here.", action: retry };
    }
    if (res.status === 201 || res.ok) {
      clearDraft(formId);
      submissionKey.current = null;
      return { ok: true };
    }
    let body: { error?: string; message?: string; fieldIds?: string[] } = {};
    try { body = await res.json(); } catch { /* keep the generic line */ }
    if (res.status === 401 && !form.viewer.signedIn) {
      // Was open to people without an account when it loaded, and is not now.
      return opts.embed
        ? { ok: false, message: "This form now asks you to sign in to send it.", action: { label: "Open this form in a new tab", href: respondPath(formId) + draftHash(a), newTab: true } }
        : { ok: false, message: "This form now asks you to sign in to send it. Your answers are kept.", action: { label: "Sign in", href: signInHref(formId), onClick: goSignIn } };
    }
    if (res.status === 401) {
      return opts.embed
        ? { ok: false, message: "You have been signed out. Open this form in a new tab to send it.", action: { label: "Open in a new tab", href: respondPath(formId) + draftHash(a), newTab: true } }
        : { ok: false, message: "You have been signed out. Sign in to send this.", action: { label: "Sign in", href: signInHref(formId), onClick: goSignIn } };
    }
    if (res.status === 400 && Array.isArray(body.fieldIds)) {
      return { ok: false, message: "Some questions still need an answer.", fieldIds: body.fieldIds };
    }
    if (res.status === 409 && body.message) return { ok: false, message: body.message };
    if (res.status === 403) {
      return { ok: false, message: "This account cannot send answers to this form. Ask the person who sent you the link to share it with you." };
    }
    if (res.status === 404) return { ok: false, message: "This link is invalid or has been turned off." };
    if (res.status === 429) return { ok: false, message: "Too many answers from this connection. Wait a few minutes, then retry. Your answers are still here.", action: retry };
    return { ok: false, message: "We could not send your answers. They are still here.", action: retry };
  }, [formId, form, opts.embed, goSignIn]);

  const reload = useCallback(async () => {
    setState("loading");
    await load();
  }, [load]);

  return { state, form, answers, setAnswers, submit, reload, invalidSignedIn };
}
