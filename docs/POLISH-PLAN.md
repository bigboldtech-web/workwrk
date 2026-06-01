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

- [x] /marketing — hub with campaign/content/event tiles
- [x] /marketing/[id] — campaign detail with metrics scoreboard
- [x] /marketing/campaigns — list with status pipeline
- [ ] /marketing/content — content calendar grid
- [x] /marketing/events — events list with date hero

## F. Service — ITSM + Helpdesk (collapsed: 12 → 8 pages)

**Scope decision (2026-05-30):** ITIL 6-process split (incidents/problems/changes/CMDB as separate pages) is enterprise-IT framing. Target market = Monday/ClickUp end-clients = SMB/mid-market. They need Tickets + KB; the rest is over-spec'd. Incidents and Problems kept as bespoke views (already built). Changes + CMDB dropped — users handle change mgmt in GitHub/Jira and assets in spreadsheets.

- [x] /itsm — service desk overview with SLA tiles
- [x] /itsm/[id] — ticket detail with timeline
- [x] /itsm/incidents — severity pills (kept; mature-IT use case)
- [x] /itsm/problems — problem-cause card view (kept; bespoke clusters)
- [~] /itsm/changes — **DROPPED** (collapse into ticket type=CHANGE)
- [x] /itsm/tickets — unified queue with multi-axis filters (priority + status + category)
- [~] /itsm/cmdb — **DROPPED** (enterprise IT only; revisit on customer demand)
- [x] /itsm/kb — KB article grid
- [x] /helpdesk — customer support overview (external = different from internal ITSM)
- [x] /helpdesk/[id] — chat-like ticket detail
- [x] /helpdesk/tickets — agent ticket queue with view tabs + multi-axis filters
- [x] /helpdesk/customers — customer cards
- [x] /helpdesk/macros — macro library

## G. People & HR (6 pages)

- [x] /people — directory with photo cards
- [x] /people/[id] — profile page hero (functional KRA/KPI/skills/etc. tabs preserved)
- [x] /people/departments — org tree view (with grid alternate)
- [x] /people/roles — role library with level chips
- [x] /people/skills — skill matrix with ring gauge + holder directory
- [x] /organization — org settings hub + hierarchy preview

## H. Time & Pay (15 pages)

- [x] /payroll — payroll run hero
- [x] /payroll/[id] — payroll run detail
- [x] /payroll/runs — historical runs ledger
- [x] /payroll/groups — pay group config cards
- [x] /payroll/payslip/[id] — printable payslip
- [x] /compensation — comp cycle list with status flow
- [x] /compensation/[id] — comp cycle hero (decision table preserved)
- [x] /benefits — hub grouped by benefit type
- [x] /benefits/plans — plan catalog with type filter
- [x] /benefits/oe — open enrollment wizard with checklist
- [x] /my-benefits — personal enrollment summary
- [x] /time-off — PTO tracker with approval queue
- [x] /time-off/policies — policy catalog cards
- [x] /timesheets — week log with approval flow
- [x] /clock — punch in/out hero (Section H complete)

## I. Performance & Goals (5 pages)

- [x] /reviews — featured cycle hero + cycles list
- [x] /reviews/[id] — bespoke cycle hero (tabs preserved)
- [x] /kra-kpi — KRA/KPI library grouped by category
- [x] /kra-kpi/review — bespoke header (functional review preserved)
- [x] /talent — 9-box matrix + segment lists

## J. Finance & Procurement (13 pages)

- [x] /financials — bespoke hub with KPI strip + statement tiles + period status
- [x] /financials/accounts — chart of accounts with KPI strip + search
- [x] /financials/entries — journal ledger with status filters + expandable lines
- [x] /financials/reports — statement launchpad with live aggregates + health pill
- [x] /financials/statements — P&L/BS/CF generator with period info + print
- [x] /financials/calendar — fiscal calendar with current spotlight + status filters
- [x] /expenses — submitter/approver list with KPI strip + status filters + inline actions
- [x] /expenses/[id] — bespoke hero with status flow + timeline + tag picker
- [x] /procurement — bespoke hub with KPI strip + status mix bar + workspace tiles
- [x] /procurement/[id] — bespoke hero with action row + 6-step flow + timeline
- [x] /procurement/pos — approval queue + 5-column pipeline + vendor chips
- [x] /procurement/invoices — AP queue with overdue banner + due-date buckets
- [x] /procurement/vendors — vendor master with KPI strip + sortable cards

## K. Knowledge (10 pages)

- [x] /sops — library grouped by category with KPI strip + status filters
- [x] /sops/[id] — wrap with .sopd (complex multi-mode editor preserved)
- [x] /sops/new — type picker with hue-coded cards (Written / Checklist / Recorded)
- [x] /sops/new/text — wrap text builder with OsTitleBar + nav chrome
- [x] /sops/new/checklist — wrap checklist builder with OsTitleBar + nav chrome
- [x] /sops/new/record — wrap recorder with OsTitleBar + nav chrome
- [x] /sops/my-sops — personal queue with KPI strip + status sections
- [x] /sops/compliance — KPI strip + dept heatmap + bottom SOPs / top performers / overdue
- [x] /process-runs — execution log with KPI strip + status sections + progress bars
- [x] /policies — library grouped by category with ack tracking + adoption bars

## L. Planning & Analytics (6 pages)

- [x] /planning — hub with KPI strip + workspace tiles
- [x] /planning/[id] — wrap with .pland (preserves shadcn spreadsheet editor)
- [x] /planning/plans — directory with KPI strip + type filters + fiscal year groups
- [x] /planning/variance — bespoke plan vs actual with KPI strip + favorable/unfavorable colouring
- [x] /analytics — cross-module pulse with three sections (Ops / People / Finance)
- [x] /workforce-planning — KPI strip + period tabs + per-period headcount/budget tables

## M. AI & Automation (4 pages)

- [x] /ai — prompt playground with hero input + curated templates + recent runs
- [x] /agents — bespoke marketplace (already polished — preserved)
- [x] /sidekick — chat polished
- [x] /autopilot — workflow rules with KPI strip + when-if-then flow cards

## N. Brand & Culture (4 pages)

- [x] /kudos — feed with KPI strip + value chips + reaction pills
- [x] /candor — sessions with KPI strip + privacy banner + launch/close actions
- [x] /announcements — broadcast feed with KPI strip + priority sections + ack action
- [x] /brand-guide — bespoke showcase with color swatches + type specimens + narrative

## O. Learning & Development (7 pages)

- [x] /learning — hub with KPI strip + workspace tiles + category breakdown
- [x] /learning/catalog — bespoke catalog with KPI strip + category groups
- [x] /learning/manage — admin table with KPI strip + completion bars
- [x] /learning/mine — personal queue with KPI strip + mandatory section
- [x] /onboarding — admin journey list with KPI strip + status sections
- [x] /onboarding/course/[id] — wrap with .onbc (preserves shadcn editor)
- [x] /onboarding/me — wrap personal journey with OsTitleBar

## P. Legal & Compliance (4 pages)

- [x] /legal — hub with KPI strip + alerts banner + workspace tiles
- [x] /legal/contracts — wrap with OsTitleBar + nav chrome (.lib body preserved)
- [x] /legal/privacy — wrap with OsTitleBar + nav chrome (.lib body preserved)
- [x] /legal/ip — wrap with OsTitleBar + nav chrome (.lib body preserved)

## Q. Product & Dev (6 pages)

- [x] /dev — hub with KPI strip + Sprint/Delivery sections
- [x] /dev/sprints — wrap with OsTitleBar (velocity strip preserved)
- [x] /dev/releases — wrap with OsTitleBar (timeline preserved)
- [x] /dev/roadmap — wrap with OsTitleBar (kanban preserved)
- [x] /build — AI apps catalog with KPI strip + status filters
- [x] /build/[slug] — wrap with .bldd (shadcn app renderer preserved)
- [x] /studio — board list rebuilt
- [x] /studio/boards/[slug] — wrap with .stbd (shadcn board canvas preserved)

## R. Workspace (9 pages)

- [x] /settings — category grid rebuilt
- [x] /settings/identity — bespoke org identity form (brand + locale + summary)
- [x] /settings/api — API keys table with KPI strip + scope chips
- [x] /settings/audit — feed with KPI strip + action filter chips
- [x] /settings/tags — tag manager with hue chips grouped by category
- [x] /settings/calendar — provider grid + active connections + sync indicator
- [x] /integrations — marketplace with category chips + connect/disconnect
- [x] /account/security — security score + posture checks + org policy
- [x] /assets — wrap with OsTitleBar (bespoke table preserved)

## S. Engagement & Tools (5 pages)

- [x] /surveys — pulse surveys with KPI strip + participation bars + launch/close
- [x] /redeem — points balance hero + reward catalog + redemption history
- [x] /store — marketplace (already polished — preserved)
- [x] /templates — workspace templates done
- [x] /tools — catalog with KPI strip + category groups + shared-cred chips

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
