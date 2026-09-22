// Marketing primitives: the shared design system for every page under
// /(marketing).
//
// Aesthetic: the restraint of the category's best work.
//   - White is the canvas. Black is the ink.
//   - Massive confident headlines in slate-900, never rainbow gradients.
//   - Color emerges from product visuals (mocks, icons), not from chrome.
//   - At most ONE accent per section, usually a small label or a single
//     icon tint. Never a multi-hue gradient on a hero CTA.
//   - Light only. The navy chrome inside a product frame is the only dark
//     element on the public site, and a page section never paints it.
//
// Server component, no "use client". The primitives are pure markup;
// the only interactive element (FAQ accordion) uses native <details>.

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, type LucideIcon } from "lucide-react";
import { flags } from "./flags";
import { PrimaryCta, SecondaryCta } from "./cta";
import { FINAL_HEADLINE } from "./home/content";

// ════════════════════════════════════════════════════════════════════
// HUE SYSTEM. One accent; the ten keys survive for the call sites.
// Hues exist for: product hub icons, small accent labels, occasional
// product mock fills. Never for chrome (buttons, sections, rims).
// ════════════════════════════════════════════════════════════════════

export type Hue =
  | "violet"
  | "fuchsia"
  | "pink"
  | "coral"
  | "amber"
  | "emerald"
  | "teal"
  | "sky"
  | "indigo"
  | "rose";

interface HueTokens {
  hex: string;
  text: string;
  textStrong: string;
  bgTint: string;
  bgSoft: string;
  bgStrong: string;
  bgStrongHover: string;
  border: string;
  ring: string;
  grad: string;
  gradVia: string;
}

// ONE ACCENT. The ten hue keys survive because two dozen pages name them,
// but every one of them now resolves to the same token set: the product's
// one blue on the product's neutral ramp. Phase 10's rule is a light only
// site with a single accent and the four brand dots quarantined to
// src/components/brand, which the ten-hue table broke on every page that
// had not been rebuilt: a violet H1 here, an emerald icon tile there, a
// three-stop gradient on a card rim.
//
// Repointing the table rather than editing twenty six pages is deliberate.
// The pages keep their structure, their words and their hue props, and the
// palette becomes a thing one file decides. `grad` and `gradVia` are kept
// as class strings so `bg-gradient-to-br ${t.gradVia}` still parses, and
// both ends are the same colour, so what paints is a flat fill.
//
// The class names are the mk-a-* rules in src/app/(marketing)/marketing.css,
// which read the --os-* tokens. No hex is written here: one palette, one
// file, and a class that cannot drift from the token it names.
//
// `hex` is the exception and is unavoidable: a handful of call sites pass it
// to an inline style or an SVG fill, where a class cannot reach. It is the
// one blue, --os-brand.
const ACCENT: HueTokens = {
  hex: "var(--os-brand)",
  text: "mk-a-text",
  textStrong: "mk-a-ink",
  bgTint: "mk-a-tint",
  bgSoft: "mk-a-soft",
  bgStrong: "mk-a-solid",
  bgStrongHover: "mk-a-solid-hoverable",
  border: "mk-a-line",
  ring: "",
  grad: "mk-a-solid",
  gradVia: "mk-a-solid",
};

export const HUES: Record<Hue, HueTokens> = {
  violet: ACCENT,
  fuchsia: ACCENT,
  pink: ACCENT,
  coral: ACCENT,
  amber: ACCENT,
  emerald: ACCENT,
  teal: ACCENT,
  sky: ACCENT,
  indigo: ACCENT,
  rose: ACCENT,
};

// Hub catalog. These are the EIGHT blocks the whole site names, in rail
// order, and they are the same eight the Tuesday fixture carries. The list
// used to be seven hubs from the pre-refresh taxonomy (Home, People, Work,
// Money, Talent, Culture, Growth), three of which are not the product:
// WorkwrK is a people and project management system, and CRM, finance and
// helpdesk were taken out of its scope. A sub-page saying it was "part of
// the Money hub" was pointing at a hub that does not exist.
//
// The hue survives as a field so nothing has to change at the call sites,
// and every one of them resolves to the one accent.
export interface Hub {
  slug: string;
  name: string;
  tagline: string;
  hue: Hue;
}

export const HUBS: readonly Hub[] = [
  { slug: "work",    name: "Work",    tagline: "Tasks, lists, boards, every view", hue: "sky" },
  { slug: "planner", name: "Planner", tagline: "Calendar and time",                hue: "sky" },
  { slug: "ai",      name: "AI",      tagline: "Ask, on every page",               hue: "indigo" },
  { slug: "talk",    name: "Talk",    tagline: "Channels, calls, threads",         hue: "indigo" },
  { slug: "teams",   name: "Teams",   tagline: "Directory, roles, reviews, kudos", hue: "violet" },
  { slug: "docs",    name: "Docs",    tagline: "Docs, SOPs, policies, contracts",  hue: "violet" },
  { slug: "tables",  name: "Tables",  tagline: "Sheets and forms",                 hue: "emerald" },
  { slug: "goals",   name: "Goals",   tagline: "OKRs, KRAs, KPIs",                 hue: "emerald" },
] as const;

// ════════════════════════════════════════════════════════════════════
// LAYOUT: containers, sections, spacing.
// ════════════════════════════════════════════════════════════════════

export function Container({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  // `mk-wrap`, the site's one column: 1200 max with a 20/24 gutter, which
  // is a 144px offset at 1440. It used to be `max-w-7xl px-6 lg:px-10`,
  // a 1280 column with a 40px gutter, which is 120 at 1440. Two gutters on
  // one site is the difference a reader sees when they follow a nav link
  // from a rebuilt page to a legacy one: the page appears to shift.
  return <div className={`mk-wrap ${className}`}>{children}</div>;
}

// Section: vertical rhythm and an optional background variant.
//   - default: plain white
//   - tint:    the quiet surface (a rest stop between white sections)
//   - dark:    kept for API compatibility; paints the same quiet surface
//   - mesh:    barely-there backdrop. Just a clean off-white wash; no
//              rainbow blobs. The legacy "mesh" name is kept so existing
//              pages don't need to change.
export function Section({
  children,
  className = "",
  variant = "default",
  id,
  py = "lg",
  pb,
}: {
  children: ReactNode;
  className?: string;
  variant?: "default" | "tint" | "dark" | "mesh";
  id?: string;
  py?: "sm" | "md" | "lg" | "xl";
  /**
   * Bottom padding, when it should not match the top.
   *
   * A hero band and the band under it each pay their own full rhythm, so a
   * `lg` hero above an `md` band puts 192px of nothing between the last
   * thing the hero says and the first card. On /blog that landed between
   * the category filters and the first post and read as a failed render
   * rather than as rhythm: it was the only gap of its size on the site.
   */
  pb?: "none" | "sm" | "md" | "lg" | "xl";
}) {
  const scale = {
    none: "",
    sm: "py-12 lg:py-16",
    md: "py-16 lg:py-20",
    lg: "py-20 lg:py-28",
    xl: "py-28 lg:py-36",
  } as const;
  // Each override carries its own `lg:` too. Without it the base `pb-0`
  // loses to the scale's `lg:py-28` from 1024 up, because Tailwind emits
  // every lg variant after every base utility and both are one class: the
  // override worked on a phone and did nothing on a desktop.
  const bottom = {
    none: "pb-0 lg:pb-0",
    sm: "pb-12 lg:pb-16",
    md: "pb-16 lg:pb-20",
    lg: "pb-20 lg:pb-28",
    xl: "pb-28 lg:pb-36",
  } as const;
  const pad = pb ? `${scale[py]} ${bottom[pb]}` : scale[py];

  // Light only (concept 10). There is no dark block on the public site: the
  // navy chrome inside a product frame is the only dark element anywhere,
  // and it is drawn by MarketingShell, never by a page section. The "dark"
  // variant is kept so an old call site still type checks, and it paints the
  // quiet tint the rest of the site uses for a rest stop.
  const bg =
    variant === "tint" || variant === "dark" ? "mk-quiet" : "mk-white";

  return (
    <section id={id} className={`${bg} ${pad} ${className}`}>
      <div className="relative">{children}</div>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════
// TYPOGRAPHY: eyebrow, headings, lede.
//
// Eyebrow: the small tracked uppercase label above a heading.
// Plain text, no chip, no dot. The `hue` prop only tints the small
// label text; chrome stays neutral.
// ════════════════════════════════════════════════════════════════════

export function Eyebrow({
  children,
  hue = "violet",
  className = "",
  invert = false,
}: {
  children: ReactNode;
  hue?: Hue;
  className?: string;
  invert?: boolean;
}) {
  // `mk-eyebrow` is the grammar's own label: 12px, weight 600, 0.04em, and
  // ink-2 GREY. It used to be weight 700 at 0.18em in the hue's blue, which
  // put a blue eyebrow over half the site's H1s and a grey one over the
  // other half. The hue prop is kept because two dozen pages pass it and is
  // no longer read: there is one eyebrow.
  void hue;
  return (
    <span className={`mk-eyebrow ${invert ? "text-white/70" : ""} ${className}`}>
      {children}
    </span>
  );
}

export function H1({
  children,
  className = "",
  invert = false,
}: {
  children: ReactNode;
  className?: string;
  invert?: boolean;
}) {
  // The ramp, not a second one. `mk-display-md` is 48 then 64 at weight
  // 600 with leading 1.05, defined once in marketing-shell.css, and it is
  // the class every rebuilt sub page's H1 already carries: /pricing,
  // /tuesday, /how-it-connects, /demo, /roadmap and every /product chapter.
  // The top rung, 72, belongs to the home hero alone.
  //
  // This used to be a clamp topping out at 72px at weight 700 in
  // text-slate-900: a fourth near black, a weight Inter is not loaded at
  // (so the browser synthesised it), and a size that made every legacy sub
  // page shout louder than /pricing. design-system.md section 1 says one
  // ramp at one weight.
  return (
    <h1 className={`mk-display-md ${invert ? "text-white" : "mk-ink"} ${className}`}>
      {children}
    </h1>
  );
}

export function H2({
  children,
  className = "",
  invert = false,
}: {
  children: ReactNode;
  className?: string;
  invert?: boolean;
}) {
  // The section heading rung of the same ramp: 36 then 48. Same weight,
  // same leading, same ink as every rebuilt page's H2.
  return (
    <h2 className={`mk-title-lg ${invert ? "text-white" : "mk-ink"} ${className}`}>
      {children}
    </h2>
  );
}

export function H3({
  children,
  className = "",
  invert = false,
}: {
  children: ReactNode;
  className?: string;
  invert?: boolean;
}) {
  // The third rung: 22 then 26, under the ramp on purpose.
  return (
    <h3 className={`mk-title ${invert ? "text-white" : "mk-ink"} ${className}`}>
      {children}
    </h3>
  );
}

export function Lede({
  children,
  className = "",
  invert = false,
}: {
  children: ReactNode;
  className?: string;
  invert?: boolean;
}) {
  // One reading size, 16, which is what design-system section 1 names for
  // body. The lede used to run at 18 then 20, so a page carried three body
  // sizes and disagreed with the rebuilt half at both breakpoints.
  return (
    <p className={`mk-lede ${invert ? "text-white/75" : ""} ${className}`}>
      {children}
    </p>
  );
}

// Accent span, for de-emphasising part of a headline.
// Default treatment is a tasteful single-tone color shift, NOT a multi-hue
// gradient. Pass `subtle` to get a softened slate-500 emphasis instead.
export function GradientText({
  children,
  hue = "violet",
  className = "",
  subtle = false,
}: {
  children: ReactNode;
  hue?: Hue;
  className?: string;
  subtle?: boolean;
}) {
  // The name is legacy and so is the `hue` prop; both are kept because two
  // dozen pages pass them. What renders is a second INK tone, never a hue
  // and never a gradient: the display ramp is one weight and one colour,
  // and the emphasis in a headline is a shift in tone, not in temperature.
  void hue;
  if (subtle) {
    return <span className={`mk-ink3 ${className}`}>{children}</span>;
  }
  return <span className={`mk-ink2 ${className}`}>{children}</span>;
}

// ════════════════════════════════════════════════════════════════════
// BUTTONS
//   primary   = the one blue, filled
//   secondary = solid hue (used sparingly)
//   outline   = white with a hairline border
//   ghost     = no chrome, hover only
// ════════════════════════════════════════════════════════════════════

export function Button({
  children,
  href,
  variant = "primary",
  hue = "violet",
  size = "md",
  className = "",
  rightIcon,
  leftIcon,
}: {
  children: ReactNode;
  href: string;
  variant?: "primary" | "secondary" | "ghost" | "outline" | "invert";
  hue?: Hue;
  size?: "sm" | "md" | "lg";
  className?: string;
  rightIcon?: ReactNode;
  leftIcon?: ReactNode;
}) {
  // The same geometry CtaLink draws (44px, 8px radius, 16px/500), so a
  // legacy page's button and a rebuilt page's button are the same object.
  const sizeCls =
    size === "sm" ? "h-9 px-4 text-[14px]" :
    size === "lg" ? "h-11 px-5 text-[16px]" :
                    "h-11 px-5 text-[16px]";

  void hue;
  // "primary" and "secondary" are both the one blue: a legacy page names the
  // main door "secondary" and the rebuilt canon calls it primary, and there
  // is only one filled skin on this site either way.
  const variantCls =
    variant === "primary" || variant === "secondary"
      ? "mk-btn mk-btn-solid"
      : variant === "invert" || variant === "outline"
      ? "mk-btn mk-btn-ghost"
      : "mk-btn mk-btn-quiet";

  return (
    <Link
      href={href}
      className={`mk-focus inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors ${sizeCls} ${variantCls} ${className}`}
    >
      {leftIcon}
      {children}
      {rightIcon}
    </Link>
  );
}

// ════════════════════════════════════════════════════════════════════
// CARDS: base and product cards. Restrained: a thin hairline border,
// no gradient rims, no rainbow shadows.
// ════════════════════════════════════════════════════════════════════

export function Card({
  children,
  className = "",
  hover = false,
}: {
  children: ReactNode;
  className?: string;
  hover?: boolean;
}) {
  return (
    <div
      className={`bg-white border border-slate-200 rounded-2xl ${
        hover ? "hover:border-slate-300 transition-colors" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

// Hub tile: one of the eight blocks. The icon carries the accent; the
// card itself stays neutral. No rainbow rim. Hover lifts a touch.
export function HubCard({
  hub,
  icon: Icon,
  description,
  features,
  href,
  size = "md",
}: {
  hub: Hub;
  icon?: LucideIcon;
  description: string;
  features?: readonly string[];
  href?: string;
  size?: "sm" | "md" | "lg";
}) {
  const t = HUES[hub.hue];
  const padding =
    size === "sm" ? "p-5" :
    size === "lg" ? "p-8" :
                    "p-6";

  const body = (
    <div
      className={`group relative ${padding} bg-white border border-slate-200 rounded-2xl hover:border-slate-300 transition-colors`}
    >
      <div className="flex items-center gap-3">
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center ${t.bgTint} ${t.text}`}
        >
          {Icon ? <Icon size={20} strokeWidth={2.2} /> : <span className="font-bold">{hub.name[0]}</span>}
        </div>
        <div>
          <p className="font-bold text-slate-900 text-[15px] leading-none">{hub.name}</p>
          <p className="text-sm mk-ink2 mt-1.5">{hub.tagline}</p>
        </div>
      </div>

      <p className="mt-4 text-base text-slate-600 leading-relaxed">{description}</p>

      {features && features.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {features.map((f) => (
            <li key={f} className="flex items-start gap-2 text-base text-slate-700">
              <span className="mt-1.5 w-1 h-1 rounded-full bg-slate-400 flex-shrink-0" aria-hidden />
              {f}
            </li>
          ))}
        </ul>
      )}

      {href && (
        <div className="mt-5 inline-flex items-center gap-1 text-base font-semibold text-slate-900 group-hover:gap-2 transition-all">
          Explore {hub.name}
          <ArrowRight size={14} />
        </div>
      )}
    </div>
  );

  return href ? <Link href={href}>{body}</Link> : body;
}

// Feature card: icon, title, body. The icon takes a tint; the card stays neutral.
export function FeatureCard({
  icon: Icon,
  title,
  body,
  hue = "violet",
  className = "",
}: {
  icon?: LucideIcon;
  title: string;
  body: string;
  hue?: Hue;
  className?: string;
}) {
  const t = HUES[hue];
  return (
    <div
      className={`group p-6 bg-white border border-slate-200 rounded-2xl hover:border-slate-300 transition-colors ${className}`}
    >
      {Icon && (
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center ${t.bgTint} ${t.text}`}
        >
          <Icon size={18} strokeWidth={2.2} />
        </div>
      )}
      <h3 className="mt-4 font-bold text-slate-900 text-lg tracking-tight">{title}</h3>
      <p className="mt-2 text-base text-slate-600 leading-relaxed">{body}</p>
    </div>
  );
}

// Stat card: a large number, a small tracked label, a quiet body.
// A label, a number, a sentence. Used where a real number exists.
export function StatCard({
  value,
  label,
  body,
  hue = "violet",
  invert = false,
}: {
  value: string;
  label: string;
  body?: string;
  hue?: Hue;
  invert?: boolean;
}) {
  const t = HUES[hue];
  return (
    <div className={`${invert ? "border-white/10" : "border-slate-200"} border-t pt-6`}>
      <p className={`text-[11px] font-bold uppercase tracking-[0.18em] ${invert ? "text-white/60" : t.text}`}>
        {label}
      </p>
      <p className={`mt-3 text-5xl lg:text-6xl font-bold tracking-tight ${invert ? "text-white" : "text-slate-900"}`}>
        {value}
      </p>
      {body && (
        <p className={`mt-4 text-base leading-relaxed ${invert ? "text-white/70" : "text-slate-600"}`}>
          {body}
        </p>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// PAGE HERO, for inner pages. One ink headline, nothing behind it.
// ════════════════════════════════════════════════════════════════════

export function PageHero({
  eyebrow,
  title,
  lede,
  hue = "violet",
  primaryCTA,
  secondaryCTA,
  children,
}: {
  eyebrow?: string;
  title: ReactNode;
  lede?: ReactNode;
  hue?: Hue;
  primaryCTA?: { label: string; href: string };
  secondaryCTA?: { label: string; href: string };
  children?: ReactNode;
}) {
  return (
    <Section variant="mesh" py="lg" className="pt-10 lg:pt-14">
      <Container>
        <div className="max-w-3xl">
          {eyebrow && (
            <Eyebrow hue={hue} className="mb-5">
              {eyebrow}
            </Eyebrow>
          )}
          <H1>{title}</H1>
          {lede && <div className="mt-5"><Lede>{lede}</Lede></div>}
          {(primaryCTA || secondaryCTA) && (
            <div className="mt-8 flex flex-wrap items-center gap-3">
              {primaryCTA && (
                <Button href={primaryCTA.href} variant="primary" size="lg" rightIcon={<ArrowRight size={16} />}>
                  {primaryCTA.label}
                </Button>
              )}
              {secondaryCTA && (
                <Button href={secondaryCTA.href} variant="outline" size="lg">
                  {secondaryCTA.label}
                </Button>
              )}
            </div>
          )}
        </div>
        {children && <div className="mt-12">{children}</div>}
      </Container>
    </Section>
  );
}

// ════════════════════════════════════════════════════════════════════
// CTA BAND. Light, like the rest of the site: a quiet tinted band, one
// blue button, one ghost beside it. It used to be a slate-950 slab, which
// is the dark block the light only rule exists to stop.
// ════════════════════════════════════════════════════════════════════

/**
 * TWO THINGS THIS BAND GOT WRONG, ON NINETEEN OF THE FORTY ROUTES.
 *
 * 1. THE DEFAULT HEADLINE WAS THE OLD SITE'S.
 *
 * It read "Stop juggling tools. Start running the business.", which is not
 * in the concept's section 8 headline set and is the pre-rebuild voice. The
 * pages that pass their own title (/, /pricing, /tuesday, /compare, /product,
 * /how-it-connects) close on the new copy; the twelve /features pages, the
 * seven /industries pages and the four legal pages take the default, so
 * nearly half the site closed in the voice the rebuild replaced. The default
 * is now the section 8 line the home page's own closer uses.
 *
 * 2. ITS BUTTON WAS THE ONE UNINSTRUMENTED CTA ON THE SITE.
 *
 * It rendered a bare `href="/signup"` with no `utm_content` and no
 * `data-cta`. Concept 6.3 asks for distinct data-cta ids on every placement
 * and 7.3 asks for utm_content carrying the placement id, and this is the
 * bottom-of-page conversion button: on nineteen routes the last thing a
 * visitor could click was the one click nobody could attribute. Worse, it
 * hard coded the label and the destination, so `ctaPrimary` (the config flag
 * that flips the whole site to demo-first in an afternoon) would have flipped
 * every CTA on the site except this one, leaving "Start free" pointing at a
 * signup page on exactly the pages whose whole point was to stop doing that.
 *
 * Both buttons now go through the same components every other CTA on the
 * site goes through, which is why `placement` is REQUIRED rather than
 * defaulted: a defaulted placement id is nineteen placements sharing one
 * number, which is the same as not measuring them. TypeScript asks the
 * caller for it, so a new page cannot ship uninstrumented by omission.
 *
 * `primary` and `secondary` remain for the three callers that need their own
 * words, and they still route through the measured link.
 */
export function CTABand({
  placement,
  title,
  body,
  primary,
  secondary,
}: {
  /** The measurement id for this page's closing button. One per page. */
  placement: string;
  title?: ReactNode;
  body?: ReactNode;
  /** Overrides the primary label only. The destination stays the config's. */
  primary?: { label?: string };
  /** Overrides the secondary label only. */
  secondary?: { label?: string };
  // hue kept for API compat but no longer used: the palette is one blue.
  hue?: Hue;
}) {
  return (
    <section className="mk-quiet mk-topline">
      <Container className="py-20 lg:py-24">
        <div className="max-w-3xl">
          <h2
            className="font-semibold tracking-[-0.02em] mk-a-ink"
            style={{ fontSize: "clamp(2rem, 4vw, 3rem)", lineHeight: 1.05 }}
          >
            {title ?? FINAL_HEADLINE}
          </h2>
          {body && <p className="mt-5 mk-ink2 text-lg leading-relaxed max-w-xl">{body}</p>}
          <div className="mt-8 flex flex-wrap gap-3">
            <PrimaryCta placement={placement} label={primary?.label} />
            <SecondaryCta placement={placement} label={secondary?.label} />
          </div>
        </div>
      </Container>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════
// FAQ: an accordion built on <details>, so it opens with no JavaScript.
// ════════════════════════════════════════════════════════════════════

export function FAQ({
  items,
  title = "Frequently asked questions",
  eyebrow = "FAQ",
  hue = "violet",
}: {
  items: readonly { q: string; a: ReactNode }[];
  title?: string;
  eyebrow?: string;
  hue?: Hue;
}) {
  return (
    <Section variant="tint" py="lg">
      <Container>
        <div className="grid lg:grid-cols-[1fr_2fr] gap-12">
          <div>
            <Eyebrow hue={hue} className="mb-4">{eyebrow}</Eyebrow>
            <H2>{title}</H2>
            <p className="mt-5 text-slate-600">
              Still curious?{" "}
              <Link href="/contact" className="font-semibold text-slate-900 underline underline-offset-4 decoration-2 decoration-slate-300 hover:decoration-slate-900">
                Chat with the team.
              </Link>
            </p>
          </div>
          <div className="divide-y divide-slate-200 border border-slate-200 rounded-2xl bg-white">
            {items.map((it, i) => (
              <details key={i} className="group p-6 lg:p-7 [&_summary::-webkit-details-marker]:hidden">
                <summary className="flex items-center justify-between gap-6 cursor-pointer list-none">
                  <span className="font-semibold text-slate-900 text-lg lg:text-[17px]">{it.q}</span>
                  <span className="w-8 h-8 rounded-full bg-slate-100 group-hover:bg-slate-200 flex items-center justify-center text-slate-600 transition-all group-open:rotate-45">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 1v12M1 7h12" /></svg>
                  </span>
                </summary>
                <div className="mt-4 text-slate-600 leading-relaxed text-[15px]">{it.a}</div>
              </details>
            ))}
          </div>
        </div>
      </Container>
    </Section>
  );
}

// ════════════════════════════════════════════════════════════════════
// LOGO CLOUD. A trust strip is a claim about who uses the product, so it
// answers to `flags.customerLogos`. It used to ship six invented company
// names as its DEFAULT argument, which meant a page got a fabricated
// customer list by calling <LogoCloud /> with nothing at all. There is no
// default list now and the whole strip renders nothing until the flag is
// true and real names are passed.
// ════════════════════════════════════════════════════════════════════

export function LogoCloud({
  title = "Trusted by operators at",
  brands,
  invert = false,
}: {
  title?: string;
  brands?: readonly string[];
  invert?: boolean;
}) {
  if (!flags.customerLogos || !brands || brands.length === 0) return null;
  return (
    <div className="text-center">
      <p className={`text-[12px] font-bold uppercase tracking-[0.18em] ${invert ? "text-white/60" : "mk-ink2"}`}>{title}</p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-x-12 gap-y-5">
        {brands.map((b) => (
          <span
            key={b}
            className={`font-semibold text-lg tracking-tight ${invert ? "text-white/70" : "mk-ink2"}`}
          >
            {b}
          </span>
        ))}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// QUOTE: an editorial pull quote. White card, hairline border.
// ════════════════════════════════════════════════════════════════════

export function Quote({
  quote,
  author,
  role,
  company,
}: {
  quote: ReactNode;
  author: string;
  role: string;
  company: string;
  hue?: Hue;
}) {
  return (
    <figure className="p-8 lg:p-12 rounded-2xl bg-white border border-slate-200">
      <blockquote
        className="text-2xl lg:text-3xl text-slate-900 font-medium tracking-[-0.015em] leading-snug max-w-3xl"
      >
        &ldquo;{quote}&rdquo;
      </blockquote>
      <figcaption className="mt-7 text-base mk-ink2">
        <span className="font-bold text-slate-900">{author}</span> &middot; {role}, {company}
      </figcaption>
    </figure>
  );
}

// ════════════════════════════════════════════════════════════════════
// CHECK LIST, for feature bullets. Neutral by default; the accent is
// only on the tiny check icon.
// ════════════════════════════════════════════════════════════════════

export function CheckList({
  items,
  hue = "violet",
  className = "",
  invert = false,
}: {
  items: readonly (string | ReactNode)[];
  hue?: Hue;
  className?: string;
  invert?: boolean;
}) {
  const t = HUES[hue];
  return (
    <ul className={`space-y-3 ${className}`}>
      {items.map((item, i) => (
        <li key={i} className={`flex items-start gap-3 text-[15px] ${invert ? "text-white/85" : "text-slate-700"}`}>
          <span className={`mt-1 flex items-center justify-center w-4 h-4 ${invert ? "text-white/60" : t.text} flex-shrink-0`}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1.5 6.5l3 3 7-7" />
            </svg>
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
