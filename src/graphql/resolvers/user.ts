import { prisma } from '../../config/database';

export const userResolvers = {
  Query: {
    user: async (_: any, { id }: { id: string }) => {
      return prisma.user.findUnique({ where: { id } });
    },
    users: async (_: any, { filter, pagination }: any) => {
      const page = pagination?.page || 1;
      const limit = pagination?.limit || 10;
      const skip = (page - 1) * limit;

      const where: any = {};
      if (filter?.role) where.role = filter.role;
      if (filter?.search) {
        where.OR = [
          { name: { contains: filter.search, mode: 'insensitive' } },
          { email: { contains: filter.search, mode: 'insensitive' } },
        ];
      }

      const [data, total] = await Promise.all([
        prisma.user.findMany({ where, skip, take: limit }),
        prisma.user.count({ where }),
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
