// The backup codes .txt download (spec-account-auth, the enrolment and Backup codes dialogs).

/** The .txt the Download button saves (pure; tested). */
export function backupCodesText(codes: readonly string[], who: string, when: Date = new Date()): string {
  return [
    "WorkwrK backup codes",
    who ? `For ${who}` : "",
    `Created ${when.toISOString().slice(0, 10)}`,
    "",
    "Each code works once. Keep them somewhere safe.",
    "",
    ...codes,
    "",
  ]
    .filter((l, i, a) => !(l === "" && a[i - 1] === ""))
    .join("\n");
}
