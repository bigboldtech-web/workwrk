# System alignment — the master plan

2026-08-13. Grounded in a four-agent full-product inventory (workflow
wf_25e447ed-408 — every claim there carries file:line anchors). Decisions
locked with the founder:

1. **Unfinished apps show "Coming soon"** — honest labels, no dead boxes,
   nothing hidden.
2. **Build order optimizes daily drivers first** — the things the team
   touches every day must feel finished before breadth grows.
3. **Settings splits into two doors** — Admin (org) and Personal.
4. Every wave ends with documentation in documentation.ai (founder will
   connect its MCP) — document built things as they're confirmed, new
   things as they land.

The one rule that fixes the recurring disease, apply everywhere:
**a surface may only exist if its backend exists AND is wired — and a
backend earns a surface.** The inventory found five settings pages faking
data over real-or-absent backends, and six-plus real engines with no UI.

---

## Wave 1 — Daily drivers (the founder's pick: first)

### 1a. Notifications actually notify (P0)
The single biggest truth gap: **the real task system emits zero
notifications.** Assigning a task, changing its status, or a due date
arriving writes no Notification row (`/api/boards/[id]/items` POST and
`/api/items/[id]` PATCH create none). Meanwhile a complete bell popover
component, a desktop-notification hook with chime, and a notification
banner all exist as **dead code with zero imports**.

- Emit on the item pipeline: assigned / status changed / due today /
  mention — routed through the existing `shouldNotify`/`shouldEmail`
  prefs gates; flip the settings page's "Soon" chips live as producers land.
- Mount the existing bell popover on the topbar with an unread badge
  (today there is **no unread badge anywhere** in the app); 20–30s poll
  first, SSE later.
- Wire the existing `use-desktop-notifications` + chime to the reminder
  ticker and the poll (needs the one `Notification.requestPermission`
  call nothing ever makes today).

### 1b. Reminders that actually pop (P0 — the founder's explicit ask)
At fire time the ONLY visible thing is a 3.2-second toast. If you look
away, the reminder is gone (the bell shows only PENDING, so a fired
reminder vanishes from it instantly).
- Fire = persistent in-app popup (dismiss/snooze) + optional desktop
  notification + chime, not a toast.
- Bell gets a "Fired / history" section.
- **Register `/api/cron/reminders` on the prod box** — it is absent from
  CRON-SETUP.md and vercel.json, so closed-app users' reminders never
  fire in production at all. Same for `/api/email/send-reminders`.
- The ticker doesn't run in the /settings full-screen branch of os-shell —
  mount it above the fork.

### 1c. Quick tools finish line (P0/P1)
- **⌘T is browser-reserved** — Chrome never delivers it; pick ⌘J or
  similar and update every tooltip.
- Profile-menu "Personal Tools" rows with `href:null` (Quick task, My
  Work, Notepad, Reminder, Quick doc, Voice) **do nothing on click** —
  wire them to the same shell actions the topbar uses.
- Broken hrefs: Create Whiteboard → `/build` (wrong app), Create
  Dashboard → `/boards` (404), palette's "Create new Notepad" →
  `/notepad` (404).
- Voice-to-text: add "Save as note" + "Create task" (clipboard-only today).
- "Record a Clip" **doesn't record** — it's a transcript-paste tool with
  two duplicate menu entries. Either build capture (getDisplayMedia) or
  relabel honestly "AI Notetaker" and drop the duplicate.
- Command palette (⌘K): server search queries the LEGACY task table —
  **Items, Boards, Spaces, Docs-embeds, Whiteboards are unsearchable**;
  empty state is hardcoded fake people/spaces linking to 404s; ACTIONS
  rows are decorative. Rewrite search over the real graph, real recents,
  wire the actions.
- Presence/status is localStorage-only theater (nobody else can see it,
  expiry never checked, dot always green) — either a tiny presence API
  (User.statusEmoji/statusText/statusExpiresAt) or hide the affordance.
- Mute mutes nothing (only an avatar tooltip reads the flag) — persist
  `mutedUntil` server-side, consult it in reminder fire + email send +
  future badge/chime.
- **Topbar avatar initials are hardcoded "IS"** — same founder-name bug
  just fixed in the profile menu; derive from session.

### 1d. Board chrome honesty (P1)
Five inert buttons on every board title row — Filter, Reader mode,
Automate, Ask, Share — server-rendered with **no handler at all** (Space
and Folder pages repeat two of them). Wire Filter to the existing
FilterMenu, Automate to /automation/workflows (there is no board →
automation entry anywhere), Share to the existing share dialog; drop or
"Soon" the rest. Fix the Planner's hard Google-gate: the week grid
refuses to render without Google Calendar connected even though the
events API serves local tasks fine — make the gate a dismissible banner.

---

## Wave 2 — Settings, two doors (Admin + Personal)

Survey 4's verdict: settings match the product **in neither direction**.

### Kill the fakes first (P0 — some are security-adjacent)
- `/settings/api` **fabricates API keys in the browser** (Math.random,
  copied to clipboard as if real) while a production-grade `/api/keys`
  engine sits unused. Swap the page onto the real API.
- `/settings/audit` fetches a nonexistent endpoint and renders a
  hardcoded sample feed while real audit rows accumulate behind
  `/api/audit`. Rewire + hook up the existing export route.
- `/settings/identity` **save has been broken the whole time** (PATCHes a
  section the API rejects with 400). Fix the section name, add the org
  logo upload (API exists) and the company mission/vision editor (API
  exists, feeds AI KRA generation, zero UI).
- `/settings/calendar` demo-OAuth theater and the integrations
  marketplace's fake "installed" flags → honest "Coming soon" rows.
- Account → Security: MFA "Enable" is a toast though `/api/auth/mfa/enroll`
  exists; "2 active sessions" is hardcoded. Wire or remove.

### Admin door (org)
Members + Invitations (already solid) · **Org structure** (new: absorb
Functions/Roles/Offices + a read-only Levels explainer — the ladder is a
fixed enum, so explain it, show holder counts per level, don't fake
editability) · Permissions (trim the matrix to what's actually enforced —
today it advertises 16 modules while ~4 parallel hardcoded role ladders
govern the rest) · Security policy editor (backend exists, no UI) ·
Audit log · Billing · **Data & compliance** (new: UI over the existing
`/api/export/all` etc. — a compliance feature currently existing as dead
code) · **Defaults & locks** (new: one small page activates the fully
built, admin-unreachable OrgPreference defaults + lockedKeys system) ·
Scoring & reviews (already the flagship; extend with KRA category/weight
defaults) · Enterprise later (SAML/SCIM/webhooks/branding/BYOK — five
finished manager components sit unmounted in src/components/settings/).

### Personal door
Profile (+ password change eventually) · **Notifications merged** (two
overlapping pages with different storage today) · Appearance (unify the
accent list drift — the Appearance page still lacks the WorkwrK swatch
and falls back to mint) · Security posture.

### Functions & Levels (the founder's direct ask)
- Departments UI is **create-only**: no rename, no head assignment, no
  re-parent, no delete from the UI (endpoints exist unreachable), no
  merge (needs an API), no archive concept. Build the full CRUD +
  head-assignment on /people/departments and link it from the Admin door.
- Invite modal collects none of department/role/manager although the API
  accepts all three — every hire lands unplaced. Add the three pickers,
  and make accept-invite seed role-template weights (it uses flat even
  weights today, contradicting the weight model).

---

## Wave 3 — Performance layer close-out

- **SOPs "few things missing," found exactly**: the folders/tags taxonomy
  managers are BUILT but mounted nowhere (tag rename/merge impossible);
  no submit-for-review/approve flow though the statuses exist; the SOP
  shareToken column has no public viewer route. Mount, wire, ship.
- Reviews: appraisal-letter generator has zero UI callers (add the button
  on finalized reviews); calibration never writes TalentAssessment, so the
  9-box and review cycles are circularly disconnected — calibration gets
  the 9-box step, which also un-stubs Talent.
- KRAs/KPIs: qualitative KPI type has numeric-only recording; weight
  sums to 100 unenforced server-side; W/Q-key backfill decision.
- Goals: per-goal reminder opt-out; email escalation for stale check-ins.

## Wave 4 — Breadth honesty (Coming-soon + finish the half-baked)

Per the founder's "show with Coming soon" decision, each of these either
gets its missing half or an honest banner until it does:
- **Candor + Surveys (worst offenders)**: employees literally cannot
  respond and managers cannot see results — the respond/results endpoints
  have zero UI callers and the detail routes 404. Small builds: response
  form + results view + a real builder each.
- **Announcements**: the acknowledge button 404s from BOTH surfaces (ack
  vs /acknowledge endpoint mismatch — one-line fix), no composer, no
  "who hasn't acknowledged" view.
- **Assets**: "Add asset" is an inert button; POST/PATCH/DELETE unreachable.
- Kudos: org-values list (Settings) instead of free text; leaderboard API
  is orphaned.
- Policies/Agreements: overdue/reminder crons, signing order, PDF artifact.
- Docs: the board-embed block fetches a dead `/api/studio` endpoint.
- Coming-soon banner component: one shared primitive, used by Build,
  Store, calendar feeds, marketplace, Outlook connect, etc.

## Cross-cutting debts (tracked, scheduled opportunistically)
- Two "my team" definitions (getTeamUserIds vs getEffectiveReportTree).
- Four parallel role ladders vs the permission matrix — consolidate.
- Avatar uploads in public/uploads → gated storage.
- Legacy `prisma.task` vs `Item` (search, sprints, planner writes).
- Dead files to delete (app-shell.css, catalog-stub, doc-editor-dialog,
  column-type-picker, entity-timer, module-view chain, tags-manager).
- Prod cron table verification (CRON-SETUP.md vs actual aaPanel rows).

## Documentation (starts when the founder connects documentation.ai MCP)
Wave order mirrors the build: document Wave-1 surfaces as they're
verified, then each wave as it lands. Per module: what it is, how it
interconnects (the chain diagrams above), admin setup, end-user how-to.
