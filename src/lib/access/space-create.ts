// Who may create a Space, as ONE server answer (Phase 8 stage E fix): POST
// /api/spaces, the Space template apply route, the /spaces page's New Space
// button and the boot payload's viewer.canCreateSpace (which every client New
// Space control reads) all ask this, so a control shows exactly when its
// handler lets the person through.
//
//   ACCESS_V2_RESOLVER off   today's rule: the manager tier that creates
//                            Spaces (SPACE_CREATE_LEVELS)
//   ACCESS_V2_RESOLVER on    access toggle 1, "Who can create Spaces"
//                            (everyone, or Owners and Admins), through the
//                            engine's create_space verb
//
// Server-only.

import { accessV2Resolver } from "./flags";
import { SPACE_CREATE_LEVELS } from "@/lib/template-center";

export async function mayCreateSpace(accessLevel: string | null | undefined): Promise<boolean> {
  if (accessV2Resolver()) {
    const { engineOrgAllows } = await import("./matrix-engine");
    return engineOrgAllows("create_space");
  }
  return !!accessLevel && SPACE_CREATE_LEVELS.has(accessLevel);
}

/** The refusal sentence for the flag state, the same on every door. */
export function spaceCreateRefusal(): string {
  return accessV2Resolver() ? "Only Owners and Admins create Spaces here." : "Manager-level access required to create Spaces.";
}
