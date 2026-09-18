# WorkwrK design system proposal: "Zoho-clean"

Stance: a dark-navy frame (rail + top bar) around a white canvas, the four brand dots as the only colour in the chrome, one blue Create button per page on the white canvas, a light-grey secondary sidebar of flat icon+label rows, the Zoho list-page header stack as THE page pattern, bordered-card tables with hairline rows, calm 15px row type, quiet grey-illustration empty states.

Date: 2026-09-11. Designed against `phase2-inputs.md` (hard constraints), `design-references.md` (verified contrast pairs, reused verbatim where they fit), `existing-direction.md` (what must be kept or consciously replaced), and the founder-endorsed `zoho-reference.md` + `zoho-ref-1.jpg` / `zoho-ref-2.jpg`.

One-liner: **A navy frame, a white page, one blue button.**

Everything a user works on is white. Everything that is not work is navy or grey. The only saturated colour on the working surface is the single blue Create button; the only saturated colour in the chrome is the four-dot logo. Two chrome variants are specified in full (navy default, light flip); everything below the chrome is byte-identical between them.

All contrast values marked (v) were computed with the WCAG 2.x relative-luminance formula this session or in `design-references.md` §4.7.

---

## 0. Decisions this proposal takes (and where it departs from the input briefs)

| Topic | Decision | Why |
|---|---|---|
| Chrome colour | Navy `#1B2537` rail + top bar (default); white flip available | Founder endorsed the Zoho navy frame; it is the single strongest lever away from "photographs like monday" |
| Where the blue Create button lives | In the content toolbar, right side, never in the top bar | Zoho rule: the primary never sits ON navy (`#0073EA` on `#1B2537` = 3.40:1 (v), fails text). Blue stays the one CTA on the white canvas |
| Rail labels | Kept (10px under the 20px icon) | Brief 1.2/4.1 hard rule: labels are the zero-training mechanism. Zoho's unlabelled rail is the one thing not copied |
| Page header | The Zoho stack verbatim: title row, text-tab saved views row, toolbar row | Founder's "exact stack" ask. Location moves into the top-bar breadcrumb so this is title + views + toolbar, not ClickUp's location + views + toolbar |
| Row type | 15px in data rows and sidebar rows, 14px body elsewhere | Zoho's calm 15 to 16px rows are what "clean" means to the founder; 14px base (brief 1.3) stays for body, forms, menus |
| Data row height | 44px comfortable (default), 36px dense | Zoho rows read as tall and calm; dense is the per-user preference |
| Filter | Side panel inside the content (272px bordered card), table narrows | Founder's ask; replaces popover soup |
| Empty states | Grey illustration + one sentence + at most one text-link action | Zoho's quiet widget empties; brief's "one sentence + one button" softened to a text link so the page keeps a single blue button |
| Type family | Inter (Google Fonts, variable) | Brief Q5 default; Figtree + `#0073EA` + monday greys is a clone |
| Neutrals | Cool low-chroma slate ramp from the brief, reused unchanged | Verified contrast; same hue family as the navy so frame and greys are one material |
| Accent picker | Removed; one blue + light / dark / system + chrome variant (navy / light) | Brief Q4 default. The chrome switch is the personalisation lever that replaces the 11 accents |
| Loader | Four dots on navy for first open per day (mission line under it); non-blocking four-dot caption for route transitions | Brief Q3 default; the navy splash and the navy chrome are the same surface, so the splash no longer feels like an overlay |

---

## 1. Colour

### 1.1 Layer 1: primitives (never referenced by components)

Generated in OKLCH so lightness steps look equal; hex values below are the sRGB outputs and are what ships.

**Neutrals (cool slate, chroma 2 to 4)** reused from the brief, verified there:

| Name | Hex | Notes |
|---|---|---|
| N0 | `#FFFFFF` | |
| N50 | `#F6F7F9` | |
| N100 | `#EEF0F3` | |
| N200 | `#E4E7EC` | |
| N300 | `#D0D5DD` | |
| N400 | `#98A2B3` | 2.58:1 on white (v): decorative only |
| N500 | `#667085` | 4.97:1 on white, 4.64:1 on N50, 4.36:1 on N100 (v): secondary text, never smaller than 13px on N100 |
| N600 | `#475467` | 7.17:1 on N50 (v) |
| N700 | `#344054` | 9.76:1 on N50 (v) |
| N800 | `#1F2430` | 15.52:1 on white, 14.48:1 on N50, 13.59:1 on N100 (v) |
| N900 | `#101215` | dark base |

**Navy (chrome only)**, same hue as N800, one step darker and slightly bluer:

| Name | Hex | Notes |
|---|---|---|
| NV900 | `#1B2537` | rail + top bar. White on it 15.37:1 (v) |
| NV800 | `#242F44` | hover on navy rows (white 10% over NV900 ≈ `#323B4B`; NV800 is the tokenised equivalent) |
| NV950 | `#0C0F14` | the chrome in dark mode (darker than the dark canvas so the frame relationship survives). `#E6E8EC` on it 15.65:1 (v) |

**Blue** (reused from the brief, verified there):

| Name | Hex |
|---|---|
| blue-50 | `#EAF3FE` |
| blue-100 | `#D4E7FD` |
| blue-200 | `#A9CFFB` |
| blue-400 | `#4D9CFF` (dark-mode accent text, 6.71:1 on `#101215`, 6.18:1 on `#181B20` (v)) |
| blue-600 | `#0073EA` |
| blue-650 | `#0062CC` (solid hover, 5.80:1 white (v)) |
| blue-700 | `#0B5FC2` (6.12:1 on white, 5.71:1 on N50 (v)) |
| blue-800 | `#0A4C9B` (pressed, 8.33:1 white (v)) |

**Green / yellow / red scales** exist in the generator only. They are NOT emitted as CSS variables. The only green, yellow and red variables that exist in `os.css` are the semantic ones in 1.2. This is how the "only semantic Y/R/G reaches components" rule is enforced: there is nothing else to reach for.

**Brand dots** (fixed, full saturation): Y `#FFCB00`, B `#0073EA`, R `#FF3D57`, G `#00C875`. Emitted as `--os-dot-y/b/r/g` and consumed by exactly three components: `Logo`, `DotsLoader`, marketing connectors. On NV900 they measure Y 10.10:1, G 6.97:1, R 4.43:1, B 3.40:1 (v); all pass the 3:1 non-text bar, which is the only bar a logo glyph needs.

### 1.2 Layer 2: semantic aliases (what components use)

Kept `--os-*` names where one already exists (so the 163 tokenised files keep working); new names only where the concept is new. LIGHT is the default; DARK is a rebinding of this layer only.

| Semantic | CSS variable | Light | Dark | Notes |
|---|---|---|---|---|
| bg.app | `--os-canvas` | `#FFFFFF` | `#101215` | page ground |
| bg.raised | `--os-surface` | `#FFFFFF` | `#181B20` | cards, table card, popovers, modals |
| bg.subtle | `--os-surface-1` | `#F6F7F9` | `#15181D` | secondary sidebar, table header, section bands, widget header strip |
| bg.hover | `--os-surface-hov` | `#EEF0F3` | `#1F232A` | row and menu hover |
| bg.active | `--os-surface-2` | `#E4E7EC` | `#262A31` | sidebar active pill, pressed ghost |
| bg.selected | `--os-selected` | `#EAF3FE` | `rgba(0,115,234,.14)` | selected row (13.86:1 N800 on it (v)) |
| bg.selected-hover | `--os-selected-hov` | `#D4E7FD` | `rgba(0,115,234,.22)` | |
| bg.scrim | `--os-scrim` | `rgba(16,18,21,.40)` | `rgba(0,0,0,.60)` | modal backdrop |
| border.subtle | `--os-line-soft` | `#EEF0F3` | `#1F232A` | hairline rows inside tables |
| border.default | `--os-line` | `#E4E7EC` | `#262A31` | card edges, dividers, top-bar bottom (light flip) |
| border.strong | `--os-line-strong` | `#D0D5DD` | `#30353D` | inputs, checkboxes at rest |
| text.primary | `--os-ink` | `#1F2430` | `#E6E8EC` | |
| text.secondary | `--os-ink-2` | `#667085` | `#9AA3B2` | |
| text.tertiary | `--os-ink-3` | `#98A2B3` | `#6B7280` | placeholder, decorative only |
| text.disabled | `--os-ink-4` | `#D0D5DD` | `#3A3F47` | |
| text.link | `--os-brand-ink` | `#0B5FC2` | `#4D9CFF` | links, accent text, active view icon |
| text.inverse | `--os-ink-inv` | `#FFFFFF` | `#FFFFFF` | on solid buttons |
| accent.solid | `--os-brand` | `#0073EA` | `#0073EA` | ONE per page |
| accent.solid-hover | `--os-brand-hover` | `#0062CC` | `#0062CC` | replaces `#0060B9` |
| accent.solid-pressed | `--os-brand-pressed` | `#0A4C9B` | `#0A4C9B` | |
| accent.bg | `--os-brand-soft` | `#EAF3FE` | `rgba(0,115,234,.14)` | info wash |
| accent.text | `--os-brand-deep` | `#0B5FC2` | `#4D9CFF` | same as text.link; alias kept for the 465 existing uses |
| focus.ring | `--os-focus` | `#0073EA` | `#4D9CFF` | 2px ring, 2px offset, `:focus-visible` only |
| success.bg | `--os-success-bg` | `#ECFDF3` | `#0F2A1A` | |
| success.text | `--os-success-text` | `#15803D` | `#4ADE80` | 4.76:1 light, 8.82:1 dark (v) |
| success.solid | `--os-success-solid` | `#15803D` | `#15803D` | white text 5.02:1 (v) |
| warning.bg | `--os-warning-bg` | `#FFFAEB` | `#2A2208` | |
| warning.text | `--os-warning-text` | `#854D0E` | `#FCD34D` | 6.57:1 light, 10.94:1 dark (v) |
| warning.solid | `--os-warning-solid` | `#FACC15` | `#FACC15` | N800 text ONLY, 10.1:1 (v); yellow never carries white |
| danger.bg | `--os-danger-bg` | `#FEF3F2` | `#2C1212` | |
| danger.text | `--os-danger-text` | `#B42318` | `#F87171` | 6.05:1 light, 6.31:1 dark (v) |
| danger.solid | `--os-danger-solid` | `#D92D20` | `#D92D20` | white text 4.83:1 (v); replaces `#E2445C` |
| info.bg / info.text | `--os-brand-soft` / `--os-brand-deep` | blue-50 / blue-700 | as accent | 5.47:1 (v) |
| neutral.status bg / text | `--os-surface-hov` / `--os-ink-2` | N100 / N600 | `#1F232A` / `#9AA3B2` | not started, none |
| presence.online | `--os-presence` | `#15803D` | `#4ADE80` | the 8px dot on avatars; the only green in chrome |
| attention.dot | `--os-attention` | `#D92D20` | `#F87171` | 6px unread dot on rail icons; the only red in chrome |

**Chrome tokens** (the layer that flips between navy and light). Rail and top bar read ONLY these; nothing else in the app reads them.

| Chrome | CSS variable | Navy (default) light mode | Navy variant, dark mode | Light flip, light mode | Light flip, dark mode |
|---|---|---|---|---|---|
| chrome.bg | `--os-chrome-bg` | `#1B2537` | `#0C0F14` | `#FFFFFF` | `#181B20` |
| chrome.bg-hover | `--os-chrome-hov` | `#242F44` | `#161A21` | `#EEF0F3` | `#1F232A` |
| chrome.fg | `--os-chrome-fg` | `#FFFFFF` (15.37:1 (v)) | `#E6E8EC` | `#1F2430` | `#E6E8EC` |
| chrome.fg-muted | `--os-chrome-fg-2` | `#A3AEC2` (6.87:1 (v)) | `#8E9BB3` (6.85:1 (v)) | `#475467` | `#9AA3B2` |
| chrome.line | `--os-chrome-line` | `rgba(255,255,255,.12)` | `rgba(255,255,255,.08)` | `#E4E7EC` | `#262A31` |
| chrome.pill.bg (active) | `--os-chrome-pill` | `#FFFFFF` | `#262A31` | `#E4E7EC` | `#262A31` |
| chrome.pill.fg (active) | `--os-chrome-pill-fg` | `#1B2537` | `#FFFFFF` | `#1F2430` | `#FFFFFF` |
| chrome.field.bg (search on the bar) | `--os-chrome-field` | `rgba(255,255,255,.10)` | `rgba(255,255,255,.06)` | `#F6F7F9` | `#15181D` |
| chrome.field.fg | `--os-chrome-field-fg` | `#FFFFFF` | `#E6E8EC` | `#1F2430` | `#E6E8EC` |
| chrome.field.placeholder | `--os-chrome-field-ph` | `rgba(255,255,255,.64)` (7.14:1 (v)) | `rgba(255,255,255,.50)` | `#98A2B3` | `#6B7280` |
| side.bg | `--os-side-bg` | `#F6F7F9` | `#15181D` | `#F6F7F9` | `#15181D` |
| side.pill (active) | `--os-side-pill` | `#E4E7EC` | `#262A31` | `#E4E7EC` | `#262A31` |

The secondary sidebar is grey in BOTH variants; it belongs to the canvas side of the frame, not the chrome. The variant is a `data-chrome="navy|light"` attribute on `<html>`, stored per user (Preferences → Appearance), default `navy`.

### 1.3 Layer 3: component tokens (sparse, only genuine deviations)

| Token | Value | Consumer |
|---|---|---|
| `--os-chip-h` | 24px | Chip / StatusChip |
| `--os-chip-solid-*` | resolved per status from the semantic trio | StatusChip in the solid column mode only |
| `--os-table-head-bg` | `var(--os-surface-1)` | table card header row |
| `--os-table-row-line` | `var(--os-line-soft)` | hairline between rows |
| `--os-widget-head-bg` | `#EEF3FB` light / `#171C26` dark | the pale-blue header strip on home widgets (Zoho ref 2); the only tinted band in the product |
| `--os-rail-pill-size` | 40px | rail active pill |
| `--os-dot-y/b/r/g` | brand hexes | Logo, DotsLoader, marketing |
| `--os-status-user-*` | 8 muted hues, see 5.9 | user-defined List status colours (data, not chrome) |

### 1.4 Rules that make the palette hold

1. Blue appears on the white canvas only as: the one Create button per page, links, focus rings, checked controls, toggles-on, progress, active view-type icon, selected rows. Never on the navy chrome, never on headers, tabs, group bars, icons at rest or illustrations.
2. On navy, the accent is white: active pill, active icon, active label. Blue is structurally impossible there (fails contrast) which keeps the rule self-enforcing.
3. Y/R/G reach components only as `--os-success-*`, `--os-warning-*`, `--os-danger-*`, `--os-presence`, `--os-attention`. No generic yellow/red/green variable exists.
4. Colour never travels alone: every semantic colour is paired with a word or a glyph.
5. Status chips are pale by default. Solid fills are allowed on exactly one surface: the status column of Board list/table views and Tables, where the whole column is solid.
6. Brand dots and semantic tokens never mix: `#00C875` never in a Done chip, `#15803D` never in the logo.
7. No hue-keyed Spaces/Folders/groups by default; `EntityTile` renders neutral (N100 tile, N600 glyph). The optional user colour set is 5.9.
8. Charts use the dataviz skill's brand-neutral palette; the semantic trio appears in a chart only when a series genuinely means success/warning/danger.

### 1.5 Dark-mode strategy

- Dark is a rebinding of layer 2 (and the chrome table) under `:root.dark .workwrk-os` and `@media (prefers-color-scheme: dark)` when the user picks "system". Zero component-level colour literals; zero `!important` utility repaints. The `.os-sk` panel already proves the pattern in the codebase.
- Elevation in dark = lighter surface, not shadow: `#101215` base → `#181B20` raised → `#1F232A` second level → `#262A31` active. Borders `#262A31` / `#30353D`, deliberately faint.
- Solid buttons keep `#0073EA` (white 4.53:1 (v)); accent text lifts to `#4D9CFF`. Never blue-700 on dark.
- The navy chrome goes to `#0C0F14` in dark so the frame is still darker than the page; the active pill becomes `#262A31` with white text (a white pill on near-black glares).
- Brand dots on the dark base: Y 12.32:1, G 8.50:1, R 5.41:1, B 4.15:1 (v); the logo needs no dark variant.
- "High contrast" is a toggle that raises `--os-ink-2` to `#B8C0CC` and `--os-line` to `#3A3F47` in dark (and `--os-ink-2` to `#475467` in light), not a third theme.
- Light first; marketing is light only.

---

## 2. Type

**Family**: **Inter** (Google Fonts, variable, `next/font/google` with `weight: ['400','500','600']`, `display: 'swap'`). Fallback stack: `Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`. Mono: **JetBrains Mono** (already loaded) for code, formulas, IDs. The other five loaded families (Outfit, Syne, Geist, Geist Mono, Instrument Serif, Figtree) are dropped from the app root layout. Letter-spacing 0 everywhere except uppercase section labels (+0.06em). `font-feature-settings: "cv11", "ss01", "tnum"` on tables and numbers only (`tnum` gives tabular figures for right-aligned columns).

**Scale** (px / weight / line-height). 14px base, floor 10, half-pixel sizes banned. Eight sizes replace the 14 arbitrary `text-[Npx]` sizes in 356 files.

| Token | Size / weight / lh | Use |
|---|---|---|
| `--os-t-rail` | 10 / 500 / 12 | rail labels only (white or `--os-chrome-fg-2` on navy) |
| `--os-t-micro` | 11 / 600 / 14, uppercase, +0.06em | sidebar section labels ("PINNED", "SPACES"), table header letters in Tables |
| `--os-t-meta` | 12 / 500 / 16 | chips, counts, timestamps, breadcrumb middle crumbs, kbd hints |
| `--os-t-helper` | 13 / 400 / 18 | form helper, secondary lines, toast second line |
| `--os-t-body` | 14 / 400 / 20 | body copy, forms, menus, pickers, modals, buttons |
| `--os-t-row` | 15 / 400 / 22 | table cells, list rows, sidebar rows, view-tab labels, filter-panel rows |
| `--os-t-row-strong` | 15 / 500 / 22 | first (title) column in a table, active sidebar row, active view tab |
| `--os-t-title` | 16 / 600 / 22 | section titles, modal titles, card titles, empty-state title, filter panel heading |
| `--os-t-page` | 22 / 600 / 28 | page title (Zoho's ~24 at 2x, tuned to our 14 base) |

Marketing only: display 48 to 72 / 600 / 1.05 on white.

**Hierarchy rule**: weight and grey before size. A page has at most three sizes on screen at once (page 22, rows 15, meta 12/13). Emphasis = 500 weight, de-emphasis = `--os-ink-2`. Never bold (700) in product UI; 600 is the ceiling. Never colour as emphasis except links.

**Row text on the two backgrounds**: 15/400 N800 on white (15.52:1), on N50 (14.48:1), on the N200 pill (12.x:1); all (v) AAA.

---

## 3. Rhythm

- **Grid**: 4px. Spacing scale `--os-s-1..8` = 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64.
- **Row heights** (`--os-row-h`): **44px comfortable (default)**, **36px dense** (per-user preference in Preferences → Appearance → Density, admin may lock). Nav rows (secondary sidebar, menus, pickers) are always 36. Rail items 56. Nothing else. Three row heights on one screen is what cluttered means; here the screen has 36 (nav) and one of 44/36 (data).
- **Control heights**: 36 default (inputs, buttons, toolbar chips, text-tab pills), 32 small (in-row buttons, chip actions), 24 chips. The one blue Create button is 36 like every other control; it earns attention through colour, not size.
- **Radii** (`--os-r-*`): `xs` 4 (checkboxes, kbd), `sm` 6 (inputs, buttons, chips, text-tab pills, chrome search field), `md` 8 (cards, table card, filter panel, menus, popovers, rail active pill, sidebar active pill, kanban cards, toasts), `lg` 12 (modals, drawers, widget cards), `pill` 999 (avatars, count badges, presence dots). `xl` 16 is retired; `rounded-2xl/3xl` are banned in the app.
- **Elevation policy**: borders over shadows. Structural border `--os-line`, input border `--os-line-strong`, in-table hairline `--os-line-soft`. Shadows exist for exactly three things: popovers/menus `0 8px 24px rgba(16,18,21,.12)` (`--os-shadow-pop`), modals/drawers `0 8px 32px rgba(16,18,21,.16)` (`--os-shadow-modal`), drag ghost = popover shadow. `--os-shadow-card` and `--os-shadow-rest` are retired (cards are bordered). In dark mode shadows are replaced by the lighter-surface step.
- **Padding**: page content 24 (`--os-page-pad`), card 16 (`--os-card-pad`), modal 24, table cell 12 horizontal, sidebar 12 horizontal, chrome 12.
- **Content max widths**: tables and boards fluid; docs / SOPs / goal pages 720 column; settings forms 560; drawer 520.

---

## 4. Shell

Navy variant is described; the light flip substitutes the chrome tokens from 1.2 and changes nothing else. All widths are CSS variables; RTL mirrors via logical properties (`inset-inline-start`, `padding-inline`, `border-inline-end`), never `left/right`.

### 4.1 Rail (`--os-rail-w: 64px`)

- Background `--os-chrome-bg`. Full height. Never scrolls. No `border-inline-end`; the colour step is the edge.
- **Top**: the four-dot logo mark, 28px wide, centred, 16px from the top, brand hexes on navy (the single coloured object in the chrome). Click = Work hub. In the light flip it is the same mark on white.
- **Items**: 8 hubs in the admin's order (Work, Planner, AI, Talk, Teams, Docs, Tables, Settings). Each item is 56px tall, full rail width, 8px gap: a 20px Lucide icon (1.5px stroke) centred in a 40x40 pill area, then the label 10/500 centred below, 2px gap. Icon and label `--os-chrome-fg-2` at rest; hover `--os-chrome-hov` 40x40 pill behind the icon, icon and label to `--os-chrome-fg`; **active** = `--os-chrome-pill` (white) 40x40 pill radius 8 behind the icon, icon `--os-chrome-pill-fg` (navy), label `--os-chrome-fg` (white) at 500 weight. This is Zoho's white pill plus a label.
- Attention dot: 6px `--os-attention` at the icon's top-right, 2px `--os-chrome-bg` ring. No numeric badges on the rail.
- **Bottom cluster**: Settings hub pinned last (so it sits at the bottom, still a hub per 1.2), then the avatar 28px with an 8px `--os-presence` dot (menu: Profile, Preferences, Theme light/dark/system, Chrome navy/light, Log out). No Upgrade, no Invite, no workspace avatar at the top.
- Icons-only rail option is removed from CustomizePanel. Labels are max 9 characters; current labels pass.
- Keyboard: arrow keys move between hubs, Enter opens; `aria-current="page"` on the active hub.

### 4.2 Secondary sidebar (`--os-side-w: 264px`)

- Background `--os-side-bg` (N50) in both variants, `border-inline-end: 1px solid var(--os-line)`. Collapsible to zero (rail only) with the small circular chevron button at the bottom edge of the sidebar's outer border (Zoho ref 1), state remembered per user. Resizable 240 to 320.
- **Header (56px)**: workspace switcher = `EntityTile size="sm"` (neutral tile, org initials) + org name 15/500 + chevron, hover `--os-surface-hov` pill radius 6. Below it, one full-width search input (36px, white, `--os-line-strong` border, radius 6, magnifier 16px N400, placeholder "Search {hub}…") that filters the tree in place. Not the global search.
- **Rows (36px)**: `padding-inline: 12px`, gap 12, one 20px Lucide icon in `--os-ink-2`, label 15/400 `--os-ink`, optional count right-aligned 12/500 `--os-ink-2`. Hover `--os-surface-hov`, radius 8, inset 8px from the sidebar edges (so the pill has air). **Active** = `--os-side-pill` (N200) pill, radius 8, label 15/500, icon `--os-ink`. No blue, no left bar, no coloured icons.
- **Section labels**: 11/600 uppercase +0.06em `--os-ink-2`, a 1px `--os-line` rule running from the label to the right edge (Zoho ref 2), 24px top margin, 8px bottom. Collapsible with a chevron that appears on hover.
- **Work hub order**: personal rows first (Home, My work, Inbox with count), then FAVORITES, then the access-derived SPACES tree. Other hubs open directly on their tree, folded apps as labelled sections (Docs: LIBRARY, SOPS, POLICIES, CONTRACTS, CLIPS).
- **Tree**: Space rows are 36px with `EntityTile size="sm"` neutral; children indent 20px per level, no guide lines; leaf rows keep the 36px height; hover reveals a single "…" at the right (star and "+" live inside that menu, not as three hover icons).
- **Footer (44px)**: the one "Customize Sidebar" button, ghost, 13/500 `--os-ink-2` with a 16px sliders icon, `border-top: 1px solid var(--os-line)`. Opens the CustomizePanel (appearance: theme / chrome / density; section visibility and order).
- Nothing promotional, no cards, no tips.

### 4.3 Top bar (`--os-top-h: 48px`)

One row, `--os-chrome-bg`, no bottom border in navy (the colour step is the edge), `1px solid var(--os-line)` in the light flip. Spans the full width to the right of the rail.

- **Left (from 12px)**: back ‹ and forward › icon buttons (32px, `--os-chrome-fg-2`, disabled at 40% when there is no history), then the **hierarchy breadcrumb**: Hub › Space › Folder › List › Item. Crumbs 14/400 `--os-chrome-fg-2`, separators "›" at 50% opacity, last crumb 14/500 `--os-chrome-fg` and not clickable; middle crumbs collapse to "…" (a menu) past 4 levels; each crumb truncates at 160px. `EntityTile size="xs"` appears only on the Space crumb. This absorbs the old location bar; there is never a second location row.
- **Centre**: global search, 400px (shrinks to 240 below 1280px), 32px tall, `--os-chrome-field` background, 1px `--os-chrome-line` border, radius 6, magnifier 16px, placeholder "Search or jump to…" in `--os-chrome-field-ph`, a `⌘K` kbd hint at the right in `--os-chrome-fg-2` at 12px. Opens the command palette.
- **Right (to 12px)**: "+" icon button (opens the Create menu: Task, Doc, List, Reminder, Notepad, Voice note, then the AI entries), Reminders bell (6px `--os-attention` dot when due), Help "?", avatar 28px with presence dot. All 32px hit areas, icons `--os-chrome-fg-2`, hover `--os-chrome-hov` pill radius 6. **No solid blue button on the bar** (rule 1.4.2). No quick-tool icon row.
- **Settings takeover** replaces the sidebar + content with its own left list; the rail and top bar stay; the breadcrumb reads "Settings › Workspace › Modules" and a "Back to app" text link sits first in the settings list.

### 4.4 Content header: the page pattern

Three thin rows, always in this order, padding-inline 24, on the white canvas. Total height 140px before the first data pixel (title 56 + views 36 + toolbar 48), against today's 32 + 40 + 34 + 34 = 140 with the top bar; the same budget with one fewer band and 15px type.

1. **Title row (56px, padding-top 24)**: page title 22/600 `--os-ink` (optionally preceded by `EntityTile size="lg"` neutral for Space/List pages). Right: page-level ghost actions only (Share, "…"). At most one "Ask AI" slot at the far right (the reserved AI door), icon button, ghost.
2. **Views row (36px)**: saved views as **text tabs**: 15/400 `--os-ink-2`, 32px tall, padding-inline 12, radius 6; hover `--os-surface-hov`; **active** = `--os-surface-2` (N100) pill with 15/500 `--os-ink`. No underline bar, no coloured icons (the current `ViewTab` underline and per-view colour retire; the primitive is restyled, not replaced). Overflow past the available width goes into a "•••" menu. "+ View" is the last item, ghost, 13px.
3. **Toolbar row (48px, gap 8)**: left = **Filter** (funnel 16px + "Filter", a 36px toggle chip that turns `--os-surface-2` and shows a count "Filter · 2" when the side panel is open), **Sort** (arrows + "Sort"), **Group** (only on Board/List surfaces), a 1px 20px-tall `--os-line` divider, then the **view-type switcher**: a run of 32px icon buttons (list, board, calendar, gantt, table, …) with the active one in `--os-brand-ink` on `--os-brand-soft` radius 6, others `--os-ink-2`, overflow chevron after 6. Right = **the one blue button**: "Create task" / "New doc" / "New table" (36px, `--os-brand` fill, white 14/500 label, 16px plus icon, radius 6, hover `--os-brand-hover`, pressed `--os-brand-pressed`), optionally fused to a 36px split-chevron (`1px rgba(255,255,255,.24)` divider) for "Create from template"; then a bordered "…" square (36px, `--os-line-strong` border) holding Import, Export, Automations…, Settings. `Display` (fields shown, subtasks, closed) is the first entry of "…", not a chip.
4. Below: content. If Filter is open, a **272px filter panel** sits at the left of the content with 16px gap; the table/board narrows.

Protected parity screens (List/Board/Calendar/Gantt/task detail) keep their internal structure and receive this header stack and the tokens; that is the "restyle, not restructure" boundary.

### 4.5 Detail-view policy

| Situation | Pattern | Width |
|---|---|---|
| Task, table row, person, from a list/board | **Drawer** over the list, right side, full height under the top bar, `--os-surface`, `border-inline-start: 1px solid var(--os-line)` + `--os-shadow-modal`, own 48px header (expand ⤢, copy link, close ✕ as 32px ghost icon buttons, breadcrumb of List › Item in 13px), same URL as `/item/[id]` | 520 (resizable 480 to 720) |
| Doc, SOP, goal, review, KRA, role page | Full page, 720 content column centred, breadcrumb in the top bar + `BackButton{fallbackHref}` at the top of the column | 720 |
| From search, notification, deep link | Full page (no list to sit beside), `BackButton` shows the natural parent | 720 or fluid |
| Inbox, Talk threads | Split: list 360 left (`--os-surface-1`), detail right | 360 + fluid |
| Short create/edit (task, list, member, space) | Centred modal | 560 |
| Rich create (with description) | Centred modal | 720 |
| Editors (statuses, fields, automations) | Centred modal | 960 max |
| Confirm / destructive | Centred modal, danger primary only when destructive, typed confirmation for org-level deletes | 400 |
| Person / channel / Space info | Right panel 360, never modal | 360 |

No stacked modals; a picker inside a modal is an absolutely positioned child (existing rule). Every drawer has its page's URL so copy link always works.

---

## 5. Component standards

Every component below is one spec; sizes reference section 3, colours section 1. Icons are Lucide, 1.5px stroke, 16px inside rows and controls, 20px in the rail, the sidebar and the filter panel.

### 5.1 Table (the bordered card)

- Card: `--os-surface`, `1px solid var(--os-line)`, radius 8, overflow hidden, no shadow. The card sits directly under the toolbar with 8px gap, fluid width, `overflow-x: auto` inside the card.
- **Header row (44px)**: `--os-table-head-bg` (N50), `border-bottom: 1px solid var(--os-line)`. Labels 13/500 `--os-ink-2` sentence case (not uppercase; Zoho uses sentence case). First cell = 20px checkbox column (44px wide), checkbox visible at rest as a 18px `--os-line-strong` outlined square radius 4 (Zoho shows it; monday hides it). An **inline header filter** on any column: the label followed by "All ▾" 13/400 `--os-ink-2` that opens the column's value picker. The last header cell is a 44px pinned **column settings** icon button (sliders 16px). Sortable columns show a 12px arrow only when sorted. Column resize handle on hover (2px `--os-brand` line while dragging).
- **Body rows**: `--os-row-h` (44 default / 36 dense), `border-bottom: 1px solid var(--os-line-soft)` hairline, no zebra, no hover chrome except `--os-surface-hov` on the row. Cells 15/400 `--os-ink`, 12px padding-inline, the first (title) column 15/500. Wrap allowed in text cells (Zoho lets emails wrap); numbers right-aligned with `tnum`. Selected row `--os-selected`, checkbox checked `--os-brand` fill with white check.
- Cell contents budget: at most one chip and one avatar group per row; everything else is text. Status chip in its column follows rule 1.4.5.
- **Footer row (44px)** inside the card, `border-top: 1px solid var(--os-line)`, `--os-surface`: left "Total records 644" 13/500 `--os-ink` (number 500 weight), right "1 to 40" 13/400 `--os-ink-2` with ‹ › 32px icon buttons and a page-size select on hover. Streaming tables (Tables module) keep infinite scroll and show only the total.
- **Bulk bar**: appears when ≥ 1 row is checked, floating bottom-centre of the content, 48px, `--os-surface`, `1px solid var(--os-line)`, radius 8, `--os-shadow-pop`: "3 selected" 14/500, 4 to 6 ghost actions, ✕. Never dark.
- Empty group / no rows: one 44px row "No tasks yet · Add task" 15/400 `--os-ink-2` with the action as a text link. "+ Add task" ghost row last in every group.
- Column "+" at the end of the header opens the field-type picker with "Show more" after 10.
- Tables module (Sheets-grade) keeps its own rules (letter headers, no selection chrome, 1000-row default, tiny corner add controls); it inherits only the card border, hairlines, type and tokens.

### 5.2 Filter side panel

- 272px, `--os-surface`, `1px solid var(--os-line)`, radius 8, padding 16, sticky under the toolbar, full content height with its own scroll.
- Heading "Filter {objects} by" 16/600, then a 36px search input, then a list of **checkbox rows** 36px (18px checkbox + label 15/400) for every filterable field; checking a row expands an inline value control below it (a picker list, a date range, a text input) and adds a count to the Filter chip. A "Clear all" text link sits at the top right of the heading when anything is active. Saved filters: "Save as view" text link at the bottom. Escape or the Filter chip closes it. On widths under 1024 the same panel is a 320px drawer.

### 5.3 Kanban card

- Column 280px, gap 12, column background `--os-surface-1`, radius 8, header 44px: status name 15/500 + count 12/500 `--os-ink-2` + "…". Column header is text, never a solid status pill.
- Card: `--os-surface`, `1px solid var(--os-line)`, radius 8, padding 12, no shadow at rest, `--os-shadow-pop` while dragging. Content: title 15/400 2-line clamp; one row of at most 3 pale chips (priority glyph, due date, one label; never status); bottom row ID 12/500 `--os-ink-2` left, avatars 24px right. Hover `--os-surface-hov` border stays.
- "+ Add task" ghost at the bottom of each column; "+ Add group" as a dashed `--os-line-strong` ghost column.

### 5.4 Forms

- Label above the input 13/500 `--os-ink` (N700-equivalent weight via 500, not colour), helper 13/400 `--os-ink-2` below, required mark as text "(required)" not a red asterisk.
- Input 36px, `--os-surface`, `1px solid var(--os-line-strong)`, radius 6, 14/400, padding-inline 12, placeholder `--os-ink-3`. Hover border `--os-ink-3`; focus `2px solid var(--os-focus)` ring at 2px offset (`:focus-visible`), border unchanged; error border `--os-danger-solid` + helper in `--os-danger-text` with a 16px alert-circle glyph; disabled `--os-surface-1` fill, `--os-ink-4` text.
- Textarea min 3 rows, auto-grow to 12. Selects, dates and people are pickers (5.6), never native.
- Groups: white cards (`--os-line` border, radius 8, padding 24) with a 16/600 title + 13px description, max 5 fields per card, 16px between fields, 24px between cards. Width 560 on pages, full width in modals.
- One primary per form: right-aligned in modal footers, left-aligned under the last card on pages. Toggles and selects auto-save with an inline "Saved ✓" 12/500 `--os-success-text` that fades after 2s; text forms show a sticky bottom save bar (56px, `--os-surface`, top border) only when dirty. Danger zone = a card with a `--os-danger-solid` 1px border at the bottom.

### 5.5 Modals and drawers

- Sizes 400 / 560 / 720 / 960 (4.5). Radius 12, `--os-surface`, `--os-shadow-modal`, scrim `--os-scrim`. Header 56px: title 16/600, optional 13px description, ✕ at the right. Body padding 24, footer 64px with Cancel (ghost) left of one primary (right). Escape and outside-click close (not for dirty forms: confirm). Focus trapped; pickers inside are absolute children.
- Drawer: 520px right, header 48px (4.5), body is the same component as the page. Opens in 200ms, closes in 160ms.

### 5.6 The one picker popover

- One `Picker` component for status, assignee, date, label, priority, column filter values: width 280 (min 240), `--os-surface`, `1px solid var(--os-line)`, radius 8, `--os-shadow-pop`. Search input at the top (36px, auto-focused, borderless with a bottom `--os-line`), then 36px rows: 16px glyph (identical to the glyph used in the list) + label 14/400 + right-aligned kbd hint or check (multi-select). Keyboard: ↑↓ Enter Esc, type-ahead. Sections via 11/600 uppercase labels. Footer row only for "Invite by email" (people) or "Manage statuses" (status), ghost 13px.
- Date variant: quick chips row (Today, Tomorrow, Next week, No date) at 24px, then one month grid 32px cells, natural-language input in the search field.
- Priority: urgent = `--os-danger-text` flag glyph, high = `--os-ink` filled flag, normal = `--os-ink-2` outline, low = `--os-ink-3` outline. No yellow, no blue.

### 5.7 Toasts

- Bottom-left, 24px from the edges, above the call-dock region. `--os-surface`, `1px solid var(--os-line)`, radius 8, `--os-shadow-pop`, min 320 max 480, padding 12 16. Text 14/400, optional 13px second line; a 16px glyph at the left (`--os-success-text` check, `--os-danger-text` alert, otherwise `--os-ink-2` info); one text action (Undo, 14/500 `--os-brand-ink`); ✕. 5s auto-dismiss (8s with an action), max 3 stacked with 8px gap, newest at the bottom. Never for validation; never a coloured background; never a full-width banner. `useOsToast` keeps its API.

### 5.8 Empty states (quiet)

- Template: a 96px illustration built from the four-dot motif in `--os-line-strong` (N300) line art, grey only (no brand hexes, no semantic hues), then one sentence 15/400 `--os-ink-2` centred ("No tasks yet", "You are not part of any team"), then optionally ONE text link 14/500 `--os-brand-ink` ("Create a task", "Learn more"). Centred in the content area with 64px top margin. The page's blue Create button in the toolbar remains the one primary; the empty state never adds a second blue button.
- Home widgets (Zoho ref 2): a widget card `--os-surface`, `1px solid var(--os-line)`, radius 12, 60px header strip in `--os-widget-head-bg` with the widget title 15/500 and a 20px icon `--os-ink-2`, then the same quiet empty block.
- Filtered-empty: an inline 44px row "No results · Clear filters" 15px `--os-ink-2` with the action as a text link; no illustration.
- New workspaces: a "Get started with" chip row (Task, Doc, Table, Invite) + a 5-item checklist card, instead of an illustration.
- `OsEmptyView` is retained and retinted to this template (44 importers); `ui/empty-state.tsx` is deleted.

### 5.9 Chips and status

- `Chip`: 24px, radius 6, 12/500, padding-inline 8, `--os-surface-hov` fill + `--os-ink` text by default, 12px glyph optional, removable with a 12px ✕. Toolbar chips (Filter, Sort) are 36px controls, not chips.
- `StatusChip` pale (default): `{success|warning|danger|info|neutral}.bg` fill + `.text` text + a 6px dot or glyph, 12/500. Solid (status columns only): `.solid` fill, white text (or N800 on warning), 12/500, full cell height 28px radius 6.
- Mapping: done/on track → success; in progress/due soon/at risk → warning; overdue/blocked → danger; review/info → info; not started/none → neutral.
- **User-defined List status colours** are data and stay; the picker offers exactly 8 muted hues excluding the three semantic hues: slate `#64748B`, steel `#5B7A99`, teal `#2F8F83`, indigo-grey `#5C6BA0` (chroma-capped, not brand purple), plum `#8C5A7A`, clay `#A2674D`, olive `#7A8A3A`, sand `#A08B5C`. Emitted as `--os-status-user-1..8`. `--os-c-*` (the monday palette) is deleted; existing user statuses are remapped to the nearest of the 8 by hue on migration.
- Reserved chip styles: **performance band** (neutral chip with a 500-weight letter grade and a 4px `--os-ink-3` bar), **co-presence** ("Priya is editing": avatar 16px + 12px text on `--os-surface-hov`), both neutral.
- Taupe (`ui/accent.ts`) is deleted; labels use the neutral chip.

### 5.10 Buttons

All 36px (32 small), radius 6, 14/500, padding-inline 12 (16 with an icon), 16px icon, gap 8, no transform on hover or press, 120ms background transition.

| Variant | Rest | Hover | Pressed | Disabled |
|---|---|---|---|---|
| Primary (one per page) | `--os-brand` fill, white | `--os-brand-hover` | `--os-brand-pressed` | `--os-surface-2` fill, `--os-ink-4` text |
| Secondary | `--os-surface`, `1px solid var(--os-line-strong)`, `--os-ink` | `--os-surface-hov` | `--os-surface-2` | same |
| Ghost | transparent, `--os-ink-2` | `--os-surface-hov`, `--os-ink` | `--os-surface-2` | `--os-ink-4` |
| Destructive | `--os-danger-solid` fill, white; only inside confirm modals and danger zones | `#B42318` | `#912018` | as primary |
| Link | `--os-brand-ink` text, underline on hover only | | | |
| Icon button | ghost, 32 or 36 square, tooltip + `aria-label` mandatory | | | |

Split button = primary + 36px chevron half separated by `1px rgba(255,255,255,.24)`. Focus ring on all: `2px solid var(--os-focus)` at 2px offset.

### 5.11 Inputs, checkbox, switch, radio

- Checkbox 18px, radius 4, `1px solid var(--os-line-strong)`, checked `--os-brand` fill + white 12px check, indeterminate a 8px white bar. Radio 18px pill. Switch 36x20, track `--os-line-strong` off / `--os-brand` on, 16px white knob, 160ms.
- Search inputs get a 16px magnifier at the left and a ✕ clear at the right when non-empty.

### 5.12 Tabs

- **Text-tab pills** (saved views, settings sub-tabs, drawer Comments/Activity): 32px, 15/400 (14 inside drawers and modals) `--os-ink-2`, radius 6, active `--os-surface-2` + 500 weight `--os-ink`. The existing `ViewTab` primitive is restyled to this; the zinc-900 underline and the per-view coloured icon are retired.
- **Underline tabs** exist nowhere in the app. The only underline in the system is on the marketing site nav.

### 5.13 Tooltips

- `--os-ink` (N800) fill, white 12/400 text, radius 6, padding 6 8, `--os-shadow-pop`, 400ms show delay, 0 hide delay, 8px offset, arrow-less. Include the kbd hint when one exists ("Create task · ⌘T"). Dark mode: `--os-surface-2` fill, `--os-ink` text.

### 5.14 Iconography

- Lucide only, 1.5px stroke, round caps. 20px in the rail, sidebar rows, filter-panel rows, page-title tile; 16px in table rows, buttons, menus, chips, inputs; 12px inside chips. Colour: `--os-ink-2` at rest on the canvas, `--os-chrome-fg-2` at rest on the chrome; coloured only when active (rail: white pill; view-type: `--os-brand-ink`), semantic (status glyph), or destructive (menu item in `--os-danger-text`). One icon per concept app-wide (assignee `UserPlus`, due `CalendarPlus`, priority `Flag`, tags `Tag`, more `MoreHorizontal`, filter `Funnel`, sort `ArrowUpDown`, settings `SlidersHorizontal`). At most two icons per row. Every icon-only control has a tooltip and `aria-label`.
- `EntityTile` renders neutral by default: `--os-surface-hov` tile, `--os-ink-2` glyph; sizes xs 16 / sm 20 / md 24 / lg 36, radius 4/5/6/8.

### 5.15 Loading and the four dots

- **Route transitions**: a 3px `--os-brand` progress line at the top of the content area (under the top bar), plus content skeletons: bars in `--os-surface-hov` radius 4, row-height matched, no shimmer in dark mode (pulse only). No spinner inside content.
- **First open per day** (and after login): the mission splash is the navy chrome colour (`--os-chrome-bg` in the navy variant; `#1B2537` regardless of variant so the brand moment is constant), full screen, the four dots at 12px each animating a 600ms sequential rise (Y B R G, 80ms stagger), the mission line 16/400 white 72% under them, 1.2s total then a 160ms fade. Because the navy is the chrome, the fade reveals the shell as if the frame simply opened; this is what makes the splash feel seamless rather than an overlay.
- **In-page `ValueLoader`** becomes a non-blocking caption: four dots in `--os-line-strong` with `--os-brand` for the B dot only, 8px, plus the rotating value 13/400 `--os-ink-2` beneath a skeleton; never an overlay, never blocks input. Route navigation never shows the splash (Q3 default).
- **Buttons** show an inline 16px four-dot mini-loader replacing the icon while pending; label stays.

### 5.16 Comments (reserved slot)

One `CommentThread` component: 36px avatar row, 15/400 body, 12px meta, hover reveals React / Reply / Resolve / "…" (assign) as ghost icon buttons; replies indent 40px; resolved threads collapse to one 36px line. Designed so reactions, replies, resolve and assign are added without a second implementation.

### 5.17 Call dock (reserved slot)

A 320x64 region bottom-right, above the toast stack, for Talk's CallDock: `--os-surface`, border, radius 12, `--os-shadow-pop`. Nothing renders there until a call exists.

---

## 6. Motion

- Durations: `--os-dur-fast` 120ms (hover, focus, chip toggle), `--os-dur-base` 160ms (menus, popovers, tooltips, text-tab pill), `--os-dur-slow` 220ms (drawer, modal, sidebar collapse, filter panel), nothing above 250ms in the app. Splash fade 160ms.
- Easing: `--os-ease-out: cubic-bezier(0.2, 0, 0, 1)` for entering, `--os-ease-in: cubic-bezier(0.4, 0, 1, 1)` for leaving, linear for the progress line.
- What animates: background and colour on state change; opacity + 4px translate for menus/popovers; opacity + 8px translate for toasts; translate-x for the drawer and the filter panel (the table width change is a 220ms `width` tween so the layout does not jump); height for accordion sections and the sticky save bar; the four dots.
- What never animates: hovered elements (no transform), table rows on load (they appear), sidebar tree rows on expand beyond a 160ms height tween, the chrome (variant switch is instant), numbers (no count-up), page titles, focus rings.
- `prefers-reduced-motion`: all translates become opacity-only, durations halve, the dots do not rise (they fade), the progress line still moves.
- `.animate-fade-in` (300ms) and the 380ms splash fade are deleted.

---

## 7. Differentiation: why this does not read as monday, and what is ownable

**monday's signature** is light chrome, saturated board cells, coloured group bars, Figtree, warm greys and its `#0073EA`. WorkwrK shares only the blue. Every other lever is set to the opposite value:

| Lever | monday | This system |
|---|---|---|
| Chrome | white sidebar, white top bar | navy frame `#1B2537`, white active pill |
| Where colour lives | in every data cell, every group | in one blue button per page and one logo mark in the chrome |
| Group / column headers | coloured text + left rule, solid status pills | plain 15/500 text on `--os-surface-1` |
| Status | solid cells everywhere | pale chips; solid only in the status column |
| Neutrals | warm `#323338 / #676879` | cool slate `#1F2430 / #667085`, same hue as the navy |
| Type | Figtree / Roboto | Inter, 15px rows, 500 emphasis |
| Rows | 36px flat cells edge to edge | 44px rows inside a bordered card with a footer |
| Tabs | underline + coloured view icons | grey text-tab pills |
| Empty states | logo-only loading, wizard | grey four-dot line illustration + one sentence |
| Detail | drawer over the table | drawer over the table, same URL; page for docs |

**Ownable**: (1) the four dots in full colour on navy: the only saturated object in the chrome, so it becomes the thing you remember, and the first-open splash IS the chrome (the frame opens onto the work); (2) the navy-frame-white-page silhouette itself, readable in a thumbnail; (3) the strict "one blue thing per page" that makes the Create button findable without training; (4) the calm 15px bordered-card table with totals and pagination in the card, which reads as "records" rather than "spreadsheet" and matches the SMB mental model.

It also does not read as Zoho: no reds/corals/purples, no three navigation layers, no bottom dock, Lucide instead of Zoho's icon family, a labelled rail, and a 264px sidebar instead of 325.

---

## 8. Migration onto the existing `--os-*` tokens

### 8.1 Token map (keep name → new value, or rename, or delete)

| Existing | Action | New |
|---|---|---|
| `--os-brand` `#0073EA` | keep | `#0073EA` |
| `--os-brand-hover` `#0060B9` | re-point | `#0062CC` |
| `--os-brand-soft` `#E6F1FB` | re-point | `#EAF3FE` |
| `--os-brand-deep` `#1F76C2` | re-point | `#0B5FC2` (light) / `#4D9CFF` (dark) |
| `--os-brand-dark` `#292F4C` | alias → `--os-chrome-bg` | `#1B2537` (splash, rail) |
| `--os-brand-rail` `#1A2C4A` | alias → `--os-chrome-bg` | `#1B2537` |
| `--os-brand-ink` | keep as alias of `--os-brand-deep` | |
| new `--os-brand-pressed` | add | `#0A4C9B` |
| `--os-c-green/orange/red/yellow/blue/teal/brown/sage/gray/darkgray` | **delete** after the sweep; interim alias to semantic (`green→success-solid`, `red→danger-solid`, `orange/yellow→warning-solid`, `blue→brand`, rest→ink-2) | replaced by `--os-success/warning/danger-*` and `--os-status-user-1..8` |
| `--os-c-purple/pink/indigo/lime` | delete | |
| `--os-canvas` `#FFF` | keep | `#FFFFFF` / `#101215` |
| `--os-surface` `#FFF` | keep | `#FFFFFF` / `#181B20` |
| `--os-surface-1` `#F6F7FB` | re-point | `#F6F7F9` / `#15181D` |
| `--os-surface-2` `#ECEEF5` | re-point | `#E4E7EC` / `#262A31` (now = bg.active) |
| `--os-surface-3` `#E6E9EF` | delete (alias to surface-2 during migration) | |
| `--os-surface-hov` `#F0F3FA` | re-point | `#EEF0F3` / `#1F232A` |
| `--os-row-hov` `#F8F9FD` | alias → `--os-surface-hov` | |
| `--os-line` `#E6E9EF` | re-point | `#E4E7EC` / `#262A31` |
| `--os-line-soft` `#F0F2F7` | re-point | `#EEF0F3` / `#1F232A` |
| `--os-line-strong` `#D0D4DC` | re-point | `#D0D5DD` / `#30353D` |
| `--os-ink` `#323338` | re-point | `#1F2430` / `#E6E8EC` |
| `--os-ink-2` `#676879` | re-point | `#667085` / `#9AA3B2` |
| `--os-ink-3` `#9699A6` | re-point | `#98A2B3` / `#6B7280` |
| `--os-ink-4` `#C4C7D4` | re-point | `#D0D5DD` / `#3A3F47` |
| new `--os-ink-inv`, `--os-selected`, `--os-selected-hov`, `--os-scrim`, `--os-focus`, `--os-presence`, `--os-attention` | add | per 1.2 |
| new `--os-chrome-*` (10), `--os-side-bg`, `--os-side-pill` | add | per 1.2 chrome table, keyed on `html[data-chrome]` |
| new `--os-success/warning/danger-{bg,text,solid}` | add | per 1.2 |
| new `--os-dot-y/b/r/g` | add | brand hexes |
| new `--os-status-user-1..8` | add | 5.9 |
| `--os-r-xs/sm/md/lg/pill` | keep | 4/6/8/12/999 |
| `--os-r-xl` | delete | |
| `--os-shadow-pop` | re-point | `0 8px 24px rgba(16,18,21,.12)` |
| new `--os-shadow-modal` | add | `0 8px 32px rgba(16,18,21,.16)` |
| `--os-shadow-card`, `--os-shadow-rest` | delete (cards are bordered) | |
| `--os-rail-w` 60 | re-point | 64 |
| `--os-side-w` 260 | re-point | 264 |
| `--os-top-h` 32 | re-point | 48 |
| `--os-title-h` 40 | rename → `--os-head-h` | 56 |
| `--os-tabs-h` 34 | re-point | 36 |
| `--os-filter-h` 34 | rename → `--os-toolbar-h` | 48 |
| `--os-page-pad` 12 | re-point | 24 |
| `--os-card-pad` 12 | re-point | 16 |
| `--os-row-h` 28 | re-point | 44 (dense pref → 36) |
| `--os-row-h-lg` 32 | rename → `--os-nav-row-h` | 36 |
| `--os-control-h` 26 / `-sm` 22 | re-point | 36 / 32 |
| `--os-popover-w` 300 | re-point | 280 |
| `--os-font` Figtree | re-point | Inter stack |
| new `--os-t-*` (9), `--os-s-1..8`, `--os-dur-*`, `--os-ease-*` | add | sections 2, 3, 6 |
| `:root[data-accent=…]` (11 blocks) | delete; `data-accent` attribute writer removed from CustomizePanel; normalise stored prefs to blue | replaced by `html[data-chrome="navy|light"]` |
| `:root.dark .workwrk-os .text-zinc-* { … !important }` (147 rules) | delete once the sweep below lands | dark = token rebinding only |
| shadcn `--surface/--muted/--border` in `globals.css`, "bento" lime palette, marketing brand tokens inside the app | delete from the app; marketing keeps its own file | |

### 8.2 Order of work

1. **Tokens + chrome attribute + dark rebinding** in `os.css` (one PR, no visual change to untokenised files beyond the re-pointed greys). Add the `data-chrome` writer to Preferences. Load Inter, drop the five families.
2. **Type scale**: replace the 14 arbitrary sizes with the `--os-t-*` utilities. Codemod map: 10→rail, 11/11.5→micro or meta by context, 12/12.5→meta, 13→helper, 13.5/14/14.5→body (row when inside TableCard, sidebar, view tabs, filter panel), 15→row, 16/17→title, 20/26→page. Half-pixel sizes go to zero.
3. **Shell**: rail 64 navy with labels, sidebar 264 grey with the N200 pill, top bar 48 navy with breadcrumb + search + icon cluster; the quick-tools row folds into "+"; the three floating topbar cards go.
4. **Primitives**: Button, Chip/StatusChip, MenuItem, ViewTab (to text-tab pill), EntityTile (neutral default), Dialog, Picker (new, absorbs the 9 `useAnchorPos` consumers over time), toast, `OsEmptyView`, `OsTitleBar` (becomes the three-row header), new `FilterPanel`, new `TableCard`.
5. **Colour sweep**: every `--os-c-*`, raw `#E2445C`/`#00C875`/`#FDAB3D`, `zinc-*` and `violet/purple/indigo/pink` class → semantic tokens; then delete the 147 dark `!important` rules and the `--os-c-*` aliases. Verify with the contrast script in both modes.
6. **Protected parity screens** (List/Board/Calendar/Gantt/task detail): header stack + tokens + bordered card, internals untouched.
7. **Loaders**: splash to first-open-per-day on navy; `ValueLoader` to non-blocking caption; delete `.animate-fade-in`.
8. Marketing last.

### 8.3 Risks

1. **Navy chrome and the "Monday-clean" memory note** (2026-06-02: light, flat, whitespace). The founder's Zoho endorsement is newer and the canvas stays Monday-clean, but the memory note should be updated explicitly so a future pass does not "fix" the navy back to white. The light flip exists precisely as the escape hatch.
2. **Blue on navy is impossible**, so any existing component that renders `--os-brand` inside the rail or top bar (e.g. `.os-side__item.is-active` at `--os-brand-soft/--os-brand`, badges on `--os-brand-dark`) will silently fail contrast until it reads the chrome tokens. Grep `--os-brand` inside `.os-rail*`, `.os-top*`, `> header` and fix in step 3.
3. **Deleting the 11 accents** removes a shipped user preference and the demo account's purple theme; stored `data-accent` values must be normalised server-side, and the "Customize Sidebar" panel loses its Themes section (replaced by Chrome: navy/light). This is a founder call (Q4) and the spec assumes the default.
4. **Row height 44 doubles the vertical cost of dense boards** compared with today's 28. Dense (36) must ship in the same release with the per-user preference already wired to `OrgPreference`, and the Tables module keeps its own row height.
5. **15px row text on 14px body** is a second reading size; the codemod in 8.2 step 2 must map deliberately (rows vs body) or the product ends up with 14 and 15 mixed inside one table. Rule: anything inside `TableCard`, sidebar rows, view tabs and the filter panel is 15; everything else is 14.
6. **The three-row header is 140px** before content. It matches today's budget only because the top bar absorbed the location row; if the parity mandate (Q1) keeps ClickUp's location bar, the stack becomes four rows and the pattern breaks. Do not ship the header before Q1 is answered.
7. **`--os-c-*` deletion touches user data**: List status colours stored as monday hexes must be remapped to the 8 muted hues; run the remap as a migration with a dry-run report, never silently.
8. **Dark mode of the navy variant** has never been seen by the founder; `#0C0F14` chrome over `#101215` canvas is a subtle step (the frame is felt, not seen). If it reads as "no frame", the fallback is chrome `#0A0D12` and the sidebar `#13161B`.
9. **`ViewTab` underline retirement** contradicts a Mobbin-verified parity surface; it is covered by "restyle with tokens", but flag it in the Q1 answer.
10. **Inter licence/perf**: self-host through `next/font/google` (it subsets and self-hosts); do not add a Google Fonts `<link>` in the app (CSP and LCP).
11. **RTL**: the navy pill, breadcrumb chevrons and the filter panel side must use logical properties from day one; the current shell uses physical `left/right` in places (`.os-side__*` border-left), which the shell PR must convert.
