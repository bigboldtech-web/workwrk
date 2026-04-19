"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/dashboard/page-header";
import {
  Lightbulb, Plus, ThumbsUp, MessageSquare, Clock, CheckCircle2, XCircle,
  Award, Send, ChevronRight,
} from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { useRole } from "@/hooks/use-role";
import { useSession } from "next-auth/react";

const CATEGORIES = ["Process Improvement", "Product", "Culture", "Cost Saving", "Technology", "Other"];

const STATUS_STYLES: Record<string, { color: string; label: string }> = {
  SUBMITTED: { color: "bg-blue-500/20 text-blue-400", label: "Submitted" },
  UNDER_REVIEW: { color: "bg-amber-500/20 text-amber-400", label: "Under Review" },
  APPROVED: { color: "bg-green-500/20 text-green-400", label: "Approved" },
  REJECTED: { color: "bg-red-500/20 text-red-400", label: "Rejected" },
  IMPLEMENTED: { color: "bg-[rgba(212,255,46,0.12)] text-[#d4ff2e]", label: "Implemented" },
  REWARDED: { color: "bg-yellow-500/20 text-yellow-400", label: "Rewarded" },
};

interface Idea {
  id: string;
  title: string;
  description: string;
  category: string | null;
  status: string;
  submitter: { id: string; firstName: string; lastName: string; department?: { name: string } };
  reviewer?: { id: string; firstName: string; lastName: string } | null;
  reviewNotes?: string | null;
  rewardType?: string | null;
  rewardValue?: string | null;
  votes: { userId: string }[];
  _count: { votes: number; comments: number };
  createdAt: string;
}

export default function IdeasPage() {
  const { isManager } = useRole();
  const { data: session } = useSession();
  const currentUserId = (session?.user as any)?.id;
  const { success: toastSuccess, error: toastError } = useToast();

  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("all");

  // Submit dialog
  const [showSubmit, setShowSubmit] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Review dialog
  const [reviewIdea, setReviewIdea] = useState<Idea | null>(null);
  const [reviewStatus, setReviewStatus] = useState("");
  const [reviewNotes, setReviewNotes] = useState("");
  const [rewardType, setRewardType] = useState("");
  const [rewardValue, setRewardValue] = useState("");

  // Comment
  const [commentIdeaId, setCommentIdeaId] = useState<string | null>(null);
  const [commentText, setCommentText] = useState("");

  const fetchIdeas = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (tab === "mine") params.set("mine", "true");
      if (tab === "review") params.set("status", "SUBMITTED");
      // roadmap and all: no filter — show everything
      const res = await fetch(`/api/ideas?${params}`);
      if (res.ok) {
        const data = await res.json();
        setIdeas(Array.isArray(data) ? data : data.data || []);
      }
    } catch {} finally { setLoading(false); }
  }, [tab]);

  useEffect(() => { fetchIdeas(); }, [fetchIdeas]);

  async function handleSubmit() {
    if (!title.trim() || !description.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description, category: category || null }),
      });
      if (res.ok) {
        setShowSubmit(false);
        setTitle(""); setDescription(""); setCategory("");
        fetchIdeas();
        toastSuccess("Idea submitted!");
      } else {
        const err = await res.json().catch(() => ({}));
        toastError(err.error || "Failed to submit idea");
      }
    } catch (e) { toastError("Failed to submit idea"); } finally { setSubmitting(false); }
  }

  async function handleVote(ideaId: string) {
    try {
      const res = await fetch(`/api/ideas/${ideaId}/vote`, { method: "POST" });
      if (res.ok) fetchIdeas();
    } catch {}
  }

  async function handleReview() {
    if (!reviewIdea || !reviewStatus) return;
    try {
      const body: any = { status: reviewStatus, reviewNotes };
      if (reviewStatus === "REWARDED") {
        body.rewardType = rewardType;
        body.rewardValue = rewardValue;
      }
      const res = await fetch(`/api/ideas/${reviewIdea.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setReviewIdea(null);
        setReviewStatus(""); setReviewNotes(""); setRewardType(""); setRewardValue("");
        fetchIdeas();
        toastSuccess("Idea updated");
      }
    } catch { toastError("Failed to update idea"); }
  }

  async function handleComment(ideaId: string) {
    if (!commentText.trim()) return;
    try {
      await fetch(`/api/ideas/${ideaId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: commentText }),
      });
      setCommentText("");
      setCommentIdeaId(null);
      toastSuccess("Comment added");
    } catch {}
  }

  const submitted = ideas.filter((i) => i.status === "SUBMITTED").length;
  const approved = ideas.filter((i) => ["APPROVED", "IMPLEMENTED", "REWARDED"].includes(i.status)).length;

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader
        kicker="Ideas · continuous improvement"
        title="Ideas board"
        subtitle={`${ideas.length} ideas · ${submitted} pending · ${approved} approved`}
        actions={[
          { label: "Submit idea", onClick: () => setShowSubmit(true), icon: <Lightbulb size={14} /> },
        ]}
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="all" className="gap-1.5"><Lightbulb size={14} /> All</TabsTrigger>
          <TabsTrigger value="mine" className="gap-1.5"><Send size={14} /> My Ideas</TabsTrigger>
          <TabsTrigger value="roadmap" className="gap-1.5"><Award size={14} /> Roadmap</TabsTrigger>
          {isManager && <TabsTrigger value="review" className="gap-1.5"><Clock size={14} /> Review</TabsTrigger>}
        </TabsList>
      </Tabs>

      {/* Roadmap View */}
      {tab === "roadmap" && !loading && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[
            { status: "SUBMITTED", label: "New Ideas", color: "border-blue-500/30" },
            { status: "UNDER_REVIEW", label: "Under Review", color: "border-amber-500/30" },
            { status: "APPROVED", label: "Approved", color: "border-green-500/30" },
            { status: "IMPLEMENTED", label: "Implemented", color: "border-[rgba(212,255,46,0.3)]" },
          ].map((col) => {
            const colIdeas = ideas.filter((i) => i.status === col.status);
            return (
              <div key={col.status} className={`border-t-2 ${col.color} bg-surface rounded-lg p-3`}>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-semibold uppercase text-muted">{col.label}</h3>
                  <span className="text-[10px] text-muted-2">{colIdeas.length}</span>
                </div>
                <div className="space-y-2">
                  {colIdeas.map((idea) => (
                    <Card key={idea.id} className="hover:border-muted-2 transition-colors">
                      <CardContent className="p-2.5">
                        <p className="text-xs font-medium mb-1">{idea.title}</p>
                        <div className="flex items-center justify-between text-[10px] text-muted">
                          <span>{idea.submitter.firstName}</span>
                          <span className="flex items-center gap-1"><ThumbsUp size={10} /> {idea._count.votes}</span>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                  {colIdeas.length === 0 && <p className="text-[10px] text-muted-2 text-center py-4">No ideas</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Ideas List (not shown on roadmap view) */}
      {tab !== "roadmap" && (loading ? (
        <div className="space-y-3">
          {[1,2,3].map((i) => <Card key={i}><CardContent className="p-4"><div className="h-20 bg-surface-2 rounded animate-pulse" /></CardContent></Card>)}
        </div>
      ) : ideas.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <Lightbulb size={40} className="mx-auto text-muted mb-3" />
            <p className="font-medium mb-1">No ideas yet</p>
            <p className="text-sm text-muted mb-4">Be the first to share an idea to improve the company!</p>
            <Button onClick={() => setShowSubmit(true)} className="gap-1.5"><Plus size={14} /> Submit Idea</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {ideas.map((idea) => {
            const hasVoted = idea.votes.some((v) => v.userId === currentUserId);
            const style = STATUS_STYLES[idea.status] || STATUS_STYLES.SUBMITTED;
            return (
              <Card key={idea.id} className="hover:border-muted-2 transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    {/* Vote */}
                    <button
                      onClick={() => handleVote(idea.id)}
                      className={`flex flex-col items-center gap-0.5 shrink-0 pt-1 ${hasVoted ? "text-[#d4ff2e]" : "text-muted hover:text-[#e2ff6b]"} transition-colors`}
                    >
                      <ThumbsUp size={18} className={hasVoted ? "fill-purple-400" : ""} />
                      <span className="text-xs font-bold">{idea._count.votes}</span>
                    </button>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-sm font-semibold">{idea.title}</h3>
                        <Badge className={`text-[10px] ${style.color}`}>{style.label}</Badge>
                        {idea.category && <Badge variant="outline" className="text-[10px]">{idea.category}</Badge>}
                      </div>
                      <p className="text-xs text-muted line-clamp-2 mb-2">{idea.description}</p>
                      <div className="flex items-center gap-4 text-[10px] text-muted-2">
                        <span>{idea.submitter.firstName} {idea.submitter.lastName}</span>
                        {idea.submitter.department && <span>{idea.submitter.department.name}</span>}
                        <span>{new Date(idea.createdAt).toLocaleDateString()}</span>
                        <button
                          onClick={() => setCommentIdeaId(commentIdeaId === idea.id ? null : idea.id)}
                          className="flex items-center gap-1 hover:text-[#e2ff6b] transition-colors"
                        >
                          <MessageSquare size={11} /> {idea._count.comments}
                        </button>
                      </div>

                      {/* Reward info */}
                      {idea.rewardValue && (
                        <div className="flex items-center gap-1 mt-2 text-xs text-yellow-400">
                          <Award size={12} /> Reward: {idea.rewardValue}
                        </div>
                      )}

                      {/* Inline comment */}
                      {commentIdeaId === idea.id && (
                        <div className="flex items-center gap-2 mt-3">
                          <Input
                            value={commentText}
                            onChange={(e) => setCommentText(e.target.value)}
                            placeholder="Add a comment..."
                            className="text-xs h-8"
                            onKeyDown={(e) => e.key === "Enter" && handleComment(idea.id)}
                          />
                          <Button size="sm" className="h-8 text-xs" onClick={() => handleComment(idea.id)}>Post</Button>
                        </div>
                      )}
                    </div>

                    {/* Manager Review */}
                    {isManager && ["SUBMITTED", "UNDER_REVIEW", "APPROVED", "IMPLEMENTED"].includes(idea.status) && (
                      <Button variant="outline" size="sm" className="text-xs shrink-0" onClick={() => {
                        setReviewIdea(idea);
                        setReviewStatus("");
                        setReviewNotes(idea.reviewNotes || "");
                      }}>
                        Review
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ))}

      {/* Submit Idea Dialog */}
      <Dialog open={showSubmit} onOpenChange={setShowSubmit}>
        <DialogContent>
          <DialogHeader><DialogTitle>Submit an Idea</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Title <span className="text-red-400">*</span></Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short, catchy title for your idea" />
            </div>
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Description <span className="text-red-400">*</span></Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Explain your idea in detail — what problem does it solve? How should it work?" rows={4} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSubmit(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={submitting || !title.trim() || !description.trim()}>
              {submitting ? "Submitting..." : "Submit Idea"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Review Dialog */}
      <Dialog open={!!reviewIdea} onOpenChange={(open) => { if (!open) setReviewIdea(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Review: {reviewIdea?.title}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted">{reviewIdea?.description}</p>
            <div className="space-y-2">
              <Label>Set Status</Label>
              <Select value={reviewStatus} onValueChange={setReviewStatus}>
                <SelectTrigger><SelectValue placeholder="Select new status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="UNDER_REVIEW">Under Review</SelectItem>
                  <SelectItem value="APPROVED">Approve</SelectItem>
                  <SelectItem value="REJECTED">Reject</SelectItem>
                  <SelectItem value="IMPLEMENTED">Mark Implemented</SelectItem>
                  <SelectItem value="REWARDED">Reward</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} placeholder="Feedback for the submitter..." rows={2} />
            </div>
            {reviewStatus === "REWARDED" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Reward Type</Label>
                  <Select value={rewardType} onValueChange={setRewardType}>
                    <SelectTrigger><SelectValue placeholder="Type" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gift_card">Gift Card</SelectItem>
                      <SelectItem value="bonus">Bonus</SelectItem>
                      <SelectItem value="recognition">Recognition</SelectItem>
                      <SelectItem value="extra_leave">Extra Leave</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Reward Value</Label>
                  <Input value={rewardValue} onChange={(e) => setRewardValue(e.target.value)} placeholder="e.g., $50 Amazon" />
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewIdea(null)}>Cancel</Button>
            <Button onClick={handleReview} disabled={!reviewStatus}>Update Status</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
