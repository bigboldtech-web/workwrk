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

const SYSTEM = `You are a principal software architect. Turn the user's description into a clean architecture / system-design diagram.

Output ONLY a JSON object (no markdown, no prose) of this exact shape:
{
  "title": "short diagram title",
  "nodes": [
    { "id": "kebab-id", "label": "Human Label", "kind": "service", "group": "optional-group-id" },
    { "id": "users", "label": "users", "kind": "database", "fields": [ { "name": "id", "type": "uuid", "key": "pk" }, { "name": "email", "type": "text" }, { "name": "org_id", "type": "uuid", "key": "fk" } ] }
  ],
  "edges": [ { "from": "node-id", "to": "node-id", "label": "what flows / the call / the relationship" } ],
  "groups": [ { "id": "group-id", "label": "Group Label" } ]
}

Rules:
- "kind" is one of: service, component, database, cache, queue, external, cloud, actor, user, gateway, decision, note. Pick the most accurate one for each node (Redis is "cache", a third-party API is "external", the end user is "actor", an API gateway/load balancer is "gateway").
- DATABASE / ER SCHEMAS: when the user asks for a database, schema, data model, or ER diagram, emit each ENTITY as a node with a "fields" array — an ER table with typed columns. Each field is { "name": "col", "type": "uuid|text|int|timestamp|…", "key": "pk" | "fk" (omit if neither) }. Mark the primary key "pk" and foreign keys "fk". Add an edge between two tables for each relationship, labelled with the cardinality ("1:N", "N:1", "1:1").
- For architecture (not schema) nodes, DON'T add fields — just a label.
- Give every node a short, specific label (e.g. "Orders API", "orders", "Stripe").
- Direct edges the way data/requests FLOW, and label them with the call, data, or relationship. Keep labels short.
- Group related nodes with a "group" id and define each group in "groups" (e.g. "Backend", "Data", "Third-party"). Groups are optional but make big diagrams readable.
- Aim for 5-15 nodes for a typical request — enough to be useful, not overwhelming. Prefer clarity over completeness.
- REFINING: if the user message includes a CURRENT DIAGRAM (a JSON spec) followed by a change request, MODIFY that spec to satisfy the request and return the COMPLETE updated spec (not a diff). Keep the "id" of every node you keep EXACTLY the same so it stays in place; only add, remove, or edit what the request implies. Preserve unrelated nodes, edges, groups, and any "fields".
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

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const body = await req.json().catch(() => ({}));
  const prompt = typeof body?.prompt === "string" ? body.prompt : "";
  const priorSpec = body?.priorSpec && Array.isArray(body.priorSpec?.nodes) ? (body.priorSpec as DiagramSpec) : null;
  if (!prompt.trim()) {
    return jsonError("Describe what you want to design.");
  }

  const ai = await getAnthropicForOrg(orgId);
  if (ai.source === "shared" && !process.env.ANTHROPIC_API_KEY) {
    const spec = priorSpec ?? FALLBACK;
    return jsonSuccess({ scene: specToScene(spec), spec, title: spec.title ?? FALLBACK.title, fallback: true });
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
    const spec = JSON.parse(match[0]) as DiagramSpec;
    if (!Array.isArray(spec.nodes) || spec.nodes.length === 0) {
      return jsonError("The AI didn't return any components. Try a more specific description.");
    }
    return jsonSuccess({ scene: specToScene(spec), spec, title: spec.title ?? "Diagram" });
  } catch (err: unknown) {
    const msg = (err as { error?: { error?: { message?: string } }; message?: string })?.error?.error?.message
      || (err as { message?: string })?.message || "AI generation failed.";
    return jsonError(`AI generation failed: ${msg}`);
  }
}
