"use client";

// AssigneePicker — reusable people picker popover (Phase: task-system).
// One component for every owner/assignee surface: drawer Owner row,
// table OwnerCell, USER custom fields, and the create-task modal.
// Debounced search, "Me" pinned first, Unassign offered.
//
// WHERE THE CANDIDATES COME FROM. With a `boardId` the picker asks
// /api/boards/[id]/assignable — the people who can already reach that list
// (its Board / Space / Folder members plus org admins). Without one there is
// no list context to scope by, so it falls back to /api/users, which is what
// every surface used to call.
//
// That fallback is exactly the bug for list surfaces: /api/users pins any
// caller below ORG_WIDE_ALIGNMENT_LEVELS to their own report tree, so a Space
// Admin with no reports saw one candidate, himself. PASS boardId wherever a
// board is in scope.

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { ChevronDown, Search, UserX, UserRound } from "lucide-react";
import { Dots } from "@/components/ui/dots";
import { MenuItem, MenuSeparator } from "@/components/ui/menu";
import { Avatar, AvatarStack } from "@/components/ui/avatar-stack";
import { useAnchorPos } from "./use-anchor-pos";

export interface PersonRef {
  id: string;
  firstName: string | null;
  lastName: string | null;
  avatar: string | null;
  email?: string | null;
}

function personName(p: PersonRef): string {
  const n = `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim();
  return n || p.email || "Unknown";
}

function personInitials(p: PersonRef): string {
  const i = `${p.firstName?.[0] ?? ""}${p.lastName?.[0] ?? ""}`.toUpperCase();
  return i || (p.email?.[0] ?? "?").toUpperCase();
}

// The per-person djb2 hue that used to live here is GONE (design-system 5.18:
// "the lime dark fallback and hue-keyed fallbacks are deleted"). Three files
// hashed an id into a colour three different ways, so one person was three
// colours across three screens and none of them meant anything. Both exports
// stay, so no call site moves; they now render the one neutral mark.
export function PersonAvatar({ person, size = 24 }: { person: PersonRef; size?: number }) {
  return <Avatar person={person} size={size} />;
}

/** Avatar stack for one or more assignees. */
export function PersonAvatarStack({ people, size = 24, max = 4 }: { people: PersonRef[]; size?: number; max?: number }) {
  return <AvatarStack people={people} size={size} max={max} />;
}

// A picker that truncates before you have typed anything is a picker that
// lies about who exists. 20 cut a 26 person org off mid-alphabet.
const CANDIDATE_LIMIT = 100;

/** The people query shared by both pickers. Board-scoped when we know the
 *  board; org/team-scoped only as a last resort. */
function usePeopleQuery(open: boolean, query: string, meId: string | null, boardId?: string | null) {
  const [people, setPeople] = useState<PersonRef[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    const t = setTimeout(() => {
      setLoading(true);
      const q = query.trim();
      const params = new URLSearchParams({ limit: String(CANDIDATE_LIMIT) });
      if (q) params.set("search", q);
      let url: string;
      if (boardId) {
        url = `/api/boards/${encodeURIComponent(boardId)}/assignable?${params}`;
      } else {
        params.set("scope", "all");
        url = `/api/users?${params}`;
      }
      fetch(url, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { data: [] }))
        .then((d) => {
          if (!active) return;
          const rows: PersonRef[] = Array.isArray(d?.data) ? d.data : [];
          // Pin "Me" first when present.
          rows.sort((a, b) => Number(b.id === meId) - Number(a.id === meId));
          setPeople(rows);
        })
        .catch(() => { if (active) setPeople([]); })
        .finally(() => { if (active) setLoading(false); });
    }, 250);
    return () => { active = false; clearTimeout(t); };
  }, [open, query, meId, boardId]);

  return { people, loading };
}

interface MultiAssigneePickerProps {
  value: PersonRef[];
  canEdit: boolean;
  /** Scopes the candidate list to the people on this list. */
  boardId?: string | null;
  /** Avatar-only trigger for dense table cells. */
  compact?: boolean;
  onChange: (people: PersonRef[]) => void;
}

/** The empty-assignee affordance for a dense cell: a dashed avatar SLOT
 *  (ClickUp style), sized to a real avatar so it carries the same visual
 *  weight as the calendar and flag icons beside it. */
function EmptyAssigneeSlot() {
  return (
    <span
      className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full border border-dashed border-zinc-300 text-zinc-400 shrink-0"
      aria-label="Assign"
    >
      <UserRound className="w-2.5 h-2.5" />
    </span>
  );
}

/** Multi-select assignees — search + toggle people on/off; the dropdown stays
 *  open so you can add several. Click-outside closes it. */
export function MultiAssigneePicker({ value, canEdit, boardId, compact = false, onChange }: MultiAssigneePickerProps) {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuPos = useAnchorPos(ref, open, 300);
  const meId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const { people, loading } = usePeopleQuery(open, query, meId, boardId);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  const selectedIds = new Set(value.map((p) => p.id));
  const toggle = (p: PersonRef) => {
    if (selectedIds.has(p.id)) onChange(value.filter((x) => x.id !== p.id));
    else onChange([...value, p]);
  };

  const trigger = value.length ? (
    <span className="inline-flex items-center gap-2 min-w-0">
      <PersonAvatarStack people={value} size={compact ? 22 : 24} max={compact ? 3 : 4} />
      {!compact && value.length === 1 && <span className="text-xs truncate">{personName(value[0])}</span>}
    </span>
  ) : compact ? (
    <EmptyAssigneeSlot />
  ) : (
    <span className="text-xs text-zinc-500">Unassigned</span>
  );

  if (!canEdit) return trigger;

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 -mx-1 hover:bg-zinc-100 transition-colors max-w-full"
        aria-label="Set assignees"
      >
        {trigger}
        {!compact && <ChevronDown className="w-3 h-3 text-zinc-400" />}
      </button>
      {open && menuPos ? (
        <div
          style={{
            position: "fixed",
            left: menuPos.left,
            width: 280,
            ...(menuPos.top != null ? { top: menuPos.top } : { bottom: menuPos.bottom }),
            maxHeight: menuPos.maxHeight,
          }}
          className="z-[200] flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex h-9 items-center gap-2 px-3 border-b border-zinc-100">
            <Search className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Add people…"
              className="flex-1 text-base text-zinc-800 bg-transparent outline-none placeholder:text-zinc-400"
            />
          </div>
          <div className="max-h-[280px] min-h-0 flex-1 overflow-y-auto py-1.5">
            {people === null || loading ? (
              <div className="px-3 py-4"><Dots variant="pending" label="Loading people" className="text-ink-3" /></div>
            ) : people.length === 0 ? (
              <div className="px-3 py-4 text-sm text-zinc-400">No people found</div>
            ) : (
              people.map((p) => {
                const isMe = p.id === meId;
                return (
                  <MenuItem
                    key={p.id}
                    leading={<PersonAvatar person={p} size={22} />}
                    label={isMe ? "Me" : personName(p)}
                    selected={selectedIds.has(p.id)}
                    onClick={() => toggle(p)}
                  />
                );
              })
            )}
          </div>
          {value.length > 0 ? (
            <button
              type="button"
              onClick={() => onChange([])}
              className="h-8 shrink-0 border-t border-zinc-100 text-sm text-zinc-500 hover:bg-zinc-50 inline-flex items-center gap-1.5 px-3"
            >
              <UserX className="w-3.5 h-3.5" /> Clear all
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

interface AssigneePickerProps {
  value: PersonRef | null;
  canEdit: boolean;
  /** Avatar-only trigger for dense table cells. */
  compact?: boolean;
  /** Scopes the candidate list to the people on this list. */
  boardId?: string | null;
  onChange: (person: PersonRef | null) => void;
}

export function AssigneePicker({ value, canEdit, compact = false, boardId, onChange }: AssigneePickerProps) {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuPos = useAnchorPos(ref, open, 260);

  const meId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const { people, loading } = usePeopleQuery(open, query, meId, boardId);

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

  const trigger = value ? (
    <span className="inline-flex items-center gap-2 min-w-0">
      <PersonAvatar person={value} size={compact ? 22 : 24} />
      {!compact && <span className="text-xs truncate">{personName(value)}</span>}
    </span>
  ) : (
    compact ? <EmptyAssigneeSlot /> : <span className="text-xs text-zinc-500">Unassigned</span>
  );

  if (!canEdit) return trigger;

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 -mx-1 hover:bg-zinc-100 transition-colors max-w-full"
        aria-label="Set assignee"
      >
        {trigger}
        {!compact && <ChevronDown className="w-3 h-3 text-zinc-400" />}
      </button>
      {open && menuPos ? (
        <div
          style={{
            position: "fixed",
            left: menuPos.left,
            width: 260,
            ...(menuPos.top != null ? { top: menuPos.top } : { bottom: menuPos.bottom }),
            maxHeight: menuPos.maxHeight,
          }}
          className="z-[200] flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex h-9 items-center gap-2 px-3 border-b border-zinc-100">
            <Search className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search or enter email…"
              className="flex-1 text-base text-zinc-800 bg-transparent outline-none placeholder:text-zinc-400"
            />
          </div>
          <div className="max-h-[260px] min-h-0 flex-1 overflow-y-auto py-1.5">
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
            {people === null || loading ? (
              <div className="px-3 py-4"><Dots variant="pending" label="Loading people" className="text-ink-3" /></div>
            ) : people.length === 0 ? (
              <div className="px-3 py-4 text-sm text-zinc-400">No people found</div>
            ) : (
              people.map((p) => {
                const isMe = p.id === meId;
                const active = p.id === value?.id;
                return (
                  <MenuItem
                    key={p.id}
                    leading={<PersonAvatar person={p} size={22} />}
                    label={isMe ? "Me" : personName(p)}
                    selected={active}
                    onClick={() => { onChange(p); setOpen(false); }}
                  />
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
