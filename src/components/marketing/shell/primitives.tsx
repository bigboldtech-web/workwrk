// Marketing-lite primitives: the product's component standards, drawn from
// the product's own tokens, with every interaction removed.
//
// Why these are not the product components themselves. design-system.md 5
// names TableCard, StatusChip, FilterPanel and the restyled ViewTab; three
// of those four do not exist under those names yet (they are the frame
// phases' work, in flight right now), and the ones that do exist carry
// client contexts, the shell's boot state and a Prisma-shaped data contract
// that a static marketing surface has nothing to give. So these are lite
// variants built to the same spec sections, reading the same --os-* names,
// with one hard rule: a value here is a token reference, never a hex. When
// the frame settles, swapping a lite primitive for the real one is a local
// change in this folder and nowhere else.
//
// Everything is a Server Component: no state, no handlers, no effects.
// Nothing in this file is interactive, so nothing here needs a handler.

import { Children } from "react";
import type { CSSProperties, ReactNode } from "react";
import { DOT_HEX, type DotColor } from "../data/tuesday";

export type Semantic = "success" | "warning" | "danger" | "info" | "neutral";

const SEMANTIC_BG: Record<Semantic, string> = {
  success: "var(--os-success-bg)",
  warning: "var(--os-warning-bg)",
  danger: "var(--os-danger-bg)",
  info: "var(--os-brand-soft)",
  neutral: "var(--os-surface-hov)",
};
const SEMANTIC_TEXT: Record<Semantic, string> = {
  success: "var(--os-success-text)",
  warning: "var(--os-warning-text)",
  danger: "var(--os-danger-text)",
  info: "var(--os-brand-deep)",
  neutral: "var(--os-ink)",
};
const SEMANTIC_SOLID: Record<Semantic, string> = {
  success: "var(--os-success-solid)",
  warning: "var(--os-warning-solid)",
  danger: "var(--os-danger-solid)",
  info: "var(--os-brand)",
  neutral: "var(--os-ink-3)",
};

/** design-system 5.9 mapping, in one place so no surface invents its own. */
export function semanticForStatus(status: string): Semantic {
  const s = status.toLowerCase();
  if (s === "done" || s === "on track" || s === "complete" || s === "closed") return "success";
  if (s === "in-progress" || s === "in progress" || s === "due soon" || s === "at risk") return "warning";
  if (s === "blocked" || s === "overdue") return "danger";
  if (s === "review" || s === "info") return "info";
  return "neutral";
}

export function statusLabel(status: string): string {
  const map: Record<string, string> = {
    "not-started": "Not started",
    "in-progress": "In progress",
    done: "Done",
    blocked: "Blocked",
  };
  return map[status] ?? status;
}

/* ── Brand dot. The four hexes are the brand and the only saturated
   objects on a surface; status inside a surface uses the semantic trio. ── */
export function BrandDot({ color, size = 8, style }: { color: DotColor; size?: number; style?: CSSProperties }) {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: 999,
        background: DOT_HEX[color],
        flex: "0 0 auto",
        ...style,
      }}
    />
  );
}

/* ── StatusChip (5.9): pale fill, semantic text, a 6px solid dot, 12/500,
   sentence case. ─────────────────────────────────────────────────────── */
export function MkStatusChip({ status, label }: { status: string; label?: string }) {
  const tone = semanticForStatus(status);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: "var(--os-chip-h)",
        paddingInline: 8,
        borderRadius: "var(--os-r-sm)",
        background: SEMANTIC_BG[tone],
        color: SEMANTIC_TEXT[tone],
        fontSize: "var(--os-t-meta)",
        lineHeight: "var(--os-t-meta-lh)",
        fontWeight: 500,
        whiteSpace: "nowrap",
      }}
    >
      <span aria-hidden style={{ width: 6, height: 6, borderRadius: 999, background: SEMANTIC_SOLID[tone] }} />
      {label ?? statusLabel(status)}
    </span>
  );
}

/* ── Chip (5.9): neutral, 24px, radius 6, 12/500. ────────────────────── */
export function MkChip({ children, icon, tone }: { children: ReactNode; icon?: ReactNode; tone?: "neutral" | "accent" }) {
  const accent = tone === "accent";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: "var(--os-chip-h)",
        paddingInline: 8,
        borderRadius: "var(--os-r-sm)",
        background: accent ? "var(--os-brand-soft)" : "var(--os-surface-hov)",
        color: accent ? "var(--os-brand-deep)" : "var(--os-ink)",
        fontSize: "var(--os-t-meta)",
        lineHeight: "var(--os-t-meta-lh)",
        fontWeight: 500,
        whiteSpace: "nowrap",
        maxWidth: "100%",
        overflow: "hidden",
        textOverflow: "ellipsis",
        // A chip carries a name, and half a name is worse than a wrapped
        // row: in a flex row it is the chip that gives way first, so it is
        // the chip that says no. Its container wraps instead.
        flex: "0 0 auto",
      }}
    >
      {icon}
      {children}
    </span>
  );
}

/* ── Avatar (5.18): initials 11/500 on N200 with N700 text. One neutral
   ground, no hue hashed from an id. ──────────────────────────────────── */
export function MkAvatar({ initials, size = 24, ring }: { initials: string; size?: number; ring?: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: 999,
        background: "var(--os-surface-2)",
        color: "var(--os-n700)",
        fontSize: size <= 20 ? 10 : 11,
        fontWeight: 500,
        flex: "0 0 auto",
        boxShadow: ring ? "0 0 0 2px var(--os-canvas)" : undefined,
      }}
    >
      {initials}
    </span>
  );
}

export function MkAvatarStack({ people, size = 24 }: { people: string[]; size?: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center" }}>
      {people.map((initials, i) => (
        <span key={`${initials}-${i}`} style={{ marginInlineStart: i === 0 ? 0 : -6 }}>
          <MkAvatar initials={initials} size={size} ring />
        </span>
      ))}
    </span>
  );
}

/* ── EntityTile (5.14): one neutral square with a glyph or two letters. ─ */
export function MkTile({ glyph, size = 20 }: { glyph: ReactNode; size?: number }) {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: "var(--os-r-xs)",
        background: "var(--os-surface-2)",
        color: "var(--os-ink-2)",
        fontSize: 10,
        fontWeight: 600,
        flex: "0 0 auto",
      }}
    >
      {glyph}
    </span>
  );
}

/* ── Buttons (5.10). Static renders of the three variants. The ONE blue
   button per surface is the primary; blue never sits on the navy chrome. ─ */
export function MkButton({
  children,
  variant = "secondary",
  icon,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  icon?: ReactNode;
}) {
  const base: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    height: "var(--os-control-h)",
    paddingInline: icon ? 16 : 12,
    borderRadius: "var(--os-r-sm)",
    fontSize: "var(--os-t-body)",
    lineHeight: "var(--os-t-body-lh)",
    fontWeight: 500,
    whiteSpace: "nowrap",
  };
  const skin: Record<string, CSSProperties> = {
    primary: { background: "var(--os-brand)", color: "var(--os-ink-inv)" },
    secondary: { background: "var(--os-surface)", color: "var(--os-ink)", border: "1px solid var(--os-line-strong)" },
    ghost: { background: "transparent", color: "var(--os-ink-2)" },
  };
  return (
    <span style={{ ...base, ...skin[variant] }}>
      {icon}
      {children}
    </span>
  );
}

/* ── The Zoho header stack (4.4): title row 48, views row 36, toolbar 44,
   padding-inline 24, always in this order. ──────────────────────────── */
export function MkPageHeader({
  title,
  tile,
  views,
  activeView,
  toolbarLeft,
  toolbarRight,
  actions,
}: {
  title: string;
  tile?: ReactNode;
  views?: string[];
  activeView?: string;
  toolbarLeft?: ReactNode;
  toolbarRight?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div style={{ paddingInline: 24 }}>
      <div style={{ height: "var(--os-head-h)", display: "flex", alignItems: "center", gap: 10 }}>
        {tile}
        {/* A div, not a heading.
            A marketing lite frame is a PICTURE of the product, and its
            canvas is aria-hidden inside one labelled figure. An `h3` here
            was invisible to a screen reader and fully visible to the
            document outline, so the home page published forty headings
            reading "My work", "Clients" and "Onboarding lead" between its
            eight real section headings. The type is the same; only the
            element changed. */}
        <div
          style={{
            margin: 0,
            fontSize: "var(--os-t-page)",
            lineHeight: "var(--os-t-page-lh)",
            fontWeight: 600,
            color: "var(--os-ink)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {title}
        </div>
        <span style={{ marginInlineStart: "auto", display: "inline-flex", gap: 8 }}>{actions}</span>
      </div>
      {views && views.length > 1 ? (
        <div className="os-row" style={{ height: "var(--os-views-h)", display: "flex", alignItems: "center", gap: 4 }}>
          {views.map((v) => {
            const active = v === activeView;
            return (
              <span
                key={v}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  height: 32,
                  paddingInline: 12,
                  borderRadius: "var(--os-r-sm)",
                  background: active ? "var(--os-surface-2)" : "transparent",
                  color: active ? "var(--os-ink)" : "var(--os-ink-2)",
                  fontWeight: active ? 500 : 400,
                }}
              >
                {v}
              </span>
            );
          })}
        </div>
      ) : null}
      {toolbarLeft || toolbarRight ? (
        // The toolbar WRAPS.
        //
        // In the product this row has a page's full width and never needs to;
        // in a two-up marketing frame it is about 400px wide, and a row that
        // cannot wrap makes its children shrink instead: the SOP header, which
        // is the whole payload of stop 1, rendered "Owned by: Onboarding lea"
        // and "KRA: Client onboarding runs on tin", clipped by the Share
        // button. A picture that cuts its own argument off at "tin" reads as a
        // broken screenshot. `min-height` keeps the single-row case identical.
        <div
          style={{
            minHeight: "var(--os-toolbar-h)",
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 8,
            rowGap: 6,
            paddingBlock: 2,
          }}
        >
          {toolbarLeft}
          <span style={{ marginInlineStart: "auto", display: "inline-flex", alignItems: "center", gap: 8 }}>
            {toolbarRight}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/* The column track a table lays BOTH its header and its rows on.
 *
 * One entry per cell, in order. `null` is the flexible column (the name),
 * a number is a fixed pixel width. Without one shared track each header
 * label sits wherever its own text happens to end while each body cell
 * takes the width of its own content, so "Status" never sits over the
 * status column, and two rows whose chips read "In progress" and "Review"
 * push their neighbours to different places. Every column after the
 * flexible one therefore gets a width wide enough for its widest value:
 * the longest status chip, an avatar, a date.
 *
 * These are marketing-lite surfaces, so the track is a constant rather
 * than a drag handle. The product's own tables keep their real resize,
 * reorder, hide and freeze behaviour; nothing here replaces them.
 */
export type MkColWidths = ReadonlyArray<number | null>;

/** Name, Status, Owner, Due: the shape every task table on the site uses. */
export const MK_TASK_COLS: MkColWidths = [null, 96, 44, 52];

/**
 * Per column classes, parallel to `widths`.
 *
 * THIS IS HOW A TABLE SURVIVES A PHONE. A track of one flexible column and
 * four fixed ones does not fit a 480px logical frame at any scale, and
 * flexbox resolves that by taking the whole deficit out of the only column
 * allowed to shrink: the flexible one, which is the RECORD'S NAME. The
 * result was a Clients grid at 390 whose rows read "Sep 16 / SO / 8 / Inside
 * SLA" with no client on them, under a headline that says "The form writes
 * the row." The row was there and the name was zero pixels wide.
 *
 * So the narrow bands DROP a column instead of crushing one, the same trade
 * the frame itself makes: a surface laid out narrower re-lays itself out.
 * `mk-col-drop-1` goes at the first narrow band, `mk-col-drop-2` at the one
 * below it, and the bands are written beside the frame bands in
 * marketing-shell.css so the two can never drift apart. Mark the columns a
 * beat does not argue with; never the name, never the column the narration
 * names. The product's own tables keep every column and their real hide,
 * resize, reorder and freeze controls: nothing here is a product behaviour.
 */
export type MkColClasses = ReadonlyArray<string | undefined>;

/**
 * The flexible track's basis, in px.
 *
 * It has to be a NUMBER and not `auto`. With `auto` the basis is the cell's
 * own content, so the header cell (the word "Client") and the body cell
 * ("Quayside Coffee") start from different sizes, and once the row is tight
 * enough to shrink at all they resolve to different widths: the label ends
 * up thirteen pixels left of the value it names. A shared basis makes the
 * header and every row below it arithmetically identical.
 */
const FLEX_TRACK_BASIS = 96;

function trackStyle(widths: MkColWidths | undefined, i: number): CSSProperties {
  const w = widths?.[i];
  // Grows into whatever a wide frame leaves over, shrinks no further than a
  // width a name is still readable in. The floor is the whole point: it is
  // what stops flexbox paying a narrow row's entire deficit out of the one
  // column the surface exists to show.
  if (w == null) return { flex: `1 1 ${FLEX_TRACK_BASIS}px`, minWidth: 56 };
  // `0 1` rather than `0 0`: once the drop classes have taken the optional
  // columns out, whatever is left shares the remainder instead of a fixed
  // track overflowing the card and being clipped by its own rounded corner.
  return { flex: `0 1 ${w}px`, minWidth: 0 };
}

/* ── TableCard (5.1): a bordered white card, hairline rows, no zebra, and
   a records footer, which is the "records" mental model the spec names. ─ */
export function MkTableCard({
  columns,
  widths,
  colClasses,
  children,
  footer,
}: {
  columns: ReactNode[];
  /** The shared track. Omit only for a card with a single flexible column. */
  widths?: MkColWidths;
  /** Per column classes. Pass the SAME array to every MkTableRow below. */
  colClasses?: MkColClasses;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div
      className="os-row"
      style={{
        border: "1px solid var(--os-line)",
        borderRadius: "var(--os-r-md)",
        background: "var(--os-surface)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          height: 36,
          paddingInline: 12,
          background: "var(--os-table-head-bg)",
          borderBottom: "1px solid var(--os-line)",
          fontSize: "var(--os-t-helper)",
          lineHeight: "var(--os-t-helper-lh)",
          fontWeight: 500,
          color: "var(--os-ink-2)",
        }}
      >
        {columns.map((c, i) => (
          <span
            key={i}
            className={colClasses?.[i]}
            style={
              widths
                ? { ...trackStyle(widths, i), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }
                : { flex: i === 0 ? "1 1 auto" : "0 0 auto", minWidth: 0 }
            }
          >
            {c}
          </span>
        ))}
      </div>
      {children}
      {footer ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            height: 36,
            paddingInline: 12,
            borderTop: "1px solid var(--os-line)",
            fontSize: "var(--os-t-meta)",
            lineHeight: "var(--os-t-meta-lh)",
            color: "var(--os-ink-2)",
          }}
        >
          {footer}
        </div>
      ) : null}
    </div>
  );
}

export function MkTableRow({
  children,
  widths,
  colClasses,
  selected,
  className,
}: {
  children: ReactNode;
  /** The card's per column classes, passed again for the same reason. */
  colClasses?: MkColClasses;
  /**
   * The card's track, passed again here because these are Server Components
   * and there is no context to read it from. Each child is wrapped in a cell
   * sized by the track, so a wide status chip can no longer shove the owner
   * and the due date out of their columns.
   */
  widths?: MkColWidths;
  selected?: boolean;
  /**
   * For a row a scene animates, and nothing else. The hero's Snap slides the
   * Tuesday task into Today at the end of the pin, which needs a hook the
   * stylesheet can reach; every other row is furniture and takes none.
   */
  className?: string;
}) {
  return (
    <div
      className={className}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        minHeight: 40,
        paddingInline: 12,
        paddingBlock: 6,
        borderBottom: "1px solid var(--os-table-row-line)",
        background: selected ? "var(--os-selected)" : "transparent",
        color: "var(--os-ink)",
      }}
    >
      {widths
        ? Children.toArray(children).map((child, i) => (
            <span
              key={i}
              className={colClasses?.[i]}
              style={{ ...trackStyle(widths, i), display: "flex", alignItems: "center", gap: 8 }}
            >
              {child}
            </span>
          ))
        : children}
    </div>
  );
}

/* ── Section label (4.2): 11/600 uppercase, +0.06em, with a hairline rule
   from the label's end to the right edge. ───────────────────────────── */
export function MkSectionLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 20, marginBottom: 6, paddingInline: 12 }}>
      <span
        style={{
          fontSize: "var(--os-t-micro)",
          lineHeight: "var(--os-t-micro-lh)",
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--os-ink-2)",
        }}
      >
        {children}
      </span>
      <span aria-hidden style={{ flex: "1 1 auto", height: 1, background: "var(--os-line)" }} />
    </div>
  );
}

/* ── Sidebar row (4.2): 36px, inset 8, radius 8, grey pill when active. ─ */
export function MkSideRow({
  label,
  icon,
  count,
  active,
  indent = 0,
}: {
  label: string;
  icon?: ReactNode;
  count?: number;
  active?: boolean;
  indent?: number;
}) {
  return (
    <div
      className="os-row"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        height: "var(--os-nav-row-h)",
        paddingInline: 12,
        marginInlineStart: indent * 20,
        borderRadius: "var(--os-r-md)",
        background: active ? "var(--os-side-pill)" : "transparent",
        color: "var(--os-ink)",
        fontWeight: active ? 500 : 400,
      }}
    >
      <span style={{ display: "inline-flex", color: active ? "var(--os-ink)" : "var(--os-ink-2)" }}>{icon}</span>
      <span style={{ flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </span>
      {typeof count === "number" ? (
        <span
          style={{
            fontSize: "var(--os-t-meta)",
            lineHeight: "var(--os-t-meta-lh)",
            fontWeight: 500,
            color: active ? "var(--os-ink-strong)" : "var(--os-ink-2)",
          }}
        >
          {count}
        </span>
      ) : null}
    </div>
  );
}

/* ── Empty state (5.8): quiet grey four-dot line art and one sentence. ── */
export function MkEmpty({ line }: { line: string }) {
  return (
    <div style={{ padding: 32, textAlign: "center", color: "var(--os-ink-2)" }}>
      <span aria-hidden style={{ display: "inline-flex", gap: 5, marginBottom: 10 }}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} style={{ width: 6, height: 6, borderRadius: 999, background: "var(--os-ink-4)" }} />
        ))}
      </span>
      <div style={{ fontSize: "var(--os-t-body)", lineHeight: "var(--os-t-body-lh)" }}>{line}</div>
    </div>
  );
}

/** A soft-grey caption used for the wire labels and block notes: 12/600. */
export function MkWireLabel({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        fontSize: "var(--os-t-meta)",
        lineHeight: "var(--os-t-meta-lh)",
        fontWeight: 600,
        color: "var(--os-ink-2)",
      }}
    >
      {children}
    </span>
  );
}
