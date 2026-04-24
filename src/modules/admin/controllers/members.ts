import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../config/database';
import { ApiResponse } from '../../../utils/apiResponse';
import { auditLogFromRequest } from '../../../services/auditLogger';
import { socketService } from '../../../services/socketService';
import { cacheService } from '../../../services/cacheService';

// OWNER is intentionally excluded — a project has a single owner (Project.ownerId)
// and changing it goes through POST /admin/projects/:id/transfer.
const ASSIGNABLE_ROLES = ['COLLABORATOR', 'VIEWER'] as const;

const defaultPermissionsForRole = (role: string) => ({
  view: true,
  edit: role === 'COLLABORATOR',
  comment: true,
  approve: false,
});

const sanitizePermissions = (input: any) => {
  if (!input || typeof input !== 'object') return null;
  return {
    view: !!input.view,
    edit: !!input.edit,
    comment: !!input.comment,
    approve: !!input.approve,
  };
};

/**
 * POST /api/v1/admin/projects/:id/members
 * Body: { userId, role?, permissions? }
 */
export const addMember = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id: projectId } = req.params as { id: string };
    const { userId, role, permissions } = req.body as {
      userId?: string;
      role?: string;
      permissions?: any;
    };

    if (!userId) {
      ApiResponse.badRequest(res, 'userId is required');
      return;
    }

    if (role === 'OWNER') {
      ApiResponse.badRequest(
        res,
        'Cannot assign OWNER via members. Use POST /admin/projects/:id/transfer instead.'
      );
      return;
    }

    const effectiveRole = role && ASSIGNABLE_ROLES.includes(role as any) ? role : 'COLLABORATOR';

    const [project, user, existing] = await Promise.all([
      prisma.project.findUnique({ where: { id: projectId }, select: { id: true, title: true } }),
      prisma.user.findUnique({ where: { id: userId }, select: { id: true } }),
      prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId } },
      }),
    ]);

    if (!project) {
      ApiResponse.notFound(res, 'Project not found');
      return;
    }
    if (!user) {
      ApiResponse.notFound(res, 'User not found');
      return;
    }
    if (existing) {
      ApiResponse.conflict(res, 'User is already a member of this project');
      return;
    }

    // Don't add the project's actual owner as a member — they already have
    // full access via Project.ownerId.
    const projectFull = await prisma.project.findUnique({
      where: { id: projectId },
      select: { ownerId: true, clientId: true },
    });
    if (projectFull && (projectFull.ownerId === userId || projectFull.clientId === userId)) {
      ApiResponse.badRequest(res, 'User is already the owner of this project');
      return;
    }

    const effectivePermissions =
      sanitizePermissions(permissions) ?? defaultPermissionsForRole(effectiveRole);

    const member = await prisma.projectMember.create({
      data: {
        projectId,
        userId,
        role: effectiveRole as any,
        permissions: effectivePermissions as any,
      },
      include: {
        user: { select: { id: true, name: true, email: true, avatarUrl: true } },
      },
    });

    auditLogFromRequest(req, 'MEMBER_ADD', {
      targetType: 'project',
      targetId: projectId,
      metadata: { memberUserId: userId, role: effectiveRole, permissions: effectivePermissions },
    });

    // Keep membership changes consistent with the regular invitation flow:
    // join the new member's live sockets into the project room, then broadcast
    // the event to everyone else in the room.
    socketService.addUserToProjectRoom(userId, projectId);
    socketService.emitToProject(projectId, 'project:member:added', {
      projectId,
      userId,
      userName: member.user.name,
      userEmail: member.user.email,
      role: member.role,
      addedBy: (req as any).user?.id,
    });
    await cacheService.invalidateProjectMembers(projectId);

    ApiResponse.created(res, member, 'Member added');
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/v1/admin/projects/:id/members/:memberId
 * Body: { role?, permissions? }
 */
export const updateMember = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id: projectId, memberId } = req.params as { id: string; memberId: string };
    const { role, permissions } = req.body as { role?: string; permissions?: any };

    const existing = await prisma.projectMember.findUnique({
      where: { id: memberId },
      include: { user: { select: { id: true } } },
    });
    if (!existing || existing.projectId !== projectId) {
      ApiResponse.notFound(res, 'Member not found');
      return;
    }

    if (role === 'OWNER') {
      ApiResponse.badRequest(
        res,
        'Cannot promote to OWNER via members. Use POST /admin/projects/:id/transfer instead.'
      );
      return;
    }

    const data: any = {};
    if (role && ASSIGNABLE_ROLES.includes(role as any)) data.role = role;
    const sanitized = sanitizePermissions(permissions);
    if (sanitized) data.permissions = sanitized;

    if (Object.keys(data).length === 0) {
      ApiResponse.badRequest(res, 'Nothing to update');
      return;
    }

    const member = await prisma.projectMember.update({
      where: { id: memberId },
      data,
      include: {
        user: { select: { id: true, name: true, email: true, avatarUrl: true } },
      },
    });

    auditLogFromRequest(req, 'MEMBER_UPDATE', {
      targetType: 'project',
      targetId: projectId,
      metadata: {
        memberUserId: existing.user.id,
        from: { role: existing.role, permissions: existing.permissions },
        to: { role: member.role, permissions: member.permissions },
      },
    });

    // Broadcast role changes if the role actually changed — same event the
    // /invitations route emits so frontend listeners stay unified.
    if (data.role && data.role !== existing.role) {
      socketService.emitToProject(projectId, 'project:member:role-updated', {
        projectId,
        userId: existing.user.id,
        userName: member.user.name,
        newRole: member.role,
        oldRole: existing.role,
        updatedBy: (req as any).user?.id,
      });
    }
    await cacheService.invalidateProjectMembers(projectId);

    ApiResponse.success(res, member, 'Member updated');
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/v1/admin/projects/:id/members/:memberId
 */
export const removeMember = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id: projectId, memberId } = req.params as { id: string; memberId: string };

    const existing = await prisma.projectMember.findUnique({
      where: { id: memberId },
      include: { user: { select: { id: true, email: true } } },
    });
    if (!existing || existing.projectId !== projectId) {
      ApiResponse.notFound(res, 'Member not found');
      return;
    }

    await prisma.projectMember.delete({ where: { id: memberId } });

    auditLogFromRequest(req, 'MEMBER_REMOVE', {
      targetType: 'project',
      targetId: projectId,
      metadata: { memberUserId: existing.user.id, email: existing.user.email, role: existing.role },
    });

    // Notify the removed user on their personal room (they just left the
    // project room so room broadcast wouldn't reach them), then broadcast
    // to remaining project members, then drop the user's sockets from
    // the project room.
    const removedPayload = {
      projectId,
      userId: existing.user.id,
      userName: (existing as any).user?.email ?? '',
      removedBy: (req as any).user?.id,
    };
    socketService.emitToUser(existing.user.id, 'project:member:removed', removedPayload);
    socketService.emitToProject(projectId, 'project:member:removed', removedPayload);
    socketService.removeUserFromProjectRoom(existing.user.id, projectId);
    await cacheService.invalidateProjectMembers(projectId);

    ApiResponse.success(res, null, 'Member removed');
  } catch (error) {
    next(error);
  }
};
