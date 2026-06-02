// Preferences — per-user shell state (sidebar, home, theme, density)
// with org-level defaults and locked-keys overrides (Decision D5).
//
// Merge order, top-down:
//   1. Hardcoded fallback (DEFAULT_*) — what a brand-new org/user sees.
//   2. OrgPreference.{sidebarDefault,homeDefault,themeDefault,densityDefault}
//   3. UserPreference.{sidebar,home,theme,density}
//   4. Re-stamp any dot-path listed in OrgPreference.lockedKeys with
//      the org's value (admin can freeze keys against user override).

import { prisma } from "@/lib/prisma";

// ── Shapes ─────────────────────────────────────────────────────────

export interface SidebarPref {
  pinned: string[];           // nav keys pinned to top (e.g. "home", "inbox")
  hidden: string[];           // nav keys explicitly hidden
  order: string[];            // user's chosen order for navigable items
  iconsOnly: boolean;         // collapsed (icons only) vs labeled
  sectionsOrder: string[];    // order of sidebar sections ("favorites", "spaces", ...)
}

export interface HomePref {
  cards: string[];            // card keys shown on Home (e.g. "inbox", "assigned-comments")
  order: string[];            // display order
}

export interface ThemePref {
  appearance: "LIGHT" | "DARK" | "AUTO";
  accent: string;             // one of the brand accents: "mint" | "purple" | ...
}

export type DensityPref = "compact" | "cozy";

export interface EffectivePreferences {
  sidebar: SidebarPref;
  home: HomePref;
  theme: ThemePref;
  density: DensityPref;
  lockedKeys: string[];       // pass-through for UI to disable controls
}

// ── Defaults ───────────────────────────────────────────────────────

export const DEFAULT_SIDEBAR: SidebarPref = {
  pinned: ["home", "inbox", "my-tasks", "assigned-comments"],
  hidden: [],
  order: [
    "home", "spaces", "planner", "ai", "teams", "docs", "dashboards",
    "whiteboards", "forms", "clips", "goals", "timesheets",
  ],
  iconsOnly: false,
  sectionsOrder: ["favorites", "spaces"],
};

export const DEFAULT_HOME: HomePref = {
  cards: ["recent", "docs", "bookmarks", "folders", "lists"],
  order: ["recent", "docs", "bookmarks", "folders", "lists"],
};

export const DEFAULT_THEME: ThemePref = {
  appearance: "DARK",
  accent: "mint",
};

export const DEFAULT_DENSITY: DensityPref = "cozy";

// ── Locked-keys dot-path helpers ──────────────────────────────────

function getAt(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const seg of path) {
    if (cur && typeof cur === "object" && seg in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return cur;
}

function setAt(obj: Record<string, unknown>, path: string[], value: unknown): void {
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i];
    if (!cur[seg] || typeof cur[seg] !== "object") cur[seg] = {};
    cur = cur[seg] as Record<string, unknown>;
  }
  cur[path[path.length - 1]] = value;
}

// ── Resolvers ──────────────────────────────────────────────────────

interface RawPrefs {
  orgSidebar: SidebarPref | null;
  orgHome: HomePref | null;
  orgTheme: ThemePref | null;
  orgDensity: DensityPref | null;
  lockedKeys: string[];
  userSidebar: SidebarPref | null;
  userHome: HomePref | null;
  userTheme: ThemePref | null;
  userDensity: DensityPref | null;
}

async function loadRaw(userId: string, organizationId: string): Promise<RawPrefs> {
  const [orgRow, userRow] = await Promise.all([
    prisma.orgPreference.findUnique({ where: { organizationId } }),
    prisma.userPreference.findUnique({ where: { userId } }),
  ]);

  return {
    orgSidebar: (orgRow?.sidebarDefault as SidebarPref | null) ?? null,
    orgHome: (orgRow?.homeDefault as HomePref | null) ?? null,
    orgTheme: (orgRow?.themeDefault as ThemePref | null) ?? null,
    orgDensity: (orgRow?.densityDefault as DensityPref | null) ?? null,
    lockedKeys: orgRow?.lockedKeys ?? [],
    userSidebar: (userRow?.sidebar as SidebarPref | null) ?? null,
    userHome: (userRow?.home as HomePref | null) ?? null,
    userTheme: (userRow?.theme as ThemePref | null) ?? null,
    userDensity: (userRow?.density as DensityPref | null) ?? null,
  };
}

/**
 * Resolve the effective preferences for a user. Applies the merge order:
 * defaults → org → user → locked-keys re-stamp from org values.
 */
export async function getEffectivePreferences(userId: string, organizationId: string): Promise<EffectivePreferences> {
  const raw = await loadRaw(userId, organizationId);

  const merged: EffectivePreferences = {
    sidebar: { ...DEFAULT_SIDEBAR, ...(raw.orgSidebar ?? {}), ...(raw.userSidebar ?? {}) },
    home: { ...DEFAULT_HOME, ...(raw.orgHome ?? {}), ...(raw.userHome ?? {}) },
    theme: { ...DEFAULT_THEME, ...(raw.orgTheme ?? {}), ...(raw.userTheme ?? {}) },
    density: raw.userDensity ?? raw.orgDensity ?? DEFAULT_DENSITY,
    lockedKeys: raw.lockedKeys,
  };

  // Re-stamp locked keys with org defaults so user can't override.
  // Dot path examples: "sidebar.iconsOnly", "theme.accent", "density".
  for (const key of raw.lockedKeys) {
    const path = key.split(".");
    const orgValue = getAt(
      {
        sidebar: { ...DEFAULT_SIDEBAR, ...(raw.orgSidebar ?? {}) },
        home: { ...DEFAULT_HOME, ...(raw.orgHome ?? {}) },
        theme: { ...DEFAULT_THEME, ...(raw.orgTheme ?? {}) },
        density: raw.orgDensity ?? DEFAULT_DENSITY,
      },
      path,
    );
    if (orgValue !== undefined) {
      setAt(merged as unknown as Record<string, unknown>, path, orgValue);
    }
  }

  return merged;
}

/** Direct read — what's stored on the row, not the merged result. */
export async function getUserPreferenceRow(userId: string) {
  return prisma.userPreference.findUnique({ where: { userId } });
}

export async function getOrgPreferenceRow(organizationId: string) {
  return prisma.orgPreference.findUnique({ where: { organizationId } });
}

export interface UpdateUserPreferenceInput {
  sidebar?: Partial<SidebarPref>;
  home?: Partial<HomePref>;
  theme?: Partial<ThemePref>;
  density?: DensityPref;
}

export async function setUserPreference(userId: string, patch: UpdateUserPreferenceInput) {
  const existing = await prisma.userPreference.findUnique({ where: { userId } });
  const sidebar = patch.sidebar
    ? { ...(existing?.sidebar as SidebarPref | null ?? DEFAULT_SIDEBAR), ...patch.sidebar }
    : (existing?.sidebar ?? undefined);
  const home = patch.home
    ? { ...(existing?.home as HomePref | null ?? DEFAULT_HOME), ...patch.home }
    : (existing?.home ?? undefined);
  const theme = patch.theme
    ? { ...(existing?.theme as ThemePref | null ?? DEFAULT_THEME), ...patch.theme }
    : (existing?.theme ?? undefined);
  const density = patch.density ?? existing?.density ?? undefined;

  return prisma.userPreference.upsert({
    where: { userId },
    create: {
      userId,
      sidebar: sidebar ?? undefined,
      home: home ?? undefined,
      theme: theme ?? undefined,
      density: density ?? null,
    },
    update: {
      sidebar: sidebar ?? undefined,
      home: home ?? undefined,
      theme: theme ?? undefined,
      density: density ?? null,
    },
  });
}

export interface UpdateOrgPreferenceInput {
  sidebarDefault?: Partial<SidebarPref>;
  homeDefault?: Partial<HomePref>;
  themeDefault?: Partial<ThemePref>;
  densityDefault?: DensityPref;
  lockedKeys?: string[];
}

export async function setOrgPreference(organizationId: string, patch: UpdateOrgPreferenceInput) {
  const existing = await prisma.orgPreference.findUnique({ where: { organizationId } });
  const sidebar = patch.sidebarDefault
    ? { ...(existing?.sidebarDefault as SidebarPref | null ?? DEFAULT_SIDEBAR), ...patch.sidebarDefault }
    : (existing?.sidebarDefault ?? undefined);
  const home = patch.homeDefault
    ? { ...(existing?.homeDefault as HomePref | null ?? DEFAULT_HOME), ...patch.homeDefault }
    : (existing?.homeDefault ?? undefined);
  const theme = patch.themeDefault
    ? { ...(existing?.themeDefault as ThemePref | null ?? DEFAULT_THEME), ...patch.themeDefault }
    : (existing?.themeDefault ?? undefined);
  const density = patch.densityDefault ?? existing?.densityDefault ?? undefined;

  return prisma.orgPreference.upsert({
    where: { organizationId },
    create: {
      organizationId,
      sidebarDefault: sidebar ?? undefined,
      homeDefault: home ?? undefined,
      themeDefault: theme ?? undefined,
      densityDefault: density ?? null,
      lockedKeys: patch.lockedKeys ?? [],
    },
    update: {
      sidebarDefault: sidebar ?? undefined,
      homeDefault: home ?? undefined,
      themeDefault: theme ?? undefined,
      densityDefault: density ?? null,
      ...(patch.lockedKeys !== undefined ? { lockedKeys: patch.lockedKeys } : {}),
    },
  });
}

export function isLocked(lockedKeys: string[], dotPath: string): boolean {
  return lockedKeys.includes(dotPath);
}
