import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../config/database';
import { ApiResponse } from '../../../utils/apiResponse';

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
    });

    ApiResponse.success(res, version, 'Status updated');
  } catch (error) {
    next(error);
  }
};

export const addFeedback = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { rawText, structuredText, type, tasks } = req.body;

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

    ApiResponse.created(res, feedback, 'Feedback added');
  } catch (error) {
    next(error);
  }
};
