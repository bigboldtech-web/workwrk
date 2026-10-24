// Settings clean-up Phase 1 (docs/plans/settings-cleanup.md C1, C2, C4, C7,
// C8): the source-level half of the shared frame. Read as text, like the
// other contract tests, because the shell and the pages need the whole app
// around them to render.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
const shell = read("src/components/layout/os/settings-shell.tsx");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(root, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(root, rel)).isDirectory()) out.push(...walk(rel));
    else if (/\.tsx$/.test(name)) out.push(rel);
  }
  return out;
}
const pages = [...walk("src/app/(dashboard)/settings"), ...walk("src/app/(dashboard)/account")];

describe("C1: the page content is on the px grid", () => {
  it("<main> no longer resets the spacing and radius scale to rem", () => {
    const main = shell.slice(shell.indexOf("<main id={MAIN_ID}"), shell.indexOf("</main>"));
    expect(main.length).toBeGreaterThan(0);
    expect(main).not.toContain("[--spacing:");
    expect(main).not.toContain("[--radius-");
    // The shell root still carries .os-chrome, which is what reaches in.
    expect(shell).toContain('<div className="os-chrome flex min-h-0 min-w-0 flex-1 flex-col bg-app text-ink">');
  });
});

describe("C8: Back to app never wraps", () => {
  const btn = shell.slice(shell.indexOf("onClick={() => { void closeSettings(); }}"), shell.indexOf("</button>", shell.indexOf("onClick={() => { void closeSettings(); }}")));
  it("is one line, and the arrow alone below 480px with its tooltip and aria-label", () => {
    expect(btn).toContain("whitespace-nowrap");
    expect(btn).toContain("shrink-0");
    expect(btn).toContain("title={`${SHELL_LABELS.backToApp} (Esc)`}");
    expect(btn).toContain("aria-label={SHELL_LABELS.backToApp}");
    expect(btn).toContain('<span className="max-[480px]:sr-only">{SHELL_LABELS.backToApp}</span>');
  });
});

describe("C2: the subtitle comes from the registry", () => {
  it("only the two live subtitles are passed by hand (the Overview's org line, Security's email)", () => {
    const withSubtitle = pages.filter((p) => /<SettingsPage\b[^>]*\bsubtitle=/.test(read(p).replace(/\n\s*/g, " ")));
    expect(withSubtitle.sort()).toEqual([
      "src/app/(dashboard)/account/security/page.tsx",
      "src/app/(dashboard)/settings/overview-client.tsx",
    ]);
  });

  it("the Overview tile reads the same summary, with no second table of lines", () => {
    const overview = read("src/app/(dashboard)/settings/overview-client.tsx");
    expect(overview).not.toContain("PAGE_LINES");
    expect(overview).toContain("{page.summary}");
  });

  it("the frame draws one stack: no split tabs row outside the header", () => {
    const frame = read("src/components/settings/settings-page.tsx");
    expect(frame).not.toContain("splitViews");
    expect(frame).not.toContain("splitToolbar");
    expect(frame).toContain("subtitle={subtitle ?? page?.summary}");
  });
});

describe("C4: one section label", () => {
  const files = [
    "src/app/(dashboard)/settings/apps/page.tsx",
    "src/app/(dashboard)/settings/apps/mcp-section.tsx",
    "src/app/(dashboard)/settings/apps/teammate-browser-section.tsx",
    "src/app/(dashboard)/settings/apps/teammate-google-section.tsx",
    "src/app/(dashboard)/settings/data/page.tsx",
    "src/app/(dashboard)/settings/overview-client.tsx",
  ];
  it("the copies are gone and each draws SettingsSection", () => {
    for (const f of files) {
      const c = read(f);
      expect(c, f).not.toContain("const SECTION_LABEL");
      expect(c, f).not.toMatch(/<h2 className="[^"]*uppercase tracking-\[0\.06em\]/);
      expect(c, f).not.toContain("function Section(");
      expect(c, f).toContain('import { SettingsSection } from "@/components/settings/settings-section";');
    }
  });

  it("the hash anchors stay on their sections", () => {
    const apps = read("src/app/(dashboard)/settings/apps/page.tsx");
    expect(apps).toContain('<SettingsSection id="modules" label="Modules">');
    expect(apps).toMatch(/<SettingsSection\s+id="requests"/);
  });
});

describe("C7: every settings select is the Picker, but where a parent clips it", () => {
  it("only the Members filter panel and its two bulk dialogs keep the native select", () => {
    const natives: string[] = [];
    for (const p of [...pages, ...walk("src/components/settings")]) {
      const c = read(p);
      for (const m of c.matchAll(/<NativeSelect\b/g)) {
        const tag = c.slice(m.index, c.indexOf("/>", m.index));
        if (!/\snative(\s|$)/.test(tag)) continue;
        natives.push(`${p.split("/").slice(-2).join("/")}:${/ariaLabel="([^"]+)"/.exec(tag)?.[1]}`);
      }
    }
    expect(natives.sort()).toEqual([
      "members/page.tsx:Department",
      "members/page.tsx:Department",
      "members/page.tsx:Job title",
      "members/page.tsx:New role",
      "members/page.tsx:Office",
      "members/page.tsx:Status",
      "members/page.tsx:Tier",
    ]);
  });
});

describe("the Ask-an-admin strip (F, Employee view)", () => {
  it("is as wide as the page column it sits over, 16px above the title", () => {
    const strip = read("src/components/access/denial-views.tsx");
    const cls = /export function AskAnAdminStrip[\s\S]*?className="([^"]+)"/.exec(strip)?.[1] ?? "";
    expect(cls).toContain("max-w-[760px]");
    expect(cls).toContain("mb-4");
    expect(cls).toContain("mx-6");
  });
});
