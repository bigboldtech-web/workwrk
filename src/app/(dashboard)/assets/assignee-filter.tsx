"use client";

// The "Assigned to" filter group on /assets (spec-tools-misc 2.2): a people
// picker over GET /api/people/pick?q=, the same read every people picker
// uses, so a person with nothing on the current page can still be filtered
// for. The chosen person is always the first row, checked, even when the
// search no longer matches them.

import { useEffect, useState } from "react";
import { FilterGroup, FilterRow } from "@/components/ui/filter-panel";
import { apiFetch } from "@/lib/api-fetch";
import { personName } from "@/lib/assets/asset-view";

type Person = { id: string; firstName: string | null; lastName: string | null; email: string | null };

export function AssigneeFilterGroup({ value, valueName, onChange }: {
  /** The selected user id, "unassigned", or "". */
  value: string;
  /** The selected person's name when the page already knows it. */
  valueName: string | null;
  onChange: (next: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const t = setTimeout(async () => {
      const r = await apiFetch<{ people: Person[] }>(`/api/people/pick?q=${encodeURIComponent(query)}`, { cache: "no-store" });
      if (!r.ok) { setFailed(true); return; }
      setFailed(false);
      setPeople(r.data.people.slice(0, 8));
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  const selected = value && value !== "unassigned" ? value : null;
  const selectedPerson = selected ? people.find((p) => p.id === selected) : null;
  const selectedLabel = selectedPerson ? personName(selectedPerson) || selectedPerson.email || "Someone" : valueName || "Selected person";
  const rows = people.filter((p) => p.id !== selected);

  return (
    <FilterGroup label="Assigned to">
      <li className="px-2 pb-1">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search people"
          aria-label="Search people to filter by"
          className="h-8 w-full rounded-md border border-line-strong bg-raised px-2 text-sm text-ink placeholder:text-ink-3"
        />
      </li>
      <FilterRow label="Unassigned" checked={value === "unassigned"} onCheckedChange={(on) => onChange(on ? "unassigned" : null)} />
      {selected ? <FilterRow label={selectedLabel} checked onCheckedChange={() => onChange(null)} /> : null}
      {rows.map((p) => (
        <FilterRow key={p.id} label={personName(p) || p.email || "Someone"} checked={false} onCheckedChange={(on) => onChange(on ? p.id : null)} />
      ))}
      {failed ? <li className="px-2 py-1 text-sm text-ink-2">Couldn&apos;t load people.</li> : null}
      {!failed && rows.length === 0 && !selected ? <li className="px-2 py-1 text-sm text-ink-3">No one matches.</li> : null}
    </FilterGroup>
  );
}
