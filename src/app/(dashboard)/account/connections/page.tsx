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
 * offered (and, since AI teammates Phase 3, a third: Google for your AI
 * teammates, components/account/teammate-google-card.tsx, its own OAuth
 * client and its own ?ai= outcome; and, since the MCP server, a fourth: the
 * AI apps the person connected, components/account/connected-apps-card.tsx,
 * anchored #ai-apps and drawn only where this WorkwrK offers the MCP server,
 * docs/plans/mcp-server.md 6.2):
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
 *
 * DRAWN FROM THE SHARED PARTS (settings-cleanup Phase 3, B4, B5, B10, B12):
 * every card is a SettingsCard in one 24px stack, rows are SettingsRows,
 * and nothing floats between cards. The Google Calendar card is drawn at
 * once and holds its own outcome line, loading and error; the pointer to the
 * workspace's integrations is that card's action. The feed's "Anyone with
 * this link" sentence is a consequence, so it stays in sight under the link.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Calendar, Copy, Link2, RefreshCw, Trash2 } from "lucide-react";
import { SettingsPage } from "@/components/settings/settings-page";
import { SettingsCard, SettingsCardStack } from "@/components/settings/settings-card";
import { SettingsRow } from "@/components/settings/settings-row";
import { btn, OutcomeLine, TAG, TextInput } from "@/components/account/account-ui";
import { Dots } from "@/components/ui/dots";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ComingSoonRow, UpcomingOnly } from "@/components/ui/coming-soon-row";
import { useOsToast } from "@/components/layout/os/toast";
import { useViewerRole } from "@/components/layout/os/boot-context";
import { apiFetch } from "@/lib/api-fetch";
import { useFormat } from "@/lib/format/use-date-prefs";
import { googleConnectSentence } from "@/lib/connect-errors";
import { cn } from "@/lib/utils";
import { TeammateGoogleCard, type TeammateConnectOutcome } from "@/components/account/teammate-google-card";
import { ConnectedAppsCard } from "@/components/account/connected-apps-card";

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

/** The connect flow's own outcome, read from the URL the callback set: the first line of the Google Calendar card. */
function ResultLine({ connected, error }: { connected: string | null; error: string | null }) {
  if (connected === "google") {
    return <OutcomeLine tone="ok" role="status">Google Calendar is connected. Your events appear on the Calendar within the hour.</OutcomeLine>;
  }
  if (error) {
    return (
      <OutcomeLine tone="bad" role="alert">
        Google Calendar did not connect: {googleConnectSentence(error)}. Try again, or ask an admin to check the workspace credentials.
      </OutcomeLine>
    );
  }
  return null;
}

export default function ConnectionsPage() {
  const sp = useSearchParams();
  const router = useRouter();
  const { toast } = useOsToast();
  const fmt = useFormat();
  // Integrations answers a Guest with its 404, so a Guest is not pointed there.
  const { isGuest } = useViewerRole();

  // The parameters are read once into state and then STRIPPED from the URL,
  // so a reload, a bookmark or a Back does not re-announce a connection
  // that happened ten minutes ago.
  const [outcome] = useState(() => ({ connected: sp.get("connected"), error: sp.get("error") }));
  // The AI teammates' Google connect lands here too, with its own (ai,
  // ai_partial, ai_error, and ai_allows since review round 3 of Phase 3;
  // docs/plans/ai-teammates-phase3.md step 2), read and stripped the same way.
  const [aiOutcome] = useState<TeammateConnectOutcome>(() => ({ ai: sp.get("ai"), partial: sp.getAll("ai_partial"), error: sp.get("ai_error"), allowsCleared: sp.get("ai_allows") === "cleared" }));
  const stripped = useRef(false);
  useEffect(() => {
    const any = outcome.connected || outcome.error || aiOutcome.ai || aiOutcome.error || aiOutcome.partial.length > 0;
    if (stripped.current || !any) return;
    stripped.current = true;
    // The anchor stays (#ai-google), so the card the callback named is the one in view.
    router.replace(`/account/connections${typeof window !== "undefined" ? window.location.hash : ""}`, { scroll: false });
  }, [outcome, aiOutcome, router]);

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

  // The same SettingsPage frame as every other My settings page (title and
  // subtitle from the registry, the door's left edge).
  return (
    <SettingsPage pageKey="account/connections">
      <SettingsCardStack>
        {/* ── Google Calendar ─────────────────────────────── */}
        <SettingsCard
          id="connections.google"
          title="Google Calendar"
          description="See your Google events beside your work on the Calendar."
          actions={isGuest ? null : <Link href="/integrations" className={btn.link}>Workspace integrations</Link>}
        >
          <ResultLine connected={outcome.connected} error={outcome.error} />

          {loadError ? (
            // A failed read is never rendered as a healthy page: the feed card
            // stays absent and this line says what happened, with Retry.
            <OutcomeLine tone="bad" role="alert">
              Couldn&rsquo;t load your connections. {loadError}{" "}
              <button type="button" className={btn.link} onClick={() => { void load(); }}>Retry</button>
            </OutcomeLine>
          ) : !google ? (
            <SkeletonRows rows={1} />
          ) : !google.available ? (
            // Honest state: no credentials on this deployment, so there
            // is nothing to click. No "Coming soon" row either.
            <p className="m-0 text-base text-ink-2">
              Google Calendar is not set up on this workspace. An admin adds the Google credentials before anyone can connect.
            </p>
          ) : google.connected ? (
            <>
              <div>
                {/* The viewer's own date format and zone, not a raw ISO
                    slice, which is what this said before. */}
                <SettingsRow
                  label={`Connected${google.connectedAt ? ` on ${fmt.date(google.connectedAt, "date")}` : ""}`}
                  helper={google.lastSyncAt ? `Last checked ${fmt.relative(google.lastSyncAt)}.` : "Waiting for the first sync."}
                  control={
                    <button type="button" className={btn.dangerGhost} onClick={() => { void disconnectGoogle(); }} disabled={busy === "google"}>
                      {busy === "google" ? <Dots variant="pending" /> : <Trash2 className="h-4 w-4" strokeWidth={1.5} aria-hidden />} Disconnect
                    </button>
                  }
                />
              </div>

              {/* Which calendars come in, and whose titles a manager may
                  read. Both are real CalendarSubscription columns
                  (`direction`, `shareTitles`) that the sync honours and
                  that no UI has ever offered a control for. */}
              {calendarError ? (
                <OutcomeLine tone="bad" role="alert">
                  Couldn&rsquo;t load your calendars. {calendarError}{" "}
                  <button type="button" className={btn.link} onClick={() => { void loadCalendars(); }}>Retry</button>
                </OutcomeLine>
              ) : !calendars ? (
                <p className="m-0 inline-flex items-center gap-2 text-sm text-ink-2"><Dots variant="pending" /> Reading your calendars</p>
              ) : calendars.calendars.length === 0 ? (
                <p className="m-0 text-base text-ink-2">Google reports no calendars on this account.</p>
              ) : (
                <div>
                  {calendars.calendars.map((cal) => {
                    const sub = calendars.synced.find((s) => s.externalCalendarId === cal.id);
                    const on = Boolean(sub);
                    return (
                      <SettingsRow
                        key={cal.id}
                        label={
                          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                            {cal.name}
                            {cal.primary ? <span className={TAG}>Primary</span> : null}
                          </span>
                        }
                        control={
                          // Each switch names its calendar (Phase 3 review, L3): the
                          // words beside it are the same for every calendar. The
                          // name starts with those words, so voice control finds
                          // the switch by what it shows (WCAG 2.5.3, Label in Name).
                          <span className="inline-flex flex-wrap items-center gap-x-6 gap-y-2">
                            <label className="inline-flex items-center gap-2 text-sm text-ink-2">
                              <span>Show in my calendar</span>
                              <Switch
                                checked={on}
                                onChange={(next) => toggleCalendar(cal, next)}
                                disabled={busy === "calendars"}
                                aria-label={`Show in my calendar: ${cal.name}`}
                              />
                            </label>
                            {on ? (
                              <label className="inline-flex items-center gap-2 text-sm text-ink-2">
                                <span>Titles visible to my manager</span>
                                <Switch
                                  checked={Boolean(sub?.shareTitles)}
                                  onChange={(next) => toggleShareTitles(cal, next)}
                                  disabled={busy === "calendars"}
                                  aria-label={`Titles visible to my manager: ${cal.name}`}
                                />
                              </label>
                            ) : null}
                          </span>
                        }
                      >
                        {on ? <p className="m-0">Titles off show &ldquo;Busy&rdquo; on your team calendar.</p> : null}
                      </SettingsRow>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <div>
              {/* A real full-page navigation, deliberately. The href is a
                  ROUTE HANDLER that sets the OAuth state cookie and
                  answers a redirect to accounts.google.com: it is not a
                  page, so next/link's client navigation has nothing to
                  render and would swallow the redirect. The lint rule
                  cannot tell an /api route handler from a page, which is
                  what this disable is for. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a className={btn.primary} href="/api/integrations/google-calendar/connect">
                <Link2 className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Connect Google Calendar
              </a>
            </div>
          )}
        </SettingsCard>

        {/* ── Google for your AI teammates (Phase 3) ──────── */}
        {/* Drawn whatever the Google Calendar read did (review of step 2): it
            has its own OAuth client, its own routes, its own loading and
            error, and its own Disconnect, which a failed calendar read must
            never hide. */}
        <TeammateGoogleCard outcome={aiOutcome} />

        {/* ── AI apps (MCP) ─────────────────────────────── */}
        {/* After the Google card (docs/plans/mcp-server.md 6.2), drawn
            whatever the Google Calendar read did, as that card is: its own
            routes, its own error and its own Disconnect. Nothing at all
            where this WorkwrK does not offer the MCP server. */}
        <ConnectedAppsCard />

        {loadError || !google ? null : (
          <>
            {/* ── Personal calendar feed ──────────────────────── */}
            <SettingsCard id="connections.feed" title="Your calendar feed" description="Subscribe to your WorkwrK schedule from Apple Calendar, Outlook or Google.">
              {feed?.token && feed.url ? (
                <>
                  <div>
                    <label htmlFor="connections-feed-url" className="mb-1.5 block text-sm font-medium text-ink">Feed link</label>
                    <div className="flex max-w-[560px] items-center gap-2">
                      <TextInput id="connections-feed-url" readOnly value={feed.url} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 font-mono text-sm" />
                      <button type="button" className={cn(btn.ghost, "w-8 shrink-0 px-0")} onClick={() => { void copy(feed.url as string); }} title="Copy link" aria-label="Copy link">
                        <Copy className="h-4 w-4" strokeWidth={1.5} aria-hidden />
                      </button>
                    </div>
                    <p className="mt-1.5 text-sm text-ink-2">
                      Anyone with this link can read your schedule. Replace it if you shared it by mistake.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {feed.webcalUrl ? (
                      <a className={btn.secondary} href={feed.webcalUrl}>
                        <Calendar className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Subscribe
                      </a>
                    ) : null}
                    <button type="button" className={btn.secondary} onClick={() => { void mintFeed(true); }} disabled={busy === "feed"}>
                      {busy === "feed" ? <Dots variant="pending" /> : <RefreshCw className="h-4 w-4" strokeWidth={1.5} aria-hidden />} Replace link
                    </button>
                    <button type="button" className={btn.dangerGhost} onClick={() => { void revokeFeed(); }} disabled={busy === "feed"}>
                      <Trash2 className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Turn off
                    </button>
                  </div>
                </>
              ) : (
                // The empty row (settings-cleanup B10). A text link, not a
                // primary: ONE blue button per page (design-system 4.4), and
                // on this page it is Connect Google Calendar.
                <p className="m-0 inline-flex flex-wrap items-center gap-x-1 text-base text-ink-2">
                  No feed link yet ·{" "}
                  <button type="button" className="inline-flex items-center gap-2 text-brand-deep hover:underline disabled:opacity-50" onClick={() => { void mintFeed(false); }} disabled={busy === "feed"}>
                    {busy === "feed" ? <Dots variant="pending" /> : null}Create a feed link
                  </button>
                </p>
              )}
            </SettingsCard>

            {/* The three calendars this product does NOT sync, listed only
                for somebody who turned "Show upcoming features" on. The
                Planner's old connect banner carried one of these rows
                (Microsoft Outlook) in exactly this shape, so retiring the
                banner does not take it away. No control, no handler, no
                disabled button: a ComingSoonRow is a line, and with the
                preference off it is not rendered at all. */}
            <UpcomingOnly>
              <SettingsCard title="More calendars" description="Not built yet. Google is the one this workspace can sync today.">
                <div>
                  {["Microsoft Outlook", "Apple iCloud", "Fastmail"].map((l) => (
                    <ComingSoonRow key={l} label={l} className="border-b border-line-soft last:border-b-0" />
                  ))}
                </div>
              </SettingsCard>
            </UpcomingOnly>
          </>
        )}
      </SettingsCardStack>
    </SettingsPage>
  );
}
