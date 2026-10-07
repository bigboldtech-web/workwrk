// A group stop whose stream broke before the saved message arrived
// (teammate-store.ts groupStopAnswered; review round 1): it ends when that
// message's answerers have answered, found by its words and time, and a
// message's answers are never read as a continue's.

import { describe, expect, it } from "vitest";
import { groupStopAnswered, type StoppedTurn } from "./teammate-store";
import type { TeammateMessageView } from "./teammate-thread";

const SENT = Date.parse("2026-10-07T10:00:00Z");
const user = (id: string, text: string, at: string, answerers: string[]): TeammateMessageView =>
  ({ id, kind: "user", text, createdAt: at, practice: false, answerers }) as TeammateMessageView;
const answer = (id: string, agentId: string, replyTo: string): TeammateMessageView =>
  ({ id, kind: "agent", text: "Done.", createdAt: "2026-10-07T10:00:30Z", practice: false, toolCalls: [], agentId, replyTo }) as TeammateMessageView;

const STOP: StoppedTurn = { questionId: null, liveId: "tmp-live", known: new Set(["old"]), text: "@Triage @PM what is late?", startedAt: SENT, expect: [], liveAgentId: null, continued: false };

describe("groupStopAnswered when the saved message never arrived", () => {
  it("waits for every answerer of the message with these words, then ends", () => {
    const q = user("u2", "@Triage @PM what is late?", "2026-10-07T10:00:01Z", ["a-triage", "a-pm"]);
    expect(groupStopAnswered([q, answer("m1", "a-triage", "u2")], STOP)).toBe(false);
    expect(groupStopAnswered([q, answer("m1", "a-triage", "u2"), answer("m2", "a-pm", "u2")], STOP)).toBe(true);
  });

  it("never takes an older message with the same words", () => {
    const older = user("u1", "@Triage @PM what is late?", "2026-10-06T09:00:00Z", ["a-triage"]);
    expect(groupStopAnswered([older, answer("m0", "a-triage", "u1")], STOP)).toBe(false);
  });

  it("never reads a continue's answer as this message's", () => {
    const cont = { ...answer("m3", "a-triage", ""), replyTo: undefined, resume: true } as TeammateMessageView;
    expect(groupStopAnswered([cont], STOP)).toBe(false);
    expect(groupStopAnswered([cont], { ...STOP, text: null, continued: true })).toBe(true);
  });
});
