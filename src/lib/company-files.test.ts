import { beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(() => vi.stubEnv("NEXTAUTH_SECRET", "test-secret-for-upload-stamps"));
import { ownedDiskNames, ownedS3Prefixes } from "./company-files";
import { ownedStoredFile } from "./trash";
import { uploadStamp } from "./upload-stamp";

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
  // Stamped names, as /api/upload writes them for USER (src/lib/upload-stamp.ts).
  const ID = "0123456789abcdef01234567";
  const key = (org: string, user: string) => `orgs/${org}/files/2026-10-05/${ID}-${uploadStamp(org, user, ID)}.pdf`;
  const disk = (org: string, user: string) => `file-${org}-${ID}-${uploadStamp(org, user, ID)}.pdf`;

  it("frees an S3 key only under the company's files/ prefix, stamped for the row's own uploader", () => {
    expect(ownedStoredFile(ORG, null, key(ORG, USER), USER)).toEqual({ kind: "s3", key: key(ORG, USER) });
    expect(ownedStoredFile(ORG, `https://bucket.s3.amazonaws.com/${key(ORG, USER)}?X-Amz-Signature=1`, null, USER)).toEqual({ kind: "s3", key: key(ORG, USER) });
    // A copy registered by someone else: the stamp is not theirs.
    expect(ownedStoredFile(ORG, null, key(ORG, USER), "someone-else")).toBeNull();
    // Another company's, or stamped for another company.
    expect(ownedStoredFile(ORG, null, key(OTHER, USER), USER)).toBeNull();
    expect(ownedStoredFile(ORG, null, `orgs/${ORG}/files/2026-10-05/${ID}-${uploadStamp(OTHER, USER, ID)}.pdf`, USER)).toBeNull();
    // Older uploads, Scribe screenshots and unstamped names are left.
    expect(ownedStoredFile(ORG, null, `orgs/${ORG}/notes/2026-10-05/x.pdf`, USER)).toBeNull();
    expect(ownedStoredFile(ORG, null, `orgs/${ORG}/scribe/2026-10-05/${ID}.jpg`, USER)).toBeNull();
    expect(ownedStoredFile(ORG, null, `orgs/${ORG}/files/2026-10-05/${ID}.pdf`, USER)).toBeNull();
    expect(ownedStoredFile(ORG, null, key(ORG, USER), null)).toBeNull();
  });

  it("frees a disk name only when it carries the company's id and the uploader's stamp", () => {
    expect(ownedStoredFile(ORG, `/api/uploads/${disk(ORG, USER)}`, null, USER)).toEqual({ kind: "local", name: disk(ORG, USER) });
    expect(ownedStoredFile(ORG, `/api/uploads/${disk(ORG, USER)}`, null, "someone-else")).toBeNull();
    expect(ownedStoredFile(ORG, `/api/uploads/${disk(OTHER, USER)}`, null, USER)).toBeNull();
    expect(ownedStoredFile(ORG, `/api/uploads/file-${ORG}-${ID}.pdf`, null, USER)).toBeNull();
    expect(ownedStoredFile(ORG, `/api/uploads/logo-${ORG}-1790000000000.png`, null, USER)).toBeNull();
    expect(ownedStoredFile(ORG, "/api/uploads/file-0123456789abcdef01234567.pdf", null, USER)).toBeNull();
    expect(ownedStoredFile(ORG, "/api/uploads/..%2f..%2fsecret", null, USER)).toBeNull();
  });
});
