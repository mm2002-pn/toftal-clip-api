import { gql } from 'graphql-tag';

export const opportunityTypeDefs = gql`
  type Opportunity {
    id: ID!
    title: String!
    client: User!
    clientName: String
    clientAvatar: String
    type: String!
    volume: String
    duration: String
    style: String
    deadline: String
    level: String
    description: String
    isVerified: Boolean
    isRecurring: Boolean
    applications: [Application!]!
    applicationsCount: Int!
    createdAt: DateTime!
  }

  type Application {
    id: ID!
    opportunity: Opportunity!
    talent: User!
    talentProfile: TalentProfile
    message: String
    status: String!
    createdAt: DateTime!
  }

  type OpportunitiesConnection {
    data: [Opportunity!]!
    pageInfo: PageInfo!
  }

  input OpportunitiesFilterInput {
    type: String
    level: String
    isRecurring: Boolean
    search: String
  }

  extend type Query {
    opportunity(id: ID!): Opportunity
    opportunities(
      filter: OpportunitiesFilterInput
      pagination: PaginationInput
    ): OpportunitiesConnection!
    myOpportunities(pagination: PaginationInput): OpportunitiesConnection!
    myApplications: [Application!]!
  }
`;
