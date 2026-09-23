"use client";

// The ONE people picker Talk uses, shared by New message and Add people.
//
// Before this there were two, and they were the same 40 lines twice: a
// debounced GET /api/users?scope=all&limit=20[&search=], a chip row, a
// candidate list, an excluded set. They had already drifted (one showed the
// person's role title, the other did not) and any fix had to be made twice.
//
// It reads `GET /api/people/pick`, the narrow org-scoped read the access spec
// names. NOT `/api/users?scope=all`, which the old inline pickers used: that
// endpoint team-scopes anybody below an org-wide level, so New message listed
// exactly ONE person, the person using it. A picker that can only pick you is
// not a picker, and it was the same endpoint behind the assignee picker bug.

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { TeamAvatar } from "@/components/team/ui";

export type PersonRow = {
  id: string;
  firstName: string;
  lastName: string;
  avatar?: string | null;
  email?: string;
  role?: { title: string } | null;
};

export function personLabel(p: PersonRow): string {
  return `${p.firstName} ${p.lastName}`.trim() || p.email || "Someone";
}

export function PeoplePicker({
  excludeIds = [],
  picked,
  onChange,
  placeholder = "Search people",
  autoFocus = true,
  emptyLabel = "Nobody matched",
}: {
  excludeIds?: string[];
  picked: PersonRow[];
  onChange: (next: PersonRow[]) => void;
  placeholder?: string;
  autoFocus?: boolean;
  emptyLabel?: string;
}) {
  const [search, setSearch] = useState("");
  const [people, setPeople] = useState<PersonRow[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (autoFocus) inputRef.current?.focus(); }, [autoFocus]);

  useEffect(() => {
    let active = true;
    const t = setTimeout(() => {
      const params = new URLSearchParams({ limit: "20" });
      if (search.trim()) params.set("q", search.trim());
      fetch(`/api/people/pick?${params}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { people: [] }))
        .then((d) => { if (active) setPeople(Array.isArray(d?.people) ? d.people : []); })
        .catch(() => { if (active) setPeople([]); });
    }, 200);
    return () => { active = false; clearTimeout(t); };
  }, [search]);

  const excluded = useMemo(
    () => new Set([...excludeIds, ...picked.map((p) => p.id)]),
    [excludeIds, picked],
  );
  const candidates = (people ?? []).filter((p) => !excluded.has(p.id));

  const toggle = (p: PersonRow) => {
    onChange(picked.some((x) => x.id === p.id) ? picked.filter((x) => x.id !== p.id) : [...picked, p]);
  };

  return (
    <div>
      {picked.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {picked.map((p) => (
            <span key={p.id} className="inline-flex h-7 items-center gap-1.5 rounded-full bg-hover ps-1 pe-1.5 text-sm text-ink">
              <TeamAvatar name={personLabel(p)} avatar={p.avatar} size={20} />
              <span className="max-w-[160px] truncate">{personLabel(p)}</span>
              <button type="button" onClick={() => toggle(p)} aria-label={`Remove ${personLabel(p)}`} className="text-ink-3 hover:text-ink">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex h-9 items-center gap-2 rounded-md border border-line bg-app px-2">
        <Search className="h-3.5 w-3.5 shrink-0 text-ink-3" aria-hidden />
        <input
          ref={inputRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="h-full w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
        />
      </div>

      <ul className="m-0 mt-2 max-h-[240px] list-none overflow-y-auto p-0">
        {people === null ? null : candidates.length === 0 ? (
          <li className="px-1 py-3 text-sm text-ink-2">{emptyLabel}</li>
        ) : (
          candidates.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => toggle(p)}
                className="flex h-9 w-full items-center gap-2 rounded-md px-1.5 text-start hover:bg-hover"
              >
                <TeamAvatar name={personLabel(p)} avatar={p.avatar} size={24} />
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{personLabel(p)}</span>
                {p.role?.title ? <span className="shrink-0 truncate text-xs text-ink-2">{p.role.title}</span> : null}
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
