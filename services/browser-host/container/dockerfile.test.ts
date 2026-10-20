// The browser image, read as text (docs/plans/browser-host.md 5.2 and 5.3;
// step 3 review, M2 and the DevTools address): Google's key trusted by its
// fingerprint alone, and DevTools reached through the image's own relay
// whichever address Chrome binds.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CONTAINER_CHROME_PORT } from "../lib/chrome-args.mjs";
import { DEVTOOLS_PORT } from "../lib/ranges.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const dockerfile = fs.readFileSync(path.join(HERE, "Dockerfile"), "utf8");
const start = fs.readFileSync(path.join(HERE, "wkb-start"), "utf8");
const FPR = "EB4C1BFD4F042F6DDDCCEC917721F63BD38B4796";

describe("the Dockerfile", () => {
  it("imports Google's key file into a keyring of its own and gives apt only the key with the fingerprint", () => {
    const run = dockerfile.slice(dockerfile.indexOf("RUN "));
    const at = (t: string) => {
      const i = run.indexOf(t);
      expect({ t, found: i >= 0 }).toEqual({ t, found: true });
      return i;
    };
    const home = at('export GNUPGHOME="$(mktemp -d)"');
    const imported = at('gpg --batch --quiet --import "$GNUPGHOME/google.asc"');
    const exported = at(`gpg --batch --export ${FPR} > /usr/share/keyrings/google-linux.gpg`);
    const one = at("grep -c '^pub:')\" = 1");
    const sources = at("signed-by=/usr/share/keyrings/google-linux.gpg");
    expect(home < imported && imported < exported && exported < one && one < sources).toBe(true);
    // The downloaded file itself is never the keyring, and a fingerprint found anywhere in it proves nothing.
    expect(dockerfile).not.toContain("--dearmor");
    expect(dockerfile).not.toMatch(/linux_signing_key\.pub \|/);
    expect(run.slice(0, exported)).not.toContain(`grep -q "fpr:`);
  });

  it("installs socat, puts the image's start in place, and keeps the entrypoint of 5.2", () => {
    expect(dockerfile).toMatch(/apt-get install -y --no-install-recommends ca-certificates curl gnupg tini socat \\/);
    expect(dockerfile).toContain("COPY wkb-start /usr/local/bin/wkb-start");
    expect(dockerfile.indexOf("COPY wkb-start")).toBeLessThan(dockerfile.indexOf("USER 10001:10001"));
    expect(dockerfile).toContain('ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/usr/bin/timeout", "-s", "KILL"]');
    expect(dockerfile).toContain("rm -f /opt/google/chrome/chrome-sandbox");
  });
});

describe("the image's start", () => {
  it("relays the container's 9222 to Chrome's DevTools on 127.0.0.1:9223, and runs Chrome with the arguments it was given", () => {
    expect(DEVTOOLS_PORT).toBe(9222);
    expect(CONTAINER_CHROME_PORT).toBe(9223);
    expect(start).toContain(`/usr/bin/socat TCP-LISTEN:${DEVTOOLS_PORT},fork,reuseaddr,max-children=16 TCP:127.0.0.1:${CONTAINER_CHROME_PORT} &`);
    expect(start).toContain('/opt/google/chrome/chrome "$@" &');
    expect(start.startsWith("#!/bin/sh\n")).toBe(true);
  });

  it("ends the other when Chrome or the relay ends, so the container exits", () => {
    expect(start).toContain('while kill -0 "$chrome" 2>/dev/null && kill -0 "$relay" 2>/dev/null; do');
    expect(start).toContain('kill "$chrome" "$relay" 2>/dev/null');
    expect(start).toContain(`trap 'kill "$chrome" "$relay" 2>/dev/null' TERM INT`);
    expect(fs.statSync(path.join(HERE, "wkb-start")).mode & 0o111).not.toBe(0);
  });
});
