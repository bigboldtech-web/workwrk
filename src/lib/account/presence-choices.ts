// The Presence card's two pickers (spec-account-auth `/account/security`
// card 4): Show me as (Active, Away, Do not disturb, Custom) and Clear after
// (30 minutes, 1 hour, Today, This week, Never). Pure; tested. The shell's
// status object is the store; the avatar menu writes the same one.

export type PresenceChoice = "active" | "away" | "dnd" | "custom";
export type PresenceClearAfter = "30m" | "1h" | "today" | "week" | "never";

export const PRESENCE_CHOICES: readonly { value: PresenceChoice; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "away", label: "Away" },
  { value: "dnd", label: "Do not disturb" },
  { value: "custom", label: "Custom..." },
];

export function presenceClearAfterOptions(): { value: PresenceClearAfter; label: string }[] {
  return [
    { value: "30m", label: "30 minutes" },
    { value: "1h", label: "1 hour" },
    { value: "today", label: "Today" },
    { value: "week", label: "This week" },
    { value: "never", label: "Never" },
  ];
}

export function presenceChoiceOf(status: { label: string }): PresenceChoice {
  const l = status.label.trim().toLowerCase();
  if (!l || l === "online" || l === "active") return "active";
  if (l === "away") return "away";
  if (l === "do not disturb") return "dnd";
  return "custom";
}

/** The ISO expiry for a Clear after choice, in the browser's own day and week. */
export function presenceExpiryFor(after: PresenceClearAfter, now: Date = new Date()): string | null {
  if (after === "never") return null;
  if (after === "30m") return new Date(now.getTime() + 30 * 60_000).toISOString();
  if (after === "1h") return new Date(now.getTime() + 60 * 60_000).toISOString();
  const end = new Date(now.getTime());
  end.setHours(23, 59, 59, 0);
  if (after === "week") {
    // To the end of Sunday (the week the person is in).
    const daysToSunday = (7 - end.getDay()) % 7;
    end.setDate(end.getDate() + daysToSunday);
  }
  return end.toISOString();
}
