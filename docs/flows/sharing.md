# Flows — Partage de projets et de vidéos

## Trois mécanismes de partage

1. **Membres directs** : on ajoute un user à un projet avec un rôle
   (`OWNER`, `COLLABORATOR`, `VIEWER`) et des permissions
   (`view`, `comment`, `download`).
2. **Lien public** : on crée un `PublicShareLink` (projet) ou
   `DeliverableShareLink` (vidéo unique) avec un token signé. Quiconque a
   le lien accède selon la permission du lien.
3. **Invitation par email** : envoie un email contenant un lien d'acceptation
   d'invitation.

## Visibilité d'un livrable

```mermaid
flowchart TD
  Start([Requête sur Deliverable X]) --> AuthCheck{User authentifié ?}
  AuthCheck -->|Non| TokenCheck{Token de partage<br/>dans l'URL ?}
  AuthCheck -->|Oui| MemberCheck{Membre du projet ?}

  TokenCheck -->|Oui| ValidateToken{Token valide<br/>+ non expiré ?}
  TokenCheck -->|Non| Deny[403]

  ValidateToken -->|Oui| GuestAccess[Accès en mode guest<br/>permission du lien]
  ValidateToken -->|Non| Deny

  MemberCheck -->|Oui| MemberAccess[Accès selon rôle/permissions]
  MemberCheck -->|Non| OwnerCheck{Owner du livrable ?}

  OwnerCheck -->|Oui| OwnerAccess[Accès complet]
  OwnerCheck -->|Non| Deny
```

## Permissions

| Niveau | view | comment | download | Représentation UI |
|---|---|---|---|---|
| `view` | ✓ | ✗ | ✗ | "Lecteur" |
| `comment` | ✓ | ✓ | ✗ | "Commentateur" |
| `download` | ✓ | ✓ | ✓ | "Éditeur" |

Le rôle `OWNER` a toujours toutes les permissions et peut transférer la
propriété (avec confirmation par email du destinataire).
