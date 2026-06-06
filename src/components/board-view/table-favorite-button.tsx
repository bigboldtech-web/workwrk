"use client";

// TableFavoriteButton — per-DataTable star toggle (Phase 84).
// Self-loads initial state when `initiallyStarred` is omitted, since
// the table page is a pure client component without server prefs.

import { useEffect, useState } from "react";
import { Star } from "lucide-react";

interface Props {
  tableId: string;
  initiallyStarred?: boolean;
}

export function TableFavoriteButton({ tableId, initiallyStarred }: Props) {
  const [starred, setStarred] = useState(initiallyStarred ?? false);
  const [busy, setBusy] = useState(false);

  // Self-hydrate when no initial state was passed.
  const needsSelfLoad = initiallyStarred === undefined;
  useEffect(() => {
    if (!needsSelfLoad) return;
    let alive = true;
    fetch("/api/preferences", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const ids: string[] = d?.effective?.home?.favoriteTableIds ?? [];
        if (alive) setStarred(ids.includes(tableId));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [tableId, needsSelfLoad]);

  const toggle = async (e?: React.MouseEvent) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    if (busy) return;
    const next = !starred;
    setStarred(next);
    setBusy(true);
    try {
      const res = await fetch("/api/me/favorites/tables", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tableId, on: next }),
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
      title={starred ? "Unstar this table" : "Star this table"}
      className="inline-flex items-center justify-center w-7 h-7 rounded text-zinc-400 hover:text-amber-500 hover:bg-zinc-50 transition-colors"
    >
      <Star className={`w-4 h-4 ${starred ? "text-amber-400 fill-amber-400" : ""}`} />
    </button>
  );
}
