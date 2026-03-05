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
        return res.status(401).json({ error: 'Unauthorized: User not authenticated' });
      }

      // Get project ID from params or body
      const projectId = req.params.projectId || req.body.projectId;

      if (!projectId) {
        return res.status(400).json({ error: 'Project ID is required' });
      }

      // Check project access
      const permission = await permissionService.canAccessProject(projectId, req.user.id);

      if (!permission.hasAccess) {
        return res.status(403).json({ error: 'Forbidden: You do not have access to this project' });
      }

      // If specific permission is required, check it
      if (requiredPermission && permission.permissions) {
        const hasPermission = permission.permissions[requiredPermission];
        if (!hasPermission) {
          return res.status(403).json({
            error: `Forbidden: You do not have ${requiredPermission} permission for this project`,
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

      const projectId = req.params.projectId || req.body.projectId;

      if (!projectId) {
        return res.status(400).json({ error: 'Project ID is required' });
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
