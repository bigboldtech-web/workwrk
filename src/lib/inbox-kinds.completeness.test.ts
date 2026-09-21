// The completeness test spec-work-home.md section 2 asks for by name:
// "lives in `src/lib/inbox-kinds.ts` and is unit-tested against every
// `notification.create` call site's `type` literal, so an unrouted type fails
// the build instead of landing in Other with a snake_case label".
//
// It reads the repository rather than a hand-kept list, because a hand-kept
// list drifts the moment somebody adds a notification, which is exactly the
// drift that produced sixteen unlabelled grey bells in the first place.
//
// WHAT IT CAN AND CANNOT SEE. It finds `prisma.notification.create` and
// `createMany` calls and reads the `type:` values in the object literal that
// follows. Three shapes are deliberately out of reach and are recorded here
// rather than silently passed over:
//
//   - `type` bound to a variable (`type: args.type`) — the caller's own union
//     is the contract, and lib/notify-item.ts's four members are asserted
//     directly below.
//   - a template string (`timesheet_${decision.toLowerCase()}`) — the finite
//     expansions are listed in DYNAMIC_EXPANSIONS and each one is asserted.
//   - a user-supplied string (lib/workflows/runtime.ts passes an automation
//     author's `cfg.notificationType` straight through) — unroutable by
//     construction, which is why `kindFor` is total.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { KINDS, kindFor, normaliseNotificationType } from "./inbox-kinds";

const ROOT = path.resolve(__dirname, "../..");
const SCAN_ROOTS = ["src/app/api", "src/lib", "src/services"];

function walk(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name) && !e.name.endsWith(".test.ts")) out.push(p);
  }
}

/**
 * The `type:` literals written near a notification create call, with the file
 * that writes them. The window is generous (a `createMany` builds its rows in
 * a `.map()` several lines above the call, and `role-boundaries` writes two
 * rows in one statement), so a couple of unrelated `type:` keys from the same
 * neighbourhood come along; those are named in NOT_NOTIFICATION_TYPES.
 */
function scanWrittenTypes(): Map<string, string[]> {
  const files: string[] = [];
  for (const r of SCAN_ROOTS) walk(path.join(ROOT, r), files);
  const found = new Map<string, string[]>();
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    const call = /notification\.create(?:Many)?\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = call.exec(src))) {
      const window = src.slice(Math.max(0, m.index - 1400), m.index + 1400);
      const lit = /\btype:\s*(?:"([^"$]+)"|'([^'$]+)')/g;
      let t: RegExpExecArray | null;
      while ((t = lit.exec(window))) {
        const value = t[1] ?? t[2];
        const rel = path.relative(ROOT, file);
        const list = found.get(value) ?? [];
        if (!list.includes(rel)) list.push(rel);
        found.set(value, list);
      }
    }
  }
  return found;
}

/**
 * Literals the scanner picks up from the neighbourhood of a notification write
 * that are NOT `Notification.type` values. Each one is named with what it
 * really is, so this list can never become a quiet escape hatch.
 */
const NOT_NOTIFICATION_TYPES: Readonly<Record<string, string>> = {
  BOARD_ITEM: "EntityLink / Reminder entityType, beside the mention write in api/items/[id]/updates",
  FILE: "EntityLinkType in the same handler",
  all: "the audience selector in api/email/send-reminders",
  Task: "an email template's section label in api/email/send-reminders",
  board: "an automation action config field in lib/automation/registry-actions",
  user: "an automation action config field in lib/automation/registry-actions",
  string: "an automation action config field type",
  text: "an automation action config field type",
  number: "an automation action config field type",
  status: "an automation action config field type",
  "asset.create": "an ActivityLog action, not a notification",
  "policy.publish": "an ActivityLog action beside the publish notification in api/policies/[id]",
  message: "the SSE realtime event name in api/conversations/[id]/messages",
  notification: "the SSE realtime event name in the same handler",
  kudos_given: "an ActivityLog action beside the KUDOS notification",
  okr_created: "an ActivityLog action beside okr_assigned",
  meeting_created: "an ActivityLog action beside meeting_invite",
  reviews_finalized: "an ActivityLog action beside the REVIEW notification",
  bulk_update: "an ActivityLog action in api/people/bulk-update",
  task_created: "an ActivityLog action in api/tasks (legacy Task model)",
  task_completed: "an ActivityLog action in api/tasks (legacy Task model)",
  process_run_started: "an ActivityLog action beside the run.assigned notification in api/process-runs",
  process_run_cancelled: "an ActivityLog action in api/process-runs/[id]",
  process_run_deleted: "an ActivityLog action in api/process-runs/[id]",
};

/**
 * Template-string types, expanded. Each expansion must route, or the row lands
 * in the Inbox with no label the day somebody approves a timesheet.
 */
const DYNAMIC_EXPANSIONS: Readonly<Record<string, string[]>> = {
  "timesheet_${decision.toLowerCase()}": ["timesheet_approved", "timesheet_rejected"],
};

describe("inbox-kinds covers every notification the app writes", () => {
  const written = scanWrittenTypes();

  it("finds notification writes at all (the scanner itself is not broken)", () => {
    expect(written.size).toBeGreaterThan(20);
    // `mention` is written inline, next to its own `notification.create`, so
    // it is in range of the scanner's window and is the canary for "the
    // scanner still reads files".
    expect(written.has("mention")).toBe(true);
    // `task_assigned` USED to be the second canary, because api/tasks/route.ts
    // wrote it inline. Phase 2 W4 retired that route (it is a 410 now) and the
    // only remaining writer is `emit()` in lib/notify-item.ts, which takes the
    // type as an argument from a caller more than the scanner's 1400-character
    // window away from the `notification.createMany` call. The type is still
    // written, and `inbox-kinds.ts` still routes it — what changed is that a
    // REGEX cannot see it, which is a limit of the scanner and not a gap in
    // the product. Asserting on it here would be asserting that a literal sits
    // near a call, which is not a property worth pinning.
    expect(KINDS.task_assigned, "task_assigned must still be routed").toBeTruthy();
  });

  it("routes every literal type written anywhere in the repository", () => {
    const unrouted: string[] = [];
    for (const [type, files] of written) {
      if (type in NOT_NOTIFICATION_TYPES) continue;
      const normalised = normaliseNotificationType(type);
      if (!KINDS[normalised]) unrouted.push(`${type} (written by ${files.join(", ")})`);
    }
    expect(unrouted, `unrouted notification types:\n  ${unrouted.join("\n  ")}`).toEqual([]);
  });

  it("routes every expansion of a template type", () => {
    for (const expansions of Object.values(DYNAMIC_EXPANSIONS)) {
      for (const type of expansions) {
        expect(KINDS[type], `${type} has no kind`).toBeDefined();
      }
    }
  });

  it("routes the four types lib/notify-item.ts writes through its own union", () => {
    // notify-item passes `args.type` into the create, so the scanner cannot
    // read it. Its docblock declares exactly these four.
    for (const type of ["task_assigned", "task_status_changed", "task_due_today", "task_overdue"]) {
      expect(KINDS[type], `${type} has no kind`).toBeDefined();
    }
  });

  it("never leaves a routed row without words, whatever the writer sends", () => {
    // The automation runtime forwards a user-supplied string. It must still
    // render as something a person can read.
    const kind = kindFor("my_custom_automation_ping");
    expect(kind.label.length).toBeGreaterThan(0);
    expect(kind.tab).toBe("other");
  });
});
