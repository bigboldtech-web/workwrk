import { describe, expect, it } from "vitest";
import {
  ARCHIVE_PREFIX,
  DEFAULT_TRASH_DAYS,
  TRASH_TYPES,
  archiveRowId,
  csvCell,
  daysLeft,
  idsFromParam,
  isExpiringSoon,
  parseRowId,
  retentionDays,
  sortFromParam,
  tabFromParam,
  trashCsv,
  typeFromParam,
  typesFromParam,
  typeKeyFor,
} from "./trash-view";

/**
 * The `TrashType` union in src/lib/trash.ts, which is what moveToTrash() can
 * write into `TrashItem.entityType`. Copied rather than imported because that
 * file pulls in prisma and the s3 client, and this suite runs without either.
 * If the union grows, this list is what fails first.
 */
const WRITTEN_ENTITY_TYPES = [
  "note", "sop", "whiteboard", "table", "file", "policy", "contract",
  "space", "folder", "board", "item",
] as const;

describe("the trash type table", () => {
  it("carries the thirteen types the Filter panel lists, including Form and Contract", () => {
    expect(TRASH_TYPES.map((t) => t.key)).toEqual([
      "space", "folder", "list", "task",
      "doc", "canvas", "table", "form", "file",
      "sop", "policy", "contract", "template",
    ]);
  });

  it("claims every entityType src/lib/trash.ts can write, so no deleted row is unnameable", () => {
    for (const entityType of WRITTEN_ENTITY_TYPES) {
      expect(typeKeyFor(entityType), entityType).not.toBeNull();
    }
  });

  it("uses the naming canon: List not Board, Canvas not Whiteboard, Task not Item", () => {
    expect(typeKeyFor("board")).toBe("list");
    expect(typeKeyFor("whiteboard")).toBe("canvas");
    expect(typeKeyFor("item")).toBe("task");
    expect(typeKeyFor("note")).toBe("doc");
  });

  it("returns null for a word no type claims rather than guessing", () => {
    expect(typeKeyFor("spaceship")).toBeNull();
  });
});

describe("?type=", () => {
  it("accepts the key the page writes", () => {
    expect(typeFromParam("doc")).toBe("doc");
    expect(typeFromParam("contract")).toBe("contract");
  });

  it("accepts the stored entity word, so /trash?type=board and ?type=whiteboard still land", () => {
    expect(typeFromParam("board")).toBe("list");
    expect(typeFromParam("whiteboard")).toBe("canvas");
    expect(typeFromParam("note")).toBe("doc");
  });

  it("shows everything for all, empty and unknown", () => {
    expect(typeFromParam("all")).toBeNull();
    expect(typeFromParam("")).toBeNull();
    expect(typeFromParam(null)).toBeNull();
    expect(typeFromParam("nonsense")).toBeNull();
  });
});

describe("?type= as a list", () => {
  // Filtering more than one type used to happen in the BROWSER, over the 40
  // rows the page was holding, so the footer printed the unfiltered total and
  // matching rows on later pages never appeared at all.
  it("reads a comma list", () => {
    expect(typesFromParam("space,file")).toEqual(["space", "file"]);
    expect(typesFromParam("space,list,task")).toEqual(["space", "list", "task"]);
  });

  it("keeps every single-value link working, including the retired words", () => {
    expect(typesFromParam("doc")).toEqual(["doc"]);
    expect(typesFromParam("board")).toEqual(["list"]);
    expect(typesFromParam("whiteboard")).toEqual(["canvas"]);
  });

  it("is empty for absent, all and unknown, which means every type", () => {
    expect(typesFromParam(null)).toEqual([]);
    expect(typesFromParam("")).toEqual([]);
    expect(typesFromParam("all")).toEqual([]);
    expect(typesFromParam("nonsense")).toEqual([]);
  });

  it("drops duplicates and unknown members rather than the whole list", () => {
    expect(typesFromParam("doc,note,doc")).toEqual(["doc"]);
    expect(typesFromParam("space,nonsense,task")).toEqual(["space", "task"]);
  });
});

describe("?tab= and ?sort=", () => {
  it("defaults to the Deleted tab and the newest-first sort", () => {
    expect(tabFromParam(null)).toBe("deleted");
    expect(tabFromParam("junk")).toBe("deleted");
    expect(tabFromParam("archived")).toBe("archived");
    expect(sortFromParam(null)).toBe("recent");
    expect(sortFromParam("expiry")).toBe("expiry");
    expect(sortFromParam("name")).toBe("name");
  });
});

describe("retention", () => {
  it("defaults to 60 days when the org has not set one", () => {
    expect(retentionDays(undefined)).toBe(DEFAULT_TRASH_DAYS);
    expect(retentionDays(null)).toBe(60);
    expect(retentionDays("sixty")).toBe(60);
  });

  it("never lets a stored zero or a negative purge on the day of deletion", () => {
    expect(retentionDays(0)).toBe(1);
    expect(retentionDays(-5)).toBe(1);
  });

  it("honours a real setting", () => {
    expect(retentionDays(30)).toBe(30);
    expect(retentionDays(14.4)).toBe(14);
  });
});

describe("daysLeft", () => {
  const now = new Date("2026-09-19T12:00:00.000Z");

  it("counts whole days remaining", () => {
    expect(daysLeft("2026-09-19T12:00:00.000Z", 60, now)).toBe(60);
    expect(daysLeft("2026-08-20T12:00:00.000Z", 60, now)).toBe(30);
  });

  it("floors at zero rather than going negative", () => {
    expect(daysLeft("2026-01-01T00:00:00.000Z", 60, now)).toBe(0);
  });

  it("treats an unparseable date as freshly deleted rather than as expired", () => {
    expect(daysLeft("not a date", 60, now)).toBe(60);
  });

  it("marks under a week as expiring soon, and an archive (null) never", () => {
    expect(isExpiringSoon(6)).toBe(true);
    expect(isExpiringSoon(7)).toBe(false);
    expect(isExpiringSoon(null)).toBe(false);
  });
});

describe("the row id scheme", () => {
  it("reads a bare cuid as a TrashItem snapshot", () => {
    expect(parseRowId("cmu7gilmu00083yxpih5yu9gv")).toEqual({
      archive: null,
      snapshotId: "cmu7gilmu00083yxpih5yu9gv",
    });
  });

  it("keeps the three legacy prefixes working", () => {
    expect(parseRowId("doc:abc").archive).toEqual({ prefix: "doc", type: "doc", id: "abc" });
    expect(parseRowId("wb:abc").archive).toEqual({ prefix: "wb", type: "canvas", id: "abc" });
    expect(parseRowId("agr:abc").archive).toEqual({ prefix: "agr", type: "contract", id: "abc" });
  });

  it("adds the four archived container and task prefixes", () => {
    expect(parseRowId("space:s1").archive?.type).toBe("space");
    expect(parseRowId("folder:f1").archive?.type).toBe("folder");
    expect(parseRowId("board:b1").archive?.type).toBe("list");
    expect(parseRowId("item:i1").archive?.type).toBe("task");
  });

  it("does not mistake a colon inside an unknown prefix for an archive", () => {
    expect(parseRowId("nope:abc").archive).toBeNull();
    expect(parseRowId("nope:abc").snapshotId).toBe("nope:abc");
  });

  it("round-trips every prefix", () => {
    for (const prefix of Object.keys(ARCHIVE_PREFIX)) {
      const id = archiveRowId(prefix, "x1");
      expect(parseRowId(id).archive?.id).toBe("x1");
    }
  });
});

describe("the CSV", () => {
  it("quotes every cell and doubles an embedded quote", () => {
    expect(csvCell('a "b" c')).toBe('"a ""b"" c"');
  });

  it("drops Time left on the Archived tab, because an archive never expires", () => {
    const row = {
      name: "Q4 leads",
      type: "List",
      location: "Sales",
      deletedByName: "Priya",
      deletedAt: "2026-09-01",
      timeLeft: "42 days",
    };
    expect(trashCsv([row], "deleted").split("\r\n")[0]).toContain("Time left");
    expect(trashCsv([row], "archived").split("\r\n")[0]).not.toContain("Time left");
    expect(trashCsv([row], "archived").split("\r\n")[0]).toContain("Archived by");
  });

  it("ends with a newline and uses CRLF between rows", () => {
    const out = trashCsv([], "deleted");
    expect(out.endsWith("\r\n")).toBe(true);
  });
});

describe("idsFromParam", () => {
  it("reads a comma list, so a Filter panel's checkboxes reach the server", () => {
    expect(idsFromParam("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("trims and drops blanks rather than sending an empty id", () => {
    expect(idsFromParam(" a , , b ")).toEqual(["a", "b"]);
  });

  it("absent means EVERY one of them, never none", () => {
    expect(idsFromParam(null)).toEqual([]);
    expect(idsFromParam("")).toEqual([]);
    expect(idsFromParam(undefined)).toEqual([]);
  });
});
