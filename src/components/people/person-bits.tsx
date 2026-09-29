"use client";

// Small shared pieces of the Teams hub's people surfaces (spec-teams-people
// section 3): the person avatar with its presence dot, the person cell, and
// the people picker over GET /api/people/pick that the Reports to, dotted
// line, Department head and Directory filter controls all use.

import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, X } from "lucide-react";
import { Avatar, type AvatarPerson } from "@/components/ui/avatar-stack";
import { Picker } from "@/components/ui/picker";
import { apiFetch } from "@/lib/api-fetch";
import { presenceDot } from "@/lib/people/presence";
import { cn } from "@/lib/utils";
import { StatusChip } from "@/components/ui/chip";
import { RUN_TONE_COLOR, type RunTone } from "@/lib/automation/run-status";

export interface PersonLite extends AvatarPerson {
  presenceStatus?: string | null;
  presenceUntil?: string | null;
}

export function personName(p: { firstName?: string | null; lastName?: string | null; email?: string | null } | null | undefined): string {
  if (!p) return "";
  return `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.email || "Someone";
}

/** The avatar, plus the presence dot only when there is one (never a placeholder). */
export function PersonAvatar({ person, size = 28, className }: { person: PersonLite; size?: 20 | 24 | 28 | 32 | 36 | 40; className?: string }) {
  const dot = presenceDot(person.presenceStatus, person.presenceUntil);
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <Avatar person={person} size={size} />
      {dot ? (
        <span
          title={dot.label}
          aria-label={dot.label}
          className={cn(
            "absolute -bottom-px -end-px h-2 w-2 rounded-full ring-2 ring-[var(--os-surface)]",
            dot.tone === "online" ? "bg-success-solid" : dot.tone === "busy" ? "bg-danger-solid" : "bg-warning-solid",
          )}
        />
      ) : null}
    </span>
  );
}

export interface PickPerson {
  id: string;
  firstName: string | null;
  lastName: string | null;
  avatar: string | null;
  email: string | null;
  role?: { title: string | null } | null;
}

/** Debounced search over GET /api/people/pick. */
export function usePeoplePick(open: boolean, opts: { managersOnly?: boolean; includeSelf?: boolean; exclude?: string[] } = {}) {
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<PickPerson[]>([]);
  const [loading, setLoading] = useState(false);
  const excludeKey = (opts.exclude ?? []).join(",");
  useEffect(() => {
    if (!open) return;
    let live = true;
    const t = setTimeout(async () => {
      setLoading(true);
      const qs = new URLSearchParams({ q: query, limit: "30" });
      if (opts.managersOnly) qs.set("managers", "1");
      if (opts.includeSelf) qs.set("includeSelf", "1");
      if (excludeKey) qs.set("exclude", excludeKey);
      const r = await apiFetch<{ people: PickPerson[] }>(`/api/people/pick?${qs}`, { cache: "no-store" });
      if (!live) return;
      setLoading(false);
      if (r.ok) setPeople(r.data.people ?? []);
    }, 180);
    return () => { live = false; clearTimeout(t); };
  }, [open, query, opts.managersOnly, opts.includeSelf, excludeKey]);
  return { query, setQuery, people, loading };
}

/**
 * A 32px trigger that shows the chosen person and opens a Picker of people.
 * `multiple` keeps it open for a set (dotted lines). The popover is an
 * absolute child of the trigger, so it stays inside a dialog's focus trap.
 */
export function PeoplePickerField({
  value,
  people,
  onChange,
  multiple = false,
  managersOnly = false,
  exclude,
  placeholder = "Nobody",
  ariaLabel,
  allowClear = true,
  disabled = false,
  className,
  side = "bottom",
}: {
  value: string[];
  /** Cards for the ids in `value`, so the trigger can show names before a search. */
  people: PickPerson[];
  onChange: (ids: string[], picked: PickPerson[]) => void;
  multiple?: boolean;
  managersOnly?: boolean;
  exclude?: string[];
  placeholder?: string;
  ariaLabel: string;
  allowClear?: boolean;
  disabled?: boolean;
  className?: string;
  side?: "bottom" | "top";
}) {
  const [open, setOpen] = useState(false);
  const { setQuery, people: found, loading } = usePeoplePick(open, { managersOnly, includeSelf: true, exclude });
  const known = new Map<string, PickPerson>();
  for (const p of people) known.set(p.id, p);
  for (const p of found) known.set(p.id, p);
  const chosen = value.map((id) => known.get(id)).filter((p): p is PickPerson => !!p);
  const label: ReactNode = chosen.length === 0
    ? <span className="text-ink-3">{placeholder}</span>
    : multiple && chosen.length > 1
      ? <span className="truncate">{chosen.map(personName).join(", ")}</span>
      : (
        <span className="flex min-w-0 items-center gap-1.5">
          <Avatar person={chosen[0]} size={20} />
          <span className="truncate">{personName(chosen[0])}</span>
        </span>
      );
  const options = [
    ...chosen.filter((p) => !found.some((f) => f.id === p.id)),
    ...found,
  ].map((p) => ({
    value: p.id,
    label: personName(p),
    description: p.role?.title ?? p.email ?? undefined,
    keywords: p.email ?? undefined,
    glyph: <Avatar person={p} size={20} />,
  }));
  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-8 w-full min-w-0 items-center gap-1.5 rounded-md border border-line bg-raised px-2 text-sm text-ink hover:border-line-strong disabled:opacity-60"
      >
        <span className="min-w-0 flex-1 text-start">{label}</span>
        {allowClear && chosen.length > 0 && !disabled ? (
          <span
            role="button"
            tabIndex={0}
            aria-label="Clear"
            onClick={(e) => { e.stopPropagation(); onChange([], []); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onChange([], []); } }}
            className="inline-flex h-5 w-5 items-center justify-center rounded text-ink-2 hover:bg-hover hover:text-ink"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </span>
        ) : null}
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-2" aria-hidden />
      </button>
      <Picker
        open={open}
        onClose={() => setOpen(false)}
        side={side}
        multi={multiple}
        alwaysSearch
        loading={loading}
        onSearchChange={setQuery}
        searchPlaceholder="Search people"
        ariaLabel={ariaLabel}
        selected={multiple ? value : value[0] ?? null}
        emptyLabel="No one matches"
        sections={[{ options }]}
        onSelect={(id) => {
          const p = known.get(id);
          if (multiple) {
            const next = value.includes(id) ? value.filter((x) => x !== id) : [...value, id];
            onChange(next, next.map((x) => known.get(x)).filter((q): q is PickPerson => !!q));
          } else {
            setOpen(false);
            onChange([id], p ? [p] : []);
          }
        }}
        className={cn("absolute start-0 z-50", side === "top" ? "bottom-10" : "top-10")}
      />
    </div>
  );
}

/** A pale status chip in one of the five tones (design-system 5.9). */
export function ToneChip({ tone, label, title }: { tone: RunTone; label: string; title?: string }) {
  return <StatusChip color={RUN_TONE_COLOR[tone]} label={label} title={title} />;
}
