# WorkwrK design system proposal: "Signature four dots"

Date: 2026-09-10. Designer stance: the YBRG four-dot logo motif becomes the identity system. Dots are the loader, the empty-state illustration, the status glyph, the step/progress glyph, the presence and unread marker, and the only brand moment. Everything else is strictly monochrome cool neutrals plus one blue, with pale semantic chips. Differentiation from monday comes from an ownable motif (monday has no signature glyph) and a type family whose own dots echo the mark.

Designed against `phase2-inputs.md` (hard constraints, section 1), `design-references.md` (verified contrast values, reused unchanged), and `existing-direction.md` (the `--os-*` vocabulary this maps onto). Where this proposal departs from a brief default it says so and why.

One-liner: **four dots, one blue, nothing else.**

---

## 0. The thesis in five rules

1. **Full-saturation YBRG exists in exactly four places**: the logo, the route-transition loader, the mission splash, and marketing. It is delivered by four tokens (`--os-dot-y/b/r/g`) that only files under `src/components/brand/` may reference. A lint rule enforces it.
2. **Every other dot is a single neutral or semantic colour.** A status dot is `success.solid`; an empty-state dot is `N300`; a step dot is `blue-600`. Four brand hues never appear side by side outside the four places above, so a "Done" chip can never be confused with the logo.
3. **Dots replace pictures.** No illustrations, no mascots, no icon tiles with coloured backgrounds. Where another product would draw a clipboard, WorkwrK draws four hollow dots. Where another product shows a spinner, WorkwrK bounces the dots.
4. **The chrome is one material.** Cool low-chroma neutrals from the brief, borders over shadows, white rail and N50 sidebar, one blue used as punctuation only.
5. **A filled dot means there is something to do.** The empty-state glyph fills one dot only when a wired primary action exists. The unread marker is a filled dot. The step glyph fills dots as steps complete. This is the zero-training grammar: hollow = nothing yet, filled = act or done.

---

## 1. Colour

### 1.1 Layer 1: primitives

Generated in OKLCH so equal-lightness steps look equal; hex values below are the sRGB output and are what ship. Neutrals are the brief's verified slate ramp (chroma 2 to 4), unchanged.

**Neutrals (light and dark share one ramp; dark reads it from the other end and adds four dedicated surfaces).**

| Primitive | Hex | OKLCH (approx) | Note |
|---|---|---|---|
| N0 | `#FFFFFF` | 100 / 0 / 0 | |
| N50 | `#F6F7F9` | 97.6 / .003 / 250 | |
| N100 | `#EEF0F3` | 95.4 / .004 / 250 | |
| N200 | `#E4E7EC` | 92.5 / .006 / 250 | |
| N300 | `#D0D5DD` | 86.5 / .009 / 250 | |
| N400 | `#98A2B3` | 70.0 / .022 / 250 | decorative only, 2.58:1 |
| N500 | `#667085` | 52.9 / .030 / 255 | 4.97:1 on N0, 4.64:1 on N50 |
| N600 | `#475467` | 41.8 / .033 / 255 | |
| N700 | `#344054` | 34.4 / .033 / 255 | |
| N800 | `#1F2430` | 24.7 / .022 / 260 | primary text, 15.5:1 |
| N850 | `#181B20` | 20.8 / .010 / 260 | dark raised |
| N875 | `#14171C` | 18.2 / .010 / 260 | dark subtle (sidebar) |
| N900 | `#101215` | 15.9 / .008 / 260 | dark base |
| N925 | `#1F232A` | 23.4 / .011 / 260 | dark hover / modal |
| N950 | `#262A31` | 26.5 / .011 / 260 | dark border subtle |
| N975 | `#30353D` | 31.8 / .012 / 260 | dark border default |

**Blue (the accent).**

| Primitive | Hex | Note |
|---|---|---|
| blue-50 | `#EAF3FE` | selection wash, active rail pill |
| blue-100 | `#D4E7FD` | selected + hover |
| blue-200 | `#A9CFFB` | focus ring (light) |
| blue-300 | `#7AB8FF` | accent text strong (dark), 9.1:1 on N900 |
| blue-400 | `#4D9CFF` | accent text (dark), 6.71:1 on N900 |
| blue-500 | `#1A82F0` | solid hover (dark) |
| blue-600 | `#0073EA` | solid, checked, toggles on; white text 4.53:1 |
| blue-650 | `#0062CC` | solid hover (light), 5.8:1 |
| blue-700 | `#0B5FC2` | link and accent text (light), 6.12:1 |
| blue-800 | `#0A4C9B` | pressed |

**Semantic hue ramps (not exported).** `green.*`, `yellow.*`, `red.*` exist only inside the token file to derive the semantic aliases below; no component may reference them. There is no `--os-green`, `--os-yellow`, `--os-red`.

**Brand dots (exported to `src/components/brand/` only).**

| Token | Hex | Role in the motif |
|---|---|---|
| `--os-dot-y` | `#FFCB00` | dot 1, "attention" |
| `--os-dot-b` | `#0073EA` | dot 2, "action" |
| `--os-dot-r` | `#FF3D57` | dot 3, "blocked" |
| `--os-dot-g` | `#00C875` | dot 4, "done" |

These do not rebind in dark mode. They are the one thing on screen that stays identical across themes, which is what makes them read as the brand.

### 1.2 Layer 2: semantic aliases (what components use)

| Alias | Light | Dark | Contrast (verified where text) |
|---|---|---|---|
| `bg.app` | N0 `#FFFFFF` | N900 `#101215` | |
| `bg.subtle` | N50 `#F6F7F9` | N875 `#14171C` | sidebar, table header, input wash |
| `bg.raised` | N0 `#FFFFFF` | N850 `#181B20` | cards, popovers, drawer |
| `bg.overlay` | N0 `#FFFFFF` | N925 `#1F232A` | modals, tooltips' inverse |
| `bg.hover` | N100 `#EEF0F3` | N925 `#1F232A` | rows, menu items |
| `bg.active` | N200 `#E4E7EC` | N950 `#262A31` | pressed rows, segmented thumb track |
| `bg.selected` | blue-50 `#EAF3FE` | `rgba(0,115,234,.14)` | selected row, active rail pill |
| `bg.selectedHover` | blue-100 `#D4E7FD` | `rgba(0,115,234,.22)` | |
| `bg.inverse` | N800 `#1F2430` | N100 `#EEF0F3` | tooltips, bulk bar |
| `border.subtle` | N200 `#E4E7EC` | N950 `#262A31` | structural, separators |
| `border.default` | N300 `#D0D5DD` | N975 `#30353D` | inputs, strong dividers, empty-state dots |
| `border.strong` | N400 `#98A2B3` | `#3D434D` | drag targets, dashed drop zones |
| `text.primary` | N800 `#1F2430` | `#E6E8EC` | 15.5:1 / 15.3:1 |
| `text.secondary` | N500 `#667085` | `#9AA3B2` | 4.97:1 / 7.38:1 |
| `text.tertiary` | N600 `#475467` | `#B4BBC7` | rail inactive labels, metadata columns |
| `text.placeholder` | N400 `#98A2B3` | `#6B7280` | decorative only |
| `text.inverse` | N0 | N900 | on `bg.inverse` and solids |
| `text.link` | blue-700 `#0B5FC2` | blue-400 `#4D9CFF` | 6.12:1 / 6.71:1 |
| `accent.solid` | blue-600 `#0073EA` | blue-600 `#0073EA` | white text 4.53:1, labels 14px+/590 |
| `accent.solidHover` | blue-650 `#0062CC` | blue-500 `#1A82F0` | |
| `accent.solidActive` | blue-800 `#0A4C9B` | blue-650 `#0062CC` | |
| `accent.text` | blue-700 `#0B5FC2` | blue-400 `#4D9CFF` | |
| `accent.bg` | blue-50 `#EAF3FE` | `rgba(0,115,234,.14)` | |
| `focus.ring` | blue-200 `#A9CFFB` at 2px, 2px offset | blue-400 `#4D9CFF` at 2px, 2px offset | `:focus-visible` only |
| `success.bg` | `#ECFDF3` | `#0F2A1A` | |
| `success.text` | `#15803D` | `#4ADE80` | 4.76:1 on bg / 6.7:1+ on N900 |
| `success.solid` | `#15803D` | `#15803D` | white text 5.02:1, theme-independent |
| `warning.bg` | `#FFFAEB` | `#2A2208` | |
| `warning.text` | `#854D0E` | `#FCD34D` | 6.57:1 / 6.7:1+ |
| `warning.solid` | `#FACC15` | `#FACC15` | N800 text only, 10.1:1; never white |
| `danger.bg` | `#FEF3F2` | `#2C1212` | |
| `danger.text` | `#B42318` | `#F87171` | 6.05:1 / 6.7:1+ |
| `danger.solid` | `#D92D20` | `#D92D20` | white text 4.83:1 |
| `info.bg` / `info.text` | blue-50 / blue-700 | `accent.bg` / blue-400 | 5.47:1 |
| `neutral.bg` / `neutral.text` | N100 / N600 | N925 / `#B4BBC7` | "not started", "none" |
| `scrim` | `rgba(16,18,21,.40)` | `rgba(0,0,0,.60)` | |
| `shadow.pop` | `0 8px 24px rgba(16,18,21,.12)` | `0 8px 24px rgba(0,0,0,.48)` | popovers, drag ghost |
| `shadow.modal` | `0 8px 32px rgba(16,18,21,.16)` | `0 8px 32px rgba(0,0,0,.56)` | modals only |

Solids are theme-independent on purpose: `#15803D`, `#FACC15` and `#D92D20` pass with their fixed foreground on any surface, so the solid status column needs no dark-mode QA.

### 1.3 Layer 3: component tokens (sparse, only where a component deviates)

| Token | Value | Why it exists |
|---|---|---|
| `rail.active.bg` | `accent.bg` | the only blue fill in the chrome |
| `rail.active.fg` | `accent.text` | |
| `side.active.bg` | `bg.hover` (N100) | sidebar active is neutral, not blue |
| `status.solid.radius` | 4px | solid column cells are tighter than chips |
| `dot.outline` | `border.default` (N300) | empty-state and hollow step dots |
| `dot.fill` | `accent.solid` | the "something to do" and completed-step dot |
| `dot.unread` | `accent.solid` | 6px |
| `dot.presence` | `success.solid` | 8px with 2px `bg.raised` ring |
| `dot.status.size` | 8px | inside chips and rows |
| `bulk.bg` / `bulk.fg` | `bg.inverse` / `text.inverse` | floating bulk bar |
| `tooltip.bg` / `tooltip.fg` | `bg.inverse` / `text.inverse` | |

### 1.4 The Y/R/G rule (enforceable)

- Components may only reach `success.*`, `warning.*`, `danger.*`, `info.*`, `neutral.*`. There are no generic yellow, red or green tokens in the vocabulary.
- `--os-dot-*` is allowed only in `src/components/brand/**` and `src/app/(marketing)/**`. ESLint `no-restricted-syntax` on the string `--os-dot-` plus a CSS lint (stylelint `declaration-property-value-disallowed-list`) block it elsewhere.
- Raw hex in `src/components/**` is a lint error after the migration (exception: `brand/`).
- Colour never travels alone: a semantic colour is always paired with a word or a glyph.
- Status chips are pale by default. The solid form is allowed on one surface only: the status column in Board list/table views and Tables, where the whole column is solid.
- Red means overdue, blocked, destructive. Priority: urgent = `danger.text` flag, high = N800 filled flag, normal = N500 flag, low = N400 flag.
- No hue-keyed Spaces, Folders, groups. Sidebar tiles are neutral by default; the opt-in icon-colour set is the muted eight in 1.5.
- User-defined per-List status colours are data and stay, but the picker offers the muted eight, not the monday ten.

### 1.5 Muted eight (user-selectable status and icon colours)

Each entry is a solid (for the solid column) and a derived pale pair (`color-mix(in oklch, solid 10%, bg.raised)` for bg, solid for text). Three of the eight coincide with the semantic solids on purpose so a user who picks "green" for Done gets exactly `success.solid`.

| Name | Solid | Foreground on solid |
|---|---|---|
| Slate | `#64748B` | white |
| Sky | `#0369A1` | white |
| Blue | `#0B5FC2` | white |
| Teal | `#0F766E` | white |
| Green | `#15803D` | white |
| Amber | `#B45309` | white |
| Red | `#B42318` | white |
| Brown | `#7C5A3A` | white |

No purple, no pink, no lime. `--os-c-purple/pink/indigo/lime` aliases are deleted, not redirected.

### 1.6 Dark-mode strategy

- Light first. Marketing is light only.
- Dark is a rebinding of layer 2 only. No component carries a colour literal, so no component knows which theme it is in.
- Selector: `:root.dark` (the class the existing `ThemeApplier` already writes) and `@media (prefers-color-scheme: dark) { :root:not(.light) ... }` for the "system" preference. Both blocks set the same variables; nothing else lives inside them.
- Elevation on dark = lighter surface (`bg.app` → `bg.raised` → `bg.overlay`), never a bigger shadow. Shadows on dark are only there to separate a popover from a same-tone panel.
- Brand dots do not rebind. Semantic solids do not rebind. Everything else does.
- High contrast is a variable (`--os-contrast: 1`) that the text and border aliases mix against, not a third theme.
- The 147 `:root.dark ... !important` utility repaints are deleted in the same commit that lands the token rebinding for a given file family, never before.
- The 11-accent picker is removed (Q4 default). Theme = light / dark / system.

---

## 2. Type

### 2.1 Family

**DM Sans** (Google Fonts, variable, `opsz` 9 to 40 and `wght` 100 to 1000), loaded through `next/font/google` with `axes: ["opsz"]`, weights used: 400, 500, 600. Fallback stack: `"DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`.

Why DM Sans and not Inter or Figtree:
- Its tittles (the dots on i and j), periods, colons and bullets are perfect circles. The type carries the four-dot motif at the glyph level, so the wordmark, the loader and body copy share one geometry. This is the ownable pairing.
- The optical-size axis gives a genuinely different cut at 10 to 13px (wider apertures, looser spacing) than at 20px, which is what keeps rail labels and chip text legible at the 10px floor without a second family.
- It is not monday (Figtree/Roboto), not Linear/Notion (Inter), not ClickUp (Axiforma), not Asana (Circular-like). A screenshot with DM Sans and cool neutrals does not photograph as any of them.
- Tabular figures (`tnum`) and slashed zero are available; tables use `font-variant-numeric: tabular-nums`.

Mono: **Geist Mono** (already loaded in the repo) for code, formulas, IDs and the Tables formula bar. All other loaded families (Outfit, Syne, Geist Sans, Instrument Serif, Figtree, JetBrains Mono) are removed from the root layout; marketing switches to DM Sans as well so the site and product are one voice.

Script coverage caveat: DM Sans covers Latin and Latin Extended only. For `ar`, `he` and any CJK locale the fallback stack resolves to the system UI face; the scale below is family-independent, so nothing else changes. Letter-spacing is 0 everywhere (the current -0.005em is dropped; DM Sans at small opsz does not need it).

### 2.2 Scale (14px base, no half pixels, floor 10)

| Role | Size / weight / line-height | Colour | Where |
|---|---|---|---|
| Page title | 20 / 600 / 1.25 (25px) | `text.primary` | content header |
| Section and modal title | 16 / 600 / 1.25 (20px) | `text.primary` | modal header, settings card title, empty-state title |
| Row title (emphasised) | 14 / 600 / 1.4 (20px) | `text.primary` | first column of tables, kanban card title when needed, sidebar active row |
| Body and rows | 14 / 400 / 1.4 (20px) | `text.primary` | everything by default |
| Body secondary | 14 / 400 / 1.4 | `text.tertiary` (N600) | metadata columns |
| Helper and secondary | 13 / 400 / 1.4 (18px) | `text.secondary` | descriptions, helper text, breadcrumb crumbs, toolbar buttons (13/500) |
| Group label, chip, metadata | 12 / 600 / 1.35 (16px) | `text.secondary` | table headers, sidebar group labels, chips, kanban footer id |
| Micro label | 11 / 500 / 1.3 (14px) | `text.secondary` | kbd hints, tooltips' shortcut, counts inside dots |
| Rail label | 10 / 600 / 1.2 (12px), letter-spacing 0.01em | `text.tertiary` / `accent.text` | rail only |
| Doc title | 32 / 600 / 1.15 | `text.primary` | doc page only (kept from Docs) |
| Marketing display | 48 to 72 / 600 / 1.05 | `text.primary` | site only |

DM Sans weight 600 sits where Inter's 590 sits visually; 500 is used only for toolbar buttons, micro labels and tooltips. Never 700 in the product (the wordmark's 800 is the one exception and lives in `brand/`).

### 2.3 Hierarchy rule

Hierarchy comes from weight and grey, never from size. Two sizes may appear in one row at most (14 title + 12 metadata). A screen has one 20px string. Section titles inside a page are 14/600 with a 6px `dot.outline` marker, not 16px (16 is reserved for modal and empty-state titles). Uppercase is never used; the old 11.5px uppercase section labels become 12/600 sentence case.

Tailwind mapping (`@theme`): `text-xs` 12, `text-sm` 13, `text-base` 14, `text-lg` 16, `text-xl` 20, `text-2xl` 32, `text-[10px]` allowed only in `rail.tsx`. All other arbitrary `text-[Npx]` values are lint errors after the sweep.

---

## 3. Rhythm

- **Grid**: 4px. Spacing scale 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64. Content padding 24. Card padding 16. Modal padding 24. Sidebar padding 8 horizontal.
- **Row heights**: 32px (navigation, menus, pickers, compact tables, toolbar buttons' row) and 36px (data rows at default density, inputs, default buttons). Nothing else. Density preference (Settings › You › Preferences) switches data rows 36 → 32; chrome never changes.
- **Control heights**: 36 default, 32 chrome, 28 inline/compact. Chips 22.
- **Radii**: 4 (status solid cells, checkboxes, kbd), 6 (inputs, chips, tooltips), 8 (buttons, cards, menus, popovers, rail pill, kanban columns), 12 (modals, drawer's inner cards), full (avatars, dots, pills, progress bars). `rounded-2xl/3xl` are removed from the app.
- **Elevation**: borders over shadows. One structural border (`border.subtle`), one input border (`border.default`). Shadows exist in exactly three places: popovers and menus (`shadow.pop`), modals (`shadow.modal`), drag ghosts (`shadow.pop`). Cards, kanban cards, toasts at rest, the drawer, the topbar: no shadow. The four-dot loader loses its current `box-shadow`.
- **Icon sizes**: 16 in rows, menus, buttons; 20 in the rail and the content-header title; never 14 or 18 (the current 14px "action" role becomes 16 inside a 28 or 32 control).

---

## 4. Shell

### 4.1 Rail (64px, white, labelled)

- Width 64, `bg.app` (white), 1px `border.subtle` on the trailing edge. The dark-navy rail (`--os-brand-dark`, `--os-brand-rail`) is retired; a coloured rail is the one thing every competitor with a rail does and it is the loudest chrome on screen.
- Top: the four-dot `LogoMark` at 28px wide (dots 5px, gap 2.67px), centred in a 48px zone. Click goes to Work › My work. This is the only YBRG in the chrome.
- Items: 8 hubs in admin order, each a 56px tall × 48px wide hit area (8px inset), 20px Lucide outline icon at 1.5 stroke, 10/600 label 4px below, 4px gap between items. Inactive: icon and label `text.tertiary` (N600). Hover: `bg.hover` pill, radius 8. Active: `rail.active.bg` (blue-50) pill radius 8 with icon and label `rail.active.fg` (blue-700); on dark the pill is `accent.bg` and the icon blue-400. No left bar, no dot indicator, no badge counts except one 6px `dot.unread` at the icon's top-right on Talk when unread exists.
- Bottom cluster (pinned, never scrolls): avatar 28px (menu: profile, preferences, theme, log out) above the Settings hub item. No Upgrade, no Invite, no workspace avatar.
- The rail never scrolls; a ninth hub is a founder decision. The "icons-only rail" option is removed from CustomizePanel.
- Labels: max 9 characters, no two starting with the same word. Current set passes: Work, Planner, AI, Talk, Teams, Docs, Tables, Settings.
- Collapse: a 12px handle on the sidebar's trailing edge (and ⌘\) hides the sidebar; the rail is always visible. Remembered per user.
- RTL: rail mirrors to the right edge; pill, dot badge and handle mirror with `inset-inline`.

### 4.2 Secondary sidebar (248px, N50)

- Width 248, `bg.subtle`, no border on the trailing edge (the tone change is the edge). Header 48px: workspace name 14/600 with a chevron (switcher menu), right-aligned collapse handle.
- Rows 32px, 14/400 `text.primary`, one 16px `text.secondary` icon or `EntityTile size="sm"` (neutral tile) per row, counts right-aligned 12/600 `text.secondary`. Hover `bg.hover`. Active: `side.active.bg` (N100) plus 14/600, never blue. Tree indent 16px per level, chevrons 16px `text.placeholder`, no guide lines.
- Group labels: 12/600 `text.secondary`, 24px top margin, 8px bottom, collapsible by clicking the label; a 6px `dot.outline` precedes the label and becomes `dot.fill` while the group holds the active row (the section marker: it tells the user where they are even when the row is scrolled out of view).
- Work hub order: Home, My work, Inbox (personal, fixed), then Favorites, then the access-derived Spaces tree. Other hubs open on their tree with the folded apps as labelled sections (e.g. Docs: Library, Clips, SOPs, Policies, Contracts).
- Footer: "Customize Sidebar" only, 32px row, 13/500 `text.secondary`, Lucide `sliders-horizontal`. Nothing promotional.
- Hover cluster on tree rows: star, "…", "+" appear on hover at 16px `text.secondary`, right-aligned, replacing the count.

### 4.3 Top bar (48px, one row)

- `bg.app`, 1px `border.subtle` bottom. Padding 0 16.
- Left: back and forward as 28px icon buttons (`text.secondary`, disabled `text.placeholder`), then a hierarchy breadcrumb 13/400 `text.secondary` with "›" separators in `text.placeholder`; last crumb 13/500 `text.primary` and not clickable; middle crumbs truncate to "…" past 4 levels; each crumb up to 200px, ellipsis.
- Centre: search input 480px (min 240, shrinks first), 32px tall, `bg.subtle`, radius 8, no border, Lucide `search` 16 `text.secondary`, placeholder "Search or jump to…" in `text.placeholder`, `⌘K` kbd right-aligned 11/500. Focus: `bg.app` + `focus.ring`.
- Right: "+ Create" (32px primary button, 14/600, the only solid blue in the chrome), Reminders bell (28 icon button; a 6px `dot.unread` badge, `danger.solid` if anything is overdue), Help (28), avatar 28. No quick-tool row; quick task, doc, reminder, notepad, voice live inside Create.
- The three floating cards on a zinc ground are removed.
- Settings takeover keeps its own 48px bar: "Back to app" (BackButton) left, filter field, nothing right.

### 4.4 Content header (48px) and toolbar (40px)

- Header: padding 0 24. Left: optional `EntityTile size="lg"` (32px, neutral) then title 20/600, then `ViewTabs` inline with 24px gap (13/600, 32px tall, active `accent.text` with 2px `accent.solid` underline, inactive `text.secondary`, icons 16 mono). Right: page actions as 32px ghost or secondary buttons: Share, the one "Ask AI" slot (ghost, Lucide `sparkles`, at most one per page), "…".
- Toolbar: padding 0 24, 40px. Left: Filter, Sort, Group, Display as 28px ghost buttons 13/500 with 16px icons; an active filter shows a count chip (22px pale `info`). Right: the view's primary add ("+ Add task") as a 28px **secondary** button. One solid blue per viewport, and it is the topbar Create.
- These two rows replace title 40 + tabs 34 + filter 34. Protected parity screens (List, Board, Calendar, Gantt, task detail) keep their structure and get this header and toolbar as a restyle.

### 4.5 Detail views (decision table)

| Situation | Pattern | Width |
|---|---|---|
| Task, table row, person from a list/board | Drawer over the list, own header (expand / copy link / close), same URL as `/item/[id]`; `BoardItemDetail` drawer-first | 520 (min 480, drag-resize to 720, remembered) |
| Doc, SOP, goal, review, KRA | Full page, breadcrumb + BackButton | 720 content column (680 to 760) |
| From search, notification, deep link | Full page | as above |
| Inbox, Talk threads | Split view, list left 360, detail right | |
| Short create/edit | Centred modal | 560 |
| Rich create with description | Centred modal | 720 |
| Editors (status editor, template editor) | Centred modal | 960 max |
| Confirm / destructive | Centred modal, danger primary only when destructive, typed confirmation for org-level deletes | 400 |
| Person or channel info | Right panel | 360 |

No stacked modals. Drawer is `bg.raised` with a 1px `border.subtle` leading edge and no shadow; it pushes nothing and covers the list's right side. Every drawer has a URL.

---

## 5. The dot vocabulary (the ownable part)

One component, `Dots`, with variants; every dot on screen comes from it or from `Chip`. Sizes are on the 4px grid; gaps are 0.6 × dot, rounded to the grid.

| Variant | Dot size / gap | Colour | Motion | Where |
|---|---|---|---|---|
| `quad-brand` | 10 / 6 (default 40 stage), 12 / 8 (route), 4 / 2 (button pending) | `--os-dot-y/b/r/g`; button pending uses `currentColor` for all four | bounce wave 1.1s (see 7) | route transitions, mission splash, primary button pending state (monochrome) |
| `quad-outline` | 18 / 8 (96px wide) | 1.5px `dot.outline` stroke, hollow | none | empty states; the first dot fills `dot.fill` only when a wired primary CTA exists |
| `quad-steps` | 8 / 4 | filled `dot.fill`, remaining hollow `dot.outline`; a failed step is `danger.solid` | fill 160ms | discrete progress with ≤ 4 stages: SOP acknowledgement, review cycle (Self › Manager › Calibrate › Done), onboarding checklist, module setup, goal milestones |
| `steps-n` | 6 / 4, up to 8 dots | as above | as above | checklists and wizards with 5 to 8 stages; beyond 8 use the linear bar |
| `status` | 8 | semantic solid or the muted eight | none | inside pale chips, list rows, group headers, kanban column headers, calendar chips (replaces coloured left edges) |
| `unread` | 6 | `dot.unread` | none | rail Talk item, inbox rows, sidebar channel rows, tabs |
| `presence` | 8 with 2px `bg.raised` ring | `success.solid` online, `warning.solid` away, `border.default` offline | none | avatars in Talk, people rows |
| `live` | 6 | `dot.fill` | pulse 1.6s | co-presence chip ("Priya is editing"), recording, call in progress |
| `saving` | 6 | `dot.fill` → `success.solid` on saved, `danger.solid` on failure | pulse while saving, then still | `AutosaveIndicator` (docs, notes, canvas, tables); failure also shows the word "Not saved, retrying" |
| `grip` | 2 × 3 grid, 3px dots, 2px gap | `text.placeholder` | none | drag handles on rows, cards, blocks |
| `grid` | 1px dots, 24px pitch | `border.subtle` | none | Canvas background only |
| `count` | 16px circle with 11/500 numeral | `bg.inverse` / `text.inverse` | none | rail-free counts (kanban lanes, tabs); never on the rail |

Rules:
- A screen never shows two `quad-brand` instances at once.
- `status` dots are always followed by a word (the chip label, the group name). A bare status dot is allowed only in the compact 32px table density where the column header names the meaning.
- Four brand hues never appear in a `status` row of four chips by accident: the muted eight are chosen so no line of statuses reproduces Y-B-R-G in order.
- The metadata separator in text is the typographic middle dot "·" (DM Sans renders it as the same circle), e.g. "Due Fri · 3 subtasks".

### 5.1 The mission and values loader inside this system

- First open per day (Q3 default): the mission splash. Surface `bg.app` white, not deep navy. Centre: `quad-brand` 48px stage, the mission 16/600 `text.primary` (max 480px, centred), one rotating value 14/400 `text.secondary` beneath. Duration 1.2s, fade out 160ms, skippable with any key or click. The dark navy overlay and the 380ms fade are retired.
- Route transitions: `quad-brand` 40px centred in the content area with `ValueLoader`'s value as a 13/400 `text.secondary` caption; non-blocking (the rail, sidebar and topbar stay interactive). Shown only after 200ms of pending to avoid flashes.
- In-content loading (panels, lists, drawers): skeleton bars in `bg.hover` (N100), radius 4, opacity pulse 1.4s. Never dots.
- Button pending: label swaps to a 16px-wide `quad-brand` in `currentColor`, width preserved.

---

## 6. Component standards

**Buttons.** Heights 36 (forms), 32 (chrome, modals' footer), 28 (toolbar, inline). Radius 8. Label 14/600 (13/500 at 28). Padding 0 12 (icon+label 0 12 0 10, gap 6). Primary: `accent.solid` / white, hover `accent.solidHover`, active `accent.solidActive`. Secondary: `bg.raised`, 1px `border.default`, `text.primary`, hover `bg.subtle`. Ghost: transparent, `text.tertiary`, hover `bg.hover` + `text.primary`. Destructive: `danger.solid` / white, hover `#B42318`; ghost-destructive in menus: `danger.text`. Disabled: `bg.subtle`, `text.placeholder`, 1px `border.subtle`, no opacity. Focus: `focus.ring`. Pending: monochrome `quad-brand` 4/2. No `active:translate-y-px`, no `shadow-sm`. Icon buttons 32 and 28 square, always with tooltip and `aria-label`.

**Inputs.** 36px, radius 6, `bg.raised`, 1px `border.default`, 14/400, padding 0 12, placeholder `text.placeholder`. Focus (any focus, not only keyboard): border `accent.solid` plus `0 0 0 3px accent.bg`. Error: border `danger.solid`, helper 13 `danger.text` with a `status` dot. Label 13/600 `text.tertiary` above, 6px gap; helper 13/400 `text.secondary` below, 4px gap. Textarea min 80. Search inputs use `bg.subtle` and no border. Native selects are never rendered; every select is the picker.

**Checkbox and switch.** Checkbox 16px, radius 4, 1.5px `border.default`, checked `accent.solid` with white check; appears on hover in tables. Switch 32 × 18, track `border.default` off / `accent.solid` on, thumb white 14px; auto-saves with an inline "Saved" 12/500 `text.secondary` for 2s.

**Chips (`Chip` / `StatusChip`).** Pale: 22px, radius 6, padding 0 8, 12/600, `*.bg` fill, `*.text` text, optional 8px `status` dot left with 6px gap, optional 12px icon; no border. Solid (status column only): cell fill in the status solid, 13/600 white (N800 on yellow), radius 4, cell inset 4, full cell width. Label chips (tags): `neutral.bg` / `text.tertiary` with no dot; taupe is gone. Performance band chip: pale semantic with the band word. Co-presence chip: 22px, avatar 16 + `live` dot + "editing" 12/500.

**Tables and lists.** Rows 36 / 32, header 32 `bg.subtle` with 12/600 `text.secondary` labels, no zebra, hairline `border.subtle` between rows in tables and none in lists. Title column 14/600, metadata 14/400 `text.tertiary`, numbers right-aligned tabular. Hover `bg.hover`; selected `bg.selected`. Checkbox hover-only in a 32px leading gutter. Group header 32px: 8px `status` dot, 13/600 name, 12/600 count `text.secondary`, chevron; empty groups collapse to that one line (no coloured header). "+ Add task" ghost row last, 13/400 `text.secondary`. "+" column header opens the field list with "Show more" after 10. Bulk bar: floating bottom-centre, `bulk.bg`, radius 8, 40px, count + 4 to 6 actions + close, `shadow.pop`. Tables (Sheets surface) keep their own rules: letter headers, row-number gutter, no selection chrome.

**Kanban.** Columns 280, gap 12, `bg.subtle` radius 8, padding 8. Column header 32: `status` dot + 14/600 + count 12/600 `text.secondary`. Card: `bg.raised`, 1px `border.subtle`, radius 8, padding 12, no shadow at rest; title 14/400 two-line clamp; one row of at most 3 pale chips (priority glyph, due, one label; status never on the card); footer: id 12/600 `text.secondary` left, avatars 20 right. Drag ghost: `shadow.pop`, no rotation. "+ Add task" ghost at the column bottom; "+ Add section" as a dashed `border.strong` ghost column.

**Forms and settings.** Labels above, 36px inputs, one primary per form, max 5 fields per card. Cards `bg.raised`, 1px `border.subtle`, radius 8, padding 16, title 16/600 + 13 description. Settings row: 48px min, label 14/600 + 13 description left, control right, `border.subtle` separators. Toggles auto-save with "Saved"; text-heavy forms show a sticky save bar only when dirty. Danger zone: bordered `danger.bg`-free card with a `danger.text` title at the bottom, typed confirmation.

**Modals.** 400 / 560 / 720 / 960. Radius 12, `bg.overlay`, `shadow.modal`, `scrim`. Header 16/600 + optional 13 `text.secondary`, padding 24, footer right-aligned Cancel (ghost) and one primary. Escape and outside click close. Pickers inside are absolutely positioned children (existing rule).

**Drawer.** 520, `bg.raised`, 1px `border.subtle` leading edge, full height under the top bar, header 48: title 14/600 with expand, copy link, close (28 icon buttons). Same component as the page.

**The picker popover (one component).** 260 wide (240 to 280), `bg.raised`, 1px `border.subtle`, radius 8, `shadow.pop`, padding 4. Search 32 at the top, auto-focused, `bg.subtle`. Rows 32 `MenuItem`: 16px glyph (identical to the list glyph: `status` dot for status, avatar 20 for people, flag for priority), 14/400 label, right-aligned check for multi-select or 11/500 shortcut hint. Section labels 12/600 `text.secondary`, sentence case. Date: quick chips Today / Tomorrow / Next week / No date, single month grid of 32px cells, natural-language input. People: avatar + name + 13 email `text.secondary`, "Invite by email" last. Serves status, assignee, date, label, priority; `useAnchorPos` positions it.

**Menus.** Same panel as the picker without search; rows 32, 14/400, 16 icon, submenus open at 4px offset; destructive rows `danger.text`; section labels 12/600. Kbd hints 11/500 `text.placeholder`.

**Tabs.** Underline (`ViewTabs`) as in 4.4. Segmented (in modals and settings): `bg.hover` track radius 8, 28px, thumb `bg.raised` with 1px `border.subtle`, 13/500, active `text.primary`.

**Tooltips.** `tooltip.bg` / `tooltip.fg`, 12/500, padding 4 8, radius 6, no arrow, no shadow, max 240, delay 400ms, shortcut as 11/500 at 70% opacity. Every icon-only control has one.

**Toasts.** Bottom-left, 24px inset, 360 wide, `bg.raised`, 1px `border.subtle`, radius 8, `shadow.pop`, padding 12 16, 14/400, optional 12 second line `text.secondary`; leading 8px `status` dot only for success or danger; one action ("Undo") 14/600 `accent.text`; close icon. 5s, 8s with an action, max 3, never for validation. Above the toasts, bottom-right, the reserved call-dock region (Talk).

**Empty states.** `quad-outline` 96px (first dot `dot.fill` when a CTA is wired), 24px gap, title 16/600, copy 14/400 `text.secondary` two lines max 360 wide, 16px gap, one primary 36 (with shortcut hint) and one ghost "Learn more". Centred in the content area. Filtered empty: an inline 36px row "No results · Clear filters" (13/400 with the link in `accent.text`). New workspace: Notion-style "Get started with" chip row (secondary 32px buttons) plus a `quad-steps` checklist. `OsEmptyView` is the home; `ui/empty-state.tsx` is deleted.

**Loading.** Per 5.1: skeletons inside content, `quad-brand` for routes and splash, monochrome quad for pending buttons, `saving` dot for autosave.

**Avatars.** 20 / 24 / 28 / 32, radius full, initials 11/600 on `bg.hover` with `text.tertiary` (no lime, no hue-keyed fallbacks), `presence` dot bottom-right when relevant.

**Progress.** Linear: 4px, radius full, `bg.hover` track, `accent.solid` fill; `success.solid` fill only at 100% when the meaning is "done". Discrete: `quad-steps` / `steps-n`. Goal ring stays a ring (stroke 6, `accent.solid` on `bg.hover`).

**Iconography.** Lucide only, `strokeWidth={1.5}`, round caps (Lucide's default; round pairs with dots, so the brief's "square caps" is consciously not adopted). 16px in rows, menus, buttons, chips; 20px in the rail and content-header title. Colour: `text.secondary` at rest, `text.primary` in hovered rows, `accent.text` only on the active rail item and active tab, semantic only on semantic glyphs, `danger.text` on destructive menu rows. One icon per concept (assignee `user-plus`, due `calendar-plus`, priority `flag`, tags `tag`, more `ellipsis`, AI `sparkles`, filter `list-filter`, sort `arrow-up-down`, group `layers`, display `sliders-horizontal`). At most two icons per row. The Lucide `ellipsis` "…" is three dots and stays; it is the motif's smallest cousin.

**Comment component.** One `Comment` with slots for reactions, replies, resolve and assign so none of them needs a second implementation; author 14/600, time 12 `text.secondary`, body 14/400, resolved = `success` `status` dot + "Resolved".

---

## 7. Motion

- Easings: enter `cubic-bezier(.2, 0, 0, 1)`, exit `cubic-bezier(.4, 0, 1, 1)`, loop `ease-in-out`.
- Durations: 120ms hover and colour states; 160ms selection, checkbox, dot fill, chip appear; 200ms popovers and menus (fade + 4px translate); 220ms drawer (translate-x) and modal (fade + scale .98 → 1); 160ms toast in, 120ms out. Nothing over 250ms. `.animate-fade-in` (300ms) and the splash fade (380ms) are retired.
- Loops: `quad-brand` bounce 1.1s, stagger 120ms per dot, 28% stage height; `live` and `saving` pulse 1.6s opacity 1 → .35 → 1; skeleton pulse 1.4s opacity 1 → .6.
- What animates: opacity, transform on popovers/drawer/modal/toast, background and border colour, the dot fill, the underline of the active tab (160ms width), the progress bar width.
- What never animates: hovered elements (no transforms, existing rule), table rows, layout (no height animations on collapse; groups snap), route changes (no page fade), text colour on hover (instant), icons at rest, the sidebar tree.
- `prefers-reduced-motion`: loops slow to 2.2s and translate animations become opacity-only; the splash renders static.

---

## 8. Differentiation: why this does not read as monday

monday's signature is colour as data: solid status cells, coloured group rails, coloured board icons, warm greys, Figtree, a green success banner. This system inverts every one of those levers while keeping the founder's blue:

1. **An ownable motif instead of a colour wall.** Four dots appear in the loader, the empty state, the step glyph, the section marker and the logo. monday, ClickUp, Asana and Linear have no glyph that a user could draw from memory. After a week a WorkwrK user can.
2. **Filled means act.** The hollow-vs-filled grammar carries meaning without colour, which is also what lets the chrome stay monochrome.
3. **Cool, near-achromatic neutrals** (slate ramp) instead of monday's warm `#323338 / #676879`. With one blue on white, the temperature of the greys is what the eye reads as "material".
4. **Pale chips and a dot** where monday paints a solid cell (solid stays only in the one dense column, as the brief allows).
5. **A white rail and an N50 sidebar** instead of a navy rail; structure felt, not seen.
6. **DM Sans**, whose circular tittles echo the mark, instead of Figtree. Blue + Figtree + warm greys photographs as monday; blue + DM Sans + slate + dots does not photograph as anyone.
7. **Quiet feedback**: neutral bottom-left toasts with an Undo, never a green banner.
8. **Brand hues are quarantined** to four tokens in one directory, so the product cannot drift back toward a YBRG rainbow through a hundred small decisions.

Against ClickUp: no purple, no three stacked headers, no chips on every row, no coloured empty groups. Against Linear: labels under every rail icon, visible buttons instead of shortcuts, warmer human copy in the values loader.

---

## 9. Migration onto `--os-*`

Names stay; values re-point; a semantic trio and a dot set are added; a short list is deleted. Every file already on `var(--os-*)` gets the new look with no code change.

### 9.1 Token map

| Existing `--os-*` | Action | New light value | New dark value | Notes |
|---|---|---|---|---|
| `--os-brand` | re-point | `#0073EA` | `#0073EA` | = `accent.solid` |
| `--os-brand-hover` | re-point | `#0062CC` | `#1A82F0` | one hover value everywhere |
| `--os-brand-soft` | re-point | `#EAF3FE` | `rgba(0,115,234,.14)` | = `accent.bg` / `bg.selected` |
| `--os-brand-deep` | re-point | `#0B5FC2` | `#4D9CFF` | = `accent.text`; `--os-brand-ink` becomes an alias of it |
| `--os-brand-dark`, `--os-brand-rail` | **delete** | | | navy rail retired; rail uses `--os-canvas` |
| `--os-brand-ink` | alias | `var(--os-brand-deep)` | | keep the name for the 30 consumers |
| `--os-c-green/orange/red/yellow/blue/teal/brown/sage/gray/darkgray` | **delete after sweep** | | | consumers move to `--os-success/warning/danger/info/neutral-*` or the muted-eight status data |
| `--os-c-purple/pink/indigo/lime` | **delete** | | | no redirect |
| `--os-canvas` | re-point | `#FFFFFF` | `#101215` | = `bg.app` |
| `--os-surface` | re-point | `#FFFFFF` | `#181B20` | = `bg.raised` |
| `--os-surface-1` | re-point | `#F6F7F9` | `#14171C` | = `bg.subtle` |
| `--os-surface-2` | re-point | `#EEF0F3` | `#1F232A` | = `bg.hover` |
| `--os-surface-3` | re-point | `#E4E7EC` | `#262A31` | = `bg.active` |
| `--os-surface-hov` | alias | `var(--os-surface-2)` | | |
| `--os-row-hov` | alias | `var(--os-surface-2)` | | one hover tone, not two |
| `--os-line` | re-point | `#E4E7EC` | `#262A31` | = `border.subtle` |
| `--os-line-soft` | alias | `var(--os-line)` | | the second hairline is gone |
| `--os-line-strong` | re-point | `#D0D5DD` | `#30353D` | = `border.default` |
| `--os-ink` | re-point | `#1F2430` | `#E6E8EC` | = `text.primary` |
| `--os-ink-2` | re-point | `#667085` | `#9AA3B2` | = `text.secondary` |
| `--os-ink-3` | re-point | `#98A2B3` | `#6B7280` | = `text.placeholder` |
| `--os-ink-4` | re-point | `#D0D5DD` | `#30353D` | decorative lines and disabled icons |
| **new** `--os-ink-tertiary` | add | `#475467` | `#B4BBC7` | = `text.tertiary` |
| **new** `--os-link` | add | `#0B5FC2` | `#4D9CFF` | |
| **new** `--os-focus` | add | `#A9CFFB` | `#4D9CFF` | replaces the `color-mix(brand 45%)` ring and `ring-[#0073EA]/40` |
| **new** `--os-success-bg/-text/-solid` | add | `#ECFDF3` / `#15803D` / `#15803D` | `#0F2A1A` / `#4ADE80` / `#15803D` | |
| **new** `--os-warning-bg/-text/-solid/-on-solid` | add | `#FFFAEB` / `#854D0E` / `#FACC15` / `#1F2430` | `#2A2208` / `#FCD34D` / `#FACC15` / `#1F2430` | |
| **new** `--os-danger-bg/-text/-solid` | add | `#FEF3F2` / `#B42318` / `#D92D20` | `#2C1212` / `#F87171` / `#D92D20` | replaces `#E2445C` destructive |
| **new** `--os-info-bg/-text`, `--os-neutral-bg/-text` | add | blue-50 / blue-700, N100 / N600 | `accent.bg` / blue-400, N925 / `#B4BBC7` | |
| **new** `--os-dot-y/-b/-r/-g` | add | `#FFCB00 / #0073EA / #FF3D57 / #00C875` | same | `brand/` and marketing only |
| **new** `--os-dot-outline`, `--os-dot-fill`, `--os-dot-unread`, `--os-dot-presence` | add | N300 / blue-600 / blue-600 / `#15803D` | `#30353D` / blue-600 / blue-600 / `#15803D` | |
| **new** `--os-inverse-bg/-fg`, `--os-scrim` | add | `#1F2430` / `#FFFFFF`, `rgba(16,18,21,.4)` | `#EEF0F3` / `#101215`, `rgba(0,0,0,.6)` | tooltips, bulk bar |
| `--os-r-xs/sm/md/lg/pill` | keep | 4 / 6 / 8 / 12 / 999 | | `--os-r-xl` (16) deleted |
| `--os-shadow-card`, `--os-shadow-rest` | **delete** | | | cards have no shadow |
| `--os-shadow-pop` | re-point | `0 8px 24px rgba(16,18,21,.12)` | `0 8px 24px rgba(0,0,0,.48)` | |
| **new** `--os-shadow-modal` | add | `0 8px 32px rgba(16,18,21,.16)` | `0 8px 32px rgba(0,0,0,.56)` | |
| `--os-rail-w` | re-point | 64px | | |
| `--os-side-w` | re-point | 248px | | |
| `--os-top-h` | re-point | 48px | | |
| `--os-title-h` | re-point | 48px | | now the content header |
| `--os-tabs-h` | **delete** | | | tabs live inside the header |
| `--os-filter-h` | re-point | 40px | | rename in place to the toolbar |
| **new** `--os-drawer-w` | add | 520px | | |
| `--os-page-pad` | re-point | 24px | | |
| `--os-card-pad` | re-point | 16px | | |
| `--os-row-h` | re-point | 36px | | data rows default |
| `--os-row-h-lg` | rename to `--os-row-h-compact` | 32px | | the meaning flipped; alias the old name for one release |
| `--os-control-h` / `-sm` | re-point | 32px / 28px | | plus new `--os-control-h-lg` 36px |
| `--os-popover-w` | re-point | 260px | | |
| `--os-font` | re-point | `var(--font-dm-sans), "DM Sans", -apple-system, ...` | | letter-spacing 0 |
| **new** `--os-font-mono` | add | `var(--font-geist-mono), "Geist Mono", ui-monospace, monospace` | | |
| `:root[data-accent=…]` blocks (11) | **delete** | | | with CustomizePanel's accent picker |

Retired outside `os.css`: the shadcn `--surface/--muted/--border/--foreground` set in `globals.css` (96 files move to `--os-*`), the bento lime dark palette and `.dark .avatar-fallback-tone`, marketing brand tokens inside the app, `--brand-red` as a CTA colour on the site, `ui/accent.ts` taupe, `app-shell.css`, the ~40 removed-module BEM families.

### 9.2 Order of work

1. **Tokens and rebinding** (one PR, no visual intent beyond values): re-point `--os-*`, add the new tokens, add the `:root.dark` and `prefers-color-scheme` rebinding blocks, keep the `!important` repaint layer in place for now. Every tokenised file (25%) is now on the new palette in both themes.
2. **Type**: swap the font in the root layout, set `@theme` sizes, remove the six families, add the `text-[Npx]` lint. Sweep the 356 files mechanically (13.5 → 14, 12.5 → 13, 11.5 → 12, 14.5 → 14, 10 stays only in the rail).
3. **Brand components**: `Dots` (new), `DotsLoader` and `ValueLoader` re-based on it (drop the shadow, monochrome variant, 200ms delay), `MissionSplash` on white with first-open-per-day, `LogoMark` sizes. Add the `--os-dot-` lint rule.
4. **Shell**: rail (white, 64, LogoMark top, pill), sidebar (248, N50, dot section markers, personal-first order), topbar (48, breadcrumb, search, Create), content header + toolbar, drawer container with URL.
5. **Primitives**: `Button`, `Chip/StatusChip`, `MenuItem/MenuList`, `ViewTab`, `EntityTile` (neutral default), `Dialog`, `useOsToast`/toast, `OsEmptyView` (quad-outline), `Switch`, `AutosaveIndicator` (saving dot), the picker popover, tooltip, skeleton. Each PR deletes the `!important` repaints that only that primitive needed.
6. **Empty-state and colour sweep**: every hub landing, every empty list, every "no results"; every `--os-c-*` and raw Y/R/G hex re-pointed to `success/warning/danger`; violet/purple/pink/indigo classes removed from the 18 files; verify with the contrast script in both themes.
7. **Protected screens restyled**: List, Board, Calendar, Gantt, task detail with tokens only (solid pill group headers → dot + label headers; calendar left edges → dots; Gantt rose bubble → `accent.solid`).
8. **Delete**: remaining `!important` repaints, the accent picker, dead CSS families, `app-shell.css`, `ui/empty-state.tsx`, `OsMainTable/OsTabs/OsFilterBar`, `accent.ts`.
9. Marketing last, on the same tokens and family.

### 9.3 Risks

- **DM Sans is a real change of voice.** It is slightly wider than Inter at 14px, so long German and French strings in the 248px sidebar and 200px breadcrumb crumbs need the ellipsis rules above to be real; and it does not cover Arabic, Hebrew or CJK, so RTL locales render in the system face (acceptable, but the mixed look must be reviewed). If the founder rejects it, the scale and everything else stand with Inter.
- **The white rail removes the one thing that made the shell look "designed"** at a glance; the LogoMark at the top and the blue pill have to carry that. Review in dark mode early, where a white rail becomes N900 and the pill is the only landmark.
- **Dot overuse.** The vocabulary in section 5 is the ceiling; if dots start appearing as bullets, dividers or decoration, the motif stops meaning anything. The lint rule guards the brand hues, but only review guards the monochrome dots.
- **`quad-outline` with one filled dot could be read as a progress indicator** ("1 of 4") on an empty state. Mitigation: the empty state's filled dot is the first dot and sits beside a button; the steps glyph is 8px and always beside step words. Test with five users in the first week.
- **Group headers change meaning on a protected parity screen** (solid pill → dot + word). It is a restyle, but it is the most visible one; ship behind the density preference first if the founder hesitates.
- **Solid semantic values are shared across themes**; on dark, `#FACC15` cells with N800 text are bright. Acceptable and verified (10.1:1), but the column will be the brightest thing on a dark screen. The pale default keeps this to one surface.
- **Removing the accent picker and the navy rail touches `ThemeApplier`, `CustomizePanel` and `OrgPreference` defaults**; those need a data migration that maps stored accents to "blue" and stored `iconsOnly` to false.
- **Dark-mode gap during the migration**: any class rename before step 5 lands for that file family silently loses its `!important` repaint. The order above is the mitigation; do not reorder it.
- **The lint rules are the system.** Without the `--os-dot-` and raw-hex rules, the four-place quarantine will erode in a month.
