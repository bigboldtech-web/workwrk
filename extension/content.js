let isRecording = false;
let highlightEl = null;

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
    <span>TheywrK Recording</span>
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

// Get a human-readable description of what was clicked
function getElementDescription(el) {
  // Button text
  if (el.tagName === "BUTTON" || el.closest("button")) {
    const btn = el.tagName === "BUTTON" ? el : el.closest("button");
    const text = btn.textContent.trim();
    if (text) return `Click "${text.slice(0, 80)}"`;
  }

  // Link text
  if (el.tagName === "A" || el.closest("a")) {
    const link = el.tagName === "A" ? el : el.closest("a");
    const text = link.textContent.trim();
    if (text) return `Click "${text.slice(0, 80)}"`;
  }

  // Input / textarea
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
    const label = el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.getAttribute("name") || "";
    return `Click on ${label ? '"' + label + '"' : "input"} field`;
  }

  // Select
  if (el.tagName === "SELECT") {
    const label = el.getAttribute("aria-label") || el.getAttribute("name") || "";
    return `Click on ${label ? '"' + label + '"' : "dropdown"}`;
  }

  // Checkbox / Radio
  if (el.tagName === "INPUT" && (el.type === "checkbox" || el.type === "radio")) {
    const label = el.closest("label")?.textContent.trim() || "";
    return label ? `Toggle "${label.slice(0, 60)}"` : `Toggle ${el.type}`;
  }

  // Image
  if (el.tagName === "IMG") {
    return `Click on image${el.alt ? ' "' + el.alt.slice(0, 60) + '"' : ""}`;
  }

  // Menu item / list item
  if (el.closest("[role='menuitem']") || el.closest("[role='option']")) {
    const item = el.closest("[role='menuitem']") || el.closest("[role='option']");
    const text = item.textContent.trim();
    return `Click "${text.slice(0, 80)}"`;
  }

  // Generic element with text
  const text = el.textContent.trim();
  if (text && text.length < 80) {
    return `Click "${text}"`;
  }

  // Fallback
  return `Click on ${el.tagName.toLowerCase()}`;
}

// Show a brief highlight around the clicked element
function showClickHighlight(el) {
  if (highlightEl) highlightEl.remove();

  const rect = el.getBoundingClientRect();
  highlightEl = document.createElement("div");
  highlightEl.className = "twrk-click-highlight";
  highlightEl.style.cssText = `
    position: fixed;
    top: ${rect.top - 4}px;
    left: ${rect.left - 4}px;
    width: ${rect.width + 8}px;
    height: ${rect.height + 8}px;
    border: 3px solid #7C3AED;
    border-radius: 8px;
    pointer-events: none;
    z-index: 2147483646;
    transition: opacity 0.3s;
  `;
  document.body.appendChild(highlightEl);

  setTimeout(() => {
    if (highlightEl) {
      highlightEl.style.opacity = "0";
      setTimeout(() => {
        if (highlightEl) highlightEl.remove();
        highlightEl = null;
      }, 300);
    }
  }, 800);
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
