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

export const designSystemPlugin = {
  meta: { name: "workwrk-design-system", version: "1.0.0" },
  rules: {
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
          // Only the sizes that are bound TODAY are named as targets. The five
          // standard names (text-xs 12 / sm 13 / base 14 / lg 16 / xl 22) flip
          // with the type codemod (refresh step 2); until then text-xs is 13
          // and text-sm/base/lg/xl keep Tailwind's defaults, so pointing at
          // them here would enlarge text. Update this message in step 2.
          "Arbitrary text-[Npx]. Use a named size: text-rail 10, text-micro 11, text-xs 13 (until the type codemod), text-row 15, text-prose 15. The other named sizes (12/13/14/16/22 as text-xs/sm/base/lg/xl) land with the codemod in refresh step 2 (design-system 2.2, 8.2).",
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
    "no-brand-dots": makeRule("The --os-dot-* tokens are quarantined to src/components/brand and src/app/(marketing).", [
      [
        DOT_RE,
        "--os-dot-* (the YBRG brand dots) may only be referenced under src/components/brand/** and src/app/(marketing)/**. Everywhere else colour means something: use the semantic trio (design-system 1.6).",
      ],
    ]),
  },
};
