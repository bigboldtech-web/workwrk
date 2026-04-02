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
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Target, Plus, TrendingUp, TrendingDown, Minus, BarChart3, ChevronRight, ChevronDown, Users,
  Pencil, Trash2, UserPlus, AlertTriangle,
} from "lucide-react";

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
  kpi?: { name: string; kra?: { name: string }; unit?: string };
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
  if (score >= 70) return "text-purple-400";
  if (score >= 50) return "text-orange-400";
  return "text-red-400";
}

function getScoreBg(score: number) {
  if (score >= 90) return "bg-green-500";
  if (score >= 70) return "bg-purple-500";
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
      <div className="h-4 bg-[#2A2A3A] rounded w-1/4" />
      <div className="h-4 bg-[#2A2A3A] rounded w-1/6" />
      <div className="h-4 bg-[#2A2A3A] rounded w-1/6" />
      <div className="h-4 bg-[#2A2A3A] rounded w-1/12" />
    </div>
  );
}

function SkeletonKpiCard() {
  return (
    <Card>
      <CardContent className="p-4 animate-pulse">
        <div className="space-y-3">
          <div className="h-4 bg-[#2A2A3A] rounded w-2/3" />
          <div className="h-3 bg-[#2A2A3A] rounded w-1/3" />
          <div className="h-6 bg-[#2A2A3A] rounded w-1/4" />
          <div className="h-1.5 bg-[#2A2A3A] rounded w-full" />
        </div>
      </CardContent>
    </Card>
  );
}

export default function KraKpiPage() {
  // Dialog states
  const [showAddKraDialog, setShowAddKraDialog] = useState(false);
  const [showRecordKpiDialog, setShowRecordKpiDialog] = useState(false);
  const [showAddKpiDialog, setShowAddKpiDialog] = useState(false);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [showEditKraDialog, setShowEditKraDialog] = useState(false);
  const [showEditKpiDialog, setShowEditKpiDialog] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<{ type: "kra" | "kpi" | "assignment"; id: string } | null>(null);

  // Data state
  const [kras, setKras] = useState<Kra[]>([]);
  const [kpis, setKpis] = useState<Kpi[]>([]);
  const [kpiRecords, setKpiRecords] = useState<KpiRecord[]>([]);
  const [assignments, setAssignments] = useState<KraAssignment[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);

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

  // KPI form state
  const [kpiName, setKpiName] = useState("");
  const [kpiDescription, setKpiDescription] = useState("");
  const [kpiType, setKpiType] = useState("QUANTITATIVE");
  const [kpiUnit, setKpiUnit] = useState("");
  const [kpiFrequency, setKpiFrequency] = useState("MONTHLY");
  const [kpiTargetValue, setKpiTargetValue] = useState("");
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
      const res = await fetch("/api/kras");
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
      const res = await fetch("/api/kra-assignments");
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
      const res = await fetch("/api/users");
      if (res.ok) {
        const data = await res.json();
        setUsers(Array.isArray(data) ? data : data.users ?? data.data ?? []);
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
  }, [fetchKras, fetchKpis, fetchKpiRecords, fetchAssignments, fetchRoles, fetchUsers]);

  // --- Handlers ---

  const handleCreateKra = async () => {
    if (!kraName.trim()) return;
    setSavingKra(true);
    try {
      const res = await fetch("/api/kras", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: kraName, description: kraDescription, category: kraCategory || undefined, roleId: kraRoleId || undefined }),
      });
      if (res.ok) {
        setShowAddKraDialog(false);
        resetKraForm();
        await fetchKras();
        toastSuccess("KRA created successfully");
      }
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
        body: JSON.stringify({ name: kpiName, description: kpiDescription, type: kpiType, unit: kpiUnit || undefined, frequency: kpiFrequency, targetValue: kpiTargetValue ? Number(kpiTargetValue) : undefined, kraId: kpiKraId || undefined }),
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
        body: JSON.stringify({ id: editingKpi.id, name: kpiName, description: kpiDescription, type: kpiType, unit: kpiUnit, frequency: kpiFrequency, targetValue: kpiTargetValue ? Number(kpiTargetValue) : null, kraId: kpiKraId || null }),
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
    if (!assignUserId || !assignPeriod || kraList.length === 0) return;
    setSavingAssignment(true);
    try {
      let allOk = true;
      for (const entry of kraList) {
        if (!entry.kraId || !entry.weightage) continue;
        const res = await fetch("/api/kra-assignments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: assignUserId, kraId: entry.kraId, weightage: parseFloat(entry.weightage), period: assignPeriod }),
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

  function resetKraForm() { setKraName(""); setKraDescription(""); setKraCategory(""); setKraRoleId(""); setEditingKra(null); }
  function resetKpiForm() { setKpiName(""); setKpiDescription(""); setKpiType("QUANTITATIVE"); setKpiUnit(""); setKpiFrequency("MONTHLY"); setKpiTargetValue(""); setKpiKraId(""); setEditingKpi(null); }
  function resetAssignForm() { setAssignUserId(""); setAssignKraId(""); setAssignWeightage(""); setAssignPeriod(""); setMultiAssignKras([]); }
  function resetRecordForm() { setRecordKpiId(""); setRecordUserId(""); setRecordPeriod(""); setRecordTargetValue(""); setRecordActualValue(""); setRecordNotes(""); }

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
    setKpiKraId(kpi.kraId || kpi.kra?.id || "");
    setShowEditKpiDialog(true);
  }

  function openAssignForKra(kraId: string) {
    setAssignKraId(kraId);
    setMultiAssignKras([{ kraId, weightage: "" }]);
    setShowAssignDialog(true);
  }

  // Build overview data from KPI records
  const overviewRecords = kpiRecords.map((rec) => {
    const name = rec.kpi?.name ?? "KPI";
    const kraName = rec.kpi?.kra?.name ?? "";
    const unit = rec.kpi?.unit ?? "";
    const target = rec.targetValue ?? 0;
    const actual = rec.actualValue ?? 0;
    const period = rec.period ?? "";
    const achievement = target === 0 ? 0 : Math.min(Math.round((actual / target) * 100), 120);
    return { name, kraName, unit, target, actual, period, achievement };
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
    if (target > 0) userScoreMap.get(key)!.scores.push(Math.min(Math.round((actual / target) * 100), 120));
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

  const kraFormFields = (
    <div className="space-y-4 py-4">
      <div className="space-y-2">
        <Label>KRA Name <span className="text-red-400">*</span></Label>
        <Input placeholder="e.g., Revenue Generation" value={kraName} onChange={(e) => setKraName(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label>Category</Label>
        <Select value={kraCategory} onValueChange={setKraCategory}>
          <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
          <SelectContent>
            {["Sales", "Engineering", "Marketing", "Operations", "Support", "HR", "Finance"].map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Description</Label>
        <Textarea placeholder="What does this KRA measure?" value={kraDescription} onChange={(e) => setKraDescription(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label>Linked Role</Label>
        <Select value={kraRoleId} onValueChange={setKraRoleId}>
          <SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger>
          <SelectContent>
            {roles.map((r) => (
              <SelectItem key={r.id} value={r.id}>{r.title || r.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
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
      <div className="space-y-2">
        <Label>Description</Label>
        <Textarea placeholder="What does this KPI measure?" value={kpiDescription} onChange={(e) => setKpiDescription(e.target.value)} />
      </div>
    </div>
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">KRA & KPIs</h1>
          <p className="text-[#8888A0] text-sm mt-1">Define, track, and score performance across your organization</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="gap-2" onClick={() => setShowRecordKpiDialog(true)}>
            <BarChart3 size={16} /> Record KPI
          </Button>
          <Button variant="outline" className="gap-2" onClick={() => { resetKpiForm(); setShowAddKpiDialog(true); }}>
            <Plus size={16} /> New KPI
          </Button>
          <Button variant="outline" className="gap-2" onClick={() => setShowAssignDialog(true)}>
            <UserPlus size={16} /> Assign KRA
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
        <TabsContent value="overview" className="space-y-6 mt-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {loadingRecords ? (
              <>{[1,2,3,4].map((i) => <SkeletonKpiCard key={i} />)}</>
            ) : overviewRecords.length === 0 ? (
              <Card className="col-span-2">
                <CardContent className="p-8 text-center">
                  <p className="text-[#8888A0] text-sm">No KPI records found. Use &quot;Record KPI&quot; to add data.</p>
                </CardContent>
              </Card>
            ) : (
              overviewRecords.map((kpi, idx) => (
                <Card key={idx} className="hover:border-[#3A3A4A] transition-colors">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="text-sm font-medium">{kpi.name}</p>
                        <p className="text-[10px] text-[#8888A0]">{kpi.kraName} &middot; {kpi.period}</p>
                      </div>
                    </div>
                    <div className="flex items-end gap-2 mb-2">
                      <span className={`text-xl font-bold font-mono ${getScoreColor(kpi.achievement)}`}>
                        {kpi.actual.toLocaleString()}
                      </span>
                      <span className="text-xs text-[#8888A0] mb-0.5">/ {kpi.target.toLocaleString()} {kpi.unit}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Progress value={Math.min(kpi.achievement, 100)} className="h-1.5" indicatorClassName={getProgressColor(kpi.achievement)} />
                      <span className={`text-xs font-mono ${getScoreColor(kpi.achievement)}`}>{kpi.achievement}%</span>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        {/* KRAs Tab */}
        <TabsContent value="kras" className="mt-4 space-y-3">
          {loadingKras ? (
            <div className="space-y-3">{[1,2,3].map((i) => <Card key={i}><CardContent className="p-4"><div className="h-12 bg-[#1A1A26] rounded animate-pulse" /></CardContent></Card>)}</div>
          ) : kras.length === 0 ? (
            <Card><CardContent className="p-0">
              <EmptyState
                icon={Target}
                title="No KRAs defined"
                description="Define what success looks like for your team by creating Key Result Areas."
                actionLabel="Create KRA"
                onAction={() => setShowAddKraDialog(true)}
              />
            </CardContent></Card>
          ) : (
            kras.map((kra) => {
              const isExpanded = expandedKraIds.has(kra.id);
              return (
                <Card key={kra.id} className="overflow-hidden">
                  {/* KRA Header */}
                  <div className="flex items-center gap-3 p-4 hover:bg-[#1A1A26]/50 transition-colors">
                    <button onClick={() => toggleExpandKra(kra.id)} className="shrink-0 text-[#8888A0] hover:text-[#E8E8F0]">
                      {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                    <Target size={16} className="text-purple-400 shrink-0" />
                    <div className="flex-1 min-w-0 cursor-pointer" onClick={() => toggleExpandKra(kra.id)}>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{kra.name}</span>
                        <Badge variant="outline" className="text-[10px]">{kra.category}</Badge>
                        {kra.role?.title && <span className="text-[10px] text-[#6B6B80]">{kra.role.title}</span>}
                      </div>
                      {kra.description && <p className="text-xs text-[#8888A0] truncate">{kra.description}</p>}
                    </div>
                    <Badge variant="secondary" className="text-[10px] shrink-0">{kra.kpis?.length ?? 0} KPIs</Badge>
                    <span className="text-xs text-[#6B6B80] shrink-0">{kra._count?.assignments ?? 0} assigned</span>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openAssignForKra(kra.id)} title="Assign"><UserPlus size={14} className="text-purple-400" /></Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEditKra(kra)} title="Edit"><Pencil size={14} className="text-[#8888A0]" /></Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setShowDeleteConfirm({ type: "kra", id: kra.id })} title="Delete"><Trash2 size={14} className="text-red-400" /></Button>
                    </div>
                  </div>

                  {/* Expanded KPIs */}
                  {isExpanded && (
                    <div className="border-t border-[#2A2A3A] bg-[#0D0D14]">
                      {(!kra.kpis || kra.kpis.length === 0) ? (
                        <div className="p-4 text-center text-xs text-[#8888A0]">
                          No KPIs under this KRA yet.
                        </div>
                      ) : (
                        <table className="w-full">
                          <thead>
                            <tr className="border-b border-[#1A1A26]">
                              <th className="text-left px-4 py-2 text-[10px] font-medium text-[#6B6B80] uppercase">KPI Name</th>
                              <th className="text-center px-4 py-2 text-[10px] font-medium text-[#6B6B80] uppercase">Type</th>
                              <th className="text-center px-4 py-2 text-[10px] font-medium text-[#6B6B80] uppercase">Unit</th>
                              <th className="text-center px-4 py-2 text-[10px] font-medium text-[#6B6B80] uppercase">Target</th>
                              <th className="text-center px-4 py-2 text-[10px] font-medium text-[#6B6B80] uppercase">Frequency</th>
                              <th className="text-right px-4 py-2 text-[10px] font-medium text-[#6B6B80] uppercase">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {kra.kpis.map((kpi) => (
                              <tr key={kpi.id} className="border-b border-[#1A1A26] last:border-b-0 hover:bg-[#12121A] transition-colors">
                                <td className="px-4 py-2.5">
                                  <span className="text-sm">{kpi.name}</span>
                                  {kpi.description && <p className="text-[10px] text-[#6B6B80] truncate max-w-xs">{kpi.description}</p>}
                                </td>
                                <td className="px-4 py-2.5 text-center"><Badge variant="outline" className="text-[9px]">{kpi.type}</Badge></td>
                                <td className="px-4 py-2.5 text-center text-xs text-[#8888A0]">{kpi.unit || "—"}</td>
                                <td className="px-4 py-2.5 text-center text-xs font-mono text-purple-400">{kpi.targetValue != null ? kpi.targetValue : "—"}</td>
                                <td className="px-4 py-2.5 text-center text-xs text-[#8888A0]">{kpi.frequency}</td>
                                <td className="px-4 py-2.5 text-right">
                                  <div className="flex items-center justify-end gap-1">
                                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => openEditKpi(kpi)} title="Edit"><Pencil size={12} className="text-[#8888A0]" /></Button>
                                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setShowDeleteConfirm({ type: "kpi", id: kpi.id })} title="Delete"><Trash2 size={12} className="text-red-400" /></Button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      <div className="p-3 border-t border-[#1A1A26]">
                        <Button variant="ghost" size="sm" className="w-full text-xs text-[#8888A0] hover:text-purple-400 gap-1 border border-dashed border-[#2A2A3A]"
                          onClick={() => { resetKpiForm(); setKpiKraId(kra.id); setShowAddKpiDialog(true); }}>
                          <Plus size={12} /> Add KPI to {kra.name}
                        </Button>
                      </div>
                    </div>
                  )}
                </Card>
              );
            })
          )}
        </TabsContent>

        {/* Assignments Tab */}
        <TabsContent value="assignments" className="mt-4 space-y-4">
          {loadingAssignments ? (
            <Card><CardContent className="p-0">{[1,2,3].map((i) => <SkeletonRow key={i} />)}</CardContent></Card>
          ) : assignments.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <Users size={32} className="mx-auto text-[#8888A0] mb-2" />
                <p className="text-[#8888A0] text-sm">No KRA assignments yet. Click &quot;Assign KRA&quot; to get started.</p>
              </CardContent>
            </Card>
          ) : (
            Array.from(assignmentsByUser.values()).map((group) => (
              <Card key={group.user.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-full bg-purple-600/20 flex items-center justify-center text-xs font-bold text-purple-400">
                        {group.user.firstName[0]}{group.user.lastName[0]}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{group.user.firstName} {group.user.lastName}</p>
                        <p className="text-[10px] text-[#8888A0]">
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
                      <div key={a.id} className="flex items-center justify-between rounded-lg border border-[#2A2A3A] bg-[#12121A] p-3">
                        <div className="flex items-center gap-3">
                          <Target size={14} className="text-purple-400 flex-shrink-0" />
                          <div>
                            <p className="text-sm font-medium">{a.kra.name}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <Badge variant="outline" className="text-[10px]">{a.kra.category}</Badge>
                              <span className="text-[10px] text-[#8888A0]">{a.period}</span>
                              <Badge className={`text-[10px] ${a.status === "ACTIVE" ? "bg-green-500/20 text-green-400" : a.status === "PAUSED" ? "bg-yellow-500/20 text-yellow-400" : "bg-slate-500/20 text-slate-400"}`}>
                                {a.status}
                              </Badge>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <p className="text-lg font-bold font-mono text-purple-400">{a.weightage}%</p>
                            <p className="text-[10px] text-[#8888A0]">weightage</p>
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
                  <p className="text-[#8888A0] text-sm">No score data available yet.</p>
                </div>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[#2A2A3A]">
                      <th className="text-left p-4 text-xs font-medium text-[#8888A0] uppercase tracking-wider">Person</th>
                      <th className="text-left p-4 text-xs font-medium text-[#8888A0] uppercase tracking-wider">Department</th>
                      <th className="text-center p-4 text-xs font-medium text-[#8888A0] uppercase tracking-wider">KRA Score</th>
                      <th className="text-center p-4 text-xs font-medium text-[#8888A0] uppercase tracking-wider">KPI Score</th>
                      <th className="text-center p-4 text-xs font-medium text-[#8888A0] uppercase tracking-wider">Overall</th>
                      <th className="text-center p-4 text-xs font-medium text-[#8888A0] uppercase tracking-wider">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {teamScores.map((person) => (
                      <tr key={person.name} className="border-b border-[#2A2A3A]/50 hover:bg-[#1A1A26]/50 transition-colors">
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
        <DialogContent>
          <DialogHeader><DialogTitle>Create Key Result Area</DialogTitle></DialogHeader>
          {kraFormFields}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddKraDialog(false)}>Cancel</Button>
            <Button onClick={handleCreateKra} disabled={savingKra || !kraName.trim()}>
              {savingKra ? "Creating..." : "Create KRA"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit KRA Dialog */}
      <Dialog open={showEditKraDialog} onOpenChange={(open) => { setShowEditKraDialog(open); if (!open) resetKraForm(); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit KRA</DialogTitle></DialogHeader>
          {kraFormFields}
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
        <DialogContent className="max-w-lg">
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
            <div className="space-y-2">
              <Label>Period</Label>
              <Select value={assignPeriod} onValueChange={setAssignPeriod}>
                <SelectTrigger><SelectValue placeholder="Select period" /></SelectTrigger>
                <SelectContent>
                  {(() => {
                    const now = new Date();
                    const q = Math.ceil((now.getMonth() + 1) / 3);
                    const year = now.getFullYear();
                    return [
                      <SelectItem key="q-cur" value={`Q${q} ${year}`}>Q{q} {year} (Current)</SelectItem>,
                      <SelectItem key="q-next" value={`Q${q < 4 ? q + 1 : 1} ${q < 4 ? year : year + 1}`}>Q{q < 4 ? q + 1 : 1} {q < 4 ? year : year + 1}</SelectItem>,
                      <SelectItem key="h1" value={`H1 ${year}`}>H1 {year}</SelectItem>,
                      <SelectItem key="h2" value={`H2 ${year}`}>H2 {year}</SelectItem>,
                      <SelectItem key="fy" value={`FY ${year}`}>FY {year}</SelectItem>,
                      <SelectItem key="fy-next" value={`FY ${year + 1}`}>FY {year + 1}</SelectItem>,
                    ];
                  })()}
                </SelectContent>
              </Select>
            </div>

            {/* Multi-KRA Selection */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>KRAs & Weightage</Label>
                <Button variant="ghost" size="sm" className="text-xs text-purple-400 h-6" onClick={() => setMultiAssignKras([...multiAssignKras, { kraId: "", weightage: "" }])}>
                  <Plus size={12} className="mr-1" /> Add KRA
                </Button>
              </div>
              {multiAssignKras.length === 0 && (
                <div className="text-center py-4 border border-dashed border-[#2A2A3A] rounded-lg">
                  <p className="text-xs text-[#8888A0] mb-2">No KRAs added yet</p>
                  <Button variant="outline" size="sm" className="text-xs gap-1" onClick={() => setMultiAssignKras([{ kraId: "", weightage: "" }])}>
                    <Plus size={12} /> Add KRA
                  </Button>
                </div>
              )}
              <div className="space-y-2">
                {multiAssignKras.map((entry, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Select value={entry.kraId} onValueChange={(v) => {
                      const updated = [...multiAssignKras];
                      updated[idx] = { ...updated[idx], kraId: v };
                      setMultiAssignKras(updated);
                    }}>
                      <SelectTrigger className="flex-1"><SelectValue placeholder="Select KRA" /></SelectTrigger>
                      <SelectContent>
                        {kras.filter((k) => !multiAssignKras.some((e, i) => i !== idx && e.kraId === k.id)).map((k) => (
                          <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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
                  <div className={`flex items-center justify-between p-2 rounded-lg border ${isOver ? "border-red-500/30 bg-red-500/5" : isExact ? "border-green-500/30 bg-green-500/5" : "border-[#2A2A3A]"}`}>
                    <span className="text-xs text-[#8888A0]">Total Weightage</span>
                    <span className={`text-sm font-mono font-bold ${isOver ? "text-red-400" : isExact ? "text-green-400" : "text-[#E8E8F0]"}`}>
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
              savingAssignment || !assignUserId || !assignPeriod || multiAssignKras.length === 0 ||
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
    </div>
  );
}
