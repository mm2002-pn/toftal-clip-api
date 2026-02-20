import { prisma } from '../../config/database';

export const opportunityResolvers = {
  Query: {
    opportunity: async (_: any, { id }: { id: string }) => {
      return prisma.opportunity.findUnique({
        where: { id },
        include: { client: true },
      });
    },
    opportunities: async (_: any, { filter, pagination }: any) => {
      const page = pagination?.page || 1;
      const limit = pagination?.limit || 10;
      const skip = (page - 1) * limit;

      const where: any = {};
      if (filter?.type) where.type = filter.type;
      if (filter?.level) where.level = filter.level;
      if (filter?.isRecurring !== undefined) where.isRecurring = filter.isRecurring;
      if (filter?.search) {
        where.OR = [
          { title: { contains: filter.search, mode: 'insensitive' } },
          { description: { contains: filter.search, mode: 'insensitive' } },
        ];
      }

      const [data, total] = await Promise.all([
        prisma.opportunity.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: { client: true },
        }),
        prisma.opportunity.count({ where }),
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
    myOpportunities: async (_: any, { pagination }: any, context: any) => {
      if (!context.user) throw new Error('Authentication required');

      const page = pagination?.page || 1;
      const limit = pagination?.limit || 10;
      const skip = (page - 1) * limit;

      const where = { clientId: context.user.id };

      const [data, total] = await Promise.all([
        prisma.opportunity.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: { client: true, applications: true },
        }),
        prisma.opportunity.count({ where }),
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
    myApplications: async (_: any, __: any, context: any) => {
      if (!context.user) throw new Error('Authentication required');

      return prisma.application.findMany({
        where: { talentId: context.user.id },
        include: {
          opportunity: { include: { client: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
    },
  },
  Opportunity: {
    client: (parent: any) => prisma.user.findUnique({ where: { id: parent.clientId } }),
    applications: (parent: any) => prisma.application.findMany({ where: { opportunityId: parent.id } }),
    applicationsCount: (parent: any) => prisma.application.count({ where: { opportunityId: parent.id } }),
  },
  Application: {
    opportunity: (parent: any) => prisma.opportunity.findUnique({ where: { id: parent.opportunityId } }),
    talent: (parent: any) => prisma.user.findUnique({ where: { id: parent.talentId } }),
    talentProfile: (parent: any) => prisma.talentProfile.findUnique({ where: { userId: parent.talentId } }),
  },
};
