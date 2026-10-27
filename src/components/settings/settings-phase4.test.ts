// Settings clean-up Phase 4 (docs/plans/settings-cleanup.md D Phase 4, B2,
// B4, B8, B10): Members (People, Guests, Teams, Pending invites) and
// Structure (Departments, Job titles, Offices, Profile fields, Org chart).
// Each page or part is rendered to static markup with its shell, boot and
// reads stubbed, so what is asserted is what the browser receives on first
// paint: the toolbar is in the header stack (its 44px row held there for a
// tab whose content draws it), nothing toolbar-like is left in the content,
// every block is a SettingsCard, empty states are the inline line or the
// quiet empty state, and the Sort chip is a menu button, never a select.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createElement as h, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({ query: "", role: "ADMIN" as "OWNER" | "ADMIN" | "MEMBER" }));

// SettingsPage waits for ?tab= inside a Suspense boundary, and a server render
// that throws inside one quietly draws its fallback (the title alone). Here it
// is a pass-through, so a page that cannot render fails the test instead.
vi.mock("react", async (importOriginal) => {
  const real = await importOriginal<typeof import("react")>();
  return { ...real, Suspense: ({ children }: { children?: import("react").ReactNode }) => children };
});
vi.mock("next/navigation", () => ({
  usePathname: () => "/settings/members",
  useRouter: () => ({ replace: () => {}, push: () => {}, back: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(state.query),
}));
vi.mock("@/components/ui/dialog-provider", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/ui/dialog-provider")>();
  return { ...real, useConfirm: () => async () => false, usePrompt: () => async () => null };
});
vi.mock("@/components/layout/os/boot-context", () => ({
  useBoot: () => ({ boot: { viewer: { id: "me", orgRole: state.role, isAgent: false, adminScopes: [] }, org: { objectShare: false, inboxAutoClears: false } } }),
  useViewerRole: () => ({
    orgRole: state.role,
    isOwner: state.role === "OWNER",
    isAdmin: state.role === "OWNER" || state.role === "ADMIN",
    isGuest: false,
  }),
}));
vi.mock("@/components/layout/os/shell-context", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/layout/os/shell-context")>();
  return { ...real, useOsShell: () => ({ rowVersion: () => 0, bumpRowVersion: () => {}, prefs: { home: { locale: {} } } }) };
});
vi.mock("@/components/layout/os/toast", () => ({ useOsToast: () => ({ toast: () => {} }) }));
vi.mock("@/lib/access/use-legacy-permissions", () => ({ useRole: () => ({ canInvite: false }) }));
vi.mock("@/components/layout/os/invite-modal", () => ({ InviteModal: () => null }));
vi.mock("@/components/ui/coming-soon-row", () => ({ useShowUpcoming: () => false, UpcomingOnly: () => null, ComingSoonRow: () => null }));
// The portal a tab's own toolbar is drawn through, drawn inline for a row the
// test hands it (a plain object marked __testSlot), so what is drawn INTO the
// header row is visible in the markup (Phase 4 review, L2). Any other
// container keeps the real createPortal.
vi.mock("react-dom", async (importOriginal) => {
  const real = await importOriginal<typeof import("react-dom")>();
  const { createElement } = await import("react");
  return {
    ...real,
    createPortal: (node: import("react").ReactNode, container: unknown, key?: string | null) =>
      container && typeof container === "object" && "__testSlot" in container
        ? createElement("div", { "data-test-portal": String((container as { __testSlot: string }).__testSlot) }, node)
        : real.createPortal(node, container as Element, key),
  };
});
// Every Picker drawn, with the props it was given, so a closed one (the Sort
// chip's) can be asked what it was told (Phase 4 review, L6). It still draws.
const pickers = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("@/components/ui/picker", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/ui/picker")>();
  const { createElement } = await import("react");
  return { ...real, Picker: (props: import("@/components/ui/picker").PickerProps) => { pickers.push(props as unknown as Record<string, unknown>); return createElement(real.Picker, props); } };
});
vi.mock("@/hooks/use-settings-section", () => ({
  useSettingsSection: () => ({
    status: "ready",
    error: null,
    retry: () => {},
    save: async () => ({ ok: true }),
    data: { allowedDomains: [], autoJoin: false, inviteDefaultRole: "MEMBER", defaultSpaceIds: [], inviteExpiryDays: 7 },
  }),
}));

import MembersPage from "@/app/(dashboard)/settings/members/page";
import { BULK_ROLE_BODY, BulkRoleFields, PEOPLE_TOOLBAR_ROW, PendingRowActions, bulkTierHelper, countsReadNeeded, membersTabs, pendingRowMenuWidth } from "@/app/(dashboard)/settings/members/members-shared";
import { TeamCard, TeamsCard, TEAMS_INTRO, leadSwitchId, leadSwitchName, peopleCount, type Team } from "@/app/(dashboard)/settings/members/teams-tab";
import { JOB_TITLES_NOTE, OrgChartCard, RoleStrip, STRUCTURE_TOOLBAR_ROW, StructureClient, structureTabs } from "@/app/(dashboard)/settings/structure/structure-client";
import { PRIMARY_GREY_DISABLED, PROFILE_FIELDS_INTRO, ProfileFieldsCard } from "@/components/people/profile-fields-manager";
import { DepartmentsManager } from "@/components/people/departments-manager";
import { JobTitlesList } from "@/components/people/job-titles-list";
import { OsToolbar, sortChipName } from "@/components/layout/os/page-header/page-header";
import { SETTINGS_TOOLBAR_ROW, SettingsPage, SettingsToolbar, ToolbarSlot, settingsToolbarPlace, settingsToolbarRow } from "./settings-page";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { Picker } from "@/components/ui/picker";
import { Switch } from "@/components/ui/switch";
import { AGENT_TIER_BLURB } from "@/lib/access/labels";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
function page(Page: ComponentType, query = ""): string {
  state.query = query;
  return html(h(Page));
}
const text = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&#x27;|&apos;/g, "'").replace(/&amp;/g, "&");
/** The page's header stack and everything after it. */
function split(s: string): { head: string; body: string } {
  const end = s.indexOf("</header>");
  expect(end).toBeGreaterThan(0);
  return { head: s.slice(s.indexOf("<header data-settings-head"), end), body: s.slice(end) };
}
/** The opening tag of the first element whose opening tag matches. */
const openTag = (s: string, re: RegExp) => re.exec(s)?.[0] ?? "";

const team = (n: number, leadAt = -1): Team => ({
  id: "t1",
  name: "Design",
  description: null,
  members: Array.from({ length: n }, (_, i) => ({ id: `u${i}`, firstName: `Person${i}`, lastName: "Test", email: `p${i}@x.test`, avatar: null, lead: i === leadAt })),
});

describe("the Sort chip (B8: a chip at the left, never a select)", () => {
  const opts = [{ value: "a", label: "Name A to Z" }, { value: "b", label: "Role" }];

  it("opens its own orders: a menu button with its list closed, not a pressed toggle", () => {
    const s = html(h(OsToolbar, { sort: { label: "Sort", options: opts, value: "a", onChange: () => {} } }));
    const btn = openTag(s, /<button[^>]*aria-haspopup="listbox"[^>]*>/);
    expect(btn).toContain('aria-expanded="false"');
    expect(btn).not.toContain("aria-pressed");
    expect(text(s)).toContain("Sort");
    expect(s).not.toContain("<select");
  });

  it("is named by its visible words first, then what it is", () => {
    expect(sortChipName("Sort")).toBeUndefined();
    expect(sortChipName("Role")).toBe("Role, sort order");
    const s = html(h(OsToolbar, { sort: { label: "Role", active: true, options: opts, value: "b", onChange: () => {} } }));
    expect(openTag(s, /<button[^>]*aria-haspopup="listbox"[^>]*>/)).toContain('aria-label="Role, sort order"');
  });
});

describe("a tab's own toolbar lives in the header stack (SettingsToolbar)", () => {
  it("draws into the header once the page has given it a row, waits for it, or stays inline outside any page", () => {
    expect(settingsToolbarPlace(undefined)).toBe("inline");
    expect(settingsToolbarPlace(null)).toBe("wait");
    expect(settingsToolbarPlace({} as Element)).toBe("header");
  });

  it("holds the 44px row inside the header for that tab only, and nothing of the toolbar reaches the content", () => {
    const tabs = [{ key: "one", label: "One", ownToolbar: true }, { key: "two", label: "Two" }];
    const body = (t: string | null) => h("div", null, `Body ${t}`, h(SettingsToolbar, { left: h("span", null, "OwnSearch") }));
    state.query = "tab=one";
    const one = split(html(h(SettingsPage, { pageKey: "members", tabs, width: "list", children: body })));
    expect(openTag(one.head, /<div[^>]*data-settings-toolbar-row=""[^>]*>/)).toContain(SETTINGS_TOOLBAR_ROW);
    expect(one.body).not.toContain("OwnSearch");
    expect(one.body).not.toContain("os-toolbar");
    state.query = "tab=two";
    const two = split(html(h(SettingsPage, { pageKey: "members", tabs, width: "list", children: body })));
    expect(openTag(two.head, /<div[^>]*data-settings-toolbar-row=""[^>]*>/)).not.toContain(SETTINGS_TOOLBAR_ROW);
  });

  it("is drawn inline, with no gutter of its own, outside a SettingsPage", () => {
    const s = html(h(SettingsToolbar, { left: h("span", null, "Inline") }));
    expect(s).toContain("os-toolbar");
    expect(s).toContain("!px-0");
    expect(s).toContain("Inline");
  });

  it("puts a tab's secondary control at the toolbar's right, in the header", () => {
    state.query = "";
    const s = html(h(SettingsPage, { pageKey: "members", tabs: [{ key: "a", label: "A", right: h("button", { type: "button" }, "Second") }, { key: "b", label: "B" }], width: "list", children: "x" }));
    expect(split(s).head).toContain(">Second</button>");
  });
});

describe("Members", () => {
  it("People draws its own toolbar, Pending carries Invite people as a secondary control, for those who manage invites", () => {
    const tabs = membersTabs(true, () => {});
    expect(tabs.map((t) => t.key)).toEqual(["people", "guests", "teams", "pending"]);
    expect(tabs.find((t) => t.key === "people")?.ownToolbar).toBe(true);
    const right = html(h("div", null, tabs.find((t) => t.key === "pending")?.right));
    expect(right).toContain(">Invite people</button>");
    expect(right).not.toContain("bg-brand");
    expect(right).toContain("h-9");
    expect(membersTabs(false, () => {}).find((t) => t.key === "pending")?.right).toBeUndefined();
  });

  it("People: search, Filter and Sort are not in the content; the header holds their row", () => {
    const { head, body } = split(page(MembersPage, "tab=people"));
    expect(body).not.toContain("Search people");
    expect(body).not.toContain("os-toolbar");
    expect(body).not.toContain('aria-label="Sort"');
    expect(openTag(head, /<div[^>]*data-settings-toolbar-row=""[^>]*>/)).toContain("min-h-11");
  });

  it("Pending: Invite people is in the header's toolbar, never floating over the table", () => {
    const { head, body } = split(page(MembersPage, "tab=pending"));
    expect(head).toContain(">Invite people</button>");
    expect(body).not.toContain('<div class="flex justify-end">');
    // Invite rules is a full-width card, 24px above the table.
    expect(body).toContain('<div id="pending-invites" class="flex flex-col gap-6">');
    expect(openTag(body, /<section id="members\.inviteRules"[^>]*>/)).toContain("w-full");
  });

  it("Guests: the quiet empty state (B10), not a bordered card with a tile", () => {
    const { body } = split(page(MembersPage, "tab=guests"));
    expect(body).toContain("os-empty");
    expect(text(body)).toContain("No guests yet");
    expect(text(body)).toContain("inviting someone to a Space by email today creates a member account.");
    expect(body).not.toMatch(/<section class="flex max-w-\[760px\][^"]*rounded-lg border/);
  });

  it("the count strip's numbers are read on every tab: by People's list, else once by the tab itself", () => {
    for (const t of ["guests", "teams", "pending"]) expect(countsReadNeeded(t, false), t).toBe(true);
    for (const t of ["guests", "teams", "pending"]) expect(countsReadNeeded(t, true), t).toBe(false);
    expect(countsReadNeeded("people", false)).toBe(false);
    expect(countsReadNeeded(null, false)).toBe(false);
  });
});

describe("Members > Teams (list width, SettingsCard rows)", () => {
  it("the first card says what a team is and keeps the New team name field to its 560px", () => {
    const s = html(h(TeamsCard, { canEdit: true, empty: true, onMade: () => {} }));
    expect(s).toMatch(/^<section class="w-full [^"]* p-6 /);
    expect(s).not.toContain("max-w-[760px]");
    expect(text(/<header[\s\S]*?<\/header>/.exec(s)?.[0] ?? "")).toContain(TEAMS_INTRO);
    expect(openTag(s, /<form[^>]*>/)).toContain("max-w-[560px]");
    expect(s).toContain('aria-label="New team name"');
    expect(text(s)).toContain("No teams yet · Name one");
  });

  it("a reader sees the card without the field or the link", () => {
    const s = html(h(TeamsCard, { canEdit: false, empty: true, onMade: () => {} }));
    expect(s).not.toContain("New team name");
    expect(text(s)).toContain("No teams yet");
    expect(text(s)).not.toContain("Name one");
  });

  it("a team is a SettingsCard: its name the title, its size the line under it, its actions ghost buttons, each person a row", () => {
    const s = html(h(TeamCard, { team: team(2, 0), canEdit: true, onChanged: () => {} }));
    expect(s).toMatch(/^<section class="w-full [^"]* p-6 /);
    expect(s).toContain(">Design</h2>");
    expect(text(/<header[\s\S]*?<\/header>/.exec(s)?.[0] ?? "")).toContain(peopleCount(2));
    for (const a of ["Rename Design", "Archive Design"]) expect(openTag(s, new RegExp(`<button[^>]*aria-label="${a}"[^>]*>`))).toContain("os-btn-ghost");
    expect(s.match(/data-settings-row=""/g)).toHaveLength(2);
    // Lead is a switch named by its visible word first, never a bare checkbox.
    expect(s).not.toContain('type="checkbox"');
    expect(openTag(s, new RegExp(`<button[^>]*aria-label="${leadSwitchName("Person0 Test")}"[^>]*>`))).toContain('aria-checked="true"');
    expect(openTag(s, new RegExp(`<button[^>]*aria-label="${leadSwitchName("Person1 Test")}"[^>]*>`))).toContain('aria-checked="false"');
    expect(text(s)).toContain("Add people");
  });

  it("an empty team is one inline line whose action is Add people", () => {
    const s = html(h(TeamCard, { team: team(0), canEdit: true, onChanged: () => {} }));
    expect(text(s)).toContain("No people in this team yet · Add people");
    expect(s).not.toContain("Nobody yet.");
    expect(text(/<header[\s\S]*?<\/header>/.exec(s)?.[0] ?? "")).toContain("0 people");
  });
});

describe("Structure", () => {
  it("Departments and Job titles draw their own toolbar; Offices hands New office to the header for an editor", () => {
    const tabs = structureTabs(true, () => {});
    expect(tabs.filter((t) => t.ownToolbar).map((t) => t.key)).toEqual(["departments", "titles"]);
    expect(tabs.find((t) => t.key === "offices")?.primary?.label).toBe("New office");
    expect(structureTabs(false, () => {}).find((t) => t.key === "offices")?.primary).toBeUndefined();
  });

  it("the role strip is the first thing in the body, on every tab, as a card", () => {
    for (const tab of ["offices", "chart", "fields"]) {
      state.query = `tab=${tab}`;
      const { body } = split(html(h(StructureClient, { counts: { owners: 1, admins: 2, members: 3, guests: 0, peopleTeam: 1 }, unlinked: 4, canEdit: true })));
      const firstCard = body.indexOf("<section");
      expect(firstCard, tab).toBeGreaterThan(0);
      expect(body.slice(firstCard, body.indexOf("</section>", firstCard)), tab).toContain('aria-label="Roles"');
    }
  });

  it("the role strip is a SettingsCard at the page's width, its counters one line each from 1000px", () => {
    const s = html(h(RoleStrip, { counts: { owners: 1, admins: 2, members: 3, guests: 0, peopleTeam: 1 } }));
    expect(s).toMatch(/^<section class="w-full [^"]* p-6 /);
    const group = openTag(s, /<div role="group" aria-label="Roles"[^>]*>/);
    expect(group).toContain("min-[1000px]:grid-flow-col");
    expect(group).toContain("grid-cols-2");
    expect(text(s)).toContain("How access works");
  });

  it("Job titles' caption is the strip's last line on that tab, never a line floating over the table", () => {
    const s = html(h(RoleStrip, { counts: { owners: 1, admins: 2, members: 3, guests: 0, peopleTeam: 1 }, note: JOB_TITLES_NOTE }));
    expect(s.indexOf(JOB_TITLES_NOTE)).toBeGreaterThan(s.indexOf("How access works"));
    expect(s.indexOf(JOB_TITLES_NOTE)).toBeLessThan(s.lastIndexOf("</section>"));
    const inline = html(h(JobTitlesList, { door: "settings" }));
    expect(inline).not.toContain(JOB_TITLES_NOTE);
  });

  it("Org chart is a link card: a title, one line, the link, no illustration", () => {
    const s = html(h(OrgChartCard, { unlinked: 4 }));
    expect(s).toMatch(/^<section class="w-full [^"]* p-6 /);
    expect(s).toContain(">Org chart</h2>");
    expect(s).not.toContain("max-w-[760px]");
    expect(s).not.toContain("<svg");
    expect(text(s)).toContain("Open the org chart");
    expect(text(s)).toContain("No manager: 4 people · fix in Members");
  });

  it("Departments and Job titles: the Sort chip opens their orders, and in a page the toolbar leaves the content", () => {
    for (const Manager of [DepartmentsManager, JobTitlesList]) {
      // Outside a page (no header row) it is drawn inline: the chip is a menu button.
      const inline = html(h(Manager, { door: "settings" }));
      expect(openTag(inline, /<button[^>]*aria-haspopup="listbox"[^>]*>/), Manager.name).toContain('aria-expanded="false"');
      expect(inline, Manager.name).not.toContain("start-[110px]");
      // In a page, the toolbar is in the header row, not the content.
      state.query = "tab=one";
      const { body } = split(html(h(SettingsPage, { pageKey: "structure", width: "list", tabs: [{ key: "one", label: "One", ownToolbar: true }, { key: "two", label: "Two" }], children: () => h(Manager, { door: "settings" }) })));
      expect(body, Manager.name).not.toContain("os-toolbar");
    }
  });
});

describe("Structure > Profile fields (one width, no indent, a grey disabled primary)", () => {
  const props = { save: "idle" as const, draft: "", onDraft: () => {}, onAdd: () => {}, onRename: () => {}, onMove: () => {}, onRemove: () => {} };

  it("is one SettingsCard at the page's width, with no indent", () => {
    const s = html(h(ProfileFieldsCard, { ...props, fields: [], canEdit: true }));
    expect(s).toMatch(/^<section class="w-full [^"]* p-6 /);
    expect(s).not.toContain("max-w-2xl");
    expect(s).not.toContain("px-6");
    expect(s).toContain(">Profile fields</h2>");
    expect(text(/<header[\s\S]*?<\/header>/.exec(s)?.[0] ?? "")).toContain(PROFILE_FIELDS_INTRO);
  });

  it("with no fields, one inline line (B10), not a bordered box", () => {
    const s = html(h(ProfileFieldsCard, { ...props, fields: [], canEdit: true }));
    expect(text(s)).toContain("No profile fields yet · Add one");
    expect(s).not.toMatch(/<p class="rounded-lg border[^"]*">No profile fields yet/);
  });

  it("Add field is grey while there is nothing to add, never a pale blue, and the field keeps its 560px", () => {
    const s = html(h(ProfileFieldsCard, { ...props, fields: [], canEdit: true }));
    const add = openTag(s, /<button[^>]*disabled=""[^>]*>(?=<svg[^]*?Add field)/);
    expect(add).toContain("disabled:bg-active");
    expect(add).toContain("disabled:text-ink-4");
    expect(add).not.toContain("disabled:opacity-50");
    expect(PRIMARY_GREY_DISABLED).toContain("disabled:opacity-100");
    expect(s).toMatch(/<div class="flex w-full max-w-\[560px\][^"]*"><input[^>]*aria-label="New field name"/);
  });

  it("each field is a SettingsRow; a reader sees the names with no controls", () => {
    const fields = [{ key: "emp", label: "Employee ID" }, { key: "pro", label: "Pronouns" }];
    const edit = html(h(ProfileFieldsCard, { ...props, fields, canEdit: true }));
    expect(edit.match(/data-settings-row=""/g)).toHaveLength(2);
    expect(edit).toContain('aria-label="Remove Pronouns"');
    const read = html(h(ProfileFieldsCard, { ...props, fields, canEdit: false }));
    expect(read.match(/data-settings-row=""/g)).toHaveLength(2);
    expect(read).not.toContain("Remove Pronouns");
    expect(read).not.toContain("New field name");
  });
});

/* ───────────── Phase 4 review fixes (settings-p4-review.md: M1, L1 to L9) ───────────── */

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
/** The source without its comments, so a rule is held by the code, not by what a comment says. */
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const MEMBERS = code(src("src/app/(dashboard)/settings/members/page.tsx"));
/** The body of the function `name` in `s`, from its declaration to the next top-level function. */
const fnBody = (s: string, name: string) => {
  const at = s.indexOf(`function ${name}(`);
  expect(at, name).toBeGreaterThan(0);
  const next = s.slice(at + 10).search(/\n(export )?(default )?function /);
  return next < 0 ? s.slice(at) : s.slice(at, at + 10 + next);
};
/** A header row a test hands SettingsToolbar; the mocked createPortal draws into it inline. */
const slot = (name = "row") => ({ __testSlot: name }) as unknown as HTMLElement;
/** What the mocked portal drew into the test's row, and everything else. */
function portal(s: string): { inRow: string; rest: string } {
  const at = s.indexOf("<div data-test-portal=");
  if (at < 0) return { inRow: "", rest: s };
  // The portal div holds the toolbar, itself one div: the portal ends at the toolbar's own close plus its own.
  let depth = 0;
  let i = at;
  for (const m of s.slice(at).matchAll(/<div\b|<\/div>/g)) {
    depth += m[0] === "</div>" ? -1 : 1;
    i = at + (m.index ?? 0) + m[0].length;
    if (depth === 0) break;
  }
  return { inRow: s.slice(at, i), rest: s.slice(0, at) + s.slice(i) };
}
/**
 * The min-height a reserved-row class string gives at a viewport width (Tailwind v4: `max-[Npx]:` is width < N,
 * and the narrowest breakpoint that applies wins; `min-h-11` is the 44px base).
 */
function reservedAt(cls: string, width: number): number {
  let h = /(^|\s)min-h-11(\s|$)/.test(cls) ? 44 : 0;
  let best = Infinity;
  for (const m of cls.matchAll(/max-\[(\d+)px\]:min-h-\[(\d+)px\]/g)) {
    const n = Number(m[1]);
    if (width < n && n < best) { best = n; h = Number(m[2]); }
  }
  return h;
}

describe("M1: the Guests consequence line is readable (ink-2, not the ink-3 guidance tone)", () => {
  it("Guests draws its line at ink-2", () => {
    const { body } = split(page(MembersPage, "tab=guests"));
    const line = openTag(body, /<p class="[^"]*"(?=>Guests are people outside your company)/);
    expect(line).toContain("text-ink-2");
    expect(line).not.toContain("text-ink-3");
  });

  it("OsEmptyView's hint stays the quiet ink-3 unless a page asks for the plain tone", () => {
    expect(html(h(OsEmptyView, { title: "No x yet", hint: "Guidance" }))).toContain('<p class="m-0 mt-1 text-sm text-ink-3">Guidance</p>');
    expect(html(h(OsEmptyView, { title: "No x yet", hint: "Consequence", hintTone: "plain" }))).toContain('<p class="m-0 mt-1 text-sm text-ink-2">Consequence</p>');
  });
});

describe("L1: Pending's row actions fold into one \"...\" below 640, so Role stays readable", () => {
  it("the pinned cell is 170 for Resend and Revoke, 44 for the one \"...\" on a phone or for a reader", () => {
    expect(pendingRowMenuWidth(true, false)).toBe(170);
    expect(pendingRowMenuWidth(true, true)).toBe(44);
    expect(pendingRowMenuWidth(false, false)).toBe(44);
  });

  it("on a phone a row has one \"...\" menu button named for its invitation, not two buttons", () => {
    const props = { email: "a@x.test", busy: false, menuOpen: false, onResend: () => {}, onRevoke: () => {}, onMenu: () => {} };
    const phone = html(h(PendingRowActions, { ...props, phone: true }));
    expect(phone.match(/<button/g)).toHaveLength(1);
    expect(openTag(phone, /<button[^>]*>/)).toContain('aria-haspopup="menu"');
    expect(openTag(phone, /<button[^>]*>/)).toContain('aria-label="Actions for a@x.test"');
    expect(text(phone)).not.toContain("Resend");
    const wide = html(h(PendingRowActions, { ...props, phone: false }));
    expect(text(wide)).toContain("Resend");
    expect(text(wide)).toContain("Revoke");
    expect(wide).not.toContain('aria-haspopup="menu"');
  });

  it("Pending opens the menu as MenuItem rows, picks its width by the phone query, and titles the email cell", () => {
    const pending = fnBody(MEMBERS, "PendingTab");
    expect(MEMBERS).toContain('const PHONE_ROWS = "(width < 640px)";');
    expect(pending).toContain("rowMenuWidth={pendingRowMenuWidth(canManageInvites, phone)}");
    expect(pending).toMatch(/<MorePortal\b[\s\S]*?>\s*<MenuList keyboard[^>]*>\s*<MenuItem icon=\{RotateCw\} label="Resend"[\s\S]*?<MenuItem icon=\{Trash2\} label="Revoke" destructive/);
    expect(pending).toContain('render: (i) => <span className="block truncate" title={i.email}>{i.email}</span>');
    // 160, not 220, at the least: at 390 the card is 294 wide and 220 put the pinned cell over Role (measured live).
    expect(pending).toContain('{ key: "email", label: "Email", title: true, width: "minmax(160px,1.6fr)"');
  });
});

describe("L2: a tab's own toolbar is seen where it is drawn, in the header row", () => {
  // The server never has the row (it is set from its ref), so the page-level renders above see nothing of a tab's
  // toolbar; here the row is handed in (ToolbarSlot), and the page's own wiring of that row is read from its source.
  it("SettingsToolbar draws into the row it is handed, with the page gutter, and nothing while there is none; the page hands it its row and People draws its whole toolbar there", () => {
    const drawn = portal(html(h(ToolbarSlot.Provider, { value: slot("head") }, h("div", null, "Body", h(SettingsToolbar, { left: h("span", null, "OwnSearch") })))));
    expect(drawn.inRow).toContain('data-test-portal="head"');
    expect(drawn.inRow).toContain("os-toolbar");
    expect(drawn.inRow).toContain("px-[24px]");
    expect(drawn.inRow).toContain("OwnSearch");
    expect(drawn.rest).not.toContain("OwnSearch");
    expect(html(h(ToolbarSlot.Provider, { value: null }, h(SettingsToolbar, { left: h("span", null, "OwnSearch") })))).toBe("");
    // The page: its header row is the one handed down, and the body sits inside that row's provider.
    const sp = code(src("src/components/settings/settings-page.tsx"));
    const inner = fnBody(sp, "SettingsPageInner");
    expect(inner).toContain("onToolbarRow={setSlot}");
    expect(inner).toMatch(/<ToolbarSlot\.Provider value=\{slot\}>\s*<div className=\{cn\("mt-4", GUTTER\)\}>[\s\S]*?\{body\}/);
    // People (its tab lives in the page file, so it is read, not rendered): search, Filter, Sort, Invite and "..." are one SettingsToolbar.
    const people = fnBody(MEMBERS, "PeopleTab");
    const tb = people.slice(people.indexOf("<SettingsToolbar"), people.indexOf("/>", people.indexOf("menu={[")) + 2);
    for (const part of ['placeholder="Search people"', "filter={{", "sort={{", 'primary={canInvite ? { label: "Invite", onClick: onInvite } : undefined}', '"Export members (CSV)"']) expect(tb, part).toContain(part);
  });

  it("Departments and Job titles: Filter and the Sort chip are drawn into the row, and none of it is left in the content", () => {
    for (const Manager of [DepartmentsManager, JobTitlesList]) {
      const { inRow, rest } = portal(html(h(ToolbarSlot.Provider, { value: slot() }, h(Manager, { door: "settings" }))));
      expect(inRow, Manager.name).toContain(">Filter</button>");
      expect(openTag(inRow, /<button[^>]*aria-haspopup="listbox"[^>]*>/), Manager.name).toContain('aria-expanded="false"');
      expect(rest, Manager.name).not.toContain("os-toolbar");
    }
  });

});

describe("L3: the header holds each tab's toolbar row at the height it really takes, per breakpoint", () => {
  it("the row is the tab's measured heights, the one line's 44px by default, nothing for a tab without its own toolbar", () => {
    expect(settingsToolbarRow(null)).toBeUndefined();
    expect(settingsToolbarRow({ ownToolbar: false, toolbarRow: "min-h-11" })).toBeUndefined();
    expect(settingsToolbarRow({ ownToolbar: true })).toBe(SETTINGS_TOOLBAR_ROW);
    expect(settingsToolbarRow({ ownToolbar: true, toolbarRow: PEOPLE_TOOLBAR_ROW.invite })).toBe(PEOPLE_TOOLBAR_ROW.invite);
  });

  it("the header draws the active tab's classes on its row", () => {
    state.query = "tab=one";
    const tabs = [{ key: "one", label: "One", ownToolbar: true, toolbarRow: "min-h-11 max-[500px]:min-h-[88px]" }, { key: "two", label: "Two" }];
    const { head } = split(html(h(SettingsPage, { pageKey: "members", tabs, width: "list", children: "x" })));
    expect(openTag(head, /<div[^>]*data-settings-toolbar-row=""[^>]*>/)).toContain('class="min-h-11 max-[500px]:min-h-[88px]"');
  });

  it("People holds the toolbar its viewer gets: with Invite for whoever manages invites, else without", () => {
    expect(membersTabs(true, () => {}).find((t) => t.key === "people")?.toolbarRow).toBe(PEOPLE_TOOLBAR_ROW.invite);
    expect(membersTabs(false, () => {}).find((t) => t.key === "people")?.toolbarRow).toBe(PEOPLE_TOOLBAR_ROW.noInvite);
    const { head } = split(page(MembersPage, "tab=people"));
    // The page's viewer here is an Admin (boot), who invites.
    expect(openTag(head, /<div[^>]*data-settings-toolbar-row=""[^>]*>/)).toContain(`class="${PEOPLE_TOOLBAR_ROW.invite}"`);
  });

  it("Structure holds Departments' and Job titles' rows for an editor or a reader", () => {
    const edit = structureTabs(true, () => {});
    const read = structureTabs(false, () => {});
    expect(edit.find((t) => t.key === "departments")?.toolbarRow).toBe(STRUCTURE_TOOLBAR_ROW.departments.edit);
    expect(edit.find((t) => t.key === "titles")?.toolbarRow).toBe(STRUCTURE_TOOLBAR_ROW.titles.edit);
    expect(read.find((t) => t.key === "departments")?.toolbarRow).toBe(STRUCTURE_TOOLBAR_ROW.departments.read);
    expect(read.find((t) => t.key === "titles")?.toolbarRow).toBe(STRUCTURE_TOOLBAR_ROW.titles.read);
  });

  it("the heights are the toolbars' own, measured at 1px steps from 300 to 960 (rail included)", () => {
    // [width, height] at each band's first width, as the live sweep found them (after-p4f/probe).
    const bands: Array<[string, string, Array<[number, number]>]> = [
      ["People, Invite", PEOPLE_TOOLBAR_ROW.invite, [[300, 132], [549, 132], [550, 88], [686, 88], [687, 44], [1440, 44]]],
      ["People, no Invite", PEOPLE_TOOLBAR_ROW.noInvite, [[300, 132], [550, 88], [593, 88], [594, 44]]],
      ["Departments, New", STRUCTURE_TOOLBAR_ROW.departments.edit, [[300, 128], [352, 128], [353, 88], [564, 88], [565, 44], [1440, 44]]],
      ["Departments, no New", STRUCTURE_TOOLBAR_ROW.departments.read, [[300, 128], [353, 88], [396, 88], [397, 44]]],
      ["Job titles, New", STRUCTURE_TOOLBAR_ROW.titles.edit, [[300, 88], [444, 88], [445, 44], [1440, 44]]],
      ["Job titles, no New", STRUCTURE_TOOLBAR_ROW.titles.read, [[300, 88], [305, 88], [306, 44]]],
    ];
    for (const [name, cls, pts] of bands) for (const [w, hgt] of pts) expect(reservedAt(cls, w), `${name} at ${w}`).toBe(hgt);
    // The two widths the phase is checked at: a 390 phone and a 1440 desktop.
    expect([PEOPLE_TOOLBAR_ROW.invite, STRUCTURE_TOOLBAR_ROW.departments.edit, STRUCTURE_TOOLBAR_ROW.titles.edit].map((c) => [reservedAt(c, 390), reservedAt(c, 1440)])).toEqual([[132, 44], [88, 44], [88, 44]]);
  });
});

describe("L4: a sent invite shows on Pending at once (no second invite to the same person)", () => {
  it("the page hands Pending the sent-invite signal, and Pending reads its list again on it", () => {
    expect(MEMBERS).toContain("<PendingTab canEdit={canEdit} canManageInvites={canManageInvites} onInvite={() => setInviteOpen(true)} inviteSignal={inviteSignal} />");
    expect(MEMBERS).toContain("onSent={() => setInviteSignal((n) => n + 1)}");
    const pending = fnBody(MEMBERS, "PendingTab");
    expect(pending).toMatch(/^function PendingTab\(\{[^}]*\binviteSignal\b[^}]*\}: \{[^}]*inviteSignal: number[^}]*\}\)/);
    expect(pending).toMatch(/useEffect\(\(\) => \{\s+const t = setTimeout\(\(\) => \{ void load\(\); \}, 0\);\s+return \(\) => clearTimeout\(t\);\s+\}, \[load, inviteSignal\]\);/);
  });
});

describe("L5: bulk Change role says what Agent means and opens Tier with room to read it", () => {
  const value = (role: "ADMIN" | "MEMBER", tier = "EMPLOYEE") => ({ role, tier });

  it("Agent's consequence is under Tier, the drawer's own words; no other tier has a line", () => {
    expect(bulkTierHelper("AGENT")).toBe(AGENT_TIER_BLURB);
    expect(bulkTierHelper("MANAGER")).toBeUndefined();
    const agent = html(h(BulkRoleFields, { value: value("MEMBER", "AGENT"), onChange: () => {} }));
    const t = text(agent);
    expect(t.indexOf(AGENT_TIER_BLURB)).toBeGreaterThan(t.indexOf("Tier"));
    expect(t.indexOf(AGENT_TIER_BLURB)).toBeLessThan(t.indexOf("Each person is checked on their own"));
    expect(text(html(h(BulkRoleFields, { value: value("MEMBER", "MANAGER"), onChange: () => {} })))).not.toContain(AGENT_TIER_BLURB);
  });

  it("while Tier shows, the body holds the height that lets its list open about six rows deep; Admin has no Tier and no hold", () => {
    expect(BULK_ROLE_BODY).toBe("min-h-[312px]");
    expect(openTag(html(h(BulkRoleFields, { value: value("MEMBER"), onChange: () => {} })), /<div data-bulk-role-body=""[^>]*>/)).toContain(BULK_ROLE_BODY);
    const admin = html(h(BulkRoleFields, { value: value("ADMIN"), onChange: () => {} }));
    expect(openTag(admin, /<div data-bulk-role-body=""[^>]*>/)).not.toContain(BULK_ROLE_BODY);
    expect(text(admin)).not.toContain("Tier");
  });

  it("the People tab draws these fields in its Change role dialog", () => {
    expect(fnBody(MEMBERS, "PeopleTab")).toContain("{bulkRole ? <BulkRoleFields value={bulkRole} onChange={setBulkRole} /> : null}");
  });
});

describe("L6: a short fixed list has no search box (the Picker's noSearch), and the Sort chip uses it", () => {
  const opts = Array.from({ length: 7 }, (_, i) => ({ value: `v${i}`, label: `Order ${i}` }));
  const base = { open: true, onClose: () => {}, onSelect: () => {}, sections: [{ options: opts }] };

  it("seven rows draw a search box, unless the list says noSearch; then the list itself takes focus", () => {
    expect(html(h(Picker, base))).toContain("<input");
    const off = html(h(Picker, { ...base, noSearch: true }));
    expect(off).not.toContain("<input");
    expect(openTag(off, /<div[^>]*role="listbox"[^>]*>/)).toContain('tabindex="0"');
  });

  it("the Sort chip's Picker is told noSearch", () => {
    pickers.length = 0;
    html(h(OsToolbar, { sort: { label: "Sort", options: opts, value: "v0", onChange: () => {}, menuLabel: "Sort people" } }));
    const sort = pickers.find((p) => p.ariaLabel === "Sort people");
    expect(sort?.noSearch).toBe(true);
  });
});

describe("L7: the Teams Lead switch is toggled by its visible word and keeps focus while it saves", () => {
  it("\"Lead\" is the switch's label (a click on it toggles it), and the switch is never natively disabled", () => {
    const s = html(h(TeamCard, { team: team(2, 0), canEdit: true, onChanged: () => {} }));
    const id = leadSwitchId("t1", "u1");
    expect(s).toContain(`<label for="${id}" aria-hidden="true" class="cursor-pointer">Lead</label>`);
    const sw = openTag(s, new RegExp(`<button[^>]*id="${id}"[^>]*>`));
    expect(sw).toContain('role="switch"');
    expect(sw).toContain(`aria-label="${leadSwitchName("Person1 Test")}"`);
    expect(sw).not.toContain("disabled=");
    expect(code(src("src/app/(dashboard)/settings/members/teams-tab.tsx"))).toMatch(/<Switch id=\{leadSwitchId\(team\.id, m\.id\)\} checked=\{m\.lead\} aria-disabled=\{busy\}/);
  });

  it("a held switch says so (aria-disabled), stays focusable, and ignores a click", () => {
    const calls: boolean[] = [];
    const held = Switch({ checked: false, "aria-disabled": true, onChange: (v) => calls.push(v), "aria-label": "Lead: A" }) as unknown as { props: { onClick: () => void; disabled?: boolean } };
    held.props.onClick();
    expect(calls).toEqual([]);
    expect(held.props.disabled).toBeUndefined();
    const markup = html(h(Switch, { checked: false, "aria-disabled": true, "aria-label": "Lead: A" }));
    expect(markup).toContain('aria-disabled="true"');
    expect(markup).not.toContain('disabled=""');
    expect(markup).toContain("opacity-50");
    const live = Switch({ checked: false, onChange: (v) => calls.push(v) }) as unknown as { props: { onClick: () => void } };
    live.props.onClick();
    expect(calls).toEqual([true]);
  });
});

describe("L8: the empty team line is a div, so the Add people Picker's divs never sit inside a p", () => {
  it("draws the line as a div", () => {
    const s = html(h(TeamCard, { team: team(0), canEdit: true, onChanged: () => {} }));
    expect(s).toContain('<div class="m-0 text-base text-ink-2">No people in this team yet');
    expect(s).not.toMatch(/<p[^>]*>No people in this team yet/);
  });
});

describe("L9: New job title's Seniority (and Department) are the one PickerSelect", () => {
  it("no native select is left in the dialog, and the six levels are read whole", () => {
    const jt = code(src("src/components/people/job-titles-list.tsx"));
    const dialog = jt.slice(jt.indexOf("export function NewJobTitleDialog"));
    expect(dialog).not.toContain("<select");
    expect(dialog).toMatch(/<PickerSelect id=\{NEW_TITLE_SENIORITY_ID\} label="Seniority" noSearch value=\{seniority\}/);
    expect(dialog).toMatch(/<PickerSelect id=\{NEW_TITLE_DEPT_ID\} label="Department" align="start" value=\{departmentId \?\? ""\}/);
    // The visible labels open them.
    expect(dialog).toContain("<label htmlFor={NEW_TITLE_SENIORITY_ID}>Seniority</label>");
    expect(dialog).toContain("<label htmlFor={NEW_TITLE_DEPT_ID}>Department</label>");
  });

  it("PickerSelect passes noSearch to its Picker", () => {
    expect(code(src("src/components/settings/picker-select.tsx"))).toMatch(/<Picker\b[\s\S]*?\bnoSearch=\{noSearch\}/);
  });
});
