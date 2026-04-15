import { NextRequest } from "next/server";
import { getSessionOrFail, jsonError, jsonSuccess } from "@/lib/api-helpers";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || "",
});

export async function POST(req: NextRequest) {
  const { error } = await getSessionOrFail();
  if (error) return error;

  const { title, context } = await req.json();

  if (!title && !context) {
    return jsonError("Provide a title or context for the process");
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    // Return a template-based fallback with inputs and content blocks
    return jsonSuccess({
      title: title || "New Process",
      description: context || "",
      sections: [
        {
          id: "s1",
          title: "Getting Started",
          steps: [
            {
              id: "s1-1", title: "Define the objective", description: "Clearly state the goal of this process",
              type: "task", inputs: [], contentBlocks: [
                { id: "cb1", type: "text", content: "Write down the specific outcome you want to achieve." }
              ],
            },
            {
              id: "s1-2", title: "Gather requirements", description: "Collect all necessary information",
              type: "task",
              inputs: [
                { id: "inp1", type: "long_text", label: "Requirements Notes", required: true }
              ],
              contentBlocks: [],
            },
          ],
        },
        {
          id: "s2",
          title: "Execution",
          steps: [
            { id: "s2-1", title: "Execute the plan", description: "Follow the outlined steps", type: "task", inputs: [], contentBlocks: [] },
            { id: "s2-2", title: "Document results", description: "Record what was done", type: "task",
              inputs: [
                { id: "inp2", type: "short_text", label: "Completion Notes", required: false }
              ],
              contentBlocks: [],
            },
          ],
        },
        {
          id: "s3",
          title: "Completion",
          steps: [
            { id: "s3-1", title: "Final Review", description: "Get approval from manager", type: "approval", inputs: [], contentBlocks: [] },
          ],
        },
      ],
    });
  }

  try {
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      system: `You are a process design expert. Create structured, actionable checklists for business processes.

Return a JSON object with this exact structure:
{
  "title": "Process Title",
  "description": "Brief description",
  "sections": [
    {
      "id": "s1",
      "title": "Section Name",
      "steps": [
        {
          "id": "s1-1",
          "title": "Step title",
          "description": "What to do",
          "type": "task",
          "inputs": [
            { "id": "inp1", "type": "short_text", "label": "Field Label", "required": true }
          ],
          "contentBlocks": [
            { "id": "cb1", "type": "text", "content": "Instructions or context for this step" }
          ]
        }
      ]
    }
  ]
}

Rules:
- Each section groups related steps
- Step types: "task" (normal), "approval" (needs sign-off)
- Input types: "number", "short_text", "long_text", "checkbox", "email", "website", "date", "dropdown", "multichoice", "file_upload"
- For dropdown/multichoice, include "options": ["Option 1", "Option 2"]
- Content block types: "text", "horizontal_line", "image", "video"
- Add inputs where data collection is needed (e.g., name fields, dates, notes, confirmations)
- Add content blocks for step instructions or context
- Not every step needs inputs — only add them where it makes sense
- Keep steps actionable and specific
- Use 2-5 sections with 2-6 steps each
- Return ONLY valid JSON, no markdown or explanation`,
      messages: [
        {
          role: "user",
          content: `Create a detailed process checklist for: ${title || ""}${context ? "\n\nContext: " + context : ""}`,
        },
      ],
    });

    const textBlock = message.content.find((b: any) => b.type === "text");
    const text = textBlock ? (textBlock as any).text : "";

    // Parse JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return jsonSuccess(parsed);
    }

    return jsonError("Failed to generate process. Try again.");
  } catch (err: any) {
    console.error("AI generation error:", err);
    const msg = err?.error?.error?.message || err?.message || "AI generation failed. Try again.";
    return jsonError(`AI generation failed: ${msg}`);
  }
}
