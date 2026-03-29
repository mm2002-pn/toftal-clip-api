import { createUserLoader } from './user.loader';
import { createDeliverablesByProjectIdLoader, createDeliverableByIdLoader } from './deliverable.loader';

/**
 * Type pour les DataLoaders disponibles dans le context GraphQL
 */
export interface DataLoaders {
  userLoader: ReturnType<typeof createUserLoader>;
  deliverablesByProjectIdLoader: ReturnType<typeof createDeliverablesByProjectIdLoader>;
  deliverableByIdLoader: ReturnType<typeof createDeliverableByIdLoader>;
}

/**
 * Crée une nouvelle instance des DataLoaders
 * IMPORTANT: Doit être appelé pour CHAQUE requête GraphQL
 * (les DataLoaders ne doivent PAS être partagés entre requêtes)
 */
export function createDataLoaders(): DataLoaders {
  return {
    userLoader: createUserLoader(),
    deliverablesByProjectIdLoader: createDeliverablesByProjectIdLoader(),
    deliverableByIdLoader: createDeliverableByIdLoader(),
  };
}
