# Settings clean-up plan

2026-10-24. Audit and plan only: no code under `src/` was changed. Branch `agents-p1` (same as `main`, `36441755`).

**Scope:** every page in both settings doors:

- Workspace settings: 15 pages, `/settings/*`.
- My settings: 7 pages, `/account/*`.

**Why:** the founder said "the entire setting section ... is not clean, it is not aligned well, not planned well".

**Evidence:** `/Users/bigboldtechnologies/workwrk-launch-backup/settings-audit/`.

- `before/`: 59 screenshots (listed in A.3), plus `metrics-before.json`. The metrics give, per view: every card's left edge, right edge, width and padding; the gaps between cards; every heading's size; the blue buttons; native selects; help text longer than 2 lines; the height of every control; the font sizes used; and overflow.
- `tools/batch-shot.mjs` and `tools/jobs.template.json`: the same capture, so the after-pass is like for like. To run it:
  1. Put `admin.cookie` and `emp.cookie` from `scripts/dev/login.sh` in one folder.
  2. Run `sed "s#\$SCRATCH#<that folder>#g; s#\$SET#after#g" jobs.template.json > jobs.json`.
  3. Run `node batch-shot.mjs jobs.json ../after/metrics-after.json` against a dev server on :3016.

**How the shots were taken:**

- Server: my own dev server on :3016 with `MCP_OFFERED=1`, local Postgres only.
- Accounts: `verify.admin@acmecorp.com` (orgRole Admin) and `verify.employee@acmecorp.com`.
- Size: 1440 wide, the viewport stretched to each page's full height, and 4 pages at 390 wide.
- Not visible locally: the two AI teammates cards on Apps & modules (Google, and the computer for teammates) are behind flags that are off here. Their code uses the same pattern as the AI apps (MCP) card and has the same faults. The founder's proof shots are in `proof-runs/final-3/shots/settings-*.png`.

**Authority:** in this order:

1. The founder's standing preferences: Zoho-clean, compact headers, a 14px base and 10px floor, no em dashes, no hover transforms, build only from shared parts.
2. `docs/plans/ui-refresh/design-system.md` (DS).
3. `spec-settings-workspace.md` (SW).
4. `spec-account-auth.md` (AA).
5. `spec-shell.md` §2.8.
6. `settings-architecture.md`.

Where these disagree, the conflict is named where it is decided.

---

## A. What is wrong

### A.1 By pattern (worst first)

**P1. The page content is drawn off the 4px grid.**

- **Cause:** `settings-shell.tsx:397` sets `<main>` back to `--spacing:0.25rem` and rem radii. The product root is 14px, so every Tailwind size inside a settings page renders at 87.5%:
  - card padding `p-6` is 21px, not 24 (DS 3.1, 5.4);
  - the gap between cards `gap-6` is 21, not 24;
  - inputs, buttons and pickers `h-9` are 31.5px, not 36 (DS 3.3);
  - rows `min-h-12` are 42, not 48 (DS 5.4, SW 1.7.5);
  - card radius is 7, not 8.
- **Mixed with exact sizes:** the page header carries `.os-chrome`, so it is exact (title row 40, pills 28). But the tabs row is 36 on pages without a subtitle and 31.5 on pages with one. Pages with a subtitle draw the tabs outside the header (`settings-page.tsx:139,158`).
- **Measured:** 31.5px controls appear on 30 of the 43 desktop views (`ctrlHeights` in the metrics).
- **Why it matters:** this is most of the "not aligned" feeling. Nothing lines up with the 24px header above it.

**P2. Two or three card widths on one page, and widths that change between tabs.**

- **Cause:** `SettingsCard` caps cards at 560 unless they are on the `WIDE_SETTINGS_CARDS` list (760) (`settings-card.tsx:86`). List pages then add tables at the full fluid width (1064 at 1440).
- **Ragged right edge (same page):**
  - `workspace-apps` (560/760)
  - `workspace-access` and `workspace-access-matrix` (560/760)
  - `workspace-scoring` (560/760)
  - `workspace-security-provisioning` (560/760, and the button aligned to 1112)
  - `workspace-data-import` (560/760)
  - `workspace-members-pending` (560/1064)
  - `workspace-structure-chart` (760/1064)
  - `workspace-structure-fields` (540, indented 24px, /1064)
  - `account-notifications` (560/760)
  - `account-security` (560/760)
- **Width jumps between tabs of one page:**
  - Members: 1064 / 760 / 760 / 1064.
  - Task system: 1064 / 1064 / 560.
- **Header against cards:** the subtitle spans 760 while the cards are 560, so Locale's subtitle wraps past the cards' edge.

**P3. Headings said twice, and six heading styles.**

- **Said twice:**
  - "MODULES" then "Modules" (Apps).
  - "AI APPS (MCP)", then "AI apps (MCP)", then "Let people connect AI apps (MCP)": three times in 60px.
- **Six styles in use:**
  1. Uppercase label at 11px (Apps, Overview).
  2. Uppercase label at 12px inside a card (Identity › Appearance defaults: "DEFAULT APPEARANCE", "LOCKED CONTROLS").
  3. Card title at 16/600.
  4. 15/500 (Access › Public links, Members › Teams cards).
  5. 14/600 (Task system "Active types", "Recommended", the tag group titles).
  6. A bare 16px heading outside any card (Data "Recent exports").
- **The section label is copied, not shared:** five copies of the class string (`apps/page.tsx:98` and `:574`, `mcp-section.tsx:50`, `teammate-browser-section.tsx:56`, `teammate-google-section.tsx:109`) plus a sixth `Section` in `data/page.tsx:844`.

**P4. Walls of help text.**

- **Measured:** 17 help or description blocks of 3 to 6 lines at 13px, plus prose walls at 14px:
  - Apps › Allowed apps: 5 lines.
  - Data › Full workspace: 6.
  - Billing › AI questions: 6.
  - Security › Invitation domains: 4.
  - Identity › Appearance defaults: a 3-line description plus a 4-line blue callout.
  - Access › How access works: 14 lines.
  - Access › Rules that add to a share: 10 rules, 20 lines.
  - Access › Legacy: 7 lines over the grid.
  - Connections › AI apps: 5 lines.
  - Data › Trash: 4 lines.
- **Wrapping hints:** the switch hints wrap to 2 lines on Apps, Data › Retention and Notifications.
- **What it breaks:** DS 5.4 gives a row one 13px description and a card one 13px description.

**P5. Every page builds its own cards.**

- 33 files draw their own bordered boxes instead of `SettingsCard`.
- **Visible variants:**
  - Apps › Requests: header strip, 12px padding.
  - Access › Public links: header strip, 16px padding.
  - Members › Teams: 14px padding.
  - Task system › Tags: 14px padding, 14px titles.
  - Connections: icon-tile header, 20px padding.
  - Data › Legacy: an icon plus lighter grey text.
- **Three link-card styles for the same job:**
  - Org chart: an 80px illustration tile.
  - Templates: an 80px illustration tile.
  - Trash: a 24px icon.
- **Cards inside cards:**
  - Apps › Rail apps: bordered lists inside the card.
  - Identity › Appearance defaults: a bordered sub-card, a bordered lock list and a blue callout, all inside one card.
  - Data › Export: an uppercase "LEGACY" label inside the card.

**P6. Native selects and a native date field.**

- **The rule:** DS 5.4 says "Selects, dates and people are pickers (5.6), never native".
- **The cause:** `NativeSelect` (`settings-form.tsx:232`) is used in 9 files.
- **Where:**
  - 27 selects on Apps › Rail apps.
  - Members' Sort.
  - Invite rules › Default role.
  - Scoring's weekday.
  - Locale's Fiscal year, which sits in the same card as Picker-based Time zone and Currency fields.
  - Templates' default type.
  - The member drawer.
- **Also native:** the Profile Date of birth is `type="date"` (`account/profile/page.tsx:227`), and Scoring and the Access legacy grid use native checkboxes.
- **The fix already exists:** `PickerSelect` (`components/settings/picker-select.tsx`) is the shared part.

**P7. The toolbar and the one blue button move around.**

- **Correct (Filter and Sort at the left, primary at the right):** Members, Departments, Job titles, Audit.
- **A lone primary on its own row:** Task types "New type", Offices "New office", API "Generate key", Provisioning "Generate token".
- **A secondary button floating above a table:** Members › Pending invites, "Invite people".
- **Sort in two forms:** a native select at the right (Members) against the Sort chip at the left (Audit "Newest first", Structure).
- **Disabled primary:** it renders pale blue ("Add field" on Structure › Profile fields), not grey (DS 5.10).

**P8. Four empty-state styles.**

1. A bordered card with a tile and two lines (Members › Guests).
2. An inline row with a link (Offices, API: correct per DS 5.1).
3. Plain text: "No cost centers yet." 6 times on Tags, "No open requests.", "Nobody has asked for a connector yet.".
4. A bordered box (Structure › Profile fields).

**P9. The header stack differs from page to page.**

- 13 of 22 pages have a subtitle; Billing, Members, Structure, Task system, Data and Audit do not.
- So the first card starts anywhere from 150px (Billing) to 302px (Structure › Profile fields), and content jumps when you move between pages.
- Notifications puts the tabs under a card, mid-page (`account-notifications`).
- The Members count strip shows only on the People tab.

**P10. Danger zones are loud.**

- `SettingsCard` uses `--os-danger-solid` for the border (`settings-card.tsx:87`) instead of `--os-danger-border` (DS 1.3, 5.4).
- Seen on: `workspace-identity-danger`, `workspace-security`, `account-profile`.

**P11. Captions and links float between cards.**

- "Workspace sign-in policy" (My settings › Security).
- "Ask your manager or the People team..." (Profile).
- The Preferences › Sidebar footer.
- Identity's "Time zone ... are on Locale & work week".
- The Connections footnote.
- Scoring's "Open the talent grid".
- API's "Integrations".
- The Apps footer links, which repeat the links already in the Requests cards.

**P12. Mobile at 390.**

- "Back to app" wraps to two or three lines (`settings-shell.tsx:265`).
- Rows never stack, so the label column is squeezed:
  - Profile "Delete my account": 10 lines of hint in a 90px column.
  - Notifications: "Preset" is clipped to "Pre".
- Apps › Module tiles overflow their card (`minmax(300px,1fr)`, `modules-section.tsx:89`).
- The Rail apps description collapses into a 60px column of 15 lines beside "Reset to the default order".
- Rail row names hide behind fixed-width selects.
- Members tabs are cut ("Pending inv").
- What works: the page body itself never scrolls sideways (`overflowDoc` is 0 everywhere).

**P13. Small faults and copy.**

- The Modules card description talks about connector requests (they belong to Requests).
- "Rail hub" captions all 8 hub rows under a group already named "Rail hubs".
- The column headers are hand-aligned with `gap-[108px]` and miss their columns (`apps/page.tsx:371`).
- The Appearance defaults lock row "Sidebar layout ... (icons-only)" describes a feature DS 4.1 removed.
- One setting, two components: Theme is three big tiles saying "Auto" on Workspace › Appearance defaults, and a segmented control saying "System" on My settings › Preferences (DS 5.12 says segmented control).
- A tag chip is brand blue (DS 5.9: label chips are neutral).
- Billing's plan name is a 22px fifth size.
- Data's "Retention & privacy" tab has no retention row.

**What is already right, so builders keep it:**

- No page shows more than one blue button.
- No em dash or double hyphen appears in rendered copy.
- No hover transforms.
- The type sizes are on the scale.
- The takeover sidebar matches spec-shell §2.8.
- Members, Departments, Job titles and Audit are good list pages.

### A.2 By page

Screenshot names are under `settings-audit/before/`. "P#" points at A.1.

**Workspace settings**

| Page | Shots | What is wrong |
|---|---|---|
| Overview | `workspace-overview` | Inside a tile, the values start at the tile edge while the title and description start after the icon: two left edges per tile. "All settings" sits alone under BILLING. The crumb ends at "Workspace settings", without "Overview" (SW 1.1). The search field is 480 here and 560 on All settings. |
| Identity & culture | `workspace-identity`, `-culture`, `-appearance`, `-danger` | **Profile:** the "@" sits outside the domain input, and a link floats under the cards (P11). **Appearance defaults:** a card inside a card inside a card, 12px uppercase labels, a 3-line description plus a 4-line callout (P3, P4, P5); Theme tiles say "Auto" (P13); the icons-only lock row is dead (P13). **Danger:** loud border (P10), and the "Transfer ownership" row has no control. |
| Locale & work week | `workspace-locale` | The subtitle wraps 2 lines past the cards. Fiscal year is native (P6). The Work week card has its own chip style (dark-bordered day toggles), larger gaps and a 3-line description. |
| Apps & modules | `workspace-apps`, `workspace-apps-390`, founder shots `settings-*.png`, `off-settings-apps*.png` | Two widths (P2). Headings said twice (P3). The Allowed apps hint is 5 lines and the switch hint 2 (P4). The Requests section is a label, a paragraph and two cards in their own style (P5). 27 native selects (P6). The Modules description holds Requests copy. "Rail hub" repeated 8 times. The column headers are misaligned (P13). Bordered lists inside the Rail apps card (P5). The footer links repeat the Requests links (P11). The page is 3370px long, with AI apps below 30 rail rows. It is the worst page at 390 (P12). |
| Members | `workspace-members`, `-guests`, `-teams`, `-pending`, `workspace-members-390` | **People:** good, but Sort is a native select beside Invite (P6, P7), and the count strip shows on this tab only (P9). **Guests:** empty-state card style 1 (P8). **Teams:** narrows to 760, with 14px-padded team cards and a plain-text intro (P2, P5). **Pending:** a 560 form above a 1064 table, "Invite people" floating, and a native Default role (P2, P6, P7). |
| Structure | `workspace-structure`, `-titles`, `-offices`, `-fields`, `-chart` | Departments and Job titles: good. **Offices:** a lone primary, and a second "Add an office" link (P7). **Profile fields:** the body is indented 24px and 540 wide, with a pale-blue disabled primary (P2, P7, P8). **Org chart:** a 760 link card with an illustration above the 1064 role strip (P2, P5). On every tab the role strip sits under the table; the spec puts it first in the body. |
| Access | `workspace-access`, `-matrix` | 14 lines of prose (P4). Public links has its own header strip and is 560 among 760 cards (P2, P5). "Access switches" is a card with one row. **Legacy:** a label, 7 lines, and a grid that overflows its card (the Member column is cut at the right edge), with native checkboxes. **Matrix:** a 760 table, then two 560 prose cards of 10 or more rules each. |
| Task system | `workspace-tasks`, `-tags`, `-templates` | **Types:** a lone "New type" row; 14/600 headings (P3); round category pills unlike any other chip; 13 "Add" buttons. **Tags:** custom group cards, 6 repeated "No X yet." lines (P5, P8), a blue tag chip, and "Show archived" beside the search. **Templates:** the width drops to 560 (P2), a link card with an illustration, and a native select. |
| Scoring & reviews | `workspace-scoring` | Review cadence is 760 and Behavioural anchors 560 (P2). A native weekday select and native checkboxes (P6). Four "Reset to defaults" buttons. |
| Security | `workspace-security`, `-provisioning` | **Sign-in policy:** hints of 3 and 4 lines with inline links (P4), loud danger border (P10). **Provisioning:** a lone "Generate token" aligned to the 760 edge, the SCIM card at 560, the table at 760 and the explainer at 560 (P2, P7). |
| Data | `workspace-data`, `-import`, `-retention`, `-trash` | **Export:** a 6-line hint, "LEGACY" inside the card, and "Recent exports" as a bare heading (P3, P4, P5). **Import:** 760, 560, and a legacy box with lighter grey text (P2, P5). **Retention & privacy:** no retention, and 3-line hints. **Trash:** a link card with a small icon and 4 lines (P5). |
| Audit log | `workspace-audit` | A good list page. Its severity chips use `text-[10px]` (`audit/page.tsx:279`), where DS 5.9 says chips are 12/500. |
| API & webhooks | `workspace-api` | A lone "Generate key" row under the subtitle (P7). A floating "Integrations" link (P11). |
| Plan & billing | `workspace-billing` | No subtitle (P9). A 22px plan name (P13). A 6-line AI usage hint (P4). |
| All settings | `workspace-all` | Fine. Its search width differs from Overview's. |

**My settings** (the admin shots, plus `-employee` twins that look the same)

| Page | Shots | What is wrong |
|---|---|---|
| Profile | `account-profile`, `account-profile-390` | Loud danger border (P10). A caption floats under "Your place" (P11). Date of birth is a native date field (P6). At 390 the danger hint runs 10 lines (P12). |
| Preferences | `account-preferences`, `-region`, `-sidebar` | Clean. **Sidebar:** the rows without hints are 42 tall (P1), and the footer note floats at 760 (P11). |
| Notifications | `account-notifications`, `-email`, `-desktop`, `account-notifications-390` | The tabs sit under the Quiet card (P9). Muted items is 760 among 560 cards (P2). The preset description runs 3 lines (P4). At 390 "Preset" is clipped (P12). |
| Security | `account-security` | The activity table is 760 among 560 cards (P2). The "Workspace sign-in policy" link floats between cards (P11). |
| Calendar & connections | `account-connections` | A third card style (P5). The AI apps card has 5 lines of instructions (P4). A footnote under the cards (P11). |
| Keyboard shortcuts | `account-shortcuts` | Fine. |
| All settings | `account-all` | Fine. |
| (denial view) | `workspace-overview-employee` | The Ask-an-admin strip is 1064 wide over a 560 page, with no gap before the title. |

### A.3 Count

- **22 pages:** 15 Workspace settings and 7 My settings. With tabs, that is 43 desktop views.
- **59 screenshots:**
  - 32 Workspace views as Admin;
  - 11 My settings views as Admin;
  - the same 11 as the employee;
  - 1 Workspace URL as the employee;
  - 4 at 390 wide: Apps, Members, Profile, Notifications.

---

## B. The rules for every settings page

Each rule gives its reason and its source. A builder follows these and nothing else.

**B1. One content width per page, the same in every tab.**

- **Form pages: 760.**
  - Workspace: Identity, Locale, Apps, Access, Scoring, Security, Data, Billing, All settings.
  - My settings: all 7 pages.
- **List pages: fluid to 1120.** Overview, Members, Structure, Task system, Audit log, API & webhooks.
- **Every card fills the column.** There is no 560 cap and no `wide` exception.
- **The header uses the same column**, so the title, the subtitle, the tabs and the cards share one left edge and one right edge.
- **Inputs keep their own widths inside a card:**
  - the name field 360;
  - the domain field 280;
  - number fields 96;
  - textareas and chip inputs at most 560;
  - nothing stretches to 760 except tables.
- **Reason:** the ragged edges in P2 are the founder's first complaint. One width per page makes them impossible.
- **Source:** SW 1.7 and spec-shell §2.8 give the 760 and 1120 columns.
- **This replaces two rules:** DS 5.4 "width 560" and SW 1.7 "the one width deviation". That needs the founder's eye (E3).

**B2. The page header is the same stack on every page.**

- **The stack:**
  1. Title row: 40px, title 18/600 (`text-title`).
  2. One subtitle line: 13/400 `--os-ink-2`, which must fit on one line at 760, about 95 characters.
  3. The tabs row: 36px, pills 28px, 14px text. Shown when the page has more than one tab.
  4. The toolbar: 44px, only when the page or tab has Filter, Sort, a primary or a "..." menu.
- **Content starts 16px below the last row.** Tabs always sit directly under the subtitle, never under a card. The Notifications Quiet card becomes the first card of every tab.
- **The subtitle comes from one place:** a `summary` string in `SETTINGS_PAGES`, the same string the Overview tile shows. Dynamic subtitles that carry information stay dynamic: Overview's org line, My settings › Security's email.
- **Reason:** the same header height everywhere means content never jumps between pages (P9).
- **Source:** compact header (founder 2026-09-24, DS 4.4 as updated); SW 1.7 allows an optional subtitle.
- **Two conflicts settled:** the specs' 22/600 title and 32/15 pills lose to the founder's compact header. Making the subtitle required, not optional, needs the founder's eye (E3).

**B3. One heading per section.**

- **A card title (16/600) names a card.**
- **A section label** (11/600 uppercase +0.06em `--os-ink-2` with a rule; DS 4.2) exists only to group two or more cards under one name, and never repeats a card title.
- **Inside a card,** a sub-heading is 13/500 `--os-ink`.
- **No other heading styles.**
- **Reason:** P3.
- **Source:** DS 2.4 (at most three sizes), DS 5.4.

**B4. The card is `SettingsCard` and nothing else.**

- **Look:**
  - bordered `--os-line`, radius 8, 24px padding (16 below 640px);
  - title 16/600;
  - an optional description of at most 2 lines, 13/400 `--os-ink-2`;
  - ghost actions at the right of the title ("Reset to defaults", "Integrations", "Add");
  - 16px between the header and the body.
- **No bordered box inside a card.** Group inside a card with a sub-heading and rows. Inputs, chips, segmented controls and switches are controls, not boxes.
- **A card whose whole body is a table** is a `TableCard` with no outer card.
- **A link card** is a `SettingsCard` with a title, a one-line description and one text link, with no illustration (illustrations are for empty states only, DS 5.8).
- **Danger zone:** the last card, `--os-danger-border`, title in `--os-danger-text`, destructive ghost buttons.
- **Reason:** P5, P10.
- **Source:** DS 5.4, SW 1.7.

**B5. The row is `SettingsRow`.**

- **Size:** 48px minimum.
- **Left:** the label 14/500 and a hint of one line, 13/400 `--os-ink-2`.
- **Right:** the control, vertically centred: a switch, a segmented control, a `PickerSelect`, a 32px secondary button, or a text link.
- **Between rows:** `--os-line-soft` separators.
- **Stacked fields (text forms):** the label above at 13/500, a 36px input, and a one-line helper below.
- **Reason:** P1, P4.
- **Source:** DS 5.4, SW 1.7.4 and 1.7.5.

**B6. Where longer help goes.**

- **Limits:**
  - a row hint is one line;
  - a card description is two lines.
- **Anything longer goes behind "Show more":** the text-link disclosure already used on Access, `access/page.tsx:226` ("Show the grid as it stood") and the "Show the rest of the old grid" link below it.
- **What it looks like:** 13/500 `--os-brand-deep`, `aria-expanded`, collapsed by default. It opens the full paragraph in 13/400 `--os-ink-2`, inside the same card, under the row it explains.
- **Help that only restates the label is deleted.**
- **Never:**
  - a tooltip for prose (DS 5.13: tooltips are short labels, max 240px);
  - a blue callout for prose. The brand-soft strip is for one-line notices only: the read-only banner and the Ask-an-admin strip.
- **Reason:** P4. Uses only an existing pattern (founder mandate).

**B7. Spacing scale (px, 4px grid).**

| Gap | Size |
|---|---|
| Label to hint | 4 |
| Section label to its first card | 8 |
| Last header row to content | 16 |
| Between stacked fields | 16 |
| Card title to card body | 16 |
| Card padding | 24 |
| Between cards | 24 |
| Between labelled sections | 32 |
| Page padding | 24 (16 below 900) |

- **Source:** DS 3.1, SW 1.7.

**B8. Buttons.**

- **One blue button per page,** and only in one of two places:
  - the toolbar primary (create);
  - the Save bar's "Save changes".
- **Everything else is:**
  - secondary (36, bordered);
  - ghost;
  - a text link;
  - destructive ghost, in danger zones only.
- **Sizes:** 36 by default, 32 inside rows.
- **A disabled primary is grey:** `--os-surface-2` with `--os-ink-4`.
- **Filter and Sort** are toolbar chips at the left. Sort is never a native select.
- **A list tab's create button** lives in the toolbar. When the toolbar has nothing else, it still sits at the toolbar's right, at the same height as on every other page.
- **Reason:** P7.
- **Source:** DS 0.1, 4.4, 5.10; SW 1.7.

**B9. Selects, dates and checkboxes.**

- `PickerSelect` for every choice, `DateField` for dates, `SegmentedControl` for 2 to 4 options.
- Never a native `<select>` or `type="date"`.
- **Reason:** P6.
- **Source:** DS 5.4, 5.6, 5.12.

**B10. Empty states.**

- **Inside a card or table:** one inline row, "No {things} yet · {Action}", at 14/400 `--os-ink-2`, with the action as a text link.
- **A whole tab with nothing in it:** the quiet empty state, a 96px `DotsArt`, one sentence and at most one link, centred.
- **Nothing else.**
- **Reason:** P8.
- **Source:** DS 5.1, 5.8; SW 1.9.

**B11. Mobile.**

- **Below 900px** (these already exist; keep them):
  - the Pages select;
  - 16px page padding.
- **Below 640px:**
  - rows stack: label and hint on top, the control under them, left aligned;
  - cards pad 16;
  - card grids go to one column;
  - tables scroll inside their own card.
- **The takeover bar:** "Back to app" never wraps. Below 480px it is icon-only, with its tooltip and `aria-label`, the same as `BackButton compactOnPhone`.
- **Reason:** P12.
- **Source:** SW 1.6, AA "Mobile and narrow", spec-shell §2.8.

**B12. Copy.**

- No em dash, no double hyphen.
- Sentence case.
- One label per destination, read from the registry.
- Notes that belong to a card live inside it: as its last row, or as a card action. Nothing floats between cards.
- **Reason:** P11.
- **Source:** founder preference; SW 1.3.

---

## C. Shared component changes (these go first)

Each change fixes many pages at once. After them, the per-page phases are mostly deleting one-off code.

| # | Change | File | Fixes |
|---|---|---|---|
| C1 | Put the content on the px grid: drop the `[--spacing:0.25rem]` and rem radius reset on `<main>`, so the page content gets the same `.os-chrome` values as the header. Card padding becomes 24, gaps 24, controls 36, rows 48, radius 8. Then recapture all 59 views: pages that use hard-coded px (`gap-[108px]`, `w-[...]`) may shift, and every page grows about 14% taller. | `layout/os/settings-shell.tsx:397` | P1 on every page |
| C2 | `SettingsPage`: one header stack (B2) on every page: title, subtitle, tabs, toolbar, with the tabs row always 36. Remove the split path that draws a 31.5px tabs row (`:139`, `:158`). Read the subtitle from `SETTINGS_PAGES[key].summary`. Move the Overview tile descriptions (`overview-client.tsx:50` onward) into that field, so the tile and the page share one string. Add `filter` and `sort` props that pass through to `OsToolbar`. Keep one width per page for all tabs. | `components/settings/settings-page.tsx`, `lib/settings-registry.ts`, `settings/overview-client.tsx` | P1, P2, P7, P9 |
| C3 | `SettingsCard`: always fills the column. Delete the 560 cap and `WIDE_SETTINGS_CARDS`; keep `wide` as an ignored prop for one phase, then remove it. Danger uses `--os-danger-border`. Padding 16 below 640. | `components/settings/settings-card.tsx:20-41,85-87` | P2, P10, P12 |
| C4 | `SettingsSection`: lift the existing section label into one component (`label`, an optional one-line `description`, children). It sits 8px above its first card, with 32px between sections. Replace the five class-string copies and `data/page.tsx` `Section`. No new look: it is the label that is already there. | new `components/settings/settings-section.tsx`; the 6 call sites in A.1 P3 | P3 |
| C5 | `SettingsMore`: lift the Access "Show the grid" text-link disclosure into a component (`label`, children). Add a `more` prop on `SettingsRow` and `SettingsCard` that renders it. | new `components/settings/settings-more.tsx`; `settings-row.tsx`; `settings-card.tsx` | P4 |
| C6 | `SettingsRow`: stacks below 640 (B11). The 48 minimum comes from C1. | `components/settings/settings-row.tsx:72` | P12 |
| C7 | `NativeSelect` draws the existing `PickerSelect` with the same props, so all 9 importers change at once. Check every call site inside a dialog or inside an `overflow-hidden` list: Picker is a position-absolute child, so a clipping parent hides it. | `components/settings/settings-form.tsx:232` | P6 |
| C8 | The takeover bar: "Back to app" gets `whitespace-nowrap`, and is icon-only below 480 with its tooltip kept. | `layout/os/settings-shell.tsx:260-268` | P12 |

**Not changed:** `SaveBar`, `SettingsGate`, `ActiveSettingsRow`, `SettingsReadOnlyBanner`, the takeover sidebar, the `?tab=` logic, hash anchors and their border pulse.

---

## D. Phases

Each phase gets one builder, one read-only reviewer (memory rule) and one push.

Each builder:

- follows `workwrk-launch-backup/agents/builder-rules.md`;
- recaptures that phase's views into `settings-audit/after/` with `tools/batch-shot.mjs`;
- ticks F for those views.

Phase 1 recaptures all 59. The phases are ordered by how many people see the page, then by how broken it looks.

**Phase 1. The shared frame.**

- **Pages:** all of them. C1 to C8.
- **Rule:** no per-page redesign beyond what C breaks. Fix any page that C1 visibly breaks (for example the Rail apps column headers).
- **Proof:** all 59 views recaptured and compared.

**Phase 2. Apps & modules and Overview.**

- **Apps & modules:** one card per section, each with its own card title. Drop the duplicate labels.
- **Order:** Modules, Automations, then an "AI" section label over the AI teammates cards and AI apps (MCP), then "Requests" over its two cards, then Rail apps last. A contract test pins MCP after Browser, and that order is kept.
- **Requests:** the two cards become `SettingsCard`s with SettingsRow rows. The duplicate footer links go.
- **Rail apps:** column headers come from one grid. "Rail hub" captions go. Bordered inner lists become rows with the group sub-heading.
- **Long help:** the Allowed apps hint moves behind Show more. The Modules description loses the Requests copy.
- **Module tiles:** `minmax(min(300px,100%),1fr)`.
- **Overview:** the tile values align with the tile title.

**Phase 3. My settings (all 7 pages).**

- **Notifications:** the tabs go under the subtitle, and Quiet becomes the first card of each tab.
- **Profile:** the "Your place" caption moves into its card. Date of birth uses `DateField`, but only if `DateField` takes typed input; otherwise leave it and log it.
- **Connections:** the cards become `SettingsCard`, and the AI apps steps move behind Show more.
- **Captions:** the floating captions move into their cards.
- **Why it comes now:** these are the pages every person uses.

**Phase 4. Members (4 tabs) and Structure (5 tabs).**

- **Members:** Sort becomes a toolbar chip. The Teams tab becomes list width with `SettingsCard` rows. Pending: "Invite people" moves into the toolbar, and Invite rules becomes a full-width card. The Guests empty state follows B10. The count strip shows on every tab.
- **Structure:** Profile fields loses its indent and gets a grey disabled primary. The Org chart link card loses its illustration. The role strip moves to the top of the body on every tab, at the page width. Today it sits under the table; the spec puts it first (SW `/settings/structure`, "the first element of the body").

**Phase 5. Identity & culture, Locale & work week, Access.**

- **Identity › Appearance defaults:** flatten the nested boxes into one card. Theme becomes a `SegmentedControl` saying "Light · Dark · System". The dead icons-only lock row is deleted, so it no longer appears to lock a feature the rail lost (DS 4.1). This is a behaviour change: it needs its own test, and an already stored lock key must still read without error. The lock callout goes behind Show more.
- **Locale:** a one-line subtitle, Fiscal year as `PickerSelect`, and the Work week card on the shared rows and chips.
- **Access:** the prose becomes one sentence per card plus Show more. Public links becomes a `SettingsCard`. The Legacy grid becomes a `TableCard` that scrolls inside itself.

**Phase 6. Task system, Scoring & reviews, Data.**

- **Task system:** headings become card titles, the tag groups become `SettingsCard`s, the empty lines follow B10, and tag chips go neutral.
- **Scoring:** one width, plus pickers and checkboxes.
- **Data:** "Recent exports" becomes a card title, and the Legacy rows become ordinary rows. Long hints go behind Show more. The Trash card becomes a link card.

**Phase 7. Security, Audit log, API & webhooks, Plan & billing, All settings (both doors).**

- **Security:** long hints go behind Show more, and Provisioning moves to one width.
- **Audit:** the chips move to 12/500.
- **API:** the floating link moves into a card action.
- **Billing:** gets its subtitle, its plan name moves to 16/600, and the usage hint goes behind Show more.
- **Then:** the final round of 3 reviewers testing everything (memory rule), before the founder list.

---

## E. Risks

**E1. Contract tests that pin exact source text.**

- **Rule:** update them on purpose, in the same commit, saying why. Never loosen them to make them pass.
- **The tests:**
  - `src/components/account/connected-apps.contract.test.ts`: `<McpSection />` after `<TeammateBrowserSection />` on the apps page; the MCP copy import line; card ids such as `ai-apps`; the Connections page order and the Security page imports.
  - `src/components/agents/browser-ui.contract.test.ts`: `id="ai-browser"`, the exact `return null` gate line in the browser section, and button className pins in the browser panel.
  - `src/components/account/teammate-skills-list.contract.test.ts`: the exact string `<SettingsCard title="Your data" id="profile.data">`.
  - `src/lib/access/object-share.contract.test.ts`: regexes over `access-requests-card.tsx` (`req.appOff`, `req.cannotGrant`, `req.roleBlocked` ternaries), `teams-tab.tsx` and `sop-folders-tags-manager.tsx`, including one exact `<p className="m-0 text-sm text-ink-2">` line.
  - `src/lib/mcp/mcp-copy.test.ts`: exact `intro` and `switchHint` strings, and `allowedHint` must contain `claude.ai`, `claude.com`, `*.cursor.com`, `localhost`, `Claude Code`, `VS Code` and `Cursor's desktop app`. Moving that hint behind Show more keeps the same constant, so the test still passes. Shortening the hint means editing the test deliberately.
  - `src/app/(dashboard)/settings/api/page.copy.test.ts`, `src/components/settings/public-links-card.test.ts`, `settings-form-number.test.ts`, `members/member-drawer-retry.test.ts`.
  - `src/lib/settings-registry.test.ts`: labels, tabs and order. C2 adds `summary`; add a test that every page has one and that it fits on one line.
  - `src/lib/settings-shell-groups.test.ts`.
- **Run:** every test that imports a changed module, plus `tsc` and eslint on the changed files, per builder-rules.

**E2. Behaviour that must not change.**

- **Saving:**
  - the Save bar, its dirty guard, `⌘S`, and the `data-save-mode` marker;
  - autosave rows: the Saved tick, the revert and the Retry;
  - the honest check that Rail apps really persisted `apps`;
  - the per-row disable while a write is in flight.
- **Confirms:**
  - the "N people lose access" confirm on a rail floor;
  - module turn-off;
  - MCP turn-off;
  - the MCP 409 gating.
- **Gates and permissions:**
  - `SettingsGate` on every page;
  - the People team read-only rendering (`readOnlyValue`, the banner);
  - `AdminOnly`;
  - the Ask-an-admin strip.
- **Links and URLs:**
  - the `?tab=` URLs and the redirects;
  - the hash anchors `#modules`, `#rail`, `#ai-apps`, `#ai-browser`, `#ai-google`, `#requests`, and every registry field id. The consent page, the docs and `/settings/modules` link to them.
- **Rule:** a builder who moves a section keeps its `id`.

**E3. Needs the founder's eye.** Both are recommended below; neither blocks Phase 1.

1. **One card width (B1).** All cards fill the page column (760 on forms) instead of DS 5.4's 560 cards plus the 760 exception.
   - **Worst case of 760:** a short label sits far from its switch. The row separator carries the eye, and this is Zoho's own settings layout.
   - **Worst case of keeping two widths:** the ragged edges the founder already rejected.
   - **Recommendation:** 760.
2. **A required one-line subtitle on every page (B2).** DS 4.4 says no description line; SW 1.7 allows one.
   - **Worst case of "required":** a weak sentence on a simple page.
   - **Worst case of "optional":** headers of different heights, so content jumps between pages, which is part of the complaint.
   - **Recommendation:** required, from the registry.

**E4. Other risks.**

- **C1 changes every page at once.** Hard-coded px alignments and fixed heights will show it first. Phase 1's full recapture is the guard.
- **C7 changes keyboard behaviour on 9 files.** Some proof scripts set `<select>` values through EVAL; update any that break.
- **The dev server:** one builder, one dev server, on its own port. Never `next build` while another server runs (memory rules).

---

## F. Before-and-after checklist

A reviewer ticks these from the `after/` shots and `metrics-after.json`, view by view.

- [ ] **One width.** All cards in the view share one left and one right edge (`cardRight` has one value), and the same edge holds in every tab of the page.
- [ ] **Header.** The title row is 40 with an 18px title. One subtitle line that does not wrap. Tabs directly under it. The first card starts at the same height as its sibling pages.
- [ ] **Headings.** No section label repeats a card title. The only heading styles are: page title 18, section label 11 uppercase, card title 16, sub-heading 13/500.
- [ ] **No box inside a card,** other than inputs, chips, segmented controls and switches.
- [ ] **Grid.** Card padding 24, gaps 24, controls 36 (32 in rows), rows at least 48. `ctrlHeights` has no `.5` values.
- [ ] **Blue.** At most one blue button in view (switches and links do not count). A disabled primary is grey.
- [ ] **Help text.** No row hint over one line, no card description over two. Longer help sits behind "Show more" and opens in place.
- [ ] **Controls.** No native select, native date field or native checkbox (`selects` is 0).
- [ ] **Empty states.** An inline "No X yet · Action" row, or the quiet four-dot empty state for a whole tab. Nothing else.
- [ ] **Danger zone.** A pale red border and a red title only.
- [ ] **No floating text.** No caption or link floats between cards.
- [ ] **390 shots.** "Back to app" on one line. Rows stacked. Nothing crosses a card edge. Tables scroll inside their card. `overflowDoc` is 0.
- [ ] **Copy.** No em dash or double hyphen (`emDash` is 0).
- [ ] **Behaviour spot checks** on the phase's pages:
  - a switch shows "Saved";
  - a Save-bar edit shows the bar, and Discard restores the value;
  - a rail floor change asks first;
  - a module turned off asks first;
  - `/settings/modules`, `#ai-apps` and `#ai-browser` land on their card and pulse.
- [ ] **Employee view.** A Workspace URL shows the Ask-an-admin strip at the page's width, 16px above the title.

## Decided (2026-10-24, the lead, by each option's worst case)

- **E3.1, one width:** every card fills the page column, 760 on form pages and fluid to 1120 on list pages. This replaces DS 5.4's 560 and SW 1.7's deviation.
  - Worst case of one width: a short label sits far from its switch, as in Zoho's own settings.
  - Worst case of two widths: the ragged edges the founder rejected.
- **E3.2, the subtitle:** a one-line subtitle is required on every page, from SETTINGS_PAGES[key].summary.
  - Worst case of requiring it: a plain sentence on a simple page.
  - Worst case of leaving it optional: headers of different heights, so content jumps between pages.
- **The founder can overturn either one.** Each is a single constant: the card width, and whether the summary is drawn.

