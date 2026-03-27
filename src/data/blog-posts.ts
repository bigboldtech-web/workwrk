export interface BlogPost {
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  author: string;
  authorRole: string;
  date: string;
  category: string;
  readTime: string;
  tags: string[];
}

export const blogPosts: BlogPost[] = [
  {
    slug: "what-is-a-business-operating-system",
    title: "What Is a Business Operating System and Why Your Company Needs One",
    excerpt:
      "Most businesses run on WhatsApp, spreadsheets, and hope. A business operating system replaces all of that with one unified platform. Here's why it matters.",
    content: `
## The Problem Every Growing Business Faces

You started with 5 people. Everyone knew everything. Decisions happened over lunch. KPIs lived in your head.

Now you're at 30. Or 80. Or 200. And suddenly:

- **Performance is invisible.** You don't know who's actually delivering until quarterly reviews — which are mostly storytelling sessions.
- **Processes live in people's heads.** When someone leaves, their process leaves with them.
- **You're using 15 tools** — a CRM here, an HRMS there, Google Sheets for KPIs, WhatsApp for task follow-ups, and a project management tool nobody actually uses.
- **Decisions are gut-based.** Promotions, hikes, PIPs — all based on who talks the loudest in meetings, not who actually performs.

This is not a technology problem. It's an operating system problem.

## What Is a Business Operating System?

A business operating system (Business OS) is a single platform that unifies how your company manages **people, performance, processes, and decisions**.

Think of it like this: your phone has an operating system (iOS or Android) that makes all your apps work together seamlessly. A Business OS does the same for your company — it makes people management, KPIs, SOPs, tasks, reviews, and analytics work together as one system.

### The Core Components

A complete Business OS includes:

1. **People Management** — Org chart, profiles, departments, onboarding
2. **KPI Engine** — Goal setting, tracking, auto-scoring
3. **Task Management** — Assignment, tracking, completion rates
4. **SOP Playbook** — Process documentation, compliance tracking
5. **Performance Reviews** — 360° feedback, calibration, data-driven decisions
6. **Recognition** — Peer kudos, value alignment, social feed
7. **Composite Scoring** — One number that captures total performance
8. **AI Intelligence** — Ask your business anything in plain English

## Why Spreadsheets and Disconnected Tools Fail

The real cost isn't the tool subscription. It's the **information gaps**.

When your KPIs live in one tool, tasks in another, and reviews in a third, you lose the connections between them. You can't answer questions like:

- "Is this person's KPI score declining because they're missing tasks or because their SOP compliance dropped?"
- "Who should I promote based on actual data across all dimensions?"
- "Which department is underperforming and why?"

A Business OS connects all these data points so you get **one composite view** of every person, team, and department.

## Who Needs a Business OS?

If you answer "yes" to any of these, you need one:

- You have more than 10 employees
- Performance reviews take more than a week
- You can't name your top 5 performers with data to back it up
- SOPs exist in Google Docs that nobody reads
- Task follow-ups happen on WhatsApp
- You've lost institutional knowledge when someone left

## The Bottom Line

A Business OS isn't another tool to add to your stack. It's the tool that **replaces the stack**. One platform. One source of truth. Zero chaos.
    `.trim(),
    author: "TheywrK Team",
    authorRole: "Product",
    date: "2026-03-25",
    category: "Business Operations",
    readTime: "6 min read",
    tags: ["business operating system", "SaaS", "operations", "productivity"],
  },
  {
    slug: "how-to-build-performance-review-system",
    title: "How to Build a Performance Review System That Actually Works",
    excerpt:
      "Most performance reviews are broken — they're subjective, infrequent, and dreaded by everyone. Here's how to build a system that uses real data and drives real decisions.",
    content: `
## Why Most Performance Reviews Fail

Let's be honest: nobody likes performance reviews. Managers dread writing them. Employees dread receiving them. HR dreads chasing everyone to complete them.

The fundamental problem? Most review systems are **opinion-based, not data-based**. A manager sits down once a quarter and tries to remember 90 days of work. The result is recency bias, favoritism, and a lot of generic feedback.

## The Data-Driven Alternative

What if your review system auto-populated with real performance data?

Imagine opening a review form and seeing:

- **KPI Achievement: 87%** (auto-calculated from the KPI engine)
- **Task Completion Rate: 94%** (from the task system)
- **SOP Compliance: 91%** (from the SOP tracker)
- **Peer Rating: 4.2/5** (from peer feedback)
- **Kudos Received: 12 this quarter** (from the recognition system)

Now the review conversation shifts from "I think you did well" to "Your data shows strong KPI performance but SOP compliance dropped — let's talk about why."

## The 360° Approach

A complete review system includes multiple perspectives:

### Self-Assessment
Employees rate themselves against their KRAs. This reveals self-awareness gaps — if someone rates themselves 5/5 but their KPI score is 60%, that's a coaching conversation.

### Manager Review
The manager adds qualitative context to quantitative data. They can see the numbers and add nuance: "The KPI dip in February was because we shifted her to a new project mid-quarter."

### Peer Feedback
Colleagues provide ratings and written feedback. This catches things managers miss — collaboration quality, helpfulness, communication.

### Calibration
Managers across the organization compare scores to ensure fairness. This prevents one team from being graded on a curve while another is graded harshly.

## Composite Scoring: The Single Number

After all inputs are collected, the system should calculate a **composite performance score** that weighs all factors:

| Component | Default Weight |
|-----------|---------------|
| KPI Achievement | 30% |
| Manager Rating | 25% |
| Task Completion | 15% |
| Peer Feedback | 10% |
| Self-Assessment | 10% |
| SOP Compliance | 10% |

This gives you one number (0–100) that represents total performance — not just one manager's opinion.

## Making Reviews Actionable

The review shouldn't end with a score. It should trigger decisions:

- **Score > 85**: Promotion/hike eligible. Flag for discussion.
- **Score 60–85**: On track. Identify growth areas.
- **Score < 60**: Performance improvement plan. Set 30-day milestones.

When decisions are tied to data, they're fair, defensible, and trusted by the team.

## Key Takeaways

1. Pre-populate reviews with real data from KPIs, tasks, and SOPs
2. Use 360° feedback (self, manager, peer) for complete picture
3. Calculate composite scores with configurable weights
4. Calibrate across teams for fairness
5. Tie scores to actionable outcomes (promotions, PIPs, hikes)
    `.trim(),
    author: "TheywrK Team",
    authorRole: "Product",
    date: "2026-03-20",
    category: "Performance Management",
    readTime: "7 min read",
    tags: ["performance reviews", "360 feedback", "composite scoring", "HR"],
  },
  {
    slug: "sop-compliance-tracking-guide",
    title: "SOP Compliance Tracking: How to Ensure Your Team Actually Follows Processes",
    excerpt:
      "Creating SOPs is easy. Getting people to follow them is the hard part. Here's a practical guide to tracking and improving SOP compliance across your organization.",
    content: `
## The SOP Problem

Every business has processes. Few businesses have documented processes. Even fewer track whether those processes are actually followed.

The result? The same task gets done 5 different ways by 5 different people. Quality varies wildly. When your best performer goes on leave, nobody knows how to do their job.

## Why SOPs Get Ignored

SOPs fail for three reasons:

1. **They're buried in Google Docs** that nobody knows exist
2. **There's no accountability** — nobody tracks who's following them
3. **They're outdated** — written once and never updated

The fix isn't better documentation. It's a **system that assigns, tracks, and scores compliance**.

## Building an SOP Compliance System

### Step 1: Create Step-by-Step SOPs

Break every process into discrete steps. Not paragraphs of text — actual checkable steps.

Bad: "Process the customer order by checking inventory, creating the invoice, and scheduling delivery."

Good:
- Step 1: Check inventory for all line items
- Step 2: Create invoice with correct pricing
- Step 3: Get manager approval for orders > ₹50,000
- Step 4: Schedule delivery with logistics
- Step 5: Send confirmation to customer

### Step 2: Assign SOPs to People

Every SOP should be assigned to specific roles or individuals. "The Sales SOP" assigned to all sales reps. "The Onboarding SOP" assigned to HR.

### Step 3: Track Per-Step Completion

As employees work through their assigned SOPs, they check off each step. The system tracks:

- Total steps vs. completed steps
- Time taken per step
- Steps that get skipped most often

### Step 4: Score Compliance

Compliance score = (Steps Completed / Total Steps) × 100

Aggregate by:
- **Individual**: "Priya has 96% SOP compliance"
- **Department**: "Sales team is at 88%, Operations at 73%"
- **SOP**: "The Order Processing SOP has 91% compliance, but Customer Escalation SOP is at 58%"

### Step 5: Feed Into Performance Scores

SOP compliance should be one factor in the composite performance score. In TheywrK, it carries a default weight of 10% — enough to matter, not enough to dominate.

## Common Compliance Problems and Fixes

**Problem**: One SOP has much lower compliance than others.
**Fix**: The SOP is probably too complex or unclear. Simplify the steps.

**Problem**: One person has low compliance across all SOPs.
**Fix**: Training issue. Schedule a 1:1 and walk through the processes.

**Problem**: Compliance drops on Fridays.
**Fix**: Workload issue. People rush through end-of-week tasks.

## The ROI of SOP Compliance

Companies that track SOP compliance see:
- Fewer errors and rework
- Faster onboarding (new hires follow documented steps)
- Institutional knowledge preserved when people leave
- Consistent quality across locations and teams
- Easier identification of process bottlenecks
    `.trim(),
    author: "TheywrK Team",
    authorRole: "Operations",
    date: "2026-03-15",
    category: "Process Management",
    readTime: "6 min read",
    tags: ["SOP", "compliance", "process management", "operations"],
  },
  {
    slug: "employee-recognition-impact-on-performance",
    title: "How Employee Recognition Directly Impacts Performance Scores",
    excerpt:
      "Recognition isn't just feel-good fluff. When tied to performance data, kudos systems measurably improve engagement, retention, and output. Here's the data.",
    content: `
## Recognition Is Not a Nice-to-Have

Most companies treat recognition as an afterthought — an annual award ceremony or a Slack channel that nobody checks. Meanwhile, their best performers quietly disengage because their work goes unnoticed.

The research is clear: employees who receive regular recognition are **4x more likely to be engaged** and **5x more likely to feel connected to company culture**.

But vague praise ("great job!") doesn't move the needle. Structured, value-aligned recognition does.

## What Effective Recognition Looks Like

### 1. It's Peer-to-Peer, Not Just Top-Down

The most impactful recognition comes from colleagues, not just managers. When a teammate says "your work on the client proposal was exceptional," it carries weight because they saw the effort firsthand.

### 2. It's Tied to Company Values

Instead of generic praise, tie recognition to specific values:

- **"Customer First"** — "You stayed late to resolve the client's issue same-day"
- **"Ownership"** — "You caught the bug before it hit production"
- **"Teamwork"** — "You onboarded the new hire even though it wasn't your job"

This reinforces what behaviors the company actually values.

### 3. It's Visible

Recognition should be public — a social feed that everyone sees. This normalizes appreciation and creates positive competition.

### 4. It Impacts Performance Scores

Here's where recognition gets strategic. In a composite performance scoring system, kudos can factor in as a bonus:

**+1 point per 2 kudos received in the last 30 days, up to +5 bonus points.**

This means a person with a composite score of 80 who received 10 kudos this month gets bumped to 85. That's not insignificant — it can be the difference between "on track" and "promotion eligible."

## The Recognition-Performance Flywheel

When recognition is tied to data, it creates a positive feedback loop:

1. Employee does great work
2. Colleague gives kudos with a value tag
3. Kudos appears in the social feed (visibility)
4. Performance score gets a bonus bump (incentive)
5. Monthly leaderboard shows "Most Recognized" (competition)
6. Employee is motivated to do more great work

This flywheel runs itself once it's set up.

## Building a Recognition System That Works

**Must-haves:**
- One-click kudos from anywhere in the platform
- Message + company value tag
- Social feed visible to the whole organization
- Integration with performance scores
- Monthly leaderboard

**Nice-to-haves:**
- Slack/Teams notification when you receive kudos
- Kudos count on employee profiles
- Manager dashboard showing recognition patterns

## What Recognition Data Tells You

Beyond the feel-good factor, recognition data reveals:

- **Who's being recognized most** — your informal leaders
- **Who's never recognized** — potential engagement risk
- **Which values are reinforced most** — culture health check
- **Which teams recognize each other** — collaboration patterns
    `.trim(),
    author: "TheywrK Team",
    authorRole: "People & Culture",
    date: "2026-03-10",
    category: "Employee Engagement",
    readTime: "5 min read",
    tags: ["recognition", "kudos", "employee engagement", "performance"],
  },
  {
    slug: "ai-for-business-intelligence-practical-guide",
    title: "AI for Business Intelligence: A Practical Guide for Growing Companies",
    excerpt:
      "Forget chatbots that give generic answers. Here's how AI actually works when it's connected to your real business data — and why it changes how you make decisions.",
    content: `
## AI That Actually Knows Your Business

Most "AI features" in business tools are glorified chatbots. They give generic advice based on general knowledge. Ask "who should I promote?" and you'll get a blog post about promotion criteria.

Real AI intelligence is different. It's connected to **your actual data** — your people, their KPIs, their task completion rates, their SOP compliance, their peer feedback, their review scores.

When you ask "who should I promote?" it answers with names, scores, and evidence.

## What AI-Powered Business Intelligence Looks Like

### Natural Language Queries

No dashboards to navigate. No filters to set. Just ask:

- **"Who are my top 5 performers this quarter?"** → Names with composite scores, trend arrows, and breakdown
- **"Which SOPs have the lowest compliance?"** → Ranked list with percentages and department breakdown
- **"Compare the Sales team to the Ops team"** → Side-by-side KPI averages, task completion, review scores
- **"Who hasn't received any recognition in 3 months?"** → List of people at engagement risk

### Cross-Module Intelligence

The power isn't in any single data point — it's in the connections. AI can correlate:

- Declining KPI scores with increased task overload
- Low SOP compliance with recent team changes
- High recognition patterns with promotion readiness
- Review score trends with manager calibration patterns

### Predictive Insights

With enough data, AI can predict:

- **Attrition risk**: Someone with declining scores, zero recognition, and increasing task complaints may be considering leaving
- **Promotion readiness**: Consistently high composite scores + positive peer feedback + strong KPI trends
- **Process bottlenecks**: Which SOPs take longest, which steps get skipped, which departments struggle

## Why This Matters for Growing Businesses

When you're at 20 people, you know everyone. At 100, you can't. At 300, it's impossible.

AI bridges this gap. It gives the founder or CEO the same visibility they had at 20 people — but at scale. Instead of walking the floor and asking "how's it going?", they ask the AI "how's it going?" and get a data-backed answer.

## Getting Started with AI Intelligence

You don't need a data science team. You need a platform that:

1. **Collects data automatically** — KPIs, tasks, reviews, SOPs, kudos
2. **Normalizes it** — composite scores that make different data types comparable
3. **Makes it queryable** — natural language, not SQL
4. **Provides context** — not just numbers, but trends, comparisons, and recommendations

The AI gets smarter as more data flows in. After 3 months, it can spot trends. After 6, it can predict outcomes.
    `.trim(),
    author: "TheywrK Team",
    authorRole: "Product",
    date: "2026-03-05",
    category: "AI & Analytics",
    readTime: "6 min read",
    tags: ["AI", "business intelligence", "analytics", "data-driven decisions"],
  },
  {
    slug: "kpi-tracking-mistakes-growing-businesses",
    title: "7 KPI Tracking Mistakes That Growing Businesses Make (And How to Fix Them)",
    excerpt:
      "Tracking KPIs is easy. Tracking the right KPIs the right way is surprisingly hard. Here are the 7 most common mistakes and practical fixes.",
    content: `
## Mistake 1: Too Many KPIs

If everyone has 15 KPIs, nobody has priorities. The data shows that employees with more than 5 KPIs perform worse on all of them compared to employees with 3–5 focused KPIs.

**Fix:** Each person gets 3–5 KPIs max. If it's important, it gets a KPI. If it doesn't get a KPI, it's either not important or it's someone else's responsibility.

## Mistake 2: KPIs Without Targets

"Increase sales" is not a KPI. "Achieve ₹50L in monthly revenue" is. Without a specific target, you can't score performance.

**Fix:** Every KPI needs a numeric target with a clear timeframe. Auto-scoring requires this — the system calculates achievement as (actual / target) × 100.

## Mistake 3: Annual KPIs Only

Setting KPIs once a year and reviewing them 12 months later is like driving with your eyes closed and checking the map once a year.

**Fix:** Monthly or quarterly KPI cycles. Score them rolling — look at the last 90 days, not just the last quarter.

## Mistake 4: No Cascading

Company goals exist at the top. Individual KPIs exist at the bottom. But there's no connection between them.

**Fix:** Goal cascading. Company target → department target → individual KPI. When the CEO says "grow revenue 30%", that cascades to specific revenue KPIs for each sales rep.

## Mistake 5: KPIs in Spreadsheets

Spreadsheets don't auto-calculate. They don't send alerts. They don't trend over time. They don't integrate with reviews.

**Fix:** A KPI engine that auto-scores, trends, and feeds into composite performance scores. The spreadsheet era is over.

## Mistake 6: Ignoring Leading Indicators

Most businesses only track lagging indicators (revenue, profit, churn). By the time these numbers move, it's too late.

**Fix:** Balance lagging KPIs with leading ones. Task completion rate, SOP compliance, and peer feedback are leading indicators that predict future performance.

## Mistake 7: KPIs Disconnected from Reviews

KPIs live in one system. Reviews live in another. The manager has to manually cross-reference.

**Fix:** Auto-populate review forms with KPI scores. When a manager opens a review, they see the KPI achievement score already calculated. The review becomes a conversation about the data, not a fishing expedition for evidence.

## The KPI Framework That Works

For each role, define:

1. **3–5 KPIs** with numeric targets
2. **Monthly scoring** (automated)
3. **Traffic-light indicators** (Green > 80%, Amber 60–80%, Red < 60%)
4. **Trend tracking** (is this person improving or declining?)
5. **Integration with composite score** (KPI achievement = 30% of total performance)

When KPIs are tracked this way, they become the foundation of a data-driven culture — not just numbers in a spreadsheet that nobody looks at.
    `.trim(),
    author: "TheywrK Team",
    authorRole: "Product",
    date: "2026-02-28",
    category: "KPI Management",
    readTime: "7 min read",
    tags: ["KPI", "goal tracking", "performance management", "metrics"],
  },
];

export function getBlogPost(slug: string): BlogPost | undefined {
  return blogPosts.find((p) => p.slug === slug);
}

export function getBlogPostsByCategory(category: string): BlogPost[] {
  return blogPosts.filter((p) => p.category === category);
}

export function getAllCategories(): string[] {
  return [...new Set(blogPosts.map((p) => p.category))];
}
