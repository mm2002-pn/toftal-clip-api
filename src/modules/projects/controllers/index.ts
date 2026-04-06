import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../config/database';
import { ApiResponse } from '../../../utils/apiResponse';
import { NotFoundError, ForbiddenError, BadRequestError } from '../../../utils/errors';
import { socketService } from '../../../services/socketService';
import { mapDeliverableTypeToContentType } from '../../../utils/contentTypeMapper';
import { EmailService } from '../../../services/EmailService';

// Initialize EmailService
const emailService = new EmailService();

// Create project (now supports V2 with type and ownerId)
export const createProject = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { title, deadline, brief, talentId, type = 'PERSONAL', deliverables, collaboratorIds = [], collaborators = [], status = 'DRAFT' } = req.body;
    const userId = req.user!.id;
    const userRole = req.user!.role;

    const project = await prisma.project.create({
      data: {
        title,
        clientId: userId, // Default to current user
        talentId,
        ownerId: userId, // Set owner as current user
        type: type || 'PERSONAL',
        status: status as any, // DRAFT or IN_PROGRESS
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
    // Support both old format (collaboratorIds) and new format (collaborators with permissions)
    const collabsToAdd = collaborators.length > 0
      ? collaborators
      : collaboratorIds.map((collabId: string) => ({
          userId: collabId,
          permissions: {
            view: true,
            edit: true,
            comment: true,
            approve: false,
          },
        }));

    if (collabsToAdd.length > 0) {
      const collaboratorMembers = collabsToAdd.map((collab: any) => ({
        projectId: project.id,
        userId: collab.userId,
        role: 'COLLABORATOR',
        permissions: collab.permissions || {
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

      // Fetch current user name for email
      const currentUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true },
      });
      const creatorName = currentUser?.name || req.user!.email;

      // Send notifications and emails to each collaborator
      for (const collab of collabsToAdd) {
        const collabId = collab.userId;
        try {
          // Fetch collaborator details
          const collaborator = await prisma.user.findUnique({
            where: { id: collabId },
            select: { id: true, name: true, email: true },
          });

          if (collaborator) {
            // Create notification in database
            const notification = await prisma.notification.create({
              data: {
                userId: collabId,
                type: 'PROJECT_COLLABORATOR',
                title: 'Ajouté comme collaborateur',
                message: `Vous avez été ajouté au projet "${title}"`,
                link: `/workspace/${project.id}`,
              },
            });

            // Send real-time notification
            socketService.emitToUser(collabId, 'notification:new', notification);

            // Send email notification
            if (collaborator.email) {
              await emailService.sendCollaboratorAddedEmail({
                to: collaborator.email,
                collaboratorName: collaborator.name,
                projectTitle: title,
                projectId: project.id,
                addedBy: creatorName,
                permissions: collab.permissions,
              });
              console.log(`📧 [CREATE_PROJECT] Email sent to collaborator ${collaborator.email} with permissions:`, collab.permissions);
            }
          }
        } catch (emailError) {
          // Log error but don't fail the project creation if email fails
          console.error(`❌ [CREATE_PROJECT] Failed to notify collaborator ${collabId}:`, emailError);
        }
      }
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
    const { title, deadline, brief, talentId, status, briefCompletedAt } = req.body;

    // Check if project exists and user has access
    const existingProject = await prisma.project.findUnique({ where: { id } });

    if (!existingProject) {
      throw new NotFoundError('Project not found');
    }

    if (existingProject.clientId !== req.user!.id && req.user!.role !== 'ADMIN') {
      throw new ForbiddenError('You do not have permission to update this project');
    }

    // Store old talent ID to notify if removed
    const oldTalentId = existingProject.talentId;

    const project = await prisma.project.update({
      where: { id },
      data: {
        title,
        deadline: deadline ? new Date(deadline) : undefined,
        brief,
        talentId,
        status,
        briefCompletedAt: briefCompletedAt ? new Date(briefCompletedAt) : undefined,
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

    // Notify the NEW talent if assigned
    if (project.talentId) {
      socketService.emitToUser(project.talentId, 'project:updated', {
        id: project.id,
        title: project.title,
        status: project.status,
        talentId: project.talentId,
      });
    }

    // Notify the OLD talent if they were removed
    if (oldTalentId && oldTalentId !== project.talentId) {
      socketService.emitToUser(oldTalentId, 'project:updated', {
        id: project.id,
        title: project.title,
        status: project.status,
        talentId: project.talentId, // Will be null or different
        removed: true, // Flag to indicate removal
      });
      console.log(`📡 Notified old talent ${oldTalentId} of removal from project ${id}`);
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

    // Get current project with all needed data
    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        deliverables: {
          include: {
            versions: true,
          },
        },
      },
    });

    if (!project) {
      throw new NotFoundError('Project not found');
    }

    // ✅ 1. Check permissions - only owner/client can change status
    if (project.clientId !== req.user!.id && project.ownerId !== req.user!.id && req.user!.role !== 'ADMIN') {
      throw new ForbiddenError('Only the project owner can change status');
    }

    const currentStatus = project.status;

    // ✅ 2. Validate status transitions
    const validTransitions: Record<string, string[]> = {
      'DRAFT': ['IN_PROGRESS', 'PENDING'],
      'PENDING': ['MATCHING', 'IN_PROGRESS', 'DRAFT'],
      'MATCHING': ['IN_PROGRESS', 'PENDING'],
      'IN_PROGRESS': ['REVIEW', 'DRAFT', 'COMPLETED'],
      'REVIEW': ['IN_PROGRESS', 'COMPLETED', 'DRAFT'],
      'COMPLETED': ['IN_PROGRESS', 'ARCHIVED'],
      'ARCHIVED': ['IN_PROGRESS'],
    };

    if (!validTransitions[currentStatus]?.includes(status)) {
      throw new BadRequestError(`Cannot transition from ${currentStatus} to ${status}`);
    }

    // ✅ 3. DRAFT → IN_PROGRESS: Brief must be completed
    if (currentStatus === 'DRAFT' && status === 'IN_PROGRESS') {
      if (!project.briefCompletedAt) {
        throw new BadRequestError('Brief must be completed before activating the project');
      }
    }

    // ✅ 4. IN_PROGRESS → DRAFT: Cannot have any uploaded versions
    if (currentStatus === 'IN_PROGRESS' && status === 'DRAFT') {
      let hasVersions = false;
      for (const deliverable of project.deliverables) {
        if (deliverable.versions && deliverable.versions.length > 0) {
          hasVersions = true;
          break;
        }
      }

      if (hasVersions) {
        throw new BadRequestError('Cannot return to draft: project has uploaded versions. Please delete all versions first.');
      }
    }

    // ✅ 5. Update project status
    const updatedProject = await prisma.project.update({
      where: { id },
      data: { status },
      include: {
        client: { select: { id: true, name: true, email: true, avatarUrl: true } },
        talent: { select: { id: true, name: true, email: true, avatarUrl: true } },
        owner: { select: { id: true, name: true, email: true, avatarUrl: true } },
      },
    });

    // Emit project status change to project room
    socketService.emitToProject(id, 'project:status', {
      id: updatedProject.id,
      status: updatedProject.status,
      previousStatus: currentStatus,
    });

    ApiResponse.success(res, updatedProject, `Project status updated from ${currentStatus} to ${status}`);
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
        status: 'ARCHIVED' as any, // Migration needed
      },
      include: {
        client: { select: { id: true, name: true, email: true, avatarUrl: true } },
        talent: { select: { id: true, name: true, email: true, avatarUrl: true } },
      },
    });

    // Emit project events
    socketService.emitToProject(id, 'project:archived', {
      id: project.id,
      isArchived: project.isArchived,
    });

    socketService.emitToProject(id, 'project:status', {
      projectId: id,
      status: 'ARCHIVED',
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

    // Check if all deliverables are validated to determine status
    const deliverables = await prisma.deliverable.findMany({
      where: { projectId: id },
      select: { status: true },
    });

    const allValidated = deliverables.length > 0 && deliverables.every(d => d.status === 'VALIDE');
    const newStatus = allValidated ? 'COMPLETED' : 'IN_PROGRESS';

    const project = await prisma.project.update({
      where: { id },
      data: {
        isArchived: false,
        archivedAt: null,
        deletedAt: null,
        status: newStatus as any, // Migration needed
      },
      include: {
        client: { select: { id: true, name: true, email: true, avatarUrl: true } },
        talent: { select: { id: true, name: true, email: true, avatarUrl: true } },
      },
    });

    // Emit project events
    socketService.emitToProject(id, 'project:restored', {
      id: project.id,
      isArchived: project.isArchived,
      deletedAt: project.deletedAt,
    });

    socketService.emitToProject(id, 'project:status', {
      projectId: id,
      status: newStatus,
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

    // Get user details to check if creator is a talent (editor)
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { talentModeEnabled: true },
    });

    const isCreatorATalent = user?.talentModeEnabled === true;

    // DEFAULT BEHAVIOR for talents creating deliverables:
    // If creator is a talent (editor), auto-assign and auto-accept
    let finalAssignedTalentId = assignedTalentId;
    let finalStatus: 'PREPARATION' | 'PRODUCTION' | 'RETOUR' | 'VALIDATION' | 'VALIDE';
    let acceptanceStatus: 'PENDING' | 'ACCEPTED' | 'REJECTED' | null;

    // DISABLED: Auto-assignation logic commented out (no talents for now)
    // if (isCreatorATalent && !assignedTalentId) {
    //   // Auto-assign to creator if they're a talent and no one else is assigned
    //   finalAssignedTalentId = userId;
    //   finalStatus = 'PRODUCTION';
    //   acceptanceStatus = 'ACCEPTED';
    //   console.log('[DELIVERABLE] Auto-assigning and auto-accepting: Creator is talent');
    // } else if (isCreatorATalent && assignedTalentId === userId) {
    //   // Creator is talent and assigning to themselves
    //   finalStatus = 'PRODUCTION';
    //   acceptanceStatus = 'ACCEPTED';
    //   console.log('[DELIVERABLE] Auto-accepting: Creator is talent assigning to self');
    // } else
    if (assignedTalentId) {
      // Assigning to someone else - normal workflow
      finalStatus = 'PREPARATION';
      acceptanceStatus = 'PENDING';
    } else {
      // No talent assigned and creator is not talent
      finalStatus = 'PREPARATION';
      acceptanceStatus = null;
    }

    // Map legacy type to new ContentType system (supports both)
    const contentType = type ? mapDeliverableTypeToContentType(type) : null;

    // Create deliverable
    const deliverable = await prisma.deliverable.create({
      data: {
        projectId: id,
        title,
        type, // Keep legacy field for backwards compatibility
        contentType, // Set new ContentType field
        deadline: deadline ? new Date(deadline) : null,
        assignedTalentId: finalAssignedTalentId,
        status: finalStatus,
        acceptanceStatus,
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

    // If project was COMPLETED, reopen it to IN_PROGRESS since a new deliverable was added
    const project = await prisma.project.findUnique({
      where: { id },
      select: { status: true },
    });

    if (project?.status === 'COMPLETED') {
      await prisma.project.update({
        where: { id },
        data: { status: 'IN_PROGRESS' },
      });

      // Emit project status change
      socketService.emitToProject(id, 'project:status', {
        projectId: id,
        status: 'IN_PROGRESS',
      });

      console.log(`🔄 [ADD_DELIVERABLE] Project ${id} reopened to IN_PROGRESS - new deliverable added`);
    }

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
