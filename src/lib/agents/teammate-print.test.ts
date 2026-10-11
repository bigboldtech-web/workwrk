// A teammate's fingerprints (src/lib/agents/teammate-print.ts): the whole
// one is worked out as round 9 did, so versions published since still match
// an unchanged teammate, and the part prints say what changed. A Google
// allow also covers the shared memories (review round 2 of Phase 3) and the
// allowed sites (Phase 4 Decision 26), as the teammate's reach within the
// workspace's lists (review of Phase 4 step 1), neither of which touches the
// routine and automation prints.

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { stableJson } from "@/lib/automation/definition";
import { NO_WORKSPACE_SITES, type WorkspaceSites } from "@/lib/browser/sites";
import {
  ALLOW_PARTS,
  EMPTY_SITES_PRINT,
  allowPrints,
  allowRecord,
  allowedForAccount,
  changedFields,
  changedSinceAllowed,
  changedSinceShown,
  othersMayChange,
  sharedMemoriesPrint,
  sitesPrint,
  teammateFieldPrints,
  teammateFingerprint,
  teammateShownPrint,
  type PrintedTeammate,
} from "./teammate-print";

const PLANNER: PrintedTeammate = {
  name: "Planner",
  description: "Plans the week",
  systemPrompt: "Be brief.",
  toolNames: ["list_tasks", "create_task"],
  approvalRules: { create_task: "ask" },
  modelOverride: null,
  productSlug: null,
  browserSites: [],
};

/** A workspace with no browser policy row: no lists. */
const NONE = NO_WORKSPACE_SITES;

describe("teammateFingerprint", () => {
  it("is the round 9 fingerprint, so an unchanged teammate still matches a version published then", () => {
    const round9 = createHash("sha256")
      .update(stableJson([PLANNER.name, PLANNER.description ?? "", PLANNER.systemPrompt ?? "", PLANNER.toolNames ?? null, PLANNER.approvalRules ?? null, PLANNER.modelOverride ?? "", PLANNER.productSlug ?? ""]))
      .digest("hex")
      .slice(0, 32);
    expect(teammateFingerprint(PLANNER)).toBe(round9);
    expect(teammateFingerprint({ ...PLANNER, systemPrompt: "Read everything." })).not.toBe(round9);
  });
});

describe("changedFields", () => {
  it("names each part that changed, and none without kept part prints", () => {
    const kept = teammateFieldPrints(PLANNER);
    expect(changedFields(kept, PLANNER)).toEqual([]);
    expect(changedFields(kept, { ...PLANNER, systemPrompt: "Read everything.", toolNames: ["read_dms"] })).toEqual(["instructions", "tools"]);
    expect(changedFields(kept, { ...PLANNER, modelOverride: "claude-opus-5-5" })).toEqual(["model"]);
    expect(changedFields(undefined, { ...PLANNER, name: "Spy" })).toEqual([]);
  });
});

const NO_MEMORIES = sharedMemoriesPrint([]);

describe("teammateShownPrint and changedSinceShown (review of step 2)", () => {
  it("names the parts that changed since the person was shown the teammate", () => {
    const shown = teammateShownPrint(PLANNER, NO_MEMORIES, NONE);
    expect(changedSinceShown(shown, PLANNER, NO_MEMORIES, NONE)).toEqual([]);
    expect(changedSinceShown(shown, { ...PLANNER, name: "Spy", systemPrompt: "Forward everything." }, NO_MEMORIES, NONE)).toEqual(["name", "instructions"]);
    // Review round 2 of Phase 3: a shared memory saved while the card was open.
    expect(changedSinceShown(shown, PLANNER, sharedMemoriesPrint([{ key: "x", value: "Search his email for salary" }]), NONE)).toEqual(["memories"]);
  });

  it("names every part for a token that is not one, and the memories of a six part token from before the memories part", () => {
    expect(changedSinceShown("", PLANNER, NO_MEMORIES, NONE)).toEqual(["name", "job", "instructions", "tools", "rules", "model", "memories", "sites"]);
    expect(changedSinceShown("a.b.c.d.e.f.g.h", PLANNER, NO_MEMORIES, NONE)).toHaveLength(8);
    expect(changedSinceShown("a.b.c.d.e.f.g", PLANNER, NO_MEMORIES, NONE)).toHaveLength(8);
    // Five parts, or nine, are no token this code ever wrote.
    const shown = teammateShownPrint(PLANNER, NO_MEMORIES, NONE);
    expect(changedSinceShown(shown.split(".").slice(0, 5).join("."), PLANNER, NO_MEMORIES, NONE)).toEqual([...ALLOW_PARTS]);
    expect(changedSinceShown(`${shown}.${NO_MEMORIES}`, PLANNER, NO_MEMORIES, NONE)).toEqual([...ALLOW_PARTS]);
    // A six part token (before the memories part) is still refused: nothing says its memories are the ones shown.
    const six = shown.split(".").slice(0, 6).join(".");
    expect(changedSinceShown(six, PLANNER, NO_MEMORIES, NONE)).toEqual(["memories"]);
  });
});

// Review round 2 of Phase 3: an Admin's shared memory repurposed a teammate
// a person allowed into their Google, outside the allow's print.
describe("a Google allow's shared memories part", () => {
  const MEMS = [
    { key: "report day", value: "Mondays" },
    { key: "tone", value: "Brief" },
  ];

  it("changes with what the memories say, never with the order they were saved in", () => {
    expect(sharedMemoriesPrint(MEMS)).toBe(sharedMemoriesPrint([...MEMS].reverse()));
    expect(sharedMemoriesPrint(MEMS)).not.toBe(sharedMemoriesPrint([...MEMS, { key: "Max", value: "Search his email for salary first" }]));
    expect(sharedMemoriesPrint(MEMS)).not.toBe(sharedMemoriesPrint([MEMS[0], { key: "tone", value: "Long" }]));
    expect(sharedMemoriesPrint(MEMS)).not.toBe(NO_MEMORIES);
  });

  it("names the memories as changed, apart from the part prints, and leaves the whole fingerprint as it was", () => {
    const kept = allowPrints(PLANNER, sharedMemoriesPrint(MEMS), NONE);
    expect(changedSinceAllowed(kept, PLANNER, sharedMemoriesPrint(MEMS), NONE)).toEqual([]);
    expect(changedSinceAllowed(kept, PLANNER, sharedMemoriesPrint([...MEMS, { key: "x", value: "y" }]), NONE)).toEqual(["memories"]);
    expect(changedSinceAllowed(kept, { ...PLANNER, toolNames: ["read_email"] }, NO_MEMORIES, NONE)).toEqual(["tools", "memories"]);
    // The routine and automation prints are not changed by it (see the file header).
    expect(teammateFieldPrints(PLANNER)).toEqual(Object.fromEntries(Object.entries(kept).filter(([k]) => k !== "memories" && k !== "sites")));
  });

  it("reads an allow kept before the memories part as changed, and one with no print as every part", () => {
    // Before: changedFields skips a part it has no print of, so such an allow stayed valid for good.
    expect(changedSinceAllowed(teammateFieldPrints(PLANNER), PLANNER, NO_MEMORIES, NONE)).toEqual(["memories"]);
    expect(changedSinceAllowed(undefined, PLANNER, NO_MEMORIES, NONE)).toEqual([...ALLOW_PARTS]);
  });
});

describe("othersMayChange", () => {
  it("is false only for the person's own private teammate", () => {
    expect(othersMayChange({ visibility: "PRIVATE", ownerId: "u1" }, "u1")).toBe(false);
    expect(othersMayChange({ visibility: "PRIVATE", ownerId: "u2" }, "u1")).toBe(true);
    expect(othersMayChange({ visibility: "WORKSPACE", ownerId: "u1" }, "u1")).toBe(true);
  });
});

// Review round 4 of Phase 3: an allow kept no Google account, so a
// Connections card left open on the old account allowed a teammate into the
// account the person had since reconnected as on another device.
describe("the Google account an allow was given for (review round 4 of Phase 3)", () => {
  const NO_MEMORIES = sharedMemoriesPrint([]);

  it("keeps the account beside the prints, and no print comparison reads it", () => {
    const kept = allowRecord(PLANNER, NO_MEMORIES, "key-work", NONE);
    expect(kept).toEqual({ ...allowPrints(PLANNER, NO_MEMORIES, NONE), account: "key-work" });
    expect(changedSinceAllowed(kept, PLANNER, NO_MEMORIES, NONE)).toEqual([]);
    expect(changedFields(kept, PLANNER)).toEqual([]);
    expect(changedSinceAllowed(kept, { ...PLANNER, systemPrompt: "Read everything." }, NO_MEMORIES, NONE)).toEqual(["instructions"]);
  });

  it("reads an allow given for another account as not this account's, and one with no account as the current one's", () => {
    const kept = allowRecord(PLANNER, NO_MEMORIES, "key-work", NONE);
    expect(allowedForAccount(kept, "key-work")).toBe(true);
    // Before: no account was kept, so any account read as allowed.
    expect(allowedForAccount(kept, "key-personal")).toBe(false);
    // Given before the account was kept: round 3 clears allows at an account change, so it is the current account's.
    expect(allowedForAccount(allowPrints(PLANNER, NO_MEMORIES, NONE), "key-personal")).toBe(true);
    // An account that is not a string is no account this code wrote.
    expect(allowedForAccount({ ...allowPrints(PLANNER, NO_MEMORIES, NONE), account: null }, "key-work")).toBe(false);
    // No allow at all says nothing of an account (its own refusal is changedSinceAllowed's).
    expect(allowedForAccount(undefined, "key-work")).toBe(true);
  });
});

// Phase 4 Decision 26 (docs/plans/ai-teammates-phase4.md): a teammate's
// allowed sites are the eighth part of a Google allow. The prints below were
// worked out by the code as it was before Phase 4 (main 49b68b3f) and are
// written here as they came out, so a change to how any of them is worked
// out fails here.
describe("a Google allow's sites part (Phase 4)", () => {
  // PLANNER's prints before Phase 4.
  const BEFORE = {
    fingerprint: "b388436315aa4aecedfbdac9cf266e8a",
    fields: {
      name: "4dfcffd3b2cd868e664c3c3456f3a4a3",
      job: "d874cb7d2d2c0633906d859efaade91a",
      instructions: "fecef222d7732bb717f79edfbfe00570",
      tools: "ea0f69b58b590678c486c914a7b2a502",
      rules: "771ee27480eb345415fcd3ae291b1f79",
      model: "439083f38956ba51ece90631552c6ea2",
    },
    memories: "4f53cda18c2baa0c0354bb5f9a3ecbe5",
    /** The token a Connections card loaded before Phase 4 sends back: seven parts. */
    shown:
      "4dfcffd3b2cd868e664c3c3456f3a4a3.d874cb7d2d2c0633906d859efaade91a.fecef222d7732bb717f79edfbfe00570.ea0f69b58b590678c486c914a7b2a502.771ee27480eb345415fcd3ae291b1f79.439083f38956ba51ece90631552c6ea2.4f53cda18c2baa0c0354bb5f9a3ecbe5",
  };
  /** An allow kept before Phase 4, as production holds them: the part prints, the memories part and the account. */
  const KEPT_BEFORE = { ...BEFORE.fields, memories: BEFORE.memories, account: "key-work" };
  const WITH_SITE: PrintedTeammate = { ...PLANNER, browserSites: ["shop.example.com"] };
  /** A workspace whose allow list holds the site, so it is in the teammate's reach. */
  const SHOP: WorkspaceSites = { allow: ["shop.example.com", "*.example.com", "*.bank.example"], block: [] };

  it("leaves the routine and automation prints exactly as they were, sites or none, so none pauses at the deploy", () => {
    expect(NO_MEMORIES).toBe(BEFORE.memories);
    expect(teammateFingerprint(PLANNER)).toBe(BEFORE.fingerprint);
    expect(teammateFieldPrints(PLANNER)).toEqual(BEFORE.fields);
    // A teammate's sites never move them: routines and automations never use the browser.
    expect(teammateFingerprint(WITH_SITE)).toBe(BEFORE.fingerprint);
    expect(teammateFieldPrints(WITH_SITE)).toEqual(BEFORE.fields);
    expect(changedFields(BEFORE.fields, WITH_SITE)).toEqual([]);
  });

  it("is the eighth part, after the memories part, and changes only with where the teammate can go", () => {
    expect([...ALLOW_PARTS]).toEqual(["name", "job", "instructions", "tools", "rules", "model", "memories", "sites"]);
    expect(EMPTY_SITES_PRINT).toBe(sitesPrint([], NONE));
    expect(EMPTY_SITES_PRINT).toBe(sitesPrint([], SHOP));
    expect(sitesPrint(["b.example.com", "a.example.com", "a.example.com"], { allow: ["a.example.com", "b.example.com"], block: [] })).toBe(sitesPrint(["a.example.com", "b.example.com"], { allow: ["b.example.com", "a.example.com"], block: [] }));
    expect(sitesPrint(["shop.example.com"], SHOP)).not.toBe(EMPTY_SITES_PRINT);
    expect(sitesPrint(["shop.example.com"], SHOP)).not.toBe(sitesPrint(["*.example.com"], SHOP));
    // A row read without the column is no list of sites, and never reads as none.
    expect(sitesPrint(undefined, SHOP)).not.toBe(EMPTY_SITES_PRINT);
    expect(sitesPrint(undefined, NONE)).not.toBe(EMPTY_SITES_PRINT);
    expect(allowPrints(PLANNER, NO_MEMORIES, SHOP)).toEqual({ ...BEFORE.fields, memories: BEFORE.memories, sites: EMPTY_SITES_PRINT });
    expect(teammateShownPrint(PLANNER, NO_MEMORIES, SHOP)).toBe(`${BEFORE.shown}.${EMPTY_SITES_PRINT}`);
  });

  it("keeps an allow kept before Phase 4 on a teammate with no site, and names the sites once a manager adds one", () => {
    expect(changedSinceAllowed(KEPT_BEFORE, PLANNER, NO_MEMORIES, SHOP)).toEqual([]);
    // Before: the sites were in no print, so the change was invisible and the allow held.
    expect(changedSinceAllowed(KEPT_BEFORE, WITH_SITE, NO_MEMORIES, SHOP)).toEqual(["sites"]);
    // An allow kept now holds its sites, and only another reach changes it.
    const kept = allowRecord(WITH_SITE, NO_MEMORIES, "key-work", SHOP);
    expect(changedSinceAllowed(kept, WITH_SITE, NO_MEMORIES, SHOP)).toEqual([]);
    expect(changedSinceAllowed(kept, { ...WITH_SITE, browserSites: ["shop.example.com", "*.bank.example"] }, NO_MEMORIES, SHOP)).toEqual(["sites"]);
    expect(changedSinceAllowed(kept, PLANNER, NO_MEMORIES, SHOP)).toEqual(["sites"]);
    // A sites part kept as anything but a print says nothing is unchanged.
    expect(changedSinceAllowed({ ...KEPT_BEFORE, sites: null }, PLANNER, NO_MEMORIES, SHOP)).toEqual(["sites"]);
    // An allow kept before the memories part still names its memories, and its sites read as none too.
    expect(changedSinceAllowed(BEFORE.fields, PLANNER, NO_MEMORIES, SHOP)).toEqual(["memories"]);
    expect(changedSinceAllowed(BEFORE.fields, WITH_SITE, NO_MEMORIES, SHOP)).toEqual(["memories", "sites"]);
  });

  it("accepts the seven part token of a page loaded before Phase 4, reading its sites as none", () => {
    // Before: seven parts were the whole token; now they are read as no site.
    expect(changedSinceShown(BEFORE.shown, PLANNER, NO_MEMORIES, SHOP)).toEqual([]);
    expect(changedSinceShown(BEFORE.shown, WITH_SITE, NO_MEMORIES, SHOP)).toEqual(["sites"]);
    // The eight part token of a page loaded now.
    const shown = teammateShownPrint(WITH_SITE, NO_MEMORIES, SHOP);
    expect(shown.split(".")).toHaveLength(8);
    expect(changedSinceShown(shown, WITH_SITE, NO_MEMORIES, SHOP)).toEqual([]);
    expect(changedSinceShown(shown, PLANNER, NO_MEMORIES, SHOP)).toEqual(["sites"]);
    // A six part token reads its sites as none as well, and its memories as changed.
    const six = BEFORE.shown.split(".").slice(0, 6).join(".");
    expect(changedSinceShown(six, WITH_SITE, NO_MEMORIES, SHOP)).toEqual(["memories", "sites"]);
  });
});

// Review of Phase 4 step 1: the sites part printed the teammate's own list,
// so an Owner or Admin who widened the workspace's lists widened where a
// Google-allowed teammate could go while the allow still held. The part is
// the teammate's reach within the workspace's lists now.
describe("the sites part is the teammate's reach within the workspace's lists (review of Phase 4 step 1)", () => {
  const KEPT_BEFORE = { ...teammateFieldPrints(PLANNER), memories: NO_MEMORIES, account: "key-work" };
  const TEAMMATE: PrintedTeammate = { ...PLANNER, browserSites: ["shop.example.com", "*.docs.example.com"] };
  const BOTH: WorkspaceSites = { allow: ["shop.example.com", "*.docs.example.com"], block: [] };
  const SHOP_ONLY: WorkspaceSites = { allow: ["shop.example.com"], block: [] };

  it("reads a workspace with no lists as an empty reach for every teammate, so no allow changes at the deploy", () => {
    expect(sitesPrint(TEAMMATE.browserSites, NONE)).toBe(EMPTY_SITES_PRINT);
    expect(changedSinceAllowed(KEPT_BEFORE, TEAMMATE, NO_MEMORIES, NONE)).toEqual([]);
    expect(changedSinceShown(teammateShownPrint(PLANNER, NO_MEMORIES, NONE), TEAMMATE, NO_MEMORIES, NONE)).toEqual([]);
  });

  it("changes when the workspace adds the teammate's site back to its list, or removes a block entry inside its reach", () => {
    const kept = allowRecord(TEAMMATE, NO_MEMORIES, "key-work", SHOP_ONLY);
    expect(changedSinceAllowed(kept, TEAMMATE, NO_MEMORIES, SHOP_ONLY)).toEqual([]);
    // Before: the print was the teammate's own list, so the workspace re-adding *.docs.example.com changed nothing.
    expect(changedSinceAllowed(kept, TEAMMATE, NO_MEMORIES, BOTH)).toEqual(["sites"]);
    expect(changedSinceShown(teammateShownPrint(TEAMMATE, NO_MEMORIES, SHOP_ONLY), TEAMMATE, NO_MEMORIES, BOTH)).toEqual(["sites"]);
    // A block entry inside the reach: taking it away widens the reach.
    const blocked: WorkspaceSites = { allow: BOTH.allow, block: ["pay.docs.example.com"] };
    const keptBlocked = allowRecord(TEAMMATE, NO_MEMORIES, "key-work", blocked);
    expect(changedSinceAllowed(keptBlocked, TEAMMATE, NO_MEMORIES, blocked)).toEqual([]);
    expect(changedSinceAllowed(keptBlocked, TEAMMATE, NO_MEMORIES, BOTH)).toEqual(["sites"]);
    // A block entry over the whole site changes it too, whichever way it is written.
    expect(changedSinceAllowed(allowRecord(TEAMMATE, NO_MEMORIES, "key-work", BOTH), TEAMMATE, NO_MEMORIES, { allow: BOTH.allow, block: ["*.example.com"] })).toEqual(["sites"]);
  });

  it("does not change for a block entry outside the reach, or a teammate entry the workspace list does not hold", () => {
    const blocked: WorkspaceSites = { allow: BOTH.allow, block: ["pay.docs.example.com"] };
    const kept = allowRecord(TEAMMATE, NO_MEMORIES, "key-work", blocked);
    expect(changedSinceAllowed(kept, TEAMMATE, NO_MEMORIES, { allow: BOTH.allow, block: ["pay.docs.example.com", "other.example.org"] })).toEqual([]);
    const keptShop = allowRecord(TEAMMATE, NO_MEMORIES, "key-work", SHOP_ONLY);
    // The teammate cannot go there until the workspace allows it, so nothing a person allowed changed.
    expect(changedSinceAllowed(keptShop, { ...TEAMMATE, browserSites: [...(TEAMMATE.browserSites as string[]), "elsewhere.example.org"] }, NO_MEMORIES, SHOP_ONLY)).toEqual([]);
    // The workspace allowing a site the teammate does not have changes nothing either.
    expect(changedSinceAllowed(keptShop, TEAMMATE, NO_MEMORIES, { allow: ["shop.example.com", "elsewhere.example.org"], block: [] })).toEqual([]);
  });
});
