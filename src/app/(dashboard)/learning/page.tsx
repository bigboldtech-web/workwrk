"use client";

// Learning workspace. Two tabs:
//   My courses  — enrollments for me, with progress slider
//   Catalog     — all courses, can self-enroll on non-mandatory ones
//   Manage      — manager+ only: create / edit courses + bulk enroll

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { useRole } from "@/hooks/use-role";
import { SkeletonCard } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import {
  GraduationCap,
  Plus,
  CheckCircle2,
  Clock,
  BookOpen,
} from "lucide-react";

type Course = {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  duration: number | null;
  mandatory: boolean;
  _count: { enrollments: number };
};

type Enrollment = {
  id: string;
  progress: number;
  score: number | null;
  startedAt: string;
  completedAt: string | null;
  course: { id: string; title: string; mandatory: boolean; duration: number | null; category: string | null };
  user: { id: string; firstName: string; lastName: string } | null;
};

export default function LearningPage() {
  const { isManager } = useRole();
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <GraduationCap size={20} /> Learning
        </h1>
        <p className="text-muted text-sm mt-1">
          Courses, enrollments, and completion tracking.
        </p>
      </div>
      <Tabs defaultValue="mine">
        <TabsList>
          <TabsTrigger value="mine">My courses</TabsTrigger>
          <TabsTrigger value="catalog">Catalog</TabsTrigger>
          {isManager && <TabsTrigger value="manage">Manage</TabsTrigger>}
        </TabsList>
        <TabsContent value="mine" className="mt-4"><MyCoursesTab /></TabsContent>
        <TabsContent value="catalog" className="mt-4"><CatalogTab /></TabsContent>
        {isManager && <TabsContent value="manage" className="mt-4"><ManageTab /></TabsContent>}
      </Tabs>
    </div>
  );
}

// ─── My courses ────────────────────────────────────────────────────

function MyCoursesTab() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/enrollments?scope=mine&limit=100");
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function setProgress(id: string, progress: number) {
    const res = await fetch(`/api/enrollments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ progress }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast({ type: "error", title: "Couldn't update", description: data?.error });
      return;
    }
    if (progress >= 100) toast({ type: "success", title: "Course completed!" });
    load();
  }

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {[1, 2, 3].map((i) => <SkeletonCard key={i} />)}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={GraduationCap}
        title="No courses enrolled yet"
        description="Browse the Catalog tab to find a course and enroll yourself — manager-assigned courses will show up here automatically."
      />
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {rows.map((e) => (
        <Card key={e.id}>
          <CardContent className="p-4 space-y-3">
            <div>
              <div className="flex items-center gap-2">
                <p className="font-medium text-sm flex-1">{e.course.title}</p>
                {e.completedAt && <CheckCircle2 size={14} className="text-green-400 flex-shrink-0" />}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted mt-1">
                {e.course.mandatory && (
                  <Badge variant="outline" className="text-[10px] text-orange-400 border-orange-400/30">Mandatory</Badge>
                )}
                {e.course.category && <span>{e.course.category}</span>}
                {e.course.duration && (
                  <span className="flex items-center gap-1"><Clock size={9} /> {e.course.duration} min</span>
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted">Progress</span>
                <span className="font-mono">{e.progress}%</span>
              </div>
              <Progress value={e.progress} className="h-1.5" />
            </div>
            {!e.completedAt ? (
              <div className="flex items-center gap-1.5 flex-wrap">
                {[25, 50, 75, 100].map((p) => (
                  <Button
                    key={p}
                    size="sm"
                    variant={e.progress >= p ? "outline" : "outline"}
                    className="h-7 text-xs flex-1"
                    disabled={e.progress >= p}
                    onClick={() => setProgress(e.id, p)}
                  >
                    {p === 100 ? "Done" : `${p}%`}
                  </Button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted">
                Completed {new Date(e.completedAt).toLocaleDateString()}
                {e.score !== null && ` · score ${e.score}%`}
              </p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Catalog ───────────────────────────────────────────────────────

function CatalogTab() {
  const { toast } = useToast();
  const [courses, setCourses] = useState<Course[]>([]);
  const [enrolledIds, setEnrolledIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [coursesRes, enrollmentsRes] = await Promise.all([
        fetch(`/api/courses${search ? `?q=${encodeURIComponent(search)}` : ""}`),
        fetch("/api/enrollments?scope=mine&limit=200"),
      ]);
      const coursesData = await coursesRes.json();
      const enrollmentsData = await enrollmentsRes.json();
      setCourses(Array.isArray(coursesData) ? coursesData : []);
      const ids = new Set(
        (Array.isArray(enrollmentsData) ? enrollmentsData : [])
          .map((e: Enrollment) => e.course.id),
      );
      setEnrolledIds(ids);
    } finally { setLoading(false); }
  }, [search]);

  useEffect(() => { load(); }, [load]);

  async function enroll(courseId: string) {
    const res = await fetch("/api/enrollments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast({ type: "error", title: "Couldn't enroll", description: data?.error });
      return;
    }
    toast({ type: "success", title: "Enrolled" });
    load();
  }

  return (
    <>
      <div className="mb-3">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search courses…"
          className="max-w-sm"
        />
      </div>
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => <SkeletonCard key={i} />)}
        </div>
      ) : courses.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title={search ? "No matching courses" : "No courses yet"}
          description={search ? "Try a different search term." : "Once your team publishes courses, they'll appear here for self-enrollment."}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {courses.map((c) => (
            <Card key={c.id}>
              <CardContent className="p-4 space-y-3">
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium text-sm">{c.title}</p>
                    {c.mandatory && (
                      <Badge variant="outline" className="text-[10px] text-orange-400 border-orange-400/30 flex-shrink-0">
                        Mandatory
                      </Badge>
                    )}
                  </div>
                  {c.description && <p className="text-xs text-muted mt-1 line-clamp-2">{c.description}</p>}
                  <div className="flex items-center gap-2 text-[10px] text-muted mt-2">
                    {c.category && <span>{c.category}</span>}
                    {c.duration && (
                      <span className="flex items-center gap-1"><Clock size={9} /> {c.duration} min</span>
                    )}
                    <span className="ml-auto">{c._count.enrollments} enrolled</span>
                  </div>
                </div>
                {enrolledIds.has(c.id) ? (
                  <Button size="sm" variant="outline" disabled className="w-full h-7 text-xs">
                    <CheckCircle2 size={11} className="mr-1.5" /> Enrolled
                  </Button>
                ) : (
                  <Button size="sm" className="w-full h-7 text-xs" onClick={() => enroll(c.id)}>
                    Enroll
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

// ─── Manage (admin) ────────────────────────────────────────────────

function ManageTab() {
  const { toast } = useToast();
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/courses");
      const data = await res.json();
      setCourses(Array.isArray(data) ? data : []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function deleteCourse(id: string, title: string) {
    if (!confirm(`Delete "${title}"? This will fail if anyone is enrolled.`)) return;
    const res = await fetch(`/api/courses/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast({ type: "error", title: "Couldn't delete", description: data?.error });
      return;
    }
    toast({ type: "success", title: "Deleted" });
    load();
  }

  return (
    <>
      <div className="flex justify-end mb-3">
        <Button onClick={() => setCreating(true)}>
          <Plus size={14} className="mr-1.5" /> New course
        </Button>
      </div>
      {loading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <SkeletonCard key={i} />)}</div>
      ) : courses.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="No courses yet"
          description="Create a course to enroll your team — set it as mandatory and it'll surface in every employee's Inbox until completed."
          actionLabel="New course"
          onAction={() => setCreating(true)}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-white/5">
                  <th className="px-4 py-2.5 font-normal">Title</th>
                  <th className="px-4 py-2.5 font-normal">Category</th>
                  <th className="px-4 py-2.5 font-normal text-right">Duration</th>
                  <th className="px-4 py-2.5 font-normal">Mandatory</th>
                  <th className="px-4 py-2.5 font-normal text-right">Enrolled</th>
                  <th className="px-4 py-2.5 font-normal text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {courses.map((c) => (
                  <tr key={c.id} className="border-b border-white/5 hover:bg-surface-2">
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{c.title}</div>
                      {c.description && <div className="text-[10px] text-muted line-clamp-1">{c.description}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted">{c.category ?? "—"}</td>
                    <td className="px-4 py-2.5 text-xs font-mono text-right">{c.duration ? `${c.duration} min` : "—"}</td>
                    <td className="px-4 py-2.5">
                      {c.mandatory ? (
                        <Badge variant="outline" className="text-[10px] text-orange-400 border-orange-400/30">Yes</Badge>
                      ) : (
                        <span className="text-xs text-muted">No</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs font-mono text-right">{c._count.enrollments}</td>
                    <td className="px-4 py-2.5 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs text-red-400"
                        onClick={() => deleteCourse(c.id, c.title)}
                      >
                        Delete
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
      {creating && (
        <CreateCourseDialog onClose={() => setCreating(false)} onCreated={() => { setCreating(false); load(); }} />
      )}
    </>
  );
}

function CreateCourseDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [duration, setDuration] = useState("");
  const [mandatory, setMandatory] = useState(false);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/courses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          category: category.trim() || undefined,
          duration: duration ? Number(duration) : undefined,
          mandatory,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ type: "error", title: "Couldn't create", description: data?.error });
        return;
      }
      toast({ type: "success", title: "Course created" });
      onCreated();
    } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New course</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-1">
          <div className="space-y-1.5"><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Category</Label><Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Compliance" /></div>
            <div className="space-y-1.5"><Label>Duration (min)</Label><Input value={duration} onChange={(e) => setDuration(e.target.value)} inputMode="numeric" /></div>
          </div>
          <div className="space-y-1.5"><Label>Description</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} /></div>
          <div className="flex items-center gap-2 text-sm">
            <input id="mandatory" type="checkbox" checked={mandatory} onChange={(e) => setMandatory(e.target.checked)} />
            <label htmlFor="mandatory">Mandatory — surface in every employee's Inbox until completed</label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button disabled={!title.trim() || saving} onClick={save}>{saving ? "Creating…" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
