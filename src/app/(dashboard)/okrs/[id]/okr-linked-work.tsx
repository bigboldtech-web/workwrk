"use client";

// OkrLinkedWork — attach existing Spaces & Boards (the "projects" that
// move an objective) to an OKR via EntityLink. Link-only by design:
// progress still comes from manual KR check-ins (no auto-rollup). Reuses
// the generic LinkExistingPicker; hydration (name + href) comes from
// /api/entity-links so we don't re-fetch per row.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Boxes, FolderKanban, Target, Link2, Plus, X, ExternalLink, Loader2 } from "lucide-react";
import { LinkExistingPicker } from "@/components/board-view/link-existing-picker";

interface HydratedLink {
  id: string;
  targetId: string;
  target?: { title: string | null; subtitle?: string | null; href?: string | null };
}

type Kind = "SPACE" | "BOARD" | "KRA";

export function OkrLinkedWork({ okrId, canEdit }: { okrId: string; canEdit: boolean }) {
  const [spaces, setSpaces] = useState<HydratedLink[] | null>(null);
  const [boards, setBoards] = useState<HydratedLink[] | null>(null);
  const [kras, setKras] = useState<HydratedLink[] | null>(null);

  const load = useCallback(() => {
    Promise.all([
      fetch(`/api/entity-links?sourceType=OKR&sourceId=${okrId}&filterTargetType=SPACE`).then((r) => r.json()).catch(() => ({ links: [] })),
      fetch(`/api/entity-links?sourceType=OKR&sourceId=${okrId}&filterTargetType=BOARD`).then((r) => r.json()).catch(() => ({ links: [] })),
      fetch(`/api/entity-links?sourceType=OKR&sourceId=${okrId}&filterTargetType=KRA`).then((r) => r.json()).catch(() => ({ links: [] })),
    ]).then(([sp, bd, kr]) => {
      setSpaces(sp.links ?? []);
      setBoards(bd.links ?? []);
      setKras(kr.links ?? []);
    });
  }, [okrId]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <LinkRow
        kind="KRA"
        title="KRAs"
        Icon={Target}
        okrId={okrId}
        items={kras}
        canEdit={canEdit}
        onReload={load}
        emptyHint="Link the KRAs (key result areas) whose work drives this objective."
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
        Icon={Boxes}
        okrId={okrId}
        items={spaces}
        canEdit={canEdit}
        onReload={load}
        emptyHint="Link a Space this objective drives — its boards, docs and tasks live there."
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
        title="Boards"
        Icon={FolderKanban}
        okrId={okrId}
        items={boards}
        canEdit={canEdit}
        onReload={load}
        emptyHint="Link a Board (project/sprint) whose work ladders up to this objective."
        loadCandidates={async () => {
          const res = await fetch("/api/boards?all=1");
          const data = await res.json().catch(() => ({}));
          const list: Array<{ id: string; name: string; slug: string }> = data?.boards ?? [];
          return list.map((b) => ({ id: b.id, title: b.name, subtitle: `/boards/${b.slug}` }));
        }}
        fallbackHref={(id) => `/boards/${id}`}
      />
    </div>
  );
}

function LinkRow({
  kind, title, Icon, okrId, items, canEdit, onReload, emptyHint, loadCandidates, fallbackHref,
}: {
  kind: Kind;
  title: string;
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
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const linkedIds = useMemo(() => (items ?? []).map((i) => i.targetId), [items]);

  const pick = async (candidate: { id: string }) => {
    setBusy(true);
    try {
      await fetch("/api/entity-links", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: { type: "OKR", id: okrId }, target: { type: kind, id: candidate.id } }),
      });
      onReload();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (linkId: string) => {
    await fetch(`/api/entity-links/${linkId}`, { method: "DELETE" });
    onReload();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2 relative">
        <h3 className="text-xs uppercase tracking-wide text-zinc-500 flex items-center gap-1.5">
          <Icon className="h-3 w-3" />
          {title}
          {items ? <span className="text-zinc-400 normal-case font-normal">· {items.length}</span> : null}
        </h3>
        {canEdit ? (
          <div className="relative flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPickerOpen((v) => !v)}
              disabled={busy}
              className="text-[11px] text-zinc-500 hover:text-zinc-900 inline-flex items-center gap-1 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />}
              Link
            </button>
            <LinkExistingPicker
              open={pickerOpen}
              onClose={() => setPickerOpen(false)}
              kindLabel={title.toLowerCase().replace(/s$/, "")}
              loadCandidates={loadCandidates}
              excludeIds={linkedIds}
              onPick={pick}
            />
          </div>
        ) : null}
      </div>

      {items === null ? (
        <div className="text-xs text-zinc-400">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-xs text-zinc-400 leading-relaxed">{emptyHint}</div>
      ) : (
        <ul className="space-y-1.5">
          {items.map((it) => {
            const href = it.target?.href ?? fallbackHref(it.targetId);
            return (
              <li key={it.id} className="group flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 hover:bg-zinc-50">
                <Icon className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                <button
                  type="button"
                  onClick={() => router.push(href)}
                  className="flex-1 min-w-0 text-left text-sm font-medium truncate hover:text-zinc-700"
                >
                  {it.target?.title || "Untitled"}
                </button>
                <button
                  type="button"
                  onClick={() => router.push(href)}
                  className="opacity-0 group-hover:opacity-100 h-6 w-6 rounded hover:bg-zinc-100 inline-flex items-center justify-center text-zinc-400"
                  aria-label="Open"
                >
                  <ExternalLink className="h-3 w-3" />
                </button>
                {canEdit ? (
                  <button
                    type="button"
                    onClick={() => void remove(it.id)}
                    className="opacity-0 group-hover:opacity-100 h-6 w-6 rounded hover:bg-red-50 inline-flex items-center justify-center text-zinc-400 hover:text-red-500"
                    aria-label="Remove link"
                  >
                    <X className="h-3 w-3" />
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
