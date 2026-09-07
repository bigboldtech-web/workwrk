# Canvas → a system-design & architecture tool, with an AI that draws it for you

Status: PLAN. Created 2026-09-07. Owner: product.
Trigger (user, 2026-09-07): "This whiteboard is going to be used for a LOT — system
designs, architectures, databases. Add more stuff, align it really well, plan it
really well so we can do system design / build architectures / databases. And we're
adding a CHAT: you describe what you want, the AI designs everything on the canvas
automatically. Make it so damn good people just want to buy it."

Builds on the first-party Canvas ([[project_workwrk_whiteboard_canvas]]) which now has
full Excalidraw-parity (connectors + magnet binding + labels, text, rotation,
grouping, align/distribute, flip, lock, arrowheads, export). The engine is ours, so
we can generate scenes programmatically — which is what makes the AI feature possible.

---

## The vision, in one line
Type "design a URL shortener with a cache and a rate limiter" → a clean, laid-out
architecture diagram appears on the canvas, editable like anything else.

## Why we can do this now
Our scene is plain JSON (`src/lib/canvas/scene.ts`) and already expresses the
vocabulary of system design:
- **Service / component** → labelled rounded rectangle
- **Database** → `cylinder` (already a shape)
- **External system / cloud** → `cloud` (already a shape)
- **Decision / gateway** → `diamond`
- **Actor / user** → labelled box (or ellipse)
- **Connections** → arrows that magnet-bind to shapes, carry labels, and route
  straight/elbow/curved (all shipped)
- **Boundaries / groups** → `frame` (a titled container)

So the AI does NOT need pixel coordinates or our exact element schema. It emits a
**semantic node/edge spec**; we map + auto-lay-out into a real scene. Robust, and the
model only reasons about the architecture, not geometry.

## Architecture of the AI feature

1. **AI spec (model output).** A small, forgiving schema the model is good at:
   ```json
   {
     "title": "URL Shortener",
     "nodes": [
       { "id": "client", "label": "Client", "kind": "actor" },
       { "id": "api", "label": "API Gateway", "kind": "service", "group": "Backend" },
       { "id": "cache", "label": "Redis Cache", "kind": "cache", "group": "Backend" },
       { "id": "db", "label": "URLs (Postgres)", "kind": "database", "group": "Backend" }
     ],
     "edges": [
       { "from": "client", "to": "api", "label": "GET /:slug" },
       { "from": "api", "to": "cache", "label": "lookup" },
       { "from": "api", "to": "db", "label": "miss → read" }
     ],
     "groups": [{ "id": "Backend", "label": "Backend" }]
   }
   ```
   `kind` ∈ service | database | cache | queue | external | actor | gateway | decision |
   note. (Renderer maps unknown kinds → labelled box.)

2. **Spec → scene converter** — `src/lib/canvas/from-spec.ts` (pure, tested):
   - kind → element type + default fill/stroke (database→cylinder, external→cloud,
     decision→diamond, gateway→diamond, actor→box, else rounded rect), with the
     label as the shape's centred text (shape labels already ship).
   - **Auto-layout**: layered left-to-right (Sugiyama-lite) — longest-path layering
     from source nodes, columns per layer, rows within a layer, generous spacing so
     arrows read cleanly. Groups → `frame` sized to bound their members.
   - edges → `arrow` with `fromId`/`toId` (magnet binding + reflow already handle the
     geometry) and the edge label centred on the line.

3. **Generate endpoint** — `POST /api/canvas/generate`:
   - Reuses the org AI client (`getAnthropicForOrg` / `modelFor`, shared or BYOK, with
     a graceful no-key fallback like the other AI routes).
   - System prompt: "You are a principal engineer. Given a description, output ONLY the
     node/edge JSON above. Use the right `kind` per component, group related pieces,
     label the edges with the call/data that flows." Returns the parsed spec.

4. **Canvas AI chat panel** — a collapsible right-side panel on `/canvas/[id]`:
   - A prompt box + a short transcript. Send → `/api/canvas/generate` → `fromSpec` →
     drop onto the canvas (into the current viewport; if the board is empty, replace;
     if not, add near centre and select the new group so it's easy to move).
   - Follow-ups refine ("add a load balancer in front", "make the DB a read replica").
     v1: each generation is a fresh spec merged in; iterative editing of an existing
     spec is a fast follow.

## Phased rollout — ALL SHIPPED (2026-09-07)

| Phase | Scope | Status |
|------|------|------|
| **1 — AI generates a diagram** | The spec schema, `from-spec.ts` + layout, `/api/canvas/generate`, and the chat panel. Uses ONLY existing element types. This is the "wow" and ships first. | ✅ 5624738c |
| **2 — System-design shape kit** | Preset nodes (Service/Gateway/Database/Cache/Queue/Cloud/User/External + ER Table) in the Design panel's "System kit", each dropping a pre-labelled, pre-styled shape via `specToScene` so hand-built == generated. | ✅ 1a07fa5a |
| **3 — Database / ER diagrams** | Real `table` element (name + typed rows, PK/FK badges) + manual table tool/editor + crow's-foot cardinality heads (`crowsfoot` / `crowsfoot-one`), read from the edge's cardinality label. | ✅ 66ff3552 + 6ce70f84 |
| **4 — Templates & polish** | 4 starter templates (microservices, 3-tier, event-driven, ER schema) via `lib/canvas/templates.ts`; "Explain" / "Critique" AI actions via `/api/canvas/analyze` (serializes the live board → Claude), rendered inline. | ✅ 9a04ab3b |

Implementation notes: `from-spec.ts` owns kind→shape + layered auto-layout + ER
cardinality; `templates.ts` is pure DiagramSpecs; `/api/canvas/analyze` describes
the scene as semantic COMPONENTS/CONNECTIONS text (never pixels). All canvas libs
vitest-covered (from-spec + templates + scene = 36 tests).

## Open decisions
1. Layout engine: hand-rolled layered layout (no dep, good enough, CSP-safe) vs a lib.
   Recommend **hand-rolled layered** — predictable, dependency-free, and we own it.
2. Replace vs merge on generate: recommend **replace when the board is empty, else add
   the new diagram as a selected group** the user can place.
3. Model: `claude-sonnet` for quality (this is a flagship feature) with the shared/BYOK
   config the other routes use.

Related: [[project_workwrk_whiteboard_canvas]] · docs/plans/first-party-whiteboard.md ·
docs/plans/canvas-primitive.md · the AI client at `src/lib/ai-client.ts` (getAnthropicForOrg/modelFor).
