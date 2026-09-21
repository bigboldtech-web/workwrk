import { describe, expect, it } from "vitest";
import {
  contractsViewHref,
  envelopeStatusAfter,
  isValidEmail,
  nextPartyInOrder,
  parseContractStatus,
  parseContractsSort,
  parseContractsView,
  partiesToNotify,
  partyHue,
  partyRoleLabel,
  partySendErrors,
  remainingRequired,
  sanitizeSignValues,
  SIGN_TEXT_MAX,
  signingBarLabel,
  signingProgress,
  statusesForContractsView,
} from "./contracts";

describe("views", () => {
  it("parses the retired live spelling as All and unknowns as All", () => {
    expect(parseContractsView("live")).toBe("all");
    expect(parseContractsView(null)).toBe("all");
    expect(parseContractsView("trash")).toBe("all");
    expect(parseContractsView("templates")).toBe("templates");
  });
  it("maps views to statuses", () => {
    expect(statusesForContractsView("out")).toEqual(["SENT", "PARTIALLY_SIGNED"]);
    expect(statusesForContractsView("all")).toBeNull();
    expect(statusesForContractsView("templates")).toBeNull();
    expect(contractsViewHref("all")).toBe("/agreements");
    expect(contractsViewHref("voided")).toBe("/agreements?view=voided");
  });
  it("parses statuses and sorts", () => {
    expect(parseContractStatus("PARTIALLY_SIGNED")).toBe("PARTIALLY_SIGNED");
    expect(parseContractStatus("x")).toBe("DRAFT");
    expect(parseContractsSort("status")).toBe("status");
    expect(parseContractsSort(undefined)).toBe("updated");
  });
});

describe("parties", () => {
  it("labels roles with a Signer fallback and cycles the eight hues", () => {
    expect(partyRoleLabel("THIRD_PARTY")).toBe("Third party");
    expect(partyRoleLabel("nope")).toBe("Signer");
    expect(partyHue(0)).toBe(partyHue(8));
    expect(partyHue(-1)).toBe(partyHue(7));
  });
  it("validates emails", () => {
    expect(isValidEmail("a@b.co")).toBe(true);
    expect(isValidEmail("a@b")).toBe(false);
    expect(isValidEmail("")).toBe(false);
  });
  it("names the send errors per party", () => {
    const errors = partySendErrors([
      { id: "p1", name: "", email: "x@y.com" },
      { id: "p2", name: "Ben", email: "nope" },
      { id: "p3", name: "Cara", email: "c@d.com" },
      { id: "p4", name: "Dup", email: "C@D.com" },
    ]);
    expect(errors.p1).toBe("Name is required");
    expect(errors.p2).toBe("Enter a valid email");
    expect(errors.p3).toBeUndefined();
    expect(errors.p4).toBe("Two parties share this email");
  });
  it("walks the signing order and stops on a decline", () => {
    const parties = [
      { id: "a", name: "A", email: "a@x.com", status: "SIGNED", order: 0 },
      { id: "b", name: "B", email: "b@x.com", status: "PENDING", order: 1 },
      { id: "c", name: "C", email: "c@x.com", status: "PENDING", order: 2 },
    ];
    expect(nextPartyInOrder(parties)?.id).toBe("b");
    expect(partiesToNotify(parties, true).map((p) => p.id)).toEqual(["b"]);
    expect(partiesToNotify(parties, false).map((p) => p.id)).toEqual(["b", "c"]);
    expect(nextPartyInOrder([{ ...parties[0] }, { ...parties[1], status: "DECLINED" }, parties[2]])).toBeNull();
    expect(nextPartyInOrder(parties.map((p) => ({ ...p, status: "SIGNED" })))).toBeNull();
  });
  it("rolls the envelope status", () => {
    expect(envelopeStatusAfter([{ status: "SIGNED" }, { status: "SIGNED" }])).toBe("COMPLETED");
    expect(envelopeStatusAfter([{ status: "SIGNED" }, { status: "PENDING" }])).toBe("PARTIALLY_SIGNED");
    expect(envelopeStatusAfter([{ status: "VIEWED" }, { status: "PENDING" }])).toBe("SENT");
    expect(envelopeStatusAfter([])).toBe("SENT");
  });
});

describe("signing page", () => {
  const fields = [
    { id: "sig", type: "signature" },
    { id: "name", type: "text", required: true },
    { id: "note", type: "text" },
  ];
  it("counts required fields (signatures always required)", () => {
    expect(remainingRequired(fields, {})).toEqual({ left: 2, total: 2 });
    expect(remainingRequired(fields, { sig: "data:", name: " " })).toEqual({ left: 1, total: 2 });
    expect(remainingRequired(fields, { sig: "data:", name: "Ann" })).toEqual({ left: 0, total: 2 });
  });
  it("labels the bottom bar", () => {
    expect(signingBarLabel([], {})).toBe("Nothing for you to fill in");
    expect(signingBarLabel(fields, {})).toBe("2 of 2 required fields left");
    expect(signingBarLabel(fields, { sig: "d", name: "n" })).toBe("All fields complete");
  });
  it("walks Review, Fill, Sign, Done", () => {
    expect(signingProgress({ viewed: false, fields, values: {}, signed: false })).toBe(0);
    expect(signingProgress({ viewed: true, fields, values: {}, signed: false })).toBe(1);
    expect(signingProgress({ viewed: true, fields, values: { name: "Ann" }, signed: false })).toBe(2);
    expect(signingProgress({ viewed: true, fields, values: { name: "Ann", sig: "d" }, signed: false })).toBe(3);
    expect(signingProgress({ viewed: true, fields, values: {}, signed: true })).toBe(4);
  });
});

describe("sanitizeSignValues", () => {
  const mine = [
    { id: "f1", type: "signature" },
    { id: "f3", type: "text", required: true },
    { id: "f4", type: "checkbox" },
  ];
  it("keeps only the signer's own string values", () => {
    const out = sanitizeSignValues(mine, { f1: "data:image/png;base64,AAAA", f2: "INJECTED BY PARTY 1", f3: "Ann", junk: { nested: true }, f4: "true" });
    expect(out).toEqual({ f1: "data:image/png;base64,AAAA", f3: "Ann", f4: "true" });
  });
  it("refuses a signature that is not an image data URL and non-object bodies", () => {
    expect(sanitizeSignValues(mine, { f1: "<script>", f3: 42 })).toEqual({});
    expect(sanitizeSignValues(mine, null)).toEqual({});
    expect(sanitizeSignValues(mine, ["f1"])).toEqual({});
  });
  it("caps oversized values", () => {
    const out = sanitizeSignValues(mine, { f3: "x".repeat(SIGN_TEXT_MAX + 50) });
    expect(out.f3.length).toBe(SIGN_TEXT_MAX);
  });
});
