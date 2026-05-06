"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
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
  UserX, RotateCcw, Download, AlertTriangle, Sliders, ToggleLeft, Key, Lock,
  BookOpen, Sparkles,
} from "lucide-react";
import { SopCategoryManager } from "@/components/settings/sop-category-manager";
import { SopFoldersTagsManager } from "@/components/settings/sop-folders-tags-manager";
import { BrandingManager } from "@/components/settings/branding-manager";
import { ByokManager } from "@/components/settings/byok-manager";
import { PERMISSION_MODULES, ACCESS_LEVELS, DEFAULT_PERMISSIONS, PROTECTED_ADMIN_ROLES, type PermissionMatrix, type PermissionModule, type AccessLevel } from "@/lib/permissions";
import { invalidatePermissionCache } from "@/hooks/use-permission";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/components/ui/toast";
import { PrivacyControls } from "@/components/settings/privacy-controls";
import { PageHeader } from "@/components/dashboard/page-header";

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

function AccessControlManager() {
  const { data: session } = useSession();
  const currentAccessLevel = ((session?.user as any)?.accessLevel || "") as string;
  const [matrix, setMatrix] = useState<PermissionMatrix>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeLevel, setActiveLevel] = useState<AccessLevel>("MANAGER");
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const isAdmin = PROTECTED_ADMIN_ROLES.includes(currentAccessLevel as any);

  useEffect(() => {
    fetch("/api/permissions")
      .then((r) => r.ok ? r.json() : { matrix: null })
      .then((d) => {
        setMatrix(d.matrix || {});
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Effective value: custom matrix value, or default
  const getValue = (level: AccessLevel, mod: PermissionModule, action: string): boolean => {
    const custom = matrix?.[level]?.[mod]?.[action];
    if (custom !== undefined) return custom;
    return (DEFAULT_PERMISSIONS as any)[level]?.[mod]?.[action] ?? false;
  };

  const setValue = (level: AccessLevel, mod: PermissionModule, action: string, value: boolean) => {
    setMatrix((prev) => {
      const next = { ...prev };
      if (!next[level]) next[level] = {};
      if (!next[level]![mod]) next[level]![mod] = {};
      next[level]![mod]![action] = value;
      return next;
    });
    setDirty(true);
  };

  const resetLevel = (level: AccessLevel) => {
    setMatrix((prev) => {
      const next = { ...prev };
      delete next[level];
      return next;
    });
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/permissions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matrix }),
      });
      if (res.ok) {
        invalidatePermissionCache();
        setDirty(false);
        setSavedAt(Date.now());
        setTimeout(() => setSavedAt(null), 2500);
      }
    } finally { setSaving(false); }
  };

  if (!isAdmin) {
    return (
      <div className="text-center py-8">
        <Lock size={32} className="mx-auto text-muted mb-3" />
        <p className="text-sm text-muted">Only Company Admin can manage access control.</p>
      </div>
    );
  }

  if (loading) return <div className="h-32 bg-surface-2 rounded animate-pulse" />;

  const isProtected = PROTECTED_ADMIN_ROLES.includes(activeLevel);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <p className="text-xs text-muted">
            Choose a role on the left, then toggle which modules and actions they can access.
            Changes apply immediately to all users with that role.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {savedAt && <span className="text-xs text-green-400">✓ Saved</span>}
          <Button size="sm" onClick={save} disabled={!dirty || saving}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </div>

      <div className="flex gap-4">
        {/* Roles list (left) */}
        <div className="w-48 shrink-0 space-y-1">
          <p className="text-[10px] uppercase tracking-wider text-muted mb-2 px-2">Roles</p>
          {ACCESS_LEVELS.map((al) => {
            const isActive = activeLevel === al.value;
            const protectedRole = PROTECTED_ADMIN_ROLES.includes(al.value);
            return (
              <button
                key={al.value}
                onClick={() => setActiveLevel(al.value)}
                className={`w-full text-left px-2 py-1.5 rounded-md text-xs transition-colors ${isActive ? "bg-[rgba(212,255,46,0.1)] text-[#d4ff2e]" : "hover:bg-surface-2 text-foreground"}`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="font-medium">{al.label}</span>
                  {protectedRole && <Lock size={10} className="text-muted" />}
                </div>
                <p className="text-[10px] text-muted truncate">{al.description}</p>
              </button>
            );
          })}
        </div>

        {/* Permissions for selected role (right) */}
        <div className="flex-1 border border-border rounded-lg overflow-hidden">
          <div className="bg-surface-2 px-4 py-2 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{ACCESS_LEVELS.find((a) => a.value === activeLevel)?.label} Permissions</p>
              {isProtected && <p className="text-[10px] text-muted">This role has full access and cannot be modified</p>}
            </div>
            {!isProtected && matrix[activeLevel] && (
              <Button variant="ghost" size="sm" className="text-xs text-muted h-6" onClick={() => resetLevel(activeLevel)}>
                Reset to defaults
              </Button>
            )}
          </div>

          <div className="max-h-[500px] overflow-y-auto p-3 space-y-3">
            {(Object.keys(PERMISSION_MODULES) as PermissionModule[]).map((mod) => {
              const moduleInfo = PERMISSION_MODULES[mod];
              const actions = Object.keys(moduleInfo.actions);
              return (
                <div key={mod} className="border border-border rounded-md p-3">
                  <p className="text-xs font-semibold text-foreground mb-2">{moduleInfo.label}</p>
                  <div className="space-y-1.5">
                    {actions.map((action) => {
                      const value = getValue(activeLevel, mod, action);
                      const description = (moduleInfo.actions as any)[action];
                      return (
                        <div key={action} className="flex items-center justify-between gap-3">
                          <span className="text-xs text-muted flex-1 min-w-0">{description}</span>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={value}
                            disabled={isProtected}
                            onClick={() => setValue(activeLevel, mod, action, !value)}
                            style={{
                              width: "36px",
                              height: "20px",
                              borderRadius: "9999px",
                              // `--color-lime-dim` (#a8cc24) — muted variant of the
                              // brand lime. Full-saturation #d4ff2e on a small pill
                              // with a white thumb was too harsh on dark UI.
                              backgroundColor: value ? "#a8cc24" : "#3f3f46",
                              position: "relative",
                              flexShrink: 0,
                              border: "none",
                              padding: 0,
                              cursor: isProtected ? "not-allowed" : "pointer",
                              opacity: isProtected ? 0.5 : 1,
                              transition: "background-color 0.2s",
                            }}
                          >
                            <span
                              style={{
                                position: "absolute",
                                top: "2px",
                                left: value ? "18px" : "2px",
                                width: "16px",
                                height: "16px",
                                borderRadius: "9999px",
                                backgroundColor: "#ffffff",
                                transition: "left 0.2s",
                                display: "block",
                              }}
                            />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function TeamMembersList() {
  const { data: session } = useSession();
  const callerLevel = ((session?.user as any)?.accessLevel || "") as string;
  const isAdmin = ["COMPANY_ADMIN", "SUPER_ADMIN"].includes(callerLevel);
  const { error: toastError } = useToast();

  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [updating, setUpdating] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [filterLevel, setFilterLevel] = useState("");

  const fetchMembers = () => {
    setLoading(true);
    fetch("/api/users?limit=200")
      .then((r) => r.ok ? r.json() : { data: [] })
      .then((d) => setMembers(Array.isArray(d) ? d : d.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchMembers(); }, []);

  const updateAccessLevel = async (userId: string, newLevel: string) => {
    setUpdating(userId);
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessLevel: newLevel }),
      });
      if (res.ok) {
        setMembers((prev) => prev.map((m) => (m.id === userId ? { ...m, accessLevel: newLevel } : m)));
        setSavedId(userId);
        setTimeout(() => setSavedId(null), 2000);
      } else {
        const err = await res.json();
        toastError(err.error || "Failed to update access level");
      }
    } finally { setUpdating(null); }
  };

  const updateManager = async (userId: string, newManagerId: string) => {
    setUpdating(userId);
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ managerId: newManagerId || null }),
      });
      if (res.ok) {
        const newMgr = newManagerId ? members.find((m) => m.id === newManagerId) : null;
        setMembers((prev) => prev.map((m) => (m.id === userId ? {
          ...m,
          managerId: newManagerId || null,
          manager: newMgr ? { id: newMgr.id, firstName: newMgr.firstName, lastName: newMgr.lastName } : null,
        } : m)));
        setSavedId(userId);
        setTimeout(() => setSavedId(null), 2000);
      } else {
        const err = await res.json();
        toastError(err.error || "Failed to update reporting manager");
      }
    } finally { setUpdating(null); }
  };

  const filtered = members.filter((m) => {
    if (filterLevel && m.accessLevel !== filterLevel) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return `${m.firstName} ${m.lastName}`.toLowerCase().includes(q) || (m.email || "").toLowerCase().includes(q);
  });

  // Group counts
  const counts: Record<string, number> = {};
  for (const m of members) counts[m.accessLevel] = (counts[m.accessLevel] || 0) + 1;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1">
          <Input
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 text-sm flex-1"
          />
          <select
            value={filterLevel}
            onChange={(e) => setFilterLevel(e.target.value)}
            className="h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground"
          >
            <option value="">All roles</option>
            {ACCESS_LEVELS.map((al) => (
              <option key={al.value} value={al.value}>{al.label} ({counts[al.value] || 0})</option>
            ))}
          </select>
        </div>
        <p className="text-xs text-muted shrink-0">{filtered.length} of {members.length} members</p>
      </div>

      {!isAdmin && (
        <div className="rounded-lg border border-orange-500/20 bg-orange-500/5 p-2.5">
          <p className="text-xs text-orange-400">View only. Only Company Admin can change access levels.</p>
        </div>
      )}

      <div className="border border-border rounded-lg overflow-hidden">
        {loading ? (
          <div className="p-4 space-y-2">
            {[1,2,3].map((i) => <div key={i} className="h-12 bg-surface-2 rounded animate-pulse" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm text-muted">No team members found</p>
          </div>
        ) : (
          <div className="divide-y divide-border max-h-[500px] overflow-y-auto">
            {filtered.map((member) => {
              const isSelf = (session?.user as any)?.id === member.id;
              const isProtectedTarget = ["SUPER_ADMIN"].includes(member.accessLevel) && callerLevel !== "SUPER_ADMIN";
              const canEdit = isAdmin && !isProtectedTarget;
              return (
                <div key={member.id} className="flex items-center gap-3 p-3 hover:bg-surface-2 transition-colors">
                  <Avatar className="h-9 w-9">
                    <AvatarFallback className="bg-[rgba(212,255,46,0.12)] text-[#d4ff2e] text-xs">
                      {member.firstName?.[0]}{member.lastName?.[0]}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{member.firstName} {member.lastName}</p>
                      {isSelf && <Badge variant="outline" className="text-[10px] px-1.5 py-0">You</Badge>}
                    </div>
                    <p className="text-xs text-muted truncate">{member.email}</p>
                  </div>
                  {member.department && (
                    <p className="text-[11px] text-muted hidden lg:block">{member.department.name}</p>
                  )}
                  <div className="flex items-center gap-2 shrink-0">
                    {savedId === member.id && <span className="text-[10px] text-green-400">Saved</span>}

                    {/* Reports To dropdown */}
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[9px] uppercase tracking-wider text-muted-2">Reports To</span>
                      <select
                        value={member.managerId || ""}
                        disabled={!isAdmin || updating === member.id || isSelf}
                        onChange={(e) => updateManager(member.id, e.target.value)}
                        className={`h-8 rounded-md border border-border bg-background px-2 text-xs min-w-[140px] ${!isAdmin ? "opacity-60 cursor-not-allowed" : ""}`}
                        title={isSelf ? "You cannot set your own reporting manager" : ""}
                      >
                        <option value="">— None —</option>
                        {(() => {
                          // Filter potential managers by the member's access level
                          const lvl = member.accessLevel;
                          const isExec = ["DIRECTOR", "VP"].includes(lvl);
                          const isMgrLvl = ["MANAGER", "TEAM_LEAD", "HR"].includes(lvl);
                          return members.filter((m) => {
                            if (m.id === member.id) return false; // can't report to self
                            if (isExec) return ["C_LEVEL", "COMPANY_ADMIN", "SUPER_ADMIN"].includes(m.accessLevel);
                            if (isMgrLvl) return ["DIRECTOR", "VP", "C_LEVEL", "COMPANY_ADMIN", "SUPER_ADMIN"].includes(m.accessLevel);
                            return ["MANAGER", "TEAM_LEAD", "HR", "DIRECTOR", "VP", "C_LEVEL", "COMPANY_ADMIN", "SUPER_ADMIN"].includes(m.accessLevel);
                          }).map((m) => (
                            <option key={m.id} value={m.id}>{m.firstName} {m.lastName}</option>
                          ));
                        })()}
                      </select>
                    </div>

                    {/* Access Level dropdown */}
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[9px] uppercase tracking-wider text-muted-2">Access Level</span>
                      <select
                        value={member.accessLevel}
                        disabled={!canEdit || updating === member.id}
                        onChange={(e) => updateAccessLevel(member.id, e.target.value)}
                        className={`h-8 rounded-md border border-border bg-background px-2 text-xs ${!canEdit ? "opacity-60 cursor-not-allowed" : ""}`}
                      >
                        {ACCESS_LEVELS.map((al) => (
                          <option key={al.value} value={al.value}>{al.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {isAdmin && (
        <div className="text-xs text-muted">
          <p>Promote a team member to <strong className="text-foreground">Company Admin</strong> to give them full access including the ability to manage Access Control.</p>
        </div>
      )}
    </div>
  );
}

function KRACategoriesManager() {
  const [categories, setCategories] = useState<any[]>([]);
  const [newCat, setNewCat] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const fetchCategories = () => {
    fetch("/api/kra-categories").then((r) => r.ok ? r.json() : []).then((d) => setCategories(Array.isArray(d) ? d : d?.data || [])).catch(() => {});
  };

  useEffect(() => { fetchCategories(); }, []);

  async function addCategory() {
    if (!newCat.trim()) return;
    const res = await fetch("/api/kra-categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newCat.trim() }) });
    if (res.ok) { setNewCat(""); fetchCategories(); }
  }

  async function deleteCategory(id: string) {
    await fetch("/api/kra-categories", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    fetchCategories();
  }

  async function saveEdit(id: string) {
    if (!editName.trim()) return;
    await fetch("/api/kra-categories", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, name: editName.trim() }) });
    setEditingId(null);
    fetchCategories();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="New category name" className="h-8 text-xs" onKeyDown={(e) => e.key === "Enter" && addCategory()} />
        <Button size="sm" onClick={addCategory} disabled={!newCat.trim()} className="text-xs h-8">Add</Button>
      </div>
      {categories.map((cat: any) => (
        <div key={cat.id} className="flex items-center justify-between border border-border rounded-lg px-3 py-2">
          {editingId === cat.id ? (
            <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-7 text-xs flex-1 mr-2" onKeyDown={(e) => e.key === "Enter" && saveEdit(cat.id)} autoFocus />
          ) : (
            <span className="text-sm">{cat.name}</span>
          )}
          <div className="flex items-center gap-1">
            {editingId === cat.id ? (
              <>
                <Button variant="ghost" size="sm" className="h-6 text-xs text-[#d4ff2e]" onClick={() => saveEdit(cat.id)}>Save</Button>
                <Button variant="ghost" size="sm" className="h-6 text-xs text-muted" onClick={() => setEditingId(null)}>Cancel</Button>
              </>
            ) : (
              <>
                <Button variant="ghost" size="sm" className="h-6 text-xs text-muted" onClick={() => { setEditingId(cat.id); setEditName(cat.name); }}>Edit</Button>
                <Button variant="ghost" size="sm" className="h-6 text-xs text-red-400" onClick={() => deleteCategory(cat.id)}>Delete</Button>
              </>
            )}
          </div>
        </div>
      ))}
      {categories.length === 0 && <p className="text-xs text-muted text-center py-4">No categories yet. Add one above.</p>}
    </div>
  );
}

function SOPCategoriesManager() {
  const [categories, setCategories] = useState<any[]>([]);
  const [newCat, setNewCat] = useState("");
  const [newSubcats, setNewSubcats] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/sop-categories").then((r) => r.ok ? r.json() : []).then((d) => setCategories(Array.isArray(d) ? d : d?.data || [])).catch(() => {});
  }, []);

  async function addCategory() {
    if (!newCat.trim()) return;
    const res = await fetch("/api/sop-categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newCat.trim() }) });
    if (res.ok) { setNewCat(""); const d = await fetch("/api/sop-categories").then((r) => r.json()); setCategories(Array.isArray(d) ? d : d?.data || []); }
  }

  async function addSubcategory(catId: string) {
    const name = newSubcats[catId]?.trim();
    if (!name) return;
    const res = await fetch("/api/sop-categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, categoryId: catId }) });
    if (res.ok) { setNewSubcats({ ...newSubcats, [catId]: "" }); const d = await fetch("/api/sop-categories").then((r) => r.json()); setCategories(Array.isArray(d) ? d : d?.data || []); }
  }

  async function deleteItem(id: string, type: string) {
    await fetch("/api/sop-categories", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, type }) });
    const d = await fetch("/api/sop-categories").then((r) => r.json());
    setCategories(Array.isArray(d) ? d : d?.data || []);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="New category name" className="h-8 text-xs" onKeyDown={(e) => e.key === "Enter" && addCategory()} />
        <Button size="sm" onClick={addCategory} disabled={!newCat.trim()} className="text-xs h-8">Add</Button>
      </div>
      {categories.map((cat: any) => (
        <div key={cat.id} className="border border-border rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">{cat.name}</span>
            <Button variant="ghost" size="sm" className="h-6 text-xs text-red-400" onClick={() => deleteItem(cat.id, "category")}>Delete</Button>
          </div>
          <div className="ml-4 space-y-1">
            {(cat.subcategories || []).map((sub: any) => (
              <div key={sub.id} className="flex items-center justify-between text-xs">
                <span className="text-muted">↳ {sub.name}</span>
                <Button variant="ghost" size="sm" className="h-5 text-[10px] text-red-400" onClick={() => deleteItem(sub.id, "subcategory")}>×</Button>
              </div>
            ))}
            <div className="flex items-center gap-1 mt-1">
              <Input value={newSubcats[cat.id] || ""} onChange={(e) => setNewSubcats({ ...newSubcats, [cat.id]: e.target.value })} placeholder="Add subcategory" className="h-6 text-[10px]" onKeyDown={(e) => e.key === "Enter" && addSubcategory(cat.id)} />
              <Button variant="ghost" size="sm" className="h-6 text-[10px] text-[#d4ff2e]" onClick={() => addSubcategory(cat.id)}>+</Button>
            </div>
          </div>
        </div>
      ))}
      {categories.length === 0 && <p className="text-xs text-muted text-center py-4">No categories yet. Add one above.</p>}
    </div>
  );
}

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
    { label: "Meets Expectations", min: 60, max: 74, color: "lime" },
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
    // Uses `--color-lime-dim` (#a8cc24) for the checked state. Full-saturation
    // brand lime (#d4ff2e) on a small pill next to a white thumb was too harsh.
    return (
      <button
        onClick={onChange}
        className={`h-6 w-11 rounded-full transition-colors ${checked ? "bg-[#a8cc24]" : "bg-border"}`}
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
        <PageHeader
          kicker="Settings · organization"
          title="Settings"
          subtitle="Manage your organization settings and preferences."
        />
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
      <PageHeader
        kicker="Settings · organization"
        title="Settings"
        subtitle="Manage your organization settings and preferences."
      />

      <Tabs defaultValue="general">
        {/* Horizontal scroll instead of wrap — there are 14 tabs and
            wrap breaks the rounded pill into a stacked mess. The
            scrollbar is hidden so it just feels like a swipeable
            strip. */}
        <div className="overflow-x-auto -mx-1 px-1 scrollbar-thin">
          <TabsList className="w-max min-w-full">
            <TabsTrigger value="general" className="gap-2"><Building2 size={14} /> General</TabsTrigger>
            <TabsTrigger value="modules" className="gap-2"><ToggleLeft size={14} /> Modules</TabsTrigger>
            <TabsTrigger value="access" className="gap-2"><Lock size={14} /> Access</TabsTrigger>
            <TabsTrigger value="team" className="gap-2"><Users size={14} /> Team</TabsTrigger>
            <TabsTrigger value="security" className="gap-2"><Shield size={14} /> Security</TabsTrigger>
            <TabsTrigger value="sso" className="gap-2"><Key size={14} /> SSO</TabsTrigger>
            <TabsTrigger value="notifications" className="gap-2"><Bell size={14} /> Notifications</TabsTrigger>
            <TabsTrigger value="sops" className="gap-2"><BookOpen size={14} /> SOPs</TabsTrigger>
            <TabsTrigger value="branding" className="gap-2"><Sparkles size={14} /> Branding</TabsTrigger>
            <TabsTrigger value="ai" className="gap-2"><Sparkles size={14} /> AI</TabsTrigger>
            <TabsTrigger value="removed" className="gap-2" onClick={() => { if (removedPeople.length === 0) fetchRemovedPeople(); }}><UserX size={14} /> Removed</TabsTrigger>
            <TabsTrigger value="billing" className="gap-2"><CreditCard size={14} /> Billing</TabsTrigger>
            <TabsTrigger value="data" className="gap-2"><Sliders size={14} /> Data</TabsTrigger>
            <TabsTrigger value="privacy" className="gap-2"><Shield size={14} /> Privacy</TabsTrigger>
          </TabsList>
        </div>

        {/* General */}
        <TabsContent value="general" className="space-y-6 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">System Configuration</CardTitle>
              <CardDescription>Timezone, currency, and fiscal year. For company profile (name, logo, mission, values), go to Organization → About.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Timezone</Label>
                  <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className="h-10 w-full appearance-none rounded-lg border border-border bg-surface pl-3 pr-8 text-sm text-foreground bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%236B6B80%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[length:16px] bg-[right_8px_center] bg-no-repeat focus:outline-none focus:ring-2 focus:ring-[#d4ff2e]">
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
                  <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="h-10 w-full appearance-none rounded-lg border border-border bg-surface pl-3 pr-8 text-sm text-foreground bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%236B6B80%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[length:16px] bg-[right_8px_center] bg-no-repeat focus:outline-none focus:ring-2 focus:ring-[#d4ff2e]">
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
                  <select value={fiscalYearStart} onChange={(e) => setFiscalYearStart(parseInt(e.target.value))} className="h-10 w-full appearance-none rounded-lg border border-border bg-surface pl-3 pr-8 text-sm text-foreground bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%236B6B80%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[length:16px] bg-[right_8px_center] bg-no-repeat focus:outline-none focus:ring-2 focus:ring-[#d4ff2e]">
                    {MONTH_NAMES.map((name, i) => (
                      <option key={i} value={i + 1}>{name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <SaveButton section="general" data={{ timezone, currency, fiscalYearStart }} />
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
                <select value={reviewFrequency} onChange={(e) => setReviewFrequency(e.target.value)} className="h-10 w-full appearance-none rounded-lg border border-border bg-surface pl-3 pr-8 text-sm text-foreground bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%236B6B80%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[length:16px] bg-[right_8px_center] bg-no-repeat focus:outline-none focus:ring-2 focus:ring-[#d4ff2e]">
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

        {/* Access Control */}
        <TabsContent value="access" className="space-y-6 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Lock size={16} /> Access Control</CardTitle>
              <CardDescription>Define what each role can do across every module. Only Company Admin can edit these.</CardDescription>
            </CardHeader>
            <CardContent>
              <AccessControlManager />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Team */}
        <TabsContent value="team" className="space-y-6 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Team Members & Access Levels</CardTitle>
              <CardDescription>View all team members and assign their access level. Promote a member to Company Admin to give them full system control.</CardDescription>
            </CardHeader>
            <CardContent>
              <TeamMembersList />
            </CardContent>
          </Card>

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
              <div className="flex items-center justify-between rounded-lg border border-[rgba(212,255,46,0.2)] bg-[rgba(212,255,46,0.06)] p-3">
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
              <div className="flex items-center justify-between rounded-lg border border-[rgba(212,255,46,0.3)] bg-[rgba(212,255,46,0.06)] p-4">
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
                          className={`h-full rounded-full transition-all ${isOver ? "bg-red-500" : "bg-[#d4ff2e]"}`}
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

          {/* KRA Categories Management */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">KRA Categories</CardTitle>
              <CardDescription>Manage categories used in KRAs. AI-generated KRAs will also auto-create categories here.</CardDescription>
            </CardHeader>
            <CardContent>
              <KRACategoriesManager />
            </CardContent>
          </Card>

          {/* SOP Categories Management */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">SOP Categories & Subcategories</CardTitle>
              <CardDescription>Manage categories used in SOPs</CardDescription>
            </CardHeader>
            <CardContent>
              <SOPCategoriesManager />
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

        {/* SOPs — categories + subcategories are the primary
            organisational taxonomy. Folders + tags get a secondary
            management card below. */}
        <TabsContent value="sops" className="space-y-4 mt-4">
          <SopCategoryManager />
          <SopFoldersTagsManager />
        </TabsContent>

        {/* Branding — Enterprise white-label add-on. The component
            shows an upsell card if the customer's org doesn't have
            features.whiteLabel enabled. */}
        <TabsContent value="branding" className="space-y-4 mt-4">
          <BrandingManager />
        </TabsContent>

        {/* AI & Integrations — BYOK Enterprise add-on. Same upsell
            pattern: component handles the gate itself. */}
        <TabsContent value="ai" className="space-y-4 mt-4">
          <ByokManager />
        </TabsContent>

        {/* Privacy — user-level DSR controls (GDPR Art. 15/17, CCPA) */}
        <TabsContent value="privacy" className="space-y-4 mt-4">
          <PrivacyControls />
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
