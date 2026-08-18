let isRecording = false;
let captureActive = false;
let highlightEl = null;
let lastUrl = window.location.href;

// A click on an SPA link produces a URL change moments later; the pointerdown
// handler already captured that transition, so the nav observer suppresses its
// own "navigate" step inside this window. Navigate steps remain only for
// SAME-DOCUMENT URL changes not preceded by a click (SPA redirects, history
// pushes from timers). Full-page loads re-initialize this script with lastUrl
// already at the new URL, so they never record a navigate step at all.
let lastClickAt = 0;
const CLICK_NAV_SUPPRESS_MS = 2000;

// Clicking a <label> makes the browser fire a synthetic activation on its
// input; two events at the same spot within ~10ms are one user action.
let lastPointer = { t: 0, x: -1, y: -1 };

const EXT_VERSION = "1.3.0";

// Inject detection flag so the web app knows the extension is installed
window.postMessage({ type: "WORKWRK_EXTENSION_INSTALLED", version: EXT_VERSION }, "*");
document.documentElement.setAttribute("data-workwrk-extension", "true");

function newId() {
  try { return crypto.randomUUID(); } catch {}
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Fire-and-forget sendMessage: reading lastError in the callback stops Chrome
// logging "Unchecked runtime.lastError" if the port closed.
function ignoreLastError() { void chrome.runtime.lastError; }

// --- App-origin trust gate ------------------------------------------------
//
// Only a workwrk host, or the origin the user explicitly configured as the
// server URL in the popup, may hand the extension an app origin or start a
// recording. Anything else could repoint uploads at an attacker or record
// the user without consent.
function isWorkwrkHost(hostname) {
  return hostname === "workwrk.com" || hostname.endsWith(".workwrk.com");
}

function isTrustedAppOrigin(origin, serverUrl) {
  try {
    const u = new URL(origin);
    if (isWorkwrkHost(u.hostname)) return true;
    if (serverUrl && new URL(serverUrl).origin === origin) return true;
  } catch {}
  return false;
}

// Messages from the WorkwrK app into the extension.
//
//   WORKWRK_APP_ORIGIN     — learn the app's origin so the popup POSTs
//                            recordings back to the right server. The origin
//                            stored is event.origin (verified by the browser),
//                            never a value from the message payload.
//
//   WORKWRK_START_RECORDING — the app's "Create SOP → Record" flow pushes
//                            title/category/subcategory/description over so
//                            the user doesn't re-type them in the popup.
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  // Only the page itself may talk to us — not embedded frames.
  if (event.origin !== window.location.origin) return;
  const data = event.data;

  if (data?.type === "WORKWRK_APP_ORIGIN") {
    chrome.storage.local.get(["serverUrl"], (r) => {
      if (!isTrustedAppOrigin(event.origin, r.serverUrl)) return;
      chrome.storage.local.set({ workwrkOrigin: event.origin });
    });
    return;
  }

  if (data?.type === "WORKWRK_START_RECORDING" && data.sop && typeof data.sop.title === "string") {
    chrome.storage.local.get(["serverUrl", "workwrkOrigin"], (r) => {
      // Trust the stored handshake origin or anything the gate accepts —
      // the gate also covers the race where START arrives before the
      // APP_ORIGIN write has committed.
      if (event.origin !== r.workwrkOrigin && !isTrustedAppOrigin(event.origin, r.serverUrl)) return;
      const sop = data.sop;
      chrome.storage.local.set({
        isRecording: true,
        steps: [],
        // Idempotency handle: sent as clientSessionId with the save POST so a
        // retry after a lost response can't create a duplicate SOP.
        recordingSessionId: newId(),
        sopTitle: sop.title,
        sopCategory: sop.category || "",
        sopSubcategory: sop.subcategory || "",
        sopDescription: sop.description || "",
      }, () => {
        // Ack for the app page — lets it show "recording started" vs a
        // "extension not installed" fallback hint.
        window.postMessage({ type: "WORKWRK_RECORDING_STARTED" }, window.location.origin);
      });
    });
    return;
  }
});

// Recording state is driven entirely by storage: the start handshake and the
// popup's stop both write isRecording, and every tab (not just the active
// one) picks the change up here.
chrome.storage.local.get(["isRecording"], (result) => {
  if (result.isRecording) startCapture();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.isRecording) return;
  if (changes.isRecording.newValue) startCapture();
  else stopCapture();
});

function startCapture() {
  if (captureActive) return;
  captureActive = true;
  isRecording = true;
  lastUrl = window.location.href;
  document.addEventListener("pointerdown", onPointerDown, true);
  if (document.body) navObserver.observe(document.body, { childList: true, subtree: true });
  showRecordingIndicator();
}

function stopCapture() {
  captureActive = false;
  isRecording = false;
  document.removeEventListener("pointerdown", onPointerDown, true);
  navObserver.disconnect();
  hideRecordingIndicator();
}

// Show a small recording indicator on the page
function showRecordingIndicator() {
  if (document.getElementById("twrk-recording-indicator")) return;

  const indicator = document.createElement("div");
  indicator.id = "twrk-recording-indicator";
  indicator.innerHTML = `
    <span class="twrk-pulse"></span>
    <span>WorkwrK Recording</span>
  `;
  document.body.appendChild(indicator);
}

function hideRecordingIndicator() {
  const el = document.getElementById("twrk-recording-indicator");
  if (el) el.remove();
  if (highlightEl) {
    highlightEl.remove();
    highlightEl = null;
  }
}

// Get a human-readable description of what was clicked — Scribe-style
function getElementDescription(el) {
  // Find the best label for this element
  function findLabel(element) {
    // Check for aria-label
    const ariaLabel = element.getAttribute("aria-label");
    if (ariaLabel) return ariaLabel;
    // Check for associated label
    if (element.id) {
      const label = document.querySelector(`label[for="${element.id}"]`);
      if (label) return label.textContent.trim();
    }
    // Check parent label
    const parentLabel = element.closest("label");
    if (parentLabel) return parentLabel.textContent.trim();
    // Check placeholder
    const placeholder = element.getAttribute("placeholder");
    if (placeholder) return placeholder;
    return null;
  }

  // Button
  if (el.tagName === "BUTTON" || el.closest("button")) {
    const btn = el.tagName === "BUTTON" ? el : el.closest("button");
    const text = btn.textContent.trim().replace(/\s+/g, " ");
    if (text) return `Click on the "${text.slice(0, 60)}" button`;
    return "Click on a button";
  }

  // Link
  if (el.tagName === "A" || el.closest("a")) {
    const link = el.tagName === "A" ? el : el.closest("a");
    const text = link.textContent.trim().replace(/\s+/g, " ");
    if (text) return `Click on the "${text.slice(0, 60)}" link`;
    return "Click on a link";
  }

  // Input / textarea
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
    const label = findLabel(el) || el.getAttribute("name") || "";
    const type = el.type || "text";
    if (type === "checkbox") return `Toggle the "${label || "checkbox"}" checkbox`;
    if (type === "radio") return `Select the "${label || "option"}" radio button`;
    return `Click on the "${label || "text"}" field`;
  }

  // Select / dropdown
  if (el.tagName === "SELECT" || el.closest("[role='listbox']") || el.closest("[role='combobox']")) {
    const label = findLabel(el) || "";
    return `Click on the "${label || "dropdown"}" dropdown`;
  }

  // Menu item / option
  if (el.closest("[role='menuitem']") || el.closest("[role='option']")) {
    const item = el.closest("[role='menuitem']") || el.closest("[role='option']");
    const text = item.textContent.trim().replace(/\s+/g, " ");
    return `Select "${text.slice(0, 60)}" from the menu`;
  }

  // Tab
  if (el.closest("[role='tab']")) {
    const text = el.closest("[role='tab']").textContent.trim();
    return `Click on the "${text}" tab`;
  }

  // Image
  if (el.tagName === "IMG") {
    return `Click on the${el.alt ? ' "' + el.alt.slice(0, 40) + '"' : ""} image`;
  }

  // Heading
  if (/^H[1-6]$/.test(el.tagName)) {
    return `Click on the "${el.textContent.trim().slice(0, 60)}" heading`;
  }

  // Generic element with short text
  const text = el.textContent.trim().replace(/\s+/g, " ");
  if (text && text.length < 60) {
    return `Click on "${text}"`;
  }

  // SVG elements — find nearest meaningful parent
  if (el.tagName === "svg" || el.tagName === "path" || el.tagName === "circle" || el.closest("svg")) {
    const parent = el.closest("button") || el.closest("a") || el.closest("[role='button']") || el.parentElement;
    if (parent && parent !== document.body) {
      const parentText = parent.textContent.trim().replace(/\s+/g, " ");
      if (parentText && parentText.length < 60) return `Click on the "${parentText}" button`;
      const ariaLabel = parent.getAttribute("aria-label") || parent.getAttribute("title");
      if (ariaLabel) return `Click on "${ariaLabel}"`;
    }
    return "Click on an icon";
  }

  // Fallback with tag name
  return `Click on ${el.tagName.toLowerCase()} element`;
}

// Brief subtle click indicator — small dot that fades quickly
function showClickHighlight(x, y) {
  const dot = document.createElement("div");
  dot.style.cssText = `
    position: fixed; top: ${y - 12}px; left: ${x - 12}px;
    width: 24px; height: 24px; border-radius: 50%;
    background: rgba(239, 68, 68, 0.4); border: 2px solid rgba(239, 68, 68, 0.8);
    pointer-events: none; z-index: 2147483646;
    animation: twrk-click-fade 0.6s ease-out forwards;
  `;
  document.body.appendChild(dot);
  setTimeout(() => dot.remove(), 600);
}

// Capture a screenshot and annotate click position
async function captureScreenshot(clickX, clickY) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: "captureScreenshot" }, async (response) => {
      void chrome.runtime.lastError;
      const screenshot = response?.screenshot || null;
      if (!screenshot || clickX == null) { resolve(screenshot); return; }

      // Draw click indicator on the screenshot
      try {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0);

          // Scale click coordinates to screenshot dimensions
          const scaleX = img.width / window.innerWidth;
          const scaleY = img.height / window.innerHeight;
          const sx = clickX * scaleX;
          const sy = clickY * scaleY;

          // Draw red circle at click point
          ctx.beginPath();
          ctx.arc(sx, sy, 18 * scaleX, 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(239, 68, 68, 0.9)";
          ctx.lineWidth = 3 * scaleX;
          ctx.stroke();

          // Draw inner dot
          ctx.beginPath();
          ctx.arc(sx, sy, 5 * scaleX, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(239, 68, 68, 0.9)";
          ctx.fill();

          resolve(canvas.toDataURL("image/jpeg", 0.5));
        };
        img.onerror = () => resolve(screenshot);
        img.src = screenshot;
      } catch { resolve(screenshot); }
    });
  });
}

// Main capture handler. pointerdown (capture phase) fires before the click
// can trigger an SPA route change, so the screenshot shows the page the user
// actually clicked — 'click' fires after navigation and captured the wrong
// page.
function onPointerDown(e) {
  if (!isRecording) return;
  // Synthetic pointer events dispatched by page scripts would inject junk
  // steps into the recording — only real user input counts.
  if (!e.isTrusted) return;
  if (e.button !== 0) return;
  const el = e.target;
  if (!(el instanceof Element)) return;

  // Ignore clicks on our own UI
  if (el.closest("#twrk-recording-indicator")) return;

  const now = Date.now();
  const clickX = e.clientX;
  const clickY = e.clientY;

  if (now - lastPointer.t < 10 && Math.abs(clickX - lastPointer.x) < 3 && Math.abs(clickY - lastPointer.y) < 3) return;
  lastPointer = { t: now, x: clickX, y: clickY };
  lastClickAt = now;

  // Show brief visual feedback
  showClickHighlight(clickX, clickY);

  const step = {
    id: newId(),
    action: "click",
    description: getElementDescription(el),
    url: window.location.href,
    elementText: el.textContent?.trim().slice(0, 100) || "",
    elementTag: el.tagName.toLowerCase(),
    screenshot: null,
    timestamp: now,
  };

  // Persist the step immediately — a full-page navigation can unload this
  // document before the screenshot resolves, and the step must survive.
  // The background worker serializes all step writes.
  chrome.runtime.sendMessage({ action: "appendStep", step }, ignoreLastError);

  captureScreenshot(clickX, clickY).then((screenshot) => {
    if (!screenshot) return;
    chrome.runtime.sendMessage({ action: "patchStepScreenshot", id: step.id, screenshot }, ignoreLastError);
  });
}

// Navigation observer — records address-bar/redirect SPA navigations only;
// click-driven ones are suppressed (the click step already shows the page
// that was clicked, and the next click shows the new page).
const navObserver = new MutationObserver(async () => {
  if (!isRecording) return;
  if (window.location.href === lastUrl) return;
  lastUrl = window.location.href;

  if (Date.now() - lastClickAt < CLICK_NAV_SUPPRESS_MS) return;

  const step = {
    id: newId(),
    action: "navigate",
    description: `Navigate to ${window.location.href}`,
    url: window.location.href,
    elementText: document.title,
    elementTag: "navigation",
    screenshot: null,
    timestamp: Date.now(),
  };

  chrome.runtime.sendMessage({ action: "appendStep", step }, ignoreLastError);

  // Small delay to let the page render before the screenshot
  await new Promise((r) => setTimeout(r, 500));
  const screenshot = await captureScreenshot();
  if (screenshot) {
    chrome.runtime.sendMessage({ action: "patchStepScreenshot", id: step.id, screenshot }, ignoreLastError);
  }
});
