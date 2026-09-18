import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { ACCESS_LEGACY_ALLOWLIST } from "./eslint-access-allowlist.mjs";
import { designSystemPlugin } from "./eslint-design-system.mjs";

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
  // ── Design system (docs/plans/ui-refresh/design-system.md 8.4) ──
  //
  // A local plugin, not more `no-restricted-syntax` entries: a second
  // object setting that rule for overlapping files would replace the G7
  // options above rather than merge with them. Scope is the product:
  // src/app/(dashboard) and src/components. Exempt: src/components/brand
  // (the only place the four dots may live), src/app/(marketing) and the
  // marketing code that lives under src/components (landing/, marketing/,
  // bento/, pricing/), which keeps its own smaller sheet.
  //
  // Severity schedule: every rule that fails on today's code starts as a
  // warning and flips to "error" with the step that clears it:
  //   no-grey-utilities       -> error at refresh step 5 (colour sweep)
  //   no-arbitrary-text-size  -> error at refresh step 2 (type codemod).
  //                              Step 2 ran (scripts/codemod-type-scale.mjs):
  //                              3,350 hits -> 4 inside this rule's scope.
  //                              The codemod refused 9 sizes above the scale
  //                              rather than guess: 28 / 40 / 42 in
  //                              conference-surface, task-dialog,
  //                              block-doc-editor, board-chart-view (the 4
  //                              this rule sees) plus 32 / 40 / 52 in
  //                              src/app/onboard/page.tsx, which is outside
  //                              the `files` list below. Kept at "warn" until
  //                              the founder rules on a display size, then flip.
  //   no-banned-radius-shadow -> error at refresh step 4 (primitives)
  //   no-brand-dots           -> error now (zero hits at the token step)
  //   no-bare-router-back     -> error now (Phase 1 frame: the last bare
  //                              router.back() outside ui/back-button.tsx
  //                              went with the BackButton convention)
  //   dynamic-page-declares-breadcrumb -> warn now; flips to error as each
  //                              hub phase declares its detail pages' crumbs
  //                              (Phase 1 declared the six it rewired; the
  //                              other 19 dynamic pages belong to Phases 2-8)
  {
    files: ["src/app/(dashboard)/**/*.ts", "src/app/(dashboard)/**/*.tsx", "src/components/**/*.ts", "src/components/**/*.tsx"],
    ignores: [
      "src/components/brand/**",
      "src/components/landing/**",
      "src/components/marketing/**",
      "src/components/bento/**",
      "src/components/pricing/**",
      // Canvas is covered by the narrower block below (its colour literals
      // are user data drawn on the whiteboard, not chrome).
      "src/components/canvas/**",
    ],
    plugins: { "workwrk-ds": designSystemPlugin },
    rules: {
      "workwrk-ds/no-grey-utilities": "warn",
      "workwrk-ds/no-arbitrary-text-size": "warn",
      "workwrk-ds/no-banned-radius-shadow": "warn",
      "workwrk-ds/no-brand-dots": "error",
      "workwrk-ds/no-bare-router-back": "error",
      "workwrk-ds/dynamic-page-declares-breadcrumb": "warn",
      // Loader vocabulary (spec-shell 1.6): "warn" across the app while the
      // hub phases sweep their page bodies; "error" in the shell below.
      "workwrk-ds/no-spinner-loader": "warn",
      "workwrk-ds/no-loading-text": "warn",
    },
  },
  // The shell (Phase 1 "the frame"): the loader sweep is complete here, so
  // a spinner or a "Loading..." string is an error, not a warning.
  {
    files: ["src/components/layout/os/**/*.ts", "src/components/layout/os/**/*.tsx", "src/components/access/**/*.tsx", "src/components/brand/**/*.tsx", "src/app/(dashboard)/layout.tsx", "src/app/(dashboard)/loading.tsx", "src/app/(dashboard)/error.tsx", "src/app/(dashboard)/not-found.tsx"],
    plugins: { "workwrk-ds": designSystemPlugin },
    rules: {
      "workwrk-ds/no-spinner-loader": "error",
      "workwrk-ds/no-loading-text": "error",
    },
  },
  // The shell mirrors under dir="rtl" (spec-shell 1.14): physical direction
  // utilities are an error under src/components/layout/os/** only.
  {
    files: ["src/components/layout/os/**/*.ts", "src/components/layout/os/**/*.tsx"],
    plugins: { "workwrk-ds": designSystemPlugin },
    rules: {
      "workwrk-ds/no-physical-direction": "error",
    },
  },
  // src/app/global-error.tsx replaces the root layout when it fails, so no
  // stylesheet and no token can reach it: every colour there is a written-out
  // literal on purpose (spec-shell 2.6) and it sits outside the product scope
  // above by design. Do not "fix" it into tokens it cannot read.
  // The whiteboard: exempt from the grey / raw-hex rule only (its palette
  // is user content), every other design rule still applies.
  {
    files: ["src/components/canvas/**/*.ts", "src/components/canvas/**/*.tsx"],
    plugins: { "workwrk-ds": designSystemPlugin },
    rules: {
      "workwrk-ds/no-arbitrary-text-size": "warn",
      "workwrk-ds/no-banned-radius-shadow": "warn",
      "workwrk-ds/no-brand-dots": "error",
    },
  },
  // The dot quarantine also covers the app outside the product scope
  // (auth, onboard, api): only brand/ and (marketing) may reference them.
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    ignores: ["src/components/brand/**", "src/app/(marketing)/**"],
    plugins: { "workwrk-ds": designSystemPlugin },
    rules: {
      "workwrk-ds/no-brand-dots": "error",
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
