import { gql } from 'graphql-tag';

export const talentTypeDefs = gql`
  type TalentProfile {
    id: ID!
    user: User!
    bio: String
    location: String
    languages: [String]
    skills: [String]
    videoType: String
    responseTime: String
    rating: Float
    reviewsCount: Int
    completedProjects: Int
    startingPrice: String
    verified: Boolean
    coverImage: String
    portfolio: [PortfolioItem!]!
    reviews: [Review!]!
    packages: [Package!]!
    createdAt: DateTime!
  }

  type PortfolioItem {
    id: ID!
    thumbnail: String!
    title: String!
    views: String
  }

  type Review {
    id: ID!
    author: User!
    rating: Int!
    text: String
    createdAt: DateTime!
  }

  type Package {
    id: ID!
    name: String!
    price: String!
    description: String
    features: [String]
    isPopular: Boolean
  }

  type TalentsConnection {
    data: [TalentProfile!]!
    pageInfo: PageInfo!
  }

  input TalentsFilterInput {
    skills: [String]
    videoType: String
    verified: Boolean
    minRating: Float
    maxPrice: String
    search: String
  }

  input TalentsSortInput {
    field: String = "rating"
    order: SortOrder = DESC
  }

  extend type Query {
    talent(id: ID!): TalentProfile
    talentByUserId(userId: ID!): TalentProfile
    myTalentProfile: TalentProfile
    talents(
      filter: TalentsFilterInput
      sort: TalentsSortInput
      pagination: PaginationInput
    ): TalentsConnection!
  }
`;
