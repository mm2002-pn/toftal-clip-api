import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../config/database';
import { ApiResponse } from '../../../utils/apiResponse';
import { NotFoundError, ForbiddenError } from '../../../utils/errors';
import { socketService } from '../../../services/socketService';

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

    // Create deliverable
    const deliverable = await prisma.deliverable.create({
      data: {
        projectId: id,
        title,
        type,
        deadline: deadline ? new Date(deadline) : null,
        assignedTalentId,
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
