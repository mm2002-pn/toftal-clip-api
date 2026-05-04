import { GraphQLError } from 'graphql/error/GraphQLError';
import { prisma } from '../../config/database';

interface ContextUser {
  id: string;
  role?: string;
  talentModeEnabled?: boolean;
}

/**
 * Share-link grant attached to the GraphQL context when the request carried
 * a valid X-Share-Token header. Whenever this matches the resource we're
 * asserting on, the caller bypasses the project-membership ACL — they have a
 * valid share link, even if they're not a project member (or aren't logged
 * in at all).
 */
interface ContextShare {
  deliverableId: string;
  projectId: string;
  permission: string;
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
 * be the owner, a ProjectMember, or the assigned talent / client. A valid
 * share link (passed via the optional `share` param, sourced from
 * X-Share-Token) also grants access — that's how an authenticated viewer of
 * a /share/video/<token> page reads the parent project resource.
 *
 * Throws GraphQLError (FORBIDDEN) on failure.
 * Throws GraphQLError (UNAUTHENTICATED) if user is missing AND there's no
 * share grant.
 *
 * Returns the minimal project ownership info — callers that already did their
 * own fetch can reuse it if needed.
 */
export async function assertProjectReadAccess(
  projectId: string,
  user: ContextUser | undefined,
  share?: ContextShare
): Promise<{ ownerId: string | null; clientId: string | null; talentId: string | null }> {
  // Share-link grants take precedence — a valid share token authorises the
  // request even when the viewer isn't logged in. We accept it before the
  // unauthenticated guard so /share/video/<token> works for anonymous guests.
  if (share && share.projectId === projectId) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { ownerId: true, clientId: true, talentId: true },
    });
    if (!project) forbidden('Project not found');
    return project!;
  }

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
 * project and defers to `assertProjectReadAccess`. Honours the share grant
 * when it matches this deliverable.
 */
export async function assertDeliverableReadAccess(
  deliverableId: string,
  user: ContextUser | undefined,
  share?: ContextShare
): Promise<string> {
  const deliverable = await prisma.deliverable.findUnique({
    where: { id: deliverableId },
    select: { projectId: true },
  });
  if (!deliverable) forbidden('Deliverable not found');

  // Fast path: the share grant points at exactly this deliverable.
  if (share && share.deliverableId === deliverableId) {
    return deliverable!.projectId;
  }

  if (!user) unauthenticated();

  await assertProjectReadAccess(deliverable!.projectId, user, share);
  return deliverable!.projectId;
}

/**
 * Same contract, for resources scoped to a version (→ deliverable → project).
 */
export async function assertVersionReadAccess(
  versionId: string,
  user: ContextUser | undefined,
  share?: ContextShare
): Promise<{ projectId: string; deliverableId: string }> {
  const version = await prisma.version.findUnique({
    where: { id: versionId },
    select: { deliverableId: true, deliverable: { select: { projectId: true } } },
  });
  if (!version) forbidden('Version not found');

  // Share grant tied to this version's deliverable → bypass user ACL.
  if (share && share.deliverableId === version!.deliverableId) {
    return { projectId: version!.deliverable.projectId, deliverableId: version!.deliverableId };
  }

  if (!user) unauthenticated();

  await assertProjectReadAccess(version!.deliverable.projectId, user, share);
  return { projectId: version!.deliverable.projectId, deliverableId: version!.deliverableId };
}
