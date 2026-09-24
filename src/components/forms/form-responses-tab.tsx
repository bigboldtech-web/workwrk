"use client";

// The builder's Responses tab (spec-tables-forms section 2 /forms/[id]).
//
//   TableCard   checkbox · When · Who (avatar + name, the email under it when
//               the form collects email) · the first three questions · Went
//               to (the task or the table row, or "Not sent" with the reason
//               in a tooltip) · "..." (Open, Copy link, Delete response)
//   drawer      a row click opens the response at ?response=<id>: every field
//               and answer as label and value rows, where it went, when, who,
//               and "Delete response" for Full access holders
//   footer      "Total responses N" and cursor paging (the old take: 500 is a
//               real cursor now)
//   bulk bar    Delete for Full access holders
//   realtime    refetch on window focus and every 30 seconds while this tab
//               is the one showing; the count on the Responses pill follows
//
// The <details> accordions are gone.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ExternalLink, Link2, MoreHorizontal, Paperclip, Trash2, X } from "lucide-react";
import { BulkAction, TableCard, type TableColumn } from "@/components/ui/table-card";
import { Drawer } from "@/components/ui/drawer";
import { MenuItem, MenuList, MenuSeparator } from "@/components/ui/menu";
import { MorePortal } from "@/components/layout/os/more-portal";
import { OsEmptyView } from "@/components/layout/os/empty-view";
import { useOsToast } from "@/components/layout/os/toast";
import { useConfirm } from "@/components/ui/dialog-provider";
import { PersonAvatar } from "@/components/board-view/assignee-picker";
import { apiFetch } from "@/lib/api-fetch";
import { useFormat } from "@/lib/format/use-date-prefs";
import { answerText, isQuestion, readFileAnswer, type FormField } from "@/lib/forms/fields";
import { cn } from "@/lib/utils";

type Person = { id: string; name: string; email: string | null; avatar: string | null; firstName: string | null; lastName: string | null };
type Went = { kind: "list" | "table"; href: string | null; label: string; error: string | null };
export type ResponseRow = { id: string; data: Record<string, unknown>; submittedAt: string; submittedById: string | null; went: Went[] };
type Page = { data: ResponseRow[]; nextCursor: string | null; total: number; people: Record<string, Person>; canDelete: boolean };

const PAGE = 50;

export function FormResponsesTab({
  formId, fields, collectEmail, active, sortDir, filter = "", onTotal, onCopyLink,
}: {
  formId: string;
  fields: FormField[];
  collectEmail: boolean;
  /** This tab is the one showing: poll every 30s and on focus. */
  active: boolean;
  sortDir: "desc" | "asc";
  /** The toolbar's Filter text: answers, or the sender's name or email. */
  filter?: string;
  onTotal: (n: number) => void;
  onCopyLink: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname() || "";
  const searchParams = useSearchParams();
  const { toast } = useOsToast();
  const confirm = useConfirm();
  const fmt = useFormat();
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState(false);
  // The cursor stack: [null, c1, c2] means page 3 was fetched with c2.
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  // A new filter or sort starts again at page 1 (the cursor belongs to the old list).
  const [cursorFor, setCursorFor] = useState(`${sortDir}|${filter}`);
  if (cursorFor !== `${sortDir}|${filter}`) { setCursorFor(`${sortDir}|${filter}`); setCursors([null]); }
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ row: ResponseRow; anchor: HTMLElement } | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const cursor = cursors[cursors.length - 1] ?? null;

  const load = useCallback(async () => {
    const params = new URLSearchParams({ limit: String(PAGE) });
    if (cursor) params.set("cursor", cursor);
    if (sortDir === "asc") params.set("dir", "asc");
    const q = filter.trim();
    if (q) params.set("q", q);
    const r = await apiFetch<Page>(`/api/forms/${formId}/responses?${params}`, { cache: "no-store" });
    if (!r.ok) { setError(true); return; }
    setError(false);
    setPage(r.data);
    // The pill counts every response, so a filtered total never replaces it.
    if (!q) onTotal(r.data.total);
  }, [formId, cursor, sortDir, filter, onTotal]);

  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  useEffect(() => {
    if (!active) return;
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    const t = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 30_000);
    return () => { window.removeEventListener("focus", onFocus); clearInterval(t); };
  }, [active, load]);

  const questions = useMemo(() => fields.filter(isQuestion), [fields]);
  const people = useMemo(() => page?.people ?? {}, [page]);
  const nameOf = useCallback((id: string) => people[id]?.name ?? null, [people]);
  const openId = searchParams.get("response");
  const setOpen = useCallback((id: string | null) => {
    const next = new URLSearchParams(searchParams.toString());
    if (id) next.set("response", id); else next.delete("response");
    const qs = next.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [router, pathname, searchParams]);
  // A copied ?response= link opens its response even when that row is not on
  // the page loaded here (older than the newest 50, or filtered out): it is
  // fetched on its own. A link to a response that is gone says so once.
  const onPage = page?.data.find((r) => r.id === openId) ?? null;
  const [single, setSingle] = useState<{ row: ResponseRow; people: Record<string, Person> } | null>(null);
  const [singleMissing, setSingleMissing] = useState<string | null>(null);
  useEffect(() => {
    if (!openId || !page || onPage || single?.row.id === openId || singleMissing === openId) return;
    let alive = true;
    void apiFetch<{ data: ResponseRow; people: Record<string, Person> }>(`/api/forms/${formId}/responses/${encodeURIComponent(openId)}`, { cache: "no-store" }).then((r) => {
      if (!alive) return;
      if (r.ok) setSingle({ row: r.data.data, people: r.data.people });
      else { setSingleMissing(openId); toast("That response no longer exists"); }
    });
    return () => { alive = false; };
  }, [openId, page, onPage, single, singleMissing, formId, toast]);
  const openRow = onPage ?? (single && single.row.id === openId ? single.row : null);
  const drawerPeople = useMemo(() => (single && !onPage ? { ...people, ...single.people } : people), [single, onPage, people]);

  async function deleteOne(row: ResponseRow) {
    const ok = await confirm({ title: "Delete this response?", description: "The answers are removed from this form. A task or table row it already created stays where it is.", destructive: true, confirmLabel: "Delete response" });
    if (!ok) return;
    const r = await apiFetch(`/api/forms/${formId}/responses/${row.id}`, { method: "DELETE" });
    if (!r.ok) { toast(r.error || "Couldn't delete the response", { tone: "danger" }); return; }
    toast("Response deleted");
    if (openId === row.id) setOpen(null);
    setSelected((s) => { const n = new Set(s); n.delete(row.id); return n; });
    void load();
  }

  async function deleteSelected() {
    const ids = [...selected];
    const ok = await confirm({ title: `Delete ${ids.length} response${ids.length === 1 ? "" : "s"}?`, description: "The answers are removed from this form. Tasks and table rows they already created stay where they are.", destructive: true, confirmLabel: "Delete" });
    if (!ok) return;
    let failed = 0;
    for (const id of ids) {
      const r = await apiFetch(`/api/forms/${formId}/responses/${id}`, { method: "DELETE" });
      if (!r.ok) failed += 1;
    }
    setSelected(new Set());
    toast(failed ? `${failed} could not be deleted` : `Deleted ${ids.length} response${ids.length === 1 ? "" : "s"}`, failed ? { tone: "danger" } : undefined);
    void load();
  }

  function copyResponseLink(row: ResponseRow) {
    const url = `${window.location.origin}/forms/${formId}?tab=responses&response=${row.id}`;
    void navigator.clipboard?.writeText(url).then(() => toast("Link copied"), () => toast("Couldn't copy", { tone: "danger" }));
  }

  const columns: TableColumn<ResponseRow>[] = [
    { key: "when", label: "When", width: "170px", render: (r) => <span className="tabular-nums" title={fmt.title(r.submittedAt)}>{fmt.date(r.submittedAt, "datetime")}</span> },
    {
      key: "who", label: "Who", width: "220px", title: true,
      render: (r) => {
        const p = r.submittedById ? people[r.submittedById] : undefined;
        if (!r.submittedById) return <span className="text-ink-2">Anonymous</span>;
        return (
          <span className="flex min-w-0 items-center gap-2">
            <PersonAvatar person={{ id: r.submittedById, firstName: p?.firstName ?? null, lastName: p?.lastName ?? null, avatar: p?.avatar ?? null, email: p?.email ?? null }} size={24} />
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate">{p?.name ?? "A member"}</span>
              {collectEmail && p?.email ? <span className="truncate text-xs font-normal text-ink-2">{p.email}</span> : null}
            </span>
          </span>
        );
      },
    },
    ...questions.slice(0, 3).map((f): TableColumn<ResponseRow> => ({
      key: `f-${f.id}`,
      label: f.label || "Untitled question",
      render: (r) => <span className="truncate">{answerText(f, r.data[f.id], nameOf) || <span className="text-ink-3">No answer</span>}</span>,
    })),
    {
      key: "went", label: "Went to", width: "190px",
      render: (r) => <WentCell went={r.went} />,
    },
  ];

  if (error && !page) {
    return <OsEmptyView variant="error" title="We could not load the responses." action={{ label: "Retry", onClick: () => void load() }} />;
  }
  if (page && page.total === 0 && cursors.length === 1 && !filter.trim()) {
    return <OsEmptyView title="No responses yet" action={{ label: "Copy the link to share", onClick: onCopyLink }} />;
  }

  const from = page ? (cursors.length - 1) * PAGE + 1 : 0;
  const to = page ? from + page.data.length - 1 : 0;
  return (
    <>
      <TableCard<ResponseRow>
        ariaLabel="Responses"
        columns={columns}
        rows={page ? page.data : null}
        rowKey={(r) => r.id}
        onRowClick={(r) => setOpen(r.id)}
        selectable={!!page?.canDelete}
        selected={selected}
        onSelectedChange={setSelected}
        highlightKey={openId}
        rowMenu={(r) => (
          <button
            type="button"
            aria-label="Response actions"
            onClick={(e) => { e.stopPropagation(); anchorRef.current = e.currentTarget; setMenu({ row: r, anchor: e.currentTarget }); }}
            className="os-tc__more inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink"
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          </button>
        )}
        empty={filter.trim() ? "No responses match this filter" : undefined}
        bulkActions={page?.canDelete ? <BulkAction icon={Trash2} label="Delete" destructive onClick={() => void deleteSelected()} /> : undefined}
        footer={page ? {
          total: page.total,
          noun: "responses",
          from: page.data.length ? from : 0,
          to: page.data.length ? to : 0,
          onPrev: cursors.length > 1 ? () => setCursors((c) => c.slice(0, -1)) : undefined,
          onNext: page.nextCursor ? () => setCursors((c) => [...c, page.nextCursor]) : undefined,
        } : undefined}
      />
      {menu ? (
        <MorePortal anchorRef={anchorRef} width={220} open placement="below" onClose={() => setMenu(null)}>
          <MenuList aria-label="Response actions">
            <MenuItem icon={ExternalLink} label="Open" onClick={() => { setOpen(menu.row.id); setMenu(null); }} />
            <MenuItem icon={Link2} label="Copy link" onClick={() => { copyResponseLink(menu.row); setMenu(null); }} />
            {page?.canDelete ? (
              <>
                <MenuSeparator />
                <MenuItem icon={Trash2} label="Delete response" destructive onClick={() => { const r = menu.row; setMenu(null); void deleteOne(r); }} />
              </>
            ) : null}
          </MenuList>
        </MorePortal>
      ) : null}
      <Drawer
        open={!!openRow}
        onClose={() => setOpen(null)}
        ariaLabel="Response"
        layerId="form-response-drawer"
        header={
          <div className="flex h-12 w-full items-center gap-2 px-4">
            <span className="min-w-0 flex-1 truncate text-base font-semibold text-ink">Response</span>
            <button type="button" onClick={() => setOpen(null)} aria-label="Close" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        }
      >
        {openRow ? (
          <div className="flex flex-col px-4 py-3">
            <DetailRow label="Sent">{fmt.date(openRow.submittedAt, "datetime")}</DetailRow>
            <DetailRow label="Who">
              {openRow.submittedById ? `${drawerPeople[openRow.submittedById]?.name ?? "A member"}${drawerPeople[openRow.submittedById]?.email ? ` · ${drawerPeople[openRow.submittedById]?.email}` : ""}` : "Anonymous"}
            </DetailRow>
            <DetailRow label="Went to"><WentCell went={openRow.went} stacked /></DetailRow>
            <div className="my-2 border-t border-line" />
            {questions.map((f) => (
              <DetailRow key={f.id} label={f.label || "Untitled question"}>
                {f.type === "file" && Array.isArray(openRow.data[f.id])
                  ? <FileLinks value={openRow.data[f.id] as unknown[]} />
                  : answerText(f, openRow.data[f.id], (pid) => drawerPeople[pid]?.name ?? null) || <span className="text-ink-3">No answer</span>}
              </DetailRow>
            ))}
            {page?.canDelete ? (
              <button type="button" onClick={() => void deleteOne(openRow)} className="mt-4 inline-flex h-9 w-fit items-center gap-2 rounded-md px-3 text-base font-medium text-danger-text hover:bg-danger-bg">
                <Trash2 className="h-4 w-4" aria-hidden />
                Delete response
              </button>
            ) : null}
          </div>
        ) : null}
      </Drawer>
    </>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-9 items-start gap-3 py-2">
      <span className="w-36 shrink-0 text-sm text-ink-2">{label}</span>
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-base text-ink">{children}</span>
    </div>
  );
}

function WentCell({ went, stacked = false }: { went: Went[]; stacked?: boolean }) {
  if (!went.length) return <span className="text-ink-2" title="This form had no destination when the response came in">Not sent</span>;
  return (
    <span className={cn("flex min-w-0", stacked ? "flex-col gap-0.5" : "items-center gap-2 overflow-hidden")}>
      {went.map((w, i) => w.href ? (
        <a key={i} href={w.href} onClick={(e) => e.stopPropagation()} className={cn("truncate text-brand-deep hover:underline")}>{w.label}</a>
      ) : (
        <span key={i} className="truncate text-ink-2" title={w.error ?? undefined}>Not sent</span>
      ))}
    </span>
  );
}

function FileLinks({ value }: { value: unknown[] }) {
  // A file the server would not link (not this workspace's own upload) comes
  // back with its name and no url: it is listed by name, never as a link.
  const files = value.map((x) => {
    const f = readFileAnswer(x);
    if (f) return { name: f.name, url: f.url as string | null };
    const name = x && typeof x === "object" && typeof (x as { name?: unknown }).name === "string" ? (x as { name: string }).name : "";
    return name ? { name, url: null } : null;
  }).filter((f): f is { name: string; url: string | null } => !!f);
  if (!files.length) return <span className="text-ink-3">No answer</span>;
  return (
    <span className="flex flex-col gap-1">
      {files.map((f, i) => f.url ? (
        <a key={i} href={f.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-brand-deep hover:underline">
          <Paperclip className="h-3.5 w-3.5" aria-hidden />
          {f.name}
        </a>
      ) : (
        <span key={i} className="inline-flex items-center gap-1.5 text-ink-2" title="This file is not in this workspace's uploads, so it has no link">
          <Paperclip className="h-3.5 w-3.5" aria-hidden />
          {f.name}
        </span>
      ))}
    </span>
  );
}
