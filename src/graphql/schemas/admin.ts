import { gql } from 'graphql-tag';

export const adminTypeDefs = gql`
  enum AccountStatus {
    ACTIVE
    ARCHIVED
    DELETED
  }

  type AdminUser {
    id: ID!
    email: String!
    name: String!
    role: UserRole!
    avatarUrl: String
    authProvider: String!
    emailVerified: Boolean!
    accountStatus: AccountStatus!
    archivedAt: DateTime
    createdAt: DateTime!
    updatedAt: DateTime!
    projectCount: Int!
  }

  type AdminUsersConnection {
    data: [AdminUser!]!
    pageInfo: PageInfo!
  }

  input AdminUsersFilterInput {
    search: String
    role: UserRole
    status: AccountStatus
  }

  type AdminProject {
    id: ID!
    title: String!
    type: String!
    status: String!
    ownerId: ID
    clientId: ID!
    owner: User
    client: User!
    isArchived: Boolean!
    archivedAt: DateTime
    deletedAt: DateTime
    deadline: DateTime
    startDate: DateTime
    createdAt: DateTime!
    updatedAt: DateTime!
    deliverableCount: Int!
    memberCount: Int!
  }

  type AdminProjectsConnection {
    data: [AdminProject!]!
    pageInfo: PageInfo!
  }

  input AdminProjectsFilterInput {
    search: String
    status: String
    ownerId: ID
    includeArchived: Boolean = true
    includeDeleted: Boolean = false
  }

  enum DeliverableStatus {
    PREPARATION
    PRODUCTION
    RETOUR
    VALIDATION
    VALIDE
  }

  enum VersionStatus {
    PROCESSING
    NEEDS_REVIEW
    CHANGES_REQUESTED
    APPROVED
  }

  type AdminVersion {
    id: ID!
    deliverableId: ID!
    versionNumber: Int!
    videoUrl: String!
    thumbnailUrl: String
    description: String
    status: VersionStatus!
    uploadedById: ID
    uploadedBy: User
    metadata: JSON
    uploadedAt: DateTime!
    createdAt: DateTime!
    feedbackCount: Int!
  }

  type AdminMemberPermissions {
    view: Boolean!
    edit: Boolean!
    comment: Boolean!
    approve: Boolean!
  }

  type AdminProjectMember {
    id: ID!
    projectId: ID!
    userId: ID!
    user: User!
    role: ProjectRole!
    permissions: AdminMemberPermissions!
    joinedAt: DateTime!
  }

  type AdminDeliverable {
    id: ID!
    projectId: ID!
    title: String!
    type: String
    contentType: ContentType
    status: DeliverableStatus!
    progress: Int!
    assignedTalentId: ID
    assignedTalent: User
    deadline: DateTime
    createdAt: DateTime!
    updatedAt: DateTime!
    versions: [AdminVersion!]!
    versionCount: Int!
  }

  type AdminProjectDetail {
    id: ID!
    title: String!
    type: String!
    status: String!
    ownerId: ID
    clientId: ID!
    owner: User
    client: User!
    isArchived: Boolean!
    archivedAt: DateTime
    deletedAt: DateTime
    deadline: DateTime
    startDate: DateTime
    createdAt: DateTime!
    updatedAt: DateTime!
    deliverables: [AdminDeliverable!]!
    members: [AdminProjectMember!]!
    memberCount: Int!
  }

  type AuditLog {
    id: ID!
    userId: ID!
    user: User
    action: String!
    targetType: String
    targetId: ID
    metadata: JSON
    ipAddress: String
    userAgent: String
    createdAt: DateTime!
  }

  type AuditLogsConnection {
    data: [AuditLog!]!
    pageInfo: PageInfo!
  }

  input AuditLogsFilterInput {
    userId: ID
    action: String
    targetType: String
    from: DateTime
    to: DateTime
  }

  type AdminStats {
    userCount: Int!
    projectCount: Int!
    auditCount24h: Int!
    betaSignupCount: Int!
    featureFlagCount: Int!
    pendingInvitationCount: Int!
    totalStorageBytes: String!
  }

  # ============ FEATURE FLAGS ============
  type FeatureFlag {
    id: ID!
    name: String!
    description: String
    enabled: Boolean!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type PublicFeatureFlag {
    name: String!
    enabled: Boolean!
  }

  # ============ INVITATIONS ============
  type AdminInvitation {
    id: ID!
    projectId: ID!
    project: Project
    inviterUserId: ID!
    inviter: User
    email: String!
    status: InvitationStatus!
    permission: String!
    message: String
    expiresAt: DateTime!
    acceptedAt: DateTime
    refusedAt: DateTime
    refusalReason: String
    createdAt: DateTime!
  }

  type AdminInvitationsConnection {
    data: [AdminInvitation!]!
    pageInfo: PageInfo!
  }

  input AdminInvitationsFilterInput {
    status: InvitationStatus
    projectId: ID
    inviterId: ID
    email: String
  }

  # ============ STORAGE ============
  type StorageBreakdown {
    label: String!
    bytes: String!
    count: Int!
  }

  type StorageStats {
    totalBytes: String!
    versionBytes: String!
    mediaBytes: String!
    versionCount: Int!
    mediaCount: Int!
    versionsMissingSize: Int!
    mediaMissingSize: Int!
  }

  type StorageByEntity {
    entityId: ID!
    entityName: String!
    entityEmail: String
    bytes: String!
    count: Int!
  }

  # ============ METRICS ============
  type AdminKPIs {
    dau: Int!
    mau: Int!
    signups7d: Int!
    signups30d: Int!
    projectsToday: Int!
    projects7d: Int!
    feedbacks7d: Int!
    activeProjects: Int!
  }

  type TimeSeriesPoint {
    date: String!
    value: Int!
  }

  type TopUser {
    userId: ID!
    name: String!
    email: String!
    avatarUrl: String
    value: Int!
  }

  enum MetricKind {
    signups
    projects
    feedbacks
    logins
    dau
  }

  enum MetricPeriod {
    last7d
    last30d
    last90d
  }

  extend type Query {
    adminStats: AdminStats!
    adminUsers(
      filter: AdminUsersFilterInput
      pagination: PaginationInput
    ): AdminUsersConnection!
    adminProjects(
      filter: AdminProjectsFilterInput
      pagination: PaginationInput
    ): AdminProjectsConnection!
    adminProject(id: ID!): AdminProjectDetail
    adminAuditLogs(
      filter: AuditLogsFilterInput
      pagination: PaginationInput
    ): AuditLogsConnection!

    # Feature flags
    adminFeatureFlags: [FeatureFlag!]!
    featureFlags: [PublicFeatureFlag!]!

    # Invitations
    adminInvitations(
      filter: AdminInvitationsFilterInput
      pagination: PaginationInput
    ): AdminInvitationsConnection!

    # Storage
    adminStorageStats: StorageStats!
    adminStorageByProject(limit: Int = 10): [StorageByEntity!]!
    adminStorageByUser(limit: Int = 10): [StorageByEntity!]!

    # Metrics
    adminKPIs: AdminKPIs!
    adminTimeSeries(metric: MetricKind!, period: MetricPeriod = last30d): [TimeSeriesPoint!]!
    adminTopUsers(metric: MetricKind!, period: MetricPeriod = last30d, limit: Int = 10): [TopUser!]!
  }
`;
