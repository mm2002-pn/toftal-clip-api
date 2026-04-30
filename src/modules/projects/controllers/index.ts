import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../config/database';
import { ApiResponse } from '../../../utils/apiResponse';
import { NotFoundError, ForbiddenError, BadRequestError } from '../../../utils/errors';
import { socketService } from '../../../services/socketService';
import { mapDeliverableTypeToContentType } from '../../../utils/contentTypeMapper';
import { EmailService } from '../../../services/EmailService';
import { cacheService, CACHE_KEYS, CACHE_TTL } from '../../../services/cacheService';

// Initialize EmailService
const emailService = new EmailService();

// Create project (now supports V2 with type and ownerId)
export const createProject = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { title, startDate, deadline, brief, talentId, type = 'PERSONAL', deliverables, collaboratorIds = [], collaborators = [], status = 'DRAFT', organizationId } = req.body;
    const userId = req.user!.id;
    const userRole = req.user!.role;

    // If the caller passed an organizationId (= they're creating in team
    // mode), validate they're an active admin of that org. Anything else
    // would let a user attach a project to a team they don't belong to.
    let scopedOrgId: string | null = null;
    if (typeof organizationId === 'string' && organizationId.length > 0) {
      const adminMembership = await prisma.organizationMember.findFirst({
        where: {
          organizationId,
          userId,
          role: 'ADMIN',
          status: 'ACTIVE',
        },
        select: { id: true },
      });
      if (!adminMembership) {
        ApiResponse.forbidden(res, "Vous n'êtes pas administrateur de cette équipe.");
        return;
      }
      scopedOrgId = organizationId;
    }

    const project = await prisma.project.create({
      data: {
        title,
        clientId: userId, // Default to current user
        talentId,
        ownerId: userId, // Set owner as current user
        organizationId: scopedOrgId,
        type: type || 'PERSONAL',
        status: status as any, // DRAFT or IN_PROGRESS
        startDate: startDate ? new Date(startDate) : null,
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
    const { title, startDate, deadline, brief, talentId, status, briefCompletedAt } = req.body;

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
        startDate: startDate ? new Date(startDate) : undefined,
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

// Get project deliverables (cached for 1 minute)
export const getProjectDeliverables = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const cacheKey = `${CACHE_KEYS.PROJECT_DELIVERABLES}${id}`;

    // Try cache first
    const cached = await cacheService.get<any[]>(cacheKey);
    if (cached) {
      ApiResponse.success(res, cached);
      return;
    }

    const deliverables = await prisma.deliverable.findMany({
      where: { projectId: id },
      include: {
        assignedTalent: { select: { id: true, name: true, avatarUrl: true } },
      },
    });

    // Cache for 1 minute
    await cacheService.set(cacheKey, deliverables, CACHE_TTL.SHORT);

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

    // Invalidate project deliverables cache
    await cacheService.invalidateProjectDeliverables(id);

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

// Get project media (cached for 1 minute)
export const getProjectMedia = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const cacheKey = `${CACHE_KEYS.PROJECT_MEDIA}${id}`;

    // Try cache first
    const cached = await cacheService.get<any[]>(cacheKey);
    if (cached) {
      ApiResponse.success(res, cached);
      return;
    }

    const media = await prisma.mediaResource.findMany({
      where: { projectId: id, deliverableId: null },
    });

    // Cache for 1 minute
    await cacheService.set(cacheKey, media, CACHE_TTL.SHORT);

    ApiResponse.success(res, media);
  } catch (error) {
    next(error);
  }
};

// Add media to project
export const addProjectMedia = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { name, url, type, category, fileSize } = req.body;

    const media = await prisma.mediaResource.create({
      data: {
        projectId: id,
        name,
        url,
        type,
        category,
        addedBy: req.user!.id,
        fileSize: fileSize ? BigInt(fileSize) : null,
      },
    });

    // Invalidate project media cache
    await cacheService.invalidateProjectMedia(id);

    ApiResponse.created(res, media, 'Media added successfully');
  } catch (error) {
    next(error);
  }
};

// Get project members (cached for 5 minutes)
export const getProjectMembers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const projectId = String(req.params.id);
    const cacheKey = `${CACHE_KEYS.PROJECT_MEMBERS}${projectId}`;

    // Try cache first
    const cached = await cacheService.get<any[]>(cacheKey);
    if (cached) {
      ApiResponse.success(res, cached, 'Project members fetched successfully');
      return;
    }

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

    // Cache for 5 minutes (members change less frequently)
    await cacheService.set(cacheKey, members, CACHE_TTL.MEDIUM);

    ApiResponse.success(res, members, 'Project members fetched successfully');
  } catch (error) {
    next(error);
  }
};

// Add a team member to a project directly (US-TEAM-06). Skips the invitation
// flow — the member is already trusted (they joined the team), so the owner
// just picks them from the annuaire and assigns a role.
export const addTeamMemberToProject = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const callerId = req.user!.id;
    const projectId = String(req.params.id);
    const { userId, permission } = req.body as { userId?: string; permission?: string };

    if (!userId || typeof userId !== 'string') {
      ApiResponse.badRequest(res, 'userId requis.');
      return;
    }
    const allowed: Array<'view' | 'comment' | 'download'> = ['view', 'comment', 'download'];
    const perm = (typeof permission === 'string' ? permission : 'view') as 'view' | 'comment' | 'download';
    if (!allowed.includes(perm)) {
      ApiResponse.badRequest(res, 'Permission invalide.');
      return;
    }

    // Project ownership is enforced by the route's requireProjectOwner middleware.
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, title: true, ownerId: true, clientId: true },
    });
    if (!project) {
      ApiResponse.notFound(res, 'Projet introuvable.');
      return;
    }

    // The target user must share at least one organisation with the caller,
    // and the caller must be ADMIN of that org. Prevents adding random users
    // through the team-member endpoint.
    const sharedOrg = await prisma.organizationMember.findFirst({
      where: {
        userId: callerId,
        role: 'ADMIN',
        status: 'ACTIVE',
        organization: {
          members: {
            some: { userId, status: 'ACTIVE' },
          },
        },
      },
      select: { organizationId: true },
    });
    if (!sharedOrg) {
      ApiResponse.forbidden(res, "Cet utilisateur n'appartient pas à votre équipe.");
      return;
    }

    // Map permission → permissions JSON. Same shape used by InvitationService
    // when accepting a project invitation, so the rest of the app already
    // knows how to read it.
    let permissions: Record<string, boolean>;
    switch (perm) {
      case 'download':
        permissions = { view: true, edit: true, comment: true, approve: true };
        break;
      case 'comment':
        permissions = { view: true, edit: false, comment: true, approve: false };
        break;
      case 'view':
      default:
        permissions = { view: true, edit: false, comment: false, approve: false };
        break;
    }

    const membership = await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId, userId } },
      create: {
        projectId,
        userId,
        role: 'COLLABORATOR',
        permissions,
      },
      update: {
        // Don't downgrade an OWNER to COLLABORATOR — odd state, refuse.
        role: 'COLLABORATOR',
        permissions,
      },
      include: {
        user: { select: { id: true, name: true, email: true, avatarUrl: true } },
      },
    });

    // Invalidate the cached project members list so subsequent reads see the
    // new member without waiting for the TTL.
    try {
      await cacheService.invalidateProjectMembers(projectId);
    } catch {
      /* non-fatal */
    }

    // Join the new member's live sockets to the project room so they receive
    // future events without waiting for a reconnect.
    socketService.addUserToProjectRoom(userId, projectId);

    // Fetched once and reused: needed for the socket payload (addedByName)
    // and for the in-app/email notifications below.
    const callerUser = await prisma.user.findUnique({
      where: { id: callerId },
      select: { name: true },
    });

    // Real-time event so the ShareDrawer "Utilisateurs avec accès" list of
    // every connected user updates instantly. The payload mirrors what the
    // DeliverableListPage's addMemberLocal expects (id + user + permissions)
    // so it can append the row to project.members without a re-fetch — the
    // avatar group on the header reflects the new member immediately.
    const memberAddedPayload = {
      projectId,
      id: membership.id,
      userId: membership.userId,
      userName: membership.user.name,
      userEmail: membership.user.email,
      user: membership.user,
      role: membership.role,
      permissions: membership.permissions,
      addedBy: callerId,
      addedByName: callerUser?.name,
    };
    socketService.emitToProject(projectId, 'project:member:added', memberAddedPayload);

    // Fan out to every project member's personal user room so their
    // ProjectContext on /projects refreshes immediately, even if they're
    // not currently inside the project room. Same pattern as
    // InvitationService.acceptInvitation — fixes the case where the owner
    // browsing /projects didn't see the new card-member-count update.
    try {
      const allMembers = await prisma.projectMember.findMany({
        where: { projectId },
        select: { userId: true },
      });
      for (const m of allMembers) {
        if (m.userId === membership.userId) continue;
        socketService.emitToUser(m.userId, 'project:member:added', memberAddedPayload);
      }
    } catch (fanoutErr) {
      console.error('[ADD_TEAM_MEMBER_TO_PROJECT] fanout failed (non-fatal):', fanoutErr);
    }
    const permLabel = perm === 'download' ? 'Éditeur' : perm === 'comment' ? 'Commentateur' : 'Lecteur';
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

    try {
      const notification = await prisma.notification.create({
        data: {
          userId,
          type: 'PROJECT_ACCESS_GRANTED',
          title: 'Ajouté à un projet',
          message: `${callerUser?.name || 'Un administrateur'} vous a ajouté au projet "${project.title}" (${permLabel})`,
          link: `/workspace/${project.id}`,
        },
      });
      socketService.emitToUser(userId, 'notification:new', notification);
    } catch (notifErr) {
      console.error('[ADD_TEAM_MEMBER_TO_PROJECT] notification failed (non-fatal):', notifErr);
    }

    try {
      await emailService.sendProjectAccessGrantedEmail(
        membership.user.email,
        membership.user.name,
        callerUser?.name || 'Un administrateur',
        project.title,
        permLabel,
        `${frontendUrl}/#/workspace/${project.id}`
      );
    } catch (mailErr) {
      console.error('[ADD_TEAM_MEMBER_TO_PROJECT] email failed (non-fatal):', mailErr);
    }

    ApiResponse.success(
      res,
      {
        id: membership.id,
        userId: membership.userId,
        role: membership.role,
        permissions: membership.permissions,
        user: membership.user,
      },
      'Membre ajouté au projet'
    );
  } catch (error) {
    next(error);
  }
};

// Initiate ownership transfer request (sends confirmation email to new owner)
export const transferOwnership = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const projectId = String(req.params.id);
    const { newOwnerId } = req.body;
    const currentUserId = req.user!.id;

    console.log('👑 POST /projects/:id/transfer-ownership (Request)');
    console.log('📁 Project ID:', projectId);
    console.log('👤 New Owner ID:', newOwnerId);
    console.log('👤 Current User ID:', currentUserId);

    if (!newOwnerId) {
      throw new BadRequestError('newOwnerId is required');
    }

    // Get the project
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        owner: { select: { id: true, name: true, email: true } },
      },
    });

    if (!project) {
      throw new NotFoundError('Project not found');
    }

    // Check if current user is the owner
    if (project.ownerId !== currentUserId) {
      throw new ForbiddenError('Only the project owner can transfer ownership');
    }

    // Check if new owner is a member of the project
    const newOwnerMembership = await prisma.projectMember.findFirst({
      where: {
        projectId,
        userId: newOwnerId,
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });

    if (!newOwnerMembership) {
      throw new BadRequestError('New owner must be a member of the project');
    }

    // Cannot transfer to yourself
    if (newOwnerId === currentUserId) {
      throw new BadRequestError('Cannot transfer ownership to yourself');
    }

    // Check if there's already a pending transfer request
    const existingRequest = await prisma.ownershipTransferRequest.findFirst({
      where: {
        projectId,
        status: 'PENDING',
      },
    });

    if (existingRequest) {
      throw new BadRequestError('Il y a déjà une demande de transfert en attente pour ce projet');
    }

    // Generate unique token
    const crypto = await import('crypto');
    const token = crypto.randomBytes(32).toString('hex');

    // Create transfer request (expires in 7 days)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const transferRequest = await prisma.ownershipTransferRequest.create({
      data: {
        projectId,
        fromUserId: currentUserId,
        toUserId: newOwnerId,
        token,
        status: 'PENDING',
        expiresAt,
      },
      include: {
        fromUser: { select: { id: true, name: true, email: true } },
        toUser: { select: { id: true, name: true, email: true } },
        project: { select: { id: true, title: true } },
      },
    });

    // Send notification to new owner
    const notification = await prisma.notification.create({
      data: {
        userId: newOwnerId,
        type: 'OWNERSHIP_TRANSFER_REQUEST',
        title: 'Demande de transfert de propriété',
        message: `${project.owner?.name || 'Le propriétaire'} souhaite vous transférer la propriété du projet "${project.title}"`,
        link: `/accept-transfer/${token}`,
      },
    });

    // Emit real-time notification
    socketService.emitToUser(newOwnerId, 'notification:new', notification);

    // Send email to new owner with confirmation link
    if (newOwnerMembership.user?.email) {
      try {
        await emailService.sendOwnershipTransferRequestEmail({
          to: newOwnerMembership.user.email,
          recipientName: newOwnerMembership.user.name,
          senderName: project.owner?.name || 'Le propriétaire actuel',
          projectTitle: project.title,
          projectId,
          token,
          expiresAt,
        });
        console.log(`📧 Ownership transfer request email sent to ${newOwnerMembership.user.email}`);
      } catch (emailError) {
        console.error('Failed to send ownership transfer request email:', emailError);
      }
    }

    console.log('✅ Ownership transfer request created:', transferRequest.id);

    ApiResponse.success(res, {
      id: transferRequest.id,
      status: 'PENDING',
      toUser: transferRequest.toUser,
      expiresAt: transferRequest.expiresAt,
    }, 'Demande de transfert envoyée. En attente de confirmation.');
  } catch (error) {
    next(error);
  }
};

// Verify ownership transfer request (for UI display)
export const verifyTransferOwnership = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const token = String(req.params.token);

    console.log('🔍 GET /projects/transfer/verify/:token');

    // Find the transfer request
    const transferRequest = await prisma.ownershipTransferRequest.findUnique({
      where: { token },
      include: {
        project: { select: { id: true, title: true } },
        fromUser: { select: { id: true, name: true, email: true } },
        toUser: { select: { id: true, name: true, email: true } },
      },
    });

    if (!transferRequest) {
      throw new NotFoundError('Demande de transfert non trouvée');
    }

    // Check if request is still pending
    if (transferRequest.status !== 'PENDING') {
      throw new BadRequestError(`Cette demande a déjà été ${transferRequest.status === 'ACCEPTED' ? 'acceptée' : transferRequest.status === 'REJECTED' ? 'refusée' : 'traitée'}`);
    }

    // Check if request has expired
    if (new Date() > transferRequest.expiresAt) {
      await prisma.ownershipTransferRequest.update({
        where: { id: transferRequest.id },
        data: { status: 'EXPIRED' },
      });
      throw new BadRequestError('Cette demande de transfert a expiré');
    }

    ApiResponse.success(res, {
      id: transferRequest.id,
      projectId: transferRequest.projectId,
      project: transferRequest.project,
      fromUser: transferRequest.fromUser,
      toUser: transferRequest.toUser,
      status: transferRequest.status,
      expiresAt: transferRequest.expiresAt,
    });
  } catch (error) {
    next(error);
  }
};

// Accept ownership transfer request
export const acceptTransferOwnership = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const token = String(req.params.token);
    const currentUserId = req.user!.id;

    console.log('✅ POST /projects/transfer/accept/:token');
    console.log('🔑 Token:', token.substring(0, 20) + '...');
    console.log('👤 Current User ID:', currentUserId);

    // Find the transfer request
    const transferRequest = await prisma.ownershipTransferRequest.findUnique({
      where: { token },
      include: {
        project: { select: { id: true, title: true, ownerId: true } },
        fromUser: { select: { id: true, name: true, email: true } },
        toUser: { select: { id: true, name: true, email: true } },
      },
    });

    if (!transferRequest) {
      throw new NotFoundError('Demande de transfert non trouvée');
    }

    // Check if the current user is the intended recipient
    if (transferRequest.toUserId !== currentUserId) {
      throw new ForbiddenError('Vous n\'êtes pas autorisé à accepter cette demande');
    }

    // Check if request is still pending
    if (transferRequest.status !== 'PENDING') {
      throw new BadRequestError(`Cette demande a déjà été ${transferRequest.status === 'ACCEPTED' ? 'acceptée' : transferRequest.status === 'REJECTED' ? 'refusée' : 'traitée'}`);
    }

    // Check if request has expired
    if (new Date() > transferRequest.expiresAt) {
      await prisma.ownershipTransferRequest.update({
        where: { id: transferRequest.id },
        data: { status: 'EXPIRED' },
      });
      throw new BadRequestError('Cette demande de transfert a expiré');
    }

    const projectId = transferRequest.projectId;
    const newOwnerId = transferRequest.toUserId;
    const oldOwnerId = transferRequest.fromUserId;

    // Get memberships
    const newOwnerMembership = await prisma.projectMember.findFirst({
      where: { projectId, userId: newOwnerId },
    });

    const oldOwnerMembership = await prisma.projectMember.findFirst({
      where: { projectId, userId: oldOwnerId },
    });

    if (!newOwnerMembership) {
      throw new BadRequestError('Vous devez être membre du projet pour en devenir propriétaire');
    }

    // Transaction: Update project owner + update member roles + update request status
    await prisma.$transaction(async (tx) => {
      // 1. Update transfer request status
      await tx.ownershipTransferRequest.update({
        where: { id: transferRequest.id },
        data: {
          status: 'ACCEPTED',
          respondedAt: new Date(),
        },
      });

      // 2. Update project owner
      await tx.project.update({
        where: { id: projectId },
        data: {
          ownerId: newOwnerId,
          clientId: newOwnerId,
        },
      });

      // 3. Update new owner's role to OWNER
      await tx.projectMember.update({
        where: { id: newOwnerMembership.id },
        data: {
          role: 'OWNER',
          permissions: {
            view: true,
            edit: true,
            comment: true,
            approve: true,
          },
        },
      });

      // 4. Update old owner's role to COLLABORATOR
      if (oldOwnerMembership) {
        await tx.projectMember.update({
          where: { id: oldOwnerMembership.id },
          data: {
            role: 'COLLABORATOR',
            permissions: {
              view: true,
              edit: true,
              comment: true,
              approve: false,
            },
          },
        });
      }
    });

    // Invalidate cache
    await cacheService.delete(`${CACHE_KEYS.PROJECT_MEMBERS}${projectId}`);

    // Notify old owner that transfer was accepted
    const notification = await prisma.notification.create({
      data: {
        userId: oldOwnerId,
        type: 'OWNERSHIP_TRANSFER_ACCEPTED',
        title: 'Transfert de propriété accepté',
        message: `${transferRequest.toUser.name} a accepté le transfert de propriété du projet "${transferRequest.project.title}"`,
        link: `/workspace/${projectId}`,
      },
    });

    socketService.emitToUser(oldOwnerId, 'notification:new', notification);

    // Emit project update to room
    socketService.emitToProject(projectId, 'project:updated', {
      id: projectId,
      ownerId: newOwnerId,
      previousOwnerId: oldOwnerId,
      ownershipTransferred: true,
    });

    // Send email to old owner
    if (transferRequest.fromUser?.email) {
      try {
        await emailService.sendOwnershipTransferAcceptedEmail({
          to: transferRequest.fromUser.email,
          oldOwnerName: transferRequest.fromUser.name,
          newOwnerName: transferRequest.toUser.name,
          projectTitle: transferRequest.project.title,
          projectId,
        });
      } catch (emailError) {
        console.error('Failed to send transfer accepted email:', emailError);
      }
    }

    console.log('✅ Ownership transferred from', oldOwnerId, 'to', newOwnerId);

    ApiResponse.success(res, {
      projectId,
      newOwnerId,
      projectTitle: transferRequest.project.title,
    }, 'Vous êtes maintenant propriétaire du projet');
  } catch (error) {
    next(error);
  }
};

// Reject ownership transfer request
export const rejectTransferOwnership = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const token = String(req.params.token);
    const { reason } = req.body;
    const currentUserId = req.user!.id;

    console.log('❌ POST /projects/transfer/reject/:token');

    // Find the transfer request
    const transferRequest = await prisma.ownershipTransferRequest.findUnique({
      where: { token },
      include: {
        project: { select: { id: true, title: true } },
        fromUser: { select: { id: true, name: true, email: true } },
        toUser: { select: { id: true, name: true, email: true } },
      },
    });

    if (!transferRequest) {
      throw new NotFoundError('Demande de transfert non trouvée');
    }

    // Check if the current user is the intended recipient
    if (transferRequest.toUserId !== currentUserId) {
      throw new ForbiddenError('Vous n\'êtes pas autorisé à refuser cette demande');
    }

    // Check if request is still pending
    if (transferRequest.status !== 'PENDING') {
      throw new BadRequestError('Cette demande a déjà été traitée');
    }

    // Update request status
    await prisma.ownershipTransferRequest.update({
      where: { id: transferRequest.id },
      data: {
        status: 'REJECTED',
        message: reason || null,
        respondedAt: new Date(),
      },
    });

    // Notify old owner that transfer was rejected
    const rejectMessage = reason
      ? `${transferRequest.toUser.name} a refusé le transfert de propriété du projet "${transferRequest.project.title}". Motif : ${reason}`
      : `${transferRequest.toUser.name} a refusé le transfert de propriété du projet "${transferRequest.project.title}"`;

    const notification = await prisma.notification.create({
      data: {
        userId: transferRequest.fromUserId,
        type: 'OWNERSHIP_TRANSFER_REJECTED',
        title: 'Transfert de propriété refusé',
        message: rejectMessage,
        link: `/workspace/${transferRequest.projectId}`,
      },
    });

    socketService.emitToUser(transferRequest.fromUserId, 'notification:new', notification);

    // Send email to old owner
    if (transferRequest.fromUser?.email) {
      try {
        await emailService.sendOwnershipTransferRejectedEmail({
          to: transferRequest.fromUser.email,
          oldOwnerName: transferRequest.fromUser.name,
          newOwnerName: transferRequest.toUser.name,
          projectTitle: transferRequest.project.title,
          reason: reason || undefined,
        });
      } catch (emailError) {
        console.error('Failed to send transfer rejected email:', emailError);
      }
    }

    console.log('❌ Ownership transfer rejected by', currentUserId);

    ApiResponse.success(res, { status: 'REJECTED' }, 'Demande de transfert refusée');
  } catch (error) {
    next(error);
  }
};

// Cancel ownership transfer request (by the initiator)
export const cancelTransferOwnership = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const token = String(req.params.token);
    const currentUserId = req.user!.id;

    console.log('🚫 DELETE /projects/transfer/:token');

    // Find the transfer request
    const transferRequest = await prisma.ownershipTransferRequest.findUnique({
      where: { token },
      include: {
        project: { select: { id: true, title: true } },
        toUser: { select: { id: true, name: true, email: true } },
      },
    });

    if (!transferRequest) {
      throw new NotFoundError('Demande de transfert non trouvée');
    }

    // Check if the current user is the initiator
    if (transferRequest.fromUserId !== currentUserId) {
      throw new ForbiddenError('Seul l\'initiateur peut annuler cette demande');
    }

    // Check if request is still pending
    if (transferRequest.status !== 'PENDING') {
      throw new BadRequestError('Cette demande a déjà été traitée');
    }

    // Update request status
    await prisma.ownershipTransferRequest.update({
      where: { id: transferRequest.id },
      data: {
        status: 'CANCELLED',
        respondedAt: new Date(),
      },
    });

    // Notify the recipient that the request was cancelled
    const notification = await prisma.notification.create({
      data: {
        userId: transferRequest.toUserId,
        type: 'OWNERSHIP_TRANSFER_CANCELLED',
        title: 'Demande de transfert annulée',
        message: `La demande de transfert de propriété du projet "${transferRequest.project.title}" a été annulée`,
        link: `/workspace/${transferRequest.projectId}`,
      },
    });

    socketService.emitToUser(transferRequest.toUserId, 'notification:new', notification);

    console.log('🚫 Ownership transfer cancelled by', currentUserId);

    ApiResponse.success(res, { status: 'CANCELLED' }, 'Demande de transfert annulée');
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
