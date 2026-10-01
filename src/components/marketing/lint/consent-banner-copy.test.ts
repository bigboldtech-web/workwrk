// The consent banner is held to every marketing copy rule.
//
// It was the last file on LEGACY_PREFIXES: the marketing layout mounts it on
// every page and the (auth) layout on every sign-in page, and it carried an
// em dash in its visible heading ("We use cookies" + dash + "your choice"),
// a second in the preferences panel, four raw hexes and a filled blue
// "Accept all" beside each page's own primary. check.mjs reports a legacy
// file but never gates it, so this test is what stops the banner sliding
// back onto the list or regrowing a finding.
//
// The loop mirrors check.mjs line for line (copyOnly rules skip commentary
// and gated lines), so a finding here is a finding there.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  RULES,
  exemptFor,
  gateMarkerFlag,
  isCommentaryOrGate,
  isLegacy,
} from "./marketing-copy-rules.mjs";

const REL = "src/components/layout/consent-banner.tsx";
const FILE = fileURLToPath(new URL("../../layout/consent-banner.tsx", import.meta.url));
const source = readFileSync(FILE, "utf8");

type Rule = {
  id: string;
  exempt?: unknown;
  copyOnly?: boolean;
  flags?: string[];
  test: (text: string) => boolean;
};

function findings(text: string, file: string): string[] {
  const out: string[] = [];
  const lines = text.split("\n");
  for (const rule of RULES as Rule[]) {
    if (rule.exempt && exemptFor(rule.exempt, file)) continue;
    lines.forEach((line, i) => {
      if (rule.copyOnly && isCommentaryOrGate(line)) return;
      if (rule.copyOnly && rule.flags) {
        const marker = gateMarkerFlag(line);
        if (marker && rule.flags.includes(marker)) return;
      }
      if (rule.test(line)) out.push(`${rule.id} at line ${i + 1}: ${line.trim()}`);
    });
  }
  return out;
}

describe("the consent banner is held to the marketing copy rules", () => {
  it("is no longer listed as legacy debt", () => {
    expect(isLegacy(REL)).toBe(false);
  });

  it("has no em dash, double hyphen, raw hex or competitor name", () => {
    expect(findings(source, FILE)).toEqual([]);
  });

  it("would be caught if the old heading came back", () => {
    // Proves the scan is live: the pre-fix heading is a finding.
    const old = source.replace('"Your cookie choices"', '"We use cookies — your choice"');
    expect(findings(old, FILE).some((f) => f.startsWith("no-em-dash"))).toBe(true);
  });

  it("paints no filled blue button beside the page's own primary", () => {
    // Accept all is a secondary at equal prominence with Reject all
    // (OPT_IN_STRICT), and the page already has its one blue primary.
    expect(source).not.toMatch(/BTN_PRIMARY/);
    expect(source).not.toMatch(/\bbg-brand\b(?!-)/);
  });
});
