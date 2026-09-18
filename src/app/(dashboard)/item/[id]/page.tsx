"use client";

// Full-page detail for a board Item (Task). Shareable URL: /item/<id>.
// Reuses BoardItemDetail — the same sections the side drawer renders —
// fetching the item + its board context (fields/statuses) in one call.

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { BackButton } from "@/components/ui/back-button";
import { NotFoundView } from "@/components/access/not-found-view";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonRows } from "@/components/ui/skeleton";
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
  // A 404 (deleted, or not discoverable) is the in-shell 404, identical for
  // both (spec-shell 2.4); any other failure is the error primitive.
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/items/${id}`, { cache: "no-store" });
      if (!res.ok) {
        if (res.status === 404) setMissing(true);
        else setError("Couldn't load this task");
        return;
      }
      setMissing(false);
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
    // After an archive: the List, else Everything (spec-shell 1.5). /home is
    // not a route until the work and home unit ships it.
    if (res.ok) router.push(board ? `/boards/${board.slug}` : "/everything");
  }, [item, board, router, confirm]);

  const statuses = board?.statuses?.length ? board.statuses : [...DEFAULT_STATUS_OPTIONS];

  // The 404 renders alone: no page header, the same view as any other
  // unknown object, with the hub's BackButton (spec-shell 2.4).
  if (missing) return <NotFoundView />;

  return (
    <div className="h-full overflow-y-auto bg-white">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-zinc-100 px-6 py-3 flex items-center gap-3">
        <BackButton fallbackHref={board ? `/boards/${board.slug}` : "/everything"} label={board ? board.name : "Everything"} />
        {board ? (
          <Link href={`/boards/${board.slug}`} className="text-base text-zinc-400 hover:text-zinc-700 truncate">{board.name}</Link>
        ) : null}
        {canEdit && item ? (
          <button type="button" onClick={archive} className="ml-auto inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-red-500 px-2 py-1 rounded hover:bg-red-500/10">
            <Trash2 className="w-3.5 h-3.5" /> Archive
          </button>
        ) : null}
      </div>

      <div className="px-6 py-6">
        {loading && !item ? (
          <SkeletonRows />
        ) : error ? (
          <ErrorState what="this task" onRetry={() => { setError(null); void load(); }} />
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
