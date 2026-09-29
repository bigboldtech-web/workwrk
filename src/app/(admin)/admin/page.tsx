"use client";

// Overview (spec-admin-backoffice 2.1): the first screen of the morning. How
// many customers there are, what Stripe charges, and what needs a person
// today. One read, GET /api/admin/overview. No toolbar, so the title row
// carries the 28px ghost "..." (Refresh, About this page).
//
// Nothing here is fabricated: no version string, no environment, no "Active
// rate" (it measured a billing flag), and no revenue computed from a price
// list. Revenue is what Stripe charges, one line per currency, or the words
// "Not connected".

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlarmClock, ChevronRight, CreditCard, Info, KeyRound, PauseCircle, RefreshCw, ShieldOff, type LucideIcon } from "lucide-react";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { TableCard, type TableColumn } from "@/components/ui/table-card";
import { StatusChip, Chip } from "@/components/ui/chip";
import { apiFetch } from "@/lib/api-fetch";
import { formatDate, formatDateTitle } from "@/lib/format/date";
import { formatMoney } from "@/lib/admin/numbers";
import { companyStatusColor, planLabel, statusLabel } from "@/lib/admin/console-labels";
import { useConsole } from "../console-context";
import { AboutDialog, TEXT_LINK, rememberCompanyNames, useStaleRefetch } from "../console-ui";
import { CardRetry, NumbersCard, NumbersMeta, SkeletonBars, connectLink } from "../numbers-ui";

type Revenue =
  | { source: "unavailable" }
  | { source: "error" }
  | { source: "stripe"; lines: { currency: string; monthly: number; subscriptions: number }[]; uncounted: number; truncated: boolean; asOf: string };

interface NewestCompany {
  id: string;
  name: string;
  plan: string;
  status: string;
  people: number;
  createdAt: string;
}

interface Overview {
  companies: { total: number; newIn30: number };
  people: { total: number; newIn30: number };
  paying: { count: number; of: number };
  revenue: Revenue;
  attention: { trialsEndingIn7: number; pastDue: number; withoutOwner: number; suspended: number; codesRedeemedIn7: number; codesSince: string };
  newest: NewestCompany[];
}

const nf = new Intl.NumberFormat();
const n = (v: number) => nf.format(v);
const plural = (v: number, one: string, many: string) => `${n(v)} ${v === 1 ? one : many}`;

export default function OverviewPage() {
  const { datePrefs, runbookUrl } = useConsole();
  const [data, setData] = useState<Overview | null>(null);
  const [failed, setFailed] = useState(false);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);

  const load = useCallback(async () => {
    const r = await apiFetch<Overview>("/api/admin/overview");
    if (r.ok) {
      setData(r.data);
      setFailed(false);
      setLoadedAt(Date.now());
      rememberCompanyNames(r.data.newest);
    } else if (r.status !== 401) {
      // 401 is the session-ended dialog's; anything else keeps the last
      // numbers on screen and says the refresh failed.
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);
  useStaleRefetch(() => void load(), loadedAt);

  const retry = () => void load();
  const loading = !data && !failed;
  const broken = !data && failed;
  const lang = datePrefs.language;

  const columns: TableColumn<NewestCompany>[] = [
    { key: "name", label: "Company", title: true, width: "minmax(200px,2fr)", render: (r) => <span className="truncate">{r.name}</span> },
    {
      key: "plan",
      label: "Plan",
      width: "140px",
      render: (r) => <Chip as="span" className="h-6 border-line bg-raised px-2 text-xs text-ink-2">{planLabel(r.plan)}</Chip>,
    },
    { key: "status", label: "Status", width: "150px", render: (r) => <StatusChip color={companyStatusColor(r.status)} label={statusLabel(r.status)} /> },
    { key: "people", label: "People", width: "100px", align: "end", numeric: true, render: (r) => <span className="tabular-nums">{n(r.people)}</span> },
    {
      key: "signed",
      label: "Signed up",
      width: "140px",
      render: (r) => <span className="tabular-nums text-ink-2" title={formatDateTitle(r.createdAt, datePrefs)}>{formatDate(r.createdAt, datePrefs, "date")}</span>,
    },
  ];

  return (
    <>
      <OsPageHeader
        title="Overview"
        actions={<NumbersMeta at={loadedAt} failed={failed} prefs={datePrefs} onRetry={retry} />}
        more={[
          { label: "Refresh", icon: RefreshCw, onClick: retry },
          { label: "About this page", icon: Info, onClick: () => setAboutOpen(true) },
        ]}
      />
      <div className="os-chrome flex min-h-0 flex-1 flex-col gap-4 px-6 pb-6 pt-2">
        {/* 1. Numbers: four cards, two per row below 1024. */}
        <div className="grid grid-cols-2 gap-4 min-[1024px]:grid-cols-4">
          <Stat label="Companies" loading={loading} broken={broken} onRetry={retry} value={data ? n(data.companies.total) : null} context={data ? `+${n(data.companies.newIn30)} in the last 30 days` : null} />
          <Stat label="People" loading={loading} broken={broken} onRetry={retry} value={data ? n(data.people.total) : null} context={data ? `+${n(data.people.newIn30)} in the last 30 days` : null} />
          <Stat
            label="Paying"
            loading={loading}
            broken={broken}
            onRetry={retry}
            value={data ? n(data.paying.count) : null}
            context={data ? `of ${plural(data.paying.of, "company", "companies")}` : null}
          />
          <RevenueStat revenue={data?.revenue ?? null} loading={loading} broken={broken} onRetry={retry} language={lang} runbookUrl={runbookUrl} />
        </div>

        {data && data.companies.total === 0 ? (
          <NumbersCard ariaLabel="No companies">
            <OsEmptyView context="list" title="No companies yet" className="mt-4 pb-4" />
          </NumbersCard>
        ) : (
          <>
            {/* 2. Needs attention: a row only when its count is above zero. */}
            <NumbersCard title="Needs attention">
              {loading ? (
                <SkeletonBars rows={3} height={16} gap={20} />
              ) : broken || !data ? (
                <CardRetry onRetry={retry} />
              ) : (
                <AttentionRows a={data.attention} />
              )}
            </NumbersCard>

            {/* 3. Newest companies: a sample of eight, so the footer carries a link, not a total. */}
            <section aria-label="Newest companies" className="flex min-w-0 flex-col gap-2">
              <h2 className="m-0 text-lg font-semibold text-ink">Newest companies</h2>
              <TableCard<NewestCompany>
                ariaLabel="Newest companies"
                columns={columns}
                rows={broken ? [] : data ? data.newest : null}
                rowKey={(r) => r.id}
                rowHref={(r) => `/admin/companies/${r.id}`}
                skeletonRows={8}
                empty={broken ? <CardRetry onRetry={retry} /> : "No companies yet"}
                footer={{
                  total: data?.newest.length ?? 0,
                  noun: "companies",
                  from: 1,
                  to: data?.newest.length ?? 0,
                  hidePaging: true,
                  hideTotal: true,
                  leading: (
                    <Link href="/admin/companies" className={`text-base ${TEXT_LINK}`}>
                      See all companies
                    </Link>
                  ),
                }}
              />
            </section>
          </>
        )}
      </div>

      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} title="Overview">
        Today&apos;s numbers and what needs a person. Everything here counts companies, plans and dates; no customer&apos;s
        work is ever read to make a number on this page. Monthly revenue is what Stripe charges for active subscriptions,
        at Stripe&apos;s own prices, one line per currency and never converted.
      </AboutDialog>
    </>
  );
}

function StatShell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section aria-label={label} className="os-chrome min-w-0 rounded-lg border border-line bg-raised p-4">
      <p className="m-0 text-sm font-medium text-ink-2">{label}</p>
      {children}
    </section>
  );
}

function Stat({
  label,
  value,
  context,
  loading,
  broken,
  onRetry,
}: {
  label: string;
  value: string | null;
  context: string | null;
  loading: boolean;
  broken: boolean;
  onRetry: () => void;
}) {
  return (
    <StatShell label={label}>
      {loading ? (
        <div className="mt-2">
          <SkeletonBars rows={2} height={14} gap={10} />
        </div>
      ) : broken || value === null ? (
        <div className="mt-2"><CardRetry onRetry={onRetry} /></div>
      ) : (
        <>
          <p className="m-0 mt-1 text-xl font-semibold tabular-nums text-ink">{value}</p>
          {context ? <p className="m-0 mt-0.5 truncate text-sm text-ink-2">{context}</p> : null}
        </>
      )}
    </StatShell>
  );
}

function RevenueStat({
  revenue,
  loading,
  broken,
  onRetry,
  language,
  runbookUrl,
}: {
  revenue: Revenue | null;
  loading: boolean;
  broken: boolean;
  onRetry: () => void;
  language?: string | null;
  runbookUrl: string | null;
}) {
  const label = "Monthly revenue";
  if (loading) {
    return (
      <StatShell label={label}>
        <div className="mt-2"><SkeletonBars rows={2} height={14} gap={10} /></div>
      </StatShell>
    );
  }
  if (broken || !revenue || revenue.source === "error") {
    return (
      <StatShell label={label}>
        <div className="mt-2"><CardRetry onRetry={onRetry} /></div>
      </StatShell>
    );
  }
  if (revenue.source === "unavailable") {
    const link = connectLink(runbookUrl);
    return (
      <StatShell label={label}>
        <p className="m-0 mt-1 text-row text-ink-2">Not connected</p>
        <p className="m-0 mt-0.5 text-sm text-ink-2">
          Billing is not connected yet.
          {link ? (
            <>
              {" "}
              <a href={link.href} target="_blank" rel="noopener noreferrer" className={TEXT_LINK}>{link.label}</a>
            </>
          ) : null}
        </p>
      </StatShell>
    );
  }
  if (revenue.lines.length === 0) {
    // Connected, and nothing active: zero is the true answer here, in no currency.
    return (
      <StatShell label={label}>
        <p className="m-0 mt-1 text-xl font-semibold tabular-nums text-ink">0</p>
        <p className="m-0 mt-0.5 text-sm text-ink-2">
          {revenue.uncounted > 0
            ? `${plural(revenue.uncounted, "subscription has", "subscriptions have")} a tiered or metered price and ${revenue.uncounted === 1 ? "is" : "are"} not counted`
            : "No active Stripe subscriptions"}
        </p>
      </StatShell>
    );
  }
  // One line per currency, never a grand total across them.
  const [first, ...rest] = revenue.lines;
  return (
    <StatShell label={label}>
      <p className="m-0 mt-1 truncate text-xl font-semibold tabular-nums text-ink" title={formatMoney(first.monthly, first.currency, language)}>
        {formatMoney(first.monthly, first.currency, language)}
      </p>
      <p className="m-0 mt-0.5 truncate text-sm text-ink-2">from {plural(first.subscriptions, "Stripe subscription", "Stripe subscriptions")}</p>
      {rest.map((l) => (
        <p key={l.currency} className="m-0 mt-1 truncate text-sm tabular-nums text-ink">
          {formatMoney(l.monthly, l.currency, language)} <span className="text-ink-2">from {plural(l.subscriptions, "subscription", "subscriptions")}</span>
        </p>
      ))}
      {revenue.uncounted > 0 ? (
        <p className="m-0 mt-1 text-sm text-ink-2">{plural(revenue.uncounted, "subscription has", "subscriptions have")} a tiered or metered price and {revenue.uncounted === 1 ? "is" : "are"} not counted.</p>
      ) : null}
    </StatShell>
  );
}

interface AttentionRow {
  key: string;
  count: number;
  icon: LucideIcon;
  sentence: string;
  href: string;
}

function AttentionRows({ a }: { a: Overview["attention"] }) {
  // The sentence and its count: "Trials end in the next 7 days ... 3". The
  // count is not repeated inside the sentence, so each fact is read once.
  const one = (v: number, single: string, many: string) => (v === 1 ? single : many);
  const rows: AttentionRow[] = [
    { key: "trials", count: a.trialsEndingIn7, icon: AlarmClock, sentence: one(a.trialsEndingIn7, "Trial ends in the next 7 days", "Trials end in the next 7 days"), href: "/admin/companies?view=trials" },
    { key: "pastdue", count: a.pastDue, icon: CreditCard, sentence: one(a.pastDue, "Subscription is past due", "Subscriptions are past due"), href: "/admin/companies?view=paying&subscription=past_due" },
    { key: "owners", count: a.withoutOwner, icon: ShieldOff, sentence: one(a.withoutOwner, "Workspace has nobody with Owner access", "Workspaces have nobody with Owner access"), href: "/admin/companies?view=all&owners=0" },
    { key: "suspended", count: a.suspended, icon: PauseCircle, sentence: one(a.suspended, "Workspace is suspended", "Workspaces are suspended"), href: "/admin/companies?view=suspended" },
    { key: "codes", count: a.codesRedeemedIn7, icon: KeyRound, sentence: one(a.codesRedeemedIn7, "AppSumo code was redeemed this week", "AppSumo codes were redeemed this week"), href: `/admin/appsumo?view=redeemed&redeemed_from=${a.codesSince}` },
  ].filter((r) => r.count > 0);

  if (rows.length === 0) return <p className="m-0 text-row text-ink-2">Nothing needs attention.</p>;
  return (
    <ul className="m-0 -mx-2 flex list-none flex-col p-0">
      {rows.map((r) => (
        <li key={r.key}>
          <Link href={r.href} className="flex h-9 items-center gap-3 rounded-md px-2 text-row text-ink hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--os-focus-ring,var(--os-brand))]">
            <r.icon className="h-4 w-4 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{r.sentence}</span>
            <span className="font-medium tabular-nums">{n(r.count)}</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.5} aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}
