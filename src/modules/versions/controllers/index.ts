import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../config/database';
import { ApiResponse } from '../../../utils/apiResponse';
import { NotFoundError } from '../../../utils/errors';

export const updateVersion = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { description, videoUrl } = req.body;

    const version = await prisma.version.update({
      where: { id },
      data: { description, videoUrl },
    });

    ApiResponse.success(res, version, 'Version updated');
  } catch (error) {
    next(error);
  }
};

export const deleteVersion = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    await prisma.version.delete({ where: { id } });
    ApiResponse.success(res, null, 'Version deleted');
  } catch (error) {
    next(error);
  }
};

export const updateStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { status } = req.body;

    const version = await prisma.version.update({
      where: { id },
      data: { status },
      include: {
        deliverable: {
          include: {
            project: { select: { id: true, title: true } },
            assignedTalent: { select: { id: true } },
          },
        },
      },
    });

    // Notify talent when version is approved
    if (status === 'APPROVED' && version.deliverable?.assignedTalent?.id) {
      await prisma.notification.create({
        data: {
          userId: version.deliverable.assignedTalent.id,
          type: 'VERSION_APPROVED',
          title: 'Version approuvée !',
          message: `Votre version ${version.versionNumber} de "${version.deliverable.title}" a été approuvée`,
          link: `/workspace/${version.deliverable.project?.id}`,
        },
      });
    }

    // Notify talent when changes are requested
    if (status === 'CHANGES_REQUESTED' && version.deliverable?.assignedTalent?.id) {
      await prisma.notification.create({
        data: {
          userId: version.deliverable.assignedTalent.id,
          type: 'VERSION_CHANGES_REQUESTED',
          title: 'Modifications demandées',
          message: `Des modifications ont été demandées sur la version ${version.versionNumber} de "${version.deliverable.title}"`,
          link: `/workspace/${version.deliverable.project?.id}`,
        },
      });
    }

    ApiResponse.success(res, version, 'Status updated');
  } catch (error) {
    next(error);
  }
};

export const addFeedback = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { rawText, structuredText, type, tasks } = req.body;

    // Get version with deliverable info for notification
    const version = await prisma.version.findUnique({
      where: { id },
      include: {
        deliverable: {
          include: {
            project: { select: { id: true, title: true } },
            assignedTalent: { select: { id: true } },
          },
        },
      },
    });

    if (!version) throw new NotFoundError('Version not found');

    // Always create a new feedback (conversation style)
    const feedback = await prisma.feedback.create({
      data: {
        versionId: id,
        authorId: req.user!.id,
        rawText,
        structuredText,
        type: type || 'TEXT',
        revisionTasks: tasks ? {
          create: tasks.map((t: any) => ({ description: t.description })),
        } : undefined,
      },
      include: {
        revisionTasks: true,
        author: {
          select: { id: true, name: true, avatarUrl: true }
        }
      },
    });

    // Update version status
    await prisma.version.update({
      where: { id },
      data: { status: 'CHANGES_REQUESTED' },
    });

    // Notify the assigned talent that feedback was received
    if (version.deliverable?.assignedTalent?.id && version.deliverable.assignedTalent.id !== req.user!.id) {
      await prisma.notification.create({
        data: {
          userId: version.deliverable.assignedTalent.id,
          type: 'FEEDBACK_RECEIVED',
          title: 'Nouveau feedback reçu',
          message: `Un feedback a été ajouté sur la version ${version.versionNumber} de "${version.deliverable.title}"`,
          link: `/workspace/${version.deliverable.project?.id}`,
        },
      });
    }

    ApiResponse.created(res, feedback, 'Feedback added');
  } catch (error) {
    next(error);
  }
};
