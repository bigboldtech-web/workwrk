"use client";

// /onboard: "Set up {Org}", the one wizard (spec-account-auth `/onboard`).
// An offer, never a gate: nothing redirects here any more (the dashboard
// layout's setup gate is gone), /signup opens it, and "Finish later" hands
// the job to the Workspace settings Overview card.
//
// Who sees what (src/lib/setup/console-state.ts onboardView):
//   Owner or Admin, both console flags null   the four steps
//   anyone else, or a finished or dismissed org   "Nothing to set up", with
//                                                 its one way on to Work home
//
// Every step writes through the real gated route, never POST /api/setup
// (retired): name PATCH /api/settings general, mission culture, logo
// /api/settings/logo, invitations POST /api/invitations (the level rule and
// the domain lock), departments one POST or DELETE per change (never a
// wholesale replace, so a skipped step can never wipe the defaults
// seedOrgDefaults made), Talk and Tables /api/products/installations, and
// the resume point PATCH /api/settings console. A failed write blocks the
// step and says so; nothing is swallowed.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { getCsrfToken, getSession, useSession } from "next-auth/react";
import { Check, MessageSquare, Table as TableIcon, X } from "lucide-react";
import { Logo, LogoLockup } from "@/components/brand/logo";
import { Dots } from "@/components/ui/dots";
import { AuthBanner, FourDotsDrawing } from "@/components/auth/auth-card";
import { useViewer } from "@/lib/access/use-access";
import { onboardView, readConsole, type ConsoleState } from "@/lib/setup/console-state";
import { WORK_HOME_HREF } from "@/lib/nav/route-hub";

const STEP_LABELS = ["Make it yours", "Invite your team", "Create your departments", "Turn on what you need"] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MODULES = [
  { slug: "workwrk-talk", name: "Talk", blurb: "Chat, huddles and calls for your team", Icon: MessageSquare },
  { slug: "workwrk-tables", name: "Tables", blurb: "Spreadsheets that live with your work", Icon: TableIcon },
] as const;

type Step = 1 | 2 | 3 | 4;

interface Dept {
  id: string;
  name: string;
  members: number;
  goals: number;
}

interface Chip {
  email: string;
  state: "draft" | "sending" | "sent" | "failed" | "invalid";
  reason?: string;
}

interface Loaded {
  orgName: string;
  logo: string | null;
  mission: string;
  console: ConsoleState;
  departments: Dept[];
  modulesOn: Record<string, boolean>;
}

async function patchSettings(section: string, data: Record<string, unknown>): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  try {
    const r = await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ section, data }) });
    if (r.ok) return { ok: true };
    const d = (await r.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: d.error || "That did not save.", status: r.status };
  } catch {
    return { ok: false, error: "Can't reach WorkwrK. Check your connection.", status: 0 };
  }
}

/** Commit typed or pasted text as chips: comma, space, semicolon and newline separate; a repeat is dropped; a bad address stays, in red. */
function mergeDraft(prev: Chip[], text: string): Chip[] {
  const parts = text.split(/[\s,;]+/).map((t) => t.trim()).filter(Boolean);
  const next = [...prev];
  for (const p of parts) {
    const lower = p.toLowerCase();
    if (next.some((c) => c.email.toLowerCase() === lower)) continue;
    const ok = EMAIL_RE.test(p);
    next.push({ email: p, state: ok ? "draft" : "invalid", reason: ok ? undefined : "Not an email address" });
  }
  return next;
}

function initials(name: string): string {
  const p = name.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "W";
}

function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const set = () => setOnline(navigator.onLine);
    set();
    window.addEventListener("online", set);
    window.addEventListener("offline", set);
    return () => {
      window.removeEventListener("online", set);
      window.removeEventListener("offline", set);
    };
  }, []);
  return online;
}

export default function OnboardPage() {
  const viewer = useViewer();
  const isAdmin = viewer.orgRole === "OWNER" || viewer.orgRole === "ADMIN";
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!viewer.ready) return;
    let alive = true;
    (async () => {
      try {
        const sRes = await fetch("/api/settings", { cache: "no-store" });
        if (sRes.status === 401) {
          window.location.assign("/login?callbackUrl=%2Fonboard");
          return;
        }
        if (!sRes.ok) throw new Error("settings");
        const s = (await sRes.json()) as { organization?: { name?: string; logo?: string | null }; settings?: { companyProfile?: { mission?: string } | null; console?: unknown } };
        const consoleState = readConsole({ console: s.settings?.console });
        let departments: Dept[] = [];
        const modulesOn: Record<string, boolean> = {};
        if (isAdmin) {
          const [dRes, mRes] = await Promise.all([fetch("/api/departments?withAccess=1", { cache: "no-store" }), fetch("/api/products/installations", { cache: "no-store" })]);
          if (!dRes.ok || !mRes.ok) throw new Error("lists");
          const d = (await dRes.json()) as { data?: Array<{ id: string; name: string; _count?: { members?: number }; goalCount?: number }> };
          departments = (d.data ?? []).map((x) => ({ id: x.id, name: x.name, members: x._count?.members ?? 0, goals: x.goalCount ?? 0 }));
          const m = (await mRes.json()) as { installations?: Array<{ productSlug: string; status: string }> };
          for (const i of m.installations ?? []) modulesOn[i.productSlug] = i.status === "ACTIVE";
        }
        if (!alive) return;
        setLoaded({
          orgName: s.organization?.name ?? "your workspace",
          logo: s.organization?.logo ?? null,
          mission: s.settings?.companyProfile?.mission ?? "",
          console: consoleState,
          departments,
          modulesOn,
        });
      } catch {
        if (alive) setLoadError("Couldn't open setup.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [viewer.ready, isAdmin, attempt]);

  if (loadError) {
    return (
      <div className="wz">
        <div className="wz-nothing">
          <div className="wz-nothing__card">
            <FourDotsDrawing />
            <h1 className="wa-title">{loadError}</h1>
            <p className="wa-help">Check your connection and try again.</p>
            <button type="button" className="wa-btn wa-btn--primary" onClick={() => { setLoadError(null); setAttempt((n) => n + 1); }}>
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!loaded || !viewer.ready) {
    return (
      <div className="wz-boot" role="status" aria-label="Opening setup">
        <Logo width={28} pulsing title="Opening setup" />
      </div>
    );
  }

  const view = onboardView(loaded.console, isAdmin);
  if (view.kind === "nothing") return <NothingToSetUp orgName={loaded.orgName} reason={view.reason} />;
  return <Wizard initial={loaded} startStep={view.step} />;
}

function NothingToSetUp({ orgName, reason }: { orgName: string; reason: "not-admin" | "completed" | "dismissed" }) {
  return (
    <div className="wz">
      <header className="wz-head">
        <LogoLockup size={20} textColor="var(--os-ink)" />
      </header>
      <WorkspaceMoveNotice />
      <div className="wz-nothing">
        <div className="wz-nothing__card">
          <FourDotsDrawing />
          <h1 className="wa-title">{orgName} is ready</h1>
          <p className="wa-help">{reason === "not-admin" ? "Your workspace is set up. Your admin looks after the settings." : reason === "completed" ? `You finished setting up ${orgName}.` : "You chose to finish setting up later. The steps are waiting in Workspace settings."}</p>
          <a href={WORK_HOME_HREF} className="wa-btn wa-btn--primary">
            Open my workspace
          </a>
          {reason === "not-admin" ? null : (
            <Link href="/settings" className="wa-link wa-link--sm">
              Pick up where you left off
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function Wizard({ initial, startStep }: { initial: Loaded; startStep: Step }) {
  const online = useOnline();
  const [step, setStep] = useState<Step>(startStep);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string[] | null>(null);

  // Step 1
  const [name, setName] = useState(initial.orgName);
  const [savedName, setSavedName] = useState(initial.orgName);
  const [mission, setMission] = useState(initial.mission);
  const [savedMission, setSavedMission] = useState(initial.mission);
  const [logo, setLogo] = useState<string | null>(initial.logo);
  const [logoBusy, setLogoBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Step 2
  const [chips, setChips] = useState<Chip[]>([]);
  const [draft, setDraft] = useState("");
  const [role, setRole] = useState<"ADMIN" | "MEMBER">("MEMBER");
  const [agent, setAgent] = useState(false);
  const [inviteDept, setInviteDept] = useState("");
  const [message, setMessage] = useState("");

  // Step 3
  const [depts, setDepts] = useState<Dept[]>(initial.departments);
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState<string[]>([]);
  const [newDept, setNewDept] = useState("");
  const [deptWarn, setDeptWarn] = useState<Record<string, string>>({});

  // Step 4
  const [modulesOn, setModulesOn] = useState<Record<string, boolean>>(initial.modulesOn);
  const [moduleBusy, setModuleBusy] = useState<string | null>(null);

  const dirty = useMemo(() => {
    if (step === 1) return name.trim() !== savedName || mission.trim() !== savedMission.trim();
    if (step === 2) return chips.some((c) => c.state === "draft" || c.state === "failed") || draft.trim().length > 0;
    if (step === 3) return unchecked.size > 0 || added.length > 0 || newDept.trim().length > 0;
    return false;
  }, [step, name, savedName, mission, savedMission, chips, draft, unchecked, added, newDept]);

  const sentCount = chips.filter((c) => c.state === "sent").length;

  const finishLater = useCallback(async () => {
    if (dirty && !window.confirm("Leave setup? What you typed on this step is not saved yet.")) return;
    setSaving(true);
    const r = await patchSettings("console", { dismiss: true });
    if (!r.ok) {
      setSaving(false);
      setError(r.error);
      return;
    }
    window.location.assign(WORK_HOME_HREF);
  }, [dirty]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) void finishLater();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finishLater]);

  async function advance(to: Step) {
    const r = await patchSettings("console", { setupStep: to });
    if (!r.ok) {
      setError(r.error);
      return false;
    }
    setError(null);
    setStep(to);
    window.scrollTo({ top: 0 });
    return true;
  }

  function commitDraft(text: string) {
    setChips((prev) => mergeDraft(prev, text));
    setDraft("");
  }

  async function saveStep1(): Promise<boolean> {
    if (!name.trim()) {
      setError("The workspace needs a name.");
      return false;
    }
    if (name.trim() !== savedName) {
      const r = await patchSettings("general", { name: name.trim() });
      if (!r.ok) {
        setError(r.error);
        return false;
      }
      setSavedName(name.trim());
    }
    if (mission.trim() !== savedMission.trim()) {
      const r = await patchSettings("culture", { mission: mission.trim() });
      if (!r.ok) {
        setError(r.error);
        return false;
      }
      setSavedMission(mission.trim());
    }
    return true;
  }

  async function saveStep2(): Promise<boolean> {
    const list = draft.trim() ? mergeDraft(chips, draft) : chips;
    if (draft.trim()) {
      setChips(list);
      setDraft("");
    }
    const pending = list.filter((c) => c.state === "draft" || c.state === "failed");
    if (list.some((c) => c.state === "invalid")) {
      setError("Fix or remove the addresses in red first.");
      return false;
    }
    let failed = 0;
    for (const chip of pending) {
      setChips((prev) => prev.map((c) => (c.email === chip.email ? { ...c, state: "sending", reason: undefined } : c)));
      let reason: string | undefined;
      let ok = false;
      try {
        const r = await fetch("/api/invitations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: chip.email,
            role,
            isAgent: role === "MEMBER" && agent,
            departmentId: inviteDept || undefined,
            message: message.trim() || undefined,
          }),
        });
        ok = r.ok;
        if (!ok) {
          const d = (await r.json().catch(() => ({}))) as { error?: string };
          const e = d.error ?? "";
          reason = /already exists/i.test(e) ? "Already a member" : /already sent/i.test(e) ? "Already invited" : /can join this workspace/i.test(e) ? "Not an allowed domain" : e || "Did not send";
        }
      } catch {
        reason = "Can't reach WorkwrK";
      }
      if (!ok) failed += 1;
      setChips((prev) => prev.map((c) => (c.email === chip.email ? { ...c, state: ok ? "sent" : "failed", reason } : c)));
    }
    if (failed > 0) {
      setError(`${failed} invitation${failed === 1 ? "" : "s"} did not go out. Fix or remove ${failed === 1 ? "it" : "them"}, then continue.`);
      return false;
    }
    return true;
  }

  async function saveStep3(): Promise<boolean> {
    const warns: Record<string, string> = {};
    // Adds first, one POST per name: a department is never lost to a delete
    // that happened before its replacement was made.
    for (const nm of added) {
      try {
        const r = await fetch("/api/departments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: nm }) });
        if (r.ok) {
          const d = (await r.json().catch(() => ({}))) as { id?: string };
          const id = d.id ?? `new-${nm}`;
          setDepts((prev) => [...prev, { id, name: nm, members: 0, goals: 0 }]);
          setAdded((prev) => prev.filter((x) => x !== nm));
        } else {
          const d = (await r.json().catch(() => ({}))) as { error?: string; code?: string };
          if (d.code === "duplicate") setAdded((prev) => prev.filter((x) => x !== nm));
          else warns[`add:${nm}`] = d.error || `${nm} was not added.`;
        }
      } catch {
        warns[`add:${nm}`] = "Can't reach WorkwrK.";
      }
    }
    for (const id of unchecked) {
      const dept = depts.find((d) => d.id === id);
      if (!dept) continue;
      try {
        const r = await fetch(`/api/departments/${encodeURIComponent(id)}`, { method: "DELETE" });
        if (r.ok) {
          setDepts((prev) => prev.filter((d) => d.id !== id));
          setUnchecked((prev) => {
            const n = new Set(prev);
            n.delete(id);
            return n;
          });
        } else {
          const d = (await r.json().catch(() => ({}))) as { error?: string };
          warns[id] = d.error || `${dept.name} was not removed.`;
          setUnchecked((prev) => {
            const n = new Set(prev);
            n.delete(id);
            return n;
          });
        }
      } catch {
        warns[id] = "Can't reach WorkwrK.";
      }
    }
    setDeptWarn(warns);
    if (Object.keys(warns).length > 0) {
      setError("Some department changes did not save. They are marked below.");
      return false;
    }
    return true;
  }

  async function toggleModule(slug: string, on: boolean) {
    if (moduleBusy) return;
    setModuleBusy(slug);
    setError(null);
    try {
      const r = await fetch("/api/products/installations", { method: on ? "POST" : "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productSlug: slug }) });
      if (!r.ok) {
        const d = (await r.json().catch(() => ({}))) as { error?: string };
        setError(d.error ? `That did not change: ${d.error}` : "That did not change. Try again.");
      } else {
        setModulesOn((m) => ({ ...m, [slug]: on }));
      }
    } catch {
      setError("Can't reach WorkwrK. Check your connection.");
    } finally {
      setModuleBusy(null);
    }
  }

  async function onContinue() {
    if (saving || !online) return;
    setSaving(true);
    setError(null);
    try {
      if (step === 1) {
        if ((await saveStep1()) && (await advance(2))) return;
      } else if (step === 2) {
        if ((await saveStep2()) && (await advance(3))) return;
      } else if (step === 3) {
        if ((await saveStep3()) && (await advance(4))) return;
      } else {
        const r = await patchSettings("console", { complete: true });
        if (!r.ok) {
          setError(r.error);
          return;
        }
        const lines = [`Workspace named ${savedName}`];
        if (sentCount > 0) lines.push(`${sentCount} invitation${sentCount === 1 ? "" : "s"} sent`);
        lines.push(`${depts.length} department${depts.length === 1 ? "" : "s"}`);
        for (const m of MODULES) if (modulesOn[m.slug]) lines.push(`${m.name} is on`);
        setDone(lines);
      }
    } finally {
      setSaving(false);
    }
  }

  async function onSkip() {
    if (saving || !online) return;
    setSaving(true);
    try {
      if (step === 2) {
        setChips([]);
        setDraft("");
      }
      if (step === 3) {
        setUnchecked(new Set());
        setAdded([]);
        setNewDept("");
      }
      await advance((step + 1) as Step);
    } finally {
      setSaving(false);
    }
  }

  async function uploadLogo(file: File) {
    setLogoBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("logo", file);
      const r = await fetch("/api/settings/logo", { method: "POST", body: fd });
      const d = (await r.json().catch(() => ({}))) as { logo?: string; error?: string };
      if (!r.ok || !d.logo) setError(d.error || "The logo did not upload.");
      else setLogo(d.logo);
    } catch {
      setError("Can't reach WorkwrK. Check your connection.");
    } finally {
      setLogoBusy(false);
    }
  }

  async function removeLogo() {
    setLogoBusy(true);
    try {
      const r = await fetch("/api/settings/logo", { method: "DELETE" });
      if (r.ok) setLogo(null);
      else setError("The logo was not removed.");
    } catch {
      setError("Can't reach WorkwrK. Check your connection.");
    } finally {
      setLogoBusy(false);
    }
  }

  if (done) {
    return (
      <div className="wz">
        <header className="wz-head">
          <LogoLockup size={20} textColor="var(--os-ink)" />
        </header>
        <main className="wz-main">
          <div className="wz-card wz-done">
            <FourDotsDrawing />
            <h1 className="wa-title">You are set up</h1>
            <ul>
              {done.map((l) => (
                <li key={l}>
                  <Check size={16} aria-hidden />
                  {l}
                </li>
              ))}
            </ul>
            <a href={WORK_HOME_HREF} className="wa-btn wa-btn--primary">
              Open my workspace
            </a>
            <p className="wa-help">Anything else? Everything lives in Workspace settings.</p>
          </div>
        </main>
      </div>
    );
  }

  const titles: Record<Step, { title: string; sub: string }> = {
    1: { title: "Make it yours", sub: `How ${savedName} appears to everyone you invite.` },
    2: { title: "Invite your team", sub: "They get an email with a link to join. You can invite more people any time." },
    3: { title: "Create your departments", sub: "We started you with six. Keep the ones you use and add your own." },
    4: { title: "Turn on what you need", sub: "Both are optional and you can turn them on later." },
  };

  return (
    <div className="wz">
      <header className="wz-head">
        <LogoLockup size={20} textColor="var(--os-ink)" />
        <div className="wz-steps" aria-label={`Step ${step} of 4: ${STEP_LABELS[step - 1]}`}>
          <span className="wz-steps__dots" aria-hidden>
            {[1, 2, 3, 4].map((n) => (
              <i key={n} className={n < step ? "is-done" : n === step ? "is-current" : undefined} />
            ))}
          </span>
          <span className="wz-steps__label">{STEP_LABELS[step - 1]}</span>
          <span className="wz-steps__count">Step {step} of 4</span>
        </div>
        <div className="wz-head__right">
          <button type="button" className="wa-link wa-link--sm" onClick={() => void finishLater()} disabled={saving}>
            Finish later
          </button>
        </div>
      </header>

      <main className="wz-main">
        <WorkspaceMoveNotice />
        <div className="wa-card__head">
          <h1 className="wa-title">{titles[step].title}</h1>
          <p className="wa-sub">{titles[step].sub}</p>
        </div>

        <form
          className="wz-card"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void onContinue();
          }}
        >
          {step === 1 ? (
            <>
              <div className="wa-field">
                <label htmlFor="wsName" className="wa-label">
                  Workspace name
                </label>
                <input id="wsName" className="wa-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus />
              </div>
              <div className="wa-field">
                <span className="wa-label">Logo</span>
                <div className="wz-logo-row">
                  <span className="wz-tile">
                    {logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={logo} alt="" />
                    ) : (
                      initials(name || savedName)
                    )}
                  </span>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void uploadLogo(f);
                      e.target.value = "";
                    }}
                  />
                  <button type="button" className="wa-btn wa-btn--secondary" onClick={() => fileRef.current?.click()} disabled={logoBusy} data-pending={logoBusy || undefined}>
                    {logoBusy ? <Dots variant="pending" label="Uploading" /> : null}
                    Upload
                  </button>
                  {logo ? (
                    <button type="button" className="wa-btn wa-btn--ghost" onClick={() => void removeLogo()} disabled={logoBusy}>
                      Remove
                    </button>
                  ) : null}
                </div>
                <p className="wa-field-note">PNG, JPEG, WebP or SVG, up to 2 MB.</p>
              </div>
              <div className="wa-field">
                <label htmlFor="mission" className="wa-label">
                  What this company is here to do <span style={{ color: "var(--os-ink-2)", fontWeight: 400 }}>(optional)</span>
                </label>
                <textarea
                  id="mission"
                  className="wa-input"
                  rows={3}
                  value={mission}
                  onChange={(e) => setMission(e.target.value)}
                  maxLength={2000}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      void onContinue();
                    }
                  }}
                />
                <p className="wa-field-note">One sentence. It shows on the loading screen for everyone.</p>
              </div>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <div className="wa-field">
                <label htmlFor="inviteEmails" className="wa-label">
                  Email addresses
                </label>
                {chips.length > 0 ? (
                  <div className="wz-chips">
                    {chips.map((c) => (
                      <span key={c.email} className={`wz-chip${c.state === "failed" || c.state === "invalid" ? " is-bad" : c.state === "sent" ? " is-sent" : ""}`}>
                        {c.state === "sending" ? <Dots variant="pending" label="Sending" /> : c.state === "sent" ? <Check size={14} aria-hidden /> : null}
                        {c.email}
                        {c.reason ? <span className="wz-chip__why">{c.reason}</span> : null}
                        {c.state === "sent" || c.state === "sending" ? null : (
                          <button type="button" aria-label={`Remove ${c.email}`} onClick={() => setChips((prev) => prev.filter((x) => x.email !== c.email))}>
                            <X size={12} aria-hidden />
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                ) : null}
                <input
                  id="inviteEmails"
                  className="wa-input"
                  value={draft}
                  placeholder="name@company.com, another@company.com"
                  onChange={(e) => {
                    const v = e.target.value;
                    if (/[\s,;]$/.test(v)) commitDraft(v);
                    else setDraft(v);
                  }}
                  onPaste={(e) => {
                    const text = e.clipboardData.getData("text");
                    if (/[\s,;]/.test(text.trim())) {
                      e.preventDefault();
                      commitDraft(`${draft}${text}`);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && draft.trim()) {
                      e.preventDefault();
                      commitDraft(draft);
                    } else if (e.key === "Backspace" && !draft && chips.length > 0) {
                      const last = chips[chips.length - 1];
                      if (last.state !== "sent" && last.state !== "sending") setChips((prev) => prev.slice(0, -1));
                    }
                  }}
                  onBlur={() => draft.trim() && commitDraft(draft)}
                  autoFocus
                  autoComplete="off"
                />
                <p className="wa-field-note">People outside your company&apos;s email domain are invited from a share dialog, on the thing you share with them.</p>
              </div>
              <div className="wz-grid">
                <div className="wa-field">
                  <span className="wa-label" id="roleLabel">
                    Role
                  </span>
                  <div className="wz-seg" role="group" aria-labelledby="roleLabel">
                    <button type="button" aria-pressed={role === "ADMIN"} onClick={() => setRole("ADMIN")}>
                      Admin
                    </button>
                    <button type="button" aria-pressed={role === "MEMBER"} onClick={() => setRole("MEMBER")}>
                      Member
                    </button>
                  </div>
                  <p className="wz-seg-help">{role === "ADMIN" ? "Runs the workspace day to day." : "Works here."}</p>
                  {role === "MEMBER" ? (
                    <label className="wa-help" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                      <input type="checkbox" className="wz-check" checked={agent} onChange={(e) => setAgent(e.target.checked)} />
                      Agent (frontline caps)
                    </label>
                  ) : null}
                </div>
                <div className="wa-field">
                  <label htmlFor="inviteDept" className="wa-label">
                    Department <span style={{ color: "var(--os-ink-2)", fontWeight: 400 }}>(optional)</span>
                  </label>
                  <select id="inviteDept" className="wa-input" value={inviteDept} onChange={(e) => setInviteDept(e.target.value)}>
                    <option value="">No department</option>
                    {depts.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="wa-field">
                <label htmlFor="inviteMsg" className="wa-label">
                  Personal message <span style={{ color: "var(--os-ink-2)", fontWeight: 400 }}>(optional)</span>
                </label>
                <textarea
                  id="inviteMsg"
                  className="wa-input"
                  rows={3}
                  maxLength={1000}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      void onContinue();
                    }
                  }}
                />
              </div>
            </>
          ) : null}

          {step === 3 ? (
            <>
              <div className="wz-list" role="group" aria-label="Departments">
                {depts.map((d) => {
                  const keep = !unchecked.has(d.id);
                  const blocked = d.members > 0 ? `${d.members} ${d.members === 1 ? "person is" : "people are"} in ${d.name}. Move them first.` : d.goals > 0 ? `${d.goals} goal${d.goals === 1 ? " names" : "s name"} ${d.name}. Change it in Workspace settings > Structure.` : null;
                  return (
                    <div key={d.id} className="wz-list__row">
                      <label>
                        <input
                          type="checkbox"
                          className="wz-check"
                          checked={keep}
                          onChange={(e) => {
                            if (!e.target.checked && blocked) {
                              setDeptWarn((w) => ({ ...w, [d.id]: blocked }));
                              return;
                            }
                            setDeptWarn((w) => {
                              const n = { ...w };
                              delete n[d.id];
                              return n;
                            });
                            setUnchecked((prev) => {
                              const n = new Set(prev);
                              if (e.target.checked) n.delete(d.id);
                              else n.add(d.id);
                              return n;
                            });
                          }}
                        />
                        {d.name}
                      </label>
                      {deptWarn[d.id] ? <span className="wz-list__warn">{deptWarn[d.id]}</span> : null}
                    </div>
                  );
                })}
                {added.map((nm) => (
                  <div key={`add-${nm}`} className="wz-list__row">
                    <label>
                      <input type="checkbox" className="wz-check" checked onChange={() => setAdded((prev) => prev.filter((x) => x !== nm))} />
                      {nm}
                    </label>
                    {deptWarn[`add:${nm}`] ? <span className="wz-list__warn">{deptWarn[`add:${nm}`]}</span> : <span className="wa-help">New</span>}
                  </div>
                ))}
              </div>
              <div className="wz-add">
                <input
                  className="wa-input"
                  aria-label="Add a department"
                  placeholder="Add a department"
                  value={newDept}
                  maxLength={80}
                  onChange={(e) => setNewDept(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const nm = newDept.trim();
                      if (nm && !added.some((x) => x.toLowerCase() === nm.toLowerCase()) && !depts.some((x) => x.name.toLowerCase() === nm.toLowerCase())) setAdded((p) => [...p, nm]);
                      setNewDept("");
                    }
                  }}
                />
                <button
                  type="button"
                  className="wa-btn wa-btn--secondary"
                  onClick={() => {
                    const nm = newDept.trim();
                    if (nm && !added.some((x) => x.toLowerCase() === nm.toLowerCase()) && !depts.some((x) => x.name.toLowerCase() === nm.toLowerCase())) setAdded((p) => [...p, nm]);
                    setNewDept("");
                  }}
                >
                  Add
                </button>
              </div>
              <p className="wa-help">You can change these any time in Workspace settings &gt; Structure.</p>
            </>
          ) : null}

          {step === 4 ? (
            <div className="wz-grid">
              {MODULES.map((m) => {
                const on = !!modulesOn[m.slug];
                return (
                  <div key={m.slug} className="wz-module">
                    <span className="wz-module__icon">
                      <m.Icon size={20} aria-hidden />
                    </span>
                    <span className="wz-module__text">
                      <strong id={`mod-${m.slug}`}>{m.name}</strong>
                      <span className="wa-help">{m.blurb}</span>
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      aria-labelledby={`mod-${m.slug}`}
                      className="wz-switch"
                      disabled={moduleBusy !== null}
                      onClick={() => void toggleModule(m.slug, !on)}
                    />
                  </div>
                );
              })}
            </div>
          ) : null}

          {!online ? (
            <AuthBanner tone="warning">
              <p>You are offline. We will keep what you typed.</p>
            </AuthBanner>
          ) : error ? (
            <AuthBanner tone="danger">
              <p>
                {error}{" "}
                <button type="submit" className="wa-link">
                  Try again
                </button>
              </p>
            </AuthBanner>
          ) : null}

          <div className="wz-foot">
            {step > 1 ? (
              <button type="button" className="wa-btn wa-btn--secondary" onClick={() => { setError(null); setStep((step - 1) as Step); }} disabled={saving}>
                Back
              </button>
            ) : null}
            <div className="wz-foot__right">
              {step < 4 ? (
                <button type="button" className="wa-link wa-link--sm" onClick={() => void onSkip()} disabled={saving || !online}>
                  Skip this step
                </button>
              ) : null}
              <button type="submit" className="wa-btn wa-btn--primary" disabled={!online} data-pending={saving || undefined}>
                {saving ? <Dots variant="pending" label="Saving" /> : null}
                {step === 4 ? "Finish" : "Continue"}
              </button>
            </div>
          </div>
        </form>
      </main>
    </div>
  );
}

/**
 * The frame's WorkspaceMoveStrip for this page (twin of os-shell.tsx; a page
 * file cannot import the frame without bundling all of it). Same rules:
 * shown until dismissed, the dismiss posts to the session endpoint directly
 * (useSession().update() would flip the layout to its loader and reset the
 * wizard), and a failed dismiss keeps it with Retry.
 */
function WorkspaceMoveNotice() {
  const { data } = useSession();
  const move = data?.workspaceMove;
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "failed">("idle");
  if (!move || move.at === dismissedAt) return null;
  const dismiss = async () => {
    setState("saving");
    let ok = false;
    try {
      const csrfToken = await getCsrfToken();
      if (csrfToken) {
        const res = await fetch("/api/auth/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ csrfToken, data: { workspaceMoveAck: move.at } }),
          cache: "no-store",
        });
        const next = res.ok ? ((await res.json().catch(() => null)) as { workspaceMove?: { at?: number } } | null) : null;
        ok = !!next && next.workspaceMove?.at !== move.at;
      }
    } catch {
      ok = false;
    }
    if (ok) {
      void getSession();
      setDismissedAt(move.at);
      setState("idle");
    } else {
      setState("failed");
    }
  };
  return (
    <div style={{ padding: "16px 24px 0", maxWidth: 720, width: "100%", margin: "0 auto" }}>
      <AuthBanner tone="warning">
        <p>
          {move.message}
          {state === "failed" ? " Couldn't dismiss this notice." : null}{" "}
          <button type="button" className="wa-link" onClick={() => void dismiss()} disabled={state === "saving"}>
            {state === "failed" ? "Retry" : "Dismiss"}
          </button>
        </p>
      </AuthBanner>
    </div>
  );
}
