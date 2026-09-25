"use client";

// A card's data source, inside the widget editor.
//
//   dashboard       All my Lists / A Space / Choose Lists
//   space-overview  This Space / Choose Lists (Lists inside this Space only):
//                   an Overview card counts its Space and nothing else, and
//                   the server refuses any other source on an Overview row
//
// Every List and Space named here comes from GET /api/boards?readable=1
// (readableListsUrl): Spaces the viewer reads in full, and Lists each checked
// with getBoardForReader, never ?all=1 or /api/spaces. The Lists picker is
// search-driven, and the chosen ids live in the editor's own state and are
// named through readableListsUrl({ ids }), so a selection is never limited
// to the page of results that happens to be loaded, and a save never drops a
// List the viewer can read.

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Picker, type PickerSectionDef } from "@/components/ui/picker";
import { EntityTile } from "@/components/ui/entity-tile";
import { groupReadableLists, readableListsUrl, type ReadableListRow, type ReadableListsResponse } from "@/lib/readable-lists";
import { MAX_WIDGET_LISTS, type WidgetSource } from "@/lib/dashboards/widgets";
import type { WidgetSurface } from "@/lib/dashboards/widget-kinds";
import { SettingsRow } from "./widget-registry";

type Mode = "all" | "space" | "lists";

async function readLists(url: string): Promise<ReadableListsResponse | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as ReadableListsResponse;
  } catch {
    return null;
  }
}

/** The names of chosen Lists, whatever page of search results is loaded. */
export function useListNames(ids: readonly string[]) {
  const [known, setKnown] = useState<Map<string, ReadableListRow>>(new Map());
  const key = ids.join(",");
  useEffect(() => {
    const missing = ids.filter((id) => !known.has(id));
    if (missing.length === 0) return;
    let live = true;
    void (async () => {
      const res = await readLists(readableListsUrl({ ids: missing }));
      if (!live || !res) return;
      setKnown((prev) => {
        const next = new Map(prev);
        for (const b of res.boards) next.set(b.id, b);
        return next;
      });
    })();
    return () => {
      live = false;
    };
    // `key` is the content of `ids`; `known` is read, not a trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const remember = (rows: readonly ReadableListRow[]) =>
    setKnown((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const b of rows) if (!next.has(b.id)) {
        next.set(b.id, b);
        changed = true;
      }
      return changed ? next : prev;
    });
  return { known, remember };
}

export function WidgetSourcePicker({
  surface,
  spaceId,
  source,
  onChange,
  locked,
}: {
  surface: WidgetSurface;
  /** The Overview's Space, on the space-overview surface. */
  spaceId?: string | null;
  source: WidgetSource;
  onChange: (next: WidgetSource) => void;
  /** A partly readable card keeps its kind of source (the server refuses another). */
  locked?: boolean;
}) {
  const overview = surface === "space-overview";
  const mode: Mode = source.kind;
  const [listsOpen, setListsOpen] = useState(false);
  const [spaceOpen, setSpaceOpen] = useState(false);
  const [q, setQ] = useState("");
  const [page, setPage] = useState<ReadableListsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const chosen = useMemo(() => (source.kind === "lists" ? source.listIds : []), [source]);
  const { known, remember } = useListNames(chosen);
  const seq = useRef(0);

  // The search page: on open and on every keystroke (debounced), never the
  // whole org, and only this Space's Lists on its Overview.
  useEffect(() => {
    // Also on mount of "A Space", so a stored Space is named before its
    // picker is ever opened.
    if (!listsOpen && !spaceOpen && !(mode === "space" && !overview && !page)) return;
    const n = ++seq.current;
    const t = setTimeout(() => {
      setLoading(true);
      void (async () => {
        const res = await readLists(readableListsUrl({ q, spaceId: overview ? spaceId ?? null : null }));
        if (n !== seq.current) return;
        setLoading(false);
        if (res) {
          setPage(res);
          remember(res.boards);
        }
      })();
    }, q ? 200 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listsOpen, spaceOpen, q, overview, spaceId, mode]);

  const modeOptions = overview
    ? [
        { value: "space" as Mode, label: "This Space" },
        { value: "lists" as Mode, label: "Choose Lists" },
      ]
    : [
        { value: "all" as Mode, label: "All my Lists" },
        { value: "space" as Mode, label: "A Space" },
        { value: "lists" as Mode, label: "Choose Lists" },
      ];

  const setMode = (m: Mode) => {
    if (locked || m === mode) return;
    if (m === "all") onChange({ kind: "all" });
    else if (m === "space") onChange({ kind: "space", spaceId: overview ? spaceId ?? "" : "" });
    else onChange({ kind: "lists", listIds: [] });
  };

  const listSections: PickerSectionDef[] = useMemo(() => {
    if (!page) return [];
    return groupReadableLists(page).map((g) => ({
      label: g.label,
      options: g.lists.map((b) => ({
        value: b.id,
        label: b.name,
        glyph: <EntityTile size="xs" icon={b.icon} color={b.color} name={b.name} fallback="list" />,
        disabled: !chosen.includes(b.id) && chosen.length >= MAX_WIDGET_LISTS,
      })),
    }));
  }, [page, chosen]);

  const spaces = page?.spaces ?? [];
  const spaceName = source.kind === "space" ? spaces.find((s) => s.id === source.spaceId)?.name : undefined;

  const toggleList = (id: string) => {
    const next = chosen.includes(id) ? chosen.filter((x) => x !== id) : chosen.length < MAX_WIDGET_LISTS ? [...chosen, id] : chosen;
    onChange({ kind: "lists", listIds: next });
  };

  return (
    <div className="flex flex-col gap-2">
      <SettingsRow label="Data source" stacked>
        {/* A partly shared card keeps the KIND of source it has: the server
            appends the Lists and rules this editor cannot see, and refuses
            a change of kind (source_locked). Which Lists it counts can still
            change, among the ones the editor can read. */}
        <SegmentedControl<Mode>
          size="sm"
          label="Data source"
          value={mode}
          onChange={setMode}
          options={modeOptions}
          locked={locked}
          lockedHint="Kept as it is"
        />
      </SettingsRow>

      {mode === "space" && !overview ? (
        <SettingsRow label="Space">
          <span className="relative inline-flex min-w-0 max-w-full">
            <button
              type="button"
              aria-haspopup="listbox"
              aria-expanded={spaceOpen}
              disabled={locked}
              onClick={() => setSpaceOpen((o) => !o)}
              className="inline-flex h-8 min-w-0 max-w-full items-center gap-1.5 rounded-md border border-line-strong bg-raised px-2.5 text-sm text-ink hover:bg-hover disabled:cursor-not-allowed disabled:text-ink-3 disabled:hover:bg-raised"
            >
              <span className="min-w-0 truncate">{source.kind === "space" && source.spaceId ? spaceName ?? "Space" : "Choose a Space"}</span>
            </button>
            <Picker
              open={spaceOpen}
              onClose={() => setSpaceOpen(false)}
              ariaLabel="Space"
              selected={source.kind === "space" ? source.spaceId : null}
              loading={loading && spaces.length === 0}
              emptyLabel="No Spaces you can read"
              sections={[{ options: spaces.map((s) => ({ value: s.id, label: s.name, glyph: <EntityTile size="xs" icon={s.icon} color={s.color} name={s.name} fallback="folder" /> })) }]}
              onSelect={(v) => {
                setSpaceOpen(false);
                onChange({ kind: "space", spaceId: v });
              }}
            />
          </span>
        </SettingsRow>
      ) : null}

      {mode === "lists" ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {chosen.map((id) => {
              const b = known.get(id);
              return (
                <span key={id} className="inline-flex h-7 max-w-[220px] items-center gap-1.5 rounded-md border border-line bg-subtle ps-1.5 pe-1 text-sm text-ink">
                  <EntityTile size="xs" icon={b?.icon ?? null} color={b?.color ?? null} name={b?.name ?? "List"} fallback="list" />
                  <span className="min-w-0 truncate">{b?.name ?? "List"}</span>
                  <button type="button" onClick={() => toggleList(id)} aria-label={`Remove ${b?.name ?? "List"}`} className="inline-flex h-5 w-5 items-center justify-center rounded text-ink-2 hover:bg-hover hover:text-ink">
                    <X className="h-3 w-3" strokeWidth={1.5} aria-hidden />
                  </button>
                </span>
              );
            })}
            {chosen.length < MAX_WIDGET_LISTS ? (
              <span className="relative inline-flex">
                <button
                  type="button"
                  aria-haspopup="listbox"
                  aria-expanded={listsOpen}
                  onClick={() => setListsOpen((o) => !o)}
                  disabled={chosen.length >= MAX_WIDGET_LISTS}
                  className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-sm font-medium text-ink-2 hover:bg-hover hover:text-ink disabled:text-ink-4"
                >
                  <Plus className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
                  {chosen.length ? "Add List" : "Choose Lists"}
                </button>
                <Picker
                  open={listsOpen}
                  onClose={() => {
                    setListsOpen(false);
                    setQ("");
                  }}
                  multi
                  alwaysSearch
                  ariaLabel="Lists"
                  searchPlaceholder="Search Lists"
                  selected={chosen}
                  onSearchChange={setQ}
                  loading={loading}
                  emptyLabel={q ? "No Lists match" : "No Lists you can read"}
                  sections={listSections}
                  width={300}
                  footer={page?.truncated ? <p className="m-0 px-2 py-1.5 text-xs text-ink-2">Type to find more Lists</p> : undefined}
                  onSelect={toggleList}
                />
              </span>
            ) : null}
          </div>
          {chosen.length === 0 ? <p className="m-0 text-xs text-ink-2">Pick at least one List.</p> : null}
          {chosen.length >= MAX_WIDGET_LISTS ? <p className="m-0 text-xs text-ink-2">A widget can use up to 50 Lists.</p> : null}
        </div>
      ) : null}
    </div>
  );
}
