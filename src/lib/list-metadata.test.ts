import { describe, expect, it } from "vitest";
import {
  activityListFieldIds,
  applyMetadataPatch,
  changedListFieldKeys,
  changedTopLevelKeys,
  checkHomeMetadataKeys,
  hiddenFromHomeProjection,
  isReservedMetadataKey,
  isTaskLevelMetadataKey,
  keepNamespacesFor,
  keepReadableListFields,
  mergeWholesaleMetadata,
  metadataForCreate,
  projectRowMetadata,
  redactActivityForLinkedReader,
  routeMetadataPatch,
  stripForUnknownViewer,
  swapNamespacesOnMove,
  CONNECT_KEYS_META,
  LISTS_NS,
  TASK_LEVEL_METADATA_KEYS,
} from "./list-metadata";

const none = new Set<string>();

// A task whose home is A, linked into B. A defines "budget" and a connect
// field "deps"; B defines its own "budget" (same slug) and a connect "refs".
const stored = {
  description: "shared body",
  checklist: [{ id: "c1", done: false }],
  budget: 100,
  secret_home_note: "home only",
  deps: ["t-readable", "t-hidden"],
  [CONNECT_KEYS_META]: ["deps"],
  [LISTS_NS]: {
    B: { budget: 7, refs: ["t-readable", "t-hidden"], [CONNECT_KEYS_META]: ["refs"] },
    C: { stage: "x" },
  },
};
const readable = new Set(["t-readable"]);

describe("reserved keys", () => {
  it("are exactly the $ keys", () => {
    expect(isReservedMetadataKey("$lists")).toBe(true);
    expect(isReservedMetadataKey("$connectKeys")).toBe(true);
    expect(isReservedMetadataKey("budget")).toBe(false);
  });
  it("name the task body and watcher keys as task level", () => {
    expect(TASK_LEVEL_METADATA_KEYS).toEqual(["description", "checklist", "timeEstimate", "kraId", "kpiId", "watchers", "unwatchers", "followers"]);
    expect(isTaskLevelMetadataKey("checklist")).toBe(true);
    expect(isTaskLevelMetadataKey("budget")).toBe(false);
    expect(isTaskLevelMetadataKey("$lists")).toBe(false);
  });
});

describe("projectRowMetadata, home context", () => {
  it("strips every $ key and reduces connect values to readable ids", () => {
    const { metadata, connected } = projectRowMetadata(stored, {
      kind: "home",
      contextStoredKeys: new Set(["budget", "deps", "secret_home_note"]),
      contextConnectKeys: new Set(["deps"]),
      readable,
    });
    expect(metadata[LISTS_NS]).toBeUndefined();
    expect(metadata[CONNECT_KEYS_META]).toBeUndefined();
    expect(metadata.deps).toEqual(["t-readable"]);
    expect(connected.deps).toEqual(["t-readable"]);
    expect(metadata.budget).toBe(100);
    expect(JSON.stringify(metadata)).not.toContain("t-hidden");
  });
  it("drops a marker-named value whose field the home no longer defines", () => {
    const { metadata } = projectRowMetadata(stored, {
      kind: "home",
      contextStoredKeys: new Set(["budget"]),
      contextConnectKeys: none,
      readable,
    });
    expect("deps" in metadata).toBe(false);
    expect(hiddenFromHomeProjection(stored, none)).toEqual(["deps"]);
  });
});

describe("projectRowMetadata, linked context", () => {
  const ctx = {
    kind: "linked" as const,
    listId: "B",
    contextStoredKeys: new Set(["budget", "refs"]),
    contextConnectKeys: new Set(["refs"]),
    readable,
  };
  it("never gives a linked-only reader a home-only value, a $ key or an unreadable id", () => {
    const { metadata, connected } = projectRowMetadata(stored, { ...ctx, homeReadable: false });
    expect(metadata).toEqual({
      description: "shared body",
      checklist: [{ id: "c1", done: false }],
      budget: 7,
      refs: ["t-readable"],
    });
    expect(connected.refs).toEqual(["t-readable"]);
    const text = JSON.stringify(metadata);
    expect(text).not.toContain("home only");
    expect(text).not.toContain("t-hidden");
    expect(text).not.toContain("$");
    // Not even as a length.
    expect((metadata.refs as string[]).length).toBe(1);
  });
  it("never lets a home value under the same slug stand in for B's own", () => {
    const { metadata } = projectRowMetadata({ ...stored, [LISTS_NS]: { B: {} } }, { ...ctx, homeReadable: true });
    expect("budget" in metadata).toBe(false);
    expect("refs" in metadata).toBe(false);
  });
  it("adds the home's other values, minus connect values, when the home is readable", () => {
    const { metadata } = projectRowMetadata(stored, { ...ctx, homeReadable: true });
    expect(metadata.secret_home_note).toBe("home only");
    expect(metadata.budget).toBe(7);
    expect("deps" in metadata).toBe(false);
  });
});

describe("stripForUnknownViewer", () => {
  it("drops $ keys and every marker-named value", () => {
    expect(stripForUnknownViewer(stored)).toEqual({
      description: "shared body",
      checklist: [{ id: "c1", done: false }],
      budget: 100,
      secret_home_note: "home only",
    });
  });
});

describe("routeMetadataPatch", () => {
  const ctx = { definedKeys: new Set(["budget", "description"]), mirrorKeys: new Set(["m1"]) };
  it("sends B's keys to B's namespace and task-level keys to the top", () => {
    expect(routeMetadataPatch({ budget: 9, checklist: [] }, ctx)).toEqual({ ok: true, top: { checklist: [] }, ns: { budget: 9 } });
  });
  it("gives a B field that shares a task-level slug to B", () => {
    expect(routeMetadataPatch({ description: "B's own" }, ctx)).toEqual({ ok: true, top: {}, ns: { description: "B's own" } });
  });
  it("refuses reserved, mirror and unknown keys", () => {
    expect(routeMetadataPatch({ $lists: {} }, ctx)).toEqual({ ok: false, error: "reserved_key", key: "$lists" });
    expect(routeMetadataPatch({ m1: 1 }, ctx)).toEqual({ ok: false, error: "read_only_field", key: "m1" });
    expect(routeMetadataPatch({ secret_home_note: "x" }, ctx)).toEqual({ ok: false, error: "unknown_field", key: "secret_home_note" });
  });
  it("checks the home context's two refusals", () => {
    expect(checkHomeMetadataKeys(["a", "$connectKeys"], none)).toEqual({ ok: false, error: "reserved_key", key: "$connectKeys" });
    expect(checkHomeMetadataKeys(["m1"], new Set(["m1"]))).toEqual({ ok: false, error: "read_only_field", key: "m1" });
    expect(checkHomeMetadataKeys(["a"], none)).toBeNull();
  });
});

describe("applyMetadataPatch", () => {
  it("writes into one namespace, deletes on null and keeps every other key", () => {
    const next = applyMetadataPatch(stored, {
      top: { checklist: [] },
      ns: { budget: null, refs: ["t-new"] },
      listId: "B",
      nsConnectKeys: new Set(["refs"]),
    });
    expect(next.checklist).toEqual([]);
    expect(next.budget).toBe(100);
    expect((next[LISTS_NS] as Record<string, Record<string, unknown>>).B).toEqual({ refs: ["t-new"], [CONNECT_KEYS_META]: ["refs"] });
    expect((next[LISTS_NS] as Record<string, unknown>).C).toEqual({ stage: "x" });
    expect(next.deps).toEqual(["t-readable", "t-hidden"]);
  });
  it("maintains the top-level marker and removes an emptied namespace", () => {
    const a = applyMetadataPatch({}, { top: { deps: ["x"] }, topConnectKeys: new Set(["deps"]) });
    expect(a).toEqual({ deps: ["x"], [CONNECT_KEYS_META]: ["deps"] });
    const b = applyMetadataPatch(a, { top: { deps: null } });
    expect(b).toEqual({});
    const c = applyMetadataPatch({ [LISTS_NS]: { B: { x: 1 } } }, { ns: { x: null }, listId: "B" });
    expect(c).toEqual({});
  });
  it("never writes a reserved key through a patch", () => {
    expect(applyMetadataPatch({ a: 1 }, { top: { $lists: { evil: {} } } })).toEqual({ a: 1 });
  });
  it("does not mutate its input", () => {
    const copy = JSON.parse(JSON.stringify(stored));
    applyMetadataPatch(stored, { top: { budget: 1 }, ns: { budget: 2 }, listId: "B" });
    expect(stored).toEqual(copy);
  });
});

describe("mergeWholesaleMetadata", () => {
  it("keeps the stored namespaces, markers and hidden keys", () => {
    const next = mergeWholesaleMetadata(stored, { description: "new", budget: 5, $lists: { attack: {} } }, { keepKeys: ["deps"] });
    expect(next.description).toBe("new");
    expect(next.budget).toBe(5);
    expect(next.deps).toEqual(["t-readable", "t-hidden"]);
    expect(next[LISTS_NS]).toEqual(stored[LISTS_NS]);
    expect(next[CONNECT_KEYS_META]).toEqual(["deps"]);
    expect("secret_home_note" in next).toBe(false);
  });
});

describe("swapNamespacesOnMove", () => {
  it("brings B's values up and parks A's own values under A", () => {
    const next = swapNamespacesOnMove(stored, { fromBoardId: "A", toBoardId: "B", fromKeys: ["budget", "deps", "secret_home_note", "description"] });
    expect(next.budget).toBe(7);
    expect(next.refs).toEqual(["t-readable", "t-hidden"]);
    expect(next.description).toBe("shared body");
    expect(next[CONNECT_KEYS_META]).toEqual(["refs"]);
    const lists = next[LISTS_NS] as Record<string, Record<string, unknown>>;
    expect(lists.B).toBeUndefined();
    expect(lists.A).toEqual({ budget: 100, deps: ["t-readable", "t-hidden"], secret_home_note: "home only", [CONNECT_KEYS_META]: ["deps"] });
    expect(lists.C).toEqual({ stage: "x" });
    expect("secret_home_note" in next).toBe(false);
  });
  it("is today's move exactly when the task was not in the target", () => {
    const next = swapNamespacesOnMove(stored, { fromBoardId: "A", toBoardId: "Z", fromKeys: ["budget"] });
    expect(next).toEqual(stored);
  });
});

describe("keepNamespacesFor", () => {
  it("keeps only the named Lists' namespaces", () => {
    expect(keepNamespacesFor(stored, ["C"])[LISTS_NS]).toEqual({ C: { stage: "x" } });
    expect(LISTS_NS in keepNamespacesFor(stored, [])).toBe(false);
  });
});

describe("change detection", () => {
  it("names top-level and per-List changes separately", () => {
    const after = applyMetadataPatch(stored, { top: { description: "edited" }, ns: { budget: 8 }, listId: "B" });
    expect(changedTopLevelKeys(stored, after)).toEqual(["description"]);
    expect(changedListFieldKeys(stored, after)).toEqual({ B: ["budget"] });
  });
});

describe("redactActivityForLinkedReader", () => {
  it("keeps task-level keys, the reader's own List and no List ids on a move", () => {
    const rows = [
      { action: "FIELDS_UPDATED", meta: { fields: ["description", "secret_home_note"], listFields: { B: ["budget"], C: ["stage"] } } },
      { action: "MOVED", meta: { fromBoardId: "A", toBoardId: "D", fromStatus: "TO_DO", toStatus: "TO_DO" } },
      { action: "STATUS_CHANGED", meta: { from: "TO_DO", to: "DONE" } },
    ];
    expect(redactActivityForLinkedReader(rows, "B")).toEqual([
      { action: "FIELDS_UPDATED", meta: { fields: ["description"], listFields: { B: ["budget"] } } },
      { action: "MOVED", meta: { fromBoardId: null, toBoardId: null, fromStatus: "TO_DO", toStatus: "TO_DO" } },
      { action: "STATUS_CHANGED", meta: { from: "TO_DO", to: "DONE" } },
    ]);
  });
});

describe("metadataForCreate", () => {
  const copied = { deps: ["X", "Y"], note: "n", [CONNECT_KEYS_META]: ["deps", "gone"], [LISTS_NS]: { B: { stage: "b" } } };

  it("keeps the connect marker on an untrusted copy, for the keys it still holds", () => {
    // A template or any other server-side copy: the namespace goes, the marker stays.
    const out = metadataForCreate(copied);
    expect(out).toEqual({ deps: ["X", "Y"], note: "n", [CONNECT_KEYS_META]: ["deps"] });
    // So after "deps" is deleted from the List, the ids are still dropped,
    // never sent raw (the leak the stripped marker opened).
    expect(projectRowMetadata(out, { kind: "home", contextStoredKeys: new Set(["note"]), contextConnectKeys: none, readable: none }).metadata).toEqual({ note: "n" });
    expect(stripForUnknownViewer(out)).toEqual({ note: "n" });
  });

  it("drops every other reserved key a caller sends, and a marker naming nothing", () => {
    expect(metadataForCreate({ a: 1, $lists: { B: { x: 1 } }, $other: 2 })).toEqual({ a: 1 });
    expect(metadataForCreate({ a: 1, [CONNECT_KEYS_META]: ["missing"] })).toEqual({ a: 1 });
  });

  it("marks validated connect keys, and keeps a trusted copy verbatim", () => {
    expect(metadataForCreate({ refs: ["Z"], b: 2 }, { validatedConnectKeys: ["refs", "absent"] })).toEqual({ refs: ["Z"], b: 2, [CONNECT_KEYS_META]: ["refs"] });
    const trusted = metadataForCreate(copied, { trusted: true });
    expect(trusted[LISTS_NS]).toEqual({ B: { stage: "b" } });
    expect(trusted[CONNECT_KEYS_META]).toEqual(["deps", "gone"]);
    expect(trusted.deps).toEqual(["X", "Y"]);
  });

  it("never mutates its input", () => {
    const input = { a: 1, [CONNECT_KEYS_META]: ["a"] };
    const snap = JSON.stringify(input);
    metadataForCreate(input, { validatedConnectKeys: ["a"] });
    expect(JSON.stringify(input)).toBe(snap);
  });
});

describe("keepReadableListFields", () => {
  const rows = [
    { action: "FIELDS_UPDATED", meta: { fields: ["budget"], listFields: { B: ["stage"], C: ["owner_note"] } } },
    { action: "FIELDS_UPDATED", meta: { fields: [], listFields: { C: ["owner_note"] } } },
    { action: "FIELDS_UPDATED", meta: { fields: ["budget"] } },
    { action: "MOVED", meta: { fromBoardId: "A", toBoardId: "B" } },
  ];

  it("names only the Lists this reader can read, for every reader", () => {
    expect(activityListFieldIds(rows).sort()).toEqual(["B", "C"]);
    const out = keepReadableListFields(rows, new Set(["B"]));
    expect(out[0].meta).toEqual({ fields: ["budget"], listFields: { B: ["stage"] } });
    // A row that only named an unreadable List reads exactly as it did before Phase 5b.
    expect(out[1].meta).toEqual({ fields: [] });
    expect(out[2]).toBe(rows[2]);
    // A home move keeps its List ids for a home reader, as before Phase 5b.
    expect(out[3]).toBe(rows[3]);
    expect(JSON.stringify(out)).not.toContain("owner_note");
  });

  it("does not mutate the stored rows", () => {
    const snap = JSON.stringify(rows);
    keepReadableListFields(rows, new Set());
    expect(JSON.stringify(rows)).toBe(snap);
  });
});

