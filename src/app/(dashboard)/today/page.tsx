"use client";

/* Today — personal dashboard. Pulls from real Prisma data.
 *
 * Composition (all live):
 *   - Greeting line with your name + a one-line status banner
 *   - 4 stat cards: Tasks today, Overdue, Meetings today, KPIs to score
 *   - "Up next" — next 3 meetings + next 4 tasks by time
 *   - "Action items from meetings" — open ActionItems assigned to you
 *   - "Kudos this week" — counts given/received + 2 latest received
 *   - "Pinned announcements" — top 3 active pinned posts
 *
 * Reads (all parallel):
 *   /api/me, /api/tasks, /api/meetings, /api/kudos, /api/kpi-records,
 *   /api/action-items, /api/announcements
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Sun, Sunrise, Moon, AlertCircle, CheckCircle2, CalendarClock,
  Heart, ChartLine, Megaphone, ChevronRight, Sparkles, Coffee,
} from "lucide-react";
import { useOsShell } from "@/components/layout/os/shell-context";

type Me = { user?: { id: string; firstName?: string | null; lastName?: string | null; email?: string } };
type ApiTask = {
  id: string; title: string; date: string;
  status: "PLANNED" | "IN_PROGRESS" | "COMPLETED";
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  assignee?: { id: string } | null;
};
type ApiMeeting = {
  id: string; title: string; type: string; scheduledAt: string; duration: number;
  attendees?: { userId: string }[];
};
type ApiKudo = {
  id: string; message: string; createdAt: string;
  giver?: { id: string; firstName?: string | null; lastName?: string | null } | null;
  receiver?: { id: string; firstName?: string | null; lastName?: string | null } | null;
};
type ApiActionItem = {
  id: string; title: string; status: string; dueDate?: string | null;
  meeting?: { id: string; title: string };
};
type ApiAnnouncement = {
  id: string; title: string; body?: string | null;
  type: "INFO" | "WARNING" | "CELEBRATION" | "POLICY" | "EVENT";
  pinned?: boolean; mustAcknowledge?: boolean; acknowledged?: boolean;
  publishedAt?: string | null; createdAt: string;
};
type ApiKpiRec = { id: string; kpiId: string; period: string; actualValue?: number | null; targetValue?: number | null };

const MS_DAY = 86_400_000;
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

function greetingFor() {
  const h = new Date().getHours();
  if (h < 5)  return { word: "Late night", Icon: Moon };
  if (h < 12) return { word: "Good morning", Icon: Sunrise };
  if (h < 17) return { word: "Good afternoon", Icon: Sun };
  if (h < 21) return { word: "Good evening", Icon: Sun };
  return { word: "Wrapping up", Icon: Moon };
}

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function TodayPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [tasks, setTasks] = useState<ApiTask[] | null>(null);
  const [meetings, setMeetings] = useState<ApiMeeting[] | null>(null);
  const [kudos, setKudos] = useState<ApiKudo[] | null>(null);
  const [kpiRecs, setKpiRecs] = useState<ApiKpiRec[] | null>(null);
  const [actionItems, setActionItems] = useState<ApiActionItem[] | null>(null);
  const [announcements, setAnnouncements] = useState<ApiAnnouncement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { rowVersion } = useOsShell();

  const load = useCallback(async () => {
    try {
      const meRes = await fetch("/api/me");
      const meJson: Me = meRes.ok ? await meRes.json() : { user: undefined };
      setMe(meJson);
      const myId = meJson?.user?.id;
      if (!myId) { setError("Couldn't resolve your account."); return; }

      const from = new Date(Date.now() - 7 * MS_DAY).toISOString().slice(0, 10);
      const to   = new Date(Date.now() + 14 * MS_DAY).toISOString().slice(0, 10);
      const period = currentMonthKey();

      const [tRes, mRes, kRes, kpiRes, aiRes, annRes] = await Promise.all([
        fetch(`/api/tasks?startDate=${from}&endDate=${to}`),
        fetch(`/api/meetings?limit=20`),
        fetch(`/api/kudos?limit=20`),
        fetch(`/api/kpi-records?userId=${encodeURIComponent(myId)}&limit=50`),
        fetch(`/api/action-items?assigneeId=${encodeURIComponent(myId)}&limit=20`).catch(() => null),
        fetch(`/api/announcements`),
      ]);

      if (tRes.ok) {
        const d = await tRes.json();
        const list: ApiTask[] = Array.isArray(d) ? d : (d.data ?? []);
        setTasks(list.filter((t) => t.assignee?.id === myId));
      } else setTasks([]);
      if (mRes.ok) {
        const d = await mRes.json();
        const list: ApiMeeting[] = d?.data?.items ?? d?.data ?? [];
        setMeetings(list);
      } else setMeetings([]);
      if (kRes.ok) {
        const d = await kRes.json();
        setKudos(d?.data?.items ?? d?.data ?? []);
      } else setKudos([]);
      if (kpiRes.ok) {
        const d = await kpiRes.json();
        const recs: ApiKpiRec[] = d?.data?.records ?? d?.data ?? [];
        setKpiRecs(recs.filter((r) => r.period === period));
      } else setKpiRecs([]);
      if (aiRes && aiRes.ok) {
        const d = await aiRes.json();
        setActionItems(d?.data?.items ?? d?.data ?? (Array.isArray(d) ? d : []));
      } else setActionItems([]);
      if (annRes.ok) {
        const d = await annRes.json();
        setAnnouncements(d?.data ?? (Array.isArray(d) ? d : []));
      } else setAnnouncements([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const v = rowVersion("today");
  useEffect(() => { if (v > 0) void load(); }, [v, load]);

  const myId = me?.user?.id;
  const today0 = startOfDay(new Date()).getTime();

  const todayTasks = useMemo(() => (tasks ?? []).filter((t) => t.status !== "COMPLETED" && startOfDay(new Date(t.date)).getTime() === today0), [tasks, today0]);
  const overdueTasks = useMemo(() => (tasks ?? []).filter((t) => t.status !== "COMPLETED" && startOfDay(new Date(t.date)).getTime() < today0), [tasks, today0]);
  const upcomingTasks = useMemo(() => {
    return [...(tasks ?? [])]
      .filter((t) => t.status !== "COMPLETED" && new Date(t.date).getTime() >= today0)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .slice(0, 4);
  }, [tasks, today0]);
  const todayMeetings = useMemo(() => (meetings ?? [])
    .filter((m) => myId && (m.attendees ?? []).some((a) => a.userId === myId))
    .filter((m) => sameDay(new Date(m.scheduledAt), new Date()))
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()), [meetings, myId]);
  const upcomingMeetings = useMemo(() => (meetings ?? [])
    .filter((m) => new Date(m.scheduledAt).getTime() >= Date.now())
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
    .slice(0, 4), [meetings]);

  const kudosReceivedThisWeek = useMemo(() => {
    const weekAgo = Date.now() - 7 * MS_DAY;
    return (kudos ?? []).filter((k) => k.receiver?.id === myId && new Date(k.createdAt).getTime() >= weekAgo);
  }, [kudos, myId]);
  const kudosGivenThisWeek = useMemo(() => {
    const weekAgo = Date.now() - 7 * MS_DAY;
    return (kudos ?? []).filter((k) => k.giver?.id === myId && new Date(k.createdAt).getTime() >= weekAgo);
  }, [kudos, myId]);

  const kpisScored = (kpiRecs ?? []).filter((r) => r.actualValue != null).length;
  const kpisTotal = (kpiRecs ?? []).length;
  const myActions = (actionItems ?? []).filter((a) => a.status !== "COMPLETED");

  const pinnedAnnouncements = (announcements ?? []).filter((a) => a.pinned).slice(0, 3);
  const ackPending = (announcements ?? []).filter((a) => a.mustAcknowledge && !a.acknowledged);

  const { word: greetingWord, Icon: GreetingIcon } = greetingFor();
  const name = me?.user?.firstName ?? "there";

  // Status banner: which is the most pressing thing?
  let banner: { tone: "danger" | "warn" | "info" | "good"; msg: React.ReactNode } | null = null;
  if (error) banner = { tone: "danger", msg: <>Couldn&apos;t load: {error}</> };
  else if (overdueTasks.length > 2) banner = { tone: "danger", msg: <>You have <strong>{overdueTasks.length} overdue task{overdueTasks.length === 1 ? "" : "s"}</strong> piling up.</> };
  else if (ackPending.length > 0) banner = { tone: "warn", msg: <>{ackPending.length} announcement{ackPending.length === 1 ? "" : "s"} need{ackPending.length === 1 ? "s" : ""} your acknowledgement.</> };
  else if (kpisTotal > 0 && kpisScored < kpisTotal && new Date().getDay() === 5) banner = { tone: "info", msg: <>It&apos;s Friday — log your weekly KPI numbers before EOD.</> };
  else if (todayTasks.length === 0 && todayMeetings.length === 0 && overdueTasks.length === 0) banner = { tone: "good", msg: <>Calm day. <strong>Inbox zero</strong>. Maybe pick up a backlog item or ship something small.</> };

  return (
    <div className="today2">
      <header className="today2__hello">
        <div className="today2__hello-icon"><GreetingIcon /></div>
        <div className="today2__hello-text">
          <div className="today2__hello-greet">{greetingWord},</div>
          <h1 className="today2__hello-name">{name}.</h1>
        </div>
        {banner && (
          <div className={`today2__banner today2__banner--${banner.tone}`}>
            {banner.tone === "danger" && <AlertCircle />}
            {banner.tone === "warn" && <Megaphone />}
            {banner.tone === "info" && <Sparkles />}
            {banner.tone === "good" && <Coffee />}
            <span>{banner.msg}</span>
          </div>
        )}
      </header>

      {/* Stat strip */}
      <section className="today2__stats">
        <div className="today2-stat today2-stat--today">
          <div className="today2-stat__head"><Sun /> Today</div>
          <div className="today2-stat__val">{todayTasks.length}</div>
          <div className="today2-stat__sub">task{todayTasks.length === 1 ? "" : "s"} due</div>
        </div>
        <div className={`today2-stat ${overdueTasks.length > 0 ? "today2-stat--alert" : ""}`}>
          <div className="today2-stat__head"><AlertCircle /> Overdue</div>
          <div className="today2-stat__val">{overdueTasks.length}</div>
          <div className="today2-stat__sub">{overdueTasks.length === 0 ? "all clear" : "need attention"}</div>
        </div>
        <div className="today2-stat">
          <div className="today2-stat__head"><CalendarClock /> Meetings</div>
          <div className="today2-stat__val">{todayMeetings.length}</div>
          <div className="today2-stat__sub">on your calendar</div>
        </div>
        <div className="today2-stat">
          <div className="today2-stat__head"><ChartLine /> KPIs</div>
          <div className="today2-stat__val">{kpisScored}<small>/{kpisTotal || "—"}</small></div>
          <div className="today2-stat__sub">scored this month</div>
        </div>
      </section>

      <div className="today2__grid">
        {/* Up next */}
        <section className="today2__card today2__card--upnext">
          <header className="today2__card-head">
            <h2>Up next</h2>
            <span>{todayTasks.length + todayMeetings.length} item{(todayTasks.length + todayMeetings.length) === 1 ? "" : "s"} today</span>
          </header>
          <div className="today2__upnext">
            {upcomingMeetings.length === 0 && upcomingTasks.length === 0 ? (
              <div className="today2__empty">
                <CheckCircle2 />
                <p>Nothing scheduled. Use this calm.</p>
              </div>
            ) : (
              <>
                {upcomingMeetings.slice(0, 3).map((m) => (
                  <Link key={m.id} href={`/meetings/${m.id}`} className="today2__upnext-row today2__upnext-row--meeting">
                    <span className="today2__upnext-time">{fmtTime(m.scheduledAt)}</span>
                    <span className="today2__upnext-icon today2__upnext-icon--meeting"><CalendarClock /></span>
                    <span className="today2__upnext-main">
                      <span className="today2__upnext-title">{m.title}</span>
                      <span className="today2__upnext-meta">{m.duration}min · {m.type.replace(/_/g, " ").toLowerCase()}</span>
                    </span>
                  </Link>
                ))}
                {upcomingTasks.slice(0, 4 - Math.min(3, upcomingMeetings.length)).map((t) => {
                  const due = new Date(t.date);
                  const overdue = startOfDay(due).getTime() < today0;
                  const today = startOfDay(due).getTime() === today0;
                  return (
                    <Link key={t.id} href="/tasks" className="today2__upnext-row today2__upnext-row--task">
                      <span className={`today2__upnext-time ${overdue ? "is-overdue" : today ? "is-today" : ""}`}>
                        {overdue ? `${Math.floor((today0 - startOfDay(due).getTime()) / MS_DAY)}d late` : today ? "Today" : due.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </span>
                      <span className={`today2__upnext-icon today2__upnext-icon--task ${t.priority === "URGENT" ? "is-urgent" : t.priority === "HIGH" ? "is-high" : ""}`}>
                        <CheckCircle2 />
                      </span>
                      <span className="today2__upnext-main">
                        <span className="today2__upnext-title">{t.title}</span>
                      </span>
                    </Link>
                  );
                })}
              </>
            )}
          </div>
          <footer className="today2__card-foot">
            <Link href="/tasks">All tasks <ChevronRight /></Link>
            <Link href="/meetings">All meetings <ChevronRight /></Link>
          </footer>
        </section>

        {/* Action items from meetings */}
        <section className="today2__card today2__card--actions">
          <header className="today2__card-head">
            <h2>Your action items</h2>
            <span>{myActions.length} open</span>
          </header>
          <div className="today2__actions">
            {myActions.length === 0 ? (
              <div className="today2__empty">
                <CheckCircle2 />
                <p>No outstanding action items from meetings.</p>
              </div>
            ) : myActions.slice(0, 6).map((a) => (
              <div key={a.id} className="today2-action">
                <span className="today2-action__dot" />
                <div className="today2-action__main">
                  <div className="today2-action__title">{a.title}</div>
                  <div className="today2-action__meta">
                    {a.meeting?.title && <span>from &ldquo;{a.meeting.title}&rdquo;</span>}
                    {a.dueDate && <span>· due {new Date(a.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Kudos */}
        <section className="today2__card today2__card--kudos">
          <header className="today2__card-head">
            <h2><Heart /> Kudos this week</h2>
          </header>
          <div className="today2__kudos">
            <div className="today2-kudos-stat">
              <div className="today2-kudos-stat__val">{kudosReceivedThisWeek.length}</div>
              <div className="today2-kudos-stat__lbl">received</div>
            </div>
            <div className="today2-kudos-stat">
              <div className="today2-kudos-stat__val">{kudosGivenThisWeek.length}</div>
              <div className="today2-kudos-stat__lbl">given</div>
            </div>
          </div>
          {kudosReceivedThisWeek.slice(0, 2).map((k) => (
            <div key={k.id} className="today2-kudo">
              <strong>{[k.giver?.firstName, k.giver?.lastName].filter(Boolean).join(" ") || "Someone"}</strong>
              <p>{k.message.length > 120 ? k.message.slice(0, 120) + "…" : k.message}</p>
            </div>
          ))}
          <footer className="today2__card-foot">
            <Link href="/kudos">See all kudos <ChevronRight /></Link>
          </footer>
        </section>

        {/* Pinned announcements */}
        <section className="today2__card today2__card--ann">
          <header className="today2__card-head">
            <h2><Megaphone /> Pinned</h2>
            <span>{pinnedAnnouncements.length}</span>
          </header>
          <div className="today2__ann">
            {pinnedAnnouncements.length === 0 ? (
              <div className="today2__empty">
                <Megaphone />
                <p>No pinned announcements right now.</p>
              </div>
            ) : pinnedAnnouncements.map((a) => (
              <Link key={a.id} href="/announcements" className={`today2-ann ${a.mustAcknowledge && !a.acknowledged ? "is-pending" : ""}`}>
                <div className="today2-ann__title">{a.title}</div>
                {a.body && <p className="today2-ann__body">{a.body.length > 120 ? a.body.slice(0, 120) + "…" : a.body}</p>}
                {a.mustAcknowledge && !a.acknowledged && <span className="today2-ann__ack">Needs ack</span>}
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
