// Space detail — ClickUp-style chrome (rebuilt 2026-06-03 design pivot,
// extended 2026-06-03 Phase 11 to surface the wizard payload).
//
// White background, breadcrumb, title row with Ask AI + Share,
// then About card (preset/owner/KRAs/modules) + folder/board content.
// The "+ New Folder" and "+ New Board" buttons live in SpaceActions
// (client island) on the right side.

import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createElement } from "react";
import {
  Folder as FolderIcon, Lock, ListTree,
  Sparkles, Users as UsersIcon, Flag,
} from "lucide-react";
import Link from "next/link";
import { SpaceActions } from "@/components/layout/os/space-actions";
import { SpaceShareButton } from "@/components/layout/os/space-share-button";
import { SpaceMembersStrip } from "@/components/layout/os/space-members-strip";
import { getSpaceIcon } from "@/components/layout/os/space-icon-catalog";
import { MODULE_CATALOG, PRESETS } from "@/components/layout/os/space-wizard-presets";
import type { ModuleKey, WorkflowConfig } from "@/components/layout/os/space-wizard-types";

export const dynamic = "force-dynamic";

const DEFAULT_SPACE_COLOR = "#71717A";

function readWorkflow(settings: unknown): WorkflowConfig | null {
  if (!settings || typeof settings !== "object") return null;
  const w = (settings as Record<string, unknown>).workflow;
  if (!w || typeof w !== "object") return null;
  return w as WorkflowConfig;
}

export default async function SpacePage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const u = session.user as { id?: string; organizationId?: string; accessLevel?: string };
  if (!u.id || !u.organizationId) redirect("/login");

  const space = await prisma.space.findFirst({
    where: { slug, organizationId: u.organizationId },
    include: {
      _count: { select: { members: true, folders: true, boards: true } },
      folders: {
        where: { archivedAt: null, parentFolderId: null },
        orderBy: { position: "asc" },
        include: {
          _count: { select: { boards: true, childFolders: true } },
          boards: {
            where: { archivedAt: null },
            orderBy: { name: "asc" },
            select: {
              id: true, slug: true, name: true, icon: true, color: true,
              itemType: true, visibility: true,
              views: { where: { isDefault: true }, take: 1, select: { type: true } },
            },
          },
        },
      },
      boards: {
        where: { archivedAt: null, folderId: null },
        orderBy: { name: "asc" },
        select: {
          id: true, slug: true, name: true, icon: true, color: true,
          itemType: true, visibility: true,
          views: { where: { isDefault: true }, take: 1, select: { type: true } },
        },
      },
    },
  });
  if (!space) notFound();

  const isAdmin = u.accessLevel === "SUPER_ADMIN" || u.accessLevel === "COMPANY_ADMIN";
  if (!isAdmin && space.visibility !== "ORG") {
    const member = await prisma.spaceMember.findUnique({
      where: { spaceId_userId: { spaceId: space.id, userId: u.id } },
      select: { id: true },
    });
    if (!member) notFound();
  }

  const workflow = readWorkflow(space.settings);

  // Resolve owner + linked KRAs + member preview in parallel. All are
  // read-only chrome for the About card; missing rows degrade gracefully.
  const [owner, kraLinks, memberPreview] = await Promise.all([
    space.ownerId
      ? prisma.user.findUnique({
          where: { id: space.ownerId },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : null,
    prisma.entityLink.findMany({
      where: {
        organizationId: u.organizationId,
        sourceType: "SPACE",
        sourceId: space.id,
        targetType: "KRA",
      },
      orderBy: { position: "asc" },
      select: { targetId: true },
    }),
    prisma.spaceMember.findMany({
      where: { spaceId: space.id },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
      orderBy: { createdAt: "asc" },
      take: 12,
    }),
  ]);

  const kras = kraLinks.length
    ? await prisma.kRA.findMany({
        where: { organizationId: u.organizationId, id: { in: kraLinks.map((l) => l.targetId) } },
        select: { id: true, name: true, category: true },
      })
    : [];

  const hasContent = space.folders.length > 0 || space.boards.length > 0;
  const hasAbout =
    Boolean(workflow) ||
    Boolean(owner) ||
    kras.length > 0;

  const memberPreviewUsers = memberPreview.map((m) => ({
    id: m.user.id,
    name: ([m.user.firstName, m.user.lastName].filter(Boolean).join(" ").trim() || m.user.email) as string,
    initials: ((m.user.firstName?.[0] ?? "") + (m.user.lastName?.[0] ?? "")).toUpperCase() || m.user.email[0].toUpperCase(),
    role: m.role,
  }));

  const accent = space.color ?? DEFAULT_SPACE_COLOR;
  const Icon = getSpaceIcon(space.icon);
  const enabledModules: ModuleKey[] = workflow?.modules ?? [];
  const moduleByKey = new Map(MODULE_CATALOG.map((m) => [m.key, m]));
  const presetLabel = workflow ? PRESETS.find((p) => p.id === workflow.preset)?.title ?? null : null;
  const ownerName = owner
    ? ([owner.firstName, owner.lastName].filter(Boolean).join(" ").trim() || owner.email)
    : null;

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Breadcrumb + title row */}
      <div className="px-6 pt-4 pb-3">
        <div className="flex items-center gap-1.5 text-xs text-zinc-500 mb-2">
          <Link href="/spaces" className="hover:text-zinc-900">Spaces</Link>
        </div>
        <div className="flex items-center gap-3">
          <span
            className="h-9 w-9 rounded-lg flex items-center justify-center text-white text-sm font-semibold uppercase shrink-0"
            style={{ backgroundColor: accent }}
          >
            {Icon ? createElement(Icon, { className: "h-4 w-4" }) : (space.name[0] ?? "?")}
          </span>
          <h1 className="text-base font-semibold text-zinc-900 flex items-center gap-2 min-w-0">
            <span className="truncate">{space.name}</span>
            {space.visibility === "PRIVATE" ? (
              <Lock className="w-3.5 h-3.5 text-zinc-400" />
            ) : null}
          </h1>
          <span className="text-xs text-zinc-500">
            {space._count.members} member{space._count.members === 1 ? "" : "s"} ·{" "}
            {space._count.folders} folder{space._count.folders === 1 ? "" : "s"} ·{" "}
            {space._count.boards} board{space._count.boards === 1 ? "" : "s"}
          </span>
          <div className="flex-1" />
          <button
            type="button"
            className="text-sm text-zinc-700 hover:text-zinc-900 flex items-center gap-1.5 px-2 py-1 rounded hover:bg-zinc-100"
          >
            <Sparkles className="w-3.5 h-3.5 text-violet-500" />
            Ask AI
          </button>
          <SpaceShareButton
            spaceId={space.id}
            spaceName={space.name}
            initialVisibility={space.visibility}
          />
        </div>
        {space.description ? (
          <p className="text-sm text-zinc-600 mt-2 max-w-[640px]">{space.description}</p>
        ) : null}
      </div>

      {/* Action row */}
      <div className="px-6 pb-3 border-b border-zinc-100 flex items-center gap-2">
        <SpaceActions spaceId={space.id} />
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
        {hasAbout ? (
          <section
            className="rounded-xl border border-zinc-200 bg-white p-4"
            style={{ borderTop: `3px solid ${accent}` }}
          >
            <div className="text-[11px] uppercase tracking-wide text-zinc-500 font-semibold mb-3">
              About this Space
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <AboutCell
                label="Preset"
                icon={<Sparkles className="h-3.5 w-3.5" />}
                value={presetLabel ?? "—"}
              />
              <AboutCell
                label="Owner"
                icon={<UsersIcon className="h-3.5 w-3.5" />}
                value={ownerName ?? "Unassigned"}
              />
              <AboutCell
                label={`Linked KRAs · ${kras.length}`}
                icon={<Flag className="h-3.5 w-3.5" />}
                value={
                  kras.length === 0 ? (
                    "None linked"
                  ) : (
                    <span className="flex flex-wrap gap-1">
                      {kras.slice(0, 4).map((k) => (
                        <span
                          key={k.id}
                          className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-zinc-100 text-zinc-700"
                        >
                          {k.name}
                        </span>
                      ))}
                      {kras.length > 4 ? (
                        <span className="text-[11px] text-zinc-500">+{kras.length - 4}</span>
                      ) : null}
                    </span>
                  )
                }
              />
            </div>
            {enabledModules.length > 0 ? (
              <div className="mt-4 pt-4 border-t border-zinc-100">
                <div className="text-[11px] uppercase tracking-wide text-zinc-500 font-semibold mb-2">
                  Enabled modules · {enabledModules.length}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {enabledModules.map((k) => {
                    const m = moduleByKey.get(k);
                    return (
                      <span
                        key={k}
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium"
                        style={{ backgroundColor: `${accent}1a`, color: accent }}
                      >
                        {m?.label ?? k}
                      </span>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="mt-4 pt-4 border-t border-zinc-100">
              <div className="text-[11px] uppercase tracking-wide text-zinc-500 font-semibold mb-2">
                Members
              </div>
              <SpaceMembersStrip
                spaceId={space.id}
                spaceName={space.name}
                visibility={space.visibility}
                members={memberPreviewUsers}
                totalCount={space._count.members}
              />
            </div>
          </section>
        ) : null}

        {!hasContent ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <ListTree className="w-8 h-8 text-zinc-400 mb-3" />
            <div className="text-sm font-medium text-zinc-900 mb-1">This Space is empty</div>
            <p className="text-xs text-zinc-500 max-w-[360px]">
              Add a Folder to group related work, or create your first Board to start tracking items.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {space.folders.length > 0 ? (
              <section>
                <h2 className="text-[11px] uppercase tracking-wide text-zinc-500 mb-2">Folders</h2>
                <ul className="space-y-3">
                  {space.folders.map((f) => (
                    <li key={f.id} className="border border-zinc-200 rounded-lg bg-white overflow-hidden">
                      <div className="px-4 py-2.5 flex items-center gap-3 border-b border-zinc-100">
                        <FolderIcon className="w-4 h-4 text-zinc-500" />
                        <span className="text-sm font-medium text-zinc-900 flex-1">{f.name}</span>
                        <span className="text-xs text-zinc-500">
                          {f._count.boards} board{f._count.boards === 1 ? "" : "s"}
                        </span>
                      </div>
                      {f.boards.length > 0 ? (
                        <ul className="px-2 py-2">
                          {f.boards.map((b) => (
                            <li key={b.id}>
                              <Link
                                href={`/boards/${b.slug}`}
                                className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-zinc-50"
                              >
                                <span className="inline-flex items-center justify-center w-6 h-6 rounded text-xs font-semibold bg-zinc-100 uppercase">
                                  {b.icon ?? b.name.charAt(0)}
                                </span>
                                <span className="text-sm text-zinc-900 flex-1">{b.name}</span>
                                <span className="text-[10px] text-zinc-500 uppercase tracking-wide">
                                  {b.views[0]?.type ?? "TABLE"}
                                </span>
                              </Link>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="px-4 py-3 text-xs text-zinc-500">No boards yet</div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {space.boards.length > 0 ? (
              <section>
                <h2 className="text-[11px] uppercase tracking-wide text-zinc-500 mb-2">Boards</h2>
                <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {space.boards.map((b) => (
                    <li key={b.id}>
                      <Link
                        href={`/boards/${b.slug}`}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 hover:border-zinc-300 transition-colors"
                      >
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded text-xs font-semibold bg-zinc-100 uppercase">
                          {b.icon ?? b.name.charAt(0)}
                        </span>
                        <span className="text-sm text-zinc-900 flex-1">{b.name}</span>
                        <span className="text-[10px] text-zinc-500 uppercase tracking-wide">
                          {b.views[0]?.type ?? "TABLE"}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function AboutCell({
  label,
  icon,
  value,
}: {
  label: string;
  icon: React.ReactNode;
  value: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[11px] text-zinc-500 mb-1 inline-flex items-center gap-1.5">
        {icon}
        {label}
      </div>
      <div className="text-[13px] text-zinc-900 font-medium">{value}</div>
    </div>
  );
}
