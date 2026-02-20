import { DateTimeResolver, JSONResolver } from 'graphql-scalars';

export const scalarResolvers = {
  DateTime: DateTimeResolver,
  JSON: JSONResolver,
};
