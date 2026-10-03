"use client";

// The one "Filter by a person" control on the hubs (Docs, Tables, Canvas,
// Forms, SOPs, Files, Process runs): a button naming the chosen person and a
// Picker over the whole company, searched as the person types. Each hub
// used to load /api/users?scope=all, so an Employee could filter only by
// themselves. reach "all": the Owner, an Admin and the People team also find
// someone who left, to see what they owned; everyone else finds everyone
// who can sign in.

import { Picker, type PickerOption } from "@/components/ui/picker";
import { PersonAvatar } from "@/components/board-view/assignee-picker";
import { usePeoplePicker } from "@/components/people/use-people-picker";
import { pickPersonName } from "@/lib/people-pick";

export function PersonFilterPick({
  value,
  onChange,
  open,
  setOpen,
  ariaLabel,
  placeholder = "Choose a person",
}: {
  value: string | null;
  onChange: (id: string) => void;
  open: boolean;
  setOpen: (v: boolean) => void;
  ariaLabel: string;
  placeholder?: string;
}) {
  const picker = usePeoplePicker({ enabled: open, reach: "all", named: value ? [value] : [] });
  const current = value ? picker.person(value) : undefined;
  const options: PickerOption[] = picker.people.map((p) => ({
    value: p.id,
    label: pickPersonName(p),
    description: p.email ?? undefined,
    glyph: <PersonAvatar person={p} size={20} />,
  }));
  return (
    <span className="relative block">
      <button type="button" onClick={() => setOpen(!open)} className="inline-flex h-8 max-w-full items-center gap-2 rounded-md border border-line-strong bg-raised px-2 text-sm text-ink">
        {current ? (
          <>
            <PersonAvatar person={current} size={20} />
            <span className="min-w-0 truncate">{pickPersonName(current)}</span>
          </>
        ) : value ? (
          <span className="min-w-0 truncate text-ink-2">{picker.nameOf(value)}</span>
        ) : (
          <span className="text-ink-3">{placeholder}</span>
        )}
      </button>
      <Picker
        open={open}
        onClose={() => setOpen(false)}
        ariaLabel={ariaLabel}
        searchPlaceholder="Find a person"
        alwaysSearch
        onSearchChange={picker.setQuery}
        loading={picker.loading && options.length === 0}
        emptyLabel={picker.query.trim() ? "No one matches" : "No one to show yet"}
        selected={value}
        onSelect={(v) => {
          onChange(v);
          setOpen(false);
        }}
        sections={[{ options }]}
      />
    </span>
  );
}
