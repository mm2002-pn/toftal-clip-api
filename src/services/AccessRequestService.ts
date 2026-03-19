import { PrismaClient } from '@prisma/client';
import { EmailService } from './EmailService';
import { socketService } from './socketService';

export class AccessRequestService {
  constructor(
    private prisma: PrismaClient,
    private emailService: EmailService
  ) {}

  /**
   * Create an access request (user asking for more permissions)
   */
  async createAccessRequest(projectId: string, userId: string, message?: string) {
    // Check if request already exists
    const existingRequest = await this.prisma.accessRequest.findUnique({
      where: {
        projectId_userId: { projectId, userId },
      },
    });

    if (existingRequest && existingRequest.status === 'PENDING') {
      throw new Error('Access request already pending for this user');
    }

    // Create or update request
    const request = await this.prisma.accessRequest.upsert({
      where: {
        projectId_userId: { projectId, userId },
      },
      create: {
        projectId,
        userId,
        message,
        status: 'PENDING',
      },
      update: {
        message,
        status: 'PENDING',
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        project: { select: { id: true, title: true, ownerId: true, owner: { select: { email: true, name: true } } } },
      },
    });

    // Send email to project owner
    if (request.project.owner) {
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      const projectUrl = `${frontendUrl}/#/workspace/${projectId}`;

      await this.emailService.sendAccessRequestEmail({
        to: request.project.owner.email,
        requesterName: request.user.name,
        requesterEmail: request.user.email,
        projectTitle: request.project.title,
        message,
        projectUrl,
      });

      // Create notification in database
      const ownerId = request.project.ownerId;
      if (ownerId) {
        const notification = await this.prisma.notification.create({
          data: {
            userId: ownerId,
            type: 'ACCESS_REQUEST',
            title: 'Demande d\'accès reçue',
            message: `${request.user.name} a demandé accès au projet "${request.project.title}"`,
            link: `/#/workspace/${projectId}`,
          },
        });

        // Send real-time notification via Socket.IO
        socketService.emitToUser(ownerId, 'notification:new', {
          id: notification.id,
          type: notification.type,
          title: notification.title,
          message: notification.message,
          link: notification.link,
          createdAt: notification.createdAt,
        });

        // Emit access request event to reload on the project page
        socketService.emitToUser(ownerId, 'access-request:new', {
          requestId: request.id,
          projectId: projectId,
        });
      }
    }

    console.log(`✅ Access request created for ${request.user.email} on project ${projectId}`);

    return request;
  }

  /**
   * Get pending access requests for a project (for owner)
   */
  async getProjectAccessRequests(projectId: string) {
    return this.prisma.accessRequest.findMany({
      where: { projectId, status: 'PENDING' },
      include: {
        user: { select: { id: true, name: true, email: true, avatarUrl: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Approve an access request and update permissions
   */
  async approveAccessRequest(requestId: string, projectId: string, userId: string) {
    // Update request status
    const request = await this.prisma.accessRequest.update({
      where: { id: requestId },
      data: { status: 'APPROVED' },
      include: {
        user: { select: { email: true, name: true, role: true } },
        project: { select: { title: true } },
      },
    });

    // Update project member permissions based on role
    const isTalent = request.user.role === 'TALENT';
    const permissions = isTalent
      ? { view: true, edit: true, comment: true, approve: true }
      : { view: true, edit: true, comment: true, approve: false };

    await this.prisma.projectMember.update({
      where: {
        projectId_userId: { projectId, userId },
      },
      data: { permissions },
    });

    // Send confirmation email
    await this.emailService.sendAccessApprovedEmail({
      to: request.user.email,
      projectTitle: request.project.title,
    });

    // Create notification for the requester
    const notification = await this.prisma.notification.create({
      data: {
        userId,
        type: 'ACCESS_APPROVED',
        title: 'Accès approuvé',
        message: `Votre demande d'accès pour "${request.project.title}" a été approuvée`,
        link: `/#/workspace/${projectId}`,
      },
    });

    // Send real-time notification
    socketService.emitToUser(userId, 'notification:new', {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      link: notification.link,
      createdAt: notification.createdAt,
    });

    // Emit access-request:approved event to both user and project room
    const approvedPayload = {
      id: requestId,
      projectId,
      userId,
      userName: request.user.name,
      userEmail: request.user.email,
      status: 'APPROVED' as const,
    };
    socketService.emitToUser(userId, 'access-request:approved', approvedPayload);
    socketService.emitToProject(projectId, 'access-request:approved', approvedPayload);

    console.log(`✅ Access request approved for ${request.user.email}`);

    return request;
  }

  /**
   * Reject an access request
   */
  async rejectAccessRequest(requestId: string) {
    const request = await this.prisma.accessRequest.update({
      where: { id: requestId },
      data: { status: 'REJECTED' },
      include: {
        user: { select: { email: true, name: true, id: true } },
        project: { select: { title: true, id: true } },
      },
    });

    // Send rejection email
    await this.emailService.sendAccessRejectedEmail({
      to: request.user.email,
      projectTitle: request.project.title,
    });

    // Create notification for the requester
    const notification = await this.prisma.notification.create({
      data: {
        userId: request.user.id,
        type: 'ACCESS_REJECTED',
        title: 'Accès refusé',
        message: `Votre demande d'accès pour "${request.project.title}" a été refusée`,
        link: `/#/workspace/${request.project.id}`,
      },
    });

    // Send real-time notification
    socketService.emitToUser(request.user.id, 'notification:new', {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      link: notification.link,
      createdAt: notification.createdAt,
    });

    // Emit access-request:rejected event to both user and project room
    const rejectedPayload = {
      id: requestId,
      projectId: request.project.id,
      userId: request.user.id,
      userName: request.user.name,
      userEmail: request.user.email,
      status: 'REJECTED' as const,
    };
    socketService.emitToUser(request.user.id, 'access-request:rejected', rejectedPayload);
    socketService.emitToProject(request.project.id, 'access-request:rejected', rejectedPayload);

    console.log(`✅ Access request rejected for ${request.user.email}`);

    return request;
  }
}
