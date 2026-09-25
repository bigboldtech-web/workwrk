"use client";

/* Mentions Inbox — every time someone @-mentions you across the org's
 * notes and SOPs lands here. Click any row to jump straight to the
 * referencing block (we use the block id as the URL fragment so the
 * doc page scrolls to it automatically).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { FileText, BookCopy } from "lucide-react";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useObjectHref } from "@/components/layout/os/use-object-href";

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
  // Mentions is Work: each mention opens its doc or SOP in Work, at the block.
  const { href: objectLink } = useObjectHref();
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

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
  }, [reloadKey]);

  return (
    <>
      <OsPageHeader title="Mentions" />

      {/* Where this page is going, said plainly on the page itself.
          spec-work-home section 0 retires /me/mentions in favour of the
          Inbox's Mentions tab, which reads `mention` notifications. The
          redirect is NOT live yet and this page is NOT deleted, because doc
          and SOP mentions only become notifications when
          scripts/backfill-mentions.ts has run in production (scripts/
          MIGRATIONS.md): until then this is the only place these rows
          exist, and a 308 would be a delete. This strip is the other half of
          that honesty: a person who lands here can see the destination, and a
          person who finds the Inbox tab half-empty knows why. */}
      <div className="os-row flex h-9 shrink-0 items-center gap-2 border-b border-line bg-subtle px-6 text-ink-2">
        Mentions are moving to your Inbox.
        <Link href="/inbox?tab=mentions" className="font-medium text-brand-deep hover:underline">
          Open the Mentions tab
        </Link>
      </div>

      {error ? (
        <OsEmptyView variant="error" title="Couldn't load mentions" hint={`API error: ${error}`} action={{ label: "Try again", onClick: () => { setError(null); setHits(null); setReloadKey((k) => k + 1); } }} />
      ) : hits === null ? (
        <SkeletonRows />
      ) : hits.length === 0 ? (
        <OsEmptyView
          context="list"
          title="No mentions yet"
          hint="Mentions of you in docs and SOPs show up here."
        />
      ) : (
        <ul className="mention-inbox">
          {hits.map((h, i) => {
            const href = `${objectLink(h.source === "doc" ? "doc" : "sop", h.sourceId)}#b-${h.blockId}`;
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
