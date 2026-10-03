// The one request shape for an automation definition, shared by create,
// save and duplicate, so a key one route accepts is never silently stripped
// by another (the zod object used to drop `scope`).

import { z } from "zod";
import { scopeForSave } from "./definition";

const whenSchema = z
  .object({
    field: z.string().trim().max(100).optional(),
    dateField: z.enum(["dueAt", "startAt"]).optional(),
    offsetDays: z.number().int().min(-30).max(30).optional(),
    every: z.enum(["day", "weekday", "week", "month"]).optional(),
    at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Pick a time").optional(),
    weekday: z.number().int().min(0).max(6).optional(),
    monthDay: z.number().int().min(1).max(28).optional(),
  })
  .strict();

export const definitionSchema = z.object({
  conditions: z.unknown().optional(),
  actions: z.array(z.record(z.string(), z.unknown())).max(25, "An automation can have at most 25 actions").optional(),
  trigger: z.string().trim().min(1).max(200).nullable().optional(),
  when: whenSchema.optional(),
  scope: z.unknown().optional(),
  /**
   * The editor's choice, stated: true for Everywhere, false for "only in the
   * chosen places" (the places they cannot open are then kept on the
   * server). Never stored; missing means an older client, see
   * restoreHiddenScope.
   */
  everywhere: z.boolean().optional(),
});

export type DefinitionInput = z.infer<typeof definitionSchema>;

/** The JSON to store: Everywhere drops the scope key, an empty `when` drops too. */
export function definitionForSave(d: DefinitionInput): Record<string, unknown> {
  const out: Record<string, unknown> = {
    conditions: d.conditions ?? null,
    actions: d.actions ?? [],
  };
  if (d.trigger !== undefined) out.trigger = d.trigger;
  if (d.when && Object.keys(d.when).length > 0) out.when = d.when;
  const scope = scopeForSave(d.scope);
  if (scope) out.scope = scope;
  return out;
}
