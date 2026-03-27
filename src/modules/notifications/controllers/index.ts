import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../config/database';
import { ApiResponse } from '../../../utils/apiResponse';

export const getNotifications = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    // Disable caching for notifications to ensure real-time updates
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    ApiResponse.success(res, notifications);
  } catch (error) {
    next(error);
  }
};

export const markAsRead = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);

    await prisma.notification.update({
      where: { id },
      data: { read: true },
    });

    ApiResponse.success(res, null, 'Notification marked as read');
  } catch (error) {
    next(error);
  }
};

export const markAllAsRead = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.user!.id, read: false },
      data: { read: true },
    });

    ApiResponse.success(res, null, 'All notifications marked as read');
  } catch (error) {
    next(error);
  }
};

export const deleteNotification = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = String(req.params.id);
    await prisma.notification.delete({ where: { id } });
    ApiResponse.success(res, null, 'Notification deleted');
  } catch (error) {
    next(error);
  }
};
