# WorkwrK UI Redesign: Design References Brief

Date: 2026-09-10
Scope: best-in-class references for a simple, clean work-OS UI (Linear, Notion, monday, ClickUp, Height, Asana, Slack), the concrete principles behind them, and how they translate to WorkwrK's fixed constraints.

Fixed constraints (not up for debate in this brief):
- Palette YBRG (yellow, blue, red, green). Blue `#0073EA` is the single primary accent. No purple.
- Visual preference "Monday-clean": generous whitespace, flat, single accent.
- Logo: four dots between the two "k"s.
- Target feel: "crazy simple", seamless, zero-training adoption.
- Shell: left icon rail of 8 hubs, secondary sidebar of sub-sections, top bar.
- Existing conventions already in code: 14px base type scale (10px floor, text-xs = 13px), BackButton with fallbackHref on every detail route, no hover transforms, Chip/StatusChip + taupe accent token, EntityTile / MenuItem / ViewTabs primitives, rail is access-derived (no pinning).

Evidence base: 60+ real product screens pulled through Mobbin (links inline), plus each company's own design writing (Linear's redesign posts, Asana's design principles, Notion's sidebar posts, monday brand and Vibe docs, Slack's 2023 relaunch coverage), plus NN/g, Radix Colors, Material dark theme and Atlassian iconography for the underlying rules. Full source list in section 9.

---

## 0. The ten principles that make these products feel simple

These are the recurring mechanisms behind "it just feels simple." Every recommendation later in the brief traces back to one of these.

1. **One accent, everything else neutral.** Linear: "mostly neutral, with one tuned accent used as punctuation." Notion: essentially no accent in the chrome at all; blue appears only on the one primary button and links. monday is the loud outlier and even it keeps the chrome (sidebar, top bar) white and grey; the colour lives in data cells only.
2. **Chrome recedes, content leads.** Linear's 2026 refresh dimmed the sidebar so "the main content area stands out" and stated the principle as "don't compete for attention you haven't earned." Structure "should be felt not seen": softer borders, fewer separators.
3. **One density, applied everywhere.** Linear runs a 32px (or 40px) row rhythm across lists, tables and forms, on a 4px grid. Sameness of rhythm reads as calm; three different row heights on one screen reads as clutter.
4. **Small, restrained type with strong hierarchy through weight and colour, not size.** Linear: 13px small / 15px body, Inter with 510/590/680 weights; Notion and Asana: 14px body; Slack: 15px. Headings are barely larger than body; hierarchy comes from weight plus secondary-text grey.
5. **Progressive disclosure with a correct split.** NN/g's two rules: put only the frequently-needed features in the primary layer, and make the way into the secondary layer obvious and well-labelled. Linear's issue page shows 4 properties by default (Todo, priority, assign, estimate) and everything else behind "+". Notion hides all power behind "/" and "…". Asana hides 20+ field types behind a single "+" column header with "Show more".
6. **Progressive complexity at the workspace level, not just the screen level.** ClickUp's ClickApps and WorkwrK's own Settings→Modules pattern: whole capabilities can be off for an org, so a small business never sees them. Linear's "Customize sidebar" lets each person hide whole nav sections (Projects, Views, Members, Teams show "Don't show" by default).
7. **Empty states that are a single sentence plus one button.** Linear's Customers and Customer requests empties: small line illustration, title, two-line explanation, one primary button (with its shortcut), one quiet "Documentation" secondary. Nothing else on the screen.
8. **Detail opens beside the list, not instead of it.** Asana, Height, ClickUp and Linear (Inbox) default to a side panel or split so the user never loses the list. Full-page detail is a deliberate second step (expand icon), and has a shareable URL either way.
9. **Icons paired with words in navigation, and fewer icons overall.** Linear's refresh "reduced overall icon usage," scaled icons down, and removed coloured icon backgrounds. Atlassian's rule: "use text labels to support icons wherever possible, and avoid using icons where they aren't necessary." Icon-only is acceptable only on the rail, and only with a visible label under it (Slack, ClickUp) or a tooltip on hover (Linear has no icon rail at all).
10. **Feedback is quiet and reversible.** Toasts are bottom-left or bottom-right, one line, neutral colour, with Undo (Asana "To-Dos saved · Undo", ClickUp "Archived … · Undo"). Success is not celebrated in green banners; monday is the one exception (green top-centre banner) and it feels dated next to the rest.

---

## 1. Product teardowns

For each product: what makes it feel simple, concrete values, how power is hidden, empty states, how the feature set stays navigable, and what to take or avoid.

### 1.1 Linear

The reference for calm density. Screens: [issues list](https://mobbin.com/screens/fd1b4d88-f021-49a3-98af-4cd3a87e1d29), [board](https://mobbin.com/screens/fc208a44-dbf9-4f79-b9b0-db57f9840964), [issue detail](https://mobbin.com/screens/f00cc4fb-4083-43fc-a0fb-703a6c4ef771), [project overview with properties panel](https://mobbin.com/screens/f687b5fd-9354-45b2-af71-74140aaedf3d), [new issue modal](https://mobbin.com/screens/ffa2e456-85c7-4005-b361-de79dc6b6dc7), [filter menu](https://mobbin.com/screens/ed670cda-0527-4716-a1a6-0159f12c4f42), [customize sidebar](https://mobbin.com/screens/f81c0f0b-aaf3-45a0-9985-d79c9b0c0cca), [team settings](https://mobbin.com/screens/fea37c46-ab06-4d46-86c7-333ffb0db455), [empty state](https://mobbin.com/screens/f2e7538e-b21c-4933-a5d2-4e4c31853e88).

- **Density and rhythm.** Rows are 32px, list text 13px, one line per row: identifier, status icon, title, then right-aligned metadata (project chip, avatar, date). No borders between rows; group headers are a slightly tinted band. Everything sits on a 4px grid (4/8/12/16/24/32).
- **Type.** Inter Variable, weights 400/510/590/680 (a half-step heavier than default, which is why the type feels "machined"). Sizes: 12 micro, 13 small, 15 body, 24 title. Inter Display for headings only.
- **Colour.** Almost entirely neutral. The accent (indigo in Linear's case) appears on the primary button and focus states only. Status is carried by tiny icon glyphs (circle, half-circle, check) with colour, never by filled cells. Linear's theming is generated from three variables: base colour, accent colour, contrast, in LCH so equal-lightness colours look equally light; this is how they ship light, dark and high-contrast from one source.
- **Chrome.** Sidebar is a flat list grouped by small caps-free grey labels ("Workspace", "Your teams", "Try"). Top bar is a breadcrumb (Workspace › Project › Issue) plus persistent back/forward, plus one right-aligned notification bell. View controls (Filter, Display) live in a second slim row directly above content.
- **Hidden power.** The right properties panel shows 4 items; "+" reveals the rest. The filter menu is a single searchable list. Every action has a shortcut shown inline. "Customize sidebar" lets individuals hide Projects / Views / Members / Teams (default "Don't show" for most). The 2026 refresh made "headers, navigation and view controls consistent across projects, issues, reviews and documents."
- **Empty states.** Small line illustration, title, two-line copy, one primary button (with shortcut badge) and one secondary "Documentation" link. Same template everywhere.
- **Navigability.** Global search (⌘K) is the escape hatch; the sidebar stays short because teams are collapsible and users hide sections.
- **Take:** row rhythm, 4-property default panel, breadcrumb + back/forward pattern, empty-state template, sidebar-hiding preference, single-list filter menu, LCH-generated theme.
- **Avoid:** Linear's chrome assumes keyboard-first engineers; WorkwrK's SMB users need labels and visible buttons where Linear uses shortcuts.

Sources: Linear, "How we redesigned the Linear UI (part II)"; Linear, "A design reset (part I)"; Linear, "A calmer interface for a product in motion"; Linear changelog 2026-03-12 "UI refresh"; designsystems.one Linear breakdown.

### 1.2 Notion

The reference for "blank canvas that does not intimidate." Screens: [page + sidebar](https://mobbin.com/screens/f1c0cbe0-4db7-4edd-b7b6-581ebe9fedc9), [new page "Get started with" row](https://mobbin.com/screens/f2dcf700-2fe5-4633-a706-e0391c025432), [board](https://mobbin.com/screens/f1724632-5d42-47ff-96cc-7884f9733a00), [table property menu](https://mobbin.com/screens/fb9142f9-c78f-4f2b-82a0-f3e35fb94ec1), [bulk actions](https://mobbin.com/screens/f63163ee-9eaa-4c17-9095-9e00d896a659), [settings](https://mobbin.com/screens/eb5ad598-c7c9-4e53-904c-db76cbc94b6e), [preferences](https://mobbin.com/screens/d138214d-5351-4bd6-a2bb-c7b3648ea6a5), [welcome checklist](https://mobbin.com/screens/fa7a1586-e22b-433e-aaca-333b90f495ac).

- **Density.** Sidebar rows about 28px, 14px text, generous 96px+ page margins, content column max ~ 720px. The page itself is the UI.
- **Hierarchy.** Sidebar sections are permission-derived, not user-invented: Favorites, Private, Shared, Teamspaces. Notion's own words: the sidebar "reflects the sharing settings of your account." That is the same idea as WorkwrK's access-derived rail. Their March 2026 3.4 redesign split the sidebar into four tabs (pages, agent chats, meetings, notifications) because "the sidebar was getting far too crowded," and every section is toggleable.
- **Colour.** Greys only in chrome; one blue "New" button. Status/select tags use pale pastel fills with dark text (light-mode tags are at Radix "step 3" tints).
- **Hidden power.** Nothing on a new page except a title and a single "Get started with" row (Ask AI, Meeting notes, Database, Form, Templates, …). "/" opens blocks; column "…" opens a 12-item menu. Progressive complexity: "simple by default, powerful on demand."
- **Empty states.** New page = title placeholder plus the "Get started with" chips; the Welcome page is an interactive checklist. No illustrations in product surfaces.
- **Navigability.** Breadcrumb in the top bar shows Teamspace › Page › Sub-page; Home (Recents, Favorites, Upcoming) is the landing surface; search is the fallback.
- **Take:** permission-derived sidebar sections, "Get started with" chip row as the empty state for docs/whiteboards, tag colouring rule (pale fill, dark text), narrow content column for docs, settings modal with three groups (Account / Workspace / Admin).
- **Avoid:** Notion's chrome-less top bar gives too little orientation for task-heavy screens; keep a real top bar.

Sources: Notion "New sidebar design will help Notion scale"; Notion 3.4 release notes (2026-03-26); raw.studio Notion UX analysis; Notion help "Navigate with the sidebar".

### 1.3 monday.com

The reference for "colour as data, whitespace as chrome," and the product whose primary blue WorkwrK already uses. Screens: [main table](https://mobbin.com/screens/f6bf4010-a0f1-4a5b-ac99-d9523f111baf), [view picker](https://mobbin.com/screens/f590947c-84dd-4101-a8b2-430c76522cd3), [group menu](https://mobbin.com/screens/ee38e608-b643-4040-b6ba-b15e95993754), [conditional colouring](https://mobbin.com/screens/ec1dda0b-1c3f-4b59-ae61-91a4a1771fde), [admin general](https://mobbin.com/screens/ffb614a6-94c6-4a59-b122-49e7f3d47d2e), [admin security](https://mobbin.com/screens/fca4659a-2030-4dd5-95ed-8bd5eeb443e2), [board members modal](https://mobbin.com/screens/fd0efcc4-24ae-47ae-afd1-95e75f55b4fa), [onboarding](https://mobbin.com/screens/fc17d45d-8927-4536-a43f-17780e99d0af).

- **Density.** Table rows about 36px, 14px type; sidebar has only Home, My work, a workspace switcher, a search field and boards. The chrome is aggressively white.
- **Colour.** Product primary `#0073EA` (Vibe `--primary-color`), text `#323338`, secondary text `#676879`, borders `#C3C6D4` / `#D0D4E4`, secondary background `#F6F7FB`; status fills Done `#00C875`, Working on it `#FDAB3D`, Stuck `#E2445C` (these are the widely documented Vibe values; verify against vibe.monday.com before copying, the docs site is JS-rendered and could not be fetched). Brand site lists Green done `#00CA72`, Yellow working on it `#FFCC00`, Red stuck `#FB275D` and says supportive colours "function as status indicators" and red "might also communicate warning so use responsibly." Status cells are solid fills with white text; group headers are coloured text plus a left rule.
- **Hidden power.** Board toolbar exposes only New Task, Search, Person, Sort, Filter, Hide, "…" (pin, row height, conditional colouring, …). The view picker ("+") lists 9 view types plus "More views". Automate and Integrate are top-right, out of the main flow.
- **Empty states.** The home screen literally shows only the logo while loading; the onboarding wizard asks one question per screen ("Give your board a name").
- **Navigability.** Two-level: workspace switcher then boards. Admin is a separate full page with a left list (General, Customization, Users, Security, API, Billing, Usage stats, Tidy Up, Content directory, Apps, Permissions) and tabs inside each.
- **Take:** the toolbar minimalism (7 controls), solid status chips as the one place colour is allowed, "Back to workspace" as the single exit from admin, tabs inside admin sections.
- **Avoid:** the colour-everything defaults (group colours, per-board colours) that the founder has already rejected; success banner in green at top-centre; the "Help" floating pill.
- **Flag:** `#0073EA` is exactly monday's product blue. With Y/R/G status chips on white, WorkwrK will photograph like monday. Differentiate with a cooler neutral, a different type family, outline icons and restraint on status fills (see section 4.8).

Sources: monday brand colours (brand-monday.com/colors); Vibe design system (vibe.monday.com, developer.monday.com); Mobbin monday brand colours page.

### 1.4 ClickUp

The counter-example WorkwrK is mirroring for parity, and the best lesson in what to leave out. Screens: [list + task panel](https://mobbin.com/screens/fdca2aa1-77b1-4975-bc13-7cbe41227480), [list + undo toast](https://mobbin.com/screens/fcd7d80b-ab9c-4d07-8429-1bd6d77fbc83), [bulk bar](https://mobbin.com/screens/fc8a346b-6a8f-46c5-9f46-856389eec373), [empty grouped list](https://mobbin.com/screens/e94350c9-3b24-4828-b92a-9f215e935619), [task modal](https://mobbin.com/screens/fe1a64fc-5c3d-48e1-8b86-05d9699ba7e9), [edit statuses](https://mobbin.com/screens/f28dfcc8-2774-44c2-bcbd-07e0cd319728), [settings: spaces](https://mobbin.com/screens/fea6d6c7-7bfc-45a5-913c-2a44eaad492c), [customize sidebar](https://mobbin.com/screens/f99de82c-c749-41aa-94b7-70cc749fcade), [manage people](https://mobbin.com/screens/f991a6aa-4b1e-4cfe-a45c-287cb41eae75).

- **Shell.** 3.0 introduced exactly WorkwrK's shape: a 48px icon rail with labels under each icon (Home, Planner, Brain, Dashboards, More; Upgrade and Invite at the bottom), a 260px secondary sidebar (Home section, Favorites, Spaces, Channels, Direct Messages), and a top bar with a centred global search (⌘K), "Create" button, and a location bar / breadcrumb above the view tabs.
- **Density.** Rows 34px, 13px type, but every row carries 4 to 8 chips and icons, so it reads busier than Linear at the same density. Sidebar item count is the real problem: 20+ items visible on first load.
- **Hidden power.** ClickApps (workspace or per-Space feature toggles) are the mechanism for reducing complexity: "adjust the complexity of areas of your Workspace for the type of users you have." "Customize" modal (Navigation / Home / Sections / Themes) lets users hide sidebar items. The view tab bar ("+ View") lists 10+ views.
- **Empty states.** An empty grouped list still renders five coloured status headers with "0" and an "Add Feature" row each: the opposite of calm.
- **Settings.** One full-page "All settings" with a long left list in two groups (Workspace: People, App Center, Settings, Work Schedule, Spaces, Security & Permissions, Audit Logs, Teams, Task Types, Imports/Exports, API, Email, Billing, AI Usage, Trash; then the person's name: My Settings, Workspaces, Notifications, Chat, AI Notetaker, Apps, Calendar, Referrals; Log out).
- **Take:** rail-with-labels, undo toast pattern, the bulk-action floating bar, "Customize" per-user sidebar, the per-org feature toggles (already WorkwrK Modules), the location bar concept (but as one breadcrumb, not two).
- **Avoid:** two competing headers (location bar plus view tabs plus toolbar = three rows before content), chips on every row, coloured status headers in empty groups, 20-item sidebars, Upgrade/Invite badges in the rail.

Sources: ClickUp help "Intro to the Sidebar in ClickUp 3.0" (blocked; structure taken from screens and Juliety's 3.0 review); ProcessDriven on ClickApps; ClickUp help "Intro to ClickApps".

### 1.5 Height

The reference for "modal task, split list, attributes as pills." Screens: [task modal](https://mobbin.com/screens/ff35b84e-131d-44cf-a7e1-0447f369a0cc), [projects list](https://mobbin.com/screens/ee27e751-d87a-4958-890a-c79d54ed346e), [split view](https://mobbin.com/screens/fb1724c6-793f-43ca-8077-de6eb6a62f11), [kanban + view options](https://mobbin.com/screens/fac13a4a-a26b-494a-bd37-71c6364d85ef), [team settings with forms](https://mobbin.com/screens/cfaf9c11-7b89-4d05-a59d-b253df29efe3).

- **Density.** Rows 32px, 13px type, a globally dark 220px sidebar even in light mode (Height 2.0 decision), white content.
- **Hierarchy.** Sidebar: Search, Inbox, Assigned to me, Created by me, Private tasks, then Favorites, then Teams each with Projects / To triage / Backlog / Active. That "one Team = four fixed lists" pattern is a good SMB simplification: no user has to design a hierarchy.
- **Hidden power.** The task opens in a centred modal whose header is a single "attribute strip" (status, assignee, priority, type, due date, "Add attribute"). Everything else is the description. View options live in one popover (Spreadsheet / Kanban / Calendar / Gantt tabs, then which attributes show, subtask handling).
- **Filter bar** reads as a sentence: "Teams any of [ASMobbin] AND Type [Task] OR [Project]". Editable inline, no modal.
- **Empty states.** Lists just show "+ New task" as the last row.
- **Take:** the attribute strip, sentence-style filters, fixed per-team lists, "unsaved view changes" toast with Revert / Save as / Save.
- **Avoid:** Height is discontinued (2025) so do not cite it to customers; the dark sidebar contradicts Monday-clean.

Sources: Height 2.0 launch post and release notes (site intermittently unreachable); freshvanroot review; Mobbin screens.

### 1.6 Asana

The reference for clarity as a stated principle and for the side-panel detail pattern. Screens: [list + task panel](https://mobbin.com/screens/f85ba9c4-849b-46e1-a739-d8a676c528ac), [portfolio + status panel](https://mobbin.com/screens/fee9b0ab-213e-490c-a02b-6ffbb5c1c640), [list with priority chips](https://mobbin.com/screens/f7ec8174-d020-4121-8a8d-5464b4cf7a29), [add field menu](https://mobbin.com/screens/e9e2a277-7779-446a-934b-c05841327b51), [saved + undo toast](https://mobbin.com/screens/e9d9ffd6-5b60-48a0-a5dd-daf889336ea5), [board (dark)](https://mobbin.com/screens/e51854b0-c808-437e-ad96-fe406f23e986), [settings modal](https://mobbin.com/screens/f58886af-a9e6-4a95-9e25-bfbb1b6f044a), [home](https://mobbin.com/screens/e44512f0-824b-49e2-8d02-daac7f262bf5), [project "…" menu](https://mobbin.com/screens/f37f8417-e349-4b52-b394-7330951ac283).

- **Principles (verbatim):** "Increase confidence through clarity"; "Design for fast, effortless, and intentional interactions: simple and common tasks should be frictionless and obvious; complex tasks should feel efficient and delightful"; "Empower everyone through progressive discoverability"; "Be consistent and standard, and innovate when it's worth it." Their redesign mantra was "maximize clarity," and they separated structural fixes (navigation) from visual fixes and shipped them independently; fewer than 1% of users went back.
- **Density.** Rows 36px, 14px type, hairline row separators, section headers with caret. Sidebar: Home, My tasks, Inbox; Insights (Reporting, Portfolios, Goals); Starred; Projects; Team. Top bar: hamburger, "+ Create" (the only orange element), centred search, help / notifications / avatar.
- **Hidden power.** "+" at the end of the column header opens the field-type list with "Show more"; project "…" holds 12 items; the view tabs row (Overview, List, Board, Timeline, Dashboard, Note, Workload, Files, Workflow, "+") is the one crowded element.
- **Detail view.** Clicking a task opens a right panel over the list, with expand-to-full-page and close icons top-right, and subtasks / comments inline. Same panel pattern for project status.
- **Empty states.** Home uses "Learn Asana" cards; empty lists show "Add task…" inline.
- **Take:** the principles, the right-panel detail with expand, one-orange-button rule (translate to one blue button), settings as a modal with 7 tabs for personal settings and a separate admin console for org.
- **Avoid:** the 9-tab view row; Upgrade CTAs pinned in the sidebar.

Sources: Asana "Developing Design Principles"; First Round Review "Here's how Asana won with its product redesign"; Mobbin screens.

### 1.7 Slack

The reference for an icon rail with labels and for consolidating scattered features into five hubs. Screens: [channel welcome](https://mobbin.com/screens/fe601bec-b835-4429-8957-75642a5fe7e0), [channel + profile panel](https://mobbin.com/screens/f5e3c7a4-e132-4a1b-84d7-ef5047fb3cd0), [DM + canvas panel](https://mobbin.com/screens/e9173bcb-f267-498c-a712-ee34b74e8001), [preferences](https://mobbin.com/screens/ec3aedc7-cade-432c-a561-af5c1b9c3d24), [admin settings & permissions](https://mobbin.com/screens/f4102962-7ea7-4846-93e8-a195defcbe1f), [More → External connections](https://mobbin.com/screens/fb964581-6f59-478c-b684-ed08685da703), [minimal rail](https://mobbin.com/screens/df404c7a-864b-422c-ad12-8222f2d064cc).

- **Shell (2023 redesign).** A 68px rail: workspace avatar, Home, DMs, Activity, Later, More, then "+" Create and the user avatar at the bottom. Each icon has a 10px label under it. Home is the secondary sidebar (Threads, Drafts & sent, Channels, Direct messages, Apps). The top bar is just back / forward / history and a centred search. Detail (profile, canvas, thread) opens as a right panel over the content.
- **Why it worked:** the rail items are verbs the user already thinks in (Home, DMs, Activity), not product nouns. The "More" hub holds everything else (canvases, files, people, external connections, automations) so the rail stays at five. Coverage from the launch: designed "to improve focus, organization, and productivity"; criticism was mostly about moved muscle memory, not the model.
- **Settings.** Personal "Preferences" is a modal with a 13-item left list (Notifications, Navigation, Home, Themes, Messages & media, Language & region, Accessibility, Mark as read, Audio & video, Connected accounts, Privacy & visibility, Advanced). Workspace admin is a separate web app with Account / Administration groups and tabs (Settings, Permissions, Authentication, Attachments, Access Logs).
- **Take:** rail = five to eight verbs with labels, "More" as the overflow hub, back/forward/history in the top bar, right panels for people and docs, Preferences modal separated from Admin.
- **Avoid:** the aubergine rail (brand-coloured chrome is what WorkwrK is moving away from); trial and upsell cards inside the sidebar.

Sources: MIT IS&T "Slack redesign" notice; Fast Company / Creative Bloq / gizmochina coverage of the 2023 redesign; Mobbin screens.

---

## 2. Comparison at a glance

| | Linear | Notion | monday | ClickUp | Height | Asana | Slack |
|---|---|---|---|---|---|---|---|
| Base type | 13 / 15px Inter | 14px | 14px Figtree/Roboto | 13px | 13px | 14px | 15px Lato |
| List row height | 32px | 28px sidebar / 36 table | 36px | 34px | 32px | 36px | n/a |
| Chrome colour | neutral, dimmed | neutral | white | white + purple accents | dark sidebar | white | brand aubergine |
| Accent used in chrome | primary button, focus | one button | New Task button, links | Create button, active tab | tiny | Create button (orange) | rail + send |
| Status colour carrier | 16px glyph | pale tag | solid cell | solid pill | pale pill | pale pill | n/a |
| Rail | none (sidebar only) | none | none | icon + label | none | none | icon + label |
| Detail opens as | page (Inbox: split) | page | drawer over table | right panel, expandable | centred modal | right panel, expandable | right panel |
| Back navigation | breadcrumb + ‹ › | breadcrumb | breadcrumb in admin only | breadcrumb + location bar | ‹ › in sidebar | breadcrumb line above title | ‹ › + history |
| Settings container | full-page takeover, left list | modal, 3 groups | full-page admin, left list + tabs | full-page, long left list | in-content tabs | modal (personal) + admin console | modal (personal) + web admin |
| Per-user nav hiding | yes | yes (3.4) | no | yes | no | no | yes |
| Per-org feature toggles | no | limited | limited | ClickApps | no | no | admin permissions |

---

## 3. Navigation shell: rail, secondary sidebar, top bar

### 3.1 What belongs in each layer

**Rail (8 hubs).** Verbs and destinations a new hire recognises without explanation. Slack and ClickUp show the rail holds 5 to 6 primary items plus a bottom cluster (create / profile). Rules from the references:
- Every rail item has a visible 10 to 11px label under the 20px icon (Slack, ClickUp). Icon-only rails force tooltips and fail the zero-training goal.
- The active hub gets a filled, blue-tinted pill background (`blue-50` fill, `blue-700` icon) and nothing else changes colour.
- Bottom of rail: avatar (opens the "you" menu: profile, preferences, theme, log out) and Settings gear. No Upgrade, no Invite badges (both ClickUp and Asana put those there and it reads as noise).
- The rail never scrolls. If a 9th hub appears it goes into a "More" hub (Slack) or is gated by access (WorkwrK's existing rule).

**Secondary sidebar (sub-sections).** The content of the current hub only. Patterns worth copying:
- Fixed personal rows at the top: Home / My work / Inbox (Linear, Asana, ClickUp, Height all do this in the first 3 rows).
- Then permission-derived groups, in this order: Favorites, then the org tree the user can see (Notion's Private / Shared / Teamspaces; Height's Teams). Groups are collapsible; group labels are 12px grey, no icons.
- Width 240 to 260px, rows 28 to 32px, one icon per row at most, counts right-aligned in grey.
- Individual users may hide groups ("Customize sidebar" in Linear and ClickUp; toggles in Notion 3.4). This is a personal preference, not an admin setting.
- No cards, banners, trials or tips inside the sidebar.

**Top bar.** Orientation and global actions only, one row, 44 to 48px:
- Left: back / forward, then a breadcrumb of the hierarchy (not history: NN/g), last crumb is the current page and not clickable.
- Centre: global search (⌘K) as a real input, 400 to 520px wide, placeholder "Search or jump to…" (ClickUp, Asana, Slack all centre it; Linear hides it behind an icon, which is a keyboard-user assumption).
- Right: "+ Create" (the only solid blue button in the chrome), notifications bell, help, avatar. Existing quick-tools (quick task, notepad, reminder, voice) should live inside "Create" or a single "Tools" menu, not as a row of icons.
- The view toolbar (tabs like List / Board / Calendar, then Filter / Sort / Group / Display) is part of the content header, below the top bar, and is the only other horizontal control row. ClickUp's three stacked rows (location bar, view tabs, toolbar) are what to avoid; fold location into the top-bar breadcrumb.

### 3.2 Back navigation: breadcrumbs, back buttons, persistent context

- Use all three, each for its job: browser/top-bar back for history; breadcrumb for hierarchy; the sidebar highlight for persistent context. NN/g: breadcrumbs "show the site's hierarchy, not the session history" and "augment but do not replace primary navigation."
- Breadcrumb format: Hub › Space › Folder › List › Item, ">" separators, last item plain text. Truncate the middle with "…" when more than 4 levels (Linear and ClickUp both do this).
- Keep WorkwrK's BackButton with `fallbackHref` on every detail route; it is the mobile-width substitute for the breadcrumb, and it protects deep links (a user arriving from a Slack message has no history to go back to). Linear and Slack both keep ‹ › arrows visible permanently.
- Deep-link every panel: Asana and Linear give a side-panel task the same URL as its full page, so "copy link" always works (uxdesign.cc's cheat sheet: drawers fail when users want to link to a line item; the fix is a URL per drawer).

### 3.3 How detail views open: drawer vs page vs split

Decision rule distilled from the seven products:

| Situation | Pattern | Who does it |
|---|---|---|
| Item clicked from a list/board/table | Right panel over the list (480 to 560px), with "expand" to full page and "close" | Asana, ClickUp, Slack, Linear Inbox, Height (modal variant) |
| Long-form content (doc, SOP, review, goal page) | Full page, narrow content column (680 to 760px), breadcrumb on top | Notion, Linear docs/projects |
| Item opened from search, notification, or deep link | Full page (no list to sit beside) | Linear, Asana |
| Short create/edit (task, list, member) | Centred modal, 560 to 640px, one primary action | Linear "New issue", Notion "Create teamspace", monday "Board Members" |
| Confirmations / destructive | Small modal, 400 to 480px, red primary only for destructive | Notion delete account, Asana remove |
| Reference info about a person / channel | Right panel, never modal | Slack profile, Slack canvas |

Split view (list left, detail right, both persistent) is the best default for Inbox-type surfaces (Linear Inbox, Height list + task). Everywhere else use the panel-with-expand pattern: same component, same URL, just a different container. WorkwrK already has BoardItemDetail as drawer and `/item/[id]`; make the drawer the default click target and the page the "expand".

### 3.4 How settings are reached

- One gear in the rail bottom (or the avatar menu) and one "Settings" item in the workspace-name dropdown (Linear pattern). Two entrances, one destination.
- Contextual settings (list statuses, space members, folder sharing) open from the "…" on the object, in a modal or panel, never by navigating away to global settings (ClickUp "Edit statuses" modal, Linear team settings page).
- Global settings are a full-screen takeover (WorkwrK's current choice, matching Linear and monday) with a "Back to app / Back to workspace" link at the top-left of its own left list. Personal preferences can be a modal (Slack, Asana, Notion) but a single takeover with a "You" group is simpler to explain.

### 3.5 Recommended shell spec for WorkwrK (numbers)

- Rail 64px wide, item = 20px icon + 10px label, 56px tall hit area, 8px gap; active = `blue-50` rounded-8 pill + `blue-700` icon/label; inactive = `N600`.
- Secondary sidebar 248px, `N50` background, rows 32px, 14px text, 16px leading icon in `N500`, active row `N100` fill (not blue) with `N800` text; group labels 12px `N500` with 24px top margin; collapsed state hides it entirely (rail only), remembered per user.
- Top bar 48px, white, 1px `N200` bottom border, breadcrumb 14px, search input 480px, "+ Create" 32px solid `blue-600`.
- Content header: title 20px/590, description 14px `N500`, then ViewTabs (underline style, existing primitive), then a 40px toolbar row: Filter, Sort, Group, Display on the left; view-specific primary ("+ Add task") on the right.
- Content padding 24px; list rows 36px (one step up from Linear to honour the 14px base); board columns 280px; table rows 36px with 32px compact option.

---

## 4. Colour system for a blue-primary YBRG brand

### 4.1 Token architecture

Three layers, exactly as Linear (three generator variables), Radix (12-step scales), and every design-system guide describe:

1. **Primitives**: `blue.1..12`, `neutral.1..12`, `green.1..12`, `yellow.1..12`, `red.1..12` for light and dark.
2. **Semantic aliases** that components use: `bg.app`, `bg.subtle`, `bg.raised`, `bg.hover`, `bg.selected`, `border.subtle`, `border.default`, `border.strong`, `text.primary`, `text.secondary`, `text.placeholder`, `text.link`, `accent.solid`, `accent.solidHover`, `accent.text`, `accent.bg`, `success.*`, `warning.*`, `danger.*`, `focus.ring`.
3. **Component tokens** only where a component genuinely deviates (e.g. `chip.status.bg`).

Dark mode is then a re-mapping of layer 2, not new components. Radix's step semantics give the mapping for free: 1 app bg, 2 subtle bg, 3 component bg, 4 hover, 5 active/selected, 6 subtle border, 7 border/focus, 8 hover border, 9 solid (the pure brand colour), 10 solid hover, 11 low-contrast text, 12 high-contrast text. Radix notes yellow/amber/lime/sky/mint scales are "designed for dark foreground text" at steps 9 and 10, which is exactly the yellow rule below.

### 4.2 Neutrals with a cool bias (light mode)

Cool bias means a touch of blue in the greys (Tailwind "slate" family rather than "gray/zinc"), so the neutrals and `#0073EA` share a hue family and the interface reads as one material. Linear's latest refresh notably moved the other way (warmer) to feel calmer; the cool bias here is a brand decision, so keep chroma very low (2 to 4 in LCH terms) to avoid the "steel" look.

| Token | Hex | Role |
|---|---|---|
| N0 | `#FFFFFF` | app background, cards |
| N50 | `#F6F7F9` | sidebar, subtle sections, table header |
| N100 | `#EEF0F3` | hover on rows/menus |
| N200 | `#E4E7EC` | subtle borders, row separators (use sparingly) |
| N300 | `#D0D5DD` | input borders, strong dividers |
| N400 | `#98A2B3` | placeholder text, disabled icons (2.58:1 on white, decorative only) |
| N500 | `#667085` | secondary text, inactive icons (4.97:1 on white, 4.64:1 on N50) |
| N600 | `#475467` | rail inactive labels, tertiary buttons |
| N700 | `#344054` | headings on tinted backgrounds |
| N800 | `#1F2430` | primary text (15.5:1) |
| N900 | `#101215` | dark-mode app background |

Rules: never put text on N200/N300; N400 is decoration only; body text is N800, never pure black (Linear and Notion both use near-black, ~`#1c1c1f` / `#37352f`).

### 4.3 Blue scale (the only accent)

| Token | Hex | Role |
|---|---|---|
| blue-50 | `#EAF3FE` | selected row, active rail pill, info banner bg |
| blue-100 | `#D4E7FD` | selected hover |
| blue-200 | `#A9CFFB` | focus ring at 50 % or as 2px ring |
| blue-600 | `#0073EA` | solid buttons, checkbox on, toggle on, links on dark |
| blue-700 | `#0B5FC2` | link text and accent text on light (6.1:1), active icon |
| blue-800 | `#0A4C9B` | pressed state |
| blue-solid-hover | `#0062CC` | hover on solid buttons (5.8:1 with white) |

Where blue may appear in chrome: the one primary button per surface, the active rail pill, links, focus rings, selected checkboxes and toggles, progress bars. Where it may not: backgrounds of headers, group headers, tab bars, icons at rest, decorative illustrations. This is the "one accent used as punctuation" rule in operational form.

### 4.4 Yellow, red, green: semantic only

The founder's constraint matches what the strong products already do. Make the rule explicit and enforceable in code by giving these hues no generic tokens at all; only `success.*`, `warning.*`, `danger.*` exist, so a developer cannot reach for "yellow" for decoration.

| Meaning | Tokens (light) | Contrast (verified) |
|---|---|---|
| Success / done / on track | `success.bg #ECFDF3`, `success.text #15803D`, `success.solid #15803D` (white text) | text on bg 4.76:1; white on solid 5.02:1 |
| Warning / at risk / due soon / working on it | `warning.bg #FFFAEB`, `warning.text #854D0E`, `warning.solid #FACC15` with `N800` text | text on bg 6.57:1; N800 on solid 10.1:1 |
| Danger / overdue / blocked / destructive | `danger.bg #FEF3F2`, `danger.text #B42318`, `danger.solid #D92D20` (white text) | text on bg 6.05:1; white on solid 4.83:1 |
| Info / neutral status | blue-50 / blue-700 | 5.47:1 |
| Not started / none | N100 / N600 | n/a |

Usage rules (from Atlassian, Polaris, monday's own brand guidance, and the screens):
1. A semantic colour must always be accompanied by a word or glyph (Done, Overdue, a check or exclamation icon). Colour alone is never the only signal.
2. Default status chips are the pale form (bg + text), like Notion, Asana and Height. Solid fills are reserved for one dense surface where scanning matters (monday-style status column in Tables/Boards), and there the whole column is solid, not a mix.
3. Never use yellow solid with white text (fails at ~1.7:1); never use green-600 `#16A34A` with white text (3.3:1); use the 700 step.
4. Red is reserved for overdue/blocked/destructive. Priority "urgent" may be red, but "high" should not be (ClickUp's red/yellow/blue flags spend the whole palette on one field). WorkwrK priority: urgent = danger text glyph, high = N800 filled glyph, normal = N500, low = N400.
5. No hue-keyed spaces, folders or groups by default (monday and ClickUp both colour these; the founder has rejected it). Icons and avatars may carry a user-chosen colour from a small muted set, and that set excludes the three semantic hues so a green folder can never look "done".
6. Charts follow the dataviz skill's brand-neutral palette; the semantic trio appears in charts only when the series genuinely mean success / warning / danger.

### 4.5 State colours

| State | Treatment |
|---|---|
| Hover (rows, menu items) | `N100` fill, no colour change on text, no transform (existing rule) |
| Selected row | `blue-50` fill + `N800` text; selected + hover `blue-100` |
| Active nav item | secondary sidebar: `N100` fill + 590 weight; rail: `blue-50` pill + `blue-700` |
| Focus visible | 2px `blue-600` ring at 2px offset on all interactive elements (keyboard only, `:focus-visible`) |
| Disabled | `N400` text, `N50` fill, 1px `N200` border, no opacity hacks on text |
| Drag ghost | white card, `0 8px 24px rgba(16,18,21,.12)` shadow, the one place a shadow is allowed besides popovers |
| Error input | 1px `danger.solid` border + `danger.text` helper text |
| Loading | skeleton bars in `N100` on N0, no spinners inside content |

### 4.6 Dark mode strategy

Follow Linear's generation model and Material's dark-theme rules, not a colour-by-colour inversion:

- Base surface `N900 #101215` (not pure black), raised surface `#181B20`, second elevation `#1F232A`. Elevation = lighter surface, not shadow (Material). Borders `#262A31` and `#30353D`; borders are barely visible by design (Linear: structure felt, not seen).
- Text: primary `#E6E8EC` (15.3:1), secondary `#9AA3B2` (7.4:1), placeholder `#6B7280`.
- Accent: keep `#0073EA` for solid buttons (white text 4.53:1 still passes), but lift accent text and icons to `#4D9CFF` (6.7:1) or `#7AB8FF` (9.1:1). Never use blue-700 on dark.
- Semantic in dark: desaturate and lighten (Material). `success.text #4ADE80` on `success.bg #0F2A1A`; `warning.text #FCD34D` on `#2A2208`; `danger.text #F87171` on `#2C1212`. All 6.7:1 or better on the base surface.
- Selected row on dark: 10 to 12 % blue tint (`rgba(0,115,234,.14)`), not blue-50.
- Implement as the semantic layer re-mapped under `[data-theme="dark"]` plus `prefers-color-scheme`, with no component-level colour literals. Generate the scales in OKLCH/LCH so equal-lightness steps look equal (Linear's reason for abandoning HSL); offer a "high contrast" toggle that raises the contrast variable instead of a second theme.

### 4.7 Contrast table (computed, WCAG 2.x relative luminance)

| Pair | Ratio | Verdict |
|---|---|---|
| white on `#0073EA` | 4.53 | AA text (borderline; keep button labels 14px+ at 590 weight) |
| `#0073EA` on white | 4.53 | AA, but prefer `#0B5FC2` (6.12) for body links |
| `#0B5FC2` on `#EAF3FE` | 5.47 | AA |
| N800 on white / N50 | 15.5 / 14.5 | AAA |
| N500 on white / N50 | 4.97 / 4.64 | AA (secondary text passes on both) |
| N400 on white | 2.58 | decorative only |
| `#15803D` on `#ECFDF3` | 4.76 | AA |
| white on `#16A34A` | 3.30 | fail: do not use green-600 solid |
| `#854D0E` on `#FFFAEB` | 6.57 | AA |
| N800 on `#FACC15` | 10.1 | AAA (yellow always carries dark text) |
| `#B42318` on `#FEF3F2` | 6.05 | AA |
| white on `#D92D20` | 4.83 | AA |
| dark: `#E6E8EC` on `#101215` | 15.3 | AAA |
| dark: `#9AA3B2` on `#101215` | 7.38 | AAA |
| dark: `#4D9CFF` on `#101215` | 6.71 | AA+ |

Non-text UI (borders, icons at rest) needs 3:1 only when it is the sole affordance; N200/N300 borders are fine because inputs also have labels and focus rings.

### 4.8 Watch-out: `#0073EA` is monday's product blue

Vibe's `--primary-color` is `#0073EA`. Combined with green/yellow/red status fills on white, WorkwrK screenshots will be read as monday. This is not a reason to change the brand; it is a reason to differentiate on the other four levers: (1) cooler, quieter neutrals (monday's are warm-grey `#323338` / `#676879`); (2) pale status chips by default instead of solid cells; (3) outline icons at 1.5px stroke and a different type family (monday uses Figtree/Roboto; Inter or a similar grotesk reads closer to Linear/Notion); (4) the four-dot logo motif used as the loader and empty-state illustration language, never coloured group bars.

---

## 5. Settings information architecture

### 5.1 How the references split it

| Product | Container | Top-level groups | Personal vs workspace vs admin |
|---|---|---|---|
| Linear | full-page takeover, left list, "Back to app" | Account (Preferences, Profile, Notifications, Security & access, Connected accounts, Agent personalization); Issues (Labels, Templates, SLAs); Projects; Features (AI, Initiatives, Documents, Customer requests, Pulse, Asks, Emojis, Integrations); Administration (Workspace, Teams, Members, Security, API, Applications, Billing, Import & export); Your teams | Account = you; Features + Administration = workspace/admin; Teams = scoped |
| Notion | modal, left list | Account (name, Preferences, Notifications, Connections); Workspace (General, People, Analytics, Import); Features (AI, Connections, MCP, Verified pages, Public pages, Emoji); Admin (Teamspaces, Security, Identity); Access & billing (Requests, Billing, Explore plans, credits) | explicit "Account / Workspace / Admin" labels |
| Slack | Preferences modal (13 items) + separate admin web app | Preferences: Notifications, Navigation, Home, Themes, Messages & media, Language, Accessibility, Mark as read, Audio & video, Connected accounts, Privacy, Advanced. Admin: Account group + Administration group (Settings & permissions, Manage members, User groups, Invitations, Billing, Profiles, Authentication…) | physically separate surfaces |
| Asana | Settings modal (Profile, Notifications, Email forwarding, Account, Display, Apps, Hacks) + Admin console | personal in modal; org in console | separate surfaces |
| monday | full-page Administration, left list + tabs per page | General, Customization, Users, Security, API, Billing, Usage stats, Tidy Up, Content directory, Apps, Permissions; personal profile is a separate avatar menu | admin-only page |
| ClickUp | full-page "All settings", one long list | Workspace group (15 items) then "[Your name]" group (8 items) | two groups, one list |

Common lessons: every product labels the split explicitly; Linear and Notion are the clearest because the group name says who the setting is for; ClickUp shows what happens without sub-grouping (23 items, one list). Search inside settings is a fallback, not primary navigation (Eleken), but Linear-scale lists benefit from a filter field at the top of the settings sidebar.

### 5.2 Recommended IA for WorkwrK

Container: keep the full-screen takeover with a left list, "Back to app" top-left, and a filter field above the list. Group labels are the audience:

- **You**: Profile, Preferences (theme, density, language, start of week, date format), Notifications, Security & access (password, sessions, 2FA), Connected accounts, Sidebar (which sections you show).
- **Workspace** (visible to admins and owners; members see read-only where relevant): General (name, URL, logo, mission & values / Identity, timezone), Members, Teams & hierarchy, Permissions & roles, Apps in rail (the existing hide/floor/order), Modules (Talk, Tables, the ClickApps equivalent), Task types, Statuses & templates, Import & export.
- **Governance** (the alignment layer, scoped by role): KRA / KPI / OKR cadence, Reviews, SOP publishing, Thresholds.
- **Billing & plan**: Plan, Invoices, Usage.
- **Scoped objects** (Space, Folder, List) keep their own settings in "…" modals and never appear in the global list.

Behaviour: toggles and selects auto-save with a quiet inline "Saved" tick (Notion, Linear "Team identifier updated" toast); text-heavy forms use a sticky save bar that appears only when dirty (monday's "Save changes" is disabled until dirty; Eleken's recommended hybrid). Destructive actions live at the bottom of their page, in a bordered "Danger zone" with a typed-confirmation modal (Notion's delete-account pattern).

---

## 6. Component-level simplicity: what to standardise

One spec per component, taken from the best example, tuned to WorkwrK's 14px base.

**Tables / lists**
- Row 36px default, 32px compact (user preference, stored per user). Header 32px, `N50` background, 12px 590-weight `N500` labels. No zebra striping; hairline `N200` separators only in tables, none in lists (Linear).
- First column is the title; it is the only column with 590 weight. Metadata columns 14px `N600`. Right-align numbers, tabular figures.
- Selection checkbox appears on hover/selection only (Linear, Notion); bulk actions in a floating bottom bar with count and 4 to 6 actions (ClickUp), dismissible.
- Column "+" at the end of the header opens the field-type list (Asana), with "Show more" after 10 items.
- Inline "+ Add task" as the last row of each group, ghost style, no coloured header when the group is empty; empty groups collapse to a single header line.
- Sheets-grade tables keep the existing "does Google Sheets have it?" bar; no selection chrome.

**Kanban cards**
- 280px column, 12px gap, `N50` column background with 14px 590 header and grey count. Card: white, 1px `N200` border, radius 8, 12px padding, no shadow at rest (shadow only while dragging).
- Card content order and maximum: title (14px, 2-line clamp); one row of at most 3 pale chips (status is implied by the column so never shown on the card; priority glyph, due date, one label); bottom row avatar(s) right, identifier left in 12px `N500`. Anything else is hidden behind "Display" settings (Linear's card is identifier, title, chips, "Created" date and nothing more).
- Column "+" ghost button at the bottom; "+ Add section" as a dashed ghost column.

**Forms**
- Labels above inputs, 13px 590 `N700`; helper text 13px `N500` below; inputs 36px, radius 6, `N300` border, `blue-600` 2px focus ring. Full width in modals, max 480px on pages (Linear settings cards).
- Group related fields in white cards with a 16px title and one-line description (Linear settings), maximum 5 fields per card, then a new card.
- One primary button per form, right-aligned in modals, left-aligned under the last field on pages. Secondary is a text/ghost button. No tertiary.
- Selects, dates and people are pickers (below), never native selects.

**Modals and drawers**
- Sizes: 400 (confirm), 560 (create/edit), 720 (rich create like New issue with description), 960 max (editors). Radius 12, no shadow heavier than `0 8px 32px rgba(16,18,21,.16)`, 40 % `N900` scrim.
- Header: title 16px 590 + optional 14px `N500` description; Escape and outside-click close; footer has Cancel (ghost) and one primary. No stacked modals; pickers inside a modal must be absolutely positioned children (existing rule).
- Drawer: right, 520px, full height under the top bar, own header with expand / copy link / close, same URL as the full page. Content is the same component as the page.

**Pickers (status, assignee, date, label, priority)**
- One popover component: search input at the top (auto-focused), list of 32px rows with 16px glyph + label + optional shortcut hint on the right, keyboard navigable, multi-select shows a check on the right (Linear). Width 240 to 280.
- Status and priority pickers show the glyph exactly as it appears in the list so users learn the vocabulary once.
- Date picker: single month grid, quick chips "Today / Tomorrow / Next week / No date" at the top, natural-language input (Linear, Notion). Reuse DatePlanner tabs only on the task detail, not in pickers.
- People picker: avatar + name + secondary email in grey; "Invite by email" as the last row (monday Board Members).

**Toasts**
- Bottom-left (Asana, ClickUp) or bottom-right (Linear); pick one, bottom-left keeps clear of the drawer. White card, 1px `N200` border, 14px text, optional 12px second line, one text action (Undo) and a close icon. Auto-dismiss 5s (8s if it has an action). Neutral colour by default; a small `success`/`danger` glyph at the left is the only colour. Never for validation errors (use inline) and never stacked more than 3.

**Empty states**
- Template (Linear): 96px line illustration in `N300` (use the four-dot motif), 16px 590 title, 14px `N500` two-line copy, one primary button (with shortcut hint), one ghost "Learn more". Centred vertically in the content area. For lists and boards that are empty because of filters, replace the illustration with "No results · Clear filters" inline (Linear's "1 issue hidden by filters · Clear filters" footer).
- For new workspaces, prefer Notion's "Get started with" chip row and a checklist over illustrations.

**Chips (existing Chip/StatusChip)**
- Pale form by default: `*.bg` fill, `*.text` text, 12px 590, 22px height, radius 6, optional 12px glyph. Solid form only on dense status columns. Taupe stays the neutral "label" accent so labels never compete with status.

**Icons**
- One outline set (Lucide or equivalent), 16px in rows and 20px in the rail, 1.5px stroke, square caps, no filled variants except the status glyphs. Never colour an icon except: active rail item (blue-700), semantic glyphs, and destructive menu items (danger.text). Every icon-only button has a tooltip and an `aria-label`. Reduce icon count per row to two.

**Type scale (matches the existing 14px base)**
- 20/590 page title; 16/590 section and modal titles; 14/400 body and rows; 14/590 emphasised row title; 13/400 helper and secondary; 12/590 group labels and chips; 10 floor for rail labels only. Line-heights 1.4 for body, 1.25 for titles. One family (Inter or the current system stack), weights 400/500/600 only.

**Spacing and shape**
- 4px grid: 4/8/12/16/24/32/48. Content padding 24. Card padding 16. Radius: 6 inputs and chips, 8 cards and menus, 12 modals, full for avatars and pills.
- Borders over shadows everywhere except popovers, drag ghosts and modals. One border colour for structure (`N200`) and one for inputs (`N300`).

**Motion**
- 120 to 180ms ease-out for state changes; 200 to 250ms for drawers and modals; no hover transforms (existing rule); reduced-motion respected.

---

## 7. Applying it to WorkwrK's 8-hub shell

- **Rail labels.** Adopt Slack/ClickUp's labelled rail; the eight hubs are already verbs/nouns users know (Work, Room, Docs, Tables, Goals, People, SOPs, Settings). Make sure no two labels start with the same word and none exceeds 9 characters.
- **Secondary sidebar per hub.** Top three rows are personal (Home, My work, Inbox) in the Work hub; other hubs start directly with their tree. Favorites next, then the access-derived tree. Keep the existing "Customize Sidebar" footer as the entry to per-user hiding and appearance.
- **Top bar.** Collapse the quick-tools row into "+ Create" and one "Tools" menu; keep the Reminders bell; centre the search.
- **Detail views.** Drawer by default for tasks, rows and people; page for docs, SOPs, reviews and goals; both share the URL. Keep BackButton on pages.
- **Colour migration.** Replace any hue-keyed spaces/folders/groups with neutral icons; move status to pale chips; audit every use of yellow/red/green in components and re-point them to `success/warning/danger` tokens; remove any remaining violet/purple or taupe used as a primary.
- **Mission & values splash and loaders.** Use the four-dot motif in `N300`/`blue-600` only; no illustration colours from the semantic trio.
- **Modules.** Present Settings → Modules exactly like ClickApps: a card per module with a one-line description and one toggle; new orgs start with the minimum on. This is the single biggest lever for "any business can adopt it."
- **Empty-state sweep.** Every hub landing page gets the Linear template; every empty list gets the inline "+ Add" row and collapsed groups; every "no results" gets the "Clear filters" footer.

Risks to name: Monday-clean plus monday's blue is a look-alike risk (4.8); labelled rail costs 16px of width versus icon-only; drawer-by-default needs the URL-per-drawer work before it ships; the semantic-only rule requires removing colour pickers from spaces/folders/groups, which some users see as a feature (monday, ClickUp).

---

## 8. Open questions for the founder / design lead

1. Rail width: labelled 64px rail (Slack/ClickUp) versus icon-only 48px with tooltips (Linear has no rail at all). Recommendation is labelled; confirm.
2. Task click target: drawer-first (Asana/ClickUp) or page-first (Linear)? Recommendation is drawer with expand; confirm because it changes BoardItemDetail routing.
3. Status chips: pale by default everywhere, solid only in Tables/Board status columns? Or pale everywhere including Tables (more differentiation from monday, less scannability)?
4. Neutral temperature: cool bias per brand, or the near-neutral "warm-grey" Linear moved to in 2026 for calmness? This brief assumes cool, low-chroma.
5. Type family: keep the current system stack or standardise on Inter (Linear/Notion-adjacent look, differentiates from monday's Figtree)?
6. Whether user-chosen icon colours for spaces/folders survive at all, and if so, which muted set (excluding the semantic hues).
7. Settings container: keep the full-screen takeover for everything (recommended) or split personal preferences into a modal (Slack/Asana/Notion)?
8. Should "Governance" be its own settings group or fold under Workspace? Depends on how many SMB admins will ever touch KRA/KPI cadence.

---

## 9. Sources

Primary design writing
- Linear, "How we redesigned the Linear UI (part II)": https://linear.app/now/how-we-redesigned-the-linear-ui
- Linear, "A design reset (part I)": https://linear.app/now/a-design-reset
- Linear, "A calmer interface for a product in motion": https://linear.app/now/behind-the-latest-design-refresh
- Linear changelog, "UI refresh" (2026-03-12): https://linear.app/changelog/2026-03-12-ui-refresh
- Linear changelog, "Custom themes" (LCH theme generation): https://linear.app/changelog/2020-12-04-themes
- Asana, "Developing Design Principles": https://asana.com/inside-asana/design-principles
- First Round Review, "Here's how Asana won with its product redesign": https://review.firstround.com/heres-how-asana-won-with-its-product-redesign/
- Notion, "New sidebar design will help Notion scale": https://www.notion.com/blog/new-sidebar-design
- Notion 3.4 release notes (sidebar tabs): https://www.notion.com/releases/2026-03-26
- Notion help, "Navigate with the sidebar": https://www.notion.com/help/navigate-with-the-sidebar
- monday brand colours: https://www.brand-monday.com/colors
- Vibe design system (monday): https://vibe.monday.com/ and https://developer.monday.com/apps/docs/vibe-design-system and https://github.com/mondaycom/vibe
- MIT IS&T, Slack redesign notice (rail contents): https://ist.mit.edu/node/4281
- Fast Company on the Slack redesign: https://www.fastcompany.com/90974178/got-the-slack-redesign-try-these-tips
- Creative Bloq on the Slack redesign: https://www.creativebloq.com/news/slack-redesign
- ClickUp help, "Intro to the Sidebar in ClickUp 3.0": https://help.clickup.com/hc/en-us/articles/12755292456983-Intro-to-the-Sidebar-in-ClickUp-3-0
- ClickUp help, "Intro to ClickApps": https://help.clickup.com/hc/en-us/articles/6304327753111-Intro-to-ClickApps
- ProcessDriven, ClickApps explained: https://processdriven.co/clickup/how-to-use-clickup/clickapps-explained-clickup-tutorial-for-workspace-admin-settings/
- Juliety, ClickUp 3.0 review: https://juliety.com/clickup-3-0-review
- Height 2.0 launch and release notes: https://height.app/blog/introducing-height-2-0 and https://height.app/blog/releasenotes_v2

Pattern and system references
- NN/g, Breadcrumbs: https://www.nngroup.com/articles/breadcrumbs/
- NN/g, Progressive disclosure: https://www.nngroup.com/articles/progressive-disclosure/
- Radix Colors, Understanding the scale: https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale
- Material Design, Dark theme: https://m2.material.io/design/color/dark-theme.html
- Atlassian Design System, Iconography: https://atlassian.design/foundations/iconography
- Eleken, Settings page UI guide: https://www.eleken.co/blog-posts/settings-page-ui
- uxdesign.cc, "UX cheat sheet: preview and full display": https://uxdesign.cc/ux-cheat-sheet-preview-and-full-display-a912aad49da7
- designsystems.one, Linear design system breakdown: https://www.designsystems.one/design-systems/linear
- raw.studio, Notion UX principles: https://raw.studio/blog/how-notion-ux-converts-100-million-users/
- Kompassify / Pencil & Paper on empty states: https://kompassify.com/blog/empty-states-guide and https://www.pencilandpaper.io/articles/empty-states
- Carbon Design System (data table density, notifications, modal, empty states; fetched pages truncated, cited for the standard values): https://carbondesignsystem.com/components/data-table/usage/

Mobbin screens (all links inline in section 1; Mobbin MCP search, web platform)

Notes on evidence quality
- Vibe token hex values in 3.3 are from Vibe's public token map as commonly documented, not re-fetched this session (the Storybook site is JS-rendered and the GitHub raw path has moved). Verify before copying.
- Height's site was intermittently unreachable; Height details come from Mobbin screens and third-party reviews.
- Contrast ratios in 4.7 were computed locally (WCAG 2.x relative-luminance formula) for the proposed hex values.
