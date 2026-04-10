import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../config/database';
import { ApiResponse } from '../../../utils/apiResponse';
import { ForbiddenError, NotFoundError } from '../../../utils/errors';
import { socketService } from '../../../services/socketService';

export const updateFeedback = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { rawText, structuredText } = req.body;

    // Get existing feedback to check ownership
    const existingFeedback = await prisma.feedback.findUnique({
      where: { id },
      include: {
        version: {
          include: {
            deliverable: {
              include: {
                project: { select: { id: true } }
              }
            }
          }
        }
      }
    });

    if (!existingFeedback) {
      throw new NotFoundError('Feedback not found');
    }

    // Only the author can edit their own feedback
    if (existingFeedback.authorId !== req.user!.id) {
      throw new ForbiddenError('You can only edit your own comments');
    }

    // Update feedback with editedAt timestamp
    const feedback = await prisma.feedback.update({
      where: { id },
      data: {
        rawText,
        structuredText,
        editedAt: new Date() // Mark as edited
      },
      include: {
        author: {
          select: { id: true, name: true, avatarUrl: true }
        },
        revisionTasks: true,
        replyingTo: {
          select: {
            id: true,
            rawText: true,
            structuredText: true,
            author: { select: { id: true, name: true } }
          }
        }
      }
    });

    // Emit real-time update to project room
    const projectId = existingFeedback.version?.deliverable?.project?.id;
    if (projectId) {
      socketService.emitToProject(projectId, 'feedback:updated', {
        id: feedback.id,
        versionId: existingFeedback.versionId,
        rawText: feedback.rawText,
        structuredText: feedback.structuredText,
        editedAt: feedback.editedAt,
        projectId,
      });
    }

    ApiResponse.success(res, feedback, 'Feedback updated');
  } catch (error) {
    next(error);
  }
};

export const deleteFeedback = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    await prisma.feedback.delete({ where: { id } });
    ApiResponse.success(res, null, 'Feedback deleted');
  } catch (error) {
    next(error);
  }
};

export const toggleRevisionTask = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const taskId = String(req.params.taskId);

    const task = await prisma.revisionTask.findUnique({ where: { id: taskId } });

    const updated = await prisma.revisionTask.update({
      where: { id: taskId },
      data: { completed: !task?.completed },
    });

    ApiResponse.success(res, updated, 'Task toggled');
  } catch (error) {
    next(error);
  }
};

export const addRevisionTask = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { description } = req.body;

    const task = await prisma.revisionTask.create({
      data: { feedbackId: id, description },
    });

    ApiResponse.created(res, task, 'Revision task added');
  } catch (error) {
    next(error);
  }
};

export const deleteRevisionTask = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const taskId = String(req.params.taskId);
    await prisma.revisionTask.delete({ where: { id: taskId } });
    ApiResponse.success(res, null, 'Revision task deleted');
  } catch (error) {
    next(error);
  }
};
