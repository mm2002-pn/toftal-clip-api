import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../config/database';
import { ApiResponse } from '../../../utils/apiResponse';
import { auditLogFromRequest } from '../../../services/auditLogger';

/**
 * POST /api/v1/admin/storage/purge-old-versions
 * Body: { olderThanDays: number, onlyNonApproved?: boolean }
 *
 * Hard-deletes Version rows (cascades to feedbacks) for old, superseded
 * versions. Does NOT delete the GCS file itself (that's a separate
 * backfill/cleanup job — TODO).
 */
export const purgeOldVersions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { olderThanDays, onlyNonApproved } = req.body as {
      olderThanDays?: number;
      onlyNonApproved?: boolean;
    };

    if (!Number.isFinite(olderThanDays) || (olderThanDays as number) < 30) {
      ApiResponse.badRequest(res, 'olderThanDays must be >= 30 (safety)');
      return;
    }

    const cutoff = new Date(Date.now() - (olderThanDays as number) * 24 * 60 * 60 * 1000);

    // Find old superseded versions. A version is "superseded" when a newer
    // version exists for the same deliverable.
    const candidates = await prisma.$queryRaw<Array<{ id: string; deliverable_id: string; version_number: number; file_size: bigint | null }>>`
      SELECT v.id, v.deliverable_id, v.version_number, v.file_size
      FROM versions v
      WHERE v.created_at < ${cutoff}
        AND EXISTS (
          SELECT 1 FROM versions v2
          WHERE v2.deliverable_id = v.deliverable_id
            AND v2.version_number > v.version_number
        )
        ${onlyNonApproved ? `AND v.status != 'APPROVED'` : ``}
    `;

    const ids = candidates.map((c) => c.id);
    const totalBytes = candidates.reduce((acc, c) => acc + Number(c.file_size ?? 0), 0);

    if (ids.length === 0) {
      ApiResponse.success(res, { deleted: 0, freedBytes: 0 }, 'No versions to purge');
      return;
    }

    await prisma.version.deleteMany({ where: { id: { in: ids } } });

    auditLogFromRequest(req, 'STORAGE_PURGE_VERSIONS', {
      targetType: 'storage',
      metadata: { olderThanDays, onlyNonApproved: !!onlyNonApproved, deleted: ids.length, freedBytes: totalBytes },
    });

    ApiResponse.success(res, { deleted: ids.length, freedBytes: totalBytes }, 'Versions purged');
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/admin/storage/purge-deleted-projects
 * Body: { olderThanDays: number }
 *
 * Hard-deletes projects that have been soft-deleted for more than N days.
 * Cascades to deliverables, versions, feedbacks, media resources.
 */
export const purgeDeletedProjects = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { olderThanDays } = req.body as { olderThanDays?: number };

    if (!Number.isFinite(olderThanDays) || (olderThanDays as number) < 30) {
      ApiResponse.badRequest(res, 'olderThanDays must be >= 30 (safety)');
      return;
    }

    const cutoff = new Date(Date.now() - (olderThanDays as number) * 24 * 60 * 60 * 1000);

    const candidates = await prisma.project.findMany({
      where: {
        deletedAt: { not: null, lt: cutoff },
      },
      select: { id: true, title: true },
    });

    if (candidates.length === 0) {
      ApiResponse.success(res, { deleted: 0 }, 'No projects to purge');
      return;
    }

    await prisma.project.deleteMany({ where: { id: { in: candidates.map((c) => c.id) } } });

    auditLogFromRequest(req, 'STORAGE_PURGE_PROJECTS', {
      targetType: 'storage',
      metadata: { olderThanDays, deleted: candidates.length, titles: candidates.map((c) => c.title) },
    });

    ApiResponse.success(res, { deleted: candidates.length }, 'Projects purged');
  } catch (error) {
    next(error);
  }
};
