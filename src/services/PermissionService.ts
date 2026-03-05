import { PrismaClient, ProjectRole } from '@prisma/client';

interface ProjectPermissions {
  view: boolean;
  edit: boolean;
  comment: boolean;
  approve: boolean;
}

interface PermissionCheckResult {
  hasAccess: boolean;
  role?: ProjectRole;
  permissions?: ProjectPermissions;
}

export class PermissionService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Check if user has access to a project
   * Owner and members can access, others cannot
   */
  async canAccessProject(
    projectId: string,
    userId: string
  ): Promise<PermissionCheckResult> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      return { hasAccess: false };
    }

    // Owner always has access
    if (project.ownerId === userId) {
      return {
        hasAccess: true,
        role: ProjectRole.OWNER,
        permissions: {
          view: true,
          edit: true,
          comment: true,
          approve: true,
        },
      };
    }

    // Check if user is a project member
    const member = await this.prisma.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId,
        },
      },
    });

    if (!member) {
      return { hasAccess: false };
    }

    return {
      hasAccess: true,
      role: member.role,
      permissions: (member.permissions as unknown) as ProjectPermissions,
    };
  }

  /**
   * Check if user has a specific permission on a project
   */
  async hasPermission(
    projectId: string,
    userId: string,
    permission: keyof ProjectPermissions
  ): Promise<boolean> {
    const result = await this.canAccessProject(projectId, userId);

    if (!result.hasAccess || !result.permissions) {
      return false;
    }

    return result.permissions[permission];
  }

  /**
   * Get all members of a project with their roles and permissions
   */
  async getProjectMembers(projectId: string) {
    const members = await this.prisma.projectMember.findMany({
      where: { projectId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
          },
        },
      },
    });

    return members;
  }

  /**
   * Add a member to a project
   */
  async addMember(
    projectId: string,
    userId: string,
    role: ProjectRole = ProjectRole.COLLABORATOR,
    permissions?: ProjectPermissions
  ) {
    const defaultPermissions: ProjectPermissions = {
      view: true,
      edit: role === ProjectRole.OWNER || role === ProjectRole.COLLABORATOR,
      comment: true,
      approve: role === ProjectRole.OWNER,
    };

    return this.prisma.projectMember.create({
      data: {
        projectId,
        userId,
        role,
        permissions: (permissions || defaultPermissions) as unknown as any,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
          },
        },
      },
    });
  }

  /**
   * Update member's role and permissions
   */
  async updateMember(
    projectId: string,
    userId: string,
    role?: ProjectRole,
    permissions?: ProjectPermissions
  ) {
    return this.prisma.projectMember.update({
      where: {
        projectId_userId: {
          projectId,
          userId,
        },
      },
      data: {
        ...(role && { role }),
        ...(permissions && { permissions: permissions as unknown as any }),
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
          },
        },
      },
    });
  }

  /**
   * Remove a member from a project
   */
  async removeMember(projectId: string, userId: string) {
    return this.prisma.projectMember.delete({
      where: {
        projectId_userId: {
          projectId,
          userId,
        },
      },
    });
  }

  /**
   * Check if user is project owner
   */
  async isProjectOwner(projectId: string, userId: string): Promise<boolean> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { ownerId: true },
    });

    return project?.ownerId === userId;
  }
}
