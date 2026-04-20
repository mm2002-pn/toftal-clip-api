import { prisma } from '../../config/database';

export const deliverableResolvers = {
  Query: {
    deliverable: async (_: any, { id }: { id: string }) => {
      return prisma.deliverable.findUnique({
        where: { id },
        include: {
          project: true,
          assignedTalent: true,
        },
      });
    },
    deliverables: async (_: any, { filter, pagination }: any) => {
      const page = pagination?.page || 1;
      const limit = pagination?.limit || 10;
      const skip = (page - 1) * limit;

      const where: any = {};
      if (filter?.projectId) where.projectId = filter.projectId;
      if (filter?.status) where.status = filter.status;
      if (filter?.assignedTalentId) where.assignedTalentId = filter.assignedTalentId;

      const [data, total] = await Promise.all([
        prisma.deliverable.findMany({
          where,
          skip,
          take: limit,
          include: {
            project: true,
            assignedTalent: true,
          },
        }),
        prisma.deliverable.count({ where }),
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
    projectDeliverables: async (_: any, { projectId }: { projectId: string }) => {
      return prisma.deliverable.findMany({
        where: { projectId },
        include: {
          assignedTalent: true,
        },
      });
    },
    version: async (_: any, { id }: { id: string }) => {
      return prisma.version.findUnique({
        where: { id },
        include: {
          deliverable: true,
          uploadedBy: true,
          feedbacks: { include: { revisionTasks: true, author: true, reads: { select: { userId: true, readAt: true } } }, orderBy: { createdAt: 'asc' } },
        },
      });
    },
    deliverableVersions: async (_: any, { deliverableId }: { deliverableId: string }) => {
      return prisma.version.findMany({
        where: { deliverableId },
        orderBy: { versionNumber: 'desc' },
        include: {
          uploadedBy: true,
          feedbacks: { include: { revisionTasks: true, author: true, reads: { select: { userId: true, readAt: true } } }, orderBy: { createdAt: 'asc' } },
        },
      });
    },
    deliverableWorkflow: async (_: any, { deliverableId }: { deliverableId: string }, context: any) => {
      // No phase filtering - all users see all phases
      return prisma.workflowPhase.findMany({
        where: { deliverableId },
        orderBy: { orderIndex: 'asc' },
        include: { tasks: { orderBy: { orderIndex: 'asc' } } },
      });
    },
    workflowPhase: async (_: any, { id }: { id: string }) => {
      return prisma.workflowPhase.findUnique({
        where: { id },
        include: { tasks: { orderBy: { orderIndex: 'asc' } } },
      });
    },
    feedback: async (_: any, { id }: { id: string }) => {
      return prisma.feedback.findUnique({
        where: { id },
        include: {
          author: true,
          revisionTasks: true,
          replyingTo: {
            select: {
              id: true,
              rawText: true,
              structuredText: true,
              author: { select: { id: true, name: true } }
            }
          }
        },
      });
    },
    // Paginated feedbacks for infinite scroll (WhatsApp-style)
    versionFeedbacks: async (_: any, { versionId, limit = 30, before }: { versionId: string; limit?: number; before?: string }) => {
      // Get total count
      const totalCount = await prisma.feedback.count({ where: { versionId } });

      // Build query conditions
      const whereCondition: any = { versionId };

      // If "before" cursor is provided, get feedbacks older than the cursor
      if (before) {
        const cursorFeedback = await prisma.feedback.findUnique({
          where: { id: before },
          select: { createdAt: true }
        });
        if (cursorFeedback) {
          whereCondition.createdAt = { lt: cursorFeedback.createdAt };
        }
      }

      // Fetch feedbacks - get newest first, then reverse for display order
      const feedbacks = await prisma.feedback.findMany({
        where: whereCondition,
        orderBy: { createdAt: 'desc' }, // Newest first for pagination
        take: limit + 1, // Take one extra to check if there's more
        include: {
          author: true,
          revisionTasks: true,
          reads: { select: { userId: true, readAt: true } },
          replyingTo: {
            select: {
              id: true,
              rawText: true,
              structuredText: true,
              author: { select: { id: true, name: true } }
            }
          }
        },
      });

      // Check if there are more older feedbacks
      const hasMore = feedbacks.length > limit;

      // Remove the extra item and reverse to get chronological order (oldest to newest)
      const data = hasMore ? feedbacks.slice(0, limit).reverse() : feedbacks.reverse();

      // Get cursors
      const oldestCursor = data.length > 0 ? data[0].id : null;
      const newestCursor = data.length > 0 ? data[data.length - 1].id : null;

      return {
        data,
        pageInfo: {
          hasMore,
          oldestCursor,
          newestCursor,
          totalCount,
        },
      };
    },
  },
  Deliverable: {
    project: (parent: any) => prisma.project.findUnique({ where: { id: parent.projectId } }),
    assignedTalent: (parent: any, _args: any, context: any) => {
      // ✅ PHASE 2: Utiliser DataLoader au lieu de requête directe
      // Si assignedTalent est déjà inclus dans le parent, le retourner directement
      if (parent.assignedTalent !== undefined) {
        return parent.assignedTalent;
      }

      // Sinon, utiliser le DataLoader pour le charger
      if (!parent.assignedTalentId) return null;
      return context.loaders.userLoader.load(parent.assignedTalentId);
    },
    versions: (parent: any) =>
      prisma.version.findMany({
        where: { deliverableId: parent.id },
        orderBy: { versionNumber: 'desc' },
        include: {
          uploadedBy: true,
          feedbacks: {
            include: {
              revisionTasks: true,
              author: true,
              reads: { select: { userId: true, readAt: true } },
              replyingTo: {
                select: {
                  id: true,
                  rawText: true,
                  structuredText: true,
                  author: { select: { id: true, name: true } }
                }
              }
            },
            orderBy: { createdAt: 'asc' }
          }
        },
      }),
    workflow: (parent: any, _args: any, context: any) => {
      // No phase filtering - all users see all phases
      return prisma.workflowPhase.findMany({
        where: { deliverableId: parent.id },
        orderBy: { orderIndex: 'asc' },
        include: { tasks: { orderBy: { orderIndex: 'asc' } } },
      });
    },
    // Phase 4 Backend Optimizations
    latestVideoUrl: async (parent: any) => {
      try {
        const latestVersion = await prisma.version.findFirst({
          where: { deliverableId: parent.id },
          orderBy: { versionNumber: 'desc' },
          select: { videoUrl: true },
        });
        return latestVersion?.videoUrl || null;
      } catch (err) {
        console.error(`Error in latestVideoUrl:`, err);
        return null;
      }
    },
    lastUploader: async (parent: any, _args: any, context: any) => {
      try {
        const latestVersion = await prisma.version.findFirst({
          where: { deliverableId: parent.id },
          orderBy: { versionNumber: 'desc' },
          select: { uploadedById: true, uploadedBy: true },
        });

        if (!latestVersion) return null;
        if (latestVersion.uploadedBy !== undefined) {
          return latestVersion.uploadedBy;
        }

        if (!latestVersion.uploadedById) return null;
        return context.loaders.userLoader.load(latestVersion.uploadedById);
      } catch (err) {
        console.error(`Error in lastUploader:`, err);
        return null;
      }
    },
    taskProgress: async (parent: any) => {
      try {
        const tasks = await prisma.workflowTask.findMany({
          where: { phase: { deliverableId: parent.id } },
          select: { completed: true },
        });

        if (tasks.length === 0) {
          return 0;
        }
        const completed = tasks.filter(t => t.completed).length;
        const progress = Math.round((completed / tasks.length) * 100);
        return progress;
      } catch (err) {
        console.error(`Error in taskProgress:`, err);
        return 0;
      }
    },
    totalTasks: async (parent: any) => {
      try {
        const count = await prisma.workflowTask.count({
          where: { phase: { deliverableId: parent.id } },
        });
        return count;
      } catch (err) {
        console.error(`Error in totalTasks:`, err);
        return 0;
      }
    },
    completedTasks: async (parent: any) => {
      try {
        const count = await prisma.workflowTask.count({
          where: {
            phase: { deliverableId: parent.id },
            completed: true,
          },
        });
        return count;
      } catch (err) {
        console.error(`Error in completedTasks:`, err);
        return 0;
      }
    },
  },
  Version: {
    deliverable: (parent: any) => prisma.deliverable.findUnique({ where: { id: parent.deliverableId } }),
    uploadedBy: (parent: any, _args: any, context: any) => {
      // ✅ PHASE 2: Utiliser DataLoader
      if (parent.uploadedBy !== undefined) {
        return parent.uploadedBy;
      }

      if (!parent.uploadedById) return null;
      return context.loaders.userLoader.load(parent.uploadedById);
    },
    feedbacks: (parent: any) =>
      prisma.feedback.findMany({
        where: { versionId: parent.id },
        orderBy: { createdAt: 'asc' },
        include: {
          revisionTasks: true,
          author: true,
          reads: { select: { userId: true, readAt: true } },
          replyingTo: {
            select: {
              id: true,
              rawText: true,
              structuredText: true,
              author: { select: { id: true, name: true } }
            }
          }
        },
      }),
  },
  WorkflowPhase: {
    tasks: (parent: any) => {
      return prisma.workflowTask.findMany({
        where: { phaseId: parent.id },
        orderBy: { orderIndex: 'asc' },
      });
    },
  },
  Feedback: {
    author: (parent: any, _args: any, context: any) => {
      // ✅ PHASE 2: Utiliser DataLoader
      // If author is already included, return it. Otherwise use DataLoader
      if (parent.author !== undefined) return parent.author;
      if (!parent.authorId) return null;
      return context.loaders.userLoader.load(parent.authorId);
    },
    resolvedBy: (parent: any, _args: any, context: any) => {
      // Vimeo-style video review - resolver for resolvedBy field
      if (parent.resolvedBy !== undefined) return parent.resolvedBy;
      if (!parent.resolvedById) return null;
      return context.loaders.userLoader.load(parent.resolvedById);
    },
    tasks: (parent: any) => {
      // If tasks are already included, return them. Otherwise fetch by feedbackId
      if (parent.tasks) return parent.tasks;
      return prisma.revisionTask.findMany({ where: { feedbackId: parent.id } });
    },
  },
};
