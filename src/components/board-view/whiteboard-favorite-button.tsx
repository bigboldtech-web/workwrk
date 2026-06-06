"use client";

// WhiteboardFavoriteButton — per-Whiteboard star toggle (Phase 89).
// Self-loads from /api/preferences when initialStarred is omitted.

import { useEffect, useState } from "react";
import { Star } from "lucide-react";

interface Props {
  whiteboardId: string;
  initiallyStarred?: boolean;
}

export function WhiteboardFavoriteButton({ whiteboardId, initiallyStarred }: Props) {
  const [starred, setStarred] = useState(initiallyStarred ?? false);
  const [busy, setBusy] = useState(false);
  const needsSelfLoad = initiallyStarred === undefined;

  useEffect(() => {
    if (!needsSelfLoad) return;
    let alive = true;
    fetch("/api/preferences", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const ids: string[] = d?.effective?.home?.favoriteWhiteboardIds ?? [];
        if (alive) setStarred(ids.includes(whiteboardId));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [whiteboardId, needsSelfLoad]);

  const toggle = async (e?: React.MouseEvent) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    if (busy) return;
    const next = !starred;
    setStarred(next);
    setBusy(true);
    try {
      const res = await fetch("/api/me/favorites/whiteboards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ whiteboardId, on: next }),
      });
      if (!res.ok) setStarred(!next);
      else if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("workwrk:favs-changed"));
      }
    } catch {
      setStarred(!next);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={starred}
      title={starred ? "Unstar this whiteboard" : "Star this whiteboard"}
      className="inline-flex items-center justify-center w-7 h-7 rounded text-zinc-400 hover:text-amber-500 hover:bg-zinc-50 transition-colors"
    >
      <Star className={`w-4 h-4 ${starred ? "text-amber-400 fill-amber-400" : ""}`} />
    </button>
  );
}
