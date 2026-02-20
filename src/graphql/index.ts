import { makeExecutableSchema } from '@graphql-tools/schema';
import { mergeTypeDefs, mergeResolvers } from '@graphql-tools/merge';

// Import type definitions
import { baseTypeDefs } from './schemas/base';
import { authTypeDefs } from './schemas/auth';
import { userTypeDefs } from './schemas/user';
import { projectTypeDefs } from './schemas/project';
import { deliverableTypeDefs } from './schemas/deliverable';
import { talentTypeDefs } from './schemas/talent';
import { opportunityTypeDefs } from './schemas/opportunity';
import { studioTypeDefs } from './schemas/studio';
import { mediaTypeDefs } from './schemas/media';

// Import resolvers
import { scalarResolvers } from './resolvers/scalars';
import { authResolvers } from './resolvers/auth';
import { userResolvers } from './resolvers/user';
import { projectResolvers } from './resolvers/project';
import { deliverableResolvers } from './resolvers/deliverable';
import { talentResolvers } from './resolvers/talent';
import { opportunityResolvers } from './resolvers/opportunity';
import { studioResolvers } from './resolvers/studio';
import { mediaResolvers } from './resolvers/media';

// Merge all type definitions
const typeDefs = mergeTypeDefs([
  baseTypeDefs,
  authTypeDefs,
  userTypeDefs,
  projectTypeDefs,
  deliverableTypeDefs,
  talentTypeDefs,
  opportunityTypeDefs,
  studioTypeDefs,
  mediaTypeDefs,
]);

// Merge all resolvers
const resolvers = mergeResolvers([
  scalarResolvers,
  authResolvers,
  userResolvers,
  projectResolvers,
  deliverableResolvers,
  talentResolvers,
  opportunityResolvers,
  studioResolvers,
  mediaResolvers,
]);

// Create executable schema
export const schema = makeExecutableSchema({
  typeDefs,
  resolvers,
});
