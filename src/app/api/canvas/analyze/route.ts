// POST /api/canvas/analyze — the AI "explain" / "critique" actions.
//
// Body: { scene: CanvasScene, action: "explain" | "critique" }. Serializes the
// board into a compact semantic description (nodes + typed tables + labelled
// connections — never pixels) and asks the org's Claude to either walk through
// how it works or review it as a staff architect. Returns { text } (markdown).

import { NextRequest } from "next/server";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { getAnthropicForOrg, modelFor } from "@/lib/ai-client";
import type { CanvasScene, CanvasElement } from "@/lib/canvas/scene";

const EXPLAIN = `You are a principal software architect explaining a system-design diagram to a teammate.
Given the diagram's components and connections, write a clear, concise walkthrough:
- Open with one sentence naming what the system is.
- Trace the main request / data flow in order.
- Note the role of each major component and data store.
Use short markdown (a lead sentence, then a few bullets). No preamble like "Sure" or "Here is". Be specific to THIS diagram; never invent components that aren't listed.`;

const CRITIQUE = `You are a staff software architect doing a design review of a system-design diagram.
Given its components and connections, review it directly and specifically:
- Call out single points of failure, missing redundancy, scaling limits, and security or data gaps.
- Point to concrete components by name; suggest a concrete fix for each issue.
- Note what is done well, briefly.
Use short markdown with a couple of sections ("Strengths", "Risks & fixes"). No preamble. Only reason about the components listed; never invent ones that aren't there.`;

/** Turn a scene into a compact text description the model can reason about. */
function describeScene(scene: CanvasScene): string {
  const els = scene.elements ?? [];
  const labelOf = (el: CanvasElement | undefined): string => {
    if (!el) return "?";
    if (el.type === "table") return el.name || "table";
    if (el.type === "frame") return (el.title || "group");
    return (el as { text?: string }).text?.split("\n")[0] || el.type;
  };
  const byId = new Map(els.map((e) => [e.id, e]));

  const nodeLines: string[] = [];
  const frames = els.filter((e) => e.type === "frame");
  for (const el of els) {
    if (el.type === "arrow" || el.type === "frame" || el.type === "text" || el.type === "image") continue;
    // Which group (frame) contains this element's centre?
    const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
    const group = frames.find((f) => cx >= f.x && cx <= f.x + f.w && cy >= f.y && cy <= f.y + f.h);
    const g = group ? ` [${labelOf(group)}]` : "";
    if (el.type === "table") {
      const fields = (el.fields ?? []).map((f) => `${f.name}${f.key ? `(${f.key})` : ""}${f.type ? `:${f.type}` : ""}`).join(", ");
      nodeLines.push(`- TABLE ${el.name}${g} { ${fields} }`);
    } else {
      nodeLines.push(`- ${labelOf(el)}${g} (${el.type})`);
    }
  }

  const edgeLines: string[] = [];
  for (const el of els) {
    if (el.type !== "arrow") continue;
    const from = el.fromId ? labelOf(byId.get(el.fromId)) : "?";
    const to = el.toId ? labelOf(byId.get(el.toId)) : "?";
    if (from === "?" && to === "?") continue;
    const lbl = (el as { text?: string }).text ? ` : ${(el as { text?: string }).text}` : "";
    edgeLines.push(`- ${from} -> ${to}${lbl}`);
  }

  return `COMPONENTS:\n${nodeLines.join("\n") || "(none)"}\n\nCONNECTIONS:\n${edgeLines.join("\n") || "(none)"}`;
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);
  const body = await req.json().catch(() => ({}));
  const scene = body?.scene as CanvasScene | undefined;
  const action = body?.action === "critique" ? "critique" : "explain";
  if (!scene || !Array.isArray(scene.elements)) return jsonError("No diagram to analyze.");

  const drawable = scene.elements.filter((e) => e.type !== "text" && e.type !== "image");
  if (drawable.length === 0) return jsonError("The canvas is empty — draw or generate a diagram first.");

  const ai = await getAnthropicForOrg(orgId);
  if (ai.source === "shared" && !process.env.ANTHROPIC_API_KEY) {
    return jsonError("AI isn't configured for this workspace yet. Add an API key in Settings to use Explain / Critique.");
  }

  try {
    const message = await ai.client.messages.create({
      model: modelFor(ai, "claude-sonnet-4-6"),
      max_tokens: 1200,
      system: action === "critique" ? CRITIQUE : EXPLAIN,
      messages: [{ role: "user", content: describeScene(scene) }],
    });
    const textBlock = message.content.find((b: { type: string }) => b.type === "text") as { text?: string } | undefined;
    const text = (textBlock?.text ?? "").trim();
    if (!text) return jsonError("The AI didn't return anything. Try again.");
    return jsonSuccess({ text, action });
  } catch (err: unknown) {
    const msg = (err as { error?: { error?: { message?: string } }; message?: string })?.error?.error?.message
      || (err as { message?: string })?.message || "AI analysis failed.";
    return jsonError(`AI analysis failed: ${msg}`);
  }
}
