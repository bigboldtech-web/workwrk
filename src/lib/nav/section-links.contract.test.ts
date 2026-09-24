// A contract over the SOURCE of the link sites that open objects, so the
// founder's rule (whatever you open something from, you stay in that
// section) cannot quietly regress one call site at a time. Each check names
// the file and the exact shape it must keep. The behaviour behind every
// helper they call is unit-tested in object-href.test.ts.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
/** Source with comments dropped, so a comment can mention an old URL or API. */
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");

// A router.push, router.replace or window.open of a literal canonical object
// URL: the id interpolation followed by the end of the literal, a query or a
// hash. A deeper public path (/forms/<id>/respond) is not an object URL.
const RAW_OBJECT_NAV = /(router\.(push|replace)|window\.open)\(\s*`\/(docs|tables|canvas|sops|forms)\/\$\{[^}]+\}[`?#]/;

describe("the Work tree", () => {
  const tree = code("src/components/layout/os/space-tree-row.tsx");

  it("links Docs, Tables and Canvases to their Space-scoped Work address", () => {
    expect(tree).toMatch(/href=\{objectHref\("doc", doc\.id, "home", spaceSlug\)\}/);
    expect(tree).toMatch(/href=\{objectHref\("table", table\.id, "home", spaceSlug\)\}/);
    expect(tree).toMatch(/href=\{objectHref\("canvas", whiteboard\.id, "home", spaceSlug\)\}/);
    expect(tree).not.toMatch(RAW_OBJECT_NAV);
  });

  it("lights leaf rows by the pill, never by a pathname comparison", () => {
    expect(tree).not.toMatch(/pathname === `\/(docs|tables|canvas)\//);
    for (const k of ["space", "folder", "list", "doc", "table", "canvas"]) {
      expect(tree).toMatch(new RegExp(`useTreePill<HTMLDivElement>\\(treeKey\\("${k}"`));
    }
  });
});

describe("the Work sidebar's favourites", () => {
  const catalog = code("src/components/layout/os/apps-catalog.tsx");

  it("open docs, tables, canvases and forms in Work, lit by the favourite pill", () => {
    expect(catalog).toMatch(/objectHref\(kind, id, "home"\)/);
    expect(catalog).toMatch(/useFavoritePill<HTMLLIElement>\(kind, id\)/);
    expect(catalog).not.toMatch(/href=\{`\/(docs|tables|canvas|forms)\/\$\{/);
    expect(catalog).not.toMatch(/pathname === `\/(docs|tables|canvas|forms)\//);
    for (const kind of ["doc", "table", "form", "canvas"]) {
      expect(catalog).toMatch(new RegExp(`<FavObjectRow[\\s\\S]{0,80}kind="${kind}"`));
    }
  });

  it("reveals an open object's branch from its published placement", () => {
    expect(catalog).toMatch(/useOpenRevealKey\(\)/);
    expect(catalog).toMatch(/setAllExpanded\(ids, true\)/);
  });
});

describe("notifications (problems 1 and 21)", () => {
  it("map the bell's rows and its toast when they are clicked", () => {
    const bell = code("src/components/layout/os/bell-popover.tsx");
    expect(bell).toMatch(/router\.push\(sectionHrefNow\(href\)\)/);
    expect(bell).toMatch(/onClick: \(\) => router\.push\(sectionHrefNow\(link\)\)/);
  });

  it("map a desktop notification when it is clicked", () => {
    const desktop = code("src/hooks/use-desktop-notifications.ts");
    expect(desktop).toMatch(/window\.location\.assign\(sectionHrefNow\(payload\.url\)\)/);
  });
});

describe("call sites that build or follow object links", () => {
  // Every file here opened a canonical object URL directly before; none may again.
  const files = [
    "src/components/docs/doc-row-menu.tsx",
    "src/components/tables/table-row-menu.tsx",
    "src/components/canvas/canvas-row-menu.tsx",
    "src/components/forms/form-row-menu.tsx",
    "src/components/layout/os/space-create-popover.tsx",
    "src/components/layout/os/container-menu.tsx",
    "src/components/layout/os/space-quick-start.tsx",
    "src/components/layout/os/command-palette.tsx",
    "src/components/layout/os/create-menu.tsx",
    "src/components/layout/os/use-personal-tools.ts",
    "src/components/layout/os/shell-shortcuts.tsx",
    "src/components/layout/os/voice-capture-popover.tsx",
    "src/components/docs/doc-split-view.tsx",
    "src/components/docs/blocknote-blocks/subpage-block.tsx",
    "src/components/docs/blocknote-canvas.tsx",
    "src/components/tables/csv-import-dialog.tsx",
  ];

  it("never push, replace or open a literal canonical object URL", () => {
    for (const f of files) expect(code(f), f).not.toMatch(RAW_OBJECT_NAV);
  });

  it("copy the share form, never window.location.href or a hand-built canonical URL", () => {
    for (const f of [
      "src/components/docs/doc-row-menu.tsx",
      "src/components/tables/table-row-menu.tsx",
      "src/components/canvas/canvas-row-menu.tsx",
      "src/components/docs/doc-share-modal.tsx",
      "src/components/canvas/canvas-editor.tsx",
      "src/components/sops/sop-editor-page.tsx",
    ]) {
      const src = code(f);
      expect(src, f).toMatch(/copyObjectLink\(/);
      expect(src, f).not.toMatch(/writeText\(`\$\{window\.location\.origin\}\/(docs|tables|canvas|sops)\//);
      expect(src, f).not.toMatch(/writeText\(window\.location\.href\)/);
    }
  });

  it("personal tools make a canvas instead of linking the Docs hub", () => {
    const tools = code("src/components/layout/os/personal-tools.ts");
    expect(tools).toMatch(/key: "create-whiteboard", label: "Create canvas", Icon: Frame, href: null, action: "canvas"/);
  });
});

describe("the editors (problem 30)", () => {
  it("take their id from their own segment, never useParams() or the pathname", () => {
    for (const f of [
      "src/components/tables/table-editor.tsx",
      "src/components/canvas/canvas-editor.tsx",
      "src/components/forms/form-builder.tsx",
      "src/app/(dashboard)/sops/[id]/page.tsx",
    ]) {
      const src = code(f);
      expect(src, f).not.toMatch(/useParams\s*[<(]/);
      expect(src, f).not.toMatch(/pathname\.split\(/);
    }
  });

  it("keep query-only navigations at the address they are mounted at", () => {
    const table = code("src/components/tables/table-editor.tsx");
    expect(table).not.toMatch(/router\.replace\(`\$\{window\.location\.pathname\}/);
    expect(table.match(/router\.replace\(`\$\{selfPath\}/g)?.length).toBe(2);
    const canvas = code("src/components/canvas/canvas-editor.tsx");
    expect(canvas).not.toMatch(/router\.replace\(`\/canvas\//);
    expect(canvas).toMatch(/router\.replace\(`\$\{selfPath\}/);
    const form = code("src/components/forms/form-builder.tsx");
    expect(form).not.toMatch(/\$\{pathname\}/);
    expect(form.match(/\$\{selfPath\}/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("declare no crumb of their own in Work", () => {
    for (const f of [
      "src/components/docs/block-doc-editor.tsx",
      "src/components/tables/table-editor.tsx",
      "src/components/canvas/canvas-editor.tsx",
      "src/components/forms/form-builder.tsx",
      "src/components/sops/sop-editor-page.tsx",
    ]) {
      const src = code(f);
      expect(src, f).toMatch(/useWorkTitle\(/);
      expect(src, f).toMatch(/!inWork \? <Breadcrumb|pane === "primary" && !inWork \? \(/);
    }
  });
});

describe("the shell", () => {
  it("mounts the one section link interceptor before the page frame", () => {
    const shell = read("src/components/layout/os/os-shell.tsx");
    const at = shell.indexOf("<SectionLinkInterceptor />");
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(shell.indexOf("<Frame>{children}</Frame>"));
    const interceptor = code("src/components/layout/os/section-link-interceptor.tsx");
    expect(interceptor).toMatch(/document\.addEventListener\("click", onClick, true\)/);
    expect(interceptor).toMatch(/e\.preventDefault\(\)/);
    expect(interceptor).not.toMatch(/stopPropagation/);
    expect(interceptor).toMatch(/confirmLeave\(\)/);
  });

  it("registers the Work door with the proxy and the hub table", () => {
    expect(read("src/proxy.ts")).toMatch(/"work",/);
    expect(read("src/lib/nav/route-hub.ts")).toMatch(/"\/work": "home",/);
  });
});
