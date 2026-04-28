import { firebaseAdmin } from '../config/firebase';
import { prisma } from '../config/database';
import { logger } from '../utils/logger';

// Payload mirrors what the in-app notification carries (see prisma.notification
// model). The push path piggybacks on the same data — title/body/link — so the
// FCM display matches the bell-icon entry.
export interface PushPayload {
  title: string;
  body?: string;
  link?: string;
  // Arbitrary tag used by the service worker to coalesce repeated notifs
  // (e.g. successive feedbacks on the same deliverable replace each other
  // instead of stacking).
  tag?: string;
  // Echoed back so the client can match a push to an existing in-app entry
  // and skip the toast if the tab is already showing it.
  notificationId?: string;
}

// Send a push notification to every active device of a user.
// Fire-and-forget from the caller's POV — we never let a push failure leak
// out to break the in-app notification path. Stale tokens (expired / unregis-
// tered devices) are pruned on the spot to keep the table from growing.
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  console.log(`[PUSH] sendPushToUser called userId=${userId} title="${payload.title}"`);
  try {
    const tokens = await prisma.userDeviceToken.findMany({
      where: { userId },
      select: { token: true },
    });

    console.log(`[PUSH] Found ${tokens.length} device token(s) for user ${userId}`);

    if (tokens.length === 0) {
      console.log(`[PUSH] No tokens — user has not registered any device. Skipping.`);
      return;
    }

    const tokenList = tokens.map((t) => t.token);

    // Data-only payload: when the FCM message has a top-level `notification`
    // field, the SDK auto-displays the notification using its OWN renderer
    // and shadows our service worker's onBackgroundMessage. By keeping
    // everything in `data`, we force every push to go through the SW so the
    // icon/body/link customisation we coded actually takes effect.
    const message = {
      tokens: tokenList,
      data: {
        title: payload.title,
        body: payload.body || '',
        link: payload.link || '/',
        tag: payload.tag || `toftal-${Date.now()}`,
        notificationId: payload.notificationId || '',
      },
    };

    console.log(`[PUSH] Calling FCM sendEachForMulticast with ${tokenList.length} token(s)`);
    const response = await firebaseAdmin.messaging().sendEachForMulticast(message);
    console.log(
      `[PUSH] FCM response: success=${response.successCount} failure=${response.failureCount}`
    );

    // Identify dead tokens so we can drop them. Two error codes mean the
    // token is permanently invalid:
    // - messaging/registration-token-not-registered (user uninstalled / SW
    //   was unregistered)
    // - messaging/invalid-registration-token (malformed)
    // Anything else (rate-limit, transient) we leave alone for the next try.
    const deadTokens: string[] = [];
    response.responses.forEach((res, idx) => {
      if (!res.success && res.error) {
        const code = res.error.code;
        console.error(
          `[PUSH] Token ${tokenList[idx].slice(0, 12)}… failed: code=${code} msg=${res.error.message}`
        );
        if (
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token' ||
          code === 'messaging/invalid-argument'
        ) {
          deadTokens.push(tokenList[idx]);
        } else {
          logger.warn(
            `[push] FCM error for token ${tokenList[idx].slice(0, 12)}…: ${code}`
          );
        }
      } else if (res.success) {
        console.log(
          `[PUSH] Token ${tokenList[idx].slice(0, 12)}… delivered (messageId=${res.messageId})`
        );
      }
    });

    if (deadTokens.length > 0) {
      await prisma.userDeviceToken.deleteMany({
        where: { token: { in: deadTokens } },
      });
      logger.info(`[push] Pruned ${deadTokens.length} dead device token(s)`);
    }

    if (response.successCount > 0) {
      // Bump lastSeenAt on the tokens that actually delivered — useful for
      // diagnosing "user says they don't get notifs" later (shows whether the
      // server even thinks the device is reachable).
      const liveTokens = tokenList.filter((t) => !deadTokens.includes(t));
      if (liveTokens.length > 0) {
        await prisma.userDeviceToken.updateMany({
          where: { token: { in: liveTokens } },
          data: { lastSeenAt: new Date() },
        });
      }
    }

    logger.debug(
      `[push] user=${userId} sent=${response.successCount}/${tokens.length} dead=${deadTokens.length}`
    );
  } catch (error) {
    // Never let a push failure escape — the caller already wrote the in-app
    // notification, so the user is not actually missing anything if FCM is
    // down. Log and move on.
    console.error('[PUSH] sendPushToUser threw:', error);
    logger.error('[push] sendPushToUser failed:', error);
  }
}

export default { sendPushToUser };
