import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../config/database';
import { ApiResponse } from '../../../utils/apiResponse';

export const createPhase = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { deliverableId, title } = req.body;

    const phase = await prisma.workflowPhase.create({
      data: { deliverableId, title },
      include: { tasks: true },
    });

    ApiResponse.created(res, phase, 'Phase created');
  } catch (error) {
    next(error);
  }
};

export const updatePhase = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { title, status } = req.body;

    const phase = await prisma.workflowPhase.update({
      where: { id },
      data: { title, status },
    });

    ApiResponse.success(res, phase, 'Phase updated');
  } catch (error) {
    next(error);
  }
};

export const deletePhase = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    await prisma.workflowPhase.delete({ where: { id } });
    ApiResponse.success(res, null, 'Phase deleted');
  } catch (error) {
    next(error);
  }
};

export const createTask = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const phaseId = String(req.params.phaseId);
    const { title, assignedTo } = req.body;

    const task = await prisma.workflowTask.create({
      data: { phaseId, title, assignedTo },
    });

    ApiResponse.created(res, task, 'Task created');
  } catch (error) {
    next(error);
  }
};

export const updateTask = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { title, assignedTo } = req.body;

    const task = await prisma.workflowTask.update({
      where: { id },
      data: { title, assignedTo },
    });

    ApiResponse.success(res, task, 'Task updated');
  } catch (error) {
    next(error);
  }
};

export const deleteTask = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    await prisma.workflowTask.delete({ where: { id } });
    ApiResponse.success(res, null, 'Task deleted');
  } catch (error) {
    next(error);
  }
};

export const toggleTask = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);

    const task = await prisma.workflowTask.findUnique({ where: { id } });

    const updated = await prisma.workflowTask.update({
      where: { id },
      data: { completed: !task?.completed },
    });

    ApiResponse.success(res, updated, 'Task toggled');
  } catch (error) {
    next(error);
  }
};
