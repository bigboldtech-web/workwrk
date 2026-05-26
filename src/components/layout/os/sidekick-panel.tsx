"use client";

import { useState } from "react";
import { X, Sparkles, Paperclip, Mic, ArrowUp, FileText, CheckCircle2, Calendar } from "lucide-react";
import { useOsShell } from "./shell-context";

type Agent = { id: string; name: string; av: string; color: string };

const AGENTS: Agent[] = [
  { id: "sk",    name: "Sidekick", av: "S",  color: "var(--os-text)" },
  { id: "ria",   name: "Ria",      av: "R",  color: "#C8451F" },
  { id: "priya", name: "Priya",    av: "P",  color: "#5A3F8F" },
  { id: "maya",  name: "Maya",     av: "M",  color: "#2E7D5B" },
  { id: "aman",  name: "Aman",     av: "A",  color: "#2F5E8B" },
];

const SUGGESTIONS = [
  "Draft Monday's all-hands agenda",
  "Summarize Acme account this week",
  "What's stalled in the pipeline?",
  "Schedule 1:1 with Sarah",
];

export function OsSidekickPanel() {
  const { sidekickOpen, closeSidekick } = useOsShell();
  const [active, setActive] = useState("sk");
  const [input, setInput] = useState("");

  return (
    <aside
      className={`os-sk ${sidekickOpen ? "is-open" : ""}`}
      aria-hidden={!sidekickOpen}
      aria-label="Sidekick AI assistant"
    >
      <div className="os-sk__head">
        <div className="os-sk__head-icon">
          <Sparkles />
        </div>
        <div>
          <div className="os-sk__head-h3">Sidekick</div>
          <div className="os-sk__head-sub">Online · context: this page</div>
        </div>
        <button type="button" className="os-sk__close" onClick={closeSidekick} aria-label="Close Sidekick">
          <X />
        </button>
      </div>

      <div className="os-sk__agent-row">
        {AGENTS.map((a) => (
          <button
            key={a.id}
            type="button"
            className={`os-sk-agent ${active === a.id ? "is-active" : ""}`}
            onClick={() => setActive(a.id)}
          >
            <span className="os-sk-agent__av" style={{ background: a.color }}>{a.av}</span>
            <span>{a.name}</span>
          </button>
        ))}
      </div>

      <div className="os-sk__body">
        <div className="os-sk-msg">
          <div className="os-sk-msg__av os-sk-msg__av--sk">S</div>
          <div className="os-sk-msg__body">
            <div className="os-sk-msg__author">
              Sidekick <small>just now</small>
            </div>
            <div className="os-sk-msg__text">
              <p>Good morning. Here's what I've prepared for you:</p>
              <p>
                <strong>3 drafts</strong> waiting on approval, <strong>2 deals</strong> stalled
                more than 14 days, and Sarah's expense report ($4,200) needs your call.
              </p>
            </div>
            <div className="os-sk-actions">
              <button type="button" className="os-sk-action">
                <FileText /> Open drafts
              </button>
              <button type="button" className="os-sk-action">
                <CheckCircle2 /> Approve all safe
              </button>
              <button type="button" className="os-sk-action">
                <Calendar /> Plan my day
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="os-sk__suggest">
        <div className="os-sk-suggest-title">Try asking</div>
        <div className="os-sk-suggest-grid">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" className="os-sk-suggest" onClick={() => setInput(s)}>
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="os-sk__input">
        <div className="os-sk__input-box">
          <button type="button" className="os-sk__input-attach" aria-label="Attach file">
            <Paperclip />
          </button>
          <input
            type="text"
            placeholder="Ask Sidekick or @mention an agent…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button type="button" className="os-sk__input-attach" aria-label="Voice">
            <Mic />
          </button>
          <button type="button" className="os-sk__send" aria-label="Send">
            <ArrowUp />
          </button>
        </div>
        <div className="os-sk__input-foot">
          <kbd>⏎</kbd> send
          <kbd>⇧⏎</kbd> newline
          <span style={{ marginLeft: "auto" }}>Context: this page</span>
        </div>
      </div>
    </aside>
  );
}
