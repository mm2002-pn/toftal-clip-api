# Backend — Services partagés

Les services dans `src/services/` encapsulent une logique métier ou une
intégration technique réutilisable par plusieurs modules (REST + GraphQL).

| Service | Rôle |
|---|---|
| `AccessRequestService` | Création / approbation / rejet des demandes d'accès projet |
| `EmailService` | SMTP transactionnel — envoi d'emails templatés |
| `InvitationService` | Génération de tokens d'invitation, expiration, acceptation |
| `PermissionService` | Source unique de vérité pour les permissions (rôle + perms granulaires) |
| `VideoMetadataService` | ffprobe sur les vidéos uploadées (durée, codec, dimensions) |
| `VideoThumbnailService` | Génération de thumbnail à partir d'un timestamp |
| `auditLogger` | Persistance des actions sensibles pour l'admin (qui a fait quoi) |
| `bictorysService` | Wrapper de l'API Bictorys (createCharge, vérif webhook) |
| `cacheService` | Read-through cache Redis (TTL configurable par clé) |
| `faststartTrigger` | Trigger Cloud Run Job faststart |
| `previewTrigger` | Trigger Cloud Run Job preview |
| `hlsTrigger` | Trigger Cloud Run Job HLS |
| `pushNotificationService` | Push FCM via firebase-admin (Android, iOS, Web) |
| `socketService` | Wrapper Socket.io — émit ciblé par user/room, Redis adapter pour multi-instance |
| `subscriptionLimitsService` | Quota check par plan (uploads/mois, taille max, etc.) |
| `templateResolver` | Résolution des templates email (Handlebars-like) |

## Conventions

- **Stateless** : un service ne maintient pas d'état d'instance (pas de
  cache mémoire). Le state externalisé va dans Redis ou Postgres.
- **Logs structurés** : préfixer par un tag pour grepper (`[bictorys]`,
  `[email]`, etc.).
- **Erreurs typées** : un service lève des erreurs avec `code` + `message`
  pour que le caller décide du status HTTP / code GraphQL.
- **Pas de `req`/`res`** : les services ne touchent pas la couche HTTP.
  Si tu te retrouves à passer un `req`, c'est que la logique appartient à
  un controller, pas un service.

## Cas d'usage typique

```typescript
// REST controller
import { PermissionService } from '../../../services/PermissionService';

export const updateMember = async (req, res) => {
  const allowed = await PermissionService.canManageMembers(req.user.id, req.params.projectId);
  if (!allowed) return res.status(403).json({ success: false, error: 'forbidden' });
  // ...
};

// GraphQL resolver
import { PermissionService } from '../../services/PermissionService';

export const projectResolvers = {
  Mutation: {
    updateMember: async (_, args, ctx) => {
      requireAuth(ctx);
      const allowed = await PermissionService.canManageMembers(ctx.user.id, args.projectId);
      if (!allowed) throw new GraphQLError('forbidden');
      // ...
    }
  }
};
```

## Socket.io + Redis adapter

Le `socketService` utilise le Redis adapter (`@socket.io/redis-adapter`)
pour fonctionner sur plusieurs instances Cloud Run. Sans l'adapter, un
`io.to(userId).emit(...)` n'atteindrait que les clients connectés à
**l'instance courante** — les autres clients du même user resteraient
muets.

Avec l'adapter, le pub/sub Redis propage l'event vers toutes les
instances qui retransmettent à leurs clients connectés.
