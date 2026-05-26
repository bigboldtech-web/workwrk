"use client";

import { Sparkles, Mail, FileText, MessageSquare, ArrowRight } from "lucide-react";

function formatDate(d: Date) {
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default function TodayPage() {
  const today = new Date();

  return (
    <div className="os-today">
      <div className="os-today__hero">
        <div className="os-today__date">{formatDate(today).toUpperCase()}</div>
        <h1 className="os-today__greet">
          {greeting()}, <em>BigBold</em>.
        </h1>
        <p className="os-today__sub">
          You have <strong>3 things now</strong>, <strong>7 today</strong>, and Sidekick has{" "}
          <strong>3 drafts</strong> waiting for your review.
        </p>
      </div>

      <div className="os-today__stats">
        <div className="os-today__stat">
          <div className="os-today__stat-label">Pipeline</div>
          <div className="os-today__stat-value">₹42.8L</div>
          <div className="os-today__stat-delta">+12% this week</div>
        </div>
        <div className="os-today__stat">
          <div className="os-today__stat-label">Open tasks</div>
          <div className="os-today__stat-value">23</div>
          <div className="os-today__stat-delta dn">+4 since yesterday</div>
        </div>
        <div className="os-today__stat">
          <div className="os-today__stat-label">SLAs at risk</div>
          <div className="os-today__stat-value">2</div>
          <div className="os-today__stat-delta dn">2 incidents</div>
        </div>
        <div className="os-today__stat">
          <div className="os-today__stat-label">Agents active</div>
          <div className="os-today__stat-value">4</div>
          <div className="os-today__stat-delta">12 actions today</div>
        </div>
      </div>

      <section className="os-today__section">
        <div className="os-today__section-head">
          <h2 className="os-today__section-title">Now</h2>
          <span className="os-today__section-meta">3 items — needs your decision</span>
        </div>
        <div className="os-today__list">
          <div className="os-today__row">
            <span className="os-today__row-tag os-today__row-tag--action">APPROVAL</span>
            <div className="os-today__row-text">
              <strong>Sarah Cohen's expense report — ₹4,200</strong>
              <small>3 receipts · within policy · routed by Priya 12m ago</small>
            </div>
            <div className="os-today__row-actions">
              <button type="button" className="os-today__row-btn">Decline</button>
              <button type="button" className="os-today__row-btn">Ask</button>
              <button type="button" className="os-today__row-btn os-today__row-btn--primary">Approve</button>
            </div>
          </div>
          <div className="os-today__row">
            <span className="os-today__row-tag os-today__row-tag--risk">STALLED</span>
            <div className="os-today__row-text">
              <strong>2 deals stalled &gt; 14 days</strong>
              <small>Acme Corp (₹8.5L) · Lumen Labs (₹3.2L) — Sidekick drafted nudges</small>
            </div>
            <div className="os-today__row-actions">
              <button type="button" className="os-today__row-btn">Open pipeline</button>
              <button type="button" className="os-today__row-btn os-today__row-btn--primary">
                Review drafts
              </button>
            </div>
          </div>
          <div className="os-today__row">
            <span className="os-today__row-tag os-today__row-tag--opp">MEETING</span>
            <div className="os-today__row-text">
              <strong>Sprint retro in 25 minutes</strong>
              <small>Engineering — 7 attendees · Sidekick prepared an agenda from last sprint</small>
            </div>
            <div className="os-today__row-actions">
              <button type="button" className="os-today__row-btn">Reschedule</button>
              <button type="button" className="os-today__row-btn os-today__row-btn--primary">
                Open agenda
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="os-today__section">
        <div className="os-today__drafts">
          <div className="os-today__drafts-head">
            <div className="os-today__drafts-icon">
              <Sparkles />
            </div>
            <div>
              <div className="os-today__drafts-h3">
                Sidekick has drafted <em>3 things</em>
              </div>
              <div className="os-today__drafts-sub">
                Reviewed for tone, scoped to your policies. Send, edit, or discard.
              </div>
            </div>
          </div>
          <div className="os-today__list" style={{ borderRadius: 10 }}>
            <div className="os-today__row">
              <span className="os-today__row-tag os-today__row-tag--draft">EMAIL</span>
              <div className="os-today__row-text">
                <strong>Reply to Acme renewal email</strong>
                <small>Drafted by Ria · 4-paragraph reply with pricing options</small>
              </div>
              <div className="os-today__row-actions">
                <button type="button" className="os-today__row-btn">
                  <Mail style={{ width: 12, height: 12 }} />
                  Open
                </button>
                <button type="button" className="os-today__row-btn os-today__row-btn--accent">
                  Send
                </button>
              </div>
            </div>
            <div className="os-today__row">
              <span className="os-today__row-tag os-today__row-tag--draft">DOC</span>
              <div className="os-today__row-text">
                <strong>Q2 board update document</strong>
                <small>Drafted by Sidekick · 6 pages · pulled from CRM + Finance</small>
              </div>
              <div className="os-today__row-actions">
                <button type="button" className="os-today__row-btn">
                  <FileText style={{ width: 12, height: 12 }} />
                  Open
                </button>
                <button type="button" className="os-today__row-btn os-today__row-btn--accent">
                  Publish
                </button>
              </div>
            </div>
            <div className="os-today__row">
              <span className="os-today__row-tag os-today__row-tag--draft">REPLY</span>
              <div className="os-today__row-text">
                <strong>Slack reply to #engineering — auth bug thread</strong>
                <small>Drafted by Aman · referenced incident INC-3421</small>
              </div>
              <div className="os-today__row-actions">
                <button type="button" className="os-today__row-btn">
                  <MessageSquare style={{ width: 12, height: 12 }} />
                  Open
                </button>
                <button type="button" className="os-today__row-btn os-today__row-btn--accent">
                  Send
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="os-today__section">
        <div className="os-today__section-head">
          <h2 className="os-today__section-title">Today</h2>
          <span className="os-today__section-meta">7 items · 2 due before 5pm</span>
        </div>
        <div className="os-today__list">
          {[
            { tag: "TASK",    text: "Review Q2 hiring plan with Priya",            sub: "People · due 2:00 PM" },
            { tag: "REVIEW",  text: "Approve 3 PRs in workwrk/dashboard",          sub: "Engineering · @bigbold requested" },
            { tag: "1:1",     text: "1:1 with Sarah — discuss sprint capacity",    sub: "3:30 PM · 30 min" },
            { tag: "TASK",    text: "Update OKR check-in: Customer retention",     sub: "OKRs · 73% to target" },
            { tag: "READ",    text: "Read: weekly digest from Sidekick",           sub: "5 highlights across all spaces" },
          ].map((it) => (
            <div key={it.text} className="os-today__row">
              <span className="os-today__row-tag">{it.tag}</span>
              <div className="os-today__row-text">
                <strong>{it.text}</strong>
                <small>{it.sub}</small>
              </div>
              <div className="os-today__row-actions">
                <button type="button" className="os-today__row-btn">
                  Open <ArrowRight style={{ width: 11, height: 11 }} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
