import { prisma } from '../../config/database';

export const studioResolvers = {
  Query: {
    studio: async (_: any, { id }: { id: string }) => {
      return prisma.studio.findUnique({ where: { id } });
    },
    studios: async (_: any, { filter, pagination }: any) => {
      const page = pagination?.page || 1;
      const limit = pagination?.limit || 10;
      const skip = (page - 1) * limit;

      const where: any = {};
      if (filter?.location) {
        where.location = { contains: filter.location, mode: 'insensitive' };
      }
      if (filter?.minRating) where.rating = { gte: filter.minRating };
      if (filter?.tags?.length) where.tags = { hasSome: filter.tags };
      if (filter?.search) {
        where.OR = [
          { name: { contains: filter.search, mode: 'insensitive' } },
          { description: { contains: filter.search, mode: 'insensitive' } },
        ];
      }

      const [data, total] = await Promise.all([
        prisma.studio.findMany({
          where,
          skip,
          take: limit,
          orderBy: { rating: 'desc' },
        }),
        prisma.studio.count({ where }),
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
};
