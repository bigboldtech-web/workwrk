"use client";

import {
  Home,
  Star,
  Plus,
  Search as SearchIcon,
  Users,
  Filter,
  ArrowUpDown,
  EyeOff,
  Group,
  Sparkles,
  Zap,
  UserPlus,
  LayoutDashboard,
  Table2,
  KanbanSquare,
  Calendar,
  GanttChart,
  MoreHorizontal,
  TrendingUp,
  TrendingDown,
  ChevronDown,
} from "lucide-react";

export default function TodayPage() {
  return (
    <>
      {/* ─── Title bar ─── */}
      <div className="os-title-bar">
        <div className="os-title-bar__icon" style={{ background: "linear-gradient(135deg, var(--os-c-orange), var(--os-c-pink))" }}>
          <Home />
        </div>
        <div className="os-title-bar__main">
          <span className="os-title-bar__name">Today</span>
          <button type="button" className="os-title-bar__star" aria-label="Unstar">
            <Star />
          </button>
        </div>
        <span className="os-title-bar__desc">Your day at a glance · synced with all boards</span>
        <div className="os-title-bar__spacer" />
        <div className="os-title-bar__people">
          <span className="os-title-bar__people-av" style={{ background: "var(--os-c-purple)" }}>BB</span>
          <span className="os-title-bar__people-av" style={{ background: "var(--os-c-green)" }}>SC</span>
          <span className="os-title-bar__people-av" style={{ background: "var(--os-c-orange)" }}>AK</span>
          <span className="os-title-bar__people-more">+9</span>
        </div>
        <button type="button" className="os-title-bar__btn os-title-bar__btn--integrate">
          <Zap />
          <span>Integrate</span>
        </button>
        <button type="button" className="os-title-bar__btn os-title-bar__btn--automate">
          <Sparkles />
          <span>Automate</span>
        </button>
        <button type="button" className="os-title-bar__btn os-title-bar__btn--invite">
          <UserPlus />
          <span>Invite / 1</span>
        </button>
      </div>

      {/* ─── Tabs ─── */}
      <div className="os-tabs">
        <button type="button" className="os-tab is-active">
          <LayoutDashboard />
          <span>Dashboard</span>
        </button>
        <button type="button" className="os-tab">
          <Table2 />
          <span>Main table</span>
        </button>
        <button type="button" className="os-tab">
          <KanbanSquare />
          <span>Kanban</span>
        </button>
        <button type="button" className="os-tab">
          <Calendar />
          <span>Calendar</span>
        </button>
        <button type="button" className="os-tab">
          <GanttChart />
          <span>Gantt</span>
        </button>
        <button type="button" className="os-tab os-tab--add">
          <Plus />
          <span>Add view</span>
        </button>
      </div>

      {/* ─── Filter strip ─── */}
      <div className="os-filter">
        <div className="os-btn-new">
          <button type="button" className="os-btn-new__main">
            <Plus />
            <span>New item</span>
          </button>
          <button type="button" className="os-btn-new__chev" aria-label="More create options">
            <ChevronDown />
          </button>
        </div>
        <button type="button" className="os-filter-chip">
          <SearchIcon />
          <span>Search</span>
        </button>
        <button type="button" className="os-filter-chip">
          <Users />
          <span>Person</span>
        </button>
        <button type="button" className="os-filter-chip is-on">
          <Filter />
          <span>Filter</span>
          <span className="os-filter-chip__count">2</span>
        </button>
        <button type="button" className="os-filter-chip">
          <ArrowUpDown />
          <span>Sort</span>
        </button>
        <button type="button" className="os-filter-chip">
          <EyeOff />
          <span>Hide</span>
        </button>
        <button type="button" className="os-filter-chip">
          <Group />
          <span>Group by</span>
        </button>
        <div className="os-filter__spacer" />
        <button type="button" className="os-filter-chip">
          <MoreHorizontal />
        </button>
      </div>

      {/* ─── Dashboard widgets ─── */}
      <div className="os-dash">
        {/* Battery — sprint completion */}
        <div className="os-widget os-widget--battery">
          <div className="os-widget__head">
            <span className="os-widget__head-dot" style={{ background: "white" }} />
            <span>Sprint Q3 — Battery</span>
            <MoreHorizontal />
          </div>
          <div className="os-widget__big">
            64<small>%</small>
          </div>
          <div className="os-widget__sub">Sprint completion · 12 of 19 items done</div>
          <div className="os-widget__progress">
            <div className="os-widget__progress-fill" style={{ width: "64%" }} />
          </div>
          <div className="os-widget__legend">
            <span>● 12 Done</span>
            <span>● 4 Working</span>
            <span>● 3 Stuck</span>
          </div>
        </div>

        {/* Numbers */}
        <div className="os-widget os-widget--num">
          <div className="os-widget__head">
            <span className="os-widget__head-dot os-c-green" />
            <span>Pipeline</span>
            <MoreHorizontal />
          </div>
          <div className="os-widget__big">₹42.8L</div>
          <div className="os-widget__delta os-widget__delta--up">
            <TrendingUp />
            <span>+12%</span>
          </div>
          <div className="os-widget__numsub">vs. last week</div>
        </div>

        <div className="os-widget os-widget--num">
          <div className="os-widget__head">
            <span className="os-widget__head-dot os-c-red" />
            <span>SLAs at risk</span>
            <MoreHorizontal />
          </div>
          <div className="os-widget__big">2</div>
          <div className="os-widget__delta os-widget__delta--down">
            <TrendingDown />
            <span>+2</span>
          </div>
          <div className="os-widget__numsub">2 active incidents</div>
        </div>

        {/* Spark line — weekly velocity */}
        <div className="os-widget os-widget--spark">
          <div className="os-widget__head">
            <span className="os-widget__head-dot os-c-blue" />
            <span>Weekly velocity</span>
            <MoreHorizontal />
          </div>
          <svg viewBox="0 0 400 84" preserveAspectRatio="none">
            <defs>
              <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0073EA" stopOpacity="0.25" />
                <stop offset="100%" stopColor="#0073EA" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path
              d="M0,58 L57,46 L114,52 L171,30 L228,38 L285,20 L342,28 L400,8 L400,84 L0,84 Z"
              fill="url(#sparkGrad)"
            />
            <path
              d="M0,58 L57,46 L114,52 L171,30 L228,38 L285,20 L342,28 L400,8"
              fill="none"
              stroke="#0073EA"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {[
              { x: 0, y: 58 }, { x: 57, y: 46 }, { x: 114, y: 52 }, { x: 171, y: 30 },
              { x: 228, y: 38 }, { x: 285, y: 20 }, { x: 342, y: 28 }, { x: 400, y: 8 },
            ].map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r="3" fill="#0073EA" />
            ))}
          </svg>
        </div>

        {/* Donut — task status breakdown */}
        <div className="os-widget os-widget--donut">
          <div className="os-widget__head">
            <span className="os-widget__head-dot os-c-purple" />
            <span>Tasks by status</span>
            <MoreHorizontal />
          </div>
          <div className="os-widget__wrap">
            <svg className="os-donut-svg" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="14" fill="none" stroke="var(--os-surface-2)" strokeWidth="6" />
              {/* Done: 0-50% */}
              <circle cx="18" cy="18" r="14" fill="none" stroke="var(--os-c-green)" strokeWidth="6"
                strokeDasharray="44 88" strokeDashoffset="0" transform="rotate(-90 18 18)" />
              {/* Working: 50-72% */}
              <circle cx="18" cy="18" r="14" fill="none" stroke="var(--os-c-orange)" strokeWidth="6"
                strokeDasharray="20 88" strokeDashoffset="-44" transform="rotate(-90 18 18)" />
              {/* Stuck: 72-85% */}
              <circle cx="18" cy="18" r="14" fill="none" stroke="var(--os-c-red)" strokeWidth="6"
                strokeDasharray="12 88" strokeDashoffset="-64" transform="rotate(-90 18 18)" />
              {/* Review: 85-100% */}
              <circle cx="18" cy="18" r="14" fill="none" stroke="var(--os-c-purple)" strokeWidth="6"
                strokeDasharray="13 88" strokeDashoffset="-76" transform="rotate(-90 18 18)" />
            </svg>
            <div className="os-donut__legend">
              <div className="os-donut__legend-item">
                <span className="os-donut__legend-dot os-c-green" />
                Done <strong>50%</strong>
              </div>
              <div className="os-donut__legend-item">
                <span className="os-donut__legend-dot os-c-orange" />
                Working <strong>22%</strong>
              </div>
              <div className="os-donut__legend-item">
                <span className="os-donut__legend-dot os-c-red" />
                Stuck <strong>13%</strong>
              </div>
              <div className="os-donut__legend-item">
                <span className="os-donut__legend-dot os-c-purple" />
                Review <strong>15%</strong>
              </div>
            </div>
          </div>
        </div>

        {/* Bars — items shipped per week */}
        <div className="os-widget os-widget--bars">
          <div className="os-widget__head">
            <span className="os-widget__head-dot os-c-pink" />
            <span>Items shipped — last 6 weeks</span>
            <MoreHorizontal />
          </div>
          <div className="os-bars">
            {[
              { v: 12, h: 38 },
              { v: 18, h: 56 },
              { v: 15, h: 48 },
              { v: 22, h: 70 },
              { v: 28, h: 88 },
              { v: 24, h: 78 },
            ].map((b, i) => (
              <div key={i} className="os-bar" style={{ height: `${b.h}%` }}>
                <span className="os-bar__value">{b.v}</span>
                <span className="os-bar__label">W{i + 1}</span>
              </div>
            ))}
          </div>
        </div>

        {/* People workload */}
        <div className="os-widget os-widget--people">
          <div className="os-widget__head">
            <span className="os-widget__head-dot os-c-indigo" />
            <span>Workload by person</span>
            <MoreHorizontal />
          </div>
          <div className="os-people-list">
            {[
              { initials: "BB", name: "BigBold (You)", count: 12, pct: 86, color: "var(--os-c-purple)", barColor: "var(--os-c-red)" },
              { initials: "SC", name: "Sarah Cohen",   count: 8,  pct: 60, color: "var(--os-c-green)",  barColor: "var(--os-c-orange)" },
              { initials: "AK", name: "Arjun Kumar",   count: 6,  pct: 42, color: "var(--os-c-orange)", barColor: "var(--os-c-blue)" },
              { initials: "PR", name: "Priya Rao",     count: 5,  pct: 36, color: "var(--os-c-pink)",   barColor: "var(--os-c-green)" },
              { initials: "MK", name: "Maya Kapoor",   count: 3,  pct: 22, color: "var(--os-c-teal)",   barColor: "var(--os-c-green)" },
            ].map((p) => (
              <div key={p.initials} className="os-people-row">
                <span className="os-people-row__av" style={{ background: p.color }}>{p.initials}</span>
                <span className="os-people-row__name">{p.name}</span>
                <span className="os-people-row__bar">
                  <span className="os-people-row__bar-fill" style={{ width: `${p.pct}%`, background: p.barColor }} />
                </span>
                <span className="os-people-row__count">{p.count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Feed */}
        <div className="os-widget os-widget--feed">
          <div className="os-widget__head">
            <span className="os-widget__head-dot os-c-teal" />
            <span>Live updates</span>
            <MoreHorizontal />
          </div>
          {[
            { who: "Sarah Cohen", av: "SC", color: "var(--os-c-green)",
              body: <>moved <strong>Acme renewal proposal</strong> to <span className="os-feed-item__chip os-c-purple">Review</span></>,
              time: "2m" },
            { who: "Ria (agent)",  av: "R", color: "var(--os-c-orange)",
              body: <>drafted <strong>4 follow-up emails</strong> for stalled deals · awaiting your review</>,
              time: "12m" },
            { who: "Arjun Kumar",  av: "AK", color: "var(--os-c-blue)",
              body: <>completed <strong>Sprint Q3 retro doc</strong> <em>· Engineering</em></>,
              time: "1h" },
            { who: "Priya Rao",    av: "PR", color: "var(--os-c-pink)",
              body: <>opened a <strong>support ticket</strong> for the auth bug — marked <span className="os-feed-item__chip os-c-red">Stuck</span></>,
              time: "2h" },
            { who: "Maya Kapoor",  av: "MK", color: "var(--os-c-teal)",
              body: <>scheduled <strong>3 candidate interviews</strong> for the Senior PM role</>,
              time: "3h" },
          ].map((it, i) => (
            <div key={i} className="os-feed-item">
              <span className="os-feed-item__av" style={{ background: it.color }}>{it.av}</span>
              <span className="os-feed-item__body">
                <strong>{it.who}</strong> {it.body}
              </span>
              <span className="os-feed-item__time">{it.time}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
