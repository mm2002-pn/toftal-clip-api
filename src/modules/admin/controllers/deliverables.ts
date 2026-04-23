import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../config/database';
import { ApiResponse } from '../../../utils/apiResponse';
import { auditLogFromRequest } from '../../../services/auditLogger';

const DELIVERABLE_STATUSES = ['PREPARATION', 'PRODUCTION', 'RETOUR', 'VALIDATION', 'VALIDE'] as const;

/**
 * PATCH /api/v1/admin/deliverables/:id/status
 * Body: { status: DeliverableStatus }
 */
export const setDeliverableStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params as { id: string };
    const { status } = req.body as { status?: string };

    if (!status || !DELIVERABLE_STATUSES.includes(status as any)) {
      ApiResponse.badRequest(res, `Status must be one of: ${DELIVERABLE_STATUSES.join(', ')}`);
      return;
    }

    const existing = await prisma.deliverable.findUnique({
      where: { id },
      select: { status: true, title: true, projectId: true },
    });
    if (!existing) {
      ApiResponse.notFound(res, 'Deliverable not found');
      return;
    }

    const updated = await prisma.deliverable.update({
      where: { id },
      data: { status: status as any },
    });

    auditLogFromRequest(req, 'DELIVERABLE_STATUS_CHANGE', {
      targetType: 'deliverable',
      targetId: id,
      metadata: { from: existing.status, to: status, title: existing.title, projectId: existing.projectId },
    });

    ApiResponse.success(res, updated, 'Status updated');
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/v1/admin/deliverables/:id
 * Hard delete (cascades to versions, feedbacks, workflow phases).
 */
export const deleteDeliverable = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params as { id: string };

    const existing = await prisma.deliverable.findUnique({
      where: { id },
      select: { title: true, projectId: true },
    });
    if (!existing) {
      ApiResponse.notFound(res, 'Deliverable not found');
      return;
    }

    await prisma.deliverable.delete({ where: { id } });

    auditLogFromRequest(req, 'DELIVERABLE_DELETE', {
      targetType: 'deliverable',
      targetId: id,
      metadata: { title: existing.title, projectId: existing.projectId },
    });

    ApiResponse.success(res, null, 'Deliverable deleted');
  } catch (error) {
    next(error);
  }
};
