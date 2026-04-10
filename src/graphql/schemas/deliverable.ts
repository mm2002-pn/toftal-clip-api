import { gql } from 'graphql-tag';

export const deliverableTypeDefs = gql`
  enum AcceptanceStatus {
    PENDING
    ACCEPTED
    REJECTED
  }

  type Deliverable {
    id: ID!
    project: Project!
    title: String!
    type: String
    contentType: ContentType
    status: DeliverableStatus!
    progress: Int!
    assignedTalent: User
    acceptanceStatus: AcceptanceStatus
    deadline: DateTime
    versions: [Version!]!
    workflow: [WorkflowPhase!]!
    # Phase 4 Backend Optimizations
    latestVideoUrl: String
    lastUploader: User
    taskProgress: Int
    totalTasks: Int
    completedTasks: Int
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type VideoMetadata {
    width: Int
    height: Int
    duration: Float
    quality: String
    fps: Float
    bitrate: String
  }

  type Version {
    id: ID!
    deliverable: Deliverable!
    versionNumber: Int!
    videoUrl: String!
    description: String
    status: VersionStatus!
    uploadedBy: User
    aiAnalysis: JSON
    metadata: VideoMetadata
    alternativeQualities: JSON
    feedbacks: [Feedback!]!
    createdAt: DateTime!
    uploadedAt: DateTime!
  }

  type WorkflowPhase {
    id: ID!
    title: String!
    status: String!
    assignedTo: String!
    tasks: [WorkflowTask!]!
  }

  type WorkflowTask {
    id: ID!
    title: String!
    completed: Boolean!
    assignedTo: String
  }

  type FeedbackAttachment {
    name: String!
    url: String!
    type: String!
    size: Int
  }

  type Feedback {
    id: ID!
    author: User
    guestName: String
    guestEmail: String
    rawText: String!
    structuredText: String
    type: String!
    tasks: [RevisionTask!]!
    replyingTo: Feedback
    # Voice note fields (WhatsApp-style)
    audioUrl: String
    audioDuration: Float
    # File attachments (WhatsApp-style)
    attachments: [FeedbackAttachment!]
    # Video annotation fields
    annotationX: Float
    annotationY: Float
    # Vimeo-style video review features
    timestamp: Float
    resolved: Boolean
    resolvedAt: DateTime
    resolvedBy: User
    # Drawing annotations (Timeliner.io style)
    drawings: JSON
    createdAt: DateTime!
    editedAt: DateTime
  }

  type RevisionTask {
    id: ID!
    description: String!
    completed: Boolean!
  }

  # Pagination for feedbacks (WhatsApp-style infinite scroll)
  type FeedbackPageInfo {
    hasMore: Boolean!
    oldestCursor: String
    newestCursor: String
    totalCount: Int!
  }

  type FeedbackConnection {
    data: [Feedback!]!
    pageInfo: FeedbackPageInfo!
  }

  type DeliverablesConnection {
    data: [Deliverable!]!
    pageInfo: PageInfo!
  }

  input DeliverablesFilterInput {
    projectId: ID
    status: DeliverableStatus
    assignedTalentId: ID
  }

  extend type Query {
    deliverable(id: ID!): Deliverable
    deliverables(
      filter: DeliverablesFilterInput
      pagination: PaginationInput
    ): DeliverablesConnection!
    projectDeliverables(projectId: ID!): [Deliverable!]!
    version(id: ID!): Version
    deliverableVersions(deliverableId: ID!): [Version!]!
    deliverableWorkflow(deliverableId: ID!): [WorkflowPhase!]!
    workflowPhase(id: ID!): WorkflowPhase
    feedback(id: ID!): Feedback
    # Paginated feedbacks for infinite scroll (WhatsApp-style)
    versionFeedbacks(
      versionId: ID!
      limit: Int = 30
      before: String
    ): FeedbackConnection!
  }
`;
