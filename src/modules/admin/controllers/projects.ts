import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../config/database';
import { ApiResponse } from '../../../utils/apiResponse';
import { auditLogFromRequest } from '../../../services/auditLogger';

const SELECT_PROJECT = {
  id: true,
  title: true,
  type: true,
  status: true,
  ownerId: true,
  clientId: true,
  talentId: true,
  isArchived: true,
  archivedAt: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
  deadline: true,
  startDate: true,
  owner: { select: { id: true, email: true, name: true } },
  client: { select: { id: true, email: true, name: true } },
} as const;

/**
 * POST /api/v1/admin/projects/:id/transfer
 * Body: { newOwnerId }
 */
export const transferProject = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params as { id: string };
    const { newOwnerId } = req.body as { newOwnerId?: string };

    if (!newOwnerId || typeof newOwnerId !== 'string') {
      ApiResponse.badRequest(res, 'newOwnerId is required');
      return;
    }

    const [project, newOwner] = await Promise.all([
      prisma.project.findUnique({ where: { id }, select: { id: true, ownerId: true, title: true } }),
      prisma.user.findUnique({ where: { id: newOwnerId }, select: { id: true, email: true } }),
    ]);

    if (!project) {
      ApiResponse.notFound(res, 'Project not found');
      return;
    }
    if (!newOwner) {
      ApiResponse.notFound(res, 'New owner not found');
      return;
    }
    if (project.ownerId === newOwnerId) {
      ApiResponse.badRequest(res, 'Already owned by this user');
      return;
    }

    const updated = await prisma.project.update({
      where: { id },
      data: { ownerId: newOwnerId },
      select: SELECT_PROJECT,
    });

    auditLogFromRequest(req, 'PROJECT_TRANSFER', {
      targetType: 'project',
      targetId: id,
      metadata: { fromOwnerId: project.ownerId, toOwnerId: newOwnerId, title: project.title },
    });

    ApiResponse.success(res, updated, 'Ownership transferred');
  } catch (error) {
    next(error);
  }
};

const PROJECT_STATUSES = ['DRAFT', 'PENDING', 'MATCHING', 'IN_PROGRESS', 'REVIEW', 'COMPLETED', 'ARCHIVED'] as const;

/**
 * PATCH /api/v1/admin/projects/:id/status
 * Body: { status: ProjectStatus }
 */
export const setProjectStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params as { id: string };
    const { status } = req.body as { status?: string };

    if (!status || !PROJECT_STATUSES.includes(status as any)) {
      ApiResponse.badRequest(res, `Status must be one of: ${PROJECT_STATUSES.join(', ')}`);
      return;
    }

    const existing = await prisma.project.findUnique({
      where: { id },
      select: { status: true, title: true, isArchived: true },
    });
    if (!existing) {
      ApiResponse.notFound(res, 'Project not found');
      return;
    }

    const updated = await prisma.project.update({
      where: { id },
      data: {
        status: status as any,
        isArchived: status === 'ARCHIVED' ? true : existing.isArchived && status !== 'ARCHIVED' ? false : existing.isArchived,
        archivedAt: status === 'ARCHIVED' ? new Date() : existing.isArchived && status !== 'ARCHIVED' ? null : undefined,
      },
      select: SELECT_PROJECT,
    });

    auditLogFromRequest(req, 'PROJECT_STATUS_CHANGE', {
      targetType: 'project',
      targetId: id,
      metadata: { from: existing.status, to: status, title: existing.title },
    });

    ApiResponse.success(res, updated, 'Status updated');
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/v1/admin/projects/:id/archive
 * Body: { archived: boolean }
 */
export const setProjectArchived = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params as { id: string };
    const { archived } = req.body as { archived?: boolean };

    if (typeof archived !== 'boolean') {
      ApiResponse.badRequest(res, 'archived must be a boolean');
      return;
    }

    const existing = await prisma.project.findUnique({
      where: { id },
      select: { id: true, isArchived: true, status: true, title: true },
    });
    if (!existing) {
      ApiResponse.notFound(res, 'Project not found');
      return;
    }

    const updated = await prisma.project.update({
      where: { id },
      data: {
        isArchived: archived,
        archivedAt: archived ? new Date() : null,
        status: archived ? 'ARCHIVED' : existing.status === 'ARCHIVED' ? 'IN_PROGRESS' : existing.status,
      },
      select: SELECT_PROJECT,
    });

    auditLogFromRequest(req, archived ? 'PROJECT_ARCHIVE' : 'PROJECT_UNARCHIVE', {
      targetType: 'project',
      targetId: id,
      metadata: { title: existing.title },
    });

    ApiResponse.success(res, updated, archived ? 'Project archived' : 'Project unarchived');
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/v1/admin/projects/:id
 * Soft delete — sets deletedAt.
 */
export const deleteProject = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params as { id: string };

    const existing = await prisma.project.findUnique({
      where: { id },
      select: { id: true, deletedAt: true, title: true, ownerId: true },
    });
    if (!existing) {
      ApiResponse.notFound(res, 'Project not found');
      return;
    }
    if (existing.deletedAt) {
      ApiResponse.badRequest(res, 'Project already deleted');
      return;
    }

    await prisma.project.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    auditLogFromRequest(req, 'PROJECT_DELETE', {
      targetType: 'project',
      targetId: id,
      metadata: { title: existing.title, ownerId: existing.ownerId },
    });

    ApiResponse.success(res, null, 'Project deleted');
  } catch (error) {
    next(error);
  }
};
