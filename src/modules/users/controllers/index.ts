import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../config/database';
import { ApiResponse } from '../../../utils/apiResponse';
import { NotFoundError, ForbiddenError } from '../../../utils/errors';

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
