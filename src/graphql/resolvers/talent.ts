import { prisma } from '../../config/database';

export const talentResolvers = {
  Query: {
    talent: async (_: any, { id }: { id: string }) => {
      return prisma.talentProfile.findUnique({
        where: { id },
        include: {
          user: true,
          portfolio: true,
          reviews: { include: { author: true } },
          packages: true,
        },
      });
    },
    talentByUserId: async (_: any, { userId }: { userId: string }) => {
      return prisma.talentProfile.findUnique({
        where: { userId },
        include: {
          user: true,
          portfolio: true,
          reviews: { include: { author: true } },
          packages: true,
        },
      });
    },
    myTalentProfile: async (_: any, __: any, context: any) => {
      if (!context.user) return null;
      return prisma.talentProfile.findUnique({
        where: { userId: context.user.id },
        include: {
          user: true,
          portfolio: true,
          reviews: { include: { author: true } },
          packages: true,
        },
      });
    },
    talents: async (_: any, { filter, sort, pagination }: any) => {
      const page = pagination?.page || 1;
      const limit = pagination?.limit || 10;
      const skip = (page - 1) * limit;

      const where: any = {};
      if (filter?.verified !== undefined) where.verified = filter.verified;
      if (filter?.videoType) where.videoType = filter.videoType;
      if (filter?.minRating) where.rating = { gte: filter.minRating };
      if (filter?.skills?.length) where.skills = { hasSome: filter.skills };
      if (filter?.search) {
        where.OR = [
          { user: { name: { contains: filter.search, mode: 'insensitive' } } },
          { bio: { contains: filter.search, mode: 'insensitive' } },
        ];
      }

      const orderBy: any = {};
      if (sort?.field) {
        orderBy[sort.field] = sort.order?.toLowerCase() || 'desc';
      } else {
        orderBy.rating = 'desc';
      }

      const [data, total] = await Promise.all([
        prisma.talentProfile.findMany({
          where,
          skip,
          take: limit,
          orderBy,
          include: {
            user: true,
            portfolio: true,
            packages: true,
          },
        }),
        prisma.talentProfile.count({ where }),
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
  TalentProfile: {
    user: (parent: any) => prisma.user.findUnique({ where: { id: parent.userId } }),
    portfolio: (parent: any) => prisma.portfolioItem.findMany({ where: { talentId: parent.id } }),
    reviews: (parent: any) => prisma.review.findMany({
      where: { talentId: parent.id },
      include: { author: true },
    }),
    packages: (parent: any) => prisma.package.findMany({ where: { talentId: parent.id } }),
  },
};
