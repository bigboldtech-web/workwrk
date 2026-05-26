"use client";

import { useEffect, useState } from "react";
import {
  X, Maximize2, MoreHorizontal, Share2, Star, Smile, Paperclip,
  AtSign, Send, MessageCircle, History, Files, ListTree, Calendar as CalendarIcon,
  CheckSquare,
} from "lucide-react";
import { useOsShell } from "./shell-context";
import { getModule, C, PEOPLE } from "./catalog";

type DrawerTab = "updates" | "files" | "activity" | "subitems";

export function OsItemDrawer() {
  const { openItem, closeItemDrawer } = useOsShell();
  const [tab, setTab] = useState<DrawerTab>("updates");
  const [title, setTitle] = useState("");
  const [composer, setComposer] = useState("");

  useEffect(() => {
    if (openItem) setTitle(openItem.name);
  }, [openItem]);

  const mod = openItem ? getModule(openItem.moduleId) : null;

  return (
    <>
      <button
        type="button"
        className={`os-drawer-bd ${openItem ? "is-open" : ""}`}
        onClick={closeItemDrawer}
        aria-label="Close drawer"
        tabIndex={openItem ? 0 : -1}
      />
      <aside
        className={`os-drawer ${openItem ? "is-open" : ""}`}
        aria-hidden={!openItem}
      >
        {openItem && mod ? (
          <>
            <div className="os-drawer__head">
              <div className="os-drawer__head-row">
                <div className="os-drawer__crumb">
                  <span className="os-drawer__crumb-icon" style={{ background: mod.gradient }}>
                    <mod.Icon />
                  </span>
                  <span>{mod.name}</span>
                  <span className="os-drawer__crumb-sep">/</span>
                  <span style={{ fontFamily: "var(--os-font)" }}>{openItem.itemId}</span>
                </div>
                <div className="os-drawer__head-actions">
                  <button type="button" className="os-drawer__icon-btn" aria-label="Pin">
                    <Star />
                  </button>
                  <button type="button" className="os-drawer__icon-btn" aria-label="Share">
                    <Share2 />
                  </button>
                  <button type="button" className="os-drawer__icon-btn" aria-label="Expand">
                    <Maximize2 />
                  </button>
                  <button type="button" className="os-drawer__icon-btn" aria-label="More options">
                    <MoreHorizontal />
                  </button>
                  <button type="button" className="os-drawer__icon-btn" aria-label="Close" onClick={closeItemDrawer}>
                    <X />
                  </button>
                </div>
              </div>

              <div className="os-drawer__title">
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  aria-label="Item title"
                />
                <span className="os-drawer__title-status" style={{ background: openItem.groupColor ?? C.blue }}>
                  Working
                </span>
              </div>

              <div className="os-drawer__tabs" role="tablist">
                <button type="button" role="tab" className={`os-drawer__tab ${tab === "updates" ? "is-active" : ""}`} onClick={() => setTab("updates")}>
                  <MessageCircle />
                  Updates
                  <span className="os-drawer__tab-count">7</span>
                </button>
                <button type="button" role="tab" className={`os-drawer__tab ${tab === "files" ? "is-active" : ""}`} onClick={() => setTab("files")}>
                  <Files />
                  Files
                  <span className="os-drawer__tab-count">3</span>
                </button>
                <button type="button" role="tab" className={`os-drawer__tab ${tab === "activity" ? "is-active" : ""}`} onClick={() => setTab("activity")}>
                  <History />
                  Activity
                </button>
                <button type="button" role="tab" className={`os-drawer__tab ${tab === "subitems" ? "is-active" : ""}`} onClick={() => setTab("subitems")}>
                  <ListTree />
                  Sub-items
                  <span className="os-drawer__tab-count">4</span>
                </button>
              </div>
            </div>

            <div className="os-drawer__body">
              {/* Inline editable fields — same on every tab */}
              <div className="os-drawer__fields">
                <div className="os-drawer__field">
                  <span className="os-drawer__field-label">Status</span>
                  <span className="os-drawer__field-value">
                    <span className="os-drawer__field-pill" style={{ background: C.orange }}>Working on it</span>
                  </span>
                </div>
                <div className="os-drawer__field">
                  <span className="os-drawer__field-label">Priority</span>
                  <span className="os-drawer__field-value">
                    <span className="os-drawer__field-pill" style={{ background: C.red }}>High</span>
                  </span>
                </div>
                <div className="os-drawer__field">
                  <span className="os-drawer__field-label">Owner</span>
                  <span className="os-drawer__field-value">
                    <span className="os-av os-av--sm" style={{ background: PEOPLE.bb.color }}>BB</span>
                    <span className="os-av os-av--sm" style={{ background: PEOPLE.sc.color, marginLeft: -6, border: "2px solid var(--os-canvas)" }}>SC</span>
                    <span style={{ fontSize: 12, color: "var(--os-ink-2)", marginLeft: 4 }}>BigBold, Sarah</span>
                  </span>
                </div>
                <div className="os-drawer__field">
                  <span className="os-drawer__field-label">Due date</span>
                  <span className="os-drawer__field-value">
                    <CalendarIcon style={{ width: 13, height: 13, color: "var(--os-ink-3)" }} />
                    Fri, Sep 12
                  </span>
                </div>
                <div className="os-drawer__field">
                  <span className="os-drawer__field-label">Tags</span>
                  <span className="os-drawer__field-value">
                    <span className="os-drawer__field-tag" style={{ background: C.green }}>Growth</span>
                    <span className="os-drawer__field-tag" style={{ background: C.indigo }}>Q3</span>
                    <button type="button" className="os-drawer__field-add">+</button>
                  </span>
                </div>
                <div className="os-drawer__field">
                  <span className="os-drawer__field-label">Progress</span>
                  <span className="os-drawer__field-value">
                    <span style={{ width: 100, height: 6, background: "var(--os-surface-2)", borderRadius: 999, overflow: "hidden" }}>
                      <span style={{ display: "block", width: "60%", height: "100%", background: C.orange, borderRadius: 999 }} />
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--os-ink-2)" }}>60%</span>
                  </span>
                </div>
              </div>

              {tab === "updates" && (
                <>
                  <div className="os-drawer__desc">
                    Working on the second pass of the email onboarding sequence. Drafted welcome, day-2, day-5,
                    and day-14 emails. Need final copy review from Anika before sending to Customer.io.
                  </div>

                  <h3 className="os-drawer__section-title">
                    <MessageCircle />
                    Updates
                  </h3>

                  {[
                    {
                      av: "SC", color: C.green, who: "Sarah Cohen", when: "12 min ago",
                      text: <>Reviewed the welcome email — ship it. The day-5 one needs a CTA tweak though.</>,
                      reacts: ["👍 3", "🎉 1"],
                    },
                    {
                      av: "BB", color: C.purple, who: "BigBold (You)", when: "1 hr ago",
                      text: <>Moved status to <span className="os-drawer__update-chip" style={{ background: C.orange }}>Working</span> · pushed first 4 emails for review.</>,
                      reacts: [],
                    },
                    {
                      av: "AN", color: C.red, who: "Anika Nair", when: "3 hr ago",
                      text: <>Pulled the open/click rates from the last campaign. <strong>Avg open 34%, click 7.2%</strong> — we should A/B test subject lines on the welcome.</>,
                      reacts: ["💡 2"],
                    },
                    {
                      av: "MK", color: C.teal, who: "Maya Kapoor", when: "yesterday",
                      text: <>Added the new user-onboarding SOP to the related docs <em>· docs/sop-onboarding-v2</em></>,
                      reacts: [],
                    },
                  ].map((u, i) => (
                    <div key={i} className="os-drawer__update">
                      <span className="os-av os-av--md" style={{ background: u.color }}>{u.av}</span>
                      <div className="os-drawer__update-body">
                        <div className="os-drawer__update-head">
                          <span className="os-drawer__update-author">{u.who}</span>
                          <span className="os-drawer__update-time">{u.when}</span>
                        </div>
                        <div className="os-drawer__update-text">{u.text}</div>
                        {u.reacts.length > 0 ? (
                          <div className="os-drawer__update-react">
                            {u.reacts.map((r) => <button key={r} type="button" className="os-drawer__update-emoji">{r}</button>)}
                            <button type="button" className="os-drawer__update-emoji">+</button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))}

                  <div className="os-drawer__composer">
                    <textarea
                      className="os-drawer__composer-input"
                      placeholder="Write an update… use @ to mention or / for commands"
                      value={composer}
                      onChange={(e) => setComposer(e.target.value)}
                    />
                    <div className="os-drawer__composer-foot">
                      <button type="button" className="os-drawer__composer-icon" aria-label="Attach"><Paperclip /></button>
                      <button type="button" className="os-drawer__composer-icon" aria-label="Emoji"><Smile /></button>
                      <button type="button" className="os-drawer__composer-icon" aria-label="Mention"><AtSign /></button>
                      <button type="button" className="os-drawer__composer-send">
                        <Send />
                        Update
                      </button>
                    </div>
                  </div>
                </>
              )}

              {tab === "activity" && (
                <>
                  <h3 className="os-drawer__section-title">
                    <History />
                    Recent activity
                  </h3>
                  {[
                    { who: "Sarah Cohen", what: <>changed <strong>Status</strong> from <strong>Planning</strong> to <strong>Working on it</strong></>, color: C.orange, when: "12 min ago" },
                    { who: "BigBold (You)", what: <>assigned <strong>Sarah Cohen</strong></>, color: C.purple, when: "1 hr ago" },
                    { who: "BigBold (You)", what: <>set <strong>Due date</strong> to Fri, Sep 12</>, color: C.blue, when: "1 hr ago" },
                    { who: "Anika Nair", what: <>added tag <strong>Growth</strong></>, color: C.green, when: "3 hr ago" },
                    { who: "BigBold (You)", what: <>created this item</>, color: C.indigo, when: "yesterday" },
                  ].map((a, i) => (
                    <div key={i} className="os-drawer__activity">
                      <span className="os-drawer__activity-dot" style={{ background: a.color }} />
                      <span><strong>{a.who}</strong> {a.what}</span>
                      <span className="os-drawer__activity-time">{a.when}</span>
                    </div>
                  ))}
                </>
              )}

              {tab === "files" && (
                <>
                  <h3 className="os-drawer__section-title">
                    <Files />
                    Files
                  </h3>
                  {[
                    { name: "welcome-email-final.pdf", size: "248 KB", color: C.red },
                    { name: "onboarding-sequence-v2.docx", size: "92 KB", color: C.blue },
                    { name: "open-rate-analysis.xlsx", size: "1.4 MB", color: C.green },
                  ].map((f) => (
                    <div key={f.name} className="os-drawer__update">
                      <span className="os-drawer__crumb-icon" style={{ background: f.color, width: 30, height: 30, fontSize: 11, fontWeight: 700 }}>{f.name.split(".").pop()?.toUpperCase()}</span>
                      <div className="os-drawer__update-body">
                        <div className="os-drawer__update-author">{f.name}</div>
                        <div className="os-drawer__update-time">{f.size} · uploaded by Sarah Cohen</div>
                      </div>
                    </div>
                  ))}
                </>
              )}

              {tab === "subitems" && (
                <>
                  <h3 className="os-drawer__section-title">
                    <ListTree />
                    Sub-items
                  </h3>
                  {[
                    { done: true, text: "Welcome email — copy + design" },
                    { done: true, text: "Day-2 email — feature deep dive" },
                    { done: false, text: "Day-5 email — case studies" },
                    { done: false, text: "Day-14 email — upgrade nudge" },
                  ].map((s, i) => (
                    <div key={i} className="os-drawer__update" style={{ alignItems: "center" }}>
                      <button type="button" className={`os-row-check ${s.done ? "is-done" : ""}`} aria-label={s.done ? "Mark incomplete" : "Mark done"} />
                      <div className="os-drawer__update-body">
                        <div className={`os-drawer__update-text ${s.done ? "" : ""}`}
                          style={s.done ? { color: "var(--os-ink-3)", textDecoration: "line-through" } : undefined}>
                          {s.text}
                        </div>
                      </div>
                    </div>
                  ))}
                  <button type="button" className="os-tbl-add" style={{ paddingLeft: 0 }}>
                    <CheckSquare />
                    Add sub-item
                  </button>
                </>
              )}
            </div>
          </>
        ) : null}
      </aside>
    </>
  );
}
