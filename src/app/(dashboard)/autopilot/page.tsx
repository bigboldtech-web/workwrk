"use client";

/* Autopilot — workflow automation rules with KPI strip + status filters.
 *
 * Stub: showcases sample triggers / conditions / actions across modules.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Workflow, Plus, Hash, ChevronRight, Activity, CheckCircle2, Pause, Play,
  AlertTriangle, Zap, ArrowRight, Search, Bot, MessageCircle,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { C, GRAD } from "@/components/layout/os/catalog";

type RuleStatus = "ACTIVE" | "PAUSED" | "ERROR";
type TriggerType = "schedule" | "event" | "webhook" | "manual";

type Rule = {
  id: string;
  name: string;
  description: string;
  triggerLabel: string;
  triggerType: TriggerType;
  conditions: string[];
  actions: string[];
  status: RuleStatus;
  runsThisWeek: number;
  savedHrs: number;
  lastRun?: string;
  hue: string;
};

const RULES: Rule[] = [
  {
    id: "r1", name: "Auto-approve travel < $200",
    description: "Skip manager approval on small travel claims with attached receipt.",
    triggerLabel: "Expense submitted", triggerType: "event",
    conditions: ["category = Travel", "amount < 200", "receipt attached"],
    actions: ["Set status = APPROVED", "Post to GL", "Notify reporter"],
    status: "ACTIVE", runsThisWeek: 23, savedHrs: 4.2, lastRun: "12 min ago", hue: C.green,
  },
  {
    id: "r2", name: "Stale PR nudge",
    description: "Ping the reviewer if a PR has had no activity for 48h.",
    triggerLabel: "Daily 9 AM", triggerType: "schedule",
    conditions: ["PR open > 48h", "no review activity"],
    actions: ["Slack DM reviewer", "Add label 'nudged'"],
    status: "ACTIVE", runsThisWeek: 47, savedHrs: 2.8, lastRun: "today", hue: C.blue,
  },
  {
    id: "r3", name: "Overdue SOP escalation",
    description: "Escalate mandatory SOP overdue > 7 days to the user's manager.",
    triggerLabel: "Daily 6 AM", triggerType: "schedule",
    conditions: ["assignment.mandatory = true", "overdue > 7d"],
    actions: ["Email manager", "Mark on compliance dashboard"],
    status: "ACTIVE", runsThisWeek: 12, savedHrs: 5.0, lastRun: "today", hue: C.red,
  },
  {
    id: "r4", name: "New hire onboarding kickoff",
    description: "When a new user is created, fire the standard onboarding SOPs.",
    triggerLabel: "User created", triggerType: "event",
    conditions: ["role = Employee", "department exists"],
    actions: ["Assign 6 SOPs", "Create welcome task", "Slack invite"],
    status: "ACTIVE", runsThisWeek: 3, savedHrs: 6.0, lastRun: "2d ago", hue: C.pink,
  },
  {
    id: "r5", name: "Vendor invoice → PO match",
    description: "Auto-link an inbound invoice to the open PO with the same vendor + amount.",
    triggerLabel: "Invoice received", triggerType: "webhook",
    conditions: ["vendor matches", "amount within 2%"],
    actions: ["Link to PO", "Move to APPROVED", "Notify finance"],
    status: "PAUSED", runsThisWeek: 0, savedHrs: 3.5, lastRun: "—", hue: C.orange,
  },
  {
    id: "r6", name: "PTO conflict checker",
    description: "Block conflicting PTO requests for the same project + week.",
    triggerLabel: "PTO submitted", triggerType: "event",
    conditions: ["overlapping > 30%", "same project"],
    actions: ["Hold for approval", "Notify both employees"],
    status: "ERROR", runsThisWeek: 2, savedHrs: 1.0, lastRun: "blocked yesterday", hue: C.red,
  },
  {
    id: "r7", name: "Weekly finance digest",
    description: "Send the weekly P&L variance snapshot to leadership every Monday.",
    triggerLabel: "Monday 7 AM", triggerType: "schedule",
    conditions: [],
    actions: ["Generate variance report", "Email exec list", "Post to #finance"],
    status: "ACTIVE", runsThisWeek: 1, savedHrs: 2.5, lastRun: "Monday", hue: C.purple,
  },
  {
    id: "r8", name: "Slack /standup",
    description: "Manual slash command that compiles a stand-up from yesterday's tasks.",
    triggerLabel: "/standup", triggerType: "manual",
    conditions: [],
    actions: ["Fetch yesterday's done tasks", "Post in #standup"],
    status: "ACTIVE", runsThisWeek: 19, savedHrs: 1.5, lastRun: "today", hue: C.indigo,
  },
];

const STATUS_LABEL: Record<RuleStatus, string> = {
  ACTIVE: "Active", PAUSED: "Paused", ERROR: "Error",
};
const STATUS_HUE: Record<RuleStatus, string> = {
  ACTIVE: "var(--os-c-green)", PAUSED: "var(--os-c-orange)", ERROR: "var(--os-c-red)",
};
const STATUS_ICON: Record<RuleStatus, typeof Activity> = {
  ACTIVE: CheckCircle2, PAUSED: Pause, ERROR: AlertTriangle,
};

const TRIGGER_LABEL: Record<TriggerType, string> = {
  schedule: "Schedule", event: "Event", webhook: "Webhook", manual: "Manual",
};
const TRIGGER_ICON: Record<TriggerType, typeof Activity> = {
  schedule: Activity, event: Zap, webhook: Bot, manual: Play,
};

export default function AutopilotPage() {
  const [statusFilter, setStatusFilter] = useState<"ALL" | RuleStatus>("ALL");
  const [search, setSearch] = useState("");

  const stats = useMemo(() => {
    const active = RULES.filter((r) => r.status === "ACTIVE").length;
    const paused = RULES.filter((r) => r.status === "PAUSED").length;
    const errored = RULES.filter((r) => r.status === "ERROR").length;
    const runs = RULES.reduce((a, r) => a + r.runsThisWeek, 0);
    const savedHrs = RULES.reduce((a, r) => a + r.savedHrs, 0);
    return { active, paused, errored, runs, savedHrs, total: RULES.length };
  }, []);

  const filtered = useMemo(() => {
    let list = RULES;
    if (statusFilter !== "ALL") list = list.filter((r) => r.status === statusFilter);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((r) =>
      r.name.toLowerCase().includes(q) ||
      r.description.toLowerCase().includes(q) ||
      r.triggerLabel.toLowerCase().includes(q));
    return list;
  }, [statusFilter, search]);

  return (
    <>
      <OsTitleBar
        title="Autopilot"
        Icon={Workflow}
        iconGradient={GRAD.tealGreen}
        description={`${stats.active} active rule${stats.active === 1 ? "" : "s"} · ${stats.runs} runs this week · ~${stats.savedHrs.toFixed(1)}h saved`}
        actions={
          <div className="auto__head-actions">
            <Link href="/agents" className="auto__nav-link"><Bot /> Agents</Link>
            <Link href="/sidekick" className="auto__nav-link"><MessageCircle /> Sidekick</Link>
            <button type="button" className="auto__btn-primary">
              <Plus /> New rule
            </button>
          </div>
        }
      />

      <div className="auto">
        <div className="auto__kpis">
          <KpiTile accent="var(--os-c-green)"  Icon={CheckCircle2} label="Active rules" value={`${stats.active}`}   sub={`${stats.total} total`} />
          <KpiTile accent="var(--os-c-blue)"   Icon={Activity}     label="Runs / week" value={`${stats.runs}`}     sub="across rules" />
          <KpiTile accent="var(--os-c-purple)" Icon={Zap}          label="Saved"       value={`${stats.savedHrs.toFixed(1)}h`} sub="per week" />
          <KpiTile accent={stats.errored > 0 ? "var(--os-c-red)" : "var(--os-c-orange)"} Icon={AlertTriangle} label="Needs attention" value={`${stats.errored + stats.paused}`} sub={`${stats.errored} error · ${stats.paused} paused`} />
        </div>

        <div className="auto__toolbar">
          <div className="auto__search">
            <Search />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search rule, trigger, action…" />
          </div>
          <div className="auto__filters">
            {(["ALL", "ACTIVE", "PAUSED", "ERROR"] as const).map((s) => {
              const Icon = s === "ALL" ? Hash : STATUS_ICON[s as RuleStatus];
              return (
                <button
                  key={s}
                  type="button"
                  className={`auto__filter${statusFilter === s ? " is-active" : ""}`}
                  style={s !== "ALL" ? { ["--f-c" as unknown as string]: STATUS_HUE[s as RuleStatus] } : undefined}
                  onClick={() => setStatusFilter(s)}
                >
                  <Icon /> {s === "ALL" ? "All" : STATUS_LABEL[s as RuleStatus]}
                  <span>{s === "ALL" ? stats.total : s === "ACTIVE" ? stats.active : s === "PAUSED" ? stats.paused : stats.errored}</span>
                </button>
              );
            })}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="auto__no-match"><Search /> No rules match.</div>
        ) : (
          <div className="auto__list">
            {filtered.map((r) => {
              const StatusIcon = STATUS_ICON[r.status];
              const TriggerIcon = TRIGGER_ICON[r.triggerType];
              return (
                <article key={r.id} className={`auto__card auto__card--${r.status.toLowerCase()}`} style={{ ["--r-c" as unknown as string]: r.hue }}>
                  <header className="auto__card-head">
                    <span className="auto__card-status" style={{ ["--s-c" as unknown as string]: STATUS_HUE[r.status] }}>
                      <StatusIcon /> {STATUS_LABEL[r.status]}
                    </span>
                    <h3>{r.name}</h3>
                    <span className="auto__card-trigger"><TriggerIcon /> {TRIGGER_LABEL[r.triggerType]}</span>
                  </header>
                  <p className="auto__card-desc">{r.description}</p>

                  <div className="auto__flow">
                    <div className="auto__step">
                      <span className="auto__step-label">When</span>
                      <span className="auto__step-body">{r.triggerLabel}</span>
                    </div>
                    <ArrowRight className="auto__flow-arrow" />
                    <div className="auto__step">
                      <span className="auto__step-label">If</span>
                      <span className="auto__step-body">{r.conditions.length === 0 ? "always" : r.conditions.join(" · ")}</span>
                    </div>
                    <ArrowRight className="auto__flow-arrow" />
                    <div className="auto__step auto__step--last">
                      <span className="auto__step-label">Then</span>
                      <span className="auto__step-body">{r.actions.join(" · ")}</span>
                    </div>
                  </div>

                  <footer className="auto__card-foot">
                    <span><Activity /> {r.runsThisWeek} this week</span>
                    <span><Zap /> {r.savedHrs.toFixed(1)}h saved</span>
                    {r.lastRun && <span className="auto__card-last">Last run · {r.lastRun}</span>}
                    <ChevronRight className="auto__card-arrow" />
                  </footer>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function KpiTile({ accent, Icon, label, value, sub }: { accent: string; Icon: typeof Workflow; label: string; value: string; sub: string }) {
  return (
    <div className="auto__kpi" style={{ ["--kpi-accent" as unknown as string]: accent }}>
      <span className="auto__kpi-accent" aria-hidden="true" />
      <div className="auto__kpi-row">
        <div className="auto__kpi-icon"><Icon /></div>
        <div className="auto__kpi-label">{label}</div>
      </div>
      <div className="auto__kpi-value">{value}</div>
      <div className="auto__kpi-sub">{sub}</div>
    </div>
  );
}
