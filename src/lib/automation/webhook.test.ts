import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateSecret, guardedLookup, isPrivateAddress, publicWebhookMeta, readWebhookMeta, signBody, webhookUrlProblem } from "./webhook";

describe("webhookUrlProblem", () => {
  it("accepts a public https address", () => {
    expect(webhookUrlProblem("https://hooks.example.com/workwrk")).toBeNull();
    expect(webhookUrlProblem("http://example.org/in")).toBeNull();
  });

  it("refuses local, private and link-local addresses (the metadata endpoint)", () => {
    for (const u of [
      "http://localhost:3000/x",
      "http://127.0.0.1/x",
      "http://10.0.0.4/x",
      "http://192.168.1.2/x",
      "http://172.20.0.1/x",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]/x",
      "http://intranet/x",
      "http://db.internal/x",
      // IPv6 forms that carry a private IPv4 inside them
      "http://[64:ff9b::7f00:1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://[::ffff:a9fe:a9fe]/",
      "http://[2002:7f00:1::]/",
      "http://[fd00::1]/",
      "http://[fe80::1]/",
      "http://0.0.0.0/",
      "http://100.64.0.1/",
    ]) {
      expect(webhookUrlProblem(u), u).not.toBeNull();
    }
  });

  it("refuses other schemes, credentials and junk", () => {
    expect(webhookUrlProblem("ftp://example.com")).not.toBeNull();
    expect(webhookUrlProblem("https://a:b@example.com")).not.toBeNull();
    expect(webhookUrlProblem("not a url")).not.toBeNull();
  });
});

describe("signing", () => {
  it("signs timestamp.body with the secret, the scheme a receiver re-computes", () => {
    const secret = "whsec_test";
    const expected = createHmac("sha256", secret).update("1700000000.{\"a\":1}").digest("hex");
    expect(signBody(secret, 1700000000, '{"a":1}')).toBe(`sha256=${expected}`);
  });

  it("generates distinct, prefixed secrets", () => {
    const a = generateSecret();
    expect(a.startsWith("whsec_")).toBe(true);
    expect(a).not.toBe(generateSecret());
  });
});

describe("metadata", () => {
  it("never hands the secret to a browser, only its last four characters", () => {
    const meta = readWebhookMeta({ url: "https://x.example", secret: "whsec_abcd1234", lastDeliveryStatus: 200 });
    const pub = publicWebhookMeta(meta);
    expect(pub).not.toHaveProperty("secret");
    expect(pub.secretHint).toBe("1234");
    expect(pub.url).toBe("https://x.example");
  });

  it("reads an older row that only has a url", () => {
    const meta = readWebhookMeta({ url: "https://x.example" });
    expect(meta.secret).toBeNull();
    expect(publicWebhookMeta(meta).secretHint).toBeNull();
  });
});

describe("isPrivateAddress", () => {
  it("reads private ranges in every spelling and leaves public ones alone", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "::1", "::ffff:10.0.0.1", "64:ff9b::a00:1", "fc00::1", "224.0.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "64:ff9b::808:808"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });
});

describe("guardedLookup", () => {
  it("refuses a name that resolves to a private address, at connect time", async () => {
    // "localhost" resolves without a network; any name that resolves to a
    // loopback or private address takes this same path.
    const err = await new Promise<NodeJS.ErrnoException | null>((resolve) => {
      guardedLookup("localhost", {}, (e) => resolve(e));
    });
    expect(err?.code).toBe("EWEBHOOKPRIVATE");
  });
});
