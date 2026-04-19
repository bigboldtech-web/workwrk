import type { Metadata } from "next";
import Link from "next/link";

import { Label, Reveal, SectionHeader } from "@/components/bento";

export const metadata: Metadata = {
  title: "Book a live demo — WorkwrK | 30-min walkthrough, your data",
  description:
    "Book a 30-minute live walkthrough. No slides. We'll pull your data into a sandbox and show the system running on it.",
  alternates: { canonical: "https://workwrk.com/demo" },
};

const timeslots = [
  { day: "Tomorrow", slots: ["10:00 AM", "11:30 AM", "2:00 PM", "4:30 PM"] },
  { day: "Day after", slots: ["9:30 AM", "11:00 AM", "2:30 PM", "5:00 PM"] },
  { day: "Later this week", slots: ["Multiple slots", "Custom time"] },
];

const whatYouSee = [
  { title: "Your org graph", body: "We pull your team from Google Workspace or a CSV upload during the call. You see the graph in five minutes." },
  { title: "Your KPIs, live", body: "Pick a role — we connect to HubSpot / Razorpay / Linear and show readings before the call ends." },
  { title: "An AI-drafted KRA", body: "Pick a role. Watch the AI draft KRAs in real-time using your org data + top-performer benchmarks." },
  { title: "A review cycle preview", body: "See what a 48-hour review cycle looks like — pre-filled with whichever data we connected." },
  { title: "A Scribe SOP flow", body: "We record a 90-second screen SOP on the call and show it auto-extracted into steps." },
  { title: "Pricing tailored", body: "Based on your team size + plan preference — not a PDF we send after, a number on the call." },
];

export default function DemoPage() {
  return (
    <>
      <section className="bento-section" style={{ paddingTop: 56 }}>
        <div className="bento-container">
          <Reveal>
            <SectionHeader
              label="Live demo"
              title={
                <>
                  Thirty minutes. <span className="hi">Your data.</span> No slides.
                </>
              }
              subtitle="Most B2B demo calls are 20 minutes of feature slides and 10 minutes of 'let me follow up.' We do the opposite — we plug in your actual data during the call and show the system running on it."
              aside={{
                label: "Time commitment",
                stat: "30 min",
                text: "No prep required. Bring a CSV of your team or Google Workspace admin access.",
              }}
            />
          </Reveal>
        </div>
      </section>

      <section className="bento-section">
        <div className="bento-container">
          <div className="dm-grid">
            <Reveal>
              <div className="dm-book">
                <Label>Book a slot</Label>
                <h2 className="dm-title">Pick a time that works.</h2>
                <p className="dm-sub">
                  All slots are 30 minutes. Held over Google Meet. Indian Standard
                  Time. We&apos;ll send a calendar invite within ten minutes of
                  booking.
                </p>

                <div className="dm-form">
                  <div className="dm-field">
                    <label htmlFor="dm-name">Your name</label>
                    <input id="dm-name" type="text" placeholder="Priya Sharma" />
                  </div>
                  <div className="dm-field">
                    <label htmlFor="dm-email">Work email</label>
                    <input id="dm-email" type="email" placeholder="priya@company.in" />
                  </div>
                  <div className="dm-field">
                    <label htmlFor="dm-company">Company</label>
                    <input id="dm-company" type="text" placeholder="ScaleOps" />
                  </div>
                  <div className="dm-field-row">
                    <div className="dm-field">
                      <label htmlFor="dm-size">Team size</label>
                      <select id="dm-size" defaultValue="">
                        <option value="" disabled>Select</option>
                        <option>1–20</option>
                        <option>21–50</option>
                        <option>51–100</option>
                        <option>101–200</option>
                        <option>200+</option>
                      </select>
                    </div>
                    <div className="dm-field">
                      <label htmlFor="dm-role">Your role</label>
                      <select id="dm-role" defaultValue="">
                        <option value="" disabled>Select</option>
                        <option>Founder / CEO</option>
                        <option>COO / head of ops</option>
                        <option>Head of People</option>
                        <option>Head of Sales</option>
                        <option>Other</option>
                      </select>
                    </div>
                  </div>
                  <button type="button" className="bento-btn bento-btn-lime bento-btn-lg dm-submit">
                    Request demo slot →
                  </button>
                  <p className="dm-legal">
                    We&apos;ll never spam or share your email. By submitting you agree
                    to our{" "}
                    <Link href="/privacy">privacy policy</Link>.
                  </p>
                </div>
              </div>
            </Reveal>

            <Reveal>
              <div className="dm-slots">
                <Label>Upcoming openings</Label>
                <h3 className="dm-slots-title">Typical availability</h3>
                {timeslots.map((t) => (
                  <div key={t.day} className="dm-slot-block">
                    <div className="dm-slot-day">{t.day}</div>
                    <div className="dm-slot-row">
                      {t.slots.map((s) => (
                        <span key={s} className="dm-slot">{s}</span>
                      ))}
                    </div>
                  </div>
                ))}
                <div className="dm-tz">All times Indian Standard Time (UTC +5:30)</div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      <section className="bento-section">
        <div className="bento-container">
          <Reveal>
            <SectionHeader
              label="What you'll see"
              title={
                <>
                  Six live demos, <span className="hi">not six feature slides.</span>
                </>
              }
              subtitle="On the call we run through each of these using your data. If something doesn't map, we'll stop and talk about it."
              aside={{
                label: "Run time",
                stat: "30 min",
                text: "Tight by design. We run this call every week.",
              }}
            />
          </Reveal>
          <Reveal stagger className="dm-sees">
            {whatYouSee.map((s, i) => (
              <article key={s.title} className="dm-see">
                <span className="dm-see-n">0{i + 1}</span>
                <h3 className="dm-see-title">{s.title}</h3>
                <p className="dm-see-body">{s.body}</p>
              </article>
            ))}
          </Reveal>
        </div>
      </section>

      <style>{`
        .dm-grid {
          display: grid;
          grid-template-columns: 1.3fr 1fr;
          gap: 14px;
          align-items: stretch;
        }
        .dm-book, .dm-slots {
          padding: 40px 36px;
          background: var(--b-card);
          border: 1px solid var(--b-line);
          border-radius: var(--b-r-xl);
        }
        .dm-title {
          font-size: 36px;
          font-weight: 600;
          letter-spacing: -0.035em;
          line-height: 1.05;
          margin: 14px 0 12px;
        }
        .dm-sub {
          font-size: 15px;
          color: var(--b-t2);
          line-height: 1.55;
          max-width: 52ch;
          margin: 0 0 28px;
        }
        .dm-form { display: flex; flex-direction: column; gap: 16px; }
        .dm-field { display: flex; flex-direction: column; gap: 6px; }
        .dm-field label {
          font-family: var(--font-geist-mono), monospace;
          font-size: 11px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--b-t3);
        }
        .dm-field input, .dm-field select {
          padding: 14px 16px;
          background: var(--b-card-2);
          border: 1px solid var(--b-line);
          border-radius: 12px;
          color: var(--b-fg);
          font-family: inherit;
          font-size: 14.5px;
          transition: border-color 0.2s, background 0.2s;
        }
        .dm-field input:focus, .dm-field select:focus {
          outline: none;
          border-color: var(--b-lime);
          background: var(--b-card-3);
        }
        .dm-field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .dm-submit {
          align-self: flex-start;
          margin-top: 6px;
          font-size: 16px;
        }
        .dm-legal {
          font-size: 12px;
          color: var(--b-t3);
          margin: 0;
        }
        .dm-legal a { color: var(--b-lime); text-decoration: none; }
        .dm-legal a:hover { text-decoration: underline; }

        .dm-slots-title {
          font-size: 26px;
          font-weight: 600;
          letter-spacing: -0.025em;
          margin: 14px 0 22px;
        }
        .dm-slot-block { margin-bottom: 20px; }
        .dm-slot-day {
          font-family: var(--font-geist-mono), monospace;
          font-size: 11px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--b-lime);
          margin-bottom: 10px;
        }
        .dm-slot-row { display: flex; flex-wrap: wrap; gap: 6px; }
        .dm-slot {
          padding: 8px 14px;
          background: var(--b-card-2);
          border: 1px solid var(--b-line);
          border-radius: 100px;
          font-size: 13px;
          font-family: var(--font-geist-mono), monospace;
          color: var(--b-off);
        }
        .dm-tz {
          font-family: var(--font-geist-mono), monospace;
          font-size: 11px;
          color: var(--b-t3);
          letter-spacing: 0.08em;
          padding-top: 20px;
          border-top: 1px solid var(--b-line);
        }

        .dm-sees {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 12px;
          margin-top: 32px;
        }
        .dm-see {
          padding: 26px 24px;
          background: var(--b-card);
          border: 1px solid var(--b-line);
          border-radius: var(--b-r-md);
          min-height: 180px;
          transition: all 0.3s;
        }
        .dm-see:hover { transform: translateY(-3px); border-color: var(--b-line-2); background: var(--b-card-2); }
        .dm-see-n {
          font-family: var(--font-geist-mono), monospace;
          font-size: 11px;
          color: var(--b-lime);
          letter-spacing: 0.14em;
          display: block;
          margin-bottom: 8px;
        }
        .dm-see-title {
          font-size: 19px; font-weight: 600;
          letter-spacing: -0.02em; line-height: 1.15;
          margin: 0 0 10px;
        }
        .dm-see-body {
          font-size: 13.5px;
          color: var(--b-t2);
          line-height: 1.55;
          margin: 0;
        }

        @media (max-width: 900px) {
          .dm-grid { grid-template-columns: 1fr; }
          .dm-sees { grid-template-columns: 1fr 1fr; }
        }
        @media (max-width: 560px) {
          .dm-sees { grid-template-columns: 1fr; }
          .dm-field-row { grid-template-columns: 1fr; }
          .dm-book, .dm-slots { padding: 28px 24px; }
        }
      `}</style>
    </>
  );
}
