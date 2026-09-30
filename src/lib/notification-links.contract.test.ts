// A contract over the SOURCE of every server-built link to a doc, table,
// canvas, form or SOP (decision B1). A link the server builds (a
// notification row, an email, a search result, an AI answer) is read by
// someone whose access the server did not look at when it wrote the row, so
// it must be the Work door, /work/<kind>/<id>: the door places each recipient
// under their OWN access (the item's Space when they can see its path,
// otherwise the door itself), and the canonical /docs/<id> form would drop a
// person without the Docs hub into the storage browser.
//
// The routes cannot be imported here (prisma, next-auth, mail), so this reads
// them. It asserts the door is built through addressHref(..., { scope:
// "work" }) from src/lib/nav/object-href.ts, never hand-written, and that no
// canonical object literal survives. Two exceptions are pinned on purpose:
// the public responder link of a form (/forms/<id>/respond is where people
// outside the org answer it) and the calendar's /sops when an assignment has
// lost its SOP (there is no id to put behind a door).

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (rel: string) =>
  readFileSync(path.join(ROOT, rel), "utf8")
    // Comments may name the old forms (they explain what changed).
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");

const DOOR = (kind: string) => new RegExp(`addressHref\\(\\s*"${kind}"\\s*,[^)]*\\{\\s*scope:\\s*"work"\\s*\\}\\s*\\)`);

/** A canonical object address written by hand: `/docs/${...}`, "/tables/" + id and the like. */
const CANONICAL_LITERAL = /[`"']\/(docs|tables|canvas|whiteboards|forms|sops)\/(\$\{|[`"']\s*\+)/g;

function canonicalLiterals(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(CANONICAL_LITERAL)) {
    const rest = src.slice(m.index ?? 0, (m.index ?? 0) + 80);
    // The public responder is not an object address: people outside the org answer there.
    if (/^`\/forms\/\$\{[^}]+\}\/respond/.test(rest)) continue;
    out.push(rest.split("\n")[0]);
  }
  return out;
}

function importsDoor(src: string): boolean {
  return /import\s*\{[^}]*\baddressHref\b[^}]*\}\s*from\s*"@\/lib\/nav\/object-href"/.test(src);
}

interface Case {
  file: string;
  doors: Array<{ kind: string; near: RegExp }>;
}

const CASES: Case[] = [
  {
    file: "src/app/api/sop-assignments/[id]/remind/route.ts",
    doors: [
      { kind: "sop", near: /link:\s*addressHref\(/ },
      { kind: "sop", near: /sopLink:\s*absoluteUrl\(addressHref\(/ },
    ],
  },
  { file: "src/lib/forms/notify.ts", doors: [{ kind: "form", near: /link:\s*`\$\{addressHref\("form"[^`]*\}\?tab=responses`/ }] },
  {
    file: "src/app/api/cron/form-daily-summary/route.ts",
    doors: [{ kind: "form", near: /`\$\{addressHref\("form"[^`]*\}\?tab=responses`/ }],
  },
  // Phase 8 stage E: the owner lookup moved out of the route so the decision route shares it.
  { file: "src/lib/access/access-request-target.ts", doors: [{ kind: "sop", near: /link:\s*s\s*\?\s*addressHref\("sop"/ }] },
  { file: "src/app/api/ai/signals/route.ts", doors: [{ kind: "sop", near: /href:\s*addressHref\("sop"/ }] },
  { file: "src/app/api/calendar/route.ts", doors: [{ kind: "sop", near: /url:\s*a\.sop\?\.id\s*\?\s*addressHref\("sop"/ }] },
  { file: "src/app/api/docs/[id]/mention/route.ts", doors: [{ kind: "doc", near: /link:\s*addressHref\("doc"/ }] },
  {
    file: "src/lib/agents/tools.ts",
    doors: [
      { kind: "form", near: /editorUrl:\s*addressHref\("form"/ },
      { kind: "table", near: /url:\s*addressHref\("table"/ },
      { kind: "doc", near: /url:\s*addressHref\("doc"/ },
    ],
  },
];

describe("server-built object links use the Work door", () => {
  it("the literal detector sees a canonical address and lets the responder through", () => {
    expect(canonicalLiterals("link: `/docs/${doc.id}`")).toHaveLength(1);
    expect(canonicalLiterals('href: "/tables/" + t.id')).toHaveLength(1);
    expect(canonicalLiterals("responderUrl: `/forms/${form.id}/respond`")).toEqual([]);
    expect(canonicalLiterals('link: "/sops/manage?tab=sop-folders"')).toEqual([]);
  });

  for (const c of CASES) {
    it(`${c.file} builds its links through addressHref(..., { scope: "work" })`, () => {
      const src = read(c.file);
      expect(importsDoor(src), `${c.file} does not import addressHref`).toBe(true);
      for (const d of c.doors) {
        expect(src, `${c.file}: ${d.kind}`).toMatch(DOOR(d.kind));
        expect(src, `${c.file}: ${d.near}`).toMatch(d.near);
      }
      expect(canonicalLiterals(src), c.file).toEqual([]);
    });
  }

  it("the calendar keeps /sops for an assignment whose SOP is gone", () => {
    expect(read("src/app/api/calendar/route.ts")).toMatch(/addressHref\("sop",\s*a\.sop\.id,\s*\{\s*scope:\s*"work"\s*\}\)\s*:\s*"\/sops"/);
  });

  it("the agent's form keeps its public responder link", () => {
    expect(read("src/lib/agents/tools.ts")).toMatch(/responderUrl:\s*`\/forms\/\$\{form\.id\}\/respond`/);
  });

  it("search results link docs, canvases, tables, forms and SOPs through the door", () => {
    const src = read("src/app/api/search/route.ts");
    expect(importsDoor(src)).toBe(true);
    // One door helper for the five kinds, and every object row goes through it.
    expect(src).toMatch(/const door = \([^)]*\) => addressHref\(kind, id, \{ scope: "work" \}\)/);
    for (const kind of ["doc", "canvas", "table", "form", "sop"]) {
      expect(src, kind).toMatch(new RegExp(`href:\\s*door\\("${kind}"`));
    }
    expect(canonicalLiterals(src)).toEqual([]);
  });
});

describe("grant notifications", () => {
  const grants = () => read("src/lib/access/grants.ts");

  it("link a Space by its id (the Space page sends an id on to its slug)", () => {
    const src = grants();
    expect(src).toMatch(/case "space":\s*return `\/spaces\/\$\{enc\(ref\.id\)\}`/);
    expect(src).not.toMatch(/\/spaces\/\$\{[^}]*slug/);
  });

  it("link a doc, table, canvas or form through the Work door", () => {
    const src = grants();
    expect(importsDoor(src)).toBe(true);
    expect(src).toMatch(/case "doc":\s*case "table":\s*case "canvas":\s*case "form":\s*return addressHref\(ref\.kind, ref\.id, \{ scope: "work" \}\)/);
    expect(canonicalLiterals(src)).toEqual([]);
  });

  it("are the access_granted kind", () => {
    expect(grants()).toMatch(/type:\s*"access_granted"/);
  });
});
