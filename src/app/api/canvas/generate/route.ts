// POST /api/canvas/generate — the AI diagram feature.
//
// Body: { prompt: string }. Calls the org's Claude (shared or BYOK) to turn a
// plain-language description into a semantic node/edge SPEC, then lays it out
// into a real Canvas scene via specToScene (the model never touches pixels).
// Returns { scene, title }.

import { NextRequest } from "next/server";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { getAnthropicForOrg, modelFor } from "@/lib/ai-client";
import { specToScene, type DiagramSpec } from "@/lib/canvas/from-spec";
import { sequenceToScene, type SequenceSpec } from "@/lib/canvas/sequence";
import type { CanvasScene } from "@/lib/canvas/scene";

const SYSTEM = `You are a principal software architect. Turn the user's description into a clean diagram. FIRST choose the diagram TYPE, then output ONLY a JSON object (no markdown, no prose) in that type's shape.

CHOOSE THE TYPE:
- "architecture" (default) — systems, services, data stores, how components connect.
- "flowchart" — a process, algorithm, or decision flow ("flow", "steps", "if/then", "workflow").
- "sequence" — an interaction over time between participants ("sequence", "request flow", "handshake", "who calls whom in what order").

ARCHITECTURE / ER shape:
{ "type": "architecture", "title": "…",
  "nodes": [
    { "id": "kebab-id", "label": "Human Label", "kind": "service", "group": "optional-group-id" },
    { "id": "users", "label": "users", "kind": "database", "fields": [ { "name": "id", "type": "uuid", "key": "pk" }, { "name": "org_id", "type": "uuid", "key": "fk" } ] }
  ],
  "edges": [ { "from": "node-id", "to": "node-id", "label": "what flows / the relationship" } ],
  "groups": [ { "id": "group-id", "label": "Group Label" } ] }
- "kind": service, component, database, cache, queue, external, cloud, actor, user, gateway, decision, note. (Redis="cache", 3rd-party API="external", end user="actor", gateway/LB="gateway".)
- DATABASE / ER: when asked for a schema/data model, give each entity a "fields" array (typed columns, "key":"pk"|"fk"); add an edge per relationship labelled with cardinality ("1:N","N:1","1:1"). Architecture (non-schema) nodes have NO fields.

FLOWCHART shape (same node/edge shape, type "flowchart"):
{ "type": "flowchart", "title": "…",
  "nodes": [ { "id": "s", "label": "Start", "kind": "start" }, { "id": "c", "label": "Valid?", "kind": "decision" }, { "id": "p", "label": "Save record", "kind": "process" }, { "id": "e", "label": "Done", "kind": "end" } ],
  "edges": [ { "from": "s", "to": "c" }, { "from": "c", "to": "p", "label": "yes" }, { "from": "c", "to": "e", "label": "no" } ] }
- Flowchart "kind": start, end (terminators), process (a step), decision (a yes/no branch — label its outgoing edges "yes"/"no"), io (input/output). Lay the flow out in reading order; every decision has ≥2 labelled out-edges.

SEQUENCE shape:
{ "type": "sequence", "title": "…",
  "participants": ["Client", "API", "Auth", "DB"],
  "messages": [ { "from": "Client", "to": "API", "label": "POST /login" }, { "from": "API", "to": "Auth", "label": "verify" }, { "from": "Auth", "to": "API", "label": "token", "dashed": true }, { "from": "API", "to": "Client", "label": "200 OK", "dashed": true } ] }
- "participants" are the lifelines, left-to-right in a sensible order. "messages" are IN TIME ORDER, top to bottom. Use "dashed": true for a response/return message. from/to MUST be exact participant names.

GENERAL:
- Short, specific labels. Aim for 5-15 nodes/messages — useful, not overwhelming.
- REFINING: if the message includes a CURRENT DIAGRAM (a JSON spec) + a change request, MODIFY that spec and return the COMPLETE updated spec of the SAME "type". Keep every kept node's "id" (or participant name) EXACTLY the same so it stays in place; change only what the request implies.
- Return ONLY the JSON.`;

// A tiny canned example when no shared key is configured, so the feature never
// hard-errors in a fresh env.
const FALLBACK: DiagramSpec = {
  title: "Example",
  nodes: [
    { id: "user", label: "User", kind: "actor" },
    { id: "api", label: "API", kind: "service", group: "backend" },
    { id: "db", label: "Database", kind: "database", group: "backend" },
  ],
  edges: [
    { from: "user", to: "api", label: "request" },
    { from: "api", to: "db", label: "read / write" },
  ],
  groups: [{ id: "backend", label: "Backend" }],
};

// A spec is any of the three shapes the model can emit. Route it to the right
// layout. Returns null when the spec has nothing layout-able.
type AnySpec = (DiagramSpec & { type?: string }) | (SequenceSpec & { type?: string });
function sceneFromSpec(spec: AnySpec): CanvasScene | null {
  if (spec?.type === "sequence" && Array.isArray((spec as SequenceSpec).participants) && (spec as SequenceSpec).participants.length > 0) {
    return sequenceToScene(spec as SequenceSpec);
  }
  const d = spec as DiagramSpec;
  if (!Array.isArray(d.nodes) || d.nodes.length === 0) return null;
  return specToScene(d, spec?.type === "flowchart" ? { direction: "TB" } : undefined);
}
function isValidPrior(p: unknown): p is AnySpec {
  const s = p as { nodes?: unknown; participants?: unknown } | null;
  return !!s && (Array.isArray(s.nodes) || Array.isArray(s.participants));
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const body = await req.json().catch(() => ({}));
  const prompt = typeof body?.prompt === "string" ? body.prompt : "";
  const priorSpec = isValidPrior(body?.priorSpec) ? body.priorSpec : null;
  if (!prompt.trim()) {
    return jsonError("Describe what you want to design.");
  }

  const ai = await getAnthropicForOrg(orgId);
  if (ai.source === "shared" && !process.env.ANTHROPIC_API_KEY) {
    const spec = priorSpec ?? FALLBACK;
    const scene = sceneFromSpec(spec) ?? specToScene(FALLBACK);
    return jsonSuccess({ scene, spec, title: (spec as { title?: string }).title ?? FALLBACK.title, fallback: true });
  }

  // On a refine, hand the model the current spec + the change request.
  const userContent = priorSpec
    ? `CURRENT DIAGRAM:\n${JSON.stringify(priorSpec)}\n\nCHANGE REQUEST: ${prompt.trim()}`
    : prompt.trim();

  try {
    const message = await ai.client.messages.create({
      model: modelFor(ai, "claude-sonnet-4-20250514"),
      max_tokens: 4000,
      system: SYSTEM,
      messages: [{ role: "user", content: userContent }],
    });
    const textBlock = message.content.find((b: { type: string }) => b.type === "text") as { text?: string } | undefined;
    const text = textBlock?.text ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return jsonError("The AI didn't return a diagram. Try rephrasing.");
    const spec = JSON.parse(match[0]) as AnySpec;
    const scene = sceneFromSpec(spec);
    if (!scene) {
      return jsonError("The AI didn't return any components. Try a more specific description.");
    }
    return jsonSuccess({ scene, spec, title: (spec as { title?: string }).title ?? "Diagram" });
  } catch (err: unknown) {
    const msg = (err as { error?: { error?: { message?: string } }; message?: string })?.error?.error?.message
      || (err as { message?: string })?.message || "AI generation failed.";
    return jsonError(`AI generation failed: ${msg}`);
  }
}
