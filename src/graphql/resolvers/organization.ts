import { prisma } from '../../config/database';

// Resolvers for the Organization listing queries. All require an authenticated
// user. Mutations stay in REST (see modules/organizations).
export const organizationResolvers = {
  Query: {
    myOrganizations: async (_: any, __: any, context: any) => {
      if (!context.user) {
        throw new Error('Authentication required');
      }
      const userId = context.user.id;

      const memberships = await prisma.organizationMember.findMany({
        where: { userId, status: 'ACTIVE' },
        include: {
          organization: {
            include: {
              createdBy: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { joinedAt: 'asc' },
      });

      // Flatten OrganizationMember + Organization into the convenience shape
      // the front expects (role + adminName/Id co-located on the org).
      return memberships.map((m) => ({
        id: m.organization.id,
        name: m.organization.name,
        slug: m.organization.slug,
        logoUrl: m.organization.logoUrl,
        createdAt: m.organization.createdAt,
        role: m.role,
        adminId: m.organization.createdBy.id,
        adminName: m.organization.createdBy.name,
        joinedAt: m.joinedAt,
      }));
    },

    organizationMembers: async (_: any, { orgId }: { orgId: string }, context: any) => {
      if (!context.user) {
        throw new Error('Authentication required');
      }
      const userId = context.user.id;

      // Caller must be an active member of the org (admin or member).
      const membership = await prisma.organizationMember.findFirst({
        where: { organizationId: orgId, userId, status: 'ACTIVE' },
      });
      if (!membership) {
        throw new Error("Vous n'êtes pas membre de cette équipe.");
      }

      const members = await prisma.organizationMember.findMany({
        where: { organizationId: orgId, status: 'ACTIVE' },
        include: { user: true },
        // Stable ordering — the UI re-sorts (admins first, then by joinedAt
        // asc) so we just hand it over in insertion order.
        orderBy: { joinedAt: 'asc' },
      });

      // Project to the GraphQL shape. `userId` is exposed at the top level so
      // the client doesn't need to dig into `user.id`.
      return members.map((m) => ({
        id: m.id,
        userId: m.userId,
        user: m.user,
        role: m.role,
        status: m.status,
        jobLabel: m.jobLabel,
        joinedAt: m.joinedAt,
      }));
    },

    projectTeamCandidates: async (_: any, { projectId }: { projectId: string }, context: any) => {
      if (!context.user) {
        throw new Error('Authentication required');
      }
      const userId = context.user.id;

      // Caller must be the project owner. Anyone else doesn't have business
      // adding team members to it (admins can bypass via REST if needed).
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true, ownerId: true, clientId: true },
      });
      if (!project) {
        throw new Error('Projet introuvable.');
      }
      const effectiveOwnerId = project.ownerId || project.clientId;
      if (effectiveOwnerId !== userId && context.user.role !== 'ADMIN') {
        throw new Error("Seul le propriétaire du projet peut voir les candidats.");
      }

      // Pull all orgs where the caller is an active ADMIN. Members of those
      // orgs are eligible candidates. We exclude the owner themselves from
      // the list (no point in adding yourself to your own project).
      const adminMemberships = await prisma.organizationMember.findMany({
        where: { userId, role: 'ADMIN', status: 'ACTIVE' },
        select: { organizationId: true },
      });
      const orgIds = adminMemberships.map((m) => m.organizationId);
      if (orgIds.length === 0) return [];

      // Fetch candidate org members with their orgs and users in one go.
      const candidates = await prisma.organizationMember.findMany({
        where: {
          organizationId: { in: orgIds },
          status: 'ACTIVE',
          userId: { not: userId },
        },
        include: {
          user: { select: { id: true, name: true, email: true, avatarUrl: true } },
          organization: { select: { id: true, name: true } },
        },
        orderBy: { joinedAt: 'asc' },
      });

      // Cross-reference with existing ProjectMember rows for the project to
      // populate the "currentPermission" field (used by the front to grey
      // out members already on the project + show their role).
      const candidateUserIds = candidates.map((c) => c.userId);
      const existingMembers = await prisma.projectMember.findMany({
        where: {
          projectId,
          userId: { in: candidateUserIds },
        },
      });
      const memberByUserId = new Map(existingMembers.map((m) => [m.userId, m] as const));

      // Permission flag → spec label mapping. Mirrors InvitationService.ts:
      // 'download' (= edit) ↔ Éditeur, 'comment' ↔ Commentateur, 'view' ↔ Lecteur.
      const inferPermission = (permissions: any): string => {
        if (!permissions || typeof permissions !== 'object') return 'view';
        if (permissions.edit) return 'download';
        if (permissions.comment) return 'comment';
        return 'view';
      };

      // Dedupe by userId in case a candidate belongs to multiple of the
      // caller's orgs. Keep the first occurrence (oldest membership).
      const seen = new Set<string>();
      const result = [] as Array<{
        userId: string;
        name: string;
        email: string;
        avatarUrl: string | null;
        jobLabel: string | null;
        organizationId: string;
        organizationName: string;
        currentPermission: string | null;
      }>;
      for (const c of candidates) {
        if (seen.has(c.userId)) continue;
        seen.add(c.userId);
        const existing = memberByUserId.get(c.userId);
        result.push({
          userId: c.user.id,
          name: c.user.name,
          email: c.user.email,
          avatarUrl: c.user.avatarUrl,
          jobLabel: c.jobLabel,
          organizationId: c.organization.id,
          organizationName: c.organization.name,
          currentPermission: existing
            ? existing.role === 'OWNER'
              ? 'owner'
              : inferPermission(existing.permissions)
            : null,
        });
      }
      return result;
    },

    organizationInvitations: async (_: any, { orgId }: { orgId: string }, context: any) => {
      if (!context.user) {
        throw new Error('Authentication required');
      }
      const userId = context.user.id;

      // Only admins can see who has been invited but hasn't accepted yet —
      // it's slightly sensitive (who's been considered for the team).
      const membership = await prisma.organizationMember.findFirst({
        where: { organizationId: orgId, userId, status: 'ACTIVE' },
      });
      if (!membership || membership.role !== 'ADMIN') {
        throw new Error("Réservé aux administrateurs de l'équipe.");
      }

      // Return PENDING invitations + recently REJECTED ones (last 30 days).
      // Front splits them into two sections: "En attente" + "Refus récents".
      // EXPIRED and ACCEPTED stay out — they're noise here.
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const invitations = await prisma.teamInvitation.findMany({
        where: {
          organizationId: orgId,
          OR: [
            { status: 'PENDING' },
            { status: 'REJECTED', refusedAt: { gte: cutoff } },
          ],
        },
        include: { invitedBy: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      });

      return invitations.map((inv) => ({
        id: inv.id,
        email: inv.email,
        status: inv.status,
        expiresAt: inv.expiresAt,
        createdAt: inv.createdAt,
        invitedByName: inv.invitedBy.name,
        refusedAt: inv.refusedAt,
        refusalReason: inv.refusalReason,
      }));
    },
  },
};
