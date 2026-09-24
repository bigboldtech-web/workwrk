# WorkwrK design system (definitive)

Version 1.0, 2026-09-11. Synthesised from the judged panel: base = "Zoho-clean" (winner under all three lenses, combined 181), with every graft the judges flagged from "Quiet precision", "Warm clarity" and "Signature four dots" folded in and every conflict resolved explicitly (section 0.3). Designed against `phase2-inputs.md` (hard constraints), `design-references.md` (verified contrast values, reused unchanged and marked (v)), `existing-direction.md` (what the product already does), and the founder-endorsed `zoho-reference.md` plus `zoho-ref-1.jpg` / `zoho-ref-2.jpg`, which is the newest signal and is weighted as such.

Every value new to this document (not in the briefs) was recomputed this session with the WCAG 2.x relative-luminance formula and is also marked (v). Line numbers cite `src/app/(dashboard)/os.css` at commit `21a21623` (34,235 lines, 155 `!important` declarations, 10 `data-accent` blocks), checked this session.

One-liner: **a navy frame, a white page, one blue button, four dots.**

---

## 0. Principles: the simplicity rules every screen obeys

These are testable. A screen that breaks one is wrong, not "a different style".

1. **One blue thing per page.** `#0073EA` appears on a page exactly as: the single Create button in the toolbar, links, focus rings, checked controls, toggles on, progress fill, the active view-type icon, and the selected-row wash. Never on the chrome (it cannot: `#0073EA` on navy `#1B2537` is 3.40:1 (v), which fails), never on headers, tabs, group bars, icons at rest or illustrations.
2. **The frame is not the work.** Rail and top bar are navy (or, in the light flip, white); everything the user acts on sits on a white canvas inside a bordered card. The only saturated object in the chrome is the four-dot logo. The active hub is a white pill on navy, the brightest thing in the frame, so "where am I" needs no training.
3. **One page pattern.** Title row, then saved views as text-tab pills, then one toolbar (Filter, Sort, view switcher left; the one blue Create right). Boards, Lists, Docs, Tables, People, SOPs, Goals: same stack, no exceptions, so a user who has learned one list page has learned them all.
4. **Records, not spreadsheets.** Data lives in a white card with a hairline-row table, a visible checkbox column at comfortable density, an inline header filter, a pinned column-settings icon and a footer that says "Total records 644 · 1 to 40". That is the mental model an SMB user already has from Zoho, Excel and their bank.
5. **One rhythm per surface, and a height budget inside it.** Navigation rows are 36. Data rows are one of 44 / 36 / 32 by preference. Nothing inside a row is taller than the row minus 12 (44 carries at most a 28px element; 36 carries 24; 32 carries 20). Two-line content goes to the drawer.
6. **Weight and grey before size.** Page 22, rows 15, body 14, meta 12/13. Emphasis is 500 weight; de-emphasis is `--os-ink-2`. Never 700 in the product. A page shows at most three sizes at once.
7. **Colour never travels alone, and Y/R/G reach components only as meaning.** The only yellow, red and green variables that exist are `--os-success-*`, `--os-warning-*`, `--os-danger-*` plus the presence and attention dots. Every semantic colour sits beside a word or a glyph. Status chips are pale by default.
8. **Progressive disclosure with a named door.** Four task fields visible by default (Status, Assignee, Due date, Priority), "+ Add field" reveals the rest. Display options live in the toolbar "…" menu. Whole capabilities are off per org (Settings › Modules). Unbuilt options hide behind "Show upcoming features".
9. **Detail opens beside the list.** Tasks, rows and people open in a 520px drawer with the page's own URL; the list dims to 92% and stays scrollable; Expand animates the drawer into the full page in place. Docs, SOPs, goals and reviews are pages.
10. **Feedback is quiet, reversible and visible when it matters.** Neutral toast bottom-left with one Undo. Never a green banner. But saving is never silent: the autosave dot pulses while saving, turns green on saved, and turns red with the words "Not saved, retrying" on failure.
11. **Empty is quiet.** A grey four-dot line drawing, one sentence, at most one text link. The page's blue button stays the only primary. No second CTA, no mascots, no five coloured empty groups.
12. **Icons carry words.** Rail icons are labelled. Icon-only buttons carry a tooltip and `aria-label`. At most two icons per row. Lucide, 1.5px, 20px in the chrome and 16px in content, one icon per concept app-wide.

### 0.1 What changes versus today (delta list)

| Area | Today (`21a21623`) | This system |
|---|---|---|
| Rail | 60px, `var(--os-brand-rail)` navy painted inline, `rounded-xl` floating card, white active pill, optional icons-only | 64px, flush (no radius, no floating card), `--os-chrome-bg` navy `#1B2537`, 40px white pill + label, icons-only removed, four-dot logo at top is the route loader |
| Top bar | 32px, three floating rounded cards on a zinc-100 ground, quick-tool icon row, workspace switcher left | 48px, one navy row: ‹ › + hierarchy breadcrumb, 400px search field, "+" / bell / help / avatar. No blue button on the bar. Workspace switcher moves to the sidebar header |
| Secondary sidebar | 260px, `h-7` (28px) tree rows, blue-tinted active (`.os-side__item.is-active` at os.css:457 uses `--os-brand-soft` + `--os-brand` and scales the icon 1.06) | 264px N50, 36px rows, 15px labels, N200 pill active (no blue, no transform), uppercase-with-rule section labels, hub search only when the tree exceeds 12 rows |
| Page header | title 40 + tabs 34 + filter 34 = 108 under a 32 top bar (140 total); ClickUp location bar; underline view tabs with coloured icons | title 48 + views 36 + toolbar 44 = 128 under a 48 top bar (176 total on a multi-view list page; 140 when the views row collapses; 96 on doc pages); location lives in the breadcrumb; text-tab pill views; one blue Create in the toolbar |
| Tables | edge-to-edge, 28px rows, 13px type, dark floating bulk bar, solid status-pill group headers | bordered white card, 44/36/32 rows, 15px cells, checkbox column, inline header filter, pinned column settings, footer totals + pagination, white bulk bar, plain 15/500 group headers |
| Filters | popovers + a filter bar row | 272px Filter side panel inside the content; the table narrows |
| Type | Figtree, 14 arbitrary `text-[Npx]` sizes in 356 files, half-pixels, seven families loaded | Inter + JetBrains Mono, nine sizes, `@theme` utilities, arbitrary sizes lint-blocked |
| Colour | monday greys (`#323338/#676879`), `--os-c-*` monday status palette, 11 accents (4 purple-family), taupe, shadcn tokens, bento lime, 147 `!important` dark repaints | cool slate ramp, semantic trio only, one blue, navy/light chrome attribute, dark = token rebinding, everything else deleted |
| Status | solid pills everywhere | pale chip + 6px dot + word; solid column is an opt-in Display option on Board table view and Tables |
| Empty states | `OsEmptyView` with CTA, plus a dead `ui/empty-state.tsx` | quiet four-dot line art (row / 2×2 / cluster / stack by context) + one sentence + at most one text link; `ui/empty-state.tsx` deleted |
| Loader | 1.6s navy splash on every open and every 10 minutes; ~41 in-page `ValueLoader` dot captions | splash first open per day and after login, 1.2s, skippable; route loader = the rail logo dots pulsing after 200ms; in-content = skeletons + one non-blocking value line, no dots |
| Detail | drawer and `/item/[id]` page, page-first | drawer-first with the page's URL; 92% list dim; Expand animates in place |
| Autosave | `AutosaveIndicator` exists, states unspecified | saving / saved / failed dot contract on docs, notes, canvas, tables |
| Density | `--os-row-h` 28, globals 44/32, pref compact/cozy | Comfortable 44 (default) / Cozy 36 / Compact 32 for data rows; nav fixed at 36; Tables defaults to Compact |
| Settings | two doors (Admin, `/account/*`) | one takeover, groups You / Workspace / Governance / Billing & plan, "← Back to app" ghost button in its own 48px bar |
| Motion | 300ms `.animate-fade-in`, 380ms splash fade, `active:translate-y-px` | 120 / 160 / 220 / 240ms, nothing above 250, no transforms on hovered or pressed elements |

### 0.2 Grafts adopted from the non-winning proposals (and where they land)

| From | Graft | Section |
|---|---|---|
| Signature dots | `--os-dot-y/b/r/g` quarantine enforced by ESLint + stylelint + raw-hex lint | 1.6, 8.4 |
| Signature dots | `saving` dot state for `AutosaveIndicator` | 5.17 |
| Signature dots | `quad-steps` / `steps-n` discrete progress glyph (steps only, never empty states) | 5.16 |
| Signature dots | rule: brand dots and semantic solids never rebind in dark | 1.5 |
| Signature dots | `@theme` size mapping + lint on `text-[Npx]`; route loader after 200ms; splash skippable; `DotsLoader` loses its box-shadow | 2.4, 5.15 |
| Signature dots | one `Dots` component for unread / presence / live / saving / steps / grip / canvas grid | 5.16 |
| Signature dots | stored `data-accent` → `blue`, stored `iconsOnly` → false in the PR that deletes the picker | 8.5 |
| Quiet precision | line-numbered `os.css` re-point table as the engineering checklist | 8.1 |
| Quiet precision | task-drawer field budget (4 visible, "+ Add field") | 5.5 |
| Quiet precision | ⌘1..8 hub jumps, 3px focus halo on inputs, 0ms tooltip delay between adjacent icon buttons, `[data-contrast="high"]` block | 4.7, 5.11, 5.13, 1.5 |
| Quiet precision | row content-height budget | 3.2 |
| Quiet precision | "Ask AI" slot entitlement-gated; Settings "← Back to app" in its own bar | 4.4, 4.6 |
| Quiet precision | `--os-danger-border` component token for the Danger zone card | 1.3, 5.4 |
| Quiet precision | tighter header stack (48 / 36 / 44) and hover-only checkboxes at 36 / 32 density | 4.4, 5.1 |
| Quiet precision | Tailwind `@theme` alias utilities + ESLint `no-restricted-syntax` on `zinc-|slate-|gray-|neutral-|#hex` in `className` | 8.3, 8.4 |
| Quiet precision | OKLCH chroma cap (L 55 to 62, C 0.03 to 0.05) as the rule for any future user hue | 1.7 |
| Warm clarity | three-tier density preference | 3.2 |
| Warm clarity | the eight user-status hues with zero purple-adjacent entries (plum and indigo-grey removed) | 1.7 |
| Warm clarity | empty-state illustration family by context | 5.8 |
| Warm clarity | drawer motion: 92% list dim, no scrim, Expand animates in place (240ms) | 4.5, 6 |
| Warm clarity | segmented control primitive | 5.12 |
| Warm clarity + Quiet precision | toasts shift left of the mounted call dock; inline "Saved" tick fades after 2s | 5.7, 5.4 |
| Warm clarity | keep the 147 `!important` repaints during migration but retarget their values to tokens | 8.5 |
| Warm clarity | picker search input hidden under 6 items | 5.6 |
| Warm clarity (via the employee lens) | route loader lives in the rail logo, not in content | 5.15 |
| Lead engineer deduction | toolbar has no bottom border; views row collapses when a surface has one view | 4.4 |
| Employee lens | per-hub sidebar search rendered only when the tree exceeds about 12 rows | 4.2 |
| Lead engineer | 15px row size applied through a scoped `.os-row` container class so the codemod stays mechanical | 2.3 |

### 0.3 Conflicts resolved

| Conflict | Resolution | Why |
|---|---|---|
| Default data row 44 (Zoho-clean, employee lens) vs 36 (two grafts label 36 "Default") | Three tiers: **Comfortable 44 is the shipped default** for Boards, Lists, People, Docs lists; **Cozy 36**; **Compact 32**. Tables module defaults to Compact. Org admin can set the org default; user can override unless locked. | 44 is the Zoho reading the founder endorsed and the tall-row calm the employee lens scored highest; 32 protects power users and honours the stored `compact` preference. Open decision 2 lets the founder flip the default. |
| Header stack 56/36/48 (winner) vs 48/48/36 (quiet) vs 44/48/36 (employee) | **Top bar 48, title 48, views 36, toolbar 44** (128 content stack). Toolbar carries no bottom border; the card starts 8px below it. The views row does not render when a surface has exactly one view and no "+ View" affordance, and never on doc, settings, people-detail or goal pages. | Keeps Zoho's row order and the text-tab pills, shrinks the vertical budget to what the quiet proposal proved fits, and matches today's 140 total on single-view pages. |
| Route loader: 3px progress line + in-content dots (winner) vs rail logo pulse (warm) vs 200ms delay (dots) | **Rail logo pulse after 200ms + content skeletons.** No progress line, no in-content four dots. The rotating value is one 13px `--os-ink-2` line under the first skeleton, no dots. | YBRG stays in exactly one chrome location; two simultaneous loaders is what "busy" looks like. |
| Empty state: quiet illustration + text link (winner) vs illustration + primary button (brief, quiet, warm) vs hollow/filled grammar (dots) | **Winner's quiet template with warm clarity's illustration family.** No filled dot, no second blue button. | "One blue thing per page" is the rule that makes Create findable; a second primary in the empty state breaks it. The hollow/filled grammar is new meaning; it survives only on step glyphs, where the step words disambiguate it. |
| Status carrier: pale chip + dot + word (winner, warm, dots) vs 14px ring glyph (quiet) | **Pale chip + 6px dot + word.** | The ring is a learned vocabulary; a services-firm employee should not need to learn it. |
| Priority glyph: `Flag` (winner, warm, dots, existing icon map) vs four bars (quiet) | **`Flag`**, urgent `--os-danger-text`, high `--os-ink` filled, normal `--os-ink-2` outline, low `--os-ink-3` outline. | The existing icon map already uses `Flag`; bars would be a second new vocabulary. |
| Solid hover on dark: `#0062CC` in both themes (winner) vs lighter `#1A82F0` (quiet, dots) | **`#0062CC` in both themes.** | `#0062CC` with white is 5.80:1 (v); `#1A82F0` with white was not verified and is unlikely to pass. |
| Solid status column: keep as the one exception (winner, brief, dots) vs pale everywhere (warm) | **Keep the exception, but off by default.** "Solid status column" is a Display option in the toolbar "…" menu on Board table view and Tables. | Default screenshots stay pale (not monday); dense scanners keep the option without a token change. |
| User hue set: winner's eight (with plum and indigo-grey) vs warm clarity's eight vs signature dots' eight (which reuse semantic solids) | **Warm clarity's eight** (sky, teal, moss, sand, clay, rose, slate, stone), plus the quiet proposal's chroma-cap rule for any future addition, plus dark-mode values computed this session. | Zero purple-adjacent entries; none coincides with a semantic solid, so a user hue can never read as done / at risk / blocked. |
| Sidebar search: per-hub field always (winner) vs top bar only (quiet) | **Per-hub field renders only when the tree exceeds 12 rows.** | Small orgs never see two search boxes. |
| Chrome default navy, light flip as follow-up (founder lens) vs both required (task) | **Both fully tokenised in the same CSS PR; navy ships first; the Preferences toggle for the light flip is exposed after the navy QA pass.** | Four chrome-by-theme combinations are QA'd one at a time. |
| Rail active pill blue-50 (brief, warm, dots) vs grey (quiet) vs white-on-navy (winner) | **White pill on navy; N200 pill in the light flip.** `--os-chrome-pill` is the single token that decides it. | The founder pointed at the white pill; blue cannot sit on navy; the grey pill is the quiet proposal's own admitted risk. |
| Table header 44 (winner) vs 32 (quiet, dots) | **Header row equals the data row height at Comfortable (44) and is 36 at Cozy and Compact.** | One rhythm per surface. |

---

## 1. Colour

### 1.1 Layer 1: primitives (never referenced by components)

Generated in OKLCH so equal-lightness steps look equal; the hex values are the sRGB output and are what ships.

**Neutrals (cool slate, LCH chroma 2 to 4), from the brief, verified there:**

| Name | Hex | Notes |
|---|---|---|
| N0 | `#FFFFFF` | |
| N50 | `#F6F7F9` | |
| N100 | `#EEF0F3` | |
| N200 | `#E4E7EC` | |
| N300 | `#D0D5DD` | |
| N400 | `#98A2B3` | 2.58:1 on white (v): decoration only, never text |
| N500 | `#667085` | 4.97:1 white, 4.64:1 N50, 4.36:1 N100, **4.01:1 on N200 (v): never text on the N200 pill** |
| N600 | `#475467` | 7.69:1 white, 7.17:1 N50, 6.73:1 N100, 6.20:1 N200 (v) |
| N700 | `#344054` | 9.76:1 N50, 8.44:1 N200 (v) |
| N800 | `#1F2430` | 15.52:1 white, 14.48:1 N50, 13.59:1 N100, 12.52:1 N200 (v) |
| N900 | `#101215` | dark base |

**Navy (chrome only), same hue family as N800:**

| Name | Hex | Notes |
|---|---|---|
| NV900 | `#1B2537` | rail + top bar. White on it 15.37:1 (v) |
| NV800 | `#242F44` | hover on navy rows; white on it 13.42:1 (v) |
| NV950 | `#0C0F14` | the chrome in dark mode; `#E6E8EC` on it 15.65:1 (v) |

**Blue (the only accent), from the brief, verified there:**

| Name | Hex | Role |
|---|---|---|
| blue-50 | `#EAF3FE` | selection wash, info wash |
| blue-100 | `#D4E7FD` | selected + hover |
| blue-200 | `#A9CFFB` | input focus halo |
| blue-400 | `#4D9CFF` | accent text on dark: 6.71:1 on `#101215`, 6.18:1 on `#181B20` (v) |
| blue-600 | `#0073EA` | solid: white text 4.53:1 (v), labels 14px+/500 |
| blue-650 | `#0062CC` | solid hover, 5.80:1 (v); the one hover value in app and marketing |
| blue-700 | `#0B5FC2` | links and accent text on light: 6.12:1 white, 5.71:1 N50, 5.47:1 blue-50 (v) |
| blue-800 | `#0A4C9B` | pressed, 8.33:1 with white (v) |

**Green, yellow and red scales exist in the generator only.** They are not emitted as CSS variables. The only Y/R/G variables in `os.css` are the semantic ones below plus the presence and attention dots. There is nothing else to reach for; that is how the rule is enforced.

**Brand dots** (fixed, full saturation): Y `#FFCB00`, B `#0073EA`, R `#FF3D57`, G `#00C875`, emitted as `--os-dot-y/b/r/g`. On NV900 they measure Y 10.10:1, G 6.97:1, R 4.43:1, B 3.40:1 (v); on `#101215` Y 12.32:1, G 8.50:1, R 5.41:1, B 4.15:1 (v). All clear the 3:1 non-text bar, the only bar a logo glyph needs. They never rebind (1.5) and are quarantined (1.6).

### 1.2 Layer 2: semantic aliases (what components use)

Existing `--os-*` names are kept wherever a concept already exists so the 163 tokenised files keep working; new names only where the concept is new. LIGHT is the default; DARK is a rebinding of this layer only.

| Semantic | CSS variable | Light | Dark | Notes |
|---|---|---|---|---|
| bg.app | `--os-canvas` | `#FFFFFF` | `#101215` | page ground |
| bg.raised | `--os-surface` | `#FFFFFF` | `#181B20` | cards, table card, popovers, modals, drawer |
| bg.subtle | `--os-surface-1` | `#F6F7F9` | `#15181D` | secondary sidebar, table header, section bands |
| bg.hover | `--os-surface-hov` | `#EEF0F3` | `#1F232A` | row and menu hover |
| bg.active | `--os-surface-2` | `#E4E7EC` | `#262A31` | sidebar active pill, text-tab active pill, pressed ghost |
| bg.selected | `--os-selected` | `#EAF3FE` | `rgba(0,115,234,.14)` | selected row; N800 on it 13.86:1 (v) |
| bg.selected-hover | `--os-selected-hov` | `#D4E7FD` | `rgba(0,115,234,.22)` | |
| bg.scrim | `--os-scrim` | `rgba(16,18,21,.40)` | `rgba(0,0,0,.60)` | modal backdrop only (drawers dim, they do not scrim) |
| bg.inverse | `--os-inverse-bg` | `#1F2430` | `#E6E8EC` | tooltips, kbd on tooltips |
| border.subtle | `--os-line-soft` | `#EEF0F3` | `#1F232A` | hairline rows inside tables |
| border.default | `--os-line` | `#E4E7EC` | `#262A31` | card edges, dividers, top-bar bottom in the light flip |
| border.strong | `--os-line-strong` | `#D0D5DD` | `#30353D` | inputs, checkboxes at rest, secondary buttons |
| text.primary | `--os-ink` | `#1F2430` | `#E6E8EC` | |
| text.secondary | `--os-ink-2` | `#667085` | `#9AA3B2` | never on N200 / the active pill |
| text.strong | `--os-ink-strong` (new) | `#475467` | `#B4BBC7` | counts on the active pill, metadata columns, rail labels in the light flip |
| text.tertiary | `--os-ink-3` | `#98A2B3` | `#6B7280` | placeholder, decoration only |
| text.disabled | `--os-ink-4` | `#D0D5DD` | `#3A3F47` | |
| text.inverse | `--os-ink-inv` (new) | `#FFFFFF` | `#FFFFFF` | on solid buttons |
| text.on-inverse | `--os-inverse-fg` (new) | `#FFFFFF` | `#101215` | on tooltips |
| text.link / accent.text | `--os-brand-deep` (alias `--os-brand-ink`) | `#0B5FC2` | `#4D9CFF` | links, accent text, active view-type icon |
| accent.solid | `--os-brand` | `#0073EA` | `#0073EA` | ONE per page |
| accent.solid-hover | `--os-brand-hover` | `#0062CC` | `#0062CC` | |
| accent.solid-pressed | `--os-brand-pressed` (new) | `#0A4C9B` | `#0A4C9B` | |
| accent.bg | `--os-brand-soft` | `#EAF3FE` | `rgba(0,115,234,.14)` | info wash, active view-type icon background |
| focus.ring | `--os-focus` (new) | `#0073EA` | `#4D9CFF` | 2px ring, 2px offset, `:focus-visible` only |
| focus.halo | `--os-focus-halo` (new) | `#A9CFFB` | `rgba(77,156,255,.35)` | 3px box-shadow on focused inputs, alongside the ring |
| success.bg | `--os-success-bg` | `#ECFDF3` | `#0F2A1A` | |
| success.text | `--os-success-text` | `#15803D` | `#4ADE80` | 4.76:1 light, 8.82:1 dark (v) |
| success.solid | `--os-success-solid` | `#15803D` | `#15803D` | white text 5.02:1 (v); never rebinds |
| warning.bg | `--os-warning-bg` | `#FFFAEB` | `#2A2208` | |
| warning.text | `--os-warning-text` | `#854D0E` | `#FCD34D` | 6.57:1 light, 10.94:1 dark (v) |
| warning.solid | `--os-warning-solid` | `#FACC15` | `#FACC15` | N800 text only, 10.1:1 (v); yellow never carries white; never rebinds |
| danger.bg | `--os-danger-bg` | `#FEF3F2` | `#2C1212` | |
| danger.text | `--os-danger-text` | `#B42318` | `#F87171` | 6.05:1 light, 6.31:1 dark (v) |
| danger.solid | `--os-danger-solid` | `#D92D20` | `#D92D20` | white text 4.83:1 (v); replaces `#E2445C`; never rebinds |
| info.bg / info.text | `--os-brand-soft` / `--os-brand-deep` | as accent | as accent | 5.47:1 (v) |
| neutral.status bg / text | `--os-surface-hov` / `--os-ink-strong` | N100 / N600 | `#1F232A` / `#B4BBC7` | not started, none; 6.73:1 (v) |
| presence.online | `--os-presence` | `#15803D` | `#4ADE80` | 8px dot on avatars on the canvas |
| attention.dot | `--os-attention` | `#D92D20` | `#F87171` | 6px unread dot on the canvas |

### 1.2.1 Chrome tokens (the layer that flips between navy and light)

The rail and the top bar read ONLY these tokens; nothing else in the app reads them. Keyed on `html[data-chrome="navy|light"]`, written by `ThemeApplier` next to the `data-theme` and `data-density` attributes it already writes. Default `navy`. All four cells are fully specified so dark-mode QA is enumerable.

| Chrome | CSS variable | Navy · light theme | Navy · dark theme | Light flip · light theme | Light flip · dark theme |
|---|---|---|---|---|---|
| chrome.bg | `--os-chrome-bg` | `#1B2537` | `#0C0F14` | `#FFFFFF` | `#181B20` |
| chrome.bg-hover | `--os-chrome-hov` | `#242F44` | `#161A21` | `#EEF0F3` | `#1F232A` |
| chrome.fg | `--os-chrome-fg` | `#FFFFFF` (15.37:1 (v)) | `#E6E8EC` (15.65:1 (v)) | `#1F2430` | `#E6E8EC` |
| chrome.fg-muted | `--os-chrome-fg-2` | `#A3AEC2` (6.87:1, 6.00:1 on hover (v)) | `#8E9BB3` (6.85:1 (v)) | `#475467` (7.69:1 (v)) | `#9AA3B2` |
| chrome.line | `--os-chrome-line` | `rgba(255,255,255,.12)` | `rgba(255,255,255,.08)` | `#E4E7EC` | `#262A31` |
| chrome.pill.bg (active) | `--os-chrome-pill` | `#FFFFFF` | `#262A31` | `#E4E7EC` | `#262A31` |
| chrome.pill.fg (active) | `--os-chrome-pill-fg` | `#1B2537` (15.37:1 (v)) | `#FFFFFF` (11.74:1 (v)) | `#1F2430` (12.52:1 (v)) | `#FFFFFF` |
| chrome.field.bg | `--os-chrome-field` | `rgba(255,255,255,.10)` | `rgba(255,255,255,.06)` | `#F6F7F9` | `#15181D` |
| chrome.field.fg | `--os-chrome-field-fg` | `#FFFFFF` | `#E6E8EC` | `#1F2430` | `#E6E8EC` |
| chrome.field.placeholder | `--os-chrome-field-ph` | `rgba(255,255,255,.64)` (7.14:1 (v)) | `rgba(255,255,255,.50)` | `#98A2B3` | `#6B7280` |
| chrome.presence | `--os-chrome-presence` | `#4ADE80` (8.82:1 (v); `#15803D` would be 3.06:1) | `#4ADE80` | `#15803D` | `#4ADE80` |
| chrome.attention | `--os-chrome-attention` | `#F87171` (5.56:1 (v)) | `#F87171` | `#D92D20` | `#F87171` |
| side.bg | `--os-side-bg` | `#F6F7F9` | `#15181D` | `#F6F7F9` | `#15181D` |
| side.pill (active) | `--os-side-pill` | `#E4E7EC` | `#262A31` | `#E4E7EC` | `#262A31` |

The secondary sidebar is grey in BOTH variants; it belongs to the canvas side of the frame, not the chrome. Presence and attention dots on the chrome read the chrome tokens (the lifted values), never `--os-presence` / `--os-attention`, because the canvas values fail on navy.

### 1.3 Layer 3: component tokens (sparse)

| Token | Light | Dark | Consumer |
|---|---|---|---|
| `--os-chip-h` | 24px | | Chip / StatusChip |
| `--os-table-head-bg` | `var(--os-surface-1)` | | table card header row |
| `--os-table-row-line` | `var(--os-line-soft)` | | hairline between rows |
| `--os-widget-head-bg` | `#EEF3FB` | `#171C26` | pale-blue header strip on Home widgets (Zoho ref 2); the only tinted band in the product. `--os-ink` on it 13.93:1 (v); `--os-ink-2` on it 4.47:1 (v) so **no secondary text on the strip**, icons only |
| `--os-rail-pill-size` | 40px | | rail active pill |
| `--os-danger-border` | `#F3B6B0` | `#5A2424` | Danger zone card border (a full-strength `--os-danger-solid` border is louder than a bordered-card system wants; the card title in `--os-danger-text` carries the meaning) |
| `--os-dot-y/b/r/g` | brand hexes | same | `src/components/brand/**`, `src/app/(marketing)/**` only |
| `--os-status-user-1..8` (+ `-dark`) | 1.7 | 1.7 | user-defined List status colours (data, not chrome) |
| `--os-kbd-bg` | `#EEF0F3` | `#262A31` | kbd |
| `--os-skeleton` | `#EEF0F3` | `#1F232A` | skeleton bars |
| `--os-stage-{bg,surface,surface-2,line,fg,fg-2}` | fixed | **same** | the call stage set, added in Phase 4 at the request of `spec-talk.md` section 3 |

**The stage set** (`.os-stage`), added Phase 4. Video tiles read badly on
white, so a call stage is dark in both themes. Dark rebinds AT THE ROOT only
(1.5), so `data-theme="dark"` on a `div` does nothing; these six values are
therefore fixed and never rebind, exactly like the semantic solids and the
brand dots. `--os-danger-solid` (Leave) and `--os-brand` (the one primary)
are already fixed in both themes and are used inside `.os-stage` unchanged;
nothing else in there reads a theme token, so the stage needs no dark-mode
QA pass.

| Token | Value (fixed) | Use |
|---|---|---|
| `--os-stage-bg` | `#101215` | the stage ground behind the tiles |
| `--os-stage-surface` | `#181B20` | the control bar, name chips, the roster sheet |
| `--os-stage-surface-2` | `#262A31` | a pressed or active control |
| `--os-stage-line` | `#30353D` | tile and control-bar edges |
| `--os-stage-fg` | `#E6E8EC` | names, labels, icons (15.1:1 on the ground) |
| `--os-stage-fg-2` | `#9AA3B2` | secondary labels |

The one definition lives in `src/app/globals.css`, not in
`src/app/(dashboard)/tokens.css`: `.os-stage` is worn by the call stage
inside the app AND by the public guest call page at `/meet/[code]`, which is
in the `(public)` segment and loads neither `tokens.css` nor `os.css`.
`globals.css` is loaded by the root layout on every route, so one
definition reaches both.

### 1.4 Rules that make the palette hold

1. Blue on the white canvas only as: the one Create button per page, links, focus, checked controls, toggles on, progress, the active view-type icon, selected rows. Never on the chrome, never on headers, tabs, group bars, icons at rest or illustrations.
2. On navy the accent is white (active pill, active icon, active label). Blue is structurally impossible there (3.40:1 (v)), which keeps the rule self-enforcing.
3. Y/R/G reach components only as `--os-success-*`, `--os-warning-*`, `--os-danger-*`, `--os-presence`, `--os-attention`, `--os-chrome-presence`, `--os-chrome-attention`. No generic yellow, red or green variable exists.
4. Colour never travels alone: every semantic colour is paired with a word or a glyph.
5. Status chips are pale by default. The solid form exists on one surface (the status column of Board table view and Tables) and only when the Display option "Solid status column" is on; then the whole column is solid.
6. Brand dots and semantic tokens never mix: `#00C875` never in a Done chip, `#15803D` never in the logo.
7. No hue-keyed Spaces, Folders or groups by default; `EntityTile` renders neutral (N100 tile, N600 glyph). User colour is opt-in from the eight in 1.7.
8. Charts use the dataviz skill's brand-neutral palette; the semantic trio appears in a chart only when a series genuinely means success / warning / danger.
9. No text in `--os-ink-2` on N200 (the active sidebar pill) or on the widget header strip; use `--os-ink-strong` or `--os-ink`.

### 1.5 Dark-mode strategy

- Dark is a rebinding of layer 2 plus the chrome table under `:root.dark .workwrk-os` (the class `ThemeApplier` already toggles) and `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) ... }` for the system preference. `ThemeApplier` writes `data-theme="light|dark"`, so the `not([data-theme="light"])` guard is the correct one (a `:root:not(.light)` selector would target a class that is never written). Zero component-level colour literals; zero `!important` utility repaints once the sweep lands (8.5).
- Elevation in dark = lighter surface, not shadow: `#101215` base → `#181B20` raised → `#1F232A` second level → `#262A31` active. Borders `#262A31` / `#30353D`, deliberately faint (1.52:1 (v), structure felt not seen).
- Solid buttons keep `#0073EA` (white 4.53:1 (v)); accent text lifts to `#4D9CFF`. Never blue-700 on dark.
- **Brand dots (`--os-dot-*`) and the semantic solids (`#15803D`, `#FACC15` with N800, `#D92D20`) do not rebind in dark mode.** Their fixed foregrounds pass on any surface, so the solid status column and the logo need no dark-mode QA. Everything else rebinds.
- The navy chrome goes to `#0C0F14` in dark so the frame is still darker than the page; the active pill becomes `#262A31` with white text (a white pill on near-black glares). If the frame reads as absent in review, the fallback is chrome `#0A0D12` with sidebar `#13161B`.
- High contrast is a `[data-contrast="high"]` variable block, not a third theme: it raises `--os-ink-2` to `#B8C0CC` and `--os-line` to `#3A3F47` in dark, `--os-ink-2` to `#475467` and `--os-line` to `#D0D5DD` in light, and `--os-brand-deep` to `#7AB8FF` in dark.
- Light first. Marketing is light only.

### 1.6 The brand-dot quarantine (enforced)

- `--os-dot-y`, `--os-dot-b`, `--os-dot-r`, `--os-dot-g` may be referenced only under `src/components/brand/**` and `src/app/(marketing)/**`. Consumers: `Logo`, `DotsLoader` (route pulse and splash), marketing connectors.
- ESLint `no-restricted-syntax` on any string literal or template containing `--os-dot-` outside those two globs.
- stylelint `declaration-property-value-disallowed-list` blocking `var(--os-dot-` in every stylesheet outside `src/components/brand/`.
- Raw hex (`#[0-9a-fA-F]{3,8}`) in `src/components/**` and `src/app/(dashboard)/**` `.tsx` is a lint error after the sweep; `src/components/brand/**` is the only exception.
- Without these three rules the YBRG rainbow returns through a hundred small decisions; the lint is part of the system, not a nicety.

### 1.7 User-defined status and icon colours (data, not chrome)

Per-List statuses and opt-in Space/Folder icons keep a user-chosen colour from exactly eight muted hues. None of the eight is a semantic solid, none is purple-adjacent, and all pass as text on their pale background and as a solid with white text. Light values from warm clarity; dark values chosen and verified this session.

| # | Name | Light hue (text and dot) | Pale bg light (hue at 12% over white) | Text on pale / text on white / white on solid (v) | Dark hue (dot) | Pale bg dark (hue at 18% over `#181B20`) | Dark dot on raised / on base (v) |
|---|---|---|---|---|---|---|---|
| 1 | Sky | `#0B5FC2` | `#E2ECF8` | 5.13 / 6.12 / 6.12 | `#4D9CFF` | `#223248` | 6.18 / 6.71 |
| 2 | Teal | `#0F766E` | `#E2EFEE` | 4.64 / 5.47 / 5.47 | `#5EEAD4` | `#254040` | 11.67 / 12.68 |
| 3 | Moss | `#3F6212` | `#E8ECE3` | 5.91 / 7.08 / 7.08 | `#A6C97A` | `#323A30` | 9.25 / 10.06 |
| 4 | Sand | `#854D0E` | `#F0EAE2` | 5.73 / 6.85 / 6.85 | `#D9A85A` | `#3B342A` | 7.97 / 8.66 |
| 5 | Clay | `#9A3412` | `#F3E7E3` | 6.04 / 7.31 / 7.31 | `#E8916A` | `#3D302D` | 7.14 / 7.76 |
| 6 | Rose | `#9F1239` | `#F3E3E7` | 6.47 / 8.02 / 8.02 | `#F07A9A` | `#3F2C36` | 6.54 / 7.11 |
| 7 | Slate | `#475569` | `#E9EBED` | 6.34 / 7.58 / 7.58 | `#A3ADBF` | `#31353D` | 7.63 / 8.30 |
| 8 | Stone | `#57534E` | `#EBEAEA` | 6.35 / 7.63 / 7.63 | `#B5B0AA` | `#343639` | 8.02 / 8.71 |

Rendering rule: pale chip = pale bg + hue text + 6px hue dot (light); in dark the chip word is `--os-ink` (`#E6E8EC`, 9.08:1 or better on every dark pale (v)) and only the dot carries the hue. Solid cell (opt-in column) = light hue fill with white text. Emitted as `--os-status-user-1..8` and `--os-status-user-1..8-dark`; the picker stores the index, not the hex. Any future addition must sit at OKLCH L 55 to 62, C 0.03 to 0.05 and outside hue bands 130 to 160 (green), 80 to 100 (yellow), 20 to 40 (red) and 280 to 330 (purple).

Migration: stored monday hexes (`--os-c-*` values) are remapped to the nearest of the eight by hue with a dry-run report before the write; `--os-c-purple/pink/indigo/lime` map to Sky / Rose / Sky / Moss.

---

## 2. Type

### 2.1 Family

**Inter** (variable, `next/font/google`, `weight: ['400','500','600']`, `display: 'swap'`, self-hosted by `next/font`; never a Google Fonts `<link>` in the app). Fallback: `Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`. Inter covers Latin, Cyrillic and Greek; `ar`, `he` and CJK fall to the system face, which is acceptable because the scale is family-independent. Mono: **JetBrains Mono** (already loaded) for code, formulas, IDs. Dropped from the root layout: Outfit, Syne, Geist, Geist Mono, Instrument Serif, Figtree. Letter-spacing 0 everywhere except uppercase section labels (+0.06em). `font-feature-settings: "tnum"` on tables and numeric columns. `-webkit-font-smoothing: antialiased` inside `.workwrk-os` on macOS only.

### 2.2 Scale (px / weight / line-height). 14px base, floor 10, half-pixel sizes banned.

| Token | Size / weight / lh | Tailwind utility | Use |
|---|---|---|---|
| `--os-t-rail` | 10 / 500 / 12 | `text-rail` | rail labels only |
| `--os-t-micro` | 11 / 600 / 14, uppercase, +0.06em | `text-micro` | sidebar section labels, Tables letter headers |
| `--os-t-meta` | 12 / 500 / 16 | `text-xs` | chips, counts, timestamps, middle breadcrumb crumbs, kbd |
| `--os-t-helper` | 13 / 400 / 18 | `text-sm` | helper, secondary lines, toast second line, table header labels (500) |
| `--os-t-body` | 14 / 400 / 20 | `text-base` | body, forms, menus, pickers, modals, buttons, breadcrumb |
| `--os-t-row` | 15 / 400 / 22 | `text-row` | table cells, list rows, sidebar rows, view-tab labels, filter-panel rows |
| `--os-t-row-strong` | 15 / 500 / 22 | `text-row font-medium` | first (title) column, active sidebar row, active view tab |
| `--os-t-title` | 16 / 600 / 22 | `text-lg` | section, modal, card, drawer, filter-panel titles |
| `--os-t-page` | 22 / 600 / 28 | `text-xl` | page title |

Marketing only: display 48 to 72 / 600 / 1.05 on white. Doc editor body: 15 / 400 / 24 in a 720 column (`--os-t-prose`), the reading exception.

### 2.3 Where 15 applies (the scoped rule)

15px row type and 14px body type are two reading sizes; mixing them inside one table is the failure mode. The rule is structural, not judged per file: the containers `TableCard`, the secondary sidebar tree, the views row and `FilterPanel` carry a `.os-row` class that sets `font-size: var(--os-t-row)`; their children inherit and never set a size. Everything outside those containers is 14. The codemod (8.2) therefore maps `13.5/14/14.5 → text-base` everywhere and lets `.os-row` do the promotion.

### 2.4 Hierarchy rule and enforcement

Weight and grey before size. A page has at most three sizes on screen at once (page title 18, rows 15, meta 12/13). Emphasis = 500; de-emphasis = `--os-ink-2`. 600 is the ceiling; never 700 in product UI. Never colour as emphasis except links. Tailwind `@theme` maps exactly: `text-xs` 12/16, `text-sm` 13/18, `text-base` 14/20, `text-lg` 16/22, `text-xl` 22/28, plus custom utilities `text-row` 15/22, `text-micro` 11/14, `text-rail` 10/12, `text-prose` 15/24. After the sweep, any arbitrary `text-[Npx]` is an ESLint error (`no-restricted-syntax` on the regex `text-\[\d+(\.\d+)?px\]` in `className`) with `rail.tsx` exempted for nothing (it uses `text-rail`).

---

## 3. Rhythm

### 3.1 Grid, spacing, padding

4px grid. `--os-s-1..8` = 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64. Page content padding 24 (`--os-page-pad`), card 16 (`--os-card-pad`), modal 24, drawer 20, table cell 12 horizontal, sidebar 12 horizontal, chrome 12. Gap between inline controls 8, between form fields 16, between form cards 24, between sections 32. Content max widths: tables and boards fluid; docs / SOPs / goals 720; settings forms 560; drawer 520.

### 3.2 Row heights and the content-height budget

| Token | Value | Applies to |
|---|---|---|
| `--os-nav-row-h` | 36 | secondary sidebar rows, menu rows, picker rows, filter-panel rows, text-tab pills' row, drawer field rows |
| `--os-row-h` | 44 Comfortable (default) / 36 Cozy / 32 Compact | data rows: table card, list view, people list, doc list; set by `html[data-density]` |
| rail item | 56 | |
| table header row | equals `--os-row-h` at Comfortable (44); 36 at Cozy and Compact | |

Density preference (Settings › You › Preferences › Density, segmented control): Comfortable 44 / Cozy 36 / Compact 32, data rows only, admin may lock and may set the org default. Stored `cozy` → 36, stored `compact` → 32, new `comfortable` → 44 (default for new orgs). Tables module defaults to Compact and keeps its own Sheets rules.

**Content-height budget:** nothing inside a row exceeds the row height minus 12. A 44 row carries at most one 28px element (a 24px chip plus padding, a 24px avatar group); a 36 row carries 24 (chips shrink to 20); a 32 row carries 20 (chips 18, avatars 20). Two-line content is not allowed in a row; it goes to the drawer. Zoho's wrapping email cells are the one exception, and only in Comfortable density on text columns flagged `wrap`.

### 3.3 Control heights

36 default (inputs, buttons, toolbar chips, text-tab pills, the Create button), 32 small (in-row buttons, chip actions, chrome icon buttons), 28 inline (row hover actions), 24 chips (20 at Cozy, 18 at Compact). The one blue Create button is 36 like every other control; it earns attention through colour, not size.

### 3.4 Radii

`--os-r-xs` 4 (checkboxes, kbd, skeleton bars, solid status cells), `--os-r-sm` 6 (inputs, buttons, chips, text-tab pills, chrome search field, tooltips), `--os-r-md` 8 (cards, table card, filter panel, menus, popovers, rail pill, sidebar pill, kanban cards, toasts, segmented control), `--os-r-lg` 12 (modals, drawers, widget cards), `--os-r-pill` 999 (avatars, count badges, dots). `--os-r-xl` 16 is retired; `rounded-2xl/3xl` are banned inside `.workwrk-os`.

### 3.5 Elevation

Borders over shadows. Structural border `--os-line`, input border `--os-line-strong`, in-table hairline `--os-line-soft`. Shadows exist for exactly three things: popovers/menus/pickers/tooltips and drag ghosts (`--os-shadow-pop` = `0 8px 24px rgba(16,18,21,.12)`), modals and drawers (`--os-shadow-modal` = `0 8px 32px rgba(16,18,21,.16)`). `--os-shadow-card` and `--os-shadow-rest` are retired; cards are bordered. In dark mode shadows are replaced by the lighter-surface step plus a 1px `--os-line` outline. `shadow-sm`, `shadow-2xl` and every Tailwind shadow utility are banned inside `.workwrk-os`.

---

## 4. Shell

Navy variant described; the light flip substitutes the chrome tokens from 1.2.1 and changes nothing else. All widths are CSS variables; RTL mirrors via logical properties (`inset-inline-start`, `padding-inline`, `border-inline-end`), never `left/right`; chevrons flip with `rtl:rotate-180`.

```
┌──────┬─────────────────┬──────────────────────────────────────────────────┐
│ rail │ sidebar 264     │ top bar 48 (navy)  ‹ › Work › Sales › Q4 leads   │
│ 64   │ N50             ├──────────────────────────────────────────────────┤
│ navy │                 │ title row 40       Q4 leads         [Share] [⋯]  │
│      │  ┌───────────┐  │ views row 36       All · Mine · Overdue · ••• +  │
│ ●●●● │  │ Home      │  │ toolbar 44  [Filter][Sort] | ≡ ▦ ▤   [+ Create ▾][⋯]│
│      │  │ My work   │  ├──────────────────────────────────────────────────┤
│  ▢   │  │ Inbox  3  │  │ ┌ filter 272 ┐ ┌ table card ────────────────┐   │
│ Work │  └───────────┘  │ │ Filter by  │ │ ☐ Name     All ▾  Owner  ⚙ │   │
│      │  SPACES ─────── │ │ ☐ Status   │ │ ☐ ...                      │   │
│  ▢   │  ▪ Sales        │ │ ☐ Owner    │ │ Total records 644   1 to 40│   │
│      │  ▪ Ops          │ └────────────┘ └────────────────────────────┘   │
└──────┴─────────────────┴──────────────────────────────────────────────────┘
```

Chrome above the first data pixel: 48 + 40 + 36 + 44 = 168 on a multi-view list page; 132 when the views row collapses; 88 on doc pages (title row 40 since the 2026-09-24 compact pass). Chrome left of content: 328 (today 320).

### 4.1 Rail (`--os-rail-w: 64px`)

- Background `--os-chrome-bg`. Full height, flush to the viewport edge, no radius, no `border-inline-end` (the colour step is the edge). Never scrolls. The current `rounded-xl overflow-hidden` floating-card treatment in `click-app-rail.tsx` is removed.
- **Top**: the four-dot logo mark, 28px wide (dots 5px, gap 2.67px), centred, 16px from the top, brand hexes on navy: the single coloured object in the chrome. Click = Work hub. This mark is also the route loader (5.15).
- **Items**: the 8 hubs in the admin's order (Work, Planner, AI, Talk, Teams, Docs, Tables, Settings). Each 56px tall, full rail width, 8px gap: a 20px Lucide icon (1.5px stroke) centred in a 40×40 pill area, the label 10/500 centred 2px below. Rest: icon and label `--os-chrome-fg-2`. Hover: `--os-chrome-hov` 40×40 pill radius 8 behind the icon, icon and label `--os-chrome-fg`. **Active**: `--os-chrome-pill` (white) 40×40 pill radius 8, icon `--os-chrome-pill-fg` (navy), label `--os-chrome-fg` at 500. Zoho's white pill plus a label. No left bar, no underline.
- Attention dot: 6px `--os-chrome-attention` at the icon's top-right with a 2px `--os-chrome-bg` ring. No numeric badges on the rail.
- **Bottom cluster**: Settings hub pinned last, then the avatar 28px with an 8px `--os-chrome-presence` dot. Avatar menu: Profile, Preferences, Theme (Light / Dark / System), Chrome (Navy / Light), Log out. No Upgrade, no Invite, no workspace avatar at the top, no ⊞ launcher tile (apps live in the command palette as "Apps").
- Icons-only rail option removed from CustomizePanel. Labels max 9 characters, no two starting with the same word; current labels pass.
- Keyboard: arrow keys move between hubs, Enter opens, `⌘1`..`⌘8` jump directly; `aria-current="page"` on the active hub.

### 4.2 Secondary sidebar (`--os-side-w: 264px`)

- Background `--os-side-bg` (N50) in both variants, `border-inline-end: 1px solid var(--os-line)`. Collapsible to zero (rail only) via the small circular chevron button on the sidebar's outer edge at the bottom (Zoho ref 1) and `⌘\`; state remembered per user. Resizable 240 to 320.
- **Header (56px)**: workspace switcher = `EntityTile size="sm"` (neutral, org initials) + org name 15/500 + chevron, hover `--os-surface-hov` pill radius 6. Below it, only when the hub's tree exceeds 12 rows, one full-width search input (36px, white, `--os-line-strong` border, radius 6, magnifier 16px `--os-ink-3`, placeholder "Search {hub}…") that filters the tree in place. It is not the global search; small orgs never see it.
- **Rows (36px)**, `.os-row`: `padding-inline: 12px`, gap 12, one 20px Lucide icon in `--os-ink-2` or `EntityTile size="sm"` neutral, label 15/400 `--os-ink`, optional count right-aligned 12/500 `--os-ink-2`. Rows are inset 8px from the sidebar edges so pills have air. Hover `--os-surface-hov`, radius 8. **Active** = `--os-side-pill` (N200) pill radius 8, label 15/500 `--os-ink`, icon `--os-ink`, **count `--os-ink-strong`** (N500 on N200 is 4.01:1 (v) and fails). No blue, no left bar, no coloured icons, no transform.
- **Section labels**: 11/600 uppercase +0.06em `--os-ink-2`, a 1px `--os-line` rule from the label's end to the right edge (Zoho ref 2), 24px top margin, 8px bottom. Collapsible; a chevron appears on hover.
- **Work hub order**: personal rows first (Home, My work, Inbox with count), then FAVORITES (only when non-empty), then the access-derived SPACES tree. Other hubs open on their tree with the folded apps as labelled sections (Docs: LIBRARY, SOPS, POLICIES, CONTRACTS, CLIPS).
- **Tree**: Space rows 36 with `EntityTile size="sm"` neutral; children indent 20px per level, no guide lines; hover reveals a single "…" at the right (star and "+" live inside that menu, not as three hover icons).
- **Footer (44px)**: the one "Customize Sidebar" button, ghost, 13/500 `--os-ink-2`, 16px `SlidersHorizontal`, `border-top: 1px solid var(--os-line)`. Opens the CustomizePanel: Theme, Chrome, Density (segmented controls), section visibility and order. No accents, no icons-only.
- Nothing promotional, no cards, no tips.

### 4.3 Top bar (`--os-top-h: 48px`)

One row, `--os-chrome-bg`, no bottom border in navy (the colour step is the edge), `1px solid var(--os-line)` in the light flip. Spans the full width to the right of the rail.

- **Left (from 12px)**: back ‹ and forward › icon buttons (32px, `--os-chrome-fg-2`, 40% opacity when there is no history), then the **hierarchy breadcrumb**: Hub › Space › Folder › List › Item. Crumbs 14/400 `--os-chrome-fg-2`, "›" separators at 50% opacity, last crumb 14/500 `--os-chrome-fg` and not clickable; middle crumbs collapse to a "…" menu past 4 levels; each crumb truncates at 160px. `EntityTile size="xs"` only on the Space crumb. This absorbs the location bar; there is never a second location row.
- **Centre**: global search, 400px (240 below 1280), 32px tall, `--os-chrome-field` background, 1px `--os-chrome-line` border, radius 6, magnifier 16px, placeholder "Search or jump to…" in `--os-chrome-field-ph`, `⌘K` kbd right in `--os-chrome-fg-2` at 12px. Opens the command palette.
- **Right (to 12px)**: "+" icon button (Create menu: Task, Doc, List, Reminder, Notepad, Voice note, then the AI entries when the AI module is on), Reminders bell (6px `--os-chrome-attention` dot when due), Help "?", avatar 28px with `--os-chrome-presence` dot. All 32px hit areas, icons `--os-chrome-fg-2`, hover `--os-chrome-hov` pill radius 6. **No solid blue button on the bar.** No quick-tool icon row; `⌘⇧K` opens Create task (spec-shell §1.8 settled `⌘T` out: it is browser-reserved).
- On widths under 1024 the breadcrumb shows only the last two crumbs; the search field becomes an icon.

### 4.4 Content header: the page pattern

Three thin rows on the white canvas, padding-inline 24, always in this order.

1. **Title row (40px)**: page title 18/600 `--os-ink` (`text-title`), single line, ellipsis, optionally preceded by `EntityTile size="md"` (20px) (Space/List pages). Compact since 2026-09-24: the founder read the 48px row, 22px title and 36px tile as too big and, on full pages reached from a list, `BackButton{fallbackHref}` as a 28px ghost with `ArrowLeft` 8px before the title. Right: ghost page actions only (Share, "…"). At most one **"Ask AI"** slot at the far right (28px ghost, `Sparkles`, label "Ask AI"), rendered only when the AI module is entitled for the org; otherwise the slot is empty, never a disabled button. No description line under the title (it lives in "…" › About).
2. **Views row (36px)**: saved views as **text-tab pills** in `.os-row`: 14/400 `--os-ink-2`, 28px tall, padding-inline 10, radius 6; hover `--os-surface-hov`; active `--os-surface-2` pill with 14/500 `--os-ink`. No underline, no coloured icons (the existing `ViewTab` is restyled, not replaced). Overflow past the width goes into a "•••" menu; "+ View" is the last item, ghost, 13px. **The row does not render** when a surface has exactly one view and no "+ View" affordance, and never on doc, SOP, goal, review, people-detail or settings pages.
3. **Toolbar row (44px, gap 8, no bottom border)**: left = **Filter** (16px `Funnel` + "Filter", a 36px toggle chip that turns `--os-surface-2` and shows "Filter · 2" when the side panel is open), **Sort** (`ArrowUpDown` + "Sort"), **Group** (Board/List surfaces only), a 1px 20px `--os-line` divider, then the **view-type switcher**: a run of 32px icon buttons (list, board, calendar, gantt, table, …), the active one `--os-brand-deep` on `--os-brand-soft` radius 6 (5.47:1 (v)), others `--os-ink-2`, overflow chevron after 6. Right = **the one blue button**: "Create task" / "New doc" / "New table" (36px, `--os-brand`, white 14/500, 16px `Plus`, radius 6), optionally fused to a 36px split chevron (`1px rgba(255,255,255,.24)` divider) for "Create from template"; then a bordered "…" square (36px, `--os-line-strong` border) holding Display (fields shown, subtasks, closed tasks, Solid status column), Import, Export, Automations…, Settings.
4. Below: 8px, then content. With Filter open, the **272px filter panel** sits at the left of the content with a 16px gap and the table/board narrows (a 220ms width tween).

Protected parity screens (List, Board, Calendar, Gantt, task detail) keep their internal structure and receive this header stack plus the tokens; that is the "restyle, not restructure" boundary until open decision 3 is answered.

### 4.5 Detail-view policy

| Situation | Pattern | Width |
|---|---|---|
| Task, table row, person, from a list/board | **Drawer** over the list, right, full height under the top bar, `--os-surface`, `border-inline-start: 1px solid var(--os-line)` + `--os-shadow-modal`, own 48px header (List › Item breadcrumb 13px left; expand ⤢, copy link, close ✕ as 32px ghost icons right), same URL as `/item/[id]`. The list underneath dims to 92% opacity (no scrim) and stays scrollable. Expand animates the drawer into the full page in place (240ms) so the user sees continuity. | 520, resizable 480 to 720, remembered |
| Doc, SOP, goal, review, KRA, role page | Full page, 720 content column centred, breadcrumb in the top bar + `BackButton{fallbackHref}` in the title row | 720 |
| From search, notification, deep link | Full page; `BackButton` shows the natural parent | 720 or fluid |
| Inbox, Talk threads | Split: list 360 (`--os-surface-1`) left, detail right | 360 + fluid |
| Short create/edit (task, list, member, space) | Centred modal | 560 |
| Rich create (with description) | Centred modal | 720 |
| Editors (statuses, fields, automations, import grid) | Centred modal, 90vh max | 960 |
| Confirm / destructive | Centred modal, danger primary only when destructive, typed confirmation for org-level deletes | 400 |
| Person / channel / Space info | Right panel, never modal | 360 |

No stacked modals; a picker inside a modal is an absolutely positioned child (existing rule). Every drawer has its page's URL so copy link always works.

### 4.6 Settings takeover

The rail and top bar stay; the sidebar and content are replaced. A 48px bar at the top of the takeover holds a "← Back to app" ghost button (32px, `ArrowLeft` + label) left and nothing right; the breadcrumb in the top bar reads "Settings › Workspace › Modules". Left list 264 (N50) with a 36px filter input at the top, group labels You / Workspace / Governance / Billing & plan as 11/600 uppercase with rule, rows 36. Content 760 max, 24px padding, page title 22/600. Modules page: one card per module with a one-line description and one switch; new orgs start minimal.

### 4.7 Keyboard and focus

`⌘K` search, `⌘⇧K` Create task, `⌘\` sidebar collapse, `G 1`..`G 8` hubs, `?` shortcuts overlay. Focus: `outline: 2px solid var(--os-focus); outline-offset: 2px` on `:focus-visible` for every interactive element; inputs additionally get `box-shadow: 0 0 0 3px var(--os-focus-halo)` on any focus (keyboard or pointer) so a focused field is unmistakable. `button.tsx`'s `ring-[#0073EA]/40` and the `color-mix(brand 45%)` ring are replaced by these two tokens.

---

## 5. Component standards

Sizes reference section 3, colours section 1. Icons are Lucide, 1.5px stroke, round caps; 20px in the rail, sidebar rows, filter panel and page-title tile; 16px in table rows, buttons, menus, chips, inputs; 12px inside chips.

### 5.1 Table (the bordered card): `TableCard`

- Card: `--os-surface`, `1px solid var(--os-line)`, radius 8, overflow hidden, no shadow, 8px under the toolbar, fluid width, `overflow-x: auto` inside. Carries `.os-row`.
- **Header row** (44 at Comfortable, 36 otherwise): `--os-table-head-bg` (N50), `border-bottom: 1px solid var(--os-line)`. Labels 13/500 `--os-ink-2` sentence case (4.64:1 on N50 (v)). First cell = the checkbox column (44 wide) with an 18px `--os-line-strong` outlined square radius 4. **At Comfortable density the checkbox is visible at rest** (Zoho); at Cozy and Compact it appears on row hover and whenever any row is selected. An **inline header filter** on any column: the label followed by "All ▾" 13/400 `--os-ink-2` that opens the column's value picker. Last header cell = a 44px pinned **column settings** icon button (`SlidersHorizontal` 16px). Sortable columns show a 12px arrow only when sorted. Column resize handle on hover (2px `--os-brand` line while dragging). Column "+" at the end of the header opens the field-type picker with "Show more" after 10.
- **Body rows**: `--os-row-h`, `border-bottom: 1px solid var(--os-line-soft)`, no zebra, hover `--os-surface-hov` only. Cells 15/400 `--os-ink`, 12px padding-inline, title column 15/500. Numbers right-aligned with `tnum`. Selected row `--os-selected`; checked box `--os-brand` fill with white check. Content budget per 3.2: at most one chip and one avatar group per row; everything else is text.
- **Group header** (list view): 44/36 row, `--os-surface-1`, chevron 16px + name 15/500 + count 12/500 `--os-ink-2`; when grouped by status, a pale StatusChip replaces the plain name. Never a solid pill, never a coloured bar. Empty groups collapse to one line. "+ Add task" ghost row (15/400 `--os-ink-2`, `Plus`) last in every group.
- **Footer row (44px)** inside the card, `border-top: 1px solid var(--os-line)`: left "Total records 644" 13/500 `--os-ink` (number 500), right "1 to 40" 13/400 `--os-ink-2` with ‹ › 32px icon buttons and a page-size select on hover. Streaming tables (Tables module) keep infinite scroll and show only the total.
- **Bulk bar**: appears 150ms after the first selection, floating bottom-centre, 48px, `--os-surface`, `1px solid var(--os-line)`, radius 8, `--os-shadow-pop`: "3 selected" 14/500, 4 to 6 ghost actions, ✕. Never dark.
- Empty: one row "No tasks yet · Add task" 15/400 `--os-ink-2` with the action as a text link (no illustration inside a card).
- Tables module (Sheets-grade) keeps its own rules (letter headers, grey row-number gutter, no selection chrome, 1000-row default, tiny corner add) and inherits only the card border, hairlines, type and tokens. Compact 32 by default.

### 5.2 Filter side panel: `FilterPanel`

272px, `--os-surface`, `1px solid var(--os-line)`, radius 8, padding 16, sticky under the toolbar, full content height with its own scroll, `.os-row`. Heading "Filter {objects} by" 16/600 with a "Clear all" text link at the right when anything is active; a 36px search input; then **checkbox rows** 36px (18px checkbox + label 15/400) for every filterable field. Checking a row expands an inline value control beneath it (picker list, date range, text input) and increments the count on the Filter chip. Bottom: "Save as view" text link. Escape or the Filter chip closes it. Under 1024 the same panel is a 320px drawer from the left.

### 5.3 Kanban

Column 280, gap 12, `--os-surface-1`, radius 8, header 44: status name 15/500 + count 12/500 `--os-ink-2` + "…" (text, never a solid pill). Card: `--os-surface`, `1px solid var(--os-line)`, radius 8, padding 12, no shadow at rest, `--os-shadow-pop` while dragging, no rotation or scale. Content: title 15/400 two-line clamp; one row of at most three pale chips (priority glyph, due date, one label; never status); bottom row ID 12/500 `--os-ink-2` left, avatars 24px right. "+ Add task" ghost at the column bottom; "+ Add group" as a dashed `--os-line-strong` ghost column.

### 5.4 Forms and settings cards

Label above 13/500 `--os-ink`, helper 13/400 `--os-ink-2`, "(required)" as text not a red asterisk. Input 36px, `--os-surface`, `1px solid var(--os-line-strong)`, radius 6, 14/400, padding-inline 12, placeholder `--os-ink-3`; hover border `--os-ink-3`; focus ring + halo (4.7); error border `--os-danger-solid` + 13px `--os-danger-text` helper with a 16px `CircleAlert`; disabled `--os-surface-1` fill, `--os-ink-4` text. Textarea min 3 rows, auto-grow to 12. Selects, dates and people are pickers (5.6), never native. Cards: `--os-line` border, radius 8, padding 24, title 16/600 + 13px description, max 5 fields, 16px between fields, 24px between cards, width 560 on pages, full in modals. One primary per form: right-aligned in modal footers, left-aligned under the last card on pages. Toggles and selects auto-save with an inline "Saved ✓" 12/500 `--os-success-text` that fades after 2s; text forms show a 56px sticky save bar (`--os-surface`, top border) only when dirty. Settings rows: 48px min, label 14/500 + 13px description left, control right, `--os-line-soft` separators. Danger zone: last card, `1px solid var(--os-danger-border)`, title in `--os-danger-text`, destructive ghost buttons, typed confirmation for org-level deletes.

### 5.5 Modals and drawers

Modal: sizes 400 / 560 / 720 / 960, radius 12, `--os-surface`, `--os-shadow-modal`, `--os-scrim`, header 56 (title 16/600, optional 13px description, ✕ right), body padding 24, footer 64 with Cancel (ghost) left of one primary (right). Escape and outside-click close (dirty forms confirm). Focus trapped; pickers inside are absolute children.

Drawer: per 4.5. **Task drawer field strip** (the first thing under the title): 36px label/value rows, label 13/500 `--os-ink-2` in a 120px column, value as a picker trigger. **Status, Assignee, Due date, Priority visible by default; "+ Add field" ghost reveals the rest** (Estimate, Track, Tags, Alignment, task type, custom fields), remembered per user per List. Description below; subtasks and checklist as 36px rows; Comments / Activity as text-tab pills (14px inside drawers); comments last. Autosave dot (5.17) in the drawer header.

### 5.6 The one picker popover: `Picker`

Width 280 (min 240; date 288), `--os-surface`, `1px solid var(--os-line)`, radius 8, `--os-shadow-pop`, padding 4. Search input at the top (36px, auto-focused, borderless with a bottom `--os-line`), **hidden when the list has fewer than 6 items**. Rows 36: 16px glyph identical to the glyph used in the list (6px status dot, 20px avatar, `Flag`) + label 14/400 + right-aligned kbd hint or check (multi-select keeps it open). Sections via 11/600 uppercase labels. Footer only for "Invite by email" (people) or "Manage statuses" (status), ghost 13px. Keyboard: ↑↓ Enter Esc, type-ahead. Date: quick chips Today / Tomorrow / Next week / No date at 24px, one month grid of 32px cells, today ringed 1px `--os-brand`, selected `--os-brand` fill, natural-language input in the search field. Inside a dialog: `position:absolute` child, never portalled. Absorbs the nine `useAnchorPos` consumers over time. Opens 160ms, closes 120ms.

### 5.7 Toasts

Bottom-left, 24px from the edges, **shifting right of the call-dock region when it is mounted** (the dock is bottom-right, 320×64; toasts move only when the two would overlap at narrow widths, otherwise they simply sit left of it). `--os-surface`, `1px solid var(--os-line)`, radius 8, `--os-shadow-pop`, min 320 max 480, padding 12 16, 14/400 + optional 13px second line, a 16px glyph at the left (`--os-success-text` check, `--os-danger-text` alert, otherwise `--os-ink-2` info), one text action (Undo, 14/500 `--os-brand-deep`), ✕. 5s (8s with an action), max 3 stacked with 8px gap, newest at the bottom. Never for validation, never a coloured background, never a banner. `useOsToast` keeps its API.

### 5.8 Empty states (quiet)

Template: a 96px illustration built from the four-dot motif in `--os-line-strong` (N300, 1.5px line art, no fills, no colour), optionally on a faint `--os-surface-1` rounded "sheet" (radius 12) behind it; then one sentence 15/400 `--os-ink-2` centred ("No tasks yet", "You are not part of any team yet"); then optionally ONE text link 14/500 `--os-brand-deep` ("Create a task", "Learn more"). Centred in the content area with 64px top margin. The page's blue Create button in the toolbar remains the one primary; the empty state never adds a second blue button and never fills a dot.

**Illustration family by context** (the only arrangements that exist):

| Context | Arrangement |
|---|---|
| Lists, tables, inbox, people | four dots in a row |
| Boards, kanban, calendar, dashboards | 2×2 grid |
| Goals, KRAs, OKRs, org chart | a cluster with a thin connecting line between dots |
| Docs, SOPs, policies, files | a vertical stack with a short line beside each dot (a "page") |

Home widgets (Zoho ref 2): `--os-surface`, `1px solid var(--os-line)`, radius 12, 60px header strip in `--os-widget-head-bg` with the title 15/500 `--os-ink` and a 20px `--os-ink-2` icon (icons only in the strip, no secondary text), then the same quiet block. Filtered-empty: an inline 44/36 row "No results · Clear filters" 15px `--os-ink-2` with a text link; no illustration. New workspaces: a "Get started with" chip row (Task, Doc, Table, Invite; 32px secondary buttons) plus a 5-item checklist card using `steps-n` (5.16), instead of an illustration. `OsEmptyView` is retained and restyled (44 importers); `ui/empty-state.tsx` is deleted.

### 5.9 Chips and status

- `Chip`: 24px (20 at Cozy, 18 at Compact), radius 6, 12/500, padding-inline 8, `--os-surface-hov` fill + `--os-ink` text by default, 12px glyph optional, removable with a 12px ✕. Toolbar chips (Filter, Sort) are 36px controls, not chips. Taupe is deleted; label chips are neutral.
- `StatusChip` pale (default): `{success|warning|danger|info|neutral}.bg` fill + `.text` text + a 6px `.solid`-coloured dot at the left, 12/500, sentence case (the uppercase 13px label is dropped). Solid (opt-in status column only): `.solid` fill, white text (N800 on warning), 12/500, full cell 28px, radius 4.
- Mapping: done / on track → success; in progress / due soon / at risk → warning; overdue / blocked → danger; review / info → info; not started / none → neutral. User-defined statuses follow 1.7.
- Priority: `Flag` 16px; urgent `--os-danger-text`, high `--os-ink` filled, normal `--os-ink-2` outline, low `--os-ink-3` outline. No yellow, no blue.
- Reserved variants: **performance band** (neutral chip, 500-weight letter grade, 4px `--os-ink-3` bar; top band may use success), **co-presence** ("Priya is editing": 16px avatar + `live` dot + 12px text on `--os-surface-hov`).

### 5.10 Buttons

All 36 (32 small, 28 inline), radius 6, 14/500, padding-inline 12 (16 with an icon), 16px icon, gap 8, no transform on hover or press (`active:translate-y-px` and `shadow-sm` removed), 120ms background transition.

| Variant | Rest | Hover | Pressed | Disabled |
|---|---|---|---|---|
| Primary (one per page) | `--os-brand`, white | `--os-brand-hover` | `--os-brand-pressed` | `--os-surface-2` fill, `--os-ink-4` text |
| Secondary | `--os-surface`, `1px solid var(--os-line-strong)`, `--os-ink` | `--os-surface-hov` | `--os-surface-2` | same |
| Ghost | transparent, `--os-ink-2` | `--os-surface-hov`, `--os-ink` | `--os-surface-2` | `--os-ink-4` |
| Destructive | `--os-danger-solid`, white; only in confirm modals and danger zones | `#B42318` (6.57:1 (v)) | `#912018` (8.66:1 (v)) | as primary |
| Destructive ghost | `--os-danger-text` | `--os-danger-bg` | | menus, danger zones |
| Link | `--os-brand-deep`, underline on hover only | | | |
| Icon | ghost, 32 or 36 square, tooltip + `aria-label` mandatory | | | |

Split button = primary + 36px chevron half separated by `1px rgba(255,255,255,.24)`. White on `#0073EA` is 4.53:1, so primary labels are never smaller than 14/500; the 28px inline size is secondary or ghost only. Pending: the label stays and a 16px monochrome four-dot mini-loader replaces the icon (5.16 `pending`).

### 5.11 Inputs, checkbox, switch, radio

Inputs per 5.4 with ring + halo. Checkbox 18px (16 at Compact), radius 4, `1px solid var(--os-line-strong)`, checked `--os-brand` with a 12px white check, indeterminate an 8×2 white bar, 24px hit area. Radio 18px pill. Switch 36×20, track `--os-line-strong` off / `--os-brand` on, 16px white knob, 160ms. Search inputs: 16px magnifier left, ✕ clear right when non-empty.

### 5.12 Tabs and the segmented control

- **Text-tab pills** (saved views, settings sub-tabs, drawer Comments / Activity): 28px, 14/400 everywhere `--os-ink-2`, radius 6, active `--os-surface-2` + 500 `--os-ink` (was 32px and 15/400 until the 2026-09-24 compact pass). `ViewTab` is restyled to this; the zinc-900 underline and per-view coloured icon retire. **Underline tabs exist nowhere in the app**; the only underline is the marketing site nav.
- **Segmented control** (2 to 4 exclusive options in Preferences and panels: Theme Light / Dark / System, Chrome Navy / Light, Density Comfortable / Cozy / Compact, view density toggles): 32px, `--os-surface-1` track radius 8 with 2px padding, segments 14/500 `--os-ink-2`, active segment `--os-surface` with `1px solid var(--os-line)` radius 6 and `--os-ink`. Keyboard: arrows move, no roving blue. It is the right primitive for a setting; the text-tab pill is the right primitive for a view.

### 5.13 Tooltips

`--os-inverse-bg` fill, `--os-inverse-fg` 12/400, radius 6, padding 6 8, `--os-shadow-pop`, max 240, 8px offset, no arrow. Show after 400ms; **0ms when the pointer moves between adjacent tooltip triggers** (a toolbar or icon cluster), hide immediately. Kbd hint at the right in 11/500 at 70% opacity ("Create task · ⌘⇧K"). Every icon-only control has one and an `aria-label`.

### 5.14 Iconography and EntityTile

Lucide only, `strokeWidth={1.5}`, round caps. 20px in the rail, sidebar rows, filter panel and page-title tile; 16px in rows, buttons, menus, chips, inputs; 12px inside chips. Colour: `--os-ink-2` at rest on the canvas, `--os-chrome-fg-2` at rest on the chrome; coloured only when active (rail: white pill; view-type: `--os-brand-deep`), semantic (status glyph), or destructive (`--os-danger-text` menu row). One icon per concept app-wide: assignee `UserPlus`, due `CalendarPlus`, priority `Flag`, tags `Tag`, more `MoreHorizontal`, filter `Funnel`, sort `ArrowUpDown`, group `Rows3`, display/settings `SlidersHorizontal`, search `Search`, AI `Sparkles`, add `Plus`. At most two icons per row. `EntityTile` renders neutral by default (`--os-surface-hov` tile, `--os-ink-2` glyph), sizes xs 16 / sm 20 / md 24 / lg 36, radius 4 / 5 / 6 / 8; opt-in colour is the tile at the hue's pale bg with the glyph in the hue (1.7).

### 5.15 Loading and the four dots

- **First open per day and after login**: the mission splash on `#1B2537` (the navy chrome colour regardless of chrome variant, so the brand moment is constant), full screen, the four dots at 12px each animating a 600ms sequential rise (Y B R G, 80ms stagger), the mission line 16/400 white at 72% beneath, one rotating value 14/400 beneath that, 1.2s total, 160ms fade, **skippable with any key or click**. Because the navy is the chrome, the fade reveals the shell as if the frame opened onto the work. Never on navigation; the 10-minute re-trigger is removed.
- **Route transitions**: after 200ms of pending (to avoid flashes), the rail's logo dots go from rest to a sequential brightness pulse (each dot lifts to 100% and back, 900ms loop, 120ms stagger) while the route resolves; the rail, sidebar and top bar stay interactive. Content shows skeletons: `--os-skeleton` bars radius 4 at the exact row height, 60/40/80% widths, one 1.6s opacity pulse, no shimmer in dark. `ValueLoader` becomes one 13/400 `--os-ink-2` line under the first skeleton with the rotating value; no dots, no overlay, never blocks input. No progress line (one loader per screen).
- **Buttons pending**: 16px monochrome four-dot mini-loader in `currentColor` replaces the icon; label and width preserved.
- `DotsLoader` loses its box-shadow. YBRG inside the product appears in exactly two places: the rail logo (at rest and pulsing) and the splash.

### 5.16 The `Dots` component (one home for every non-brand dot)

| Variant | Size | Colour | Motion | Where |
|---|---|---|---|---|
| `status` | 6px | `*.solid` or a user hue | none | inside pale chips only; always beside a word |
| `unread` | 6px | `--os-attention` (canvas) / `--os-chrome-attention` (chrome) | none | rail hub, bell, inbox rows, sidebar channel rows |
| `presence` | 8px + 2px ring in the parent surface | `--os-presence` / `--os-chrome-presence`; away `--os-warning-solid`; offline `--os-line-strong` | none | avatars in Talk, people rows, rail avatar |
| `live` | 6px | `--os-brand` | opacity pulse 1.6s | co-presence chip, recording, call in progress |
| `saving` | 6px | see 5.17 | pulse while saving | `AutosaveIndicator` |
| `quad-steps` | 8px dots, 4px gap, up to 4 | done `--os-brand` filled, pending hollow 1.5px `--os-line-strong`, failed `--os-danger-solid` | fill 160ms | discrete progress with ≤ 4 stages: SOP acknowledgement, review cycle (Self › Manager › Calibrate › Done), module setup |
| `steps-n` | 6px dots, 4px gap, 5 to 8 | as above | as above | onboarding checklists, wizards; beyond 8 use the linear bar |
| `pending` | 4px dots, 2px gap | `currentColor` | bounce 1.1s | buttons in flight |
| `grip` | 2×3 grid, 3px dots, 2px gap | `--os-ink-3` | none | drag handles on rows, cards, blocks |
| `grid` | 1px dots at 24px pitch | `--os-line-soft` | none | Canvas background only |

Rules: the hollow-versus-filled grammar exists **only** on `quad-steps` / `steps-n`, where the step words disambiguate it; empty states never fill a dot. A screen never shows two pulsing dot loaders. Status dots are never bare (except in Compact tables where the column header names the meaning). The metadata separator in text is the middle dot "·" ("Due Fri · 3 subtasks").

### 5.17 `AutosaveIndicator` (the data-integrity contract)

Mounted in the header of every autosaving surface (docs, notes, canvas, tables, task drawer): a 6px `saving` dot + 12/500 `--os-ink-2` word. States: **idle** (no dot, "Saved" fades after 2s), **saving** (dot `--os-brand`, opacity pulse, "Saving…"), **saved** (dot `--os-success-solid`, "Saved", fades after 2s), **failed** (dot `--os-danger-solid`, no pulse, the words **"Not saved, retrying"** in `--os-danger-text`, stays until saved; after the retry budget is exhausted the word becomes "Not saved" with a "Retry" text link and a toast with Retry). Failure is never silent and never only colour.

### 5.18 Progress, avatars, kbd, breadcrumb, BackButton

Linear progress: 4px pill, `--os-surface-2` track, `--os-brand` fill; semantic fill only when the bar means on track / at risk / off track and is labelled. Discrete progress: `quad-steps` / `steps-n`. Goal ring: stroke 6, `--os-brand` on `--os-surface-2`. Avatars: 20 / 24 / 28 / 32 / 40, pill, initials 11/500 on N200 with N700 text (the lime dark fallback and hue-keyed fallbacks are deleted), presence dot bottom-right when relevant. Kbd: 18px, `--os-kbd-bg`, `1px solid var(--os-line)`, radius 4, 11/500 `--os-ink-2`. `BackButton{fallbackHref}`: 28px ghost with `ArrowLeft` and the parent name 13/500 `--os-ink-2`, in the title row of every full page; bare `router.back()` stays forbidden.

### 5.19 Reserved slots

- **Comments**: one `CommentThread` (36px avatar row, 15/400 body, 12px meta, hover reveals React / Reply / Resolve / "…" assign as ghost icons; replies indent 40; resolved threads collapse to one 36px line with a success dot + "Resolved"). Reactions, replies, resolve and assign grow inside it.
- **Call dock**: 320×64 region bottom-right, 24px from the edges, above the toast stack; `--os-surface`, border, radius 12, `--os-shadow-pop`; nothing renders until a call exists.
- **"Automations…"** entry in the Space / Folder / List "…" menus after Sharing.
- "Show upcoming features" preference (off by default) revealing Coming-soon rows; hidden otherwise.

---

## 6. Motion

- Durations: `--os-dur-fast` 120ms (hover, focus, chip toggle, checkbox), `--os-dur-base` 160ms (menus, popovers, tooltips, text-tab pill, step-dot fill, toast in), `--os-dur-slow` 220ms (drawer, modal, sidebar collapse, filter panel and the table width tween), `--os-dur-expand` 240ms (drawer-to-page Expand only). Nothing above 250ms in the app. Splash fade 160ms.
- Easing: `--os-ease-out: cubic-bezier(0.2, 0, 0, 1)` entering, `--os-ease-in: cubic-bezier(0.4, 0, 1, 1)` leaving at 0.75× the entering duration.
- What animates: background and colour on state change; opacity + 4px translate for menus and popovers; opacity + 8px translate for toasts; translate-x for the drawer and the filter panel; the list's opacity to 92% under a drawer; the drawer's width and position into the page on Expand (Motion v12 `layout`); height for accordion sections and the sticky save bar (160ms); the rail logo pulse; the `live` / `saving` pulse; skeleton opacity.
- What never animates: hovered or pressed elements (no transform), table rows on load or reorder (they appear in place), sidebar tree rows beyond a 160ms height tween, the chrome (variant and theme switches are instant), numbers (no count-up), page titles, focus rings, text colour on hover, route content (no crossfade).
- `prefers-reduced-motion`: translates become opacity-only, durations halve, the splash renders static, the rail pulse becomes a static mark, the `live` pulse stops.
- Deleted: `.animate-fade-in` (300ms), the 380ms splash fade, `active:translate-y-px`, the 1.06 icon scale on `.os-side__item.is-active` (os.css:462).

---

## 7. Differentiation: not monday, not Zoho, ownable

monday's signature is white chrome, saturated status cells, coloured group bars, Figtree, warm greys and `#0073EA`. WorkwrK shares only the blue; every other lever is set to the opposite value.

| Lever | monday | WorkwrK |
|---|---|---|
| Chrome | white sidebar, white top bar | navy frame `#1B2537`, white active pill |
| Where colour lives | every cell, every group | one blue button per page, one logo in the chrome |
| Group / column headers | coloured text + left rule, solid pills | plain 15/500 on `--os-surface-1` |
| Status | solid cells everywhere | pale chip + dot + word; solid is an opt-in column |
| Neutrals | warm `#323338 / #676879` | cool slate, same hue as the navy |
| Type | Figtree / Roboto | Inter, 15px rows, 500 emphasis |
| Rows | 36 edge to edge | 44 inside a bordered card with a records footer |
| Tabs | underline + coloured view icons | grey text-tab pills |
| Empty | logo-only load, wizard | grey four-dot line art + one sentence |
| Feedback | green banner top-centre | white toast bottom-left with Undo |
| Loader | logo | the rail logo's dots pulse |

**Ownable**: (1) the four dots in full colour on navy, the only saturated object in the chrome, which is also the loader and the splash; the frame opens onto the work. (2) The navy-frame-white-page silhouette, readable at thumbnail size. (3) "One blue thing per page", which makes Create findable without training. (4) The calm 15px bordered-card table with totals and pagination in the card, which reads as "records", the SMB mental model. (5) The autosave dot and the step dots: the motif carrying meaning in exactly two places and decoration in none.

It does not read as Zoho: no reds / corals / purples, one rail + one sidebar + one top bar, no bottom dock, Lucide, a labelled rail, a 264px sidebar, and the semantic trio where Zoho uses brand red for attention.

---

## 8. Migration onto the existing `--os-*` tokens

### 8.1 Re-point table (line numbers in `os.css` at `21a21623`)

Principle: keep every existing name (163 files reference them), re-point values, add the new names, alias retired names for one release, then delete.

| Existing (line) | Old value | Action | New light / dark |
|---|---|---|---|
| `--os-brand` (40) | `#0073EA` | keep | `#0073EA` |
| `--os-brand-hover` (41) | `#0060B9` | re-point | `#0062CC` |
| `--os-brand-soft` (42) | `#E6F1FB` | re-point | `#EAF3FE` / `rgba(0,115,234,.14)` |
| `--os-brand-deep` (43) | `#1F76C2` | re-point | `#0B5FC2` / `#4D9CFF` |
| `--os-brand-dark` (44) | `#292F4C` | alias → `--os-chrome-bg` | splash, rail |
| `--os-brand-rail` (48) | `#1A2C4A` | alias → `--os-chrome-bg` | the rail already paints this inline in `click-app-rail.tsx:107`, so the alias is close to a no-op |
| `--os-brand-ink` (52) | `var(--os-brand-rail)` | re-point | `var(--os-brand-deep)` |
| new `--os-brand-pressed` | | add | `#0A4C9B` |
| `--os-c-green/orange/red/yellow/blue/teal/brown/sage/gray/darkgray` (55 to 68) | monday palette | interim alias, then delete after the sweep | `green → success-solid`, `red → danger-solid`, `orange/yellow → warning-solid`, `blue → brand`, rest → `ink-2` |
| `--os-c-purple/pink/indigo/lime` (60 to 64) | aliases | delete | |
| `--os-canvas` (71) | `#FFFFFF` | keep | `#FFFFFF` / `#101215` |
| `--os-surface` (76) | `#FFFFFF` | keep | `#FFFFFF` / `#181B20` |
| `--os-surface-1` (77) | `#F6F7FB` | re-point | `#F6F7F9` / `#15181D` |
| `--os-surface-2` (78) | `#ECEEF5` | re-point | `#E4E7EC` / `#262A31` (now bg.active) |
| `--os-surface-3` (79) | `#E6E9EF` | alias → `--os-surface-2`, then delete | |
| `--os-surface-hov` (80) | `#F0F3FA` | re-point | `#EEF0F3` / `#1F232A` |
| `--os-row-hov` (81) | `#F8F9FD` | alias → `--os-surface-hov` | one hover, not two |
| `--os-line` (84) | `#E6E9EF` | re-point | `#E4E7EC` / `#262A31` |
| `--os-line-soft` (85) | `#F0F2F7` | re-point | `#EEF0F3` / `#1F232A` |
| `--os-line-strong` (86) | `#D0D4DC` | re-point | `#D0D5DD` / `#30353D` |
| `--os-ink` (89) | `#323338` | re-point | `#1F2430` / `#E6E8EC` |
| `--os-ink-2` (90) | `#676879` | re-point | `#667085` / `#9AA3B2` |
| `--os-ink-3` (91) | `#9699A6` | re-point | `#98A2B3` / `#6B7280` |
| `--os-ink-4` (92) | `#C4C7D4` | re-point | `#D0D5DD` / `#3A3F47` |
| new `--os-ink-strong`, `--os-ink-inv`, `--os-inverse-bg/-fg`, `--os-selected`, `--os-selected-hov`, `--os-scrim`, `--os-focus`, `--os-focus-halo`, `--os-presence`, `--os-attention`, `--os-kbd-bg`, `--os-skeleton` | | add | per 1.2, 1.3 |
| new `--os-chrome-*` (12) + `--os-side-bg`, `--os-side-pill` | | add, keyed on `html[data-chrome]` | per 1.2.1 |
| new `--os-success/warning/danger-{bg,text,solid}` | | add | per 1.2 |
| new `--os-dot-y/b/r/g` | | add | brand hexes |
| new `--os-status-user-1..8`, `-dark` | | add | per 1.7 |
| new `--os-danger-border`, `--os-widget-head-bg`, `--os-table-head-bg`, `--os-table-row-line`, `--os-chip-h`, `--os-rail-pill-size` | | add | per 1.3 |
| `--os-r-xs/sm/md/lg/pill` (95 to 100) | 4/6/8/12/999 | keep | |
| `--os-r-xl` (99) | 16 | alias → `--os-r-lg`, then delete | |
| `--os-shadow-card` (103) | 3px/10px + ring | alias → `none`, then delete | cards are bordered |
| `--os-shadow-pop` (104) | 10px/26px | re-point | `0 8px 24px rgba(16,18,21,.12)` |
| `--os-shadow-rest` (105) | hairline | alias → `none`, then delete | |
| new `--os-shadow-modal` | | add | `0 8px 32px rgba(16,18,21,.16)` |
| `--os-rail-w` (108) | 60 | re-point | 64 |
| `--os-side-w` (109) | 260 | re-point | 264 |
| `--os-top-h` (110) | 32 | re-point | 48 |
| `--os-title-h` (111) | 40 | rename → `--os-head-h` (old name aliased one release) | 48 |
| `--os-tabs-h` (112) | 34 | rename → `--os-views-h` | 36 |
| `--os-filter-h` (113) | 34 | rename → `--os-toolbar-h` | 44 |
| `--os-page-pad` (116) | 12 | re-point | 24 |
| `--os-card-pad` (117) | 12 | re-point | 16 |
| `--os-row-h` (118) | 28 | re-point, keyed on `html[data-density]` | 44 / 36 / 32 |
| `--os-row-h-lg` (119) | 32 | rename → `--os-nav-row-h` | 36 |
| `--os-control-h` / `-sm` (120, 121) | 26 / 22 | re-point | 36 / 32 |
| `--os-popover-w` (122) | 300 | re-point | 280 |
| `--os-font` (125) | Figtree | re-point | `var(--font-inter), Inter, …`, letter-spacing 0 |
| new `--os-t-*` (9), `--os-s-1..8`, `--os-dur-*`, `--os-ease-*`, `--os-drawer-w` 520 | | add | sections 2, 3, 6 |
| `:root[data-accent=…]` (10 blocks) | | delete; `data-accent` writer removed from `ThemeApplier` (line 80) and CustomizePanel | replaced by `html[data-chrome]` |
| `:root.dark .workwrk-os .text-zinc-* … !important` (1543 onward, 147 rules) | | retarget values to token references in step 1; delete per file family in step 5 | dark = rebinding only |
| dark token block (1558 to 1569) | `#14171D` etc. | rewrite | per 1.2 dark column |
| `.os-side__item.is-active` (457 to 462) | `--os-brand-soft` + `--os-brand` + `scale(1.06)` | rewrite | `--os-side-pill`, `--os-ink`, no transform |
| `.os-sk` brand flip (31807 to 31810) | `--os-brand: #E5E7EB` | delete | the Sidekick panel folds into the single Ask AI slot |
| `globals.css` shadcn set (`--surface/--muted/--border`), bento lime palette, `.dark .avatar-fallback-tone`, marketing brand tokens inside the app, "Single accent: violet" prose | | delete from the app; marketing keeps its own smaller sheet with `--os-brand` and the four dots | |
| `ui/accent.ts` taupe, `.btn-taupe`, `app-shell.css`, `ui/empty-state.tsx`, `OsMainTable/OsTabs/OsFilterBar`, removed-module BEM families | | delete | |

### 8.2 Type codemod (mechanical)

`text-[10px]` → `text-rail` (rail only; elsewhere `text-micro`); `11 / 11.5` → `text-micro` when uppercase, else `text-xs`; `12 / 12.5` → `text-xs`; `13` → `text-sm`; `13.5 / 14 / 14.5` → `text-base` (the `.os-row` container promotes to 15 where it should); `15` → `text-base` outside `.os-row` containers, removed inside them; `16 / 17` → `text-lg`; `20 / 26` → `text-xl`. Half-pixel sizes go to zero. Verify with the lint rule in 2.4.

### 8.3 Tailwind v4 `@theme` mapping

```
--color-app: var(--os-canvas);        --color-raised: var(--os-surface);
--color-subtle: var(--os-surface-1);  --color-hover: var(--os-surface-hov);
--color-active: var(--os-surface-2);  --color-selected: var(--os-selected);
--color-line: var(--os-line);         --color-line-soft: var(--os-line-soft);
--color-line-strong: var(--os-line-strong);
--color-ink: var(--os-ink);           --color-ink-2: var(--os-ink-2);
--color-ink-strong: var(--os-ink-strong); --color-ink-3: var(--os-ink-3);
--color-brand: var(--os-brand);       --color-brand-deep: var(--os-brand-deep);
--color-brand-soft: var(--os-brand-soft);
--color-success-bg/-text/-solid, --color-warning-*, --color-danger-*: the semantic trio
--color-chrome, --color-chrome-fg, --color-chrome-fg-2, --color-chrome-pill, --color-chrome-pill-fg
--text-xs 12/16, --text-sm 13/18, --text-base 14/20, --text-lg 16/22, --text-xl 22/28
--text-row 15/22, --text-micro 11/14, --text-rail 10/12, --text-prose 15/24
--radius-xs/sm/md/lg: var(--os-r-*)
```

Components write `bg-app border-line text-ink-2`, never `bg-white border-zinc-200 text-zinc-500`.

### 8.4 Lint rules (the system's immune system)

1. ESLint `no-restricted-syntax` in `className` strings: `zinc-|slate-|gray-|neutral-|stone-|violet-|purple-|indigo-|pink-|fuchsia-|#[0-9a-fA-F]{3,8}` → error after the sweep.
2. ESLint `no-restricted-syntax`: `text-\[\d+(\.\d+)?px\]` → error; `rounded-(2xl|3xl)` → error; `shadow-(sm|md|lg|xl|2xl)` inside `src/app/(dashboard)` and `src/components` (except `brand/`) → error.
3. ESLint `no-restricted-syntax`: the string `--os-dot-` outside `src/components/brand/**` and `src/app/(marketing)/**` → error.
4. stylelint `declaration-property-value-disallowed-list`: `var(--os-dot-` outside `src/components/brand/`; `#[0-9a-fA-F]{3,8}` in any stylesheet other than `os.css` and `brand/*.css`.
5. A CI contrast script over the token file: every `*.text` on its `*.bg`, `--os-ink-2` on `--os-surface-1/-hov`, chrome pairs, in both themes and both chrome variants; fails under 4.5:1 for text pairs and 3:1 for non-text pairs.

### 8.5 Order of work (load-bearing; do not reorder)

1. **Tokens + chrome attribute + dark rebinding + `@theme`** in one PR: re-point the block at lines 40 to 125, add the new tokens, add the `html[data-chrome]` blocks, rewrite the dark block (1558 to 1569), add the `prefers-color-scheme` guard with `:root:not([data-theme="light"])`. **Keep the 147 `!important` repaints but retarget their values to token references** so un-migrated zinc utilities show the new dark palette immediately. Add the `data-chrome` writer to `ThemeApplier` (default `navy`). Delete the 10 `data-accent` blocks and, in the same PR, **normalise stored `OrgPreference` values: every `data-accent` → `blue`, `iconsOnly` → `false`, `density: compact` → 32, `cozy` → 36, default `comfortable` → 44**; call out the demo account's purple theme in the PR. Load Inter, drop the five families. No component changes. Ship.
2. **Type**: the codemod in 8.2, the `@theme` sizes, the `.os-row` container class on `TableCard` / sidebar tree / views row / `FilterPanel`, the `text-[Npx]` lint. Ship.
3. **Shell**: rail 64 navy flush with labels and the logo pulse; sidebar 264 with the N200 pill and conditional search; top bar 48 navy with breadcrumb + search + icon cluster; the three floating cards go; quick tools fold into "+"; `OsTitleBar` becomes the three-row header (`OsPageHeader` + `OsViewsRow` + `OsToolbar`) with the views-row collapse rule; `.os-side__item.is-active` rewritten; grep `--os-brand` inside `.os-rail*`, `.os-top*` and `> header` and fix every hit (blue on navy fails). Convert the physical `left/right` in `.os-side__*` to logical properties. Ship behind the parity answer (open decision 3) for the header stack.
4. **Primitives** on tokens only: `Button`, `Chip/StatusChip`, `MenuItem/MenuList`, `ViewTab` (text-tab pill), `EntityTile` (neutral default), `Dialog`, `Picker` (new), toast, `OsEmptyView` (illustration family), `Switch`, `BackButton`, `Kbd`, `Tooltip`, `SegmentedControl` (new), `Dots` (new), `AutosaveIndicator` (saving contract), `DotsLoader/ValueLoader` (rail pulse + caption, 200ms delay, no shadow), `MissionSplash` (first open per day, skippable), `TableCard` (new), `FilterPanel` (new), `Drawer` container with URL and 92% dim. Each PR deletes the `!important` repaints only that primitive needed.
5. **Colour and empty-state sweep**: every `--os-c-*`, raw `#E2445C / #00C875 / #FDAB3D`, `zinc-*` and purple-family class → tokens; every hub landing and empty list → 5.8; run the user-status hue remap with a dry-run report; when the last zinc utility in a file family is gone delete its repaint rules; when all are gone delete the layer and the `--os-c-*` aliases. Verify with the contrast script in both themes. Enable lint rules 1 to 4 as errors.
6. **Protected parity screens** (List, Board, Calendar, Gantt, task detail): header stack + tokens + `TableCard` + drawer-first with the field budget; internals untouched. Solid status group headers become pale chip headers only if open decision 3 is yes; otherwise they keep solid pills on `*-solid` tokens.
7. **Loaders and motion**: splash policy, delete `.animate-fade-in`, `active:translate-y-px`, the scale on the sidebar icon.
8. **Light-chrome flip**: expose the Chrome segmented control in Preferences after the navy pass has been reviewed in both themes.
9. **Marketing** last, on the same tokens, light only.

### 8.6 Risks

1. **Navy chrome vs the 2026-06-02 "Monday-clean" memory note.** The canvas stays Monday-clean; the frame is navy because the founder's Zoho endorsement is newer. Update the memory note explicitly so a future pass does not "fix" the navy back to white. The light flip is the tokenised escape hatch.
2. **Blue on navy fails**, so any existing component rendering `--os-brand` inside the rail or top bar silently fails contrast until it reads chrome tokens. Step 3 greps and fixes; lint rule 5 catches regressions.
3. **44px rows against 481 `h-7` uses** is a density shock; Cozy 36 and Compact 32 ship in the same release with the preference wired, Tables defaults to Compact, and the admin can set the org default.
4. **15 vs 14** is a second reading size; the `.os-row` container rule keeps it mechanical. Review any component that sets its own size inside a `.os-row` container as a bug.
5. **Header stack and Q1**: if the parity mandate keeps ClickUp's location bar, the stack becomes four rows and the pattern breaks. Do not ship step 3's header before open decision 3 is answered.
6. **`--os-c-*` deletion touches user data**: the remap is a migration with a dry-run report, never silent.
7. **Dark mode of the navy variant** has not been seen by the founder; the fallback values are in 1.5.
8. **`ViewTab` underline retirement** contradicts a Mobbin-verified parity surface; covered by "restyle with tokens", flagged in decision 3.
9. **Inter licence/perf**: `next/font/google` self-hosts and subsets; never a `<link>`.
10. **RTL**: logical properties from day one in the shell PR; `ar` and `he` need a real pass after step 3.
11. **Two chrome variants × two themes = four chrome states**; ship navy first (steps 1 to 7), expose the flip in step 8, QA one combination at a time. The chrome table has all four cells so nothing is discovered late.
12. **Dot overuse**: the `Dots` variant table is the ceiling; dots as bullets, dividers or decoration are vetoed in review.
13. **Autosave contract touches save/load paths**: `AutosaveIndicator` changes are presentation only; never change retry or keepalive behaviour in the same PR (data-integrity rule).

### 8.7 Step 1 record (token layer, shipped 2026-09-17)

What landed: `src/app/(dashboard)/tokens.css` (the one token file: primitives, semantic aliases with every pre-existing `--os-*` name kept, the chrome table for navy and light, dark as a rebinding under `:root.dark` and under the `prefers-color-scheme` guard `:root:not([data-theme="light"])`, the component tokens, the eight user hues, the nine sizes), Inter + JetBrains Mono via `next/font` with the five families dropped, the ten `data-accent` blocks deleted, the 147 `!important` repaints retargeted to tokens, `@theme` aliases for colour plus the four new sizes, ESLint rules 1 to 4 as `eslint-design-system.mjs`, rule 4 as `scripts/lint-css-tokens.mjs`, rule 5 as `scripts/check-token-contrast.mjs` (292 pairs across four chrome states, also diffs the two dark blocks), and the stored-accent normalisation as `scripts/normalize-stored-accents.ts` (dry run by default, not yet run). `ThemeApplier` hands the resolved appearance to next-themes (`attribute={["class","data-theme"]}`, `defaultTheme="system"`), which stamps both before hydration on return visits.

Deviations from the tables above, each deliberate and to be carried by the named step rather than rediscovered:

| Table says | Shipped | Why | Owner |
|---|---|---|---|
| N500 / `--os-ink-2` `#667085` (1.1, 1.2) | `#5C6779` | rule 5 requires ink-2 on `--os-surface-hov` (N100) at 4.5:1; `#667085` is 4.36:1 there. The darker step passes every allowed surface. | done |
| light-chrome `field-ph` `#98A2B3`; dark light-chrome `#6B7280` (1.2.1) | `#5C6779` / `#9AA3B2` | placeholder is visible text; the table values are 2.40:1 and 3.68:1 on their fields. | done |
| `--os-c-purple/pink/indigo/lime` deleted (8.1) | kept as aliases to brand / danger / brand-deep / success | settings/tags, announcements, activity-feed and analytics still read them; step 1 makes no component changes. Step 5 deletes the family. | step 5 |
| `--os-top-h` 48, `--os-title-h` aliased to `--os-head-h`, `--os-tabs-h` 36, `--os-filter-h` 44 (8.1) | old four names keep 32 / 40 / 34 / 34; `--os-head-h` 48, `--os-views-h` 36, `--os-toolbar-h` 44 added beside them | re-pointing the old names moves the live top bar and title bar, which is step 3's header rebuild. Step 3 re-points and aliases. | step 3 |
| `--text-xs` 12 ... `--text-xl` 22 and `--radius-*` aliases (8.3) | only `text-row / micro / rail / prose` bound; `text-xs` stays 13 | 1,600 call sites use today's meaning; the codemod renames them and flips the five values in one change. The `no-arbitrary-text-size` message names only the sizes bound today. | step 2 |
| `.os-side__item.is-active` rewritten in step 3 (8.5) | rewritten in step 1 | dead CSS today (no TSX renders the class); harmless, noted. | step 3 verifies |
| stylelint (8.4 rule 4) | `scripts/lint-css-tokens.mjs` | stylelint is not a dependency; adding one without the lockfile breaks `npm ci`. Same two checks. | none |
| density `compact -> 32, cozy -> 36, comfortable -> 44` normalised in the data script (8.5) | no write | stored strings keep their meaning; `DensityPref` widened to include `comfortable`, `DEFAULT_DENSITY` is `comfortable`, tokens.css keys all three. The org-default route (`src/app/api/org/preferences/route.ts`) still validates `["compact","cozy"]` and must accept `comfortable`. | shell/API step |
| `data-chrome` reads the stored `theme.chrome` (8.5 step 8) | always `navy` | the rail still paints `color:#fff` on `--os-brand-rail` (aliased to the chrome bg), so a stored light flip blanks it until the shell reads `--os-chrome-fg`. Tokens for the flip are complete and probe-verified. | step 3 wires, step 8 exposes |
| `--os-brand-rail` / `--os-brand-dark` alias to the chrome bg (8.1) | as specified | 47 content-side call sites (`bg-[var(--os-brand-rail)] text-white`, focus borders) now read a chrome token on the canvas. Add to the step 3 / 5 grep list. | step 3 / 5 |
| dark navy frame `#0C0F14` vs canvas `#101215` | as specified (1.02:1) | reads as one field in the dark captures; 1.5 already names the fallback. Founder's dark review decides. | founder review |

---

## 9. Reference fidelity: what was adopted, adapted, rejected from the Zoho screenshots

| Zoho principle | Verdict | How, and why |
|---|---|---|
| Dark navy rail + top bar framing a white canvas | **Adopted** | `#1B2537` (cooler and one step darker than Zoho's ~`#1F2B45`, same hue family as our slate ramp); white canvas; 15.37:1 (v) |
| White rounded-square active pill on navy | **Adopted** | 40px radius 8, plus a 10px label beneath (Zoho's rail is unlabelled; labels are our zero-training rule) |
| Light-grey secondary sidebar of flat icon + label rows, generous height, grey pill active | **Adopted** | N50, 36px rows (Zoho ~44 at 2x), 20px icons, 15px labels, N200 pill; width 264 not 325 |
| Uppercase section labels with a rule to the right edge (PINNED APPS / OTHER APPS) | **Adopted** | 11/600 uppercase +0.06em `--os-ink-2` with a 1px rule |
| Per-module search field in the sidebar | **Adapted** | rendered only when the tree exceeds 12 rows; our hubs are grouped and short |
| Page title / text-tab saved views / one toolbar (Filter + Sort + view switcher left, ONE blue Create right) | **Adopted** | verbatim stack; title 22 (Zoho ~24), views as grey text-tab pills, toolbar 44 with 36px controls; blue where Zoho is blue |
| Split-arrow Create button and bordered "…" square | **Adopted** | 36px split with a 24% white divider; bordered 36px "…" |
| Filter side panel inside the content, checkbox rows, own search; table narrows | **Adopted** | 272px bordered card, 36px checkbox rows, 220ms width tween |
| Bordered white table card, hairline rows, no zebra, checkbox column visible, inline "All ▾" header filter, pinned column-settings icon, footer "Total Records 644 · 1 to 40" | **Adopted** | `TableCard` 5.1; checkbox visible at rest at Comfortable density, hover-only at Cozy / Compact |
| Tall calm rows (~75px at 2x because emails wrap) | **Adapted** | 44px Comfortable rows with a content-height budget; wrapping allowed only on columns flagged `wrap` at Comfortable |
| Big readable type (~17px at 2x rows, ~24 titles, ~13 uppercase labels) | **Adapted** | 15px rows and sidebar, 22px title, 11px uppercase labels; 14px body stays (existing convention) |
| 20px thin-line icons, one weight | **Adopted** | Lucide 1.5px at 20 in the chrome, sidebar and filter panel |
| Quiet illustration empty states + one grey sentence | **Adapted** | illustration is the four-dot line art in N300 (our only illustration language), one sentence, at most one text link; Zoho's clouds / documents / red prohibition circle are not copied |
| Pale-blue widget header strip on Home | **Adopted** | `--os-widget-head-bg` `#EEF3FB`, the only tinted band in the product |
| Green presence dot on the avatar, red attention dots on icons | **Adopted** | `--os-chrome-presence` / `--os-chrome-attention` with lifted values on navy (Zoho's exact greens would fail at 3.06:1) |
| Collapse chevron button at the sidebar's bottom edge | **Adopted** | |
| Zoho reds / corals / purples ("New Dashboard" coral, "What's new" purple, orange home icon) | **Rejected** | blue `#0073EA` is the only CTA colour; no purple anywhere; the home icon is neutral |
| Three navigation layers (Zoho One rail + CRM top text tabs + secondary sidebar) | **Rejected** | one rail + one sidebar + one top bar; the top bar carries the hierarchy breadcrumb, search and actions, never a second tab row |
| Bottom Cliq dock | **Rejected** | Talk stays a hub; the call dock is a reserved 320×64 region that renders only during a call |
| Product wordmark "CRM" in the top bar | **Rejected** | the four-dot logo at the rail top is the brand mark; the top bar starts with ‹ › and the breadcrumb |
| Unlabelled rail | **Rejected** | labels under every hub icon (hard constraint) |
| 325px sidebar and the 20-row CRM module list | **Rejected** | 264px, grouped and access-scoped |
| Zoho's icon family | **Rejected** | Lucide |
| Numeric red badge on the bell | **Adapted** | a 6px dot, no count, on the rail and bell; counts live in the Inbox row |

---

## 10. Open decisions for the founder (with the recommendation this spec assumes)

1. **Navy chrome or light chrome as the default?** Recommendation: **navy**. It is what the Zoho screenshots show, it is the single strongest lever away from "photographs like monday", the four dots on navy are the ownable moment, and the splash and the chrome become the same surface. The light flip is fully tokenised and one attribute away; ship it as a preference after the navy pass.
2. **Default data density: Comfortable 44 or Cozy 36?** Recommendation: **44** for Boards, Lists, People and doc lists (the calm the founder called clean), **Compact 32** for the Tables module; the three-step preference and admin default make this reversible without a token change.
3. **Does "crazy simple" supersede the exact-ClickUp-parity mandate for the shell, the three-row header, text-tab views (no underline), pale group headers and drawer-first tasks?** Recommendation: **yes** for shell, header, tabs, group headers, settings, empty states and menus; List / Board / Calendar / Gantt / task-detail internals stay restyled-not-restructured. The header stack does not ship until this is answered.
4. **Status column: keep the solid-column exception as an opt-in Display option, or pale everywhere?** Recommendation: **opt-in, off by default**, so default screenshots are pale and dense scanners keep the option.
5. **Loader: splash first open per day (plus after login, skippable) versus every open?** Recommendation: **first open per day**. The navy splash now reads as the frame opening rather than an overlay, which preserves the mission moment without blocking every navigation.
6. **Remove the 11-accent picker (Q4) and replace it with Theme + Chrome + Density?** Recommendation: **remove**. The purple-family accents are deleted either way; the chrome switch is the personalisation lever.
7. **Inter or keep Figtree (Q5)?** Recommendation: **Inter**. Blue + Figtree + grey photographs as monday; the scale is family-independent if the answer is Figtree.
8. **Home: My work (date-bucketed) or first Space overview (Q7)?** Recommendation: **My work**, with the Space overview one sidebar row away.
9. **User-chosen Space / Folder icon colours (Q6): neutral only, or opt-in from the eight muted hues?** Recommendation: **neutral by default, opt-in from the eight**; the eight now carry verified dark values.
10. **Dark mode in the first release, or light only until the navy chrome has been reviewed in dark?** Recommendation: **light first**; keep the dark toggle behind the existing preference, review the `#0C0F14` frame once, then enable. Marketing stays light only.
