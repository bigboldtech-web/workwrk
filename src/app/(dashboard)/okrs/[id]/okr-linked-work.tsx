"use client";

// Linked work card on the goal page (spec-goals /okrs/[id] body 5): the
// KRAs, Spaces, Lists and canvases that move this goal, linked through
// EntityLink. The Effort card and the verdict read these links (hours and
// tasks from the linked work), so a link is how work counts toward a goal.
// Reuses LinkExistingPicker; names and hrefs come hydrated from
// /api/entity-links. Adds and removes check the response and say so when
// one fails; nothing is shown as linked that is not.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Boxes, FolderKanban, Target, Plus, X, Frame } from "lucide-react";
import { useOsToast } from "@/components/layout/os/toast";
import { LinkExistingPicker } from "@/components/board-view/link-existing-picker";
import { sectionHrefNow } from "@/components/layout/os/use-object-href";

interface HydratedLink {
  id: string;
  targetId: string;
  target?: { title: string | null; subtitle?: string | null; href?: string | null };
}

type Kind = "SPACE" | "BOARD" | "KRA" | "WHITEBOARD";

export function OkrLinkedWork({ okrId, canEdit }: { okrId: string; canEdit: boolean }) {
  const [spaces, setSpaces] = useState<HydratedLink[] | null>(null);
  const [boards, setBoards] = useState<HydratedLink[] | null>(null);
  const [kras, setKras] = useState<HydratedLink[] | null>(null);
  const [canvases, setCanvases] = useState<HydratedLink[] | null>(null);

  const load = useCallback(() => {
    Promise.all([
      fetch(`/api/entity-links?sourceType=OKR&sourceId=${okrId}&filterTargetType=SPACE`).then((r) => r.json()).catch(() => ({ links: [] })),
      fetch(`/api/entity-links?sourceType=OKR&sourceId=${okrId}&filterTargetType=BOARD`).then((r) => r.json()).catch(() => ({ links: [] })),
      fetch(`/api/entity-links?sourceType=OKR&sourceId=${okrId}&filterTargetType=KRA`).then((r) => r.json()).catch(() => ({ links: [] })),
      fetch(`/api/entity-links?sourceType=OKR&sourceId=${okrId}&filterTargetType=WHITEBOARD`).then((r) => r.json()).catch(() => ({ links: [] })),
    ]).then(([sp, bd, kr, cv]) => {
      setSpaces(sp.links ?? []);
      setBoards(bd.links ?? []);
      setKras(kr.links ?? []);
      setCanvases(cv.links ?? []);
    });
  }, [okrId]);

  useEffect(() => { load(); }, [load]);

  return (
    <section id="goal-linked-work" className="flex flex-col gap-4 rounded-lg border border-line bg-raised p-6" aria-labelledby="goal-linked-h">
      <h2 id="goal-linked-h" className="m-0 text-base font-semibold text-ink">Linked work</h2>
      <LinkRow
        kind="KRA"
        title="KRAs"
        kindLabel="KRA"
        Icon={Target}
        okrId={okrId}
        items={kras}
        canEdit={canEdit}
        onReload={load}
        emptyHint="Nothing linked yet"
        loadCandidates={async () => {
          const res = await fetch("/api/kras?limit=200");
          const data = await res.json().catch(() => ({}));
          const list: Array<{ id: string; name: string; category?: string | null }> = data?.data ?? [];
          return list.map((k) => ({ id: k.id, title: k.name, subtitle: k.category ?? null }));
        }}
        fallbackHref={() => "/kra-kpi"}
      />
      <LinkRow
        kind="SPACE"
        title="Spaces"
        kindLabel="Space"
        Icon={Boxes}
        okrId={okrId}
        items={spaces}
        canEdit={canEdit}
        onReload={load}
        emptyHint="Nothing linked yet"
        loadCandidates={async () => {
          const res = await fetch("/api/spaces");
          const data = await res.json().catch(() => ({}));
          const list: Array<{ id: string; name: string; slug: string }> = data?.spaces ?? [];
          return list.map((s) => ({ id: s.id, title: s.name, subtitle: `/spaces/${s.slug}` }));
        }}
        fallbackHref={(id) => `/spaces/${id}`}
      />
      <LinkRow
        kind="BOARD"
        title="Lists"
        kindLabel="List"
        Icon={FolderKanban}
        okrId={okrId}
        items={boards}
        canEdit={canEdit}
        onReload={load}
        emptyHint="Nothing linked yet"
        loadCandidates={async () => {
          const res = await fetch("/api/boards?all=1");
          const data = await res.json().catch(() => ({}));
          const list: Array<{ id: string; name: string; slug: string }> = data?.boards ?? [];
          return list.map((b) => ({ id: b.id, title: b.name, subtitle: `/boards/${b.slug}` }));
        }}
        fallbackHref={(id) => `/boards/${id}`}
      />
      <LinkRow
        kind="WHITEBOARD"
        title="Canvases"
        kindLabel="Canvas"
        Icon={Frame}
        okrId={okrId}
        items={canvases}
        canEdit={canEdit}
        onReload={load}
        emptyHint="Nothing linked yet"
        loadCandidates={async () => {
          const res = await fetch("/api/whiteboards");
          const data = await res.json().catch(() => ({}));
          const list: Array<{ id: string; name: string; description?: string | null }> = data?.whiteboards ?? [];
          return list.map((w) => ({ id: w.id, title: w.name, subtitle: w.description ?? null }));
        }}
        fallbackHref={(id) => `/canvas/${id}`}
      />
    </section>
  );
}

function LinkRow({
  kind, title, kindLabel, Icon, okrId, items, canEdit, onReload, emptyHint, loadCandidates, fallbackHref,
}: {
  kind: Kind;
  title: string;
  /** Explicit singular label for the picker; defaults to the title minus a trailing "s". */
  kindLabel?: string;
  Icon: typeof Boxes;
  okrId: string;
  items: HydratedLink[] | null;
  canEdit: boolean;
  onReload: () => void;
  emptyHint: string;
  loadCandidates: () => Promise<Array<{ id: string; title: string; subtitle?: string | null }>>;
  fallbackHref: (id: string) => string;
}) {
  const router = useRouter();
  const { toast } = useOsToast();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const linkedIds = useMemo(() => (items ?? []).map((i) => i.targetId), [items]);

  const pick = async (candidate: { id: string }) => {
    setBusy(true);
    try {
      const res = await fetch("/api/entity-links", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: { type: "OKR", id: okrId }, target: { type: kind, id: candidate.id } }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast(d?.error ?? "Couldn't link it", { tone: "danger" });
      }
      onReload();
      router.refresh();
    } catch {
      toast("Couldn't link it", { tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (linkId: string) => {
    const res = await fetch(`/api/entity-links/${linkId}`, { method: "DELETE" }).catch(() => null);
    if (!res || !res.ok) toast("Couldn't remove the link", { tone: "danger" });
    onReload();
    router.refresh();
  };

  return (
    <div>
      <div className="relative flex items-center justify-between">
        <h3 className="m-0 flex items-center gap-1.5 text-sm font-medium text-ink-2">
          <Icon className="h-4 w-4" aria-hidden />
          {title}
          {items && items.length ? <span className="text-xs text-ink-3">{items.length}</span> : null}
        </h3>
        {canEdit ? (
          <div className="relative flex items-center">
            <button
              type="button"
              onClick={() => setPickerOpen((v) => !v)}
              disabled={busy}
              className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-50"
            >
              <Plus className="h-4 w-4" aria-hidden /> Link {kindLabel ?? title.toLowerCase().replace(/s$/, "")}
            </button>
            <LinkExistingPicker
              open={pickerOpen}
              onClose={() => setPickerOpen(false)}
              kindLabel={kindLabel ?? title.toLowerCase().replace(/s$/, "")}
              loadCandidates={loadCandidates}
              excludeIds={linkedIds}
              onPick={pick}
            />
          </div>
        ) : null}
      </div>
      {items === null ? (
        <span className="mt-1 block h-5 w-1/3 animate-pulse rounded bg-surface-2" aria-hidden />
      ) : items.length === 0 ? (
        <p className="m-0 mt-1 text-sm text-ink-3">{emptyHint}</p>
      ) : (
        <ul className="m-0 mt-1 flex list-none flex-col p-0">
          {items.map((it) => {
            const href = it.target?.href ?? fallbackHref(it.targetId);
            return (
              <li key={it.id} className="group flex h-9 items-center gap-2 border-b border-line last:border-b-0">
                <button
                  type="button"
                  onClick={() => router.push(sectionHrefNow(href))}
                  className="min-w-0 flex-1 truncate text-start text-row text-ink hover:underline"
                >
                  {it.target?.title ?? "Untitled"}
                  {it.target?.subtitle ? <span className="ms-2 text-xs text-ink-2">{it.target.subtitle}</span> : null}
                </button>
                {canEdit ? (
                  <button
                    type="button"
                    onClick={() => void remove(it.id)}
                    aria-label={`Unlink ${it.target?.title ?? "this"}`}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-2 opacity-0 hover:bg-hover hover:text-ink focus:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
