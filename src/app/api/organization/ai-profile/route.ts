import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, isManager, jsonError, jsonSuccess } from "@/lib/api-helpers";
import { getAnthropicForOrg, modelFor } from "@/lib/ai-client";

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;
  if (!isManager(session)) return jsonError("Forbidden", 403);

  const orgId = getOrgId(session);
  const ai = await getAnthropicForOrg(orgId);
  const body = await req.json();
  const { companyName, website, industry, currentAbout, currentMission, currentVision, currentValues } = body;

  // Get additional context from org data
  const [departments, userCount] = await Promise.all([
    prisma.department.findMany({ where: { organizationId: orgId }, select: { name: true } }),
    prisma.user.count({ where: { organizationId: orgId, deletedAt: null } }),
  ]);

  const deptNames = departments.map((d) => d.name).join(", ");

  if (ai.source === "shared" && !process.env.ANTHROPIC_API_KEY) {
    return jsonSuccess({
      about: currentAbout || `${companyName || "Our company"} is a growing organization in the ${industry || "technology"} space.`,
      mission: currentMission || "To deliver exceptional value to our customers through innovation and excellence.",
      vision: currentVision || `To be a leading force in the ${industry || "industry"}, setting new standards of quality and impact.`,
      values: currentValues?.length > 0 ? currentValues : ["Innovation", "Integrity", "Excellence", "Collaboration", "Customer Focus"],
      industry: industry || "",
    });
  }

  try {
    let context = "";
    if (companyName) context += `Company Name: ${companyName}\n`;
    if (website) context += `Website: ${website}\n`;
    if (industry) context += `Industry: ${industry}\n`;
    if (deptNames) context += `Departments: ${deptNames}\n`;
    context += `Team Size: ${userCount} employees\n`;
    if (currentAbout) context += `Current Description: ${currentAbout}\n`;
    if (currentMission) context += `Current Mission: ${currentMission}\n`;
    if (currentVision) context += `Current Vision: ${currentVision}\n`;
    if (currentValues?.length > 0) context += `Current Values: ${currentValues.join(", ")}\n`;

    const message = await ai.client.messages.create({
      model: modelFor(ai, "claude-haiku-4-5-20251001"),
      max_tokens: 1500,
      system: `You are a business strategy expert. Generate a professional company profile based on the information provided.

If a website URL is provided, use your knowledge of common business patterns to infer what the company likely does based on the domain name and context.

Return a JSON object:
{
  "about": "2-3 paragraph company description — what the company does, how it serves its market, what makes it unique",
  "mission": "One clear, inspiring mission statement (1-2 sentences)",
  "vision": "One ambitious vision statement (1-2 sentences)",
  "values": ["Value 1", "Value 2", "Value 3", "Value 4", "Value 5"],
  "industry": "Industry category"
}

Rules:
- If existing content is provided, improve and expand it — don't start from scratch
- Make the about section specific to this business, not generic corporate speak
- Values should be actionable and specific to the business type
- Keep mission and vision concise but impactful
- Return ONLY valid JSON`,
      messages: [
        { role: "user", content: `Generate a company profile:\n\n${context}` },
      ],
    });

    const textBlock = message.content.find((b: any) => b.type === "text");
    const text = textBlock ? (textBlock as any).text : "";

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return jsonSuccess(parsed);
    }

    return jsonError("Failed to generate profile. Try again.");
  } catch (err: any) {
    console.error("AI profile generation error:", err);
    const msg = err?.error?.error?.message || err?.message || "AI generation failed. Try again.";
    return jsonError(`AI generation failed: ${msg}`);
  }
}
