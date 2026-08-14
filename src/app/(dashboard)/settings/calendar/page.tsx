"use client";

/* Settings · Calendar — external calendar sync.
 *
 * HONEST STATE: this app has no calendar-OAuth backend. There is no engine
 * that stores connections or runs two-way sync, so we do NOT fabricate any.
 * External calendar feeds (Google, Outlook, iCloud, Fastmail, ICS) are on the
 * roadmap and shown as "Coming soon". (The Planner module's own Google hook is
 * a separate surface and unrelated to this page.)
 */

import Link from "next/link";
import {
  Calendar as CalendarIcon, Hash, Link2, Globe, Clock, ExternalLink,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { GRAD } from "@/components/layout/os/catalog";

type Provider = "google" | "outlook" | "icloud" | "fastmail" | "ics";

const PROVIDER_INFO: Record<Provider, { label: string; hue: string }> = {
  google:  { label: "Google Calendar", hue: "var(--os-c-red)" },
  outlook: { label: "Outlook / Microsoft 365", hue: "var(--os-c-blue)" },
  icloud:  { label: "iCloud", hue: "var(--os-ink-2)" },
  fastmail:{ label: "Fastmail", hue: "var(--os-c-orange)" },
  ics:     { label: "ICS feed", hue: "var(--os-c-teal)" },
};

export default function CalendarSettingsPage() {
  const providers = Object.keys(PROVIDER_INFO) as Provider[];

  return (
    <>
      <OsTitleBar
        title="Calendar integrations"
        Icon={CalendarIcon}
        iconGradient={GRAD.indigoBlue}
        description="External calendar sync is coming soon — no calendars are connected yet"
        actions={
          <div className="cli__head-actions">
            <Link href="/settings" className="cli__nav-link"><Hash /> Settings</Link>
            <Link href="/integrations" className="cli__nav-link"><Globe /> Integrations</Link>
          </div>
        }
      />

      <div className="cli">
        <section className="cli__section">
          <header><h2><Link2 /> Planned providers</h2></header>
          <div className="cli__providers">
            {providers.map((p) => {
              const info = PROVIDER_INFO[p];
              return (
                <article key={p} className="cli__provider" style={{ ["--p-c" as unknown as string]: info.hue }}>
                  <div className="cli__provider-head">
                    <span className="cli__provider-icon"><CalendarIcon /></span>
                    <h3>{info.label}</h3>
                  </div>
                  <span
                    className="cli__provider-status"
                    style={{ background: "var(--os-surface-2)", color: "var(--os-ink-3)" }}
                  >
                    <Clock /> Coming soon
                  </span>
                </article>
              );
            })}
          </div>
        </section>

        <div className="cli__empty">
          Two-way calendar sync isn&rsquo;t available yet. When it ships, connected
          calendars will appear here.
        </div>

        <div className="cli__hint">
          <ExternalLink />
          <span>WorkwrK will keep your calendar in sync without storing event bodies — subject lines and times only.</span>
        </div>
      </div>
    </>
  );
}
