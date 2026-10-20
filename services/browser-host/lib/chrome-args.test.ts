import { describe, expect, it } from "vitest";

import { FORBIDDEN_FLAGS, PROOF_ONLY_FLAG } from "../forbidden-flags";
import { chromeArgs } from "./chrome-args.mjs";

const VIEW = { width: 1280, height: 800 };
const every = [
  chromeArgs({ mode: "container", proof: false, viewport: VIEW, profile: "/home/chrome/profile" }),
  chromeArgs({ mode: "process", proof: false, viewport: VIEW, profile: "/s/profiles/a" }),
  chromeArgs({ mode: "process", proof: false, viewport: VIEW, profile: "/s/profiles/a", headlessShell: true }),
  chromeArgs({ mode: "process", proof: true, viewport: VIEW, profile: "/s/profiles/a", fixturePort: 18790 }),
];

describe("chromeArgs (5.3)", () => {
  it("never holds a forbidden flag, in any mode", () => {
    for (const args of every) for (const f of FORBIDDEN_FLAGS) expect(args.some((a) => a === f || a.startsWith(`${f}=`))).toBe(false);
  });

  it("holds the fixture resolver rules in proof mode only", () => {
    const [container, plain, shell, proof] = every;
    for (const args of [container, plain, shell]) expect(args.some((a) => a.startsWith(PROOF_ONLY_FLAG))).toBe(false);
    expect(proof.filter((a) => a.startsWith(PROOF_ONLY_FLAG))).toEqual([`${PROOF_ONLY_FLAG}=MAP *.proof.test 127.0.0.1:18790, MAP * ~NOTFOUND, EXCLUDE 127.0.0.1`]);
  });

  it("turns the back/forward cache off in every mode, as one comma-joined flag", () => {
    for (const args of every) {
      const features = args.filter((a) => a.startsWith("--disable-features="));
      expect(features).toHaveLength(1);
      expect(features[0].split("=")[1].split(",")).toEqual(expect.arrayContaining(["BackForwardCache", "Translate", "MediaRouter"]));
    }
    expect(every[3].find((a) => a.startsWith("--disable-features="))).toBe("--disable-features=BackForwardCache,Translate,MediaRouter,HttpsUpgrades,HttpsFirstBalancedModeAutoEnable");
    expect(every[0].find((a) => a.startsWith("--disable-features="))).toBe("--disable-features=BackForwardCache,Translate,MediaRouter");
  });

  it("takes the window size from the viewport", () => {
    expect(chromeArgs({ mode: "process", proof: false, viewport: { width: 1024, height: 640 }, profile: "/p" })).toContain("--window-size=1024,640");
    for (const args of every) expect(args).toContain("--window-size=1280,800");
  });

  it("denies permission prompts, and keeps Safe Browsing and component updates on in container mode", () => {
    for (const args of every) expect(args).toContain("--deny-permission-prompts");
    expect(every[0]).not.toContain("--disable-component-update");
    expect(every[0]).not.toContain("--disable-background-networking");
    // Chrome on loopback inside the container, behind the image's socat relay on 9222 (container/wkb-start).
    expect(every[0]).toEqual(expect.arrayContaining(["--headless=new", "--remote-debugging-port=9223", "--remote-debugging-address=127.0.0.1"]));
    expect(every[0].some((a) => a.includes("0.0.0.0"))).toBe(false);
  });

  it("process mode: DevTools on 127.0.0.1 and a port Chrome picks, headless unless the binary is chrome-headless-shell", () => {
    expect(every[1]).toEqual(expect.arrayContaining(["--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1", "--headless=new"]));
    expect(every[2]).not.toContain("--headless=new");
    expect(every[1]).toContain("--user-data-dir=/s/profiles/a");
  });
});
