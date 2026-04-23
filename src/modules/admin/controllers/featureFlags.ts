import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../config/database';
import { ApiResponse } from '../../../utils/apiResponse';
import { auditLogFromRequest } from '../../../services/auditLogger';

const NAME_REGEX = /^[a-z0-9_]+$/;

/**
 * POST /api/v1/admin/feature-flags
 * Body: { name, description?, enabled? }
 */
export const createFeatureFlag = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { name, description, enabled } = req.body as {
      name?: string;
      description?: string;
      enabled?: boolean;
    };

    if (!name || typeof name !== 'string' || !NAME_REGEX.test(name)) {
      ApiResponse.badRequest(res, 'name is required (lowercase alphanumeric + underscore)');
      return;
    }

    const existing = await prisma.featureFlag.findUnique({ where: { name } });
    if (existing) {
      ApiResponse.conflict(res, 'A flag with this name already exists');
      return;
    }

    const flag = await prisma.featureFlag.create({
      data: {
        name,
        description: description?.trim() || null,
        enabled: !!enabled,
      },
    });

    auditLogFromRequest(req, 'FEATURE_FLAG_CREATE', {
      targetType: 'feature_flag' as any,
      targetId: flag.id,
      metadata: { name, enabled: flag.enabled },
    });

    ApiResponse.created(res, flag, 'Feature flag created');
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/v1/admin/feature-flags/:id
 * Body: { enabled?: boolean, description?: string }
 */
export const updateFeatureFlag = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params as { id: string };
    const { enabled, description } = req.body as { enabled?: boolean; description?: string };

    const existing = await prisma.featureFlag.findUnique({ where: { id } });
    if (!existing) {
      ApiResponse.notFound(res, 'Feature flag not found');
      return;
    }

    const data: { enabled?: boolean; description?: string | null } = {};
    if (typeof enabled === 'boolean') data.enabled = enabled;
    if (typeof description === 'string') data.description = description.trim() || null;

    if (Object.keys(data).length === 0) {
      ApiResponse.badRequest(res, 'Nothing to update');
      return;
    }

    const flag = await prisma.featureFlag.update({ where: { id }, data });

    auditLogFromRequest(req, 'FEATURE_FLAG_UPDATE', {
      targetType: 'feature_flag' as any,
      targetId: id,
      metadata: {
        name: existing.name,
        from: { enabled: existing.enabled, description: existing.description },
        to: { enabled: flag.enabled, description: flag.description },
      },
    });

    ApiResponse.success(res, flag, 'Feature flag updated');
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/v1/admin/feature-flags/:id
 */
export const deleteFeatureFlag = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params as { id: string };

    const existing = await prisma.featureFlag.findUnique({ where: { id } });
    if (!existing) {
      ApiResponse.notFound(res, 'Feature flag not found');
      return;
    }

    await prisma.featureFlag.delete({ where: { id } });

    auditLogFromRequest(req, 'FEATURE_FLAG_DELETE', {
      targetType: 'feature_flag' as any,
      targetId: id,
      metadata: { name: existing.name },
    });

    ApiResponse.success(res, null, 'Feature flag deleted');
  } catch (error) {
    next(error);
  }
};
