// The enterprise extension's manager, in the shapes identity providers send
// it (docs/plans/workspace-status-2.md E9 i, step 7). Pure.

import { describe, expect, it } from "vitest";
import { ENTERPRISE_USER_SCHEMA, managerAskOfOperation, managerAskOfResource, managerValueOf, userToScim } from "./scim-mappers";

const EXT = "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User";
const set = (value: string) => ({ kind: "set", value });
const clear = { kind: "clear" };

describe("the manager a value names", () => {
  it("reads the complex attribute, a bare id, a list of one, and an employee number", () => {
    expect(managerValueOf({ value: "dana", displayName: "Dana Ng", $ref: "https://x/Users/dana" })).toEqual(set("dana"));
    expect(managerValueOf(" dana ")).toEqual(set("dana"));
    expect(managerValueOf([{ value: "dana" }])).toEqual(set("dana"));
    expect(managerValueOf(40213)).toEqual(set("40213"));
    // Attribute names are case-insensitive (RFC 7643 2.1).
    expect(managerValueOf({ Value: "dana" })).toEqual(set("dana"));
  });

  it("clears on null, an empty string, an empty list or an empty value; asks nothing of a displayName alone", () => {
    for (const v of [null, "", "  ", [], { value: null }, { value: "" }]) expect(managerValueOf(v), JSON.stringify(v)).toEqual(clear);
    // A provider that maps the manager's name and not their id must never take the line off.
    expect(managerValueOf({ displayName: "Dana Ng" })).toBeUndefined();
    expect(managerValueOf(true)).toBeUndefined();
    expect(managerValueOf(undefined)).toBeUndefined();
  });
});

describe("the manager a resource names (POST, PUT, a PATCH value with no path)", () => {
  it("reads the extension, in any case, and its flat forms", () => {
    expect(managerAskOfResource({ [EXT]: { manager: { value: "dana" } } })).toEqual(set("dana"));
    expect(managerAskOfResource({ [EXT.toUpperCase()]: { Manager: { value: "dana" } } })).toEqual(set("dana"));
    expect(managerAskOfResource({ [`${EXT}:manager`]: "dana" })).toEqual(set("dana"));
    expect(managerAskOfResource({ [`${EXT}:manager.value`]: "dana" })).toEqual(set("dana"));
    expect(managerAskOfResource({ manager: { value: "dana" } })).toEqual(set("dana"));
    expect(managerAskOfResource({ [EXT]: { manager: null } })).toEqual(clear);
  });

  it("asks nothing when the manager is left out, so a full PUT never clears it", () => {
    expect(managerAskOfResource({ userName: "pat@x.test", name: { givenName: "Pat" } })).toBeUndefined();
    expect(managerAskOfResource({ [EXT]: { employeeNumber: "7", department: "Ops" } })).toBeUndefined();
    expect(managerAskOfResource({ [EXT]: { manager: { displayName: "Dana Ng" } } })).toBeUndefined();
    expect(managerAskOfResource(null)).toBeUndefined();
  });
});

describe("what one PATCH operation asks of the manager", () => {
  it("add and replace set it, by the extension's paths, the bare paths, the extension itself or no path", () => {
    expect(managerAskOfOperation({ op: "Add", path: `${EXT}:manager`, value: "dana" })).toEqual(set("dana"));
    expect(managerAskOfOperation({ op: "replace", path: `${EXT}:manager`, value: { value: "dana" } })).toEqual(set("dana"));
    expect(managerAskOfOperation({ op: "replace", path: `${EXT}:manager.value`, value: "dana" })).toEqual(set("dana"));
    expect(managerAskOfOperation({ op: "replace", path: "manager.value", value: "dana" })).toEqual(set("dana"));
    expect(managerAskOfOperation({ op: "replace", path: EXT, value: { manager: { value: "dana" } } })).toEqual(set("dana"));
    expect(managerAskOfOperation({ op: "replace", value: { active: true, [EXT]: { manager: { value: "dana" } } } })).toEqual(set("dana"));
  });

  it("remove clears it whatever value it carries; a null or empty value clears it; no value at all asks nothing", () => {
    expect(managerAskOfOperation({ op: "Remove", path: `${EXT}:manager` })).toEqual(clear);
    expect(managerAskOfOperation({ op: "remove", path: `${EXT}:manager`, value: [{ value: "dana" }] })).toEqual(clear);
    expect(managerAskOfOperation({ op: "remove", path: "manager.value" })).toEqual(clear);
    expect(managerAskOfOperation({ op: "remove", path: EXT })).toEqual(clear);
    expect(managerAskOfOperation({ op: "replace", path: `${EXT}:manager`, value: null })).toEqual(clear);
    expect(managerAskOfOperation({ op: "replace", path: `${EXT}:manager.value`, value: "" })).toEqual(clear);
    expect(managerAskOfOperation({ op: "replace", path: `${EXT}:manager` })).toBeUndefined();
  });

  it("leaves every other operation alone", () => {
    expect(managerAskOfOperation({ op: "replace", path: "active", value: false })).toBeUndefined();
    expect(managerAskOfOperation({ op: "replace", path: `${EXT}:department`, value: "Ops" })).toBeUndefined();
    expect(managerAskOfOperation({ op: "remove", path: "title" })).toBeUndefined();
    expect(managerAskOfOperation({ op: "remove" })).toBeUndefined();
    expect(managerAskOfOperation({ op: "move", path: `${EXT}:manager`, value: "dana" })).toBeUndefined();
  });
});

describe("the resource names the manager as a reference to their SCIM id", () => {
  const base = { id: "pat", email: "pat@x.test", firstName: "Pat", lastName: "Ng", status: "ACTIVE", createdAt: new Date(0), updatedAt: new Date(0) };

  it("adds the extension and its schema only when there is a manager to name", () => {
    const named = userToScim({ ...base, manager: { id: "dana", displayName: "Dana Ng" } });
    expect(ENTERPRISE_USER_SCHEMA).toBe(EXT);
    expect(named.schemas).toEqual(["urn:ietf:params:scim:schemas:core:2.0:User", EXT]);
    expect(named[EXT]).toEqual({ manager: { value: "dana", displayName: "Dana Ng" } });
    const none = userToScim({ ...base, manager: null });
    expect(none.schemas).toEqual(["urn:ietf:params:scim:schemas:core:2.0:User"]);
    expect(none).not.toHaveProperty(EXT);
  });
});
