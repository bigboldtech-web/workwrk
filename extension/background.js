// Handle screenshot capture requests from content script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "captureScreenshot") {
    chrome.tabs.captureVisibleTab(null, { format: "jpeg", quality: 50 }, (dataUrl) => {
      sendResponse({ screenshot: dataUrl || null });
    });
    return true; // Keep message channel open for async response
  }
});

// When a new tab is activated while recording, inject content script
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const result = await chrome.storage.local.get(["isRecording"]);
  if (result.isRecording) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: activeInfo.tabId },
        files: ["content.js"],
      });
      await chrome.scripting.insertCSS({
        target: { tabId: activeInfo.tabId },
        files: ["content.css"],
      });
    } catch (e) {
      // Ignore errors for chrome:// pages etc.
    }
  }
});

// When navigating to a new URL in the same tab while recording
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status === "complete") {
    const result = await chrome.storage.local.get(["isRecording"]);
    if (result.isRecording) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ["content.js"],
        });
        await chrome.scripting.insertCSS({
          target: { tabId },
          files: ["content.css"],
        });
      } catch (e) {
        // Ignore
      }
    }
  }
});
