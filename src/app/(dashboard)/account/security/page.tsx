"use client";

/* Real Account · Security page.
 *
 *  GET /api/me                  → current user identity
 *  GET /api/auth/mfa/status     → mfaEnabled + emailVerified
 *  GET /api/settings            → org-wide password / session policy
 *
 *  Wires the user's personal security posture (MFA, email verified) and
 *  shows the org policy they're subject to. Enrolment / disable is
 *  routed to dedicated flows under /account/security/mfa.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ShieldCheck, ClipboardList, ChartPie, BarChart, Calendar as CalendarIcon } from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsTabs, type TabDef } from "@/components/layout/os/tabs";
import { OsFilterBar } from "@/components/layout/os/filter-bar";
import { OsMainTable, type Column, type TableGroup, type Row } from "@/components/layout/os/main-table";
import { OsCalendar, type CalendarEvent } from "@/components/layout/os/calendar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type ApiMe = {
  user?: { id: string; firstName?: string; lastName?: string; email?: string; accessLevel?: string };
};
type ApiMfa = {
  data?: { mfaEnabled: boolean; emailVerified: boolean };
  mfaEnabled?: boolean;
  emailVerified?: boolean;
};
type SecurityPolicy = { minPasswordLength?: number; requireUppercase?: boolean; requireNumbers?: boolean; sessionTimeout?: number; twoFactorEnabled?: boolean };
type ApiSettings = {
  settings?: {
    security?: SecurityPolicy;
  };
};

function buildGroups(me: ApiMe | null, mfa: { mfaEnabled: boolean; emailVerified: boolean } | null, sec: SecurityPolicy | null): TableGroup[] {
  if (!me) return [];
  const mineRows: Row[] = [
    { id: "email",   name: "Email",          cells: { value: me.user?.email ?? "—", state: "Identity" } },
    { id: "verify",  name: "Email verified", cells: { value: mfa?.emailVerified ? "Yes" : "No", state: mfa?.emailVerified ? "good" : "warning" }, done: mfa?.emailVerified ?? false },
    { id: "mfa",     name: "Two-factor auth", cells: { value: mfa?.mfaEnabled ? "On (TOTP)" : "Off", state: mfa?.mfaEnabled ? "good" : "danger" }, done: mfa?.mfaEnabled ?? false },
    { id: "role",    name: "Access level",   cells: { value: me.user?.accessLevel ?? "EMPLOYEE", state: "Role" } },
  ];
  const policyRows: Row[] = [
    { id: "minPw",    name: "Min password length",      cells: { value: `${sec?.minPasswordLength ?? 8} characters`, state: "Policy" } },
    { id: "reqUpper", name: "Requires uppercase",       cells: { value: sec?.requireUppercase ? "Yes" : "No",        state: "Policy" } },
    { id: "reqNum",   name: "Requires numbers",         cells: { value: sec?.requireNumbers ? "Yes" : "No",          state: "Policy" } },
    { id: "session",  name: "Session timeout",          cells: { value: `${sec?.sessionTimeout ?? 30} min`,          state: "Policy" } },
    { id: "twofa",    name: "MFA org-wide requirement", cells: { value: sec?.twoFactorEnabled ? "Required" : "Optional", state: "Policy" } },
  ];
  return [
    { id: "mine",   title: "Your posture",     color: C.green,  rows: mineRows },
    { id: "policy", title: "Org policy",       color: C.indigo, rows: policyRows },
  ];
}

const COLUMNS: Column[] = [
  { id: "value", label: "Value", type: "text" },
  { id: "state", label: "State", type: "text" },
];

const TABS: TabDef[] = [
  { id: "table",     label: "Main table", Icon: ClipboardList },
  { id: "calendar",  label: "Calendar",   Icon: CalendarIcon },
  { id: "gantt",     label: "Gantt",      Icon: BarChart },
  { id: "dashboard", label: "Dashboard",  Icon: ChartPie },
];

export default function AccountSecurityPage() {
  const [me, setMe] = useState<ApiMe | null>(null);
  const [mfa, setMfa] = useState<{ mfaEnabled: boolean; emailVerified: boolean } | null>(null);
  const [orgSec, setOrgSec] = useState<SecurityPolicy | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("table");
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const [meRes, mfaRes, setRes] = await Promise.all([
        fetch("/api/me"),
        fetch("/api/auth/mfa/status"),
        fetch("/api/settings"),
      ]);
      if (!meRes.ok) throw new Error(`me ${meRes.status}`);
      const meJ: ApiMe = await meRes.json();
      setMe(meJ);
      if (mfaRes.ok) {
        const m: ApiMfa = await mfaRes.json();
        const payload = m.data ?? { mfaEnabled: m.mfaEnabled ?? false, emailVerified: m.emailVerified ?? false };
        setMfa({ mfaEnabled: !!payload.mfaEnabled, emailVerified: !!payload.emailVerified });
      }
      if (setRes.ok) {
        const s: ApiSettings = await setRes.json();
        setOrgSec(s.settings?.security ?? null);
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("account/security");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const groups = useMemo(() => buildGroups(me, mfa, orgSec), [me, mfa, orgSec]);

  const handlers = {
    onAdd: async (_g: string) => {
      toast("Security changes are gated — use the MFA enrolment / password reset flows");
      throw new Error("not supported");
    },
  };

  return (
    <>
      <OsTitleBar
        title="Account · Security"
        Icon={ShieldCheck}
        iconGradient={GRAD.greenTeal}
        description={me === null ? "Loading…" : `${me.user?.email ?? "you"} · MFA ${mfa?.mfaEnabled ? "on" : "off"} · email ${mfa?.emailVerified ? "verified" : "unverified"}`}
        people={[PEOPLE.bb]}
        morePeople={0}
      />
      <OsTabs tabs={TABS} active={activeTab} onSelect={setActiveTab} />

      {activeTab === "table" && (
        <>
          <OsFilterBar newLabel="" activeFilters={0} />
          {loadError ? (
            <OsEmptyView Icon={ShieldCheck} iconGradient={GRAD.redPink} title="Couldn't load security" subtitle={`API error: ${loadError}.`} cta="Retry" />
          ) : me === null ? (
            <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--os-ink-3)", fontSize: 13 }}>Loading…</div>
          ) : (
            <OsMainTable moduleId="account/security" columns={COLUMNS} groups={groups} handlers={handlers} />
          )}
        </>
      )}

      {activeTab === "calendar" && (
        <OsCalendar moduleId="account/security" events={[] as CalendarEvent[]} newLabel="" />
      )}

      {activeTab !== "table" && activeTab !== "calendar" && (
        <OsEmptyView Icon={ShieldCheck} iconGradient={GRAD.greenTeal} title={`${TABS.find((t) => t.id === activeTab)?.label ?? "View"} coming soon`} subtitle="Shares live data with Main table." chips={["Live data"]} cta="Back to Main table" />
      )}
    </>
  );
}
