"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Building2, Users, Shield, Bell, CreditCard, Check, Loader2, Send, Trash2,
  UserX, RotateCcw, Download, AlertTriangle, Sliders, ToggleLeft, Key,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/components/ui/toast";

interface SettingsData {
  organization: {
    id: string;
    name: string;
    slug: string;
    domain: string | null;
    logo: string | null;
    plan: string;
    status: string;
  };
  settings: {
    enabledModules: string[];
    businessType: string;
    industry: string;
    teamSize: string;
    timezone: string;
    currency: string;
    fiscalYearStart: number;
    reviewFrequency: string;
    scoreWeights: { kpi: number; manager: number; peer: number; self: number; sopCompliance: number };
    scoringBands: { label: string; min: number; max: number; color: string }[];
    notifications: Record<string, any>;
    security: {
      minPasswordLength: number;
      requireUppercase: boolean;
      requireNumbers: boolean;
      sessionTimeout: number;
      twoFactorEnabled: boolean;
    };
  };
  usage: {
    users: number;
    sops: number;
    aiQueries: number;
  };
}

interface PendingInvite {
  id: string;
  email: string;
  accessLevel: string;
  expiresAt: string;
  accepted: boolean;
}

const ALL_MODULES = [
  { key: "people", label: "People", description: "Team directory and employee profiles" },
  { key: "kra-kpi", label: "KRA & KPIs", description: "Key responsible areas and performance indicators" },
  { key: "tasks", label: "Work Calendar", description: "Daily work planning and calendar view" },
  { key: "sops", label: "SOPs", description: "Standard operating procedures and compliance" },
  { key: "reviews", label: "Reviews", description: "Performance review cycles" },
  { key: "meetings", label: "Meetings", description: "Meeting scheduling and action items" },
  { key: "checkins", label: "Onboarding & Check-ins", description: "Employee onboarding and daily check-ins" },
  { key: "ai", label: "AI Assistant", description: "AI-powered insights and queries" },
  { key: "analytics", label: "Analytics", description: "Performance dashboards and reporting" },
];

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function SettingsPage() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [orgName, setOrgName] = useState("");
  const [orgDomain, setOrgDomain] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  // Company settings
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [currency, setCurrency] = useState("INR");
  const [fiscalYearStart, setFiscalYearStart] = useState(4);
  const [reviewFrequency, setReviewFrequency] = useState("QUARTERLY");
  const [scoreWeights, setScoreWeights] = useState({ kpi: 40, manager: 25, peer: 10, self: 5, sopCompliance: 20 });
  const [scoringBands, setScoringBands] = useState([
    { label: "Exceptional", min: 90, max: 100, color: "green" },
    { label: "Good", min: 75, max: 89, color: "blue" },
    { label: "Meets Expectations", min: 60, max: 74, color: "purple" },
    { label: "Needs Improvement", min: 40, max: 59, color: "orange" },
    { label: "Underperforming", min: 0, max: 39, color: "red" },
  ]);

  // Modules
  const [enabledModules, setEnabledModules] = useState<string[]>([]);

  // Team
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("EMPLOYEE");
  const [inviting, setInviting] = useState(false);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);

  // Security
  const [security, setSecurity] = useState({
    minPasswordLength: 8,
    requireUppercase: true,
    requireNumbers: true,
    sessionTimeout: 24,
    twoFactorEnabled: false,
  });

  // Notifications
  const [notifPrefs, setNotifPrefs] = useState<Record<string, any>>({
    kraAssigned: true,
    kpiUpdate: true,
    reviewDue: true,
    sopUpdate: true,
    checkInReminder: true,
    kudosReceived: true,
    emailEnabled: true,
    reminderFrequency: "daily",
  });

  // Email preferences
  const [emailPrefs, setEmailPrefs] = useState({
    kraNotifications: true,
    reviewNotifications: true,
    sopNotifications: true,
    kudosNotifications: true,
    dailyDigest: false,
  });
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailSaveSuccess, setEmailSaveSuccess] = useState(false);

  // Removed people
  const [removedPeople, setRemovedPeople] = useState<any[]>([]);
  const [loadingRemoved, setLoadingRemoved] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);

  // Delete org
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [deletingOrg, setDeletingOrg] = useState(false);

  const { success: toastSuccess, error: toastError } = useToast();

  useEffect(() => {
    fetchSettings();
  }, []);

  async function fetchSettings() {
    try {
      const res = await fetch("/api/settings");
      if (res.ok) {
        const json = await res.json();
        setData(json);
        setOrgName(json.organization.name || "");
        setOrgDomain(json.organization.domain || "");
        setLogoUrl(json.organization.logo || null);
        if (json.settings.notifications) setNotifPrefs(json.settings.notifications);
        if (json.settings.security) setSecurity(json.settings.security);
        if (json.settings.enabledModules?.length > 0) setEnabledModules(json.settings.enabledModules);
        else setEnabledModules(ALL_MODULES.map((m) => m.key));
        if (json.settings.timezone) setTimezone(json.settings.timezone);
        if (json.settings.currency) setCurrency(json.settings.currency);
        if (json.settings.fiscalYearStart) setFiscalYearStart(json.settings.fiscalYearStart);
        if (json.settings.reviewFrequency) setReviewFrequency(json.settings.reviewFrequency);
        if (json.settings.scoreWeights) setScoreWeights(json.settings.scoreWeights);
        if (json.settings.scoringBands?.length > 0) setScoringBands(json.settings.scoringBands);
      }
    } catch (err) {
      console.error("Failed to load settings:", err);
    } finally {
      setLoading(false);
    }
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingLogo(true);
    try {
      const formData = new FormData();
      formData.append("logo", file);
      const res = await fetch("/api/settings/logo", { method: "POST", body: formData });
      const json = await res.json();
      if (res.ok) {
        setLogoUrl(json.logo);
      }
    } catch {
      // ignore
    } finally {
      setUploadingLogo(false);
    }
  }

  async function handleLogoRemove() {
    setUploadingLogo(true);
    try {
      const res = await fetch("/api/settings/logo", { method: "DELETE" });
      if (res.ok) setLogoUrl(null);
    } catch {
      // ignore
    } finally {
      setUploadingLogo(false);
    }
  }

  async function saveSection(section: string, sectionData: any) {
    setSaving(section);
    setSaveSuccess(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section, data: sectionData }),
      });
      if (res.ok) {
        setSaveSuccess(section);
        setTimeout(() => setSaveSuccess(null), 2000);
        toastSuccess("Settings saved");
      } else {
        toastError("Failed to save settings");
      }
    } catch (err) {
      console.error("Failed to save:", err);
      toastError("Failed to save settings");
    } finally {
      setSaving(null);
    }
  }

  async function handleInvite() {
    if (!inviteEmail.trim() || !inviteEmail.includes("@")) return;
    setInviting(true);
    try {
      const res = await fetch("/api/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, accessLevel: inviteRole }),
      });
      if (res.ok) {
        setInviteEmail("");
        fetchInvites();
        toastSuccess("Invitation sent");
      } else {
        toastError("Failed to send invitation");
      }
    } catch (err) {
      console.error("Failed to invite:", err);
      toastError("Failed to send invitation");
    } finally {
      setInviting(false);
    }
  }

  async function fetchInvites() {
    try {
      const res = await fetch("/api/invitations");
      if (res.ok) {
        const json = await res.json();
        setPendingInvites(Array.isArray(json) ? json : []);
      }
    } catch {}
  }

  async function cancelInvite(id: string) {
    try {
      const res = await fetch("/api/invitations", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        toastSuccess("Invitation cancelled");
        fetchInvites();
      } else {
        toastError("Failed to cancel invitation");
      }
    } catch {
      toastError("Failed to cancel invitation");
    }
  }

  useEffect(() => { fetchInvites(); }, []);

  useEffect(() => {
    async function fetchEmailPrefs() {
      try {
        const res = await fetch("/api/email-preferences");
        if (res.ok) {
          const json = await res.json();
          const prefs = json.data || json;
          setEmailPrefs({
            kraNotifications: prefs.kraNotifications ?? true,
            reviewNotifications: prefs.reviewNotifications ?? true,
            sopNotifications: prefs.sopNotifications ?? true,
            kudosNotifications: prefs.kudosNotifications ?? true,
            dailyDigest: prefs.dailyDigest ?? false,
          });
        }
      } catch {}
    }
    fetchEmailPrefs();
  }, []);

  async function saveEmailPrefs() {
    setSavingEmail(true);
    setEmailSaveSuccess(false);
    try {
      const res = await fetch("/api/email-preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(emailPrefs),
      });
      if (res.ok) {
        setEmailSaveSuccess(true);
        setTimeout(() => setEmailSaveSuccess(false), 2000);
      }
    } catch (err) {
      console.error("Failed to save email preferences:", err);
    } finally {
      setSavingEmail(false);
    }
  }

  async function fetchRemovedPeople() {
    setLoadingRemoved(true);
    try {
      const res = await fetch("/api/users?includeDeleted=true");
      if (res.ok) {
        const json = await res.json();
        const arr = Array.isArray(json) ? json : json.data ?? json.users ?? [];
        setRemovedPeople(arr.filter((u: any) => u.status === "INACTIVE" || u.deletedAt));
      }
    } catch (err) {
      console.error("Failed to fetch removed people:", err);
    } finally {
      setLoadingRemoved(false);
    }
  }

  async function handleRestore(userId: string) {
    setRestoring(userId);
    try {
      const res = await fetch(`/api/users/${userId}?restore=true`, { method: "DELETE" });
      if (res.ok) {
        setRemovedPeople((prev) => prev.filter((u) => u.id !== userId));
      }
    } catch (err) {
      console.error("Failed to restore user:", err);
    } finally {
      setRestoring(null);
    }
  }

  async function handleDeleteOrg() {
    setDeletingOrg(true);
    try {
      const res = await fetch("/api/organizations/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmName: deleteConfirmName }),
      });
      if (res.ok) {
        toastSuccess("Organization deleted");
        window.location.href = "/login";
      } else {
        const data = await res.json();
        toastError(data.error || "Failed to delete organization");
      }
    } catch {
      toastError("Failed to delete organization");
    } finally {
      setDeletingOrg(false);
    }
  }

  function toggleNotif(key: string) {
    setNotifPrefs((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function toggleModule(key: string) {
    setEnabledModules((prev) =>
      prev.includes(key) ? prev.filter((m) => m !== key) : [...prev, key]
    );
  }

  const plan = data?.organization.plan || "GROWTH";
  const planLimits: Record<string, { users: number; sops: number; ai: number }> = {
    STARTER: { users: 10, sops: 3, ai: 50 },
    GROWTH: { users: 50, sops: 20, ai: 500 },
    SCALE: { users: 200, sops: 100, ai: 2000 },
    ENTERPRISE: { users: 99999, sops: 99999, ai: 99999 },
  };
  const limits = planLimits[plan] || planLimits.GROWTH;

  const notifLabels: Record<string, string> = {
    kraAssigned: "KRA assignment notifications",
    kpiUpdate: "KPI score update notifications",
    reviewDue: "Review cycle reminders",
    sopUpdate: "SOP assignment and compliance alerts",
    checkInReminder: "Daily check-in reminders",
    kudosReceived: "Kudos and recognition notifications",
  };

  function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
    return (
      <button
        onClick={onChange}
        className={`h-6 w-11 rounded-full transition-colors ${checked ? "bg-purple-600" : "bg-border"}`}
      >
        <span className={`block h-5 w-5 rounded-full bg-white transition-transform ${checked ? "translate-x-5" : "translate-x-0.5"}`} />
      </button>
    );
  }

  function SaveButton({ section, data: sectionData }: { section: string; data: any }) {
    return (
      <Button
        onClick={() => saveSection(section, sectionData)}
        disabled={saving === section}
        className="gap-2"
      >
        {saving === section ? (
          <><Loader2 size={14} className="animate-spin" /> Saving...</>
        ) : saveSuccess === section ? (
          <><Check size={14} /> Saved!</>
        ) : (
          "Save Changes"
        )}
      </Button>
    );
  }

  if (loading) {
    return (
      <div className="space-y-4 animate-fade-in">
        <div>
          <h1 className="text-lg font-bold tracking-tight">Settings</h1>
          <p className="text-muted text-sm mt-1">Manage your organization settings</p>
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-48 animate-pulse rounded-xl bg-surface-2" />
          ))}
        </div>
      </div>
    );
  }

  const weightTotal = scoreWeights.kpi + scoreWeights.manager + scoreWeights.peer + scoreWeights.self + (scoreWeights.sopCompliance || 0);

  return (
    <div className="space-y-4 animate-fade-in">
      <div>
        <h1 className="text-lg font-bold tracking-tight">Settings</h1>
        <p className="text-muted text-sm mt-1">Manage your organization settings and preferences</p>
      </div>

      <Tabs defaultValue="general">
        <TabsList className="flex-wrap">
          <TabsTrigger value="general" className="gap-2"><Building2 size={14} /> General</TabsTrigger>
          <TabsTrigger value="modules" className="gap-2"><ToggleLeft size={14} /> Modules</TabsTrigger>
          <TabsTrigger value="team" className="gap-2"><Users size={14} /> Team</TabsTrigger>
          <TabsTrigger value="security" className="gap-2"><Shield size={14} /> Security</TabsTrigger>
          <TabsTrigger value="sso" className="gap-2"><Key size={14} /> SSO</TabsTrigger>
          <TabsTrigger value="notifications" className="gap-2"><Bell size={14} /> Notifications</TabsTrigger>
          <TabsTrigger value="removed" className="gap-2" onClick={() => { if (removedPeople.length === 0) fetchRemovedPeople(); }}><UserX size={14} /> Removed People</TabsTrigger>
          <TabsTrigger value="billing" className="gap-2"><CreditCard size={14} /> Billing</TabsTrigger>
          <TabsTrigger value="data" className="gap-2"><Sliders size={14} /> Data</TabsTrigger>
        </TabsList>

        {/* General */}
        <TabsContent value="general" className="space-y-6 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Organization Details</CardTitle>
              <CardDescription>Basic information about your organization</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Logo Upload */}
              <div className="flex items-center gap-4">
                <div className="h-16 w-16 rounded-lg border border-border bg-surface-2 flex items-center justify-center overflow-hidden">
                  {logoUrl ? (
                    <img src={logoUrl} alt="Logo" className="h-full w-full object-contain" />
                  ) : (
                    <Building2 size={28} className="text-muted" />
                  )}
                </div>
                <div className="space-y-1">
                  <Label>Company Logo</Label>
                  <div className="flex gap-2">
                    <label className="cursor-pointer">
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/svg+xml"
                        className="hidden"
                        onChange={handleLogoUpload}
                        disabled={uploadingLogo}
                      />
                      <span className="inline-flex h-8 items-center rounded-md bg-purple-600/20 px-3 text-xs text-purple-400 hover:bg-purple-600/30 transition-colors">
                        {uploadingLogo ? "Uploading..." : "Upload Logo"}
                      </span>
                    </label>
                    {logoUrl && (
                      <Button variant="ghost" size="sm" onClick={handleLogoRemove} disabled={uploadingLogo} className="h-8 text-xs text-muted hover:text-red-400">
                        Remove
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted">PNG, JPEG, WebP, or SVG. Max 2MB.</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Organization Name</Label>
                  <Input value={orgName} onChange={(e) => setOrgName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Slug</Label>
                  <Input value={data?.organization.slug || ""} disabled className="opacity-60" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Domain</Label>
                  <Input value={orgDomain} onChange={(e) => setOrgDomain(e.target.value)} placeholder="yourcompany.com" />
                </div>
                <div className="space-y-2">
                  <Label>Plan</Label>
                  <Input value={plan} disabled className="opacity-60" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Timezone</Label>
                  <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className="h-10 w-full appearance-none rounded-lg border border-border bg-surface pl-3 pr-8 text-sm text-foreground bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%236B6B80%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[length:16px] bg-[right_8px_center] bg-no-repeat focus:outline-none focus:ring-2 focus:ring-purple-500">
                    <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
                    <option value="America/New_York">America/New_York (EST)</option>
                    <option value="America/Los_Angeles">America/Los_Angeles (PST)</option>
                    <option value="Europe/London">Europe/London (GMT)</option>
                    <option value="Asia/Singapore">Asia/Singapore (SGT)</option>
                    <option value="Asia/Dubai">Asia/Dubai (GST)</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>Currency</Label>
                  <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="h-10 w-full appearance-none rounded-lg border border-border bg-surface pl-3 pr-8 text-sm text-foreground bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%236B6B80%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[length:16px] bg-[right_8px_center] bg-no-repeat focus:outline-none focus:ring-2 focus:ring-purple-500">
                    <option value="INR">INR (&#8377;)</option>
                    <option value="USD">USD ($)</option>
                    <option value="EUR">EUR (&euro;)</option>
                    <option value="GBP">GBP (&pound;)</option>
                    <option value="SGD">SGD (S$)</option>
                    <option value="AED">AED (AED)</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>Fiscal Year Start</Label>
                  <select value={fiscalYearStart} onChange={(e) => setFiscalYearStart(parseInt(e.target.value))} className="h-10 w-full appearance-none rounded-lg border border-border bg-surface pl-3 pr-8 text-sm text-foreground bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%236B6B80%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[length:16px] bg-[right_8px_center] bg-no-repeat focus:outline-none focus:ring-2 focus:ring-purple-500">
                    {MONTH_NAMES.map((name, i) => (
                      <option key={i} value={i + 1}>{name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <SaveButton section="general" data={{ name: orgName, domain: orgDomain, timezone, currency, fiscalYearStart }} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Review & Scoring Settings</CardTitle>
              <CardDescription>Configure performance review parameters</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Default Review Frequency</Label>
                <select value={reviewFrequency} onChange={(e) => setReviewFrequency(e.target.value)} className="h-10 w-full appearance-none rounded-lg border border-border bg-surface pl-3 pr-8 text-sm text-foreground bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%236B6B80%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[length:16px] bg-[right_8px_center] bg-no-repeat focus:outline-none focus:ring-2 focus:ring-purple-500">
                  <option value="MONTHLY">Monthly</option>
                  <option value="QUARTERLY">Quarterly</option>
                  <option value="ANNUALLY">Annually</option>
                </select>
              </div>

              <div className="space-y-2">
                <Label>Performance Score Formula Weights</Label>
                <div className="grid grid-cols-5 gap-3">
                  {([
                    { key: "kpi", label: "KPI Achievement %" },
                    { key: "manager", label: "Manager Rating %" },
                    { key: "sopCompliance", label: "SOP Compliance %" },
                    { key: "peer", label: "Peer Rating %" },
                    { key: "self", label: "Self Rating %" },
                  ] as const).map(({ key, label }) => (
                    <div key={key} className="space-y-1">
                      <Label className="text-xs text-muted">{label}</Label>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={scoreWeights[key as keyof typeof scoreWeights]}
                        onChange={(e) => setScoreWeights({ ...scoreWeights, [key]: parseInt(e.target.value) || 0 })}
                      />
                    </div>
                  ))}
                </div>
                <p className={`text-xs ${weightTotal === 100 ? "text-green-400" : "text-red-400"}`}>
                  Total: {weightTotal}% {weightTotal !== 100 && "(must equal 100%)"}
                </p>
              </div>

              <div className="space-y-2">
                <Label>Scoring Bands</Label>
                <div className="space-y-2">
                  {scoringBands.map((band, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        className="flex-1"
                        value={band.label}
                        onChange={(e) => {
                          const updated = [...scoringBands];
                          updated[i] = { ...band, label: e.target.value };
                          setScoringBands(updated);
                        }}
                      />
                      <Input
                        type="number"
                        className="w-20"
                        value={band.min}
                        onChange={(e) => {
                          const updated = [...scoringBands];
                          updated[i] = { ...band, min: parseInt(e.target.value) || 0 };
                          setScoringBands(updated);
                        }}
                      />
                      <span className="text-muted text-xs">to</span>
                      <Input
                        type="number"
                        className="w-20"
                        value={band.max}
                        onChange={(e) => {
                          const updated = [...scoringBands];
                          updated[i] = { ...band, max: parseInt(e.target.value) || 100 };
                          setScoringBands(updated);
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <SaveButton section="general" data={{
                name: orgName, domain: orgDomain, timezone, currency, fiscalYearStart,
                reviewFrequency, scoreWeights, scoringBands,
              }} />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Modules */}
        <TabsContent value="modules" className="space-y-6 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Module Configuration</CardTitle>
              <CardDescription>Enable or disable modules for your organization. Disabled modules are hidden from the sidebar.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {ALL_MODULES.map((mod) => (
                <div key={mod.key} className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div>
                    <span className="text-sm font-medium">{mod.label}</span>
                    <p className="text-xs text-muted">{mod.description}</p>
                  </div>
                  <Toggle
                    checked={enabledModules.includes(mod.key)}
                    onChange={() => toggleModule(mod.key)}
                  />
                </div>
              ))}
              <div className="pt-2">
                <SaveButton section="modules" data={{ enabledModules }} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Team */}
        <TabsContent value="team" className="space-y-6 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Invite Team Members</CardTitle>
              <CardDescription>Send invitations to join your organization</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Label>Email <span className="text-red-400">*</span></Label>
              <div className="flex gap-3">
                <Input
                  placeholder="email@company.com"
                  className="flex-1"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleInvite()}
                />
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  className="h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
                >
                  <option value="EMPLOYEE">Employee</option>
                  <option value="TEAM_LEAD">Team Lead</option>
                  <option value="MANAGER">Manager</option>
                  <option value="HR">HR</option>
                  <option value="COMPANY_ADMIN">Admin</option>
                </select>
                <Button onClick={handleInvite} disabled={inviting} className="gap-2">
                  {inviting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  {inviting ? "Sending..." : "Send Invite"}
                </Button>
              </div>

              <div className="mt-4">
                <p className="text-xs text-muted mb-3">
                  Team size: {data?.usage.users || 0} members
                  {limits.users < 99999 && ` (limit: ${limits.users})`}
                </p>

                {pendingInvites.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-muted">Pending Invitations</h4>
                    {pendingInvites.filter(inv => !inv.accepted).map((inv) => (
                      <div key={inv.id} className="flex items-center justify-between rounded-lg border border-border p-3">
                        <div>
                          <p className="text-sm">{inv.email}</p>
                          <p className="text-xs text-muted">
                            {inv.accessLevel} &middot; Expires {new Date(inv.expiresAt).toLocaleDateString()}
                          </p>
                        </div>
                        <button
                          onClick={() => cancelInvite(inv.id)}
                          className="text-xs text-red-400 hover:text-red-300 border border-red-500/20 hover:border-red-500/40 rounded-md px-3 py-1 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Security */}
        <TabsContent value="security" className="space-y-6 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Password Policy</CardTitle>
              <CardDescription>Configure password requirements for your team</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Minimum Password Length</Label>
                  <Input
                    type="number"
                    value={security.minPasswordLength}
                    onChange={(e) => setSecurity({ ...security, minPasswordLength: parseInt(e.target.value) || 8 })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Session Timeout (hours)</Label>
                  <Input
                    type="number"
                    value={security.sessionTimeout}
                    onChange={(e) => setSecurity({ ...security, sessionTimeout: parseInt(e.target.value) || 24 })}
                  />
                </div>
              </div>

              <div className="space-y-3">
                {[
                  { key: "requireUppercase", label: "Require uppercase letters" },
                  { key: "requireNumbers", label: "Require numbers" },
                  { key: "twoFactorEnabled", label: "Require two-factor authentication" },
                ].map((item) => (
                  <div key={item.key} className="flex items-center justify-between rounded-lg border border-border p-3">
                    <span className="text-sm">{item.label}</span>
                    <Toggle
                      checked={!!security[item.key as keyof typeof security]}
                      onChange={() => setSecurity({ ...security, [item.key]: !security[item.key as keyof typeof security] })}
                    />
                  </div>
                ))}
              </div>

              <SaveButton section="security" data={security} />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Notifications */}
        <TabsContent value="notifications" className="space-y-6 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Company Notification Settings</CardTitle>
              <CardDescription>Configure which events trigger notifications for your organization</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Global email toggle */}
              <div className="flex items-center justify-between rounded-lg border border-purple-500/20 bg-purple-500/5 p-3">
                <div>
                  <span className="text-sm font-medium">Enable email notifications globally</span>
                  <p className="text-xs text-muted">Turn off to disable all email notifications for the company</p>
                </div>
                <Toggle
                  checked={!!notifPrefs.emailEnabled}
                  onChange={() => setNotifPrefs((prev) => ({ ...prev, emailEnabled: !prev.emailEnabled }))}
                />
              </div>

              {Object.entries(notifLabels).map(([key, label]) => (
                <div key={key} className="flex items-center justify-between rounded-lg border border-border p-3">
                  <span className="text-sm">{label}</span>
                  <Toggle checked={!!notifPrefs[key]} onChange={() => toggleNotif(key)} />
                </div>
              ))}

              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <div>
                  <span className="text-sm">Overdue item reminder frequency</span>
                  <p className="text-xs text-muted">How often to remind about overdue tasks and SOPs</p>
                </div>
                <select
                  value={notifPrefs.reminderFrequency || "daily"}
                  onChange={(e) => setNotifPrefs((prev) => ({ ...prev, reminderFrequency: e.target.value }))}
                  className="h-8 rounded-lg border border-border bg-background px-2 text-xs text-foreground"
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="never">Never</option>
                </select>
              </div>

              <div className="pt-2">
                <SaveButton section="notifications" data={notifPrefs} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Your Email Notifications</CardTitle>
              <CardDescription>Control which emails you personally receive from WorkwrK</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                { key: "kraNotifications", label: "KRA assignment & KPI update emails" },
                { key: "reviewNotifications", label: "Performance review emails" },
                { key: "sopNotifications", label: "SOP assignment emails" },
                { key: "kudosNotifications", label: "Recognition & kudos emails" },
                { key: "dailyDigest", label: "Daily digest summary" },
              ].map((item) => (
                <div key={item.key} className="flex items-center justify-between rounded-lg border border-border p-3">
                  <span className="text-sm">{item.label}</span>
                  <Toggle
                    checked={!!emailPrefs[item.key as keyof typeof emailPrefs]}
                    onChange={() => setEmailPrefs((prev) => ({ ...prev, [item.key]: !prev[item.key as keyof typeof prev] }))}
                  />
                </div>
              ))}
              <div className="pt-2">
                <Button onClick={saveEmailPrefs} disabled={savingEmail} className="gap-2">
                  {savingEmail ? (
                    <><Loader2 size={14} className="animate-spin" /> Saving...</>
                  ) : emailSaveSuccess ? (
                    <><Check size={14} /> Saved!</>
                  ) : (
                    "Save Email Preferences"
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Removed People */}
        <TabsContent value="removed" className="space-y-6 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Removed People</CardTitle>
              <CardDescription>People who have been removed from your organization. You can restore them at any time.</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingRemoved ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-14 animate-pulse rounded-lg bg-surface-2" />
                  ))}
                </div>
              ) : removedPeople.length === 0 ? (
                <p className="text-sm text-muted text-center py-8">No removed people found.</p>
              ) : (
                <div className="space-y-2">
                  {removedPeople.map((user) => (
                    <div key={user.id} className="flex items-center justify-between rounded-lg border border-border p-3">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="text-xs">
                            {(user.firstName?.[0] ?? "")}{(user.lastName?.[0] ?? "")}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="text-sm font-medium">{user.firstName} {user.lastName}</p>
                          <p className="text-xs text-muted">{user.email}{user.department?.name ? ` · ${user.department.name}` : ""}{user.role?.title ? ` · ${user.role.title}` : ""}</p>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        onClick={() => handleRestore(user.id)}
                        disabled={restoring === user.id}
                      >
                        <RotateCcw size={14} />
                        {restoring === user.id ? "Restoring..." : "Restore"}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Billing */}
        <TabsContent value="billing" className="space-y-6 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Current Plan</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between rounded-lg border border-purple-500/30 bg-purple-500/5 p-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-lg">{plan}</h3>
                    <Badge variant="default">{data?.organization.status || "Active"}</Badge>
                  </div>
                  <p className="text-sm text-muted mt-1">Current billing period</p>
                </div>
                <Button>Upgrade Plan</Button>
              </div>

              <div className="mt-6 grid grid-cols-3 gap-4">
                {[
                  { label: "Users", value: data?.usage.users || 0, limit: limits.users },
                  { label: "SOPs", value: data?.usage.sops || 0, limit: limits.sops },
                  { label: "AI Queries", value: data?.usage.aiQueries || 0, limit: limits.ai },
                ].map((item) => {
                  const pct = item.limit === 99999 ? 10 : (item.value / item.limit) * 100;
                  const isOver = item.value > item.limit && item.limit < 99999;
                  return (
                    <div key={item.label} className="rounded-lg border border-border p-4">
                      <p className="text-2xl font-bold">{item.value}</p>
                      <p className="text-xs text-muted">
                        of {item.limit === 99999 ? "Unlimited" : item.limit} {item.label.toLowerCase()}
                      </p>
                      <div className="mt-2 h-1.5 w-full rounded-full bg-border">
                        <div
                          className={`h-full rounded-full transition-all ${isOver ? "bg-red-500" : "bg-purple-500"}`}
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                      {isOver ? (
                        <Badge variant="destructive" className="mt-2 text-[10px]">Over limit</Badge>
                      ) : (
                        <Badge variant="secondary" className="mt-2 text-[10px]">Within limit</Badge>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Data Management */}
        {/* SSO Tab */}
        <TabsContent value="sso" className="space-y-6 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Single Sign-On (SSO)</CardTitle>
              <p className="text-sm text-muted">Configure enterprise authentication with your identity provider.</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  { name: "Okta", desc: "SAML 2.0 / OIDC", color: "bg-blue-500/10 border-blue-500/20" },
                  { name: "Azure AD", desc: "Microsoft Entra ID", color: "bg-sky-500/10 border-sky-500/20" },
                  { name: "Google Workspace", desc: "Google OIDC", color: "bg-red-500/10 border-red-500/20" },
                ].map((provider) => (
                  <div key={provider.name} className={`rounded-lg border p-4 text-center ${provider.color}`}>
                    <p className="font-semibold text-sm">{provider.name}</p>
                    <p className="text-xs text-muted mt-1">{provider.desc}</p>
                    <Badge variant="outline" className="text-[10px] mt-2">Available on Enterprise</Badge>
                  </div>
                ))}
              </div>
              <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Enable SSO</p>
                    <p className="text-xs text-muted">Allow team members to sign in with your company identity provider</p>
                  </div>
                  <Badge variant="secondary" className="text-xs">Enterprise Plan</Badge>
                </div>
                <div className="space-y-2 opacity-50">
                  <div className="space-y-1">
                    <Label className="text-xs">SAML Entity ID</Label>
                    <Input placeholder="https://your-idp.com/entity-id" disabled />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">SSO Login URL</Label>
                    <Input placeholder="https://your-idp.com/sso/saml" disabled />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">X.509 Certificate</Label>
                    <Input placeholder="Paste your IdP certificate" disabled />
                  </div>
                </div>
                <p className="text-xs text-muted">
                  Contact support to configure SSO for your organization. We support SAML 2.0 and OpenID Connect.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="data" className="space-y-6 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Export Data</CardTitle>
              <CardDescription>Download all your organization data as CSV</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted mb-4">
                Export includes: People, Departments, Tasks, SOPs, Reviews, Meetings, KRAs, and Activity logs.
              </p>
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => window.open("/api/export/all", "_blank")}
              >
                <Download size={14} /> Export All Data
              </Button>
            </CardContent>
          </Card>

          <Card className="border-red-500/20">
            <CardHeader>
              <CardTitle className="text-base text-red-400 flex items-center gap-2">
                <AlertTriangle size={16} /> Danger Zone
              </CardTitle>
              <CardDescription>Irreversible actions. Proceed with extreme caution.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4">
                <h4 className="text-sm font-medium text-red-400">Delete Organization</h4>
                <p className="text-xs text-muted mt-1">
                  Permanently delete this organization and all associated data. This action cannot be undone.
                </p>
                <Button
                  variant="destructive"
                  size="sm"
                  className="mt-3 gap-2"
                  onClick={() => setShowDeleteDialog(true)}
                >
                  <Trash2 size={14} /> Delete Organization
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Delete Organization Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-400">
              <AlertTriangle size={18} /> Delete Organization
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm">This will permanently delete <strong>{data?.organization.name}</strong> and all associated data including:</p>
            <ul className="text-sm text-muted list-disc list-inside space-y-1">
              <li>All users and their data</li>
              <li>All tasks, SOPs, KRAs, and reviews</li>
              <li>All meetings, check-ins, and activity logs</li>
              <li>All integrations and webhook logs</li>
            </ul>
            <div className="space-y-2">
              <Label className="text-red-400">Type &quot;{data?.organization.name}&quot; to confirm</Label>
              <Input
                value={deleteConfirmName}
                onChange={(e) => setDeleteConfirmName(e.target.value)}
                placeholder={data?.organization.name}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowDeleteDialog(false); setDeleteConfirmName(""); }}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={handleDeleteOrg}
              disabled={deletingOrg || deleteConfirmName !== data?.organization.name}
            >
              {deletingOrg ? "Deleting..." : "Delete Forever"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
