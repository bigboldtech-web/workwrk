import { NextRequest } from "next/server";
import { getSessionOrFail, jsonError, jsonSuccess } from "@/lib/api-helpers";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || "",
});

export async function POST(req: NextRequest) {
  const { error } = await getSessionOrFail();
  if (error) return error;

  const { jobTitle, jobDescription } = await req.json();

  if (!jobTitle?.trim()) {
    return jsonError("Job title is required");
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    // Fallback template
    return jsonSuccess({
      kras: [
        {
          name: "Core Job Performance",
          description: `Primary responsibilities for ${jobTitle}`,
          category: "Performance",
          kpis: [
            { name: "Task Completion Rate", type: "QUANTITATIVE", unit: "%", targetValue: 95, frequency: "MONTHLY", description: "Percentage of assigned tasks completed on time" },
            { name: "Quality Score", type: "QUANTITATIVE", unit: "score", targetValue: 90, frequency: "MONTHLY", description: "Quality rating of deliverables" },
            { name: "Deadline Adherence", type: "QUANTITATIVE", unit: "%", targetValue: 90, frequency: "MONTHLY", description: "Percentage of deadlines met" },
          ],
        },
        {
          name: "Professional Development",
          description: "Growth and skill enhancement",
          category: "Growth",
          kpis: [
            { name: "Training Hours", type: "QUANTITATIVE", unit: "hours", targetValue: 8, frequency: "MONTHLY", description: "Hours spent on learning and development" },
            { name: "Skills Assessment Score", type: "QUANTITATIVE", unit: "score", targetValue: 80, frequency: "QUARTERLY", description: "Score from periodic skills evaluation" },
            { name: "Certifications Completed", type: "QUANTITATIVE", unit: "count", targetValue: 1, frequency: "QUARTERLY", description: "Number of relevant certifications obtained" },
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

Return a JSON object with this exact structure:
{
  "kras": [
    {
      "name": "KRA Name",
      "description": "Brief description of this KRA",
      "category": "Category (e.g., Performance, Quality, Growth, Leadership, Communication)",
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
- KPIs should be measurable and specific to the job role
- Types: "QUANTITATIVE" (numeric), "QUALITATIVE" (rating), "BINARY" (yes/no)
- Frequencies: "DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"
- Set realistic target values based on industry standards
- Set lowerIsBetter to true for metrics like error rate, response time, complaints
- Use practical units: %, count, hours, score, $, days, etc.
- Categories should be relevant to the role
- Make KPIs actionable and trackable
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
    return jsonError("AI generation failed. Try again.");
  }
}
