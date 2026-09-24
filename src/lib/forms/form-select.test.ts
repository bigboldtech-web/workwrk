import { describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma";
import { FORM_HAS_SETTINGS_COLUMN, FORM_SELECT } from "./form-select";

describe("the responder's FormDefinition select", () => {
  it("selects settings exactly when the column exists, so form settings can never be silently ignored", () => {
    const hasColumn = "settings" in Prisma.FormDefinitionScalarFieldEnum;
    expect(FORM_HAS_SETTINGS_COLUMN).toBe(hasColumn);
    expect("settings" in FORM_SELECT).toBe(hasColumn);
  });
  it("selects every column a responder door reads", () => {
    for (const k of ["id", "organizationId", "name", "description", "fields", "isPublic", "targetBoardId", "targetTableId", "fieldMappings", "createdById"]) {
      expect(FORM_SELECT).toHaveProperty(k, true);
    }
  });
});
