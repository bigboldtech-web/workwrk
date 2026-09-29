import { describe, expect, it } from "vitest";
import { inSurveyAudience, surveyOpenNow } from "./survey-audience";

const base = { audienceType: "ALL", officeIds: [], departmentIds: [], userIds: [], tagIds: [] };
const v = { userId: "u1", officeId: "o1", departmentId: "d1", tagIds: ["t1"] };

describe("inSurveyAudience", () => {
  it("ALL targets everyone", () => expect(inSurveyAudience(base, v)).toBe(true));
  it("each scoped audience needs its own match", () => {
    expect(inSurveyAudience({ ...base, audienceType: "OFFICES", officeIds: ["o1"] }, v)).toBe(true);
    expect(inSurveyAudience({ ...base, audienceType: "OFFICES", officeIds: ["o2"] }, v)).toBe(false);
    expect(inSurveyAudience({ ...base, audienceType: "DEPARTMENTS", departmentIds: ["d1"] }, v)).toBe(true);
    expect(inSurveyAudience({ ...base, audienceType: "USERS", userIds: ["u2"] }, v)).toBe(false);
    expect(inSurveyAudience({ ...base, audienceType: "TAGS", tagIds: ["t1", "t9"] }, v)).toBe(true);
  });
  it("a person with no office or department is never matched by those audiences", () => {
    const none = { ...v, officeId: null, departmentId: null };
    expect(inSurveyAudience({ ...base, audienceType: "OFFICES", officeIds: ["o1"] }, none)).toBe(false);
    expect(inSurveyAudience({ ...base, audienceType: "DEPARTMENTS", departmentIds: ["d1"] }, none)).toBe(false);
  });
  it("an unknown audience type targets nobody", () => {
    expect(inSurveyAudience({ ...base, audienceType: "EVERYONE_ELSE" }, v)).toBe(false);
  });
});

describe("surveyOpenNow", () => {
  const now = new Date("2026-09-26T12:00:00Z");
  it("only ACTIVE surveys before their close date are open", () => {
    expect(surveyOpenNow({ status: "ACTIVE", closesAt: null }, now)).toBe(true);
    expect(surveyOpenNow({ status: "ACTIVE", closesAt: "2026-09-27T00:00:00Z" }, now)).toBe(true);
    expect(surveyOpenNow({ status: "ACTIVE", closesAt: "2026-09-26T11:59:59Z" }, now)).toBe(false);
    expect(surveyOpenNow({ status: "DRAFT", closesAt: null }, now)).toBe(false);
    expect(surveyOpenNow({ status: "CLOSED", closesAt: null }, now)).toBe(false);
  });
});
