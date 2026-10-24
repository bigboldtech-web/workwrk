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

/**
 * The opening tag of a JSX element that starts at `from` (its "<"), up to
 * the ">" that really ends it: a ">" inside a {...} expression (an arrow
 * function's "=>", a comparison, nested JSX) or inside a string does not.
 * Settings-cleanup fix L7: `[^>]*` stopped at the first "=>".
 */
function jsxOpenTag(src: string, from: number): string {
  let depth = 0;
  let quote: string | null = null;
  const tpl: number[] = []; // brace depth at each open template literal
  let start = from + 1;
  while (start < src.length && /[\w.$]/.test(src[start])) start++;
  // A type argument (<NativeSelect<MemberRole> ...>) is not the tag's end.
  if (src[start] === "<") {
    for (let angle = 0; start < src.length; start++) {
      if (src[start] === "<") angle++;
      else if (src[start] === ">" && --angle === 0) { start++; break; }
    }
  }
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === "\\") { i++; continue; }
      if (quote === "`" && ch === "$" && src[i + 1] === "{") { tpl.push(depth); depth++; quote = null; i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (depth > 0 && ch === "/" && src[i + 1] === "/") { i = src.indexOf("\n", i); if (i < 0) break; continue; }
    if (depth > 0 && ch === "/" && src[i + 1] === "*") { i = src.indexOf("*/", i + 2) + 1; if (i <= 0) break; continue; }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
    if (ch === "{") { depth++; continue; }
    if (ch === "}") {
      depth--;
      if (tpl.length && tpl[tpl.length - 1] === depth) { tpl.pop(); quote = "`"; }
      continue;
    }
    if (ch === ">" && depth === 0) return src.slice(from, i + 1);
  }
  return src.slice(from);
}

/** Every opening tag of `<name ...>` in `src`, each sliced by jsxOpenTag. */
const openTags = (src: string, name: string) => [...src.matchAll(new RegExp(`<${name}\\b`, "g"))].map((m) => jsxOpenTag(src, m.index ?? 0));

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
  it("reads each <SettingsPage> tag to its real end, past an arrow function, a string and a comment (fix L7)", () => {
    const src = `x <SettingsPage pageKey="a" onTab={(t) => t > 1 ? go(">") : null} note='it>s' extra={/* a > b, it's */ 1} subtitle={\`\${n > 0 ? "x" : "y"}\`}>\n<p>body subtitle=</p></SettingsPage>`;
    const [tag] = openTags(src, "SettingsPage");
    expect(tag.endsWith("}>")).toBe(true);
    expect(tag).toContain("subtitle={");
    expect(tag).not.toContain("<p>");
    // The old pattern stopped at the "=>" and never saw the subtitle.
    expect(/<SettingsPage\b[^>]*\bsubtitle=/.test(src.slice(0, src.indexOf("\n")))).toBe(false);
    expect(openTags('<SettingsPage pageKey="b">\n<i subtitle="no" />', "SettingsPage")[0]).toBe('<SettingsPage pageKey="b">');
    expect(openTags('<NativeSelect<Role> ariaLabel="Role" onChange={(r) => go(r)} />', "NativeSelect")[0]).toBe('<NativeSelect<Role> ariaLabel="Role" onChange={(r) => go(r)} />');
  });

  it("only the two live subtitles are passed by hand (the Overview's org line, Security's email)", () => {
    const withSubtitle = pages.filter((p) => openTags(read(p), "SettingsPage").some((tag) => /\ssubtitle=/.test(tag)));
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

describe("Phase 1 review fixes (settings-p1-review.md)", () => {
  it("L2: the five-minute window moved into the sign-in policy's save toast, and it matches the session check", () => {
    const security = read("src/app/(dashboard)/settings/security/page.tsx");
    expect(security).toContain('toast("Sign-in policy saved", { description: "It applies to everyone at their next check, within five minutes." });');
    expect(read("src/lib/auth.ts")).toContain("const REVALIDATE_MS = 5 * 60 * 1000;");
  });

  it("L2: Locale's Region sentence names the week start, which each person really can set", () => {
    expect(read("src/app/(dashboard)/settings/locale/page.tsx")).toContain("People can pick their own language, formats and week start in");
    expect(read("src/app/(dashboard)/account/preferences/page.tsx")).toContain('id="preferences.region.weekStart"');
  });

  it("L3: the left-hand field pickers prefer the start edge", () => {
    const locale = read("src/app/(dashboard)/settings/locale/page.tsx");
    const tags = openTags(locale, "PickerSelect");
    expect(tags).toHaveLength(3);
    for (const t of tags) expect(t, t).toContain('align="start"');
    const offices = openTags(read("src/components/settings/offices-manager.tsx"), "PickerSelect");
    expect(offices).toHaveLength(1);
    expect(offices[0]).toContain('align="start"');
  });

  it("L4: the Rail apps column headers give way below 640px, the group label stays", () => {
    const apps = read("src/app/(dashboard)/settings/apps/page.tsx");
    expect(apps).toContain('<span className="min-w-0 flex-1">Rail hubs</span>');
    expect(apps).toContain('<span className="w-[190px] shrink-0 max-[640px]:hidden">Who can see it</span>');
    expect(apps).toContain('<span className="w-[108px] shrink-0 whitespace-nowrap text-end max-[640px]:hidden">Show in rail</span>');
  });

  it("L5: Profile's Delete my account is a SettingsRow, with its button and confirm unchanged", () => {
    const profile = read("src/app/(dashboard)/account/profile/page.tsx");
    const card = profile.slice(profile.indexOf('<SettingsCard title="Danger zone" danger id="profile.delete">'), profile.indexOf("</SettingsCard>", profile.indexOf('id="profile.delete"')));
    expect(card).toContain('label="Delete my account"');
    expect(card).toContain("<SettingsRow");
    expect(card).toContain('control={<button type="button" className={btn.dangerGhost} onClick={() => setDeleteOpen(true)}>Delete my account</button>}');
    expect(card).not.toContain('<div className="flex flex-wrap items-center gap-4">');
    expect(profile).toContain("<DeleteAccountDialog\n        open={deleteOpen}\n        onOpenChange={setDeleteOpen}");
  });

  it("M1: every settings select names itself with a label", () => {
    const missing: string[] = [];
    for (const p of [...pages, ...walk("src/components/settings")]) {
      const c = read(p);
      for (const tag of [...openTags(c, "NativeSelect"), ...openTags(c, "PickerSelect")]) {
        if (/\snative(\s|$)/.test(tag)) continue;
        if (!/\s(ariaLabel|label)=/.test(tag)) missing.push(`${p}: ${tag.slice(0, 60)}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("M2: a settings dialog hands focus back to what had it when it opened (Radix focuses only a Dialog.Trigger)", () => {
    const ui = read("src/components/account/account-ui.tsx");
    const dialog = ui.slice(ui.indexOf("export function AccountDialog"));
    expect(dialog).toMatch(/useLayoutEffect\(\(\) => \{\s+if \(!open \|\| typeof document === "undefined"\) return;\s+const a = document\.activeElement;/);
    expect(dialog).toContain("onCloseAutoFocus={(e) => {");
    expect(dialog).toMatch(/if \(back && back\.isConnected\) \{\s+e\.preventDefault\(\);\s+back\.focus\(\{ preventScroll: true \}\);/);
    // ConfirmDialog is drawn on it, so the Rail apps confirm gets this too.
    expect(read("src/components/settings/settings-form.tsx")).toMatch(/export function ConfirmDialog[\s\S]*?<AccountDialog/);
  });

  it("M2: Esc with a picker open in a settings dialog closes the picker alone, never the dialog and its draft", () => {
    const ui = read("src/components/account/account-ui.tsx");
    expect(ui).toContain('import { useLayerStack } from "@/components/layout/os/shell-context";');
    expect(ui).toMatch(/onEscapeKeyDown=\{\(e\) => \{[\s\S]*?if \(layers\?\.topLayerKind === "popover"\) \{\s+e\.preventDefault\(\);\s+layers\.closeTopLayer\(\);\s+return;/);
    // The Picker is that popover layer.
    expect(read("src/components/ui/picker.tsx")).toContain('useLayer(open, { id: `picker-${instanceId}`, kind: "popover", close: onClose });');
  });

  it("M2: the trigger keeps its ref and gets focus back on a choice and on every close", () => {
    const ps = read("src/components/settings/picker-select.tsx");
    expect(ps).toContain("ref={triggerRef}");
    expect(ps).toContain('onClose={() => close("dismiss")}');
    expect(ps).toMatch(/onSelect=\{\(v\) => \{\s+close\("select"\);/);
    expect(ps).toContain("trigger.focus({ preventScroll: true })");
  });
});
