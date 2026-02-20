import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../config/database';
import { ApiResponse } from '../../../utils/apiResponse';
import { NotFoundError, ForbiddenError } from '../../../utils/errors';

// Create project
export const createProject = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { title, deadline, brief, talentId } = req.body;

    const project = await prisma.project.create({
      data: {
        title,
        clientId: req.user!.id,
        talentId,
        deadline: deadline ? new Date(deadline) : null,
        brief,
      },
      include: {
        client: { select: { id: true, name: true, email: true, avatarUrl: true } },
        talent: { select: { id: true, name: true, email: true, avatarUrl: true } },
      },
    });

    ApiResponse.created(res, project, 'Project created successfully');
  } catch (error) {
    next(error);
  }
};

// Update project
export const updateProject = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { title, deadline, brief, talentId } = req.body;

    // Check if project exists and user has access
    const existingProject = await prisma.project.findUnique({ where: { id } });

    if (!existingProject) {
      throw new NotFoundError('Project not found');
    }

    if (existingProject.clientId !== req.user!.id && req.user!.role !== 'ADMIN') {
      throw new ForbiddenError('You do not have permission to update this project');
    }

    const project = await prisma.project.update({
      where: { id },
      data: {
        title,
        deadline: deadline ? new Date(deadline) : undefined,
        brief,
        talentId,
      },
      include: {
        client: { select: { id: true, name: true, email: true, avatarUrl: true } },
        talent: { select: { id: true, name: true, email: true, avatarUrl: true } },
        deliverables: true,
      },
    });

    ApiResponse.success(res, project, 'Project updated successfully');
  } catch (error) {
    next(error);
  }
};

// Update project status
export const updateProjectStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { status } = req.body;

    const project = await prisma.project.update({
      where: { id },
      data: { status },
    });

    ApiResponse.success(res, project, 'Project status updated');
  } catch (error) {
    next(error);
  }
};

// Delete project
export const deleteProject = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);

    const existingProject = await prisma.project.findUnique({ where: { id } });

    if (!existingProject) {
      throw new NotFoundError('Project not found');
    }

    if (existingProject.clientId !== req.user!.id && req.user!.role !== 'ADMIN') {
      throw new ForbiddenError('You do not have permission to delete this project');
    }

    await prisma.project.delete({ where: { id } });

    ApiResponse.success(res, null, 'Project deleted successfully');
  } catch (error) {
    next(error);
  }
};

// Get project deliverables
export const getProjectDeliverables = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);

    const deliverables = await prisma.deliverable.findMany({
      where: { projectId: id },
      include: {
        assignedTalent: { select: { id: true, name: true, avatarUrl: true } },
      },
    });

    ApiResponse.success(res, deliverables);
  } catch (error) {
    next(error);
  }
};

// Add deliverable to project
export const addDeliverable = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { title, type, deadline, assignedTalentId } = req.body;

    const deliverable = await prisma.deliverable.create({
      data: {
        projectId: id,
        title,
        type,
        deadline: deadline ? new Date(deadline) : null,
        assignedTalentId,
      },
    });

    ApiResponse.created(res, deliverable, 'Deliverable added successfully');
  } catch (error) {
    next(error);
  }
};

// Get project media
export const getProjectMedia = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);

    const media = await prisma.mediaResource.findMany({
      where: { projectId: id, deliverableId: null },
    });

    ApiResponse.success(res, media);
  } catch (error) {
    next(error);
  }
};

// Add media to project
export const addProjectMedia = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { name, url, type, category } = req.body;

    const media = await prisma.mediaResource.create({
      data: {
        projectId: id,
        name,
        url,
        type,
        category,
        addedBy: req.user!.id,
      },
    });

    ApiResponse.created(res, media, 'Media added successfully');
  } catch (error) {
    next(error);
  }
};
