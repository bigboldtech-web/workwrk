let isRecording = false;
let highlightEl = null;

// Inject detection flag so the web app knows the extension is installed
window.postMessage({ type: "WORKWRK_EXTENSION_INSTALLED", version: "1.0.0" }, "*");
document.documentElement.setAttribute("data-workwrk-extension", "true");

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

  // Fallback with tag name
  return `Click on a ${el.tagName.toLowerCase()} element`;
}

// No visual feedback on click — recording is invisible to the user
function showClickHighlight(el) {
  // Intentionally empty — seamless recording like Scribe
}

// Capture a screenshot of the current tab
async function captureScreenshot() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: "captureScreenshot" }, (response) => {
      resolve(response?.screenshot || null);
    });
  });
}

// Main click handler
document.addEventListener("click", async (e) => {
  if (!isRecording) return;

  const el = e.target;

  // Ignore clicks on our own UI
  if (el.closest("#twrk-recording-indicator")) return;

  // Show visual feedback
  showClickHighlight(el);

  // Capture screenshot
  const screenshot = await captureScreenshot();

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
