// The skill tool an AI teammate may be given (docs/plans/ai-teammates-phase5.md):
// use_skill loads one of the person's skills, a job they showed the teammate
// once, as information before it follows it. teammate-tools.ts spreads it
// into TEAMMATE_TOOLS, and so into the registry (tools.ts REGISTRY), beside
// the browser tools.
//
// OFFERED ONLY WHERE THE BROWSER IS, AND ONLY WHILE SKILLS ARE AVAILABLE
// (Decisions 1, 2, 4 and 27): in the person's own one-teammate CHAT or
// RESUME (tool-policy.ts BROWSER_TOOLS holds it with the browser tools, so
// toolsForTrigger removes it wherever it removes them), and only when the
// computer is available, this deployment offers skills and the workspace's
// switch is on (engine.ts prepareTurn passes `skills` to teammateToolNames
// from the same workspaceComputer answer the computer reads, step 4).
//
// use_skill, IN ORDER (step 4): a teammate's call; its input; the person a
// moment ago; the teammate now (on, in this workspace, holding the browser
// and use_skill); skills available here now (recorder.ts skillsAccess, each
// refusal its own sentence); then:
//   - One skill an answer (said first: the first one tainted the answer).
//   - A TAINTED TURN STARTS ONLY THE SKILL THE PERSON'S OWN MESSAGE CARRIES
//     (Decision 15): after a page, an email or a calendar was read in this
//     answer, a planted page never picks which skill runs. The turn's
//     `skillAsked` is the skill id of the person's message that started it
//     (meta.skillRun, which only the messages route writes, after it checked
//     the skill is theirs and ready); none, and nothing is even read.
//   - The skill by the person, the teammate and its name (case aside): none,
//     or a draft or a recording, each its own sentence.
//   - Its sites as the rules are now (Decision 12): a step on a host the
//     teammate may not open now refuses, naming it, and nothing is pinned.
//   - The session: a browser of this person and teammate already live is
//     pinned to the skill at its version, under the browser's lock, and the
//     start address becomes one of the session's shown links (so open_page
//     opens it after a read, Decision 17); with none, the turn keeps the
//     skill, and open_page of its start pins it on the browser it starts.
//   - The turn follows the skill (onSkill) and has read the web (onWebRead):
//     the skill's names came from pages, so every later write asks first.
// The answer is the skill's steps as data (steps.ts skillDataLines, inside
// <tool_data>, Decision 16), its start address and a note that the page as
// it is now decides. The executor records the call as `{}` and its result
// as `{ ok, steps }` only, writes the chat line and counts the run (never in
// practice).
//
// It runs nothing on a page, and reads no page.
//
// No runtime import that reads a database at load: what the handler needs
// loads on first use, as browser-tools.ts does.

import { z } from "zod";
import type { ComputerAgent } from "./browser-access";
import { browserRefusalSentence } from "./browser-rules";
import { badInput, goneAnswer } from "./browser-tools";
import { BROWSER_COPY, SKILL_COPY, SKILL_ROUTE_ERRORS, TEAMMATE_TOOL_ERRORS as ERR } from "./teammate-copy";
import type { Refusal } from "./teammate-tools";
import type { SkillToolName } from "./tool-names";
import type { ToolContext, ToolDefinition } from "./tools";
import { plainData } from "./plain-data";
import type { SkillsRefusal } from "@/lib/skills/recorder";

const useSkillInput = z.object({ skill: z.string().trim().min(1).max(80) });

/** Each skill tool's input, as zod reads it (the model's input). */
export const SKILL_INPUT = {
  use_skill: useSkillInput,
} as const satisfies Record<SkillToolName, z.ZodType>;

// ── Loaded on first use ─────────────────────────────────────────────

const acting = () => import("./acting");
const browserAccess = () => import("./browser-access");
const sessions = () => import("@/lib/browser/sessions");
const live = () => import("@/lib/browser/live");
const config = () => import("@/lib/browser/config");
const sites = () => import("@/lib/browser/sites");
const rules = () => import("./browser-rules");
const recorder = () => import("@/lib/skills/recorder");
const store = () => import("@/lib/skills/store");
const follow = () => import("@/lib/skills/follow");
const steps = () => import("@/lib/skills/steps");

function refused(error: string): Refusal {
  return { error };
}

/**
 * The key a refusal that names a skill keeps its name-free sentence under
 * (review of Phase 5 step 4): the model reads the whole sentence once, inside
 * <tool_data>, and the executor stores only this one (executor.ts
 * skillLoaded), so a later turn's line of what its calls did never carries a
 * skill's name outside a data block.
 */
export const SKILL_RECORD_ERROR = "recordError";

function refusedNaming(error: string, recordError: string): Refusal {
  return { error, [SKILL_RECORD_ERROR]: recordError };
}

/** How long use_skill waits for a step in flight on the same browser (the browser tools' own wait). */
const LOCK_WAIT_MS = 20_000;

/** The person's first name inside the server's own lines: its first word of letters, at most 40 (engine.ts firstNameWord's rule). */
function firstWord(s: string): string {
  const m = /^[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)?/u.exec(plainData(String(s ?? "")).trim());
  return m ? Array.from(m[0]).slice(0, 40).join("") : "the person";
}

/** Why skills can't be used here now, as the model reads it (Decision 28: its real reason). */
function skillsSentence(reason: SkillsRefusal, agent: ComputerAgent, first: string): string {
  if (reason === "not_offered" || reason === "skills_off") return SKILL_COPY.skillsOff;
  if (reason === "cant_learn") return SKILL_ROUTE_ERRORS.cantLearn(agent.name);
  return browserRefusalSentence(reason, agent.name, first);
}

/** use_skill (see the file header). */
async function useSkillRun(ctx: ToolContext, raw: Record<string, unknown>): Promise<unknown> {
  const t = ctx.teammate;
  if (!t) return refused(ERR.teammateOnly);
  const parsed = SKILL_INPUT.use_skill.safeParse(raw);
  if (!parsed.success) return badInput(parsed.error);
  // Only where the browser runs (Decision 21; toolsForTrigger offers it nowhere else), with the
  // browser context the executor hands a skill call.
  const b = t.browser;
  if ((t.trigger !== "CHAT" && t.trigger !== "RESUME") || !b || typeof b.onSkill !== "function") return refused(ERR.notAllowed);
  const person = await (await acting()).actingPersonFor(ctx);
  if (!person) return refused(ERR.personCant);
  const agent = await (await browserAccess()).computerAgentById(ctx.orgId, t.agentId);
  if (!agent || !agent.browserTools) return refused(BROWSER_COPY.teammateOff);
  const learn = await (await recorder()).skillsAccess({ organizationId: ctx.orgId, agent });
  if (!learn.ok) return refused(skillsSentence(learn.reason, agent, person.firstName));
  // One skill an answer: said first, since the first one tainted the answer.
  if ((b.skillStarts ?? 0) >= 1) return refused(SKILL_COPY.skillOneAnswer);
  // Why a tainted turn starts no skill but the asked one, truly (review of
  // step 4): this answer read something, or it only started tainted (after a
  // browser card, say), when nothing was read in it.
  const afterRead = b.readHere === true ? SKILL_COPY.skillAfterRead : SKILL_COPY.skillAfterStart;
  // A tainted turn: only the skill the person's own message carries (see the header). None: nothing is read.
  if (b.tainted === true && !b.skillAsked) return refused(afterRead);

  const { normName, sitesNotAllowed, skillDataLines } = await steps();
  const wanted = normName(parsed.data.skill);
  const rows = await (await store()).skillsOfViewer({ userId: person.userId, organizationId: person.organizationId }, agent.id);
  const row = rows.find((r) => normName(r.name) === wanted) ?? null;
  // A planted page never learns which skills the person has, and never starts one: in a tainted turn only the asked one answers.
  if (b.tainted === true && (!row || row.id !== b.skillAsked)) return refused(afterRead);
  const who = person.firstName || "The person";
  // The name only in what the model reads now, never in the call's record (review of step 4).
  if (!row) return refusedNaming(SKILL_COPY.skillNotFound(who, parsed.data.skill), SKILL_COPY.skillNotFoundStored(who));
  const skill = (await follow()).followedFrom(row);
  if (!skill) return refusedNaming(SKILL_COPY.skillDraft(who, row.name), SKILL_COPY.skillDraftStored(who));

  // Its sites as the rules are now (Decision 12), by the guard's own verdict over each host's home.
  const { siteHomeAddress } = await config();
  const { siteVerdict } = await sites();
  const off = sitesNotAllowed(skill.steps, (host) => siteVerdict(siteHomeAddress(host, learn.access.cfg), learn.access.rules).ok);
  if (off.length > 0) return refused(SKILL_COPY.skillSiteOff(off.join(", ")));

  // The browser of this person and teammate, when one is open: pinned under its lock.
  const s = await sessions();
  const mayOpen = b.tainted !== true && b.mayStart === true;
  const continues = Array.isArray(b.continues) && b.continues.length > 0 ? { continues: b.continues } : {};
  const use = await s.useBrowserSession({ person, agentId: agent.id, runId: t.runId ?? null, ...continues, purpose: "model" });
  if (use.ok) {
    const rowId = use.row.id;
    const { pageKey } = await rules();
    const l = await live();
    const pinned = await l.withBrowserLock(rowId, LOCK_WAIT_MS, async (lb) => {
      if (lb.handedOver === true) return "person" as const;
      if (!(await s.setSessionSkill(rowId, skill.id, skill.version))) return "closed" as const;
      // Its start is one of the session's shown links from now on (Decision 17), as any link a read showed.
      l.rememberLinks(lb, [pageKey(skill.startUrl)]);
      return "pinned" as const;
    });
    if (pinned === "person") return refused(BROWSER_COPY.personHasIt(person.firstName || "The person"));
    if (typeof pinned === "object" && "busy" in pinned) return refused(BROWSER_COPY.busyNow);
    if (typeof pinned === "object" && "gone" in pinned) return refused((await goneAnswer(rowId, { mayOpen, first: person.firstName })).error);
    // "closed": the browser ended a moment ago, so the turn keeps the skill for its start, as with none.
  } else if (!["none", "ended", "restarted", "time_cap"].includes(use.reason)) {
    return refused(browserRefusalSentence(use.reason, agent.name, person.firstName, { otherName: use.otherName, minutes: use.minutes, mayOpen }));
  }

  const { pinOf } = await follow();
  b.onSkill(pinOf(skill));
  // The skill's names came from pages: from here the turn has read the web (Decision 15).
  b.onWebRead();
  return {
    skill: { name: skill.name, whatItIsFor: skill.description, steps: skillDataLines(skill.steps, firstWord(person.firstName)) },
    startAddress: skill.startUrl,
    note: SKILL_COPY.skillNote,
  };
}

// ── The definition (description exact, docs/plans/ai-teammates-phase5.md step 1) ──

const useSkill: ToolDefinition = {
  name: "use_skill",
  description:
    "Load one of the person's skills, by its name, before you follow it: the steps they showed you once, as information. Only when the person asked for it in their own message, before you read anything in this answer, or when they pressed Run on it. It runs nothing: you still read every page, and every click, word and choice waits for their approval. Its start page is the one address you may open after reading.",
  input_schema: {
    type: "object",
    properties: {
      skill: { type: "string", description: "The skill's name, as the person calls it, up to 80 characters" },
    },
    required: ["skill"],
  },
  handler: useSkillRun,
};

/** The skill tool, by name (teammate-tools.ts spreads it into TEAMMATE_TOOLS). */
export const SKILL_TOOLS_DEFS = {
  use_skill: useSkill,
} satisfies Record<SkillToolName, ToolDefinition>;
