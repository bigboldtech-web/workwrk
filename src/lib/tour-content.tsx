import {
  Sparkles, Building2, Users, Target, BookOpen, Lock,
  CheckSquare, BarChart3, Package, Award, FileText, Megaphone,
  Lightbulb, Crosshair, Settings, User, TrendingUp,
} from "lucide-react";
import type { TourStep } from "@/components/product-tour";

// ========================================
// ADMIN TOUR — for the person who set up the org
// ========================================
export const ADMIN_TOUR_STEPS: TourStep[] = [
  {
    title: "Welcome to WorkwrK 👋",
    description: "WorkwrK is your business operating system — it brings People, KRAs/KPIs, SOPs, Reviews, OKRs, Assets, Policies and AI into one place. Let's get you set up so your team can start using it today. This tour takes about 3 minutes.",
    icon: <Sparkles size={24} />,
    highlight: "You're set as Company Admin, so you have full access to everything.",
  },
  {
    title: "Step 1 — Set up your Company Profile",
    description: "The Organization page is where you describe your company. Add your mission, vision, values, and a description of what you do. The AI uses this context for everything — generating better KRAs, KPIs, and aligning the system to your business.",
    icon: <Building2 size={24} />,
    navigateTo: "/organization",
    actionLabel: "Open Organization",
    highlight: "Hit the 'AI Assist' button on the Organization page to auto-generate a strong profile from just your company name and website.",
  },
  {
    title: "Step 2 — Invite your team",
    description: "Add the people who'll use WorkwrK. Go to Settings → Team and either invite by email or paste a list. Each person gets an access level — Employee, Team Lead, Manager, HR, or Admin. You can change roles later.",
    icon: <Users size={24} />,
    navigateTo: "/settings",
    actionLabel: "Open Team Settings",
    highlight: "Promote anyone to 'Company Admin' to give them full system control — useful for HR or co-founders.",
  },
  {
    title: "Step 3 — Configure Access Control",
    description: "WorkwrK has a granular permission matrix. You decide what each role can do across every module — from creating SOPs to deleting people. Defaults are sensible but you can lock anything down. Find it under Settings → Access Control.",
    icon: <Lock size={24} />,
    navigateTo: "/settings",
    actionLabel: "Open Access Control",
    highlight: "Only Company Admin can edit access control — your control center for permissions.",
  },
  {
    title: "Step 4 — Create KRAs & KPIs (with AI)",
    description: "KRAs are Key Result Areas — what each role is accountable for. KPIs are how you measure them. Click 'Create with AI' on the KRA & KPIs page, type a job role, and AI generates 5 KRAs with 3 KPIs each — fully editable.",
    icon: <Target size={24} />,
    navigateTo: "/kra-kpi",
    actionLabel: "Open KRA & KPIs",
    highlight: "AI uses your company profile from Step 1 to make KRAs specific to your business — not generic templates.",
  },
  {
    title: "Step 5 — Document your processes (SOPs)",
    description: "SOPs are step-by-step playbooks for how things get done. WorkwrK supports written SOPs, step-by-step checklists, recorded SOPs (via the browser extension), and approval flows. Use AI to generate a first draft, then refine.",
    icon: <BookOpen size={24} />,
    navigateTo: "/sops",
    actionLabel: "Open SOPs",
    highlight: "Assign SOPs to specific people. Compliance is tracked automatically and feeds into their performance score.",
  },
  {
    title: "Step 6 — Set OKRs and goals",
    description: "OKRs are how you align everyone to bigger goals. Create company-wide OKRs, team OKRs, or individual OKRs. Each Objective has Key Results that are measured with check-ins. They roll up into a quarterly view.",
    icon: <Crosshair size={24} />,
    navigateTo: "/okrs",
    actionLabel: "Open OKRs",
  },
  {
    title: "Step 7 — Manage Assets",
    description: "Track laptops, phones, monitors, ID cards, vehicles — anything you give to employees. Each asset has a serial/IMEI, condition, purchase date, warranty. Assign them to people during onboarding, collect them back during offboarding.",
    icon: <Package size={24} />,
    navigateTo: "/assets",
    actionLabel: "Open Assets",
  },
  {
    title: "Step 8 — Publish Policies & Announcements",
    description: "Use Policies for HR documents, code of conduct, leave rules — employees can acknowledge them and you track compliance. Use Announcements for time-sensitive updates that show on everyone's dashboard.",
    icon: <FileText size={24} />,
    navigateTo: "/policies",
    actionLabel: "Open Policies",
  },
  {
    title: "You're all set! 🎉",
    description: "That's the core setup. There's much more: Reviews, Analytics, Ideas Board, Surveys, Talent Grid, Tools & Credentials, Onboarding workflows. Explore at your own pace, or click the Help icon at any time to re-launch this tour.",
    icon: <CheckSquare size={24} />,
    actionLabel: "Start using WorkwrK",
    highlight: "Pro tip: The AI Assistant (sidebar) can answer questions about your business — try asking 'Who are my top performers this quarter?'",
  },
];

// ========================================
// NEW EMPLOYEE TOUR — for invited team members
// ========================================
export const EMPLOYEE_TOUR_STEPS: TourStep[] = [
  {
    title: "Welcome to WorkwrK 👋",
    description: "WorkwrK is where your team manages people, performance, processes, and goals — all in one place. This 2-minute tour will show you what you can do and where to find things.",
    icon: <Sparkles size={24} />,
  },
  {
    title: "Your Dashboard",
    description: "The dashboard is your home. You'll see announcements from your team, your tasks, your KRAs, recent kudos, and quick stats. Anything important shows up here first.",
    icon: <BarChart3 size={24} />,
    navigateTo: "/dashboard",
    actionLabel: "Open Dashboard",
  },
  {
    title: "Your KRAs & KPIs",
    description: "These are the metrics you're measured on. View your assigned KRAs, record monthly KPI values, and see how you're tracking against your targets.",
    icon: <Target size={24} />,
    navigateTo: "/kra-kpi",
    actionLabel: "Open KRAs",
    highlight: "Update your KPIs regularly — they feed into your composite performance score.",
  },
  {
    title: "Your Tasks & Calendar",
    description: "Manage your day-to-day work. Create tasks, set priorities, mark them done. The calendar view shows what's due when. Tasks tie into KRAs and OKRs.",
    icon: <CheckSquare size={24} />,
    navigateTo: "/tasks",
    actionLabel: "Open Tasks",
  },
  {
    title: "SOPs assigned to you",
    description: "Standard Operating Procedures — step-by-step guides for how to do things in your role. Complete them at your own pace; your progress is tracked.",
    icon: <BookOpen size={24} />,
    navigateTo: "/sops",
    actionLabel: "Open SOPs",
  },
  {
    title: "Policies to acknowledge",
    description: "Company policies and HR documents are here. Some require acknowledgment — make sure to read and acknowledge them.",
    icon: <FileText size={24} />,
    navigateTo: "/policies",
    actionLabel: "Open Policies",
  },
  {
    title: "Give Kudos to teammates",
    description: "Recognize great work by sending kudos. They show on your colleague's profile and contribute to their performance score.",
    icon: <Award size={24} />,
    highlight: "Click the heart icon (bottom-right floating button) anywhere in the app to give kudos.",
  },
  {
    title: "Your profile",
    description: "Your profile shows your KRAs, KPIs, assets assigned to you, recent kudos, and your composite performance score. Update your bio, photo, and contact info anytime.",
    icon: <User size={24} />,
    navigateTo: "/people",
    actionLabel: "Open People",
  },
  {
    title: "You're ready to go! 🎉",
    description: "That's the basics. You can come back to this tour anytime by clicking the Help icon in the top bar. Welcome to the team!",
    icon: <CheckSquare size={24} />,
    actionLabel: "Start using WorkwrK",
  },
];
