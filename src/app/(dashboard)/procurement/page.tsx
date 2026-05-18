"use client";

// Procurement workspace. Three tabs: Vendors / Purchase Orders /
// Invoices. Each is a table with inline create dialogs and
// state-transition buttons. Detail pages are v2.

import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { BulkApproveBar } from "@/components/ui/bulk-approve-bar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useRole } from "@/hooks/use-role";
import { SkeletonCard } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/dashboard/page-header";
import { ListPage } from "@/components/layout/page-shells";
import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { ShoppingCart, Plus, Building2, FileText, Inbox, Receipt } from "lucide-react";

type Vendor = {
  id: string;
  name: string;
  email: string | null;
  contactName: string | null;
  paymentTermsDays: number;
  archived: boolean;
  _count: { purchaseOrders: number; invoices: number };
};

type PO = {
  id: string;
  number: string;
  status: "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "SENT" | "RECEIVED" | "CLOSED";
  description: string;
  amount: number;
  currency: string;
  expectedDeliveryDate: string | null;
  vendor: { id: string; name: string };
  requester: { id: string; firstName: string; lastName: string };
  approver: { id: string; firstName: string; lastName: string } | null;
};

type Invoice = {
  id: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "PAID";
  issueDate: string;
  dueDate: string;
  paidAt: string | null;
  vendor: { id: string; name: string };
  purchaseOrder: { id: string; number: string } | null;
};

const PO_STATUS_STYLE: Record<string, string> = {
  DRAFT: "text-muted border-white/20",
  SUBMITTED: "text-blue-400 border-blue-400/30",
  APPROVED: "text-[color:var(--accent-strong)] border-violet-500/30",
  REJECTED: "text-red-400 border-red-400/30",
  SENT: "text-amber-400 border-amber-400/30",
  RECEIVED: "text-green-400 border-green-400/30",
  CLOSED: "text-muted border-white/20",
};

const INVOICE_STATUS_STYLE: Record<string, string> = {
  PENDING: "text-amber-400 border-amber-400/30",
  APPROVED: "text-blue-400 border-blue-400/30",
  REJECTED: "text-red-400 border-red-400/30",
  PAID: "text-green-400 border-green-400/30",
};

function fmt(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${currency} ${n.toFixed(0)}`;
  }
}

export default function ProcurementPage() {
  const params = useSearchParams();
  const requestedTab = params.get("tab");
  const initialTab = requestedTab === "vendors" || requestedTab === "invoices" || requestedTab === "pos"
    ? requestedTab
    : "pos";
  // Controlled so the rail can switch per-tab.
  const [activeTab, setActiveTab] = useState<"pos" | "invoices" | "vendors">(initialTab as "pos" | "invoices" | "vendors");

  // Per-tab quick-action rail. Inner tab components own their own
  // filter/scope state; this rail surfaces the navigation shortcuts
  // and cross-tab links most useful while looking at each surface.
  const filtersRail = (
    <div className="space-y-5">
      <div>
        <Label className="text-[10px] uppercase tracking-wide text-muted font-semibold mb-2 block">Quick links</Label>
        <div className="space-y-0.5">
          {activeTab === "pos" && (
            <>
              <RailLink onClick={() => setActiveTab("invoices")} label="View invoices" />
              <RailLink onClick={() => setActiveTab("vendors")} label="Manage vendors" />
              <RailLink href="/inbox" label="My approval queue" />
            </>
          )}
          {activeTab === "invoices" && (
            <>
              <RailLink onClick={() => setActiveTab("pos")} label="View purchase orders" />
              <RailLink onClick={() => setActiveTab("vendors")} label="Manage vendors" />
              <RailLink href="/api/export/invoices" label="Export CSV" external />
            </>
          )}
          {activeTab === "vendors" && (
            <>
              <RailLink onClick={() => setActiveTab("pos")} label="View purchase orders" />
              <RailLink onClick={() => setActiveTab("invoices")} label="View invoices" />
            </>
          )}
        </div>
      </div>

      <div>
        <Label className="text-[10px] uppercase tracking-wide text-muted font-semibold mb-2 block">About this tab</Label>
        <p className="text-[12px] text-muted leading-relaxed px-1">
          {activeTab === "pos" && "Purchase orders move DRAFT → SUBMITTED → APPROVED → SENT → RECEIVED → CLOSED. Submit a PO and it routes to your manager's approval queue."}
          {activeTab === "invoices" && "Invoices link to POs when possible. Duplicate (vendor, invoice#) pairs are refused at the schema — fraud detection out of the box."}
          {activeTab === "vendors" && "Archived vendors disappear from PO creation but keep historic records. Reactivate any time."}
        </p>
      </div>
    </div>
  );

  return (
    <ListPage
      header={
        <PageHeader
          breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Procurement" }]}
          kicker="Procurement · vendors + POs + invoices"
          title="Procurement"
          subtitle="Vendor records, purchase orders, and invoices."
        />
      }
      filters={filtersRail}
    >
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
        <TabsList>
          <TabsTrigger value="pos">Purchase orders</TabsTrigger>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
          <TabsTrigger value="vendors">Vendors</TabsTrigger>
        </TabsList>
        <TabsContent value="pos" className="mt-4">
          <POsTab />
        </TabsContent>
        <TabsContent value="invoices" className="mt-4">
          <InvoicesTab />
        </TabsContent>
        <TabsContent value="vendors" className="mt-4">
          <VendorsTab />
        </TabsContent>
      </Tabs>
    </ListPage>
  );
}

function RailLink({ label, href, onClick, external }: { label: string; href?: string; onClick?: () => void; external?: boolean }) {
  const className = "w-full text-left text-xs px-2.5 py-1.5 rounded-md text-muted hover:bg-[color:var(--surface-elevated)] hover:text-foreground transition-fast block";
  if (href) {
    return external ? (
      <a href={href} className={className} target="_blank" rel="noopener noreferrer">{label} ↗</a>
    ) : (
      <Link href={href} className={className}>{label}</Link>
    );
  }
  return (
    <button onClick={onClick} className={className}>{label}</button>
  );
}

// ─── Vendors ───────────────────────────────────────────────────────

function VendorsTab() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/vendors?includeArchived=1");
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <div className="flex justify-end mb-3">
        <Button onClick={() => setShowCreate(true)}>
          <Plus size={14} className="mr-1.5" /> Add vendor
        </Button>
      </div>
      {loading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <SkeletonCard key={i} />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No vendors yet"
          description="Add a vendor to track POs, invoices, and payment terms in one place."
          actionLabel="Add vendor"
          onAction={() => setShowCreate(true)}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-white/5">
                  <th className="px-4 py-2.5 font-normal">Name</th>
                  <th className="px-4 py-2.5 font-normal">Contact</th>
                  <th className="px-4 py-2.5 font-normal">Net days</th>
                  <th className="px-4 py-2.5 font-normal">POs</th>
                  <th className="px-4 py-2.5 font-normal">Invoices</th>
                  <th className="px-4 py-2.5 font-normal">State</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((v) => (
                  <tr key={v.id} className="border-b border-white/5 hover:bg-surface-2">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <Building2 size={12} className="text-muted" />
                        <span className="font-medium">{v.name}</span>
                      </div>
                      {v.email && <div className="text-[10px] text-muted">{v.email}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted">{v.contactName ?? "—"}</td>
                    <td className="px-4 py-2.5 text-xs font-mono">{v.paymentTermsDays}</td>
                    <td className="px-4 py-2.5 text-xs font-mono">{v._count.purchaseOrders}</td>
                    <td className="px-4 py-2.5 text-xs font-mono">{v._count.invoices}</td>
                    <td className="px-4 py-2.5">
                      <Badge variant="outline" className={`text-[10px] ${v.archived ? "text-muted border-white/20" : "text-green-400 border-green-400/30"}`}>
                        {v.archived ? "Archived" : "Active"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
      {showCreate && (
        <CreateVendorDialog onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} />
      )}
    </>
  );
}

function CreateVendorDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [contactName, setContactName] = useState("");
  const [paymentTermsDays, setPaymentTermsDays] = useState("30");
  const [taxId, setTaxId] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/vendors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim() || undefined,
          contactName: contactName.trim() || undefined,
          paymentTermsDays: Number(paymentTermsDays) || 30,
          taxId: taxId.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: "Couldn't add", description: data?.error });
        return;
      }
      toast({ type: "success", title: "Vendor added" });
      onCreated();
    } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New vendor</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-1">
          <div className="space-y-1.5"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Email</Label><Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" /></div>
            <div className="space-y-1.5"><Label>Contact name</Label><Input value={contactName} onChange={(e) => setContactName(e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Net (days)</Label><Input value={paymentTermsDays} onChange={(e) => setPaymentTermsDays(e.target.value)} inputMode="numeric" /></div>
            <div className="space-y-1.5"><Label>Tax ID</Label><Input value={taxId} onChange={(e) => setTaxId(e.target.value)} /></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button disabled={!name.trim() || saving} onClick={save}>{saving ? "Adding…" : "Add"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Purchase orders ───────────────────────────────────────────────

function POsTab() {
  const { toast } = useToast();
  const [tab, setTab] = useState<"mine" | "approve" | "all">("mine");
  const [rows, setRows] = useState<PO[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectedArray = useMemo(() => Array.from(selectedIds), [selectedIds]);
  useEffect(() => { setSelectedIds(new Set()); }, [tab, rows.length]);

  const load = useCallback(async (scope: typeof tab) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/purchase-orders?scope=${scope}&limit=100`);
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(tab); }, [tab, load]);

  const submittedRows = rows.filter((r) => r.status === "SUBMITTED");
  const allSelected = submittedRows.length > 0 && submittedRows.every((r) => selectedIds.has(r.id));
  function toggleId(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(submittedRows.map((r) => r.id)));
  }

  async function action(id: string, action: string, opts?: { note?: string }) {
    const res = await fetch(`/api/purchase-orders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, note: opts?.note ?? null }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast({ type: "error", title: "Couldn't update", description: data?.error });
      return;
    }
    toast({ type: "success", title: `PO ${action}d` });
    load(tab);
  }

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="mine">Mine</TabsTrigger>
            <TabsTrigger value="approve">Approval queue</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2">
          <a
            href="/api/export/purchase-orders"
            className="inline-flex items-center gap-1.5 h-9 px-3 text-sm rounded-md border border-line text-fg hover:bg-card-2/40"
          >
            Export CSV
          </a>
          <Button onClick={() => setShowCreate(true)}>
            <Plus size={14} className="mr-1.5" /> New PO
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <SkeletonCard key={i} />)}</div>
      ) : rows.length === 0 ? (
        tab === "approve" ? (
          <EmptyState
            icon={Inbox}
            title="Nothing waiting on you"
            description="POs needing your approval will appear here. Inbox zero — go ship something."
          />
        ) : (
          <EmptyState
            icon={FileText}
            title="No purchase orders yet"
            description="Create a PO to request goods or services from one of your vendors — it'll route through your approval chain."
            actionLabel="New PO"
            onAction={() => setShowCreate(true)}
          />
        )
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-white/5">
                  {tab === "approve" && (
                    <th className="px-3 py-2.5 font-normal w-8">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleAll}
                        aria-label="Select all submitted"
                        disabled={submittedRows.length === 0}
                      />
                    </th>
                  )}
                  <th className="px-4 py-2.5 font-normal">PO #</th>
                  <th className="px-4 py-2.5 font-normal">Vendor</th>
                  <th className="px-4 py-2.5 font-normal">Description</th>
                  <th className="px-4 py-2.5 font-normal text-right">Amount</th>
                  <th className="px-4 py-2.5 font-normal">Requester</th>
                  <th className="px-4 py-2.5 font-normal">Status</th>
                  <th className="px-4 py-2.5 font-normal text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="border-b border-white/5 hover:bg-surface-2">
                    {tab === "approve" && (
                      <td className="px-3 py-2.5">
                        {p.status === "SUBMITTED" ? (
                          <input
                            type="checkbox"
                            checked={selectedIds.has(p.id)}
                            onChange={() => toggleId(p.id)}
                            aria-label={`Select PO ${p.number}`}
                          />
                        ) : null}
                      </td>
                    )}
                    <td className="px-4 py-2.5 font-mono text-xs">{p.number}</td>
                    <td className="px-4 py-2.5 text-xs">{p.vendor.name}</td>
                    <td className="px-4 py-2.5 text-xs truncate max-w-xs">{p.description}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs">{fmt(p.amount, p.currency)}</td>
                    <td className="px-4 py-2.5 text-xs text-muted">{p.requester.firstName} {p.requester.lastName}</td>
                    <td className="px-4 py-2.5">
                      <Badge variant="outline" className={`text-[10px] ${PO_STATUS_STYLE[p.status]}`}>{p.status}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <POActions po={p} onAction={action} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {showCreate && (
        <CreatePoDialog onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(tab); }} />
      )}

      {tab === "approve" && (
        <BulkApproveBar
          entityType="purchase-order"
          selectedIds={selectedArray}
          onClear={() => setSelectedIds(new Set())}
          onDone={() => load(tab)}
        />
      )}
    </>
  );
}

function POActions({ po, onAction }: { po: PO; onAction: (id: string, action: string, opts?: { note?: string }) => void }) {
  const buttons: Array<{ label: string; action: string; danger?: boolean }> = [];
  if (po.status === "DRAFT") buttons.push({ label: "Submit", action: "submit" });
  if (po.status === "SUBMITTED") buttons.push(
    { label: "Approve", action: "approve" },
    { label: "Reject", action: "reject", danger: true },
  );
  if (po.status === "APPROVED") buttons.push({ label: "Send", action: "send" });
  if (po.status === "SENT") buttons.push({ label: "Mark received", action: "receive" });
  if (po.status === "RECEIVED" || po.status === "REJECTED") buttons.push({ label: "Close", action: "close" });

  return (
    <div className="flex items-center justify-end gap-1">
      {buttons.map((b) => (
        <Button
          key={b.action}
          size="sm"
          variant="outline"
          className={`h-7 text-xs ${b.danger ? "text-red-400" : ""}`}
          onClick={() => {
            if (b.action === "reject") {
              const note = prompt("Reason for rejection?");
              if (note === null) return;
              onAction(po.id, b.action, { note });
            } else {
              onAction(po.id, b.action);
            }
          }}
        >
          {b.label}
        </Button>
      ))}
    </div>
  );
}

function CreatePoDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorId, setVendorId] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/vendors")
      .then((r) => r.ok ? r.json() : [])
      .then((data) => setVendors(Array.isArray(data) ? data : []))
      .catch(() => setVendors([]));
  }, []);

  async function save(submit: boolean) {
    setSaving(true);
    try {
      const res = await fetch("/api/purchase-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorId,
          description: description.trim(),
          amount: Number(amount),
          currency,
          expectedDeliveryDate: expectedDeliveryDate || undefined,
          notes: notes.trim() || undefined,
          submit,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: "Couldn't save", description: data?.error });
        return;
      }
      toast({ type: "success", title: submit ? "PO submitted" : "Draft saved" });
      onCreated();
    } finally { setSaving(false); }
  }

  const valid = vendorId && description.trim() && Number(amount) > 0;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New purchase order</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-1">
          <div className="space-y-1.5">
            <Label>Vendor</Label>
            <Select value={vendorId} onValueChange={setVendorId}>
              <SelectTrigger><SelectValue placeholder="Pick a vendor" /></SelectTrigger>
              <SelectContent>
                {vendors.length === 0 ? (
                  <div className="p-2 text-xs text-muted">Add a vendor first.</div>
                ) : vendors.filter((v) => !v.archived).map((v) => (
                  <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5"><Label>Amount</Label><Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></div>
            <div className="space-y-1.5"><Label>Currency</Label><Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))} maxLength={3} /></div>
            <div className="space-y-1.5"><Label>Expected delivery</Label><Input type="date" value={expectedDeliveryDate} onChange={(e) => setExpectedDeliveryDate(e.target.value)} /></div>
          </div>
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="outline" disabled={!valid || saving} onClick={() => save(false)}>Save draft</Button>
          <Button disabled={!valid || saving} onClick={() => save(true)}>{saving ? "…" : "Submit"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Invoices ──────────────────────────────────────────────────────

function InvoicesTab() {
  const { toast } = useToast();
  const { isAdmin } = useRole();
  const [rows, setRows] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectedArray = useMemo(() => Array.from(selectedIds), [selectedIds]);
  useEffect(() => { setSelectedIds(new Set()); }, [rows.length]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/invoices?limit=100");
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const pendingRows = rows.filter((r) => r.status === "PENDING");
  const allSelected = pendingRows.length > 0 && pendingRows.every((r) => selectedIds.has(r.id));
  function toggleId(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(pendingRows.map((r) => r.id)));
  }

  async function action(id: string, action: string, opts?: { note?: string }) {
    const res = await fetch(`/api/invoices/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, note: opts?.note ?? null }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast({ type: "error", title: "Couldn't update", description: data?.error });
      return;
    }
    toast({ type: "success", title: `Invoice ${action}d` });
    load();
  }

  return (
    <>
      <div className="flex justify-end mb-3 gap-2">
        <a
          href="/api/export/invoices"
          className="inline-flex items-center gap-1.5 h-9 px-3 text-sm rounded-md border border-line text-fg hover:bg-card-2/40"
        >
          Export CSV
        </a>
        <Button onClick={() => setShowCreate(true)}>
          <Plus size={14} className="mr-1.5" /> Record invoice
        </Button>
      </div>
      {loading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <SkeletonCard key={i} />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No invoices yet"
          description="Record an invoice against a PO to track what's owed and what's been paid — overdue invoices route to your AP queue automatically."
          actionLabel="Record invoice"
          onAction={() => setShowCreate(true)}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-white/5">
                  <th className="px-3 py-2.5 font-normal w-8">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      aria-label="Select all pending"
                      disabled={pendingRows.length === 0}
                    />
                  </th>
                  <th className="px-4 py-2.5 font-normal">Invoice #</th>
                  <th className="px-4 py-2.5 font-normal">Vendor</th>
                  <th className="px-4 py-2.5 font-normal">PO</th>
                  <th className="px-4 py-2.5 font-normal">Due</th>
                  <th className="px-4 py-2.5 font-normal text-right">Amount</th>
                  <th className="px-4 py-2.5 font-normal">Status</th>
                  <th className="px-4 py-2.5 font-normal text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((inv) => {
                  const isOverdue = new Date(inv.dueDate) < new Date() && inv.status !== "PAID";
                  return (
                    <tr key={inv.id} className="border-b border-white/5 hover:bg-surface-2">
                      <td className="px-3 py-2.5">
                        {inv.status === "PENDING" ? (
                          <input
                            type="checkbox"
                            checked={selectedIds.has(inv.id)}
                            onChange={() => toggleId(inv.id)}
                            aria-label={`Select invoice ${inv.invoiceNumber}`}
                          />
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="font-mono text-xs">{inv.invoiceNumber}</div>
                      </td>
                      <td className="px-4 py-2.5 text-xs">{inv.vendor.name}</td>
                      <td className="px-4 py-2.5 text-xs text-muted font-mono">{inv.purchaseOrder?.number ?? "—"}</td>
                      <td className={`px-4 py-2.5 text-xs ${isOverdue ? "text-red-400" : "text-muted"}`}>
                        {new Date(inv.dueDate).toLocaleDateString()}
                        {isOverdue && " · overdue"}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs">{fmt(inv.amount, inv.currency)}</td>
                      <td className="px-4 py-2.5">
                        <Badge variant="outline" className={`text-[10px] ${INVOICE_STATUS_STYLE[inv.status]}`}>{inv.status}</Badge>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {inv.status === "PENDING" && (
                            <>
                              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => action(inv.id, "approve")}>Approve</Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs text-red-400"
                                onClick={() => {
                                  const note = prompt("Reason for rejection?");
                                  if (note === null) return;
                                  action(inv.id, "reject", { note });
                                }}
                              >
                                Reject
                              </Button>
                            </>
                          )}
                          {inv.status === "APPROVED" && isAdmin && (
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => action(inv.id, "pay")}>Mark paid</Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
      {showCreate && (
        <CreateInvoiceDialog onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} />
      )}

      <BulkApproveBar
        entityType="invoice"
        selectedIds={selectedArray}
        onClear={() => setSelectedIds(new Set())}
        onDone={load}
      />
    </>
  );
}

function CreateInvoiceDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [pos, setPos] = useState<PO[]>([]);
  const [vendorId, setVendorId] = useState("");
  const [purchaseOrderId, setPurchaseOrderId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const today = new Date().toISOString().slice(0, 10);
  const in30 = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const [issueDate, setIssueDate] = useState(today);
  const [dueDate, setDueDate] = useState(in30);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/vendors")
      .then((r) => r.ok ? r.json() : [])
      .then((data) => setVendors(Array.isArray(data) ? data : []))
      .catch(() => setVendors([]));
  }, []);

  useEffect(() => {
    if (!vendorId) { setPos([]); return; }
    fetch("/api/purchase-orders?scope=all&limit=200")
      .then((r) => r.ok ? r.json() : [])
      .then((data) => {
        const list = (Array.isArray(data) ? data : []).filter((p: PO) => p.vendor.id === vendorId);
        setPos(list);
      })
      .catch(() => setPos([]));
  }, [vendorId]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorId,
          purchaseOrderId: purchaseOrderId || undefined,
          invoiceNumber: invoiceNumber.trim(),
          amount: Number(amount),
          currency,
          issueDate,
          dueDate,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: "Couldn't save", description: data?.error });
        return;
      }
      toast({ type: "success", title: "Invoice recorded" });
      onCreated();
    } finally { setSaving(false); }
  }

  const valid = vendorId && invoiceNumber.trim() && Number(amount) > 0 && issueDate && dueDate;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Record invoice</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-1">
          <div className="space-y-1.5">
            <Label>Vendor</Label>
            <Select value={vendorId} onValueChange={setVendorId}>
              <SelectTrigger><SelectValue placeholder="Pick a vendor" /></SelectTrigger>
              <SelectContent>
                {vendors.filter((v) => !v.archived).map((v) => (
                  <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {vendorId && pos.length > 0 && (
            <div className="space-y-1.5">
              <Label>Linked PO (optional)</Label>
              <Select value={purchaseOrderId} onValueChange={setPurchaseOrderId}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {pos.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.number} · {fmt(p.amount, p.currency)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Invoice #</Label>
            <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Amount</Label><Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></div>
            <div className="space-y-1.5"><Label>Currency</Label><Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))} maxLength={3} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Issue date</Label><Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Due date</Label><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button disabled={!valid || saving} onClick={save}>{saving ? "Recording…" : "Record"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
