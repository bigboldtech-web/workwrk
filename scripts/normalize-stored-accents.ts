/**
 * Normalise stored appearance preferences after the accent picker's CSS
 * was deleted (docs/plans/ui-refresh/design-system.md 8.5).
 *
 * What it does:
 *   UserPreference.theme.accent          -> "workwrk" (every other value)
 *   UserPreference.sidebar.iconsOnly     -> false     (icons-only rail removed)
 *   OrgPreference.themeDefault.accent    -> "workwrk"
 *   OrgPreference.sidebarDefault.iconsOnly -> false
 *   OrgPreference.lockedKeys             -> drops "theme.accent" and
 *                                           "sidebar.iconsOnly" (nothing
 *                                           reads either key any more)
 *
 * "workwrk" is the app's key for the one brand blue (DEFAULT_THEME.accent in
 * src/lib/preferences.ts, the value new rows get). The spec's prose says
 * "blue", but "blue" is a DIFFERENT, now-deleted picker entry (the #3b82f6
 * swatch), so it is normalised away like every other key. Rows already at
 * "workwrk" are left alone, which is what makes a re-run a no-op.
 *
 * Density needs no write: stored "compact" and "cozy" keep their meaning
 * (32 / 36, tokens.css keys html[data-density]), the new default
 * "comfortable" (44) applies to every row with no stored value, and the
 * enum now accepts all three. The distribution is COUNTED below.
 *
 * iconsOnly -> false is in this script because 8.5 step 1 puts it here; the
 * CustomizePanel toggle and the rail still honour the key today, so run
 * --write only in the PR that removes that toggle (the same PR that deletes
 * the accent picker), never before.
 *
 * DRY RUN IS THE DEFAULT. It reads, counts per stored value and prints the
 * rows it would change (including every org whose default accent is in the
 * purple family, the "demo account purple theme" call-out). Nothing is
 * written unless --write is passed explicitly.
 *
 *   DATABASE_URL=... npx tsx scripts/normalize-stored-accents.ts
 *   DATABASE_URL=... npx tsx scripts/normalize-stored-accents.ts --write
 *
 * Idempotent: a second run (in either mode) reports zero rows to change.
 */
import * as dotenv from "dotenv";
dotenv.config();
import { PrismaClient, type Prisma } from "../src/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";

const connStr = process.env.DATABASE_URL;
if (!connStr) throw new Error("DATABASE_URL is not set");
const adapter = new PrismaPg({ connectionString: connStr });
const prisma = new PrismaClient({ adapter });

const write = process.argv.includes("--write");

// Kept as a literal rather than importing DEFAULT_THEME: src/lib/preferences.ts
// is server code that pulls in the app's prisma singleton and entitlements.
// It must equal DEFAULT_THEME.accent ("workwrk", the brand blue #0073EA).
const CANONICAL_ACCENT = "workwrk";
const PURPLE_FAMILY = new Set(["purple", "grape", "violet", "indigo", "pink"]);
const DEAD_LOCKED_KEYS = new Set(["theme.accent", "sidebar.iconsOnly"]);

type Json = Prisma.InputJsonObject;
const asObject = (v: unknown): Json | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null);

function tally(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}
function printTally(title: string, map: Map<string, number>) {
  console.log(`  ${title}`);
  const rows = [...map.entries()].sort((a, b) => b[1] - a[1]);
  if (rows.length === 0) console.log("    (none)");
  for (const [k, n] of rows) console.log(`    ${k.padEnd(16)} ${n}`);
}

async function main() {
  console.log(`mode: ${write ? "WRITE" : "DRY RUN (pass --write to apply)"}\n`);

  // ── Users ────────────────────────────────────────────────────────
  const users = await prisma.userPreference.findMany({
    select: { userId: true, theme: true, sidebar: true, density: true },
  });
  const userAccent = new Map<string, number>();
  const userDensity = new Map<string, number>();
  let userIconsOnly = 0;
  const userChanges: { userId: string; theme?: Json; sidebar?: Json; why: string[] }[] = [];

  for (const u of users) {
    const theme = asObject(u.theme);
    const sidebar = asObject(u.sidebar);
    const accent = typeof theme?.accent === "string" ? theme.accent : "(unset)";
    tally(userAccent, accent);
    tally(userDensity, typeof u.density === "string" ? u.density : "(unset)");
    if (sidebar?.iconsOnly === true) userIconsOnly++;

    const why: string[] = [];
    const change: { userId: string; theme?: Json; sidebar?: Json; why: string[] } = { userId: u.userId, why };
    if (theme && typeof theme.accent === "string" && theme.accent !== CANONICAL_ACCENT) {
      change.theme = { ...theme, accent: CANONICAL_ACCENT };
      why.push(`accent ${theme.accent} -> ${CANONICAL_ACCENT}`);
    }
    if (sidebar && sidebar.iconsOnly === true) {
      change.sidebar = { ...sidebar, iconsOnly: false };
      why.push("iconsOnly true -> false");
    }
    if (why.length) userChanges.push(change);
  }

  // ── Orgs ─────────────────────────────────────────────────────────
  const orgs = await prisma.orgPreference.findMany({
    select: {
      organizationId: true,
      themeDefault: true,
      sidebarDefault: true,
      densityDefault: true,
      lockedKeys: true,
      organization: { select: { name: true, slug: true } },
    },
  });
  const orgAccent = new Map<string, number>();
  const orgDensity = new Map<string, number>();
  let orgIconsOnly = 0;
  const purpleOrgs: string[] = [];
  const orgChanges: { organizationId: string; label: string; themeDefault?: Json; sidebarDefault?: Json; lockedKeys?: string[]; why: string[] }[] = [];

  for (const o of orgs) {
    const label = `${o.organization?.slug ?? o.organizationId} ("${o.organization?.name ?? "?"}")`;
    const theme = asObject(o.themeDefault);
    const sidebar = asObject(o.sidebarDefault);
    const accent = typeof theme?.accent === "string" ? theme.accent : "(unset)";
    tally(orgAccent, accent);
    tally(orgDensity, typeof o.densityDefault === "string" ? o.densityDefault : "(unset)");
    if (sidebar?.iconsOnly === true) orgIconsOnly++;
    if (PURPLE_FAMILY.has(accent)) purpleOrgs.push(`${label}: ${accent}`);

    const why: string[] = [];
    const change: (typeof orgChanges)[number] = { organizationId: o.organizationId, label, why };
    if (theme && typeof theme.accent === "string" && theme.accent !== CANONICAL_ACCENT) {
      change.themeDefault = { ...theme, accent: CANONICAL_ACCENT };
      why.push(`accent ${theme.accent} -> ${CANONICAL_ACCENT}`);
    }
    if (sidebar && sidebar.iconsOnly === true) {
      change.sidebarDefault = { ...sidebar, iconsOnly: false };
      why.push("iconsOnly true -> false");
    }
    const keptKeys = (o.lockedKeys ?? []).filter((k) => !DEAD_LOCKED_KEYS.has(k));
    if (keptKeys.length !== (o.lockedKeys ?? []).length) {
      change.lockedKeys = keptKeys;
      why.push(`lockedKeys drop ${(o.lockedKeys ?? []).filter((k) => DEAD_LOCKED_KEYS.has(k)).join(", ")}`);
    }
    if (why.length) orgChanges.push(change);
  }

  // ── Report ───────────────────────────────────────────────────────
  console.log(`UserPreference rows: ${users.length}`);
  printTally("stored theme.accent", userAccent);
  printTally("stored density (counted only; no write needed)", userDensity);
  console.log(`  sidebar.iconsOnly = true: ${userIconsOnly}\n`);

  console.log(`OrgPreference rows: ${orgs.length}`);
  printTally("stored themeDefault.accent", orgAccent);
  printTally("stored densityDefault (counted only; no write needed)", orgDensity);
  console.log(`  sidebarDefault.iconsOnly = true: ${orgIconsOnly}`);
  console.log(`  orgs whose default accent is purple-family (call out in the PR): ${purpleOrgs.length}`);
  for (const p of purpleOrgs) console.log(`    ${p}`);
  console.log();

  console.log(`${userChanges.length} user row(s) and ${orgChanges.length} org row(s) ${write ? "will be" : "would be"} changed.`);
  for (const c of orgChanges) console.log(`  org ${c.label}: ${c.why.join("; ")}`);
  if (userChanges.length) console.log(`  users: ${userChanges.map((c) => c.why.join("; ")).slice(0, 10).join(" | ")}${userChanges.length > 10 ? " ..." : ""}`);

  if (!write) {
    console.log("\nDry run: nothing written.");
    return;
  }

  // ── Apply ────────────────────────────────────────────────────────
  for (const c of userChanges) {
    await prisma.userPreference.update({
      where: { userId: c.userId },
      data: { ...(c.theme ? { theme: c.theme } : {}), ...(c.sidebar ? { sidebar: c.sidebar } : {}) },
    });
  }
  for (const c of orgChanges) {
    await prisma.orgPreference.update({
      where: { organizationId: c.organizationId },
      data: {
        ...(c.themeDefault ? { themeDefault: c.themeDefault } : {}),
        ...(c.sidebarDefault ? { sidebarDefault: c.sidebarDefault } : {}),
        ...(c.lockedKeys ? { lockedKeys: c.lockedKeys } : {}),
      },
    });
  }
  console.log(`\nWrote ${userChanges.length} user row(s) and ${orgChanges.length} org row(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
