// The marketing-lite surfaces (marketing-concept.md 12 Phase 0 item 3).
//
// One component per product surface the story needs, each fed by the Tuesday
// fixture and drawn in the Zoho-clean look: the page title, the saved views
// as text tabs, one toolbar row, bordered white table cards with hairline
// rows, quiet empty states, thin-line icons. No surface here invents a UI
// the product does not have, and none of them is a screenshot: they are DOM,
// so they resize, print and stay legible at the LCP frame.
//
// All static Server Components. Every one is rendered inside MarketingShell,
// which owns the accessibility contract for the whole figure.
//
// TRUTH GATE. A surface IS a claim: a caption reading "Created by SOP, owner
// by role" asserts the same mechanism the prose does, and gating only the
// prose leaves the picture saying the thing the words are forbidden to say.
// So anything on a surface that states HOW a connection was made goes
// through `captionFor()` below and prints its shipped alternative until the
// mechanism lands. Showing the LINKS a task carries is fine, because the
// product really does carry them; claiming the SOP created the task is not,
// because no SOP surface calls createBoardItem yet.

import type { ReactNode } from "react";
import {
  BookOpen,
  CircleCheck,
  FileText,
  Hash,
  Home,
  Inbox,
  Link2,
  ListTodo,
  Mic,
  Paperclip,
  Sheet,
  Sparkles,
  SquareKanban,
  Star,
  Target,
  Timer,
  Users,
  Video,
} from "lucide-react";
import { castInitials, castName, stopByNumber, stopShipped, taskCaption, threadView, tuesday, DOT_HEX } from "../data/tuesday";
import { flags } from "../flags";
import { MkIcon, MkSidebarHeader } from "./marketing-shell";
import {
  BrandDot,
  MkAvatar,
  MkButton,
  MkChip,
  MkEmpty,
  MkPageHeader,
  MkSectionLabel,
  MkSideRow,
  MkStatusChip,
  MkTableCard,
  MK_TASK_COLS,
  type MkColWidths,
  MkTableRow,
  MkTile,
  statusLabel,
} from "./primitives";

function Canvas({
  children,
  pad = true,
  className,
}: {
  children: ReactNode;
  pad?: boolean;
  /** `mk-canvas-fill` makes the canvas a full height column, for a surface
      that has a panel in it which must end at the window's edge rather than
      be sliced by it. */
  className?: string;
}) {
  return (
    <div className={className} style={{ padding: pad ? "8px 24px 24px" : 0, minWidth: 0 }}>
      {children}
    </div>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return <span style={{ color: "var(--os-ink-2)" }}>{children}</span>;
}

function Meta({ children }: { children: ReactNode }) {
  return (
    <span style={{ fontSize: "var(--os-t-meta)", lineHeight: "var(--os-t-meta-lh)", color: "var(--os-ink-2)" }}>
      {children}
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 * Sidebars. One per hub, built from the naming canon's rail order and
 * the shipped sidebar trees, never an invented taxonomy.
 * ═══════════════════════════════════════════════════════════════════ */

const SIDEBARS: Record<string, { rows: Array<{ label: string; icon: ReactNode; count?: number; active?: boolean }>; sections: Array<{ label: string; rows: Array<{ label: string; active?: boolean; indent?: number }> }> }> = {
  work: {
    rows: [
      { label: "Home", icon: <Home size={20} strokeWidth={1.5} /> },
      { label: "My work", icon: <ListTodo size={20} strokeWidth={1.5} />, active: true },
      { label: "Inbox", icon: <Inbox size={20} strokeWidth={1.5} />, count: 3 },
    ],
    sections: [
      {
        label: "Spaces",
        rows: [
          { label: "Operations", active: true },
          { label: "Onboarding", indent: 1, active: true },
          { label: "Client reviews", indent: 1 },
          { label: "Finance" },
        ],
      },
    ],
  },
  docs: {
    rows: [
      { label: "Library", icon: <BookOpen size={20} strokeWidth={1.5} /> },
      { label: "SOPs", icon: <FileText size={20} strokeWidth={1.5} />, active: true },
    ],
    sections: [
      {
        label: "SOPs",
        rows: [
          { label: "Client onboarding v4", active: true },
          { label: "Client reporting" },
          { label: "Supplier onboarding" },
        ],
      },
      { label: "Contracts", rows: [{ label: "Bluefin Foods v2" }, { label: "Harbour Mills v1" }] },
    ],
  },
  talk: {
    rows: [{ label: "Threads", icon: <Hash size={20} strokeWidth={1.5} /> }],
    sections: [
      {
        label: "Channels",
        rows: [{ label: "onboarding", active: true }, { label: "operations" }, { label: "finance" }],
      },
    ],
  },
  teams: {
    rows: [
      { label: "Directory", icon: <Users size={20} strokeWidth={1.5} /> },
      { label: "Roles", icon: <Star size={20} strokeWidth={1.5} />, active: true },
    ],
    sections: [
      {
        label: "Operations",
        rows: [{ label: "Onboarding lead", active: true }, { label: "Operations lead" }, { label: "Finance" }],
      },
    ],
  },
  goals: {
    rows: [{ label: "Company", icon: <Target size={20} strokeWidth={1.5} /> }, { label: "Team", icon: <Users size={20} strokeWidth={1.5} />, active: true }],
    sections: [
      {
        label: "Q3",
        rows: [{ label: "Onboard every client in 10 days", active: true }, { label: "Keep churn under 4 percent" }],
      },
    ],
  },
  tables: {
    rows: [{ label: "All tables", icon: <Sheet size={20} strokeWidth={1.5} />, active: true }],
    sections: [{ label: "Operations", rows: [{ label: "Clients", active: true }, { label: "Suppliers" }] }],
  },
  planner: {
    rows: [{ label: "My week", icon: <MkIcon name="CalendarDays" />, active: true }, { label: "Timesheets", icon: <Timer size={20} strokeWidth={1.5} /> }],
    sections: [{ label: "Calendars", rows: [{ label: "Operations" }, { label: "Calls", active: true }] }],
  },
  ai: {
    rows: [{ label: "Ask", icon: <Sparkles size={20} strokeWidth={1.5} />, active: true }],
    sections: [{ label: "Recent", rows: [{ label: "Is Q3 on track?", active: true }, { label: "Who owns onboarding?" }] }],
  },
};

export function MkSidebar({ hub }: { hub: string }) {
  const config = SIDEBARS[hub] ?? SIDEBARS.work;
  return (
    <div>
      <MkSidebarHeader />
      {config.rows.map((r) => (
        <MkSideRow key={r.label} label={r.label} icon={r.icon} count={r.count} active={r.active} />
      ))}
      {config.sections.map((s) => (
        <div key={s.label}>
          <MkSectionLabel>{s.label}</MkSectionLabel>
          {s.rows.map((r) => (
            <MkSideRow
              key={r.label}
              label={r.label}
              icon={<MkTile glyph={r.label.slice(0, 1).toUpperCase()} />}
              active={r.active}
              indent={r.indent}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 * 1. Work, My work. The surface behind the Snap: the manager's morning,
 *    with one task already waiting.
 * ═══════════════════════════════════════════════════════════════════ */

export function MyWorkSurface({
  showTaskCaption = false,
  compact = false,
  arrive = false,
}: {
  showTaskCaption?: boolean;
  /**
   * Marks the Tuesday task's row as the one the hero's Snap slides into
   * Today at the end of the pin (concept 2.4, at 0.85). It adds a class and
   * nothing else: whether the row is held back, and until when, is a
   * stylesheet decision keyed on the stage's own scene state, so a visitor
   * with no JavaScript sees the row sitting where it belongs.
   */
  arrive?: boolean;
  /**
   * Drops the empty Overdue bucket. It is a good quiet empty state and it
   * costs 180px, which on a phone is the difference between the task row
   * being in the first screen and being under it. The bucket carries no
   * claim, so dropping it loses nothing but the room.
   */
  compact?: boolean;
}) {
  const task = tuesday.task;
  return (
    <Canvas>
      <MkPageHeader
        title="My work"
        views={["All", "Today", "This week", "Overdue"]}
        activeView="Today"
        toolbarLeft={
          <>
            <MkButton variant="secondary">Filter</MkButton>
            <MkButton variant="secondary">Sort</MkButton>
          </>
        }
        toolbarRight={<MkButton variant="primary">Create task</MkButton>}
      />
      <div style={{ display: "grid", gap: 16, marginTop: 8 }}>
        {compact ? null : (
          <div>
            <div style={{ marginBottom: 6 }}>
              <Meta>Overdue</Meta>
            </div>
            <MkTableCard columns={["Name", "Status", "Owner", "Due"]} widths={MK_TASK_COLS}>
              <MkEmpty line="Nothing overdue." />
            </MkTableCard>
          </div>
        )}
        <div>
          <div style={{ marginBottom: 6 }}>
            <Meta>Today</Meta>
          </div>
          <MkTableCard columns={["Name", "Status", "Owner", "Due"]} widths={MK_TASK_COLS} footer="3 records">
            <MkTableRow widths={MK_TASK_COLS} selected className={arrive ? "mk-arrive" : undefined}>
              <span style={{ flex: "1 1 auto", minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
                <MkTile glyph={<SquareKanban size={12} strokeWidth={1.5} />} />
                <span style={{ fontWeight: 500 }}>{task.title}</span>
                <span style={{ display: "inline-flex", gap: 4, color: "var(--os-ink-3)" }}>
                  <FileText size={12} strokeWidth={1.5} aria-hidden />
                  <Target size={12} strokeWidth={1.5} aria-hidden />
                  <Users size={12} strokeWidth={1.5} aria-hidden />
                </span>
              </span>
              <MkStatusChip status={task.status} label={task.statusLabel} />
              <MkAvatar initials={castInitials(task.owner)} />
              <Meta>{task.dueLabel}</Meta>
            </MkTableRow>
            <MkTableRow widths={MK_TASK_COLS}>
              <span style={{ flex: "1 1 auto", minWidth: 0 }}>Reporting pack, week 38</span>
              <MkStatusChip status="in-progress" />
              <MkAvatar initials={castInitials("maya")} />
              <Meta>Today</Meta>
            </MkTableRow>
            <MkTableRow widths={MK_TASK_COLS}>
              <span style={{ flex: "1 1 auto", minWidth: 0 }}>Approve Harbour Mills scope</span>
              <MkStatusChip status="review" label="Review" />
              <MkAvatar initials={castInitials("maya")} />
              <Meta>Today</Meta>
            </MkTableRow>
          </MkTableCard>
        </div>
        {showTaskCaption ? (
          <div
            style={{
              borderInlineStart: "2px solid var(--os-brand)",
              paddingInlineStart: 10,
              color: "var(--os-ink-2)",
              fontSize: "var(--os-t-helper)",
              lineHeight: "var(--os-t-helper-lh)",
            }}
          >
            {taskCaption()}
          </div>
        ) : null}
      </div>
    </Canvas>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 * 2. Work, the Onboarding board list, with the task drawer.
 * ═══════════════════════════════════════════════════════════════════ */

export function BoardListSurface({
  drawer = false,
  done = false,
  blocked = false,
}: {
  drawer?: boolean;
  done?: boolean;
  /**
   * Stop 4, between 2:00 and 2:30. The storyboard flips the task's status to
   * "Blocked: finance sign off" and the narration beside it reads "blocked
   * doesn't mean stuck", so a frame still showing "In progress" contradicts
   * the sentence it is illustrating.
   */
  blocked?: boolean;
}) {
  const { board, task } = tuesday;
  return (
    // A full height column, because of the drawer. See `mk-canvas-fill`.
    <Canvas className="mk-canvas-fill">
      <MkPageHeader
        title={board.name}
        tile={<MkTile glyph="O" size={24} />}
        views={board.views}
        activeView="This week"
        toolbarLeft={
          <>
            <MkButton variant="secondary">Filter</MkButton>
            <MkButton variant="secondary">Sort</MkButton>
            <MkButton variant="secondary">Group</MkButton>
          </>
        }
        toolbarRight={<MkButton variant="primary">Create task</MkButton>}
      />
      {/* The list and the drawer beside it.
          Both carry a class as well as their styles, because whether the
          list is still worth drawing is a question about the WIDTH of the
          frame, and only a container query can answer that. At 619px of
          logical shell, which is what a two-up stop panel gives at 1440,
          a 320px drawer leaves the list 130px and "Onboard Bluefin Foods"
          comes out as three wrapped fragments with a chip between them. */}
      <div
        className="mk-boardlist"
        data-drawer={drawer}
        style={{ display: "flex", gap: 16, marginTop: 8, minWidth: 0 }}
      >
        <div className="mk-boardlist__list" style={{ flex: "1 1 auto", minWidth: 0, opacity: drawer ? 0.92 : 1 }}>
          {board.groups.map((group) => (
            <div key={group.name} style={{ marginBottom: 14 }}>
              <div style={{ marginBottom: 6 }}>
                <Meta>{group.name}</Meta>
              </div>
              <MkTableCard columns={["Name", "Status", "Owner", "Due"]} widths={MK_TASK_COLS} footer={`${group.rows.length} records`}>
                {group.rows.map((row) => {
                  const primary = row.primary === true;
                  const title = primary ? task.title : row.title ?? "";
                  const status = primary
                    ? done
                      ? "done"
                      : blocked
                        ? "blocked"
                        : task.status
                    : row.status ?? "not-started";
                  const owner = primary ? task.owner : row.owner ?? "sam";
                  const due = primary ? (done ? "Day 8" : task.dueLabel) : row.due ?? "";
                  return (
                    <MkTableRow key={row.id} widths={MK_TASK_COLS} selected={primary && drawer}>
                      <span style={{ flex: "1 1 auto", minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontWeight: primary ? 500 : 400 }}>{title}</span>
                        {primary ? (
                          <span style={{ display: "inline-flex", gap: 4, color: "var(--os-ink-3)" }}>
                            <FileText size={12} strokeWidth={1.5} aria-hidden />
                            <Target size={12} strokeWidth={1.5} aria-hidden />
                            <Users size={12} strokeWidth={1.5} aria-hidden />
                          </span>
                        ) : null}
                      </span>
                      <MkStatusChip status={status} />
                      <MkAvatar initials={castInitials(owner)} />
                      <Meta>{due}</Meta>
                    </MkTableRow>
                  );
                })}
              </MkTableCard>
            </div>
          ))}
        </div>
        {drawer ? <TaskDrawer blocked={blocked} /> : null}
      </div>
    </Canvas>
  );
}

export function TaskDrawer({ blocked = false }: { blocked?: boolean }) {
  const { task, timer } = tuesday;
  return (
    // `mk-drawer` is the class; the geometry is in the shell sheet, because
    // "how tall may this panel be" is a question about the frame around it
    // and an inline style cannot ask it.
    <aside
      className="mk-lift mk-drawer"
      style={{
        flex: "0 0 320px",
        width: 320,
        border: "1px solid var(--os-line)",
        borderRadius: "var(--os-r-md)",
        background: "var(--os-surface)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: 44,
          display: "flex",
          alignItems: "center",
          paddingInline: 12,
          borderBottom: "1px solid var(--os-line)",
        }}
      >
        <Meta>Onboarding › {task.title}</Meta>
      </div>
      <div style={{ padding: 12, display: "grid", gap: 10 }}>
        <div style={{ fontSize: "var(--os-t-title)", lineHeight: "var(--os-t-title-lh)", fontWeight: 600 }}>
          {task.title}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          <MkStatusChip
            status={blocked ? "blocked" : task.status}
            label={blocked ? "Blocked: finance sign off" : task.statusLabel}
          />
          <MkChip icon={<MkAvatar initials={castInitials(task.owner)} size={16} />}>{castName(task.owner)}</MkChip>
          <MkChip>{task.dueLabel}</MkChip>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {task.links.map((l) => (
            <MkChip key={l.type} tone="accent" icon={<Link2 size={12} strokeWidth={1.5} aria-hidden />}>
              {l.label}
            </MkChip>
          ))}
        </div>
        <div>
          <div style={{ marginBottom: 6 }}>
            <Meta>
              Checklist {task.checklist.filter((c) => c.done).length} of {task.checklist.length}
            </Meta>
          </div>
          <div style={{ display: "grid", gap: 5 }}>
            {task.checklist.map((item) => (
              <div key={item.title} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--os-t-helper)" }}>
                <CircleCheck
                  size={14}
                  strokeWidth={1.5}
                  aria-hidden
                  style={{ color: item.done ? "var(--os-success-solid)" : "var(--os-ink-4)", flex: "0 0 auto" }}
                />
                <span style={{ color: item.done ? "var(--os-ink-2)" : "var(--os-ink)" }}>{item.title}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, borderTop: "1px solid var(--os-line-soft)", paddingTop: 10 }}>
          <Timer size={14} strokeWidth={1.5} aria-hidden style={{ color: "var(--os-ink-2)" }} />
          <Meta>{timer.loggedLabel} logged</Meta>
        </div>
      </div>
    </aside>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 * 3. Docs, the SOP.
 * ═══════════════════════════════════════════════════════════════════ */

export function SopDocSurface({ highlightStep = 3 }: { highlightStep?: number }) {
  const { sop } = tuesday;
  return (
    <Canvas>
      <MkPageHeader
        title={sop.title}
        tile={<MkTile glyph={<FileText size={12} strokeWidth={1.5} />} size={24} />}
        toolbarLeft={
          <>
            {/* Owner is the PERSON, because that is what the product's own
                SOP page renders (it reads the row's creator). The fixture's
                old `ownedByRole` put a field on this surface that prisma
                `model SOP` does not have. What a role owns is the KRA, and
                that is the chip beside this one. */}
            <MkChip tone="accent" icon={<Users size={12} strokeWidth={1.5} aria-hidden />}>
              Owner: {castName(sop.owner)}
            </MkChip>
            <MkChip icon={<Target size={12} strokeWidth={1.5} aria-hidden />}>KRA: {sop.ownedByKra}</MkChip>
          </>
        }
        toolbarRight={<MkButton variant="secondary">Share</MkButton>}
      />
      <div style={{ maxWidth: 720, marginTop: 8, display: "grid", gap: 6 }}>
        {sop.steps.map((step) => {
          const active = step.n === highlightStep;
          return (
            <div
              key={step.n}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                padding: "8px 10px",
                borderRadius: "var(--os-r-sm)",
                background: active ? "var(--os-brand-soft)" : "transparent",
                border: active ? "1px solid var(--os-blue-200)" : "1px solid transparent",
              }}
            >
              <span
                style={{
                  flex: "0 0 auto",
                  width: 20,
                  height: 20,
                  borderRadius: 999,
                  background: active ? "var(--os-brand)" : "var(--os-surface-2)",
                  color: active ? "var(--os-ink-inv)" : "var(--os-ink-2)",
                  fontSize: 11,
                  fontWeight: 600,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {step.n}
              </span>
              <span style={{ flex: "1 1 auto", minWidth: 0 }}>
                <span style={{ display: "block", fontSize: "var(--os-t-prose, 15px)", lineHeight: "24px" }}>
                  {step.title}
                </span>
                <span style={{ display: "inline-flex", gap: 6, marginTop: 4 }}>
                  <MkChip>{step.owner}</MkChip>
                  {step.linkedKpi ? (
                    <MkChip tone="accent" icon={<Target size={12} strokeWidth={1.5} aria-hidden />}>
                      {tuesday.kpi.name}
                    </MkChip>
                  ) : null}
                </span>
              </span>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 12 }}>
        <Meta>SLA {sop.slaDays} days from the signed agreement.</Meta>
      </div>
    </Canvas>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 * 4. Talk, the channel thread.
 * ═══════════════════════════════════════════════════════════════════ */

export function TalkThreadSurface() {
  const { thread, huddle } = tuesday;
  // The picture answers to stop 3's gate. While the Talk thread cannot really
  // reference a task, the Sidekick message that writes the decision into the
  // channel and the "Pinned to ..." chip under it are not drawn: what is
  // drawn is the two people talking, and the decision recorded on the task,
  // which is what a comment does today.
  const { messages, pinAt, pinLabel } = threadView();
  return (
    <Canvas>
      <MkPageHeader
        title={`#${thread.channel}`}
        tile={<MkTile glyph={<Hash size={12} strokeWidth={1.5} />} size={24} />}
        toolbarLeft={<MkChip icon={<Video size={12} strokeWidth={1.5} aria-hidden />}>Call, {huddle.minutes} min</MkChip>}
        toolbarRight={<MkButton variant="secondary">Members</MkButton>}
      />
      <div style={{ maxWidth: 680, marginTop: 8, display: "grid", gap: 14 }}>
        {messages.map((m, i) => {
          const isSidekick = m.from === "sidekick";
          return (
            <div key={i} style={{ display: "flex", gap: 10 }}>
              {isSidekick ? (
                <span
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 999,
                    background: "var(--os-brand-soft)",
                    color: "var(--os-brand-deep)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flex: "0 0 auto",
                  }}
                >
                  <Sparkles size={13} strokeWidth={1.5} aria-hidden />
                </span>
              ) : (
                <MkAvatar initials={castInitials(m.from)} />
              )}
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontWeight: 500 }}>{isSidekick ? "Ask AI" : castName(m.from)}</span>
                  <Meta>{m.at}</Meta>
                </div>
                <div style={{ fontSize: "var(--os-t-body)", lineHeight: "var(--os-t-body-lh)", marginTop: 2 }}>
                  {m.body}
                </div>
                {i === pinAt ? (
                  <div style={{ marginTop: 6 }}>
                    <MkChip tone="accent" icon={<Link2 size={12} strokeWidth={1.5} aria-hidden />}>
                      {pinLabel}
                    </MkChip>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </Canvas>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 * 5. Tables, the Clients sheet.
 * ═══════════════════════════════════════════════════════════════════ */

/* The Clients grid's track, and which of its columns a phone gives up.
 *
 * Padded with the row number gutter, so the indices are:
 *   0 gutter  1 Client  2 Signed  3 Owner  4 Cycle days  5 SLA
 *
 * The name is the flexible track and is never dropped: beat 1's narration
 * is "Row 41 lands in Clients", so a row without "Bluefin Foods" on it is
 * the beat failing. Signed is the date the form wrote and SLA is the chip
 * the beat closes on, so both stay too. Cycle days goes first and Owner
 * goes with it on the narrowest bands, because neither is a sentence the
 * beat says out loud. Kept as constants so the header and every row are
 * handed the same array and can never disagree. */
const TABLE_COLS: MkColWidths = [32, null, ...tuesday.table.columns.slice(1).map(() => 90)];
/* Third from the end and second from the end: Owner and Cycle days in the
   fixture as it stands, derived rather than typed so a column added to the
   JSON cannot silently move the drop onto the SLA chip. */
const TABLE_COL_CLASSES: ReadonlyArray<string | undefined> = TABLE_COLS.map((_, i) => {
  if (i === TABLE_COLS.length - 2) return "mk-col-drop-1";
  if (i === TABLE_COLS.length - 3) return "mk-col-drop-2";
  return undefined;
});

export function TableSurface() {
  const { table } = tuesday;
  return (
    <Canvas>
      <MkPageHeader
        title={table.name}
        tile={<MkTile glyph={<Sheet size={12} strokeWidth={1.5} />} size={24} />}
        views={["Grid", "Form", "Gallery"]}
        activeView="Grid"
        toolbarLeft={<MkButton variant="secondary">Filter</MkButton>}
        toolbarRight={<MkButton variant="primary">New row</MkButton>}
      />
      <div
        className="mk-mono"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          height: 32,
          paddingInline: 10,
          border: "1px solid var(--os-line)",
          borderRadius: "var(--os-r-sm)",
          background: "var(--os-surface-1)",
          color: "var(--os-ink-2)",
          fontSize: 12,
          marginBottom: 10,
          overflow: "hidden",
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ color: "var(--os-ink-2)" }}>fx</span>
        {table.formulaBar}
      </div>
      {/* The grid's first body cell is the row number gutter, which the
          header had no counterpart for, so every label sat 32px plus a gap
          to the left of the column it named. The track below opens with
          that gutter and the header opens with a blank cell above it. */}
      <MkTableCard
        columns={["", ...table.columns]}
        widths={TABLE_COLS}
        colClasses={TABLE_COL_CLASSES}
        footer={`Total records ${table.rows.length + 38}`}
      >
        {table.rows.map((row) => (
          <MkTableRow
            key={row.n}
            widths={TABLE_COLS}
            colClasses={TABLE_COL_CLASSES}
            selected={row.highlight}
          >
            <span style={{ color: "var(--os-ink-2)", fontSize: "var(--os-t-meta)" }}>{row.n}</span>
            {row.cells.map((cell, i) => (
              <span
                key={i}
                style={{
                  minWidth: 0,
                  fontWeight: i === 0 ? 500 : 400,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {i === row.cells.length - 1 ? <MkStatusChip status="done" label={cell} /> : cell}
              </span>
            ))}
          </MkTableRow>
        ))}
      </MkTableCard>
    </Canvas>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 * 6. Goals, the goal detail with the ring, the verdict and the Effort card.
 * ═══════════════════════════════════════════════════════════════════ */

function Ring({ percent }: { percent: number }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  const filled = (Math.min(100, Math.max(0, percent)) / 100) * c;
  return (
    <svg width={76} height={76} viewBox="0 0 76 76" aria-hidden>
      <circle cx="38" cy="38" r={r} fill="none" stroke="var(--os-surface-2)" strokeWidth="7" />
      <circle
        cx="38"
        cy="38"
        r={r}
        fill="none"
        stroke="var(--os-success-solid)"
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={`${filled} ${c - filled}`}
        transform="rotate(-90 38 38)"
      />
      <text x="38" y="42" textAnchor="middle" fontSize="16" fontWeight="600" fill="var(--os-ink)">
        {percent}%
      </text>
    </svg>
  );
}

/** Task, Owner: the Effort card under a goal. */
const GOAL_EFFORT_COLS: MkColWidths = [null, 44];

export function GoalDetailSurface({ percent }: { percent?: number }) {
  const { goal } = tuesday;
  const value = percent ?? goal.progressAfter;
  return (
    <Canvas>
      <MkPageHeader
        title={goal.title}
        tile={<MkTile glyph={<Target size={12} strokeWidth={1.5} />} size={24} />}
        // The person, not a role. A Goal has an owner and a department in
        // the product; a role owns the KRA. The header used to print an
        // invented "ownerRole" field beside the owner's avatar.
        toolbarLeft={<MkChip icon={<MkAvatar initials={castInitials(goal.owner)} size={16} />}>{castName(goal.owner)}</MkChip>}
        toolbarRight={<MkButton variant="secondary">Update</MkButton>}
      />
      <div style={{ display: "flex", gap: 20, alignItems: "flex-start", marginTop: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Ring percent={value} />
          <div>
            <MkStatusChip status="on track" label="On track" />
            <div style={{ maxWidth: 320, marginTop: 8, fontSize: "var(--os-t-helper)", lineHeight: "var(--os-t-helper-lh)", color: "var(--os-ink-2)" }}>
              {goal.verdict}
            </div>
          </div>
        </div>
        <div style={{ flex: "1 1 280px", minWidth: 260 }}>
          <div style={{ marginBottom: 6 }}>
            <Meta>Effort</Meta>
          </div>
          <MkTableCard columns={["Task", "Owner"]} widths={GOAL_EFFORT_COLS} footer={`${goal.effort.length} linked tasks`}>
            {goal.effort.map((e) => (
              <MkTableRow key={e.taskId} widths={GOAL_EFFORT_COLS} selected={e.taskId === tuesday.task.id}>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {e.title}
                </span>
                <MkAvatar initials={castInitials(e.owner)} />
              </MkTableRow>
            ))}
          </MkTableCard>
          <div style={{ marginTop: 8 }}>
            <MkChip tone="accent" icon={<Target size={12} strokeWidth={1.5} aria-hidden />}>
              {tuesday.kpi.name}: {tuesday.kpi.current} {tuesday.kpi.unit}, target {tuesday.kpi.target}
            </MkChip>
          </div>
        </div>
      </div>
    </Canvas>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 * 7. Teams, the role definition page.
 * ═══════════════════════════════════════════════════════════════════ */

export function RolePageSurface() {
  const { role, kra, kpi } = tuesday;
  return (
    <Canvas>
      <MkPageHeader
        title={role.title}
        tile={<MkTile glyph={<Users size={12} strokeWidth={1.5} />} size={24} />}
        toolbarLeft={
          <MkChip icon={<MkAvatar initials={castInitials(role.holder)} size={16} />}>
            Held by {castName(role.holder)}
          </MkChip>
        }
        toolbarRight={<MkButton variant="secondary">Edit role</MkButton>}
      />
      <div style={{ display: "grid", gap: 14, maxWidth: 680, marginTop: 8 }}>
        <div
          style={{
            border: "1px solid var(--os-line)",
            borderRadius: "var(--os-r-md)",
            padding: 14,
            background: "var(--os-surface)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <BrandDot color="yellow" />
            <span style={{ fontWeight: 500 }}>{kra.title}</span>
            <span style={{ marginInlineStart: "auto" }}>
              <MkChip>{kra.weight}% of the role</MkChip>
            </span>
          </div>
          <div style={{ height: 6, borderRadius: 999, background: "var(--os-surface-2)", overflow: "hidden" }}>
            <div style={{ width: `${kra.progress}%`, height: "100%", background: "var(--os-success-solid)" }} />
          </div>
          <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
            <MkChip tone="accent" icon={<Target size={12} strokeWidth={1.5} aria-hidden />}>
              KPI: {kpi.name}
            </MkChip>
            <MkChip icon={<FileText size={12} strokeWidth={1.5} aria-hidden />}>SOP: {tuesday.sop.title}</MkChip>
          </div>
        </div>
        <div>
          <div style={{ marginBottom: 6 }}>
            <Meta>Boundaries</Meta>
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            {role.boundaries.map((b) => (
              <div key={b} style={{ fontSize: "var(--os-t-body)", lineHeight: "var(--os-t-body-lh)" }}>
                <Muted>{b}</Muted>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Canvas>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 * 8. Teams, the review timeline.
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * The review timeline.
 *
 * THE SURFACE IS THE CLAIM. Stop 6's truth gate names "kudos landing as
 * review evidence" and is shipped:false, and this surface was drawing the
 * kudos row on the timeline and the kudos card beneath it unconditionally:
 * the strongest form of the claim, made in a picture, with no gate. Nothing
 * in the product links a kudos to a review (the only connection in the repo
 * is a number added to a composite score in performanceScoreService), so
 * both are now behind the same gate the prose goes through, and the surface
 * says what a review timeline really carries today instead.
 */
function kudosIsReviewEvidence(): boolean {
  return stopByNumber(6)?.truthGate.shipped ?? false;
}

export function ReviewTimelineSurface() {
  const { review } = tuesday;
  const kudosShips = kudosIsReviewEvidence();
  const timeline = kudosShips ? review.timeline : review.timeline.filter((row) => row.kind !== "kudos");
  return (
    <Canvas>
      <MkPageHeader
        title={`${castName(review.personId)}, ${review.cycle} review`}
        tile={<MkAvatar initials={castInitials(review.personId)} size={24} />}
        toolbarRight={<MkButton variant="secondary">Open cycle</MkButton>}
      />
      <div style={{ maxWidth: 560, marginTop: 8 }}>
        {timeline.map((row, i) => (
          <div key={i} style={{ display: "flex", gap: 12, paddingBlock: 8, borderBottom: "1px solid var(--os-line-soft)" }}>
            <span style={{ flex: "0 0 40px", color: "var(--os-ink-2)", fontSize: "var(--os-t-meta)" }}>{row.at}</span>
            <span style={{ flex: "0 0 auto" }}>
              <BrandDot color={row.kind === "kudos" ? "yellow" : row.kind === "kra" ? "green" : "blue"} size={7} />
            </span>
            <span style={{ flex: "1 1 auto", minWidth: 0, fontSize: "var(--os-t-body)" }}>{row.label}</span>
          </div>
        ))}
      </div>
      {kudosShips ? (
        <div
          style={{
            marginTop: 14,
            maxWidth: 560,
            border: "1px solid var(--os-line)",
            borderRadius: "var(--os-r-md)",
            padding: 12,
            background: "var(--os-surface)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <MkAvatar initials={castInitials(tuesday.kudos.from)} />
            <span style={{ fontWeight: 500 }}>{castName(tuesday.kudos.from)}</span>
            <MkChip tone="accent">{tuesday.kudos.value}</MkChip>
            <span style={{ marginInlineStart: "auto" }}>
              <Meta>{tuesday.kudos.at}</Meta>
            </span>
          </div>
          <div style={{ fontSize: "var(--os-t-body)", lineHeight: "var(--os-t-body-lh)" }}>{tuesday.kudos.message}</div>
        </div>
      ) : null}
    </Canvas>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 * 9. AI, the Ask panel with its four source chips.
 * ═══════════════════════════════════════════════════════════════════ */

export function AskAiSurface() {
  return (
    <Canvas>
      <AskAiPanel />
    </Canvas>
  );
}

/**
 * The Ask panel on its own, without a canvas around it.
 *
 * Split out so stop 6 can open it OVER the assembled shell rather than
 * beside it in a second frame. See `CloseSurface` below.
 */
export function AskAiPanel() {
  const { askAi } = tuesday;
  return (
      <div
        style={{
          maxWidth: 560,
          marginTop: 12,
          border: "1px solid var(--os-line)",
          borderRadius: "var(--os-r-md)",
          background: "var(--os-surface)",
          overflow: "hidden",
        }}
        className="mk-lift"
      >
        <div
          style={{
            height: 44,
            display: "flex",
            alignItems: "center",
            gap: 8,
            paddingInline: 12,
            borderBottom: "1px solid var(--os-line)",
          }}
        >
          <Sparkles size={16} strokeWidth={1.5} aria-hidden style={{ color: "var(--os-brand-deep)" }} />
          <span style={{ fontWeight: 600, fontSize: "var(--os-t-title)" }}>Ask AI</span>
        </div>
        <div style={{ padding: 14, display: "grid", gap: 10 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              minHeight: 36,
              paddingInline: 10,
              border: "1px solid var(--os-line-strong)",
              borderRadius: "var(--os-r-sm)",
            }}
          >
            <Mic size={14} strokeWidth={1.5} aria-hidden style={{ color: "var(--os-ink-3)" }} />
            <span>{askAi.question}</span>
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            {askAi.answer.map((line, i) => (
              <p key={i} style={{ margin: 0, fontSize: "var(--os-t-body)", lineHeight: "var(--os-t-body-lh)" }}>
                {line}
              </p>
            ))}
          </div>
          {/* The source chips ARE stop 6's mechanism, drawn.
              The stop's own truthGate names "a Sidekick answer with four
              source chips" as the thing that has not shipped, and the AI
              route returns { query, response } with nothing cited. The Talk
              thread's pin got a gate for exactly this reason (threadView);
              this row did not, so the one picture that showed the unbuilt
              mechanism was the one nobody gated. A surface IS a claim.

              With the gate closed the answer stands on its own and the card
              says which blocks the question was about, which is a statement
              about the workspace rather than about a citation. */}
          {stopShipped(6) ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, borderTop: "1px solid var(--os-line-soft)", paddingTop: 10 }}>
              {askAi.sources.map((s) => (
                <MkChip key={s.label} icon={<BrandDot color={s.dot} size={6} />}>
                  {s.label}
                </MkChip>
              ))}
            </div>
          ) : (
            <div
              style={{
                borderTop: "1px solid var(--os-line-soft)",
                paddingTop: 10,
                fontSize: "var(--os-t-meta)",
                lineHeight: "var(--os-t-meta-lh)",
                color: "var(--os-ink-2)",
              }}
            >
              Reads the workspace. Citing the records behind an answer is in build.
            </div>
          )}
        </div>
      </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 * 9b. THE CLOSE. Stop 6 breaks the scene's grammar on purpose.
 *
 * Every other stop is a pair of frames with a wire between them, which is
 * how the story says "this block talked to that one". The close is not
 * another pair: concept 4's stop 6 is the blocks snapping BACK into one
 * navy framed shell with the Sidekick panel opening over it. Shipped as a
 * seventh left-and-right pair it was the same sentence in the same
 * grammar, and the payoff the five viewport pin is paying for landed as
 * another beat.
 *
 * So this is one surface: the assembled workspace, with the Ask panel
 * floating over its canvas the way a panel does in the product. The
 * fixture already said as much, and nothing read it: stop 6 declares
 * left = work/shell and right = ai/ask-ai, while the render used the
 * beat's own two hubs.
 * ═══════════════════════════════════════════════════════════════════ */

export function CloseSurface() {
  return (
    <div className="mk-close-surface">
      <MyWorkSurface compact />
      <div className="mk-close-surface__ask">
        <AskAiPanel />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 * 10. Planner, the week with the huddle and the timer.
 * ═══════════════════════════════════════════════════════════════════ */

const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const HOURS = ["1 PM", "2 PM", "3 PM"];

export function PlannerWeekSurface() {
  const { huddle, timer } = tuesday;
  return (
    <Canvas>
      <MkPageHeader
        title="My week"
        views={["Week", "Month", "People"]}
        activeView="Week"
        toolbarLeft={<MkChip icon={<Timer size={12} strokeWidth={1.5} aria-hidden />}>{timer.loggedLabel} today</MkChip>}
        toolbarRight={<MkButton variant="primary">New event</MkButton>}
      />
      <div
        style={{
          marginTop: 8,
          border: "1px solid var(--os-line)",
          borderRadius: "var(--os-r-md)",
          overflow: "hidden",
          background: "var(--os-surface)",
        }}
      >
        <div style={{ display: "flex", background: "var(--os-table-head-bg)", borderBottom: "1px solid var(--os-line)" }}>
          <span style={{ flex: "0 0 56px" }} />
          {WEEK.map((d) => (
            <span
              key={d}
              style={{
                flex: "1 1 0",
                textAlign: "center",
                paddingBlock: 8,
                fontSize: "var(--os-t-helper)",
                fontWeight: d === "Tue" ? 600 : 500,
                color: d === "Tue" ? "var(--os-ink)" : "var(--os-ink-2)",
              }}
            >
              {d}
            </span>
          ))}
        </div>
        {HOURS.map((h) => (
          <div key={h} style={{ display: "flex", borderBottom: "1px solid var(--os-line-soft)", minHeight: 52 }}>
            <span style={{ flex: "0 0 56px", padding: 6, fontSize: "var(--os-t-meta)", color: "var(--os-ink-2)" }}>{h}</span>
            {WEEK.map((d) => (
              <span key={d} style={{ flex: "1 1 0", borderInlineStart: "1px solid var(--os-line-soft)", padding: 4 }}>
                {d === "Tue" && h === "2 PM" ? (
                  <span
                    style={{
                      display: "block",
                      background: "var(--os-brand-soft)",
                      borderInlineStart: "2px solid var(--os-brand)",
                      borderRadius: "var(--os-r-xs)",
                      padding: "5px 7px",
                      marginTop: 14,
                    }}
                  >
                    <span style={{ display: "block", fontSize: "var(--os-t-meta)", fontWeight: 500, color: "var(--os-ink)" }}>
                      {huddle.title}
                    </span>
                    <span style={{ display: "block", fontSize: "var(--os-t-meta)", color: "var(--os-ink-2)" }}>
                      {huddle.at}, {huddle.minutes} min
                    </span>
                  </span>
                ) : null}
              </span>
            ))}
          </div>
        ))}
      </div>
    </Canvas>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 * 11. Docs, the contract.
 * ═══════════════════════════════════════════════════════════════════ */

export function ContractDocSurface() {
  const { contract, task } = tuesday;
  return (
    <Canvas>
      <MkPageHeader
        title={contract.title}
        tile={<MkTile glyph={<FileText size={12} strokeWidth={1.5} />} size={24} />}
        toolbarLeft={<MkChip icon={<Paperclip size={12} strokeWidth={1.5} aria-hidden />}>Attached to {task.title}</MkChip>}
        toolbarRight={<MkButton variant="secondary">Share</MkButton>}
      />
      <div style={{ maxWidth: 680, marginTop: 8 }}>
        <div
          style={{
            border: "1px solid var(--os-blue-200)",
            background: "var(--os-brand-soft)",
            borderRadius: "var(--os-r-sm)",
            padding: 12,
          }}
        >
          <div style={{ fontWeight: 500, marginBottom: 4 }}>{contract.clause}</div>
          <div style={{ fontSize: "15px", lineHeight: "24px", color: "var(--os-ink)" }}>{contract.clauseBody}</div>
        </div>
        <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
          <MkChip icon={<BookOpen size={12} strokeWidth={1.5} aria-hidden />}>Policy: {contract.linkedPolicy}</MkChip>
          <MkChip>Attached {contract.attachedAt}</MkChip>
        </div>
      </div>
    </Canvas>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 * 12. The invite modal.
 * ═══════════════════════════════════════════════════════════════════ */

export function InviteModalSurface() {
  return (
    <div style={{ position: "relative", height: "100%", background: "var(--os-surface-1)", padding: 24 }}>
      <div
        className="mk-lift"
        style={{
          maxWidth: 480,
          margin: "0 auto",
          background: "var(--os-surface)",
          border: "1px solid var(--os-line)",
          borderRadius: "var(--os-r-md)",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: 16, borderBottom: "1px solid var(--os-line)", fontWeight: 600, fontSize: "var(--os-t-title)" }}>
          Invite people
        </div>
        <div style={{ padding: 16, display: "grid", gap: 10 }}>
          <div
            style={{
              minHeight: 36,
              display: "flex",
              alignItems: "center",
              gap: 6,
              flexWrap: "wrap",
              paddingInline: 10,
              border: "1px solid var(--os-line-strong)",
              borderRadius: "var(--os-r-sm)",
            }}
          >
            <MkChip icon={<MkAvatar initials="SO" size={16} />}>sam@northwindops.example</MkChip>
            <Muted>Add an email</Muted>
          </div>
          {/* "Member" is not a level this product has.
              The invite dialog picks an AccessLevel, and the shipped enum is
              the ladder in src/lib/access-levels.ts: C-Level, VP, Director,
              Manager, Team Lead, HR, Employee, Agent, over Company Admin and
              Super Admin. "Member" belongs to the four-role model
              access-model-spec BUILDS, and /features/access records, in its
              own header, a deliberate decision not to describe that model
              until it ships. The picture was showing it anyway, which is the
              one thing a marketing-lite surface exists not to do: draw a
              screen the product does not have. */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Meta>Level</Meta>
            <MkChip>Employee</MkChip>
            <span style={{ marginInlineStart: "auto" }}>
              <MkButton variant="primary">Send invites</MkButton>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 * 13. Template Center, with the Tuesday tile.
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * The tiles Template Center really has, plus the Tuesday one behind its own
 * flag. Drawing a blue-bordered "Tuesday: client onboarding" tile as the
 * first thing in the product is the same promise the prose makes, made in a
 * picture; nothing in src/lib/templates or the Template Center seeds carries
 * that template today.
 */
const TEMPLATE_TILES: Array<{ name: string; note: string; primary?: boolean }> = [
  ...(flags.tuesdayTemplateAtSignup
    ? [{ name: tuesday.workspace.templateName, note: "SOP, board, goal and roles", primary: true }]
    : []),
  { name: "Weekly operations review", note: "Agenda, KPI pack, actions" },
  { name: "Supplier onboarding", note: "SOP and checklist" },
  { name: "Quarterly planning", note: "OKRs and a planning board" },
];

export function TemplateCenterSurface() {
  return (
    <Canvas>
      <MkPageHeader
        title="Templates"
        views={["All", "Spaces", "Lists", "Docs"]}
        activeView="Spaces"
        toolbarRight={<MkButton variant="primary">New template</MkButton>}
      />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12, marginTop: 8 }}>
        {TEMPLATE_TILES.map((t) => (
          <div
            key={t.name}
            style={{
              border: t.primary ? "1px solid var(--os-brand)" : "1px solid var(--os-line)",
              borderRadius: "var(--os-r-md)",
              padding: 12,
              background: "var(--os-surface)",
              minHeight: 96,
            }}
          >
            <span style={{ display: "inline-flex", gap: 4, marginBottom: 8 }}>
              {(["yellow", "blue", "red", "green"] as const).map((c) => (
                <span key={c} aria-hidden style={{ width: 6, height: 6, borderRadius: 999, background: DOT_HEX[c] }} />
              ))}
            </span>
            <div style={{ fontWeight: 500 }}>{t.name}</div>
            <div style={{ marginTop: 2 }}>
              <Meta>{t.note}</Meta>
            </div>
            {t.primary ? (
              <div style={{ marginTop: 8 }}>
                <MkChip tone="accent">Starts your Tuesday</MkChip>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </Canvas>
  );
}

/**
 * Every surface the shell can render, keyed by the fixture's surface names.
 *
 * `my-work` is COMPACT here, and that is the one thing in this table worth
 * reading twice. Every caller of SURFACES is a scaled frame in a column, and
 * a scaled frame shows its top-left corner first, so the region a visitor
 * actually read was the empty "Nothing overdue." bucket rather than the task
 * the narration was describing. Beats 3, 4 and 5 all narrate something
 * happening TO the task while the visible frame showed an empty table. The
 * bucket is a good quiet empty state and it costs 180px; the hero's
 * full-size frame, which calls MyWorkSurface directly, still has the room
 * for it.
 */
export const SURFACES: Record<string, () => ReactNode> = {
  "my-work": () => <MyWorkSurface compact />,
  "board-list": () => <BoardListSurface />,
  "board-list-drawer": () => <BoardListSurface drawer />,
  // The two states the storyboard's own stops ask for, so the picture at a
  // stop says what the sentence beside it says. Stop 4 is blocked between
  // 2:00 and 2:30; stop 5 is done at 4:45.
  "board-list-blocked": () => <BoardListSurface drawer blocked />,
  "board-list-done": () => <BoardListSurface done />,
  "sop-doc": () => <SopDocSurface />,
  "talk-thread": () => <TalkThreadSurface />,
  table: () => <TableSurface />,
  "goal-detail": () => <GoalDetailSurface />,
  "role-page": () => <RolePageSurface />,
  "review-timeline": () => <ReviewTimelineSurface />,
  "ask-ai": () => <AskAiSurface />,
  // Stop 6 only: the shell with the Sidekick open over it.
  close: () => <CloseSurface />,
  "planner-week": () => <PlannerWeekSurface />,
  "contract-doc": () => <ContractDocSurface />,
  "invite-modal": () => <InviteModalSurface />,
  "template-center": () => <TemplateCenterSurface />,
  shell: () => <MyWorkSurface compact />,
};

export function statusWord(status: string): string {
  return statusLabel(status);
}
