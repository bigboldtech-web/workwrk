import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DOT_HEX } from "../data/tuesday";

// The marketing token scope mirrors the product token file. This test is
// what makes the mirror safe: it parses both sheets and fails the moment a
// value drifts, so src/app/(dashboard)/tokens.css stays the single source of
// truth even though the marketing site cannot import it (the reasons are in
// the header of marketing-shell.css).

const ROOT = join(__dirname, "..", "..", "..", "..");
const PRODUCT_TOKENS = join(ROOT, "src", "app", "(dashboard)", "tokens.css");
const MARKETING_TOKENS = join(ROOT, "src", "components", "marketing", "shell", "marketing-shell.css");
const OG_ROUTE = join(ROOT, "src", "app", "api", "og", "receipt", "route.tsx");

/** Strip comments so a hex inside a note is never read as a declaration. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function parseDeclarations(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of body.split(";")) {
    const m = line.match(/(--[A-Za-z0-9-]+)\s*:\s*([^;]+)/);
    if (m) out[m[1]] = m[2].trim().replace(/\s+/g, " ");
  }
  return out;
}

/**
 * Every custom property declared in every top-level block whose selector
 * list contains `selector` as a whole selector. Written as a scan rather
 * than a single indexOf because the same class appears in more than one
 * selector list, and taking the first match would silently read the wrong
 * block.
 */
function declarationsFor(css: string, selector: string): Record<string, string> {
  const clean = stripComments(css);
  const out: Record<string, string> = {};
  let found = false;
  const re = /(^|\n)([^{}@]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
    const selectors = m[2].split(",").map((s) => s.trim());
    if (!selectors.includes(selector)) continue;
    found = true;
    Object.assign(out, parseDeclarations(m[3]));
  }
  if (!found) throw new Error(`selector not found: ${selector}`);
  return out;
}

function blockDeclarations(css: string, selector: string): Record<string, string> {
  return declarationsFor(css, selector);
}

/** Resolve a one-level var() alias so `var(--os-surface-1)` compares as its hex. */
function resolve(map: Record<string, string>, value: string, depth = 0): string {
  const m = value.match(/^var\((--[A-Za-z0-9-]+)\)$/);
  if (!m || depth > 5) return value;
  const next = map[m[1]];
  return next === undefined ? value : resolve(map, next, depth + 1);
}

const productCss = readFileSync(PRODUCT_TOKENS, "utf8");
const marketingCss = readFileSync(MARKETING_TOKENS, "utf8");

const product: Record<string, string> = {
  ...blockDeclarations(productCss, ":root"),
  ...blockDeclarations(productCss, ".os-chrome"),
};
const marketing: Record<string, string> = {
  ...blockDeclarations(marketingCss, ".mk-tokens"),
  ...blockDeclarations(marketingCss, ".mk-os"),
};

describe("the marketing token scope", () => {
  it("declares something to mirror", () => {
    expect(Object.keys(product).length).toBeGreaterThan(80);
    expect(Object.keys(marketing).length).toBeGreaterThan(60);
  });

  it("matches the product's light value for every token it mirrors", () => {
    const drift: string[] = [];
    for (const [name, value] of Object.entries(marketing)) {
      const theirs = product[name];
      if (theirs === undefined) continue;
      const mine = resolve(marketing, value);
      const other = resolve(product, theirs);
      if (mine !== other) drift.push(`${name}: marketing "${mine}" vs product "${other}"`);
    }
    expect(drift).toEqual([]);
  });

  it("mirrors the whole navy chrome, which is the site's only dark element", () => {
    for (const name of [
      "--os-chrome-bg",
      "--os-chrome-hov",
      "--os-chrome-fg",
      "--os-chrome-fg-2",
      "--os-chrome-pill",
      "--os-chrome-pill-fg",
      "--os-side-bg",
      "--os-side-pill",
    ]) {
      expect(marketing[name], `${name} missing from the marketing scope`).toBeDefined();
      expect(marketing[name]).toBe(product[name]);
    }
    expect(marketing["--os-chrome-bg"]).toBe("#1B2537");
  });

  it("carries the one blue and the semantic trio", () => {
    expect(marketing["--os-brand"]).toBe("#0073EA");
    expect(marketing["--os-success-solid"]).toBe(product["--os-success-solid"]);
    expect(marketing["--os-warning-solid"]).toBe(product["--os-warning-solid"]);
    expect(marketing["--os-danger-solid"]).toBe(product["--os-danger-solid"]);
  });

  it("rebinds the Tailwind grid to the product's 4px so a 16px document still draws the frame in px", () => {
    expect(marketing["--spacing"]).toBe("4px");
    expect(marketing["--radius-md"]).toBe(product["--radius-md"]);
    expect(marketing["--radius-lg"]).toBe(product["--radius-lg"]);
  });

  it("is light only: no dark rebinding of any kind", () => {
    const clean = stripComments(marketingCss);
    expect(clean).not.toContain("prefers-color-scheme: dark");
    expect(clean).not.toContain(".dark");
    expect(clean).not.toContain('data-theme="dark"');
  });

  it("does not set a root font size, so the marketing document stays 16px", () => {
    const clean = stripComments(marketingCss);
    expect(clean).not.toMatch(/:root\s*\{/);
  });

  it("carries the marketing display ramp, at one weight, nowhere above 600", () => {
    const type = blockDeclarations(marketingCss, ".mk-type");
    expect(type["--mk-display-1"]).toBe("72px");
    expect(type["--mk-display-2"]).toBe("64px");
    expect(type["--mk-display-3"]).toBe("48px");
    expect(type["--mk-display-leading"]).toBe("1.05");
    expect(type["--mk-body"]).toBe("16px");
    expect(type["--mk-caption"]).toBe("13px");
    // Only Inter 400, 500 and 600 are loaded, so 700 and 800 would synthesise.
    for (const key of Object.keys(type)) {
      if (key.includes("weight")) expect(Number(type[key])).toBeLessThanOrEqual(600);
    }
  });

  it("keeps the three decorative brand dots out of the sheet", () => {
    // Blue is the exception and not an oversight: #0073EA is both the brand
    // dot and the one accent, so it belongs in the sheet as --os-brand. The
    // other three are dots only, they carry no semantic job, and a stylesheet
    // that knew them would be the first step back to the rainbow.
    const clean = stripComments(marketingCss);
    for (const key of ["yellow", "red", "green"] as const) {
      expect(clean.includes(DOT_HEX[key]), `${DOT_HEX[key]} should not be in the marketing sheet`).toBe(false);
    }
    expect(marketing["--os-brand"]).toBe(DOT_HEX.blue);
  });
});

describe("the OG card's literal token values", () => {
  // Satori cannot read custom properties, so the OG route writes the values
  // out. That is the one place a hex is allowed to be copied, and this is
  // the check that keeps the copy honest.
  const og = readFileSync(OG_ROUTE, "utf8");
  const literals: Record<string, string> = {};
  for (const m of og.matchAll(/^\s*(\w+):\s*"(#[0-9A-Fa-f]{6})",/gm)) literals[m[1]] = m[2];

  const EXPECTED: Array<[string, string]> = [
    ["canvas", "--os-canvas"],
    ["surface1", "--os-surface-1"],
    ["line", "--os-line"],
    ["ink", "--os-ink"],
    ["ink2", "--os-ink-2"],
    ["ink3", "--os-ink-3"],
    ["navy", "--os-chrome-bg"],
  ];

  it("copied every neutral straight from the marketing scope", () => {
    for (const [key, token] of EXPECTED) {
      expect(literals[key], `OG literal ${key} missing`).toBeDefined();
      expect(literals[key]!.toUpperCase()).toBe(resolve(marketing, marketing[token]).toUpperCase());
    }
  });

  it("does NOT copy the four brand dots, it imports them", () => {
    // The neutrals above have to be literals: Satori cannot read a custom
    // property and there is no JS module that owns a grey. The brand dots
    // are different. They have an owner, src/components/brand, and an
    // import costs nothing, so a fourth copy of the palette is not a
    // Satori constraint, it is drift waiting to happen.
    expect(og).toMatch(/import\s*\{\s*DOT_HEX\s*\}\s*from\s*"@\/components\/marketing\/data\/tuesday"/);
    for (const hex of Object.values(DOT_HEX)) {
      expect(og.toUpperCase(), `${hex} is re-declared in the OG route`).not.toContain(hex.toUpperCase());
    }
    expect(literals.dotY).toBeUndefined();
  });

  it("uses flexbox only, because Satori has no grid", () => {
    expect(og).not.toMatch(/display:\s*"grid"/);
  });
});

/* ═══════════════════════════════════════════════════════════════════
 * An element is never inside its own container.
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * The selector lists of every rule nested inside an `@container <name>`
 * block, found by matching braces rather than by regex, because a container
 * block holds rules and a regex for `{...}` stops at the first inner brace.
 */
function selectorsInsideContainer(css: string, containerName: string): string[] {
  const clean = stripComments(css);
  const out: string[] = [];
  const opener = new RegExp(`@container\\s+${containerName}\\b[^{]*\\{`, "g");
  let m: RegExpExecArray | null;
  while ((m = opener.exec(clean)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < clean.length && depth > 0) {
      if (clean[i] === "{") depth += 1;
      else if (clean[i] === "}") depth -= 1;
      i += 1;
    }
    const body = clean.slice(start, i - 1);
    for (const rule of body.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
      for (const selector of rule[1].split(",")) {
        const trimmed = selector.trim();
        if (trimmed) out.push(trimmed);
      }
    }
  }
  return out;
}

/** The last compound of a selector: the element the rule actually styles. */
export function subjectCompound(selector: string): string {
  const parts = selector.split(/\s*[>+~]\s*|\s+/).filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

describe("container queries named on .mk-shell", () => {
  const css = readFileSync(MARKETING_TOKENS, "utf8");

  it("takes the last compound as the subject", () => {
    expect(subjectCompound('.mk-shell[data-sidebar="grey"]')).toBe('.mk-shell[data-sidebar="grey"]');
    expect(subjectCompound('.mk-shell[data-sidebar="grey"] .mk-shell__search')).toBe(".mk-shell__search");
    expect(subjectCompound(".mk-scale > .mk-shell")).toBe(".mk-shell");
  });

  it("never styles .mk-shell itself from inside mkshell", () => {
    // `container-name: mkshell` is declared ON `.mk-shell`, and a container
    // query can only ever reach that element's DESCENDANTS. A rule whose
    // SUBJECT is the shell therefore never applies, silently: it is not a
    // syntax error and nothing in a build warns about it.
    //
    // This is not hypothetical. `.mk-shell[data-sidebar="grey"] {
    // grid-template-columns: ... }` sat inside this query and never ran, so
    // a narrow frame kept three declared grid columns while its sidebar
    // stopped generating a box, the canvas auto-placed into the middle
    // track, and the third track showed as an empty white strip to the
    // right of the navy top bar on every product frame under 700px wide.
    //
    // Reading the shell's own attribute as an ANCESTOR is fine and is how
    // the sidebar-aware rules are written, which is why this checks the
    // subject rather than the whole selector.
    const offenders = selectorsInsideContainer(css, "mkshell").filter((selector) =>
      /^\.mk-shell(?![\w-])/.test(subjectCompound(selector)),
    );
    expect(offenders, `these rules can never match: ${offenders.join(" | ")}`).toEqual([]);
  });

  it("still finds the rules that DO reach a descendant", () => {
    // A guard on the guard: if the parser stopped finding anything the test
    // above would pass by reading an empty list.
    const selectors = selectorsInsideContainer(css, "mkshell");
    expect(selectors.length).toBeGreaterThan(3);
    expect(selectors).toContain(".mk-shell__side");
  });
});
