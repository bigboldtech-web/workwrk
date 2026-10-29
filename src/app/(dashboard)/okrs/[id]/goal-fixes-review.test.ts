// Repeating goals, the review of the final fix runs (2026-10-29), as the
// screens draw them: M1 Delete target says why a target can't go yet before
// any confirm, in a dialog with one OK, and the server's 409 is said the
// same way; L4 the preview shows the 429's own words and a Save left for
// the cron says when its number comes. The routes and the rules are
// src/lib/goals/goal-fixes-review.test.ts. Where a click cannot be reached
// by a static render, the source is read as a contract.

import { describe, expect, it, vi } from "vitest";
import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, refresh: () => {}, push: () => {} }) }));
vi.mock("@/components/layout/os/toast", () => ({ useOsToast: () => ({ toast: () => {} }) }));
vi.mock("@/components/ui/dialog-provider", () => ({ useConfirm: () => async () => true }));
vi.mock("@/components/ui/dialog", () => {
  const pass = ({ children }: { children?: ReactNode }) => h("div", null, children);
  return { Dialog: pass, DialogContent: pass, DialogHeader: pass, DialogTitle: pass, DialogFooter: pass, DialogDescription: pass };
});
vi.mock("@/components/layout/os/more-portal", () => ({ MorePortal: ({ children }: { children?: ReactNode }) => h("div", { "data-menu": "" }, children) }));
vi.mock("@/lib/api-fetch", () => ({ apiFetch: async () => ({ ok: false, error: "not in a test" }) }));

import { deleteTargetDialog, refusedDeleteDialog } from "./goal-targets";
import { previewFromResponse, savedToastWords } from "./target-editor";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PREVIEW_FAILED } from "@/lib/goals/goal-source";
import { COUNTING_TOO_OFTEN } from "@/lib/goals/goal-count-limit";

const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const WAIT = "October still takes numbers until 5 Nov, so this target can't be deleted yet. Delete it after that.";

describe("fixes review M1: Delete target says why a target can't go yet, before any confirm", () => {
  it("a target October still holds opens the refusal, with one OK and nothing to delete; any other the confirm", () => {
    const refused = deleteTargetDialog({ title: "Demos booked", deleteRefusal: WAIT }, true);
    expect(refused).toEqual({ refused: true, opts: { title: "Can't delete Demos booked yet", description: WAIT, confirmLabel: "OK", cancelLabel: "", destructive: false } });
    expect(deleteTargetDialog({ title: "Demos booked", deleteRefusal: null }, true)).toEqual({
      refused: false,
      opts: { title: "Delete Demos booked?", description: "Its check-ins go with it. Its past results stay in Past periods. This can't be undone.", destructive: true, confirmLabel: "Delete target" },
    });
    expect(deleteTargetDialog({ title: "Demos booked" }, false).opts.description).toBe("Its check-ins go with it and the goal's progress re-rolls from the targets left. This can't be undone.");
    expect(refusedDeleteDialog("Demos booked", WAIT)).toEqual(refused.opts);
  });

  it("the refusal renders as a dialog with its words and a single OK, never a destructive button", () => {
    const o = refusedDeleteDialog("Demos booked", WAIT);
    const html = renderToStaticMarkup(h(ConfirmDialog, { open: true, onClose: () => {}, onConfirm: () => {}, ...o }));
    expect(html).toContain("Can&#x27;t delete Demos booked yet");
    expect(html).toContain("October still takes numbers until 5 Nov, so this target can&#x27;t be deleted yet. Delete it after that.");
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toMatch(/<button[^>]*>OK<\/button>/);
  });

  it("the page sends each row's refusal, and a 409 the server answers anyway opens the same dialog", () => {
    const page = src("./page.tsx");
    expect(page).toContain("targetDeleteRefusals(prisma, okr.id, keyResults.map((k) => k.id), periodSettings, now)");
    expect(page).toContain("deleteRefusal: t.keyResultId ? deleteRefusals.get(t.keyResultId) ?? null : null");
    const card = src("./goal-targets.tsx");
    expect(card).toContain("const ask = deleteTargetDialog(t, !!period);");
    expect(card).toContain("if (!ok || ask.refused) return;");
    expect(card).toContain('else if (res.status === 409 && typeof d?.error === "string") { await confirm(refusedDeleteDialog(t.title, d.error)); router.refresh(); }');
  });
});

describe("fixes review L4: the preview says the 429's words, and a Save is never refused", () => {
  it("a 429 shows the budget's own words; any other failure, that the preview couldn't be counted", () => {
    expect(previewFromResponse({ ok: false, status: 429 }, { error: COUNTING_TOO_OFTEN })).toEqual({ value: null, paused: "You're counting too often. Try again in a minute.", open: true, errorRows: 0 });
    expect(previewFromResponse({ ok: false, status: 500 }, { error: "boom" })).toEqual({ value: null, paused: PREVIEW_FAILED, open: true, errorRows: 0 });
    expect(previewFromResponse({ ok: false, status: 429 }, null)).toEqual({ value: null, paused: PREVIEW_FAILED, open: true, errorRows: 0 });
    expect(previewFromResponse({ ok: true, status: 200 }, { value: 42, paused: null, openToWorkspace: false, errorRows: 3 })).toEqual({ value: 42, paused: null, open: false, errorRows: 3 });
  });

  it("a source saved uncounted says when its number comes", () => {
    expect(savedToastWords(true, false)).toBe("Target saved");
    expect(savedToastWords(false, false)).toBe("Target added");
    expect(savedToastWords(true, true)).toBe("Target saved. Its number is counted within the hour.");
    expect(savedToastWords(false, true)).toBe("Target added. Its number is counted within the hour.");
    const editor = src("./target-editor.tsx");
    expect(editor).toContain("setPreview({ key: chosenKey, ...previewFromResponse(res, j) });");
    expect(editor).toContain("toast(savedToastWords(isEdit, d?.countsLater === true));");
  });
});
