"use client";

// BoardFavoriteButton — small client island for the per-board star
// toggle in the board page header. Phase 78. Persists to the viewer's
// UserPreference.home.favoriteBoardIds via /api/me/favorites/boards.

import { useState } from "react";
import { Star } from "lucide-react";

interface Props {
  boardId: string;
  initiallyStarred: boolean;
}

export function BoardFavoriteButton({ boardId, initiallyStarred }: Props) {
  const [starred, setStarred] = useState(initiallyStarred);
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    if (busy) return;
    const next = !starred;
    setStarred(next); // optimistic
    setBusy(true);
    try {
      const res = await fetch("/api/me/favorites/boards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ boardId, on: next }),
      });
      if (!res.ok) {
        setStarred(!next);
      } else if (typeof window !== "undefined") {
        // Tell the sidebar Favorites section to refresh.
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
      title={starred ? "Unstar this board" : "Star this board"}
      className="inline-flex items-center justify-center w-7 h-7 rounded text-zinc-500 hover:text-amber-500 hover:bg-zinc-50 transition-colors"
    >
      <Star
        className={`w-4 h-4 ${starred ? "text-amber-400 fill-amber-400" : ""}`}
      />
    </button>
  );
}
