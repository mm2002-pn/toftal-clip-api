import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../config/database';
import { ApiResponse } from '../../../utils/apiResponse';

// Compare phase titles by their normalized form (trim + lowercase) so
// "Tournage" and "  tournage " count as duplicates. We keep the original
// casing in DB for display.
const normalizeTitle = (s: string) => s.trim().toLowerCase();

// Suggest "Title (2)", "Title (3)", … until we hit one that doesn't collide.
// Cap at 100 attempts to avoid pathological loops.
const suggestAlternativeTitle = (base: string, existingTitles: Set<string>): string => {
  const trimmed = base.trim();
  for (let i = 2; i <= 100; i++) {
    const candidate = `${trimmed} (${i})`;
    if (!existingTitles.has(normalizeTitle(candidate))) return candidate;
  }
  return `${trimmed} (${Date.now()})`;
};

export const createPhase = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { deliverableId, title } = req.body;

    // Reject duplicate phase names within the same deliverable. We surface a
    // suggested alternative ("Tournage (2)") so the client can prefill the
    // input rather than ask the user to invent something.
    const siblings = await prisma.workflowPhase.findMany({
      where: { deliverableId },
      select: { title: true },
    });
    const existing = new Set(siblings.map((p) => normalizeTitle(p.title)));
    if (existing.has(normalizeTitle(title))) {
      const suggestion = suggestAlternativeTitle(title, existing);
      ApiResponse.error(
        res,
        'Une phase avec ce nom existe déjà. Choisissez un nom différent.',
        409,
        [{ code: 'PHASE_TITLE_DUPLICATE', suggestedTitle: suggestion }]
      );
      return;
    }

    const phase = await prisma.workflowPhase.create({
      data: { deliverableId, title: title.trim() },
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
    const { title, status, assignedTo } = req.body;

    // When renaming, ensure the new title doesn't collide with another phase
    // of the same deliverable. The phase being updated is excluded from the
    // check so a no-op rename still succeeds.
    if (typeof title === 'string' && title.trim().length > 0) {
      const current = await prisma.workflowPhase.findUnique({
        where: { id },
        select: { deliverableId: true },
      });
      if (current) {
        const siblings = await prisma.workflowPhase.findMany({
          where: { deliverableId: current.deliverableId, NOT: { id } },
          select: { title: true },
        });
        const existing = new Set(siblings.map((p) => normalizeTitle(p.title)));
        if (existing.has(normalizeTitle(title))) {
          const suggestion = suggestAlternativeTitle(title, existing);
          ApiResponse.error(
            res,
            'Une phase avec ce nom existe déjà. Choisissez un nom différent.',
            409,
            [{ code: 'PHASE_TITLE_DUPLICATE', suggestedTitle: suggestion }]
          );
          return;
        }
      }
    }

    const phase = await prisma.workflowPhase.update({
      where: { id },
      data: {
        title: typeof title === 'string' ? title.trim() : undefined,
        status,
        assignedTo,
      },
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

export const reorderTask = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { targetPhaseId, newIndex } = req.body;

    // Get the task
    const task = await prisma.workflowTask.findUnique({ where: { id } });
    if (!task) {
      return ApiResponse.notFound(res, 'Task not found') as any;
    }

    // Get all tasks in the target phase ordered by orderIndex
    const tasksInPhase = await prisma.workflowTask.findMany({
      where: { phaseId: targetPhaseId },
      orderBy: { orderIndex: 'asc' },
    });

    // If moving to a different phase, update the phaseId
    if (task.phaseId !== targetPhaseId) {
      await prisma.workflowTask.update({
        where: { id },
        data: { phaseId: targetPhaseId },
      });
    }

    // Reorder: update orderIndex for all tasks in the phase
    const filteredTasks = tasksInPhase.filter(t => t.id !== id);
    filteredTasks.splice(newIndex, 0, { ...task, phaseId: targetPhaseId });

    // Update orderIndex for all tasks
    await Promise.all(
      filteredTasks.map((t, index) =>
        prisma.workflowTask.update({
          where: { id: t.id },
          data: { orderIndex: index },
        })
      )
    );

    ApiResponse.success(res, { id, targetPhaseId, newIndex }, 'Task reordered');
  } catch (error) {
    next(error);
  }
};
