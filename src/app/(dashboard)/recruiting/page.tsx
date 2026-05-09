"use client";

// Recruiting workspace. Three tabs:
//   Jobs       — requisitions list + create + status transitions
//   Candidates — talent pool list + create
//   Pipeline   — kanban-style board of applications grouped by stage,
//                with inline stage-move dropdown
//
// Detail pages for individual jobs / candidates / applications are v2;
// for v1 everything is reachable from this page.

import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
import {
  Briefcase,
  Users,
  GitBranch,
  Plus,
  Mail,
  Phone,
  ExternalLink,
  ChevronRight,
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────

type Job = {
  id: string;
  title: string;
  status: "DRAFT" | "OPEN" | "ON_HOLD" | "CLOSED" | "FILLED";
  employmentType: string;
  location: string | null;
  openings: number;
  publishedAt: string | null;
  closedAt: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string;
  department: { id: string; name: string } | null;
  hiringManager: { id: string; firstName: string; lastName: string } | null;
  _count: { applications: number };
};

type Candidate = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  source: string | null;
  resumeUrl: string | null;
  hiredUserId: string | null;
  _count: { applications: number };
};

type Application = {
  id: string;
  stage: "APPLIED" | "SCREENING" | "INTERVIEW" | "OFFER" | "HIRED" | "REJECTED" | "WITHDRAWN";
  rejectionReason: string | null;
  source: string | null;
  notes: string | null;
  job: { id: string; title: string };
  candidate: { id: string; firstName: string; lastName: string; email: string };
  recruiter: { id: string; firstName: string; lastName: string } | null;
};

const STAGES: Application["stage"][] = [
  "APPLIED",
  "SCREENING",
  "INTERVIEW",
  "OFFER",
  "HIRED",
  "REJECTED",
];

const STAGE_LABEL: Record<string, string> = {
  APPLIED: "Applied",
  SCREENING: "Screening",
  INTERVIEW: "Interview",
  OFFER: "Offer",
  HIRED: "Hired",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
};

const STAGE_STYLE: Record<string, string> = {
  APPLIED: "text-muted border-white/20",
  SCREENING: "text-blue-400 border-blue-400/30",
  INTERVIEW: "text-amber-400 border-amber-400/30",
  OFFER: "text-[color:var(--accent-strong)] border-[#d4ff2e]/30",
  HIRED: "text-green-400 border-green-400/30",
  REJECTED: "text-red-400 border-red-400/30",
  WITHDRAWN: "text-muted border-white/20",
};

const JOB_STATUS_STYLE: Record<string, string> = {
  DRAFT: "text-muted border-white/20",
  OPEN: "text-[color:var(--accent-strong)] border-[#d4ff2e]/30",
  ON_HOLD: "text-amber-400 border-amber-400/30",
  CLOSED: "text-blue-400 border-blue-400/30",
  FILLED: "text-green-400 border-green-400/30",
};

function fmtSalary(min: number | null, max: number | null, currency: string): string {
  if (min === null && max === null) return "—";
  const fmt = (n: number) => {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
    } catch {
      return `${currency} ${n.toFixed(0)}`;
    }
  };
  if (min !== null && max !== null) return `${fmt(min)} – ${fmt(max)}`;
  if (min !== null) return `from ${fmt(min)}`;
  return `up to ${fmt(max!)}`;
}

// ─── Page shell ────────────────────────────────────────────────────

export default function RecruitingPage() {
  const { isManager } = useRole();
  if (!isManager) return null; // layout already guards, but defense-in-depth
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Briefcase size={20} /> Recruiting
        </h1>
        <p className="text-muted text-sm mt-1">
          Open requisitions, talent pool, and pipeline movement.
        </p>
      </div>

      <Tabs defaultValue="jobs">
        <TabsList>
          <TabsTrigger value="jobs">Jobs</TabsTrigger>
          <TabsTrigger value="candidates">Candidates</TabsTrigger>
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
          <TabsTrigger value="interviews">Interviews</TabsTrigger>
        </TabsList>
        <TabsContent value="jobs" className="mt-4">
          <JobsTab />
        </TabsContent>
        <TabsContent value="candidates" className="mt-4">
          <CandidatesTab />
        </TabsContent>
        <TabsContent value="pipeline" className="mt-4">
          <PipelineTab />
        </TabsContent>
        <TabsContent value="interviews" className="mt-4">
          <InterviewsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Jobs tab ──────────────────────────────────────────────────────

function JobsTab() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/recruiting/jobs?limit=200");
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: "Couldn't load jobs", description: data?.error });
        return;
      }
      setRows(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  async function transition(id: string, status: Job["status"]) {
    const res = await fetch(`/api/recruiting/jobs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast({ type: "error", title: "Couldn't update", description: data?.error });
      return;
    }
    toast({ type: "success", title: `Job ${status.toLowerCase().replace("_", " ")}` });
    load();
  }

  return (
    <>
      <div className="flex justify-end mb-3">
        <Button onClick={() => setShowCreate(true)}>
          <Plus size={14} className="mr-1.5" /> New job
        </Button>
      </div>

      {loading ? (
        <div className="text-center py-8 text-sm text-muted">Loading…</div>
      ) : rows.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-sm text-muted">No jobs yet.</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-white/5">
                  <th className="px-4 py-2.5 font-normal">Title</th>
                  <th className="px-4 py-2.5 font-normal">Department</th>
                  <th className="px-4 py-2.5 font-normal">Location</th>
                  <th className="px-4 py-2.5 font-normal">Salary</th>
                  <th className="px-4 py-2.5 font-normal">Apps</th>
                  <th className="px-4 py-2.5 font-normal">Status</th>
                  <th className="px-4 py-2.5 font-normal text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((j) => (
                  <tr key={j.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{j.title}</div>
                      <div className="text-[10px] text-muted">
                        {j.employmentType.replace("_", " ").toLowerCase()}
                        {j.openings > 1 && ` · ${j.openings} openings`}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted">{j.department?.name ?? "—"}</td>
                    <td className="px-4 py-2.5 text-xs text-muted">{j.location ?? "—"}</td>
                    <td className="px-4 py-2.5 text-xs font-mono">{fmtSalary(j.salaryMin, j.salaryMax, j.salaryCurrency)}</td>
                    <td className="px-4 py-2.5 text-xs font-mono">{j._count.applications}</td>
                    <td className="px-4 py-2.5">
                      <Badge variant="outline" className={`text-[10px] ${JOB_STATUS_STYLE[j.status]}`}>
                        {j.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {j.status === "DRAFT" && (
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => transition(j.id, "OPEN")}>
                          Publish
                        </Button>
                      )}
                      {j.status === "OPEN" && (
                        <>
                          <Button size="sm" variant="outline" className="h-7 text-xs mr-1" onClick={() => transition(j.id, "ON_HOLD")}>
                            Hold
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => transition(j.id, "CLOSED")}>
                            Close
                          </Button>
                        </>
                      )}
                      {j.status === "ON_HOLD" && (
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => transition(j.id, "OPEN")}>
                          Resume
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {showCreate && (
        <CreateJobDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load(); }}
        />
      )}
    </>
  );
}

function CreateJobDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [employmentType, setEmploymentType] = useState("FULL_TIME");
  const [location, setLocation] = useState("");
  const [openings, setOpenings] = useState("1");
  const [salaryMin, setSalaryMin] = useState("");
  const [salaryMax, setSalaryMax] = useState("");
  const [salaryCurrency, setSalaryCurrency] = useState("USD");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/recruiting/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          employmentType,
          location: location.trim() || undefined,
          openings: Number(openings) || 1,
          salaryMin: salaryMin || undefined,
          salaryMax: salaryMax || undefined,
          salaryCurrency,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: "Couldn't create", description: data?.error });
        return;
      }
      toast({ type: "success", title: "Job created (draft)" });
      onCreated();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New job</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-1">
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={employmentType} onValueChange={setEmploymentType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="FULL_TIME">Full-time</SelectItem>
                  <SelectItem value="PART_TIME">Part-time</SelectItem>
                  <SelectItem value="CONTRACT">Contract</SelectItem>
                  <SelectItem value="INTERN">Intern</SelectItem>
                  <SelectItem value="TEMPORARY">Temporary</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Openings</Label>
              <Input value={openings} onChange={(e) => setOpenings(e.target.value)} inputMode="numeric" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Location</Label>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Remote, NYC" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5 col-span-1">
              <Label>Currency</Label>
              <Input value={salaryCurrency} onChange={(e) => setSalaryCurrency(e.target.value.toUpperCase().slice(0, 3))} maxLength={3} />
            </div>
            <div className="space-y-1.5 col-span-1">
              <Label>Salary min</Label>
              <Input value={salaryMin} onChange={(e) => setSalaryMin(e.target.value)} inputMode="decimal" />
            </div>
            <div className="space-y-1.5 col-span-1">
              <Label>Salary max</Label>
              <Input value={salaryMax} onChange={(e) => setSalaryMax(e.target.value)} inputMode="decimal" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Description (optional)</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button disabled={!title.trim() || saving} onClick={save}>
            {saving ? "Creating…" : "Create draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Candidates tab ────────────────────────────────────────────────

function CandidatesTab() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showApply, setShowApply] = useState<Candidate | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/recruiting/candidates?limit=200");
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: "Couldn't load candidates" });
        return;
      }
      setRows(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <div className="flex justify-end mb-3">
        <Button onClick={() => setShowCreate(true)}>
          <Plus size={14} className="mr-1.5" /> Add candidate
        </Button>
      </div>

      {loading ? (
        <div className="text-center py-8 text-sm text-muted">Loading…</div>
      ) : rows.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-sm text-muted">No candidates yet.</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-white/5">
                  <th className="px-4 py-2.5 font-normal">Name</th>
                  <th className="px-4 py-2.5 font-normal">Email</th>
                  <th className="px-4 py-2.5 font-normal">Phone</th>
                  <th className="px-4 py-2.5 font-normal">Source</th>
                  <th className="px-4 py-2.5 font-normal">Apps</th>
                  <th className="px-4 py-2.5 font-normal text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{c.firstName} {c.lastName}</div>
                      {c.hiredUserId && (
                        <div className="text-[10px] text-green-400">Hired</div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      <a href={`mailto:${c.email}`} className="hover:underline inline-flex items-center gap-1">
                        <Mail size={10} /> {c.email}
                      </a>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted">
                      {c.phone ? (
                        <span className="inline-flex items-center gap-1"><Phone size={10} /> {c.phone}</span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted">{c.source ?? "—"}</td>
                    <td className="px-4 py-2.5 text-xs font-mono">{c._count.applications}</td>
                    <td className="px-4 py-2.5 text-right">
                      {c.resumeUrl && (
                        <a
                          href={c.resumeUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-muted hover:text-fg mr-2 inline-flex items-center gap-1"
                        >
                          Resume <ExternalLink size={10} />
                        </a>
                      )}
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowApply(c)}>
                        Apply to job
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {showCreate && (
        <CreateCandidateDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load(); }}
        />
      )}
      {showApply && (
        <ApplyCandidateDialog
          candidate={showApply}
          onClose={() => setShowApply(null)}
          onCreated={() => { setShowApply(null); load(); }}
        />
      )}
    </>
  );
}

function CreateCandidateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [source, setSource] = useState("");
  const [resumeUrl, setResumeUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/recruiting/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          phone: phone.trim() || undefined,
          source: source.trim() || undefined,
          resumeUrl: resumeUrl.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: "Couldn't add", description: data?.error });
        return;
      }
      toast({ type: "success", title: "Candidate added" });
      onCreated();
    } finally {
      setSaving(false);
    }
  }

  const valid = firstName.trim() && lastName.trim() && email.includes("@");

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add candidate</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>First name</Label>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label>Last name</Label>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Source</Label>
              <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. LinkedIn, Referral" />
            </div>
            <div className="space-y-1.5">
              <Label>Resume URL</Label>
              <Input value={resumeUrl} onChange={(e) => setResumeUrl(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button disabled={!valid || saving} onClick={save}>{saving ? "Saving…" : "Add"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ApplyCandidateDialog({
  candidate,
  onClose,
  onCreated,
}: {
  candidate: Candidate;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobId, setJobId] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/recruiting/jobs?status=OPEN&limit=200")
      .then((r) => r.ok ? r.json() : [])
      .then((data) => setJobs(Array.isArray(data) ? data : []))
      .catch(() => setJobs([]));
  }, []);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/recruiting/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId: candidate.id, jobId }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: "Couldn't apply", description: data?.error });
        return;
      }
      toast({ type: "success", title: "Application created" });
      onCreated();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Apply {candidate.firstName} {candidate.lastName} to a job</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-1">
          <div className="space-y-1.5">
            <Label>Job</Label>
            <Select value={jobId} onValueChange={setJobId}>
              <SelectTrigger><SelectValue placeholder="Pick an open job" /></SelectTrigger>
              <SelectContent>
                {jobs.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-muted">No open jobs.</div>
                ) : (
                  jobs.map((j) => (
                    <SelectItem key={j.id} value={j.id}>
                      {j.title} {j.department && `· ${j.department.name}`}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button disabled={!jobId || saving} onClick={save}>{saving ? "…" : "Create application"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Pipeline tab (kanban) ─────────────────────────────────────────

function PipelineTab() {
  const { toast } = useToast();
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/recruiting/applications?limit=500");
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: "Couldn't load pipeline" });
        return;
      }
      setApps(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const byStage = useMemo(() => {
    const m = new Map<string, Application[]>();
    for (const s of STAGES) m.set(s, []);
    for (const a of apps) {
      const arr = m.get(a.stage) ?? [];
      arr.push(a);
      m.set(a.stage, arr);
    }
    return m;
  }, [apps]);

  async function move(appId: string, stage: Application["stage"]) {
    let body: Record<string, unknown> = { stage };
    if (stage === "REJECTED") {
      const reason = prompt("Reason for rejection?");
      if (reason === null) return;
      body = { ...body, rejectionReason: reason };
    }
    const res = await fetch(`/api/recruiting/applications/${appId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast({ type: "error", title: "Couldn't move", description: data?.error });
      return;
    }
    toast({ type: "success", title: `Moved to ${STAGE_LABEL[stage]}` });
    load();
  }

  if (loading) return <div className="text-sm text-muted text-center py-8">Loading…</div>;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
      {STAGES.map((s) => {
        const list = byStage.get(s) ?? [];
        return (
          <Card key={s} className="min-h-[200px]">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs uppercase tracking-wide flex items-center justify-between">
                <span>{STAGE_LABEL[s]}</span>
                <span className="text-[10px] font-normal text-muted">{list.length}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 p-3">
              {list.length === 0 ? (
                <p className="text-[10px] text-muted">—</p>
              ) : (
                list.map((a) => (
                  <ApplicationCard key={a.id} app={a} onMove={move} />
                ))
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function ApplicationCard({
  app,
  onMove,
}: {
  app: Application;
  onMove: (id: string, stage: Application["stage"]) => void;
}) {
  const next = nextStage(app.stage);
  return (
    <div className="rounded-md border border-white/10 bg-card-2/30 p-2 text-xs hover:border-white/20 transition-colors">
      <div className="font-medium truncate">
        {app.candidate.firstName} {app.candidate.lastName}
      </div>
      <div className="text-[10px] text-muted truncate mt-0.5">{app.job.title}</div>
      {app.recruiter && (
        <div className="text-[10px] text-muted truncate mt-0.5">
          {app.recruiter.firstName} {app.recruiter.lastName}
        </div>
      )}
      {next && app.stage !== "HIRED" && app.stage !== "REJECTED" && (
        <div className="flex items-center gap-1 mt-2">
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[10px] px-1.5 flex-1"
            onClick={() => onMove(app.id, next)}
          >
            <ChevronRight size={10} className="mr-0.5" /> {STAGE_LABEL[next]}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[10px] px-1.5 text-red-400"
            onClick={() => onMove(app.id, "REJECTED")}
          >
            Reject
          </Button>
        </div>
      )}
    </div>
  );
}

function nextStage(s: Application["stage"]): Application["stage"] | null {
  const order: Application["stage"][] = ["APPLIED", "SCREENING", "INTERVIEW", "OFFER", "HIRED"];
  const i = order.indexOf(s);
  if (i < 0 || i >= order.length - 1) return null;
  return order[i + 1] ?? null;
}

// ─── Interviews tab ────────────────────────────────────────────────

type Interview = {
  id: string;
  scheduledAt: string;
  durationMinutes: number;
  type: string;
  location: string | null;
  status: "SCHEDULED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
  score: number | null;
  notes: string | null;
  interviewer: { id: string; firstName: string; lastName: string };
  application: {
    id: string;
    candidate: { id: string; firstName: string; lastName: string };
    job: { id: string; title: string };
  };
};

const INTERVIEW_STATUS_STYLE: Record<string, string> = {
  SCHEDULED: "text-blue-400 border-blue-400/30",
  COMPLETED: "text-green-400 border-green-400/30",
  CANCELLED: "text-muted border-white/20",
  NO_SHOW: "text-red-400 border-red-400/30",
};

const INTERVIEW_TYPE_LABEL: Record<string, string> = {
  SCREEN: "Phone screen",
  TECHNICAL: "Technical",
  BEHAVIORAL: "Behavioral",
  ONSITE: "On-site",
  FINAL: "Final",
  OTHER: "Other",
};

function InterviewsTab() {
  const { toast } = useToast();
  const [scope, setScope] = useState<"mine" | "upcoming" | "all">("mine");
  const [rows, setRows] = useState<Interview[]>([]);
  const [loading, setLoading] = useState(true);
  const [scheduling, setScheduling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/interviews?scope=${scope}&limit=100`);
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } finally { setLoading(false); }
  }, [scope]);

  useEffect(() => { load(); }, [load]);

  async function patch(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/interviews/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      toast({ type: "error", title: "Couldn't update", description: data?.error });
      return;
    }
    toast({ type: "success", title: "Updated" });
    load();
  }

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <Tabs value={scope} onValueChange={(v) => setScope(v as typeof scope)}>
          <TabsList>
            <TabsTrigger value="mine">My interviews</TabsTrigger>
            <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button onClick={() => setScheduling(true)}>
          <Plus size={14} className="mr-1.5" /> Schedule
        </Button>
      </div>

      {loading ? (
        <div className="text-center py-8 text-sm text-muted">Loading…</div>
      ) : rows.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-sm text-muted">
          {scope === "mine" ? "No interviews assigned to you." : "No interviews."}
        </CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-white/5">
                  <th className="px-4 py-2.5 font-normal">When</th>
                  <th className="px-4 py-2.5 font-normal">Type</th>
                  <th className="px-4 py-2.5 font-normal">Candidate</th>
                  <th className="px-4 py-2.5 font-normal">Job</th>
                  <th className="px-4 py-2.5 font-normal">Interviewer</th>
                  <th className="px-4 py-2.5 font-normal">Status</th>
                  <th className="px-4 py-2.5 font-normal text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((iv) => {
                  const when = new Date(iv.scheduledAt);
                  const isPast = when.getTime() < Date.now();
                  return (
                    <tr key={iv.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                      <td className="px-4 py-2.5 text-xs">
                        <div>{when.toLocaleDateString()}</div>
                        <div className="text-[10px] text-muted">
                          {when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          {" · "}
                          {iv.durationMinutes}m
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-xs">{INTERVIEW_TYPE_LABEL[iv.type] ?? iv.type}</td>
                      <td className="px-4 py-2.5 text-xs">
                        {iv.application.candidate.firstName} {iv.application.candidate.lastName}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted">{iv.application.job.title}</td>
                      <td className="px-4 py-2.5 text-xs">
                        {iv.interviewer.firstName} {iv.interviewer.lastName}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge variant="outline" className={`text-[10px] ${INTERVIEW_STATUS_STYLE[iv.status]}`}>
                          {iv.status}
                        </Badge>
                        {iv.score !== null && (
                          <span className="ml-2 text-[10px] text-muted">{iv.score}/5</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {iv.status === "SCHEDULED" && (
                            <>
                              {isPast && (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs"
                                    onClick={() => {
                                      const score = prompt("Score 1-5?");
                                      if (score === null) return;
                                      const s = Number(score);
                                      if (!Number.isFinite(s) || s < 1 || s > 5) return;
                                      const notes = prompt("Notes (optional)?") ?? null;
                                      patch(iv.id, { status: "COMPLETED", score: s, notes });
                                    }}
                                  >
                                    Mark complete
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs text-amber-400"
                                    onClick={() => patch(iv.id, { status: "NO_SHOW" })}
                                  >
                                    No-show
                                  </Button>
                                </>
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs text-red-400"
                                onClick={() => {
                                  if (confirm("Cancel this interview?")) patch(iv.id, { status: "CANCELLED" });
                                }}
                              >
                                Cancel
                              </Button>
                            </>
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

      {scheduling && (
        <ScheduleInterviewDialog
          onClose={() => setScheduling(false)}
          onScheduled={() => { setScheduling(false); load(); }}
        />
      )}
    </>
  );
}

function ScheduleInterviewDialog({
  onClose,
  onScheduled,
}: {
  onClose: () => void;
  onScheduled: () => void;
}) {
  const { toast } = useToast();
  const [applications, setApplications] = useState<Application[]>([]);
  const [interviewers, setInterviewers] = useState<Array<{ id: string; firstName: string; lastName: string; email: string }>>([]);
  const [applicationId, setApplicationId] = useState("");
  const [interviewerId, setInterviewerId] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("30");
  const [type, setType] = useState("SCREEN");
  const [location, setLocation] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/recruiting/applications?limit=200").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/people?limit=500").then((r) => (r.ok ? r.json() : [])).catch(() => []),
    ]).then(([apps, peopleResp]) => {
      // Filter to non-terminated applications.
      const live = (Array.isArray(apps) ? apps : []).filter(
        (a: Application) => !["HIRED", "REJECTED", "WITHDRAWN"].includes(a.stage),
      );
      setApplications(live);
      // /api/people sometimes returns { data: [...] }, sometimes a flat array.
      const flat = Array.isArray(peopleResp) ? peopleResp : peopleResp?.data ?? [];
      setInterviewers(flat);
    });
  }, []);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/interviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          applicationId,
          interviewerId,
          scheduledAt: new Date(scheduledAt).toISOString(),
          durationMinutes: Number(durationMinutes) || 30,
          type,
          location: location.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: "Couldn't schedule", description: data?.error });
        return;
      }
      toast({ type: "success", title: "Interview scheduled" });
      onScheduled();
    } finally { setSaving(false); }
  }

  const valid = applicationId && interviewerId && scheduledAt;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Schedule interview</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-1">
          <div className="space-y-1.5">
            <Label>Application</Label>
            <Select value={applicationId} onValueChange={setApplicationId}>
              <SelectTrigger><SelectValue placeholder="Pick an application" /></SelectTrigger>
              <SelectContent>
                {applications.length === 0 ? (
                  <div className="p-2 text-xs text-muted">No active applications.</div>
                ) : applications.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.candidate.firstName} {a.candidate.lastName} · {a.job.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Interviewer</Label>
            <Select value={interviewerId} onValueChange={setInterviewerId}>
              <SelectTrigger><SelectValue placeholder="Pick an interviewer" /></SelectTrigger>
              <SelectContent>
                {interviewers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.firstName} {p.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5 col-span-2">
              <Label>When</Label>
              <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Duration (min)</Label>
              <Input value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)} inputMode="numeric" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(INTERVIEW_TYPE_LABEL).map(([v, l]) => (
                  <SelectItem key={v} value={v}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Location (optional)</Label>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Zoom URL or office room" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button disabled={!valid || saving} onClick={save}>{saving ? "Scheduling…" : "Schedule"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
