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
import { Check, ChevronDown, MessageSquare, Table as TableIcon, X } from "lucide-react";
import { Logo, LogoLockup } from "@/components/brand/logo";
import { Dots } from "@/components/ui/dots";
import { Picker } from "@/components/ui/picker";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { AuthBanner, FourDotsDrawing } from "@/components/auth/auth-card";
import { useLayerStack } from "@/components/layout/os/shell-context";
import { useViewer } from "@/lib/access/use-access";
import { ORG_ROLE_BLURB } from "@/lib/access/labels";
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
  /** The one email domain invitations may go to (the invitations route's lock), or null when unknown. */
  inviteDomain: string | null;
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

/**
 * Commit typed or pasted text as chips: comma, space, semicolon and newline
 * separate; a repeat is dropped; a bad address stays, in red. An address on
 * another domain is marked the moment it becomes a chip (the invitations
 * route refuses it: outside people are invited from a share dialog), so
 * nobody learns it only after pressing Continue.
 */
function mergeDraft(prev: Chip[], text: string, domain: string | null): Chip[] {
  const parts = text.split(/[\s,;]+/).map((t) => t.trim()).filter(Boolean);
  const next = [...prev];
  for (const p of parts) {
    const lower = p.toLowerCase();
    if (next.some((c) => c.email.toLowerCase() === lower)) continue;
    const ok = EMAIL_RE.test(p);
    if (!ok) {
      next.push({ email: p, state: "invalid", reason: "Not an email address" });
      continue;
    }
    const at = lower.split("@")[1] ?? "";
    if (domain && at !== domain) {
      next.push({ email: p, state: "invalid", reason: `Not @${domain}. Share with them instead` });
      continue;
    }
    next.push({ email: p, state: "draft" });
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
  const viewerEmail = useSession().data?.user?.email ?? null;
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
        const s = (await sRes.json()) as { organization?: { name?: string; logo?: string | null; domain?: string | null }; settings?: { companyProfile?: { mission?: string } | null; console?: unknown } };
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
        // The same lock POST /api/invitations applies: the org's stored
        // domain, else the inviting admin's own.
        const inviteDomain = (s.organization?.domain?.trim() || viewerEmail?.split("@")[1] || "").toLowerCase() || null;
        setLoaded({
          orgName: s.organization?.name ?? "your workspace",
          inviteDomain,
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
  }, [viewer.ready, isAdmin, attempt, viewerEmail]);

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
          {reason === "dismissed" ? (
            <Link href="/settings" className="wa-link wa-link--sm">
              Pick up where you left off
            </Link>
          ) : null}
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
  // What the error banner's "Try again" repeats: the action that failed (a
  // module switch, a logo upload, Finish later), or, when null, the step's
  // own Continue. It used to always submit the form, so a failed Talk switch
  // on step 4 finished setup instead of retrying the switch.
  const retryRef = useRef<(() => void) | null>(null);
  const fail = useCallback((message: string, retry?: () => void) => {
    retryRef.current = retry ?? null;
    setError(message);
  }, []);
  const [done, setDone] = useState<string[] | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  // What this run of the wizard actually wrote, for the Done screen: a line
  // appears only for a write that succeeded, never for a default.
  const [wrote, setWrote] = useState<{ renamed: boolean; mission: boolean; logo: boolean; deptAdded: number; deptRemoved: number; modules: string[] }>({ renamed: false, mission: false, logo: false, deptAdded: 0, deptRemoved: 0, modules: [] });
  const [deptPickerOpen, setDeptPickerOpen] = useState(false);
  const layers = useLayerStack();

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

  // The tab names the workspace (naming-canon "Set up {Org}").
  useEffect(() => {
    document.title = `Set up ${savedName} | WorkwrK`;
  }, [savedName]);

  // Finish later: the dismissal itself, once the person has chosen it.
  const leave = useCallback(async () => {
    setLeaveOpen(false);
    setSaving(true);
    const r = await patchSettings("console", { dismiss: true });
    if (!r.ok) {
      setSaving(false);
      fail(r.error, () => void leave());
      return;
    }
    window.location.assign(WORK_HOME_HREF);
  }, [fail]);

  // The "Finish later" link: straight out when nothing is unsaved, else ask
  // first (in the design system's Dialog, not window.confirm).
  const finishLater = useCallback(() => {
    if (dirty) setLeaveOpen(true);
    else void leave();
  }, [dirty, leave]);

  // Esc never leaves on its own. It closes the top layer (a Picker) first;
  // otherwise it asks, always: a person pressing Esc to clear a field must
  // never lose the wizard for good (a dismissed wizard does not come back).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || leaveOpen) return;
      if (layers && layers.layerCount > 0) {
        e.preventDefault();
        layers.closeTopLayer();
        return;
      }
      setLeaveOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [layers, leaveOpen]);

  async function advance(to: Step) {
    const r = await patchSettings("console", { setupStep: to });
    if (!r.ok) {
      fail(r.error);
      return false;
    }
    setError(null);
    setStep(to);
    window.scrollTo({ top: 0 });
    return true;
  }

  function commitDraft(text: string) {
    setChips((prev) => mergeDraft(prev, text, initial.inviteDomain));
    setDraft("");
  }

  async function saveStep1(): Promise<boolean> {
    if (!name.trim()) {
      fail("The workspace needs a name.");
      return false;
    }
    if (name.trim() !== savedName) {
      const r = await patchSettings("general", { name: name.trim() });
      if (!r.ok) {
        fail(r.error);
        return false;
      }
      setSavedName(name.trim());
      setWrote((w) => ({ ...w, renamed: true }));
    }
    if (mission.trim() !== savedMission.trim()) {
      const r = await patchSettings("culture", { mission: mission.trim() });
      if (!r.ok) {
        fail(r.error);
        return false;
      }
      setSavedMission(mission.trim());
      setWrote((w) => ({ ...w, mission: mission.trim().length > 0 }));
    }
    return true;
  }

  async function saveStep2(): Promise<boolean> {
    const list = draft.trim() ? mergeDraft(chips, draft, initial.inviteDomain) : chips;
    if (draft.trim()) {
      setChips(list);
      setDraft("");
    }
    const pending = list.filter((c) => c.state === "draft" || c.state === "failed");
    if (list.some((c) => c.state === "invalid")) {
      fail("Fix or remove the addresses in red first.");
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
      fail(`${failed} invitation${failed === 1 ? "" : "s"} did not go out. Fix or remove ${failed === 1 ? "it" : "them"}, then continue.`);
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
          setWrote((w) => ({ ...w, deptAdded: w.deptAdded + 1 }));
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
          setWrote((w) => ({ ...w, deptRemoved: w.deptRemoved + 1 }));
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
      fail("Some department changes did not save. They are marked below.");
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
        fail(d.error ? `That did not change: ${d.error}` : "That did not change.", () => void toggleModule(slug, on));
      } else {
        setModulesOn((m) => ({ ...m, [slug]: on }));
        setWrote((w) => ({ ...w, modules: on ? [...w.modules.filter((x) => x !== slug), slug] : w.modules.filter((x) => x !== slug) }));
      }
    } catch {
      fail("Can't reach WorkwrK. Check your connection.", () => void toggleModule(slug, on));
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
          fail(r.error);
          return;
        }
        // Only what this wizard wrote and the server accepted. Invitations
        // are read back from the server, so ones sent before a reload count
        // (pending invites the workspace holds, none of them a claim).
        let pendingInvites = sentCount;
        try {
          const inv = await fetch("/api/invitations", { cache: "no-store" });
          if (inv.ok) {
            const rows = (await inv.json().catch(() => [])) as Array<{ accepted?: boolean; expiresAt?: string }>;
            if (Array.isArray(rows)) pendingInvites = rows.filter((x) => !x.accepted && (!x.expiresAt || Date.parse(x.expiresAt) > Date.now())).length;
          }
        } catch {
          // keep this session's count
        }
        const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
        const lines: string[] = [];
        if (wrote.renamed) lines.push(`Workspace renamed to ${savedName}`);
        if (wrote.logo) lines.push("Logo added");
        if (wrote.mission) lines.push("Mission line saved");
        if (pendingInvites > 0) lines.push(`${plural(pendingInvites, "invitation")} waiting to be accepted`);
        if (wrote.deptAdded > 0) lines.push(`${plural(wrote.deptAdded, "department")} added`);
        if (wrote.deptRemoved > 0) lines.push(`${plural(wrote.deptRemoved, "department")} removed`);
        for (const m of MODULES) if (wrote.modules.includes(m.slug) && modulesOn[m.slug]) lines.push(`${m.name} is on`);
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
    retryRef.current = null;
    try {
      const fd = new FormData();
      fd.append("logo", file);
      const r = await fetch("/api/settings/logo", { method: "POST", body: fd });
      const d = (await r.json().catch(() => ({}))) as { logo?: string; error?: string };
      if (!r.ok || !d.logo) fail(d.error || "The logo did not upload.", () => void uploadLogo(file));
      else {
        setLogo(d.logo);
        setWrote((w) => ({ ...w, logo: true }));
      }
    } catch {
      fail("Can't reach WorkwrK. Check your connection.", () => void uploadLogo(file));
    } finally {
      setLogoBusy(false);
    }
  }

  async function removeLogo() {
    setLogoBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/settings/logo", { method: "DELETE" });
      if (r.ok) {
        setLogo(null);
        setWrote((w) => ({ ...w, logo: false }));
      } else fail("The logo was not removed.", () => void removeLogo());
    } catch {
      fail("Can't reach WorkwrK. Check your connection.", () => void removeLogo());
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
            {done.length > 0 ? (
              <ul>
                {done.map((l) => (
                  <li key={l}>
                    <Check size={16} aria-hidden />
                    {l}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="wa-help">You skipped the steps. {savedName} already has its departments and a General Space to start in.</p>
            )}
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
    3: {
      title: "Create your departments",
      sub: depts.length === 0 ? "Add the departments your company has." : `You have ${depts.length === 1 ? "one" : depts.length}. Keep the ones you use and add your own.`,
    },
    4: { title: "Turn on what you need", sub: "Both are optional and you can turn them on later." },
  };

  return (
    <div className="wz">
      <header className="wz-head">
        <LogoLockup size={20} textColor="var(--os-ink)" />
        <div className="wz-steps" aria-label={`Step ${step} of 4: ${STEP_LABELS[step - 1]}`}>
          <span className="wz-steps__dots" aria-hidden>
            <Dots variant="quad-steps" done={step - 1} total={4} label={`Step ${step} of 4`} />
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
                  <p className="wz-seg-help">{ORG_ROLE_BLURB[role]}</p>
                  {role === "MEMBER" ? (
                    <label className="wa-help" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                      <input type="checkbox" className="wz-check" checked={agent} onChange={(e) => setAgent(e.target.checked)} />
                      Agent (frontline caps)
                    </label>
                  ) : null}
                </div>
                <div className="wa-field">
                  <span className="wa-label" id="inviteDeptLabel">
                    Department <span style={{ color: "var(--os-ink-2)", fontWeight: 400 }}>(optional)</span>
                  </span>
                  <div className="wz-pick">
                    <button
                      type="button"
                      id="inviteDept"
                      className="wa-input wz-pick__trigger"
                      aria-labelledby="inviteDeptLabel inviteDept"
                      aria-haspopup="listbox"
                      aria-expanded={deptPickerOpen}
                      onClick={() => setDeptPickerOpen((v) => !v)}
                    >
                      <span className={inviteDept ? undefined : "wz-pick__none"}>{depts.find((d) => d.id === inviteDept)?.name ?? "No department"}</span>
                      <ChevronDown size={16} aria-hidden />
                    </button>
                    <Picker
                      open={deptPickerOpen}
                      onClose={() => setDeptPickerOpen(false)}
                      ariaLabel="Department"
                      searchPlaceholder="Search departments"
                      selected={inviteDept || "__none__"}
                      sections={[{ options: [{ value: "__none__", label: "No department" }, ...depts.map((d) => ({ value: d.id, label: d.name }))] }]}
                      onSelect={(v) => {
                        setDeptPickerOpen(false);
                        setInviteDept(v === "__none__" ? "" : v);
                      }}
                      className="absolute start-0 top-10 z-50"
                    />
                  </div>
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
                <button
                  type="button"
                  className="wa-link"
                  onClick={() => {
                    const retry = retryRef.current;
                    retryRef.current = null;
                    setError(null);
                    if (retry) retry();
                    else void onContinue();
                  }}
                >
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

      <Dialog open={leaveOpen} onOpenChange={(o) => { if (!o) setLeaveOpen(false); }}>
        <DialogContent className="workwrk-auth wz-leave max-w-[420px]">
          <DialogTitle className="wz-leave__title">Leave setup?</DialogTitle>
          <p className="wa-help">
            {dirty ? "What you typed on this step is not saved yet. " : ""}The remaining steps move to Workspace settings, where you can finish them any time.
          </p>
          <div className="wz-leave__actions">
            <button type="button" className="wa-btn wa-btn--secondary" onClick={() => setLeaveOpen(false)}>
              Stay
            </button>
            <button type="button" className="wa-btn wa-btn--primary" onClick={() => void leave()}>
              Finish later
            </button>
          </div>
        </DialogContent>
      </Dialog>
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
