"use client";

// Settings > Data's cards, drawn from what the page has read (settings-
// cleanup Phase 6). They hold no read of their own, so each is rendered and
// tested over the states it shows: the recent exports table, the Trash link
// card, the Marketing (legacy) card, and the export button every download
// row uses. The page keeps every fetch, write and confirm.

import Link from "next/link";
import type { Ref } from "react";
import { Download, Megaphone, type LucideIcon } from "lucide-react";
import { DateText } from "@/components/ui/date-text";
import { Dots } from "@/components/ui/dots";
import { ErrorState } from "@/components/ui/error-state";
import { SettingsCard } from "@/components/settings/settings-card";
import { SettingsRow } from "@/components/settings/settings-row";
import { Pending, btn } from "@/components/settings/settings-form";
import type { LegacyMarketingCounts, LegacyMarketingReport, LegacyPending } from "@/lib/marketing/legacy-import";
import { LIST_NAME, MARKETING_KINDS, type MarketingKind } from "@/lib/marketing/legacy-map";

export type ExportRow = {
  key: string;
  href: string;
  fallbackName: string;
  icon?: LucideIcon;
  title: string;
  /** The row's hint: what the download holds and anything pressing it costs. */
  desc: string;
  /** The rest, behind the row's Show more. */
  more?: string[];
};

/** One recent export, as GET /api/settings/data-summary lists it. */
export type RecentExport = { id: string; when: string; who: string; what: string; kind: string | null; status?: string | null };

/**
 * The recent exports, a plain table inside its card: hairline rows, no box
 * of its own (B4), in the order My settings > Security lists its recent
 * activity: what happened first, then who, then when. Below 640px the three
 * columns fit the card instead of scrolling past it; a name breaks only
 * between its words, and a date never breaks.
 */
export function RecentExportsTable({ rows }: { rows: RecentExport[] }) {
  return (
    <div className="overflow-x-auto">
      <table aria-label="Recent exports" className="w-full min-w-[480px] border-collapse text-base max-[640px]:min-w-0">
        <thead>
          <tr className="h-11 text-sm text-ink-2">
            {/* The first column starts on the card's own text edge, under its title. */}
            <th className="pe-2 text-start font-medium">What</th>
            <th className="w-[180px] px-2 text-start font-medium max-[640px]:w-auto">Who</th>
            <th className="w-[120px] ps-2 text-start font-medium max-[640px]:w-auto">When</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr className="border-t border-line-soft">
              <td colSpan={3} className="h-[var(--os-row-h,44px)] text-ink-2">No exports yet</td>
            </tr>
          ) : (
            rows.map((e) => (
              <tr key={e.id} className="h-[var(--os-row-h,44px)] border-t border-line-soft">
                <td className="pe-2 text-ink">{e.what}</td>
                <td className="px-2 text-ink">{e.who}</td>
                <td className="whitespace-nowrap ps-2 text-ink-2"><DateText value={e.when} style="relative" /></td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/** What stays in storage after a delete for good: the Trash card's last line, and the Trash window row's Show more. */
export const STORAGE_LINE = "Images and files inside Docs, and anything else not kept in Files, stay in storage after they are deleted for good, as do some files uploaded before 6 October 2026: email privacy@workwrk.com and we delete them by hand.";

/**
 * Data > Trash, a link card (B4): what Trash keeps is its line (the
 * consequence, so it is shown, not folded away), the link with the live count
 * on the same line (it arrives after the first paint and moves nothing), and
 * what stays in storage after a delete for good as the card's last line. No
 * illustration: those are for empty states only (design-system 5.8).
 */
export function TrashCard({ purges, info }: { purges: boolean; info: { total: number; capped: boolean; retentionDays: number } | null }) {
  const i = info;
  return (
    <SettingsCard
      title="Trash"
      id="data.trash"
      description={purges
        ? `Deleted items wait in Trash${i ? ` for ${i.retentionDays} days` : ""}, then are deleted for good. Docs, canvases and contracts moved to Trash stay there until an Owner or Admin deletes them.`
        : "Deleted Spaces, Lists, Docs and tasks stay in Trash until an Owner or Admin deletes them for good."}
    >
      <p className="m-0">
        <Link href="/trash" className="text-base font-medium text-brand-deep hover:underline">Open Trash</Link>
        {i ? <span className="text-sm text-ink-2"> · {i.total}{i.capped ? "+" : ""} {i.total === 1 ? "item" : "items"} in Trash</span> : null}
      </p>
      <p className="m-0 text-sm text-ink-2">{STORAGE_LINE}</p>
    </SettingsCard>
  );
}

// ── Marketing (legacy) ──────────────────────────────────────────────
//
// The retired Marketing module's rows (Campaign, ContentItem, EventBrief)
// have no page any more: /marketing resolves here for an Owner or Admin
// until the import has run (spec-tools-misc section 2.7). The section
// renders only for an org that holds such rows or has already imported
// them, exactly as the legacy Purchase-order and Invoice exports do. It
// is the minimal entry, re-homed on Settings > Data > Import (and kept on
// Export for its legacy CSV downloads).
//
// Arriving with ?legacy=marketing (the /marketing resolver sends an Owner or
// Admin here) scrolls to the row and pulses it once. For a workspace that
// never held a row, that arrival still gets a sentence and the template link
// instead of a page with nothing highlighted; and a failed read shows as a
// failed read with a retry, since this row is what the redirect exists for.
//
// ONCE THE SPACE EXISTS the row keeps offering Preview and Import for as
// long as a write has something to do: a row never moved (or whose task was
// deleted for good from Trash, which the /marketing/{id} toast sends people
// here to fix), a moved task whose dates still wait to be anchored, and the
// run's own "stopped part-way, run it again" case. The copy counts what was
// moved, never the raw legacy count, so it never claims a row lives in the
// Space when it does not.
//
// A ROW WHOSE TASK IS IN TRASH IS MOVED, NOT WAITING. The row says so in one
// sentence and points at Trash, and nothing here offers to import it: Import
// would make a second task beside the one in Trash, and restoring that one
// would then make two (legacy-map.ts "Moved or not").

export type LegacyState = {
  counts: LegacyMarketingCounts;
  hasRows: boolean;
  migrated: { spaceSlug: string; lists: Partial<Record<MarketingKind, string>>; archived?: boolean } | null;
  /** Rows whose task is live today, per kind; the rest wait (`pending.toWrite`) or are in Trash (`pending.trashed`). */
  moved: LegacyMarketingCounts;
  /** What a write would still do; null until the Space exists (before that, everything is pending). */
  pending: LegacyPending | null;
};

const MARKETING_TEMPLATE_HREF = "/templates?q=marketing";
const TRASH_SPACES_HREF = "/trash?type=space";
// Not narrowed to tasks: a task deleted with its List or Space sits in Trash
// as that List or Space, and an archived one is on the Archived tab.
const TRASH_HREF = "/trash";

const LEGACY_CSV: ExportRow[] = MARKETING_KINDS.map((kind) => ({
  key: `marketing-${kind}`,
  href: `/api/marketing/legacy/export?entity=${kind}`,
  fallbackName: `marketing-${kind}.csv`,
  icon: Megaphone,
  title: `Marketing (legacy) ${LIST_NAME[kind]} CSV`,
  desc: kind === "campaigns"
    ? "Every campaign with budget, spend, dates, goal and its own currency."
    : kind === "content"
      ? "Every content piece with type, channel, dates and links."
      : "Every event with format, dates, capacity, registrations and spend.",
}));

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function summarise(c: LegacyMarketingCounts): string {
  return [plural(c.campaigns, "campaign", "campaigns"), plural(c.content, "content piece", "content pieces"), plural(c.events, "event", "events")].join(", ");
}

/** "5 of 6 campaigns, 3 content pieces, 2 events": the moved count against the legacy count where they differ. */
function summariseMoved(moved: LegacyMarketingCounts, all: LegacyMarketingCounts): string {
  const part = (kind: MarketingKind, one: string, many: string) =>
    moved[kind] === all[kind] ? plural(all[kind], one, many) : `${moved[kind]} of ${plural(all[kind], one, many)}`;
  return [part("campaigns", "campaign", "campaigns"), part("content", "content piece", "content pieces"), part("events", "event", "events")].join(", ");
}

/** The rows a write would still bring over, in words: "1 campaign and 2 events". */
function summarisePending(p: LegacyMarketingCounts): string {
  const parts = [
    p.campaigns ? plural(p.campaigns, "campaign", "campaigns") : null,
    p.content ? plural(p.content, "content piece", "content pieces") : null,
    p.events ? plural(p.events, "event", "events") : null,
  ].filter((x): x is string => Boolean(x));
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

export interface MarketingLegacyCardProps {
  /** The card's outer element, which the page scrolls to on ?legacy=marketing. */
  cardRef?: Ref<HTMLDivElement>;
  /** What GET /api/marketing/legacy answered, or "error" when it failed. */
  state: LegacyState | "error";
  /** The person arrived from /marketing (?legacy=marketing). */
  wanted: boolean;
  /** The one-time landing pulse is on. */
  pulse: boolean;
  preview: LegacyMarketingReport | null;
  running: "preview" | "import" | null;
  busy: string | null;
  onRetry: () => void;
  /** Preview (false) or Import (true): the page confirms an Import first. */
  onRun: (write: boolean) => void;
  onExport: (row: ExportRow) => void;
}

/**
 * Import's Marketing (legacy), one SettingsCard with ordinary rows (settings-
 * cleanup Phase 6, B4 and B8): what the module left and where it lives as the
 * card's line (every word kept: it is what Import does and does not do), its
 * buttons, the preview's lines, then the three CSVs. Never a box with an
 * icon and lighter grey text, and Import is a secondary button, never a
 * second blue one beside the tab's "Import N people". Draws nothing for a
 * workspace that never held a row, unless /marketing sent the person here.
 */
export function MarketingLegacyCard({ cardRef, state, wanted, pulse, preview, running, busy, onRetry, onRun, onExport }: MarketingLegacyCardProps) {
  // Arriving from /marketing pulses the card once: its border and a soft
  // ring, a colour change only (no transform), as a landed card's does.
  const pulseClass = pulse ? "border-brand shadow-[0_0_0_4px_var(--os-brand-soft)]" : undefined;

  // The read failed: say so, with the retry, rather than hiding the one card
  // the /marketing redirect exists to reach.
  if (state === "error") {
    return (
      <div ref={cardRef}>
        <SettingsCard title="Marketing (legacy)" className={pulseClass}>
          <ErrorState compact what="the Marketing (legacy) rows" title="Couldn't check whether this workspace has anything from the retired Marketing module." onRetry={onRetry} />
        </SettingsCard>
      </div>
    );
  }

  // Nothing to import and nothing imported: the card stays away, except
  // for a person the /marketing redirect sent here, who is told why and
  // pointed at the template the old module became.
  if (!state.hasRows && !state.migrated) {
    if (!wanted) return null;
    return (
      <div ref={cardRef}>
        <SettingsCard
          title="Marketing (legacy)"
          className={pulseClass}
          description="The Marketing module is retired and this workspace never held a campaign, content piece or event in it. Campaigns, content and events live in a Space now: start one from the Marketing template."
          actions={<Link href={MARKETING_TEMPLATE_HREF} className={btn.link}>Open the template</Link>}
        />
      </div>
    );
  }

  const spaceHref = state.migrated ? `/spaces/${state.migrated.spaceSlug}` : null;
  const archived = Boolean(state.migrated?.archived);
  const written = preview ? MARKETING_KINDS.reduce((n, k) => n + preview.kinds[k].written, 0) : 0;
  const relinked = preview ? MARKETING_KINDS.reduce((n, k) => n + preview.kinds[k].relinked, 0) : 0;
  const redated = preview ? MARKETING_KINDS.reduce((n, k) => n + preview.kinds[k].redated, 0) : 0;
  const waiting = state.pending ? state.pending.toWrite.campaigns + state.pending.toWrite.content + state.pending.toWrite.events : 0;
  const toRedate = state.pending?.toRedate ?? 0;
  const inTrash = state.pending ? state.pending.trashed.campaigns + state.pending.trashed.content + state.pending.trashed.events : 0;
  // Import stays on offer while a write has work left, and after a run that
  // stopped part-way (its toast says to run it again, so the button must be
  // there to press). A Space in Trash blocks the write, so not then.
  const importable = !archived && (!spaceHref || waiting > 0 || toRedate > 0 || Boolean(preview?.error));

  // One card with ordinary rows (settings-cleanup Phase 6): what the module
  // left and where it lives as the card's line (every word kept: it is what
  // Import does and does not do), its buttons, the preview's lines, then the
  // three CSVs. Import is a secondary button, never a second blue one.
  return (
    <div ref={cardRef}>
      <SettingsCard
        title="Marketing (legacy)"
        className={pulseClass}
        description={
          archived ? (
            <>{summarise(state.counts)} from the retired Marketing module. Their Marketing Space is in Trash; the old /marketing links still open there. Restore it to bring it back.</>
          ) : spaceHref ? (
            <>
              {summariseMoved(state.moved, state.counts)} from the retired Marketing module {waiting > 0 ? "moved to" : "live in"} the Marketing Space; the old /marketing links open there.
              {waiting > 0 ? <> {summarisePending(state.pending!.toWrite)} still {waiting === 1 ? "waits" : "wait"}: Import brings {waiting === 1 ? "it" : "them"} over, and nothing is deleted.</> : null}
              {inTrash > 0 ? <> {summarisePending(state.pending!.trashed)} moved, then put in Trash. Restore {inTrash === 1 ? "it" : "them"} from Trash.</> : null}
              {toRedate > 0 ? <> {plural(toRedate, "moved task carries its date", "moved tasks carry their dates")} as the old module stored {toRedate === 1 ? "it" : "them"}, without a time zone; Import sets {toRedate === 1 ? "it" : "them"} to midnight in {state.pending!.zone}.</> : null}
              {" "}Everyone can view the Space; add people to it to let them edit.
            </>
          ) : (
            <>{summarise(state.counts)} from the retired Marketing module. Import them as tasks in a Marketing Space with Campaigns, Content and Events Lists. Nothing is deleted.</>
          )
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          {archived ? <Link href={TRASH_SPACES_HREF} className={btn.secondary}>Open Trash</Link> : null}
          {spaceHref && !archived ? <Link href={spaceHref} className={btn.secondary}>Open the Space</Link> : null}
          {!archived && inTrash > 0 ? <Link href={TRASH_HREF} className={btn.secondary}>Open Trash</Link> : null}
          {importable ? (
            <>
              <button type="button" onClick={() => onRun(false)} disabled={running !== null} className={btn.secondary}>
                {running === "preview" ? <Dots variant="pending" /> : null}
                Preview
              </button>
              <button type="button" onClick={() => onRun(true)} disabled={running !== null} className={btn.secondary}>
                {running === "import" ? <Dots variant="pending" /> : null}
                Import
              </button>
            </>
          ) : null}
        </div>
        {preview && !preview.blocked ? (
          <div className="flex flex-col gap-1 text-sm text-ink-2">
            <p className="m-0 font-medium text-ink">{preview.write ? "Imported" : "Preview"}: {plural(written, "task", "tasks")}{preview.write ? "" : " would be created"}{relinked ? `, ${plural(relinked, "task", "tasks")} already there re-linked` : ""}{redated ? `, ${plural(redated, "moved task", "moved tasks")} ${preview.write ? "re-dated" : "to re-date"} to midnight in ${preview.dateZone ?? "the import zone"}` : ""}</p>
            {MARKETING_KINDS.map((k) => {
              const r = preview.kinds[k];
              const notes: string[] = [];
              if (r.alreadyMigrated) notes.push(`${r.alreadyMigrated} already moved`);
              if (r.relinked) notes.push(`${r.relinked} re-linked`);
              if (r.trashed) notes.push(`${r.trashed} in Trash, not imported again`);
              if (r.statusMoved) notes.push(`${r.statusMoved} status changed`);
              if (r.ownerDropped) notes.push(`${r.ownerDropped} owner no longer a member`);
              if (r.currencyMismatch) notes.push(`${r.currencyMismatch} in another currency`);
              if (r.redated) notes.push(`${r.redated} already moved, ${preview.write ? "dates anchored" : "dates to anchor"}`);
              for (const u of r.unmappedStatuses) notes.push(`${u.count} with status ${u.value} land on the first status`);
              for (const f of r.unmappedFields) notes.push(`${f.field} folded into the description on ${f.count}`);
              return (
                <p key={k} className="m-0">
                  {LIST_NAME[k]}: {r.read} read, {r.written} {preview.write ? "written" : "to write"}{notes.length ? ` (${notes.join("; ")})` : ""}
                </p>
              );
            })}
            {preview.error ? <p className="m-0 text-danger-text">Stopped part-way: {preview.error}. What moved is kept; run Import again to finish.</p> : null}
          </div>
        ) : null}
        <div>
          {LEGACY_CSV.map((row) => (
            <SettingsRow key={row.key} label={`${LIST_NAME[row.key.slice("marketing-".length) as MarketingKind] ?? row.title} as a CSV`} helper={row.desc} control={<ExportButton row={row} busy={busy} onRun={onExport} />} />
          ))}
        </div>
      </SettingsCard>
    </div>
  );
}

/** The last export's line: running while the server is writing it, "did not finish" when it started and is no longer being written or stopped. */
export function exportLine(last: { who: string; when: string; status?: string | null }, running: boolean): string {
  if (last.status === "started" && running) return `An export by ${last.who} is running, started `;
  if (last.status === "started" || last.status === "stopped") return `The last export by ${last.who} did not finish, `;
  return `Last exported by ${last.who}, `;
}

export function ExportButton({
  row, busy, progress, onRun,
}: {
  row: ExportRow;
  busy: string | null;
  /** How much has arrived, while this export downloads. */
  progress?: string | null;
  onRun: (row: ExportRow) => void;
}) {
  const isBusy = busy === row.key;
  return (
    <button
      type="button"
      onClick={() => onRun(row)}
      disabled={busy !== null}
      className={btn.secondary}
      aria-label={isBusy && progress ? `Downloading ${row.title || "the export"}: ${progress} so far` : row.title ? `Download ${row.title}` : "Download"}
    >
      {isBusy ? <Pending label={progress ? `Downloading ${progress}` : "Preparing"} /> : <Download className="h-4 w-4" strokeWidth={1.5} aria-hidden />}
      {isBusy && progress ? progress : "Download"}
    </button>
  );
}
