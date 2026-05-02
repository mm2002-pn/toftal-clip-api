import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import IORedis from 'ioredis';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { logger } from '../utils/logger';
import { prisma } from '../config/database';
import { sendPushToUser } from './pushNotificationService';

// Socket.io event types
export type SocketEvent =
  | 'notification:new'
  | 'version:new'
  | 'version:status'
  | 'version:deleted'
  | 'feedback:new'
  | 'feedback:updated'
  | 'feedback:resolved'
  | 'mention:new'
  | 'project:new'
  | 'project:updated'
  | 'project:status'
  | 'project:archived'
  | 'project:restored'
  | 'project:brief-completed'
  | 'project:member:added'
  | 'project:member:removed'
  | 'project:member:role-updated'
  | 'org:member:removed'
  | 'org:member:joined'
  | 'deliverable:status'
  | 'deliverable:assigned'
  | 'deliverable:assignment:accepted'
  | 'deliverable:assignment:rejected'
  | 'deliverable:created'
  | 'deliverable:deleted'
  | 'media:added'
  | 'access-request:new'
  | 'access-request:approved'
  | 'access-request:rejected'
  | 'typing:user'
  | 'typing:stopped'
  | 'feedback:read'
  | 'feedback:reaction'
  | 'version:thumbnail';

// Payload types for each event
export interface NotificationPayload {
  id: string;
  type: string;
  title: string;
  message: string;
  link?: string;
  createdAt: Date;
}

export interface VersionPayload {
  id: string;
  versionNumber: number;
  status: string;
  deliverableId: string;
  projectId: string;
}

export interface VersionDeletedPayload {
  id: string;
  versionNumber: number;
  deliverableId: string;
  projectId: string;
}

export interface FeedbackPayload {
  id: string;
  versionId: string;
  authorId: string;
  authorName: string;
  type: string;
  projectId: string;
}

export interface ProjectNewPayload {
  id: string;
  title: string;
  clientId: string;
  talentId?: string | null;
  organizationId?: string | null;
}

export interface ProjectUpdatedPayload {
  id: string;
  title?: string;
  status?: string;
  talentId?: string;
}

export interface ProjectStatusPayload {
  id: string;
  status: string;
}

export interface DeliverableStatusPayload {
  id: string;
  status: string;
  projectId: string;
}

export interface DeliverableAssignedPayload {
  id: string;
  projectId: string;
  assignedTalentId: string | null;
  assignedTalent?: {
    id: string;
    name: string;
    avatarUrl?: string;
  };
}

export interface DeliverableCreatedPayload {
  id: string;
  projectId: string;
  title: string;
  type?: string;
}

export interface DeliverableDeletedPayload {
  id: string;
  projectId: string;
}

export interface MediaAddedPayload {
  id: string;
  projectId: string;
  deliverableId?: string;
  name: string;
  url: string;
  type: string;
  category?: string;
}

// Project member events
export interface ProjectMemberAddedPayload {
  projectId: string;
  userId: string;
  userName: string;
  userEmail: string;
  role: string;
  addedBy: string;
  addedByName?: string;
}

export interface ProjectMemberRemovedPayload {
  projectId: string;
  userId: string;
  userName: string;
  removedBy: string;
  removedByName?: string;
}

// Access request events
export interface AccessRequestPayload {
  id: string;
  projectId: string;
  userId: string;
  userName: string;
  userEmail: string;
  message?: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  respondedBy?: string;
  respondedByName?: string;
  respondedAt?: string;
}

// Mention notification payload
export interface MentionPayload {
  id: string;
  type: string;
  title: string;
  message: string;
  link?: string;
  authorName: string;
  feedbackId: string;
  deliverableTitle: string;
  projectId: string;
  playSound: boolean;
}

// JWT payload interface (matches auth service token structure)
interface JwtPayload {
  id: string;
  email: string;
  role: string;
  talentModeEnabled: boolean;
}

// Extended socket with user data
interface AuthenticatedSocket extends Socket {
  userId?: string;
}

class SocketService {
  private io: Server | null = null;
  private userSockets: Map<string, Set<string>> = new Map(); // userId -> Set of socketIds

  initialize(httpServer: HttpServer): Server {
    this.io = new Server(httpServer, {
      cors: {
        origin: config.corsOrigin,
        methods: ['GET', 'POST'],
        credentials: true,
      },
      transports: ['websocket', 'polling'],
    });

    // Redis adapter — required on Cloud Run (multi-instance) so rooms and
    // broadcasts are shared across every container. Without it, clients on
    // different instances (e.g. Chrome on Instance A, Mobile on Instance B)
    // silently miss each other's events. Expects REDIS_TCP_URL in the form
    // rediss://default:<token>@<host>:<port> (Upstash TCP endpoint).
    const redisUrl = process.env.REDIS_TCP_URL;
    if (redisUrl) {
      try {
        const pub = new IORedis(redisUrl, { lazyConnect: false, maxRetriesPerRequest: null });
        const sub = pub.duplicate();
        pub.on('error', (err) => logger.error(`Redis pub error: ${err.message}`));
        sub.on('error', (err) => logger.error(`Redis sub error: ${err.message}`));
        this.io.adapter(createAdapter(pub, sub));
        logger.info('Socket.io: Redis adapter enabled for multi-instance broadcast');
      } catch (err) {
        logger.error(`Socket.io: failed to enable Redis adapter: ${(err as Error).message}`);
      }
    } else {
      logger.warn('Socket.io: REDIS_TCP_URL not set — running with in-memory adapter. Cross-instance events WILL be lost on multi-replica deploys.');
    }

    // Authentication middleware
    this.io.use(async (socket: AuthenticatedSocket, next) => {
      try {
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');

        if (!token) {
          return next(new Error('Authentication required'));
        }

        const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;
        socket.userId = decoded.id;
        next();
      } catch (error) {
        logger.error('Socket authentication failed:', error);
        next(new Error('Invalid token'));
      }
    });

    // Connection handler
    this.io.on('connection', (socket: AuthenticatedSocket) => {
      const userId = socket.userId;

      if (!userId) {
        socket.disconnect();
        return;
      }

      console.log(`[SOCKET] New connection - Socket ID: ${socket.id}, User ID: ${userId}`);
      logger.info(`Socket connected: ${socket.id} for user: ${userId}`);

      // Track user's sockets
      if (!this.userSockets.has(userId)) {
        this.userSockets.set(userId, new Set());
      }
      this.userSockets.get(userId)!.add(socket.id);

      // Join user's personal room
      socket.join(`user:${userId}`);
      console.log(`[SOCKET] Socket ${socket.id} joined personal room: user:${userId}`);

      // Auto-join every project room the user belongs to. Without this, events
      // emitted to `project:{id}` (member added/removed, status changes, etc.)
      // would only reach clients that have visited that project's workspace
      // this session — so the /projects list would stay stale until manual
      // refresh. Fire-and-forget: client-side `join:project` below is the
      // fallback if this DB lookup fails.
      prisma.project
        .findMany({
          where: {
            OR: [
              { ownerId: userId },
              { members: { some: { userId } } },
            ],
            deletedAt: null,
          },
          select: { id: true },
        })
        .then((rows) => {
          rows.forEach((p) => socket.join(`project:${p.id}`));
          logger.debug(
            `[SOCKET] auto-joined ${rows.length} project rooms for user ${userId}`
          );
        })
        .catch((err) => {
          logger.warn(
            `[SOCKET] auto-join project rooms failed for user ${userId}: ${
              (err as Error)?.message ?? err
            }`
          );
        });

      // Same idea for organisation (team) rooms — emits like `project:new` for
      // a project created in a team workspace go to `org:{id}` so every team
      // member's project list refreshes without a page reload. Without this
      // auto-join, a freshly-loaded tab wouldn't be in the room until the user
      // manually navigated into the team scope.
      prisma.organizationMember
        .findMany({
          where: { userId, status: 'ACTIVE' },
          select: { organizationId: true },
        })
        .then((rows) => {
          rows.forEach((m) => socket.join(`org:${m.organizationId}`));
          logger.debug(
            `[SOCKET] auto-joined ${rows.length} org rooms for user ${userId}`
          );
        })
        .catch((err) => {
          logger.warn(
            `[SOCKET] auto-join org rooms failed for user ${userId}: ${
              (err as Error)?.message ?? err
            }`
          );
        });

      // Handle joining project rooms (idempotent — client still emits this
      // from useProjectRoom for projects created/joined during the session).
      socket.on('join:project', (projectId: string) => {
        socket.join(`project:${projectId}`);
        console.log(`[SOCKET] Socket ${socket.id} (user: ${userId}) joined project:${projectId}`);
        logger.debug(`Socket ${socket.id} joined project:${projectId}`);
      });

      // Handle leaving project rooms
      socket.on('leave:project', (projectId: string) => {
        socket.leave(`project:${projectId}`);
        logger.debug(`Socket ${socket.id} left project:${projectId}`);
      });

      // Handle joining deliverable rooms (for typing indicators, etc.)
      socket.on('join:deliverable', (deliverableId: string) => {
        socket.join(`deliverable:${deliverableId}`);
        logger.debug(`Socket ${socket.id} joined deliverable:${deliverableId}`);
      });

      // Handle leaving deliverable rooms
      socket.on('leave:deliverable', (deliverableId: string) => {
        socket.leave(`deliverable:${deliverableId}`);
        // Notify others that this user stopped typing (cleanup)
        socket.to(`deliverable:${deliverableId}`).emit('typing:stopped', {
          userId,
          deliverableId,
        });
        logger.debug(`Socket ${socket.id} left deliverable:${deliverableId}`);
      });

      // Typing indicator - user started typing (text) or recording (voice)
      socket.on(
        'typing:start',
        (payload: {
          deliverableId: string;
          userName: string;
          avatarUrl?: string;
          mode?: 'text' | 'voice';
        }) => {
          if (!payload?.deliverableId || !payload?.userName) return;
          socket.to(`deliverable:${payload.deliverableId}`).emit('typing:user', {
            userId,
            userName: payload.userName,
            avatarUrl: payload.avatarUrl,
            deliverableId: payload.deliverableId,
            mode: payload.mode === 'voice' ? 'voice' : 'text',
          });
        }
      );

      // Typing indicator - user stopped typing
      socket.on('typing:stop', (payload: { deliverableId: string }) => {
        if (!payload?.deliverableId) return;
        socket.to(`deliverable:${payload.deliverableId}`).emit('typing:stopped', {
          userId,
          deliverableId: payload.deliverableId,
        });
      });

      // Handle disconnection
      socket.on('disconnect', () => {
        logger.info(`Socket disconnected: ${socket.id}`);
        const userSocketSet = this.userSockets.get(userId);
        if (userSocketSet) {
          userSocketSet.delete(socket.id);
          if (userSocketSet.size === 0) {
            this.userSockets.delete(userId);
          }
        }
      });
    });

    logger.info('Socket.io initialized');
    return this.io;
  }

  // Emit to a specific user (all their connected sockets)
  emitToUser<T>(userId: string, event: SocketEvent, data: T): void {
    if (!this.io) {
      logger.warn('Socket.io not initialized');
      return;
    }

    const isConnected = this.isUserConnected(userId);
    console.log(`[SOCKET EMIT] Emitting ${event} to user:${userId} (connected: ${isConnected})`, data);
    this.io.to(`user:${userId}`).emit(event, data);
    logger.debug(`Emitted ${event} to user:${userId}`);

    // Mirror new notifications to FCM so users get OS-level pushes even when
    // the tab is closed. We piggyback on the existing socket emit point so
    // every controller that creates a notification automatically triggers a
    // push — no need to touch all 20+ callsites. Fire-and-forget; failures
    // are swallowed inside sendPushToUser.
    if (event === 'notification:new' && data && typeof data === 'object') {
      const n = data as any;
      console.log(`[PUSH-HOOK] notification:new intercepted for user ${userId}, firing push`);
      void sendPushToUser(userId, {
        title: n.title || 'Toftal Clip',
        body: n.message || undefined,
        link: n.link || '/',
        tag: n.type ? `notif-${n.type}` : undefined,
        notificationId: n.id || undefined,
      });
    }
  }

  // Emit to all users in a project
  emitToProject<T>(projectId: string, event: SocketEvent, data: T): void {
    if (!this.io) {
      logger.warn('Socket.io not initialized');
      return;
    }

    // Get all sockets in the project room
    const roomSockets = this.io.sockets.adapter.rooms.get(`project:${projectId}`);
    const socketCount = roomSockets?.size || 0;
    console.log(`[SOCKET EMIT] Emitting ${event} to project:${projectId} (${socketCount} sockets in room)`, data);
    this.io.to(`project:${projectId}`).emit(event, data);
    logger.debug(`Emitted ${event} to project:${projectId}`);
  }

  // Emit to every connected member of an organisation. Mirrors emitToProject
  // but for team-wide events (new project in a team workspace, member joined,
  // etc.). Relies on auto-join in the connection handler + addUserToOrgRoom
  // for users that join an org mid-session.
  emitToOrg<T>(organizationId: string, event: SocketEvent, data: T): void {
    if (!this.io) {
      logger.warn('Socket.io not initialized');
      return;
    }
    const roomSockets = this.io.sockets.adapter.rooms.get(`org:${organizationId}`);
    const socketCount = roomSockets?.size || 0;
    console.log(`[SOCKET EMIT] Emitting ${event} to org:${organizationId} (${socketCount} sockets in room)`, data);
    this.io.to(`org:${organizationId}`).emit(event, data);
    logger.debug(`Emitted ${event} to org:${organizationId}`);
  }

  // Same idea as addUserToProjectRoom but for org rooms — used when a user
  // accepts a team invitation: their already-open tabs must start receiving
  // team-wide events immediately, without forcing a reconnect.
  addUserToOrgRoom(userId: string, organizationId: string): void {
    if (!this.io) return;
    const socketIds = this.userSockets.get(userId);
    if (!socketIds || socketIds.size === 0) return;
    socketIds.forEach((sid) => {
      this.io!.sockets.sockets.get(sid)?.join(`org:${organizationId}`);
    });
    logger.debug(
      `[SOCKET] added user ${userId} (${socketIds.size} sockets) to org:${organizationId}`
    );
  }

  // Symmetric — when a user is removed from a team, their tabs must stop
  // hearing that org's events (otherwise they'd see new projects appear in a
  // team they no longer belong to until the next reload).
  removeUserFromOrgRoom(userId: string, organizationId: string): void {
    if (!this.io) return;
    const socketIds = this.userSockets.get(userId);
    if (!socketIds || socketIds.size === 0) return;
    socketIds.forEach((sid) => {
      this.io!.sockets.sockets.get(sid)?.leave(`org:${organizationId}`);
    });
    logger.debug(
      `[SOCKET] removed user ${userId} (${socketIds.size} sockets) from org:${organizationId}`
    );
  }

  // Make every currently-connected socket of `userId` join the project room.
  // Used when a user is added to a project mid-session — their existing tabs
  // must start receiving project-scoped events without reconnecting. Safe to
  // call when the user isn't connected (no-op).
  addUserToProjectRoom(userId: string, projectId: string): void {
    if (!this.io) return;
    const socketIds = this.userSockets.get(userId);
    if (!socketIds || socketIds.size === 0) return;
    socketIds.forEach((sid) => {
      this.io!.sockets.sockets.get(sid)?.join(`project:${projectId}`);
    });
    logger.debug(
      `[SOCKET] added user ${userId} (${socketIds.size} sockets) to project:${projectId}`
    );
  }

  // Symmetric with addUserToProjectRoom — called when a user is removed from a
  // project so their tabs stop receiving that project's events.
  removeUserFromProjectRoom(userId: string, projectId: string): void {
    if (!this.io) return;
    const socketIds = this.userSockets.get(userId);
    if (!socketIds || socketIds.size === 0) return;
    socketIds.forEach((sid) => {
      this.io!.sockets.sockets.get(sid)?.leave(`project:${projectId}`);
    });
    logger.debug(
      `[SOCKET] removed user ${userId} (${socketIds.size} sockets) from project:${projectId}`
    );
  }

  // Emit to multiple users
  emitToUsers<T>(userIds: string[], event: SocketEvent, data: T): void {
    userIds.forEach((userId) => {
      this.emitToUser(userId, event, data);
    });
  }

  // Emit to all users in a deliverable room (used for typing, read receipts)
  emitToDeliverable<T>(deliverableId: string, event: SocketEvent, data: T): void {
    if (!this.io) {
      logger.warn('Socket.io not initialized');
      return;
    }
    this.io.to(`deliverable:${deliverableId}`).emit(event, data);
  }

  // Check if a user is connected
  isUserConnected(userId: string): boolean {
    return this.userSockets.has(userId) && this.userSockets.get(userId)!.size > 0;
  }

  // Get the Socket.io server instance
  getIO(): Server | null {
    return this.io;
  }
}

// Export singleton instance
export const socketService = new SocketService();
