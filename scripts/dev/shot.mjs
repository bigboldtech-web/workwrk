import { homedir } from "node:os";
import { existsSync as __e, readdirSync as __r } from "node:fs";
// Authenticated screenshot harness for the WorkwrK UI refresh.
// Usage: node shot.mjs <out.png> <path> [width] [height] [cookieFile]
//   cookieFile: a file whose content is the next-auth session token value.
// Drives the system Chrome headless over CDP with Node's native WebSocket,
// injects the session cookie, navigates, waits for network idle, screenshots.

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [outFile, path = "/today", width = "1440", height = "900", cookieFile = "session.cookie"] = process.argv.slice(2);
const BASE = process.env.BASE || "http://localhost:3007";
// The browser: $CHROME if set, else the Chrome app, else the newest
// chrome-headless-shell under ~/.cache/chrome-headless (installed with
// "npx @puppeteer/browsers install chrome-headless-shell@stable --path
// ~/.cache/chrome-headless"). The Chrome app vanished once mid-update and
// took every screenshot in every running walk with it.
const CHROME = (() => {
  const app = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (process.env.CHROME && __e(process.env.CHROME)) return process.env.CHROME;
  if (__e(app)) return app;
  const root = join(homedir(), ".cache", "chrome-headless", "chrome-headless-shell");
  try {
    const builds = __r(root).sort().reverse();
    for (const b of builds) {
      const dir = join(root, b);
      for (const sub of __r(dir)) {
        const bin = join(dir, sub, "chrome-headless-shell");
        if (__e(bin)) return bin;
      }
    }
  } catch {}
  return app;
})();
const PORT = 9333 + Math.floor(Math.random() * 500);
const token = (() => { try { return readFileSync(cookieFile, "utf8").trim(); } catch { return ""; } })();

const profile = mkdtempSync(join(tmpdir(), "wk-shot-"));
const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, `--window-size=${width},${height}`, "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitForChrome() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) return await r.json(); } catch {}
    await sleep(250);
  }
  throw new Error("chrome did not start");
}

let id = 0; const pending = new Map(); const events = [];
function rpc(ws, method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const msgId = ++id; pending.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params, sessionId }));
  });
}

try {
  const { webSocketDebuggerUrl } = await waitForChrome();
  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.reject(new Error(JSON.stringify(d.error))) : p.resolve(d.result); }
    else if (d.method) events.push(d);
  };
  const { targetId } = await rpc(ws, "Target.createTarget", { url: "about:blank" });
  const { sessionId } = await rpc(ws, "Target.attachToTarget", { targetId, flatten: true });
  await rpc(ws, "Page.enable", {}, sessionId);
  await rpc(ws, "Network.enable", {}, sessionId);
  // Runtime and Log have to be ENABLED or Runtime.exceptionThrown and
  // Log.entryAdded never arrive, and the "exceptions" number below is an
  // unconditional 0 that proves nothing.
  await rpc(ws, "Runtime.enable", {}, sessionId);
  await rpc(ws, "Log.enable", {}, sessionId);
  await rpc(ws, "Emulation.setDeviceMetricsOverride", { width: +width, height: +height, deviceScaleFactor: 1, mobile: false }, sessionId);
  if (token) {
    await rpc(ws, "Network.setCookie", { name: "next-auth.session-token", value: token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" }, sessionId);
  }
  await rpc(ws, "Page.navigate", { url: BASE + path }, sessionId);
  // Wait for load, then let client hydration and fetches settle.
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) { if (events.some((e) => e.method === "Page.loadEventFired")) break; await sleep(100); }
  await sleep(Number(process.env.SETTLE || 4000));
  // Dismiss the onboarding tour and the cookie banner so the chrome is visible
  // (both are overlays the audit already flagged; they are not what we test).
  if (!process.env.KEEP_OVERLAYS) {
    const dismiss = `(() => { let n = 0; for (const b of document.querySelectorAll("button")) { const t = (b.textContent || "").trim(); if (t === "Skip tour" || t === "Reject all" || t === "Skip" ) { b.click(); n++; } } return n; })()`;
    const { result: d1 } = await rpc(ws, "Runtime.evaluate", { expression: dismiss, returnByValue: true }, sessionId);
    if (d1.value > 0) { await sleep(800); await rpc(ws, "Runtime.evaluate", { expression: dismiss, returnByValue: true }, sessionId); await sleep(600); }
  }
  // The EVAL result is PRINTED, not discarded. A copy of this harness that
  // ran the expression and threw the answer away made every "click this and
  // tell me what happened" probe report nothing at all.
  if (process.env.EVAL) { const ev = await rpc(ws, "Runtime.evaluate", { expression: process.env.EVAL, awaitPromise: true, returnByValue: true }, sessionId); console.error("EVALRESULT:" + JSON.stringify(ev.result?.value ?? ev.exceptionDetails?.exception?.description ?? ev.result?.description ?? null)); await sleep(Number(process.env.EVAL_SETTLE || 1200)); }
  const { result: urlRes } = await rpc(ws, "Runtime.evaluate", { expression: "location.href", returnByValue: true }, sessionId);
  const { data } = await rpc(ws, "Page.captureScreenshot", { format: "png", captureBeyondViewport: false }, sessionId);
  writeFileSync(outFile, Buffer.from(data, "base64"));
  const thrown = events
    .filter((e) => e.method === "Runtime.exceptionThrown")
    .map((e) => e.params?.exceptionDetails?.exception?.description ?? e.params?.exceptionDetails?.text ?? "exception");
  const consoleErrors = events
    .filter((e) => e.method === "Runtime.consoleAPICalled" && e.params?.type === "error")
    .map((e) => (e.params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300));
  console.log(JSON.stringify({
    out: outFile, finalUrl: urlRes.value, bytes: data.length,
    exceptions: thrown.length, exceptionText: thrown.slice(0, 5),
    consoleErrors: consoleErrors.length, consoleErrorText: consoleErrors.slice(0, 5),
  }));
  ws.close();
} finally {
  chrome.kill("SIGKILL");
}
