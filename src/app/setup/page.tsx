"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Building2,
  Users,
  Target,
  CheckSquare,
  BookOpen,
  Star,
  MessageSquare,
  BarChart3,
  Bot,
  GraduationCap,
  ChevronRight,
  ChevronLeft,
  Check,
  Plus,
  X,
  Briefcase,
  Globe,
  Rocket,
  Sparkles,
  ArrowRight,
} from "lucide-react";

const STEPS = [
  { id: "business", label: "Business Profile", icon: Building2 },
  { id: "industry", label: "Industry & Use Case", icon: Globe },
  { id: "modules", label: "Module Priorities", icon: Target },
  { id: "team", label: "Team Size", icon: Users },
  { id: "departments", label: "Departments", icon: Briefcase },
  { id: "invite", label: "Invite Team", icon: Plus },
  { id: "ready", label: "You're All Set!", icon: Rocket },
];

const INDUSTRIES = [
  "Technology / SaaS",
  "E-Commerce / Retail",
  "Manufacturing",
  "Healthcare",
  "Financial Services",
  "Education",
  "Real Estate",
  "Hospitality",
  "Consulting / Agency",
  "Logistics / Supply Chain",
  "Media / Entertainment",
  "Non-Profit",
  "Other",
];

const BUSINESS_TYPES = [
  { value: "startup", label: "Startup", desc: "Early-stage, fast-moving team" },
  { value: "smb", label: "Small Business", desc: "Established business, 10-100 people" },
  { value: "mid_market", label: "Mid-Market", desc: "Growing company, 100-1000 people" },
  { value: "enterprise", label: "Enterprise", desc: "Large organization, 1000+ people" },
];

const USE_CASES = [
  { value: "performance", label: "Performance Management", desc: "Track KRAs, KPIs, and reviews" },
  { value: "operations", label: "Operations & SOPs", desc: "Standardize processes and compliance" },
  { value: "people", label: "People Management", desc: "Manage team, departments, and roles" },
  { value: "execution", label: "Task Execution", desc: "Assign, track, and complete work" },
  { value: "all", label: "Everything", desc: "Full business operating system" },
];

const MODULES = [
  { id: "people", name: "People & Org", icon: Users, desc: "Departments, roles, profiles, org chart", default: true },
  { id: "goals", name: "Goals & KPIs", icon: Target, desc: "KRA/KPI engine, scoring, tracking" },
  { id: "tasks", name: "Task Management", icon: CheckSquare, desc: "Tasks, subtasks, dependencies, RACI" },
  { id: "sops", name: "SOPs & Compliance", icon: BookOpen, desc: "Process documentation, compliance tracking" },
  { id: "reviews", name: "Performance Reviews", icon: Star, desc: "Review cycles, 360 feedback, calibration" },
  { id: "meetings", name: "Meetings & Check-ins", icon: MessageSquare, desc: "Standups, 1:1s, meeting notes" },
  { id: "analytics", name: "Reports & Analytics", icon: BarChart3, desc: "Dashboards, exports, insights" },
  { id: "onboarding", name: "Onboarding & Training", icon: GraduationCap, desc: "Employee onboarding workflows" },
  { id: "ai", name: "AI Assistant", icon: Bot, desc: "Smart suggestions and analysis" },
];

const TEAM_SIZES = [
  { value: "1-10", label: "1–10", desc: "Just getting started" },
  { value: "11-50", label: "11–50", desc: "Small team" },
  { value: "51-200", label: "51–200", desc: "Growing fast" },
  { value: "201-500", label: "201–500", desc: "Scaling up" },
  { value: "500+", label: "500+", desc: "Large organization" },
];

const DEFAULT_DEPARTMENTS = [
  { name: "Engineering", color: "#6C5CE7", description: "Product development and technical infrastructure" },
  { name: "Sales", color: "#00D68F", description: "Revenue generation and client relationships" },
  { name: "Marketing", color: "#FF9F43", description: "Brand awareness and lead generation" },
  { name: "Operations", color: "#FF6B6B", description: "Day-to-day business operations" },
  { name: "HR", color: "#A29BFE", description: "People management and culture" },
  { name: "Finance", color: "#54A0FF", description: "Financial planning and compliance" },
];

export default function SetupPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [currentStep, setCurrentStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [setupData, setSetupData] = useState({
    businessType: "",
    industry: "",
    useCase: "",
    teamSize: "",
    enabledModules: ["people", "goals", "tasks", "sops", "reviews", "meetings", "analytics", "onboarding", "ai"],
    departments: DEFAULT_DEPARTMENTS.map((d) => ({ ...d, enabled: true })),
    customDepartments: [] as { name: string; color: string; description: string }[],
    invites: [{ email: "", role: "EMPLOYEE" as string }],
  });

  const [newDeptName, setNewDeptName] = useState("");

  // Check if setup already completed
  useEffect(() => {
    fetch("/api/setup")
      .then((res) => res.json())
      .then((data) => {
        if (data.setupCompleted) {
          router.push("/dashboard");
        }
      })
      .catch(() => {});
  }, [router]);

  function updateField(field: string, value: any) {
    setSetupData((prev) => ({ ...prev, [field]: value }));
  }

  function toggleModule(moduleId: string) {
    if (moduleId === "people") return; // People is always enabled
    setSetupData((prev) => ({
      ...prev,
      enabledModules: prev.enabledModules.includes(moduleId)
        ? prev.enabledModules.filter((m) => m !== moduleId)
        : [...prev.enabledModules, moduleId],
    }));
  }

  function toggleDepartment(index: number) {
    setSetupData((prev) => ({
      ...prev,
      departments: prev.departments.map((d, i) =>
        i === index ? { ...d, enabled: !d.enabled } : d
      ),
    }));
  }

  function addCustomDepartment() {
    if (!newDeptName.trim()) return;
    const colors = ["#E056A0", "#00BCD4", "#8BC34A", "#795548", "#607D8B"];
    const color = colors[setupData.customDepartments.length % colors.length];
    setSetupData((prev) => ({
      ...prev,
      customDepartments: [
        ...prev.customDepartments,
        { name: newDeptName.trim(), color, description: "" },
      ],
    }));
    setNewDeptName("");
  }

  function removeCustomDepartment(index: number) {
    setSetupData((prev) => ({
      ...prev,
      customDepartments: prev.customDepartments.filter((_, i) => i !== index),
    }));
  }

  function addInviteRow() {
    setSetupData((prev) => ({
      ...prev,
      invites: [...prev.invites, { email: "", role: "EMPLOYEE" }],
    }));
  }

  function updateInvite(index: number, field: string, value: string) {
    setSetupData((prev) => ({
      ...prev,
      invites: prev.invites.map((inv, i) =>
        i === index ? { ...inv, [field]: value } : inv
      ),
    }));
  }

  function removeInvite(index: number) {
    setSetupData((prev) => ({
      ...prev,
      invites: prev.invites.filter((_, i) => i !== index),
    }));
  }

  function canProceed() {
    switch (currentStep) {
      case 0: return !!setupData.businessType;
      case 1: return !!setupData.industry && !!setupData.useCase;
      case 2: return setupData.enabledModules.length > 0;
      case 3: return !!setupData.teamSize;
      case 4: return setupData.departments.some((d) => d.enabled) || setupData.customDepartments.length > 0;
      case 5: return true; // Invites are optional
      default: return true;
    }
  }

  async function handleComplete() {
    setSaving(true);
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(setupData),
      });

      if (!res.ok) {
        throw new Error("Failed to save setup");
      }

      // Move to the "ready" step
      setCurrentStep(STEPS.length - 1);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  function handleNext() {
    if (currentStep === STEPS.length - 2) {
      // Last step before "ready" — save
      handleComplete();
    } else if (currentStep < STEPS.length - 1) {
      setCurrentStep((s) => s + 1);
    }
  }

  function handleBack() {
    if (currentStep > 0) {
      setCurrentStep((s) => s - 1);
    }
  }

  const progress = ((currentStep + 1) / STEPS.length) * 100;

  return (
    <div className="space-y-8">
      {/* Progress Bar */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">
            {currentStep < STEPS.length - 1 ? "Set up your workspace" : ""}
          </h1>
          {currentStep < STEPS.length - 1 && (
            <span className="text-sm text-[#8888A0]">
              Step {currentStep + 1} of {STEPS.length - 1}
            </span>
          )}
        </div>

        {currentStep < STEPS.length - 1 && (
          <div className="flex gap-2">
            {STEPS.slice(0, -1).map((step, i) => (
              <div
                key={step.id}
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  i <= currentStep ? "bg-purple-500" : "bg-[#2A2A3A]"
                }`}
              />
            ))}
          </div>
        )}

        {/* Step indicators */}
        {currentStep < STEPS.length - 1 && (
          <div className="flex items-center gap-2">
            {STEPS.slice(0, -1).map((step, i) => {
              const Icon = step.icon;
              return (
                <button
                  key={step.id}
                  onClick={() => i < currentStep && setCurrentStep(i)}
                  disabled={i > currentStep}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                    i === currentStep
                      ? "bg-purple-600/20 text-purple-400 border border-purple-600/30"
                      : i < currentStep
                        ? "bg-green-600/10 text-green-400 cursor-pointer hover:bg-green-600/20"
                        : "bg-[#1A1A26] text-[#8888A0]"
                  }`}
                >
                  {i < currentStep ? (
                    <Check size={12} />
                  ) : (
                    <Icon size={12} />
                  )}
                  <span className="hidden sm:inline">{step.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Step Content */}
      <div className="min-h-[400px]">
        {/* Step 0: Business Type */}
        {currentStep === 0 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold">What type of business are you?</h2>
              <p className="mt-1 text-sm text-[#8888A0]">
                This helps us tailor the experience for your organization
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {BUSINESS_TYPES.map((type) => (
                <button
                  key={type.value}
                  onClick={() => updateField("businessType", type.value)}
                  className={`flex flex-col items-start rounded-xl border p-5 text-left transition-all ${
                    setupData.businessType === type.value
                      ? "border-purple-500 bg-purple-600/10"
                      : "border-[#2A2A3A] bg-[#12121A] hover:border-[#3A3A4A]"
                  }`}
                >
                  <div className="flex w-full items-center justify-between">
                    <span className="text-base font-semibold">{type.label}</span>
                    {setupData.businessType === type.value && (
                      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-purple-500">
                        <Check size={12} className="text-white" />
                      </div>
                    )}
                  </div>
                  <span className="mt-1 text-sm text-[#8888A0]">{type.desc}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 1: Industry & Use Case */}
        {currentStep === 1 && (
          <div className="space-y-8">
            <div>
              <h2 className="text-xl font-semibold">What industry are you in?</h2>
              <p className="mt-1 text-sm text-[#8888A0]">
                We&apos;ll set up templates and best practices for your industry
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {INDUSTRIES.map((industry) => (
                <button
                  key={industry}
                  onClick={() => updateField("industry", industry)}
                  className={`rounded-full border px-4 py-2 text-sm font-medium transition-all ${
                    setupData.industry === industry
                      ? "border-purple-500 bg-purple-600/20 text-purple-300"
                      : "border-[#2A2A3A] bg-[#12121A] text-[#8888A0] hover:border-[#3A3A4A] hover:text-[#E8E8F0]"
                  }`}
                >
                  {industry}
                </button>
              ))}
            </div>

            <div>
              <h2 className="text-xl font-semibold">How will you primarily use theywrk?</h2>
              <p className="mt-1 text-sm text-[#8888A0]">
                Select the area that matters most to you right now
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {USE_CASES.map((uc) => (
                <button
                  key={uc.value}
                  onClick={() => updateField("useCase", uc.value)}
                  className={`flex flex-col items-start rounded-xl border p-4 text-left transition-all ${
                    setupData.useCase === uc.value
                      ? "border-purple-500 bg-purple-600/10"
                      : "border-[#2A2A3A] bg-[#12121A] hover:border-[#3A3A4A]"
                  }`}
                >
                  <span className="text-sm font-semibold">{uc.label}</span>
                  <span className="mt-1 text-xs text-[#8888A0]">{uc.desc}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2: Module Priorities */}
        {currentStep === 2 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold">Choose your modules</h2>
              <p className="mt-1 text-sm text-[#8888A0]">
                Enable the modules you need. You can always change this later in Settings.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {MODULES.map((mod) => {
                const enabled = setupData.enabledModules.includes(mod.id);
                const Icon = mod.icon;
                return (
                  <button
                    key={mod.id}
                    onClick={() => toggleModule(mod.id)}
                    disabled={mod.default}
                    className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-all ${
                      enabled
                        ? "border-purple-500/50 bg-purple-600/10"
                        : "border-[#2A2A3A] bg-[#12121A] hover:border-[#3A3A4A]"
                    } ${mod.default ? "opacity-80" : ""}`}
                  >
                    <div className={`rounded-lg p-2 ${enabled ? "bg-purple-500/20" : "bg-[#1A1A26]"}`}>
                      <Icon size={18} className={enabled ? "text-purple-400" : "text-[#8888A0]"} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{mod.name}</span>
                        {mod.default && (
                          <Badge variant="secondary" className="text-[10px]">Required</Badge>
                        )}
                      </div>
                      <span className="text-xs text-[#8888A0] mt-0.5 block">{mod.desc}</span>
                    </div>
                    <div className={`mt-1 h-4 w-4 rounded border flex items-center justify-center flex-shrink-0 ${
                      enabled ? "border-purple-500 bg-purple-500" : "border-[#3A3A4A]"
                    }`}>
                      {enabled && <Check size={10} className="text-white" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Step 3: Team Size */}
        {currentStep === 3 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold">How large is your team?</h2>
              <p className="mt-1 text-sm text-[#8888A0]">
                This helps us optimize the workspace for your team&apos;s needs
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {TEAM_SIZES.map((size) => (
                <button
                  key={size.value}
                  onClick={() => updateField("teamSize", size.value)}
                  className={`flex flex-col items-center rounded-xl border p-6 text-center transition-all ${
                    setupData.teamSize === size.value
                      ? "border-purple-500 bg-purple-600/10"
                      : "border-[#2A2A3A] bg-[#12121A] hover:border-[#3A3A4A]"
                  }`}
                >
                  <Users size={24} className={setupData.teamSize === size.value ? "text-purple-400" : "text-[#8888A0]"} />
                  <span className="mt-3 text-lg font-bold">{size.label}</span>
                  <span className="mt-1 text-xs text-[#8888A0]">{size.desc}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 4: Departments */}
        {currentStep === 4 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold">Set up your departments</h2>
              <p className="mt-1 text-sm text-[#8888A0]">
                Toggle the departments that apply to your organization, or add your own
              </p>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-medium text-[#8888A0] uppercase tracking-wider">Default Departments</h3>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {setupData.departments.map((dept, i) => (
                  <button
                    key={dept.name}
                    onClick={() => toggleDepartment(i)}
                    className={`flex items-center gap-3 rounded-xl border p-4 text-left transition-all ${
                      dept.enabled
                        ? "border-purple-500/50 bg-purple-600/5"
                        : "border-[#2A2A3A] bg-[#12121A] opacity-60"
                    }`}
                  >
                    <div className="h-3 w-3 rounded-full flex-shrink-0" style={{ backgroundColor: dept.color }} />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium">{dept.name}</span>
                      {dept.description && (
                        <span className="text-xs text-[#8888A0] block mt-0.5 truncate">{dept.description}</span>
                      )}
                    </div>
                    <div className={`h-4 w-4 rounded border flex items-center justify-center flex-shrink-0 ${
                      dept.enabled ? "border-purple-500 bg-purple-500" : "border-[#3A3A4A]"
                    }`}>
                      {dept.enabled && <Check size={10} className="text-white" />}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Custom departments */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-[#8888A0] uppercase tracking-wider">Custom Departments</h3>
              {setupData.customDepartments.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {setupData.customDepartments.map((dept, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 rounded-full border border-purple-500/30 bg-purple-600/10 px-4 py-2"
                    >
                      <div className="h-2 w-2 rounded-full" style={{ backgroundColor: dept.color }} />
                      <span className="text-sm font-medium">{dept.name}</span>
                      <button onClick={() => removeCustomDepartment(i)} className="text-[#8888A0] hover:text-red-400">
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <Input
                  placeholder="Department name..."
                  value={newDeptName}
                  onChange={(e) => setNewDeptName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addCustomDepartment()}
                  className="max-w-xs"
                />
                <Button variant="outline" onClick={addCustomDepartment} disabled={!newDeptName.trim()}>
                  <Plus size={16} className="mr-1" /> Add
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Step 5: Invite Team */}
        {currentStep === 5 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold">Invite your team</h2>
              <p className="mt-1 text-sm text-[#8888A0]">
                Add team members to get started. You can always invite more later.
              </p>
            </div>

            <Card className="border-[#2A2A3A] bg-[#12121A]">
              <CardContent className="p-5 space-y-3">
                {setupData.invites.map((invite, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <Input
                      type="email"
                      placeholder="colleague@company.com"
                      value={invite.email}
                      onChange={(e) => updateInvite(i, "email", e.target.value)}
                      className="flex-1"
                    />
                    <select
                      value={invite.role}
                      onChange={(e) => updateInvite(i, "role", e.target.value)}
                      className="h-10 appearance-none rounded-lg border border-[#2A2A3A] bg-[#12121A] pl-3 pr-8 text-sm text-[#E8E8F0] bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%236B6B80%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[length:16px] bg-[right_8px_center] bg-no-repeat focus:outline-none focus:ring-2 focus:ring-purple-500"
                    >
                      <option value="EMPLOYEE">Employee</option>
                      <option value="TEAM_LEAD">Team Lead</option>
                      <option value="MANAGER">Manager</option>
                      <option value="HR">HR</option>
                      <option value="DIRECTOR">Director</option>
                      <option value="VP">VP</option>
                      <option value="C_LEVEL">C-Level</option>
                      <option value="COMPANY_ADMIN">Admin</option>
                    </select>
                    {setupData.invites.length > 1 && (
                      <button onClick={() => removeInvite(i)} className="text-[#8888A0] hover:text-red-400">
                        <X size={18} />
                      </button>
                    )}
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={addInviteRow} className="gap-1.5">
                  <Plus size={14} /> Add another
                </Button>
              </CardContent>
            </Card>

            <p className="text-xs text-[#8888A0]">
              Invitations will be sent via email. You can skip this step and invite people later from the People page.
            </p>
          </div>
        )}

        {/* Step 6: Ready! */}
        {currentStep === STEPS.length - 1 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-purple-600/20 to-green-500/20 border border-purple-500/30">
              <Sparkles size={40} className="text-purple-400" />
            </div>
            <h2 className="text-3xl font-bold">You&apos;re all set!</h2>
            <p className="mt-2 max-w-md text-[#8888A0]">
              Your workspace is ready. Start managing your team, tracking performance, and running your business like a pro.
            </p>

            <div className="mt-8 flex flex-wrap gap-3 justify-center">
              {setupData.enabledModules.slice(0, 5).map((modId) => {
                const mod = MODULES.find((m) => m.id === modId);
                if (!mod) return null;
                const Icon = mod.icon;
                return (
                  <div key={modId} className="flex items-center gap-2 rounded-full border border-[#2A2A3A] bg-[#12121A] px-4 py-2">
                    <Icon size={14} className="text-purple-400" />
                    <span className="text-sm">{mod.name}</span>
                  </div>
                );
              })}
              {setupData.enabledModules.length > 5 && (
                <div className="flex items-center rounded-full border border-[#2A2A3A] bg-[#12121A] px-4 py-2">
                  <span className="text-sm text-[#8888A0]">+{setupData.enabledModules.length - 5} more</span>
                </div>
              )}
            </div>

            <Button
              className="mt-10 gap-2 px-8"
              size="lg"
              onClick={() => router.push("/dashboard")}
            >
              Go to Dashboard <ArrowRight size={18} />
            </Button>
          </div>
        )}
      </div>

      {/* Navigation Buttons */}
      {currentStep < STEPS.length - 1 && (
        <div className="flex items-center justify-between border-t border-[#2A2A3A] pt-6">
          <Button
            variant="outline"
            onClick={handleBack}
            disabled={currentStep === 0}
            className="gap-1.5"
          >
            <ChevronLeft size={16} /> Back
          </Button>

          <div className="flex items-center gap-3">
            {currentStep === 5 && (
              <Button
                variant="ghost"
                onClick={handleComplete}
                disabled={saving}
                className="text-[#8888A0]"
              >
                Skip for now
              </Button>
            )}
            <Button
              onClick={handleNext}
              disabled={!canProceed() || saving}
              className="gap-1.5"
            >
              {saving ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Setting up...
                </span>
              ) : currentStep === STEPS.length - 2 ? (
                <>Complete Setup <Check size={16} /></>
              ) : (
                <>Continue <ChevronRight size={16} /></>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
