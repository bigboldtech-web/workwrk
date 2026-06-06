"use client";

// SpaceFavoriteButton — per-Space star toggle (Phase 80). Same shape
// as Phase 78's BoardFavoriteButton.

import { useState } from "react";
import { Star } from "lucide-react";

interface Props {
  spaceId: string;
  initiallyStarred: boolean;
}

export function SpaceFavoriteButton({ spaceId, initiallyStarred }: Props) {
  const [starred, setStarred] = useState(initiallyStarred);
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    if (busy) return;
    const next = !starred;
    setStarred(next);
    setBusy(true);
    try {
      const res = await fetch("/api/me/favorites/spaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spaceId, on: next }),
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
      title={starred ? "Unstar this Space" : "Star this Space"}
      className="inline-flex items-center justify-center w-7 h-7 rounded text-zinc-400 hover:text-amber-500 hover:bg-zinc-50 transition-colors"
    >
      <Star className={`w-4 h-4 ${starred ? "text-amber-400 fill-amber-400" : ""}`} />
    </button>
  );
}
