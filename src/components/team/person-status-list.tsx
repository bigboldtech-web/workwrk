"use client";

// PersonStatusList (spec-goals section 3): the 360px people list of a
// manager's split page (KPI reviews; offered to the weekly queue). One line
// per person: a 24px avatar, the name, one pale status chip at the right.
// The job title and department live in the row's tooltip. Optional section
// labels ("Needs you", "Done") split the list. ↑ ↓ move the selection,
// Enter asks the page to focus its first input.

import { useRef, type KeyboardEvent } from "react";
import { Avatar } from "@/components/ui/avatar-stack";
import { ToneChip } from "@/components/people/person-bits";
import { cn } from "@/lib/utils";

export interface PersonStatusItem {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  avatar: string | null;
  /** "Sales Rep · Marketing": the tooltip. */
  title?: string;
  chip: { label: string; tone: "success" | "warning" | "danger" | "neutral" };
  /** Dim the name (a person with no KPIs). */
  muted?: boolean;
}

const nameOf = (p: PersonStatusItem) => `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.email;

export function PersonStatusList({ people, selectedId, onSelect, onEnter, sections, ariaLabel = "People" }: {
  people: PersonStatusItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onEnter?: () => void;
  sections?: Array<{ label: string; ids: string[] }>;
  ariaLabel?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const order = sections ? sections.flatMap((s) => s.ids) : people.map((p) => p.id);
  const byId = new Map(people.map((p) => [p.id, p]));

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Enter") return;
    e.preventDefault();
    if (e.key === "Enter") { onEnter?.(); return; }
    const i = selectedId ? order.indexOf(selectedId) : -1;
    const next = e.key === "ArrowDown" ? Math.min(order.length - 1, i + 1) : Math.max(0, i - 1);
    const id = order[next];
    if (id) {
      onSelect(id);
      listRef.current?.querySelector<HTMLElement>(`[data-person="${id}"]`)?.focus();
    }
  };

  const row = (p: PersonStatusItem) => (
    <button
      key={p.id}
      type="button"
      role="option"
      aria-selected={p.id === selectedId}
      data-person={p.id}
      tabIndex={p.id === selectedId || (!selectedId && p.id === order[0]) ? 0 : -1}
      title={p.title}
      onClick={() => onSelect(p.id)}
      className={cn(
        "os-row flex h-[var(--os-row-h,44px)] w-full items-center gap-2 px-3 text-start outline-none focus-visible:ring-2 focus-visible:ring-[var(--os-focus)]/60",
        p.id === selectedId ? "bg-[var(--os-selected)]" : "hover:bg-hover",
      )}
    >
      <Avatar person={p} size={24} />
      <span className={cn("min-w-0 flex-1 truncate text-row", p.id === selectedId ? "font-medium text-ink" : p.muted ? "text-ink-2" : "text-ink")}>{nameOf(p)}</span>
      <span className="shrink-0"><ToneChip tone={p.chip.tone} label={p.chip.label} /></span>
    </button>
  );

  return (
    <div ref={listRef} role="listbox" aria-label={ariaLabel} onKeyDown={onKey} className="flex flex-col">
      {sections
        ? sections.filter((s) => s.ids.length).map((s) => (
          <div key={s.label} className="flex flex-col">
            <div className="flex items-center gap-2 px-3 pb-1 pt-3 text-micro font-semibold uppercase tracking-wide text-ink-2">
              {s.label}<span className="h-px flex-1 bg-line" aria-hidden />
            </div>
            {s.ids.map((id) => byId.get(id)).filter((p): p is PersonStatusItem => !!p).map(row)}
          </div>
        ))
        : people.map(row)}
    </div>
  );
}
