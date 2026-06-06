"use client";

// SidebarQuickStar — tiny star toggle for hover clusters inside the
// sidebar tree. Self-loads its initial state from /api/preferences so
// the surrounding sidebar component doesn't need to thread prefs in.
// Shared shape across Space + Board + Folder + Table rows (Phase 86).

import { useEffect, useState } from "react";
import { Star } from "lucide-react";

type Kind = "space" | "board" | "folder" | "table" | "doc" | "whiteboard" | "file";

interface Props {
  kind: Kind;
  id: string;
}

function prefKey(kind: Kind): string {
  return (
    kind === "space" ? "favoriteSpaceIds"
    : kind === "board" ? "favoriteBoardIds"
    : kind === "folder" ? "favoriteFolderIds"
    : kind === "table" ? "favoriteTableIds"
    : kind === "whiteboard" ? "favoriteWhiteboardIds"
    : kind === "file" ? "favoriteFileIds"
    : "favoriteDocIds"
  );
}

function bodyFor(kind: Kind, id: string, on: boolean) {
  return (
    kind === "space" ? { spaceId: id, on }
    : kind === "board" ? { boardId: id, on }
    : kind === "folder" ? { folderId: id, on }
    : kind === "table" ? { tableId: id, on }
    : kind === "whiteboard" ? { whiteboardId: id, on }
    : kind === "file" ? { fileId: id, on }
    : { docId: id, on }
  );
}

export function SidebarQuickStar({ kind, id }: Props) {
  const [starred, setStarred] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/preferences", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const ids: string[] = d?.effective?.home?.[prefKey(kind)] ?? [];
        if (alive) setStarred(ids.includes(id));
      })
      .catch(() => { if (alive) setStarred(false); });
    return () => { alive = false; };
  }, [kind, id]);

  // Refetch when ANY favorite changes anywhere (cross-component sync).
  useEffect(() => {
    const onChange = () => {
      fetch("/api/preferences", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          const ids: string[] = d?.effective?.home?.[prefKey(kind)] ?? [];
          setStarred(ids.includes(id));
        })
        .catch(() => {});
    };
    window.addEventListener("workwrk:favs-changed", onChange);
    return () => window.removeEventListener("workwrk:favs-changed", onChange);
  }, [kind, id]);

  const toggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (busy || starred === null) return;
    const next = !starred;
    setStarred(next);
    setBusy(true);
    try {
      const res = await fetch(`/api/me/favorites/${kind}s`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(bodyFor(kind, id, next)),
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
      disabled={busy || starred === null}
      title={starred ? "Unstar" : "Star"}
      aria-pressed={!!starred}
      aria-label={starred ? "Unstar" : "Star"}
      className="p-0.5 rounded text-zinc-400 hover:text-amber-500 hover:bg-zinc-100 inline-flex items-center justify-center"
    >
      <Star className={`w-3 h-3 ${starred ? "text-amber-400 fill-amber-400" : ""}`} />
    </button>
  );
}
