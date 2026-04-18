/**
 * Unit tests for deliverable share permissions
 *
 * Tests the permission logic for sharing deliverables (videos):
 * - Owners can always share
 * - Talents can always share
 * - Collaborators with edit permission can share
 * - Collaborators without edit permission cannot share
 * - Users without access cannot share
 */

// Mock types matching the real implementation
interface UserPermission {
  hasAccess: boolean;
  role?: string;
  permissions?: {
    view: boolean;
    edit: boolean;
    comment: boolean;
    approve: boolean;
  };
}

interface Project {
  id: string;
  ownerId: string;
  clientId: string | null;
  talentId: string | null;
}

interface Deliverable {
  id: string;
  assignedTalentId: string | null;
  project: Project;
}

/**
 * Replicate the canShare logic from deliverable-share/routes.ts
 * This is the business logic we want to test
 */
function canShareDeliverable(
  userId: string,
  deliverable: Deliverable,
  userPermission: UserPermission
): { canShare: boolean; reason: string } {
  const project = deliverable.project;

  // Check if user is owner
  const isOwner = project.ownerId === userId || project.clientId === userId;
  if (isOwner) {
    return { canShare: true, reason: 'User is project owner' };
  }

  // Check if user is talent
  const isTalent = project.talentId === userId || deliverable.assignedTalentId === userId;
  if (isTalent) {
    return { canShare: true, reason: 'User is assigned talent' };
  }

  // Check if user has edit permission (collaborator with edit)
  const hasEditPermission = userPermission.permissions?.edit === true;
  if (hasEditPermission) {
    return { canShare: true, reason: 'User has edit permission' };
  }

  // User cannot share
  if (!userPermission.hasAccess) {
    return { canShare: false, reason: 'User has no access to project' };
  }

  return { canShare: false, reason: 'User does not have edit permission' };
}

describe('Deliverable Share Permissions', () => {
  // Test data
  const projectId = 'project-123';
  const deliverableId = 'deliverable-456';
  const ownerId = 'owner-user-id';
  const clientId = 'client-user-id';
  const talentId = 'talent-user-id';
  const collaboratorId = 'collaborator-user-id';
  const viewerOnlyId = 'viewer-only-user-id';
  const noAccessUserId = 'no-access-user-id';

  const baseProject: Project = {
    id: projectId,
    ownerId: ownerId,
    clientId: clientId,
    talentId: talentId,
  };

  const baseDeliverable: Deliverable = {
    id: deliverableId,
    assignedTalentId: null,
    project: baseProject,
  };

  describe('Owner permissions', () => {
    it('should allow project owner to share', () => {
      const userPermission: UserPermission = {
        hasAccess: true,
        role: 'OWNER',
        permissions: { view: true, edit: true, comment: true, approve: true },
      };

      const result = canShareDeliverable(ownerId, baseDeliverable, userPermission);

      expect(result.canShare).toBe(true);
      expect(result.reason).toBe('User is project owner');
    });

    it('should allow client (secondary owner) to share', () => {
      const userPermission: UserPermission = {
        hasAccess: true,
        role: 'OWNER',
        permissions: { view: true, edit: true, comment: true, approve: true },
      };

      const result = canShareDeliverable(clientId, baseDeliverable, userPermission);

      expect(result.canShare).toBe(true);
      expect(result.reason).toBe('User is project owner');
    });
  });

  describe('Talent permissions', () => {
    it('should allow project talent to share', () => {
      const userPermission: UserPermission = {
        hasAccess: true,
        role: 'COLLABORATOR',
        permissions: { view: true, edit: false, comment: true, approve: false },
      };

      const result = canShareDeliverable(talentId, baseDeliverable, userPermission);

      expect(result.canShare).toBe(true);
      expect(result.reason).toBe('User is assigned talent');
    });

    it('should allow deliverable assigned talent to share', () => {
      const assignedTalentId = 'assigned-talent-id';
      const deliverableWithTalent: Deliverable = {
        ...baseDeliverable,
        assignedTalentId: assignedTalentId,
      };

      const userPermission: UserPermission = {
        hasAccess: true,
        role: 'COLLABORATOR',
        permissions: { view: true, edit: false, comment: true, approve: false },
      };

      const result = canShareDeliverable(assignedTalentId, deliverableWithTalent, userPermission);

      expect(result.canShare).toBe(true);
      expect(result.reason).toBe('User is assigned talent');
    });
  });

  describe('Collaborator permissions', () => {
    it('should allow collaborator with edit permission to share', () => {
      const userPermission: UserPermission = {
        hasAccess: true,
        role: 'COLLABORATOR',
        permissions: { view: true, edit: true, comment: true, approve: false },
      };

      const result = canShareDeliverable(collaboratorId, baseDeliverable, userPermission);

      expect(result.canShare).toBe(true);
      expect(result.reason).toBe('User has edit permission');
    });

    it('should NOT allow collaborator without edit permission to share', () => {
      const userPermission: UserPermission = {
        hasAccess: true,
        role: 'COLLABORATOR',
        permissions: { view: true, edit: false, comment: true, approve: false },
      };

      const result = canShareDeliverable(collaboratorId, baseDeliverable, userPermission);

      expect(result.canShare).toBe(false);
      expect(result.reason).toBe('User does not have edit permission');
    });

    it('should NOT allow collaborator with only view permission to share', () => {
      const userPermission: UserPermission = {
        hasAccess: true,
        role: 'VIEWER',
        permissions: { view: true, edit: false, comment: false, approve: false },
      };

      const result = canShareDeliverable(viewerOnlyId, baseDeliverable, userPermission);

      expect(result.canShare).toBe(false);
      expect(result.reason).toBe('User does not have edit permission');
    });
  });

  describe('No access users', () => {
    it('should NOT allow user without any access to share', () => {
      const userPermission: UserPermission = {
        hasAccess: false,
        role: undefined,
        permissions: undefined,
      };

      const result = canShareDeliverable(noAccessUserId, baseDeliverable, userPermission);

      expect(result.canShare).toBe(false);
      expect(result.reason).toBe('User has no access to project');
    });
  });

  describe('Edge cases', () => {
    it('should handle undefined permissions gracefully', () => {
      const userPermission: UserPermission = {
        hasAccess: true,
        role: 'COLLABORATOR',
        permissions: undefined,
      };

      const result = canShareDeliverable(collaboratorId, baseDeliverable, userPermission);

      expect(result.canShare).toBe(false);
      expect(result.reason).toBe('User does not have edit permission');
    });

    it('should handle null clientId in project', () => {
      const projectWithoutClient: Project = {
        ...baseProject,
        clientId: null,
      };
      const deliverable: Deliverable = {
        ...baseDeliverable,
        project: projectWithoutClient,
      };

      const userPermission: UserPermission = {
        hasAccess: true,
        role: 'OWNER',
        permissions: { view: true, edit: true, comment: true, approve: true },
      };

      const result = canShareDeliverable(ownerId, deliverable, userPermission);

      expect(result.canShare).toBe(true);
      expect(result.reason).toBe('User is project owner');
    });

    it('should handle null talentId in project', () => {
      const projectWithoutTalent: Project = {
        ...baseProject,
        talentId: null,
      };
      const deliverable: Deliverable = {
        ...baseDeliverable,
        project: projectWithoutTalent,
      };

      const userPermission: UserPermission = {
        hasAccess: true,
        role: 'COLLABORATOR',
        permissions: { view: true, edit: true, comment: true, approve: false },
      };

      // A collaborator with edit can still share
      const result = canShareDeliverable(collaboratorId, deliverable, userPermission);

      expect(result.canShare).toBe(true);
      expect(result.reason).toBe('User has edit permission');
    });
  });
});

describe('Permission priority', () => {
  const projectId = 'project-123';
  const deliverableId = 'deliverable-456';
  const userId = 'user-123';

  it('should prioritize owner check before talent check', () => {
    // User is both owner and talent - should return owner reason
    const project: Project = {
      id: projectId,
      ownerId: userId,
      clientId: null,
      talentId: userId, // Same user is also talent
    };
    const deliverable: Deliverable = {
      id: deliverableId,
      assignedTalentId: null,
      project,
    };
    const userPermission: UserPermission = {
      hasAccess: true,
      role: 'OWNER',
      permissions: { view: true, edit: true, comment: true, approve: true },
    };

    const result = canShareDeliverable(userId, deliverable, userPermission);

    expect(result.canShare).toBe(true);
    expect(result.reason).toBe('User is project owner');
  });

  it('should prioritize talent check before edit permission check', () => {
    // User is talent but also has edit permission - should return talent reason
    const project: Project = {
      id: projectId,
      ownerId: 'other-owner',
      clientId: null,
      talentId: userId,
    };
    const deliverable: Deliverable = {
      id: deliverableId,
      assignedTalentId: null,
      project,
    };
    const userPermission: UserPermission = {
      hasAccess: true,
      role: 'COLLABORATOR',
      permissions: { view: true, edit: true, comment: true, approve: false },
    };

    const result = canShareDeliverable(userId, deliverable, userPermission);

    expect(result.canShare).toBe(true);
    expect(result.reason).toBe('User is assigned talent');
  });
});
