// accessRowPhrase (activity-client.tsx): the words after the actor on an
// access row. grants.ts writes a name-free sentence on purpose; the feed
// shows the node's name only when the server resolved one for this viewer,
// and otherwise keeps the sentence whole, so the verb never stands alone
// ("VerifyAdmin Bot granted" said nothing).
//
// The client module's UI imports are stubbed so the pure helper loads in node.

import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: vi.fn(), useRouter: vi.fn(), useSearchParams: vi.fn() }));
vi.mock("next/link", () => ({ default: () => null }));
vi.mock("@/components/layout/os/page-header", () => ({ OsPageHeader: () => null }));
vi.mock("@/components/layout/os/empty-view", () => ({ OsEmptyView: () => null }));
vi.mock("@/components/ui/view-tabs", () => ({ ViewTab: () => null }));
vi.mock("@/components/ui/filter-panel", () => ({ FilterPanel: () => null, FilterRow: () => null }));
vi.mock("@/components/ui/dots-art", () => ({ DotsArt: () => null }));
vi.mock("@/components/ui/avatar-stack", () => ({ Avatar: () => null, personLabel: () => "" }));
vi.mock("@/lib/api-fetch", () => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/shortcuts", () => ({ useShortcut: vi.fn() }));
vi.mock("@/components/layout/os/use-object-href", () => ({ useObjectHref: vi.fn() }));

import { accessRowPhrase } from "./activity-client";
import { accessActivityDescription, ACCESS_ACTIVITY_TYPES } from "@/lib/access/access-activity";
import { ACCESS_NODE_KINDS } from "@/lib/access/access-panel";

describe("accessRowPhrase", () => {
  it("lets the chip carry a name the viewer may see", () => {
    expect(accessRowPhrase("Gave someone access to a Folder", "G4 Folder A")).toBe("gave someone access to");
    expect(accessRowPhrase("Removed someone's access to a Space", "FX1 Dst Space")).toBe("removed someone's access to");
    expect(accessRowPhrase("Changed who can open a List", "G4 List A")).toBe("changed who can open");
  });

  it("keeps the sentence whole, noun and all, when there is no name to show", () => {
    expect(accessRowPhrase("Gave someone access to a Folder", null)).toBe("gave someone access to a Folder");
    expect(accessRowPhrase("Removed someone's access to a Doc", null)).toBe("removed someone's access to a Doc");
  });

  it("stops an older writer's sentence before its quoted name, so the name is not printed twice", () => {
    expect(accessRowPhrase('Turned on the public link for table "RG2 Table"', "RG2 Table")).toBe("turned on the public link for table");
    expect(accessRowPhrase("Turned off the public link for form “RG2 Form”", "RG2 Form")).toBe("turned off the public link for form");
  });

  it("never reads the apostrophe in someone's as a quote", () => {
    expect(accessRowPhrase("Changed someone's access to a Folder", "Sub A1")).toBe("changed someone's access to");
  });

  it("every sentence grants.ts can write ends cleanly before the chip", () => {
    for (const type of ACCESS_ACTIVITY_TYPES) {
      if (type === "access.private_rule_changed") continue; // targetless: it keeps its own tail
      for (const kind of ACCESS_NODE_KINDS) {
        const phrase = accessRowPhrase(accessActivityDescription(type, kind), "Name");
        expect(phrase, `${type} ${kind}`).not.toMatch(/\ban?\s+\w+$/);
        expect(phrase).not.toMatch(/\bNode\b|\bnode\b/);
      }
    }
  });

  it("is null without a sentence", () => {
    expect(accessRowPhrase(null, "X")).toBeNull();
    expect(accessRowPhrase("   ", null)).toBeNull();
  });
});
