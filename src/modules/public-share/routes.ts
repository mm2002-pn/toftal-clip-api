import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate } from '../../middlewares/auth';
import { requireProjectAccess } from '../../middlewares/permissions';
import crypto from 'crypto';

const router = Router();
const prisma = new PrismaClient();

/**
 * POST /api/v1/public-share
 * Create a new public share link for a project
 * Requires: projectId, permission (view|comment|download)
 * Optional: expiresIn (days), maxUses (number)
 */
router.post('/', authenticate, requireProjectAccess('edit'), async (req: Request, res: Response) => {
  try {
    const { projectId, permission = 'view', expiresIn = 7, maxUses = null } = req.body;
    const userId = req.user!.id;

    console.log('🔗 POST /public-share called');
    console.log('📁 ProjectId:', projectId);
    console.log('🔐 Permission:', permission);

    // Validate input
    if (!projectId) {
      return res.status(400).json({ error: 'projectId is required' });
    }

    if (!['view', 'comment', 'download'].includes(permission)) {
      return res.status(400).json({
        error: "Permission must be one of: 'view', 'comment', 'download'",
      });
    }

    // Verify project exists and user has access
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Generate secure token
    const token = crypto.randomBytes(32).toString('hex');

    // Calculate expiry date
    const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 24 * 60 * 60 * 1000) : null;

    // Create public share link
    const publicLink = await prisma.publicShareLink.create({
      data: {
        projectId,
        creatorUserId: userId,
        token,
        permission,
        expiresAt,
        maxUses: maxUses || null,
        isActive: true,
        usedCount: 0,
      },
    });

    console.log('✅ Public share link created:', publicLink.id);

    res.status(201).json({
      success: true,
      data: {
        id: publicLink.id,
        token: publicLink.token,
        permission: publicLink.permission,
        expiresAt: publicLink.expiresAt,
        url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/#/share?token=${token}`,
      },
    });
  } catch (error: any) {
    console.error('Public share creation error:', error);
    res.status(500).json({
      error: error.message || 'Failed to create public share link',
    });
  }
});

/**
 * GET /api/v1/public-share/verify/:token
 * Verify a public share token (PUBLIC - no auth required)
 */
router.get('/verify/:token', async (req: Request, res: Response) => {
  try {
    const token = String(req.params.token);

    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }

    console.log('🔍 Verifying public share token:', token.substring(0, 10) + '...');

    const publicLink = await prisma.publicShareLink.findUnique({
      where: { token },
    });

    if (!publicLink) {
      console.warn('❌ Token not found:', token.substring(0, 10) + '...');
      return res.status(404).json({ error: 'Invalid or expired token' });
    }

    // Check if link is active
    if (!publicLink.isActive) {
      console.warn('❌ Link is disabled');
      return res.status(403).json({ error: 'This share link has been disabled' });
    }

    // Check expiration
    if (publicLink.expiresAt && publicLink.expiresAt < new Date()) {
      console.warn('❌ Link expired');
      return res.status(403).json({ error: 'This share link has expired' });
    }

    // Check usage limit
    if (publicLink.maxUses && publicLink.usedCount >= publicLink.maxUses) {
      console.warn('❌ Max uses exceeded');
      return res.status(403).json({ error: 'This share link has reached its usage limit' });
    }

    console.log('✅ Token verified successfully');

    res.json({
      success: true,
      data: {
        id: publicLink.id,
        projectId: publicLink.projectId,
        permission: publicLink.permission,
        expiresAt: publicLink.expiresAt,
        isActive: publicLink.isActive,
        maxUses: publicLink.maxUses,
        usedCount: publicLink.usedCount,
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
 * GET /api/v1/public-share/:token
 * Get project data via public share link (PUBLIC - no auth required)
 */
router.get('/:token', async (req: Request, res: Response) => {
  try {
    const token = String(req.params.token);

    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }

    console.log('📂 GET /public-share/:token - Fetching project data');

    const publicLink = await prisma.publicShareLink.findUnique({
      where: { token },
      include: {
        project: {
          include: {
            deliverables: {
              include: {
                versions: true,
              },
            },
          },
        },
      },
    });

    if (!publicLink) {
      return res.status(404).json({ error: 'Invalid or expired token' });
    }

    // Check if link is active
    if (!publicLink.isActive) {
      return res.status(403).json({ error: 'This share link has been disabled' });
    }

    // Check expiration
    if (publicLink.expiresAt && publicLink.expiresAt < new Date()) {
      return res.status(403).json({ error: 'This share link has expired' });
    }

    // Check usage limit
    if (publicLink.maxUses && publicLink.usedCount >= publicLink.maxUses) {
      return res.status(403).json({ error: 'This share link has reached its usage limit' });
    }

    // Increment usage count
    await prisma.publicShareLink.update({
      where: { id: publicLink.id },
      data: { usedCount: publicLink.usedCount + 1 },
    });

    console.log('✅ Project data retrieved:', publicLink.project.id);

    res.json({
      success: true,
      data: {
        publicLink: {
          id: publicLink.id,
          permission: publicLink.permission,
          expiresAt: publicLink.expiresAt,
        },
        project: publicLink.project,
      },
    });
  } catch (error: any) {
    console.error('Get public project error:', error);
    res.status(500).json({
      error: error.message || 'Failed to fetch project data',
    });
  }
});

/**
 * DELETE /api/v1/public-share/:id
 * Disable a public share link (requires authentication)
 */
router.delete('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const linkId = String(req.params.id);
    const userId = req.user!.id;

    if (!linkId) {
      return res.status(400).json({ error: 'Link ID is required' });
    }

    console.log('🗑️ DELETE /public-share/:id - Disabling link:', linkId);

    // Get the link and verify ownership
    const link = await prisma.publicShareLink.findUnique({
      where: { id: linkId },
    });

    if (!link) {
      return res.status(404).json({ error: 'Public share link not found' });
    }

    // Verify user is the creator
    if (link.creatorUserId !== userId) {
      return res.status(403).json({ error: 'You do not have permission to disable this link' });
    }

    // Disable the link (soft delete)
    const updatedLink = await prisma.publicShareLink.update({
      where: { id: linkId },
      data: { isActive: false },
    });

    console.log('✅ Public share link disabled');

    res.json({
      success: true,
      message: 'Public share link has been disabled',
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
 * GET /api/v1/public-share/project/:projectId
 * Get all public share links for a project (requires authentication + project access)
 */
router.get(
  '/project/:projectId',
  authenticate,
  requireProjectAccess('view'),
  async (req: Request, res: Response) => {
    try {
      const projectId = String(req.params.projectId);
      const userId = req.user!.id;

      console.log('📋 GET /public-share/project/:projectId - Listing links for project:', projectId);

      // Get all ACTIVE links for the project created by this user
      const links = await prisma.publicShareLink.findMany({
        where: {
          projectId,
          creatorUserId: userId,
          isActive: true,  // Only show active links
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
        },
      });

      console.log('✅ Found', links.length, 'public share links');

      res.json({
        success: true,
        data: links.map((link) => ({
          ...link,
          url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/#/share?token=${link.token}`,
        })),
      });
    } catch (error: any) {
      console.error('Get links error:', error);
      res.status(500).json({
        error: error.message || 'Failed to fetch public share links',
      });
    }
  }
);

export default router;
