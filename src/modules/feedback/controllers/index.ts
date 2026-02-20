import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../config/database';
import { ApiResponse } from '../../../utils/apiResponse';

export const updateFeedback = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { rawText, structuredText } = req.body;

    const feedback = await prisma.feedback.update({
      where: { id },
      data: { rawText, structuredText },
    });

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
