# WorkwrK — Product Vision

> Last updated: 2026-05-19. This is the north-star doc. The BlitzIt list "WorkwrK · SaaS build-out" is the operational backlog.

## One line

**WorkwrK is the operating system Workday won't sell you** — a single, AI-native platform for 50–500 person companies that runs HR, work execution, performance, knowledge, finance, and engagement in one place, instead of stitching together 12 vendors.

## One paragraph

Mid-market companies today need ~12 tools to function: monday.com or ClickUp for work, Lattice for performance, Gusto for payroll, Justworks for benefits, BambooHR for HR, Notion for docs, Greenhouse for hiring, Expensify for expenses, QuickBooks for finance, Lansweeper for assets, plus a handful of point tools for surveys, kudos, comp, time-off, and meetings. Each is a separate login, a separate data silo, and a separate vendor relationship. WorkwrK collapses all of that into one product, with one data model, one navigation, one search box, and one AI assistant that actually understands the whole company. We price below the sum of what they replace, deploy in days not months, and use Workday's playbook (cohesion, depth, configurability) without Workday's price tag, implementation cost, or partner sprawl.

## The problem

Mid-market is stuck between two bad options:

1. **Go upmarket** — buy Workday/SAP/Oracle. Gets cohesion and depth, but costs $200K+/yr, takes 6-12 months to implement, requires consultants, and the UX is from 2008.
2. **Stitch SaaS** — buy monday + Lattice + Gusto + Notion + ... . Gets modern UX in each tool, but you now have 12 vendors, 12 logins, 12 data models, 12 places kudos can live but only one place they actually do. Reporting across tools is impossible. AI in any one of them is dumb because it can't see the others.

WorkwrK is the third option: **modern UX AND cohesion**, priced for SMB, native AI across everything.

## Who it's for

- **Primary:** 50–500 employee companies. Mostly US/India to start. Tech, services, healthcare, logistics, manufacturing.
- **Secondary:** Companies smaller than 50 that are growing fast (so they buy something they won't outgrow).
- **Out of scope (for now):** Enterprise (5000+), regulated industries needing FDA/SOX automation, US public sector.

## The roles

WorkwrK is built for these user types. Every page should answer "who is this for" and "what do they need to do here":

| Role | Primary value | Daily surface |
|------|---------------|---------------|
| **Employee** | Get my work done, see my growth | Tasks, OKRs, kudos, time-off, payslips, my profile |
| **Manager** | Run my team — performance, capacity, growth | Reviews, 1:1s, team OKRs, workload, approvals |
| **Department head** | Run a function — hire, plan, deliver | Workforce planning, KRA/KPI dashboards, budgets, analytics |
| **HR / People Ops** | Run the people side of the business | Onboarding, comp cycles, benefits OE, payroll, compliance |
| **Finance / Ops** | Run the money side | Budgets, GL, expenses, procurement, financials |
| **Founder / CEO** | See everything, make decisions | Dashboard home, company OKRs, P&L, headcount plan |
| **Admin / IT** | Configure, secure, integrate | Settings, SSO, SCIM, audit log, integrations, assets |

## Operating model — how a company uses WorkwrK day to day

A typical week through WorkwrK:

- **Monday morning** — Employee opens Dashboard home, sees their OKRs, this week's tasks, kudos they got, a pulse-survey prompt. Manager opens Inbox, approves pending time-off + expense + comp decision in one queue.
- **Tuesday** — Manager runs a 1:1 in /meetings, agenda template pre-loads OKR check-in + recent kudos + last action items. New action items auto-spawn into Tasks.
- **Wednesday** — Department head opens KRA/KPI page, sees the monthly scorecard, drills into a missed KPI, AI surfaces "3 SOPs related to this metric haven't been run in 60 days."
- **Thursday** — HR opens /reviews, runs calibration session on screen. PDF exports go out. Cycle closes.
- **Friday** — Founder opens Analytics, sees company-wide OKR progress, mood pulse, headcount-vs-plan, runway. Posts a kudos to the whole company.
- **Weekend** — Nobody touches the app. As designed.

## The modules (full surface area)

We organize WorkwrK into **6 module families**. Every feature lives in one of these. New ideas that don't fit a family are flagged — they either need a new family, or they don't belong.

### 1. WORK — tasks, projects, processes

Compete with: **monday.com, ClickUp, Asana, Notion projects**.

- **Tasks** — multi-view (list, board, calendar, gantt, day, timeline, workload, map). Custom fields, labels, statuses, priorities, dependencies, subtasks, recurring, files, comments.
- **SOPs** — process documentation with folder tree, tags, versions, access control, compliance tracking. SOPs spawn process runs (checklists).
- **Process runs** — execution-tracking instances of SOPs. Audit trail per step.
- **Docs / Knowledge Base** — collaborative pages, page tree, mentions, embeds, search, backlinks. Distinct from SOPs (less structured).
- **Meetings** — calendar, agenda templates (1:1, standup, retro), collaborative notes, action items that spawn tasks.
- **Forms** — intake forms → auto-create items in any module (requests, applications, feedback, tickets).
- **Whiteboards** — Miro-like infinite canvas with shapes, sticky notes, connectors.
- **Mind maps** — quick brainstorm visualization.
- **Sprints** — agile boards with velocity, burndown, sprint planning.
- **Workload view** — capacity per person/team across tasks + projects.
- **Brand Guide** — visual asset hub (logos, colors, fonts, voice).

### 2. PERFORMANCE — goals, reviews, growth

Compete with: **Lattice, 15Five, Culture Amp, Workday Talent**.

- **OKRs** — 3-level (company → team → individual), check-ins, alignment view.
- **Goals** — personal annual goals, separate from OKRs (Workday-style).
- **KRAs / KPIs** — Key Result Areas with monthly KPI scorecards, manager notes.
- **Reviews** — review cycles, self-assessment, manager review, peer feedback, calibration sessions, PDF export.
- **Talent / 9-box** — performance + potential grid, succession planning, growth plans.
- **Performance Scores** — composite scoring across OKRs + KPIs + reviews.

### 3. PEOPLE — HR, comp, benefits, payroll, time

Compete with: **BambooHR, Gusto, Rippling, Justworks, Workday HCM**.

- **People directory + profiles** — career timeline, OKRs, kudos, skills, certs, reports-to chain.
- **Organization** — visual org chart, departments, roles, offices.
- **Onboarding** — step-by-step wizard for new hires, template designer for HR.
- **Time tracking** — clock punch (with geo), timesheets (weekly grid), approval flows.
- **Time-off** — request, approval, balance accruals (PTO/sick/personal), team calendar.
- **Compensation** — comp cycles, manager decisions, budget pools, salary bands, audit log.
- **Benefits** — plan catalog, open enrollment wizard, dependents, life events.
- **Total Rewards Statement** — per-employee summary of salary + bonus + equity + benefits value.
- **Payroll** — pay groups, pay run preview, payslip viewer, earnings/deductions config.
- **Expenses** — receipt OCR, submission, approval, mileage, reimbursement.

### 4. ENGAGEMENT — kudos, surveys, ideas, announcements

Compete with: **Bonusly, Culture Amp, Officevibe, Lattice Engagement**.

- **Kudos** — public recognition feed, emoji reactions, company value alignment.
- **Candor** — anonymous feedback sessions (text, rating, start-stop-continue).
- **Pulse Surveys** — periodic mood/engagement check.
- **Ideas** — submission board, voting, status workflow, reward fulfillment.
- **Announcements** — rich-text, scheduled publish, segmented, must-acknowledge.
- **Employee of the Month** — recognition program.

### 5. FINANCE — budgets, GL, procurement, planning

Compete with: **QuickBooks Online, Xero, NetSuite SMB, Adaptive Planning**.

- **Budgets** — plan vs actual, driver-based modeling, scenarios.
- **GL accounts + journal entries** — chart of accounts, period close.
- **Invoices + POs** — accounts receivable, accounts payable, vendor management.
- **Procurement** — requests, multi-level approval, vendor directory, contracts.
- **Workforce planning** — headcount plans, scenarios, plan-vs-actuals, ties to recruiting.
- **Financial reports** — P&L, balance sheet, cash flow.
- **Assets** — IT inventory, assignment, lifecycle (in-stock → assigned → returned → retired).

### 6. RECRUITING & LEARNING — hire, develop, retain

Compete with: **Greenhouse, Ashby, Lessonly, TalentLMS**.

- **Recruiting** — job board, candidate pipeline (kanban), interviews, scorecards, offers.
- **Learning** — course catalog, lesson player (video/text/quiz), enrollment, certificates.
- **Skills + Certifications** — per-employee, ties to growth plans.

### Cross-cutting platform

- **Inbox** — unified notification + approval workflow. Everything-as-stream.
- **Dashboard home** — role-aware widget grid.
- **Analytics** — role-aware dashboards across all modules.
- **Custom dashboards** — drag-drop widget builder per user/team.
- **AI assistant** — chat + inline AI actions (sparkle button on forms). Reads company context.
- **Global search (Cmd+K)** — search across all modules.
- **Custom fields v2** — text, number, date, select, person, tag, formula, mirror, lookup.
- **Workflows / Studio** — visual workflow builder (trigger → conditions → actions).
- **Custom report builder + reports library** — schedule, export.
- **Spaces** — modular workspace per team (HR space, Sales space, etc.).
- **Chat** — native team chat / DMs.
- **Email integration** — send / receive email inline against items.
- **Files repository** — central file storage with permissions.
- **Audit log** — every change tracked, compliance view.
- **API + Webhooks + SCIM + SSO** — platform extensibility for IT.

## Design principles

1. **One product feel** — same primitives (cards, buttons, tables, empty states) everywhere. A user who learns Tasks should not have to relearn Reviews.
2. **AI-native, not AI-bolted** — the AI assistant reads context from all modules. Inline sparkle actions, not a separate chat tab.
3. **Inbox is the homepage** — every approval, mention, assignment, and announcement aggregates into one queue. Daily-use is the Inbox, not the dashboard.
4. **Mobile is real** — clock-in, time-off, kudos, approvals are usable on phone. Not all modules need mobile-first, but the high-frequency ones do.
5. **Configuration over customization** — admins configure (custom fields, workflows, statuses, approval chains); they don't write code.
6. **Cohesion over completeness** — better to ship 80% of a module that feels like the rest of the product, than 100% of a module that feels like a bolted-on third-party.
7. **No partner dependencies for the core** — Payroll, Benefits, Comp are in-house, not 3rd-party-shelled. Third-party connectors are demand-driven only.
8. **Defaults that work** — every empty state has a "create your first" CTA. Every new org gets seed data and an onboarding tour.

## Build philosophy

- **Phases 0-3 done** — base modules wired, basic UX, models in place. **122 Prisma models. ~110 API domains. ~40+ dashboard pages.**
- **Now (Phase 6): cohesion + polish** — bring every module to screenshot-ready quality. Make it feel like one product.
- **Phase 5 in parallel** — in-house Payroll/Benefits/Financials depth. These were the hardest "build whole product" calls; they're in scope but lower priority than cohesion.
- **Third-party integrations: demand-driven** — Slack/Teams/Salesforce/Jira connectors get built when paying customers ask. The QB/Xero OAuth scaffold from 2026-05-16 is shelved until needed.
- **Marketing screenshots come from the real product** — no fake mocks. The marketing site gets a screenshot pass AFTER the polish phase, not before.

## Competitive positioning

| | monday.com | ClickUp | Workday | **WorkwrK** |
|---|---|---|---|---|
| **Work execution** | ✅ best-in-class | ✅ best-in-class | ❌ none | ✅ matches |
| **Performance (OKRs, reviews)** | ⚠️ basic | ⚠️ basic | ✅ deep | ✅ deep |
| **HR (people, comp, benefits, payroll)** | ❌ none | ❌ none | ✅ deep | ✅ in-house |
| **Engagement (kudos, candor)** | ❌ none | ❌ none | ⚠️ basic | ✅ native |
| **Finance / planning** | ❌ none | ❌ none | ✅ deep | ⚠️ in-progress |
| **AI** | ⚠️ bolted-on | ⚠️ bolted-on | ⚠️ bolted-on | ✅ native + cross-module |
| **Mid-market price** | ✅ | ✅ | ❌ enterprise only | ✅ |
| **Implementation time** | Days | Days | 6–12 months | Days |

**The one-line pitch in their words:**
- To a monday.com prospect: "monday plus everything that runs people and money, one login."
- To a Workday prospect: "Workday for your size, deployable in a week, with the UX of monday."
- To a 100-person CEO: "Stop paying for 12 tools. Pay for one. Your team will thank you."

## Roadmap (concrete)

- **Q2 2026** — cohesion phase. Bring every existing module to screenshot-ready. Build the remaining stubs (Inbox, AI wire-up, Meetings, Brand Guide, Docs, Learning, Compensation, Benefits, Payroll, Expenses, Assets, Recruiting, Workforce Planning, Financials, Procurement).
- **Q3 2026** — competitor parity features. Forms, whiteboards, mind maps, chat, sprints, workload view, custom dashboards, custom report builder.
- **Q4 2026** — marketing capture + launch. Real screenshots replace all marketing mocks. AppSumo / PH launch. First 100 paying customers.
- **2027** — depth phase. Adaptive planning, custom field formulas, workflow studio v2, deeper analytics, mobile app.

## What this doc is not

This doc is the **vision**. It's not the task list (that's BlitzIt), the schema (that's `prisma/schema.prisma`), or the API contract (that's the code in `src/app/api/`). When this doc and reality disagree, fix the doc OR fix reality — don't let them drift.
