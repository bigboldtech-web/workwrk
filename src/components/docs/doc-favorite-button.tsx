"use client";

// DocFavoriteButton — per-Doc star toggle. Mirror of Phase 78's
// BoardFavoriteButton + Phase 80's SpaceFavoriteButton.

import { useState } from "react";
import { Star } from "lucide-react";

interface Props {
  docId: string;
  initiallyStarred: boolean;
}

export function DocFavoriteButton({ docId, initiallyStarred }: Props) {
  const [starred, setStarred] = useState(initiallyStarred);
  const [busy, setBusy] = useState(false);

  const toggle = async (e?: React.MouseEvent) => {
    // stopPropagation so the star can overlay clickable parents (e.g.
    // a doc card in /library) without triggering the card's onClick.
    if (e) { e.preventDefault(); e.stopPropagation(); }
    if (busy) return;
    const next = !starred;
    setStarred(next);
    setBusy(true);
    try {
      const res = await fetch("/api/me/favorites/docs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ docId, on: next }),
      });
      if (!res.ok) {
        setStarred(!next);
      } else if (typeof window !== "undefined") {
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
      title={starred ? "Unstar this doc" : "Star this doc"}
      className="inline-flex items-center justify-center w-7 h-7 rounded text-zinc-400 hover:text-amber-500 hover:bg-zinc-50 transition-colors"
    >
      <Star className={`w-4 h-4 ${starred ? "text-amber-400 fill-amber-400" : ""}`} />
    </button>
  );
}
