// What a teammate does, as fingerprints, for work that runs as one person
// with nobody watching: an automation's AI teammate step and a routine.
// Someone other than that person (an Owner or Admin, for a workspace
// teammate) may change the teammate, so such work keeps the teammate's
// fingerprint from when its person last chose it, and does not run once the
// teammate changed (review rounds 9 and 10: an Admin could rewrite a
// workspace teammate to read what another person's automation or routine
// reaches). Its on or off state is not part of it.

import { createHash } from "node:crypto";
import { stableJson } from "@/lib/automation/definition";

/** The parts of a teammate a fingerprint covers. */
export interface PrintedTeammate {
  name: string;
  description: string | null;
  systemPrompt: string | null;
  toolNames: unknown;
  approvalRules: unknown;
  modelOverride: string | null;
  productSlug: string | null;
}

/** Each part a person may be told changed, by its key, in the words they read. */
export const PRINT_FIELDS = ["name", "job", "instructions", "tools", "rules", "model"] as const;
export type PrintField = (typeof PRINT_FIELDS)[number];

function hash(v: unknown): string {
  return createHash("sha256").update(stableJson(v)).digest("hex").slice(0, 32);
}

/** One fingerprint per part, so what changed can be said. */
export function teammateFieldPrints(a: PrintedTeammate): Record<PrintField, string> {
  return {
    name: hash(a.name),
    job: hash(a.description ?? ""),
    instructions: hash(a.systemPrompt ?? ""),
    tools: hash(a.toolNames ?? null),
    rules: hash(a.approvalRules ?? null),
    model: hash([a.modelOverride ?? "", a.productSlug ?? ""]),
  };
}

/**
 * The whole teammate, as one fingerprint. Worked out as round 9 did, so a
 * version published since then still matches its unchanged teammate.
 */
export function teammateFingerprint(a: PrintedTeammate): string {
  return hash([a.name, a.description ?? "", a.systemPrompt ?? "", a.toolNames ?? null, a.approvalRules ?? null, a.modelOverride ?? "", a.productSlug ?? ""]);
}

/** The parts that differ between a kept set of part prints and the teammate now. */
export function changedFields(kept: unknown, now: PrintedTeammate): PrintField[] {
  if (!kept || typeof kept !== "object") return [];
  const was = kept as Record<string, unknown>;
  const current = teammateFieldPrints(now);
  return PRINT_FIELDS.filter((f) => typeof was[f] === "string" && was[f] !== current[f]);
}

/**
 * The teammate as a person was shown it, as one token their page sends back
 * when they allow it (the Connections card, review of step 2): its part prints
 * in PRINT_FIELDS order, joined by dots. Built from teammateFieldPrints, so
 * it says nothing beyond what that person may already read of the teammate.
 */
export function teammateShownPrint(a: PrintedTeammate): string {
  const p = teammateFieldPrints(a);
  return PRINT_FIELDS.map((f) => p[f]).join(".");
}

/**
 * The parts that differ between what the person was shown (a
 * teammateShownPrint token) and the teammate now. A token that is not one
 * names every part: nothing can be said to be unchanged.
 */
export function changedSinceShown(shown: string, now: PrintedTeammate): PrintField[] {
  const parts = typeof shown === "string" ? shown.split(".") : [];
  if (parts.length !== PRINT_FIELDS.length || parts.some((p) => !/^[0-9a-f]{32}$/.test(p))) return [...PRINT_FIELDS];
  const current = teammateFieldPrints(now);
  return PRINT_FIELDS.filter((f, i) => parts[i] !== current[f]);
}

/** Whether someone other than this person may change the teammate: a workspace one, or anyone else's. */
export function othersMayChange(agent: { visibility: string; ownerId: string | null }, personId: string): boolean {
  return agent.visibility !== "PRIVATE" || agent.ownerId !== personId;
}
