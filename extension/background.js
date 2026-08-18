// Screenshot capture + the single serialized writer for the recorded steps.
//
// Step writes all flow through one promise chain: content scripts send
// appendStep / patchStepScreenshot and never touch storage themselves, so a
// click racing a navigation (or two tabs recording at once) can no longer
// interleave get→push→set and drop each other's steps.
let stepWrites = Promise.resolve();

function enqueueStepWrite(fn) {
  const run = stepWrites.then(fn);
  stepWrites = run.catch(() => {}); // keep the chain alive after a failure
  return run;
}

function captureVisible(windowId, cb) {
  try {
    chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 50 }, (dataUrl) => {
      const err = chrome.runtime.lastError;
      cb(dataUrl || null, err ? err.message : null);
    });
  } catch (e) {
    cb(null, String((e && e.message) || e));
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "captureScreenshot") {
    // Capture the window the requesting tab lives in — passing null grabs
    // the last-focused window, which may be a different one entirely.
    const windowId = sender.tab?.windowId;
    if (windowId == null) {
      sendResponse({ screenshot: null, error: "No sender tab" });
      return;
    }
    captureVisible(windowId, (dataUrl, error) => {
      if (dataUrl) { sendResponse({ screenshot: dataUrl }); return; }
      // captureVisibleTab is quota-limited (~2/sec) — retry once after backoff
      if (error && /MAX_CAPTURE_VISIBLE_TAB|per second/i.test(error)) {
        setTimeout(() => {
          captureVisible(windowId, (d2, e2) => sendResponse({ screenshot: d2, error: e2 }));
        }, 600);
        return;
      }
      sendResponse({ screenshot: null, error });
    });
    return true; // Keep message channel open for async response
  }

  if (msg.action === "appendStep") {
    enqueueStepWrite(async () => {
      const { steps = [] } = await chrome.storage.local.get(["steps"]);
      steps.push(msg.step);
      await chrome.storage.local.set({ steps });
    }).then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
    return true;
  }

  if (msg.action === "patchStepScreenshot") {
    enqueueStepWrite(async () => {
      const { steps = [] } = await chrome.storage.local.get(["steps"]);
      const step = steps.find((s) => s && s.id === msg.id);
      if (!step) return; // saved + cleared before the screenshot resolved
      step.screenshot = msg.screenshot;
      await chrome.storage.local.set({ steps });
    }).then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
    return true;
  }

  if (msg.action === "flushSteps") {
    // Barrier for the popup's Stop handler: resolves only after every write
    // already queued (a click landed just before Stop) has hit storage, so
    // the popup never snapshots a steps array that is about to grow.
    enqueueStepWrite(async () => {}).then(
      () => sendResponse({ ok: true }),
      () => sendResponse({ ok: false }),
    );
    return true;
  }

  if (msg.action === "setStepScreenshotKeys") {
    // Popup persists uploaded S3 keys so a save retry reuses them instead of
    // re-uploading; the base64 payload is dropped once the key is safe.
    // Serialized here so a late screenshot patch can't be clobbered.
    enqueueStepWrite(async () => {
      const keys = msg.keys || {};
      const { steps = [] } = await chrome.storage.local.get(["steps"]);
      let changed = false;
      for (const s of steps) {
        if (s && s.id && keys[s.id]) {
          s.screenshotKey = keys[s.id];
          s.screenshot = null;
          changed = true;
        }
      }
      if (changed) await chrome.storage.local.set({ steps });
    }).then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
    return true;
  }
});
