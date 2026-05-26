"use client";

import { useState } from "react";
import { X, Sparkles, ArrowUp, Calendar, FileText, MessageSquare, Lightbulb } from "lucide-react";
import { useOsShell } from "./shell-context";

type Agent = { id: string; name: string; av: string; color: string };

const AGENTS: Agent[] = [
  { id: "sk",    name: "Sidekick", av: "S", color: "linear-gradient(135deg, var(--os-c-pink), var(--os-c-purple))" },
  { id: "ria",   name: "Ria",      av: "R", color: "var(--os-c-orange)" },
  { id: "priya", name: "Priya",    av: "P", color: "var(--os-c-purple)" },
  { id: "maya",  name: "Maya",     av: "M", color: "var(--os-c-green)" },
  { id: "aman",  name: "Aman",     av: "A", color: "var(--os-c-blue)" },
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
        <div className="os-sk__logo">
          <Sparkles />
        </div>
        <div>
          <div className="os-sk__title">Sidekick</div>
          <div className="os-sk__sub">Online · context: this page</div>
        </div>
        <button type="button" className="os-sk__close" onClick={closeSidekick} aria-label="Close Sidekick">
          <X />
        </button>
      </div>

      <div className="os-sk__body">
        <div className="os-sk__msg os-sk__msg--user">
          What's the latest on the Acme renewal?
        </div>

        <div className="os-sk__msg os-sk__msg--ai">
          <p>
            <strong>Acme Corp</strong> renewal is at <strong>$8.5K MRR</strong>, contract expires
            in <strong>23 days</strong>. Last touch was a discovery call 6 days ago.
          </p>
          <p>I see two related items in your boards:</p>

          <button type="button" className="os-sk__pulse-card">
            <span className="os-sk__pulse-stripe" style={{ background: "var(--os-c-orange)" }} />
            <span className="os-sk__pulse-name">Send Acme renewal proposal</span>
            <span className="os-sk__pulse-meta">Sprint Q3 · due Fri</span>
          </button>

          <button type="button" className="os-sk__pulse-card">
            <span className="os-sk__pulse-stripe" style={{ background: "var(--os-c-purple)" }} />
            <span className="os-sk__pulse-name">Acme — Q3 expansion</span>
            <span className="os-sk__pulse-meta">Pipeline · review stage</span>
          </button>

          <p>I've drafted a 4-paragraph reply. Want to review it or schedule a follow-up call?</p>

          <div className="os-sk__actions">
            <button type="button" className="os-sk__action os-sk__action--primary">
              <FileText style={{ width: 12, height: 12, marginRight: 4 }} />
              Open draft
            </button>
            <button type="button" className="os-sk__action">
              <Calendar style={{ width: 12, height: 12, marginRight: 4 }} />
              Book call
            </button>
            <button type="button" className="os-sk__action">Pin to today</button>
          </div>
        </div>
      </div>

      <div className="os-sk__suggestions">
        <div className="os-sk__sugg-title">Try asking</div>
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" className="os-sk__sugg" onClick={() => setInput(s)}>
            <Lightbulb />
            <span>{s}</span>
          </button>
        ))}
      </div>

      <div className="os-sk__input-wrap">
        <div className="os-sk__agents">
          {AGENTS.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`os-sk__agent ${active === a.id ? "is-on" : ""}`}
              onClick={() => setActive(a.id)}
            >
              <span className="os-sk__agent-dot" style={{ background: a.color }}>{a.av}</span>
              <span>{a.name}</span>
            </button>
          ))}
        </div>
        <div className="os-sk__input">
          <input
            type="text"
            placeholder="Ask Sidekick or @mention an agent…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button type="button" className="os-sk__input-send" aria-label="Send">
            <ArrowUp />
          </button>
        </div>
        <div className="os-sk__input-kbd">
          <kbd>⏎</kbd> send · <kbd>⇧⏎</kbd> newline · <kbd>⌘J</kbd> toggle
        </div>
      </div>
    </aside>
  );
}
