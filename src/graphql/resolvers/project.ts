import { prisma } from '../../config/database';

export const projectResolvers = {
  Query: {
    project: async (_: any, { id }: { id: string }, context: any) => {
      const project = await prisma.project.findUnique({
        where: { id },
        include: {
          client: true,
          talent: true,
          mediaResources: {
            orderBy: { createdAt: 'desc' },
          },
          members: {
            include: {
              user: true,
            },
          },
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

      const where: any = {
        // Exclude archived and deleted projects by default
        isArchived: false,
        deletedAt: null,
      };
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
            members: {
              include: {
                user: true,
              },
            },
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

      let where: any = {
        // Exclude archived and deleted projects by default
        isArchived: false,
        deletedAt: null,
      };

      // Filter projects based on user role
      if (context.user.role !== 'ADMIN') {
        // Users see their own projects AND projects they're members of
        const filters: any[] = [
          { clientId: context.user.id }, // Projects created by this user
          { members: { some: { userId: context.user.id } } }, // Projects where user is member
        ];

        // If talent mode enabled, also see projects where assigned as talent
        if (context.user.talentModeEnabled === true) {
          filters.push(
            { talentId: context.user.id }, // Projects where user is the main talent
            { deliverables: { some: { assignedTalentId: context.user.id } } } // Projects with assigned deliverables
          );
        }

        where.OR = filters;
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
            members: {
              include: {
                user: true,
              },
            },
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
    client: (parent: any, _args: any, context: any) => {
      // ✅ PHASE 2: Utiliser DataLoader
      if (parent.client !== undefined) return parent.client;
      return context.loaders.userLoader.load(parent.clientId);
    },
    talent: (parent: any, _args: any, context: any) => {
      // ✅ PHASE 2: Utiliser DataLoader
      if (parent.talent !== undefined) return parent.talent;
      if (!parent.talentId) return null;
      return context.loaders.userLoader.load(parent.talentId);
    },
    owner: (parent: any, _args: any, context: any) => {
      // ✅ PHASE 2: Utiliser DataLoader
      if (parent.owner !== undefined) return parent.owner;
      if (!parent.ownerId) return null;
      return context.loaders.userLoader.load(parent.ownerId);
    },
    deliverables: async (parent: any) => {
      const user = parent._contextUser;

      // No phase filtering - all users see all phases
      const phaseFilter = { orderBy: { orderIndex: 'asc' as const } };

      const includeOptions = {
        assignedTalent: { select: { id: true, name: true, email: true, avatarUrl: true } },
        workflowPhases: {
          ...phaseFilter,
          include: { tasks: { orderBy: { orderIndex: 'asc' as const } } },
        },
        versions: {
          include: {
            uploadedBy: { select: { id: true, name: true, avatarUrl: true } },
            feedbacks: {
              include: {
                author: { select: { id: true, name: true, avatarUrl: true } },
                revisionTasks: true,
                replyingTo: {
                  select: {
                    id: true,
                    rawText: true,
                    structuredText: true,
                    author: { select: { id: true, name: true } }
                  }
                },
              },
              // Annotation coordinates will be included automatically as scalar fields
            },
          },
          orderBy: { versionNumber: 'desc' as const },
        },
      };

      // If no user context, or ADMIN, or USER without talent mode, return all deliverables
      if (!user || user.role === 'ADMIN' || user.talentModeEnabled === false) {
        return prisma.deliverable.findMany({
          where: { projectId: parent.id },
          include: includeOptions,
        });
      }

      // For USER with talent mode enabled: only return deliverables assigned to them
      // Either as project's main talent or specifically assigned to the deliverable
      if (user.talentModeEnabled === true) {
        return prisma.deliverable.findMany({
          where: {
            projectId: parent.id,
            OR: [
              { assignedTalentId: user.id },
              // If talent is the project's main talent, show unassigned deliverables too
              ...(parent.talentId === user.id ? [{ assignedTalentId: null }] : []),
            ],
          },
          include: includeOptions,
        });
      }

      return prisma.deliverable.findMany({
        where: { projectId: parent.id },
        include: includeOptions,
      });
    },
  },
};
