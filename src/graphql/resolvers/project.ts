import { prisma } from '../../config/database';

export const projectResolvers = {
  Query: {
    project: async (_: any, { id }: { id: string }, context: any) => {
      const project = await prisma.project.findUnique({
        where: { id },
        include: {
          client: true,
          talent: true,
          deliverables: true,
        },
      });

      // Attach user to project for use in field resolvers
      if (project && context.user) {
        (project as any)._contextUser = context.user;
      }

      return project;
    },
    projects: async (_: any, { filter, sort, pagination }: any, context: any) => {
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

      // Attach user context to each project for deliverables filtering
      if (context.user) {
        data.forEach((project: any) => {
          project._contextUser = context.user;
        });
      }

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

      let where: any = {};

      // Filter projects based on user role
      if (context.user.role === 'CLIENT') {
        // Clients see only their own projects
        where.clientId = context.user.id;
      } else if (context.user.role === 'TALENT') {
        // Talents see projects where they are assigned (as main talent or to any deliverable)
        where.OR = [
          { talentId: context.user.id },
          { deliverables: { some: { assignedTalentId: context.user.id } } },
        ];
      } else {
        // ADMIN sees all - or use original OR logic
        where.OR = [
          { clientId: context.user.id },
          { talentId: context.user.id },
        ];
      }

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

      // Attach user context to each project for deliverables filtering
      data.forEach((project: any) => {
        project._contextUser = context.user;
      });

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
    deliverables: async (parent: any) => {
      const user = parent._contextUser;

      // If no user context or user is ADMIN/CLIENT, return all deliverables
      if (!user || user.role === 'ADMIN' || user.role === 'CLIENT') {
        return prisma.deliverable.findMany({ where: { projectId: parent.id } });
      }

      // For TALENT: only return deliverables assigned to them
      // Either as project's main talent or specifically assigned to the deliverable
      if (user.role === 'TALENT') {
        return prisma.deliverable.findMany({
          where: {
            projectId: parent.id,
            OR: [
              { assignedTalentId: user.id },
              // If talent is the project's main talent, show unassigned deliverables too
              ...(parent.talentId === user.id ? [{ assignedTalentId: null }] : []),
            ],
          },
        });
      }

      return prisma.deliverable.findMany({ where: { projectId: parent.id } });
    },
  },
};
