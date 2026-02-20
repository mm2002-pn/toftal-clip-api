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

  type Project {
    id: ID!
    title: String!
    client: User!
    talent: User
    status: ProjectStatus!
    deadline: DateTime
    brief: Brief
    aiScore: Int
    deliverables: [Deliverable!]!
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
