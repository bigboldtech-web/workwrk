import { describe, expect, it } from "vitest";
import { detailRows, importWords, plainValue } from "./staff-activity";

// See details on a "Code marked refunded" row, and the import sentence the
// toast and the Staff activity row share (walk finding: group 1, batch 3).

const OLD_BEFORE = { plan: "GROWTH", seats: 5, redeemedAt: "2026-09-29T10:39:04.804Z", refundedAt: null };
const OLD_AFTER = { companyId: "cmumv53bc003pf5xpyx307jzm", refundedAt: "2026-09-29T10:39:04.854Z", companyName: "Scawalk Throwaway" };

describe("a refund row's details", () => {
  it("an old, lopsided row shows the refund as the only change and the code's facts as context", () => {
    const rows = detailRows(OLD_BEFORE, OLD_AFTER, { action: "admin.code.refunded" });
    expect(rows.filter((r) => r.changed).map((r) => [r.label, r.before, r.after])).toEqual([["Refunded", "None", "2026-09-29"]]);
    const context = Object.fromEntries(rows.filter((r) => !r.changed).map((r) => [r.label, r.after]));
    expect(context).toEqual({
      "Code plan": "Growth",
      "Code seats": "5",
      Redeemed: "2026-09-29",
      "Company ID": "cmumv53bc003pf5xpyx307jzm",
      Company: "Scawalk Throwaway",
    });
    // Never the company's own plan word, and never "to None".
    expect(rows.some((r) => r.label === "Plan" || r.label === "Seats")).toBe(false);
    expect(rows.some((r) => r.changed && r.after === "None")).toBe(false);
  });

  it("a new, symmetric row reads the same", () => {
    const facts = { redeemedAt: "2026-09-29T10:39:04.804Z", codeTier: 2, codePlan: "GROWTH", codeSeats: 5, companyId: "c1", companyName: "Co" };
    const rows = detailRows({ refundedAt: null, ...facts }, { refundedAt: "2026-09-29T10:39:04.854Z", ...facts }, { action: "admin.code.refunded" });
    expect(rows.filter((r) => r.changed).map((r) => r.key)).toEqual(["refundedAt"]);
    expect(rows.find((r) => r.key === "codeTier")?.label).toBe("Code tier");
  });

  it("other actions keep the plain rule: a key on one side only is a change from None", () => {
    expect(detailRows({ plan: "GROWTH" }, { plan: "SCALE", signedOut: 3 }, { action: "admin.org.plan_changed" }).map((r) => [r.key, r.before, r.after])).toEqual([
      ["plan", "Growth", "Scale"],
      ["signedOut", "None", "3"],
    ]);
  });

  it("dates use the formatter the page passes (the viewer's format), nested values too", () => {
    const fmt = (iso: string) => `D(${iso.slice(11, 16)})`;
    const rows = detailRows(OLD_BEFORE, OLD_AFTER, { action: "admin.code.refunded", date: fmt });
    expect(rows.find((r) => r.key === "refundedAt")?.after).toBe("D(10:39)");
    expect(plainValue("x", { at: "2026-09-29T08:00:00.000Z" }, fmt)).toBe("At: D(08:00)");
    expect(plainValue("x", "2026-09-29T08:00:00.000Z")).toBe("2026-09-29");
  });
});

describe("importWords", () => {
  it("A, B, C, A again and X3 (already imported): one already here, one repeated, five in all", () => {
    const w = importWords(3, 4, 1);
    expect(w.toast).toBe("Imported 3 of 5 codes. 1 was already here. 1 was repeated in the paste.");
    expect(w.summary).toBe("Imported 3 of 5 AppSumo codes (1 already existed, 1 repeated in the paste)");
    expect([w.total, w.already, w.repeated]).toEqual([5, 1, 1]);
  });
  it("a clean paste says only the count, and plurals follow the numbers", () => {
    expect(importWords(3, 3, 0).toast).toBe("Imported 3 of 3 codes.");
    expect(importWords(3, 3, 0).summary).toBe("Imported 3 of 3 AppSumo codes");
    expect(importWords(1, 1, 0).toast).toBe("Imported 1 of 1 code.");
    expect(importWords(0, 2, 2).toast).toBe("Imported 0 of 4 codes. 2 were already here. 2 were repeated in the paste.");
  });
  it("an absent or nonsense repeat count counts as none", () => {
    expect(importWords(2, 2, Number.NaN).total).toBe(2);
    expect(importWords(2, 2, -3).summary).toBe("Imported 2 of 2 AppSumo codes");
  });
});
