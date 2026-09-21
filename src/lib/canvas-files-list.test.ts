import { describe, expect, it } from "vitest";
import { matchesCanvasFilters, matchesCanvasView, parseCanvasListQuery, sortCanvases, type CanvasCandidate } from "./canvas-list";
import { fileTypeBucket, fileTypeLabel, matchesFilesFilters, matchesFilesView, parseFilesListQuery, sortFiles, type FileCandidate } from "./files-list";
import { sliceByCursor } from "./list-query";

const NOW = new Date("2026-09-21T12:00:00Z");

describe("canvas list", () => {
  const rows: CanvasCandidate[] = [
    { id: "c1", name: "Roadmap", ownerId: "u1", spaceId: null, lastEditedAt: "2026-09-20T10:00:00Z", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-09-20T10:00:00Z", ownerName: "Me" },
    { id: "c2", name: "Arch", ownerId: "u2", spaceId: "s1", lastEditedAt: "2026-05-01T10:00:00Z", createdAt: "2026-02-01T00:00:00Z", updatedAt: "2026-05-01T10:00:00Z", ownerName: "Zed" },
    { id: "c3", name: "brainstorm", description: "ideas", ownerId: "u1", spaceId: "s1", lastEditedAt: null, createdAt: "2026-03-01T00:00:00Z", updatedAt: "2026-09-19T10:00:00Z", ownerName: "Me" },
  ];
  const facts = { userId: "u1", favoriteIds: new Set(["c2"]), now: NOW };

  it("parses with the right defaults", () => {
    const q = parseCanvasListQuery(new URLSearchParams("view=my&sort=name"));
    expect(q.view).toBe("my");
    expect(q.dir).toBe("asc");
    expect(q.paged).toBe(true);
    expect(parseCanvasListQuery(new URLSearchParams("")).paged).toBe(false);
    expect(parseCanvasListQuery(new URLSearchParams("")).sort).toBe("edited");
  });
  it("views", () => {
    expect(rows.filter((r) => matchesCanvasView(r, "recent", facts)).map((r) => r.id)).toEqual(["c1", "c3"]);
    expect(rows.filter((r) => matchesCanvasView(r, "my", facts)).map((r) => r.id)).toEqual(["c1", "c3"]);
    expect(rows.filter((r) => matchesCanvasView(r, "favorites", facts)).map((r) => r.id)).toEqual(["c2"]);
  });
  it("filters by text, owner and location", () => {
    expect(rows.filter((r) => matchesCanvasFilters(r, parseCanvasListQuery(new URLSearchParams("q=ideas")))).map((r) => r.id)).toEqual(["c3"]);
    expect(rows.filter((r) => matchesCanvasFilters(r, parseCanvasListQuery(new URLSearchParams("owner=u2")))).map((r) => r.id)).toEqual(["c2"]);
    expect(rows.filter((r) => matchesCanvasFilters(r, parseCanvasListQuery(new URLSearchParams("location=SPACE:s1")))).map((r) => r.id)).toEqual(["c2", "c3"]);
    expect(rows.filter((r) => matchesCanvasFilters(r, parseCanvasListQuery(new URLSearchParams("location=none")))).map((r) => r.id)).toEqual(["c1"]);
  });
  it("sorts", () => {
    expect(sortCanvases(rows, "edited", "desc").map((r) => r.id)).toEqual(["c1", "c3", "c2"]);
    expect(sortCanvases(rows, "name", "asc").map((r) => r.id)).toEqual(["c2", "c3", "c1"]);
    expect(sortCanvases(rows, "created", "asc").map((r) => r.id)).toEqual(["c1", "c2", "c3"]);
  });
});

describe("files list", () => {
  const rows: FileCandidate[] = [
    { id: "f1", name: "report.pdf", mimeType: "application/pdf", size: 3000, folderId: null, spaceId: null, spaceFolderId: null, uploadedById: "u1", starred: false, createdAt: "2026-09-20T10:00:00Z", updatedAt: "2026-09-20T10:00:00Z" },
    { id: "f2", name: "logo.png", mimeType: "image/png", size: 100, folderId: "fo1", spaceId: null, spaceFolderId: null, uploadedById: "u2", starred: true, createdAt: "2026-01-01T10:00:00Z", updatedAt: "2026-01-01T10:00:00Z" },
    { id: "f3", name: "deck.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", size: 9000, folderId: null, spaceId: "s1", spaceFolderId: "sf1", uploadedById: "u1", starred: false, createdAt: "2026-09-01T10:00:00Z", updatedAt: "2026-09-18T10:00:00Z" },
  ];
  const facts = { favoriteIds: new Set(["f1"]), now: NOW };

  it("buckets mime types", () => {
    expect(fileTypeBucket("image/jpeg")).toBe("images");
    expect(fileTypeBucket("application/pdf")).toBe("pdfs");
    expect(fileTypeBucket("application/zip")).toBe("archives");
    expect(fileTypeBucket("text/csv")).toBe("documents");
    expect(fileTypeBucket("application/octet-stream")).toBe("other");
    expect(fileTypeLabel("video/mp4")).toBe("Video");
  });
  it("parses, honouring the legacy starred=true", () => {
    expect(parseFilesListQuery(new URLSearchParams("starred=true")).view).toBe("starred");
    expect(parseFilesListQuery(new URLSearchParams("folderId=root")).folderId).toBeNull();
    expect(parseFilesListQuery(new URLSearchParams("folderId=abc")).folderId).toBe("abc");
    expect(parseFilesListQuery(new URLSearchParams("type=pdfs")).type).toBe("pdfs");
    expect(parseFilesListQuery(new URLSearchParams("type=bogus")).type).toBeNull();
  });
  it("views: the folder, the union of favorites and the org flag, 30 days, Spaces", () => {
    const root = parseFilesListQuery(new URLSearchParams(""));
    expect(rows.filter((r) => matchesFilesView(r, root, facts)).map((r) => r.id)).toEqual(["f1"]);
    const folder = parseFilesListQuery(new URLSearchParams("folderId=fo1"));
    expect(rows.filter((r) => matchesFilesView(r, folder, facts)).map((r) => r.id)).toEqual(["f2"]);
    const starred = parseFilesListQuery(new URLSearchParams("view=starred"));
    expect(rows.filter((r) => matchesFilesView(r, starred, facts)).map((r) => r.id)).toEqual(["f1", "f2"]);
    const recent = parseFilesListQuery(new URLSearchParams("view=recent"));
    expect(rows.filter((r) => matchesFilesView(r, recent, facts)).map((r) => r.id)).toEqual(["f1", "f3"]);
    const spaces = parseFilesListQuery(new URLSearchParams("view=spaces"));
    expect(rows.filter((r) => matchesFilesView(r, spaces, facts)).map((r) => r.id)).toEqual(["f3"]);
    // A search spans the drive, not the open folder.
    const search = parseFilesListQuery(new URLSearchParams("q=logo"));
    expect(rows.filter((r) => matchesFilesView(r, search, facts) && matchesFilesFilters(r, search)).map((r) => r.id)).toEqual(["f2"]);
  });
  it("filters by type, uploader and range", () => {
    expect(rows.filter((r) => matchesFilesFilters(r, parseFilesListQuery(new URLSearchParams("type=images")))).map((r) => r.id)).toEqual(["f2"]);
    expect(rows.filter((r) => matchesFilesFilters(r, parseFilesListQuery(new URLSearchParams("uploadedBy=u1")))).map((r) => r.id)).toEqual(["f1", "f3"]);
    expect(rows.filter((r) => matchesFilesFilters(r, parseFilesListQuery(new URLSearchParams("from=2026-09-19T00:00:00Z")))).map((r) => r.id)).toEqual(["f1"]);
  });
  it("sorts by name, size, type and upload", () => {
    expect(sortFiles(rows, "name", "asc").map((r) => r.id)).toEqual(["f3", "f2", "f1"]);
    expect(sortFiles(rows, "size", "desc").map((r) => r.id)).toEqual(["f3", "f1", "f2"]);
    expect(sortFiles(rows, "type", "asc").map((r) => r.id)).toEqual(["f3", "f2", "f1"]);
    expect(sortFiles(rows, "uploaded", "desc").map((r) => r.id)).toEqual(["f1", "f3", "f2"]);
  });
});

describe("sliceByCursor", () => {
  it("pages and restarts on an unknown cursor", () => {
    const list = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(sliceByCursor(list, null, 2)).toEqual({ page: [{ id: "a" }, { id: "b" }], nextCursor: "b", from: 0 });
    expect(sliceByCursor(list, "b", 2)).toEqual({ page: [{ id: "c" }], nextCursor: null, from: 2 });
    expect(sliceByCursor(list, "nope", 2).from).toBe(0);
  });
});
