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

/**
 * The source of each exported handler, split at the next handler export.
 * Both `export async function GET` and `export const GET = ...` count.
 */
export function exportedHandlers(source: string): { name: string; body: string }[] {
  const re = /export\s+(?:(?:async\s+)?function\s+|const\s+)(GET|POST|PUT|PATCH|DELETE)\b/g;
  const starts: { name: string; index: number }[] = [];
  for (let m = re.exec(source); m; m = re.exec(source)) starts.push({ name: m[1], index: m.index });
  return starts.map((s, i) => ({
    name: s.name,
    body: source.slice(s.index, i + 1 < starts.length ? starts[i + 1].index : undefined),
  }));
}

// Anything that reads or writes data: a model call, a raw or transactional
// call on the client, or one of the helpers that write for the console.
const DATA_CALL =
  /\b(prisma|tx)\.(\w+\.\w+|\$transaction|\$queryRaw\w*|\$executeRaw\w*)\s*[(`]|\b(applyCompanyPatch|logStaffAction|setFeature|writeOrgSettingsKeys|writeTenantRow)\(/;

/**
 * True when the handler assigns the gate's result, RETURNS it when set, and
 * does both before its first data call. A bare `await requirePlatformAdminApi(s);`
 * whose result is dropped gates nothing, so it fails here.
 */
export function gatesBeforeData(body: string): boolean {
  const call = /(?:const|let)\s+(\w+)\s*=\s*await\s+requirePlatformAdminApi\(/.exec(body);
  if (!call) return false;
  const name = call[1];
  const returned = new RegExp(`if\\s*\\(\\s*${name}\\s*\\)\\s*(?:\\{\\s*)?return\\s+${name}\\b`).exec(body.slice(call.index));
  if (!returned) return false;
  const gateEnd = call.index + returned.index + returned[0].length;
  const data = body.search(DATA_CALL);
  return data < 0 || gateEnd < data;
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
      expect(HANDLERS.some((h) => source.includes(`function ${h}`) || source.includes(`const ${h}`))).toBe(true);
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
  it("rejects a gate whose result is dropped", () => {
    expect(
      gatesBeforeData("export async function GET() { await requirePlatformAdminApi(s); await prisma.a.b(); }"),
    ).toBe(false);
    expect(
      gatesBeforeData("export async function GET() { const denied = await requirePlatformAdminApi(s); await prisma.a.b(); }"),
    ).toBe(false);
  });
  it("rejects a transaction or raw query before the gate returns", () => {
    expect(
      gatesBeforeData(
        "export async function GET() { const d = await requirePlatformAdminApi(s); await prisma.$transaction(async () => {}); if (d) return d; }",
      ),
    ).toBe(false);
    expect(
      gatesBeforeData("export async function GET() { await prisma.$queryRaw`SELECT 1`; const d = await requirePlatformAdminApi(s); if (d) return d; }"),
    ).toBe(false);
  });
  it("finds handlers exported as const", () => {
    expect(exportedHandlers("export const GET = async () => {}; export async function POST() {}").map((h) => h.name)).toEqual([
      "GET",
      "POST",
    ]);
  });
  it("accepts gate then data", () => {
    expect(
      gatesBeforeData("export async function GET() { const d = await requirePlatformAdminApi(s); if (d) return d; await prisma.a.b(); }"),
    ).toBe(true);
    expect(
      gatesBeforeData("export async function GET() { const denied = await requirePlatformAdminApi(s);\n  if (denied) { return denied; }\n await prisma.$transaction(f); }"),
    ).toBe(true);
  });
});
