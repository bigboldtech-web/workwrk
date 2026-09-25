// A contract over the SOURCE of the Work routes' gate, because the loader
// needs a database the unit suite does not have. It pins the three promises
// the loader makes, so a later edit cannot quietly break one:
//   1. every lookup is scoped to the viewer's org (nothing foreign is named);
//   2. every object is gated by the SAME function its own API gates it with;
//   3. the gate never redirects, never 404s an object state and never uses
//      requireSessionUser's bare redirect("/login"), which drops the return
//      address.

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const LOADER = read("src/lib/work/placement-server.ts");
const GATE = read("src/components/access/work-object-gate.tsx");

/** Every `prisma.<model>.<find>(...)` call in a source, with the text of its first argument. */
function prismaReads(src: string): { model: string; args: string }[] {
  const out: { model: string; args: string }[] = [];
  const re = /prisma\.(\w+)\.(findFirst|findMany|findUnique|count)\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 1;
    let i = re.lastIndex;
    for (; i < src.length && depth > 0; i += 1) {
      if (src[i] === "(") depth += 1;
      else if (src[i] === ")") depth -= 1;
    }
    out.push({ model: m[1], args: src.slice(re.lastIndex, i - 1) });
  }
  return out;
}

describe("the Work placement loader", () => {
  it("scopes every lookup to the viewer's org", () => {
    const reads = prismaReads(LOADER);
    expect(reads.length).toBeGreaterThanOrEqual(7);
    for (const r of reads) {
      if (r.model === "organization") {
        // The org's own settings row, read by the org's id.
        expect(r.args).toMatch(/where:\s*\{\s*id:\s*orgId\s*\}/);
        continue;
      }
      expect(r.args, `prisma.${r.model} read without organizationId`).toMatch(/organizationId/);
    }
  });

  it("gates each kind with the function its own API uses", () => {
    expect(LOADER).toMatch(/docAccessible\(/);
    expect(LOADER).toMatch(/resolveDocRole\(/);
    expect(LOADER).toMatch(/getDocSharingMap\(/);
    expect(LOADER).toMatch(/readableTable\(/);
    expect(LOADER).toMatch(/whiteboardSpaceVisible\(/);
    expect(LOADER).toMatch(/loadSuiteViewer\(/);
    // The canvas read is the API's: org-scoped and not archived.
    expect(LOADER).toMatch(/prisma\.whiteboard\.findFirst\(\{\s*where:\s*\{\s*id,\s*organizationId:\s*viewer\.orgId,\s*archivedAt:\s*null\s*\}/);
    // The tree rules, for what the reveal and the pill may name.
    expect(LOADER).toMatch(/folderAccessForSpace\(/);
    expect(LOADER).toMatch(/folderVisibleTo\(/);
    expect(LOADER).toMatch(/treeFolderIds\(/);
  });

  it("leaves the access engine inert", () => {
    expect(LOADER).not.toMatch(/from "@\/lib\/access(\/[^"]*)?"/);
    expect(GATE).not.toMatch(/from "@\/lib\/access(\/[^"]*)?"/);
  });

  it("shares one whiteboard gate with GET, PATCH and DELETE /api/whiteboards/[id]", () => {
    const api = read("src/app/api/whiteboards/[id]/route.ts");
    expect(api).toMatch(/import \{ whiteboardSpaceVisible \} from "@\/lib\/whiteboard-gate"/);
    expect(api.match(/await whiteboardSpaceVisible\(/g)?.length).toBe(3);
    expect(api).not.toMatch(/function checkSpaceVisible/);
  });
});

describe("the Work object gate", () => {
  it("never redirects, never 404s an object state and never drops the return address", () => {
    const code = GATE.replace(/\/\/[^\n]*/g, "");
    expect(code).not.toMatch(/\bredirect\(/);
    expect(code).not.toMatch(/\bnotFound\(/);
    expect(code).not.toMatch(/requireSessionUser/);
  });

  it("checks the Tables module and the form Guest rule through the canonical routes' own helpers", () => {
    expect(GATE).toMatch(/tablesModuleOffView\(/);
    expect(GATE).toMatch(/formGateAllows\(/);
    const tablesGate = read("src/components/access/tables-module-gate.tsx");
    expect(tablesGate).toMatch(/return \(await tablesModuleOffView\(user\)\) \?\? <>\{children\}<\/>/);
    const formsGate = read("src/components/access/forms-gate.tsx");
    expect(formsGate).toMatch(/if \(!\(await formGateAllows\(formId, user\)\)\) notFound\(\);/);
  });

  it("logs a failure by kind and id only", () => {
    expect(GATE).toMatch(/console\.error\(`\[work-object-gate\] could not place \$\{kind\} \$\{id\}:`/);
    expect(GATE).toMatch(/unstable_rethrow\(err\)/);
  });
});

describe("the eight Work routes", () => {
  const DASH = path.join(ROOT, "src", "app", "(dashboard)");
  const routes = [
    ["spaces/[slug]/docs/[id]", "doc", "space", "DocEditorRoute", "docs/[id]"],
    ["spaces/[slug]/tables/[id]", "table", "space", "TableEditor", "tables/[id]"],
    ["spaces/[slug]/canvas/[id]", "canvas", "space", "CanvasEditor", "canvas/[id]"],
    ["work/docs/[id]", "doc", "work", "DocEditorRoute", "docs/[id]"],
    ["work/tables/[id]", "table", "work", "TableEditor", "tables/[id]"],
    ["work/canvas/[id]", "canvas", "work", "CanvasEditor", "canvas/[id]"],
    ["work/sops/[id]", "sop", "work", "SopEditorPage", "sops/[id]"],
    ["work/forms/[id]", "form", "work", "FormBuilder", "forms/[id]"],
  ] as const;

  it("gate at the [id] layout and render the SAME component as the canonical route", () => {
    for (const [dir, kind, scope, component, canonical] of routes) {
      const layout = readFileSync(path.join(DASH, dir, "layout.tsx"), "utf8");
      const page = readFileSync(path.join(DASH, dir, "page.tsx"), "utf8");
      const canonicalPage = readFileSync(path.join(DASH, canonical, "page.tsx"), "utf8");
      expect(layout, dir).toMatch(/export const dynamic = "force-dynamic";/);
      expect(layout, dir).toMatch(new RegExp(`<WorkObjectGate kind="${kind}" id=\\{id\\} at=\\{\\{ scope: "${scope}"`));
      expect(page, dir).toMatch(/^\/\* eslint-disable workwrk-ds\/dynamic-page-declares-breadcrumb \*\//);
      expect(page, dir).toMatch(/^"use client";$/m);
      // The same component, imported from the same module, as the canonical page.
      const imp = new RegExp(`import \\{ ${component} \\} from "([^"]+)";`);
      const a = imp.exec(page);
      const b = imp.exec(canonicalPage);
      expect(a?.[1], `${dir} imports ${component}`).toBeTruthy();
      expect(a?.[1]).toBe(b?.[1]);
    }
  });

  it("add no page at /work, at a kind segment or at a Space's kind segment", () => {
    const has = (rel: string) => {
      try {
        return statSync(path.join(DASH, rel, "page.tsx")).isFile();
      } catch {
        return false;
      }
    };
    expect(has("work")).toBe(false);
    for (const seg of ["docs", "tables", "canvas", "sops", "forms"]) expect(has(`work/${seg}`)).toBe(false);
    for (const seg of ["docs", "tables", "canvas"]) expect(has(`spaces/[slug]/${seg}`)).toBe(false);
    // No layout directly under spaces/[slug]: the Space page itself is never wrapped.
    expect(readdirSync(path.join(DASH, "spaces", "[slug]"))).not.toContain("layout.tsx");
  });
});
