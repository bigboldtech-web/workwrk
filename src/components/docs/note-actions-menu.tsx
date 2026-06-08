"use client";

/*
 * NoteActionMenu — a shared right-click / "…" context menu for notes,
 * used by the Notes sidebar and the /docs list. Notion-style actions:
 *   Open · Open in new tab · Rename (inline) · Copy link ·
 *   Add/Remove favorite · Duplicate · Move to Trash
 *
 * Rendered into a body portal at fixed cursor coords (clamped to the
 * viewport) so it's never clipped by an overflow-hidden sidebar. All API
 * calls happen here; `onChanged` lets the host refresh, and a global
 * "workwrk:docs-changed" event keeps every notes surface in sync.
 *
 * Use the `useNoteMenu()` hook to wire right-click on a list of rows.
 */

import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Copy, Link2, Star, Trash2, ExternalLink, FileText } from "lucide-react";
import { useOsToast } from "@/components/layout/os/toast";

export type NoteTarget = { id: string; title: string; favorite?: boolean };

export function dispatchDocsChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("workwrk:docs-changed"));
}

export function useNoteMenu() {
  const [menu, setMenu] = useState<{ target: NoteTarget; x: number; y: number } | null>(null);
  const open = (e: React.MouseEvent, target: NoteTarget) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ target, x: e.clientX, y: e.clientY });
  };
  const close = () => setMenu(null);
  return { menu, open, close };
}

export function NoteActionMenu({
  target,
  x,
  y,
  onClose,
  onChanged,
}: {
  target: NoteTarget;
  x: number;
  y: number;
  onClose: () => void;
  onChanged?: (kind: "renamed" | "trashed" | "duplicated" | "favorited") => void;
}) {
  const router = useRouter();
  const { toast } = useOsToast();
  const ref = useRef<HTMLDivElement | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(target.title);
  const [fav, setFav] = useState(!!target.favorite);
  const [pos, setPos] = useState({ x, y });

  // Clamp to viewport once measured.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)),
    });
  }, [x, y, renaming]);

  useEffect(() => {
    function onDown(e: MouseEvent) { if (!ref.current?.contains(e.target as Node)) onClose(); }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  async function rename() {
    const t = name.trim() || "Untitled note";
    const res = await fetch(`/api/docs/${target.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: t }),
    });
    if (res.ok) { toast("Renamed"); onChanged?.("renamed"); dispatchDocsChanged(); }
    else toast("Couldn't rename");
    onClose();
  }

  async function duplicate() {
    const res = await fetch(`/api/docs/${target.id}/duplicate`, { method: "POST" });
    if (res.ok) {
      const d = await res.json().catch(() => null);
      const id = d?.doc?.id ?? d?.data?.id ?? d?.id;
      toast("Duplicated"); onChanged?.("duplicated"); dispatchDocsChanged();
      if (id) router.push(`/docs/${id}`);
    } else toast("Couldn't duplicate");
    onClose();
  }

  function copyLink() {
    navigator.clipboard?.writeText(`${window.location.origin}/docs/${target.id}`).catch(() => {});
    toast("Link copied");
    onClose();
  }

  async function toggleFav() {
    const next = !fav;
    setFav(next);
    const res = await fetch("/api/me/favorites/docs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ docId: target.id, on: next }),
    });
    if (res.ok) {
      window.dispatchEvent(new CustomEvent("workwrk:favs-changed"));
      onChanged?.("favorited");
      toast(next ? "Starred" : "Removed from favorites");
    } else { setFav(!next); toast("Couldn't update favorite"); }
    onClose();
  }

  async function trash() {
    if (!confirm(`Move "${target.title || "Untitled note"}" to Trash?`)) return;
    const res = await fetch(`/api/docs/${target.id}`, { method: "DELETE" });
    if (res.ok) { toast("Moved to Trash"); onChanged?.("trashed"); dispatchDocsChanged(); }
    else toast("Couldn't move to Trash");
    onClose();
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div ref={ref} className="noteacts" style={{ top: pos.y, left: pos.x }} onClick={(e) => e.stopPropagation()} role="menu">
      {renaming ? (
        <form className="noteacts__rename" onSubmit={(e) => { e.preventDefault(); void rename(); }}>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } }}
            onFocus={(e) => e.target.select()}
            placeholder="Note name…"
          />
        </form>
      ) : (
        <>
          <div className="noteacts__title">{target.title || "Untitled note"}</div>
          <button type="button" className="noteacts__item" onClick={() => { router.push(`/docs/${target.id}`); onClose(); }}>
            <FileText /> Open
          </button>
          <button type="button" className="noteacts__item" onClick={() => { window.open(`/docs/${target.id}`, "_blank"); onClose(); }}>
            <ExternalLink /> Open in new tab
          </button>
          <button type="button" className="noteacts__item" onClick={() => { setName(target.title); setRenaming(true); }}>
            <Pencil /> Rename
          </button>
          <button type="button" className="noteacts__item" onClick={copyLink}>
            <Link2 /> Copy link
          </button>
          <button type="button" className="noteacts__item" onClick={() => void toggleFav()}>
            <Star className={fav ? "is-on" : ""} /> {fav ? "Remove from favorites" : "Add to favorites"}
          </button>
          <button type="button" className="noteacts__item" onClick={() => void duplicate()}>
            <Copy /> Duplicate
          </button>
          <div className="noteacts__sep" />
          <button type="button" className="noteacts__item noteacts__item--danger" onClick={() => void trash()}>
            <Trash2 /> Move to Trash
          </button>
        </>
      )}
    </div>,
    document.body,
  );
}
