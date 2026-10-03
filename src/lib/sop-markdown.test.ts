// An SOP as Markdown, one test per kind, from content shapes saved on the
// local database (2026-10-04).

import { describe, expect, it } from "vitest";
import { sopToMarkdown } from "./sop-markdown";

describe("sopToMarkdown", () => {
  it("heads every SOP with its title and facts", () => {
    const md = sopToMarkdown({ title: "Leave approval", status: "PUBLISHED", version: 3, category: "HR", sopType: "WRITTEN", content: { type: "steps", steps: [] }, description: "<p>How a manager approves leave.</p>" });
    expect(md.startsWith("# Leave approval\n\nPublished · Version 3 · Step-by-step · Category: HR\n\nHow a manager approves leave.\n")).toBe(true);
  });

  it("writes a step-by-step SOP as numbered steps with owners, text and images", () => {
    const md = sopToMarkdown({
      title: "Open the app",
      sopType: "WRITTEN",
      content: {
        type: "steps",
        layout: "list",
        steps: [
          { id: "s1", title: "Open the app", body: "Go to workwrk" },
          { id: "s2", title: "Sign in", description: "<p>Use <b>SSO</b>.</p>", jobTitle: { title: "Onboarding lead", roleId: "r1" }, image: "data:image/png;base64,iVBORw0KGgo=" },
        ],
      },
    });
    expect(md).toContain("## Steps");
    expect(md).toContain("1. **Open the app**\n   Go to workwrk");
    expect(md).toContain("2. **Sign in**\n   Owner: Onboarding lead\n   Use SSO.");
    expect(md).toContain("   ![Step 2](data:image/png;base64,iVBORw0KGgo=)");
  });

  it("writes a flow's decisions and where each branch goes", () => {
    const md = sopToMarkdown({
      title: "Triage",
      sopType: "WRITTEN",
      content: {
        type: "process_flow",
        steps: [
          { id: "a", title: "Read the ticket" },
          { id: "b", title: "Is it urgent?" },
          { id: "c", title: "Page the on-call" },
        ],
        flow: {
          type: "process_flow",
          steps: [
            { id: "a", type: "action", title: "Read the ticket", actor: "Support", durationMinutes: 5 },
            { id: "b", type: "decision", title: "Is it urgent?", branches: [{ label: "Yes", nextStepId: "c" }, { label: "No", nextStepId: null }] },
            { id: "c", type: "action", title: "Page the on-call" },
          ],
        },
      },
    });
    expect(md).toContain("1. **Read the ticket**\n   Who: Support · About 5 min");
    expect(md).toContain("2. Decision: **Is it urgent?**\n   - Yes: go to step 3\n   - No: go to the end");
  });

  it("writes a checklist's sections as boxes with what each step asks for", () => {
    const md = sopToMarkdown({
      title: "Closing checklist",
      sopType: "CHECKLIST",
      content: {
        type: "CHECKLIST",
        sections: [
          { id: "s", title: "Before you leave", steps: [{ id: "1", title: "Lock the door", description: "", inputs: [{ type: "file_upload", label: "" }, { type: "short_text", label: "Who locked it" }] }] },
        ],
      },
    });
    expect(md).toContain("## Before you leave\n\n- [ ] Lock the door\n  Asks for: File, Who locked it");
  });

  it("writes a recording's actions in their recorded order, with the page", () => {
    const md = sopToMarkdown({
      title: "Submit an invoice",
      sopType: "RECORDED",
      content: {
        type: "recorded",
        steps: [
          { url: "https://example.com/form", order: 2, action: "type", description: "Type the invoice number" },
          { url: "https://example.com/form", order: 1, action: "click", description: "Click the Submit button" },
        ],
      },
    });
    expect(md).toContain("## Recorded steps\n\n1. Click the Submit button\n   On <https://example.com/form>\n\n2. Type the invoice number");
  });

  it("writes a written SOP from BlockNote, the first block editor, or stored HTML", () => {
    const bn = sopToMarkdown({
      title: "Written",
      sopType: "WRITTEN",
      content: { type: "blocks", bnDoc: [{ id: "x", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Scope", styles: {} }], children: [] }] },
    });
    expect(bn).toContain("## Scope");
    const legacy = sopToMarkdown({ title: "Old", sopType: "WRITTEN", content: { type: "blocks", blocks: [{ kind: "bullet", text: "First" }] } });
    expect(legacy).toContain("- First");
    const html = sopToMarkdown({ title: "Rich", sopType: "WRITTEN", content: { type: "WRITTEN", body: "<p>Keep it <b>short</b>.</p>" } });
    expect(html).toContain("Keep it short.");
  });

  it("keeps a recording's screenshots, a checklist's approval, added blocks and images in step text", () => {
    const rec = sopToMarkdown({
      title: "Rec",
      sopType: "RECORDED",
      content: { type: "recorded", steps: [{ order: 1, description: "Click Save", url: "https://example.com/a", screenshot: "https://cdn.example.com/s1.png" }] },
    });
    expect(rec).toContain("1. Click Save\n   ![Step 1](https://cdn.example.com/s1.png)\n   On <https://example.com/a>");
    const list = sopToMarkdown({
      title: "Check",
      sopType: "CHECKLIST",
      content: {
        type: "CHECKLIST",
        sections: [{ id: "s", title: "Close", steps: [{
          id: "1", type: "approval", title: "Manager signs off", description: "<p>See <img src=\"https://cdn.example.com/form.png\"></p>",
          contentBlocks: [
            { id: "a", type: "text", content: "Use the blue pen." },
            { id: "b", type: "horizontal_line", content: "" },
            { id: "c", type: "image", content: "data:image/png;base64,iVBORw0KGgo=" },
            { id: "d", type: "video", content: "https://cdn.example.com/how.mp4" },
          ],
        }] }],
      },
    });
    expect(list).toContain("- [ ] Manager signs off (Approval)");
    expect(list).toContain("  ![Step image](https://cdn.example.com/form.png)");
    expect(list).toContain("  Use the blue pen.\n  ---\n  ![Image](data:image/png;base64,iVBORw0KGgo=)\n  [Video](https://cdn.example.com/how.mp4)");
  });

  it("writes a flow-layout SOP from its flow copy, so a step only the flow holds is kept", () => {
    const md = sopToMarkdown({
      title: "Flow",
      sopType: "WRITTEN",
      content: {
        type: "steps",
        layout: "flow",
        steps: [{ id: "a", title: "First", image: "https://cdn.example.com/a.png" }],
        flow: { type: "process_flow", steps: [{ id: "a", type: "action", title: "First" }, { id: "b", type: "action", title: "Only in the flow" }] },
      },
    });
    expect(md).toContain("1. **First**\n   ![Step 1](https://cdn.example.com/a.png)");
    expect(md).toContain("2. **Only in the flow**");
  });

  it("escapes Markdown's own characters in text people typed", () => {
    const md = sopToMarkdown({ title: "Use *only* [approved] tools", sopType: "WRITTEN", content: { type: "steps", steps: [{ id: "1", title: "Run `deploy`" }] } });
    expect(md).toContain("# Use \\*only\\* \\[approved\\] tools");
    expect(md).toContain("1. **Run \\`deploy\\`**");
  });
});
