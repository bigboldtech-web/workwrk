// A scripted stand-in for the Anthropic Messages API, for the AI teammates
// live proof (scripts/live-proof-ai-teammates-phase2.ts) on a LOCAL dev
// server only: start next dev with ANTHROPIC_API_KEY set to anything and
// ANTHROPIC_BASE_URL pointing here. It answers POST /v1/messages, streamed
// (SSE) or not, in the API's format: a phrase in the latest person message
// picks a scripted tool call; once the tool result comes back (or
// tool_choice is "none") it answers in text. It never calls the real API.
// Every request is appended to STAND_IN_LOG (default: the system temp
// folder), so a proof can check what the app sent.
//
// Usage: node scripts/ai-stand-in-model.mjs [port]   (default 8787)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const PORT = Number(process.argv[2] || 8787);
const LOG = process.env.STAND_IN_LOG || path.join(os.tmpdir(), "ai-stand-in-requests.jsonl");

// Phrase in the person's latest message -> the tool call it scripts.
const SCRIPTS = [
  { when: /^ask (?:my )?(.+?) (which .+|what .+|to .+)$/i, tool: "ask_teammate", input: (m) => ({ teammate: m[1], request: m[2] }) },
  { when: /invite ([\w.+-]+@[\w.-]+)/i, tool: "invite_person_with_role", input: (m) => ({ email: m[1] }) },
  { when: /make a task for ([\w.+-]+@[\w.-]+)/i, tool: "create_task", input: (m) => ({ title: "Review the plan", assigneeEmail: m[1] }) },
  { when: /make a task/i, tool: "create_task", input: { title: "Call Acme", dueDate: "tomorrow" } },
  { when: /post '([^']+)' in (#[\w-]+)/i, tool: "post_in_talk", input: (m) => ({ channel: m[2], text: m[1] }) },
  { when: /comment '([^']+)' on '([^']+)'/i, tool: "comment_on_task", input: (m) => ({ taskTitle: m[2], text: m[1] }) },
  { when: /remember (.+)/i, tool: "remember", input: (m) => ({ key: "preference", value: m[1].replace(/[.!]$/, "") }) },
  { when: /every weekday at 9:00 (.+)/i, tool: "create_routine", input: (m) => ({ name: "Morning summary", instructions: m[1], schedule: { kind: "weekdays", time: "09:00" } }) },
  { when: /what is due/i, tool: "search_tasks", input: { query: "", dueBefore: "this week" } },
];

function lastPersonText(messages) {
  // The person's own words: the newest user text that is not a server line
  // ([WorkwrK] ..., as a group turn ends with), unless the turn is tool results.
  const last = messages[messages.length - 1];
  if (last && last.role === "user" && Array.isArray(last.content) && last.content.some((b) => b.type === "tool_result")) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    const all = typeof m.content === "string" ? [m.content] : (m.content || []).filter((b) => b.type === "text").map((b) => b.text);
    // A delegated turn: the asking teammate's request is the words to act on.
    const asked = all.map((t) => /<teammate_request>\n([\s\S]*?)\n<\/teammate_request>/.exec(t)).find(Boolean);
    if (asked) return asked[1];
    // A continue (or a routine) is its own instruction: no script replays.
    if (all.some((t) => t.startsWith("[WorkwrK] Continue") || t.startsWith("[WorkwrK] It's time"))) return all.join("\n");
    // A group turn's own line says whose turn it is; the person's words are above it.
    const texts = all.filter((t) => !t.startsWith("[WorkwrK]"));
    if (texts.length) return texts.join("\n");
  }
  return "";
}

function endsWithToolResults(messages) {
  const m = messages[messages.length - 1];
  return m && m.role === "user" && Array.isArray(m.content) && m.content.some((b) => b.type === "tool_result");
}

let seq = 0;
function plan(body) {
  const messages = body.messages || [];
  const noTools = !body.tools || body.tools.length === 0 || body.tool_choice?.type === "none";
  if (endsWithToolResults(messages) || noTools) {
    const results = endsWithToolResults(messages) ? messages[messages.length - 1].content.filter((b) => b.type === "tool_result") : [];
    const waiting = results.some((r) => JSON.stringify(r.content).includes("waiting_for_approval"));
    const practice = results.some((r) => JSON.stringify(r.content).includes('\\"practice\\":true') || JSON.stringify(r.content).includes('"practice":true'));
    const text = waiting
      ? "I asked for your approval before doing that."
      : practice
        ? "This was a practice run, so nothing changed."
        : results.length
          ? "Done."
          : "Here is what I found.";
    return { content: [{ type: "text", text }], stop: "end_turn" };
  }
  const said = lastPersonText(messages) || "";
  const names = new Set((body.tools || []).map((t) => t.name));
  for (const s of SCRIPTS) {
    const m = said.match(s.when);
    if (m && names.has(s.tool)) {
      const input = typeof s.input === "function" ? s.input(m) : s.input;
      seq += 1;
      return { content: [{ type: "text", text: "On it." }, { type: "tool_use", id: `toolu_fake_${seq}`, name: s.tool, input }], stop: "tool_use" };
    }
  }
  return { content: [{ type: "text", text: "Here is what I found." }], stop: "end_turn" };
}

function message(body, p) {
  return {
    id: `msg_fake_${Date.now()}`,
    type: "message",
    role: "assistant",
    model: body.model || "claude-fake",
    content: p.content,
    stop_reason: p.stop,
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20 },
  };
}

function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function stream(res, body, p) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  const msg = message(body, p);
  sse(res, "message_start", { type: "message_start", message: { ...msg, content: [], stop_reason: null, usage: { input_tokens: 100, output_tokens: 1 } } });
  p.content.forEach((block, index) => {
    if (block.type === "text") {
      sse(res, "content_block_start", { type: "content_block_start", index, content_block: { type: "text", text: "" } });
      sse(res, "content_block_delta", { type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } });
    } else {
      sse(res, "content_block_start", { type: "content_block_start", index, content_block: { type: "tool_use", id: block.id, name: block.name, input: {} } });
      sse(res, "content_block_delta", { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) } });
    }
    sse(res, "content_block_stop", { type: "content_block_stop", index });
  });
  sse(res, "message_delta", { type: "message_delta", delta: { stop_reason: p.stop, stop_sequence: null }, usage: { output_tokens: 20 } });
  sse(res, "message_stop", { type: "message_stop" });
  res.end();
}

http
  .createServer((req, res) => {
    if (req.method !== "POST" || !req.url.startsWith("/v1/messages")) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ type: "error", error: { type: "not_found_error", message: "fake: only POST /v1/messages" } }));
      return;
    }
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "bad json" } }));
        return;
      }
      fs.appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), stream: !!body.stream, model: body.model, tool_choice: body.tool_choice ?? null, tools: (body.tools || []).map((t) => t.name), system: body.system, messages: body.messages }) + "\n");
      if (/does-not-exist/.test(String(body.model))) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ type: "error", error: { type: "not_found_error", message: `model: ${body.model}` } }));
        return;
      }
      const p = plan(body);
      if (body.stream) stream(res, body, p);
      else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(message(body, p)));
      }
    });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`fake anthropic on http://127.0.0.1:${PORT}`));
