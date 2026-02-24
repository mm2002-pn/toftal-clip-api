import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../config/database';
import { ApiResponse } from '../../../utils/apiResponse';
import { NotFoundError } from '../../../utils/errors';
import { sendEmail, emailTemplates } from '../../../config/email';
import { socketService } from '../../../services/socketService';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

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
    await prisma.deliverable.delete({ where: { id } });
    ApiResponse.success(res, null, 'Deliverable deleted');
  } catch (error) {
    next(error);
  }
};

export const assignTalent = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { talentId } = req.body;

    const deliverable = await prisma.deliverable.update({
      where: { id },
      data: {
        assignedTalentId: talentId,
        acceptanceStatus: talentId ? 'PENDING' : null,
      },
      include: {
        assignedTalent: { select: { id: true, name: true, email: true, avatarUrl: true } },
        project: { select: { id: true, title: true, clientId: true } },
      },
    });

    // Create notification and send email for the assigned talent
    if (talentId && deliverable.project && deliverable.assignedTalent) {
      const notification = await prisma.notification.create({
        data: {
          userId: talentId,
          type: 'TALENT_ASSIGNED',
          title: 'Nouvelle vidéo assignée',
          message: `Vous avez été assigné à la vidéo "${deliverable.title}" du projet "${deliverable.project.title}"`,
          link: `/workspace/${deliverable.project.id}`,
        },
      });

      // Emit real-time notification
      socketService.emitToUser(talentId, 'notification:new', notification);

      // Send email notification
      try {
        const workspaceUrl = `${FRONTEND_URL}/#/workspace/${deliverable.project.id}`;
        await sendEmail(
          deliverable.assignedTalent.email,
          emailTemplates.talentAssigned(
            deliverable.assignedTalent.name,
            deliverable.title,
            deliverable.project.title,
            workspaceUrl
          )
        );
      } catch (emailError) {
        console.error('Failed to send assignment email:', emailError);
        // Don't fail the request if email fails
      }
    }

    ApiResponse.success(res, deliverable, 'Talent assigned');
  } catch (error) {
    next(error);
  }
};

export const updateStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { status, progress } = req.body;

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

    // Update deliverable status to REVIEW
    await prisma.deliverable.update({
      where: { id },
      data: { status: 'REVIEW' },
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
          link: `/workspace/${deliverable.project.id}`,
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
      data: { acceptanceStatus: 'ACCEPTED' },
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
          link: `/workspace/${deliverable.project.id}`,
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
          link: `/workspace/${deliverable.project.id}`,
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
