"use client";

// General access: the part of the Manage access dialog that is not about one
// person. It only COMPOSES the pieces each kind already had, which stay
// defined in their own files so nothing a surface did before goes missing:
//
//   Space   SpaceVisibilityControl (Invite only, Space members, Everyone at
//           the org), and on Everyone the line that it opens every Folder too
//   Folder  FolderRestrictedSwitch
//   List    ListVisibilityControl (Inherits from its Folder or the Space,
//           Restricted, Everyone at the org)
//   Doc     DocGeneralAccess (Restricted, the public link, the private link)
//   Table   PublicLinkSection (the public link, its embed code, the links)
//   Form    PublicLinkSection (and the form's own responder link)
//   Canvas  nothing of its own
//
// Every value comes from the panel (AccessPanel.general), and every write
// goes through that kind's own route; after one the dialog refetches the
// panel, so what this shows is always what the server holds.
//
// Inside an org-wide Space a share can only ADD rights: everyone at the org
// already opens everything in it (problem 16). That is said here, once, with
// the door to the Space when the viewer can change it.

import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import type { AccessPanel } from "@/lib/access/access-panel";
import { SpaceVisibilityControl } from "@/components/layout/os/share-space-dialog";
import { FolderRestrictedSwitch } from "@/components/layout/os/share-folder-dialog";
import { ListVisibilityControl } from "@/components/layout/os/share-board-dialog";
import { PublicLinkSection } from "@/components/tables/object-share-dialog";
import { DocGeneralAccess } from "@/components/docs/doc-share-modal";
import { managesViaNode, orgWideLine, panelUrl, restrictDocConfirm, restrictedAboveLine, spaceOrgLine } from "./manage-access-model";
import { AccessSectionHeading, type ManageInTarget } from "./who-has-access";

/**
 * Does the viewer manage the org-wide Space above this node? The panel says
 * so when someone reaches the node through that Space (a node via with
 * canManage); when nobody does, the only other witness is the Space's own
 * panel, read once here. Nothing is shown while it is unknown, and a failed
 * read shows no door: the door is a convenience, never the only way there.
 */
function useManagesSpace(spaceId: string | null, known: boolean | null): boolean {
  const [fetched, setFetched] = useState<{ id: string; manages: boolean } | null>(null);
  const need = !!spaceId && known === null;
  useEffect(() => {
    if (!need || !spaceId) return;
    let alive = true;
    void fetch(panelUrl("space", spaceId), { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((p: { viewer?: { canManage?: boolean } } | null) => {
        if (alive) setFetched({ id: spaceId, manages: !!p?.viewer?.canManage });
      })
      .catch(() => { if (alive) setFetched({ id: spaceId, manages: false }); });
    return () => { alive = false; };
  }, [need, spaceId]);
  if (known !== null) return known;
  return fetched?.id === spaceId ? fetched.manages : false;
}

export function GeneralAccess({
  panel, meId = null, canChange, onChanged, onManageIn,
}: {
  panel: AccessPanel;
  /** The signed-in person, for the doc's Restricted confirm. */
  meId?: string | null;
  /** The dialog manages this node: the controls render. Otherwise the state reads as text. */
  canChange: boolean;
  /** After any write the server agreed to: the dialog refetches the panel. */
  onChanged: () => void;
  /** Switch the dialog to an ancestor, from the org-wide line's door. */
  onManageIn?: (target: ManageInTarget) => void;
}) {
  const { node, general, orgName } = panel;
  const visibility = general.visibility ?? "WORKSPACE";

  let body: React.ReactNode = null;
  switch (node.kind) {
    case "space":
      body = (
        <>
          <SpaceVisibilityControl spaceId={node.id} value={visibility} orgName={orgName} readOnly={!canChange} onChanged={onChanged} />
          {visibility === "ORG" ? <p className="m-0 mt-2 text-sm text-ink-2">{spaceOrgLine(orgName)}</p> : null}
        </>
      );
      break;
    case "folder":
      body = (
        <FolderRestrictedSwitch
          folderId={node.id}
          restricted={visibility === "PRIVATE"}
          parentSpaceName={node.space?.name ?? null}
          parentFolderName={general.inheritsFrom?.kind === "folder" ? general.inheritsFrom.name : null}
          readOnly={!canChange}
          onChanged={onChanged}
        />
      );
      break;
    case "list":
      body = (
        <ListVisibilityControl
          boardId={node.id}
          value={visibility}
          spaceName={node.space?.name ?? null}
          parentFolderName={general.inheritsFrom?.kind === "folder" ? general.inheritsFrom.name : null}
          orgName={orgName}
          readOnly={!canChange}
          onChanged={onChanged}
        />
      );
      break;
    case "doc":
      body = (
        <DocGeneralAccess
          docId={node.id}
          restrictConfirm={restrictDocConfirm(panel, meId)}
          restricted={!!general.restricted}
          publicLink={general.publicLink}
          canChange={canChange}
          onChanged={onChanged}
        />
      );
      break;
    case "table":
    case "form":
      body = (
        <PublicLinkSection
          kind={node.kind}
          id={node.id}
          name={node.name}
          publicLink={general.publicLink}
          canChange={canChange}
          orgName={orgName}
          onChanged={onChanged}
        />
      );
      break;
    case "canvas":
      body = null;
      break;
  }

  const orgWide = orgWideLine(panel);
  const orgWideSpace = orgWide ? general.orgWideSpace : null;
  const manages = useManagesSpace(orgWideSpace?.id ?? null, orgWideSpace ? managesViaNode(panel, "space", orgWideSpace.id) : null);
  const door = orgWideSpace && manages ? { id: orgWideSpace.id, name: orgWideSpace.name } : null;

  const restrictedLine = restrictedAboveLine(panel);
  if (!body && !orgWide && !restrictedLine) return null;
  return (
    <section>
      <AccessSectionHeading>General access</AccessSectionHeading>
      {body}
      {restrictedLine ? <p className={`m-0 text-sm text-ink-2 ${body ? "mt-2" : ""}`}>{restrictedLine}</p> : null}
      {orgWide ? (
        <div className={`flex items-start gap-2 rounded-lg border border-line bg-subtle px-3 py-2.5 ${body ? "mt-2" : ""}`}>
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" strokeWidth={1.75} aria-hidden />
          <span className="min-w-0 text-sm text-ink">
            {orgWide}
            {door && onManageIn ? (
              <>
                {" "}
                <button
                  type="button"
                  onClick={() => onManageIn({ kind: "space", id: door.id, name: door.name })}
                  className="font-medium text-brand-deep hover:underline"
                >
                  Manage in {door.name}
                </button>
              </>
            ) : null}
          </span>
        </div>
      ) : null}
    </section>
  );
}
