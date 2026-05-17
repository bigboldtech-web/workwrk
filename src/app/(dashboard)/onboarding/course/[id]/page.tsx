"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft, Save, Play, Users, Clock, BookOpen, Plus, CheckCircle2,
} from "lucide-react";
import { useToast } from "@/components/ui/toast";

export default function CourseDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [course, setCourse] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [videoUrl, setVideoUrl] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const { success: toastSuccess, error: toastError } = useToast();

  useEffect(() => {
    fetch(`/api/training/${id}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        const c = d?.data || d;
        if (c) {
          setCourse(c);
          const ct = c.content || {};
          setVideoUrl(ct.videoUrl || "");
          setContent(ct.description || "");
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/training/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: { videoUrl, description: content },
        }),
      });
      if (res.ok) {
        setEditing(false);
        toastSuccess("Course updated");
      }
    } catch { toastError("Failed to save"); } finally { setSaving(false); }
  }

  // Convert YouTube/Vimeo URLs to embed format
  function getEmbedUrl(url: string): string | null {
    if (!url) return null;
    // YouTube
    const ytMatch = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]+)/);
    if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}`;
    // Vimeo
    const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
    if (vimeoMatch) return `https://player.vimeo.com/video/${vimeoMatch[1]}`;
    // Loom
    if (url.includes("loom.com")) return url.replace("/share/", "/embed/");
    // Direct embed
    if (url.includes("embed")) return url;
    return null;
  }

  if (loading) {
    return (
      <div className="space-y-4 animate-fade-in">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!course) {
    return (
      <div className="text-center py-20">
        <p className="text-muted">Course not found</p>
        <Button variant="outline" className="mt-4" onClick={() => router.push("/onboarding")}>Back</Button>
      </div>
    );
  }

  const embedUrl = getEmbedUrl(videoUrl);

  return (
    <div className="space-y-3 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push("/onboarding")}>
            <ArrowLeft size={18} />
          </Button>
          <div>
            <h1 className="text-xl font-bold">{course.title}</h1>
            <div className="flex items-center gap-3 text-xs text-muted mt-1">
              {course.category && <Badge variant="outline" className="text-[10px]">{course.category}</Badge>}
              {course.duration && <span className="flex items-center gap-1"><Clock size={12} /> {course.duration} min</span>}
              {course.mandatory && <Badge variant="warning" className="text-[10px]">Mandatory</Badge>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
              <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1.5">
                <Save size={14} /> {saving ? "Saving..." : "Save"}
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)} className="gap-1.5">
              Edit Course
            </Button>
          )}
        </div>
      </div>

      {/* Description */}
      {course.description && (
        <p className="text-sm text-muted">{course.description}</p>
      )}

      {/* Video Embed */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Play size={14} className="text-[color:var(--accent-strong)]" /> Course Video</CardTitle>
        </CardHeader>
        <CardContent>
          {editing ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Video URL (YouTube, Vimeo, Loom, or embed URL)</Label>
                <Input value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=..." />
              </div>
              {embedUrl && (
                <div className="aspect-video rounded-lg overflow-hidden border border-border">
                  <iframe src={embedUrl} className="w-full h-full" allowFullScreen allow="autoplay; encrypted-media" />
                </div>
              )}
            </div>
          ) : embedUrl ? (
            <div className="aspect-video rounded-lg overflow-hidden border border-border">
              <iframe src={embedUrl} className="w-full h-full" allowFullScreen allow="autoplay; encrypted-media" />
            </div>
          ) : (
            <div className="aspect-video rounded-lg border border-dashed border-border flex items-center justify-center bg-surface-3">
              <div className="text-center">
                <Play size={32} className="mx-auto text-muted mb-2" />
                <p className="text-sm text-muted">No video added yet</p>
                <p className="text-xs text-muted-2">Click "Edit Course" to add a video URL</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Course Content */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><BookOpen size={14} className="text-[color:var(--accent-strong)]" /> Course Content</CardTitle>
        </CardHeader>
        <CardContent>
          {editing ? (
            <Textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Write course content, instructions, key takeaways..." rows={8} />
          ) : content ? (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <div className="whitespace-pre-wrap text-sm">{content}</div>
            </div>
          ) : (
            <p className="text-sm text-muted">No content added yet.</p>
          )}
        </CardContent>
      </Card>

      {/* Enrollments */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Users size={14} className="text-[color:var(--accent-strong)]" /> Enrollments</CardTitle>
        </CardHeader>
        <CardContent>
          {course.enrollments && course.enrollments.length > 0 ? (
            <div className="space-y-2">
              {course.enrollments.map((e: any) => (
                <div key={e.id} className="flex items-center justify-between p-2 rounded border border-border">
                  <div>
                    <p className="text-sm font-medium">{e.user?.firstName} {e.user?.lastName}</p>
                    <p className="text-xs text-muted">Started {new Date(e.startedAt).toLocaleDateString()}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Progress value={e.progress} className="w-20 h-1.5" />
                    <span className="text-xs font-mono">{e.progress}%</span>
                    {e.completedAt && <CheckCircle2 size={14} className="text-green-400" />}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted text-center py-4">No enrollments yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
