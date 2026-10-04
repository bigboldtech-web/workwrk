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

import { DateText } from "@/components/ui/date-text";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Download, Megaphone, type LucideIcon } from "lucide-react";
import { Dots } from "@/components/ui/dots";
import { SettingsPage, type SettingsTab } from "@/components/settings/settings-page";
import { SettingsCard, SettingsCardStack } from "@/components/settings/settings-card";
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
import { DotsArt } from "@/components/ui/dots-art";
import { TableCard, type TableColumn } from "@/components/ui/table-card";
import { useShowUpcoming } from "@/components/ui/coming-soon-row";
import { useOsShell } from "@/components/layout/os/shell-context";
import { CsvImportDialog } from "@/components/tables/csv-import-dialog";
import { objectHrefNow } from "@/components/layout/os/use-object-href";
import { PeopleImport, usePeopleImport } from "@/components/people/people-import";
import { useSettingsSection } from "@/hooks/use-settings-section";
import { RETENTION_BOUNDS } from "@/lib/settings/org-policy";
import type { LegacyMarketingCounts, LegacyMarketingReport, LegacyPending } from "@/lib/marketing/legacy-import";
import { LIST_NAME, MARKETING_KINDS, type MarketingKind } from "@/lib/marketing/legacy-map";

type ExportRow = {
  key: string;
  href: string;
  fallbackName: string;
  icon?: LucideIcon;
  title: string;
  desc: string;
};

const EXPORTS: ExportRow[] = [
  { key: "all", href: "/api/export/all", fallbackName: "workwrk-export.zip", title: "Full workspace (ZIP)", desc: "People, Spaces, Folders and Lists; every task with its description, checklist, tags, custom fields and comments; Docs and SOPs as Markdown; Tables as CSV; Goals and review cycles. Not included: files and attachments, images inside Docs, canvases, forms, chat, Doc comments and review answers. Personal notes stay their owner's. A large workspace can take a few minutes: keep this page open." },
  { key: "people", href: "/api/export/people", fallbackName: "people-export.csv", title: "People (CSV)", desc: "Every person with their department, job title, manager and office." },
  { key: "timesheets", href: "/api/export/timesheets", fallbackName: "timesheets.csv", title: "Timesheets (CSV)", desc: "Submitted timesheets with hours, status and approver." },
  { key: "audit", href: "/api/audit?format=csv", fallbackName: "audit-log.csv", title: "Audit log (CSV)", desc: "The activity log: who acted (a person, your identity provider or WorkwrK staff), what, when, the target and the IP. The newest 50,000 events." },
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
  recentExports: { id: string; when: string; who: string; what: string; kind: string | null; status?: string | null }[];
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
  const ready = flow.state.staged?.summary.ready ?? 0;

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
  const columns: TableColumn<Summary["recentExports"][number]>[] = [
    { key: "when", label: "When", width: "150px", render: (e) => <DateText value={e.when} style="relative" /> },
    { key: "who", label: "Who", width: "180px", render: (e) => e.who },
    { key: "what", label: "What", title: true, render: (e) => e.what },
  ];
  return (
    <SettingsCardStack>
      <SettingsCard wide="data.exports" id="data.export">
        {EXPORTS.map((row) => {
          const last = lastFor(row.key);
          return (
            <SettingsRow
              key={row.key}
              id={`data.export.${row.key}`}
              label={row.title}
              helper={<>{row.desc}{last ? (
                <span className="block">
                  {exportLine(last, row.key === "all" && Boolean(s?.exportRunning))}
                  <DateText value={last.when} style="relative" />
                </span>
              ) : null}</>}
              control={<ExportButton row={row} busy={busy} progress={busy === row.key ? progress : null} onRun={onRun} />}
            />
          );
        })}
        <>
            <div className="mt-2 flex items-center gap-3 text-micro font-semibold uppercase tracking-[0.06em] text-ink-2">Legacy<span className="h-px flex-1 bg-line" aria-hidden /></div>
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
        </>
      </SettingsCard>

      <section>
        <h2 className="mb-2 text-lg font-semibold text-ink">Recent exports</h2>
        {summary === "error" ? (
          <ErrorState compact what="recent exports" onRetry={onRetry} />
        ) : (
          <TableCard
            ariaLabel="Recent exports"
            columns={columns}
            rows={s ? s.recentExports : null}
            rowKey={(e) => e.id}
            empty={<span>No exports yet</span>}
            footer={s ? { total: s.recentExports.length, noun: "exports", from: s.recentExports.length ? 1 : 0, to: s.recentExports.length, hidePaging: true, trailing: s.recentExports.length >= 20 ? "The last 20. The Audit log has every one." : undefined } : undefined}
          />
        )}
      </section>
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
      <SettingsCard title="People from a CSV" description="Each row is checked first, and everyone ready gets an invitation. Nobody joins until they accept, and everyone joins as a Member." wide="data.import" id="data.import.people">
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

type RetentionData = {
  retention: { trashDays: number; auditDays: number | null };
  data: { aiEnabled: boolean; aiFields?: boolean; aiTalkUpdates?: boolean };
};

function RetentionTab({ canPurge }: { canPurge: boolean }) {
  const { toast } = useOsToast();
  const showUpcoming = useShowUpcoming();
  const ret = useSettingsSection("retention", (b) => {
    const st = (b.settings ?? {}) as Partial<RetentionData>;
    return { retention: st.retention ?? { trashDays: 60, auditDays: null }, data: st.data ?? { aiEnabled: true } } as RetentionData;
  });
  const dataSec = useSettingsSection("data", () => null);
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
  const timers = useRef<Record<string, number>>({});

  if (ret.status === "error") return <ErrorState what="the retention settings" hint={ret.error ?? undefined} onRetry={ret.retry} />;
  if (!ret.data) return <SkeletonRows rows={4} className="max-w-[760px]" />;
  const cur = ret.data;
  const trashShown = trash ?? cur.retention.trashDays;
  const mode = auditMode ?? (cur.retention.auditDays ? "days" : "forever");
  const auditShown = auditDays ?? cur.retention.auditDays ?? 365;
  const aiShown = ai ?? cur.data.aiEnabled;
  const aiFieldsShown = aiFields ?? cur.data.aiFields === true;
  const aiTalkShown = aiTalk ?? cur.data.aiTalkUpdates === true;

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
  return (
    <SettingsCardStack>
      {/* Neither purge job is installed yet (scripts/CRON-SETUP.md: trash-purge
          and audit-purge, NOT INSTALLED), so nothing is deleted on either
          window. Both rows wait behind Show upcoming features and say so,
          until the founder installs the rows (settings spec, Data >
          Retention: "Not enforced yet"). Deleted items still wait in Trash
          for the window the Trash tab names. */}
      {showUpcoming ? (
        <SettingsCard wide="data.retention" title="Retention" id="data.retention">
          <SettingsRow
            id="data.retention.trashDays"
            label="Keep deleted items in Trash for"
            helper="Not enforced yet: nothing is removed from Trash automatically until the nightly job is installed."
            savedAt={saved.trash}
            error={retryOf("trash")}
            readOnlyValue={canPurge ? undefined : `${cur.retention.trashDays} days`}
            control={
              <NumberInput value={trashShown} min={b.trashDays.min} max={b.trashDays.max} suffix="days" ariaLabel="Days in Trash"
                onChange={(n) => {
                  setTrash(n);
                  if (n === "" || n < b.trashDays.min || n > b.trashDays.max) return;
                  write("trash", () => ret.save({ trashDays: n }), () => setTrash(null));
                }} />
            }
          />
          <SettingsRow
            id="data.retention.auditDays"
            label="Keep the audit log for"
            helper={mode === "forever" ? "Every entry is kept." : `Not enforced yet. Once the nightly job is installed, entries older than this are removed (at least ${b.auditDays.min} days; decisions, invitations, consent and staff actions are always kept).`}
            savedAt={saved.audit}
            error={retryOf("audit")}
            readOnlyValue={canPurge ? undefined : cur.retention.auditDays ? `${cur.retention.auditDays} days` : "Forever"}
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
        </SettingsCard>
      ) : null}
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
        <p className="text-base text-ink-2">Once the nightly job is installed, entries older than the window are removed for good. You can change the number of days next.</p>
      </ConfirmDialog>
      <SettingsCard title="Privacy" id="data.privacy">
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
            the row shows that as text instead of a switch that does nothing. */}
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
      </SettingsCard>
      <ByokManager />
    </SettingsCardStack>
  );
}

/* ───────────────────────── Trash ───────────────────────── */

function TrashTab() {
  const [info, setInfo] = useState<{ total: number; capped: boolean; retentionDays: number } | null | "error">(null);
  useEffect(() => {
    const t = setTimeout(() => {
      void apiFetch<{ total: number; capped: boolean; retentionDays: number }>("/api/trash?limit=1", { cache: "no-store" }).then((r) => setInfo(r.ok ? r.data : "error"));
    }, 0);
    return () => clearTimeout(t);
  }, []);
  const i = info && info !== "error" ? info : null;
  return (
    <section className="flex max-w-[760px] items-start gap-4 rounded-lg border border-line bg-raised p-6">
      <DotsArt arrangement="stack" size={96} />
      <div className="flex flex-col gap-2">
        <p className="text-base text-ink">Deleted Spaces, Lists, Docs and tasks wait in Trash{i ? ` for ${i.retentionDays} days` : ""}.</p>
        <Link href="/trash" className="text-sm font-medium text-brand-deep hover:underline">Open Trash</Link>
        {i ? <p className="text-sm text-ink-2">{i.total}{i.capped ? "+" : ""} {i.total === 1 ? "item" : "items"} in Trash</p> : null}
      </div>
    </section>
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
      <div className="rounded-lg border border-line bg-raised px-4">
        {LEGACY_CSV.map((row) => (
          <SettingsRow key={row.key} label={`${LIST_NAME[row.key.slice("marketing-".length) as MarketingKind] ?? row.title} as a CSV`} helper={row.desc} control={<ExportButton row={row} busy={busy} onRun={onExport} />} />
        ))}
      </div>
    </Section>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-3 text-micro font-semibold uppercase tracking-[0.06em] text-ink-2">
        {label}<span className="h-px flex-1 bg-line" aria-hidden />
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

/** The last export's line: running while the server is writing it, "did not finish" when it started and is no longer being written or stopped. */
function exportLine(last: { who: string; when: string; status?: string | null }, running: boolean): string {
  if (last.status === "started" && running) return `An export by ${last.who} is running, started `;
  if (last.status === "started" || last.status === "stopped") return `The last export by ${last.who} did not finish, `;
  return `Last exported by ${last.who}, `;
}

function ExportButton({
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
