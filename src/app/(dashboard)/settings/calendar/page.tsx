"use client";

/* Settings · Calendar — connect Google, Outlook, iCloud, etc. for two-way sync. */

import { useState } from "react";
import Link from "next/link";
import {
  Calendar as CalendarIcon, Hash, CheckCircle2, Link2, Unlink, ChevronRight,
  Plus, Globe, Mail, ExternalLink,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { GRAD } from "@/components/layout/os/catalog";
import { useOsToast } from "@/components/layout/os/toast";

type Provider = "google" | "outlook" | "icloud" | "fastmail" | "ics";

type Connection = {
  id: string;
  provider: Provider;
  email: string;
  connectedAt: string;
  syncDirection: "two-way" | "read" | "write";
  lastSyncedAt?: string | null;
  calendars: { name: string; selected: boolean }[];
};

const PROVIDER_INFO: Record<Provider, { label: string; hue: string }> = {
  google:  { label: "Google Calendar", hue: "var(--os-c-red)" },
  outlook: { label: "Outlook / Microsoft 365", hue: "var(--os-c-blue)" },
  icloud:  { label: "iCloud", hue: "var(--os-ink-2)" },
  fastmail:{ label: "Fastmail", hue: "var(--os-c-orange)" },
  ics:     { label: "ICS feed", hue: "var(--os-c-purple)" },
};

const SAMPLE: Connection[] = [
  {
    id: "c1", provider: "google", email: "bigbold@gmail.com",
    connectedAt: "2026-03-14T10:00:00Z", syncDirection: "two-way",
    lastSyncedAt: new Date(Date.now() - 8 * 60_000).toISOString(),
    calendars: [{ name: "Personal", selected: true }, { name: "Work", selected: true }, { name: "Holidays", selected: false }],
  },
  {
    id: "c2", provider: "outlook", email: "bb@workwrk.com",
    connectedAt: "2026-04-22T12:00:00Z", syncDirection: "two-way",
    lastSyncedAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
    calendars: [{ name: "WorkwrK", selected: true }],
  },
];

function relativeDate(iso?: string | null) {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 60 * 60_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 24 * 60 * 60_000) return `${Math.floor(ms / (60 * 60_000))}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

export default function CalendarSettingsPage() {
  const [conns, setConns] = useState<Connection[]>(SAMPLE);
  const [busy, setBusy] = useState<Provider | null>(null);
  const { toast } = useOsToast();

  async function connect(p: Provider) {
    setBusy(p);
    setTimeout(() => {
      setBusy(null);
      toast(`Demo: ${PROVIDER_INFO[p].label} OAuth flow would open here`);
    }, 500);
  }

  function disconnect(id: string) {
    if (!window.confirm("Disconnect this calendar? Existing events stay; new events stop syncing.")) return;
    setConns((c) => c.filter((x) => x.id !== id));
    toast("Disconnected");
  }

  return (
    <>
      <OsTitleBar
        title="Calendar integrations"
        Icon={CalendarIcon}
        iconGradient={GRAD.indigoBlue}
        description={`${conns.length} connected · two-way sync · all events normalize to the org timezone`}
        actions={
          <div className="cli__head-actions">
            <Link href="/settings" className="cli__nav-link"><Hash /> Settings</Link>
            <Link href="/integrations" className="cli__nav-link"><Globe /> Integrations</Link>
          </div>
        }
      />

      <div className="cli">
        <section className="cli__section">
          <header><h2><Link2 /> Available providers</h2></header>
          <div className="cli__providers">
            {(Object.keys(PROVIDER_INFO) as Provider[]).map((p) => {
              const info = PROVIDER_INFO[p];
              const isConnected = conns.some((c) => c.provider === p);
              return (
                <article key={p} className="cli__provider" style={{ ["--p-c" as unknown as string]: info.hue }}>
                  <div className="cli__provider-head">
                    <span className="cli__provider-icon"><CalendarIcon /></span>
                    <h3>{info.label}</h3>
                  </div>
                  {isConnected ? (
                    <span className="cli__provider-status cli__provider-status--connected"><CheckCircle2 /> Connected</span>
                  ) : (
                    <button type="button" className="cli__provider-btn" onClick={() => connect(p)} disabled={busy === p}>
                      <Plus /> {busy === p ? "Connecting…" : "Connect"}
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        </section>

        <section className="cli__section">
          <header><h2><Mail /> Active connections</h2></header>
          {conns.length === 0 ? (
            <div className="cli__empty">No calendars connected.</div>
          ) : (
            <div className="cli__conns">
              {conns.map((c) => {
                const info = PROVIDER_INFO[c.provider];
                return (
                  <article key={c.id} className="cli__conn" style={{ ["--c-c" as unknown as string]: info.hue }}>
                    <header className="cli__conn-head">
                      <span className="cli__conn-icon"><CalendarIcon /></span>
                      <div className="cli__conn-id">
                        <h3>{info.label}</h3>
                        <span>{c.email}</span>
                      </div>
                      <span className="cli__conn-sync">{c.syncDirection === "two-way" ? "Two-way" : c.syncDirection === "read" ? "Read-only" : "Write-only"}</span>
                    </header>
                    <div className="cli__conn-cals">
                      <span className="cli__conn-cals-label">Calendars synced</span>
                      {c.calendars.map((cal) => (
                        <span key={cal.name} className={`cli__conn-cal${cal.selected ? " is-on" : ""}`}>
                          {cal.selected && <CheckCircle2 />} {cal.name}
                        </span>
                      ))}
                    </div>
                    <footer className="cli__conn-foot">
                      <span>Connected {new Date(c.connectedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                      <span>Last sync {relativeDate(c.lastSyncedAt)}</span>
                      <button type="button" className="cli__conn-disconnect" onClick={() => disconnect(c.id)}>
                        <Unlink /> Disconnect
                      </button>
                    </footer>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <div className="cli__hint">
          <ExternalLink />
          <span>WorkwrK keeps your calendar in sync without storing event bodies. Subject lines and times only.</span>
        </div>
      </div>
    </>
  );
}

const _unused = ChevronRight;
