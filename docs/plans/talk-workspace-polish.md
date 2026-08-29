# Talk + workspace polish — user-first plan (2026-08-28)

Founder redirect: fix bookmarks, make Talk seamless (persistent calls + real notifications). Mandate: design each from the actual user's perspective, output-oriented, slim. Grounded in code recon (3 scouts).

## 1. Persistent calls — "stay on the call while you work"
**User need:** On a call, you need to open a task/doc/anything without dropping the call. Leaving is a deliberate act, never a side effect of navigating.
**Root cause:** `CallPanel` is mounted INSIDE the page (`tlk/[id]/page.tsx:762`, `meetings/[id]/page.tsx:583`) → navigation unmounts `<LiveKitRoom>` → disconnect.
**Build:**
- Global call state in `shell-context.tsx`: `activeCall {conversationId?|meetingId?, room, subject, displayName, audioOnly, minimized}` + `startCall/endCall/toggleMinimize` (mirror the `createTask` singleton pattern).
- One `<CallDock>` mounted once in `os-shell.tsx` (sibling of `<main>`, survives navigation) holding ONE `<CallPanel>` with STABLE props. Two states: expanded (full panel on the call's own conversation page) + minimized (compact, draggable, fixed-position floating window: video/av thumbnail + mute/cam/leave/expand).
- Repoint `tlk` + `meetings` startCall to global; remove inline mounts. Navigating auto-minimizes; Leave is explicit.
**Invariant:** exactly one CallPanel/LiveKitRoom instance, never re-keyed on pathname.

## 2. Notifications — "know it without hunting for it"
**User need:** Immediately know when someone messages you (esp. DM/mention) or calls, and act from the alert.
**Reality:** `Notification` rows already carry DM/mention priority (`messages/route.ts:281-316`). A top-right toast provider already exists (`ui/toast.tsx`, `fixed top-4 right-4`) but only does title+description. The bell poll (`notifications-popover.tsx:290-316`) already fetches the newest unread row on unread-increase but only fires a browser notification (suppressed when tab focused). No SSE (gated, deferred).
**Build:**
- Extend `ui/toast.tsx`: optional leading avatar/icon + optional action buttons.
- Message toasts: on unread-increase, also fire a top-right toast (avatar + "X in #channel" / "X · DM" + preview, click → open conversation). Priority styling by type (mention/DM louder). Drop the tab-hidden gate for the in-app toast.
- Incoming-call ring: distinct `call_incoming` type; a cheap poll of open `CallSession` rows (started <~30s, your conversations, excluding self) every few seconds → a persistent "ringing" toast with **Join** (→ global startCall) / **Dismiss**.
- No new transport for v1 (reuse polls); SSE stays deferred/gated.

## 3. Bookmarks — "the team's daily links, one click away"
**User need:** The links a space's team touches daily (Figma, external dashboard, spec, vendor portal) one click from the overview.
**Reality:** the card (`spaces/[slug]/page.tsx:726`) is a DISABLED "coming soon" stub — a dead control. `/api/link-preview` (unfurl → title/favicon, SSRF-guarded) exists to reuse. `Space.settings` is a JSON blob (no migration needed).
**Build:**
- Per-space bookmarks in `Space.settings.bookmarks` (JSON): `{id, url, title, favicon, addedBy, addedAt}`.
- Replace the stub: add-URL input → unfurl via `/api/link-preview` → save. Render clean rows (favicon + title + hostname), click opens new tab, hover → remove.
- Small CRUD (PATCH space settings or `/api/spaces/[id]/bookmarks`).

## Build order
Bookmarks (fast, independent, no migration, kills a dead control) → Persistent calls (headline UX fix) → Notifications (builds on the call dock's Join + the toast extension). Each ships independently.
