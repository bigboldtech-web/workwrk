#!/usr/bin/env node
/**
 * Migrate `Icon: IconXxx` and `Icon={IconXxx}` patterns to iconKey strings
 * across all module + industry page.tsx files.
 * Also removes now-unused module-icons imports.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

const targets = [
  // 12 module pages
  "src/app/(marketing)/features/people/page.tsx",
  "src/app/(marketing)/features/kpis/page.tsx",
  "src/app/(marketing)/features/kras/page.tsx",
  "src/app/(marketing)/features/sops/page.tsx",
  "src/app/(marketing)/features/reviews/page.tsx",
  "src/app/(marketing)/features/okrs/page.tsx",
  "src/app/(marketing)/features/tasks/page.tsx",
  "src/app/(marketing)/features/kudos/page.tsx",
  "src/app/(marketing)/features/ai-engine/page.tsx",
  "src/app/(marketing)/features/analytics/page.tsx",
  "src/app/(marketing)/features/integrations/page.tsx",
  "src/app/(marketing)/features/access/page.tsx",
  // 7 industry pages
  "src/app/(marketing)/industries/sales/page.tsx",
  "src/app/(marketing)/industries/manufacturing/page.tsx",
  "src/app/(marketing)/industries/services/page.tsx",
  "src/app/(marketing)/industries/technology/page.tsx",
  "src/app/(marketing)/industries/logistics/page.tsx",
  "src/app/(marketing)/industries/healthcare/page.tsx",
  "src/app/(marketing)/industries/real-estate/page.tsx",
];

const iconMap = {
  IconPeople: "people",
  IconKpi: "kpi",
  IconKra: "kra",
  IconSop: "sop",
  IconReviews: "reviews",
  IconOkr: "okr",
  IconTask: "tasks",
  IconKudos: "kudos",
  IconAi: "ai",
  IconAnalytics: "analytics",
  IconIntegrations: "integrations",
  IconAccess: "access",
};

for (const t of targets) {
  const full = path.join(root, t);
  let text;
  try {
    text = await fs.readFile(full, "utf8");
  } catch {
    console.warn(`× missing ${t}`);
    continue;
  }
  let changed = text;

  // 1) `Icon: IconXxx,`  →  `iconKey: "xxx",`
  for (const [compName, key] of Object.entries(iconMap)) {
    changed = changed.replaceAll(`Icon: ${compName}`, `iconKey: "${key}"`);
  }

  // 2) `Icon={IconXxx}` → `iconKey="xxx"` (for ModuleHero)
  for (const [compName, key] of Object.entries(iconMap)) {
    changed = changed.replaceAll(`Icon={${compName}}`, `iconKey="${key}"`);
  }

  // 3) Remove the module-icons import block entirely — we don't need it anymore.
  //    Matches `import { ... } from "@/components/bento/module-icons";`
  changed = changed.replace(
    /import\s*\{[^}]*\}\s*from\s*["']@\/components\/bento\/module-icons["'];\s*\n/g,
    "",
  );

  if (changed !== text) {
    await fs.writeFile(full, changed, "utf8");
    console.log(`✓ ${t}`);
  } else {
    console.log(`· ${t} (no change)`);
  }
}
console.log("Done.");
