import DataLoader from 'dataloader';
import { prisma } from '../../config/database';
import { Deliverable } from '@prisma/client';

/**
 * DataLoader pour charger les deliverables par projectId en batch
 * Utilisé pour éviter N+1 queries dans Project.deliverables
 */
export function createDeliverablesByProjectIdLoader() {
  return new DataLoader<string, Deliverable[]>(
    async (projectIds: readonly string[]) => {
      // Charger TOUS les deliverables pour TOUS les projects en UNE seule requête
      const deliverables = await prisma.deliverable.findMany({
        where: {
          projectId: { in: [...projectIds] },
        },
        orderBy: { createdAt: 'asc' },
      });

      // Grouper les deliverables par projectId
      const deliverablesByProjectId = new Map<string, Deliverable[]>();

      // Initialiser avec des arrays vides pour chaque projectId
      projectIds.forEach((id) => {
        deliverablesByProjectId.set(id, []);
      });

      // Remplir avec les deliverables trouvés
      deliverables.forEach((deliverable) => {
        const existing = deliverablesByProjectId.get(deliverable.projectId) || [];
        existing.push(deliverable);
        deliverablesByProjectId.set(deliverable.projectId, existing);
      });

      // Retourner dans le MÊME ORDRE que les projectIds demandés
      return projectIds.map((id) => deliverablesByProjectId.get(id) || []);
    },
    {
      cache: true,
    }
  );
}

/**
 * DataLoader pour charger un deliverable unique par ID
 * Utilisé pour éviter requêtes répétées du même deliverable
 */
export function createDeliverableByIdLoader() {
  return new DataLoader<string, Deliverable | null>(
    async (deliverableIds: readonly string[]) => {
      const deliverables = await prisma.deliverable.findMany({
        where: {
          id: { in: [...deliverableIds] },
        },
      });

      const deliverableMap = new Map(
        deliverables.map((d) => [d.id, d])
      );

      return deliverableIds.map((id) => deliverableMap.get(id) || null);
    },
    {
      cache: true,
    }
  );
}
