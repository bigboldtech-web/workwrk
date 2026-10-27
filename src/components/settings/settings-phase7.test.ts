// Settings clean-up Phase 7: Security, Audit log, API & webhooks, Plan &
// billing, both All settings pages, and the Integrations grid.
//
// Each page is rendered (server markup, no DOM) over faked reads, and where
// a handler or a prop matters the element tree a component returns is
// walked, so the test sees the control and what it is given, not only a
// string in the source.
//
// The modules new with this phase are imported inside the tests that need
// them, so on the code before it each test fails on its own assertion
// rather than the whole file failing to load.

import { describe, expect, it, vi } from "vitest";
import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const state = vi.hoisted(() => ({
  query: "",
  pathname: "/settings/security",
  /** Each settings section's read: its status, over one GET /api/settings body. */
  sections: {} as Record<string, "loading" | "ready" | "error">,
  body: {} as Record<string, unknown>,
  showUpcoming: false,
  /** Boot's org.billingLive: Stripe billing is configured. */
  billingLive: false,
  /** While set, the render's useState calls take these values by call order (what a read or a click would have set). */
  seed: null as Map<number, unknown> | null,
  seedAt: 0,
  /** Every call of a seeded state's setter: its index and the value (a function setter is called on the seed). */
  sets: [] as Array<[number, unknown]>,
  /** Every apiFetch call: its URL and init. */
  apiCalls: [] as Array<[string, unknown]>,
  /** URLs whose apiFetch fails (a failed read). */
  failing: [] as string[],
  /** URLs whose apiFetch answers this body. */
  answers: {} as Record<string, unknown>,
  /** URLs whose apiFetch waits for this promise first (a read still out). */
  holds: {} as Record<string, Promise<void>>,
  /** Every section save: what was sent. */
  saved: [] as unknown[],
}));

vi.mock("react", async (importOriginal) => {
  const real = await importOriginal<typeof import("react")>();
  return {
    ...real,
    Suspense: ({ children }: { children?: import("react").ReactNode }) => children,
    useState: <S,>(init: S | (() => S)) => {
      if (state.seed) {
        const i = state.seedAt++;
        if (state.seed.has(i)) {
          const value = state.seed.get(i) as S;
          return [value, (v: unknown) => { state.sets.push([i, typeof v === "function" ? (v as (p: S) => unknown)(value) : v]); }] as const;
        }
      }
      return real.useState(init);
    },
  };
});
vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
  useRouter: () => ({ replace: () => {}, push: () => {}, back: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(state.query),
}));
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { organizationId: "o1" } }, status: "authenticated", update: async () => null }),
  signOut: async () => {},
}));
vi.mock("@/components/ui/dialog-provider", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/ui/dialog-provider")>();
  return { ...real, useConfirm: () => async () => true, usePrompt: () => async () => null };
});
vi.mock("@/components/layout/os/boot-context", () => ({
  useBoot: () => ({ boot: { viewer: { id: "me", orgRole: "ADMIN", isAgent: false, adminScopes: [] }, org: { objectShare: false, inboxAutoClears: false, trashPurges: false, ...(state.billingLive ? { billingLive: true } : {}) } } }),
  useViewerRole: () => ({ orgRole: "ADMIN", isOwner: false, isAdmin: true, isGuest: false }),
}));
vi.mock("@/components/layout/os/shell-context", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/layout/os/shell-context")>();
  const prefs = { theme: { appearance: "LIGHT" }, density: "comfortable", lockedKeys: [], home: { ui: {}, locale: { timezone: "Asia/Kolkata" } }, sidebar: {}, modules: { activeAppKeys: [] } };
  return { ...real, useOsShell: () => ({ prefs, rowVersion: () => 0, bumpRowVersion: () => {} }) };
});
vi.mock("@/components/layout/os/toast", () => ({ useOsToast: () => ({ toast: () => {} }) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: () => {} }) }));
vi.mock("@/components/ui/coming-soon-row", () => ({ useShowUpcoming: () => state.showUpcoming, UpcomingOnly: () => null, ComingSoonRow: () => null }));
vi.mock("@/components/ui/date-text", () => ({ DateText: ({ value }: { value: unknown }) => String(value) }));
vi.mock("@/hooks/use-settings-section", () => ({
  useSettingsSection: (section: string, select: (b: unknown) => unknown) => {
    const status = state.sections[section] ?? "ready";
    return {
      status,
      error: status === "error" ? "HTTP 500" : null,
      data: status === "ready" ? select(state.body) : null,
      retry: () => {},
      reload: async () => {},
      save: async (patch: unknown) => { state.saved.push(patch); return { ok: true }; },
    };
  },
}));
vi.mock("@/lib/api-fetch", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api-fetch")>();
  return {
    ...real,
    apiFetch: async (url: string, init?: unknown) => {
      state.apiCalls.push([url, init]);
      const hold = Object.entries(state.holds).find(([u]) => url.startsWith(u));
      if (hold) await hold[1];
      if (state.failing.some((f) => url.startsWith(f))) return { ok: false, status: 503, error: "Service unavailable" };
      const answer = Object.entries(state.answers).find(([u]) => url.startsWith(u));
      return { ok: true, status: 200, data: answer ? answer[1] : {} };
    },
  };
});

import { SettingsCard } from "./settings-card";
import { SettingsPage, SettingsToolbar } from "./settings-page";
import { SaveBar } from "./save-bar";
import { TableCard, type TableColumn } from "@/components/ui/table-card";
import { DEFAULT_SIGN_IN_POLICY } from "@/lib/settings/org-policy";
import { SETTINGS_ENTRIES } from "@/lib/settings-registry";
import WorkspaceSecurityPage from "@/app/(dashboard)/settings/security/page";
import AuditLogPage from "@/app/(dashboard)/settings/audit/page";
import ApiSettingsPage from "@/app/(dashboard)/settings/api/page";
import BillingSettingsPage from "@/app/(dashboard)/settings/billing/page";
import { AllSettingsIndex } from "./all-settings-index";

const root = join(__dirname, "..", "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ");

type El = { type: unknown; props: Record<string, unknown> };
/** Every element in a tree a component returned (its own elements; child components are not called). */
function elements(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) { for (const n of node) elements(n, out); return out; }
  if (!node || typeof node !== "object" || !("props" in node) || !("type" in node)) return out;
  const el = node as El;
  out.push(el);
  for (const v of Object.values(el.props ?? {})) if (v && typeof v === "object") elements(v, out);
  return out;
}
/** The tree a hook-using component returns for these props, made inside a real render so its hooks run. */
function treeOf<P>(C: (p: P) => ReactNode, props: P): unknown {
  let out: unknown = null;
  const Probe = () => { out = C(props); return null; };
  html(h(Probe));
  return out;
}
const words = (node: unknown): string => {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(words).join("");
  if (typeof node === "object" && "props" in node) return words((node as El).props.children);
  return "";
};
/** A render whose useState calls, by call order, start from `seed` (index, value): a server render keeps only first states. */
function withSeed<T>(seed: Array<[number, unknown]>, run: () => T): T {
  state.seed = new Map(seed);
  state.seedAt = 0;
  state.sets = [];
  try { return run(); } finally { state.seed = null; state.seedAt = 0; }
}
/** The markup of the element with this id, up to the end of the section it opens. */
function sectionById(markup: string, id: string): string {
  const start = markup.indexOf(`id="${id}"`);
  if (start < 0) return "";
  return markup.slice(start, markup.indexOf("</section>", start));
}
/** A card's header (title, description, actions) and its body. */
function headerOf(section: string): string {
  return section.slice(0, section.indexOf("</header>"));
}
/** The text a markup shows, with the closed Show more bodies (hidden) left out. */
function shown(markup: string): string {
  return text(markup.replace(/<div id="[^"]+" hidden=""[^>]*>[\s\S]*?<\/div>/g, ""));
}
/** The closed Show more bodies' text. */
function hiddenText(markup: string): string {
  return [...markup.matchAll(/<div id="[^"]+" hidden=""[^>]*>([\s\S]*?)<\/div>/g)].map((m) => text(m[1])).join(" ");
}
/** The body a SettingsPage element was given, for this tab, as an element tree. */
function pageBody(page: unknown, tab: string): El[] {
  const sp = elements(page).find((e) => e.type === SettingsPage);
  expect(sp, "the SettingsPage").toBeTruthy();
  const children = sp!.props.children as ((t: string | null) => ReactNode) | ReactNode;
  return elements(typeof children === "function" ? children(tab) : children);
}

/* ───────────────────────── Security ───────────────────────── */

describe("Security > Sign-in policy", () => {
  const ready = () => {
    state.query = "";
    state.pathname = "/settings/security";
    state.sections = { security: "ready" };
    state.body = { settings: { signIn: DEFAULT_SIGN_IN_POLICY } };
  };

  it("a long row hint keeps what people feel on its line and opens how the field counts under Show more (B6)", () => {
    ready();
    const markup = html(h(WorkspaceSecurityPage));
    const row = markup.slice(markup.indexOf('id="security.sessionIdleMinutes"'), markup.indexOf('id="security.sessionMaxDays"'));
    expect(shown(row)).toMatch(/Now [^.]+\. Anyone clicking or typing stays signed in\./);
    expect(shown(row)).not.toContain("One day is 1,440 minutes");
    expect(row).toMatch(/<button type="button" class="[^"]*" aria-expanded="false" aria-controls="[^"]+">Show more<\/button>/);
    expect(hiddenText(row)).toContain("One day is 1,440 minutes.");
    expect(hiddenText(row)).toMatch(/Set in minutes, from 30 minutes to 30 days \(43,200 minutes\)/);
  });

  it("Log everyone out keeps its consequence shown, on one line beside its button", () => {
    ready();
    const danger = sectionById(html(h(WorkspaceSecurityPage)), "signin.signOutAll");
    const helper = /Log everyone out<\/div><div class="mt-0\.5 text-sm text-ink-2">([^<]+)<\/div>/.exec(danger)?.[1] ?? "";
    expect(helper).toBe("Every session on every device ends within five minutes, yours included.");
    // About 85 characters fit beside a control at 1440 (Phase 3 review, L4).
    expect(helper.length).toBeLessThanOrEqual(85);
    expect(danger).not.toContain("Show more");
  });

  it("every number field is named by its row's words, then its unit (the name starts with what is on screen)", () => {
    ready();
    const markup = html(h(WorkspaceSecurityPage));
    const names = [...markup.matchAll(/<input[^>]*type="number"[^>]*aria-label="([^"]+)"/g)].map((m) => m[1]);
    expect(names).toEqual([
      "Minimum length characters",
      "Password expires after days",
      "Signed out after being idle for minutes",
      "Signed out after days",
      "Lock the account after attempts",
      "Keep it locked for minutes",
    ]);
  });

  it("Invitation domains: what the list controls as the card's description, what it never does as the row's one line, and where to change it as the card's action (review L5)", () => {
    ready();
    const card = sectionById(html(h(WorkspaceSecurityPage)), "security.domains");
    const head = headerOf(card);
    expect(head).toContain('<a class="text-sm font-medium text-brand-deep underline-offset-4 hover:underline" href="/settings/members?tab=pending">Manage in Members, Invite rules</a>');
    expect(/<p class="mt-1 text-sm text-ink-2">([^<]+)<\/p>/.exec(head)?.[1]).toBe("Invitations, and new accounts from your identity provider, must use one of these domains.");
    const body = card.slice(card.indexOf("</header>"));
    expect(body).not.toContain("href=");
    expect(/Who can be invited<\/div><div class="mt-0\.5 text-sm text-ink-2">([^<]+)<\/div>/.exec(body)?.[1]).toBe("People already here sign in whatever their domain.");
  });

  it("the single sign-on line is the Passwords card's last line, readable, never a line between cards", () => {
    ready();
    state.showUpcoming = true;
    const markup = html(h(WorkspaceSecurityPage));
    state.showUpcoming = false;
    const passwords = sectionById(markup, "signin.passwords");
    expect(passwords).toContain('<p class="m-0 text-sm text-ink-2">Coming soon: single sign-on with SAML and OIDC, once a sign-in is verified end to end.</p>');
    expect(markup.match(/single sign-on/g)).toHaveLength(1);
  });

  it("the older two step key's note is a line in its card with a warning sign, never a filled box", () => {
    ready();
    state.body = { settings: { signIn: { ...DEFAULT_SIGN_IN_POLICY, mfaRequired: "off" }, signInLegacy: { twoFactorEnabled: true } } };
    const card = sectionById(html(h(WorkspaceSecurityPage)), "signin.mfa");
    const note = /<p role="note" class="([^"]+)">([\s\S]*?)<\/p>/.exec(card);
    expect(note, "the note").toBeTruthy();
    expect(note![1]).not.toMatch(/bg-|rounded|px-3/);
    expect(note![2]).toContain("<svg");
    expect(text(note![2])).toContain("it was never enforced and is not now");
  });

  it("which confirm a raise asks: none, not set up, or could not be checked (a failed read never skips the question)", async () => {
    const { mfaConfirmKind, MFA_CONFIRM_COPY } = await import("@/app/(dashboard)/settings/security/security-ui");
    const off = { ...DEFAULT_SIGN_IN_POLICY, mfaRequired: "off" as const };
    const everyone = { ...DEFAULT_SIGN_IN_POLICY, mfaRequired: "everyone" as const };
    const admins = { ...DEFAULT_SIGN_IN_POLICY, mfaRequired: "admins" as const };
    expect(mfaConfirmKind(null, off, null)).toBe("none");
    expect(mfaConfirmKind(off, off, null)).toBe("none");
    expect(mfaConfirmKind(admins, everyone, null)).toBe("unknown");
    expect(mfaConfirmKind(everyone, admins, { mfa: { viewerEnrolled: true } })).toBe("none");
    expect(mfaConfirmKind(off, everyone, null)).toBe("none");
    expect(mfaConfirmKind(everyone, off, { mfa: { viewerEnrolled: false } })).toBe("notEnrolled");
    expect(mfaConfirmKind(everyone, off, null)).toBe("unknown");
    expect(mfaConfirmKind(everyone, off, {} as never)).toBe("unknown");
    expect(MFA_CONFIRM_COPY.unknown.title).toBe("Couldn't check your two step verification");
    expect(MFA_CONFIRM_COPY.unknown.body).toContain("within five minutes you will be asked to");
    expect(MFA_CONFIRM_COPY.notEnrolled.title).toBe("You have not set up two step verification");
  });

  it("a raise saved while the counts cannot be read asks first and saves nothing; the counts are read again before it asks", async () => {
    ready();
    // The page's own tree, then the Sign-in tab's, with a raise to Everyone in its draft (useState #2) and no counts (#0).
    const tab = pageBody(treeOf(WorkspaceSecurityPage, {} as never), "signin").find((e) => typeof e.type === "function" && (e.type as { name?: string }).name === "SignInTab");
    expect(tab, "the Sign-in tab").toBeTruthy();
    const C = tab!.type as (p: unknown) => ReactNode;
    const draft = { ...DEFAULT_SIGN_IN_POLICY, mfaRequired: "everyone" as const };
    // The confirm (#5) and its words (#6) seeded too, so what the save sets them to is seen.
    const tree = withSeed([[0, null], [2, draft], [5, false], [6, "notEnrolled"]], () => treeOf(C, {}));
    const bar = elements(tree).find((e) => e.type === SaveBar);
    expect(bar?.props.dirty).toBe(true);
    state.failing = ["/api/settings/security-summary"];
    state.apiCalls = [];
    state.saved = [];
    const ok = await (bar!.props.onSave as () => Promise<boolean>)();
    state.failing = [];
    expect(ok).toBe(false);
    expect(state.saved).toEqual([]);
    expect(state.apiCalls.map(([u]) => u)).toContain("/api/settings/security-summary");
    // It asks the could-not-check question (mfaKind #6, then confirmMfa #5 opens), under that title.
    expect(state.sets.filter(([i]) => i === 6 || i === 5)).toEqual([[6, "unknown"], [5, true]]);
    const asked = elements(withSeed([[0, null], [2, draft], [5, true], [6, "unknown"]], () => treeOf(C, {})));
    const confirm = asked.find((e) => (e.type as { name?: string }).name === "ConfirmDialog" && e.props.confirmLabel === "Save anyway");
    expect(confirm?.props.open).toBe(true);
    expect(confirm?.props.title).toBe("Couldn't check your two step verification");
    // Not raised: it saves straight away, with no extra read.
    const plain = withSeed([[0, null], [2, { ...DEFAULT_SIGN_IN_POLICY, minPasswordLength: DEFAULT_SIGN_IN_POLICY.minPasswordLength + 2 }]], () => treeOf(C, {}));
    state.apiCalls = [];
    const saved = await (elements(plain).find((e) => e.type === SaveBar)!.props.onSave as () => Promise<boolean>)();
    expect(saved).toBe(true);
    expect(state.saved).toEqual([{ minPasswordLength: DEFAULT_SIGN_IN_POLICY.minPasswordLength + 2 }]);
    expect(state.apiCalls).toEqual([]);
  });

  /** The Sign-in tab's component and its tree, with a raise to Everyone in its draft (#2) and no counts (#0), plus any other seeds. */
  const raiseTab = (more: Array<[number, unknown]> = []) => {
    ready();
    const tab = pageBody(treeOf(WorkspaceSecurityPage, {} as never), "signin").find((e) => (e.type as { name?: string }).name === "SignInTab")!;
    const C = tab.type as (p: unknown) => ReactNode;
    const draft = { ...DEFAULT_SIGN_IN_POLICY, mfaRequired: "everyone" as const };
    const tree = withSeed([[0, null], [2, draft], [5, false], [6, "notEnrolled"], ...more], () => treeOf(C, {}));
    return { C, draft, bar: elements(tree).find((e) => e.type === SaveBar)! };
  };

  it("counts read again that say who the saver is: set up saves at once, not set up asks the not-set-up question (review L9)", async () => {
    state.answers = { "/api/settings/security-summary": { mfa: { viewerEnrolled: true } } };
    state.saved = [];
    const enrolled = raiseTab();
    expect(await (enrolled.bar.props.onSave as () => Promise<boolean>)()).toBe(true);
    expect(state.saved).toEqual([{ mfaRequired: "everyone" }]);

    state.answers = { "/api/settings/security-summary": { mfa: { viewerEnrolled: false } } };
    state.saved = [];
    const notYet = raiseTab();
    expect(await (notYet.bar.props.onSave as () => Promise<boolean>)()).toBe(false);
    state.answers = {};
    expect(state.saved).toEqual([]);
    expect(state.sets.filter(([i]) => i === 6 || i === 5)).toEqual([[6, "notEnrolled"], [5, true]]);
    const asked = elements(withSeed([[0, null], [2, notYet.draft], [5, true], [6, "notEnrolled"]], () => treeOf(notYet.C, {})));
    expect(asked.find((e) => e.props.confirmLabel === "Save anyway")?.props.title).toBe("You have not set up two step verification");
  });

  it("while the counts are read again, the Save bar shows it busy and a second save is refused, so it never reads twice (review L2)", async () => {
    // The re-read in flight (checking, #9): the bar is busy.
    expect(raiseTab([[9, true]]).bar.props.saving).toBe(true);
    expect(raiseTab().bar.props.saving).toBe(false);
    // Two presses while the read is out: one read, the second press answers at once.
    let release = () => {};
    state.holds = { "/api/settings/security-summary": new Promise<void>((r) => { release = r; }) };
    state.failing = ["/api/settings/security-summary"];
    state.apiCalls = [];
    state.saved = [];
    const { bar } = raiseTab();
    const first = (bar.props.onSave as () => Promise<boolean>)();
    const second = await (bar.props.onSave as () => Promise<boolean>)();
    expect(second).toBe(false);
    release();
    expect(await first).toBe(false);
    state.holds = {};
    state.failing = [];
    expect(state.apiCalls.filter(([u]) => u === "/api/settings/security-summary")).toHaveLength(1);
    expect(state.saved).toEqual([]);
  });
});

describe("Security > Provisioning", () => {
  it("the empty table's Generate a token starts the form afresh, as the header's does (review L3)", () => {
    state.query = "tab=provisioning";
    const tab = pageBody(treeOf(WorkspaceSecurityPage, {} as never), "provisioning").find((e) => (e.type as { name?: string }).name === "ProvisioningTab")!;
    state.query = "";
    // No tokens (#0), and the last try's name (#5), days (#6) and error (#8) still held.
    const all = elements(withSeed([[0, []], [4, false], [5, "Okta"], [6, 30], [8, "Name the token after the identity provider that uses it."]], () => treeOf(tab.type as (p: unknown) => ReactNode, tab.props)));
    const link = all.find((e) => e.type === "button" && words(e) === "Generate a token");
    expect(link, "the empty table's link").toBeTruthy();
    (link!.props.onClick as () => void)();
    expect(state.sets).toEqual(expect.arrayContaining([[5, ""], [6, 365], [8, null], [4, true]]));
  });

  it("How provisioning works says what happens to people in its two line description, and the rules under Show more", () => {
    state.query = "tab=provisioning";
    const card = sectionById(html(h(WorkspaceSecurityPage)), "security.scimRules");
    state.query = "";
    const head = headerOf(card);
    const description = /<p class="mt-1 text-sm text-ink-2">([^<]+)<\/p>/.exec(head)?.[1] ?? "";
    expect(description).toContain("Removing someone there deactivates them here and hands what they owned to their manager, else to an Owner.");
    // Two lines of the 712px text column hold about 220 characters.
    expect(description.length).toBeLessThanOrEqual(220);
    expect(hiddenText(card)).toContain("Owner, Admin and Agent are set here, never by the provider.");
    expect(hiddenText(card)).toContain("The last Owner is never removed that way.");
    expect(card).not.toContain('class="text-base text-ink"');
  });

  it("the SCIM endpoint says when its address could not be read, with Try again, and keeps Copy for the address it has", async () => {
    const { ScimEndpoint } = await import("@/app/(dashboard)/settings/security/security-ui");
    const failed = html(h(ScimEndpoint, { url: null, failed: true, onRetry: () => {}, onCopy: () => {} }));
    expect(text(failed)).toContain("Couldn't load the SCIM address");
    expect(text(failed)).toContain("Try again");
    expect(failed).not.toContain("Copy");
    const loading = html(h(ScimEndpoint, { url: null, failed: false, onRetry: () => {}, onCopy: () => {} }));
    expect(loading).toMatch(/<button type="button" class="[^"]*" disabled="">/);
    const onCopy = vi.fn();
    const tree = treeOf(ScimEndpoint, { url: "https://x.test/api/scim/v2", failed: false, onRetry: () => {}, onCopy });
    const copy = elements(tree).find((e) => e.type === "button");
    (copy!.props.onClick as () => void)();
    expect(onCopy).toHaveBeenCalledWith("https://x.test/api/scim/v2");
    // The tab draws it over its own read's state.
    const tab = pageBody(treeOf(WorkspaceSecurityPage, {} as never), "provisioning").find((e) => (e.type as { name?: string }).name === "ProvisioningTab");
    const used = elements(treeOf(tab!.type as (p: unknown) => ReactNode, tab!.props)).find((e) => e.type === ScimEndpoint);
    expect(used?.props.failed).toBe(false);
    expect(used?.props.url).toBeNull();
  });
});

/* ───────────────────────── Audit log ───────────────────────── */

describe("Audit log", () => {
  const body = () => {
    state.query = "";
    state.pathname = "/settings/audit";
    const tree = treeOf(AuditLogPage, {} as never);
    const sp = elements(tree).find((e) => e.type === SettingsPage)!;
    const el = pageBody(tree, "all").find((e) => (e.type as { name?: string }).name === "AuditBody")!;
    return { sp, all: elements(treeOf(el.type as (p: unknown) => ReactNode, el.props)) };
  };

  it("every tab holds its toolbar row in the header, at the heights the toolbar takes, so it arrives without moving the table", async () => {
    const { AUDIT_TOOLBAR_ROW } = await import("@/app/(dashboard)/settings/audit/audit-ui");
    expect(AUDIT_TOOLBAR_ROW).toBe("min-h-11 max-[594px]:min-h-[88px] max-[550px]:min-h-[132px]");
    const { sp } = body();
    const tabs = sp.props.tabs as Array<{ key: string; ownToolbar?: boolean; toolbarRow?: string }>;
    expect(tabs.map((t) => t.key)).toEqual(["all", "access", "security", "data", "settings"]);
    for (const t of tabs) {
      expect(t.ownToolbar, t.key).toBe(true);
      expect(t.toolbarRow, t.key).toBe(AUDIT_TOOLBAR_ROW);
    }
    state.query = "tab=security";
    expect(html(h(AuditLogPage))).toContain(`<div data-settings-toolbar-row="" class="${AUDIT_TOOLBAR_ROW}"></div>`);
    state.query = "";
  });

  it("the toolbar is drawn into the header: the search, Filter, Sort as a chip with its two orders, and the ... menu with Export", () => {
    const { all } = body();
    const bar = all.find((e) => e.type === SettingsToolbar);
    expect(bar, "the toolbar").toBeTruthy();
    expect(elements(bar!.props.left).some((e) => e.type === "input" && e.props["aria-label"] === "Search events")).toBe(true);
    // 280, as Members' and Tags' search: 320 ran past the column on a 390 phone.
    expect(String(elements(bar!.props.left).find((e) => e.type === "label")?.props.className)).toContain("w-[280px]");
    expect(bar!.props.filter).toMatchObject({ open: false, count: 0 });
    const sort = bar!.props.sort as { label: string; options: Array<{ value: string; label: string }>; value: string; menuLabel: string };
    expect(sort.options.map((o) => o.label)).toEqual(["Newest first", "Oldest first"]);
    expect(sort.value).toBe("desc");
    expect(sort.label).toBe("Sort");
    expect(sort.menuLabel).toBe("Sort events");
    expect((bar!.props.menu as Array<{ label: string }>).map((m) => m.label)).toEqual(["Export (CSV)", "Retention settings"]);
  });

  it("the Sort chip names the order in force and hands back the one picked", async () => {
    const { auditSort } = await import("@/app/(dashboard)/settings/audit/audit-ui");
    const pick = vi.fn();
    const asc = auditSort("asc", pick);
    expect(asc.label).toBe("Oldest first");
    expect(asc.active).toBe(true);
    asc.onChange!("desc");
    expect(pick).toHaveBeenCalledWith("desc");
    expect(auditSort("desc", pick).active).toBe(false);
  });

  it("a severity chip is the pale status chip: 24px, 12/500, its dot and its word", async () => {
    const { SeverityChip } = await import("@/app/(dashboard)/settings/audit/audit-ui");
    const chip = html(h(SeverityChip, { severity: "warning" }));
    const cls = /^<span class="([^"]+)">/.exec(chip)?.[1] ?? "";
    expect(cls.split(" ")).toEqual(expect.arrayContaining(["h-6", "text-xs", "font-medium", "px-2", "rounded-md"]));
    expect(cls).not.toContain("h-[26px]");
    expect(text(chip).trim()).toBe("Warning");
    // The table's Severity column draws this chip.
    const { all } = body();
    const table = all.find((e) => e.type === TableCard)!;
    const col = (table.props.columns as TableColumn<{ severity: string }>[]).find((c) => c.key === "severity")!;
    expect((col.render({ severity: "critical" }, 0) as El).type).toBe(SeverityChip);
  });

  it("the retention line is the table's own footer note, never a caption under it, and never hidden on a phone (review L7)", () => {
    const { all } = body();
    const table = all.find((e) => e.type === TableCard)!;
    const footer = table.props.footer as { trailing?: ReactNode; note?: ReactNode };
    expect(words(footer.note)).toBe("Entries are kept as long as Retention & privacy says.");
    expect(footer.trailing).toBeUndefined();
    expect(elements(footer.note).some((e) => /hidden/.test(String(e.props.className ?? "")))).toBe(false);
    const link = elements(footer.note).find((e) => typeof e.props.href === "string");
    expect(link?.props.href).toBe("/settings/data?tab=retention");
    expect(all.some((e) => e.type === "p" && words(e).includes("Entries are kept"))).toBe(false);
  });

  it("a footer note is at the end edge, and below 640px the footer's second line, under the total and the paging", () => {
    const cols: TableColumn<{ id: string }>[] = [{ key: "id", label: "ID", title: true, render: (r) => r.id }];
    const foot = (note?: string) => {
      const m = html(h(TableCard<{ id: string }>, { columns: cols, rows: [{ id: "a" }], rowKey: (r) => r.id, footer: { total: 1, noun: "events", from: 1, to: 1, note } }));
      return m.slice(m.lastIndexOf('<div class="group/foot'));
    };
    const withNote = foot("Kept for a year.");
    expect(/^<div class="([^"]+)"/.exec(withNote)?.[1].split(" ")).toEqual(expect.arrayContaining(["h-11", "max-[640px]:h-auto", "max-[640px]:flex-col"]));
    // The line: display contents from 641px, and below that its own one-line 44px row (never wrapping, so the arrows stay on it).
    expect(withNote).toContain('<div class="contents max-[640px]:flex max-[640px]:h-11 max-[640px]:items-center max-[640px]:gap-3">');
    expect(withNote).not.toContain("flex-wrap");
    const note = /<span data-table-note="" class="([^"]+)">Kept for a year\.<\/span>/.exec(withNote);
    expect(note, "the note").toBeTruthy();
    expect(note![1].split(" ")).toContain("max-[640px]:whitespace-normal");
    expect(note![1]).not.toMatch(/(^| )(max-\[640px\]:)?hidden( |$)/);
    // From 641px the note sits before the paging, at the end edge.
    expect(withNote).toMatch(/<span class="tabular-nums text-ink-2 min-\[641px\]:order-1">1 to 1<\/span><span class="inline-flex items-center min-\[641px\]:order-1">/);
    // Without one the footer is the one 44px line it always was.
    expect(/^<div class="([^"]+)"/.exec(foot())?.[1]).toBe("group/foot flex h-11 shrink-0 items-center gap-3 border-t border-line px-4 text-sm");
  });

  it("Filter > Type names each event in words, sorted as they read, the stored key only its tooltip", () => {
    state.query = "";
    state.pathname = "/settings/audit";
    const tree = treeOf(AuditLogPage, {} as never);
    const el = pageBody(tree, "all").find((e) => (e.type as { name?: string }).name === "AuditBody")!;
    // The panel open (#2) and the types read (#4).
    const types = [{ type: "org_role.changed", count: 1 }, { type: "api_key_created", count: 2 }, { type: "login", count: 9 }];
    const all = elements(withSeed([[2, true], [4, types]], () => treeOf(el.type as (p: unknown) => ReactNode, el.props)));
    const rows = all.filter((e) => (e.type as { name?: string }).name === "FilterRow" && typeof e.props.count === "number");
    expect(rows.map((r) => words(r.props.label))).toEqual(["API key created", "Logged in", "Workspace role changed"]);
    expect(rows.map((r) => (r.props.label as El).props.title)).toEqual(["api_key_created", "login", "org_role.changed"]);
    expect(rows.map((r) => r.props.count)).toEqual([2, 9, 1]);
  });

  it("an event type in words: the sign-in words My settings uses, the MCP server's own words, else the key spelled out", async () => {
    const { auditTypeWords } = await import("@/lib/audit-families");
    expect(auditTypeWords("login")).toBe("Logged in");
    expect(auditTypeWords("mfa_enabled")).toBe("Two step verification turned on");
    expect(auditTypeWords("mcp.tool.create_task")).toBe("Created a task through an AI app (MCP)");
    expect(auditTypeWords("mcp.app.connected")).toBe("Connected an AI app (MCP)");
    expect(auditTypeWords("mcp.tool.toString")).toBe("MCP tool to string");
    expect(auditTypeWords("api_key_created")).toBe("API key created");
    expect(auditTypeWords("scim_token_revoked")).toBe("SCIM token revoked");
    expect(auditTypeWords("org_role.changed")).toBe("Workspace role changed");
    expect(auditTypeWords("settings.updated.org_preferences")).toBe("Settings updated workspace preferences");
    expect(auditTypeWords("csv_exported")).toBe("CSV exported");
    expect(auditTypeWords("access.request.granted")).toBe("Access request granted");
    expect(auditTypeWords("teammateBrowser.siteChanged")).toBe("Teammate browser site changed");
    expect(auditTypeWords("")).toBe("");
  });
});

/* ───────────────────────── API & webhooks ───────────────────────── */

describe("API & webhooks", () => {
  const key = (id: string, revoked: boolean) => ({
    id, name: `Key ${id}`, prefix: `wk_${id}`, scopes: ["READ"], rateLimitPerMinute: 60, rateLimitPerDay: 10000,
    lastUsedAt: null, requestCount: 0, revokedAt: revoked ? "2026-10-01T00:00:00.000Z" : null, createdAt: "2026-09-01T00:00:00.000Z", createdBy: null,
  });
  const keysTab = () => {
    state.query = "";
    state.pathname = "/settings/api";
    const tree = treeOf(ApiSettingsPage, {} as never);
    const sp = elements(tree).find((e) => e.type === SettingsPage)!;
    const el = pageBody(tree, "keys").find((e) => (e.type as { name?: string }).name === "KeysTab")!;
    return { sp, C: el.type as (p: unknown) => ReactNode };
  };

  it("the keys tab draws its own toolbar into the header: Generate key at its right, and no primary of the page's", () => {
    const { sp, C } = keysTab();
    const tabs = sp.props.tabs as Array<{ key: string; ownToolbar?: boolean; primary?: unknown }>;
    expect(tabs[0]).toMatchObject({ key: "keys", ownToolbar: true });
    expect(tabs[0].primary).toBeUndefined();
    const bar = elements(treeOf(C, {})).find((e) => e.type === SettingsToolbar);
    expect((bar?.props.primary as { label: string }).label).toBe("Generate key");
    expect(bar?.props.left).toBeUndefined();
  });

  it("once a key is revoked, the table's footer offers Show revoked keys as a text button whose words say its state, never a checkbox", () => {
    const { C } = keysTab();
    const keys = [key("a", false), key("b", true)];
    const all = elements(withSeed([[0, keys]], () => treeOf(C, {})));
    const table = all.find((e) => e.type === TableCard)!;
    const trailing = (table.props.footer as { trailing?: ReactNode }).trailing as El;
    expect(trailing.type).toBe("button");
    expect(words(trailing)).toBe("Show revoked keys (1)");
    expect(typeof trailing.props.onClick).toBe("function");
    expect(String(trailing.props.className)).toContain("text-brand-deep");
    // Only the live key is listed until it is pressed; then both, and it says Hide.
    expect((table.props.rows as Array<{ id: string }>).map((k) => k.id)).toEqual(["a"]);
    const open = elements(withSeed([[0, keys], [2, true]], () => treeOf(C, {}))).find((e) => e.type === TableCard)!;
    expect(words((open.props.footer as { trailing?: ReactNode }).trailing)).toBe("Hide revoked keys");
    expect((open.props.rows as Array<{ id: string }>).map((k) => k.id)).toEqual(["a", "b"]);
    // The toolbar keeps Generate key alone, so it is one line on a phone.
    expect(all.find((e) => e.type === SettingsToolbar)?.props.left).toBeUndefined();
    // No checkbox on the page itself (the Generate key dialog's scope list is its own form).
    const dialogKids = new Set(all.filter((e) => (e.type as { name?: string }).name === "ConfirmDialog").flatMap((d) => elements(d.props.children)));
    expect(all.filter((e) => e.type === "input" && e.props.type === "checkbox" && !dialogKids.has(e))).toEqual([]);
    // With nothing revoked there is nothing to offer.
    const none = elements(withSeed([[0, [key("a", false)]]], () => treeOf(C, {}))).find((e) => e.type === TableCard)!;
    expect((none.props.footer as { trailing?: unknown }).trailing).toBeUndefined();
  });

  it("a failed read of the keys keeps Generate key in the toolbar, with the error in the body, and Generate key still opens its dialog (review M1)", () => {
    const { C } = keysTab();
    // The read failed (error #1), the last try's name (#4), scopes (#5) and error (#7) still held.
    const all = elements(withSeed([[1, "Service unavailable"], [3, false], [4, "Old"], [5, ["ADMIN"]], [7, "Give the key a name you will recognise."]], () => treeOf(C, {})));
    const primary = all.find((e) => e.type === SettingsToolbar)?.props.primary as { label: string; onClick: () => void };
    expect(primary.label).toBe("Generate key");
    expect(all.some((e) => (e.type as { name?: string }).name === "ErrorState")).toBe(true);
    // Pressed: the form starts afresh and the dialog opens (createOpen #3).
    primary.onClick();
    expect(state.sets).toEqual(expect.arrayContaining([[4, ""], [5, ["READ"]], [7, null], [3, true]]));
    // And the dialog is there to open: drawn on the failed read's state too.
    const opened = elements(withSeed([[1, "Service unavailable"], [3, true]], () => treeOf(C, {})));
    const dialog = opened.find((e) => (e.type as { name?: string }).name === "ConfirmDialog" && e.props.title === "Generate an API key");
    expect(dialog, "the Generate an API key dialog").toBeTruthy();
    expect(dialog!.props.open).toBe(true);
    expect(opened.some((e) => (e.type as { name?: string }).name === "ErrorState")).toBe(true);
  });

  it("a revoked key says so in its name cell where Status is out of view, its name dimmed; a live key is its plain name (review L6)", () => {
    const { C } = keysTab();
    const table = elements(withSeed([[0, [key("a", false), key("b", true)]]], () => treeOf(C, {}))).find((e) => e.type === TableCard)!;
    const name = (table.props.columns as TableColumn<ReturnType<typeof key>>[]).find((c) => c.key === "name")!;
    expect(name.render(key("a", false), 0)).toBe("Key a");
    const cell = elements(name.render(key("b", true), 1));
    expect(words(cell[0])).toBe("Key bRevoked");
    const nameSpan = cell.find((e) => words(e) === "Key b" && e.type === "span")!;
    expect(String(nameSpan.props.className)).toContain("text-ink-2");
    const tag = cell.find((e) => words(e) === "Revoked")!;
    expect(String(tag.props.className).split(" ")).toEqual(expect.arrayContaining(["text-danger-text", "min-[768px]:hidden"]));
  });

  it("Integrations is a link card, its link the card's action, on both tabs; the webhooks line is said once, in the keys table's footer, never on the AI keys tab (review L8)", () => {
    state.query = "";
    state.showUpcoming = true;
    const markup = html(h(ApiSettingsPage));
    const card = sectionById(markup, "api.integrations");
    expect(headerOf(card)).toContain('href="/integrations">Open Integrations</a>');
    expect(text(headerOf(card))).toContain("Integrations");
    expect(card).not.toContain("Coming soon: webhooks");
    expect(markup).not.toMatch(/<p class="text-sm"><a[^>]*href="\/integrations"/);
    // The AI keys tab (byok #0): no webhooks line anywhere on it.
    state.query = "tab=ai";
    const ai = withSeed([[0, true]], () => html(h(ApiSettingsPage)));
    state.query = "";
    expect(ai).toContain('id="api.integrations"');
    expect(ai).not.toContain("Coming soon: webhooks");
    // The keys tab: in its table's footer, after the total.
    const { C } = keysTab();
    const footerOf = (keys: unknown[]) => (elements(withSeed([[0, keys]], () => treeOf(C, {}))).find((e) => e.type === TableCard)!.props.footer as { extra?: ReactNode });
    const extra = footerOf([key("a", false)]).extra as El;
    expect(words(extra)).toBe("· Coming soon: webhooks, once delivery is verified end to end.");
    expect(extra.props.className).toBeUndefined();
    // With Show revoked keys beside it, a phone gives that button the room.
    expect((footerOf([key("a", false), key("b", true)]).extra as El).props.className).toBe("max-[640px]:hidden");
    state.showUpcoming = false;
    expect(footerOf([key("a", false)]).extra).toBeUndefined();
  });
});

/* ───────────────────────── Plan & billing ───────────────────────── */

describe("Plan & billing", () => {
  const summary = {
    plan: "GROWTH",
    status: "ACTIVE",
    limits: { users: 50, sops: 20, ai: 500 },
    usage: { members: 12, pendingInvites: 1, sops: 4, aiUsed: 7 },
    fromOtherWorkspaces: [],
    billingLive: false,
    portalAvailable: false,
    stripeSubscribed: false,
    upgrade: null,
  };
  const page = () => {
    state.query = "";
    state.pathname = "/settings/billing";
    return withSeed([[0, summary]], () => html(h(BillingSettingsPage)));
  };

  it("the plan name is 16/600 (no fifth size), with its 24px 12/500 status chip", () => {
    const plan = sectionById(page(), "billing.plan");
    expect(plan).toContain('<span class="text-lg font-semibold text-ink">Growth</span>');
    expect(plan).not.toContain("text-xl");
    expect(plan).toMatch(/<span class="inline-flex h-6 items-center rounded-md px-2 text-xs font-medium [^"]+">Active<\/span>/);
  });

  it("the AI questions meter says what counts on one line and opens the rest under Show more, every fact kept", async () => {
    const usage = sectionById(page(), "billing.usage");
    const { AI_METER_HINT, AI_METER_MORE } = await import("@/app/(dashboard)/settings/billing/billing-ui");
    expect(shown(usage)).toContain(AI_METER_HINT);
    // One line of the 712px column holds about 105 characters.
    expect(AI_METER_HINT.length).toBeLessThanOrEqual(105);
    expect(usage).toMatch(/<button type="button" class="[^"]*" aria-expanded="false" aria-controls="[^"]+">Show more<\/button>/);
    const more = hiddenText(usage);
    for (const fact of ["docs, files, forms, tables, whiteboards, SOPs, KRAs, meetings and the app builder", "A request that fails before the AI answers is not counted; an answer that could not be used still is.", "Suggestions nobody asked for (field suggestions and goal assessments) never count", "Fill with AI and Talk updates have their own daily limit."]) {
      expect(more).toContain(fact);
    }
    expect(AI_METER_MORE).toHaveLength(4);
    // The hint opens with what it does (review L4).
    expect(AI_METER_HINT).toBe("Counts Ask AI messages, agent runs and the AI actions people start.");
    // The seats line stays a plain one-line hint.
    expect(shown(usage)).toContain("12 people who can sign in and 1 open invitation.");
  });

  it("with Stripe billing on, the header holds the toolbar's row while the summary is read, so Upgrade or Manage billing arrives without moving the page (lead-added)", () => {
    state.query = "";
    state.pathname = "/settings/billing";
    state.billingLive = true;
    // First paint: nothing read yet.
    expect(html(h(BillingSettingsPage))).toContain('<div data-settings-toolbar-row="" class="min-h-11"></div>');
    // The read landed with a button: the toolbar is drawn and the row holds nothing more (never 88).
    const upgrade = withSeed([[0, { ...summary, billingLive: true, upgrade: { key: "growth-per-user", seats: 13 } }]], () => html(h(BillingSettingsPage)));
    expect(upgrade).toContain("Upgrade to Growth");
    expect(upgrade).toContain('<div data-settings-toolbar-row=""></div>');
    expect(upgrade).not.toContain('data-settings-toolbar-row="" class=');
    // With no button, or a failed read (#1), the row is given back.
    expect(page()).not.toContain('data-settings-toolbar-row="" class=');
    expect(withSeed([[1, "HTTP 500"]], () => html(h(BillingSettingsPage)))).not.toContain('data-settings-toolbar-row="" class=');
    // Billing handled by our team (no Stripe): no button can come, so nothing is held and nothing moves up.
    state.billingLive = false;
    expect(html(h(BillingSettingsPage))).not.toContain('data-settings-toolbar-row="" class=');
  });

  it("boot says whether Stripe billing is on, from the rule the billing service uses, and only while it is", async () => {
    const route = read("src/app/api/boot/route.ts");
    expect(route).toContain("...(billingConfigured() ? { billingLive: true } : {}),");
    expect(read("src/services/billing.ts")).toContain("export const isBillingLive = billingConfigured();");
    const { billingConfigured } = await import("@/lib/billing-live");
    const was = process.env.STRIPE_SECRET_KEY;
    try {
      delete process.env.STRIPE_SECRET_KEY;
      expect(billingConfigured()).toBe(false);
      process.env.STRIPE_SECRET_KEY = "sk_test_not_a_key";
      expect(billingConfigured()).toBe(true);
    } finally {
      if (was === undefined) delete process.env.STRIPE_SECRET_KEY;
      else process.env.STRIPE_SECRET_KEY = was;
    }
  });

  it("the AppSumo field is at most 560 wide, with Redeem beside it", () => {
    const appsumo = sectionById(page(), "billing.appsumo");
    const input = /<input id="appsumo-code"[^>]*class="([^"]+)"/.exec(appsumo)?.[1] ?? "";
    expect(input.split(" ")).toContain("max-w-[560px]");
    expect(appsumo).toContain(">Redeem</button>");
  });
});

/* ───────────────────────── All settings ───────────────────────── */

describe("All settings (both doors)", () => {
  it("the search is Overview's field: the same look and the same 480 width, in both doors", async () => {
    const { SETTINGS_SEARCH_FIELD } = await import("./settings-page");
    expect(SETTINGS_SEARCH_FIELD).toContain("max-w-[480px]");
    for (const door of ["me", "workspace"] as const) {
      const markup = html(h(AllSettingsIndex, { door }));
      expect(markup).toContain(`<label class="${SETTINGS_SEARCH_FIELD}">`);
      expect(markup).not.toContain("max-w-[560px]");
    }
    expect(read("src/app/(dashboard)/settings/overview-client.tsx")).toContain("<label className={SETTINGS_SEARCH_FIELD}>");
  });

  it("a search that finds no page says so in one line with Clear search (B10)", () => {
    const markup = withSeed([[0, "zzqqxx"]], () => html(h(AllSettingsIndex, { door: "workspace" })));
    expect(text(markup)).toContain("No pages match · Clear search");
    expect(markup).toMatch(/<button type="button" class="[^"]*">Clear search<\/button>/);
    expect(markup).not.toContain("No page matches.");
    const all = elements(withSeed([[0, "zzqqxx"]], () => treeOf(AllSettingsIndex, { door: "workspace" })));
    const clear = all.find((e) => e.type === "button" && words(e) === "Clear search");
    expect(typeof clear?.props.onClick).toBe("function");
  });

  it("a search that finds no page but does find settings says No pages match, with no Clear search over its own results (review L1)", () => {
    const markup = withSeed([[0, "idle"]], () => html(h(AllSettingsIndex, { door: "workspace" })));
    const pagesCard = markup.slice(0, markup.indexOf("Individual settings"));
    expect(text(pagesCard)).toContain("No pages match");
    expect(markup).not.toContain("Clear search");
    expect(text(markup)).toContain("Session idle time and lifetime");
  });

  it("Esc empties the search first, and only then leaves it to the page (review L9: the query is emptied)", () => {
    const input = (q: string) => elements(withSeed([[0, q]], () => treeOf(AllSettingsIndex, { door: "me" }))).find((e) => e.type === "input")!;
    const stop = vi.fn();
    (input("theme").props.onKeyDown as (e: unknown) => void)({ key: "Escape", stopPropagation: stop });
    expect(stop).toHaveBeenCalledOnce();
    expect(state.sets).toEqual([[0, ""]]);
    const idle = vi.fn();
    (input("").props.onKeyDown as (e: unknown) => void)({ key: "Escape", stopPropagation: idle });
    expect(idle).not.toHaveBeenCalled();
    expect(state.sets).toEqual([]);
  });

  it("both cards fill the page column (no wide exception), titled Pages and Individual settings", () => {
    const cards = elements(treeOf(AllSettingsIndex, { door: "workspace" })).filter((e) => e.type === SettingsCard);
    expect(cards.map((c) => c.props.title)).toEqual(["Pages", "Individual settings"]);
    for (const c of cards) expect(c.props.wide).toBeUndefined();
  });

  it("the index names Log everyone out with the row's own words (one label per destination, B12), and search still finds it by sign out", async () => {
    const { filterSettingsEntries } = await import("@/lib/settings-registry");
    expect(SETTINGS_ENTRIES["signin.signOutAll"].label).toBe("Log everyone out");
    state.query = "";
    state.sections = { security: "ready" };
    state.body = { settings: { signIn: DEFAULT_SIGN_IN_POLICY } };
    const row = sectionById(html(h(WorkspaceSecurityPage)), "signin.signOutAll");
    expect(row).toContain('<div class="text-base font-medium text-ink">Log everyone out</div>');
    expect(filterSettingsEntries("sign out", { door: "workspace", allowedExternalGates: [], guest: false }).map((e) => e.id)).toContain("signin.signOutAll");
  });

  it("the Plan and usage entry says what the meter counts: questions in total, not this month", () => {
    const e = SETTINGS_ENTRIES["billing.plan"];
    expect(e.description).toBe("Your plan, seats and the AI questions used.");
    expect(e.description).not.toMatch(/this month/);
  });
});

/* ───────────────────────── My settings ───────────────────────── */

describe("My settings: readable secondary lines (AA)", () => {
  it("Security's Showing the last N events and Profile's Not set are ink-2, never the ink-3 placeholder grey", () => {
    const security = read("src/app/(dashboard)/account/security/page.tsx");
    expect(security).toContain('<p className="mt-2 text-sm text-ink-2">Showing the last {state.events.length} events</p>');
    expect(security).not.toMatch(/text-ink-3">Showing the last/);
    const profile = read("src/app/(dashboard)/account/profile/page.tsx");
    expect(profile).toContain('if (!value) return <span className="text-base text-ink-2">Not set</span>;');
    expect(profile).not.toMatch(/text-ink-3">Not set/);
  });
});

/* ───────────────────────── Integrations ───────────────────────── */

describe("Integrations", () => {
  it("both card grids fit a phone: a track never wider than the column (minmax(min(300px,100%),1fr)), as Marketplace's", () => {
    const src = read("src/app/(dashboard)/integrations/page.tsx");
    expect(src.match(/minmax\(min\(300px,100%\),1fr\)/g)).toHaveLength(2);
    expect(src).not.toContain("minmax(300px,1fr)");
  });
});
