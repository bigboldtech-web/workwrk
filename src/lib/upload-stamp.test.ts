import { afterEach, describe, expect, it, vi } from "vitest";
import { stampOf, uploadStamp, uploadedBy } from "./upload-stamp";

const ID = "0123456789abcdef01234567";
afterEach(() => vi.unstubAllEnvs());

describe("upload stamps", () => {
  it("proves who uploaded a file for which company, in both name shapes", () => {
    vi.stubEnv("NEXTAUTH_SECRET", "s1");
    const stamp = uploadStamp("org1", "user1", ID)!;
    expect(stamp).toMatch(/^[a-f0-9]{16}$/);
    for (const stored of [`orgs/org1/files/2026-10-05/${ID}-${stamp}.pdf`, `file-org1-${ID}-${stamp}.pdf`, `file-org1-${ID}-${stamp}`]) {
      expect(stampOf(stored)).toEqual({ id: ID, stamp });
      expect(uploadedBy("org1", "user1", stored)).toBe(true);
      expect(uploadedBy("org1", "user2", stored)).toBe(false);
      expect(uploadedBy("org2", "user1", stored)).toBe(false);
    }
  });

  it("fails closed: no secret, another secret, a forged or missing stamp", () => {
    vi.stubEnv("NEXTAUTH_SECRET", "s1");
    const stored = `file-org1-${ID}-${uploadStamp("org1", "user1", ID)}.pdf`;
    vi.stubEnv("NEXTAUTH_SECRET", "s2");
    expect(uploadedBy("org1", "user1", stored)).toBe(false);
    vi.stubEnv("NEXTAUTH_SECRET", "");
    expect(uploadStamp("org1", "user1", ID)).toBeNull();
    expect(uploadedBy("org1", "user1", stored)).toBe(false);
    vi.stubEnv("NEXTAUTH_SECRET", "s1");
    expect(uploadedBy("org1", "user1", `file-org1-${ID}-0000000000000000.pdf`)).toBe(false);
    expect(uploadedBy("org1", "user1", `file-org1-${ID}.pdf`)).toBe(false);
    expect(stampOf(`orgs/org1/notes/2026-10-05/${ID}.pdf`)).toBeNull();
    expect(uploadStamp("org1", "user1", "not-an-id")).toBeNull();
  });
});
