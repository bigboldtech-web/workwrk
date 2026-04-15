import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getOrgId, jsonError, jsonSuccess } from "@/lib/api-helpers";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || "",
});

export async function POST(req: NextRequest) {
  const { error, session } = await getSessionOrFail();
  if (error) return error;

  const orgId = getOrgId(session);
  const { jobTitle, jobDescription } = await req.json();

  if (!jobTitle?.trim()) {
    return jsonError("Job title is required");
  }

  // Gather company context
  const [org, departments, existingKras, kraCategories] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: orgId },
      select: { name: true, settings: true },
    }),
    prisma.department.findMany({
      where: { organizationId: orgId },
      select: { name: true },
      take: 30,
    }),
    prisma.kRA.findMany({
      where: { organizationId: orgId },
      select: { name: true, category: true },
      take: 50,
    }),
    prisma.kraCategory.findMany({
      where: { organizationId: orgId },
      select: { name: true },
    }),
  ]);

  const settings = (org?.settings as any) || {};
  const profile = settings.companyProfile || {};
  const companyName = org?.name || "";
  const industry = profile.industry || settings.industry || "";
  const mission = profile.mission || "";
  const vision = profile.vision || "";
  const about = profile.about || "";
  const values = Array.isArray(profile.values) ? profile.values.join(", ") : "";
  const deptNames = departments.map((d) => d.name).join(", ");
  const existingCategories = kraCategories.map((c) => c.name);
  const existingKraNames = existingKras.map((k) => k.name).slice(0, 20).join(", ");

  // Build company context block
  let companyContext = "";
  if (companyName) companyContext += `Company: ${companyName}\n`;
  if (industry) companyContext += `Industry: ${industry}\n`;
  if (about) companyContext += `About: ${about}\n`;
  if (mission) companyContext += `Mission: ${mission}\n`;
  if (vision) companyContext += `Vision: ${vision}\n`;
  if (values) companyContext += `Core Values: ${values}\n`;
  if (deptNames) companyContext += `Departments: ${deptNames}\n`;
  if (existingKraNames) companyContext += `Existing KRAs: ${existingKraNames}\n`;

  const categoryInstruction = existingCategories.length > 0
    ? `Use these existing categories where appropriate: ${existingCategories.join(", ")}. You may create new categories only if none of the existing ones fit.`
    : "Create appropriate categories for each KRA (e.g., Performance, Quality, Growth, Leadership, Communication).";

  if (!process.env.ANTHROPIC_API_KEY) {
    return jsonSuccess({
      kras: [
        {
          name: "Core Job Performance",
          description: `Primary responsibilities for ${jobTitle}`,
          category: existingCategories[0] || "Performance",
          kpis: [
            { name: "Task Completion Rate", type: "QUANTITATIVE", unit: "%", targetValue: 95, frequency: "MONTHLY", description: "Percentage of assigned tasks completed on time" },
            { name: "Quality Score", type: "QUANTITATIVE", unit: "score", targetValue: 90, frequency: "MONTHLY", description: "Quality rating of deliverables" },
            { name: "Deadline Adherence", type: "QUANTITATIVE", unit: "%", targetValue: 90, frequency: "MONTHLY", description: "Percentage of deadlines met" },
          ],
        },
      ],
    });
  }

  try {
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 3000,
      system: `You are an HR and performance management expert. Generate Key Result Areas (KRAs) and Key Performance Indicators (KPIs) for job roles.

You have deep knowledge of this company and must tailor all KRAs and KPIs to align with the company's business, industry, values, and goals. Do NOT generate generic KRAs — every KRA should reflect what this specific company actually needs from this role.

${companyContext ? `=== COMPANY CONTEXT ===\n${companyContext}` : ""}

Return a JSON object with this exact structure:
{
  "kras": [
    {
      "name": "KRA Name",
      "description": "Brief description of this KRA",
      "category": "Category name",
      "kpis": [
        {
          "name": "KPI Name",
          "type": "QUANTITATIVE",
          "unit": "unit of measurement (%, count, hours, score, $, etc.)",
          "targetValue": 90,
          "frequency": "MONTHLY",
          "description": "What this KPI measures",
          "lowerIsBetter": false
        }
      ]
    }
  ]
}

Rules:
- Generate exactly 5 KRAs, each with exactly 3 KPIs
- ${categoryInstruction}
- KPIs must be measurable, specific to the job role, AND relevant to this company's business
- Types: "QUANTITATIVE" (numeric), "QUALITATIVE" (rating), "BINARY" (yes/no)
- Frequencies: "DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"
- Set realistic target values based on industry standards for ${industry || "this business"}
- Set lowerIsBetter to true for metrics like error rate, response time, complaints
- Use practical units: %, count, hours, score, $, days, etc.
- Avoid duplicating existing KRAs in the system
- Make KPIs actionable, trackable, and aligned with the company's mission and values
- Return ONLY valid JSON, no markdown or explanation`,
      messages: [
        {
          role: "user",
          content: `Generate KRAs and KPIs for the following job role:\n\nJob Title: ${jobTitle.trim()}\n${jobDescription?.trim() ? `\nJob Description: ${jobDescription.trim()}` : ""}`,
        },
      ],
    });

    const textBlock = message.content.find((b: any) => b.type === "text");
    const text = textBlock ? (textBlock as any).text : "";

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return jsonSuccess(parsed);
    }

    return jsonError("Failed to generate KRAs. Try again.");
  } catch (err: any) {
    console.error("AI KRA generation error:", err);
    // Surface the actual Anthropic error message so admins can see if it's
    // a credit/auth/rate-limit issue vs a code problem
    const msg = err?.error?.error?.message || err?.message || "AI generation failed. Try again.";
    return jsonError(`AI generation failed: ${msg}`);
  }
}
