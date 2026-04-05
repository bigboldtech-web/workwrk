"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  MessageSquare, Plus, Calendar, Clock, Users, Video,
  CheckSquare, ArrowRight, FileText,
} from "lucide-react";
import Link from "next/link";
import { PaginationControls } from "@/components/ui/pagination-controls";
import { useToast } from "@/components/ui/toast";
import { EmptyState } from "@/components/ui/empty-state";

interface Attendee {
  user: { firstName: string; lastName: string };
  attended: boolean;
}

interface Meeting {
  id: string;
  title: string;
  type: string;
  scheduledAt: string;
  duration: number;
  agenda: string | null;
  notes: string | null;
  attendees: Attendee[];
  stats?: {
    hasNotes: boolean;
    decisionCount: number;
    actionItemsTotal: number;
    actionItemsDone: number;
  };
}

interface CheckIn {
  id: string;
  mood: number;
  wentWell: string;
  challenges: string;
  tomorrow: string;
  createdAt: string;
  user: { firstName: string; lastName: string; avatar: string | null };
}

interface UserOption {
  id: string;
  firstName: string;
  lastName: string;
}

function getMeetingTypeColor(type: string) {
  switch (type) {
    case "DAILY_STANDUP": return "bg-blue-500/20 text-blue-400";
    case "WEEKLY_REVIEW": return "bg-purple-500/20 text-purple-400";
    case "ONE_ON_ONE": return "bg-green-500/20 text-green-400";
    case "QUARTERLY_REVIEW": return "bg-orange-500/20 text-orange-400";
    default: return "bg-slate-500/20 text-slate-400";
  }
}

function getMoodEmoji(mood: number) {
  const emojis = ["", "\u{1F61F}", "\u{1F610}", "\u{1F642}", "\u{1F60A}", "\u{1F929}"];
  return emojis[mood] || "\u{1F642}";
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  return d.toLocaleDateString("en-IN", { month: "short", day: "numeric" });
}

function formatCheckInDate(dateStr: string) {
  const d = new Date(dateStr);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Today";
  return d.toLocaleDateString("en-IN", { month: "short", day: "numeric" });
}

function getInitials(firstName: string, lastName: string) {
  return `${firstName?.[0] || ""}${lastName?.[0] || ""}`.toUpperCase();
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3 mt-4">
      {[1, 2, 3, 4].map((i) => (
        <Card key={i}>
          <CardContent className="p-4">
            <div className="flex items-center gap-4 animate-pulse">
              <div className="min-w-[60px] space-y-1">
                <div className="h-3 w-10 bg-border rounded mx-auto" />
                <div className="h-4 w-14 bg-border rounded mx-auto" />
              </div>
              <div className="h-10 w-px bg-border" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-48 bg-border rounded" />
                <div className="h-3 w-32 bg-border rounded" />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function MeetingsPage() {
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showCheckInDialog, setShowCheckInDialog] = useState(false);
  const { success: toastSuccess, error: toastError } = useToast();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [checkIns, setCheckIns] = useState<CheckIn[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Pagination
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  // Meeting form state
  const [meetingTitle, setMeetingTitle] = useState("");
  const [meetingType, setMeetingType] = useState("");
  const [meetingDateTime, setMeetingDateTime] = useState("");
  const [meetingDuration, setMeetingDuration] = useState(30);
  const [meetingAgenda, setMeetingAgenda] = useState("");
  const [meetingAttendeeIds, setMeetingAttendeeIds] = useState<string[]>([]);

  // Check-in form state
  const [checkInMood, setCheckInMood] = useState(3);
  const [checkInWentWell, setCheckInWentWell] = useState("");
  const [checkInChallenges, setCheckInChallenges] = useState("");
  const [checkInTomorrow, setCheckInTomorrow] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      const [meetingsRes, checkInsRes, usersRes] = await Promise.all([
        fetch(`/api/meetings?${params}`),
        fetch("/api/check-ins"),
        fetch("/api/users?limit=100"),
      ]);
      const [meetingsData, checkInsData, usersData] = await Promise.all([
        meetingsRes.json(),
        checkInsRes.json(),
        usersRes.json(),
      ]);
      const mData = meetingsData?.data || meetingsData;
      setMeetings(Array.isArray(mData) ? mData : []);
      setTotal(meetingsData?.pagination?.total || 0);
      setTotalPages(meetingsData?.pagination?.totalPages || 0);
      setCheckIns(Array.isArray(checkInsData) ? checkInsData : []);
      const uData = usersData?.data || usersData;
      setUsers(Array.isArray(uData) ? uData : []);
    } catch (err) {
      console.error("Failed to fetch meetings data:", err);
    } finally {
      setLoading(false);
    }
  }, [page, limit]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const now = new Date();
  const upcomingMeetings = meetings.filter((m) => new Date(m.scheduledAt) > now);
  const pastMeetings = meetings.filter((m) => new Date(m.scheduledAt) <= now);

  const resetMeetingForm = () => {
    setMeetingTitle("");
    setMeetingType("");
    setMeetingDateTime("");
    setMeetingDuration(30);
    setMeetingAgenda("");
    setMeetingAttendeeIds([]);
  };

  const handleScheduleMeeting = async () => {
    if (!meetingTitle || !meetingType || !meetingDateTime) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: meetingTitle,
          type: meetingType,
          scheduledAt: new Date(meetingDateTime).toISOString(),
          duration: meetingDuration,
          agenda: meetingAgenda || null,
          attendeeIds: meetingAttendeeIds,
        }),
      });
      if (res.ok) {
        setShowAddDialog(false);
        resetMeetingForm();
        await fetchData();
        toastSuccess("Meeting scheduled");
      }
    } catch (err) {
      toastError("Failed to schedule meeting");
    } finally {
      setSubmitting(false);
    }
  };

  const handleNewCheckIn = async () => {
    if (!checkInWentWell) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/check-ins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mood: checkInMood,
          wentWell: checkInWentWell,
          challenges: checkInChallenges,
          tomorrow: checkInTomorrow,
        }),
      });
      if (res.ok) {
        setShowCheckInDialog(false);
        setCheckInMood(3);
        setCheckInWentWell("");
        setCheckInChallenges("");
        setCheckInTomorrow("");
        await fetchData();
        toastSuccess("Check-in submitted");
      }
    } catch (err) {
      toastError("Failed to submit check-in");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleAttendee = (userId: string) => {
    setMeetingAttendeeIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold tracking-tight">Meetings & Check-ins</h1>
          <p className="text-muted text-sm mt-1">Structured meeting cadences and daily check-ins</p>
        </div>
        <Dialog open={showAddDialog} onOpenChange={(open) => { setShowAddDialog(open); if (!open) resetMeetingForm(); }}>
          <DialogTrigger asChild>
            <Button className="gap-2"><Plus size={16} /> Schedule Meeting</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Schedule Meeting</DialogTitle></DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Title <span className="text-red-400">*</span></Label>
                <Input placeholder="Meeting title" value={meetingTitle} onChange={(e) => setMeetingTitle(e.target.value)} />
              </div>
              <div className="space-y-2"><Label>Type <span className="text-red-400">*</span></Label>
                <Select value={meetingType} onValueChange={setMeetingType}>
                  <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DAILY_STANDUP">Daily Standup</SelectItem>
                    <SelectItem value="WEEKLY_REVIEW">Weekly Review</SelectItem>
                    <SelectItem value="ONE_ON_ONE">1:1</SelectItem>
                    <SelectItem value="QUARTERLY_REVIEW">Quarterly Review</SelectItem>
                    <SelectItem value="ADHOC">Ad-hoc</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Date & Time</Label>
                  <Input type="datetime-local" value={meetingDateTime} onChange={(e) => setMeetingDateTime(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Duration (min)</Label>
                  <Input type="number" value={meetingDuration} onChange={(e) => setMeetingDuration(Number(e.target.value))} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Agenda</Label>
                <Textarea placeholder="Meeting agenda..." value={meetingAgenda} onChange={(e) => setMeetingAgenda(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Attendees</Label>
                <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto p-2 border border-border rounded-md">
                  {users.map((user) => (
                    <Badge
                      key={user.id}
                      variant={meetingAttendeeIds.includes(user.id) ? "default" : "secondary"}
                      className="cursor-pointer select-none"
                      onClick={() => toggleAttendee(user.id)}
                    >
                      {user.firstName} {user.lastName}
                    </Badge>
                  ))}
                  {users.length === 0 && <span className="text-xs text-muted">No users available</span>}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setShowAddDialog(false); resetMeetingForm(); }}>Cancel</Button>
              <Button onClick={handleScheduleMeeting} disabled={submitting || !meetingTitle || !meetingType || !meetingDateTime}>
                {submitting ? "Scheduling..." : "Schedule"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="upcoming">
        <TabsList>
          <TabsTrigger value="upcoming" className="gap-2"><Calendar size={14} /> Upcoming</TabsTrigger>
          <TabsTrigger value="past" className="gap-2"><Clock size={14} /> Past</TabsTrigger>
          <TabsTrigger value="checkins" className="gap-2"><MessageSquare size={14} /> Check-ins</TabsTrigger>
        </TabsList>

        <TabsContent value="upcoming" className="space-y-3 mt-4">
          {loading ? <LoadingSkeleton /> : upcomingMeetings.length === 0 ? (
            <EmptyState
              icon={Calendar}
              title="No upcoming meetings"
              description="Schedule a meeting to keep your team aligned."
              actionLabel="Schedule Meeting"
              onAction={() => setShowAddDialog(true)}
            />
          ) : upcomingMeetings.map((meeting) => (
            <Link key={meeting.id} href={`/meetings/${meeting.id}`}>
              <Card className="hover:border-muted-2 transition-all cursor-pointer">
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    <div className="text-center min-w-[60px]">
                      <p className="text-xs text-muted">{formatDate(meeting.scheduledAt)}</p>
                      <p className="text-sm font-bold font-mono">{formatTime(meeting.scheduledAt)}</p>
                    </div>
                    <div className="h-10 w-px bg-border" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-medium">{meeting.title}</h3>
                        <Badge className={`text-[10px] ${getMeetingTypeColor(meeting.type)}`}>
                          {meeting.type.replace(/_/g, " ")}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted">
                        <span className="flex items-center gap-1"><Clock size={10} /> {meeting.duration} min</span>
                        <div className="flex items-center gap-1">
                          <Users size={10} />
                          <div className="flex -space-x-1.5">
                            {meeting.attendees.slice(0, 4).map((a, i) => (
                              <Avatar key={i} className="h-5 w-5 border border-surface">
                                <AvatarFallback className="text-[8px]">{getInitials(a.user.firstName, a.user.lastName)}</AvatarFallback>
                              </Avatar>
                            ))}
                            {meeting.attendees.length > 4 && <span className="ml-1">+{meeting.attendees.length - 4}</span>}
                          </div>
                        </div>
                      </div>
                    </div>
                    <Button variant="outline" size="sm" onClick={(e) => e.preventDefault()}>Join</Button>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </TabsContent>

        <TabsContent value="past" className="space-y-3 mt-4">
          {loading ? <LoadingSkeleton /> : pastMeetings.length === 0 ? (
            <EmptyState
              icon={Clock}
              title="No past meetings"
              description="Past meetings and their notes will appear here."
            />
          ) : pastMeetings.map((meeting) => (
            <Link key={meeting.id} href={`/meetings/${meeting.id}`}>
              <Card className="hover:border-muted-2 transition-all cursor-pointer">
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    <div className="text-center min-w-[60px]">
                      <p className="text-xs text-muted">{formatDate(meeting.scheduledAt)}</p>
                      <p className="text-sm font-mono text-muted">{formatTime(meeting.scheduledAt)}</p>
                    </div>
                    <div className="h-10 w-px bg-border" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-medium">{meeting.title}</h3>
                        <Badge className={`text-[10px] ${getMeetingTypeColor(meeting.type)}`}>
                          {meeting.type.replace(/_/g, " ")}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted">
                        <div className="flex items-center gap-1">
                          <Users size={10} />
                          <div className="flex -space-x-1.5">
                            {meeting.attendees.slice(0, 4).map((a, i) => (
                              <Avatar key={i} className="h-5 w-5 border border-surface">
                                <AvatarFallback className="text-[8px]">{getInitials(a.user.firstName, a.user.lastName)}</AvatarFallback>
                              </Avatar>
                            ))}
                            {meeting.attendees.length > 4 && <span className="ml-1">+{meeting.attendees.length - 4}</span>}
                          </div>
                        </div>
                        {meeting.stats && (
                          <>
                            {meeting.stats.hasNotes && <span className="flex items-center gap-1"><FileText size={10} /> notes</span>}
                            {meeting.stats.decisionCount > 0 && <span className="flex items-center gap-1"><MessageSquare size={10} /> {meeting.stats.decisionCount} decisions</span>}
                            {meeting.stats.actionItemsTotal > 0 && (
                              <span className="flex items-center gap-1">
                                <CheckSquare size={10} /> {meeting.stats.actionItemsDone}/{meeting.stats.actionItemsTotal} actions
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </TabsContent>

        <TabsContent value="checkins" className="space-y-3 mt-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-muted">Recent check-ins</p>
            <Dialog open={showCheckInDialog} onOpenChange={setShowCheckInDialog}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-2"><Plus size={14} /> New Check-in</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Daily Check-in</DialogTitle></DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>Mood (1-5)</Label>
                    <div className="flex gap-2">
                      {[1, 2, 3, 4, 5].map((m) => (
                        <Button
                          key={m}
                          variant={checkInMood === m ? "default" : "outline"}
                          size="sm"
                          className="text-lg"
                          onClick={() => setCheckInMood(m)}
                        >
                          {getMoodEmoji(m)}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>What went well?</Label>
                    <Textarea placeholder="Wins and accomplishments..." value={checkInWentWell} onChange={(e) => setCheckInWentWell(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Challenges</Label>
                    <Textarea placeholder="Blockers or difficulties..." value={checkInChallenges} onChange={(e) => setCheckInChallenges(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Plan for tomorrow</Label>
                    <Textarea placeholder="What you'll focus on next..." value={checkInTomorrow} onChange={(e) => setCheckInTomorrow(e.target.value)} />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowCheckInDialog(false)}>Cancel</Button>
                  <Button onClick={handleNewCheckIn} disabled={submitting || !checkInWentWell}>
                    {submitting ? "Submitting..." : "Submit Check-in"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          {loading ? <LoadingSkeleton /> : checkIns.length === 0 ? (
            <EmptyState
              icon={MessageSquare}
              title="No check-ins yet"
              description="Start your daily check-in to track your team's pulse."
              actionLabel="New Check-in"
              onAction={() => setShowCheckInDialog(true)}
            />
          ) : checkIns.map((checkin) => (
            <Card key={checkin.id} className="hover:border-muted-2 transition-colors">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <span className="text-2xl">{getMoodEmoji(checkin.mood)}</span>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{checkin.user.firstName} {checkin.user.lastName}</p>
                    <div className="mt-2 space-y-1 text-xs">
                      <p><span className="text-green-400">What went well:</span> <span className="text-muted">{checkin.wentWell}</span></p>
                      <p><span className="text-orange-400">Challenges:</span> <span className="text-muted">{checkin.challenges}</span></p>
                      {checkin.tomorrow && (
                        <p><span className="text-blue-400">Tomorrow:</span> <span className="text-muted">{checkin.tomorrow}</span></p>
                      )}
                    </div>
                  </div>
                  <span className="text-[10px] text-muted">{formatCheckInDate(checkin.createdAt)}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>

      {/* Pagination */}
      {!loading && (
        <PaginationControls
          page={page}
          totalPages={totalPages}
          total={total}
          limit={limit}
          onPageChange={setPage}
          onLimitChange={(l) => { setLimit(l); setPage(1); }}
        />
      )}
    </div>
  );
}
