// Design-system lint (docs/plans/ui-refresh/design-system.md section 8.4).
//
// Shipped as a tiny local plugin rather than as more `no-restricted-syntax`
// selectors on purpose: flat-config rule options REPLACE rather than merge,
// so a second `no-restricted-syntax` object for the same files would
// silently switch off the G7 access rule (and folding these into the G7
// array would exempt its 352-file legacy allow-list from the colour lint).
//
// Each rule scans every string literal and template chunk, not only
// `className` attributes: hundreds of grey utilities sit in ternary
// branches and const class maps with no JSX attribute around them.
//
// Severity schedule (which refresh step flips a rule to "error"):
//   no-grey-utilities      warn now  -> error at step 5 (colour sweep)
//   no-arbitrary-text-size warn now  -> error at step 2 (type codemod)
//   no-banned-radius-shadow warn now -> error at step 4 (primitives)
//   no-brand-dots          error now (zero hits today)

const GREY_HUES = "(?:zinc|slate|gray|neutral|stone|violet|purple|indigo|pink|fuchsia)";
const UTILITY_PREFIX =
  "(?:bg|text|border|border-[trblxyse]|ring|ring-offset|divide|from|to|via|fill|stroke|outline|shadow|decoration|placeholder|accent|caret)";

const GREY_UTILITY_RE = new RegExp(`(?:^|[\\s"'\`:(])${UTILITY_PREFIX}-${GREY_HUES}-\\d{2,3}(?:/\\d{1,3})?(?=$|[\\s"'\`)\\]])`);
// Raw hex anywhere inside an arbitrary-value utility (`bg-[#fff]`, but also
// `shadow-[0_1px_#000]` and `border-[color-mix(...,#e4e4e7)]`), and a string
// literal that IS a colour (`style={{ background: "#FBFBFC" }}`, swatch
// tables). Spec 8.4 rule 1 bans `#[0-9a-fA-F]{3,8}` in product code outright.
const HEX_ARBITRARY_RE = /\[[^\]\s]*#[0-9a-fA-F]{3,8}\b[^\]\s]*\]/;
const HEX_LITERAL_RE = /^\s*#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\s*$/;
const TEXT_PX_RE = /(?:^|[\s"'`:(])text-\[\d+(?:\.\d+)?px\]/;
// rounded-2xl / rounded-3xl, their per-side variants (rounded-t-2xl) and
// any arbitrary radius (rounded-[16px]): the largest product radius is 12.
const RADIUS_RE = /(?:^|[\s"'`:(])rounded-(?:[trblse]{1,2}-)?(?:2xl|3xl|\[[^\]]+\])(?=$|[\s"'`)\]])/;
const SHADOW_RE = /(?:^|[\s"'`:(])shadow-(?:sm|md|lg|xl|2xl)(?=$|[\s"'`)\]])/;
const DOT_RE = /--os-dot-/;

function forEachString(context, visit) {
  return {
    Literal(node) {
      if (typeof node.value === "string") visit(node, node.value);
    },
    TemplateElement(node) {
      visit(node, node.value.raw);
    },
  };
}

function makeRule(description, checks) {
  return {
    meta: { type: "suggestion", docs: { description }, schema: [] },
    create(context) {
      return forEachString(context, (node, text) => {
        for (const [re, message] of checks) {
          if (re.test(text)) {
            context.report({ node, message });
            return;
          }
        }
      });
    },
  };
}

// spec-shell 1.5: the one back control. `router.back()` / `history.back()`
// may be called in ui/back-button.tsx (the BackButton) and in the bar's own
// history control (top-bar/nav-history.tsx); everywhere else a page renders
// <BackButton fallbackHref label/>.
const BACK_ALLOWED_FILES = /(?:^|[\/])(?:src[\/]components[\/]ui[\/]back-button\.tsx|src[\/]components[\/]layout[\/]os[\/]top-bar[\/]nav-history\.tsx)$/;

// spec-shell 2.1 rule 2: a page.tsx under a dynamic segment ([id], [slug])
// renders `<Breadcrumb items/>`, because no static table can know the
// object's name. The check is the import, as the spec words it.
const DYNAMIC_PAGE_RE = /src[\/]app[\/]\(dashboard\)[\/].*\[[^\]]+\].*[\/]page\.tsx$/;
const BREADCRUMB_MODULE = "@/components/layout/os/top-bar/breadcrumb";

// spec-shell 1.6 / 1.7: one loader vocabulary. A spinner (lucide Loader2)
// and the string "Loading..." are lint errors under the shell and the app:
// panels and drawers render Skeleton bars, buttons in flight render
// <Dots variant="pending" />, route transitions pulse the rail logo.
const LOADING_TEXT_RE = /(^|[^A-Za-z])Loading(\u2026|\.\.\.)/;

// spec-shell 1.14 / design-system 4: the shell uses logical properties only,
// so the frame mirrors under dir="rtl". A physical Tailwind direction
// utility (left-2, -right-1, ml-auto, pl-3, text-left, rounded-l-lg,
// border-r) is an error under src/components/layout/os/**; the logical
// twin (start-2, -end-1, ms-auto, ps-3, text-start, rounded-s-lg,
// border-e) says the same thing in both directions. Centring is
// `inset-x-0 mx-auto` on a sized element, never `left-1/2 -translate-x-1/2`.
const PHYSICAL_VALUE = "(?:\\d+(?:\\.\\d+)?(?:/\\d+)?|auto|px|full|\\[[^\\]]+\\]|\\([^)]+\\))";
const PHYSICAL_RE = new RegExp(
  "(?:^|[\\s\"'`(])(?:[^\\s\"'`]*:)?(?:-?(?:left|right|ml|mr|pl|pr|scroll-ml|scroll-mr)-" + PHYSICAL_VALUE +
    "|text-(?:left|right)|(?:rounded|border)-[lr](?:-[^\\s\"'`)]+)?)(?=$|[\\s\"'`)])",
);

export const designSystemPlugin = {
  meta: { name: "workwrk-design-system", version: "1.0.0" },
  rules: {
    "no-spinner-loader": {
      meta: { type: "suggestion", docs: { description: "Loader2 spinners are retired: Skeleton bars in panels, <Dots variant=\"pending\" /> in buttons (spec-shell 1.6)." }, schema: [] },
      create(context) {
        return {
          ImportDeclaration(node) {
            if (node.source.value !== "lucide-react") return;
            for (const spec of node.specifiers) {
              if (spec.type === "ImportSpecifier" && spec.imported && spec.imported.name === "Loader2") {
                context.report({ node: spec, message: "Loader2 is retired (spec-shell 1.6). Use <SkeletonRows /> / <SkeletonLines /> from @/components/ui/skeleton for a loading body and <Dots variant=\"pending\" /> from @/components/ui/dots for a button in flight." });
              }
            }
          },
        };
      },
    },
    "no-loading-text": {
      meta: { type: "suggestion", docs: { description: "The string \"Loading...\" is retired: a loading state is a skeleton, never a sentence (spec-shell 1.6)." }, schema: [] },
      create(context) {
        const check = (node, text) => {
          if (LOADING_TEXT_RE.test(text)) {
            context.report({ node, message: "\"Loading...\" text is retired (spec-shell 1.6). Render <SkeletonRows /> / <SkeletonLines /> at the row height instead; a page header in flight is <OsPageHeaderSkeleton />." });
          }
        };
        return {
          Literal(node) { if (typeof node.value === "string") check(node, node.value); },
          TemplateElement(node) { check(node, node.value.raw); },
          JSXText(node) { check(node, node.value); },
        };
      },
    },
    "no-bare-router-back": {
      meta: { type: "problem", docs: { description: "router.back() and history.back() live in ui/back-button.tsx only (spec-shell 1.5)." }, schema: [] },
      create(context) {
        const file = context.filename ?? context.getFilename();
        if (BACK_ALLOWED_FILES.test(file)) return {};
        return {
          CallExpression(node) {
            const callee = node.callee;
            if (callee.type !== "MemberExpression" || callee.property.type !== "Identifier" || callee.property.name !== "back") return;
            const obj = callee.object;
            const isHistory = obj.type === "Identifier" && obj.name === "history";
            const isWindowHistory = obj.type === "MemberExpression" && obj.property.type === "Identifier" && obj.property.name === "history";
            const isRouter = obj.type === "Identifier" && /router$/i.test(obj.name);
            if (isHistory || isWindowHistory || isRouter) {
              context.report({ node, message: "Bare back navigation. Render <BackButton fallbackHref label/> from @/components/ui/back-button; router.back() lives there and nowhere else (spec-shell 1.5)." });
            }
          },
        };
      },
    },
    "dynamic-page-declares-breadcrumb": {
      meta: { type: "problem", docs: { description: "A page.tsx under a dynamic segment declares <Breadcrumb items/> (spec-shell 2.1 rule 2)." }, schema: [] },
      create(context) {
        const file = context.filename ?? context.getFilename();
        if (!DYNAMIC_PAGE_RE.test(file)) return {};
        let declared = false;
        return {
          ImportDeclaration(node) {
            if (node.source.value === BREADCRUMB_MODULE) declared = true;
          },
          "Program:exit"(node) {
            if (!declared) {
              context.report({ node, loc: { line: 1, column: 0 }, message: "A dynamic route renders <Breadcrumb items/> from @/components/layout/os/top-bar/breadcrumb so the bar can name the object; without it the location row ends at the container (spec-shell 2.1 rule 2)." });
            }
          },
        };
      },
    },
    "no-grey-utilities": makeRule(
      "Grey / purple-family Tailwind palette utilities and raw hex utilities are banned inside the product; use the token aliases.",
      [
        [
          GREY_UTILITY_RE,
          "Palette utility (zinc/slate/gray/neutral/stone/violet/purple/indigo/pink/fuchsia) inside the product. Use the token aliases: bg-app / bg-raised / bg-subtle / bg-hover / bg-active, border-line, text-ink / text-ink-2 / text-ink-3, text-brand-deep (design-system 8.3).",
        ],
        [
          HEX_ARBITRARY_RE,
          "Raw hex colour in a Tailwind arbitrary value. Colour reaches components only through --os-* tokens (design-system 1.2); use the token aliases or var(--os-*).",
        ],
        [
          HEX_LITERAL_RE,
          "Raw hex colour literal. Colour reaches components only through --os-* tokens (design-system 1.2); use var(--os-*) or a token alias.",
        ],
      ],
    ),
    "no-arbitrary-text-size": makeRule(
      "Arbitrary text-[Npx] sizes are banned; use the nine named sizes.",
      [
        [
          TEXT_PX_RE,
          // All nine sizes are bound since the type codemod (refresh step 2,
          // scripts/codemod-type-scale.mjs). The sizes it refused (28 and up,
          // below 10) have no place on the scale; a survivor here is a
          // decision for the founder, not a mapping to guess.
          "Arbitrary text-[Npx]. Use a named size: text-rail 10, text-micro 11, text-xs 12, text-sm 13, text-base 14, text-row 15 (container only), text-lg 16, text-xl 22, text-prose 15 (doc editor). Rows inherit 15 from an .os-row container and never set a size (design-system 2.2, 2.3, 8.2).",
        ],
      ],
    ),
    "no-banned-radius-shadow": makeRule(
      "rounded-2xl/3xl and Tailwind shadow utilities are banned inside .workwrk-os.",
      [
        [RADIUS_RE, "rounded-2xl / rounded-3xl are retired: the largest product radius is 12 (rounded-lg, --os-r-lg). Design-system 3.4."],
        [
          SHADOW_RE,
          "Tailwind shadow utilities are banned inside the product: cards are bordered; popovers use var(--os-shadow-pop), modals var(--os-shadow-modal). Design-system 3.5.",
        ],
      ],
    ),
    "no-physical-direction": makeRule("The shell uses logical direction utilities only (spec-shell 1.14): start/end, ms/me, ps/pe, text-start/text-end, rounded-s/e, border-s/e.", [
      [
        PHYSICAL_RE,
        "Physical direction utility in the shell. Use the logical twin so the frame mirrors in RTL: left-N -> start-N, right-N -> end-N, ml/mr -> ms/me, pl/pr -> ps/pe, text-left/right -> text-start/end, rounded-l/r -> rounded-s/e, border-l/r -> border-s/e; centre with inset-x-0 mx-auto (spec-shell 1.14).",
      ],
    ]),
    "no-brand-dots": makeRule("The --os-dot-* tokens are quarantined to src/components/brand and src/app/(marketing).", [
      [
        DOT_RE,
        "--os-dot-* (the YBRG brand dots) may only be referenced under src/components/brand/** and src/app/(marketing)/**. Everywhere else colour means something: use the semantic trio (design-system 1.6).",
      ],
    ]),
  },
};
