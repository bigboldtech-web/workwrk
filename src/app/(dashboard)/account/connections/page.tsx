"use client";

/* My settings · Calendar and connections.
 *
 * THE PAGE THE SETTINGS REGISTRY HAS BEEN POINTING AT. `account/connections`
 * has been a registered settings page (src/lib/settings-registry.ts), an
 * access key (src/lib/access/settings.ts) and a passing test since before
 * Phase 4, with `todayHref: "/settings/calendar"` standing in for a route
 * that did not exist. This is that route. /settings/calendar is now a 308
 * to here, and the Google OAuth callback lands on
 * /account/connections?connected=google.
 *
 * Two cards, both of them things the backend already does and no UI ever
 * offered:
 *
 *   Google Calendar   CalendarSubscription rows, the OAuth pair at
 *                     /api/integrations/google-calendar/{connect,callback}
 *                     and the sync cron. Connect renders only when the
 *                     deployment actually has Google credentials
 *                     (`available` from the status route). With no
 *                     credentials the card says so plainly rather than
 *                     offering a button that answers 501 (audit P-6).
 *   Calendar feed     the personal ICS export at /api/calendar/ics/token,
 *                     fully implemented and, until now, called by nothing.
 *
 * Personal door: no admin gate, own rows only. Every write surfaces its
 * failure; nothing here fails silently.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Calendar, CalendarPlus, Check, Copy, Link2, RefreshCw, Rss, Trash2, TriangleAlert } from "lucide-react";
import { OsPageHeader } from "@/components/layout/os/page-header";
import { Dots } from "@/components/ui/dots";
import { Switch } from "@/components/ui/switch";
import { ComingSoonRow, UpcomingOnly } from "@/components/ui/coming-soon-row";
import { useOsToast } from "@/components/layout/os/toast";
import { apiFetch } from "@/lib/api-fetch";
import { useFormat } from "@/lib/format/use-date-prefs";
import { googleConnectSentence } from "@/lib/connect-errors";
import { SETTINGS_PAGES } from "@/lib/settings-registry";

type GoogleStatus = {
  available: boolean;
  connected: boolean;
  subscriptions: Array<{ id: string; externalCalendarId: string | null; shareTitles: boolean; enabled: boolean; lastSyncAt: string | null }>;
  connectedAt: string | null;
  lastSyncAt: string | null;
};

type FeedStatus = { token: string | null; url?: string; webcalUrl?: string; createdAt?: string };

type GoogleCalendar = { id: string; name: string; primary: boolean };
type SyncedCalendar = { externalCalendarId: string | null; direction: string; shareTitles: boolean; enabled: boolean };
type CalendarList = { connected: boolean; calendars: GoogleCalendar[]; synced: SyncedCalendar[] };

/** The connect flow's own outcome, read from the URL the callback set. */
function ResultLine({ connected, error }: { connected: string | null; error: string | null }) {
  if (connected === "google") {
    return (
      <p className="cxn__result cxn__result--ok">
        <Check aria-hidden /> Google Calendar is connected. Your events appear on the Calendar within the hour.
      </p>
    );
  }
  if (error) {
    return (
      <p className="cxn__result cxn__result--bad">
        <TriangleAlert aria-hidden /> Google Calendar did not connect: {googleConnectSentence(error)}. Try again, or ask an admin to check the workspace credentials.
      </p>
    );
  }
  return null;
}

export default function ConnectionsPage() {
  const sp = useSearchParams();
  const router = useRouter();
  const { toast } = useOsToast();
  const fmt = useFormat();

  // The parameters are read once into state and then STRIPPED from the URL,
  // so a reload, a bookmark or a Back does not re-announce a connection
  // that happened ten minutes ago.
  const [outcome] = useState(() => ({ connected: sp.get("connected"), error: sp.get("error") }));
  const stripped = useRef(false);
  useEffect(() => {
    if (stripped.current || (!outcome.connected && !outcome.error)) return;
    stripped.current = true;
    router.replace("/account/connections", { scroll: false });
  }, [outcome, router]);

  const [google, setGoogle] = useState<GoogleStatus | null>(null);
  const [feed, setFeed] = useState<FeedStatus | null>(null);
  const [calendars, setCalendars] = useState<CalendarList | null>(null);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"google" | "feed" | "calendars" | null>(null);

  const loadCalendars = useCallback(async () => {
    const r = await apiFetch<CalendarList>("/api/integrations/google-calendar/calendars");
    // Google's own API can fail on its own; that is a row inside the card
    // with Retry, not the whole page going dark.
    if (!r.ok) { setCalendarError(r.error); return; }
    setCalendarError(null);
    setCalendars(r.data);
  }, []);

  const load = useCallback(async () => {
    const [g, f] = await Promise.all([
      apiFetch<GoogleStatus>("/api/integrations/google-calendar"),
      apiFetch<FeedStatus>("/api/calendar/ics/token"),
    ]);
    // A failed read is never rendered as a healthy page: the cards stay
    // absent and the error line says what happened, with Retry.
    if (!g.ok) { setLoadError(g.error); return; }
    setGoogle(g.data);
    setFeed(f.ok ? f.data : { token: null });
    setLoadError(null);
    if (g.data.connected) await loadCalendars();
  }, [loadCalendars]);

  // Wrapped, so the effect body sets no state before its first await
  // (react-hooks/set-state-in-effect).
  useEffect(() => {
    const run = async () => { await load(); };
    void run();
  }, [load]);

  // "Last synced" is worth being right about, so it refetches when the tab
  // comes back rather than going stale behind whoever left it open.
  useEffect(() => {
    const onFocus = () => { void load(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  /**
   * Save the whole calendar set.
   *
   * The endpoint is SET SEMANTICS (a calendar absent from the body is
   * unsubscribed and its synced rows removed), so every change sends every
   * row. Sending only the changed one would silently unsubscribe the rest,
   * which is the kind of quiet data loss this refresh exists to stop.
   */
  const saveCalendars = useCallback(async (next: SyncedCalendar[]) => {
    setBusy("calendars");
    const r = await apiFetch("/api/integrations/google-calendar/subscribe", {
      method: "POST",
      json: {
        subscriptions: next
          .filter((s) => s.externalCalendarId)
          .map((s) => ({ externalCalendarId: s.externalCalendarId, direction: s.direction, shareTitles: s.shareTitles })),
      },
      keepalive: true,
    });
    setBusy(null);
    if (!r.ok) { toast(`Couldn't save that: ${r.error}`, { tone: "danger" }); return; }
    setCalendars((prev) => (prev ? { ...prev, synced: next } : prev));
    toast("Saved");
  }, [toast]);

  const toggleCalendar = useCallback((cal: GoogleCalendar, on: boolean) => {
    const current = calendars?.synced ?? [];
    const next = on
      ? [...current.filter((s) => s.externalCalendarId !== cal.id),
         { externalCalendarId: cal.id, direction: "IN", shareTitles: false, enabled: true }]
      : current.filter((s) => s.externalCalendarId !== cal.id);
    void saveCalendars(next);
  }, [calendars, saveCalendars]);

  const toggleShareTitles = useCallback((cal: GoogleCalendar, on: boolean) => {
    const current = calendars?.synced ?? [];
    void saveCalendars(current.map((s) => (s.externalCalendarId === cal.id ? { ...s, shareTitles: on } : s)));
  }, [calendars, saveCalendars]);

  async function disconnectGoogle() {
    setBusy("google");
    const r = await apiFetch("/api/integrations/google-calendar", { method: "DELETE" });
    setBusy(null);
    if (!r.ok) { toast(`Couldn't disconnect: ${r.error}`, { tone: "danger" }); return; }
    toast("Google Calendar disconnected");
    void load();
  }

  async function mintFeed(rotate: boolean) {
    setBusy("feed");
    const r = await apiFetch<FeedStatus>("/api/calendar/ics/token", { method: "POST" });
    setBusy(null);
    if (!r.ok) { toast(`Couldn't create the feed: ${r.error}`, { tone: "danger" }); return; }
    setFeed(r.data);
    toast(rotate ? "Feed link replaced. The old link stopped working." : "Feed link created");
  }

  async function revokeFeed() {
    setBusy("feed");
    const r = await apiFetch("/api/calendar/ics/token", { method: "DELETE" });
    setBusy(null);
    if (!r.ok) { toast(`Couldn't turn the feed off: ${r.error}`, { tone: "danger" }); return; }
    setFeed({ token: null });
    toast("Feed turned off");
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast("Link copied");
    } catch {
      toast("Couldn't copy. Select the link and copy it by hand.", { tone: "danger" });
    }
  }

  return (
    <>
      {/* The registry's label, so the breadcrumb, the settings list row, the
          settings search hit and the page title are one string rather than
          four that drift (naming canon: "Calendar & connections"). */}
      <OsPageHeader title={SETTINGS_PAGES["account/connections"].label} />

      <div className="cxn">
        <ResultLine connected={outcome.connected} error={outcome.error} />

        {loadError ? (
          <div className="cxn__error">
            <TriangleAlert aria-hidden />
            <span>Couldn&rsquo;t load your connections. {loadError}</span>
            <button type="button" className="cxn__link-btn" onClick={() => { void load(); }}>Retry</button>
          </div>
        ) : !google ? (
          <div className="cxn__loading"><Dots variant="pending" /> <span>Reading your connections</span></div>
        ) : (
          <>
            {/* ── Google Calendar ─────────────────────────────── */}
            <section className="cxn__card">
              <header className="cxn__card-head">
                <span className="cxn__card-icon"><Calendar aria-hidden /></span>
                <div>
                  <h2>Google Calendar</h2>
                  <p>See your Google events beside your work on the Calendar.</p>
                </div>
              </header>

              {!google.available ? (
                // Honest state: no credentials on this deployment, so there
                // is nothing to click. No "Coming soon" row either.
                <p className="cxn__note">
                  Google Calendar is not set up on this workspace. An admin adds the Google credentials before anyone can connect.
                </p>
              ) : google.connected ? (
                <>
                  <p className="cxn__note">
                    {/* The viewer's own date format and zone, not a raw ISO
                        slice, which is what this said before. */}
                    Connected{google.connectedAt ? ` on ${fmt.date(google.connectedAt, "date")}` : ""}.
                    {google.lastSyncAt ? ` Last checked ${fmt.relative(google.lastSyncAt)}.` : " Waiting for the first sync."}
                  </p>

                  {/* Which calendars come in, and whose titles a manager may
                      read. Both are real CalendarSubscription columns
                      (`direction`, `shareTitles`) that the sync honours and
                      that no UI has ever offered a control for. */}
                  {calendarError ? (
                    <p className="cxn__note">
                      Couldn&rsquo;t load your calendars. {calendarError}{" "}
                      <button type="button" className="cxn__link-btn" onClick={() => { void loadCalendars(); }}>Retry</button>
                    </p>
                  ) : !calendars ? (
                    <p className="cxn__note"><Dots variant="pending" /> Reading your calendars</p>
                  ) : calendars.calendars.length === 0 ? (
                    <p className="cxn__note">Google reports no calendars on this account.</p>
                  ) : (
                    <ul className="cxn__cals">
                      {calendars.calendars.map((cal) => {
                        const sub = calendars.synced.find((s) => s.externalCalendarId === cal.id);
                        const on = Boolean(sub);
                        return (
                          <li key={cal.id}>
                            <span className="cxn__cal-name">
                              {cal.name}
                              {cal.primary ? <em>Primary</em> : null}
                            </span>
                            <label className="cxn__cal-switch">
                              <span id={`cal-in-${cal.id}`}>Show in my calendar</span>
                              <Switch
                                checked={on}
                                onChange={(next) => toggleCalendar(cal, next)}
                                disabled={busy === "calendars"}
                                aria-labelledby={`cal-in-${cal.id}`}
                              />
                            </label>
                            {on ? (
                              <label className="cxn__cal-switch">
                                <span id={`cal-titles-${cal.id}`}>
                                  Titles visible to my manager
                                  <em>Off shows &ldquo;Busy&rdquo; on your team calendar</em>
                                </span>
                                <Switch
                                  checked={Boolean(sub?.shareTitles)}
                                  onChange={(next) => toggleShareTitles(cal, next)}
                                  disabled={busy === "calendars"}
                                  aria-labelledby={`cal-titles-${cal.id}`}
                                />
                              </label>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  <div className="cxn__actions">
                    <button
                      type="button"
                      className="cxn__btn cxn__btn--danger"
                      onClick={() => { void disconnectGoogle(); }}
                      disabled={busy === "google"}
                    >
                      {busy === "google" ? <Dots variant="pending" /> : <Trash2 aria-hidden />} Disconnect
                    </button>
                  </div>
                </>
              ) : (
                <div className="cxn__actions">
                  {/* A real full-page navigation, deliberately. The href is a
                      ROUTE HANDLER that sets the OAuth state cookie and
                      answers a redirect to accounts.google.com: it is not a
                      page, so next/link's client navigation has nothing to
                      render and would swallow the redirect. The lint rule
                      cannot tell an /api route handler from a page, which is
                      what this disable is for. */}
                  {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                  <a className="cxn__btn cxn__btn--primary" href="/api/integrations/google-calendar/connect">
                    <Link2 aria-hidden /> Connect Google Calendar
                  </a>
                </div>
              )}
            </section>

            {/* ── Personal calendar feed ──────────────────────── */}
            <section className="cxn__card">
              <header className="cxn__card-head">
                <span className="cxn__card-icon"><Rss aria-hidden /></span>
                <div>
                  <h2>Your calendar feed</h2>
                  <p>Subscribe to your WorkwrK schedule from Apple Calendar, Outlook or Google.</p>
                </div>
              </header>

              {feed?.token && feed.url ? (
                <>
                  <p className="cxn__note">
                    Anyone with this link can read your schedule. Replace it if you shared it by mistake.
                  </p>
                  <div className="cxn__feed">
                    <code>{feed.url}</code>
                    <button type="button" className="cxn__icon-btn" onClick={() => { void copy(feed.url as string); }} title="Copy link">
                      <Copy aria-hidden />
                    </button>
                  </div>
                  <div className="cxn__actions">
                    {feed.webcalUrl ? (
                      <a className="cxn__btn" href={feed.webcalUrl}>
                        <Calendar aria-hidden /> Subscribe
                      </a>
                    ) : null}
                    <button type="button" className="cxn__btn" onClick={() => { void mintFeed(true); }} disabled={busy === "feed"}>
                      {busy === "feed" ? <Dots variant="pending" /> : <RefreshCw aria-hidden />} Replace link
                    </button>
                    <button type="button" className="cxn__btn cxn__btn--danger" onClick={() => { void revokeFeed(); }} disabled={busy === "feed"}>
                      <Trash2 aria-hidden /> Turn off
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="cxn__note">No feed link yet.</p>
                  <div className="cxn__actions">
                    {/* Secondary, not primary. ONE blue button per page
                        (design-system 4.4), and on this page it is Connect
                        Google Calendar; with both rendered as primaries a
                        newly arrived person had two equal-weight next
                        steps and no idea which one they came for. */}
                    <button type="button" className="cxn__btn" onClick={() => { void mintFeed(false); }} disabled={busy === "feed"}>
                      {busy === "feed" ? <Dots variant="pending" /> : <Rss aria-hidden />} Create a feed link
                    </button>
                  </div>
                </>
              )}
            </section>

            {/* The three calendars this product does NOT sync, listed only
                for somebody who turned "Show upcoming features" on. The
                Planner's old connect banner carried one of these rows
                (Microsoft Outlook) in exactly this shape, so retiring the
                banner does not take it away. No control, no handler, no
                disabled button: a ComingSoonRow is a line, and with the
                preference off it is not rendered at all. */}
            <UpcomingOnly>
              <section className="cxn__card">
                <header className="cxn__card-head">
                  <span className="cxn__card-icon"><CalendarPlus aria-hidden /></span>
                  <div>
                    <h2>More calendars</h2>
                    <p>Not built yet. Google is the one this workspace can sync today.</p>
                  </div>
                </header>
                <div className="cxn__upcoming">
                  <ComingSoonRow label="Microsoft Outlook" />
                  <ComingSoonRow label="Apple iCloud" />
                  <ComingSoonRow label="Fastmail" />
                </div>
              </section>
            </UpcomingOnly>

            <p className="cxn__foot">
              Looking for workspace integrations instead? <Link href="/integrations">Integrations</Link>
            </p>
          </>
        )}
      </div>
    </>
  );
}
