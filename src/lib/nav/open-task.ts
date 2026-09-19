// Opening a task: one door, and the breadcrumb that tells Close where it came
// from.
//
// spec-task-detail section 4 step 4 asks for drawer-first at ONE URL: a soft
// navigation from a list renders the drawer over that list, a hard load of the
// same URL renders the full page. Next's intercepting routes ARE that rule,
// and the intercept is what decides it: `@drawer/(.)item/[id]` matches a soft
// navigation and `@drawer/default.tsx` answers a hard load with nothing.
//
// An earlier revision gated the intercept on a sessionStorage "intent" written
// by the pushing host, so that only the four migrated list surfaces opened a
// drawer. That was a trap, and it cost every other door into a task: when the
// intercept matches but renders nothing, Next has ALREADY held `children` on
// the surface the navigation started from, so the URL became the task's and
// the task was displayed nowhere. Inbox rows, the bell, reminders, the Space
// overview, canvas cards, "Create and open" and the `?item=` back-compat
// redirect all landed on that hole. The intercept therefore NEVER returns
// nothing: whatever matched it, the task is rendered.
//
// What survives of the intent is the part that was never a gate: one
// sessionStorage entry naming the URL the drawer was opened FROM, so ✕ lands
// on that list even when there is no history entry to go back to. Its absence
// costs a nicer fallback and nothing else.

export const TASK_DRAWER_INTENT_KEY = "workwrk:task-drawer-intent";

export interface TaskDrawerIntent {
  /** The task the host meant to open as a drawer. */
  itemId: string;
  /** The host URL, so Close can return to it when there is no history. */
  from: string;
}

function store(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    // Private windows and blocked site data throw on access, not on use.
    return null;
  }
}

/** Record that the NEXT navigation to this task should render as a drawer. */
export function armTaskDrawer(itemId: string, from: string): void {
  const s = store();
  if (!s) return;
  try {
    const intent: TaskDrawerIntent = { itemId, from };
    s.setItem(TASK_DRAWER_INTENT_KEY, JSON.stringify(intent));
  } catch {
    // A full quota is not a reason to fail to open a task: the navigation
    // still happens and the person gets the page.
  }
}

/** The armed intent, if it is for this task. Never throws. */
export function readTaskDrawer(itemId: string): TaskDrawerIntent | null {
  const s = store();
  if (!s) return null;
  try {
    const raw = s.getItem(TASK_DRAWER_INTENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TaskDrawerIntent>;
    if (!parsed || parsed.itemId !== itemId) return null;
    const from = typeof parsed.from === "string" && parsed.from.startsWith("/") && !parsed.from.startsWith("//") ? parsed.from : "/everything";
    return { itemId, from };
  } catch {
    return null;
  }
}

export function clearTaskDrawer(): void {
  const s = store();
  if (!s) return;
  try {
    s.removeItem(TASK_DRAWER_INTENT_KEY);
  } catch {
    /* nothing to do */
  }
}

/**
 * The one call every list surface makes on a row click.
 *
 * `router` is Next's `useRouter()` return value, narrowed to what is used here
 * so this module stays importable from a test without React.
 */
export function openTask(router: { push: (href: string) => void }, itemId: string): void {
  if (typeof window !== "undefined") {
    armTaskDrawer(itemId, `${window.location.pathname}${window.location.search}`);
  }
  router.push(`/item/${itemId}`);
}
