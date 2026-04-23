import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';

const requireAdmin = (context: any): void => {
  if (!context?.user) throw new Error('Authentication required');
  if (context.user.role !== 'ADMIN') throw new Error('Admin access required');
};

const pageInfo = (page: number, limit: number, total: number) => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit) || 1,
  hasNext: page * limit < total,
  hasPrev: page > 1,
});

export const adminResolvers = {
  Query: {
    adminStats: async (_: any, __: any, context: any) => {
      requireAdmin(context);
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [
        userCount,
        projectCount,
        auditCount24h,
        betaSignupCount,
        featureFlagCount,
        pendingInvitationCount,
        versionSum,
        mediaSum,
      ] = await Promise.all([
        prisma.user.count({ where: { accountStatus: { not: 'DELETED' } } }),
        prisma.project.count({ where: { deletedAt: null } }),
        prisma.auditLog.count({ where: { createdAt: { gte: since } } }),
        prisma.betaSignup.count(),
        prisma.featureFlag.count(),
        prisma.projectInvitation.count({ where: { status: 'PENDING' } }),
        prisma.version.aggregate({ _sum: { fileSize: true } }),
        prisma.mediaResource.aggregate({ _sum: { fileSize: true } }),
      ]);
      const totalStorageBytes =
        (versionSum._sum.fileSize ?? BigInt(0)) + (mediaSum._sum.fileSize ?? BigInt(0));
      return {
        userCount,
        projectCount,
        auditCount24h,
        betaSignupCount,
        featureFlagCount,
        pendingInvitationCount,
        totalStorageBytes: totalStorageBytes.toString(),
      };
    },

    adminUsers: async (_: any, { filter, pagination }: any, context: any) => {
      requireAdmin(context);
      const page = Math.max(1, pagination?.page || 1);
      const limit = Math.min(100, Math.max(1, pagination?.limit || 20));
      const skip = (page - 1) * limit;

      const where: Prisma.UserWhereInput = {};
      if (filter?.search) {
        where.OR = [
          { email: { contains: filter.search, mode: 'insensitive' } },
          { name: { contains: filter.search, mode: 'insensitive' } },
        ];
      }
      if (filter?.role) where.role = filter.role;
      if (filter?.status) where.accountStatus = filter.status;

      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
          include: { _count: { select: { clientProjects: true } } },
        }),
        prisma.user.count({ where }),
      ]);

      return {
        data: users.map((u: any) => ({
          id: u.id,
          email: u.email,
          name: u.name,
          role: u.role,
          avatarUrl: u.avatarUrl,
          authProvider: u.authProvider,
          emailVerified: u.emailVerified,
          accountStatus: u.accountStatus,
          archivedAt: u.archivedAt,
          createdAt: u.createdAt,
          updatedAt: u.updatedAt,
          projectCount: u._count?.clientProjects ?? 0,
        })),
        pageInfo: pageInfo(page, limit, total),
      };
    },

    adminProjects: async (_: any, { filter, pagination }: any, context: any) => {
      requireAdmin(context);
      const page = Math.max(1, pagination?.page || 1);
      const limit = Math.min(100, Math.max(1, pagination?.limit || 20));
      const skip = (page - 1) * limit;

      const where: Prisma.ProjectWhereInput = {};
      if (filter?.includeDeleted !== true) where.deletedAt = null;
      if (filter?.includeArchived === false) where.isArchived = false;
      if (filter?.search) where.title = { contains: filter.search, mode: 'insensitive' };
      if (filter?.status) where.status = filter.status as any;
      if (filter?.ownerId) where.ownerId = filter.ownerId;

      const [projects, total] = await Promise.all([
        prisma.project.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
          include: {
            client: true,
            owner: true,
            _count: { select: { deliverables: true, members: true } },
          },
        }),
        prisma.project.count({ where }),
      ]);

      return {
        data: projects.map((p: any) => ({
          ...p,
          deliverableCount: p._count?.deliverables ?? 0,
          memberCount: p._count?.members ?? 0,
        })),
        pageInfo: pageInfo(page, limit, total),
      };
    },

    adminProject: async (_: any, { id }: { id: string }, context: any) => {
      requireAdmin(context);
      const project = await prisma.project.findUnique({
        where: { id },
        include: {
          client: true,
          owner: true,
          deliverables: {
            orderBy: { createdAt: 'asc' },
            include: {
              assignedTalent: true,
              versions: {
                orderBy: { versionNumber: 'desc' },
                include: {
                  uploadedBy: true,
                  _count: { select: { feedbacks: true } },
                },
              },
            },
          },
          members: {
            orderBy: { joinedAt: 'asc' },
            include: { user: true },
          },
          _count: { select: { members: true } },
        },
      });

      if (!project) return null;

      const normalizePermissions = (p: any) => ({
        view: !!p?.view,
        edit: !!p?.edit,
        comment: !!p?.comment,
        approve: !!p?.approve,
      });

      return {
        ...project,
        memberCount: (project as any)._count?.members ?? 0,
        members: project.members.map((m: any) => ({
          ...m,
          permissions: normalizePermissions(m.permissions),
        })),
        deliverables: project.deliverables.map((d: any) => ({
          ...d,
          versionCount: d.versions?.length ?? 0,
          versions: d.versions.map((v: any) => ({
            ...v,
            feedbackCount: v._count?.feedbacks ?? 0,
          })),
        })),
      };
    },

    // ============ FEATURE FLAGS ============
    adminFeatureFlags: async (_: any, __: any, context: any) => {
      requireAdmin(context);
      return prisma.featureFlag.findMany({ orderBy: { name: 'asc' } });
    },

    featureFlags: async (_: any, __: any, context: any) => {
      // Public (authenticated) — returns only name + enabled
      if (!context?.user) throw new Error('Authentication required');
      const flags = await prisma.featureFlag.findMany({
        select: { name: true, enabled: true },
      });
      return flags;
    },

    // ============ INVITATIONS ============
    adminInvitations: async (_: any, { filter, pagination }: any, context: any) => {
      requireAdmin(context);
      const page = Math.max(1, pagination?.page || 1);
      const limit = Math.min(100, Math.max(1, pagination?.limit || 20));
      const skip = (page - 1) * limit;

      const where: Prisma.ProjectInvitationWhereInput = {};
      if (filter?.status) where.status = filter.status;
      if (filter?.projectId) where.projectId = filter.projectId;
      if (filter?.inviterId) where.inviterUserId = filter.inviterId;
      if (filter?.email) where.email = { contains: filter.email, mode: 'insensitive' };

      const [data, total] = await Promise.all([
        prisma.projectInvitation.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
          include: { project: true, inviter: true },
        }),
        prisma.projectInvitation.count({ where }),
      ]);

      return { data, pageInfo: pageInfo(page, limit, total) };
    },

    // ============ STORAGE ============
    adminStorageStats: async (_: any, __: any, context: any) => {
      requireAdmin(context);
      const [vAgg, mAgg, vMissing, mMissing] = await Promise.all([
        prisma.version.aggregate({ _sum: { fileSize: true }, _count: true }),
        prisma.mediaResource.aggregate({ _sum: { fileSize: true }, _count: true }),
        prisma.version.count({ where: { fileSize: null } }),
        prisma.mediaResource.count({ where: { fileSize: null } }),
      ]);
      const versionBytes = vAgg._sum.fileSize ?? BigInt(0);
      const mediaBytes = mAgg._sum.fileSize ?? BigInt(0);
      return {
        totalBytes: (versionBytes + mediaBytes).toString(),
        versionBytes: versionBytes.toString(),
        mediaBytes: mediaBytes.toString(),
        versionCount: vAgg._count,
        mediaCount: mAgg._count,
        versionsMissingSize: vMissing,
        mediaMissingSize: mMissing,
      };
    },

    adminStorageByProject: async (_: any, { limit = 10 }: any, context: any) => {
      requireAdmin(context);
      const rows = await prisma.$queryRaw<
        Array<{ project_id: string; title: string; bytes: bigint | null; count: bigint }>
      >`
        SELECT
          p.id AS project_id,
          p.title AS title,
          COALESCE(SUM(v.file_size), 0) + COALESCE(SUM(mr.file_size), 0) AS bytes,
          COUNT(DISTINCT v.id) + COUNT(DISTINCT mr.id) AS count
        FROM projects p
        LEFT JOIN deliverables d ON d.project_id = p.id
        LEFT JOIN versions v ON v.deliverable_id = d.id
        LEFT JOIN media_resources mr ON mr.project_id = p.id
        WHERE p.deleted_at IS NULL
        GROUP BY p.id, p.title
        HAVING COALESCE(SUM(v.file_size), 0) + COALESCE(SUM(mr.file_size), 0) > 0
        ORDER BY bytes DESC
        LIMIT ${limit}
      `;
      return rows.map((r) => ({
        entityId: r.project_id,
        entityName: r.title,
        entityEmail: null,
        bytes: (r.bytes ?? BigInt(0)).toString(),
        count: Number(r.count),
      }));
    },

    adminStorageByUser: async (_: any, { limit = 10 }: any, context: any) => {
      requireAdmin(context);
      const rows = await prisma.$queryRaw<
        Array<{ user_id: string; name: string; email: string; bytes: bigint | null; count: bigint }>
      >`
        SELECT
          u.id AS user_id,
          u.name AS name,
          u.email AS email,
          COALESCE(SUM(v.file_size), 0) AS bytes,
          COUNT(v.id) AS count
        FROM users u
        LEFT JOIN versions v ON v.uploaded_by_id = u.id
        GROUP BY u.id, u.name, u.email
        HAVING COALESCE(SUM(v.file_size), 0) > 0
        ORDER BY bytes DESC
        LIMIT ${limit}
      `;
      return rows.map((r) => ({
        entityId: r.user_id,
        entityName: r.name,
        entityEmail: r.email,
        bytes: (r.bytes ?? BigInt(0)).toString(),
        count: Number(r.count),
      }));
    },

    // ============ METRICS ============
    adminKPIs: async (_: any, __: any, context: any) => {
      requireAdmin(context);
      const now = new Date();
      const d1 = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

      const [dauRows, mauRows, signups7d, signups30d, projectsToday, projects7d, feedbacks7d, activeProjects] =
        await Promise.all([
          prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(DISTINCT user_id)::bigint AS count FROM audit_logs WHERE action = 'LOGIN' AND created_at >= ${d1}`,
          prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(DISTINCT user_id)::bigint AS count FROM audit_logs WHERE action = 'LOGIN' AND created_at >= ${d30}`,
          prisma.user.count({ where: { createdAt: { gte: d7 } } }),
          prisma.user.count({ where: { createdAt: { gte: d30 } } }),
          prisma.project.count({ where: { createdAt: { gte: startOfDay }, deletedAt: null } }),
          prisma.project.count({ where: { createdAt: { gte: d7 }, deletedAt: null } }),
          prisma.feedback.count({ where: { createdAt: { gte: d7 } } }),
          prisma.project.count({
            where: { deletedAt: null, isArchived: false, status: { in: ['IN_PROGRESS', 'REVIEW'] } },
          }),
        ]);

      return {
        dau: Number(dauRows[0]?.count ?? 0),
        mau: Number(mauRows[0]?.count ?? 0),
        signups7d,
        signups30d,
        projectsToday,
        projects7d,
        feedbacks7d,
        activeProjects,
      };
    },

    adminTimeSeries: async (_: any, { metric, period }: any, context: any) => {
      requireAdmin(context);
      const days = period === 'last7d' ? 7 : period === 'last90d' ? 90 : 30;
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      type Row = { date: string; value: number };

      switch (metric) {
        case 'signups':
          return prisma.$queryRaw<Row[]>`
            SELECT DATE(created_at AT TIME ZONE 'UTC')::text AS date,
                   COUNT(*)::int AS value
            FROM users
            WHERE created_at >= ${since}
            GROUP BY DATE(created_at AT TIME ZONE 'UTC')
            ORDER BY date ASC
          `;
        case 'projects':
          return prisma.$queryRaw<Row[]>`
            SELECT DATE(created_at AT TIME ZONE 'UTC')::text AS date,
                   COUNT(*)::int AS value
            FROM projects
            WHERE created_at >= ${since} AND deleted_at IS NULL
            GROUP BY DATE(created_at AT TIME ZONE 'UTC')
            ORDER BY date ASC
          `;
        case 'feedbacks':
          return prisma.$queryRaw<Row[]>`
            SELECT DATE(created_at AT TIME ZONE 'UTC')::text AS date,
                   COUNT(*)::int AS value
            FROM feedbacks
            WHERE created_at >= ${since}
            GROUP BY DATE(created_at AT TIME ZONE 'UTC')
            ORDER BY date ASC
          `;
        case 'logins':
          return prisma.$queryRaw<Row[]>`
            SELECT DATE(created_at AT TIME ZONE 'UTC')::text AS date,
                   COUNT(*)::int AS value
            FROM audit_logs
            WHERE action = 'LOGIN' AND created_at >= ${since}
            GROUP BY DATE(created_at AT TIME ZONE 'UTC')
            ORDER BY date ASC
          `;
        case 'dau':
          return prisma.$queryRaw<Row[]>`
            SELECT DATE(created_at AT TIME ZONE 'UTC')::text AS date,
                   COUNT(DISTINCT user_id)::int AS value
            FROM audit_logs
            WHERE action = 'LOGIN' AND created_at >= ${since}
            GROUP BY DATE(created_at AT TIME ZONE 'UTC')
            ORDER BY date ASC
          `;
        default:
          throw new Error(`Unknown metric: ${metric}`);
      }
    },

    adminTopUsers: async (_: any, { metric, period, limit }: any, context: any) => {
      requireAdmin(context);
      const days = period === 'last7d' ? 7 : period === 'last90d' ? 90 : 30;
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const take = Math.min(50, Math.max(1, limit ?? 10));

      let rows: Array<{ user_id: string; name: string; email: string; avatar_url: string | null; value: number }> = [];

      if (metric === 'feedbacks') {
        rows = await prisma.$queryRaw`
          SELECT u.id AS user_id, u.name AS name, u.email AS email, u.avatar_url AS avatar_url,
                 COUNT(f.id)::int AS value
          FROM users u
          INNER JOIN feedbacks f ON f.author_id = u.id
          WHERE f.created_at >= ${since}
          GROUP BY u.id, u.name, u.email, u.avatar_url
          ORDER BY value DESC
          LIMIT ${take}
        `;
      } else if (metric === 'projects') {
        rows = await prisma.$queryRaw`
          SELECT u.id AS user_id, u.name AS name, u.email AS email, u.avatar_url AS avatar_url,
                 COUNT(p.id)::int AS value
          FROM users u
          INNER JOIN projects p ON p.client_id = u.id
          WHERE p.created_at >= ${since} AND p.deleted_at IS NULL
          GROUP BY u.id, u.name, u.email, u.avatar_url
          ORDER BY value DESC
          LIMIT ${take}
        `;
      } else if (metric === 'logins' || metric === 'dau') {
        rows = await prisma.$queryRaw`
          SELECT u.id AS user_id, u.name AS name, u.email AS email, u.avatar_url AS avatar_url,
                 COUNT(a.id)::int AS value
          FROM users u
          INNER JOIN audit_logs a ON a.user_id = u.id
          WHERE a.action = 'LOGIN' AND a.created_at >= ${since}
          GROUP BY u.id, u.name, u.email, u.avatar_url
          ORDER BY value DESC
          LIMIT ${take}
        `;
      } else {
        // signups — not a "top users" metric
        return [];
      }

      return rows.map((r) => ({
        userId: r.user_id,
        name: r.name,
        email: r.email,
        avatarUrl: r.avatar_url,
        value: r.value,
      }));
    },

    adminAuditLogs: async (_: any, { filter, pagination }: any, context: any) => {
      requireAdmin(context);
      const page = Math.max(1, pagination?.page || 1);
      const limit = Math.min(100, Math.max(1, pagination?.limit || 20));
      const skip = (page - 1) * limit;

      const where: Prisma.AuditLogWhereInput = {};
      if (filter?.userId) where.userId = filter.userId;
      if (filter?.action) where.action = filter.action;
      if (filter?.targetType) where.targetType = filter.targetType;
      if (filter?.from || filter?.to) {
        where.createdAt = {};
        if (filter.from) where.createdAt.gte = new Date(filter.from);
        if (filter.to) where.createdAt.lte = new Date(filter.to);
      }

      const [logs, total] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
          include: { user: { select: { id: true, email: true, name: true, avatarUrl: true } } },
        }),
        prisma.auditLog.count({ where }),
      ]);

      return {
        data: logs,
        pageInfo: pageInfo(page, limit, total),
      };
    },
  },
};
