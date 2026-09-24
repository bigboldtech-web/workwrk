"use client";

/* /forms/[id] (spec-tables-forms section 2): build the form, decide what
 * happens when someone answers, and read the answers.
 *
 *   title row 48   BackButton (the List or table it goes to, else Forms), the
 *                  neutral ClipboardList tile, the name (inline, 22/600), the
 *                  AutosaveIndicator, the star; right: the public-link glyph,
 *                  ShareOrRoleChip, the bordered "..." (FormRowMenu)
 *   views row 36   Build · Settings · Responses (live count), ?tab=
 *   toolbar 44     Preview (?preview=1, Cmd+E); on Responses, Sort. Right:
 *                  Copy link fused to a split (the embed code, when the public
 *                  link is on), the bordered "..." (Build: Display; Responses:
 *                  Export as CSV, Delete all responses). No blue button: the
 *                  builder creates nothing.
 *   Build          the form header card (title, description), FormFieldCards
 *                  (grip, type chip, label, help text, options, Required,
 *                  "..."), "+ Add a field" (the Picker: every question type,
 *                  and the List's or table's own fields to map to), the Goes
 *                  to card and the field mapping card
 *   Settings       the form's own settings bucket (FormSettingsTab)
 *   Responses      FormResponsesTab (TableCard, the ?response= drawer, paging)
 *
 * SAVING (data integrity is paramount): there is no Save button. Every edit
 * autosaves through useAutosave (1s after the last keystroke) with a
 * localStorage backup, the PATCH rides fetchWithRetry (keepalive, three tries
 * on a network error or a 5xx), a failure is surfaced as "Not saved" with a
 * Retry and the typed text stays on screen, and useDirtyGuard is armed while
 * a save is pending, in flight or failed, so leaving asks first. A backup
 * newer than the server copy is offered back on the next open.
 *
 *   GET   /api/forms/[id]
 *   PATCH /api/forms/[id] { name, description, fields, targetBoardId,
 *                           targetTableId, fieldMappings, settings }
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowUpDown, Check, ChevronDown, ClipboardList, Code2, Copy, Download, Eye, FileText, Globe, Link2, ListFilter, Lock,
  MoreHorizontal, Plus, Settings2, Trash2, X,
} from "lucide-react";
import { Breadcrumb } from "@/components/layout/os/top-bar/breadcrumb";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { MorePortal } from "@/components/layout/os/more-portal";
import { useOsShell } from "@/components/layout/os/shell-context";
import { useOsToast } from "@/components/layout/os/toast";
import { useConfirm, usePrompt } from "@/components/ui/dialog-provider";
import { BackButton } from "@/components/ui/back-button";
import { EntityTile, NEUTRAL_TILE } from "@/components/ui/entity-tile";
import { AutosaveIndicator } from "@/components/ui/autosave-indicator";
import { ViewTab, ViewTabStrip } from "@/components/ui/view-tabs";
import { MenuItem, MenuList, MenuSectionLabel, MenuSeparator } from "@/components/ui/menu";
import { Picker, type PickerSectionDef } from "@/components/ui/picker";
import { Drawer } from "@/components/ui/drawer";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useShowUpcoming } from "@/components/ui/coming-soon-row";
import { StrippedViewNotice } from "@/components/access/denial-views";
import { NotFoundView } from "@/components/access/not-found-view";
import { ReadOnlyBanner } from "@/components/access/read-only-banner";
import { ShareOrRoleChip, type ShareChipRole } from "@/components/access/share-or-role-chip";
import { ObjectShareDialog, embedSnippet, objectLink } from "@/components/tables/object-share-dialog";
import { FormRowMenu, dispatchFormsChanged } from "@/components/forms/form-row-menu";
import { FormFavoriteButton } from "@/components/forms/form-favorite-button";
import { FieldTypeIcon, FormFieldCard } from "@/components/forms/form-field-card";
import { GoesToCard, MappingCard, useDestinationColumns, type Destination, type FieldMappings } from "@/components/forms/form-destination-card";
import { FormSettingsTab, type Person } from "@/components/forms/form-settings-tab";
import { FormResponsesTab } from "@/components/forms/form-responses-tab";
import { FormRenderer } from "@/components/forms/form-renderer";
import { useAutosave, readAutosaveBackup, clearAutosaveBackup } from "@/hooks/use-autosave";
import { useDirtyGuard } from "@/hooks/use-dirty-guard";
import { confirmLeave, setLeaveConfirmer } from "@/lib/dirty-guard";
import { apiFetch } from "@/lib/api-fetch";
import { useFormat } from "@/lib/format/use-date-prefs";
import { fetchWithRetry } from "@/lib/fetch-retry";
import { downloadUrl } from "@/lib/download";
import { readFormsShowFieldNumbers, readFormsShowHelpText } from "@/lib/tables-prefs";
import {
  FORM_FIELD_TYPES, changeFieldType, duplicateFieldAt, fieldFromDestination, fieldTypeLabel, moveFieldTo, newField,
  questionNumbers, questionTypeForColumn, questionTypeForListField,
} from "@/lib/forms/builder";
import { readFormFields, type FormAnswers, type FormField, type FormFieldType } from "@/lib/forms/fields";
import { DEFAULT_FORM_SETTINGS, isFormClosed, normalizeRedirectInput, readFormSettings, type FormSettings } from "@/lib/forms/settings";
import { cn } from "@/lib/utils";

type Tab = "build" | "settings" | "responses";

type ApiForm = {
  id: string;
  name: string;
  description?: string | null;
  fields: unknown;
  isPublic: boolean;
  targetBoardId?: string | null;
  targetTableId?: string | null;
  fieldMappings?: FieldMappings | null;
  settings?: unknown;
  submissionCount: number;
  updatedAt: string;
  /** The builder's content revision, sent back as expectRev (lib/forms/content-rev). */
  contentRev?: string;
  destinations?: { list: Destination | null; table: Destination | null };
  owner?: { name: string | null } | null;
  notifyPeople?: Record<string, Person>;
  canEdit?: boolean;
  canRespond?: boolean;
  canManage?: boolean;
  canReadResponses?: boolean;
  isAgent?: boolean;
  publicLinksAllowed?: boolean;
  dailySummaryAvailable?: boolean;
};

/** Everything the autosave writes. */
type Draft = {
  name: string;
  description: string;
  fields: FormField[];
  targetBoardId: string | null;
  targetTableId: string | null;
  fieldMappings: FieldMappings;
  settings: FormSettings;
};

const TB_BTN = "inline-flex h-9 items-center gap-1.5 rounded-md border border-line-strong px-3 text-base font-medium text-ink hover:bg-hover";

function draftFrom(f: ApiForm): Draft {
  const fm = f.fieldMappings && typeof f.fieldMappings === "object" ? f.fieldMappings : {};
  return {
    name: f.name ?? "",
    description: f.description ?? "",
    fields: readFormFields(f.fields),
    targetBoardId: f.targetBoardId ?? null,
    targetTableId: f.targetTableId ?? null,
    fieldMappings: { board: { ...(fm.board ?? {}) }, table: { ...(fm.table ?? {}) } },
    settings: readFormSettings(f.settings),
  };
}

export default function FormBuilderPage() {
  const router = useRouter();
  const pathname = usePathname() || "";
  const searchParams = useSearchParams();
  const formId = pathname.split("/")[2] ?? "";
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const { prefs, patchPrefs } = useOsShell();
  const showUpcoming = useShowUpcoming();
  const tablesOn = Array.isArray(prefs.modules?.activeAppKeys) && prefs.modules.activeAppKeys.includes("tables");
  const showHelpText = readFormsShowHelpText(prefs.home);
  const showFieldNumbers = readFormsShowFieldNumbers(prefs.home);

  const [form, setForm] = useState<ApiForm | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [listDest, setListDest] = useState<Destination | null>(null);
  const [tableDest, setTableDest] = useState<Destination | null>(null);
  const [backup, setBackup] = useState<{ at: number; data: Draft } | null>(null);
  const fmt = useFormat();
  // A restored backup is applied only AFTER autosave has taken the server
  // copy as its baseline, so the restored changes are saved, not adopted.
  const [restore, setRestore] = useState<Draft | null>(null);
  const [responseTotal, setResponseTotal] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  // The Responses toolbar's Filter (answers, or the sender's name or email).
  const [responseFilter, setResponseFilter] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [titleMoreOpen, setTitleMoreOpen] = useState(false);
  const [embedOpen, setEmbedOpen] = useState(false);
  const [shareMode, setShareMode] = useState<"share" | "who" | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [previewAnswers, setPreviewAnswers] = useState<FormAnswers>({});
  const [strippedNotice, setStrippedNotice] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const titleMoreRef = useRef<HTMLButtonElement>(null);
  const embedRef = useRef<HTMLButtonElement>(null);
  const saveErrorShown = useRef(false);
  const lastSaveOk = useRef<boolean | null>(null);
  // The concurrency guard (lib/forms/content-rev): the revision of the copy
  // this tab last read or wrote, sent as expectRev on every save. A 409 means
  // the builder's content changed somewhere else (another tab, a co-editor);
  // `conflict` then holds the stored revision, the builder locks with the
  // person's own draft still on screen, and nothing is written until they
  // choose "Keep mine" (save over it) or "Load theirs".
  const revRef = useRef<string | null>(null);
  const conflictRef = useRef<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  // Settings > After someone answers > Link, as typed. Held here, not in the
  // tab, so it survives a switch to Build and back, and so text that is not a
  // web address (which never reaches the draft, so autosave never sees it)
  // still holds the leave guard: nothing typed is dropped without a question.
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const linkInvalid = linkDraft !== null && linkDraft.trim() !== "" && normalizeRedirectInput(linkDraft) === null;
  const linkInvalidRef = useRef(false);
  useEffect(() => { linkInvalidRef.current = linkInvalid; }, [linkInvalid]);
  // True while a PATCH is running. flushNow cannot join a save already in
  // flight (it only queues a redo and returns), so the leave path waits on
  // this before it flushes and reads the result.
  const savingRef = useRef(false);

  const backupKey = formId ? `workwrk:form-builder:${formId}` : undefined;

  /* ───────────────────────────── load ───────────────────────────── */

  const load = useCallback(async () => {
    if (!formId) return;
    setLoadError(null);
    const r = await apiFetch<ApiForm>(`/api/forms/${formId}`, { cache: "no-store" });
    if (!r.ok) { console.warn(`form load failed: HTTP ${r.status}`); setLoadError(r.status === 404 ? "missing" : "error"); return; }
    const f = r.data;
    revRef.current = f.contentRev ?? null;
    setForm(f);
    setDraft(draftFrom(f));
    setLinkDraft(null);
    setListDest(f.destinations?.list ?? null);
    setTableDest(f.destinations?.table ?? null);
    setResponseTotal(f.submissionCount);
    // A local copy newer than the server's, and different from it, is work
    // that never reached the server (a closed tab, a lost connection).
    if (backupKey) {
      // No timestamp test: the copy is removed after every save that lands,
      // so one still here is always work that did not reach the server, even
      // when someone else saved the form later (a save refused as
      // form_changed, then the tab closed). It is offered, never dropped.
      const b = readAutosaveBackup<Draft>(backupKey);
      if (b && b.data && JSON.stringify(b.data) !== JSON.stringify(draftFrom(f))) setBackup(b);
      else if (b) clearAutosaveBackup(backupKey);
    }
  }, [formId, backupKey]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);

  const canEdit = !!form?.canEdit;
  const canManage = !!form?.canManage;
  const canReadResponses = !!form?.canReadResponses;

  /* ─────────────────────────── the tab ─────────────────────────── */

  const rawTab = searchParams.get("tab");
  const tab: Tab = rawTab === "settings" ? "settings" : rawTab === "responses" && (canReadResponses || !form) ? "responses" : "build";
  const setTab = useCallback((t: Tab) => {
    const next = new URLSearchParams(searchParams.toString());
    if (t === "build") next.delete("tab"); else next.set("tab", t);
    next.delete("response");
    const qs = next.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [router, pathname, searchParams]);
  // ?tab=responses for someone who cannot read responses: the default view,
  // the parameter stripped, one notice line (access 5.5 rule 4).
  useEffect(() => {
    if (!form || rawTab !== "responses" || canReadResponses) return;
    const t = setTimeout(() => { setStrippedNotice(true); setTab("build"); }, 0);
    return () => clearTimeout(t);
  }, [form, rawTab, canReadResponses, setTab]);

  // ?new=1 from every create door: select the name, then drop the flag.
  useEffect(() => {
    if (!draft || searchParams.get("new") !== "1") return;
    const t = setTimeout(() => {
      titleRef.current?.focus();
      titleRef.current?.select();
      const next = new URLSearchParams(searchParams.toString());
      next.delete("new");
      const qs = next.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    }, 50);
    return () => clearTimeout(t);
  }, [draft, searchParams, router, pathname]);

  const previewOpen = searchParams.get("preview") === "1";
  const setPreview = useCallback((on: boolean) => {
    const next = new URLSearchParams(searchParams.toString());
    if (on) next.set("preview", "1"); else next.delete("preview");
    const qs = next.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [router, pathname, searchParams]);

  // Cmd+E opens Preview.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        setPreview(!previewOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewOpen, setPreview]);

  /* ─────────────────────────── saving ─────────────────────────── */

  const save = useCallback(async (d: Draft) => {
    // Refused as form_changed and not yet resolved: write nothing, stay "Not
    // saved" (the banner says why and offers the two ways out).
    if (conflictRef.current) throw new Error("form_changed");
    const res = await fetchWithRetry(`/api/forms/${formId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        name: d.name.trim() || "Untitled form",
        description: d.description.trim() ? d.description : null,
        fields: d.fields,
        targetBoardId: d.targetBoardId,
        targetTableId: d.targetTableId,
        fieldMappings: d.fieldMappings,
        settings: d.settings,
        ...(revRef.current ? { expectRev: revRef.current } : {}),
      }),
    });
    if (!res.ok) {
      lastSaveOk.current = false;
      const body = await res.json().catch(() => null) as { error?: string; contentRev?: string } | null;
      if (res.status === 409 && body?.error === "form_changed") {
        conflictRef.current = body.contentRev ?? "changed";
        setConflict(conflictRef.current);
        throw new Error("form_changed");
      }
      if (!saveErrorShown.current) {
        saveErrorShown.current = true;
        toast(res.status === 401 ? "You are signed out. Sign in and press Retry; your changes are kept." : body?.error || "Couldn't save the form", { tone: "danger" });
      }
      throw new Error(`HTTP ${res.status}`);
    }
    saveErrorShown.current = false;
    lastSaveOk.current = true;
    const out = await res.json().catch(() => null) as { name?: string; contentRev?: string } | null;
    if (out?.contentRev) revRef.current = out.contentRev;
    if (out) dispatchFormsChanged();
  }, [formId, toast]);

  const { status, lastSavedAt, flushNow } = useAutosave<Draft | null>({
    snapshot: draft,
    save: async (d) => {
      if (!d) return;
      savingRef.current = true;
      // A save that THROWS (offline: fetchWithRetry gives up; a refusal
      // already pending as form_changed) never reaches save()'s own
      // `lastSaveOk = false`, and the leave path would read that as saved.
      try { await save(d); } catch (e) { lastSaveOk.current = false; throw e; } finally { savingRef.current = false; }
    },
    enabled: !!draft && canEdit && !backup,
    delay: 1000,
    localKey: backupKey,
  });
  // A Link that is not a web address counts as pending: it is typed and not
  // saved, so leaving must ask (see linkDraft above).
  const pending = status === "dirty" || status === "saving" || status === "error" || linkInvalid;
  useEffect(() => { statusRef.current = status; }, [status]);
  // "Save" from the leave guard: flush, and report whether THAT save landed
  // (save() records it; nothing to flush counts as saved).
  const onGuardSave = useCallback(async () => {
    lastSaveOk.current = null;
    await flushNow();
    return lastSaveOk.current !== false;
  }, [flushNow]);
  useDirtyGuard(pending, { onSave: onGuardSave, id: `form-builder-${formId}` });
  // In-app navigation asks too. useDirtyGuard covers closing the tab; a click
  // on any link in the app (the sidebar, the breadcrumb, the BackButton's
  // anchor) while a save is pending, in flight or failed goes through the
  // registry's confirmLeave first, on the app's own dialog: "Save and leave"
  // runs the flush and stays put if it fails. The local copy survives either
  // way and is offered back on the next open.
  //
  // While saving is FAILING (offline, signed out, a lasting refusal), "Save
  // and leave" could only fail again and keep the person here with no way
  // out through the app. So that dialog offers "Leave anyway" instead: the
  // copy on this device is already written and is offered back on the next
  // open, so leaving loses nothing.
  //
  // Save first, ask second. The autosave timer keeps running behind a modal,
  // so a dialog opened on "not saved" went on saying so after the header had
  // turned to "Saved". Now a guarded leave flushes straight away and, when
  // that save lands, just leaves: there is nothing left to ask about. Only a
  // save that fails (or is refused as changed elsewhere) asks, and it asks
  // with the failure dialog, which matches the header's "Not saved".
  const statusRef = useRef<string>("idle");
  useEffect(() => {
    const waitForSave = async () => {
      for (let i = 0; i < 150 && savingRef.current; i++) await new Promise((r) => setTimeout(r, 100));
    };
    setLeaveConfirmer(async () => {
      if (linkInvalidRef.current) {
        const leave = await confirm({
          title: "The link is not saved",
          description: "What is typed in Settings under Link is not a web address, so it cannot be saved. Stay and fix it, or leave without it.",
          confirmLabel: "Leave without it",
          cancelLabel: "Fix the link",
          destructive: false,
        });
        if (!leave) return "stay";
      }
      if (statusRef.current !== "error" && !conflictRef.current) {
        await waitForSave();
        // Still running after 15 seconds: fall through to the question below.
        if (!savingRef.current) {
          const saved = await onGuardSave();
          // "discard" here only means "leave now": every change reached the
          // server, so nothing is discarded.
          if (saved && !conflictRef.current) return "discard";
          statusRef.current = "error";
        }
      }
      if (statusRef.current === "error" || conflictRef.current) {
        const leave = await confirm({
          title: "This form's latest changes could not be saved",
          description: "They are kept on this device and offered back the next time you open this form. Leave now, or stay and press Retry.",
          confirmLabel: "Leave anyway",
          cancelLabel: "Keep editing",
          destructive: false,
        });
        return leave ? "discard" : "stay";
      }
      const ok = await confirm({
        title: "This form has changes that are not saved",
        description: "Save them now, or stay and keep editing. A copy is kept on this device either way.",
        confirmLabel: "Save and leave",
        cancelLabel: "Keep editing",
        destructive: false,
      });
      return ok ? "save" : "stay";
    });
    return () => setLeaveConfirmer(null);
  }, [confirm, onGuardSave]);
  useEffect(() => {
    if (!pending) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      e.preventDefault();
      e.stopPropagation();
      void confirmLeave().then((ok) => { if (ok) router.push(url.pathname + url.search + url.hash); });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [pending, router]);
  // Declared after useAutosave on purpose: effects run in order, so by the
  // time this applies the restored draft the baseline is the server copy.
  useEffect(() => {
    if (!restore) return;
    const t = setTimeout(() => { setDraft(restore); setRestore(null); }, 0);
    return () => clearTimeout(t);
  }, [restore]);

  // Belt and braces for the lock below: while the unsent-changes banner is up
  // (or the viewer cannot edit) no edit path changes the draft, whatever
  // control it came from, so nothing is typed that autosave would not save.
  const editLockRef = useRef(false);
  useEffect(() => { editLockRef.current = !canEdit || !!backup || !!conflict; }, [canEdit, backup, conflict]);
  const patch = useCallback((p: Partial<Draft>) => { if (editLockRef.current) return; setDraft((d) => (d ? { ...d, ...p } : d)); }, []);
  const patchSettings = useCallback((p: Partial<FormSettings>) => { if (editLockRef.current) return; setDraft((d) => (d ? { ...d, settings: { ...d.settings, ...p } } : d)); }, []);
  // Settings > "Accept responses from people without an account" (D16). A
  // Full access holder only (the tab shows the value to everyone else), and
  // turning it on asks first, naming exactly what it opens.
  const toggleAnonymous = useCallback(async (on: boolean) => {
    if (on) {
      const ok = await confirm({
        title: "Accept responses from people without an account?",
        description: "Anyone with this form's public link can send it without signing in. They can only add a response: they never see where the answers go or any answer already sent.",
        confirmLabel: "Turn on",
        cancelLabel: "Cancel",
        destructive: false,
      });
      if (!ok) return;
    }
    patchSettings({ acceptAnonymous: on });
  }, [confirm, patchSettings]);
  const patchField = useCallback((id: string, p: Partial<FormField>) => {
    if (editLockRef.current) return;
    setDraft((d) => (d ? { ...d, fields: d.fields.map((f) => (f.id === id ? { ...f, ...p } : f)) } : d));
  }, []);

  /* ─────────────────────────── fields ─────────────────────────── */

  const { listFields, tableColumns } = useDestinationColumns(draft?.targetBoardId ?? null, draft?.targetTableId ?? null);
  const numbers = useMemo(() => (draft ? questionNumbers(draft.fields) : new Map<string, number>()), [draft]);
  const hasResponses = (responseTotal ?? form?.submissionCount ?? 0) > 0;

  function addField(type: FormFieldType) {
    const f = newField(type);
    setDraft((d) => (d ? { ...d, fields: [...d.fields, f] } : d));
    setAddOpen(false);
    setTimeout(() => {
      const el = document.querySelector<HTMLInputElement>(`[data-field-id="${f.id}"] input`);
      el?.focus();
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 30);
  }

  /** A question bound to an existing List field or table column. */
  function addMappedField(kind: "board" | "table", key: string) {
    if (!draft) return;
    let f: FormField | null = null;
    if (kind === "board") {
      const lf = listFields.find((x) => x.key === key);
      const t = lf ? questionTypeForListField(lf.type) : null;
      if (lf && t) f = fieldFromDestination({ label: lf.label, type: t, options: lf.choices });
    } else {
      const tc = tableColumns.find((x) => x.id === key);
      const t = tc ? questionTypeForColumn(tc.type) : null;
      if (tc && t) f = fieldFromDestination({ label: tc.label, type: t, options: tc.options });
    }
    if (!f) return;
    const field = f;
    setDraft((d) => d ? {
      ...d,
      fields: [...d.fields, field],
      fieldMappings: { ...d.fieldMappings, [kind]: { ...(d.fieldMappings[kind] ?? {}), [field.id]: key } },
    } : d);
    setAddOpen(false);
  }

  async function changeType(field: FormField, to: FormFieldType) {
    const { field: next, loses } = changeFieldType(field, to);
    if (loses || hasResponses) {
      const ok = await confirm({
        title: `Change to ${fieldTypeLabel(to)}?`,
        description: [
          loses ? `"${field.label || "This field"}" loses ${loses}.` : null,
          hasResponses ? "Answers already sent keep the values they were given." : null,
        ].filter(Boolean).join(" "),
        confirmLabel: "Change type",
        destructive: false,
      });
      if (!ok) return;
    }
    setDraft((d) => (d ? { ...d, fields: d.fields.map((f) => (f.id === field.id ? next : f)) } : d));
  }

  async function deleteField(field: FormField) {
    if (hasResponses) {
      const ok = await confirm({
        title: `Delete "${field.label || "this field"}"?`,
        description: "Answers already sent to it stay in each response's stored data, but the Responses tab and the CSV stop showing them.",
        destructive: true,
        confirmLabel: "Delete field",
      });
      if (!ok) return;
    }
    setDraft((d) => {
      if (!d) return d;
      const board = { ...(d.fieldMappings.board ?? {}) };
      const table = { ...(d.fieldMappings.table ?? {}) };
      delete board[field.id];
      delete table[field.id];
      return { ...d, fields: d.fields.filter((f) => f.id !== field.id), fieldMappings: { board, table } };
    });
  }

  async function changeDestination(next: { list?: Destination | null; table?: Destination | null }) {
    if (!draft) return;
    const clears: string[] = [];
    if ("list" in next && Object.keys(draft.fieldMappings.board ?? {}).length && (next.list?.id ?? null) !== draft.targetBoardId) clears.push(listDest?.name || "the List");
    if ("table" in next && Object.keys(draft.fieldMappings.table ?? {}).length && (next.table?.id ?? null) !== draft.targetTableId) clears.push(tableDest?.name || "the table");
    if (clears.length) {
      const ok = await confirm({ title: "Change where answers go?", description: `The field mapping for ${clears.join(" and ")} is cleared. Responses already sent stay where they went.`, confirmLabel: "Change", destructive: false });
      if (!ok) return;
    }
    setDraft((d) => {
      if (!d) return d;
      const out = { ...d, fieldMappings: { ...d.fieldMappings } };
      if ("list" in next) {
        if ((next.list?.id ?? null) !== d.targetBoardId) out.fieldMappings.board = {};
        out.targetBoardId = next.list?.id ?? null;
      }
      if ("table" in next) {
        if ((next.table?.id ?? null) !== d.targetTableId) out.fieldMappings.table = {};
        out.targetTableId = next.table?.id ?? null;
      }
      return out;
    });
    if ("list" in next) setListDest(next.list ?? null);
    if ("table" in next) setTableDest(next.table ?? null);
  }

  /* ─────────────────────────── links ─────────────────────────── */

  function copyLink() {
    void navigator.clipboard?.writeText(objectLink("form", formId)).then(() => toast("Link copied"), () => toast("Couldn't copy", { tone: "danger" }));
  }
  const publicLive = !!form?.isPublic && form.publicLinksAllowed !== false;

  async function deleteAllResponses() {
    if (!form || !draft) return;
    setMoreOpen(false);
    const name = (draft.name.trim() || "Untitled form");
    const typed = await prompt({
      title: "Delete every response?",
      description: `This removes all ${responseTotal ?? form.submissionCount} responses from this form and cannot be undone. Tasks and table rows they created stay where they are. Type the form's name, ${name}, to confirm.`,
      placeholder: name,
      submitLabel: "Delete all responses",
      required: true,
    });
    if (typed === null) return;
    if (typed.trim() !== name) { toast("The name did not match. Nothing was deleted."); return; }
    const r = await apiFetch<{ deleted: number }>(`/api/forms/${formId}/responses`, { method: "DELETE", json: { confirm: typed.trim() } });
    if (!r.ok) { toast(r.error || "Couldn't delete the responses", { tone: "danger" }); return; }
    toast(`Deleted ${r.data.deleted} response${r.data.deleted === 1 ? "" : "s"}`);
    setResponseTotal(0);
    router.replace(`${pathname}?tab=responses&r=${Date.now()}`, { scroll: false });
  }

  /* ─────────────────────────── render ─────────────────────────── */

  // A wrong id and a form this person may not see are the SAME in-shell 404
  // (access 5.5 rule 2: pixel-identical, never a hint that something is
  // there), the one every other detail route renders.
  if (loadError === "missing") {
    return (
      <div className="os-chrome flex min-h-0 flex-1 flex-col bg-app">
        <NotFoundView />
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="os-chrome flex min-h-0 flex-1 flex-col bg-app">
        <Breadcrumb items={[{ label: "Forms", href: "/forms" }]} />
        <OsEmptyView variant="error" title="We could not load this form." action={{ label: "Retry", onClick: () => void load() }} />
      </div>
    );
  }
  if (!form || !draft) {
    return (
      <div className="os-chrome flex min-h-0 flex-1 flex-col bg-app" aria-busy="true">
        <div className="h-12" />
        <div className="mx-auto w-full max-w-[720px] px-6 py-6"><SkeletonRows rows={5} /></div>
      </div>
    );
  }

  const displayName = draft.name.trim() || "Untitled form";
  const primaryDest = listDest ?? tableDest;
  const role: ShareChipRole = canManage ? "FULL" : canEdit ? "EDIT" : "VIEW";
  const readOnly = !canEdit;
  // While the "changes that never reached the server" banner is up, autosave
  // is off (useAutosave enabled: !backup), so the builder is locked too:
  // anything typed now would not be saved, would not arm the leave guard,
  // and "Restore them" would overwrite it. Restore or Discard unlocks it.
  // A save refused as form_changed locks it the same way until the person
  // picks Keep mine or Load theirs.
  const locked = readOnly || !!backup || !!conflict;
  const closed = isFormClosed(draft.settings);

  const addSections: PickerSectionDef[] = [
    { label: "Question types", options: FORM_FIELD_TYPES.map((d) => ({ value: `t:${d.type}`, label: d.label, glyph: <FieldTypeIcon type={d.type} /> })) },
  ];
  const mappedBoard = new Set(Object.values(draft.fieldMappings.board ?? {}));
  const mappedTable = new Set(Object.values(draft.fieldMappings.table ?? {}));
  const listOpts = listFields.filter((f) => questionTypeForListField(f.type) && !mappedBoard.has(f.key));
  const tableOpts = tableColumns.filter((c) => questionTypeForColumn(c.type) && !mappedTable.has(c.id));
  if (listDest && listOpts.length) addSections.push({ label: `Fields on ${listDest.name}`, options: listOpts.map((f) => ({ value: `b:${f.key}`, label: f.label, description: fieldTypeLabel(questionTypeForListField(f.type) ?? "short_text") })) });
  if (tableDest && tableOpts.length) addSections.push({ label: `Columns of ${tableDest.name}`, options: tableOpts.map((c) => ({ value: `c:${c.id}`, label: c.label, description: fieldTypeLabel(questionTypeForColumn(c.type) ?? "short_text") })) });

  return (
    <div className="os-chrome flex min-h-0 flex-1 flex-col bg-app">
      <Breadcrumb items={[{ label: "Forms", href: "/forms" }, { label: displayName }]} />

      {/* ── Title row 48 ── */}
      <header className="flex h-12 shrink-0 items-center gap-2 px-4">
        <BackButton fallbackHref={primaryDest?.href ?? "/forms"} label={(primaryDest?.href && primaryDest.name) || "Forms"} />
        <EntityTile size="lg" name={displayName} fallback="form" {...NEUTRAL_TILE} />
        <input
          ref={titleRef}
          value={draft.name}
          onChange={(e) => patch({ name: e.target.value })}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          onBlur={(e) => { if (!e.target.value.trim()) patch({ name: "Untitled form" }); }}
          placeholder="Untitled form"
          aria-label="Form name"
          readOnly={locked}
          maxLength={200}
          className="h-8 min-w-[120px] max-w-[420px] flex-1 truncate rounded-md border border-transparent bg-transparent px-1.5 text-xl font-semibold text-ink hover:border-line focus:border-brand focus:outline-none read-only:hover:border-transparent"
        />
        <AutosaveIndicator status={status} lastSavedAt={lastSavedAt} onRetry={status === "error" ? () => void flushNow() : undefined} />
        {linkInvalid ? (
          <button
            type="button"
            onClick={() => setTab("settings")}
            title="The link under Settings, After someone answers, is not a web address. Fix it or it is lost when you leave."
            className="shrink-0 text-sm font-medium text-danger-text hover:underline"
          >
            Link not saved
          </button>
        ) : null}
        <FormFavoriteButton formId={formId} />
        <span className="flex-1" />
        <span className="inline-flex text-ink-2" title={publicLive ? "Public link is on" : "Only people in this workspace can open it"}>
          {publicLive ? <Globe className="h-3.5 w-3.5" strokeWidth={1.5} aria-label="Public link is on" /> : <Lock className="h-3.5 w-3.5" strokeWidth={1.5} aria-label="No public link" />}
        </span>
        <ShareOrRoleChip role={role} onOpen={(m) => setShareMode(m)} className="max-[900px]:hidden" />
        <button
          ref={titleMoreRef}
          type="button"
          onClick={() => setTitleMoreOpen((o) => !o)}
          aria-label="Form actions"
          aria-haspopup="menu"
          aria-expanded={titleMoreOpen}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-line-strong text-ink-2 hover:bg-hover hover:text-ink"
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden />
        </button>
      </header>
      {titleMoreOpen ? (
        <MorePortal anchorRef={titleMoreRef} width={260} open placement="below" onClose={() => setTitleMoreOpen(false)}>
          <FormRowMenu
            form={{ id: formId, name: displayName, isPublic: form.isPublic, canManage, publicLinksAllowed: form.publicLinksAllowed !== false, responseCount: responseTotal ?? form.submissionCount, destinationName: primaryDest?.name ?? null, ownerName: form.owner?.name ?? null }}
            context="builder"
            onClose={() => setTitleMoreOpen(false)}
            onShare={() => setShareMode(canManage ? "share" : "who")}
            onRenameInline={() => { titleRef.current?.focus(); titleRef.current?.select(); }}
            onChanged={(kind, next) => { if (kind === "public" && next && typeof next.isPublic === "boolean") setForm((f) => (f ? { ...f, isPublic: !!next.isPublic } : f)); }}
          />
        </MorePortal>
      ) : null}

      {readOnly ? (
        // "Open the form to answer it" rides the banner's one text link, and
        // only for someone the responder would let send it (canRespond).
        <ReadOnlyBanner
          ownerName={form.owner?.name ?? null}
          className="mx-4"
          onRequest={form.canRespond ? () => { window.location.assign(`/forms/${formId}/respond`); } : undefined}
          requestLabel="Open the form to answer it"
        />
      ) : null}

      {/* ── Views row 36 ── */}
      <div className="px-4" onKeyDown={(e) => {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        if (e.key === "1") setTab("build");
        if (e.key === "2") setTab("settings");
        if (e.key === "3" && canReadResponses) setTab("responses");
      }}>
        <ViewTabStrip aria-label="Form sections">
          <ViewTab icon={FileText} label="Build" active={tab === "build"} onClick={() => setTab("build")} />
          <ViewTab icon={Settings2} label="Settings" active={tab === "settings"} onClick={() => setTab("settings")} />
          {canReadResponses ? (
            <ViewTab
              icon={ClipboardList}
              label="Responses"
              active={tab === "responses"}
              onClick={() => setTab("responses")}
              trailing={<span className={cn("text-xs font-medium tabular-nums", tab === "responses" ? "text-ink-strong" : "text-ink-2")}>{(responseTotal ?? form.submissionCount).toLocaleString()}</span>}
            />
          ) : null}
        </ViewTabStrip>
      </div>
      {strippedNotice ? <StrippedViewNotice>Responses are for people who can edit this form, so this opened on Build.</StrippedViewNotice> : null}

      {/* ── Toolbar 44 ── */}
      <div className="flex h-11 shrink-0 items-center gap-2 px-4" role="toolbar" aria-label="Form toolbar">
        <button type="button" onClick={() => setPreview(true)} className={TB_BTN} title="Preview (⌘E)">
          <Eye className="h-4 w-4 text-ink-2" strokeWidth={1.5} aria-hidden />
          Preview
        </button>
        {tab === "responses" ? (
          <label className="inline-flex h-9 w-56 items-center gap-1.5 rounded-md border border-line-strong px-2.5 text-base text-ink focus-within:border-brand max-[900px]:w-40">
            <ListFilter className="h-4 w-4 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
            <input
              value={responseFilter}
              onChange={(e) => setResponseFilter(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") setResponseFilter(""); }}
              placeholder="Filter responses"
              aria-label="Filter responses by answer or by who sent them"
              className="min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-ink-3 focus:outline-none"
            />
            {responseFilter ? (
              <button type="button" onClick={() => setResponseFilter("")} aria-label="Clear the filter" className="inline-flex h-5 w-5 items-center justify-center rounded text-ink-2 hover:text-ink">
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            ) : null}
          </label>
        ) : null}
        {tab === "responses" ? (
          <button type="button" onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))} className={TB_BTN} aria-label={`Sort: ${sortDir === "desc" ? "newest first" : "oldest first"}`}>
            <ArrowUpDown className="h-4 w-4 text-ink-2" strokeWidth={1.5} aria-hidden />
            {sortDir === "desc" ? "Newest first" : "Oldest first"}
          </button>
        ) : null}
        <span className="flex-1" />
        <span className="inline-flex">
          <button type="button" onClick={copyLink} className={cn(TB_BTN, publicLive && "rounded-e-none")}>
            <Link2 className="h-4 w-4 text-ink-2" strokeWidth={1.5} aria-hidden />
            Copy link
          </button>
          {publicLive ? (
            <button
              ref={embedRef}
              type="button"
              onClick={() => setEmbedOpen((o) => !o)}
              aria-label="More ways to share"
              aria-haspopup="menu"
              aria-expanded={embedOpen}
              className="inline-flex h-9 w-9 items-center justify-center rounded-e-md border border-s-0 border-line-strong text-ink-2 hover:bg-hover"
            >
              <ChevronDown className="h-4 w-4" aria-hidden />
            </button>
          ) : null}
        </span>
        <button
          ref={moreRef}
          type="button"
          onClick={() => setMoreOpen((o) => !o)}
          aria-label={tab === "responses" ? "Response options" : "Display options"}
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-line-strong text-ink-2 hover:bg-hover hover:text-ink"
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden />
        </button>
      </div>
      {embedOpen ? (
        <MorePortal anchorRef={embedRef} width={420} open placement="below" onClose={() => setEmbedOpen(false)}>
          <MenuList className="p-3" style={{ minWidth: 400 }} aria-label="Embed code">
            <p className="m-0 mb-2 flex items-center gap-1.5 text-sm font-medium text-ink"><Code2 className="h-4 w-4 text-ink-2" aria-hidden /> Copy embed code</p>
            <pre className="m-0 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-md border border-line bg-subtle p-2 font-mono text-xs text-ink">{embedSnippet("form", formId, displayName)}</pre>
            <button
              type="button"
              onClick={() => { void navigator.clipboard?.writeText(embedSnippet("form", formId, displayName)).then(() => toast("Embed code copied")); setEmbedOpen(false); }}
              className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong px-3 text-sm font-medium text-ink hover:bg-hover"
            >
              <Copy className="h-3.5 w-3.5" aria-hidden />
              Copy
            </button>
          </MenuList>
        </MorePortal>
      ) : null}
      {moreOpen ? (
        <MorePortal anchorRef={moreRef} width={260} open placement="below" onClose={() => setMoreOpen(false)}>
          <MenuList style={{ minWidth: 240 }}>
            {tab !== "responses" ? (
              <>
                <MenuSectionLabel>Display</MenuSectionLabel>
                <MenuItem label="Show help text" selected={showHelpText} onClick={() => void patchPrefs({ home: { forms: { showHelpText: !showHelpText } } })} />
                <MenuItem label="Show field numbers" selected={showFieldNumbers} onClick={() => void patchPrefs({ home: { forms: { showFieldNumbers: !showFieldNumbers } } })} />
              </>
            ) : (
              <>
                {!form.isAgent ? <MenuItem icon={Download} label={responseFilter.trim() ? "Export these responses as CSV" : "Export as CSV"} onClick={() => {
                  // The file is what is on screen: the active Filter and sort.
                  const qs = new URLSearchParams();
                  if (responseFilter.trim()) qs.set("q", responseFilter.trim());
                  if (sortDir === "asc") qs.set("dir", "asc");
                  const tail = qs.toString();
                  downloadUrl(`/api/forms/${formId}/responses/export.csv${tail ? `?${tail}` : ""}`);
                  setMoreOpen(false);
                }} /> : null}
                {canManage && !form.isAgent ? (
                  <>
                    <MenuSeparator />
                    <MenuItem icon={Trash2} label="Delete all responses" destructive disabled={(responseTotal ?? 0) === 0} onClick={() => void deleteAllResponses()} />
                  </>
                ) : null}
                {form.isAgent && !canManage ? <p className="m-0 px-3 py-2 text-sm text-ink-2">Nothing to do here.</p> : null}
              </>
            )}
          </MenuList>
        </MorePortal>
      ) : null}

      {backup ? (
        <div role="status" className="mx-4 mb-2 flex items-center gap-3 rounded-md border border-line bg-warning-bg px-3 py-2 text-sm text-ink">
          <span className="flex-1">You have changes to this form from {fmt.date(backup.at, "datetime")} that never reached the server. Restore them or discard them to keep editing.</span>
          <button type="button" className="font-medium text-brand-deep hover:underline" onClick={() => { setRestore(backup.data); setBackup(null); }}>Restore them</button>
          <button type="button" className="font-medium text-ink-2 hover:underline" onClick={() => { if (backupKey) clearAutosaveBackup(backupKey); setBackup(null); }}>Discard</button>
        </div>
      ) : null}

      {conflict && !backup ? (
        <div role="alert" className="mx-4 mb-2 flex items-center gap-3 rounded-md border border-line bg-warning-bg px-3 py-2 text-sm text-ink">
          <span className="flex-1">This form was changed in another tab or by someone else while you were editing, so your latest changes were not saved. They are still on screen. Keep yours to save them over the other version, or load the other version.</span>
          <button
            type="button"
            className="font-medium text-brand-deep hover:underline"
            onClick={() => {
              // Save over it: base the next save on the stored revision.
              revRef.current = conflictRef.current === "changed" ? null : conflictRef.current;
              conflictRef.current = null;
              setConflict(null);
              void flushNow();
            }}
          >
            Keep mine
          </button>
          <button
            type="button"
            className="font-medium text-ink-2 hover:underline"
            onClick={async () => {
              const ok = await confirm({
                title: "Load the other version?",
                description: "Your changes that were not saved are replaced by the version that is saved now.",
                confirmLabel: "Load the other version",
                cancelLabel: "Keep editing",
                destructive: true,
              });
              if (!ok) return;
              if (backupKey) clearAutosaveBackup(backupKey);
              conflictRef.current = null;
              setConflict(null);
              void load();
            }}
          >
            Load theirs
          </button>
        </div>
      ) : null}

      {/* ── Body ── */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "responses" && canReadResponses ? (
          <div className="px-4 pb-8 pt-2">
            <FormResponsesTab
              formId={formId}
              fields={draft.fields}
              collectEmail={draft.settings.collectEmail}
              active={tab === "responses"}
              sortDir={sortDir}
              filter={responseFilter}
              onTotal={setResponseTotal}
              onCopyLink={copyLink}
            />
          </div>
        ) : tab === "settings" ? (
          <div className="mx-auto w-full max-w-[720px] px-6 pb-12 pt-4 max-[900px]:px-4">
            <FormSettingsTab
              settings={draft.settings}
              readOnly={locked}
              onChange={patchSettings}
              knownPeople={form.notifyPeople}
              dailySummaryAvailable={form.dailySummaryAvailable === true}
              linkDraft={linkDraft}
              onLinkDraftChange={setLinkDraft}
              anonymous={form.publicLinksAllowed !== false ? { isPublic: form.isPublic, onToggle: canManage ? (on) => void toggleAnonymous(on) : undefined } : undefined}
            />
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-6 pb-16 pt-4 max-[900px]:px-4">
            {closed ? (
              <p className="m-0 rounded-md border border-line bg-subtle px-3 py-2 text-sm text-ink-2">
                This form is closed: people see its closed message instead of the questions.
                {!locked ? <> <button type="button" onClick={() => setTab("settings")} className="font-medium text-brand-deep hover:underline">Open settings</button></> : null}
              </p>
            ) : null}
            {readOnly ? (
              // Can view (spec /forms/[id] States, Read-only): the Build tab is
              // the form as a responder sees it, rendered, every input inert
              // and no Submit, never the editing cards with their grips.
              <FormRenderer
                form={{
                  id: formId,
                  name: displayName,
                  description: draft.description || null,
                  fields: draft.fields,
                  settings: {
                    closed: false,
                    confirmationMessage: draft.settings.confirmationMessage || DEFAULT_FORM_SETTINGS.confirmationMessage,
                    closedMessage: draft.settings.closedMessage,
                    allowAnother: draft.settings.allowAnother,
                    redirectUrl: null,
                  },
                }}
                mode="view"
                answers={{}}
                onAnswersChange={() => undefined}
                onSubmit={async () => ({ ok: true })}
                abilities={{ pickPeople: true, upload: false }}
                showHelpText={showHelpText}
                numbers={showFieldNumbers ? numbers : undefined}
              />
            ) : (
            <>
            {/* 1. Form header card */}
            <section className="flex flex-col gap-3 rounded-lg border border-line bg-raised p-6" aria-label="Form header">
              <input
                value={draft.name}
                onChange={(e) => patch({ name: e.target.value })}
                placeholder="Untitled form"
                aria-label="Form title"
                readOnly={locked}
                maxLength={200}
                className="h-9 rounded-md border border-transparent bg-transparent px-1 text-lg font-semibold text-ink hover:border-line focus:border-brand focus:outline-none read-only:hover:border-transparent"
              />
              <textarea
                value={draft.description}
                onChange={(e) => {
                  patch({ description: e.target.value });
                  const el = e.currentTarget;
                  el.style.height = "auto";
                  el.style.height = `${Math.min(el.scrollHeight, 12 * 22)}px`;
                }}
                placeholder="Description (optional)"
                aria-label="Form description"
                readOnly={locked}
                rows={3}
                maxLength={2000}
                className="resize-none rounded-md border border-transparent bg-transparent px-1 py-1 text-base text-ink placeholder:text-ink-3 hover:border-line focus:border-brand focus:outline-none read-only:hover:border-transparent"
              />
            </section>

            {/* 2. Field cards */}
            {draft.fields.length === 0 ? (
              <OsEmptyView compact title="No questions yet" action={locked ? undefined : { label: "Add a field", onClick: () => setAddOpen(true) }} />
            ) : draft.fields.map((f, i) => (
              <FormFieldCard
                key={f.id}
                field={f}
                index={i}
                count={draft.fields.length}
                number={showFieldNumbers ? numbers.get(f.id) : undefined}
                readOnly={locked}
                showHelpText={showHelpText}
                dragging={dragId === f.id}
                dropTarget={overId === f.id && dragId !== f.id}
                onChange={(p) => patchField(f.id, p)}
                onMove={(to) => setDraft((d) => (d ? { ...d, fields: moveFieldTo(d.fields, i, to) } : d))}
                onDuplicate={() => setDraft((d) => (d ? { ...d, fields: duplicateFieldAt(d.fields, i) } : d))}
                onDelete={() => void deleteField(f)}
                onChangeType={(to) => void changeType(f, to)}
                onDragStart={() => setDragId(f.id)}
                onDragOver={() => setOverId(f.id)}
                onDrop={() => {
                  if (dragId && dragId !== f.id) {
                    setDraft((d) => {
                      if (!d) return d;
                      const from = d.fields.findIndex((x) => x.id === dragId);
                      const to = d.fields.findIndex((x) => x.id === f.id);
                      return { ...d, fields: moveFieldTo(d.fields, from, to) };
                    });
                  }
                  setDragId(null);
                  setOverId(null);
                }}
                onDragEnd={() => { setDragId(null); setOverId(null); }}
              />
            ))}

            {/* 3. + Add a field */}
            {!locked ? (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setAddOpen((o) => !o)}
                  aria-haspopup="listbox"
                  aria-expanded={addOpen}
                  className="flex h-9 w-full items-center gap-2 rounded-md border border-dashed border-line-strong px-3 text-base text-ink-2 hover:bg-hover hover:text-ink"
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  Add a field
                </button>
                <Picker
                  open={addOpen}
                  onClose={() => setAddOpen(false)}
                  sections={addSections}
                  onSelect={(v) => {
                    if (v.startsWith("t:")) addField(v.slice(2) as FormFieldType);
                    else if (v.startsWith("b:")) addMappedField("board", v.slice(2));
                    else if (v.startsWith("c:")) addMappedField("table", v.slice(2));
                  }}
                  searchPlaceholder="Search field types"
                  ariaLabel="Add a field"
                  width={300}
                />
                {showUpcoming ? <p className="m-0 mt-2 text-sm text-ink-3">More field types are coming: signature, matrix, scale and payment.</p> : null}
              </div>
            ) : null}

            </>
            )}

            {/* 4. Goes to, 5. mapping */}
            <GoesToCard listDest={listDest} tableDest={tableDest} readOnly={locked} tablesOn={tablesOn} onChange={(n) => void changeDestination(n)} />
            {readOnly ? null : <MappingCard
              fields={draft.fields}
              listDest={listDest}
              tableDest={tableDest}
              listFields={listFields}
              tableColumns={tableColumns}
              mappings={draft.fieldMappings}
              readOnly={locked}
              onChange={(fieldMappings) => patch({ fieldMappings })}
            />}
          </div>
        )}
      </div>

      {/* ── Preview drawer 520 at ?preview=1 ── */}
      <Drawer
        open={previewOpen}
        onClose={() => setPreview(false)}
        ariaLabel="Preview"
        layerId="form-preview-drawer"
        header={
          <div className="flex h-12 w-full items-center gap-2 px-4">
            <Eye className="h-4 w-4 text-ink-2" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-base font-semibold text-ink">Preview</span>
            <button type="button" onClick={() => setPreview(false)} aria-label="Close preview" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        }
      >
        <div className="bg-app p-4">
          <FormRenderer
            form={{
              id: formId,
              name: displayName,
              description: draft.description || null,
              fields: draft.fields,
              settings: {
                closed: false,
                confirmationMessage: draft.settings.confirmationMessage || DEFAULT_FORM_SETTINGS.confirmationMessage,
                closedMessage: draft.settings.closedMessage,
                allowAnother: draft.settings.allowAnother,
                redirectUrl: null,
              },
            }}
            mode="preview"
            answers={previewAnswers}
            onAnswersChange={setPreviewAnswers}
            onSubmit={async () => ({ ok: true })}
            abilities={{ pickPeople: true, upload: false }}
            showHelpText={showHelpText}
            numbers={showFieldNumbers ? numbers : undefined}
          />
          {closed ? <p className="m-0 mt-3 text-sm text-ink-2"><Check className="me-1 inline h-3.5 w-3.5" aria-hidden />People who open the link now see the closed message.</p> : null}
        </div>
      </Drawer>

      {shareMode ? (
        <ObjectShareDialog
          open
          mode={shareMode}
          onClose={() => setShareMode(null)}
          object={{
            kind: "form",
            id: formId,
            name: displayName,
            isPublic: form.isPublic,
            canManage,
            publicLinksAllowed: form.publicLinksAllowed !== false,
            anchorName: primaryDest?.name ?? null,
            ownerName: form.owner?.name ?? null,
          }}
          onPublicChange={(isPublic) => { setForm((f) => (f ? { ...f, isPublic } : f)); dispatchFormsChanged(); }}
        />
      ) : null}
    </div>
  );
}
