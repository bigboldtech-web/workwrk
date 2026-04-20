"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/dashboard/page-header";
import { useToast } from "@/components/ui/toast";
import { Loader2, Plug, Unplug, RefreshCcw, CheckCircle2, Link2, Copy, RotateCw } from "lucide-react";

interface GoogleCalendar {
  id: string;
  name: string;
  primary: boolean;
  color: string | null;
  accessRole: string | null;
}

interface SyncedSub {
  externalCalendarId: string | null;
  direction: string;
  shareTitles: boolean;
  enabled: boolean;
}

export default function CalendarSettingsPage() {
  const search = useSearchParams();
  const { success: toastSuccess, error: toastError } = useToast();

  const [status, setStatus] = useState<{
    connected: boolean;
    subscriptions: SyncedSub[];
    connectedAt: string | null;
    lastSyncAt: string | null;
  } | null>(null);
  const [calendars, setCalendars] = useState<GoogleCalendar[] | null>(null);
  const [loadingCalendars, setLoadingCalendars] = useState(false);
  const [saving, setSaving] = useState(false);

  // iCal feed state — token is null until the user generates one.
  const [icsFeed, setIcsFeed] = useState<{ token: string | null; url?: string; webcalUrl?: string } | null>(null);

  // Per-calendar local state: { [id]: { selected, direction, shareTitles } }
  const [pick, setPick] = useState<Record<string, { selected: boolean; direction: "IN" | "OUT" | "BOTH"; shareTitles: boolean }>>({});

  useEffect(() => {
    if (search.get("connected") === "1") toastSuccess("Connected to Google Calendar");
    const errParam = search.get("error");
    if (errParam) toastError(`Connection failed: ${errParam}`);
  }, [search, toastSuccess, toastError]);

  async function loadStatus() {
    const res = await fetch("/api/integrations/google-calendar");
    if (res.ok) {
      const d = await res.json();
      setStatus(d.data ?? d);
    }
  }

  async function loadCalendars() {
    setLoadingCalendars(true);
    try {
      const res = await fetch("/api/integrations/google-calendar/calendars");
      if (res.ok) {
        const d = await res.json();
        const body = d.data ?? d;
        if (!body.connected) { setCalendars([]); return; }
        setCalendars(body.calendars);
        const synced: SyncedSub[] = body.synced ?? [];
        const next: typeof pick = {};
        for (const c of body.calendars as GoogleCalendar[]) {
          const existing = synced.find((s) => s.externalCalendarId === c.id);
          next[c.id] = {
            selected: !!existing,
            direction: (existing?.direction as "IN" | "OUT" | "BOTH") ?? "BOTH",
            shareTitles: !!existing?.shareTitles,
          };
        }
        setPick(next);
      }
    } finally { setLoadingCalendars(false); }
  }

  useEffect(() => { loadStatus(); }, []);
  useEffect(() => { if (status?.connected) loadCalendars(); }, [status?.connected]);

  // Fetch current iCal feed state once on mount.
  useEffect(() => {
    fetch("/api/calendar/ics/token")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setIcsFeed(d.data ?? d);
      })
      .catch(() => {});
  }, []);

  async function generateIcs() {
    const res = await fetch("/api/calendar/ics/token", { method: "POST" });
    if (res.ok) {
      const d = await res.json();
      setIcsFeed(d.data ?? d);
      toastSuccess("Feed URL ready");
    }
  }

  async function rotateIcs() {
    if (!confirm("Rotate the feed URL? The old URL stops working immediately.")) return;
    await generateIcs();
  }

  async function revokeIcs() {
    if (!confirm("Revoke the feed? Any calendar subscribed to this URL will stop receiving updates.")) return;
    const res = await fetch("/api/calendar/ics/token", { method: "DELETE" });
    if (res.ok) {
      setIcsFeed({ token: null });
      toastSuccess("Feed revoked");
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).then(() => toastSuccess("Copied"));
  }

  function connect() {
    window.location.href = "/api/integrations/google-calendar/connect";
  }

  async function disconnect() {
    if (!confirm("Disconnect Google Calendar? All synced events will be removed from Workwrk.")) return;
    const res = await fetch("/api/integrations/google-calendar", { method: "DELETE" });
    if (res.ok) {
      toastSuccess("Google Calendar disconnected");
      setStatus(null);
      setCalendars(null);
      setPick({});
      loadStatus();
    } else {
      toastError("Disconnect failed");
    }
  }

  async function saveSubscriptions() {
    setSaving(true);
    try {
      const subscriptions = Object.entries(pick)
        .filter(([, v]) => v.selected)
        .map(([externalCalendarId, v]) => ({
          externalCalendarId,
          direction: v.direction,
          shareTitles: v.shareTitles,
        }));
      const res = await fetch("/api/integrations/google-calendar/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriptions }),
      });
      if (res.ok) {
        toastSuccess(`Synced ${subscriptions.length} calendar${subscriptions.length !== 1 ? "s" : ""}`);
        loadStatus();
      } else {
        const body = await res.json().catch(() => ({}));
        toastError(body.error || "Save failed");
      }
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader
        kicker="Settings · calendar"
        title="Google Calendar"
        subtitle="Overlay your Google events in the work calendar, and optionally push Workwrk tasks to a Google calendar."
      />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Connection</CardTitle>
            {status?.connected ? (
              <Badge variant="secondary" className="gap-1 text-xs"><CheckCircle2 size={11} className="text-[#d4ff2e]" /> Connected</Badge>
            ) : (
              <Badge variant="outline" className="text-xs">Not connected</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {!status ? (
            <div className="flex items-center gap-2 text-xs text-muted"><Loader2 size={12} className="animate-spin" /> Loading…</div>
          ) : status.connected ? (
            <div className="space-y-3">
              <p className="text-xs text-muted">
                Connected {status.connectedAt ? new Date(status.connectedAt).toLocaleDateString() : "—"}
                {status.lastSyncAt ? ` · last sync ${new Date(status.lastSyncAt).toLocaleString()}` : ""}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => loadCalendars()}>
                  <RefreshCcw size={12} /> Refresh
                </Button>
                <Button variant="outline" size="sm" className="gap-1.5 text-red-400 border-red-400/30 hover:bg-red-500/10" onClick={disconnect}>
                  <Unplug size={12} /> Disconnect
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted">
                Connect your Google account to bring your existing calendars into the work calendar.
                You'll pick exactly which calendars to sync on the next screen — personal calendars stay private.
              </p>
              <Button onClick={connect} className="gap-1.5"><Plug size={14} /> Connect Google Calendar</Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Link2 size={14} /> Subscribe in Apple / Outlook / any calendar</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted">
            Generate a personal feed URL and paste it into Apple Calendar, Outlook, or any app
            that supports subscribing to an iCal (<code>.ics</code>) URL. The feed is read-only —
            edits made outside Workwrk don't sync back.
          </p>
          {icsFeed?.token ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <code className="flex-1 min-w-0 truncate text-xs bg-surface-2 rounded px-2 py-1.5 font-mono">{icsFeed.url}</code>
                <Button size="sm" variant="outline" className="gap-1.5 shrink-0" onClick={() => copyToClipboard(icsFeed.url!)}>
                  <Copy size={12} /> Copy
                </Button>
              </div>
              {icsFeed.webcalUrl && (
                <p className="text-[11px] text-muted">
                  On Mac, click <a href={icsFeed.webcalUrl} className="text-[#d4ff2e] hover:underline">this webcal link</a> to subscribe in one step.
                </p>
              )}
              <div className="flex gap-2 pt-1">
                <Button size="sm" variant="outline" className="gap-1.5" onClick={rotateIcs}>
                  <RotateCw size={12} /> Rotate
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5 text-red-400 border-red-400/30 hover:bg-red-500/10" onClick={revokeIcs}>
                  <Unplug size={12} /> Revoke
                </Button>
              </div>
            </div>
          ) : (
            <Button onClick={generateIcs} className="gap-1.5"><Link2 size={14} /> Generate subscribe URL</Button>
          )}
        </CardContent>
      </Card>

      {status?.connected && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Calendars to sync</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingCalendars || calendars === null ? (
              <div className="flex items-center gap-2 text-xs text-muted"><Loader2 size={12} className="animate-spin" /> Loading calendars…</div>
            ) : calendars.length === 0 ? (
              <p className="text-xs text-muted">No calendars returned by Google.</p>
            ) : (
              <div className="space-y-2">
                <p className="text-[11px] text-muted">
                  Check the calendars you want to flow into Workwrk. Google events appear as read-only
                  overlay in your calendar views. Your manager sees titles only if you toggle
                  <strong> "Share titles"</strong> on below — otherwise events show as <em>Busy</em>.
                </p>
                <div className="space-y-1.5">
                  {calendars.map((c) => {
                    const state = pick[c.id] ?? { selected: false, direction: "BOTH", shareTitles: false };
                    return (
                      <div key={c.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
                        <input
                          type="checkbox"
                          checked={state.selected}
                          onChange={(e) => setPick({ ...pick, [c.id]: { ...state, selected: e.target.checked } })}
                          className="accent-[#a8cc24] h-4 w-4"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            {c.color && <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: c.color }} />}
                            <span className="text-sm font-medium truncate">{c.name}</span>
                            {c.primary && <Badge variant="secondary" className="text-[9px]">Primary</Badge>}
                          </div>
                          <p className="text-[10px] text-muted mt-0.5">{c.accessRole}</p>
                        </div>
                        {state.selected && (
                          <div className="flex items-center gap-2 flex-wrap justify-end">
                            <select
                              value={state.direction}
                              onChange={(e) => setPick({ ...pick, [c.id]: { ...state, direction: e.target.value as any } })}
                              className="h-8 rounded-md border border-border bg-background px-2 text-xs"
                              title="Sync direction"
                            >
                              <option value="IN">Pull in only</option>
                              <option value="OUT">Push out only</option>
                              <option value="BOTH">Two-way</option>
                            </select>
                            <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer">
                              <input
                                type="checkbox"
                                checked={state.shareTitles}
                                onChange={(e) => setPick({ ...pick, [c.id]: { ...state, shareTitles: e.target.checked } })}
                                className="accent-[#a8cc24]"
                              />
                              Share titles
                            </label>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="pt-2 flex justify-end">
                  <Button onClick={saveSubscriptions} disabled={saving}>
                    {saving ? <><Loader2 size={12} className="animate-spin mr-1" /> Saving…</> : "Save sync settings"}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
