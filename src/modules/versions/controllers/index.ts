import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../config/database';
import { ApiResponse } from '../../../utils/apiResponse';
import { NotFoundError, ForbiddenError } from '../../../utils/errors';
import { socketService } from '../../../services/socketService';

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

    // Get version info before deleting to emit Socket event
    const version = await prisma.version.findUnique({
      where: { id },
      include: {
        deliverable: {
          include: {
            project: { select: { id: true } },
          },
        },
      },
    });

    if (!version) throw new NotFoundError('Version not found');

    // Delete the version
    await prisma.version.delete({ where: { id } });

    // Emit deletion event to project room for real-time UI update
    const projectId = version.deliverable?.project?.id;
    const deliverableId = version.deliverableId;
    if (projectId && deliverableId) {
      console.log('[SOCKET] Emitting version:deleted to project:', projectId, {
        id,
        versionNumber: version.versionNumber,
        deliverableId,
        projectId,
      });
      socketService.emitToProject(projectId, 'version:deleted', {
        id,
        versionNumber: version.versionNumber,
        deliverableId,
        projectId,
      });
    }

    ApiResponse.success(res, null, 'Version deleted');
  } catch (error) {
    next(error);
  }
};

export const updateStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { status } = req.body;

    // Get version with full deliverable and project info
    const version = await prisma.version.findUnique({
      where: { id },
      include: {
        deliverable: {
          include: {
            project: { select: { id: true, title: true, clientId: true, ownerId: true } },
            assignedTalent: { select: { id: true } },
          },
        },
      },
    });

    if (!version) throw new NotFoundError('Version not found');

    // Check permissions: only client/owner can approve versions
    if (status === 'APPROVED') {
      const project = version.deliverable?.project;
      if (!project || (project.clientId !== req.user!.id && project.ownerId !== req.user!.id)) {
        throw new ForbiddenError('Only the client can validate versions');
      }
    }

    // Update version status
    const updatedVersion = await prisma.version.update({
      where: { id },
      data: { status },
      include: {
        deliverable: {
          include: {
            project: { select: { id: true, title: true } },
            assignedTalent: { select: { id: true } },
          },
        },
      },
    });

    // Notify talent when version is approved
    if (status === 'APPROVED' && updatedVersion.deliverable?.assignedTalent?.id) {
      const notification = await prisma.notification.create({
        data: {
          userId: updatedVersion.deliverable.assignedTalent.id,
          type: 'VERSION_APPROVED',
          title: 'Version approuvée !',
          message: `Votre version ${updatedVersion.versionNumber} de "${updatedVersion.deliverable.title}" a été approuvée`,
          link: `/workspace/${updatedVersion.deliverable.project?.id}`,
        },
      });

      // Emit real-time notification
      socketService.emitToUser(updatedVersion.deliverable.assignedTalent.id, 'notification:new', notification);
    }

    // Notify talent when changes are requested
    if (status === 'CHANGES_REQUESTED' && updatedVersion.deliverable?.assignedTalent?.id) {
      const notification = await prisma.notification.create({
        data: {
          userId: updatedVersion.deliverable.assignedTalent.id,
          type: 'VERSION_CHANGES_REQUESTED',
          title: 'Modifications demandées',
          message: `Des modifications ont été demandées sur la version ${updatedVersion.versionNumber} de "${updatedVersion.deliverable.title}"`,
          link: `/workspace/${updatedVersion.deliverable.project?.id}`,
        },
      });

      // Emit real-time notification
      socketService.emitToUser(updatedVersion.deliverable.assignedTalent.id, 'notification:new', notification);
    }

    // Emit version status change to project room
    if (updatedVersion.deliverable?.project?.id) {
      socketService.emitToProject(updatedVersion.deliverable.project.id, 'version:status', {
        id: updatedVersion.id,
        versionNumber: updatedVersion.versionNumber,
        status: updatedVersion.status,
        deliverableId: updatedVersion.deliverableId,
        projectId: updatedVersion.deliverable.project.id,
      });
    }

    ApiResponse.success(res, updatedVersion, 'Status updated');
  } catch (error) {
    next(error);
  }
};

export const addFeedback = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { rawText, structuredText, type, tasks, replyingToId } = req.body;

    // Get version with deliverable info for notification
    const version = await prisma.version.findUnique({
      where: { id },
      include: {
        deliverable: {
          include: {
            project: { select: { id: true, title: true } },
            assignedTalent: { select: { id: true } },
          },
        },
      },
    });

    if (!version) throw new NotFoundError('Version not found');

    // Always create a new feedback (conversation style)
    const feedback = await prisma.feedback.create({
      data: {
        versionId: id,
        authorId: req.user!.id,
        rawText,
        structuredText,
        type: type || 'TEXT',
        replyingToId: replyingToId || undefined,
        revisionTasks: tasks ? {
          create: tasks.map((t: any) => ({ description: t.description })),
        } : undefined,
      },
      include: {
        revisionTasks: true,
        author: {
          select: { id: true, name: true, avatarUrl: true }
        },
        replyingTo: {
          select: {
            id: true,
            rawText: true,
            structuredText: true,
            author: { select: { id: true, name: true } }
          }
        }
      },
    });

    // Update version status
    await prisma.version.update({
      where: { id },
      data: { status: 'CHANGES_REQUESTED' },
    });

    // Update deliverable status to RETOUR (only if current user is the owner/client)
    if (version.deliverable && version.deliverable.projectId) {
      const project = await prisma.project.findUnique({
        where: { id: version.deliverable.projectId },
        select: { ownerId: true, clientId: true }
      });

      // Only change status if the user is the owner or client
      if (project && (project.ownerId === req.user!.id || project.clientId === req.user!.id)) {
        await prisma.deliverable.update({
          where: { id: version.deliverable.id },
          data: { status: 'RETOUR' },
        });
      }
    }

    // Parse @mentions - check if any project user names appear after @ in the text
    console.log('🔍 [MENTION] Raw text:', rawText);

    if (rawText.includes('@') && version.deliverable?.projectId) {
      // Find project members by name
      const projectMembers = await prisma.projectMember.findMany({
        where: { projectId: version.deliverable.projectId },
        include: { user: { select: { id: true, name: true } } },
      });

      // Also get project talent, owner, client
      const projectDetails = await prisma.project.findUnique({
        where: { id: version.deliverable.projectId },
        select: {
          talent: { select: { id: true, name: true } },
          owner: { select: { id: true, name: true } },
          client: { select: { id: true, name: true } },
        },
      });

      // Build list of all possible users to mention (deduplicated)
      const allUsersMap = new Map<string, string>();
      projectMembers.forEach(m => allUsersMap.set(m.user.id, m.user.name));
      if (projectDetails?.talent) allUsersMap.set(projectDetails.talent.id, projectDetails.talent.name);
      if (projectDetails?.owner) allUsersMap.set(projectDetails.owner.id, projectDetails.owner.name);
      if (projectDetails?.client) allUsersMap.set(projectDetails.client.id, projectDetails.client.name);

      const allUsers = Array.from(allUsersMap.entries()).map(([id, name]) => ({ id, name }));
      console.log('🔍 [MENTION] All mentionable users:', allUsers.map(u => u.name));

      // Check if any user name appears after @ in the text (case insensitive)
      const mentionedUserIds = new Set<string>();
      const textLower = rawText.toLowerCase();

      for (const user of allUsers) {
        // Skip current user (can't mention yourself)
        if (user.id === req.user!.id) continue;

        // Check if @username appears in text
        const mentionPattern = '@' + user.name.toLowerCase();
        if (textLower.includes(mentionPattern)) {
          console.log(`✅ [MENTION] Found mention of "${user.name}"`);
          mentionedUserIds.add(user.id);
        }
      }

      console.log('🔍 [MENTION] Matched user IDs:', Array.from(mentionedUserIds));

      // Create notifications and emit events for each mentioned user
      for (const userId of mentionedUserIds) {
        console.log(`📧 [MENTION] Creating notification for user ${userId}`);
        const notification = await prisma.notification.create({
          data: {
            userId,
            type: 'MENTION',
            title: 'Vous avez été mentionné',
            message: `${feedback.author?.name || 'Quelqu\'un'} vous a mentionné dans un commentaire sur "${version.deliverable.title}"`,
            link: `/deliverable/${version.deliverableId}`,
          },
        });

        console.log(`📡 [MENTION] Emitting mention:new to user ${userId}`);
        // Emit mention notification with sound flag
        socketService.emitToUser(userId, 'mention:new', {
          ...notification,
          authorName: feedback.author?.name,
          feedbackId: feedback.id,
          deliverableTitle: version.deliverable.title,
          projectId: version.deliverable.project?.id,
          playSound: true,
        });

        // Also emit standard notification
        socketService.emitToUser(userId, 'notification:new', notification);
      }
    } else {
      console.log('🔍 [MENTION] No @ found or no projectId');
    }

    // Notify the assigned talent that feedback was received (if not already mentioned)
    if (version.deliverable?.assignedTalent?.id && version.deliverable.assignedTalent.id !== req.user!.id) {
      const notification = await prisma.notification.create({
        data: {
          userId: version.deliverable.assignedTalent.id,
          type: 'FEEDBACK_RECEIVED',
          title: 'Nouveau feedback reçu',
          message: `Un feedback a été ajouté sur la version ${version.versionNumber} de "${version.deliverable.title}"`,
          link: `/workspace/${version.deliverable.project?.id}`,
        },
      });

      // Emit real-time notification
      socketService.emitToUser(version.deliverable.assignedTalent.id, 'notification:new', notification);
    }

    // Emit feedback event to project room
    if (version.deliverable?.project?.id) {
      socketService.emitToProject(version.deliverable.project.id, 'feedback:new', {
        id: feedback.id,
        versionId: id,
        authorId: req.user!.id,
        authorName: feedback.author?.name || 'Unknown',
        type: feedback.type,
        projectId: version.deliverable.project.id,
      });
    }

    ApiResponse.created(res, feedback, 'Feedback added');
  } catch (error) {
    next(error);
  }
};
