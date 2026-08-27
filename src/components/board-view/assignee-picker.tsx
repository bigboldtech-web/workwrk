"use client";

// AssigneePicker — reusable people picker popover (Phase: task-system).
// One component for every owner/assignee surface: drawer Owner row,
// table OwnerCell, USER custom fields, and the create-task modal.
// Searches /api/users (debounced), pins "Me" first, offers Unassign.

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { ChevronDown, Search, UserX, UserRound } from "lucide-react";
import { MenuItem, MenuSeparator } from "@/components/ui/menu";
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

// Stable per-person hue (djb2) — matches OwnerBadge / create-task-modal.
function hueFor(seed: string): string {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = (h * 33) ^ seed.charCodeAt(i);
  return `hsl(${Math.abs(h) % 360} 55% 55%)`;
}

export function PersonAvatar({ person, size = 24 }: { person: PersonRef; size?: number }) {
  if (person.avatar) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={person.avatar}
        alt={personName(person)}
        className="rounded-full object-cover shrink-0"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="inline-flex items-center justify-center rounded-full text-white font-semibold shrink-0"
      style={{ width: size, height: size, background: hueFor(person.id), fontSize: size * 0.38 }}
    >
      {personInitials(person)}
    </span>
  );
}

interface AssigneePickerProps {
  value: PersonRef | null;
  canEdit: boolean;
  /** Avatar-only trigger for dense table cells. */
  compact?: boolean;
  onChange: (person: PersonRef | null) => void;
}

export function AssigneePicker({ value, canEdit, compact = false, onChange }: AssigneePickerProps) {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<PersonRef[] | null>(null);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuPos = useAnchorPos(ref, open, 260);

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

  // Debounced search — /api/users returns { data: [...] } (paginated).
  useEffect(() => {
    if (!open) return;
    let active = true;
    const t = setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams({ scope: "all", limit: "20" });
      if (query.trim()) params.set("search", query.trim());
      fetch(`/api/users?${params}`, { cache: "no-store" })
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
  }, [open, query, meId]);

  const trigger = value ? (
    <span className="inline-flex items-center gap-2 min-w-0">
      <PersonAvatar person={value} size={compact ? 22 : 24} />
      {!compact && <span className="text-sm truncate">{personName(value)}</span>}
    </span>
  ) : (
    compact ? (
      // Empty-assignee affordance = a dashed-circle avatar SLOT (ClickUp style),
      // sized to the assigned avatar (18px). A bordered circle has real visual
      // presence, so it reads at full weight next to the calendar / flag icons —
      // a bare person glyph kept looking tiny because it had no surrounding mass.
      <span
        className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full border border-dashed border-zinc-300 text-zinc-400 shrink-0"
        aria-label="Assign"
      >
        <UserRound className="w-2.5 h-2.5" />
      </span>
    ) : (
      <span className="text-xs text-zinc-500">Unassigned</span>
    )
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
              className="flex-1 text-[14px] text-zinc-800 bg-transparent outline-none placeholder:text-zinc-400"
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
              <div className="px-3 py-4 text-[13px] text-zinc-400">Loading…</div>
            ) : people.length === 0 ? (
              <div className="px-3 py-4 text-[13px] text-zinc-400">No people found</div>
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
