// Settings clean-up Phase 4 (docs/plans/settings-cleanup.md D Phase 4, B2,
// B4, B8, B10): Members (People, Guests, Teams, Pending invites) and
// Structure (Departments, Job titles, Offices, Profile fields, Org chart).
// Each page or part is rendered to static markup with its shell, boot and
// reads stubbed, so what is asserted is what the browser receives on first
// paint: the toolbar is in the header stack (its 44px row held there for a
// tab whose content draws it), nothing toolbar-like is left in the content,
// every block is a SettingsCard, empty states are the inline line or the
// quiet empty state, and the Sort chip is a menu button, never a select.

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
import { countsReadNeeded, membersTabs } from "@/app/(dashboard)/settings/members/members-shared";
import { TeamCard, TeamsCard, TEAMS_INTRO, leadSwitchName, peopleCount, type Team } from "@/app/(dashboard)/settings/members/teams-tab";
import { JOB_TITLES_NOTE, OrgChartCard, RoleStrip, StructureClient, structureTabs } from "@/app/(dashboard)/settings/structure/structure-client";
import { PRIMARY_GREY_DISABLED, PROFILE_FIELDS_INTRO, ProfileFieldsCard } from "@/components/people/profile-fields-manager";
import { DepartmentsManager } from "@/components/people/departments-manager";
import { JobTitlesList } from "@/components/people/job-titles-list";
import { OsToolbar, sortChipName } from "@/components/layout/os/page-header/page-header";
import { SETTINGS_TOOLBAR_ROW, SettingsPage, SettingsToolbar, settingsToolbarPlace } from "./settings-page";

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
