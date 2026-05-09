"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  Link2, Plus, Check, AlertCircle, RefreshCw, Trash2, ExternalLink,
  Zap, ArrowRight, Clock, Database, Loader2, Send, Eye, CheckCircle, XCircle,
} from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageHeader } from "@/components/dashboard/page-header";

interface Integration {
  id: string;
  name: string;
  type: string;
  status: string;
  config: any;
  lastSyncAt: string | null;
  syncFrequency: string | null;
  _count: { syncLogs: number };
  createdAt: string;
}

interface WebhookLogEntry {
  id: string;
  direction: string;
  event: string | null;
  status: string;
  error: string | null;
  responseCode: number | null;
  createdAt: string;
}

const AVAILABLE_INTEGRATIONS = [
  {
    type: "HRMS",
    name: "HRMS / Payroll",
    description: "Import attendance summaries, compensation data, and employee records from your HRMS",
    examples: "GreytHR, BambooHR, Zoho People, Keka, Darwinbox",
    icon: "\u{1F3E2}",
    fields: [
      { key: "provider", label: "Provider", placeholder: "e.g. GreytHR, BambooHR, Keka" },
      { key: "apiUrl", label: "API Base URL", placeholder: "https://api.greythr.com/v1" },
      { key: "apiKey", label: "API Key", placeholder: "Your API key" },
    ],
    dataTypes: ["Attendance summary (for performance scoring)", "Compensation data (for hike decisions)", "Employee directory sync"],
  },
  {
    type: "SLACK",
    name: "Slack",
    description: "Send notifications, review reminders, and task updates to Slack channels",
    examples: "Slack Workspace",
    icon: "\u{1F4AC}",
    fields: [
      { key: "webhookUrl", label: "Webhook URL", placeholder: "https://hooks.slack.com/services/..." },
      { key: "channel", label: "Default Channel", placeholder: "#general" },
    ],
    dataTypes: ["Task notifications", "Review cycle alerts", "SOP compliance reminders"],
  },
  {
    type: "GOOGLE_WORKSPACE",
    name: "Google Workspace",
    description: "Sync calendar for meetings, import team directory from Google Admin",
    examples: "Google Calendar, Google Admin",
    icon: "\u{1F4C5}",
    fields: [
      { key: "domain", label: "Google Domain", placeholder: "yourcompany.com" },
      { key: "serviceAccountKey", label: "Service Account JSON", placeholder: "Paste service account key" },
    ],
    dataTypes: ["Calendar sync for meetings", "Team directory import"],
  },
  {
    type: "JIRA",
    name: "Jira / Project Tools",
    description: "Import task completion data to factor into performance scores",
    examples: "Jira, Asana, Linear, ClickUp",
    icon: "\u{1F4CB}",
    fields: [
      { key: "provider", label: "Provider", placeholder: "e.g. Jira, Linear, Asana" },
      { key: "apiUrl", label: "API URL", placeholder: "https://yourcompany.atlassian.net" },
      { key: "apiToken", label: "API Token", placeholder: "Your API token" },
    ],
    dataTypes: ["Sprint velocity data", "Task completion metrics", "Project progress"],
  },
  {
    type: "CUSTOM_WEBHOOK",
    name: "Custom Webhook",
    description: "Push or pull data from any system using webhooks",
    examples: "Any REST API",
    icon: "\u{1F517}",
    fields: [
      { key: "webhookUrl", label: "Webhook URL", placeholder: "https://your-system.com/webhook" },
      { key: "secret", label: "Webhook Secret", placeholder: "Optional signing secret" },
    ],
    dataTypes: ["Custom data import", "Event notifications"],
  },
];

function getStatusStyle(status: string) {
  switch (status) {
    case "ACTIVE": return "bg-green-500/20 text-green-400";
    case "ERROR": return "bg-red-500/20 text-red-400";
    case "SYNCING": return "bg-blue-500/20 text-blue-400";
    default: return "bg-border text-muted";
  }
}

function getStatusDot(status: string) {
  switch (status) {
    case "ACTIVE": return "bg-green-400";
    case "ERROR": return "bg-red-400";
    case "SYNCING": return "bg-blue-400 animate-pulse";
    default: return "bg-muted";
  }
}

function getLogStatusIcon(status: string) {
  switch (status) {
    case "sent":
    case "processed":
      return <CheckCircle size={12} className="text-green-400" />;
    case "failed":
      return <XCircle size={12} className="text-red-400" />;
    default:
      return <Clock size={12} className="text-muted" />;
  }
}

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);
  const [selectedType, setSelectedType] = useState<(typeof AVAILABLE_INTEGRATIONS)[0] | null>(null);
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Detail dialog
  const [detailIntegration, setDetailIntegration] = useState<Integration | null>(null);
  const [webhookLogs, setWebhookLogs] = useState<WebhookLogEntry[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<string | null>(null);
  const { success: toastSuccess, error: toastError } = useToast();

  useEffect(() => {
    fetchIntegrations();
  }, []);

  async function fetchIntegrations() {
    try {
      const res = await fetch("/api/integrations");
      const data = await res.json();
      setIntegrations(Array.isArray(data) ? data : []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  async function handleConnect() {
    if (!selectedType) return;
    setSaving(true);
    try {
      const res = await fetch("/api/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: configValues.provider || selectedType.name,
          type: selectedType.type,
          config: configValues,
        }),
      });
      if (res.ok) {
        setConnectDialogOpen(false);
        setSelectedType(null);
        setConfigValues({});
        fetchIntegrations();
        toastSuccess("Integration connected");
      } else {
        toastError("Failed to connect integration");
      }
    } catch {
      toastError("Failed to connect integration");
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect(id: string) {
    try {
      const res = await fetch(`/api/integrations/${id}`, { method: "DELETE" });
      if (res.ok) {
        toastSuccess("Integration removed");
      } else {
        toastError("Failed to remove integration");
      }
    } catch {
      toastError("Failed to remove integration");
    }
    setDetailIntegration(null);
    setDisconnectTarget(null);
    fetchIntegrations();
  }

  async function handleSync(id: string) {
    await fetch(`/api/integrations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "SYNCING" }),
    });
    fetchIntegrations();
    setTimeout(() => {
      fetch(`/api/integrations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ACTIVE" }),
      }).then(() => {
        fetchIntegrations();
        toastSuccess("Integration updated");
      });
    }, 3000);
  }

  async function openDetail(integration: Integration) {
    setDetailIntegration(integration);
    setTestResult(null);
    setLoadingLogs(true);
    try {
      const res = await fetch(`/api/integrations/${integration.id}/webhooks`);
      if (res.ok) {
        const data = await res.json();
        setWebhookLogs(Array.isArray(data) ? data : []);
      }
    } catch {
      setWebhookLogs([]);
    } finally {
      setLoadingLogs(false);
    }
  }

  async function handleTestConnection(id: string) {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`/api/integrations/${id}/test`, { method: "POST" });
      const data = await res.json();
      setTestResult(data);
      if (data.success) {
        toastSuccess("Connection test passed");
      } else {
        toastError("Connection test failed");
      }
      // Refresh logs
      const logsRes = await fetch(`/api/integrations/${id}/webhooks`);
      if (logsRes.ok) {
        const logsData = await logsRes.json();
        setWebhookLogs(Array.isArray(logsData) ? logsData : []);
      }
    } catch {
      setTestResult({ success: false, message: "Failed to send test webhook" });
      toastError("Connection test failed");
    } finally {
      setTesting(false);
    }
  }

  const connectedTypes = new Set(integrations.map((i) => i.type));

  return (
    <div className="space-y-3 animate-fade-in">
      <PageHeader
        breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Integrations" }]}
        kicker="Integrations · connectors"
        title="Integrations"
        subtitle="Connect your existing tools to pull data into WorkwrK for performance intelligence."
      />

      {/* Philosophy banner */}
      <Card className="border-[rgba(212,255,46,0.2)] bg-[rgba(212,255,46,0.06)]">
        <CardContent className="p-5 flex items-start gap-4">
          <div className="rounded-lg bg-[rgba(212,255,46,0.12)] p-2.5 flex-shrink-0">
            <Zap size={20} className="text-[color:var(--accent-strong)]" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">WorkwrK connects, it doesn&apos;t replace</h3>
            <p className="text-xs text-muted mt-1">
              Your HRMS handles attendance, payroll, and leave. WorkwrK pulls that data to power
              performance scoring, review decisions, and AI insights. We sit on top of your existing tools.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Connected integrations */}
      {integrations.length === 0 && !loading && (
        <EmptyState
          icon={Link2}
          title="No integrations"
          description="Connect WorkwrK with your existing tools like Slack, webhooks, and more."
          actionLabel="Add Integration"
          onAction={() => setConnectDialogOpen(true)}
        />
      )}
      {integrations.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted uppercase tracking-wider">Connected</h2>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {integrations.map((integration) => (
              <Card key={integration.id} className="hover:border-muted-2 transition-colors cursor-pointer" onClick={() => openDetail(integration)}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-2 text-lg">
                          {AVAILABLE_INTEGRATIONS.find((a) => a.type === integration.type)?.icon || "\u{1F517}"}
                        </div>
                        <div className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface ${getStatusDot(integration.status)}`} />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold">{integration.name}</h3>
                        <p className="text-xs text-muted">{integration.type.replace(/_/g, " ")}</p>
                      </div>
                    </div>
                    <Badge className={getStatusStyle(integration.status)}>
                      {integration.status === "SYNCING" ? (
                        <span className="flex items-center gap-1">
                          <Loader2 size={10} className="animate-spin" /> Syncing
                        </span>
                      ) : (
                        integration.status
                      )}
                    </Badge>
                  </div>

                  <div className="mt-4 flex items-center gap-4 text-xs text-muted">
                    <span className="flex items-center gap-1">
                      <Clock size={12} />
                      {integration.lastSyncAt
                        ? `Last sync: ${new Date(integration.lastSyncAt).toLocaleDateString()}`
                        : "Never synced"}
                    </span>
                    <span className="flex items-center gap-1">
                      <Database size={12} />
                      {integration._count.syncLogs} syncs
                    </span>
                    <span>
                      Frequency: {integration.syncFrequency || "manual"}
                    </span>
                  </div>

                  <div className="mt-4 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleSync(integration.id)}
                      disabled={integration.status === "SYNCING"}
                      className="gap-1.5"
                    >
                      <RefreshCw size={14} /> Sync Now
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openDetail(integration)}
                      className="gap-1.5"
                    >
                      <Eye size={14} /> Details
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDisconnectTarget(integration.id)}
                      className="text-red-400 hover:text-red-300 hover:bg-red-500/10 gap-1.5"
                    >
                      <Trash2 size={14} /> Disconnect
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Available integrations */}
      <div className="space-y-3">
        <h2 className="text-sm font-medium text-muted uppercase tracking-wider">
          Available Integrations
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {AVAILABLE_INTEGRATIONS.map((integration) => {
            const isConnected = connectedTypes.has(integration.type);
            return (
              <Card
                key={integration.type}
                className={isConnected ? "border-green-500/20 opacity-70" : "hover:border-muted-2 transition-colors"}
              >
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="text-2xl">{integration.icon}</div>
                    {isConnected && (
                      <Badge className="bg-green-500/20 text-green-400 text-[10px]">Connected</Badge>
                    )}
                  </div>
                  <h3 className="mt-3 text-sm font-semibold">{integration.name}</h3>
                  <p className="mt-1 text-xs text-muted line-clamp-2">{integration.description}</p>
                  <p className="mt-2 text-[10px] text-muted">{integration.examples}</p>

                  <div className="mt-3 space-y-1">
                    {integration.dataTypes.map((dt) => (
                      <div key={dt} className="flex items-center gap-1.5 text-[11px] text-muted">
                        <ArrowRight size={10} className="text-[color:var(--accent-strong)] flex-shrink-0" />
                        <span>{dt}</span>
                      </div>
                    ))}
                  </div>

                  {!isConnected && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-4 w-full gap-1.5"
                      onClick={() => {
                        setSelectedType(integration);
                        setConfigValues({});
                        setConnectDialogOpen(true);
                      }}
                    >
                      <Link2 size={14} /> Connect
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Connect Dialog */}
      <Dialog open={connectDialogOpen} onOpenChange={setConnectDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="text-xl">{selectedType?.icon}</span>
              Connect {selectedType?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted">{selectedType?.description}</p>
            {selectedType?.fields.map((field) => (
              <div key={field.key} className="space-y-2">
                <Label>{field.label}</Label>
                <Input
                  placeholder={field.placeholder}
                  value={configValues[field.key] || ""}
                  onChange={(e) =>
                    setConfigValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                  }
                  type={field.key.toLowerCase().includes("key") || field.key.toLowerCase().includes("secret") || field.key.toLowerCase().includes("token")
                    ? "password"
                    : "text"
                  }
                />
              </div>
            ))}

            <div className="rounded-lg border border-border bg-background p-3">
              <p className="text-xs font-medium text-muted mb-2">Data that will be imported:</p>
              {selectedType?.dataTypes.map((dt) => (
                <div key={dt} className="flex items-center gap-1.5 text-xs text-muted py-0.5">
                  <Check size={12} className="text-green-400" />
                  <span>{dt}</span>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConnectDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleConnect} disabled={saving} className="gap-1.5">
              {saving ? (
                <><Loader2 size={14} className="animate-spin" /> Connecting...</>
              ) : (
                <><Link2 size={14} /> Connect</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Disconnect Confirm Dialog */}
      <ConfirmDialog
        open={!!disconnectTarget}
        onClose={() => setDisconnectTarget(null)}
        title="Disconnect Integration"
        description="Are you sure you want to disconnect this integration? This action cannot be undone."
        confirmLabel="Disconnect"
        onConfirm={() => { if (disconnectTarget) handleDisconnect(disconnectTarget); }}
      />

      {/* Detail/Webhook Log Dialog */}
      <Dialog open={!!detailIntegration} onOpenChange={(open) => { if (!open) setDetailIntegration(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="text-xl">
                {AVAILABLE_INTEGRATIONS.find((a) => a.type === detailIntegration?.type)?.icon || "\u{1F517}"}
              </span>
              {detailIntegration?.name}
              <Badge className={getStatusStyle(detailIntegration?.status || "INACTIVE")}>
                {detailIntegration?.status}
              </Badge>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Connection info */}
            <div className="rounded-lg border border-border p-3 space-y-2">
              <p className="text-xs font-medium text-muted">Connection Details</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <span className="text-muted">Type:</span>
                <span>{detailIntegration?.type?.replace(/_/g, " ")}</span>
                <span className="text-muted">Frequency:</span>
                <span>{detailIntegration?.syncFrequency || "Manual"}</span>
                <span className="text-muted">Last Sync:</span>
                <span>{detailIntegration?.lastSyncAt ? new Date(detailIntegration.lastSyncAt).toLocaleString() : "Never"}</span>
                <span className="text-muted">Webhook URL:</span>
                <span className="truncate">{(detailIntegration?.config as any)?.webhookUrl ? "Configured" : "Not set"}</span>
              </div>
            </div>

            {/* Test Connection */}
            {(detailIntegration?.config as any)?.webhookUrl && (
              <div className="space-y-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => detailIntegration && handleTestConnection(detailIntegration.id)}
                  disabled={testing}
                >
                  {testing ? (
                    <><Loader2 size={14} className="animate-spin" /> Testing...</>
                  ) : (
                    <><Send size={14} /> Test Connection</>
                  )}
                </Button>
                {testResult && (
                  <div className={`rounded-lg border p-2 text-xs ${
                    testResult.success
                      ? "border-green-500/30 bg-green-500/10 text-green-400"
                      : "border-red-500/30 bg-red-500/10 text-red-400"
                  }`}>
                    {testResult.success ? <CheckCircle size={12} className="inline mr-1" /> : <XCircle size={12} className="inline mr-1" />}
                    {testResult.message}
                  </div>
                )}
              </div>
            )}

            {/* Webhook Logs */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted">Recent Webhook Events</p>
              {loadingLogs ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-8 animate-pulse rounded bg-surface-2" />
                  ))}
                </div>
              ) : webhookLogs.length === 0 ? (
                <p className="text-xs text-muted text-center py-4">No webhook events yet</p>
              ) : (
                <div className="max-h-60 overflow-y-auto space-y-1">
                  {webhookLogs.map((log) => (
                    <div key={log.id} className="flex items-center gap-2 rounded border border-border px-3 py-2 text-xs">
                      {getLogStatusIcon(log.status)}
                      <Badge variant="outline" className="text-[9px] px-1.5">
                        {log.direction === "incoming" ? "IN" : "OUT"}
                      </Badge>
                      <span className="flex-1 truncate">{log.event || "unknown"}</span>
                      <span className={`font-mono ${log.status === "sent" || log.status === "processed" ? "text-green-400" : log.status === "failed" ? "text-red-400" : "text-muted"}`}>
                        {log.status}
                      </span>
                      {log.responseCode && (
                        <span className="text-muted font-mono">{log.responseCode}</span>
                      )}
                      <span className="text-muted">
                        {new Date(log.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Incoming webhook URL */}
            <div className="rounded-lg border border-border bg-background p-3">
              <p className="text-xs font-medium text-muted mb-1">Incoming Webhook URL</p>
              <code className="text-[10px] text-[color:var(--accent-strong)] break-all">
                {typeof window !== "undefined" ? window.location.origin : ""}/api/webhooks/{detailIntegration?.id}
              </code>
              <p className="text-[10px] text-muted mt-1">Use this URL to send data to WorkwrK from external services.</p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => detailIntegration && setDisconnectTarget(detailIntegration.id)}
              className="text-red-400 hover:text-red-300 hover:bg-red-500/10 gap-1.5"
            >
              <Trash2 size={14} /> Disconnect
            </Button>
            <Button variant="outline" onClick={() => setDetailIntegration(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
