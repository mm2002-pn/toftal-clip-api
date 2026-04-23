import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../config/database';
import { ApiResponse } from '../../../utils/apiResponse';
import { auditLogFromRequest } from '../../../services/auditLogger';

const VERSION_STATUSES = ['PROCESSING', 'NEEDS_REVIEW', 'CHANGES_REQUESTED', 'APPROVED'] as const;

/**
 * PATCH /api/v1/admin/versions/:id/status
 * Body: { status: VersionStatus }
 */
export const setVersionStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params as { id: string };
    const { status } = req.body as { status?: string };

    if (!status || !VERSION_STATUSES.includes(status as any)) {
      ApiResponse.badRequest(res, `Status must be one of: ${VERSION_STATUSES.join(', ')}`);
      return;
    }

    const existing = await prisma.version.findUnique({
      where: { id },
      select: { status: true, versionNumber: true, deliverableId: true },
    });
    if (!existing) {
      ApiResponse.notFound(res, 'Version not found');
      return;
    }

    const updated = await prisma.version.update({
      where: { id },
      data: { status: status as any },
    });

    auditLogFromRequest(req, 'VERSION_STATUS_CHANGE', {
      targetType: 'version',
      targetId: id,
      metadata: {
        from: existing.status,
        to: status,
        versionNumber: existing.versionNumber,
        deliverableId: existing.deliverableId,
      },
    });

    ApiResponse.success(res, updated, 'Status updated');
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/v1/admin/versions/:id
 * Hard delete (cascades to feedbacks).
 */
export const deleteVersion = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params as { id: string };

    const existing = await prisma.version.findUnique({
      where: { id },
      select: { versionNumber: true, deliverableId: true },
    });
    if (!existing) {
      ApiResponse.notFound(res, 'Version not found');
      return;
    }

    await prisma.version.delete({ where: { id } });

    auditLogFromRequest(req, 'VERSION_DELETE', {
      targetType: 'version',
      targetId: id,
      metadata: { versionNumber: existing.versionNumber, deliverableId: existing.deliverableId },
    });

    ApiResponse.success(res, null, 'Version deleted');
  } catch (error) {
    next(error);
  }
};
