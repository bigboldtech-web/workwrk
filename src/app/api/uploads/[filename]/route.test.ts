import { describe, expect, it, vi } from "vitest";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import nextConfig from "../../../../../next.config";

vi.mock("fs/promises", () => ({ readFile: async () => Buffer.from("x") }));
// Who is signed in, and where they hold a live seat (the final review, V-23).
const who = vi.hoisted(() => ({ userId: "u1" as string | null, seats: new Set<string>(["cmcompanyaaaaaaaaaaaaaaaa"]) }));
vi.mock("next-auth", () => ({ getServerSession: async () => (who.userId ? { user: { id: who.userId } } : null) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/access/seated-here", () => ({ personHere: async (company: string) => (who.seats.has(company) ? { id: who.userId } : null) }));

import { GET } from "./route";

const get = (filename: string) =>
  GET(new Request(`http://x/api/uploads/${filename}`) as never, { params: Promise.resolve({ filename }) });

type Rule = { source: string; headers: { key: string; value: string }[] };

/** The value a header ends with on a path: the last matching rule sets it. */
async function configHeader(path: string, key: string): Promise<string | undefined> {
  const rules = (await (nextConfig as { headers: () => Promise<Rule[]> }).headers());
  let value: string | undefined;
  for (const r of rules) {
    if (!getPathMatch(r.source)(path)) continue;
    const h = r.headers.find((x) => x.key.toLowerCase() === key.toLowerCase());
    if (h) value = h.value;
  }
  return value;
}

describe("uploaded files", () => {
  it("show images, an SVG logo included, and download everything else", async () => {
    for (const [name, type] of [["logo-o-1.png", "image/png"], ["logo-o-1.svg", "image/svg+xml"], ["a.gif", "image/gif"]]) {
      const res = await get(name);
      expect(res.headers.get("content-type"), name).toBe(type);
      expect(res.headers.get("content-disposition"), name).toBeNull();
    }
    for (const name of ["file-o-1.html", "file-o-1.pdf", "file-o-1.xml", "noext"]) {
      const res = await get(name);
      expect(res.headers.get("content-type"), name).toBe("application/octet-stream");
      expect(res.headers.get("content-disposition"), name).toBe("attachment");
    }
  });

  it("a file is its company's: signed out it asks to sign in, a stranger to the company finds nothing, images stay open (the final review, V-23)", async () => {
    who.userId = null;
    expect((await get("file-cmcompanyaaaaaaaaaaaaaaaa-x.pdf")).status).toBe(401);
    expect((await get("logo-o-1.png")).status).toBe(200);
    who.userId = "u1";
    expect((await get("file-cmcompanyaaaaaaaaaaaaaaaa-x.pdf")).status).toBe(200);
    expect((await get("file-cmothercompanybbbbbbbbbbb-x.pdf")).status).toBe(404);
  });

  it("open sandboxed on their own, by the route and straight from the folder", async () => {
    for (const path of ["/api/uploads/logo-o-1.svg", "/uploads/logo-o-1.svg", "/uploads/old.html"]) {
      const csp = await configHeader(path, "Content-Security-Policy");
      expect(csp, path).toMatch(/^sandbox; default-src 'none';/);
      expect(csp, path).toContain("frame-ancestors 'self'");
      expect(await configHeader(path, "X-Content-Type-Options"), path).toBe("nosniff");
    }
    // Every other page keeps the general policy.
    expect(await configHeader("/home", "Content-Security-Policy")).toBe("frame-ancestors 'self'");
  });

  it("are never served from public/ by extension: /uploads goes through the route", async () => {
    const r = await (nextConfig as { rewrites: () => Promise<{ beforeFiles: { source: string; destination: string }[] }> }).rewrites();
    expect(r.beforeFiles).toContainEqual({ source: "/uploads/:path*", destination: "/api/uploads/:path*" });
  });
});
