import { gql } from 'graphql-tag';

export const userTypeDefs = gql`
  type User {
    id: ID!
    email: String!
    name: String!
    role: UserRole!
    avatarUrl: String
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type UsersConnection {
    data: [User!]!
    pageInfo: PageInfo!
  }

  input UsersFilterInput {
    role: UserRole
    search: String
  }

  extend type Query {
    user(id: ID!): User
    users(filter: UsersFilterInput, pagination: PaginationInput): UsersConnection!
  }
`;
