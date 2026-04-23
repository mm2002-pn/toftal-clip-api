import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../config/database';
import { ApiResponse } from '../../../utils/apiResponse';
import { auditLogFromRequest } from '../../../services/auditLogger';

/**
 * POST /api/v1/admin/invitations/:id/revoke
 * Marks a PENDING invitation as REJECTED.
 */
export const revokeInvitation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params as { id: string };

    const existing = await prisma.projectInvitation.findUnique({
      where: { id },
      select: { status: true, email: true, projectId: true, inviterUserId: true },
    });
    if (!existing) {
      ApiResponse.notFound(res, 'Invitation not found');
      return;
    }
    if (existing.status !== 'PENDING') {
      ApiResponse.badRequest(res, `Cannot revoke invitation with status ${existing.status}`);
      return;
    }

    const updated = await prisma.projectInvitation.update({
      where: { id },
      data: { status: 'REJECTED', refusedAt: new Date(), refusalReason: 'Revoked by admin' },
    });

    auditLogFromRequest(req, 'INVITATION_REVOKE', {
      targetType: 'invitation',
      targetId: id,
      metadata: { email: existing.email, projectId: existing.projectId, inviterUserId: existing.inviterUserId },
    });

    ApiResponse.success(res, updated, 'Invitation revoked');
  } catch (error) {
    next(error);
  }
};
