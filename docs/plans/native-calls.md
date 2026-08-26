# Native Calls: our own video system for Room (Jitsi removal)

**Date:** 2026-08-26 · **Status:** Phases 1-3 SHIPPED (c7a2962, 0c466e8); SFU co-tenant on the app box per user (dedicated node later); Phase 4 (recording/reactions) remains
**Mandate (user):** "Remove all the Jitsi stuff and make it like Slack, exactly like Slack: multiple people can join, chat, video call. We need to have our own video call system."

---

## 1. What "our own" means, honestly

Multi-party video needs three pieces: **signaling** (who's in the call, offer/answer), **media transport** (the actual audio/video packets), and **UI**. Jitsi gave us all three on someone else's servers. Owning it means running the media layer on OUR infrastructure.

The engineering reality: browsers can send video peer-to-peer, but a mesh where everyone sends to everyone dies past 4-5 people (upload explodes). Slack-grade group calls (up to 50) require an **SFU** (Selective Forwarding Unit): a server that receives each person's stream once and forwards it to everyone else. Writing an SFU from scratch is a multi-year specialist project; nobody does it, including Slack (they built on Amazon Chime's infra). Owning the system means running an open-source SFU on our own box.

**Decision: self-host LiveKit (open source, Apache-2.0).** It is the modern standard (mediasoup and Janus are the alternatives; LiveKit has the best server + React SDKs, built-in TURN, simple single-binary deploy). It runs on OUR server, speaks OUR auth (we mint the JWTs), stores nothing externally, and no third-party service is involved. The UI will be 100% WorkwrK.

**Hard rule carried over:** media never touches the main WorkwrK box. LiveKit runs on a dedicated call server. The app server only mints tokens and receives webhooks: grams of load.

## 2. Infra (the one decision needed)

- **New node: "calls" box.** Linode 4GB shared (2 vCPU) ≈ $24/mo carries a small team's calls comfortably (SFU is bandwidth-heavy, CPU-light at our scale; 4GB gives headroom for ~40-50 concurrent participants across calls). Scale later by resizing, or clustering with Redis if WorkwrK grows into real multi-org load.
- DNS `calls.workwrk.com` → the node. LiveKit terminates its own TLS (built-in ACME) or sits behind Caddy. UDP 50000-60000 + 443/7881 open; built-in TURN covers hostile NATs.
- Deploy: LiveKit's single binary + systemd (no Docker needed), config in `/etc/livekit.yaml` with our API key/secret. The same key/secret goes into the app's `.env` (`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`).
- **User action:** approve the ~$24/mo node (or hand me an existing spare box). Everything else I do over SSH.

## 3. Phases

### Phase 1: swap the engine (Jitsi out, LiveKit in) — SHIPPED (c7a2962)
- `POST /api/calls/token`: membership-checked (conversation member / meeting attendee), mints a LiveKit JWT for room `chat:{conversationId}:{callEpoch}` or `meeting:{id}`. The HMAC room-name scheme and callEpoch rotation survive unchanged; only the media backend changes.
- `components/calls/call-panel.tsx`: OUR call UI on `@livekit/components-react` primitives: tile grid with speaker highlight, mic/cam toggles, screen share, device picker, leave. Same mount points MeetingCall uses today (Room conversation panel, meeting detail, `?call=1`).
- **Remove all Jitsi**: `meeting-call.tsx`, the `external_api.js` loader, `meetingJitsiUrl`, docs references. No Google/GitHub host sign-in ever again, no meet.jit.si branding, prejoin is ours (name + device check).
- Meetings and Room both ride the new panel from day one.

### Phase 2: Slack-huddle presence — SHIPPED (0c466e8, 10 fleet findings fixed: self-healing session lifecycle, FOR-UPDATE rosters, always-on refresh, room latching)
LiveKit webhooks (`room_started`, `participant_joined/left`, `room_finished`) hit `POST /api/calls/webhook` (signature-verified) and land in a tiny `CallSession` table (roomName, conversationId, participants JSON, startedAt/endedAt). That gives Room what Slack has and we faked with call cards:
- **Live huddle chip** in the conversation header and sidebar row: stacked avatars of who is IN the call right now + one-click Join. Visible before you join, gone when the call ends.
- Call cards upgrade from "Started a call" to live state: "3 in the call · 12m · Join", then "Call ended · 24m" when it finishes.
- The existing 4s/20s polls carry this state; zero new realtime infra on the app box.

### Phase 3: the Zoom layer — SHIPPED (0c466e8; + Reset-guest-link revocation, 24h meeting-link expiry)
"Zoom infused in Slack" (user, 2026-08-25). Three doors, all token-gated on our system, zero accounts for guests:
- **Instant call links.** A "New call link" action (topbar create menu + Room) mints a shareable `workwrk.com/meet/...` URL on the spot, Zoom's "new meeting" gesture: no scheduling, no form. Under the hood it creates a lightweight Meeting row so the call has a home for notes/transcript afterwards. Copy, paste anywhere, people join.
- **Guest links on ANY Room huddle.** Every conversation call panel gets "Copy guest link": the signed code for `chat:{conversationId}:{callEpoch}`. An outside client or candidate lands in the team's live huddle next to internal folks. Leaving a member still rotates callEpoch, which kills old guest links for that room automatically.
- **Scheduled meetings** keep their existing guest door, now exchanging the signed code for a guest-scoped LiveKit token (join-only, no admin rights) after a name prompt. AI notetaker bots ride the same door and can record.
Host controls v1: guests are join-only, any member can remove a participant; a Zoom-style waiting room is a later option if links ever leak.

### Phase 4: comfort + capture
- In-call emoji reactions + raise hand (LiveKit data channels), grid/speaker view toggle, picture-in-picture.
- **Recording**: LiveKit Egress composite recording to our S3 bucket, dropped into the meeting's Files + a call card link. Egress is a second process on the calls box; ships only when wanted.
- Noise suppression (Krisp-style RNNoise via LiveKit's track processors) if calls feel noisy in practice.

## 4. What gets deleted

`src/components/meetings/meeting-call.tsx` (Jitsi embed), the script loader, `meetingJitsiUrl()`, the meet.jit.si caveats in comms-hub.md (§3 decision gate: resolved by ownership). `meetingRoomName`/`meetingGuestCode`/`chatRoomName` HMAC derivations stay: they are backend-agnostic room identifiers and the guest-door credential.

## 5. Rollout + risk

- Phase 1 ships behind the calls box being live; until then Jitsi keeps working (no gap in service). The swap is one deploy; rollback is reverting one component + token route.
- Each phase gets the fleet review like everything else. Real-call test matrix after Phase 1: 2-person DM call, 5-person channel huddle, screen share, one guest link, mobile Safari.
- Load watch: the calls box is disposable and isolated; if it saturates, resize it. The app box's only new work is JWT signing and webhook rows.
- Cost transparency: $24/mo infra vs $0 Jitsi. That buys ownership, no sign-in walls, presence, recording rights, and our branding end to end.
