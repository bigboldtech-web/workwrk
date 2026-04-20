let isRecording = false;
let highlightEl = null;

// Inject detection flag so the web app knows the extension is installed
window.postMessage({ type: "WORKWRK_EXTENSION_INSTALLED", version: "1.2.0" }, "*");
document.documentElement.setAttribute("data-workwrk-extension", "true");

// Messages from the WorkwrK app into the extension.
//
//   WORKWRK_APP_ORIGIN     — learn the app's origin so the popup POSTs
//                            recordings back to the right server.
//
//   WORKWRK_START_RECORDING — the app's "Create SOP → Record" flow
//                            pushes title/category/subcategory/description
//                            over so the user doesn't re-type them in
//                            the popup. Stash them, flip isRecording on,
//                            and show the floating indicator. Existing
//                            click/nav capture takes it from there.
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data;

  if (data?.type === "WORKWRK_APP_ORIGIN" && typeof data.origin === "string") {
    try {
      const origin = new URL(data.origin).origin;
      chrome.storage.local.set({ workwrkOrigin: origin });
    } catch {}
    return;
  }

  if (data?.type === "WORKWRK_START_RECORDING" && data.sop && typeof data.sop.title === "string") {
    const sop = data.sop;
    chrome.storage.local.set({
      isRecording: true,
      steps: [],
      sopTitle: sop.title,
      sopCategory: sop.category || "",
      sopSubcategory: sop.subcategory || "",
      sopDescription: sop.description || "",
    }, () => {
      isRecording = true;
      showRecordingIndicator();
    });
    return;
  }
});

// Check recording state on load
chrome.storage.local.get(["isRecording"], (result) => {
  if (result.isRecording) {
    isRecording = true;
    showRecordingIndicator();
  }
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "startRecording") {
    isRecording = true;
    showRecordingIndicator();
  } else if (msg.action === "stopRecording") {
    isRecording = false;
    hideRecordingIndicator();
  }
});

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

// Main click handler
document.addEventListener("click", async (e) => {
  if (!isRecording) return;

  const el = e.target;

  // Ignore clicks on our own UI
  if (el.closest("#twrk-recording-indicator")) return;

  const clickX = e.clientX;
  const clickY = e.clientY;

  // Show brief visual feedback
  showClickHighlight(clickX, clickY);

  // Capture screenshot with click annotation
  const screenshot = await captureScreenshot(clickX, clickY);

  // Build step data
  const step = {
    action: "click",
    description: getElementDescription(el),
    url: window.location.href,
    elementText: el.textContent?.trim().slice(0, 100) || "",
    elementTag: el.tagName.toLowerCase(),
    screenshot: screenshot,
    timestamp: Date.now(),
  };

  // Store the step
  chrome.storage.local.get(["steps"], (result) => {
    const steps = result.steps || [];
    steps.push(step);
    chrome.storage.local.set({ steps });
  });
}, true);

// Also capture navigation events
let lastUrl = window.location.href;
const navObserver = new MutationObserver(async () => {
  if (!isRecording) return;
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;

    // Small delay to let the page render
    await new Promise((r) => setTimeout(r, 500));

    const screenshot = await captureScreenshot();

    const step = {
      action: "navigate",
      description: `Navigate to ${window.location.href}`,
      url: window.location.href,
      elementText: document.title,
      elementTag: "navigation",
      screenshot: screenshot,
      timestamp: Date.now(),
    };

    chrome.storage.local.get(["steps"], (result) => {
      const steps = result.steps || [];
      steps.push(step);
      chrome.storage.local.set({ steps });
    });
  }
});

navObserver.observe(document.body, { childList: true, subtree: true });
