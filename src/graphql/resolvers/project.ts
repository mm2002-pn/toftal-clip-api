import { prisma } from '../../config/database';

export const projectResolvers = {
  Query: {
    project: async (_: any, { id }: { id: string }) => {
      return prisma.project.findUnique({
        where: { id },
        include: {
          client: true,
          talent: true,
          deliverables: true,
        },
      });
    },
    projects: async (_: any, { filter, sort, pagination }: any) => {
      const page = pagination?.page || 1;
      const limit = pagination?.limit || 10;
      const skip = (page - 1) * limit;

      const where: any = {};
      if (filter?.status) where.status = filter.status;
      if (filter?.clientId) where.clientId = filter.clientId;
      if (filter?.talentId) where.talentId = filter.talentId;
      if (filter?.search) {
        where.title = { contains: filter.search, mode: 'insensitive' };
      }

      const orderBy: any = {};
      if (sort?.field) {
        orderBy[sort.field] = sort.order?.toLowerCase() || 'desc';
      } else {
        orderBy.createdAt = 'desc';
      }

      const [data, total] = await Promise.all([
        prisma.project.findMany({
          where,
          skip,
          take: limit,
          orderBy,
          include: {
            client: true,
            talent: true,
            deliverables: true,
          },
        }),
        prisma.project.count({ where }),
      ]);

      return {
        data,
        pageInfo: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasNext: page * limit < total,
          hasPrev: page > 1,
        },
      };
    },
    myProjects: async (_: any, { filter, pagination }: any, context: any) => {
      if (!context.user) throw new Error('Authentication required');

      const page = pagination?.page || 1;
      const limit = pagination?.limit || 10;
      const skip = (page - 1) * limit;

      const where: any = {
        OR: [
          { clientId: context.user.id },
          { talentId: context.user.id },
        ],
      };

      if (filter?.status) where.status = filter.status;

      const [data, total] = await Promise.all([
        prisma.project.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            client: true,
            talent: true,
            deliverables: true,
          },
        }),
        prisma.project.count({ where }),
      ]);

      return {
        data,
        pageInfo: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasNext: page * limit < total,
          hasPrev: page > 1,
        },
      };
    },
  },
  Project: {
    client: (parent: any) => prisma.user.findUnique({ where: { id: parent.clientId } }),
    talent: (parent: any) => parent.talentId ? prisma.user.findUnique({ where: { id: parent.talentId } }) : null,
    deliverables: (parent: any) => prisma.deliverable.findMany({ where: { projectId: parent.id } }),
  },
};
