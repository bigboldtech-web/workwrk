import { describe, expect, it } from "vitest";
import { agentChatHref, allChatsHref, sidekickIntent } from "./url-state";

const p = (qs: string) => new URLSearchParams(qs);

describe("sidekickIntent", () => {
  it("bare /sidekick is the landing", () => {
    expect(sidekickIntent(p(""))).toEqual({ kind: "landing" });
    expect(sidekickIntent(null)).toEqual({ kind: "landing" });
  });

  it("?view=all, ?pinned=1 and ?archived=1 are the All chats tabs", () => {
    expect(sidekickIntent(p("view=all"))).toEqual({ kind: "all", tab: "all" });
    expect(sidekickIntent(p("pinned=1"))).toEqual({ kind: "all", tab: "pinned" });
    expect(sidekickIntent(p("view=all&pinned=1"))).toEqual({ kind: "all", tab: "pinned" });
    expect(sidekickIntent(p("view=all&archived=1"))).toEqual({ kind: "all", tab: "archived" });
    // Archived wins over pinned when both are present.
    expect(sidekickIntent(p("pinned=1&archived=1"))).toEqual({ kind: "all", tab: "archived" });
  });

  it("?session=<id> opens that chat", () => {
    expect(sidekickIntent(p("session=cmufmi5hd0003"))).toEqual({ kind: "session", id: "cmufmi5hd0003" });
  });

  it("a malformed session id falls through to the landing", () => {
    expect(sidekickIntent(p("session=../../etc"))).toEqual({ kind: "landing" });
  });

  it("?q= sends at once, carrying an agent when there is one", () => {
    expect(sidekickIntent(p("q=%20What%20is%20due%3F%20"))).toEqual({ kind: "ask", q: "What is due?", agent: null });
    expect(sidekickIntent(p("q=hi&agent=priya-hr"))).toEqual({ kind: "ask", q: "hi", agent: "priya-hr" });
  });

  it("?new=1 and ?agent= are a fresh landing", () => {
    expect(sidekickIntent(p("new=1"))).toEqual({ kind: "new", agent: null });
    expect(sidekickIntent(p("agent=priya-hr&new=1"))).toEqual({ kind: "new", agent: "priya-hr" });
    expect(sidekickIntent(p("agent=priya-hr"))).toEqual({ kind: "new", agent: "priya-hr" });
  });

  it("an agent slug that is not a slug is ignored", () => {
    expect(sidekickIntent(p("agent=%3Cscript%3E&new=1"))).toEqual({ kind: "new", agent: null });
  });

  it("a blank ?q= is not a question", () => {
    expect(sidekickIntent(p("q=%20%20"))).toEqual({ kind: "landing" });
  });

  it("caps a very long ?q=", () => {
    const i = sidekickIntent(p(`q=${"a".repeat(5000)}`));
    expect(i.kind === "ask" && i.q.length).toBe(4000);
  });
});

describe("hrefs", () => {
  it("writes the All chats tabs", () => {
    expect(allChatsHref("all")).toBe("/sidekick?view=all");
    expect(allChatsHref("pinned")).toBe("/sidekick?view=all&pinned=1");
    expect(allChatsHref("archived")).toBe("/sidekick?view=all&archived=1");
  });
  it("writes an agent chat", () => {
    expect(agentChatHref("priya-hr")).toBe("/sidekick?agent=priya-hr");
  });
});
