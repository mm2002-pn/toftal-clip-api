import DataLoader from 'dataloader';
import { prisma } from '../../config/database';
import { User } from '@prisma/client';

/**
 * DataLoader pour charger les users par ID en batch
 * Utilisé pour éviter N+1 queries dans assignedTalent, uploadedBy, author, etc.
 */
export function createUserLoader() {
  return new DataLoader<string, User | null>(
    async (userIds: readonly string[]) => {
      // Charger TOUS les users en UNE seule requête
      const users = await prisma.user.findMany({
        where: {
          id: { in: [...userIds] },
        },
      });

      // Créer un map pour retrouver rapidement les users
      const userMap = new Map(users.map((user) => [user.id, user]));

      // Retourner dans le MÊME ORDRE que les IDs demandés
      return userIds.map((id) => userMap.get(id) || null);
    },
    {
      // Options de cache (désactivé en prod si données changent souvent)
      cache: true,
    }
  );
}
