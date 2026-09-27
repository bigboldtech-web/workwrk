// Bird's eye, the pure half: the wire types, the status and column rules, the
// paging cursors and the card tint.
//
// Client-safe on purpose. The route, the loader, the hook and the cards all
// import from here, so the rule that puts a card in a column, the rule that
// calls a status closed and the cursor a page resumes from are each written
// once. The only imports are board-items-shared (the ONE done rule, the status
// types) and work-buckets (the product's due-date words), and neither of them
// imports anything impure.

import { isDoneStatus, isDoneStatusName, type StatusOption } from "@/lib/board-items-shared";
import { bucketFor as dueBucketFor, dueChipLabel } from "@/lib/work-buckets";

/** Cards per page, per column. The loader asks for one more to know there is more. */
export const BIRDSEYE_PAGE = 50;

// ── Wire types ──────────────────────────────────────────────────────

export interface BirdseyePerson {
  id: string;
  firstName: string | null;
  lastName: string | null;
  avatar: string | null;
}

export interface BirdseyeCard {
  id: string;
  boardId: string;
  title: string;
  status: string | null;
  position: number;
  /** The index of the card's column in its List's status order (overview order). */
  rank: number;
  /** ISO timestamp, or null. */
  dueAt: string | null;
  hasDescription: boolean;
  /** Live subtasks on the same List: the scope GET /api/items/[id]/subtasks answers. */
  subtaskCount: number;
  /** At most two, primary first. */
  assignees: BirdseyePerson[];
  assigneeCount: number;
}

export interface BirdseyeList {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
  color: string | null;
  statuses: StatusOption[];
  canContribute: boolean;
  /** The status "+ New task" creates in. */
  newTaskStatus: string;
  /** Top-level tasks under the current search and Hide closed. */
  total: number;
  /** The same tasks, per column (declared status value). */
  statusCounts: Record<string, number>;
}

export interface BirdseyeColumn {
  cards: BirdseyeCard[];
  nextCursor: string | null;
}

export interface BirdseyeFocusColumn {
  cards: BirdseyeCard[];
  nextCursor: string | null;
  total: number;
}

export interface BirdseyeOverviewBody {
  mode: "overview";
  lists: BirdseyeList[];
  columns: Record<string, BirdseyeColumn>;
}

export interface BirdseyeListPageBody {
  mode: "list-page";
  boardId: string;
  cards: BirdseyeCard[];
  nextCursor: string | null;
}

export interface BirdseyeFocusBody {
  mode: "focus";
  lists: BirdseyeList[];
  focus: { boardId: string; columns: Record<string, BirdseyeFocusColumn> };
}

export interface BirdseyeFocusPageBody {
  mode: "focus-page";
  boardId: string;
  status: string;
  cards: BirdseyeCard[];
  nextCursor: string | null;
}

export type BirdseyeBody = BirdseyeOverviewBody | BirdseyeListPageBody | BirdseyeFocusBody | BirdseyeFocusPageBody;

// ── Statuses ────────────────────────────────────────────────────────

/** "IN_REVIEW" reads "In review": a stored value the List no longer declares still reads as words. */
export function prettyStatusLabel(value: string): string {
  const words = value.replace(/[_-]+/g, " ").trim().toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : value;
}

/**
 * The status option a card renders: the List's own, else a neutral stand-in
 * that still names the value. A legacy "DONE" row on a List that renamed its
 * statuses reads Done with a check (the product's one done-name rule), not a
 * raw enum in an open glyph.
 */
export function resolveCardStatus(statuses: readonly StatusOption[], value: string | null | undefined): StatusOption {
  const hit = value ? statuses.find((s) => s.value === value) : undefined;
  if (hit) return hit;
  return {
    value: value ?? "",
    label: value ? prettyStatusLabel(value) : "No status",
    color: "var(--os-ink-3)",
    group: isDoneStatusName(value) ? "DONE" : "ACTIVE",
  };
}

/**
 * Closed means done or closed: isDoneStatus, the product's ONE rule, and the
 * rule "Hide closed" applies. SQL never re-implements it: the loader computes
 * the closed values present with this and hands SQL the exact values.
 */
export function isClosedStatus(statuses: readonly StatusOption[], value: string | null | undefined): boolean {
  return isDoneStatus(statuses, value);
}

/** The distinct stored values, out of `values`, that this List counts as closed. */
export function closedValuesPresent(statuses: readonly StatusOption[], values: ReadonlyArray<string | null>): string[] {
  const out = new Set<string>();
  for (const v of values) if (v && isClosedStatus(statuses, v)) out.add(v);
  return [...out];
}

/**
 * The column a status sits in: its own when the List declares it, else the
 * first column. That is the List's own Board rule (kanban-columns.ts,
 * groupCardsByStatus): a null or undeclared status stays on screen in the
 * first column instead of vanishing.
 */
export function bucketFor(statuses: readonly StatusOption[], value: string | null | undefined): string {
  if (value && statuses.some((s) => s.value === value)) return value;
  return statuses[0]?.value ?? value ?? "";
}

/** The index of a status's column in the List's order. */
export function bucketRank(statuses: readonly StatusOption[], value: string | null | undefined): number {
  const bucket = bucketFor(statuses, value);
  const at = statuses.findIndex((s) => s.value === bucket);
  return at < 0 ? 0 : at;
}

/** The status a new task gets: the List's own default when it declares it, else its first. */
export function newTaskStatus(statuses: readonly StatusOption[], defaultStatus: string | null | undefined): string {
  if (defaultStatus && statuses.some((s) => s.value === defaultStatus)) return defaultStatus;
  return statuses[0]?.value ?? "TO_DO";
}

// ── Columns ─────────────────────────────────────────────────────────

function byPositionThenId(a: BirdseyeCard, b: BirdseyeCard): number {
  if (a.position !== b.position) return a.position - b.position;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Move a card between focus columns: out of `from`, into `to` at its place in
 * (position, id) order, both totals adjusted. A card that is not in `from` is
 * left exactly where it is. The rollback of a failed write is the INVERSE
 * move, never a snapshot restore, so an update that landed in the meantime is
 * never undone along with it.
 */
export function applyStatusMove<C extends { cards: BirdseyeCard[]; total: number }>(
  columns: Readonly<Record<string, C>>,
  cardId: string,
  from: string,
  to: string,
  nextStatus: string | null,
): Record<string, C> {
  const src = columns[from];
  const card = src?.cards.find((c) => c.id === cardId);
  if (!src || !card) return { ...columns };
  const moved: BirdseyeCard = { ...card, status: nextStatus };
  const dst = columns[to];
  if (from === to || !dst) {
    // No second column to move to: the card keeps its place and shows its
    // new status, rather than leaving the screen.
    return { ...columns, [from]: { ...src, cards: src.cards.map((c) => (c.id === cardId ? moved : c)) } };
  }
  const cards = [...dst.cards.filter((c) => c.id !== cardId), moved].sort(byPositionThenId);
  return {
    ...columns,
    [from]: { ...src, cards: src.cards.filter((c) => c.id !== cardId), total: Math.max(0, src.total - 1) },
    [to]: { ...dst, cards, total: dst.total + 1 },
  };
}

/**
 * Append one page of a focus column.
 *
 * Every incoming card first takes the status of a write still in flight
 * (`pending`), then goes through the same bucket rule; a card that now
 * belongs to another column, or that is already on screen in ANY column, is
 * dropped, so a card being dragged or just added can never appear twice. The column's
 * cursor is replaced by the page's.
 */
export function mergeFocusPage<C extends { cards: BirdseyeCard[]; nextCursor: string | null; justAdded?: BirdseyeCard[] }>(
  columns: Readonly<Record<string, C>>,
  bucket: string,
  page: { cards: readonly BirdseyeCard[]; nextCursor: string | null },
  pending: ReadonlyMap<string, string | null>,
  statuses: readonly StatusOption[],
): Record<string, C> {
  const col = columns[bucket];
  if (!col) return { ...columns };
  // A task added in this visit sits in justAdded and the server gives it the
  // highest position, so it comes back on the column's last page: it counts
  // as on screen too, or it would render twice.
  const onScreen = new Set<string>();
  for (const c of Object.values(columns)) {
    for (const card of c.cards) onScreen.add(card.id);
    for (const card of c.justAdded ?? []) onScreen.add(card.id);
  }
  const kept: BirdseyeCard[] = [];
  for (const card of page.cards) {
    const status = pending.has(card.id) ? (pending.get(card.id) ?? null) : card.status;
    if (bucketFor(statuses, status) !== bucket) continue;
    if (onScreen.has(card.id)) continue;
    onScreen.add(card.id);
    kept.push(status === card.status ? card : { ...card, status });
  }
  return { ...columns, [bucket]: { ...col, cards: [...col.cards, ...kept], nextCursor: page.nextCursor } };
}

/** Append one page of an overview column: new ids only, in the page's order. */
export function mergeOverviewPage<C extends { cards: BirdseyeCard[]; nextCursor: string | null; justAdded?: BirdseyeCard[] }>(
  column: C,
  page: { cards: readonly BirdseyeCard[]; nextCursor: string | null },
): C {
  const seen = new Set<string>([...column.cards.map((c) => c.id), ...(column.justAdded ?? []).map((c) => c.id)]);
  const fresh: BirdseyeCard[] = [];
  for (const card of page.cards) {
    if (seen.has(card.id)) continue;
    seen.add(card.id);
    fresh.push(card);
  }
  return { ...column, cards: [...column.cards, ...fresh], nextCursor: page.nextCursor };
}

/** Does a card pass the toolbar's search and Hide closed, the way the server filters? */
export function cardMatchesFilters(
  card: Pick<BirdseyeCard, "title" | "status">,
  q: string,
  hideClosed: boolean,
  statuses: readonly StatusOption[],
): boolean {
  const needle = q.trim().toLowerCase();
  if (needle && !card.title.toLowerCase().includes(needle)) return false;
  if (hideClosed && isClosedStatus(statuses, card.status)) return false;
  return true;
}

/**
 * The tasks a person added in this visit, across reloads. A card the fresh
 * page now shows in its own place leaves the list; one the current filters
 * exclude is HIDDEN, never deleted, so clearing the search brings it back.
 * The list itself is dropped with the view: the next visit shows server truth.
 */
export function keepJustAdded(
  justAdded: readonly BirdseyeCard[],
  loadedIds: ReadonlySet<string>,
  q: string,
  hideClosed: boolean,
  statuses: readonly StatusOption[],
): { keep: BirdseyeCard[]; visible: BirdseyeCard[] } {
  const keep = justAdded.filter((c) => !loadedIds.has(c.id));
  return { keep, visible: keep.filter((c) => cardMatchesFilters(c, q, hideClosed, statuses)) };
}

// ── Counts ──────────────────────────────────────────────────────────

/** A List's summary numbers, as the column header and the status strip read them. */
export interface ListTally {
  total: number;
  statusCounts: Record<string, number>;
}

/**
 * Add (+1) or remove (-1) one task with `status` from a List's tally, the way
 * the server counts: into its column, and not at all when Hide closed is on
 * and the status is closed.
 */
export function countDelta<T extends ListTally>(
  tally: T,
  statuses: readonly StatusOption[],
  status: string | null,
  delta: 1 | -1,
  hideClosed: boolean,
): T {
  if (hideClosed && isClosedStatus(statuses, status)) return tally;
  const bucket = bucketFor(statuses, status);
  const statusCounts = { ...tally.statusCounts, [bucket]: Math.max(0, (tally.statusCounts[bucket] ?? 0) + delta) };
  if (statusCounts[bucket] === 0) delete statusCounts[bucket];
  return { ...tally, total: Math.max(0, tally.total + delta), statusCounts };
}

/** One task changed status: out of its old column's count, into its new one's. */
export function moveStatusCounts<T extends ListTally>(
  tally: T,
  statuses: readonly StatusOption[],
  from: string | null,
  to: string | null,
  hideClosed: boolean,
): T {
  if (from === to) return tally;
  return countDelta(countDelta(tally, statuses, from, -1, hideClosed), statuses, to, 1, hideClosed);
}

// ── Colour ──────────────────────────────────────────────────────────

const HEX_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const ARG = "\\s*-?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:%|deg)?\\s*";
const FN_RE = new RegExp(`^(?:rgba?|hsla?)\\(${ARG}(?:,${ARG}){2}(?:,${ARG})?\\)$`);
const VAR_RE = /^var\(--os-[a-z0-9-]+\)$/;
const NAME_RE = /^[a-z]{3,20}$/;

/**
 * A status colour, fit to put in a style. Statuses are user data, and the
 * colour lands inside color-mix(), so anything that is not a plain colour
 * (a url(), a second declaration, an expression) becomes the neutral ink.
 */
export function safeStatusColor(color: string | null | undefined): string {
  const c = typeof color === "string" ? color.trim() : "";
  if (HEX_RE.test(c) || FN_RE.test(c) || VAR_RE.test(c) || NAME_RE.test(c)) return c;
  return "var(--os-ink-3)";
}

/**
 * How much of the status colour each tinted surface takes, per theme. Dark
 * needs more, because a small share of a colour over a dark surface reads as
 * grey. `glyph` is the share of the status colour in the glyph, the rest
 * being the theme's lift (black on light, white on dark), so a pale yellow
 * status still draws a glyph that stands off its own tint.
 */
export const TINT_MIX = {
  light: { bg: 10, hover: 14, line: 28, pill: 16, glyph: 55 },
  dark: { bg: 16, hover: 22, line: 36, pill: 24, glyph: 55 },
} as const;

/**
 * The per-theme shares as CSS variables. A LITERAL string, because Tailwind
 * only generates classes it can read in the source; birdseye.test.ts pins
 * every number here to TINT_MIX, so the two can never drift.
 */
export const CARD_TINT_CLASS =
  "[--be-bg:10%] dark:[--be-bg:16%] hover:[--be-bg:14%] dark:hover:[--be-bg:22%] [--be-line:28%] dark:[--be-line:36%] [--be-pill:16%] dark:[--be-pill:24%] [--be-lift:black] dark:[--be-lift:white]";

/** The tinted surfaces, over the theme's surface token, reading the variables above. */
export const TINT_BG = "color-mix(in srgb, var(--be-c) var(--be-bg), var(--os-surface))";
export const TINT_LINE = "color-mix(in srgb, var(--be-c) var(--be-line), var(--os-surface))";
export const TINT_PILL = "color-mix(in srgb, var(--be-c) var(--be-pill), var(--os-surface))";
export const TINT_GLYPH = `color-mix(in srgb, var(--be-c) ${TINT_MIX.light.glyph}%, var(--be-lift))`;

/** Any status colour lifted for the theme the way a card's glyph is (a subtask's dot). */
export function liftedColor(color: string | null | undefined): string {
  return `color-mix(in srgb, ${safeStatusColor(color)} ${TINT_MIX.light.glyph}%, var(--be-lift))`;
}

/** The style that carries one status colour into a tinted element. */
export function tintVars(color: string | null | undefined): Record<string, string> {
  return { "--be-c": safeStatusColor(color) };
}

// ── Search and cursors ──────────────────────────────────────────────

/** A contains-pattern for `ILIKE ... ESCAPE '!'`: the three characters LIKE treats specially are escaped. */
export function likePattern(q: string): string {
  return `%${q.replace(/[!%_]/g, (m) => `!${m}`)}%`;
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const NUM_RE = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?$/i;
const RANK_RE = /^\d{1,4}$/;

export interface ListCursor {
  rank: number;
  position: number;
  id: string;
}

export interface BucketCursor {
  position: number;
  id: string;
}

function decodeNumber(s: string): number | null {
  if (!NUM_RE.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Where an overview column's next page starts: the last card's (column, position, id). */
export function encodeListCursor(rank: number, position: number, id: string): string {
  return `${rank}~${String(position)}~${id}`;
}

export function decodeListCursor(raw: string | null | undefined): ListCursor | null {
  if (typeof raw !== "string" || raw.length > 128) return null;
  const parts = raw.split("~");
  if (parts.length !== 3) return null;
  const [r, p, id] = parts;
  if (!RANK_RE.test(r) || !ID_RE.test(id)) return null;
  const position = decodeNumber(p);
  return position === null ? null : { rank: Number(r), position, id };
}

/** Where a focus column's next page starts: the last card's (position, id). */
export function encodeBucketCursor(position: number, id: string): string {
  return `${String(position)}~${id}`;
}

export function decodeBucketCursor(raw: string | null | undefined): BucketCursor | null {
  if (typeof raw !== "string" || raw.length > 128) return null;
  const parts = raw.split("~");
  if (parts.length !== 2) return null;
  const [p, id] = parts;
  if (!ID_RE.test(id)) return null;
  const position = decodeNumber(p);
  return position === null ? null : { position, id };
}

export type BirdseyeQuery =
  | { mode: "overview"; q: string; hideClosed: boolean; boardId: null; status: null; cursor: null }
  | { mode: "focus"; q: string; hideClosed: boolean; boardId: string; status: null; cursor: null }
  | { mode: "list-page"; q: string; hideClosed: boolean; boardId: string; status: null; cursor: ListCursor }
  | { mode: "focus-page"; q: string; hideClosed: boolean; boardId: string; status: string; cursor: BucketCursor };

/**
 * The four requests GET /api/spaces/[id]/birdseye answers, read strictly: a
 * combination that is none of them is an error, never a guess.
 *
 *   overview    (nothing)
 *   list-page   list + after (an overview column's next page)
 *   focus       focus
 *   focus-page  focus + status + after (a focus column's next page)
 *
 * `q` is trimmed and capped at 120 characters; a raw value over 200 is an
 * error rather than a silent cut of something pasted by mistake. A status is
 * 1 to 60 characters, the limit the List's own statuses schema allows.
 */
export function parseBirdseyeQuery(sp: URLSearchParams): BirdseyeQuery | { error: "bad_query" } {
  const bad = { error: "bad_query" as const };
  const rawQ = sp.get("q") ?? "";
  if (rawQ.length > 200) return bad;
  const q = rawQ.trim().slice(0, 120);
  const hideClosed = sp.get("closed") === "hide";
  const list = sp.get("list");
  const focus = sp.get("focus");
  const status = sp.get("status");
  const after = sp.get("after");

  if (list !== null && focus !== null) return bad;
  if (list !== null) {
    if (!ID_RE.test(list) || after === null || status !== null) return bad;
    const cursor = decodeListCursor(after);
    return cursor ? { mode: "list-page", q, hideClosed, boardId: list, status: null, cursor } : bad;
  }
  if (focus !== null) {
    if (!ID_RE.test(focus)) return bad;
    if (status === null && after === null) return { mode: "focus", q, hideClosed, boardId: focus, status: null, cursor: null };
    if (status === null || after === null || status.length < 1 || status.length > 60) return bad;
    const cursor = decodeBucketCursor(after);
    return cursor ? { mode: "focus-page", q, hideClosed, boardId: focus, status, cursor } : bad;
  }
  if (status !== null || after !== null) return bad;
  return { mode: "overview", q, hideClosed, boardId: null, status: null, cursor: null };
}

// ── Dates ───────────────────────────────────────────────────────────

/**
 * The card's due words: "Today", "Tomorrow", "Yesterday", "8 Sep", and the
 * year when it is not this year. The product's one due-chip grammar
 * (work-buckets.ts), so a date reads the same here as on My work.
 */
export function dueLabel(dueAt: string | null | undefined, now: Date): string | null {
  return dueChipLabel(dueAt ?? null, now);
}

/** Overdue: an OPEN task whose due day has passed where the viewer is. */
export function isOverdue(dueAt: string | null | undefined, now: Date, active: boolean): boolean {
  return active && !!dueAt && dueBucketFor(dueAt, now) === "overdue";
}

// ── Rows from the item routes ───────────────────────────────────────

/** What cardFromRow reads off a BoardItemRow or a GET /api/items/[id] item. */
export interface CardSourceRow {
  id: string;
  boardId?: string | null;
  title: string;
  status: string | null;
  position?: number | null;
  dueAt?: string | Date | null;
  metadata?: unknown;
  assigneeIds?: string[] | null;
  assignees?: ReadonlyArray<{ id: string; firstName?: string | null; lastName?: string | null; avatar?: string | null }> | null;
  owner?: { id: string; firstName?: string | null; lastName?: string | null; avatar?: string | null } | null;
  subtaskCount?: unknown;
}

/**
 * A description counts when it has a visible character once tags, &nbsp; and
 * whitespace are gone, so an editor's empty "<p></p>" does not light the icon.
 * The loader's SQL applies the same test.
 */
export function descriptionPresent(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const d = (metadata as Record<string, unknown>).description;
  return typeof d === "string" && d.replace(/<[^>]*>|&nbsp;|\s+/g, "") !== "";
}

function isoOrNull(v: string | Date | null | undefined): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function person(p: { id: string; firstName?: string | null; lastName?: string | null; avatar?: string | null }): BirdseyePerson {
  return { id: p.id, firstName: p.firstName ?? null, lastName: p.lastName ?? null, avatar: p.avatar ?? null };
}

/**
 * A card from what a write or a re-read answered.
 *
 * The subtask count is the one field those answers cannot be trusted with:
 * a PATCH answer counts live children on ANY List, while the pill counts the
 * scope the subtasks route opens (the same List, live). So a card that is
 * already on screen keeps the count it has (the loader's, or a refresh from
 * the subtasks route), and only a brand new card takes the answer's number.
 */
export function cardFromRow(row: CardSourceRow, prev?: BirdseyeCard | null): BirdseyeCard {
  const people = row.assignees && row.assignees.length > 0 ? row.assignees : row.owner ? [row.owner] : [];
  const payloadCount = typeof row.subtaskCount === "number" && Number.isFinite(row.subtaskCount) ? row.subtaskCount : null;
  return {
    id: row.id,
    boardId: row.boardId ?? prev?.boardId ?? "",
    title: row.title,
    status: row.status ?? null,
    position: typeof row.position === "number" && Number.isFinite(row.position) ? row.position : (prev?.position ?? 0),
    rank: prev?.rank ?? 0,
    dueAt: isoOrNull(row.dueAt),
    hasDescription: descriptionPresent(row.metadata),
    subtaskCount: prev ? prev.subtaskCount : (payloadCount ?? 0),
    assignees: people.slice(0, 2).map(person),
    assigneeCount: row.assigneeIds ? row.assigneeIds.length : people.length,
  };
}
