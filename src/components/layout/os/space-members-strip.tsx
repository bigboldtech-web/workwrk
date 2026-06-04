"use client";

// SpaceMembersStrip — avatar stack + total count + "Manage" button.
// Lives in the Space detail About card. Clicking the stack OR the
// Manage button opens ShareSpaceDialog at the Members section.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShareSpaceDialog } from "./share-space-dialog";

type Visibility = "PRIVATE" | "WORKSPACE" | "ORG";

interface MemberPreview {
  id: string;
  name: string;
  initials: string;
  role: string;
}

interface Props {
  spaceId: string;
  spaceName: string;
  visibility: Visibility;
  members: MemberPreview[];
  totalCount: number;
}

const STACK_PALETTE = [
  "#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6",
  "#EC4899", "#14B8A6", "#F97316", "#6366F1", "#06B6D4",
];

function colorForId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return STACK_PALETTE[h % STACK_PALETTE.length];
}

export function SpaceMembersStrip({ spaceId, spaceName, visibility, members, totalCount }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const shown = members.slice(0, 6);
  const overflow = totalCount - shown.length;

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 group"
          aria-label="Manage members"
        >
          <span className="flex -space-x-1.5">
            {shown.map((m) => (
              <span
                key={m.id}
                className="h-6 w-6 rounded-full border-2 border-white inline-flex items-center justify-center text-[10px] font-semibold text-white shadow-sm"
                style={{ backgroundColor: colorForId(m.id) }}
                title={`${m.name} · ${m.role.toLowerCase()}`}
              >
                {m.initials}
              </span>
            ))}
            {overflow > 0 ? (
              <span className="h-6 w-6 rounded-full border-2 border-white bg-zinc-100 text-zinc-600 inline-flex items-center justify-center text-[10px] font-semibold shadow-sm">
                +{overflow}
              </span>
            ) : null}
            {shown.length === 0 ? (
              <span className="h-6 w-6 rounded-full border-2 border-white bg-zinc-100 text-zinc-400 inline-flex items-center justify-center text-[10px] font-semibold shadow-sm">
                ?
              </span>
            ) : null}
          </span>
          <span className="text-[12px] text-zinc-500 group-hover:text-zinc-900 transition-colors">
            {totalCount} {totalCount === 1 ? "member" : "members"}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="h-7 px-2.5 rounded-md text-[12px] font-medium border border-zinc-200 hover:bg-zinc-50 text-zinc-700"
        >
          Manage
        </button>
      </div>

      <ShareSpaceDialog
        open={open}
        onOpenChange={setOpen}
        spaceId={spaceId}
        spaceName={spaceName}
        initialVisibility={visibility}
        onChanged={() => router.refresh()}
      />
    </>
  );
}
