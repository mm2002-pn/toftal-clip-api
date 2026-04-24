import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { PermissionService } from '../services/PermissionService';

// Extend Express Request to include permission data
declare global {
  namespace Express {
    interface Request {
      projectId?: string;
      permission?: {
        hasAccess: boolean;
        role?: string;
        permissions?: {
          view: boolean;
          edit: boolean;
          comment: boolean;
          approve: boolean;
        };
      };
    }
  }
}

const prisma = new PrismaClient();
const permissionService = new PermissionService(prisma);

/**
 * Middleware to check if user can access a project
 * Requires: user to be authenticated and project ID to be in params or body
 */
export const requireProjectAccess = (
  requiredPermission?: 'view' | 'edit' | 'comment' | 'approve'
) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Check if user is authenticated
      if (!req.user || !req.user.id) {
        return res.status(401).json({ error: 'Non authentifie' });
      }

      // Get project ID from params or body. Routes use either `:projectId`
      // (nested routes under /invitations/project/...) or `:id` (project
      // routes like /projects/:id/...) — accept both.
      const projectId = req.params.projectId || req.params.id || req.body.projectId;

      if (!projectId) {
        return res.status(400).json({ error: 'L\'identifiant du projet est requis' });
      }

      // Admins bypass project-level ACL — they need to be able to read and
      // edit any project via the admin module.
      if ((req.user as any).role === 'ADMIN') {
        req.projectId = projectId;
        req.permission = {
          hasAccess: true,
          role: 'OWNER',
          permissions: { view: true, edit: true, comment: true, approve: true },
        };
        return next();
      }

      // Check project access
      const permission = await permissionService.canAccessProject(projectId, req.user.id);

      if (!permission.hasAccess) {
        return res.status(403).json({ error: 'Acces refuse : vous n\'etes pas membre de ce projet' });
      }

      // If specific permission is required, check it
      if (requiredPermission && permission.permissions) {
        const hasPermission = permission.permissions[requiredPermission];
        if (!hasPermission) {
          const labels: Record<string, string> = {
            view: 'de lecture',
            edit: 'd\'edition',
            comment: 'de commentaire',
            approve: 'de validation',
          };
          return res.status(403).json({
            error: `Acces refuse : la permission ${labels[requiredPermission] || requiredPermission} est requise`,
          });
        }
      }

      // Attach permission info to request
      req.projectId = projectId;
      req.permission = permission;

      next();
    } catch (error) {
      console.error('Permission check error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
};

/**
 * Middleware to check if user is the project owner
 */
export const requireProjectOwner = () => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({ error: 'Unauthorized: User not authenticated' });
      }

      const projectId = req.params.projectId || req.params.id || req.body.projectId;

      if (!projectId) {
        return res.status(400).json({ error: 'Project ID is required' });
      }

      // Admins can act as owner on any project.
      if ((req.user as any).role === 'ADMIN') {
        req.projectId = projectId;
        return next();
      }

      const isOwner = await permissionService.isProjectOwner(projectId, req.user.id);

      if (!isOwner) {
        return res.status(403).json({ error: 'Forbidden: Only project owner can perform this action' });
      }

      req.projectId = projectId;
      next();
    } catch (error) {
      console.error('Owner check error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
};

/**
 * Middleware to check if user has a specific permission
 */
export const requirePermission = (permission: 'view' | 'edit' | 'comment' | 'approve') => {
  return requireProjectAccess(permission);
};

/**
 * Middleware for deliverable-scoped routes (e.g. /deliverables/:id/...).
 * Resolves the deliverable → its parent project → applies the same access
 * check as `requireProjectAccess`.
 */
export const requireDeliverableAccess = (
  requiredPermission?: 'view' | 'edit' | 'comment' | 'approve'
) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({ error: 'Non authentifie' });
      }

      const deliverableId = String(req.params.id || req.params.deliverableId || '');
      if (!deliverableId) {
        return res.status(400).json({ error: 'Deliverable ID is required' });
      }

      // Admin bypass — same as requireProjectAccess.
      if ((req.user as any).role === 'ADMIN') {
        return next();
      }

      const deliverable = await prisma.deliverable.findUnique({
        where: { id: deliverableId },
        select: { projectId: true, assignedTalentId: true },
      });
      if (!deliverable) {
        return res.status(404).json({ error: 'Deliverable not found' });
      }

      // Assigned talent gets edit access on their own deliverables even if
      // not a regular project member — matches the "talent can upload
      // versions" contract elsewhere in the app.
      if (deliverable.assignedTalentId === req.user.id) {
        req.projectId = deliverable.projectId;
        return next();
      }

      const permission = await permissionService.canAccessProject(
        deliverable.projectId,
        req.user.id
      );
      if (!permission.hasAccess) {
        return res.status(403).json({
          error: "Acces refuse : vous n'etes pas membre de ce projet",
        });
      }
      if (requiredPermission && permission.permissions) {
        if (!permission.permissions[requiredPermission]) {
          return res.status(403).json({ error: 'Permission insuffisante' });
        }
      }

      req.projectId = deliverable.projectId;
      req.permission = permission;
      next();
    } catch (error) {
      console.error('Deliverable access check error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
};
