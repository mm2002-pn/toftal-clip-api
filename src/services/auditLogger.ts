import { Request } from 'express';
import { prisma } from '../config/database';
import { logger } from '../utils/logger';

export type AuditAction =
  | 'LOGIN'
  | 'LOGIN_FAILED'
  | 'LOGOUT'
  | 'REFRESH_FAILED'
  | 'REGISTER'
  | 'PROJECT_DELETE'
  | 'PROJECT_ARCHIVE'
  | 'PROJECT_UNARCHIVE'
  | 'PROJECT_TRANSFER'
  | 'PROJECT_STATUS_CHANGE'
  | 'USER_ROLE_CHANGE'
  | 'USER_SUSPEND'
  | 'USER_UNSUSPEND'
  | 'USER_RESTORE'
  | 'USER_DELETE'
  | 'DELIVERABLE_STATUS_CHANGE'
  | 'DELIVERABLE_DELETE'
  | 'VERSION_STATUS_CHANGE'
  | 'VERSION_DELETE'
  | 'INVITATION_CREATE'
  | 'INVITATION_REVOKE'
  | 'FEATURE_FLAG_CREATE'
  | 'FEATURE_FLAG_UPDATE'
  | 'FEATURE_FLAG_DELETE'
  | 'STORAGE_PURGE_VERSIONS'
  | 'STORAGE_PURGE_PROJECTS'
  | 'MEMBER_ADD'
  | 'MEMBER_UPDATE'
  | 'MEMBER_REMOVE'
  | 'EMAIL_TEMPLATE_UPDATE'
  | 'AI_PROMPT_UPDATE';

export type AuditTargetType =
  | 'project'
  | 'user'
  | 'deliverable'
  | 'version'
  | 'invitation'
  | 'feature_flag'
  | 'storage'
  | null;

interface AuditLogInput {
  userId: string;
  action: AuditAction | string;
  targetType?: AuditTargetType;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Best-effort audit logger. Fire-and-forget by default — failures are logged
 * but never thrown to the caller, so audit failures cannot break request flow.
 */
export const auditLog = (input: AuditLogInput): void => {
  prisma.auditLog
    .create({
      data: {
        userId: input.userId,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        metadata: (input.metadata as any) ?? undefined,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    })
    .catch((err) => {
      logger.warn(`[auditLog] failed to persist action=${input.action} userId=${input.userId}: ${err?.message ?? err}`);
    });
};

/**
 * Same as auditLog but extracts IP + User-Agent from an Express request.
 */
export const auditLogFromRequest = (
  req: Request,
  action: AuditAction | string,
  opts?: Omit<AuditLogInput, 'userId' | 'action' | 'ipAddress' | 'userAgent'> & { userId?: string }
): void => {
  const userId = opts?.userId ?? (req as any).user?.id;
  if (!userId) return;

  auditLog({
    userId,
    action,
    targetType: opts?.targetType,
    targetId: opts?.targetId,
    metadata: opts?.metadata,
    ipAddress: req.ip ?? (req.headers['x-forwarded-for'] as string) ?? null,
    userAgent: req.get('user-agent') ?? null,
  });
};
