import { prisma } from "@/lib/prisma";
import type { EntityLinkType, EntityLinkRelation } from "@/generated/prisma";

export type { EntityLinkType, EntityLinkRelation };

export interface EntityRef {
  type: EntityLinkType;
  id: string;
}

export interface EntityLinkCreateInput {
  organizationId: string;
  source: EntityRef;
  target: EntityRef;
  relationKind?: EntityLinkRelation;
  position?: number;
  context?: string;
  createdById?: string | null;
}

export async function createEntityLink(input: EntityLinkCreateInput) {
  return prisma.entityLink.upsert({
    where: {
      sourceType_sourceId_targetType_targetId_relationKind: {
        sourceType: input.source.type,
        sourceId: input.source.id,
        targetType: input.target.type,
        targetId: input.target.id,
        relationKind: input.relationKind ?? "LINKED",
      },
    },
    create: {
      organizationId: input.organizationId,
      sourceType: input.source.type,
      sourceId: input.source.id,
      targetType: input.target.type,
      targetId: input.target.id,
      relationKind: input.relationKind ?? "LINKED",
      position: input.position ?? 0,
      context: input.context,
      createdById: input.createdById ?? null,
    },
    update: {
      position: input.position,
      context: input.context,
    },
  });
}

export async function removeEntityLink(input: {
  organizationId: string;
  source: EntityRef;
  target: EntityRef;
  relationKind?: EntityLinkRelation;
}) {
  return prisma.entityLink.deleteMany({
    where: {
      organizationId: input.organizationId,
      sourceType: input.source.type,
      sourceId: input.source.id,
      targetType: input.target.type,
      targetId: input.target.id,
      relationKind: input.relationKind,
    },
  });
}

export async function listLinksFrom(input: {
  organizationId: string;
  source: EntityRef;
  relationKind?: EntityLinkRelation;
  targetType?: EntityLinkType;
}) {
  return prisma.entityLink.findMany({
    where: {
      organizationId: input.organizationId,
      sourceType: input.source.type,
      sourceId: input.source.id,
      relationKind: input.relationKind,
      targetType: input.targetType,
    },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
}

export async function listLinksTo(input: {
  organizationId: string;
  target: EntityRef;
  relationKind?: EntityLinkRelation;
  sourceType?: EntityLinkType;
}) {
  return prisma.entityLink.findMany({
    where: {
      organizationId: input.organizationId,
      targetType: input.target.type,
      targetId: input.target.id,
      relationKind: input.relationKind,
      sourceType: input.sourceType,
    },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
}

export async function reorderLinks(input: {
  organizationId: string;
  source: EntityRef;
  orderedTargets: { type: EntityLinkType; id: string }[];
  relationKind?: EntityLinkRelation;
}) {
  const kind = input.relationKind ?? "LINKED";
  await prisma.$transaction(
    input.orderedTargets.map((t, i) =>
      prisma.entityLink.updateMany({
        where: {
          organizationId: input.organizationId,
          sourceType: input.source.type,
          sourceId: input.source.id,
          targetType: t.type,
          targetId: t.id,
          relationKind: kind,
        },
        data: { position: i },
      }),
    ),
  );
}
