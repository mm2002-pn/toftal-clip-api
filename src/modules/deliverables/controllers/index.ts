import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../config/database';
import { ApiResponse } from '../../../utils/apiResponse';
import { NotFoundError } from '../../../utils/errors';

export const updateDeliverable = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { title, type, deadline } = req.body;

    const deliverable = await prisma.deliverable.update({
      where: { id },
      data: { title, type, deadline: deadline ? new Date(deadline) : undefined },
    });

    ApiResponse.success(res, deliverable, 'Deliverable updated');
  } catch (error) {
    next(error);
  }
};

export const deleteDeliverable = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    await prisma.deliverable.delete({ where: { id } });
    ApiResponse.success(res, null, 'Deliverable deleted');
  } catch (error) {
    next(error);
  }
};

export const assignTalent = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { talentId } = req.body;

    const deliverable = await prisma.deliverable.update({
      where: { id },
      data: { assignedTalentId: talentId },
      include: { assignedTalent: { select: { id: true, name: true, avatarUrl: true } } },
    });

    ApiResponse.success(res, deliverable, 'Talent assigned');
  } catch (error) {
    next(error);
  }
};

export const updateStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { status, progress } = req.body;

    const deliverable = await prisma.deliverable.update({
      where: { id },
      data: { status, progress },
    });

    ApiResponse.success(res, deliverable, 'Status updated');
  } catch (error) {
    next(error);
  }
};

export const addVersion = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { videoUrl, description } = req.body;

    // Get next version number
    const lastVersion = await prisma.version.findFirst({
      where: { deliverableId: id },
      orderBy: { versionNumber: 'desc' },
    });

    const versionNumber = (lastVersion?.versionNumber || 0) + 1;

    const version = await prisma.version.create({
      data: {
        deliverableId: id,
        versionNumber,
        videoUrl,
        description,
        uploadedById: req.user!.id,
      },
    });

    // Update deliverable status to REVIEW
    await prisma.deliverable.update({
      where: { id },
      data: { status: 'REVIEW' },
    });

    ApiResponse.created(res, version, 'Version added');
  } catch (error) {
    next(error);
  }
};

export const getVersions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);

    const versions = await prisma.version.findMany({
      where: { deliverableId: id },
      orderBy: { versionNumber: 'desc' },
      include: {
        uploadedBy: { select: { id: true, name: true, avatarUrl: true } },
        feedbacks: { include: { revisionTasks: true, author: true }, orderBy: { createdAt: 'asc' } },
      },
    });

    ApiResponse.success(res, versions);
  } catch (error) {
    next(error);
  }
};

export const addMedia = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { name, url, type, category } = req.body;

    const deliverable = await prisma.deliverable.findUnique({ where: { id } });
    if (!deliverable) throw new NotFoundError('Deliverable not found');

    const media = await prisma.mediaResource.create({
      data: {
        projectId: deliverable.projectId,
        deliverableId: id,
        name,
        url,
        type,
        category,
        addedBy: req.user!.id,
      },
    });

    ApiResponse.created(res, media, 'Media added');
  } catch (error) {
    next(error);
  }
};

export const getMedia = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);

    const media = await prisma.mediaResource.findMany({
      where: { deliverableId: id },
    });

    ApiResponse.success(res, media);
  } catch (error) {
    next(error);
  }
};
