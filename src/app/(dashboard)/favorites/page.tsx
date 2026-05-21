"use client";

// /favorites — pinned surfaces for quick access. Lightweight first
// pass: persists per-user in localStorage. Pinning is exposed via
// the star icon on board / doc / product detail headers in later
// passes; for now, this page surfaces whatever the user has already
// pinned plus an empty-state CTA.

import Link from "next/link";
import { useEffect, useState } from "react";
import { Star, ArrowRight } from "lucide-react";

interface Favorite {
  href: string;
  label: string;
  kind?: string;
  addedAt: number;
}

const STORAGE_KEY = "workwrk:favorites";

export default function FavoritesPage() {
  const [items, setItems] = useState<Favorite[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Favorite[];
        if (Array.isArray(parsed)) setItems(parsed);
      }
    } catch {}
  }, []);

  const remove = (href: string) => {
    const next = items.filter((it) => it.href !== href);
    setItems(next);
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
  };

  return (
    <div className="max-w-5xl mx-auto py-6 px-4 space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Star size={20} className="text-amber-500" /> Favorites
        </h1>
        <p className="text-sm text-muted mt-1">
          Pinned surfaces — boards, docs, products you reach for daily.
        </p>
      </header>

      {!hydrated ? (
        <div className="rounded-xl border border-border bg-surface p-10 text-center text-sm text-muted-2">Loading…</div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-10 text-center">
          <Star size={28} className="mx-auto text-muted-2 mb-3" />
          <p className="text-base font-semibold mb-1">Nothing pinned yet</p>
          <p className="text-sm text-muted-2 mb-5 max-w-md mx-auto">
            Click the star icon on any board, doc, or product you want quick access to. They&apos;ll land here for one-click reach.
          </p>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-violet-600 hover:bg-violet-700 text-white"
          >
            Go to workspace home <ArrowRight size={14} />
          </Link>
        </div>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {items
            .slice()
            .sort((a, b) => b.addedAt - a.addedAt)
            .map((it) => (
              <li key={it.href} className="group rounded-xl border border-border bg-surface hover:border-violet-300 transition-colors">
                <Link href={it.href} className="block p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Star size={14} className="text-amber-500" />
                    {it.kind && (
                      <span className="text-[10px] uppercase tracking-wider text-muted-2">{it.kind}</span>
                    )}
                  </div>
                  <p className="text-sm font-semibold truncate">{it.label}</p>
                  <p className="text-xs text-muted-2 truncate">{it.href}</p>
                </Link>
                <div className="border-t border-border px-3 py-1.5 flex items-center justify-between">
                  <span className="text-[10px] text-muted-2">
                    Pinned {fmtRelative(it.addedAt)}
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(it.href)}
                    className="text-[10px] text-rose-500 hover:text-rose-600"
                  >
                    Unpin
                  </button>
                </div>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

function fmtRelative(ms: number): string {
  const diff = Date.now() - ms;
  const min = 60 * 1000, hr = 60 * min, day = 24 * hr;
  if (diff < hr) return `${Math.max(1, Math.floor(diff / min))}m ago`;
  if (diff < day) return `${Math.floor(diff / hr)}h ago`;
  return `${Math.floor(diff / day)}d ago`;
}
