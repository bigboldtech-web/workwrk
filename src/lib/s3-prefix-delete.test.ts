import { beforeEach, describe, expect, it, vi } from "vitest";

// deleteObjectsWithPrefix: DeleteObjects answers 200 even when some keys fail
// (they are listed under Errors). Those must not be counted as deleted, and
// the call must throw once every page is done, so the purge script stops
// before it deletes the rows that name the company.
const pages: { Contents: { Key: string }[]; IsTruncated?: boolean; NextContinuationToken?: string }[] = [];
const failing = new Set<string>();
const deleted: string[] = [];

vi.mock("@aws-sdk/client-s3", () => {
  class Cmd { constructor(readonly input: Record<string, unknown>) {} }
  class ListObjectsV2Command extends Cmd {}
  class DeleteObjectsCommand extends Cmd {}
  class S3Client {
    async send(cmd: Cmd) {
      if (cmd instanceof ListObjectsV2Command) return pages.shift() ?? { Contents: [] };
      if (cmd instanceof DeleteObjectsCommand) {
        const keys = ((cmd.input.Delete as { Objects: { Key: string }[] }).Objects).map((o) => o.Key);
        const errors = keys.filter((k) => failing.has(k)).map((Key) => ({ Key, Code: "InternalError" }));
        deleted.push(...keys.filter((k) => !failing.has(k)));
        return errors.length ? { Errors: errors } : {};
      }
      return {};
    }
  }
  return { S3Client, ListObjectsV2Command, DeleteObjectsCommand, GetObjectCommand: Cmd, PutObjectCommand: Cmd, DeleteObjectCommand: Cmd };
});
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: async () => "" }));

import { deleteObjectsWithPrefix } from "./s3";

beforeEach(() => {
  pages.length = 0;
  failing.clear();
  deleted.length = 0;
  vi.stubEnv("S3_ACCESS_KEY_ID", "k");
  vi.stubEnv("S3_SECRET_ACCESS_KEY", "s");
  vi.stubEnv("S3_BUCKET", "b");
  vi.stubEnv("S3_REGION", "r");
});

describe("deleteObjectsWithPrefix", () => {
  it("counts every object deleted across pages", async () => {
    pages.push({ Contents: [{ Key: "orgs/o1/files/a" }, { Key: "orgs/o1/files/b" }], IsTruncated: true, NextContinuationToken: "t" });
    pages.push({ Contents: [{ Key: "orgs/o1/files/c" }] });
    await expect(deleteObjectsWithPrefix("orgs/o1/files/")).resolves.toBe(3);
    expect(deleted).toEqual(["orgs/o1/files/a", "orgs/o1/files/b", "orgs/o1/files/c"]);
  });

  it("throws, after finishing every page, when some keys were not deleted", async () => {
    pages.push({ Contents: [{ Key: "orgs/o1/files/a" }, { Key: "orgs/o1/files/b" }], IsTruncated: true, NextContinuationToken: "t" });
    pages.push({ Contents: [{ Key: "orgs/o1/files/c" }] });
    failing.add("orgs/o1/files/b");
    await expect(deleteObjectsWithPrefix("orgs/o1/files/")).rejects.toThrow(/1 objects under orgs\/o1\/files\/ could not be deleted \(2 were\)/);
    expect(deleted).toEqual(["orgs/o1/files/a", "orgs/o1/files/c"]);
  });

  it("refuses a prefix that could reach another company's", async () => {
    await expect(deleteObjectsWithPrefix("orgs/o1")).rejects.toThrow(/Refusing/);
  });
});
