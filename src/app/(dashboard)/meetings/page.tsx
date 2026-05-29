"use client";

/* Meetings — agenda-first card layout.
 *
 *  GET  /api/meetings           paginated list (with stats)
 *  POST /api/meetings           create one
 *
 * Sections (in order):
 *   - "Next up" — single hero card for the very next meeting
 *   - "Today"   — remaining meetings later today
 *   - "This week"
 *   - "Upcoming"
 *   - "Past 30 days" (compact — collapsed by default)
 *
 * Each meeting card surfaces what actually matters before you walk in:
 * time, attendees, agenda preview, action-item progress, notes signal.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Calendar as CalendarIcon, Clock, Users, FileText, CheckSquare,
  Sparkles, Plus, Loader2, ChevronRight, Video,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { C, GRAD, PEOPLE } from "@/components/layout/os/catalog";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";

type MeetingType = "DAILY_STANDUP" | "WEEKLY_REVIEW" | "ONE_ON_ONE" | "QUARTERLY_REVIEW" | "ANNUAL_PLANNING" | "ADHOC";

type ApiAttendee = {
  id: string;
  userId: string;
  user?: { id: string; firstName?: string | null; lastName?: string | null; avatar?: string | null } | null;
};

type ApiMeeting = {
  id: string;
  title: string;
  type: MeetingType;
  scheduledAt: string;
  duration: number;
  agenda?: string | null;
  notes?: string | null;
  meetingUrl?: string | null;
  attendees?: ApiAttendee[];
  stats?: { hasNotes?: boolean; decisionCount?: number; actionItemsTotal?: number; actionItemsDone?: number };
};

const TYPE_LABELS: Record<MeetingType, string> = {
  DAILY_STANDUP: "Daily standup", WEEKLY_REVIEW: "Weekly review",
  ONE_ON_ONE: "1:1", QUARTERLY_REVIEW: "Quarterly review",
  ANNUAL_PLANNING: "Annual planning", ADHOC: "Ad hoc",
};
const TYPE_COLORS: Record<MeetingType, string> = {
  DAILY_STANDUP: C.orange, WEEKLY_REVIEW: C.purple, ONE_ON_ONE: C.blue,
  QUARTERLY_REVIEW: C.indigo, ANNUAL_PLANNING: C.pink, ADHOC: C.yellow,
};

const AV_PALETTE = [C.purple, C.green, C.orange, C.pink, C.teal, C.indigo, C.blue, C.red];
function avatarColorFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AV_PALETTE[h % AV_PALETTE.length];
}
function initialsFor(first?: string | null, last?: string | null) {
  const f = (first ?? "").trim()[0] ?? "";
  const l = (last ?? "").trim()[0] ?? "";
  return ((f + l) || "?").toUpperCase();
}

const MS_DAY = 24 * 60 * 60 * 1000;
const MS_MIN = 60 * 1000;
function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

// Format "Today · 2:30 PM", "Tue, May 31 · 10:00 AM", "Jun 14 · 2:00 PM".
function fmtWhen(iso: string): { date: string; time: string; relative: string } {
  const d = new Date(iso);
  const now = new Date();
  const today0 = startOfDay(now).getTime();
  const due0 = startOfDay(d).getTime();
  const diff = due0 - today0;

  let date: string;
  if (diff === 0) date = "Today";
  else if (diff === MS_DAY) date = "Tomorrow";
  else if (diff === -MS_DAY) date = "Yesterday";
  else if (diff > 0 && diff < 7 * MS_DAY) date = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  else date = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });

  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  // Relative time (minutes/hours until or since)
  const mins = Math.round((d.getTime() - Date.now()) / MS_MIN);
  let relative = "";
  if (mins > 0 && mins < 60) relative = `in ${mins}m`;
  else if (mins >= 60 && mins < 24 * 60) relative = `in ${Math.round(mins / 60)}h`;
  else if (mins < 0 && mins > -60) relative = `${-mins}m ago`;
  else if (mins <= -60 && mins > -24 * 60) relative = `${Math.round(-mins / 60)}h ago`;

  return { date, time, relative };
}

export default function MeetingsPage() {
  const router = useNoopRouter();
  void router;
  const [meetings, setMeetings] = useState<ApiMeeting[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const { rowVersion } = useOsShell();
  const { toast } = useOsToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/meetings?limit=100");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list: ApiMeeting[] = data?.data?.items
        ?? data?.data?.data
        ?? data?.items
        ?? (Array.isArray(data?.data) ? data.data : [])
        ?? (Array.isArray(data) ? data : []);
      // Sort ascending (earliest first within future, then past at the end)
      list.sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
      setMeetings(list);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("meetings");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  async function newMeeting() {
    setCreating(true);
    try {
      const scheduledAt = new Date();
      scheduledAt.setMinutes(0, 0, 0);
      scheduledAt.setHours(scheduledAt.getHours() + 1);
      const res = await fetch("/api/meetings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Untitled meeting",
          type: "ADHOC",
          scheduledAt: scheduledAt.toISOString(),
          duration: 30,
        }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      const m: ApiMeeting = data.data ?? data;
      void load();
      // Navigate user into the new meeting so they can fill it in immediately.
      window.location.href = `/meetings/${m.id}`;
    } catch { toast("Couldn't create meeting"); setCreating(false); }
  }

  // Bucket the list by time. Within each bucket, sort by time ascending.
  const { hero, today, week, upcoming, past } = useMemo(() => {
    const now = Date.now();
    const today0 = startOfDay(new Date()).getTime();
    const tomorrow0 = today0 + MS_DAY;
    const weekEnd = today0 + 7 * MS_DAY;
    const monthAgo = today0 - 30 * MS_DAY;

    const todayFuture: ApiMeeting[] = [];
    const week: ApiMeeting[] = [];
    const upcoming: ApiMeeting[] = [];
    const past: ApiMeeting[] = [];

    for (const m of meetings ?? []) {
      const t = new Date(m.scheduledAt).getTime();
      if (t >= today0 && t < tomorrow0 && t >= now) todayFuture.push(m);
      else if (t >= tomorrow0 && t < weekEnd) week.push(m);
      else if (t >= weekEnd) upcoming.push(m);
      else if (t >= monthAgo) past.push(m);
    }

    // Hero is the very next meeting (today or future), pulled out of its bucket.
    let hero: ApiMeeting | null = null;
    if (todayFuture.length > 0) hero = todayFuture.shift() ?? null;
    else if (week.length > 0) hero = week.shift() ?? null;
    else if (upcoming.length > 0) hero = upcoming.shift() ?? null;

    return { hero, today: todayFuture, week, upcoming, past: past.reverse() }; // past = newest first
  }, [meetings]);

  const upcomingCount = (meetings ?? []).filter((m) => new Date(m.scheduledAt).getTime() > Date.now()).length;
  const total = meetings?.length ?? 0;

  return (
    <>
      <OsTitleBar
        title="Meetings"
        Icon={CalendarIcon}
        iconGradient={GRAD.pinkPurple}
        description={meetings === null ? "Loading…" : `${total} total · ${upcomingCount} upcoming`}
        people={[PEOPLE.bb, PEOPLE.sc, PEOPLE.pr]}
        morePeople={9}
        actions={
          <button type="button" className="mtg__new" onClick={newMeeting} disabled={creating}>
            {creating ? <><Loader2 className="mtg__spin" /> Creating…</> : <><Plus /> New meeting</>}
          </button>
        }
      />

      {loadError ? (
        <OsEmptyView Icon={CalendarIcon} iconGradient={GRAD.redPink} title="Couldn't load meetings" subtitle={`API error: ${loadError}.`} cta="Retry" />
      ) : meetings === null ? (
        <div className="mtg__loading">Loading meetings…</div>
      ) : total === 0 ? (
        <OsEmptyView Icon={CalendarIcon} iconGradient={GRAD.pinkPurple} title="No meetings yet" subtitle="Capture standups, 1:1s, quarterly reviews — pre-fill agenda, take notes inline, leave with action items already assigned." chips={["Standup", "1:1", "Weekly review", "Ad hoc"]} cta="New meeting" />
      ) : (
        <div className="mtg">
          {hero && <HeroCard meeting={hero} />}

          {today.length > 0 && (
            <Section title="Later today" Icon={Clock} count={today.length} accent={C.orange}>
              {today.map((m) => <MeetingCard key={m.id} meeting={m} />)}
            </Section>
          )}

          {week.length > 0 && (
            <Section title="This week" Icon={CalendarIcon} count={week.length} accent={C.blue}>
              {week.map((m) => <MeetingCard key={m.id} meeting={m} />)}
            </Section>
          )}

          {upcoming.length > 0 && (
            <Section title="Upcoming" Icon={CalendarIcon} count={upcoming.length} accent={C.indigo}>
              {upcoming.map((m) => <MeetingCard key={m.id} meeting={m} />)}
            </Section>
          )}

          {past.length > 0 && (
            <Section title="Past 30 days" Icon={CalendarIcon} count={past.length} accent={C.gray} muted>
              {past.map((m) => <MeetingCard key={m.id} meeting={m} muted />)}
            </Section>
          )}
        </div>
      )}
    </>
  );
}

// Replaces a hard react-router dependency we don't actually need.
function useNoopRouter() { return null; }

function Section({ title, Icon, count, accent, muted, children }: {
  title: string;
  Icon: typeof CalendarIcon;
  count: number;
  accent: string;
  muted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={`mtg__section ${muted ? "is-muted" : ""}`}>
      <header className="mtg__section-head">
        <Icon className="mtg__section-icon" style={{ color: accent }} />
        <h2>{title}</h2>
        <span className="mtg__section-count">{count}</span>
      </header>
      <div className="mtg__list">{children}</div>
    </section>
  );
}

function AttendeeStack({ attendees }: { attendees: ApiAttendee[] }) {
  const shown = attendees.slice(0, 4);
  const more = Math.max(0, attendees.length - 4);
  return (
    <div className="mtg-att">
      {shown.map((a) => (
        <span key={a.id} className="mtg-att__chip" style={{ background: avatarColorFor(a.userId) }} title={a.user ? `${a.user.firstName ?? ""} ${a.user.lastName ?? ""}`.trim() : "Attendee"}>
          {a.user ? initialsFor(a.user.firstName, a.user.lastName) : "?"}
        </span>
      ))}
      {more > 0 && <span className="mtg-att__more">+{more}</span>}
    </div>
  );
}

function HeroCard({ meeting }: { meeting: ApiMeeting }) {
  const when = fmtWhen(meeting.scheduledAt);
  const color = TYPE_COLORS[meeting.type];
  const startMs = new Date(meeting.scheduledAt).getTime();
  const minsAway = Math.round((startMs - Date.now()) / MS_MIN);
  const isImminent = minsAway > 0 && minsAway <= 15;
  const isLive = minsAway <= 0 && minsAway > -meeting.duration;

  return (
    <Link href={`/meetings/${meeting.id}`} className="mtg-hero" style={{ ["--mtg-color" as string]: color }}>
      <div className="mtg-hero__head">
        <div className="mtg-hero__when">
          <Sparkles /> Next up
        </div>
        <span className="mtg-hero__type" style={{ background: `color-mix(in srgb, ${color} 18%, transparent)`, color }}>
          {TYPE_LABELS[meeting.type]}
        </span>
      </div>
      <h2 className="mtg-hero__title">{meeting.title}</h2>
      <div className="mtg-hero__time">
        <span className="mtg-hero__date">{when.date}</span>
        <span className="mtg-hero__dot">·</span>
        <span className="mtg-hero__hour">{when.time}</span>
        {when.relative && <span className={`mtg-hero__rel ${isImminent ? "is-urgent" : ""} ${isLive ? "is-live" : ""}`}>{isLive ? "Live now" : when.relative}</span>}
        <span className="mtg-hero__duration">· {meeting.duration} min</span>
      </div>
      {meeting.agenda && (
        <p className="mtg-hero__agenda">{meeting.agenda.length > 220 ? meeting.agenda.slice(0, 220) + "…" : meeting.agenda}</p>
      )}
      <footer className="mtg-hero__foot">
        {(meeting.attendees && meeting.attendees.length > 0) && <AttendeeStack attendees={meeting.attendees} />}
        <div className="mtg-hero__signals">
          {meeting.stats?.actionItemsTotal ? (
            <span className="mtg-hero__sig"><CheckSquare /> {meeting.stats.actionItemsDone ?? 0} / {meeting.stats.actionItemsTotal}</span>
          ) : null}
          {meeting.stats?.hasNotes && <span className="mtg-hero__sig"><FileText /> Notes</span>}
        </div>
        {meeting.meetingUrl ? (
          <a href={meeting.meetingUrl} target="_blank" rel="noopener" className="mtg-hero__join" onClick={(e) => e.stopPropagation()}>
            <Video /> Join
          </a>
        ) : (
          <span className="mtg-hero__open">Open agenda <ChevronRight /></span>
        )}
      </footer>
    </Link>
  );
}

function MeetingCard({ meeting, muted }: { meeting: ApiMeeting; muted?: boolean }) {
  const when = fmtWhen(meeting.scheduledAt);
  const color = TYPE_COLORS[meeting.type];
  return (
    <Link href={`/meetings/${meeting.id}`} className={`mtg-card ${muted ? "is-muted" : ""}`} style={{ ["--mtg-color" as string]: color }}>
      <div className="mtg-card__when">
        <span className="mtg-card__date">{when.date}</span>
        <span className="mtg-card__time">{when.time}</span>
      </div>
      <div className="mtg-card__body">
        <div className="mtg-card__title-row">
          <h3 className="mtg-card__title">{meeting.title}</h3>
          <span className="mtg-card__type" style={{ background: `color-mix(in srgb, ${color} 12%, transparent)`, color }}>
            {TYPE_LABELS[meeting.type]}
          </span>
        </div>
        {meeting.agenda && (
          <p className="mtg-card__agenda">{meeting.agenda.length > 120 ? meeting.agenda.slice(0, 120) + "…" : meeting.agenda}</p>
        )}
        <div className="mtg-card__meta">
          <span className="mtg-card__duration"><Clock /> {meeting.duration}m</span>
          {meeting.attendees && meeting.attendees.length > 0 && <AttendeeStack attendees={meeting.attendees} />}
          {meeting.stats?.actionItemsTotal ? (
            <span className="mtg-card__sig"><CheckSquare /> {meeting.stats.actionItemsDone ?? 0}/{meeting.stats.actionItemsTotal}</span>
          ) : null}
          {meeting.stats?.hasNotes && <span className="mtg-card__sig"><FileText /> Notes</span>}
        </div>
      </div>
      <ChevronRight className="mtg-card__arrow" />
    </Link>
  );
}
