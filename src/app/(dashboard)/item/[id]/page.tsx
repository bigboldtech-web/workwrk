"use client";

// Full-page detail for a board Item (Task). Shareable URL: /item/<id>.
// Reuses BoardItemDetail — the same sections the side drawer renders —
// fetching the item + its board context (fields/statuses) in one call.

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { ArrowLeft, Trash2, Loader2 } from "lucide-react";
import { BoardItemDetail, type DetailPatch } from "@/components/board-view/board-item-detail";
import { DEFAULT_STATUS_OPTIONS, type BoardItemRow, type StatusOption } from "@/lib/board-items-shared";
import type { FieldDef } from "@/lib/field-catalog";

type BoardCtx = { id: string; slug: string; name: string; fields: FieldDef[]; statuses: StatusOption[] };

export default function ItemDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const router = useRouter();
  const { data: session } = useSession();
  const currentUserId = (session?.user as { id?: string } | undefined)?.id ?? null;

  const [item, setItem] = useState<BoardItemRow | null>(null);
  const [board, setBoard] = useState<BoardCtx | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/items/${id}`, { cache: "no-store" });
      if (!res.ok) { setError(res.status === 404 ? "Task not found" : "Could not load task"); return; }
      const data = await res.json();
      setItem(data.item);
      setBoard(data.board ?? null);
      setCanEdit(!!data.canEdit);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const patch = useCallback(async (body: DetailPatch, optimistic?: Partial<BoardItemRow>) => {
    if (!item) return;
    setItem((prev) => (prev ? { ...prev, ...body, ...optimistic } as BoardItemRow : prev));
    try {
      const res = await fetch(`/api/items/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.item) setItem(data.item);
      else void load();
    } catch { void load(); }
  }, [item, load]);

  const archive = useCallback(async () => {
    if (!item || !window.confirm("Archive this task? You can restore from Trash.")) return;
    const res = await fetch(`/api/items/${item.id}`, { method: "DELETE" });
    if (res.ok) router.push(board ? `/boards/${board.slug}` : "/home");
  }, [item, board, router]);

  const statuses = board?.statuses?.length ? board.statuses : [...DEFAULT_STATUS_OPTIONS];

  return (
    <div className="h-full overflow-y-auto bg-white">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-zinc-100 px-6 py-3 flex items-center gap-3">
        <button type="button" onClick={() => router.back()} className="inline-flex items-center gap-1.5 text-[13px] text-zinc-600 hover:text-zinc-900">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        {board ? (
          <Link href={`/boards/${board.slug}`} className="text-[13px] text-zinc-400 hover:text-zinc-700 truncate">{board.name}</Link>
        ) : null}
        {canEdit && item ? (
          <button type="button" onClick={archive} className="ml-auto inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-red-500 px-2 py-1 rounded hover:bg-red-500/10">
            <Trash2 className="w-3.5 h-3.5" /> Archive
          </button>
        ) : null}
      </div>

      <div className="px-6 py-6">
        {loading && !item ? (
          <div className="flex items-center gap-2 text-sm text-zinc-400 py-10"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
        ) : error ? (
          <div className="text-sm text-red-500 py-10">{error}</div>
        ) : item ? (
          <BoardItemDetail
            item={item}
            canEdit={canEdit}
            currentUserId={currentUserId}
            customFields={board?.fields ?? []}
            statusOptions={statuses}
            onPatch={patch}
            layout="page"
            onOpenItem={(itemId) => router.push(`/item/${itemId}`)}
          />
        ) : null}
      </div>
    </div>
  );
}
