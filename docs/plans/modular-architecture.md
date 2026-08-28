# WorkwrK as a Modular System — core + toggleable premium modules

**Date:** 2026-08-27 · **Status:** PLAN, awaiting approval
**Mandate (user):** "WorkwrK is a system now — divide it into parts. Work, Planner, AI, Teams come with the SaaS. Talk is an external toggle (Slack+Zoom grade). Tables is an external toggle (Google Sheets + Zoho Sheet grade — go learn Zoho's features). Docs/Library/Forms/Clips stay in the core. Remove Dashboards. Goals/Timesheets/Review-cycles: decide later. Settings gets toggles that activate the extra parts. Later, add Accounting and more the same way."

---

## 1. The module taxonomy

**CORE — ships with every subscription, always on:**
- **Work** (`home`, project management: Spaces → Folders → Boards → Items, the PPMS spine)
- **Planner** (`planner`, calendar + my-work)
- **AI** (`ai`, Sidekick + agents)
- **Teams** (`teams`, people/org/KRA-KPI — manager-tier)
- **Docs** (`docs`)
- **Library** (`library`, files + whiteboards + notes)
- **Forms** (`forms`) — part of Work
- **Clips** (`clips`) — part of Work
- SOPs (`sops`), Settings, Trash stay core-infrastructure.

**PREMIUM MODULES — off by default, flipped on per-org in Settings → Modules:**
- **Talk** (`chat`, /tlk) — Slack + Zoom grade (already built; becomes toggleable)
- **Tables** (`tables`) — Google Sheets + Zoho Sheet grade (built to Sheets parity; roadmap to Zoho parity below)
- **Accounting** (future) — the pattern's proof that new suites plug into the same slot

**REMOVE:**
- **Dashboards** (`dashboards`) — user sees no use case. Scope is small (§5).
- Note: keep the *singular* `/api/dashboard/*` (person/team dashboards inside Teams) — different feature.

**DECIDE LATER (proposal for your confirmation):**
- **Goals** (`goals`, OKRs) → CORE (alignment is core to a PPMS)
- **Timesheets** (`timesheets`) → PREMIUM module (billing-adjacent, not everyone needs it)
- **Review cycles** (`reviews`) → part of Teams (performance lives with people)
- The rest of the People/Knowledge/Build apps (candor, announcements, kudos, surveys, tools, assets, policies, contracts, automation, marketplace) stay as they are (access-tier gated), out of scope for this change.

---

## 2. The architecture problem: THREE half-built systems to unify

The recon found three parallel, mostly-disconnected substrates:

1. **The ACCESS rail** — `OrgPreference.sidebarDefault.apps` (order/hidden/minAccess) + `lib/rail-apps.ts` + `settings/apps`. Wired end-to-end, but **display-only** (routes stay reachable by URL) and keyed by the catalog `AppEntry.key`.
2. **`enabledModules`** — a JSON array on `Organization.settings`, with a toggle UI at `settings/modules`, but its 9 keys don't match app keys and **nothing consumes it at runtime**.
3. **`ProductInstallation`** — a full per-org entitlement table (`@@unique([organizationId, productId])`, status ACTIVE/PAUSED/REMOVED) with install/pause/remove APIs already built and seeded at setup — but **dormant**, no UI reads it.

**Decision: one namespace, one gate.**
- **Namespace:** the catalog `AppEntry.key` (28 entries, the complete list). Everything keys off this.
- **Entitlement store:** activate `ProductInstallation` — it already exists with API + seed and is the correct per-org table. Bridge `Product.legacyModuleKey` → app `key` so the catalog and the entitlement table speak the same language. (`enabledModules` and the `settings/modules` 9-key UI get retired/rekeyed to this.)
- **The gate is TWO layers, both required** (learned from the "display-only" trap):
  - **Display:** add `tier: "core" | "module"` + `moduleKey?` to `AppEntry`; `visibleRailApps` hides a `module` app whose entitlement isn't ACTIVE. A disabled module leaves the rail AND the More grid.
  - **Route:** `lib/page-gates.ts` (already the server enforcement point) rejects a disabled module's routes with a clean "This module isn't enabled — turn it on in Settings → Modules" screen, so a bookmarked `/tlk` can't bypass the toggle.

**Billing tie-in (later, not this phase):** `ProductInstallation` already sits next to `Subscription`/`Plan`. A module toggle can later check plan entitlement before allowing activation (e.g. Talk requires GROWTH+). This phase just makes the toggle *work*; pricing gates layer on after.

---

## 3. Phases

### Phase 1 — the module system (make toggling real)
- `AppEntry` gains `tier` ("core"/"module") and the reused entitlement bridge. Tag Talk + Tables as `module`; everything in §1-core as `core`.
- `ProductInstallation` becomes the source of truth: a `lib/entitlements.ts` resolves "which modules are ACTIVE for this org" (cached in shell-context alongside `railApps`).
- `visibleRailApps` filters out non-active `module` apps. `page-gates.ts` blocks their routes with an honest "enable in Settings" page.
- **Settings → Modules** rebuilt: one clean page listing the premium modules with a real toggle + a one-line description + "what it competes with" (Talk = Slack+Zoom, Tables = Sheets). Flipping it writes `ProductInstallation` and the rail updates live. Retire the mismatched 9-key `enabledModules` UI.
- Default state: **new orgs get Talk + Tables OFF** (they're premium); existing orgs (Cashkr) get them ON so nothing disappears for you.

### Phase 2 — remove Dashboards
- Delete the `dashboards` catalog entry + `DashboardsSidebar`, the two `/dashboards` pages, the plural `/api/dashboards/*` routes, and the command-palette/create-menu references. Keep singular `/api/dashboard/*` (Teams person/team dashboards). Redirect `/dashboards` → `/today` for any stale links.

### Phase 3 — Goals/Timesheets/Reviews placement (on your confirm)
- Apply the §1 "decide later" proposal once you approve it: Goals→core, Timesheets→module, Reviews→Teams. Pure re-tagging on the new system.

### Phase 4 — Tables to Zoho/Sheets parity (the big one; its own sub-roadmap, §4)
### Phase 5 — Talk parity maintenance (§6) + future modules (Accounting) as proof of the pattern

---

## 4. Tables → Google Sheets + Zoho Sheet parity

**Where we are:** virtualized grid, cell selection + full keyboard nav, Excel/Sheets clipboard, fill handle, per-cell formula engine (36 functions, dep-graph recalc), undo/redo, per-column number formatting, conditional formatting (editor just restored), find & replace, Cmd+; date stamp, frozen header + first column, sort/filter, streaming for large sheets, cell styling (B/I/U/color/align), relational columns (link/lookup/rollup). Already strong Sheets-grade.

**Gap analysis vs Sheets + Zoho (Zoho's headline features: 400+ functions, data validation with pick-lists/checkboxes, 4 conditional-formatting styles incl. color-scales/data-bars/icon-sets, freeze up to 5×5, named ranges, array formulas, pivot tables + slicers, 40 chart types, cell/range/sheet locking, audit trail, Zia AI for data-cleaning/OCR):**

Phased to close it:
- **4a — Data validation** (Zoho's most-used power feature): per-column rules — dropdown/pick-list (from a list or a range), checkbox (have it), number/date range, "reject vs warn". This turns a sheet into a light app. High value, moderate build.
- **4b — Function library to ~150+**: we have 36. Add the Sheets/Zoho daily-drivers — full lookup family (VLOOKUP/HLOOKUP/XLOOKUP/INDEX/MATCH — some exist), text (SPLIT, JOIN, REGEXEXTRACT, TEXT), date (WEEKDAY, EOMONTH, NETWORKDAYS), logical (SWITCH, IFS), math/stat (ROUND family, RANK, PERCENTILE), and the big one: **array formulas / spill** (ARRAYFORMULA, FILTER, SORT, UNIQUE) — Zoho's flagship. Array/spill is the largest engine change.
- **4c — Conditional formatting v2**: color scales, data bars, icon sets (Zoho parity) on top of the value-rule editor we just restored.
- **4d — Named ranges** + reference-by-name in formulas (Zoho "Define Name").
- **4e — Pivot tables + charts**: the analysis layer. Pivot is a big build; charts can reuse a lib. Slicers after.
- **4f — Locking + audit**: cell/range/sheet lock (permissions inside a sheet) + a change audit trail. Pairs with the entitlement work.
- **4g — Row soft-delete** (already-identified data-safety gap: `DataTableRow.deletedAt` + trash, so a bulk delete survives a refresh).
- **4h — AI (Zia-equivalent)**: reuse the AI module — "clean this column", "make a formula for…", "summarize this range". Ties Tables to the core AI, showing modules compose.

Each 4x ships behind the fleet, one at a time, once Tables is a live premium module.

---

## 5. Talk parity maintenance
Talk is already Slack×Zoom grade (chat, channels, threads, reactions, mentions, formatting, search, huddles with live presence + join, guest links, calls on our own LiveKit). Keep it there. Known follow-ups already tracked: search-result message anchoring, thread-unread surfacing (fixed today), presence heartbeat, call recording, dedicated calls box. No new scope here — just don't let the module toggle regress it.

---

## 6. Rollout + safety
- Phase 1 is the risky one (gating). Ships with existing orgs' modules forced ON so nothing vanishes for current users; the toggle only changes what NEW orgs get and what an admin can turn off.
- Every phase: fleet review, tsc + tests, prod artifact verify, honest "module disabled" states (never a blank screen).
- One migration expected (Phase 1 may add a column or lean entirely on `ProductInstallation`; decided at build time). Dashboards removal is delete-only.

## 6b. Phase 1 — BUILT (2026-08-28)

Shipped the module system on `ProductInstallation`:
- `src/lib/modules.ts` — the ONE registry bridging rail app key ↔ product slug (chat↔workwrk-talk, tables↔workwrk-tables). Read by rail gate, route gate, resolver, Settings.
- `src/lib/entitlements.ts` — `getActiveModuleAppKeys` / `isModuleActive` (ACTIVE only; PAUSED/REMOVED/missing = OFF).
- Rail gate: `visibleRailApps` hides a module unless active (both resolve branches; never strands — Home is alwaysPinned core). Fed via `/api/preferences` → `effective.modules.activeAppKeys` (resolved concurrently, no added latency).
- Route gate: server `layout.tsx` at `/tlk` + `/tables` → `ModuleDisabledScreen` when off.
- Settings → Modules rebuilt to toggle `ProductInstallation` live (dead 9-key `enabledModules` UI retired; `enabledModules` still written by setup but reads nothing).
- New-org OFF enforced at both write choke points (`api/setup` + `scripts/seed-products` strip `MODULE_SLUGS`); existing orgs backfilled ACTIVE via `scripts/backfill-modules.ts`.
- **Rollout order (critical):** run `backfill-modules.ts` against prod BEFORE the gated code serves, or existing orgs' modules vanish until it runs.

Verified by a 3-lens adversarial fleet: gating logic sound (ACTIVE-only, org-scoped, no strand, no flicker, correct fallback), rollout safe after the two fixes above.

### Deferred to Phase 1.5 (known, documented — NOT a Phase-1 blocker)
- **API-layer gating.** The gate is display + route (page) only; the module's data APIs (`/api/tables/*`, Talk `/api/conversations/*`) are still reachable by a crafted request within the caller's own org (org-scoped, so NO cross-tenant leak — an entitlement bypass, not a breach). Add a shared `requireModule(orgId, slug)` helper to the module-owned API routes. Matters most once billing gates activation.
- **Public `/embed/tables`** (isPublic sheets) is not module-gated — a published-artifact surface, orthogonal to the in-org toggle. Decide whether disabling a module should revoke existing public embeds.
- Command-palette "recents" can still list a disabled module (route gate catches the click).

## 7. Open questions for you
1. **Goals/Timesheets/Reviews** — confirm the §1 proposal (Goals→core, Timesheets→module, Reviews→Teams) or re-assign.
2. **Talk + Tables default for NEW orgs** — off (true premium, upsell) or on-with-trial? Plan assumes off.
3. **Tables roadmap order** — I recommend 4a (data validation) → 4b (functions + array/spill) → 4c (cond-format v2) as the highest-value Zoho-parity wins first; pivots/charts (4e) later. Confirm or reorder.
4. **Build now vs plan-only** — this doc is the plan; say go and I start Phase 1 (the module system), which unlocks everything else.
