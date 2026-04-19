import type { Metadata } from "next";

import {
  ModuleAnchorNav,
  ModuleConnects,
  ModuleCta,
  ModuleDeepDive,
  ModuleFaq,
  ModuleHero,
  ModuleReplaces,
  ModuleStats,
} from "@/components/modules";
import { AiHeroVisual, AiPromptVisual, AiSignalVisual, AiGuardrailVisual } from "./visuals";

export const metadata: Metadata = {
  title: "AI Engine — WorkwrK | A reasoning layer over your org",
  description:
    "Not a chatbot. An AI that reads your KRAs, SOPs, reviews and org graph — and answers questions a consultant couldn't. Private by default.",
  alternates: { canonical: "https://workwrk.com/features/ai-engine" },
  openGraph: {
    title: "AI Engine — WorkwrK",
    description:
      "A private reasoning layer that reads your people, performance, and processes.",
    url: "https://workwrk.com/features/ai-engine",
  },
};

export default function AiEnginePage() {
  return (
    <>
      <ModuleHero
        eyebrow="AI Engine · The reasoning layer"
        moduleNumber="09"
        iconKey="ai"
        tone="lime"
        title={
          <>
            An AI that actually <span className="hi">reads your business.</span>
          </>
        }
        body="Ask questions a consultant couldn't answer in a week. The engine has read every KRA, every SOP version, every review, every kudos note, and every KPI reading — and holds it in its head every time you talk to it. Claude-powered, private by default, trained on nothing you put in."
        badges={["Claude-powered", "Private VPC", "Zero training", "SOC 2 type II", "Export signed logs"]}
        visual={<AiHeroVisual />}
      />

      <ModuleAnchorNav
        items={[
          { id: "prompts", label: "Ask anything", tone: "lime" },
          { id: "signals", label: "Surface signals", tone: "blue" },
          { id: "guardrails", label: "Guardrails", tone: "pink" },
          { id: "connects", label: "Connects to", tone: "amber" },
          { id: "replaces", label: "Replaces" },
          { id: "faq", label: "FAQ" },
        ]}
      />

      <ModuleDeepDive
        id="prompts"
        eyebrow="Ask anything"
        tone="lime"
        title={
          <>
            Every question your <span className="hi">founder asks at 11pm.</span>
          </>
        }
        body={
          <>
            <p>
              &quot;Who on my sales team is likely to hit the ceiling next quarter?&quot;
              &quot;Draft KRAs for a senior SDR based on the top three reps.&quot;
              &quot;Which SOPs haven&apos;t been read in the last 30 days and matter for the audit?&quot;
            </p>
            <p>
              The engine reads the exact org graph, composite scores, SOP versions, and
              review histories to answer — with citations back into the source modules.
              Not retrieval-augmented generation on a stale export. Live.
            </p>
          </>
        }
        bullets={[
          "Natural-language prompts with citations",
          "Drafts KRAs, reviews, kudos messages",
          "Summarises 8 weeks of reviews in a page",
          "Exports as Markdown, PDF, or Slack post",
          "Threaded conversations per topic",
          "Slack + web + API access",
        ]}
        visual={<AiPromptVisual />}
        visualSide="right"
      />

      <ModuleDeepDive
        id="signals"
        eyebrow="Surface signals"
        tone="blue"
        background="carded"
        title={
          <>
            Before someone resigns, <span className="hi">the system already knows.</span>
          </>
        }
        body={
          <>
            <p>
              Attrition risk, process drift, SOP rot, KPI anomaly, review disagreement —
              these are the signals that good managers notice three weeks after they
              should have. The engine runs the same pattern-match every night and
              surfaces what changed.
            </p>
            <p>
              Tuned specifically for Indian SMB dynamics: festival-season dips,
              quarter-end pipeline scramble, two-week notice cliffs.
            </p>
          </>
        }
        bullets={[
          "Attrition risk — 4-week leading signal",
          "Process drift — SOP vs actual KPI divergence",
          "Review calibration anomalies per manager",
          "Kudos decay — who&apos;s stopped getting recognition",
          "Alerts to Slack, email, or in-app inbox",
          "All signals include reasoning + data trace",
        ]}
        visual={<AiSignalVisual />}
        visualSide="left"
      />

      <ModuleDeepDive
        id="guardrails"
        eyebrow="Guardrails"
        tone="pink"
        title={
          <>
            Private by default. <span className="hi">Provable on request.</span>
          </>
        }
        body={
          <>
            <p>
              Enterprise agreement with Anthropic — your data is never used to train
              models. Prompts + responses stay in your region (Mumbai or Singapore).
              Every AI action writes to a signed audit log that auditors can verify.
            </p>
            <p>
              On Scale+, the entire engine can run in your VPC with your own Claude
              Bedrock credentials. You own the inference, we own the reasoning
              graph.
            </p>
          </>
        }
        bullets={[
          "Zero-training agreement with Anthropic",
          "Data residency: Mumbai / Singapore / your VPC",
          "Signed audit log per prompt · exportable",
          "Per-field RBAC — AI can only read what you allow",
          "Masked PII in all prompts by default",
          "Kill-switch: disable engine org-wide in one click",
        ]}
        visual={<AiGuardrailVisual />}
        visualSide="right"
      />

      <ModuleStats
        kicker="What people actually use it for"
        title={
          <>
            The questions that <span className="hi">get asked every week.</span>
          </>
        }
        stats={[
          { stat: "11×", label: "More KRAs drafted per month · vs manual authoring", tone: "lime" },
          { stat: "27 days", label: "Average lead on attrition risk · across early-access teams", tone: "blue" },
          { stat: "4.2s", label: "Median prompt latency · across the full reasoning graph", tone: "amber" },
          { stat: "0", label: "Prompts used to train external models · and it stays that way", tone: "pink" },
        ]}
      />

      <div id="connects">
        <ModuleConnects
          sourceName="AI Engine"
          title={
            <>
              Reads from every module. <span className="hi">Writes back to most.</span>
            </>
          }
          subtitle="The engine isn't a silo. It subscribes to every module's events and can write proposals back — always requiring human approval before a write lands."
          entries={[
            { name: "People", flow: "Reads org graph · drafts job descriptions, onboarding plans, and ramp schedules.", href: "/features/people", iconKey: "people" },
            { name: "KRAs", flow: "Drafts and refines KRAs from any job description or existing top performer's record.", href: "/features/kras", iconKey: "kra" },
            { name: "KPIs", flow: "Surfaces anomalies and explains them. Proposes new KPI definitions on request.", href: "/features/kpis", iconKey: "kpi" },
            { name: "Reviews", flow: "Pre-fills review drafts with 360 signals, calibrates across managers automatically.", href: "/features/reviews", iconKey: "reviews" },
            { name: "SOPs", flow: "Finds drift, suggests rewrites, extracts Scribe recordings into structured steps.", href: "/features/sops", iconKey: "sop" },
            { name: "Analytics", flow: "Writes ad-hoc SQL against the spine — no data team ticket required.", href: "/features/analytics", iconKey: "analytics" },
          ]}
        />
      </div>

      <div id="replaces">
        <ModuleReplaces
          title={
            <>
              What the AI quietly <span className="hi">makes obsolete.</span>
            </>
          }
          rows={[
            { old: "A business consultant on a 6-week engagement to audit KRAs", nu: "A prompt that drafts role-by-role KRAs with citations from your live data" },
            { old: "The Monday morning all-hands update you write from scratch", nu: "An auto-drafted digest of deltas, wins, and attention points" },
            { old: "HR manually screening 200 resumes for a role", nu: "Engine matches each against the role's KRAs and ranks by fit score" },
            { old: "'Does anyone know what X means?' in the ops Slack", nu: "Ask the engine — it cites the SOP, the owner, and the last revision" },
            { old: "A BI ticket for a one-off report that takes 4 days", nu: "Ask in natural language, get the number and the SQL, in seconds" },
          ]}
        />
      </div>

      <div id="faq">
        <ModuleFaq
          title={
            <>
              What people ask <span className="hi">before switching on the engine.</span>
            </>
          }
          items={[
            { q: "Will Anthropic see our prompts?", a: <p>No. We have a zero-retention, zero-training enterprise agreement with Anthropic. Prompts and completions are encrypted in transit and at rest, processed in your region, and never written to training corpora. Full agreement is available on request under NDA.</p> },
            { q: "Can the AI change data without approval?", a: <p>Never, by default. The engine can propose a KRA update, a review draft, or an SOP revision — but every write requires human approval in the module's own UI. You can opt a specific automation in (e.g. auto-draft Monday digests), but writes to performance-critical data always need sign-off.</p> },
            { q: "What LLM powers it?", a: <p>Claude 4.x by default (the family currently shipping). On Scale+ you can bring your own Bedrock / Vertex / Azure OpenAI credentials and point the engine at your own deployment. The reasoning graph is model-agnostic.</p> },
            { q: "How do you prevent hallucinations on business-critical questions?", a: <p>Every response cites specific records. If the engine can't cite, it refuses. We also run a second-pass critique before presenting answers for high-stakes queries (anything touching money, promotions, or terminations).</p> },
            { q: "Can we see exactly what the engine did?", a: <p>Yes. Every prompt, every retrieved record, every reasoning step, and every proposed write is signed and stored in the audit log. Exportable as JSON with cryptographic signatures for external auditors.</p> },
          ]}
        />
      </div>

      <ModuleCta
        tone="lime"
        title={
          <>
            Ask your business <em>anything.</em>
          </>
        }
        subtitle="14-day free trial includes 1,000 prompts. Connect your first module in under five minutes."
      />
    </>
  );
}
