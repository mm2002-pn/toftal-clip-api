import { GraphQLError } from 'graphql/error/GraphQLError';
import { prisma } from '../../config/database';

interface ContextUser {
  id: string;
  role?: string;
  talentModeEnabled?: boolean;
}

const forbidden = (msg = 'Access denied'): never => {
  throw new GraphQLError(msg, {
    extensions: { code: 'FORBIDDEN', http: { status: 403 } },
  });
};

const unauthenticated = (): never => {
  throw new GraphQLError('Authentication required', {
    extensions: { code: 'UNAUTHENTICATED', http: { status: 401 } },
  });
};

/**
 * Check that `user` can read `projectId`. Admins pass. Otherwise the user must
 * be the owner, a ProjectMember, or the assigned talent / client.
 *
 * Throws GraphQLError (FORBIDDEN) on failure.
 * Throws GraphQLError (UNAUTHENTICATED) if user is missing.
 *
 * Returns the minimal project ownership info — callers that already did their
 * own fetch can reuse it if needed.
 */
export async function assertProjectReadAccess(
  projectId: string,
  user: ContextUser | undefined
): Promise<{ ownerId: string | null; clientId: string | null; talentId: string | null }> {
  if (!user) unauthenticated();

  // Admins bypass project-level ACL entirely.
  if (user!.role === 'ADMIN') {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { ownerId: true, clientId: true, talentId: true },
    });
    if (!project) forbidden('Project not found');
    return project!;
  }

  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      OR: [
        { ownerId: user!.id },
        { clientId: user!.id },
        { talentId: user!.id },
        { members: { some: { userId: user!.id } } },
      ],
    },
    select: { ownerId: true, clientId: true, talentId: true },
  });

  if (!project) forbidden();
  return project!;
}

/**
 * Same contract, for resources scoped to a deliverable. Looks up the parent
 * project and defers to `assertProjectReadAccess`.
 */
export async function assertDeliverableReadAccess(
  deliverableId: string,
  user: ContextUser | undefined
): Promise<string> {
  if (!user) unauthenticated();

  const deliverable = await prisma.deliverable.findUnique({
    where: { id: deliverableId },
    select: { projectId: true },
  });
  if (!deliverable) forbidden('Deliverable not found');

  await assertProjectReadAccess(deliverable!.projectId, user);
  return deliverable!.projectId;
}

/**
 * Same contract, for resources scoped to a version (→ deliverable → project).
 */
export async function assertVersionReadAccess(
  versionId: string,
  user: ContextUser | undefined
): Promise<{ projectId: string; deliverableId: string }> {
  if (!user) unauthenticated();

  const version = await prisma.version.findUnique({
    where: { id: versionId },
    select: { deliverableId: true, deliverable: { select: { projectId: true } } },
  });
  if (!version) forbidden('Version not found');

  await assertProjectReadAccess(version!.deliverable.projectId, user);
  return { projectId: version!.deliverable.projectId, deliverableId: version!.deliverableId };
}
