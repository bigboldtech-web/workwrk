// Marketing primitives — the shared design system for every page under
// /(marketing).
//
// Aesthetic: ClickUp / Linear / Workday restraint.
//   - White is the canvas. Black is the ink.
//   - Massive confident headlines in slate-900, never rainbow gradients.
//   - Color emerges from product visuals (mocks, icons), not from chrome.
//   - At most ONE accent per section — usually a small label or a single
//     icon tint. Never a multi-hue gradient on a hero CTA.
//   - Dark sections (slate-950) are used deliberately for product moments,
//     the way ClickUp uses dark for their AI / Brain sections.
//
// Server component — no "use client". The primitives are pure markup;
// the only interactive element (FAQ accordion) uses native <details>.

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { ArrowRight, type LucideIcon } from "lucide-react";

// ════════════════════════════════════════════════════════════════════
// HUE SYSTEM — used sparingly. Most things should be black/white/slate.
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

export const HUES: Record<Hue, HueTokens> = {
  violet:  { hex: "#7c3aed", text: "text-violet-700",  textStrong: "text-violet-900",  bgTint: "bg-violet-50",  bgSoft: "bg-violet-100",  bgStrong: "bg-violet-600",  bgStrongHover: "hover:bg-violet-700",  border: "border-violet-200",  ring: "ring-violet-200",  grad: "from-violet-500 to-purple-600",   gradVia: "from-violet-500 via-violet-600 to-violet-700" },
  fuchsia: { hex: "#d946ef", text: "text-fuchsia-700", textStrong: "text-fuchsia-900", bgTint: "bg-fuchsia-50", bgSoft: "bg-fuchsia-100", bgStrong: "bg-fuchsia-600", bgStrongHover: "hover:bg-fuchsia-700", border: "border-fuchsia-200", ring: "ring-fuchsia-200", grad: "from-fuchsia-500 to-pink-600",    gradVia: "from-fuchsia-500 via-fuchsia-600 to-fuchsia-700" },
  pink:    { hex: "#ec4899", text: "text-pink-700",    textStrong: "text-pink-900",    bgTint: "bg-pink-50",    bgSoft: "bg-pink-100",    bgStrong: "bg-pink-600",    bgStrongHover: "hover:bg-pink-700",    border: "border-pink-200",    ring: "ring-pink-200",    grad: "from-pink-500 to-rose-600",       gradVia: "from-pink-500 via-pink-600 to-pink-700" },
  coral:   { hex: "#f97316", text: "text-orange-700",  textStrong: "text-orange-900",  bgTint: "bg-orange-50",  bgSoft: "bg-orange-100",  bgStrong: "bg-orange-600",  bgStrongHover: "hover:bg-orange-700",  border: "border-orange-200",  ring: "ring-orange-200",  grad: "from-orange-500 to-amber-500",    gradVia: "from-orange-500 via-orange-600 to-orange-700" },
  amber:   { hex: "#f59e0b", text: "text-amber-700",   textStrong: "text-amber-900",   bgTint: "bg-amber-50",   bgSoft: "bg-amber-100",   bgStrong: "bg-amber-500",   bgStrongHover: "hover:bg-amber-600",   border: "border-amber-200",   ring: "ring-amber-200",   grad: "from-amber-400 to-orange-500",    gradVia: "from-amber-500 via-amber-600 to-amber-700" },
  emerald: { hex: "#10b981", text: "text-emerald-700", textStrong: "text-emerald-900", bgTint: "bg-emerald-50", bgSoft: "bg-emerald-100", bgStrong: "bg-emerald-600", bgStrongHover: "hover:bg-emerald-700", border: "border-emerald-200", ring: "ring-emerald-200", grad: "from-emerald-500 to-teal-600",    gradVia: "from-emerald-500 via-emerald-600 to-emerald-700" },
  teal:    { hex: "#14b8a6", text: "text-teal-700",    textStrong: "text-teal-900",    bgTint: "bg-teal-50",    bgSoft: "bg-teal-100",    bgStrong: "bg-teal-600",    bgStrongHover: "hover:bg-teal-700",    border: "border-teal-200",    ring: "ring-teal-200",    grad: "from-teal-500 to-sky-600",        gradVia: "from-teal-500 via-teal-600 to-teal-700" },
  sky:     { hex: "#0ea5e9", text: "text-sky-700",     textStrong: "text-sky-900",     bgTint: "bg-sky-50",     bgSoft: "bg-sky-100",     bgStrong: "bg-sky-600",     bgStrongHover: "hover:bg-sky-700",     border: "border-sky-200",     ring: "ring-sky-200",     grad: "from-sky-500 to-indigo-600",      gradVia: "from-sky-500 via-sky-600 to-sky-700" },
  indigo:  { hex: "#6366f1", text: "text-indigo-700",  textStrong: "text-indigo-900",  bgTint: "bg-indigo-50",  bgSoft: "bg-indigo-100",  bgStrong: "bg-indigo-600",  bgStrongHover: "hover:bg-indigo-700",  border: "border-indigo-200",  ring: "ring-indigo-200",  grad: "from-indigo-500 to-violet-600",   gradVia: "from-indigo-500 via-indigo-600 to-indigo-700" },
  rose:    { hex: "#f43f5e", text: "text-rose-700",    textStrong: "text-rose-900",    bgTint: "bg-rose-50",    bgSoft: "bg-rose-100",    bgStrong: "bg-rose-600",    bgStrongHover: "hover:bg-rose-700",    border: "border-rose-200",    ring: "ring-rose-200",    grad: "from-rose-500 to-pink-600",       gradVia: "from-rose-500 via-rose-600 to-rose-700" },
};

// Hub catalog — the 7 product surfaces of workwrk. The marketing site
// repeatedly references these. Each hub still owns one hue so its icon
// can carry a tint, but the chrome around it stays neutral.
export interface Hub {
  slug: string;
  name: string;
  tagline: string;
  hue: Hue;
}

export const HUBS: readonly Hub[] = [
  { slug: "home",    name: "Home",    tagline: "The morning command center",       hue: "indigo"  },
  { slug: "people",  name: "People",  tagline: "Org, roles, performance",          hue: "violet"  },
  { slug: "work",    name: "Work",    tagline: "Tasks, OKRs, KPIs, SOPs, Process", hue: "sky"     },
  { slug: "money",   name: "Money",   tagline: "Spend, vendors, financials",       hue: "emerald" },
  { slug: "talent",  name: "Talent",  tagline: "Reviews, comp, onboarding",        hue: "fuchsia" },
  { slug: "culture", name: "Culture", tagline: "Kudos, ideas, surveys",            hue: "pink"    },
  { slug: "growth",  name: "Growth",  tagline: "Pipeline, deals, customers",       hue: "amber"   },
] as const;

// ════════════════════════════════════════════════════════════════════
// LAYOUT — containers, sections, spacing.
// ════════════════════════════════════════════════════════════════════

export function Container({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`max-w-7xl mx-auto px-6 lg:px-10 ${className}`}>
      {children}
    </div>
  );
}

// Section — vertical rhythm and an optional background variant.
//   - default: plain white
//   - tint:    pale slate (rest stop between bright sections)
//   - dark:    slate-950 — for AI / product moment sections (ClickUp-style)
//   - mesh:    barely-there backdrop. Just a clean off-white wash; no
//              rainbow blobs. The legacy "mesh" name is kept so existing
//              pages don't need to change.
export function Section({
  children,
  className = "",
  variant = "default",
  id,
  py = "lg",
}: {
  children: ReactNode;
  className?: string;
  variant?: "default" | "tint" | "dark" | "mesh";
  id?: string;
  py?: "sm" | "md" | "lg" | "xl";
}) {
  const pad =
    py === "sm" ? "py-12 lg:py-16" :
    py === "md" ? "py-16 lg:py-20" :
    py === "lg" ? "py-20 lg:py-28" :
                  "py-28 lg:py-36";

  const bg =
    variant === "tint" ? "bg-slate-50" :
    variant === "dark" ? "bg-slate-950 text-white" :
    variant === "mesh" ? "bg-white" :
    "bg-white";

  return (
    <section id={id} className={`${bg} ${pad} ${className}`}>
      <div className="relative">{children}</div>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════
// TYPOGRAPHY — eyebrow, headings, lede.
//
// Eyebrow = ClickUp's tiny tracked uppercase label ("REVENUE INCREASE").
// Plain text, no chip, no dot. The `hue` prop only tints the small
// label text — chrome stays neutral.
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
  const color = invert ? "text-white/70" : HUES[hue].text;
  return (
    <span
      className={`inline-block text-[11px] font-bold uppercase tracking-[0.18em] ${color} ${className}`}
    >
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
  return (
    <h1
      className={`font-bold tracking-[-0.035em] ${invert ? "text-white" : "text-slate-900"} ${className}`}
      style={{
        fontSize: "clamp(2.4rem, 5.6vw, 4.5rem)",
        lineHeight: 1.02,
      }}
    >
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
  return (
    <h2
      className={`font-bold tracking-[-0.03em] ${invert ? "text-white" : "text-slate-900"} ${className}`}
      style={{
        fontSize: "clamp(1.9rem, 3.6vw, 3rem)",
        lineHeight: 1.08,
      }}
    >
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
  return (
    <h3
      className={`text-xl lg:text-2xl font-bold tracking-tight ${invert ? "text-white" : "text-slate-900"} ${className}`}
    >
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
  return (
    <p
      className={`text-lg lg:text-xl ${invert ? "text-white/75" : "text-slate-600"} leading-relaxed max-w-2xl ${className}`}
    >
      {children}
    </p>
  );
}

// Accent span — for highlighting a single word/phrase inside a headline.
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
  if (subtle) {
    return <span className={`text-slate-500 ${className}`}>{children}</span>;
  }
  return (
    <span className={`${HUES[hue].text} ${className}`}>{children}</span>
  );
}

// ════════════════════════════════════════════════════════════════════
// BUTTONS
//   primary   = solid slate-900 pill (ClickUp's signature)
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
  const sizeCls =
    size === "sm" ? "h-9 px-4 text-[13px]" :
    size === "lg" ? "h-12 px-6 text-[15px]" :
                    "h-10 px-5 text-sm";

  const t = HUES[hue];
  const variantCls =
    variant === "primary"
      ? `bg-slate-900 text-white hover:bg-slate-800`
      : variant === "secondary"
      ? `${t.bgStrong} text-white ${t.bgStrongHover}`
      : variant === "invert"
      ? `bg-white text-slate-900 hover:bg-slate-100`
      : variant === "outline"
      ? `bg-white text-slate-900 border border-slate-200 hover:border-slate-300 hover:bg-slate-50`
      : `text-slate-600 hover:text-slate-900 hover:bg-slate-100`;

  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-1.5 rounded-full font-semibold transition-colors ${sizeCls} ${variantCls} ${className}`}
    >
      {leftIcon}
      {children}
      {rightIcon}
    </Link>
  );
}

// ════════════════════════════════════════════════════════════════════
// CARDS — base + product cards. Restrained: thin slate-200 border,
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

// Hub tile — represents a product hub. The icon carries the hue; the
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
          <p className="text-xs text-slate-500 mt-1.5">{hub.tagline}</p>
        </div>
      </div>

      <p className="mt-4 text-sm text-slate-600 leading-relaxed">{description}</p>

      {features && features.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {features.map((f) => (
            <li key={f} className="flex items-start gap-2 text-sm text-slate-700">
              <span className="mt-1.5 w-1 h-1 rounded-full bg-slate-400 flex-shrink-0" aria-hidden />
              {f}
            </li>
          ))}
        </ul>
      )}

      {href && (
        <div className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-slate-900 group-hover:gap-2 transition-all">
          Explore {hub.name}
          <ArrowRight size={14} />
        </div>
      )}
    </div>
  );

  return href ? <Link href={href}>{body}</Link> : body;
}

// Feature card — icon + title + body. Icon takes a tint; card stays neutral.
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
      <p className="mt-2 text-sm text-slate-600 leading-relaxed">{body}</p>
    </div>
  );
}

// Stat card — giant black number, tiny purple eyebrow label, slate body.
// Patterned on ClickUp's stats strip ("REVENUE INCREASE / $3.9M / ...").
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
      <p className={`text-[10px] font-bold uppercase tracking-[0.18em] ${invert ? "text-white/60" : t.text}`}>
        {label}
      </p>
      <p className={`mt-3 text-5xl lg:text-6xl font-bold tracking-tight ${invert ? "text-white" : "text-slate-900"}`}>
        {value}
      </p>
      {body && (
        <p className={`mt-4 text-sm leading-relaxed ${invert ? "text-white/70" : "text-slate-600"}`}>
          {body}
        </p>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// PAGE HERO — for inner pages. Black headline, no gradient noise.
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
// CTA BAND — dark slate, ClickUp-style. No multi-hue gradient.
// ════════════════════════════════════════════════════════════════════

export function CTABand({
  title,
  body,
  primary = { label: "Get started", href: "/signup" },
  secondary = { label: "Talk to sales", href: "/demo" },
}: {
  title?: ReactNode;
  body?: ReactNode;
  primary?: { label: string; href: string };
  secondary?: { label: string; href: string };
  // hue kept for API compat but no longer used — palette is neutral.
  hue?: Hue;
}) {
  return (
    <section className="bg-slate-950 text-white">
      <Container className="py-24 lg:py-32">
        <div className="max-w-3xl">
          <h2
            className="font-bold tracking-[-0.03em]"
            style={{ fontSize: "clamp(2rem, 4vw, 3rem)", lineHeight: 1.08 }}
          >
            {title ?? <>Stop juggling tools.<br/>Start running the business.</>}
          </h2>
          {body && (
            <p className="mt-6 text-white/75 text-lg leading-relaxed max-w-xl">{body}</p>
          )}
          <div className="mt-9 flex flex-wrap gap-3">
            <Link
              href={primary.href}
              className="inline-flex items-center gap-1.5 h-12 px-6 rounded-full bg-white text-slate-900 font-semibold hover:bg-slate-100 transition-colors"
            >
              {primary.label} <ArrowRight size={16} />
            </Link>
            <Link
              href={secondary.href}
              className="inline-flex items-center gap-1.5 h-12 px-6 rounded-full bg-transparent text-white border border-white/20 font-semibold hover:bg-white/10 transition-colors"
            >
              {secondary.label}
            </Link>
          </div>
        </div>
      </Container>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════
// FAQ — accordion using <details> for SSR-friendly, JS-free expand.
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
                  <span className="font-semibold text-slate-900 text-base lg:text-[17px]">{it.q}</span>
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
// LOGO CLOUD — trust strip. Plain slate-400 wordmarks.
// ════════════════════════════════════════════════════════════════════

export function LogoCloud({
  title = "Trusted by operators at",
  brands = ["Helios Labs", "Nimbus Logistics", "Lattice & Co", "Quill Health", "Forge Capital", "Stratum AI"],
  invert = false,
}: {
  title?: string;
  brands?: readonly string[];
  invert?: boolean;
}) {
  return (
    <div className="text-center">
      <p className={`text-[11px] font-bold uppercase tracking-[0.22em] ${invert ? "text-white/50" : "text-slate-400"}`}>{title}</p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-x-12 gap-y-5">
        {brands.map((b) => (
          <span
            key={b}
            className={`font-bold text-lg tracking-tight ${invert ? "text-white/40 hover:text-white/70" : "text-slate-400 hover:text-slate-600"} transition-colors`}
            style={{ fontVariant: "small-caps", letterSpacing: "0.02em" }}
          >
            {b}
          </span>
        ))}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// QUOTE — a clean editorial pull-quote. White card, slate border.
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
      <figcaption className="mt-7 text-sm text-slate-500">
        <span className="font-bold text-slate-900">{author}</span> &middot; {role}, {company}
      </figcaption>
    </figure>
  );
}

// ════════════════════════════════════════════════════════════════════
// CHECK LIST — for feature bullets. Neutral by default; hue accent is
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
