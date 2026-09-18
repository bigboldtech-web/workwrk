# Founder-endorsed visual reference: Zoho (CRM Leads list + Zoho One home)

Date: 2026-09-11. The founder sent two Zoho screenshots with: "we were working on the UI part and I like this UI, this is from Zoho and this looks pretty clean." Treat this as the CURRENT visual preference. It does not replace the brand (blue #0073EA primary, YBRG only as semantic + the four dots, NO purple, no Zoho red/coral) but it tells us what "clean" means to him. The screenshots are on disk next to this file: `zoho-ref-1.jpg` (CRM Leads list inside Zoho One) and `zoho-ref-2.jpg` (Zoho One home). Read both images.

## What is actually in the screenshots (measured from the 2940x1912 captures, values approximate)

### Screenshot 1: Zoho CRM > Leads (list view)

Chrome, outermost to innermost:

1. **Far-left app rail, dark navy (~#1F2B45), ~56px wide.** One 20px thin-line icon per app, ~44px pitch, no labels. Active app = white rounded-square pill (~40px, radius ~8px) behind the icon; icons otherwise ~60% white. Thin separators between groups. Red dot badges on icons with attention. A small circular "collapse" chevron button at the bottom edge of the secondary sidebar.
2. **Top bar, same dark navy, ~64px tall.** Left: product wordmark "CRM" (bold, white) then horizontal top-level text tabs (Home, Workqueue, Modules, Reports, Analytics, Agents) at ~17px; the active tab is white with a 2px white underline, the rest ~75% white. Right cluster: search, AI sparkle, "+" quick-create, marketplace, chart, calendar, bell with a red count badge, settings gear, avatar with a green presence dot.
3. **Secondary sidebar, light grey (~#F3F4F6), ~325px wide, full height.** Header row = a small chip avatar ("CT") + "CRM Teamspace ▾" (~18px, medium). Below it a full-width search input (white, 1px border, radius ~8px, magnifier icon). Then a FLAT list of module rows: 20px thin-line icon + label (~17px regular, dark grey), row height ~44px, ~12px gap; the active row (Leads) is a full-width darker-grey pill (~#E1E3E8, radius ~8px) with the label in medium weight. No nesting, no section headers in this list, no counts.
4. **Content canvas, white.**
   - Page title "Leads" at ~24px semibold, ~28px top padding, left-aligned.
   - Directly under it a row of **saved-view tabs as plain text**: "All Locked Leads | All Leads | Converted Leads | Junk Leads | Mailing Labels | •••". ~17px, grey; the active one ("All Leads") is bold on a light-grey rounded pill (~#EEF0F3). No underline bar. Overflow goes into "•••".
   - **Toolbar row** (~48px): left = "Filter" (funnel icon + label inside a light-grey pill, i.e. a toggle for the filter panel) then "Sort" (arrows icon + label, no pill), a thin vertical divider, then a run of 6 view-type icons (list, kanban, table, chart, hierarchy, split) + a chevron for more, the list icon highlighted blue as the active view. Right = a solid BLUE primary button "Create Lead" (~44px tall, radius ~6px, white text ~17px medium) fused to a split-arrow dropdown, then a bordered "•••" square button.
   - **Filter side panel** (left, ~275px): a white card with a 1px light border and ~8px radius, heading "Filter Leads by" (~17px semibold), its own search input, then a vertical list of checkbox rows (Industry, Last Activity Time, Last Name, …) ~40px tall, plain labels. It is a panel inside the content area, not a drawer, and the table shrinks to make room.
   - **Table**: a white card with 1px border and ~8px radius. Header row (~48px) with a checkbox column, then "Created By", "Lead Name  All ▾" (an inline column filter), "Company", "Email", and a column-settings icon pinned at the far right. Body rows are tall (~75px, because emails wrap to two lines), 1px hairline dividers, NO zebra striping, NO hover chrome visible, every cell in the same ~17px regular dark-grey type; the checkbox is a plain 20px outlined square. Footer inside the card: "Total Records 644" left, "1 to 40" with ‹ › chevrons right.
5. **Bottom dock** (Zoho One's Cliq bar, ~50px): icon+tiny-label items (My Pins, Chats, Channels, Threads, People), a purple "What's new" pill (their accent, not ours), and a right cluster of tool icons + "Need Support?".

### Screenshot 2: Zoho One > Home

1. **Left sidebar, dark navy, ~310px, with LABELS.** Header: hamburger + "Zoho One" (~24px semibold white). "Home" row = a WHITE full-width pill (radius ~6px) with dark text and an orange home icon (that is the active state on navy: invert to white, do not tint blue). Section labels "PINNED APPS" / "OTHER APPS" in ~13px uppercase grey with a thin rule running to the right edge. App rows: 20px icon + ~17px white label, ~54px pitch; hovering a row reveals "open in new tab" and "unpin" icons at the right; red dot badges on icons that need attention. "More Apps" row with a "•••" icon, then a divider, then a utilities group (Directory, Zia Search, Calendar, ToDo, Contacts). A thin scrollbar track on the sidebar's right edge.
2. **Top bar, navy, ~64px:** a text tab ("Getting Started"), gear, avatar with presence dot.
3. **Canvas, very light grey (~#F5F6F8)** with white dashboard widgets: 1px border, ~6px radius, a pale-blue header strip (~#EEF3FB, ~60px) holding the widget title/icon, then a centered empty-state illustration (soft grey, low-contrast, a document + magnifier, or clouds + a red prohibition circle) with one line of grey caption text ("You have not been tagged yet", "You aren't a part of"). Widget toolbar at top right: info icon, refresh icon, and a coral "+ New Dashboard" button (Zoho One's brand colour; for us this is BLUE).

## What the founder is responding to (the transferable principles)

- **Navy chrome frames a white canvas.** The rail and top bar are one dark navy; everything the user works on is white or near-white. The only saturated colour on the working surface is the single primary button (and tiny badges). This is the biggest visible difference from the current WorkwrK shell (all-light chrome) and from Monday (light chrome, colourful boards).
- **Icon + label rows, flat, no nesting by default.** The secondary sidebar is a plain list, generous row height, one active pill. Section headers only when there are groups (PINNED / OTHER), set as small uppercase with a rule.
- **Active state = a grey pill on light, a white pill on navy.** Never a coloured text tint, never a left border bar.
- **One page-title + text-tab views + one toolbar row.** Title, then the saved views as text tabs, then Filter / Sort / view-switcher on the left and the ONE blue Create button on the right. This exact stack should become the WorkwrK list-page header for Boards/Lists, Docs, Tables, People, everything.
- **Filter is a side panel inside the content, not a popover soup.** Toggling "Filter" opens a bordered panel with a search box and checkbox rows; the table narrows.
- **Tables are bordered white cards with hairline rows and calm type.** No zebra, no bold cells, a checkbox column, an inline column filter in the header, column settings pinned right, totals + pagination in the card footer.
- **Big readable type.** Body ~17px at 2x (so ~15-16px CSS), titles ~24px, labels ~13px uppercase. Nothing is 11px. Our 14px base can stay but the reference argues for 15px rows in tables/sidebars.
- **Thin-line icons at 20px, one weight.** Consistent family (Zoho's own; for us Lucide at 1.5px stroke fits).
- **Empty states are quiet illustrations + one grey sentence.** Not a CTA-heavy card.
- **Presence and attention are tiny dots.** Green presence dot on the avatar, red dots on icons; no coloured chips in chrome.

## What NOT to copy

- Zoho's brand reds/corals/purples (the "New Dashboard" coral, the "What's new" purple). Ours is blue #0073EA only.
- The double top-level navigation (Zoho One rail + CRM top tabs + secondary sidebar = three nav layers). WorkwrK keeps ONE rail (8 hubs) + ONE secondary sidebar + ONE top bar; the top bar carries breadcrumb/search/actions, not another tab row.
- The bottom Cliq dock. Talk stays a hub, not a dock.
- 325px secondary sidebar is wide; 260-280px is enough for us.
- Their icon family (we use Lucide). Their orange home icon.
- Density of the CRM module list (20 rows). Our hub sidebars are already grouped; keep the row style, not the length.

## How to apply in the design system

1. Specify the shell in BOTH chrome variants, with full tokens: **navy chrome** (rail + top bar dark navy, white active pill, light-grey secondary sidebar) as the recommended default because the founder endorsed it, and **light chrome** (current all-white shell, grey pill) as the flip. Everything below the chrome (canvas, tables, cards, buttons, chips) is identical in both.
2. The blue primary on navy: the primary button never sits ON the navy chrome; on navy the accents are white (active pill, underline, icon) so the blue stays the one CTA on the white canvas. Verify contrast: white on #1F2B45 passes AAA; #0073EA on #1F2B45 fails (do not use).
3. The four dots: the single place YBRG appears in chrome (logo in the rail top, loader). Navy chrome makes the four dots pop; that is the ownable moment.
4. Adopt the list-page header stack verbatim (title / text-tab views / toolbar with Filter+Sort+views left and the one Create button right) and the Filter side-panel pattern as component standards.
5. Adopt the bordered-card table with hairline rows, checkbox column, inline header filter, column settings, footer totals + pagination.
6. Adopt quiet empty states (illustration in the grey scale + one sentence + optional single text-link action).
