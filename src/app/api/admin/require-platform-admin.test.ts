// Every handler under src/app/api/admin/ is platform-staff gated
// (spec-admin-backoffice section 4 step 2). The layout gate is not the
// security boundary; this is. A new route file that forgets the call fails
// here, not in production.

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const HANDLERS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...routeFiles(full));
    else if (name === "route.ts") out.push(full);
  }
  return out.sort();
}

/** The source of each exported handler, split at the next `export`. */
export function exportedHandlers(source: string): { name: string; body: string }[] {
  const re = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g;
  const starts: { name: string; index: number }[] = [];
  for (let m = re.exec(source); m; m = re.exec(source)) starts.push({ name: m[1], index: m.index });
  return starts.map((s, i) => ({
    name: s.name,
    body: source.slice(s.index, i + 1 < starts.length ? starts[i + 1].index : undefined),
  }));
}

/** True when the handler awaits the gate before its first database call. */
export function gatesBeforeData(body: string): boolean {
  const gate = body.indexOf("requirePlatformAdminApi(");
  if (gate < 0) return false;
  const data = body.search(/\b(prisma|tx)\.\w+\.\w+\(|applyCompanyPatch\(|logStaffAction\(/);
  return data < 0 || gate < data;
}

describe("every /api/admin/* handler calls requirePlatformAdminApi", () => {
  const files = routeFiles(ROOT);

  it("finds the route files", () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
  });

  for (const file of files) {
    const rel = relative(ROOT, file);
    const source = readFileSync(file, "utf8");
    const handlers = exportedHandlers(source);

    it(`${rel} exports at least one handler`, () => {
      expect(handlers.length).toBeGreaterThan(0);
    });

    for (const h of handlers) {
      it(`${rel} ${h.name} gates on requirePlatformAdminApi before touching data`, () => {
        expect(h.body).toContain("getSessionOrFail()");
        expect(gatesBeforeData(h.body)).toBe(true);
      });
    }

    it(`${rel} imports the gate from @/lib/platform-admin`, () => {
      expect(source).toMatch(/from "@\/lib\/platform-admin"/);
      expect(HANDLERS.some((h) => source.includes(`function ${h}`))).toBe(true);
    });
  }
});

describe("gatesBeforeData", () => {
  it("rejects a handler with no gate", () => {
    expect(gatesBeforeData("export async function GET() { return prisma.organization.findMany(); }")).toBe(false);
  });
  it("rejects a handler that reads before it gates", () => {
    expect(
      gatesBeforeData("export async function GET() { const x = await prisma.a.b(); const d = await requirePlatformAdminApi(s); }"),
    ).toBe(false);
  });
  it("accepts gate then data", () => {
    expect(
      gatesBeforeData("export async function GET() { const d = await requirePlatformAdminApi(s); if (d) return d; await prisma.a.b(); }"),
    ).toBe(true);
  });
});
