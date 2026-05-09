"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/components/ui/toast";
import { useRole } from "@/hooks/use-role";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageHeader } from "@/components/dashboard/page-header";
import {
  Package, Plus, Search, Laptop, Monitor, Smartphone, Tablet, Keyboard,
  Mouse, Headphones, Video, Car, CreditCard, Armchair, Pencil, Trash2,
  UserPlus, UserMinus, X, Filter, Eye,
} from "lucide-react";
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem,
  ContextMenuSeparator, ContextMenuLabel,
} from "@/components/ui/context-menu";

const ASSET_TYPES = [
  { value: "LAPTOP", label: "Laptop", icon: Laptop },
  { value: "DESKTOP", label: "Desktop", icon: Monitor },
  { value: "MONITOR", label: "Monitor", icon: Monitor },
  { value: "PHONE", label: "Phone", icon: Smartphone },
  { value: "TABLET", label: "Tablet", icon: Tablet },
  { value: "KEYBOARD", label: "Keyboard", icon: Keyboard },
  { value: "MOUSE", label: "Mouse", icon: Mouse },
  { value: "HEADSET", label: "Headset", icon: Headphones },
  { value: "WEBCAM", label: "Webcam", icon: Video },
  { value: "CHAIR", label: "Chair", icon: Armchair },
  { value: "DESK", label: "Desk", icon: Package },
  { value: "ID_CARD", label: "ID Card", icon: CreditCard },
  { value: "ACCESS_CARD", label: "Access Card", icon: CreditCard },
  { value: "VEHICLE", label: "Vehicle", icon: Car },
  { value: "OTHER", label: "Other", icon: Package },
];

const CONDITION_OPTIONS = ["NEW", "GOOD", "FAIR", "POOR", "DAMAGED"];
const STATUS_OPTIONS = ["AVAILABLE", "ASSIGNED", "IN_REPAIR", "RETIRED", "LOST"];

function getTypeIcon(type: string) {
  const t = ASSET_TYPES.find((a) => a.value === type);
  return t ? t.icon : Package;
}

function getStatusColor(status: string) {
  switch (status) {
    case "AVAILABLE": return "bg-green-500/10 text-green-400 border-green-500/20";
    case "ASSIGNED": return "bg-[rgba(212,255,46,0.08)] text-[color:var(--accent-strong)] border-[rgba(212,255,46,0.2)]";
    case "IN_REPAIR": return "bg-orange-500/10 text-orange-400 border-orange-500/20";
    case "RETIRED": return "bg-zinc-500/10 text-zinc-400 border-zinc-500/20";
    case "LOST": return "bg-red-500/10 text-red-400 border-red-500/20";
    default: return "bg-surface-2 text-muted";
  }
}

function getConditionColor(c: string) {
  switch (c) {
    case "NEW": return "text-green-400";
    case "GOOD": return "text-blue-400";
    case "FAIR": return "text-orange-400";
    case "POOR": return "text-red-400";
    case "DAMAGED": return "text-red-500";
    default: return "text-muted";
  }
}

interface Asset {
  id: string;
  name: string;
  type: string;
  brand?: string;
  model?: string;
  serialNumber?: string;
  imeiNumber?: string;
  purchaseDate?: string;
  purchaseCost?: number;
  warrantyExpiry?: string;
  condition: string;
  status: string;
  notes?: string;
  assignedToId?: string;
  assignedTo?: { id: string; firstName: string; lastName: string; avatar?: string; department?: { name: string } };
  assignedAt?: string;
  returnedAt?: string;
  createdAt: string;
}

export default function AssetsPage() {
  const { isManager: isManagerRole } = useRole();
  const { success: toastSuccess, error: toastError } = useToast();

  const [assets, setAssets] = useState<Asset[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterType, setFilterType] = useState("");
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);

  // Dialog states
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [form, setForm] = useState({
    name: "", type: "LAPTOP", brand: "", model: "", serialNumber: "", imeiNumber: "",
    purchaseDate: "", purchaseCost: "", warrantyExpiry: "", condition: "GOOD", notes: "", assignedToId: "",
  });
  const [assignUserId, setAssignUserId] = useState("");

  const resetForm = () => setForm({
    name: "", type: "LAPTOP", brand: "", model: "", serialNumber: "", imeiNumber: "",
    purchaseDate: "", purchaseCost: "", warrantyExpiry: "", condition: "GOOD", notes: "", assignedToId: "",
  });

  const fetchAssets = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (filterStatus) params.set("status", filterStatus);
      if (filterType) params.set("type", filterType);
      const res = await fetch(`/api/assets?${params}`);
      if (res.ok) {
        const data = await res.json();
        setAssets(Array.isArray(data) ? data : data.data || []);
      }
    } catch {} finally { setLoading(false); }
  }, [filterStatus, filterType]);

  useEffect(() => { fetchAssets(); }, [fetchAssets]);

  useEffect(() => {
    fetch("/api/users?limit=500").then((r) => r.ok ? r.json() : { data: [] }).then((d) => setUsers(Array.isArray(d) ? d : d.data || [])).catch(() => {});
  }, []);

  const filtered = assets.filter((a) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return a.name.toLowerCase().includes(q) || (a.brand || "").toLowerCase().includes(q)
      || (a.model || "").toLowerCase().includes(q) || (a.serialNumber || "").toLowerCase().includes(q)
      || (a.imeiNumber || "").toLowerCase().includes(q)
      || (a.assignedTo ? `${a.assignedTo.firstName} ${a.assignedTo.lastName}`.toLowerCase().includes(q) : false);
  });

  const handleCreate = async () => {
    if (!form.name.trim() || !form.type) return;
    setSaving(true);
    try {
      const res = await fetch("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setShowAddDialog(false);
        resetForm();
        await fetchAssets();
        toastSuccess("Asset added");
      } else {
        const d = await res.json();
        toastError(d.error || "Failed to add asset");
      }
    } catch { toastError("Failed to add asset"); } finally { setSaving(false); }
  };

  const handleEdit = async () => {
    if (!selectedAsset || !form.name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/assets/${selectedAsset.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setShowEditDialog(false);
        await fetchAssets();
        toastSuccess("Asset updated");
      }
    } catch { toastError("Failed to update"); } finally { setSaving(false); }
  };

  const handleAssign = async () => {
    if (!selectedAsset) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/assets/${selectedAsset.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedToId: assignUserId || null }),
      });
      if (res.ok) {
        setShowAssignDialog(false);
        setAssignUserId("");
        await fetchAssets();
        toastSuccess(assignUserId ? "Asset assigned" : "Asset unassigned");
      }
    } catch { toastError("Failed to assign"); } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/assets/${id}`, { method: "DELETE" });
      if (res.ok) {
        setShowDeleteConfirm(null);
        if (selectedAsset?.id === id) setSelectedAsset(null);
        await fetchAssets();
        toastSuccess("Asset deleted");
      }
    } catch { toastError("Failed to delete"); }
  };

  function openEdit(asset: Asset) {
    setSelectedAsset(asset);
    setForm({
      name: asset.name, type: asset.type, brand: asset.brand || "", model: asset.model || "",
      serialNumber: asset.serialNumber || "", imeiNumber: asset.imeiNumber || "",
      purchaseDate: asset.purchaseDate ? asset.purchaseDate.slice(0, 10) : "",
      purchaseCost: asset.purchaseCost ? String(asset.purchaseCost) : "",
      warrantyExpiry: asset.warrantyExpiry ? asset.warrantyExpiry.slice(0, 10) : "",
      condition: asset.condition, notes: asset.notes || "", assignedToId: asset.assignedToId || "",
    });
    setShowEditDialog(true);
  }

  function openAssign(asset: Asset) {
    setSelectedAsset(asset);
    setAssignUserId(asset.assignedToId || "");
    setShowAssignDialog(true);
  }

  // Stats
  const totalAssets = assets.length;
  const assigned = assets.filter((a) => a.status === "ASSIGNED").length;
  const available = assets.filter((a) => a.status === "AVAILABLE").length;
  const inRepair = assets.filter((a) => a.status === "IN_REPAIR").length;

  const TypeIcon = selectedAsset ? getTypeIcon(selectedAsset.type) : Package;

  return (
    <div className="space-y-3 animate-fade-in">
      <PageHeader
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Assets" }]}
        kicker="Assets · inventory"
        title="Assets"
        subtitle="Track and manage company assets assigned to employees."
        actions={
          isManagerRole
            ? [{
                label: "Add asset",
                onClick: () => { resetForm(); setShowAddDialog(true); },
                icon: <Plus size={14} />,
              }]
            : undefined
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-3 text-center"><p className="text-2xl font-bold">{totalAssets}</p><p className="text-xs text-muted">Total Assets</p></CardContent></Card>
        <Card><CardContent className="p-3 text-center"><p className="text-2xl font-bold text-[color:var(--accent-strong)]">{assigned}</p><p className="text-xs text-muted">Assigned</p></CardContent></Card>
        <Card><CardContent className="p-3 text-center"><p className="text-2xl font-bold text-green-400">{available}</p><p className="text-xs text-muted">Available</p></CardContent></Card>
        <Card><CardContent className="p-3 text-center"><p className="text-2xl font-bold text-orange-400">{inRepair}</p><p className="text-xs text-muted">In Repair</p></CardContent></Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search assets, serial numbers, people..." className="pl-9 h-9 text-sm" />
        </div>
        <Select value={filterType} onValueChange={(v) => setFilterType(v === "all" ? "" : v)}>
          <SelectTrigger className="w-36 h-9 text-xs"><SelectValue placeholder="All Types" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {ASSET_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v === "all" ? "" : v)}>
          <SelectTrigger className="w-36 h-9 text-xs"><SelectValue placeholder="All Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            {STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Split Panel */}
      <div className="flex gap-4" style={{ minHeight: "calc(100vh - 320px)" }}>
        {/* Asset List */}
        <div className="w-[45%] space-y-1 overflow-y-auto pr-1" style={{ maxHeight: "calc(100vh - 320px)" }}>
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="p-3 rounded-lg border border-border animate-pulse">
                <div className="h-4 bg-surface-2 rounded w-2/3 mb-2" />
                <div className="h-3 bg-surface-2 rounded w-1/3" />
              </div>
            ))
          ) : filtered.length === 0 ? (
            <div className="text-center py-12">
              <Package size={32} className="mx-auto text-muted mb-3" />
              <p className="text-sm text-muted">No assets found</p>
              {isManagerRole && <Button variant="outline" size="sm" className="mt-3 gap-2" onClick={() => { resetForm(); setShowAddDialog(true); }}><Plus size={14} /> Add First Asset</Button>}
            </div>
          ) : filtered.map((asset) => {
            const Icon = getTypeIcon(asset.type);
            const isSelected = selectedAsset?.id === asset.id;
            return (
              <ContextMenu key={asset.id}>
                <ContextMenuTrigger asChild>
                  <button
                    onClick={() => setSelectedAsset(asset)}
                    className={`w-full text-left p-3 rounded-lg border transition-all ${isSelected ? "border-[rgba(212,255,46,0.35)] bg-[#d4ff2e]/5" : "border-border hover:bg-surface-2"}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="shrink-0 w-8 h-8 rounded-lg bg-surface-2 flex items-center justify-center">
                        <Icon size={16} className="text-muted" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">{asset.name}</span>
                          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 shrink-0 ${getStatusColor(asset.status)}`}>
                            {asset.status.replace("_", " ")}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[11px] text-muted">{ASSET_TYPES.find((t) => t.value === asset.type)?.label}</span>
                          {asset.brand && <span className="text-[11px] text-muted">· {asset.brand}</span>}
                          {asset.assignedTo && (
                            <span className="text-[11px] text-[color:var(--accent-strong)]">· {asset.assignedTo.firstName} {asset.assignedTo.lastName}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuLabel>Asset</ContextMenuLabel>
                  <ContextMenuItem onSelect={() => setSelectedAsset(asset)}>
                    <Eye size={14} /> View details
                  </ContextMenuItem>
                  {isManagerRole && (
                    <>
                      <ContextMenuSeparator />
                      <ContextMenuItem onSelect={() => openAssign(asset)}>
                        <UserPlus size={14} /> {asset.assignedTo ? "Reassign" : "Assign"}
                      </ContextMenuItem>
                      <ContextMenuItem onSelect={() => openEdit(asset)}>
                        <Pencil size={14} /> Edit
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem destructive onSelect={() => setShowDeleteConfirm(asset.id)}>
                        <Trash2 size={14} /> Delete
                      </ContextMenuItem>
                    </>
                  )}
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
        </div>

        {/* Detail Panel */}
        <div className="flex-1 border border-border rounded-lg overflow-y-auto" style={{ maxHeight: "calc(100vh - 320px)" }}>
          {!selectedAsset ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <Package size={40} className="mx-auto text-muted mb-3" />
                <p className="text-sm text-muted">Select an asset to view details</p>
              </div>
            </div>
          ) : (
            <div className="p-5 space-y-5">
              {/* Header */}
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-surface-2 flex items-center justify-center">
                    <TypeIcon size={20} className="text-muted" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold">{selectedAsset.name}</h2>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-muted">{ASSET_TYPES.find((t) => t.value === selectedAsset.type)?.label}</span>
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${getStatusColor(selectedAsset.status)}`}>
                        {selectedAsset.status.replace("_", " ")}
                      </Badge>
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${getConditionColor(selectedAsset.condition)}`}>
                        {selectedAsset.condition}
                      </Badge>
                    </div>
                  </div>
                </div>
                {isManagerRole && (
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => openAssign(selectedAsset)}>
                      {selectedAsset.assignedToId ? <UserMinus size={12} /> : <UserPlus size={12} />}
                      {selectedAsset.assignedToId ? "Reassign" : "Assign"}
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => openEdit(selectedAsset)}>
                      <Pencil size={12} /> Edit
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-red-400" onClick={() => setShowDeleteConfirm(selectedAsset.id)}>
                      <Trash2 size={12} />
                    </Button>
                  </div>
                )}
              </div>

              {/* Assigned To */}
              {selectedAsset.assignedTo && (
                <Card>
                  <CardContent className="p-3">
                    <p className="text-[10px] uppercase tracking-wider text-muted mb-2">Assigned To</p>
                    <div className="flex items-center gap-3">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="text-xs bg-[rgba(212,255,46,0.12)] text-[color:var(--accent-strong)]">
                          {selectedAsset.assignedTo.firstName[0]}{selectedAsset.assignedTo.lastName[0]}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="text-sm font-medium">{selectedAsset.assignedTo.firstName} {selectedAsset.assignedTo.lastName}</p>
                        {selectedAsset.assignedTo.department && <p className="text-[11px] text-muted">{selectedAsset.assignedTo.department.name}</p>}
                      </div>
                      {selectedAsset.assignedAt && (
                        <p className="text-[11px] text-muted ml-auto">Since {new Date(selectedAsset.assignedAt).toLocaleDateString()}</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Details Grid */}
              <div className="grid grid-cols-2 gap-3">
                {selectedAsset.brand && (
                  <div><p className="text-[10px] uppercase tracking-wider text-muted mb-1">Brand</p><p className="text-sm">{selectedAsset.brand}</p></div>
                )}
                {selectedAsset.model && (
                  <div><p className="text-[10px] uppercase tracking-wider text-muted mb-1">Model</p><p className="text-sm">{selectedAsset.model}</p></div>
                )}
                {selectedAsset.serialNumber && (
                  <div><p className="text-[10px] uppercase tracking-wider text-muted mb-1">Serial Number</p><p className="text-sm font-mono">{selectedAsset.serialNumber}</p></div>
                )}
                {selectedAsset.imeiNumber && (
                  <div><p className="text-[10px] uppercase tracking-wider text-muted mb-1">IMEI Number</p><p className="text-sm font-mono">{selectedAsset.imeiNumber}</p></div>
                )}
                {selectedAsset.purchaseDate && (
                  <div><p className="text-[10px] uppercase tracking-wider text-muted mb-1">Purchase Date</p><p className="text-sm">{new Date(selectedAsset.purchaseDate).toLocaleDateString()}</p></div>
                )}
                {selectedAsset.purchaseCost != null && (
                  <div><p className="text-[10px] uppercase tracking-wider text-muted mb-1">Purchase Cost</p><p className="text-sm">₹{selectedAsset.purchaseCost.toLocaleString()}</p></div>
                )}
                {selectedAsset.warrantyExpiry && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted mb-1">Warranty Expiry</p>
                    <p className={`text-sm ${new Date(selectedAsset.warrantyExpiry) < new Date() ? "text-red-400" : ""}`}>
                      {new Date(selectedAsset.warrantyExpiry).toLocaleDateString()}
                      {new Date(selectedAsset.warrantyExpiry) < new Date() && " (Expired)"}
                    </p>
                  </div>
                )}
              </div>

              {selectedAsset.notes && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted mb-1">Notes</p>
                  <p className="text-sm text-muted">{selectedAsset.notes}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Add/Edit Asset Dialog */}
      {(showAddDialog || showEditDialog) && (
        <Dialog open={showAddDialog || showEditDialog} onOpenChange={(open) => { if (!open) { setShowAddDialog(false); setShowEditDialog(false); } }}>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{showEditDialog ? "Edit Asset" : "Add Asset"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Asset Name *</Label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g., MacBook Pro 16" className="h-9 text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Type *</Label>
                  <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>{ASSET_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Brand</Label>
                  <Input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} placeholder="e.g., Apple" className="h-9 text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Model</Label>
                  <Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="e.g., M3 Pro" className="h-9 text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Serial Number</Label>
                  <Input value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} placeholder="S/N" className="h-9 text-sm font-mono" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">IMEI Number</Label>
                  <Input value={form.imeiNumber} onChange={(e) => setForm({ ...form, imeiNumber: e.target.value })} placeholder="For phones/tablets" className="h-9 text-sm font-mono" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Purchase Date</Label>
                  <Input type="date" value={form.purchaseDate} onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })} className="h-9 text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Cost (₹)</Label>
                  <Input type="number" value={form.purchaseCost} onChange={(e) => setForm({ ...form, purchaseCost: e.target.value })} placeholder="0" className="h-9 text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Warranty Expiry</Label>
                  <Input type="date" value={form.warrantyExpiry} onChange={(e) => setForm({ ...form, warrantyExpiry: e.target.value })} className="h-9 text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Condition</Label>
                  <Select value={form.condition} onValueChange={(v) => setForm({ ...form, condition: v })}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>{CONDITION_OPTIONS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                {!showEditDialog && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Assign To (optional)</Label>
                    <Select value={form.assignedToId} onValueChange={(v) => setForm({ ...form, assignedToId: v === "none" ? "" : v })}>
                      <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Unassigned</SelectItem>
                        {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.firstName} {u.lastName}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Notes</Label>
                <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Any additional notes..." rows={2} className="text-sm" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setShowAddDialog(false); setShowEditDialog(false); }}>Cancel</Button>
              <Button onClick={showEditDialog ? handleEdit : handleCreate} disabled={saving || !form.name.trim()}>
                {saving ? "Saving..." : showEditDialog ? "Save Changes" : "Add Asset"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Assign Dialog */}
      <Dialog open={showAssignDialog} onOpenChange={(open) => { if (!open) setShowAssignDialog(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selectedAsset?.assignedToId ? "Reassign" : "Assign"} Asset</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted">
              {selectedAsset?.name} — {ASSET_TYPES.find((t) => t.value === selectedAsset?.type)?.label}
              {selectedAsset?.serialNumber && ` (${selectedAsset.serialNumber})`}
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs">Assign To</Label>
              <Select value={assignUserId} onValueChange={setAssignUserId}>
                <SelectTrigger><SelectValue placeholder="Select person" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassign (make available)</SelectItem>
                  {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.firstName} {u.lastName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAssignDialog(false)}>Cancel</Button>
            <Button onClick={() => { if (assignUserId === "none") setAssignUserId(""); handleAssign(); }} disabled={saving}>
              {saving ? "Saving..." : assignUserId && assignUserId !== "none" ? "Assign" : "Unassign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <ConfirmDialog
        open={!!showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(null)}
        title="Delete Asset"
        description="Are you sure? This will permanently remove this asset record."
        confirmLabel="Delete"
        onConfirm={() => showDeleteConfirm && handleDelete(showDeleteConfirm)}
      />
    </div>
  );
}
