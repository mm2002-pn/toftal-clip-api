import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../config/database';
import { ApiResponse } from '../../../utils/apiResponse';

// Register or refresh an FCM device token for the authenticated user.
// FCM tokens are globally unique, so we upsert by token: if the same browser
// signs in under a different account, the token is reassigned to the new user
// instead of leaving an orphan row pointing to the old one.
export const registerDeviceToken = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { token, platform } = req.body as { token?: string; platform?: string };

    if (!token || typeof token !== 'string' || token.length < 20) {
      ApiResponse.error(res, 'Token FCM manquant ou invalide.', 400);
      return;
    }

    const userAgent = req.headers['user-agent']?.slice(0, 500) || null;
    const safePlatform = platform === 'ios' || platform === 'android' ? platform : 'web';

    const record = await prisma.userDeviceToken.upsert({
      where: { token },
      create: {
        userId,
        token,
        platform: safePlatform,
        userAgent,
      },
      update: {
        userId,
        platform: safePlatform,
        userAgent,
        lastSeenAt: new Date(),
      },
    });

    ApiResponse.success(res, { id: record.id }, 'Device token enregistré');
  } catch (error) {
    next(error);
  }
};

// Unregister a specific device token. Used on sign-out and when the user
// revokes notifications from the settings UI.
export const unregisterDeviceToken = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user!.id;
    const token = String(req.params.token || '');

    if (!token) {
      ApiResponse.error(res, 'Token requis.', 400);
      return;
    }

    // Scope the delete to the current user — a leaked token alone shouldn't
    // let someone else delete it from another account.
    await prisma.userDeviceToken.deleteMany({
      where: { userId, token },
    });

    ApiResponse.success(res, null, 'Device token supprimé');
  } catch (error) {
    next(error);
  }
};
