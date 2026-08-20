"use client";

// Full-page detail for a board Item (Task). Shareable URL: /item/<id>.
// Reuses BoardItemDetail — the same sections the side drawer renders —
// fetching the item + its board context (fields/statuses) in one call.

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { ArrowLeft, Trash2, Loader2, SearchX } from "lucide-react";
import { BoardItemDetail, type DetailPatch } from "@/components/board-view/board-item-detail";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useConfirm } from "@/components/ui/dialog-provider";
import { DEFAULT_STATUS_OPTIONS, type BoardItemRow, type StatusOption } from "@/lib/board-items-shared";
import type { FieldDef } from "@/lib/field-catalog";

type BoardCtx = { id: string; slug: string; name: string; fields: FieldDef[]; statuses: StatusOption[] };

export default function ItemDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const router = useRouter();
  const { data: session } = useSession();
  const confirm = useConfirm();
  const { openSidekick } = useOsShell();
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
      // Merge — never blind-replace: a lean response must not strip
      // enriched fields (subtaskCount, counts) off the cached item.
      if (res.ok && data.item) setItem((prev) => (prev ? { ...prev, ...data.item } : data.item));
      else void load();
    } catch { void load(); }
  }, [item, load]);

  const archive = useCallback(async () => {
    if (!item || !(await confirm({ title: "Archive task", description: "Archive this task? You can restore from Trash.", destructive: true, confirmLabel: "Archive" }))) return;
    const res = await fetch(`/api/items/${item.id}`, { method: "DELETE" });
    if (res.ok) router.push(board ? `/boards/${board.slug}` : "/home");
  }, [item, board, router, confirm]);

  const statuses = board?.statuses?.length ? board.statuses : [...DEFAULT_STATUS_OPTIONS];

  return (
    <div className="h-full overflow-y-auto bg-white">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-zinc-100 px-6 py-3 flex items-center gap-3">
        <button type="button" onClick={() => router.back()} className="inline-flex items-center gap-1.5 text-[14px] text-zinc-600 hover:text-zinc-900">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        {board ? (
          <Link href={`/boards/${board.slug}`} className="text-[14px] text-zinc-400 hover:text-zinc-700 truncate">{board.name}</Link>
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
          <div className="flex flex-col items-center text-center py-16 max-w-sm mx-auto">
            <span className="w-12 h-12 rounded-2xl bg-zinc-100 dark:bg-white/5 flex items-center justify-center mb-4">
              <SearchX className="w-6 h-6 text-zinc-400" />
            </span>
            <div className="text-[15px] font-semibold text-zinc-900 dark:text-zinc-100">{error}</div>
            <p className="text-[14px] text-zinc-500 dark:text-zinc-400 mt-1.5">
              This task may have been deleted or moved to Trash. The link that brought you here is no longer available.
            </p>
            <div className="flex items-center gap-2 mt-5">
              <button type="button" onClick={() => router.back()} className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-[14px] text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-[#2A2F38] hover:bg-zinc-50 dark:hover:bg-white/5">
                <ArrowLeft className="w-4 h-4" /> Go back
              </button>
              <Link href="/today" className="inline-flex items-center h-9 px-3.5 rounded-lg text-[14px] font-medium text-white bg-[#0073EA] hover:bg-[#0060B9]">
                Go to Today
              </Link>
            </div>
          </div>
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
            onAskAi={() => openSidekick(`Help me with the task: ${item.title}`)}
          />
        ) : null}
      </div>
    </div>
  );
}
