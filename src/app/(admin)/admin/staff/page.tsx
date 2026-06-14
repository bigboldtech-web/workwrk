"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { ShieldCheck, Trash2, RefreshCw, UserPlus, Loader2 } from "lucide-react";

interface Staff {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
}

export default function PlatformStaffPage() {
  const toast = useToast();
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/platform-staff");
      const d = await res.json();
      setStaff(Array.isArray(d?.staff) ? d.staff : []);
    } catch {
      toast.error("Couldn't load staff", "Please refresh.");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const add = async () => {
    if (!email.trim()) return;
    setAdding(true);
    try {
      const res = await fetch("/api/admin/platform-staff", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), name: name.trim() || undefined }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error("Couldn't add", d?.error ?? "Please try again.");
        return;
      }
      toast.success("Staff added", `${email.trim().toLowerCase()} can now access the back-office.`);
      setEmail("");
      setName("");
      await load();
    } catch {
      toast.error("Couldn't add", "Network error.");
    } finally {
      setAdding(false);
    }
  };

  const remove = async (s: Staff) => {
    setRemovingId(s.id);
    try {
      const res = await fetch("/api/admin/platform-staff", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: s.id }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error("Couldn't remove", d?.error ?? "Please try again.");
        return;
      }
      toast.success("Staff removed", s.email);
      await load();
    } catch {
      toast.error("Couldn't remove", "Network error.");
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <ShieldCheck size={20} className="text-red-400" />
            Platform Staff
          </h1>
          <p className="text-sm text-muted mt-1 max-w-2xl">
            WorkwrK employees allowed into this back-office. Gated by email — completely
            separate from any customer&apos;s roles, so a tenant&apos;s admin can never get in.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Add staff member</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              placeholder="email@bigboldtech.com"
              value={email}
              type="email"
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") add();
              }}
            />
            <Input
              placeholder="Name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") add();
              }}
            />
            <Button onClick={add} disabled={adding || !email.trim()}>
              {adding ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
              Add
            </Button>
          </div>
          <p className="text-xs text-muted mt-2">
            They must also have a WorkwrK login (same credentials). Email is matched
            case-insensitively.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Current staff ({staff.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted py-4">
              <Loader2 size={16} className="animate-spin" /> Loading…
            </div>
          ) : staff.length === 0 ? (
            <p className="text-sm text-muted py-4">No staff yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {staff.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{s.email}</div>
                    {s.name ? <div className="text-xs text-muted truncate">{s.name}</div> : null}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => remove(s)}
                    disabled={removingId === s.id || staff.length <= 1}
                    title={staff.length <= 1 ? "Can't remove the last staff member" : "Remove"}
                    className="text-red-400 hover:text-red-300 shrink-0"
                  >
                    {removingId === s.id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Trash2 size={14} />
                    )}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
