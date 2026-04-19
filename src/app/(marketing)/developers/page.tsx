import type { Metadata } from "next";
import Link from "next/link";

import { Label, Reveal, SectionHeader } from "@/components/bento";

export const metadata: Metadata = {
  title: "Developers — WorkwrK API | REST, webhooks, OpenAPI",
  description:
    "Public REST API with bearer-token auth, webhook subscriptions with HMAC signatures, OpenAPI 3.1 spec. Build directly on the WorkwrK spine.",
  alternates: { canonical: "https://workwrk.com/developers" },
};

const resources = [
  {
    tone: "lime",
    label: "REST API",
    title: "Bearer-token authenticated.",
    body: "Create an API key in /settings/api. Pass it as Authorization: Bearer wk_live_…. Per-minute + per-day rate limits. Cursor-based pagination everywhere.",
    cta: { href: "/api/v1/openapi.json", label: "View OpenAPI spec →" },
  },
  {
    tone: "pink",
    label: "Webhooks",
    title: "Subscribe to live events.",
    body: "Register a URL. We POST signed JSON on every kudos, KPI reading, task escalation, review change, or SOP publish. HMAC-SHA256 signatures. Automatic exponential-backoff retries.",
    cta: { href: "#events", label: "Event catalogue ↓" },
  },
  {
    tone: "blue",
    label: "SDKs",
    title: "Node, Python, Go.",
    body: "Thin official wrappers on top of the REST API. Typed responses. Automatic retries. Or stick with curl — everything is plain REST.",
    cta: { href: "#quickstart", label: "Quickstart ↓" },
  },
  {
    tone: "amber",
    label: "OpenAPI",
    title: "One spec, every tool.",
    body: "Drop the spec into Postman, Insomnia, Stoplight, or auto-generate a client. The spec lives at /api/v1/openapi.json and updates with every release.",
    cta: { href: "/api/v1/openapi.json", label: "Raw JSON →" },
  },
];

const endpoints = [
  { method: "GET", path: "/api/v1/people", desc: "List users in your org · filter by status, department" },
  { method: "POST", path: "/api/v1/people", desc: "Invite a user · returns acceptance URL" },
  { method: "GET", path: "/api/v1/kras", desc: "List KRAs · filter by role" },
  { method: "POST", path: "/api/v1/kras", desc: "Create a KRA" },
  { method: "GET", path: "/api/v1/kpis", desc: "List KPIs · filter by KRA" },
  { method: "POST", path: "/api/v1/kpis", desc: "Create a KPI" },
  { method: "POST", path: "/api/v1/kpi-records", desc: "Log a KPI reading · fires webhooks + score recalc" },
  { method: "GET", path: "/api/v1/kudos", desc: "Kudos feed · filter by giver / receiver" },
  { method: "POST", path: "/api/v1/kudos", desc: "Send kudos · triggers Slack + webhook + score recalc" },
  { method: "GET", path: "/api/v1/tasks", desc: "List tasks · filter by assignee, status, date range" },
  { method: "POST", path: "/api/v1/tasks", desc: "Create a task · optional SLA + source" },
  { method: "GET", path: "/api/v1/sops", desc: "List SOPs · filter by status, category, type" },
];

const events = [
  { name: "kudos.created", body: "New peer recognition posted. Payload includes giver, receiver, message, companyValue." },
  { name: "kpi.recorded", body: "A KPI reading was logged. Use to sync downstream dashboards." },
  { name: "task.created", body: "New task created. Useful for assistants that track workload." },
  { name: "task.escalated", body: "Task breached its SLA and moved up the org. Fires on auto-escalation." },
  { name: "review.completed", body: "A review cycle closed for a user." },
  { name: "sop.published", body: "SOP flipped from DRAFT to PUBLISHED." },
  { name: "okr.updated", body: "OKR progress changed." },
];

export default function DevelopersPage() {
  return (
    <>
      <section className="bento-section" style={{ paddingTop: 56 }}>
        <div className="bento-container">
          <Reveal>
            <SectionHeader
              label="Developers"
              title={<>Build <span className="hi">on the spine.</span></>}
              subtitle="A REST API with bearer-token auth, signed webhooks, and an OpenAPI spec. Available on every plan. Generous rate limits by default; raise them on request."
              aside={{
                label: "Live today",
                stat: "v1",
                text: "OpenAPI 3.1 spec at /api/v1/openapi.json · backwards-compatible forever.",
              }}
            />
          </Reveal>
        </div>
      </section>

      <section id="quickstart" className="bento-section" style={{ paddingTop: 0 }}>
        <div className="bento-container">
          <Reveal>
            <div className="dev-card">
              <Label>Quickstart</Label>
              <h2 className="dev-heading">Send your first kudos in 60 seconds.</h2>
              <p className="dev-sub">
                Replace <code>$WK_KEY</code> with your key and <code>$GIVER_ID</code> /
                <code> $RECEIVER_ID</code> with user IDs from <code>GET /api/v1/people</code>.
              </p>

              <pre className="dev-code">
{`# 1. List people to get IDs
curl https://workwrk.com/api/v1/people \\
  -H "Authorization: Bearer $WK_KEY"

# 2. Post kudos
curl -X POST https://workwrk.com/api/v1/kudos \\
  -H "Authorization: Bearer $WK_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "giverId": "$GIVER_ID",
    "receiverId": "$RECEIVER_ID",
    "message": "Shipped the auth migration in half a day.",
    "companyValue": "Ownership"
  }'

# 3. Subscribe to events
curl -X POST https://workwrk.com/api/webhooks \\
  -H "Authorization: Bearer $WK_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"url":"https://yourapp.com/workwrk","events":["kudos.created","task.escalated"]}'`}
              </pre>

              <div className="dev-ctas">
                <Link href="/api/v1/openapi.json" className="bento-btn bento-btn-lime bento-btn-lg">
                  OpenAPI spec →
                </Link>
                <Link href="/signup" className="bento-btn bento-btn-ghost bento-btn-lg">
                  Get an API key
                </Link>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="bento-section">
        <div className="bento-container">
          <Reveal>
            <SectionHeader
              label="Four ways in"
              title={<>Pick your <span className="hi">integration shape.</span></>}
              subtitle="REST for request/response. Webhooks for event-driven. OpenAPI to auto-generate clients. Each works without needing the others."
            />
          </Reveal>
          <Reveal stagger className="dev-grid">
            {resources.map((r) => (
              <article key={r.label} className={`dev-r dev-r-${r.tone}`}>
                <span className="dev-r-label">{r.label}</span>
                <h3 className="dev-r-title">{r.title}</h3>
                <p className="dev-r-body">{r.body}</p>
                <Link href={r.cta.href} className="dev-r-cta">
                  {r.cta.label}
                </Link>
              </article>
            ))}
          </Reveal>
        </div>
      </section>

      <section className="bento-section">
        <div className="bento-container">
          <Reveal>
            <SectionHeader
              label="Endpoints"
              title={<>Twelve resources, <span className="hi">one bearer token.</span></>}
              subtitle="Every GET returns a cursor for pagination. Every POST returns 201 and fires the corresponding webhook event."
            />
          </Reveal>
          <Reveal stagger className="dev-ep-list">
            {endpoints.map((e) => (
              <div key={`${e.method}-${e.path}`} className="dev-ep">
                <span className={`dev-ep-method dev-ep-${e.method.toLowerCase()}`}>{e.method}</span>
                <code className="dev-ep-path">{e.path}</code>
                <span className="dev-ep-desc">{e.desc}</span>
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      <section id="events" className="bento-section">
        <div className="bento-container">
          <Reveal>
            <SectionHeader
              label="Event catalogue"
              title={<>Events you can <span className="hi">subscribe to.</span></>}
              subtitle="Register a webhook URL, pick the events (or use wildcard *), and receive HMAC-signed POSTs. Retries up to 8 times with exponential backoff."
            />
          </Reveal>
          <Reveal stagger className="dev-evt-grid">
            {events.map((e) => (
              <article key={e.name} className="dev-evt">
                <code className="dev-evt-name">{e.name}</code>
                <p className="dev-evt-body">{e.body}</p>
              </article>
            ))}
          </Reveal>
        </div>
      </section>

      <section className="bento-section-cta">
        <div className="bento-container">
          <Reveal>
            <div className="dev-finale">
              <h2>
                Ready to build? <span className="hi">Generate your first key.</span>
              </h2>
              <p>
                Keys are self-serve on every plan. Scopes: READ / WRITE / ADMIN. Rate limits raise on request — tell us your use case and we'll lift them.
              </p>
              <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                <Link href="/signup" className="bento-btn bento-btn-lime bento-btn-lg">
                  Start free trial →
                </Link>
                <a
                  href="mailto:developers@workwrk.com"
                  className="bento-btn bento-btn-ghost bento-btn-lg"
                >
                  developers@workwrk.com
                </a>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <style>{`
        .dev-card {
          background: var(--b-card);
          border: 1px solid var(--b-line);
          border-radius: var(--b-r-xl);
          padding: 48px;
        }
        .dev-heading {
          font-size: clamp(32px, 4.2vw, 48px);
          font-weight: 600;
          letter-spacing: -0.035em;
          line-height: 1.05;
          margin: 14px 0 14px;
        }
        .dev-sub {
          font-size: 15px;
          color: var(--b-t2);
          line-height: 1.6;
          max-width: 64ch;
          margin: 0 0 24px;
        }
        .dev-sub code {
          font-family: var(--font-geist-mono), monospace;
          font-size: 13px;
          padding: 2px 6px;
          background: var(--b-card-2);
          border: 1px solid var(--b-line);
          border-radius: 4px;
          color: var(--b-lime);
          margin: 0 2px;
        }
        .dev-code {
          background: var(--b-bg);
          border: 1px solid var(--b-line);
          border-radius: 14px;
          padding: 22px;
          font-family: var(--font-geist-mono), monospace;
          font-size: 12.5px;
          line-height: 1.6;
          color: var(--b-off);
          overflow-x: auto;
          margin: 0 0 28px;
          white-space: pre;
          -ms-overflow-style: none;
          scrollbar-width: thin;
        }
        .dev-ctas { display: flex; flex-wrap: wrap; gap: 10px; }

        .dev-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 14px;
        }
        .dev-r {
          padding: 32px 30px;
          background: var(--b-card);
          border: 1px solid var(--b-line);
          border-radius: var(--b-r-lg);
          transition: all 0.3s;
        }
        .dev-r:hover { transform: translateY(-3px); border-color: var(--b-line-2); background: var(--b-card-2); }
        .dev-r-lime { border-top: 3px solid var(--b-lime); }
        .dev-r-pink { border-top: 3px solid var(--b-pink); }
        .dev-r-blue { border-top: 3px solid var(--b-blue); }
        .dev-r-amber { border-top: 3px solid var(--b-amber); }
        .dev-r-label {
          font-family: var(--font-geist-mono), monospace;
          font-size: 10.5px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
        }
        .dev-r-lime .dev-r-label { color: var(--b-lime); }
        .dev-r-pink .dev-r-label { color: var(--b-pink); }
        .dev-r-blue .dev-r-label { color: var(--b-blue); }
        .dev-r-amber .dev-r-label { color: var(--b-amber); }
        .dev-r-title {
          font-size: 24px;
          font-weight: 600;
          letter-spacing: -0.025em;
          margin: 10px 0 12px;
        }
        .dev-r-body {
          font-size: 14.5px;
          color: var(--b-t2);
          line-height: 1.55;
          margin: 0 0 18px;
        }
        .dev-r-cta {
          font-family: var(--font-geist-mono), monospace;
          font-size: 11.5px;
          letter-spacing: 0.06em;
          text-decoration: none;
          color: var(--b-fg);
          transition: color 0.2s;
        }
        .dev-r-cta:hover { color: var(--b-lime); }

        .dev-ep-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-top: 24px;
        }
        .dev-ep {
          display: grid;
          grid-template-columns: 56px 260px 1fr;
          gap: 20px;
          align-items: center;
          padding: 14px 20px;
          background: var(--b-card);
          border: 1px solid var(--b-line);
          border-radius: var(--b-r-md);
          transition: all 0.25s;
        }
        .dev-ep:hover { border-color: var(--b-line-2); background: var(--b-card-2); }
        .dev-ep-method {
          font-family: var(--font-geist-mono), monospace;
          font-size: 10.5px;
          letter-spacing: 0.14em;
          font-weight: 700;
          padding: 4px 8px;
          border-radius: 6px;
          text-align: center;
        }
        .dev-ep-get { background: rgba(74, 158, 255, 0.1); color: var(--b-blue); }
        .dev-ep-post { background: rgba(212, 255, 46, 0.1); color: var(--b-lime); }
        .dev-ep-path {
          font-family: var(--font-geist-mono), monospace;
          font-size: 13px;
          color: var(--b-fg);
        }
        .dev-ep-desc {
          font-size: 13px;
          color: var(--b-t2);
          line-height: 1.4;
        }

        .dev-evt-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 10px;
          margin-top: 24px;
        }
        .dev-evt {
          padding: 22px 24px;
          background: var(--b-card);
          border: 1px solid var(--b-line);
          border-radius: var(--b-r-md);
        }
        .dev-evt-name {
          font-family: var(--font-geist-mono), monospace;
          font-size: 14px;
          color: var(--b-lime);
          letter-spacing: -0.01em;
          display: block;
          margin-bottom: 10px;
        }
        .dev-evt-body {
          font-size: 13.5px;
          color: var(--b-t2);
          line-height: 1.55;
          margin: 0;
        }

        .dev-finale {
          background: var(--b-card);
          border: 1px solid var(--b-line);
          border-radius: var(--b-r-xl);
          padding: 64px 48px;
          text-align: center;
        }
        .dev-finale h2 {
          font-size: clamp(34px, 5vw, 56px);
          font-weight: 600;
          letter-spacing: -0.035em;
          line-height: 1.05;
          margin: 0 0 16px;
        }
        .dev-finale p {
          font-size: 16px;
          color: var(--b-t2);
          max-width: 540px;
          margin: 0 auto 28px;
          line-height: 1.6;
        }

        @media (max-width: 900px) {
          .dev-card { padding: 32px 24px; }
          .dev-grid { grid-template-columns: 1fr; }
          .dev-evt-grid { grid-template-columns: 1fr; }
          .dev-ep { grid-template-columns: 56px 1fr; }
          .dev-ep-desc { grid-column: 1 / -1; padding-left: 76px; }
        }
      `}</style>
    </>
  );
}
