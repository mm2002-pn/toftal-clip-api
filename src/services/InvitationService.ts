import { PrismaClient, ProjectRole, InvitationStatus } from '@prisma/client';
import crypto from 'crypto';
import { EmailService } from './EmailService';
import { PermissionService } from './PermissionService';

interface CreateInvitationData {
  projectId: string;
  inviterUserId: string;
  email: string;
  message?: string;
  expiryDays?: number;
}

export class InvitationService {
  private permissionService: PermissionService;

  constructor(
    private prisma: PrismaClient,
    private emailService: EmailService
  ) {
    this.permissionService = new PermissionService(prisma);
  }

  /**
   * Generate a unique, secure token for invitation
   */
  generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Create an invitation and send email
   */
  async createInvitation(data: CreateInvitationData) {
    const { projectId, inviterUserId, email, message, expiryDays = 7 } = data;

    // Verify project exists
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        owner: {
          select: { name: true, email: true },
        },
      },
    });

    if (!project) {
      throw new Error('Project not found');
    }

    // Verify inviter is project owner
    if (project.ownerId !== inviterUserId) {
      throw new Error('Only project owner can send invitations');
    }

    // Check if user with this email is already a member
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      const existingMember = await this.prisma.projectMember.findUnique({
        where: {
          projectId_userId: {
            projectId,
            userId: existingUser.id,
          },
        },
      });

      if (existingMember) {
        throw new Error('User is already a member of this project');
      }
    }

    // Check if invitation already exists
    const existingInvitation = await this.prisma.projectInvitation.findFirst({
      where: {
        projectId,
        email,
        status: InvitationStatus.PENDING,
      },
    });

    // If invitation exists, revoke old one and create new
    if (existingInvitation) {
      await this.prisma.projectInvitation.update({
        where: { id: existingInvitation.id },
        data: { status: InvitationStatus.EXPIRED },
      });
    }

    // Generate token
    const token = this.generateToken();
    const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);

    // Create invitation record
    const invitation = await this.prisma.projectInvitation.create({
      data: {
        projectId,
        inviterUserId,
        email,
        token,
        message: message || null,
        expiresAt,
      },
      include: {
        project: {
          select: { id: true, title: true },
        },
        inviter: {
          select: { name: true, email: true },
        },
      },
    });

    // Send email
    await this.emailService.sendInvitationEmail({
      to: email,
      projectTitle: project.title,
      inviterName: invitation.inviter.name,
      invitationToken: token,
      message,
    });

    return invitation;
  }

  /**
   * Verify invitation token
   */
  async verifyToken(token: string) {
    const invitation = await this.prisma.projectInvitation.findUnique({
      where: { token },
      include: {
        project: {
          select: { id: true, title: true, type: true },
        },
        inviter: {
          select: { name: true },
        },
      },
    });

    if (!invitation) {
      throw new Error('Invalid invitation token');
    }

    if (invitation.status !== InvitationStatus.PENDING) {
      throw new Error(`Invitation has already been ${invitation.status.toLowerCase()}`);
    }

    if (new Date() > invitation.expiresAt) {
      await this.prisma.projectInvitation.update({
        where: { id: invitation.id },
        data: { status: InvitationStatus.EXPIRED },
      });
      throw new Error('Invitation has expired');
    }

    return {
      id: invitation.id,
      email: invitation.email,
      projectId: invitation.projectId,
      projectTitle: invitation.project.title,
      projectType: invitation.project.type,
      inviterName: invitation.inviter.name,
      expiresAt: invitation.expiresAt,
    };
  }

  /**
   * Accept an invitation
   * This is called after user is authenticated
   */
  async acceptInvitation(token: string, userId: string) {
    console.log(`\n🎯 [ACCEPT_INVITATION] Started`);
    console.log(`   Token: ${token.substring(0, 20)}...`);
    console.log(`   UserId: ${userId}`);

    const invitation = await this.prisma.projectInvitation.findUnique({
      where: { token },
    });

    console.log(`📋 [ACCEPT_INVITATION] Found invitation:`, {
      id: invitation?.id,
      email: invitation?.email,
      projectId: invitation?.projectId,
      status: invitation?.status,
    });

    if (!invitation) {
      console.error(`❌ [ACCEPT_INVITATION] Invitation not found`);
      throw new Error('Invalid invitation token');
    }

    // If invitation is already accepted, check if user is already a member and return success
    if (invitation.status === InvitationStatus.ACCEPTED) {
      console.log(`⚠️ [ACCEPT_INVITATION] Invitation already accepted, checking membership...`);
      const existingMember = await this.prisma.projectMember.findUnique({
        where: {
          projectId_userId: {
            projectId: invitation.projectId,
            userId: userId,
          },
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              avatarUrl: true,
            },
          },
        },
      });

      if (existingMember) {
        console.log(`✅ [ACCEPT_INVITATION] User already a member, returning existing data`);
        return { invitation, member: existingMember };
      }
    }

    if (invitation.status !== InvitationStatus.PENDING && invitation.status !== InvitationStatus.ACCEPTED) {
      console.error(`❌ [ACCEPT_INVITATION] Invitation already ${invitation.status}`);
      throw new Error(`Invitation has already been ${invitation.status.toLowerCase()}`);
    }

    if (new Date() > invitation.expiresAt) {
      console.error(`❌ [ACCEPT_INVITATION] Invitation expired`);
      throw new Error('Invitation has expired');
    }

    // Verify email matches
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    console.log(`👤 [ACCEPT_INVITATION] User found:`, {
      id: user?.id,
      email: user?.email,
      role: user?.role,
    });

    if (!user || user.email !== invitation.email) {
      console.error(`❌ [ACCEPT_INVITATION] Email mismatch. Expected: ${invitation.email}, Got: ${user?.email}`);
      throw new Error('Invitation email does not match your account');
    }

    // Determine permissions based on user role
    const isTalent = user.role === 'TALENT';
    const permissions = isTalent
      ? {
          // Talent: Full access
          view: true,
          edit: true,
          comment: true,
          approve: true,
        }
      : {
          // Client: Read-only
          view: true,
          edit: false,
          comment: false,
          approve: false,
        };

    console.log(`✅ [ACCEPT_INVITATION] Permissions assigned:`, permissions);

    // Transaction: update invitation and add project member
    return await this.prisma.$transaction(async (tx) => {
      console.log(`💾 [ACCEPT_INVITATION] Starting transaction...`);

      // Mark invitation as accepted
      const updatedInvitation = await tx.projectInvitation.update({
        where: { id: invitation.id },
        data: {
          status: InvitationStatus.ACCEPTED,
          acceptedAt: new Date(),
        },
      });

      console.log(`✅ [ACCEPT_INVITATION] Invitation marked as ACCEPTED:`, {
        id: updatedInvitation.id,
        status: updatedInvitation.status,
      });

      // Add user as project member (use upsert to handle race conditions)
      console.log(`📝 [ACCEPT_INVITATION] Creating/Updating ProjectMember:`, {
        projectId: invitation.projectId,
        userId: userId,
        role: ProjectRole.COLLABORATOR,
      });

      const projectMember = await tx.projectMember.upsert({
        where: {
          projectId_userId: {
            projectId: invitation.projectId,
            userId: userId,
          },
        },
        create: {
          projectId: invitation.projectId,
          userId,
          role: ProjectRole.COLLABORATOR,
          permissions,
        },
        update: {
          // If already exists, just update permissions (in case they changed)
          permissions,
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              avatarUrl: true,
            },
          },
        },
      });

      console.log(`✅ [ACCEPT_INVITATION] ProjectMember created/updated successfully:`, {
        id: projectMember.id,
        projectId: projectMember.projectId,
        userId: projectMember.userId,
        role: projectMember.role,
      });

      return { invitation: updatedInvitation, member: projectMember };
    });
  }

  /**
   * Expire old invitations (cron job)
   */
  async expireOldInvitations() {
    const result = await this.prisma.projectInvitation.updateMany({
      where: {
        status: InvitationStatus.PENDING,
        expiresAt: {
          lt: new Date(),
        },
      },
      data: {
        status: InvitationStatus.EXPIRED,
      },
    });

    return result.count;
  }

  /**
   * Get pending invitations for a project
   */
  async getProjectInvitations(projectId: string) {
    return this.prisma.projectInvitation.findMany({
      where: { projectId },
      include: {
        inviter: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Cancel an invitation
   */
  async cancelInvitation(invitationId: string, userId: string) {
    const invitation = await this.prisma.projectInvitation.findUnique({
      where: { id: invitationId },
    });

    if (!invitation) {
      throw new Error('Invitation not found');
    }

    // Verify user is the inviter or project owner
    const project = await this.prisma.project.findUnique({
      where: { id: invitation.projectId },
    });

    if (!project || (project.ownerId !== userId && invitation.inviterUserId !== userId)) {
      throw new Error('Unauthorized to cancel this invitation');
    }

    return this.prisma.projectInvitation.update({
      where: { id: invitationId },
      data: { status: InvitationStatus.REJECTED },
    });
  }

  /**
   * Refuse an invitation with optional reason
   */
  async refuseInvitation(token: string, reason?: string) {
    console.log('🚫 [REFUSE_INVITATION] Refusing invitation');
    console.log('   Token:', token.substring(0, 20) + '...');

    const invitation = await this.prisma.projectInvitation.findUnique({
      where: { token },
    });

    if (!invitation) {
      throw new Error('Invitation non trouvée');
    }

    if (invitation.status === InvitationStatus.REJECTED) {
      throw new Error('Cette invitation a déjà été refusée');
    }

    if (invitation.status === InvitationStatus.ACCEPTED) {
      throw new Error('Cette invitation a déjà été acceptée');
    }

    if (new Date() > invitation.expiresAt) {
      await this.prisma.projectInvitation.update({
        where: { id: invitation.id },
        data: { status: InvitationStatus.EXPIRED },
      });
      throw new Error('Cette invitation a expiré');
    }

    const updatedInvitation = await this.prisma.projectInvitation.update({
      where: { id: invitation.id },
      data: {
        status: InvitationStatus.REJECTED,
        refusedAt: new Date(),
        refusalReason: reason || null,
      },
    });

    // Also update the project to mark that invitation was refused
    await this.prisma.project.update({
      where: { id: invitation.projectId },
      data: { invitationRefusedAt: new Date() },
    });

    console.log('✅ [REFUSE_INVITATION] Invitation refused successfully');

    return updatedInvitation;
  }
}
