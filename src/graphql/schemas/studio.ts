import { gql } from 'graphql-tag';

export const studioTypeDefs = gql`
  type Studio {
    id: ID!
    name: String!
    location: String
    pricePerHour: String
    rating: Float
    thumbnail: String
    gallery: [String]
    tags: [String]
    description: String
    features: [String]
    createdAt: DateTime!
  }

  type StudiosConnection {
    data: [Studio!]!
    pageInfo: PageInfo!
  }

  input StudiosFilterInput {
    location: String
    tags: [String]
    maxPrice: String
    minRating: Float
    search: String
  }

  extend type Query {
    studio(id: ID!): Studio
    studios(
      filter: StudiosFilterInput
      pagination: PaginationInput
    ): StudiosConnection!
  }
`;
