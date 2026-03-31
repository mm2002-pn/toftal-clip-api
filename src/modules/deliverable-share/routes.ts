import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate } from '../../middlewares/auth';
import crypto from 'crypto';

const router = Router();
const prisma = new PrismaClient();

/**
 * POST /api/v1/deliverable-share
 * Create a new public share link for a deliverable (video)
 * Requires: deliverableId, permission (view|comment|download)
 * Optional: expiresIn (days), maxUses (number)
 */
router.post('/', authenticate, async (req: Request, res: Response) => {
  try {
    const { deliverableId, permission = 'view', expiresIn = 7, maxUses = null } = req.body;
    const userId = req.user!.id;

    console.log('🎬 POST /deliverable-share called');
    console.log('📁 DeliverableId:', deliverableId);
    console.log('🔐 Permission:', permission);

    // Validate input
    if (!deliverableId) {
      return res.status(400).json({ error: 'deliverableId is required' });
    }

    if (!['view', 'comment', 'download'].includes(permission)) {
      return res.status(400).json({
        error: "Permission must be one of: 'view', 'comment', 'download'",
      });
    }

    // Verify deliverable exists and get project info
    const deliverable = await prisma.deliverable.findUnique({
      where: { id: deliverableId },
      include: {
        project: {
          include: {
            members: {
              where: { userId },
            },
          },
        },
      },
    });

    if (!deliverable) {
      return res.status(404).json({ error: 'Deliverable not found' });
    }

    // Check if user has access to the project (owner, talent, or member)
    const project = deliverable.project;
    const isOwner = project.ownerId === userId || project.clientId === userId;
    const isTalent = project.talentId === userId || deliverable.assignedTalentId === userId;
    const isMember = project.members.length > 0;

    if (!isOwner && !isTalent && !isMember) {
      return res.status(403).json({ error: 'You do not have access to this deliverable' });
    }

    // Generate secure token
    const token = crypto.randomBytes(32).toString('hex');

    // Calculate expiry date
    const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 24 * 60 * 60 * 1000) : null;

    // Create deliverable share link
    const shareLink = await prisma.deliverableShareLink.create({
      data: {
        deliverableId,
        creatorUserId: userId,
        token,
        permission,
        expiresAt,
        maxUses: maxUses || null,
        isActive: true,
        usedCount: 0,
      },
    });

    console.log('✅ Deliverable share link created:', shareLink.id);

    res.status(201).json({
      success: true,
      data: {
        id: shareLink.id,
        token: shareLink.token,
        permission: shareLink.permission,
        expiresAt: shareLink.expiresAt,
        url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/#/share/video/${token}`,
      },
    });
  } catch (error: any) {
    console.error('Deliverable share creation error:', error);
    res.status(500).json({
      error: error.message || 'Failed to create deliverable share link',
    });
  }
});

/**
 * GET /api/v1/deliverable-share/verify/:token
 * Verify a deliverable share token (PUBLIC - no auth required)
 */
router.get('/verify/:token', async (req: Request, res: Response) => {
  try {
    const token = String(req.params.token);

    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }

    console.log('🔍 Verifying deliverable share token:', token.substring(0, 10) + '...');

    const shareLink = await prisma.deliverableShareLink.findUnique({
      where: { token },
      include: {
        deliverable: {
          select: {
            id: true,
            title: true,
            type: true,
          },
        },
      },
    });

    if (!shareLink) {
      console.warn('❌ Token not found:', token.substring(0, 10) + '...');
      return res.status(404).json({ error: 'Invalid or expired token' });
    }

    // Check if link is active
    if (!shareLink.isActive) {
      console.warn('❌ Link is disabled');
      return res.status(403).json({ error: 'This share link has been disabled' });
    }

    // Check expiration
    if (shareLink.expiresAt && shareLink.expiresAt < new Date()) {
      console.warn('❌ Link expired');
      return res.status(403).json({ error: 'This share link has expired' });
    }

    // Check usage limit
    if (shareLink.maxUses && shareLink.usedCount >= shareLink.maxUses) {
      console.warn('❌ Max uses exceeded');
      return res.status(403).json({ error: 'This share link has reached its usage limit' });
    }

    console.log('✅ Token verified successfully');

    res.json({
      success: true,
      data: {
        id: shareLink.id,
        deliverableId: shareLink.deliverableId,
        deliverable: shareLink.deliverable,
        permission: shareLink.permission,
        expiresAt: shareLink.expiresAt,
        isActive: shareLink.isActive,
        maxUses: shareLink.maxUses,
        usedCount: shareLink.usedCount,
      },
    });
  } catch (error: any) {
    console.error('Token verification error:', error);
    res.status(500).json({
      error: error.message || 'Failed to verify token',
    });
  }
});

/**
 * GET /api/v1/deliverable-share/:token
 * Get deliverable data via share link (PUBLIC - no auth required)
 */
router.get('/:token', async (req: Request, res: Response) => {
  try {
    const token = String(req.params.token);

    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }

    console.log('🎬 GET /deliverable-share/:token - Fetching deliverable data');

    const shareLink = await prisma.deliverableShareLink.findUnique({
      where: { token },
      include: {
        deliverable: {
          include: {
            project: {
              select: {
                id: true,
                title: true,
              },
            },
            versions: {
              orderBy: { versionNumber: 'desc' },
              include: {
                uploadedBy: {
                  select: {
                    id: true,
                    name: true,
                    avatarUrl: true,
                  },
                },
                feedbacks: {
                  include: {
                    author: {
                      select: {
                        id: true,
                        name: true,
                        avatarUrl: true,
                      },
                    },
                    revisionTasks: true,
                  },
                },
              },
            },
            workflowPhases: {
              orderBy: { orderIndex: 'asc' },
              include: {
                tasks: {
                  orderBy: { orderIndex: 'asc' },
                },
              },
            },
            assignedTalent: {
              select: {
                id: true,
                name: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
    });

    if (!shareLink) {
      return res.status(404).json({ error: 'Invalid or expired token' });
    }

    // Check if link is active
    if (!shareLink.isActive) {
      return res.status(403).json({ error: 'This share link has been disabled' });
    }

    // Check expiration
    if (shareLink.expiresAt && shareLink.expiresAt < new Date()) {
      return res.status(403).json({ error: 'This share link has expired' });
    }

    // Check usage limit
    if (shareLink.maxUses && shareLink.usedCount >= shareLink.maxUses) {
      return res.status(403).json({ error: 'This share link has reached its usage limit' });
    }

    // Increment usage count
    await prisma.deliverableShareLink.update({
      where: { id: shareLink.id },
      data: { usedCount: shareLink.usedCount + 1 },
    });

    console.log('✅ Deliverable data retrieved:', shareLink.deliverable.id);

    res.json({
      success: true,
      data: {
        shareLink: {
          id: shareLink.id,
          permission: shareLink.permission,
          expiresAt: shareLink.expiresAt,
        },
        deliverable: shareLink.deliverable,
      },
    });
  } catch (error: any) {
    console.error('Get shared deliverable error:', error);
    res.status(500).json({
      error: error.message || 'Failed to fetch deliverable data',
    });
  }
});

/**
 * DELETE /api/v1/deliverable-share/:id
 * Disable a deliverable share link (requires authentication)
 */
router.delete('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const linkId = String(req.params.id);
    const userId = req.user!.id;

    if (!linkId) {
      return res.status(400).json({ error: 'Link ID is required' });
    }

    console.log('🗑️ DELETE /deliverable-share/:id - Disabling link:', linkId);

    // Get the link and verify ownership
    const link = await prisma.deliverableShareLink.findUnique({
      where: { id: linkId },
    });

    if (!link) {
      return res.status(404).json({ error: 'Deliverable share link not found' });
    }

    // Verify user is the creator
    if (link.creatorUserId !== userId) {
      return res.status(403).json({ error: 'You do not have permission to disable this link' });
    }

    // Disable the link (soft delete)
    const updatedLink = await prisma.deliverableShareLink.update({
      where: { id: linkId },
      data: { isActive: false },
    });

    console.log('✅ Deliverable share link disabled');

    res.json({
      success: true,
      message: 'Deliverable share link has been disabled',
      data: { id: updatedLink.id },
    });
  } catch (error: any) {
    console.error('Disable link error:', error);
    res.status(500).json({
      error: error.message || 'Failed to disable link',
    });
  }
});

/**
 * GET /api/v1/deliverable-share/deliverable/:deliverableId
 * Get all share links for a deliverable (requires authentication)
 */
router.get(
  '/deliverable/:deliverableId',
  authenticate,
  async (req: Request, res: Response) => {
    try {
      const deliverableId = String(req.params.deliverableId);
      const userId = req.user!.id;

      console.log('📋 GET /deliverable-share/deliverable/:deliverableId - Listing links');

      // Get deliverable and verify user has access
      const deliverable = await prisma.deliverable.findUnique({
        where: { id: deliverableId },
        include: {
          project: {
            include: {
              members: {
                where: { userId },
              },
            },
          },
        },
      });

      if (!deliverable) {
        return res.status(404).json({ error: 'Deliverable not found' });
      }

      // Check if user has access
      const project = deliverable.project;
      const isOwner = project.ownerId === userId || project.clientId === userId;
      const isTalent = project.talentId === userId || deliverable.assignedTalentId === userId;
      const isMember = project.members.length > 0;

      if (!isOwner && !isTalent && !isMember) {
        return res.status(403).json({ error: 'You do not have access to this deliverable' });
      }

      // Get all ACTIVE links for the deliverable
      const links = await prisma.deliverableShareLink.findMany({
        where: {
          deliverableId,
          isActive: true,
        },
        select: {
          id: true,
          token: true,
          permission: true,
          expiresAt: true,
          isActive: true,
          maxUses: true,
          usedCount: true,
          createdAt: true,
          creatorUserId: true,
        },
      });

      console.log('✅ Found', links.length, 'deliverable share links');

      res.json({
        success: true,
        data: links.map((link) => ({
          ...link,
          url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/#/share/video/${link.token}`,
        })),
      });
    } catch (error: any) {
      console.error('Get links error:', error);
      res.status(500).json({
        error: error.message || 'Failed to fetch deliverable share links',
      });
    }
  }
);

/**
 * POST /api/v1/deliverable-share/:token/feedback
 * Add feedback/comment via share link (PUBLIC - no auth required for guests)
 * Supports both authenticated users and guest commenters
 */
router.post('/:token/feedback', async (req: Request, res: Response) => {
  try {
    const token = String(req.params.token);
    const { versionId, rawText, structuredText, type, guestName, guestEmail, replyingToId } = req.body;

    console.log('💬 POST /deliverable-share/:token/feedback - Adding feedback');
    console.log('🔑 Token:', token.substring(0, 10) + '...');
    console.log('👤 Guest:', guestName, guestEmail);

    // Validate input
    if (!token || !versionId || !rawText) {
      return res.status(400).json({ error: 'token, versionId, and rawText are required' });
    }

    // Verify share link exists and has comment permission
    const shareLink = await prisma.deliverableShareLink.findUnique({
      where: { token },
      include: {
        deliverable: {
          include: {
            project: { select: { id: true, title: true } },
            assignedTalent: { select: { id: true } },
          },
        },
      },
    });

    if (!shareLink) {
      return res.status(404).json({ error: 'Invalid share link' });
    }

    // Check if link is active
    if (!shareLink.isActive) {
      return res.status(403).json({ error: 'This share link has been disabled' });
    }

    // Check expiration
    if (shareLink.expiresAt && shareLink.expiresAt < new Date()) {
      return res.status(403).json({ error: 'This share link has expired' });
    }

    // Check permission - must be 'comment' or 'download' to comment
    if (shareLink.permission === 'view') {
      return res.status(403).json({ error: 'This share link does not allow commenting' });
    }

    // Verify version belongs to the deliverable
    const version = await prisma.version.findFirst({
      where: {
        id: versionId,
        deliverableId: shareLink.deliverableId,
      },
    });

    if (!version) {
      return res.status(404).json({ error: 'Version not found or does not belong to this deliverable' });
    }

    // Check if user is authenticated (from Authorization header)
    const authHeader = req.headers.authorization;
    let userId: string | null = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      // Try to get user from token (optional)
      try {
        const user = (req as any).user;
        if (user && user.id) {
          userId = user.id;
        }
      } catch (error) {
        console.log('No authenticated user, treating as guest');
      }
    }

    // Validate guest info if not authenticated
    if (!userId && (!guestName || !guestEmail)) {
      return res.status(400).json({
        error: 'guestName and guestEmail are required for non-authenticated users'
      });
    }

    // Create feedback - either with userId OR with guest info
    const feedback = await prisma.feedback.create({
      data: {
        versionId,
        authorId: userId || undefined, // null if guest
        guestName: !userId ? guestName : undefined,
        guestEmail: !userId ? guestEmail : undefined,
        rawText,
        structuredText: structuredText || rawText,
        type: type || 'TEXT',
        replyingToId: replyingToId || undefined,
      },
      include: {
        author: userId ? {
          select: { id: true, name: true, avatarUrl: true }
        } : undefined,
        replyingTo: {
          select: {
            id: true,
            rawText: true,
            structuredText: true,
            author: { select: { id: true, name: true } },
            guestName: true,
          }
        }
      },
    });

    console.log('✅ Feedback created:', feedback.id, userId ? '(authenticated)' : '(guest)');

    // Return feedback with proper author info
    const feedbackResponse = {
      ...feedback,
      author: feedback.author || {
        id: null,
        name: guestName,
        avatarUrl: null,
      }
    };

    res.status(201).json({
      success: true,
      data: feedbackResponse,
      message: 'Feedback added successfully',
    });
  } catch (error: any) {
    console.error('Add feedback via share link error:', error);
    res.status(500).json({
      error: error.message || 'Failed to add feedback',
    });
  }
});

export default router;
