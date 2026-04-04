const states = {
  idle: document.getElementById("idle-state"),
  recording: document.getElementById("recording-state"),
  saving: document.getElementById("saving-state"),
  success: document.getElementById("success-state"),
  error: document.getElementById("error-state"),
};

let sopTitle = "";
let sopCategory = "";
let sopDescription = "";

function showState(state) {
  Object.values(states).forEach((el) => { if (el) el.style.display = "none"; });
  if (states[state]) states[state].style.display = "block";
}

// Check if already recording
chrome.storage.local.get(["isRecording", "steps", "sopTitle", "sopCategory", "sopDescription"], (result) => {
  if (result.isRecording) {
    showState("recording");
    document.getElementById("step-count").textContent = (result.steps || []).length;
    sopTitle = result.sopTitle || "";
    sopCategory = result.sopCategory || "";
    sopDescription = result.sopDescription || "";
  }
});

// Start Recording — title required BEFORE recording
document.getElementById("start-btn").addEventListener("click", async () => {
  const title = document.getElementById("sop-title").value.trim();
  const category = document.getElementById("sop-category").value.trim();
  const description = document.getElementById("sop-description").value.trim();
  const errorEl = document.getElementById("start-error");

  if (!title) {
    errorEl.style.display = "block";
    return;
  }
  errorEl.style.display = "none";

  sopTitle = title;
  sopCategory = category;
  sopDescription = description;

  chrome.storage.local.set({
    isRecording: true, steps: [],
    sopTitle: title, sopCategory: category, sopDescription: description,
  });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) chrome.tabs.sendMessage(tab.id, { action: "startRecording" });

  showState("recording");
  document.getElementById("step-count").textContent = "0";
});

// Stop Recording — auto-save immediately (title already set)
document.getElementById("stop-btn").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) chrome.tabs.sendMessage(tab.id, { action: "stopRecording" });

  chrome.storage.local.set({ isRecording: false });
  showState("saving");

  // Get stored title and steps
  chrome.storage.local.get(["steps", "sopTitle", "sopCategory", "sopDescription"], async (result) => {
    const steps = result.steps || [];
    const title = result.sopTitle || sopTitle;
    const category = result.sopCategory || sopCategory;
    const description = result.sopDescription || sopDescription;

    try {
      const response = await fetch("https://workwrk.com/api/sops/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          title,
          description: description || null,
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
        chrome.storage.local.set({ steps: [], sopTitle: "", sopCategory: "", sopDescription: "" });
        showState("success");
      } else {
        const data = await response.json();
        document.getElementById("save-error").textContent = data.error || "Failed to save. Make sure you're logged in.";
        showState("error");
      }
    } catch (err) {
      document.getElementById("save-error").textContent = "Network error. Check your connection.";
      showState("error");
    }
  });
});

// Retry
document.getElementById("retry-btn")?.addEventListener("click", () => {
  showState("idle");
  document.getElementById("sop-title").value = sopTitle;
  document.getElementById("sop-category").value = sopCategory;
  document.getElementById("sop-description").value = sopDescription;
});

// Record Another
document.getElementById("new-btn").addEventListener("click", () => {
  sopTitle = ""; sopCategory = ""; sopDescription = "";
  document.getElementById("sop-title").value = "";
  document.getElementById("sop-category").value = "";
  document.getElementById("sop-description").value = "";
  showState("idle");
});

// Listen for step count updates
chrome.storage.onChanged.addListener((changes) => {
  if (changes.steps) {
    const el = document.getElementById("step-count");
    if (el) el.textContent = (changes.steps.newValue || []).length;
  }
});
