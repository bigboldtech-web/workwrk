// TeamAvatar: the initials-or-photo disc the Talk surfaces render.
//
// This file used to hold the whole Teams chrome kit (pctColor, TeamStatTile,
// TeamCard, TeamProgressBar, TeamHeader). Phase 6 moved every Teams page onto
// the shared primitives (OsPageHeader, StatTile, TableCard, StatusChip, the
// alignment-tone helpers), so those five had no importer left and were
// deleted. TeamAvatar stays because Talk (tlk, calls, the conversation view,
// the people picker, announcements) still imports it from here; it moves
// when the Talk unit adopts the shared avatar. No "use client": it is pure
// and renders in server and client trees alike.

export function TeamAvatar({ name, avatar, size = 28 }: { name: string; avatar?: string | null; size?: number }) {
  const initials = name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
  if (avatar) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={avatar} alt={name} className="rounded-full object-cover shrink-0" style={{ width: size, height: size }} />;
  }
  return (
    <span className="rounded-full bg-active text-ink-2 inline-flex items-center justify-center font-medium shrink-0" style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}>
      {initials}
    </span>
  );
}
