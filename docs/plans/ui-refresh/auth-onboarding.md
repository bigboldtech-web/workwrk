# UI audit: Auth + Onboarding subsystem

Audited 2026-09-10 against `main` @ 6187227a (read-only). Covers what a brand-new business sees from signup to a working workspace, plus the personal security surface (MFA) and invite acceptance.

Files in scope (all paths relative to `/Users/bigboldtechnologies/theywrk/`):

| Area | Files |
|---|---|
| Auth shell | `src/app/(auth)/layout.tsx`, `src/app/(auth)/auth.css` (orphaned, see B1) |
| Auth pages | `src/app/(auth)/{login,register,forgot-password,reset-password,verify-email,welcome}/page.tsx` |
| Wizards | `src/app/setup/{layout,page}.tsx`, `src/app/onboard/{layout,page}.tsx` |
| First-run gate | `src/app/(dashboard)/layout.tsx`, `src/app/(dashboard)/dashboard/page.tsx` (redirect), `src/app/(dashboard)/dashboard/dashboard-content.tsx` (DEAD), `src/app/(dashboard)/today/page.tsx`, `src/app/(dashboard)/spaces/page.tsx`, `src/components/tour-provider.tsx`, `src/components/product-tour.tsx`, `src/lib/tour-content.tsx`, `src/components/onboarding-checklist.tsx` (DEAD), `src/components/admin-setup-checklist.tsx` (DEAD), `src/components/brand/mission-splash.tsx`, `src/components/brand/dots-loader.tsx` |
| MFA / security | `src/app/(dashboard)/account/security/{page,mfa-modal,change-password-modal}.tsx`, `src/app/(dashboard)/account/layout.tsx`, `src/app/api/auth/mfa/{enroll,status}/route.ts` |
| Invites | `src/components/layout/os/invite-modal.tsx`, `src/components/layout/os/click-app-rail.tsx` (Invite button), `src/app/(dashboard)/settings/members/page.tsx` (pending invites), `src/app/api/invitations/route.ts`, `src/app/api/auth/accept-invite/route.ts`, `src/lib/email-templates/{base,invitation,welcome}.ts` |
| APIs | `src/app/api/auth/{register,forgot-password,reset-password,verify-email,request-verify}/route.ts`, `src/app/api/setup/route.ts`, `src/app/api/onboarding-progress/route.ts`, `src/app/api/preferences/route.ts` |
| Auth core | `src/lib/auth.ts`, `src/proxy.ts`, `src/lib/password-policy.ts` |

Global facts that shape everything below:

- Tailwind v4 (`package.json:126`, `globals.css:1` is `@import "tailwindcss"`). Preflight zeroes `h1` size/weight, button backgrounds and element borders, so any page relying on un-imported CSS classes degrades to unstyled text.
- Root `ThemeProvider defaultTheme="dark"` (`src/components/layout/providers.tsx:33-35`). This is why `/setup` and `/onboard` force `colorScheme: light` inline and why the onboard layout comment says os.css tokens rendered the wizard dark.
- Post-login destination chain: `/dashboard` (login default `callbackUrl`, `login/page.tsx:28`) is a server redirect to `/today` (`dashboard/page.tsx:1-5`), which server-redirects to the first readable Space or `/spaces` (`today/page.tsx:39-40`). Nothing ever renders at `/dashboard`.
- The `(dashboard)` layout gates every app page on `GET /api/setup`; `setupCompleted === false` forces `router.push("/onboard")` (`(dashboard)/layout.tsx:36-49`).
- Env flags that change behaviour and are unset/undocumented locally (`.env`, `.env.local`, `.env.example` all have zero occurrences): `ENFORCE_MFA_AT_LOGIN` (`lib/auth.ts:125`), `AUTH_EDGE_GATE` (`proxy.ts:189-201`). `GOOGLE_CLIENT_ID` is present but empty.

---

## 1. Route inventory

### 1.1 `(auth)` layout shell (wraps 1.2 to 1.7)

- File: `src/app/(auth)/layout.tsx`
- Shape: `grid lg:grid-cols-2`. Left pane = brand link (`href="/"`, black `W` tile + "workwrk" wordmark) + centered `max-w-md` form slot + footer (`© year WorkwrK`, links `/terms`, `/privacy`, `/help-center`, all exist under `(marketing)`). Right "proof" pane `hidden lg:flex`: pill "Built like Lego. Runs your whole business.", headline "Compose your work OS, one primitive at a time.", four primitive tiles (Forms, Tables, Docs, Agents), trust line ("SSO + audit log", "Setup in minutes", "18 locales"), testimonial card ("Mohsin S., COO, 280-person services firm").
- Top bar: none (no app chrome). Secondary sidebar: none.
- Back: the only "back" is the logo → `/` (marketing root; on the app host `/` redirects to `/today` per `proxy.ts:176-180`).
- Auth gating: none. A signed-in user can open `/login` and see the form; `/welcome` (an app-ish page) is reachable signed-out.
- Styling: Tailwind `slate-*` palette, literal `#0073EA` links, `bg-slate-900` primary buttons (black, not brand blue), `rounded-lg`, `h-11` inputs, `focus:ring-[#0073EA]/20`. No `--os-*` tokens (page sits outside `.workwrk-os`, by design). Does not use `ui/button` or `ui/input`.
- Mobile: single column, proof pane hidden below `lg`, `px-6 sm:px-10`.
- Copy risk: the proof pane sells "Forms / Tables / Docs / Agents" and "SSO + audit log"; Tables is a premium module OFF for new orgs, Google SSO has no login button (see B16), and the testimonial reads as placeholder.
- No `metadata`/`robots noindex`; root metadata is `index: true` so auth pages are indexable (low).

### 1.2 `/login`

- File: `src/app/(auth)/login/page.tsx`. Title: "Welcome back" (MFA step: "Two-step verification").
- Purpose: credentials sign-in, with an in-place second step for TOTP/backup code when the server answers `MFA_REQUIRED`.
- Reached from: marketing topbar "Log in" (`marketing-topbar.tsx:74,320` via `appHref`), every auth page's "Sign in" link, `(dashboard)`/`onboard`/`setup` layouts' unauthenticated redirect, `signOut({callbackUrl:"/login"})` (profile menu, security page), edge gate with `?callbackUrl=` when `AUTH_EDGE_GATE=true`.
- Back button: none (logo → `/`). Cross-links: "Forgot password?" → `/forgot-password`; "New to WorkwrK? Start your free trial" → `/register`; MFA step "Use a different account" resets local state.
- Controls: Work email (`type=email`, `autoComplete=email`), Password (`autoComplete=current-password`), submit "Sign in →". MFA step: "Signing in as {email}" line, Authentication code input (`inputMode=numeric`, `autoComplete=one-time-code`, `maxLength=9`, letter-spaced), hint "Lost your device? Enter one of your backup codes instead.", submit "Verify".
- States: loading (Loader2 spinner in button, "Signing in…"/"Verifying…"), error banner (rose-50) with curated mapping in `friendlyError()` (`login/page.tsx:16-23`): lockout countdown, account/workspace status, bad MFA code, missing creds; everything else collapses to "Invalid email or password."
- Server behaviour worth knowing for the redesign (`lib/auth.ts:87-209`): per IP+email lockout (`login-throttle`), timing-equalised unknown-email path, MFA only when `ENFORCE_MFA_AT_LOGIN=true` AND user enrolled, INACTIVE/deleted users blocked after password check, CANCELLED/SUSPENDED org falls back to another membership or blocks with a message, successful login logged to security activity.
- Post-login: `router.push(callbackUrl)` with default `/dashboard` (→ `/today` → first Space).
- UI state: polished.
- Issues:
  - `?registered=true` (pushed by `/register` fallback, `register/page.tsx:80`) is never read; no "account created, sign in" confirmation.
  - No Google/SSO button even though a Google provider is registered when env vars exist (`lib/auth.ts:213-222`); proof pane advertises SSO.
  - No show/hide password toggle, no "remember me" (session is a fixed 12h idle JWT, `lib/auth.ts:263-264`).
  - The MFA code field accepts spaces (placeholder "123 456") but the server trims only outer whitespace (`lib/auth.ts:129`); "123 456" fails TOTP. Low.
  - Primary button is black (`bg-slate-900`) while the app's primary is brand blue `#0073EA`.

### 1.3 `/register` (self-serve) and `/register?token=` (invite acceptance)

- File: `src/app/(auth)/register/page.tsx`. Titles: "Start your free trial" / "Join {organizationName}".
- Purpose: one form, two flows. Self-serve creates org + COMPANY_ADMIN (`POST /api/auth/register`); with `token` it accepts an invitation (`GET`/`POST /api/auth/accept-invite`).
- Reached from: `/login` "Start your free trial" link; invitation email button (`invitation.ts:33`, link built in `api/invitations/route.ts:130` and `api/setup/route.ts:239`). NOT linked from the marketing site: `marketing-topbar.tsx` offers only "Log in" and "Get a demo"; `grep register src/components/landing` returns nothing.
- Back button: none. "Already have an account? Sign in" → `/login`.
- Controls: Company name (self-serve only, placeholder "ScaleOps"), First name, Last name (2-col grid), Work email (self-serve only), Password (placeholder "Min. 8 characters", `minLength=8`), submit "Create account →" / "Join team →". Invite flow shows a blue banner "Joining as {email}" and subtitle "Invited as {access level}. One form and you're in." Submit disabled until invitation loads.
- Post-submit: auto `signIn("credentials")`; on ok → `/setup` (self-serve) or `/welcome` (invited); on signIn failure → `/login?registered=true`.
- States: loading, error banner (server error string), invitation loading subtitle "Loading your invitation…"; invalid/expired/used token shows the API error in the banner but the form stays rendered and disabled (no dedicated "invite invalid, ask your admin" screen).
- Server (`api/auth/register/route.ts`): IP rate limit 10/h, name sanitising, default password policy (min 8 + uppercase + number, `lib/password-policy.ts:14-18`), org slug dedupe, one account per email globally, creates 6 default departments (Engineering, Sales, Marketing, Operations, HR, Finance), org `status: TRIAL`, sends welcome email. `accept-invite` (`route.ts:43-214`) enforces the inviting org's policy, materialises role KRAs/SOPs, drops into a Space if the invite carried one, marks invitation accepted.
- UI state: polished visually; rough functionally.
- Issues:
  - Password hint says "Min. 8 characters" but the server rejects anything without an uppercase letter and a number → users hit "Password must include an uppercase letter." only after submit. No strength meter, no inline rule list.
  - No Terms/Privacy consent checkbox or line at signup (footer links only).
  - "No credit card. Full access for 14 days." is copy only; org is `TRIAL` with no trial-end field written here.
  - Invite flow: first/last name are free-form even when the invite came with a role; the accept page never shows the inviter's personal message, department, role or manager that the invite carried.
  - Self-serve flow lands in `/setup`, a 6-step wizard with no skip; see 1.8.

### 1.4 `/forgot-password`

- File: `src/app/(auth)/forgot-password/page.tsx`. Title: "Reset your password" → "Check your inbox".
- Reached from: `/login` "Forgot password?"; `/verify-email` error state "Request one"; `/reset-password` no-token state "Request new link".
- Back: "Remember it? Back to sign in" → `/login`.
- Controls: Work email, submit "Send reset link →". Success replaces the form with an emerald banner "Sent to {email}. Check your inbox — and spam, just in case."
- Server (`api/auth/forgot-password/route.ts`): always 200 (anti-enumeration), per-email 5/15min and per-IP 20/h limits, token hashed at rest, expiry 60 min.
- UI state: polished.
- Issues: copy says the link "is good for 30 minutes" / "expires in 30 minutes" (`page.tsx:43-44`) but the token lives 60 minutes (`route.ts:55`). The success banner asserts "Sent to {email}" even though the server intentionally does not confirm existence (fine for UX, but inconsistent with the subtitle's "If an account exists").

### 1.5 `/reset-password?token=`

- File: `src/app/(auth)/reset-password/page.tsx`. Titles: "Set a new password" / "Password reset" / "Reset link invalid".
- Reached from: reset email only (URL-only).
- Back: none; "Back to sign in" link on the no-token screen only.
- Controls: New password (placeholder "Min. 8 characters"), Confirm password ("Same thing again"), submit "Reset password →". Client checks match + length ≥ 8; server enforces org policy (`api/auth/reset-password/route.ts:39-43`), bumps `tokenVersion` (kills other sessions).
- Success: emerald banner "Done. Taking you to sign in…" and `setTimeout(2400)` → `/login`. No manual link if the timer fails.
- UI state: polished.
- Issues: subtitle "Eight characters or more. Mix letters, numbers, and a symbol for safety." — a symbol is not required, an uppercase letter is. Same server/client policy mismatch as `/register`. Missing/expired token beyond the `!token` case is only surfaced as the API's banner text inside the form.

### 1.6 `/verify-email?token=`

- File: `src/app/(auth)/verify-email/page.tsx`. Titles: "Verifying…" / "Email verified" / "Already verified" / "Link expired or invalid".
- Reached from: verification email only. That email is sent ONLY by `POST /api/auth/request-verify`, whose only caller is the "Resend" button on Account → Security (`account/security/page.tsx:93-104`). Registration never sends one.
- Back: none. CTAs: "Open dashboard" → `/dashboard`, "Log in" → `/login`, error state "Back to sign in" and "Need a new link? Request one" → `/forgot-password` (wrong target: that page sends a password reset, not a verification email).
- States: four, well handled (loading with Loader2, ok, already, error with amber banner). The error message is rendered twice (subtitle and banner, `page.tsx:109,112`).
- UI state: polished but effectively orphaned.
- Issues: never entered by a normal flow; "Request one" links to password reset; the verification email itself is the legacy dark/lime template (`request-verify/route.ts:57-73`).

### 1.7 `/welcome` (invited-user onboarding)

- File: `src/app/(auth)/welcome/page.tsx`. Steps: 0 "Welcome in, {firstName}." · 1 "What's your shape?" · 2 "One last detail."
- Purpose: 3-step personalisation for invited users (focus: IC / manager / founder; job title).
- Reached from: `/register?token=` after successful join (`register/page.tsx:79`). `lib/auth.ts:269` sets NextAuth `pages.newUser: "/welcome"`, but with JWT + Credentials and no adapter NextAuth never uses it. No other links.
- Back: in-wizard "Back" buttons (`setStep`), "Skip" link → `/dashboard` on step 0. No BackButton.
- Controls: step 0 six static module tiles (People, KRAs, SOPs, Reviews, Kudos, AI Engine), "Let's go"; step 1 three radio-cards with module chips; step 2 "Your title" text input + read-only Focus summary; "Take me in".
- Auth gating: none (layout has no session check; `useSession` only used for the first name → "Welcome in, friend." when signed out).
- UI state: BROKEN.
- Issues:
  - Depends on `.auth-card .auth-brand .auth-brand-dot .auth-title .hi .auth-sub .auth-form .auth-field .auth-label .auth-input .auth-submit .ob-next .auth-spinner .ob-card`. Those live only in `src/app/(auth)/auth.css`, which is imported by nothing (`grep -rn "auth.css" src` is empty; import dropped in commit a13daaf8 when the layout moved to Tailwind). Under Tailwind v4 preflight the `h1` renders at body size/weight, the title input has no border, and the "Take me in"/"Let's go"/"Next" buttons have a transparent background with white text (invisible on the white shell). The page also renders its own brand link under the layout's logo (double logo).
  - Finishing POSTs `/api/onboarding-progress` (`page.tsx:64-68`); that route exports only `GET` (`onboarding-progress/route.ts:4`) → 405, swallowed. Focus and title are never persisted anywhere. The whole wizard is cosmetic.
  - Copy ("people, KRAs, KPIs, SOPs, reviews, and an AI that reads all of it", "AI Engine", "Analytics") is pre-PPMS positioning; the module chips do not map to rail apps.
  - Progress label reads "Getting started · step N of 3" while `/onboard` and `/setup` use different progress idioms (dots vs bar).

### 1.8 `/setup` (self-serve org setup wizard, 6 steps + Ready)

- Files: `src/app/setup/layout.tsx`, `src/app/setup/page.tsx`. Header: black-dot logo "workwrk" (→ `/dashboard`) + caption "Setup your workspace". Page title "Set up your workspace" with "Step N of 6".
- Purpose: business profile → industry & use case → module priorities → team size → departments → invite team → "You're all set!". POSTs the whole object to `/api/setup` which stamps `settings.setupCompleted=true`, normalises module keys, provisions `ProductInstallation` rows, syncs departments, sends invitation emails.
- Reached from: `/register` (self-serve) only; `GET /api/onboarding-progress` step href (dead checklist). On load it `GET /api/setup`s and bounces to `/dashboard` if already completed, so it is one-shot.
- Gating: layout redirects unauthenticated → `/login`, `DotsLoaderScreen label="Loading workspace"` while loading. No role check: any signed-in user (including an invited EMPLOYEE) can run it and rewrite org settings.
- Back: "Back" button (`ChevronLeft`, disabled on step 0), clickable completed step chips (`page.tsx:292-311`). No exit except the logo, which goes to `/dashboard` → `/today` → the dashboard gate sees `setupCompleted=false` → `/onboard` (a different wizard).
- Controls per step:
  - 0 Business type: 4 cards (Startup / Small Business / Mid-Market / Enterprise), required.
  - 1 Industry (13 pill buttons, required) + Use case (5 cards: Performance, Operations & SOPs, People, Task Execution, Everything; required).
  - 2 Modules: 9 toggle cards (People & Org "Required", Goals & KPIs, Task Management, SOPs & Compliance, Performance Reviews, Meetings & Check-ins, Reports & Analytics, Check-ins, AI Assistant), all pre-selected. Ids kept in sync with Settings → Modules per the comment (`page.tsx:75-81`); note "Meetings & Check-ins" and "Check-ins" overlap.
  - 3 Team size: 5 cards.
  - 4 Departments: 6 default toggles (all on) + custom department text input with Add/remove chips. Unchecking a default deletes it server-side if it has no members (`api/setup/route.ts:161-173`).
  - 5 Invite team: rows of email + role `<select>` (Employee, Team Lead, Manager, HR, Director, VP, C-Level, Admin), "Add another", remove row (when >1), footer note "Invitations will be sent via email…", extra "Skip for now" ghost button which still calls `handleComplete` (i.e. it saves, not skips).
  - Ready: sparkle badge, "You're all set!", chips for first 5 modules, "Go to Dashboard" → `/dashboard`.
- Loading/error: save shows a CSS spinner "Setting up..." in the button; failure is `console.error` only (`page.tsx:234-236`), the button simply re-enables with no message.
- Styling: shadcn `Button`, `Input`, `Label`, `Card`, `Badge` plus legacy global token classes `text-muted`, `bg-surface`, `bg-surface-2`, `border-border`, `text-foreground`, `hover:border-muted-2` (the pre-OS theme vocabulary), brand `#0073EA` for selection. Different dialect from `/onboard` (explicit zinc + inline hex) and from `(auth)` (slate).
- Mobile: grids collapse (`sm:grid-cols-2`, `lg:grid-cols-3/5`), step-chip labels hidden below `sm`, header `max-w-5xl px-6`.
- UI state: rough.
- Issues:
  - Duplicate of `/onboard` (see B4); different data captured, same completion flag.
  - No persistence between steps; a refresh loses 6 steps of input.
  - Invites here bypass the company-domain lock and `people.create` permission check that `POST /api/invitations` enforces (`api/setup/route.ts:211-236` vs `api/invitations/route.ts:42-73`), and cannot carry department/role/manager/message the way the InviteModal can.
  - Role list is hardcoded (8 options) while the InviteModal uses `ACCESS_LEVELS` minus SUPER_ADMIN (9 incl. AGENT).
  - "Skip for now" on the invite step is mislabelled (it completes setup).
  - "Reports & Analytics", "Meetings", "AI Assistant" module cards reference surfaces removed or renamed since the PPMS pivot (Dashboards removed 2026-08-28).
  - `/setup` header caption "Setup your workspace" (should be "Set up").

### 1.9 `/onboard` (dashboard-gate onboarding wizard, 4 steps)

- Files: `src/app/onboard/layout.tsx`, `src/app/onboard/page.tsx`. Header: `LogoLockup` (→ `/today`) + "Skip for now" (→ `/today`). Steps: Welcome · "What brings you to WorkwrK?" · "Pick your apps" · "Your workspace is ready."
- Purpose: pick a department/use case, pre-select apps, `POST /api/setup` with hardcoded profile values, `PATCH /api/preferences {sidebar:{pinned}}`.
- Reached from: `(dashboard)/layout.tsx:42` whenever `setupCompleted` is false. Not linked anywhere else. Self-bounces to `/today` if already completed.
- Gating: layout redirects unauthenticated → `/login`; `DotsLoaderScreen label="Loading"` while loading; no role check.
- Back: in-wizard "Back" buttons. "Skip for now" and the logo both go to `/today`, which the dashboard layout immediately redirects back to `/onboard` (B3): there is no way to skip.
- Controls:
  - Step 0: pill "Welcome to WorkwrK", hero "Your modular Work OS.", "Get started".
  - Step 1: 10 department cards (People & HR, Sales & Customers, Operations, Finance, IT, Marketing, Engineering, Legal, Customer Support, The whole company), required.
  - Step 2: banner "Pre-selected for {dept}… N selected"; app cards grouped by catalog category (`CATALOG_APPS` minus settings/trash/store, filtered by `canAccessApp`), badges "Core"/"Recommended", always-pinned keys not toggleable; "Set up my workspace".
  - Step 3: "All set" badge, "We've pinned N apps to your rail and pre-configured them for {dept}. Sidekick is online…", "What's set up" list (N apps pinned, Core workspace, Sidekick AI online, "Pre-built agents for {dept}"), "Go to my workspace" → `/today`.
- Loading/error: `Loader2` "Setting up…" in the button; failure `console.error` only.
- Styling: explicit Tailwind zinc + inline hex (`#0073EA`, category gradients), Figtree font inline, `#FBFBFC` ground, rounded-2xl cards with hard-coded box-shadow. Progress = dots (active wide blue, done green).
- Mobile: 1/2/3-col grids, `max-w-5xl px-6`.
- UI state: rough (visually the most finished of the three wizards; functionally misleading).
- Issues:
  - Step 2 writes `sidebar.pinned`, which `lib/preferences.ts:221` marks "legacy (personal pinning is removed)"; no rail/shell code reads it. The step and the "pinned N apps" claim are cosmetic. Rail contents are access-derived (Settings → Admin → Apps) per the 2026-08-22 decision.
  - Silently writes fake profile data: `businessType:"smb", industry:"Other", teamSize:"1-10", enabledModules:["people","tasks","sops","meetings"]` (`page.tsx:125-128`), which then shows up in Settings.
  - Posts `departments: []`, which makes `api/setup/route.ts:149-173` delete all six default departments created at register (the new admin belongs to none). The org silently ends up with zero departments, and the wizard never mentioned departments.
  - `DEPARTMENTS` copy sells verticals removed from PPMS scope ("Pipelines, deals, renewals, contracts", "Dashboards, budget tracking", ITSM) and `DEPARTMENT_RECOMMENDED_PRODUCTS` maps to product slugs like `workwrk-crm`, `workwrk-books`, `workwrk-itsm` (`lib/products/catalog.ts:249-262`).
  - `CATEGORY_GRADIENT` / `CATEGORY_ORDER` list Sales, Marketing, Service, Finance, Dev categories that no longer exist in the catalog (current categories: Core 12, People 7, Knowledge 3, Build & Extend 3, Workspace 2); `TAGLINES` includes "dashboards" (removed).
  - "Pre-built agents for {dept}" and "Sidekick is online" are unverified claims (nothing in `handleComplete` creates agents).
  - Two "Skip" affordances (header) that loop; `aria-label` on progress but no visible step count.

### 1.10 First-run experience after the wizards

- `/setup` "Go to Dashboard" and login default → `/dashboard` → `/today`; `/onboard` → `/today`. `/today` server-redirects to the earliest readable Space or, for a brand-new org that has no Space (nothing at register/setup/onboard creates one; `grep ensureDefaultSpace|createDefaultSpace` empty), to `/spaces`.
- `/spaces` for zero spaces renders a bordered box "No Spaces yet — Spaces hold Folders and Boards for a team. Create one from the sidebar's "+" button next to Spaces." (`spaces/page.tsx:36-42`, self-described "Phase 2 stub"). So a business that just finished two wizards lands on a stub telling it to go find a "+" in the sidebar.
- Boot chrome: `(dashboard)/layout.tsx:75-103` shows a dark radial backdrop (`BOOT_BG` navy) with `DotsLoader` after 650 ms, and `MissionSplash` overlays mission/values for ~1.6 s (only once an org has a mission/value; brand-new orgs never see it). The wizard → app transition therefore goes light `#FBFBFC` → dark navy → white app.
- `TourProvider` (`tour-provider.tsx:36-50`) auto-opens `ProductTour` 800 ms after the first authenticated render, per user via `localStorage`. Admin tour = 9 steps, employee tour = 9 steps (`lib/tour-content.tsx`). Content is stale: admin step 1 sends to `/organization` (now the manager-gated org chart, `organization/page.tsx:10-12`) to "add your mission, vision, values… AI Assist" (that lives at `/settings/identity`); steps 2/3 send to `/settings` for "Settings → Team" and "Access Control" (now `/settings/members`, `/settings/permissions`); employee step 2 sends to `/dashboard` (redirect); the closing step says "click the Help icon at any time to re-launch this tour" but `click-topbar.tsx` has no help/tour control. The only `startTour` caller is `admin-setup-checklist.tsx:198`, which is rendered only by `dashboard/dashboard-content.tsx`, which nothing imports (`dashboard/page.tsx` is a bare redirect). Same for `onboarding-checklist.tsx` (dark `#141414` legacy styling, `var(--b-accent-text)`), and `GET /api/onboarding-progress` (8-step checklist API) has no live consumer.
- The tour fires on top of the "No Spaces yet" stub for a new admin, and on top of the first Space for an invited employee, potentially under the MissionSplash.
- Welcome email (`email-templates/welcome.ts`) tells new users to go to "Organization → About" and "Settings → Team" (stale) and its CTA is "Go to Dashboard" → `/login`. All emails use the dark `#0a0a0a` / lime `#d4ff2e` template (`base.ts`), unrelated to the current white/blue brand; the verify email hard-codes the same palette inline.

### 1.11 `/account/security` (personal security + MFA)

- Files: `src/app/(dashboard)/account/security/page.tsx`, `mfa-modal.tsx`, `change-password-modal.tsx`; `account/layout.tsx` wraps in `SettingsShell`.
- Title bar: `OsTitleBar title="Account · Security"` (ShieldCheck, green-teal gradient) with description "{email} · MFA on/off · email verified/unverified" and an action link "# Settings" → `/settings`.
- Reached from: Settings takeover left nav "Personal → Security" (`settings-shell.tsx:119-120`); Settings hub cards "Password policy" and "Session & 2FA" (`settings/page.tsx:210,221`, both point here); rail Settings sidebar `NavItem "Account · Security"` (`apps-catalog.tsx:1145`). Profile avatar menu (`profile-menu.tsx:201-205`) offers My Profile / Settings / Themes / Shortcuts, no direct Security link.
- Back: no `BackButton`; the SettingsShell close (X, `aria-label="Close settings"`) and Esc both `router.push("/today")` (`settings-shell.tsx:138,173`), never history back.
- Secondary sidebar: SettingsShell nav (Workspace groups for admins + Personal: Profile, Notifications, Appearance, Security).
- Controls:
  - Security score card (50 base, +25 verified email, +25 MFA; labels Weak/Fair/Good/Strong; colour via `--os-c-*`).
  - "Your posture" rows: Email verified (action "Resend" → `POST /api/auth/request-verify`, toast), Two-factor auth (TOTP) ("Enable" → `MfaEnrollDialog`, "Turn off" → `MfaDisableDialog`), Password ("Change" → `ChangePasswordDialog`, `POST /api/me/change-password`, bumps tokenVersion and re-syncs this session), Access level (read-only row rendered as a passed check with no action).
  - "Org policy" rows (read-only): Minimum password length, Requires uppercase, Requires numbers, Session timeout ("30 minutes" default), MFA required org-wide ("Optional"/"Yes").
  - Sessions: "Sign out of all devices" → `POST /api/me/sign-out-everywhere` then `signOut` → `/login`.
  - Recent security activity list from `/api/me/security-activity` (login, logout, password_changed, mfa_enabled, mfa_disabled, signed_out_all_devices; icon + IP + relative time). States: "Loading…", "No recent activity yet."
- MFA enrol dialog (`mfa-modal.tsx`): phases loading → scan (QR `<img>`, manual key, 6-digit input, "Verify & enable") → backup (8 one-time codes in a 2-col grid, "Copy codes", "Done") → error (Retry/Close). Disable dialog: single code input (TOTP or backup), destructive red "Turn off 2FA". Both are Radix `Dialog` portals styled with literal `#0073EA` / `#E2445C` + Tailwind + `dark:` variants (documented reason: outside `.workwrk-os`).
- Styling: page uses `os.css` `.acs__*` classes with `--os-*` tokens (consistent with the OS); dialogs use literal hex. `.acs` has no `@media` rules (`os.css:13090-13260`); flex rows rely on wrapping.
- UI state: polished.
- Issues:
  - Enabling MFA does not protect sign-in unless `ENFORCE_MFA_AT_LOGIN=true` (`lib/auth.ts:125`); flag absent in every env file and undocumented in `.env.example`. The score still rewards it.
  - "MFA required org-wide" and "Session timeout" are displayed but not enforced anywhere (no reader of `twoFactorEnabled` outside display code; session is a hard 12h idle JWT).
  - Org policy has no editor: Settings hub cards for the org's password policy and 2FA link to this personal read-only page; no page writes `settings.security` even though `api/settings/route.ts:223-229` accepts it.
  - Email verification is only discoverable here ("Resend"), so every account starts unverified with a "Fair" score.
  - Access level row uses the check-row pattern (green tick) for information.
  - Disable dialog input accepts any text (no format hint), enrol dialog strips non-digits; asymmetric.

### 1.12 Invite flows (org-level)

- Entry points:
  - Rail bottom "Invite" button (`click-app-rail.tsx:180-192`) visible to EVERY user regardless of permission; opens `InviteModal`.
  - Settings → Members header "Invite" (`settings/members/page.tsx:151-160`), gated to COMPANY_ADMIN/SUPER_ADMIN (`canEdit`, line 61).
  - `/setup` step 5 (simplified rows, see 1.8).
  - Space share dialog (`share-space-dialog.tsx`, out of scope) uses the separate `/api/spaces/[id]/invitations` API which does have resend.
- `InviteModal` (`invite-modal.tsx`): multi-email chip input (comma/space/Enter/paste, invalid tokens and off-domain addresses kept in the draft with red text), Access level `<select>` (ACCESS_LEVELS minus SUPER_ADMIN, label + description), optional Department / Role / Reporting manager selects (loaded from `/api/departments`, `/api/roles`, `/api/users?scope=all&limit=200`), optional Personal message (1000 chars), "Send invite"/"Send N invites". One `POST /api/invitations` per email; failures stay as chips with a toast "{sent} sent · {failed} failed — {reason}". Styled with `var(--os-brand)` borders + zinc.
- Server (`api/invitations/route.ts`): requires `people.create` permission; company-domain lock (`org.domain ?? inviter's domain`); pending-dupe + existing-member checks; 7-day expiry; email via dark template; webhook + audit log. `DELETE` revokes.
- Pending invites table (Members page): Email, Access level, Invited (relative), Status (Pending / Expired pill), Revoke (admins). No Resend, no copy-link, no edit.
- Issues:
  - Rail Invite is shown to users who will get 403 on send (toast "Insufficient permissions"); Members gates on access level while the API gates on the permission matrix (two different rules).
  - Domain lock: client mirrors the signed-in user's domain, server uses `org.domain` first. An admin who signed up with a personal-domain email can only invite that domain; there is no UI to set `org.domain`.
  - No resend for expired invites; the invitee's only recovery is the API error "ask your admin to resend it".
  - Invitation email and accept page never show department/role/manager/message context except the message in the email.

### 1.13 Adjacent orphan: `/loader-preview`

- `src/app/loader-preview/page.tsx`, a "dev-only preview" of `DotsLoader`, is a public, unauthenticated route in the production bundle (not in `APP_PREFIXES`, so no edge gate either). Low.

---

## 2. Broken / confusing (ranked)

| # | Sev | Where | What |
|---|---|---|---|
| B1 | high | `/welcome` (`(auth)/welcome/page.tsx`, `(auth)/auth.css`) | All `.auth-*`/`.ob-*` classes are undefined: `auth.css` is imported nowhere (dropped in a13daaf8). Under Tailwind v4 the heading collapses to body text, the title input has no border and the primary buttons are transparent (white text on white). Duplicate logo under the layout's. |
| B2 | high | `/welcome` finish (`welcome/page.tsx:64-69`) | `POST /api/onboarding-progress` hits a GET-only route (405, swallowed). Focus and title are discarded; the wizard persists nothing. |
| B3 | high | `/onboard` header "Skip for now" + logo (`onboard/layout.tsx:38-43`) | Both go to `/today`; `(dashboard)/layout.tsx:41-42` bounces back to `/onboard` while `setupCompleted` is false. Infinite loop; no way to skip. |
| B4 | high | `/setup` vs `/onboard` | Two different org-setup wizards write the same `setupCompleted` flag. Self-serve signup enters `/setup`; any dashboard visit before finishing (including the `/setup` logo → `/dashboard`) drops the admin into `/onboard`, which asks different questions and hard-codes the rest. |
| B5 | high | `/onboard` step 2 "Pick your apps" (`onboard/page.tsx:132,250-255`) | Writes `sidebar.pinned`, a legacy field nothing reads (`lib/preferences.ts:221`; rail is access-derived). "We've pinned N apps to your rail" is false. |
| B6 | high | `/onboard` completion (`onboard/page.tsx:125-128` → `api/setup/route.ts:149-173`) | Posts `departments: []` so all six default departments get deleted, and stores fabricated profile values (`smb`, `Other`, `1-10`, `[people,tasks,sops,meetings]`). |
| B7 | high | First-run surfaces (`dashboard/dashboard-content.tsx`, `onboarding-checklist.tsx`, `admin-setup-checklist.tsx`, `tour-content.tsx`) | The checklist components and the only tour-relaunch button live in a file nothing renders; the tour promises a "Help icon in the top bar" that doesn't exist; tour steps target renamed/gated pages (`/organization`, `/settings` "Team"/"Access Control", `/dashboard`). |
| B8 | high | `/register`, `/reset-password` password hints | UI says "Min. 8 characters" / "a symbol"; server requires uppercase + number (`lib/password-policy.ts:14-18`). Error only after submit. |
| B9 | medium | MFA (`lib/auth.ts:125`, `.env*`) | Enrolment is cosmetic unless `ENFORCE_MFA_AT_LOGIN=true`; the flag is unset everywhere and undocumented. Org "MFA required" and "Session timeout" are displayed but never enforced. |
| B10 | medium | Settings hub → `/account/security` | Org password policy / 2FA cards link to a personal read-only page; there is no editor for `settings.security` anywhere. |
| B11 | medium | Email verification | Never sent at signup; only "Resend" on Account → Security triggers it, so every account is "unverified"; `/verify-email` is orphaned and its "Request one" link goes to password reset. |
| B12 | medium | New-org landing (`today/page.tsx`, `spaces/page.tsx:36-42`) | No default Space is created, so after both wizards the admin lands on a "No Spaces yet" stub with a "find the + in the sidebar" instruction; the auto tour opens on top of it. |
| B13 | medium | Emails (`email-templates/base.ts`, `request-verify/route.ts:57-73`, `welcome.ts`) | Dark `#0a0a0a` + lime `#d4ff2e` template from the pre-rebrand era; welcome email cites "Organization → About" and "Settings → Team". |
| B14 | medium | `/setup` invites (`api/setup/route.ts:211-236`) | Bypass domain lock and `people.create` check; hard-coded role list differs from `ACCESS_LEVELS`; cannot set department/role/manager; "Skip for now" actually completes setup. |
| B15 | medium | Rail "Invite" (`click-app-rail.tsx:180-192`) vs Members gate | Shown to everyone; non-admins get per-email 403 toasts. Members page gates on access level, API on permission matrix. |
| B16 | medium | `/login` + `lib/auth.ts:213-222` | Google provider can be registered but there is no Google button; the proof pane advertises SSO. `?registered=true` is never read. |
| B17 | medium | `/welcome` gating | No session check in `(auth)` layout; renders "Welcome in, friend." signed-out. `pages.newUser` in `lib/auth.ts:269` is inert. |
| B18 | medium | Marketing → signup | No `/register` CTA anywhere in `src/components/landing`; topbar offers "Log in" and "Get a demo". Self-serve signup is only discoverable via `/login`. |
| B19 | medium | Loading conventions | Auth pages: inline `Loader2`; `/setup`, `/onboard`: `DotsLoaderScreen` on `#FBFBFC`; app boot: dark navy backdrop + delayed `DotsLoader` + `MissionSplash`. Wizard → app flashes light → dark → white. |
| B20 | medium | Error handling in wizards (`setup/page.tsx:234-236`, `onboard/page.tsx:134`) | Failed `POST /api/setup` is `console.error` only; button re-enables with no message. |
| B21 | medium | `/forgot-password` copy | "30 minutes" vs 60-minute token (`forgot-password/route.ts:55`). |
| B22 | low | Three wizard dialects | `(auth)` slate + black buttons; `/setup` shadcn + legacy `text-muted`/`bg-surface`/`border-border` tokens; `/onboard` zinc + inline hex + Figtree. None use `--os-*`. Progress shown as bar, chips, dots, and "step N of 3" text across the four wizards. |
| B23 | low | `/onboard` catalog config | Category gradients/order for Sales/Marketing/Service/Finance/Dev that no longer exist; department copy sells removed verticals; recommended product slugs (`workwrk-crm`, `workwrk-books`) likely COMING_SOON. |
| B24 | low | Pending invites (Members) | Revoke only; no resend/copy link for expired invites. |
| B25 | low | `/account/security` | "Access level" rendered as a passed check; arbitrary score; `.acs` has no responsive rules; enrol/disable code inputs behave differently. |
| B26 | low | `/reset-password` success | Auto-redirect after 2.4 s with no manual link. |
| B27 | low | `/loader-preview` | Public dev route in prod. |
| B28 | low | Auth SEO | No `noindex` on auth pages. |
| B29 | low | `(auth)` proof pane copy | Placeholder testimonial, "18 locales", "Agents/Forms/Tables" primitives vs PPMS scope and premium-module gating. |

---

## 3. Cross-cutting conventions observed

- Back navigation: no `BackButton` anywhere in this subsystem. Auth pages use inline text links ("Back to sign in"); the three wizards use local `setStep` "Back" buttons; `/welcome` "Skip" and `/setup` logo go to `/dashboard`, `/onboard` logo/skip go to `/today`; SettingsShell close/Esc go to `/today` (never `router.back`). Three names for the same destination (`/dashboard` → `/today` → Space).
- Loader: `lucide Loader2` spinner inside buttons on auth pages and dialogs; `DotsLoaderScreen` (light) for wizard session gates; dark `BOOT_BG` + `DotsLoader` (after 650 ms) + `MissionSplash` for the OS boot; `/setup` uses a hand-rolled CSS spinner; `/welcome` uses `.auth-spinner` (undefined).
- Empty/error states: auth pages share a consistent rose-50 error banner and emerald success banner; `/verify-email` handles four states; wizards swallow server errors; `/spaces` empty state is a text box; Members pending list hides when empty; security activity has "No recent activity yet."; InviteModal reports via toast and keeps failed chips.
- Style consistency: `(auth)` = Tailwind slate, literal `#0073EA`, black primary buttons, no design-system primitives; `/setup` = shadcn `ui/*` + old global tokens; `/onboard` = zinc + inline hex; `/welcome` = orphaned CSS; `/account/security` = `os.css` `.acs` with `--os-*` tokens; MFA/invite dialogs = literal hex + `dark:` variants. Brand blue is used for selection states everywhere but primary CTAs alternate between black (`slate-900`/`zinc-900`) and blue.
- Mobile: `(auth)` collapses to one column and hides the proof pane; `/setup` and `/onboard` use responsive grids and a `max-w-5xl` container; `/account/security` relies on flex wrapping with no media queries; dialogs are fixed `max-w-[420px]`.
- Theme: root default is dark (`providers.tsx:35`); every page here forces light via inline `colorScheme`/explicit colours, so the subsystem is effectively light-only while the OS supports dark.

## 4. Access notes

- Public without session: `/login`, `/register`, `/forgot-password`, `/reset-password`, `/verify-email` (`proxy.ts:67-69`). `/welcome`, `/onboard`, `/setup` are app routes gated client-side: `/onboard` and `/setup` layouts redirect to `/login`, `/welcome` has no gate. The edge gate that would redirect signed-out visitors before the bundle loads is opt-in (`AUTH_EDGE_GATE`, unset).
- Org setup: `GET/POST /api/setup` only checks for a session (`api/setup/route.ts:14-17,38-41`). Any member, including an invited EMPLOYEE, can complete/overwrite org setup, delete departments, install products and send invites (setup invites skip the permission and domain checks). If an org ever has `setupCompleted=false`, every member is forced through `/onboard` and mutates org settings on finish.
- Invitations: `POST /api/invitations` requires `people.create`; Members UI gates on COMPANY_ADMIN/SUPER_ADMIN; rail Invite button has no gate at all. Domain lock = `org.domain ?? inviter's email domain` (server) vs signed-in user's domain (client). `SUPER_ADMIN` is excluded from invite levels.
- Sign-in: Google SSO admits only pre-existing, non-deleted users of healthy orgs; never creates an org. Credentials login blocks INACTIVE/deleted users after the password check, handles CANCELLED/SUSPENDED orgs by switching to another membership, and lockouts are per IP+email. Sessions are 12h idle JWTs with 5-minute DB re-validation and `tokenVersion` revocation (sign-out everywhere, password change/reset).
- MFA: per-user opt-in via Account → Security; only honoured at login when `ENFORCE_MFA_AT_LOGIN=true`; org-wide `twoFactorEnabled` is display-only. Backup codes are single-use.
- Inconsistency summary: three different authorisation rules for "who can invite"; setup has no role gate; MFA "on" is not "on" without an env flag; org security policy is enforced for password choice but has no owner UI.

## 5. Settings notes

Configurable in this subsystem today:
- `/setup`: business type, industry, use case, enabled modules, team size, default/custom departments, initial invites (email + role).
- `/onboard`: department/use case (stored as `useCase` and `departmentRouter`), app picks (dead `sidebar.pinned`).
- `/account/security`: MFA enrol/disable, change password, sign out everywhere, resend verification.
- InviteModal: access level, department, role, manager, personal message per invite.

Displayed but not editable or not enforced: org password policy (min length, uppercase, numbers), session timeout, MFA-required-org-wide.

Should be configurable here but is not:
- Org security policy editor (password rules, MFA enforcement, session timeout) at the workspace level, with real enforcement.
- Require email verification (and send it at signup); verification resend from `/login`.
- Org email domain (`org.domain`) for the invite lock, and allow-list exceptions for contractors/agents.
- SSO enablement per org (Google today, SAML per proof-pane claims) and a login button.
- Invitation expiry, resend, copy-link, and edit-before-accept; bulk CSV invite.
- Default workspace scaffolding on org creation (first Space/Folder/Board, sample templates) so `/today` never lands on the "No Spaces yet" stub.
- Re-runnable setup ("Re-run workspace setup") after `setupCompleted`, and a real skip that marks setup done with defaults.
- Trial state (length, end date, what "14 days" means) surfaced somewhere after signup.
- Terms/Privacy acceptance record at signup; company logo/branding on the invite-accept page.
- First-run tour: entry point (help menu), per-role content that matches current routes, and a persisted (not localStorage) completion flag.
- Personalisation collected by `/welcome` (focus, title) should either be persisted to the user profile or the step removed.
