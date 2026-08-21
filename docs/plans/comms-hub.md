# Comms Hub — Slack × Zoom × Meet, inside WorkwrK

**Date:** 2026-08-21 · **Status:** Phase 0 LIVE, Phases 1–6 planned
**Mandate (user):** "Slack, Zoom and Google Meet infused. Chat with team members, video call them, have a group of people in a meeting, audio calls. Plan it so seamless and so light that it doesn't put load on the WorkwrK system. Get it live slowly, slowly, and test it out."

---

## 1. The governing constraint: LIGHT

Everything in this plan is shaped by one rule: **the comms layer must never
degrade the core PPMS.** Concretely:

| Load type | How we keep it near zero |
|---|---|
| **Media (video/audio)** | Never touches our server. Jitsi's infrastructure carries all WebRTC traffic; we embed via IFrame API. Our cost per call: one page render. |
| **Signaling** | None. Rooms are HMAC-derived from entity ids (`lib/meeting-room.ts`), so there is no "create room" call, no room table, no state. |
| **Chat storage** | 3 lean tables, all queries on covering indexes, cursor pagination, 50-message pages. |
| **Chat realtime** | Adaptive polling first (each poll = 1 indexed query), SSE upgrade only as a measured, optional Phase 6. No websockets, no Redis, no extra processes. |
| **Blast radius** | Comms lives in its own routes/components/tables. Nothing in tasks/boards/docs imports from it. If chat breaks, WorkwrK doesn't notice. |

Back-of-envelope: 50 active users with a chat pane open, polling the active
conversation every 4s and the sidebar every 20s ≈ **~15 queries/second**, each
a sub-millisecond indexed read. Postgres idles through that. Media: **0 bytes**
through our box.

---

## 2. What already exists (reuse, don't rebuild)

- `lib/meeting-room.ts` — HMAC room names + signed guest codes (generalizes to any entity: `chat:{conversationId}`).
- `components/meetings/meeting-call.tsx` — full Jitsi conference embed (prejoin, screen share, in-call chat, tile view). Takes any room name.
- `(public)/meet/[code]` — no-login guest door for external people **and AI notetaker bots**.
- Meeting detail page — voice→text, AI summary, paste-transcript (the AI-notes loop).
- `Notification` model + inbox buckets — mention/DM notifications ride the existing rail.
- `/api/upload` + `FileEntry` — chat attachments later reuse this wholesale.
- `TagAssignment`, `OrganizationMembership` — audience + people search.
- ⚠️ Naming: `ChatSession`/`ChatMessage` are the **AI assistant's** tables. New models use `Conversation*` names to avoid collision.

---

## 3. Media backend — decision gate, not a bet

All phases embed via the Jitsi IFrame API, so the backend is swappable by
changing a domain string + adding a JWT param:

1. **Now (Phase 0):** `meet.jit.si` — free, zero infra. Known caveat: the first
   internal host may be asked to sign in (Google/GitHub) to open a room —
   guests never sign in. **We test this live and judge.**
2. **If the sign-in step annoys:** JaaS (8x8.vc) — same IFrame API, we sign a
   JWT so every WorkwrK member is auto-moderator, guests stay anonymous. Free
   dev tier, paid at scale. Still zero infra on our box.
3. **Only at real scale:** self-hosted Jitsi on a **separate** small box —
   never on the WorkwrK server.

The room-derivation and UI never change across these. That's the point.

---

## 4. Data model (Phase 1 migration — the only one)

```prisma
model Conversation {
  id             String   @id @default(cuid())
  organizationId String
  type           ConversationType   // DM | GROUP | CHANNEL
  name           String?            // channels/groups; DMs derive from members
  spaceId        String?            // Phase 4: channel linked to a Space
  createdById    String
  createdAt      DateTime @default(now())
  lastMessageAt  DateTime @default(now())   // sidebar ordering, denormalized
  members        ConversationMember[]
  messages       ConversationMessage[]
  @@index([organizationId, lastMessageAt])
}

model ConversationMember {
  id             String    @id @default(cuid())
  conversationId String
  userId         String
  lastReadAt     DateTime  @default(now())  // unread = messages after this
  notifyLevel    String    @default("all")  // all | mentions | mute
  @@unique([conversationId, userId])
  @@index([userId])                          // "my conversations" query
}

model ConversationMessage {
  id             String    @id @default(cuid())
  conversationId String
  authorId       String
  body           String                      // plain text + light markdown
  createdAt      DateTime  @default(now())
  editedAt       DateTime?
  deletedAt      DateTime?                   // soft delete — data integrity rule
  parentId       String?                     // Phase 5 threads, nullable now
  metadata       Json?                       // reactions, attachments, call-cards
  @@index([conversationId, createdAt])       // THE hot path, covering
}
```

Unread count = one query: messages where `createdAt > member.lastReadAt`,
grouped by conversation. DM dedup: sorted member-pair key checked at create.
Deletes are soft everywhere (user mandate: never lose content).

---

## 5. Phases — each independently shippable + testable

### Phase 0 — Meeting calls ✅ LIVE (46e7324)
Zoom/Meet-grade calls on every meeting: Join call on detail (+ `?call=1`),
Join on the list hero, copy-guest-link for external people and notetaker bots,
public `/meet/[code]` door. **Test now:** run a real meeting, invite an
external guest + a notetaker (Fireflies/Otter by guest link), paste transcript
back into meeting notes. Verdict feeds the §3 gate.

### Phase 1 — Chat core (DMs + group DMs)
The migration above; APIs (`/api/conversations` list+create, `[id]/messages`
cursor fetch + post, `[id]/read`); `/chat` two-pane Slack layout: left =
conversations + people search, right = thread + composer. Optimistic send
with retry + visible failure (data-integrity rule). Adaptive polling: 4s
active pane, 20s list, paused when tab hidden. **Soft launch: URL only — no
sidebar entry yet.** Test with the team; watch pm2/pg load before widening.

### Phase 2 — Woven into the OS
Sidebar "Chat" entry + topbar unread badge (one cheap count query on the
existing 60s notification poll — no new timer); "Message" button on people
profiles and member pickers; DM/mention notifications into inbox buckets.

### Phase 3 — Calls from chat (the Zoom fusion)
Video + audio buttons in any conversation header → `MeetingCall` with room
`chat:{conversationId}` (audio = `startWithVideoMuted/AudioOnly` config).
Posting a **call card** system message ("📞 Call started — Join") is how
others join: Slack-huddle model, zero signaling infra. Guest links work here
too (same HMAC scheme) → external people joinable from any chat.

### Phase 4 — Channels
Org channels (#general seeded) + Space-linked channels; join/leave/invite,
admin = Space managers. Same tables (`type: CHANNEL`), same UI, so this is
mostly permissioning + a create-channel dialog.

### Phase 5 — Comfort layer
Reactions + attachments (reuse `/api/upload`; files dropped in chat also land
in Library per the files system), message edit/delete, basic search
(`ILIKE` on recent, indexed later), threads via `parentId`.

### Phase 6 — Realtime upgrade (only if measured need)
SSE endpoint + in-process pub/sub replacing the 4s poll for open panes;
polling stays as fallback. Typing indicators only arrive here — they're
pointless over polling. Gate: actual query volume from Phases 1–5, not vibes.

---

## 6. Rollout & test discipline

- One phase = one deploy = one live test cycle with the team before the next.
- Phase 1 is invisible until Phase 2 (URL-only soft launch).
- Every phase: tsc + eslint gates, prod artifact verification, error-log sweep
  after deploy (the 331-error lesson).
- Migration (Phase 1 only) hand-authored idempotent SQL, dry-run locally,
  applied via the deploy-migrations path.
- Kill switch: chat surfaces render an honest "Chat is resting" state on API
  failure — never take the shell down with it.

## 7. Open decisions for the user

1. **meet.jit.si sign-in caveat** — test Phase 0 live; if the host sign-in
   step is unacceptable, we move to JaaS (still zero infra, small cost).
2. **Phase order confirmation** — chat core next, or channels before profile
   weaving? Plan assumes 1→2→3→4→5→6.
3. **Retention** — keep chat forever (default, soft-delete only) or add an
   org-level retention setting later?
