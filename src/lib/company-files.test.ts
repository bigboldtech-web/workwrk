import { describe, expect, it } from "vitest";
import { ownedDiskNames, ownedS3Prefixes } from "./company-files";
import { ownedStoredFile } from "./trash";

const ORG = "cmabc0000000000000000org1";
const OTHER = "cmabc0000000000000000org2";
const USER = "cmabc000000000000000user1";

describe("ownedDiskNames", () => {
  it("keeps only names written with this company's id or its people's", () => {
    const names = [
      `file-${ORG}-a1b2.pdf`,
      `logo-${ORG}-1790000000000.png`,
      `avatar-${USER}-1790000000000.jpg`,
      `file-${OTHER}-c3d4.pdf`,
      `logo-${OTHER}-1.png`,
      "file-0123456789abcdef01234567.pdf", // from before names carried the id: untraceable
      `.file-${ORG}-hidden`,
      `../file-${ORG}-x`,
    ];
    expect(ownedDiskNames(names, ORG, [USER])).toEqual([`file-${ORG}-a1b2.pdf`, `logo-${ORG}-1790000000000.png`, `avatar-${USER}-1790000000000.jpg`]);
  });
  it("owns nothing without an id", () => {
    expect(ownedDiskNames([`file--x.pdf`, "avatar--1.png"], "", [""])).toEqual([]);
  });
});

describe("ownedS3Prefixes", () => {
  it("frees only the prefixes stamped with the company the file was for, never orgs/<id>/ whole", () => {
    expect(ownedS3Prefixes(ORG)).toEqual([`orgs/${ORG}/files/`, `orgs/${ORG}/scribe/`]);
    // orgs/<id>/notes/ named the uploader's home workspace: it can hold a live company's files.
    expect(ownedS3Prefixes(ORG).some((p) => `orgs/${ORG}/notes/2026-10-01/x.pdf`.startsWith(p))).toBe(false);
    expect(ownedS3Prefixes(ORG).some((p) => `orgs/${ORG}x/files/a.pdf`.startsWith(p))).toBe(false);
  });
  it("owns nothing without a plain id", () => {
    expect(ownedS3Prefixes("")).toEqual([]);
    expect(ownedS3Prefixes("a/../b")).toEqual([]);
  });
});

describe("ownedStoredFile", () => {
  it("trusts an S3 key only under the company's own prefix", () => {
    expect(ownedStoredFile(ORG, null, `orgs/${ORG}/notes/2026-10-05/x.pdf`)).toEqual({ kind: "s3", key: `orgs/${ORG}/notes/2026-10-05/x.pdf` });
    expect(ownedStoredFile(ORG, null, `orgs/${OTHER}/notes/x.pdf`)).toBeNull();
    expect(ownedStoredFile(ORG, null, "legacy/x.pdf")).toBeNull();
    expect(ownedStoredFile(ORG, `https://bucket.s3.amazonaws.com/orgs/${OTHER}/x.pdf?X-Amz-Signature=1`)).toBeNull();
    expect(ownedStoredFile(ORG, `https://bucket.s3.amazonaws.com/orgs/${ORG}/x.pdf`)).toEqual({ kind: "s3", key: `orgs/${ORG}/x.pdf` });
  });
  it("trusts a disk name only when it carries the company's id", () => {
    expect(ownedStoredFile(ORG, `/api/uploads/file-${ORG}-a1.pdf`)).toEqual({ kind: "local", name: `file-${ORG}-a1.pdf` });
    expect(ownedStoredFile(ORG, `/api/uploads/file-${OTHER}-a1.pdf`)).toBeNull();
    expect(ownedStoredFile(ORG, "/api/uploads/file-0123456789abcdef01234567.pdf")).toBeNull();
    expect(ownedStoredFile(ORG, "/api/uploads/..%2f..%2fsecret")).toBeNull();
  });
});
