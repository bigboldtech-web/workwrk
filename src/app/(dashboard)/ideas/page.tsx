"use client";

/* Ideas — voting + kanban hybrid.
 *
 * Top: pipeline of 4 status columns (Submitted → Under review →
 * Approved → Implemented). Cards drag between columns to move them
 * forward. Each card is Product-Hunt-style: large upvote stack on the
 * left, idea body on the right.
 *
 * Bottom: archive strip (Rewarded ⭐ + Rejected) when there's content.
 *
 *  GET   /api/ideas?sort=votes|new
 *  POST  /api/ideas               { title, description, category? }
 *  PATCH /api/ideas/[id]          { status }
 *  POST  /api/ideas/[id]/vote     toggle
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Lightbulb, ThumbsUp, MessageSquare, Plus, X, Trophy,
  Flame, Clock, Loader2,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { GRAD, PEOPLE } from "@/components/layout/os/catalog";
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

function relTime(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

type Sort = "votes" | "new";

export default function IdeasPage() {
  const [ideas, setIdeas] = useState<ApiIdea[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [composer, setComposer] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [draft, setDraft] = useState({ title: "", description: "" });
  const [dragId, setDragId] = useState<string | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("votes");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const [iRes, mRes] = await Promise.all([
        fetch(`/api/ideas?sort=${sort}`),
        fetch("/api/me"),
      ]);
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
  }, [sort]);
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
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error();
    } catch { toast("Couldn't move idea"); void load(); }
  }

  async function vote(id: string) {
    if (!meId) return;
    setIdeas((prev) => prev?.map((i) => {
      if (i.id !== id) return i;
      const voted = (i.votes ?? []).some((v) => v.userId === meId);
      const newVotes = voted
        ? (i.votes ?? []).filter((v) => v.userId !== meId)
        : [...(i.votes ?? []), { userId: meId }];
      return { ...i, votes: newVotes, _count: { ...i._count, votes: newVotes.length } };
    }) ?? prev);
    try {
      await fetch(`/api/ideas/${id}/vote`, { method: "POST" });
    } catch { void load(); }
  }

  async function submit() {
    if (!draft.title.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/ideas", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: draft.title.trim(), description: draft.description.trim() || undefined }),
      });
      if (!res.ok) throw new Error();
      setDraft({ title: "", description: "" });
      setComposer(false);
      void load();
      toast("Idea submitted");
    } catch { toast("Couldn't submit idea"); }
    finally { setSubmitting(false); }
  }

  const total = ideas?.length ?? 0;
  const implementedCount = (ideas ?? []).filter((i) => i.status === "IMPLEMENTED" || i.status === "REWARDED").length;
  const myCount = (ideas ?? []).filter((i) => i.submitter?.id === meId).length;

  return (
    <>
      <OsTitleBar
        title="Ideas"
        Icon={Lightbulb}
        iconGradient={GRAD.yellowOrange}
        description={ideas === null ? "Loading…" : `${total} idea${total === 1 ? "" : "s"} · ${implementedCount} implemented · you've submitted ${myCount}`}
        people={[PEOPLE.bb, PEOPLE.sc, PEOPLE.mk]}
        morePeople={9}
        actions={
          <div className="ideas__head-actions">
            <div className="ideas__sort">
              <button type="button" className={sort === "votes" ? "is-active" : ""} onClick={() => setSort("votes")}>
                <Flame /> Top
              </button>
              <button type="button" className={sort === "new" ? "is-active" : ""} onClick={() => setSort("new")}>
                <Clock /> New
              </button>
            </div>
            <button type="button" className="ideas__new" onClick={() => setComposer(true)}>
              <Plus /> Share an idea
            </button>
          </div>
        }
      />

      <div className="ideas">
        {/* Inline composer (animates in from top) */}
        {composer && (
          <div className="ideas__composer">
            <header className="ideas__composer-head">
              <h3><Lightbulb /> What&apos;s the idea?</h3>
              <button type="button" onClick={() => { setComposer(false); setDraft({ title: "", description: "" }); }} aria-label="Close"><X /></button>
            </header>
            <input
              type="text"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="One-line title — what are you proposing?"
              autoFocus
              className="ideas__composer-title"
            />
            <textarea
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder="What's the problem? What would change if we did this? (Optional but helps people vote.)"
              rows={3}
              className="ideas__composer-desc"
            />
            <footer className="ideas__composer-foot">
              <span>Anyone in your org can upvote and comment.</span>
              <button type="button" onClick={submit} disabled={!draft.title.trim() || submitting} className="ideas__submit">
                {submitting ? <><Loader2 className="ideas__spin" /> Submitting…</> : <>Submit <ThumbsUp /></>}
              </button>
            </footer>
          </div>
        )}

        {loadError ? (
          <OsEmptyView Icon={Lightbulb} iconGradient={GRAD.redPink} title="Couldn't load ideas" subtitle={`API error: ${loadError}`} cta="Retry" />
        ) : ideas === null ? (
          <div className="ideas__loading">Loading…</div>
        ) : total === 0 ? (
          <OsEmptyView Icon={Lightbulb} iconGradient={GRAD.yellowOrange} title="No ideas yet" subtitle="Got a hunch? A fix? A what-if? Drop it in — even half-baked ones spark conversations." chips={["Product", "Process", "Culture", "Cost-cutting"]} cta="Share an idea" />
        ) : (
          <div className="ideas__board">
            {STATUS_ORDER.map((s) => {
              const items = byStatus.get(s) ?? [];
              const hue = STATUS_HUE[s];
              return (
                <section
                  key={s}
                  className={`ideas__col ${dragId ? "is-dropzone" : ""}`}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); if (dragId) void moveToStatus(dragId, s); setDragId(null); }}
                  style={{ ["--col-hue" as string]: hue }}
                >
                  <header className="ideas__col-head">
                    <span className="ideas__col-dot" />
                    <span className="ideas__col-name">{STATUS_LABEL[s]}</span>
                    <span className="ideas__col-count">{items.length}</span>
                  </header>
                  <div className="ideas__col-body">
                    {items.length === 0 ? (
                      <div className="ideas__col-empty">{dragId ? "Drop here" : "Empty"}</div>
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
                          {/* Product-Hunt-style upvote stack on the left */}
                          <button
                            type="button"
                            className={`idea__vote ${voted ? "is-voted" : ""}`}
                            onClick={(e) => { e.stopPropagation(); void vote(i.id); }}
                            title={voted ? "Remove your vote" : "Upvote"}
                          >
                            <ThumbsUp />
                            <span>{voteCount}</span>
                          </button>

                          {/* Body */}
                          <div className="idea__body">
                            <h4 className="idea__title">{i.title}</h4>
                            {i.description ? (
                              <p className="idea__desc">{i.description.length > 120 ? i.description.slice(0, 120) + "…" : i.description}</p>
                            ) : null}
                            <footer className="idea__foot">
                              <div className="idea__who">
                                {i.submitter && (
                                  <span className="idea__av" style={{ background: avColor(i.submitter.id) }}>
                                    {initials(i.submitter.firstName, i.submitter.lastName)}
                                  </span>
                                )}
                                <span className="idea__who-name">
                                  {[i.submitter?.firstName, i.submitter?.lastName].filter(Boolean).join(" ") || "Someone"}
                                </span>
                                <span className="idea__time">· {relTime(i.createdAt)}</span>
                              </div>
                              {(i._count?.comments ?? 0) > 0 && (
                                <span className="idea__comments"><MessageSquare /> {i._count?.comments}</span>
                              )}
                            </footer>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )}

        {/* Archive strip */}
        {(rewarded.length + rejected.length) > 0 && (
          <section className="ideas__archive">
            {rewarded.length > 0 && (
              <div className="ideas__archive-block" style={{ ["--col-hue" as string]: STATUS_HUE.REWARDED }}>
                <header><Trophy /> Rewarded · {rewarded.length}</header>
                <div className="ideas__archive-list">
                  {rewarded.slice(0, 6).map((i) => (
                    <div key={i.id} className="ideas__archive-item">{i.title}</div>
                  ))}
                </div>
              </div>
            )}
            {rejected.length > 0 && (
              <div className="ideas__archive-block" style={{ ["--col-hue" as string]: STATUS_HUE.REJECTED }}>
                <header><X /> Rejected · {rejected.length}</header>
                <div className="ideas__archive-list">
                  {rejected.slice(0, 6).map((i) => (
                    <div key={i.id} className="ideas__archive-item">{i.title}</div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </>
  );
}
