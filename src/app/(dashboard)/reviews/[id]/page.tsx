"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft, Star, Users, CheckCircle, Clock, BarChart3, Send, AlertTriangle,
  UserPlus, TrendingUp, Shield,
} from "lucide-react";

function getScoreColor(score: number) {
  if (score >= 90) return "text-green-400";
  if (score >= 70) return "text-purple-400";
  if (score >= 50) return "text-orange-400";
  return "text-red-400";
}

function getProgressColor(pct: number) {
  if (pct >= 90) return "bg-green-500";
  if (pct >= 70) return "bg-yellow-500";
  return "bg-red-500";
}

function getStatusBadge(status: string) {
  switch (status) {
    case "PENDING": return <Badge variant="secondary">Pending</Badge>;
    case "SELF_ASSESSMENT": return <Badge className="bg-blue-500/20 text-blue-400">Self-Assessment Done</Badge>;
    case "MANAGER_REVIEW": return <Badge className="bg-purple-500/20 text-purple-400">Manager Reviewed</Badge>;
    case "CALIBRATION": return <Badge variant="warning">Calibrated</Badge>;
    case "COMPLETED": return <Badge variant="success">Completed</Badge>;
    default: return <Badge variant="secondary">{status}</Badge>;
  }
}

function getOutcomeBadge(outcome: string) {
  switch (outcome) {
    case "PROMOTION_ELIGIBLE": return <Badge variant="success">Promotion Eligible</Badge>;
    case "HIKE_ELIGIBLE": return <Badge className="bg-blue-500/20 text-blue-400">Hike Eligible</Badge>;
    case "STATUS_QUO": return <Badge variant="warning">Status Quo</Badge>;
    case "PIP_REQUIRED": return <Badge variant="destructive">PIP Required</Badge>;
    case "EXIT_RECOMMENDATION": return <Badge variant="destructive">Exit Recommendation</Badge>;
    default: return null;
  }
}

const behavioralLabels: Record<string, { label: string; anchors: string[] }> = {
  quality: { label: "Quality of Work", anchors: ["Consistently below standard", "Sometimes meets standard", "Meets expectations", "Often exceeds expectations", "Exceptional quality"] },
  reliability: { label: "Reliability & Accountability", anchors: ["Unreliable", "Needs reminders", "Dependable", "Very reliable", "Exemplary accountability"] },
  collaboration: { label: "Collaboration & Teamwork", anchors: ["Works in isolation", "Minimal collaboration", "Good team player", "Strong collaborator", "Exceptional team leader"] },
  initiative: { label: "Initiative & Ownership", anchors: ["Passive", "Follows instructions", "Shows some initiative", "Proactive", "Drives change and innovation"] },
  growth: { label: "Growth & Learning", anchors: ["No growth", "Slow learner", "Steady growth", "Fast learner", "Continuous self-improvement"] },
};

export default function ReviewCycleDetailPage() {
  const { id: cycleId } = useParams();
  const router = useRouter();

  const [cycle, setCycle] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Self-assessment state
  const [selfData, setSelfData] = useState<any>(null);
  const [loadingSelf, setLoadingSelf] = useState(false);
  const [kraRatings, setKraRatings] = useState<Record<string, { rating: number; achievements: string }>>({});
  const [reflection, setReflection] = useState({ wentWell: "", couldImprove: "", goals: "" });
  const [savingSelf, setSavingSelf] = useState(false);

  // Manager review state
  const [teamReviews, setTeamReviews] = useState<any[]>([]);
  const [loadingTeam, setLoadingTeam] = useState(false);
  const [selectedReview, setSelectedReview] = useState<any>(null);
  const [mgrKraRatings, setMgrKraRatings] = useState<Record<string, { rating: number; comments: string }>>({});
  const [behavioral, setBehavioral] = useState<Record<string, number>>({});
  const [mgrComments, setMgrComments] = useState("");
  const [mgrOutcome, setMgrOutcome] = useState("");
  const [savingMgr, setSavingMgr] = useState(false);

  // Peer feedback state
  const [peerRequests, setPeerRequests] = useState<any[]>([]);
  const [loadingPeer, setLoadingPeer] = useState(false);
  const [showPeerDialog, setShowPeerDialog] = useState<any>(null);
  const [peerStrengths, setPeerStrengths] = useState("");
  const [peerImprovements, setPeerImprovements] = useState("");
  const [peerCollabRating, setPeerCollabRating] = useState(0);
  const [peerComments, setPeerComments] = useState("");
  const [savingPeer, setSavingPeer] = useState(false);

  // Peer request dialog (manager assigning peers)
  const [showAssignPeersDialog, setShowAssignPeersDialog] = useState<any>(null);
  const [peerUserIds, setPeerUserIds] = useState<string[]>([]);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [savingPeerReq, setSavingPeerReq] = useState(false);

  // Calibration state
  const [calibrationData, setCalibrationData] = useState<any>(null);
  const [loadingCalib, setLoadingCalib] = useState(false);
  const [editingCalib, setEditingCalib] = useState<{ reviewId: string; score: string; notes: string } | null>(null);
  const [savingCalib, setSavingCalib] = useState(false);

  // Finalize state
  const [savingFinalize, setSavingFinalize] = useState(false);

  const fetchCycle = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/reviews/${cycleId}`);
      if (res.ok) {
        const data = await res.json();
        setCycle(data);
      }
    } catch {} finally { setLoading(false); }
  }, [cycleId]);

  const fetchSelfAssessment = useCallback(async () => {
    try {
      setLoadingSelf(true);
      const res = await fetch(`/api/reviews/${cycleId}/self-assessment`);
      if (res.ok) {
        const data = await res.json();
        setSelfData(data);
        // Pre-fill from existing data
        if (data.review?.selfRatings) {
          const sr = data.review.selfRatings;
          const ratings: Record<string, { rating: number; achievements: string }> = {};
          (sr.kraRatings || []).forEach((r: any) => { ratings[r.kraId] = { rating: r.rating, achievements: r.achievements || "" }; });
          setKraRatings(ratings);
          if (sr.reflection) setReflection(sr.reflection);
        }
      }
    } catch {} finally { setLoadingSelf(false); }
  }, [cycleId]);

  const fetchTeamReviews = useCallback(async () => {
    try {
      setLoadingTeam(true);
      const res = await fetch(`/api/reviews/${cycleId}/manager-review`);
      if (res.ok) setTeamReviews(await res.json());
    } catch {} finally { setLoadingTeam(false); }
  }, [cycleId]);

  const fetchPeerFeedback = useCallback(async () => {
    try {
      setLoadingPeer(true);
      const res = await fetch(`/api/reviews/${cycleId}/peer-feedback`);
      if (res.ok) setPeerRequests(await res.json());
    } catch {} finally { setLoadingPeer(false); }
  }, [cycleId]);

  const fetchCalibration = useCallback(async () => {
    try {
      setLoadingCalib(true);
      const res = await fetch(`/api/reviews/${cycleId}/calibration`);
      if (res.ok) setCalibrationData(await res.json());
    } catch {} finally { setLoadingCalib(false); }
  }, [cycleId]);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/users?limit=500");
      if (res.ok) {
        const data = await res.json();
        setAllUsers(Array.isArray(data) ? data : data.users ?? data.data ?? []);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchCycle();
    fetchSelfAssessment();
    fetchTeamReviews();
    fetchPeerFeedback();
    fetchCalibration();
    fetchUsers();
  }, [fetchCycle, fetchSelfAssessment, fetchTeamReviews, fetchPeerFeedback, fetchCalibration, fetchUsers]);

  // --- Handlers ---

  const handleSelfAssessment = async (submit: boolean) => {
    setSavingSelf(true);
    try {
      const selfRatings = {
        kraRatings: Object.entries(kraRatings).map(([kraId, data]) => ({
          kraId,
          kraName: selfData?.kraAssignments?.find((a: any) => a.kra.id === kraId)?.kra.name || "",
          rating: data.rating,
          achievements: data.achievements,
        })),
        reflection,
      };
      const res = await fetch(`/api/reviews/${cycleId}/self-assessment`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selfRatings, submit }),
      });
      if (res.ok) {
        await fetchSelfAssessment();
        await fetchCycle();
      }
    } catch {} finally { setSavingSelf(false); }
  };

  const handleManagerReview = async (reviewId: string, submit: boolean) => {
    setSavingMgr(true);
    try {
      const managerAssessment = {
        kraRatings: Object.entries(mgrKraRatings).map(([kraId, data]) => ({
          kraId,
          kraName: "",
          rating: data.rating,
          comments: data.comments,
        })),
        behavioral,
        overallComments: mgrComments,
        recommendation: mgrOutcome,
      };
      const res = await fetch(`/api/reviews/${cycleId}/manager-review`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewId, managerAssessment, outcome: submit ? mgrOutcome : undefined, managerComments: mgrComments, submit }),
      });
      if (res.ok) {
        setSelectedReview(null);
        await fetchTeamReviews();
        await fetchCycle();
      }
    } catch {} finally { setSavingMgr(false); }
  };

  const handlePeerSubmit = async (feedbackId: string) => {
    setSavingPeer(true);
    try {
      const res = await fetch(`/api/reviews/${cycleId}/peer-feedback`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedbackId, strengths: peerStrengths, improvements: peerImprovements, collaborationRating: peerCollabRating, comments: peerComments }),
      });
      if (res.ok) {
        setShowPeerDialog(null);
        setPeerStrengths(""); setPeerImprovements(""); setPeerCollabRating(0); setPeerComments("");
        await fetchPeerFeedback();
      }
    } catch {} finally { setSavingPeer(false); }
  };

  const handleAssignPeers = async (reviewId: string) => {
    setSavingPeerReq(true);
    try {
      const res = await fetch(`/api/reviews/${cycleId}/peer-feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewId, peerIds: peerUserIds }),
      });
      if (res.ok) {
        setShowAssignPeersDialog(null);
        setPeerUserIds([]);
        await fetchTeamReviews();
      }
    } catch {} finally { setSavingPeerReq(false); }
  };

  const handleCalibrationSave = async () => {
    if (!editingCalib) return;
    setSavingCalib(true);
    try {
      const res = await fetch(`/api/reviews/${cycleId}/calibration`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewId: editingCalib.reviewId, calibratedScore: parseFloat(editingCalib.score), calibrationNotes: editingCalib.notes }),
      });
      if (res.ok) {
        setEditingCalib(null);
        await fetchCalibration();
        await fetchCycle();
      }
    } catch {} finally { setSavingCalib(false); }
  };

  const handleFinalize = async () => {
    if (!calibrationData?.calibrationData) return;
    setSavingFinalize(true);
    try {
      const outcomes = calibrationData.calibrationData
        .filter((d: any) => d.outcome)
        .map((d: any) => ({
          reviewId: d.reviewId,
          outcome: d.outcome,
          overallScore: d.calibratedScore ?? d.compositeScore,
        }));
      const res = await fetch(`/api/reviews/${cycleId}/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcomes }),
      });
      if (res.ok) {
        await fetchCycle();
        await fetchCalibration();
      }
    } catch {} finally { setSavingFinalize(false); }
  };

  if (loading) {
    return (
      <div className="space-y-4 animate-fade-in">
        <div className="h-8 w-48 bg-surface-2 rounded animate-pulse" />
        <div className="h-32 bg-surface rounded-lg border border-border animate-pulse" />
        <div className="h-64 bg-surface rounded-lg border border-border animate-pulse" />
      </div>
    );
  }

  if (!cycle) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <p className="text-muted">Review cycle not found</p>
        <Button variant="ghost" className="mt-2" onClick={() => router.push("/reviews")}>Back to Reviews</Button>
      </div>
    );
  }

  const stats = cycle.stats || {};
  const myReview = selfData?.review;
  const canSelfAssess = myReview && (myReview.status === "PENDING" || myReview.status === "SELF_ASSESSMENT");

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => router.push("/reviews")}>
          <ArrowLeft size={16} className="mr-1" /> Back
        </Button>
      </div>

      {/* Cycle Info Banner */}
      <Card className="border-purple-500/30 bg-purple-500/5">
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="text-xl font-bold">{cycle.name}</h1>
              <p className="text-xs text-muted">
                {new Date(cycle.startDate).toLocaleDateString()} — {new Date(cycle.endDate).toLocaleDateString()}
                <span className="mx-2">&middot;</span>
                {cycle.type.replace(/_/g, " ")}
              </p>
            </div>
            {getStatusBadge(cycle.status)}
          </div>
          <div className="flex items-center gap-2 mb-2">
            <Progress value={stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0} className="h-2 flex-1" indicatorClassName="bg-purple-500" />
            <span className="text-sm font-mono text-purple-400">{stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0}%</span>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted">
            <span className="flex items-center gap-1"><Users size={12} /> {stats.total} total</span>
            <span className="flex items-center gap-1"><CheckCircle size={12} className="text-blue-400" /> {stats.selfDone} self done</span>
            <span className="flex items-center gap-1"><Star size={12} className="text-purple-400" /> {stats.managerDone} mgr done</span>
            <span className="flex items-center gap-1"><BarChart3 size={12} className="text-orange-400" /> {stats.calibrated} calibrated</span>
            <span className="flex items-center gap-1"><CheckCircle size={12} className="text-green-400" /> {stats.completed} completed</span>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="self-assessment">
        <TabsList>
          <TabsTrigger value="self-assessment" className="gap-2"><Star size={14} /> My Review</TabsTrigger>
          <TabsTrigger value="manager-review" className="gap-2"><Users size={14} /> Team Reviews</TabsTrigger>
          <TabsTrigger value="peer-feedback" className="gap-2"><Send size={14} /> Peer Feedback</TabsTrigger>
          <TabsTrigger value="calibration" className="gap-2"><BarChart3 size={14} /> Calibration</TabsTrigger>
          <TabsTrigger value="dashboard" className="gap-2"><TrendingUp size={14} /> Dashboard</TabsTrigger>
        </TabsList>

        {/* ===== SELF-ASSESSMENT TAB ===== */}
        <TabsContent value="self-assessment" className="mt-4 space-y-4">
          {loadingSelf ? (
            <Card><CardContent className="p-8 text-center text-muted">Loading...</CardContent></Card>
          ) : !selfData ? (
            <Card><CardContent className="p-8 text-center text-muted">No review found for you in this cycle.</CardContent></Card>
          ) : (
            <>
              {/* Status */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted">Your review status:</span>
                {getStatusBadge(myReview.status)}
                {myReview.status !== "PENDING" && myReview.status !== "SELF_ASSESSMENT" && (
                  <span className="text-xs text-green-400">Self-assessment submitted</span>
                )}
              </div>

              {/* Auto-populated Metrics (READ ONLY) */}
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Auto-Populated Metrics</CardTitle></CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="rounded-lg border border-border bg-surface p-3 text-center">
                      <p className={`text-2xl font-bold font-mono ${selfData.metrics.avgKpiScore != null ? getScoreColor(selfData.metrics.avgKpiScore) : "text-muted"}`}>
                        {selfData.metrics.avgKpiScore ?? "N/A"}
                      </p>
                      <p className="text-[10px] text-muted">Avg KPI Score</p>
                    </div>
                    <div className="rounded-lg border border-border bg-surface p-3 text-center">
                      <p className={`text-2xl font-bold font-mono ${selfData.metrics.avgSopScore != null ? getScoreColor(selfData.metrics.avgSopScore) : "text-muted"}`}>
                        {selfData.metrics.avgSopScore ?? "N/A"}
                      </p>
                      <p className="text-[10px] text-muted">SOP Compliance</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* KRA Self-Ratings */}
              {selfData.kraAssignments?.length > 0 && (
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Rate Your KRA Performance</CardTitle></CardHeader>
                  <CardContent className="space-y-4">
                    {selfData.kraAssignments.map((a: any) => (
                      <div key={a.kra.id} className="rounded-lg border border-border bg-surface p-4">
                        <div className="flex items-center justify-between mb-2">
                          <div>
                            <p className="text-sm font-medium">{a.kra.name}</p>
                            <Badge variant="outline" className="text-[10px]">{a.kra.category}</Badge>
                          </div>
                          <span className="text-sm text-muted">{a.weightage}% weightage</span>
                        </div>
                        <div className="space-y-2 mt-3">
                          <Label className="text-xs">Self Rating (1-5)</Label>
                          <div className="flex gap-1">
                            {[1, 2, 3, 4, 5].map((n) => (
                              <button
                                key={n}
                                disabled={!canSelfAssess}
                                onClick={() => setKraRatings((prev) => ({ ...prev, [a.kra.id]: { ...prev[a.kra.id], rating: n, achievements: prev[a.kra.id]?.achievements || "" } }))}
                                className={`h-8 w-8 rounded text-sm font-bold transition-colors ${
                                  kraRatings[a.kra.id]?.rating === n
                                    ? "bg-purple-600 text-white"
                                    : "bg-border text-muted hover:bg-border"
                                } ${!canSelfAssess ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                              >
                                {n}
                              </button>
                            ))}
                          </div>
                          <Label className="text-xs">Key Achievements</Label>
                          <Textarea
                            disabled={!canSelfAssess}
                            placeholder="Describe your key achievements for this KRA..."
                            value={kraRatings[a.kra.id]?.achievements || ""}
                            onChange={(e) => setKraRatings((prev) => ({ ...prev, [a.kra.id]: { ...prev[a.kra.id], rating: prev[a.kra.id]?.rating || 0, achievements: e.target.value } }))}
                            className="min-h-[60px]"
                          />
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Self-Reflection */}
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Self-Reflection</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-2">
                    <Label className="text-xs">What went well this period?</Label>
                    <Textarea disabled={!canSelfAssess} placeholder="Your wins and achievements..." value={reflection.wentWell} onChange={(e) => setReflection((r) => ({ ...r, wentWell: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">What could improve?</Label>
                    <Textarea disabled={!canSelfAssess} placeholder="Areas for improvement..." value={reflection.couldImprove} onChange={(e) => setReflection((r) => ({ ...r, couldImprove: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Goals for next period</Label>
                    <Textarea disabled={!canSelfAssess} placeholder="What do you plan to achieve..." value={reflection.goals} onChange={(e) => setReflection((r) => ({ ...r, goals: e.target.value }))} />
                  </div>
                </CardContent>
              </Card>

              {/* Submit buttons */}
              {canSelfAssess && (
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => handleSelfAssessment(false)} disabled={savingSelf}>
                    {savingSelf ? "Saving..." : "Save Draft"}
                  </Button>
                  <Button onClick={() => handleSelfAssessment(true)} disabled={savingSelf}>
                    {savingSelf ? "Submitting..." : "Submit Self-Assessment"}
                  </Button>
                </div>
              )}

              {/* View completed review */}
              {myReview.status === "COMPLETED" && myReview.outcome && (
                <Card className="border-green-500/30 bg-green-500/5">
                  <CardContent className="p-5">
                    <h3 className="font-semibold mb-2">Your Review Results</h3>
                    <div className="flex items-center gap-4">
                      <div>
                        <p className="text-xs text-muted">Overall Score</p>
                        <p className={`text-2xl font-bold font-mono ${getScoreColor(myReview.overallScore || 0)}`}>{myReview.overallScore ?? "—"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted">Outcome</p>
                        {getOutcomeBadge(myReview.outcome)}
                      </div>
                    </div>
                    {myReview.managerComments && (
                      <div className="mt-3 border-t border-border pt-3">
                        <p className="text-xs text-muted mb-1">Manager Comments</p>
                        <p className="text-sm">{myReview.managerComments}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        {/* ===== MANAGER REVIEW TAB ===== */}
        <TabsContent value="manager-review" className="mt-4 space-y-4">
          {loadingTeam ? (
            <Card><CardContent className="p-8 text-center text-muted">Loading team reviews...</CardContent></Card>
          ) : teamReviews.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-muted">No team members to review in this cycle.</CardContent></Card>
          ) : !selectedReview ? (
            /* Team list */
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Your Team&apos;s Reviews</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {teamReviews.map((review: any) => (
                  <div
                    key={review.id}
                    className="flex items-center gap-3 rounded-lg border border-border p-3 hover:bg-surface-2/50 cursor-pointer transition-colors"
                    onClick={() => {
                      setSelectedReview(review);
                      // Pre-fill if existing manager assessment
                      if (review.managerAssessment) {
                        const ma = review.managerAssessment;
                        const ratings: Record<string, { rating: number; comments: string }> = {};
                        (ma.kraRatings || []).forEach((r: any) => { ratings[r.kraId] = { rating: r.rating, comments: r.comments || "" }; });
                        setMgrKraRatings(ratings);
                        setBehavioral(ma.behavioral || {});
                        setMgrComments(ma.overallComments || review.managerComments || "");
                        setMgrOutcome(ma.recommendation || review.outcome || "");
                      } else {
                        setMgrKraRatings({});
                        setBehavioral({});
                        setMgrComments(review.managerComments || "");
                        setMgrOutcome(review.outcome || "");
                      }
                    }}
                  >
                    <Avatar className="h-9 w-9">
                      <AvatarFallback className="text-xs">{review.subject.firstName[0]}{review.subject.lastName[0]}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{review.subject.firstName} {review.subject.lastName}</p>
                      <p className="text-xs text-muted">{review.subject.role?.title || ""} {review.subject.department ? `· ${review.subject.department.name}` : ""}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {getStatusBadge(review.status)}
                      <Button variant="ghost" size="sm" className="h-7 px-2" onClick={(e) => { e.stopPropagation(); setShowAssignPeersDialog(review); }}>
                        <UserPlus size={14} className="text-muted" />
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : (
            /* Individual manager review form */
            <>
              <Button variant="ghost" size="sm" onClick={() => setSelectedReview(null)}>
                <ArrowLeft size={14} className="mr-1" /> Back to Team
              </Button>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">
                    Reviewing: {selectedReview.subject.firstName} {selectedReview.subject.lastName}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2 mb-4">
                    {getStatusBadge(selectedReview.status)}
                    {selectedReview.kpiScore != null && (
                      <span className="text-xs text-muted">KPI Score: <span className={`font-mono ${getScoreColor(selectedReview.kpiScore)}`}>{selectedReview.kpiScore}</span></span>
                    )}
                    {selectedReview.sopComplianceScore != null && (
                      <span className="text-xs text-muted">SOP: <span className="font-mono">{selectedReview.sopComplianceScore}%</span></span>
                    )}
                  </div>

                  {/* Self-assessment preview */}
                  {selectedReview.selfRatings && (
                    <div className="mb-4 rounded-lg border border-border bg-background p-3">
                      <p className="text-xs font-medium text-muted mb-2">Employee&apos;s Self-Assessment</p>
                      {(selectedReview.selfRatings.kraRatings || []).map((r: any) => (
                        <div key={r.kraId} className="mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs">{r.kraName}</span>
                            <span className="text-xs font-mono text-purple-400">{r.rating}/5</span>
                          </div>
                          {r.achievements && <p className="text-[10px] text-muted ml-2">{r.achievements}</p>}
                        </div>
                      ))}
                      {selectedReview.selfRatings.reflection && (
                        <div className="mt-2 space-y-1 border-t border-border pt-2">
                          {selectedReview.selfRatings.reflection.wentWell && <p className="text-[10px] text-green-400">Went well: {selectedReview.selfRatings.reflection.wentWell}</p>}
                          {selectedReview.selfRatings.reflection.couldImprove && <p className="text-[10px] text-orange-400">Could improve: {selectedReview.selfRatings.reflection.couldImprove}</p>}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Peer feedback preview */}
                  {selectedReview.peerFeedback?.length > 0 && (
                    <div className="mb-4 rounded-lg border border-border bg-background p-3">
                      <p className="text-xs font-medium text-muted mb-2">Peer Feedback ({selectedReview.peerFeedback.length})</p>
                      {selectedReview.peerFeedback.map((pf: any, i: number) => (
                        <div key={i} className="mb-2 text-[10px]">
                          {!pf.anonymous && <span className="text-purple-400">{pf.giver.firstName} {pf.giver.lastName}: </span>}
                          {pf.strengths && <p className="text-green-400">Strengths: {pf.strengths}</p>}
                          {pf.improvements && <p className="text-orange-400">Improvements: {pf.improvements}</p>}
                          {pf.collaborationRating && <span className="text-muted">Collaboration: {pf.collaborationRating}/5</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Behavioral Ratings */}
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Behavioral Assessment</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  {Object.entries(behavioralLabels).map(([key, { label, anchors }]) => (
                    <div key={key}>
                      <Label className="text-xs">{label}</Label>
                      <div className="flex gap-1 mt-1">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button
                            key={n}
                            onClick={() => setBehavioral((prev) => ({ ...prev, [key]: n }))}
                            className={`flex-1 h-9 rounded text-xs transition-colors ${
                              behavioral[key] === n
                                ? "bg-purple-600 text-white"
                                : "bg-border text-muted hover:bg-border"
                            }`}
                            title={anchors[n - 1]}
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                      <p className="text-[10px] text-muted mt-0.5">{behavioral[key] ? anchors[(behavioral[key] || 1) - 1] : "Select rating"}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* Manager Comments & Outcome */}
              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="space-y-2">
                    <Label className="text-xs">Overall Manager Comments</Label>
                    <Textarea placeholder="Your overall assessment..." value={mgrComments} onChange={(e) => setMgrComments(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Outcome Recommendation</Label>
                    <Select value={mgrOutcome} onValueChange={setMgrOutcome}>
                      <SelectTrigger><SelectValue placeholder="Select outcome" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="PROMOTION_ELIGIBLE">Promotion Eligible</SelectItem>
                        <SelectItem value="HIKE_ELIGIBLE">Hike Eligible</SelectItem>
                        <SelectItem value="STATUS_QUO">Status Quo</SelectItem>
                        <SelectItem value="PIP_REQUIRED">PIP Required</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => handleManagerReview(selectedReview.id, false)} disabled={savingMgr}>
                  {savingMgr ? "Saving..." : "Save Draft"}
                </Button>
                <Button onClick={() => handleManagerReview(selectedReview.id, true)} disabled={savingMgr}>
                  {savingMgr ? "Submitting..." : "Submit Manager Review"}
                </Button>
              </div>
            </>
          )}
        </TabsContent>

        {/* ===== PEER FEEDBACK TAB ===== */}
        <TabsContent value="peer-feedback" className="mt-4 space-y-4">
          {loadingPeer ? (
            <Card><CardContent className="p-8 text-center text-muted">Loading...</CardContent></Card>
          ) : peerRequests.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-muted">No peer feedback requests for you in this cycle.</CardContent></Card>
          ) : (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Peer Feedback Requests</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {peerRequests.map((pf: any) => (
                  <div key={pf.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
                    <Avatar className="h-9 w-9">
                      <AvatarFallback className="text-xs">{pf.receiver.firstName[0]}{pf.receiver.lastName[0]}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">Feedback for: {pf.receiver.firstName} {pf.receiver.lastName}</p>
                      <p className="text-xs text-muted">{pf.review?.cycle?.name || ""}</p>
                    </div>
                    {pf.status === "SUBMITTED" ? (
                      <Badge variant="success" className="text-[10px]">Submitted</Badge>
                    ) : (
                      <Button size="sm" onClick={() => setShowPeerDialog(pf)}>Give Feedback</Button>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ===== CALIBRATION TAB ===== */}
        <TabsContent value="calibration" className="mt-4 space-y-4">
          {loadingCalib ? (
            <Card><CardContent className="p-8 text-center text-muted">Loading calibration data...</CardContent></Card>
          ) : !calibrationData ? (
            <Card><CardContent className="p-8 text-center text-muted">Calibration data not available. You may not have manager access.</CardContent></Card>
          ) : (
            <>
              {calibrationData.warning && (
                <div className="flex items-center gap-2 rounded-lg border border-orange-500/30 bg-orange-500/5 p-3">
                  <AlertTriangle size={16} className="text-orange-400" />
                  <p className="text-sm text-orange-400">{calibrationData.warning}</p>
                </div>
              )}

              {/* Bell Curve Distribution */}
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Rating Distribution</CardTitle></CardHeader>
                <CardContent>
                  <div className="flex items-end gap-2 h-24">
                    {[
                      { label: "<40", count: calibrationData.distribution.bottom, color: "bg-red-500" },
                      { label: "40-59", count: calibrationData.distribution.low, color: "bg-orange-500" },
                      { label: "60-74", count: calibrationData.distribution.mid, color: "bg-yellow-500" },
                      { label: "75-89", count: calibrationData.distribution.high, color: "bg-purple-500" },
                      { label: "90+", count: calibrationData.distribution.top, color: "bg-green-500" },
                    ].map((band) => {
                      const maxCount = Math.max(...Object.values(calibrationData.distribution) as number[], 1);
                      const height = (band.count / maxCount) * 100;
                      return (
                        <div key={band.label} className="flex-1 flex flex-col items-center gap-1">
                          <span className="text-[10px] font-mono">{band.count}</span>
                          <div className={`w-full rounded-t ${band.color}`} style={{ height: `${Math.max(height, 4)}%` }} />
                          <span className="text-[10px] text-muted">{band.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              {/* Calibration Table */}
              <Card>
                <CardContent className="p-0">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left p-3 text-xs font-medium text-muted uppercase">Person</th>
                        <th className="text-center p-3 text-xs font-medium text-muted uppercase">KPI</th>
                        <th className="text-center p-3 text-xs font-medium text-muted uppercase">Self</th>
                        <th className="text-center p-3 text-xs font-medium text-muted uppercase">Mgr</th>
                        <th className="text-center p-3 text-xs font-medium text-muted uppercase">Peer</th>
                        <th className="text-center p-3 text-xs font-medium text-muted uppercase">Composite</th>
                        <th className="text-center p-3 text-xs font-medium text-muted uppercase">Calibrated</th>
                        <th className="text-center p-3 text-xs font-medium text-muted uppercase">Outcome</th>
                        <th className="text-right p-3 text-xs font-medium text-muted uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {calibrationData.calibrationData.map((d: any) => (
                        <tr key={d.reviewId} className="border-b border-border/50 hover:bg-surface-2/50">
                          <td className="p-3">
                            <p className="text-sm font-medium">{d.subject.firstName} {d.subject.lastName}</p>
                            <p className="text-[10px] text-muted">{d.subject.department?.name}</p>
                          </td>
                          <td className={`p-3 text-center font-mono text-sm ${getScoreColor(d.kpiScore)}`}>{d.kpiScore}</td>
                          <td className={`p-3 text-center font-mono text-sm ${getScoreColor(d.selfRating)}`}>{d.selfRating}</td>
                          <td className={`p-3 text-center font-mono text-sm ${getScoreColor(d.managerRating)}`}>{d.managerRating}</td>
                          <td className={`p-3 text-center font-mono text-sm ${getScoreColor(d.peerRating)}`}>{d.peerRating}</td>
                          <td className={`p-3 text-center font-mono text-sm font-bold ${getScoreColor(d.compositeScore)}`}>{d.compositeScore}</td>
                          <td className="p-3 text-center">
                            {d.calibratedScore != null ? (
                              <span className={`font-mono text-sm font-bold ${getScoreColor(d.calibratedScore)}`}>{d.calibratedScore}</span>
                            ) : (
                              <span className="text-xs text-muted">—</span>
                            )}
                          </td>
                          <td className="p-3 text-center">{d.outcome ? getOutcomeBadge(d.outcome) : <span className="text-xs text-muted">—</span>}</td>
                          <td className="p-3 text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => setEditingCalib({ reviewId: d.reviewId, score: String(d.calibratedScore ?? d.compositeScore), notes: d.calibrationNotes || "" })}
                            >
                              Adjust
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>

              {/* Finalize Button */}
              {cycle.status !== "COMPLETED" && (
                <div className="flex justify-end">
                  <Button onClick={handleFinalize} disabled={savingFinalize} className="gap-2">
                    <Shield size={14} />
                    {savingFinalize ? "Finalizing..." : "Finalize All Outcomes"}
                  </Button>
                </div>
              )}
            </>
          )}
        </TabsContent>

        {/* ===== DASHBOARD TAB ===== */}
        <TabsContent value="dashboard" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Review Cycle Progress</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-5 gap-3">
                {[
                  { label: "Total Reviews", value: stats.total, icon: Users, color: "text-muted" },
                  { label: "Self-Assessment Done", value: stats.selfDone, icon: Star, color: "text-blue-400" },
                  { label: "Manager Review Done", value: stats.managerDone, icon: CheckCircle, color: "text-purple-400" },
                  { label: "Calibrated", value: stats.calibrated, icon: BarChart3, color: "text-orange-400" },
                  { label: "Completed", value: stats.completed, icon: CheckCircle, color: "text-green-400" },
                ].map((stat) => (
                  <div key={stat.label} className="rounded-lg border border-border bg-surface p-3 text-center">
                    <stat.icon size={16} className={`mx-auto mb-1 ${stat.color}`} />
                    <p className="text-xl font-bold font-mono">{stat.value}</p>
                    <p className="text-[10px] text-muted">{stat.label}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* People who haven't completed */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Pending Actions</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {cycle.reviews?.filter((r: any) => r.status === "PENDING").length === 0 ? (
                <p className="text-sm text-muted text-center py-4">Everyone has started their reviews!</p>
              ) : (
                cycle.reviews?.filter((r: any) => r.status === "PENDING").map((r: any) => (
                  <div key={r.id} className="flex items-center gap-3 rounded-lg border border-border p-2">
                    <Avatar className="h-7 w-7">
                      <AvatarFallback className="text-[10px]">{r.subject.firstName[0]}{r.subject.lastName[0]}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm">{r.subject.firstName} {r.subject.lastName}</p>
                    </div>
                    <Badge variant="warning" className="text-[10px]">Self-Assessment Pending</Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ===== DIALOGS ===== */}

      {/* Peer Feedback Dialog */}
      <Dialog open={!!showPeerDialog} onOpenChange={(open) => { if (!open) setShowPeerDialog(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Peer Feedback for {showPeerDialog?.receiver?.firstName} {showPeerDialog?.receiver?.lastName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="text-xs">What does this person do well?</Label>
              <Textarea placeholder="Their strengths and contributions..." value={peerStrengths} onChange={(e) => setPeerStrengths(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">What could this person improve?</Label>
              <Textarea placeholder="Areas for growth..." value={peerImprovements} onChange={(e) => setPeerImprovements(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Collaboration Rating (1-5)</Label>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    onClick={() => setPeerCollabRating(n)}
                    className={`h-9 w-9 rounded text-sm font-bold transition-colors ${
                      peerCollabRating === n ? "bg-purple-600 text-white" : "bg-border text-muted hover:bg-border"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Additional Comments</Label>
              <Textarea placeholder="Any other feedback..." value={peerComments} onChange={(e) => setPeerComments(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPeerDialog(null)}>Cancel</Button>
            <Button onClick={() => handlePeerSubmit(showPeerDialog.id)} disabled={savingPeer || !peerStrengths.trim()}>
              {savingPeer ? "Submitting..." : "Submit Feedback"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Peers Dialog */}
      <Dialog open={!!showAssignPeersDialog} onOpenChange={(open) => { if (!open) { setShowAssignPeersDialog(null); setPeerUserIds([]); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Peer Reviewers for {showAssignPeersDialog?.subject?.firstName} {showAssignPeersDialog?.subject?.lastName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-xs text-muted">Select 2-3 peers to provide feedback. They will be notified.</p>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {allUsers
                .filter((u: any) => u.id !== showAssignPeersDialog?.subject?.id)
                .map((u: any) => (
                  <label key={u.id} className="flex items-center gap-2 rounded-lg border border-border p-2 cursor-pointer hover:bg-surface-2/50">
                    <input
                      type="checkbox"
                      checked={peerUserIds.includes(u.id)}
                      onChange={(e) => {
                        if (e.target.checked) setPeerUserIds((prev) => [...prev, u.id]);
                        else setPeerUserIds((prev) => prev.filter((id) => id !== u.id));
                      }}
                      className="rounded"
                    />
                    <span className="text-sm">{u.firstName} {u.lastName}</span>
                  </label>
                ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAssignPeersDialog(null)}>Cancel</Button>
            <Button onClick={() => handleAssignPeers(showAssignPeersDialog.id)} disabled={savingPeerReq || peerUserIds.length === 0}>
              {savingPeerReq ? "Assigning..." : `Assign ${peerUserIds.length} Peers`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Calibration Adjust Dialog */}
      <Dialog open={!!editingCalib} onOpenChange={(open) => { if (!open) setEditingCalib(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Adjust Calibration Score</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="text-xs">Calibrated Score (0-120)</Label>
              <Input type="number" min="0" max="120" value={editingCalib?.score || ""} onChange={(e) => setEditingCalib((prev) => prev ? { ...prev, score: e.target.value } : null)} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Justification</Label>
              <Textarea placeholder="Reason for adjustment..." value={editingCalib?.notes || ""} onChange={(e) => setEditingCalib((prev) => prev ? { ...prev, notes: e.target.value } : null)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingCalib(null)}>Cancel</Button>
            <Button onClick={handleCalibrationSave} disabled={savingCalib}>
              {savingCalib ? "Saving..." : "Save Adjustment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
