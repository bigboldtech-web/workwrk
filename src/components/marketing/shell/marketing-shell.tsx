// MarketingShell: the navy chrome the whole public site draws inside
// (marketing-concept.md 1.1, 12 Phase 0 item 3, design-system 4 and 13.1).
//
// "Navy chrome frames a white canvas." The 8 hub rail and the top bar are
// one dark navy, the secondary sidebar is light grey, everything the user
// works on is white, and exactly one blue button sits on the canvas. That
// silhouette is readable at thumbnail size, which is the point: a hero
// block, an OG card and a screenshot all read as the same object.
//
// Static and non-interactive by construction. No handlers, no state, no
// client boundary. The shell is an ILLUSTRATION of the product, so it is
// exposed to assistive technology as one labelled figure and its chrome is
// aria-hidden: a screen reader gets the caption and the page's own prose,
// not forty fake buttons it cannot press. When the sandbox arrives in
// Phase 3 it becomes a real focusable DOM and that decision is revisited
// there, not here.
//
// The rail and the product's rail, and where they differ.
//
// The product's rail is eight hubs in this order (src/lib/nav/route-hub.ts,
// HUB_KEYS): home, planner, ai, chat, teams, docs, tables, settings. The
// site's eight blocks are the eight the STORY uses, which is the same list
// with Goals in place of Settings, because /okrs lives under the home hub
// in the product and the story needs the goal to be a thing of its own.
//
// Two of those eight also carry the site's names rather than the code's:
// Work is `home` and Talk is `chat`. Those are the product's own UI labels
// and are not a deviation.
//
// Goals in the rail IS a deviation and it is deliberate, but the version
// that shipped compounded it: the rail ENDED at Goals, so Settings was
// missing from the frame entirely, and a visitor learning the chrome here
// would look for it after signup and not find it where the site put it.
// The rail now ends with Settings, pinned to the bottom exactly as the
// product pins it, and Goals keeps its slot above. Nine icons where the
// product draws eight is the smaller inaccuracy of the two: an icon that is
// in the wrong group is a misfiling, an icon that is absent is a hole.

import type { ReactNode } from "react";
import {
  BarChart3,
  Bell,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Clock,
  FileSignature,
  FileText,
  MessagesSquare,
  PenLine,
  Plus,
  Search,
  Settings,
  Sheet,
  Sparkles,
  SquareKanban,
  Star,
  Target,
  Users,
  Video,
  BookOpen,
} from "lucide-react";
import { LogoMark } from "@/components/brand/logo";
import { tuesday } from "../data/tuesday";
import "./marketing-shell.css";

/** The Lucide set the fixture and the pricing categories name, 1.5px stroke, resolved here. */
const ICONS = {
  SquareKanban,
  CalendarDays,
  Sparkles,
  MessagesSquare,
  Users,
  FileText,
  Sheet,
  Target,
  BookOpen,
  Video,
  ClipboardList,
  Star,
  BarChart3,
  Clock,
  PenLine,
  FileSignature,
} as const;

export type IconName = keyof typeof ICONS;

export function MkIcon({ name, size = 20 }: { name: string; size?: number }) {
  const Cmp = ICONS[name as IconName] ?? FileText;
  return <Cmp size={size} strokeWidth={1.5} aria-hidden />;
}

/**
 * The rail, and the tag that teaches it.
 *
 * Concept 2.4, after the pin releases: "hovering a rail icon shows
 * 'Replaced: Task tracker, Sprint board'". It is the same Replaces
 * vocabulary the exploded blocks carry at rest, moved onto the rail once the
 * blocks have become the rail, which is how a visitor learns the eight hub
 * icons before signup rather than after it.
 *
 * The categories come from the pricing source, through the same
 * `replacesTag` the hero uses, so the tag and the fourteen tiles and the
 * stack receipt can never name different tools.
 *
 * `title` as well as the CSS tag: the shell is aria-hidden, the flyout is
 * decoration, and a native tooltip is the one version of it a visitor gets
 * on a device with no hover and with the stylesheet off.
 */
function Rail({ activeHub }: { activeHub: string }) {
  return (
    <div className="mk-shell__rail" aria-hidden>
      <span style={{ marginBottom: 8, display: "inline-flex" }}>
        <LogoMark size={28} />
      </span>
      {/* THE RAIL CARRIES NO MARKETING TAG. It used to stamp a
          "Replaced: Task tracker" line onto all eight rows, as a native
          title tooltip and as DOM text, inside a frame the page labels as a
          sample workspace. Three things were wrong with that at once: the
          product's own chrome is fixed wherever the product appears and the
          real rail has no such tags, so this was the site restyling the
          product; the decided spine bans "replaces" lines outright; and
          putting the claim inside the frame made it read as something the
          product says about itself rather than something we say about it.
          The one place the vocabulary belongs is /compare, which is the page
          that names names on purpose. */}
      {tuesday.hubs.map((h) => (
        <span key={h.id} className="mk-rail-item" data-active={h.id === activeHub}>
          <span className="mk-rail-item__pill">
            <MkIcon name={h.icon} size={20} />
          </span>
          <span className="mk-rail-item__label">{h.label}</span>
        </span>
      ))}
      {/* Settings, at the bottom, where the product puts it. */}
      <span className="mk-rail-item mk-rail-item-foot" data-active={activeHub === "settings"}>
        <span className="mk-rail-item__pill">
          <Settings size={20} strokeWidth={1.5} aria-hidden />
        </span>
        <span className="mk-rail-item__label">Settings</span>
      </span>
    </div>
  );
}

function TopBar({ breadcrumb, clock }: { breadcrumb: string[]; clock?: string }) {
  return (
    <div className="mk-shell__top" aria-hidden>
      <span style={{ display: "inline-flex", gap: 2, opacity: 0.4 }}>
        <ChevronLeft size={16} strokeWidth={1.5} />
        <ChevronRight size={16} strokeWidth={1.5} />
      </span>
      {/* The crumb carries a class purely so the hero can address it. No
          sheet styles `.mk-shell__crumb` except home.css's resting-frame
          rule, which fades the frame's word-bearing parts in across the
          square-up: at the resting half scale a 14px crumb paints at 5px,
          which is blur rather than text. */}
      <span
        className="mk-shell__crumb"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: "var(--os-t-body)",
          minWidth: 0,
          overflow: "hidden",
        }}
      >
        {/* Keyed by position, not by label. Two crumbs can legitimately read
            the same word: /features/okrs and /features/kpis both build
            ["Goals", "Goals"] from a hub name plus a surface name, and a
            label key made those a duplicate-key error whose rendered result
            was the nonsense crumb "Goals > Goals" inside chrome that is
            meant to look real. The builder now drops the repeat as well, so
            the crumb reads "Goals" once. */}
        {breadcrumb.map((crumb, i) => (
          <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            {i > 0 ? <span style={{ opacity: 0.5 }}>›</span> : null}
            <span
              style={{
                color: i === breadcrumb.length - 1 ? "var(--os-chrome-fg)" : "var(--os-chrome-fg-2)",
                fontWeight: i === breadcrumb.length - 1 ? 500 : 400,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                maxWidth: 160,
              }}
            >
              {crumb}
            </span>
          </span>
        ))}
      </span>
      {/* The search pill is the first thing to go when the frame is narrow.
          At a shell width under 620 the pill resolves to about 170px, which
          cannot hold "Search or jump to" on one line: it wrapped to two and
          overflowed a 36px bar, so the chrome that is supposed to be the
          site's recognisable silhouette read as broken. It is hidden by a
          container query on the shell rather than shrunk, because a search
          field with its label cut is worse than no search field. */}
      <span className="mk-shell__search">
        <Search size={16} strokeWidth={1.5} />
        Search or jump to
      </span>
      <span className="mk-shell__tools">
        {clock ? (
          <span
            className="mk-figures"
            style={{ fontSize: "var(--os-t-meta)", color: "var(--os-chrome-fg)", whiteSpace: "nowrap" }}
          >
            {clock}
          </span>
        ) : null}
        <Plus size={16} strokeWidth={1.5} />
        <Bell size={16} strokeWidth={1.5} />
        <CircleHelp size={16} strokeWidth={1.5} />
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 24,
            height: 24,
            borderRadius: 999,
            background: "var(--os-chrome-hov)",
            color: "var(--os-chrome-fg)",
            fontSize: 10,
            fontWeight: 500,
          }}
        >
          MD
        </span>
      </span>
    </div>
  );
}

export interface MarketingShellProps {
  /** Active rail hub id, one of tuesday.hubs. */
  hub: string;
  /** The top bar's hierarchy crumbs. */
  breadcrumb: string[];
  /** The canvas: one marketing-lite surface. */
  children: ReactNode;
  /** The light-grey secondary sidebar. Omit for a surface that has none. */
  sidebar?: ReactNode;
  /** The story clock, shown at the right of the bar. */
  clock?: string;
  /**
   * The accessible name for the whole figure. This is the sentence a screen
   * reader gets instead of the chrome, so it has to say what the picture
   * shows, not what it is called.
   */
  label: string;
  /** Visible caption under the frame. Defaults to the sample-workspace label. */
  caption?: string | null;
  /**
   * Render the frame at a fraction of full size without re-laying it out, so
   * the 14px UI text on the face is the product's real 14px, scaled.
   *
   * There is a FLOOR, and it is enforced, not advised. The concept's rule is
   * that the UI text on a block face stays readable at rest. The product's
   * body text is 14px and its smallest caption is 10px, so a frame scaled
   * below MIN_LEGIBLE_SCALE renders type under that 10px floor and has
   * stopped being a surface: 0.46, the value this shipped at, put the
   * product's 14px on screen at 6.4px.
   *
   * When a face genuinely has to be smaller than the floor, it is a
   * THUMBNAIL and has to say so, because a thumbnail is a different claim:
   * it shows shape, not content. Crop to the region that matters instead
   * wherever you can. A small window on a legible list beats a whole page
   * nobody can read.
   */
  scale?: number;
  /**
   * Acknowledges that this frame is below the legibility floor and is being
   * shown for its shape. Without it, a scale under the floor is a mistake
   * and says so in development.
   */
  thumbnail?: boolean;
  /** Reserved box for the scaled frame, so nothing shifts while it loads. */
  width?: number;
  height?: number;
  /**
   * This frame is laid out wider than the column it sits in, so its
   * scroller is a real one and becomes a keyboard tab stop with the site's
   * focus ring. Off by default: the size bands in marketing-shell.css narrow
   * the frame instead of scrolling it, so a tab stop that cannot scroll is
   * an unlabeled dead stop in the tab order.
   */
  scrollable?: boolean;
  className?: string;
}

/**
 * The smallest scale at which a frame still shows readable product text.
 * 14px * 0.72 is 10.1px, which is the product's own caption floor. Below it,
 * the face is a texture.
 */
export const MIN_LEGIBLE_SCALE = 0.72;

export function MarketingShell({
  hub,
  breadcrumb,
  children,
  sidebar,
  clock,
  label,
  caption,
  scale,
  thumbnail = false,
  width = 1180,
  height = 680,
  scrollable = false,
  className,
}: MarketingShellProps) {
  if (
    process.env.NODE_ENV !== "production" &&
    typeof scale === "number" &&
    scale < MIN_LEGIBLE_SCALE &&
    !thumbnail
  ) {
    // Loud in development, silent in production. A frame under the floor is
    // either a mistake or a deliberate thumbnail, and the difference has to
    // be written down by whoever made the call.
    console.warn(
      `MarketingShell: scale ${scale} puts the product's 14px text at ${(14 * scale).toFixed(1)}px, ` +
        `below the ${MIN_LEGIBLE_SCALE} legibility floor. Raise the scale, crop the surface, ` +
        `or pass thumbnail to say this face is showing shape rather than content. (${label})`,
    );
  }

  const frame = (
    <div className={`mk-shell${className ? ` ${className}` : ""}`} data-sidebar={sidebar ? "grey" : "none"}>
      <Rail activeHub={hub} />
      {sidebar ? (
        <div className="mk-shell__side" aria-hidden>
          {sidebar}
        </div>
      ) : null}
      <div className="mk-shell__main">
        <TopBar breadcrumb={breadcrumb} clock={clock} />
        <div className="mk-shell__canvas" aria-hidden>
          {children}
        </div>
      </div>
    </div>
  );

  // The frame's size is THREE CSS custom properties, not three inline pixel
  // values, and that is the whole of the mobile fix.
  //
  // What was wrong: the authored width was baked into the element, so a
  // 940px frame scaled 0.74 became a 696px box inside a 350px phone column
  // and the visitor saw its top-left corner behind a horizontal scroller.
  // Scaling further was not available either: under MIN_LEGIBLE_SCALE the
  // product's 14px stops being readable, so 940px of product CANNOT fit a
  // phone at any honest scale. The frame has to be NARROWER, which means it
  // has to re-lay itself out, which means the width has to be a property a
  // container query can change.
  //
  // So `--mk-w` and `--mk-h` are the frame's logical size, `--mk-scale-factor`
  // is how much of it is painted, and marketing-shell.css narrows all three
  // in bands as the column narrows. The 14px on the face stays at or above
  // the floor at every band; what changes is how much product is in view,
  // which is the honest trade.
  //
  // THE SCROLLER IS ONLY A TAB STOP WHERE IT CAN ACTUALLY SCROLL.
  //
  // It used to carry `tabIndex={0}` unconditionally, and the size bands
  // directly above are written so that it never overflows at any width: the
  // frame RE-LAYS ITSELF OUT narrower rather than scrolling. Measured at
  // 1440 and at 390, zero of the visible instances overflowed. So every one
  // of them was a focus stop that could not be scrolled, had no role and no
  // accessible name of its own, and announced the whole rail-plus-top-bar
  // text blob when a screen reader reached it. On the home page that was 33
  // of them, and at 390 it was 16 of the first 40 tab stops: 40 percent of
  // the mobile tab order spent on unlabeled dead stops between the hero and
  // the module tour. WCAG 2.4.3.
  //
  // It is a prop rather than a deletion because the reachability argument is
  // right whenever a frame really does overflow: a caller that lays a frame
  // out wider than its column passes `scrollable` and gets the tab stop and
  // the focus ring back. No caller needs it today.
  const body = (
    <div className="mk-shell-scroll" tabIndex={scrollable ? 0 : undefined}>
      {/* The AUTHORED size, under its own names.
          The three properties the sheet actually reads are --mk-w, --mk-h
          and --mk-scale-factor, and they are derived from these in CSS.
          Setting the read names here instead would win: an inline
          declaration beats every stylesheet rule, container query or not,
          so the size bands could never narrow the frame and a 940px frame
          stayed 940px on a phone. Author here, resolve there. */}
      <div
        className="mk-scale"
        style={
          {
            "--mk-scale-base": scale ?? 1,
            "--mk-w-base": width,
            "--mk-h-base": height,
          } as React.CSSProperties
        }
      >
        {frame}
      </div>
    </div>
  );

  const captionText = caption === null ? null : caption ?? tuesday.workspace.sidebarLabel;

  return (
    <figure className="mk-os mk-frame" role="group" aria-label={label} style={{ margin: 0 }}>
      {body}
      {captionText ? (
        <figcaption
          className="mk-caption"
          style={{ marginTop: 8, color: "var(--os-ink-2)", fontFamily: "var(--os-font)" }}
        >
          {captionText}
        </figcaption>
      ) : null}
    </figure>
  );
}

/**
 * The sidebar header: the workspace switcher row that carries the sample
 * workspace label, so no surface on the site can be mistaken for a
 * customer's own data (concept 2.5, risk "fictional cast read as customers").
 */
export function MkSidebarHeader({ subtitle }: { subtitle?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, height: 56, paddingInline: 12 }}>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 24,
          height: 24,
          borderRadius: "var(--os-r-xs)",
          background: "var(--os-surface-2)",
          color: "var(--os-n700)",
          fontSize: 10,
          fontWeight: 600,
        }}
      >
        NO
      </span>
      <span style={{ minWidth: 0 }}>
        <span
          style={{
            display: "block",
            fontSize: "var(--os-t-row)",
            lineHeight: "var(--os-t-row-lh)",
            fontWeight: 500,
            color: "var(--os-ink)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {tuesday.workspace.org}
        </span>
        <span
          style={{
            display: "block",
            fontSize: "var(--os-t-meta)",
            lineHeight: "var(--os-t-meta-lh)",
            color: "var(--os-ink-2)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {/* "Sample workspace", not the full sidebarLabel.
              The full label is "Sample workspace: Northwind Ops", and the
              row directly above this one is already the org name, so the
              long version repeated it and then ran out of a 216px sidebar
              mid-word: the frame's one honesty label rendered as "Sample
              workspace: Nor...". The whole sentence still appears, under
              the frame, in the figcaption, where it has the width for it. */}
          {subtitle ?? "Sample workspace"}
        </span>
      </span>
    </div>
  );
}
