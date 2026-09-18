# WorkwrK design system proposal: "Warm clarity"

Date: 2026-09-10. Designer stance: Notion/Asana-class friendliness. One of three independent proposals against `phase2-inputs.md`, `design-references.md` and `existing-direction.md`. Everything in section 1 of the inputs brief (YBRG brand, blue `#0073EA` as the single primary, no purple, 8-hub rail, access-derived rail, Customize Sidebar footer, 14px base, BackButton, no hover transforms, honesty rules, Tables "Google Sheets" bar, data-integrity rule, no em dashes) is honoured without exception. Where this proposal departs from the brief's recommended direction (sections 2 to 5 of the inputs), it says so and why.

## 0. The one-line idea

**Monday's blue on a warm, paper-like ground.** The chrome is a soft warm grey (a sheet of good paper, not a steel panel), the content is white, the type is a humanist grotesk with round counters, rows breathe at 36px everywhere, corners are gently rounded, status lives in pale chips, and the four dots are drawn in that same warm grey until they need to mean something. The blue is the only cool thing on screen, so it reads as punctuation exactly the way the brief asks, and the warm ground is what stops the screenshot from photographing as monday.

Why warm and not the cool slate the brief recommends: the brief's own teardown notes that Linear's 2026 refresh moved warmer "to feel calmer", that Notion's chrome is `#F7F7F5` warm, and that Asana's whole design language is "confidence through clarity" on warm white. Cool slate plus `#0073EA` reads as "software". Warm paper plus `#0073EA` reads as "a place to work". For a product whose tie-breaker is "any business adopts it with no training", the second feeling wins. Chroma stays tiny (OKLCH C 0.004 to 0.014, hue 75) so the greys never turn beige or yellow, and there is no purple anywhere.

---

## 1. Colour

### 1.1 Architecture (three layers, OKLCH-generated)

1. **Primitives** (`--wk-n-*`, `--wk-blue-*`, plus non-exported `green/amber/red` scales). Only `os.css` references these.
2. **Semantic aliases** (the `--os-*` names components use). Every component colour comes from this layer. Dark mode re-binds this layer only.
3. **Component tokens** (five, no more): `--os-rail-active-bg`, `--os-chip-status-bg`, `--os-chip-status-fg`, `--os-toast-bg`, `--os-scrim`.

The yellow, red and green primitive scales are **not exported**: no `--os-c-yellow`, no `--os-c-red`, no `--os-c-green` reach components. Components can only reach `--os-success-*`, `--os-warning-*`, `--os-danger-*`. The brand dots (`#FFCB00 #0073EA #FF3D57 #00C875`) exist as four `--wk-dot-*` tokens that only `components/brand/*` may import (lint rule: `no-restricted-syntax` on `--wk-dot-` outside `src/components/brand/`).

### 1.2 Neutral primitives (warm, OKLCH hue 75, chroma 0.004 to 0.014)

Generated with the script in `warm-contrast.mjs` (same folder), contrast computed with the WCAG 2.x relative-luminance formula.

| Step | Light hex | OKLCH (L / C / h) | Role | Verified contrast |
|---|---|---|---|---|
| N0 | `#FFFFFF` | 1 / 0 / 0 | content ground, cards, table body, modal, popover | |
| N50 | `#F8F6F4` | .975 / .004 / 75 | secondary sidebar, table header, settings page ground, kanban column | |
| N100 | `#F0EEEB` | .95 / .005 / 75 | row and menu hover, active sidebar row, skeleton bars, "none" chip bg | |
| N200 | `#E5E2DF` | .915 / .006 / 75 | structural borders, row separators, card outline | |
| N300 | `#D1CDC8` | .85 / .008 / 75 | input borders, strong dividers, empty-state dot illustration | |
| N400 | `#97918A` | .66 / .012 / 75 | placeholder, disabled icons, low-priority glyph (decorative only) | 3.12:1 on white |
| N500 | `#68625B` | .50 / .014 / 75 | secondary text, icons at rest, counts, timestamps | 6.02 on N0, 5.59 on N50, 5.20 on N100 |
| N600 | `#4C473F` | .40 / .014 / 75 | rail inactive icon and label, tertiary button text, metadata columns | 9.21 on N0, 8.54 on N50 |
| N700 | `#39352F` | .33 / .012 / 75 | form labels, headings on tinted grounds, "high" priority glyph | 12.18 on N0 |
| N800 | `#221F1A` | .24 / .010 / 75 | primary text, page titles, row titles | 16.42 on N0, 15.23 on N50 |
| N900 | `#110F0C` | .17 / .008 / 75 | scrim base, marketing display type only | |

Rules: body text is N800, never `#000`. No text on N200 or N300. N400 is decoration only (it clears 3:1 so it may be a border or a glyph that has a label beside it, never the only signal). Secondary text is N500, which passes AA on all three light grounds (white, N50, N100), so one secondary-text token serves every surface.

### 1.3 Blue primitives (the only accent; values verified in the references brief, reused unchanged)

| Step | Hex | Use |
|---|---|---|
| blue-50 | `#EAF3FE` | selected row, active rail pill, info chip bg, link hover wash |
| blue-100 | `#D4E7FD` | selected + hover, active rail pill hover |
| blue-200 | `#A9CFFB` | focus ring (2px solid, 2px offset), progress track tint |
| blue-600 | `#0073EA` | one solid button per surface, checkbox on, switch on, progress fill, active tab underline |
| blue-hover | `#0062CC` | solid button hover (5.80:1 with white) |
| blue-700 | `#0B5FC2` | link text, accent text, active rail icon and label (6.12 on N0, 5.68 on N50, 5.47 on blue-50) |
| blue-800 | `#0A4C9B` | pressed |

Where blue may appear: the one primary button per surface, links, focus rings, checked controls, active rail pill, the active view-tab underline, progress. Where it never appears: headers, group bars, icons at rest, sidebar active rows (those are N100), illustrations, empty-state art, the loader dots at rest.

### 1.4 Semantic trio (verified in the references brief, reused unchanged)

| Meaning | bg | text | solid | Text-on-solid | Verified |
|---|---|---|---|---|---|
| success (done, on track, saved) | `#ECFDF3` | `#15803D` | `#15803D` | white | 4.76 text/bg, 5.02 white/solid |
| warning (at risk, due soon, in progress, needs ack) | `#FFFAEB` | `#854D0E` | `#FACC15` | N800 `#221F1A` only | 6.57 text/bg, 10.72 N800/solid |
| danger (overdue, blocked, destructive) | `#FEF3F2` | `#B42318` | `#D92D20` | white | 6.05 text/bg, 4.83 white/solid |
| info (neutral status, "new") | blue-50 | blue-700 | blue-600 | white | 5.47 |
| none (not started, unassigned) | N100 | N600 | N300 | N800 | 8.5+ |

Warm-clarity specifics:
- **Pale is the default everywhere, including Board list and Tables status columns.** The brief allows solid columns on one dense surface; this proposal declines that exception. A pale chip with a 590-weight word and a 6px status dot in the solid colour scans just as fast in a column, and it is the single most visible "not monday" decision (monday's identity is the solid green/yellow/red cell). Per-List user-defined status colours remain data: they render as the same pale chip (colour at 12% alpha over white for the bg, the colour's 700-step for text, the raw colour for the 6px dot).
- The user status-colour picker offers eight muted hues that all pass the pale-chip rule (text step listed; the pale bg is that hue at 12% alpha over white, the dot is the hue's 500-step): sky `#0B5FC2`, teal `#0F766E`, moss `#3F6212`, sand `#854D0E`, clay `#9A3412`, rose `#9F1239`, slate `#475569`, stone `#57534E`. No plum or violet (purple ban). The three semantic hues (`#15803D`, `#FACC15`/`#854D0E`, `#B42318`) are not in the picker so a user colour can never be mistaken for done/at-risk/blocked.
- Priority: urgent = danger glyph `#B42318`, high = N700 filled glyph, normal = N500 outline glyph, low = N400 outline glyph. Never ClickUp's red/yellow/blue flags.
- Colour never travels alone: every chip has a word, every glyph has a label or tooltip.

### 1.5 Dark mode (warm dark, elevation by lightness)

Strategy: one re-binding of the semantic layer under `:root.dark` (existing hook) and `@media (prefers-color-scheme: dark)` when `data-theme` is unset. Zero component literals. The 147 `!important` utility repaints in `os.css` are deleted file by file as each component moves to tokens (see section 8). A "high contrast" preference raises `--os-contrast-boost` (0 to 1) which nudges text steps one notch lighter; it is not a third theme.

| Role | Dark hex | Verified |
|---|---|---|
| bg.app | `#141210` | base (lifted from the generated `#110F0D` so it is not near-black) |
| bg.subtle (sidebar, table header) | `#1A1815` | |
| bg.raised (cards, popovers, modals, drawer) | `#23211E` | |
| bg.hover | `#2A2724` | |
| bg.selected | `rgba(0,115,234,.14)` over raised | |
| border.subtle | `#302D2B` | faint on purpose |
| border.default | `#3F3D3A` | |
| text.primary | `#EDEBE7` | 16.06 on base, 14.88 on subtle |
| text.secondary | `#A8A49E` | 7.71 on base, 7.14 on subtle, 6.48 on raised |
| text.placeholder | `#75716B` | 3.94 on base (decorative) |
| accent.solid | `#0073EA` | 4.53 with white (unchanged) |
| accent.text / link / active rail | `#4D9CFF` | 6.84 on base, 6.34 on subtle; never blue-700 on dark |
| focus.ring | `#4D9CFF` at 2px | |
| success bg / text | `#0F2A1A` / `#4ADE80` | 8.82 |
| warning bg / text | `#2A2208` / `#FCD34D` | 10.94 |
| danger bg / text | `#2C1212` / `#F87171` | 6.31 |
| scrim | `rgba(17,15,12,.55)` | |

Elevation on dark is a lighter surface, never a shadow; popovers keep a 1px `border.default` outline so they separate from the raised ground.

### 1.6 The token table (semantic layer, what `os.css` ships)

Names are the existing `--os-*` names wherever one exists (163 files already reference them), new names only for roles the current set lacks. Old name in brackets where the name changes meaning.

| Token | Light | Dark | Old value / note |
|---|---|---|---|
| `--os-canvas` | `#FFFFFF` | `#141210` | was `#FFFFFF` |
| `--os-surface` | `#FFFFFF` | `#23211E` | raised: cards, popovers, modals |
| `--os-surface-1` | `#F8F6F4` | `#1A1815` | sidebar, table header (was `#F6F7FB`) |
| `--os-surface-2` | `#F0EEEB` | `#2A2724` | hover, active row (was `#ECEEF5`) |
| `--os-surface-3` | `#E5E2DF` | `#302D2B` | pressed, skeleton (was `#E6E9EF`) |
| `--os-surface-hov` | alias of `--os-surface-2` | | collapse: one hover colour |
| `--os-row-hov` | alias of `--os-surface-2` | | collapse |
| `--os-surface-sel` **new** | `#EAF3FE` | `rgba(0,115,234,.14)` | selected row |
| `--os-surface-sel-hov` **new** | `#D4E7FD` | `rgba(0,115,234,.20)` | |
| `--os-line` | `#E5E2DF` | `#302D2B` | structural (was `#E6E9EF`) |
| `--os-line-soft` | `#F0EEEB` | `#2A2724` | row separators inside tables |
| `--os-line-strong` | `#D1CDC8` | `#3F3D3A` | inputs (was `#D0D4DC`) |
| `--os-ink` | `#221F1A` | `#EDEBE7` | primary text (was `#323338`) |
| `--os-ink-2` | `#68625B` | `#A8A49E` | secondary (was `#676879`) |
| `--os-ink-3` | `#97918A` | `#75716B` | placeholder (was `#9699A6`) |
| `--os-ink-4` | `#D1CDC8` | `#3F3D3A` | disabled glyph (was `#C4C7D4`) |
| `--os-ink-strong` **new** | `#4C473F` | `#C9C5BF` | rail labels, metadata columns |
| `--os-ink-label` **new** | `#39352F` | `#DAD7D2` | form labels |
| `--os-brand` | `#0073EA` | `#0073EA` | unchanged |
| `--os-brand-hover` | `#0062CC` | `#0062CC` | was `#0060B9`; one value app + marketing |
| `--os-brand-press` **new** | `#0A4C9B` | `#0A4C9B` | |
| `--os-brand-soft` | `#EAF3FE` | `rgba(0,115,234,.14)` | was `#E6F1FB` |
| `--os-brand-soft-2` **new** | `#D4E7FD` | `rgba(0,115,234,.20)` | |
| `--os-brand-ink` | `#0B5FC2` | `#4D9CFF` | accent as text (was `var(--os-brand-rail)` navy) |
| `--os-brand-ring` **new** | `#0073EA` | `#4D9CFF` | focus ring |
| `--os-brand-deep` | alias of `--os-brand-ink` | | retire the separate `#1F76C2` |
| `--os-brand-dark`, `--os-brand-rail` | **deleted** | | navy chrome tones; no dark chrome in this system |
| `--os-success-bg / -fg / -solid` **new** | `#ECFDF3` / `#15803D` / `#15803D` | `#0F2A1A` / `#4ADE80` / `#22A45D` | |
| `--os-warning-bg / -fg / -solid` **new** | `#FFFAEB` / `#854D0E` / `#FACC15` | `#2A2208` / `#FCD34D` / `#FACC15` | solid always carries N800 text |
| `--os-danger-bg / -fg / -solid` **new** | `#FEF3F2` / `#B42318` / `#D92D20` | `#2C1212` / `#F87171` / `#E5484D` | |
| `--os-info-bg / -fg` **new** | alias brand-soft / brand-ink | | |
| `--os-none-bg / -fg` **new** | `#F0EEEB` / `#4C473F` | `#2A2724` / `#C9C5BF` | not started |
| `--os-c-green … --os-c-darkgray` | **deleted** (14 tokens) | | replaced by the semantic trio + the 8-hue status picker table in code, not CSS |
| `--os-r-xs / sm / md / lg / xl / pill` | 4 / 6 / 8 / 10 / 14 / 999 | same | lg was 12, xl was 16 |
| `--os-shadow-card` | `none` (borders only) | `none` | retired as a shadow; keep the name resolving to none for one release |
| `--os-shadow-pop` | `0 8px 24px rgba(17,15,12,.10), 0 0 0 1px rgba(17,15,12,.05)` | `0 8px 24px rgba(0,0,0,.45)` | popovers, drag ghost |
| `--os-shadow-modal` **new** | `0 12px 40px rgba(17,15,12,.14)` | `0 12px 40px rgba(0,0,0,.6)` | |
| `--os-shadow-rest` | **deleted** | | |
| `--os-rail-w` | `64px` | | was 60 |
| `--os-side-w` | `248px` | | was 260 |
| `--os-top-h` | `48px` | | was 32 |
| `--os-head-h` **new** | `52px` | | content header (title + tabs + actions) |
| `--os-tool-h` **new** | `40px` | | toolbar row |
| `--os-title-h`, `--os-tabs-h`, `--os-filter-h` | **deleted** | | the three stacked bands are gone |
| `--os-page-pad` | `24px` | | was 12 |
| `--os-card-pad` | `16px` | | was 12 |
| `--os-row-h` | `36px` | | was 28; **the one rhythm** |
| `--os-row-h-sm` **new** | `32px` | | compact data rows only (user preference) |
| `--os-row-h-lg` | `44px` | | was 32; touch/comfortable data rows |
| `--os-control-h` | `32px` | | was 26; buttons, inputs in toolbars |
| `--os-control-h-lg` **new** | `36px` | | form inputs, primary buttons |
| `--os-control-h-sm` | `28px` | | was 22; chips-as-buttons, inline row controls |
| `--os-popover-w` | `280px` | | was 300 |
| `--os-drawer-w` **new** | `560px` | | |
| `--os-font` | `var(--font-instrument-sans), "Instrument Sans", "Segoe UI", system-ui, -apple-system, sans-serif` | | was Figtree |
| `--os-font-mono` **new** | `var(--font-jetbrains-mono), "JetBrains Mono", ui-monospace, monospace` | | |
| `--os-rail-active-bg` (component) | `#EAF3FE` | `rgba(0,115,234,.16)` | |
| `--os-chip-status-bg / -fg` (component) | computed per status from the pale rule | | |
| `--os-toast-bg` (component) | `#FFFFFF` | `#23211E` | |
| `--os-scrim` (component) | `rgba(17,15,12,.40)` | `rgba(17,15,12,.55)` | |
| `--wk-dot-yellow / -blue / -red / -green` (brand only) | `#FFCB00 #0073EA #FF3D57 #00C875` | same | importable only under `components/brand/` |

Retired in the same move: the 11 `:root[data-accent=…]` overrides (all of them, including grape/violet/pink/indigo), `globals.css` shadcn tokens (`--surface`, `--muted`, `--color-*`), the bento lime palette, `--brand-red` as a CTA colour, `ui/accent.ts` taupe, `--status-special` purple, `.btn-taupe`.

---

## 2. Type

### 2.1 Family

**Instrument Sans** (Google Fonts, variable 400 to 700, `next/font/google` as `Instrument_Sans`), one axis, `font-feature-settings: "tnum" 1, "cv01" 1` on numeric columns. Fallback: `"Segoe UI", system-ui, -apple-system, sans-serif`. Mono: keep **JetBrains Mono** (already loaded) for formulas, code, IDs.

Why this face: it is a humanist grotesk (open apertures, a two-storey "a" and "g", slightly rounded terminals) rather than the neo-grotesque machined feel of Inter or the geometric friendliness of Figtree (monday) and Outfit (current marketing). It reads warm at 14px on a warm ground, it is unmistakably not monday, and the studio's serif (Instrument Serif) is already in the repo, which gives marketing an optional display pairing without adding a family. Load exactly two families and delete Outfit, Syne, Geist, Geist Mono, Instrument Serif (unless marketing keeps it as a display face), Figtree.

If the founder keeps Figtree (Q5): the scale below is family-independent, but the differentiation argument weakens and section 7 loses one of its five levers.

### 2.2 Scale (seven sizes, half-pixels banned, floor 10)

| Role | Size / weight / line-height | Colour | Notes |
|---|---|---|---|
| Page title | 20 / 600 / 1.25 | N800 | in the content header, one per page |
| Section and modal title | 16 / 600 / 1.25 | N800 | settings cards, modal headers, empty-state title |
| Row title (emphasised) | 14 / 600 / 1.4 | N800 | first column of a list, kanban card title, drawer title at 16 |
| Body and row text | 14 / 400 / 1.4 | N800 | everything else in rows and forms |
| Secondary and helper | 13 / 400 / 1.4 | N500 | descriptions under titles, helper text, timestamps |
| Group label, chip, metadata, form label | 12 / 600 / 1.3 | N500 (labels N700) | sidebar group labels, table header, chip text, column header |
| Micro | 11 / 500 / 1.2 | N500 | count badges, kbd hints |
| Rail label | 10 / 600 / 1.2 | N600 / blue-700 active | rail only, 0.01em tracking so it does not clog |

Letter-spacing 0 (drop the current -0.005em; Instrument Sans is already tight). Weights used: 400, 500 (micro and secondary buttons), 600 (all emphasis). No 700 in product; marketing display may use 700.

### 2.3 Hierarchy rule

**Weight and grey before size.** A title is 600 weight in N800; the thing beneath it is 400 in N500. Size steps up only for the page title (20) and section titles (16). If two adjacent texts need to differ, change weight or ink first, size last. A screen never shows more than three sizes at once.

---

## 3. Rhythm

- **Grid**: 4px. Spacing scale `4 / 8 / 12 / 16 / 24 / 32 / 48 / 64`. Content padding 24. Card padding 16. Modal padding 24. Drawer padding 24. Section gap inside forms 24, field gap 16.
- **Row heights, one rhythm**: **36px** for sidebar rows, menu rows, picker rows, table and list rows at default density, toolbar chips, form inputs. 32px is the compact data-row preference (per user, applies to tables and lists only, never to navigation). 44px is the comfortable/touch data-row preference. The rail item is 56px. Nothing else. This is the deliberate departure from the brief's 32-nav / 36-data split: on a warm ground, 32px navigation rows next to 36px data rows read as two densities; one number reads as calm.
- **Radii**: 4 (checkbox, tiny tags), 6 (chips), 8 (inputs, buttons, sidebar rows, rail pill), 10 (cards, menus, popovers, kanban cards, toasts), 14 (modals, drawer top corners when floating), full (avatars, pills, switch). Softer than the brief's 6/8/12 by one step; never `rounded-2xl` / `3xl` in the app.
- **Elevation**: borders over shadows. Structural border N200, input border N300. Shadows exactly three: popover `0 8px 24px rgba(17,15,12,.10)` plus a 1px hairline ring, modal `0 12px 40px rgba(17,15,12,.14)`, drag ghost = popover. Cards, tiles, kanban cards, toolbars carry no shadow at rest. Dark mode uses lighter surfaces plus a 1px border for the same three cases.
- **Focus**: one ring, `outline: 2px solid var(--os-brand-ring); outline-offset: 2px`, `:focus-visible` only. The `button.tsx` `ring-[#0073EA]/40` is replaced by this.
- **Density preference** (Settings → You → Preferences): Default (36), Compact (32), Comfortable (44), affecting data rows only. Admin lock stays.

---

## 4. Shell

### 4.1 Rail (64px, N50 ground, labelled)

- Width 64. Ground N50 with a 1px N200 right border. No dark or navy rail; the rail is the same paper as the sidebar so the two read as one panel with the content sitting on white beside them.
- Item: 20px Lucide outline icon (1.5px stroke) above a 10/600 label, 56px tall × 56px wide hit area, 8px gap between items, 8px top padding. Labels max 9 characters; current labels (Work, Planner, AI, Talk, Teams, Docs, Tables, Settings) pass.
- Inactive: icon and label N600. Hover: N100 pill (radius 8), no colour change. Active: `--os-rail-active-bg` blue-50 pill, radius 8, icon and label blue-700 (dark: `rgba(0,115,234,.16)` and `#4D9CFF`). No left bar, no dot, no underline.
- Order is the admin's (access-derived). No personal pinning. The rail never scrolls.
- Bottom cluster: Settings hub (stays a hub, sits last), then the user avatar 28px (menu: Profile, Preferences, Theme light/dark/system, Log out). No workspace avatar at the top, no Upgrade, no Invite badge, no "More" launcher tile (the ⊞ launcher moves into the search palette as "Apps").
- The logo sits at the top as the four dots at 6px each, N300 at rest; they take their brand colours only while a route transition is in flight (section 5.9). This is the one brand-dot placement in the chrome.
- RTL: the rail mirrors to the right edge; the active pill and labels do not change.

### 4.2 Secondary sidebar (248px, N50)

- Width 248, N50, 1px N200 right border. Collapsible to rail-only, remembered per user. Header row 48px (aligned with the top bar): workspace name 14/600 with a chevron (workspace switcher menu), and a small collapse control on the right.
- Rows 36px, radius 8 with 8px horizontal inset from the sidebar edge, 14/400 N800 text, one 16px N500 icon or `EntityTile size="sm"` (neutral tile: N100 fill, N600 glyph, no hue by default), counts right-aligned 12/500 N500. Hover N100. Active: N100 fill, 600 weight, N800 text, icon N800. Not blue. Selected-and-hover: N200.
- Group labels 12/600 N500, 24px top margin, 8px bottom, with a caret that appears on hover; groups collapse and remember.
- **Work hub order**: Home, My work, Inbox (personal rows, always first), then Favorites, then Spaces (the access-derived tree; folder rows indent 12px, list rows 24px, no guide lines). Other hubs open on their own tree with the folded apps as labelled sections (Docs: Library, Clips, SOPs, Policies, Contracts).
- Tree row hover cluster: star and "…" appear at the right on hover, 28px controls, N500. That is the whole cluster (no "+" on hover; "+" lives in the group header).
- Nothing promotional. The only footer is **Customize Sidebar** (36px row, N500 icon + label), opening the CustomizePanel with: theme (light/dark/system), density (default/compact/comfortable), section order, hidden sections. The 11-accent picker and icons-only rail options are removed from that panel.
- Sidebar rows use `EntityTile size="sm"`; user-chosen tile colours, if they survive Q6, draw from the 8 muted hues in 1.4 at 12% alpha fill with the hue's 700-step glyph, opt-in per object, never by default.

### 4.3 Top bar (48px, white)

- Single row, 48px, white, 1px N200 bottom border. Nothing floats; the three zinc cards are gone.
- Left (from 16px): back and forward arrows (28px icon buttons, N500, disabled N300), then the **hierarchy breadcrumb**: Hub › Space › Folder › List › Item, 14/400 N500 crumbs with 14/600 N800 last crumb (plain text, not a link), separators as 16px N400 chevrons. Past four levels the middle collapses to a "…" crumb that opens a menu of the hidden levels. The breadcrumb is the location bar; there is no second location row anywhere.
- Centre: real search input, 480px max, 32px tall, N50 fill, 1px N200 border, radius 8, placeholder "Search or jump to…" in N400 with a `⌘K` kbd chip at the right. On focus it becomes white with the brand ring. Opens the command palette (which also hosts "Apps" for the former ⊞ launcher and "Coming soon" rows only when the "Show upcoming features" preference is on).
- Right: one solid blue **"+ Create"** button (32px, 14/600, icon + label; menu items: Task, Doc, Reminder, Note, Voice note, List, Space, Form, Table when the module is on), the Reminders bell (28px, N500, blue-600 6px dot when unread), Help (28px, "?" glyph), avatar 28px. No row of quick-tool icons; ⌘T still opens quick task.
- RTL mirrors left and right clusters; the breadcrumb chevrons flip.

### 4.4 Content header + toolbar (52px + 40px)

Replaces the title 40 + tabs 34 + filter 34 stack.
- **Header row, 52px**, white, padding 0 24px: optional `EntityTile size="lg"` (36px neutral tile) + page title 20/600, then a 13/400 N500 description inline when short (long descriptions go behind an "i" tooltip), then `ViewTabs` inline after a 24px gap, then page actions right-aligned: at most one "Ask AI" ghost action (the reserved AI slot, 4.6), Share (ghost), "…" (ghost). Sits on a 1px N200 bottom border only when a toolbar follows.
- **ViewTab**: 13/600, N500 idle, blue-700 active text with a 2px blue-600 underline flush to the header border, 36px tall hit area, 12px horizontal padding, no icons on tabs (the view name is enough; icons appear only in the "+ View" picker). The zinc-900 underline is retired. Max 6 tabs visible, then "+N" overflow menu, then "+ View".
- **Toolbar row, 40px**, white, padding 0 24px: left cluster Filter, Sort, Group, Display as 32px ghost chips (14/500 N600, 16px icon, N100 on hover, blue-50 with blue-700 text and a count when active: "Filter · 2"). Right: the view's one primary "+ Add task" as a 32px solid blue button, and a search-in-view icon button. Everything else lives inside Display.
- Docs, SOP, goal and review pages use only the header row (no toolbar) and centre a 720px content column below it.

### 4.5 Detail-view policy (decision table)

| Situation | Pattern | Width |
|---|---|---|
| Task, table row, person from a list/board/table | **Drawer** over the list, right side, full height under the top bar, own header (title 16/600, expand, copy link, close), same URL as `/item/[id]` | 560 |
| Doc, SOP, goal, KRA, review page | Full page, breadcrumb + BackButton, content column | 720 (docs 760) |
| From search, notification, deep link | Full page (nothing to sit beside) | |
| Inbox, Talk | Split view, list left 360, detail right | |
| Short create/edit (task, list, member, space) | Centred modal | 560 |
| Rich create (task with description, template) | Centred modal | 720 |
| Editors (statuses, fields, automations) | Centred modal | 960 max |
| Confirm / destructive | Small modal, danger primary only when destructive, typed confirmation for org-level deletes | 400 |
| Person, channel, file info | Right panel, same drawer chrome | 400 |

No stacked modals. A picker inside a modal is a `position:absolute` child (existing rule). Drawer opens with a 200ms ease-out slide from the right and a 200ms fade of the list underneath to 92% (not a scrim); the list remains scrollable. Expand animates the drawer to full page in place (240ms) so the user sees continuity.

### 4.6 Reserved slots (design the slot, not the feature)

- AI: one ghost "Ask AI" action on the content header, right cluster, hidden when the AI hub is disabled. No per-board panel, no AI rows in menus.
- Call dock: a 320 × 72 region bottom-right, 24px from the edges, above the toast stack; toasts shift left of it when it is mounted.
- "Automations…" item in the Space, Folder and List "…" menus, after Sharing.
- Chip variants `band` (performance band: five steps, pale, N-scale, with the top band using success) and `presence` (co-presence: avatar + "is editing", info chip).
- A `Comment` component with reserved anatomy (avatar, name 14/600, time 12 N500, body, reactions row, reply count, resolve check) so reactions and replies grow without a rewrite.
- RTL: rail, sidebar, breadcrumb and drawer mirror via logical properties (`inset-inline-end`, `padding-inline-start`), never `left/right`.
- "Show upcoming features" preference (off by default) that reveals Coming-soon rows.

### 4.7 Settings

Full-screen takeover, warm N50 page ground, white cards. Left list 248px with a filter field on top and "← Back to app" 14/500 above it. Four groups labelled by audience: **You**, **Workspace**, **Governance**, **Billing & plan** (per the inputs brief 4.7). Cards: 16/600 title, 13 N500 one-line description, max 5 fields, 24px padding, N200 border, radius 10. Toggles and selects auto-save with an inline "Saved" tick (success-fg, 13px, fades after 2s). Text forms show a sticky save bar (white, 1px N200 top border, 56px) only when dirty. Danger zone at the bottom in a card with a danger-solid 1px border and typed confirmation. Modules page: one card per module with a one-line description and one switch; new orgs start minimal.

---

## 5. Component standards

### 5.1 Table and list rows
- 36px default (32 compact, 44 comfortable), header 36px N50 with 12/600 N500 labels and tabular figures; no zebra; separators are `--os-line-soft` (N100) in tables, none in lists.
- First column = title, 14/600 N800, the only bold column. Metadata columns 14/400 N600. Numbers right-aligned, `tnum`.
- Hover N100 across the row. Selected blue-50; selected+hover blue-100. Checkbox (16px, radius 4, N300 border, blue-600 when checked) appears on hover or when any row is selected.
- Group header: 36px, 14/600 N800 name + 12/500 N500 count + caret, a pale status chip when grouped by status (not a solid pill, not a coloured bar). Empty groups collapse to one 36px line.
- "+ Add task" ghost row (14/500 N500, plus glyph) last in each group. "+" at the end of the header opens the field-type list with "Show more" after 10.
- Bulk bar: floating bottom-centre, white, N200 border, radius 10, popover shadow, 48px, count + 4 to 6 actions + close. Not the dark bar.
- Tables (the Sheets surface) keep every existing rule: no selection chrome, letter headers, tiny corner add, 1000 rows. They inherit tokens, type and the 36px row only (compact 32 default for Tables since spreadsheets are dense by nature).

### 5.2 Kanban card
- Column 280px, 12px gap, N50 column ground, radius 10, header 36px: 14/600 name + 12/500 N500 count; no solid pill header. Cards white, 1px N200, radius 10, 12px padding, 8px gap between cards, no shadow at rest; while dragging: popover shadow and 2° nothing (no rotation, no scale).
- Card anatomy, in order and maximum: title 14/400 N800 two-line clamp; one row of at most three pale chips (priority glyph + date chip + one label); bottom row: identifier 12/500 N500 left, avatars 20px right. Status never on the card. Everything else behind Display.
- "+ Add task" ghost at the column bottom; "+ Add section" is a dashed N300 ghost column.

### 5.3 Forms
- Labels above, 12/600 N700 (`--os-ink-label`), 6px below the label; inputs 36px, radius 8, white, 1px N300 border, 12px horizontal padding, 14/400 N800, placeholder N400. Hover border N400. Focus: brand ring, border stays N300. Error: 1px danger-solid border + 13px danger-fg helper. Disabled: N50 fill, N200 border, N400 text.
- Helper text 13/400 N500 below, 6px. Full width in modals, max 480px on pages. Grouped in cards of at most five fields. One primary per form, right-aligned in modals, left-aligned under the last field on pages.
- Selects, dates and people are the picker popover, never native selects. Textareas auto-grow from 3 rows.

### 5.4 Modals
Sizes 400 / 560 / 720 / 960. Radius 14, white, `--os-shadow-modal`, scrim `--os-scrim`. Header: title 16/600 + optional 13 N500 description, close icon top-right. Body padding 24. Footer: Cancel (ghost) and one primary, right-aligned, 16px gap above a 1px N200 line only when the body scrolls. Escape and outside click close (except typed confirmations). Enter 180ms: fade + 4px rise; exit 120ms fade.

### 5.5 The one picker popover
- 280px wide (240 for short lists), white, 1px N200, radius 10, popover shadow, 8px padding. Search input at the top (32px, N50 fill, auto-focused, hidden when the list has fewer than 6 items). Rows 36px, radius 8, 16px glyph identical to the glyph used in rows, 14/400 label, optional 11/500 N500 hint or kbd at the right, check at the right for multi-select. Keyboard: arrows, Enter, Esc, type-to-filter. Max height 360 then scroll. Section labels 12/600 N500. Used for status, assignee, date (single month, quick chips Today / Tomorrow / Next week / No date, natural-language input), label, priority, type. People rows: 20px avatar + name + 13 N500 email, "Invite by email" last.

### 5.6 Toasts
Bottom-left, 24px from edges (shifted right of the call dock when mounted). White (`--os-toast-bg`), 1px N200, radius 10, popover shadow, 14/400 N800 text, optional 13 N500 second line, a 16px glyph at the left (success-fg check, danger-fg alert, or N500 info) as the only colour, one text action ("Undo", blue-700, 14/600) and a close icon. 5s, 8s with an action. Max 3 stacked with 8px gap. Never for validation, never green banners, never top-centre.

### 5.7 Empty states (illustration-friendly)
Template, centred in the content area, max 360px wide:
- Illustration 96px: the **four dots drawn as line art in N300**, arranged per context (a row for lists, a 2×2 for boards, a cluster with a connecting line for goals, a stack for docs). Line art only, 1.5px stroke, no fills, no colour, no mascots. Allowed warmth: a faint N50 rounded rectangle (radius 14) behind the dots as a "sheet of paper". This is the one place the system permits illustration, and the dots keep it on-brand without a colour.
- Title 16/600 N800 ("No tasks yet"), copy 14/400 N500 two lines max ("Add your first task, or bring one in from a template."), one primary button (with kbd hint) and one ghost "Learn more". Nothing else on the screen.
- Filtered-empty replaces the illustration with an inline 36px row: "No results · Clear filters" (blue-700 link).
- New-workspace surfaces (Home, a new Doc) use a "Get started with" chip row (ghost chips 32px, radius 8) plus a short checklist card, not the illustration.
- `OsEmptyView` is the primitive; `ui/empty-state.tsx` is deleted.

### 5.8 Chips and status
- `Chip` (toolbar chip): 32px, radius 8, 14/500 N600, 1px N200 border on white, N100 hover, active = blue-50 fill, blue-700 text, no border. Danger variant = danger-bg / danger-fg.
- `StatusChip`: 22px tall, radius 6, 12/600 text, 8px horizontal padding, 6px status dot at the left in the status's solid colour, pale bg + fg from the semantic pair (or the user-colour pale rule). One size everywhere: table cell, kanban chip, drawer, group header. No uppercase (drop the current uppercase 13px label).
- Label chips (tags) use the "none" pair by default (N100 / N600) so labels never compete with status; user-coloured tags follow the pale rule.
- New variants reserved: `band`, `presence` (4.6).

### 5.9 Loading
- Inside content: skeleton bars in N100 on white, radius 6, matching the 36px row rhythm, 1.2s shimmer at 8% lighter; no spinners in content.
- Route transitions: the four rail dots (4.1) animate from N300 to their brand colours in sequence (yellow, blue, red, green, 600ms loop) while the route resolves; a non-blocking 13/400 N500 caption with the rotating company value appears under the dots in the rail for the duration. That is `ValueLoader`, relocated to the rail and made non-blocking.
- Mission splash: first open per day only (Q3 default), rendered on the warm N50 ground (not deep navy) with the mission in 20/600 N800 and the four dots above it in brand colours, 1.2s, 160ms fade. Never on navigation.
- Buttons in flight: label swaps to a 16px N-scale dot spinner (the four dots, monochrome) with the button width preserved.

### 5.10 Buttons
| Variant | Fill | Text | Border | Hover | Press |
|---|---|---|---|---|---|
| Primary | blue-600 | white 14/600 | none | blue-hover `#0062CC` | blue-800 |
| Secondary | white | N800 14/500 | 1px N300 | N50 fill | N100 |
| Ghost | none | N600 14/500 | none | N100 fill | N200 |
| Destructive | danger-solid `#D92D20` | white 14/600 | none | `#B42318` | `#912018` |
| Link | none | blue-700 14/500 | none | underline | |

Heights: 36 default (forms, modals, empty states), 32 in toolbars and headers, 28 inline in rows. Radius 8. Icon buttons square at the same heights with a tooltip and `aria-label`. No `active:translate-y-px`, no `shadow-sm`. One primary per surface. Disabled: N50 fill, N200 border, N400 text, no opacity.

### 5.11 Inputs, switch, checkbox, radio
Inputs per 5.3. Switch 32×18, track N300 off / blue-600 on, 14px white knob, 150ms. Checkbox 16px radius 4, N300 border, blue-600 fill with white check when on, indeterminate = blue-600 dash. Radio 16px, blue-600 dot. All three use the brand ring on focus.

### 5.12 Tabs
Underline tabs (`ViewTab`, 4.4) for views and settings pages. Segmented control (32px, N50 track, white active segment with 1px N200, radius 8) for two-to-four exclusive options inside a panel (List/Board density, Light/Dark/System). Radix `<Tabs>` inside modals uses the underline style at 14/500.

### 5.13 Tooltips
N800 fill (`#221F1A`), white 12/500 text, radius 6, 6px 8px padding, 8px offset, 400ms show delay, 0ms hide, no arrow, max 240px. Dark mode: N100-light fill `#F0EEEB` with N800 text (inverted, so it still reads as "a note on top"). Every icon-only control has one.

### 5.14 Iconography
Lucide outline, 1.5px stroke, round caps and joins (Lucide default), 16px in rows, menus, chips and inputs; 20px in the rail, empty-state buttons and the content-header tile; 14px inside 22px status chips only. Colour: N500 at rest, N800 on hover of the parent row, blue-700 for the active rail item and active toolbar chip, semantic-fg for semantic glyphs, danger-fg for destructive menu items. Max two icons per row. One icon per concept app-wide (existing map: assignee `UserPlus`, due `CalendarPlus`, priority `Flag`, tags `Tag`, more `MoreHorizontal`). No filled variants except the status dot and the priority glyphs.

---

## 6. Motion

- Durations: `--os-t-fast` 120ms (hover fills, chip toggles, checkbox), `--os-t-base` 180ms (menus, popovers, tooltips, toasts in), `--os-t-slow` 240ms (drawer, modal, drawer-to-page expand, sidebar collapse). Nothing above 240ms in the app. Marketing may go to 600ms for scroll reveals.
- Easings: enter `cubic-bezier(.2,.8,.2,1)` (ease-out), exit `cubic-bezier(.4,0,1,1)` at 60% of the enter duration, layout `cubic-bezier(.4,0,.2,1)`.
- What animates: opacity, transform (translate 4 to 8px on enter for popovers and toasts, translateX for the drawer), background-color on hover, width of the sidebar on collapse, the loader dots, the "Saved" tick.
- What never animates: hovered elements (no scale, no translate, per the existing rule), colour of text on hover, list rows on reorder except a 180ms layout settle, kanban cards on drop (snap), row heights, borders, anything on scroll inside the app, the rail.
- `prefers-reduced-motion`: all durations to 0 except opacity at 120ms; the loader dots become a static brand-coloured row.
- Implementation: CSS transitions for hover and toggles; Motion v12 `LazyMotion` only for drawer, modal, drawer-to-page expand and toast stacking. Retire `.animate-fade-in` (300ms) and the 380ms splash fade.

---

## 7. Differentiation: why this does not read as monday, and what is ownable

monday is punchy: pure white chrome, saturated status cells, coloured group bars, Figtree, dense solid colour used as data. Warm clarity keeps the same blue and turns every other dial the other way:

1. **Ground temperature.** Warm paper greys (`#F8F6F4`, `#221F1A`) instead of monday's cool-neutral `#F6F7FB` / `#323338`. The blue becomes the only cool object on screen, which makes it read as a deliberate accent rather than a brand wash.
2. **Status is pale everywhere.** No solid green/yellow/red cells anywhere, including the Board and Tables status columns. Colour is a whisper with a word next to it, not a block.
3. **No coloured structure.** Group headers, folders, spaces, column headers are neutral by default; hue appears only on chips and only when the user chose it, from a muted set.
4. **A humanist face.** Instrument Sans's round, open letterforms next to monday's Figtree and Linear's Inter: recognisably warmer at reading size.
5. **One rhythm, softer corners.** 36px everywhere, radius 8/10/14, no floating cards, no shadows at rest. monday's screens have many densities and coloured pills; this has one density and pale chips.
6. **The dots as the only illustration.** Empty states, the loader and the mission splash draw the four dots in N300 line art and let them take colour only while working. monday has no equivalent motif; ClickUp uses mascots; Notion uses none. This is the ownable signature: a calm grey mark that lights up in YBRG when the product is doing something for you.

What is ownable in one sentence: "the paper-and-blue look with four dots that light up". It is simple enough to describe to a new hire, it survives a screenshot at thumbnail size, and none of the five competitors in the references brief own it.

---

## 8. Migration onto `--os-*`

### 8.1 Rename / replace plan (file: `src/app/(dashboard)/os.css`)

Keep every `--os-*` name that has consumers and re-point its value (section 1.6). Add the new names. Delete the tokens listed as deleted only after a grep shows zero consumers; for the transition release, deleted names resolve to the nearest semantic token:

```
--os-c-green   -> var(--os-success-solid)
--os-c-red     -> var(--os-danger-solid)
--os-c-yellow  -> var(--os-warning-solid)
--os-c-orange  -> var(--os-warning-solid)
--os-c-blue    -> var(--os-brand)
--os-c-teal, -sage, -brown, -gray, -darkgray, -purple, -pink, -indigo, -lime -> var(--os-none-fg)
--os-brand-rail, --os-brand-dark -> var(--os-ink)
--os-shadow-card, --os-shadow-rest -> none
--os-title-h, --os-tabs-h, --os-filter-h -> removed with the three-band header
```

Order (matches the inputs brief section 7.6):
1. **Tokens + dark rebinding.** Replace the primitive block, add the semantic trio, the surface-sel and ink-strong tokens, move the dark block to a single `:root.dark, :root:not([data-theme=light]) @media dark` rebinding. Delete the 11 `data-accent` blocks. Keep the 147 `!important` repaints for now (they still catch un-migrated zinc utilities) but change their targets to token references so the warm dark palette shows through immediately.
2. **Type.** Load Instrument Sans + JetBrains Mono in `layout.tsx`, drop five families, set `--os-font`, override `text-xs` to 13 and add `text-2xs` 12, `text-3xs` 11, `text-rail` 10 in `@theme`. Codemod the 14 arbitrary `text-[Npx]` sizes to the seven scale classes (13.5 → 14, 12.5 → 13, 11.5 → 12, 14.5 → 14, 17 → 16, 26 → 20, 15 → 14).
3. **Shell.** `os-shell.tsx`: rail 64, sidebar 248, top bar 48, new content header + toolbar primitives (`OsPageHeader`, `OsToolbar`) replacing `OsTitleBar`'s stacked bands; fix the stale 48/88/280 comment. Remove the floating topbar cards. Move quick tools into "+ Create".
4. **Primitives.** Tokenise `Button` (raw hex + slate → tokens), `Chip/StatusChip` (zinc → tokens, pale rule, drop uppercase), `MenuList` (hardcoded dark hex → `--os-surface`), `ViewTab` (zinc-900 → brand underline), `EntityTile` (neutral by default), `Dialog` (sizes, radius 14, scrim token), `OsEmptyView` (dots illustration slot), `useOsToast` (bottom-left, glyph slot), `DotsLoader/ValueLoader` (rail-mounted, non-blocking), `Switch`. Add `Picker` (5.5) and `Drawer` (4.5) as shared primitives, retiring the nine `useAnchorPos` one-offs into `Picker` over time.
5. **Colour and empty-state sweep.** Every `zinc-*` / `slate-*` / raw hex in `src/components` and `src/app` moves to tokens (282 + 255 files); every yellow/red/green use re-points to the trio; every hub landing and empty list adopts 5.7; delete the 18 purple-family files' classes. As each file migrates, delete its matching `!important` repaint rule.
6. **Protected parity screens** (List, Board, Calendar, Gantt, task detail): restyle with tokens and the 36px rhythm, pale status, drawer-first; no structural change until Q1 is answered.
7. **Marketing** last, same tokens, light only.

### 8.2 Risks

- **Warm neutrals against a cool blue** can look mismatched if chroma creeps up. Mitigation: the ramp is generated (chroma ≤ 0.014) and checked in; designers do not hand-pick greys. Blue-50 tints stay cool on purpose.
- **Pale status everywhere loses some scan speed in dense status columns** versus monday's solid cells. Mitigation: the 6px solid dot and 600-weight word; if Tables users complain, a per-view "Solid status column" Display option can be added without a token change (the solid pair already exists).
- **36px navigation rows cost ~10% vertical density in the sidebar** versus 32. Mitigation: group collapse and Customize Sidebar hiding; the tree is access-scoped anyway.
- **Font swap** changes metrics everywhere (Instrument Sans is slightly wider than Figtree at 14px): long German/French labels in the rail and sidebar need the truncation rules tested; `next/font` with `adjustFontFallback` avoids CLS.
- **Dark mode breaks silently** if a class name changes before its token migration; the sequence in 8.1 (tokens first, repaints retargeted, deleted per file) is the guard. A Playwright screenshot run per migrated hub in both themes is the acceptance test.
- **The 11-accent removal and the solid-status removal are founder calls** (Q4, references Q3). This proposal assumes both; if either is kept, the token layer still works, only the differentiation weakens.
- **Illustration scope creep.** The empty-state art is line-art dots only; if anyone adds colour or characters, the "no mascots, dots are the only illustration language" rule in the brand section is the veto.
- **Deleting `--os-c-*`** touches user-defined status colours stored as hex in data; those are data, not tokens, and keep rendering through the pale rule, so no migration of stored values is needed.
