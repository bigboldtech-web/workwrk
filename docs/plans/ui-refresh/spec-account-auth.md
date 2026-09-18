# Account, auth, onboarding and session spec

Unit: everything a person meets before the app opens (log in, start free, join a workspace, reset a password, verify an email, first run) and everything about themselves once inside (My settings: profile, preferences, notifications, security, calendar connections, keyboard shortcuts), plus the session surfaces that cut across both (two step verification, sign out everywhere, security activity, workspace switching, session expiry).

Written against, and subordinate to: `design-system.md` (look), `access-model-spec.md` (access), `settings-architecture.md` (settings structure), `spec-template.md` (this structure), `zoho-reference.md`, `critic-gaps.json`, `phase2-inputs.md`, `existing-direction.md`, `route-list.txt`. Audit evidence from `auth-onboarding.md` and `settings-pages.md`, re-checked against the code at `6187227a`.

Writing rules honoured: no em dashes, no double hyphens in prose. Code tokens such as `--os-brand` are code.

---

## 0. Scope

### Routes covered

| URL | File under `src/app` |
|---|---|
| `/account/profile` | `(dashboard)/account/profile/page.tsx` |
| `/account/preferences` | `(dashboard)/account/preferences/page.tsx` (new; absorbs `appearance`) |
| `/account/notifications` | `(dashboard)/account/notifications/page.tsx` (today a redirect; becomes the real page) |
| `/account/security` | `(dashboard)/account/security/page.tsx` |
| `/account/connections` | `(dashboard)/account/connections/page.tsx` (new) |
| `/account/shortcuts` | `(dashboard)/account/shortcuts/page.tsx` (new) |
| `/account/all` | `(dashboard)/account/all/page.tsx` (new) |
| `/login` | `(auth)/login/page.tsx` |
| `/signup` | `(auth)/signup/page.tsx` (new file; the self serve half of today's `register`) |
| `/join` | `(auth)/join/page.tsx` (new file; the invite half of today's `register`) |
| `/forgot-password` | `(auth)/forgot-password/page.tsx` |
| `/reset-password` | `(auth)/reset-password/page.tsx` |
| `/verify-email` | `(auth)/verify-email/page.tsx` |
| `/onboard` | `onboard/page.tsx` (the one wizard) |

Shared chrome files this unit owns: `(auth)/layout.tsx`, `onboard/layout.tsx`, `(dashboard)/account/layout.tsx`.

Non URL surfaces this unit owns and specifies in §2 (each gets a block): MFA enrolment dialog, MFA turn off dialog, backup codes dialog, Change password dialog, Sign out everywhere confirm, Security hold dialog, Session expired re-login (the auth half), Switch workspace flow, Delete my account dialog, Invited member first run hint.

### Routes REMOVED / REDIRECTED / MERGED

Every one is a 308 in `next.config.ts` unless stated. Query strings are preserved.

| Today | Target | Reason |
|---|---|---|
| `/account` (no page, 404 today) | `/account/profile` | Bare door prefix must land somewhere. Closes `settings-pages.md` #18. |
| `/account/appearance` | `/account/preferences?tab=appearance` | Settings architecture §4.2 merges Appearance, Language & region, and Sidebar into one Preferences page. |
| `/register` | `/signup` | One label for one destination. The marketing site, the founder's concept doc and 24 CTAs all point at `/signup` (critic #9 naming drift, marketing #1). |
| `/register?token=X` | `/join?token=X` | Two different jobs shared one form. Splitting them is what lets the join page show the org, the inviter, the role and the message. |
| `/welcome` | `/onboard` | Its three steps persisted nothing (`POST /api/onboarding-progress` is a GET only route, B2) and one of its two questions (job title) is a placement field a person may not set for themself (access spec §3.5, settings spec §9.2a). Retiring the URL also means deleting `pages.newUser: "/welcome"` from `authOptions` (`src/lib/auth.ts:267-269`), which is the config line that still names it; with the key gone NextAuth falls back to `pages.signIn`, and the 308 stops being load bearing. `/onboard` offers an invited member the way on to `/today`, so no visitor of the old URL hits a dead end. |
| `/setup` | `/onboard` | Two wizards wrote one flag (B4). `/onboard` is the survivor because the dashboard gate already points at it. |
| `/settings/notifications` | `/account/notifications` | Personal preferences belong in the personal door (settings spec §8.4). |
| `/settings/calendar` | `/account/connections` | The backend is per user (`CalendarSubscription`); the org page was a stub (settings spec §4.5, audit `settings-pages.md` 1.16). |
| `/settings?tab=themes` | `/account/preferences?tab=appearance` | Profile menu dead row (`settings-pages.md` #10). |
| `/settings?tab=shortcuts` | `/account/shortcuts` | Same. |
| `/dashboard` | `/today` (exists today) | Kept. Nothing in this unit links to `/dashboard` any more; the login default `callbackUrl` becomes `/today`. |
| `/loader-preview` | deleted, no redirect | A dev preview of `DotsLoader` with zero inbound links in `src`, shipped publicly and unauthenticated (B27). It is not a destination. It is re-created as a Vitest snapshot plus a `NODE_ENV !== "production"` guarded page under `src/app/(dev)/loader-preview` so the loader can still be eyeballed locally. |

Nothing else in this unit disappears. `/account/notifications` stops being a redirect and becomes the page; `/settings/notifications` becomes the redirect.

### Routing tables changed (`src/proxy.ts`)

A 308 in `next.config.ts` is not enough on its own, because the host split and the edge gate read their own literal lists in `src/proxy.ts` and neither list knows the two new URLs. Today `APP_PREFIXES` (`src/proxy.ts:41-55`) holds `login`, `register`, `forgot-password`, `reset-password`, `verify-email`, `welcome`, `onboard`, `setup` and `AUTH_PUBLIC_PREFIXES` (`:67-69`) holds `login`, `register`, `forgot-password`, `reset-password`, `verify-email`. Neither holds `signup` or `join`. Left alone, a "Start free" click on the marketing host is not recognised as an app path, so it is never sent to the app host and lands on the chrome-less root 404, and with `AUTH_EDGE_GATE=true` a signed out person opening an invitation link at `/join` is bounced to `/login`. Step A0 makes these edits, in this order, in one change with the 308s:

| Set | Add | Keep for now | Remove, and when |
|---|---|---|---|
| `APP_PREFIXES` | `signup`, `join` | `register`, `welcome`, `setup` (a marketing-host hit on an old URL must still be sent to the app host so the 308 can run there) | `welcome` and `setup` after two releases; `register` with the invitation links, per risk 1 |
| `AUTH_PUBLIC_PREFIXES` | `signup`, `join` | `register` | as above |

`onboard` stays out of `AUTH_PUBLIC_PREFIXES`: the wizard needs a session, and a signed out visit is the one redirect the access model allows. This is the whole of the routing change; nothing else in `proxy.ts` moves.

### Audit inventories consulted

`auth-onboarding.md`, `settings-pages.md`, `critic-gaps.json`, `route-list.txt`, plus the three decided specs and `zoho-reference.md`.

### Audit issue IDs this unit resolves

From `auth-onboarding.md` §2: **B1, B2, B3, B4, B5, B6, B8, B9, B10 (the personal half), B11, B12 (the landing half), B13, B14, B15 (the accept half), B16, B17, B18, B19, B20, B21, B22, B24, B25, B26, B27, B28, B29**. B7 (dead checklists and tour) is resolved for the checklist half here and handed to the shell for the tour half; B10's org security editor and B12's default Space are the settings unit's and the spaces unit's.

From `settings-pages.md` §2: **3 (the `/account/*` half), 8, 10, 13, 18, 19, 20, 22, 23, 24, 25, 26**. Issues 1, 2, 4, 5, 6, 7, 9, 11, 12, 14, 15, 16, 17, 21, 27, 28, 29, 30, 31, 32 belong to the Workspace door and to other units.

From `critic-gaps.json` `topSystemicIssues`: **#2** (fabricated chrome: the `OsTitleBar` trio and the invented security score on `/account/security`), **#3** (duplicate surfaces: `/setup` versus `/onboard`), **#4** (access fragmentation: who may run org setup, who may invite, the personal door's own gate), **#5** (back navigation: four patterns inside one shell), **#6** (five visual systems: four of them live in this unit), **#7** (settings that do nothing: locale, presence, mute, quick tools, sidebar width, desktop notifications), **#8** (core flows broken end to end: `/signup` 404, `/welcome` unstyled, `/onboard` skip loop, wiped departments), **#9** (naming drift: Sign in / Log in / Register / Create account / Join), **#11** (swallowed errors and no session expiry handling), **#13** (no per user time zone, week start, date format), **#15** (copy hygiene in auth and wizard strings), **#10** (desktop only, zero breakpoints, cited on `settings-shell.tsx:185`, which is this unit's own takeover chrome) and **#14** (dead code and stale registries, whose auth evidence is B7 and B13). `missedSurfaces`: session expiry and 401 (here and in the shell), the cookie consent banner mount, the keyboard shortcut page.

---

## 1. Unit-level rules

### Hub and sidebar

| Route family | Rail hub active | Secondary sidebar | Active row |
|---|---|---|---|
| `/account/*` | **Settings** (`alwaysPinned`, bottom of the rail, shell spec §2.1) | the **My settings** door list, 264px (replaces the hub sidebar; shell spec §2.8) | the row whose `href` is the first path segment pair of the URL, derived from `usePathname()` on every render, never from `activeAppKey` and never sticky (critic contradiction 2) |
| `/login`, `/signup`, `/join`, `/forgot-password`, `/reset-password`, `/verify-email` | none (no rail, no top bar, no sidebar: the `(auth)` shell) | none | n/a |
| `/onboard` | none (its own full screen layout) | none | n/a |

The rail Settings hub opens `/settings` for an Owner or Admin and `/account/profile` for everyone else (settings spec §2.3). The rail and the navy top bar stay mounted over the settings takeover (design system §4.6, confirmed by shell spec §2.8); only the sidebar and the content column are replaced.

### My settings door sidebar, in full

This is the one secondary sidebar this unit owns. 264px, `--os-side-bg` (N50), `border-inline-end: 1px solid var(--os-line)`, rows 36px `.os-row`, 20px Lucide icons at `--os-ink-2`, labels 15/400 `--os-ink`, active row `--os-side-pill` (N200) pill radius 8 with the label at 15/500 and the icon at `--os-ink` (never blue, never a left bar, no transform). A 36px filter input sits at the top ("Find a setting", focused by `⌘/`) and filters both rows and, beneath a matching row, the individual field labels from the registry (settings spec §8.2).

| # | Label | Icon | href | Gating | Badge | Collapsed |
|---|---|---|---|---|---|---|
| 1 | Profile | `CircleUser` | `/account/profile` | every signed in person | none | n/a |
| 2 | Preferences | `SlidersHorizontal` | `/account/preferences` | every signed in person | none | n/a |
| 3 | Notifications | `Bell` | `/account/notifications` | every signed in person | "Muted" chip 12/500 `--os-ink-2` when `home.notifications.mutedUntil` is in the future | n/a |
| 4 | Security | `ShieldCheck` | `/account/security` | every signed in person | a 6px `--os-attention` `Dots` variant `unread` when the org requires MFA for this person's role and they are not enrolled | n/a |
| 5 | Calendar & connections | `CalendarCheck` | `/account/connections` | every signed in person | none | n/a |
| 6 | Keyboard shortcuts | `Keyboard` | `/account/shortcuts` | every signed in person | none | n/a |
| 7 | All settings | `List` | `/account/all` | every signed in person | none | n/a |

No group labels: the list is flat at seven rows (settings spec §1). There is no create action in a personal door header, so the header holds only the filter field. Owners and Admins see one extra row **below a 1px `--os-line` separator**, "Workspace settings" with `Building2` → `/settings`, so the two doors are one keystroke apart; nobody else sees it. The Workspace door's own sidebar is listed in `settings-architecture.md` §1 and is not repeated here.

### Naming canon

| Destination or object | The one label | Replaces |
|---|---|---|
| The personal settings door | **My settings** | Settings, Personal, Account, Account settings |
| `/account/profile` | **Profile** | My Profile (that label belongs to `/people/me`), Personal info, Edit personal info |
| `/account/preferences` | **Preferences** | Appearance, Themes, Display |
| `/account/security` page title | **Security** | "Account · Security" (`settings-pages.md` #25) |
| `/account/connections` | **Calendar & connections** | Calendar feeds, Calendar integrations, Integrations |
| The act of getting in | **Log in** (verb and button), page title "Log in" | Sign in, Sign In, "Sign in →", Welcome back |
| The act of getting out | **Log out** (shell canon §1.3) | Sign out, Sign Out |
| Starting a new workspace | **Start free** (CTA everywhere), page title "Start your workspace" | Register, Create account, Sign up, Start your free trial |
| Accepting an invitation | **Join {Org}** (page title and button) | Join team, Accept invitation, Register |
| Two factor authentication | **Two step verification** everywhere in the UI; `MFA` never appears in a user facing string | 2FA, MFA, Two-factor auth (TOTP), Authenticator app |
| The one time codes | **Backup codes** | Recovery codes, One-time codes |
| Ending every other session | **Log out everywhere** | Sign out of all devices, Sign out everywhere |
| The first run wizard | **Set up {Org}** | Setup, Onboarding, Get started, Welcome |
| Changing workspace | **Switch workspace** | Switch org, Change organization |

`Sign in` survives in exactly one place, the NextAuth API path `POST /api/auth/signin`, which no person reads.

### Access

| Route | Who can reach it | Read only viewer | Denial |
|---|---|---|---|
| `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/verify-email`, `/join` | anyone, signed out or in. Four of the six are in `AUTH_PUBLIC_PREFIXES` today; `signup` and `join` are in neither `APP_PREFIXES` nor `AUTH_PUBLIC_PREFIXES`, so step A0 adds them to both (§0, Routing tables changed). Only after that edit does the edge gate stop bouncing `/join` and the host split start sending a marketing-host "Start free" to the app host. A signed in person who opens `/login` or `/signup` is shown the page with one 44px `--os-brand-soft` strip at the top of the card: "You are logged in as {email}. Continue to WorkwrK" (text link to `/today`) and "Log out" (text link). No silent redirect: a person switching accounts must be able to reach the form. | n/a | n/a |
| `/account/*` | **every signed in person**, including Members carrying the Agent flag: Owner, Admin, Member and Guest are the four org roles (access spec §1.1 principle 1 and §2.1); Agent is a flag on a Member, never a fifth role. Gate: a session, nothing else (`account/layout.tsx`, settings spec §2.1). There is no role check and no read only variant. | n/a: every control on these pages acts on the viewer's own record | not signed in → `/login?callbackUrl=<current>` (the one redirect in the system, access spec §5.5) |
| `/onboard` | **Owner and Admin** of an org whose `settings.console.setupCompletedAt` and `setupDismissedAt` are both null. Anyone else who opens the URL, including a Member with or without the Agent flag and a Guest, gets a view at the same URL: the "Nothing to set up" card (`/onboard` §2, States), whose one primary is a link to `/today`. There is no second redirect and no resolver that has to guess a landing object. | n/a | not signed in → `/login?callbackUrl=/onboard` (the one redirect, access spec §5.5 rule 1) |

Three access corrections this unit makes, all in the access spec's vocabulary:

1. **Org setup is an Owner and Admin act.** Today `GET/POST /api/setup` checks only for a session, so any Member, including one carrying the Agent flag, can rewrite the org profile, delete departments, install modules and send invites (`auth-onboarding.md` §4, critic #4). `POST /api/setup` is retired; the wizard writes through the real gated routes, each of which calls `requireCan("manage", { type: "settings", page })` with its owning page (settings spec §3.1): `PATCH /api/settings` (`identity`, `culture`), `/api/departments` (`structure`), `/api/products/installations` (`apps`), `POST /api/invitations` (`org.invite_member`).
2. **The dashboard gate stops forcing everyone through a wizard.** `(dashboard)/layout.tsx` no longer redirects on `!setupCompleted`. `seedOrgDefaults(orgId)` (settings spec §11.1) runs inside the org create transaction, so a new org is complete the moment it exists; the wizard is an offer, not a gate. This is what ends B3's loop at the root rather than patching the skip button.
3. **Invites go through one rule.** `POST /api/invitations` is the only path that mints an `Invitation`, and it gates on `org.invite_member` (access spec §2.8). The wizard's step 2 and the Members page call the same route with the same body, so the setup bypass (B14) and the two-rules-for-one-button split (B15) both end. The rail's ungated "Invite" button is deleted by the shell spec; the workspace menu's "Invite people" renders only when `can(viewer, "invite_member", org)`.

**Denial convention** (access spec §5.5, one convention, no exceptions here): not signed in is the only redirect. Nothing in this unit renders a disabled control that the viewer may not use. Where the org policy removes a choice (two step verification required for this person's role), the row states the fact in words and offers no "Turn off"; it is not a greyed switch.

### Back and close

| Surface | Back target | Close target | Esc |
|---|---|---|---|
| Any `/account/*` page | the door sidebar is the navigation; there is no in-page `BackButton` inside a door (settings spec §8.3) | the takeover's one "← Back to app" ghost button calls `closeSettings()`: `sessionStorage["workwrk:settings:return"]` if it exists and is not a settings route, else `lastAppPath`, else `/today`. There is no ✕: design system §4.6 puts a ghost "← Back to app" at the left of the 48px bar and **nothing at the right**, and the design system wins on look, so the ✕ that settings spec §8.1 draws is not built. One exit affordance plus Esc, which is also what settings issue #24 asks for | `closeSettings()`, after the dirty guard, after any open dialog |
| A dialog on an `/account/*` page (MFA enrol, change password, delete account, backup codes) | n/a | its own ✕ and Cancel, returning focus to the row's trigger button. A modal header does carry a ✕ (design system §5.5); the takeover bar does not (§4.6). The two are different objects and this is the only ✕ in the unit | closes the dialog only; it never reaches the takeover |
| `/login`, `/forgot-password` | none needed (entry point) | n/a | clears the focused field's error state |
| `/signup` | text link "Already have a workspace? **Log in**" → `/login` | n/a | as above |
| `/join` | text link "Not you? **Log in** with a different account" → `/login` | n/a | as above |
| `/reset-password`, `/verify-email` | text link "Back to log in" → `/login` on every state including the error states | n/a | as above |
| `/onboard` step N > 1 | in-wizard "Back" secondary button → step N-1, keeping everything already typed | "Finish later" text link in the header → writes `settings.console.setupDismissedAt` then `/today`. One exit affordance, not two (B3 had two that looped) | "Finish later" after a confirm when the current step has unsaved input |
| The `(auth)` logo lockup | `MARKETING_HOST` when set, else `/` | n/a | n/a |

`router.back()` bare is forbidden everywhere in this unit, as it is app wide. `router.push("/today")` is a lint error inside `src/app/(dashboard)/account/**` and `src/components/layout/os/settings-shell*` (settings spec §8.3); `closeSettings()` is the only exit.

### Mobile and narrow

This unit carries the product's first two real breakpoints, because a person logs in, joins and resets a password on a phone far more often than they edit a board on one.

- **Auth pages** (`/login`, `/signup`, `/join`, `/forgot-password`, `/reset-password`, `/verify-email`): two column above `1024px` (form column left, navy proof panel right); single column below, the panel hidden, page padding `padding-inline: 24px`, form column `max-width: 400px` centred, the logo lockup 24px from the top. Inputs stay 36px (never 44px on touch: the 24px hit padding around them already clears the target size). The footer links wrap to two lines.
- **`/onboard`**: content column `max-width: 720px`; the card grids go `repeat(auto-fit, minmax(220px, 1fr))` so two up becomes one up under `680px`; the step rail becomes "Step 2 of 4" text under `900px`.
- **`/account/*`**: below `900px` the 264px door sidebar collapses into a "Pages" select in the takeover's 48px bar (settings spec §8.1) and the content column goes full width with 16px padding. Form cards drop from 560px to 100%. The security activity table scrolls inside its own `overflow-x: auto` card; the page body never scrolls horizontally. Dialogs at 400px and 560px become full screen sheets under `640px` with the primary pinned to the bottom.
- Everything in this unit is keyboard complete: no hover only affordance exists on any route here.

### Layout constants used throughout

Settled once so the route blocks do not repeat them. Where `design-system.md` and `settings-architecture.md` differ, the design system wins on LOOK and the settings spec wins on STRUCTURE. Applied, every disagreement this unit meets resolves like this:

| Thing | This unit builds | Which doc it follows | The figure it does not use |
|---|---|---|---|
| Form card width | 560px, left aligned inside a 760px content column that also carries the page title and the text-tab pills | design system §5.4 for the card, settings spec §8.1 for the column | none |
| List style cards (security activity, muted items, connections) | fill the column up to 1120px | settings spec §8.1 | none |
| Settings row height | **48px minimum**, label 14/500 plus 13/400 `--os-ink-2` helper left, control right, `--os-line-soft` separators | design system §5.4 | the 44px in settings spec §10.2 |
| Door sidebar | 264px wide, rows 36px, **20px** Lucide icons | design system §4.2 and §5.14 | the 248px and 16px icons in settings spec §8.1 |
| Table rows inside a settings page (`TableCard`) | header 44px at Comfortable and 36px otherwise, body rows `--os-row-h`, so every table on these pages obeys the Density preference this same unit ships | design system §5.1 | any fixed 36px body row |
| Fields per card | **at most 5**; a card that would hold six is split and both halves are named | design system §5.4 | none |
| The **Accent** row on Preferences | **deleted outright**, in the same PR as the token sweep that removes the ten `data-accent` blocks, not hidden behind a list length check. After the sweep the setting is decorative, and a decorative setting is what the persistence rule forbids (critic #7) | design system §1.4 and §10 | the Accent row settings spec §4.2 keeps |
| **Density** default | **Comfortable**, whose row height is 44px (`--os-row-h: 44px`). `OrgPreference.densityDefault` seeds Comfortable too, and the Workspace door's Appearance-defaults row changes with it | design system §3.2 | the Cozy default in settings spec §5.2 |
| The 48px takeover bar | "← Back to app" ghost left, nothing right, no ✕ | design system §4.6 | the ✕ in settings spec §8.1 |
| Breadcrumb string in the top bar | `{First name} › My settings › {Page}` | settings spec §2.1 and §8.1 (structure) | the `Settings › My settings › {Page}` this spec used in its first draft |
| Fetch failure rendering | `OsEmptyView` in its error form with a wired Retry, in place of the form or the tab's cards | design system §5.8 (the component is retained and restyled) and settings spec §8.6 and §10 (which names it) | any new `ErrorState` component, which exists in neither doc |

Breadcrumb crumbs, spelled out once: `{First name}` links to `/people/me` (the person's own card), `My settings` links to `/account/profile`, and the last crumb is the registry label for the page and is not clickable. No crumb in this unit is inert decoration.

---

## 2. Route specs

### `/account/profile`  (`(dashboard)/account/profile/page.tsx`)

- **Purpose**: your name, your photo and how to reach you, plus the one place to close your account.
- **Who sees it**: every signed in person, including Members carrying the Agent flag (the four org roles are Owner, Admin, Member and Guest; access spec §2.1). Entry points: the rail Settings hub for anyone who is not Owner or Admin; the avatar menu's "My settings" row (shell spec §2.12) via `openSettings("/account/profile")`; the My settings door sidebar row 1; `/people/[id]` in self mode, "Edit personal info"; `/account` and any unresolved `/account/*` path; the ⌘K palette's Settings group; `/settings/structure`'s personal door link; the `AdminOnly` card's "Go to My settings" button.
- **Top bar**: the navy bar stays (shell §2.8). Left: ‹ › history buttons, then the breadcrumb `{First name} › My settings › Profile` (crumbs per §1 Layout constants: the first links to `/people/me`, the second to `/account/profile`, the last is the registry label and is not clickable). Centre: the search field, which inside a door opens the door filter rather than the global palette. Right: unchanged (+, bell, help, avatar). Below it the takeover's own 48px white bar: "← Back to app" ghost left and nothing right (design system §4.6; there is no ✕ anywhere in either door).
- **Secondary sidebar**: the My settings door list; **row 1 Profile** active; no groups, nothing collapsed.
- **Page header stack**: title "Profile" 22/600 `--os-ink`; one 13/400 `--os-ink-2` line "Your details as your teammates see them." No text-tab views (a settings form page never renders the views row, design system §4.4). No toolbar row: a Save bar page carries its primary in the sticky bar, not in a toolbar, and the toolbar's Filter, Sort, Group and view switcher do not apply. The one blue button on this page is **Save changes** in the sticky bar.
- **Body layout**, in reading order, all inside the 760px column, cards 560px wide, 24px between cards:

  1. **Photo** (card, no title). 72px avatar left (initials at 11/500 on N200 with N700 text when no photo, per design system §5.18), two 32px secondary buttons right: "Change photo" (opens the OS file picker, accepts `image/png,image/jpeg,image/webp`, max 2 MB, client side square crop at 512px, `POST /api/users/[id]/avatar`) and "Remove" (rendered only when a photo exists, `DELETE /api/users/[id]/avatar`). Autosaves: an inline "Saved" tick 12/500 `--os-success-text` fades after 2s; failure toasts "Couldn't update your photo" with Retry and reverts the preview. Helper 13/400 `--os-ink-2`: "PNG or JPG, up to 2 MB."
  2. **Your details** (card, title "Your details" 16/600). Fields, label above at 13/500, input 36px radius 6: **First name** (required, `firstName`), **Last name** (required, `lastName`), the two side by side at `grid-template-columns: 1fr 1fr; gap: 16px`; **Phone** (`phone`, `type=tel`, optional, helper "Visible to your manager and the People team"); **Date of birth** (`dateOfBirth`, the `Picker` date variant, optional, helper "Visible to you, your managers, the People team and admins"). All four feed the one Save bar.
  3. **Email** (card, title "Email"). The address as 14/400 text, not an input, with a 24px `Check` in `--os-success-text` and the word "Verified" when `emailVerifiedAt` is set, or a 13/400 `--os-warning-text` line "Not verified yet" plus a 32px secondary button "Send verification email" (`POST /api/auth/request-verify`, toast "Verification email sent to {email}", the button becomes "Sent" and disables for 60s). Caption 13/400 `--os-ink-2`: "Managed by your workspace admin" or, when the org has an identity provider, "Managed by {IdP}". There is no change-email control, because there is no change-email flow; inventing one would be fabricated chrome.
  4. **Your place at {Org}** (card). Five read only rows at 48px with `--os-line-soft` separators: **Job title**, **Department**, **Office**, **Reports to**, **Workspace role**. Each value is a `Chip` (neutral, 24px) or, for Reports to, a 24px avatar plus name; each chip links to `/people/me`. The role label comes from `src/lib/access/labels.ts` and reads "Owner", "Admin", "Member", "Guest", never a raw enum (`EMPLOYEE` is what the page shows today, `settings-pages.md` #24). Caption under the card: "Ask your manager or the People team to change these." These are placement and membership fields; the person never writes them (settings spec §9.2a).
  5. **Download my data** (card, title "Your data"). One 13/400 line that describes what today's route actually returns: "A copy of your personal records: your profile, your notifications, your activity and your consents. It downloads as a JSON file." Then a 32px secondary button **Download** wired to `GET /api/me/export`, which streams the file straight to the browser with `Content-Disposition: attachment; filename="workwrk-data-export-{id}.json"` (`src/app/api/me/export/route.ts:10,93-94`). The button shows the four dot pending loader while the response is in flight and then an inline "Downloaded" tick; there is no email, no job and no zip, because none of those exist. Rendered for everyone including Members with the Agent flag: this is the personal right, not the `export` action an Agent is capped on (access spec §2.4). A later async export of everything a person **created** (tasks, docs, files) would be a different job with a different route, and it is not specified here or promised in the copy; the settings unit owns the workspace wide export at Workspace settings › Data.
  6. **Danger zone** (last card, `1px solid var(--os-danger-border)`, title "Danger zone" 16/600 in `--os-danger-text`). One row: "Delete my account" with a 13/400 `--os-ink-2` line "Removes you from {Org} and deletes your personal data. Work you created stays with the workspace." and a destructive ghost button "Delete my account" opening the Delete my account dialog (§2, below).
- **Sticky Save bar**: 56px, `--os-surface`, `border-top: 1px solid var(--os-line)`, appears only when dirty: "Unsaved changes" 13/400 `--os-ink-2` left, then "Discard" (ghost) and "Save changes" (primary, the one blue button). One `PATCH /api/users/[id]` per save, never two sequential writes.
- **Side panel / drawer / modal used here**: the Delete my account dialog (400px, typed confirmation). Nothing else.
- **States**:
  - loading: the route skeleton inside the takeover: four `--os-skeleton` bars at the card heights with one 13/400 `--os-ink-2` rotating value line under the first (design system §5.15). No `Loader2`, no "Loading…" string.
  - empty: not possible (a person always has a record).
  - error: a failed `GET /api/me` renders `OsEmptyView` in place of the form: "Couldn't load your profile", one 13/400 line, one "Try again" secondary button wired to a refetch. The form is never rendered blank over a failed fetch, so Save can never overwrite live values with empty strings (settings spec §8.6, the same bug Identity has today).
  - read only: none. Every editable field here is the viewer's own.
  - denied: none for this page; not signed in is the redirect.
  - offline / session expired: the shell's offline strip; a 401 raises the Session expired dialog (§2, below) and the Save bar keeps its dirty state so nothing typed is lost.
- **Keyboard**: `⌘/` focuses the door filter; `⌘S` saves when dirty; Tab order follows reading order; Esc runs the dirty guard then `closeSettings()`.
- **Data**: `GET /api/me`; `PATCH /api/users/[id]` (self path, `.strict()`, per field table settings spec §9.2a); `POST /DELETE /api/users/[id]/avatar`; `POST /api/auth/request-verify`; `GET /api/me/export` (GET only today and GET only here); `POST /api/me/delete`. New API needed: none. Settings it reads: `settings.security.ssoEnforced` and `IdentityProvider.name` for the email caption; `src/lib/access/labels.ts` for the role word.
- **Realtime**: none. A role change made by an admin lands on the next request through the `tokenVersion` bump, which surfaces as the Session expired dialog if it revokes the session.
- **What changes vs today** (`settings-pages.md` 1.22): phone and date of birth appear (the API already accepts them); the read only chips gain Office and Reports to and use the label map instead of the raw enum; the black `bg-zinc-900` Save button becomes the one blue primary in a sticky Save bar that only appears when dirty; the bordered-div input workaround is replaced by the design system input (the `.workwrk-os input` reset is removed in the CSS sweep so both input patterns collapse to one); the blank-form-over-failed-fetch bug is replaced by `OsEmptyView` with a wired Retry; `Loader2` becomes skeletons; the danger zone and the data download appear for the first time (both routes exist today with no UI, and the download card's copy is written to match the synchronous JSON the route really sends); a link to the career profile at `/people/me` appears on every chip.
- **Open questions**: none.

---

### `/account/preferences`  (`(dashboard)/account/preferences/page.tsx`, new)

- **Purpose**: how WorkwrK looks to you, what language and time zone it uses, and how your sidebar behaves.
- **Who sees it**: every signed in person. Entry points: door sidebar row 2; the avatar menu's Theme segmented control, whose "More appearance" row deep links to `?tab=appearance`; the Customize Sidebar panel's "All preferences" text link → `?tab=sidebar`; `/settings/identity?tab=appearance` (the org defaults page) cross links here; the 308 from `/account/appearance` and from `/settings?tab=themes`; ⌘K.
- **Top bar**: as Profile, breadcrumb `{First name} › My settings › Preferences`.
- **Secondary sidebar**: My settings door; **row 2 Preferences** active.
- **Page header stack**: title "Preferences" 22/600; subtitle "These apply to you on every device."; then **text-tab pills** (design system §5.12, 32px, 15/400, active `--os-surface-2` at 15/500): **Appearance · Language & region · Sidebar**. The tab reads `?tab` on load and writes it with `router.replace`, so every tab is linkable. No toolbar row. This page is autosave throughout, so it has no Save bar and therefore no blue button at all; that is allowed (the rule is at most one, not exactly one).
- **Body layout**: rows are the autosave settings row, 48px minimum (design system §5.4, per §1 Layout constants), `label 14/500` plus `13/400 --os-ink-2` helper on the left, control right aligned, `--os-line-soft` separators, grouped into 560px cards of at most five fields each.

  **Tab: Appearance**
  1. Card "Theme": **Theme** (`SegmentedControl` Light · Dark · System, writes `UserPreference.theme.appearance`). When `theme.appearance` is in `OrgPreference.lockedKeys` the control is replaced by the value as 14/400 text plus a 16px `Lock` and the line "Set by your workspace" (no greyed control, design system §5.4 and access principle 6). **Chrome** (`SegmentedControl` Navy · Light, default Navy, writes `UserPreference.theme.chrome`, **read by `ThemeApplier`**, which stamps `data-chrome` on the shell root the same way it stamps `data-theme` and `data-reduced-motion`) renders only after the navy QA pass (design system §8.5 step 8); until then the key exists and the row is absent, not disabled. The row is added to the settings spec §4.2 Appearance table as one line (Chrome · default Navy · `UserPreference.theme.chrome` · read by `ThemeApplier`) and registered in `src/lib/settings-registry.ts` as `preferences.appearance.chrome`, so like every other row on this page it has a home and a named reader. The avatar menu's Chrome control (design system §4.1) writes the same key.
  2. Card "Display": **Density** (`SegmentedControl` Comfortable · Cozy · Compact, writes `UserPreference.density`; **default Comfortable**, which is the 44px row height, per §1 Layout constants and design system §3.2; helper "How tall table and list rows are"). There is **no Accent row**: it is deleted outright in the same PR as the token sweep that removes the ten `data-accent` blocks (design system §1.4 and §10, per §1 Layout constants), because after the sweep it would change nothing a person can see and a decorative setting is what critic #7 forbids. Stored `purple`, `violet`, `pink`, `indigo` and `grape` normalise to `workwrk` on read and are dropped on the next write of the object, the same treatment rail labels gets below; `preferences.appearance.accent` leaves `src/lib/settings-registry.ts` in that PR so `/account/all` cannot advertise it. **Reduced motion** (`Switch`, writes `home.ui.reducedMotion`, helper "Follows your device by default"). **Show upcoming features** (`Switch`, writes `home.ui.showUpcoming`, helper "Reveals rows we are still building, marked Coming soon").

  **Tab: Language & region** (entirely new; there is no per user time zone today, critic #13)
  3. Card "Language & region": **Language** (`Picker`, the 11 wired catalogs, writes `home.locale.language`, read by `src/i18n/request.ts`; helper "Some areas are still English only"). **Time zone** (`Picker` over the IANA list with a search field and a first row "Use my device time zone ({detected})", writes `home.locale.timezone`). **Week starts on** (`SegmentedControl` Monday · Sunday, writes `home.locale.weekStart`). **Date format** (`Picker` 31/12/2026 · 12/31/2026 · 2026-12-31, writes `home.locale.dateFormat`). **Time format** (`SegmentedControl` 24 hour · 12 hour, writes `home.locale.timeFormat`). Each row's helper names one real consumer so the person can see it is not decoration, for example "Used for due dates, reminders and your timesheet". A 13/400 `--os-ink-2` line under the card: "Your workspace default is {org value}. Changing these only affects you."
  4. Card "Time zone check" renders only when the stored time zone differs from the browser's: one 13/400 line "Your device says {browser zone}" and a 32px secondary "Use device time zone". This replaces the silent mismatch that produces off-by-one due dates today.

  **Tab: Sidebar**
  5. Card "Sidebar": **Width** (a 36px range input 240 to 320 with the live value as 12/500 to its right, writes `sidebar.width` debounced 500ms; the drag handle on the sidebar itself writes the same key, replacing `workwrk:os:sidebar-width`). **Start collapsed** (`Switch`, `sidebar.collapsed`, replacing `workwrk:os:sidebar-collapsed`). **Quick actions in the avatar menu** (a multi select `Picker` writing `sidebar.quickTools`, replacing `workwrk:os:profile-tool-pins:v2`).

  **Rail labels is deliberately not here**, and this is its disposition, written out because settings spec §4.2 lists it as one of the five Sidebar rows. Design system §4.1 removes the icons-only rail option ("Icons-only rail option removed from CustomizePanel"; the rail always shows a 10/500 label under each hub icon), so the setting has no behaviour left to control and rendering it would be a switch that changes nothing, which is exactly what critic #7 forbids. Therefore: the row is absent from this card and from the Customize Sidebar panel; `UserPreference.sidebar.iconsOnly` is ignored on read and dropped on the next write of the `sidebar` object (the same treatment the banned accents get, where stored `purple` reads as `workwrk`); the `workwrk:os:icons-only` localStorage mirror is deleted in step A0 along with the other three sidebar mirrors; and the key is removed from `src/lib/settings-registry.ts` so `/account/all` cannot advertise it. Nothing a person set is lost that they can still see: the rail looks the same for everyone.
  6. Card "What you see first": **Section order** (a keyboard reorderable list of the sidebar's sections, ↑↓ buttons plus drag, writes `sidebar.sectionsOrder`) and **Home cards** (checkbox rows writing `home.cards`, read by the Work sidebar and the Space overview). Both are also in the Customize Sidebar panel (the footer button stays, per the founder's standing instruction) and both write the same keys, so the two surfaces can never disagree.
  7. A 13/400 closing line: "Admins set the workspace defaults in Workspace settings › Identity & culture." The link renders only for Owners and Admins.
- **Autosave contract**: each control writes `PATCH /api/preferences` debounced 400ms per key, retries once, shows the inline "Saved" tick for 1.5s, and on failure toasts "Couldn't save · Retry" and reverts the control to the server value. No control on this page makes the page dirty; there is no Save bar (settings spec §8.5).
- **Side panel / drawer / modal used here**: the time zone and language `Picker` popovers (280px, search shown because both lists exceed six rows). No modal.
- **States**: loading = skeleton rows at the 48px row height inside skeleton cards; empty = n/a; error = `OsEmptyView` with Retry replacing the tab's cards (never a form over a failed GET); read only = the per row locked rendering described above, which is a value plus a lock, never a disabled control; denied = none; offline / session expired = writes toast the offline message and revert, 401 raises the Session expired dialog.
- **Keyboard**: `⌘/` door filter; arrows move within a `SegmentedControl`; `1`, `2`, `3` while the tab strip has focus switch tabs; Esc closes a picker then leaves the door.
- **Data**: `GET /api/preferences` (effective, with org defaults merged and `lockedKeys` re-stamped), `PATCH /api/preferences` with `.strict()` at every level so a stray key is a 400 that names it (settings spec §9.3). Settings read: `OrgPreference.themeDefault`, `densityDefault` (seeded **Comfortable**, per §1 Layout constants), `lockedKeys`; `Organization.settings.locale.*`, `.language`, `.timezone`. New API: none. New preference keys: `home.locale.{language,timezone,weekStart,dateFormat,timeFormat}`, `home.ui.{reducedMotion,showUpcoming}`, `sidebar.{width,collapsed,quickTools}`, all inside existing JSON columns (settings spec G22), so no migration.
- **Realtime**: `prefs.changed` (shell §1.11) re-renders the page when the same person changes a preference in another tab or from the avatar menu.
- **What changes vs today** (`settings-pages.md` 1.23): the page is new, absorbing `/account/appearance`; the Accent row goes away entirely rather than being repaired, because the token sweep leaves it nothing to change, and the banned hues normalise to `workwrk` on read (issue #13); the Density default moves from Cozy to Comfortable, so a person who never touched it gets 44px rows, and the Workspace door's Appearance-defaults row moves with it; locked keys render as a value plus a lock instead of a live-looking switch that silently reverts; the black `ring-zinc-900` active state becomes the design system's pill; reduced motion, language, time zone, week start, date and time formats become real settings with named readers (critic #7 and #13); sidebar width, collapsed state and quick tool pins move off `localStorage` into `UserPreference`, which is what makes them survive a second device, while rail labels (`sidebar.iconsOnly`) is retired outright with its mirror because the rail no longer has an icons-only mode; `Loader2` becomes skeletons.
- **Open questions**: none. Design system open decision 5 is settled "one blue", so the Accent row is deleted here rather than hidden, in the same PR as the token sweep. Changing the Density default is reversible from Workspace settings › Identity & culture without touching a token.

---

### `/account/notifications`  (`(dashboard)/account/notifications/page.tsx`)

- **Purpose**: what WorkwrK tells you about, where it tells you, and when it stays quiet.
- **Who sees it**: every signed in person. A Guest sees the page with the inbox rows their notifications actually cover (mentions, assignments, comments, replies, access changes, per access spec §2.3) and no announcement or digest rows. Entry points: door sidebar row 3; the avatar menu "Mute notifications" row's "Notification settings" link; the bell popover header's 32px `Settings2` icon button; the Inbox page's gear menu, "All notification settings"; the 308 from `/settings/notifications`; ⌘K.
- **Top bar**: as Profile, breadcrumb `{First name} › My settings › Notifications`.
- **Secondary sidebar**: My settings door; **row 3 Notifications** active.
- **Page header stack**: title "Notifications" 22/600; subtitle "Everything here applies to you only."; text-tab pills **Inbox · Email · Desktop**; no toolbar; autosave, so no Save bar and no blue button.
- **Body layout**:

  **Above the tabs**, one full width card "Quiet" that applies to all three channels:
  1. **Mute everything until** (a `Picker` with rows "1 hour", "Until tomorrow, 9:00 am", "Until I turn it back on", "Pick a time…"; writes `home.notifications.mutedUntil` as an ISO string or null). When set, the card's title row shows a `StatusChip` neutral "Muted until 9:00 am" and a "Unmute" text link. This is the same key the avatar menu writes, so the two agree.
  2. **Quiet hours** (`Switch` plus two 36px time inputs From and To, writes `home.notifications.quietHours {start,end}`, interpreted in `home.locale.timezone`). Helper: "Email and desktop notifications wait until quiet hours end. Inbox rows still arrive."

  **Tab: Inbox** (`home.notifications.inbox.{key}`, keys unchanged from `notify-prefs.ts`)
  3. Two cards, because six switches in one card breaks the design system's five field budget (§5.4) and "Tell me about" is the natural split point: card **"Tell me about my work"** with three `Switch` rows, all on by default, **Tasks assigned to me**, **Status changes on my tasks**, **Due date reminders**; and card **"Tell me about people"** with three more, **Mentions of me**, **Comments on my work**, **Kudos I receive**. The six keys are unchanged (`home.notifications.inbox.{key}` from `notify-prefs.ts`); only the card they sit in changes, so nothing about the split reaches the API.
  4. Card "How the Inbox behaves" (`home.notifications.inboxView`): **Group by date** (`Switch`), **Show everything in Other** (`Switch`), **Clear read items after** (`Picker`: Never · 7 days · 30 days), **Open on** (`Picker`: Inbox · Mentions · Reminders). These four are exactly the keys the Inbox gear writes today into a top level `{inbox}` object that the preferences zod schema silently strips (critic #7); the gear and this card now write the same namespaced key.
  5. Card "Muted items": a `TableCard` listing `home.notifications.muted[]`, one row per entry at `--os-row-h` so it follows the Density preference (design system §5.1, per §1 Layout constants): 20px `EntityTile` neutral, the object name 15/400, its kind 12/500 `--os-ink-2`, and a 28px ghost "Unmute" at the right. Empty state inside the card, one row: "Nothing muted · Mute a Space, List or Doc from its ••• menu" with the second half as plain text (no link: muting happens on the object).

  **Tab: Email**
  6. Two cards again, for the same five field reason. Card **"Email"**: **Send me email** (the master `Switch`, `home.notifications.email.master`), then **Tasks assigned to me** and **Kudos I receive**, the only two with a live sender today (Kudos also mirrors to `EmailPreference.kudosNotifications` in the same write). Card **"Work updates by email"**: **KRA and KPI updates**, **Review reminders**, **SOP updates** (`EmailPreference` via `PATCH /api/email-preferences`). When the master is off, every row in both cards renders as a plain text value rather than a switch and one 13/400 line under the master reads "Turn email on to change these"; the second card carries the same line so the state is legible without scrolling back.
  7. Card "Coming soon" renders only when `home.ui.showUpcoming` is on: Mentions, Comments, Status changes, Due reminders, Daily digest, each as a 48px row with the label, a 13/400 "Coming soon" and no control. With the preference off the card is absent. This is the honest replacement for today's four "Soon" pills rendered as if they were settings.

  **Tab: Desktop**
  8. Card "This browser": **Desktop notifications** (`Switch`, `home.notifications.desktop`). The row's second line reports the browser permission state in words: "Your browser is blocking notifications. Allow them in your browser settings." or "Allowed" or "Not asked yet"; when the permission is not granted the switch's on action calls `Notification.requestPermission()` first and reverts if refused. A 32px secondary "Send a test" appears once permission is granted. Caption: "Each browser and device asks for permission separately."
- **Autosave contract**: identical to Preferences.
- **Side panel / drawer / modal used here**: the mute and time pickers. No modal.
- **States**: loading = skeleton rows; empty = the muted items card's inline empty row only; error = `OsEmptyView` with Retry replacing the tab; read only = none; denied = none; offline / session expired = as Preferences.
- **Keyboard**: `⌘/`; Space toggles a focused switch; Esc as elsewhere.
- **Data**: `GET/PATCH /api/preferences` (`home.notifications.*`), `GET/PATCH /api/email-preferences`. Readers named for every row: `notify-prefs.ts` `shouldNotify`, `shouldEmail` and `filterNotifyUsers`; the desktop key is read by the shell's notification bridge. New API: none. New keys: `home.notifications.{inboxView,mutedUntil,quietHours,muted,desktop}`.
- **Realtime**: `prefs.changed`; a new inbox row does not affect this page.
- **What changes vs today** (`settings-pages.md` 1.21): the page moves from `/settings/notifications` into the personal door, which is the URL inconsistency the audit flagged; quiet hours, mute-all, a muted object list and a desktop channel appear; the Inbox gear's writes stop being stripped; the four dishonest "Soon" email rows move behind "Show upcoming features"; per row "Saved" ticks replace the single "Changes save automatically" line; org level notification defaults stay retired until they have a reader (settings spec open decision 6), so no card promises a lock that nothing enforces.
- **Open questions**: none.

---

### `/account/security`  (`(dashboard)/account/security/page.tsx`)

- **Purpose**: prove it is you, keep other people out, and see what has happened on your account.
- **Who sees it**: every signed in person including Guests (access spec §2.3 gives a Guest their own password and two step verification). Entry points: door sidebar row 4; the avatar menu has no direct row, but the Security hold dialog's "Set it up" button opens the enrol dialog here at `/account/security?enrol=mfa`; `/login`'s "Manage two step verification" line after a successful enrol; the verification email's fallback link; ⌘K; the Workspace door's Security page cross links here for an Owner's own enrolment.
- **Top bar**: as Profile, breadcrumb `{First name} › My settings › Security`. The `OsTitleBar` with its amber star and its handler-free Ask AI / Share / Invite trio is deleted from this page and from every page in both doors (critic #2, `settings-pages.md` #3).
- **Secondary sidebar**: My settings door; **row 4 Security** active.
- **Page header stack**: title "Security" 22/600 (the registry label; the old "Account · Security" is gone); subtitle "{email}". No views row, no toolbar. This page is mixed mode: the rows are autosave or dialog driven, so there is no Save bar and no page level blue button; each dialog carries its own single primary.
- **Body layout**, 560px cards in the 760px column:

  1. **Card "How you log in"**, four 48px rows, `--os-line-soft` separators, each `label 14/500` + `13/400 --os-ink-2` state line on the left and one 32px control on the right:
     - **Password**: state line "Last changed {relative}" or "Never changed". Control: secondary "Change password" → the Change password dialog. When the org sets a maximum password age and this password is older, the state line reads "Expires in 4 days" in `--os-warning-text`, or "Expired" in `--os-danger-text` with the dialog opening automatically once per session.
     - **Two step verification**: state line "Off", or "On, using an authenticator app". Control: primary-weight secondary "Turn on" → the MFA enrolment dialog, or a "•••" `MenuList` with "Show backup codes", "Get new backup codes" and a destructive "Turn off". When the org requires two step verification for this person's role, the state line reads "Required by {Org}" and the menu offers no "Turn off" at all; nothing is rendered disabled.
     - **Backup codes**: rendered only when two step verification is on. State line "{n} of 8 unused". Control: secondary "Get new codes" → the Backup codes dialog.
     - **Email verified**: state line "Verified on {date}" with a 16px `Check` in `--os-success-text`, or "Not verified" in `--os-warning-text`. Control when unverified: secondary "Send verification email" (`POST /api/auth/request-verify`, 60s cool down, toast).
     - Under the card, one 13/400 line for Owners and Admins holding the `security` scope only: "Workspace sign-in policy" as a text link to `/settings/security?tab=signin`. Nobody else sees a link, and nobody sees a read only copy of the org's rules. The rules a person actually needs (length, uppercase, number, symbol) print inside the Change password dialog, under the new password field, which is where they matter.
  2. **Card "Where you are logged in"**: one 48px row "Log out everywhere", 13/400 "Ends every session except this one, on every device", control: destructive ghost "Log out everywhere" → the Sign out everywhere confirm. A device list is a reserved slot (design system §5.19) and is absent until a `Session` table exists; no placeholder renders.
  3. **Card "Recent security activity"**: a `TableCard` filling the column, rendered exactly as design system §5.1 specifies rather than at a hard coded height, so the page obeys the Density preference this same unit ships: header row **44px at Comfortable and 36px otherwise** with labels 13/500 `--os-ink-2`, columns **What · Where · When**, body rows at **`--os-row-h`**, hairline `--os-line-soft` dividers, no zebra, hover `--os-surface-hov`, up to 20 rows, footer row inside the card "Showing the last 20 events". No checkbox column and no column settings icon: nothing here is selectable or configurable, and §5.1's first cell rule only applies where selection exists. Each row: a 16px glyph plus the event in plain words ("Logged in", "Logged out", "Password changed", "Two step verification turned on", "Two step verification turned off", "Logged out everywhere", "Workspace switched"), the IP and a coarse location when available, and a relative timestamp with the exact value in the tooltip. A row is not clickable: there is nothing behind it.
  4. **Card "Presence"** (ships behind the `presenceStatus` / `presenceUntil` migration, settings spec §9.5): **Show me as** (`Picker`: Active · Away · Do not disturb · Custom…) and **Clear after** (`Picker`: 30 minutes · 1 hour · Today · This week · Never), writing `User.presenceStatus` and `presenceUntil`. The avatar menu's presence picker writes the same two columns, replacing `workwrk:os:presence`. Talk and the directory read them.
- **Side panel / drawer / modal used here**: MFA enrolment dialog (560), MFA turn off dialog (400), Backup codes dialog (560), Change password dialog (560), Sign out everywhere confirm (400), Security hold dialog (400, raised by the shell, landing here). Each is a Radix `ui/dialog`; pickers inside them are `position: absolute` children, never portalled (project rule).
- **States**:
  - loading: skeleton rows inside skeleton cards; the activity table shows five skeleton rows.
  - empty: the activity table's only empty case renders one inline row "Nothing yet · Events show up here when you log in or change your password", with the design system's four-dots-in-a-row illustration omitted because the block sits inside a card (design system §5.1).
  - error: `GET /api/me` failure replaces the cards with `OsEmptyView` and a wired Retry; `GET /api/me/security-activity` failure replaces just that card's body with a one line error and a Retry text link. The raw `me 401` string the page prints today is gone.
  - read only: none.
  - denied: none.
  - offline / session expired: a 401 on any control raises the Session expired dialog; the offline strip disables the dialogs' primaries with the offline toast rather than letting them fail silently.
- **Keyboard**: `⌘/`; Enter on a row's control opens its dialog; inside every dialog Enter submits and Esc closes (after a confirm when the enrol dialog is showing unsaved backup codes).
- **Data**: `GET /api/me`; `GET /api/auth/mfa/status`; `GET/POST/DELETE /api/auth/mfa/enroll`; `POST /api/me/change-password`; `POST /api/me/sign-out-everywhere`; `GET /api/me/security-activity`; `POST /api/auth/request-verify`; `PATCH /api/users/[id]` (presence). Settings read: `Organization.settings.security` (`minPasswordLength`, `requireUppercase`, `requireNumbers`, `requireSymbol`, `passwordMaxAgeDays`, `mfaRequired`) through `src/lib/password-policy.ts`, and the viewer's org role to decide whether `mfaRequired` covers them. New APIs needed: `POST /api/auth/mfa/backup-codes` (regenerate, requires a fresh valid code, returns eight new codes and invalidates the old set); `User.passwordChangedAt` read for the password age row (the column is added by the settings unit's S5).
- **Realtime**: none. A `tokenVersion` bump made elsewhere surfaces as the Session expired dialog.
- **What changes vs today** (`auth-onboarding.md` 1.11, `settings-pages.md` 1.24): the invented "security score" is deleted (fabricated data, critic #2); the "Access level" row rendered as a passed green check is deleted (it is not a security control and it belongs on Profile); the five row read only "Org policy" card is deleted and replaced by one text link for the people who can actually edit the policy, plus the live rules inside the password dialog (this closes the loop where the Overview sent admins here to "configure" a read only page, `settings-pages.md` #5); the `OsTitleBar` and its dead trio go; the raw error string becomes `OsEmptyView` with Retry; backup code regeneration appears for the first time; password age appears; presence moves off `localStorage`; the enrol and disable dialogs stop disagreeing about input format (both accept a 6 digit code or an 8 character backup code, both strip spaces and hyphens); every literal `#0073EA` and `#E2445C` in the dialogs becomes `--os-brand` and `--os-danger-solid` now that the dialogs render inside the tokenised shell; two step verification stops being cosmetic because the org policy row and `ENFORCE_MFA_AT_LOGIN` are both real (B9, resolved jointly with the settings unit's S5).
- **Open questions**: none.

---

### `/account/connections`  (`(dashboard)/account/connections/page.tsx`, new)

- **Purpose**: connect your own calendar so your work and your meetings sit in one place.
- **Who sees it**: every signed in person. Entry points: door sidebar row 5; the Planner's "Connect Google Calendar" banner, whose OAuth success now returns to `/account/connections?connected=google` (today it returns to the `/settings/calendar` stub and drops the flag); the 308 from `/settings/calendar`; ⌘K.
- **Top bar**: as Profile, breadcrumb `{First name} › My settings › Calendar & connections`.
- **Secondary sidebar**: My settings door; **row 5 Calendar & connections** active.
- **Page header stack**: title "Calendar & connections" 22/600; subtitle "Your own connections. Nobody else in {Org} sees them."; no views row; no toolbar. Autosave, so no Save bar. The one blue button on this page is **Connect** inside the Google Calendar card, and it appears only while the account is not connected.
- **Body layout**:
  1. Card "Google Calendar". Disconnected state: a 32px Google glyph, the line "See your meetings next to your work in Planner, and block time from a task.", one primary "Connect" starting the OAuth flow at `/api/integrations/google-calendar/connect`. Connected state: the connected account's email 14/400 with a `StatusChip` success "Connected", a checkbox list of that account's calendars (`GET /api/integrations/google-calendar/calendars`, each row 36px, writes a `CalendarSubscription` per checked calendar), a 13/400 line "Last synced {relative}" and a "•••" menu with "Sync now" and a destructive "Disconnect" (confirm at 400px naming what stops: "Your meetings will stop appearing in Planner. Nothing is deleted."). The `?connected=google` flag raises one toast "Google Calendar connected" and is stripped with `router.replace`.
  2. Card "Your calendar feed". A read only ICS URL in a 36px field with a "Copy" 32px secondary, plus "Create feed" when none exists and a "•••" with "Rotate link" (confirm: "Anyone using the old link stops receiving updates."). `POST /api/calendar/ics/token`, `POST .../rotate`. Helper: "Paste this into Apple Calendar or Outlook to see your WorkwrK due dates there."
  3. Card "Coming soon", rendered only when `home.ui.showUpcoming` is on: Outlook, iCloud, Fastmail, each a 48px row with a 13/400 "Coming soon" and no control.
- **Side panel / drawer / modal used here**: the disconnect and rotate confirms (400 each).
- **States**: loading = skeleton cards; empty = the disconnected state is the empty state (an illustration is not used because the card carries a real action); error = a failed connection list renders inline "Couldn't reach Google · Try again" with a wired retry, and the OAuth error return `?error=access_denied` renders a 13/400 `--os-danger-text` line inside the card rather than a toast that disappears; read only = none; denied = none (there is no org switch that hides this page; settings spec open decision 12 keeps an org level "allow calendar connections" switch unshipped until something reads it); offline / session expired = as elsewhere.
- **Keyboard**: `⌘/`; Space toggles a calendar checkbox; `⌘C` with the ICS field focused copies.
- **Data**: `/api/integrations/google-calendar/{connect,callback,calendars,sync,disconnect}` (all exist, `time.md` verified the backend), `/api/calendar/ics/token`. New API: `POST /api/calendar/ics/token/rotate`. Settings read: `home.ui.showUpcoming`.
- **Realtime**: none; "Last synced" comes from the 5 minute cron's stored timestamp.
- **What changes vs today**: the page exists. Today the only calendar settings page is the org level `/settings/calendar`, which is a stub with copy promising a backend that in fact exists but is per user (the exact contradiction `critic-gaps.json` lists between `settings-pages.md` 1.16 and `time.md` §6). Moving it to the personal door is what makes the copy true. The Planner banner's dropped `?connected=1` is now read.
- **Open questions**: none.

---

### `/account/shortcuts`  (`(dashboard)/account/shortcuts/page.tsx`, new)

- **Purpose**: every keyboard shortcut that actually works, on one page you can print.
- **Who sees it**: every signed in person. Entry points: door sidebar row 6; the avatar menu "Keyboard shortcuts" row (today it goes to `/settings?tab=shortcuts`, which lands on Overview, `settings-pages.md` #10); the `?` overlay's footer link "Open as a page"; ⌘K.
- **Top bar**: as Profile, breadcrumb `{First name} › My settings › Keyboard shortcuts`.
- **Secondary sidebar**: My settings door; **row 6 Keyboard shortcuts** active.
- **Page header stack**: title "Keyboard shortcuts" 22/600; subtitle "⌘ is Ctrl on Windows and Linux."; no views row; no toolbar; no primary button (this page has no action, which is allowed).
- **Body layout**: one `TableCard` per scope, rendered from `src/lib/shortcuts.ts` (the single registry the window listener, every tooltip's kbd hint and the `?` overlay also read, shell spec §1.8, which is where the file is created; it does not exist today). Scopes in order: **Anywhere**, **Lists and boards**, **Docs**, **Tables**, **Talk**, **Settings**. Each row 36px: the action 15/400 left, the chord right aligned as `Kbd` components (18px, `--os-kbd-bg`, radius 4, 11/500). A chord appears only if it is delivered to the page by Chrome, Safari, Firefox and Edge on both macOS and Windows; reserved chords are never advertised. The dead `g` chords are absent until `useGoToNav` has an importer (critic contradiction 3).

  **What this unit adds to the registry**, so the page can never advertise a different set from the one the pages implement. Three entries, all in the **Settings** scope, all registered in `src/lib/shortcuts.ts` in the same change that builds the page that uses them:

  | Action | Chord | Scope and condition | Browser test |
  |---|---|---|---|
  | Find a setting | `⌘/` | Settings, whenever a door is open | passes in all four browsers on both platforms; listed |
  | Save changes | `⌘S` | Settings, only on a Save bar page and only while it is dirty | passes (the page calls `preventDefault`, which every browser honours for `⌘S` in a page context); listed, with the condition in the row's second line "on pages with unsaved changes" |
  | Switch tab | `1` `2` `3` | Settings, only while the text-tab strip has keyboard focus | passes; listed as one row, "1 / 2 / 3", with "while the tabs are focused" as the second line |

  **`⌘P` is deliberately not a registry entry.** Printing is the browser's own command and this unit does not intercept it; the page simply carries a print stylesheet that drops the chrome. It appears on this page as one 13/400 `--os-ink-2` line under the last table, "Your browser's own print command prints this page", not as a `Kbd` row, because the registry lists chords the product handles.
- **Side panel / drawer / modal**: none.
- **States**: loading = none needed (the registry is a static import; the page is server rendered); empty = impossible; error = none; read only = the whole page is read only by nature, and it is not a settings read only mode; denied = none; offline / session expired = the takeover's own handling.
- **Keyboard**: `?` from anywhere opens the overlay with the same table; `⌘/` focuses nothing here (there is no filter on this page, so the chord falls through to the door sidebar's filter as it does everywhere in the door); the browser's print command prints the page through the print stylesheet, unintercepted.
- **Data**: `src/lib/shortcuts.ts`, plus the three Settings scope entries this unit registers in it (above). No API, no settings. The same Vitest test that guards `/account/all` asserts that every chord this unit's pages listen for has a registry entry, so a chord can never ship unadvertised and an entry can never outlive its listener.
- **Realtime**: none.
- **What changes vs today**: the page exists. Today the avatar menu advertises a shortcuts page that does not exist, which is the plainest case of naming a destination with no destination.
- **Open questions**: none.

---

### `/account/all`  (`(dashboard)/account/all/page.tsx`, new)

- **Purpose**: every personal setting on one page, so you can find one by name instead of guessing which tab it is on.
- **Who sees it**: every signed in person. Entry points: door sidebar row 7; the door filter's footer "See all settings"; ⌘K's Settings group.
- **Top bar**: as Profile, breadcrumb `{First name} › My settings › All settings`.
- **Secondary sidebar**: My settings door; **row 7 All settings** active.
- **Page header stack**: title "All settings" 22/600; subtitle "Everything you can change about your own account."; a 36px search field 480px wide ("Search your settings") filtering the list as you type; no views row; no toolbar; no primary.
- **Body layout**: generated from `src/lib/settings-registry.ts` filtered to `door === "me"` (settings spec G23). One 16/600 group heading per page in sidebar order, then 36px rows: the field label 15/400 left, its page and tab 13/400 `--os-ink-2` right, the whole row a link to the field's `href` (which carries the tab and the hash). Arriving at a hash scrolls the card into view and pulses its border once over 150ms with no transform.
- **Side panel / drawer / modal**: none. There are no controls on this page; it is an index.
- **States**: loading = none (server rendered from a static registry); empty = only when the search matches nothing: one inline row "No setting matches '{q}' · Clear search"; error = none; read only = n/a; denied = none; offline / session expired = the takeover's.
- **Keyboard**: `⌘/` focuses the search field; ↑↓ move through results; Enter opens.
- **Data**: `src/lib/settings-registry.ts`, `SETTINGS_PAGES` from `src/lib/access/settings.ts`. A Vitest unit test asserts that every field rendered by the six personal pages exists in the registry and that its `href` resolves to a page in the table, so this index can never drift from the pages (settings spec G1).
- **Realtime**: none.
- **What changes vs today**: the page exists.
- **Open questions**: none.

---

### `/login`  (`(auth)/login/page.tsx`)

- **Purpose**: get back into your workspace, in one or two steps.
- **Who sees it**: anyone. Entry points: the marketing top bar "Log in"; every auth page's cross link; the `(dashboard)`, `onboard` and `(auth)` layouts' unauthenticated redirect with `?callbackUrl=`; the edge gate (`AUTH_EDGE_GATE=true`, `proxy.ts:189`); `signOut({ callbackUrl: "/login" })` from the avatar menu; the Session expired dialog's primary; the welcome, invitation and reset emails' fallback links; `/join`'s three account-exists paths (which arrive with `?callbackUrl=/join?token=…` so the person is returned to the invitation after logging in); a direct bookmark.
- **Top bar**: none. The `(auth)` shell renders: the logo lockup 28px (four dots plus wordmark) at the top of the form column, linked to the marketing home; nothing else. No breadcrumb, no back button, no search, no actions.
- **Secondary sidebar**: none. The right hand pane above 1024px is the proof panel described in §3 (`AuthShell`), not a sidebar.
- **Page header stack**: not the list page stack (this is not a list page). The auth card stack is: title 22/600 `--os-ink` "Log in", subtitle 14/400 `--os-ink-2` "Welcome back to {Org}" when the callback names an org, else "Welcome back", then the form. The one blue button is **Log in**.
- **Body layout**:
  - **Step 1, credentials**. Optional **Continue with Google** 36px secondary with the Google glyph, rendered only when NextAuth's `getProviders()` reports the Google provider; when it is absent nothing renders, never a disabled button (this is what closes B16 without inventing a button). A "or" divider (1px `--os-line` with the word 12/500 `--os-ink-2` centred) below it, also conditional. Then: **Work email** (36px, `type=email`, `autoComplete="email"`, `autoFocus`), **Password** (36px, `autoComplete="current-password"`, with a 28px ghost eye toggle inside the field at the right, `aria-label` "Show password" / "Hide password"), a right aligned 13/500 text link **Forgot your password?** → `/forgot-password?email={typed value}`, then the primary **Log in** full width.
  - Footer inside the card: 13/400 "New to WorkwrK? **Start free**" → `/signup`, then on a second line 13/400 "Didn't get your verification email? **Send a new link**" → `/verify-email?resend=1`. That second line is the "resend from the login page" capability `auth-onboarding.md` §5 asks for, and it is a link to the page that owns resending rather than a second sender bolted onto the login form.
  - **An unverified address logs in normally.** Verification is not a gate at launch: nothing in `settings-architecture.md` defines a "require email verification" org setting, so building a block here would enforce a rule no admin can see or change. What an unverified person meets instead is the "Not verified yet" row with its Send button on `/account/profile` and `/account/security`, plus the one reminder email at 72 hours. If the settings unit later adds the org switch, the refusal arrives as a named `authorize` outcome (`EMAIL_UNVERIFIED`) and renders in the card as its own step, in the shape of step 2 below, never as a bare banner.
  - **Step 2, two step verification** (replaces the card body in place, no navigation, the URL stays `/login`). Title "Two step verification", subtitle "Logging in as {email}" with a 13/500 text link "Use a different account" that resets to step 1. One field **Authentication code** (36px, `inputMode="numeric"`, `autoComplete="one-time-code"`, `maxLength=9`, letter spaced 0.2em, placeholder "123456"). The client strips spaces and hyphens before sending, so a pasted "123 456" works (today it fails, `auth-onboarding.md` 1.2). Helper 13/400 "Open your authenticator app, or enter one of your backup codes." Primary **Verify**. Below it a 13/500 text link "Use a backup code instead", which only changes the helper text and the field's `maxLength`; it never changes the endpoint.
  - **Step 2b, set up two step verification** (only when the server answers `MFA_ENROL_REQUIRED`, meaning the org requires it for this person's role and they are not enrolled). Title "Set up two step verification", subtitle "{Org} requires it for {role}s." Then the enrolment panel inline: the QR image, the manual key in `JetBrains Mono` 13/400 with a Copy button, the 6 digit field, primary "Turn on". On success the backup codes render in the same panel with "Copy codes", "Download .txt" and a required checkbox "I have saved these codes" that enables the final primary "Finish and log in". This is a login step, not a redirect, so the access model's "one redirect" rule holds.
- **Side panel / drawer / modal used here**: none. Every step is in the card.
- **States**:
  - loading: the primary shows the 16px monochrome four dot `pending` loader in place of its icon, the label unchanged ("Log in", not "Logging in…"), width preserved (design system §5.10). `Loader2` is deleted from every auth page.
  - empty: n/a.
  - error: one banner above the fields, `--os-danger-bg` fill, `1px solid --os-danger-solid` at 20% is not used; the banner is `--os-danger-bg` with a 16px `CircleAlert` in `--os-danger-text` and the message 13/400 in `--os-danger-text`, radius 6, padding 12. Messages, mapped by `friendlyError()` and kept deliberately vague about which half was wrong: "That email or password is not right." · "Too many attempts. Try again in {n} minutes." (lockout, from `login-throttle.ts` with the org's threshold and window) · "This account is not active. Ask your workspace admin." · "That workspace is suspended. Ask your workspace admin." · "That code is not right. Try again." · "That backup code has already been used." Nothing else is shown; a server stack trace never reaches this banner.
  - **Google outcomes.** `src/lib/auth.ts:279` admits only an address that already exists, and `pages.signIn = "/login"` (`:267-269`) means every refusal comes back to this page as `?error=`. Each value gets copy, mapped by the same `friendlyError()`: `AccessDenied` → "That Google account is not on {product}. Ask your workspace admin to invite {email}, or log in with your email and password." (the address is echoed only when Google returned one); `OAuthAccountNotLinked` → "That email already logs in with a password. Use your password below."; `OAuthSignin`, `OAuthCallback`, `Callback` → "We could not finish logging you in with Google. Try again, or use your password."; `Configuration` and any unknown value → "We could not log you in. Try again in a moment." The banner renders above the fields like every other error, the Google button stays available, and the flag is stripped with `router.replace` after being shown once. Without this mapping the one new button on the page has no failure copy at all.
  - read only: n/a.
  - denied: n/a (there is nothing to deny before a session).
  - offline / session expired: a network failure renders the banner "Can't reach WorkwrK. Check your connection." with a "Try again" text link, never a generic error. Arriving here from the Session expired dialog carries `?callbackUrl=` and shows a `--os-brand-soft` strip at the top of the card: "You were logged out. Log in to pick up where you left off."
  - Query flags read here, all stripped with `router.replace` after being shown once: `?signedup=1` → success strip "Workspace created. Log in to continue."; `?reset=1` → "Password changed. Log in with your new password."; `?verified=1` → "Email verified."; `?loggedout=1` → "You are logged out."; `?callbackUrl=` → preserved through both steps and used as the destination; `?error=` → the NextAuth outcome mapped by `friendlyError()` as listed above (NextAuth writes this flag itself, so the page must read it); `?deleted=1` → "Your account has been deleted."; `?token=` is never read here (an invitation token belongs to `/join`). `?registered=true`, which nothing reads today, is accepted for one release and mapped to `?signedup=1`.
- **Keyboard**: Enter submits the visible step; Tab order is email, password, eye toggle, forgot link, primary; the code field auto-submits on the sixth digit only when the value is six digits and the person has not touched the Verify button (no auto-submit for backup codes).
- **Data**: `signIn("credentials", { redirect: false })` and `signIn("google")`; the credentials `authorize` in `src/lib/auth.ts` returns `MFA_REQUIRED` or `MFA_ENROL_REQUIRED`; `getProviders()`. The enrol panel uses `GET/POST /api/auth/mfa/enroll`. Settings read: `Organization.settings.security.{mfaRequired, lockoutThreshold, lockoutMinutes}` (through `auth.ts` and `login-throttle.ts`, wired by the settings unit's S5); `ENFORCE_MFA_AT_LOGIN` remains the global floor the org value can only narrow. New API: none; `authorize` gains the `MFA_ENROL_REQUIRED` outcome.
- **Realtime**: none.
- **What changes vs today**: the black `bg-slate-900` primary becomes `--os-brand`; `Loader2` becomes the four dot pending loader; a show/hide password toggle appears; the Google button appears only when the provider really exists, and every way Google can refuse now has copy on this page instead of a bare `?error=` in the URL bar; the proof panel stops advertising SSO that has no button (B16, B29); the MFA field stops rejecting pasted spaces; the lockout, account and workspace messages come from the org's real policy instead of hard coded constants; `?registered=true` is read; the callback URL survives the MFA step (today the second step re-reads it correctly, but the Session expired path never sets it); enrolment at login exists, so an org that requires two step verification can actually turn it on without locking anyone out; `metadata.robots` is `noindex, nofollow` on this and every auth page (B28); "Sign in" becomes "Log in" everywhere on the page.
- **Open questions**: none.

---

### `/signup`  (`(auth)/signup/page.tsx`, new file replacing the self serve half of `register`)

- **Purpose**: create a workspace for your business in under a minute.
- **Who sees it**: anyone. Entry points: every marketing CTA (`Start free`, nav, hero, pricing, sticky bar, the Stack Receipt, the final CTA), which today 404 because they point at `/signup` and the page lives at `/register` (marketing #1, critic #8); `/login`'s footer link; the 308 from `/register`; `app.workwrk.com/signup?template=tuesday` from the marketing concept's deep link.
- **Top bar**: none (the `(auth)` shell).
- **Secondary sidebar**: none; the proof panel on the right above 1024px.
- **Page header stack**: title 22/600 "Start your workspace"; subtitle 14/400 "Free for 14 days. No card needed." rendered only while that is literally true of the plan the org will be created on, read from a build time constant, not hard coded copy. The one blue button is **Create workspace**.
- **Body layout**, one card, fields in this order:
  1. **Company name** (36px, `autoFocus`, placeholder "Northwind Ops", helper appears on blur: "Your workspace will live at {slug}.workwrk.com" only if per-org subdomains exist; otherwise no helper).
  2. **First name** and **Last name** side by side (`1fr 1fr`, gap 16).
  3. **Work email** (`type=email`, `autoComplete="email"`; on blur, a free-mail domain shows a 13/400 `--os-ink-2` note, not an error: "You can use a personal address. A work address makes inviting your team easier later.").
  4. **Password** (`autoComplete="new-password"`, eye toggle) with a **live rule checklist** directly beneath it: four 13/400 rows, each a 16px `Check` that fills `--os-success-text` as the rule is met, greyed `--os-ink-3` until then: "At least 8 characters", "One uppercase letter", "One number", and "One symbol" only when the policy requires it. The rules are the platform default here (there is no org yet) read from `GET /api/auth/password-policy`. This is what ends B8: the rules are visible before submit, not discovered in a server error.
  5. A 13/400 `--os-ink-2` consent line, not a checkbox: "By creating a workspace you agree to the **Terms** and the **Privacy Policy**." with both as `--os-brand-deep` links. The server records `termsAcceptedAt` and the policy version on the new `User` row, which is what a corporate buyer asks for and what nothing records today.
  6. Primary **Create workspace**, full width.
  7. Footer: 13/400 "Already have a workspace? **Log in**" → `/login`. A second line "Been invited? Open the link in your invitation email." (plain text, no link: the token is in the email).
- **After submit**: `POST /api/auth/register`, then `signIn("credentials", { redirect: false })` with the same values, then `router.push("/onboard")`. If the auto login fails the page goes to `/login?signedup=1`, which the login page now reads.
- **Side panel / drawer / modal**: none.
- **States**: loading = the primary's four dot pending loader; empty = n/a; error = the same danger banner as login, with field level errors preferred: an email already in use renders under the email field as "An account already uses this address. **Log in** instead." with the link inline; a rate limited IP renders the banner "Too many attempts. Try again in an hour."; read only = n/a; denied = n/a; offline = "Can't reach WorkwrK. Check your connection." with Try again.
- **Keyboard**: Enter submits; Tab order follows the fields; the checklist is `aria-live="polite"` so a screen reader hears rules being met.
- **Data**: `GET /api/auth/password-policy` (new, see below); `POST /api/auth/register`. Shape change to `register`: accepts `template?: string` and `termsAcceptedAt`, and calls `seedOrgDefaults(orgId)` (settings spec §11.1) inside the create transaction, which is what creates the six departments, the "General" Space, the locale defaults, the sign-in policy and `console.setupCompletedAt = null`. When `template` is present the Template Center template is applied in place of the bare General Space. The welcome email is sent from the rebuilt template (below) and a verification email is sent in the same transaction, which is what ends "every account is unverified forever" (B11).
- **Realtime**: none.
- **What changes vs today** (`auth-onboarding.md` 1.3): the URL is the one the whole marketing site already points at; the invite flow is no longer bolted onto this form; the password rules are visible before submit; terms acceptance is recorded; a verification email is actually sent; the destination is the one wizard rather than `/setup`; the primary is blue, not black; `Loader2` is gone; the "No credit card. Full access for 14 days." claim renders only if the plan really does that; `noindex`.
- **Open questions**: none. Whether the marketing primary CTA is "Start free" or "Book a demo" is the marketing unit's config flag and does not change this page.

---

### `/join`  (`(auth)/join/page.tsx`, new file replacing `register?token=`)

- **Purpose**: accept an invitation and get in, seeing exactly what you are joining. For a brand new person that includes setting a password; for someone who already has a WorkwrK account it does not.
- **Who sees it**: anyone holding an invitation link, signed out or in, with or without an existing WorkwrK account. Entry points: the invitation email's primary button (`api/invitations/route.ts` builds the link); the share dialog's Guest invitation email (access spec §2.3); the 308 from `/register?token=`; a return trip from `/login?callbackUrl=/join?token=…`; a forwarded link.
- **Top bar**: none.
- **Secondary sidebar**: none. The proof panel is **replaced** on this route by the **invitation panel**: the org's logo (or its initials in a 36px `EntityTile`), the org name 22/600 white, and below it the real invitation facts, each 14/400 at `--os-chrome-fg-2`: "Invited by {inviter name}", "As a {role label}", "In {department}", "Reporting to {manager}", and, when the inviter typed one, the personal message in a 13/400 quoted block. Only the facts the invitation actually carries render; nothing is invented.

  **Guest variant.** A share dialog invitation carries `orgRole = GUEST`, the object and the object role (access spec §2.3), and those are the facts a Guest needs, not employment facts they do not have. When `orgRole` is GUEST the panel drops "As a {role label}", "In {department}" and "Reporting to {manager}" entirely and renders instead: the object as a 20px `EntityTile` plus its name 14/400 ("Website redesign"), the object role in the access model's words on the line beneath ("You will have **Can edit** on it", from Can view, Can comment, Can edit, never a raw enum), and, when the object sits in a container the Guest will also see, one 13/400 `--os-ink-2` line "Inside {Space name}". The inviter line and the personal message render as they do for a Member. A Guest is never told the org's department list or head count. This is what makes the accept page a real welcome instead of a second signup form, for both kinds of joiner.
- **Page header stack**: title 22/600 "Join {Org}" in every variant, because that is what the page is for; subtitle 14/400 "You are joining as {email}" in Variants A and C, "You already have an account for {email}" in Variant B, and "This invitation is for {invited email}" in Variant D. The one blue button is **Join {Org}** in A and C and **Log in and join** in B; Variant D's one primary is **Log out and join as {invited email}**. One primary in every variant, never two.
- **Body layout**: the card has four variants and the GET on the token decides which one renders, because this is the second most used door into the product and three of the four are people who already exist. `GET /api/auth/accept-invite?token=` returns `accountExists` (any live `User` with this address anywhere on the platform) and `alreadyInThisOrg`, and the client knows its own session, so the choice needs no guessing.

  **Variant A, a new person, signed out** (today's only case):
  1. A `--os-brand-soft` 44px strip "{email}" with a 16px `Mail`, and under it 13/400 "This invitation is for this address." The email is not an input.
  2. **First name** and **Last name** side by side, prefilled from the invitation when it carries them.
  3. **Password** with the eye toggle and the live rule checklist, whose rules come from **the inviting org's** policy (`GET /api/auth/password-policy?token=…`), not the platform default. A member meeting a stricter corporate policy sees it before they type.
  4. Primary **Join {Org}**, full width.
  5. Footer: one 13/400 line, "Already have a WorkwrK account, or not you? **Log in** first" → `/login?callbackUrl=/join?token=…`, which is the same destination for both readings and so is one link, not two.

  **Variant B, this address already has an account elsewhere, signed out** (`accountExists: true`): the card keeps the email strip and drops First name, Last name, Password and the checklist entirely, because none of them apply: the person has a name and a password already, and `POST /api/auth/accept-invite` would refuse the password anyway. Body: one 14/400 line "You already use WorkwrK with this address. Log in once and {Org} is added to your workspaces." Primary **Log in and join** → `/login?callbackUrl=/join?token=…`. Footer as Variant A. On return the page is Variant C.

  **Variant C, signed in as the invited address**: the email strip carries a 16px `Check` in `--os-success-text` and the line "You are logged in as {email}." No fields at all. One 14/400 line "Joining adds {Org} to your workspaces. You can switch between them from the workspace menu." Primary **Join {Org}**, which posts the authenticated accept (no password in the body). Footer: 13/400 "Not you? **Log out and use a different account**" → `signOut({ callbackUrl: "/join?token=…" })`.

  **Variant D, signed in as somebody else**: a 44px `--os-warning-bg` strip at the top of the card, "You are logged in as {current email}. This invitation is for {invited email}." Then the same two choices as words, not as a guess: primary **Log out and join as {invited email}** (`signOut` with the join URL as the callback) and a 13/500 text link "Stay logged in as {current email}" → `/today`. Nothing is posted while the mismatch stands, because accepting would attach the invitation to the wrong person.
- **After submit**: `POST /api/auth/accept-invite` (with the password in Variant A, without it in Variant C), then auto login for Variant A, then a **full document navigation to the `landing` path the response returns**, so the session, the boot payload and the sidebar are built for the workspace just joined. `landing` is resolved server side, in this order, and never by the client guessing: the invitation's object URL when it carries one (which is every Guest invitation and any Member invitation sent from a share dialog), else the Space the invitation added them to, else `/today`. A Guest therefore lands on the shared object, exactly as access spec §2.3 requires, and the phrase "their first shared object" does not appear anywhere as an unresolved instruction. The invited member first run hint (§2, below) fires on that first authenticated render.
- **Side panel / drawer / modal**: none.
- **States**:
  - loading (fetching the invitation): the whole card renders as three skeleton bars and the invitation panel as two; the primary is absent until the invitation resolves, rather than present and disabled.
  - empty: n/a.
  - error: **four dedicated screens**, not a banner over a still rendered form (today the form stays up and merely disables, `auth-onboarding.md` 1.3):
    - **Invalid link**: a 96px four-dots-in-a-row line drawing in `--os-line-strong`, "This invitation link is not valid", one 13/400 line "Ask whoever invited you to send a new one.", one text link "Log in" for someone who already has an account.
    - **Already used**: "You have already joined {Org}", one primary "Log in".
    - **Expired**: "This invitation expired on {date}", one 13/400 line "Ask {inviter name} to send a new one.", plus a secondary "Ask for a new invitation" which posts `POST /api/invitations/request-resend { token }` and becomes "We let {inviter} know." This is the recovery B24 says does not exist.
    - **Already a member of this workspace**: the screen for the one server refusal that has no UI today. `POST /api/auth/accept-invite` answers 400 "An account with this email already exists in this organization" (`src/app/api/auth/accept-invite/route.ts:74-80`) and the page turns that into: "You are already in {Org}", one 13/400 line "This invitation is not needed. Log in and you are there.", one primary **Log in** → `/login?callbackUrl=/today`. The GET returns `alreadyInThisOrg: true` for the same case, so in practice this screen renders before anyone types a password rather than after; the POST mapping exists so a race cannot produce a raw 400.
    - Every one of these screens, and Variants B, C and D above, replaces the card body at the same URL. None of them is a redirect, so the person can always read what happened.
  - read only: n/a; denied: n/a; offline: the standard connection banner with Try again.
- **Keyboard**: Enter submits; the checklist is `aria-live="polite"`.
- **Data**: `GET /api/auth/accept-invite?token=` and `POST /api/auth/accept-invite`.
  - **Shape change to the GET**, all of it feeding something visible: `inviterName`, `organizationLogo`, `departmentName`, `orgRole` (OWNER is impossible; ADMIN, MEMBER or GUEST), `roleLabel` (from `src/lib/access/labels.ts`, in the four-role vocabulary, never a raw `AccessLevel`), `isAgent`, `managerName`, `message`, `expiresAt`, `passwordPolicy`, plus the four facts the variants need: `accountExists`, `alreadyInThisOrg`, and for a share dialog invitation `object { kind, name, url, containerName }` and `objectRole` ("Can view", "Can comment", "Can edit").
  - **Shape change to the POST**: it keeps today's signed out branch (password required, enforces the inviting org's policy, creates the `User`, materialises the role's KRAs and SOPs, adds the Space the invitation carried) and gains an **authenticated branch** for Variants B and C: when the caller's session email matches the invitation's address, no password is accepted or required, and the write is a membership plus the invitation's object grants for the existing person, not a second `User` row. Both branches return `landing`. The 400 on "already in this organization" stays and is mapped to its screen.
  - New API: `POST /api/invitations/request-resend` (unauthenticated, token bound, rate limited, notifies the inviter and the org's Admins in their Inbox).
- **Realtime**: none.
- **What changes vs today**: the invitation's context (inviter, role, department, manager, message) is finally shown, having only ever existed in the email body; a Guest sees the object and the object role they are being given, which is the only context that means anything to them; the role reads as "Member" or "Guest", not as a raw enum; the org's password policy drives the checklist; the four failure cases get real screens with a real recovery; a person who already has a WorkwrK account stops being shown a password form they cannot use and a raw 400 at the end of it, and instead adds a membership, which is what multiple memberships, `GET /api/me/orgs` and Switch workspace have always implied; a person already signed in is neither logged out silently nor asked to retype their name; the URL says what the page does; the black primary becomes blue.
- **Open questions**: none.

---

### `/forgot-password`  (`(auth)/forgot-password/page.tsx`)

- **Purpose**: ask for a link that lets you set a new password.
- **Who sees it**: anyone. Entry points: `/login`'s "Forgot your password?" link, which carries `?email=` so the field is prefilled; `/reset-password`'s expired state; `/verify-email` no longer links here (that was the wrong target, B11).
- **Top bar**: none. **Secondary sidebar**: none.
- **Page header stack**: title 22/600 "Reset your password"; subtitle 14/400 "We will email you a link." The one blue button is **Send reset link**.
- **Body layout**: one card, one field **Work email** (`autoFocus` unless prefilled, in which case focus goes to the primary), then the primary full width, then a footer text link "Remember it? **Log in**".
- **Success state** (replaces the card body, same URL): a 96px four-dots-in-a-row drawing, "Check your inbox" 16/600, 13/400 "If an account uses {email}, a reset link is on its way. It works for 60 minutes." The wording no longer asserts that the address exists, matching what the anti-enumeration server actually does, and the number matches the token's real 60 minute life (today the copy says 30, B21). Below it a 13/400 line "Nothing after a minute? Check spam, or **try another address**" (the link resets the form) and a "Send again" text link that re-posts once and then disables for 60 seconds.
- **Side panel / drawer / modal**: none.
- **States**: loading = pending loader in the primary; empty = n/a; error = only the rate limit surfaces ("Too many requests. Try again in 15 minutes."), because every other outcome is a deliberate 200; read only = n/a; denied = n/a; offline = connection banner with Try again.
- **Keyboard**: Enter submits.
- **Data**: `POST /api/auth/forgot-password` (per email 5 per 15 minutes, per IP 20 per hour, token hashed at rest, 60 minute expiry). No new API.
- **Realtime**: none.
- **What changes vs today**: the 30 versus 60 minute copy lie is fixed; the success copy stops confirming that the account exists; a "Send again" affordance exists; the primary is blue; `noindex`.
- **Open questions**: none.

---

### `/reset-password`  (`(auth)/reset-password/page.tsx`)

- **Purpose**: set a new password from the emailed link.
- **Who sees it**: anyone holding a reset token. Entry point: the reset email only.
- **Top bar**: none. **Secondary sidebar**: none.
- **Page header stack**: title 22/600 "Set a new password"; subtitle 14/400 "For {email}" when the token resolves an address, else no subtitle. The one blue button is **Set password**.
- **Body layout**: one card. **New password** (eye toggle) with the live rule checklist driven by the **token's org policy** (`GET /api/auth/password-policy?token=`), then **Confirm password** (helper appears only on mismatch, as a field error: "These do not match."), then the primary, then a 13/400 line "Setting a new password logs you out everywhere else." (true: the server bumps `tokenVersion`).
- **Success state**: replaces the card body. A 16px `Check` in `--os-success-text` with "Password changed" 16/600, 13/400 "You are logged out on your other devices.", one primary **Log in** → `/login?reset=1`. An auto-redirect still fires after 4 seconds, but the button is present from the first frame, so a stalled timer is not a dead end (B26).
- **No token / invalid / expired**: a dedicated screen, four-dots-in-a-row drawing, "This reset link is not valid any more" 16/600, 13/400 "Links work for 60 minutes and only once.", one primary **Request a new link** → `/forgot-password`, one text link "Back to log in".
- **Side panel / drawer / modal**: none.
- **States**: loading = pending loader; empty = n/a; error = field level for mismatch and for a policy failure the checklist did not catch, banner for a server error; read only = n/a; denied = n/a; offline = connection banner.
- **Keyboard**: Enter submits; the checklist is `aria-live="polite"`.
- **Data**: `POST /api/auth/reset-password`; `GET /api/auth/password-policy?token=`. No other new API.
- **Realtime**: none.
- **What changes vs today**: the subtitle stops claiming a symbol is required when the policy requires an uppercase letter and a number (B8); the rules are shown live and come from the real org policy; the invalid token case gets a screen instead of a banner inside a live form; the success state has a manual way forward.
- **Open questions**: none.

---

### `/verify-email`  (`(auth)/verify-email/page.tsx`)

- **Purpose**: confirm the email address on your account.
- **Who sees it**: anyone holding a verification token, plus anyone who wants a new one. Entry points: the verification email sent at signup (new), the verification email sent by "Send verification email" on `/account/profile` or `/account/security`, the reminder email sent 3 days after signup when the address is still unverified (new, one reminder only), and `/login`'s footer line "Didn't get your verification email? Send a new link" which arrives at `?resend=1`.
- **Top bar**: none. **Secondary sidebar**: none.
- **Page header stack**: the title changes per state; there is no toolbar and no views row. The one blue button differs per state and is named below.
- **Body layout**, four states in one card, exactly one rendered:
  1. **Verifying**: the 16px four dot `pending` loader centred with "Checking your link…" 14/400 `--os-ink-2`. No page title yet.
  2. **Verified**: a 96px four-dots-in-a-row drawing, title "Email verified", 13/400 "{email} is confirmed.", primary **Continue to WorkwrK** → `/today` when a session exists, else **Log in** → `/login?verified=1`.
  3. **Already verified**: title "Already verified", 13/400 "Nothing more to do.", primary **Continue to WorkwrK** or **Log in** on the same rule.
  4. **Expired or invalid**: title "This link has expired", 13/400 "Verification links work for 24 hours.", primary **Send a new link**, which posts `POST /api/auth/request-verify { email }` when signed out (the new unauthenticated branch) or the session's address when signed in, and becomes the success line "Sent. Check your inbox." Text link "Back to log in". The "Request one" link that sends people to the password reset page today is deleted (B11).
  5. **Ask for a link** (`?resend=1`, with no token; this is where `/login`'s footer line lands): title "Send a verification email", 13/400 "We will send a new link to your address.", one 36px **Work email** field (prefilled from `sessionStorage["workwrk:last-email"]` when it exists), primary **Send a new link**, the same anti-enumeration 200 and the same "Sent. Check your inbox." line, then the "Back to log in" text link. The rate limits are the route's own (3 per hour per address, 10 per hour per IP).
  The message is rendered once, in the body, never twice as both a subtitle and a banner (today it appears twice, `auth-onboarding.md` 1.6).
- **Side panel / drawer / modal**: none.
- **States**: loading is state 1; empty = n/a; error is state 4 (a bad token) and, inside state 5, one field level line when the address is malformed; read only = n/a; denied = n/a; offline = connection banner with Try again.
- **Keyboard**: Enter activates the visible primary.
- **Data**: `POST /api/auth/verify-email`; `POST /api/auth/request-verify`. Shape change: `request-verify` accepts an unauthenticated `{ email }` body, always answers 200 (anti-enumeration), and is rate limited per email at 3 per hour and per IP at 10 per hour. New: the signup transaction sends the first verification email, and a cron row sends one reminder at 72 hours, recorded in `scripts/CRON-SETUP.md`.
- **Realtime**: none.
- **What changes vs today**: the page stops being orphaned, because verification emails are actually sent; the wrong "Request one" target is fixed; the doubled message is fixed; the legacy dark and lime email template is replaced.
- **Open questions**: none.

---

### `/onboard`  (`onboard/page.tsx`, the one wizard)

- **Purpose**: get a brand new workspace to the point where a team can start, in four steps that each do something real.
- **Who sees it**: **Owner and Admin** of an org whose `Organization.settings.console.setupCompletedAt` and `setupDismissedAt` are both null. Anyone else who opens the URL, including a Member with or without the Agent flag and a Guest, gets the "Nothing to set up" view at the same URL (States, below). There is no second redirect: access spec §5.5 rule 1 makes "not signed in" the only one, and rule 3 requires a view at the same URL for everything else. Entry points: `/signup` after the workspace is created; the Workspace settings Overview card "Set up {Org}" (see the one rule below); the 308 from `/setup` and from `/welcome`; a bookmark. `/join` does **not** route through here: it navigates straight to the `landing` path its API returns.

- **The wizard and the Overview card, one rule, so an admin never meets both.** Settings spec §11.2 defines a four step "Set up {Org}" card on Workspace settings › Overview that deep links into Identity, Members?invite=1, Structure?tab=departments and Apps#modules and ticks from data. This wizard writes exactly the same four things. They are the same task in two places, which is critic #3, so their visibility is decided by the two flags and nothing else:

  | State | `/onboard` renders | The Overview card renders |
  |---|---|---|
  | both flags null | the wizard | nothing (the admin is in the wizard; the card would be a duplicate of the same four steps) |
  | `setupDismissedAt` set ("Finish later", or Dismiss on the card) | the "Nothing to set up" view with a 13/500 text link "Pick up where you left off" → `/settings` | the four step card, ticked from data, at whatever step the data says |
  | `setupCompletedAt` set (Finish, or all four steps true in the data) | the "Nothing to set up" view | "Setup complete", collapsed to one line, dismissible |

  So: Finish hides both. Finish later hands the job to the card. Dismissing the card suppresses the wizard. The four steps tick from data in both places (a department created in Workspace settings ticks the wizard's step 3 if the wizard is reopened), never from "this step was visited".
- **Top bar**: none. Its own 56px header inside the wizard layout: the 28px logo lockup left (not a link: there is no "out" through the logo, which is half of what made B3 loop), the step rail centred (four 6px `Dots` in the `steps-n` variant with the current step's label 13/500 beside them; "Step 2 of 4" text under 900px), and a 13/500 "Finish later" text link right.
- **Secondary sidebar**: none.
- **Page header stack**: per step: a 22/600 title and a 14/400 `--os-ink-2` subtitle, then the step's content, then a 64px footer row: "Back" (secondary, absent on step 1) left, and on the right "Skip this step" (13/500 text link) plus the primary **Continue** (step 4's primary reads **Finish**). One blue button per step.
- **Body layout**, content column 720px centred on `--os-canvas`:

  **Step 1, "Make it yours"** (settings spec §11.2 step 1)
  - **Workspace name** (36px, prefilled from signup).
  - **Logo** (72px `EntityTile lg` showing the initials, plus "Upload" and, once set, "Remove"; `PATCH /api/settings { section: "profile" }` for the URL after the upload route stores it).
  - **What this company is here to do** (a 3 row auto-growing textarea, `settings.companyProfile.mission`, helper "One sentence. It shows on the loading screen for everyone."). This is the founder's mission splash content, captured at the one moment the founder is guaranteed to be present.
  - Writes on Continue: one `PATCH /api/settings { section: "profile" }` and one `{ section: "culture" }`.

  **Step 2, "Invite your team"** (step 2)
  - The real invite control, not a simplified one: a multi-email chip input (comma, space, Enter and paste all commit a chip; an invalid address stays in the draft in `--os-danger-text` rather than being silently dropped; an outside-domain address gets a 12/500 "Guest" chip suffix because that is what it will be, access invariant 17), a **Role** `Picker` offering Admin, Member and Guest with the four-role blurbs (never Owner, never `SUPER_ADMIN`, never the old nine level list), an **Agent (frontline caps)** checkbox that appears only under Member, an optional **Department** `Picker`, and an optional **Personal message** (textarea, 1000 chars).
  - One `POST /api/invitations` per address, the same gated route the Members page uses. Failures stay as chips with the reason under them ("Already a member", "Not an allowed domain").
  - Skip is honest here: "Skip this step" sends nothing and advances.

  **Step 3, "Create your departments"** (step 3)
  - A checkbox list pre-checked with the departments that **already exist** (the six `seedOrgDefaults` created: Engineering, Sales, Marketing, Operations, HR, Finance), plus a 36px "Add a department" input with an Add button and removable chips.
  - Writes are **per change, never a wholesale replace**: `POST /api/departments` for each added name, `DELETE /api/departments/[id]` for each unchecked department, and an unchecked department that has members shows an inline 13/400 `--os-warning-text` line "{n} people are in {name}. Move them first." and refuses to uncheck. Posting an empty list is impossible by construction, which is the root fix for B6 (today `/onboard` posts `departments: []` and deletes all six).
  - 13/400 helper: "You can change these any time in Workspace settings › Structure."

  **Step 4, "Turn on what you need"** (step 4)
  - Exactly two cards, one per premium module: **Talk** ("Chat, huddles and calls for your team") and **Tables** ("Spreadsheets that live with your work"), each with a 20px icon in a `--os-brand-soft` tile, a one line description and one `Switch` writing `POST/DELETE /api/products/installations`. New orgs start with both off (settings spec §11.1), and the caption says so: "Both are optional and you can turn them on later."
  - Nothing else appears here. The nine module cards, the industry pills, the use case cards, the team size cards and the app picker of the two old wizards are all deleted: they wrote `sidebar.pinned` that nothing reads (B5), fabricated `businessType`, `industry` and `teamSize` values (B6), and asked questions whose answers changed nothing. The fields that are genuinely useful (industry, business type, team size) stay editable on Workspace settings › Identity, where an admin meets them when they have a reason to care.

  **Done screen** (not a fifth step; it replaces the card after Finish): a 96px four-dots-in-a-row drawing, "You are set up" 22/600, then a checklist of what actually happened, each line derived from the writes that succeeded ("Workspace named Northwind Ops", "3 invitations sent", "6 departments", "Talk is on"), never a claim the wizard did not perform. One primary **Open my workspace** → `/today`. A 13/400 line "Anything else? Everything lives in Workspace settings."
- **Persistence between steps**: each Continue writes its step, then `PATCH /api/settings { section: "console", data: { setupStep: n } }`. Reopening the wizard resumes at the recorded step with the already-written values loaded, so a refresh no longer loses everything (the old `/setup` held six steps of input in memory only). Finish writes `console.setupCompletedAt`; "Finish later" writes `console.setupDismissedAt`. Both are server side, so the wizard does not reappear on another device.
- **Side panel / drawer / modal used here**: the Role, Department and logo pickers. No modal.
- **States**:
  - loading (resolving the session and the org): the boot navy screen with the four dot logo, the same one the app uses, so the wizard to app transition is one colour rather than today's light, navy, white flash (B19).
  - empty: n/a; every step has content.
  - error: a failed write **blocks the step and says so**: a `--os-danger-bg` banner above the footer with the reason and a "Try again" text link, and the Continue button re-enables. Today both wizards `console.error` and silently re-enable (B20), which is the difference between a user who retries and a user who thinks it worked.
  - read only: none.
  - denied: nobody is redirected and nothing is locked. A person the wizard is not for gets the **"Nothing to set up" view** at the same URL, inside the same full screen layout: the 28px logo lockup, a 96px four-dots-in-a-row drawing, "{Org} is ready" 22/600, one 13/400 `--os-ink-2` line that fits the reader ("Your workspace is set up. Your admin looks after the settings." for a Member or Guest; "You finished setting up {Org}." for an Owner or Admin whose flags are set), and one primary **Open my workspace** → `/today`, plus, for an Owner or Admin only, the 13/500 text link "Pick up where you left off" → `/settings`. A Guest sees the same view with the same primary; nothing here has to resolve which object they hold, because the person clicks a link rather than being thrown at one. The `POST /api/invitations` inside step 2 still enforces `org.invite_member` server side.
  - offline / session expired: the offline banner disables Continue with "You are offline. We will keep what you typed."; a 401 raises the Session expired dialog and the step's input is written to `sessionStorage` first.
- **Keyboard**: Enter advances when the step is valid; `⌘Enter` advances from a textarea; Esc triggers "Finish later" after a confirm when the step has unsaved input.
- **Data**: `PATCH /api/settings` (`profile`, `culture`, `console`), `POST /api/invitations`, `GET/POST/DELETE /api/departments`, `POST/DELETE /api/products/installations`, `POST /api/users/[id]/avatar` style upload for the logo. **Retired**: `GET/POST /api/setup` (its department sync, its module normalisation and its unguarded invite loop all die with it) and `GET /api/onboarding-progress` (the eight step checklist API with no consumer). Settings read: `settings.console.{setupStep, setupCompletedAt, setupDismissedAt}`, the existing department list, `ProductInstallation`.
- **Realtime**: none.
- **What changes vs today**: two wizards become one; the skip loop is gone at the root (the dashboard layout no longer gates on `setupCompleted`); departments are never wiped; nothing writes `sidebar.pinned`; no fabricated profile values are stored; invites go through the gated route with the real role vocabulary; every step persists as you go; failures are visible; the "we pinned N apps" and "pre-built agents for {dept}" claims, which nothing performed, are deleted; the three visual dialects (slate, shadcn with pre-OS tokens, zinc with inline hex and Figtree) become the one design system; the progress idiom is the `steps-n` dots, not a bar, chips, dots and "step N of 3" all at once (B22).
- **Open questions**: one for the founder, listed in §5's open questions rather than here: whether step 1's mission field is required before Continue. The spec assumes optional.

---

### MFA enrolment dialog  (no URL; `src/components/account/mfa-enrol-dialog.tsx`)

- **Purpose**: turn on two step verification and save your backup codes.
- **Who sees it**: the person themselves, from `/account/security` (the "Turn on" control, or `?enrol=mfa`), from `/login` step 2b, and from the Security hold dialog. Never opened for someone else.
- **Top bar**: n/a. **Secondary sidebar**: n/a.
- **Page header stack**: n/a (a modal). Modal header 56px: title 16/600 "Set up two step verification", ✕ right.
- **Body layout**: 560px modal, three phases in place, a `quad-steps` `Dots` glyph in the header showing which of three:
  1. **Scan**: the QR as a 160px image on a white square, to its right the instruction "Scan this with Google Authenticator, 1Password, Authy or any authenticator app." 14/400 and, beneath, "Can't scan? Enter this key" with the secret in `JetBrains Mono` 13/400 and a 28px Copy ghost. Under both, one 36px field **6 digit code** (`inputMode="numeric"`, strips spaces and hyphens) and the footer's primary **Turn on**.
  2. **Backup codes**: eight codes in a 2 column `JetBrains Mono` 14/400 grid, "Copy codes" and "Download .txt" as 32px secondaries, a required checkbox "I have saved these codes somewhere safe", and the footer primary **Done** which is inert until the checkbox is ticked. A 13/400 `--os-warning-text` line: "Each code works once. Without your phone and without these you will need an admin to reset your access."
  3. **Couldn't set up**: a 13/400 `--os-danger-text` line with the reason and two buttons, "Try again" (back to phase 1 with a fresh secret) and "Cancel".
- **Side panel / drawer / modal**: this is the modal. Pickers inside it, none.
- **States**: loading = phase 1 shows a 160px `--os-skeleton` square while `GET /api/auth/mfa/enroll` is in flight; empty = n/a; error = phase 3, plus a field level "That code is not right. Codes change every 30 seconds." on a wrong code; read only = n/a; denied = n/a; offline = the primary shows the offline toast and does not submit.
- **Keyboard**: Enter submits the visible phase; Esc closes, but in phase 2 it first confirms ("Save your backup codes first. Close anyway?") because the codes are shown once.
- **Data**: `GET /api/auth/mfa/enroll` (secret and QR), `POST /api/auth/mfa/enroll` (verify and enable, returns the codes). Writes `User.mfaEnabled`, `mfaSecret`, `mfaBackupCodes`. Logs `mfa_enabled` to security activity.
- **Realtime**: none.
- **What changes vs today**: the dialog renders inside the tokenised system instead of on literal `#0073EA` and `#E2445C` with `dark:` variants; the "I have saved these" gate is new, which is what stops a person enabling two step verification and losing their account; the download option is new; the input accepts pasted spaces.
- **Open questions**: none.

---

### MFA turn off dialog  (no URL; `src/components/account/mfa-disable-dialog.tsx`)

- **Purpose**: turn two step verification off, proving it is you first.
- **Who sees it**: the person themselves, from `/account/security`'s "•••" menu. The row's menu does not contain this item at all when the org requires two step verification for their role.
- **Top bar**: n/a (the app's navy top bar stays where it is behind the scrim; this surface adds nothing to it).
- **Secondary sidebar**: n/a.
- **Page header stack**: n/a. Modal header 56px: title 16/600 "Turn off two step verification", ✕ right.
- **Body layout**: 400px modal. One 13/400 `--os-warning-text` line "Your account will be protected by your password alone." Then one 36px field **6 digit code or backup code** (accepts both, strips spaces and hyphens, `maxLength=9`), helper "From your authenticator app, or one of your backup codes." Footer: Cancel (ghost) left of the one destructive primary **Turn off**.
- **Side panel / drawer / modal used here**: this block is the modal (400px `ui/dialog`). It opens no picker, no drawer and no second dialog.
- **States**: loading = pending loader in the primary; empty = n/a; error = field level "That code is not right."; read only = n/a; denied = a 403 from the server (policy changed since the page loaded) closes the dialog and refreshes the row into its "Required by {Org}" state with one toast; offline / session expired = the offline toast holds the submit, and a 401 closes the dialog and raises the Session expired dialog.
- **Keyboard**: Enter submits, Esc closes.
- **Data**: `DELETE /api/auth/mfa/enroll`. Logs `mfa_disabled`.
- **Realtime**: none.
- **What changes vs today**: the input hint and the accepted format now match the enrol dialog (today one strips non digits and the other accepts any text, B25); the copy names the consequence.
- **Open questions**: none.

---

### Backup codes dialog  (no URL; `src/components/account/backup-codes-dialog.tsx`, new)

- **Purpose**: see how many backup codes you have left, or get a new set.
- **Who sees it**: the person themselves, from `/account/security`'s "Show backup codes" and "Get new backup codes".
- **Top bar**: n/a (the app's navy top bar stays where it is behind the scrim; this surface adds nothing to it).
- **Secondary sidebar**: n/a.
- **Page header stack**: n/a. Modal header 56px: title 16/600 "Backup codes", ✕ right.
- **Body layout**: 560px. Read mode: "{n} of 8 codes unused" 14/400 and a masked grid (used codes struck through in `--os-ink-3`, unused shown as `••••••••`), with one secondary "Get new codes". Regenerate mode: one 36px field **6 digit code** to prove identity, primary "Get new codes", then the new eight in the same grid as the enrolment dialog with Copy, Download and the "I have saved these" checkbox before Done. A 13/400 line: "Getting new codes cancels your old ones."
- **Side panel / drawer / modal used here**: this block is the modal (560px `ui/dialog`). Nothing opens on top of it.
- **States**: loading = skeleton grid; empty = n/a (there is always a count, even when it is "0 of 8"); error = field level on a wrong code, one banner inside the dialog on a server error; read only = n/a; denied = n/a; offline / session expired = offline toast, and a 401 closes the dialog and raises the Session expired dialog.
- **Keyboard**: as the enrol dialog, including the Esc confirm while new codes are shown.
- **Data**: new `POST /api/auth/mfa/backup-codes` (requires a fresh valid TOTP code, returns eight new codes, invalidates the previous set, logs `mfa_backup_codes_regenerated`).
- **Realtime**: none.
- **What changes vs today**: it exists. Today the codes are shown exactly once, at enrolment, and a person who loses them has no path except an admin reset, which also has no UI.
- **Open questions**: none.

---

### Change password dialog  (no URL; `src/app/(dashboard)/account/security/change-password-modal.tsx`)

- **Purpose**: change your password, with the workspace's rules in front of you.
- **Who sees it**: the person themselves, from `/account/security`, and automatically once per session when the password has expired under the org's maximum age.
- **Top bar**: n/a (the app's navy top bar stays where it is behind the scrim; this surface adds nothing to it).
- **Secondary sidebar**: n/a.
- **Page header stack**: n/a. Modal header 56px: title 16/600 "Change password", ✕ right.
- **Body layout**: 560px. **Current password**, **New password** (eye toggle) with the live rule checklist built from **this org's** policy (length, uppercase, number, symbol, and "Not one of your last 3 passwords" when the org sets reuse rules), **Confirm new password**. A 13/400 line "You stay logged in here. Every other device is logged out." Footer: Cancel left of the primary **Change password**.
- **Side panel / drawer / modal used here**: this block is the modal (560px `ui/dialog`). The rule checklist is inline, not a popover.
- **States**: loading = pending loader; empty = n/a; error = field level for a wrong current password ("That is not your current password.") and for a policy failure, banner for a server error; read only = n/a; denied = n/a; offline / session expired = offline toast, and a 401 closes the dialog and raises the Session expired dialog with the typed values discarded (a password is never written to `sessionStorage`).
- **Keyboard**: Enter submits, Esc closes (confirm when fields are filled).
- **Data**: `POST /api/me/change-password` (already validates against `policyFromOrgSettings` and bumps `tokenVersion` for every other session, then re-syncs this one). Writes `User.passwordChangedAt` (new column, settings unit S5). Logs `password_changed`.
- **Realtime**: none.
- **What changes vs today**: the org's rules are printed under the field instead of only being enforced on submit, which is where a Member meets the policy at all (settings spec §4.4); the expiry path exists.
- **Open questions**: none.

---

### Log out everywhere confirm  (no URL; `src/components/account/sign-out-everywhere-dialog.tsx`)

- **Purpose**: end every other session when you think someone else has your account.
- **Who sees it**: the person themselves, from `/account/security`.
- **Top bar**: n/a (the app's navy top bar stays where it is behind the scrim; this surface adds nothing to it).
- **Secondary sidebar**: n/a.
- **Page header stack**: n/a. Modal header 56px: title 16/600 "Log out everywhere", ✕ right.
- **Body layout**: 400px. One 14/400 line "This logs you out on every device, including this one. You will need to log in again." Footer: Cancel left of the destructive primary **Log out everywhere**. No typed confirmation: this is recoverable and personal, and typed confirmation is reserved for org level destruction (design system §5.4).
- **Side panel / drawer / modal used here**: this block is the modal (400px `ui/dialog`).
- **States**: loading = pending loader; empty = n/a; error = banner inside the dialog with Try again; read only = n/a; denied = n/a; offline / session expired = offline toast and the action does not fire; a 401 means the session already ended, so the dialog closes and the Session expired dialog takes over, which is the same outcome the person asked for.
- **Keyboard**: Enter activates the primary, Esc cancels.
- **Data**: `POST /api/me/sign-out-everywhere` (bumps `tokenVersion`), then `signOut({ callbackUrl: "/login?loggedout=1" })`. Logs `signed_out_all_devices`.
- **Realtime**: none.
- **What changes vs today**: it is a confirm rather than a bare button that immediately nukes the session; the copy says this device is included, which today it silently is.
- **Open questions**: none.

---

### Security hold dialog  (no URL; `src/components/account/security-hold-dialog.tsx`, new)

- **Purpose**: when the workspace's rules change under you mid session, say what must happen before you carry on.
- **Who sees it**: a signed in person whose org has since started requiring two step verification for their role and who is not enrolled, or whose password has passed the org's maximum age. Raised by the shell when `/api/boot` or the SSE `session` event reports `hold: "mfa" | "password"`.
- **Top bar**: n/a (the app's navy top bar stays where it is behind the scrim; this surface adds nothing to it).
- **Secondary sidebar**: n/a.
- **Page header stack**: n/a. Modal header 56px: the variant title 16/600 and **no ✕**. The app frame stays visible behind it and is made inert with `aria-hidden`, exactly as the Session expired dialog does.
- **Body layout**: 400px modal, not dismissable by Esc or outside click, no ✕. Two variants:
  - **mfa**: title "Set up two step verification", body "{Org} now requires it for {role}s. It takes a minute.", primary **Set it up** which opens the MFA enrolment dialog in place, and a 13/500 text link **Log out**.
  - **password**: title "Time to change your password", body "{Org} asks everyone to change their password every {n} days.", primary **Change password** which opens the Change password dialog in place, and **Log out**.
- **Side panel / drawer / modal used here**: this block is the modal (400px `ui/dialog`, no ✕, not dismissable). Its primary opens a second dialog in place, the MFA enrolment dialog or the Change password dialog; the hold dialog stays mounted behind it and closes only when the hold clears.
- **States**, all six, because this dialog can be the only thing on screen: loading = while `/api/boot` is still resolving the hold nothing renders, so the app frame is never dimmed by a dialog that might not be needed; empty = n/a (a hold always has a variant); error = a failed enrolment or password change leaves the hold dialog standing with the inner dialog's own error, so the person is never dropped into a dimmed app with no way out; read only = n/a; denied = n/a (the hold is the org's rule applied to the viewer, not a permission decision); offline / session expired = the offline strip renders above the scrim and the primary is disabled with "You are offline", and a 401 replaces the hold with the Session expired dialog, which is the stronger of the two.
- **Keyboard**: Enter activates the primary; Tab is trapped; Esc does nothing.
- **Data**: `/api/boot`'s `session.hold`; the two dialogs above.
- **Realtime**: the SSE `session` event can raise it mid session.
- **What changes vs today**: nothing existed. Today an org can set a policy that nothing enforces for people already signed in. This is the surface that makes the settings unit's sign-in policy real without adding a second redirect to the access model.
- **Open questions**: none.

---

### Session expired re-login  (no URL; the auth half of `SessionExpiredDialog`)

- **Purpose**: when your session ends mid work, get you back to the same page without losing what you typed.
- **Who sees it**: anyone whose session lapses: idle timeout, absolute lifetime, a `tokenVersion` bump from "Log out everywhere", a password change elsewhere, deactivation by an admin, or an org switch that invalidated the token.
- **Top bar**: n/a (the app's navy top bar stays where it is behind the scrim; this surface adds nothing to it).
- **Secondary sidebar**: n/a.
- **Page header stack**: n/a. The dialog is the shell's (shell spec §2.15) and carries its title and no ✕; this block fixes the auth side of the contract so the two halves cannot drift.
- **Body layout**: the shell renders the 400px non dismissable dialog. Its primary navigates to **`/login?callbackUrl=<pathname + search>`**. `/login` then:
  1. renders the `--os-brand-soft` strip "You were logged out. Log in to pick up where you left off.";
  2. prefills the email field from `sessionStorage["workwrk:last-email"]`, which `/login` writes on every successful log in and which holds only an address;
  3. on success pushes the `callbackUrl` rather than `/today`, after validating that it is a same origin app path (any absolute URL or any path outside `APP_PREFIXES` falls back to `/today`, so the parameter is not an open redirect);
  4. when the reason was a sign-out-everywhere, adds the second line "You were logged out on every device."
- **Side panel / drawer / modal used here**: the shell's 400px `SessionExpiredDialog` (shell spec §2.15). This block owns only what happens after its primary is pressed; it opens nothing of its own.
- **States**, all six: loading = the primary shows the four dot pending loader while the navigation is prepared and the draft flush runs; empty = n/a; error = if the draft flush throws, the navigation still happens and the editor shows "Restore unsaved changes" from whatever was written, because a failed save must never trap a person in a dead session; read only = n/a; denied = n/a; offline / session expired = this **is** the session expired state, and while the browser is also offline the dialog keeps the offline strip above the scrim and the primary reads "Log in" but says "You are offline" in a 13/400 line under it until the connection returns.
- **Keyboard**: Enter activates the primary.
- **Realtime**: the SSE `session` event and any `apiFetch` 401 both raise it, so an admin deactivating someone, or a "Log out everywhere" from another device, reaches an open tab within one event rather than on the next navigation.
- **Data**: the `workwrk:session-expired` event; `useDraftOnExpiry` flushes editor drafts to `localStorage["workwrk:draft:{kind}:{id}"]` before the navigation, and each editor offers "Restore unsaved changes" on its next mount (the data integrity rule).
- **What changes vs today**: today nothing intercepts a 401, so an expired 12 hour JWT renders empty sidebars and "Inbox Zero" (critic #11 and `missedSurfaces`), and `(dashboard)/layout.tsx` drops the callback URL when it does redirect. Both ends are fixed: the callback is carried, and it is validated.
- **Open questions**: none.

---

### Switch workspace  (no URL; the flow behind the workspace menu's switcher)

- **Purpose**: move between the workspaces you belong to without logging out.
- **Who sees it**: anyone with more than one `OrganizationMembership`. The trigger is the workspace menu in the sidebar header (shell spec §2.14); this block specifies the flow, which is a session act.
- **Top bar**: n/a. The trigger lives in the sidebar header, not the top bar.
- **Secondary sidebar**: the workspace menu opens from the secondary sidebar's 56px header on every hub (design system §4.2); no sidebar row is active for it and no row changes while it is open.
- **Page header stack**: n/a (a menu, not a page).
- **Body layout**: the menu lists each membership as a 36px row: a 24px logo or `EntityTile` with initials, the org name 15/400, the person's role there as a 12/500 `--os-ink-2` label, and a 16px `Check` in `--os-brand-deep` on the current one. Below the list, "Create a workspace" with a `Plus`. Workspaces whose status is CANCELLED or SUSPENDED are not listed (the API already filters them).
- **The flow**, exactly:
  1. Clicking a row shows the row's `pending` four dot loader in place of its logo; the menu stays open and every other row is inert.
  2. `POST /api/me/switch-org { organizationId }`, which refuses a membership the person does not hold with a 403 and writes two audit rows, one in each org.
  3. On success the client calls `session.update()` to refresh the JWT, then performs a **full document navigation** to `/today` (not a client push), so every cached query, the SSE connection, the shell's boot payload and the settings registry are rebuilt for the new tenant. A client side push here is the classic cross tenant data leak and is forbidden.
  4. Between step 2 and step 4 the boot navy screen with the four dot logo covers the transition, with the new org's name under it once known.
  5. Failure toasts "Couldn't switch workspace" with the server reason and a Retry, and the menu returns to rest. A 403 additionally refreshes the membership list, because it means the membership was removed while the menu was open.
- **Side panel / drawer / modal used here**: none of its own. The trigger is the workspace menu in the sidebar header (a `MenuList` popover the shell owns); this flow adds no dialog, and the boot navy screen that covers the switch is a full screen cover, not a modal.
- **States**: loading = the row's pending loader then the boot screen; empty = a person with one membership never sees the switcher section, only "Create a workspace"; error = the toast above; read only = n/a; denied = the 403 path; offline / session expired = the row does not fire and the offline toast shows; a 401 raises the Session expired dialog and the menu closes.
- **Keyboard**: ↑↓ through rows, Enter switches, Esc closes the menu.
- **Data**: `GET /api/me/orgs`, `POST /api/me/switch-org`. Both exist. No new API.
- **Realtime**: the old org's SSE connection is closed before the navigation.
- **What changes vs today**: the transition is specified (today the client hard navigates, which is right, but nothing covers the gap and nothing stops a second click); the role per workspace is shown; the audit rows already exist and are named here so the security activity list can render "Workspace switched".
- **Open questions**: none.

---

### Delete my account  (no URL; `src/components/account/delete-account-dialog.tsx`, new)

- **Purpose**: leave the workspace and remove your personal data.
- **Who sees it**: the person themselves, from `/account/profile`'s danger zone.
- **Top bar**: n/a (the app's navy top bar stays where it is behind the scrim; this surface adds nothing to it).
- **Secondary sidebar**: n/a.
- **Page header stack**: n/a. Modal header 56px: title 16/600 "Delete my account", ✕ right.
- **Side panel / drawer / modal used here**: this block is the modal (400px `ui/dialog`). It opens nothing further.
- **Body layout**: 400px, `1px solid var(--os-danger-border)` on the danger card inside it. A 14/400 paragraph naming exactly what happens: "You will be removed from {Org}. Your profile, preferences and personal notes are deleted. Tasks, docs and messages you created stay with the workspace, and your name stays on them." Then a 36px field labelled `Type DELETE to confirm`. Footer: Cancel left of the destructive primary **Delete my account**, inert until the field reads exactly `DELETE`.
- **States**: loading = pending loader; empty = n/a; error = a banner inside the dialog. The **last Owner** case is a refusal with its own copy, shown before the field: "You are the only Owner of {Org}. Make someone else an Owner first, or delete the workspace from Workspace settings." with a link to `/settings/members` for an Owner; the confirm field does not render at all in that state. read only = n/a; denied = n/a; offline = offline toast.
- **Keyboard**: Enter activates the primary when the field is valid; Esc cancels.
- **Data**: `POST /api/me/delete { confirm: "DELETE" }` (exists, with no UI today). On success `signOut({ callbackUrl: "/login?deleted=1" })` and `/login` shows "Your account has been deleted."
- **Realtime**: none.
- **What changes vs today**: it exists. A route with no door is a compliance gap, not a feature.
- **Open questions**: none.

---

### Invited member first run hint  (no URL; `src/components/account/first-run-hint.tsx`, new)

- **Purpose**: tell a brand new teammate, once, where their own settings live.
- **Who sees it**: a Member (with or without the Agent flag) or a Guest, on their first authenticated render after accepting an invitation, when `home.ui.dismissed.firstRunHint` is not set (settings spec §11.3). Never an Owner or Admin: they meet the "Set up {Org}" card instead, and two first run surfaces at once is the duplicate this unit is closing.
- **Top bar**: n/a (the app's navy top bar stays where it is behind the scrim; this surface adds nothing to it).
- **Secondary sidebar**: n/a.
- **Page header stack**: n/a. No header row: it is a Radix `Popover`, non modal, anchored to the top bar avatar.
- **Body layout**: 280px popover, radius 8, `--os-shadow-pop`, padding 16: "Your profile and preferences are here" 14/500, one 13/400 `--os-ink-2` line "Photo, notifications, time zone and password.", and one 13/500 text link "Open My settings" plus a ghost "Got it". Dismissing either way writes `home.ui.dismissed.firstRunHint`. It appears 1.2 seconds after the shell settles, never over the mission splash, and never more than once per person across devices (because the flag is server side, not `localStorage`).
- **Side panel / drawer / modal used here**: this block is the popover. It opens nothing; its one text link navigates through `openSettings("/account/profile")` and dismisses the hint on the way.
- **States**, all six, short because the surface is small: loading = it never renders during boot, only 1.2 seconds after the shell settles and after the preference has resolved, so there is no loading frame; empty = n/a; error = a failed `PATCH` still closes the popover and records the dismissal in memory for this session, and it retries once on the next render rather than reappearing in the person's face; read only = n/a; denied = n/a; offline / session expired = it does not render at all while offline (the flag could not be written, and a hint that reappears every reload is worse than no hint), and a 401 anywhere in the shell closes it.
- **Keyboard**: Esc dismisses and writes the flag.
- **Data**: `PATCH /api/preferences { home: { ui: { dismissed: { firstRunHint: true } } } }`.
- **Realtime**: none.
- **What changes vs today**: it replaces the automatic nine step product tour that fires 800ms after the first render, stores its completion in `localStorage`, points three of its steps at renamed or gated pages, and promises a help icon that does not exist (B7). The tour itself is the shell unit's to rebuild or retire; this unit only guarantees that a new person is not left without a pointer to their own settings.
- **Open questions**: none.

---

## 3. Shared components this unit introduces or requires

Only components not already in `design-system.md`.

| Name | Lives in | Props | Used by |
|---|---|---|---|
| `AuthShell` | `src/app/(auth)/layout.tsx` | `{ panel?: "proof" \| "invitation" \| "none", children }` | every `(auth)` route. Two columns above 1024px: a white left column (page padding 24, form column `max-width: 400`, the 28px logo lockup at the top, the footer at the bottom) and a `--os-chrome-bg` navy right column carrying the four dot mark, the product line and three honest proof lines. Mounts `ConsentProvider` and `ConsentBanner` (shell spec §1.13 puts them here and on marketing only). Sets `metadata.robots = { index: false, follow: false }`. **Every destination the layout carries today stays**, listed so none is lost in the rewrite: the logo lockup links to `MARKETING_HOST` when it is set and to `/` otherwise (today it is a bare `/`, which on the app host reaches nothing once the host split is on); the footer holds the copyright line "© {year} WorkwrK" 13/400 `--os-ink-3` at the left and three 13/400 text links at the right, **Terms** → `/terms`, **Privacy** → `/privacy` and **Help** → `/help-center`, all three absolute on `MARKETING_HOST` when it is set so they resolve from the app host. Under 1024px the copyright and the links wrap to two lines. Nothing is added to the footer and nothing is dropped from it. Uses the design system's light tokens through a scoped `.workwrk-auth` root that defines the layer 2 aliases; the page is **light only**, justified: these routes render before any user preference exists, they sit outside `.workwrk-os`, and marketing is light only, so a dark variant would be the only dark surface a signed out visitor could reach and would need its own QA pass for no user benefit. |
| `AuthCard` | `src/components/auth/auth-card.tsx` | `{ title, subtitle?, banner?, children, footer? }` | login, signup, join, forgot, reset, verify. Owns the 22/600 title, the 14/400 subtitle, the 24px gaps, and the one banner slot so every auth page's success, error and info strips are the same object. |
| `PasswordField` | `src/components/auth/password-field.tsx` | `{ value, onChange, label, autoComplete, policy?, showChecklist?, confirmOf? }` | signup, join, reset, change password dialog. The 36px input, the 28px eye toggle, and, when `policy` is given, the live rule checklist with `aria-live="polite"`. One component means the four places a password is chosen can never disagree about the rules again (B8). |
| `AuthProofPanel` | `src/components/auth/proof-panel.tsx` | `{ variant: "proof" \| "invitation", invitation? }` | `AuthShell`. The proof variant carries only claims that are true of the product today: no testimonial, no logo wall, no "18 locales", no "SSO + audit log" while there is no SSO button (B29). The invitation variant is the `/join` panel. |
| `MfaEnrolDialog`, `MfaDisableDialog`, `BackupCodesDialog` | `src/components/account/` | `{ open, onOpenChange, onDone }` | `/account/security`, `/login` step 2b, `SecurityHoldDialog`. The first two are today's `mfa-modal.tsx`, moved out of the route folder because three surfaces now use them, and restyled onto tokens. |
| `SecurityHoldDialog` | `src/components/account/security-hold-dialog.tsx` | `{ hold: "mfa" \| "password", role, orgName }` | mounted by the shell next to `SessionExpiredDialog`. |
| `DeleteAccountDialog` | `src/components/account/delete-account-dialog.tsx` | `{ open, onOpenChange, isLastOwner, orgName }` | `/account/profile`. |
| `SettingsSection` | `src/components/settings/settings-section.tsx` | `{ title?, description?, mode: "form" \| "autosave", children }` | every `/account/*` page and every Workspace settings page. The 560px card with the 16/600 title, the 24px padding, the `--os-line-soft` row separators, and the autosave "Saved" tick contract. Shared with the settings unit, which owns the file; this unit is its second consumer and does not fork it. |
| `SettingsRow` | `src/components/settings/settings-row.tsx` | `{ label, helper?, locked?, control }` | the autosave rows on Preferences, Notifications, Security, Connections. When `locked` it renders the value as text plus a 16px `Lock` and "Set by your workspace", never a disabled control. |
| `useDirtyGuard` | `src/hooks/use-dirty-guard.ts` | `(isDirty: boolean)` | `/account/profile` (the only Save bar page in this unit) and `/onboard`. Owned by the settings unit (its S0); listed here because this unit's build depends on it. |
| `apiFetch` | `src/lib/api-client.ts` | | every fetch in this unit. Owned by the shell unit; this unit must not hand roll a fetch, because the 401 to Session-expired path lives inside it. |

Two shared things this unit deletes: `src/app/(auth)/auth.css` (imported by nothing since commit `a13daaf8`, the cause of B1) and `src/components/{onboarding-checklist,admin-setup-checklist}.tsx` plus `dashboard/dashboard-content.tsx`'s wizard subtree (rendered by nothing, B7).

---

## 4. Migration and build notes

Ordered so every step ships alone and no URL is dead between steps. Dependencies on the other tracks use their own step numbers: access steps from `access-model-spec.md` §10, settings steps S0 to S7 from `settings-architecture.md` §12, shell steps from `spec-shell.md`.

| Step | Ships | Depends on | Can ship independently |
|---|---|---|---|
| **A0 Redirects, routing tables and deletions** | **(a)** the ten 308s in `next.config.ts` (`/account` → profile, `/account/appearance`, `/register`, `/register?token=`, `/welcome`, `/setup`, `/settings/notifications`, `/settings/calendar`, `/settings?tab=themes`, `/settings?tab=shortcuts`). **(b)** the `src/proxy.ts` edit, without which half of those 308s never run: add `signup` and `join` to `APP_PREFIXES` (`:41-55`) and to `AUTH_PUBLIC_PREFIXES` (`:67-69`), keep `register`, `welcome` and `setup` in `APP_PREFIXES` for the two release window so an old marketing-host URL still reaches the app host, and leave `onboard` out of `AUTH_PUBLIC_PREFIXES` (§0, Routing tables changed). Verify with four cases: marketing-host `/signup` reaches the app host, `/join?token=` opens signed out with `AUTH_EDGE_GATE=true`, `/register?token=` still 308s with its query, and `/onboard` signed out still redirects to `/login?callbackUrl=/onboard`. **(c)** deletions: `pages.newUser: "/welcome"` removed from `authOptions` (`src/lib/auth.ts:267-269`), `src/app/(auth)/auth.css`, the three dead checklist files, and the four `workwrk:os:*` sidebar mirrors including `workwrk:os:icons-only`. **(d)** `/loader-preview` moved behind a dev guard; `noindex` on the `(auth)` layout; `ConsentProvider` moved from `providers.tsx` into the marketing and auth layouts. | nothing | yes, day one |
| **A1 `(auth)` shell and the six auth pages on tokens** | `AuthShell`, `AuthCard`, `PasswordField`, `AuthProofPanel`; `/login` (blue primary, eye toggle, four dot pending loader, conditional Google button, MFA paste fix, query flag reading, callback validation), `/signup` and `/join` split out of `register`, `/forgot-password` copy fix, `/reset-password` manual button and policy checklist, `/verify-email` four states and the correct resend target; `GET /api/auth/password-policy`; the unauthenticated branch on `POST /api/auth/request-verify` plus its `?resend=1` screen; the verification email sent at signup; the invitation GET's richer shape (including `accountExists`, `alreadyInThisOrg`, the object and the object role) and the invitation POST's authenticated branch plus its `landing` value, which together are what make `/join`'s four variants and four failure screens real; `POST /api/invitations/request-resend`; `friendlyError()` covering the NextAuth `?error=` values. | A0. Not blocked on the shell or settings tracks: these routes have no shell. | yes |
| **A2 Email templates** | the dark `#0a0a0a` and lime `#d4ff2e` base template replaced by a white and blue template on the same tokens; welcome, invitation, verification, reset and reminder emails rewritten; the welcome email's "Organization → About" and "Settings → Team" copy replaced by the registry labels; every CTA pointing at a route that exists. | A1 (the new routes must exist before the emails link to them) | yes |
| **A3 One wizard** | `/onboard` rebuilt as the four steps; `/setup` and `/welcome` deleted behind their redirects; `POST /api/setup` and `GET /api/onboarding-progress` retired; `(dashboard)/layout.tsx` stops gating on `setupCompleted`; `seedOrgDefaults(orgId)` called from `POST /api/auth/register`; the `console.setupStep` resume. | A1; settings S0 (the `console` section on `PATCH /api/settings` and `seedOrgDefaults`); access step 1 (wrappers, so `POST /api/invitations` gates on `org.invite_member`) | no: blocked on settings S0 |
| **A4 My settings on existing columns** | `/account/profile` (phone, DOB, danger zone, data download, the label map, `OsEmptyView` over failed GETs), `/account/preferences` (all three tabs on JSON keys, no Accent row, Density defaulting to Comfortable), `/account/notifications` (moved, with quiet hours, mute, muted list, desktop), `/account/security` (score and org policy card removed, backup codes, password age row), `/account/connections`, `/account/shortcuts`, `/account/all`; the door sidebar; `openSettings` / `closeSettings` wired from every entry point; `MfaEnrolDialog` and friends moved and restyled. No migration. | settings S0 (`SettingsShell door=`, the registry, `useDirtyGuard`, `useSettingsSection`, `settings-nav.ts`, the `.strict()` schemas) and the design system's token sweep, which deletes the ten `data-accent` blocks and `src/lib/accents.ts` with them, so the Accent row is never built here; shell step 3 (`apiFetch`, the shortcut registry) | no: blocked on settings S0 and shell 3 |
| **A5 Session surfaces** | `SessionExpiredDialog` integration from the auth side (callback carrying and validation, `workwrk:last-email`, the reason variants); `SecurityHoldDialog`; the switch workspace flow's boot cover and double click guard; `/login` step 2b enrolment. | shell step 3 (`apiFetch` and the dialog); settings S5 (`auth.ts` reading the org policy, `login-throttle.ts` taking a policy argument, `User.passwordChangedAt`) | no: blocked on settings S5 |
| **A6 Presence and the migration** | the Presence card on `/account/security` and the avatar menu writing `User.presenceStatus` / `presenceUntil`; `POST /api/auth/mfa/backup-codes`. | the one additive SQL file in settings S4 (`presenceStatus`, `presenceUntil`, `weeklyCapacityHours`) applied with `prisma db execute` | no |

**Data migrations this unit needs**: none of its own. It consumes three columns from the settings unit's single additive file (`User.presenceStatus`, `User.presenceUntil`) plus `User.passwordChangedAt` and `User.termsAcceptedAt` (two more nullable columns added to the same file; every reader tolerates them being absent). Every new preference key lives inside the existing `UserPreference.home` and `sidebar` JSON columns, so the personal pages ship with zero schema change (settings spec G22).

**Blocked on another unit, named**: the Workspace door's sign-in policy editor (settings S5) is what makes the org's MFA, lockout and password age rules real; until it lands, `/account/security` reads the seeded defaults and the Security hold dialog never fires, which is correct behaviour rather than a stub. The org level "Log out everyone" button is the settings unit's. The product tour's rebuild or retirement is the shell unit's. The default "General" Space that stops a new admin landing on the "No Spaces yet" stub (B12) is `seedOrgDefaults`, written by the settings unit and called by this unit's `register` route.

**Risks**:
1. Splitting `/register` into `/signup` and `/join` breaks any invitation email already in the wild. Mitigation: the `/register?token=` 308 preserves the query and stays for at least two releases; the invitation link builder switches to `/join` in the same change as the email template rewrite (A2).
2. Requiring two step verification at login can lock out an org that turns it on before anyone enrols. Mitigation: step 2b enrols inside the login flow, so nobody is ever refused for not having a thing they can set up right there; the settings unit's S5 additionally verifies the combination against an unenrolled Admin and an enrolled Member before shipping.
3. `POST /api/setup` retirement removes the only writer of `businessType`, `industry` and `teamSize`. Mitigation: the Workspace settings Identity tab already edits all three (settings spec §5.2) and existing values are untouched; the Overview cards that read them keep reading them.
4. Auto login after signup failing leaves a person with an account they cannot reach. Mitigation: the `?signedup=1` path is read by `/login` and the email is prefilled, so the fallback is one field away from done.
5. Adding `signup` and `join` to the proxy sets changes which paths the edge gate lets through. Mitigation: both are `(auth)` pages that hold no data and render for a signed out visitor by design, which is exactly why they belong in `AUTH_PUBLIC_PREFIXES`; the four verification cases in A0 run against `AUTH_EDGE_GATE=true` and `HARD_HOST_SPLIT=true` together, because either flag alone hides the other's failure.
6. `callbackUrl` is attacker controllable. Mitigation: the same origin plus `APP_PREFIXES` validation in A1, tested with an absolute URL, a protocol relative URL and a marketing path.

---

## 5. Checklist against the audit

**`auth-onboarding.md` §2**

| # | Disposition |
|---|---|
| B1 `/welcome` unstyled, orphaned CSS | resolved by §0 (route merged into `/onboard`) and §4 A0 (`auth.css` deleted) |
| B2 `/welcome` POSTs a GET only route | resolved by §0: the route and its two unpersisted questions are gone; job title is a placement field nobody sets for themself |
| B3 `/onboard` skip loop | resolved by `/onboard` §2 and §1 Access correction 2: the dashboard layout stops gating, and one "Finish later" replaces two looping skips |
| B4 `/setup` versus `/onboard` | resolved by §0 (308) and `/onboard` §2 |
| B5 `sidebar.pinned` written by a dead step | resolved by `/onboard` step 4: the app picker is deleted, nothing writes `sidebar.pinned` |
| B6 departments wiped, fake profile values | resolved by `/onboard` step 3 (per change writes, never a replace) and step 4 (no fabricated values) |
| B7 dead checklists and stale tour | resolved for the checklist half by §4 A0 (three files deleted) and by the invited member hint §2; the tour half is deferred to the shell unit, which owns `TourProvider` |
| B8 password hint versus server policy | resolved by `PasswordField` §3 and by `GET /api/auth/password-policy`, used on signup, join, reset and change password |
| B9 MFA cosmetic without an env flag | resolved jointly: `/account/security` and `/login` read the org policy, `/login` step 2b enrols, `SecurityHoldDialog` catches mid session changes; the org editor is settings S5 |
| B10 Settings hub sends admins to a read only page | the personal half is resolved by `/account/security` §2 (the read only org policy card is deleted and one link points Owners at the editor); the Workspace half is the settings unit's §5.9 |
| B11 verification never sent, wrong resend target | resolved by `/signup` (sent in the create transaction), `/verify-email` (correct resend, unauthenticated branch) and the 72 hour reminder cron |
| B12 new org lands on a "No Spaces yet" stub | resolved by `seedOrgDefaults` seeding the "General" Space, called from `register`; the stub copy itself is the spaces unit's |
| B13 dark and lime email templates | resolved by §4 A2 |
| B14 `/setup` invites bypass domain lock and permission | resolved by §1 Access correction 3 and `/onboard` step 2 |
| B15 rail Invite ungated versus Members gate | the accept half is resolved here; the rail button is deleted by the shell spec and the Members gate is the access spec's `org.invite_member` |
| B16 no Google button, `?registered=true` unread | resolved by `/login` §2 |
| B17 `/welcome` had no session gate | resolved by §0 (route gone) and by A0(c), which deletes the `pages.newUser: "/welcome"` line in `src/lib/auth.ts:267-269` that still names it |
| B18 no `/register` CTA on marketing | resolved by `/signup` §2 plus §0 Routing tables changed and A0(b): the route matches the URL 24 marketing CTAs already use **and** `signup` is added to `APP_PREFIXES`, without which the host split would never send the click to the app host |
| B19 four loading conventions, light to navy to white flash | resolved by `/onboard` (boot navy loader), `/login` and friends (four dot pending in buttons), `/account/*` (skeletons) |
| B20 wizard errors swallowed | resolved by `/onboard` §2 error state |
| B21 30 versus 60 minute copy | resolved by `/forgot-password` §2 |
| B22 three wizard dialects, four progress idioms | resolved by §3 (`AuthShell`, `AuthCard`) and `/onboard` (`steps-n` dots only) |
| B23 `/onboard` stale catalog config | resolved by `/onboard` step 4: the department and app catalogs are not used at all any more |
| B24 pending invites cannot be resent | partly resolved here (`POST /api/invitations/request-resend` from the expired join screen); the Members page's Resend and Copy link buttons are the settings unit's §5.5 |
| B25 `/account/security` score, access level row, asymmetric inputs | resolved by `/account/security` §2 and the two MFA dialogs |
| B26 `/reset-password` auto redirect with no manual link | resolved by `/reset-password` §2 |
| B27 `/loader-preview` public in prod | resolved by §0 and §4 A0 |
| B28 auth pages indexable | resolved by `AuthShell` §3 |
| B29 proof pane placeholder copy | resolved by `AuthProofPanel` §3 |

**`settings-pages.md` §2** (only the items in this unit's scope)

| # | Disposition |
|---|---|
| 3 `OsTitleBar` dead trio | resolved: deleted from `/account/security` and from every page in both doors |
| 8 Back / Close / Esc always `/today` | resolved by §1 Back and close (the origin rule, `closeSettings()`) |
| 10 Profile menu dead rows | resolved by §0 (two 308s) and by `/account/notifications` and `/account/shortcuts` existing |
| 13 accent vocabulary drift | resolved by `/account/preferences` §2: the Accent row is deleted outright with the ten `data-accent` blocks in the token sweep, stored hues normalise to `workwrk` on read, and the key leaves the settings registry, so there is no vocabulary left to drift |
| 18 bare `/account` link 404 | resolved by §0 |
| 19 loader mix | resolved: skeletons plus one rotating value line on every `/account/*` page, four dot pending in every button, no `Loader2` and no "Loading…" string left in this unit |
| 20 error states without recovery | resolved: every page in this unit has `OsEmptyView` with a wired Retry, and no form renders over a failed GET |
| 22 h1 size mix | resolved: 22/600 on every page in this unit |
| 23 primary button colour | resolved: `--os-brand` everywhere, black primaries and literal hexes deleted from the profile page and both MFA dialogs |
| 24 four back patterns in one shell | resolved by §1 Back and close: one mechanism, one affordance (the takeover's "← Back to app" ghost, with no ✕ beside it, per design system §4.6) plus Esc, and no in-page breadcrumb, `OsTitleBar` or "Back to settings" chip inside a door |
| 25 label drift nav versus page title | resolved by §1 Naming canon plus the registry, which renders the sidebar row, the page title and the breadcrumb from one string |
| 26 two toast systems | resolved: `useOsToast` only in this unit |

**`critic-gaps.json` `topSystemicIssues`**

| # | Disposition |
|---|---|
| 2 fabricated and inert chrome | resolved for this unit: the security score, the "Access level" green check, the `OsTitleBar` trio, the "we pinned N apps" and "pre-built agents" claims, the placeholder testimonial and the SSO claim without a button are all deleted. No control in this unit renders without a handler, and no "Coming soon" row renders as a control (they render as text, behind "Show upcoming features") |
| 3 duplicate surfaces | resolved for `/setup` versus `/onboard` |
| 4 access fragmentation | resolved for this unit by §1 Access: one gate on the personal door (a session), one rule for org setup (Owner and Admin through the real gated routes), one rule for invitations (`org.invite_member`), one denial convention, no read only variant of a personal page and no disabled control anywhere |
| 5 back navigation | resolved by §1 Back and close |
| 6 five visual systems | resolved for this unit: the `(auth)` slate dialect, the `/setup` shadcn plus pre-OS token dialect, the `/onboard` zinc plus inline hex plus Figtree dialect and the `.acs` BEM dialect all collapse onto the design system, and `auth.css` goes |
| 7 settings that do nothing | resolved for every personal key: language, time zone, week start, date and time format, reduced motion, sidebar width, collapsed, quick tools, presence, mute, desktop notifications and the Inbox view keys each get a store, a writer and a named reader; anything without a reader is not rendered |
| 8 core flows broken end to end | resolved for this unit's four: `/signup` exists at the URL the site links to **and is reachable**, because A0(b) adds `signup` and `join` to both `proxy.ts` sets (a 308 alone would have left the marketing CTA on a chrome-less 404 and `/join` bounced to `/login`); `/welcome` is gone, config line included; the onboard loop is gone; the department wipe is gone |
| 9 naming drift | resolved by §1 Naming canon |
| 11 swallowed errors, no session expiry | resolved by A5 and by every route block's error state; `apiFetch` is mandatory in this unit |
| 13 time, locale and money per surface | the per user half is resolved by `/account/preferences`'s Language & region tab, which creates the time zone, week start and date format keys the rest of the product will read; making each surface read them is each surface's own spec |
| 15 copy and comment hygiene | resolved for this unit: no em dashes or double hyphens in any string, no "Coming soon" rendered as a control, no developer instruction in a user string, and the stale header comments in the deleted files go with them |
| 10 desktop only, zero breakpoints | resolved for this unit by §1 Mobile and narrow, which gives the six auth pages, the wizard and both door surfaces their breakpoints, including the 900px collapse of the 264px door sidebar into a "Pages" select (the `settings-shell.tsx:185` the critic cites) and full screen dialog sheets under 640px. Every other surface the issue names is its own unit's |
| 14 dead code and stale registries | resolved for the two lines of evidence that are this unit's, B7 and B13: A0(c) deletes `auth.css`, the two checklist components, the `dashboard-content.tsx` wizard subtree, the `pages.newUser` config line and the four `workwrk:os:*` sidebar mirrors, and A2 replaces the stale welcome email copy that names "Organization → About" and "Settings → Team". The rest of the inventory (components/tasks, components/today, catalog stubs, marketing components) belongs to the shell, work and marketing units |
| `missedSurfaces` session expiry | resolved by A5 and the Session expired block |
| `missedSurfaces` consent banner in the app | resolved by A0: `ConsentProvider` and `ConsentBanner` move out of `providers.tsx` into the marketing and `(auth)` layouts, so no banner ever renders over the app, the wizard or the takeover |
| `missedSurfaces` keyboard shortcut page | resolved by `/account/shortcuts` and the one `src/lib/shortcuts.ts` registry |

**Decisions that must hold, re-checked against this unit**: the Settings hub stays on the rail for everyone and opens My settings for anyone who is not Owner or Admin (settings spec §2.3, open decision 1); the rail is access derived and this unit adds no pin API; there is no read tier and no disabled control in either door; task assignment still grants item access and nothing here touches it; Talk and Tables stay `ProductInstallation` gated and the wizard's step 4 is the only place this unit writes them; `SUPER_ADMIN` never appears in a tenant UI, including the wizard's role picker and the join page's role label.

---

## Open questions for the founder

1. **Is the mission line required before Continue on step 1 of the wizard?** The spec assumes optional, so a founder who has not written one yet is not blocked, and the mission splash simply does not render until there is one. Making it required would guarantee every org has a splash from day one.
2. **Should `/signup` be reachable at all on the marketing host, or only on `app.workwrk.com`?** The spec keeps it on the app host and lets the hard host split redirect a marketing-host click. That split does not cover `/signup` today, because `signup` is in neither `proxy.ts` list; A0(b) adds it, which is the one line that fixes the 24 marketing CTAs. The founder's answer changes nothing else: if he wants the form served on the marketing host too, that is a marketing unit page and a second `POST` target, and this spec's routes stay as they are.
