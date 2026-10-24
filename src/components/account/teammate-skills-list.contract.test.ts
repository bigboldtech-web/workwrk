// My account's list of the skills a person showed their AI teammates
// (src/components/account/teammate-skills-list.tsx, review of
// docs/plans/ai-teammates-phase5.md step 3, M2), held to its rules by
// reading it as written, since the suite runs in node with no page: it reads
// the person's own skills with no teammate named (a route that needs no AI
// app), draws nothing until then or while none is kept, deletes only behind
// a confirm naming the workspace it read, never a recording, and draws no
// blue button; the Profile page draws it in its Your data card.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** The source without its comments, so a rule is held by the code, not by what a comment says. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

describe("My account's list of a person's own skills (review of Phase 5 step 3, M2)", () => {
  const c = code(read("src/components/account/teammate-skills-list.tsx"));
  const profile = code(read("src/app/(dashboard)/account/profile/page.tsx"));

  it("reads the person's own skills with no teammate named, and draws nothing until then or while none is kept", () => {
    expect(c).toContain('apiFetch<{ skills: OwnSkillRow[] }>("/api/teammate-skills", { cache: "no-store" })');
    expect(c).not.toContain("?agent=");
    expect(c).toContain("if (!skills || skills.length === 0) return null;");
  });

  it("deletes one only behind its confirm, naming the workspace it read, never a recording, and reloads when the workspace changed", () => {
    expect(c).toContain("confirm({ title: S.deleteTitle, description: S.deleteBody, confirmLabel: S.delete, destructive: true })");
    expect(c).toContain('method: "DELETE", json: { organizationId: s.organizationId }');
    expect(c).toContain('{s.status !== "recording" ? (');
    expect(c).toContain('if (r.code === "workspace_changed") window.location.reload();');
  });

  it("draws no blue button and types no words into its markup", () => {
    expect(c).not.toMatch(/bg-brand\b|btn\.primary/);
    for (const m of c.matchAll(/<button\b[^>]*className=\{([^}]+)\}/g)) expect(["btn.dangerGhost"], m[0]).toContain(m[1]);
    const texts = [...c.matchAll(/>\s*([A-Za-z][^<>{};()=]*?)\s*<\//g)].map((m) => m[1].trim()).filter(Boolean);
    expect(texts).toEqual([]);
  });

  it("is drawn in the Profile page's Your data card, under Download", () => {
    // Settings clean-up Phase 3: the card's opening tag now also carries its description and Show more, so it is
    // found by its title and id; the card must still be there, and the list still inside it, under Download.
    const start = profile.search(/<SettingsCard\s+title="Your data"\s+id="profile\.data"/);
    expect(start).toBeGreaterThan(0);
    const card = profile.slice(start, profile.indexOf("</SettingsCard>", start));
    expect(card).toContain("<TeammateSkillsList />");
    expect(card.indexOf("<TeammateSkillsList />")).toBeGreaterThan(card.indexOf("Download"));
    expect(profile).toContain('import { TeammateSkillsList } from "@/components/account/teammate-skills-list";');
  });
});
