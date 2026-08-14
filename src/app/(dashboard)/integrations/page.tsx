"use client";

/* Integrations marketplace — third-party connectors browseable by category.
 *
 * HONEST STATE: WorkwrK ships no third-party connector engine yet (the
 * integrations roadmap is demand-driven — in-house product first). Nothing is
 * installed or connectable, so we do NOT fabricate "installed" flags or a
 * connect action. The catalog is a browsable preview; every connector reads
 * "Coming soon".
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Globe, Search, Hash, CheckCircle2, Clock, Sparkles,
  MessageCircle, Mail, Code, Hash as HashIcon, Cloud, Banknote, BarChart, Briefcase,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD } from "@/components/layout/os/catalog";

type Category = "messaging" | "code" | "storage" | "finance" | "analytics" | "sso";

type Integration = {
  id: string;
  name: string;
  category: Category;
  tagline: string;
  hue: string;
  Icon: typeof Globe;
};

const INTEGRATIONS: Integration[] = [
  { id: "slack", name: "Slack", category: "messaging", tagline: "Channel notifications, slash commands, /standup", hue: C.blue, Icon: HashIcon },
  { id: "teams", name: "Microsoft Teams", category: "messaging", tagline: "Workflow alerts in channels and chats", hue: C.blue, Icon: MessageCircle },
  { id: "gmail", name: "Gmail", category: "messaging", tagline: "Send + receive shared inbox messages", hue: C.red, Icon: Mail },
  { id: "github", name: "GitHub", category: "code", tagline: "Link tasks to PRs, auto-close on merge", hue: C.gray, Icon: Code },
  { id: "gitlab", name: "GitLab", category: "code", tagline: "Mirror issues + MRs into Tasks", hue: C.orange, Icon: Code },
  { id: "jira", name: "Jira", category: "code", tagline: "Two-way ticket sync with WorkwrK Tasks", hue: C.blue, Icon: Briefcase },
  { id: "linear", name: "Linear", category: "code", tagline: "Bidirectional issue mirror", hue: C.blue, Icon: Briefcase },
  { id: "drive", name: "Google Drive", category: "storage", tagline: "Attach docs from Drive in any module", hue: C.green, Icon: Cloud },
  { id: "onedrive", name: "OneDrive", category: "storage", tagline: "Pin files from OneDrive", hue: C.blue, Icon: Cloud },
  { id: "stripe", name: "Stripe", category: "finance", tagline: "Sync payments into the GL ledger", hue: C.blue, Icon: Banknote },
  { id: "qb", name: "QuickBooks", category: "finance", tagline: "Mirror invoices, expenses, and journal entries", hue: C.green, Icon: Banknote },
  { id: "looker", name: "Looker", category: "analytics", tagline: "Embed dashboards in any board", hue: C.blue, Icon: BarChart },
  { id: "metabase", name: "Metabase", category: "analytics", tagline: "Pin saved questions to a tile", hue: C.orange, Icon: BarChart },
  { id: "okta", name: "Okta SSO", category: "sso", tagline: "SAML SSO + SCIM provisioning", hue: C.blue, Icon: CheckCircle2 },
  { id: "azuread", name: "Microsoft Entra ID", category: "sso", tagline: "SAML SSO + group sync", hue: C.blue, Icon: CheckCircle2 },
];

const CATEGORY_LABEL: Record<Category | "all", string> = {
  all: "All",
  messaging: "Messaging",
  code: "Code & projects",
  storage: "Storage",
  finance: "Finance",
  analytics: "Analytics",
  sso: "SSO & identity",
};

export default function IntegrationsPage() {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<Category | "all">("all");

  const cats: (Category | "all")[] = ["all", "messaging", "code", "storage", "finance", "analytics", "sso"];

  const stats = useMemo(() => ({
    total: INTEGRATIONS.length,
    categories: cats.length - 1,
  }), [cats.length]);

  const filtered = useMemo(() => {
    let list = INTEGRATIONS;
    if (activeCategory !== "all") list = list.filter((i) => i.category === activeCategory);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((i) => i.name.toLowerCase().includes(q) || i.tagline.toLowerCase().includes(q));
    return list;
  }, [search, activeCategory]);

  return (
    <>
      <OsTitleBar
        title="Integrations"
        Icon={Globe}
        iconGradient={GRAD.tealGreen}
        description={`${stats.total} connectors on the roadmap · none available yet · demand-driven`}
        actions={
          <div className="ing__head-actions">
            <Link href="/settings" className="ing__nav-link"><Hash /> Settings</Link>
            <Link href="/settings/calendar" className="ing__nav-link"><Sparkles /> Calendar</Link>
          </div>
        }
      />

      <div className="ing">
        <div className="ing__kpis">
          <KpiTile accent="var(--os-c-blue)"   Icon={Globe}    label="Catalog"    value={`${stats.total}`}      sub="connectors planned" />
          <KpiTile accent="var(--os-c-orange)" Icon={Hash}     label="Categories" value={`${stats.categories}`} sub="organized" />
          <KpiTile accent="var(--os-ink-3)"    Icon={Clock}    label="Status"     value="Preview"               sub="none live yet" />
        </div>

        <div
          className="ing__toolbar"
          style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "10px 12px", borderRadius: 10,
            background: "var(--os-surface-1)", color: "var(--os-ink-2)",
            fontSize: 12.5, lineHeight: 1.5,
          }}
        >
          <Clock style={{ width: 14, height: 14, color: "var(--os-c-blue)", flexShrink: 0 }} />
          <span>
            Third-party connectors aren&rsquo;t available yet — we build the in-house
            product first and add integrations by demand. Browse what&rsquo;s planned below.
          </span>
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
            {filtered.map((i) => (
              <article key={i.id} className="ing__card" style={{ ["--c-c" as unknown as string]: i.hue }}>
                <header className="ing__card-head">
                  <span className="ing__card-icon"><i.Icon /></span>
                  <div>
                    <h3>{i.name}</h3>
                    <span className="ing__card-cat">{CATEGORY_LABEL[i.category]}</span>
                  </div>
                </header>
                <p className="ing__card-tagline">{i.tagline}</p>
                <footer className="ing__card-foot">
                  <span
                    className="ing__card-btn"
                    style={{ marginLeft: "auto", background: "var(--os-surface-1)", color: "var(--os-ink-3)", cursor: "default" }}
                  >
                    <Clock /> Coming soon
                  </span>
                </footer>
              </article>
            ))}
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
