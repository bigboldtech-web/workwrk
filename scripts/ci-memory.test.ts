import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
const SCRIPT = path.join(REPO_ROOT, "scripts/ci-memory.sh");
const MEASURES = existsSync("/proc/meminfo");
const dir = mkdtempSync(path.join(tmpdir(), "ci-memory-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const run = (args: string[]) => spawnSync("bash", [SCRIPT, ...args], { encoding: "utf8" });

describe("ci-memory.sh", () => {
  it("exits with the command's own status and writes its output to the log", () => {
    const log = path.join(dir, "step.log");
    const r = run(["a step", log, "bash", "-c", "echo hello from the step; exit 3"]);
    expect(r.status).toBe(3);
    expect(readFileSync(log, "utf8")).toContain("hello from the step");
    expect(r.stdout).not.toContain("hello from the step");
  });

  it("passes the command's output through with -", () => {
    const r = run(["a step", "-", "bash", "-c", "echo through"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("through");
  });

  it("reports the step's memory, or says it could not", () => {
    const r = run(["a step", "-", "true"]);
    if (MEASURES) {
      expect(r.stdout).toMatch(/^::notice title=memory \(a step\)::peak \d+ MB in use of \d+ MB, \d+ MB left at the tightest, swap \d+ MB$/m);
    } else {
      expect(r.stdout).toContain("memory (a step): not measured here");
    }
  });
});

// The settings measured on 2026-11-01 for a private repository's runner
// (2 CPUs, 8 GB; .github/workflows/ci.yml, MEMORY). Each one is here so a
// change to it is a decision, not an accident.
describe("the workflows keep the measured settings", () => {
  const ci = readFileSync(path.join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");
  const deploy = readFileSync(path.join(REPO_ROOT, ".github/workflows/deploy.yml"), "utf8");

  it("the type check and the unit tests report their memory", () => {
    expect(ci).toMatch(/ci-memory\.sh "type check" - npx tsc --noEmit -p tsconfig\.json/);
    expect(ci).toMatch(/ci-memory\.sh "unit tests" - npx vitest run --maxWorkers=100%/);
  });

  it("the unit tests use every CPU (the default leaves one of two idle)", () => {
    expect(ci).toContain("--maxWorkers=100%");
  });

  it("the build reports its memory and keeps the 4096 MB heap that fails with a message", () => {
    expect(deploy).toMatch(/NODE_OPTIONS=--max-old-space-size=4096 bash scripts\/ci-memory\.sh build \/tmp\/ci-build\.log npx next build/);
    expect(deploy).not.toMatch(/max-old-space-size=6144 npx next build/);
  });
});
