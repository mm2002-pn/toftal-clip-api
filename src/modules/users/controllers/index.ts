import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../config/database';
import { ApiResponse } from '../../../utils/apiResponse';
import { NotFoundError, ForbiddenError } from '../../../utils/errors';

// Search users by name or email
export const searchUsers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const query = String(req.query.q || '');

    if (!query || query.length < 2) {
      ApiResponse.success(res, []);
      return;
    }

    const users = await prisma.user.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { email: { contains: query, mode: 'insensitive' } },
        ],
        // Exclude archived/deleted users
        accountStatus: 'ACTIVE',
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        avatarUrl: true,
      },
      take: 10, // Limit to 10 results
    });

    ApiResponse.success(res, users);
  } catch (error) {
    next(error);
  }
};

// Get user by ID
export const getUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        avatarUrl: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    ApiResponse.success(res, user);
  } catch (error) {
    next(error);
  }
};

// Update user
export const updateUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { name, avatarUrl } = req.body;

    // Check ownership or admin
    if (req.user!.id !== id && req.user!.role !== 'ADMIN') {
      throw new ForbiddenError('You can only update your own profile');
    }

    const user = await prisma.user.update({
      where: { id },
      data: { name, avatarUrl },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        avatarUrl: true,
      },
    });

    ApiResponse.success(res, user, 'User updated successfully');
  } catch (error) {
    next(error);
  }
};

// Delete user (Admin only)
export const deleteUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);

    await prisma.user.delete({ where: { id } });

    ApiResponse.success(res, null, 'User deleted successfully');
  } catch (error) {
    next(error);
  }
};

// Archive own account (soft delete)
export const archiveAccount = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.id;

    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        accountStatus: 'ARCHIVED',
        archivedAt: new Date(),
      },
      select: {
        id: true,
        email: true,
        name: true,
        accountStatus: true,
        archivedAt: true,
      },
    });

    ApiResponse.success(res, user, 'Compte archivé avec succès');
  } catch (error) {
    next(error);
  }
};

// Restore archived account
export const restoreAccount = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.id;

    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        accountStatus: 'ACTIVE',
        archivedAt: null,
      },
      select: {
        id: true,
        email: true,
        name: true,
        accountStatus: true,
      },
    });

    ApiResponse.success(res, user, 'Compte restauré avec succès');
  } catch (error) {
    next(error);
  }
};

// Permanently delete own account
export const deleteOwnAccount = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { password } = req.body;

    // Get user to verify password
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    // If user has password (not Google auth), verify it
    if (user.passwordHash && password) {
      const bcrypt = require('bcryptjs');
      const isValid = await bcrypt.compare(password, user.passwordHash);
      if (!isValid) {
        throw new ForbiddenError('Mot de passe incorrect');
      }
    }

    // Delete related data first
    await prisma.notification.deleteMany({ where: { userId } });
    await prisma.feedback.deleteMany({ where: { authorId: userId } });
    await prisma.review.deleteMany({ where: { authorId: userId } });
    await prisma.talentProfile.deleteMany({ where: { userId } });

    // Delete user
    await prisma.user.delete({ where: { id: userId } });

    ApiResponse.success(res, null, 'Compte supprimé définitivement');
  } catch (error) {
    next(error);
  }
};
