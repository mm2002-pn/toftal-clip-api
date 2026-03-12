# Logique des Projets - Toftal Clip

## Types de Projets

### 1. Projet Personnel (`PERSONAL`)
- Créé par un **TALENT** pour lui-même
- Le créateur est propriétaire (`ownerId`)
- Pas d'invitation nécessaire
- Workflow simple: créer → ajouter livrables → travailler

### 2. Projet Client (`CLIENT`)
- Créé par un **TALENT** pour un **CLIENT**
- Le TALENT reste propriétaire (`ownerId`)
- Le CLIENT est invité par email

## Workflow Projet CLIENT

```
┌─────────────────────────────────────────────────────────────────┐
│  1. TALENT crée le projet (type: CLIENT)                        │
│     - ownerId = TALENT                                          │
│     - status = PENDING                                          │
│     - briefCompletedAt = null                                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. Invitation envoyée au CLIENT                                │
│     - Email avec token unique                                   │
│     - Status invitation = PENDING                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. CLIENT accepte l'invitation                                 │
│     - Créé comme ProjectMember (role: COLLABORATOR)             │
│     - Permissions: view, edit, comment, approve = true          │
│     - clientId = CLIENT (identifie le client du projet)         │
│     - ownerId reste = TALENT                                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. CLIENT voit l'ONBOARDING                                    │
│     Condition: shouldShowOnboarding =                           │
│       - briefCompletedAt === null                               │
│       - type === 'CLIENT'                                       │
│       - ownerId !== user.id (pas le créateur)                   │
│       - user est ProjectMember                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  5. CLIENT complète le brief (onboarding)                       │
│     - Ajoute infos projet                                       │
│     - Crée les livrables                                        │
│     - briefCompletedAt = NOW                                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  6. TALENT voit le projet avec livrables                        │
│     Avant brief: showWaitingForClient = true                    │
│       → "Projet en attente" affiché                             │
│     Après brief: workspace normal avec livrables                │
└─────────────────────────────────────────────────────────────────┘
```

## Rôles et Permissions

### ProjectRole (dans ProjectMember)
| Rôle | Description |
|------|-------------|
| `OWNER` | Propriétaire du projet |
| `COLLABORATOR` | Collaborateur avec permissions |
| `VIEWER` | Lecture seule |

### UserRole (compte utilisateur)
| Rôle | Description |
|------|-------------|
| `TALENT` | Monteur vidéo |
| `CLIENT` | Client |
| `ADMIN` | Administrateur |

### Permissions (JSON dans ProjectMember)
```json
{
  "view": true,      // Voir le projet
  "edit": true,      // Modifier le projet
  "comment": true,   // Commenter
  "approve": true    // Valider les livrables
}
```

## Affichage selon le contexte

### Pour le TALENT (créateur)
```
Si briefCompletedAt === null:
  → Affiche "Projet en attente" (showWaitingForClient)
Sinon:
  → Affiche le workspace normal
```

### Pour le CLIENT (invité)
```
Si briefCompletedAt === null:
  → Affiche le formulaire d'onboarding (shouldShowOnboarding)
Sinon:
  → Affiche le workspace normal
```

## Statuts des Livrables

```
PREPARATION (0%) → RETOUR (40%) → PRODUCTION (50%) → VALIDATION (75%) → VALIDE (100%)
```

## Assignation de Talent

- Un livrable peut être assigné à un TALENT
- `acceptanceStatus`: PENDING → ACCEPTED / REJECTED
- Le TALENT assigné doit accepter avant de travailler
- Impossible d'assigner sur un livrable VALIDE

## Points Clés

1. **Le TALENT reste toujours `ownerId`** du projet CLIENT
2. **Le CLIENT est `clientId`** et ProjectMember avec permissions complètes
3. **`briefCompletedAt`** contrôle l'affichage onboarding vs workspace
4. **L'invitation** crée le lien entre CLIENT et projet
