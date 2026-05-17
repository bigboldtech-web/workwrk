# WorkwrK — Internal Rollout Playbook

A six-week implementation path for a 5–50 person company starting from
zero. Built by the founding team for the founding team. Each section
tells you who does what, in what order, with the "if this breaks"
fallback.

> **TL;DR**: Don't turn on every module on day one. The rollout follows
> the daily-touch order: People → Inbox → Tasks → Performance → Money.
> Five weeks of structured turn-ons, one week of slack for fixes. Stop
> at any week and the system is still useful — there's no big-bang.

---

## Day 0 — Setup checklist (1–2 hours)

**Who:** The founder / operator (you).
**Goal:** A logged-in workspace with org, departments, roles, offices,
fiscal year, and one admin invited.

### Step-by-step

1. **Create the organization** via `/register`. Pick a slug that
   matches your domain (e.g. `cashkr`).
2. **Settings → General**:
   - Timezone (Asia/Kolkata for India, Asia/Dubai for UAE, etc.)
   - Currency (INR / AED / USD)
   - Fiscal year start month (4 = April for India; 1 = January for
     US-default)
3. **Settings → Branding**: upload your logo (square SVG or 512×512
   PNG). The sidebar mark + login screen pick it up automatically.
4. **Organization → Offices**: add every physical location. Mark one
   as Headquarters. Even single-office orgs benefit from one entry.
5. **Organization → Departments**: create the top 3-5 departments
   (Engineering, Sales, Operations, Finance, People). You can add
   sub-departments later.
6. **Organization → Roles**: for each department, create the 2-3
   roles you actually hire for. Mark levels (Employee / Team Lead /
   Manager / Director / VP / C-Level).
7. **Financials → Fiscal calendar**: create the current fiscal year.
   Periods auto-generate monthly. This unlocks Expenses, POs, and
   Statements.

### Common day-0 mistakes

- **Skipping offices.** Some downstream views (calendar, comp,
  people filter) group by office and look broken without one.
- **Too many departments.** Start with 3-5 and split later. 12
  departments on day one makes the org chart unreadable.
- **Fiscal year off-by-one.** If your FY starts April 1, the FY
  label is "FY2026" for the year ending March 2026. Confirm with
  finance before creating.

---

## Week 1 — Operator + 2 trusted users

**Who:** You + 1-2 co-founders / senior leads.
**Goal:** Find the obvious bugs before the rest of the team sees
them. Use Tasks daily. Approve one fake expense.

### Turn on

- People (just the three of you)
- Tasks (with one project per founder)
- Inbox
- Announcements (post one welcome message)

### Daily rhythm

1. Open Inbox each morning. Anything there?
2. Open Tasks. Drag a task to today.
3. Post one Announcement per real org update (funding, hire, deal
   close). Mark important ones "must-acknowledge" so people have to
   open them.

### Bugs to look for

- Notifications not arriving (check `/api/notifications` returns
  your row)
- Tasks not syncing between calendar + week views (refresh once;
  if persistent, check `/api/tasks` query)
- Cmd-K returning stale results (refetch on focus — already wired)

### What NOT to do this week

- Don't invite the whole team. The point of Week 1 is to catch
  the embarrassing stuff.
- Don't turn on Money or Talent. They depend on having real users.
- Don't set up integrations yet (Slack, Google Calendar). They add
  surface area to debug; first prove the basics.

---

## Week 2 — Whole team rollout

**Who:** Every employee.
**Goal:** Everyone signs in, completes their profile, sees their
inbox light up, gets the rhythm of WorkwrK as a daily-touch tool.

### Day 1 of the week

1. **Send invitations**: Settings → Team → Invite. Bulk-paste a
   list of emails. Pick the right access level per person (most
   people are `EMPLOYEE`; managers are `MANAGER`).
2. **Send a welcome announcement**: explain (a) what WorkwrK is,
   (b) what's expected of them this week (just sign in + look at
   their inbox + complete their profile), (c) where to get help
   (a Slack channel or Cmd-K → AI).
3. **Pin a top help SOP**: write a 5-step "Your first day on
   WorkwrK" SOP and mark it mandatory.

### Day 2-5

- People are exploring. Expect ~10-20% bounce — that's normal.
  Send a nudge on day 3.
- Encourage managers to post a Kudos to one teammate each day.
  Recognition seeds adoption faster than any onboarding flow.

### Turn on additionally

- Kudos
- Policies (upload your HR handbook as one big policy)
- Ideas (low-pressure way for ICs to engage)

### KPIs to watch

- **DAU/WAU ratio**: should be > 0.5 by end of week. If < 0.3,
  something is wrong with discoverability.
- **Profile completion**: % of users with avatar + DOB + manager
  set. Aim for 80% by end of week.
- **Inbox engagement**: % of inbox items that are clicked vs.
  ignored. < 20% means the items being surfaced aren't useful.

### What NOT to do this week

- Don't push performance reviews this week. They feel intrusive.
  Reviews come in week 3 when the team trusts the tool.
- Don't enforce SOP compliance metrics yet. Just publish SOPs and
  let people read.

---

## Week 3 — Performance ceremony

**Who:** Managers + ICs (Reviews and OKRs touch both).
**Goal:** The org has its first measurable cadence. KRAs assigned,
KPIs flowing, first OKRs cascading.

### Setup (do this first)

1. **Define your KRAs**: for each role family (Engineer, Account
   Manager, Sales Rep), define 3-5 KRAs.
2. **Define KPIs under each KRA**: 2-4 KPIs per KRA. Pick units
   carefully (deals closed, NPS, story points, etc.).
3. **Assign KRAs to people**: KRA-KPI → Assignments. Bulk-assign
   the role's KRAs to everyone in that role.
4. **Open the first OKR cycle**: OKRs → New cycle (Q1 / Q2 / etc).
   Company-level OKRs first, then teams cascade.

### Daily / weekly rhythm

- **Monday standup ritual**: review OKR check-ins from last week.
- **Mid-month KPI recording**: managers record actuals for their
  team using the MonthlyKpiRecorder.
- **Friday kudos**: keep the social proof of recognition going.

### Turn on additionally

- KRA & KPI
- OKRs
- Reviews (open the first 360° cycle)
- Time off (let people request leave through WorkwrK instead of
  Slack)

### Pitfalls

- **Too many KPIs per role.** Cap at 4. Six KPIs means nobody
  hits all of them, scores drift, system loses credibility.
- **OKRs that are tasks.** "Ship feature X" is a task. "Reach 100
  active customers" is an OKR. Coach the team.
- **Reviews scheduled before the team is comfortable.** Wait at
  least 6-8 weeks of normal usage before the first formal review.
  Use the recorder to track informally first.

---

## Week 4 — Finance + admin

**Who:** Finance / ops admin. Most ICs are unaffected.
**Goal:** Expenses flow through WorkwrK instead of email. POs route
through approval. First period close runs.

### Setup

1. **Chart of accounts**: Financials → Chart of accounts. Import
   from QB / Xero CSV or start with a 30-account default tree.
2. **Approval workflows**: Studio → Workflows → "Start from a
   template". Pick a template per entity type:
   - Expense > $5k: manager → org admin
   - PO > $25k: manager → director → org admin
   - Time-off > 5 days: 1-up manager
3. **Vendors**: Procurement → Vendors. Onboard your top 10
   suppliers. Net terms + contact + categories.
4. **First fiscal period close**: Financials → Calendar → close
   the prior month. Audit log captures the actor.

### Turn on additionally

- Expenses (let everyone submit; managers approve via Inbox)
- Procurement (vendors + POs)
- Financials (admin-only view — let people see Statements once
  you trust the data)
- Workforce Planning (FP&A teams)

### Watch for

- **Approval-fatigue spike.** When the team realizes everything
  routes through Inbox, the bell badge explodes. Counter-measure:
  turn on AI triage in the Inbox so common cases pre-decide.
- **Wrong approval chain.** Easier to fix in Studio than to live
  with — iterate template assignments based on the first week
  of real approvals.
- **Expense category sprawl.** Lock down to 8-12 categories at
  setup; let people request new ones as needed.

---

## Week 5 — Talent ceremonies

**Who:** HR + managers.
**Goal:** The talent ceremonies have a home. Onboarding instances
running for new hires, learning courses assigned, first comp cycle
planned.

### Setup

1. **Onboarding templates**: Talent → Onboarding → New template.
   Build one per role family with 8-12 steps (buddy assignment,
   IT setup, first task, first review with manager).
2. **Mandatory courses**: Talent → Learning → New course. Start
   with compliance basics (data privacy, harassment policy, code
   of conduct). Mark mandatory.
3. **Recruiting pipeline**: Talent → Recruiting → New job. Open
   your active reqs. Pull resumes into the candidate pool.

### Cadence

- **New hire flow**: when a hire is made, kick off their
  onboarding instance from the role's template. The new hire's
  inbox lights up with their checklist on day 1.
- **Quarterly comp cycle**: HR opens a cycle, managers propose
  changes, HR approves. All decisions audit-logged.
- **Talent grid every six months**: place every IC on the 9-box
  (performance × potential). Drives promotion / PIP conversations.

### Turn on additionally

- Onboarding
- Learning
- Recruiting
- Compensation
- Talent Grid

---

## Week 6 — Slack week

**Who:** Everyone.
**Goal:** No new modules. Fix what's broken. Listen to feedback.
Refine.

### What to do

- **Open feedback survey**: Culture → Surveys → "How's WorkwrK?"
  Single open question. Read every response.
- **Triage the bug backlog**: Use Ideas as the bug-report
  surface for the team. Tag them, prioritize, fix.
- **Refine the SOP library**: by week 6 you'll know which SOPs
  people actually open and which collect dust. Archive dust.
- **Tighten access levels**: now that you've seen real usage,
  some people probably need more / less access. Adjust.
- **Document workarounds**: for the few features that don't fit
  your workflow, write a SOP explaining the workaround. Future
  hires won't have to discover it.

### Don't

- Don't add new modules in week 6. Stability first. New modules
  resume in month 2.

---

## Ongoing rhythms

### Daily (5 minutes)

- Open Inbox. Decide / dismiss / snooze.
- Open Tasks. Drag today's tasks.

### Weekly (15-30 minutes)

- OKR check-in (KR owners update progress)
- Kudos (give one; nothing is more high-leverage)
- Review the team's KPI dashboard for anomalies

### Monthly (1-2 hours)

- KPI recording (managers for their teams)
- Period close (finance — locks the prior month's GL)
- Talent / engagement check (HR — look at pulse survey trends,
  kudos distribution, review-completion rates)
- Send a state-of-the-org announcement (operator)

### Quarterly (half-day)

- New OKR cycle (set company → team → individual objectives)
- Comp cycle (if you do them quarterly)
- Variance review (FP&A — plan vs actual on every account)
- Talent grid update

### Annually

- Full performance reviews (360° feedback cycle)
- Fiscal year setup for the next year
- Annual planning (Adaptive Planning)
- Strategic OKR cycle

---

## When things break — quick triage

| Symptom | First check | Fix |
|---|---|---|
| Inbox doesn't refresh | `/api/notifications` returns 200? | Hard refresh; cron might be paused |
| Sidebar shows `nav.xxx` text | i18n keys missing | `git pull`, rebuild |
| Cmd-K returns nothing | `/api/search?q=test` returns rows? | DB connection issue; check Prisma |
| Tasks DnD doesn't save | DevTools network tab on drop | `/api/tasks/reorder-day` 4xx? Check task ownership |
| Approval doesn't fire notification | Recent commit? | Check `prisma.notification.create` call in the decide route |
| Pay run fails to calculate | Payroll provider configured? | Check `PAYROLL_PROVIDER` env + `lib/payroll/provider.ts` |
| Org delete won't process | Cron running? | Cron requires `CRON_SECRET` + schedule on `/api/cron/org-hard-delete` |

---

## Cron schedule (for the ops team)

WorkwrK ships eight cron endpoints. Schedule them with whatever
scheduler your platform provides (Vercel Cron, GitHub Actions,
external scheduler). All accept `Authorization: Bearer $CRON_SECRET`.

| Endpoint | Schedule | Purpose |
|---|---|---|
| `/api/cron/announcements-publish` | `*/5 * * * *` | Publish scheduled announcements |
| `/api/cron/calendar-sync` | `*/15 * * * *` | Sync Google Calendar events |
| `/api/cron/email-queue` | `*/5 * * * *` | Drain queued email sends |
| `/api/cron/okr-reminders` | `0 9 * * MON` | Weekly OKR check-in nudges |
| `/api/cron/surveys-rotate` | `0 9 * * MON` | Rotate weekly pulse surveys |
| `/api/cron/webhook-retry` | `*/10 * * * *` | Retry failed webhook deliveries |
| `/api/cron/ratelimit-cleanup` | `0 * * * *` | Trim expired rate-limit rows |
| `/api/cron/org-hard-delete` | `0 * * * *` | Destroy orgs past 30-day grace |

Tasks.run-sla-check should also be scheduled (see
`/api/tasks/run-sla-check`) — every 15 minutes — for task
auto-escalation.

---

## Roles cheat-sheet

| Role | Sees | Does |
|---|---|---|
| `EMPLOYEE` | Home / Work / Culture (3 hubs) | Tasks, time-off, expenses, reviews of self |
| `TEAM_LEAD` | + People (read-only) | Approve own-team approvals |
| `MANAGER` | + People + Talent (5 hubs) | Reviews, comp proposals, hiring, KRA assignments |
| `HR` | + Talent admin tools | Run comp cycles, talent grid, onboarding templates |
| `DIRECTOR` / `VP` | Most surfaces | Strategic OKRs, dept-level financials |
| `C_LEVEL` | All hubs | Strategic + final approval |
| `COMPANY_ADMIN` | + Platform | All admin surfaces — billing, integrations, audit |
| `SUPER_ADMIN` | + cross-tenant Admin Console | Platform-level (you, the operator) |

Change these in Settings → Team → click a person → Access level.

---

## What's NOT in this playbook

- **Multi-entity consolidation**: schema and UI exist for single-org
  use; multi-entity rollup is a Phase 5 follow-up that needs
  `Organization.parentOrgId` + `IntercompanyJournal` schema.
- **Payroll**: Payroll integration is gated on picking a vendor
  (CheckHQ / Gusto Embedded / Finch). The UI is in place; wire the
  provider once you've signed.
- **Benefits**: Same gating — Sequoia or Plansource.
- **Performance budgets in CI**: not yet wired. Add Lighthouse CI
  when you start caring about per-route latency.

---

## Who to ask

- Product questions → Ibrahim (operator)
- Bug reports → Ideas board (tag `[bug]`)
- Feature requests → Ideas board (tag `[feature]`)
- AI questions ("how do I…") → Cmd-K → "Ask AI"
