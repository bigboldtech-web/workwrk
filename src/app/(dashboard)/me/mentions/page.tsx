"use client";

/* Mentions Inbox — every time someone @-mentions you across the org's
 * notes and SOPs lands here. Click any row to jump straight to the
 * referencing block (we use the block id as the URL fragment so the
 * doc page scrolls to it automatically).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { AtSign, FileText, BookCopy, Loader2 } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { GRAD } from "@/components/layout/os/catalog";

type Hit = {
  source: "doc" | "sop";
  sourceId: string;
  sourceTitle: string;
  sourceIcon?: string;
  blockId: string;
  excerpt: string;
  updatedAt: string;
};

function relTime(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function MentionsInboxPage() {
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/me/mentions");
        if (!res.ok) { setError(`HTTP ${res.status}`); return; }
        const d = await res.json();
        if (!cancelled) setHits(d.hits ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "load failed");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <>
      <OsTitleBar
        title="Mentions"
        Icon={AtSign}
        iconGradient={GRAD.purpleIndigo}
        description={hits === null ? "Loading…" : `${hits.length} mention${hits.length === 1 ? "" : "s"}`}
      />

      {error ? (
        <OsEmptyView Icon={AtSign} iconGradient={GRAD.redPink} title="Couldn't load mentions" subtitle={`API error: ${error}`} cta="Retry" />
      ) : hits === null ? (
        <div className="mention-inbox__loading"><Loader2 className="bedit__spin" /> Loading mentions…</div>
      ) : hits.length === 0 ? (
        <OsEmptyView
          Icon={AtSign}
          iconGradient={GRAD.purpleIndigo}
          title="No mentions yet"
          subtitle="When someone @-mentions you in a note or SOP, it'll show up here. Try mentioning yourself in any note to test it."
          chips={["Inline @", "Notes", "SOPs"]}
          cta="Open notes"
        />
      ) : (
        <ul className="mention-inbox">
          {hits.map((h, i) => {
            const href = h.source === "doc" ? `/docs/${h.sourceId}#b-${h.blockId}` : `/sops/${h.sourceId}#b-${h.blockId}`;
            return (
              <li key={`${h.source}-${h.sourceId}-${h.blockId}-${i}`}>
                <Link className="mention-inbox__row" href={href}>
                  <span className={`mention-inbox__icon mention-inbox__icon--${h.source}`}>
                    {h.source === "doc" ? (h.sourceIcon ?? <FileText />) : <BookCopy />}
                  </span>
                  <span className="mention-inbox__body">
                    <span className="mention-inbox__title">{h.sourceTitle}</span>
                    <span className="mention-inbox__excerpt">{h.excerpt}</span>
                  </span>
                  <span className="mention-inbox__meta">
                    <span className={`mention-inbox__chip mention-inbox__chip--${h.source}`}>{h.source === "doc" ? "Note" : "SOP"}</span>
                    <span className="mention-inbox__time">{relTime(h.updatedAt)}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
