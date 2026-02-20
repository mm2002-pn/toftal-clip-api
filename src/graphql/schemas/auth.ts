import { gql } from 'graphql-tag';

export const authTypeDefs = gql`
  type AuthPayload {
    user: User!
    accessToken: String!
    refreshToken: String!
  }

  extend type Query {
    me: User
  }
`;
