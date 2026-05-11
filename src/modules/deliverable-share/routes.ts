import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate } from '../../middlewares/auth';
import { uploadAny } from '../../middlewares/upload';
import { uploadDocumentToGCS, uploadImageToGCS, uploadAudioToGCS } from '../../config/gcs';
import { socketService } from '../../services/socketService';
import { cacheService, CACHE_KEYS, CACHE_TTL } from '../../services/cacheService';
import { EmailService } from '../../services/EmailService';
import { PermissionService } from '../../services/PermissionService';
import { shareDownscaleLimiter } from '../../middlewares/rateLimiter';
import {
  enqueueDownscale,
  getDownscaleStatus,
  SUPPORTED_QUALITIES,
} from '../../services/downscaleJobsService';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';

/**
 * Transcode audio to MP4/AAC format for cross-browser compatibility
 * WebM/Opus is not supported on iOS Safari
 */
const transcodeToMp4 = (inputPath: string, outputPath: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    console.log('[Audio Transcode] Starting:', { inputPath, outputPath });

    ffmpeg(inputPath)
      .audioCodec('aac')
      .audioBitrate('128k')
      .audioChannels(2)
      .audioFrequency(44100)
      .format('mp4')
      .on('start', (cmd) => {
        console.log('[Audio Transcode] Command:', cmd);
      })
      .on('end', () => {
        console.log('[Audio Transcode] Completed successfully');
        resolve();
      })
      .on('error', (err) => {
        console.error('[Audio Transcode] Error:', err.message);
        reject(err);
      })
      .save(outputPath);
  });
};

const emailService = new EmailService();

const router = Router();
const prisma = new PrismaClient();
const permissionService = new PermissionService(prisma);

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

    // Check if user has edit permission to share the deliverable
    const project = deliverable.project;
    const isOwner = project.ownerId === userId || project.clientId === userId;
    const isTalent = project.talentId === userId || deliverable.assignedTalentId === userId;

    // Get user's permissions via PermissionService
    const userPermission = await permissionService.canAccessProject(project.id, userId);
    const hasEditPermission = userPermission.permissions?.edit === true;

    // Can share if: owner, talent, OR collaborator with edit permission
    const canShare = isOwner || isTalent || hasEditPermission;

    if (!canShare) {
      return res.status(403).json({ error: 'You do not have permission to share this deliverable. Edit permission is required.' });
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
 * POST /api/v1/deliverable-share/invite
 * Send an email invitation to share a deliverable (video)
 * Requires: deliverableId, email, permission
 * Optional: message
 */
router.post('/invite', authenticate, async (req: Request, res: Response) => {
  try {
    const { deliverableId, email, permission = 'view', message } = req.body;
    const userId = req.user!.id;

    console.log('📧 POST /deliverable-share/invite called');
    console.log('📁 DeliverableId:', deliverableId);
    console.log('📬 Email:', email);
    console.log('🔐 Permission:', permission);

    // Validate input
    if (!deliverableId) {
      return res.status(400).json({ error: 'deliverableId is required' });
    }

    if (!email) {
      return res.status(400).json({ error: 'email is required' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
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

    // Check if user has edit permission to share/invite for the deliverable
    const project = deliverable.project;
    const isOwner = project.ownerId === userId || project.clientId === userId;
    const isTalent = project.talentId === userId || deliverable.assignedTalentId === userId;

    // Get user's permissions via PermissionService
    const userPermission = await permissionService.canAccessProject(project.id, userId);
    const hasEditPermission = userPermission.permissions?.edit === true;

    // Can share if: owner, talent, OR collaborator with edit permission
    const canShare = isOwner || isTalent || hasEditPermission;

    if (!canShare) {
      return res.status(403).json({ error: 'You do not have permission to share this deliverable. Edit permission is required.' });
    }

    // Get current user's name for the invitation email
    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true },
    });

    const inviterName = currentUser?.name || currentUser?.email || 'Un utilisateur';

    // Generate secure token
    const token = crypto.randomBytes(32).toString('hex');

    // Calculate expiry date (7 days)
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // Create deliverable share link
    const shareLink = await prisma.deliverableShareLink.create({
      data: {
        deliverableId,
        creatorUserId: userId,
        token,
        permission,
        expiresAt,
        isActive: true,
        usedCount: 0,
      },
    });

    // Generate share URL
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const shareUrl = `${frontendUrl}/#/share/video/${token}`;

    // Send email invitation
    try {
      await emailService.sendVideoShareInvitationEmail({
        to: email,
        inviterName,
        videoTitle: deliverable.title,
        shareUrl,
        permission,
        message,
      });
      console.log('✅ Video share invitation email sent to:', email);
    } catch (emailError) {
      console.error('❌ Failed to send video share invitation email:', emailError);
      // Don't fail the request if email fails, link is still created
    }

    res.status(201).json({
      success: true,
      data: {
        token: shareLink.token,
        shareUrl,
        permission: shareLink.permission,
        expiresAt: shareLink.expiresAt,
      },
      message: `Invitation envoyée à ${email}`,
    });
  } catch (error: any) {
    console.error('Deliverable share invite error:', error);
    res.status(500).json({
      error: error.message || 'Failed to send invitation',
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

    const cacheKey = `${CACHE_KEYS.SHARE_LINK}verify:${token}`;

    // Try to get from cache
    const cached = await cacheService.get<any>(cacheKey);
    if (cached) {
      // Even with cache, validate expiration and usage
      if (cached.expiresAt && new Date(cached.expiresAt) < new Date()) {
        return res.status(403).json({ error: 'This share link has expired' });
      }
      return res.json({ success: true, data: cached });
    }

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

    const responseData = {
      id: shareLink.id,
      deliverableId: shareLink.deliverableId,
      deliverable: shareLink.deliverable,
      permission: shareLink.permission,
      expiresAt: shareLink.expiresAt,
      isActive: shareLink.isActive,
      maxUses: shareLink.maxUses,
      usedCount: shareLink.usedCount,
    };

    // Cache for 1 minute
    await cacheService.set(cacheKey, responseData, CACHE_TTL.SHORT);

    res.json({
      success: true,
      data: responseData,
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

    const cacheKey = `${CACHE_KEYS.SHARE_LINK}data:${token}`;

    // Try to get deliverable data from cache
    const cached = await cacheService.get<any>(cacheKey);
    if (cached) {
      // Still need to validate the share link status
      const shareLink = await prisma.deliverableShareLink.findUnique({
        where: { token },
        select: { isActive: true, expiresAt: true, maxUses: true, usedCount: true, id: true },
      });

      if (!shareLink || !shareLink.isActive) {
        await cacheService.delete(cacheKey);
        return res.status(403).json({ error: 'This share link has been disabled' });
      }
      if (shareLink.expiresAt && shareLink.expiresAt < new Date()) {
        return res.status(403).json({ error: 'This share link has expired' });
      }
      if (shareLink.maxUses && shareLink.usedCount >= shareLink.maxUses) {
        return res.status(403).json({ error: 'This share link has reached its usage limit' });
      }

      // Increment usage count (async, don't wait)
      prisma.deliverableShareLink.update({
        where: { id: shareLink.id },
        data: { usedCount: { increment: 1 } },
      }).catch(() => {});

      return res.json({ success: true, data: cached });
    }

    const shareLink = await prisma.deliverableShareLink.findUnique({
      where: { token },
      include: {
        deliverable: {
          include: {
            project: {
              select: {
                id: true,
                title: true,
                // ownerId surfaced so the guest can include the
                // project owner in their read-receipt recipient set
                // — without it, the guest never sees their own
                // double-check go blue (recipientIds=[] → status
                // stays 'sent' forever).
                ownerId: true,
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
                    reactions: {
                      select: {
                        id: true,
                        userId: true,
                        guestEmail: true,
                        guestName: true,
                        emoji: true,
                        createdAt: true,
                      },
                      orderBy: { createdAt: 'asc' },
                    },
                    // WhatsApp-style read receipts. Include reads so the
                    // sender (auth or guest) sees the double-check go
                    // blue when recipients open their share link.
                    reads: {
                      select: {
                        userId: true,
                        guestEmail: true,
                        readAt: true,
                      },
                    },
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

    const responseData = {
      shareLink: {
        id: shareLink.id,
        permission: shareLink.permission,
        expiresAt: shareLink.expiresAt,
      },
      // The guest UI derives the WhatsApp-style recipient set from
      // (project.ownerId + every userId/guestEmail already present in
      // feedbacks[].reads). Computing it client-side keeps it
      // self-correcting when the cached payload drifts after a socket
      // event — no need to ship a separate recipientUserIds field
      // that would go stale.
      deliverable: shareLink.deliverable,
    };

    // Cache deliverable data for 1 minute (feedbacks change frequently)
    await cacheService.set(cacheKey, responseData, CACHE_TTL.SHORT);

    res.json({
      success: true,
      data: responseData,
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

    // Invalidate cache for this share link
    await cacheService.delete(`${CACHE_KEYS.SHARE_LINK}verify:${link.token}`);
    await cacheService.delete(`${CACHE_KEYS.SHARE_LINK}data:${link.token}`);

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
 * GET /api/v1/deliverable-share/:token/version/:versionId/feedbacks
 * Get paginated feedbacks for a version via share link (PUBLIC - no auth required)
 * Supports cursor-based pagination (newest first, load older on scroll up)
 */
router.get('/:token/version/:versionId/feedbacks', async (req: Request, res: Response) => {
  try {
    const token = String(req.params.token);
    const versionId = String(req.params.versionId);
    const limit = Math.min(parseInt(req.query.limit as string) || 30, 100);
    const before = req.query.before as string | undefined; // cursor for older feedbacks

    // Verify share link
    const shareLink = await prisma.deliverableShareLink.findUnique({
      where: { token },
    });

    if (!shareLink || !shareLink.isActive) {
      return res.status(404).json({ error: 'Invalid or inactive share link' });
    }

    // Check expiration
    if (shareLink.expiresAt && shareLink.expiresAt < new Date()) {
      return res.status(403).json({ error: 'This share link has expired' });
    }

    // Verify version belongs to the deliverable
    const version = await prisma.version.findFirst({
      where: {
        id: versionId,
        deliverableId: shareLink.deliverableId,
      },
    });

    if (!version) {
      return res.status(404).json({ error: 'Version not found' });
    }

    // Build query for feedbacks
    const whereClause: any = { versionId };

    if (before) {
      // Get the createdAt of the cursor feedback
      const cursorFeedback = await prisma.feedback.findUnique({
        where: { id: before },
        select: { createdAt: true },
      });

      if (cursorFeedback) {
        whereClause.createdAt = { lt: cursorFeedback.createdAt };
      }
    }

    // Get total count
    const totalCount = await prisma.feedback.count({ where: { versionId } });

    // Fetch feedbacks (newest first for initial load, then older)
    const feedbacks = await prisma.feedback.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      take: limit + 1, // Take one extra to check if there are more
      include: {
        author: {
          select: {
            id: true,
            name: true,
            avatarUrl: true,
          },
        },
        revisionTasks: true,
        replyingTo: {
          select: {
            id: true,
            rawText: true,
            structuredText: true,
            author: { select: { id: true, name: true } },
            guestName: true,
          },
        },
        reactions: {
          select: {
            id: true,
            userId: true,
            guestEmail: true,
            guestName: true,
            emoji: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'asc' },
        },
        reads: {
          select: {
            userId: true,
            guestEmail: true,
            readAt: true,
          },
        },
      },
    });

    // Check if there are more feedbacks
    const hasMore = feedbacks.length > limit;
    const resultFeedbacks = hasMore ? feedbacks.slice(0, limit) : feedbacks;

    // Get cursors
    const oldestFeedback = resultFeedbacks[resultFeedbacks.length - 1];
    const newestFeedback = resultFeedbacks[0];

    res.json({
      success: true,
      data: {
        data: resultFeedbacks,
        pageInfo: {
          hasMore,
          totalCount,
          oldestCursor: oldestFeedback?.id || null,
          newestCursor: newestFeedback?.id || null,
        },
      },
    });
  } catch (error: any) {
    console.error('Get paginated feedbacks error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch feedbacks' });
  }
});

/**
 * POST /api/v1/deliverable-share/:token/feedback
 * Add feedback/comment via share link (PUBLIC - no auth required for guests)
 * Supports both authenticated users and guest commenters
 * Supports text, audio (voice notes), and attachments
 */
router.post('/:token/feedback', async (req: Request, res: Response) => {
  try {
    const token = String(req.params.token);
    const {
      versionId,
      rawText,
      structuredText,
      type,
      guestName,
      guestEmail,
      replyingToId,
      audioUrl,
      audioDuration,
      attachments,
      annotationX,
      annotationY,
      timestamp, // Vimeo-style video timestamp
      drawings, // Drawing annotations (Timeliner.io style)
    } = req.body;

    console.log('💬 POST /deliverable-share/:token/feedback - Adding feedback');
    console.log('🔑 Token:', token.substring(0, 10) + '...');
    console.log('👤 Guest:', guestName, guestEmail);
    console.log('🎤 Audio:', audioUrl ? 'yes' : 'no', '| Attachments:', attachments?.length || 0);

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
        audioUrl: audioUrl || undefined,
        audioDuration: audioDuration || undefined,
        attachments: attachments || undefined,
        annotationX: annotationX !== undefined ? annotationX : undefined,
        annotationY: annotationY !== undefined ? annotationY : undefined,
        // Vimeo-style video timestamp (position in seconds)
        timestamp: timestamp !== undefined ? parseFloat(timestamp) : undefined,
        // Drawing annotations (Timeliner.io style)
        drawings: drawings && drawings.length > 0 ? drawings : undefined,
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

    // Invalidate caches
    await cacheService.delete(`${CACHE_KEYS.SHARE_LINK}data:${token}`);
    await cacheService.invalidateFeedbacks(versionId);

    // Emit socket event for real-time updates
    const projectId = shareLink.deliverable.project.id;
    socketService.emitToProject(projectId, 'feedback:new', {
      id: feedback.id,
      versionId,
      authorId: userId || null,
      authorName: userId ? (feedback.author as any)?.name : guestName,
      type: type || 'TEXT',
      projectId,
    });

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

/**
 * POST /api/v1/deliverable-share/:token/upload/audio
 * Upload audio (voice note) via share link (PUBLIC - no auth required for guests)
 * Requires 'comment' or 'download' permission
 */
router.post('/:token/upload/audio', uploadAny.single('file'), async (req: Request, res: Response) => {
  try {
    const token = String(req.params.token);

    console.log('🎤 POST /deliverable-share/:token/upload/audio - Uploading voice note');

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Verify share link exists and has comment permission
    const shareLink = await prisma.deliverableShareLink.findUnique({
      where: { token },
    });

    if (!shareLink) {
      // Clean up uploaded file
      if (req.file?.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(404).json({ error: 'Invalid share link' });
    }

    // Check if link is active
    if (!shareLink.isActive) {
      if (req.file?.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(403).json({ error: 'This share link has been disabled' });
    }

    // Check expiration
    if (shareLink.expiresAt && shareLink.expiresAt < new Date()) {
      if (req.file?.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(403).json({ error: 'This share link has expired' });
    }

    // Check permission - must be 'comment' or 'download' to upload
    if (shareLink.permission === 'view') {
      if (req.file?.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(403).json({ error: 'This share link does not allow uploading files' });
    }

    const mimeType = req.file.mimetype;
    const originalName = req.file.originalname;
    let filePath = req.file.path;
    let finalName = originalName;
    let finalMimeType = mimeType;
    let transcodedPath: string | null = null;

    console.log('[Guest Audio Upload] Received:', { originalName, mimeType, size: req.file.size });

    // Check if transcoding is needed (WebM, Opus, OGG formats not supported on iOS Safari)
    const needsTranscode = mimeType.includes('webm') ||
                           mimeType.includes('ogg') ||
                           mimeType.includes('opus') ||
                           originalName.endsWith('.webm') ||
                           originalName.endsWith('.ogg');

    if (needsTranscode) {
      console.log('[Guest Audio Upload] Transcoding to MP4/AAC for iOS compatibility');

      const baseName = path.basename(originalName, path.extname(originalName));
      transcodedPath = path.join(path.dirname(filePath), `${baseName}_transcoded.mp4`);

      try {
        await transcodeToMp4(filePath, transcodedPath);
        filePath = transcodedPath;
        finalName = `${baseName}.mp4`;
        finalMimeType = 'audio/mp4';
        console.log('[Guest Audio Upload] Transcoding successful');
      } catch (transcodeError: any) {
        console.error('[Guest Audio Upload] Transcoding failed:', transcodeError.message);
        // Continue with original file
      }
    }

    // Upload to GCS with proper audio Content-Type so <audio> can play it
    // on desktop (iOS records as .mp4/AAC — octet-stream makes browsers fail).
    const gcsResult = await uploadAudioToGCS(filePath, finalName);

    // Delete local files
    if (fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    if (transcodedPath && fs.existsSync(transcodedPath)) {
      fs.unlinkSync(transcodedPath);
    }

    console.log('✅ Voice note uploaded:', gcsResult.url, '| Transcoded:', needsTranscode);

    res.status(200).json({
      success: true,
      data: {
        url: gcsResult.url,
        fileName: gcsResult.fileName,
        format: finalMimeType,
        size: gcsResult.size,
        transcoded: needsTranscode,
      },
      message: 'Audio uploaded successfully',
    });
  } catch (error: any) {
    // Clean up local file on error
    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    console.error('Upload audio via share link error:', error);
    res.status(500).json({
      error: error.message || 'Failed to upload audio',
    });
  }
});

/**
 * POST /api/v1/deliverable-share/:token/upload/file
 * Upload file (attachment) via share link (PUBLIC - no auth required for guests)
 * Requires 'comment' or 'download' permission
 */
router.post('/:token/upload/file', uploadAny.single('file'), async (req: Request, res: Response) => {
  try {
    const token = String(req.params.token);

    console.log('📎 POST /deliverable-share/:token/upload/file - Uploading attachment');

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Verify share link exists and has comment permission
    const shareLink = await prisma.deliverableShareLink.findUnique({
      where: { token },
    });

    if (!shareLink) {
      if (req.file?.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(404).json({ error: 'Invalid share link' });
    }

    // Check if link is active
    if (!shareLink.isActive) {
      if (req.file?.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(403).json({ error: 'This share link has been disabled' });
    }

    // Check expiration
    if (shareLink.expiresAt && shareLink.expiresAt < new Date()) {
      if (req.file?.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(403).json({ error: 'This share link has expired' });
    }

    // Check permission - must be 'comment' or 'download' to upload
    if (shareLink.permission === 'view') {
      if (req.file?.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(403).json({ error: 'This share link does not allow uploading files' });
    }

    const mimeType = req.file.mimetype;
    let gcsResult;

    // Upload based on file type
    if (mimeType.startsWith('image/')) {
      gcsResult = await uploadImageToGCS(req.file.path, req.file.originalname);
    } else {
      gcsResult = await uploadDocumentToGCS(req.file.path, req.file.originalname);
    }

    // Delete local file
    fs.unlinkSync(req.file.path);

    console.log('✅ File uploaded:', gcsResult.url);

    res.status(200).json({
      success: true,
      data: {
        url: gcsResult.url,
        name: req.file.originalname,
        type: mimeType,
        size: req.file.size,
      },
      message: 'File uploaded successfully',
    });
  } catch (error: any) {
    // Clean up local file on error
    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    console.error('Upload file via share link error:', error);
    res.status(500).json({
      error: error.message || 'Failed to upload file',
    });
  }
});

/**
 * PATCH /api/v1/deliverable-share/:token/feedback/:feedbackId/resolve
 * Toggle feedback resolved status via share link (PUBLIC - no auth required)
 * Requires 'comment' or 'download' permission
 */
router.patch('/:token/feedback/:feedbackId/resolve', async (req: Request, res: Response) => {
  try {
    const token = String(req.params.token);
    const feedbackId = String(req.params.feedbackId);
    const { resolved } = req.body;

    console.log('✅ PATCH /deliverable-share/:token/feedback/:feedbackId/resolve');
    console.log('🔑 Token:', token.substring(0, 10) + '...');
    console.log('📝 FeedbackId:', feedbackId);
    console.log('✓ Resolved:', resolved);

    if (typeof resolved !== 'boolean') {
      return res.status(400).json({ error: 'resolved must be a boolean' });
    }

    // Verify share link exists and has comment permission
    const shareLink = await prisma.deliverableShareLink.findUnique({
      where: { token },
      include: {
        deliverable: {
          include: {
            project: { select: { id: true } },
            versions: {
              select: { id: true },
            },
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

    // Resolving a feedback is an editor-level action — only share
    // links granted `download` permission can mark threads resolved.
    // 'view' and 'comment' are read/comment-only at this level.
    if (shareLink.permission !== 'download') {
      return res.status(403).json({ error: 'This share link does not allow resolving comments' });
    }

    // Verify feedback exists and belongs to this deliverable's versions
    const versionIds = shareLink.deliverable.versions.map(v => v.id);
    const feedback = await prisma.feedback.findFirst({
      where: {
        id: feedbackId,
        versionId: { in: versionIds },
      },
    });

    if (!feedback) {
      return res.status(404).json({ error: 'Feedback not found or does not belong to this deliverable' });
    }

    // Update feedback resolved status
    const updatedFeedback = await prisma.feedback.update({
      where: { id: feedbackId },
      data: {
        resolved,
        resolvedAt: resolved ? new Date() : null,
      },
      include: {
        author: {
          select: { id: true, name: true, avatarUrl: true },
        },
      },
    });

    // Emit socket event for real-time updates
    const projectId = shareLink.deliverable.project.id;
    socketService.emitToProject(projectId, 'feedback:resolved', {
      id: feedbackId,
      resolved: updatedFeedback.resolved,
      resolvedAt: updatedFeedback.resolvedAt?.toISOString(),
    });

    console.log('✅ Feedback resolved status updated:', resolved);

    res.json({
      success: true,
      data: {
        id: updatedFeedback.id,
        resolved: updatedFeedback.resolved,
        resolvedAt: updatedFeedback.resolvedAt?.toISOString(),
      },
    });
  } catch (error: any) {
    console.error('Toggle feedback resolved via share link error:', error);
    res.status(500).json({
      error: error.message || 'Failed to update feedback resolved status',
    });
  }
});

/**
 * PUT /api/v1/deliverable-share/:token/feedback/:feedbackId
 * Edit a guest's own feedback via share link (PUBLIC - no auth required).
 * Requires 'comment' or 'download' permission. Guest authorship is
 * verified by matching the request's guestEmail against the feedback's
 * stored guestEmail — same identification scheme used by /feedback POST.
 */
router.put('/:token/feedback/:feedbackId', async (req: Request, res: Response) => {
  try {
    const token = String(req.params.token);
    const feedbackId = String(req.params.feedbackId);
    const { rawText, structuredText, guestEmail } = req.body;

    if (!rawText && !structuredText) {
      return res.status(400).json({ error: 'rawText or structuredText is required' });
    }
    if (!guestEmail || typeof guestEmail !== 'string') {
      return res.status(400).json({ error: 'guestEmail is required for guest edits' });
    }

    const shareLink = await prisma.deliverableShareLink.findUnique({
      where: { token },
      include: {
        deliverable: {
          include: {
            project: { select: { id: true } },
            versions: { select: { id: true } },
          },
        },
      },
    });

    if (!shareLink) return res.status(404).json({ error: 'Invalid share link' });
    if (!shareLink.isActive) return res.status(403).json({ error: 'This share link has been disabled' });
    if (shareLink.expiresAt && shareLink.expiresAt < new Date()) {
      return res.status(403).json({ error: 'This share link has expired' });
    }
    if (shareLink.permission === 'view') {
      return res.status(403).json({ error: 'This share link does not allow editing comments' });
    }

    const versionIds = shareLink.deliverable.versions.map(v => v.id);
    const feedback = await prisma.feedback.findFirst({
      where: { id: feedbackId, versionId: { in: versionIds } },
    });

    if (!feedback) return res.status(404).json({ error: 'Feedback not found' });

    // Guest authorship check — only the guest who originally posted can
    // edit. Authenticated-user feedbacks (authorId set, guestEmail null)
    // are off-limits to share-link callers.
    if (!feedback.guestEmail || feedback.guestEmail !== guestEmail) {
      return res.status(403).json({ error: 'You can only edit your own comments' });
    }

    const updatedFeedback = await prisma.feedback.update({
      where: { id: feedbackId },
      data: {
        rawText: rawText ?? feedback.rawText,
        structuredText: structuredText ?? feedback.structuredText,
        editedAt: new Date(),
      },
      include: {
        author: { select: { id: true, name: true, avatarUrl: true } },
        revisionTasks: true,
        replyingTo: {
          select: {
            id: true,
            rawText: true,
            structuredText: true,
            author: { select: { id: true, name: true } },
            guestName: true,
          },
        },
        // Without this the rebound feedback would render with an empty
        // reactions array and the existing pills would visually vanish
        // until the next list refresh.
        reactions: {
          select: {
            id: true,
            userId: true,
            guestEmail: true,
            guestName: true,
            emoji: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    await cacheService.invalidateFeedbacks(feedback.versionId);

    const projectId = shareLink.deliverable.project.id;
    socketService.emitToProject(projectId, 'feedback:updated', {
      id: updatedFeedback.id,
      versionId: feedback.versionId,
      rawText: updatedFeedback.rawText,
      structuredText: updatedFeedback.structuredText,
      editedAt: updatedFeedback.editedAt,
      projectId,
    });

    res.json({ success: true, data: updatedFeedback });
  } catch (error: any) {
    console.error('Edit feedback via share link error:', error);
    res.status(500).json({ error: error.message || 'Failed to edit feedback' });
  }
});

/**
 * DELETE /api/v1/deliverable-share/:token/feedback/:feedbackId
 * Delete a guest's own feedback via share link (PUBLIC - no auth required).
 * Same authorisation pattern as PUT — guestEmail must match.
 */
router.delete('/:token/feedback/:feedbackId', async (req: Request, res: Response) => {
  try {
    const token = String(req.params.token);
    const feedbackId = String(req.params.feedbackId);
    // DELETE bodies are awkward across HTTP clients, so accept the
    // identity from a query param too. Either works.
    const guestEmail = (req.body?.guestEmail || req.query?.guestEmail) as string | undefined;

    if (!guestEmail || typeof guestEmail !== 'string') {
      return res.status(400).json({ error: 'guestEmail is required for guest deletes' });
    }

    const shareLink = await prisma.deliverableShareLink.findUnique({
      where: { token },
      include: {
        deliverable: {
          include: {
            project: { select: { id: true } },
            versions: { select: { id: true } },
          },
        },
      },
    });

    if (!shareLink) return res.status(404).json({ error: 'Invalid share link' });
    if (!shareLink.isActive) return res.status(403).json({ error: 'This share link has been disabled' });
    if (shareLink.expiresAt && shareLink.expiresAt < new Date()) {
      return res.status(403).json({ error: 'This share link has expired' });
    }
    if (shareLink.permission === 'view') {
      return res.status(403).json({ error: 'This share link does not allow deleting comments' });
    }

    const versionIds = shareLink.deliverable.versions.map(v => v.id);
    const feedback = await prisma.feedback.findFirst({
      where: { id: feedbackId, versionId: { in: versionIds } },
    });

    if (!feedback) return res.status(404).json({ error: 'Feedback not found' });

    if (!feedback.guestEmail || feedback.guestEmail !== guestEmail) {
      return res.status(403).json({ error: 'You can only delete your own comments' });
    }

    const versionId = feedback.versionId;
    await prisma.feedback.delete({ where: { id: feedbackId } });
    await cacheService.invalidateFeedbacks(versionId);

    const projectId = shareLink.deliverable.project.id;
    socketService.emitToProject(projectId, 'feedback:deleted', {
      id: feedbackId,
      versionId,
      projectId,
    });

    res.json({ success: true, data: null });
  } catch (error: any) {
    console.error('Delete feedback via share link error:', error);
    res.status(500).json({ error: error.message || 'Failed to delete feedback' });
  }
});

/**
 * POST /api/v1/deliverable-share/:token/feedback/bulk-read
 * Mark multiple feedbacks as read by a guest via share link.
 *
 * Guests are identified by `guestEmail` in the body (read from the
 * localStorage'd guestInfo on the frontend). Skips feedbacks the
 * guest authored themselves — same rule as the auth controller —
 * and emits `feedback:read` per deliverable so senders see their
 * double-check go blue in real time.
 */
router.post('/:token/feedback/bulk-read', async (req: Request, res: Response) => {
  try {
    const token = String(req.params.token);
    const { feedbackIds, guestEmail } = req.body || {};

    if (!Array.isArray(feedbackIds) || feedbackIds.length === 0) {
      return res.status(400).json({ error: 'feedbackIds must be a non-empty array' });
    }
    if (feedbackIds.length > 200) {
      return res.status(400).json({ error: 'feedbackIds length exceeds 200' });
    }
    if (!guestEmail || typeof guestEmail !== 'string') {
      return res.status(400).json({ error: 'guestEmail is required for guest reads' });
    }
    const ids = feedbackIds.filter((v: unknown): v is string => typeof v === 'string');
    if (ids.length === 0) {
      return res.status(400).json({ error: 'feedbackIds must contain strings' });
    }

    const shareLink = await prisma.deliverableShareLink.findUnique({
      where: { token },
      include: {
        deliverable: {
          include: {
            versions: { select: { id: true } },
          },
        },
      },
    });

    if (!shareLink) return res.status(404).json({ error: 'Invalid share link' });
    if (!shareLink.isActive) return res.status(403).json({ error: 'This share link has been disabled' });
    if (shareLink.expiresAt && shareLink.expiresAt < new Date()) {
      return res.status(403).json({ error: 'This share link has expired' });
    }

    // Only mark feedbacks that belong to this deliverable and that the
    // guest didn't author. createMany skips duplicates so re-reads are
    // idempotent — guest can scroll back over the same messages without
    // bumping the receipt count.
    const versionIds = shareLink.deliverable.versions.map(v => v.id);
    const feedbacks = await prisma.feedback.findMany({
      where: { id: { in: ids }, versionId: { in: versionIds } },
      select: {
        id: true,
        guestEmail: true,
        version: { select: { deliverableId: true } },
      },
    });

    const othersFeedbackIds = feedbacks
      .filter((f) => f.guestEmail !== guestEmail)
      .map((f) => f.id);

    if (othersFeedbackIds.length === 0) {
      return res.json({ success: true, data: { marked: 0 } });
    }

    // Skip feedbacks already read by this guest. Without this, every
    // re-render of the chat would create new rows since the unique
    // constraint on (feedbackId, userId) doesn't apply when userId is
    // null (Postgres NULLS DISTINCT default).
    const alreadyRead = await prisma.feedbackRead.findMany({
      where: { feedbackId: { in: othersFeedbackIds }, userId: null, guestEmail },
      select: { feedbackId: true },
    });
    const alreadyReadSet = new Set(alreadyRead.map((r) => r.feedbackId));
    const toCreate = othersFeedbackIds.filter((id) => !alreadyReadSet.has(id));

    if (toCreate.length === 0) {
      return res.json({ success: true, data: { marked: 0 } });
    }

    const readAt = new Date();
    await prisma.feedbackRead.createMany({
      data: toCreate.map((feedbackId) => ({
        feedbackId,
        userId: null,
        guestEmail,
        readAt,
      })),
    });

    // Broadcast per deliverable for efficient fan-out — same shape as
    // the auth controller plus guestEmail so clients can match
    // recipients by either identity.
    const byDeliverable = new Map<string, string[]>();
    for (const f of feedbacks) {
      if (!toCreate.includes(f.id)) continue;
      const d = f.version?.deliverableId;
      if (!d) continue;
      if (!byDeliverable.has(d)) byDeliverable.set(d, []);
      byDeliverable.get(d)!.push(f.id);
    }
    for (const [deliverableId, fbIds] of byDeliverable) {
      socketService.emitToDeliverable(deliverableId, 'feedback:read', {
        userId: null,
        guestEmail,
        readAt: readAt.toISOString(),
        feedbackIds: fbIds,
        deliverableId,
      });
    }

    res.json({ success: true, data: { marked: toCreate.length } });
  } catch (error: any) {
    console.error('Bulk-read feedbacks via share link error:', error);
    res.status(500).json({ error: error.message || 'Failed to mark feedbacks as read' });
  }
});

/**
 * POST /api/v1/deliverable-share/:token/feedback/:feedbackId/reactions
 * Toggle an emoji reaction as a guest via share link.
 *
 * Mirrors the auth controller's contract (same emoji → remove, different
 * emoji → replace, none → add) but keys reactions on `guestEmail`
 * instead of `userId`. Returns the fresh reaction list so the optimistic
 * frontend state can reconcile.
 */
router.post('/:token/feedback/:feedbackId/reactions', async (req: Request, res: Response) => {
  try {
    const token = String(req.params.token);
    const feedbackId = String(req.params.feedbackId);
    const { emoji, guestEmail, guestName } = req.body || {};

    if (typeof emoji !== 'string' || emoji.length === 0 || emoji.length > 16) {
      return res.status(400).json({ error: 'emoji must be a short non-empty string' });
    }
    if (!guestEmail || typeof guestEmail !== 'string') {
      return res.status(400).json({ error: 'guestEmail is required for guest reactions' });
    }

    const shareLink = await prisma.deliverableShareLink.findUnique({
      where: { token },
      include: {
        deliverable: {
          include: {
            project: { select: { id: true } },
            versions: { select: { id: true } },
          },
        },
      },
    });

    if (!shareLink) return res.status(404).json({ error: 'Invalid share link' });
    if (!shareLink.isActive) return res.status(403).json({ error: 'This share link has been disabled' });
    if (shareLink.expiresAt && shareLink.expiresAt < new Date()) {
      return res.status(403).json({ error: 'This share link has expired' });
    }
    if (shareLink.permission === 'view') {
      return res.status(403).json({ error: 'This share link does not allow reactions' });
    }

    const versionIds = shareLink.deliverable.versions.map(v => v.id);
    const feedback = await prisma.feedback.findFirst({
      where: { id: feedbackId, versionId: { in: versionIds } },
      select: { id: true, versionId: true, version: { select: { deliverableId: true } } },
    });
    if (!feedback) return res.status(404).json({ error: 'Feedback not found' });

    // Guest uniqueness on (feedbackId, guestEmail) is enforced here
    // since Prisma can't model partial-unique compound keys without
    // raw SQL. findFirst-then-act keeps the toggle/replace/add flow
    // identical to the authenticated path.
    const existing = await prisma.feedbackReaction.findFirst({
      where: { feedbackId, userId: null, guestEmail },
    });

    let action: 'added' | 'removed' | 'changed';
    if (!existing) {
      await prisma.feedbackReaction.create({
        data: {
          feedbackId,
          userId: null,
          guestEmail,
          guestName: typeof guestName === 'string' ? guestName : null,
          emoji,
        },
      });
      action = 'added';
    } else if (existing.emoji === emoji) {
      await prisma.feedbackReaction.delete({ where: { id: existing.id } });
      action = 'removed';
    } else {
      await prisma.feedbackReaction.update({
        where: { id: existing.id },
        data: { emoji, createdAt: new Date() },
      });
      action = 'changed';
    }

    const reactions = await prisma.feedbackReaction.findMany({
      where: { feedbackId },
      select: {
        id: true,
        userId: true,
        guestEmail: true,
        guestName: true,
        emoji: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    // Invalidate the cached deliverable payload — without this the
    // GET /:token cache (1 min TTL) keeps returning the stale
    // reactions list, so a guest who reacts then refreshes loses
    // their pill until the cache expires.
    await cacheService.invalidateFeedbacks(feedback.versionId);

    const deliverableId = feedback.version?.deliverableId;
    if (deliverableId) {
      socketService.emitToDeliverable(deliverableId, 'feedback:reaction', {
        feedbackId,
        userId: null,
        guestEmail,
        emoji,
        action,
        deliverableId,
        reactions,
      });
    }

    res.json({ success: true, data: { action, reactions } });
  } catch (error: any) {
    console.error('Toggle feedback reaction via share link error:', error);
    res.status(500).json({ error: error.message || 'Failed to toggle reaction' });
  }
});

/**
 * POST /api/v1/deliverable-share/:token/version/:versionId/downscale
 * Downscale video via share link (PUBLIC - no auth required)
 * Requires 'download' permission
 */
// Shared share-link gate. Returns either the verified version or sends
// the appropriate 4xx and returns null.
async function resolveShareForDownscale(
  req: Request,
  res: Response,
  requireDownload: boolean
): Promise<{ versionId: string } | null> {
  const token = String(req.params.token);
  const versionId = String(req.params.versionId);

  const shareLink = await prisma.deliverableShareLink.findUnique({
    where: { token },
    include: {
      deliverable: { include: { versions: { where: { id: versionId }, select: { id: true } } } },
    },
  });

  if (!shareLink) {
    res.status(404).json({ error: 'Invalid share link' });
    return null;
  }
  if (!shareLink.isActive) {
    res.status(403).json({ error: 'This share link has been disabled' });
    return null;
  }
  if (shareLink.expiresAt && shareLink.expiresAt < new Date()) {
    res.status(403).json({ error: 'This share link has expired' });
    return null;
  }
  if (requireDownload && shareLink.permission !== 'download') {
    res.status(403).json({ error: 'This share link does not allow downloading' });
    return null;
  }
  if (!shareLink.deliverable.versions || shareLink.deliverable.versions.length === 0) {
    res.status(404).json({ error: 'Version not found or does not belong to this deliverable' });
    return null;
  }

  return { versionId };
}

router.post('/:token/version/:versionId/downscale', shareDownscaleLimiter, async (req: Request, res: Response) => {
  try {
    const { quality } = req.body as { quality?: string };
    const retry = req.query.retry === '1' || req.query.retry === 'true';

    if (!quality || !SUPPORTED_QUALITIES.includes(quality as never)) {
      return res.status(400).json({
        error: `Target quality is required and must be one of: ${SUPPORTED_QUALITIES.join(', ')}`,
      });
    }

    const ctx = await resolveShareForDownscale(req, res, /* requireDownload */ true);
    if (!ctx) return;

    const job = await enqueueDownscale(ctx.versionId, quality, { retry });

    if (job.status === 'DONE') {
      return res.json({
        success: true,
        data: { quality, url: job.url, status: 'DONE', source: 'cached', jobId: job.jobId },
      });
    }

    if (job.status === 'FAILED') {
      return res.status(409).json({
        success: false,
        data: { quality, status: 'FAILED', jobId: job.jobId, error: job.error },
      });
    }

    res.status(202).json({
      success: true,
      data: { quality, status: 'PROCESSING', jobId: job.jobId },
    });
  } catch (error: any) {
    console.error('Downscale via share link error:', error);
    res.status(500).json({ error: error.message || 'Failed to enqueue downscale' });
  }
});

/**
 * GET /api/v1/deliverable-share/:token/version/:versionId/downscale/:quality/status
 * Polling endpoint for guests. `view` permission is enough — anyone who
 * can open the share link can check whether the downscale is done. The
 * actual URL is still only useful with `download` permission because we
 * gate that on the POST.
 */
router.get('/:token/version/:versionId/downscale/:quality/status', async (req: Request, res: Response) => {
  try {
    const quality = String(req.params.quality);
    if (!SUPPORTED_QUALITIES.includes(quality as never)) {
      return res.status(400).json({ error: 'Unknown quality' });
    }

    const ctx = await resolveShareForDownscale(req, res, /* requireDownload */ false);
    if (!ctx) return;

    const view = await getDownscaleStatus(ctx.versionId, quality);
    if (!view) {
      return res.json({ success: true, data: { quality, status: 'NOT_STARTED' } });
    }
    res.json({
      success: true,
      data: {
        quality,
        status: view.status,
        url: view.url,
        error: view.error,
        jobId: view.jobId,
      },
    });
  } catch (error: any) {
    console.error('Downscale status via share link error:', error);
    res.status(500).json({ error: error.message || 'Failed to read downscale status' });
  }
});

export default router;
