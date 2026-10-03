// A short fingerprint of what the builder edits (the name, the description,
// the alert level and the draft definition), so a save can tell that someone
// else saved the automation after the editor opened it (PUT answers 409 and
// the builder asks before saving over theirs). Not updatedAt: every run
// stamps lastRunAt on the row, which would make every busy automation look
// changed. The definition is hashed whole, hidden places included, and only
// the hash leaves the server. Server only (node:crypto).

import { createHash } from "node:crypto";
import { stableJson } from "./definition";

export function draftRevision(row: { name: string; description: string | null; severity: string; definition: unknown }): string {
  return createHash("sha256")
    .update(stableJson([row.name, row.description ?? null, row.severity, row.definition ?? null]))
    .digest("base64url")
    .slice(0, 22);
}
