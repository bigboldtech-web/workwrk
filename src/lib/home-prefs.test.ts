import { describe, it, expect } from "vitest";
import {
  GUEST_HOME_WIDGETS,
  HOME_WIDGET_KEYS,
  HOME_WIDGET_LABEL,
  SIDEBAR_FIXED_ROWS,
  SIDEBAR_OPTIONAL_KEYS,
  homeWidgetsNeedMigration,
  parseLegacySavedFilters,
  readHomeWidgets,
  readSavedFilters,
  readSidebarCards,
  sidebarCardsNeedMigration,
  visibleHomeWidgets,
} from "./home-prefs";

describe("readSidebarCards", () => {
  it("shows everything when nothing was ever stored", () => {
    expect(readSidebarCards(undefined)).toEqual([...SIDEBAR_OPTIONAL_KEYS]);
    expect(readSidebarCards(null)).toEqual([...SIDEBAR_OPTIONAL_KEYS]);
    expect(readSidebarCards("not an array")).toEqual([...SIDEBAR_OPTIONAL_KEYS]);
  });

  it("honours a stored choice in the new vocabulary", () => {
    expect(readSidebarCards(["activity", "spaces"])).toEqual(["activity", "spaces"]);
  });

  it("keeps the declared order whatever order the value was stored in", () => {
    expect(readSidebarCards(["spaces", "activity", "goals"])).toEqual(["activity", "goals", "spaces"]);
  });

  it("maps the two old card keys that still mean something", () => {
    expect(readSidebarCards(["allSpaces"])).toEqual(["spaces"]);
    expect(readSidebarCards(["allTasks"])).toEqual(["spaces"]);
  });

  it("drops the old keys for rows that are fixed or gone, without hiding the sidebar", () => {
    // Every entry maps to nothing, so this is not a choice to hide everything.
    expect(readSidebarCards(["inbox", "myWrk", "assignedComments", "draftsSent"]))
      .toEqual([...SIDEBAR_OPTIONAL_KEYS]);
  });

  it("keeps a real choice made alongside dead keys", () => {
    expect(readSidebarCards(["inbox", "draftsSent", "allSpaces"])).toEqual(["spaces"]);
  });

  it("ignores an unknown key rather than rendering a row for it", () => {
    expect(readSidebarCards(["activity", "some-future-key"])).toEqual(["activity"]);
  });

  it("ignores non-strings", () => {
    expect(readSidebarCards(["activity", 7, null, {}])).toEqual(["activity"]);
  });

  it("an explicitly empty array means the viewer hid every optional row", () => {
    // Empty is not "unset": it is a value, and `sawAnythingMeaningful` is false
    // so it reads as unset. That is deliberate — an empty sidebar is never what
    // somebody meant, and the CustomizePanel writes the keys it keeps, not [].
    expect(readSidebarCards([])).toEqual([...SIDEBAR_OPTIONAL_KEYS]);
  });

  it("never returns one of the three fixed rows", () => {
    const result = readSidebarCards(["home", "my-work", "inbox", "activity"]);
    for (const fixed of SIDEBAR_FIXED_ROWS) expect(result).not.toContain(fixed);
  });
});

describe("sidebarCardsNeedMigration", () => {
  it("is true only when a stored value carries a key from the old panel", () => {
    expect(sidebarCardsNeedMigration(["allSpaces"])).toBe(true);
    expect(sidebarCardsNeedMigration(["activity", "spaces"])).toBe(false);
    expect(sidebarCardsNeedMigration(undefined)).toBe(false);
  });
});

describe("readHomeWidgets", () => {
  it("shows all six when neither key has ever been written", () => {
    expect(readHomeWidgets(undefined, undefined)).toEqual([...HOME_WIDGET_KEYS]);
  });

  it("honours the new key and keeps the fixed order", () => {
    expect(readHomeWidgets(["recent-docs", "my-work"])).toEqual(["my-work", "recent-docs"]);
  });

  it("an explicit empty list on the new key means all six are off", () => {
    // Unlike home.cards, this key IS written as the full chosen set by the
    // Display popover, so [] is a real choice a person made with six switches.
    expect(readHomeWidgets([])).toEqual([]);
  });

  it("inverts the old hidden list once, by name", () => {
    expect(readHomeWidgets(undefined, ["goals"])).toEqual([
      "my-work", "inbox", "reminders", "weekly-review", "recent-docs",
    ]);
  });

  it("maps the KRAs card onto the Weekly review widget", () => {
    expect(readHomeWidgets(undefined, ["kras"])).not.toContain("weekly-review");
  });

  it("ignores hidden stub cards that map to no widget", () => {
    expect(readHomeWidgets(undefined, ["agenda", "ai-standup", "priorities", "recents"]))
      .toEqual([...HOME_WIDGET_KEYS]);
  });

  it("stops reading the old key the moment the new one exists", () => {
    expect(readHomeWidgets(["goals"], ["goals"])).toEqual(["goals"]);
  });

  it("ignores an unknown widget key in the stored list", () => {
    expect(readHomeWidgets(["my-work", "team-today"])).toEqual(["my-work"]);
  });
});

describe("homeWidgetsNeedMigration", () => {
  it("is true only when the new key is unset and there is something to carry", () => {
    expect(homeWidgetsNeedMigration(undefined, ["goals"])).toBe(true);
    expect(homeWidgetsNeedMigration(undefined, [])).toBe(false);
    expect(homeWidgetsNeedMigration([], ["goals"])).toBe(false);
  });
});

describe("visibleHomeWidgets", () => {
  it("leaves a Member's choice alone", () => {
    expect(visibleHomeWidgets(HOME_WIDGET_KEYS, false)).toEqual([...HOME_WIDGET_KEYS]);
  });

  it("narrows a Guest to the two things their access row grants", () => {
    expect(visibleHomeWidgets(HOME_WIDGET_KEYS, true)).toEqual([...GUEST_HOME_WIDGETS]);
  });

  it("never widens a Guest back to something they switched off", () => {
    expect(visibleHomeWidgets(["inbox"], true)).toEqual(["inbox"]);
  });
});

describe("the widget catalogue", () => {
  it("labels every widget in user words", () => {
    for (const key of HOME_WIDGET_KEYS) {
      expect(HOME_WIDGET_LABEL[key]).toBeTruthy();
      expect(HOME_WIDGET_LABEL[key]).not.toMatch(/-/);
    }
  });
});

describe("saved filters", () => {
  it("reads the old localStorage payload", () => {
    const raw = JSON.stringify([{ id: "a", name: "Urgent", sort: "due", isDefault: true }]);
    expect(parseLegacySavedFilters(raw)).toEqual([
      { id: "a", name: "Urgent", filters: undefined, sort: "due", group: null, view: null, isDefault: true },
    ]);
  });

  it("drops rows with no id or no name rather than rendering a nameless pill", () => {
    const raw = JSON.stringify([{ id: "a" }, { name: "x" }, { id: "b", name: "  " }, { id: "c", name: "Ok" }]);
    expect(parseLegacySavedFilters(raw).map((f) => f.id)).toEqual(["c"]);
  });

  it("never throws on junk", () => {
    expect(parseLegacySavedFilters("{{{")).toEqual([]);
    expect(parseLegacySavedFilters(null)).toEqual([]);
    expect(parseLegacySavedFilters("42")).toEqual([]);
  });

  it("reads the stored preference with the same tolerance", () => {
    expect(readSavedFilters([{ id: "a", name: "Mine" }, null, { name: "no id" }]))
      .toEqual([{ id: "a", name: "Mine", filters: undefined, sort: null, group: null, view: null, isDefault: false }]);
    expect(readSavedFilters(undefined)).toEqual([]);
  });
});
