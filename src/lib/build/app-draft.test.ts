import { describe, expect, it } from "vitest";
import { blankDraft, draftFromGenerated, draftProblem, slugify, toFieldKey, uniqueFieldKey } from "./app-draft";

describe("New app drafts", () => {
  it("slugs and keys the way the API validates them", () => {
    expect(slugify("Company Vehicles!")).toBe("company-vehicles");
    expect(slugify("   ")).toBe("app");
    expect(toFieldKey("Service date")).toBe("service_date");
    expect(toFieldKey("2nd driver")).toBe("f_2nd_driver");
    expect(uniqueFieldKey("Name", ["name", "name_2"])).toBe("name_3");
  });

  it("repairs what the generator returns", () => {
    const d = draftFromGenerated({
      name: "Vehicles",
      slug: "Not A Slug",
      fields: [
        { key: "plate", label: "Plate", fieldType: "TEXT" },
        { key: "plate", label: "Plate again", fieldType: "WEIRD" },
        { label: "" },
      ],
      sampleRows: [{ plate: "KA01", extra: "x" }, "junk"],
    }, "cars");
    expect(d?.slug).toBe("vehicles");
    expect(d?.fields.map((f) => [f.key, f.fieldType])).toEqual([["plate", "TEXT"], ["plate_again", "TEXT"]]);
    expect(d?.sampleRows).toEqual([{ plate: "KA01" }]);
    expect(draftFromGenerated({ name: "x", fields: [] }, "p")).toBeNull();
    expect(draftFromGenerated(null, "p")).toBeNull();
  });

  it("says what is wrong before anything is sent", () => {
    expect(draftProblem(blankDraft())).toBe("Give the app a name.");
    expect(draftProblem({ ...blankDraft(), name: "Cars", slug: "cars" })).toBeNull();
    expect(draftProblem({ ...blankDraft(), name: "Cars", slug: "Cars!" })).toMatch(/lowercase/);
    expect(draftProblem({ ...blankDraft(), name: "Cars", slug: "cars", fields: [] })).toMatch(/at least one/);
  });
});
