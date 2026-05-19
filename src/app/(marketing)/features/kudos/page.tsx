import type { Metadata } from "next";
import { Star, Trophy, Heart, Users, Sparkles, BarChart3 } from "lucide-react";
import { FeatureSubPage } from "@/components/marketing/sub-page";
import { GradientText } from "@/components/marketing/primitives";

export const metadata: Metadata = {
  title: "Kudos & Recognition — WorkwrK",
  description: "Peer-to-peer recognition tied to company values. Counts toward performance scores, surfaces top contributors, and builds a culture of appreciation.",
  alternates: { canonical: "https://workwrk.com/features/kudos" },
};

export default function KudosFeaturePage() {
  return (
    <FeatureSubPage
      hubSlug="culture"
      hue="pink"
      eyebrow="Culture hub · Kudos"
      title={<>Recognition that <GradientText hue="pink">actually counts.</GradientText></>}
      lede="Anyone can send kudos with a company-value tag. Recognition surfaces on profiles, shows up in reviews as a bonus, and feeds a monthly leaderboard. Cancel Bonusly today."
      capabilities={[
        { icon: Heart,       title: "Tag company values", body: "Every kudos points to a company value. The values you defined; not generic emoji." },
        { icon: Trophy,      title: "Monthly leaderboard",body: "Top recipients each month. Optional public, opt-in private. Either way, surfaces who's actually contributing." },
        { icon: Star,        title: "Counts in reviews",  body: "Kudos count factors into composite performance score (bonus axis, not primary). Real recognition, not just a vibe." },
        { icon: Users,       title: "Peer + manager",     body: "Anyone can kudos anyone. Optional manager approval for high-stakes recognition (founder shoutouts, etc.)." },
        { icon: Sparkles,    title: "Slack-style feed",   body: "Public kudos feed. React, comment, amplify. Companies that try it never go back." },
        { icon: BarChart3,   title: "Recognition analytics", body: "Who gives kudos, who receives, who never participates. Spot recognition gaps before they hollow out culture." },
      ]}
      relatedSlugs={["people", "reviews", "kras"]}
      testimonial={{
        quote: "We cancelled Bonusly the week we turned kudos on. People prefer it because their recognition follows them into reviews and the leaderboard.",
        author: "Sarah Chen",
        role: "Founder + CEO",
        company: "Crest AI",
      }}
      faq={[
        { q: "Does kudos cost extra?",                    a: "No — included in every tier including the free one." },
        { q: "How much does it weight in reviews?",       a: "Default: bonus axis worth +5% on top of the composite. Configurable to anywhere from 0% to 15%." },
        { q: "Can it be private?",                         a: "Yes — sender can mark a kudos private. Manager/HR still sees it; team doesn't. Counts the same toward review bonus." },
      ]}
    />
  );
}
