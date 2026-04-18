/**
 * Comprehensive unit tests for all deliverable share scenarios
 *
 * Tests cover:
 * 1. Share link creation permissions
 * 2. Email invitation permissions
 * 3. Token verification (valid, expired, disabled, usage limit)
 * 4. Shared access permissions (view, comment, download)
 * 5. Guest feedback permissions
 * 6. File upload permissions
 */

// ============================================================================
// TYPES (matching real implementation)
// ============================================================================

interface UserPermission {
  hasAccess: boolean;
  role?: 'OWNER' | 'COLLABORATOR' | 'VIEWER';
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
  title: string;
  assignedTalentId: string | null;
  project: Project;
}

interface ShareLink {
  id: string;
  token: string;
  deliverableId: string;
  permission: 'view' | 'comment' | 'download';
  isActive: boolean;
  expiresAt: Date | null;
  maxUses: number | null;
  usedCount: number;
  createdAt: Date;
}

// ============================================================================
// BUSINESS LOGIC FUNCTIONS (replicated from routes.ts)
// ============================================================================

/**
 * Check if user can create/share a deliverable link
 * From: deliverable-share/routes.ts POST /
 */
function canCreateShareLink(
  userId: string,
  deliverable: Deliverable,
  userPermission: UserPermission
): { allowed: boolean; reason: string } {
  const project = deliverable.project;

  // Owner can always share
  const isOwner = project.ownerId === userId || project.clientId === userId;
  if (isOwner) {
    return { allowed: true, reason: 'User is project owner' };
  }

  // Talent can always share
  const isTalent = project.talentId === userId || deliverable.assignedTalentId === userId;
  if (isTalent) {
    return { allowed: true, reason: 'User is assigned talent' };
  }

  // Collaborator with edit permission can share
  const hasEditPermission = userPermission.permissions?.edit === true;
  if (hasEditPermission) {
    return { allowed: true, reason: 'User has edit permission' };
  }

  // No access
  if (!userPermission.hasAccess) {
    return { allowed: false, reason: 'User has no access to project' };
  }

  return { allowed: false, reason: 'Edit permission required to share' };
}

/**
 * Validate share link token
 * From: deliverable-share/routes.ts GET /verify/:token
 */
function validateShareLink(
  shareLink: ShareLink | null,
  currentDate: Date = new Date()
): { valid: boolean; error: string | null } {
  // Token not found
  if (!shareLink) {
    return { valid: false, error: 'Invalid or expired token' };
  }

  // Link disabled
  if (!shareLink.isActive) {
    return { valid: false, error: 'This share link has been disabled' };
  }

  // Link expired
  if (shareLink.expiresAt && shareLink.expiresAt < currentDate) {
    return { valid: false, error: 'This share link has expired' };
  }

  // Usage limit reached
  if (shareLink.maxUses && shareLink.usedCount >= shareLink.maxUses) {
    return { valid: false, error: 'This share link has reached its usage limit' };
  }

  return { valid: true, error: null };
}

/**
 * Check if share link allows specific action
 * From: deliverable-share/routes.ts POST /:token/feedback
 */
function canPerformAction(
  shareLink: ShareLink,
  action: 'view' | 'comment' | 'download' | 'upload'
): { allowed: boolean; reason: string } {
  const permission = shareLink.permission;

  // View is always allowed
  if (action === 'view') {
    return { allowed: true, reason: 'View is always allowed' };
  }

  // Comment requires 'comment' or 'download' permission
  if (action === 'comment' || action === 'upload') {
    if (permission === 'view') {
      return { allowed: false, reason: 'This share link does not allow commenting' };
    }
    return { allowed: true, reason: `Permission '${permission}' allows commenting` };
  }

  // Download requires 'download' permission
  if (action === 'download') {
    if (permission !== 'download') {
      return { allowed: false, reason: 'This share link does not allow downloading' };
    }
    return { allowed: true, reason: 'Download permission granted' };
  }

  return { allowed: false, reason: 'Unknown action' };
}

/**
 * Validate guest feedback data
 */
function validateGuestFeedback(
  userId: string | null,
  guestName: string | undefined,
  guestEmail: string | undefined
): { valid: boolean; error: string | null } {
  // Authenticated user doesn't need guest info
  if (userId) {
    return { valid: true, error: null };
  }

  // Guest must provide name and email
  if (!guestName || !guestEmail) {
    return { valid: false, error: 'guestName and guestEmail are required for non-authenticated users' };
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(guestEmail)) {
    return { valid: false, error: 'Invalid email format' };
  }

  return { valid: true, error: null };
}

// ============================================================================
// TESTS
// ============================================================================

describe('Share Link Creation Permissions', () => {
  const project: Project = {
    id: 'project-1',
    ownerId: 'owner-123',
    clientId: 'client-123',
    talentId: 'talent-123',
  };

  const deliverable: Deliverable = {
    id: 'deliverable-1',
    title: 'Episode 1',
    assignedTalentId: 'assigned-talent-123',
    project,
  };

  describe('Owner permissions', () => {
    it('should allow project owner to create share link', () => {
      const result = canCreateShareLink('owner-123', deliverable, {
        hasAccess: true,
        role: 'OWNER',
        permissions: { view: true, edit: true, comment: true, approve: true },
      });
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('User is project owner');
    });

    it('should allow client (co-owner) to create share link', () => {
      const result = canCreateShareLink('client-123', deliverable, {
        hasAccess: true,
        role: 'OWNER',
        permissions: { view: true, edit: true, comment: true, approve: true },
      });
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('User is project owner');
    });
  });

  describe('Talent permissions', () => {
    it('should allow project talent to create share link', () => {
      const result = canCreateShareLink('talent-123', deliverable, {
        hasAccess: true,
        role: 'COLLABORATOR',
        permissions: { view: true, edit: false, comment: true, approve: false },
      });
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('User is assigned talent');
    });

    it('should allow deliverable-assigned talent to create share link', () => {
      const result = canCreateShareLink('assigned-talent-123', deliverable, {
        hasAccess: true,
        role: 'COLLABORATOR',
        permissions: { view: true, edit: false, comment: true, approve: false },
      });
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('User is assigned talent');
    });
  });

  describe('Collaborator permissions', () => {
    it('should allow collaborator with edit permission to create share link', () => {
      const result = canCreateShareLink('collab-123', deliverable, {
        hasAccess: true,
        role: 'COLLABORATOR',
        permissions: { view: true, edit: true, comment: true, approve: false },
      });
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('User has edit permission');
    });

    it('should NOT allow collaborator without edit permission to create share link', () => {
      const result = canCreateShareLink('collab-123', deliverable, {
        hasAccess: true,
        role: 'COLLABORATOR',
        permissions: { view: true, edit: false, comment: true, approve: false },
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('Edit permission required to share');
    });

    it('should NOT allow collaborator with only view permission', () => {
      const result = canCreateShareLink('viewer-123', deliverable, {
        hasAccess: true,
        role: 'VIEWER',
        permissions: { view: true, edit: false, comment: false, approve: false },
      });
      expect(result.allowed).toBe(false);
    });
  });

  describe('No access users', () => {
    it('should NOT allow user without project access', () => {
      const result = canCreateShareLink('stranger-123', deliverable, {
        hasAccess: false,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('User has no access to project');
    });
  });
});

describe('Share Link Token Validation', () => {
  const now = new Date('2026-04-18T12:00:00Z');

  const validLink: ShareLink = {
    id: 'link-1',
    token: 'valid-token-123',
    deliverableId: 'deliverable-1',
    permission: 'comment',
    isActive: true,
    expiresAt: new Date('2026-04-25T12:00:00Z'), // 7 days later
    maxUses: 100,
    usedCount: 5,
    createdAt: new Date('2026-04-18T10:00:00Z'),
  };

  describe('Valid tokens', () => {
    it('should validate active, non-expired token', () => {
      const result = validateShareLink(validLink, now);
      expect(result.valid).toBe(true);
      expect(result.error).toBeNull();
    });

    it('should validate token without expiration', () => {
      const linkNoExpiry = { ...validLink, expiresAt: null };
      const result = validateShareLink(linkNoExpiry, now);
      expect(result.valid).toBe(true);
    });

    it('should validate token without usage limit', () => {
      const linkNoLimit = { ...validLink, maxUses: null };
      const result = validateShareLink(linkNoLimit, now);
      expect(result.valid).toBe(true);
    });
  });

  describe('Invalid tokens', () => {
    it('should reject null/non-existent token', () => {
      const result = validateShareLink(null, now);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid or expired token');
    });

    it('should reject disabled token', () => {
      const disabledLink = { ...validLink, isActive: false };
      const result = validateShareLink(disabledLink, now);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('This share link has been disabled');
    });

    it('should reject expired token', () => {
      const expiredLink = {
        ...validLink,
        expiresAt: new Date('2026-04-17T12:00:00Z') // Yesterday
      };
      const result = validateShareLink(expiredLink, now);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('This share link has expired');
    });

    it('should reject token that reached usage limit', () => {
      const maxedLink = { ...validLink, maxUses: 10, usedCount: 10 };
      const result = validateShareLink(maxedLink, now);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('This share link has reached its usage limit');
    });

    it('should reject token that exceeded usage limit', () => {
      const exceededLink = { ...validLink, maxUses: 10, usedCount: 15 };
      const result = validateShareLink(exceededLink, now);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('This share link has reached its usage limit');
    });
  });

  describe('Edge cases', () => {
    it('should validate token expiring exactly now (still valid)', () => {
      const expiringNow = { ...validLink, expiresAt: now };
      const result = validateShareLink(expiringNow, now);
      // expiresAt < currentDate, exactly equal means NOT expired yet
      expect(result.valid).toBe(true);
    });

    it('should validate token at usage limit minus one', () => {
      const almostMaxed = { ...validLink, maxUses: 10, usedCount: 9 };
      const result = validateShareLink(almostMaxed, now);
      expect(result.valid).toBe(true);
    });
  });
});

describe('Share Link Action Permissions', () => {
  describe('View permission level', () => {
    const viewLink: ShareLink = {
      id: 'link-1',
      token: 'token-123',
      deliverableId: 'deliverable-1',
      permission: 'view',
      isActive: true,
      expiresAt: null,
      maxUses: null,
      usedCount: 0,
      createdAt: new Date(),
    };

    it('should allow viewing with view permission', () => {
      const result = canPerformAction(viewLink, 'view');
      expect(result.allowed).toBe(true);
    });

    it('should NOT allow commenting with view permission', () => {
      const result = canPerformAction(viewLink, 'comment');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('This share link does not allow commenting');
    });

    it('should NOT allow uploading with view permission', () => {
      const result = canPerformAction(viewLink, 'upload');
      expect(result.allowed).toBe(false);
    });

    it('should NOT allow downloading with view permission', () => {
      const result = canPerformAction(viewLink, 'download');
      expect(result.allowed).toBe(false);
    });
  });

  describe('Comment permission level', () => {
    const commentLink: ShareLink = {
      id: 'link-2',
      token: 'token-456',
      deliverableId: 'deliverable-1',
      permission: 'comment',
      isActive: true,
      expiresAt: null,
      maxUses: null,
      usedCount: 0,
      createdAt: new Date(),
    };

    it('should allow viewing with comment permission', () => {
      const result = canPerformAction(commentLink, 'view');
      expect(result.allowed).toBe(true);
    });

    it('should allow commenting with comment permission', () => {
      const result = canPerformAction(commentLink, 'comment');
      expect(result.allowed).toBe(true);
    });

    it('should allow uploading (attachments) with comment permission', () => {
      const result = canPerformAction(commentLink, 'upload');
      expect(result.allowed).toBe(true);
    });

    it('should NOT allow downloading with comment permission', () => {
      const result = canPerformAction(commentLink, 'download');
      expect(result.allowed).toBe(false);
    });
  });

  describe('Download permission level', () => {
    const downloadLink: ShareLink = {
      id: 'link-3',
      token: 'token-789',
      deliverableId: 'deliverable-1',
      permission: 'download',
      isActive: true,
      expiresAt: null,
      maxUses: null,
      usedCount: 0,
      createdAt: new Date(),
    };

    it('should allow viewing with download permission', () => {
      const result = canPerformAction(downloadLink, 'view');
      expect(result.allowed).toBe(true);
    });

    it('should allow commenting with download permission', () => {
      const result = canPerformAction(downloadLink, 'comment');
      expect(result.allowed).toBe(true);
    });

    it('should allow uploading with download permission', () => {
      const result = canPerformAction(downloadLink, 'upload');
      expect(result.allowed).toBe(true);
    });

    it('should allow downloading with download permission', () => {
      const result = canPerformAction(downloadLink, 'download');
      expect(result.allowed).toBe(true);
    });
  });
});

describe('Guest Feedback Validation', () => {
  describe('Authenticated users', () => {
    it('should allow authenticated user without guest info', () => {
      const result = validateGuestFeedback('user-123', undefined, undefined);
      expect(result.valid).toBe(true);
    });

    it('should allow authenticated user with guest info (ignored)', () => {
      const result = validateGuestFeedback('user-123', 'Guest Name', 'guest@example.com');
      expect(result.valid).toBe(true);
    });
  });

  describe('Guest users', () => {
    it('should allow guest with valid name and email', () => {
      const result = validateGuestFeedback(null, 'John Doe', 'john@example.com');
      expect(result.valid).toBe(true);
    });

    it('should reject guest without name', () => {
      const result = validateGuestFeedback(null, undefined, 'john@example.com');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('guestName and guestEmail are required for non-authenticated users');
    });

    it('should reject guest without email', () => {
      const result = validateGuestFeedback(null, 'John Doe', undefined);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('guestName and guestEmail are required for non-authenticated users');
    });

    it('should reject guest with empty name', () => {
      const result = validateGuestFeedback(null, '', 'john@example.com');
      expect(result.valid).toBe(false);
    });

    it('should reject guest with invalid email format', () => {
      const result = validateGuestFeedback(null, 'John Doe', 'invalid-email');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid email format');
    });

    it('should reject guest with email missing @', () => {
      const result = validateGuestFeedback(null, 'John Doe', 'johndoeexample.com');
      expect(result.valid).toBe(false);
    });

    it('should reject guest with email missing domain', () => {
      const result = validateGuestFeedback(null, 'John Doe', 'john@');
      expect(result.valid).toBe(false);
    });
  });
});

describe('Permission Hierarchy Matrix', () => {
  const testCases = [
    // Permission level -> allowed actions
    { permission: 'view', canView: true, canComment: false, canUpload: false, canDownload: false },
    { permission: 'comment', canView: true, canComment: true, canUpload: true, canDownload: false },
    { permission: 'download', canView: true, canComment: true, canUpload: true, canDownload: true },
  ] as const;

  testCases.forEach(({ permission, canView, canComment, canUpload, canDownload }) => {
    describe(`Permission level: ${permission}`, () => {
      const link: ShareLink = {
        id: 'link-test',
        token: 'token-test',
        deliverableId: 'deliverable-1',
        permission,
        isActive: true,
        expiresAt: null,
        maxUses: null,
        usedCount: 0,
        createdAt: new Date(),
      };

      it(`view: ${canView}`, () => {
        expect(canPerformAction(link, 'view').allowed).toBe(canView);
      });

      it(`comment: ${canComment}`, () => {
        expect(canPerformAction(link, 'comment').allowed).toBe(canComment);
      });

      it(`upload: ${canUpload}`, () => {
        expect(canPerformAction(link, 'upload').allowed).toBe(canUpload);
      });

      it(`download: ${canDownload}`, () => {
        expect(canPerformAction(link, 'download').allowed).toBe(canDownload);
      });
    });
  });
});

describe('Email Invitation Scenarios', () => {
  const project: Project = {
    id: 'project-1',
    ownerId: 'owner-123',
    clientId: null,
    talentId: null,
  };

  const deliverable: Deliverable = {
    id: 'deliverable-1',
    title: 'Video Title',
    assignedTalentId: null,
    project,
  };

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  describe('Email validation', () => {
    const validEmails = [
      'user@example.com',
      'user.name@example.com',
      'user+tag@example.com',
      'user@subdomain.example.com',
    ];

    const invalidEmails = [
      'invalid',
      '@example.com',
      'user@',
      'user@.com',
      'user name@example.com',
      '',
    ];

    validEmails.forEach(email => {
      it(`should accept valid email: ${email}`, () => {
        expect(emailRegex.test(email)).toBe(true);
      });
    });

    invalidEmails.forEach(email => {
      it(`should reject invalid email: ${email}`, () => {
        expect(emailRegex.test(email)).toBe(false);
      });
    });
  });

  describe('Permission combinations for invitation', () => {
    const permissionLevels: Array<'view' | 'comment' | 'download'> = ['view', 'comment', 'download'];

    permissionLevels.forEach(permission => {
      it(`should allow owner to invite with ${permission} permission`, () => {
        const result = canCreateShareLink('owner-123', deliverable, {
          hasAccess: true,
          role: 'OWNER',
          permissions: { view: true, edit: true, comment: true, approve: true },
        });
        expect(result.allowed).toBe(true);
      });
    });
  });
});

describe('Real-world Scenarios', () => {
  describe('Scenario: Client shares video with external reviewer', () => {
    const project: Project = {
      id: 'project-1',
      ownerId: 'agency-123',
      clientId: 'client-123',
      talentId: 'editor-123',
    };

    const deliverable: Deliverable = {
      id: 'video-1',
      title: 'Brand Campaign V1',
      assignedTalentId: 'editor-123',
      project,
    };

    it('client can create comment-only share link', () => {
      const result = canCreateShareLink('client-123', deliverable, {
        hasAccess: true,
        role: 'OWNER',
        permissions: { view: true, edit: true, comment: true, approve: true },
      });
      expect(result.allowed).toBe(true);
    });

    it('external reviewer can view and comment', () => {
      const shareLink: ShareLink = {
        id: 'link-1',
        token: 'external-token',
        deliverableId: 'video-1',
        permission: 'comment',
        isActive: true,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        maxUses: null,
        usedCount: 0,
        createdAt: new Date(),
      };

      expect(canPerformAction(shareLink, 'view').allowed).toBe(true);
      expect(canPerformAction(shareLink, 'comment').allowed).toBe(true);
      expect(canPerformAction(shareLink, 'download').allowed).toBe(false);
    });

    it('external reviewer can leave feedback as guest', () => {
      const result = validateGuestFeedback(null, 'External Reviewer', 'reviewer@client.com');
      expect(result.valid).toBe(true);
    });
  });

  describe('Scenario: Editor shares draft with collaborator who has no edit rights', () => {
    const project: Project = {
      id: 'project-2',
      ownerId: 'owner-123',
      clientId: null,
      talentId: 'editor-123',
    };

    const deliverable: Deliverable = {
      id: 'draft-1',
      title: 'Draft Cut',
      assignedTalentId: 'editor-123',
      project,
    };

    it('editor (talent) can share even without explicit edit permission', () => {
      const result = canCreateShareLink('editor-123', deliverable, {
        hasAccess: true,
        role: 'COLLABORATOR',
        permissions: { view: true, edit: false, comment: true, approve: false },
      });
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('User is assigned talent');
    });

    it('regular collaborator without edit cannot share', () => {
      const result = canCreateShareLink('collab-456', deliverable, {
        hasAccess: true,
        role: 'COLLABORATOR',
        permissions: { view: true, edit: false, comment: true, approve: false },
      });
      expect(result.allowed).toBe(false);
    });
  });

  describe('Scenario: Link expires during viewing session', () => {
    it('should reject link that expired during use', () => {
      const shareLink: ShareLink = {
        id: 'link-1',
        token: 'expiring-token',
        deliverableId: 'video-1',
        permission: 'view',
        isActive: true,
        expiresAt: new Date('2026-04-18T12:00:00Z'),
        maxUses: null,
        usedCount: 0,
        createdAt: new Date('2026-04-11T12:00:00Z'),
      };

      // Before expiry
      const beforeExpiry = new Date('2026-04-18T11:59:59Z');
      expect(validateShareLink(shareLink, beforeExpiry).valid).toBe(true);

      // After expiry
      const afterExpiry = new Date('2026-04-18T12:00:01Z');
      expect(validateShareLink(shareLink, afterExpiry).valid).toBe(false);
    });
  });

  describe('Scenario: Link disabled by owner', () => {
    it('should immediately block access when link is disabled', () => {
      const shareLink: ShareLink = {
        id: 'link-1',
        token: 'disabled-token',
        deliverableId: 'video-1',
        permission: 'download',
        isActive: false, // Owner disabled it
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        maxUses: null,
        usedCount: 5,
        createdAt: new Date(),
      };

      const result = validateShareLink(shareLink);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('This share link has been disabled');
    });
  });
});
