# Canvas as a first-class primitive (rename Whiteboard → Canvas + make it embeddable/connectable everywhere)

Status: PLAN (not started). Owner: product. Created 2026-09-05.
Builds on the first-party WorkwrK Canvas engine ([[project_workwrk_whiteboard_canvas]] · docs/plans/first-party-whiteboard.md).

---

## The idea (user, 2026-09-05)

> "Like how we have Docs, we should also have **Canvases** rather than having a Whiteboard. And we can use that canvas to do a lot of stuff in there, connect canvas, use canvas — like how we can use nodes, we can use canvases as well everywhere."

Today "whiteboard" is a leaf feature: a page you open at `/whiteboards/[id]`. The
ask is to promote it to a **first-class content primitive on par with Docs** —
something you create anywhere, **embed** inside other content, **link** into the
work graph, and **drop onto other canvases** (canvas-in-canvas), the same way a
task or doc is a reusable node. The first-party engine we just built is what
makes this possible (we own the model, so a Canvas can render inline, small, or
as a node — an Excalidraw black box could not).

---

## What "first-class, like Docs" means concretely

A Doc today: has a create entry in the "+" menu, lives under a Space/Folder,
shows in the sidebar tree, is an `EntityLinkType` ("DOC"), can be linked as a
field on a table, embedded in other Docs, and referenced from a task. Canvas
should reach the same bar:

1. **Naming.** Rename the user-facing concept **Whiteboard → Canvas** everywhere
   (rail label, "+"-menu, empty states, share dialog, sidebar). Keep the Prisma
   model name `Whiteboard` internally at first (a UI-only rename is zero-risk and
   reversible); a later migration can rename the table if we want. Route stays
   `/whiteboards/[id]` initially (add a `/canvas/[id]` alias later) to avoid
   breaking existing links.
2. **EntityLink node.** `WHITEBOARD` is ALREADY an `EntityLinkType` (see
   src/app/api/entity-links/route.ts ENTITY_TYPES). So a Canvas can already be a
   node in the graph — we just need the UI to link TO and FROM it: hydrate
   WHITEBOARD targets in `/api/entity-links` (title + href `/whiteboards/[id]`),
   and surface a "Link a Canvas" option wherever we link Docs/SOPs.
3. **Embed a Canvas in a Doc** (and vice-versa). The block-doc editor already
   supports embeds/links; add a Canvas embed block that renders the canvas
   read-only (or interactively) inline. Our engine renders to a `<canvas>` at any
   size, so an inline preview is cheap.
4. **Canvas field on a table** — a `CANVAS`/relational field type (mirror
   LINKED_DOC) so a row can reference a Canvas.
5. **Canvas-in-canvas node** — the work-graph element work (Phase 3 of the engine
   plan) already adds task/doc cards on the canvas; add a **Canvas card** the same
   way (a live thumbnail of another Canvas that opens it), so canvases nest.
6. **Right-click / "…" menu on a Canvas in the Space sidebar** — rename, delete,
   share, move, duplicate, copy link (parity with Docs). The user flagged this is
   missing: you cannot currently right-click a whiteboard in the Space tree to
   delete it. (The on-CANVAS right-click menu shipped in commit cd4bc26.)

---

## Why the engine had to be ours first

None of embed / node / thumbnail / canvas-in-canvas is possible with a
third-party black box — you cannot render an Excalidraw scene small, read its
contents, or turn it into a graph node. Owning the scene model (`src/lib/canvas`)
is exactly what unlocks Canvas-as-a-primitive. This plan is the *pay-off* of the
first-party-whiteboard work, not a parallel effort.

---

## Phased rollout

| Phase | Scope |
|------|-------|
| **A — Rename + sidebar parity** | UI rename Whiteboard → Canvas; add the Space-sidebar "…"/right-click menu (rename/delete/share/duplicate/copy-link/move) so a Canvas is managed like a Doc. Lowest risk, immediate value (fixes the "can't delete from the space" gap). |
| **B — Graph node** | Hydrate WHITEBOARD in `/api/entity-links`; "Link a Canvas" in the same pickers as Docs/SOPs; show linked Canvases on a task/doc/OKR. |
| **C — Embed** | Canvas embed block in the Doc editor (inline read-only render); Canvas field type on tables. |
| **D — Canvas-in-canvas** | A Canvas card element on the whiteboard (live thumbnail → opens it), reusing the work-graph element machinery (Phase 3 of the engine plan). |
| **E — Full model rename (optional)** | Migrate `Whiteboard` → `Canvas` in Prisma + `/canvas/[id]` route with a redirect, once the concept is settled. |

Start with **A** — it's the honest fix for what the user hit (no way to manage a
Canvas from the Space) and it establishes the naming.

## Open decisions

1. Rename the route now (`/canvas/[id]` + redirect) or defer to Phase E?
2. Is a Canvas embed in a Doc interactive or a static preview-with-open-link (v1)?
3. Does Canvas become a governed module (like Talk/Tables) or stay core?

Related: [[project_workwrk_whiteboard_canvas]] · docs/plans/first-party-whiteboard.md · [[project_workwrk_granular_folder_access]] (the sidebar tree + share dialog this rides on)
