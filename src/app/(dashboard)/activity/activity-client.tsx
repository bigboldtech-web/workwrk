"use client";

// The /activity body: one paginated call, day-grouped rows, a sentence and a
// chip per row.
//
// Spec: docs/plans/ui-refresh/spec-work-home.md section 2 (/activity).
//
// WHAT CHANGED:
//   - The scope pills are role-derived. An IC sees one pill, not three, and
//     the two they cannot use are absent rather than lit-and-lying (#8).
//   - Every written `targetType` gets a chip, because the map is lowercase and
//     total (src/lib/activity-targets.ts). It knew ten of forty-five before.
//   - A task chip goes to /item/[id]. It used to go to `/tasks?id=`, which is
//     the card grid and reads no `id` parameter, so it was a dead link.
//   - The decorative "Live" dot is gone: nothing bumps that row version, so
//     the dot claimed a subscription that does not exist. The page refetches
//     on focus and every 60 seconds while visible, which is what it does.
//   - The hashed eight-colour avatar palette is gone; `Avatar` draws real
//     people (no fabricated colour per actor id).
//   - The day buckets are Today, Yesterday and then the real date, instead of
//     filing everything older than two days under "Last 7 days".

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Boxes, CheckSquare, CircleDot, Coins, FileText, Folder, Heart, ListChecks, Paperclip,
  PenTool, ScrollText, Settings as SettingsIcon, Table2, Target, User as UserIcon,
  type LucideIcon,
} from "lucide-react";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { ViewTab } from "@/components/ui/view-tabs";
import { FilterPanel, FilterRow } from "@/components/ui/filter-panel";
import { DotsArt } from "@/components/ui/dots-art";
import { Avatar, personLabel } from "@/components/ui/avatar-stack";
import { apiFetch } from "@/lib/api-fetch";
import { useShortcut } from "@/lib/shortcuts";
import { ACTIVITY_SCOPES, type ActivityScope } from "@/lib/activity-scope";
import { targetFor, targetHref, verbFor, withoutLeadingVerb } from "@/lib/activity-targets";
import { useObjectHref } from "@/components/layout/os/use-object-href";

interface ActivityRow {
  id: string;
  type: string;
  description: string | null;
  targetType: string | null;
  targetId: string | null;
  /** Server-computed: false when the viewer can no longer read the target. */
  targetReadable?: boolean;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  actor?: { id: string; firstName?: string | null; lastName?: string | null; avatar?: string | null } | null;
}

interface Payload {
  data: ActivityRow[];
  scope: ActivityScope;
  pagination: { page: number; limit: number; total: number; totalPages: number; hasMore: boolean };
}

interface FamilyRow {
  key: string;
  label: string;
  types: string[];
  count: number;
}

/** The chip glyph per target family. One icon set, no per-verb hues. */
const GLYPHS: Record<string, LucideIcon> = {
  task: CheckSquare,
  doc: FileText,
  sop: ScrollText,
  goal: Target,
  person: UserIcon,
  space: Boxes,
  list: ListChecks,
  folder: Folder,
  table: Table2,
  canvas: PenTool,
  file: Paperclip,
  form: FileText,
  kudos: Heart,
  settings: SettingsIcon,
  finance: Coins,
  dot: CircleDot,
};

const RANGES = [
  { key: "7", label: "Last 7 days", days: 7 },
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "90", label: "Last 90 days", days: 90 },
] as const;

export function ActivityClient({
  scopes,
  initialScope,
  initialPerson,
  initialPersonName,
}: {
  scopes: ActivityScope[];
  initialScope: ActivityScope;
  initialPerson: string | null;
  initialPersonName: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [scope, setScope] = useState<ActivityScope>(initialScope);
  // `?person=` locked the feed to one actor with no chip, no filter row and
  // nothing to clear: the Filter pill read 0 while the data was filtered, and
  // the teams profile "Activity" tab is a real entry point that produces
  // exactly this state. It is state now, so it can be removed.
  const [person, setPerson] = useState<string | null>(initialPerson);
  const [page, setPage] = useState(1);
  const [families, setFamilies] = useState<FamilyRow[]>([]);
  const [pickedFamilies, setPickedFamilies] = useState<string[]>([]);
  const [range, setRange] = useState<string | null>(null);
  const [data, setData] = useState<Payload | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);

  const targetTypes = useMemo(() => {
    if (!pickedFamilies.length) return "";
    const set = new Set<string>();
    for (const f of families) if (pickedFamilies.includes(f.key)) for (const t of f.types) set.add(t);
    return [...set].join(",");
  }, [pickedFamilies, families]);

  /**
   * The request string, built when a request is made.
   *
   * `Date.now()` used to be called while RENDERING, to turn "Last 7 days" into
   * a `from` timestamp. That is a server/client divergence (the two clocks
   * differ, so the same state produced two different strings) and it made the
   * memo change identity on every render. The clock is read at call time now,
   * which is the only moment the answer is wanted.
   */
  const buildQuery = useCallback(() => {
    const qs = new URLSearchParams({ scope, page: String(page), limit: "50" });
    if (targetTypes) qs.set("targetType", targetTypes);
    if (person) qs.set("actorIds", person);
    const r = RANGES.find((x) => x.key === range);
    if (r) qs.set("from", new Date(Date.now() - r.days * 86_400_000).toISOString());
    return qs.toString();
  }, [scope, page, targetTypes, person, range]);

  const load = useCallback(async () => {
    const res = await apiFetch<Payload>(`/api/activity?${buildQuery()}`, { cache: "no-store" });
    if (!res.ok) { setFailed(res.error); return; }
    setData(res.data);
    setFailed(null);
  }, [buildQuery]);

  useEffect(() => {
    let live = true;
    void (async () => {
      const res = await apiFetch<Payload>(`/api/activity?${buildQuery()}`, { cache: "no-store" });
      if (!live) return;
      if (!res.ok) { setFailed(res.error); return; }
      setData(res.data);
      setFailed(null);
    })();
    return () => { live = false; };
  }, [buildQuery]);

  // The Type list is over the scope, so switching scope re-asks.
  useEffect(() => {
    let live = true;
    void apiFetch<{ families: FamilyRow[] }>(`/api/activity/types?scope=${scope}`, { cache: "no-store" }).then((res) => {
      if (live && res.ok) setFamilies(res.data.families ?? []);
    });
    return () => { live = false; };
  }, [scope]);

  // No "Live" dot: this is a poll, and the page says so by not claiming
  // otherwise. It stops while the tab is hidden.
  useEffect(() => {
    const tick = () => { if (document.visibilityState === "visible") void load(); };
    const id = window.setInterval(tick, 60_000);
    window.addEventListener("focus", tick);
    return () => { window.clearInterval(id); window.removeEventListener("focus", tick); };
  }, [load]);

  useShortcut({ id: "activity-filter", keys: "f", label: "Filter", scope: "page", run: () => setFilterOpen((v) => !v) });

  const rows = data?.data ?? [];
  const days = useMemo(() => groupByDay(rows), [rows]);
  const loading = data === null && failed === null;
  const activeFilters = pickedFamilies.length + (range ? 1 : 0) + (person ? 1 : 0);

  /** Mirror a control into the URL, so a scoped view is a link somebody can send. */
  const writeUrl = useCallback(
    (patch: Record<string, string | null>) => {
      const qs = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) qs.delete(k); else qs.set(k, v);
      }
      const q = qs.toString();
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const clearPerson = useCallback(() => {
    setPerson(null);
    setPage(1);
    writeUrl({ person: null });
  }, [writeUrl]);

  return (
    <>
      <OsPageHeader
        title="Activity"
        // One pill is not a choice: a surface with a single view renders no
        // views row at all (design-system 4.4).
        views={
          scopes.length > 1 ? (
            <>
              {ACTIVITY_SCOPES.filter((s) => scopes.includes(s.key)).map((s) => (
                <ViewTab
                  key={s.key}
                  label={s.label}
                  active={scope === s.key}
                  onClick={() => { setScope(s.key); setPage(1); setPickedFamilies([]); writeUrl({ view: s.key }); }}
                />
              ))}
            </>
          ) : undefined
        }
        toolbar={{
          filter: { open: filterOpen, onToggle: () => setFilterOpen((v) => !v), count: activeFilters },
          // Newest first, always, and days are days: there is nothing to sort
          // or group, so neither control is drawn.
          // An onClick, not an href: the URL carries a `from` computed from
          // the clock, and the clock may not be read during render.
          menu: [{ label: "Export CSV", onClick: () => { window.location.href = `/api/activity/export.csv?${buildQuery()}`; } }],
        }}
      />

      {person ? (
        /* The one thing the URL does to this page that nothing else showed.
           A caption with a Clear beside it, so a person who arrived from the
           teams profile "Activity" tab can see the scope and leave it. */
        <div className="flex h-9 items-center gap-2 px-6 text-sm text-ink-2">
          <span>Showing {initialPersonName ? <span className="font-medium text-ink">{initialPersonName}</span> : "one person"} only</span>
          <button type="button" onClick={clearPerson} className="font-medium text-brand-deep hover:underline">Show everyone</button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        {filterOpen ? (
          <FilterPanel
            open
            onClose={() => setFilterOpen(false)}
            objects="activity"
            activeCount={activeFilters}
            onClearAll={() => { setPickedFamilies([]); setRange(null); clearPerson(); setPage(1); }}
          >
            {families.map((f) => (
              <FilterRow
                key={f.key}
                label={f.label}
                count={f.count}
                checked={pickedFamilies.includes(f.key)}
                onCheckedChange={(on) => { setPickedFamilies((p) => (on ? [...p, f.key] : p.filter((v) => v !== f.key))); setPage(1); }}
              />
            ))}
            {person ? (
              <FilterRow
                label={initialPersonName ?? "One person"}
                checked
                onCheckedChange={(on) => { if (!on) clearPerson(); }}
              />
            ) : null}
            {RANGES.map((r) => (
              <FilterRow
                key={r.key}
                label={r.label}
                checked={range === r.key}
                onCheckedChange={(on) => { setRange(on ? r.key : null); setPage(1); }}
              />
            ))}
          </FilterPanel>
        ) : null}

        <div className="min-w-0 flex-1 overflow-y-auto px-6 py-4">
          {failed ? (
            <OsEmptyView variant="error" title="Couldn't load activity" hint={failed} action={{ label: "Retry", onClick: () => void load() }} />
          ) : loading ? (
            <FeedSkeleton />
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
              <DotsArt arrangement="row" size={64} />
              <p className="max-w-[46ch] text-base text-ink-2">
                {scope === "my"
                  ? "Nothing yet. Your activity shows up here as you work."
                  : "Nobody has done anything in this range."}
              </p>
            </div>
          ) : (
            <>
              <div className="os-row overflow-hidden rounded-lg border border-line bg-raised">
                {days.map((d) => (
                  <div key={d.key}>
                    <div className="flex h-9 items-center border-b border-line bg-subtle px-4 text-xs font-medium uppercase tracking-wide text-ink-2">
                      {d.label}
                    </div>
                    {d.rows.map((r) => (
                      <ActivityFeedRow key={r.id} row={r} />
                    ))}
                  </div>
                ))}
              </div>
              <div className="mt-2 flex h-11 items-center gap-3 px-1 text-sm text-ink-2">
                <span>
                  Total records {data?.pagination.total ?? rows.length}
                  {data && data.pagination.total > rows.length
                    ? ` · ${(data.pagination.page - 1) * data.pagination.limit + 1} to ${(data.pagination.page - 1) * data.pagination.limit + rows.length}`
                    : ""}
                </span>
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="inline-flex h-8 items-center rounded-md border border-line px-2 text-base text-ink hover:bg-hover disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={!data?.pagination.hasMore}
                  onClick={() => setPage((p) => p + 1)}
                  className="inline-flex h-8 items-center rounded-md border border-line px-2 text-base text-ink hover:bg-hover disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function ActivityFeedRow({ row }: { row: ActivityRow }) {
  // Activity is Work: a doc, table, canvas, SOP or form chip opens in Work
  // (targetHref is canonical; it is mapped for this section here).
  const { map: sectionLink } = useObjectHref();
  const def = targetFor(row.targetType);
  const Glyph = GLYPHS[def.glyph] ?? CircleDot;
  // The third argument is the whole point of the guard: the server says
  // whether this viewer can still read the target, so a chip whose object has
  // been moved out from under them renders as text rather than a link that 404s.
  const canonicalTarget = targetHref(row.targetType, row.targetId, row.targetReadable !== false);
  const href = canonicalTarget ? sectionLink(canonicalTarget) : null;
  const name = targetName(row);
  const actor = row.actor
    ? { id: row.actor.id, firstName: row.actor.firstName, lastName: row.actor.lastName, avatar: row.actor.avatar }
    : null;

  const verb = verbFor(row.type);
  // A row with no target has nothing to chip. Its description IS the sentence
  // ("signed in"), so drawing it as a chip beside the same verb printed the
  // words twice: "VerifyAdmin Bot signed in [Signed in]".
  const hasTarget = Boolean(row.targetType || row.targetId);
  const chipName = hasTarget && name && name.toLowerCase() !== verb.toLowerCase() ? name : null;
  // A targetless row's description IS its sentence, so that one keeps the
  // whole string rather than only the quoted fragment.
  const targetlessTail = row.description?.trim() || null;
  const chip = chipName ? (
    <span className="inline-flex h-[22px] max-w-[280px] items-center gap-1 rounded-md bg-active px-1.5 text-xs font-medium text-ink-2">
      <Glyph className="h-3 w-3 shrink-0" strokeWidth={1.5} aria-hidden />
      <span className="truncate">{chipName}</span>
    </span>
  ) : null;
  // The tail for a targetless row: what happened, in the writer's own words,
  // with the verb this row has ALREADY printed taken off the front.
  //
  // The guard here used to be exact equality, which caught "signed in" and
  // nothing else. Stored descriptions are whole sentences that begin with
  // their own action, so a row read: Verify Bot applied Applied "Engineering
  // team" template. Every writer that puts a sentence in `description` hits
  // this, not just one.
  const tail = !hasTarget ? withoutLeadingVerb(targetlessTail, verb) : null;

  return (
    <div className="flex items-center gap-3 border-b border-line-soft px-4 last:border-b-0 hover:bg-hover" style={{ minHeight: "44px" }}>
      {actor ? <Avatar person={actor} size={24} /> : <span className="h-6 w-6 shrink-0 rounded-full bg-active" aria-hidden />}
      <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-ink">
        <span className="shrink-0 font-medium">{actor ? personLabel(actor) : "Someone"}</span>
        <span className="shrink-0 text-ink-2">{verb}</span>
        {/* A target the viewer can no longer open renders as plain text, never
            as a link that 404s. */}
        {chip ? (href ? <Link href={href} className="min-w-0 hover:underline">{chip}</Link> : chip) : null}
        {tail ? <span className="min-w-0 truncate text-ink-2">{tail}</span> : null}
      </span>
      <time className="shrink-0 text-xs text-ink-2" dateTime={row.createdAt}>{clock(row.createdAt)}</time>
    </div>
  );
}

/**
 * The target's name, from whatever the writer put in `metadata`.
 *
 * Writers are inconsistent (`name`, `title`, `label`), so all four keys are
 * read. The fallback to `description` is where the row started printing the
 * verb twice: a stored description is a whole SENTENCE that already begins
 * with the action ("Created task \u201cX\u201d"), so the row rendered
 * "VerifyAdmin Bot created [Created task \u201cX\u201d]". The quoted part of
 * such a sentence is the name; failing that the row shows the verb alone,
 * which is the honest answer. Nothing is invented and no id goes in a chip.
 */
function targetName(row: ActivityRow): string | null {
  const m = row.metadata ?? {};
  for (const key of ["name", "title", "label", "targetName"]) {
    const v = m[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return quotedName(row.description);
}

/** The quoted fragment of a writer's sentence, in any of the quote styles they use. */
function quotedName(description: string | null | undefined): string | null {
  const text = description?.trim();
  if (!text) return null;
  const quoted = text.match(/["\u201c\u2018']([^"\u201d\u2019']{1,160})["\u201d\u2019']/);
  return quoted?.[1]?.trim() || null;
}

function clock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

interface DayGroup { key: string; label: string; rows: ActivityRow[] }

/**
 * Today, Yesterday, then the real date.
 *
 * The old page had three buckets and filed everything older than two days
 * under "Last 7 days", including rows from last year.
 */
function groupByDay(rows: readonly ActivityRow[]): DayGroup[] {
  const out: DayGroup[] = [];
  const today = startOfDay(new Date());
  const yesterday = new Date(today.getTime() - 86_400_000);
  let current: DayGroup | null = null;
  for (const r of rows) {
    const d = new Date(r.createdAt);
    const day = Number.isNaN(d.getTime()) ? today : startOfDay(d);
    const key = day.toISOString().slice(0, 10);
    if (!current || current.key !== key) {
      const label =
        day.getTime() === today.getTime() ? "Today"
          : day.getTime() === yesterday.getTime() ? "Yesterday"
            : day.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
      current = { key, label, rows: [] };
      out.push(current);
    }
    current.rows.push(r);
  }
  return out;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function FeedSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-raised" aria-busy="true" aria-label="Loading">
      <div className="h-9 border-b border-line bg-subtle" />
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-line-soft px-4 last:border-b-0" style={{ height: 44 }}>
          <span className="os-skeleton-pulse h-6 w-6 shrink-0 rounded-full bg-skeleton" />
          <span className="os-skeleton-pulse h-3.5 rounded bg-skeleton" style={{ width: `${[46, 38, 60, 42, 54, 33, 48, 52][i]}%` }} />
        </div>
      ))}
    </div>
  );
}
