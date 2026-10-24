// Settings clean-up Phase 3 (docs/plans/settings-cleanup.md D Phase 3, B4 to
// B6, B10, B12): My settings, all 7 pages. Each page is rendered to static
// markup with its shell, boot and account reads stubbed, so what is asserted
// is what the browser receives on first paint: every top-level child of a
// page's card stack is a card (nothing floats between cards), each note sits
// inside the card it belongs to, and a card that would only flash in and out
// draws nothing before its first answer.

import { describe, expect, it, vi } from "vitest";
import { createElement as h, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({ role: "ADMIN" as "OWNER" | "ADMIN" | "MEMBER" | "GUEST", query: "", mfaEnabled: false }));

// SettingsPage waits for ?tab= inside a Suspense boundary, and a server render
// that throws inside one quietly draws its fallback (the title alone). Here it
// is a pass-through, so a page that cannot render fails the test instead.
vi.mock("react", async (importOriginal) => {
  const real = await importOriginal<typeof import("react")>();
  return { ...real, Suspense: ({ children }: { children?: import("react").ReactNode }) => children };
});
vi.mock("@/components/ui/dialog-provider", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/ui/dialog-provider")>();
  return { ...real, useConfirm: () => async () => false };
});
vi.mock("next/navigation", () => ({
  usePathname: () => "/account",
  useRouter: () => ({ replace: () => {}, push: () => {}, back: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(state.query),
}));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null, status: "authenticated", update: async () => null }) }));
vi.mock("@/components/layout/os/boot-context", () => ({
  useBoot: () => ({ boot: { viewer: { orgRole: state.role, adminScopes: [] }, org: { inboxAutoClears: false } } }),
  useViewerRole: () => ({
    orgRole: state.role,
    isOwner: state.role === "OWNER",
    isAdmin: state.role === "OWNER" || state.role === "ADMIN",
    isGuest: state.role === "GUEST",
  }),
}));
vi.mock("@/components/layout/os/shell-context", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/layout/os/shell-context")>();
  const prefs = {
    theme: { appearance: "LIGHT", chrome: "navy" },
    density: "comfortable",
    lockedKeys: [],
    home: { ui: {}, locale: { timezone: "Asia/Kolkata" }, notifications: { inbox: {}, inboxView: {}, email: {} }, cards: [] },
    sidebar: { quickTools: [], sectionsOrder: [] },
  };
  const shell = {
    prefs,
    patchPrefs: async () => true,
    sidebarWidth: 264,
    setSidebarWidth: () => {},
    sidebarCollapsed: false,
    setSidebarCollapsed: async () => true,
    setMutedUntil: async () => true,
    presenceStatus: real.DEFAULT_PRESENCE,
    setPresenceStatus: async () => true,
    openStatusModal: () => {},
  };
  return { ...real, useOsShell: () => shell };
});
// Show upcoming features off, as for most people (its module reads the shell
// through a path the shell's own mock above cannot reach).
vi.mock("@/components/ui/coming-soon-row", () => ({ useShowUpcoming: () => false, UpcomingOnly: () => null, ComingSoonRow: () => null }));
vi.mock("@/components/account/use-me", () => ({
  useMe: () => ({
    status: "ready",
    refresh: async () => {},
    retry: () => {},
    me: {
      id: "u1",
      firstName: "Verify",
      lastName: "Bot",
      email: "verify.admin@acmecorp.com",
      avatar: null,
      phone: null,
      dateOfBirth: null,
      emailVerifiedAt: "2026-09-17T10:00:00.000Z",
      passwordChangedAt: null,
      mfaEnabled: state.mfaEnabled,
      backupCodesLeft: 8,
      createdAt: "2026-09-01T10:00:00.000Z",
      orgRole: state.role,
      isAgent: false,
      isLastAdmin: false,
      department: null,
      role: null,
      office: null,
      manager: null,
      organization: { id: "o1", name: "Acme Corp" },
      policy: { mfaRequired: false, passwordMaxAgeDays: null, password: { minLength: 12, requireUpper: false, requireLower: false, requireNumber: false, requireSymbol: false } },
    },
  }),
}));

import AccountProfilePage from "@/app/(dashboard)/account/profile/page";
import PreferencesPage from "@/app/(dashboard)/account/preferences/page";
import NotificationSettingsPage from "@/app/(dashboard)/account/notifications/page";
import AccountSecurityPage from "@/app/(dashboard)/account/security/page";
import ConnectionsPage from "@/app/(dashboard)/account/connections/page";
import KeyboardShortcutsPage from "@/app/(dashboard)/account/shortcuts/page";
import { TeammateGoogleCard } from "@/components/account/teammate-google-card";
import { ConnectedAppsCard } from "@/components/account/connected-apps-card";
import { GHOST_MARK, SettingsRow, STACKED_GHOST_ALIGN } from "./settings-row";
import { btn, OutcomeLine } from "@/components/account/account-ui";
import { Switch } from "@/components/ui/switch";
import { SETTINGS_MORE_LABEL } from "./settings-more";

function render(Page: ComponentType, opts: { role?: typeof state.role; query?: string; mfa?: boolean } = {}): string {
  state.role = opts.role ?? "ADMIN";
  state.query = opts.query ?? "";
  state.mfaEnabled = opts.mfa ?? false;
  return renderToStaticMarkup(h(Page));
}

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

/** The direct child elements of the first element whose opening tag `open` matches, each as its outer HTML. */
function childrenOf(html: string, open: RegExp): string[] {
  const m = open.exec(html);
  if (!m) return [];
  const out: string[] = [];
  const tag = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?(\/?)>/g;
  tag.lastIndex = m.index + m[0].length;
  let depth = 0;
  let start = -1;
  for (let t = tag.exec(html); t; t = tag.exec(html)) {
    const [whole, close, name, self] = t;
    if (close) {
      if (depth === 0) break;
      depth -= 1;
      if (depth === 0) out.push(html.slice(start, tag.lastIndex));
    } else if (VOID.has(name.toLowerCase()) || self === "/") {
      if (depth === 0) out.push(whole);
    } else {
      if (depth === 0) start = t.index;
      depth += 1;
    }
  }
  return out;
}

const STACK = /<div class="flex flex-col gap-6">/;
/** The cards of a page's card stack, failing the test when anything else sits between them. */
function cardsOf(html: string): string[] {
  const kids = childrenOf(html, STACK);
  expect(kids.length).toBeGreaterThan(0);
  for (const k of kids) expect(k.slice(0, 80), "a top-level child of the card stack that is not a card").toMatch(/^<section\b/);
  return kids;
}
const cardTitled = (cards: string[], title: string) => cards.find((c) => new RegExp(`<h2 class="[^"]*">${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</h2>`).test(c)) ?? "";
/** The card's header (title, description, Show more, actions), where a card's own note belongs. */
const headerOf = (card: string) => /<header\b[\s\S]*?<\/header>/.exec(card)?.[0] ?? "";
const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;|&apos;/g, "'").replace(/&amp;/g, "&");

describe("Profile", () => {
  // Rendered inside each test, so on a page that fails the card rule each test fails on its own.
  const profile = () => {
    const html = render(AccountProfilePage);
    return { html, cards: cardsOf(html) };
  };

  it("draws only cards: Your place's note is its card's description, not a caption under it", () => {
    const { html, cards } = profile();
    const place = cardTitled(cards, "Your place at Acme Corp");
    expect(text(headerOf(place))).toContain("Ask your manager or the People team to change these.");
    expect(html.match(/Ask your manager or the People team to change these\./g)).toHaveLength(1);
  });

  it("says what Your data is in one line and puts the full list behind Show more, the skills list still in the card", () => {
    const { cards } = profile();
    const data = cardTitled(cards, "Your data");
    const head = headerOf(data);
    expect(text(head)).toContain("A copy of your personal records. It downloads as a JSON file.");
    expect(head).toContain(SETTINGS_MORE_LABEL);
    // The list is in the closed Show more, still in the page for aria-controls.
    expect(head).toMatch(/<div id="[^"]+" hidden="" [^>]*>It holds your profile, notifications, activity and consents; your KPIs, reviews, feedback, check-ins, meetings, kudos and ideas; and your AI teammate chats, requests, memories and routines\.<\/div>/);
    expect(data).toContain(">Download</button>");
  });

  it("keeps the danger zone's consequence in sight as the card's description, the row a label and its button", () => {
    const { cards } = profile();
    const danger = cardTitled(cards, "Danger zone");
    expect(cards[cards.length - 1]).toBe(danger);
    expect(danger).toContain("border-[var(--os-danger-border)]");
    expect(text(headerOf(danger))).toContain("Deletes your account in every workspace you belong to and erases your personal details. Work you created stays with its workspace.");
    expect(danger).not.toContain(SETTINGS_MORE_LABEL);
    const row = danger.slice(danger.indexOf("data-settings-row"));
    expect(row).toContain(">Delete my account</div>");
    expect(row).toContain(">Delete my account</button>");
    // The row draws no hint of its own.
    expect(row).not.toContain('class="mt-0.5 text-sm text-ink-2"');
  });

  it("draws the email as a row: the address, who manages it, and its verified state", () => {
    const { cards } = profile();
    const email = cardTitled(cards, "Email");
    expect(email).toContain("data-settings-row");
    expect(email).toContain(">verify.admin@acmecorp.com</div>");
    expect(email).toContain('<div class="mt-0.5 text-sm text-ink-2">Managed by your workspace admin</div>');
  });

  it("says the photo takes WebP too, as the upload does", () => {
    const { html } = profile();
    expect(html).toContain("PNG, JPG or WebP, up to 2 MB.");
  });
});

describe("Preferences", () => {
  it("Language & region: the only-you note is the card's description", () => {
    const html = render(PreferencesPage, { query: "tab=region" });
    const cards = cardsOf(html);
    expect(text(headerOf(cardTitled(cards, "Language &amp; region")))).toContain("Changing these only affects you.");
  });

  it("Sidebar: the Customize panel note, and an Admin's link to the workspace defaults, are the first card's description", () => {
    const admin = cardsOf(render(PreferencesPage, { query: "tab=sidebar" }));
    expect(cardTitled(admin, "Sidebar")).toBe(admin[0]);
    const head = headerOf(admin[0]);
    expect(text(head)).toContain("The Customize panel at the foot of the sidebar changes the same settings. Admins set the workspace defaults in Workspace settings, Identity & culture.");
    expect(head).toContain('href="/settings/identity?tab=appearance"');
    // A Member is told about the Customize panel and given no link they cannot use.
    const member = cardsOf(render(PreferencesPage, { query: "tab=sidebar", role: "MEMBER" }));
    expect(text(headerOf(member[0]))).toContain("The Customize panel at the foot of the sidebar changes the same settings.");
    expect(member.join("")).not.toContain("/settings/identity");
  });

  it("Appearance: Reduced motion is still the switch the shell reads", () => {
    const html = render(PreferencesPage, { query: "tab=appearance" });
    cardsOf(html);
    expect(html).toMatch(/id="preferences\.appearance\.reducedMotion"[\s\S]*?role="switch"[\s\S]*?aria-label="Reduced motion"/);
  });
});

describe("Notifications", () => {
  for (const tab of ["inbox", "email", "desktop"]) {
    it(`${tab}: the tabs sit under the subtitle, Quiet is the tab's first card, and the rest is cards only`, () => {
      const html = render(NotificationSettingsPage, { query: `tab=${tab}` });
      const tabs = html.indexOf('aria-label="Tabs"');
      const quiet = html.indexOf('id="notifications.quiet"');
      expect(tabs).toBeGreaterThan(html.indexOf("data-settings-subtitle"));
      expect(quiet).toBeGreaterThan(tabs);
      cardsOf(html);
    });
  }
});

describe("Security", () => {
  it("puts the Workspace sign-in policy link in the How you log in card's header, for those who can open it", () => {
    const cards = cardsOf(render(AccountSecurityPage));
    const login = cardTitled(cards, "How you log in");
    expect(headerOf(login)).toContain('href="/settings/security?tab=signin"');
    expect(text(headerOf(login))).toContain("Workspace sign-in policy");
    const member = cardsOf(render(AccountSecurityPage, { role: "MEMBER" }));
    expect(member.join("")).not.toContain("/settings/security?tab=signin");
  });

  it("keeps Log out everywhere a row with its own confirm button, and the activity card one width with the rest", () => {
    const cards = cardsOf(render(AccountSecurityPage));
    const sessions = cardTitled(cards, "Where you are logged in");
    expect(sessions).toContain(">Log out everywhere</div>");
    expect(sessions).toContain(">Log out everywhere</button>");
    // No MCP clause before the connected-apps route has said AI apps are offered.
    expect(sessions).toContain("Ends every session, on every device, including this one</div>");
    expect(cardTitled(cards, "Recent security activity")).not.toContain("data-wide");
  });
});

describe("Calendar & connections", () => {
  const html = render(ConnectionsPage);

  it("draws the Google Calendar card at once, its loading inside it, and no other card style", () => {
    const cards = cardsOf(html);
    const google = cards[0];
    expect(google).toMatch(/^<section id="connections\.google"/);
    expect(google).toContain(">Google Calendar</h2>");
    expect(text(headerOf(google))).toContain("See your Google events beside your work on the Calendar.");
    expect(google).toContain("os-skeleton");
    expect(html).not.toContain("cxn");
    expect(html).not.toContain("Reading your connections");
  });

  it("makes the pointer to the workspace's integrations the Google Calendar card's action, never a footnote", () => {
    const google = cardsOf(html)[0];
    expect(headerOf(google)).toMatch(/<a [^>]*href="\/integrations"[^>]*>Workspace integrations<\/a>/);
    expect(html).not.toContain("Looking for workspace integrations instead?");
    // Integrations answers a Guest with its 404: no pointer there for a Guest, a Member keeps it.
    expect(render(ConnectionsPage, { role: "GUEST" })).not.toContain('href="/integrations"');
    expect(render(ConnectionsPage, { role: "MEMBER" })).toContain('href="/integrations"');
  });

  it("draws neither AI card before its first answer, so neither flashes in and out", () => {
    expect(renderToStaticMarkup(h(TeammateGoogleCard, { outcome: { ai: null, partial: [], error: null } }))).toBe("");
    expect(renderToStaticMarkup(h(ConnectedAppsCard))).toBe("");
    expect(html).not.toContain("Reading your Google connection");
  });
});

describe("Keyboard shortcuts", () => {
  it("puts the print and ? note in the Anywhere card, not under the cards", () => {
    const cards = cardsOf(render(KeyboardShortcutsPage));
    const head = headerOf(cardTitled(cards, "Anywhere"));
    expect(text(head)).toContain("Your browser's own print command prints this page. Press ? anywhere to see the shortcuts for the page you are on.");
  });
});

describe("the shared pieces Phase 3 added", () => {
  // The 390 shot of Preferences: the third tab read "Side", the rest of it past the screen's edge behind a hidden
  // scroll (as Members' "Pending inv" did, plan P12). Below 640px the tabs now wrap; above it the row is unchanged.
  it("wraps a settings page's tabs onto a second line below 640px, keeping the 36px row above it", () => {
    const html = render(PreferencesPage, { query: "tab=region" });
    const row = /<div class="os-row ([^"]+)"><div role="tablist" aria-label="Tabs"/.exec(html)?.[1] ?? "";
    expect(row).toContain("h-9");
    for (const c of ["max-[640px]:h-auto", "max-[640px]:[&amp;&gt;div]:flex-wrap", "max-[640px]:[&amp;&gt;div]:overflow-visible"]) expect(row, c).toContain(c);
    expect(html).toContain(">Sidebar</span>");
  });

  it("SettingsRow draws its detail lines full width under the label and control line, after the control", () => {
    const r = renderToStaticMarkup(h(SettingsRow, { label: "An app", helper: "Works in Acme.", control: h("button", { type: "button" }, "Disconnect") }, h("p", null, "Connected 3 Oct.")));
    expect(r).toMatch(/^<div data-settings-row=""/);
    const line = r.indexOf("Disconnect");
    const detail = r.indexOf('<div class="mt-1 flex flex-col gap-1 text-sm text-ink-2"><p>Connected 3 Oct.</p></div>');
    expect(detail).toBeGreaterThan(line);
    // Not inside the label's column: the detail block closes the row.
    expect(r.endsWith("<p>Connected 3 Oct.</p></div></div>")).toBe(true);
    // A row with no detail lines draws no empty block.
    expect(renderToStaticMarkup(h(SettingsRow, { label: "A" }))).not.toContain("mt-1 flex flex-col gap-1");
  });

  // Phase 3 review, L1: an empty list of detail lines (no calendar turned off, no product off) drew an empty
  // 4px block under the row.
  it("SettingsRow draws no detail block for children that render nothing: an empty list, null or false", () => {
    for (const children of [[], [null, false], [[], null]]) {
      const r = renderToStaticMarkup(h(SettingsRow, { label: "A", control: h("button", { type: "button" }, "Go"), children }));
      expect(r, JSON.stringify(children)).not.toContain("mt-1 flex flex-col gap-1");
    }
    const one = renderToStaticMarkup(h(SettingsRow, { label: "A", children: [h("p", { key: "a" }, "One line."), null] }));
    expect(one).toContain('<div class="mt-1 flex flex-col gap-1 text-sm text-ink-2"><p>One line.</p></div>');
  });

  // Phase 3 review, L3: the hint gets an id the control is described by, and Switch passes both names on (it
  // dropped aria-labelledby, so the calendar switches and two others were read unnamed).
  it("SettingsRow puts helperId on its hint, and Switch passes aria-describedby and aria-labelledby on", () => {
    const r = renderToStaticMarkup(
      h(SettingsRow, { label: "Gmail", helper: "Sending always asks you first.", helperId: "hint-gmail", control: h(Switch, { checked: false, "aria-label": "Gmail", "aria-describedby": "hint-gmail" }) }),
    );
    expect(r).toContain('<div id="hint-gmail" class="mt-0.5 text-sm text-ink-2">Sending always asks you first.</div>');
    expect(r).toMatch(/<button type="button" role="switch" aria-checked="false" aria-label="Gmail" aria-describedby="hint-gmail"/);
    expect(renderToStaticMarkup(h(Switch, { checked: true, "aria-labelledby": "pln-allday-label" }))).toContain('aria-labelledby="pln-allday-label"');
    // No helperId, no id: the hint is drawn as before.
    expect(renderToStaticMarkup(h(SettingsRow, { label: "A", helper: "Hint." }))).toContain('<div class="mt-0.5 text-sm text-ink-2">Hint.</div>');
  });

  // Phase 3 review, L7: at 390 a ghost control (no border, its padding inside) sat 12px right of its label.
  it("lines a ghost control's text up with its label where the row stacks, and leaves bordered controls alone", () => {
    expect(btn.ghost.split(" ")).toContain(GHOST_MARK);
    expect(btn.dangerGhost.split(" ")).toContain(GHOST_MARK);
    for (const b of [btn.primary, btn.secondary, btn.danger]) expect(b.split(" ")).not.toContain(GHOST_MARK);
    // Spelled out whole for Tailwind, and the pull-back is the ghost's own padding (px-3).
    expect(STACKED_GHOST_ALIGN).toBe(`max-[640px]:[&>.${GHOST_MARK}:first-child]:-ms-3`);
    expect(btn.ghost.split(" ")).toContain("px-3");
    expect(btn.dangerGhost.split(" ")).toContain("px-3");
    const r = renderToStaticMarkup(h(SettingsRow, { label: "Delete my account", control: h("button", { type: "button", className: btn.dangerGhost }, "Delete my account") }));
    const wrap = /<div class="([^"]*\bshrink-0\b[^"]*)">/.exec(r)?.[1] ?? "";
    expect(wrap).toContain("max-[640px]:flex-wrap");
    expect(wrap).toContain("max-[640px]:[&amp;&gt;.os-btn-ghost:first-child]:-ms-3");
  });

  it("OutcomeLine is a line, never a box: an icon and 13px text, a problem in the danger colour", () => {
    const ok = renderToStaticMarkup(h(OutcomeLine, { tone: "ok", role: "status", children: "Connected." }));
    const bad = renderToStaticMarkup(h(OutcomeLine, { tone: "bad", role: "alert", children: "Didn't connect." }));
    for (const l of [ok, bad]) {
      expect(l).toMatch(/^<p role="(status|alert)" class="m-0 flex items-start gap-2 text-sm/);
      expect(l).not.toMatch(/border|rounded|bg-/);
    }
    expect(ok).toContain("text-ink-2");
    expect(bad).toContain("text-danger-text");
  });
});
