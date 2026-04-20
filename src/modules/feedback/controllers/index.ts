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

/**
 * Mark one or more feedbacks as read by the current user.
 * Idempotent via FeedbackRead unique constraint (feedbackId, userId).
 * Broadcasts 'feedback:read' to the deliverable room so senders update their
 * WhatsApp-style double-check indicator in real time.
 */
export const bulkMarkFeedbacksAsRead = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { feedbackIds } = req.body as { feedbackIds?: unknown };

    if (!Array.isArray(feedbackIds) || feedbackIds.length === 0) {
      ApiResponse.badRequest(res, 'feedbackIds must be a non-empty array');
      return;
    }
    if (feedbackIds.length > 200) {
      ApiResponse.badRequest(res, 'feedbackIds length exceeds 200');
      return;
    }
    const ids = feedbackIds.filter((v): v is string => typeof v === 'string');
    if (ids.length === 0) {
      ApiResponse.badRequest(res, 'feedbackIds must contain strings');
      return;
    }

    // Fetch feedbacks to derive deliverable IDs and skip own feedbacks
    const feedbacks = await prisma.feedback.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        authorId: true,
        version: { select: { deliverableId: true } },
      },
    });

    const othersFeedbackIds = feedbacks
      .filter((f) => f.authorId !== userId)
      .map((f) => f.id);

    if (othersFeedbackIds.length === 0) {
      ApiResponse.success(res, { marked: 0 });
      return;
    }

    const readAt = new Date();
    const result = await prisma.feedbackRead.createMany({
      data: othersFeedbackIds.map((feedbackId) => ({ feedbackId, userId, readAt })),
      skipDuplicates: true,
    });

    // Broadcast per deliverable for efficient fan-out
    const byDeliverable = new Map<string, string[]>();
    for (const f of feedbacks) {
      if (!othersFeedbackIds.includes(f.id)) continue;
      const d = f.version?.deliverableId;
      if (!d) continue;
      if (!byDeliverable.has(d)) byDeliverable.set(d, []);
      byDeliverable.get(d)!.push(f.id);
    }
    for (const [deliverableId, fbIds] of byDeliverable) {
      socketService.emitToDeliverable(deliverableId, 'feedback:read', {
        userId,
        readAt: readAt.toISOString(),
        feedbackIds: fbIds,
        deliverableId,
      });
    }

    ApiResponse.success(res, { marked: result.count }, 'Feedbacks marked as read');
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
