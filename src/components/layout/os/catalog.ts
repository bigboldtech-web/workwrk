/* ════════════════════════════════════════════════════════════════
 * Legacy colour maps, C and GRAD.
 *
 * This file used to be the demo MODULE CATALOG: a fixture of 60-odd sample
 * modules (CRM, Helpdesk, ITSM, Legal, Financials, Procurement, Marketing,
 * Studio, and stub rows for Sidekick, Agents, AI and Autopilot), a PEOPLE
 * pool of fake avatars, an `agents/*` path map, and getModule /
 * getAllModules. Its last consumer was the fixture Marketplace, which reads
 * the real module registry (src/lib/modules.ts) since Phase 7, so the
 * fixture is gone (spec-ai-automation section 4 step 1, spec-tools-misc
 * section 4 step 1). What stays is what live pages import: the two colour
 * maps below.
 * ════════════════════════════════════════════════════════════════ */

// ─── Color helpers (Monday palette) ─────────────────────────
// NOTE: purple/pink/indigo/lime are LEGACY ALIASES kept so existing call
// sites keep compiling, they resolve to design-system hues (brand blue,
// signal red, deep blue, sage). No banned hues render from this map.
export const C = {
  green:  "var(--os-c-green)",
  orange: "var(--os-c-orange)",
  red:    "var(--os-c-red)",
  blue:   "var(--os-c-blue)",
  purple: "var(--os-brand)",
  pink:   "var(--os-c-red)",
  indigo: "var(--os-brand-deep)",
  teal:   "var(--os-c-teal)",
  lime:   "var(--os-c-sage)",
  brown:  "var(--os-c-brown)",
  yellow: "var(--os-c-yellow)",
  sage:   "var(--os-c-sage)",
  gray:   "var(--os-c-gray)",
};

// Same deal: gradient keys are legacy names; values are design-system only.
export const GRAD = {
  orangePink:  "linear-gradient(135deg, var(--os-c-orange), var(--os-c-red))",
  pinkPurple:  "linear-gradient(135deg, var(--os-brand), var(--os-brand-deep))",
  bluePurple:  "linear-gradient(135deg, var(--os-c-blue), var(--os-brand-deep))",
  greenTeal:   "linear-gradient(135deg, var(--os-c-green), var(--os-c-teal))",
  indigoBlue:  "linear-gradient(135deg, var(--os-brand), var(--os-c-blue))",
  redPink:     "linear-gradient(135deg, var(--os-c-red), #C62D42)",
  brownOrange: "linear-gradient(135deg, var(--os-c-brown), var(--os-c-orange))",
  purpleIndigo:"linear-gradient(135deg, var(--os-brand), var(--os-brand-deep))",
  tealGreen:   "linear-gradient(135deg, var(--os-c-teal), var(--os-c-green))",
  yellowOrange:"linear-gradient(135deg, var(--os-c-yellow), var(--os-c-orange))",
};
