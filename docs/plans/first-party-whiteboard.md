# First-party Whiteboard ("WorkwrK Canvas") + View-surface completion

Status: PLAN (not started). Owner: product. Created 2026-09-03.
Supersedes the Excalidraw dependency for whiteboards over a phased migration.

---

## 1. Why we are building our own

Today `/whiteboards` renders **third-party Excalidraw** (`@excalidraw/excalidraw`).
The scene is stored as an **opaque blob** on `Whiteboard.scene` (`{ elements, appState,
files }`) that we round-trip but cannot read, extend, or reason about. That is the
whole problem:

- **No control.** We cannot add a tool, change a behavior, fix a rendering bug, or
  govern the feature set. We ship whatever the library ships.
- **No integration.** A whiteboard should be part of the work graph, not a detached
  drawing. Excalidraw cannot drop a **live task card**, a **doc link**, a **KRA/KPI
  gauge**, or a **table embed** onto the canvas, and its connectors cannot create real
  `EntityLink`s. That native wiring is the entire point of an in-house canvas.
- **No governance.** It is not a module (`lib/modules.ts` / `lib/entitlements.ts` do
  not know about it), so it cannot be toggled, entitled, or curated centrally.

Owning the engine means every future enhancement — tools, templates, real-time
multiplayer, AI assists, work-graph elements — is **controlled from the top**: one
codebase, one scene format, one governance surface.

### Non-negotiables carried over from today

- **Data safety is paramount** ([[project_workwrk_data_integrity_paramount]]). The
  current save path is hard-won and must be preserved exactly: routine autosaves send
  a normal (uncapped) request; `keepalive` is used **only** on unload and only when the
  payload is under ~60 KB (the browser rejects larger keepalive bodies — this was the
  "added more and it stopped saving" bug). Every save writes a `ContentVersion`
  snapshot (`entityType: "WHITEBOARD"`) so nothing is ever lost.
- **Access** stays on the existing Space/Folder ACL and org scoping.

---

## 2. Architecture

### 2.1 Rendering engine

**HTML5 Canvas 2D** with a retained scene model — the same choice tldraw/Excalidraw/
FigJam make. SVG-DOM is simpler for v1 but collapses past a few hundred nodes; Canvas
scales to thousands and is where "enhance it the way we want" actually lives.

Three layers:
1. **Scene graph** — pure data (see 2.2), the single source of truth.
2. **Canvas renderer** — draws the scene to a `<canvas>` each frame in world→screen
   space; dirty-rect / requestAnimationFrame batched.
3. **Interaction/overlay layer** — a DOM layer above the canvas for text editing,
   selection handles, and native WorkwrK element chrome (a task card is a real React
   component positioned over the canvas, not a bitmap).

Pure geometry/hit-test/serialize logic lives in a dependency-free `src/lib/canvas/`
module (mirrors the `src/lib/sheet-engine` pattern — testable in isolation with
vitest).

### 2.2 Scene model (our format, versioned)

Stored on the SAME `Whiteboard.scene` Json column, but our shape:

```
{
  version: 1,
  viewport: { x, y, zoom },
  elements: [
    { id, type, x, y, w, h, rotation, z, style, ...typeProps }
  ]
}
```

Element types, phased:
- **v1:** `rect`, `ellipse`, `diamond`, `line`, `arrow`, `freedraw` (pen), `text`,
  `sticky` (sticky note), `image`.
- **later:** `connector` (binds to two elements, re-routes on move), `frame`
  (grouping container), and the WorkwrK-native elements below.
- `style`: stroke, fill, strokeWidth, opacity, fontSize, fontFamily, dash, arrowheads.

**WorkwrK-native elements (the differentiator, Phase 3):**
- `taskCard` → references an `Item` id; renders the live task (status/assignee/due),
  opens the task on click.
- `entityLink` → a Doc / SOP / KRA / KPI / Table reference; drawing a connector between
  a taskCard and an entity **creates a real `EntityLink`** in the graph.
- `embed` → the first-party embed view (Wave 4C) reused inside the canvas.

### 2.3 Persistence & migration from Excalidraw

- Keep `Whiteboard.scene` + `thumbnail` + `ContentVersion`. Add `scene.version` so a
  reader can tell our format from Excalidraw's (`appState` present ⇒ Excalidraw).
- **Importer:** `src/lib/canvas/import-excalidraw.ts` converts Excalidraw element types
  (rectangle/ellipse/diamond/arrow/line/freedraw/text/image) → our types. On first open
  of a legacy board: snapshot the original Excalidraw scene into `ContentVersion` as a
  rollback, convert, and save in our format.
- **Safety net:** a feature flag keeps a **read-only Excalidraw fallback** available
  during the transition, so a board that fails to convert still opens. Nothing is
  deleted; the original scene is always recoverable from history.

### 2.4 Collaboration

- **Phase 1–3: single-editor** with the existing autosave + version history. Good
  enough for the vast majority of use and zero new infra.
- **Phase 4: real-time multiplayer** — presence cursors + live element edits via a CRDT
  (Yjs) over the SSE/WebSocket transport Talk already runs ([[project_workwrk_comms_hub]]).
  Deferred on purpose; the scene model is designed CRDT-friendly (stable element ids,
  per-element updates) so this is additive.

---

## 3. Central governance ("controlled from the top")

- **Make Whiteboard a module.** Register it in `lib/modules.ts` + `lib/entitlements.ts`
  alongside Talk/Tables ([[project_workwrk_modular_architecture]]): an org toggles it in
  Settings → Modules; rail + routes + APIs gate on the installation. New orgs choose.
- **Access** rides the existing Space/Folder ACL — no new permission surface.
- **Template library** curated centrally (brainstorm, retro, flowchart, roadmap,
  user-journey, org-chart) and shipped as seed scenes; admins can publish org templates.
- **One kill switch, one roadmap.** Because we own the engine, every capability is
  behind our own flags — features roll out top-down, not at a vendor's pace.

---

## 4. Phased rollout

| Phase | Scope | Ships |
|------|-------|-------|
| **0 — Foundation** | Scene schema + versioned storage + Excalidraw importer + read-only first-party renderer (legacy boards open in our engine). Autosave/version-history parity. Module registration. | Existing whiteboards render in our engine, nothing lost. |
| **1 — Core editor** | Select/move/resize/rotate, pan/zoom, shapes (rect/ellipse/diamond/line/arrow), pen (freedraw), text, sticky notes, color/stroke styling, undo/redo, snapping to grid. | A usable first-party whiteboard. Excalidraw dependency removable behind the flag. |
| **2 — Structure** | Connectors that bind + re-route, frames/grouping, images (paste/drop/upload), alignment guides, copy/paste, keyboard shortcuts, export PNG/SVG. | Feature-complete vs Excalidraw. |
| **3 — Work-graph elements** | `taskCard`, `entityLink`, `embed`; connectors create real `EntityLink`s; "insert from board" picker. | The differentiator — a whiteboard wired into the work graph. |
| **4 — Multiplayer** | CRDT live edit + presence cursors over Talk's transport. | Real-time collaboration. |
| **5 — Polish & AI** | Templates library, PDF export, embed-a-whiteboard-in-a-doc, AI "turn this sketch into tasks" / "summarize this board". | Differentiated, AI-native canvas. |

Excalidraw is removed from `package.json` only after Phase 1 is stable behind the flag
and Phase 0 has converted existing scenes.

---

## 5. Connected track — finish the view surface

Separate but sequenced with the above, because the user flagged both together.

**Finding:** the per-board **board-view already has real renderers** for Dashboard,
Activity, Workload, Map, Chart, Pivot, etc. (`src/components/board-view/board-*-view.tsx`).
The gap is the **`/tasks` aggregate surface** (`task-list-surface.tsx`), which uses its
own `TaskItem` model and stubs those views. Wave 4A already wired its bulk-action bar
and made the placeholders honest.

Plan:
- **Team view** (group tasks by assignee) and **Dashboard view** (status / priority /
  assignee summary) — buildable against `TaskItem` with no new data. Build next, each
  against a ClickUp reference.
- **Workload / Mind Map** — medium; feasible against `TaskItem` (assignee+due / parent
  tree).
- **Activity / Map** — need data the surface lacks (activity log / geo); defer until the
  data exists.
- **Whiteboard view** on `/tasks` and on a board routes into **WorkwrK Canvas** above —
  one engine, everywhere.
- **North star:** unify `/tasks` onto the board-view renderers via a `TaskItem`↔
  `BoardItemRow` adapter so there is ONE set of view renderers to maintain, not two.

---

## 6. Open decisions (need a call before Phase 0)

1. **Canvas vs SVG for v1.** Recommendation: Canvas 2D from the start (scales, matches
   the pros). SVG would be faster to ship but a throwaway.
2. **Multiplayer transport.** Reuse Talk's SSE/WebSocket vs a dedicated Yjs provider.
3. **Import strategy.** Convert-on-first-open (recommended) vs a one-shot batch migration
   of all existing scenes.
4. **Module default.** Ship Whiteboard ON for existing orgs (it already exists) but OFF
   for new orgs like other premium modules?

Related: [[project_workwrk_modular_architecture]] · [[project_workwrk_comms_hub]] ·
[[project_workwrk_data_integrity_paramount]] · docs/plans/views-catalog.md
