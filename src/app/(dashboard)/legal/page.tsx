"use client";

/* Legal hub — overview of contracts, IP, privacy, policies. */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Scale, FileSignature, Lock, Shield, ChevronRight, BookOpen, Hash,
  AlertTriangle, CheckCircle2,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { GRAD } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";

type Counts = {
  contracts: number;
  contractsActive: number;
  contractsExpiring: number;
  ip: number;
  ipRegistered: number;
  ipRenewing: number;
  privacy: number;
  privacyOpen: number;
  privacyOverdue: number;
};

const MS_DAY = 86_400_000;

function safeList(d: unknown): unknown[] {
  if (Array.isArray(d)) return d;
  const x = d as { data?: unknown; contracts?: unknown; trademarks?: unknown; privacyRequests?: unknown };
  if (Array.isArray(x?.contracts)) return x.contracts as unknown[];
  if (Array.isArray(x?.trademarks)) return x.trademarks as unknown[];
  if (Array.isArray(x?.privacyRequests)) return x.privacyRequests as unknown[];
  if (Array.isArray(x?.data)) return x.data as unknown[];
  return [];
}

export default function LegalHubPage() {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { rowVersion } = useOsShell();

  const load = useCallback(async () => {
    try {
      const [cR, ipR, pR] = await Promise.all([
        fetch("/api/legal/contracts").catch(() => null),
        fetch("/api/legal/trademarks").catch(() => null),
        fetch("/api/legal/privacy-requests").catch(() => null),
      ]);
      const j = async (r: Response | null) => r && r.ok ? await r.json() : null;
      const [cD, ipD, pD] = await Promise.all([j(cR), j(ipR), j(pR)]);
      const contracts = safeList(cD) as { status?: string; expiresAt?: string | null }[];
      const ip = safeList(ipD) as { status?: string; renewalDueAt?: string | null; expiresAt?: string | null }[];
      const privacy = safeList(pD) as { status?: string; dueAt?: string | null }[];

      setCounts({
        contracts: contracts.length,
        contractsActive: contracts.filter((c) => c.status === "ACTIVE" || c.status === "SIGNED").length,
        contractsExpiring: contracts.filter((c) => {
          if (!c.expiresAt) return false;
          const d = Math.ceil((new Date(c.expiresAt).getTime() - Date.now()) / MS_DAY);
          return d >= 0 && d <= 90;
        }).length,
        ip: ip.length,
        ipRegistered: ip.filter((i) => i.status === "REGISTERED").length,
        ipRenewing: ip.filter((i) => {
          const date = i.renewalDueAt ?? i.expiresAt;
          if (!date) return false;
          const d = Math.ceil((new Date(date).getTime() - Date.now()) / MS_DAY);
          return d >= 0 && d <= 90;
        }).length,
        privacy: privacy.length,
        privacyOpen: privacy.filter((p) => p.status !== "FULFILLED" && p.status !== "REJECTED").length,
        privacyOverdue: privacy.filter((p) => {
          if (!p.dueAt) return false;
          if (p.status === "FULFILLED" || p.status === "REJECTED") return false;
          return new Date(p.dueAt).getTime() < Date.now();
        }).length,
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("legal");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const loading = counts === null;
  const alerts = useMemo(() => {
    if (!counts) return [];
    const a: { label: string; tone: "danger" | "warn"; href: string }[] = [];
    if (counts.privacyOverdue > 0) a.push({ label: `${counts.privacyOverdue} privacy request${counts.privacyOverdue === 1 ? "" : "s"} past SLA`, tone: "danger", href: "/legal/privacy" });
    if (counts.contractsExpiring > 0) a.push({ label: `${counts.contractsExpiring} contract${counts.contractsExpiring === 1 ? "" : "s"} expiring in 90d`, tone: "warn", href: "/legal/contracts" });
    if (counts.ipRenewing > 0) a.push({ label: `${counts.ipRenewing} IP item${counts.ipRenewing === 1 ? "" : "s"} need renewal`, tone: "warn", href: "/legal/ip" });
    return a;
  }, [counts]);

  return (
    <>
      <OsTitleBar
        title="Legal"
        Icon={Scale}
        iconGradient={GRAD.purpleIndigo}
        description={loading ? "Loading legal posture…" : `${counts.contracts} contracts · ${counts.ip} IP items · ${counts.privacyOpen} open privacy requests`}
        actions={
          <div className="leg__head-actions">
            <Link href="/legal/contracts" className="leg__nav-link"><FileSignature /> Contracts</Link>
            <Link href="/legal/ip" className="leg__nav-link"><Lock /> IP</Link>
            <Link href="/legal/privacy" className="leg__nav-link"><Shield /> Privacy</Link>
          </div>
        }
      />

      <div className="leg">
        {error && <div className="leg__error">{error}</div>}

        <div className="leg__kpis">
          <KpiTile accent="var(--os-c-brown)"  Icon={FileSignature} label="Contracts" value={loading ? "…" : `${counts!.contractsActive}`} sub={loading ? "" : `${counts!.contracts} total · ${counts!.contractsExpiring} expiring`} />
          <KpiTile accent="var(--os-c-purple)" Icon={Lock}          label="IP items"  value={loading ? "…" : `${counts!.ipRegistered}`}    sub={loading ? "" : `${counts!.ip} total · ${counts!.ipRenewing} need renewal`} />
          <KpiTile accent="var(--os-c-red)"    Icon={Shield}        label="Privacy"   value={loading ? "…" : `${counts!.privacyOpen}`}     sub={loading ? "" : `${counts!.privacy} total · ${counts!.privacyOverdue} overdue`} />
          <KpiTile accent={alerts.length > 0 ? "var(--os-c-orange)" : "var(--os-c-green)"} Icon={alerts.length > 0 ? AlertTriangle : CheckCircle2} label="Action items" value={`${alerts.length}`} sub={alerts.length > 0 ? "see below" : "all clear"} />
        </div>

        {alerts.length > 0 && (
          <section className="leg__alerts">
            <header className="leg__alerts-head">
              <h2><AlertTriangle /> Needs attention</h2>
              <span className="leg__alerts-line" />
            </header>
            <div className="leg__alerts-list">
              {alerts.map((a) => (
                <Link key={a.label} href={a.href} className={`leg__alert leg__alert--${a.tone}`}>
                  <AlertTriangle />
                  <span>{a.label}</span>
                  <ChevronRight />
                </Link>
              ))}
            </div>
          </section>
        )}

        <section className="leg__section">
          <header className="leg__section-head">
            <h2><Hash /> Workspaces</h2>
            <span className="leg__section-line" />
          </header>
          <div className="leg__grid">
            <HubTile href="/legal/contracts" Icon={FileSignature} hue="var(--os-c-brown)"
              title="Contracts" stat={loading ? "—" : `${counts!.contracts}`} sub="MSA · NDA · vendor · customer" />
            <HubTile href="/legal/ip" Icon={Lock} hue="var(--os-c-purple)"
              title="IP register" stat={loading ? "—" : `${counts!.ip}`} sub="trademarks · copyrights · patents" />
            <HubTile href="/legal/privacy" Icon={Shield} hue="var(--os-c-red)"
              title="Privacy requests" stat={loading ? "—" : `${counts!.privacyOpen}`} sub="DSAR · GDPR · CCPA" />
            <HubTile href="/policies" Icon={BookOpen} hue="var(--os-c-indigo)"
              title="Policies" stat="Library" sub="employee ack-tracked" />
          </div>
        </section>
      </div>
    </>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof Scale; label: string; value: string; sub: string }) {
  return (
    <div className="leg__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="leg__kpi-accent" aria-hidden="true" />
      <div className="leg__kpi-row">
        <div className="leg__kpi-icon"><Icon /></div>
        <div className="leg__kpi-label">{label}</div>
      </div>
      <div className="leg__kpi-value">{value}</div>
      <div className="leg__kpi-sub">{sub}</div>
    </div>
  );
}

function HubTile({ href, Icon, hue, title, stat, sub }: { href: string; Icon: typeof Scale; hue: string; title: string; stat: string; sub: string }) {
  return (
    <Link href={href} className="leg__tile" style={{ ["--tile-hue" as unknown as string]: hue }}>
      <span className="leg__tile-icon"><Icon /></span>
      <div className="leg__tile-body">
        <div className="leg__tile-title">{title}</div>
        <div className="leg__tile-stat">{stat}</div>
        <div className="leg__tile-sub">{sub}</div>
      </div>
      <ChevronRight className="leg__tile-chev" />
    </Link>
  );
}

