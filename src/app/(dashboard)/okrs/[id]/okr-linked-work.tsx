"use client";

// Linked work card on the goal page (spec-goals /okrs/[id] body 5): the
// KRAs, Spaces, Lists and canvases that move this goal, linked through
// EntityLink. The Effort card and the verdict read these links (hours and
// tasks from the linked work), so a link is how work counts toward a goal.
//
// ONE list, 36px rows: a small neutral EntityTile, the name and a kind
// label ("List", "KRA in Sales"); one "+ Link work" button that asks which
// kind, then opens the LinkExistingPicker for it. Names and hrefs come
// hydrated from /api/entity-links. Adds and removes check the response and
// say so when one fails; nothing is shown as linked that is not. Every kind
// the old four-section card could link, open and unlink is kept.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Boxes, FolderKanban, Target, Plus, X, Frame } from "lucide-react";
import { useOsToast } from "@/components/layout/os/toast";
import { LinkExistingPicker } from "@/components/board-view/link-existing-picker";
import { sectionHrefNow } from "@/components/layout/os/use-object-href";
import { EntityTile, NEUTRAL_TILE } from "@/components/ui/entity-tile";
import { MenuItem, MenuList } from "@/components/ui/menu";

interface HydratedLink {
  id: string;
  targetId: string;
  target?: { title: string | null; subtitle?: string | null; href?: string | null };
}

type Kind = "KRA" | "SPACE" | "BOARD" | "WHITEBOARD";
type Candidate = { id: string; title: string; subtitle?: string | null };

const KINDS: Array<{
  kind: Kind;
  label: string;
  Icon: typeof Boxes;
  fallbackHref: (id: string) => string;
  loadCandidates: () => Promise<Candidate[]>;
}> = [
  {
    kind: "KRA", label: "KRA", Icon: Target, fallbackHref: () => "/kra-kpi",
    loadCandidates: async () => {
      const res = await fetch("/api/kras?limit=200");
      const data = await res.json().catch(() => ({}));
      const list: Array<{ id: string; name: string; category?: string | null }> = data?.data ?? [];
      return list.map((k) => ({ id: k.id, title: k.name, subtitle: k.category ?? null }));
    },
  },
  {
    kind: "SPACE", label: "Space", Icon: Boxes, fallbackHref: (id) => `/spaces/${id}`,
    loadCandidates: async () => {
      const res = await fetch("/api/spaces");
      const data = await res.json().catch(() => ({}));
      const list: Array<{ id: string; name: string; slug: string }> = data?.spaces ?? [];
      return list.map((s) => ({ id: s.id, title: s.name, subtitle: `/spaces/${s.slug}` }));
    },
  },
  {
    kind: "BOARD", label: "List", Icon: FolderKanban, fallbackHref: (id) => `/boards/${id}`,
    loadCandidates: async () => {
      const res = await fetch("/api/boards?all=1");
      const data = await res.json().catch(() => ({}));
      const list: Array<{ id: string; name: string; slug: string }> = data?.boards ?? [];
      return list.map((b) => ({ id: b.id, title: b.name, subtitle: `/boards/${b.slug}` }));
    },
  },
  {
    kind: "WHITEBOARD", label: "Canvas", Icon: Frame, fallbackHref: (id) => `/canvas/${id}`,
    loadCandidates: async () => {
      const res = await fetch("/api/whiteboards");
      const data = await res.json().catch(() => ({}));
      const list: Array<{ id: string; name: string; description?: string | null }> = data?.whiteboards ?? [];
      return list.map((w) => ({ id: w.id, title: w.name, subtitle: w.description ?? null }));
    },
  },
];

/** The kind label on a row: "KRA in Sales" when the KRA has a category. */
function kindText(kind: Kind, link: HydratedLink): string {
  const k = KINDS.find((x) => x.kind === kind)!;
  if (kind === "KRA" && link.target?.subtitle) return `KRA in ${link.target.subtitle}`;
  return k.label;
}

export function OkrLinkedWork({ okrId, canEdit }: { okrId: string; canEdit: boolean }) {
  const router = useRouter();
  const { toast } = useOsToast();
  const [links, setLinks] = useState<Record<Kind, HydratedLink[]> | null>(null);
  const [kindMenu, setKindMenu] = useState(false);
  const [pickerKind, setPickerKind] = useState<Kind | null>(null);
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    Promise.all(
      KINDS.map((k) =>
        fetch(`/api/entity-links?sourceType=OKR&sourceId=${okrId}&filterTargetType=${k.kind}`)
          .then((r) => r.json())
          .catch(() => ({ links: [] })),
      ),
    ).then((res) => {
      const next = {} as Record<Kind, HydratedLink[]>;
      KINDS.forEach((k, i) => { next[k.kind] = (res[i] as { links?: HydratedLink[] }).links ?? []; });
      setLinks(next);
    });
  }, [okrId]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!kindMenu) return;
    const onDown = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setKindMenu(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setKindMenu(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [kindMenu]);

  const rows = useMemo(
    () => (links ? KINDS.flatMap((k) => links[k.kind].map((l) => ({ kind: k.kind, link: l }))) : null),
    [links],
  );

  const pick = async (kind: Kind, candidate: { id: string }) => {
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
      load();
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
    load();
    router.refresh();
  };

  const picker = pickerKind ? KINDS.find((k) => k.kind === pickerKind)! : null;

  return (
    <section id="goal-linked-work" className="flex flex-col rounded-lg border border-line bg-raised p-6" aria-labelledby="goal-linked-h">
      <div className="flex items-center justify-between">
        <h2 id="goal-linked-h" className="m-0 flex items-baseline gap-2 text-base font-semibold text-ink">
          Linked work
          {rows && rows.length ? <span className="text-xs font-medium text-ink-2">{rows.length}</span> : null}
        </h2>
        {canEdit ? (
          <div className="relative flex items-center" ref={menuRef}>
            <button
              type="button"
              onClick={() => { setPickerKind(null); setKindMenu((v) => !v); }}
              disabled={busy}
              aria-haspopup="menu"
              aria-expanded={kindMenu}
              className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-50"
            >
              <Plus className="h-4 w-4" aria-hidden /> Link work
            </button>
            {kindMenu ? (
              <div className="absolute end-0 top-8 z-[80]">
                <MenuList aria-label="Link which kind of work" className="w-[200px]">
                  {KINDS.map((k) => (
                    <MenuItem key={k.kind} icon={k.Icon} label={k.label} onClick={() => { setKindMenu(false); setPickerKind(k.kind); }} />
                  ))}
                </MenuList>
              </div>
            ) : null}
            {picker ? (
              <LinkExistingPicker
                open
                onClose={() => setPickerKind(null)}
                kindLabel={picker.label.toLowerCase()}
                loadCandidates={picker.loadCandidates}
                excludeIds={(links?.[picker.kind] ?? []).map((l) => l.targetId)}
                onPick={(c) => pick(picker.kind, c)}
              />
            ) : null}
          </div>
        ) : null}
      </div>
      {rows === null ? (
        <span className="mt-2 block h-5 w-1/3 rounded bg-skeleton os-skeleton-pulse" aria-hidden />
      ) : rows.length === 0 ? (
        <p className="m-0 mt-2 text-sm text-ink-2">Nothing linked yet</p>
      ) : (
        <ul className="m-0 mt-2 flex list-none flex-col p-0">
          {rows.map(({ kind, link }) => {
            const k = KINDS.find((x) => x.kind === kind)!;
            const href = link.target?.href ?? k.fallbackHref(link.targetId);
            const name = link.target?.title ?? "Untitled";
            return (
              <li key={link.id} className="group flex h-9 items-center gap-2 border-b border-line-soft last:border-b-0">
                <button
                  type="button"
                  onClick={() => router.push(sectionHrefNow(href))}
                  className="flex min-w-0 flex-1 items-center gap-2 text-start text-row text-ink"
                >
                  <EntityTile size="sm" fallbackIcon={k.Icon} name={name} color={NEUTRAL_TILE.color} className={NEUTRAL_TILE.className} />
                  <span className="min-w-0 truncate hover:underline">{name}</span>
                  <span className="shrink-0 text-xs text-ink-2">{kindText(kind, link)}</span>
                </button>
                {canEdit ? (
                  <button
                    type="button"
                    onClick={() => void remove(link.id)}
                    aria-label={`Unlink ${name}`}
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
    </section>
  );
}
