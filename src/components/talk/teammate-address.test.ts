import { describe, expect, it } from "vitest";
import { pickTeammateInBody, picksStillNamed } from "./teammate-address";

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
  it("asks the picked teammate named first, one per message", () => {
    expect(pickTeammateInBody("@Project Manager and @Chief of Staff", [COS, PM])).toBe("t-pm-def");
    expect(pickTeammateInBody("@Project Manager only", [COS, PM])).toBe("t-pm-def");
  });
});

describe("which teammate a message asks (review round 1)", () => {
  const PM = { slug: "t-pm", name: "PM" };
  const LEAD = { slug: "t-lead", name: "PM Lead" };
  const COS = { slug: "t-cos", name: "Chief of Staff" };

  it("reads @PM Lead as PM Lead, never as PM", () => {
    expect(pickTeammateInBody("@PM Lead what is late?", [PM, LEAD])).toBe("t-lead");
    expect(pickTeammateInBody("@PM what is late?", [PM, LEAD])).toBe("t-pm");
  });

  it("asks the one named first", () => {
    expect(pickTeammateInBody("@Chief of Staff and @PM, sum up", [PM, COS])).toBe("t-cos");
  });

  it("forgets picks the draft no longer names, and every pick once it is empty", () => {
    expect(picksStillNamed("@PM Lead go", [PM, LEAD])).toEqual([PM, LEAD]);
    expect(picksStillNamed("go", [PM, LEAD])).toEqual([]);
    expect(picksStillNamed("@Chief of Staff go", [PM, COS])).toEqual([COS]);
    expect(picksStillNamed("   ", [COS])).toEqual([]);
  });
});
