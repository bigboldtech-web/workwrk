import { describe, expect, it } from "vitest";
import {
  AXIS_IDS,
  FIELD_ID_PREFIX,
  RESERVED_FIELD_KEYS,
  RULE_FIELD_IDS,
  TABLE_COLUMN_IDS,
  TASK_METADATA_KEYS,
  TASK_STRIP_IDS,
  axisIdOf,
  fieldKeyOfId,
  freeFieldKey,
  isReservedFieldKey,
  ruleFieldIdOf,
  slugifyFieldLabel,
  stripFieldIdOf,
  tableColumnIdOf,
} from "./field-keys";
import { BUILTIN_COLUMNS, slugifyFieldKey } from "./field-catalog";
import { ITEM_FIELD_ORDER } from "./item-fields";
import { CONNECT_KEYS_META, LISTS_NS, TASK_LEVEL_METADATA_KEYS } from "./list-metadata";
import { BUILTIN_FILTER_FIELDS } from "./dashboards/widgets";

const SLUG = /^[a-z0-9_]+$/;

describe("the key rule", () => {
  it("keeps an ordinary label's slug", () => {
    expect(freeFieldKey("Vendor", [])).toBe("vendor");
    expect(freeFieldKey("Sprint Points", [])).toBe("sprint_points");
    expect(freeFieldKey("  Budget (USD) ", [])).toBe("budget_usd");
  });

  it("never gives a new field the Assignee column's key", () => {
    expect(freeFieldKey("Owner", [])).toBe("owner_2");
    expect(freeFieldKey("owner", [])).toBe("owner_2");
    expect(freeFieldKey("OWNER!", [])).toBe("owner_2");
  });

  it("resolves a reserved slug exactly as a duplicate label", () => {
    expect(freeFieldKey("Notes", ["notes"])).toBe("notes_2");
    expect(freeFieldKey("Owner", ["owner_2"])).toBe("owner_3");
    expect(freeFieldKey("Owner", ["owner_2", "owner_3"])).toBe("owner_4");
  });

  it("skips the key of every built-in column, rule field, axis and strip field", () => {
    const builtins = [...TABLE_COLUMN_IDS, ...RULE_FIELD_IDS, ...AXIS_IDS, ...TASK_STRIP_IDS];
    for (const id of builtins) {
      const key = freeFieldKey(id, []);
      expect(isReservedFieldKey(key), `${id} -> ${key}`).toBe(false);
      expect(builtins as readonly string[]).not.toContain(key);
    }
  });

  it("never shares a slot with the task's own metadata", () => {
    expect(freeFieldKey("Description", [])).toBe("description_2");
    expect(freeFieldKey("Checklist", [])).toBe("checklist_2");
    expect(freeFieldKey("Watchers", [])).toBe("watchers_2");
    expect(freeFieldKey("Followers", [])).toBe("followers_2");
    for (const k of TASK_METADATA_KEYS) expect(freeFieldKey(k, [])).not.toBe(k);
  });

  it("never answers the plain-object prototype key", () => {
    expect(freeFieldKey("Constructor", [])).toBe("constructor_2");
  });

  it("always answers a slug a surface can hold", () => {
    for (const label of ["Owner", "Due", "Type", "Name", "$lists", "__builtin_owner", "field:owner", "", "!!!", "Ünïcode"]) {
      const key = freeFieldKey(label, []);
      expect(key, label).toMatch(SLUG);
      expect(isReservedFieldKey(key), label).toBe(false);
    }
    expect(freeFieldKey("", [])).toBe("field");
    expect(slugifyFieldLabel("$lists")).toBe("lists");
  });

  it("caps the slug at 40 characters before the suffix", () => {
    const long = "a".repeat(60);
    expect(freeFieldKey(long, [])).toBe("a".repeat(40));
    expect(freeFieldKey(long, ["a".repeat(40)])).toBe(`${"a".repeat(40)}_2`);
  });

  it("is the rule the field routes use (field-catalog slugifyFieldKey)", () => {
    expect(slugifyFieldKey("Owner", [])).toBe("owner_2");
    expect(slugifyFieldKey("Notes", ["notes"])).toBe("notes_2");
  });
});

describe("the reserved keys", () => {
  it("reserves the storage keys, the underscore ids and the id prefix", () => {
    expect(isReservedFieldKey(LISTS_NS)).toBe(true);
    expect(isReservedFieldKey(CONNECT_KEYS_META)).toBe(true);
    expect(isReservedFieldKey("$anything")).toBe(true);
    expect(isReservedFieldKey("__builtin_owner")).toBe(true);
    expect(isReservedFieldKey("__none__")).toBe(true);
    expect(isReservedFieldKey("field:owner")).toBe(true);
    expect(isReservedFieldKey("vendor")).toBe(false);
    expect(isReservedFieldKey("owner_2")).toBe(false);
  });

  it("covers every key the task keeps at the top of its metadata", () => {
    for (const k of TASK_LEVEL_METADATA_KEYS) expect(RESERVED_FIELD_KEYS.has(k), k).toBe(true);
  });

  // The lists live here so ONE helper holds them; these keep them equal to
  // the lists each surface renders from, so a new built-in cannot be missed.
  it("matches the table's built-in columns (field-catalog BUILTIN_COLUMNS)", () => {
    // The "__soon_*" rows are shelf placeholders with no column yet.
    const fromCatalog = BUILTIN_COLUMNS
      .filter((c) => c.key === "__name" || c.key.startsWith("__builtin_"))
      .map((c) => (c.key === "__name" ? "name" : c.key.replace(/^__builtin_/, "")));
    expect(new Set(fromCatalog)).toEqual(new Set(TABLE_COLUMN_IDS));
  });

  it("matches the task page's field strip (item-fields ITEM_FIELD_ORDER)", () => {
    expect([...TASK_STRIP_IDS]).toEqual([...ITEM_FIELD_ORDER]);
  });

  it("matches the dashboard filter's built-ins (widgets BUILTIN_FILTER_FIELDS)", () => {
    expect(new Set(RULE_FIELD_IDS)).toEqual(new Set(BUILTIN_FILTER_FIELDS));
  });
});

describe("reading an older key by source", () => {
  it("keeps a key that clashes with nothing, so saved view settings still apply", () => {
    for (const idOf of [tableColumnIdOf, ruleFieldIdOf, axisIdOf, stripFieldIdOf]) {
      expect(idOf("vendor")).toBe("vendor");
      expect(idOf("owner_2")).toBe("owner_2");
    }
  });

  it("gives a clashing key an id no built-in has", () => {
    expect(tableColumnIdOf("owner")).toBe("field:owner");
    expect(tableColumnIdOf("status")).toBe("field:status");
    expect(ruleFieldIdOf("assignee")).toBe("field:assignee");
    expect(ruleFieldIdOf("title")).toBe("field:title");
    expect(axisIdOf("priority")).toBe("field:priority");
    expect(stripFieldIdOf("tags")).toBe("field:tags");
    for (const id of TABLE_COLUMN_IDS) expect(TABLE_COLUMN_IDS as readonly string[]).not.toContain(tableColumnIdOf(id));
    for (const id of RULE_FIELD_IDS) expect(RULE_FIELD_IDS as readonly string[]).not.toContain(ruleFieldIdOf(id));
    for (const id of AXIS_IDS) expect(AXIS_IDS as readonly string[]).not.toContain(axisIdOf(id));
    for (const id of TASK_STRIP_IDS) expect(TASK_STRIP_IDS as readonly string[]).not.toContain(stripFieldIdOf(id));
  });

  it("only namespaces what clashes on that surface", () => {
    // "owner" is a table column but not a rule field; "title" the reverse.
    expect(ruleFieldIdOf("owner")).toBe("owner");
    expect(tableColumnIdOf("title")).toBe("title");
    expect(stripFieldIdOf("owner")).toBe("owner");
  });

  it("turns every id back into exactly the stored key", () => {
    const keys = ["owner", "status", "vendor", "tags", "description", "field:odd", "field:field:odder", "a_b_2"];
    for (const idOf of [tableColumnIdOf, ruleFieldIdOf, axisIdOf, stripFieldIdOf]) {
      for (const k of keys) expect(fieldKeyOfId(idOf(k)), k).toBe(k);
      // Distinct keys never share an id.
      expect(new Set(keys.map(idOf)).size).toBe(keys.length);
    }
    expect(fieldKeyOfId(`${FIELD_ID_PREFIX}owner`)).toBe("owner");
    expect(fieldKeyOfId("vendor")).toBe("vendor");
  });

  it("keeps the built-in and an older same-key field apart on one List", () => {
    // A List made before the rule: a custom field keyed "owner" beside the
    // built-in Assignee column. Their column ids differ, so a cell write for
    // one can never be routed to the other.
    const columns = ["name", "owner", tableColumnIdOf("owner"), tableColumnIdOf("vendor")];
    expect(new Set(columns).size).toBe(columns.length);
    expect(fieldKeyOfId(tableColumnIdOf("owner"))).toBe("owner");
  });
});
