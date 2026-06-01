"use client";

/* Redeem — employee point redemption page with reward catalog + history. */

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Gift, Coins, Hash, ChevronRight, Sparkles, Award, Coffee, Plane,
  Headphones, BookOpen, CheckCircle2, Clock, Heart, Trophy,
} from "lucide-react";
import { OsTitleBar } from "@/components/layout/os/title-bar";
import { C, GRAD } from "@/components/layout/os/catalog";
import { useOsToast } from "@/components/layout/os/toast";

type Reward = {
  id: string;
  name: string;
  description: string;
  category: "food" | "experiences" | "swag" | "wellness" | "learning" | "donations";
  cost: number;
  Icon: typeof Gift;
  hue: string;
  badge?: string;
};

type RedemptionStatus = "PENDING" | "FULFILLED" | "CANCELLED";

type Redemption = {
  id: string;
  rewardId: string;
  rewardName: string;
  cost: number;
  status: RedemptionStatus;
  createdAt: string;
};

const REWARDS: Reward[] = [
  { id: "r1",  name: "Starbucks gift card $25",    description: "Instant digital code · redeemable anywhere", category: "food",        cost: 250,  Icon: Coffee,    hue: C.green },
  { id: "r2",  name: "Lunch on the company $30",   description: "DoorDash credit for today's lunch",            category: "food",        cost: 300,  Icon: Coffee,    hue: C.orange },
  { id: "r3",  name: "Friday off",                 description: "Extra PTO day, no questions asked",            category: "experiences", cost: 1500, Icon: Plane,     hue: C.blue,    badge: "★ Popular" },
  { id: "r4",  name: "Concert tickets",            description: "$200 toward any event of your choice",          category: "experiences", cost: 2000, Icon: Sparkles,  hue: C.pink },
  { id: "r5",  name: "Premium WorkwrK hoodie",     description: "Limited edition · all sizes",                   category: "swag",        cost: 500,  Icon: Award,     hue: C.purple },
  { id: "r6",  name: "Mechanical keyboard",        description: "Choose Cherry MX Brown / Blue / Red",           category: "swag",        cost: 1200, Icon: Award,     hue: C.indigo },
  { id: "r7",  name: "Massage session",            description: "60-min therapeutic massage near you",           category: "wellness",    cost: 800,  Icon: Heart,     hue: C.red },
  { id: "r8",  name: "Meditation app — 1 year",    description: "Headspace or Calm, annual subscription",        category: "wellness",    cost: 600,  Icon: Headphones, hue: C.teal },
  { id: "r9",  name: "Online course",              description: "Any Udemy/Coursera/Frontend Masters course",    category: "learning",    cost: 500,  Icon: BookOpen,  hue: C.blue },
  { id: "r10", name: "Conference ticket",          description: "$1500 toward an industry conference",           category: "learning",    cost: 3000, Icon: BookOpen,  hue: C.purple, badge: "Big spender" },
  { id: "r11", name: "Donate $50 to charity",      description: "We match it · pick from 200+ verified orgs",    category: "donations",   cost: 500,  Icon: Heart,     hue: C.red,    badge: "Matched" },
  { id: "r12", name: "Plant a tree",               description: "10 trees planted in your name via OneTreePlanted", category: "donations",  cost: 100,  Icon: Sparkles,  hue: C.green },
];

const CATEGORY_LABEL: Record<Reward["category"] | "all", string> = {
  all: "All",
  food: "Food & coffee",
  experiences: "Experiences",
  swag: "WorkwrK swag",
  wellness: "Wellness",
  learning: "Learning",
  donations: "Donations",
};

const SAMPLE_HISTORY: Redemption[] = [
  { id: "h1", rewardId: "r1", rewardName: "Starbucks gift card $25", cost: 250, status: "FULFILLED", createdAt: "2026-04-22T10:00:00Z" },
  { id: "h2", rewardId: "r5", rewardName: "Premium WorkwrK hoodie", cost: 500, status: "FULFILLED", createdAt: "2026-03-14T14:30:00Z" },
  { id: "h3", rewardId: "r3", rewardName: "Friday off", cost: 1500, status: "PENDING", createdAt: "2026-05-29T16:00:00Z" },
];

export default function RedeemPage() {
  const [balance, setBalance] = useState(1820);
  const [redemptions, setRedemptions] = useState<Redemption[]>(SAMPLE_HISTORY);
  const [activeCategory, setActiveCategory] = useState<Reward["category"] | "all">("all");
  const { toast } = useOsToast();

  const stats = useMemo(() => ({
    balance,
    redeemed: redemptions.length,
    spent: redemptions.reduce((a, r) => a + (r.status !== "CANCELLED" ? r.cost : 0), 0),
    pending: redemptions.filter((r) => r.status === "PENDING").length,
  }), [balance, redemptions]);

  const filtered = useMemo(() =>
    activeCategory === "all" ? REWARDS : REWARDS.filter((r) => r.category === activeCategory),
    [activeCategory]
  );

  function redeem(r: Reward) {
    if (balance < r.cost) { toast(`You need ${r.cost - balance} more points`); return; }
    if (!window.confirm(`Redeem ${r.name} for ${r.cost} points?`)) return;
    setBalance((b) => b - r.cost);
    setRedemptions((rs) => [
      { id: Math.random().toString(36).slice(2, 8), rewardId: r.id, rewardName: r.name, cost: r.cost, status: "PENDING", createdAt: new Date().toISOString() },
      ...rs,
    ]);
    toast("Redemption submitted — you'll get an email when it's fulfilled");
  }

  return (
    <>
      <OsTitleBar
        title="Redeem"
        Icon={Gift}
        iconGradient={GRAD.pinkPurple}
        description={`${balance} points available · ${stats.redeemed} redemption${stats.redeemed === 1 ? "" : "s"} all-time`}
        actions={
          <div className="rdm__head-actions">
            <Link href="/store" className="rdm__nav-link"><Hash /> Store</Link>
            <Link href="/kudos" className="rdm__nav-link"><Heart /> Kudos</Link>
          </div>
        }
      />

      <div className="rdm">
        <section className="rdm__hero">
          <span className="rdm__hero-accent" aria-hidden="true" />
          <div className="rdm__hero-l">
            <span className="rdm__hero-tag"><Coins /> Your balance</span>
            <h2>{balance.toLocaleString()} <span>points</span></h2>
            <p>Earn points from kudos, completed SOPs, milestones, and program participation.</p>
          </div>
          <div className="rdm__hero-r">
            <div className="rdm__hero-stat">
              <strong>{stats.spent.toLocaleString()}</strong>
              <span>spent</span>
            </div>
            <div className="rdm__hero-stat">
              <strong>{stats.pending}</strong>
              <span>pending</span>
            </div>
            <div className="rdm__hero-stat">
              <strong>{stats.redeemed}</strong>
              <span>redemptions</span>
            </div>
          </div>
        </section>

        <section className="rdm__section">
          <header className="rdm__section-head">
            <h2><Trophy /> Reward catalog</h2>
            <span className="rdm__section-line" />
          </header>

          <div className="rdm__cats">
            {(["all", "food", "experiences", "swag", "wellness", "learning", "donations"] as const).map((c) => (
              <button
                key={c}
                type="button"
                className={`rdm__cat${activeCategory === c ? " is-active" : ""}`}
                onClick={() => setActiveCategory(c)}
              >
                {CATEGORY_LABEL[c]}
                <span>{c === "all" ? REWARDS.length : REWARDS.filter((r) => r.category === c).length}</span>
              </button>
            ))}
          </div>

          <div className="rdm__grid">
            {filtered.map((r) => {
              const Icon = r.Icon;
              const canAfford = balance >= r.cost;
              return (
                <article key={r.id} className={`rdm__reward${canAfford ? "" : " is-locked"}`} style={{ ["--r-c" as unknown as string]: r.hue }}>
                  <header className="rdm__reward-head">
                    <span className="rdm__reward-icon"><Icon /></span>
                    {r.badge && <span className="rdm__reward-badge">{r.badge}</span>}
                  </header>
                  <h3 className="rdm__reward-name">{r.name}</h3>
                  <p className="rdm__reward-desc">{r.description}</p>
                  <footer className="rdm__reward-foot">
                    <span className="rdm__reward-cost"><Coins /> {r.cost.toLocaleString()}</span>
                    <button
                      type="button"
                      className="rdm__reward-btn"
                      disabled={!canAfford}
                      onClick={() => redeem(r)}
                    >
                      {canAfford ? "Redeem" : `${r.cost - balance} short`} <ChevronRight />
                    </button>
                  </footer>
                </article>
              );
            })}
          </div>
        </section>

        {redemptions.length > 0 && (
          <section className="rdm__section">
            <header className="rdm__section-head">
              <h2><Clock /> Redemption history</h2>
              <span className="rdm__section-line" />
              <span className="rdm__section-count">{redemptions.length}</span>
            </header>
            <div className="rdm__history">
              {redemptions.map((r) => (
                <article key={r.id} className={`rdm__hrow rdm__hrow--${r.status.toLowerCase()}`}>
                  <span className="rdm__hrow-icon">
                    {r.status === "FULFILLED" ? <CheckCircle2 /> : r.status === "PENDING" ? <Clock /> : <Gift />}
                  </span>
                  <div className="rdm__hrow-main">
                    <div className="rdm__hrow-name">{r.rewardName}</div>
                    <div className="rdm__hrow-meta">{new Date(r.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</div>
                  </div>
                  <span className={`rdm__hrow-status rdm__hrow-status--${r.status.toLowerCase()}`}>{r.status}</span>
                  <span className="rdm__hrow-cost">{r.cost.toLocaleString()} pts</span>
                </article>
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
