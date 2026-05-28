// POST /api/forms/generate  { prompt }
//
// Ask Claude to design a form from a one-line description. Returns
// `{ name, description, fields }` in the same shape as POST /api/forms
// expects — caller can pipe straight through to create the form.

import { NextRequest } from "next/server";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { getAnthropicForOrg, modelFor } from "@/lib/ai-client";

const FIELD_TYPES = ["short_text", "long_text", "number", "email", "url", "date", "select", "multi_select", "checkbox"] as const;

interface GeneratedField {
  type: typeof FIELD_TYPES[number];
  label: string;
  required: boolean;
  options?: string[];
}
interface GeneratedForm {
  name: string;
  description: string;
  fields: GeneratedField[];
}

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  const orgId = getOrgId(session);

  const body = await req.json();
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return jsonError("prompt required");
  if (prompt.length > 1000) return jsonError("prompt too long (max 1000 chars)");

  const { client, preferredModel } = await getAnthropicForOrg(orgId);
  const model = modelFor({ client, source: "shared", preferredModel }, "claude-haiku-4-5");

  const system = `You design forms for a SaaS work tool. Given a one-line description of what the form is for, you output ONLY a JSON object — no prose, no markdown fences — matching this shape:

{
  "name": "string (≤80 chars)",
  "description": "string (≤200 chars)",
  "fields": [
    {
      "type": "short_text" | "long_text" | "number" | "email" | "url" | "date" | "select" | "multi_select" | "checkbox",
      "label": "string (≤80 chars)",
      "required": boolean,
      "options": ["string", "string"]   // ONLY for select / multi_select; omit otherwise
    }
  ]
}

Design 3-8 fields appropriate for the purpose. Use specific, plain-language labels. Mark a field required only if it's truly essential. For select / multi_select, provide 3-6 realistic options.`;

  const msg = await client.messages.create({
    model,
    max_tokens: 1500,
    system,
    messages: [{ role: "user", content: `Form purpose: ${prompt}` }],
  });

  const text = msg.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("\n")
    .trim();

  let parsed: GeneratedForm;
  try {
    // Tolerate accidental ```json fences
    const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    return jsonError("AI returned malformed JSON — try a clearer prompt", 502);
  }

  // Sanitise — drop unknown types, clamp lengths, normalise options.
  const safeFields: GeneratedField[] = (Array.isArray(parsed.fields) ? parsed.fields : [])
    .filter((f): f is GeneratedField => f && typeof f === "object" && FIELD_TYPES.includes(f.type as typeof FIELD_TYPES[number]))
    .slice(0, 20)
    .map((f) => ({
      type: f.type,
      label: String(f.label ?? "Untitled").slice(0, 80),
      required: Boolean(f.required),
      ...(f.type === "select" || f.type === "multi_select"
        ? { options: Array.isArray(f.options) ? f.options.map(String).slice(0, 20) : ["Option 1"] }
        : {}),
    }));

  return jsonSuccess({
    name: String(parsed.name ?? "Untitled form").slice(0, 80),
    description: String(parsed.description ?? "").slice(0, 200),
    fields: safeFields,
  });
}
