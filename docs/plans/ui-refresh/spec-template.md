# Per-surface spec template (Phase 3)

Every Phase 3 spec file follows this structure exactly, so the specs can be read side by side and checked by the critic. Headings are fixed; fill every one (write "none" rather than omitting). No em dashes or double hyphens anywhere in prose. Reference the design system by token/component name (from design-system.md), the access model by role/object-role name (from access-model-spec.md), and settings by their settings-architecture.md path.

```
# <Unit name> spec

## 0. Scope
- Routes covered (every URL in this unit, one per line, with its file path under src/app)
- Routes in this unit that are REMOVED / REDIRECTED / MERGED (with the target and the reason; every destination stays reachable somewhere)
- Audit inventories consulted (file names)
- Audit issue IDs this unit resolves (from the inventories' numbered issues and critic-gaps.json topSystemicIssues)

## 1. Unit-level rules
- Hub + sidebar: which rail hub is active on every route here; which secondary-sidebar item is active (URL-derived, never sticky)
- Hub sidebar contents (ONLY for the unit that owns a hub): every section, group and row of that hub's secondary sidebar in order, with label, icon, href, gating (role/tier/module), badge/count, collapsed-by-default, and the create action in the header; rows owned by another unit are listed by reference ("Spaces tree: see spaces-lists §1")
- Naming canon: the ONE label for each destination in this unit (list old labels it replaces)
- Access: who can reach each route (org role, object role, manager chain), what a read-only viewer sees, the denial behaviour (one convention)
- Back / close: the back target of every detail route (fallbackHref), the close target of every drawer/modal, and what Esc does
- Mobile / narrow: what collapses, what stays

## 2. Route specs (repeat this block for EVERY route)
### <URL>  (<page file>)
- Purpose (one sentence, user's words)
- Who sees it (roles) and entry points (every way to arrive: rail, sidebar, link, search, shortcut, deep link, notification)
- Top bar: left / centre / right contents on this route (breadcrumb text, back button yes/no + target, title, search, actions)
- Secondary sidebar: which hub sidebar, which row is active, which groups are expanded
- Page header stack (per design system): title, subtitle/meta, text-tab views (list them), toolbar left (Filter, Sort, Group, Display, view switcher: which apply), toolbar right (the ONE primary button label + its secondary menu items)
- Body layout: sections and subsections in reading order, with every control in each (label, what it does, what it calls) and every data field shown
- Side panel / drawer / modal used here (name, width, what opens it, what closes it)
- States: loading (which loader), empty (illustration + sentence + the single action), error (message + retry), read-only, denied, offline/session-expired
- Keyboard: shortcuts that work here
- Data: existing APIs used (path), new API needed (path + shape), settings it reads
- Realtime: what updates live and how (event/poll)
- What changes vs today (bullet delta against the audit inventory; be explicit about removed fake chrome, dead links, cosmetic settings)
- Open questions (only genuine ones for the founder)

## 3. Shared components this unit introduces or requires
- Name, where it lives, props summary, which routes use it (only if not already in design-system.md)

## 4. Migration / build notes
- Order of work for this unit, what can ship independently, what is blocked on another unit, data migrations

## 5. Checklist against the audit
- For each audit issue ID in §0: one line "resolved by <route/section>" or "deferred because <reason>"
```
