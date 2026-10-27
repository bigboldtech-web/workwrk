"use client";

// Workspace settings > Data (spec-settings-workspace `/settings/data`,
// settings-architecture 5.10). Tabs:
//
//   Export               Full workspace (ZIP: people, Spaces, Folders,
//                        Lists, every task, Docs, Tables, Goals, reviews,
//                        SOPs, KRAs, meetings), People (CSV), Timesheets
//                        (CSV), Audit log (CSV); under Legacy, Purchase
//                        orders and Invoices only for an org that holds
//                        them; Recent exports from the data.exported rows
//                        every download writes. The one-time "Previous
//                        permissions grid" download appears here once the
//                        grid is retired (access.matrix_retired).
//   Import               the /imports hub content (a CSV into a table, People
//                        from a CSV inline) and the Marketing legacy import
//                        (?legacy=marketing scrolls to it and pulses it)
//   Retention & privacy  trash window (the trash-purge cron), the audit log
//                        window (the audit-purge cron; unset keeps it
//                        forever), AI features for everyone (read by every AI
//                        entry point), the two AI opt-ins (AI fields in
//                        Lists, scheduled AI updates in Talk; off until
//                        turned on) and the org's own AI key (Enterprise
//                        byok flag)
//   Trash                a link card to /trash
//
// The two retention rows are Owner rows (every Admin until the Owner and
// Admin split); every download keeps the 401, 403, 503 and empty guards.
//
// THE SHARED PARTS (settings-cleanup Phase 6, B3 to B6 and B12):
//   - a row's hint is what pressing it does and what it costs; anything
//     longer opens under its Show more (the full workspace's contents, who
//     an audit row can name, what the audit purge always keeps), and a
//     row's last export is its detail line under it;
//   - the legacy downloads on Export sit under the card's 13/500 "Legacy"
//     sub-heading, ordinary rows like the ones above them, never an
//     uppercase label inside a card;
//   - Recent exports is a card with its title, its plain table inside (the
//     way My settings > Security draws its recent activity), never a bare
//     heading over a table;
//   - Import's Marketing (legacy) is one SettingsCard with ordinary rows:
//     what it holds, its buttons, its preview lines and its three CSVs,
//     never a box with an icon and lighter grey text, and its Import is a
//     secondary button (the Import tab's one blue is "Import N people");
//   - Retention & privacy waits for both of its reads, then draws each card
//     over the read it saves through: a failed read is that card's
//     ErrorState with Try again, never switches that cannot save. The
//     privacy switches read the same section they write ("data"), so what
//     they show is what a save would change;
//   - Trash is a link card: its title, what Trash keeps (visible, it is the
//     consequence), its link with the live count beside it, and what stays
//     in storage as the card's last line.

import { DateText } from "@/components/ui/date-text";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { SettingsPage, type SettingsTab } from "@/components/settings/settings-page";
import { SettingsCard, SettingsCardStack, reducedMotion } from "@/components/settings/settings-card";
import { SettingsRow } from "@/components/settings/settings-row";
import { ConfirmDialog, NativeSelect, NumberInput, Pending, btn } from "@/components/settings/settings-form";
import { ByokManager } from "@/components/settings/byok-manager";
import { settingsTabs } from "@/lib/settings-registry";
import { useOsToast } from "@/components/layout/os/toast";
import { apiFetch } from "@/lib/api-fetch";
import { useConfirm } from "@/components/ui/dialog-provider";
import { Switch } from "@/components/ui/switch";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useShowUpcoming } from "@/components/ui/coming-soon-row";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useBoot } from "@/components/layout/os/boot-context";
import { CsvImportDialog } from "@/components/tables/csv-import-dialog";
import { objectHrefNow } from "@/components/layout/os/use-object-href";
import { PeopleImport, importable, usePeopleImport } from "@/components/people/people-import";
import { useSettingsSection } from "@/hooks/use-settings-section";
import { RETENTION_BOUNDS, dataSettingsOf } from "@/lib/settings/org-policy";
import { retentionTabView } from "./data-ui";
import { ExportButton, MarketingLegacyCard, RecentExportsTable, STORAGE_LINE, TrashCard, exportLine, type ExportRow, type LegacyState, type RecentExport } from "./data-cards";
import type { LegacyMarketingReport } from "@/lib/marketing/legacy-import";

// What the audit purge never deletes, in words (src/lib/audit-retention.ts
// AUDIT_PURGE_KEEP_TYPES): shown on the row and in its confirm dialog.
const AUDIT_KEPT_KINDS = "review decisions, goal creators, invitations, changes to the access switches and Public links, consent, staff actions and a few system records";

const EXPORTS: ExportRow[] = [
  {
    key: "all", href: "/api/export/all", fallbackName: "workwrk-export.zip", title: "Full workspace (ZIP)",
    desc: "People, work, Docs, Tables and Goals in one ZIP, without files or attachments. A large workspace can take a few minutes: keep this page open.",
    more: [
      "In it: People, Spaces, Folders and Lists; every task with its description, checklist, tags, custom fields and comments; Docs and SOPs as Markdown; Tables as CSV; Goals and review cycles.",
      "Not included: files and attachments, images inside Docs, canvases, forms, chat, Doc comments and review answers. Personal notes stay their owner's.",
    ],
  },
  { key: "people", href: "/api/export/people", fallbackName: "people-export.csv", title: "People (CSV)", desc: "Every person with their department, job title, manager and office." },
  { key: "timesheets", href: "/api/export/timesheets", fallbackName: "timesheets.csv", title: "Timesheets (CSV)", desc: "Submitted timesheets with hours, status and approver." },
  {
    key: "audit", href: "/api/audit?format=csv", fallbackName: "audit-log.csv", title: "Audit log (CSV)",
    desc: "Who acted, what, when, the target and the IP; the newest 50,000 events.",
    more: ["Who acted is a person, your identity provider or WorkwrK staff."],
  },
];
const LEGACY_EXPORTS: ExportRow[] = [
  { key: "purchase-orders", href: "/api/export/purchase-orders", fallbackName: "purchase-orders.csv", title: "Purchase orders (CSV)", desc: "Vendor, amount, status, requester and approver." },
  { key: "invoices", href: "/api/export/invoices", fallbackName: "invoices.csv", title: "Invoices (CSV)", desc: "Vendor, linked order, due date, amount and payment status." },
];

// Parse the download filename from Content-Disposition, tolerating both
// `filename="x"` and RFC 5987 `filename*=UTF-8''x` forms.
function filenameFromDisposition(cd: string, fallback: string): string {
  const star = /filename\*=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
  if (star?.[1]) {
    try { return decodeURIComponent(star[1]); } catch { return star[1]; }
  }
  const plain = /filename="?([^";]+)"?/i.exec(cd);
  return plain?.[1] ?? fallback;
}

const DATA_TABS: readonly SettingsTab[] = settingsTabs("data");

type Summary = {
  legacy: { purchaseOrders: number; invoices: number };
  recentExports: RecentExport[];
  matrixRetired: { id: string; at: string } | null;
  /** A workspace export is being written right now. Absent from an older server. */
  exportRunning?: boolean;
  canPurge: boolean;
};

export default function DataSettingsPage() {
  const { toast } = useOsToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null | "error">(null);
  const flow = usePeopleImport();
  const ready = importable(flow.state.staged?.summary);

  const loadSummary = useCallback(async () => {
    const r = await apiFetch<Summary>("/api/settings/data-summary", { cache: "no-store" });
    setSummary(r.ok ? r.data : "error");
  }, []);
  useEffect(() => {
    const t = setTimeout(() => { void loadSummary(); }, 0);
    return () => clearTimeout(t);
  }, [loadSummary]);

  const download = useCallback(async (row: ExportRow) => {
    if (busy) return;
    setBusy(row.key);
    try {
      const res = await fetch(row.href, { cache: "no-store" });
      if (!res.ok) {
        let msg = `Export failed (HTTP ${res.status})`;
        if (res.status === 403) msg = "You don't have permission to run this export.";
        else if (res.status === 401) msg = "Your session expired. Log in again.";
        else if (res.status === 503) msg = "Export is unavailable right now. Try again shortly.";
        else {
          const body = await res.json().catch(() => null);
          if (body && typeof body.error === "string") msg = body.error;
        }
        toast(msg);
        return;
      }
      // Read it as it arrives, so a long export shows how far it has got, and
      // a download that breaks partway says so in words.
      let blob: Blob;
      try {
        const reader = res.body?.getReader();
        if (!reader) {
          blob = await res.blob();
        } else {
          const parts: Uint8Array[] = [];
          let got = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            parts.push(value);
            got += value.length;
            setProgress(`${(got / 1_048_576).toFixed(got < 10 * 1_048_576 ? 1 : 0)} MB`);
          }
          blob = new Blob(parts as BlobPart[], { type: res.headers.get("Content-Type") ?? "application/octet-stream" });
        }
      } catch {
        toast("The export stopped before it finished, so nothing was saved. Try again.");
        void loadSummary();
        return;
      }
      if (blob.size === 0) { toast("Nothing to export yet: this is empty."); return; }
      const filename = filenameFromDisposition(res.headers.get("Content-Disposition") ?? "", row.fallbackName);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast(`Exported ${filename}`);
      void loadSummary();
    } catch {
      toast("Couldn't start the export. Check your connection and try again.");
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }, [busy, toast, loadSummary]);

  const tabs: SettingsTab[] = DATA_TABS.map((t) =>
    t.key === "import" && flow.state.step === "review" && ready > 0
      ? { ...t, primary: { label: `Import ${ready} ${ready === 1 ? "person" : "people"}`, onClick: () => { void flow.commit(); }, busy: flow.state.busy } }
      : t,
  );

  return (
    <SettingsPage pageKey="data" tabs={tabs}>
      {(tab) =>
        tab === "import" ? (
          <ImportTab flow={flow} busy={busy} onExport={download} />
        ) : tab === "retention" ? (
          <RetentionTab canPurge={summary && summary !== "error" ? summary.canPurge : false} />
        ) : tab === "trash" ? (
          <TrashTab />
        ) : (
          <ExportTab summary={summary} busy={busy} progress={progress} onRun={download} onRetry={() => { setSummary(null); void loadSummary(); }} />
        )
      }
    </SettingsPage>
  );
}

/* ───────────────────────── Export ───────────────────────── */

function ExportTab({ summary, busy, progress, onRun, onRetry }: { summary: Summary | null | "error"; busy: string | null; progress: string | null; onRun: (r: ExportRow) => void; onRetry: () => void }) {
  const s = summary && summary !== "error" ? summary : null;
  const lastFor = (key: string) => s?.recentExports.find((e) => e.kind === key || (key === "all" && e.kind === "workspace"));
  const legacy = s ? LEGACY_EXPORTS.filter((r) => (r.key === "invoices" ? s.legacy.invoices : s.legacy.purchaseOrders) > 0) : [];
  return (
    <SettingsCardStack>
      {/* Titled like every card (final Settings review, M6); the anchor stays. */}
      <SettingsCard title="Export" id="data.export">
        <div>
          {EXPORTS.map((row) => {
            const last = lastFor(row.key);
            return (
              <SettingsRow
                key={row.key}
                id={`data.export.${row.key}`}
                label={row.title}
                helper={row.desc}
                more={row.more ? row.more.map((p) => <p key={p} className="m-0">{p}</p>) : undefined}
                control={<ExportButton row={row} busy={busy} progress={busy === row.key ? progress : null} onRun={onRun} />}
              >
                {/* The row's own detail line: who exported it last, and whether that run finished. */}
                {last ? (
                  <span>
                    {exportLine(last, row.key === "all" && Boolean(s?.exportRunning))}
                    <DateText value={last.when} style="relative" />
                  </span>
                ) : null}
              </SettingsRow>
            );
          })}
        </div>
        <div>
          {/* The card's 13/500 sub-heading, an h3 under its h2 title (Phase 6 review, L7: no level skipped). */}
          <h3 className="text-sm font-medium text-ink">Legacy</h3>
          <div className="mt-1">
            {/* The Marketing (legacy) CSVs live with their importer on the
                Import tab; this row keeps them findable from Export. */}
            <SettingsRow
              label="Marketing (legacy) CSVs"
              helper="Campaigns, Content and Events from the retired Marketing pages, next to their importer."
              control={<Link href="/settings/data?tab=import&legacy=marketing" className={btn.secondary}>Open</Link>}
            />
            {legacy.map((row) => (
              <SettingsRow key={row.key} label={row.title} helper={row.desc} control={<ExportButton row={row} busy={busy} onRun={onRun} />} />
            ))}
            {s?.matrixRetired ? (
              <SettingsRow
                label="Previous permissions grid (JSON)"
                helper={<>The old permission grid as it stood when it was retired, <DateText value={s.matrixRetired.at} />.</>}
                control={<ExportButton row={{ key: "matrix", href: `/api/settings/matrix-export?id=${s.matrixRetired.id}`, fallbackName: "permissions-grid.json", title: "", desc: "" }} busy={busy} onRun={onRun} />}
              />
            ) : null}
          </div>
        </div>
      </SettingsCard>

      <RecentExportsTable
        rows={s ? s.recentExports : null}
        failed={summary === "error"}
        onRetry={onRetry}
        description={<>The last 20 exports. The <Link href="/settings/audit?tab=data" className="font-medium text-brand-deep hover:underline">Audit log</Link> has every one.</>}
      />
    </SettingsCardStack>
  );
}

/* ───────────────────────── Import ───────────────────────── */

function ImportTab({ flow, busy, onExport }: { flow: ReturnType<typeof usePeopleImport>; busy: string | null; onExport: (r: ExportRow) => void }) {
  const router = useRouter();
  const showUpcoming = useShowUpcoming();
  const { prefs } = useOsShell();
  const tablesOn = Array.isArray(prefs.modules?.activeAppKeys) && prefs.modules.activeAppKeys.includes("tables");
  const [csvOpen, setCsvOpen] = useState(false);
  const step = flow.state.step;
  return (
    <SettingsCardStack>
      <SettingsCard title="People from a CSV" description="Each row is checked first, and everyone ready gets an invitation. Nobody joins until they accept, and everyone joins as a Member." id="data.import.people">
        <PeopleImport flow={flow} container="page" />
        {step === "map" ? (
          <div className="flex gap-2">
            <button type="button" className={btn.ghost} onClick={flow.back} disabled={flow.state.busy}>Back</button>
            <button type="button" className={btn.secondary} disabled={flow.state.busy || flow.missing.length > 0} onClick={() => { void flow.stage(); }}>
              {flow.state.busy ? <Pending label="Checking" /> : null}
              Check the file
            </button>
          </div>
        ) : step === "review" ? (
          <div className="flex gap-2">
            <button type="button" className={btn.ghost} onClick={flow.back} disabled={flow.state.busy}>Back</button>
          </div>
        ) : step === "done" ? (
          <div><button type="button" className={btn.secondary} onClick={flow.reset}>Import another file</button></div>
        ) : null}
      </SettingsCard>

      <SettingsCard title="A CSV into a table" description="Create a new table from a CSV file, or add its rows to a table you already have. You check a preview and the column types before anything is written." id="data.import.table">
        {tablesOn ? (
          <div><button type="button" className={btn.secondary} onClick={() => setCsvOpen(true)}>Choose a CSV</button></div>
        ) : (
          <p className="text-sm text-ink-2">
            Tables is turned off for this workspace. <Link href="/settings/apps#modules" className="font-medium text-brand-deep hover:underline">Turn it on in Apps &amp; modules</Link> to import a CSV into a table.
          </p>
        )}
      </SettingsCard>

      <LegacyMarketingSection busy={busy} onExport={onExport} />

      {showUpcoming ? (
        <p className="text-sm text-ink-3">Coming soon: imports from ClickUp, Monday, Asana and Trello.</p>
      ) : null}

      {tablesOn ? (
        <CsvImportDialog
          open={csvOpen}
          onClose={() => setCsvOpen(false)}
          onDone={({ tableId, created }) => { if (created) router.push(objectHrefNow("table", tableId)); }}
        />
      ) : null}
    </SettingsCardStack>
  );
}

/* ───────────────────────── Retention & privacy ───────────────────────── */

type RetentionData = { trashDays: number; auditDays: number | null };
type PrivacyData = { aiEnabled: boolean; aiFields: boolean; aiTalkUpdates: boolean };

/** What the audit window's row says, and what opens under its Show more. */
const AUDIT_DAYS_MORE = (min: number) => `At least ${min} days. Always kept: ${AUDIT_KEPT_KINDS}.`;
function RetentionTab({ canPurge }: { canPurge: boolean }) {
  const { toast } = useOsToast();
  const showUpcoming = useShowUpcoming();
  // With the Trash purge on, the Trash window is enforced: its row is shown
  // to everyone who may see Retention and says so. The audit row waits for
  // its own job behind Show upcoming features.
  const purges = !!useBoot().boot.org.trashPurges;
  // Each card reads the section it saves through: the retention rows the
  // "retention" section, the privacy switches the "data" section. The two
  // reads are the same GET, normalised by the server (retentionOf,
  // dataSettingsOf), so a value the workspace never stored reads as the
  // server's own default, never as one the page made up.
  const ret = useSettingsSection("retention", (b) => {
    const st = (b.settings ?? {}) as { retention?: RetentionData };
    return st.retention ?? { trashDays: 60, auditDays: null };
  });
  const dataSec = useSettingsSection("data", (b): PrivacyData => {
    const d = dataSettingsOf(b.settings);
    return { aiEnabled: d.aiEnabled, aiFields: d.aiFields, aiTalkUpdates: d.aiTalkUpdates };
  });
  const [trash, setTrash] = useState<number | "" | null>(null);
  const [auditMode, setAuditMode] = useState<"forever" | "days" | null>(null);
  const [auditDays, setAuditDays] = useState<number | "" | null>(null);
  const [ai, setAi] = useState<boolean | null>(null);
  const [aiFields, setAiFields] = useState<boolean | null>(null);
  const [aiTalk, setAiTalk] = useState<boolean | null>(null);
  const [saved, setSaved] = useState<Record<string, number>>({});
  // A failed save keeps the write that failed, so Retry sends the person's
  // value again (the shown value has already fallen back to the stored one).
  const [errs, setErrs] = useState<Record<string, { message: string; run: () => Promise<{ ok: boolean; error?: string }>; revert: () => void }>>({});
  const [confirmAudit, setConfirmAudit] = useState(false);
  // The Trash window is written when the field is done with (Enter or
  // leaving it), never on a pause in typing (final Settings review, L7: on
  // the way from 60 to 45, a pause at 4 asked for a 4 day window). With the
  // purge on, lowering it asks first: the next night's run deletes for good.
  // The number asked about stays while the dialog closes, so its words never
  // blank as it fades.
  const [lowerTrash, setLowerTrash] = useState<{ days: number; open: boolean } | null>(null);
  const sentTrash = useRef<number | null>(null);
  const timers = useRef<Record<string, number>>({});

  const view = retentionTabView(ret.status, dataSec.status, showUpcoming || purges);
  if (view.kind === "loading") return <SkeletonRows rows={4} className="max-w-[760px]" />;
  const cur = ret.data;
  const priv = dataSec.data;
  const trashShown = trash ?? cur?.trashDays ?? 60;
  const mode = auditMode ?? (cur?.auditDays ? "days" : "forever");
  const auditShown = auditDays ?? cur?.auditDays ?? 365;
  const aiShown = ai ?? priv?.aiEnabled ?? true;
  const aiFieldsShown = aiFields ?? priv?.aiFields === true;
  const aiTalkShown = aiTalk ?? priv?.aiTalkUpdates === true;

  const write = (key: string, run: () => Promise<{ ok: boolean; error?: string }>, revert: () => void) => {
    window.clearTimeout(timers.current[key]);
    timers.current[key] = window.setTimeout(async () => {
      const r = await run();
      if (!r.ok) {
        revert();
        setErrs((e) => ({ ...e, [key]: { message: r.error ?? "Couldn't save", run, revert } }));
        toast(r.error ?? "Couldn't save");
        return;
      }
      setErrs((e) => { const n = { ...e }; delete n[key]; return n; });
      setSaved((x) => ({ ...x, [key]: Date.now() }));
    }, 400);
  };
  const retryOf = (key: string) => {
    const e = errs[key];
    return e ? { message: e.message, onRetry: () => write(key, e.run, e.revert) } : null;
  };

  const b = RETENTION_BOUNDS;
  const saveTrash = (n: number) => {
    sentTrash.current = n;
    write("trash", () => ret.save({ trashDays: n }), () => { sentTrash.current = null; setTrash(null); });
  };
  const commitTrash = () => {
    if (trash === null || lowerTrash?.open || !cur) return;
    // Nothing a window can be: back to the window in force.
    if (trash === "" || trash < b.trashDays.min || trash > b.trashDays.max) { setTrash(null); return; }
    const inForce = sentTrash.current ?? cur.trashDays;
    if (trash === inForce) return;
    if (purges && trash < inForce) { setLowerTrash({ days: trash, open: true }); return; }
    saveTrash(trash);
  };
  return (
    <SettingsCardStack>
      {/* Neither purge job is installed yet (scripts/CRON-SETUP.md: trash-purge
          and audit-purge, NOT INSTALLED), so nothing is deleted on either
          window. Both rows wait behind Show upcoming features and say so,
          until the founder installs the rows (settings spec, Data >
          Retention: "Not enforced yet"). Until TRASH_PURGE_CRON is on, the
          Trash tab says deleted items stay until an admin deletes them; once
          it is on, the Trash row is out of Show upcoming and says it is
          enforced. */}
      {view.retention === "error" ? (
        <SettingsCard title="Retention" id="data.retention">
          <ErrorState compact what="the retention settings" hint={ret.error ?? undefined} onRetry={ret.retry} />
        </SettingsCard>
      ) : view.retention === "form" && cur ? (
        <SettingsCard title="Retention" id="data.retention">
          <div>
          <SettingsRow
            id="data.retention.trashDays"
            label="Keep deleted items in Trash for"
            helper={purges
              ? "Items in Trash are deleted for good after this many days, except Docs, canvases and contracts, which stay until an Owner or Admin deletes them."
              : "Not enforced yet: nothing is removed from Trash automatically until the nightly job is installed."}
            more={purges ? <p className="m-0">{STORAGE_LINE}</p> : undefined}
            savedAt={saved.trash}
            error={retryOf("trash")}
            readOnlyValue={canPurge ? undefined : `${cur.trashDays} days`}
            control={
              <NumberInput value={trashShown} min={b.trashDays.min} max={b.trashDays.max} suffix="days" ariaLabel="Days in Trash"
                onChange={setTrash} onBlur={commitTrash} onEnter={commitTrash} />
            }
          />
          {showUpcoming ? (
          <SettingsRow
            id="data.retention.auditDays"
            label="Keep the audit log for"
            helper={mode === "forever" ? "Every entry is kept." : "Not enforced yet. Once the nightly job is installed, entries older than this are removed for good."}
            more={mode === "forever" ? undefined : <p className="m-0">{AUDIT_DAYS_MORE(b.auditDays.min)}</p>}
            savedAt={saved.audit}
            error={retryOf("audit")}
            readOnlyValue={canPurge ? undefined : cur.auditDays ? `${cur.auditDays} days` : "Forever"}
            control={
              <span className="flex items-center gap-2">
                <NativeSelect value={mode} ariaLabel="Audit log retention" options={[{ value: "forever", label: "Forever" }, { value: "days", label: "A number of days" }]}
                  onChange={(m) => {
                    // Choosing a window deletes history later: confirmed first.
                    if (m === "days") { setConfirmAudit(true); return; }
                    setAuditMode(m);
                    write("audit", () => ret.save({ auditDays: null }), () => { setAuditMode(null); setAuditDays(null); });
                  }} />
                {mode === "days" ? (
                  <NumberInput value={auditShown} min={b.auditDays.min} max={b.auditDays.max} suffix="days" ariaLabel="Days of audit log"
                    onChange={(n) => {
                      setAuditDays(n);
                      if (n === "" || n < b.auditDays.min || n > b.auditDays.max) return;
                      write("audit", () => ret.save({ auditDays: n }), () => setAuditDays(null));
                    }} />
                ) : null}
              </span>
            }
          />
          ) : null}
          </div>
        </SettingsCard>
      ) : null}
      <ConfirmDialog
        open={!!lowerTrash?.open}
        onOpenChange={(v) => { if (!v) { setLowerTrash((x) => (x ? { ...x, open: false } : x)); setTrash(null); } }}
        title={`Keep deleted items for ${lowerTrash?.days ?? ""} days?`}
        danger
        confirmLabel={`Keep ${lowerTrash?.days ?? ""} days`}
        onConfirm={() => {
          if (!lowerTrash) return;
          setLowerTrash({ ...lowerTrash, open: false });
          saveTrash(lowerTrash.days);
        }}
      >
        <p className="text-base text-ink-2">Items older than {lowerTrash?.days} days are removed from Trash for good tonight.</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirmAudit}
        onOpenChange={(v) => { if (!v) setConfirmAudit(false); }}
        title="Keep the audit log for 365 days?"
        confirmLabel="Keep 365 days"
        onConfirm={() => {
          setConfirmAudit(false);
          setAuditMode("days");
          const n = typeof auditShown === "number" ? auditShown : 365;
          write("audit", () => ret.save({ auditDays: n }), () => { setAuditMode(null); setAuditDays(null); });
        }}
      >
        <p className="text-base text-ink-2">Once the nightly job is installed, entries older than the window are removed for good. Always kept: {AUDIT_KEPT_KINDS}. You can change the number of days next.</p>
      </ConfirmDialog>
      <SettingsCard title="Privacy" id="data.privacy">
        {view.privacy === "error" ? (
          // A failed read of the section these switches save through: say so,
          // with Try again, rather than switches whose every save is refused.
          <ErrorState compact what="the privacy settings" hint={dataSec.error ?? undefined} onRetry={dataSec.retry} />
        ) : (
          <div>
        <SettingsRow
          id="data.aiEnabled"
          label="AI features for everyone"
          helper="Ask AI, drafting and summaries. Off hides every AI entry point in the workspace."
          savedAt={saved.ai}
          error={retryOf("ai")}
          control={<Switch checked={aiShown} aria-label="AI features for everyone" onChange={(v) => { setAi(v); write("ai", () => dataSec.save({ aiEnabled: v }), () => setAi(null)); }} />}
        />
        {/* The two opt-ins (src/lib/ai/ai-features.ts): off until turned on
            here, and off whatever they say while the row above is off, so
            the row shows that as text instead of a switch that does nothing.
            Their hints stay whole and visible: each says what is sent to the
            AI provider, and the switch turns on with no confirm. */}
        <SettingsRow
          id="data.aiFields"
          label="AI fields in Lists"
          helper="Summary, Sentiment, Categorize and Translation fields. A field is filled only when someone chooses Fill with AI, and the task's title, description, latest comments and field values are sent to the AI provider."
          savedAt={saved.aiFields}
          error={retryOf("aiFields")}
          readOnlyValue={aiShown ? undefined : "Off while AI features are off"}
          control={<Switch checked={aiFieldsShown} aria-label="AI fields in Lists" onChange={(v) => { setAiFields(v); write("aiFields", () => dataSec.save({ aiFields: v }), () => setAiFields(null)); }} />}
        />
        <SettingsRow
          id="data.aiTalkUpdates"
          label="Scheduled AI updates in Talk"
          helper="A channel can post a daily standup or a weekly project update written by AI. It reads only tasks that everyone in the channel can open, and sends them to the AI provider on that schedule."
          savedAt={saved.aiTalk}
          error={retryOf("aiTalk")}
          readOnlyValue={aiShown ? undefined : "Off while AI features are off"}
          control={<Switch checked={aiTalkShown} aria-label="Scheduled AI updates in Talk" onChange={(v) => { setAiTalk(v); write("aiTalk", () => dataSec.save({ aiTalkUpdates: v }), () => setAiTalk(null)); }} />}
        />
          </div>
        )}
      </SettingsCard>
      <ByokManager quietWhileLoading />
    </SettingsCardStack>
  );
}

/* ───────────────────────── Trash ───────────────────────── */

function TrashTab() {
  // Trash empties itself only once its purge job runs (src/lib/purge-jobs.ts):
  // until then it promises no window it does not keep.
  const purges = !!useBoot().boot.org.trashPurges;
  const [info, setInfo] = useState<{ total: number; capped: boolean; retentionDays: number } | null | "error">(null);
  useEffect(() => {
    const t = setTimeout(() => {
      void apiFetch<{ total: number; capped: boolean; retentionDays: number }>("/api/trash?limit=1", { cache: "no-store" }).then((r) => setInfo(r.ok ? r.data : "error"));
    }, 0);
    return () => clearTimeout(t);
  }, []);
  // The card is drawn from the first paint; the count joins its link's line when it arrives (data-cards.tsx).
  return <TrashCard purges={purges} info={info && info !== "error" ? info : null} />;
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
    // Instant for anyone who asked for less motion, as a card's hash landing is.
    ref.current.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
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

  // Still reading: nothing yet (the card appears when the answer does).
  if (!state) return null;
  return (
    <MarketingLegacyCard
      cardRef={ref}
      state={state}
      wanted={wanted}
      pulse={pulse}
      preview={preview}
      running={running}
      busy={busy}
      onRetry={() => { void load(); }}
      onRun={(write) => { void run(write); }}
      onExport={onExport}
    />
  );
}

