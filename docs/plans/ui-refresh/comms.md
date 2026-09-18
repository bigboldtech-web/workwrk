# UI audit: Talk/Room, meetings, clips/notetaker, announcements

Audited 2026-09-10 against `main` (HEAD 6187227a). Read-only. File:line citations are relative to `/Users/bigboldtechnologies/theywrk/`.

## 0. Route map (what actually exists)

| Route | File | Exists | Notes |
|---|---|---|---|
| `/tlk` | `src/app/(dashboard)/tlk/page.tsx` | yes | Talk hub landing; redirects into most recent conversation |
| `/tlk/[id]` | `src/app/(dashboard)/tlk/[id]/page.tsx` | yes | Conversation view (DM / group / channel) |
| `/tlk/*` layout | `src/app/(dashboard)/tlk/layout.tsx` | yes | Server module gate (Talk = premium module) |
| `/room`, `/room/:id`, `/chat`, `/chat/:id` | `next.config.ts:9-14` | redirect only | 302 to `/tlk` / `/tlk/:id`. Comments and localStorage keys still say "room" (`workwrk:room:sections`, `workwrk:room:fmtbar`, event `workwrk:room:start-talktok`) |
| `/meetings` | `src/app/(dashboard)/meetings/page.tsx` | yes | Agenda-first meetings list |
| `/meetings/[id]` | `src/app/(dashboard)/meetings/[id]/page.tsx` | yes | Meeting room: notes, decisions, action items, call |
| `/notetaker` | `src/app/(dashboard)/notetaker/page.tsx` | yes | Paste-transcript AI extractor. Labelled "Clips" in the Docs sidebar |
| `/clips` | none | NO (404) | Referenced only in `apps-catalog.tsx:1198,1224` matchPaths and `docs-sidebar.tsx:159` active check. Dead path |
| `/announcements` | `src/app/(dashboard)/announcements/page.tsx` | yes | Feed + composer dialog + ack-status dialog |
| `/meet/[code]` | `src/app/(public)/meet/[code]/page.tsx` | yes | Public guest call door (no shell, no login) |
| `/dashboard` (host of AnnouncementsBanner) | `src/app/(dashboard)/dashboard/page.tsx` | yes | Legacy page, not in rail; reached via `g d` shortcut, `/setup`, `/welcome` |

Shell-level pieces in scope (mounted once in `src/components/layout/os/os-shell.tsx:92-96`): `CallDock` (floating call window), `IncomingCallWatcher` (ring toast), `RealtimeClient` (SSE). Orphaned component: `src/components/layout/os/announcements-popover.tsx` (`OsAnnouncementsPopover`) is imported nowhere.

### Global chrome shared by every dashboard route in scope
- Top bar (`click-topbar.tsx`): workspace switcher + CalendarPeek (left card); Search ⌘K + Ask AI pill (center card); pinned personal tools, ActiveTimerPill, NotificationsBell, RemindersBell, Inbox link, avatar/ProfileMenu (right card). Nothing route-specific is ever added to the top bar; page headers live inside `<main>`.
- Secondary sidebar (`click-sidebar.tsx`): app label + "+" (per-app createActions) + search + collapse. Body = the active hub's `Sidebar` from `apps-catalog.tsx`. The hub is `getApp(activeAppKey) ?? findAppForPath(pathname) ?? APPS[0]` (`click-sidebar.tsx:89`), so a route no hub claims keeps whatever sidebar was last open.
- Rail (`click-app-rail.tsx` via `src/lib/rail-apps.ts:156-163`): folded (`offRail`) apps are dropped, module apps dropped unless active, access-tier filtered. The More launcher uses the same `railApps` set (`apps-more-popover.tsx:63`), so folded apps (Clips, Announce) never appear there either.

---

## 1. `/tlk` (Talk landing)

- **Title / purpose**: "TLK — talk with your team". Jump into the most recent conversation (Slack behaviour); honest empty state otherwise. `tlk/page.tsx:3-5`.
- **Reachable from**: Rail hub **Talk** (`apps-catalog.tsx:1186`, `defaultHref: "/tlk"`, `matchPaths: ["/tlk", "/announcements"]`). Also `/room`, `/chat` redirects. Only shown when the org has the Talk module ACTIVE (`rail-apps.ts:160`); bookmarked URL with module off renders `ModuleDisabledScreen` from the server layout (`tlk/layout.tsx:14-24`).
- **Back button**: none (hub root).
- **Top bar**: global only.
- **Sidebar (ChatSidebar, `chat-sidebar.tsx`)**: local "Find a conversation…" box (also drives message search at 2+ chars, `:127-137`); **Directory** link to `/people` (`:262-267`); **Announcements** link to `/announcements` (hr-admin only, `:268-275`); **New message** (dashed button) + **New call link** (video icon, mints an instant Meeting and navigates to `/meetings/<id>?call=1`, `:166-177`); **Starred** section (only when any starred, `:295-325`); **Channels** section (collapsible, persisted in localStorage `workwrk:room:sections`; "+" opens NewChannelDialog; rows show `#name`, live-call chip, unread badge, "Join" for non-members `:327-386`); **Direct messages** section (collapsible; "+" opens NewChatModal; rows = avatar/title/preview/unread/live-call chip; hover X = close DM `:387-484`); **Messages** search results (`:486-519`); right-click context menu on any row: Open / Start call / Star / Mute / Leave channel | Close conversation | Leave group (`:521-590`). Header "+" (sidebar chrome) offers **New message** and **New channel** (`apps-catalog.tsx:1188-1191`).
- **Options/controls on the page**: only "Start a conversation" in the empty state (dispatches `workwrk:os:new:chat-new`, `tlk/page.tsx:42`).
- **UI state**: rough (functional but thin). Loading state is plain grey text "Opening your conversations…" (`:49`), not the ValueLoader.
- **Issues**:
  - There is no Talk "home": every visit auto-redirects into whichever conversation is most recent (`:22`). Users cannot land on an overview, unread digest or channel browser.
  - Empty-state copy says "TLK" while the hub is labelled "Talk" and code/plans say "Room": three names for one surface.
  - The **Directory** row navigates out of the Talk hub into `/people` (Teams hub); the rail highlight switches, which reads as leaving Talk.
  - Loading state inconsistent with the rest of the app (text vs `ValueLoader`).

## 2. `/tlk/[id]` (conversation)

- **Title / purpose**: Conversation header = `#channel` or DM/group title (`tlk/[id]/page.tsx:654-656`). Slack-style feed + composer + thread side sheet + calls. Data: initial page fetch, SSE-triggered refetch, 20s backstop poll (`:35`), 10-20s roster poll (`:131-141`).
- **Reachable from**: Talk sidebar rows (channels / DMs / starred / search hits); `/tlk` redirect; People profile "Message" button (`people/[id]/profile-client.tsx:250`); notification links (`/tlk/<id>`); IncomingCallWatcher "Join" sets `href: /tlk/<id>` for the dock's "Open conversation" button; CallDock external-link button; `?call=1` deep links (`:539-545`).
- **Back button**: none. Header has no back affordance; navigation is via the sidebar only. (Hub page, acceptable, but the mobile header has no escape.)
- **Top bar**: global only.
- **Sidebar**: ChatSidebar (active row highlighted `bg-zinc-100`).
- **Header controls** (`:663-771`): avatar stack / `#` tile; title; **members pill** (count + 3 avatars, opens AddPeopleDialog; `hidden sm:inline-flex`, non-DM only `:679-693`); **"N in call · Join"** emerald pill when a fresh (< 4 h) live session exists and you are not on it (`:694-707`); **Phone** = start audio call; **Call** (brand button; label flips to "In call") = start video call; **••• menu**: Star / Remove from Starred, Mute / Unmute notifications, Copy guest call link, Reset guest call link, Add people (group/channel), Rename group/channel (not #general), Leave group/channel (not #general) (`:734-769`).
- **Feed** (`message-feed.tsx`): day dividers, author grouping (5-min window), hover action bar (3 quick reactions + reaction picker of 9 + reply in thread + edit/delete for own), reaction chips, thread chip "N replies", inline edit (Enter saves / Esc cancels), "Message removed" tombstone, attachments (image preview or file pill), call cards in three variants (Join / LIVE with roster / "A call happened … for Nm"), failed-send "retry" link, "Show earlier messages" pager (`tlk/[id]/page.tsx:778-784`), Slack-style "very beginning of…" intro at the true start (`:789-814`), "Say hello 👋" empty (`:815-819`).
- **Composer** (`chat-composer.tsx`): textarea (Enter sends, Shift+Enter newline, auto-grow to 6 rows); toolbar: attach (max 10 files, 25 MB each, uploaded via `/api/upload` and mirrored into `/api/files`), formatting toggle "Aa" (persisted `workwrk:room:fmtbar`) revealing bold/italic/underline/strike/link/ol/ul/quote/code/codeblock buttons (markdown-ish markers, `:182-232`), emoji grid (12 fixed emoji), @ mention (roster autocomplete with arrow/Enter/Tab), video call + audio call buttons (main pane only), Send. Drag-drop files onto the composer.
- **Thread panel** (`thread-panel.tsx`): absolute right sheet, `w-full max-w-[420px]`, parent + replies + its own composer (no call buttons), close X.
- **Dialogs**: AddPeopleDialog (people search, chips, "Add N"); ConfirmDialog for leave and for delete message.
- **Call**: `startCall` hands off to shell `CallDock` (`:506-518`); posts a "Started a call" card unless a live/recent un-ended card exists (`:524-531`).
- **UI state**: polished for the chat core (optimistic sends, retry, revert-on-fail reactions, keyset polling). Rough around edges listed below.
- **Issues**:
  - Rename uses `window.prompt` (`:613`); composer "Link" uses `window.prompt` (`chat-composer.tsx:221`). Every other rename in the app uses a dialog.
  - A failed initial message fetch sets `loadedOnce` and leaves `messages=[]` (`:168`), so the page shows "This is the very beginning of…" (`:789`) instead of an error. No retry.
  - Loading is a bare `Loader2` spinner (`:786`), not the ValueLoader.
  - No conversation info panel: member list is only visible inside "Add people"; there is no way to remove a member, see who is in a channel, set a topic/description, or archive/delete a channel (API has none of these either).
  - Any member can rename a group/channel and add people; there is no owner/admin concept (`api/conversations/[id]/route.ts:74-146`, `members/route.ts:5-7`).
  - Guest-link controls ("Copy guest call link" / "Reset guest call link") sit in the same menu as star/mute for every DM, which is confusing for a 1:1 chat; the reset wording "old links are dead" is the only revocation model.
  - Members pill disappears below 640 px (`hidden sm:`), leaving the ••• menu as the only path.
  - Message search results (sidebar) open the conversation but do not scroll to / highlight the hit (`chat-sidebar.tsx:504`).
  - Emoji: fixed 12 in composer, 9 in reaction picker, no search; reaction tooltips only.
  - `#general` auto-seeded per org on first list load (`api/conversations/route.ts:134-161`); channel default notify level "mentions" is not surfaced anywhere in UI.
  - Hardcoded `#0073EA` in `rich-body.tsx:69,71,97` instead of `var(--os-brand)`.
  - Naming residue: events/keys still say "room"/"TalkTok" (`:554`, `chat-sidebar.tsx:63`).

## 3. Shell-level call surfaces (in scope: calls/huddles UI)

### 3a. CallDock (`src/components/calls/call-dock.tsx`)
- Fixed, draggable dark window (`bg-zinc-900`, 360×440 expanded, 340×46 minimised), bottom-right by default, clamped to viewport. Header: live dot, roster faces (3 + "+N"), subject or roster text when minimised, `CallTimer`, mic toggle, camera toggle, "Open conversation" (only when `href` and expanded), minimise/expand, Leave (red).
- Body: `CallPanel` always mounted (hidden at h-0 when minimised) so audio survives navigation and the Settings takeover (`os-shell.tsx:89-92`).
- **Issues**: dark zinc-900 chrome inside an otherwise white Monday-clean app; no "pop out to page" or full-screen mode; there is no screen-share/participants/chat control in the header (they live inside LiveKit's VideoConference bar, hidden when minimised); no way to switch a call from audio to video from the dock other than the camera button.

### 3b. CallPanel + ConferenceSurface + MeetingCall
- `call-panel.tsx`: POSTs `/api/calls/token`; 503 (LiveKit env missing) silently falls back to the **public meet.jit.si** embed (`:49,60`; `meeting-call.tsx:55`); error state is a plain sentence. LiveKit path: `ConferenceSurface` = `<VideoConference/>` + reaction bar (5 emoji + Raise hand) + `RoomBridge` reporting mic/cam/roster to the dock.
- **Issues**: the Jitsi fallback changes the UX completely (prejoin screen, Jitsi chrome, watermark settings) and sends media to a third party with no admin visibility or setting; no env example documents `LIVEKIT_*` (grep of `.env.example` found none). `trailingControls` (record button) is wired in the type but never passed anywhere.

### 3c. IncomingCallWatcher (`incoming-call-watcher.tsx`)
- Polls `/api/calls/incoming` every 15 s while visible and not on a call, instant on SSE `workwrk:call-incoming`; rings once per conversation via top-right toast with Join (answers camera-off) / Dismiss, 45 s.
- **Issues**: when the Talk module is off the endpoint 403s every 15 s forever (`api/calls/incoming/route.ts:18`) and the watcher swallows it; no ring sound; no "answer with video"; the toast is the only ring surface (no full-screen incoming call UI).

### 3d. `/meet/[code]` (public guest door)
- **Purpose**: external guests / notetaker bots join a meeting (`<id>.<sig>`) or a huddle (`c.<id>.<epoch>.<sig>`) with only the signed code (`meet/[code]/page.tsx`). Name prompt, then guest token, else Jitsi fallback (`guest-call-client.tsx`).
- **Reachable from**: "Guest link" button on `/meetings/[id]`, "Copy guest call link" on `/tlk/[id]`, the toast after "New call link".
- **Back button**: none (standalone). **Top bar**: own header (title, org · time, "Powered by WorkwrK").
- **UI state**: polished, dark (`bg-zinc-950`), full viewport `h-dvh`, the only mobile-viable surface in this subsystem.
- **Issues**: hardcoded `#0073EA`/`#0060c2` (`guest-call-client.tsx:91`); no lobby / admit control (anyone with the link is in); meeting guest codes are an HMAC of the id only and never rotate or expire (`meeting-room.ts:23-24`), unlike chat links which rotate with `callEpoch`.

## 4. `/meetings` (list)

- **Title / purpose**: "Meetings" agenda-first cards: hero "Next up", "Later today", "This week", "Upcoming", "Past 30 days" (`meetings/page.tsx:3-17`).
- **Reachable from**: **URL-only / orphan**. No rail hub lists `/meetings` in `matchPaths` (`apps-catalog.tsx:1170-1342`), no sidebar links to it. Indirect entries: `g m` keyboard shortcut (`use-goto-nav.ts:24`), notification/email links (`api/meetings/route.ts:122,141`; action-item notifications), docs block-editor "Meetings" embed (`block-editor.tsx:2714,2725`), Notetaker "Recent extractions" cards, Talk sidebar "New call link" (`/meetings/<id>?call=1`), `/meetings/[id]` back button, catalog product tile comment (`lib/products/catalog.ts:73`).
- **Back button**: none.
- **Top bar**: global. In-page `OsTitleBar` "Meetings" with description "N total · N upcoming", fake avatar stack `PEOPLE.bb/sc/pr` + "+9" (`:201-202`), actions: **New meeting** (black `.mtg__new` button), plus the title bar's default **Ask AI / Share / Invite** trio.
- **Sidebar**: whatever hub was last active (stale) because no hub claims the path (`click-sidebar.tsx:89`); on a cold load it falls to `APPS[0]` = Work/Home.
- **Controls**: New meeting (creates "Untitled meeting", ADHOC, next full hour, 30 min, no form, then `window.location.href` hard navigation `:137-158`); hero card (whole card links to detail; inner **Join** / **Join call** link); meeting cards (link to detail). No filters, search, type tabs, calendar view, or pagination (`?limit=100` only).
- **UI state**: rough. Visual language is the older gradient "dashboard" style (type-hued top bars, radial glow, `.mtg__new` black button).
- **Issues**:
  - Orphaned from IA (above). Rail/sidebar do not reflect where the user is.
  - `OsTitleBar` **Ask AI / Share / Invite** have no handlers (`title-bar.tsx:89-111`): three dead buttons on this page.
  - Fake people avatars in the title bar (`:201`).
  - Load error uses `OsEmptyView cta="Retry"` without `onCta`, so no button renders and there is no retry (`:211`).
  - `New meeting` skips any form (title/time/attendees) and hard-reloads the app (`:157`).
  - Hero **Join call** is an `<a>`/`<Link>` nested inside the card `<Link>` (`:296-334`): invalid nesting, unpredictable click.
  - `useNoopRouter` dead code (`:108-109,250`).
  - Type colours map through legacy aliases (`C.purple`, `C.pink` -> brand/red, `catalog.ts:53-54`) so "Weekly review" and "Annual planning" render in brand blue / signal red: hue-keyed cards, which the design preference (Monday-clean single accent) rejects.
  - "Past 30 days" only; older meetings are unreachable from the UI.

## 5. `/meetings/[id]` (meeting room)

- **Title / purpose**: bespoke two-column meeting room: notes editor with Voice record / AI summary / Paste transcript on the left; Agenda, Attendees, Decisions, Action items cards on the right (`meetings/[id]/page.tsx:3-13`).
- **Reachable from**: `/meetings` cards, `?call=1` from "New call link", notifications, Notetaker recents, docs embed.
- **Back button**: yes, custom `.mtgr__back` arrow that always `router.push("/meetings")` (`:559`); the not-found state also has "Back to meetings" (`:540`). Not the shared `BackButton{fallbackHref}` and ignores history.
- **Top bar**: global. In-page header: type chip, "Live now" / "Completed" badge, date·time, duration, inline-editable title (saves on blur), **Join call / In call** (brand), **Guest link** (copies), **Delete** (`:558-615`).
- **Sidebar**: stale (no hub claims the path).
- **Controls**: title input; Voice record (Web Speech API, Chrome only, hidden elsewhere `:216`); AI summary (POSTs `/api/ai`, replaces notes with a MOM block `:257`); Paste transcript modal; notes textarea (auto-save 2.5 s, status "Saving… / Unsaved / All changes saved"); Agenda textarea (saves on blur); Attendees list (read-only, check icon if attended); Decisions (+ modal, remove X); Action items (+ modal: title, assignee select of attendees + all org users, deadline; toggle done; convert to task; delete); Delete meeting modal; `?call=1` auto-join.
- **UI state**: rough-to-polished visually (custom BEM `.mtgr-*` with tokens) but functionally incomplete.
- **Issues**:
  - The "N unfinished actions from your last <type>" follow-up never renders: `fetchPrevIncomplete` reads `all?.data?.items` but `/api/meetings` returns `{ data, pagination }` (`:399` vs `lib/pagination.ts:34-46`). Dead feature.
  - Scheduled time, duration, type and attendees cannot be edited in the UI though `PUT` accepts `scheduledAt/duration/type/attendeeIds` (`api/meetings/[id]/route.ts:67`). Instant calls therefore stay "Instant call · 60 min · ADHOC" forever.
  - No attendee picker at all; attendees only come from the create API or Notetaker matching.
  - Notes are a plain textarea (no BlockNote/doc editor, no formatting), disconnected from Docs "Meeting Notes" view (`docs-sidebar.tsx:124`), which is a docs filter, not this page.
  - Decisions store `decidedBy: ""` always; date is added but not editable.
  - Adding an action item also auto-creates a `[Action Item]` Task (`action-items/route.ts:66-75`) AND "Convert to task" creates another Task: duplicates by design; no link back from either.
  - Access: any org member can open, edit, and delete any meeting including 1:1 notes (org-scoped only, `api/meetings/[id]/route.ts:61-64,129-134`); action-item PUT/DELETE look up by id with no org scope (`action-items/route.ts:106-109,141-144`).
  - Custom `Modal` (`:306-323`) instead of the shared `ui/dialog`.
  - Voice record is Chrome-only and hides itself elsewhere with no hint.
  - Hover-transform on `.mtg-hero:hover` box-shadow only (ok), but `transition: all` everywhere.

## 6. `/notetaker` ("Clips")

- **Title / purpose**: "Notetaker": paste a transcript, Claude extracts title/type/summary/decisions/action items/attendees, save as a Meeting (+ optional Tasks) (`notetaker/page.tsx:3-12`).
- **Reachable from**: Rail hub **Docs** > sidebar "Content" > **Clips** (`docs-sidebar.tsx:159`); ⌘K quick action "Open AI Notetaker" (`command-palette.tsx:277`); profile Personal Tools "AI Notetaker" (`profile-tools.ts:43`, pinnable to top bar). The folded `clips` app (`apps-catalog.tsx:1223-1225`) is `offRail`, so its own `ClipsSidebar` (`:1086-1097`) is never rendered.
- **Back button**: none.
- **Top bar**: global. In-page `OsTitleBar` "Notetaker", fake avatars `PEOPLE.bb/sc` + "+2" (`:149-150`), actions **Try example**, **Clear**, plus the dead **Ask AI / Share / Invite** trio.
- **Sidebar**: DocsSidebar (All/My/Shared/Private/Meeting Notes/Archived; Content: Notes/Canvases/Files/**Clips** active; Process; Favorites; Pages tree).
- **Controls**: transcript textarea (char count, 20-char minimum hint), **Extract**; result pane: Meeting title input, Type select (6 enum), Summary textarea, Decisions list, Action items list, Attendees chips, **Spawn a task for each action item** checkbox, **Save meeting**; "Recent extractions" grid linking to `/meetings/<id>`.
- **UI state**: **broken**.
- **Issues**:
  - Extraction result never populates: the page does `setExtracted(data.data ?? data)` (`:100`) but `/api/notetaker/process` returns `{ extraction, rawText, tokensIn, tokensOut }` (`api/notetaker/process/route.ts:107-112`). `extracted.title` is undefined, every list reads "No decisions captured / No action items detected / No attendees identified", and **Save meeting** stays disabled unless the user hand-types a title (then saves an empty meeting). The core flow is dead.
  - Naming: "Clips" (Docs sidebar, catalog), "Notetaker" (page, catalog stub `catalog.ts:615`), "AI Notetaker" (⌘K, profile tools). "Clips" implies video clips; nothing here records or clips anything.
  - "Editable" badge and "Every field is editable before you save" copy (`:196,209`) are false: decisions, action items and attendees are read-only lists.
  - "Recent extractions" lists any meeting with notes or action items (`:83`), not extractions.
  - `ClipsSidebar` dead code: "All Clips" / "My Clips" (`?mine=1`, ignored by the page) / "Favorites: Star a Clip to see it here" (no star affordance exists).
  - `/clips` in matchPaths does not exist (404).
  - Recents loader is `Loader2 + text`; extraction uses custom bouncing dots; neither is the ValueLoader.
  - Primary button is a brand gradient (`.ntk__btn--primary`, `os.css:8217-8228`) vs flat brand buttons elsewhere.

## 7. `/announcements`

- **Title / purpose**: "Announcements": org broadcast feed grouped Pinned then by priority, KPI strip (Urgent / Ack pending / Pinned / Total), ack banner, search + type filter chips, composer dialog, ack-status dialog (`announcements/page.tsx:3-8`).
- **Reachable from**: Rail hub **Talk** > sidebar **Announcements** link (hr-admin only, `chat-sidebar.tsx:268-275`); folded app "Announce" (`apps-catalog.tsx:1257-1259`, hr-admin, offRail so never in rail/More); ⌘K "Post an announcement" (`command-palette.tsx:278`, shown to everyone); `g n` (`use-goto-nav.ts:27`); notification/email links (`api/announcements/route.ts:180,198`); orphaned `OsAnnouncementsPopover` footer link. Talk hub is highlighted because `/announcements` is in its matchPaths (`apps-catalog.tsx:1187`), even though announcements are not module-gated.
- **Back button**: none.
- **Top bar**: global. In-page `OsTitleBar` "Announcements" + description "N announcements · N need your ack · N urgent", actions: **Policies** link (`/policies`), **New announcement** (orange→red gradient, only when `usePermission("announcements","create")`), plus dead **Ask AI / Share / Invite**.
- **Sidebar**: ChatSidebar (Talk hub).
- **Controls**: KPI tiles (static); ack banner; search input; type filter chips All/Info/Warning/Policy/Event/Celebration with counts; cards: type pill, priority pill, Pinned, relative time, title, content, Expires, **Ack status** (managers, must-ack only), **Acknowledge** / "You've acked", decorative chevron.
- **Composer** (`composer-dialog.tsx`): Title (160), Content, **Who sees this** (Everyone / Departments / Offices / People / Tags with checkbox grid loaded from `/api/departments|offices|tags|users`), Type chips, Priority chips, a second **Audience** block ("Everyone in the organization" fixed + "Specific teams / roles · Coming soon" disabled), toggles **Pin to top** / **Require acknowledgment**, **Schedule for later** (datetime-local), **Expires on** (required, default +30 d), error banner, Cancel / Post|Schedule.
- **Ack status dialog** (`ack-status-dialog.tsx`): "Organization-wide" N/N bar, Acknowledged list with timestamps, Pending list.
- **UI state**: rough. Uses `--os-*` tokens but the KPI-strip + hue-keyed cards + gradient CTA read as the older dashboard style.
- **Issues**:
  - Two contradictory audience controls in the composer: the live "Who sees this" selector (`:217-273`) and the legacy "Audience … Coming soon" block (`:323-339`). The header comment (`:9-12`) still says targeting is not enforced although `lib/announcement-audience.ts` and the GET filter enforce it.
  - Ack status says "Organization-wide" and the roster is the whole org minus author (`acknowledge/route.ts:93-107`), so a department-targeted must-ack shows everyone else as "Pending" although they can never see it.
  - No edit / delete / unpin / extend-expiry UI although `PATCH` and `DELETE /api/announcements/[id]` exist. Cards show a chevron arrow (`:302`) but are not clickable and there is no detail page.
  - Discoverability gap: `announcements.create` is granted to `managerAccess` (`lib/permissions.ts:262`), but the only nav entries are hr-admin-gated (sidebar link, Announce app). A manager reaches the page only via ⌘K/`g n`/a notification. Conversely ⌘K "Post an announcement" is offered to employees who cannot post.
  - Three different gates: nav = hr-admin tier; page CTA = permission matrix; API mutate = `isManager` (includes TEAM_LEAD and HR, `api-helpers.ts:56-66`); ack roster = `isManager`.
  - `PATCH /api/announcements/[id]` updates by id with no org scope (`[id]/route.ts:26`); DELETE is scoped.
  - Load error `OsEmptyView cta="Retry"` has no `onCta` so no retry renders (`:203`).
  - `canManage` is `false` while the permission matrix loads, so "New announcement" pops in late.
  - Expiry is mandatory (server and client) with a 30-day default; there is no "never expires" although the GET tolerates `expiresAt: null`.
  - The dead **Policies** link is shown to everyone although Policies is an hr-admin app in the catalog (`apps-catalog.tsx:1296-1301`).
  - Feed shows a maximum of 50 (`route.ts:34`), no pagination, no archive of expired posts.
  - Orphan `OsAnnouncementsPopover` reads `a.acknowledged` (`announcements-popover.tsx:61,83,117`) while the API returns `ackedByMe`; it is not mounted anywhere.
  - Legacy `AnnouncementsBanner` on `/dashboard` (`announcements-banner.tsx`): pre-OS shadcn Card, `text-muted`, rgba accents, `animate-pulse-glow`; its Dismiss POSTs `/announcements/[id]/dismiss` but the GET never filters `AnnouncementDismissal`, so dismissed posts return on reload (cosmetic control).
  - Bell notifications link to `/announcements` generically, not to the specific post.

---

## 8. Broken / confusing (ranked)

| # | Severity | Where | What |
|---|---|---|---|
| 1 | high | `notetaker/page.tsx:100` vs `api/notetaker/process/route.ts:107` | Extraction result envelope mismatch: result pane always empty, Save disabled. Notetaker is non-functional end to end |
| 2 | high | `apps-catalog.tsx:1170-1342`, `click-sidebar.tsx:89` | `/meetings` and `/meetings/[id]` belong to no hub: no rail highlight, stale sidebar, no sidebar link anywhere; reachable only by `g m`, notifications, docs embed, Notetaker recents, Talk "New call link" |
| 3 | high | `title-bar.tsx:89-111` | `OsTitleBar` Ask AI / Share / Invite have no onClick: dead controls on Meetings, Notetaker, Announcements |
| 4 | high | `api/meetings/[id]/route.ts:61-64,129-134`; `action-items/route.ts:106,141`; `announcements/[id]/route.ts:26` | Any org member can edit/delete any meeting (including 1:1 notes); action-item PUT/DELETE and announcement PATCH are not org-scoped (cross-org IDOR) |
| 5 | high | `chat-sidebar.tsx:268`, `apps-catalog.tsx:1257`, `lib/permissions.ts:262` | Managers who can post announcements have no navigation entry (nav gated hr-admin); employees see a "Post an announcement" ⌘K action they cannot use |
| 6 | high | `call-panel.tsx:49,60`, `meeting-call.tsx:55` | Calls silently fall back to public meet.jit.si when `LIVEKIT_*` is unset; different UX, media leaves the server, no admin setting or visibility |
| 7 | medium | `meetings/[id]/page.tsx:399` | "Unfinished actions from your last meeting" alert never renders (reads `data.items` from a `{data, pagination}` payload) |
| 8 | medium | `composer-dialog.tsx:217-273` vs `:323-339` | Two audience controls, one live and one "Coming soon", in the same dialog |
| 9 | medium | `ack-status-dialog.tsx:101`, `acknowledge/route.ts:93-107` | Ack roster is org-wide regardless of the announcement's audience; "Pending" lists people who cannot see the post |
| 10 | medium | `announcements/page.tsx:268-306` | No edit/delete/unpin UI for announcements; cards carry a decorative chevron and are not clickable; no detail page |
| 11 | medium | `meetings/page.tsx:137-158`; `meetings/[id]/page.tsx:558-615` | "New meeting" creates an untitled ADHOC meeting with no form and hard-reloads; time/duration/type/attendees are not editable anywhere in the UI |
| 12 | medium | `chat-sidebar.tsx:166-177`, `api/meetings/instant/route.ts` | "New call link" mints a permanent "Instant call" Meeting per click and navigates out of Talk into the orphaned `/meetings` |
| 13 | medium | `docs-sidebar.tsx:159`, `notetaker/page.tsx:145,196,209`, `command-palette.tsx:277`, `profile-tools.ts:43` | Three names (Clips / Notetaker / AI Notetaker); "Editable" and "every field is editable" are false; "Recent extractions" lists any meeting with notes |
| 14 | medium | `apps-catalog.tsx:1086-1097,1198,1224` | `ClipsSidebar` is unreachable (offRail); `?mine=1` ignored; `/clips` route does not exist (404); permanent "Star a Clip" empty state with no star affordance |
| 15 | medium | `announcements-popover.tsx` (unmounted), `announcements-banner.tsx:41-44` | Orphaned popover with wrong field name; legacy dashboard banner whose Dismiss is cosmetic (GET never filters dismissals) and uses pre-OS dark-theme styling |
| 16 | medium | `tlk/[id]/page.tsx:613`, `chat-composer.tsx:221` | `window.prompt` for rename and link insertion |
| 17 | medium | `tlk/page.tsx:22`, `chat-sidebar.tsx:262-267` | Talk has no landing/overview (always redirects into the newest conversation); "Directory" row navigates out of the hub |
| 18 | medium | `meetings/page.tsx:296-334` | `<a>`/`<Link>` nested inside the hero `<Link>` card (invalid nesting) |
| 19 | medium | `meetings/page.tsx:211`, `announcements/page.tsx:203` | Error states pass `cta="Retry"` without a handler: no retry renders |
| 20 | medium | `meetings/page.tsx:201`, `notetaker/page.tsx:149-150` | Fabricated avatar stacks (`PEOPLE.bb/sc/pr`, "+9", "+2") in page headers |
| 21 | medium | `tlk/[id]/page.tsx:168,789` | Failed message fetch renders the "very beginning of…" intro instead of an error |
| 22 | medium | `api/conversations/[id]/route.ts:74-146`, `members/route.ts` | No owner/admin for groups or channels: any member renames, adds people; nobody can remove members, archive or delete a channel; no private channels |
| 23 | low | `tlk/page.tsx:49`, `tlk/[id]/page.tsx:786`, `chat-sidebar.tsx:405`, `notetaker/page.tsx:325`, `ack-status-dialog.tsx:93` | Loader inconsistency (plain text / `Loader2` / custom dots) vs ValueLoader on Meetings and Announcements |
| 24 | low | `meetings/[id]/page.tsx:559` | Custom back arrow always pushes `/meetings`; not the shared `BackButton{fallbackHref}` |
| 25 | low | `meeting-room.ts:23-24` | Meeting guest links never expire or rotate (chat links do) |
| 26 | low | `rich-body.tsx:69,71,97`, `guest-call-client.tsx:91` | Hardcoded `#0073EA` instead of `--os-brand` |
| 27 | low | `incoming-call-watcher.tsx:55`, `api/calls/incoming/route.ts:18` | 15 s poll keeps hitting a 403 when Talk is off |
| 28 | low | `meetings/page.tsx:108,250` | `useNoopRouter` dead code |
| 29 | low | `api/meeting-templates`, `api/calendar/meetings` | APIs with no UI consumer |
| 30 | low | `chat-sidebar.tsx:504` | Message search hit opens the conversation without scrolling to the message |
| 31 | low | `announcements/page.tsx:153` | "Policies" link shown to everyone although Policies is hr-admin |
| 32 | low | `os.css:8217`, `:11358`, `:17452` | Three different primary-button treatments (brand gradient, orange→red gradient, black) on adjacent pages |

---

## 9. Cross-cutting conventions observed

### Back navigation
- The app convention (memory: `BackButton{fallbackHref}` on every detail route) is used **nowhere** in this subsystem.
- `/meetings/[id]` has a custom `.mtgr__back` that always `router.push("/meetings")` (`meetings/[id]/page.tsx:559`), plus a "Back to meetings" button in the not-found state.
- `/tlk/[id]`, `/tlk`, `/notetaker`, `/announcements`, `/meet/[code]` have no back affordance; navigation relies on the secondary sidebar.
- Dialog-based flows (composer, ack status, add people, new chat/channel, confirm) close via Radix `Dialog` or a custom `Modal` (`meetings/[id]/page.tsx:306-323`).

### Loader
- Route transitions: `(dashboard)/loading.tsx` renders `ValueLoader size={40}` (mission/values loader).
- In-page: `ValueLoader size={32}` on Meetings list, Meeting detail, Announcements; plain text on `/tlk` ("Opening your conversations…") and the chat sidebar ("Loading conversations…"); `Loader2` spinner on `/tlk/[id]`, thread/older pager, Notetaker recents, Ack dialog, CallPanel ("Starting the call…"); custom three-dot "Claude is reading your transcript…" on Notetaker.

### Empty / error states
- `OsEmptyView` (icon tile + title + subtitle + chips + CTA) on Meetings and Announcements for both empty and error; CTA only renders with a handler, so the error "Retry" variants render no button.
- Custom empties: `/tlk` hero card + "Start a conversation"; `/tlk/[id]` "Say hello 👋" + Slack "very beginning" intro; chat sidebar inline "No conversations yet…"; Notetaker `.ntk__empty` feature list; Ack dialog "No one has acknowledged yet." / "Everyone has acknowledged. 🎉"; `ModuleDisabledScreen` for Talk-off (`module-disabled.tsx`).
- Errors: `/tlk/[id]` metaError plain sentence; message-fetch failure is invisible; CallPanel/MeetingCall plain sentence; toasts (`useOsToast`) for every mutation failure in chat; composer dialogs use inline red text/banners.

### Style consistency
- **Talk surfaces** (`tlk/*`, `components/chat/*`, `chat-sidebar.tsx`, dialogs): Tailwind zinc scale + `var(--os-brand)` / `--os-brand-soft` / `--os-brand-hover`, 13-14 px type, flat borders, h-8 controls. Matches the Monday-clean flat-blue direction and the 2026-08-20 type scale.
- **Meetings / Notetaker / Announcements**: bespoke BEM CSS families in `os.css` (`.mtg`/`.mtgr` 17450-17895, `.ntk` 8198-8495, `.ann` 11339-11526, `.ann-pop` 7152-7340). They do use `--os-*` tokens (ink/surface/line/brand/c-*) but keep the pre-pivot "dashboard" idiom: per-type hue variables (`--mtg-color`, `--c-c`, `--p-c`) on cards, gradient top bars and radial glows on the hero (`os.css:17488-17502`), gradient primary buttons (`.ntk__btn--primary` brand gradient `:8218`; `.ann__btn-primary` orange→red `:11358`), a black `.mtg__new` button, uppercase letter-spaced section headers, KPI tiles, `transition: all`. Legacy `C.purple/pink/indigo` aliases resolve to brand/red/deep (`catalog.ts:53-55`), so "Weekly review", "Annual planning", "Celebration" and "Policy" all render brand-blue or signal-red.
- `OsTitleBar` (legacy header) on those three pages: star + title + description + fake avatar stack + page actions + dead Ask AI / Share / Invite.
- **Call chrome**: CallDock and guest page are dark (`zinc-900`/`zinc-950`), LiveKit default theme; the only dark UI in the app.
- **Legacy**: `AnnouncementsBanner` uses shadcn `Card`/`Button`, `text-muted`, rgba borders, `animate-pulse-glow` (pre-OS dark theme).
- Hardcoded brand hex in `rich-body.tsx` and `guest-call-client.tsx`.

### Mobile / responsive
- `OsShell` has no breakpoints: fixed 88 px rail + 200-320 px resizable sidebar + main, `h-screen overflow-hidden` (`os-shell.tsx:102-114`). Nothing collapses on narrow viewports.
- Page-level media queries only: `.ntk__grid` ≤1100 px, `.ntk__result-row` ≤700 px, `.ann__kpis` ≤900 px (4→2 columns), `.mtgr__body` ≤1100 px (2→1 column). No rules for `.mtg` cards or `.ann__toolbar`.
- Chat: members pill hidden below 640 px; thread panel `w-full max-w-[420px]`; composer toolbar has no wrap; CallDock is fixed 360×440 and clamped but not resized for small screens.
- `/meet/[code]` is `h-dvh` full-viewport and is the only phone-usable screen in scope.

---

## 10. Access notes

- **Talk module gate**: server layout `tlk/layout.tsx` + every conversations/calls API via `getSessionAndModule("workwrk-talk")`. Module is OFF for new orgs; SUPER_ADMIN / COMPANY_ADMIN enable it at `/settings/modules` (`settings/modules/page.tsx:20`); others get "Ask a workspace admin". `/announcements` is inside the Talk hub's matchPaths but is not module gated (works with Talk off, while the sidebar it sits in belongs to a hidden hub).
- **Conversations**: membership is the only key (404 for non-members). Channels are org-open (anyone can list and self-join, `join/route.ts`); DMs/groups are invite-only but **any member** can add people (`members/route.ts:5`), rename groups/channels (`[id]/route.ts:88-112`), and there is no remove-member, archive, delete, private channel, or moderation. `#general` cannot be left or renamed. Star/mute/close are per-member.
- **Calls**: `/api/calls/token` gates chat calls on the module and membership; meeting calls are open to any org member, attendee or not (`token/route.ts:56-75`). Guest links: anyone holding the link joins with just a name, no lobby. Meeting guest codes never expire; chat codes rotate on leave / manual reset. When `LIVEKIT_*` env is absent everything falls back to public Jitsi.
- **Meetings**: no page gate, no creator/attendee ACL; any org member can view, edit, and delete any meeting; action-item PUT/DELETE are not even org-scoped; PATCH convert-to-task requires meeting match. Notetaker save creates meetings with no attendee ACL either.
- **Notetaker**: any authenticated member; consumes the org's Anthropic key via `getAnthropicForOrg`.
- **Announcements**: view = everyone in the org, filtered to the audience (author and any `isManager` level see everything, `announcements/route.ts:49-55`). Create = permission matrix `announcements.create` (manager presets and full access; employees/agents no; HR preset needs checking in `permissions.ts:48`). Edit/delete/ack-roster = `isManager` (SUPER_ADMIN…TEAM_LEAD, HR) with **no UI**. Nav entries (Talk sidebar link, folded "Announce" app) = hr-admin tier only. Result: three inconsistent gates and a manager-shaped gap.
- **IDOR-class gaps**: `PATCH /api/announcements/[id]` (`[id]/route.ts:26`), `PUT/DELETE /api/meetings/[id]/action-items` (`action-items/route.ts:106-109,141-144`).

## 11. Settings notes

**Configurable today**
- Talk module on/off (Settings → Modules, admin only).
- Per conversation, per member: star, notify level (all / mentions / mute; channels default "mentions"), close a DM, leave group/channel, rename group/channel, reset the guest call link.
- Per user, browser-local only: sidebar section collapse (`workwrk:room:sections`), formatting bar visibility (`workwrk:room:fmtbar`), sidebar width.
- Announcement composer per post: type, priority, audience (everyone / departments / offices / people / tags), pin, must-ack, schedule, expiry (required).
- Meeting: title, agenda, notes, decisions, action items (via detail page); type/summary via Notetaker before save; "Spawn a task for each action item" checkbox.

**Should be configurable but is not**
- Talk: workspace-level defaults for channel notification level, who may create channels, private channels, channel topic/description, member removal and ownership, archive/delete, DND / quiet hours, ring sound / desktop ring preference, default camera state on answer, retention.
- Calls: LiveKit connectivity is env-only with a silent Jitsi fallback; admins have no page showing whether native calls are configured, no toggle to forbid the public-Jitsi fallback, no guest-link policy (lobby, expiry), no recording toggle (`trailingControls` exists but is never wired).
- Meetings: scheduled time, duration, type, attendees are not editable in the UI; meeting types are a hardcoded enum; `/api/meeting-templates` exists with no UI; no calendar sync setting surfaced here (`/api/calendar/meetings` unused); no visibility/ACL setting (all meetings are org-public).
- Notetaker: no option for live capture / bot invitation despite the guest-link copy promising "AI notetaker bots"; no model/key indicator; no way to edit extracted decisions/action items/attendees before save.
- Announcements: no edit/delete/unpin/extend UI; no "never expires"; no ack reminders or escalation; no per-user dismiss enforcement; no cross-post to a Talk channel; the "who can post" rule lives in the Permissions matrix while the nav gate is a separate hardcoded tier (should be one source).
