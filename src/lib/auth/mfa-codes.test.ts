import { describe, expect, it } from "vitest";
import { BACKUP_CODE_COUNT, generateBackupCodes, mfaCodeKind, normaliseMfaInput, randomBackupCode } from "./mfa-codes";

describe("mfa codes", () => {
  it("normalises pasted app codes and backup codes the same way everywhere", () => {
    expect(normaliseMfaInput("123 456")).toBe("123456");
    expect(normaliseMfaInput("123-456")).toBe("123456");
    expect(normaliseMfaInput("abcd efgh")).toBe("ABCD-EFGH");
    expect(normaliseMfaInput("abcdefgh")).toBe("ABCD-EFGH");
  });
  it("tells an app code from a backup code", () => {
    expect(mfaCodeKind("123456")).toBe("totp");
    expect(mfaCodeKind("ABCD-EFGH")).toBe("backup");
    expect(mfaCodeKind("12345")).toBe("invalid");
    expect(mfaCodeKind("")).toBe("invalid");
  });
  it("draws backup codes from the unambiguous alphabet", () => {
    for (let i = 0; i < 50; i++) {
      const c = randomBackupCode();
      expect(c).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    }
  });
  it("makes eight distinct codes with matching hashes", async () => {
    const { backupCodes, hashedCodes } = await generateBackupCodes();
    expect(backupCodes).toHaveLength(BACKUP_CODE_COUNT);
    expect(new Set(backupCodes).size).toBe(BACKUP_CODE_COUNT);
    const bcrypt = await import("bcryptjs");
    expect(await bcrypt.compare(backupCodes[0], hashedCodes[0])).toBe(true);
    expect(await bcrypt.compare(backupCodes[1], hashedCodes[0])).toBe(false);
  }, 20000);
});
