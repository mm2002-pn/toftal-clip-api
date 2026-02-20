import { gql } from 'graphql-tag';

export const deliverableTypeDefs = gql`
  type Deliverable {
    id: ID!
    project: Project!
    title: String!
    type: String
    status: DeliverableStatus!
    progress: Int!
    assignedTalent: User
    deadline: DateTime
    versions: [Version!]!
    workflow: [WorkflowPhase!]!
    createdAt: DateTime!
    updatedAt: DateTime!
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
    feedbacks: [Feedback!]!
    uploadedAt: DateTime!
  }

  type WorkflowPhase {
    id: ID!
    title: String!
    status: String!
    tasks: [WorkflowTask!]!
  }

  type WorkflowTask {
    id: ID!
    title: String!
    completed: Boolean!
    assignedTo: String
  }

  type Feedback {
    id: ID!
    author: User!
    rawText: String!
    structuredText: String
    type: String!
    tasks: [RevisionTask!]!
    createdAt: DateTime!
  }

  type RevisionTask {
    id: ID!
    description: String!
    completed: Boolean!
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
    versionFeedbacks(versionId: ID!): [Feedback!]!
  }
`;
