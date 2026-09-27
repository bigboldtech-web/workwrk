"use client";

/* Settings · Data & compliance — Admin-only export + data-governance hub.
 *
 * Every download here targets a REAL, already-shipped export endpoint.
 * No new export APIs are invented on the page; it only surfaces the
 * ones that exist and were previously dead code (no UI):
 *
 *   GET /api/export/all               → org-wide ZIP (people, tasks,
 *                                        reviews, SOPs, KRAs, meetings,
 *                                        activity + manifest.json)
 *   GET /api/export/people            → people roster CSV
 *   GET /api/export/[type]            → per-type CSV; supported types are
 *                                        timesheets | purchase-orders |
 *                                        invoices | audit
 *
 * The two governance links point at the existing import surface
 * (/imports) and the org recycle bin (/trash). Server-gated to the two
 * protected admin tiers by layout.tsx (requireOrgAdminOrRedirect).
 */

import { Dots } from "@/components/ui/dots";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Database,
  Users,
  Clock,
  ShoppingCart,
  Receipt,
  ScrollText,
  Upload,
  Trash2,
  Download,
  ChevronRight,
  Megaphone,
  type LucideIcon,
} from "lucide-react";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { SETTINGS_PAGES } from "@/lib/settings-registry";
import { useOsToast } from "@/components/layout/os/toast";
import { apiFetch } from "@/lib/api-fetch";
import { useConfirm } from "@/components/ui/dialog-provider";
import type { LegacyMarketingCounts, LegacyMarketingReport, LegacyPending } from "@/lib/marketing/legacy-import";
import { LIST_NAME, MARKETING_KINDS, type MarketingKind } from "@/lib/marketing/legacy-map";

type ExportRow = {
  key: string;
  href: string;
  fallbackName: string;
  icon: LucideIcon;
  title: string;
  desc: string;
};

// Full-org archive — the heaviest, most sensitive export. Kept in its
// own section so the ZIP scope reads clearly before the granular CSVs.
const FULL_EXPORT: ExportRow = {
  key: "all",
  href: "/api/export/all",
  fallbackName: "workwrk-export.zip",
  icon: Database,
  title: "Full organization export",
  desc: "Everything as a ZIP of CSVs + manifest: people, departments, tasks, SOPs, reviews, meetings, KRAs, activity.",
};

// Granular CSVs. Each maps to a supported export endpoint; the four
// per-type rows all resolve through /api/export/[type], which only
// accepts these four type slugs.
const CSV_EXPORTS: ExportRow[] = [
  {
    key: "people",
    href: "/api/export/people",
    fallbackName: "people-export.csv",
    icon: Users,
    title: "People roster",
    desc: "Active members with department, role, join date and rolling performance score.",
  },
  {
    key: "timesheets",
    href: "/api/export/timesheets",
    fallbackName: "timesheets.csv",
    icon: Clock,
    title: "Timesheets",
    desc: "Submitted timesheets with total hours, status and approver.",
  },
  {
    key: "purchase-orders",
    href: "/api/export/purchase-orders",
    fallbackName: "purchase-orders.csv",
    icon: ShoppingCart,
    title: "Purchase orders",
    desc: "Purchase orders with vendor, amount, status, requester and approver.",
  },
  {
    key: "invoices",
    href: "/api/export/invoices",
    fallbackName: "invoices.csv",
    icon: Receipt,
    title: "Invoices",
    desc: "Invoices with vendor, linked PO, due date, amount and payment status.",
  },
  {
    key: "audit",
    href: "/api/export/audit",
    fallbackName: "audit.csv",
    icon: ScrollText,
    title: "Audit trail",
    desc: "Full activity log as CSV: actor, action, severity, target and IP.",
  },
];

// Governance destinations that already have their own pages.
const GOVERNANCE = [
  {
    href: "/imports",
    icon: Upload,
    title: "Import data",
    // People import is Phase 8 (Settings > Data > Import); until it lands
    // /imports brings a CSV into a table and nothing else, so it says only that.
    desc: "Bring a CSV file into a new table or one you already have.",
  },
  {
    href: "/trash",
    icon: Trash2,
    title: "Trash",
    desc: "Recover deleted documents, tables and files within their retention window.",
  },
] as const;

// Parse the download filename from Content-Disposition, tolerating both
// `filename="x"` and RFC 5987 `filename*=UTF-8''x` forms. Falls back to
// the caller-supplied name when the header is absent.
function filenameFromDisposition(cd: string, fallback: string): string {
  const star = /filename\*=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
  if (star?.[1]) {
    try { return decodeURIComponent(star[1]); } catch { return star[1]; }
  }
  const plain = /filename="?([^";]+)"?/i.exec(cd);
  return plain?.[1] ?? fallback;
}

export default function DataCompliancePage() {
  const { toast } = useOsToast();
  const [busy, setBusy] = useState<string | null>(null);

  const download = useCallback(async (row: ExportRow) => {
    if (busy) return;
    setBusy(row.key);
    try {
      const res = await fetch(row.href, { cache: "no-store" });
      if (!res.ok) {
        let msg = `Export failed (HTTP ${res.status})`;
        if (res.status === 403) msg = "You don't have permission to run this export.";
        else if (res.status === 401) msg = "Your session expired — sign in again.";
        else if (res.status === 503) msg = "Export is temporarily unavailable. Try again shortly.";
        else {
          const body = await res.json().catch(() => null);
          if (body && typeof body.error === "string") msg = body.error;
        }
        toast(msg);
        return;
      }
      const blob = await res.blob();
      if (blob.size === 0) {
        toast("Nothing to export yet — this dataset is empty.");
        return;
      }
      const filename = filenameFromDisposition(
        res.headers.get("Content-Disposition") ?? "",
        row.fallbackName,
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast(`Exported ${filename}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(null);
    }
  }, [busy, toast]);

  return (
    <div className="flex h-full flex-col">
      <OsPageHeader title={SETTINGS_PAGES.data.label} />

      <div className="flex-1 overflow-y-auto px-6 pt-4 pb-10">
        <p className="mb-6 max-w-2xl text-base text-zinc-500">
          Download a full copy of this organization&rsquo;s data for compliance,
          backup or migration. Every export is admin-only and recorded in the audit trail.
        </p>

        <div className="max-w-2xl space-y-7">
          <Section label="Full export">
            <ExportButton row={FULL_EXPORT} busy={busy} onRun={download} />
          </Section>

          <Section label="Data exports (CSV)">
            {CSV_EXPORTS.map((row) => (
              <ExportButton key={row.key} row={row} busy={busy} onRun={download} />
            ))}
          </Section>

          <LegacyMarketingSection busy={busy} onExport={download} />

          <Section label="Governance">
            {GOVERNANCE.map(({ href, icon: Icon, title, desc }) => (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 hover:border-zinc-300 hover:bg-zinc-50"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-zinc-100 text-zinc-500">
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-base font-medium text-zinc-900">{title}</div>
                  <div className="text-base text-zinc-500">{desc}</div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-zinc-400" />
              </Link>
            ))}
          </Section>
        </div>
      </div>
    </div>
  );
}

// ── Marketing (legacy) ──────────────────────────────────────────────
//
// The retired Marketing module's rows (Campaign, ContentItem, EventBrief)
// have no page any more: /marketing resolves here for an Owner or Admin
// until the import has run (spec-tools-misc section 2.7). The section
// renders only for an org that holds such rows or has already imported
// them, exactly as the legacy Purchase-order and Invoice exports do. It
// is the minimal entry; Phase 8's Settings > Data > Import tab re-homes it.
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

type LegacyState = {
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

function LegacyMarketingSection({ busy, onExport }: { busy: string | null; onExport: (row: ExportRow) => void }) {
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const params = useSearchParams();
  const wanted = params.get("legacy") === "marketing";
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<LegacyState | null | "error">(null);
  const [preview, setPreview] = useState<LegacyMarketingReport | null>(null);
  const [running, setRunning] = useState<"preview" | "import" | null>(null);
  const [pulse, setPulse] = useState(false);

  const load = useCallback(async () => {
    setState(null);
    const r = await apiFetch<LegacyState>("/api/marketing/legacy");
    setState(r.ok ? r.data : "error");
  }, []);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!wanted || !state || !ref.current) return;
    ref.current.scrollIntoView({ block: "center", behavior: "smooth" });
    setPulse(true);
    const t = window.setTimeout(() => setPulse(false), 2400);
    return () => window.clearTimeout(t);
  }, [wanted, state]);

  const run = useCallback(async (write: boolean) => {
    if (running) return;
    if (write) {
      const ok = await confirm({
        title: "Import the Marketing module?",
        description: "A Marketing Space with Campaigns, Content and Events Lists is created and every row becomes a task there. The old rows stay where they are; nothing is deleted. Everyone in the workspace can view the Space; add people to it afterwards to let them edit, since the old pages let anyone edit.",
        confirmLabel: "Import",
      });
      if (!ok) return;
    }
    setRunning(write ? "import" : "preview");
    try {
      const r = await apiFetch<{ report: LegacyMarketingReport }>("/api/marketing/legacy", { method: "POST", json: { write } });
      if (!r.ok) {
        // A blocked run (template not ready, another import running, the
        // Space in Trash) comes back in plain words; the state may have moved
        // under us, so read it again either way.
        toast(r.error, { tone: "danger" });
        if (write) await load();
        return;
      }
      setPreview(r.data.report);
      if (write) {
        if (r.data.report.error) toast("The import stopped part-way. What moved is kept; run it again to finish.", { tone: "danger" });
        else toast("Marketing imported. Everyone can view the Space; add people to it to let them edit.");
        await load();
      }
    } finally {
      setRunning(null);
    }
  }, [confirm, load, running, toast]);

  // Still reading: nothing yet (the section appears when the answer does).
  if (!state) return null;

  // The read failed: say so, with the retry, rather than hiding the one row
  // the /marketing redirect exists to reach.
  if (state === "error") {
    return (
      <Section label="Legacy">
        <div ref={ref} className="flex items-center gap-3 rounded-xl border border-line bg-raised px-4 py-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-subtle text-ink-3">
            <Megaphone className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-base font-medium text-ink">Marketing (legacy)</div>
            <div className="text-base text-ink-3">Couldn&rsquo;t check whether this workspace has anything from the retired Marketing module.</div>
          </div>
          <button type="button" onClick={() => void load()} className="inline-flex h-8 shrink-0 items-center rounded-md border border-line bg-raised px-3 text-sm font-medium text-ink hover:bg-hover">
            Try again
          </button>
        </div>
      </Section>
    );
  }

  // Nothing to import and nothing imported: the section stays away, except
  // for a person the /marketing redirect sent here, who is told why and
  // pointed at the template the old module became.
  if (!state.hasRows && !state.migrated) {
    if (!wanted) return null;
    return (
      <Section label="Legacy">
        <div ref={ref} className={`flex items-center gap-3 rounded-xl border bg-raised px-4 py-3 transition-shadow duration-500 ${pulse ? "border-brand shadow-[0_0_0_4px_var(--os-brand-soft)]" : "border-line"}`}>
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-subtle text-ink-3">
            <Megaphone className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-base font-medium text-ink">Marketing (legacy)</div>
            <div className="text-base text-ink-3">The Marketing module is retired and this workspace never held a campaign, content piece or event in it. Campaigns, content and events live in a Space now: start one from the Marketing template.</div>
          </div>
          <Link href={MARKETING_TEMPLATE_HREF} className="inline-flex h-8 shrink-0 items-center rounded-md border border-line bg-raised px-3 text-sm font-medium text-ink hover:bg-hover">
            Open the template
          </Link>
        </div>
      </Section>
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

  return (
    <Section label="Legacy">
      <div
        ref={ref}
        className={`rounded-xl border bg-raised px-4 py-3 transition-shadow duration-500 ${pulse ? "border-brand shadow-[0_0_0_4px_var(--os-brand-soft)]" : "border-line"}`}
      >
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-subtle text-ink-3">
            <Megaphone className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-base font-medium text-ink">Marketing (legacy)</div>
            <div className="text-base text-ink-3">
              {archived ? (
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
              )}
            </div>
            {preview && !preview.blocked ? (
              <div className="mt-2 rounded-lg bg-subtle px-3 py-2 text-sm text-ink-2">
                <div className="font-medium text-ink">{preview.write ? "Imported" : "Preview"}: {plural(written, "task", "tasks")}{preview.write ? "" : " would be created"}{relinked ? `, ${plural(relinked, "task", "tasks")} already there re-linked` : ""}{redated ? `, ${plural(redated, "moved task", "moved tasks")} ${preview.write ? "re-dated" : "to re-date"} to midnight in ${preview.dateZone ?? "the import zone"}` : ""}</div>
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
                    <div key={k}>
                      {LIST_NAME[k]}: {r.read} read, {r.written} {preview.write ? "written" : "to write"}{notes.length ? ` (${notes.join("; ")})` : ""}
                    </div>
                  );
                })}
                {preview.error ? <div className="mt-1 text-danger-text">Stopped part-way: {preview.error}. What moved is kept; run Import again to finish.</div> : null}
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {archived ? (
              <Link href={TRASH_SPACES_HREF} className="inline-flex h-8 items-center rounded-md border border-line bg-raised px-3 text-sm font-medium text-ink hover:bg-hover">
                Open Trash
              </Link>
            ) : null}
            {spaceHref && !archived ? (
              <Link href={spaceHref} className="inline-flex h-8 items-center rounded-md border border-line bg-raised px-3 text-sm font-medium text-ink hover:bg-hover">
                Open the Space
              </Link>
            ) : null}
            {!archived && inTrash > 0 ? (
              <Link href={TRASH_HREF} className="inline-flex h-8 items-center rounded-md border border-line bg-raised px-3 text-sm font-medium text-ink hover:bg-hover">
                Open Trash
              </Link>
            ) : null}
            {importable ? (
              <>
                <button
                  type="button"
                  onClick={() => void run(false)}
                  disabled={running !== null}
                  className="inline-flex h-8 items-center gap-2 rounded-md border border-line bg-raised px-3 text-sm font-medium text-ink hover:bg-hover disabled:opacity-50"
                >
                  {running === "preview" ? <Dots variant="pending" /> : null}
                  Preview
                </button>
                <button
                  type="button"
                  onClick={() => void run(true)}
                  disabled={running !== null}
                  className="inline-flex h-8 items-center gap-2 rounded-md bg-brand px-3 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50"
                >
                  {running === "import" ? <Dots variant="pending" /> : null}
                  Import
                </button>
              </>
            ) : null}
          </div>
        </div>
      </div>
      {LEGACY_CSV.map((row) => (
        <ExportButton key={row.key} row={row} busy={busy} onRun={onExport} />
      ))}
    </Section>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
        {label}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function ExportButton({
  row, busy, onRun,
}: {
  row: ExportRow;
  busy: string | null;
  onRun: (row: ExportRow) => void;
}) {
  const Icon = row.icon;
  const isBusy = busy === row.key;
  const disabled = busy !== null;
  return (
    <button
      type="button"
      onClick={() => onRun(row)}
      disabled={disabled}
      className="flex w-full items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-left hover:border-zinc-300 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-zinc-100 text-zinc-500">
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-base font-medium text-zinc-900">{row.title}</div>
        <div className="text-base text-zinc-500">{row.desc}</div>
      </div>
      {isBusy ? (
        <Dots variant="pending" />
      ) : (
        <Download className="h-4 w-4 shrink-0 text-zinc-400" />
      )}
    </button>
  );
}
