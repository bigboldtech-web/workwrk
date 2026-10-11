// The live view's address check (src/lib/browser/live-view-origin.ts,
// docs/plans/ai-teammates-phase4.md Decision 19 and step 4): the server's
// check holds the configured origins; the page repeats it before it embeds a
// frame, holding Browserbase's own origin and, outside production only, the
// stand-in on this machine.

import { describe, expect, it } from "vitest";
import { liveViewOriginOk as fromConfig } from "./config";
import { BROWSERBASE_LIVE_VIEW_ORIGIN, liveViewOriginOk, liveViewShownOk } from "./live-view-origin";

const LIVE = "https://www.browserbase.com/devtools-fullscreen/inspector.html?wss=connect.browserbase.com/debug/s1";

describe("liveViewOriginOk (the server's check)", () => {
  it("is the one config.ts gives the provider client", () => {
    expect(fromConfig).toBe(liveViewOriginOk);
  });

  it("takes only the configured origins over https, and the stand-in's over http", () => {
    const cfg = { liveViewOrigins: [BROWSERBASE_LIVE_VIEW_ORIGIN], standIn: false };
    expect(liveViewOriginOk(LIVE, cfg)).toBe(true);
    expect(liveViewOriginOk("http://www.browserbase.com/x", cfg)).toBe(false);
    expect(liveViewOriginOk("https://evil.example.com/x", cfg)).toBe(false);
    expect(liveViewOriginOk("https://u:p@www.browserbase.com/x", cfg)).toBe(false);
    expect(liveViewOriginOk("not a url", cfg)).toBe(false);
    const standIn = { liveViewOrigins: ["http://127.0.0.1:8789"], standIn: true };
    expect(liveViewOriginOk("http://127.0.0.1:8789/live/s1?t=abc", standIn)).toBe(true);
    expect(liveViewOriginOk("http://127.0.0.1:8790/live/s1", standIn)).toBe(false);
  });
});

describe("liveViewShownOk (the page repeats it, step 4)", () => {
  it("embeds Browserbase's own live view, over https only, with no user name or password", () => {
    for (const production of [true, false]) {
      expect(liveViewShownOk(LIVE, { production })).toBe(true);
      expect(liveViewShownOk("http://www.browserbase.com/x", { production })).toBe(false);
      expect(liveViewShownOk("https://www.browserbase.com.evil.example/x", { production })).toBe(false);
      expect(liveViewShownOk("https://max:pw@www.browserbase.com/x", { production })).toBe(false);
      expect(liveViewShownOk("javascript:alert(1)", { production })).toBe(false);
      expect(liveViewShownOk("data:text/html,<script>parent.x</script>", { production })).toBe(false);
      expect(liveViewShownOk("", { production })).toBe(false);
    }
  });

  it("embeds the stand-in on this machine outside production only, never another host", () => {
    expect(liveViewShownOk("http://127.0.0.1:8789/live/s1?t=abc", { production: false })).toBe(true);
    expect(liveViewShownOk("http://localhost:8789/live/s1", { production: false })).toBe(true);
    expect(liveViewShownOk("http://[::1]:8789/live/s1", { production: false })).toBe(true);
    // Fails without the production rule: a loopback address would be framed in production.
    expect(liveViewShownOk("http://127.0.0.1:8789/live/s1?t=abc", { production: true })).toBe(false);
    expect(liveViewShownOk("http://10.0.0.8:8789/live/s1", { production: false })).toBe(false);
    expect(liveViewShownOk("http://u:p@127.0.0.1:8789/live/s1", { production: false })).toBe(false);
    expect(liveViewShownOk("file:///etc/passwd", { production: false })).toBe(false);
  });
});
