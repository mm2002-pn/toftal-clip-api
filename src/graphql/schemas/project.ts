import { gql } from 'graphql-tag';

export const projectTypeDefs = gql`
  type Brief {
    contentType: String
    objective: String
    targetAudience: String
    tone: String
    budget: String
    deadline: String
    aiSummary: String
    aiStructure: [String]
    aiHook: String
    aiKeyPoints: [String]
  }

  enum ProjectType {
    PERSONAL
    CLIENT
  }

  enum ProjectRole {
    OWNER
    COLLABORATOR
    VIEWER
  }

  enum InvitationStatus {
    PENDING
    ACCEPTED
    REJECTED
    EXPIRED
  }

  type ProjectPermissions {
    view: Boolean!
    edit: Boolean!
    comment: Boolean!
    approve: Boolean!
  }

  type ProjectMember {
    id: ID!
    projectId: ID!
    userId: ID!
    user: User!
    role: ProjectRole!
    permissions: ProjectPermissions!
    joinedAt: DateTime!
  }

  type ProjectInvitation {
    id: ID!
    projectId: ID!
    email: String!
    inviterUserId: ID!
    inviter: User!
    token: String!
    status: InvitationStatus!
    message: String
    expiresAt: DateTime!
    acceptedAt: DateTime
    createdAt: DateTime!
  }

  type Project {
    id: ID!
    title: String!
    type: ProjectType!
    clientId: ID!
    client: User!
    talentId: ID
    talent: User
    ownerId: ID!
    owner: User!
    status: ProjectStatus!
    deadline: DateTime
    brief: Brief
    aiScore: Int
    isArchived: Boolean!
    archivedAt: DateTime
    deletedAt: DateTime
    deliverables: [Deliverable!]!
    members: [ProjectMember!]!
    invitations: [ProjectInvitation!]!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type ProjectsConnection {
    data: [Project!]!
    pageInfo: PageInfo!
  }

  input ProjectsFilterInput {
    status: ProjectStatus
    clientId: ID
    talentId: ID
    search: String
  }

  input ProjectsSortInput {
    field: String = "createdAt"
    order: SortOrder = DESC
  }

  extend type Query {
    project(id: ID!): Project
    projects(
      filter: ProjectsFilterInput
      sort: ProjectsSortInput
      pagination: PaginationInput
    ): ProjectsConnection!
    myProjects(
      filter: ProjectsFilterInput
      pagination: PaginationInput
    ): ProjectsConnection!
  }
`;
