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

import { useCallback, useState } from "react";
import Link from "next/link";
import {
  ShieldCheck, Database, Users, Clock, ShoppingCart, Receipt, ScrollText,
  Upload, Trash2, Download, Loader2, ChevronRight, type LucideIcon,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { useOsToast } from "@/components/layout/os/toast";

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
    desc: "Bring existing work in via CSV (Database, People) and more.",
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
      <OsTitleBar
        title="Data & compliance"
        Icon={ShieldCheck}
        iconGradient=""
        description="Export tenant data and manage retention"
        showInvite={false}
      />

      <div className="flex-1 overflow-y-auto px-6 pt-4 pb-10">
        <p className="mb-6 max-w-2xl text-[13px] text-zinc-500">
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
                  <div className="text-[14px] font-medium text-zinc-900">{title}</div>
                  <div className="text-[12.5px] text-zinc-500">{desc}</div>
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

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
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
        <div className="text-[14px] font-medium text-zinc-900">{row.title}</div>
        <div className="text-[12.5px] text-zinc-500">{row.desc}</div>
      </div>
      {isBusy ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[color:var(--os-brand)]" />
      ) : (
        <Download className="h-4 w-4 shrink-0 text-zinc-400" />
      )}
    </button>
  );
}
