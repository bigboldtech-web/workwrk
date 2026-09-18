"use client";

/* Notes Trash — soft-archived notes with restore. Deletes in the
 * editor (DELETE /api/docs/[id]) set archivedAt; this page surfaces
 * them and offers a one-click restore via POST /api/docs/[id]/restore.
 *
 * URL: /docs/trash
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, RotateCcw, Search } from "lucide-react";
import { Dots } from "@/components/ui/dots";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { useOsToast } from "@/components/layout/os/toast";
import { SkeletonRows } from "@/components/ui/skeleton";

type ApiDoc = {
  id: string;
  title: string;
  excerpt?: string | null;
  entityType?: string | null;
  archivedAt?: string | null;
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

export default function NotesTrashPage() {
  const [rows, setRows] = useState<ApiDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [restoring, setRestoring] = useState<string | null>(null);
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/docs?archived=1");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows(data.docs ?? data.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function restore(id: string) {
    setRestoring(id);
    try {
      const res = await fetch(`/api/docs/${id}/restore`, { method: "POST" });
      if (!res.ok) { toast("Restore failed"); return; }
      toast("Note restored");
      setRows((prev) => prev?.filter((d) => d.id !== id) ?? null);
    } catch { toast("Restore failed"); }
    finally { setRestoring(null); }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows ?? [];
    return (rows ?? []).filter((d) =>
      d.title.toLowerCase().includes(q) ||
      (d.excerpt ?? "").toLowerCase().includes(q),
    );
  }, [rows, search]);

  return (
    <>
      <OsPageHeader title="Trash" />

      <div className="docs__toolbar">
        <div className="docs__search">
          <Search />
          <input
            type="search"
            placeholder="Search trash…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {error ? (
        <OsEmptyView variant="error" title="Couldn't load trash" hint={`API error: ${error}`} action={{ label: "Try again", onClick: () => { void load(); } }} />
      ) : rows === null ? (
        <SkeletonRows />
      ) : rows.length === 0 ? (
        <OsEmptyView context="docs" title="Trash is empty" hint="Deleted docs stay here and can be restored." />
      ) : filtered.length === 0 ? (
        <div className="docs__loading">Nothing matches &ldquo;{search}&rdquo;.</div>
      ) : (
        <ul className="trash-list">
          {filtered.map((d) => (
            <li key={d.id} className="trash-row">
              <span className="trash-row__icon"><FileText /></span>
              <div className="trash-row__body">
                <div className="trash-row__title">{d.title || "Untitled note"}</div>
                {d.excerpt && (
                  <div className="trash-row__excerpt">
                    {d.excerpt.slice(0, 160)}{d.excerpt.length > 160 ? "…" : ""}
                  </div>
                )}
                <div className="trash-row__meta">
                  {d.archivedAt && <>Archived {relTime(d.archivedAt)}</>}
                  {d.entityType && <> · attached to {d.entityType.toLowerCase().replace(/_/g, " ")}</>}
                </div>
              </div>
              <button
                type="button"
                className="trash-row__restore"
                onClick={() => restore(d.id)}
                disabled={restoring === d.id}
              >
                {restoring === d.id ? <><Dots variant="pending" /> Restoring…</> : <><RotateCcw /> Restore</>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
