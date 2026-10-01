// The first-run console, read one way everywhere (settings-architecture
// 11.2, spec-account-auth `/onboard` "The wizard and the Overview card, one
// rule"). Pure.
//
// Organization.settings.console = { setupStep, setupCompletedAt,
// setupDismissedAt }. Workspaces made before this release hold only the old
// boolean settings.setupCompleted; true there reads as completed, so a
// workspace that finished either old wizard is never offered setup again.

export interface ConsoleState {
  setupStep: 1 | 2 | 3 | 4;
  setupCompletedAt: string | null;
  setupDismissedAt: string | null;
}

/** A stored ISO date, or "legacy" (the marker readConsole gives an org that only holds the old boolean), else null. */
function iso(v: unknown): string | null {
  if (v === "legacy") return v;
  return typeof v === "string" && v.trim() && !Number.isNaN(Date.parse(v)) ? v : null;
}

export function readConsole(settings: unknown): ConsoleState {
  const s = settings && typeof settings === "object" && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {};
  const c = s.console && typeof s.console === "object" && !Array.isArray(s.console) ? (s.console as Record<string, unknown>) : {};
  const stepRaw = typeof c.setupStep === "number" ? Math.round(c.setupStep) : 1;
  const setupStep = (Math.min(4, Math.max(1, stepRaw)) as ConsoleState["setupStep"]);
  const legacyDone = s.setupCompleted === true;
  return {
    setupStep,
    setupCompletedAt: iso(c.setupCompletedAt) ?? (legacyDone ? "legacy" : null),
    setupDismissedAt: iso(c.setupDismissedAt),
  };
}

export type OnboardView =
  | { kind: "wizard"; step: ConsoleState["setupStep"] }
  | { kind: "nothing"; reason: "not-admin" | "completed" | "dismissed" };

/** What /onboard renders for this viewer (only Owner and Admin ever get the wizard). */
export function onboardView(state: ConsoleState, isWorkspaceAdmin: boolean): OnboardView {
  if (!isWorkspaceAdmin) return { kind: "nothing", reason: "not-admin" };
  if (state.setupCompletedAt) return { kind: "nothing", reason: "completed" };
  if (state.setupDismissedAt) return { kind: "nothing", reason: "dismissed" };
  return { kind: "wizard", step: state.setupStep };
}

/** The console key after a PATCH { section: "console" } (the server stamps the dates). */
export function nextConsole(
  current: unknown,
  patch: { setupStep?: number; complete?: true; dismiss?: true },
  now: Date = new Date(),
): { console: Record<string, unknown>; setupCompleted?: true } {
  const c = current && typeof current === "object" && !Array.isArray(current) ? { ...(current as Record<string, unknown>) } : {};
  if (patch.setupStep !== undefined) c.setupStep = Math.min(4, Math.max(1, Math.round(patch.setupStep)));
  if (patch.complete) c.setupCompletedAt = typeof c.setupCompletedAt === "string" ? c.setupCompletedAt : now.toISOString();
  if (patch.dismiss) c.setupDismissedAt = typeof c.setupDismissedAt === "string" ? c.setupDismissedAt : now.toISOString();
  // The old boolean is mirrored on completion so every reader of it (the
  // boot payload, the staff console's analytics) agrees without a backfill.
  return patch.complete ? { console: c, setupCompleted: true } : { console: c };
}
