// The browser host's boundaries (docs/plans/browser-host.md section 10,
// Decision 15): it imports nothing of the app, the app imports nothing of
// it, proof mode is loaded only in proof mode, only the launcher speaks to
// Docker, and no file names a forbidden Chrome flag.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { FORBIDDEN_FLAGS, PROOF_ONLY_FLAG } from "./forbidden-flags";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const SELF = fileURLToPath(import.meta.url);

/** Every file under `dir`, but node_modules. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/** The module specifiers a file imports, statically or not. */
function specifiers(text: string): string[] {
  const out: string[] = [];
  const re = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["'`]([^"'`]+)["'`]/g;
  for (let m = re.exec(text); m; m = re.exec(text)) out.push(m[1]);
  return out;
}

/** Whether a specifier in `file` reaches the repository's services/ folder (src/lib/services is the app's own). */
function intoServices(file: string, s: string): boolean {
  const services = path.join(ROOT, "services") + path.sep;
  if (s.startsWith(".")) return path.resolve(path.dirname(file), s).startsWith(services);
  return path.isAbsolute(s) ? s.startsWith(services) : /^services\//.test(s);
}

const hostFiles = walk(HERE);
const rel = (p: string) => path.relative(HERE, p).split(path.sep).join("/");
const isTest = (p: string) => p.endsWith(".test.ts");
const code = hostFiles.filter((p) => /\.(mjs|ts)$/.test(p));

describe("the browser host's boundaries", () => {
  it("no file under src/ imports services/", () => {
    const offenders = walk(path.join(ROOT, "src"))
      .filter((p) => /\.(ts|tsx|mjs|js)$/.test(p))
      .filter((p) => specifiers(fs.readFileSync(p, "utf8")).some((s) => intoServices(p, s)));
    expect(offenders).toEqual([]);
  });

  it("no file of the host but a test imports src/, @/, next or react", () => {
    const offenders: string[] = [];
    for (const p of code.filter((x) => !isTest(x))) {
      for (const s of specifiers(fs.readFileSync(p, "utf8"))) {
        if (/^@\//.test(s) || /^(next|react|react-dom)(\/|$)/.test(s) || /(^|\/)src\//.test(s)) offenders.push(`${rel(p)}: ${s}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every .mjs starts // @ts-check", () => {
    const mjs = hostFiles.filter((p) => p.endsWith(".mjs"));
    expect(mjs.length).toBeGreaterThan(10);
    expect(mjs.filter((p) => !fs.readFileSync(p, "utf8").startsWith("// @ts-check\n")).map(rel)).toEqual([]);
  });

  it("proof/ is loaded only by a dynamic import inside if (cfg.proof) in main.mjs", () => {
    const outside = code.filter((p) => !isTest(p) && !rel(p).startsWith("proof/") && rel(p) !== "main.mjs");
    expect(outside.filter((p) => specifiers(fs.readFileSync(p, "utf8")).some((s) => /(^|\/)proof\//.test(s))).map(rel)).toEqual([]);
    const main = fs.readFileSync(path.join(HERE, "main.mjs"), "utf8");
    const open = main.indexOf("if (cfg.proof) {");
    expect(open).toBeGreaterThan(0);
    // The block's end: its matching brace.
    let depth = 0;
    let close = -1;
    for (let i = main.indexOf("{", open); i < main.length; i += 1) {
      if (main[i] === "{") depth += 1;
      else if (main[i] === "}" && (depth -= 1) === 0) {
        close = i;
        break;
      }
    }
    const uses = [...main.matchAll(/["'`]\.\/proof\/[^"'`]+["'`]/g)].map((m) => m.index ?? -1);
    expect(uses.length).toBeGreaterThanOrEqual(3);
    for (const at of uses) {
      expect(at > open && at < close).toBe(true);
      expect(main.slice(Math.max(0, at - 20), at)).toMatch(/import\(\s*$/);
    }
    expect(specifiers(main).filter((s) => s.startsWith("./proof/"))).toHaveLength(uses.length);
    expect(/^import[^\n]*\.\/proof\//m.test(main)).toBe(false);
  });

  it("only launcher/ names docker.sock", () => {
    const sock = ["docker", "sock"].join(".");
    expect(hostFiles.filter((p) => p !== SELF && !rel(p).startsWith("launcher/") && fs.readFileSync(p, "utf8").includes(sock)).map(rel)).toEqual([]);
  });

  it("lib/ never calls os.networkInterfaces or dns.lookup", () => {
    const lib = code.filter((p) => rel(p).startsWith("lib/") && !isTest(p));
    expect(lib.length).toBeGreaterThan(8);
    for (const p of lib) {
      const t = fs.readFileSync(p, "utf8");
      expect({ file: rel(p), bad: /networkInterfaces|dns\.lookup|["']node:dns["']|["']dns["']/.test(t) }).toEqual({ file: rel(p), bad: false });
    }
  });

  it("the host's package holds only ws, within the root's range", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(HERE, "package.json"), "utf8"));
    const root = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    expect(pkg.name).toBe("workwrk-browser-host");
    expect(pkg.type).toBe("module");
    expect(Object.keys(pkg.dependencies)).toEqual(["ws"]);
    expect(pkg.devDependencies ?? {}).toEqual({});
    const mine = String(pkg.dependencies.ws);
    expect(mine).toMatch(/^\d+\.\d+\.\d+$/);
    const range = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(String(root.dependencies.ws));
    expect(range).not.toBeNull();
    const [maj, min, pat] = mine.split(".").map(Number);
    const [rmaj, rmin, rpat] = range!.slice(1).map(Number);
    expect(maj).toBe(rmaj);
    expect(min > rmin || (min === rmin && pat >= rpat)).toBe(true);
  });

  it("the forbidden Chrome flags appear nowhere in the folder but the tests' own list, and the resolver rules only in chrome-args.mjs", () => {
    const list = path.join(HERE, "forbidden-flags.ts");
    const offenders: string[] = [];
    for (const p of hostFiles.filter((x) => x !== list)) {
      const t = fs.readFileSync(p, "utf8");
      for (const f of FORBIDDEN_FLAGS) if (t.includes(f)) offenders.push(`${rel(p)}: ${f}`);
      if (t.includes(PROOF_ONLY_FLAG) && rel(p) !== "lib/chrome-args.mjs") offenders.push(`${rel(p)}: ${PROOF_ONLY_FLAG}`);
    }
    expect(offenders).toEqual([]);
  });
});
