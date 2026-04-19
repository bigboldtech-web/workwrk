"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Search, Heart, Sparkles } from "lucide-react";
import { useToast } from "@/components/ui/toast";

interface Person {
  id: string;
  firstName: string;
  lastName: string;
  avatar: string | null;
  role?: { title: string } | null;
  department?: { name: string } | null;
}

const COMPANY_VALUES = [
  "Customer First",
  "Ownership",
  "Teamwork",
  "Innovation",
  "Excellence",
  "Integrity",
  "Growth Mindset",
  "Collaboration",
];

export function KudosModal({
  open,
  onClose,
  preselectedUserId,
}: {
  open: boolean;
  onClose: () => void;
  preselectedUserId?: string;
}) {
  const [step, setStep] = useState<"select" | "compose">(preselectedUserId ? "compose" : "select");
  const [people, setPeople] = useState<Person[]>([]);
  const [search, setSearch] = useState("");
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);
  const [message, setMessage] = useState("");
  const [selectedValue, setSelectedValue] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [loadingPeople, setLoadingPeople] = useState(false);
  const { success: toastSuccess, error: toastError } = useToast();

  const fetchPeople = useCallback(async () => {
    setLoadingPeople(true);
    try {
      const res = await fetch("/api/users?limit=200");
      if (!res.ok) throw new Error();
      const json = await res.json();
      const list = json.data || json.users || json || [];
      setPeople(Array.isArray(list) ? list : []);
    } catch {
      setPeople([]);
    } finally {
      setLoadingPeople(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      fetchPeople();
      setStep(preselectedUserId ? "compose" : "select");
      setMessage("");
      setSelectedValue(null);
      setSelectedPerson(null);
    }
  }, [open, preselectedUserId, fetchPeople]);

  // If preselected, find that person
  useEffect(() => {
    if (preselectedUserId && people.length > 0) {
      const found = people.find((p) => p.id === preselectedUserId);
      if (found) setSelectedPerson(found);
    }
  }, [preselectedUserId, people]);

  const filtered = people.filter((p) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      p.firstName.toLowerCase().includes(q) ||
      p.lastName.toLowerCase().includes(q) ||
      p.role?.title?.toLowerCase().includes(q) ||
      p.department?.name?.toLowerCase().includes(q)
    );
  });

  const handleSelectPerson = (person: Person) => {
    setSelectedPerson(person);
    setStep("compose");
    setSearch("");
  };

  const handleSend = async () => {
    if (!selectedPerson || !message.trim()) return;
    setSending(true);
    try {
      const res = await fetch("/api/kudos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receiverId: selectedPerson.id,
          message: message.trim(),
          companyValue: selectedValue,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to send kudos");
      }
      toastSuccess(`Kudos sent to ${selectedPerson.firstName}!`);
      onClose();
    } catch (err: unknown) {
      toastError(err instanceof Error ? err.message : "Failed to send kudos");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles size={18} className="text-yellow-400" />
            Give Kudos
          </DialogTitle>
        </DialogHeader>

        {step === "select" && (
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <Input
                placeholder="Search people..."
                className="pl-10"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />
            </div>
            <div className="max-h-64 overflow-y-auto space-y-1">
              {loadingPeople ? (
                <div className="py-8 text-center text-sm text-muted">Loading...</div>
              ) : filtered.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted">No people found</div>
              ) : (
                filtered.slice(0, 20).map((person) => (
                  <button
                    key={person.id}
                    className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-surface-2 transition-colors text-left"
                    onClick={() => handleSelectPerson(person)}
                  >
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="bg-[rgba(212,255,46,0.12)] text-[#d4ff2e] text-xs">
                        {person.firstName[0]}{person.lastName[0]}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{person.firstName} {person.lastName}</p>
                      <p className="text-[10px] text-muted">
                        {person.role?.title || "No role"}{person.department?.name ? ` · ${person.department.name}` : ""}
                      </p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {step === "compose" && selectedPerson && (
          <div className="space-y-4">
            {/* Selected person */}
            <div className="flex items-center gap-3 p-3 rounded-lg bg-surface-2 border border-border">
              <Avatar className="h-10 w-10">
                <AvatarFallback className="bg-[rgba(212,255,46,0.12)] text-[#d4ff2e] text-sm">
                  {selectedPerson.firstName[0]}{selectedPerson.lastName[0]}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <p className="text-sm font-medium">{selectedPerson.firstName} {selectedPerson.lastName}</p>
                <p className="text-xs text-muted">{selectedPerson.role?.title || "No role"}</p>
              </div>
              {!preselectedUserId && (
                <Button variant="ghost" size="sm" onClick={() => setStep("select")}>
                  Change
                </Button>
              )}
            </div>

            {/* Message */}
            <div className="space-y-2">
              <Label>Message <span className="text-red-400">*</span></Label>
              <Textarea
                placeholder="What did they do that was awesome?"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                autoFocus
              />
            </div>

            {/* Company values */}
            <div className="space-y-2">
              <Label>Company Value <span className="text-muted text-xs font-normal">(optional)</span></Label>
              <div className="flex flex-wrap gap-2">
                {COMPANY_VALUES.map((value) => (
                  <Badge
                    key={value}
                    variant={selectedValue === value ? "default" : "outline"}
                    className={`cursor-pointer transition-colors ${
                      selectedValue === value
                        ? "bg-[#d4ff2e] hover:bg-[#e2ff6b] text-[#0a0a0a]"
                        : "hover:bg-surface-2"
                    }`}
                    onClick={() => setSelectedValue(selectedValue === value ? null : value)}
                  >
                    {value}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          {step === "compose" && (
            <Button
              onClick={handleSend}
              disabled={sending || !message.trim()}
              className="gap-2"
            >
              <Heart size={14} />
              {sending ? "Sending..." : "Send Kudos"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
