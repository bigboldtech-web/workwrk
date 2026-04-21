"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/dashboard/page-header";
import {
  Lightbulb, Plus, ThumbsUp, MessageSquare, Clock, CheckCircle2, XCircle,
  Award, Send, ChevronRight, Trash2, MessageCircle, Gavel,
} from "lucide-react";
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem,
  ContextMenuSeparator, ContextMenuLabel, ContextMenuSub, ContextMenuSubTrigger,
  ContextMenuSubContent,
} from "@/components/ui/context-menu";
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

interface IdeaComment {
  id: string;
  content: string;
  createdAt: string;
  user: { id: string; firstName: string; lastName: string; avatar?: string | null };
}

interface Idea {
  id: string;
  title: string;
  description: string;
  category: string | null;
  status: string;
  submitter: { id: string; firstName: string; lastName: string; avatar?: string | null; department?: { name: string } };
  reviewer?: { id: string; firstName: string; lastName: string } | null;
  reviewNotes?: string | null;
  rewardType?: string | null;
  rewardValue?: string | null;
  votes: { userId: string }[];
  _count: { votes: number; comments: number };
  createdAt: string;
}

function initials(firstName?: string, lastName?: string) {
  return `${firstName?.[0] || ""}${lastName?.[0] || ""}`.toUpperCase() || "?";
}

export default function IdeasPage() {
  const { isManager, isAdmin } = useRole();
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
  const [reviewing, setReviewing] = useState(false);

  // Delete confirmation
  const [deleteIdea, setDeleteIdea] = useState<Idea | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Comments
  const [commentIdeaId, setCommentIdeaId] = useState<string | null>(null);
  const [commentText, setCommentText] = useState("");
  const [commentsByIdea, setCommentsByIdea] = useState<Record<string, IdeaComment[]>>({});
  const [loadingComments, setLoadingComments] = useState<string | null>(null);

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
    setReviewing(true);
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
        await fetchIdeas();
        toastSuccess("Idea updated");
      } else {
        const err = await res.json().catch(() => ({}));
        toastError(err.error || "Failed to update idea");
      }
    } catch { toastError("Failed to update idea"); } finally { setReviewing(false); }
  }

  async function handleDelete() {
    if (!deleteIdea) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/ideas/${deleteIdea.id}`, { method: "DELETE" });
      if (res.ok) {
        setDeleteIdea(null);
        await fetchIdeas();
        toastSuccess("Idea deleted");
      } else {
        const err = await res.json().catch(() => ({}));
        toastError(err.error || "Failed to delete idea");
      }
    } catch { toastError("Failed to delete idea"); } finally { setDeleting(false); }
  }

  async function loadComments(ideaId: string) {
    setLoadingComments(ideaId);
    try {
      const res = await fetch(`/api/ideas/${ideaId}`);
      if (res.ok) {
        const data = await res.json();
        const idea = data?.data || data;
        setCommentsByIdea((prev) => ({ ...prev, [ideaId]: idea?.comments || [] }));
      }
    } catch {} finally { setLoadingComments(null); }
  }

  function toggleComments(ideaId: string) {
    if (commentIdeaId === ideaId) {
      setCommentIdeaId(null);
      setCommentText("");
    } else {
      setCommentIdeaId(ideaId);
      setCommentText("");
      if (!commentsByIdea[ideaId]) loadComments(ideaId);
    }
  }

  async function handleComment(ideaId: string) {
    if (!commentText.trim()) return;
    try {
      const res = await fetch(`/api/ideas/${ideaId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: commentText }),
      });
      if (res.ok) {
        const data = await res.json();
        const newComment: IdeaComment = data?.data || data;
        setCommentsByIdea((prev) => ({
          ...prev,
          [ideaId]: [...(prev[ideaId] || []), newComment],
        }));
        setIdeas((prev) => prev.map((i) =>
          i.id === ideaId ? { ...i, _count: { ...i._count, comments: i._count.comments + 1 } } : i
        ));
        setCommentText("");
        toastSuccess("Comment added");
      } else {
        const err = await res.json().catch(() => ({}));
        toastError(err.error || "Failed to add comment");
      }
    } catch { toastError("Failed to add comment"); }
  }

  function canDelete(idea: Idea): boolean {
    if (isAdmin) return true;
    return idea.submitter.id === currentUserId && idea.status === "SUBMITTED";
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
            const openReview = () => {
              setReviewIdea(idea);
              setReviewStatus("");
              setReviewNotes(idea.reviewNotes || "");
              setRewardType(idea.rewardType || "");
              setRewardValue(idea.rewardValue || "");
            };
            const quickReview = (status: string) => {
              setReviewIdea(idea);
              setReviewStatus(status);
              setReviewNotes(idea.reviewNotes || "");
              setRewardType(idea.rewardType || "");
              setRewardValue(idea.rewardValue || "");
            };
            return (
              <ContextMenu key={idea.id}>
                <ContextMenuTrigger asChild>
              <Card className="hover:border-muted-2 transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    {/* Vote */}
                    <button
                      onClick={() => handleVote(idea.id)}
                      className={`flex flex-col items-center gap-0.5 shrink-0 pt-1 ${hasVoted ? "text-[#d4ff2e]" : "text-muted hover:text-[#e2ff6b]"} transition-colors`}
                      aria-label={hasVoted ? "Remove vote" : "Upvote"}
                    >
                      <ThumbsUp size={18} className={hasVoted ? "fill-[#d4ff2e] text-[#d4ff2e]" : ""} />
                      <span className="text-xs font-bold">{idea._count.votes}</span>
                    </button>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      {/* Author header */}
                      <div className="flex items-center gap-2 mb-2">
                        <Avatar className="h-7 w-7">
                          {idea.submitter.avatar && <AvatarImage src={idea.submitter.avatar} alt="" />}
                          <AvatarFallback className="text-[10px]">
                            {initials(idea.submitter.firstName, idea.submitter.lastName)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="text-xs font-medium truncate">
                            {idea.submitter.firstName} {idea.submitter.lastName}
                          </p>
                          <p className="text-[10px] text-muted-2 truncate">
                            {idea.submitter.department?.name
                              ? `${idea.submitter.department.name} · `
                              : ""}
                            {new Date(idea.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h3 className="text-sm font-semibold">{idea.title}</h3>
                        <Badge className={`text-[10px] ${style.color}`}>{style.label}</Badge>
                        {idea.category && <Badge variant="outline" className="text-[10px]">{idea.category}</Badge>}
                      </div>
                      <p className="text-xs text-muted line-clamp-2 mb-2">{idea.description}</p>

                      {idea.reviewer && idea.reviewNotes && (
                        <div className="mt-2 rounded border border-[rgba(255,255,255,0.08)] bg-surface-2 p-2 text-[11px]">
                          <p className="text-muted-2 mb-0.5">
                            Review by {idea.reviewer.firstName} {idea.reviewer.lastName}
                          </p>
                          <p className="text-muted">{idea.reviewNotes}</p>
                        </div>
                      )}

                      {/* Reward info */}
                      {idea.rewardValue && (
                        <div className="flex items-center gap-1 mt-2 text-xs text-yellow-400">
                          <Award size={12} /> Reward: {idea.rewardValue}
                        </div>
                      )}

                      <div className="flex items-center gap-4 text-[10px] text-muted-2 mt-2">
                        <button
                          onClick={() => toggleComments(idea.id)}
                          className="flex items-center gap-1 hover:text-[#e2ff6b] transition-colors"
                        >
                          <MessageSquare size={11} />
                          {idea._count.comments} {idea._count.comments === 1 ? "comment" : "comments"}
                        </button>
                      </div>

                      {/* Inline comments */}
                      {commentIdeaId === idea.id && (
                        <div className="mt-3 space-y-2 border-t border-[rgba(255,255,255,0.06)] pt-3">
                          {loadingComments === idea.id && !commentsByIdea[idea.id] ? (
                            <p className="text-[11px] text-muted-2">Loading comments...</p>
                          ) : (commentsByIdea[idea.id] || []).length === 0 ? (
                            <p className="text-[11px] text-muted-2">No comments yet. Be the first to reply.</p>
                          ) : (
                            <div className="space-y-2">
                              {(commentsByIdea[idea.id] || []).map((c) => (
                                <div key={c.id} className="flex items-start gap-2">
                                  <Avatar className="h-6 w-6">
                                    {c.user.avatar && <AvatarImage src={c.user.avatar} alt="" />}
                                    <AvatarFallback className="text-[9px]">
                                      {initials(c.user.firstName, c.user.lastName)}
                                    </AvatarFallback>
                                  </Avatar>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-[11px]">
                                      <span className="font-medium">{c.user.firstName} {c.user.lastName}</span>
                                      <span className="text-muted-2 ml-2">
                                        {new Date(c.createdAt).toLocaleDateString()}
                                      </span>
                                    </p>
                                    <p className="text-xs text-muted whitespace-pre-wrap break-words">{c.content}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="flex items-center gap-2 pt-1">
                            <Input
                              value={commentText}
                              onChange={(e) => setCommentText(e.target.value)}
                              placeholder="Add a comment..."
                              className="text-xs h-8"
                              onKeyDown={(e) => e.key === "Enter" && handleComment(idea.id)}
                            />
                            <Button size="sm" className="h-8 text-xs" onClick={() => handleComment(idea.id)} disabled={!commentText.trim()}>
                              Post
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-2 shrink-0">
                      {isManager && ["SUBMITTED", "UNDER_REVIEW", "APPROVED", "IMPLEMENTED"].includes(idea.status) && (
                        <Button variant="outline" size="sm" className="text-xs" onClick={openReview}>
                          Review
                        </Button>
                      )}
                      {canDelete(idea) && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-xs text-red-400 hover:text-red-300 hover:border-red-500/40"
                          onClick={() => setDeleteIdea(idea)}
                          aria-label="Delete idea"
                        >
                          <Trash2 size={12} />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuLabel>Idea</ContextMenuLabel>
                  <ContextMenuItem onSelect={() => handleVote(idea.id)}>
                    <ThumbsUp size={14} /> {hasVoted ? "Remove upvote" : "Upvote"}
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => toggleComments(idea.id)}>
                    <MessageCircle size={14} /> {commentIdeaId === idea.id ? "Hide comments" : "Show comments"}
                  </ContextMenuItem>
                  {isManager && ["SUBMITTED", "UNDER_REVIEW", "APPROVED", "IMPLEMENTED"].includes(idea.status) && (
                    <>
                      <ContextMenuSeparator />
                      <ContextMenuSub>
                        <ContextMenuSubTrigger>
                          <Gavel size={14} /> Set status
                        </ContextMenuSubTrigger>
                        <ContextMenuSubContent>
                          <ContextMenuItem onSelect={() => quickReview("UNDER_REVIEW")}>Under review</ContextMenuItem>
                          <ContextMenuItem onSelect={() => quickReview("APPROVED")}>Approve</ContextMenuItem>
                          <ContextMenuItem onSelect={() => quickReview("REJECTED")}>Reject</ContextMenuItem>
                          <ContextMenuItem onSelect={() => quickReview("IMPLEMENTED")}>Mark implemented</ContextMenuItem>
                          <ContextMenuItem onSelect={() => quickReview("REWARDED")}>Reward</ContextMenuItem>
                        </ContextMenuSubContent>
                      </ContextMenuSub>
                      <ContextMenuItem onSelect={openReview}>
                        <Gavel size={14} /> Review with notes...
                      </ContextMenuItem>
                    </>
                  )}
                  {canDelete(idea) && (
                    <>
                      <ContextMenuSeparator />
                      <ContextMenuItem destructive onSelect={() => setDeleteIdea(idea)}>
                        <Trash2 size={14} /> Delete idea
                      </ContextMenuItem>
                    </>
                  )}
                </ContextMenuContent>
              </ContextMenu>
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
            <Button variant="outline" onClick={() => setReviewIdea(null)} disabled={reviewing}>Cancel</Button>
            <Button onClick={handleReview} disabled={!reviewStatus || reviewing}>
              {reviewing ? "Updating..." : "Update Status"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteIdea} onOpenChange={(open) => { if (!open) setDeleteIdea(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete idea?</DialogTitle>
            <DialogDescription>
              This will permanently remove &ldquo;{deleteIdea?.title}&rdquo;, including all votes and comments. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteIdea(null)} disabled={deleting}>Cancel</Button>
            <Button
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30"
            >
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
