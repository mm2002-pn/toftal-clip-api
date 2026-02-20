import { gql } from 'graphql-tag';

export const mediaTypeDefs = gql`
  type MediaResource {
    id: ID!
    project: Project!
    deliverable: Deliverable
    name: String!
    url: String!
    type: String!
    category: String
    addedBy: String
    dateAdded: DateTime!
    createdAt: DateTime!
  }

  input MediaFilterInput {
    projectId: ID
    deliverableId: ID
    type: String
    category: String
  }

  extend type Query {
    media(id: ID!): MediaResource
    projectMedia(projectId: ID!): [MediaResource!]!
    deliverableMedia(deliverableId: ID!): [MediaResource!]!
  }
`;
