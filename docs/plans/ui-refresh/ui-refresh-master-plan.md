# WorkwrK UI refresh: master plan

Phase 3 canon, 2026-09-12. This is the plan engineers build from. It sits above the 17 unit specs and below the three decided documents.

**What decides what, when two documents disagree:**

1. `design-system.md` decides **look**: tokens, sizes, components, motion, the page header stack, the takeover chrome.
2. `access-model-spec.md` decides **access**: org roles, object roles, precedence, the share dialog, the denial convention, the `APP_RULES` table.
3. `settings-architecture.md` decides **settings structure**: which settings exist, where each lives, how each persists, the two doors, the redirect targets.
4. Below those three: `route-disposition.md` (every URL), `naming-canon.md` (every label), `back-map.md` (every back target), `sidebar-map.md` (every row), `consistency-report.md` (every cross-unit conflict, already resolved).
5. The 17 unit specs carry the detail for their own routes, written to `spec-template.md`.

Nothing in this plan re-opens a decision those documents already made.

---

## 1. Executive summary

We are not restyling WorkwrK. We are giving it one frame, one set of words, one way in and one way back, so a business can put a new person in front of it on their first morning and not train them.

Today the product photographs as a competitor and behaves like four products stitched together. The audit found, with file and line evidence, that the left rail does not follow the page you are on (it follows a value saved in your browser), that 17 apps and about 25 pages have no way in at all, that roughly 40 pages render an Ask AI, Share and Invite button trio that does nothing and a row of invented teammate faces that belong to nobody, that five different visual systems and five different loading spinners coexist, that one destination can carry four different names, that half the settings a person can change never save, and that a dozen core flows are broken from end to end: the marketing Start free button 404s, kudos cannot be given, a timesheet cannot take an hour, a spreadsheet column cannot be named, a public form bounces a customer to a login page.

The refresh fixes all of it in one ordered pass, and it changes the feel of the product in three visible ways.

**A navy frame around a white page.** The rail and the top bar become one calm navy chrome with the four dots at the top; everything a person acts on sits on a white page inside a bordered card. That is the Zoho reading you endorsed. It is one CSS attribute away from a white frame if you prefer it after seeing it.

**One page pattern, everywhere.** Title, then the saved views as text pills, then one toolbar with Filter and Sort on the left and exactly one blue Create button on the right. Lists, Boards, Docs, Tables, People, SOPs, Goals: the same three rows in the same order. Learn one page and you have learned all of them. One blue thing per page is the rule that makes the next step obvious without a tour.

**Nothing on screen that does not work.** Every button has a handler, every setting saves, every page has a back target, every list has six honest states (loading, empty, error, view only, no access, signed out), and every destination has exactly one name in the sidebar, the page title, the breadcrumb, search, notifications and email.

The scale: **189 product URLs** are ruled on, one row each. 123 keep their address and are rebuilt, 19 are new, 37 permanently redirect into a page that already does their job, 1 merges, 9 are removed and every one of them names where its destination went. Nothing a customer can reach today becomes unreachable. On top of that, **40 marketing pages** are rebuilt last, on the same tokens.

The order of work is deliberate and it protects the business. Tokens and the frame first, because every screen inherits them. Then the Work hub, because that is where people spend the day. Then knowledge, then time, then talk, then data, then people, then AI. Settings and the access surfaces after that, because they are the pages a customer opens once a quarter and because the access engine underneath them has to run for a week in parallel with the old one before anything flips. The marketing site last, so the site sells the product that actually exists.

Two promises run through every phase. **No save or load path changes blind**: the autosave contract is presentation only, the access flip runs behind a flag next to the old resolver until a week of runs shows zero unexpected differences, and every schema step is an idempotent SQL file with row-count assertions and a dry run. And **no second dev server or production build runs beside your `pnpm dev`**.

Each phase ships on its own and leaves the product working. You can stop after any one of them.

---

## 2. The principles every screen obeys

These are from the design system preamble. They are testable. A screen that breaks one is wrong, not "a different style".

1. **One blue thing per page.** `#0073EA` appears as the single Create button, links, focus rings, checked controls, toggles that are on, progress fill, the active view icon and the selected row wash. Never on the frame, never on headers, tabs, group bars, icons at rest or illustrations. While a drawer or modal with its own primary is open, the page's primary is not rendered at all; it comes back on close.
2. **The frame is not the work.** Rail and top bar are navy. Everything a person acts on sits on a white page inside a bordered card. The only saturated object in the frame is the four-dot logo. The active hub is a white pill on navy, the brightest thing on screen, so "where am I" needs no training.
3. **One page pattern.** Title row 48, saved views as text pills 36, one toolbar 44. Filter, Sort and the view switcher on the left; the one blue Create on the right. The views row does not render when a surface has one view. No second location bar, ever: location lives in the top bar breadcrumb.
4. **Records, not spreadsheets.** Data lives in a white card with hairline rows, a checkbox column, an inline header filter, a pinned column-settings icon and a footer that says how many records there are and which ones you are looking at. That is the model an SMB user already has from Zoho, Excel and their bank.
5. **One rhythm per surface, and a height budget inside it.** Navigation rows are 36. Data rows are 44 Comfortable (the default), 36 Cozy or 32 Compact. Nothing inside a row is taller than the row minus 12. Two-line content goes to the drawer, not into a row.
6. **Weight and grey before size.** Page title 22, rows 15, body 14, meta 12 and 13. Emphasis is 500 weight; de-emphasis is grey. Never 700 in the product. At most three sizes on screen at once.
7. **Colour never travels alone.** The only yellow, red and green in the product are success, warning and danger, plus the presence and unread dots. Every semantic colour sits beside a word or a glyph. Status chips are pale by default. There is no generic green variable to reach for; that is how the rule enforces itself.
8. **Progressive disclosure with a named door.** Four task fields visible by default (Status, Assignee, Due date, Priority) and "+ Add field" for the rest. Display options live in the toolbar "…" menu. Whole capabilities are off per org in Settings, Apps and modules. Anything not built yet hides behind "Show upcoming features", never as a greyed row.
9. **Detail opens beside the list.** Tasks, table rows and people open in a 520 drawer that carries the object's own URL, so Copy link always works. The list dims to 92 percent and stays scrollable. Expand grows the drawer into the full page in place. Docs, SOPs, goals and review cycles are pages.
10. **Feedback is quiet, reversible, and loud only when it matters.** A neutral toast bottom left with one Undo. Never a green success banner. But saving is never silent: the autosave dot pulses while saving, turns green on saved, and turns red with the words "Not saved, retrying" on failure.
11. **Empty is quiet.** A grey four-dot line drawing, one sentence, at most one text link. The page's blue button stays the only primary. No second call to action, no mascots.
12. **Icons carry words.** Rail icons are labelled. Icon-only buttons carry a tooltip and an accessible name. At most two icons per row. One icon per concept across the whole app.

Four rules the audit forced, which sit at the same level:

13. **Navigation is derived from the URL.** The hub that lights up and the sidebar row that carries the pill are pure functions of the address. Nothing is remembered, nothing is sticky. Paste a link into a chat and the person who opens it sees exactly what you see.
14. **A control the role cannot use is not rendered.** Never greyed, never a button that 403s. View-only surfaces render values as text at the same position and size the control would have occupied, under one slim banner.
15. **Every route answers six states**: loading (skeletons, never a full-page overlay), empty, error (one sentence plus a working Try again), view only, no access (one of exactly three denial shapes), and signed out or offline.
16. **One label per destination**, spelled identically in the sidebar row, the page title, the last breadcrumb crumb, the search result, the Create menu, the notification and the email. A row label that differs from its page title is a bug.

---

## 3. Decisions for the founder

Consolidated from the open decisions in the design system, the access model, the settings architecture, the marketing concept, the Phase 2 inputs and all 17 unit specs. Each has one recommendation. Every one has a default already built into the specs, so nothing stops if an answer is slow. The two marked **blocking** hold up a specific step.

### 3.1 Look and feel

**D1. Navy frame or white frame first? (blocking for the shell PR)**
Options: navy chrome by default with the white flip as a later preference · white chrome by default with navy as the preference · both exposed on day one.
**Recommend: navy first.** It is what the Zoho screenshots show, it is the single strongest move away from photographing like monday, the four dots on navy are the moment that is ours, and the opening splash and the frame become the same surface. Both variants are fully tokenised in the same CSS change, so the white flip is one attribute. Exposing both on day one means four chrome states to test at once; we would rather test one, show you, then expose the switch.

**D2. Does "crazy simple" beat the exact-ClickUp-parity mandate for the frame? (blocking for the page header)**
Options: yes for shell, header stack, view tabs, group headers, settings, empty states and menus, with List, Board, Calendar, Gantt and task detail restyled but not restructured · no, keep ClickUp's location bar and underline tabs · yes for everything including the five protected screens.
**Recommend: yes, with the five protected screens restyled and not restructured.** This is the one answer the header stack cannot ship without. If parity keeps the location bar the stack becomes four rows and the one-page-pattern rule dies.

**D3. Default row height.**
Options: Comfortable 44 · Cozy 36 · Compact 32.
**Recommend: Comfortable 44** for Lists, Boards, People and doc lists, with Compact 32 as the Tables default. It is the calm you called clean. All three ship together as a preference and an org default, so this is reversible from Settings without touching a token.

**D4. One brand blue, or keep the accent picker.**
Options: one blue, both accent pickers deleted · keep a reduced accent list without the purple family.
**Recommend: one blue, pickers deleted.** The accent picker contradicts the single-accent rule, half its entries are purple family which the brand palette forbids, `#0073EA` is hard coded in more than 20 shell files so the picker already does nothing there, and every extra accent doubles dark-mode testing. The personalisation lever becomes Theme, Chrome and Density, which are three things people actually want.

**D5. Type family.**
Options: Inter · keep Figtree.
**Recommend: Inter.** Blue plus Figtree plus grey is literally monday's recipe. Seven font families are loaded today; we drop to two. The size scale works either way, so this costs nothing if you disagree.

**D6. The mission and values splash.**
Options: every app open (today) · first open each day plus after login, skippable · non-blocking line only.
**Recommend: first open each day, 1.2 seconds, skippable.** It keeps the mission moment you asked for and stops being a toll gate on every navigation. Both behaviours are built; this is one default value in Settings, Identity and culture, which you can change yourself.

**D7. Dark mode in the first release.**
Options: light only until the navy frame has been reviewed in dark · dark on from day one.
**Recommend: light first.** Dark is a real user mode today and stays behind the existing preference; we review the near-black frame with you once, then enable it. Marketing stays light only either way.

**D8. Space and Folder icon colours.**
Options: neutral tiles only · neutral by default with eight muted colours opt in.
**Recommend: neutral by default, eight muted colours opt in.** Hue-keyed trees are the biggest source of visual noise in the product today. The eight are verified for contrast in light and dark, and none of them can be mistaken for done, at risk or blocked.

### 3.2 Product shape

**D9. What a new Space starts as.**
Options: open to everyone at Can edit · private but findable.
**Recommend: open to everyone at Can edit, and Spaces findable by name.** A three-person company should never have to share anything with itself. A new hire can see that a Space exists and ask for it. One switch called Lock it down flips the whole workspace to private for a corporate buyer.

**D10. Who may invite Members.**
Options: Owners and Admins only · any Member with a company email address.
**Recommend: Owners and Admins only.** Members cost seats. Guests are free and any Full access holder can bring one in. Revisit if a 20-person pilot shows friction; it is one value on one setting, not a new role.

**D11. Admin separation of duties.**
Options: none, the Owner holds billing and security · two delegable scopes per Admin, Billing and Security · four scopes.
**Recommend: two scopes, hidden inside the Admin row's menu, default off.** A 300-person firm gets a billing admin without a permissions editor. A 20-person firm never sees it.

**D12. Ship Can comment in the first release.**
Options: yes, four object roles (Full access, Can edit, Can comment, Can view) · defer, three roles.
**Recommend: yes.** Client-review businesses ask for it first, the Docs sharing modal already promises it today, and adding a rung later is harder than shipping it now.

**D13. Who can restore from Trash.**
Options: every Member restores what they deleted or hold Full access on, Owners and Admins see the whole workspace trash and purge · Owners and Admins only.
**Recommend: every Member over their own.** A Member who deletes their own List by mistake must not need an admin to get it back. Permanent deletion stays with Owners and Admins.

**D14. Settings: one door or two.**
Options: two doors, My settings and Workspace settings, sharing one full-screen takeover · one takeover with four groups.
**Recommend: two doors.** The gate, the registry and the search are identical either way; merging the two sidebars is a day of work whenever you want it. "Settings for me" and "settings for the company" is a sentence every employee already understands, and it keeps a Member from ever landing on a page full of locks.

**D15. Is Forms part of the core product, or does it come with the Tables module?**
Options: core, every workspace gets forms · gated on Tables, which new workspaces have switched off.
**Recommend: core.** The packaging decision of 2026-08-28 lists Forms under Core and Tables under Premium, while the access table currently gates it. A form that collects a job application or a client brief has nothing to do with spreadsheets, and a new workspace with forms switched off will read as missing. This is one cell in the access table plus one clause about what a form is attached to. Default if unanswered: the access table's gated version ships.

**D16. Can a person without an account submit a public form?**
Options: yes, through one per-form switch, default off, turned on only by a Full access holder, with a confirm and an audit row · no, signing in is always required.
**Recommend: yes, through that one switch.** Public form links are what customer intake actually means. The switch grants exactly "can answer this one form" and never grants sight of the destination list or of any answer already in it. Default if unanswered: the form is readable by anyone with the link and submitting requires sign-in, with every typed answer preserved across the login.

**D17. Video and voice calls when the media server is not configured.**
Options: remove the public fallback and show an honest "not set up yet" state · keep the public fallback · make it an Owner-only switch, off by default.
**Recommend: remove it.** The Talk module card says calls run on your own server. Media leaving through a public service with no admin visibility contradicts that, and a corporate security review will find it.

**D18. Does an employee see their own 9-box placement?**
Options: no, the grid is manager and People team information · yes.
**Recommend: no.** The person's own record shows their performance band and their outcome, which is the part that affects them. The box is a calibration tool between managers.

### 3.3 Scope and honesty

**D19. Is mobile in scope for this refresh?**
Options: desktop and tablet for the app, phone-first only for the four surfaces that genuinely are (guest call, clock in and out, public token pages, sign-in) plus the marketing site · full responsive app now.
**Recommend: desktop and tablet.** The current frame has zero breakpoints; a phone shell is a new product surface, not a restyle, and it would double this plan. The four phone surfaces are built phone-first in their own phases.

**D20. Things that are not built yet.**
Options: hidden behind a "Show upcoming features" preference, off by default · visible as greyed rows with a Soon chip.
**Recommend: hidden behind the preference.** Today the product renders about 25 disabled rows and Coming soon chips as if they were controls. A control that cannot be used should not be on screen. The preference lets anyone who wants to see the roadmap see it.

**D21. Dead code from removed modules (CRM, ITSM, helpdesk, finance, legal, payroll).**
Options: delete the CSS families and the dead components, leave the database models untouched · delete everything · leave it all.
**Recommend: delete the CSS families and the dead components, leave the models.** The 34,000-line stylesheet cannot be put on tokens while it still carries five dead products. About 1,500 lines of dead React and roughly 20 unused marketing components go with it. No model, no table and no row is touched.

**D22. Retention numbers.**
Options: Trash 60 days and automation run logs kept forever · Trash 60 and logs 180 days · Trash 30 and logs 90.
**Recommend: Trash 60 days, automation run logs 180 days**, both shown as editable rows on Settings, Data, Retention and privacy. The log table grows forever today and nothing prunes it.

**D23. New workspace sign-in policy.**
Options: two step verification required for Admins · nobody · everyone.
**Recommend: required for Admins.** It is what a corporate buyer expects on day one and what a 20-person firm never notices.

**D24. Free plan and self-serve signup at launch. (marketing phase)**
Options: a real free tier with "Start free" live · a 14-day trial with "Start free trial" · demo-first with "Book a demo".
**Recommend: a real free tier, capped at a small number of seats, with "Start free" live.** The word "free" appears on 24 marketing buttons today and all 24 of them 404. Whatever you choose, the copy has to match the door.

**D25. Marketing positioning and currency. (marketing phase)**
Options: work OS and PPMS for any business, US dollars with a geo-detected currency toggle · a business operating system for India, UAE and SEA in rupees, which is what the structured data on the site says today.
**Recommend: work OS for any business, dollars with the toggle.** The pricing page, the structured data and the in-app currency handling all read from one file either way.

---

## 4. Build phases, in order

Every phase ships on its own and leaves the product working. Each names its units, how many URLs it touches, what a customer can see at the end of it, what it waits on, and which audit issues it closes.

The audit issue codes are the 15 systemic issues in `critic-gaps.json`, numbered in the order they appear there: **S1** navigation decoupled from the URL and 17 apps unreachable · **S2** fabricated and inert chrome · **S3** duplicate models and duplicate surfaces · **S4** access fragmented across seven systems · **S5** no back-navigation convention · **S6** five visual systems · **S7** settings that never persist · **S8** core flows broken end to end · **S9** naming drift · **S10** desktop-only and hover-only affordances · **S11** swallowed errors and no session expiry · **S12** server round trips, hard caps and polling · **S13** time, locale and money handled differently per surface · **S14** dead code and stale registries · **S15** copy hygiene.

---

### Phase 0. Foundations: tokens, type, navigation truth, the data layer, the access engine

**Units:** design system steps 1 and 2 · shell steps 1 and 3 · access model steps 0, 1 and 2 · settings step S0.

**Routes touched:** 0 new URLs. Every one of the 189 inherits the result.

**What ships:**
- One token file. The cool slate ramp, the navy chrome tokens for all four combinations of frame and theme, one blue, the semantic trio only, the eight muted user colours. The 10 accent blocks are deleted and every stored accent is normalised to blue in the same change, with a dry run first. Dark mode becomes a rebinding of tokens instead of 147 forced repaints, and those repaints stay in place pointing at tokens so nothing flashes during the migration.
- Inter and JetBrains Mono load; five other font families are dropped. Nine type sizes; arbitrary pixel sizes become a lint error.
- `src/lib/nav/route-hub.ts`: one static table from URL to hub, one from URL to title. The saved `activeAppKey`, the hover preview and the dead `matchPaths` matching are deleted. **Every other unit is blocked on this, so it goes first and alone, with no visual change.**
- `apiFetch` with one error path, the session-expired dialog, the offline strip, the draft-preserving retry, one overlay stack with one Esc, one keyboard registry, and `/api/boot` so the shell has its facts before first paint.
- The access engine over today's tables: one `can()`, one `requireCan()`, one `gatePage()`, and a golden test suite encoding every row of the audit matrix. Then the pivot: the 40-odd existing gate helpers become one-line delegates over it, with zero call-site edits, so pages and APIs agree by construction the day it lands. Then a nightly job in staging and production diffs the old answer against the new one for a week.
- The settings chassis: one page registry, one dirty-state guard, the strict preferences schema, and the 15 redirects.

**Depends on:** nothing.

**Closes:** S6 (the colour and type half), S13 (one date helper, one locale source), S14 (the CSS families and dead registries), S11 (the swallowed-fetch and session-expiry mechanism), and the highlight half of S1. Lays the ground for S4.

---

### Phase 1. The frame: rail, sidebar, top bar, overlays, the six states

**Units:** shell · design system steps 3, 4, 6 and 7.

**Routes touched:** the frame renders on all 163 in-app URLs. This phase owns 7 surfaces with files of their own (route loader, in-shell error, in-shell 404, root 404, last-resort boundary, the settings takeover frame, the dev-only loader gallery) and 13 overlays with no URL (search palette, Create menu, bell, avatar menu, help menu, workspace menu, session-expired dialog, Customize panel, shortcuts overlay, mission splash, reminder dialog, notepad panel, voice note).

**What ships:**
- Rail 64 wide, navy, flush to the edge, eight labelled hubs in a fixed order, a white pill on the active one, the four dots at the top which double as the page-loading signal. The floating card treatment, the icons-only option, the More launcher tile, the Invite button and the Upgrade link are gone.
- Secondary sidebar 264, grey in both frame variants, 36 rows, a grey pill on the active row with no blue and no zoom, section labels with a rule, a search field only when a tree is longer than 12 rows, one Customize Sidebar button in the footer.
- Top bar 48, one navy row: back and forward, the hierarchy breadcrumb (Hub, Space, Folder, List, Item), a 400 wide search field, then plus, bell, help and avatar. No blue button on the bar. The three floating cards and the quick-tool icon row are gone; their jobs move into the plus menu and the palette.
- The three-row page header as one component set, replacing `OsTitleBar` everywhere. The inert Ask AI, Share and Invite trio, the always-filled star and the hard-coded teammate faces are deleted from the component, which means they are deleted from about 40 pages at once.
- One back convention: every detail route declares a fallback target, and the back button uses it whenever there is no history. One denial convention with exactly three shapes. One loader vocabulary: skeletons in content, the rail dots for route changes, a pending dot in buttons, the autosave dot for saves. `Loader2` and the string "Loading" become lint errors.
- Tablet breakpoints at 1024 and 768. Skip links, landmarks, focus moved to the page on navigation, and the page title announced to screen readers.
- Folded apps become reachable: the palette lists every app the viewer can see, and each hub sidebar renders its own rows.

**Depends on:** Phase 0 (all of it).

**Closes:** S1 in full, S5 in full, S11 in full, S2 for every page that used the shared header, S6 for the frame, S10 (breakpoints and the end of hover-only reveals), S9 (the label registry), S15.

**What a customer sees:** the product looks new, the left side finally follows the page they are on, and nothing on the frame is decoration any more.

---

### Phase 2. Work: home, my work, inbox, Spaces, Lists, the task

**Units:** work-home (24 routes) · spaces-lists (6) · task-detail (1).

**Routes touched:** 31.

**What ships:**
- `/home`, a real Work landing that never existed: a quiet page of widgets. `/today` and `/dashboard` redirect into it.
- `/my-work`, every task assigned to me, over one task model. Seven legacy task pages redirect into it or into a view of it.
- `/inbox` rebuilt with three tabs, real counts and preferences that save.
- Spaces, Folders and Lists rebuilt on the standard header stack, with the tree in the sidebar derived from access. The Space tabs and List view tabs stop being full server page loads.
- One task. Legacy Task rows migrate into the Item model, `/tasks/[id]` redirects to the migrated task, and a task opens as a drawer over whatever list you were reading, at the task's own URL, so Copy link always works. Expand widens it into the page in place. Four visible fields and a named door to the rest.
- The one Template Center at `/templates`, replacing six separate template concepts. The one Trash at `/trash`, replacing four, filtered by type.
- `/everything`, `/activity` and `/favorites` rebuilt with real pagination. The 500-row and 50-row client caps go.

**Depends on:** Phases 0 and 1. The nine new access rules land with Phase 0's access step 3.

**Closes:** S3 (task versus item, six templates, four trash surfaces, the `/ideas` and `/marketing` duplicates), S8 for the work flows, S12 (the server round trips and the row caps), S2 for these pages, S7 for the inbox and view preferences.

**What a customer sees:** the daily driver. One place that says what today looks like, one list of everything assigned to them, and a task that opens where they are instead of throwing them onto a different page.

---

### Phase 3. Knowledge: docs, canvases, files, SOPs, policies, contracts

**Units:** docs-knowledge (10 routes) · process (22).

**Routes touched:** 32.

**What ships:**
- `/docs` rebuilt with four views, the doc editor restyled with the autosave dot contract, sub-docs in the tree. `/library` retires as a word and redirects by tab into Docs, Canvases, Files and Tables.
- Canvases and Files folder-aware, on the one share dialog.
- SOPs: one page for all four kinds, a chooser that does not pre-create a row, the developer instructions removed from the recorder copy, My SOPs, compliance, Organize and Run history all reachable for the first time.
- Policies with acknowledgements, contracts renamed from agreements everywhere a person reads, signing pages rebuilt.
- Notetaker under one name, with the result envelope bug fixed.
- The notes trash and the contracts trash fold into the one Trash.

**Depends on:** Phases 0, 1 and 2 (the Trash and Template Center, and the drawer mechanism).

**Closes:** S3 (library, notes trash, four doc-template surfaces), S8 (notetaker, SOP editing through a "new" URL, the contracts trash view that never existed), S2, S9 for this whole vocabulary.

---

### Phase 4. Time and talk: planner, meetings, timesheets, clock, Talk, announcements

**Units:** planner (6 routes plus 2 shared) · talk (6).

**Routes touched:** 14.

**What ships:**
- One calendar at `/planner`. `/calendar` and `/tasks/calendar` redirect into it. Week start and time zone come from one setting instead of three different assumptions.
- Meetings re-parented into Planner with editable detail.
- Timesheets that can actually take an hour, with week navigation, an approvals view, and a rejected week that is no longer a dead end.
- Clock in and out on the real punch endpoint, phone-first.
- Talk rebuilt as a hub with a home instead of an auto-jump into the newest conversation, one conversation page with threads and calls, a guest call door, and announcements that stay reachable when the Talk module is off.

**Depends on:** Phases 0 and 1. Timesheet approvals depend on the access engine's manager chain.

**Closes:** S8 (clock, timesheets, the calendar connect flow that landed on a stub), S13 (week start and UTC bucketing), S3 (`/tasks/calendar` versus the planner, the dead timesheet manager), S9 (Talk, Room, TLK, huddle).

---

### Phase 5. Data: tables, forms, embeds, import

**Units:** tables-forms (8 routes).

**Routes touched:** 8.

**What ships:**
- `/tables` as a list page, and the grid rebuilt with columns that can be named and typed, a menu bar, a status bar, and the bottom sheet tab bar removed because it promised multiple sheets that do not exist.
- The form builder with a dirty-state guard, and the response page moved out of the authenticated area so a customer with the link reaches it instead of being bounced to a login screen.
- Embeds fixed, including the formula cells that render as `[object Object]` today.
- CSV import available in place on a table for any Member, with the admin-only bulk import staying in Settings, Data.

**Depends on:** Phases 0, 1 and 2 (the share dialog and the Trash type filter). D15 and D16 change one cell each.

**Closes:** S8 (sheet columns, public forms), S12 (import and grid caps), S7 (form builder state), S2.

---

### Phase 6. People: directory, org chart, teams, goals, reviews, recognition

**Units:** teams-people (10 routes) · teams-performance (9) · goals (8).

**Routes touched:** 27.

**What ships:**
- The Directory as the Teams landing for everyone, a person record that opens as a drawer over it, my profile, departments, job titles, skills with a real write path, and the org chart with an edit mode for reporting lines.
- My team, workload with real counting and settings that save, and analytics rebuilt on the task model and moved from Work into Teams where its audience is.
- Goals as My, Team and Company, with a goal page and an effort panel that reads from linked work.
- KRAs and KPIs by job title; the two competing manager KPI workflows become one at `/team/kpi-reviews`.
- Weekly reviews as a manager queue with a decision drawer, review cycles whose sections come from who you are in the cycle, the 9-box grid, candor, surveys, and kudos with the give path finally connected.
- Tools and Assets re-parented from the Settings sidebar into Teams.

**Depends on:** Phases 0, 1 and 2. Four Teams badges need the widened boot counts from Phase 1, and five new inbox row kinds from Phase 2.

**Closes:** S3 (two KPI workflows, `/organization` versus the settings hierarchy page), S8 (kudos, the alignment board approvals that posted to the wrong verb, the review cycle gated against its own participants), S2 (the invented health score and the fake avatar stacks), S9 (five different things called Review).

---

### Phase 7. AI, automation and add-ons

**Units:** ai-automation (14 routes plus 3 shared) · tools-misc (8 plus 3 shared).

**Routes touched:** 22.

**What ships:**
- Ask AI as one assistant with one name, one panel and one page. Sidekick, Brain, AI Engine and Super Agent all retire as words. The two dead sidebar links go.
- Agents on the real endpoints instead of a static mock.
- The automation hub complete and reachable: workflows with a dirty guard and version history, templates, logs with real pagination, health, usage, and connections rebuilt around the one connector that works. `/autopilot` and `/ai`, both static duplicates, redirect in.
- Marketplace at `/store` on the real module registry, with the word "install" removed from the product. Integrations as an honest catalogue with real "request this" cards. Build apps rebuilt.
- The `/marketing` app's campaigns, content and events migrate into a real Space with real Lists.

**Depends on:** Phases 0, 1 and 2.

**Closes:** S3 (autopilot versus automation, sidekick versus the panel, three integration doors), S2 (the biggest concentration of mock pages in the product), S9, S12 (log pagination).

---

### Phase 8. Settings, my settings, sign-in, and the access surfaces

**Units:** settings-workspace (26 routes) · account-auth (18) · access model steps 3 to 8 · settings steps S1 to S7.

**Routes touched:** 44.

**What ships:**
- One full-screen settings takeover with two doors. Workspace settings: Overview, Identity and culture, Locale and work week, Apps and modules, Members, Structure, Access, Task system, Scoring and reviews, Security, Data, Audit log, API and webhooks, Plan and billing, All settings. My settings: Profile, Preferences, Notifications, Security, Calendar and connections, Keyboard shortcuts, All settings. Fifteen old settings URLs redirect into them.
- Every visible setting saves. The ones that never did (inbox preferences stripped by the schema, the home card list nobody read, space default permission, private and pinned views, escalation thresholds, rail floors, default language, presence, saved filters, sidebar width, workload capacity) either get their reader or move behind "Show upcoming features" with an honest caption.
- The one share dialog replaces three dialogs plus a SOP access panel plus a goals sharing panel. Four object roles with one sentence each. One "Who has access" view. One Request access flow.
- The permission matrix, of which 55 of 75 cells enforce nothing, retires into ten plain toggles plus one Lock it down switch, with the old matrix exported for anyone who customised it.
- Sign-in rebuilt: `/signup` exists at last (the destination of 24 marketing buttons), `/join` shows the workspace, the inviter and the role, `/welcome` and `/setup` collapse into one wizard that is an offer rather than a gate, and the wizard stops wiping default departments when it is skipped.
- The access schema migration, backfill and flip, behind a flag, after the parity job has shown a clean week.

**Depends on:** every earlier phase for the surfaces that link into settings; the access engine from Phase 0 for the gate.

**Closes:** S4 in full, S7 in full, S3 (`/organization` versus hierarchy, three integration doors, two onboarding wizards), S8 (the signup 404, the onboarding loop, the welcome page posting to a read-only endpoint), S2 (sample data presented as real on the tags page).

---

### Phase 9. Staff console

**Units:** admin-backoffice (7 routes).

**Routes touched:** 7.

**What ships:** a reduced frame with no rail on the staff host. Overview, Companies as a list with a drawer, a company page that absorbs the quick-edit dialog, Staff, Analytics and AppSumo codes rebuilt (neither was ever audited), and a new Staff activity log so a customer can be told who changed what. One vocabulary: a row is a company, the thing it uses is their workspace.

**Depends on:** Phases 0, 1 and 8.

**Closes:** the two routes the critic found nobody had audited, plus S6 and S2 on this host.

---

### Phase 10. The marketing site

**Units:** marketing concept (40 routes) plus the generated icon and social image assets.

**Routes touched:** 40.

**What ships:** the public site rebuilt on the same tokens, light only, with its own underline navigation and the cookie banner, which stops mounting inside the app. Every "Start free" button points at the signup page that now exists. The blog index that 404s and the demo form that posts nowhere are fixed. Invented logos, counters and certifications come out. The social image copy is reviewed against the positioning in D25.

**Depends on:** Phase 8 for `/signup` and `/join` to exist and be reachable across hosts.

**Closes:** S8 (the marketing half), S2 (fabricated proof), S6 (the last visual system).

---

### Dependency summary

```
Phase 0  Foundations ──┬─► Phase 1  Frame ──┬─► Phase 2  Work ──┬─► Phase 3  Knowledge
                       │                     │                   ├─► Phase 5  Data
                       │                     ├─► Phase 4  Time and talk
                       │                     │                   ├─► Phase 6  People
                       │                     │                   └─► Phase 7  AI and add-ons
                       └─────────────────────┴─► Phase 8  Settings and access ──┬─► Phase 9  Staff console
                                                                                 └─► Phase 10 Marketing
```

Phases 3 through 7 do not depend on each other and can run in parallel if there are hands for it. Phase 8's settings chassis (S0) and personal pages (S2) can start alongside Phase 0; only the gate itself has to wait for the access engine.

The cross-unit contracts that must land together are listed in `consistency-report.md` section G. The five that matter most for scheduling: the widened boot counts (Phase 1 to Phase 6), the five new inbox row kinds (Phase 2 to Phase 6), the unscoped people picker (Phase 0 access step 3 to every picker in the product), the nine new app rules (Phase 0 access step 3, without which nine live routes 404), and the strict preferences schema learning every new key (Phase 0 to six later units).

---

## 5. What changes, in the words a customer would use

**The product looks like one product.** A navy frame on the left and top, a white page in the middle, one blue button that tells you what to do next. Today there are five visual systems, primary buttons in blue, black, taupe, gradient and red, and two toast systems.

**Every page works the same way.** Title, your saved views, one toolbar. Filter and Sort in the same place on a task list, a document list, a people list and a spreadsheet.

**The left side follows the page you are on.** Click a link a colleague sent you and the right hub lights up and the right row is highlighted, every time. Today the navigation follows a value saved in your own browser and can show you the Settings sidebar beside a project page.

**Nothing on screen is fake.** No Ask AI, Share and Invite buttons that do nothing on 40 pages. No rows of teammate faces belonging to people who do not exist. No Install buttons on a marketplace that installs nothing. No sample data on a settings page presented as your data.

**One name for one thing.** Talk, not TLK and Room and Chat. Task, not item and row and board item. List, not board. Doc, not note and page. Table, not sheet and spreadsheet and database. Contracts, not agreements. Marketplace, not store. One Trash instead of four, one Templates instead of six, one Favorites instead of three.

**There is always a way back.** Every detail page has a back button that knows where it came from and never drops you somewhere unrelated.

**Sharing is one dialog with four choices**, in plain words: Full access, Can edit, Can comment, Can view, each with one sentence saying what it means. There are four roles in the company: Owner, Admin, Member, Guest. That is the whole vocabulary. Today there are seven overlapping systems, three different sharing vocabularies and a 75-cell grid where 55 cells do nothing.

**If you cannot do something, you do not see the button.** Instead you see the value as text, with one line explaining you are viewing only, and one way to ask for access.

**Settings save.** All of them. If a setting cannot be honoured yet it is not on screen.

**The things that were broken now work:** you can give kudos, name a spreadsheet column, log hours on a timesheet, clock in, send a form to a customer who does not have an account, sign up from the website, and finish onboarding without it looping.

**It is calmer.** One opening splash a day instead of one on every navigation. Skeletons instead of a full-screen overlay on every click. Quiet grey empty states with one sentence instead of five coloured boxes.

---

## 6. Route disposition and naming, in numbers

### 6.1 Routes

| | Count | Notes |
|---|---|---|
| Route files in the app today | 203 | 163 in the product, 40 on the marketing site |
| Rows ruled on in the disposition canon | 189 | one row per product URL, including the ones we add |
| **Keep** the same address, rebuilt | **123** | |
| **Keep (new)**: an address that did not exist | **19** | 16 real new pages plus 3 alias redirects (`/goals`, `/automation`, `/account`) that 404 today |
| **Merge** into another page | **1** | `/kra-kpi/review` into `/team/kpi-reviews`, one manager KPI job instead of two |
| **Redirect** permanently (308), page file deleted | **37** | every one lands on a page that already does the job |
| **Remove** | **9** | 6 have a named 308 target; 2 (`/sidekick/history`, `/sidekick/prompts`) never existed and were dead sidebar links; 1 (`/loader-preview`) becomes a development-only page |
| **Destinations lost with no successor** | **0** | this is the hard rule and the table proves it |
| Live product URLs after the refresh | **142** | 139 pages plus 3 alias redirects |
| Marketing URLs, rebuilt in the final phase | **40** | |

The largest single reductions: seven legacy task pages become `/my-work` and its views; six settings pages fold into four; four trash surfaces become one `/trash` with a type filter; six template surfaces become one `/templates`; three integration doors become two with one job each; two onboarding wizards become one; two calendars become one.

Nine new access rules have to land together or nine live routes 404: templates, team, workload, weekly reviews, KRAs and KPIs, alignment, KPI reviews, meetings and clock.

### 6.2 Naming

One destination carries one label, spelled identically in the sidebar row, the page title, the last breadcrumb crumb, the search result, the Create menu, notification copy, email copy and every inbound link. Labels live in three files and no screen hand-types a destination name: `src/lib/nav/labels.ts` (hubs, rows, page titles), `src/lib/access/labels.ts` (roles), and one label field per settings page.

- **8 rail hubs**, maximum nine characters, no two starting with the same word: Work, Planner, AI, Talk, Teams, Docs, Tables, Settings.
- **18 naming collisions settled**, each of which had three or four competing labels for one destination. The big ones: Work and Today and Home; Talk and TLK and Room; Board and List; Task and item and row; Doc and note and page; Canvas and whiteboard; Table and sheet and spreadsheet and database; Departments and functions; Contracts and agreements; Marketplace and store; Ask AI and Sidekick and Brain and AI Engine and Super Agent; Notetaker and clips; My profile and Me.
- **Six "Templates" become one. Four "Trash" become one. Three "Integrations" doors become two, each with one job, plus two settings pages with their own names. Three "Favorites" become one. Five different things called "Review" get five distinct names.**
- **49 labels retire outright** and appear nowhere in the product afterwards.
- **Access has exactly ten words**: Owner, Admin, Member, Guest, Agent, People team, Full access, Can edit, Can comment, Can view. No raw database value is ever printed. Every role choice carries the same one-sentence blurb everywhere it appears.
- **Status words are one vocabulary per object**, sentence case, rendered as a pale chip with a dot.
- Writing rules that apply to every string: sentence case, no em dashes, no double hyphens, the middle dot as the separator, and no developer instructions in product copy.

---

## 7. Risks, and how each one is held

**Data integrity is the first rule and it outranks every deadline in this plan.** No change to how anything saves or loads ships without being seen working first.

**1. A save or load path changes without anyone watching it.**
Held by: the autosave work is presentation only, and changing the saving dot and changing retry or keepalive behaviour may never be in the same change. The whiteboard, doc, note and table save paths are not touched by any phase in this plan. Any change to one is its own release with a manual test before and after.

**2. The access flip locks someone out of their own work.**
Held by: the engine runs over today's tables first and changes no answers (Phase 0 step 0). The pivot makes 40 existing helpers delegate to it with zero call-site edits, so pages and APIs agree by construction. A nightly parity job then diffs old against new on real data for a week; the criterion for flipping the schema is zero unexpected differences, and the expected ones are listed by name. The schema step itself is one idempotent SQL file in a transaction with row-count assertions, per workspace, with a pre-flight report you approve before the write. The flag can be turned off in seconds.

**3. Senior people quietly lose reach.** Today's role ladder gives directors and HR wide access that the four-role model does not reproduce automatically.
Held by: the pre-flight report names, per workspace, every person who would lose reach and why, and you decide each one: make them an Admin, put them on the People team, or accept the narrower scope. Nothing is written until that report is approved. Reach that exists today is preserved with explicit grants written on the day of the flip, and those grants are visible in the share dialog rather than implied.

**4. Rail hide and floor settings become real gates.** They are decorative today, so some workspace may have a careless configuration saved.
Held by: a "N people lose access" preview before any save, a one-time migration report, a week of logged would-be denials before enforcement, and two apps (Home and Settings) that can never be floored.

**5. Database migration drift.** Local is Neon, production is a separate Postgres, and `migrate dev` is already broken by drift.
Held by: every schema step is an idempotent SQL file applied with `prisma db execute` plus a schema pull check, never `migrate dev`. Three new user columns are additive and every reader tolerates their absence, so the pages that need them can ship after the migration without a hard coupling.

**6. Row height and type size change on every screen at once.** 44 rows against 481 places that hard-code 28 today is a shock.
Held by: three densities ship in the same release with the preference wired and an org default, the Tables module defaults to the tightest, and the 15-pixel row size is applied through one container class so the codemod stays mechanical rather than a judgement call per file.

**7. Blue on navy fails contrast**, so any component that renders the brand colour inside the frame silently becomes unreadable.
Held by: the frame reads only chrome tokens and nothing else in the app reads them; the shell change greps for the brand token inside rail, top bar and header and fixes every hit; and a contrast script runs in CI over every token pair in both themes and both frame variants.

**8. The navy frame contradicts the June "Monday-clean" note in the project memory**, so a future pass could "fix" it back to white.
Held by: the memory note is updated explicitly in the same release, and the white flip stays fully tokenised as the escape hatch.

**9. Dark mode of the navy frame has not been seen.**
Held by: light ships first (D7); the dark values for all four combinations are already written down so nothing is discovered late; fallback values are recorded if the frame reads as absent.

**10. Hiding unenforced settings looks like feature loss.** Fifty-five permission cells and about 25 Coming soon rows disappear.
Held by: a release note, an "Enforced at" label on what remains, an export of any customised matrix delivered as a download, and the "Show upcoming features" preference for anyone who wants to see what is coming.

**11. Redirects break someone's bookmark or a stored notification link.**
Held by: every redirect is a permanent 308 with its target named in the disposition table, query parameters are carried through, stored links (`/room`, `/chat`, `/whiteboards`, `/me/mentions`) keep redirecting for good rather than for one release, and the legacy task id lookup is kept so an old task link finds the migrated task.

**12. Migrating legacy content loses rows.** Legacy tasks into the task model, the marketing app into a Space, ideas into a List, the old status colours onto the new eight.
Held by: every one of these runs as a dry run with a report first, keeps a marker on the migrated object so the redirect can find it, and never deletes the source. Where a workspace has no rows to migrate, the redirect goes to a template instead and no migration runs at all.

**13. The plan is large enough to stall halfway.**
Held by: ten phases that each ship on their own and each leave the product working. Phase 0 and Phase 1 alone close six of the fifteen systemic issues. Stopping after any phase is a legitimate outcome, not a broken state.

**14. Two dev servers or a production build beside the running one corrupts the build cache and the database client.**
Held by: it is written into every unit spec as a never. Any new server runs on its own port and is stopped by process id.

**15. Screens the parity mandate protects get restructured by accident.**
Held by: D2 is answered before the header stack ships, the five protected screens (List, Board, Calendar, Gantt, task detail) are restyled and not restructured, and a screenshot goes to you before any visible surface in that family changes shape.
