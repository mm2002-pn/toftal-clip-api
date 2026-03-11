import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../config/database';
import { ApiResponse } from '../../../utils/apiResponse';
import { NotFoundError, ForbiddenError } from '../../../utils/errors';
import { socketService } from '../../../services/socketService';

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

    // Get version with full deliverable and project info
    const version = await prisma.version.findUnique({
      where: { id },
      include: {
        deliverable: {
          include: {
            project: { select: { id: true, title: true, clientId: true, ownerId: true } },
            assignedTalent: { select: { id: true } },
          },
        },
      },
    });

    if (!version) throw new NotFoundError('Version not found');

    // Check permissions: only client/owner can approve versions
    if (status === 'APPROVED') {
      const project = version.deliverable?.project;
      if (!project || (project.clientId !== req.user!.id && project.ownerId !== req.user!.id)) {
        throw new ForbiddenError('Only the client can validate versions');
      }
    }

    // Update version status
    const updatedVersion = await prisma.version.update({
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
    if (status === 'APPROVED' && updatedVersion.deliverable?.assignedTalent?.id) {
      const notification = await prisma.notification.create({
        data: {
          userId: updatedVersion.deliverable.assignedTalent.id,
          type: 'VERSION_APPROVED',
          title: 'Version approuvée !',
          message: `Votre version ${updatedVersion.versionNumber} de "${updatedVersion.deliverable.title}" a été approuvée`,
          link: `/workspace/${updatedVersion.deliverable.project?.id}`,
        },
      });

      // Emit real-time notification
      socketService.emitToUser(updatedVersion.deliverable.assignedTalent.id, 'notification:new', notification);
    }

    // Notify talent when changes are requested
    if (status === 'CHANGES_REQUESTED' && updatedVersion.deliverable?.assignedTalent?.id) {
      const notification = await prisma.notification.create({
        data: {
          userId: updatedVersion.deliverable.assignedTalent.id,
          type: 'VERSION_CHANGES_REQUESTED',
          title: 'Modifications demandées',
          message: `Des modifications ont été demandées sur la version ${updatedVersion.versionNumber} de "${updatedVersion.deliverable.title}"`,
          link: `/workspace/${updatedVersion.deliverable.project?.id}`,
        },
      });

      // Emit real-time notification
      socketService.emitToUser(updatedVersion.deliverable.assignedTalent.id, 'notification:new', notification);
    }

    // Emit version status change to project room
    if (updatedVersion.deliverable?.project?.id) {
      socketService.emitToProject(updatedVersion.deliverable.project.id, 'version:status', {
        id: updatedVersion.id,
        versionNumber: updatedVersion.versionNumber,
        status: updatedVersion.status,
        deliverableId: updatedVersion.deliverableId,
        projectId: updatedVersion.deliverable.project.id,
      });
    }

    ApiResponse.success(res, updatedVersion, 'Status updated');
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

    // Update deliverable status to RETOUR (only if current user is the owner/client)
    if (version.deliverable && version.deliverable.projectId) {
      const project = await prisma.project.findUnique({
        where: { id: version.deliverable.projectId },
        select: { ownerId: true, clientId: true }
      });

      // Only change status if the user is the owner or client
      if (project && (project.ownerId === req.user!.id || project.clientId === req.user!.id)) {
        await prisma.deliverable.update({
          where: { id: version.deliverable.id },
          data: { status: 'RETOUR' },
        });
      }
    }

    // Notify the assigned talent that feedback was received
    if (version.deliverable?.assignedTalent?.id && version.deliverable.assignedTalent.id !== req.user!.id) {
      const notification = await prisma.notification.create({
        data: {
          userId: version.deliverable.assignedTalent.id,
          type: 'FEEDBACK_RECEIVED',
          title: 'Nouveau feedback reçu',
          message: `Un feedback a été ajouté sur la version ${version.versionNumber} de "${version.deliverable.title}"`,
          link: `/workspace/${version.deliverable.project?.id}`,
        },
      });

      // Emit real-time notification
      socketService.emitToUser(version.deliverable.assignedTalent.id, 'notification:new', notification);
    }

    // Emit feedback event to project room
    if (version.deliverable?.project?.id) {
      socketService.emitToProject(version.deliverable.project.id, 'feedback:new', {
        id: feedback.id,
        versionId: id,
        authorId: req.user!.id,
        authorName: feedback.author?.name || 'Unknown',
        type: feedback.type,
        projectId: version.deliverable.project.id,
      });
    }

    ApiResponse.created(res, feedback, 'Feedback added');
  } catch (error) {
    next(error);
  }
};
