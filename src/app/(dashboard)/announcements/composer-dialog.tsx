"use client";

/* Announcement composer.
 *
 * Admin/HR gated at the call site (usePermission("announcements","create"))
 * — the same gate the POST /api/announcements route enforces server-side.
 * Only offers fields the Announcement model + POST route actually accept:
 * title, content, type, priority, pinned, mustAcknowledge, publishedAt
 * (schedule), expiresAt (required by the route). targetAudience is stored
 * but not yet enforced anywhere (notifications + the ack roster both run
 * org-wide), so we surface "Everyone" as the live option and mark narrower
 * targeting as Coming soon rather than faking a selector the backend ignores.
 */

import { useEffect, useState } from "react";
import { AlertTriangle, CalendarRange, Info, PartyPopper, ShieldCheck, Loader2, Check } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";

type AnnType = "INFO" | "WARNING" | "CELEBRATION" | "POLICY" | "EVENT";
type AnnPrio = "LOW" | "NORMAL" | "HIGH" | "URGENT";
type AudienceType = "ALL" | "DEPARTMENTS" | "OFFICES" | "USERS" | "TAGS";

const AUDIENCE_OPTS: { value: AudienceType; label: string }[] = [
  { value: "ALL", label: "Everyone" },
  { value: "DEPARTMENTS", label: "Departments" },
  { value: "OFFICES", label: "Offices" },
  { value: "USERS", label: "People" },
  { value: "TAGS", label: "Tags" },
];

const TYPE_OPTS: { value: AnnType; label: string; Icon: typeof Info }[] = [
  { value: "INFO", label: "Info", Icon: Info },
  { value: "WARNING", label: "Warning", Icon: AlertTriangle },
  { value: "POLICY", label: "Policy", Icon: ShieldCheck },
  { value: "EVENT", label: "Event", Icon: CalendarRange },
  { value: "CELEBRATION", label: "Celebration", Icon: PartyPopper },
];
const PRIO_OPTS: { value: AnnPrio; label: string }[] = [
  { value: "LOW", label: "Low" },
  { value: "NORMAL", label: "Normal" },
  { value: "HIGH", label: "High" },
  { value: "URGENT", label: "Urgent" },
];

/** yyyy-mm-dd for a Date offset by `days` from today (local). */
function dateInputValue(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function AnnouncementComposer({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (msg: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [type, setType] = useState<AnnType>("INFO");
  const [priority, setPriority] = useState<AnnPrio>("NORMAL");
  const [pinned, setPinned] = useState(false);
  const [mustAcknowledge, setMustAcknowledge] = useState(false);
  const [scheduleOn, setScheduleOn] = useState(false);
  const [publishedAt, setPublishedAt] = useState("");
  const [expiresAt, setExpiresAt] = useState(dateInputValue(30));
  const [audienceType, setAudienceType] = useState<AudienceType>("ALL");
  const [audienceIds, setAudienceIds] = useState<string[]>([]);
  const [audOptions, setAudOptions] = useState<{ id: string; name: string }[]>([]);
  const [audLoading, setAudLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the id list for the chosen audience type (once per switch to a
  // non-ALL type). People come from the org-wide user search; the rest are
  // small lookup lists.
  useEffect(() => {
    if (!open || audienceType === "ALL") { setAudOptions([]); return; }
    let active = true;
    setAudLoading(true);
    const url =
      audienceType === "DEPARTMENTS" ? "/api/departments" :
      audienceType === "OFFICES" ? "/api/offices" :
      audienceType === "TAGS" ? "/api/tags" :
      "/api/users?scope=all&limit=500";
    fetch(url)
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => {
        if (!active) return;
        const raw = Array.isArray(d) ? d : (d?.data?.items ?? d?.data ?? []);
        setAudOptions(
          (raw as Record<string, unknown>[]).map((o) => ({
            id: String(o.id),
            name:
              audienceType === "USERS"
                ? (`${o.firstName ?? ""} ${o.lastName ?? ""}`.trim() || String(o.email ?? "Unknown"))
                : String(o.name ?? (audienceType === "OFFICES" ? "Office" : audienceType === "TAGS" ? "Tag" : "Department")),
          })),
        );
      })
      .catch(() => { if (active) setAudOptions([]); })
      .finally(() => { if (active) setAudLoading(false); });
    return () => { active = false; };
  }, [open, audienceType]);

  function reset() {
    setTitle(""); setContent(""); setType("INFO"); setPriority("NORMAL");
    setPinned(false); setMustAcknowledge(false); setScheduleOn(false);
    setPublishedAt(""); setExpiresAt(dateInputValue(30)); setError(null);
    setAudienceType("ALL"); setAudienceIds([]);
  }

  function handleOpenChange(next: boolean) {
    if (next) return;
    if (submitting) return;
    reset();
    onClose();
  }

  async function submit() {
    setError(null);
    if (!title.trim()) { setError("Title is required."); return; }
    if (!content.trim()) { setError("Content is required."); return; }
    if (!expiresAt) { setError("An expiry date is required."); return; }
    // Mirror the server's future-date checks so the user gets instant feedback.
    const expiryMs = new Date(`${expiresAt.slice(0, 10)}T23:59:59.999Z`).getTime();
    if (Number.isNaN(expiryMs) || expiryMs <= Date.now()) {
      setError("Expiry date must be in the future."); return;
    }
    let publishIso: string | undefined;
    if (scheduleOn && publishedAt) {
      const pubMs = new Date(publishedAt).getTime();
      if (Number.isNaN(pubMs)) { setError("Invalid schedule time."); return; }
      if (pubMs >= expiryMs) { setError("Publish time must be before the expiry date."); return; }
      if (pubMs > Date.now()) publishIso = new Date(pubMs).toISOString();
    }

    if (audienceType !== "ALL" && audienceIds.length === 0) {
      setError("Pick at least one target, or choose Everyone.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          content: content.trim(),
          type,
          priority,
          pinned,
          mustAcknowledge,
          expiresAt,
          targetAudience: { type: audienceType, ids: audienceType === "ALL" ? [] : audienceIds },
          ...(publishIso ? { publishedAt: publishIso } : {}),
        }),
      });
      if (!res.ok) {
        if (res.status === 403) { setError("You don't have permission to post announcements."); return; }
        let msg = "Couldn't post the announcement.";
        try { const j = await res.json(); if (j?.error) msg = j.error; } catch { /* keep default */ }
        setError(msg);
        return;
      }
      const scheduled = Boolean(publishIso);
      reset();
      onCreated(scheduled ? "Announcement scheduled" : "Announcement posted");
      onClose();
    } catch {
      setError("Network error — couldn't post.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="workwrk-os os-portal-panel max-w-[560px]">
        <DialogHeader>
          <DialogTitle>New announcement</DialogTitle>
          <DialogDescription>Post an update to everyone, or target specific departments, offices, people or tags.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-1">
          {/* Title */}
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-[var(--os-ink-2)]">Title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Office closed Friday for maintenance"
              maxLength={160}
              className="h-10 rounded-lg border border-[var(--os-line)] bg-[var(--os-surface-1)] px-3 text-[14.5px] text-[var(--os-ink)] placeholder:text-[var(--os-ink-4)] outline-none focus:border-[var(--os-brand)]"
            />
          </label>

          {/* Content */}
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-[var(--os-ink-2)]">Content</span>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Write the announcement…"
              rows={4}
              className="rounded-lg border border-[var(--os-line)] bg-[var(--os-surface-1)] px-3 py-2 text-[14.5px] leading-relaxed text-[var(--os-ink)] placeholder:text-[var(--os-ink-4)] outline-none resize-y focus:border-[var(--os-brand)]"
            />
          </label>

          {/* Audience — Everyone, or a set of departments / offices / people /
              tags. Non-ALL targets are resolved to their current members at
              read time, so the feed + notifications only reach the audience. */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-[var(--os-ink-2)]">Who sees this</span>
            <div className="flex flex-wrap gap-1.5">
              {AUDIENCE_OPTS.map(({ value, label }) => {
                const active = audienceType === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => { setAudienceType(value); setAudienceIds([]); }}
                    className={`h-8 px-3 rounded-lg text-[13.5px] border transition-colors ${
                      active
                        ? "border-[var(--os-brand)] bg-[var(--os-brand-soft)] text-[var(--os-brand-deep)] font-medium"
                        : "border-[var(--os-line)] text-[var(--os-ink-2)] hover:bg-[var(--os-surface-1)]"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {audienceType !== "ALL" && (
              <div className="mt-1 max-h-[168px] overflow-y-auto rounded-lg border border-[var(--os-line)] p-1.5">
                {audLoading ? (
                  <div className="px-2 py-3 text-center text-[13px] text-[var(--os-ink-4)]">Loading…</div>
                ) : audOptions.length === 0 ? (
                  <div className="px-2 py-3 text-center text-[13px] text-[var(--os-ink-4)]">
                    {audienceType === "TAGS" ? "No tags yet — create some in Settings → Tags" : "Nothing to pick here"}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-1">
                    {audOptions.map((o) => {
                      const on = audienceIds.includes(o.id);
                      return (
                        <button
                          key={o.id}
                          type="button"
                          onClick={() => setAudienceIds((l) => (on ? l.filter((x) => x !== o.id) : [...l, o.id]))}
                          className={`flex items-center gap-2 h-8 px-2 rounded-md text-[13.5px] text-left border ${
                            on ? "border-[var(--os-brand)] bg-[var(--os-brand-soft)]" : "border-transparent hover:bg-[var(--os-surface-1)]"
                          }`}
                        >
                          <span className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${on ? "bg-[var(--os-brand)] border-[var(--os-brand)]" : "border-[var(--os-line)]"}`}>
                            {on && <Check className="h-2.5 w-2.5 text-white" />}
                          </span>
                          <span className="truncate text-[var(--os-ink)]">{o.name}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Type */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-[var(--os-ink-2)]">Type</span>
            <div className="flex flex-wrap gap-1.5">
              {TYPE_OPTS.map(({ value, label, Icon }) => {
                const active = type === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setType(value)}
                    className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[13.5px] border transition-colors ${
                      active
                        ? "border-[var(--os-brand)] bg-[var(--os-brand-soft)] text-[var(--os-brand-deep)] font-medium"
                        : "border-[var(--os-line)] text-[var(--os-ink-2)] hover:bg-[var(--os-surface-1)]"
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" /> {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Priority */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-[var(--os-ink-2)]">Priority</span>
            <div className="flex flex-wrap gap-1.5">
              {PRIO_OPTS.map(({ value, label }) => {
                const active = priority === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setPriority(value)}
                    className={`inline-flex items-center h-8 px-3 rounded-lg text-[13.5px] border transition-colors ${
                      active
                        ? "border-[var(--os-brand)] bg-[var(--os-brand-soft)] text-[var(--os-brand-deep)] font-medium"
                        : "border-[var(--os-line)] text-[var(--os-ink-2)] hover:bg-[var(--os-surface-1)]"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Audience — only "Everyone" is actually wired (notifications +
              ack roster both run org-wide). Narrower targeting is honest
              Coming-soon rather than a selector the backend ignores. */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-[var(--os-ink-2)]">Audience</span>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center h-8 px-3 rounded-lg text-[13.5px] border border-[var(--os-brand)] bg-[var(--os-brand-soft)] text-[var(--os-brand-deep)] font-medium">
                Everyone in the organization
              </span>
              <span
                className="inline-flex items-center h-8 px-3 rounded-lg text-[13.5px] border border-dashed border-[var(--os-line)] text-[var(--os-ink-4)] cursor-not-allowed"
                title="Targeting specific teams or roles is coming soon"
              >
                Specific teams / roles · Coming soon
              </span>
            </div>
          </div>

          {/* Toggles */}
          <div className="flex flex-col gap-2.5 rounded-lg border border-[var(--os-line)] p-3">
            <label className="flex items-center justify-between gap-3">
              <span className="flex flex-col">
                <span className="text-[14px] text-[var(--os-ink)]">Pin to top</span>
                <span className="text-[12.5px] text-[var(--os-ink-3)]">Keeps this above the priority sections.</span>
              </span>
              <Switch checked={pinned} onChange={setPinned} aria-label="Pin to top" />
            </label>
            <label className="flex items-center justify-between gap-3">
              <span className="flex flex-col">
                <span className="text-[14px] text-[var(--os-ink)]">Require acknowledgment</span>
                <span className="text-[12.5px] text-[var(--os-ink-3)]">Each person must confirm they&apos;ve read it.</span>
              </span>
              <Switch checked={mustAcknowledge} onChange={setMustAcknowledge} aria-label="Require acknowledgment" />
            </label>
          </div>

          {/* Schedule + expiry */}
          <div className="flex flex-col gap-3">
            <label className="flex items-center justify-between gap-3">
              <span className="flex flex-col">
                <span className="text-[14px] text-[var(--os-ink)]">Schedule for later</span>
                <span className="text-[12.5px] text-[var(--os-ink-3)]">Off publishes immediately.</span>
              </span>
              <Switch checked={scheduleOn} onChange={setScheduleOn} aria-label="Schedule for later" />
            </label>
            {scheduleOn ? (
              <label className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium text-[var(--os-ink-2)]">Publish at</span>
                <input
                  type="datetime-local"
                  value={publishedAt}
                  onChange={(e) => setPublishedAt(e.target.value)}
                  className="h-10 rounded-lg border border-[var(--os-line)] bg-[var(--os-surface-1)] px-3 text-[14.5px] text-[var(--os-ink)] outline-none focus:border-[var(--os-brand)]"
                />
              </label>
            ) : null}
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-[var(--os-ink-2)]">Expires on</span>
              <input
                type="date"
                value={expiresAt}
                min={dateInputValue(1)}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="h-10 rounded-lg border border-[var(--os-line)] bg-[var(--os-surface-1)] px-3 text-[14.5px] text-[var(--os-ink)] outline-none focus:border-[var(--os-brand)]"
              />
              <span className="text-[12.5px] text-[var(--os-ink-3)]">Required — the post drops off the feed after this date.</span>
            </label>
          </div>

          {error ? (
            <div className="flex items-start gap-2 rounded-lg border border-[color:var(--os-c-red)]/40 bg-[color:var(--os-c-red)]/10 px-3 py-2 text-[13.5px] text-[var(--os-c-red)]">
              <AlertTriangle className="w-4 h-4 mt-[1px] shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => handleOpenChange(false)}
            disabled={submitting}
            className="h-9 px-3.5 rounded-lg border border-[var(--os-line)] text-[14px] text-[var(--os-ink-2)] hover:bg-[var(--os-surface-1)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-[var(--os-brand)] text-white text-[14px] font-medium hover:bg-[var(--os-brand-hover)] disabled:opacity-60"
          >
            {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            {scheduleOn && publishedAt ? "Schedule announcement" : "Post announcement"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
