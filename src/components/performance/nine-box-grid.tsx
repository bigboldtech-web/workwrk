"use client";

// NineBoxGrid (spec-teams-performance section 3): the talent grid, neutral
// in every cell (no hue per box: design-system 1.4 rule 7). X is
// performance (Low to High, left to right), Y is potential (Low to High,
// bottom to top). Each cell carries its fixed label, the long description,
// the count and up to five avatars with a "+N" chip. The one place colour
// appears is a 6px dot beside the count: success for top talent, danger for
// needs attention, both named in the legend so colour never travels alone.
// Arrow keys move between cells, Enter selects. `size="mini"` is the Place
// person modal's picker (labels only, no people).

import { useRef, type KeyboardEvent } from "react";
import { Avatar } from "@/components/ui/avatar-stack";
import { ATTENTION_BOXES, BOX_LABELS, GRID_ROWS, TOP_BOXES, boxDescription, type BoxKey } from "@/lib/performance/talent";
import { cn } from "@/lib/utils";

export type GridPerson = { id: string; firstName?: string | null; lastName?: string | null; avatar?: string | null };

export function NineBoxGrid({
  cells,
  selected,
  onSelect,
  size = "full",
  readOnly = false,
}: {
  cells: Partial<Record<BoxKey, GridPerson[]>>;
  selected?: BoxKey | null;
  onSelect?: (key: BoxKey) => void;
  size?: "full" | "mini";
  readOnly?: boolean;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const flat = GRID_ROWS.flat();
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, key: BoxKey) => {
    const i = flat.indexOf(key);
    const r = Math.floor(i / 3);
    const c = i % 3;
    let next: number | null = null;
    if (e.key === "ArrowRight" && c < 2) next = i + 1;
    if (e.key === "ArrowLeft" && c > 0) next = i - 1;
    if (e.key === "ArrowUp" && r > 0) next = i - 3;
    if (e.key === "ArrowDown" && r < 2) next = i + 3;
    if (next != null) { e.preventDefault(); refs.current[flat[next]]?.focus(); }
  };
  const mini = size === "mini";
  const levels = ["High", "Medium", "Low"];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <div className="flex w-5 shrink-0 flex-col items-center justify-center">
          <span className="whitespace-nowrap text-micro font-semibold uppercase tracking-[0.06em] text-ink-2 [writing-mode:vertical-rl] rotate-180">Potential</span>
        </div>
        {!mini ? (
          <div className="grid shrink-0 grid-rows-3 text-sm text-ink-2" aria-hidden>
            {levels.map((l) => <span key={l} className="flex items-center pe-2">{l}</span>)}
          </div>
        ) : null}
        <div role="grid" aria-label="Talent grid" className={cn("grid min-w-0 flex-1 grid-cols-3 gap-px overflow-hidden rounded-lg border border-line bg-[var(--os-line-soft)]", mini ? "max-w-[360px]" : "max-w-[900px]")}>
          {GRID_ROWS.map((row, ri) => row.map((key) => {
            const people = cells[key] ?? [];
            const on = selected === key;
            const dot = TOP_BOXES.includes(key) ? "bg-[var(--os-success-solid)]" : ATTENTION_BOXES.includes(key) ? "bg-[var(--os-danger-solid)]" : null;
            return (
              <button
                key={key}
                ref={(el) => { refs.current[key] = el; }}
                type="button"
                role="gridcell"
                aria-rowindex={ri + 1}
                aria-selected={on}
                aria-label={`${BOX_LABELS[key]}, ${boxDescription(key)}${mini ? "" : `, ${people.length} ${people.length === 1 ? "person" : "people"}`}`}
                disabled={readOnly}
                onClick={() => onSelect?.(key)}
                onKeyDown={(e) => onKey(e, key)}
                className={cn(
                  "flex min-w-0 flex-col items-start gap-1 text-start outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--os-focus)]",
                  mini ? "min-h-16 p-2" : "min-h-[148px] p-3 max-md:min-h-0 max-md:aspect-square",
                  on ? "bg-[var(--os-selected)]" : "bg-raised hover:bg-hover",
                )}
              >
                <span className={cn("font-medium text-ink", mini ? "text-sm" : "text-row")}>{BOX_LABELS[key]}</span>
                <span className="text-xs text-ink-2">{boxDescription(key)}</span>
                {!mini ? (
                  <>
                    <span className="mt-1 flex items-center gap-1.5">
                      <span className="text-xl font-semibold leading-none tabular-nums text-ink">{people.length}</span>
                      {dot ? <span className={cn("h-1.5 w-1.5 rounded-full", dot)} aria-hidden /> : null}
                    </span>
                    {people.length ? (
                      <span className="mt-auto flex items-center gap-1">
                        {people.slice(0, 5).map((p) => <Avatar key={p.id} person={p} size={24} />)}
                        {people.length > 5 ? <span className="inline-flex h-6 items-center rounded-md border border-line bg-subtle px-1.5 text-xs font-medium text-ink-2">+{people.length - 5}</span> : null}
                      </span>
                    ) : null}
                  </>
                ) : null}
              </button>
            );
          }))}
        </div>
      </div>
      <div className={cn("flex items-center gap-2 text-sm text-ink-2", mini ? "ps-7" : "ps-[88px]")}>
        {!mini ? <span className="grid w-full max-w-[900px] grid-cols-3" aria-hidden>{["Low", "Medium", "High"].map((l) => <span key={l} className="text-center">{l}</span>)}</span> : null}
      </div>
      <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1", mini ? "ps-7" : "ps-[88px]")}>
        <span className="text-micro font-semibold uppercase tracking-[0.06em] text-ink-2">Performance</span>
        {!mini ? (
          <>
            <span className="flex items-center gap-1.5 text-sm text-ink-2"><span className="h-1.5 w-1.5 rounded-full bg-[var(--os-success-solid)]" aria-hidden />Top talent</span>
            <span className="flex items-center gap-1.5 text-sm text-ink-2"><span className="h-1.5 w-1.5 rounded-full bg-[var(--os-danger-solid)]" aria-hidden />Needs attention</span>
          </>
        ) : null}
      </div>
    </div>
  );
}
