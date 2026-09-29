"use client";

// One company (spec-admin-backoffice 2.3), drawn once for both of its forms:
// the 520 drawer over the Companies list (a soft navigation from a row, the
// @drawer intercept) and the full page (a pasted link, a refresh, a new tab).
// Same URL both ways, so Copy link always works.
//
// Every control autosaves with an inline "Saved" that fades after two
// seconds; a failed save puts the control back and raises a toast with
// Retry. There is no primary button here. Every write goes through
// PATCH /api/admin/companies/[id] or POST .../owner, which record a
// StaffAction row in the same transaction.
//
// This page absorbs the Companies list's old quick-edit dialog: plan, status,
// the five counts (Users as People, Tasks, KRAs, SOPs, Reviews), slug, domain and the joined date are all here (the counts
// in "What they use", the slug and domain in Facts), with the confirms the
// dialog skipped.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, Check, ChevronDown, Copy, Info, RefreshCw, ScrollText, ShieldCheck } from "lucide-react";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { useOsToast } from "@/components/layout/os/toast";
import { BackButton } from "@/components/ui/back-button";
import { Picker } from "@/components/ui/picker";
import { Switch } from "@/components/ui/switch";
import { StatusChip, Chip } from "@/components/ui/chip";
import { apiFetch } from "@/lib/api-fetch";
import { formatDate, formatDateTitle, formatRelative } from "@/lib/format/date";
import { PLAN_OPTIONS, STATUS_OPTIONS, companyStatusColor, peopleCount, planLabel, statusLabel } from "@/lib/admin/console-labels";
import { useCompanyCrumb, useConsole } from "../../../console-context";
import { TypedConfirmDialog, type TypedConfirmRequest } from "../../../typed-confirm-dialog";
import { AboutDialog, ConfirmDialog, InlineRetry, TEXT_LINK, BTN_SECONDARY, useCopy, useStaleRefetch, type ConfirmRequest } from "../../../console-ui";
import { SetOwnerDialog } from "./set-owner-dialog";

type Plan = "STARTER" | "GROWTH" | "SCALE" | "ENTERPRISE";
type Status = "ACTIVE" | "TRIAL" | "SUSPENDED" | "CANCELLED";

export interface CompanyRecordData {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  plan: Plan;
  status: Status;
  createdAt: string;
  features: { byok: boolean; whiteLabel: boolean };
  subscription: {
    source: "stripe" | "lifetime" | "none";
    plan: string;
    status: string;
    billingMode: string;
    seats: number | null;
    renewsAt: string | null;
    trialEndsAt: string | null;
    canceledAt: string | null;
    updatedAt: string;
  } | null;
  lifetimeCode: { code: string; tier: number; refunded: boolean } | null;
  modules: { key: string; label: string; competesWith: string; blurb: string; on: boolean; available: boolean }[];
  people: number;
  owners: { id: string; name: string; email: string }[];
  /** The Owner's own scheduled deletion, when one is set (Settings > Danger zone). */
  deletion: { scheduledFor: string; requestedAt: string | null } | null;
  counts: Record<"people" | "spaces" | "lists" | "tasks" | "docs" | "sops" | "kras" | "kpis" | "reviews", number> & {
    tables: number | null;
    talkChannels: number | null;
  };
  moduleUsage: { chat: number; tables: number };
  planLimits: Record<string, number>;
  staffActions: { id: string; createdAt: string; who: string; summary: string }[];
}

const PLAN_ORDER: Plan[] = ["STARTER", "GROWTH", "SCALE", "ENTERPRISE"];
const SAVED_MS = 2000;
const UNLIMITED_USERS = 99_999;

export function CompanyRecord({
  id,
  presentation,
  onName,
  initialName,
}: {
  id: string;
  presentation: "page" | "drawer";
  /** The drawer header names the company as soon as it is known. */
  onName?: (name: string) => void;
  /** The name the list already had, shown while the record loads. */
  initialName?: string | null;
}) {
  const router = useRouter();
  const { noteCompanyOpened, datePrefs } = useConsole();
  const { toast } = useOsToast();
  const copy = useCopy(toast);
  const [company, setCompany] = useState<CompanyRecordData | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "missing" | "failed">("loading");
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState<Record<string, number>>({});
  const [notSaved, setNotSaved] = useState<Record<string, () => void>>({});
  const [pendingStatus, setPendingStatus] = useState<"SUSPENDED" | "CANCELLED" | null>(null);
  const [confirm, setConfirm] = useState<(ConfirmRequest & { run: () => Promise<void> }) | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [ownerOpen, setOwnerOpen] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    const r = await apiFetch<CompanyRecordData>(`/api/admin/companies/${encodeURIComponent(id)}`);
    if (mine !== seq.current) return;
    if (r.ok) {
      setCompany(r.data);
      setLoadState("ready");
      setLoadedAt(Date.now());
    } else if (r.status === 404) {
      setCompany(null);
      setLoadState("missing");
    } else if (r.status !== 401) {
      setLoadState((s) => (s === "ready" ? "ready" : "failed"));
      if (company) toast("Couldn't refresh this company", { tone: "danger", action: { label: "Retry", onClick: () => void load() } });
    }
    // company is read only for the toast; a stale value is fine there.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, toast]);
  useEffect(() => {
    setLoadState("loading");
    void load();
  }, [load]);
  useStaleRefetch(() => void load(), loadedAt);

  // The breadcrumb names the company; Search's RECENT learns it was opened.
  useCompanyCrumb(company?.name ?? initialName ?? null);
  useEffect(() => {
    if (company?.name) onName?.(company.name);
  }, [company?.name, onName]);
  const notedId = useRef<string | null>(null);
  useEffect(() => {
    if (!company || notedId.current === company.id) return;
    notedId.current = company.id;
    noteCompanyOpened({ id: company.id, name: company.name, plan: company.plan, status: company.status });
  }, [company, noteCompanyOpened]);

  const markSaved = (field: string) => {
    setSaved((s) => ({ ...s, [field]: Date.now() }));
    setNotSaved((s) => {
      const n = { ...s };
      delete n[field];
      return n;
    });
    window.setTimeout(() => setSaved((s) => (Date.now() - (s[field] ?? 0) >= SAVED_MS ? { ...s, [field]: 0 } : s)), SAVED_MS + 50);
  };

  /** One autosave. Returns true when it saved. */
  const patch = useCallback(
    async (field: string, body: Record<string, unknown>, done?: (d: { signedOut?: number }) => void): Promise<boolean> => {
      setBusy(field);
      try {
        const res = await apiFetch<{ signedOut?: number; changed?: string[] }>(`/api/admin/companies/${encodeURIComponent(id)}`, {
          method: "PATCH",
          json: body,
        });
        if (res.ok) {
          markSaved(field);
          done?.(res.data);
          await load();
          return true;
        }
        if (res.status === 404) {
          setCompany(null);
          setLoadState("missing");
          return false;
        }
        if (res.status === 401) return false;
        const retry = () => void patch(field, body, done);
        setNotSaved((s) => ({ ...s, [field]: retry }));
        toast(res.error || "That did not save", { tone: "danger", action: { label: "Retry", onClick: retry } });
        return false;
      } finally {
        setBusy(null);
      }
    },
    [id, load, toast],
  );

  if (loadState === "missing") {
    return (
      <div className="p-6">
        <OsEmptyView title="We couldn't find that company" hint="It may have been deleted by its own Owner, or the link is out of date.">
          <BackButton fallbackHref="/admin/companies" label="Companies" />
        </OsEmptyView>
      </div>
    );
  }
  if (!company && loadState === "failed") {
    return (
      <div className="p-6">
        <div className="flex h-11 items-center rounded-lg border border-line bg-raised px-4">
          <InlineRetry text="Could not load this company." onRetry={() => { setLoadState("loading"); void load(); }} />
        </div>
      </div>
    );
  }

  const pad = presentation === "drawer" ? "p-5" : "px-6 pb-10";
  const menu = [
    { label: "Refresh", icon: RefreshCw, onClick: () => void load() },
    { label: "Copy company ID", icon: Copy, onClick: () => void copy(id, "Company ID") },
    { label: "Copy slug", icon: Copy, onClick: () => { if (company) void copy(company.slug, "Slug"); }, disabled: !company },
    { label: "Staff activity", icon: ScrollText, onClick: () => router.push(`/admin/audit?company=${encodeURIComponent(id)}`) },
    { label: "About this page", icon: Info, onClick: () => setAboutOpen(true) },
  ];

  return (
    <>
      {presentation === "page" ? (
        <OsPageHeader
          title={company?.name ?? initialName ?? "Company"}
          back={{ fallbackHref: "/admin/companies", label: "Companies" }}
          tile={{ fallbackIcon: Building2, name: company?.name ?? "Company" }}
          actions={
            company ? (
              <span className="inline-flex items-center gap-2">
                <Chip as="span" className="h-6 border-line bg-raised px-2 text-xs text-ink-2">{planLabel(company.plan)}</Chip>
                <StatusChip color={companyStatusColor(company.status)} label={statusLabel(company.status)} />
              </span>
            ) : null
          }
          more={menu}
        />
      ) : null}
      {/* The drawer's own header (company-drawer-host.tsx) holds Expand, Copy
          link and Close and nothing else. The page "..." rows are all in the
          body too: Copy slug and Copy company ID on Facts, Staff activity's
          See all, and the record refetches after every save and on focus. */}

      <div className={`os-chrome ${pad}`}>
        <div className={`flex w-full flex-col gap-4 ${presentation === "page" ? "max-w-[760px] pt-2" : ""}`}>
          {!company ? (
            <Skeletons />
          ) : (
            <>
              <FactsCard company={company} datePrefs={datePrefs} onCopy={copy} />
              <PlanCard
                company={company}
                busy={busy}
                saved={saved}
                notSaved={notSaved}
                datePrefs={datePrefs}
                onPlan={(next) => {
                  const limit = company.planLimits[next] ?? UNLIMITED_USERS;
                  const lowering = PLAN_ORDER.indexOf(next) < PLAN_ORDER.indexOf(company.plan);
                  if (lowering && company.people > limit) {
                    setConfirm({
                      title: `Change ${company.name} to ${planLabel(next)}?`,
                      body: `${planLabel(next)} allows ${limit} people. ${company.name} has ${company.people}. They keep their people; new invitations will be blocked. Change the plan anyway?`,
                      confirmLabel: "Change plan",
                      run: async () => { await patch("plan", { plan: next }); },
                    });
                    return;
                  }
                  void patch("plan", { plan: next });
                }}
                onStatus={(next) => {
                  if (next === "SUSPENDED" || next === "CANCELLED") {
                    setPendingStatus(next);
                    return;
                  }
                  // Leaving Cancelled clears the Owner's own scheduled
                  // deletion (company-patch.ts), so say so before it happens.
                  if (company.deletion) {
                    setConfirm({
                      title: `Set ${company.name} to ${statusLabel(next)}?`,
                      body: `Its Owner scheduled this workspace for deletion on ${formatDate(company.deletion.scheduledFor, datePrefs, "date")}. Setting it to ${statusLabel(next)} cancels that deletion and lets everyone sign in again. Tell the Owner if they still want it deleted.`,
                      confirmLabel: `Set to ${statusLabel(next)}`,
                      run: async () => { await patch("status", { status: next }); },
                    });
                    return;
                  }
                  void patch("status", { status: next });
                }}
                onSeats={(n) => patch("seats", { seats: n })}
              />
              <ModulesCard
                company={company}
                busy={busy}
                saved={saved}
                onToggle={(key, label, on) => {
                  if (on) {
                    void patch(`module:${key}`, { module: key, enabled: true });
                    return;
                  }
                  const n = key === "chat" ? company.moduleUsage.chat : company.moduleUsage.tables;
                  const what = key === "chat" ? (n === 1 ? "channel" : "channels") : n === 1 ? "table" : "tables";
                  setConfirm({
                    title: `Turn ${label} off?`,
                    body: `Turning ${label} off locks ${n} ${what} for everyone at ${company.name} until it is turned on again. Nothing is deleted.`,
                    confirmLabel: `Turn ${label} off`,
                    run: async () => { await patch(`module:${key}`, { module: key, enabled: false }); },
                  });
                }}
              />
              <AddOnsCard
                company={company}
                busy={busy}
                saved={saved}
                onToggle={(feature, on) => void patch(`feature:${feature}`, { feature, enabled: on })}
              />
              <PeopleCard company={company} onSetOwner={() => setOwnerOpen(true)} />
              <UsageCard company={company} />
              <ActivityCard company={company} datePrefs={datePrefs} />
              <p className="text-sm text-ink-2">
                There is no delete here. A workspace is deleted by its own Owner in Settings › Identity &amp; culture › Danger zone.
              </p>
            </>
          )}
        </div>
      </div>

      {company ? (
        <>
          <TypedConfirmDialog
            request={statusConfirm(company, pendingStatus, datePrefs)}
            busy={busy === "status"}
            onCancel={() => setPendingStatus(null)}
            onConfirm={async () => {
              const next = pendingStatus;
              if (!next) return;
              const ok = await patch("status", { status: next, confirm: company.name }, (d) => {
                const n = typeof d.signedOut === "number" ? d.signedOut : 0;
                toast(
                  `${company.name} is ${next === "SUSPENDED" ? "suspended" : "cancelled"}`,
                  n > 0 ? { description: `${peopleCount(n)} signed out within five minutes.` } : undefined,
                );
              });
              if (ok) setPendingStatus(null);
            }}
          />
          <ConfirmDialog
            request={confirm}
            busy={busy !== null}
            onCancel={() => setConfirm(null)}
            onConfirm={async () => {
              const c = confirm;
              if (!c) return;
              await c.run();
              setConfirm(null);
            }}
          />
          <SetOwnerDialog
            open={ownerOpen}
            company={company}
            onClose={() => setOwnerOpen(false)}
            onDone={(name) => {
              setOwnerOpen(false);
              toast(`${name} now has Owner access at ${company.name}`);
              void load();
            }}
          />
          <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} title="Company">
            What this company pays for, what they have turned on, and who runs their workspace. Counts only; no customer
            content is ever shown here, and WorkwrK staff cannot sign in to a customer&apos;s workspace.
          </AboutDialog>
        </>
      ) : null}
    </>
  );
}

/** Says only what the build does (the write bumps tokenVersion; the session check reads the workspace status). */
function statusConfirm(
  company: CompanyRecordData,
  next: "SUSPENDED" | "CANCELLED" | null,
  datePrefs: ReturnType<typeof useConsole>["datePrefs"],
): TypedConfirmRequest | null {
  if (!next) return null;
  // A staff change of status clears the Owner's own deletion schedule
  // (company-patch.ts); the confirm says so when there is one.
  const undoes = company.deletion
    ? ` This also cancels the deletion its Owner scheduled for ${formatDate(company.deletion.scheduledFor, datePrefs, "date")}.`
    : "";
  return {
    title: next === "SUSPENDED" ? `Suspend ${company.name}?` : `Set ${company.name} to Cancelled?`,
    body:
      next === "SUSPENDED"
        ? `Nobody there can sign in, and everyone signed in now is signed out within five minutes. Nothing is deleted, and you can set this back to Active at any time.${undoes}`
        : `Nobody there can sign in, and everyone signed in now is signed out within five minutes. Members are told the workspace is closed and to contact WorkwrK support. Nothing is deleted and no deletion is scheduled: this console never deletes a company. Set it back to Active to restore it at any time.${undoes}`,
    note: "Anyone who also belongs to another WorkwrK workspace keeps working in that one.",
    match: company.name,
    matchLabel: "the company name",
    confirmLabel: next === "SUSPENDED" ? "Suspend" : "Set to Cancelled",
  };
}

/* ───────────────────────────── pieces ───────────────────────────── */

function Card({ title, children, footer }: { title?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-raised">
      <div className="flex flex-col gap-3 p-4">
        {title ? <h2 className="text-lg font-semibold text-ink">{title}</h2> : null}
        {children}
      </div>
      {footer ? <div className="border-t border-line-soft px-4 py-2.5">{footer}</div> : null}
    </section>
  );
}

function SavedMark({ at }: { at: number | undefined }) {
  if (!at) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-success-text" role="status">
      Saved <Check className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
    </span>
  );
}

function NotSavedMark({ retry }: { retry: (() => void) | undefined }) {
  if (!retry) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-danger-text" role="status">
      Not saved ·
      <button type="button" onClick={retry} className="font-medium underline-offset-2 hover:underline">Retry</button>
    </span>
  );
}

function Fact({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`flex min-w-0 flex-col gap-0.5 ${wide ? "sm:col-span-2" : ""}`}>
      <dt className="text-sm font-medium text-ink-2">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1 text-base text-ink">{children}</dd>
    </div>
  );
}

function CopyButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
      <Copy className="h-4 w-4" strokeWidth={1.5} aria-hidden />
    </button>
  );
}

function FactsCard({ company, datePrefs, onCopy }: { company: CompanyRecordData; datePrefs: ReturnType<typeof useConsole>["datePrefs"]; onCopy: (t: string, w: string) => void }) {
  return (
    <Card>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-3">
        <Fact label="Signed up">
          <span title={formatDateTitle(company.createdAt, datePrefs)}>{formatDate(company.createdAt, datePrefs, "date")}</span>
        </Fact>
        <Fact label="Sign-in domain">
          <span className={company.domain ? "truncate" : "text-ink-3"}>{company.domain ?? "Not set"}</span>
        </Fact>
        <Fact label="Slug">
          <span className="truncate font-mono text-sm">{company.slug}</span>
          <CopyButton label="Copy slug" onClick={() => onCopy(company.slug, "Slug")} />
        </Fact>
        <Fact label="Company ID" wide>
          <span className="truncate font-mono text-sm">{company.id}</span>
          <CopyButton label="Copy company ID" onClick={() => onCopy(company.id, "Company ID")} />
        </Fact>
      </dl>
    </Card>
  );
}

function SelectButton({
  label,
  value,
  options,
  onSelect,
  disabled,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onSelect: (v: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value)?.label ?? value;
  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-label={`${label}: ${current}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex h-9 min-w-[180px] items-center justify-between gap-2 rounded-md border border-line-strong bg-raised px-3 text-base text-ink hover:bg-hover disabled:opacity-60"
      >
        <span className="truncate">{current}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.5} aria-hidden />
      </button>
      <Picker
        open={open}
        onClose={() => setOpen(false)}
        ariaLabel={label}
        selected={value}
        onSelect={(v) => {
          setOpen(false);
          if (v !== value) onSelect(v);
        }}
        sections={[{ options: options.map((o) => ({ value: o.value, label: o.label })) }]}
        width={220}
      />
    </span>
  );
}

function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 border-t border-line-soft pt-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-28 shrink-0 text-sm font-medium text-ink-2">{label}</span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</div>
      </div>
      {hint ? <p className="ms-0 text-sm text-ink-2 sm:ms-[124px]">{hint}</p> : null}
    </div>
  );
}

function PlanCard({
  company,
  busy,
  saved,
  notSaved,
  datePrefs,
  onPlan,
  onStatus,
  onSeats,
}: {
  company: CompanyRecordData;
  busy: string | null;
  saved: Record<string, number>;
  notSaved: Record<string, () => void>;
  datePrefs: ReturnType<typeof useConsole>["datePrefs"];
  onPlan: (p: Plan) => void;
  onStatus: (s: Status) => void;
  onSeats: (n: number | null) => Promise<boolean>;
}) {
  const sub = company.subscription;
  const limit = company.planLimits[company.plan] ?? UNLIMITED_USERS;
  const limitText = limit >= UNLIMITED_USERS ? `${planLabel(company.plan)} has no people limit.` : `${planLabel(company.plan)} allows ${limit}.`;
  return (
    <Card title="Plan and billing">
      <Row label="Plan" hint={`They have ${peopleCount(company.people)}. ${limitText}`}>
        <SelectButton label="Plan" value={company.plan} options={PLAN_OPTIONS} onSelect={(v) => onPlan(v as Plan)} disabled={busy !== null} />
        <SavedMark at={saved.plan} />
        <NotSavedMark retry={notSaved.plan} />
      </Row>
      <Row
        label="Status"
        hint={
          company.deletion ? (
            <span className="text-danger-text">
              Its Owner scheduled this workspace for deletion on {formatDate(company.deletion.scheduledFor, datePrefs, "date")}. Any status change here cancels that deletion.
            </span>
          ) : undefined
        }
      >
        <SelectButton label="Status" value={company.status} options={STATUS_OPTIONS} onSelect={(v) => onStatus(v as Status)} disabled={busy !== null} />
        <SavedMark at={saved.status} />
        <NotSavedMark retry={notSaved.status} />
      </Row>
      <SeatsRow company={company} busy={busy} saved={saved} notSaved={notSaved} onSeats={onSeats} />
      <Row label="Subscription">
        <span className="text-base text-ink">
          <SubscriptionLine company={company} datePrefs={datePrefs} />
        </span>
      </Row>
      {sub?.trialEndsAt ? (
        <Row label="Trial ends">
          <span className="text-base text-ink">{trialLine(sub.trialEndsAt, datePrefs)}</span>
        </Row>
      ) : null}
    </Card>
  );
}

function trialLine(at: string, datePrefs: ReturnType<typeof useConsole>["datePrefs"]): string {
  const days = Math.ceil((new Date(at).getTime() - Date.now()) / 86_400_000);
  const when = formatDate(at, datePrefs, "date");
  if (days < 0) return `${when} (ended)`;
  return `${when} (${days} ${days === 1 ? "day" : "days"})`;
}

function SubscriptionLine({ company, datePrefs }: { company: CompanyRecordData; datePrefs: ReturnType<typeof useConsole>["datePrefs"] }) {
  const sub = company.subscription;
  if (!sub || sub.source === "none") return <>No subscription. On the {planLabel(company.plan)} plan by default.</>;
  if (sub.source === "lifetime") {
    const code = company.lifetimeCode;
    return (
      <>
        Lifetime deal{code ? ` · AppSumo Tier ${code.tier}` : ""}
        {code?.refunded ? " · code refunded" : ""}
        {code ? (
          <>
            {" · "}
            <Link href={`/admin/appsumo?code=${encodeURIComponent(code.code)}`} className={TEXT_LINK}>See the code</Link>
          </>
        ) : null}
      </>
    );
  }
  const status = sub.status.toUpperCase();
  if (status === "PAST_DUE") {
    return (
      <span className="text-danger-text">
        Stripe · past due{sub.updatedAt ? ` since ${formatDate(sub.updatedAt, datePrefs, "date")}` : ""}
      </span>
    );
  }
  if (status === "CANCELED") {
    return <>Stripe · cancelled{sub.canceledAt ? ` ${formatDate(sub.canceledAt, datePrefs, "date")}` : ""}</>;
  }
  const word = status === "TRIALING" ? "trialing" : status === "INCOMPLETE" ? "incomplete" : "active";
  return <>Stripe · {word}{sub.renewsAt ? ` · renews ${formatDate(sub.renewsAt, datePrefs, "date")}` : ""}</>;
}

function SeatsRow({
  company,
  busy,
  saved,
  notSaved,
  onSeats,
}: {
  company: CompanyRecordData;
  busy: string | null;
  saved: Record<string, number>;
  notSaved: Record<string, () => void>;
  onSeats: (n: number | null) => Promise<boolean>;
}) {
  const sub = company.subscription;
  const stored = sub?.seats ?? null;
  const [text, setText] = useState(stored == null ? "" : String(stored));
  const [seen, setSeen] = useState(stored);
  if (seen !== stored) {
    setSeen(stored);
    setText(stored == null ? "" : String(stored));
  }
  if (!sub || sub.source === "none") {
    return (
      <Row label="Seats">
        <span className="text-base text-ink-2">No subscription, so there is no seat count to set. The plan&apos;s people limit above applies. Seats come with a Stripe checkout or a redeemed code.</span>
      </Row>
    );
  }
  const commit = async () => {
    const t = text.trim();
    const n = t === "" ? null : Number.parseInt(t, 10);
    if (n !== null && (!Number.isFinite(n) || n < 0)) {
      setText(stored == null ? "" : String(stored));
      return;
    }
    const next = n === 0 ? null : n;
    if (next === stored) return;
    const ok = await onSeats(next);
    // A failed save puts the box back to the value that is stored.
    if (!ok) setText(stored == null ? "" : String(stored));
  };
  const using = `${peopleCount(company.people)} ${company.people === 1 ? "is" : "are"} using ${stored == null ? "unlimited" : stored} seats.`;
  return (
    <Row
      label="Seats"
      hint={
        sub.source === "stripe"
          ? `${using} Stripe sets this on every renewal, so a change here lasts until the next Stripe update. Empty means unlimited.`
          : `${using} Empty means unlimited.`
      }
    >
      <input
        inputMode="numeric"
        value={text}
        onChange={(e) => setText(e.target.value.replace(/[^\d]/g, ""))}
        onBlur={() => void commit()}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        placeholder="Unlimited"
        aria-label="Seats"
        disabled={busy !== null && busy !== "seats"}
        className="h-9 w-32 rounded-md border border-line-strong bg-raised px-3 text-base tabular-nums text-ink placeholder:text-ink-3 focus:outline-none focus-visible:border-brand disabled:opacity-60"
      />
      <SavedMark at={saved.seats} />
      <NotSavedMark retry={notSaved.seats} />
    </Row>
  );
}

function SwitchRow({
  title,
  sub,
  checked,
  disabled,
  onChange,
  savedAt,
  trailing,
}: {
  title: string;
  sub: string;
  checked: boolean;
  disabled?: boolean;
  onChange?: (v: boolean) => void;
  savedAt?: number;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex min-h-12 items-center gap-3 border-t border-line-soft pt-3 first:border-t-0 first:pt-0">
      <div className="min-w-0 flex-1">
        <div className="text-row font-medium text-ink">{title}</div>
        <p className="text-sm text-ink-2">{sub}</p>
      </div>
      <SavedMark at={savedAt} />
      {trailing ?? <Switch checked={checked} disabled={disabled} onChange={onChange} aria-label={title} />}
    </div>
  );
}

function ModulesCard({
  company,
  busy,
  saved,
  onToggle,
}: {
  company: CompanyRecordData;
  busy: string | null;
  saved: Record<string, number>;
  onToggle: (key: string, label: string, on: boolean) => void;
}) {
  return (
    <Card title="Modules">
      <p className="-mt-1 text-sm text-ink-2">This is the same switch an Owner sees in Settings › Apps &amp; modules.</p>
      {company.modules.map((m) => (
        <SwitchRow
          key={m.key}
          title={m.label}
          sub={`${m.competesWith} · ${m.blurb}`}
          checked={m.on}
          disabled={busy !== null}
          onChange={(v) => onToggle(m.key, m.label, v)}
          savedAt={saved[`module:${m.key}`]}
          trailing={
            m.available ? undefined : <span className="shrink-0 text-sm text-ink-2">Not set up on this server</span>
          }
        />
      ))}
    </Card>
  );
}

function AddOnsCard({
  company,
  busy,
  saved,
  onToggle,
}: {
  company: CompanyRecordData;
  busy: string | null;
  saved: Record<string, number>;
  onToggle: (feature: "byok" | "whiteLabel", on: boolean) => void;
}) {
  if (company.plan !== "ENTERPRISE") {
    return (
      <Card title="Enterprise add-ons">
        <p className="text-base text-ink-2">Add-ons come with the Enterprise plan. Change the plan above to turn them on.</p>
      </Card>
    );
  }
  return (
    <Card title="Enterprise add-ons">
      <SwitchRow
        title="Bring your own AI key"
        sub="They add their own Anthropic key in Settings. Without it, AI runs on the WorkwrK key."
        checked={company.features.byok}
        disabled={busy !== null}
        onChange={(v) => onToggle("byok", v)}
        savedAt={saved["feature:byok"]}
      />
      <SwitchRow
        title="White label"
        sub="Their logo and colour replace the WorkwrK mark in the app and in emails."
        checked={company.features.whiteLabel}
        disabled={busy !== null}
        onChange={(v) => onToggle("whiteLabel", v)}
        savedAt={saved["feature:whiteLabel"]}
      />
    </Card>
  );
}

function PeopleCard({ company, onSetOwner }: { company: CompanyRecordData; onSetOwner: () => void }) {
  const owners = company.owners;
  return (
    <Card title="People and support access">
      <p className="text-base text-ink">
        {peopleCount(company.people)} · {owners.length} with Owner access
      </p>
      {owners.length === 0 ? (
        <p className="text-base text-danger-text">Nobody here has Owner access.</p>
      ) : (
        <ul className="flex flex-col">
          {owners.slice(0, 5).map((o) => (
            <li key={o.id} className="flex h-9 min-w-0 items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-active text-micro font-medium text-ink" aria-hidden>
                {(o.name || o.email).trim().charAt(0).toUpperCase()}
              </span>
              <span className="truncate text-base text-ink">{o.name}</span>
              <a href={`mailto:${o.email}`} className="truncate text-sm text-ink-2 hover:text-ink hover:underline">{o.email}</a>
            </li>
          ))}
          {owners.length > 5 ? <li className="text-sm text-ink-2">and {owners.length - 5} more</li> : null}
        </ul>
      )}
      <div>
        <button type="button" onClick={onSetOwner} className={BTN_SECONDARY}>
          <ShieldCheck className="h-4 w-4" strokeWidth={1.5} aria-hidden />
          Set workspace Owner
        </button>
      </div>
      <p className="rounded-md border border-line bg-subtle p-3 text-sm text-ink-2">
        WorkwrK staff cannot sign in to this workspace. There is no impersonation and no view-as. To help this customer,
        ask an Owner to invite you: the invitation appears in their Members list and they can remove you at any time.
      </p>
    </Card>
  );
}

function UsageCard({ company }: { company: CompanyRecordData }) {
  const c = company.counts;
  const items: [string, number | null][] = [
    ["People", c.people],
    ["Spaces", c.spaces],
    ["Lists", c.lists],
    ["Tasks", c.tasks],
    ["Docs", c.docs],
    ["SOPs", c.sops],
    ["KRAs", c.kras],
    ["KPIs", c.kpis],
    ["Reviews", c.reviews],
    ["Tables", c.tables],
    ["Talk channels", c.talkChannels],
  ];
  return (
    <Card title="What they use">
      <p className="-mt-1 text-sm text-ink-2">Counts only. No customer content is ever shown in this console.</p>
      <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
        {items.map(([label, n]) => (
          <div key={label} className="flex h-9 items-center justify-between gap-3 border-b border-line-soft">
            <dt className="text-base text-ink-2">{label}</dt>
            <dd className="text-base tabular-nums text-ink">{n == null ? <span className="text-ink-3" title="The module is off">None</span> : new Intl.NumberFormat().format(n)}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function ActivityCard({ company, datePrefs }: { company: CompanyRecordData; datePrefs: ReturnType<typeof useConsole>["datePrefs"] }) {
  return (
    <Card
      title="Staff activity"
      footer={
        <Link href={`/admin/audit?company=${encodeURIComponent(company.id)}`} className={`text-sm ${TEXT_LINK}`}>See all</Link>
      }
    >
      {company.staffActions.length === 0 ? (
        <p className="text-base text-ink-2">No staff changes yet.</p>
      ) : (
        <ul className="flex flex-col">
          {company.staffActions.map((a) => (
            <li key={a.id} className="flex h-9 min-w-0 items-center gap-3">
              <span className="w-20 shrink-0 text-xs font-medium tabular-nums text-ink-2" title={formatDateTitle(a.createdAt, datePrefs)}>
                {formatRelative(a.createdAt, datePrefs)}
              </span>
              <span className="truncate text-base text-ink" title={`${a.who}: ${a.summary}`}>
                <span className="font-medium">{a.who}</span> · {a.summary}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Skeletons() {
  const heights = [88, 260, 150, 90, 200, 220, 150];
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading">
      {heights.map((h, i) => (
        <div key={i} className="rounded-lg border border-line bg-raised p-4" style={{ height: h }}>
          <span className="block h-4 w-40 rounded bg-skeleton os-skeleton-pulse" />
        </div>
      ))}
    </div>
  );
}
