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
          feedbacks: { include: { revisionTasks: true, author: true }, orderBy: { createdAt: 'asc' } },
        },
      });
    },
    deliverableVersions: async (_: any, { deliverableId }: { deliverableId: string }) => {
      return prisma.version.findMany({
        where: { deliverableId },
        orderBy: { versionNumber: 'desc' },
        include: {
          uploadedBy: true,
          feedbacks: { include: { revisionTasks: true, author: true }, orderBy: { createdAt: 'asc' } },
        },
      });
    },
    deliverableWorkflow: async (_: any, { deliverableId }: { deliverableId: string }) => {
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
        },
      });
    },
    versionFeedbacks: async (_: any, { versionId }: { versionId: string }) => {
      return prisma.feedback.findMany({
        where: { versionId },
        orderBy: { createdAt: 'asc' },
        include: {
          author: true,
          revisionTasks: true,
        },
      });
    },
  },
  Deliverable: {
    project: (parent: any) => prisma.project.findUnique({ where: { id: parent.projectId } }),
    assignedTalent: (parent: any) =>
      parent.assignedTalentId ? prisma.user.findUnique({ where: { id: parent.assignedTalentId } }) : null,
    versions: (parent: any) =>
      prisma.version.findMany({
        where: { deliverableId: parent.id },
        orderBy: { versionNumber: 'desc' },
        include: { uploadedBy: true, feedbacks: { include: { revisionTasks: true, author: true }, orderBy: { createdAt: 'asc' } } },
      }),
    workflow: (parent: any) =>
      prisma.workflowPhase.findMany({
        where: { deliverableId: parent.id },
        orderBy: { orderIndex: 'asc' },
        include: { tasks: { orderBy: { orderIndex: 'asc' } } },
      }),
  },
  Version: {
    deliverable: (parent: any) => prisma.deliverable.findUnique({ where: { id: parent.deliverableId } }),
    uploadedBy: (parent: any) =>
      parent.uploadedById ? prisma.user.findUnique({ where: { id: parent.uploadedById } }) : null,
    feedbacks: (parent: any) =>
      prisma.feedback.findMany({
        where: { versionId: parent.id },
        orderBy: { createdAt: 'asc' },
        include: { revisionTasks: true, author: true },
      }),
  },
  WorkflowPhase: {
    tasks: (parent: any) =>
      prisma.workflowTask.findMany({
        where: { phaseId: parent.id },
        orderBy: { orderIndex: 'asc' },
      }),
  },
  Feedback: {
    author: (parent: any) => prisma.user.findUnique({ where: { id: parent.authorId } }),
    tasks: (parent: any) => prisma.revisionTask.findMany({ where: { feedbackId: parent.id } }),
  },
};
