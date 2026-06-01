"use client";

/* Settings · API keys — manage org-wide API keys. */

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Key, Plus, Copy, Trash2, Hash, ChevronRight, Activity, Clock, ShieldCheck,
  AlertTriangle, Search,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { GRAD } from "@/components/layout/os/catalog";
import { useOsToast } from "@/components/layout/os/toast";

type Scope = "read" | "write" | "admin";
type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  scopes: Scope[];
  createdAt: string;
  lastUsedAt?: string | null;
  expiresAt?: string | null;
  createdBy: string;
};

const SAMPLE_KEYS: ApiKey[] = [
  { id: "k1", name: "Zapier integration", prefix: "wk_live_a3b9", scopes: ["read", "write"], createdAt: "2026-04-12T10:00:00Z", lastUsedAt: "2026-05-30T14:30:00Z", createdBy: "BB" },
  { id: "k2", name: "Data warehouse sync", prefix: "wk_live_7f21", scopes: ["read"], createdAt: "2026-02-20T09:15:00Z", lastUsedAt: "2026-05-31T03:00:00Z", createdBy: "MK" },
  { id: "k3", name: "CI test runner", prefix: "wk_live_e8c4", scopes: ["read", "write", "admin"], createdAt: "2025-11-08T16:00:00Z", lastUsedAt: "2026-05-29T22:14:00Z", expiresAt: "2026-12-31T00:00:00Z", createdBy: "BB" },
  { id: "k4", name: "Legacy webhook (revoke)", prefix: "wk_live_d3a1", scopes: ["read"], createdAt: "2025-06-01T00:00:00Z", lastUsedAt: null, createdBy: "BB" },
];

function relativeDate(iso?: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const day = 86_400_000;
  if (ms < 60_000) return "just now";
  if (ms < 60 * 60_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 24 * 60 * 60_000) return `${Math.floor(ms / (60 * 60_000))}h ago`;
  if (ms < 7 * day) return `${Math.floor(ms / day)}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>(SAMPLE_KEYS);
  const [search, setSearch] = useState("");
  const { toast } = useOsToast();

  const stats = useMemo(() => {
    const active = keys.filter((k) => k.lastUsedAt && Date.now() - new Date(k.lastUsedAt).getTime() < 7 * 86_400_000).length;
    const stale = keys.filter((k) => !k.lastUsedAt || Date.now() - new Date(k.lastUsedAt!).getTime() > 30 * 86_400_000).length;
    const expiring = keys.filter((k) => k.expiresAt && new Date(k.expiresAt).getTime() - Date.now() < 30 * 86_400_000 && new Date(k.expiresAt).getTime() > Date.now()).length;
    return { total: keys.length, active, stale, expiring };
  }, [keys]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return keys;
    return keys.filter((k) => k.name.toLowerCase().includes(q) || k.prefix.toLowerCase().includes(q));
  }, [keys, search]);

  function generate() {
    const name = window.prompt("Name this key — what's it for?")?.trim();
    if (!name) return;
    const prefix = "wk_live_" + Math.random().toString(36).slice(2, 6);
    const full = prefix + Math.random().toString(36).slice(2, 24);
    setKeys((k) => [{ id: Math.random().toString(36).slice(2, 8), name, prefix, scopes: ["read"], createdAt: new Date().toISOString(), createdBy: "BB" }, ...k]);
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(full);
      toast("Key created & copied to clipboard — save it now");
    } else {
      toast("Key created — copy it from your clipboard");
    }
  }

  function revoke(id: string) {
    if (!window.confirm("Revoke this key? Any service using it will stop working.")) return;
    setKeys((k) => k.filter((x) => x.id !== id));
    toast("Key revoked");
  }

  function copyPrefix(prefix: string) {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(prefix);
      toast("Prefix copied");
    }
  }

  return (
    <>
      <OsTitleBar
        title="API keys"
        Icon={Key}
        iconGradient={GRAD.purpleIndigo}
        description={`${stats.total} key${stats.total === 1 ? "" : "s"} · ${stats.active} active · ${stats.stale} stale${stats.expiring > 0 ? ` · ${stats.expiring} expiring` : ""}`}
        actions={
          <div className="apk__head-actions">
            <Link href="/settings" className="apk__nav-link"><Hash /> Settings</Link>
            <Link href="/settings/audit" className="apk__nav-link"><Activity /> Audit</Link>
            <button type="button" className="apk__btn-primary" onClick={generate}>
              <Plus /> Generate key
            </button>
          </div>
        }
      />

      <div className="apk">
        <div className="apk__kpis">
          <KpiTile accent="var(--os-c-purple)" Icon={Key}        label="Total"     value={`${stats.total}`}    sub="all keys" />
          <KpiTile accent="var(--os-c-green)"  Icon={Activity}   label="Active"    value={`${stats.active}`}   sub="used in 7d" />
          <KpiTile accent="var(--os-c-orange)" Icon={Clock}      label="Stale"     value={`${stats.stale}`}    sub="> 30d unused" />
          <KpiTile accent={stats.expiring > 0 ? "var(--os-c-red)" : "var(--os-c-blue)"} Icon={stats.expiring > 0 ? AlertTriangle : ShieldCheck} label="Expiring" value={`${stats.expiring}`} sub={stats.expiring > 0 ? "next 30d" : "none soon"} />
        </div>

        <div className="apk__warn">
          <ShieldCheck />
          <span><strong>Keys are shown once at creation.</strong> Store them in a vault — there is no way to recover a lost key.</span>
        </div>

        <div className="apk__toolbar">
          <div className="apk__search">
            <Search />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search keys…" />
          </div>
        </div>

        {keys.length === 0 ? (
          <OsEmptyView Icon={Key} iconGradient={GRAD.purpleIndigo} title="No API keys yet" subtitle="Generate a key to access the WorkwrK API from scripts, webhooks, or integrations." chips={["read", "write", "admin"]} cta="Generate key" />
        ) : filtered.length === 0 ? (
          <div className="apk__no-match"><Search /> No keys match.</div>
        ) : (
          <div className="apk__table">
            <div className="apk__row apk__row--head">
              <span>Name</span>
              <span>Key prefix</span>
              <span>Scopes</span>
              <span>Last used</span>
              <span>Created</span>
              <span></span>
            </div>
            {filtered.map((k) => {
              const stale = !k.lastUsedAt || Date.now() - new Date(k.lastUsedAt!).getTime() > 30 * 86_400_000;
              return (
                <div key={k.id} className={`apk__row${stale ? " is-stale" : ""}`}>
                  <div className="apk__row-name">{k.name}</div>
                  <button type="button" className="apk__row-prefix" onClick={() => copyPrefix(k.prefix)} title="Copy prefix">
                    <code>{k.prefix}…</code>
                    <Copy />
                  </button>
                  <div className="apk__row-scopes">
                    {k.scopes.map((s) => (
                      <span key={s} className={`apk__scope apk__scope--${s}`}>{s}</span>
                    ))}
                  </div>
                  <span className="apk__row-last">{relativeDate(k.lastUsedAt)}</span>
                  <span className="apk__row-created">{new Date(k.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                  <button type="button" className="apk__row-revoke" onClick={() => revoke(k.id)} title="Revoke key">
                    <Trash2 />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof Key; label: string; value: string; sub: string }) {
  return (
    <div className="apk__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="apk__kpi-accent" aria-hidden="true" />
      <div className="apk__kpi-row">
        <div className="apk__kpi-icon"><Icon /></div>
        <div className="apk__kpi-label">{label}</div>
      </div>
      <div className="apk__kpi-value">{value}</div>
      <div className="apk__kpi-sub">{sub}</div>
    </div>
  );
}

const _unused = ChevronRight;
