import { gql } from 'graphql-tag';

export const baseTypeDefs = gql`
  # Scalars
  scalar DateTime
  scalar JSON

  # Enums
  enum UserRole {
    CLIENT
    TALENT
    ADMIN
  }

  enum ProjectStatus {
    DRAFT
    MATCHING
    IN_PROGRESS
    REVIEW
    COMPLETED
  }

  enum DeliverableStatus {
    NOT_STARTED
    IN_PROGRESS
    REVIEW
    COMPLETED
  }

  enum VersionStatus {
    PROCESSING
    NEEDS_REVIEW
    CHANGES_REQUESTED
    APPROVED
  }

  enum SortOrder {
    ASC
    DESC
  }

  # Pagination
  input PaginationInput {
    page: Int = 1
    limit: Int = 10
  }

  type PageInfo {
    page: Int!
    limit: Int!
    total: Int!
    totalPages: Int!
    hasNext: Boolean!
    hasPrev: Boolean!
  }

  # Base Query and Mutation
  type Query {
    _empty: String
  }

  type Mutation {
    _empty: String
  }
`;
