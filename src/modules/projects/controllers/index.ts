import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../config/database';
import { ApiResponse } from '../../../utils/apiResponse';
import { NotFoundError, ForbiddenError } from '../../../utils/errors';
import { socketService } from '../../../services/socketService';

// Create project (now supports V2 with type and ownerId)
export const createProject = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { title, deadline, brief, talentId, type = 'PERSONAL', deliverables, collaboratorIds = [] } = req.body;
    const userId = req.user!.id;
    const userRole = req.user!.role;

    const project = await prisma.project.create({
      data: {
        title,
        clientId: userId, // Default to current user
        talentId,
        ownerId: userId, // Set owner as current user
        type: type || 'PERSONAL',
        deadline: deadline ? new Date(deadline) : null,
        brief,
      },
      include: {
        client: { select: { id: true, name: true, email: true, avatarUrl: true } },
        talent: { select: { id: true, name: true, email: true, avatarUrl: true } },
        owner: { select: { id: true, name: true, email: true, avatarUrl: true } },
      },
    });

    // Create deliverables if provided (for PERSONAL type)
    if (deliverables && Array.isArray(deliverables)) {
      for (const deliverable of deliverables) {
        // Determine if this is a TALENT creating the deliverable - set status to PRODUCTION
        const isTalentCreator = userRole === 'TALENT';
        const finalStatus = isTalentCreator ? 'PRODUCTION' : 'PREPARATION';

        await prisma.deliverable.create({
          data: {
            projectId: project.id,
            title: deliverable.title || 'Untitled',
            type: deliverable.type || 'Video',
            assignedTalentId: deliverable.assignedTalentId || talentId || undefined, // Auto-assign talent if provided
            status: finalStatus,
          },
        });
      }
    }

    // Add project owner as OWNER member (for future permissions)
    await prisma.projectMember.create({
      data: {
        projectId: project.id,
        userId,
        role: 'OWNER',
        permissions: {
          view: true,
          edit: true,
          comment: true,
          approve: true,
        },
      },
    });

    // Add collaborators if provided
    if (collaboratorIds && collaboratorIds.length > 0) {
      const collaboratorMembers = collaboratorIds.map((collabId: string) => ({
        projectId: project.id,
        userId: collabId,
        role: 'COLLABORATOR',
        permissions: {
          view: true,
          edit: true,
          comment: true,
          approve: false,
        },
      }));

      await prisma.projectMember.createMany({
        data: collaboratorMembers,
        skipDuplicates: true,
      });
    }

    // Notify the talent if assigned
    if (talentId) {
      const notification = await prisma.notification.create({
        data: {
          userId: talentId,
          type: 'PROJECT_ASSIGNED',
          title: 'Nouveau projet assigné',
          message: `Vous avez été assigné au projet "${title}"`,
          link: `/workspace/${project.id}`,
        },
      });

      // Emit real-time notification to talent
      socketService.emitToUser(talentId, 'notification:new', notification);

      // Emit project:new event to talent
      socketService.emitToUser(talentId, 'project:new', {
        id: project.id,
        title: project.title,
        clientId: project.clientId,
        talentId: project.talentId,
      });
    }

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

    // Emit project:updated to all users in the project room
    socketService.emitToProject(id, 'project:updated', {
      id: project.id,
      title: project.title,
      status: project.status,
      talentId: project.talentId,
    });

    // Also notify the talent if they're not in the project room
    if (project.talentId) {
      socketService.emitToUser(project.talentId, 'project:updated', {
        id: project.id,
        title: project.title,
        status: project.status,
        talentId: project.talentId,
      });
    }

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

    // Emit project status change to project room
    socketService.emitToProject(id, 'project:status', {
      id: project.id,
      status: project.status,
    });

    ApiResponse.success(res, project, 'Project status updated');
  } catch (error) {
    next(error);
  }
};

// Delete project (soft or hard delete)
export const deleteProject = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const soft = req.query.soft === 'true';

    const existingProject = await prisma.project.findUnique({ where: { id } });

    if (!existingProject) {
      throw new NotFoundError('Project not found');
    }

    if (existingProject.clientId !== req.user!.id && req.user!.role !== 'ADMIN') {
      throw new ForbiddenError('You do not have permission to delete this project');
    }

    if (soft) {
      // Soft delete: mark as deleted
      await prisma.project.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      ApiResponse.success(res, null, 'Project soft deleted successfully');
    } else {
      // Hard delete: permanently remove
      await prisma.project.delete({ where: { id } });
      ApiResponse.success(res, null, 'Project deleted successfully');
    }
  } catch (error) {
    next(error);
  }
};

// Archive project
export const archiveProject = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);

    const existingProject = await prisma.project.findUnique({ where: { id } });

    if (!existingProject) {
      throw new NotFoundError('Project not found');
    }

    if (existingProject.clientId !== req.user!.id && req.user!.role !== 'ADMIN') {
      throw new ForbiddenError('You do not have permission to archive this project');
    }

    const project = await prisma.project.update({
      where: { id },
      data: {
        isArchived: true,
        archivedAt: new Date(),
      },
      include: {
        client: { select: { id: true, name: true, email: true, avatarUrl: true } },
        talent: { select: { id: true, name: true, email: true, avatarUrl: true } },
      },
    });

    // Emit project:archived event
    socketService.emitToProject(id, 'project:archived', {
      id: project.id,
      isArchived: project.isArchived,
    });

    ApiResponse.success(res, project, 'Project archived successfully');
  } catch (error) {
    next(error);
  }
};

// Restore archived or deleted project
export const restoreProject = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);

    const existingProject = await prisma.project.findUnique({ where: { id } });

    if (!existingProject) {
      throw new NotFoundError('Project not found');
    }

    if (existingProject.clientId !== req.user!.id && req.user!.role !== 'ADMIN') {
      throw new ForbiddenError('You do not have permission to restore this project');
    }

    const project = await prisma.project.update({
      where: { id },
      data: {
        isArchived: false,
        archivedAt: null,
        deletedAt: null,
      },
      include: {
        client: { select: { id: true, name: true, email: true, avatarUrl: true } },
        talent: { select: { id: true, name: true, email: true, avatarUrl: true } },
      },
    });

    // Emit project:restored event
    socketService.emitToProject(id, 'project:restored', {
      id: project.id,
      isArchived: project.isArchived,
      deletedAt: project.deletedAt,
    });

    ApiResponse.success(res, project, 'Project restored successfully');
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

// Default workflow templates based on content type
// assignedTo on phase level: 'TALENT' or 'CLIENT'
const getDefaultWorkflow = (contentType?: string) => {
  const type = (contentType || '').toLowerCase();

  // Short Form (Reels, TikToks) - All phases visible to CLIENT only by default
  if (type.includes('reel') || type.includes('tiktok') || type.includes('short')) {
    return [
      {
        title: 'Stratégie & Concept',
        assignedTo: 'CLIENT',
        tasks: [
          { title: 'Confirmer le Brief Créatif' },
          { title: 'Validation Script & Accroche' },
        ]
      },
      {
        title: 'Production & Assets',
        assignedTo: 'CLIENT',
        tasks: [
          { title: 'Organisation des Rushes' },
          { title: 'Sélection Musicale (Tendance)' },
          { title: 'Ours / Montage Brut (Rythme)' },
        ]
      },
      {
        title: 'Post-Production',
        assignedTo: 'CLIENT',
        tasks: [
          { title: 'Motion Design & Textes' },
          { title: 'Étalonnage & Filtres' },
          { title: 'Sound Design & SFX' },
          { title: 'Sous-titrage (SRT)' },
        ]
      },
      {
        title: 'Livraison',
        assignedTo: 'CLIENT',
        tasks: [
          { title: 'Revue Client V1' },
          { title: 'Export Final (4K)' },
        ]
      }
    ];
  }

  // Long Form (YouTube, Doc, Corporate) - All phases visible to CLIENT only by default
  if (type.includes('youtube') || type.includes('documentary') || type.includes('promo') || type.includes('long')) {
    return [
      {
        title: 'Pré-Production',
        assignedTo: 'CLIENT',
        tasks: [
          { title: 'Storyboard / Liste des plans' },
          { title: 'Transfert des Assets (A-Roll & B-Roll)' },
        ]
      },
      {
        title: 'Montage Brut',
        assignedTo: 'CLIENT',
        tasks: [
          { title: 'Sélection A-Roll' },
          { title: 'Structure Narrative' },
          { title: 'Intégration B-Roll' },
        ]
      },
      {
        title: 'Finitions',
        assignedTo: 'CLIENT',
        tasks: [
          { title: 'Étalonnage Avancé' },
          { title: 'Mixage Audio & Réduction Bruit' },
        ]
      },
      {
        title: 'Livraison Finale',
        assignedTo: 'CLIENT',
        tasks: [
          { title: 'Options de Miniature' },
          { title: 'Export Final' },
        ]
      }
    ];
  }

  // Default Template - All phases visible to CLIENT only by default
  // Client can toggle visibility for TALENT
  return [
    {
      title: 'Démarrage',
      assignedTo: 'CLIENT',
      tasks: [
        { title: 'Revue du Brief' },
        { title: 'Réception des Fichiers' },
      ]
    },
    {
      title: 'Production',
      assignedTo: 'CLIENT',
      tasks: [
        { title: 'Brouillon V1' },
        { title: 'Révisions' },
      ]
    },
    {
      title: 'Livraison',
      assignedTo: 'CLIENT',
      tasks: [
        { title: 'Fichiers Finaux' },
      ]
    }
  ];
};

// Add deliverable to project
export const addDeliverable = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { title, type, deadline, assignedTalentId, createWorkflow = true } = req.body;
    const userId = req.user!.id;
    const userRole = req.user!.role;

    // Determine status based on:
    // 1. If talent is assigned → PRODUCTION (with PENDING acceptance)
    // 2. If TALENT creates without assignment → PRODUCTION
    // 3. Otherwise → PREPARATION
    const isTalentCreator = userRole === 'TALENT';
    const hasTalentAssigned = !!assignedTalentId;
    const finalStatus = (hasTalentAssigned || isTalentCreator) ? 'PRODUCTION' : 'PREPARATION';

    // Create deliverable
    const deliverable = await prisma.deliverable.create({
      data: {
        projectId: id,
        title,
        type,
        deadline: deadline ? new Date(deadline) : null,
        assignedTalentId,
        status: finalStatus,
        // If talent is assigned, set acceptanceStatus to PENDING so they can accept/reject
        acceptanceStatus: hasTalentAssigned ? 'PENDING' : null,
      },
    });

    // Create default workflow phases and tasks if requested
    if (createWorkflow) {
      const workflowTemplate = getDefaultWorkflow(type);

      for (let i = 0; i < workflowTemplate.length; i++) {
        const phaseTemplate = workflowTemplate[i];

        // Create phase with assignedTo
        const phase = await prisma.workflowPhase.create({
          data: {
            deliverableId: deliverable.id,
            title: phaseTemplate.title,
            status: i === 0 ? 'active' : 'pending',
            assignedTo: phaseTemplate.assignedTo || 'TALENT',
            orderIndex: i,
          },
        });

        // Create tasks for the phase
        for (let j = 0; j < phaseTemplate.tasks.length; j++) {
          const taskTemplate = phaseTemplate.tasks[j];
          await prisma.workflowTask.create({
            data: {
              phaseId: phase.id,
              title: taskTemplate.title,
              orderIndex: j,
            },
          });
        }
      }
    }

    // Fetch the complete deliverable with workflow
    const completeDeliverable = await prisma.deliverable.findUnique({
      where: { id: deliverable.id },
      include: {
        workflowPhases: {
          include: { tasks: true },
          orderBy: { orderIndex: 'asc' },
        },
      },
    });

    // Emit deliverable creation event to project room for real-time updates
    const { socketService } = await import('../../../services/socketService');
    const creationPayload = {
      id: deliverable.id,
      projectId: id,
      title: deliverable.title,
      type: deliverable.type,
    };
    console.log('[SOCKET] Emitting deliverable:created to project:', id, creationPayload);
    socketService.emitToProject(id, 'deliverable:created', creationPayload);

    ApiResponse.created(res, completeDeliverable, 'Deliverable added successfully');
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

// Get project members
export const getProjectMembers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const projectId = String(req.params.id);

    const members = await prisma.projectMember.findMany({
      where: { projectId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
            role: true,
          },
        },
      },
    });

    ApiResponse.success(res, members, 'Project members fetched successfully');
  } catch (error) {
    next(error);
  }
};

// Complete brief (mark onboarding as done for CLIENT projects)
export const completeBrief = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const projectId = String(req.params.id);
    const userId = req.user!.id;

    // Get user's name for notification
    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });

    // Check if project exists
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        owner: { select: { id: true, name: true, email: true } },
      },
    });

    if (!project) {
      throw new NotFoundError('Project not found');
    }

    // Check if user is a member of the project
    const membership = await prisma.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId,
        },
      },
    });

    if (!membership && project.ownerId !== userId && req.user!.role !== 'ADMIN') {
      throw new ForbiddenError('You do not have permission to complete the brief');
    }

    // Update project with briefCompletedAt
    const updatedProject = await prisma.project.update({
      where: { id: projectId },
      data: {
        briefCompletedAt: new Date(),
        status: 'IN_PROGRESS', // Update status to IN_PROGRESS when brief is completed
      },
    });

    // Notify the project owner that the brief is complete
    if (project.ownerId && project.ownerId !== userId) {
      const notification = await prisma.notification.create({
        data: {
          userId: project.ownerId,
          type: 'BRIEF_COMPLETED',
          title: 'Brief complété',
          message: `${currentUser?.name || 'Un utilisateur'} a complété le brief du projet "${project.title}"`,
          link: `/workspace/${projectId}`,
        },
      });

      // Emit real-time notification
      socketService.emitToUser(project.ownerId, 'notification:new', notification);
    }

    // Emit project update to room
    socketService.emitToProject(projectId, 'project:brief-completed', {
      id: projectId,
      briefCompletedAt: updatedProject.briefCompletedAt,
      status: updatedProject.status,
    });

    ApiResponse.success(res, updatedProject, 'Brief completed successfully');
  } catch (error) {
    next(error);
  }
};
