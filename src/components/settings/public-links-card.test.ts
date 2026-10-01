import { describe, expect, it } from "vitest";
import { publicLinksFailure } from "./public-links-card";

// A failed Public links save has to keep the reason and the value the admin
// picked, because the switch reverts and Retry must resend that choice.
describe("publicLinksFailure", () => {
  it("is null when the save went through", () => {
    expect(publicLinksFailure({ ok: true }, "view")).toBeNull();
  });

  it("keeps the server's reason and the picked value", () => {
    expect(publicLinksFailure({ ok: false, error: "Simulated failure" }, "view")).toEqual({ message: "Simulated failure", intended: "view" });
    expect(publicLinksFailure({ ok: false, error: "Forbidden" }, "off")).toEqual({ message: "Forbidden", intended: "off" });
  });

  it("falls back to Couldn't save when there is no reason", () => {
    expect(publicLinksFailure({ ok: false, error: "  " }, "view")).toEqual({ message: "Couldn't save", intended: "view" });
    expect(publicLinksFailure({ ok: false }, "off")).toEqual({ message: "Couldn't save", intended: "off" });
  });
});
