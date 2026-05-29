"use client";

/* Favorites — pinboard of pinned Sidekick chats.
 *
 *  GET   /api/sidekick/sessions  → list all my chats
 *  PATCH /api/sidekick/sessions/[id]  { pinned } → toggle pin
 *
 * Renders pinned chats as a card grid (the actual "favorites"), with
 * "Recent" chats appearing below as a slimmer list. Each pinned card
 * shows title, model badge, message-burst summary, and a quick "Open"
 * arrow that deep-links into the chat thread.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Star, MessageSquare, ChevronRight, Pin, PinOff, Clock, Sparkles,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type ApiSession = {
  id: string;
  title: string | null;
  pinned: boolean;
  lastModel?: string | null;
  totalTokensIn?: number;
  totalTokensOut?: number;
  createdAt: string;
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

function modelShortName(m?: string | null): string {
  if (!m) return "Claude";
  // claude-opus-4-7 → "Opus 4.7", claude-sonnet-4-6 → "Sonnet 4.6"
  const match = m.match(/claude-(opus|sonnet|haiku)-(\d+(?:-\d+)?)/i);
  if (!match) return m;
  const tier = match[1].charAt(0).toUpperCase() + match[1].slice(1);
  const ver = match[2].replace("-", ".");
  return `${tier} ${ver}`;
}

export default function FavoritesPage() {
  const [rows, setRows] = useState<ApiSession[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/sidekick/sessions");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(data.sessions ?? data.data ?? (Array.isArray(data) ? data : []));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("favorites");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function togglePin(id: string, pinned: boolean) {
    setRows((prev) => prev?.map((s) => s.id === id ? { ...s, pinned } : s) ?? prev);
    try {
      await fetch(`/api/sidekick/sessions/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned }),
      });
    } catch { toast("Couldn't update pin"); void load(); }
  }

  const pinned = useMemo(() => (rows ?? []).filter((s) => s.pinned), [rows]);
  const recent = useMemo(() => (rows ?? []).filter((s) => !s.pinned).slice(0, 25), [rows]);

  return (
    <>
      <OsTitleBar
        title="Favorites"
        Icon={Star}
        iconGradient={GRAD.yellowOrange}
        description={rows === null ? "Loading…" : `${pinned.length} pinned${recent.length > 0 ? ` · ${recent.length} recent` : ""}`}
        people={[PEOPLE.bb]}
        morePeople={0}
      />

      {loadError ? (
        <OsEmptyView Icon={Star} iconGradient={GRAD.redPink} title="Couldn't load favorites" subtitle={`API error: ${loadError}.`} cta="Retry" />
      ) : rows === null ? (
        <div className="fav__loading">Loading favorites…</div>
      ) : rows.length === 0 ? (
        <OsEmptyView Icon={Star} iconGradient={GRAD.yellowOrange} title="No favorites yet" subtitle="Pin a Sidekick chat or star a board item to keep it one click away. Cross-module starring is shipping soon." chips={["Pinned chats", "Recent", "Quick access"]} cta="Open Sidekick" />
      ) : (
        <div className="fav">
          <section className="fav__section">
            <header className="fav__section-head">
              <Pin className="fav__section-icon" />
              <h2>Pinned chats</h2>
              <span className="fav__section-count">{pinned.length}</span>
            </header>
            {pinned.length === 0 ? (
              <div className="fav__hint">
                Nothing pinned yet — open a chat in Sidekick and click the pin icon to make it appear here.
              </div>
            ) : (
              <div className="fav__pin-grid">
                {pinned.map((s) => <PinnedCard key={s.id} session={s} onUnpin={() => togglePin(s.id, false)} />)}
              </div>
            )}
          </section>

          {recent.length > 0 && (
            <section className="fav__section fav__section--recent">
              <header className="fav__section-head">
                <Clock className="fav__section-icon" />
                <h2>Recent chats</h2>
                <span className="fav__section-count">{recent.length}</span>
              </header>
              <div className="fav__recent-list">
                {recent.map((s) => <RecentRow key={s.id} session={s} onPin={() => togglePin(s.id, true)} />)}
              </div>
            </section>
          )}
        </div>
      )}
    </>
  );
}

function PinnedCard({ session, onUnpin }: { session: ApiSession; onUnpin: () => void }) {
  return (
    <Link href={`/sidekick?session=${session.id}`} className="fav-card">
      <header className="fav-card__head">
        <span className="fav-card__icon"><Sparkles /></span>
        <button
          type="button"
          className="fav-card__pin"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onUnpin(); }}
          title="Unpin"
          aria-label="Unpin chat"
        >
          <PinOff />
        </button>
      </header>
      <h3 className="fav-card__title">{session.title ?? "Untitled chat"}</h3>
      <div className="fav-card__meta">
        <span className="fav-card__model">{modelShortName(session.lastModel)}</span>
        <span>·</span>
        <span>{relTime(session.updatedAt)}</span>
      </div>
      <footer className="fav-card__foot">
        <span><MessageSquare /> Open</span>
        <ChevronRight />
      </footer>
    </Link>
  );
}

function RecentRow({ session, onPin }: { session: ApiSession; onPin: () => void }) {
  return (
    <Link href={`/sidekick?session=${session.id}`} className="fav-recent">
      <span className="fav-recent__icon"><MessageSquare /></span>
      <span className="fav-recent__title">{session.title ?? "Untitled chat"}</span>
      <span className="fav-recent__meta">
        <span>{modelShortName(session.lastModel)}</span>
        <span>·</span>
        <span>{relTime(session.updatedAt)}</span>
      </span>
      <button
        type="button"
        className="fav-recent__pin"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onPin(); }}
        title="Pin"
        aria-label="Pin chat"
      >
        <Pin />
      </button>
    </Link>
  );
}
