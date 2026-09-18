# WorkwrK design system proposal: "Quiet precision"

Stance: Linear-class restraint on a blue-primary YBRG brand. Chrome recedes to a single quiet tone; the interface is monochrome slate with one blue pulse. Blue appears in exactly four places: the one primary action on a surface, selection and checked controls, links, and the focus ring. Everything else, including the active navigation state, is carried by weight and grey. Hierarchy comes from 400 / 500 / 600 weight and from three greys, never from size. Density is a strict 32px rhythm on a 4px grid. Icons are 1.5px Lucide outlines. Type is Inter.

Differentiation from monday is restraint: monday is colourful and warm, this is cool, quiet and precise. Differentiation from Linear is that WorkwrK keeps labels, visible buttons and a labelled rail, because the audience is any business with zero training, not keyboard-first engineers.

Every number below is implementable as written. Contrast values marked "verified" are the ones computed in `design-references.md` §4.7 and are reused unchanged.

Sources this proposal builds on: `phase2-inputs.md` (constraints, defaults), `design-references.md` (verified contrast, references), `existing-direction.md` (the `--os-*` vocabulary and adoption counts), `src/app/(dashboard)/os.css` lines 40 to 125 (current token block), `src/components/brand/dots-loader.css` (YBRG loader), `src/app/layout.tsx` (seven font families loaded).

---

## 0. The five rules that make it "quiet precision"

1. **One plane of chrome.** Rail and secondary sidebar are one continuous N50 surface with no divider between them. The only structural line on the screen is the 1px N200 edge between chrome and content. Nothing inside the chrome has a border.
2. **Blue is punctuation, not paint.** Primary button, selection wash, checked controls, links, focus ring, progress fill. Not the active rail, not the active sidebar row, not tab underlines, not icons at rest, not headers. Active navigation is grey fill plus 500 weight.
3. **Weight and grey over size.** Six sizes total in the app (20, 16, 14, 13, 12, 11) plus the 10px rail label. Titles are 20px and 16px; everything else is 14 or smaller. Emphasis is 500 weight and N800; de-emphasis is 400 weight and N500. That is the whole hierarchy toolkit.
4. **32 is the rhythm.** Every navigation row, menu row, picker row, table row (default density), input, button and chip stack sits on 32px. Comfortable density (36px) exists for data rows only, as a user preference. Nothing on a screen has a third row height.
5. **Structure is felt, not seen.** Row separators are absent in lists and N100 hairlines in tables. Shadows exist only on popovers, modals and drag ghosts. Motion is 100 to 200ms and only moves opacity and transform.

---

## 1. Colour

### 1.1 Layer 1: primitives

Generated in OKLCH so equal-lightness steps look equal. Hue is fixed per ramp; lightness steps are even. Chroma for neutrals is 0.006 to 0.012 (LCH chroma 2 to 4): cool, slate family, never steel.

**Neutral ramp (light and dark share the same primitives; dark rebinds the aliases in 1.2.2)**

| Primitive | Hex | OKLCH (approx) | Notes |
|---|---|---|---|
| N0 | `#FFFFFF` | 100 / 0 / 0 | |
| N50 | `#F6F7F9` | 97.5 / 0.003 / 250 | chrome plane |
| N100 | `#EEF0F3` | 95.5 / 0.004 / 250 | hover |
| N200 | `#E4E7EC` | 92.5 / 0.006 / 250 | structural line, chrome active fill |
| N300 | `#D0D5DD` | 87 / 0.010 / 250 | input line, decorative |
| N400 | `#98A2B3` | 70 / 0.020 / 250 | placeholder, disabled (2.58:1 verified, decorative only) |
| N500 | `#667085` | 53 / 0.030 / 255 | secondary text (4.97:1 white, 4.64:1 on N50, verified) |
| N600 | `#475467` | 41 / 0.030 / 255 | tertiary text, rail inactive labels |
| N700 | `#344054` | 34 / 0.035 / 255 | form labels, headings on tint |
| N800 | `#1F2430` | 24 / 0.020 / 260 | primary text (15.5:1 verified) |
| N900 | `#101215` | 15 / 0.006 / 260 | dark base |
| N950 | `#0B0C0F` | 10 / 0.004 / 260 | dark scrim base only |

**Blue ramp (the only accent)**

| Primitive | Hex | Use (via alias) |
|---|---|---|
| B50 | `#EAF3FE` | selection wash |
| B100 | `#D4E7FD` | selection + hover |
| B200 | `#A9CFFB` | focus halo on inputs |
| B400 | `#4D9CFF` | accent text on dark (6.71:1 verified) |
| B500 | `#7AB8FF` | accent text on dark, high-contrast variant (9.1:1) |
| B600 | `#0073EA` | solid (white 4.53:1 verified) |
| B650 | `#0062CC` | solid hover (5.8:1 verified). One value; replaces `#0060B9` (os.css) and `#0060C2` (marketing) |
| B700 | `#0B5FC2` | link and accent text on light (6.12:1 verified) |
| B800 | `#0A4C9B` | pressed |

**Green / Yellow / Red ramps**: exist in the generator only. They are NOT emitted as `--os-*` variables. Components can only reach them through the semantic aliases in 1.2.3. This is enforced by the CSS: there is no `--os-green-*` token to type.

**Brand dots** (`#FFCB00`, `#0073EA`, `#FF3D57`, `#00C875`): emitted as `--os-dot-y / -b / -r / -g` and consumed by exactly two files, `brand/logo.tsx` and `brand/dots-loader.css`. Lint rule: any other import of those hexes fails.

### 1.2 Layer 2: semantic aliases (what components use)

#### 1.2.1 Light

| Alias (`--os-*`) | Value | Role |
|---|---|---|
| `bg-app` | N0 `#FFFFFF` | content ground, cards, table body, modals |
| `bg-chrome` | N50 `#F6F7F9` | rail + sidebar plane, table header, toolbar ground when scrolled |
| `bg-subtle` | N50 `#F6F7F9` | tinted sections inside content (settings cards ground) |
| `bg-hover` | N100 `#EEF0F3` | hover on rows, menu items, ghost buttons |
| `bg-active` | N200 `#E4E7EC` | active navigation fill (rail, sidebar), pressed ghost |
| `bg-selected` | B50 `#EAF3FE` | selected row, selected card |
| `bg-selected-hover` | B100 `#D4E7FD` | selected + hover |
| `bg-raised` | N0 `#FFFFFF` | popovers, menus, drawers (same as app in light; differs in dark) |
| `bg-overlay` | N0 `#FFFFFF` | modals |
| `bg-scrim` | `rgba(16,18,21,0.40)` | modal scrim |
| `bg-inverse` | N800 `#1F2430` | tooltips, kbd on tooltips |
| `border-subtle` | N100 `#EEF0F3` | table hairlines, section dividers inside content |
| `border-default` | N200 `#E4E7EC` | chrome/content edge, cards, popovers, toasts |
| `border-strong` | N300 `#D0D5DD` | inputs, secondary buttons |
| `text-primary` | N800 `#1F2430` | body, titles, row titles |
| `text-secondary` | N500 `#667085` | helper, metadata, counts, inactive icons |
| `text-tertiary` | N600 `#475467` | rail inactive labels, ghost button labels |
| `text-placeholder` | N400 `#98A2B3` | placeholders, disabled |
| `text-inverse` | N0 `#FFFFFF` | on solid blue, on tooltips |
| `text-link` | B700 `#0B5FC2` | links in text |
| `accent-solid` | B600 `#0073EA` | primary button, checkbox on, switch on, progress fill |
| `accent-solid-hover` | B650 `#0062CC` | |
| `accent-solid-active` | B800 `#0A4C9B` | |
| `accent-text` | B700 `#0B5FC2` | accent text, selected-item check glyph |
| `accent-bg` | B50 `#EAF3FE` | info banner, selected chip |
| `focus-ring` | B600 `#0073EA` | 2px outline, 2px offset, `:focus-visible` |
| `focus-halo` | B200 `#A9CFFB` | 3px box-shadow on focused inputs |

#### 1.2.2 Dark (rebinding of the same aliases under `:root.dark` and `@media (prefers-color-scheme: dark)` when theme = system)

| Alias | Value | Verified / note |
|---|---|---|
| `bg-app` | `#101215` | N900 |
| `bg-chrome` | `#0D0F12` | one step below app; the chrome plane is darker than content in dark mode, mirroring light where chrome is greyer than content |
| `bg-subtle` | `#15181D` | |
| `bg-hover` | `#1B1F25` | |
| `bg-active` | `#252A32` | |
| `bg-selected` | `rgba(0,115,234,0.14)` | brief 3.6 |
| `bg-selected-hover` | `rgba(0,115,234,0.20)` | |
| `bg-raised` | `#181B20` | elevation = lighter surface |
| `bg-overlay` | `#1F232A` | second elevation |
| `bg-scrim` | `rgba(0,0,0,0.60)` | |
| `bg-inverse` | `#E6E8EC` | tooltip on dark is light |
| `border-subtle` | `#1F232A` | |
| `border-default` | `#262A31` | brief 3.6 |
| `border-strong` | `#30353D` | brief 3.6 |
| `text-primary` | `#E6E8EC` | 15.3:1 verified |
| `text-secondary` | `#9AA3B2` | 7.38:1 verified |
| `text-tertiary` | `#B4BBC7` | |
| `text-placeholder` | `#6B7280` | |
| `text-inverse` | `#101215` | on inverse tooltip |
| `text-link` | `#4D9CFF` | 6.71:1 verified. Never B700 on dark. |
| `accent-solid` | `#0073EA` | white text 4.53:1 holds on dark |
| `accent-solid-hover` | `#1A82F0` | lighter, not darker, on dark |
| `accent-solid-active` | `#0062CC` | |
| `accent-text` | `#4D9CFF` | |
| `accent-bg` | `rgba(0,115,234,0.14)` | |
| `focus-ring` | `#4D9CFF` | |
| `focus-halo` | `rgba(77,156,255,0.35)` | |

#### 1.2.3 Semantic status trio (the only Y/R/G that reaches components)

| Alias | Light | Dark | Contrast (verified where marked) |
|---|---|---|---|
| `success-bg` | `#ECFDF3` | `#0F2A1A` | |
| `success-text` | `#15803D` | `#4ADE80` | 4.76:1 on bg (v); dark 6.7:1+ |
| `success-solid` | `#15803D` | `#22C55E` | white on light solid 5.02:1 (v); dark solid carries N900 text |
| `warning-bg` | `#FFFAEB` | `#2A2208` | |
| `warning-text` | `#854D0E` | `#FCD34D` | 6.57:1 (v) |
| `warning-solid` | `#FACC15` | `#FACC15` | N800 text only, 10.1:1 (v). Yellow never carries white. |
| `danger-bg` | `#FEF3F2` | `#2C1212` | |
| `danger-text` | `#B42318` | `#F87171` | 6.05:1 (v) |
| `danger-solid` | `#D92D20` | `#EF4444` | white on light solid 4.83:1 (v). Replaces `#E2445C`. |
| `info-bg` / `info-text` | `accent-bg` / `accent-text` | same aliases | 5.47:1 (v) |
| `neutral-status-bg` / `-text` | N100 / N600 | `bg-active` / `text-tertiary` | not started, none, cancelled |

Rules:
- Colour never travels alone. Every semantic colour sits next to a word or a status glyph (1.5.2).
- Pale form (bg + text) is the default everywhere. Solid form is permitted on one surface only: a fully solid status column in Board table view and Tables. Never a mix of pale and solid in one column.
- Red means overdue, blocked, destructive. Nothing else.
- No hue-keyed Spaces, Folders, groups or tabs. `EntityTile` default is neutral (N100 tile, N600 glyph).

#### 1.2.4 User-defined status colours (data, not chrome)

Per-List statuses keep a user-chosen colour. The picker offers eight muted values that exclude the three semantic hues so a custom "green" can never read as `success`:

`--os-status-1..8`: `#5B7C99` slate blue · `#6B8F71` sage · `#9A8C98` mauve grey · `#B08968` clay · `#7A8B99` steel · `#8E7F9C` heather · `#6F8F8A` teal grey · `#A38F6E` sand. All eight sit at OKLCH L 55 to 62, C 0.03 to 0.05: visibly different from each other, invisible next to the semantic trio.

The former `--os-c-*` monday palette (`#00C875`, `#FDAB3D`, `#E2445C`, `#FFCB00`, `#579BFC`, `#66CCC2`, `#7F5347`, `#037F4C`, `#C4C4C4`, `#808080`) is retired. Existing List statuses keep their stored hex (data is never rewritten); the picker no longer offers them, and a one-time migration maps stored monday values onto the nearest of the eight when a status is next edited.

### 1.3 Layer 3: component tokens (sparse, only where a component deviates)

| Token | Light | Dark | Why it exists |
|---|---|---|---|
| `--os-rail-active-bg` | `bg-active` | `bg-active` | one switch flips the whole rail to a blue-50 pill if the founder prefers brief §4.1's default |
| `--os-rail-active-fg` | `text-primary` | `text-primary` | as above (would become `accent-text`) |
| `--os-table-header-bg` | `bg-chrome` | `bg-subtle` | table header is the only tinted band in content |
| `--os-chip-status-radius` | `4px` | | chips are squarer than buttons |
| `--os-kbd-bg` | N100 | `#252A32` | |
| `--os-tooltip-bg` | `bg-inverse` | `bg-inverse` | |
| `--os-skeleton` | N100 | `#1B1F25` | |
| `--os-drag-shadow` | `var(--os-shadow-pop)` | none (lighter surface) | |

No other component tokens. If a component needs a colour that is not in 1.2, the alias set is wrong, not the component.

### 1.4 Dark-mode strategy

- Light first. Marketing is light only.
- Dark is a rebinding of layer 2 under `:root.dark .workwrk-os` and `:root.dark` (portals), plus `@media (prefers-color-scheme: dark)` when `data-theme="system"`. Zero component-level colour literals; the 147 `:root.dark` `!important` utility repaints are deleted once the last `zinc-*` class is gone (migration §8).
- Elevation in dark is a lighter surface, not a shadow: app `#101215` → raised `#181B20` → overlay `#1F232A`. Popovers keep a 1px `border-default` and no drop shadow in dark.
- Accent solid stays `#0073EA`; accent text lifts to `#4D9CFF`. Hover on solid buttons goes lighter, not darker.
- High-contrast preference: a `[data-contrast="high"]` block raises `text-secondary` to `#B4BBC7`, `border-default` to `#3A404A` and `accent-text` to `#7AB8FF`. No third theme.
- Accent picker: removed. One blue plus light / dark / system. The four purple-family accents are deleted regardless of the founder's Q4 answer.

---

## 2. Type

### 2.1 Family

- **Inter** (Google Fonts, variable, `wght` 400 to 600 loaded as a single axis file via `next/font/google` with `axes: ['wght']`; `display: swap`). Fallback stack: `Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`.
- Features: `font-feature-settings: "cv11", "ss01"` off (keep Inter's default single-storey a for legibility at 12 to 13px); `"tnum"` on in tables, metrics, dates and counts via `.tabular`; `"calt"` on. `-webkit-font-smoothing: antialiased` on macOS only inside `.workwrk-os`.
- Mono: **JetBrains Mono** (already loaded) for formulas, code, IDs. Drop Geist Mono.
- Removed from the root layout: Outfit, Syne, Geist, Geist Mono, Instrument Serif, Figtree. Marketing moves to Inter as well.
- Letter-spacing: 0 at all sizes. The `-0.005em` on `--os-font` is dropped. Rail labels get `+0.01em`.

### 2.2 Scale (six sizes plus the rail label; half-pixel sizes banned; floor 10)

| Token | Size / weight / line-height | Role |
|---|---|---|
| `--os-t-title` | 20 / 600 / 24 | page title (content header), settings page title |
| `--os-t-heading` | 16 / 600 / 20 | section title, modal title, drawer title, empty-state title, doc H2 |
| `--os-t-body` | 14 / 400 / 20 | body, table cells, sidebar rows, menu rows, inputs, buttons |
| `--os-t-body-strong` | 14 / 500 / 20 | row title (first column), active nav row, form field label in drawers, button label |
| `--os-t-small` | 13 / 400 / 18 | helper text, secondary lines, toast second line, timestamps |
| `--os-t-label` | 12 / 500 / 16 | table headers, group labels, chips, metadata, breadcrumb crumbs (non-current) |
| `--os-t-micro` | 11 / 500 / 14 | kbd hints, counts inside chips, avatar initials at 20px |
| `--os-t-rail` | 10 / 500 / 12 / +0.01em | rail labels only |

Doc editor body is 15 / 400 / 24 with a 680px column (`--os-t-prose`), the single exception to "14 base", because reading long text differs from scanning rows.

Weights are 400, 500, 600. Inter Variable renders 500 at true 500; if the founder wants Linear's "machined" look, set `--os-w-medium: 510` and `--os-w-strong: 590` in one place; all components read the variables.

### 2.3 Hierarchy rule

Size distinguishes only three tiers: title (20), heading (16), everything else (14 and below). Within the 14-and-below tier, hierarchy is:

1. `text-primary` 500 → the thing you act on (row title, active nav, field label).
2. `text-primary` 400 → content.
3. `text-secondary` 400 → context (metadata, helper, counts).
4. `text-placeholder` 400 → absence (placeholder, disabled).

A designer may not reach for size 15, 17 or 18 to make something "more important"; they raise weight one step or lift the grey one step. Group labels are 12 / 500 / `text-secondary`, never uppercase.

---

## 3. Rhythm

### 3.1 Grid and spacing

4px grid. Spacing tokens `--os-s-1..10` = 4, 8, 12, 16, 20, 24, 32, 40, 48, 64. Content padding 24 (`--os-page-pad`). Card padding 16 (`--os-card-pad`). Modal padding 24. Drawer padding 20. Row horizontal padding 12 (chrome) / 16 (content). Gap between inline controls 8; between form fields 16; between form cards 24; between sections 32.

### 3.2 Row heights

| Token | Value | Applies to |
|---|---|---|
| `--os-row-h` | 32 | rail-adjacent sidebar rows, menu rows, picker rows, table rows (default density), inputs, buttons, tabs, toolbar controls, chip rows in kanban cards |
| `--os-row-h-lg` | 36 | data rows at comfortable density (user preference in Settings → You → Preferences → Density); board table, list view, Tables. Chrome never changes. |
| `--os-control-h` | 32 | default button and input |
| `--os-control-h-sm` | 28 | toolbar buttons (Filter, Sort, Group, Display), inline row actions, chips-as-buttons |
| `--os-control-h-xs` | 24 | icon-only row actions, kbd, checkbox hit area |

Chip height 20 (in rows), 24 (standalone). Avatar 20 in rows, 24 in headers, 32 in profile panels, 40 in people cards.

The existing `--os-row-h: 28px` becomes 32. Sidebar tree rows `h-7` become `h-8`. Density preference values `44 / 32` in globals become `36 / 32`.

### 3.3 Radii

| Token | Value | Applies to |
|---|---|---|
| `--os-r-xs` | 4 | chips, checkboxes, kbd, small entity tiles (16 to 18px), skeleton bars |
| `--os-r-sm` | 6 | inputs, buttons, menu rows, tabs hover, entity tiles 20 to 36px |
| `--os-r-md` | 8 | cards, popovers, menus, toasts, rail active pill, kanban cards |
| `--os-r-lg` | 10 | modals, drawers (top-left and bottom-left corners only; right edge flush) |
| `--os-r-pill` | 999 | avatars, presence dots, progress bars, count badges |

`--os-r-xl` (16) is retired; `rounded-2xl / 3xl` are banned inside `.workwrk-os`. Quiet precision reads tighter than Monday-clean; nothing in the product is rounder than 10px except pills.

### 3.4 Elevation and shadow

Borders carry structure. Shadows exist in three places, and dark mode replaces two of them with surface lightness.

| Token | Light | Dark |
|---|---|---|
| `--os-shadow-pop` (popovers, menus, pickers, tooltips, drag ghost) | `0 4px 16px rgba(16,18,21,0.10), 0 0 0 1px var(--os-border-default)` | `0 0 0 1px var(--os-border-default)` |
| `--os-shadow-modal` (modals, drawers) | `0 12px 32px rgba(16,18,21,0.14), 0 0 0 1px var(--os-border-default)` | `0 0 0 1px var(--os-border-strong)` |
| `--os-shadow-rest` | none | none |

`--os-shadow-card` is retired; cards are `1px border-default` on `bg-app`. `shadow-sm`, `shadow-2xl` and every Tailwind shadow utility are banned inside `.workwrk-os`.

---

## 4. Shell specification

### 4.1 Overall geometry (light values; dark uses the same numbers)

```
┌──────┬──────────────┬─────────────────────────────────────────────┐
│ rail │  sidebar     │ top bar 44                                  │
│ 64   │  240         ├─────────────────────────────────────────────┤
│      │              │ content header 48                           │
│ N50  │  N50         ├─────────────────────────────────────────────┤
│      │              │ toolbar 36                                  │
│      │              ├─────────────────────────────────────────────┤
│      │              │ content (24px padding)                      │
└──────┴──────────────┴─────────────────────────────────────────────┘
        ↑ no divider   ↑ 1px border-default, the only vertical line
```

Chrome above content: 44 + 48 + 36 = 128px (today: 32 + 40 + 34 + 34 = 140). Chrome left of content: 304px (today 320). RTL mirrors the whole shell: rail right, sidebar right, breadcrumb and drawer mirrored, `inset-inline` throughout, chevrons flipped via `rtl:rotate-180`.

### 4.2 Rail (64px, `bg-chrome`)

- Vertical stack, top-aligned, 8px top padding. No workspace avatar at the top (workspace switcher is the sidebar header). No divider to the sidebar.
- Item: 48 wide × 52 tall pill, radius 8, centred in the 64 column; 20px Lucide icon (1.5px stroke) then 4px then a 10 / 500 label. Gap between items 4px.
- States: rest icon `text-tertiary` N600, label `text-tertiary`; hover `bg-hover`; active `--os-rail-active-bg` (N200) with icon and label `text-primary` and label weight 500. No blue. The active item is the darkest thing in the chrome plane, which is exactly enough.
- The eight hubs in the code's order: Work, Planner, AI, Talk, Teams, Docs, Tables, Settings; Settings renders in the bottom cluster. Labels max 9 characters, no two starting with the same word. Access-derived; no pinning; no badges except a 6px `accent-solid` dot on Talk / Work when unread exists (dot, not a count).
- Bottom cluster (8px bottom padding): Settings hub item, then the 28px avatar (menu: Profile, Preferences, Theme, Log out) in a 48×44 hit area.
- Never scrolls. "Icons-only rail" option removed from CustomizePanel.
- Keyboard: arrow keys move between hubs, Enter opens; `⌘1..8` jump.

### 4.3 Secondary sidebar (240px, `bg-chrome`)

- Header (44px, aligned with the top bar): workspace name 14 / 500 with a 16px chevron, opens the workspace menu. Right side: a 24px icon button that collapses the sidebar (remembered per user). No search box in the sidebar; search lives in the top bar.
- Rows: 32px, 14 / 400, `text-primary`; one leading 16px icon or `EntityTile size="sm"` (18px, neutral) in `text-secondary`; 12px horizontal padding; row radius 6 with 4px horizontal inset so hover fills are pills, not bands. Counts right-aligned 12 / 400 `text-secondary` tabular. Leaf rows indent 20px per level; no guide lines.
- States: hover `bg-hover`; active `bg-active` + 500 weight + icon `text-primary`. No blue, no left bar.
- Group labels: 12 / 500 `text-secondary`, 24px top margin, 8px bottom, 12px left padding, with a 16px chevron that appears on hover at the right; collapsible; collapse state per user.
- Hover cluster on tree rows: at most two 24px ghost icon buttons ("…" and "+") appearing on hover, right-aligned, replacing the count while hovered.
- Work hub order: **Home** (My work), **Inbox**, then group **Favorites** (only if non-empty), then group **Spaces** (access-derived tree). Other hubs open directly on their tree; folded apps (Goals, Timesheets, Library, Clips, SOPs, Policies, Contracts, Reviews, Candor, Kudos, Surveys, Forms, Automation, Tools, Assets, Build, Marketplace, Trash) are plain rows in a labelled group at the top of their hub's sidebar.
- Footer: a single 32px ghost row "Customize sidebar" with a 16px `Settings2` icon, pinned to the bottom, `text-secondary`. Nothing else, ever.
- Collapsed state: sidebar hidden, rail remains; a 24px expand button appears at the left of the top bar.

### 4.4 Top bar (44px, `bg-app`, 1px `border-default` bottom)

- Left (from 12px): back and forward 28px ghost icon buttons (`ChevronLeft` / `ChevronRight`, disabled state `text-placeholder`), 8px gap, then the hierarchy breadcrumb: crumbs 13 / 400 `text-secondary`, separators a 12px `ChevronRight` in `text-placeholder`, last crumb 13 / 500 `text-primary` and not a link. Past 4 levels the middle collapses to a "…" crumb that opens a menu. The breadcrumb is the location bar; there is never a second location row.
- Centre: search input 400px wide (max 40% of viewport), 32px tall, `bg-subtle` fill, no border at rest, `Search` icon 16px `text-secondary` left, placeholder "Search or jump to…" in `text-placeholder`, `⌘K` kbd right. On focus it becomes an input with `border-strong` and the focus halo; the palette opens below.
- Right (to 12px): `+ Create` primary button (32px, the only solid blue in the chrome; menu: Task, Doc, Reminder, Note, Voice note, and the hub-relevant items), 8px, Reminders bell 28px ghost icon (6px `accent-solid` dot when pending), Help 28px ghost icon (`CircleHelp`), 8px, avatar 24px. No quick-tools row; no floating cards; no zinc ground.
- Settings takeover replaces the top bar with its own 44px bar: `← Back to app` ghost button left, "Settings" 14 / 500 centre-left, nothing right.

### 4.5 Content header (48px) and toolbar (36px)

Content header: 24px horizontal padding, vertically centred single row.
- Left: optional `EntityTile size="lg"` (32px, neutral) 12px before the title; title 20 / 600 `text-primary`, single line, ellipsis; 16px gap; then `ViewTabs` inline (see 5.10).
- Right: page actions as 28px ghost buttons with 16px icons and labels (Share, "…"), and the one reserved **Ask AI** slot (a 28px ghost with `Sparkles` icon, label "Ask AI"; hidden when the AI module is off). Never a second primary button here.
- No description line under the title; descriptions live in the "…" → About panel.

Toolbar: 24px horizontal padding, 36px tall, no border; the bottom of the toolbar is where content starts.
- Left: Filter, Sort, Group, Display as 28px ghost buttons, 13 / 500 `text-tertiary`, 16px icon, 4px gap between icon and label, 4px between buttons. When active they gain a count chip (`Filter · 2`) and 500 weight `text-primary`, no colour.
- Right: the view's primary action as a 28px secondary button (`+ Add task`), because the surface's single blue is already spent on `+ Create`. In a surface without a top bar (Settings), the form's primary is the blue.

This replaces `--os-title-h 40 + --os-tabs-h 34 + --os-filter-h 34`.

### 4.6 Detail-view policy

| Situation | Container | Width | Header |
|---|---|---|---|
| Task, table row, person from a list/board/table | Drawer over the list, right-anchored, full height below the top bar | 520 (min), user-resizable to 720, remembered | 44px: breadcrumb-lite (List › Item id) left; Expand, Copy link, "…", Close as 28px ghost icons right |
| Doc, SOP, goal, review, KRA, role | Full page | content column 680 (prose), 760 (forms and tables) | breadcrumb in top bar + `BackButton{fallbackHref}` at top-left of the content header |
| From search, notification, deep link | Full page | as above | as above |
| Inbox, Talk threads | Split view | list 360, detail fills | list header 44, detail header 44 |
| Short create/edit (task, list, member, space) | Centred modal | 560 | 16 / 600 title, optional 13 `text-secondary` line |
| Rich create (task with description, template) | Centred modal | 720 | as above |
| Editors (status editor, form builder, import grid) | Centred modal | 960 max, 90vh max | as above |
| Confirm / destructive | Centred modal | 400 | title + one sentence; typed confirmation for org-level deletes |
| Person / channel info | Right panel (drawer variant) | 360 | name + close |

The drawer and the page render the same component (`BoardItemDetail`) and share the URL `/item/[id]`; the drawer is the default click target; Expand is the deliberate second step. No stacked modals. Pickers inside dialogs are absolutely positioned children.

---

## 5. Component standards

Every component below is one spec. Heights, radii, colours and type reference §1 to §3 only.

### 5.1 Buttons

| Variant | Fill | Border | Text | Hover | Active | Use |
|---|---|---|---|---|---|---|
| Primary | `accent-solid` | none | `text-inverse` 14 / 500 | `accent-solid-hover` | `accent-solid-active` | one per surface |
| Secondary | `bg-app` | 1px `border-strong` | `text-primary` 14 / 500 | `bg-hover` | `bg-active` | the default button |
| Ghost | none | none | `text-tertiary` 14 / 500 | `bg-hover` + `text-primary` | `bg-active` | toolbars, headers, icon buttons |
| Destructive | `danger-solid` | none | `text-inverse` | `#B42318` | `#912018` | only inside a confirm modal |
| Destructive ghost | none | none | `danger-text` | `danger-bg` | | "Delete" rows in menus and danger zones |
| Link | none | none | `text-link` 14 / 400, underline on hover | | | inline in sentences only |

Sizes: 32 default (12px horizontal padding, 16px icon, 8px icon gap), 28 small (10px padding, 13 / 500 label), 24 icon-only. Radius 6. Disabled: `bg-subtle`, `border-default`, `text-placeholder`, no opacity. Loading: label stays, a 14px four-dot loader (5.14) replaces the icon. No `active:translate-y-px`. Focus: `focus-ring`.

### 5.2 Inputs

32px tall, `bg-app`, 1px `border-strong`, radius 6, 10px horizontal padding, 14 / 400 `text-primary`, placeholder `text-placeholder`. Hover: `border-strong` unchanged, no fill change. Focus (any modality): border `accent-solid` + `0 0 0 3px focus-halo`. Error: border `danger-solid`, 13 / 400 `danger-text` helper below with a 14px `CircleAlert`. Disabled: `bg-subtle`, `text-placeholder`. Label above: 13 / 500 `text-tertiary`, 6px gap. Helper: 13 / 400 `text-secondary`, 6px gap. Textarea: same, min 3 rows, resize vertical. Search inputs put a 16px icon at 10px and pad the text 34px. Selects, dates and people are never native; they are the picker (5.6) in a 32px secondary-button trigger with a 16px `ChevronDown`.

Checkbox 16px, radius 4, 1px `border-strong`; checked `accent-solid` fill with a 12px white check; indeterminate a 8×2 white bar. Radio 16px pill. Switch 32×18, thumb 14, off `N300`, on `accent-solid`. All three: 24px hit area, `focus-ring`.

### 5.3 Table (Board list / table view, Tables, settings lists)

- Header 32px, `--os-table-header-bg` (N50), 12 / 500 `text-secondary` labels, tabular figures, no border below except a 1px `border-subtle`. Sticky. Column "+" at the end opens the field-type picker with "Show more" after 10.
- Rows 32 (default) or 36 (comfortable); `bg-app`; 1px `border-subtle` (N100) hairline between rows in tables, none in lists; no zebra. Hover `bg-hover`; selected `bg-selected`; selected + hover `bg-selected-hover`.
- First column: 14 / 500 `text-primary` (the only bold cell); other cells 14 / 400 `text-primary`; metadata cells `text-secondary`; numbers right-aligned tabular.
- Status cell: pale chip with status glyph (5.7). Solid column variant only when the whole column is solid (Tables and the Board table "status column" display option).
- Group header (list view): 32px, `bg-app`, chevron 16px + 14 / 500 name + count 12 / 400 `text-secondary`; no colour, no left rule. Empty groups collapse to one line. Last row in every group: 32px ghost "+ Add task" in `text-secondary`, indented to the title column.
- Checkbox appears at hover or when any row is selected, in a 32px leading gutter. Bulk bar: floating, bottom-centre, 44px, `bg-inverse` with `text-inverse`, radius 8, `shadow-pop`, "N selected" + 4 to 6 actions + close, appears 150ms after first selection.
- Tables surface (Sheets): keeps the "does Google Sheets have it" bar. Letter headers, grey row-number gutter, no selection chrome, 1000-row default, tiny corner "+". Cell height 32.

### 5.4 Kanban

Columns 280 wide, 12px gap, `bg-subtle` fill, radius 8, 8px inner padding. Column header 32px: 14 / 500 name, 12 `text-secondary` count, a 24px "+" ghost at the right, no colour and no status pill (the name is the status). Card: `bg-app`, 1px `border-default`, radius 8, 12px padding, 8px gap between cards, no shadow at rest; dragging: `shadow-pop`, 0.98 scale is NOT used (no transforms); the drag ghost is the card lifted with the shadow only. Card content, top to bottom: title 14 / 400 `text-primary`, 2-line clamp; one row of at most three 20px pale chips (priority glyph, due date, one label), 6px gap; bottom row 20px: identifier 12 `text-secondary` left, avatars right (max 2 + "+N"). Status never on the card. "+ Add task" ghost at the column bottom; "+ Add column" as a 280px dashed `border-strong` ghost column.

### 5.5 Forms and settings cards

Card: `bg-app`, 1px `border-default`, radius 8, 16px padding (24 in settings), title 16 / 600, one-line 13 `text-secondary` description, max 5 fields, 16px between fields. Labels above. Page forms max 480 wide; modal forms full width. One primary per form. Auto-saving toggles and selects show an inline "Saved" in 13 `text-secondary` with a 14px `Check` for 1.5s. Text-heavy forms: sticky bottom bar (44px, `bg-app`, 1px `border-default` top) appears only when dirty with Cancel (ghost) + Save (primary). Danger zone: last card, 1px border `#F3B6B0` light / `#5A2424` dark (a `--os-danger-border` component token), title `danger-text`, destructive ghost buttons; typed confirmation for org-level deletes.

Settings takeover: left list 240 (`bg-chrome`) with a 32px filter input at the top, group labels (You / Workspace / Governance / Billing & plan) 12 / 500 `text-secondary`, rows 32; content 760 max, 24px padding, page title 20 / 600.

### 5.6 The one picker popover

One component serves status, assignee, date, label, priority, task type, and "move to". Width 260 (`--os-popover-w`; date variant 288). `bg-raised`, 1px `border-default`, radius 8, `shadow-pop`, 4px inner padding. Search input at top (auto-focused, 32px, no border, 1px `border-subtle` below, placeholder "Change status…"). Rows 32px, radius 6, 8px padding: 16px glyph exactly as it renders in the list, 14 / 400 label, right-aligned 11 kbd hint or a 16px `Check` in `accent-text` when selected. Keyboard: arrows, Enter, Esc, type-to-filter. Multi-select keeps the popover open and shows checks. People rows: 20px avatar, name, 13 `text-secondary` email; last row "Invite by email…". Date variant: quick row (Today, Tomorrow, Next week, No date as 24px chips), natural-language input, one month grid with 28px cells, today ringed 1px `accent-solid`, selected `accent-solid` fill. Inside a dialog: `position:absolute` child, never portalled. Opens in 150ms, closes in 100ms.

### 5.7 Chips and status

- Chip: 20px tall in rows (24 standalone), radius 4, 12 / 500, 6px horizontal padding, optional 12px leading glyph with 4px gap. Neutral chip: `bg-hover` fill, `text-tertiary`. Label chip (user tag): `N100` fill, `text-primary`. Semantic chip: `*-bg` + `*-text`. Count badge: 16px pill, 11 / 500.
- Status glyph (ownable, see §7): a 14px ring, 1.5px stroke, in the status colour: empty ring = not started; ring with a quarter, half or three-quarter filled arc = in progress (by workflow position); filled disc with a white check = done; ring with a dash = cancelled; ring with an exclamation = blocked. The glyph precedes the status word in every chip, cell, picker row and drawer field, so users learn one vocabulary. The glyph is the only place a semantic colour appears without a pale fill behind it.
- Priority: four horizontal bars glyph (Linear-style), 14px: urgent = `danger-text` with all bars, high = `text-primary` three bars, normal = `text-secondary` two bars, low = `text-placeholder` one bar. No flags, no red/yellow/blue.
- StatusChip solid variant (status columns only): `*-solid` fill, radius 4, full cell width, 12 / 500 white (N800 on yellow), glyph white.
- Reserved chip styles: performance band (neutral chip with a 6px leading dot in `success / warning / danger` and the band word); co-presence ("Priya is editing": 20px avatar + 12 `text-secondary` text, no chip fill).

### 5.8 Modals and drawers

Modal: `bg-overlay`, radius 10, `shadow-modal`, `bg-scrim` behind, 24px padding, header 16 / 600 title + optional 13 `text-secondary` line + 28px ghost close top-right, body, footer right-aligned Cancel (ghost) + one primary (or destructive) 32px. Widths 400 / 560 / 720 / 960 (§4.6). Esc and scrim click close (not while dirty: a 400 confirm). Enter submits single-field forms.

Drawer: `bg-raised`, left edge 1px `border-default`, `shadow-modal` in light, 520 wide (resizable to 720), 44px header (§4.6), body 20px padding, tabs (Comments / Activity) as `ViewTabs`. Task drawer field strip (the first thing under the title, 32px rows, label 13 / 500 `text-tertiary` 120px column + value picker trigger): Status, Assignee, Due date, Priority visible by default; "+ Add field" ghost reveals the rest. Description below; subtasks and checklist as 32px rows; comments last.

### 5.9 Toasts

Bottom-left, 16px from edges, above the reserved call-dock region (which is bottom-right, so they never collide). 360 wide, `bg-raised`, 1px `border-default`, radius 8, `shadow-pop`, 12px padding, 14 / 400 `text-primary` line + optional 13 `text-secondary` second line, one text action ("Undo", `accent-text` 14 / 500) right, 24px ghost close. Leading 16px glyph only when semantic (`Check` in `success-text`, `CircleAlert` in `danger-text`); neutral toasts have no glyph. 5s auto-dismiss, 8s with an action, max 3 stacked with 8px gap, newest at the bottom. Never for validation; never blocking; never green banners.

### 5.10 Tabs (`ViewTabs`)

Inline underline tabs, 32px tall, 13 / 500, 12px horizontal padding, 4px gap. Rest `text-secondary`, hover `text-primary` + `bg-hover` pill (radius 6), active `text-primary` with a 2px `text-primary` underline offset to the bottom of the 48px header. Icons: 16px, mono, only for view tabs (List, Board, Calendar…), never for section tabs (Comments / Activity). Overflow: after 6 tabs the rest fold into a "+N" ghost. "+ View" is a 28px ghost at the end. The active colour is grey, not blue (a conscious departure from the brief's "brand underline" default; the underline is chrome, and chrome is monochrome).

### 5.11 Tooltips

`bg-inverse`, `text-inverse` 12 / 500, 6px × 8px padding, radius 6, max 240 wide, 8px from the trigger, optional kbd at the right in 11 / 500 with 0.7 opacity. Appear after 400ms hover, 0ms when moving between adjacent tooltip triggers, disappear immediately. Every icon-only button has one and an `aria-label`.

### 5.12 Empty states

One template. Centred in the content area, max 360 wide: a 64px four-dot mark in `N300` with the second dot in `accent-solid` (the single blue pulse, static), 16px gap, 16 / 600 title, 8px, 14 / 400 `text-secondary` two-line copy, 16px, a 32px primary button with an inline kbd hint, and a ghost "Learn more" beside it. Filtered-empty: no illustration; a 32px inline row "No results · Clear filters" (link) at the top of the list. Empty group: collapses to its header line. New workspace: Notion-style "Get started with" row of 24px secondary chips (Task, Doc, Table, Template…) plus a 5-item checklist card. `OsEmptyView` is the only implementation; `ui/empty-state.tsx` is deleted.

### 5.13 Loading

- Skeletons: `--os-skeleton` bars, radius 4, at the exact row height of the content they replace (32 or 36), 60% / 40% / 80% widths in rotation, one 1.6s opacity pulse between 0.6 and 1, no shimmer sweep.
- In-content and button loaders: `DotsLoader` restyled: four 6px dots in `N300`, one dot at a time lifts to `accent-solid` in sequence (the pulse travels left to right, 900ms loop). No YBRG inside the product chrome; YBRG stays on the logo, the marketing connectors and the first-open splash.
- Route transitions: a 2px `accent-solid` progress line at the very top of the content region (under the top bar), 200ms in, 150ms out, plus the dots loader centred after 400ms if still pending. No overlay.
- Mission and values: first app open per day shows the splash (mission + one value) for 1.2s on `bg-app` with the YBRG dots, then fades in 150ms. Every other loader shows the `ValueLoader` caption under the neutral dots as a 13 `text-secondary` non-blocking line. The 1.6s every-open overlay and the 10-minute navigation re-trigger are removed (founder Q3 default).

### 5.14 Iconography

Lucide only. 1.5px stroke, round caps and joins (Lucide default), 16px in rows, buttons and inputs; 20px in the rail; 12px inside chips and breadcrumb separators. Colour: `text-secondary` at rest in rows, `text-tertiary` in ghost buttons, `text-primary` when active or hovered, semantic colour only on status glyphs and destructive menu rows. No filled variants except the status glyph disc. One icon per concept app-wide (assignee `UserPlus`, due `CalendarPlus`, priority the bars glyph, tags `Tag`, more `Ellipsis`, add `Plus`, filter `ListFilter`, sort `ArrowUpDown`, group `Rows3`, display `SlidersHorizontal`, search `Search`, AI `Sparkles`). At most two icons per row. Icon-only buttons need a tooltip and `aria-label`.

`EntityTile`: neutral by default (N100 tile, N600 glyph, radius 4 / 6 by size); sizes xs 16, sm 18, md 20, lg 32 (was 36). The user-chosen colour set, if the founder keeps it (Q6), is the eight muted values in 1.2.4, applied as tile fill at 12% with the glyph in the full value.

### 5.15 Breadcrumb, BackButton, kbd, avatar, progress

- `BackButton{fallbackHref}`: 28px ghost with `ArrowLeft` 16px and the parent's name 13 / 500 `text-tertiary`, top-left of every full page's content header, 8px before the title. Bare `router.back()` stays forbidden.
- Kbd: 18px tall, `--os-kbd-bg`, 1px `border-default`, radius 4, 11 / 500 `text-secondary`, 4px padding.
- Avatar: pill, initials 11 / 500 on N200 with N700 text (no hue-keyed fallbacks; the lime dark fallback is deleted); presence dot 8px `success-solid` with a 2px `bg-app` ring.
- Progress bar: 4px pill, `N200` track, `accent-solid` fill; semantic fill only when the bar means on-track / at-risk / off-track and is labelled.

---

## 6. Motion

| Token | Value | Use |
|---|---|---|
| `--os-dur-instant` | 80ms | hover fills, focus ring |
| `--os-dur-fast` | 120ms | state changes, chip toggles, tab underline |
| `--os-dur-base` | 160ms | popovers, menus, tooltips in |
| `--os-dur-slow` | 200ms | modals, drawers, sidebar collapse |
| `--os-ease-out` | `cubic-bezier(0.2, 0, 0, 1)` | everything entering |
| `--os-ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | everything leaving, at 0.75× the entering duration |

What animates: opacity; `transform` (translateY 4px for popovers, translateX 12px for drawers, scale 0.98 to 1 for modals); background-colour on hover; the tab underline position (`layoutId`); the progress line; the dots loader; skeleton opacity.

What never animates: the hovered element's transform (existing rule); layout of list rows on data change (rows appear in place, no slide); colour of text; width or height of the sidebar during resize drag (instant); route content (crossfade removed, replaced by the progress line); anything longer than 200ms; anything under `prefers-reduced-motion: reduce`, where every duration becomes 0 and the dots loader becomes a static mark.

Retired: `.animate-fade-in` 300ms, the 380ms splash fade, `active:translate-y-px`, `shadow` transitions.

---

## 7. Differentiation: why this does not read as monday, and what is ownable

What monday is: warm greys (`#323338`, `#676879`), Figtree, solid coloured status cells everywhere, coloured group rails, a green success banner, a colourful "Help" pill, 36px rows with 8px radii and soft shadows on cards. What ClickUp is: purple accent, chips on every row, three stacked header rows, coloured group headers even when empty.

What this is, side by side:

| Lever | monday | Quiet precision |
|---|---|---|
| Neutral temperature | warm | cool slate, chroma 2 to 4 |
| Type | Figtree | Inter, tabular figures, 0 tracking |
| Where colour lives | every status cell, group rail, board colour | status glyph + pale chip; one blue button per surface |
| Active navigation | blue text / blue underline | grey fill, 500 weight |
| Status carrier | solid cell, white text | 14px ring glyph + word |
| Priority | none / colour flags (ClickUp) | four grey bars |
| Chrome separators | borders and shadows | one 1px line, one plane |
| Row rhythm | 36 | 32 |
| Radius | 8 and up | 4 / 6 / 8 / 10 |
| Feedback | green banner top-centre | white toast bottom-left with Undo |
| Loader | logo | four grey dots, one blue pulse |

The blue is the same hex. It is unrecognisable as monday's because it appears once per screen.

**Ownable elements** (things a screenshot can be identified by):
1. **The single blue pulse.** One `#0073EA` per surface, always the `+ Create` button. Every other blue on the screen is a consequence of the user's selection.
2. **The status ring.** The 14px ring-to-disc glyph family for status, in front of the word, in every surface. It is WorkwrK's status language the way Linear's circles are Linear's.
3. **The four-dot loader in grey with a travelling blue dot**, and the four-dot empty-state mark with the second dot blue. The logo's YBRG appears only on the logo; the product's dots are monochrome plus the pulse.
4. **One plane of chrome.** Rail and sidebar with no divider, no borders, no icons in colour; the content sits on white one shade brighter. Structure is felt.

---

## 8. Migration: mapping onto `--os-*`

Principle: keep every existing `--os-*` **name** (163 files reference them) and re-point values; add the semantic aliases as new names; retire generic palette names by aliasing them to semantic values for one release, then deleting them.

### 8.1 Re-pointed existing tokens

| Existing (os.css line) | Old value | New value | Note |
|---|---|---|---|
| `--os-brand` (40) | `#0073EA` | `#0073EA` | unchanged; becomes an alias of `--os-accent-solid` |
| `--os-brand-hover` (41) | `#0060B9` | `#0062CC` | one hover value everywhere |
| `--os-brand-soft` (42) | `#E6F1FB` | `#EAF3FE` | = `--os-bg-selected` |
| `--os-brand-deep` (43) | `#1F76C2` | `#0B5FC2` | = `--os-accent-text` |
| `--os-brand-dark` (44) | `#292F4C` | `#1F2430` | = N800; retire after sweep |
| `--os-brand-rail` (48) | `#1A2C4A` | `#1F2430` | = N800; retire after sweep |
| `--os-brand-ink` (52) | `var(--os-brand-rail)` | `var(--os-accent-text)` | |
| `--os-canvas` (71) | `#FFFFFF` | `#FFFFFF` | = `--os-bg-app` |
| `--os-surface` (76) | `#FFFFFF` | `#FFFFFF` | = `--os-bg-app` |
| `--os-surface-1` (77) | `#F6F7FB` | `#F6F7F9` | = `--os-bg-chrome` |
| `--os-surface-2` (78) | `#ECEEF5` | `#EEF0F3` | = `--os-bg-hover` |
| `--os-surface-3` (79) | `#E6E9EF` | `#E4E7EC` | = `--os-bg-active` |
| `--os-surface-hov` (80) | `#F0F3FA` | `#EEF0F3` | = `--os-bg-hover` |
| `--os-row-hov` (81) | `#F8F9FD` | `#EEF0F3` | = `--os-bg-hover` (one hover, not two) |
| `--os-line` (84) | `#E6E9EF` | `#E4E7EC` | = `--os-border-default` |
| `--os-line-soft` (85) | `#F0F2F7` | `#EEF0F3` | = `--os-border-subtle` |
| `--os-line-strong` (86) | `#D0D4DC` | `#D0D5DD` | = `--os-border-strong` |
| `--os-ink` (89) | `#323338` | `#1F2430` | = `--os-text-primary` |
| `--os-ink-2` (90) | `#676879` | `#667085` | = `--os-text-secondary` |
| `--os-ink-3` (91) | `#9699A6` | `#98A2B3` | = `--os-text-placeholder` |
| `--os-ink-4` (92) | `#C4C7D4` | `#D0D5DD` | = `--os-border-strong`; text use forbidden |
| `--os-r-lg` (98) | 12 | 10 | modals |
| `--os-r-xl` (99) | 16 | 10 | alias, then delete |
| `--os-shadow-card` (103) | 3px/10px + ring | `none` | cards are bordered |
| `--os-shadow-pop` (104) | 10px/26px | `0 4px 16px rgba(16,18,21,.10), 0 0 0 1px var(--os-border-default)` | |
| `--os-shadow-rest` (105) | hairline | `none` | |
| `--os-rail-w` (108) | 60 | 64 | |
| `--os-side-w` (109) | 260 | 240 | |
| `--os-top-h` (110) | 32 | 44 | |
| `--os-title-h` (111) | 40 | 48 | renamed `--os-header-h`; old name aliased |
| `--os-tabs-h` (112) | 34 | 0 | tabs live inside the header; alias to 0 then delete |
| `--os-filter-h` (113) | 34 | 36 | renamed `--os-toolbar-h`; old name aliased |
| `--os-page-pad` (116) | 12 | 24 | |
| `--os-card-pad` (117) | 12 | 16 | |
| `--os-row-h` (118) | 28 | 32 | |
| `--os-row-h-lg` (119) | 32 | 36 | |
| `--os-control-h` (120) | 26 | 32 | |
| `--os-control-h-sm` (121) | 22 | 28 | |
| `--os-popover-w` (122) | 300 | 260 | |
| `--os-font` (125) | Figtree | `var(--font-inter), Inter, ui-sans-serif, system-ui, …` | letter-spacing 0 |

Dark block (line 1558 onward) is rewritten to the 1.2.2 table; the `.os-sk` accent flip at line 31807 (`--os-brand: #E5E7EB`) is deleted because the Sidekick panel is folded into the single Ask AI slot.

### 8.2 Retired tokens

- `--os-c-green / orange / red / yellow / blue / teal / brown / sage / gray / darkgray` and the `purple / pink / indigo / lime` aliases: for one release, `--os-c-green → var(--os-success-text)`, `--os-c-red → var(--os-danger-text)`, `--os-c-yellow / orange → var(--os-warning-text)`, `--os-c-blue → var(--os-accent-text)`, the rest → `var(--os-text-secondary)`. Then delete. Stored List-status hexes are data and untouched.
- The 11 `:root[data-accent=…]` blocks: deleted. `data-accent` attribute no longer set.
- `globals.css`: `--color-surface / muted / accent-*`, the four `signal` triplets, `--brand-*`, `--status-*`, the bento `--color-lime` palette and `.dark .avatar-fallback-tone`: deleted from the app; marketing keeps a separate, smaller sheet with `--os-accent-solid` and the four brand dots only.
- `ui/accent.ts` (taupe), `.btn-taupe`, `app-shell.css`, the removed-module BEM families (`.pyr*`, `.hd*`, `.incd`, `.inv`, `.tck*`, `.pos`): deleted.
- Fonts: six of seven `next/font` imports removed from `layout.tsx`; `Inter` added.

### 8.3 New tokens (all names)

```
--os-bg-app --os-bg-chrome --os-bg-subtle --os-bg-hover --os-bg-active
--os-bg-selected --os-bg-selected-hover --os-bg-raised --os-bg-overlay
--os-bg-scrim --os-bg-inverse
--os-border-subtle --os-border-default --os-border-strong
--os-text-primary --os-text-secondary --os-text-tertiary
--os-text-placeholder --os-text-inverse --os-text-link
--os-accent-solid --os-accent-solid-hover --os-accent-solid-active
--os-accent-text --os-accent-bg --os-focus-ring --os-focus-halo
--os-success-bg --os-success-text --os-success-solid
--os-warning-bg --os-warning-text --os-warning-solid
--os-danger-bg --os-danger-text --os-danger-solid
--os-status-1 … --os-status-8
--os-dot-y --os-dot-b --os-dot-r --os-dot-g
--os-rail-active-bg --os-rail-active-fg --os-table-header-bg
--os-chip-status-radius --os-kbd-bg --os-tooltip-bg --os-skeleton --os-drag-shadow
--os-shadow-modal
--os-header-h --os-toolbar-h --os-control-h-xs
--os-s-1 … --os-s-10
--os-t-title … --os-t-rail (size / weight / line-height triplets)
--os-w-regular 400 --os-w-medium 500 --os-w-strong 600
--os-dur-instant --os-dur-fast --os-dur-base --os-dur-slow --os-ease-out --os-ease-in
```

Tailwind v4 `@theme` exposes them as `bg-app`, `text-primary`, `border-default`, `bg-selected`, etc., so components write `bg-app border-default text-secondary` and never `bg-white border-zinc-200 text-zinc-500`. An ESLint rule (`no-restricted-syntax` on `zinc-|slate-|gray-|neutral-|#[0-9a-f]{6}` inside `className`) blocks regressions.

### 8.4 Order

1. Tokens: add the new names, re-point the old ones, rewrite the dark block, add `@theme` mappings. No component changes. Ship. (Everything already on `--os-*` moves visually in one step; the 75% on zinc utilities look unchanged because the repaint layer still exists.)
2. Type: Inter in, six fonts out, `--os-t-*` in, replace the 14 arbitrary `text-[Npx]` sizes with the seven tokens (codemod: 13.5 → 14, 12.5 → 13, 11.5 → 12, 14.5 → 14, 15 → 14, 17 → 16, 26 → 20).
3. Primitives: `Button`, `Chip/StatusChip` (+ status glyph), `MenuItem/MenuList`, `ViewTab`, `EntityTile` (neutral default, lg 32), `Dialog`, `useOsToast`, `OsEmptyView`, `DotsLoader/ValueLoader`, `Switch`, `BackButton`, `Kbd`, one `Picker`. Each on tokens only.
4. Shell: rail 64, sidebar 240, top bar 44, header 48 + toolbar 36, drawer; `OsTitleBar` becomes the content header; `CustomizePanel` loses accents and icons-only.
5. Sweep: per file, zinc → tokens, delete the file's `:root.dark` repaints; when the last one is gone, delete the 147-rule layer. Empty-state and colour sweep (every Y/R/G → semantic) rides on this.
6. Protected parity screens (List, Board, Calendar, Gantt, task detail): restyle only, on tokens; group headers go from solid status pills to the 5.3 grey header **only if the founder answers Q1 yes**; otherwise they keep solid pills using `*-solid` tokens.
7. Marketing.

---

## 9. Risks

1. **Monochrome active navigation vs zero-training.** A grey active pill is less loud than a blue one. Mitigation: N200 fill on N50 (the darkest thing in the chrome plane), 500 weight, and the label; `--os-rail-active-bg / -fg` are two tokens away from the brief's blue-50 / blue-700 default if testing shows users lose their place.
2. **32px rows with 14px text.** 20px line-height leaves 6px above and below; chips at 20px and avatars at 20px fit exactly; anything taller in a row (a 24px chip, a two-line cell) breaks the rhythm. Rule: nothing inside a 32 row exceeds 20px; two-line content goes to the 36 density or the drawer.
3. **White on `#0073EA` at 4.53:1** is AA only at 14px+ / 500. The 28px small primary (13 / 500) is therefore banned; small buttons are secondary or ghost. The `+ Create` button is 32px.
4. **Dark-mode sequencing.** Any class rename before step 5 silently breaks dark mode for that file. The order in 8.4 is load-bearing.
5. **Protected parity screens** (Q1). Solid status group headers and coloured Gantt bubbles are the loudest things left; if the founder keeps them, the "quiet" reading survives on every other surface but a Board list screenshot will still look half-monday.
6. **Status ring glyph** is new vocabulary. It must appear identically in list, table, kanban header, picker, drawer and chips from day one, or it reads as decoration. Ship it in the `StatusChip` primitive and nowhere else.
7. **Inter is common.** It differentiates from monday (Figtree) but not from Linear or Notion; the differentiation from those comes from the labelled rail, the visible toolbar labels and the status ring, not from type.
8. **Stored List-status colours** in the monday palette stay as data; boards created before the migration will show `#00C875`-style greens next to `success` chips until each status is edited. A one-click "Refresh status colours" action in the Statuses editor mitigates.
9. **Loader policy** contradicts the founder's explicit ask for the values splash on every open (Q3). The first-open-per-day splash plus non-blocking captions preserve the intent; the decision needs to be shown, not assumed.
10. **RTL** is specified (inline-axis everywhere, mirrored shell) but unverified; `ar` and `he` need a real pass after step 4.
11. **Tables surface** keeps Sheets conventions; the 32 rhythm and the N50 header apply, but the "does Google Sheets have it" bar wins on any conflict, so Tables will look slightly denser and more bordered than the rest by design.
