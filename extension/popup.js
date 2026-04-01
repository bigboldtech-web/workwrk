const states = {
  idle: document.getElementById("idle-state"),
  recording: document.getElementById("recording-state"),
  review: document.getElementById("review-state"),
  saving: document.getElementById("saving-state"),
  success: document.getElementById("success-state"),
};

function showState(state) {
  Object.values(states).forEach((el) => (el.style.display = "none"));
  states[state].style.display = "block";
}

// Load saved server URL
chrome.storage.local.get(["serverUrl"], (result) => {
  if (result.serverUrl) {
    document.getElementById("server-url").value = result.serverUrl;
  }
});

// Check if already recording
chrome.storage.local.get(["isRecording", "steps"], (result) => {
  if (result.isRecording) {
    showState("recording");
    document.getElementById("step-count").textContent = (result.steps || []).length;
  }
});

// Start Recording
document.getElementById("start-btn").addEventListener("click", async () => {
  const serverUrl = document.getElementById("server-url").value.trim();
  chrome.storage.local.set({ serverUrl, isRecording: true, steps: [] });

  // Inject content script into the active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    chrome.tabs.sendMessage(tab.id, { action: "startRecording" });
  }

  showState("recording");
  document.getElementById("step-count").textContent = "0";
});

// Stop Recording
document.getElementById("stop-btn").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    chrome.tabs.sendMessage(tab.id, { action: "stopRecording" });
  }

  chrome.storage.local.set({ isRecording: false });

  chrome.storage.local.get(["steps"], (result) => {
    const steps = result.steps || [];
    document.getElementById("final-count").textContent = steps.length;
    showState("review");
  });
});

// Save to TheywrK
document.getElementById("save-btn").addEventListener("click", async () => {
  const title = document.getElementById("sop-title").value.trim();
  const category = document.getElementById("sop-category").value.trim();
  const errorEl = document.getElementById("save-error");

  if (!title) {
    errorEl.textContent = "Please enter a title for the SOP.";
    errorEl.style.display = "block";
    return;
  }

  errorEl.style.display = "none";
  showState("saving");

  chrome.storage.local.get(["steps", "serverUrl"], async (result) => {
    const steps = result.steps || [];
    const serverUrl = result.serverUrl || "https://theywrk.com";

    try {
      const response = await fetch(`${serverUrl}/api/sops/record`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          title,
          category: category || null,
          steps: steps.map((s, i) => ({
            order: i + 1,
            action: s.action,
            description: s.description,
            url: s.url,
            screenshot: s.screenshot,
            elementText: s.elementText,
            elementTag: s.elementTag,
          })),
        }),
      });

      if (response.ok) {
        chrome.storage.local.set({ steps: [] });
        showState("success");
      } else {
        const data = await response.json();
        showState("review");
        errorEl.textContent = data.error || "Failed to save. Make sure you're logged in to TheywrK.";
        errorEl.style.display = "block";
      }
    } catch (err) {
      showState("review");
      errorEl.textContent = "Network error. Check your server URL and connection.";
      errorEl.style.display = "block";
    }
  });
});

// Discard
document.getElementById("discard-btn").addEventListener("click", () => {
  chrome.storage.local.set({ steps: [], isRecording: false });
  showState("idle");
});

// Record Another
document.getElementById("new-btn").addEventListener("click", () => {
  showState("idle");
});

// Listen for step count updates from background
chrome.storage.onChanged.addListener((changes) => {
  if (changes.steps) {
    const steps = changes.steps.newValue || [];
    document.getElementById("step-count").textContent = steps.length;
  }
});
