import { describe, expect, it } from "vitest";
import { pickTeammateInBody } from "./teammate-address";

const COS = { slug: "t-cos-abc", name: "Chief of Staff" };
const PM = { slug: "t-pm-def", name: "Project Manager" };

describe("pickTeammateInBody", () => {
  it("asks a picked teammate only while its @Name is in the body", () => {
    expect(pickTeammateInBody("@Chief of Staff sum this up", [COS])).toBe("t-cos-abc");
    expect(pickTeammateInBody("Chief of Staff sum this up", [COS])).toBeUndefined();
    expect(pickTeammateInBody("@Chief of Staffer", [COS])).toBeUndefined();
  });
  it("asks nobody for a name typed without picking it", () => {
    expect(pickTeammateInBody("@Chief of Staff sum this up", [])).toBeUndefined();
  });
  it("asks the first picked teammate still named, one per message", () => {
    expect(pickTeammateInBody("@Project Manager and @Chief of Staff", [COS, PM])).toBe("t-cos-abc");
    expect(pickTeammateInBody("@Project Manager only", [COS, PM])).toBe("t-pm-def");
  });
});
