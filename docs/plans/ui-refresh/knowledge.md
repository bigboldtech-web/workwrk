# UI Audit: Knowledge subsystem (Docs, Library, Canvas, Files, SOPs, Process runs, Policies, Contracts, Templates)

Audited 2026-09-10, read-only, from source under `src/app/(dashboard)`, `src/components/{docs,canvas,sops,agreements,files,templates,settings}`, `src/lib/canvas`, `src/components/layout/os/{apps-catalog,docs-sidebar,click-sidebar,title-bar,empty-view,back-button}`. All file:line references are relative to the repo root `/Users/bigboldtechnologies/theywrk`.

---

## 0. How this subsystem is wired into the shell

### 0.1 Rail hub: "Docs"
- Rail entry `docs` (`src/components/layout/os/apps-catalog.tsx:1197-1201`): `defaultHref: "/docs"`, `matchPaths: ["/docs", "/library", "/canvas", "/notetaker", "/clips", "/sops", "/process-runs", "/policies", "/agreements"]`, `Sidebar: DocsSidebar`, `createActions: [{ label: "New doc", event: "docs-new-page" }]`.
- Every route in this subsystem highlights the Docs rail icon and shows `DocsSidebar` as the secondary sidebar, because `findAppForPath` skips `offRail` apps (`apps-catalog.tsx:1380-1388`).
- Exception: `/files` is claimed by the **Work (home)** hub (`apps-catalog.tsx:1173` includes `/files` in home matchPaths), so the drive page renders with the Home sidebar (Inbox / My Wrk / Spaces), not the Docs sidebar. `/templates` matches no hub at all, so it falls back to `APPS[0]` = Home (`click-sidebar.tsx:89`).

### 0.2 Folded apps (dead or near-dead sidebars)
Marked `offRail` by `FOLDED_INTO_HUB` (`apps-catalog.tsx:1350-1359`): `library`, `sops`, `policies`, `agreements` (and `clips`). Their own `Sidebar` components still exist:
- `LibrarySidebar` (`apps-catalog.tsx:1054-1067`): All / Notes / Canvases / Files + a permanent "Favorites: Star an item to see it here" stub. Never rendered by route match; only if the user launches "Library" from the More popover (`apps-more-popover.tsx:95-98` calls `setActiveApp(app.key)` then pushes `defaultHref`). Because `activeAppKey` wins over route matching (`click-sidebar.tsx:85-90`) the folded sidebar then sticks until another rail icon is clicked.
- `sops` linksSidebar (`apps-catalog.tsx:1290-1295`): All SOPs / My SOPs / Run history / Compliance. Same launch-only visibility. **These four links are the only sidebar-level path to My SOPs, Run history and Compliance**; `DocsSidebar` only has a single "SOPs" link.
- `policies` linksSidebar (`apps-catalog.tsx:1298-1301`): All policies / Compliance.
- `agreements` linksSidebar (`apps-catalog.tsx:1305-1309`): All contracts / Templates / **Trash (`/agreements?view=trash`, which the page does not implement, see 3.x)**.
- `sops.createActions` (4 rows: written / step-by-step / checklist / click-capture) and `agreements.createActions` (New contract) only surface on the sidebar "+" when that folded app is the active app; on the Docs hub the "+" only offers "New doc".

### 0.3 DocsSidebar (`src/components/layout/os/docs-sidebar.tsx`)
Rendered for every route in scope (except `/files`, `/templates`). Sections, top to bottom:
1. Primary nav (`:119-151`): All Docs, My Docs (count badge), Shared with me (count badge), Private, Meeting Notes, Archived. Each is `/docs?view=<key>`; active only when `pathname === "/docs"`.
2. **Content** (`:154-160`): Notes (`/library?tab=notes`), Canvases (`/library?tab=whiteboards`), Files (`/library?tab=files`), Clips (`/notetaker`). Active-state bug: only the Notes row carries `active={pathname.startsWith("/library")}` so on `/library?tab=files` the "Notes" row is highlighted, never "Canvases"/"Files" (`:156-158`).
3. **Process** (`:163-168`): SOPs (all users; also active for `/process-runs`), Policies (hr-admin only), Contracts (hr-admin only).
4. **Favorites** (`:171-180`): docs only, read from `/api/preferences effective.home.favoriteDocIds`; empty card "Star a Doc to see it here".
5. **Pages** (`:184-196`): Notion-style nested tree of ALL org docs (not only mine), hover "+" (add sub-page) and "…" (NoteActionMenu: rename / duplicate / copy link / star / trash). "New page" row at the bottom. Expansion state persisted in localStorage `workwrk:docs:pages-open`.
6. **Popular Wikis** (`:199-200`): permanent stub card "Most viewed and active Wikis appear here". Nothing feeds it.
- Sidebar-search (the hub header search) filters Favorites + Pages (flat list) only.
- Header "+" dispatches `workwrk:os:new:docs-new-page` which creates a root page and navigates to `/docs/<id>?new=1` (`:90-100`).

### 0.4 Top bar
The global ClickUp-style top bar (`click-topbar.tsx`) is unchanged across these routes. Per-page "title bars" are rendered inside the page body via `OsTitleBar` (`src/components/layout/os/title-bar.tsx`), which is a legacy component:
- It renders a **gradient icon tile** (`iconGradient`) per page, a description string, optional fake "people" avatars, page `actions`, and, unless `showStandardActions={false}`, a trio of **Ask AI / Share / Invite buttons that have no onClick handlers at all** (`title-bar.tsx:87-115`). These are pure decoration and are visible on `/library`, `/docs/trash`, `/canvas`, and the load-error state of `/sops/new/text` (`sops/new/text/page.tsx:244`).
- Pages in scope that do NOT use OsTitleBar: `/docs`, `/docs/[id]`, `/canvas/[id]`, `/files`, `/templates`, `/sops/[id]`. Each has a bespoke header.

### 0.5 Style systems in play (this subsystem alone uses at least five)
1. Tailwind zinc utilities + `--os-*` tokens, flat #0073EA brand (docs list, SOP list, policies list, agreements, policy detail): the intended Monday-clean style.
2. `OsTitleBar` + BEM classes in `os.css` with gradient icon tiles, KPI tiles with colored accent bars (`.mys__*`, `.prun__*`, `.cmpl__*`, `.wb__*`, `.filesp__*`, `.tmpl__*`, `.trash-*`, `.docs__*`): pre-ClickUp-parity "OS" look.
3. shadcn primitives (`Card`, `Button`, `Badge`, `Tabs`, `Dialog`, `Select`, `Progress`, `Skeleton`) + the **legacy lime accent** `rgba(212,255,46,…)` / `var(--accent-strong)` and dark-theme leftovers (`text-green-400`, `text-orange-400`, `bg-zinc-100` step cards): `/sops/[id]` (13 lime occurrences), `components/sops/{category-tree,folder-tree,folder-manager,tag-chips}.tsx`.
4. Inline `style={{…}}` objects to defeat the global `.workwrk-os button` reset (SOP/Policy status pills, SOP-detail tab strip, `/sops/new` cards, the whole canvas toolbar and AI panel).
5. `dark:` Tailwind variants sprinkled in `sop-tag-input.tsx` (7), `block-doc-editor.tsx` (4), `sops/[id]/page.tsx` (2), `docs/page.tsx` (2) while the app is light-only.

---

## 1. Route inventory

Field key: **Reach** = how a user gets there; **Back** = back affordance and target; **Top bar** = page-level header controls (global top bar is constant); **Sidebar** = secondary sidebar when active; **Controls** = every option/setting; **State** = polished / rough / broken / stub; **Issues**.

### 1.1 `/docs`  (Docs home, "All Docs")
- File: `src/app/(dashboard)/docs/page.tsx` (623 lines) + `docs/layout.tsx` (mounts `DocTabsBar`).
- Purpose: ClickUp-style docs table: Name / Location / Date updated / Date viewed / Contributors, with `?view=` variants.
- Reach: Docs rail icon (defaultHref) ; DocsSidebar primary nav (6 views) ; in-page tab strip (All / Recent / Favorites / Created by me) ; `BackButton fallbackHref="/docs"` from every doc ; "Docs" breadcrumb in the editor.
- Back: none (hub root).
- Top bar (page header, `:248-296`): title = view label ; **Import** (toast "Import is coming soon", `:254`, stub) ; **New Doc** split button (blank, or dropdown: Blank doc / From template x3 hardcoded). Above the table: `DocTabsBar` (open-note tabs, browser-style, localStorage `workwrk:doc-tabs`, ⌘/Alt+1..9).
- Sidebar: DocsSidebar (view rows highlight).
- Controls: Templates row (3 hardcoded cards: Project Overview / Meeting Notes / Wiki "verified" tick, `:94-98`; each just creates a doc with a title and emoji, no body) ; Filters popover (by Location, multi-select + "No location") ; Sort popover (Date updated / Name / Location, toggling direction) ; search box (title + excerpt) ; sortable column headers ; row hover actions: Copy link / Star / Open (pencil) ; row "…" and right-click → `NoteActionMenu` (rename, duplicate, copy link, star, trash) ; empty-state "New Doc" CTA on all/my views.
- Views (`:170-181`): `my` = createdById is me ; `favorites` ; `recent` = has a recent-view marker ; `meeting` = **title regex** `/meeting|minutes|stand.?up|1:1/i` ; `private` = mine AND no entityType ; `shared` = **any doc attached to an entity** (`!!d.entityType`), i.e. "Shared with me" is really "attached to a Space/Board/Folder/Item", not sharing ; `archived` = server `?archived=1`.
- State: **polished** visually (closest to the target style) but the view semantics are heuristics.
- Issues:
  - "Shared with me" and "Private" are mislabeled heuristics (see above), and the DocsSidebar badge counts use a third definition (`docs-sidebar.tsx:104-111`: shared = created by someone else).
  - "Meeting Notes" view is a title regex; a meeting-notes template doc titled anything else is invisible there.
  - "Import" is a stub toast.
  - Archived view duplicates `/docs/trash` (both call `?archived=1`) but only Trash offers Restore; Archived rows open the editor.
  - `dark:ring-zinc-900` on contributor avatars (`:561,566`) in a light-only app.
  - No explicit loading skeleton: text "Loading docs…"; error is a plain sentence with no retry.
  - The "Templates" strip cannot be hidden or extended; the real Template Center (task/list/space templates) is a different system.
  - Docs from Spaces appear here too, so "All Docs" mixes standalone notes with Space docs (Location column is the only cue).

### 1.2 `/docs/[id]`  (Doc editor)
- Files: `docs/[id]/page.tsx` (27) → `components/docs/block-doc-editor.tsx` (2416) ; split view `doc-split-view.tsx` when `?peek=<id>` ; share `doc-share-modal.tsx` ; menu `note-actions-menu.tsx` ; pages tree `doc-pages-panel.tsx` ; tabs `doc-tabs.tsx` ; BlockNote wrapper `blocknote-canvas.tsx` + custom blocks in `blocknote-blocks/`.
- Purpose: Notion/ClickUp-style block editor with icon, cover, comments, versions, AI ask/summarize/extract-table, sub-pages, side-by-side peek.
- Reach: any doc row (docs table, Library Notes cards, DocsSidebar Pages tree / Favorites, Home sidebar Favorites, Space tree doc rows, EntityLink/backlinks, `/share/doc/<token>` public), `?new=1` after create, `?peek=<otherId>` for split.
- Back: **`BackButton fallbackHref="/docs"`** (`block-doc-editor.tsx:758`, also `:679` in the not-found/restore state). This is the only route in the subsystem that follows the BackButton convention.
- Top bar (`:753-985`): Back ; **Add subpage** ; breadcrumb "Docs / ancestors / icon Title" ; Star ; right cluster: Reading mode, Outline, **Ask** (AI panel), **Share** (dark pill → `DocShareModal`), History, Open side pane (peek picker), More (`PageActionsMenu`).
- PageActionsMenu (`:1546-1690`): search field ; Copy link ⌘L / Copy page contents / Duplicate ⌘D / Move to Trash ; Font (System / Serif / Mono) ; toggles Small text / Full width / Lock page ; AI: Summarize, Extract table ; Export as Markdown ; Version history ; Keyboard shortcuts.
- Page chrome: Add icon (NoteIconPicker: emoji / image), Add cover (gradient presets + Unsplash ids hardcoded `:101-129`), Add comment (page-level comments with attach + @mention), title input, `DocMetaStrip` (word count etc.), AI summary details, legacy-format banner "Convert to blocks", edit-conflict banner with Reload.
- Share modal (`doc-share-modal.tsx`): "Invite by name or email" → **toast "Guest invites are coming soon"** (`:229`, stub) ; "Share link with anyone" Switch (public token URL `/share/doc/<token>`) + Copy ; Private link copy ; "Share with" per-member role menu (Full edit / Can view / Default access) ; "Make private / Make workspace-visible" footer. Backed by `/api/docs/[id]/sharing` (stored on `Organization.settings.docSharing`, i.e. org-level settings blob, not on the doc).
- Sidebar: DocsSidebar; Pages tree auto-expands the ancestor chain of the open doc.
- State: **polished** (most complete surface in the subsystem).
- Issues:
  - Invite stub in Share modal.
  - `readOnly` when `myRole === "view"` but there is no visible "view-only" banner/badge in the header; the user only finds out when typing does nothing.
  - Doc sharing state lives in org settings JSON, so per-doc ACL is not queryable/reportable.
  - `dark:` classes in 4 places.
  - Cover images are hardcoded Unsplash photo ids (external hotlinks).
  - `DocTabsBar` (browser-style tab strip) is a Notion desktop pattern that does not exist elsewhere in the app; tabs persist in localStorage and can reference deleted docs.
  - Written SOPs and Policies and Contracts reuse `BlockNoteCanvas` but each has its own header/chrome, so "the same editor" looks different on four routes.

### 1.3 `/docs/trash`
- File: `docs/trash/page.tsx` (144).
- Purpose: list soft-archived notes with Restore.
- Reach: **URL-only / orphaned.** No link anywhere in `src` (grep `/docs/trash` only hits the page and layout comments). Trash from the editor "Move to Trash" toasts but does not link here.
- Back: text link **"Back to notes" → `/docs`** (`:100`, styled `.docs__new` button, not BackButton).
- Top bar: `OsTitleBar` "Trash" with red/pink gradient icon + description count + the **dead Ask AI / Share / Invite trio** (standard actions not disabled).
- Sidebar: DocsSidebar (no row highlighted).
- Controls: search (title/excerpt) ; Restore per row.
- State: **rough / legacy** (old `.docs__toolbar`, `.trash-*` BEM CSS, ValueLoader).
- Issues: orphaned ; duplicates `/docs?view=archived` and the org Trash `/trash` (hr-admin) ; error state `OsEmptyView cta="Retry"` has no `onCta`, so the CTA silently does not render ; dead title-bar trio.

### 1.4 `/library`  (Notes / Canvases / Files / Tables)
- File: `library/page.tsx` (926).
- Purpose: "unified destination for Notes, Whiteboards, and Files" (+ Tables) as card grids with Space chips.
- Reach: DocsSidebar → Content → Notes / Canvases / Files (`?tab=`) ; folded Library app via More popover ; `lib/trash.ts` restore targets ; Library "+" Upload file → `/library?tab=files`.
- Back: none.
- Top bar: `OsTitleBar` "Library" with teal gradient icon, description "Notes, whiteboards, and files, connectable everywhere", **fake presence avatars `PEOPLE.bb`, `PEOPLE.sc` and "+6"** (`library/page.tsx:102-103`, from `catalog.ts:79-81` mock data) and the **dead Ask AI / Share / Invite trio**.
- Sub-header: sticky tab pills Notes / Canvases / Files / Tables (dark `bg-zinc-900` active pill) + search input.
- Sidebar: DocsSidebar (only "Notes" row ever highlights, see 0.3).
- Controls per tab:
  - Notes: Space chips All / Unscoped / each Space ; count ; **New note** (creates "New doc", optionally tagged to a Space) ; card → `/docs/<id>` ; hover star (`DocFavoriteButton initiallyStarred={false}` always, so it never reflects real state).
  - Canvases: Space chips ; **New canvas** (prompt dialog for name) ; thumbnail cards → `/canvas/<id>` ; hover star.
  - Files: Space chips (Unscoped is client-side filtered; other chips refetch) ; **Upload** (multi, `/api/upload` then `/api/files`) ; drag-and-drop anywhere ; per-file star / download / delete (confirm dialog). No folders, no rename, no move, no AI summary.
  - Tables: Space chips ; **New table** → `/tables/<id>` ; cards show column and row counts ; hover star.
- State: **rough**: three inconsistent Space-chip implementations (Notes and Canvases refetch, Files filters client-side for "Unscoped" then refetches for a Space), placeholder comments still say "Files is a placeholder" (`:7, :444`).
- Issues:
  - Fake avatars + dead Share/Invite/Ask AI on the title bar (high: fabricated collaboration signal).
  - Files tab calls `/api/files` with no `folderId`, and the API treats missing folderId as root (`api/files/route.ts:62-63,75`), so **files inside any drive folder created on `/files` are invisible in the Library**.
  - Tables tab shown regardless of the Tables module entitlement (Tables is a gated premium module; `/api/tables` has no entitlement check either).
  - Tab state only syncs from the URL on mount/param change; clicking a pill does not update the URL, so the DocsSidebar highlight and browser Back are out of sync with the visible tab.
  - Doc favorite state in Notes cards is always unstarred initially.
  - Loading state is a text line per tab; no skeletons; errors collapse to an empty list silently (`.catch(() => setRows([]))`) so an API failure reads as "No notes yet".
  - "New note" creates the title "New doc" while the Docs page creates "New Doc" and the editor placeholder says "Untitled note": three names for one object (Note / Doc / Page).

### 1.5 `/canvas`  (Canvases gallery)
- File: `canvas/page.tsx` (261).
- Purpose: gallery of whiteboards: "Recently edited" strip + sections grouped by `productSlug` (CRM / Tasks / ITSM / Helpdesk / Recruiting / Marketing / Procurement / Finance / General).
- Reach: **effectively orphaned**: only the canvas editor's back arrow (`canvas/[id]/page.tsx:370`), delete/404 redirects, `profile-tools.ts:41` "Create Canvas" quick tool, and the block-editor embed empty-state text link. No sidebar link (DocsSidebar points Canvases at `/library?tab=whiteboards`).
- Back: none.
- Top bar: `OsTitleBar` "Canvases" with a brown gradient icon, search + **New canvas** in `actions`, plus the **dead Ask AI / Share / Invite trio**.
- Sidebar: DocsSidebar (nothing highlighted).
- Controls: search ; New canvas (prompt dialog) ; tiles (thumbnail or SVG placeholder) → `/canvas/<id>`.
- State: **rough / stale**: groups by vertical slugs (CRM, ITSM, Helpdesk, Recruiting, Finance) that were removed from the product under the PPMS scope; every real canvas lands in "General".
- Issues: orphaned ; duplicates Library → Canvases with a different look ; error `cta="Retry"` and empty `cta="New canvas"` have no `onCta` so the CTAs vanish (`:169,173`) ; dead title-bar trio ; `.wb__*` legacy CSS.

### 1.6 `/canvas/[id]`  (Canvas editor)
- Files: `canvas/[id]/page.tsx` (488) ; engine `components/canvas/whiteboard-canvas.tsx` (2397) ; AI `canvas-ai-panel.tsx` (513) ; lib `src/lib/canvas/*` (scene, render, from-spec, schema import/export, templates, sequence, import-excalidraw).
- Purpose: first-party WorkwrK Canvas (new/empty boards) or legacy Excalidraw (existing Excalidraw scenes) with autosave.
- Reach: Library Canvases cards, `/canvas` tiles, Space tree whiteboard rows (`space-tree-row.tsx:740-761`), Home sidebar Favorites, canvas cards on other canvases, `CanvasMoreMenu` in the tree.
- Back: **`router.push("/canvas")`** arrow (`:370`), always to the orphaned gallery, never to where the user came from (Library or a Space). Not BackButton.
- Top bar (`.wbc__bar`, `:369-440`): back arrow ; brand-tinted Frame glyph ; inline-editable title (blur/Enter to rename) ; Favorite star ; autosave status pill (Saving… / Save failed, retrying / Unsaved changes / Saved hh:mm / Autosave on) ; **Share** (ghost button that only copies the URL) ; "…" menu: Rename / Copy link / Delete (confirm).
- Sidebar: DocsSidebar.
- Canvas controls (first-party engine): tool strip Select(V/1) Pan(H) Rectangle Diamond Ellipse Arrow Line Pen Text Sticky Laser ; "More shapes" (rounded rect, triangle, parallelogram, cylinder, cloud, ER table) ; Frame ; Insert image ; Insert task/doc/canvas/SOP card (picker fed by `/api/me/items`, `/api/docs`, `/api/whiteboards`, `/api/sops`) ; Undo/Redo/Delete ; Export PNG ; zoom - / % / + ; selection panel: stroke/fill colors, corners, arrow types and heads (incl. ER crow's-foot), text size/align, align/distribute, lock, delete ; `CanvasAiPanel` floating button "Design with AI": generate diagram from prompt, explain/critique, ER export to SQL/Prisma, import schema text.
- Excalidraw path: Excalidraw's own UI with `changeViewBackgroundColor`, `clearCanvas`, `export saveFileToDisk`, `toggleTheme` enabled.
- State: **polished** engine, **rough** chrome: entire toolbar/AI panel are inline-styled, the "Share" button is a copy-link, no real sharing/permissions.
- Issues:
  - Two visually different editors (Excalidraw vs first-party) behind one URL depending on the board's age; Excalidraw's `toggleTheme` can flip a single canvas dark.
  - "Share" is a misnomer (copies link; whiteboards have no ACL at all beyond Space visibility on the list API).
  - Back always goes to `/canvas` (orphan gallery), breaking the "back = where I came from" rule.
  - `CanvasLoader` is a Loader2 spinner + "Loading canvas…" (not the ValueLoader convention).
  - No empty-state coaching inside a fresh canvas; templates in `lib/canvas/templates.ts` only reachable via the AI panel.

### 1.7 `/files`  (Drive)
- File: `files/page.tsx` (464) + `components/files/{move-file-dialog,file-drop-zone}.tsx`.
- Purpose: Notion/Drive-style two-pane drive: folder tree (nested) + Starred, file grid with upload/drag-drop, search, breadcrumbs, star / rename / move / delete / open, AI summarize (PDF/text/json), bulk select (Summarize / Delete).
- Reach: **URL-only / orphaned.** Only referenced by the block editor's file-embed empty state text (`block-editor.tsx:2191`) and Home hub `matchPaths`. DocsSidebar "Files" points at `/library?tab=files`, which is a different, weaker UI.
- Back: none.
- Top bar: bespoke `.filesp__head` header (icon tile "Files", subtitle with folder count) ; search form ; **Folder** (prompt) ; **Upload** (primary).
- Sidebar: **Home sidebar** (because `/files` is in the home hub matchPaths), so the user sees Inbox / My Wrk / Spaces while in the drive.
- Controls: rail: All files / Starred / folder tree with counts ; pane: breadcrumbs, drop overlay, "Uploading N…" ; file tile: checkbox, preview, star, AI summarize, open, rename (✎ glyph), move (⇢ glyph, `MoveFileDialog` to Space folder / Space / Library), delete ; bulk bar Summarize / Delete / Clear ; Space chips on tiles link to `/folders/<id>` or `/spaces/<slug>`.
- State: **rough**: complete functionality, legacy `.filesp__*`/`.ftile` CSS, text glyph buttons (✎, ⇢) instead of icons, "Loading…" text, no error retry.
- Issues: orphaned and shows the wrong sidebar ; competes with Library Files (which cannot see foldered files) ; 10 MB limit mentioned only in Library copy ; no per-file permissions (org-wide).

### 1.8 `/templates`  (Workspace templates)
- File: `templates/page.tsx` (109).
- Purpose: apply a starter bundle (Doc + Form + Table) per team type.
- Reach: Workspace menu → Settings tab → Manage → **Templates** (`workspace-menu.tsx:299`) only.
- Back: none.
- Top bar: bespoke `.tmpl__head` (icon + h1 + paragraph). No OsTitleBar.
- Sidebar: falls back to **Home** (no hub matches `/templates`).
- Controls: template cards with gradient headers ; "Apply template" (can re-apply: "Applied, apply again?") ; hint links to `/docs`, `/forms`, `/tables`.
- State: **stub-ish / legacy**: no error state (errors set an empty list → "No templates configured"), `.tmpl*` legacy CSS, "Loading…" text.
- Issues: sixth thing called "Templates" in the product (Docs page template cards, Template Center modal, `/automation/templates`, `/agreements?view=templates`, `note-templates.tsx`, this page) ; seeds Forms + Tables even for orgs without the Tables module ; no preview of what will be created.

### 1.9 `/sops`  (SOP library)
- File: `sops/page.tsx` (395).
- Purpose: card/list grid grouped by category with status pills.
- Reach: DocsSidebar → Process → SOPs ; Today page "my-alignment" link ; back links from every SOP sub-page ; folded SOPs app.
- Back: none.
- Top bar: `OsTitleBar` "SOPs" (teal gradient icon, description with counts, `showStandardActions={false}`) ; actions: **Organize** (`/sops/manage`, only `canManageSOPs`) + **New SOP** (`/sops/new`).
- Sidebar: DocsSidebar ("SOPs" row active).
- Controls: search (title/description/tags) ; category `<select>` ; grid/list toggle ; status pills All / Published / Approved / In review / Draft (inline-styled) ; sections per category ; card/row "…" and right-click menu: Open / Delete (moves to Trash, confirm).
- State: **polished** (target style), minor drift.
- Issues:
  - **No path to My SOPs, Compliance or Run history from this page or from DocsSidebar**; an IC arriving via Docs → SOPs cannot find "My SOPs" (it is only linked from `/sops/new`, `/sops/compliance`, `/process-runs`, or the folded SOPs sidebar).
  - Context-menu "Open" uses `window.location.href` (full reload) (`:313`).
  - Category dropdown AND category section headers are redundant.
  - Archived SOPs are excluded with no way to see them (no "Archived" filter), unlike Policies which has an Archived toggle.
  - Loading state is a Loader2 line; other SOP pages use ValueLoader.

### 1.10 `/sops/[id]`  (SOP detail)
- File: `sops/[id]/page.tsx` (2691) + `components/sops/sop-walkthrough.tsx`, `sop-taxonomy-picker.tsx`, `sop-tag-input.tsx`, `components/checklist-builder.tsx`, `process-flow-builder`, `custom-fields-panel`, `BacklinksPanel` from block-doc-editor.
- Purpose: view/edit any SOP kind (Written blocks/legacy body/richtext, Step-by-step, Checklist, Recording, Process flow), assign, publish/approve, run, share publicly, walkthrough, versions, compliance.
- Reach: SOP cards/rows, My SOPs rows, process-run rows (finished runs), canvas SOP cards, backlinks, `/sops/<id>?edit=1` from create flow.
- Back: **ghost icon `Button` → `router.push("/sops")`** (`:1355-1361`). Not BackButton; ignores where the user came from (My SOPs, Compliance, Today).
- Top bar: bespoke header: back, brand-tinted FileText tile, title (or `Input` when editing), badges Status / Kind / vN / autosave pill ; right: **Mark as read** (assignee) or "Acknowledged <date>" ; Edit (or Cancel/Save while editing) ; **Start run** (published checklists) ; "…" `DropdownMenu`: Submit for review / Approve / Request changes / Publish / Assign / Copy public link / Turn off public link / Walk through / Archive.
- Body: tab strip (inline-styled) Content / Compliance / Assignments (count) / History + "Show details" toggle for a right rail ; Content tab renders per kind (readers for richtext/WRITTEN/blocks, `ChecklistBuilder`, `ProcessFlowBuilder`, recorded steps with ▲▼ text buttons, step-list editor with drag + ChevronUp/Down + `RichEditor` + `StepImageEditor`), "Convert to simple steps" / "Switch to process flow" buttons, Custom fields card (edit mode only) ; Compliance tab table (User / Status / Progress / Score / Completed) ; Assignments tab table with remove ; History tab (`VersionHistoryTab`, rollback) ; Details rail: Category (`SopTaxonomyPicker`), Tags, Status, Type, Linked KRA (`SopKraPicker`), Version, Created / Published / Last updated ; "Used by tasks" card ; "Compliance Summary" card ; `BacklinksPanel` ; dialogs: Start Process Run (title / Assign To / Due date → share link), Assign SOP (department select, individual checkboxes, due date, mandatory), Publish confirm, Archive confirm ; `SopWalkthrough` slide-over ; unsaved-backup restore banner.
- Sidebar: DocsSidebar.
- State: **rough** (functionally deep, visually off-system).
- Issues:
  - Style drift: shadcn `Card/Badge/Button/Tabs/Skeleton`, 13 uses of the pre-brand lime accent `rgba(212,255,46)` / `--accent-strong` (`:528-529, :1313-1315, :1565-1566, :1902, :2003, :2139, :2314, :2413, :2667`), dark-theme colors `text-green-400`, `text-orange-400`, `text-red-400` (`:2647-2657`), `bg-zinc-100` step cards, `prose-sm dark:prose-invert` (`:342`).
  - Uses `useToast` from `ui/toast` instead of `useOsToast` (two toast systems on one page family).
  - Loading = `Skeleton` blocks (third loader style in the SOP family alone).
  - Written SOPs cannot be edited here; Edit routes to `/sops/new/text?id=` (a "new" URL used for editing existing SOPs).
  - `Select` items with `value="none"` (`:1595, :1631`) set state to the string "none", and `handleStartRun`/`handleAssign` send `assigneeId: "none"` / `departmentId: "none"` because `"none" || undefined` is truthy (`:1219, :735`). Likely a 400 or a bad row once a user picks "Anyone"/"None" after another option.
  - Compliance tab (`sop.compliance` records) and Assignments tab (`/api/sop-assignments`) are two overlapping datasets with different columns; the Details rail "Compliance Summary" counts `sop.compliance` while the header actions use assignments.
  - Recorded-step edits persist immediately (debounced PATCH) even outside of an explicit Save, while other kinds require Save: inconsistent save model on one page.
  - Header "Start run" and the "…" menu "Walk through" both play steps; no explanation of the difference.
  - Publish dialog copy: "make this SOP available to all team members" but visibility is folder-ACL based (`sop-access.ts`).
  - Tab strip and pills are inline-styled to survive the global button reset (`:1755-1801`).
  - `console.error`-only failure handling for fetchSOP; not-found state has a button but no title bar.

### 1.11 `/sops/new`  (type picker)
- File: `sops/new/page.tsx` (193).
- Purpose: choose Written / Step-by-step / Checklist / Click-capture; `?type=` deep-link auto-creates.
- Reach: `/sops` New SOP ; folded SOPs sidebar "+" (`/sops/new?type=STEPS`) ; `/sops/new/record` "Pick a different type".
- Back: none as such; title-bar links **All SOPs** and **My SOPs**.
- Top bar: `OsTitleBar` "New SOP" (teal gradient) with All SOPs / My SOPs links.
- Sidebar: DocsSidebar.
- Controls: four cards (inline-styled, **hover `translateY(-2px)` transform**, `:160`, violating the no-hover-transform convention) ; Sidekick hint banner (static text, no action).
- State: **polished-ish**.
- Issues: creates a DB row on click before the user has typed anything (abandoned "Untitled written SOP" rows) ; "STEPS" is stored as WRITTEN with `content.type = "steps"` so the type badge logic is scattered (`getSopKindLabel`) ; Sidekick banner is decorative.

### 1.12 `/sops/new/text`  (Written SOP editor)
- File: `sops/new/text/page.tsx` (337).
- Purpose: BlockNote editor for written SOPs; self-creates when no `?id`.
- Reach: `/sops/new` (Written) ; `/sops/[id]` Edit for written kinds ; `?edit=1` redirect ; folded sidebar "New written SOP".
- Back: in-body ghost button **"All SOPs" → `router.push("/sops")`** (`:283-289`); not BackButton; loses the detail page the user came from.
- Top bar: `OsTitleBar` "Written SOP" (description = save status) ; actions: **Save** ; **Publish** (or "Published" pill).
- Sidebar: DocsSidebar.
- Controls: title input ; description textarea (auto-grow) ; `SopTaxonomyPicker` (Category / Subcategory selects with inline "+ New" for admins) ; `SopTagInput` ; `BlockNoteCanvas` ; footer hint.
- State: **rough**: autosave fires a PATCH on **every editor change with no debounce** (`:209-214`), plus title/description on 700 ms; a manual Save button exists anyway.
- Issues: URL says "new" while editing existing SOPs ; no way to reach Assign/Publish-with-review/Details from here (must go back to detail) ; error state shows the OsTitleBar **with the dead Share/Invite trio** (`showInvite={false}` only hides Invite, `:244`).

### 1.13 `/sops/new/checklist`  (Checklist SOP editor)
- File: `sops/new/checklist/page.tsx` (207).
- Purpose: `ChecklistBuilder` editor (sections, steps, task/approval type, inputs: short/long text, number, checkbox, email, website, date, dropdown, multichoice, file upload ; content blocks: text, divider, image, video).
- Reach: `/sops/new` (Checklist) ; folded sidebar "New checklist SOP".
- Back: in-body "All SOPs" → `router.push("/sops")`.
- Top bar: `OsTitleBar` "Checklist SOP" (indigo gradient; the SOP family uses teal elsewhere) ; Save ; Publish.
- Sidebar: DocsSidebar.
- Controls: title ; taxonomy picker ; tag input ; builder.
- State: **rough** (autosave every 5 s while dirty, plus manual Save).
- Issues: the same builder is edited inline on `/sops/[id]` (with AI generate) but here without AI generate ; the approval badge in the builder uses dark-theme `bg-amber-500/10 text-amber-400` (`checklist-builder.tsx:354,424`).

### 1.14 `/sops/new/record`  (Click-capture setup)
- File: `sops/new/record/page.tsx` (221).
- Purpose: handshake with the "WorkwrK SOP Recorder" browser extension; instructions.
- Reach: `/sops/new` (Click-capture) ; folded sidebar "New click-capture SOP".
- Back: title-bar links **Back** (`/sops/new`) and **All SOPs** ; body links "View recorded SOPs" (`/sops`) and "Pick a different type".
- Top bar: `OsTitleBar` "Record a SOP".
- Sidebar: DocsSidebar.
- Controls: SOP title input ; **Start recording** (postMessage handshake; "Extension detected" dot; "Recording started" / "Extension not detected" hints) ; 4 instruction cards ; info banner.
- State: **stub-adjacent**: functional only with an unpublished extension; in-product copy tells users to "load it unpacked via chrome://extensions → Developer mode" (`:25`) and "publish the extension to the Chrome Web Store" (`:201`).
- Issues: dev-facing copy shipped to end users ; no link to download the extension ; three back-ish links with different labels.

### 1.15 `/sops/my-sops`  (My SOPs)
- File: `sops/my-sops/page.tsx` (256).
- Purpose: the viewer's assignments: Overdue / Active / Completed sections, KPI tiles, quick Acknowledge.
- Reach: folded SOPs sidebar ; title-bar links on `/sops/new`, `/sops/compliance`, `/process-runs`. **Not linked from `/sops` or DocsSidebar.**
- Back: none; title-bar links All SOPs / Compliance.
- Top bar: `OsTitleBar` "My SOPs" (teal gradient) ; All SOPs / Compliance links.
- Sidebar: DocsSidebar ("SOPs" row active).
- Controls: KPI tiles (Overdue / Active / Completed / Step %) ; overdue banner ; section rows → `/sops/<id>` ; per-row **Acknowledge** ; "View all N" toggle for completed.
- State: **rough / legacy** (`.mys__*` KPI tiles with accent bars, ValueLoader).
- Issues: orphaned from primary nav ; "Compliance" link goes to a manager-only dashboard that 403s for ICs ; Acknowledge on a checklist SOP with steps marks it complete without steps ; two hops (`/api/me` then assignments) ; error `cta="Retry"` has no handler.

### 1.16 `/sops/compliance`  (SOP compliance dashboard)
- File: `sops/compliance/page.tsx` (245).
- Purpose: org KPIs, by-department bars, lowest-completion SOPs, top performers, overdue list.
- Reach: folded SOPs sidebar ; My SOPs title bar ; `/policies/compliance` "SOP compliance" link.
- Back: none; links All SOPs / My SOPs.
- Top bar: `OsTitleBar` "SOP compliance" (red/pink gradient).
- Sidebar: DocsSidebar.
- Controls: read-only cards ; "View all N" toggles.
- Access: API 403 for non-managers → page shows "Couldn't load compliance / Manager access required." with a **Retry CTA that does not render** (no `onCta`).
- State: **rough / legacy** (`.cmpl__*`).
- Issues: no drill-down links (rows are not clickable, unlike the Policies version) ; reachable by ICs only to hit a 403.

### 1.17 `/sops/manage`  (Organize SOPs)
- File: `sops/manage/page.tsx` (63) + `components/settings/sop-folders-tags-manager.tsx` (+ `components/sops/folder-manager.tsx`, `folder-tree.tsx`).
- Purpose: category/subcategory tree (SOPFolder) and tag admin.
- Reach: `/sops` **Organize** button (managers only).
- Back: title-bar link **"Back to SOPs"** (`/sops`).
- Top bar: `OsTitleBar` "Organize SOPs" (teal gradient).
- Sidebar: DocsSidebar.
- Controls (manager): new category / subcategory, rename, set color, delete ; tags list with filter, add, delete. Non-managers get an `OsEmptyView` "Manager access required".
- State: **rough**: lives at a SOP sub-route although it is a settings surface; `folder-tree.tsx` / `folder-manager.tsx` still carry the lime accent ; `text-muted` classes from an older theme (`sop-folders-tags-manager.tsx:318,364`).
- Issues: taxonomy admin is separate from Settings → and separate from Policies (free-text category) and Contracts (free-text folder), three taxonomies for three sibling objects.

### 1.18 `/process-runs`  (Run history)
- Files: `process-runs/page.tsx` (281) + `layout.tsx` (`requireManagerOrRedirect()` → redirects ICs to `/dashboard`).
- Purpose: checklist-SOP executions grouped Overdue / Active / Completed + Cancelled archive, KPI tiles, cancel action.
- Reach: folded SOPs sidebar "Run history" ; Today my-alignment fallback link ; DocsSidebar highlights "SOPs" while here.
- Back: none; title-bar links SOPs / My SOPs.
- Top bar: `OsTitleBar` "Process runs" (orange/pink gradient) ; **Start run** button → **toast "Start a run from any checklist SOP"** (`:133`, dead CTA).
- Sidebar: DocsSidebar.
- Controls: KPI tiles ; search ; status pills All / Active / Overdue / Completed ; rows → `/run/<token>` (runnable) or `/sops/<id>` ; per-row Cancel ; Cancelled `<details>` archive.
- State: **rough / legacy** (`.prun__*`).
- Issues: "Start run" is a dead button ; layout redirects non-managers to `/dashboard` (a route outside the OS shell naming) with no explanation while the folded sidebar and Today page still link ICs here ; empty state CTA "Browse SOPs" has no handler so it does not render ; error Retry same.

### 1.19 `/policies`  (Policy library)
- File: `policies/page.tsx` (345).
- Purpose: card/list grid grouped by category with ack state, mirroring the SOP library.
- Reach: DocsSidebar → Process → Policies (**hr-admin only**) ; folded Policies app ; `lib/trash.ts` restore ; `/policies/[id]` "All policies".
- Back: none.
- Top bar: `OsTitleBar` "Policies" (indigo gradient) ; actions: SOPs link, Compliance link, **New policy** (quick-creates "Untitled policy" DRAFT and opens `?edit=1`).
- Sidebar: DocsSidebar ("Policies" row, hr-admin only).
- Controls: search ; category select ; grid/list ; **Archived** toggle ; status pills All / Published / Draft ; cards show ack pill ("You've acked" / "Ack required"), effective date, org ack rate.
- State: **polished** (mirrors `/sops`).
- Issues:
  - **The list API only returns PUBLISHED policies** (`api/policies/route.ts:15`), so the Draft pill, the Archived toggle, and the "Draft" count are permanently empty/zero, and a manager who quick-creates a DRAFT policy and comes back cannot find it in the list (must remember the URL).
  - Employees (non hr-admin) cannot reach `/policies` from any sidebar although the page is designed for them ("N need your ack"); their only door is the Today page my-alignment list → `/policies/<id>`.
  - "New policy" visible to everyone in the UI; API returns 403 for non-creators (handled by toast).

### 1.20 `/policies/[id]`  (Policy detail / editor)
- File: `policies/[id]/page.tsx` (538).
- Purpose: read + acknowledge (attestation checkbox) ; managers: edit (status select, effective date, free-text category with datalist, require re-ack), Assign (everyone or people + "Acknowledge by" date), Assignees list, Version history (restore), Audit ledger link.
- Reach: policy cards ; Today my-alignment ; `/policies/compliance` rows link to the ledger, not here.
- Back: title-bar link **"All policies"** (`/policies`) + "Compliance" link. No BackButton; employees arriving from Today are sent to a list they cannot otherwise reach.
- Top bar: `OsTitleBar` with the literal title **"Policy"** (not the policy's name) ; manager actions Assign / Assignees / History / Audit ledger / Edit.
- Sidebar: DocsSidebar.
- Controls: view mode: meta line, h1, ack card (progress bar, attestation checkbox, Acknowledge), History panel, Assignees panel, prose body ; edit mode: status `<select>` Draft/Published/Archived, effective date, category text+datalist, "Require re-acknowledgement" checkbox (published only), Cancel/Save, title input, `BlockNoteCanvas` in HTML mode.
- State: **polished-ish** (target style) but structurally different from the SOP detail page.
- Issues:
  - Title bar says "Policy" ; the policy title only appears in the body.
  - Category is free text (datalist suggestions HR/Security/…) while SOPs use a folder tree.
  - Assign vs org-wide `requiresAck` semantics are unexplained (ledger shows "Assigned" vs "Org-wide").
  - Edit mode switches the page to `w-full max-w-none` while view mode is `max-w-3xl`: layout jumps.
  - Status is edited via a bare `<select>` in the toolbar; publishing has no confirmation (contrast: SOP has a Publish dialog + review workflow).
  - History and Assignees are toggled panels inserted above the body instead of tabs/rail.

### 1.21 `/policies/compliance`  (Policy compliance dashboard)
- File: `policies/compliance/page.tsx` (205).
- Purpose: org ack KPIs, by-department, policies at risk, open gaps; rows link to per-policy ledger.
- Reach: `/policies` Compliance link ; `/policies/[id]` Compliance link ; folded Policies sidebar.
- Back: none; links All policies / SOP compliance.
- Top bar: `OsTitleBar` "Policy compliance" (indigo gradient).
- Sidebar: DocsSidebar.
- State: **rough / legacy** (`.cmpl__*` reuse).
- Issues: 403 for non-managers renders an error card with a non-rendering Retry ; no loading beyond ValueLoader.

### 1.22 `/policies/[id]/compliance`  (Audit ledger)
- File: `policies/[id]/compliance/page.tsx` (152).
- Purpose: per-person ledger (status, version acked, time, IP, attestation) + CSV export.
- Reach: `/policies/[id]` "Audit ledger" ; `/policies/compliance` rows.
- Back: title-bar link **"Back to policy"** (`/policies/<id>`).
- Top bar: `OsTitleBar` "Audit ledger" ; **Export CSV** (`<a href="/api/…/ledger/export">`).
- Sidebar: DocsSidebar.
- State: **polished-ish** table ; stat tiles are custom (fourth KPI-tile design in the subsystem).
- Issues: no search/filter on the table ; 403 → non-rendering Retry.

### 1.23 `/agreements`  (Contracts, plus `?view=templates`)
- File: `agreements/page.tsx` (334).
- Purpose: BreezeDoc-style contracts grouped into "folders" (category strings), templates view, create chooser (Write / Upload PDF / Template).
- Reach: DocsSidebar → Process → Contracts (**hr-admin only**) ; folded Contracts app ; `?new=1` from its createActions ; `lib/trash.ts`.
- Back: none.
- Top bar: `OsTitleBar` "Contracts" / "Contract templates" (indigo gradient) ; actions: Contracts / Templates segmented links ; **New contract** (chooser modal) or **New template**.
- Sidebar: DocsSidebar ("Contracts" row).
- Controls: folder sections with hover-pencil "Rename folder" (right-click too) ; cards (status pill, party count, signed count, date) ; card "…" / right-click: Open / Rename / Move to folder / Delete (archive) ; modals: Rename, Move to folder (datalist), Rename folder (bulk PATCH), New-contract chooser (Write / Upload PDF / Template list).
- State: **polished-ish** (target style) with gaps.
- Issues:
  - **`?view=trash` (linked from the folded Contracts sidebar) is not implemented**: `view` is only `"live" | "templates"` (`:24,39`), so the Trash link shows the live list; archived contracts are unrecoverable from this UI (only from `/trash`, hr-admin).
  - Load errors silently become "No contracts yet" (`:60-63`).
  - No search, no status filter, no sort.
  - Folder rename is N sequential PATCHes with no rollback.

### 1.24 `/agreements/[id]`  (Contract editor)
- File: `agreements/[id]/page.tsx` (252) + `components/agreements/field-builder.tsx`, `pdf-pages.tsx`.
- Purpose: title/folder, BlockNote text editing or field placement over the document/PDF, parties, send for signature, save as template, use template, archive.
- Reach: contract cards ; template "Use template" ; created from chooser.
- Back: title-bar link **"All"** (`/agreements` or `?view=templates`).
- Top bar: `OsTitleBar` "Contract" / "Contract template" (description = status) ; **Edit text / Done editing** ; **Use template** (templates) or Save as template / **Copy view link** / **Send to signers** ; Archive icon button ; All.
- Sidebar: DocsSidebar.
- Controls: title input (600 ms debounce PATCH) ; Folder text+datalist ; editor OR `AgreementFieldBuilder` (parties add/rename/remove, drag fields onto content/PDF pages) ; Signing links modal (copy per party).
- State: **rough**: fire-and-forget PATCHes with no save indicator or error handling (`:64-77`), archive navigates with `window.location.href` (full reload, `:140`), "Use template" also full-reload (`:130`).
- Issues: **"Copy view link" copies `/agreements/<id>`, which non-managers cannot open (API 403 on GET, `api/agreements/[id]/route.ts:9`)**, so the "view link" is only usable by managers ; no status transition UI other than Send ; no per-contract permissions ; Back label is just "All".

### 1.25 `/automation/templates`  (out of subsystem, listed because it matched the scope glob)
- Belongs to the AI hub (`matchPaths: ["/automation"]`). Starter-recipe gallery. Not audited in depth; noted as the fourth "Templates" surface.

### 1.26 Public routes that this subsystem publishes to
- `/share/doc/[token]` (78 lines): read-only doc.
- `/share/sop/[token]` (73 lines): read-only SOP (published only, token minted by `sops/[id]/share/route.ts`).
- `/run/[token]` (617 lines): checklist process-run runner; still uses the lime `#d4ff2e` accent (`run/[token]/page.tsx:343`).
- `/sign/[token]` (238 lines): e-signature page.
All four are unstyled relative to the app shell (expected) but the SOP runner carries the legacy accent.

---

## 2. Components in scope (notes for the redesign)

- `components/docs/block-doc-editor.tsx` (2416): header, breadcrumb, actions menu, outline, comments, Ask panel, history panel, cover/icon pickers, backlinks panel. Uses BackButton. Exports `BacklinksPanel` reused by SOP detail.
- `components/docs/block-editor.tsx` (3899): the pre-BlockNote custom block editor still used as the legacy `Block[]` mirror type and for embed pickers (file/canvas embed empty states link to `/files`, `/canvas`). `full-screen-doc-editor.tsx` (320) is **unused** (no importers).
- `components/docs/blocknote-canvas.tsx` (754): BlockNote wrapper with custom blocks (`blocknote-blocks/`: callout, columns, equation, bookmark, video embed, subpage, TOC, mention, drag menu). Used by Docs, written SOPs, Policies (HTML mode), Contracts (HTML mode).
- `components/docs/doc-tabs.tsx`, `doc-split-view.tsx`, `doc-share-modal.tsx`, `doc-pages-panel.tsx` (createChildPage helper + panel used by sidebar), `note-actions-menu.tsx` (shared row menu), `note-icon-picker.tsx`, `note-templates.tsx` (block templates, separate from the 3 hardcoded Docs-page cards), `doc-favorite-button.tsx`, `legacy-embed-preserve.ts`.
- `components/canvas/whiteboard-canvas.tsx` (2397): full engine + inline-styled toolbars ; `canvas-ai-panel.tsx` (513) ; `canvas-preview.tsx` (105, thumbnail renderer). `lib/canvas`: `scene.ts` (model), `render.ts`, `from-spec.ts` (AI spec → scene), `templates.ts`, `sequence.ts`, `schema-import.ts` / `schema-export.ts` (ER ⇄ SQL/Prisma), `import-excalidraw.ts`, `layout-quality.test.ts`; 8 vitest files.
- `components/sops/`: `sop-taxonomy-picker.tsx` (the single category door), `sop-tag-input.tsx` (dark: variants), `sop-walkthrough.tsx` (slide-over stepper, local state only), `folder-tree.tsx` + `folder-manager.tsx` (used by settings manager; lime accent), `category-tree.tsx` and `tag-chips.tsx` (**unused**, lime accent).
- `components/agreements/field-builder.tsx` (323), `pdf-pages.tsx` (82).
- `components/files/file-drop-zone.tsx` (116, generic), `move-file-dialog.tsx` (121).
- `components/templates/template-center.tsx` (372): the Template Center modal (task/list/space templates) opened from "+" menus; unrelated to `/templates`.

---

## 3. Broken / confusing (ranked)

### High
1. **Dead Ask AI / Share / Invite buttons** in `OsTitleBar` (`title-bar.tsx:87-115`, no handlers) shown on `/library`, `/docs/trash`, `/canvas`, `/sops/new/text` error state.
2. **Fabricated presence avatars** "BB", "SC", "+6" on `/library` (`library/page.tsx:102-103` using `catalog.ts:79-81` mock people).
3. **My SOPs / Run history / SOP compliance have no primary-nav entry**: DocsSidebar has one "SOPs" link; `/sops` has no links to them. ICs cannot find their assigned SOPs except via the Today widget.
4. **Policies list API returns only PUBLISHED** (`api/policies/route.ts:15`) so Draft pill, Draft count and the Archived toggle on `/policies` are permanently empty; freshly created drafts disappear from the list.
5. **Contracts sidebar "Trash" (`/agreements?view=trash`) is not implemented** by the page (`agreements/page.tsx:24,39`): shows live contracts; archived contracts cannot be restored from Contracts.
6. **Employees have no sidebar route to Policies** (row is hr-admin gated, `docs-sidebar.tsx:166`) though the page is built for their acknowledgements; only Today links to `/policies/<id>`, whose back link goes to a list they cannot otherwise reach.
7. **Library Files cannot see foldered files** (`library/page.tsx:491-495` omits folderId; API defaults to root, `api/files/route.ts:62-63,75`), while `/files` (the drive with folders) is orphaned and shows the Home sidebar.
8. **Back navigation is inconsistent**: BackButton only on `/docs/[id]`; hard `router.push("/sops")` on SOP detail; `router.push("/canvas")` (an orphan page) on canvas; text links "All policies" / "All" / "Back to notes" / "Back to SOPs" / "Back" elsewhere; none on list pages.
9. **`/sops/[id]` style drift**: shadcn primitives + legacy lime accent + dark-theme text colors + Skeleton loader + a second toast system, on the deepest page of the SOP product.

### Medium
10. `/process-runs` "Start run" button is a toast only (`process-runs/page.tsx:133`).
11. `/docs` "Import" is a toast stub (`docs/page.tsx:254`); Docs Share modal "Invite" is a toast stub (`doc-share-modal.tsx:229`); DocsSidebar "Popular Wikis" is a permanent empty card (`docs-sidebar.tsx:199-200`); LibrarySidebar / Forms / Clips "Favorites" stubs.
12. `OsEmptyView` CTAs passed without `onCta`/`ctaHref` silently do not render: "Retry" on `/docs/trash`, `/canvas`, `/sops/my-sops`, `/sops/compliance`, `/process-runs`, `/policies/compliance`, `/policies/[id]/compliance`; "New canvas" on `/canvas` empty; "Browse SOPs" on `/process-runs` empty; "Open notes" on `/docs/trash` empty.
13. SOP detail `Select` "none" sentinel is sent to the API as `assigneeId: "none"` / `departmentId: "none"` (`sops/[id]/page.tsx:1219, :735` with `:1595, :1631`).
14. Written-SOP editor PATCHes on every BlockNote change with no debounce (`sops/new/text/page.tsx:209-214`).
15. `/docs` view semantics: "Shared with me" = attached to an entity; "Private" = mine and standalone; "Meeting Notes" = title regex; sidebar badges use yet another definition.
16. Orphaned routes: `/files`, `/canvas`, `/docs/trash`, (near-orphan) `/templates`. `/files` and `/templates` render the Home sidebar.
17. Contracts "Copy view link" produces a URL non-managers cannot open (API GET is `isManager`-gated).
18. Contract editor saves are fire-and-forget with no status or error surfacing (`agreements/[id]/page.tsx:64-77`); archive and use-template do full page reloads.
19. `/canvas` groups by removed verticals (CRM/ITSM/Helpdesk/Recruiting/Finance) (`canvas/page.tsx:43-53`).
20. Library tab clicks do not update the URL; DocsSidebar only ever highlights "Notes" for any `/library` tab (`docs-sidebar.tsx:156-158`).
21. `DocFavoriteButton initiallyStarred={false}` on Library Notes cards never reflects real state (`library/page.tsx:295`).
22. `/sops/new` cards use a hover `translateY(-2px)` transform (`sops/new/page.tsx:160`) against the app convention.
23. Access mismatch: Contracts sidebar gate is hr-admin while the API gate is manager tier; SOP Compliance / Run history links are shown to ICs who then hit 403 / redirect.
24. Policy detail title bar reads "Policy" instead of the policy name; edit mode changes page width.
25. Tables tab in Library ignores the Tables module entitlement.

### Low
26. Three names for one object: "Doc" (Docs page, sidebar), "Note" (Library, editor placeholder, trash), "Page" (Pages tree, Add subpage).
27. Six "Templates": Docs page cards, Template Center modal, `/templates`, `/automation/templates`, `/agreements?view=templates`, `note-templates.ts`.
28. Three taxonomies: SOP folder tree (`/sops/manage`), Policy free-text category with datalist, Contract free-text folder with datalist.
29. Four KPI-tile designs (`.mys__kpi`, `.prun__kpi`, `.cmpl__kpi`, ledger `Stat`).
30. Gradient icon tiles per page in `OsTitleBar` (teal for SOPs, indigo for Policies/Contracts/Checklist, brown for Canvases, red/pink for Trash/Compliance, orange/pink for runs) contradict the single-accent flat direction.
31. Unused components: `full-screen-doc-editor.tsx`, `sops/category-tree.tsx`, `sops/tag-chips.tsx`.
32. `window.location.href` navigations in SOP list context menu (`sops/page.tsx:313`), contract editor.
33. Recorder page ships developer instructions ("Load unpacked", "publish to the Chrome Web Store").
34. Text-glyph action buttons (✎, ⇢) on `/files`.
35. `dark:` variants in a light-only product (`sop-tag-input.tsx`, `block-doc-editor.tsx`, `docs/page.tsx`, `sops/[id]/page.tsx`, `checklist-builder.tsx` amber-400 badges).

---

## 4. Cross-cutting conventions observed

### Back navigation
- Documented rule: `BackButton{fallbackHref}` on every detail route (`components/ui/back-button.tsx`, history-aware). Observed: only `/docs/[id]` complies. SOP detail and Canvas editor hard-push to a fixed parent; Policy/Contract/Ledger/Manage/Record/Trash use text links with six different labels ("All policies", "All", "Back to policy", "Back to SOPs", "Back to notes", "Back"); written/checklist SOP editors put a ghost "All SOPs" button inside the body, below the title bar. List pages have no back affordance (fine) but also no breadcrumb context.

### Loader
- Documented convention: `ValueLoader` (mission/values loader). Observed in scope: `ValueLoader` on 6 pages (`docs/trash`, `canvas`, `sops/my-sops`, `sops/compliance`, `process-runs`, `policies/compliance`); plain `Loader2` spinner or "Loading…" text on 14 pages; `Skeleton` blocks on `/sops/[id]`; `CanvasLoader` on `/canvas/[id]`. No `loading.tsx` route files anywhere in scope.

### Empty / error states
- `OsEmptyView` (gradient art, chips, CTA) on legacy pages; ad-hoc dashed boxes (`EmptyTab` in Library, agreements) or centered text elsewhere. Error handling ranges from a full `OsEmptyView` with a non-rendering Retry, to a sentence, to silent empty lists (Library, Agreements, Templates). No page offers a working retry except `/sops` and `/policies` (`onCta={() => void load()}`).

### Style consistency
- Target style (Tailwind zinc, flat #0073EA, `--os-*` tokens, no gradients) is met on `/docs`, `/docs/[id]`, `/sops`, `/sops/new`, `/policies`, `/policies/[id]`, `/policies/[id]/compliance`, `/agreements`, `/agreements/[id]`.
- Legacy "OS" style (OsTitleBar gradient tiles, BEM `.xxx__*` in `os.css`, accent-bar KPI tiles) on `/library`, `/canvas`, `/docs/trash`, `/files`, `/templates`, `/sops/my-sops`, `/sops/compliance`, `/process-runs`, `/policies/compliance`, and the title bars of `/sops/new/*`, `/sops/manage`.
- Legacy dark/lime style on `/sops/[id]`, `/run/[token]`, SOP folder components.
- Inline style objects used to escape the global `.workwrk-os button` reset in many places (status pills, tab strips, canvas UI).
- Primary buttons alternate between `bg-zinc-900` (Docs, Library) and `bg-[#0073EA]` / `var(--os-brand)` (SOPs, Policies, Contracts).

### Mobile / responsive
- Shell: `app-shell.css` has a 640 px drawer breakpoint for the old `.app-sidebar`; the ClickUp rail/secondary sidebar are not in scope here. Within this subsystem, `os.css` only has responsive rules for `.bdoc__page` padding (1280/1024/640), `.mys__kpis`, `.cmpl__kpis`/`.cmpl__grid`, `.prun__kpis`. Nothing for `.filesp__grid` (fixed 220px rail), `.wbc` toolbar, `.docs__`, `.sop-edit`, `.tmpl`, `.wb__`. The Docs table uses a fixed six-column grid (`docs/page.tsx:243`) with no horizontal-scroll wrapper. SOP detail hides the rail below `lg` only via grid collapse. Canvas toolbar is absolute-positioned and inline-sized. Practically: desktop-only.

### Save models
- Docs: autosave with conflict banner. Canvas: 3 s debounce + retry + unload flush + status pill. Written SOP: PATCH per change + Save button. Checklist SOP: 5 s interval + Save. SOP detail: explicit Save + DRAFT-only autosave with localStorage backup + immediate PATCH for recorded steps. Policy: explicit Save only. Contract: fire-and-forget debounced PATCH, no indicator. Six different models for "editing a document".

---

## 5. Access notes

- Rail/sidebar gating (`docs-sidebar.tsx:165-167`): SOPs visible to everyone; Policies and Contracts rows only for `canAccessTier("hr-admin")` (HR, COMPANY_ADMIN, SUPER_ADMIN).
- Routes are not gated by middleware (`src/proxy.ts` only lists app segments); only `/process-runs` has a server layout guard (`requireManagerOrRedirect`, redirect to `/dashboard`).
- API gates: Policies list GET open to all org members (published only); create needs `policies/create` permission; edit/assign need `isManager`. Agreements: every endpoint `isManager` (manager tier, wider than hr-admin). SOPs: list applies `sopVisibilityWhere` (folder ACL) ; create needs `sops/create` ; share needs `sops/edit` + author-or-folder-writer + PUBLISHED. Whiteboards: org-wide, Space-visibility gated on list only; no owner check on edit/delete beyond org. Files: org-wide, no ACL. Docs: org-wide list, per-doc sharing stored in org settings (`docSharing`), viewer role → readOnly editor.
- UI gates: `useRole().canManageSOPs` (`sops/create`) and `canPublishSOPs` drive Organize/Edit/Publish; Policy `canEdit` = `isManager` echoed by the API; Contracts rely on 403 toasts.
- Inconsistencies: (a) Contracts sidebar (hr-admin) vs API (manager); (b) Policies hidden from employees who must acknowledge them; (c) SOP Compliance and Run history offered to ICs then 403/redirect; (d) Canvas/Files have no sharing model while Docs has a full modal; (e) "New policy"/"New contract" buttons render for everyone, only the API refuses; (f) Docs sidebar Pages tree shows every org doc regardless of the per-doc "restricted" flag (the flag only affects opening).

---

## 6. Settings notes

Configurable today:
- SOP taxonomy (categories/subcategories/colors) and tags at `/sops/manage` (managers; write endpoints org-admin).
- Per-doc sharing (public link, member roles, restricted) in the Docs Share modal; stored in `Organization.settings.docSharing`.
- Doc page options (font, small text, full width, lock) per doc.
- Policy: status, effective date, category, requires re-ack per policy; `ackStatement` exists on the model but there is no UI to edit it (default attestation string hardcoded, `policies/[id]/page.tsx:45`).
- Contract: folder (category), parties, fields; templates via "Save as template".
- Sidebar: DocsSidebar Pages expansion (localStorage), open-doc tabs (localStorage), canvas engine flag `NEXT_PUBLIC_FIRST_PARTY_CANVAS` (env, not UI).

Should be configurable but is not:
- Which Docs views/tabs exist and their definitions (Shared / Private / Meeting Notes are hardcoded heuristics).
- Docs starter templates (3 hardcoded cards) and cover image set (hardcoded Unsplash ids).
- Policy attestation statement, default `requiresAck`, ack due-date defaults, reminder cadence.
- SOP review/approval workflow (who can approve; today any `canManageSOPs` user can Approve their own submission), publish versioning rules, default assignment mandatory flag.
- Contract categories (hardcoded `CATEGORY_OPTIONS` datalist in two files), signer email templates, expiry.
- File upload limit (10 MB mentioned in copy only), allowed types, storage location per Space.
- Whiteboard default engine, grid/snap defaults, sharing.
- Trash retention (60 days hardcoded in copy).
- Library: which tabs appear (Tables tab should follow the module entitlement).
- Which SOP kinds are enabled (click-capture requires an extension that has no in-product install path).
