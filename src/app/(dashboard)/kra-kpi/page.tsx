"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useRole } from "@/hooks/use-role";
import { useSession } from "next-auth/react";
import { MonthlyKpiRecorder } from "@/components/kpi/monthly-kpi-recorder";
import { KraPicker } from "@/components/ui/kra-picker";
import { KraCategoryPicker } from "@/components/kra-category-picker";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Target, Plus, TrendingUp, TrendingDown, Minus, BarChart3, ChevronRight, ChevronDown, Users,
  Pencil, Trash2, UserPlus, AlertTriangle, Sparkles, Loader2, X, Search,
} from "lucide-react";
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem,
  ContextMenuSeparator, ContextMenuLabel,
} from "@/components/ui/context-menu";

interface Kra {
  id: string;
  name: string;
  description?: string;
  category: string;
  roleId?: string;
  role?: { id: string; title: string };
  kpis: Kpi[];
  _count?: { assignments?: number };
}

interface Kpi {
  id: string;
  name: string;
  description?: string;
  type?: string;
  unit?: string;
  frequency?: string;
  targetValue?: number | null;
  kraId?: string;
  kra?: { id: string; name: string };
  records?: any[];
}

interface KpiRecord {
  id: string;
  kpi?: { name: string; kra?: { name: string }; unit?: string; lowerIsBetter?: boolean };
  user?: { firstName: string; lastName: string; department?: { name: string } };
  period: string;
  targetValue: number;
  actualValue: number;
  score?: number;
  notes?: string;
}

interface KraAssignment {
  id: string;
  userId: string;
  kraId: string;
  weightage: number;
  period: string;
  status: string;
  kra: { id: string; name: string; category: string; kpis?: any[] };
  user: { id: string; firstName: string; lastName: string };
}

interface Role {
  id: string;
  title: string;
  name?: string;
}

interface UserOption {
  id: string;
  firstName: string;
  lastName: string;
}

function getScoreColor(score: number) {
  if (score >= 90) return "text-green-400";
  if (score >= 70) return "text-[color:var(--accent-strong)]";
  if (score >= 50) return "text-orange-400";
  return "text-red-400";
}

function getScoreBg(score: number) {
  if (score >= 90) return "bg-green-500";
  if (score >= 70) return "bg-violet-600";
  if (score >= 50) return "bg-orange-500";
  return "bg-red-500";
}

function getProgressColor(pct: number) {
  if (pct >= 90) return "bg-green-500";
  if (pct >= 70) return "bg-yellow-500";
  return "bg-red-500";
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 p-4 animate-pulse">
      <div className="h-4 bg-border rounded w-1/4" />
      <div className="h-4 bg-border rounded w-1/6" />
      <div className="h-4 bg-border rounded w-1/6" />
      <div className="h-4 bg-border rounded w-1/12" />
    </div>
  );
}

function SkeletonKpiCard() {
  return (
    <Card>
      <CardContent className="p-4 animate-pulse">
        <div className="space-y-3">
          <div className="h-4 bg-border rounded w-2/3" />
          <div className="h-3 bg-border rounded w-1/3" />
          <div className="h-6 bg-border rounded w-1/4" />
          <div className="h-1.5 bg-border rounded w-full" />
        </div>
      </CardContent>
    </Card>
  );
}

function EmployeeKraView({ userId }: { userId: string }) {
  return (
    <div className="space-y-3 animate-fade-in">
      <PageHeader
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "KRA & KPIs" }]}
        kicker="Your numbers"
        title="My KRAs & KPIs"
        subtitle="Your performance metrics and targets — updated live."
      />
      <MonthlyKpiRecorder userId={userId} />
    </div>
  );
}

export default function KraKpiPage() {
  const { isEmployee, isManager: isManagerRole } = useRole();
  const { data: session } = useSession();
  const currentUserId = (session?.user as any)?.id;

  // Dialog states
  const [showAddKraDialog, setShowAddKraDialog] = useState(false);
  const [showRecordKpiDialog, setShowRecordKpiDialog] = useState(false);
  const [showAddKpiDialog, setShowAddKpiDialog] = useState(false);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [showEditKraDialog, setShowEditKraDialog] = useState(false);
  const [showEditKpiDialog, setShowEditKpiDialog] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<{ type: "kra" | "kpi" | "assignment"; id: string } | null>(null);

  // AI generation state
  const [showAiDialog, setShowAiDialog] = useState(false);
  const [aiJobTitle, setAiJobTitle] = useState("");
  const [aiJobDescription, setAiJobDescription] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiResults, setAiResults] = useState<any[] | null>(null);

  // Data state
  const [kras, setKras] = useState<Kra[]>([]);
  // Free-text search across KRA name, description, category, and any
  // contained KPI name. Lets users find an item without scrolling
  // through the full list when they have dozens.
  const [kraSearch, setKraSearch] = useState("");
  const [kpis, setKpis] = useState<Kpi[]>([]);
  const [kpiRecords, setKpiRecords] = useState<KpiRecord[]>([]);
  const [assignments, setAssignments] = useState<KraAssignment[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [kraCategories, setKraCategories] = useState<{ id: string; name: string }[]>([]);

  // Loading state
  const [loadingKras, setLoadingKras] = useState(true);
  const [loadingKpis, setLoadingKpis] = useState(true);
  const [loadingRecords, setLoadingRecords] = useState(true);
  const [loadingAssignments, setLoadingAssignments] = useState(true);

  // KRA form state
  const [kraName, setKraName] = useState("");
  const [kraDescription, setKraDescription] = useState("");
  const [kraCategory, setKraCategory] = useState("");
  const [kraRoleId, setKraRoleId] = useState("");
  const [editingKra, setEditingKra] = useState<Kra | null>(null);
  const [savingKra, setSavingKra] = useState(false);

  // Inline KPIs for KRA creation
  interface InlineKpi {
    id: string;
    name: string;
    type: string;
    unit: string;
    targetValue: string;
    frequency: string;
    description: string;
  }
  const [inlineKpis, setInlineKpis] = useState<InlineKpi[]>([]);

  function addInlineKpi() {
    setInlineKpis([...inlineKpis, {
      id: `tmp_${Date.now()}`,
      name: "",
      type: "QUANTITATIVE",
      unit: "",
      targetValue: "",
      frequency: "MONTHLY",
      description: "",
    }]);
  }

  function updateInlineKpi(id: string, field: keyof InlineKpi, value: string) {
    setInlineKpis(inlineKpis.map((k) => k.id === id ? { ...k, [field]: value } : k));
  }

  function removeInlineKpi(id: string) {
    setInlineKpis(inlineKpis.filter((k) => k.id !== id));
  }

  // KPI form state
  const [kpiName, setKpiName] = useState("");
  const [kpiDescription, setKpiDescription] = useState("");
  const [kpiType, setKpiType] = useState("QUANTITATIVE");
  const [kpiUnit, setKpiUnit] = useState("");
  const [kpiFrequency, setKpiFrequency] = useState("MONTHLY");
  const [kpiTargetValue, setKpiTargetValue] = useState("");
  const [kpiLowerIsBetter, setKpiLowerIsBetter] = useState(false);
  const [kpiKraId, setKpiKraId] = useState("");
  const [editingKpi, setEditingKpi] = useState<Kpi | null>(null);
  const [savingKpi, setSavingKpi] = useState(false);
  const [expandedKraIds, setExpandedKraIds] = useState<Set<string>>(new Set());

  function toggleExpandKra(kraId: string) {
    setExpandedKraIds((prev) => {
      const next = new Set(prev);
      if (next.has(kraId)) next.delete(kraId);
      else next.add(kraId);
      return next;
    });
  }

  // Assignment form state
  const [assignUserId, setAssignUserId] = useState("");
  const [assignKraId, setAssignKraId] = useState("");
  const [assignWeightage, setAssignWeightage] = useState("");
  const [assignPeriod, setAssignPeriod] = useState("");

  // Multi-KRA assignment
  const [multiAssignKras, setMultiAssignKras] = useState<{ kraId: string; weightage: string }[]>([]);
  const [savingAssignment, setSavingAssignment] = useState(false);

  // KPI Record form state
  const [recordKpiId, setRecordKpiId] = useState("");
  const [recordUserId, setRecordUserId] = useState("");
  const [recordPeriod, setRecordPeriod] = useState("");
  const [recordTargetValue, setRecordTargetValue] = useState("");
  const [recordActualValue, setRecordActualValue] = useState("");
  const [recordNotes, setRecordNotes] = useState("");
  const [savingRecord, setSavingRecord] = useState(false);

  const { success: toastSuccess, error: toastError } = useToast();

  const fetchKras = useCallback(async () => {
    try {
      setLoadingKras(true);
      const res = await fetch("/api/kras?limit=500");
      if (res.ok) {
        const data = await res.json();
        setKras(Array.isArray(data) ? data : data.kras ?? data.data ?? []);
      }
    } catch {} finally { setLoadingKras(false); }
  }, []);

  const fetchKpis = useCallback(async () => {
    try {
      setLoadingKpis(true);
      const res = await fetch("/api/kpis");
      if (res.ok) {
        const data = await res.json();
        setKpis(Array.isArray(data) ? data : data.kpis ?? data.data ?? []);
      }
    } catch {} finally { setLoadingKpis(false); }
  }, []);

  const fetchKpiRecords = useCallback(async () => {
    try {
      setLoadingRecords(true);
      const res = await fetch("/api/kpi-records?limit=200");
      if (res.ok) {
        const data = await res.json();
        setKpiRecords(Array.isArray(data) ? data : data.records ?? data.data ?? []);
      }
    } catch {} finally { setLoadingRecords(false); }
  }, []);

  const fetchAssignments = useCallback(async () => {
    try {
      setLoadingAssignments(true);
      const res = await fetch("/api/kra-assignments?all=true");
      if (res.ok) {
        const data = await res.json();
        setAssignments(Array.isArray(data) ? data : data.assignments ?? data.data ?? []);
      }
    } catch {} finally { setLoadingAssignments(false); }
  }, []);

  const fetchRoles = useCallback(async () => {
    try {
      const res = await fetch("/api/roles");
      if (res.ok) {
        const data = await res.json();
        setRoles(Array.isArray(data) ? data : data.roles ?? data.data ?? []);
      }
    } catch {}
  }, []);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/users?limit=500");
      if (res.ok) {
        const data = await res.json();
        setUsers(Array.isArray(data) ? data : data.users ?? data.data ?? []);
      }
    } catch {}
  }, []);

  const fetchKraCategories = useCallback(async () => {
    try {
      const res = await fetch("/api/kra-categories");
      if (res.ok) {
        const data = await res.json();
        setKraCategories(Array.isArray(data) ? data : data.data ?? []);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchKras();
    fetchKpis();
    fetchKpiRecords();
    fetchAssignments();
    fetchRoles();
    fetchUsers();
    fetchKraCategories();
  }, [fetchKras, fetchKpis, fetchKpiRecords, fetchAssignments, fetchRoles, fetchUsers, fetchKraCategories]);

  // Employee view — show only their assigned KPIs (after all hooks)
  if (isEmployee && currentUserId) {
    return <EmployeeKraView userId={currentUserId} />;
  }

  // --- Handlers ---

  const handleCreateKra = async () => {
    if (!kraName.trim()) return;
    setSavingKra(true);
    try {
      const res = await fetch("/api/kras", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: kraName, description: kraDescription, category: kraCategory || undefined }),
      });
      if (!res.ok) throw new Error("Failed to create KRA");
      const kraData = await res.json();
      const createdKra = kraData.data || kraData;

      // Create inline KPIs under this KRA
      const validKpis = inlineKpis.filter((k) => k.name.trim());
      for (const kpi of validKpis) {
        await fetch("/api/kpis", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: kpi.name,
            description: kpi.description || undefined,
            type: kpi.type,
            unit: kpi.unit || undefined,
            frequency: kpi.frequency,
            targetValue: kpi.targetValue ? Number(kpi.targetValue) : undefined,
            kraId: createdKra.id,
          }),
        });
      }

      setShowAddKraDialog(false);
      resetKraForm();
      await Promise.all([fetchKras(), fetchKpis()]);
      toastSuccess(`KRA created with ${validKpis.length} KPI${validKpis.length !== 1 ? "s" : ""}`);
    } catch { toastError("Failed to create KRA"); } finally { setSavingKra(false); }
  };

  const handleEditKra = async () => {
    if (!editingKra || !kraName.trim()) return;
    setSavingKra(true);
    try {
      const res = await fetch("/api/kras", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingKra.id, name: kraName, description: kraDescription, category: kraCategory, roleId: kraRoleId || null }),
      });
      if (res.ok) {
        setShowEditKraDialog(false);
        resetKraForm();
        await fetchKras();
        toastSuccess("KRA updated");
      }
    } catch { toastError("Failed to update KRA"); } finally { setSavingKra(false); }
  };

  const handleDeleteKra = async (id: string) => {
    try {
      const res = await fetch(`/api/kras?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        setShowDeleteConfirm(null);
        await fetchKras();
        toastSuccess("KRA deleted");
      }
    } catch { toastError("Failed to delete KRA"); }
  };

  const handleCreateKpi = async () => {
    if (!kpiName.trim()) return;
    setSavingKpi(true);
    try {
      const res = await fetch("/api/kpis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: kpiName, description: kpiDescription, type: kpiType, unit: kpiUnit || undefined, frequency: kpiFrequency, targetValue: kpiTargetValue ? Number(kpiTargetValue) : undefined, lowerIsBetter: kpiLowerIsBetter, kraId: kpiKraId || undefined }),
      });
      if (res.ok) {
        setShowAddKpiDialog(false);
        resetKpiForm();
        await fetchKpis();
        await fetchKras();
        toastSuccess("KPI created successfully");
      }
    } catch { toastError("Failed to create KPI"); } finally { setSavingKpi(false); }
  };

  const handleEditKpi = async () => {
    if (!editingKpi || !kpiName.trim()) return;
    setSavingKpi(true);
    try {
      const res = await fetch("/api/kpis", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingKpi.id, name: kpiName, description: kpiDescription, type: kpiType, unit: kpiUnit, frequency: kpiFrequency, targetValue: kpiTargetValue ? Number(kpiTargetValue) : null, lowerIsBetter: kpiLowerIsBetter, kraId: kpiKraId || null }),
      });
      if (res.ok) {
        setShowEditKpiDialog(false);
        resetKpiForm();
        await fetchKpis();
        toastSuccess("KPI updated");
      }
    } catch { toastError("Failed to update KPI"); } finally { setSavingKpi(false); }
  };

  const handleDeleteKpi = async (id: string) => {
    try {
      const res = await fetch(`/api/kpis?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        setShowDeleteConfirm(null);
        await fetchKpis();
        await fetchKras();
        toastSuccess("KPI deleted");
      }
    } catch { toastError("Failed to delete KPI"); }
  };

  const handleAssign = async () => {
    const kraList = multiAssignKras.length > 0 ? multiAssignKras : (assignKraId ? [{ kraId: assignKraId, weightage: assignWeightage }] : []);
    if (!assignUserId || kraList.length === 0) return;
    setSavingAssignment(true);
    try {
      let allOk = true;
      for (const entry of kraList) {
        if (!entry.kraId || !entry.weightage) continue;
        const res = await fetch("/api/kra-assignments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: assignUserId, kraId: entry.kraId, weightage: parseFloat(entry.weightage) }),
        });
        if (!res.ok) {
          const data = await res.json();
          toastError(data.error || `Failed to assign KRA`);
          allOk = false;
        }
      }
      if (allOk) {
        setShowAssignDialog(false);
        resetAssignForm();
        await fetchAssignments();
        toastSuccess(`${kraList.length} KRA${kraList.length > 1 ? "s" : ""} assigned successfully`);
      }
    } catch { toastError("Failed to assign KRA"); } finally { setSavingAssignment(false); }
  };

  const handleDeleteAssignment = async (id: string) => {
    try {
      const res = await fetch(`/api/kra-assignments/${id}`, { method: "DELETE" });
      if (res.ok) {
        setShowDeleteConfirm(null);
        await fetchAssignments();
        toastSuccess("Assignment removed");
      }
    } catch { toastError("Failed to remove assignment"); }
  };

  const handleRecordKpi = async () => {
    if (!recordKpiId || !recordUserId) return;
    setSavingRecord(true);
    try {
      const res = await fetch("/api/kpi-records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kpiId: recordKpiId, userId: recordUserId, period: recordPeriod || undefined,
          targetValue: recordTargetValue ? parseFloat(recordTargetValue) : undefined,
          actualValue: recordActualValue ? parseFloat(recordActualValue) : undefined,
          notes: recordNotes || undefined,
        }),
      });
      if (res.ok) {
        setShowRecordKpiDialog(false);
        resetRecordForm();
        await fetchKpiRecords();
        toastSuccess("KPI record logged");
      }
    } catch { toastError("Failed to log KPI record"); } finally { setSavingRecord(false); }
  };

  function resetKraForm() { setKraName(""); setKraDescription(""); setKraCategory(""); setKraRoleId(""); setEditingKra(null); setInlineKpis([]); }
  function resetKpiForm() { setKpiName(""); setKpiDescription(""); setKpiType("QUANTITATIVE"); setKpiUnit(""); setKpiFrequency("MONTHLY"); setKpiTargetValue(""); setKpiLowerIsBetter(false); setKpiKraId(""); setEditingKpi(null); }
  function resetAssignForm() { setAssignUserId(""); setAssignKraId(""); setAssignWeightage(""); setAssignPeriod(""); setMultiAssignKras([]); }
  function resetRecordForm() { setRecordKpiId(""); setRecordUserId(""); setRecordPeriod(""); setRecordTargetValue(""); setRecordActualValue(""); setRecordNotes(""); }

  // AI KRA/KPI Generation
  const handleAiGenerate = async () => {
    if (!aiJobTitle.trim()) return;
    setAiGenerating(true);
    setAiResults(null);
    try {
      const res = await fetch("/api/kras/ai-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobTitle: aiJobTitle, jobDescription: aiJobDescription }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toastError(data?.error || "AI generation failed. Try again.");
        return;
      }
      const kras = data.data?.kras || data.kras || [];
      setAiResults(kras);
    } catch (e: any) {
      toastError(e?.message || "AI generation failed. Try again.");
    } finally { setAiGenerating(false); }
  };

  const handleAiResultEdit = (kraIdx: number, field: string, value: string) => {
    if (!aiResults) return;
    const updated = [...aiResults];
    updated[kraIdx] = { ...updated[kraIdx], [field]: value };
    setAiResults(updated);
  };

  const handleAiKpiEdit = (kraIdx: number, kpiIdx: number, field: string, value: any) => {
    if (!aiResults) return;
    const updated = [...aiResults];
    const kpis = [...updated[kraIdx].kpis];
    kpis[kpiIdx] = { ...kpis[kpiIdx], [field]: value };
    updated[kraIdx] = { ...updated[kraIdx], kpis };
    setAiResults(updated);
  };

  const handleAiRemoveKra = (kraIdx: number) => {
    if (!aiResults) return;
    setAiResults(aiResults.filter((_, i) => i !== kraIdx));
  };

  const handleAiRemoveKpi = (kraIdx: number, kpiIdx: number) => {
    if (!aiResults) return;
    const updated = [...aiResults];
    updated[kraIdx] = { ...updated[kraIdx], kpis: updated[kraIdx].kpis.filter((_: any, i: number) => i !== kpiIdx) };
    setAiResults(updated);
  };

  const handleAiSaveAll = async () => {
    if (!aiResults || aiResults.length === 0) return;
    setSavingKra(true);
    try {
      // Auto-create any new categories from AI results
      const existingCatNames = new Set(kraCategories.map((c) => c.name));
      const newCatNames = new Set(aiResults.map((k: any) => k.category?.trim()).filter((c: string) => c && !existingCatNames.has(c)));
      for (const catName of newCatNames) {
        await fetch("/api/kra-categories", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: catName }),
        });
      }

      let totalKpis = 0;
      for (const kra of aiResults) {
        const res = await fetch("/api/kras", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: kra.name, description: kra.description, category: kra.category || undefined }),
        });
        if (!res.ok) throw new Error("Failed to create KRA");
        const kraData = await res.json();
        const createdKra = kraData.data || kraData;

        for (const kpi of kra.kpis) {
          if (!kpi.name?.trim()) continue;
          await fetch("/api/kpis", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: kpi.name,
              description: kpi.description || undefined,
              type: kpi.type || "QUANTITATIVE",
              unit: kpi.unit || undefined,
              frequency: kpi.frequency || "MONTHLY",
              targetValue: kpi.targetValue ? Number(kpi.targetValue) : undefined,
              lowerIsBetter: kpi.lowerIsBetter === true,
              kraId: createdKra.id,
            }),
          });
          totalKpis++;
        }
      }
      setShowAiDialog(false);
      setAiResults(null);
      setAiJobTitle("");
      setAiJobDescription("");
      await Promise.all([fetchKras(), fetchKpis(), fetchKraCategories()]);
      toastSuccess(`Created ${aiResults.length} KRAs with ${totalKpis} KPIs`);
    } catch { toastError("Failed to save KRAs"); } finally { setSavingKra(false); }
  };

  function openEditKra(kra: Kra) {
    setEditingKra(kra);
    setKraName(kra.name);
    setKraDescription(kra.description || "");
    setKraCategory(kra.category || "");
    setKraRoleId(kra.role?.id || kra.roleId || "");
    setShowEditKraDialog(true);
  }

  function openEditKpi(kpi: Kpi) {
    setEditingKpi(kpi);
    setKpiName(kpi.name);
    setKpiDescription(kpi.description || "");
    setKpiType(kpi.type || "QUANTITATIVE");
    setKpiUnit(kpi.unit || "");
    setKpiFrequency(kpi.frequency || "MONTHLY");
    setKpiTargetValue(kpi.targetValue != null ? String(kpi.targetValue) : "");
    setKpiLowerIsBetter((kpi as any).lowerIsBetter === true);
    setKpiKraId(kpi.kraId || kpi.kra?.id || "");
    setShowEditKpiDialog(true);
  }

  function openAssignForKra(kraId: string) {
    setAssignKraId(kraId);
    setMultiAssignKras([{ kraId, weightage: "" }]);
    setShowAssignDialog(true);
  }

  function openRecordForKpi(kpi: Kpi) {
    resetRecordForm();
    setRecordKpiId(kpi.id);
    if (kpi.targetValue != null) setRecordTargetValue(String(kpi.targetValue));
    // Default period to current month (e.g., "Mar 2026")
    const now = new Date();
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    setRecordPeriod(`${monthNames[now.getMonth()]} ${now.getFullYear()}`);
    setShowRecordKpiDialog(true);
  }

  // Build overview data from KPI records
  const overviewRecords = kpiRecords.map((rec) => {
    const name = rec.kpi?.name ?? "KPI";
    const kraName = rec.kpi?.kra?.name ?? "";
    const unit = rec.kpi?.unit ?? "";
    const lowerIsBetter = rec.kpi?.lowerIsBetter === true;
    const target = rec.targetValue ?? 0;
    const actual = rec.actualValue ?? 0;
    const period = rec.period ?? "";
    let achievement = 0;
    if (target > 0) {
      if (lowerIsBetter) {
        achievement = actual === 0 ? 120 : Math.min(Math.round((target / actual) * 100), 120);
      } else {
        achievement = Math.min(Math.round((actual / target) * 100), 120);
      }
    }
    return { name, kraName, unit, target, actual, period, achievement, lowerIsBetter };
  });

  // Scores grouped by user
  const userScoreMap = new Map<string, { name: string; department: string; scores: number[] }>();
  kpiRecords.forEach((rec) => {
    if (!rec.user) return;
    const key = `${rec.user.firstName} ${rec.user.lastName}`;
    if (!userScoreMap.has(key)) {
      userScoreMap.set(key, { name: `${rec.user.firstName} ${rec.user.lastName?.[0] ?? ""}.`, department: rec.user.department?.name ?? "", scores: [] });
    }
    const target = rec.targetValue ?? 0;
    const actual = rec.actualValue ?? 0;
    const lib = rec.kpi?.lowerIsBetter === true;
    if (target > 0) {
      const score = lib
        ? (actual === 0 ? 120 : Math.min(Math.round((target / actual) * 100), 120))
        : Math.min(Math.round((actual / target) * 100), 120);
      userScoreMap.get(key)!.scores.push(score);
    }
  });

  const teamScores = Array.from(userScoreMap.values())
    .map((entry) => {
      const avg = entry.scores.length > 0 ? Math.round(entry.scores.reduce((a, b) => a + b, 0) / entry.scores.length) : 0;
      return { name: entry.name, department: entry.department, kraScore: avg, kpiScore: avg, overall: avg, status: avg >= 90 ? "green" : avg >= 70 ? "yellow" : "red" };
    })
    .sort((a, b) => b.overall - a.overall);

  // Group assignments by user for the Assignments tab
  const assignmentsByUser = new Map<string, { user: { id: string; firstName: string; lastName: string }; assignments: KraAssignment[]; totalWeightage: number }>();
  assignments.forEach((a) => {
    const key = a.userId;
    if (!assignmentsByUser.has(key)) {
      assignmentsByUser.set(key, { user: a.user, assignments: [], totalWeightage: 0 });
    }
    const entry = assignmentsByUser.get(key)!;
    entry.assignments.push(a);
    entry.totalWeightage += a.weightage;
  });

  const kraFormFields = (isCreate: boolean = false) => (
    <div className="space-y-4 py-4">
      <div className="space-y-2">
        <Label>KRA Name <span className="text-red-400">*</span></Label>
        <Input placeholder="e.g., Revenue Generation" value={kraName} onChange={(e) => setKraName(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Category</Label>
          <KraCategoryPicker
            categories={kraCategories}
            value={kraCategory}
            onChange={setKraCategory}
            onCategoriesChanged={fetchKraCategories}
          />
        </div>
        <div className="space-y-2">
          <Label>Description</Label>
          <Input placeholder="Brief description" value={kraDescription} onChange={(e) => setKraDescription(e.target.value)} />
        </div>
      </div>

      {/* Inline KPIs — only on create */}
      {isCreate && (
        <div className="space-y-3 pt-2 border-t border-border">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">KPIs</Label>
            <Button variant="ghost" size="sm" className="text-xs text-[color:var(--accent-strong)] h-6 gap-1" onClick={addInlineKpi}>
              <Plus size={12} /> Add KPI
            </Button>
          </div>
          {inlineKpis.length === 0 && (
            <p className="text-xs text-muted-2 text-center py-2">Add KPIs to measure this KRA</p>
          )}
          {inlineKpis.map((kpi, idx) => (
            <div key={kpi.id} className="rounded-lg border border-border bg-surface-3 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-2">KPI {idx + 1}</span>
                <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-red-400" onClick={() => removeInlineKpi(kpi.id)}>
                  <Trash2 size={10} />
                </Button>
              </div>
              <Input
                placeholder="KPI name"
                value={kpi.name}
                onChange={(e) => updateInlineKpi(kpi.id, "name", e.target.value)}
                className="h-8 text-sm bg-transparent border-border"
              />
              <div className="grid grid-cols-3 gap-2">
                <Select value={kpi.unit} onValueChange={(v) => updateInlineKpi(kpi.id, "unit", v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Unit" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="%">%</SelectItem>
                    <SelectItem value="count">Count</SelectItem>
                    <SelectItem value="₹">₹</SelectItem>
                    <SelectItem value="hours">Hours</SelectItem>
                    <SelectItem value="days">Days</SelectItem>
                    <SelectItem value="rating">Rating</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  placeholder="Target"
                  value={kpi.targetValue}
                  onChange={(e) => updateInlineKpi(kpi.id, "targetValue", e.target.value)}
                  className="h-8 text-xs bg-transparent border-border"
                />
                <Select value={kpi.frequency} onValueChange={(v) => updateInlineKpi(kpi.id, "frequency", v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Freq" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DAILY">Daily</SelectItem>
                    <SelectItem value="WEEKLY">Weekly</SelectItem>
                    <SelectItem value="MONTHLY">Monthly</SelectItem>
                    <SelectItem value="QUARTERLY">Quarterly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const kpiFormFields = (
    <div className="space-y-4 py-4">
      <div className="space-y-2">
        <Label>KPI Name <span className="text-red-400">*</span></Label>
        <Input placeholder="e.g., Monthly Revenue" value={kpiName} onChange={(e) => setKpiName(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label>Linked KRA</Label>
        <Select value={kpiKraId} onValueChange={setKpiKraId}>
          <SelectTrigger><SelectValue placeholder="Select KRA" /></SelectTrigger>
          <SelectContent>
            {kras.map((k) => (
              <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Type</Label>
          <Select value={kpiType} onValueChange={setKpiType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="QUANTITATIVE">Quantitative</SelectItem>
              <SelectItem value="QUALITATIVE">Qualitative</SelectItem>
              <SelectItem value="BINARY">Binary</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Frequency</Label>
          <Select value={kpiFrequency} onValueChange={setKpiFrequency}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="WEEKLY">Weekly</SelectItem>
              <SelectItem value="MONTHLY">Monthly</SelectItem>
              <SelectItem value="QUARTERLY">Quarterly</SelectItem>
              <SelectItem value="YEARLY">Yearly</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Unit</Label>
          <Select value={kpiUnit} onValueChange={setKpiUnit}>
            <SelectTrigger><SelectValue placeholder="Select unit" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="%">Percentage (%)</SelectItem>
              <SelectItem value="count">Count</SelectItem>
              <SelectItem value="₹">₹ (INR)</SelectItem>
              <SelectItem value="$">$ (USD)</SelectItem>
              <SelectItem value="hours">Hours</SelectItem>
              <SelectItem value="days">Days</SelectItem>
              <SelectItem value="rating">Rating (1-5)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Target Value</Label>
          <Input type="number" placeholder={kpiUnit === "%" ? "e.g., 95" : kpiUnit === "count" ? "e.g., 30" : "e.g., 100"} value={kpiTargetValue} onChange={(e) => setKpiTargetValue(e.target.value)} />
        </div>
      </div>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={kpiLowerIsBetter} onChange={(e) => setKpiLowerIsBetter(e.target.checked)} className="rounded" />
        <span className="text-sm">Lower is better</span>
        <span className="text-[10px] text-muted-2">(e.g., errors, complaints, response time)</span>
      </label>
      <div className="space-y-2">
        <Label>Description</Label>
        <Textarea placeholder="What does this KPI measure?" value={kpiDescription} onChange={(e) => setKpiDescription(e.target.value)} />
      </div>
    </div>
  );

  return (
    <div className="space-y-3 animate-fade-in">
      <PageHeader
        kicker="KRAs + KPIs · the measurement spine"
        title="KRA & KPIs"
        subtitle="Define, track, and score performance across your organization."
      />
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div />
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" className="gap-2" onClick={() => { resetKpiForm(); setShowAddKpiDialog(true); }}>
            <Plus size={16} /> New KPI
          </Button>
          <Button variant="outline" className="gap-2" onClick={() => setShowAssignDialog(true)}>
            <UserPlus size={16} /> Assign KRA
          </Button>
          <Button variant="outline" className="gap-2 border-[rgba(212,255,46,0.3)] text-[color:var(--accent-strong)] hover:bg-[#e2ff6b]/10" onClick={() => { setAiJobTitle(""); setAiJobDescription(""); setAiResults(null); setShowAiDialog(true); }}>
            <Sparkles size={16} /> Create with AI
          </Button>
          <Button className="gap-2" onClick={() => { resetKraForm(); setShowAddKraDialog(true); }}>
            <Plus size={16} /> New KRA
          </Button>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview" className="gap-2"><BarChart3 size={14} /> Overview</TabsTrigger>
          <TabsTrigger value="kras" className="gap-2"><Target size={14} /> KRAs</TabsTrigger>
          <TabsTrigger value="assignments" className="gap-2"><Users size={14} /> Assignments</TabsTrigger>
          <TabsTrigger value="scores" className="gap-2"><TrendingUp size={14} /> Scores</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4 mt-4">
          {loadingRecords ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[1,2,3,4].map((i) => <Card key={i}><CardContent className="p-4"><div className="h-16 bg-surface-2 rounded animate-pulse" /></CardContent></Card>)}
            </div>
          ) : overviewRecords.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <BarChart3 size={32} className="mx-auto text-muted mb-3" />
                <p className="font-medium mb-1">No KPI data yet</p>
                <p className="text-sm text-muted">Go to People → select a person → Monthly KPIs to start recording scores.</p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Summary Stats */}
              {(() => {
                const totalRecords = overviewRecords.length;
                const scoredRecords = overviewRecords.filter((r) => r.achievement > 0);
                const avgScore = scoredRecords.length > 0 ? Math.round(scoredRecords.reduce((s, r) => s + r.achievement, 0) / scoredRecords.length) : 0;
                const onTrack = scoredRecords.filter((r) => r.achievement >= 90).length;
                const needsAttention = scoredRecords.filter((r) => r.achievement >= 50 && r.achievement < 90).length;
                const critical = scoredRecords.filter((r) => r.achievement < 50).length;
                const periods = [...new Set(overviewRecords.map((r) => r.period))].sort().reverse();
                const latestPeriod = periods[0] || "";

                return (
                  <>
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-muted">
                        Showing <span className="font-medium text-foreground">{latestPeriod}</span> &middot; {teamScores.length} people scored &middot; {totalRecords} KPI records
                      </p>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <Card>
                        <CardContent className="p-4 text-center">
                          <p className={`text-3xl font-bold font-mono ${getScoreColor(avgScore)}`}>{avgScore}%</p>
                          <p className="text-xs text-muted mt-1">Avg KPI Score</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="p-4 text-center">
                          <p className="text-3xl font-bold text-green-400">{onTrack}</p>
                          <p className="text-xs text-muted mt-1">On Track (&ge;90%)</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="p-4 text-center">
                          <p className="text-3xl font-bold text-orange-400">{needsAttention}</p>
                          <p className="text-xs text-muted mt-1">Needs Attention</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="p-4 text-center">
                          <p className="text-3xl font-bold text-red-400">{critical}</p>
                          <p className="text-xs text-muted mt-1">Critical (&lt;50%)</p>
                        </CardContent>
                      </Card>
                    </div>
                  </>
                );
              })()}

              {/* People Scoreboard */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">People Scoreboard</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {teamScores.length === 0 ? (
                    <p className="p-4 text-sm text-muted text-center">No scores yet.</p>
                  ) : (
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left p-3 text-[10px] font-medium text-muted uppercase">#</th>
                          <th className="text-left p-3 text-[10px] font-medium text-muted uppercase">Person</th>
                          <th className="text-left p-3 text-[10px] font-medium text-muted uppercase">Department</th>
                          <th className="text-center p-3 text-[10px] font-medium text-muted uppercase">Score</th>
                          <th className="text-center p-3 text-[10px] font-medium text-muted uppercase">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {teamScores.map((person, idx) => (
                          <tr key={person.name} className="border-b border-border/50 hover:bg-surface-2/50 transition-colors">
                            <td className="p-3 text-xs text-muted">{idx + 1}</td>
                            <td className="p-3 text-sm font-medium">{person.name}</td>
                            <td className="p-3"><Badge variant="outline" className="text-[10px]">{person.department || "—"}</Badge></td>
                            <td className="p-3 text-center">
                              <span className={`text-sm font-mono font-bold ${getScoreColor(person.overall)}`}>{person.overall}%</span>
                            </td>
                            <td className="p-3 text-center">
                              {person.status === "green" && <Badge variant="success" className="text-[10px]">On Track</Badge>}
                              {person.status === "yellow" && <Badge variant="warning" className="text-[10px]">Attention</Badge>}
                              {person.status === "red" && <Badge variant="destructive" className="text-[10px]">Critical</Badge>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </CardContent>
              </Card>

              {/* Department Summary */}
              {(() => {
                const deptMap = new Map<string, number[]>();
                teamScores.forEach((p) => {
                  const dept = p.department || "Unassigned";
                  if (!deptMap.has(dept)) deptMap.set(dept, []);
                  deptMap.get(dept)!.push(p.overall);
                });
                const deptScores = Array.from(deptMap.entries()).map(([dept, scores]) => ({
                  dept,
                  avg: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
                  count: scores.length,
                })).sort((a, b) => b.avg - a.avg);

                if (deptScores.length <= 1) return null;

                return (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Department Performance</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {deptScores.map((d) => (
                        <div key={d.dept} className="flex items-center gap-3">
                          <span className="text-sm w-40 truncate">{d.dept}</span>
                          <Progress value={Math.min(d.avg, 100)} className="h-2 flex-1" indicatorClassName={getProgressColor(d.avg)} />
                          <span className={`text-sm font-mono font-bold w-12 text-right ${getScoreColor(d.avg)}`}>{d.avg}%</span>
                          <span className="text-[10px] text-muted w-16 text-right">{d.count} people</span>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                );
              })()}
            </>
          )}
        </TabsContent>

        {/* KRAs Tab */}
        <TabsContent value="kras" className="mt-4 space-y-3">
          {/* Search row — matches against KRA name, description,
              category, and any contained KPI name. Cheap client-side
              filter; the list is small enough that round-tripping
              isn't worth it. */}
          {kras.length > 0 && (
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <Input
                placeholder="Search KRAs and KPIs…"
                className="pl-10"
                value={kraSearch}
                onChange={(e) => setKraSearch(e.target.value)}
              />
              {kraSearch && (
                <button
                  type="button"
                  onClick={() => setKraSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          )}

          {(() => {
            const q = kraSearch.trim().toLowerCase();
            const filteredKras = q
              ? kras.filter((k) => {
                  if (k.name?.toLowerCase().includes(q)) return true;
                  if (k.description?.toLowerCase().includes(q)) return true;
                  if (k.category?.toLowerCase().includes(q)) return true;
                  if ((k.kpis ?? []).some((kpi: any) => kpi.name?.toLowerCase().includes(q))) return true;
                  return false;
                })
              : kras;

            if (loadingKras) {
              return <div className="space-y-3">{[1,2,3].map((i) => <Card key={i}><CardContent className="p-4"><div className="h-12 bg-surface-2 rounded animate-pulse" /></CardContent></Card>)}</div>;
            }
            if (kras.length === 0) {
              return (
                <Card><CardContent className="p-0">
                  <EmptyState
                    icon={Target}
                    title="No KRAs defined"
                    description="Define what success looks like for your team by creating Key Result Areas."
                    actionLabel="Create KRA"
                    onAction={() => setShowAddKraDialog(true)}
                  />
                </CardContent></Card>
              );
            }
            if (filteredKras.length === 0) {
              return (
                <Card><CardContent className="p-6 text-center text-sm text-muted">
                  No KRAs or KPIs match &ldquo;{kraSearch}&rdquo;.
                </CardContent></Card>
              );
            }
            return filteredKras.map((kra) => {
              const isExpanded = expandedKraIds.has(kra.id);
              return (
                <Card key={kra.id} className="overflow-hidden">
                  {/* KRA Header */}
                  <div className="flex items-center gap-3 p-4 hover:bg-surface-2/50 transition-colors">
                    <button onClick={() => toggleExpandKra(kra.id)} className="shrink-0 text-muted hover:text-foreground">
                      {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                    <Target size={16} className="text-[color:var(--accent-strong)] shrink-0" />
                    <div className="flex-1 min-w-0 cursor-pointer" onClick={() => toggleExpandKra(kra.id)}>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{kra.name}</span>
                        <Badge variant="outline" className="text-[10px]">{kra.category}</Badge>
                        {kra.role?.title && <span className="text-[10px] text-muted-2">{kra.role.title}</span>}
                      </div>
                      {kra.description && <p className="text-xs text-muted truncate">{kra.description}</p>}
                    </div>
                    <Badge variant="secondary" className="text-[10px] shrink-0">{kra.kpis?.length ?? 0} KPIs</Badge>
                    <span className="text-xs text-muted-2 shrink-0">{kra._count?.assignments ?? 0} assigned</span>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openAssignForKra(kra.id)} title="Assign"><UserPlus size={14} className="text-[color:var(--accent-strong)]" /></Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEditKra(kra)} title="Edit"><Pencil size={14} className="text-muted" /></Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setShowDeleteConfirm({ type: "kra", id: kra.id })} title="Delete"><Trash2 size={14} className="text-red-400" /></Button>
                    </div>
                  </div>

                  {/* Expanded KPIs */}
                  {isExpanded && (
                    <div className="border-t border-border bg-surface-3">
                      {(!kra.kpis || kra.kpis.length === 0) ? (
                        <div className="p-4 text-center text-xs text-muted">
                          No KPIs under this KRA yet.
                        </div>
                      ) : (
                        <table className="w-full">
                          <thead>
                            <tr className="border-b border-surface-2">
                              <th className="text-left px-4 py-2 text-[10px] font-medium text-muted-2 uppercase">KPI Name</th>
                              <th className="text-center px-4 py-2 text-[10px] font-medium text-muted-2 uppercase">Type</th>
                              <th className="text-center px-4 py-2 text-[10px] font-medium text-muted-2 uppercase">Unit</th>
                              <th className="text-center px-4 py-2 text-[10px] font-medium text-muted-2 uppercase">Target</th>
                              <th className="text-center px-4 py-2 text-[10px] font-medium text-muted-2 uppercase">Frequency</th>
                              <th className="text-right px-4 py-2 text-[10px] font-medium text-muted-2 uppercase">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {kra.kpis.map((kpi) => (
                              <ContextMenu key={kpi.id}>
                                <ContextMenuTrigger asChild>
                                  <tr className="border-b border-surface-2 last:border-b-0 hover:bg-surface transition-colors">
                                    <td className="px-4 py-2.5">
                                      <span className="text-sm">{kpi.name}</span>
                                      {kpi.description && <p className="text-[10px] text-muted-2 truncate max-w-xs">{kpi.description}</p>}
                                    </td>
                                    <td className="px-4 py-2.5 text-center"><Badge variant="outline" className="text-[9px]">{kpi.type}</Badge></td>
                                    <td className="px-4 py-2.5 text-center text-xs text-muted">{kpi.unit || "—"}</td>
                                    <td className="px-4 py-2.5 text-center text-xs font-mono text-[color:var(--accent-strong)]">{kpi.targetValue != null ? kpi.targetValue : "—"}</td>
                                    <td className="px-4 py-2.5 text-center text-xs text-muted">{kpi.frequency}</td>
                                    <td className="px-4 py-2.5 text-right">
                                      <div className="flex items-center justify-end gap-1">
                                        <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] gap-1 text-[color:var(--accent-strong)] hover:text-[#e2ff6b]" onClick={() => openRecordForKpi(kpi)} title="Record a value">
                                          <BarChart3 size={11} /> Record
                                        </Button>
                                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => openEditKpi(kpi)} title="Edit"><Pencil size={12} className="text-muted" /></Button>
                                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setShowDeleteConfirm({ type: "kpi", id: kpi.id })} title="Delete"><Trash2 size={12} className="text-red-400" /></Button>
                                      </div>
                                    </td>
                                  </tr>
                                </ContextMenuTrigger>
                                <ContextMenuContent>
                                  <ContextMenuLabel>KPI</ContextMenuLabel>
                                  <ContextMenuItem onSelect={() => openRecordForKpi(kpi)}>
                                    <BarChart3 size={14} /> Record value
                                  </ContextMenuItem>
                                  <ContextMenuItem onSelect={() => openEditKpi(kpi)}>
                                    <Pencil size={14} /> Edit
                                  </ContextMenuItem>
                                  <ContextMenuSeparator />
                                  <ContextMenuItem destructive onSelect={() => setShowDeleteConfirm({ type: "kpi", id: kpi.id })}>
                                    <Trash2 size={14} /> Delete
                                  </ContextMenuItem>
                                </ContextMenuContent>
                              </ContextMenu>
                            ))}
                          </tbody>
                        </table>
                      )}
                      <div className="p-3 border-t border-surface-2">
                        <Button variant="ghost" size="sm" className="w-full text-xs text-muted hover:text-[#e2ff6b] gap-1 border border-dashed border-border"
                          onClick={() => { resetKpiForm(); setKpiKraId(kra.id); setShowAddKpiDialog(true); }}>
                          <Plus size={12} /> Add KPI to {kra.name}
                        </Button>
                      </div>
                    </div>
                  )}
                </Card>
              );
            });
          })()}
        </TabsContent>

        {/* Assignments Tab */}
        <TabsContent value="assignments" className="mt-4 space-y-4">
          {loadingAssignments ? (
            <Card><CardContent className="p-0">{[1,2,3].map((i) => <SkeletonRow key={i} />)}</CardContent></Card>
          ) : assignments.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <Users size={32} className="mx-auto text-muted mb-2" />
                <p className="text-muted text-sm">No KRA assignments yet. Click &quot;Assign KRA&quot; to get started.</p>
              </CardContent>
            </Card>
          ) : (
            Array.from(assignmentsByUser.values()).map((group) => (
              <Card key={group.user.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-full bg-[rgba(212,255,46,0.12)] flex items-center justify-center text-xs font-bold text-[color:var(--accent-strong)]">
                        {group.user.firstName[0]}{group.user.lastName[0]}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{group.user.firstName} {group.user.lastName}</p>
                        <p className="text-[10px] text-muted">
                          Total weightage: <span className={group.totalWeightage === 100 ? "text-green-400" : group.totalWeightage > 100 ? "text-red-400" : "text-orange-400"}>
                            {group.totalWeightage}%
                          </span>
                          {group.totalWeightage !== 100 && (
                            <span className="ml-1">
                              {group.totalWeightage < 100 ? `(${100 - group.totalWeightage}% remaining)` : "(exceeds 100%!)"}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                    <Progress
                      value={Math.min(group.totalWeightage, 100)}
                      className="w-24 h-1.5"
                      indicatorClassName={group.totalWeightage === 100 ? "bg-green-500" : group.totalWeightage > 100 ? "bg-red-500" : "bg-orange-500"}
                    />
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="space-y-2">
                    {group.assignments.map((a) => (
                      <div key={a.id} className="flex items-center justify-between rounded-lg border border-border bg-surface p-3">
                        <div className="flex items-center gap-3">
                          <Target size={14} className="text-[color:var(--accent-strong)] flex-shrink-0" />
                          <div>
                            <p className="text-sm font-medium">{a.kra.name}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <Badge variant="outline" className="text-[10px]">{a.kra.category}</Badge>
                              <Badge className={`text-[10px] ${a.status === "ACTIVE" ? "bg-green-500/20 text-green-400" : a.status === "PAUSED" ? "bg-yellow-500/20 text-yellow-400" : "bg-slate-500/20 text-slate-400"}`}>
                                {a.status}
                              </Badge>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <p className="text-lg font-bold font-mono text-[color:var(--accent-strong)]">{a.weightage}%</p>
                            <p className="text-[10px] text-muted">weightage</p>
                          </div>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setShowDeleteConfirm({ type: "assignment", id: a.id })} title="Remove">
                            <Trash2 size={14} className="text-red-400" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* Scores Tab */}
        <TabsContent value="scores" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Performance Scores</CardTitle>
                <div className="flex items-center gap-4 text-xs">
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-green-500" /> &ge;90</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-yellow-500" /> 70-89</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500" /> &lt;70</span>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {loadingRecords ? (
                <div className="space-y-0">{[1,2,3,4].map((i) => <SkeletonRow key={i} />)}</div>
              ) : teamScores.length === 0 ? (
                <div className="p-8 text-center">
                  <p className="text-muted text-sm">No score data available yet.</p>
                </div>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left p-4 text-xs font-medium text-muted uppercase tracking-wider">Person</th>
                      <th className="text-left p-4 text-xs font-medium text-muted uppercase tracking-wider">Department</th>
                      <th className="text-center p-4 text-xs font-medium text-muted uppercase tracking-wider">KRA Score</th>
                      <th className="text-center p-4 text-xs font-medium text-muted uppercase tracking-wider">KPI Score</th>
                      <th className="text-center p-4 text-xs font-medium text-muted uppercase tracking-wider">Overall</th>
                      <th className="text-center p-4 text-xs font-medium text-muted uppercase tracking-wider">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {teamScores.map((person) => (
                      <tr key={person.name} className="border-b border-border/50 hover:bg-surface-2/50 transition-colors">
                        <td className="p-4 text-sm font-medium">{person.name}</td>
                        <td className="p-4"><Badge variant="outline" className="text-xs">{person.department}</Badge></td>
                        <td className={`p-4 text-center font-mono text-sm ${getScoreColor(person.kraScore)}`}>{person.kraScore}</td>
                        <td className={`p-4 text-center font-mono text-sm ${getScoreColor(person.kpiScore)}`}>{person.kpiScore}</td>
                        <td className={`p-4 text-center font-mono text-sm font-bold ${getScoreColor(person.overall)}`}>{person.overall}</td>
                        <td className="p-4 text-center">
                          {person.status === "green" && <Badge variant="success">On Track</Badge>}
                          {person.status === "yellow" && <Badge variant="warning">Needs Attention</Badge>}
                          {person.status === "red" && <Badge variant="destructive">Critical</Badge>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Create KRA Dialog */}
      <Dialog open={showAddKraDialog} onOpenChange={(open) => { setShowAddKraDialog(open); if (!open) resetKraForm(); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Create KRA with KPIs</DialogTitle></DialogHeader>
          {kraFormFields(true)}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddKraDialog(false)}>Cancel</Button>
            <Button onClick={handleCreateKra} disabled={savingKra || !kraName.trim()}>
              {savingKra ? "Creating..." : `Create KRA${inlineKpis.length > 0 ? ` + ${inlineKpis.length} KPIs` : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit KRA Dialog */}
      <Dialog open={showEditKraDialog} onOpenChange={(open) => { setShowEditKraDialog(open); if (!open) resetKraForm(); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit KRA</DialogTitle></DialogHeader>
          {kraFormFields(false)}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditKraDialog(false)}>Cancel</Button>
            <Button onClick={handleEditKra} disabled={savingKra || !kraName.trim()}>
              {savingKra ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create KPI Dialog */}
      <Dialog open={showAddKpiDialog} onOpenChange={(open) => { setShowAddKpiDialog(open); if (!open) resetKpiForm(); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create KPI</DialogTitle></DialogHeader>
          {kpiFormFields}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddKpiDialog(false)}>Cancel</Button>
            <Button onClick={handleCreateKpi} disabled={savingKpi || !kpiName.trim()}>
              {savingKpi ? "Creating..." : "Create KPI"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit KPI Dialog */}
      <Dialog open={showEditKpiDialog} onOpenChange={(open) => { setShowEditKpiDialog(open); if (!open) resetKpiForm(); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit KPI</DialogTitle></DialogHeader>
          {kpiFormFields}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditKpiDialog(false)}>Cancel</Button>
            <Button onClick={handleEditKpi} disabled={savingKpi || !kpiName.trim()}>
              {savingKpi ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign KRA Dialog */}
      <Dialog open={showAssignDialog} onOpenChange={(open) => { setShowAssignDialog(open); if (!open) resetAssignForm(); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Assign KRAs</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Person</Label>
              <Select value={assignUserId} onValueChange={setAssignUserId}>
                <SelectTrigger><SelectValue placeholder="Select person" /></SelectTrigger>
                <SelectContent>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.firstName} {u.lastName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* Multi-KRA Selection */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>KRAs & Weightage</Label>
                <Button variant="ghost" size="sm" className="text-xs text-[color:var(--accent-strong)] h-6" onClick={() => setMultiAssignKras([...multiAssignKras, { kraId: "", weightage: "" }])}>
                  <Plus size={12} className="mr-1" /> Add KRA
                </Button>
              </div>
              {multiAssignKras.length === 0 && (
                <div className="text-center py-4 border border-dashed border-border rounded-lg">
                  <p className="text-xs text-muted mb-2">No KRAs added yet</p>
                  <Button variant="outline" size="sm" className="text-xs gap-1" onClick={() => setMultiAssignKras([{ kraId: "", weightage: "" }])}>
                    <Plus size={12} /> Add KRA
                  </Button>
                </div>
              )}
              <div className="space-y-2">
                {multiAssignKras.map((entry, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <KraPicker
                      kras={kras}
                      value={entry.kraId}
                      onChange={(v) => {
                        const updated = [...multiAssignKras];
                        updated[idx] = { ...updated[idx], kraId: v };
                        setMultiAssignKras(updated);
                      }}
                      excludeIds={multiAssignKras.filter((_, i) => i !== idx).map((e) => e.kraId).filter(Boolean)}
                      className="flex-1"
                    />
                    <Input
                      type="number"
                      min="1"
                      max="100"
                      placeholder="%"
                      className="w-20"
                      value={entry.weightage}
                      onChange={(e) => {
                        const updated = [...multiAssignKras];
                        updated[idx] = { ...updated[idx], weightage: e.target.value };
                        setMultiAssignKras(updated);
                      }}
                    />
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-400 shrink-0" onClick={() => setMultiAssignKras(multiAssignKras.filter((_, i) => i !== idx))}>
                      <Trash2 size={12} />
                    </Button>
                  </div>
                ))}
              </div>

              {/* Weightage Total */}
              {multiAssignKras.length > 0 && (() => {
                const total = multiAssignKras.reduce((sum, e) => sum + (parseFloat(e.weightage) || 0), 0);
                const isOver = total > 100;
                const isExact = total === 100;
                return (
                  <div className={`flex items-center justify-between p-2 rounded-lg border ${isOver ? "border-red-500/30 bg-red-500/5" : isExact ? "border-green-500/30 bg-green-500/5" : "border-border"}`}>
                    <span className="text-xs text-muted">Total Weightage</span>
                    <span className={`text-sm font-mono font-bold ${isOver ? "text-red-400" : isExact ? "text-green-400" : "text-foreground"}`}>
                      {total}%
                      {isOver && <span className="text-[10px] ml-1">(exceeds 100%)</span>}
                    </span>
                  </div>
                );
              })()}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAssignDialog(false)}>Cancel</Button>
            <Button onClick={handleAssign} disabled={
              savingAssignment || !assignUserId || multiAssignKras.length === 0 ||
              multiAssignKras.some((e) => !e.kraId || !e.weightage) ||
              multiAssignKras.reduce((sum, e) => sum + (parseFloat(e.weightage) || 0), 0) > 100
            }>
              {savingAssignment ? "Assigning..." : `Assign ${multiAssignKras.length} KRA${multiAssignKras.length !== 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Record KPI Dialog */}
      <Dialog open={showRecordKpiDialog} onOpenChange={(open) => { setShowRecordKpiDialog(open); if (!open) resetRecordForm(); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record KPI Value</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>KPI</Label>
              <Select value={recordKpiId} onValueChange={setRecordKpiId}>
                <SelectTrigger><SelectValue placeholder="Select KPI" /></SelectTrigger>
                <SelectContent>
                  {kpis.map((kpi) => (
                    <SelectItem key={kpi.id} value={kpi.id}>{kpi.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>User</Label>
              <Select value={recordUserId} onValueChange={setRecordUserId}>
                <SelectTrigger><SelectValue placeholder="Select user" /></SelectTrigger>
                <SelectContent>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.firstName} {u.lastName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Period</Label>
              <Input placeholder="e.g., Mar 2026" value={recordPeriod} onChange={(e) => setRecordPeriod(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Target Value</Label>
                <Input type="number" placeholder="0" value={recordTargetValue} onChange={(e) => setRecordTargetValue(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Actual Value</Label>
                <Input type="number" placeholder="0" value={recordActualValue} onChange={(e) => setRecordActualValue(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea placeholder="Optional notes..." value={recordNotes} onChange={(e) => setRecordNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRecordKpiDialog(false)}>Cancel</Button>
            <Button onClick={handleRecordKpi} disabled={savingRecord || !recordKpiId || !recordUserId}>
              {savingRecord ? "Recording..." : "Record KPI"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={!!showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(null)}
        title={`Delete ${showDeleteConfirm?.type === "assignment" ? "Assignment" : showDeleteConfirm?.type?.toUpperCase()}`}
        description={`Are you sure you want to delete this ${showDeleteConfirm?.type === "assignment" ? "assignment" : showDeleteConfirm?.type?.toUpperCase()}? This action cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={() => {
          if (!showDeleteConfirm) return;
          if (showDeleteConfirm.type === "kra") handleDeleteKra(showDeleteConfirm.id);
          else if (showDeleteConfirm.type === "kpi") handleDeleteKpi(showDeleteConfirm.id);
          else if (showDeleteConfirm.type === "assignment") handleDeleteAssignment(showDeleteConfirm.id);
        }}
      />

      {/* AI KRA/KPI Generation Dialog */}
      <Dialog open={showAiDialog} onOpenChange={(open) => { setShowAiDialog(open); if (!open) { setAiResults(null); setAiJobTitle(""); setAiJobDescription(""); } }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles size={18} className="text-[color:var(--accent-strong)]" /> Generate KRAs & KPIs with AI
            </DialogTitle>
          </DialogHeader>

          {!aiResults ? (
            <div className="space-y-4">
              <p className="text-sm text-muted">Enter a job role and description. AI will generate ~5 KRAs with ~3 KPIs each, all editable before saving.</p>
              <div className="space-y-2">
                <Label>Job Role Title *</Label>
                <Input placeholder="e.g., Senior Software Engineer" value={aiJobTitle} onChange={(e) => setAiJobTitle(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Job Description</Label>
                <Textarea
                  placeholder="Describe what this person does... e.g., Leads backend development, manages deployments, mentors junior developers, collaborates with product team..."
                  value={aiJobDescription}
                  onChange={(e) => setAiJobDescription(e.target.value)}
                  rows={4}
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowAiDialog(false)}>Cancel</Button>
                <Button onClick={handleAiGenerate} disabled={aiGenerating || !aiJobTitle.trim()} className="gap-2">
                  {aiGenerating ? <><Loader2 size={16} className="animate-spin" /> Generating...</> : <><Sparkles size={16} /> Generate</>}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted">
                  Generated <span className="font-medium text-foreground">{aiResults.length} KRAs</span> with{" "}
                  <span className="font-medium text-foreground">{aiResults.reduce((sum: number, k: any) => sum + (k.kpis?.length || 0), 0)} KPIs</span>
                  {" "}for <span className="font-medium text-[color:var(--accent-strong)]">{aiJobTitle}</span>. Edit as needed, then save.
                </p>
                <Button variant="ghost" size="sm" onClick={() => setAiResults(null)} className="text-xs text-muted">
                  Regenerate
                </Button>
              </div>

              {aiResults.map((kra: any, kraIdx: number) => (
                <Card key={kraIdx} className="border-border">
                  <CardHeader className="p-3 pb-2">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2">
                          <Input
                            value={kra.category || ""}
                            onChange={(e) => handleAiResultEdit(kraIdx, "category", e.target.value)}
                            className="text-[10px] h-5 w-28 px-1.5"
                            placeholder="Category"
                          />
                          <button onClick={() => handleAiRemoveKra(kraIdx)} className="text-muted hover:text-red-400 transition-colors ml-auto">
                            <X size={14} />
                          </button>
                        </div>
                        <Input
                          value={kra.name}
                          onChange={(e) => handleAiResultEdit(kraIdx, "name", e.target.value)}
                          className="font-medium text-sm h-8"
                          placeholder="KRA Name"
                        />
                        <Input
                          value={kra.description || ""}
                          onChange={(e) => handleAiResultEdit(kraIdx, "description", e.target.value)}
                          className="text-xs text-muted h-7"
                          placeholder="Description"
                        />
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="p-3 pt-0">
                    <div className="space-y-2">
                      {kra.kpis?.map((kpi: any, kpiIdx: number) => (
                        <div key={kpiIdx} className="flex items-center gap-2 rounded-lg bg-surface-2 p-2">
                          <div className="flex-1 grid grid-cols-12 gap-2 items-center">
                            <div className="col-span-4">
                              <Input
                                value={kpi.name}
                                onChange={(e) => handleAiKpiEdit(kraIdx, kpiIdx, "name", e.target.value)}
                                className="text-xs h-7"
                                placeholder="KPI Name"
                              />
                            </div>
                            <div className="col-span-2">
                              <Input
                                value={kpi.targetValue ?? ""}
                                onChange={(e) => handleAiKpiEdit(kraIdx, kpiIdx, "targetValue", e.target.value)}
                                className="text-xs h-7"
                                placeholder="Target"
                                type="number"
                              />
                            </div>
                            <div className="col-span-2">
                              <Input
                                value={kpi.unit || ""}
                                onChange={(e) => handleAiKpiEdit(kraIdx, kpiIdx, "unit", e.target.value)}
                                className="text-xs h-7"
                                placeholder="Unit"
                              />
                            </div>
                            <div className="col-span-3">
                              <select
                                value={kpi.frequency || "MONTHLY"}
                                onChange={(e) => handleAiKpiEdit(kraIdx, kpiIdx, "frequency", e.target.value)}
                                className="w-full h-7 rounded-md border border-border bg-background px-2 text-xs"
                              >
                                <option value="DAILY">Daily</option>
                                <option value="WEEKLY">Weekly</option>
                                <option value="MONTHLY">Monthly</option>
                                <option value="QUARTERLY">Quarterly</option>
                                <option value="YEARLY">Yearly</option>
                              </select>
                            </div>
                            <div className="col-span-1 flex justify-center">
                              <button onClick={() => handleAiRemoveKpi(kraIdx, kpiIdx)} className="text-muted hover:text-red-400 transition-colors">
                                <X size={12} />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}

              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setShowAiDialog(false)}>Cancel</Button>
                <Button onClick={handleAiSaveAll} disabled={savingKra || aiResults.length === 0} className="gap-2">
                  {savingKra ? <><Loader2 size={16} className="animate-spin" /> Saving...</> : <><Plus size={16} /> Save All KRAs & KPIs</>}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
