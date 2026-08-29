"use client";

// Space bookmarks card — a team's shared shelf of links. Paste any URL, it
// unfurls to a title + favicon (via /api/link-preview) and saves to the
// Space (Space.settings.bookmarks). Rows open in a new tab; owners/admins can
// add and remove. Kept deliberately slim: one input, clean rows, no chrome.

import { useCallback, useRef, useState } from "react";
import { Bookmark as BookmarkIcon, Globe, Loader2, Plus, X } from "lucide-react";
import { useOsToast } from "@/components/layout/os/toast";

export interface SpaceBookmark {
  id: string;
  url: string;
  title: string;
  favicon: string | null;
  addedById: string;
  addedAt: string;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function SpaceBookmarks({
  spaceId,
  initialBookmarks,
  canEdit,
}: {
  spaceId: string;
  initialBookmarks: SpaceBookmark[];
  canEdit: boolean;
}) {
  const { toast } = useOsToast();
  const [bookmarks, setBookmarks] = useState<SpaceBookmark[]>(initialBookmarks);
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const add = useCallback(async () => {
    const raw = url.trim();
    if (!raw || saving) return;
    setSaving(true);
    try {
      // Unfurl first (best-effort) so we store a real title + favicon.
      let title: string | undefined;
      let favicon: string | undefined;
      try {
        const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
        const pv = await fetch(`/api/link-preview?url=${encodeURIComponent(withScheme)}`);
        if (pv.ok) {
          const d = await pv.json();
          if (typeof d?.title === "string") title = d.title;
          if (typeof d?.favicon === "string") favicon = d.favicon;
        }
      } catch {
        /* unfurl is best-effort; the server falls back to the hostname */
      }
      const res = await fetch(`/api/spaces/${spaceId}/bookmarks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: raw, title, favicon }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error ?? "Couldn't save the bookmark");
      if (Array.isArray(d.bookmarks)) setBookmarks(d.bookmarks);
      setUrl("");
      setAdding(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't save the bookmark");
    } finally {
      setSaving(false);
    }
  }, [url, saving, spaceId, toast]);

  const remove = useCallback(
    async (id: string) => {
      const prev = bookmarks;
      setBookmarks((xs) => xs.filter((b) => b.id !== id)); // optimistic
      try {
        const res = await fetch(`/api/spaces/${spaceId}/bookmarks`, {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ bookmarkId: id }),
        });
        if (!res.ok) throw new Error();
      } catch {
        setBookmarks(prev); // revert
        toast("Couldn't remove the bookmark");
      }
    },
    [bookmarks, spaceId, toast],
  );

  const startAdd = () => {
    setAdding(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  return (
    <div className="flex h-full flex-col">
      {bookmarks.length === 0 && !adding ? (
        <div className="flex flex-1 flex-col items-center justify-center py-4 text-center">
          <span className="mb-2 inline-flex h-9 w-9 items-center justify-center rounded-full bg-zinc-100">
            <BookmarkIcon className="h-4 w-4 text-zinc-500" />
          </span>
          <p className="mb-3 max-w-[240px] text-[12.5px] text-zinc-600">
            Save any URL from around the web so the team can reach it in one click.
          </p>
          {canEdit ? (
            <button
              type="button"
              onClick={startAdd}
              className="rounded-md bg-zinc-100 px-3 py-1.5 text-[12.5px] text-zinc-700 hover:bg-zinc-200"
            >
              Add a bookmark
            </button>
          ) : (
            <p className="text-[12px] text-zinc-400">No bookmarks yet.</p>
          )}
        </div>
      ) : (
        <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
          {bookmarks.map((b) => (
            <li key={b.id} className="group flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-zinc-50">
              <a
                href={b.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-w-0 flex-1 items-center gap-2"
                title={b.url}
              >
                <Favicon src={b.favicon} />
                <span className="min-w-0 flex-1 truncate text-[13px] text-zinc-800">{b.title}</span>
                <span className="shrink-0 truncate text-[11px] text-zinc-400">{hostOf(b.url)}</span>
              </a>
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => void remove(b.id)}
                  aria-label="Remove bookmark"
                  className="shrink-0 rounded p-0.5 text-zinc-300 opacity-0 transition-opacity hover:bg-zinc-200 hover:text-zinc-600 group-hover:opacity-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (adding || bookmarks.length > 0) ? (
        <div className="mt-2 shrink-0 border-t border-zinc-100 pt-2">
          {adding ? (
            <div className="flex items-center gap-1.5">
              <input
                ref={inputRef}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void add();
                  if (e.key === "Escape") { setAdding(false); setUrl(""); }
                }}
                placeholder="Paste a link…"
                className="min-w-0 flex-1 rounded-md border border-zinc-200 px-2 py-1 text-[13px] outline-none focus:border-[var(--os-brand)]"
              />
              <button
                type="button"
                onClick={() => void add()}
                disabled={saving || !url.trim()}
                className="inline-flex h-7 items-center gap-1 rounded-md bg-[var(--os-brand)] px-2.5 text-[12.5px] font-medium text-white disabled:opacity-40"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Save
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={startAdd}
              className="inline-flex items-center gap-1 text-[12.5px] text-zinc-500 hover:text-zinc-800"
            >
              <Plus className="h-3.5 w-3.5" /> Add a bookmark
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Favicon with a graceful fallback to a globe when the icon fails or is absent. */
function Favicon({ src }: { src: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <Globe className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden />;
  return (
    // next/image can't optimize a favicon from an arbitrary bookmarked host.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={16}
      height={16}
      className="h-4 w-4 shrink-0 rounded-sm object-contain"
      onError={() => setFailed(true)}
    />
  );
}
