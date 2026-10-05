import { describe, expect, it } from "vitest";
import { isUploadRequest } from "./tab-workspace";

const ORIGIN = "https://app.workwrk.com";

describe("isUploadRequest", () => {
  it("matches this app's two upload routes, however the request names them", () => {
    expect(isUploadRequest("/api/upload", ORIGIN)).toBe(true);
    expect(isUploadRequest("/api/uploads/presign", ORIGIN)).toBe(true);
    expect(isUploadRequest(`${ORIGIN}/api/upload`, ORIGIN)).toBe(true);
    expect(isUploadRequest(new URL("/api/upload", ORIGIN), ORIGIN)).toBe(true);
  });

  it("leaves every other request alone", () => {
    for (const url of ["/api/files", "/api/uploads/file-x.pdf", "/api/upload/x", "https://elsewhere.example/api/upload", "/api/uploadx"]) {
      expect(isUploadRequest(url, ORIGIN)).toBe(false);
    }
  });
});
