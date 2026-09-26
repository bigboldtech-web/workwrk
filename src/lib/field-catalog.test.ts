import { describe, expect, it } from "vitest";
import { CONNECT_CATALOG_ENTRY, FIELD_CATALOG, FIELD_TYPE_BY_KEY, catalogEntryForField } from "./field-catalog";

describe("the field catalog", () => {
  it("defines MIRROR", () => {
    expect(FIELD_TYPE_BY_KEY.MIRROR).toBeDefined();
    expect(FIELD_TYPE_BY_KEY.MIRROR.label).toBe("Mirror");
    expect(FIELD_TYPE_BY_KEY.MIRROR.group).toBe("Advanced");
  });

  it("keeps RELATIONSHIP as the doc-link Relationship entry, never the Connect tile", () => {
    expect(FIELD_TYPE_BY_KEY.RELATIONSHIP.label).toBe("Relationship");
    expect(FIELD_TYPE_BY_KEY.RELATIONSHIP.catalogKey).toBeUndefined();
  });

  it("has a Connect entry that stores a RELATIONSHIP under its own catalog key", () => {
    expect(CONNECT_CATALOG_ENTRY.type).toBe("RELATIONSHIP");
    expect(CONNECT_CATALOG_ENTRY.catalogKey).toBe("CONNECT");
    expect(CONNECT_CATALOG_ENTRY.label).toBe("Connect");
    expect(FIELD_CATALOG).toContain(CONNECT_CATALOG_ENTRY);
  });

  it("keys every tile uniquely by catalogKey, else type", () => {
    const keys = FIELD_CATALOG.map((e) => e.catalogKey ?? e.type);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("marks MIRROR and Connect as needing configuration, and nothing else", () => {
    expect(FIELD_TYPE_BY_KEY.MIRROR.needsConfig).toBe(true);
    expect(CONNECT_CATALOG_ENTRY.needsConfig).toBe(true);
    const configured = FIELD_CATALOG.filter((e) => e.needsConfig).map((e) => e.catalogKey ?? e.type).sort();
    expect(configured).toEqual(["CONNECT", "MIRROR"]);
  });
});

describe("catalogEntryForField", () => {
  it("answers Connect for a RELATIONSHIP that names target Lists, an empty set included", () => {
    expect(catalogEntryForField({ type: "RELATIONSHIP", options: { targetBoardIds: ["b1"] } })).toBe(CONNECT_CATALOG_ENTRY);
    expect(catalogEntryForField({ type: "RELATIONSHIP", options: { targetBoardIds: ["b1"] } })?.label).toBe("Connect");
    // Redaction can leave a connect column with no target the viewer can
    // read; it is still a connect column.
    expect(catalogEntryForField({ type: "RELATIONSHIP", options: { targetBoardIds: [] } })).toBe(CONNECT_CATALOG_ENTRY);
  });

  it("answers the doc-link Relationship entry for a RELATIONSHIP without targets", () => {
    expect(catalogEntryForField({ type: "RELATIONSHIP" })).toBe(FIELD_TYPE_BY_KEY.RELATIONSHIP);
    expect(catalogEntryForField({ type: "RELATIONSHIP", options: {} })).toBe(FIELD_TYPE_BY_KEY.RELATIONSHIP);
  });

  it("answers every other type by its type", () => {
    expect(catalogEntryForField({ type: "NUMBER" })).toBe(FIELD_TYPE_BY_KEY.NUMBER);
    expect(catalogEntryForField({ type: "MIRROR", options: { linkFieldKey: "c" } })?.label).toBe("Mirror");
  });
});
