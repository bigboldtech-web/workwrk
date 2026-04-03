"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Rocket,
  Users,
  Target,
  BookOpen,
  Star,
  BarChart3,
  Brain,
  Settings,
  Link2,
  ChevronRight,
  Search,
  LayoutDashboard,
  CalendarDays,
  Award,
} from "lucide-react";
import { Input } from "@/components/ui/input";

interface DocSection {
  id: string;
  icon: React.ReactNode;
  color: string;
  title: string;
  description: string;
  articles: {
    title: string;
    content: string;
  }[];
}

const docs: DocSection[] = [
  {
    id: "getting-started",
    icon: <Rocket size={22} />,
    color: "#6C5CE7",
    title: "Getting Started",
    description: "Set up your organization and start using WorkwrK",
    articles: [
      {
        title: "Creating your account",
        content: `**How to create a new account:**

1. Go to [workwrk.com/register](/register) and fill in your organization name, your name, work email, and password (min. 8 characters).
2. After submitting, you'll be automatically logged in and taken to the **Setup Wizard**.
3. The setup wizard walks you through 6 steps:
   - **Business Profile** — Company type (SMB, Enterprise, etc.)
   - **Industry & Use Case** — Select your industry and how you plan to use WorkwrK
   - **Module Priorities** — Choose which modules to enable
   - **Team Size** — Select your team size range
   - **Departments** — Enable/disable default departments or add custom ones
   - **Invite Team** — Add team members by email with their access level

**Note:** You can skip the Invite Team step and add members later from Settings > Team.`,
      },
      {
        title: "How WorkwrK works",
        content: `**WorkwrK is a KRA-centric business operating system.**

The core idea is simple: every employee has **Key Responsible Areas (KRAs)** that define what they're accountable for. Under each KRA, you define **KPIs (Key Performance Indicators)** that measure success.

**The hierarchy:**

- **KRA** — What someone is responsible for (e.g., "Website Management")
- **KPI** — How you measure success (e.g., "99% uptime", "< 2s load time")
- **SOP** — How to do the work (linked to a KRA, e.g., "Server Monitoring Procedure")

**Example:**
- A Tech Engineer's KRA: **"Website Management"**
  - KPI: 99% uptime (measured monthly)
  - KPI: Page load time under 2 seconds
  - SOP: Server Monitoring Procedure
  - SOP: Incident Response Guide

- A Social Media Manager's KRA: **"Community Engagement"**
  - KPI: All comments replied within 24 hours
  - KPI: 10% engagement rate on posts
  - SOP: Social Media Response Guidelines

**Performance Scoring:**
WorkwrK automatically calculates a composite performance score for each employee based on:
- **KPI Achievement** — 40% (how well they hit their KPI targets)
- **Manager Rating** — 25% (from performance reviews)
- **SOP Compliance** — 20% (are they following procedures?)
- **Peer Rating** — 10% (feedback from colleagues)
- **Self Rating** — 5% (self-assessment in reviews)

**Work Calendar:**
Employees use the Work Calendar to log what they're working on each day. Managers can view their team's calendar to see daily activities. Calendar tasks can be linked to KRAs.`,
      },
      {
        title: "Adding team members",
        content: `**There are two ways to add team members:**

**Method 1: Send Invitations (Recommended)**
1. Go to **Settings > Team**
2. Enter the team member's email address
3. Select their access level (Employee, Manager, HR, etc.)
4. Click **Send Invite**
5. They'll receive an email with a link to join
6. They click the link, set their name and password, and they're in!

**Method 2: During Setup**
- In the setup wizard (Step 6), add emails and roles
- Invitations are sent automatically when you complete setup

**Managing Invitations:**
- Pending invitations are shown under Settings > Team
- You can **Cancel** a pending invitation and resend a new one
- Invitations expire after 7 days

**Access Levels:**
| Level | Permissions |
|-------|-------------|
| **Company Admin** | Full access to all settings, users, and data |
| **C-Level** | View all data, manage teams, limited settings |
| **VP / Director** | Manage their department and below |
| **Manager** | Manage their direct reports |
| **Team Lead** | Lead and coordinate within team |
| **Employee** | Access own KRAs, reviews, and assigned SOPs |
| **HR** | Manage people, reviews, and organizational data |`,
      },
      {
        title: "Password reset",
        content: `**If you forget your password:**

1. Go to the [login page](/login)
2. Click **"Forgot password?"** below the password field
3. Enter your email address
4. Check your inbox for a reset link (also check spam)
5. Click the link and set a new password
6. The link expires after 1 hour

**For admins:** You cannot reset other people's passwords through the UI. Contact support if needed.`,
      },
    ],
  },
  {
    id: "dashboard",
    icon: <LayoutDashboard size={22} />,
    color: "#00D68F",
    title: "Dashboard",
    description: "Your daily overview and quick actions",
    articles: [
      {
        title: "Dashboard overview",
        content: `**The Dashboard is your daily command center.**

**What you'll see:**
- **Total People** — Your team size
- **Avg Performance** — Average composite score across top performers
- **Active SOPs** — Number of published SOPs
- **SOP Compliance** — Overall compliance percentage

**Cards:**
- **Top Performers** — Employees with the highest composite scores
- **KPI Updates** — Recent KPI score recordings
- **Alerts** — Important notifications (PIP status, compliance warnings)
- **Recent Activity** — Latest actions across your organization
- **Kudos Feed** — Recent recognition given
- **Department Performance** — Performance comparison by department

**Quick Actions:**
- Use the **+ Quick Add** button in the top bar
- Use **Cmd+K** (Mac) or **Ctrl+K** (Windows) to open global search
- Click the **bell icon** to view notifications

**Note:** Make sure KRA & KPIs module is enabled in Settings > Modules for it to appear in the sidebar.`,
      },
    ],
  },
  {
    id: "people",
    icon: <Users size={22} />,
    color: "#00D68F",
    title: "People Management",
    description: "Manage your team members and profiles",
    articles: [
      {
        title: "Managing employee profiles",
        content: `**Each team member has a detailed profile page.**

**Profile sections:**
- **Basic Info** — Name, email, phone, avatar, department, role
- **Skills** — Self-rated and manager-rated skills
- **Certifications** — Professional certifications with expiry tracking
- **KRAs & KPIs** — Assigned key result areas and their KPIs
- **Reviews** — Performance review history
- **SOPs** — Assigned SOPs and compliance status
- **Check-ins** — Recent mood and progress check-ins
- **Kudos** — Recognition received from peers
- **Performance Score** — Composite score with breakdown

**Editing Profiles:**
- Admins and HR can edit any profile
- Managers can edit their direct reports
- Employees can update their own basic info`,
      },
      {
        title: "Removing & restoring people",
        content: `**Removing a team member:**
1. Go to **People** and find the person
2. Open their profile
3. Click the menu and select **Remove**
4. The person is soft-deleted (not permanently removed)

**Restoring a removed person:**
1. Go to **Settings > Removed People**
2. Find the person in the list
3. Click **Restore** to reactivate their account

**Note:** Removed people can't log in but their data (KRAs, reviews, etc.) is preserved.`,
      },
    ],
  },
  {
    id: "kra-kpi",
    icon: <Target size={22} />,
    color: "#FF6B6B",
    title: "KRAs & KPIs",
    description: "The core of WorkwrK — define responsibilities and measure success",
    articles: [
      {
        title: "Understanding KRAs",
        content: `**KRAs (Key Result Areas) are the foundation of WorkwrK.**

A KRA defines what an employee is responsible for. It's not a task — it's an ongoing area of accountability.

**Good KRA examples:**
- "Website Uptime & Performance" (for a tech engineer)
- "Community Engagement" (for a social media manager)
- "Client Retention" (for an account manager)
- "Order Fulfillment" (for an operations lead)
- "Talent Acquisition" (for an HR recruiter)

**Bad KRA examples (too specific, these are tasks):**
- "Fix the login bug" — This is a task, not a KRA
- "Send weekly report" — This is a task, not a KRA

**Creating a KRA:**
1. Go to **KRA & KPIs** in the sidebar
2. Click **Create KRA**
3. Fill in:
   - **Title** — The responsibility area
   - **Description** — What this KRA covers
   - **Category** — Group related KRAs (e.g., "Technical", "Business")
   - **Role** — Optionally link to a specific role

**Assigning KRAs:**
- Go to the KRA and click **Assign**
- Select employees
- Set the **weight** (how much this KRA contributes to their overall score — all weights should total 100%)
- Set the **period** (e.g., "Q1 2026")`,
      },
      {
        title: "Setting up KPIs",
        content: `**KPIs (Key Performance Indicators) measure success within a KRA.**

Every KRA should have at least one KPI that defines "what does good look like?"

**Creating a KPI:**
1. Go to **KRA & KPIs** in the sidebar
2. Select a KRA
3. Click **Add KPI**
4. Fill in:
   - **Name** — What you're measuring (e.g., "Uptime Percentage")
   - **Type** — Quantitative (numbers) or Qualitative (ratings)
   - **Unit** — Percentage, count, hours, etc.
   - **Frequency** — How often it's measured (Daily, Weekly, Monthly, Quarterly, Annually)
   - **Target Value** — The goal (e.g., 99)
   - **Target Label** — Human-readable target (e.g., "99% uptime")

**Examples:**
| KRA | KPI | Target | Frequency |
|-----|-----|--------|-----------|
| Website Management | Uptime | 99% | Monthly |
| Website Management | Page Load Time | < 2 seconds | Monthly |
| Community Engagement | Comment Reply Rate | 100% within 24hrs | Weekly |
| Client Retention | Renewal Rate | 85% | Quarterly |
| Order Fulfillment | On-Time Delivery | 95% | Monthly |`,
      },
      {
        title: "Recording KPI scores",
        content: `**Recording scores is how performance gets tracked.**

**How to record a KPI score:**
1. Go to **KRA & KPIs**
2. Find the KPI
3. Click **Record Score**
4. Enter:
   - **Period** — Which period this score is for (e.g., "2026-04")
   - **Target Value** — What the target was
   - **Actual Value** — What was achieved
   - **Notes** — Any context or explanation
   - **Evidence** — Link to proof (optional)
5. The system calculates a score automatically

**Score Calculation:**
- Score = (Actual / Target) × 100
- Scores are capped at 120 (to allow exceeding targets)
- These scores feed into the composite performance score (40% weight by default)

**Who records scores?**
- Employees can self-report their KPI actuals
- Managers can record scores for their team
- Scores can be submitted for approval before counting`,
      },
    ],
  },
  {
    id: "work-calendar",
    icon: <CalendarDays size={22} />,
    color: "#FFA726",
    title: "Work Calendar",
    description: "Plan and track daily work activities",
    articles: [
      {
        title: "Using the Work Calendar",
        content: `**The Work Calendar helps employees log what they're doing each day.**

Unlike traditional task management, the Work Calendar is for tracking daily activities — not managing projects. It's a way for team members to show what they're working on and for managers to stay informed.

**Adding a task to the calendar:**
1. Go to **Work Calendar** in the sidebar
2. Click the **+** button on any day, or click **Add Task** at the top
3. Fill in:
   - **Title** — What you're working on
   - **Date** — Which day
   - **Start/End Time** — Optional time range
   - **Link to KRA** — Optionally connect to a KRA (helps show what responsibility this work supports)
   - **Assign to** — Yourself or a team member

**Task statuses:**
| Status | Meaning |
|--------|---------|
| **Planned** | Scheduled for the day |
| **In Progress** | Currently working on it |
| **Completed** | Done |

**Updating status:**
- Hover over a task and click the play button to start it
- Click the check button to mark it complete

**Manager view:**
- Use the dropdown at the top to switch between "My Calendar", "All Team", or a specific person
- This lets managers see what their team is doing on any given day

**Note:** Calendar tasks do NOT affect performance scores. They are purely for visibility and coordination.`,
      },
    ],
  },
  {
    id: "sops",
    icon: <BookOpen size={22} />,
    color: "#26C6DA",
    title: "SOPs",
    description: "Standard Operating Procedures and compliance tracking",
    articles: [
      {
        title: "Creating SOPs",
        content: `**SOPs (Standard Operating Procedures) document how work should be done.**

SOPs can be linked to KRAs — this way, a KRA defines "what" someone is responsible for, and the SOP defines "how" to do it.

**Creating a SOP:**
1. Go to **SOPs** in the sidebar
2. Click **Create SOP**
3. Fill in:
   - **Title** — Name of the procedure
   - **Category** — Group related SOPs (e.g., "Engineering", "Sales")
   - **Link to KRA** — Optionally connect to a KRA
   - **Content** — Step-by-step procedure
   - **Version** — Track changes over time

**SOP Statuses:**
| Status | Meaning |
|--------|---------|
| **Draft** | Being written, not visible to team |
| **In Review** | Under review before publishing |
| **Published** | Active and visible to assigned users |
| **Archived** | No longer active |

**SOP Sections:**
- **All SOPs** — View all SOPs in your organization
- **My SOPs** — SOPs assigned to you
- **Compliance** — Track compliance status across the team`,
      },
      {
        title: "Assigning SOPs & tracking compliance",
        content: `**Assign SOPs to ensure your team follows procedures.**

**Assigning:**
1. Open a SOP
2. Click **Assign**
3. Select team members or an entire department
4. Set a due date for completion
5. Assignees receive an email notification

**How compliance works:**
- Each SOP has steps that must be completed
- Assignees mark steps as done
- Progress is tracked as a percentage
- Compliance scores feed into performance scores (20% weight)

**Overdue reminders:**
- The system sends automatic email reminders for overdue SOP assignments
- Reminders run daily at 9 AM IST
- These reminders are always sent (cannot be disabled by users)

**Compliance in performance scoring:**
- SOP compliance contributes 20% to the composite performance score
- Higher compliance = higher performance score
- This encourages teams to follow documented procedures`,
      },
    ],
  },
  {
    id: "reviews",
    icon: <Star size={22} />,
    color: "#FFCA28",
    title: "Performance Reviews",
    description: "Run review cycles with self, manager, and peer assessments",
    articles: [
      {
        title: "Setting up review cycles",
        content: `**Performance Reviews formally evaluate team members.**

**Creating a Review Cycle:**
1. Go to **Reviews** in the sidebar
2. Click **Create Review Cycle**
3. Fill in:
   - **Name** — e.g., "Q1 2026 Review"
   - **Type** — Quarterly, Annual, Probation, PIP Review
   - **Period** — Start and end dates
   - **Participants** — Select who will be reviewed

**Review Flow:**
1. **Draft** — Set up the review cycle
2. **Launch** — Activate (sends emails to all participants)
3. **Self-Assessment** — Employees rate themselves on each KRA
4. **Manager Review** — Managers review their direct reports
5. **Peer Review** — Optional feedback from colleagues
6. **Calibration** — Leaders align scores across the organization
7. **Finalize** — Complete the cycle and share results

**Emails sent automatically:**
- When a cycle is launched (to all participants)
- When a review is completed (results notification)`,
      },
      {
        title: "Self-assessment & manager reviews",
        content: `**Self-Assessment:**
- Employees rate themselves on each assigned KRA
- Add accomplishments, challenges, and goals for next period
- Submit for manager review

**Manager Review:**
- Review the self-assessment
- Provide manager ratings on each KRA
- Rate behavioral aspects (quality, reliability, collaboration, initiative, growth)
- Add overall feedback and development suggestions
- Recommend an outcome (promotion eligible, hike eligible, PIP, etc.)

**Peer Feedback:**
- Optional 360-degree feedback
- Peers provide ratings and comments
- Feedback can be anonymous (configurable)

**How reviews affect performance scores:**
- Manager rating contributes 25% to the composite score
- Peer rating contributes 10%
- Self rating contributes 5%
- KPI achievement (separate from reviews) contributes 40%
- SOP compliance contributes 20%`,
      },
    ],
  },
  {
    id: "scores",
    icon: <BarChart3 size={22} />,
    color: "#AB47BC",
    title: "Performance Scores & Analytics",
    description: "Understand how performance scoring works",
    articles: [
      {
        title: "How scoring works",
        content: `**WorkwrK calculates a composite performance score for each employee.**

**Score Components:**
| Component | Weight | Source |
|-----------|--------|--------|
| KPI Achievement | 40% | KPI scores vs targets |
| Manager Rating | 25% | Performance review ratings |
| SOP Compliance | 20% | SOP completion rate |
| Peer Rating | 10% | Peer feedback ratings |
| Self Rating | 5% | Self-assessment ratings |

**Weights are configurable** in Settings > General > Scoring Weights.

**Score Bands (default):**
| Band | Score Range |
|------|------------|
| Exceptional | 90-100 |
| Exceeds Expectations | 75-89 |
| Meets Expectations | 60-74 |
| Needs Improvement | 40-59 |
| Unsatisfactory | 0-39 |

**Kudos Bonus:** Receiving kudos adds a small bonus (up to +5 points).

**What does NOT affect scores:**
- Work Calendar tasks — these are for visibility only, not scoring

**Analytics:**
- Go to **Analytics** in the sidebar
- View organization health score
- Compare departments
- Track performance trends over time
- See top performers and most recognized employees`,
      },
    ],
  },
  {
    id: "meetings",
    icon: <CalendarDays size={22} />,
    color: "#29B6F6",
    title: "Meetings",
    description: "Schedule meetings and track action items",
    articles: [
      {
        title: "Managing meetings",
        content: `**Track meetings and their outcomes.**

**Creating a Meeting:**
1. Go to **Meetings** in the sidebar
2. Click **Create Meeting**
3. Fill in:
   - **Title** — Meeting name
   - **Type** — Daily Standup, Weekly Review, 1-on-1, Quarterly Review, etc.
   - **Date & Time** — When it happens
   - **Duration** — How long (in minutes)
   - **Attendees** — Who should attend
   - **Agenda** — What to discuss

**During/After the meeting:**
- Add **Notes** and **Decisions**
- Create **Action Items** — assigned to specific people with deadlines
- Mark attendees as present/absent

**Action Items:**
- Action items can be converted to Work Calendar tasks
- They have their own status tracking (Not Started, In Progress, Completed)
- Managers can track follow-up completion`,
      },
    ],
  },
  {
    id: "kudos",
    icon: <Award size={22} />,
    color: "#FF6B81",
    title: "Kudos & Recognition",
    description: "Recognize team members for great work",
    articles: [
      {
        title: "Giving & receiving kudos",
        content: `**Kudos let you publicly recognize team members.**

**Sending Kudos:**
1. Click **+ Quick Add** from the top bar
2. Or go to the dashboard and use the kudos section
3. Select the recipient
4. Write a message about what they did well
5. Optionally tag a company value (e.g., "Customer First", "Ownership")

**When someone receives kudos:**
- They get an in-app notification
- They receive an email notification (if enabled)
- It appears on the company kudos feed on the dashboard
- It adds a small bonus to their performance score (up to +5 points)

**Kudos are visible:**
- On the dashboard feed
- On individual profile pages
- In the activity log
- In Analytics (Most Recognized leaderboard)`,
      },
    ],
  },
  {
    id: "ai",
    icon: <Brain size={22} />,
    color: "#EC407A",
    title: "AI Assistant",
    description: "Get AI-powered insights about your organization",
    articles: [
      {
        title: "Using the AI Assistant",
        content: `**The AI Assistant helps you understand your organization's data.**

**How to use it:**
1. Click **AI Assistant** in the sidebar
2. Ask questions in natural language, such as:
   - "How is the engineering team performing?"
   - "Who are our top performers?"
   - "Show department breakdown"
   - "What's our SOP compliance status?"
   - "Who should I consider for promotion?"

**The AI analyzes:**
- KRA assignments and KPI achievement
- Team performance and composite scores
- SOP compliance status
- Review cycle results
- Department comparisons
- Recent activity patterns

**Tips for best results:**
- Be specific: "How is Priya performing?" vs "Show performance"
- Ask follow-up questions — the AI remembers context
- Use it for data-driven decisions about promotions, PIPs, and team changes`,
      },
    ],
  },
  {
    id: "integrations",
    icon: <Link2 size={22} />,
    color: "#29B6F6",
    title: "Integrations",
    description: "Connect WorkwrK with external services",
    articles: [
      {
        title: "Webhooks",
        content: `**Webhooks notify external services when events happen in WorkwrK.**

**Setting up webhooks:**
1. Go to **Integrations** in the sidebar
2. Click **Add Integration**
3. Enter your webhook URL
4. Select which events to listen for

**Available events:**
- user_invited — When a team member is invited
- kra_assigned — When a KRA is assigned
- kpi_recorded — When a KPI score is recorded
- review_completed — When a review is finalized
- sop_completed — When an SOP assignment is completed
- kudos_given — When kudos are sent

**Webhook payload** includes the event type and relevant data in JSON format.`,
      },
    ],
  },
  {
    id: "settings",
    icon: <Settings size={22} />,
    color: "#78909C",
    title: "Settings & Administration",
    description: "Configure your organization and manage access",
    articles: [
      {
        title: "Settings overview",
        content: `**Settings is where you configure everything about your organization.**

**Tabs:**

| Tab | What it does |
|-----|-------------|
| **General** | Organization name, timezone, currency, fiscal year, review frequency, scoring weights and bands |
| **Modules** | Enable/disable features — disabled modules hide from the sidebar |
| **Team** | Invite new members, cancel pending invitations |
| **Security** | Password policy, session timeout, 2FA settings |
| **Notifications** | Company-wide email toggles and personal email preferences |
| **Removed People** | View and restore soft-deleted team members |
| **Billing** | Current plan, usage metrics, upgrade options |
| **Data** | Export all data as CSV, danger zone (delete organization) |`,
      },
      {
        title: "Email notifications",
        content: `**WorkwrK sends emails for important events.**

**Emails that are always sent (cannot be disabled):**
- Invitation emails
- Password reset emails
- Overdue SOP reminders

**Emails configurable per user (Settings > Notifications):**
- KRA assignment notifications
- Review cycle notifications
- SOP assignment notifications
- Kudos/recognition notifications

**How to manage preferences:**
1. Go to **Settings > Notifications**
2. Toggle individual email categories on/off
3. Changes apply to the logged-in user`,
      },
      {
        title: "Plans & billing",
        content: `**WorkwrK has four plans:**

| Plan | Users | SOPs | AI Queries | Key Features |
|------|-------|------|------------|--------------|
| **Starter** | Up to 10 | 10 | 50/month | Basic features |
| **Growth** | Up to 50 | 50 | 200/month | All modules |
| **Scale** | Up to 200 | Unlimited | 1000/month | Priority support |
| **Enterprise** | Unlimited | Unlimited | Unlimited | Custom, SSO, API |

**To upgrade:** Contact support@workwrk.com or click Upgrade in the Billing tab.`,
      },
    ],
  },
];

export default function DocsPage() {
  const [selectedSection, setSelectedSection] = useState<string>("getting-started");
  const [selectedArticle, setSelectedArticle] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState("");

  const currentSection = docs.find((d) => d.id === selectedSection) || docs[0];
  const currentArticle = currentSection.articles[selectedArticle] || currentSection.articles[0];

  const filteredDocs = searchQuery
    ? docs
        .map((section) => ({
          ...section,
          articles: section.articles.filter(
            (a) =>
              a.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
              a.content.toLowerCase().includes(searchQuery.toLowerCase())
          ),
        }))
        .filter((section) => section.articles.length > 0)
    : docs;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Documentation</h1>
        <p className="text-muted">Learn how to use every feature in WorkwrK</p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={18} />
        <Input
          placeholder="Search documentation..."
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            if (e.target.value) {
              const first = docs
                .map((s) => ({
                  ...s,
                  articles: s.articles.filter(
                    (a) =>
                      a.title.toLowerCase().includes(e.target.value.toLowerCase()) ||
                      a.content.toLowerCase().includes(e.target.value.toLowerCase())
                  ),
                }))
                .find((s) => s.articles.length > 0);
              if (first) {
                setSelectedSection(first.id);
                setSelectedArticle(0);
              }
            }
          }}
          className="pl-10"
        />
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* Sidebar */}
        <div className="col-span-3 space-y-1">
          {filteredDocs.map((section) => (
            <div key={section.id}>
              <button
                onClick={() => {
                  setSelectedSection(section.id);
                  setSelectedArticle(0);
                }}
                className={`w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-left transition-colors ${
                  selectedSection === section.id
                    ? "bg-purple-500/10 text-purple-400"
                    : "text-muted hover:bg-surface-2 hover:text-foreground"
                }`}
              >
                <span style={{ color: section.color }}>{section.icon}</span>
                <span className="truncate">{section.title}</span>
              </button>
              {selectedSection === section.id && (
                <div className="ml-8 mt-1 space-y-0.5">
                  {section.articles.map((article, idx) => (
                    <button
                      key={idx}
                      onClick={() => setSelectedArticle(idx)}
                      className={`w-full text-left text-xs rounded px-2 py-1.5 transition-colors ${
                        selectedArticle === idx
                          ? "text-purple-300 bg-purple-500/5"
                          : "text-muted-2 hover:text-muted"
                      }`}
                    >
                      {article.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Content */}
        <div className="col-span-9">
          <Card className="border-border bg-surface">
            <CardContent className="p-8">
              <div className="flex items-center gap-2 text-xs text-muted-2 mb-4">
                <span style={{ color: currentSection.color }}>{currentSection.icon}</span>
                <span>{currentSection.title}</span>
                <ChevronRight size={12} />
                <span className="text-muted">{currentArticle.title}</span>
              </div>
              <h2 className="text-xl font-semibold mb-6">{currentArticle.title}</h2>
              <div className="prose prose-invert prose-sm max-w-none">
                {currentArticle.content.split("\n").map((line, i) => {
                  if (line.startsWith("**") && line.endsWith("**")) {
                    return (
                      <h3 key={i} className="text-base font-semibold text-foreground mt-6 mb-3">
                        {line.replace(/\*\*/g, "")}
                      </h3>
                    );
                  }
                  if (line.startsWith("|") && line.includes("|")) {
                    const cells = line.split("|").filter((c) => c.trim()).map((c) => c.trim());
                    if (cells.every((c) => c.match(/^[-:]+$/))) return null;
                    const isHeader = i > 0 && currentArticle.content.split("\n")[i + 1]?.match(/^\|[\s-:|]+\|$/);
                    return (
                      <div key={i} className="flex border-b border-border text-sm">
                        {cells.map((cell, j) => (
                          <div key={j} className={`flex-1 px-3 py-2 ${isHeader ? "font-semibold text-foreground" : "text-muted"}`}>
                            {cell.replace(/\*\*/g, "")}
                          </div>
                        ))}
                      </div>
                    );
                  }
                  if (line.match(/^\d+\.\s/)) {
                    return (
                      <div key={i} className="flex gap-2 text-sm text-muted ml-2 mb-1">
                        <span className="text-purple-400 font-mono text-xs mt-0.5">{line.match(/^(\d+)\./)?.[1]}.</span>
                        <span dangerouslySetInnerHTML={{
                          __html: line.replace(/^\d+\.\s/, "")
                            .replace(/\*\*(.+?)\*\*/g, '<strong class="text-foreground">$1</strong>')
                            .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" class="text-purple-400 hover:text-purple-300">$1</a>'),
                        }} />
                      </div>
                    );
                  }
                  if (line.startsWith("- ") || line.startsWith("   - ")) {
                    const indent = line.startsWith("   - ");
                    return (
                      <div key={i} className={`flex gap-2 text-sm text-muted mb-1 ${indent ? "ml-6" : "ml-2"}`}>
                        <span className="text-purple-400 mt-1.5"><div className="w-1 h-1 rounded-full bg-current" /></span>
                        <span dangerouslySetInnerHTML={{
                          __html: line.replace(/^-\s+/, "").replace(/^\s+-\s+/, "")
                            .replace(/\*\*(.+?)\*\*/g, '<strong class="text-foreground">$1</strong>')
                            .replace(/`(.+?)`/g, '<code class="text-purple-300 bg-purple-500/10 px-1 rounded text-xs">$1</code>'),
                        }} />
                      </div>
                    );
                  }
                  if (line.trim()) {
                    return (
                      <p key={i} className="text-sm text-muted mb-3 leading-relaxed" dangerouslySetInnerHTML={{
                        __html: line
                          .replace(/\*\*(.+?)\*\*/g, '<strong class="text-foreground">$1</strong>')
                          .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" class="text-purple-400 hover:text-purple-300">$1</a>')
                          .replace(/`(.+?)`/g, '<code class="text-purple-300 bg-purple-500/10 px-1 rounded text-xs">$1</code>'),
                      }} />
                    );
                  }
                  return null;
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
