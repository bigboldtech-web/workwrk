// Settings clean-up Phase 1 (docs/plans/settings-cleanup.md, C2 to C7): the
// shared frame every settings page is drawn with. Rendered to static markup,
// so what is asserted is what the browser receives.

import { describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  usePathname: () => "/account/notifications",
  useRouter: () => ({ replace: () => {}, push: () => {}, back: () => {} }),
  useSearchParams: () => new URLSearchParams(""),
}));

import { SettingsCard } from "./settings-card";
import { SettingsRow } from "./settings-row";
import { SettingsMore, SETTINGS_LESS_LABEL, SETTINGS_MORE_LABEL } from "./settings-more";
import { SettingsSection } from "./settings-section";
import { Field, NativeSelect } from "./settings-form";
import { SettingsHead, SettingsPage } from "./settings-page";
import { SETTINGS_PAGES } from "@/lib/settings-registry";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe("SettingsCard fills its column (C3)", () => {
  it("has no 560 cap, and `wide` changes nothing", () => {
    const plain = html(h(SettingsCard, { title: "A" }, "x"));
    const wide = html(h(SettingsCard, { title: "A", wide: "apps.rail" }, "x"));
    expect(plain).not.toContain("max-w-[560px]");
    expect(plain).toMatch(/class="w-full /);
    expect(wide).toBe(plain);
    expect(wide).not.toContain("data-wide");
  });

  it("pads 24, and 16 below 640px", () => {
    const c = html(h(SettingsCard, { title: "A" }, "x"));
    expect(c).toContain(" p-6 ");
    expect(c).toContain("max-[640px]:p-4");
  });

  it("draws the danger zone with the pale danger border, never the solid red", () => {
    const c = html(h(SettingsCard, { title: "Danger zone", danger: true }, "x"));
    expect(c).toContain("border-[var(--os-danger-border)]");
    expect(c).not.toContain("--os-danger-solid");
    expect(c).toContain("text-danger-text");
  });

  it("puts its ghost actions under the title below 640px, so a phone never squeezes the description", () => {
    const c = html(h(SettingsCard, { title: "A", description: "Words.", actions: h("button", { type: "button" }, "Reset") }, "x"));
    expect(c).toContain('<header class="mb-4 flex items-start gap-3 max-[640px]:flex-col max-[640px]:gap-2">');
  });

  it("puts longer help behind Show more, under the description", () => {
    const c = html(h(SettingsCard, { title: "A", description: "One line.", more: "The long paragraph." }, "x"));
    expect(c.indexOf("One line.")).toBeLessThan(c.indexOf(SETTINGS_MORE_LABEL));
    expect(c).toContain('aria-expanded="false"');
    expect(c).toMatch(/<div id="[^"]+" hidden="" [^>]*>The long paragraph\.<\/div>/);
  });
});

describe("SettingsRow (C5, C6)", () => {
  it("stacks below 640px: label and helper on top, the control under them", () => {
    const r = html(h(SettingsRow, { label: "Label", helper: "Hint", control: h("button", { type: "button" }, "Go") }));
    expect(r).toContain("min-h-12");
    expect(r).toContain("max-[640px]:flex-col");
    expect(r).toContain("max-[640px]:items-start");
    expect(r.indexOf("Label")).toBeLessThan(r.indexOf("Go"));
  });

  it("takes `more` under the helper, collapsed", () => {
    const r = html(h(SettingsRow, { label: "Label", helper: "Hint", more: "Longer help." }));
    expect(r.indexOf("Hint")).toBeLessThan(r.indexOf(SETTINGS_MORE_LABEL));
    expect(r).toContain('aria-expanded="false"');
  });

  // Settings clean-up Phase 2 review, L5: the opened text sat in the label's column, so the switch centred on the
  // paragraph. It now opens full width under the label and control line, and the control stays on its label's line.
  it("opens `more` full width under the label and control line, its link still under the helper", () => {
    const r = html(h(SettingsRow, { label: "Label", helper: "Hint", more: "Longer help.", control: h("button", { type: "button" }, "Go") }));
    const body = /<div id="([^"]+)" hidden="" class="([^"]+)">Longer help\.<\/div>/.exec(r);
    expect(body).not.toBeNull();
    expect(r).toContain(`aria-controls="${body?.[1]}"`);
    expect(r.indexOf("Hint")).toBeLessThan(r.indexOf(SETTINGS_MORE_LABEL));
    expect(r.indexOf(SETTINGS_MORE_LABEL)).toBeLessThan(r.indexOf(">Go</button>"));
    // After the control, as the row's last child: under the line, never beside the control.
    expect(r.indexOf(">Go</button>")).toBeLessThan(r.indexOf("Longer help."));
    expect(r.endsWith("Longer help.</div></div>")).toBe(true);
    // The line is a flex row of its own inside the row, so the control centres on the label, the helper and the link.
    // (Phase 3: the row carries data-settings-row, the hook the live proofs find a row by.)
    expect(r).toMatch(/^<div data-settings-row="" class="flex min-h-12 flex-col justify-center [^"]*"><div class="flex items-center gap-4 [^"]*max-\[640px\]:flex-col max-\[640px\]:items-start/);
  });
});

describe("SettingsMore (C5)", () => {
  it("is a 13/500 brand-deep text link, collapsed by default, naming the text it opens", () => {
    const m = html(h(SettingsMore, { children: "Help text." }));
    expect(m).toContain('class="text-sm font-medium text-brand-deep hover:underline"');
    const id = /aria-controls="([^"]+)"/.exec(m)?.[1];
    expect(id).toBeTruthy();
    expect(m).toContain(`id="${id}" hidden=""`);
    expect(m).toContain(`>${SETTINGS_MORE_LABEL}</button>`);
  });

  it("opens in place in 13/400 ink-2, and the link then reads Show less", () => {
    const m = html(h(SettingsMore, { defaultOpen: true, children: "Help text." }));
    expect(m).toContain('aria-expanded="true"');
    expect(m).not.toContain('hidden=""');
    expect(m).toContain("text-sm text-ink-2");
    expect(m).toContain(`>${SETTINGS_LESS_LABEL}</button>`);
  });
});

describe("SettingsSection (C4)", () => {
  it("is the 11/600 uppercase label with its rule, 8px above its first card, keeping its anchor", () => {
    const s = html(h(SettingsSection, { id: "modules", label: "Modules" }, h("div", null, "card")));
    expect(s).toMatch(/^<section id="modules" class="scroll-mt-4">/);
    expect(s).toContain('<h2 class="flex items-center gap-3 text-micro font-semibold uppercase tracking-[0.06em] text-ink-2 mb-2">Modules<span class="h-px flex-1 bg-line" aria-hidden="true"></span></h2>');
  });

  it("takes one description line under the label", () => {
    const s = html(h(SettingsSection, { label: "Requests", description: "What people asked for." }));
    expect(s).toContain("mb-1");
    expect(s).toContain('<p class="mb-2 text-sm text-ink-2">What people asked for.</p>');
  });
});

describe("NativeSelect draws the Picker (C7)", () => {
  const opts = [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }] as const;

  it("renders the Picker trigger, never a native select, named by its label and its value (fix M1)", () => {
    const s = html(h(NativeSelect<"a" | "b">, { value: "b", options: opts, onChange: () => {}, ariaLabel: "Letter" }));
    expect(s).not.toContain("<select");
    expect(s).toContain('aria-haspopup="listbox"');
    expect(s).toContain(">Beta</span>");
    // aria-labelledby = the label, then the value, so both are the name.
    const ids = /<button[^>]*aria-labelledby="([^"]+)"/.exec(s)?.[1].split(" ") ?? [];
    expect(ids).toHaveLength(2);
    expect(s).toContain(`<span id="${ids[0]}" hidden="">Letter</span>`);
    expect(s).toMatch(new RegExp(`<span id="${ids[1]}"[^>]*>Beta</span>`));
    // The label alone never replaces the value as the name.
    expect(s).not.toContain('aria-label="Letter"');
  });

  it("keeps the id for a Field's <label htmlFor>, names itself from that label and its value, and a stray value reads as the first option", () => {
    const s = html(
      h(Field, { label: "Pick one", htmlFor: "f-1", children: h(NativeSelect<string>, { id: "f-1", value: "zzz", options: opts as unknown as { value: string; label: string }[], onChange: () => {} }) }),
    );
    expect(s).toContain('<label id="f-1-label" for="f-1"');
    expect(s).toMatch(/<button[^>]*id="f-1"/);
    expect(s).toMatch(/<button[^>]*aria-labelledby="f-1-label f-1-value"/);
    expect(s).toContain('<span id="f-1-value" class="min-w-0 truncate">Alpha</span>');
    expect(s).not.toContain("aria-label=");
    expect(s).not.toContain("zzz");
  });

  it("sizes the control from className", () => {
    const s = html(h(NativeSelect<"a" | "b">, { value: "a", options: opts, onChange: () => {}, ariaLabel: "L", className: "w-[190px]" }));
    expect(s).toMatch(/<span class="relative inline-block max-w-full align-middle w-\[190px\]">/);
  });

  it("keeps the browser's select only where asked (a clipping parent)", () => {
    const s = html(h(NativeSelect<"a" | "b">, { value: "a", options: opts, onChange: () => {}, ariaLabel: "L", native: true }));
    expect(s).toContain("<select");
    expect(s).not.toContain('aria-haspopup="listbox"');
  });
});

describe("SettingsPage: one header stack (C2)", () => {
  it("is title, subtitle, tabs, then toolbar, all inside the one header", () => {
    const s = html(
      h(SettingsHead, {
        title: "T",
        subtitle: "Sub.",
        tabs: h("button", { type: "button" }, "TabOne"),
        toolbar: { primary: { label: "New thing", onClick: () => {} } },
      }),
    );
    const head = s.slice(0, s.indexOf("</header>"));
    const at = (t: string) => head.indexOf(t);
    expect(at(">T</h1>")).toBeGreaterThan(0);
    expect(at("Sub.")).toBeGreaterThan(at(">T</h1>"));
    expect(at("TabOne")).toBeGreaterThan(at("Sub."));
    expect(at("New thing")).toBeGreaterThan(at("TabOne"));
    // The tabs row is the 36px views row, never a 31.5px copy outside the header.
    expect(head).toMatch(/class="os-row flex h-9 [^"]*"/);
  });

  it("reads its subtitle from the registry summary, and puts cross-tab content under the tabs", () => {
    const s = html(
      h(SettingsPage, {
        pageKey: "account/notifications",
        tabs: [{ key: "inbox", label: "Inbox" }, { key: "email", label: "Email" }],
        lead: h("section", { id: "quiet" }, "QuietCard"),
        children: (tab: string | null) => h("p", null, `Body ${tab}`),
      }),
    );
    const headEnd = s.indexOf("</header>");
    expect(s.indexOf(SETTINGS_PAGES["account/notifications"].summary)).toBeGreaterThan(0);
    expect(s.indexOf(SETTINGS_PAGES["account/notifications"].summary)).toBeLessThan(headEnd);
    expect(s.indexOf(">Inbox<")).toBeLessThan(headEnd);
    expect(s.indexOf("QuietCard")).toBeGreaterThan(headEnd);
    expect(s.indexOf("QuietCard")).toBeLessThan(s.indexOf("Body inbox"));
  });

  it("lets a live subtitle override the summary", () => {
    const s = html(h(SettingsPage, { pageKey: "account/security", subtitle: "me@example.test", children: "x" }));
    expect(s).toContain("me@example.test");
    expect(s).not.toContain(SETTINGS_PAGES["account/security"].summary);
  });

  it("draws the toolbar with Filter and Sort when a page passes them", () => {
    const s = html(h(SettingsPage, {
      pageKey: "audit",
      width: "list",
      filter: { open: false, onToggle: () => {} },
      sort: { onClick: () => {}, label: "Newest first" },
      children: "x",
    }));
    const head = s.slice(0, s.indexOf("</header>"));
    expect(head).toContain("Filter");
    expect(head).toContain("Newest first");
  });
});
