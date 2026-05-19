import type { Metadata } from "next";
import { Bot, Search, Inbox, Sparkles, Zap, Brain } from "lucide-react";
import { FeatureSubPage } from "@/components/marketing/sub-page";
import { GradientText } from "@/components/marketing/primitives";

export const metadata: Metadata = {
  title: "AI Engine — WorkwrK",
  description: "AI is the runtime, not a chatbot. Cmd-K AI search across every entity, inbox triage, cross-module signals, plain-English business questions over your real data.",
  alternates: { canonical: "https://workwrk.com/features/ai-engine" },
};

export default function AIEnginePage() {
  return (
    <FeatureSubPage
      hubSlug="home"
      hue="indigo"
      eyebrow="Home hub · AI Engine"
      title={<>AI is the <GradientText hue="indigo">runtime</GradientText>.</>}
      lede="Not a chatbot bolted on. Cmd-K searches every entity in your workspace; inbox triage decides what matters; cross-module signals surface anomalies before you ask."
      capabilities={[
        { icon: Search,   title: "Cmd-K AI search",    body: "Hit Cmd-K, type anything. Find a person, a SOP, an open task, a vendor invoice — across every hub, in one box." },
        { icon: Inbox,    title: "Inbox triage",       body: "12 streams aggregated. AI sorts urgent / important / informational. You see a hundred items as ten." },
        { icon: Brain,    title: "Cross-module signals", body: "KPI drift in Work + low kudos in Culture + slipping OKR? AI flags it as an early warning, not after the fact." },
        { icon: Sparkles, title: "Plain-English questions", body: "Ask: 'Which managers have falling team kudos this quarter?' Get an answer from your real data, not a generic LLM." },
        { icon: Zap,      title: "Reviewer copilot",   body: "Drafts review summaries from KPI + task + kudos data. Reviewers edit, don't write from blank." },
        { icon: Bot,      title: "Privacy-first",      body: "Your data isn't training the model. Per-workspace context, per-user permissions enforced at retrieval." },
      ]}
      workflowSteps={[
        "Cmd-K from anywhere, ask anything in plain English",
        "Retrieval pulls only what you have permission to see",
        "AI synthesizes the answer with citations to source records",
        "Pin useful queries as live dashboards",
      ]}
      relatedSlugs={["analytics", "reviews", "kpis", "people"]}
      faq={[
        { q: "What model runs under the hood?",          a: "We use Claude 4.7 as the primary model. Some structured tasks use specialized smaller models. Per-customer enterprise pinning available on Scale." },
        { q: "Is my data used for training?",             a: "No. Your data is never used to train a foundation model. Per-workspace embeddings; encrypted at rest; deleted when you leave." },
        { q: "How does AI honor permissions?",            a: "Retrieval queries are scoped to what the requesting user can see. AI never returns content the user couldn't access via the UI." },
        { q: "Does AI cost extra?",                       a: "Capped on Growth; unlimited on Scale. Most teams stay under the cap; we tell you when you're approaching." },
      ]}
    />
  );
}
