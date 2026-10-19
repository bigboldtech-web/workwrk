// @ts-check
// The live view's words (docs/plans/browser-host.md 4.1): the status line
// over the picture, and nothing else. live/page.test.ts scans them for dashes.

export const LIVE_COPY = Object.freeze({
  connecting: "Connecting to the browser",
  reconnecting: "Connection lost. Trying again",
  ended: "This browser has closed.",
  expired: "This view has expired. Open it again from the chat.",
  revoked: "This view was closed.",
  refused: "This view can't be shown here.",
});

/** @typedef {keyof typeof LIVE_COPY} LiveState */
