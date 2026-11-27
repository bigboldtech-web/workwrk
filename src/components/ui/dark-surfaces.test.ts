import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Founder reports 2026-11-28, both in dark mode:
//   1. "when I hover the cancel button disappears" (Create workspace): the
//      outline Button's light hover (slate-900 text, slate-300 edge) won in
//      dark, near-black text on the dark dialog. Measured in a real browser:
//      text rgb(250,250,250) at rest, lab(7.8 ...) on hover.
//   2. "This gray background is not looking good on the black dark screen"
//      (Board): the columns were zinc-100 at 60%, a grey slab on the page,
//      and a card's select box was an inline white square.

const button = readFileSync("src/components/ui/button.tsx", "utf8");
const os = readFileSync("src/app/(dashboard)/os.css", "utf8");
const kanban = readFileSync("src/components/board-view/board-kanban-view.tsx", "utf8");

describe("the outline Button in dark mode", () => {
  // The string after `outline:` (past its comment lines).
  const outline = button.match(/\n\s+outline:[^"]*"([^"]+)"/)?.[1] ?? "";

  it("keeps its text and edge on hover", () => {
    expect(outline).toContain("dark:hover:text-foreground");
    expect(outline).toContain("dark:hover:border-white/15");
  });

  it("guard: light mode is untouched", () => {
    expect(outline.startsWith("border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300 hover:text-slate-900 ")).toBe(true);
  });

  it("says which variant it is, so the dashboard can give it a hover fill", () => {
    expect(button).toMatch(/data-variant=\{variant \?\? "default"\}/);
  });

  it("the hover fill beats the !important bg-white repaints, and comes after them", () => {
    const rule = ':root.dark :is(button, a)[data-variant="outline"]:hover:not(:disabled) { background: var(--os-line-strong) !important; }';
    const at = os.indexOf(rule);
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeGreaterThan(os.indexOf(':root.dark [role="dialog"] .bg-white {'));
    expect(at).toBeGreaterThan(os.indexOf(":root.dark .workwrk-os button.bg-white {"));
  });
});

describe("the Board in dark mode", () => {
  it("a column is the faint subtle surface, never the light grey", () => {
    expect(kanban).toMatch(/rounded-xl bg-zinc-100\/60 dark:bg-subtle p-2/);
  });

  it("a card's select box takes its colours from classes, so dark can change them", () => {
    expect(kanban).not.toMatch(/"#fff"/);
    expect(kanban).toMatch(/border-\[#d4d4d8\] bg-raised dark:border-control-edge/);
  });
});
