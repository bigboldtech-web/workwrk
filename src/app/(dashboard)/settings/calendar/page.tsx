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
import { OsPageHeader } from "@/components/layout/os/page-header";
import { ComingSoonRow, useShowUpcoming } from "@/components/ui/coming-soon-row";
import { SETTINGS_PAGES } from "@/lib/settings-registry";

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
  // The planned providers render only for a viewer who opted into upcoming
  // features (spec-shell 1.15); otherwise the page says plainly that sync
  // is not available yet.
  const showUpcoming = useShowUpcoming();

  return (
    <>
      <OsPageHeader
        title={SETTINGS_PAGES["account/connections"].label}
        actions={
          <div className="cli__head-actions">
            <Link href="/settings" className="os-head__link"><Hash /> Settings</Link>
            <Link href="/integrations" className="os-head__link"><Globe /> Integrations</Link>
          </div>
        }
      />

      <div className="cli">
        {showUpcoming ? (
          <section className="cli__section">
            <header><h2><Link2 /> Planned providers</h2></header>
            <div>
              {providers.map((p) => (
                <ComingSoonRow key={p} label={PROVIDER_INFO[p].label} icon={CalendarIcon} />
              ))}
            </div>
          </section>
        ) : null}

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
