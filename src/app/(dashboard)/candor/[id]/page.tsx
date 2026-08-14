"use client";

/* Candor session detail — the closed loop for anonymous feedback.
 *
 *  One route, three faces depending on who you are and the session state:
 *    · Owner + DRAFT            → PROMPT EDITOR (title/description/scope/prompts) + Launch
 *    · Owner + ACTIVE/CLOSED    → RESULTS (aggregated, ZERO respondent identity) + Close
 *    · Respondent + ACTIVE      → RESPOND FORM (anonymous — stores only answers)
 *
 *  Data:
 *    GET  /api/candor                 (list — org-scoped + dept/active gated; source of truth for access)
 *    GET  /api/candor/[id]/results    (managers only, org-scoped, no identity)
 *    POST /api/candor/[id]/respond    (anonymous — no userId/IP/device is ever stored)
 *    PATCH/POST /api/candor           (owner edits + launch/close)
 *    GET  /api/departments            (scope picker)
 *
 *  Anonymity is the top guarantee: the respond flow never sends identity and
 *  the CandorResponse row has no user column, so a reply can't be traced back.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  MessageCircleHeart, ArrowLeft, Lock, ShieldCheck, Send, Plus, Trash2,
  ChevronUp, ChevronDown, Activity, CheckCircle2, Building,
  Globe, Loader2, Type, Star, Repeat, Edit3, BarChart3, Rocket,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { GRAD } from "@/components/layout/os/catalog";
import { useOsToast } from "@/components/layout/os/toast";
import { useOsShell } from "@/components/layout/os/shell-context";

type CandorStatus = "DRAFT" | "ACTIVE" | "CLOSED";
type PromptType = "text" | "rating" | "start_stop_continue";
type Prompt = { id: string; text: string; type: PromptType };

type ApiCandor = {
  id: string;
  title: string;
  description?: string | null;
  prompts: unknown;
  status: CandorStatus;
  departmentId?: string | null;
  launchedAt?: string | null;
  closedAt?: string | null;
  createdAt: string;
  createdBy: string;
  responseCount?: number;
  isOwner?: boolean;
};

type Dept = { id: string; name: string };

type RatingResult = { prompt: Prompt; type: "rating"; average: string | null; distribution: { value: number; count: number }[]; count: number };
type TextResult = { prompt: Prompt; type: "text"; responses: unknown[]; count: number };
type ResultItem = RatingResult | TextResult;
type ResultsPayload = {
  session: { id: string; title: string; description?: string | null; status: CandorStatus; launchedAt?: string | null; closedAt?: string | null };
  totalResponses: number;
  results: ResultItem[];
};

const PROMPT_TYPES: { value: PromptType; label: string; Icon: typeof Type }[] = [
  { value: "text", label: "Open text", Icon: Type },
  { value: "rating", label: "Rating 1-5", Icon: Star },
  { value: "start_stop_continue", label: "Start / Stop / Continue", Icon: Repeat },
];

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function normalizePrompts(raw: unknown): Prompt[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((p) => {
    if (typeof p === "string") return { id: uid(), text: p, type: "text" as PromptType };
    const o = (p ?? {}) as Record<string, unknown>;
    const t = (o.type as PromptType) || "text";
    return {
      id: typeof o.id === "string" && o.id ? o.id : uid(),
      text: typeof o.text === "string" ? o.text : "",
      type: (["text", "rating", "start_stop_continue"] as const).includes(t) ? t : "text",
    };
  });
}

function fmtDate(iso?: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const STATUS_META: Record<CandorStatus, { label: string; hue: string; Icon: typeof Edit3 }> = {
  DRAFT: { label: "Draft", hue: "var(--os-c-darkgray)", Icon: Edit3 },
  ACTIVE: { label: "Active", hue: "var(--os-c-orange)", Icon: Activity },
  CLOSED: { label: "Closed", hue: "var(--os-c-green)", Icon: CheckCircle2 },
};

export default function CandorDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [session, setSession] = useState<ApiCandor | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { toast } = useOsToast();
  const { bumpRowVersion } = useOsShell();

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetch("/api/candor");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list: ApiCandor[] = data.data ?? (Array.isArray(data) ? data : []);
      setSession(list.find((s) => s.id === id) ?? null);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const afterMutate = useCallback(() => {
    bumpRowVersion("candor");
    void load();
  }, [bumpRowVersion, load]);

  const header = (
    <OsTitleBar
      title={session ? session.title : "Candor session"}
      Icon={MessageCircleHeart}
      iconGradient={GRAD.pinkPurple}
      showStandardActions={false}
      description={session ? STATUS_META[session.status].label : undefined}
      actions={
        <Link href="/candor" className="cnd-d__back"><ArrowLeft /> All sessions</Link>
      }
    />
  );

  let body: React.ReactNode;
  if (loadError) {
    body = <NotAvailable title="Couldn't load this session" subtitle={loadError} />;
  } else if (session === undefined) {
    body = <div className="cnd-d__loading"><Loader2 className="cnd-d__spin" /> Loading…</div>;
  } else if (session === null) {
    body = (
      <NotAvailable
        title="This session isn't available to you"
        subtitle="It may be closed, scoped to another team, or you may not have access. Only active sessions for your team or the whole org appear here."
      />
    );
  } else if (session.isOwner) {
    body = session.status === "DRAFT"
      ? <EditorView session={session} onMutate={afterMutate} toast={toast} />
      : <ResultsView session={session} onMutate={afterMutate} toast={toast} />;
  } else if (session.status === "ACTIVE") {
    body = <RespondView session={session} onMutate={afterMutate} toast={toast} />;
  } else {
    body = <NotAvailable title="This session isn't open" subtitle="It's no longer collecting responses." />;
  }

  return (
    <>
      {header}
      <div className="cnd-d">{body}</div>
    </>
  );
}

function NotAvailable({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="cnd-d__blank">
      <div className="cnd-d__blank-art"><MessageCircleHeart /></div>
      <h2>{title}</h2>
      <p>{subtitle}</p>
      <Link href="/candor" className="cnd-d__blank-cta"><ArrowLeft /> Back to Candor</Link>
    </div>
  );
}

/* ─────────────────────────── RESPOND (anonymous) ─────────────────────────── */

type SscValue = { start: string; stop: string; cont: string };

function RespondView({ session, onMutate, toast }: { session: ApiCandor; onMutate: () => void; toast: (m: string) => void }) {
  const prompts = useMemo(() => normalizePrompts(session.prompts), [session.prompts]);
  const storageKey = `candor:responded:${session.id}`;
  const [text, setText] = useState<Record<string, string>>({});
  const [rating, setRating] = useState<Record<string, number>>({});
  const [ssc, setSsc] = useState<Record<string, SscValue>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  // Soft "already responded" guard. Anonymity means the server literally
  // cannot dedupe by person, so we remember locally. Lazy + SSR-safe: this
  // subtree only ever mounts on the client (parent shows Loading during SSR),
  // so there's no hydration mismatch and no setState-in-effect.
  const [already] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try { return !!localStorage.getItem(storageKey); } catch { return false; }
  });

  function buildAnswers(): { promptId: string; value: string | number }[] {
    const out: { promptId: string; value: string | number }[] = [];
    for (const p of prompts) {
      if (p.type === "rating") {
        const r = rating[p.id];
        if (r) out.push({ promptId: p.id, value: r });
      } else if (p.type === "start_stop_continue") {
        const v = ssc[p.id];
        if (v) {
          const parts: string[] = [];
          if (v.start.trim()) parts.push(`Start: ${v.start.trim()}`);
          if (v.stop.trim()) parts.push(`Stop: ${v.stop.trim()}`);
          if (v.cont.trim()) parts.push(`Continue: ${v.cont.trim()}`);
          if (parts.length) out.push({ promptId: p.id, value: parts.join("\n") });
        }
      } else {
        const t = (text[p.id] || "").trim();
        if (t) out.push({ promptId: p.id, value: t });
      }
    }
    return out;
  }

  async function submit() {
    const answers = buildAnswers();
    if (answers.length === 0) { toast("Add at least one answer"); return; }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/candor/${session.id}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      if (!res.ok) {
        toast(res.status === 403 ? "This session isn't open to you" : "Couldn't submit — try again");
        setSubmitting(false);
        return;
      }
      try { localStorage.setItem(storageKey, "1"); } catch { /* ignore */ }
      setDone(true);
      onMutate();
    } catch {
      toast("Couldn't submit — try again");
      setSubmitting(false);
    }
  }

  if (done || already) {
    return (
      <div className="cnd-d__thanks">
        <div className="cnd-d__thanks-art"><ShieldCheck /></div>
        <h2>{done ? "Feedback received — thank you" : "You've already responded"}</h2>
        <p>Your reply was recorded with <strong>no link to your identity</strong>. There is no name, account, IP, or device stored against it, so it can never be traced back to you.</p>
        <Link href="/candor" className="cnd-d__blank-cta"><ArrowLeft /> Back to Candor</Link>
      </div>
    );
  }

  return (
    <div className="cnd-d__respond">
      <div className="cnd-d__anon">
        <Lock />
        <span><strong>This is anonymous.</strong> We send only your answers — never your name, account, IP, or device. Nobody, including your manager, can see who wrote what.</span>
      </div>

      {session.description ? <p className="cnd-d__lede">{session.description}</p> : null}

      <div className="cnd-d__qlist">
        {prompts.map((p, i) => (
          <div key={p.id} className="cnd-d__q">
            <div className="cnd-d__q-head"><span className="cnd-d__q-num">{i + 1}</span><span className="cnd-d__q-text">{p.text}</span></div>
            {p.type === "rating" ? (
              <div className="cnd-d__rating">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`cnd-d__rating-chip${rating[p.id] === n ? " is-on" : ""}`}
                    onClick={() => setRating((s) => ({ ...s, [p.id]: n }))}
                  >{n}</button>
                ))}
              </div>
            ) : p.type === "start_stop_continue" ? (
              <div className="cnd-d__ssc">
                {(["start", "stop", "cont"] as const).map((k) => (
                  <label key={k} className="cnd-d__ssc-field">
                    <span>{k === "cont" ? "Continue" : k[0].toUpperCase() + k.slice(1)}</span>
                    <textarea
                      rows={2}
                      value={ssc[p.id]?.[k] || ""}
                      onChange={(e) => setSsc((s) => {
                        const prev = s[p.id] ?? { start: "", stop: "", cont: "" };
                        return { ...s, [p.id]: { ...prev, [k]: e.target.value } };
                      })}
                      placeholder={k === "start" ? "What should we start doing?" : k === "stop" ? "What should we stop?" : "What's working — keep going?"}
                    />
                  </label>
                ))}
              </div>
            ) : (
              <textarea
                className="cnd-d__q-input"
                rows={3}
                value={text[p.id] || ""}
                onChange={(e) => setText((s) => ({ ...s, [p.id]: e.target.value }))}
                placeholder="Type your honest answer…"
              />
            )}
          </div>
        ))}
        {prompts.length === 0 ? <p className="cnd-d__muted">This session has no prompts yet.</p> : null}
      </div>

      <div className="cnd-d__actions">
        <button type="button" className="cnd-d__btn cnd-d__btn--primary" disabled={submitting || prompts.length === 0} onClick={submit}>
          {submitting ? <Loader2 className="cnd-d__spin" /> : <Send />} Submit anonymously
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────── RESULTS (manager) ─────────────────────────── */

function ResultsView({ session, onMutate, toast }: { session: ApiCandor; onMutate: () => void; toast: (m: string) => void }) {
  const [data, setData] = useState<ResultsPayload | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/candor/${session.id}/results`);
      if (res.status === 403) { setError("Only managers can view results."); setData(null); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
      setData(null);
    }
  }, [session.id]);
  useEffect(() => { void load(); }, [load]);

  async function close() {
    setBusy(true);
    try {
      const res = await fetch("/api/candor", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: session.id, status: "CLOSED" }),
      });
      if (!res.ok) { toast("Couldn't close"); setBusy(false); return; }
      toast("Session closed");
      onMutate();
    } catch { toast("Couldn't close"); setBusy(false); }
  }

  const total = data?.totalResponses ?? 0;

  return (
    <div className="cnd-d__results">
      <div className="cnd-d__anon">
        <ShieldCheck />
        <span><strong>Anonymous results.</strong> Replies are aggregated with no identity attached — there is no way to see who said what, by design.</span>
      </div>

      <div className="cnd-d__result-bar">
        <div className="cnd-d__result-stat">
          <span className="cnd-d__result-num">{total}</span>
          <span className="cnd-d__result-lbl">response{total === 1 ? "" : "s"}</span>
        </div>
        <div className="cnd-d__result-meta">
          <StatusChip status={session.status} />
          {session.departmentId ? <span className="cnd-d__scope"><Building /> Department</span> : <span className="cnd-d__scope"><Globe /> Org-wide</span>}
          {session.launchedAt ? <span>Launched {fmtDate(session.launchedAt)}</span> : null}
          {session.closedAt ? <span>Closed {fmtDate(session.closedAt)}</span> : null}
        </div>
        <div className="cnd-d__result-actions">
          {session.status === "ACTIVE" ? (
            <button type="button" className="cnd-d__btn cnd-d__btn--close" disabled={busy} onClick={close}>
              {busy ? <Loader2 className="cnd-d__spin" /> : <CheckCircle2 />} Close session
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <NotAvailable title="Couldn't load results" subtitle={error} />
      ) : data === undefined ? (
        <div className="cnd-d__loading"><Loader2 className="cnd-d__spin" /> Loading results…</div>
      ) : total === 0 ? (
        <div className="cnd-d__blank cnd-d__blank--inline">
          <div className="cnd-d__blank-art"><BarChart3 /></div>
          <h2>No responses yet</h2>
          <p>As people respond anonymously, aggregated answers appear here.</p>
        </div>
      ) : (
        <div className="cnd-d__result-list">
          {(data?.results ?? []).map((r, i) => (
            <div key={r.prompt?.id || i} className="cnd-d__result-card">
              <div className="cnd-d__q-head">
                <span className="cnd-d__q-num">{i + 1}</span>
                <span className="cnd-d__q-text">{r.prompt?.text || "Prompt"}</span>
                <span className="cnd-d__result-count">{r.count} answer{r.count === 1 ? "" : "s"}</span>
              </div>
              {r.type === "rating" ? (
                <RatingBreakdown r={r} />
              ) : (
                <div className="cnd-d__answers">
                  {r.responses.length === 0 ? (
                    <p className="cnd-d__muted">No answers to this prompt.</p>
                  ) : (
                    r.responses.map((v, j) => (
                      <div key={j} className="cnd-d__answer">{String(v)}</div>
                    ))
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RatingBreakdown({ r }: { r: RatingResult }) {
  const max = Math.max(1, ...r.distribution.map((d) => d.count));
  return (
    <div className="cnd-d__rating-result">
      <div className="cnd-d__rating-avg">
        <span className="cnd-d__rating-avg-num">{r.average ?? "—"}</span>
        <span className="cnd-d__rating-avg-lbl">avg / 5</span>
      </div>
      <div className="cnd-d__dist">
        {r.distribution.map((d) => (
          <div key={d.value} className="cnd-d__dist-row">
            <span className="cnd-d__dist-key">{d.value}</span>
            <span className="cnd-d__dist-track"><span className="cnd-d__dist-fill" style={{ width: `${(d.count / max) * 100}%` }} /></span>
            <span className="cnd-d__dist-val">{d.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: CandorStatus }) {
  const m = STATUS_META[status];
  return (
    <span className="cnd-d__status" style={{ ["--st-c" as string]: m.hue }}>
      <m.Icon /> {m.label}
    </span>
  );
}

/* ─────────────────────────── EDITOR (owner / draft) ─────────────────────────── */

function EditorView({ session, onMutate, toast }: { session: ApiCandor; onMutate: () => void; toast: (m: string) => void }) {
  const [title, setTitle] = useState(session.title);
  const [description, setDescription] = useState(session.description || "");
  const [departmentId, setDepartmentId] = useState(session.departmentId || "");
  const [prompts, setPrompts] = useState<Prompt[]>(() => {
    const p = normalizePrompts(session.prompts);
    return p.length ? p : [{ id: uid(), text: "", type: "text" }];
  });
  const [depts, setDepts] = useState<Dept[]>([]);
  const [saving, setSaving] = useState<null | "save" | "launch">(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/departments");
        if (!res.ok) return;
        const data = await res.json();
        const list = data.data ?? (Array.isArray(data) ? data : []);
        setDepts(list.map((d: Record<string, unknown>) => ({ id: String(d.id), name: String(d.name) })));
      } catch { /* ignore */ }
    })();
  }, []);

  function setPromptText(pid: string, v: string) { setPrompts((s) => s.map((p) => (p.id === pid ? { ...p, text: v } : p))); }
  function setPromptType(pid: string, v: PromptType) { setPrompts((s) => s.map((p) => (p.id === pid ? { ...p, type: v } : p))); }
  function addPrompt() { setPrompts((s) => [...s, { id: uid(), text: "", type: "text" }]); }
  function removePrompt(pid: string) { setPrompts((s) => (s.length <= 1 ? s : s.filter((p) => p.id !== pid))); }
  function move(pid: string, dir: -1 | 1) {
    setPrompts((s) => {
      const i = s.findIndex((p) => p.id === pid);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= s.length) return s;
      const next = [...s];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function cleanPrompts(): Prompt[] {
    return prompts.map((p) => ({ ...p, text: p.text.trim() })).filter((p) => p.text.length > 0);
  }

  async function persist(launch: boolean) {
    if (!title.trim()) { toast("Add a title"); return; }
    const cleaned = cleanPrompts();
    if (launch && cleaned.length === 0) { toast("Add at least one prompt to launch"); return; }
    setSaving(launch ? "launch" : "save");
    try {
      const res = await fetch("/api/candor", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: session.id,
          title: title.trim(),
          description: description.trim(),
          departmentId: departmentId || null,
          prompts: cleaned.length ? cleaned : prompts.map((p) => ({ ...p, text: p.text.trim() })),
          ...(launch ? { status: "ACTIVE" } : {}),
        }),
      });
      if (!res.ok) { toast(launch ? "Couldn't launch" : "Couldn't save"); setSaving(null); return; }
      toast(launch ? "Session launched" : "Draft saved");
      onMutate();
    } catch { toast(launch ? "Couldn't launch" : "Couldn't save"); setSaving(null); }
  }

  return (
    <div className="cnd-d__editor">
      <div className="cnd-d__anon cnd-d__anon--soft">
        <Lock />
        <span>Set this up, then launch. Responses stay <strong>anonymous</strong> — the results view never shows who answered.</span>
      </div>

      <div className="cnd-d__field">
        <label>Title</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Q3 team pulse" />
      </div>

      <div className="cnd-d__field">
        <label>Description <span className="cnd-d__opt">optional</span></label>
        <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Why you're asking, and how the feedback will be used." />
      </div>

      <div className="cnd-d__field">
        <label>Who can respond</label>
        <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
          <option value="">Everyone in the org</option>
          {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <span className="cnd-d__hint">{departmentId ? "Only members of this department will see and can answer." : "Anyone in your organization can answer."}</span>
      </div>

      <div className="cnd-d__field">
        <div className="cnd-d__field-row">
          <label>Prompts</label>
          <button type="button" className="cnd-d__mini" onClick={addPrompt}><Plus /> Add prompt</button>
        </div>
        <div className="cnd-d__prompts">
          {prompts.map((p, i) => (
            <div key={p.id} className="cnd-d__prompt">
              <span className="cnd-d__q-num">{i + 1}</span>
              <div className="cnd-d__prompt-body">
                <input value={p.text} onChange={(e) => setPromptText(p.id, e.target.value)} placeholder="Write a question…" />
                <div className="cnd-d__prompt-foot">
                  <select value={p.type} onChange={(e) => setPromptType(p.id, e.target.value as PromptType)}>
                    {PROMPT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                  <div className="cnd-d__prompt-ctrls">
                    <button type="button" onClick={() => move(p.id, -1)} disabled={i === 0} aria-label="Move up"><ChevronUp /></button>
                    <button type="button" onClick={() => move(p.id, 1)} disabled={i === prompts.length - 1} aria-label="Move down"><ChevronDown /></button>
                    <button type="button" onClick={() => removePrompt(p.id)} disabled={prompts.length <= 1} aria-label="Remove"><Trash2 /></button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="cnd-d__actions">
        <button type="button" className="cnd-d__btn cnd-d__btn--ghost" disabled={saving !== null} onClick={() => persist(false)}>
          {saving === "save" ? <Loader2 className="cnd-d__spin" /> : <Edit3 />} Save draft
        </button>
        <button type="button" className="cnd-d__btn cnd-d__btn--primary" disabled={saving !== null} onClick={() => persist(true)}>
          {saving === "launch" ? <Loader2 className="cnd-d__spin" /> : <Rocket />} Launch session
        </button>
      </div>
    </div>
  );
}
