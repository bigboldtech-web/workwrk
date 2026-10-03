import { describe, expect, it } from "vitest";
import { chunkIds, matchPeople, mergePeople, pickPersonName, pickUrl, type PickPerson } from "./people-pick";

const p = (id: string, firstName: string, lastName: string, email: string): PickPerson => ({ id, firstName, lastName, email, avatar: null });
const lea = p("u-lea", "Lea", "Alpha", "lea.alpha@mechwalk-test.com");
const leo = p("u-leo", "Leo", "Beta", "leo.beta@mechwalk-test.com");
const max = p("u-max", "Max", "Manager", "max.manager@mechwalk-test.com");

describe("pickUrl", () => {
  it("asks for the whole company, self included, active people by default", () => {
    expect(pickUrl({})).toBe("/api/people/pick?includeSelf=1&limit=50");
  });
  it("asks for everyone who can sign in, managers only, a search, a limit", () => {
    expect(pickUrl({ reach: "signin", managersOnly: true, q: " lea ", limit: 30, includeSelf: false })).toBe("/api/people/pick?reach=signin&managers=1&limit=30&q=lea");
  });
  it("a filter's picker asks for reach=all", () => {
    expect(pickUrl({ reach: "all" })).toBe("/api/people/pick?includeSelf=1&reach=all&limit=50");
  });
  it("a label lookup asks by id alone", () => {
    expect(pickUrl({ ids: ["a", "b"], reach: "signin", q: "x" })).toBe("/api/people/pick?ids=a%2Cb");
  });
});

describe("matchPeople", () => {
  it("every word must match a name or the email, in any order, in name order", () => {
    expect(matchPeople([max, leo, lea], "le").map((x) => x.id)).toEqual(["u-lea", "u-leo"]);
    expect(matchPeople([max, leo, lea], "alpha lea").map((x) => x.id)).toEqual(["u-lea"]);
    expect(matchPeople([max, leo, lea], "max.manager@").map((x) => x.id)).toEqual(["u-max"]);
    expect(matchPeople([max, leo, lea], "Lea Beta")).toEqual([]);
  });
  it("an empty search shows everyone read so far", () => {
    expect(matchPeople([max, leo, lea], "  ").map((x) => x.id)).toEqual(["u-lea", "u-leo", "u-max"]);
  });
});

describe("mergePeople and chunkIds", () => {
  it("merges by id, the newest copy kept", () => {
    const m = mergePeople(new Map([["u-lea", lea]]), [{ ...lea, lastName: "Alpha-Renamed" }, leo]);
    expect([...m.keys()]).toEqual(["u-lea", "u-leo"]);
    expect(pickPersonName(m.get("u-lea")!)).toBe("Lea Alpha-Renamed");
  });
  it("chunks ids by 50", () => {
    const ids = Array.from({ length: 120 }, (_, i) => `u${i}`);
    expect(chunkIds(ids).map((c) => c.length)).toEqual([50, 50, 20]);
  });
});
