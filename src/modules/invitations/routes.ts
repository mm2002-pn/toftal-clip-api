// Routes for project invitations - Updated 2026-03-05
import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { InvitationService } from '../../services/InvitationService';
import { EmailService } from '../../services/EmailService';
import { PermissionService } from '../../services/PermissionService';
import { socketService } from '../../services/socketService';
import { authenticate } from '../../middlewares/auth';
import { requireProjectOwner, requireProjectAccess } from '../../middlewares/permissions';

const router = Router();
const prisma = new PrismaClient();
const emailService = new EmailService();
const invitationService = new InvitationService(prisma, emailService);
const permissionService = new PermissionService(prisma);

/**
 * POST /api/v1/invitations
 * Create a new project invitation and send email
 */
router.post('/', authenticate, requireProjectOwner(), async (req: Request, res: Response) => {
  try {
    const { projectId, email, message } = req.body;
    const userId = req.user!.id;

    console.log('🔔 POST /invitations called');
    console.log('📧 Email:', email);
    console.log('📁 ProjectId:', projectId);
    console.log('👤 UserId:', userId);

    // Validate input
    if (!projectId || !email) {
      console.error('❌ Missing projectId or email');
      return res.status(400).json({
        error: 'projectId and email are required',
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      console.error('❌ Invalid email format:', email);
      return res.status(400).json({
        error: 'Invalid email format',
      });
    }

    console.log('✅ Validation passed, creating invitation...');

    // Create invitation
    const invitation = await invitationService.createInvitation({
      projectId,
      inviterUserId: userId,
      email,
      message: message || undefined,
      expiryDays: 7,
    });

    console.log('✅ Invitation created successfully:', invitation.id);

    res.status(201).json({
      success: true,
      data: {
        id: invitation.id,
        email: invitation.email,
        status: invitation.status,
        expiresAt: invitation.expiresAt,
        token: invitation.token,
      },
    });
  } catch (error: any) {
    console.error('Invitation creation error:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Failed to create invitation',
    });
  }
});

/**
 * GET /api/v1/invitations/verify/:token
 * Verify an invitation token
 */
router.get('/verify/:token', async (req: Request, res: Response) => {
  try {
    const token = String(req.params.token);

    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'Token is required',
      });
    }

    const invitation = await invitationService.verifyToken(token);

    res.json({
      success: true,
      data: invitation,
    });
  } catch (error: any) {
    console.error('Token verification error:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Invalid or expired invitation',
    });
  }
});

/**
 * POST /api/v1/invitations/accept
 * Accept an invitation (requires authentication)
 */
router.post('/accept', authenticate, async (req: Request, res: Response) => {
  try {
    const { token } = req.body;
    const userId = req.user!.id;

    if (!token) {
      return res.status(400).json({
        error: 'Token is required',
      });
    }

    const result = await invitationService.acceptInvitation(token, userId);

    res.json({
      success: true,
      data: {
        projectId: result.invitation.projectId,
        userId: result.member.userId,
        role: result.member.role,
      },
    });
  } catch (error: any) {
    console.error('Invitation acceptance error:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Failed to accept invitation',
    });
  }
});

/**
 * POST /api/v1/invitations/refuse
 * Refuse an invitation (PUBLIC - no auth required)
 */
router.post('/refuse', async (req: Request, res: Response) => {
  try {
    const { token, reason } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'Token is required',
      });
    }

    console.log('🚫 POST /invitations/refuse called');
    console.log('📧 Token:', token.substring(0, 20) + '...');

    const invitation = await invitationService.refuseInvitation(token, reason);

    res.json({
      success: true,
      data: {
        id: invitation.id,
        status: invitation.status,
        refusedAt: invitation.refusedAt,
        refusalReason: invitation.refusalReason,
      },
    });
  } catch (error: any) {
    console.error('Invitation refusal error:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Failed to refuse invitation',
    });
  }
});

/**
 * POST /api/v1/invitations/accept-after-email-verification
 * Accept an invitation after email verification (PUBLIC - no auth required)
 * Used in the email verification flow where user has no access token yet
 */
router.post('/accept-after-email-verification', async (req: Request, res: Response) => {
  try {
    const { invitationToken, emailToken } = req.body;

    if (!invitationToken || !emailToken) {
      return res.status(400).json({
        success: false,
        error: 'invitationToken and emailToken are required',
      });
    }

    console.log(`🎯 [ACCEPT_AFTER_EMAIL] Accepting invitation after email verification`);
    console.log(`   invitationToken: ${invitationToken.substring(0, 20)}...`);
    console.log(`   emailToken: ${emailToken.substring(0, 20)}...`);

    // Verify the email token to get the userId
    const user = await prisma.user.findFirst({
      where: {
        emailVerificationToken: emailToken,
        emailVerificationExpires: {
          gt: new Date(),
        },
      },
    });

    if (!user) {
      console.error('❌ [ACCEPT_AFTER_EMAIL] Email token invalid or expired');
      return res.status(400).json({
        success: false,
        error: 'Email token is invalid or expired',
      });
    }

    console.log(`✅ [ACCEPT_AFTER_EMAIL] User verified from email token:`, {
      id: user.id,
      email: user.email,
    });

    const result = await invitationService.acceptInvitation(invitationToken, user.id);

    console.log(`✅ [ACCEPT_AFTER_EMAIL] Invitation accepted successfully`);

    res.json({
      success: true,
      data: {
        projectId: result.invitation.projectId,
        userId: result.member.userId,
        role: result.member.role,
      },
    });
  } catch (error: any) {
    console.error('Invitation acceptance after email error:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Failed to accept invitation',
    });
  }
});

/**
 * GET /api/v1/invitations/project/:projectId
 * Get all invitations for a project
 */
router.get(
  '/project/:projectId',
  authenticate,
  requireProjectOwner(),
  async (req: Request, res: Response) => {
    try {
      const projectId = String(req.params.projectId);

      const invitations = await invitationService.getProjectInvitations(projectId);

      res.json({
        success: true,
        data: invitations,
      });
    } catch (error: any) {
      console.error('Get invitations error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch invitations',
      });
    }
  }
);

/**
 * DELETE /api/v1/invitations/:invitationId
 * Cancel an invitation
 */
router.delete(
  '/:invitationId',
  authenticate,
  async (req: Request, res: Response) => {
    try {
      const invitationId = String(req.params.invitationId);
      const userId = req.user!.id;

      const invitation = await invitationService.cancelInvitation(invitationId, userId);

      res.json({
        success: true,
        data: invitation,
      });
    } catch (error: any) {
      console.error('Cancel invitation error:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to cancel invitation',
      });
    }
  }
);

/**
 * GET /api/v1/invitations/project/:projectId/members
 * Get all members of a project
 */
router.get(
  '/project/:projectId/members',
  authenticate,
  requireProjectAccess('view'),
  async (req: Request, res: Response) => {
    try {
      const projectId = String(req.params.projectId);

      const members = await permissionService.getProjectMembers(projectId);

      res.json({
        success: true,
        data: members,
      });
    } catch (error: any) {
      console.error('Get members error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch project members',
      });
    }
  }
);

/**
 * PATCH /api/v1/invitations/project/:projectId/members/:memberId
 * Update a member's role in a project
 */
router.patch(
  '/project/:projectId/members/:memberId',
  authenticate,
  requireProjectOwner(),
  async (req: Request, res: Response) => {
    try {
      const projectId = String(req.params.projectId);
      const memberId = String(req.params.memberId);
      const { role } = req.body;
      const updatedBy = req.user!.id;

      console.log('🔄 PATCH /project/:projectId/members/:memberId - Updating member role');
      console.log('📁 ProjectId:', projectId);
      console.log('👤 MemberId:', memberId);
      console.log('🎭 New Role:', role);

      // Validate role
      const validRoles = ['VIEWER', 'COLLABORATOR', 'OWNER'];
      if (!role || !validRoles.includes(role)) {
        return res.status(400).json({
          success: false,
          error: `Invalid role. Must be one of: ${validRoles.join(', ')}`,
        });
      }

      // Cannot change owner's role
      const currentMember = await prisma.projectMember.findUnique({
        where: {
          projectId_userId: {
            projectId,
            userId: memberId,
          },
        },
      });

      if (!currentMember) {
        return res.status(404).json({
          success: false,
          error: 'Member not found in project',
        });
      }

      if (currentMember.role === 'OWNER') {
        return res.status(403).json({
          success: false,
          error: 'Cannot change the role of the project owner',
        });
      }

      // Update the member's role
      const updatedMember = await prisma.projectMember.update({
        where: {
          projectId_userId: {
            projectId,
            userId: memberId,
          },
        },
        data: {
          role,
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

      // Get project details and updater name for email
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { title: true },
      });

      const updater = await prisma.user.findUnique({
        where: { id: updatedBy },
        select: { name: true },
      });

      // Send email notification
      if (project && updater) {
        await emailService.sendMemberRoleUpdatedEmail({
          to: updatedMember.user.email,
          memberName: updatedMember.user.name,
          projectTitle: project.title,
          projectId,
          oldRole: currentMember.role,
          newRole: role,
          updatedBy: updater.name,
        });
        console.log(`📧 Role update email sent to ${updatedMember.user.email}`);
      }

      // Emit real-time notification
      const roleUpdatePayload = {
        projectId,
        userId: memberId,
        userName: updatedMember.user.name,
        newRole: role,
        oldRole: currentMember.role,
        updatedBy,
      };

      socketService.emitToUser(memberId, 'project:member:role-updated', roleUpdatePayload);
      socketService.emitToProject(projectId, 'project:member:role-updated', roleUpdatePayload);
      console.log(`📡 Emitted project:member:role-updated event for user ${memberId}`);

      res.json({
        success: true,
        message: 'Member role updated successfully',
        data: {
          id: updatedMember.id,
          userId: updatedMember.userId,
          role: updatedMember.role,
          user: updatedMember.user,
        },
      });
    } catch (error: any) {
      console.error('Update member role error:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to update member role',
      });
    }
  }
);

/**
 * DELETE /api/v1/invitations/project/:projectId/members/:memberId
 * Remove a member from a project
 */
router.delete(
  '/project/:projectId/members/:memberId',
  authenticate,
  requireProjectOwner(),
  async (req: Request, res: Response) => {
    try {
      const projectId = String(req.params.projectId);
      const memberId = String(req.params.memberId);
      const removedBy = req.user!.id;

      // Get member info before deleting for socket notification
      const memberInfo = await prisma.projectMember.findUnique({
        where: {
          projectId_userId: {
            projectId,
            userId: memberId,
          },
        },
        include: {
          user: {
            select: { id: true, name: true, email: true },
          },
        },
      });

      await permissionService.removeMember(projectId, memberId);

      // Emit real-time notification
      if (memberInfo) {
        const memberRemovedPayload = {
          projectId,
          userId: memberId,
          userName: memberInfo.user.name,
          removedBy,
        };
        // Notify the removed user
        socketService.emitToUser(memberId, 'project:member:removed', memberRemovedPayload);
        // Notify other project members
        socketService.emitToProject(projectId, 'project:member:removed', memberRemovedPayload);
        console.log(`📡 Emitted project:member:removed event for user ${memberId}`);
      }

      res.json({
        success: true,
        message: 'Member removed from project',
      });
    } catch (error: any) {
      console.error('Remove member error:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to remove member',
      });
    }
  }
);

export default router;
