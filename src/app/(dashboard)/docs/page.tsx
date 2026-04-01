"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Rocket,
  Users,
  Target,
  CheckSquare,
  BookOpen,
  Star,
  BarChart3,
  Brain,
  Settings,
  Link2,
  Bell,
  Shield,
  Mail,
  ChevronRight,
  Search,
  Building2,
  UserPlus,
  LayoutDashboard,
  Calendar,
  Award,
  FileText,
  Zap,
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
    description: "Set up your organization and start using TheywrK",
    articles: [
      {
        title: "Creating your account",
        content: `**How to create a new account:**

1. Go to [theywrk.com/register](/register) and fill in your organization name, your name, work email, and password (min. 8 characters).
2. After submitting, you'll be automatically logged in and taken to the **Setup Wizard**.
3. The setup wizard walks you through 6 steps:
   - **Business Profile** — Company name and basic info
   - **Industry & Use Case** — Select your industry and how you plan to use TheywrK
   - **Module Priorities** — Choose which modules to enable (Tasks, Reviews, SOPs, etc.)
   - **Team Size** — Select your team size range
   - **Departments** — Enable/disable default departments or add custom ones
   - **Invite Team** — Add team members by email with their access level

**Note:** You can skip the Invite Team step and add members later from Settings > Team.`,
      },
      {
        title: "Setting up your organization",
        content: `**After completing the setup wizard, configure your organization in Settings > General:**

- **Company Name & Details** — Update your organization name and info
- **Timezone** — Set your company timezone (used for reminders and deadlines)
- **Currency** — Set default currency for any financial data
- **Fiscal Year Start** — Configure when your fiscal year begins
- **Review Frequency** — Set how often performance reviews happen (Quarterly, Semi-Annual, Annual)
- **Scoring Weights** — Configure how composite performance scores are calculated:
  - KPI Weight (default 40%)
  - Task Weight (default 25%)
  - Review Weight (default 25%)
  - SOP Weight (default 10%)
- **Score Bands** — Define performance bands (Exceptional, Exceeds Expectations, Meets Expectations, etc.)

**Modules:** Go to Settings > Modules to enable/disable features. Disabled modules are hidden from the sidebar.`,
      },
      {
        title: "Adding team members",
        content: `**There are two ways to add team members:**

**Method 1: Send Invitations (Recommended)**
1. Go to **Settings > Team**
2. Enter the team member's email address
3. Select their access level (Employee, Manager, HR, etc.)
4. Click **Send Invite**
5. They'll receive an email with a link to join your organization
6. They click the link, set their name and password, and they're in!

**Method 2: Add from People page**
1. Go to **People** in the sidebar
2. Click **Add Person**
3. Fill in their details manually

**Managing Invitations:**
- Pending invitations are shown under Settings > Team
- You can **Cancel** a pending invitation and resend a new one
- Invitations expire after 7 days
- If an invitation expires, simply send a new one

**Access Levels:**
| Level | Permissions |
|-------|-------------|
| **Company Admin** | Full access to all settings, users, and data |
| **C-Level** | View all data, manage teams, limited settings |
| **VP / Director** | Manage their department and below |
| **Manager** | Manage their direct reports |
| **Team Lead** | Lead tasks and coordinate within team |
| **Employee** | Access own tasks, reviews, and assigned SOPs |
| **HR** | Manage people, reviews, and organizational data |`,
      },
      {
        title: "Configuring departments & roles",
        content: `**Departments** help you organize your team and filter data.

**Managing Departments:**
1. Go to **Organization** in the sidebar
2. View all departments with member counts
3. Click a department to see its members and details
4. Add new departments or edit existing ones

**Default Departments** (created during setup):
- Engineering, Sales, Marketing, Operations, HR, Finance

**Roles** define job titles within departments:
- Each role has a title and access level
- Assign roles to team members from their profile
- Roles help with reporting and hierarchy

**Department Heads:**
- Assign a department head from the department settings
- Department heads can manage their team members`,
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
- **Welcome banner** with your name and today's date
- **Quick stats** — Total tasks, pending reviews, active SOPs, team size
- **My Tasks** — Your assigned tasks with status and priority
- **Recent Activity** — Latest actions across your organization
- **Upcoming Deadlines** — Tasks and SOPs due soon
- **Team Performance** — Quick performance snapshot (if you're a manager)

**Quick Actions:**
- Use the **+ Quick Add** button in the top bar to quickly create tasks, SOPs, or send kudos
- Use **Cmd+K** (Mac) or **Ctrl+K** (Windows) to open the global search
- Click the **bell icon** to view notifications`,
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
- **KRAs & KPIs** — Assigned key result areas and performance indicators
- **Tasks** — Active and completed tasks
- **Reviews** — Performance review history
- **SOPs** — Assigned SOPs and compliance status
- **Activity** — Recent actions and contributions
- **Kudos** — Recognition received from peers

**Editing Profiles:**
- Click on a person's name from the People list
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

**Note:** Removed people can't log in but their data (tasks, reviews, etc.) is preserved.`,
      },
    ],
  },
  {
    id: "kra-kpi",
    icon: <Target size={22} />,
    color: "#FF6B6B",
    title: "KRAs & KPIs",
    description: "Set and track key result areas and performance indicators",
    articles: [
      {
        title: "Setting up KRAs",
        content: `**KRAs (Key Result Areas) define what an employee is responsible for.**

**Creating a KRA:**
1. Go to **KRA & KPIs** in the sidebar
2. Click **Create KRA**
3. Fill in:
   - **Title** — e.g., "Revenue Growth", "Customer Satisfaction"
   - **Description** — What this KRA covers
   - **Weight** — How much this KRA contributes to overall performance (all weights should add to 100%)
4. Save the KRA

**Assigning KRAs:**
- Assign KRAs to individual employees or entire departments
- Each assignment can have custom targets and deadlines
- Employees can see their assigned KRAs on their profile`,
      },
      {
        title: "Creating KPIs & tracking scores",
        content: `**KPIs (Key Performance Indicators) are measurable metrics under each KRA.**

**Creating a KPI:**
1. Select a KRA
2. Click **Add KPI**
3. Fill in:
   - **Name** — e.g., "Monthly Revenue", "NPS Score"
   - **Target** — The goal value
   - **Unit** — Percentage, number, currency, etc.
   - **Frequency** — How often it's measured

**Recording KPI Scores:**
- Go to the KPI and click **Record Score**
- Enter the actual value achieved
- The system automatically calculates achievement percentage
- Scores feed into the composite performance score`,
      },
    ],
  },
  {
    id: "tasks",
    icon: <CheckSquare size={22} />,
    color: "#FFA726",
    title: "Tasks",
    description: "Create, assign, and track tasks",
    articles: [
      {
        title: "Creating & assigning tasks",
        content: `**Tasks help you track work items and to-dos.**

**Creating a Task:**
1. Go to **Tasks** in the sidebar
2. Click **Create Task** or use **+ Quick Add > Task**
3. Fill in:
   - **Title** — What needs to be done
   - **Description** — Details and context
   - **Assignee** — Who will do it
   - **Priority** — P0 (Critical), P1 (High), P2 (Medium), P3 (Low)
   - **Deadline** — When it's due
   - **Tags** — Optional labels for organization

**The assignee receives:**
- An in-app notification
- An email notification (if enabled in their preferences)

**Task Statuses:**
| Status | Meaning |
|--------|---------|
| **To Do** | Not started |
| **In Progress** | Actively being worked on |
| **In Review** | Waiting for review/approval |
| **Completed** | Done |
| **Cancelled** | No longer needed |`,
      },
      {
        title: "Task comments & collaboration",
        content: `**Each task has a comments section for discussion.**

- Click on a task to open its detail view
- Add comments to provide updates, ask questions, or share files
- All team members assigned to or watching the task can see comments
- Comments show timestamps and who wrote them

**Task Overdue Reminders:**
- The system automatically sends email reminders for overdue tasks (daily at 9 AM IST)
- Reminders include how many days the task is overdue
- Reminders are always sent regardless of notification preferences`,
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
        content: `**SOPs (Standard Operating Procedures) document your processes.**

**Creating a SOP:**
1. Go to **SOPs** in the sidebar
2. Click **Create SOP**
3. Fill in:
   - **Title** — Name of the procedure
   - **Category** — Group related SOPs
   - **Content** — Step-by-step procedure (supports rich text)
   - **Version** — Track changes over time

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
3. Select team members or departments
4. Set a due date for completion
5. Assignees receive an email notification

**Compliance Tracking:**
- View compliance status from SOPs > Compliance
- See who has completed, who is pending, and who is overdue
- Overdue SOP assignments trigger automatic email reminders
- Compliance rates feed into performance scores`,
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
        content: `**Performance Reviews allow you to formally evaluate team members.**

**Creating a Review Cycle:**
1. Go to **Reviews** in the sidebar
2. Click **Create Review Cycle**
3. Fill in:
   - **Name** — e.g., "Q1 2026 Review"
   - **Period** — Start and end dates
   - **Participants** — Select who will be reviewed
   - **Reviewers** — Assign managers and peers

**Review Flow:**
1. **Draft** — Set up the review cycle
2. **Launch** — Activate the cycle (sends emails to all participants)
3. **Self-Assessment** — Employees complete their self-review
4. **Manager Review** — Managers review their direct reports
5. **Peer Review** — Optional peer feedback
6. **Finalize** — Complete the cycle and share results

**Emails sent automatically:**
- When a cycle is launched (to all participants)
- When a review is completed (results notification)`,
      },
      {
        title: "Self-assessment & manager reviews",
        content: `**Self-Assessment:**
- Employees rate themselves on each KRA/KPI
- Add accomplishments, challenges, and goals
- Submit for manager review

**Manager Review:**
- Review the self-assessment
- Provide manager ratings and comments
- Add overall feedback and development suggestions
- Finalize the review

**Peer Feedback:**
- Optional 360-degree feedback
- Peers provide ratings and comments
- Feedback can be anonymous or named (configurable)

**Review Scores:**
- Reviews contribute to the composite performance score
- Weight is configurable in Settings > General (default 25%)`,
      },
    ],
  },
  {
    id: "scores",
    icon: <BarChart3 size={22} />,
    color: "#AB47BC",
    title: "Composite Scores & Analytics",
    description: "Understand how performance scoring works",
    articles: [
      {
        title: "How scoring works",
        content: `**TheywrK calculates a composite performance score for each employee.**

**Score Components:**
| Component | Default Weight | Source |
|-----------|---------------|--------|
| KPI Achievement | 40% | KPI scores vs targets |
| Task Completion | 25% | Task completion rate and timeliness |
| Review Score | 25% | Performance review ratings |
| SOP Compliance | 10% | SOP completion rate |

**Weights are configurable** in Settings > General > Scoring Weights.

**Score Bands (default):**
| Band | Score Range |
|------|------------|
| Exceptional | 90-100 |
| Exceeds Expectations | 75-89 |
| Meets Expectations | 60-74 |
| Needs Improvement | 40-59 |
| Unsatisfactory | 0-39 |

**Kudos Bonus:** Receiving kudos adds a small bonus to the score.

**Analytics:**
- Go to **Analytics** in the sidebar
- View team-wide performance trends
- Compare departments and individuals
- Export data for reporting`,
      },
    ],
  },
  {
    id: "meetings",
    icon: <Calendar size={22} />,
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
   - **Date & Time** — When it happens
   - **Attendees** — Who should attend
   - **Agenda** — What to discuss
   - **Notes** — Meeting minutes (can be added during/after)

**Action Items:**
- Add action items during meetings
- Assign them to specific people with deadlines
- Track follow-up completion`,
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
1. Click **+ Quick Add > Kudos** from the top bar
2. Or go to the dashboard and use the kudos widget
3. Select the recipient
4. Write a message about what they did well
5. Optionally tag a company value

**When someone receives kudos:**
- They get an in-app notification
- They receive an email notification (if enabled)
- It appears on the company kudos feed
- It contributes a small bonus to their performance score

**Kudos can be viewed:**
- On the dashboard feed
- On individual profile pages
- In the activity log`,
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
   - "Which tasks are overdue?"
   - "Summarize recent review scores"
   - "What are the top priorities this week?"

**The AI can analyze:**
- Task completion rates and trends
- Team performance and KPI achievement
- SOP compliance status
- Review cycle results
- Activity patterns

**Note:** The AI Assistant requires an Anthropic API key to be configured. Without it, the feature will show a fallback message.`,
      },
    ],
  },
  {
    id: "integrations",
    icon: <Link2 size={22} />,
    color: "#29B6F6",
    title: "Integrations",
    description: "Connect TheywrK with external services",
    articles: [
      {
        title: "Webhooks",
        content: `**Webhooks notify external services when events happen in TheywrK.**

**Setting up webhooks:**
1. Go to **Integrations** in the sidebar
2. Click **Add Integration**
3. Enter your webhook URL
4. Select which events to listen for

**Available events:**
- \`user_invited\` — When a team member is invited
- \`task_created\` — When a new task is created
- \`task_completed\` — When a task is completed
- \`review_completed\` — When a review is finalized
- \`kudos_given\` — When kudos are sent

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
| **Modules** | Enable/disable features (People, Tasks, SOPs, Reviews, etc.) — disabled modules hide from sidebar |
| **Team** | Invite new members, manage pending invitations, view team size |
| **Security** | Password policy, session timeout, 2FA settings |
| **Notifications** | Company-wide email notification toggles and personal email preferences |
| **Removed People** | View and restore soft-deleted team members |
| **Billing** | Current plan, usage metrics, upgrade options |
| **Data** | Export all data as CSV, danger zone (delete organization) |`,
      },
      {
        title: "Email notifications",
        content: `**TheywrK sends emails for important events.**

**Emails that are always sent (cannot be disabled):**
- Invitation emails (when inviting team members)
- Password reset emails
- Overdue task/SOP reminders

**Emails configurable per user (Settings > Notifications):**
- Task assignment notifications
- Review cycle notifications
- SOP assignment notifications
- Kudos/recognition notifications

**How to manage preferences:**
1. Go to **Settings > Notifications**
2. Toggle individual email categories on/off
3. Changes apply to the logged-in user

**Company-wide defaults** can be set by admins at the top of the Notifications tab.`,
      },
      {
        title: "Security settings",
        content: `**Configure password and security policies.**

**Password Policy:**
- Minimum password length
- Require uppercase letters
- Require numbers
- Require special characters

**Session Settings:**
- Session timeout duration
- Two-factor authentication (when available)

**Password Reset:**
- Users can reset their password from the login page
- Click "Forgot password?" to receive a reset email
- Reset links expire after 1 hour
- Each reset link can only be used once`,
      },
      {
        title: "Plans & billing",
        content: `**TheywrK has four plans:**

| Plan | Users | SOPs | AI Queries | Key Features |
|------|-------|------|------------|--------------|
| **Starter** | Up to 10 | 10 | 50/month | Basic features |
| **Growth** | Up to 50 | 50 | 200/month | All modules |
| **Scale** | Up to 200 | Unlimited | 1000/month | Priority support |
| **Enterprise** | Unlimited | Unlimited | Unlimited | Custom, SSO, API |

**Usage Metrics** are shown in Settings > Billing:
- Current user count vs limit
- Active SOPs vs limit
- AI queries used this month vs limit

**To upgrade:** Contact support@theywrk.com or click Upgrade in the Billing tab.`,
      },
      {
        title: "Exporting data",
        content: `**Export all your organization data.**

1. Go to **Settings > Data**
2. Click **Export All Data**
3. A CSV file is generated with all your organization data including:
   - People and profiles
   - Tasks and completion status
   - KRAs and KPI scores
   - SOPs and compliance records
   - Review data
   - Activity logs

**Individual exports** are also available:
- Export tasks from the Tasks page
- Export people from the People page
- Export review data from individual review cycles

**Deleting Organization:**
- The Data tab has a "Danger Zone" section
- Type your organization name to confirm deletion
- This permanently deletes all data and cannot be undone`,
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
        <p className="text-[#8888A0]">Learn how to use every feature in TheywrK</p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8888A0]" size={18} />
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
                    : "text-[#8888A0] hover:bg-[#1A1A26] hover:text-[#E8E8F0]"
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
                          : "text-[#6B6B80] hover:text-[#8888A0]"
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
          <Card className="border-[#2A2A3A] bg-[#12121A]">
            <CardContent className="p-8">
              <div className="flex items-center gap-2 text-xs text-[#6B6B80] mb-4">
                <span style={{ color: currentSection.color }}>{currentSection.icon}</span>
                <span>{currentSection.title}</span>
                <ChevronRight size={12} />
                <span className="text-[#8888A0]">{currentArticle.title}</span>
              </div>
              <h2 className="text-xl font-semibold mb-6">{currentArticle.title}</h2>
              <div className="prose prose-invert prose-sm max-w-none">
                {currentArticle.content.split("\n").map((line, i) => {
                  // Handle headers
                  if (line.startsWith("**") && line.endsWith("**")) {
                    return (
                      <h3 key={i} className="text-base font-semibold text-[#E8E8F0] mt-6 mb-3">
                        {line.replace(/\*\*/g, "")}
                      </h3>
                    );
                  }

                  // Handle table rows
                  if (line.startsWith("|") && line.includes("|")) {
                    const cells = line
                      .split("|")
                      .filter((c) => c.trim())
                      .map((c) => c.trim());
                    if (cells.every((c) => c.match(/^[-:]+$/))) return null; // separator row
                    const isHeader = i > 0 && currentArticle.content.split("\n")[i + 1]?.match(/^\|[\s-:|]+\|$/);
                    return (
                      <div key={i} className="flex border-b border-[#2A2A3A] text-sm">
                        {cells.map((cell, j) => (
                          <div
                            key={j}
                            className={`flex-1 px-3 py-2 ${
                              isHeader ? "font-semibold text-[#E8E8F0]" : "text-[#8888A0]"
                            }`}
                          >
                            {cell.replace(/\*\*/g, "")}
                          </div>
                        ))}
                      </div>
                    );
                  }

                  // Handle numbered lists
                  if (line.match(/^\d+\.\s/)) {
                    return (
                      <div key={i} className="flex gap-2 text-sm text-[#8888A0] ml-2 mb-1">
                        <span className="text-purple-400 font-mono text-xs mt-0.5">
                          {line.match(/^(\d+)\./)?.[1]}.
                        </span>
                        <span
                          dangerouslySetInnerHTML={{
                            __html: line
                              .replace(/^\d+\.\s/, "")
                              .replace(
                                /\*\*(.+?)\*\*/g,
                                '<strong class="text-[#E8E8F0]">$1</strong>'
                              )
                              .replace(
                                /\[(.+?)\]\((.+?)\)/g,
                                '<a href="$2" class="text-purple-400 hover:text-purple-300">$1</a>'
                              ),
                          }}
                        />
                      </div>
                    );
                  }

                  // Handle bullet points
                  if (line.startsWith("- ") || line.startsWith("   - ")) {
                    const indent = line.startsWith("   - ");
                    return (
                      <div
                        key={i}
                        className={`flex gap-2 text-sm text-[#8888A0] mb-1 ${indent ? "ml-6" : "ml-2"}`}
                      >
                        <span className="text-purple-400 mt-1.5">
                          <div className="w-1 h-1 rounded-full bg-current" />
                        </span>
                        <span
                          dangerouslySetInnerHTML={{
                            __html: line
                              .replace(/^-\s+/, "")
                              .replace(/^\s+-\s+/, "")
                              .replace(
                                /\*\*(.+?)\*\*/g,
                                '<strong class="text-[#E8E8F0]">$1</strong>'
                              )
                              .replace(
                                /`(.+?)`/g,
                                '<code class="text-purple-300 bg-purple-500/10 px-1 rounded text-xs">$1</code>'
                              ),
                          }}
                        />
                      </div>
                    );
                  }

                  // Handle paragraphs with bold and links
                  if (line.trim()) {
                    return (
                      <p
                        key={i}
                        className="text-sm text-[#8888A0] mb-3 leading-relaxed"
                        dangerouslySetInnerHTML={{
                          __html: line
                            .replace(
                              /\*\*(.+?)\*\*/g,
                              '<strong class="text-[#E8E8F0]">$1</strong>'
                            )
                            .replace(
                              /\[(.+?)\]\((.+?)\)/g,
                              '<a href="$2" class="text-purple-400 hover:text-purple-300">$1</a>'
                            )
                            .replace(
                              /`(.+?)`/g,
                              '<code class="text-purple-300 bg-purple-500/10 px-1 rounded text-xs">$1</code>'
                            ),
                        }}
                      />
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
