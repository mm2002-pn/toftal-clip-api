import { prisma } from '../../config/database';

export const mediaResolvers = {
  Query: {
    media: async (_: any, { id }: { id: string }) => {
      return prisma.mediaResource.findUnique({
        where: { id },
        include: {
          project: true,
          deliverable: true,
        },
      });
    },
    projectMedia: async (_: any, { projectId }: { projectId: string }) => {
      return prisma.mediaResource.findMany({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
      });
    },
    deliverableMedia: async (_: any, { deliverableId }: { deliverableId: string }) => {
      return prisma.mediaResource.findMany({
        where: { deliverableId },
        orderBy: { createdAt: 'desc' },
      });
    },
  },
  MediaResource: {
    project: (parent: any) => prisma.project.findUnique({ where: { id: parent.projectId } }),
    deliverable: (parent: any) =>
      parent.deliverableId ? prisma.deliverable.findUnique({ where: { id: parent.deliverableId } }) : null,
  },
};
