"use client";

/* Ideas — kanban. Not a table.
 *
 * 6 columns matching IdeaStatus: Submitted -> Under review -> Approved
 * -> Implemented (+ Rejected/Rewarded sidebars). Each idea is a card
 * with title, snippet, submitter avatar, vote count, comment count,
 * and inline upvote button. Drag a card to a different column to move
 * the idea forward.
 *
 * GET   /api/ideas?sort=votes
 * PATCH /api/ideas/[id]   { status }
 * POST  /api/ideas        { title, description }
 * POST  /api/ideas/[id]/vote   (toggle)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Lightbulb, ThumbsUp, MessageSquare, Plus, X } from "lucide-react";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type IdeaStatus = "SUBMITTED" | "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "IMPLEMENTED" | "REWARDED";

type ApiIdea = {
  id: string;
  title: string;
  description?: string | null;
  category?: string | null;
  status: IdeaStatus;
  position?: number | null;
  createdAt: string;
  submitter?: { id: string; firstName?: string | null; lastName?: string | null } | null;
  votes?: { userId: string }[];
  _count?: { votes?: number; comments?: number };
};

const STATUS_ORDER: IdeaStatus[] = ["SUBMITTED", "UNDER_REVIEW", "APPROVED", "IMPLEMENTED"];
const STATUS_LABEL: Record<IdeaStatus, string> = {
  SUBMITTED: "Submitted", UNDER_REVIEW: "Under review", APPROVED: "Approved",
  REJECTED: "Rejected", IMPLEMENTED: "Implemented", REWARDED: "Rewarded",
};
const STATUS_HUE: Record<IdeaStatus, string> = {
  SUBMITTED: "var(--os-c-indigo)", UNDER_REVIEW: "var(--os-c-orange)",
  APPROVED: "var(--os-c-blue)", IMPLEMENTED: "var(--os-c-green)",
  REJECTED: "var(--os-c-red)", REWARDED: "var(--os-c-pink)",
};

const AV_PALETTE = ["var(--os-c-purple)", "var(--os-c-green)", "var(--os-c-orange)", "var(--os-c-pink)", "var(--os-c-teal)", "var(--os-c-indigo)", "var(--os-c-blue)", "var(--os-c-red)"];
function avColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV_PALETTE[h % AV_PALETTE.length]; }
function initials(f?: string | null, l?: string | null) { return (((f ?? "")[0] ?? "") + ((l ?? "")[0] ?? "")).toUpperCase() || "?"; }

export default function IdeasPage() {
  const [ideas, setIdeas] = useState<ApiIdea[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [composer, setComposer] = useState(false);
  const [draft, setDraft] = useState({ title: "", description: "" });
  const [dragId, setDragId] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const [iRes, mRes] = await Promise.all([fetch("/api/ideas?sort=votes"), fetch("/api/me")]);
      if (!iRes.ok) throw new Error(`HTTP ${iRes.status}`);
      const d = await iRes.json();
      setIdeas(d.data ?? (Array.isArray(d) ? d : []));
      if (mRes.ok) {
        const me = await mRes.json();
        setMeId(me?.user?.id ?? null);
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("ideas");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const byStatus = useMemo(() => {
    const m = new Map<IdeaStatus, ApiIdea[]>();
    for (const s of STATUS_ORDER) m.set(s, []);
    for (const i of ideas ?? []) {
      if (i.status === "REJECTED" || i.status === "REWARDED") continue;
      m.get(i.status)?.push(i);
    }
    return m;
  }, [ideas]);

  const rejected = (ideas ?? []).filter((i) => i.status === "REJECTED");
  const rewarded = (ideas ?? []).filter((i) => i.status === "REWARDED");

  async function moveToStatus(id: string, status: IdeaStatus) {
    setIdeas((prev) => prev?.map((i) => i.id === id ? { ...i, status } : i) ?? prev);
    try {
      const res = await fetch(`/api/ideas/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(`PATCH ${res.status}`);
    } catch { toast("Couldn't move idea"); void load(); }
  }

  async function vote(id: string) {
    if (!meId) return;
    setIdeas((prev) => prev?.map((i) => {
      if (i.id !== id) return i;
      const voted = (i.votes ?? []).some((v) => v.userId === meId);
      const newVotes = voted ? (i.votes ?? []).filter((v) => v.userId !== meId) : [...(i.votes ?? []), { userId: meId }];
      return { ...i, votes: newVotes, _count: { ...i._count, votes: newVotes.length } };
    }) ?? prev);
    try {
      await fetch(`/api/ideas/${id}/vote`, { method: "POST" });
    } catch { void load(); }
  }

  async function submit() {
    if (!draft.title.trim()) return;
    try {
      const res = await fetch("/api/ideas", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: draft.title.trim(), description: draft.description.trim() || undefined }),
      });
      if (!res.ok) throw new Error(`POST ${res.status}`);
      setDraft({ title: "", description: "" });
      setComposer(false);
      void load();
    } catch { toast("Couldn't submit idea"); }
  }

  const total = ideas?.length ?? 0;
  const implementedCount = (ideas ?? []).filter((i) => i.status === "IMPLEMENTED" || i.status === "REWARDED").length;
  const myCount = (ideas ?? []).filter((i) => i.submitter?.id === meId).length;

  return (
    <div className="ideas">
      <header className="ideas__head">
        <div className="ideas__head-l">
          <div className="ideas__icon"><Lightbulb /></div>
          <div>
            <h1 className="ideas__title">Ideas</h1>
            <div className="ideas__sub">
              {ideas === null ? "Loading…" : `${total} idea${total === 1 ? "" : "s"} · ${implementedCount} implemented · ${myCount} you submitted`}
            </div>
          </div>
        </div>
        <button type="button" className="ideas__new" onClick={() => setComposer(true)}>
          <Plus /> Share an idea
        </button>
      </header>

      {composer ? (
        <div className="ideas__composer">
          <div className="ideas__composer-head">
            <h3>What&apos;s the idea?</h3>
            <button type="button" onClick={() => { setComposer(false); setDraft({ title: "", description: "" }); }} aria-label="Close"><X /></button>
          </div>
          <input
            type="text"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="One-line title…"
            autoFocus
          />
          <textarea
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            placeholder="What's the problem? What would change if we did this? Optional but helpful."
            rows={3}
          />
          <button type="button" onClick={submit} disabled={!draft.title.trim()}>Submit</button>
        </div>
      ) : null}

      {loadError ? (
        <div className="ideas__error">{loadError}</div>
      ) : ideas === null ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
      ) : total === 0 ? (
        <div className="ideas__empty">
          <Lightbulb />
          <div>
            <h3>No ideas yet</h3>
            <p>Got a hunch? A fix? A what-if? Drop it in — even half-baked ones spark conversations.</p>
          </div>
        </div>
      ) : (
        <div className="ideas__board">
          {STATUS_ORDER.map((s) => {
            const items = byStatus.get(s) ?? [];
            return (
              <section
                key={s}
                className="ideas__col"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); if (dragId) void moveToStatus(dragId, s); setDragId(null); }}
              >
                <header className="ideas__col-head" style={{ borderTop: `3px solid ${STATUS_HUE[s]}` }}>
                  <span>{STATUS_LABEL[s]}</span>
                  <span className="ideas__col-count">{items.length}</span>
                </header>
                <div className="ideas__col-body">
                  {items.length === 0 ? (
                    <div className="ideas__col-empty">Drop an idea here.</div>
                  ) : items.map((i) => {
                    const voteCount = i._count?.votes ?? 0;
                    const voted = !!meId && (i.votes ?? []).some((v) => v.userId === meId);
                    return (
                      <article
                        key={i.id}
                        className="idea"
                        draggable
                        onDragStart={() => setDragId(i.id)}
                        onDragEnd={() => setDragId(null)}
                      >
                        <h4 className="idea__title">{i.title}</h4>
                        {i.description ? <p className="idea__desc">{i.description.length > 120 ? i.description.slice(0, 120) + "…" : i.description}</p> : null}
                        <footer className="idea__foot">
                          <div className="idea__who">
                            {i.submitter && (
                              <span className="idea__av" style={{ background: avColor(i.submitter.id) }}>
                                {initials(i.submitter.firstName, i.submitter.lastName)}
                              </span>
                            )}
                            <span className="idea__who-name">{[i.submitter?.firstName, i.submitter?.lastName].filter(Boolean).join(" ") || "Someone"}</span>
                          </div>
                          <div className="idea__meta">
                            {(i._count?.comments ?? 0) > 0 && (
                              <span className="idea__meta-chip"><MessageSquare /> {i._count?.comments}</span>
                            )}
                            <button type="button" className={`idea__vote ${voted ? "is-voted" : ""}`} onClick={() => vote(i.id)} title={voted ? "Remove vote" : "Upvote"}>
                              <ThumbsUp /> {voteCount}
                            </button>
                          </div>
                        </footer>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {(rejected.length + rewarded.length) > 0 && (
        <section className="ideas__archive">
          {rewarded.length > 0 && (
            <div className="ideas__archive-block">
              <h3 style={{ color: STATUS_HUE.REWARDED }}>Rewarded · {rewarded.length}</h3>
              <div className="ideas__archive-list">
                {rewarded.slice(0, 6).map((i) => (
                  <div key={i.id} className="ideas__archive-item">⭐ {i.title}</div>
                ))}
              </div>
            </div>
          )}
          {rejected.length > 0 && (
            <div className="ideas__archive-block">
              <h3 style={{ color: STATUS_HUE.REJECTED }}>Rejected · {rejected.length}</h3>
              <div className="ideas__archive-list">
                {rejected.slice(0, 6).map((i) => (
                  <div key={i.id} className="ideas__archive-item">— {i.title}</div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
