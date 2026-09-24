import { describe, expect, it } from "vitest";
import { ChevronDown } from "lucide-react";
import { COLUMN_TYPE_ICON } from "./column-type-picker";
import { COLUMN_TYPE_CHOICES } from "@/lib/sheet-columns";

describe("COLUMN_TYPE_ICON", () => {
  it("never uses the column menu's ChevronDown as a type glyph", () => {
    // The header draws the type glyph beside the real menu button (a
    // ChevronDown); a matching glyph reads as a second menu that opens nothing.
    for (const [type, Icon] of Object.entries(COLUMN_TYPE_ICON)) {
      expect(Icon, type).not.toBe(ChevronDown);
    }
  });

  it("has a glyph for every pickable column type", () => {
    for (const c of COLUMN_TYPE_CHOICES) {
      expect(COLUMN_TYPE_ICON[c.value], c.value).toBeDefined();
    }
  });
});
