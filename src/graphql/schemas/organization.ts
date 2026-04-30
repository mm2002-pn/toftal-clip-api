import { gql } from 'graphql-tag';

// GraphQL types + queries for the Organization (team) feature. Mutations
// (create, invite, accept, refuse, resend, remove, notify-admin, job-label)
// stay on the REST endpoints — only the read/list operations live here so
// the team management page can co-load data with one round-trip.
export const organizationTypeDefs = gql`
  enum OrganizationMemberRole {
    ADMIN
    MEMBER
  }

  enum OrganizationMemberStatus {
    ACTIVE
    PENDING
  }

  type Organization {
    id: ID!
    name: String!
    slug: String!
    logoUrl: String
    createdAt: DateTime!
    # Convenience fields populated by the resolver: the caller's role + the
    # admin/owner display name. Saves the client a second query.
    role: OrganizationMemberRole!
    adminId: ID!
    adminName: String!
    joinedAt: DateTime!
  }

  type OrganizationMember {
    id: ID!
    userId: ID!
    user: User!
    role: OrganizationMemberRole!
    status: OrganizationMemberStatus!
    jobLabel: String
    joinedAt: DateTime!
  }

  type TeamInvitation {
    id: ID!
    email: String!
    status: InvitationStatus!
    expiresAt: DateTime!
    createdAt: DateTime!
    invitedByName: String!
    refusedAt: DateTime
    refusalReason: String
  }

  # A team member shown on the project share drawer ("Membres de mon équipe").
  # The shape merges the user info with the per-project current state so the
  # client can render "Already in project as Éditeur" without a second query.
  type ProjectTeamCandidate {
    userId: ID!
    name: String!
    email: String!
    avatarUrl: String
    jobLabel: String
    organizationId: ID!
    organizationName: String!
    # Permission level the user already has on THIS project, or null if not a
    # member yet. Matches the strings the REST add endpoint accepts:
    # 'view' = Lecteur, 'comment' = Commentateur, 'download' = Éditeur.
    # 'owner' is reported when the candidate is the project owner.
    currentPermission: String
  }

  extend type Query {
    # All active organisations the current user belongs to. Sorted by joinedAt
    # asc so the order is stable across calls.
    myOrganizations: [Organization!]!

    # Active members of an org. Caller must be a member of the org.
    organizationMembers(orgId: ID!): [OrganizationMember!]!

    # Pending invitations for an org. Admin-only — members shouldn't see who
    # has been invited but hasn't accepted yet.
    organizationInvitations(orgId: ID!): [TeamInvitation!]!

    # Members of the caller's orgs that can be added to a given project,
    # together with their current per-project state. Used by the share drawer
    # "Membres de mon équipe" section. Caller must be the project owner.
    projectTeamCandidates(projectId: ID!): [ProjectTeamCandidate!]!
  }
`;
