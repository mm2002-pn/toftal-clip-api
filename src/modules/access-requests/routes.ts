import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AccessRequestService } from '../../services/AccessRequestService';
import { EmailService } from '../../services/EmailService';
import { authenticate } from '../../middlewares/auth';
import { requireProjectOwner, requireProjectAccess } from '../../middlewares/permissions';

const router = Router();
const prisma = new PrismaClient();
const emailService = new EmailService();
const accessRequestService = new AccessRequestService(prisma, emailService);

/**
 * POST /api/v1/access-requests
 * Create an access request (user asking for more permissions)
 */
router.post('/', authenticate, async (req: Request, res: Response) => {
  try {
    const { projectId, message } = req.body;
    const userId = req.user!.id;

    console.log('📋 Creating access request');
    console.log('📁 ProjectId:', projectId);
    console.log('👤 UserId:', userId);
    console.log('📝 Message:', message);

    if (!projectId) {
      return res.status(400).json({
        error: 'projectId is required',
      });
    }

    const request = await accessRequestService.createAccessRequest(projectId, userId, message);

    res.status(201).json({
      success: true,
      data: {
        id: request.id,
        status: request.status,
        createdAt: request.createdAt,
      },
    });
  } catch (error: any) {
    console.error('Access request error:', error);
    res.status(400).json({
      error: error.message || 'Failed to create access request',
    });
  }
});

/**
 * GET /api/v1/access-requests/project/:projectId
 * Get pending access requests for a project (owner only)
 */
router.get('/project/:projectId', authenticate, requireProjectOwner(), async (req: Request, res: Response) => {
  try {
    const projectId = String(req.params.projectId);

    const requests = await accessRequestService.getProjectAccessRequests(projectId);

    res.json({
      success: true,
      data: requests,
    });
  } catch (error: any) {
    console.error('Get access requests error:', error);
    res.status(500).json({
      error: 'Failed to fetch access requests',
    });
  }
});

/**
 * POST /api/v1/access-requests/:requestId/approve
 * Approve an access request
 */
router.post('/:requestId/approve', authenticate, async (req: Request, res: Response) => {
  try {
    const requestId = String(req.params.requestId);
    const userId = req.user!.id;

    const request = await prisma.accessRequest.findUnique({
      where: { id: requestId },
      include: { project: true },
    });

    if (!request) {
      return res.status(404).json({ error: 'Access request not found' });
    }

    // Check if user is project owner
    if (request.project.ownerId !== userId) {
      return res.status(403).json({ error: 'Only project owner can approve requests' });
    }

    const updated = await accessRequestService.approveAccessRequest(
      requestId,
      request.projectId,
      request.userId
    );

    res.json({
      success: true,
      data: updated,
    });
  } catch (error: any) {
    console.error('Approve request error:', error);
    res.status(400).json({
      error: error.message || 'Failed to approve access request',
    });
  }
});

/**
 * POST /api/v1/access-requests/:requestId/reject
 * Reject an access request
 */
router.post('/:requestId/reject', authenticate, async (req: Request, res: Response) => {
  try {
    const requestId = String(req.params.requestId);
    const userId = req.user!.id;

    const request = await prisma.accessRequest.findUnique({
      where: { id: requestId },
      include: { project: true },
    });

    if (!request) {
      return res.status(404).json({ error: 'Access request not found' });
    }

    // Check if user is project owner
    if (request.project.ownerId !== userId) {
      return res.status(403).json({ error: 'Only project owner can reject requests' });
    }

    const updated = await accessRequestService.rejectAccessRequest(requestId);

    res.json({
      success: true,
      data: updated,
    });
  } catch (error: any) {
    console.error('Reject request error:', error);
    res.status(400).json({
      error: error.message || 'Failed to reject access request',
    });
  }
});

export default router;
