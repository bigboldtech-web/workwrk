"use client";

// GoalOwnerPicker — the SINGLE accountable owner for a goal, mirroring
// ClickUp's create-goal "Owner" step ("Who is responsible for this
// Goal?"). Same person-row pattern as board-view/assignee-picker
// (debounced /api/users search, "Me" pinned first, Unassign) but with
// the modal-friendly full-width bordered trigger GoalAudiencePicker
// uses, so the two fields sit side by side in the goal modal without
// visual drift. Single select on purpose: one goal, one DRI —
// contributors are the separate GoalAudiencePicker field.

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { ChevronDown, Search, UserRound, UserX, X } from "lucide-react";
import { MenuItem, MenuSeparator } from "@/components/ui/menu";
import { PersonAvatar, type PersonRef } from "@/components/board-view/assignee-picker";

function personName(p: PersonRef): string {
  const n = `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim();
  return n || p.email || "Unknown";
}

interface GoalOwnerPickerProps {
  value: PersonRef | null;
  onChange: (person: PersonRef | null) => void;
  canEdit?: boolean;
  /** Open the popover as soon as the picker mounts (the "Assign owner"
   *  menu entry lands the user straight in the search). */
  initialOpen?: boolean;
}

export function GoalOwnerPicker({ value, onChange, canEdit = true, initialOpen = false }: GoalOwnerPickerProps) {
  const { data: session } = useSession();
  const [open, setOpen] = useState(initialOpen);
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<PersonRef[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const meId = (session?.user as { id?: string } | undefined)?.id ?? null;

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Debounced people search — same /api/users contract as the board's
  // assignee picker; "Me" pinned first when present.
  useEffect(() => {
    if (!open) return;
    let active = true;
    const t = setTimeout(() => {
      const params = new URLSearchParams({ scope: "all", limit: "20" });
      if (query.trim()) params.set("search", query.trim());
      fetch(`/api/users?${params}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { data: [] }))
        .then((d) => {
          if (!active) return;
          const rows: PersonRef[] = Array.isArray(d?.data) ? d.data : [];
          rows.sort((a, b) => Number(b.id === meId) - Number(a.id === meId));
          setPeople(rows);
        })
        .catch(() => { if (active) setPeople([]); });
    }, 250);
    return () => { active = false; clearTimeout(t); };
  }, [open, query, meId]);

  if (!canEdit) {
    return (
      <span className="text-[13.5px] text-zinc-500 truncate">
        {value ? personName(value) : "Unassigned"}
      </span>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="flex h-8 w-full items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2.5 text-left text-[13.5px] text-zinc-800 hover:border-zinc-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0073EA]/40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
        aria-label="Set goal owner"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {value ? (
          <PersonAvatar person={value} size={20} />
        ) : (
          <UserRound className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
        )}
        <span className={`flex-1 truncate ${value ? "" : "text-zinc-400"}`}>
          {value ? personName(value) : "Choose owner"}
        </span>
        <ChevronDown className="h-3 w-3 shrink-0 text-zinc-400" />
      </button>

      {open ? (
        // Absolute (not fixed): the goal modal centres its DialogContent with a
        // CSS transform, and a position:fixed child anchors to that transformed
        // box, not the viewport — which flung this popover off-screen (the
        // "owner/contributors don't work" bug). Absolute anchors to this
        // relative wrapper, so it stays put inside the dialog AND on the inline
        // goal-detail usage. Staying a DOM child also keeps the dialog's focus
        // trap + click-outside working (a body portal would break the search).
        <div
          className="absolute left-0 top-full z-[200] mt-1 w-[280px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex h-9 items-center gap-2 border-b border-zinc-100 px-3 dark:border-zinc-800">
            <Search className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search people…"
              className="flex-1 bg-transparent text-[14px] text-zinc-800 outline-none placeholder:text-zinc-400 dark:text-zinc-200"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} className="text-zinc-400 hover:text-zinc-600" aria-label="Clear search">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          <div className="max-h-[260px] overflow-y-auto py-1.5">
            {value ? (
              <>
                <MenuItem
                  icon={UserX}
                  label="Unassign"
                  onClick={() => { onChange(null); setOpen(false); }}
                />
                <MenuSeparator />
              </>
            ) : null}
            {people === null ? (
              <div className="px-3 py-4 text-[13px] text-zinc-400">Loading…</div>
            ) : people.length === 0 ? (
              <div className="px-3 py-4 text-[13px] text-zinc-400">No people found</div>
            ) : (
              people.map((p) => (
                <MenuItem
                  key={p.id}
                  leading={<PersonAvatar person={p} size={22} />}
                  label={p.id === meId ? "Me" : personName(p)}
                  selected={p.id === value?.id}
                  onClick={() => { onChange(p); setOpen(false); }}
                />
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
