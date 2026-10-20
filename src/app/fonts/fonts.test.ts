// The app's two fonts ship with the code (2026-10-20). next/font/google
// downloaded them at every build, and a slow or failed fetch failed the
// production deploy and a local proof that day. No file under src may load a
// font from Google again, and the bundled files must be real WOFF2.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "..");

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "generated" || name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.(tsx?|mjs|jsx?)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

describe("the app's fonts", () => {
  it("never loads a font from Google at build time", () => {
    const hits = sources(SRC).filter((p) => readFileSync(p, "utf8").includes("next/font/google"));
    expect(hits).toEqual([]);
  });

  it("bundles Inter and JetBrains Mono as WOFF2, through next/font/local", () => {
    for (const f of ["inter-latin.woff2", "jetbrains-mono-latin.woff2"]) {
      const bytes = readFileSync(join(__dirname, f));
      expect(bytes.subarray(0, 4).toString("latin1"), f).toBe("wOF2");
      expect(bytes.length, f).toBeGreaterThan(20_000);
    }
    const layout = readFileSync(join(__dirname, "..", "layout.tsx"), "utf8");
    expect(layout).toContain('import localFont from "next/font/local";');
    expect(layout).toContain('src: "./fonts/inter-latin.woff2"');
    expect(layout).toContain('src: "./fonts/jetbrains-mono-latin.woff2"');
    expect(layout).toContain('variable: "--font-inter"');
    expect(layout).toContain('variable: "--font-mono"');
  });
});
