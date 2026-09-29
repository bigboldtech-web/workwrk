// The presence dot (spec-teams-people section 1 "Presence dots"): one
// reader for User.presenceStatus / presenceUntil. It returns null when the
// column or the value is absent, or when the status has expired, and a
// caller that gets null draws NO dot at all (no grey placeholder), so a row
// never reflows when the value appears.
//
// Pure: no imports. Client safe.

export interface PresenceDot {
  label: string;
  tone: "online" | "busy" | "away";
}

export function presenceDot(
  status: string | null | undefined,
  until: string | Date | null | undefined,
  now: Date = new Date(),
): PresenceDot | null {
  if (!status || typeof status !== "string") return null;
  const text = status.trim();
  if (!text) return null;
  if (until) {
    const t = until instanceof Date ? until.getTime() : Date.parse(until);
    if (Number.isFinite(t) && t <= now.getTime()) return null;
  }
  const lower = text.toLowerCase();
  if (lower === "online" || lower === "active") return { label: "Active", tone: "online" };
  if (lower.includes("disturb") || lower === "dnd" || lower.includes("meeting") || lower.includes("busy")) {
    return { label: text, tone: "busy" };
  }
  return { label: text, tone: "away" };
}
