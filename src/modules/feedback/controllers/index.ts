import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../config/database';
import { ApiResponse } from '../../../utils/apiResponse';
import { ForbiddenError, NotFoundError } from '../../../utils/errors';
import { socketService } from '../../../services/socketService';
import { cacheService } from '../../../services/cacheService';

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

    // Invalidate feedbacks cache
    await cacheService.invalidateFeedbacks(existingFeedback.versionId);

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

    // Get feedback to invalidate cache
    const feedback = await prisma.feedback.findUnique({
      where: { id },
      select: { versionId: true }
    });

    await prisma.feedback.delete({ where: { id } });

    // Invalidate feedbacks cache
    if (feedback?.versionId) {
      await cacheService.invalidateFeedbacks(feedback.versionId);
    }

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

/**
 * Toggle feedback resolved status (Vimeo-style video review feature)
 * PATCH /api/v1/feedback/:id/resolve
 */
export const toggleFeedbackResolved = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { resolved } = req.body;

    // Get existing feedback to check permissions and get project context
    const existingFeedback = await prisma.feedback.findUnique({
      where: { id },
      include: {
        version: {
          include: {
            deliverable: {
              include: {
                project: { select: { id: true, clientId: true, ownerId: true } }
              }
            }
          }
        }
      }
    });

    if (!existingFeedback) {
      throw new NotFoundError('Feedback not found');
    }

    const project = existingFeedback.version?.deliverable?.project;
    const userId = req.user!.id;

    // Check permissions: author, project owner, or project client can resolve
    const canResolve =
      existingFeedback.authorId === userId ||
      project?.ownerId === userId ||
      project?.clientId === userId;

    if (!canResolve) {
      throw new ForbiddenError('You do not have permission to resolve this comment');
    }

    // Update feedback resolved status
    const feedback = await prisma.feedback.update({
      where: { id },
      data: {
        resolved: resolved === true,
        resolvedAt: resolved === true ? new Date() : null,
        resolvedById: resolved === true ? userId : null
      },
      include: {
        author: {
          select: { id: true, name: true, avatarUrl: true }
        },
        resolvedBy: {
          select: { id: true, name: true, avatarUrl: true }
        },
        revisionTasks: true
      }
    });

    // Invalidate feedbacks cache
    await cacheService.invalidateFeedbacks(existingFeedback.versionId);

    // Emit real-time update to project room
    if (project?.id) {
      socketService.emitToProject(project.id, 'feedback:resolved', {
        id: feedback.id,
        versionId: existingFeedback.versionId,
        resolved: feedback.resolved,
        resolvedAt: feedback.resolvedAt?.toISOString(),
        resolvedById: feedback.resolvedById,
        projectId: project.id,
      });
    }

    ApiResponse.success(res, feedback, resolved ? 'Feedback marked as resolved' : 'Feedback marked as unresolved');
  } catch (error) {
    next(error);
  }
};
