"use client";

/* Integrations marketplace — third-party connectors browseable by category. */

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Globe, Search, Hash, CheckCircle2, Plus, ChevronRight, Sparkles,
  MessageCircle, Mail, Code, Hash as HashIcon, Cloud, Banknote, BarChart, Briefcase,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD } from "@/components/layout/os/catalog";
import { useOsToast } from "@/components/layout/os/toast";

type Category = "messaging" | "code" | "storage" | "finance" | "analytics" | "ats" | "sso";

type Integration = {
  id: string;
  name: string;
  category: Category;
  tagline: string;
  hue: string;
  Icon: typeof Globe;
  installed: boolean;
};

const INTEGRATIONS: Integration[] = [
  { id: "slack", name: "Slack", category: "messaging", tagline: "Channel notifications, slash commands, /standup", hue: C.purple, Icon: HashIcon, installed: true },
  { id: "teams", name: "Microsoft Teams", category: "messaging", tagline: "Workflow alerts in channels and chats", hue: C.blue, Icon: MessageCircle, installed: false },
  { id: "gmail", name: "Gmail", category: "messaging", tagline: "Send + receive shared inbox messages", hue: C.red, Icon: Mail, installed: true },
  { id: "github", name: "GitHub", category: "code", tagline: "Link tasks to PRs, auto-close on merge", hue: C.gray, Icon: Code, installed: true },
  { id: "gitlab", name: "GitLab", category: "code", tagline: "Mirror issues + MRs into Tasks", hue: C.orange, Icon: Code, installed: false },
  { id: "jira", name: "Jira", category: "code", tagline: "Two-way ticket sync with WorkwrK Tasks", hue: C.blue, Icon: Briefcase, installed: false },
  { id: "linear", name: "Linear", category: "code", tagline: "Bidirectional issue mirror", hue: C.purple, Icon: Briefcase, installed: false },
  { id: "drive", name: "Google Drive", category: "storage", tagline: "Attach docs from Drive in any module", hue: C.green, Icon: Cloud, installed: false },
  { id: "onedrive", name: "OneDrive", category: "storage", tagline: "Pin files from OneDrive", hue: C.blue, Icon: Cloud, installed: false },
  { id: "stripe", name: "Stripe", category: "finance", tagline: "Sync payments into the GL ledger", hue: C.purple, Icon: Banknote, installed: true },
  { id: "qb", name: "QuickBooks", category: "finance", tagline: "Mirror invoices, expenses, and journal entries", hue: C.green, Icon: Banknote, installed: false },
  { id: "looker", name: "Looker", category: "analytics", tagline: "Embed dashboards in any board", hue: C.blue, Icon: BarChart, installed: false },
  { id: "metabase", name: "Metabase", category: "analytics", tagline: "Pin saved questions to a tile", hue: C.orange, Icon: BarChart, installed: false },
  { id: "greenhouse", name: "Greenhouse", category: "ats", tagline: "Sync candidate pipeline into Recruiting", hue: C.green, Icon: Briefcase, installed: false },
  { id: "okta", name: "Okta SSO", category: "sso", tagline: "SAML SSO + SCIM provisioning", hue: C.blue, Icon: CheckCircle2, installed: true },
  { id: "azuread", name: "Microsoft Entra ID", category: "sso", tagline: "SAML SSO + group sync", hue: C.indigo, Icon: CheckCircle2, installed: false },
];

const CATEGORY_LABEL: Record<Category | "all", string> = {
  all: "All",
  messaging: "Messaging",
  code: "Code & projects",
  storage: "Storage",
  finance: "Finance",
  analytics: "Analytics",
  ats: "Recruiting",
  sso: "SSO & identity",
};

export default function IntegrationsPage() {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<Category | "all">("all");
  const [installed, setInstalled] = useState<Set<string>>(new Set(INTEGRATIONS.filter((i) => i.installed).map((i) => i.id)));
  const { toast } = useOsToast();

  const stats = useMemo(() => ({
    total: INTEGRATIONS.length,
    installed: installed.size,
    available: INTEGRATIONS.length - installed.size,
  }), [installed]);

  const filtered = useMemo(() => {
    let list = INTEGRATIONS;
    if (activeCategory !== "all") list = list.filter((i) => i.category === activeCategory);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((i) => i.name.toLowerCase().includes(q) || i.tagline.toLowerCase().includes(q));
    return list;
  }, [search, activeCategory]);

  function toggle(id: string, current: boolean) {
    if (current) {
      if (!window.confirm("Disconnect this integration?")) return;
      setInstalled((s) => { const n = new Set(s); n.delete(id); return n; });
      toast("Disconnected");
    } else {
      setInstalled((s) => new Set(s).add(id));
      toast("Installed (demo)");
    }
  }

  const cats: (Category | "all")[] = ["all", "messaging", "code", "storage", "finance", "analytics", "ats", "sso"];

  return (
    <>
      <OsTitleBar
        title="Integrations"
        Icon={Globe}
        iconGradient={GRAD.tealGreen}
        description={`${stats.total} integrations · ${stats.installed} connected · ${stats.available} available`}
        actions={
          <div className="ing__head-actions">
            <Link href="/settings" className="ing__nav-link"><Hash /> Settings</Link>
            <Link href="/settings/calendar" className="ing__nav-link"><Sparkles /> Calendar</Link>
          </div>
        }
      />

      <div className="ing">
        <div className="ing__kpis">
          <KpiTile accent="var(--os-c-green)"  Icon={CheckCircle2} label="Installed"  value={`${stats.installed}`} sub="connected to your org" />
          <KpiTile accent="var(--os-c-indigo)" Icon={Globe}        label="Available"  value={`${stats.available}`} sub="not yet installed" />
          <KpiTile accent="var(--os-c-purple)" Icon={Sparkles}     label="Total"      value={`${stats.total}`}     sub="in marketplace" />
          <KpiTile accent="var(--os-c-orange)" Icon={Hash}         label="Categories" value={`${cats.length - 1}`} sub="organized" />
        </div>

        <div className="ing__toolbar">
          <div className="ing__search">
            <Search />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search integrations…" />
          </div>
        </div>

        <div className="ing__cats">
          {cats.map((c) => (
            <button
              key={c}
              type="button"
              className={`ing__cat${activeCategory === c ? " is-active" : ""}`}
              onClick={() => setActiveCategory(c)}
            >
              {CATEGORY_LABEL[c]}
              <span>{c === "all" ? stats.total : INTEGRATIONS.filter((i) => i.category === c).length}</span>
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <OsEmptyView Icon={Globe} iconGradient={GRAD.tealGreen} title="No integrations match" subtitle="Try a different search or category." />
        ) : (
          <div className="ing__grid">
            {filtered.map((i) => {
              const isInstalled = installed.has(i.id);
              return (
                <article key={i.id} className={`ing__card${isInstalled ? " is-installed" : ""}`} style={{ ["--c-c" as unknown as string]: i.hue }}>
                  <header className="ing__card-head">
                    <span className="ing__card-icon"><i.Icon /></span>
                    <div>
                      <h3>{i.name}</h3>
                      <span className="ing__card-cat">{CATEGORY_LABEL[i.category]}</span>
                    </div>
                    {isInstalled && <span className="ing__card-installed"><CheckCircle2 /> Installed</span>}
                  </header>
                  <p className="ing__card-tagline">{i.tagline}</p>
                  <footer className="ing__card-foot">
                    <button type="button" className={`ing__card-btn${isInstalled ? " ing__card-btn--disconnect" : " ing__card-btn--install"}`} onClick={() => toggle(i.id, isInstalled)}>
                      {isInstalled ? "Disconnect" : <><Plus /> Connect</>}
                    </button>
                  </footer>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof Globe; label: string; value: string; sub: string }) {
  return (
    <div className="ing__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="ing__kpi-accent" aria-hidden="true" />
      <div className="ing__kpi-row">
        <div className="ing__kpi-icon"><Icon /></div>
        <div className="ing__kpi-label">{label}</div>
      </div>
      <div className="ing__kpi-value">{value}</div>
      <div className="ing__kpi-sub">{sub}</div>
    </div>
  );
}

const _unused = ChevronRight;
