import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../config/database';
import { ApiResponse } from '../../../utils/apiResponse';
import { auditLogFromRequest } from '../../../services/auditLogger';

const SELECT_USER = {
  id: true,
  email: true,
  name: true,
  role: true,
  avatarUrl: true,
  authProvider: true,
  emailVerified: true,
  accountStatus: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * PATCH /api/v1/admin/users/:id/role
 * Body: { role: 'USER' | 'ADMIN' }
 */
export const setUserRole = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params as { id: string };
    const { role } = req.body as { role?: string };

    if (!role || !['USER', 'ADMIN'].includes(role)) {
      ApiResponse.badRequest(res, 'Role must be USER or ADMIN');
      return;
    }
    if (id === (req as any).user?.id && role !== 'ADMIN') {
      ApiResponse.badRequest(res, 'You cannot demote yourself');
      return;
    }

    const existing = await prisma.user.findUnique({ where: { id }, select: { role: true } });
    if (!existing) {
      ApiResponse.notFound(res, 'User not found');
      return;
    }

    const user = await prisma.user.update({
      where: { id },
      data: { role: role as any },
      select: SELECT_USER,
    });

    auditLogFromRequest(req, 'USER_ROLE_CHANGE', {
      targetType: 'user',
      targetId: id,
      metadata: { from: existing.role, to: role },
    });

    ApiResponse.success(res, user, 'Role updated');
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/v1/admin/users/:id/suspend
 * Body: { suspended: boolean }
 * Maps to accountStatus = ARCHIVED (suspended) | ACTIVE (unsuspended).
 */
export const setUserSuspended = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params as { id: string };
    const { suspended } = req.body as { suspended?: boolean };

    if (typeof suspended !== 'boolean') {
      ApiResponse.badRequest(res, 'suspended must be a boolean');
      return;
    }
    if (id === (req as any).user?.id) {
      ApiResponse.badRequest(res, 'You cannot suspend yourself');
      return;
    }

    const existing = await prisma.user.findUnique({ where: { id }, select: { accountStatus: true } });
    if (!existing) {
      ApiResponse.notFound(res, 'User not found');
      return;
    }

    const user = await prisma.user.update({
      where: { id },
      data: {
        accountStatus: suspended ? 'ARCHIVED' : 'ACTIVE',
        archivedAt: suspended ? new Date() : null,
      },
      select: SELECT_USER,
    });

    auditLogFromRequest(req, suspended ? 'USER_SUSPEND' : 'USER_UNSUSPEND', {
      targetType: 'user',
      targetId: id,
      metadata: { from: existing.accountStatus, to: suspended ? 'ARCHIVED' : 'ACTIVE' },
    });

    ApiResponse.success(res, user, suspended ? 'User suspended' : 'User reactivated');
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/v1/admin/users/:id/restore
 * Restore a DELETED or ARCHIVED user back to ACTIVE.
 */
export const restoreUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params as { id: string };

    const existing = await prisma.user.findUnique({ where: { id }, select: { accountStatus: true } });
    if (!existing) {
      ApiResponse.notFound(res, 'User not found');
      return;
    }
    if (existing.accountStatus === 'ACTIVE') {
      ApiResponse.badRequest(res, 'User is already active');
      return;
    }

    const user = await prisma.user.update({
      where: { id },
      data: { accountStatus: 'ACTIVE', archivedAt: null },
      select: SELECT_USER,
    });

    auditLogFromRequest(req, 'USER_RESTORE', {
      targetType: 'user',
      targetId: id,
      metadata: { from: existing.accountStatus, to: 'ACTIVE' },
    });

    ApiResponse.success(res, user, 'User restored');
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/v1/admin/users/:id
 * Soft delete (accountStatus = DELETED).
 */
export const deleteUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params as { id: string };

    if (id === (req as any).user?.id) {
      ApiResponse.badRequest(res, 'You cannot delete yourself');
      return;
    }

    const existing = await prisma.user.findUnique({ where: { id }, select: { accountStatus: true, email: true } });
    if (!existing) {
      ApiResponse.notFound(res, 'User not found');
      return;
    }

    await prisma.user.update({
      where: { id },
      data: {
        accountStatus: 'DELETED',
        archivedAt: new Date(),
      },
    });

    auditLogFromRequest(req, 'USER_DELETE', {
      targetType: 'user',
      targetId: id,
      metadata: { email: existing.email },
    });

    ApiResponse.success(res, null, 'User deleted');
  } catch (error) {
    next(error);
  }
};
