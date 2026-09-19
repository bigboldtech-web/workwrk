"use client";

// AvatarStack — one person mark, one overlapping group (design-system 5.18).
//
//   "Avatars: 20 / 24 / 28 / 32 / 40, pill, initials 11/500 on N200 with N700
//    text (the lime dark fallback and hue-keyed fallbacks are DELETED),
//    presence dot bottom-right when relevant."
//
// The deletion is the point. Three different files hashed a person's id into a
// colour — a djb2 hue in the assignee picker, an 8-colour palette on the
// Activity page, a second djb2 in the Space owner badge — so the same person
// was three different colours on three screens and none of the colours meant
// anything. Initials on one neutral ground say exactly as much and never
// pretend to carry information.

import type { ReactNode } from "react";

export interface AvatarPerson {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  avatar?: string | null;
  email?: string | null;
}

export type AvatarSize = 20 | 24 | 28 | 32 | 40;

export function personLabel(p: AvatarPerson): string {
  const name = `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim();
  return name || p.email || "Unknown";
}

export function personInitials(p: AvatarPerson): string {
  const initials = `${p.firstName?.[0] ?? ""}${p.lastName?.[0] ?? ""}`.toUpperCase().trim();
  return initials || (p.email?.[0] ?? "?").toUpperCase();
}

export function Avatar({
  person,
  size = 24,
  className = "",
  ring = false,
}: {
  person: AvatarPerson;
  size?: AvatarSize | number;
  className?: string;
  /** A 2px ring in the surface colour, for overlapping stacks. */
  ring?: boolean;
}) {
  const ringCls = ring ? "ring-2 ring-[var(--os-surface)]" : "";
  if (person.avatar) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={person.avatar}
        alt={personLabel(person)}
        title={personLabel(person)}
        className={`shrink-0 rounded-full object-cover ${ringCls} ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      title={personLabel(person)}
      aria-label={personLabel(person)}
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-[var(--os-n200)] font-medium text-[var(--os-n700)] ${ringCls} ${className}`}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.42)) }}
    >
      {personInitials(person)}
    </span>
  );
}

/** Overlapping group: at most `max` marks, then "+N" in 12/500 ink-2. */
export function AvatarStack({
  people,
  size = 24,
  max = 3,
  empty,
  className = "",
}: {
  people: AvatarPerson[];
  size?: AvatarSize | number;
  max?: number;
  /** What to render when nobody is in the group ("Assign", a dash, nothing). */
  empty?: ReactNode;
  className?: string;
}) {
  if (people.length === 0) return <>{empty ?? null}</>;
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <span className="flex">
        {shown.map((p, i) => (
          <span key={p.id} className="inline-flex" style={{ marginInlineStart: i === 0 ? 0 : -Math.round(size * 0.3) }}>
            <Avatar person={p} size={size} ring={shown.length > 1} />
          </span>
        ))}
      </span>
      {extra > 0 ? <span className="text-xs font-medium text-ink-2">+{extra}</span> : null}
    </span>
  );
}
