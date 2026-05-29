# WorkwrK Polish Pass — Master Plan

Comprehensive page-by-page polish for the entire SaaS. Each page gets its own
domain-specific design that complements the system — no more "every page looks
the same" generic chrome.

## Per-page polish checklist

Every page subtask must pass this gate before being marked done:

- [ ] Bespoke header / page-specific intro copy (no generic "Loading…")
- [ ] Domain-specific action buttons via the new `actions` prop on `OsTitleBar`
- [ ] First-screen empty state speaks the page's actual use case + chips
- [ ] Spacing audit (sidebar, cards, popovers, form inputs, hover targets)
- [ ] Real data fetching states (skeleton or pulse, not silent loading)
- [ ] Hover / active / focus states for every clickable element
- [ ] Mobile / narrow-viewport behavior at 1024px and 768px
- [ ] Type-check + visual smoke test before marking done

---

## A. Chrome & alignment (foundation)

- [x] Sidebar — real icons, hover, org switcher
- [x] Topbar — icons + Sidekick CTA balance
- [x] OsTitleBar — drop generic Integrate/Automate, add `actions` slot
- [x] OsMainTable, OsTabs, OsFilterBar, OsEmptyView — chrome lift
- [x] OsCalendar — hover, focus states
- [x] Item drawer — floating card style
- [x] Workspace switcher popover spacing
- [x] Sidebar space-children spacing
- [x] Announcements popover — inline expand
- [ ] App rail (collapsible icon rail) — verify alignment + active state
- [ ] Command palette — polish results layout, keyboard hints
- [ ] Toast notifications — refine stack + animation
- [ ] All popovers (kudos, candor, notifications) — consistency audit

## B. Pinned / Daily-use (done)

- [x] /today, /inbox, /activity, /favorites, /sidekick, /files, /forms, /tables

## C. Work (next up — 13 pages)

- [x] /tasks — column header accent polish
- [x] /tasks/backlog — bespoke list view (priority + estimate columns)
- [x] /tasks/board — kanban polish with workload heatmap
- [x] /tasks/calendar — wire to OsCalendar with task-specific colors
- [x] /tasks/gantt — bespoke timeline (not generic chrome)
- [x] /tasks/sprint — sprint velocity card layout
- [x] /tasks/[id] — task detail bespoke layout
- [x] /meetings — agenda-first card grid
- [x] /meetings/[id] — meeting room layout with notes side panel
- [x] /docs — list (rebuilt)
- [x] /docs/[id] — doc editor (block polish done)
- [x] /whiteboards — board picker grid
- [x] /whiteboards/[id] — Excalidraw chrome polish
- [x] /notetaker — recording state with waveform
- [x] /ideas — voting feed style
- [x] /okrs — cascade tree first; current page is generic
- [x] /okrs/[id] — OKR detail with sparkline

## D. Sales / CRM (7 pages)

- [x] /crm — pipeline kanban-first
- [x] /crm/[id] — opportunity detail with deal scoreboard
- [x] /crm/pipeline — drag-drop with weighted ARR
- [x] /crm/accounts — account cards with logo
- [x] /crm/leads — lead routing list with score badges
- [x] /crm/activities — activity stream
- [x] /crm/reports — bespoke charts

## E. Marketing (4 pages)

- [ ] /marketing — hub with campaign/content/event tiles
- [ ] /marketing/[id] — campaign detail with metrics scoreboard
- [ ] /marketing/campaigns — list with status pipeline
- [ ] /marketing/content — content calendar grid
- [ ] /marketing/events — events list with date hero

## F. Service — ITSM + Helpdesk (12 pages)

- [ ] /itsm — service desk overview with SLA tiles
- [ ] /itsm/[id] — ticket detail with timeline
- [ ] /itsm/incidents — severity pills
- [ ] /itsm/problems — problem-cause card view
- [ ] /itsm/changes — change calendar
- [ ] /itsm/tickets — all tickets
- [ ] /itsm/cmdb — asset directory
- [ ] /itsm/kb — KB article grid
- [ ] /helpdesk — customer support overview
- [ ] /helpdesk/[id] — chat-like ticket detail
- [ ] /helpdesk/tickets — ticket queue
- [ ] /helpdesk/customers — customer cards
- [ ] /helpdesk/macros — macro library

## G. People & HR (6 pages)

- [ ] /people — directory with photo cards
- [ ] /people/[id] — profile page hero
- [ ] /people/departments — org tree view
- [ ] /people/roles — role library with level chips
- [ ] /people/skills — skill matrix
- [ ] /organization — org settings hub

## H. Time & Pay (15 pages)

- [ ] /payroll — payroll run hero
- [ ] /payroll/[id] — payroll run detail
- [ ] /payroll/runs — historical runs
- [ ] /payroll/groups — group config
- [ ] /payroll/payslip/[id] — printable payslip
- [ ] /compensation — comp plan list
- [ ] /compensation/[id] — comp plan detail
- [ ] /benefits — benefits hub
- [ ] /benefits/plans — plan cards
- [ ] /benefits/oe — open enrollment wizard
- [ ] /my-benefits — personal benefits
- [ ] /time-off — PTO tracker
- [ ] /time-off/policies — policy list
- [ ] /timesheets — timesheet log
- [ ] /clock — punch in/out hero

## I. Performance & Goals (5 pages)

- [ ] /reviews — review cycle hero
- [ ] /reviews/[id] — review detail
- [ ] /kra-kpi — KRA/KPI definitions
- [ ] /kra-kpi/review — KPI review cycle
- [ ] /talent — talent marketplace

## J. Finance & Procurement (13 pages)

- [ ] /financials — finance overview with statement tiles
- [ ] /financials/accounts — chart of accounts
- [ ] /financials/entries — journal entry list
- [ ] /financials/reports — financial reports hub
- [ ] /financials/statements — P&L + balance sheet
- [ ] /financials/calendar — financial calendar
- [ ] /expenses — expense report list
- [ ] /expenses/[id] — expense detail
- [ ] /procurement — procurement overview
- [ ] /procurement/[id] — PO detail
- [ ] /procurement/pos — PO list
- [ ] /procurement/invoices — invoice list
- [ ] /procurement/vendors — vendor master

## K. Knowledge (10 pages)

- [ ] /sops — SOP library with category tree
- [ ] /sops/[id] — SOP detail
- [ ] /sops/new — type picker
- [ ] /sops/new/text — text SOP builder
- [ ] /sops/new/checklist — checklist SOP builder
- [ ] /sops/new/record — video SOP builder
- [ ] /sops/my-sops — assigned SOPs
- [ ] /sops/compliance — compliance tracking
- [ ] /process-runs — process execution logs
- [ ] /policies — policy library

## L. Planning & Analytics (6 pages)

- [ ] /planning — business planning overview
- [ ] /planning/[id] — plan detail
- [ ] /planning/plans — plan list
- [ ] /planning/variance — variance analysis
- [ ] /analytics — analytics dashboard
- [ ] /workforce-planning — workforce forecasting

## M. AI & Automation (4 pages)

- [ ] /ai — AI assistant interface
- [ ] /agents — agent builder list
- [x] /sidekick — chat polished
- [ ] /autopilot — automation rules

## N. Brand & Culture (4 pages)

- [ ] /kudos — kudos feed
- [ ] /candor — anonymous feedback
- [ ] /announcements — announcement list (popover already done)
- [ ] /brand-guide — brand guidelines

## O. Learning & Development (7 pages)

- [ ] /learning — learning hub
- [ ] /learning/catalog — course catalog
- [ ] /learning/manage — course admin
- [ ] /learning/mine — my courses
- [ ] /onboarding — onboarding program
- [ ] /onboarding/course/[id] — course detail
- [ ] /onboarding/me — my onboarding

## P. Legal & Compliance (4 pages)

- [ ] /legal — legal hub
- [ ] /legal/contracts — contract repository
- [ ] /legal/privacy — privacy policies
- [ ] /legal/ip — IP & trademark

## Q. Product & Dev (6 pages)

- [ ] /dev — dev hub
- [ ] /dev/sprints — sprint planning
- [ ] /dev/releases — release management
- [ ] /dev/roadmap — product roadmap
- [ ] /build — workflows hub
- [ ] /build/[slug] — workflow detail
- [x] /studio — board list rebuilt
- [ ] /studio/boards/[slug] — board canvas

## R. Workspace (9 pages)

- [x] /settings — category grid rebuilt
- [ ] /settings/identity — identity form
- [ ] /settings/api — API keys list
- [ ] /settings/audit — audit log feed
- [ ] /settings/tags — tag manager
- [ ] /settings/calendar — calendar integrations
- [ ] /integrations — third-party integrations
- [ ] /account/security — security settings
- [ ] /assets — digital assets

## S. Engagement & Tools (5 pages)

- [ ] /surveys — survey list
- [ ] /redeem — reward redemption
- [ ] /store — reward marketplace
- [x] /templates — workspace templates done
- [ ] /tools — embedded tools

## T. Public marketing site (30+ pages)

- [ ] / — homepage
- [ ] /pricing — pricing page
- [ ] /features + 12 feature category pages
- [ ] /industries + 7 industry pages
- [ ] /blog + article template
- [ ] /careers + job template
- [ ] /contact, /demo, /help-center, /faq, /changelog
- [ ] /compare, /partners, /customers, /developers, /security
- [ ] /privacy, /terms, /cookies, /do-not-sell

## U. Auth & onboarding (9 pages)

- [x] /(auth) layout — proof pane rebuilt
- [ ] /login — form polish
- [ ] /register — form polish
- [ ] /forgot-password
- [ ] /reset-password
- [ ] /verify-email
- [ ] /welcome
- [ ] /onboard — wizard polish
- [ ] /setup — initial setup

## V. Admin panel (5 pages)

- [ ] /admin — admin overview
- [ ] /admin/analytics — system analytics
- [ ] /admin/appsumo — AppSumo integration
- [ ] /admin/companies — multi-tenant company mgmt
- [ ] /admin/companies/[id] — company detail

---

## Status snapshot (2026-05-29)

- ✅ **Done:** ~28 surfaces (Chrome + Pinned + a handful of module pages)
- ⏳ **Remaining:** ~165 dashboard + 30 marketing + 8 auth + 5 admin = **~208 page-level subtasks**
- 4 chrome items still open

## Execution rules

1. **One page at a time** — no rushing. Each page lands on its own commit.
2. **Each page = its own bespoke design** that fits the use case, not a copy of the generic chrome.
3. **Verify alignment + spacing** before moving on. Sidebar nav spacing, card gaps, popover padding all matter.
4. **Mirror to BlitzIt** when the MCP connection cooperates — this markdown is the source of truth in the meantime.
