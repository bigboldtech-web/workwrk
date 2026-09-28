"use client";

// A candor session (spec-teams-performance /candor/[id]): answer it, write
// it, or read what came back. Three faces from what the server says the
// viewer may do (GET /api/candor/[id] faces), each on the detail chrome with
// a real back to Candor:
//
//   Editor    the owner (or the People team, Admin) while it is a Draft:
//             About (title, description, who can answer), Questions (a
//             ReorderableList: drag, keyboard, and Move up / Move down in
//             each row's "..."), Danger zone. Autosaves per field.
//   Respond   in scope, Open, not answered: the questions, then the blue
//             "Submit anonymously" in the title row. You answer once; your
//             typing is kept on this device until it is sent.
//   Results   the owner, the People team, Admin: answer counts, rating
//             bars, shuffled unattributed quotes. Under four answers the
//             whole body is one quiet block (DECIDED: the anonymity floor).
// Someone who may both answer and read results (People team in scope) gets a
// Respond · Results pill row and lands on Respond until they have answered.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Ban, Link2, MoreHorizontal, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { Breadcrumb } from "@/components/layout/os/top-bar/breadcrumb";
import { OsPageHeader, OsPageHeaderSkeleton } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { MorePortal } from "@/components/layout/os/more-portal";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { MenuItem, MenuList } from "@/components/ui/menu";
import { ViewTab } from "@/components/ui/view-tabs";
import { SkeletonLines } from "@/components/ui/skeleton";
import { AutosaveIndicator } from "@/components/ui/autosave-indicator";
import { useConfirm } from "@/components/ui/dialog-provider";
import { PickerButton } from "@/components/dashboards/widget-registry";
import { ToneChip } from "@/components/people/person-bits";
import { AnonymityNote } from "@/components/culture/anonymity-note";
import { ReorderableList } from "@/components/performance/reorderable-list";
import { QuestionRenderer, hasAnswer } from "@/components/performance/question-renderer";
import { useAutosave } from "@/hooks/use-autosave";
import { apiFetch, apiFetchWithRetry } from "@/lib/api-fetch";
import { formatDate } from "@/lib/format/date";
import { useDatePrefs } from "@/lib/format/use-date-prefs";
import { CANDOR_PROMPT_TYPES, candorAudienceOf, candorHasAnyScope, candorScopeAllowed, candorScopeRefusal, candorStatusOf, type CandorPrompt, type CandorPromptType, type CandorScopes } from "@/lib/performance/candor";
import { ANONYMITY_FLOOR } from "@/lib/people/anonymity";
import { draftKey as scopedDraftKey, dropLegacyDraft } from "@/lib/people/draft-keys";
import { useBoot } from "@/components/layout/os/boot-context";

type Faces = { isOwner: boolean; canManage: boolean; canSeeResults: boolean; inScope: boolean; canRespond: boolean; hasResponded: boolean; canDelete: boolean; canExport: boolean };
type Session = {
  id: string;
  title: string;
  description: string | null;
  status: "DRAFT" | "ACTIVE" | "CLOSED";
  departmentId: string | null;
  department: { id: string; name: string } | null;
  prompts: CandorPrompt[];
  launchedAt: string | null;
  closedAt: string | null;
  responseCount?: number | null;
  /** Who this viewer may ask, sent with a Draft they may edit or a Closed one they run (null departmentIds: any department). */
  scopes?: Scopes;
  faces: Faces;
};
type Scopes = CandorScopes;

// The scope rule and the audience words of lib/performance/candor.ts, the
// same ones the server and the list page read, so the picker and the Launch
// confirm never offer what the server refuses. The server stays the
// authority: a refused launch still toasts its message.
function scopeOk(sc: Scopes | undefined, departmentId: string | null): boolean {
  return !sc || candorScopeAllowed(sc, departmentId);
}
const scopeNote = (sc: Scopes, departmentId: string | null): string => candorScopeRefusal(sc, departmentId) ?? "";
const audienceOf = candorAudienceOf;
type Results = {
  totalResponses: number;
  belowFloor: boolean;
  floor: number;
  results: Array<
    | { prompt: CandorPrompt; type: "rating"; average: string | null; distribution: Array<{ value: number; count: number }>; count: number; hidden?: boolean }
    | { prompt: CandorPrompt; type: "text"; responses: unknown[]; count: number; hidden?: boolean }
  >;
};

// Unsent answers are kept per person (lib/people/draft-keys.ts): the next
// person on a shared browser never sees them. The old object-only key is
// removed on sight.
const candorDraftKey = (userId: string, id: string) => scopedDraftKey("workwrk:candor-answers:", userId, id);

export default function CandorSessionClient({ id }: { id: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { toast } = useOsToast();
  const { blockingLayerOpen } = useOsShell();
  const confirm = useConfirm();
  const datePrefs = useDatePrefs();
  const boot = useBoot().boot;
  const viewerId = (boot?.viewer as { id?: string } | undefined)?.id ?? "anon";
  const orgName = boot?.org?.name?.trim() || null;
  // What the editor holds right now, typed or not yet autosaved: Launch sends
  // it and names its audience, so a scope picked a moment ago is the one
  // that opens (never the last saved one) and no question typed just before
  // Launch is left out.
  const draftRef = useRef<EditorDraft | null>(null);
  const draftKey = useCallback((sid: string) => candorDraftKey(viewerId, sid), [viewerId]);
  useEffect(() => { dropLegacyDraft("workwrk:candor-answers:", id); }, [id]);

  const [s, setS] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await apiFetch<Session>(`/api/candor/${id}`, { cache: "no-store" });
    if (!r.ok) { setError(r.status === 404 ? "This session is not available to you." : r.error || "Couldn't load the session"); return; }
    setError(null);
    setS(r.data);
  }, [id]);
  useEffect(() => { const t = setTimeout(() => { void load(); }, 0); return () => clearTimeout(t); }, [load]);

  const faces = s?.faces;
  const editing = !!s && !!faces?.canManage && s.status === "DRAFT";
  const both = !!faces?.canSeeResults && (!!faces?.canRespond || !!faces?.hasResponded) && s?.status !== "DRAFT";
  const tabParam = sp?.get("tab");
  const face: "editor" | "respond" | "results" | "thanks" | null = !s || !faces ? null
    : editing ? "editor"
      : both ? (tabParam === "results" || (faces.hasResponded && tabParam !== "respond") ? "results" : faces.canRespond ? "respond" : "thanks")
        : faces.canRespond ? "respond"
          : faces.canSeeResults ? "results"
            : "thanks";

  const setTab = (t: "respond" | "results") => {
    const next = new URLSearchParams(sp?.toString() ?? "");
    next.set("tab", t);
    router.replace(`${pathname}?${next}`, { scroll: false });
  };

  // ── Respond ───────────────────────────────────────────────────────
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [answersFor, setAnswersFor] = useState<string | null>(null);
  if (s && answersFor !== s.id) {
    setAnswersFor(s.id);
    try { const raw = typeof window !== "undefined" ? window.localStorage.getItem(draftKey(s.id)) : null; if (raw) setAnswers(JSON.parse(raw) as Record<string, unknown>); } catch { /* private mode */ }
  }
  const setAnswer = (pid: string, v: unknown) => setAnswers((a) => {
    const next = { ...a, [pid]: v };
    try { window.localStorage.setItem(draftKey(id), JSON.stringify(next)); } catch { /* private mode: kept in memory */ }
    return next;
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [thanks, setThanks] = useState(false);
  const answeredCount = (s?.prompts ?? []).filter((p) => hasAnswer(p.type, answers[p.id])).length;
  const submit = useCallback(async () => {
    if (!s) return;
    if (!answeredCount) { setSubmitErr("Answer at least one question."); return; }
    const ok = await confirm({ title: "Submit anonymously?", description: "You can answer once. After you submit, your answers cannot be changed.", confirmLabel: "Submit", destructive: false });
    if (!ok) return;
    setSubmitting(true);
    setSubmitErr(null);
    const payload = s.prompts.filter((p) => hasAnswer(p.type, answers[p.id])).map((p) => ({ promptId: p.id, value: answers[p.id] }));
    const r = await apiFetchWithRetry(`/api/candor/${s.id}/respond`, { method: "POST", keepalive: true, json: { answers: payload } }, { retryWrites: true });
    setSubmitting(false);
    if (!r.ok && r.status !== 409) { setSubmitErr(r.error ? `Not sent: ${r.error}` : "Not sent. Your answers are kept on this device, try again."); return; }
    try { window.localStorage.removeItem(draftKey(s.id)); } catch { /* ignore */ }
    setThanks(true);
    void load();
  }, [s, answeredCount, answers, confirm, load, draftKey]);
  useEffect(() => {
    if (face !== "respond") return;
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void submit(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [face, submit]);

  // ── Owner actions ─────────────────────────────────────────────────
  const move = async (status: "ACTIVE" | "CLOSED", reopen = false) => {
    if (!s) return;
    const draft = status === "ACTIVE" && !reopen && s.status === "DRAFT" ? draftRef.current : null;
    const prompts = draft ? draft.state.prompts.filter((p) => p.text.trim()) : null;
    if (draft) {
      if (!scopeOk(s.scopes, draft.state.departmentId)) { toast(scopeNote(s.scopes!, draft.state.departmentId), { tone: "danger" }); return; }
      if (!prompts?.length) { toast("Add at least one question before you launch", { tone: "danger" }); return; }
    }
    const title = draft ? draft.state.title.trim() || "Untitled session" : s.title;
    const audience = audienceOf(draft ? draft.departmentName : s.department?.name, orgName);
    const ok = await confirm(
      status === "CLOSED"
        ? { title: `Close ${s.title}?`, description: "Nobody can answer after this. You can reopen it later.", confirmLabel: "Close session", destructive: false }
        : reopen
          ? { title: `Reopen ${s.title}?`, description: `${audience} who has not answered can answer again.`, confirmLabel: "Reopen", destructive: false }
          : { title: `Launch ${title}?`, description: `${audience} can answer from now on, and is told so. The questions are fixed from then.`, confirmLabel: "Launch session", destructive: false },
    );
    if (!ok) return;
    const r = await apiFetch(`/api/candor/${s.id}`, {
      method: "PATCH",
      json: draft ? { status, title, description: draft.state.description, departmentId: draft.state.departmentId, prompts } : { status },
    });
    if (!r.ok) { toast(r.error || "Couldn't change the session", { tone: "danger" }); return; }
    toast(status === "CLOSED" ? "Session closed" : reopen ? "Session reopened" : "Session launched");
    void load();
  };
  const remove = async () => {
    if (!s) return;
    const ok = await confirm({ title: `Delete ${s.title}?`, description: "Nothing has been answered yet.", confirmLabel: "Delete draft", destructive: true });
    if (!ok) return;
    const r = await apiFetch(`/api/candor/${s.id}`, { method: "DELETE" });
    if (!r.ok) { toast(r.error || "Couldn't delete it", { tone: "danger" }); return; }
    toast("Draft deleted");
    router.push("/candor");
  };

  const back = { fallbackHref: "/candor", label: "Candor" };
  if (error && !s) {
    return (
      <>
        <OsPageHeader title="Candor session" back={back} />
        <div className="mx-auto w-full max-w-[720px] px-6 py-6"><OsEmptyView variant="error" title="Couldn't load the session" hint={error} action={{ label: "Try again", onClick: () => void load() }} /></div>
      </>
    );
  }
  if (!s || !faces) {
    return (
      <>
        <OsPageHeaderSkeleton />
        <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-6 py-6">{[0, 1].map((i) => <div key={i} className="rounded-lg border border-line p-6"><SkeletonLines lines={4} /></div>)}</div>
      </>
    );
  }

  const st = candorStatusOf(s.status);
  // A draft's owner with no scope at all (a manager by reporting line whose
  // chain covers no department) can never launch it: no blue Launch, the
  // Who can answer note already says who can run it. Editing and Delete
  // draft stay.
  const canEverLaunch = !s.scopes || candorHasAnyScope(s.scopes);
  const primary = face === "editor"
    ? (canEverLaunch ? { label: "Launch session", onClick: () => void move("ACTIVE") } : null)
    : face === "respond" && !thanks ? { label: submitting ? "Sending" : "Submit anonymously", onClick: () => void submit(), busy: submitting } : null;
  const more = faces.canManage ? [
    { label: "Copy link", icon: Link2, onClick: () => { void navigator.clipboard.writeText(`${window.location.origin}/candor/${s.id}`).then(() => toast("Link copied"), () => toast("Couldn't copy the link", { tone: "danger" })); } },
    ...(s.status === "ACTIVE" ? [{ label: "Close session", icon: Ban, onClick: () => void move("CLOSED") }] : []),
    ...(s.status === "CLOSED" ? [scopeOk(s.scopes, s.departmentId)
      ? { label: "Reopen", icon: RotateCcw, onClick: () => void move("ACTIVE", true) }
      : { label: "Reopen", icon: RotateCcw, disabled: true, title: "It asks people outside your reporting line now: ask the People team or an Admin to reopen it", onClick: () => {} }] : []),
    ...(faces.canDelete ? [{ separator: true as const }, { label: "Delete draft", icon: Trash2, destructive: true, onClick: () => void remove() }] : []),
  ] : undefined;

  return (
    <>
      <Breadcrumb items={[{ label: "Candor", href: "/candor" }, { label: s.title }]} />
      <OsPageHeader
        title={s.title}
        back={back}
        titleSlot={<><h1 className="min-w-0 truncate text-title font-semibold text-ink">{s.title}</h1><ToneChip tone={st.tone} label={st.label} /></>}
        actions={primary && !blockingLayerOpen ? (
          <button type="button" onClick={primary.onClick} disabled={primary.busy} className="inline-flex h-9 items-center rounded-md bg-brand px-3 text-base font-medium text-white hover:bg-brand-hover disabled:opacity-60">{primary.label}</button>
        ) : undefined}
        more={more}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-6 pb-10 pt-2">
          {both && !thanks ? (
            <div className="flex flex-col gap-1">
              <div role="tablist" aria-label="Sections" className="flex h-9 items-center gap-1">
                <ViewTab label="Respond" active={face === "respond" || face === "thanks"} onClick={() => setTab("respond")} />
                <ViewTab label="Results" active={face === "results"} onClick={() => setTab("results")} />
              </div>
              {faces.hasResponded ? <p className="m-0 text-sm text-ink-2">You have answered. Answers cannot be changed once sent.</p> : null}
            </div>
          ) : null}

          {face === "editor" ? (
            <CandorEditor session={s} draftRef={draftRef} onDelete={faces.canDelete ? () => void remove() : undefined} onSaved={(next) => setS((cur) => (cur ? { ...cur, ...next } : cur))} />
          ) : face === "respond" && !thanks ? (
            <>
              <AnonymityNote mode="candor" />
              {s.description ? <p className="m-0 whitespace-pre-wrap text-row text-ink-2">{s.description}</p> : null}
              {s.prompts.map((p, i) => (
                <QuestionRenderer key={p.id} index={i} question={{ id: p.id, text: p.text, type: p.type }} value={answers[p.id]} onChange={(v) => setAnswer(p.id, v)} />
              ))}
              <p className="m-0 text-sm text-ink-2">You can answer once. After you submit, your answers cannot be changed.</p>
              {submitErr ? <p role="alert" className="m-0 text-sm text-danger-text">{submitErr}</p> : null}
            </>
          ) : face === "results" ? (
            <CandorResults session={s} />
          ) : (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <OsEmptyView title={thanks || faces.hasResponded ? "Thanks. Your answers are in." : "This session is not open for answers"} />
              <Link href="/candor" className="text-sm font-medium text-brand-deep hover:underline">Back to Candor</Link>
              {s.launchedAt ? <p className="m-0 text-xs text-ink-3">Opened {formatDate(s.launchedAt, datePrefs, "date")}{s.closedAt ? ` · Closed ${formatDate(s.closedAt, datePrefs, "date")}` : ""}</p> : null}
            </div>
          )}
          {s.launchedAt && face === "respond" && !thanks ? <p className="m-0 text-xs text-ink-3">Opened {formatDate(s.launchedAt, datePrefs, "date")}{s.closedAt ? ` · Closed ${formatDate(s.closedAt, datePrefs, "date")}` : ""}</p> : null}
        </div>
      </div>
    </>
  );
}

function CandorResults({ session }: { session: Session }) {
  const datePrefs = useDatePrefs();
  const [r, setR] = useState<Results | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const x = await apiFetch<Results>(`/api/candor/${session.id}/results`, { cache: "no-store" });
    if (!x.ok) { setError(x.error || "Couldn't load the results"); return; }
    setError(null);
    setR(x.data);
  }, [session.id]);
  useEffect(() => { const t = setTimeout(() => { void load(); }, 0); return () => clearTimeout(t); }, [load]);
  useEffect(() => { const again = () => void load(); window.addEventListener("focus", again); return () => window.removeEventListener("focus", again); }, [load]);
  if (error && !r) return <OsEmptyView variant="error" title="Couldn't load the results" hint={error} action={{ label: "Try again", onClick: () => void load() }} />;
  if (!r) return <SkeletonLines lines={6} />;
  const meta = [`${r.totalResponses} ${r.totalResponses === 1 ? "answer" : "answers"}`, session.launchedAt ? `Opened ${formatDate(session.launchedAt, datePrefs, "date")}` : null, session.closedAt ? `Closed ${formatDate(session.closedAt, datePrefs, "date")}` : null].filter(Boolean).join(" · ");
  if (r.belowFloor) {
    return (
      <div className="flex flex-col gap-3">
        <p className="m-0 text-sm text-ink-2">{meta}</p>
        <OsEmptyView title={`Results appear once ${r.floor ?? ANONYMITY_FLOOR} people have answered. ${r.totalResponses} so far.`} hint="So nobody in a small team can be picked out from their answers." />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-sm text-ink-2">{meta}</p>
      {r.results.map((res, i) => (
        <section key={res.prompt.id} className="flex flex-col gap-3 rounded-lg border border-line bg-raised p-6">
          <p className="m-0 text-row font-medium text-ink">{i + 1}. {res.prompt.text}</p>
          {res.hidden ? (
            <p className="m-0 text-sm text-ink-2">
              {res.count === 0 ? "No answers to this question" : `Shown once ${r.floor} people have answered this question (${res.count} so far), to protect who answered.`}
            </p>
          ) : res.type === "rating" ? (
            <div className="flex items-start gap-6">
              <span className="text-xl font-semibold tabular-nums text-ink">{res.average ?? ""}</span>
              <ul className="m-0 flex flex-1 list-none flex-col gap-1.5 p-0">
                {[...res.distribution].reverse().map((d) => (
                  <li key={d.value} className="grid grid-cols-[20px_1fr_40px] items-center gap-2 text-sm">
                    <span className="tabular-nums text-ink-2">{d.value}</span>
                    <span className="h-2 overflow-hidden rounded-full bg-subtle" aria-hidden><span className="block h-full rounded-full bg-[var(--os-ink-3)]" style={{ width: `${res.count ? (d.count / res.count) * 100 : 0}%` }} /></span>
                    <span className="text-end tabular-nums text-ink-2">{d.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <ul className="m-0 flex max-h-[420px] list-none flex-col gap-2 overflow-y-auto p-0">
              {res.responses.length ? res.responses.map((a, k) => (
                <li key={k} className="whitespace-pre-wrap rounded-md border-s-2 border-line-strong bg-subtle px-3 py-2 text-row text-ink">
                  {typeof a === "string" ? a : a && typeof a === "object"
                    ? Object.entries(a as Record<string, string>).filter(([, v]) => v).map(([k2, v]) => `${k2.charAt(0).toUpperCase() + k2.slice(1)}: ${v}`).join("\n")
                    : String(a)}
                </li>
              )) : <li className="text-sm text-ink-3">No answers to this question</li>}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

type EditorState = { title: string; description: string; departmentId: string | null; prompts: CandorPrompt[] };
type EditorDraft = { state: EditorState; departmentName: string | null };

function CandorEditor({ session, draftRef, onDelete, onSaved }: { session: Session; draftRef: { current: EditorDraft | null }; onDelete?: () => void; onSaved: (next: Partial<Session>) => void }) {
  const [state, setState] = useState<EditorState>({ title: session.title, description: session.description ?? "", departmentId: session.departmentId, prompts: session.prompts.length ? session.prompts : [] });
  const [depts, setDepts] = useState<Array<{ id: string; name: string }>>([]);
  const [menu, setMenu] = useState<{ id: string; anchor: { current: HTMLElement | null }; up?: () => void; down?: () => void } | null>(null);
  useEffect(() => {
    void apiFetch<Array<{ id: string; name: string }>>("/api/departments", { cache: "no-store" }).then((r) => { if (r.ok && Array.isArray(r.data)) setDepts(r.data); });
  }, []);
  const autosave = useAutosave({
    snapshot: state,
    enabled: true,
    delay: 900,
    localKey: `candor-editor:${session.id}`,
    save: async (snap) => {
      const r = await apiFetchWithRetry(`/api/candor/${session.id}`, {
        method: "PATCH",
        keepalive: true,
        json: { title: snap.title.trim() || "Untitled session", description: snap.description, departmentId: snap.departmentId, prompts: snap.prompts.filter((p) => p.text.trim()).length ? snap.prompts.filter((p) => p.text.trim()) : undefined },
      }, { retryWrites: true });
      if (!r.ok) throw new Error(r.error || `HTTP ${r.status}`);
      onSaved({ title: snap.title.trim() || "Untitled session" });
    },
  });
  const nextId = useMemo(() => () => {
    const used = new Set(state.prompts.map((p) => p.id));
    let n = state.prompts.length + 1;
    while (used.has(`p${n}`)) n += 1;
    return `p${n}`;
  }, [state.prompts]);
  const deptName = state.departmentId ? depts.find((d) => d.id === state.departmentId)?.name ?? session.department?.name ?? "A department" : null;
  useEffect(() => { draftRef.current = { state, departmentName: deptName }; }, [draftRef, state, deptName]);
  // Only the scopes this organiser may ask (Session.scopes). The current
  // one stays listed even when it is not, so the label is honest, with a
  // note to change it: an older Draft keeps its questions and only its
  // launch waits.
  const scopes = session.scopes;
  const scopeOptions = [
    ...(scopeOk(scopes, null) || state.departmentId === null ? [{ value: "all", label: "Everyone" }] : []),
    ...depts.filter((d) => scopeOk(scopes, d.id) || d.id === state.departmentId).map((d) => ({ value: d.id, label: d.name })),
  ];
  const scopeProblem = scopes && !scopeOk(scopes, state.departmentId) ? scopeNote(scopes, state.departmentId) : null;
  const setPrompt = (pid: string, patch: Partial<CandorPrompt>) => setState((s) => ({ ...s, prompts: s.prompts.map((p) => (p.id === pid ? { ...p, ...patch } : p)) }));
  const input = "h-9 w-full rounded-md border border-line bg-raised px-3 text-row text-ink outline-none focus-visible:border-[var(--os-focus)]";

  return (
    <div className="flex flex-col gap-4">
      <AnonymityNote mode="candor" />
      <section className="flex flex-col gap-4 rounded-lg border border-line bg-raised p-6">
        <header className="flex items-center gap-2">
          <h2 className="m-0 flex-1 text-lg font-semibold text-ink">About this session</h2>
          <AutosaveIndicator status={autosave.status} lastSavedAt={autosave.lastSavedAt} onRetry={autosave.retriesExhausted ? autosave.retryNow : undefined} />
        </header>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-ink">Title</span>
          <input value={state.title} maxLength={200} onChange={(e) => setState((s) => ({ ...s, title: e.target.value }))} className={input} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-ink">Description</span>
          <textarea value={state.description} rows={3} maxLength={5000} onChange={(e) => setState((s) => ({ ...s, description: e.target.value }))} className="min-h-[76px] w-full resize-y rounded-md border border-line bg-raised px-3 py-2 text-row text-ink outline-none focus-visible:border-[var(--os-focus)]" />
        </label>
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-ink">Who can answer</span>
          <PickerButton ariaLabel="Who can answer" label={deptName ?? "Everyone"}
            selected={state.departmentId ?? "all"} sections={[{ options: scopeOptions }]}
            onSelect={(v) => setState((s) => ({ ...s, departmentId: v === "all" ? null : v }))} />
          {scopeProblem ? <span role="alert" className="text-xs text-danger-text">{scopeProblem}</span> : null}
          <span className="text-xs text-ink-2">Only people in the scope you pick can see or answer this.</span>
        </div>
      </section>
      <section className="flex flex-col gap-3 rounded-lg border border-line bg-raised p-6">
        <h2 className="m-0 text-lg font-semibold text-ink">Questions</h2>
        {state.prompts.length ? (
          <ReorderableList
            items={state.prompts}
            itemKey={(p) => p.id}
            itemLabel={(p) => p.text}
            onReorder={(next) => setState((s) => ({ ...s, prompts: next }))}
            renderRow={(p, api) => (
              <div className="flex items-center gap-2">
                {api.grip}
                <input value={p.text} maxLength={1000} placeholder={`Question ${api.index + 1}`} aria-label={`Question ${api.index + 1}`} onChange={(e) => setPrompt(p.id, { text: e.target.value })} className={input} />
                <PickerButton ariaLabel={`Type of question ${api.index + 1}`} label={CANDOR_PROMPT_TYPES.find((t) => t.value === p.type)?.label ?? "Open text"} selected={p.type}
                  sections={[{ options: CANDOR_PROMPT_TYPES }]} onSelect={(v) => setPrompt(p.id, { type: v as CandorPromptType })} className="shrink-0" />
                <button type="button" aria-label={`More for question ${api.index + 1}`} onClick={(e) => setMenu({ id: p.id, anchor: { current: e.currentTarget }, up: api.moveUp, down: api.moveDown })} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"><MoreHorizontal className="h-4 w-4" /></button>
                <button type="button" aria-label={`Remove question ${api.index + 1}`} onClick={() => setState((s) => ({ ...s, prompts: s.prompts.filter((x) => x.id !== p.id) }))} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"><X className="h-4 w-4" /></button>
              </div>
            )}
          />
        ) : null}
        <button type="button" onClick={() => setState((s) => ({ ...s, prompts: [...s.prompts, { id: nextId(), text: "", type: "text" }] }))} className="inline-flex h-9 items-center gap-2 self-start rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink">
          <Plus className="h-4 w-4" />{state.prompts.length ? "Add question" : "Add your first question"}
        </button>
      </section>
      {onDelete ? (
        <section className="flex items-center gap-3 rounded-lg border border-[var(--os-danger-border,var(--os-line))] bg-raised p-6">
          <div className="min-w-0 flex-1">
            <h2 className="m-0 text-lg font-semibold text-danger-text">Danger zone</h2>
            <p className="m-0 text-sm text-ink-2">Delete this draft. Nothing has been answered yet.</p>
          </div>
          <button type="button" onClick={onDelete} className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium text-danger-text hover:bg-hover"><Trash2 className="h-4 w-4" />Delete this draft</button>
        </section>
      ) : null}
      {menu ? (
        <MorePortal anchorRef={menu.anchor} width={180} open placement="below" onClose={() => setMenu(null)}>
          <MenuList aria-label="Question actions">
            {menu.up ? <MenuItem label="Move up" onClick={() => { menu.up?.(); setMenu(null); }} /> : null}
            {menu.down ? <MenuItem label="Move down" onClick={() => { menu.down?.(); setMenu(null); }} /> : null}
            <MenuItem icon={Trash2} label="Remove" destructive onClick={() => { const pid = menu.id; setMenu(null); setState((s) => ({ ...s, prompts: s.prompts.filter((x) => x.id !== pid) })); }} />
          </MenuList>
        </MorePortal>
      ) : null}
    </div>
  );
}


