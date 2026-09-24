import { describe, expect, it } from "vitest";
import { fileAnswerInOrg, keepOrgFiles, validFieldMappingsInput, validFieldsInput, type FormField } from "./fields";

const ORG = "org_acme";

describe("fileAnswerInOrg", () => {
  it("takes this org's own object-store key", () => {
    expect(fileAnswerInOrg({ name: "cv.pdf", url: "https://s3.example/x", s3Key: `orgs/${ORG}/notes/2026-09-23/a.pdf` }, ORG)).toBe(true);
  });
  it("refuses another tenant's key, however the url is dressed", () => {
    expect(fileAnswerInOrg({ name: "x", url: "https://s3.example/x", s3Key: "orgs/SOMEOTHERORG/notes/secret.pdf" }, ORG)).toBe(false);
    expect(fileAnswerInOrg({ name: "x", url: "/api/uploads/a.pdf", s3Key: `orgs/${ORG}x/notes/a.pdf` }, ORG)).toBe(false);
    expect(fileAnswerInOrg({ name: "x", url: "https://s3.example/x", s3Key: `orgs/${ORG}/../OTHER/a.pdf` }, ORG)).toBe(false);
  });
  it("takes a local upload link with no key, and refuses an outside link", () => {
    expect(fileAnswerInOrg({ name: "a", url: "/api/uploads/a.pdf", s3Key: null }, ORG)).toBe(true);
    expect(fileAnswerInOrg({ name: "a", url: "https://evil.example/x", s3Key: null }, ORG)).toBe(false);
    expect(fileAnswerInOrg({ name: "a", url: "/api/uploads/../../etc", s3Key: null }, ORG)).toBe(false);
  });
});

describe("keepOrgFiles", () => {
  const fields: FormField[] = [
    { id: "f", type: "file", label: "CV" },
    { id: "t", type: "short_text", label: "Name" },
  ];
  it("drops every file entry that is not this org's upload and leaves other answers alone", () => {
    const out = keepOrgFiles(fields, {
      t: "Ada",
      f: [
        { name: "mine.pdf", url: "https://s3.example/m", s3Key: `orgs/${ORG}/notes/d/m.pdf` },
        { name: "theirs.pdf", url: "https://s3.example/t", s3Key: "orgs/SOMEOTHERORG/notes/secret.pdf" },
        { name: "outside", url: "https://evil.example/x" },
      ],
    }, ORG);
    expect(out.t).toBe("Ada");
    expect((out.f as Array<{ name: string }>).map((x) => x.name)).toEqual(["mine.pdf"]);
  });
  it("leaves a required file empty when nothing survives, so the required check still refuses it", () => {
    const out = keepOrgFiles(fields, { f: [{ name: "x", url: "https://evil.example/x" }] }, ORG);
    expect(out.f).toEqual([]);
  });
});

describe("validFieldsInput", () => {
  it("takes fields with an id and a type", () => {
    const f = [{ id: "a", type: "short_text", label: "Name" }, { id: "b", type: "select", options: ["x"] }];
    expect(validFieldsInput(f)).toBe(f);
    expect(validFieldsInput([])).toEqual([]);
  });
  it("refuses junk entries instead of storing them", () => {
    expect(validFieldsInput([5])).toBeNull();
    expect(validFieldsInput([null])).toBeNull();
    expect(validFieldsInput([{ type: "short_text" }])).toBeNull();
    expect(validFieldsInput([{ id: "a" }])).toBeNull();
    expect(validFieldsInput([{ id: "a", type: "short_text", label: 7 }])).toBeNull();
    expect(validFieldsInput([{ id: "a", type: "select", options: "x" }])).toBeNull();
    expect(validFieldsInput("nope")).toBeNull();
  });
});

describe("validFieldMappingsInput", () => {
  it("takes the builder's shape", () => {
    expect(validFieldMappingsInput({ board: { f1: "status" }, table: { f2: "c1" } })).toEqual({ board: { f1: "status" }, table: { f2: "c1" } });
    expect(validFieldMappingsInput({})).toEqual({});
    expect(validFieldMappingsInput({ board: { f1: "" } })).toEqual({ board: {} });
  });
  it("refuses an array, a number or nested junk", () => {
    expect(validFieldMappingsInput([1, 2])).toBeNull();
    expect(validFieldMappingsInput(5)).toBeNull();
    expect(validFieldMappingsInput({ board: [1] })).toBeNull();
    expect(validFieldMappingsInput({ board: { f1: 3 } })).toBeNull();
    expect(validFieldMappingsInput({ other: {} })).toBeNull();
  });
});
