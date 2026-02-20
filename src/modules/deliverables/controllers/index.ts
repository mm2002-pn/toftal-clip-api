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
      data: {
        assignedTalentId: talentId,
        acceptanceStatus: talentId ? 'PENDING' : null,
      },
      include: {
        assignedTalent: { select: { id: true, name: true, avatarUrl: true } },
        project: { select: { id: true, title: true, clientId: true } },
      },
    });

    // Create notification for the assigned talent
    if (talentId && deliverable.project) {
      await prisma.notification.create({
        data: {
          userId: talentId,
          type: 'TALENT_ASSIGNED',
          title: 'Nouveau livrable assigné',
          message: `Vous avez été assigné au livrable "${deliverable.title}" du projet "${deliverable.project.title}"`,
          link: `/workspace/${deliverable.project.id}`,
        },
      });
    }

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

    // Get deliverable with project info for notification
    const deliverable = await prisma.deliverable.findUnique({
      where: { id },
      include: { project: { select: { id: true, title: true, clientId: true } } },
    });

    if (!deliverable) throw new NotFoundError('Deliverable not found');

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

    // Notify the client that a new version was uploaded
    if (deliverable.project?.clientId) {
      await prisma.notification.create({
        data: {
          userId: deliverable.project.clientId,
          type: 'VERSION_UPLOADED',
          title: 'Nouvelle version disponible',
          message: `La version ${versionNumber} de "${deliverable.title}" est prête pour review`,
          link: `/workspace/${deliverable.project.id}`,
        },
      });
    }

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

export const acceptAssignment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);

    // Verify the user is the assigned talent
    const deliverable = await prisma.deliverable.findUnique({
      where: { id },
      include: {
        project: { select: { id: true, title: true, clientId: true } },
      },
    });

    if (!deliverable) throw new NotFoundError('Deliverable not found');
    if (deliverable.assignedTalentId !== req.user!.id) {
      throw new Error('You are not assigned to this deliverable');
    }

    const updated = await prisma.deliverable.update({
      where: { id },
      data: { acceptanceStatus: 'ACCEPTED' },
      include: {
        assignedTalent: { select: { id: true, name: true, avatarUrl: true } },
      },
    });

    // Notify the client that the talent accepted
    if (deliverable.project?.clientId) {
      await prisma.notification.create({
        data: {
          userId: deliverable.project.clientId,
          type: 'ASSIGNMENT_ACCEPTED',
          title: 'Mission acceptée',
          message: `Le talent a accepté de travailler sur "${deliverable.title}"`,
          link: `/workspace/${deliverable.project.id}`,
        },
      });
    }

    ApiResponse.success(res, updated, 'Assignment accepted');
  } catch (error) {
    next(error);
  }
};

export const rejectAssignment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { reason } = req.body;

    // Verify the user is the assigned talent
    const deliverable = await prisma.deliverable.findUnique({
      where: { id },
      include: {
        project: { select: { id: true, title: true, clientId: true } },
        assignedTalent: { select: { id: true, name: true } },
      },
    });

    if (!deliverable) throw new NotFoundError('Deliverable not found');
    if (deliverable.assignedTalentId !== req.user!.id) {
      throw new Error('You are not assigned to this deliverable');
    }

    // Remove assignment and set status to rejected
    const updated = await prisma.deliverable.update({
      where: { id },
      data: {
        acceptanceStatus: 'REJECTED',
        assignedTalentId: null,
      },
    });

    // Notify the client that the talent rejected
    if (deliverable.project?.clientId) {
      await prisma.notification.create({
        data: {
          userId: deliverable.project.clientId,
          type: 'ASSIGNMENT_REJECTED',
          title: 'Mission refusée',
          message: `${deliverable.assignedTalent?.name || 'Le talent'} a refusé de travailler sur "${deliverable.title}"${reason ? `. Raison: ${reason}` : ''}`,
          link: `/workspace/${deliverable.project.id}`,
        },
      });
    }

    ApiResponse.success(res, updated, 'Assignment rejected');
  } catch (error) {
    next(error);
  }
};
