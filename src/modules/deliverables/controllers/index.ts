import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../config/database';
import { ApiResponse } from '../../../utils/apiResponse';
import { NotFoundError } from '../../../utils/errors';
import { sendEmail, emailTemplates } from '../../../config/email';
import { socketService } from '../../../services/socketService';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// Helper function to calculate progress from status
const getProgressFromStatus = (status: string): number => {
  switch (status) {
    case 'PREPARATION':
      return 0;
    case 'RETOUR':
      return 40;
    case 'PRODUCTION':
      return 50;
    case 'VALIDATION':
      return 75;
    case 'VALIDE':
      return 100;
    default:
      return 0;
  }
};

export const updateDeliverable = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { title, type, deadline } = req.body;

    const deliverable = await prisma.deliverable.update({
      where: { id },
      data: { title, type, deadline: deadline ? new Date(deadline) : undefined },
    });

    ApiResponse.success(res, deliverable, 'Deliverable updated');
  } catch (error) {
    next(error);
  }
};

export const deleteDeliverable = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);

    // Get deliverable before deleting to get projectId for Socket emission
    const deliverable = await prisma.deliverable.findUnique({
      where: { id },
      include: {
        project: { select: { id: true } },
      },
    });

    if (!deliverable) {
      throw new NotFoundError('Deliverable not found');
    }

    // Delete the deliverable
    await prisma.deliverable.delete({ where: { id } });

    // Emit deletion event to project room for real-time UI update
    const projectId = deliverable.project?.id;
    if (projectId) {
      console.log('[SOCKET] Emitting deliverable:deleted to project:', projectId, { id, projectId });
      socketService.emitToProject(projectId, 'deliverable:deleted', { id, projectId });
    }

    ApiResponse.success(res, null, 'Deliverable deleted');
  } catch (error) {
    next(error);
  }
};

export const assignTalent = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { talentId, force } = req.body;

    // Get current deliverable to check acceptance status and versions
    const currentDeliverable = await prisma.deliverable.findUnique({
      where: { id },
      include: {
        project: { select: { clientId: true } },
        versions: { select: { id: true, status: true } },
      },
    });

    if (!currentDeliverable) {
      throw new NotFoundError('Deliverable not found');
    }

    // Check if user is the project owner or admin
    const isOwnerOrAdmin = req.user!.id === currentDeliverable.project?.clientId || req.user!.role === 'ADMIN';

    // Prevent modification if deliverable is validated
    if (
      currentDeliverable.status === 'VALIDE' &&
      !force
    ) {
      return ApiResponse.forbidden(res,
        'Impossible de modifier: cette livrable est validée.'
      ) as any;
    }

    // Prevent UNASSIGNMENT if there are APPROVED versions
    const hasApprovedVersions = currentDeliverable.versions.some((v: any) => v.status === 'APPROVED');
    if (
      !talentId &&
      hasApprovedVersions &&
      !force
    ) {
      return ApiResponse.forbidden(res,
        'Impossible de retirer l\'assignation: des versions ont déjà été validées.'
      ) as any;
    }

    // Prevent reassignment if talent has already accepted
    if (
      currentDeliverable.assignedTalentId &&
      currentDeliverable.acceptanceStatus === 'ACCEPTED' &&
      currentDeliverable.status !== 'VALIDE' &&
      talentId && // Only block if trying to reassign to someone else
      talentId !== currentDeliverable.assignedTalentId &&
      !force
    ) {
      return ApiResponse.forbidden(res,
        'Impossible de reassigner: le talent a deja accepte cette mission. ' +
        'Contactez le talent pour discuter d\'un changement.'
      ) as any;
    }

    // Calculate new status and progress
    // - Assigning: Stay in PREPARATION, set acceptanceStatus to PENDING (talent must accept first)
    // - Unassigning: Revert to PREPARATION (only if no versions uploaded - already checked above)
    let updateData: any = {
      assignedTalentId: talentId,
      acceptanceStatus: talentId ? 'PENDING' : null,
    };

    if (talentId) {
      // Assigning talent: Stay in PREPARATION until talent accepts
      // Status will change to PRODUCTION only when talent accepts the assignment
    } else {
      // Unassigning talent: revert to PREPARATION
      updateData.status = 'PREPARATION';
      updateData.progress = getProgressFromStatus('PREPARATION');
    }

    // Get info about the previously assigned talent before unassignment
    const previousTalent = !talentId && currentDeliverable.assignedTalentId
      ? await prisma.user.findUnique({
          where: { id: currentDeliverable.assignedTalentId },
          select: { id: true, name: true, email: true, avatarUrl: true },
        })
      : null;

    const deliverable = await prisma.deliverable.update({
      where: { id },
      data: updateData,
      include: {
        assignedTalent: { select: { id: true, name: true, email: true, avatarUrl: true } },
        project: { select: { id: true, title: true, clientId: true } },
      },
    });

    // Cast for TypeScript - include adds these relations
    const del = deliverable as any;

    // Create notification and send email for the assigned talent
    if (talentId && del.project && del.assignedTalent) {
      const notification = await prisma.notification.create({
        data: {
          userId: talentId,
          type: 'TALENT_ASSIGNED',
          title: 'Nouvelle vidéo assignée',
          message: `Vous avez été assigné à la vidéo "${deliverable.title}" du projet "${del.project.title}"`,
          link: `/deliverable/${deliverable.id}`,
        },
      });

      // Emit real-time notification
      socketService.emitToUser(talentId, 'notification:new', notification);

      // Send email notification
      try {
        const workspaceUrl = `${FRONTEND_URL}/#/workspace/${del.project.id}`;
        await sendEmail(
          del.assignedTalent.email,
          emailTemplates.talentAssigned(
            del.assignedTalent.name,
            deliverable.title,
            del.project.title,
            workspaceUrl
          )
        );
      } catch (emailError) {
        console.error('Failed to send assignment email:', emailError);
        // Don't fail the request if email fails
      }
    }

    // Create notification and send email for the UNASSIGNED talent
    if (!talentId && previousTalent && del.project) {
      const notification = await prisma.notification.create({
        data: {
          userId: previousTalent.id,
          type: 'TALENT_UNASSIGNED',
          title: 'Assignation retirée',
          message: `Votre assignation à la vidéo "${deliverable.title}" du projet "${del.project.title}" a été retirée`,
          link: `/deliverable/${deliverable.id}`,
        },
      });

      // Emit real-time notification
      socketService.emitToUser(previousTalent.id, 'notification:new', notification);

      // Send email notification
      try {
        const workspaceUrl = `${FRONTEND_URL}/#/workspace/${del.project.id}`;
        await sendEmail(
          previousTalent.email,
          emailTemplates.talentUnassigned(
            previousTalent.name,
            deliverable.title,
            del.project.title,
            workspaceUrl
          )
        );
      } catch (emailError) {
        console.error('Failed to send unassignment email:', emailError);
        // Don't fail the request if email fails
      }
    }

    // Emit deliverable assignment event to project room for real-time updates
    const projectId = del.project?.id || currentDeliverable.projectId;
    const assignmentPayload = {
      id: deliverable.id,
      projectId: projectId,
      assignedTalentId: deliverable.assignedTalentId,
      assignedTalent: del.assignedTalent ? {
        id: del.assignedTalent.id,
        name: del.assignedTalent.name,
        avatarUrl: del.assignedTalent.avatarUrl || undefined,
      } : undefined,
      status: deliverable.status,
      progress: deliverable.progress,
    };

    console.log('[SOCKET] Emitting deliverable:assigned to project:', projectId, assignmentPayload);
    socketService.emitToProject(projectId, 'deliverable:assigned', assignmentPayload);

    // Also emit directly to client (project owner)
    const clientId = del.project?.clientId || currentDeliverable.project?.clientId;
    if (clientId) {
      console.log('[SOCKET] Emitting deliverable:assigned to client:', clientId);
      socketService.emitToUser(clientId, 'deliverable:assigned', assignmentPayload);
    }

    // Also emit directly to assigned talent
    if (talentId) {
      console.log('[SOCKET] Emitting deliverable:assigned to talent:', talentId);
      socketService.emitToUser(talentId, 'deliverable:assigned', assignmentPayload);
    }

    ApiResponse.success(res, deliverable, talentId ? 'Talent assigned' : 'Talent removed');
  } catch (error) {
    next(error);
  }
};

export const updateStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { status } = req.body;

    // Calculate progress from status automatically
    const progress = getProgressFromStatus(status);

    const deliverable = await prisma.deliverable.update({
      where: { id },
      data: { status, progress },
      include: { project: { select: { id: true } } },
    });

    // Emit deliverable status change to project room
    if (deliverable.project?.id) {
      socketService.emitToProject(deliverable.project.id, 'deliverable:status', {
        id: deliverable.id,
        status: deliverable.status,
        projectId: deliverable.project.id,
      });
    }

    ApiResponse.success(res, deliverable, 'Status updated');
  } catch (error) {
    next(error);
  }
};

export const validateDeliverable = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);

    // First get deliverable with all needed info
    const existingDeliverable = await prisma.deliverable.findUnique({
      where: { id },
      include: {
        project: {
          select: {
            id: true,
            title: true,
            clientId: true,
          },
        },
        assignedTalent: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!existingDeliverable) {
      throw new NotFoundError('Deliverable not found');
    }

    // Update deliverable status
    const deliverable = await prisma.deliverable.update({
      where: { id },
      data: {
        status: 'VALIDE',
        progress: 100, // Automatically set to 100% when validated
      },
      include: { project: { select: { id: true } } },
    });

    // Emit deliverable status change to project room
    if (deliverable.project?.id) {
      socketService.emitToProject(deliverable.project.id, 'deliverable:status', {
        id: deliverable.id,
        status: deliverable.status,
        projectId: deliverable.project.id,
      });
    }

    // Notify the assigned talent about validation
    if (existingDeliverable.assignedTalent && existingDeliverable.project) {
      const notification = await prisma.notification.create({
        data: {
          userId: existingDeliverable.assignedTalent.id,
          type: 'DELIVERABLE_VALIDATED',
          title: '✅ Vidéo validée',
          message: `Votre vidéo "${existingDeliverable.title}" du projet "${existingDeliverable.project.title}" a été validée. Excellent travail !`,
          link: `/deliverable/${existingDeliverable.id}`,
        },
      });

      // Emit real-time notification to the talent
      socketService.emitToUser(existingDeliverable.assignedTalent.id, 'notification:new', notification);
      console.log(`📡 [VALIDATE_DELIVERABLE] Notification sent to talent ${existingDeliverable.assignedTalent.id}`);
    }

    ApiResponse.success(res, deliverable, 'Deliverable validated');
  } catch (error) {
    next(error);
  }
};

export const addVersion = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { videoUrl, description } = req.body;

    // Get deliverable with project info for notification
    const deliverable = await prisma.deliverable.findUnique({
      where: { id },
      include: { project: { select: { id: true, title: true, clientId: true } } },
    });

    if (!deliverable) throw new NotFoundError('Deliverable not found');

    // Check if deliverable is already validated
    if (deliverable.status === 'VALIDE') {
      throw new Error('Cannot add version to a validated deliverable');
    }

    // Get next version number
    const lastVersion = await prisma.version.findFirst({
      where: { deliverableId: id },
      orderBy: { versionNumber: 'desc' },
    });

    const versionNumber = (lastVersion?.versionNumber || 0) + 1;

    const version = await prisma.version.create({
      data: {
        deliverableId: id,
        versionNumber,
        videoUrl,
        description,
        uploadedById: req.user!.id,
      },
    });

    // Update deliverable status to VALIDATION with progress 75%
    await prisma.deliverable.update({
      where: { id },
      data: {
        status: 'VALIDATION',
        progress: 75, // Automatically set to 75% when in validation
      },
    });

    // Notify the client that a new version was uploaded
    if (deliverable.project?.clientId) {
      // Get client info for email
      const client = await prisma.user.findUnique({
        where: { id: deliverable.project.clientId },
        select: { name: true, email: true },
      });

      const notification = await prisma.notification.create({
        data: {
          userId: deliverable.project.clientId,
          type: 'VERSION_UPLOADED',
          title: 'Nouvelle version disponible',
          message: `La version ${versionNumber} de "${deliverable.title}" est prête pour review`,
          link: `/deliverable/${deliverable.id}`,
        },
      });

      // Emit real-time notification
      socketService.emitToUser(deliverable.project.clientId, 'notification:new', notification);

      // Send email notification
      if (client?.email) {
        try {
          const workspaceUrl = `${FRONTEND_URL}/#/workspace/${deliverable.project.id}`;
          await sendEmail(
            client.email,
            emailTemplates.newVersion(
              client.name,
              deliverable.title,
              deliverable.project.title,
              versionNumber,
              workspaceUrl
            )
          );
        } catch (emailError) {
          console.error('Failed to send new version email:', emailError);
        }
      }
    }

    // Emit version:new to project room
    socketService.emitToProject(deliverable.project!.id, 'version:new', {
      id: version.id,
      versionNumber: version.versionNumber,
      status: version.status,
      deliverableId: id,
      projectId: deliverable.project!.id,
    });

    ApiResponse.created(res, version, 'Version added');
  } catch (error) {
    next(error);
  }
};

export const getVersions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);

    const versions = await prisma.version.findMany({
      where: { deliverableId: id },
      orderBy: { versionNumber: 'desc' },
      include: {
        uploadedBy: { select: { id: true, name: true, avatarUrl: true } },
        feedbacks: { include: { revisionTasks: true, author: true }, orderBy: { createdAt: 'asc' } },
      },
    });

    ApiResponse.success(res, versions);
  } catch (error) {
    next(error);
  }
};

export const addMedia = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { name, url, type, category } = req.body;

    const deliverable = await prisma.deliverable.findUnique({ where: { id } });
    if (!deliverable) throw new NotFoundError('Deliverable not found');

    const media = await prisma.mediaResource.create({
      data: {
        projectId: deliverable.projectId,
        deliverableId: id,
        name,
        url,
        type,
        category,
        addedBy: req.user!.id,
      },
    });

    ApiResponse.created(res, media, 'Media added');
  } catch (error) {
    next(error);
  }
};

export const getMedia = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);

    const media = await prisma.mediaResource.findMany({
      where: { deliverableId: id },
    });

    ApiResponse.success(res, media);
  } catch (error) {
    next(error);
  }
};

export const acceptAssignment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);

    // Verify the user is the assigned talent
    const deliverable = await prisma.deliverable.findUnique({
      where: { id },
      include: {
        project: { select: { id: true, title: true, clientId: true } },
      },
    });

    if (!deliverable) throw new NotFoundError('Deliverable not found');
    if (deliverable.assignedTalentId !== req.user!.id) {
      throw new Error('You are not assigned to this deliverable');
    }

    const updated = await prisma.deliverable.update({
      where: { id },
      data: {
        acceptanceStatus: 'ACCEPTED',
        // Move to PRODUCTION when talent accepts the assignment
        status: 'PRODUCTION',
        progress: getProgressFromStatus('PRODUCTION'),
      },
      include: {
        assignedTalent: { select: { id: true, name: true, avatarUrl: true } },
      },
    });

    // Notify the client that the talent accepted
    if (deliverable.project?.clientId) {
      // Get client and talent info for email
      const client = await prisma.user.findUnique({
        where: { id: deliverable.project.clientId },
        select: { name: true, email: true },
      });

      const talent = await prisma.user.findUnique({
        where: { id: req.user!.id },
        select: { name: true },
      });

      const notification = await prisma.notification.create({
        data: {
          userId: deliverable.project.clientId,
          type: 'ASSIGNMENT_ACCEPTED',
          title: 'Mission acceptée',
          message: `${talent?.name || 'Le talent'} a accepté de travailler sur "${deliverable.title}"`,
          link: `/deliverable/${deliverable.id}`,
        },
      });

      // Emit real-time notification
      socketService.emitToUser(deliverable.project.clientId, 'notification:new', notification);

      // Emit assignment accepted event to project room for real-time UI update
      socketService.emitToProject(deliverable.project.id, 'deliverable:assignment:accepted', {
        deliverableId: deliverable.id,
        projectId: deliverable.project.id,
        talentId: req.user!.id,
        talentName: talent?.name,
        acceptedAt: new Date(),
      });

      // Send email notification
      if (client?.email) {
        try {
          const workspaceUrl = `${FRONTEND_URL}/#/workspace/${deliverable.project.id}`;
          await sendEmail(
            client.email,
            emailTemplates.assignmentAccepted(
              client.name,
              talent?.name || 'Le talent',
              deliverable.title,
              deliverable.project.title,
              workspaceUrl
            )
          );
        } catch (emailError) {
          console.error('Failed to send acceptance email:', emailError);
        }
      }
    }

    ApiResponse.success(res, updated, 'Assignment accepted');
  } catch (error) {
    next(error);
  }
};

export const rejectAssignment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { reason } = req.body;

    // Verify the user is the assigned talent
    const deliverable = await prisma.deliverable.findUnique({
      where: { id },
      include: {
        project: { select: { id: true, title: true, clientId: true } },
        assignedTalent: { select: { id: true, name: true } },
      },
    });

    if (!deliverable) throw new NotFoundError('Deliverable not found');
    if (deliverable.assignedTalentId !== req.user!.id) {
      throw new Error('You are not assigned to this deliverable');
    }

    // Remove assignment and set status to rejected
    const updated = await prisma.deliverable.update({
      where: { id },
      data: {
        acceptanceStatus: 'REJECTED',
        assignedTalentId: null,
      },
    });

    // Notify the client that the talent rejected
    if (deliverable.project?.clientId) {
      // Get client info for email
      const client = await prisma.user.findUnique({
        where: { id: deliverable.project.clientId },
        select: { name: true, email: true },
      });

      const notification = await prisma.notification.create({
        data: {
          userId: deliverable.project.clientId,
          type: 'ASSIGNMENT_REJECTED',
          title: 'Mission refusée',
          message: `${deliverable.assignedTalent?.name || 'Le talent'} a refusé de travailler sur "${deliverable.title}"${reason ? `. Raison: ${reason}` : ''}`,
          link: `/deliverable/${deliverable.id}`,
        },
      });

      // Emit real-time notification
      socketService.emitToUser(deliverable.project.clientId, 'notification:new', notification);

      // Emit assignment rejected event to project room for real-time UI update
      socketService.emitToProject(deliverable.project.id, 'deliverable:assignment:rejected', {
        deliverableId: deliverable.id,
        projectId: deliverable.project.id,
        talentId: req.user!.id,
        talentName: deliverable.assignedTalent?.name,
        reason: reason || null,
        rejectedAt: new Date(),
      });

      // Send email notification
      if (client?.email) {
        try {
          const workspaceUrl = `${FRONTEND_URL}/#/workspace/${deliverable.project.id}`;
          await sendEmail(
            client.email,
            emailTemplates.assignmentRejected(
              client.name,
              deliverable.assignedTalent?.name || 'Le talent',
              deliverable.title,
              deliverable.project.title,
              reason || null,
              workspaceUrl
            )
          );
        } catch (emailError) {
          console.error('Failed to send rejection email:', emailError);
        }
      }
    }

    ApiResponse.success(res, updated, 'Assignment rejected');
  } catch (error) {
    next(error);
  }
};

export const extractVersionMetadata = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id: deliverableId, versionId } = req.params;
    const { metadata } = req.body; // Metadata can come from frontend OR be extracted from URL
    const versionIdStr = String(versionId);

    // Get version
    const version = await prisma.version.findUnique({
      where: { id: versionIdStr },
      include: { deliverable: true },
    });

    if (!version) {
      ApiResponse.error(res, 'Version not found', 404);
      return;
    }

    if (version.deliverableId !== deliverableId) {
      ApiResponse.error(res, 'Version does not belong to this deliverable', 400);
      return;
    }

    // If metadata provided, validate and use it
    let finalMetadata;
    if (metadata) {
      const { validateMetadata } = require('../../../services/VideoMetadataService');
      finalMetadata = validateMetadata(metadata);

      if (!finalMetadata) {
        ApiResponse.error(res, 'Invalid metadata format', 400);
        return;
      }
    } else {
      // Extract using FFmpeg if no metadata provided
      const { extractVideoMetadata } = require('../../../services/VideoMetadataService');
      console.log(`📹 Extracting metadata for version ${versionIdStr}...`);
      finalMetadata = await extractVideoMetadata(version.videoUrl);
    }

    console.log(`📹 Saving metadata for version ${versionIdStr}:`, finalMetadata);

    // Save metadata to database
    const updated = await prisma.version.update({
      where: { id: versionIdStr },
      data: { metadata: finalMetadata },
    });

    console.log(`✅ Metadata saved for version ${versionIdStr}`);

    ApiResponse.success(res, finalMetadata, 'Metadata extracted and saved');
  } catch (error) {
    console.error('Error extracting metadata:', error);
    next(error);
  }
};

export const downscaleVersion = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id: deliverableId, versionId } = req.params;
    const { quality } = req.body; // Target quality: "1080p", "2K", "4K", etc.
    const versionIdStr = String(versionId);

    if (!quality) {
      ApiResponse.error(res, 'Target quality is required', 400);
      return;
    }

    // Get version
    const version = await prisma.version.findUnique({
      where: { id: versionIdStr },
      include: { deliverable: true },
    });

    if (!version) {
      ApiResponse.error(res, 'Version not found', 404);
      return;
    }

    if (version.deliverableId !== deliverableId) {
      ApiResponse.error(res, 'Version does not belong to this deliverable', 400);
      return;
    }

    // Get metadata (extract if needed)
    let metadata = version.metadata as any;
    if (!metadata) {
      const { extractVideoMetadata } = require('../../../services/VideoMetadataService');
      console.log('📹 Extracting metadata first...');
      metadata = await extractVideoMetadata(version.videoUrl);

      // Save metadata
      await prisma.version.update({
        where: { id: versionIdStr },
        data: { metadata },
      });
    }

    // Check if already cached
    const alternativeQualities = version.alternativeQualities as any;
    if (alternativeQualities && alternativeQualities[quality]) {
      console.log(`✅ Returning cached version for quality ${quality}`);
      ApiResponse.success(res, {
        quality,
        url: alternativeQualities[quality],
        source: 'cached',
      }, 'Downscaled version available');
      return;
    }

    // Downscale video
    const { downscaleAndUploadVideo } = require('../../../services/VideoMetadataService');

    console.log(`🎬 Downscaling version ${versionIdStr} to ${quality}...`);
    const downscaledUrl = await downscaleAndUploadVideo(version.videoUrl, quality, metadata);

    // Save to database
    const updatedAlternatives = alternativeQualities || {};
    updatedAlternatives[quality] = downscaledUrl;

    await prisma.version.update({
      where: { id: versionIdStr },
      data: { alternativeQualities: updatedAlternatives },
    });

    console.log(`✅ Version downscaled to ${quality}: ${downscaledUrl}`);

    ApiResponse.success(res, {
      quality,
      url: downscaledUrl,
      source: 'generated',
    }, 'Version downscaled');
  } catch (error) {
    console.error('Error downscaling version:', error);
    next(error);
  }
};
