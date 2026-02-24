import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { logger } from '../utils/logger';

// Socket.io event types
export type SocketEvent =
  | 'notification:new'
  | 'version:new'
  | 'version:status'
  | 'feedback:new'
  | 'project:new'
  | 'project:updated'
  | 'project:status'
  | 'deliverable:status';

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
  talentId?: string;
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

// JWT payload interface (matches auth service token structure)
interface JwtPayload {
  id: string;
  email: string;
  role: string;
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

      logger.info(`Socket connected: ${socket.id} for user: ${userId}`);

      // Track user's sockets
      if (!this.userSockets.has(userId)) {
        this.userSockets.set(userId, new Set());
      }
      this.userSockets.get(userId)!.add(socket.id);

      // Join user's personal room
      socket.join(`user:${userId}`);

      // Handle joining project rooms
      socket.on('join:project', (projectId: string) => {
        socket.join(`project:${projectId}`);
        logger.debug(`Socket ${socket.id} joined project:${projectId}`);
      });

      // Handle leaving project rooms
      socket.on('leave:project', (projectId: string) => {
        socket.leave(`project:${projectId}`);
        logger.debug(`Socket ${socket.id} left project:${projectId}`);
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

    this.io.to(`user:${userId}`).emit(event, data);
    logger.debug(`Emitted ${event} to user:${userId}`);
  }

  // Emit to all users in a project
  emitToProject<T>(projectId: string, event: SocketEvent, data: T): void {
    if (!this.io) {
      logger.warn('Socket.io not initialized');
      return;
    }

    this.io.to(`project:${projectId}`).emit(event, data);
    logger.debug(`Emitted ${event} to project:${projectId}`);
  }

  // Emit to multiple users
  emitToUsers<T>(userIds: string[], event: SocketEvent, data: T): void {
    userIds.forEach((userId) => {
      this.emitToUser(userId, event, data);
    });
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
