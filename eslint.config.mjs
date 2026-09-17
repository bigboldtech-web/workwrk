import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { ACCESS_LEGACY_ALLOWLIST } from "./eslint-access-allowlist.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // ── G7: one authority for access (access-model-spec.md 10 step 0) ──
  //
  // Principle 2 of the spec: "can() in src/lib/access/ is the only function
  // allowed to answer 'may this person do this'. A grep for accessLevel in
  // src/ outside src/lib/access/ returns zero after migration, enforced by
  // ESLint." This is that rule. It is scoped OUT of src/lib/access/ (the
  // engine has to read these things) and out of the legacy allow-list, which
  // names every file that already does and which shrinks to empty at step 6.
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    ignores: ["src/lib/access/**", ...ACCESS_LEGACY_ALLOWLIST],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[property.name='accessLevel']",
          message:
            "Do not read accessLevel. Ask the engine: can(viewer, action, ref) / requireCan() / gatePage() from @/lib/access, or useViewer().orgRole on the client.",
        },
        {
          selector: "Property[key.name='accessLevel']",
          message:
            "Do not pass accessLevel around. Build a Viewer with viewerFromSession() and let the engine answer.",
        },
        {
          selector:
            "CallExpression[callee.name=/^(isManager|isOrgAdmin|hasRole|hasPermission|requirePermission|checkPermission|canAccessTier)$/]",
          message:
            "Tier predicates are being retired (spec 2.2, 9). Use can()/requireCan() with an ObjectRef, or accessibleIds() for a list.",
        },
        {
          selector:
            "MemberExpression[object.name='prisma'][property.name=/^(spaceMember|folderMember|boardMember|sOPFolderAccess|accessGrant)$/]",
          message:
            "The member tables are the engine's store. Read them through loadFacts()/accessibleIds() and write them through src/lib/access/grants.ts.",
        },
      ],
    },
  },
  {
    rules: {
      // Stylistic-only — React renders raw apostrophes/quotes correctly
      // and we don't ship any user-supplied content through these JSX
      // text nodes. Demoting to a warning so the signal stays in the
      // local lint pass without gating CI on cosmetic escapes.
      "react/no-unescaped-entities": "warn",
    },
  },
]);

export default eslintConfig;
