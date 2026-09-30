import {
  Sparkles, Building2, Users, Target, BookOpen, Lock,
  CheckSquare, BarChart3, Package, Award, FileText,
  Crosshair, User,
} from "lucide-react";
import type { TourStep } from "@/components/product-tour";
import { WORK_HOME_HREF } from "./nav/route-hub";

// ========================================
// ADMIN TOUR: for the person who set up the org
// ========================================
export const ADMIN_TOUR_STEPS: TourStep[] = [
  {
    title: "Welcome to WorkwrK 👋",
    description: "WorkwrK is your business operating system. It brings People, KRAs/KPIs, SOPs, Reviews, OKRs, Assets, Policies and AI into one place. Let's get you set up so your team can start using it today. This tour takes about 3 minutes.",
    icon: <Sparkles size={24} />,
    highlight: "You run this workspace, so you can open every Space and every Workspace settings page.",
  },
  {
    title: "Step 1: Describe your company",
    description: "Workspace settings, Identity & culture is where you describe your company: its name and logo, then its mission and values on the Culture tab. The AI uses this context for everything: better KRAs, KPIs and a system aligned to your business.",
    icon: <Building2 size={24} />,
    navigateTo: "/settings/identity?tab=culture",
    actionLabel: "Open Identity & culture",
    highlight: "Your mission and values show on the welcome screen everyone sees when they open WorkwrK.",
  },
  {
    title: "Step 2: Invite your team",
    description: "Add the people who'll use WorkwrK. Go to Workspace settings, Members, and invite by email or import a list. Everyone is an Owner, an Admin or a Member; an agent account is a Member marked as an agent. You can change roles later.",
    icon: <Users size={24} />,
    navigateTo: "/settings/members?invite=1",
    actionLabel: "Open Members",
    highlight: "Make someone an Admin to let them run the workspace day to day. Put the people who look after everyone's information on the People team.",
  },
  {
    title: "Step 3: Decide who can do what",
    description: "Everything you make is shared at one of four levels: Full access, Can edit, Can comment or Can view. Sharing flows down from a Space to its Folders and Lists. Workspace settings, Access holds the switches for the whole company, and Lock it down tightens them in one step.",
    icon: <Lock size={24} />,
    navigateTo: "/settings/access",
    actionLabel: "Open Access",
    highlight: "Owners and Admins change the access switches. The People team can read them.",
  },
  {
    title: "Step 4: Create KRAs & KPIs (with AI)",
    description: "KRAs are Key Result Areas: what each role is accountable for. KPIs are how you measure them. Click 'Create with AI' on the KRA & KPIs page, type a job role, and AI generates 5 KRAs with 3 KPIs each, fully editable.",
    icon: <Target size={24} />,
    navigateTo: "/kra-kpi",
    actionLabel: "Open KRA & KPIs",
    highlight: "AI uses your company profile from Step 1 to make KRAs specific to your business, not generic templates.",
  },
  {
    title: "Step 5: Document your processes (SOPs)",
    description: "SOPs are step-by-step playbooks for how things get done. WorkwrK supports written SOPs, step-by-step checklists, recorded SOPs (via the browser extension), and approval flows. Use AI to generate a first draft, then refine.",
    icon: <BookOpen size={24} />,
    navigateTo: "/sops",
    actionLabel: "Open SOPs",
    highlight: "Assign SOPs to specific people. Compliance is tracked automatically and feeds into their performance score.",
  },
  {
    title: "Step 6: Set OKRs and goals",
    description: "OKRs are how you align everyone to bigger goals. Create company-wide OKRs, team OKRs, or individual OKRs. Each Objective has Key Results that are measured with check-ins. They roll up into a quarterly view.",
    icon: <Crosshair size={24} />,
    navigateTo: "/okrs",
    actionLabel: "Open OKRs",
  },
  {
    title: "Step 7: Manage Assets",
    description: "Track laptops, phones, monitors, ID cards, vehicles: anything you give to employees. Each asset has a serial/IMEI, condition, purchase date, warranty. Assign them to people during onboarding, collect them back during offboarding.",
    icon: <Package size={24} />,
    navigateTo: "/assets",
    actionLabel: "Open Assets",
  },
  {
    title: "Step 8: Publish Policies & Announcements",
    description: "Use Policies for HR documents, code of conduct, leave rules. Employees can acknowledge them and you track compliance. Use Announcements for time-sensitive updates that show on everyone's dashboard.",
    icon: <FileText size={24} />,
    navigateTo: "/policies",
    actionLabel: "Open Policies",
  },
  {
    title: "You're all set! 🎉",
    description: "That's the core setup. There's much more: Reviews, Analytics, Ideas Board, Surveys, Talent Grid, Tools & Credentials, Onboarding workflows. Explore at your own pace, or click the Help icon at any time to re-launch this tour.",
    icon: <CheckSquare size={24} />,
    actionLabel: "Start using WorkwrK",
    highlight: "Pro tip: The AI Assistant (sidebar) can answer questions about your business. Try asking 'Who are my top performers this quarter?'",
  },
];

// ========================================
// NEW EMPLOYEE TOUR: for invited team members
// ========================================
export const EMPLOYEE_TOUR_STEPS: TourStep[] = [
  {
    title: "Welcome to WorkwrK 👋",
    description: "WorkwrK is where your team manages people, performance, processes, and goals, all in one place. This 2-minute tour will show you what you can do and where to find things.",
    icon: <Sparkles size={24} />,
  },
  {
    title: "Home",
    description: "Home is where your day starts. Your work for today, what arrived in your Inbox, your reminders and your goals, on one quiet screen.",
    icon: <BarChart3 size={24} />,
    navigateTo: WORK_HOME_HREF,
    actionLabel: "Open Home",
  },
  {
    title: "Your KRAs & KPIs",
    description: "These are the metrics you're measured on. View your assigned KRAs, record monthly KPI values, and see how you're tracking against your targets.",
    icon: <Target size={24} />,
    navigateTo: "/kra-kpi",
    actionLabel: "Open KRAs",
    highlight: "Update your KPIs regularly: they feed into your composite performance score.",
  },
  {
    title: "My work",
    description: "Every task assigned to you, across every Space, as one list you can sort, group and tick off. The board and calendar views show the same tasks a different way.",
    icon: <CheckSquare size={24} />,
    navigateTo: "/my-work",
    actionLabel: "Open My work",
  },
  {
    title: "SOPs assigned to you",
    description: "Standard Operating Procedures: step-by-step guides for how to do things in your role. Complete them at your own pace; your progress is tracked.",
    icon: <BookOpen size={24} />,
    navigateTo: "/sops",
    actionLabel: "Open SOPs",
  },
  {
    title: "Policies to acknowledge",
    description: "Company policies and HR documents are here. Some require acknowledgment, so make sure to read and acknowledge them.",
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
