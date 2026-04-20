const DEFAULT_SERVER_URL = "https://workwrk.com";

const states = {
  idle: document.getElementById("idle-state"),
  settings: document.getElementById("settings-state"),
  recording: document.getElementById("recording-state"),
  saving: document.getElementById("saving-state"),
  success: document.getElementById("success-state"),
  error: document.getElementById("error-state"),
};

let sopTitle = "";
let sopCategory = "";
let sopSubcategory = "";
let sopDescription = "";

function showState(state) {
  Object.values(states).forEach((el) => { if (el) el.style.display = "none"; });
  if (states[state]) states[state].style.display = "block";
}

function getServerUrl() {
  // Resolve in priority: explicit user setting → origin learned from the
  // WorkwrK app handshake → hardcoded default. `workwrkOrigin` is written
  // by content.js when the user visits a workwrk page while the extension
  // is installed.
  return new Promise((resolve) => {
    chrome.storage.local.get(["serverUrl", "workwrkOrigin"], (r) => {
      const url = (r.serverUrl || r.workwrkOrigin || DEFAULT_SERVER_URL).replace(/\/+$/, "");
      resolve(url);
    });
  });
}

// Check if already recording
chrome.storage.local.get(["isRecording", "steps", "sopTitle", "sopCategory", "sopSubcategory", "sopDescription"], (result) => {
  if (result.isRecording) {
    showState("recording");
    document.getElementById("step-count").textContent = (result.steps || []).length;
    sopTitle = result.sopTitle || "";
    sopCategory = result.sopCategory || "";
    sopSubcategory = result.sopSubcategory || "";
    sopDescription = result.sopDescription || "";
  }
});

// "Open WorkwrK" — drop the user straight into the SOPs → New → Record
// flow. Uses the learned workwrkOrigin when the user has visited the app
// with the extension installed; falls back to the server URL setting.
document.getElementById("open-app-btn").addEventListener("click", async () => {
  const serverUrl = await getServerUrl();
  chrome.tabs.create({ url: `${serverUrl}/sops` });
});

// Stop Recording — auto-save immediately (title already set)
document.getElementById("stop-btn").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) chrome.tabs.sendMessage(tab.id, { action: "stopRecording" });

  chrome.storage.local.set({ isRecording: false });
  showState("saving");

  // Get stored title and steps
  chrome.storage.local.get(["steps", "sopTitle", "sopCategory", "sopSubcategory", "sopDescription"], async (result) => {
    const steps = result.steps || [];
    const title = result.sopTitle || sopTitle;
    const category = result.sopCategory || sopCategory;
    const subcategory = result.sopSubcategory || sopSubcategory;
    const description = result.sopDescription || sopDescription;
    const serverUrl = await getServerUrl();

    try {
      // Upload screenshots to S3 first so the POST body is a list of
      // keys (~100 bytes each) rather than multi-megabyte base64 blobs.
      // Falls back to inline base64 if the server doesn't have S3
      // configured — existing behavior is preserved on small/dev
      // deployments.
      const processedSteps = await Promise.all(
        steps.map(async (s, i) => {
          let screenshotKey = null;
          let screenshot = s.screenshot;
          if (screenshot && screenshot.startsWith("data:image/")) {
            const uploaded = await uploadScreenshotToS3(serverUrl, screenshot);
            if (uploaded) {
              screenshotKey = uploaded;
              screenshot = null; // drop base64 from the POST; S3 has it now
            }
          }
          return {
            order: i + 1,
            action: s.action,
            description: s.description,
            url: s.url,
            screenshot,           // null when uploaded; base64 on fallback
            screenshotKey,        // S3 key when uploaded; null on fallback
            elementText: s.elementText,
            elementTag: s.elementTag,
          };
        }),
      );

      const response = await fetch(`${serverUrl}/api/sops/record`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          title,
          description: description || null,
          category: category || null,
          subcategory: subcategory || null,
          steps: processedSteps,
        }),
      });

      if (response.ok) {
        chrome.storage.local.set({ steps: [], sopTitle: "", sopCategory: "", sopSubcategory: "", sopDescription: "" });
        showState("success");
      } else {
        const data = await response.json().catch(() => ({}));
        const msg = data.error || `Failed (${response.status}). Make sure you're signed in at ${serverUrl}.`;
        document.getElementById("save-error").textContent = msg;
        showState("error");
      }
    } catch (err) {
      document.getElementById("save-error").textContent = `Couldn't reach ${serverUrl}. Set the server URL via the footer link.`;
      showState("error");
    }
  });
});

// Request a presigned upload URL from WorkwrK, then PUT the image
// binary directly to S3. Returns the S3 key on success, or null on any
// failure — caller falls back to base64 so upload problems never lose
// a recording.
async function uploadScreenshotToS3(serverUrl, dataUrl) {
  try {
    // Parse the "data:image/<fmt>;base64,<payload>" prefix.
    const match = /^data:(image\/(jpeg|png));base64,(.+)$/.exec(dataUrl);
    if (!match) return null;
    const contentType = match[1];
    const b64 = match[3];

    // Ask our server for a presigned PUT URL.
    const presignRes = await fetch(`${serverUrl}/api/uploads/presign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ kind: "scribe_screenshot", contentType }),
    });
    if (!presignRes.ok) return null;
    const { data } = await presignRes.json().then((r) => ({ data: r.data ?? r }));
    if (!data?.uploadUrl || !data?.key) return null;

    // Base64 → Blob.
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: contentType });

    // Upload directly to S3. Presigned URL carries the auth.
    const putRes = await fetch(data.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: blob,
    });
    if (!putRes.ok) return null;

    return data.key;
  } catch {
    return null;
  }
}

// Retry — after a save failure, show the recording state again so the
// user can hit Stop & Save a second time. The steps are still in storage.
document.getElementById("retry-btn")?.addEventListener("click", () => {
  chrome.storage.local.get(["steps"], (result) => {
    document.getElementById("step-count").textContent = (result.steps || []).length;
    showState("recording");
  });
});

// Record Another — back to the idle prompt that points to WorkwrK.
document.getElementById("new-btn").addEventListener("click", () => {
  sopTitle = ""; sopCategory = ""; sopSubcategory = ""; sopDescription = "";
  showState("idle");
});

// Listen for step count updates
chrome.storage.onChanged.addListener((changes) => {
  if (changes.steps) {
    const el = document.getElementById("step-count");
    if (el) el.textContent = (changes.steps.newValue || []).length;
  }
});

// Server settings
document.getElementById("server-settings-link").addEventListener("click", async () => {
  const url = await getServerUrl();
  document.getElementById("server-url").value = url;
  showState("settings");
});

document.getElementById("settings-cancel").addEventListener("click", () => {
  showState("idle");
});

document.getElementById("settings-save").addEventListener("click", () => {
  const raw = document.getElementById("server-url").value.trim();
  if (!raw) {
    chrome.storage.local.remove(["serverUrl"]);
    showState("idle");
    return;
  }
  try {
    // Normalize — must be a valid URL with http(s).
    const u = new URL(raw);
    if (!/^https?:$/.test(u.protocol)) throw new Error();
    chrome.storage.local.set({ serverUrl: u.origin });
    showState("idle");
  } catch {
    // Soft-fail: leave the user on the settings screen so they can fix it.
  }
});
