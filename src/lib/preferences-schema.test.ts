import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  RESERVED_SURFACE_KEYS,
  deepMergePatch,
  describeIssues,
  preferencesPatchSchema,
  stripOrgOnlyKeys,
} from "./preferences-schema";

// The schema exactly as src/app/api/preferences/route.ts had it before this
// change (strip mode). Kept verbatim here as the widening oracle: every body
// it accepted must be accepted by the strict schema with the same result.
const legacyPatchSchema = z.object({
  sidebar: z.object({
    pinned: z.array(z.string()).optional(),
    hidden: z.array(z.string()).optional(),
    order: z.array(z.string()).optional(),
    iconsOnly: z.boolean().optional(),
    sectionsOrder: z.array(z.string()).optional(),
  }).optional(),
  home: z.object({
    cards: z.array(z.string()).optional(),
    order: z.array(z.string()).optional(),
    favoriteBoardIds: z.array(z.string()).optional(),
    favoriteSpaceIds: z.array(z.string()).optional(),
    favoriteDocIds: z.array(z.string()).optional(),
    favoriteFolderIds: z.array(z.string()).optional(),
    favoriteTableIds: z.array(z.string()).optional(),
    favoriteWhiteboardIds: z.array(z.string()).optional(),
    favoriteFileIds: z.array(z.string()).optional(),
    taskCardLayout: z.record(z.string(), z.array(z.object({
      i: z.string(), x: z.number(), y: z.number(), w: z.number(), h: z.number(),
    }))).optional(),
    taskCardsHidden: z.array(z.string()).optional(),
    overviewCardLayout: z.record(z.string(), z.array(z.object({
      i: z.string(), x: z.number(), y: z.number(), w: z.number(), h: z.number(),
    }))).optional(),
    overviewCardsHidden: z.array(z.string()).optional(),
    notifications: z.object({
      inbox: z.record(z.string(), z.boolean()).optional(),
      email: z.record(z.string(), z.boolean()).optional(),
    }).optional(),
  }).optional(),
  theme: z.object({
    appearance: z.enum(["LIGHT", "DARK", "AUTO"]).optional(),
    accent: z.string().max(40).optional(),
  }).optional(),
  density: z.enum(["compact", "cozy"]).optional(),
});

const layout = { lg: [{ i: "recent", x: 0, y: 0, w: 6, h: 4 }], md: [{ i: "recent", x: 0, y: 0, w: 4, h: 4 }] };

/** Every body a live client sends today (the 9 writers from the recon) plus
 *  synthetic bodies covering every legacy key. */
const LEGACY_VALID_BODIES: Record<string, unknown> = {
  "account/appearance": { theme: { appearance: "DARK", accent: "workwrk" }, density: "compact" },
  "settings/notifications": { home: { notifications: { inbox: { mention: false, assigned: true }, email: { master: true, mention: false } } } },
  "tasks hidden": { home: { taskCardsHidden: ["okrs", "kras"] } },
  "onboard pinned": { sidebar: { pinned: ["home", "planner"] } },
  "customize sidebar": { sidebar: { iconsOnly: true, sectionsOrder: ["spaces", "favorites"], order: ["home"], hidden: ["clips"] } },
  "customize home": { home: { cards: ["recent", "docs"], order: ["docs", "recent"] } },
  "customize theme": { theme: { accent: "mint" } },
  "customize density": { density: "cozy" },
  "space overview layout": { home: { overviewCardLayout: layout } },
  "space overview hidden": { home: { overviewCardsHidden: ["members"] } },
  "favorites": {
    home: {
      favoriteBoardIds: ["b1"], favoriteSpaceIds: ["s1"], favoriteDocIds: ["d1"], favoriteFolderIds: ["f1"],
      favoriteTableIds: ["t1"], favoriteWhiteboardIds: ["w1"], favoriteFileIds: ["file1"],
    },
  },
  "task card layout (legacy key)": { home: { taskCardLayout: layout } },
  "empty patch": {},
  "everything at once": {
    sidebar: { pinned: [], hidden: [], order: [], iconsOnly: false, sectionsOrder: [] },
    home: { cards: [], order: [], taskCardLayout: {}, taskCardsHidden: [], overviewCardLayout: {}, overviewCardsHidden: [], notifications: { inbox: {}, email: {} } },
    theme: { appearance: "AUTO", accent: "" },
    density: "compact",
  },
};

describe("preferencesPatchSchema is strictly widening", () => {
  for (const [name, body] of Object.entries(LEGACY_VALID_BODIES)) {
    it(`accepts and round-trips: ${name}`, () => {
      const legacy = legacyPatchSchema.safeParse(body);
      expect(legacy.success).toBe(true);
      const next = preferencesPatchSchema.safeParse(body);
      expect(next.success).toBe(true);
      if (legacy.success && next.success) {
        expect(next.data).toEqual(legacy.data);
        // and the parsed value is the body itself: nothing added, nothing dropped
        expect(next.data).toEqual(body);
      }
    });
  }

  // The legacy item schema was strip-mode: any extra key on a react-grid-layout
  // item was accepted and dropped. Those bodies must still be accepted, and
  // now survive whole (the item is a library object, not our namespace).
  const LEGACY_ACCEPTED_ITEM_EXTRAS: Record<string, unknown> = {
    "RGL resizeHandles on an item": { home: { taskCardLayout: { lg: [{ i: "a", x: 0, y: 0, w: 1, h: 1, resizeHandles: ["se"] }] } } },
    "RGL isBounded on an item": { home: { overviewCardLayout: { lg: [{ i: "a", x: 0, y: 0, w: 1, h: 1, isBounded: false }] } } },
    "every documented RGL item key": {
      home: { taskCardLayoutV3: { lg: [{ i: "a", x: 0, y: 0, w: 2, h: 2, minW: 1, maxW: 4, minH: 1, maxH: 4, static: false, isDraggable: true, isResizable: true, isBounded: true, resizeHandles: ["se", "sw"], moved: false }] } },
    },
    "an item key this schema does not name": { home: { taskCardLayout: { lg: [{ i: "a", x: 0, y: 0, w: 1, h: 1, futureRglKey: 1 }] } } },
  };
  for (const [name, body] of Object.entries(LEGACY_ACCEPTED_ITEM_EXTRAS)) {
    it(`still accepts, and now keeps whole: ${name}`, () => {
      expect(legacyPatchSchema.safeParse(body).success).toBe(true);
      const next = preferencesPatchSchema.safeParse(body);
      expect(next.success).toBe(true);
      if (next.success) expect(next.data).toEqual(body);
    });
  }

  it("names the ONE intended narrowing: a stray key in a namespace this schema owns (spec 9.3), at every level", () => {
    // The legacy schema accepted these and silently dropped the key; the
    // strict schema rejects them so a client learns its key never persisted.
    for (const [body, path] of [
      [{ inbox: { showAll: true } }, "inbox"],
      [{ sidebar: { pinnedApps: [] } }, "sidebar.pinnedApps"],
      [{ home: { taskCardLayoutV4: {} } }, "home.taskCardLayoutV4"],
      [{ home: { notifications: { pigeon: true } } }, "home.notifications.pigeon"],
      [{ home: { notifications: { inboxView: { colour: "red" } } } }, "home.notifications.inboxView.colour"],
      [{ theme: { font: "serif" } }, "theme.font"],
    ] as [Record<string, unknown>, string][]) {
      const legacy = legacyPatchSchema.safeParse(body);
      expect(legacy.success).toBe(true);
      const next = preferencesPatchSchema.safeParse(body);
      expect(next.success).toBe(false);
      if (!next.success) expect(describeIssues(next.error.issues).map((i) => i.path)).toContain(path);
    }
  });

  it("still rejects what the legacy schema rejected", () => {
    for (const bad of [
      { density: "roomy" },
      { theme: { appearance: "SEPIA" } },
      { theme: { accent: "x".repeat(41) } },
      { home: { cards: "recent" } },
      { sidebar: { iconsOnly: "yes" } },
      { home: { taskCardLayout: { lg: [{ i: "a", x: "0", y: 0, w: 1, h: 1 }] } } },
      { home: { taskCardLayout: { lg: [{ i: "a", x: 0, y: 0, w: 1 }] } } },
    ]) {
      expect(legacyPatchSchema.safeParse(bad).success).toBe(false);
      expect(preferencesPatchSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("never made an optional key required", () => {
    // A body with only one key per column parses; so does a bare column.
    expect(preferencesPatchSchema.safeParse({ sidebar: {} }).success).toBe(true);
    expect(preferencesPatchSchema.safeParse({ home: {} }).success).toBe(true);
    expect(preferencesPatchSchema.safeParse({ theme: {} }).success).toBe(true);
    expect(preferencesPatchSchema.safeParse({ home: { notifications: {} } }).success).toBe(true);
  });
});

describe("the previously stripped keys now survive (critic S7)", () => {
  it("home.notifications.inboxView (the Inbox display prefs)", () => {
    const body = { home: { notifications: { inboxView: { showAll: true, groupByDate: false, sortNewest: true, mode: "inline" } } } };
    // The legacy schema silently dropped inboxView:
    const legacy = legacyPatchSchema.safeParse(body);
    expect(legacy.success && legacy.data).toEqual({ home: { notifications: {} } });
    // The strict schema keeps it whole:
    const next = preferencesPatchSchema.safeParse(body);
    expect(next.success && next.data).toEqual(body);
  });

  it("home.taskCardLayoutV3 (the My Tasks card layout)", () => {
    const body = { home: { taskCardLayoutV3: layout } };
    const legacy = legacyPatchSchema.safeParse(body);
    expect(legacy.success && legacy.data).toEqual({ home: {} });
    const next = preferencesPatchSchema.safeParse(body);
    expect(next.success && next.data).toEqual(body);
  });

  it("the new 9.2 namespaces parse", () => {
    const body = {
      sidebar: { width: 280, collapsed: true, quickTools: ["create-task"] },
      home: {
        notifications: { mutedUntil: null, quietHours: { start: "18:00", end: "09:00", days: [0, 6] }, muted: ["space:a"], desktop: true },
        locale: { language: "en", timezone: "Asia/Kolkata", weekStart: 1, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
        ui: { reducedMotion: true, showUpcoming: false, dismissed: ["welcome"] },
        work: { savedFilters: [{ name: "Mine" }], pinnedViews: ["v1"] },
      },
      theme: { chrome: "light" },
    };
    const next = preferencesPatchSchema.safeParse(body);
    expect(next.success && next.data).toEqual(body);
  });

  it("a stray key is a 400 that names it, never a silent strip", () => {
    const r = preferencesPatchSchema.safeParse({ inbox: { showAll: true } });
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = describeIssues(r.error.issues).map((i) => i.path);
      expect(paths).toContain("inbox");
    }
    const nested = preferencesPatchSchema.safeParse({ home: { notifications: { pigeon: true } } });
    expect(nested.success).toBe(false);
    if (!nested.success) {
      expect(describeIssues(nested.error.issues).map((i) => i.path)).toContain("home.notifications.pigeon");
    }
  });

  it("sidebar.apps stays accepted on the personal route and is dropped before the write, as before", () => {
    const r = preferencesPatchSchema.safeParse({ sidebar: { apps: { hidden: ["chat"] }, iconsOnly: true } });
    expect(r.success).toBe(true);
    if (r.success) expect(stripOrgOnlyKeys(r.data)).toEqual({ sidebar: { iconsOnly: true } });
  });
});

describe("deepMergePatch", () => {
  it("keeps sibling namespaces when a nested object is patched", () => {
    const existing = { notifications: { inbox: { mention: false }, email: { master: true } }, cards: ["a"] };
    const merged = deepMergePatch(existing, { notifications: { inboxView: { showAll: true } } });
    expect(merged).toEqual({
      notifications: { inbox: { mention: false }, email: { master: true }, inboxView: { showAll: true } },
      cards: ["a"],
    });
    // inputs untouched
    expect(existing.notifications).toEqual({ inbox: { mention: false }, email: { master: true } });
  });
  it("replaces arrays and scalars, stores null, skips undefined", () => {
    const merged = deepMergePatch(
      { cards: ["a", "b"], density: "cozy", notifications: { mutedUntil: "2026-01-01T00:00:00Z" } },
      { cards: ["c"], density: undefined, notifications: { mutedUntil: null } },
    );
    expect(merged).toEqual({ cards: ["c"], density: "cozy", notifications: { mutedUntil: null } });
  });
  it("behaves like the old shallow spread for flat patches", () => {
    const existing = { cards: ["a"], order: ["a"] };
    const patch = { order: ["b"] };
    expect(deepMergePatch(existing, patch)).toEqual({ ...existing, ...patch });
  });
});

// ── Phase 2 additions (spec-task-detail section 4 step 1, spec-work-home W0) ──
//
// Every key a later Phase-2 stage writes has to be named here first, because
// the schema is strict: an unlisted key is a 400 that names it, and a surface
// whose PATCH 400s is a setting that silently never persists (critic #7).

describe("Phase 2 preference keys", () => {
  it("home.work.itemFields persists the task-detail field set per List", () => {
    const r = preferencesPatchSchema.safeParse({
      home: { work: { itemFields: { list_abc: ["status", "assignees", "dueAt", "priority"] } } },
    });
    expect(r.success).toBe(true);
  });

  it("home.work.itemFields rejects a non-string-array value", () => {
    const r = preferencesPatchSchema.safeParse({ home: { work: { itemFields: { list_abc: [1, 2] } } } });
    expect(r.success).toBe(false);
  });

  it("home.work.drawerWidth accepts the design system's 480 to 720 band", () => {
    for (const width of [480, 520, 720]) {
      expect(preferencesPatchSchema.safeParse({ home: { work: { drawerWidth: width } } }).success).toBe(true);
    }
    for (const width of [479, 721, 520.5]) {
      expect(preferencesPatchSchema.safeParse({ home: { work: { drawerWidth: width } } }).success).toBe(false);
    }
  });

  it("home.work.viewOverrides persists one viewer's sort of a shared view", () => {
    const r = preferencesPatchSchema.safeParse({
      home: { work: { viewOverrides: { view_1: { sortKey: "dueAt", sortDir: "asc" } } } },
    });
    expect(r.success).toBe(true);
  });

  it("home.work.surface takes both a reserved surface name and a view id", () => {
    const r = preferencesPatchSchema.safeParse({
      home: {
        work: {
          surface: {
            "my-work": { viewOptions: { group: "due" } },
            view_ck1: { columns: ["title", "status"] },
          },
        },
      },
    });
    expect(r.success).toBe(true);
  });

  it("every reserved surface key is a legal surface name", () => {
    for (const key of RESERVED_SURFACE_KEYS) {
      const r = preferencesPatchSchema.safeParse({ home: { work: { surface: { [key]: {} } } } });
      expect(r.success).toBe(true);
    }
  });

  it("home.work.savedFilters and pinnedViews were already there and stay there", () => {
    const r = preferencesPatchSchema.safeParse({
      home: { work: { savedFilters: [{ id: "f1" }], pinnedViews: ["view_1"] } },
    });
    expect(r.success).toBe(true);
  });

  it("home.work.everythingFilters is accepted: /everything's own saved views", () => {
    // A strict schema 400s an unlisted key, so the page's "Save as view"
    // footer would have failed silently without this row.
    const r = preferencesPatchSchema.safeParse({
      home: { work: { everythingFilters: [{ id: "ev_1", name: "Urgent", filters: { priorities: ["URGENT"] } }] } },
    });
    expect(r.success).toBe(true);
  });

  it("home.work.everythingFilters is SEPARATE from savedFilters, not an alias", () => {
    const both = preferencesPatchSchema.safeParse({
      home: { work: { savedFilters: [{ id: "f1" }], everythingFilters: [{ id: "ev_1" }] } },
    });
    expect(both.success).toBe(true);
  });

  it("home.notifications.inboxView is accepted (the key /inbox already writes)", () => {
    const r = preferencesPatchSchema.safeParse({
      home: { notifications: { inboxView: { showAll: true, groupByDate: false, sortNewest: true, mode: "inline" } } },
    });
    expect(r.success).toBe(true);
  });

  it("home.cards is accepted (the Work sidebar's optional-row key)", () => {
    expect(preferencesPatchSchema.safeParse({ home: { cards: ["spaces", "everything"] } }).success).toBe(true);
  });

  it("sidebar.expanded and sidebar.hiddenSpaceIds persist the Spaces tree", () => {
    const r = preferencesPatchSchema.safeParse({
      sidebar: { expanded: ["space_1", "folder_2"], hiddenSpaceIds: ["space_9"] },
    });
    expect(r.success).toBe(true);
  });

  it("a typo in the new namespace is still a 400 that names the key", () => {
    const r = preferencesPatchSchema.safeParse({ home: { work: { itemField: {} } } });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(describeIssues(r.error.issues).map((i) => i.path)).toContain("home.work.itemField");
    }
  });

  it("the additions are widening: none of them is required", () => {
    expect(preferencesPatchSchema.safeParse({ home: { work: {} } }).success).toBe(true);
    expect(preferencesPatchSchema.safeParse({ sidebar: {} }).success).toBe(true);
    expect(preferencesPatchSchema.safeParse({}).success).toBe(true);
  });
});

// ── Phase 3 (Docs hub + Process), change request G22a ─────────────
//
// Every key below has a control behind it on a Docs-hub or Process surface.
// The schema is strict, so a surface whose key is missing here 400s on its
// first write and the option silently never persists: these rows and the
// surface that writes them land in the same commit, which is what the spec's
// "a surface whose key is not in the schema does not ship" means.

describe("Phase 3 preference keys (spec-docs-knowledge G22a)", () => {
  it("home.docs.columns and home.docs.outline persist the /docs display options", () => {
    const r = preferencesPatchSchema.safeParse({
      home: { docs: { columns: { location: true, viewed: false }, outline: true } },
    });
    expect(r.success).toBe(true);
  });

  it("home.canvas.viewType is grid or list and nothing else", () => {
    expect(preferencesPatchSchema.safeParse({ home: { canvas: { viewType: "grid" } } }).success).toBe(true);
    expect(preferencesPatchSchema.safeParse({ home: { canvas: { viewType: "list" } } }).success).toBe(true);
    expect(preferencesPatchSchema.safeParse({ home: { canvas: { viewType: "board" } } }).success).toBe(false);
  });

  it("home.files.viewType and home.files.columns persist the /files display options", () => {
    const r = preferencesPatchSchema.safeParse({
      home: { files: { viewType: "list", columns: { size: false, owner: true } } },
    });
    expect(r.success).toBe(true);
  });

  it("home.notetaker.lastListId takes an id and takes null to clear it", () => {
    expect(preferencesPatchSchema.safeParse({ home: { notetaker: { lastListId: "list_1" } } }).success).toBe(true);
    expect(preferencesPatchSchema.safeParse({ home: { notetaker: { lastListId: null } } }).success).toBe(true);
    expect(preferencesPatchSchema.safeParse({ home: { notetaker: { lastListId: 7 } } }).success).toBe(false);
  });

  it("home.favoriteFileIds was already accepted and stays accepted", () => {
    expect(preferencesPatchSchema.safeParse({ home: { favoriteFileIds: ["file_1"] } }).success).toBe(true);
  });

  it("sidebar.docsTreeOpen and sidebar.docsFoldersOpen persist the two Docs trees", () => {
    const r = preferencesPatchSchema.safeParse({
      sidebar: { docsTreeOpen: ["doc_1", "doc_2"], docsFoldersOpen: ["ff_1"] },
    });
    expect(r.success).toBe(true);
  });

  it("sidebar.docsFilesOpen persists the Files row's own expansion", () => {
    expect(preferencesPatchSchema.safeParse({ sidebar: { docsFilesOpen: true } }).success).toBe(true);
    expect(preferencesPatchSchema.safeParse({ sidebar: { docsFilesOpen: false } }).success).toBe(true);
    expect(preferencesPatchSchema.safeParse({ sidebar: { docsFilesOpen: "open" } }).success).toBe(false);
  });

  it("sidebar.collapsedSections carries the Docs hub's section keys", () => {
    expect(preferencesPatchSchema.safeParse({ sidebar: { collapsedSections: ["docs.docs"] } }).success).toBe(true);
  });

  it("home.sops.columns persists the SOP library's Display options (spec-process)", () => {
    expect(preferencesPatchSchema.safeParse({ home: { sops: { columns: { folder: true, tags: false } } } }).success).toBe(true);
    expect(preferencesPatchSchema.safeParse({ home: { sops: { column: {} } } }).success).toBe(false);
    expect(preferencesPatchSchema.safeParse({ home: { sops: { columns: { folder: "yes" } } } }).success).toBe(false);
  });

  it("home.ui.sopDetailsCollapsed persists the SOP Details strip (spec-process)", () => {
    expect(preferencesPatchSchema.safeParse({ home: { ui: { sopDetailsCollapsed: true } } }).success).toBe(true);
    expect(preferencesPatchSchema.safeParse({ home: { ui: { sopDetailsCollapsed: "yes" } } }).success).toBe(false);
  });

  it("home.ui.policiesViewType and contractsViewType persist the list / cards switch (spec-process)", () => {
    expect(preferencesPatchSchema.safeParse({ home: { ui: { policiesViewType: "cards" } } }).success).toBe(true);
    expect(preferencesPatchSchema.safeParse({ home: { ui: { contractsViewType: "list" } } }).success).toBe(true);
    expect(preferencesPatchSchema.safeParse({ home: { ui: { policiesViewType: "grid" } } }).success).toBe(false);
  });

  it("a typo inside a new Docs namespace is a 400 that names the key", () => {
    const r = preferencesPatchSchema.safeParse({ home: { docs: { column: {} } } });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(describeIssues(r.error.issues).map((i) => i.path)).toContain("home.docs.column");
    }
  });

  it("every Phase 3 addition is optional, so nothing that was valid became a 400", () => {
    expect(preferencesPatchSchema.safeParse({ home: { docs: {} } }).success).toBe(true);
    expect(preferencesPatchSchema.safeParse({ home: { canvas: {} } }).success).toBe(true);
    expect(preferencesPatchSchema.safeParse({ home: { files: {} } }).success).toBe(true);
    expect(preferencesPatchSchema.safeParse({ home: { notetaker: {} } }).success).toBe(true);
    expect(preferencesPatchSchema.safeParse({ home: { ui: {} } }).success).toBe(true);
  });
});
